// R2 P8 FIX ROUND F4 — F-9: "a dropped network request makes the card click do
// nothing".
//
// MEASURED BEFORE (review-p8-4 F-9, reproduced by this file's own first run):
// `openApplyConfirm` (quotes-tabs/templates.ts) chained `.then(...)` with no
// rejection handler. `fetchJson` only swallows a JSON *parse* failure, so a
// REJECTED fetch — the laptop drops its network between the click and the
// response — resolved nothing: no confirm state, no error slot, no message.
// Clicking a template card did literally nothing, and the operator had no way
// to tell a dead click from a slow one. HTTP errors (4xx/5xx) were always
// handled; this is the other half of the same branch.
//
// This drives the SHIPPED island source — the same `<script>` string the
// Templates tab serves — in a VM, with the ONE thing this defect is about: a
// fetch that rejects. Nothing on the consumer side is hand-built (E10/E11): the
// functions under test are sliced out of the real emitted island, and the
// assertions read the nodes the island itself wrote.
import { describe, expect, it } from "vitest";
import { runInNewContext } from "node:vm";

import { renderTemplatesTabPanel } from "../src/admin/leadgen/quotes-tabs/templates";

function islandSource(): string {
  const panel = renderTemplatesTabPanel(true, []);
  const match = panel.match(/<script>([\s\S]*?)<\/script>/);
  expect(match, "templates panel ships its inline island").not.toBeNull();
  return match![1] ?? "";
}

// The declaration, brace-balanced, exactly as the island ships it.
function sliceIslandFn(src: string, name: string): string {
  const at = src.indexOf(`function ${name}(`);
  expect(at, `island must declare function ${name}`).toBeGreaterThan(-1);
  const open = src.indexOf("{", at);
  let depth = 0;
  let i = open;
  for (; i < src.length; i += 1) {
    const ch = src.charAt(i);
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  return src.slice(at, i + 1);
}

function sliceIslandVar(src: string, name: string): string {
  const re = new RegExp(`\\n\\s*var ${name}\\b[^;]*;`);
  const m = src.match(re);
  expect(m, `island must declare var ${name}`).not.toBeNull();
  return (m![0] ?? "").trim();
}

interface FakeNode {
  className: string;
  children: FakeNode[];
  nodeText: string;
  firstChild: FakeNode | null;
  appendChild(c: FakeNode): FakeNode;
  removeChild(c: FakeNode): FakeNode;
  getAttribute(k: string): string | null;
  querySelectorAll(sel: string): FakeNode[];
  readonly textContent: string;
}

function fakeNode(attrs: Record<string, string> = {}, nodeText = ""): FakeNode {
  const el: FakeNode = {
    className: "",
    children: [],
    nodeText,
    get firstChild() { return el.children.length > 0 ? el.children[0]! : null; },
    appendChild(c: FakeNode) { el.children.push(c); return c; },
    removeChild(c: FakeNode) { el.children = el.children.filter((x) => x !== c); return c; },
    getAttribute(k: string) { return Object.prototype.hasOwnProperty.call(attrs, k) ? attrs[k]! : null; },
    querySelectorAll() { return []; },
    get textContent(): string { return el.nodeText + el.children.map((c) => c.textContent).join(""); },
  };
  return el;
}

const APPLY_ISLAND_FNS = [
  "byId",
  "toArray",
  "clearChildren",
  "text",
  "isRecord",
  "getPath",
  "fetchJson",
  "showError",
  "hideError",
  "boardFunnels",
  "boardFunnelBy",
  "lgHashParam",
  "targetFunnelPublicId",
  "applyDialogShowState",
  "applyLeadLine",
  "paintConfirmList",
  "openApplyConfirm",
] as const;

interface Drive {
  choose(tpl: Record<string, unknown>): Promise<void>;
  error(): string;
  errorVisible(): boolean;
  state(): string;
  lines(): string[];
  calls(): number;
}

// `mode` decides what the network does: a REJECTED fetch (the defect), or a
// normal 200 (the control leg, so the same driver proves it is the rejection
// that is handled and not everything indiscriminately).
function drive(mode: "reject" | "ok"): Drive {
  const src = islandSource();
  const list = fakeNode();
  const errorSlot = fakeNode();
  errorSlot.className = "lg-hidden";
  const choosePanel = fakeNode({ "data-apply-state": "choose" });
  const confirmPanel = fakeNode({ "data-apply-state": "confirm" });
  confirmPanel.className = "lg-hidden";
  const dialog = fakeNode();
  dialog.querySelectorAll = () => [choosePanel, confirmPanel];
  const byIdMap: Record<string, FakeNode> = {
    "lg-tpl-apply-confirm-list": list,
    "lg-tpl-apply-error": errorSlot,
    "lg-tpl-apply-dialog": dialog,
  };
  const pending: Array<Promise<unknown>> = [];
  let calls = 0;
  const body =
    [sliceIslandVar(src, "LG_API"), sliceIslandVar(src, "boot"), sliceIslandVar(src, "applyChosenTemplate")].join("\n") +
    "\n" +
    APPLY_ISLAND_FNS.map((n) => sliceIslandFn(src, n)).join("\n") +
    `\nboot = ${JSON.stringify({ funnel_public_id: "lgf_f4reject", quote_public_id: "lgq_f4reject" })};\n` +
    "({ choose: openApplyConfirm })";
  const island = runInNewContext(body, {
    document: {
      getElementById: (id: string) => byIdMap[id] ?? null,
      createElement: () => fakeNode(),
      createTextNode: (t: string) => fakeNode({}, String(t)),
    },
    window: { location: { hash: "" } },
    fetch: (): Promise<unknown> => {
      calls += 1;
      // A dropped request is a REJECTED promise, exactly as the browser's own
      // fetch reports it — not a non-2xx response.
      const p = mode === "reject"
        ? Promise.reject(new TypeError("Failed to fetch"))
        : Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ confirmations: ["The footer will be removed."] }),
          });
      pending.push(p.catch(() => null));
      return p as Promise<unknown>;
    },
    JSON,
    Object,
    String,
    Boolean,
    Number,
    Array,
    Promise,
    TypeError,
  }) as { choose(tpl: Record<string, unknown>): void };
  return {
    async choose(tpl) {
      island.choose(tpl);
      await Promise.all(pending);
      await new Promise((r) => setTimeout(r, 0));
    },
    error: () => errorSlot.textContent,
    errorVisible: () => errorSlot.className.indexOf("lg-hidden") < 0,
    state: () => (confirmPanel.className.indexOf("lg-hidden") < 0 ? "confirm" : "choose"),
    lines: () => list.children.map((c) => c.textContent),
    calls: () => calls,
  };
}

