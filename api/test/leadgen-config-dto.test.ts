// LeadGen §30.4 / §24b public `/lg/config` DTO builder — unit tests. Asserts
// (a) the ALLOW list is present (funnel identity, design tokens, ordered
// section client-configs, section_order_hash, GA4 id), (b) funnel_id (lgf_) and
// funnel_variant_id (lgn_) are BOTH present and distinct (G4), and (c) a full
// serialized sweep proves NONE of the §24b server-only DENY fields/values
// appear — even when the source section nodes carry forbidden keys.

import { describe, expect, it } from "vitest";
import { buildPublicConfig, computeSectionOrderHash, parseSectionContinueVisibleWhen } from "../src/public/leadgen/config-dto";
import type {
  ResolvedActivatedFunnel,
  ResolvedFunnelSection,
  FunnelAssignment,
} from "../src/public/leadgen/resolver";
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

const SINGLE_CONTROL_ASSIGNMENT: FunnelAssignment = {
  funnel_ab_test_id: "",
  funnel_ab_test_revision: 0,
  variant_label: "A",
  traffic_allocation_bp: 10000,
  assignment_bucket: null,
  assignment_reason: "single_control",
};

function buildResolved(overrides?: {
  sectionVersions?: number[];
  ga4?: string | null;
  assignment?: FunnelAssignment;
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
    default_funnel_id: null,
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
    frame_config_json: null,
    theme_json: null,
    display_order: null,
    frame_template_id: null,
  };
  // Rework M1 (§5-M1, §4.3-10): is_control dropped; variant_label "A" is this
  // fixture's single active variant (replacement semantics — no running test
  // ⇒ exactly one active variant, deterministically first by variant_label
  // ASC/id ASC). frame_template_id is new (M5); NULL = inherit the funnel's.
  const variant: LeadgenFunnelVariantRow = {
    id: 9,
    public_id: mintPublicId("funnel_variant"),
    funnel_id: 7,
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
    content_version: 3,
    status: "active",
    created_at: 0,
    frame_overrides_json: null,
    frame_template_id: null,
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
    assignment: overrides?.assignment ?? SINGLE_CONTROL_ASSIGNMENT,
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

// Fix-contract v2.4 03 §3.8 / 05 §5.4 (R6) — answer_mapping_version is now
// POPULATED from the caller-supplied resolve-time markers (loadAnswerMapVersions
// output, keyed by section public_id); the 2-arg call (admin quote-preview)
// honestly stays "".
describe("buildPublicConfig — R6 answer_mapping_version population (v2.4 03 §3.8)", () => {
  it("populates per-section answer_mapping_version from the supplied markers", () => {
    const resolved = buildResolved();
    const s0 = resolved.sections[0]!.section.public_id;
    const s1 = resolved.sections[1]!.section.public_id;
    const config = buildPublicConfig(resolved, getFunnelDesign("default"), { [s0]: "42", [s1]: "0" });
    expect(config.sections[0]?.answer_mapping_version).toBe("42");
    expect(config.sections[1]?.answer_mapping_version).toBe("0");
  });

  it("a section absent from the marker map falls back to the honest empty string", () => {
    const resolved = buildResolved();
    const s0 = resolved.sections[0]!.section.public_id;
    const config = buildPublicConfig(resolved, getFunnelDesign("default"), { [s0]: "7" });
    expect(config.sections[0]?.answer_mapping_version).toBe("7");
    expect(config.sections[1]?.answer_mapping_version).toBe("");
  });

  it("the 2-arg call (admin quote-preview path) keeps answer_mapping_version '' — never a faked version", () => {
    const config = buildPublicConfig(buildResolved(), getFunnelDesign("default"));
    for (const s of config.sections) expect(s.answer_mapping_version).toBe("");
  });

  it("the DENY sweep still holds with populated versions (no forbidden token rides in)", () => {
    const resolved = buildResolved();
    const s0 = resolved.sections[0]!.section.public_id;
    const serialized = JSON.stringify(
      buildPublicConfig(resolved, getFunnelDesign("default"), { [s0]: "42" }),
    );
    for (const forbidden of ["signed_config_token", "funnel_attempt_id", "schema_json", "carrier_parse_json"]) {
      expect(serialized.includes(forbidden), forbidden).toBe(false);
    }
    expect(serialized.toLowerCase().includes("secret")).toBe(false);
  });
});

// Fix-contract v2.4 06 §6.4 (B9) — choiceDisplay passthrough: ADDITIVE, present
// only when the content_json node carries it, normalized through the SAME
// readChoiceDisplay projection the server renderer uses (unknown keys dropped).
describe("buildPublicConfig — B9 choiceDisplay passthrough (v2.4 06 §6.4)", () => {
  const CHOICE_DISPLAY_JSON = JSON.stringify({
    components: [
      {
        type: "ButtonAnswerGroup",
        question_id: "q_carrier",
        internal_field: "carrier",
        choices: [
          { label: "Acme", value: "acme", analytics_id: "c_acme" },
          { label: "Zeta", value: "zeta", analytics_id: "c_zeta" },
        ],
        choiceDisplay: {
          mainValues: ["acme"],
          otherGroupEnabled: true,
          otherGroupLabel: "Other carrier",
          searchableOther: true,
          rogue_extra_key: "MUST_NOT_SURVIVE", // unknown key inside choiceDisplay → dropped
        },
      },
      {
        type: "TwoButtonYesNo",
        question_id: "q_plain",
        internal_field: "plain",
      },
    ],
  });

  function resolvedWithChoiceDisplay(): ResolvedActivatedFunnel {
    const base = buildResolved();
    return {
      ...base,
      sections: [
        {
          position: 0,
          section: sectionRow({ id: 1, public_id: mintPublicId("section"), content_json: CHOICE_DISPLAY_JSON }),
        },
      ],
    };
  }

  it("passes choiceDisplay through (normalized) when the node carries it", () => {
    const config = buildPublicConfig(resolvedWithChoiceDisplay(), getFunnelDesign("default"));
    const comp = config.sections[0]?.components[0];
    expect(comp?.choiceDisplay).toEqual({
      mainValues: ["acme"],
      otherGroupEnabled: true,
      otherGroupLabel: "Other carrier",
      searchableOther: true,
    });
  });

  it("drops unknown keys inside choiceDisplay (explicit projection) and omits the field when absent", () => {
    const config = buildPublicConfig(resolvedWithChoiceDisplay(), getFunnelDesign("default"));
    expect(JSON.stringify(config).includes("MUST_NOT_SURVIVE")).toBe(false);
    const plain = config.sections[0]?.components[1];
    expect(plain !== undefined && "choiceDisplay" in plain).toBe(false);
  });

  it("the DENY list is unchanged with choiceDisplay present", () => {
    const serialized = JSON.stringify(buildPublicConfig(resolvedWithChoiceDisplay(), getFunnelDesign("default")));
    for (const forbidden of [
      "endpoint_production",
      "api_token_secret_ref",
      "bid_source",
      "carrier_parse_json",
      "schema_json",
      "winner_logic",
    ]) {
      expect(serialized.includes(forbidden), forbidden).toBe(false);
    }
  });
});

// §16.3 A/B tracking dims on the ab_hash path — the config surfaces the
// VARIANT/TEST-scoped dims but MUST NOT carry the per-session assignment_bucket
// (contract 03 §8.3 + 09 §30.4: /lg/config is fully cacheable, no per-session
// data; the client recomputes the bucket per §16.2 edge/client parity).
describe("buildPublicConfig — §16.3 ab_hash dims (running test)", () => {
  const abAssignment: FunnelAssignment = {
    funnel_ab_test_id: "lgx_test123",
    funnel_ab_test_revision: 3,
    variant_label: "B",
    traffic_allocation_bp: 4000,
    assignment_bucket: 6543, // per-session — must never reach the cacheable config
    assignment_reason: "ab_hash",
  };
  const config = buildPublicConfig(buildResolved({ assignment: abAssignment }), getFunnelDesign("default"));

  it("surfaces the variant/test-scoped §16.3 dims", () => {
    expect(config.assignment_reason).toBe("ab_hash");
    expect(config.funnel_ab_test_id).toBe("lgx_test123");
    expect(config.funnel_ab_test_revision).toBe(3);
    expect(config.variant_label).toBe("B");
    expect(config.traffic_allocation_bp).toBe(4000);
  });

  it("does NOT carry the per-session assignment_bucket (config stays session-free)", () => {
    const serialized = JSON.stringify(config);
    expect(serialized.includes("assignment_bucket")).toBe(false);
    expect(serialized.includes("6543")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §8.5 layout containers — the config projects the FLATTENED component list:
// leaves in depth-first render order, containers never serialized (they are a
// server-side rendering concern; the engine keeps consuming a flat list while
// the server-rendered shell carries the nested DOM). DENY sweep stays intact
// even when rogue keys ride container nodes.
// ---------------------------------------------------------------------------

describe("buildPublicConfig — §8.5 nested content projects the flattened question list", () => {
  const NESTED_SECTION_JSON = JSON.stringify({
    components: [
      {
        type: "CardPanel",
        question_id: "panel",
        container_id: "c_panel",
        props: { width: "m", background: "card" },
        // rogue server-only keys on the CONTAINER must vanish with it:
        api_token_secret_ref: "LEADGEN_PB_TOKEN_X",
        endpoint_production: "https://provider.example/api",
        children: [
          { type: "QuestionHeadline", question_id: "h1", props: { text: "Are you insured?" } },
          {
            type: "Stack",
            question_id: "stk",
            props: { gap: "m" },
            children: [
              {
                type: "TwoButtonYesNo",
                question_id: "q_ins",
                question_key: "insured_q",
                internal_field: "currently_insured",
                answer_type: "boolean",
                required: true,
              },
              {
                type: "DropdownQuestion",
                question_id: "q_insurer",
                internal_field: "insurer",
                answer_type: "enum",
                choices: [{ label: "Acme", value: "acme", analytics_id: "ins_acme" }],
                conditional: { when: "currently_insured", op: "eq", value: true },
              },
            ],
          },
        ],
      },
      { type: "ContinueButton", question_id: "cont", props: { label: "Continue" } },
    ],
  });

  function buildNestedResolved(): ResolvedActivatedFunnel {
    const base = buildResolved({ sectionVersions: [1] });
    return {
      ...base,
      sections: base.sections.map((s) => ({
        ...s,
        section: { ...s.section, content_json: NESTED_SECTION_JSON },
      })),
    };
  }

  const resolved = buildNestedResolved();
  const config = buildPublicConfig(resolved, getFunnelDesign(resolved.variant.funnel_design_id));
  const section = config.sections[0];
  const serialized = JSON.stringify(config);

  it("lists every LEAF in depth-first render order — containers are NOT projected", () => {
    expect(section?.components.map((c) => c.type)).toEqual([
      "QuestionHeadline",
      "TwoButtonYesNo",
      "DropdownQuestion",
      "ContinueButton",
    ]);
    expect(section?.components.map((c) => c.question_id)).toEqual(["h1", "q_ins", "q_insurer", "cont"]);
    expect(serialized.includes("CardPanel")).toBe(false);
    expect(serialized.includes("Stack")).toBe(false);
    expect(serialized.includes("container_id")).toBe(false);
    expect(serialized.includes('"children"')).toBe(false);
  });

  it("nested leaves keep their client fields (conditional / internal_field / choices)", () => {
    const dropdown = section?.components.find((c) => c.question_id === "q_insurer");
    expect(dropdown?.internal_field).toBe("insurer");
    expect(dropdown?.conditional).toEqual({ when: "currently_insured", op: "eq", value: true });
    const yesNo = section?.components.find((c) => c.question_id === "q_ins");
    expect(yesNo?.required).toBe(true);
    expect(yesNo?.question_key).toBe("insured_q");
  });

  it("the §24b DENY sweep holds for nested content (rogue container keys vanish with the container)", () => {
    for (const forbidden of [
      "signed_config_token",
      "funnel_attempt_id",
      "endpoint_production",
      "api_token_secret_ref",
      "LEADGEN_PB_TOKEN_X",
      "bid_source",
      "schema_json",
    ]) {
      expect(serialized.includes(forbidden), forbidden).toBe(false);
    }
    expect(serialized.toLowerCase().includes("secret")).toBe(false);
  });

  it("flat legacy content keeps the EXACT pre-§8.5 projected shape (flatten is the identity)", () => {
    const flat = buildResolved();
    const flatConfig = buildPublicConfig(flat, getFunnelDesign(flat.variant.funnel_design_id));
    // the CLIENT_SAFE_SECTION_JSON fixture is flat: one TwoButtonYesNo per section
    expect(flatConfig.sections[0]?.components.map((c) => c.type)).toEqual(["TwoButtonYesNo"]);
    expect(flatConfig.sections[0]?.components[0]?.question_id).toBe("q_homeowner");
  });
});

// ---------------------------------------------------------------------------
// P4c (register PC-12) — section-level continue_visible_when projection
// ---------------------------------------------------------------------------

describe("parseSectionContinueVisibleWhen (defensive parser, D1 JSON-parse safety idiom)", () => {
  it("a valid {when,op,...} shape parses verbatim", () => {
    const json = JSON.stringify({ components: [], continue_visible_when: { when: "insured", op: "eq", value: true } });
    expect(parseSectionContinueVisibleWhen(json)).toEqual({ when: "insured", op: "eq", value: true });
  });

  it("absent key -> undefined (no continue_visible_when at all)", () => {
    expect(parseSectionContinueVisibleWhen(JSON.stringify({ components: [] }))).toBeUndefined();
  });

  it("corrupt JSON -> undefined, never throws", () => {
    expect(() => parseSectionContinueVisibleWhen("{not json")).not.toThrow();
    expect(parseSectionContinueVisibleWhen("{not json")).toBeUndefined();
  });

  it("a non-object / array / missing-when / missing-op value -> undefined (dropped defensively, not passed through as garbage)", () => {
    expect(parseSectionContinueVisibleWhen(JSON.stringify({ continue_visible_when: "nope" }))).toBeUndefined();
    expect(parseSectionContinueVisibleWhen(JSON.stringify({ continue_visible_when: [] }))).toBeUndefined();
    expect(parseSectionContinueVisibleWhen(JSON.stringify({ continue_visible_when: { op: "eq" } }))).toBeUndefined();
    expect(parseSectionContinueVisibleWhen(JSON.stringify({ continue_visible_when: { when: "x" } }))).toBeUndefined();
  });
});

describe("buildPublicConfig — P4c continue_visible_when projects onto PublicSectionConfig", () => {
  function withContentJson(resolved: ResolvedActivatedFunnel, index: number, contentJson: string): ResolvedActivatedFunnel {
    return {
      ...resolved,
      sections: resolved.sections.map((s, i) => (i === index ? { ...s, section: { ...s.section, content_json: contentJson } } : s)),
    };
  }
  const baseComponents = (JSON.parse(CLIENT_SAFE_SECTION_JSON) as { components: unknown[] }).components;

  it("a section whose content_json carries continue_visible_when projects it verbatim, siblings unaffected", () => {
    const resolved = buildResolved();
    const withRule = withContentJson(
      resolved,
      0,
      JSON.stringify({ components: baseComponents, continue_visible_when: { when: "homeowner", op: "eq", value: true } }),
    );
    const config = buildPublicConfig(withRule, getFunnelDesign(withRule.variant.funnel_design_id));
    expect(config.sections[0]?.continue_visible_when).toEqual({ when: "homeowner", op: "eq", value: true });
    // the untouched sibling section carries no such key AT ALL (absent, not
    // an undefined-valued key — an explicit hasOwnProperty check, not a
    // loose `=== undefined`, so a future accidental `continue_visible_when:
    // undefined` assignment would also be caught).
    expect(Object.prototype.hasOwnProperty.call(config.sections[1] ?? {}, "continue_visible_when")).toBe(false);
  });

  it("a malformed continue_visible_when in content_json is dropped defensively — never reaches the runtime as garbage", () => {
    const resolved = buildResolved();
    const malformed = withContentJson(resolved, 0, JSON.stringify({ components: baseComponents, continue_visible_when: { op: "eq" } }));
    const config = buildPublicConfig(malformed, getFunnelDesign(malformed.variant.funnel_design_id));
    expect(config.sections[0]?.continue_visible_when).toBeUndefined();
  });

  it("absent continue_visible_when (the default CLIENT_SAFE_SECTION_JSON fixture): the projected field is absent, not null/undefined-valued", () => {
    const resolved = buildResolved();
    const config = buildPublicConfig(resolved, getFunnelDesign(resolved.variant.funnel_design_id));
    expect(Object.prototype.hasOwnProperty.call(config.sections[0] ?? {}, "continue_visible_when")).toBe(false);
  });
});
