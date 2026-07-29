// LeadGen R2 P1 §① — the Question-Grid CONTAINER: server-side REPLAY R2 seams
// (slice S1d). Owner-verbatim clause under test (docs/leadgen/source-of-truth/
// SOURCE-OF-TRUTH.md A.1 #1): "Each one of this questions is answering
// another field for the offers payload ... help us to decide the user
// jurney (the funnel) by the funnel rule" — each grid child's OWN
// internal_field must be visible to every seam that derives the variant's
// known/routable/rule-pickable field universe from content_json, not just
// the top-level components.
//
// THE GAP (mission brief): resolver.ts's fieldToPageIndex/computeResumeSection,
// runtime-routes.ts's checkpointKnownFields, and ui-quotes.ts's
// quoteRailAnswerFields/sectionFieldsByPublicId each walked a section's raw
// content_json components but never descended into a QuestionGrid's own
// `.children`. Fixed by resolver.ts's expandWithGridChildren (one extra
// level over config-dto's expandPublicComponents) and ui-quotes.ts's
// internalFieldsOf (the same one extra level over the raw untyped walk).

import { describe, expect, it } from "vitest";
import {
  computeResumeSection,
  expandWithGridChildren,
  fieldToPageIndex,
  type FunnelAssignment,
  type ResolvedActivatedFunnel,
  type ResolvedFunnelPage,
  type ResolvedFunnelSection,
  type ResolvedSlotWinner,
} from "../src/public/leadgen/resolver";
import { checkpointKnownFields } from "../src/public/leadgen/runtime-routes";
import { quoteRailAnswerFields, sectionFieldsByPublicId } from "../src/admin/leadgen/ui-quotes";
import type { AvailableSection } from "../src/admin/leadgen/quotes-tabs/shared";
import type { LeadgenComponentNode } from "../src/public/leadgen/components/content-schema";
import type {
  LeadgenFunnelRow,
  LeadgenFunnelVariantRow,
  LeadgenQuoteRow,
  LeadgenSectionRow,
  LeadgenSiteQuoteRow,
} from "../src/admin/leadgen/db-types";
import { mintPublicId } from "../src/leadgen/ids";

// ---------------------------------------------------------------------------
// fixtures — a grid carrying a Yes/No trigger + its OWN required dependent
// dropdown (design-pin 18.30.25 shape, field names shared with the P1
// live-drive acceptance for direct traceability).
// ---------------------------------------------------------------------------

const GRID_SECTION_JSON = JSON.stringify({
  components: [
    {
      type: "QuestionGrid",
      question_id: "grid1",
      props: {},
      children: [
        { type: "TwoButtonYesNo", question_id: "q1", internal_field: "r2p1_currently_insured", props: {} },
        {
          type: "DropdownQuestion",
          question_id: "q2",
          internal_field: "r2p1_current_insurer",
          required: true,
          conditional: { when: "r2p1_currently_insured", op: "eq", value: true },
          props: {},
        },
      ],
    },
    { type: "ContinueButton", question_id: "cont", props: {} },
  ],
});

function sectionRow(partial: Partial<LeadgenSectionRow> & { public_id: string; content_json: string }): LeadgenSectionRow {
  return {
    id: 1,
    section_name: "Grid section",
    activity: "auto",
    vertical: "insurance",
    headline_text: "Insurance details",
    subheadline_text: null,
    image_json: null,
    content_html: null,
    continue_mode: "button",
    design_overrides_json: null,
    address_validation_enabled: 0,
    section_mapping_version: 1,
    content_version: 1,
    status: "active",
    created_by: null,
    created_at: 0,
    updated_at: 0,
    ...partial,
  };
}

// ---------------------------------------------------------------------------
// expandWithGridChildren (resolver.ts) — the shared one-level descent
// ---------------------------------------------------------------------------

describe("expandWithGridChildren (resolver.ts) — the one-level descent", () => {
  it("returns the container PLUS its children, not just the container", () => {
    const node = (JSON.parse(GRID_SECTION_JSON) as { components: LeadgenComponentNode[] }).components[0];
    expect(node).toBeDefined();
    const out = expandWithGridChildren(node as LeadgenComponentNode);
    expect(out.map((c) => c.question_id)).toEqual(["grid1", "q1", "q2"]);
  });

  it("a non-grid node is unaffected — still exactly one item, unchanged", () => {
    const node = { type: "ContinueButton", question_id: "cont", props: {} } as unknown as LeadgenComponentNode;
    expect(expandWithGridChildren(node).map((c) => c.question_id)).toEqual(["cont"]);
  });
});

// ---------------------------------------------------------------------------
// fieldToPageIndex (resolver.ts)
// ---------------------------------------------------------------------------

