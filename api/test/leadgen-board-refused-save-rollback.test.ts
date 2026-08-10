// Owner-reported wedge (2026-08-09):
//   "after I clicked on one home insurance section mistakenly I can't add
//    sections and pages at all"
//
// Mechanism, reproduced through the real routes: the board edits its in-memory
// plan FIRST and then PUTs it. When the server refused the edit (a section
// outside the quote's verticals is a 400), the refused slot STAYED in the plan,
// so the NEXT action — "+ Add page", or any other section — resent it and got
// the same refusal. Only a page reload cleared it, because the board paints
// from the server and never re-renders from its own model.
//
// These tests drive the SHIPPED island code (sliced out of the rendered page
// and run in a node:vm sandbox — the leadgen-p2-tail.test.ts idiom), so they
// prove the behaviour of the bytes the operator's browser actually runs, not a
// hand-written copy of them.
import { describe, expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { QUOTE_EDITOR_SCRIPT } from "../src/admin/leadgen/quotes-tabs/funnel";

function sliceIslandFunction(island: string, name: string): string {
  const marker = `function ${name}(`;
  const start = island.indexOf(marker);
  expect(start, `island function ${name}`).toBeGreaterThan(-1);
  let depth = 0;
  let seenBody = false;
  for (let i = start; i < island.length; i += 1) {
    const ch = island[i];
    if (ch === "{") {
      depth += 1;
      seenBody = true;
    } else if (ch === "}") {
      depth -= 1;
      if (seenBody && depth === 0) return island.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced island function ${name}`);
}

interface SaveCall {
  pages: unknown;
}

// Runs the REAL saveFunnel + addSectionToFunnelPage + addPage from the island,
// with a `req` stub whose verdict the test chooses.
function sandbox(ok: boolean): {
  addSection: (model: Record<string, unknown>, pageIndex: number, sectionId: string) => void;
  addPage: (model: Record<string, unknown>) => void;
  calls: SaveCall[];
  errors: string[];
} {
  const island = QUOTE_EDITOR_SCRIPT;
  const src = [
    sliceIslandFunction(island, "saveFunnel"),
    sliceIslandFunction(island, "addSectionToFunnelPage"),
    sliceIslandFunction(island, "addPage"),
    // addPage now paints the new card immediately (so the click is not waiting
    // on the ~2 s save) and a refused save takes that node back out. Both are
    // part of the behaviour under test, so both come along -- and this sandbox
    // has no `document`, which is exactly the environment that proves they stay
    // out of the model rollback's way.
    sliceIslandFunction(island, "ancestorWithAttr"),
    sliceIslandFunction(island, "paintProvisionalPage"),
    sliceIslandFunction(island, "dropProvisional"),
  ].join("\n");

  const calls: SaveCall[] = [];
  const errors: string[] = [];
  const ctx: Record<string, unknown> = {
    JSON,
    Object,
    String,
    Boolean,
    Number,
    encodeURIComponent,
    API: "/api/admin/leadgen",
    suppressNextLibClick: false,
    // the save: records what would go to the server, then answers ok/refused
    req: (_m: string, _u: string, body: { pages: unknown }) => {
      calls.push({ pages: JSON.parse(JSON.stringify(body.pages)) as unknown });
      return {
        then: (fn: (res: { ok: boolean; body: unknown }) => void) => {
          fn({ ok, body: { fields: { "pages.0.slots.0.section_id": "'Roof Age' is in the home Vertical…" } } });
          return { then: () => undefined };
        },
      };
    },
    funnelPagesToPut: (f: { pages: unknown }) => f.pages,
    showInlineErr: (_el: unknown, msg: string) => errors.push(String(msg)),
    firstFieldError: (b: { fields?: Record<string, string> }) => Object.values(b.fields ?? {})[0] ?? "",
    reloadPage: () => undefined,
    // addPage resolves its funnel through the DOM; hand it the model directly
    funnelOfEl: (el: unknown) => el as { model: unknown },
  };
  runInNewContext(`${src}\nthis.__addSection = addSectionToFunnelPage; this.__addPage = addPage;`, ctx);
  return {
    addSection: (model, pageIndex, sectionId) =>
      (ctx["__addSection"] as (m: unknown, i: number, s: string, n: unknown) => void)(model, pageIndex, sectionId, null),
    addPage: (model) => (ctx["__addPage"] as (el: unknown) => void)({ model }),
    calls,
    errors,
  };
}

describe("the board recovers from a refused save (owner wedge 2026-08-09)", () => {
  it("a REFUSED section add is rolled out of the plan, so the next save is clean", () => {
    const s = sandbox(false);
    const model = { active_variant_public_id: "lgn_1", pages: [{ page_id: "p1", slots: [] }] };
    const before = JSON.stringify(model.pages);

    s.addSection(model, 0, "lgs_home_roof_age");

    expect(s.calls.length, "the save was attempted").toBe(1);
    expect(s.errors[0], "the server's reason is shown").toContain("home Vertical");
    // THE FIX: the refused slot is gone from the plan.
    expect(JSON.stringify(model.pages)).toBe(before);

    // ...so the next action sends only ITSELF, not the refused section again.
    s.addPage(model);
    const lastSent = JSON.stringify(s.calls[s.calls.length - 1]?.pages ?? null);
    expect(lastSent).not.toContain("lgs_home_roof_age");
  });

  it("an ACCEPTED add is kept in the plan (the rollback only fires on refusal)", () => {
    const s = sandbox(true);
    const model = { active_variant_public_id: "lgn_1", pages: [{ page_id: "p1", slots: [] }] };

    s.addSection(model, 0, "lgs_ok_section");

    expect(s.calls.length).toBe(1);
    expect(s.errors).toEqual([]);
    expect(JSON.stringify(model.pages)).toContain("lgs_ok_section");
  });

  it("a REFUSED '+ Add page' leaves no phantom page behind", () => {
    const s = sandbox(false);
    const model = { active_variant_public_id: "lgn_1", pages: [{ page_id: "p1", slots: [] }] };

    s.addPage(model);

    expect(s.calls.length).toBe(1);
    expect(model.pages.length, "the phantom page is rolled back").toBe(1);
  });
});
