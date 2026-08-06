// LEADGEN R2 — P8 CLOSE, post-review FIX-FIRST slice F-A.
// Two review findings, one lane file:
//
//  * D-6 — `cache_refresh_warning` had ZERO consumers. themes-handlers.ts:746
//    names the failed funnel-version bump in the 200 body, but the manager's
//    island did `if (res.ok) { window.location.reload(); return null; }`, so
//    the operator was silently reloaded and told nothing. The cases below
//    drive the REAL island (THEME_MGR_SCRIPT, run under node:vm exactly like
//    leadgen-theme-manager-ui.test.ts's ES5 case) through the REAL wired
//    control (`[data-tm-seg]` -> wireSegments -> patchTheme) and assert the
//    warning reaches #tm-error — the ONE notice surface this file already
//    owns (showError, renderTopBar's role="alert" banner) — with no reload,
//    while a normal (no-warning) 200 still reloads exactly once.
//    FAIL-BEFORE at 1dbf1783: the warning case fails (reloads=1, #tm-error
//    empty), because the success branch never read the body.
//
//  * D-2 — the §8.4 anatomy ("a live real-section canvas BESIDE the editor",
//    docs/leadgen/rework/design-pack/themes.html) engaged only at >=1600; at
//    1280 the canvas landed ~1939px BELOW the editor. The fix is one measured
//    declaration (the centre pane's flex basis). The case below pins the
//    ARITHMETIC of that declaration against the other three real declarations
//    it is derived from, so a future edit cannot break the identity silently.
//    It is NOT the geometry proof: the proof is the driven browser lane
//    (test-ui/leadgen-r2p6-themefix-drive.spec.ts, 1280 + 1600 legs).
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runInNewContext } from "node:vm";
import { THEME_MGR_SCRIPT } from "../src/admin/leadgen/ui-theme-manager";

// ===========================================================================
// D-6 — the cache_refresh_warning consumer, driven through the real island
// ===========================================================================

interface FakeEl {
  textContent: string;
  hidden: boolean;
  style: { display?: string };
}
interface RecordedFetch {
  url: string;
  method: string;
  body: unknown;
}
interface Driven {
  errorEl: FakeEl;
  reloads: () => number;
  calls: RecordedFetch[];
  click: () => void;
}

type FetchResult = { ok: boolean; status: number; json?: () => Promise<unknown> };

// The island's own load-time wiring is what we drive: wireSegments() reads
// [data-tm-seg] and attaches the click handler that calls patchTheme(). Only
// #tm-error and one segment exist in this DOM stub; every other wireX() takes
// its own `if (!el) return` path, exactly as it does on a page with no theme
// selected.
function driveIsland(result: FetchResult): Driven {
  const errorEl: FakeEl = { textContent: "", hidden: true, style: {} };
  const calls: RecordedFetch[] = [];
  let reloads = 0;
  const handlers: Record<string, () => void> = {};
  const segAttrs: Record<string, string> = {
    "data-top": "controls",
    "data-group": "corners",
    "data-value": "pill",
    "data-theme-id": "thm_fa_close",
  };
  const seg = {
    getAttribute: (name: string): string | null => segAttrs[name] ?? null,
    addEventListener: (type: string, fn: () => void): void => {
      handlers[type] = fn;
    },
  };
  const sandbox: Record<string, unknown> = {
    document: {
      getElementById: (id: string): FakeEl | null => (id === "tm-error" ? errorEl : null),
      querySelectorAll: (sel: string): unknown[] => (sel === "[data-tm-seg]" ? [seg] : []),
    },
    window: {
      location: {
        reload: (): void => {
          reloads += 1;
        },
        href: "",
        search: "",
      },
      confirm: (): boolean => true,
    },
    fetch: (url: string, init: { method: string; body?: string }): Promise<FetchResult> => {
      calls.push({ url, method: init.method, body: init.body === undefined ? null : JSON.parse(init.body) });
      return Promise.resolve(result);
    },
    Promise,
    JSON,
    encodeURIComponent,
    Error,
  };
  runInNewContext(THEME_MGR_SCRIPT, sandbox);
  const click = handlers["click"];
  expect(click, "the real island wired a click handler on [data-tm-seg]").toBeTypeOf("function");
  return { errorEl, reloads: () => reloads, calls, click: click as () => void };
}

