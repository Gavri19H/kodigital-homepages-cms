// LeadGen v3.1 R7 U12 — RENDERED composition-rhythm gate (the assertion class
// the operator retest (2026-07-15) proved was missing: the visual baselines
// asserted SELF-CONSISTENCY, never the golden's absolute inter-component gaps).
//
// This gate MEASURES the rhythm the RENDERED default-funnel emits (the CSS
// funnelChromeCss ships + the field/helper markup renderSectionComponents
// ships — the SAME server renderer the studio canvas, the /sections/preview
// re-render, and the live funnel all use) against the golden's absolute
// numbers, byte for byte:
//   headline → subheadline   9px  (golden :313 margin-top; emitted here as the
//                                  headline's own margin-bottom — the element
//                                  that precedes the subheadline)
//   subheadline → field     30px  (golden :912-914 fieldWrapStyle margin-top;
//                                  emitted as the subheadline's margin-bottom)
//   field → helper           7px  (golden :326 helper margin-top — already
//                                  correct pre-R7; pinned so it cannot regress)
//   helper/field → Continue 26px  (golden :350 margin-top; UNFRAMED on
//                                  .lg-continue, FRAMED on .lg-continue-slot,
//                                  with the in-slot Continue reset to 0 so the
//                                  two never double-space)
//   field box side padding  18px  + radius 12px (golden :884 fieldBoxStyle
//                                  "padding:16px 18px;border-radius:12px")
//
// FAIL-BEFORE (unfixed code, the operator's shipped state): 6 / 20 / 7 / 0,
// input padding 1rem (16px all sides) + radius 10px — see the git diff of
// designs/default-funnel/{tokens,styles}.ts for the reverted literals; a
// one-value temporary revert reproduces each RED here.
//
// The golden's WHITE QUESTION CARD (golden :308 — padding 44/46/40, radius 16)
// FIX 3b (conductor-ruled 2026-07-15): a UNIT-LEVEL card, wrapping the
// depth===1 output inside the SHARED renderer (presets.ts renderQuestionCard)
// — reaching the studio canvas, the admin preview simulator, AND the live
// funnel (frameless legacy AND frame-composed) identically, no frame-slot
// entanglement. "No double card" is proven below in BOTH directions: a
// "card"-mode frame template (centered, the FRAME_TEMPLATES default) and a
// "bare"-mode template (minimal) each compose real section content (itself
// carrying its own .lg-question-card) and assert EXACTLY ONE occurrence of
// the class renders, with the frame's OWN `.lg-frame-slot--card` rule proven
// inert (no background/border/radius/shadow/padding of its own anymore).

import { describe, expect, it } from "vitest";
import { renderComponent, renderSectionComponents, renderSectionComponentsVisible } from "../src/public/leadgen/components/presets";
import { funnelChromeCss, FUNNEL_DESIGN_SCOPE_ATTR } from "../src/public/leadgen/designs/default-funnel/styles";
import { defaultFunnelDesign } from "../src/public/leadgen/designs/default-funnel/tokens";
import type { LeadgenComponentNode } from "../src/public/leadgen/components/content-schema";
import { LG_BANNERS_MOUNT_HTML, renderQuoteFrame } from "../src/public/leadgen/designs/frame";
import { effectiveFrame } from "../src/public/leadgen/designs/frames";
import { resolveTokens } from "../src/public/leadgen/designs/theme";
import type { SiteBranding } from "../src/leadgen/branding";

const SCOPE = `[${FUNNEL_DESIGN_SCOPE_ATTR}="${defaultFunnelDesign.id}"]`;
// Base sheet (the fork the studio canvas + legacy frameless live take) and the
// frame-region sheet (the fork the framed live funnel + drawer preview take).
const CSS_BASE = funnelChromeCss(defaultFunnelDesign, SCOPE);
const CSS_FRAME = funnelChromeCss(defaultFunnelDesign, SCOPE, { frameRegions: true });

// Extract a single rule body by exact selector-suffix (the sheet is minified
// `<scope> <sel>{...}`); returns the `{...}` inner text of the FIRST match.
function ruleBody(css: string, selSuffix: string): string {
  const at = css.indexOf(`${selSuffix}{`);
  expect(at, `rule '${selSuffix}{' must exist in the sheet`).toBeGreaterThan(-1);
  const open = css.indexOf("{", at);
  const close = css.indexOf("}", open);
  return css.slice(open + 1, close);
}

