// LeadGen R2 P5-F3 — visitor-side address labels, dead CSS, truncated Other
// select (three small independent server-render/CSS items).
//
//   Item 1 (owner A.1 #6 Image8 "the mapping of what is auto-filled per
//   field should definatly be an option" / "this is poorly designed with
//   poor logic"): a multi-field address composite's sub-fields carried ONLY
//   attr("placeholder")/attr("aria-label") — placeholder text vanishes the
//   instant a visitor types, so a 4-field composite left every box unlabeled
//   to sighted visitors once filled. renderAddressFieldSet now ALSO renders
//   a real, for/id-associated <label> above each field — but ONLY when
//   specs.length > 1 (a genuine multi-field composite); the owner's two
//   PERFECT-graded single-field scenarios ((a) full_address free text, (b)
//   street-only) must stay byte-identical (captured baselines below, minted
//   from the PRE-this-change renderer).
//
//   Item 2: styles.ts's `.lg-address-composite` / `-composite-note` /
//   `-composite-fields` rules (the pre-D3 L-192 fallback's studio-only
//   decorative preview) are dead — no renderer has emitted those classes
//   since R2 P5 S5a (owner D3: the visitor now sees the REAL 4-field
//   composite, not a preview of one) — removed.
//
//   Item 3 (owner A.1 #8 "Other" dropdown on Buttons/Cards): the revealed
//   `.lg-other-select` was a direct grid item of the SAME .lg-answer-group/
//   .lg-card-grid the choices use, so .lg-input's width:100% only ever
//   filled ONE narrow track (the trigger's own column) — clipping long
//   authored option text. It now spans the full grid row instead.

import { describe, expect, it } from "vitest";
import { renderComponent } from "../src/public/leadgen/components/presets";
import type { LeadgenComponentNode } from "../src/public/leadgen/components/content-schema";
import { defaultFunnelDesign } from "../src/public/leadgen/designs/default-funnel/tokens";
import { funnelChromeCss, DEFAULT_FUNNEL_SCOPE } from "../src/public/leadgen/designs/default-funnel/styles";

const DESIGN = defaultFunnelDesign;

function addressNode(props: Record<string, unknown>): LeadgenComponentNode {
  return {
    type: "AddressAutocompleteQuestion",
    question_id: "q_addr",
    internal_field: "addr",
    props,
  } as LeadgenComponentNode;
}

// Byte-pin baselines captured from the PRE-fix renderer (git worktree
// leadgen-r2-p5 @ ecdd858, before this slice's presets.ts edit) via
// renderComponent(addressNode(...), DESIGN) — the regression guard for the
// owner's two PERFECT-graded single-field scenarios.
const FULL_ADDRESS_BASELINE =
  '<div class="lg-address" data-component-type="AddressAutocompleteQuestion" data-question-id="q_addr" data-internal-field="addr" data-answer-type="object" data-lg-question="q_addr" data-lg-field="addr" data-provider="google" data-lg-maps="{}"><input class="lg-input lg-address-input" type="text" data-lg-input autocomplete="street-address" placeholder="Start typing your address…" data-address-autocomplete="true"></div>';

const STREET_ONLY_BASELINE =
  '<div class="lg-address lg-address-fieldset" data-component-type="AddressAutocompleteQuestion" data-question-id="q_addr" data-internal-field="addr" data-answer-type="object" data-lg-question="q_addr" data-lg-field="addr" data-provider="google"><div class="lg-address-fields" style="display:flex;flex-direction:column;gap:0.5rem"><span class="lg-address-field-wrap" data-lg-field="addr_street" data-lg-maps="{&quot;enabled&quot;:true,&quot;jobs&quot;:{&quot;validate&quot;:false,&quot;auction&quot;:false,&quot;autocomplete&quot;:true},&quot;fills&quot;:{}}"><input class="lg-input" type="text" data-lg-input placeholder="Street address" aria-label="Street address" autocomplete="street-address" data-address-autocomplete="true"><p class="lg-error lg-error-auto" role="alert" aria-live="polite" hidden data-lg-error-for="addr_street" style="color:#D32F2F"></p></span></div></div>';

describe("P5-F3 item 1 — persistent per-field labels on the multi-field address composite (owner A.1 #6)", () => {
  it("the D3 unconfigured default (4-field composite) renders one visible <label> per field, for/id-associated, placeholder+aria-label kept", () => {
    const html = renderComponent(addressNode({}), DESIGN);
    const expectedLabels: Array<[string, string]> = [
      ["addr_street", "Street address"],
      ["addr_city", "City"],
      ["addr_state", "State"],
      ["addr_zip", "ZIP code"],
    ];
    const labelTags = html.match(/<label class="lg-address-field-label" for="[^"]*">[^<]*<\/label>/g) ?? [];
    expect(labelTags).toHaveLength(4);
    for (const [field, text] of expectedLabels) {
      const id = `lg-addr-${field}`;
      expect(html).toContain(`<label class="lg-address-field-label" for="${id}">${text}</label>`);
      const inputRe = new RegExp(
        `<input class="lg-input" type="text" data-lg-input id="${id}"[^>]*placeholder="${text}"[^>]*aria-label="${text}"`,
      );
      expect(html).toMatch(inputRe);
    }
  });
});

describe("P5-F3 item 1 scope guard — single-field branches stay byte-identical (owner scenarios (a)/(b), graded PERFECT)", () => {
  it("(a) full_address free-text single field renders EXACTLY as before — no label added", () => {
    const html = renderComponent(addressNode({ fields: [{ field: "full_address" }] }), DESIGN);
    expect(html).toBe(FULL_ADDRESS_BASELINE);
    expect(html).not.toContain("<label");
  });

  it("(b) a street-only single field set renders EXACTLY as before — no label, no new id added", () => {
    const html = renderComponent(addressNode({ fields: [{ field: "street", mode: "autofill" }] }), DESIGN);
    expect(html).toBe(STREET_ONLY_BASELINE);
    expect(html).not.toContain("<label");
    expect(html).not.toContain(' id="lg-addr-');
  });
});

describe("P5-F3 item 2 — dead .lg-address-composite* studio-preview CSS removed", () => {
  it("the compiled stylesheet no longer defines any .lg-address-composite* rule", () => {
    const css = funnelChromeCss(DESIGN);
    expect(css).not.toContain("lg-address-composite");
  });

  it("the untouched .lg-address-chip* rules (a different, out-of-scope artifact) still compile", () => {
    const css = funnelChromeCss(DESIGN);
    expect(css).toContain(`${DEFAULT_FUNNEL_SCOPE}.lg-preview .lg-address-chip{`);
  });
});

describe("P5-F3 item 3 — the visitor-side authored-Other <select> is no longer pinned to the trigger's one-column width (owner A.1 #8)", () => {
  it("the compiled stylesheet spans .lg-other-select across the full grid row instead of one column", () => {
    const css = funnelChromeCss(DESIGN);
    expect(css).toContain(`${DEFAULT_FUNNEL_SCOPE} select.lg-other-select{grid-column:1 / -1}`);
  });
});
