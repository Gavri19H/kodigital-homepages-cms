// Section Builder v3.1 REMEDIATION — phase R5, STAGE A2 "state-safe border"
// grant (forensic-defect-register.md R3a ROUTING NOTES + conductor grant 2):
// presets.ts's choiceItemStyle (buttons/cards) now emits a per-node
// design_overrides.border_color role through the `--lg-field-border` CUSTOM
// PROPERTY — the SAME state-safe idiom the dropdown/text-input family
// (fieldStyleAttr/appearanceStyleEntries) already used — instead of a direct
// inline `border-color`. A direct inline value would beat
// designs/default-funnel/styles.ts's `.lg-btn.lg-btn-answer:hover` /
// `[aria-checked="true"]` / `[data-selected="true"]` / `.lg-card:hover` /
// `[data-selected="true"]` state rules by specificity (inline always wins
// over a class/pseudo-class/attribute selector without !important),
// silently losing hover/selected feedback on any item with an authored
// border_color. This is the two-part effect-assert the conductor's grant
// requires: (1) set border role → the rendered node's base border reads the
// role color via --lg-field-border, never a direct border-color; (2) the
// generated stylesheet's hover/selected rules still repaint with their OWN
// direct color, unaffected by whatever --lg-field-border resolves to.
import { describe, expect, it } from "vitest";
import { renderComponent } from "../src/public/leadgen/components/presets";
import type { LeadgenComponentNode } from "../src/public/leadgen/components/content-schema";
import { defaultFunnelDesign } from "../src/public/leadgen/designs/default-funnel/tokens";
import { funnelChromeCss, DEFAULT_FUNNEL_SCOPE } from "../src/public/leadgen/designs/default-funnel/styles";

const DESIGN = defaultFunnelDesign;
const BRAND = "#1B3A5C"; // design.color.primary (= iconCard.hoverBorderColor/selectedBorderColor)
const NEUTRAL = "#D2D9E5"; // design.color.border (the base rule's var() fallback)

function node(type: string, extra: Record<string, unknown> = {}): LeadgenComponentNode {
  return {
    type,
    question_id: "q_" + type,
    internal_field: "f_" + type,
    answer_type: "string",
    choices: [
      { label: "Alpha", value: "a" },
      { label: "Beta", value: "b" },
    ],
    props: { yesLabel: "Yes", noLabel: "No" },
    ...extra,
  } as unknown as LeadgenComponentNode;
}

// Pulls a rule's declaration body out of the generated stylesheet text by
// selector-prefix search (avoids RegExp.prototype.exec — this file's static
// scanner flags the substring "exec(" regardless of receiver type).
function ruleBodyOf(css: string, selectorPrefix: string): string | null {
  const at = css.indexOf(`${selectorPrefix}{`);
  if (at === -1) return null;
  const start = at + selectorPrefix.length + 1;
  const end = css.indexOf("}", start);
  return end === -1 ? null : css.slice(start, end);
}

describe("R5 state-safe border — part 1: per-node render (presets.ts choiceItemStyle)", () => {
  it("ButtonAnswerGroup: border_color=brand rides --lg-field-border, never a direct border-color", () => {
    const html = renderComponent(node("ButtonAnswerGroup", { design_overrides: { border_color: "brand" } }), DESIGN);
    expect(html, "role color reaches the node via the custom property").toContain(`--lg-field-border:${BRAND}`);
    expect(html, "no direct border-color anywhere on the node").not.toContain(`border-color:${BRAND}`);
  });
  it("IconCardAnswerGrid: border_color=brand rides --lg-field-border, never a direct border-color", () => {
    const html = renderComponent(node("IconCardAnswerGrid", { design_overrides: { border_color: "brand" } }), DESIGN);
    expect(html, "role color reaches the node via the custom property").toContain(`--lg-field-border:${BRAND}`);
    expect(html, "no direct border-color anywhere on the node").not.toContain(`border-color:${BRAND}`);
  });
  it("no design_overrides.border_color authored ⇒ NO --lg-field-border emitted at all (byte-identical to pre-R5)", () => {
    const btnHtml = renderComponent(node("ButtonAnswerGroup"), DESIGN);
    const cardHtml = renderComponent(node("IconCardAnswerGrid"), DESIGN);
    expect(btnHtml).not.toContain("--lg-field-border");
    expect(cardHtml).not.toContain("--lg-field-border");
  });
});

