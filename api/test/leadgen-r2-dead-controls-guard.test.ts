// R2 F-2 — THE DEAD-CONTROL CLASS GUARD.
//
// THE CLASS. A control that renders in the admin, validates, persists and
// hydrates — but that no consumer ever reads, so the operator changes it and
// nothing happens. It has now shipped four times on this product:
//   • theme.controls.corners      (closed by F-1: record corners -> radius scale)
//   • theme.controls.button_size  (closed by F-2: -> primaryButton.minHeight)
//   • theme.controls.field_height (closed by F-2: -> input.minHeight)
//   • the element-F per-logo Size (closed by F-2: -> the strip size modifier)
// Fixing four instances is worthless if the fifth can land tomorrow. This file
// is the guard that makes the CLASS non-recurring.
//
// HOW IT IS STRUCTURAL, NOT A HAND-LISTED SET. The control names are never
// typed here. They are PARSED out of the declaring TypeScript interfaces
// (`ThemeRecordControls` in designs/theme.ts, `FrameBrandLogoItem` in
// designs/frames.ts), and each control's value vocabulary is resolved from the
// REAL exported enum constant. Add a key to either interface and this suite
// immediately demands that the key move a painted pixel — or carry a written,
// visible exemption.
//
// HOW IT AVOIDS THE HAND-BUILT-BOTH-SIDES FALSE GREEN (E10/E11). Nothing here
// hand-builds an "expected" output. Each probe runs the REAL producer/consumer
// chain end to end and compares the chain's own two outputs to each other:
//   theme control -> real ThemeRecord -> resolveTokens() -> the real
//   funnelChromeCss() stylesheet + the real renderSectionComponents() markup;
//   logo prop -> real effectiveFrame() config -> the real renderQuoteFrame().
// A control is ALIVE iff flipping it (and nothing else) changes those bytes.
//
// SELF-TEST. The last describe block feeds the very same probes a SYNTHETIC new
// dead control — a key the renderers have never heard of — and asserts the
// probe reports it dead. A guard nobody has seen fail is not a guard.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { renderSectionComponents } from "../src/public/leadgen/components/presets";
import type { LeadgenComponentNode } from "../src/public/leadgen/components/content-schema";
import { DEFAULT_FUNNEL_SCOPE, funnelChromeCss } from "../src/public/leadgen/designs/default-funnel/styles";
import { defaultFunnelDesign } from "../src/public/leadgen/designs/default-funnel/tokens";
import { LG_BANNERS_MOUNT_HTML, renderQuoteFrame } from "../src/public/leadgen/designs/frame";
import * as framesModule from "../src/public/leadgen/designs/frames";
import { effectiveFrame } from "../src/public/leadgen/designs/frames";
import type { FrameConfig } from "../src/public/leadgen/designs/frames";
import * as themeModule from "../src/public/leadgen/designs/theme";
import { resolveTokens } from "../src/public/leadgen/designs/theme";
import type { ThemeRecord } from "../src/public/leadgen/designs/theme";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, "..", "src", "public", "leadgen", "designs");

// ---------------------------------------------------------------------------
// The structural enumerator: read an interface's field names + field TYPE TEXT
// straight out of the declaring source file.
// ---------------------------------------------------------------------------

interface DeclaredField {
  name: string;
  typeText: string;
}

function declaredFields(fileAbsPath: string, interfaceName: string): DeclaredField[] {
  const src = readFileSync(fileAbsPath, "utf8");
  const open = src.indexOf(`export interface ${interfaceName} {`);
  expect(open, `interface ${interfaceName} found in ${fileAbsPath}`).toBeGreaterThanOrEqual(0);
  const bodyStart = src.indexOf("{", open) + 1;
  const bodyEnd = src.indexOf("\n}", bodyStart);
  expect(bodyEnd, `interface ${interfaceName} closes`).toBeGreaterThan(bodyStart);
  const out: DeclaredField[] = [];
  for (const rawLine of src.slice(bodyStart, bodyEnd).split("\n")) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("//") || line.startsWith("*") || line.startsWith("/*")) continue;
    const m = /^([A-Za-z_][A-Za-z0-9_]*)\??\s*:\s*(.+?);?$/.exec(line);
    if (m === null || m[1] === undefined || m[2] === undefined) continue;
    out.push({ name: m[1], typeText: m[2].replace(/;$/, "").trim() });
  }
  return out;
}

