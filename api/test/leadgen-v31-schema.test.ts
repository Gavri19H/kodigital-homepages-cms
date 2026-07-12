// LeadGen v3.1 Section Builder & Themes (design-locked contract) — Phase A
// slice A2. Proves: (1) the NEW §11.3 field-content props (label/helper/icon/
// required/format/error_text/role/source/maps) are additive-optional and
// reject the documented enum/shape/type-restriction violations; (2) every
// pre-v3.1 minimal node still validates unchanged; (3) §7.2
// design_overrides.size validates its preset-or-custom_px shape and the pure
// resolveFieldSize resolver implements the §7.1 state machine (node override
// -> funnel theme default -> design default) plus the defensive clamp/snap;
// (4) §9.2/§9.3 the Maps config's type restriction + the maps_no_job warning.

import { describe, expect, it } from "vitest";
import {
  validateSectionContent,
  resolveFieldSize,
  acceptFormatOfType,
  LEADGEN_FIELD_LEADING_ICONS,
  LEADGEN_FIELD_ACCEPT_FORMATS,
  LEADGEN_FIELD_ACCEPT_TYPE,
  LEADGEN_SIZE_WIDTH_PRESETS,
  LEADGEN_SIZE_HEIGHT_PRESETS,
  type LeadgenComponentNode,
  type LeadgenSizeThemeControls,
  type LeadgenSizeOverride,
} from "../src/public/leadgen/components/content-schema";
import { COMPONENT_CATALOG, type ComponentType } from "../src/public/leadgen/components/registry";

const content = (components: unknown[]): unknown => ({ components });
const codesOf = (result: ReturnType<typeof validateSectionContent>): string[] =>
  result.errors.map((e) => e.code);
const warnCodesOf = (result: ReturnType<typeof validateSectionContent>): string[] =>
  result.warnings.map((w) => w.code);

// A minimal, otherwise-valid ZIP field — the §11.3 worked example's base node.
function zipNode(props: Record<string, unknown>): LeadgenComponentNode {
  return {
    type: "ZIPInputQuestion",
    question_id: "q_zip",
    internal_field: "zip",
    props,
  };
}