describe("fieldToPageIndex (resolver.ts) — a grid child's field is page-indexed", () => {
  function onePagePages(): ResolvedFunnelPage[] {
    return [
      {
        id: 1,
        public_id: "lgp_1",
        position: 0,
        name: null,
        slots: [
          {
            id: 1,
            position: 0,
            slot_revision: 1,
            rules: null,
            ab_allocations: null,
            candidates: [
              { variant_section_id: 1, section: sectionRow({ public_id: "lgs_grid", content_json: GRID_SECTION_JSON }) },
            ],
          },
        ],
      },
    ];
  }

  it("maps BOTH grid-child fields to their page index — not just top-level fields", () => {
    const f2p = fieldToPageIndex(onePagePages());
    expect(f2p.get("r2p1_currently_insured")).toBe(0);
    expect(f2p.get("r2p1_current_insurer")).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// computeResumeSection (resolver.ts)
// ---------------------------------------------------------------------------

describe("computeResumeSection (resolver.ts) — a grid child's OWN required rule gates resume", () => {
  const pages: ResolvedFunnelPage[] = [
    {
      id: 1,
      public_id: "lgp_1",
      position: 0,
      name: null,
      slots: [
        {
          id: 1,
          position: 0,
          slot_revision: 1,
          rules: null,
          ab_allocations: null,
          candidates: [
            { variant_section_id: 1, section: sectionRow({ public_id: "lgs_grid", content_json: GRID_SECTION_JSON }) },
          ],
        },
      ],
    },
  ];
  const winners: ResolvedSlotWinner[] = [{ page_id: "1", slot_id: 1, section_public_id: "lgs_grid", assignment_reason: "fixed" }];

  it("a grid child's unanswered required field resumes AT that section", () => {
    expect(computeResumeSection(winners, pages, {})).toBe("lgs_grid");
  });

  it("once the grid child's field is answered, resume clears (proceeds to auction)", () => {
    expect(computeResumeSection(winners, pages, { r2p1_current_insurer: "acme" })).toBe("");
  });
});

// ---------------------------------------------------------------------------
// checkpointKnownFields (runtime-routes.ts)
// ---------------------------------------------------------------------------

describe("checkpointKnownFields (runtime-routes.ts) — a grid child's field is checkpoint-routable", () => {
  function activatedFunnel(sections: ResolvedFunnelSection[]): ResolvedActivatedFunnel {
    const assignment: FunnelAssignment = {
      funnel_ab_test_id: "",
      funnel_ab_test_revision: 0,
      variant_label: "A",
      traffic_allocation_bp: 10000,
      assignment_bucket: null,
      assignment_reason: "single_control",
    };
    const quote: LeadgenQuoteRow = {
      id: 1,
      public_id: mintPublicId("quote"),
      quote_name: "Q",
      activity: "auto",
      verticals_json: "[]",
      status: "active",
      created_by: null,
      created_at: 0,
      updated_at: 0,
      default_funnel_id: null,
    };
    const funnel: LeadgenFunnelRow = {
      id: 1,
      public_id: mintPublicId("funnel"),
      quote_id: 1,
      funnel_name: "F",
      active_ab_test_id: null,
      status: "active",
      created_at: 0,
      updated_at: 0,
      frame_config_json: null,
      theme_json: null,
      display_order: null,
      frame_template_id: null,
    };
    const variant: LeadgenFunnelVariantRow = {
      id: 1,
      public_id: mintPublicId("funnel_variant"),
      funnel_id: 1,
      ab_test_id: null,
      variant_label: "A",
      traffic_allocation_bp: 10000,
      funnel_design_id: "default",
      auction_id: null,
      lander_enabled: 0,
      lander_headline: null,
      lander_subheadline: null,
      lander_body_json: null,
      lander_hero_media_id: null,
      lander_hero_media_url: null,
      lander_cta_json: null,
      content_version: 1,
      status: "active",
      created_at: 0,
      frame_overrides_json: null,
      frame_template_id: null,
    };
    const site_quote: LeadgenSiteQuoteRow = {
      id: 1,
      site_id: "site_1",
      quote_id: 1,
      enabled: 1,
      slug: null,
      settings_overrides_json: null,
      created_at: 0,
      updated_at: 0,
    };
    return { site_quote, quote, funnel, variant, sections, ga4_measurement_id: null, assignment };
  }

  it("includes a grid child's internal_field alongside the top-level fields", () => {
    const current = activatedFunnel([
      { position: 0, section: sectionRow({ public_id: "lgs_grid", content_json: GRID_SECTION_JSON }) },
    ]);
    const known = checkpointKnownFields(current);
    expect(known.has("r2p1_currently_insured")).toBe(true);
    expect(known.has("r2p1_current_insurer")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ui-quotes.ts rule-picker seams
// ---------------------------------------------------------------------------

describe("ui-quotes.ts rule-picker seams — a grid child's field is offered", () => {
  function availableSection(overrides: Partial<AvailableSection> = {}): AvailableSection {
    return {
      id: 1,
      public_id: "lgs_grid",
      section_name: "Grid section",
      activity: "auto",
      vertical: "insurance",
      status: "active",
      content_json: JSON.parse(GRID_SECTION_JSON),
      ...overrides,
    };
  }

  it("quoteRailAnswerFields lists both grid-child fields, never the container", () => {
    const fields = quoteRailAnswerFields([availableSection()]);
    const names = fields.map((f) => f.internal_field);
    expect(names).toContain("r2p1_currently_insured");
    expect(names).toContain("r2p1_current_insurer");
    expect(names).not.toContain("grid1");
  });

  it("sectionFieldsByPublicId maps the section to BOTH grid-child fields", () => {
    const map = sectionFieldsByPublicId([availableSection()]);
    expect(map.get("lgs_grid")).toEqual(["r2p1_currently_insured", "r2p1_current_insurer"]);
  });
});