// A field typed `(typeof SOME_CONST)[number]` names its own vocabulary — read
// the REAL exported array out of the REAL module. Returns null for a plain
// string field (no closed vocabulary to enumerate).
function vocabularyFromTypeText(typeText: string, mod: Record<string, unknown>): readonly string[] | null {
  const m = /\(typeof\s+([A-Za-z_][A-Za-z0-9_]*)\)\[number\]/.exec(typeText);
  if (m === null || m[1] === undefined) return null;
  const value = mod[m[1]];
  expect(Array.isArray(value), `${m[1]} is an exported array on its own module`).toBe(true);
  return value as readonly string[];
}

// designs/theme.ts spells ThemeRecordControls' fields with NAMED aliases
// (`field_height: ThemeRecordFieldHeight`), so the vocabulary is derived from
// the FIELD NAME by that module's own THEME_RECORD_<NAME>S convention. A new
// control whose vocabulary cannot be found this way FAILS here — it can never
// be quietly skipped.
function themeControlVocabulary(field: string): readonly string[] {
  const upper = field.toUpperCase();
  for (const candidate of [`THEME_RECORD_${upper}S`, `THEME_RECORD_${upper}`]) {
    const value = (themeModule as unknown as Record<string, unknown>)[candidate];
    if (Array.isArray(value) && value.length >= 2) return value as readonly string[];
  }
  throw new Error(
    `theme control "${field}" has no exported vocabulary constant ` +
      `(looked for THEME_RECORD_${upper}S / THEME_RECORD_${upper} in designs/theme.ts). ` +
      `Every control must expose its closed value list so this guard can drive it.`,
  );
}

// ---------------------------------------------------------------------------
// PROBE 1 — a theme control's painted output.
//
// The full real chain: ThemeRecord -> resolveTokens -> (a) the served
// stylesheet funnelChromeCss builds from the resolved design, (b) the real
// section markup renderSectionComponents builds from the resolved
// theme_controls. Both painted surfaces, both produced by production code.
// ---------------------------------------------------------------------------

const PROBE_NODES: LeadgenComponentNode[] = [
  { type: "FreeTextQuestion", question_id: "probe_text", question_key: "probe", internal_field: "probe" },
  { type: "ContinueButton", question_id: "probe_continue" },
  {
    type: "TwoButtonYesNo",
    question_id: "probe_yesno",
    question_key: "yn",
    internal_field: "yn",
    answer_type: "boolean",
  },
];

function themeRecordWith(controls: Record<string, string>): ThemeRecord {
  return {
    id: "thm_probe",
    name: "Probe",
    roles: {
      brand_primary: "#0B5FFF",
      accent: "#AA3300",
      page_bg: "#F4F6F9",
      card: "#F9FAFC",
      text: "#101828",
      success: "#127A3B",
      error: "#B42318",
    },
    typography: { headline_font: "Inter", body_font: "Inter", base_px: 16 },
    controls: controls as unknown as ThemeRecord["controls"],
  };
}

function paintedForThemeControls(controls: Record<string, string>): string {
  const record = themeRecordWith(controls);
  const tokens = resolveTokens(defaultFunnelDesign, { theme_id: record.id }, null, record);
  const css = funnelChromeCss(tokens.design, DEFAULT_FUNNEL_SCOPE, { frameRegions: true });
  const html = renderSectionComponents(PROBE_NODES, tokens.design as typeof defaultFunnelDesign, {
    headline_text: "",
    subheadline_text: null,
    theme_controls: tokens.theme_controls,
  });
  return `${css}\n${html}`;
}

// The record every probe mutates ONE key of (all three real defaults).
const BASE_CONTROLS: Record<string, string> = { field_height: "medium", button_size: "m", corners: "rounded" };

// ---------------------------------------------------------------------------
// PROBE 2 — an element-F brand-logo prop's painted output, through the real
// effectiveFrame() -> renderQuoteFrame() composition.
// ---------------------------------------------------------------------------

const FRAME_TOKENS = resolveTokens(defaultFunnelDesign);

