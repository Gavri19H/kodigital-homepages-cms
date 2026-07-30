// LeadGen R2 P5 tail round — S5c coherence items 1+2.
//
//   Item 1 (owner A.1 #6 "the mapping of what is auto-filled per field
//   should definatly be an option"): renderAddressFieldSet's autocomplete
//   field hardcoded jobs.validate:false, ignoring an operator-authored
//   jobs.validate — fixed to reuse mapsJobsFor(node), the SAME per-field
//   precedence every other Maps-enabled renderer in this file already uses.
//
//   Item 2 (picker≠render class, different guise): preview-sim.ts's
//   markSelectionInSlice is a documented MIRROR of runtime/render.ts's
//   applySelectionClasses. P5 S5c (ADJ-R8) fixed the live runtime to write
//   aria-checked instead of aria-pressed; this mirror still baked the
//   pre-fix aria-pressed, so the Studio's static "Selected" sim showed one
//   thing and the live page another. Fixed to emit aria-checked, matching.

import { describe, expect, it } from "vitest";
import { renderComponent, renderSectionComponents } from "../src/public/leadgen/components/presets";
import type { LeadgenComponentNode } from "../src/public/leadgen/components/content-schema";
import { defaultFunnelDesign } from "../src/public/leadgen/designs/default-funnel/tokens";
import { applyPreviewSimMarkup } from "../src/admin/leadgen/preview-sim";

const DESIGN = defaultFunnelDesign;

describe("P5 tail item 1 — address field-set autocomplete field honours authored jobs.validate", () => {
  function multiFieldAddressNode(maps?: Record<string, unknown>): LeadgenComponentNode {
    return {
      type: "AddressAutocompleteQuestion",
      question_id: "q_addr",
      internal_field: "addr",
      props: {
        ...(maps !== undefined ? { maps } : {}),
        fields: [
          { field: "street", mode: "autofill" },
          { field: "zip", mode: "autofill", validation: "zip5" },
        ],
      },
    } as LeadgenComponentNode;
  }

  it("an authored jobs.validate:true reaches the rendered data-lg-maps attribute on the autocomplete (street) field", () => {
    const html = renderComponent(
      multiFieldAddressNode({ enabled: true, jobs: { validate: true, auction: false, autocomplete: true } }),
      DESIGN,
    );
    expect(html).toMatch(/data-lg-field="addr_street"[^>]*data-lg-maps="[^"]*&quot;validate&quot;:true/);
  });

  it("no authored props.maps (unset) stays byte-identical to today's default: validate:false", () => {
    const html = renderComponent(multiFieldAddressNode(), DESIGN);
    expect(html).toMatch(/data-lg-field="addr_street"[^>]*data-lg-maps="[^"]*&quot;validate&quot;:false/);
  });

  it("an authored jobs.validate:false (explicit) still renders validate:false — only true actually flips it", () => {
    const html = renderComponent(
      multiFieldAddressNode({ enabled: true, jobs: { validate: false, auction: false, autocomplete: true } }),
      DESIGN,
    );
    expect(html).toMatch(/data-lg-field="addr_street"[^>]*data-lg-maps="[^"]*&quot;validate&quot;:false/);
  });
});

describe("P5 tail item 2 — preview-sim selected-state mirror matches the live aria-checked runtime", () => {
  const NODES: LeadgenComponentNode[] = [
    {
      type: "ButtonAnswerGroup",
      question_id: "q_pick",
      internal_field: "pick",
      choices: [
        { label: "Sole Proprietor", value: "sole_prop", analytics_id: "biz_sole" },
        { label: "Partnership", value: "partnership", analytics_id: "biz_partner" },
      ],
    } as LeadgenComponentNode,
  ];

  it("the base SSR markup carries aria-checked, never aria-pressed (grounding the mirror's target)", () => {
    const base = renderSectionComponents(NODES, DESIGN);
    expect(base).toContain('aria-checked="false"');
    expect(base).not.toContain("aria-pressed");
  });

  it("the sim's selected state emits aria-checked exactly as the runtime does — never aria-pressed", () => {
    const base = renderSectionComponents(NODES, DESIGN);
    const out = applyPreviewSimMarkup(base, NODES, DESIGN, {
      state: "selected",
      markSelection: true,
      answers: { pick: "partnership" },
      visibleIds: null,
      requiredNow: null,
    });
    const selected = out.match(/<button[^>]*data-lg-choice="partnership"[^>]*>/)?.[0] ?? "";
    expect(selected).toContain('aria-checked="true"');
    expect(selected).toContain("lg-selected");
    expect(selected).not.toContain("aria-pressed");
    const sibling = out.match(/<button[^>]*data-lg-choice="sole_prop"[^>]*>/)?.[0] ?? "";
    expect(sibling).toContain('aria-checked="false"');
    expect(sibling).not.toContain("aria-pressed");
  });
});