// The island's chain is fetch -> .then -> .json -> .then; four macrotask
// turns flush it with room to spare and never depend on a fixed tick count.
async function flush(): Promise<void> {
  for (let i = 0; i < 4; i += 1) await new Promise((r) => setTimeout(r, 0));
}

// The verbatim shape themes-handlers.ts:741-746 puts in the 200 body when the
// funnel-version bump throws (its `warning` template, with a real message).
const HANDLER_WARNING =
  "Theme saved, but refreshing the live funnels that use it did not complete (D1_ERROR: no such table: leadgen_funnel_variants). " +
  "They may keep serving the previous values until their next save.";

describe("P8 CLOSE F-A / D-6 — cache_refresh_warning reaches the operator", () => {
  it("a 200 carrying cache_refresh_warning renders it on #tm-error and does NOT reload", async () => {
    const d = driveIsland({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ item: { id: "thm_fa_close" }, cache_refresh_warning: HANDLER_WARNING }),
    });
    d.click();
    await flush();
    expect(d.errorEl.textContent, "the warning text itself, not a paraphrase").toBe(HANDLER_WARNING);
    expect(d.errorEl.hidden, "#tm-error is un-hidden").toBe(false);
    expect(d.errorEl.style.display, "#tm-error is displayed (showError's own idiom)").toBe("block");
    expect(d.reloads(), "no silent reload: the alert must survive for the operator to read").toBe(0);
  });

  it("the driven path is the REAL one: PATCH /api/admin/leadgen/themes/:id with the segment's own patch", async () => {
    const d = driveIsland({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ item: {}, cache_refresh_warning: HANDLER_WARNING }),
    });
    d.click();
    await flush();
    expect(d.calls).toHaveLength(1);
    expect(d.calls[0]?.url).toBe("/api/admin/leadgen/themes/thm_fa_close");
    expect(d.calls[0]?.method).toBe("PATCH");
    expect(d.calls[0]?.body).toEqual({ controls: { corners: "pill" } });
  });

  it("REGRESSION — a normal 200 (no warning) still reloads exactly once and leaves #tm-error empty", async () => {
    const d = driveIsland({ ok: true, status: 200, json: () => Promise.resolve({ item: { id: "thm_fa_close" }, items: [] }) });
    d.click();
    await flush();
    expect(d.reloads(), "unchanged success behaviour").toBe(1);
    expect(d.errorEl.textContent).toBe("");
    expect(d.errorEl.hidden).toBe(true);
  });

  it("REGRESSION — a 200 whose body is not JSON still reloads (nothing to surface)", async () => {
    const d = driveIsland({ ok: true, status: 200, json: () => Promise.reject(new Error("Unexpected end of JSON input")) });
    d.click();
    await flush();
    expect(d.reloads()).toBe(1);
    expect(d.errorEl.textContent).toBe("");
  });

  it("REGRESSION — a failed PATCH still surfaces data.error on #tm-error and never reloads", async () => {
    const d = driveIsland({ ok: false, status: 422, json: () => Promise.resolve({ error: "Validation failed" }) });
    d.click();
    await flush();
    expect(d.errorEl.textContent).toBe("Validation failed");
    expect(d.reloads()).toBe(0);
  });

  it("the consumer added no non-ES5 syntax to the island", () => {
    expect(THEME_MGR_SCRIPT.includes("`")).toBe(false);
    expect(THEME_MGR_SCRIPT).not.toMatch(/=>/);
    expect(THEME_MGR_SCRIPT).not.toMatch(/\bconst\b/);
    expect(THEME_MGR_SCRIPT).not.toMatch(/\blet\b/);
    expect(THEME_MGR_SCRIPT).not.toMatch(/\?\./);
    expect(THEME_MGR_SCRIPT).toContain("cache_refresh_warning");
  });
});