// A prop that is only reachable when a SIBLING prop is absent needs that
// sibling omitted from its probe base — declared here, with the reason, so the
// exemption is visible rather than buried in a helper.
const LOGO_PROBE_OMITS: ReadonlyArray<{ prop: string; omit: string; reason: string }> = [
  {
    prop: "url",
    omit: "media_id",
    reason:
      "frame.ts renderBrandLogos resolves media_id FIRST and only falls back to url — a probe that sets both could never observe url move the paint.",
  },
];

const BASE_LOGO_ITEM: Record<string, unknown> = {
  media_id: "probe-logo-key",
  url: "/media/probe-logo-url",
  alt: "Probe logo",
  size: "m",
};

function paintedForLogoItem(item: Record<string, unknown>): string {
  const patch = {
    brand_logos: { enabled: true, layout: "row", slot: "below_section", items: [item] },
  } as unknown as FrameConfig;
  const { frame, problems } = effectiveFrame("centered", patch);
  expect(problems, `probe frame config validates: ${JSON.stringify(problems)}`).toEqual([]);
  return renderQuoteFrame({
    effectiveTokens: FRAME_TOKENS,
    frame,
    siteBranding: null,
    sectionsHtml: "",
    bannersMountHtml: LG_BANNERS_MOUNT_HTML,
    sectionCount: 2,
    root: {
      funnelId: "lgf_0000000000000000000GUARD01",
      funnelVariantId: "lgn_0000000000000000000GUARD02",
      quoteId: "lgq_0000000000000000000GUARD03",
      contentVersion: 1,
    },
  });
}

// Two DISTINCT probe values for a field: its real enum's first two members, or
// two distinct strings for a free string field.
function probeValues(typeText: string, mod: Record<string, unknown>): [unknown, unknown] {
  const vocab = vocabularyFromTypeText(typeText, mod);
  if (vocab !== null) {
    expect(vocab.length, `vocabulary for ${typeText} has at least 2 members`).toBeGreaterThanOrEqual(2);
    return [vocab[0], vocab[1]];
  }
  return ["probe-alpha-value", "probe-beta-value"];
}

// ---------------------------------------------------------------------------
// THE ALLOWLIST — a control that deliberately paints nothing.
//
// EMPTY BY DESIGN. An entry needs a written `reason` (enforced below), so an
// exemption can never be a silent one-word skip. "It is not wired yet" is not
// a reason: the rule this file enforces is that a control the operator can
// change either governs something measurable or is not offered at all.
// ---------------------------------------------------------------------------
const NON_PAINTING_ALLOWLIST: ReadonlyArray<{ control: string; reason: string }> = [];

// ---------------------------------------------------------------------------
// The reusable probes (exercised by the real suites AND by the self-test).
// ---------------------------------------------------------------------------

function deadThemeControls(controls: ReadonlyArray<{ name: string; vocabulary: readonly string[] }>): string[] {
  const dead: string[] = [];
  for (const control of controls) {
    const painted = new Set(
      control.vocabulary.map((value) => paintedForThemeControls({ ...BASE_CONTROLS, [control.name]: value })),
    );
    if (painted.size === 1) dead.push(control.name);
  }
  return dead;
}

function deadLogoProps(props: ReadonlyArray<{ name: string; values: readonly [unknown, unknown] }>): string[] {
  const dead: string[] = [];
  for (const prop of props) {
    const omit = LOGO_PROBE_OMITS.find((o) => o.prop === prop.name)?.omit;
    const base: Record<string, unknown> = { ...BASE_LOGO_ITEM };
    if (omit !== undefined) delete base[omit];
    const painted = new Set(prop.values.map((value) => paintedForLogoItem({ ...base, [prop.name]: value })));
    if (painted.size === 1) dead.push(prop.name);
  }
  return dead;
}

// ---------------------------------------------------------------------------
// 1. Every theme control governs a painted output.
// ---------------------------------------------------------------------------