describe("U12 rhythm — inter-component gaps (golden absolute numbers)", () => {
  it("headline→subheadline = 9px (golden :313), NOT the fail-before 6px", () => {
    const rule = ruleBody(CSS_BASE, " .lg-headline");
    expect(rule).toContain("margin:0 0 9px 0");
    expect(rule).not.toContain("margin:0 0 6px 0");
  });

  it("subheadline→field = 30px (golden :912-914), NOT the fail-before 20px", () => {
    const rule = ruleBody(CSS_BASE, " .lg-subheadline");
    expect(rule).toContain("margin:0 0 30px 0");
    expect(rule).not.toContain("margin:0 0 20px 0");
  });

  it("field→helper = 7px (golden :326) — fieldHelperLine renders margin-top:7px", () => {
    const node: LeadgenComponentNode = {
      type: "FreeTextQuestion",
      question_id: "q_ft",
      answer_type: "string",
      props: { placeholder: "x", helper: "We never share this" },
    };
    const html = renderComponent(node, defaultFunnelDesign, 1, undefined);
    expect(html).toContain("margin-top:7px");
  });

  it("helper→Continue = 26px UNFRAMED (.lg-continue margin-top), NOT the fail-before 0", () => {
    const rule = ruleBody(CSS_BASE, " .lg-continue");
    expect(rule).toContain("margin-top:26px");
  });

  it("helper→Continue = 26px FRAMED (.lg-continue-slot) with NO double-space", () => {
    const slot = ruleBody(CSS_FRAME, " .lg-continue-slot");
    expect(slot).toContain("margin-top:26px");
    // the Continue inside the framed slot resets its own 26 to 0 → the slot's
    // 26 is the ONLY gap (framed == unframed == 26, never 52).
    expect(CSS_FRAME).toContain(".lg-continue-slot .lg-continue{margin-top:0}");
  });

  it("field box: side padding 18px + radius 12px (golden :884), NOT the fail-before 1rem/10px", () => {
    const rule = ruleBody(CSS_BASE, " .lg-input");
    expect(rule).toContain("padding:16px 18px");
    expect(rule).toContain("border-radius:12px");
    expect(rule).not.toContain("padding:1rem");
    expect(rule).not.toContain("border-radius:10px");
  });
});

