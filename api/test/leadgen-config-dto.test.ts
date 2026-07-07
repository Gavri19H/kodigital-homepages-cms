// LeadGen §30.4 / §24b public `/lg/config` DTO builder — unit tests. Asserts
// (a) the ALLOW list is present (funnel identity, design tokens, ordered
// section client-configs, section_order_hash, GA4 id), (b) funnel_id (lgf_) and
// funnel_variant_id (lgn_) are BOTH present and distinct (G4), and (c) a full
// serialized sweep proves NONE of the §24b server-only DENY fields/values
// appear — even when the source section nodes carry forbidden keys.

import { describe, expect, it } from "vitest";
import { buildPublicConfig, computeSectionOrderHash } from "../src/public/leadgen/config-dto";
import type { ResolvedActivatedFunnel, ResolvedFunnelSection } from "../src/public/leadgen/resolver";
import { getFunnelDesign } from "../src/public/leadgen/designs/registry";
import { mintPublicId } from "../src/leadgen/ids";
import type {
  LeadgenSectionRow,
  LeadgenFunnelRow,
  LeadgenFunnelVariantRow,
  LeadgenQuoteRow,
  LeadgenSiteQuoteRow,
} from "../src/admin/leadgen/db-types";

// --- fixtures ---------------------------------------------------------------