describe("R2 F-2 dead-control guard — theme.controls", () => {
  const fields = declaredFields(path.join(SRC, "theme.ts"), "ThemeRecordControls");

  it("enumerates the controls STRUCTURALLY from the ThemeRecordControls interface (never a hand-listed set)", () => {
    expect(fields.length).toBeGreaterThanOrEqual(3);
    expect(fields.map((f) => f.name).sort()).toEqual(["button_size", "corners", "field_height"]);
    // The base every probe mutates one key of must itself be complete — a new
    // control with no base value would silently probe a malformed record.
    for (const field of fields) {
      expect(Object.keys(BASE_CONTROLS), `BASE_CONTROLS covers ${field.name}`).toContain(field.name);
    }
  });

  it("every allowlisted exemption carries a written reason (an exemption is never a bare skip)", () => {
    for (const entry of NON_PAINTING_ALLOWLIST) {
      expect(entry.reason.trim().length, `allowlist entry ${entry.control} states why`).toBeGreaterThan(20);
    }
  });

  it("EVERY declared control changes the painted stylesheet+markup when the operator changes it", () => {
    const allowlisted = new Set(NON_PAINTING_ALLOWLIST.map((a) => a.control));
    const probed = fields
      .filter((f) => !allowlisted.has(f.name))
      .map((f) => ({ name: f.name, vocabulary: themeControlVocabulary(f.name) }));
    expect(probed.length).toBeGreaterThanOrEqual(3);
    expect(deadThemeControls(probed)).toEqual([]);
  });

  // Per-control named legs, so a regression names the guilty knob in its title
  // rather than hiding inside a set comparison.
  it("field_height moves the painted field box (44 / 52 / 60 — the §10.4 shared size language)", () => {
    const heights = themeControlVocabulary("field_height").map((value) => {
      const painted = paintedForThemeControls({ ...BASE_CONTROLS, field_height: value });
      const m = /\.lg-input\{[^}]*min-height:([0-9]+px)/.exec(painted);
      return m?.[1];
    });
    expect(heights).toEqual(["44px", "52px", "60px"]);
  });

  it("button_size moves the painted primary/continue pill (44 / 52 / 60, the same ladder)", () => {
    const heights = themeControlVocabulary("button_size").map((value) => {
      const painted = paintedForThemeControls({ ...BASE_CONTROLS, button_size: value });
      const m = /\.lg-btn\{[^}]*min-height:([0-9]+px)/.exec(painted);
      return m?.[1];
    });
    expect(heights).toEqual(["44px", "52px", "60px"]);
  });

  it("corners still moves the painted radius (the F-1 fix stays closed)", () => {
    const radii = themeControlVocabulary("corners").map((value) => {
      const painted = paintedForThemeControls({ ...BASE_CONTROLS, corners: value });
      const m = /\.lg-question-card\{[^}]*border-radius:([0-9]+px)/.exec(painted);
      return m?.[1];
    });
    expect(new Set(radii).size).toBe(radii.length);
  });

  it("the two size ladders are ONE table — the theme tier and the per-node override tier cannot drift", () => {
    expect(Object.values(themeModule.THEME_RECORD_FIELD_HEIGHT_TO_MIN_HEIGHT)).toEqual(
      Object.values(themeModule.THEME_RECORD_BUTTON_SIZE_TO_MIN_HEIGHT),
    );
  });

  it("no theme record (an inline-themed or unthemed funnel) is byte-identical — the appliers are record-only", () => {
    const withoutRecord = resolveTokens(defaultFunnelDesign);
    expect(withoutRecord.design.input.minHeight).toBe(defaultFunnelDesign.input.minHeight);
    expect(withoutRecord.design.primaryButton.minHeight).toBe(defaultFunnelDesign.primaryButton.minHeight);
  });
});

// ---------------------------------------------------------------------------
// 2. Every element-F per-logo prop governs a painted output.
// ---------------------------------------------------------------------------

