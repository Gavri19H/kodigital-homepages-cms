// ===========================================================================
// R2 P8-4 FIX ROUND F9 — `section_slot.card:"bare"` REALLY REMOVES THE QUESTION
// UNIT'S SURFACE, ON THE THREE SHIPPED TEMPLATES THAT ASK FOR IT.
//
// WHY THIS FILE EXISTS. F8 added one rule to the funnel sheet
// (designs/default-funnel/styles.ts, `.lg-frame-slot--bare .lg-question-card`)
// so that `section_slot.card` — a control the operator IS offered
// (quotes-tabs/templates.ts:2190 prints "Card layout" / "Bare layout" on the
// saved-template summary) — stops being a DEAD control under §4 R3 ("a control
// that cannot be honoured must not be offered"). It shipped with a
// "no-op at the shipped defaults" rationale, which was WRONG: THREE of the six
// built-in FrameTemplateDefs ship `section_slot.card:"bare"` (header-footer,
// white-trust, minimal — designs/frames.ts FRAME_TEMPLATES), so honouring the
// control necessarily changes what those three paint. A fresh-context reviewer
// drove it and measured the change on a live page
// (docs/leadgen/r2/evidence/p8/review-p8-4b/j10-header-footer-AFTER-F8-1280.png
// and -375.png: background rgba(0,0,0,0), border-color rgba(0,0,0,0),
// border-radius 0px, box-shadow none at BOTH widths).
//
// THE FROZEN BASELINE THAT NOW DISAGREES, NAMED. The committed §15.4 pair
//   api/test-ui/__screenshots__/leadgen-v25/pattern-b-desktop.png
//   api/test-ui/__screenshots__/leadgen-v25/pattern-b-mobile.png
// is captured from a fixture seeded `template: "header-footer"`
// (api/test-ui/leadgen-patterns-v25.spec.ts, `seedPatternQuote(... frame: {
// version: 1, template: "header-footer", … })`, shot with maxDiffPixels: 200)
// and shows that same question unit as an OPAQUE WHITE CARD with a 16px radius
// and a drop shadow. Those pixels were captured while `bare` painted NOTHING —
// i.e. the baseline froze the defect. It is EXPECTED to disagree now, and this
// round does NOT rebaseline it and does NOT relax maxDiffPixels: the visual
// change to three shipped templates is an owner visual-QA decision, recorded by
// the conductor. This file is where the INTENDED rendering is asserted in the
// meantime, at computed-value level, so the gate can see it even though the
// phase gate runs no Playwright.
//
// NOTHING IS HAND-BUILT ON EITHER SIDE (E10/E11). The template set is read out
// of the REAL FRAME_TEMPLATES registry, the config out of the REAL
// effectiveFrame(), the markup out of the REAL renderQuoteFrame() +
// renderSectionComponents(), the sheet out of the REAL funnelChromeCss(), and
// the values are what test/helpers/leadgen-visible-paint.ts's cascade resolver
// computes for the element the markup really contains — the same machinery the
// M2/R3 sweep uses. It is a static resolver, not a browser: it reports the
// WINNING DECLARATION per property and does not expand shorthands, so a `bare`
// card shows BOTH the base `border: 1px solid #E9EDF3` and the winning
// `border-color: transparent` longhand (which is what a browser resolves to the
// reviewer's `rgba(0,0,0,0)`). Both are asserted, with the selector that won.
// ===========================================================================

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { visiblePage, type PaintedEl, type Viewport } from "./helpers/leadgen-visible-paint";