function sectionRow(partial: Partial<LeadgenSectionRow> & { public_id: string; content_json: string }): LeadgenSectionRow {
  return {
    id: 1,
    section_name: "Section",
    activity: "auto",
    vertical: "insurance",
    headline_text: "How much do you drive?",
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

// A section whose content_json carries a normal client component PLUS a rogue
// node that (illegitimately) embeds server-only keys — the projection MUST drop
// them. Written as a raw JSON string so the extra keys survive parse.
const CLIENT_SAFE_SECTION_JSON = JSON.stringify({
  components: [
    {
      type: "TwoButtonYesNo",
      question_id: "q_homeowner",
      question_key: "homeowner",
      internal_field: "homeowner",
      answer_type: "boolean",
      required: true,
      conditional: { when: "age", op: "gte", value: 18 },
      props: { min: 0, max: 1, defaultValue: false },
      // rogue server-only keys that MUST NOT survive projection:
      api_token_secret_ref: "LEADGEN_PB_TOKEN_X",
      endpoint_production: "https://provider.example/api",
      bid_source: "response",
      carrier_parse_json: "{...}",
      schema_json: "{...}",
    },
  ],
});

function buildResolved(overrides?: {
  sectionVersions?: number[];
  ga4?: string | null;
}): ResolvedActivatedFunnel {
  const versions = overrides?.sectionVersions ?? [1, 1];
  const sections: ResolvedFunnelSection[] = versions.map((cv, i) => ({
    position: i,
    section: sectionRow({
      id: i + 1,
      public_id: mintPublicId("section", Date.now() + i),
      content_json: CLIENT_SAFE_SECTION_JSON,
      content_version: cv,
      subheadline_text: i === 0 ? "It only takes a minute" : null,
    }),
  }));

  const quote: LeadgenQuoteRow = {
    id: 5,
    public_id: mintPublicId("quote"),
    quote_name: "Auto Insurance",
    activity: "auto",
    verticals_json: "[]",
    status: "active",
    created_by: null,
    created_at: 0,
    updated_at: 0,
  };
  const funnel: LeadgenFunnelRow = {
    id: 7,
    public_id: mintPublicId("funnel"),
    quote_id: 5,
    funnel_name: "Auto Funnel A",
    active_ab_test_id: null,
    status: "active",
    created_at: 0,
    updated_at: 0,
  };
  const variant: LeadgenFunnelVariantRow = {
    id: 9,
    public_id: mintPublicId("funnel_variant"),
    funnel_id: 7,
    ab_test_id: null,
    variant_label: "A",
    is_control: 1,
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
    content_version: 3,
    status: "active",
    created_at: 0,
  };
  const site_quote: LeadgenSiteQuoteRow = {
    id: 2,
    site_id: "site_1",
    quote_id: 5,
    enabled: 1,
    slug: null,
    settings_overrides_json: null,
    created_at: 0,
    updated_at: 0,
  };
  return {
    site_quote,
    quote,
    funnel,
    variant,
    sections,
    ga4_measurement_id: overrides?.ga4 === undefined ? "G-TEST123" : overrides.ga4,
  };
}

// --- tests ------------------------------------------------------------------

describe("buildPublicConfig — §24b ALLOW list is present", () => {
  const resolved = buildResolved();
  const config = buildPublicConfig(resolved, getFunnelDesign(resolved.variant.funnel_design_id));

  it("carries the funnel public identity with the correct prefixes", () => {
    expect(config.quote_id).toBe(resolved.quote.public_id);
    expect(config.funnel_id).toBe(resolved.funnel.public_id);
    expect(config.funnel_variant_id).toBe(resolved.variant.public_id);
    expect(config.funnel_id.startsWith("lgf_")).toBe(true);
    expect(config.funnel_variant_id.startsWith("lgn_")).toBe(true);
    expect(config.funnel_name).toBe("Auto Funnel A");
    expect(config.content_version).toBe(3);
    expect(config.funnel_design_id).toBe("default");
  });

  it("funnel_id and funnel_variant_id are BOTH present and DISTINCT (G4)", () => {
    expect(config.funnel_id as string).not.toBe(config.funnel_variant_id as string);
  });

  it("includes resolved design tokens + a 64-hex section_order_hash + GA4 id", () => {
    expect(config.design_tokens["color"]).toBeDefined();
    expect(config.design_tokens["page"]).toBeDefined();
    expect(/^[0-9a-f]{64}$/.test(config.section_order_hash)).toBe(true);
    expect(config.ga4_measurement_id).toBe("G-TEST123");
  });

  it("emits ordered section client-configs with client-safe fields + conditionals", () => {
    expect(config.sections.length).toBe(2);
    expect(config.sections[0]?.section_index).toBe(0);
    expect(config.sections[1]?.section_index).toBe(1);
    expect(config.sections[0]?.headline).toBe("How much do you drive?");
    expect(config.sections[0]?.subheadline).toBe("It only takes a minute");
    const comp = config.sections[0]?.components[0];
    expect(comp?.type).toBe("TwoButtonYesNo");
    expect(comp?.internal_field).toBe("homeowner");
    expect(comp?.conditional).toEqual({ when: "age", op: "gte", value: 18 });
    expect(comp?.client_validation).toEqual({ required: true, min: 0, max: 1 });
    expect(comp?.default_answer).toEqual({ value: false, answer_source: "default_applied" });
  });

  it("marks the P8 A/B seam (single control variant this phase)", () => {
    expect(config.assignment_reason).toBe("single_control");
    expect(config.funnel_ab_test_id).toBe("");
    expect(config.funnel_ab_test_revision).toBe(0);
  });
});

describe("buildPublicConfig — §24b DENY: server-only fields NEVER serialize", () => {
  const resolved = buildResolved();
  const config = buildPublicConfig(resolved, getFunnelDesign(resolved.variant.funnel_design_id));
  const serialized = JSON.stringify(config);

  it("no per-attempt / session key leaks into the cacheable config", () => {
    for (const forbidden of ["signed_config_token", "funnel_attempt_id"]) {
      expect(serialized.includes(forbidden), forbidden).toBe(false);
    }
  });

  it("no provider / bid / payload / secret field survives the projection", () => {
    for (const forbidden of [
      "endpoint_production",
      "endpoint_staging",
      "api_token_secret_ref",
      "LEADGEN_PB_TOKEN_X",
      "bid_source",
      "carrier_parse_json",
      "carrier_parse_version",
      "schema_json",
      "winner_logic",
      "floor_value",
      "static_bid_value",
    ]) {
      expect(serialized.includes(forbidden), forbidden).toBe(false);
    }
  });

  it("no key named 'secret' appears anywhere in the DTO", () => {
    expect(serialized.toLowerCase().includes("secret")).toBe(false);
  });
});

describe("computeSectionOrderHash — stable + version-sensitive", () => {
  it("is deterministic for identical inputs", () => {
    const a = buildResolved({ sectionVersions: [1, 1] });
    // rebuild with the SAME public ids to prove determinism over identical material
    const hashA = computeSectionOrderHash(a);
    const clone: ResolvedActivatedFunnel = { ...a, sections: a.sections.map((s) => ({ ...s })) };
    expect(computeSectionOrderHash(clone)).toBe(hashA);
  });

  it("changes when a section content_version changes", () => {
    const base = buildResolved({ sectionVersions: [1, 1] });
    const bumped: ResolvedActivatedFunnel = {
      ...base,
      sections: base.sections.map((s, i) =>
        i === 1 ? { ...s, section: { ...s.section, content_version: 2 } } : s,
      ),
    };
    expect(computeSectionOrderHash(bumped)).not.toBe(computeSectionOrderHash(base));
  });

  it("null GA4 id is surfaced as null (from unset settings)", () => {
    const resolved = buildResolved({ ga4: null });
    const config = buildPublicConfig(resolved, getFunnelDesign("default"));
    expect(config.ga4_measurement_id).toBeNull();
  });
});

// MINOR-3 — locks WHERE the §24b projection strips. The strip boundary is the
// NODE level: only whitelisted node fields are copied. `props` (and choices /
// conditional) are passed through VERBATIM because props is admin-authored
// rendering config (min/max/placeholder/options/…). The resolver NEVER sources
// server-only / secret data into a section's content_json props, so props is not
// a leak vector — but it is also NOT a filter, which this test makes explicit.
describe("buildPublicConfig — the server-only strip boundary is the node level; props is verbatim (MINOR-3)", () => {
  const PROBE_JSON = JSON.stringify({
    components: [
      {
        type: "TextInput",
        question_id: "q_probe",
        // a server-only key at the NODE top level → MUST be stripped:
        api_token_secret_ref: "NODE_LEVEL_REF_XZ",
        props: {
          placeholder: "Your name", // legit rendering config → survives
          rogue_ref: "PROPS_LEVEL_VALUE_XZ", // inside props → verbatim pass-through
        },
      },
    ],
  });

  function resolvedWithProbe(): ResolvedActivatedFunnel {
    const base = buildResolved();
    return {
      ...base,
      sections: [
        { position: 0, section: sectionRow({ id: 1, public_id: mintPublicId("section"), content_json: PROBE_JSON }) },
      ],
    };
  }

  it("STRIPS a server-only key placed at the node top level (even when props is present)", () => {
    const serialized = JSON.stringify(buildPublicConfig(resolvedWithProbe(), getFunnelDesign("default")));
    expect(serialized.includes("NODE_LEVEL_REF_XZ")).toBe(false);
  });

  it("passes props rendering config through verbatim (props is NOT a security filter)", () => {
    const config = buildPublicConfig(resolvedWithProbe(), getFunnelDesign("default"));
    const comp = config.sections[0]?.components[0];
    // props' legitimate rendering config survives (that is its purpose)…
    expect(comp?.props["placeholder"]).toBe("Your name");
    // …and so does ANY other value placed inside props — props is a verbatim
    // channel. Because the resolver never routes server-only/secret data into
    // props, this is not a leak; the strip boundary is the node level (above). A
    // future change that routes server-only data through props MUST add filtering
    // — this lock will flag the behavior change.
    expect(JSON.stringify(config).includes("PROPS_LEVEL_VALUE_XZ")).toBe(true);
  });
});