describe("R2 P8 F4 · F-9 — a dropped apply-preview request is SAID, not swallowed", () => {
  it("the request rejects: the dialog stays out of the confirm state and the operator reads why, in the panel's existing error slot", async () => {
    const d = drive("reject");
    await d.choose({ id: 7, name: "ROASTC Minimal" });

    expect(d.calls(), "the click really did issue the dry run").toBe(1);
    // THE DEFECT: before this round both of these were false — an unhandled
    // rejection left the panel exactly as it was.
    expect(d.errorVisible()).toBe(true);
    expect(d.error()).toBe("Could not preview this template.");
    // …and it must NOT pretend the preview worked.
    expect(d.state()).toBe("choose");
    expect(d.lines()).toEqual([]);
    // Operator copy, not internals: no clause markers, no raw enum tokens, no
    // exception text leaking to the screen.
    expect(d.error()).not.toContain("(§");
    expect(d.error()).not.toContain("_");
    expect(d.error()).not.toContain("fetch");
  });

  it("the control leg: a request that SUCCEEDS still enters the confirm state with the server's own sentences and no error", async () => {
    const d = drive("ok");
    await d.choose({ id: 7, name: "ROASTC Minimal" });

    expect(d.state()).toBe("confirm");
    expect(d.errorVisible()).toBe(false);
    expect(d.lines()).toEqual([
      '"ROASTC Minimal" becomes this funnel’s layout template.',
      "The footer will be removed.",
    ]);
  });
});
