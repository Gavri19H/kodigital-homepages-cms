// R2 P3 tail-2 (item 2) — the footer-picker DOM/loader co-shipping guard.
//
// quotes-tabs/funnel.ts's QUOTE_EDITOR_SCRIPT (the "G: footer.blocks"
// section) reads and writes footer.blocks/pick-row DOM it never renders.
// quotes-tabs/templates.ts is the box's SOLE renderer (renderTemplatesTabPanel
// -> renderSettingsColumn -> the footer box + its footer_pick_row <template>),
// and it is ALSO the sole owner of the bespoke "Load pages from the preview
// site…" fetch (data-footer-picks-load / fetchFooterPicks) — a piece the
// generic data-tplbox-* delegation funnel.ts otherwise owns (per that file's
// OWN top-of-file doc comment) does not cover. funnel.ts ships NO handler of
// its own for that button; it depends on templates.ts's TPL_SCRIPT shipping
// on the SAME page.
//
// That dependency is safe BY CONSTRUCTION, not by load-order luck:
// ui-quotes.ts (out of this slice) concatenates renderBuilderPanel(...)
// (funnel.ts) and renderTemplatesTabPanel(...) (templates.ts) unconditionally
// and synchronously into ONE response, on EVERY
// /admin/leadgen/quotes/:id/edit render — see the doc comments both files now
// carry at their script declarations. This file pins every fact that
// construction-safety claim rests on, read directly off the REAL exported
// production strings/source (never a hand-retyped duplicate — E11), so a
// future edit that silently breaks the pairing (the handler moved/removed,
// the DOM renamed, or the two panel calls in ui-quotes.ts made conditional)
// fails HERE instead of leaving a dead "Load pages…" button in production.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { QUOTE_EDITOR_SCRIPT } from "../src/admin/leadgen/quotes-tabs/funnel";
import { renderTemplatesTabPanel } from "../src/admin/leadgen/quotes-tabs/templates";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));

describe("R2 P3 tail-2 (item 2) — footer-picker DOM/loader co-shipping", () => {
  const panel = renderTemplatesTabPanel(true, []);

  it("funnel.ts's island reads/writes the shared footer.blocks + pick-row DOM (the documented cross-island dependency)", () => {
    expect(QUOTE_EDITOR_SCRIPT).toContain("tplList('footer.blocks')");
    expect(QUOTE_EDITOR_SCRIPT).toContain("data-footer-block-row");
    expect(QUOTE_EDITOR_SCRIPT).toContain("data-footer-pick-row");
    expect(QUOTE_EDITOR_SCRIPT).toContain("data-footer-block-picks");
  });

  it("funnel.ts ships NO handler of its own for the 'Load pages…' button — it depends on templates.ts's script (the documented gap, not a silent one)", () => {
    expect(QUOTE_EDITOR_SCRIPT).not.toContain("data-footer-picks-load");
    expect(QUOTE_EDITOR_SCRIPT).not.toContain("fetchFooterPicks");
  });

  it("templates.ts renders the button AND wires its fetch, in the SAME returned page string", () => {
    expect(panel).toContain("data-footer-picks-load");
    expect(panel).toContain("fetchFooterPicks(el)");
    expect(panel).toContain("el.closest('[data-footer-picks-load]')");
  });

  it("templates.ts renders the EXACT DOM funnel.ts's collectors expect (the footer.blocks list + the footer_pick_row template)", () => {
    expect(panel).toContain('data-tplbox-list="footer.blocks"');
    expect(panel).toContain('data-tplbox-tpl="footer.blocks"');
    expect(panel).toContain('data-tplbox-tpl="footer_pick_row"');
    expect(panel).toContain("data-footer-pick-row");
    expect(panel).toContain("data-footer-block-picks");
  });

  it("ui-quotes.ts concatenates renderBuilderPanel(...) and renderTemplatesTabPanel(...) unconditionally into the SAME response (the structural fact the co-shipping proof rests on)", () => {
    const uiQuotesSrc = readFileSync(join(TEST_DIR, "../src/admin/leadgen/ui-quotes.ts"), "utf8");
    const builderAt = uiQuotesSrc.indexOf("${renderBuilderPanel(");
    const templatesAt = uiQuotesSrc.indexOf("${renderTemplatesTabPanel(");
    expect(builderAt, "renderBuilderPanel(...) call site must exist").toBeGreaterThan(-1);
    expect(templatesAt, "renderTemplatesTabPanel(...) call site must exist").toBeGreaterThan(-1);
    expect(templatesAt, "renderTemplatesTabPanel must follow renderBuilderPanel").toBeGreaterThan(builderAt);
    const between = uiQuotesSrc.slice(builderAt, templatesAt);
    // Both interpolations must sit inside the SAME unconditional template
    // literal, adjacent lines apart — no `if (`/ternary/short-circuit that
    // could ship one panel (and its script) without the other.
    expect(between, "no conditional/branch between the two panel calls").not.toMatch(/\bif\s*\(|\?[^:]*:|&&|\|\|/);
    expect(between.length, "the two calls are adjacent lines, not distant branches").toBeLessThan(200);
  });
});