// ===========================================================================
// D-2 — the §8.4 "beside" declaration arithmetic (drift guard, NOT the proof)
// ===========================================================================

const SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "src", "admin", "leadgen", "ui-theme-manager.ts"),
  "utf8",
);

// Anchor: the MARKUP occurrence of the centre pane. The three pin names also
// appear in this file's comments ABOVE the markup (lines 1019/1338), so every
// lookup below starts at the opening tag, never at index 0.
const CENTRE_AT = SRC.indexOf('<div data-pin="8.4-center-pane"');

// The p8-n-theme-ui idiom: find the marker, slice the tag that carries it,
// read its inline style. No attribute-order assumption.
function inlineStyleAt(marker: string): string {
  const at = SRC.indexOf(marker, CENTRE_AT);
  expect(at, `marker ${marker}`).toBeGreaterThan(-1);
  const tag = SRC.slice(SRC.lastIndexOf("<", at), SRC.indexOf(">", at));
  return tag.match(/style="([^"]*)"/)?.[1] ?? "";
}
function decl(style: string, prop: string): string {
  return (style.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`))?.[1] ?? "").trim();
}
function basisPx(style: string): number {
  const spec = decl(style, "flex");
  const m = spec.match(/(\d+(?:\.\d+)?)px\s*$/);
  expect(m, `flex basis in "${spec}"`).not.toBeNull();
  return Number(m?.[1]);
}
function perSidePaddingPx(shorthand: string): number {
  // "24px 28px" -> 28 per side, x2 below. A 1-value or 4-value shorthand is
  // read the same way: the LEFT/RIGHT component.
  const parts = shorthand.trim().split(/\s+/);
  const horizontal = parts.length === 1 ? parts[0] : parts[1];
  return Number(String(horizontal).replace("px", ""));
}

describe("P8 CLOSE F-A / D-2 — the centre pane's basis IS the §8.4 side-by-side sum", () => {
  const centre = inlineStyleAt('data-pin="8.4-center-pane"');
  const editor = inlineStyleAt('data-pin="8.4-editor-controls"');
  const canvas = inlineStyleAt('data-pin="8.4-live-canvas"');
  // The row that holds editor + canvas is the centre pane's only child div.
  const rowGap = (() => {
    const row = SRC.slice(CENTRE_AT, SRC.indexOf('data-pin="8.4-editor-controls"', CENTRE_AT));
    const m = row.match(/gap:(\d+)px/);
    expect(m, "the editor+canvas row declares a px gap").not.toBeNull();
    return Number(m?.[1]);
  })();

  it("editor floor 258 + gap 26 + canvas basis 340 + the centre pane's own padding 56 == the centre basis", () => {
    const editorFloor = Number(decl(editor, "min-width").replace("px", ""));
    const canvasBasis = basisPx(canvas);
    const padX = perSidePaddingPx(decl(centre, "padding")) * 2;
    expect(editorFloor, "the editor column's shrink floor (F3/N7)").toBe(258);
    expect(canvasBasis, "the canvas keeps its designed 340px (design-pack pin)").toBe(340);
    expect(rowGap).toBe(26);
    expect(padX).toBe(56);
    expect(basisPx(centre), "centre basis = 258 + 26 + 340 + 56").toBe(editorFloor + rowGap + canvasBasis + padX);
  });

  it("the canvas may shrink but never grows past its design, and the editor+canvas row still wraps", () => {
    expect(decl(canvas, "flex").startsWith("0 1 "), `canvas flex "${decl(canvas, "flex")}"`).toBe(true);
    expect(decl(centre, "flex").startsWith("1 1 "), `centre flex "${decl(centre, "flex")}"`).toBe(true);
    expect(SRC).toContain("flex-wrap:wrap;gap:26px;align-items:flex-start");
  });
});