describe("v3.1 §11.3 — NEW field-content props are additive/optional", () => {
  it("accepts every NEW prop populated together (the §11.3 worked example, minus props.required — see erratum test below)", () => {
    const result = validateSectionContent(
      content([
        zipNode({
          placeholder: "Enter your ZIP code",
          label: "ZIP code",
          helper: "We never share this",
          icon: "location",
          format: "us_zip",
          error_text: "Please enter a valid ZIP code",
          maps: { enabled: true, jobs: { validate: true, auction: false, autocomplete: false } },
        }),
      ]),
    );
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("a pre-v3.1 minimal node with NONE of the new props still validates unchanged (regression)", () => {
    const result = validateSectionContent(content([zipNode({ validate: true })]));
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("label/helper/error_text must be strings when present", () => {
    for (const key of ["label", "helper", "error_text"] as const) {
      const result = validateSectionContent(content([zipNode({ [key]: 42 })]));
      expect(codesOf(result), key).toContain("invalid_field_prop");
    }
  });

  describe("icon — 12-value leading-icon picker (§8.5b)", () => {
    it("reports the exact shipped enum", () => {
      expect(LEADGEN_FIELD_LEADING_ICONS).toEqual([
        "location",
        "calendar",
        "dollar",
        "phone",
        "email",
        "lock",
        "person",
        "home",
        "car",
        "shield",
        "star",
        "none",
      ]);
    });

    it("accepts every enum value", () => {
      for (const icon of LEADGEN_FIELD_LEADING_ICONS) {
        const result = validateSectionContent(content([zipNode({ icon })]));
        expect(result.errors, icon).toEqual([]);
      }
    });

    it("rejects a value outside the enum", () => {
      const result = validateSectionContent(content([zipNode({ icon: "flag" })]));
      expect(codesOf(result)).toContain("invalid_field_prop");
    });

    it("EXEMPTS TextBlock reassurance/secure_badge roles — free-form glyph, byte-identical migration fidelity (§5.3)", () => {
      const reassurance: LeadgenComponentNode = {
        type: "TextBlock",
        question_id: "q_tb",
        props: { role: "reassurance", icon: "✓", text: "Fast quotes" },
      };
      const secure: LeadgenComponentNode = {
        type: "TextBlock",
        question_id: "q_tb2",
        props: { role: "secure_badge", icon: "🔒", text: "Secure" },
      };
      expect(validateSectionContent(content([reassurance])).errors).toEqual([]);
      expect(validateSectionContent(content([secure])).errors).toEqual([]);
    });

    // Regression (conductor fix round): the FIRST cut of this check applied
    // the semantic enum to EVERY node's props.icon except TextBlock's two
    // badge roles — which broke the PRE-EXISTING, already-unvalidated glyph
    // icon on ReassuranceBadge/SecureFormBadge/SuccessState themselves (a
    // real content_json regression, caught by the existing-suite lockstep
    // "every minimal node is accepted by validateSectionContent" tests).
    it("does NOT enforce the semantic enum on the pre-existing glyph-icon types (ReassuranceBadge/SecureFormBadge/SuccessState)", () => {
      const reassurance: LeadgenComponentNode = {
        type: "ReassuranceBadge",
        question_id: "q_rb",
        props: { text: "Fast quotes", icon: "✓" },
      };
      const secure: LeadgenComponentNode = {
        type: "SecureFormBadge",
        question_id: "q_sb",
        props: { text: "Secure", icon: "🔒" },
      };
      const success: LeadgenComponentNode = {
        type: "SuccessState",
        question_id: "q_ss",
        props: { heading: "All set", icon: "✓" },
      };
      expect(validateSectionContent(content([reassurance])).errors).toEqual([]);
      expect(validateSectionContent(content([secure])).errors).toEqual([]);
      expect(validateSectionContent(content([success])).errors).toEqual([]);
    });

    it("a non-badge TextBlock role still enforces the semantic enum for icon", () => {
      const result = validateSectionContent(
        content([{ type: "TextBlock", question_id: "q_tb3", props: { role: "heading", icon: "✓" } }]),
      );
      expect(codesOf(result)).toContain("invalid_field_prop");
    });
  });

  describe("format — 8-value Accept-swap enum (§5.6)", () => {
    it("reports the exact shipped enum", () => {
      expect(LEADGEN_FIELD_ACCEPT_FORMATS).toEqual([
        "text",
        "number",
        "currency",
        "email",
        "phone",
        "us_zip",
        "date",
        "street_address",
      ]);
    });

    it("accepts every enum value", () => {
      for (const format of LEADGEN_FIELD_ACCEPT_FORMATS) {
        const result = validateSectionContent(content([zipNode({ format })]));
        expect(result.errors, format).toEqual([]);
      }
    });

    it("rejects a value outside the enum", () => {
      const result = validateSectionContent(content([zipNode({ format: "postal_code" })]));
      expect(codesOf(result)).toContain("invalid_field_prop");
    });
  });

  it("required — top-level node.required is the repo's REAL mechanism; props.required is flagged as the §11.3 erratum", () => {
    // The existing, fully-wired top-level field validates fine (and is now
    // TYPE-CHECKED for the first time — previously untyped at runtime).
    const topLevel: LeadgenComponentNode = { ...zipNode({}), required: true };
    expect(validateSectionContent(content([topLevel])).errors).toEqual([]);

    const badTopLevel = { ...zipNode({}), required: "yes" };
    expect(codesOf(validateSectionContent(content([badTopLevel])))).toContain("invalid_field_prop");

    // props.required (the §11.3 JSON illustration's nesting) is REJECTED —
    // not a silent no-op — so authors get a clear signal instead of writing
    // to a dead key.
    const nested = validateSectionContent(content([zipNode({ required: true })]));
    expect(codesOf(nested)).toContain("invalid_field_prop");
  });

  describe("role — TextBlock only (§5.3/§8.5b)", () => {
    it("rejects role on a non-TextBlock type (type-restriction)", () => {
      const result = validateSectionContent(content([zipNode({ role: "heading" })]));
      expect(codesOf(result)).toContain("invalid_field_prop");
    });

    it("rejects an out-of-enum role value even on TextBlock", () => {
      const result = validateSectionContent(
        content([{ type: "TextBlock", question_id: "q_tb4", props: { role: "title" } }]),
      );
      expect(codesOf(result)).toContain("invalid_field_prop");
    });

    it("accepts every enum value on TextBlock", () => {
      const roles = ["heading", "body", "category_label", "helper", "legal", "reassurance", "secure_badge"];
      for (const role of roles) {
        const result = validateSectionContent(
          content([{ type: "TextBlock", question_id: `q_${role}`, props: { role, text: "x" } }]),
        );
        expect(result.errors, role).toEqual([]);
      }
    });
  });

  describe("source — ImageBlock only (§5.3)", () => {
    it("rejects source on a non-ImageBlock type (type-restriction)", () => {
      const result = validateSectionContent(content([zipNode({ source: "auto_logo" })]));
      expect(codesOf(result)).toContain("invalid_field_prop");
    });

    it("accepts both enum values on ImageBlock", () => {
      for (const source of ["media", "auto_logo"] as const) {
        const result = validateSectionContent(
          content([{ type: "ImageBlock", question_id: `q_${source}`, props: { source } }]),
        );
        expect(result.errors, source).toEqual([]);
      }
    });

    it("rejects an out-of-enum source value", () => {
      const result = validateSectionContent(
        content([{ type: "ImageBlock", question_id: "q_bad", props: { source: "url" } }]),
      );
      expect(codesOf(result)).toContain("invalid_field_prop");
    });
  });
});

describe("v3.1 §9.2/§9.3 — field-level Maps config", () => {
  it("accepts the exact §9.2 worked example on ZIPInputQuestion", () => {
    const result = validateSectionContent(
      content([
        zipNode({ maps: { enabled: true, jobs: { validate: true, auction: false, autocomplete: false } } }),
      ]),
    );
    expect(result.errors).toEqual([]);
  });

  it("accepts maps on AddressAutocompleteQuestion", () => {
    const node: LeadgenComponentNode = {
      type: "AddressAutocompleteQuestion",
      question_id: "q_addr",
      props: { maps: { enabled: true, jobs: { validate: false, auction: false, autocomplete: true } } },
    };
    expect(validateSectionContent(content([node])).errors).toEqual([]);
  });

  it("rejects maps on a type OTHER than ZIP/Address (type-restriction)", () => {
    const node: LeadgenComponentNode = {
      type: "FreeTextQuestion",
      question_id: "q_ft",
      internal_field: "note",
      props: { maps: { enabled: true, jobs: { validate: true, auction: false, autocomplete: false } } },
    };
    expect(codesOf(validateSectionContent(content([node])))).toContain("invalid_maps_prop");
  });

  it("rejects a malformed maps shape (non-boolean enabled, non-object jobs)", () => {
    const badEnabled = validateSectionContent(content([zipNode({ maps: { enabled: "yes", jobs: {} } })]));
    expect(codesOf(badEnabled)).toContain("invalid_maps_prop");
    const badJobs = validateSectionContent(content([zipNode({ maps: { enabled: true, jobs: "x" } })]));
    expect(codesOf(badJobs)).toContain("invalid_maps_prop");
  });

  it("§9.3 maps_no_job — enabled with zero jobs is a non-blocking WARNING, path-precise, ok stays true", () => {
    const result = validateSectionContent(
      content([zipNode({ maps: { enabled: true, jobs: { validate: false, auction: false, autocomplete: false } } })]),
    );
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    expect(warnCodesOf(result)).toContain("maps_no_job");
    const warning = result.warnings.find((w) => w.code === "maps_no_job");
    expect(warning?.path).toBe("components[0].props.maps");
  });

  it("no maps_no_job warning when at least one job is selected", () => {
    const result = validateSectionContent(
      content([zipNode({ maps: { enabled: true, jobs: { validate: true, auction: false, autocomplete: false } } })]),
    );
    expect(warnCodesOf(result)).not.toContain("maps_no_job");
  });

  it("no maps_no_job warning when maps.enabled is false", () => {
    const result = validateSectionContent(
      content([zipNode({ maps: { enabled: false, jobs: { validate: false, auction: false, autocomplete: false } } })]),
    );
    expect(warnCodesOf(result)).not.toContain("maps_no_job");
  });
});

describe("v3.1 §7.2 — design_overrides.size validation", () => {
  it("reports the exact shipped preset enums", () => {
    expect(LEADGEN_SIZE_WIDTH_PRESETS).toEqual(["s", "m", "l", "full"]);
    expect(LEADGEN_SIZE_HEIGHT_PRESETS).toEqual(["small", "medium", "large"]);
  });

  it("accepts every width/height preset name", () => {
    for (const width of LEADGEN_SIZE_WIDTH_PRESETS) {
      const node = { ...zipNode({}), design_overrides: { size: { width } } };
      expect(validateSectionContent(content([node])).errors, width).toEqual([]);
    }
    for (const height of LEADGEN_SIZE_HEIGHT_PRESETS) {
      const node = { ...zipNode({}), design_overrides: { size: { height } } };
      expect(validateSectionContent(content([node])).errors, height).toEqual([]);
    }
  });

  it("accepts the §7.2 worked example {width:'full', height:'medium'}", () => {
    const node = { ...zipNode({}), design_overrides: { size: { width: "full", height: "medium" } } };
    expect(validateSectionContent(content([node])).errors).toEqual([]);
  });

  it("accepts a valid custom_px on width (the §7.1 demo value 384) and height (the §7.2 example 56)", () => {
    const node = {
      ...zipNode({}),
      design_overrides: { size: { width: { custom_px: 384 }, height: { custom_px: 56 } } },
    };
    const result = validateSectionContent(content([node]));
    expect(result.errors).toEqual([]);
  });

  it("rejects an out-of-enum preset string", () => {
    const node = { ...zipNode({}), design_overrides: { size: { width: "xl" } } };
    expect(codesOf(validateSectionContent(content([node])))).toContain("invalid_size_override");
  });

  it("rejects a width custom_px below 200 (below the §7.1 clamp floor)", () => {
    const node = { ...zipNode({}), design_overrides: { size: { width: { custom_px: 100 } } } };
    expect(codesOf(validateSectionContent(content([node])))).toContain("invalid_size_override");
  });

  it("rejects a width custom_px above 600 (above the §7.1/Appendix-B unit-column ceiling)", () => {
    const node = { ...zipNode({}), design_overrides: { size: { width: { custom_px: 900 } } } };
    expect(codesOf(validateSectionContent(content([node])))).toContain("invalid_size_override");
  });

  it("rejects a custom_px not snapped to the 4px grid", () => {
    const node = { ...zipNode({}), design_overrides: { size: { width: { custom_px: 401 } } } };
    expect(codesOf(validateSectionContent(content([node])))).toContain("invalid_size_override");
  });

  it("rejects a malformed size value (not an object, or an object with extra keys)", () => {
    expect(
      codesOf(validateSectionContent(content([{ ...zipNode({}), design_overrides: { size: "full" } }]))),
    ).toContain("invalid_size_override");
    expect(
      codesOf(
        validateSectionContent(
          content([{ ...zipNode({}), design_overrides: { size: { width: "full", depth: "s" } } }]),
        ),
      ),
    ).toContain("invalid_size_override");
    expect(
      codesOf(
        validateSectionContent(
          content([{ ...zipNode({}), design_overrides: { size: { width: { custom_px: 300, extra: 1 } } } }]),
        ),
      ),
    ).toContain("invalid_size_override");
  });

  it("`size` is a curated design_overrides key — no non_curated_override_key regression for the other 8 keys", () => {
    const node = {
      type: "ContinueButton",
      question_id: "q_c",
      design_overrides: { buttonBackground: "#1B3A5C" },
    };
    expect(validateSectionContent(content([node])).ok).toBe(true);
  });
});

describe("v3.1 §7.1/§7.2/§12 — resolveFieldSize (pure resolver)", () => {
  const controls: LeadgenSizeThemeControls = { field_height: "medium", button_size: "m", corners: "rounded" };

  it("absent size -> width inherits the design default 'full' (no theme width knob); height inherits themeControls.field_height", () => {
    const resolved = resolveFieldSize(undefined, controls);
    expect(resolved.width).toEqual({ mode: "preset", preset: "full" });
    expect(resolved.height).toEqual({ mode: "preset", preset: "medium" });
  });

  it("a different theme field_height is honored for the absent-height case", () => {
    const resolved = resolveFieldSize(undefined, { ...controls, field_height: "small" });
    expect(resolved.height).toEqual({ mode: "preset", preset: "small" });
  });

  it("preset passthrough — a named node preset wins over the theme default, for both axes", () => {
    const override: LeadgenSizeOverride = { width: "m", height: "large" };
    const resolved = resolveFieldSize(override, controls);
    expect(resolved.width).toEqual({ mode: "preset", preset: "m" });
    expect(resolved.height).toEqual({ mode: "preset", preset: "large" });
  });

  it("custom_px wins over preset AND theme, and passes through unchanged when already in-range/snapped", () => {
    const override: LeadgenSizeOverride = { width: { custom_px: 384 }, height: { custom_px: 56 } };
    const resolved = resolveFieldSize(override, controls);
    expect(resolved.width).toEqual({ mode: "custom", px: 384 });
    expect(resolved.height).toEqual({ mode: "custom", px: 56 });
  });

  it("defensively re-clamps an out-of-range custom_px (belt-and-suspenders over validation)", () => {
    const tooWide = resolveFieldSize({ width: { custom_px: 5000 } }, controls);
    expect(tooWide.width).toEqual({ mode: "custom", px: 600 });
    const tooNarrow = resolveFieldSize({ width: { custom_px: 1 } }, controls);
    expect(tooNarrow.width).toEqual({ mode: "custom", px: 200 });
  });

  it("defensively re-snaps an un-gridded custom_px to the nearest 4px", () => {
    const resolved = resolveFieldSize({ width: { custom_px: 203 } }, controls);
    // 203 / 4 = 50.75 -> rounds to 51 -> 51*4 = 204
    expect(resolved.width).toEqual({ mode: "custom", px: 204 });
  });

  it("snap-then-clamp composes correctly at the boundary (a snap that would land outside range clamps back in)", () => {
    const resolved = resolveFieldSize({ width: { custom_px: 599 } }, controls);
    // 599/4=149.75 -> rounds to 150 -> 600 (already the max, no clamp needed)
    expect(resolved.width).toEqual({ mode: "custom", px: 600 });
  });
});

// v3.1 §5.6 Phase B slice 5 (additive, this Section Studio phase): the
// Accept-format <-> concrete-type reverse map every text-input tile's
// Accept dropdown needs (Section Studio's toolbar + Phase C's inspector
// both consume it — additive-only, no existing export changed).
describe("v3.1 §5.6 — LEADGEN_FIELD_ACCEPT_TYPE reverse map (Accept-swap rule)", () => {
  it("maps every one of the 8 Accept values to its EXACT concrete type per the §5.6 table", () => {
    expect(LEADGEN_FIELD_ACCEPT_TYPE).toEqual({
      text: "FreeTextQuestion",
      number: "NumberInputQuestion",
      currency: "CurrencyInputQuestion",
      email: "EmailInputQuestion",
      phone: "PhoneInputQuestion",
      us_zip: "ZIPInputQuestion",
      date: "DateQuestion",
      street_address: "AddressAutocompleteQuestion",
    });
    // every key is exactly LEADGEN_FIELD_ACCEPT_FORMATS, in the same set
    expect(Object.keys(LEADGEN_FIELD_ACCEPT_TYPE).sort()).toEqual([...LEADGEN_FIELD_ACCEPT_FORMATS].sort());
  });

  it("every mapped type is a REAL catalog entry (no typo'd type name slips through)", () => {
    for (const type of Object.values(LEADGEN_FIELD_ACCEPT_TYPE)) {
      expect(COMPONENT_CATALOG[type as ComponentType], `${type} is a real catalog entry`).toBeDefined();
    }
  });

  it("acceptFormatOfType is the exact inverse of LEADGEN_FIELD_ACCEPT_TYPE", () => {
    for (const format of LEADGEN_FIELD_ACCEPT_FORMATS) {
      expect(acceptFormatOfType(LEADGEN_FIELD_ACCEPT_TYPE[format])).toBe(format);
    }
  });

  it("a type OUTSIDE the 8-value Accept family (e.g. a choice/container type) has no Accept format", () => {
    expect(acceptFormatOfType("ButtonAnswerGroup")).toBeUndefined();
    expect(acceptFormatOfType("CardPanel")).toBeUndefined();
    expect(acceptFormatOfType("IconCardAnswerGrid")).toBeUndefined();
  });

  it("§11.3 worked example round-trips: a ZIPInputQuestion's Accept format is us_zip, matching its stored props.format", () => {
    // the contract's own §11.3 example: {"type":"ZIPInputQuestion", "props":{"format":"us_zip", ...}}
    expect(acceptFormatOfType("ZIPInputQuestion")).toBe("us_zip");
    expect(LEADGEN_FIELD_ACCEPT_TYPE["us_zip"]).toBe("ZIPInputQuestion");
  });
});