import { renderSectionComponents } from "../src/public/leadgen/components/presets";
import type { LeadgenComponentNode } from "../src/public/leadgen/components/content-schema";
import { DEFAULT_FUNNEL_SCOPE, funnelChromeCss } from "../src/public/leadgen/designs/default-funnel/styles";
import { defaultFunnelDesign } from "../src/public/leadgen/designs/default-funnel/tokens";
import { LG_BANNERS_MOUNT_HTML, renderQuoteFrame } from "../src/public/leadgen/designs/frame";
import { effectiveFrame, FRAME_TEMPLATES } from "../src/public/leadgen/designs/frames";
import type { FrameTemplateId } from "../src/public/leadgen/designs/frames";
import { resolveTokens } from "../src/public/leadgen/designs/theme";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PATTERNS_SPEC = path.join(HERE, "..", "test-ui", "leadgen-patterns-v25.spec.ts");

const NODES = [
  { type: "QuestionHeadline", question_id: "f9_h", bind: "section_headline" },
  { type: "FreeTextQuestion", question_id: "f9_text", question_key: "sw", internal_field: "sw" },
  { type: "ContinueButton", question_id: "f9_continue" },
] as unknown as LeadgenComponentNode[];

/** The REAL sheet + the REAL markup for one built-in template, no overrides. */
function templatePage(template: FrameTemplateId): { css: string; html: string } {
  const tokens = resolveTokens(defaultFunnelDesign);
  const css = funnelChromeCss(tokens.design, DEFAULT_FUNNEL_SCOPE, { frameRegions: true });
  const { frame, problems } = effectiveFrame(template);
  expect(
    problems.filter((p) => p.severity === "error"),
    `${template} validates: ${JSON.stringify(problems)}`,
  ).toEqual([]);
  const sections = renderSectionComponents(NODES, tokens.design as typeof defaultFunnelDesign, {
    headline_text: "F9 headline",
    theme_controls: tokens.theme_controls,
    continue_placement: frame.section_slot.continue_placement,
  } as never);
  const html = renderQuoteFrame({
    effectiveTokens: tokens,
    frame,
    siteBranding: null,
    sectionsHtml: sections,
    bannersMountHtml: LG_BANNERS_MOUNT_HTML,
    sectionCount: 3,
    root: {
      funnelId: "lgf_00000000000000000000F9001",
      funnelVariantId: "lgn_00000000000000000000F9002",
      quoteId: "lgq_00000000000000000000F9003",
      contentVersion: 1,
    },
  });
  return { css, html };
}

/** The one `.lg-question-card` a visitor can see, at one viewport. */
function questionCard(template: FrameTemplateId, viewport: Viewport): PaintedEl {
  const { css, html } = templatePage(template);
  expect(html.match(/class="lg-question-card"/g), `${template}: one question unit`).toHaveLength(1);
  const page = visiblePage(css, html, viewport);
  const card = page.visible.find((v) => v.classes.includes("lg-question-card"));
  expect(card, `${template} @${viewport}: the question unit is a VISIBLE element`).toBeDefined();
  return card as PaintedEl;
}

const won = (card: PaintedEl, prop: string): string | undefined => card.style.get(prop)?.value;
const wonBy = (card: PaintedEl, prop: string): string | undefined => card.style.get(prop)?.selector;

// The four surface tokens (designs/default-funnel/tokens.ts `questionCard`).
const CARD_SURFACE = {
  background: "#FFFFFF",
  "border-radius": "16px",
  "box-shadow": "0 8px 28px rgba(20,32,54,.10)",
  border: "1px solid #E9EDF3",
} as const;

const VIEWPORTS: readonly Viewport[] = ["desktop", "mobile"];

// ---------------------------------------------------------------------------