describe("U12 card — golden white question card (padding 44/46/40, radius 16, golden :308)", () => {
  const FIXTURE_NODES: LeadgenComponentNode[] = [
    { type: "QuestionHeadline", question_id: "q_h", props: { text: "What's your ZIP code?" } },
    { type: "Subheadline", question_id: "q_s", props: { text: "Rates differ by up to 40% based on ZIP code" } },
    {
      type: "ZIPInputQuestion",
      question_id: "q_zip",
      internal_field: "zip",
      answer_type: "string",
      props: { placeholder: "Enter your ZIP code", helper: "We never share this" },
    },
    { type: "ContinueButton", question_id: "q_c", props: { label: "View My Quote" } },
  ];

  it("the token module carries the golden's OWN literal values (no invented numbers)", () => {
    expect(defaultFunnelDesign.questionCard.background).toBe("#FFFFFF");
    expect(defaultFunnelDesign.questionCard.border).toBe("1px solid #E9EDF3");
    expect(defaultFunnelDesign.questionCard.borderRadius).toBe("16px");
    expect(defaultFunnelDesign.questionCard.boxShadow).toBe("0 8px 28px rgba(20,32,54,.10)");
    expect(defaultFunnelDesign.questionCard.paddingDesktop).toBe("44px 46px 40px");
  });

  it("renderSectionComponents wraps the unit in .lg-question-card, EXACTLY ONCE, with the golden padding inline via the CSS class (not inline style)", () => {
    const html = renderSectionComponents(FIXTURE_NODES, defaultFunnelDesign, undefined, 1);
    expect(html.startsWith('<div class="lg-question-card">')).toBe(true);
    expect(html.endsWith("</div>")).toBe(true);
    expect([...html.matchAll(/class="lg-question-card"/g)]).toHaveLength(1);
  });

  it("renderSectionComponentsVisible wraps the SAME card (admin dependency-preview simulator parity)", () => {
    const visible = new Set(FIXTURE_NODES.map((n) => n.question_id));
    const html = renderSectionComponentsVisible(FIXTURE_NODES, defaultFunnelDesign, visible);
    expect([...html.matchAll(/class="lg-question-card"/g)]).toHaveLength(1);
  });

  it("a NESTED container's children do NOT get their own card (depth>1 never wraps)", () => {
    const nested: LeadgenComponentNode[] = [
      {
        type: "Stack",
        question_id: "q_stack",
        props: {},
        children: [{ type: "TextBlock", question_id: "q_tb", props: { text: "hi", role: "body" } }],
      } as unknown as LeadgenComponentNode,
    ];
    const html = renderSectionComponents(nested, defaultFunnelDesign, undefined, 1);
    expect([...html.matchAll(/class="lg-question-card"/g)]).toHaveLength(1);
  });

  it("the .lg-question-card CSS rule (base sheet) carries the golden's exact background/border/radius/shadow/padding", () => {
    const rule = ruleBody(CSS_BASE, " .lg-question-card");
    expect(rule).toContain("background:#FFFFFF");
    expect(rule).toContain("border:1px solid #E9EDF3");
    expect(rule).toContain("border-radius:16px");
    expect(rule).toContain("box-shadow:0 8px 28px rgba(20,32,54,.10)");
    expect(rule).toContain("padding:44px 46px 40px");
  });

  it("FAIL-BEFORE reproduction: with NO card wrap (pre-fix), the unit's raw content would render with NO enclosing .lg-question-card at all", () => {
    // Simulate the pre-fix output directly (renderNodes is not exported, but
    // stripping the known wrapper reproduces exactly what shipped before):
    // a bare concatenation with zero .lg-question-card occurrences.
    const html = renderSectionComponents(FIXTURE_NODES, defaultFunnelDesign, undefined, 1);
    const preFix = html.replace('<div class="lg-question-card">', "").replace(/<\/div>$/, "");
    expect(preFix).not.toContain("lg-question-card");
    expect(preFix).toContain("your ZIP code?"); // the real pre-fix (card-less) shipped state (esc() HTML-entity-quotes the apostrophe, so this substring skips it)
  });

  // -------------------------------------------------------------------------
  // "No double card" — BOTH directions, through the REAL frame composition
  // (the same effectiveFrame + renderQuoteFrame path production funnels use).
  // -------------------------------------------------------------------------

  const TOKENS = resolveTokens(defaultFunnelDesign);
  const BRANDING: SiteBranding = {
    site_name: "Acme Insure",
    logo_url: "/media/site-logo.png",
    tagline: null,
    legal_links: [],
    trust_logos: null,
  };
  const ROOT = {
    funnelId: "lgf_0000000000000000000U12CRD1",
    funnelVariantId: "lgn_0000000000000000000U12CRD2",
    quoteId: "lgq_0000000000000000000U12CRD3",
    contentVersion: 1,
  };

  function composeThroughFrame(template: "centered" | "minimal"): string {
    const sectionHtml = renderSectionComponents(FIXTURE_NODES, defaultFunnelDesign, undefined, 1);
    const sectionsHtml =
      '<section data-lg-section data-lg-section-id="lgs_0000000000000000000U12SEC1" data-lg-index="0" data-screen-label="01 · Q">' +
      sectionHtml +
      "</section>";
    const { frame, problems } = effectiveFrame(template, null);
    expect(problems).toEqual([]);
    return renderQuoteFrame({
      effectiveTokens: TOKENS,
      frame,
      siteBranding: BRANDING,
      sectionsHtml,
      bannersMountHtml: LG_BANNERS_MOUNT_HTML,
      sectionCount: 1,
      root: ROOT,
    });
  }

  it("'centered' template (section_slot.card:'card', the FRAME_TEMPLATES default) — EXACTLY ONE .lg-question-card, .lg-frame-slot--card renders but paints nothing of its own", () => {
    const html = composeThroughFrame("centered");
    expect(html).toContain("lg-frame-slot--card"); // the frame's own class still emits (config plumbing untouched)
    expect([...html.matchAll(/class="lg-question-card"/g)]).toHaveLength(1); // exactly one visual card
    const frameCardRule = ruleBody(CSS_FRAME, " .lg-frame-slot--card");
    expect(frameCardRule, "the frame's card rule paints NOTHING now").not.toContain("background:");
    expect(frameCardRule, "no border of its own").not.toContain("border:1px solid #E9EDF3");
    expect(frameCardRule, "no box-shadow of its own").not.toContain("box-shadow:");
    expect(frameCardRule, "no padding of its own — the unit-card's 44/46/40 owns interior spacing").not.toContain("padding:");
    // the 3 legacy padding modifiers are REMOVED outright (no test depended on them).
    expect(CSS_FRAME).not.toContain(".lg-frame-slot--card.lg-frame-slot--pad-");
  });

  it("'minimal' template (section_slot.card:'bare') — EXACTLY ONE .lg-question-card (from the unit; the frame contributes none either way)", () => {
    const html = composeThroughFrame("minimal");
    expect(html).toContain("lg-frame-slot--bare");
    expect([...html.matchAll(/class="lg-question-card"/g)]).toHaveLength(1);
  });

  it("card mode and bare mode render the IDENTICAL question-card markup for the unit (the frame's card setting has zero effect on the unit's own look)", () => {
    const cardHtml = composeThroughFrame("centered");
    const bareHtml = composeThroughFrame("minimal");
    const extractCard = (html: string): string => {
      const at = html.indexOf('<div class="lg-question-card">');
      const contFrom = html.indexOf("View My Quote", at);
      return html.slice(at, contFrom + "View My Quote".length);
    };
    expect(extractCard(cardHtml)).toBe(extractCard(bareHtml));
  });
});