describe("R2 F-2 dead-control guard — element F per-logo props", () => {
  const fields = declaredFields(path.join(SRC, "frames.ts"), "FrameBrandLogoItem");

  it("enumerates the logo props STRUCTURALLY from the FrameBrandLogoItem interface", () => {
    expect(fields.map((f) => f.name).sort()).toEqual(["alt", "media_id", "size", "url"]);
    for (const field of fields) {
      expect(Object.keys(BASE_LOGO_ITEM), `BASE_LOGO_ITEM covers ${field.name}`).toContain(field.name);
    }
  });

  it("every probe-omission carries a written reason", () => {
    for (const entry of LOGO_PROBE_OMITS) {
      expect(entry.reason.trim().length, `omission ${entry.prop} states why`).toBeGreaterThan(20);
    }
  });

  it("EVERY declared per-logo prop changes the rendered frame when the operator changes it", () => {
    const probed = fields.map((f) => ({
      name: f.name,
      values: probeValues(f.typeText, framesModule as unknown as Record<string, unknown>),
    }));
    expect(deadLogoProps(probed)).toEqual([]);
  });

  it("per-logo Size reaches the strip as its own modifier class (it used to be dropped by renderBrandLogos)", () => {
    const sizes = framesModule.FRAME_SIZES;
    for (const size of sizes) {
      expect(paintedForLogoItem({ ...BASE_LOGO_ITEM, size })).toContain(
        `lg-logo-strip-img lg-logo-strip-img--${size}`,
      );
    }
    // …and the stylesheet actually gives each class a distinct height.
    const css = funnelChromeCss(defaultFunnelDesign, DEFAULT_FUNNEL_SCOPE, { frameRegions: true });
    const heights = sizes.map((size) => {
      const m = new RegExp(
        `\\.lg-frame-brand-logos \\.lg-logo-strip-img--${size}\\{max-height:([0-9]+px)\\}`,
      ).exec(css);
      return m?.[1];
    });
    expect(new Set(heights).size, `distinct heights, got ${JSON.stringify(heights)}`).toBe(sizes.length);
    // Each ladder rule must MATCH the specificity of the sibling that would
    // otherwise out-rank it, and follow it in source order.
    const base = css.indexOf(".lg-frame-brand-logos .lg-logo-strip-img{");
    expect(base, "the descendant brand-logos rule is present").toBeGreaterThanOrEqual(0);
    for (const size of sizes) {
      const at = css.indexOf(`.lg-frame-brand-logos .lg-logo-strip-img--${size}{`);
      expect(at, `ladder rule for ${size} follows the base rule`).toBeGreaterThan(base);
    }
  });

  it("a logo with NO size emits no modifier class (every pre-F-2 strip is byte-identical)", () => {
    const noSize = { ...BASE_LOGO_ITEM };
    delete noSize["size"];
    const html = paintedForLogoItem(noSize);
    expect(html).toContain('class="lg-logo-strip-img"');
    expect(html).not.toContain("lg-logo-strip-img--");
  });
});

// ---------------------------------------------------------------------------
// 3. THE GUARD'S OWN PROOF — it fails on a synthetic NEW dead control.
//
// Each leg feeds the SAME probe a control the renderers have never heard of
// (the exact shape a future dead knob would have: a real vocabulary, a real
// write into the record/config, and no consumer). A green here means the guard
// above is load-bearing rather than decorative.
// ---------------------------------------------------------------------------

describe("R2 F-2 dead-control guard — the guard itself fails on a NEW dead control", () => {
  it("a synthetic theme control that no consumer reads is reported DEAD", () => {
    const synthetic = { name: "shadow_depth", vocabulary: ["sharp", "rounded", "pill"] };
    expect(deadThemeControls([synthetic])).toEqual(["shadow_depth"]);
    // …and the same probe still calls the three REAL controls alive, so the
    // detector is discriminating, not universally negative.
    expect(
      deadThemeControls([
        { name: "field_height", vocabulary: themeControlVocabulary("field_height") },
        { name: "button_size", vocabulary: themeControlVocabulary("button_size") },
        { name: "corners", vocabulary: themeControlVocabulary("corners") },
      ]),
    ).toEqual([]);
  });

  it("a synthetic per-logo prop that renderBrandLogos drops is reported DEAD", () => {
    expect(deadLogoProps([{ name: "shadow_size", values: ["s", "l"] }])).toEqual(["shadow_size"]);
    expect(deadLogoProps([{ name: "size", values: ["s", "l"] }])).toEqual([]);
  });

  it("a NEW theme control with no exported vocabulary constant fails loudly (never silently skipped)", () => {
    expect(() => themeControlVocabulary("shadow_depth")).toThrow(/no exported vocabulary constant/);
  });
});