describe("R2 P8-4 F9 — the shipped `bare` templates and the frozen baseline they move", () => {
  it("the bare set is READ OUT of the registry, not typed here — three of the six built-ins", () => {
    const bare = (Object.keys(FRAME_TEMPLATES) as FrameTemplateId[])
      .filter((id) => effectiveFrame(id).frame.section_slot.card === "bare")
      .sort();
    const cardMode = (Object.keys(FRAME_TEMPLATES) as FrameTemplateId[])
      .filter((id) => effectiveFrame(id).frame.section_slot.card === "card")
      .sort();
    // eslint-disable-next-line no-console
    console.log(`[F9 bare] bare templates ${JSON.stringify(bare)} · card templates ${JSON.stringify(cardMode)}`);
    expect(bare).toEqual(["header-footer", "minimal", "white-trust"]);
    expect(cardMode).toEqual(["centered", "full-background", "header-cta"]);
    // Every built-in is in exactly one of the two sets — a seventh template
    // tomorrow lands in one of these lists and this leg says which.
    expect([...bare, ...cardMode].sort()).toEqual(Object.keys(FRAME_TEMPLATES).sort());
  });

  for (const template of ["header-footer", "white-trust", "minimal"] as const) {
    for (const viewport of VIEWPORTS) {
      it(`${template} @${viewport}: the question unit has NO surface — background, border colour, corners and shadow are all removed`, () => {
        const card = questionCard(template, viewport);
        // eslint-disable-next-line no-console
        console.log(
          `[F9 bare] ${template} ${viewport} ::`,
          JSON.stringify(["background", "border", "border-color", "border-radius", "box-shadow"].map((p) => [p, won(card, p) ?? null])),
        );
        expect(won(card, "background"), "no fill").toBe("transparent");
        expect(won(card, "border-color"), "no visible edge").toBe("transparent");
        expect(won(card, "border-radius"), "no corners").toBe("0");
        expect(won(card, "box-shadow"), "no lift").toBe("none");
        // …and all four are won by the ONE `--bare` rule, not by a theme, a
        // media block or an accident of ordering.
        for (const prop of ["background", "border-color", "border-radius", "box-shadow"]) {
          expect(wonBy(card, prop), `${prop} is won by the bare rule`).toContain(".lg-frame-slot--bare .lg-question-card");
        }
        // The base shorthand is still declared and is still what the longhand
        // overrides — the geometry (1px of border box, and the padding) is
        // deliberately untouched so a card/bare switch never reflows the page.
        expect(won(card, "border")).toBe(CARD_SURFACE.border);
        expect(won(card, "padding"), "the unit's own padding is NOT part of the surface removal").toBeDefined();
      });
    }
  }

  for (const template of ["centered", "full-background", "header-cta"] as const) {
    for (const viewport of VIEWPORTS) {
      it(`${template} @${viewport}: the OTHER direction — a card-mode template still paints the full surface`, () => {
        const card = questionCard(template, viewport);
        for (const [prop, value] of Object.entries(CARD_SURFACE)) {
          expect(won(card, prop), `${template} ${viewport} ${prop}`).toBe(value);
        }
        expect(won(card, "border-color"), "no bare override reaches a card template").toBeUndefined();
      });
    }
  }

  it("the FROZEN baseline this change moves is named, and it really is seeded with a bare template", () => {
    // Grounding the prose in the banner: the pattern-b pair is captured from a
    // `header-footer` fixture, and `header-footer` is in the bare set above —
    // so the disagreement is expected, specific, and owner-owned. This leg
    // reads the spec's SOURCE; it neither runs Playwright nor touches a PNG.
    const spec = readFileSync(PATTERNS_SPEC, "utf8");
    expect(spec).toContain(`template: "header-footer"`);
    // The pair's file names are composed by visualPage() from the base name
    // ("pattern-b") + the two viewports, so the source carries the base name
    // and the `-desktop.png` / `-mobile.png` composition, not the literals.
    expect(spec).toContain(`"pattern-b"`);
    expect(spec).toContain("`${base}-desktop.png`");
    expect(spec).toContain("`${base}-mobile.png`");
    expect(spec).toContain("const MAX_DIFF_PIXELS = 200;");
    const bareIds = (Object.keys(FRAME_TEMPLATES) as FrameTemplateId[]).filter(
      (id) => effectiveFrame(id).frame.section_slot.card === "bare",
    );
    expect(bareIds, "the frozen pair's own template is one of the three this change moves").toContain("header-footer");
  });
});