describe("R5 state-safe border — part 2: the generated stylesheet's state rules still repaint", () => {
  const css = funnelChromeCss(DESIGN, DEFAULT_FUNNEL_SCOPE);

  it("the .lg-btn.lg-btn-answer BASE rule reads border-color through the var(), fallback = color.border (neutral)", () => {
    expect(css, "base rule is state-safe (var-driven), not a bare hex").toContain(
      `border-color:var(--lg-field-border, ${NEUTRAL})`,
    );
  });
  it("the .lg-card BASE rule reads border-color through the SAME var()/fallback idiom", () => {
    expect(css).toContain(`border-color:var(--lg-field-border, ${NEUTRAL})`);
  });
  it("EFFECT-ASSERT: .lg-btn.lg-btn-answer:hover still sets its OWN direct border-color — wins over the base var() regardless of any per-node override", () => {
    const body = ruleBodyOf(css, ".lg-btn.lg-btn-answer:hover");
    expect(body, "hover rule exists in the generated stylesheet").not.toBeNull();
    expect(body, "hover sets a DIRECT border-color (not a var reference)").toContain(`border-color:${BRAND}`);
    expect(body).not.toContain("var(--lg-field-border");
  });
  it('EFFECT-ASSERT: .lg-btn.lg-btn-answer[aria-checked="true"]/[data-selected="true"]/.lg-selected still sets its OWN direct border-color', () => {
    // P2b FIX-ROUND R2 (adversarial review): the selector grew a third
    // alternative, .lg-selected (the live runtime's real selection marker) —
    // the full 3-part selector prefix is required to find the rule now.
    const body = ruleBodyOf(
      css,
      '.lg-btn.lg-btn-answer[aria-checked="true"], [data-funnel-design="default-funnel"] .lg-btn.lg-btn-answer[data-selected="true"], [data-funnel-design="default-funnel"] .lg-btn.lg-btn-answer.lg-selected',
    );
    expect(body, "selected rule exists in the generated stylesheet").not.toBeNull();
    expect(body).toContain(`border-color:${BRAND}`);
  });
  it("EFFECT-ASSERT: .lg-card:hover still sets its OWN direct border-color", () => {
    const body = ruleBodyOf(css, ".lg-card:hover");
    expect(body, "card hover rule exists").not.toBeNull();
    expect(body).toContain(`border-color:${BRAND}`);
    expect(body).not.toContain("var(--lg-field-border");
  });
  it('EFFECT-ASSERT: .lg-card[aria-checked="true"]/[data-selected="true"]/.lg-selected still sets its OWN direct border-color', () => {
    // P2b FIX-ROUND R2: the SAME .lg-selected growth as the button selector above.
    const body = ruleBodyOf(
      css,
      '.lg-card[aria-checked="true"], [data-funnel-design="default-funnel"] .lg-card[data-selected="true"], [data-funnel-design="default-funnel"] .lg-card.lg-selected',
    );
    expect(body, "card selected rule exists").not.toBeNull();
    expect(body).toContain(`border-color:${BRAND}`);
  });
  it("source-order sanity: the base rule text precedes its :hover rule text for both families (CSS cascade tie-break, belt-and-braces alongside the specificity proof above)", () => {
    const btnBaseAt = css.indexOf(".lg-btn.lg-btn-answer{");
    const btnHoverAt = css.indexOf(".lg-btn.lg-btn-answer:hover{");
    expect(btnBaseAt).toBeGreaterThan(-1);
    expect(btnHoverAt).toBeGreaterThan(btnBaseAt);
    const cardBaseAt = css.indexOf(".lg-card{");
    const cardHoverAt = css.indexOf(".lg-card:hover{");
    expect(cardBaseAt).toBeGreaterThan(-1);
    expect(cardHoverAt).toBeGreaterThan(cardBaseAt);
  });
});
