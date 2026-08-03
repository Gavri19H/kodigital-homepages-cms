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
// R2 F-3 — THE SECOND HALF OF THE CLASS: A CONTROL THAT PAINTS, THEN IS LOST.
//
// The probes above prove "this control has a consumer". That is NOT the whole
// class, and the hole let two more instances ship: `field_height` and
// `button_size` painted correctly under a {theme_id} preset and were then
// DISCARDED the instant the operator's first Themes-rail edit forked
// theme_json into inline values (measured on the live page: field min-height
// 60px -> 44px, button 60px -> 52px, after editing one colour). From the
// operator's chair a control whose effect evaporates on the next unrelated edit
// is as dead as one that never painted.
//
// So every theme control is ALSO driven through the REAL fork — the shipped
// island source themePresetResolveSnippet() evaluated and called, then its
// output through the REAL validateTheme + resolveTokens + the same painted
// surfaces — and must paint the SAME bytes on both sides. Nothing is hand-built
// on either side of that boundary (E11): the preset side is a real record, the
// inline side is whatever the shipped island actually produced from it.
//
// SELF-TEST. The last describe block feeds the very same probes a SYNTHETIC new
// dead control — a key the renderers have never heard of — and asserts the
// probe reports it dead; and a SYNTHETIC control that paints but is dropped by
// the fork resolver, asserting the fork probe reports it LOST. A guard nobody
// has seen fail is not a guard.
//
// ===========================================================================
// R2 P8 M2 part B (root cause R3) — WHAT THE BLOCKS ABOVE COULD NOT SEE, AND
// THE SWEEP THAT NOW DOES. (Read §4 "THE SWEEP" near the bottom of this file.)
// ===========================================================================
//
// Everything above enumerates exactly TWO interfaces — `ThemeRecordControls`
// (3 keys) and `FrameBrandLogoItem` (4) — and its predicate is "flipping the
// key changes the stylesheet/markup BYTES". Both halves were wrong:
//   • BLIND. All 34 inline `theme_json` keys, the other 22 `ThemeRecord` keys
//     and every FrameConfig group key were outside the enumeration — and that
//     is exactly where the four dead controls R3 measured lived.
//   • WRONG PREDICATE. A byte diff is not a visitor seeing something.
//     `card_defaults.border_role` DID change bytes at HEAD — on `.lg-card-panel`,
//     which no driven funnel page renders. `card_defaults.radius` changed bytes
//     on `.lg-frame-disclosure--modal .lg-disclosure-panel`, measured 0x0.
//     `scales.shadow` changed bytes on that same hidden panel. All three would
//     have passed the byte predicate even after the key list was extended.
//
// The sweep at the bottom of this file adds — never replaces (every assertion
// above stands) — a second predicate over a source-derived enumeration of the
// WHOLE authorable design-key universe: a key is alive only when flipping it
// changes a value the cascade computes for an element the REAL markup contains
// and that is not switched off. The machinery is
// test/helpers/leadgen-visible-paint.ts; read its limitations banner before
// citing any of this as evidence — it is a static resolver, not a browser.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createContext, runInContext } from "node:vm";

import { describe, expect, it } from "vitest";

import {
  declaredFields as declaredFieldsOf,
  visibleDiffAnyViewport,
  visibleFingerprint,
  visiblePage,
  typeAliasRhs,
  vocabularyOf,
  type DeclaredField as HelperDeclaredField,
} from "./helpers/leadgen-visible-paint";

import { themePresetResolveSnippet } from "../src/admin/leadgen/quotes-tabs/theme-preset-resolve";

import { renderSectionComponents } from "../src/public/leadgen/components/presets";
import type { LeadgenComponentNode } from "../src/public/leadgen/components/content-schema";
import { DEFAULT_FUNNEL_SCOPE, funnelChromeCss } from "../src/public/leadgen/designs/default-funnel/styles";
import { defaultFunnelDesign } from "../src/public/leadgen/designs/default-funnel/tokens";
import { LG_BANNERS_MOUNT_HTML, renderQuoteFrame } from "../src/public/leadgen/designs/frame";
import * as framesModule from "../src/public/leadgen/designs/frames";
import { effectiveFrame } from "../src/public/leadgen/designs/frames";
import type { FrameConfig } from "../src/public/leadgen/designs/frames";
import * as themeModule from "../src/public/leadgen/designs/theme";
import { resolveTokens, validateTheme } from "../src/public/leadgen/designs/theme";
import type { ThemeJson, ThemeRecord } from "../src/public/leadgen/designs/theme";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, "..", "src", "public", "leadgen", "designs");

// ---------------------------------------------------------------------------
// The structural enumerator: read an interface's field names + field TYPE TEXT
// straight out of the declaring source file.
// ---------------------------------------------------------------------------

type DeclaredField = HelperDeclaredField;

// ONE implementation of "read an interface's fields out of its declaring
// source" now lives in test/helpers/leadgen-visible-paint.ts (the sweep at the
// bottom of this file needs the same parse). This wrapper keeps the original
// call sites and their assertion messages byte-for-byte: a missing/unclosed
// interface still fails the suite, now by throw rather than by expect().
function declaredFields(fileAbsPath: string, interfaceName: string): DeclaredField[] {
  const fields = declaredFieldsOf(fileAbsPath, interfaceName);
  expect(fields.length, `interface ${interfaceName} declares fields in ${fileAbsPath}`).toBeGreaterThan(0);
  return fields;
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

// ---------------------------------------------------------------------------
// PROBE 1b (R2 F-3) — the SAME painted surfaces, on the far side of the
// preset -> inline FORK.
//
// The fork is performed by the REAL shipped island: theme-preset-resolve.ts
// exports the ES5 source text both admin islands interpolate verbatim, so
// evaluating it and calling inlineThemeFromPreset runs the same bytes the
// operator's browser runs. Its product then goes through the REAL validateTheme
// (the PUT that follows it in the island is gated by exactly this function) and
// the REAL resolveTokens with `record` NULL — because after the fork the record
// is out of resolution entirely, which is precisely why an uncarried value was
// lost.
// ---------------------------------------------------------------------------

type InlineFromPreset = (rec: unknown) => Record<string, unknown>;

function loadPresetResolveIsland(): InlineFromPreset {
  // Statement text meant to be inlined into an IIFE: it only DECLARES (its one
  // fetch lives inside a function body), so evaluating it in a fresh isolated
  // context and handing back the declared function is what the browser does.
  const sandbox = createContext({});
  return runInContext(`${themePresetResolveSnippet()}\ninlineThemeFromPreset;`, sandbox, {
    filename: "theme-preset-resolve.island.js",
  }) as InlineFromPreset;
}

const inlineThemeFromPreset = loadPresetResolveIsland();

// Every leaf of the resolved design, as `path -> value`. Comparing WHOLE
// painted pages across the fork would be meaningless — a preset and an inline
// theme legitimately differ elsewhere (typography.base_px has no inline
// counterpart at all) — so the probe below compares only the tokens the control
// under test actually moves.
function flattenTokens(value: unknown, prefix = "", out: Map<string, string> = new Map()): Map<string, string> {
  if (value === null || typeof value !== "object") {
    out.set(prefix, String(value));
    return out;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    flattenTokens(child, prefix === "" ? key : `${prefix}.${key}`, out);
  }
  return out;
}

function tokensForRecordControls(controls: Record<string, string>): Map<string, string> {
  const record = themeRecordWith(controls);
  return flattenTokens(resolveTokens(defaultFunnelDesign, { theme_id: record.id }, null, record).design);
}

// The forked product of a record, through the REAL island + the REAL validator
// + the REAL resolver with `record` null (after the fork the record is out of
// resolution entirely — which is exactly why an uncarried value was lost).
function tokensAfterFork(
  controls: Record<string, string>,
  fork: InlineFromPreset = inlineThemeFromPreset,
): Map<string, string> {
  const inline = fork(themeRecordWith(controls));
  const validation = validateTheme(inline);
  expect(
    validation.problems.filter((p) => p.severity === "error"),
    `the fork's product is a LEGAL inline theme (the island PUTs it): ${JSON.stringify(inline)}`,
  ).toEqual([]);
  return flattenTokens(resolveTokens(defaultFunnelDesign, validation.theme, null, null).design);
}

// A control is LOST-ACROSS-THE-FORK iff some value of it moves design tokens
// under the preset and those SAME tokens do not land on the SAME values after
// the fork. Deriving the watched token set from the control's own effect keeps
// this structural (no hand-listed "field_height owns input.minHeight" table)
// while still catching a carry that is dropped, collapsed OR mis-mapped.
function lostAcrossFork(
  controls: ReadonlyArray<{ name: string; vocabulary: readonly string[] }>,
  fork: InlineFromPreset = inlineThemeFromPreset,
): string[] {
  const lost: string[] = [];
  const baseTokens = tokensForRecordControls(BASE_CONTROLS);
  for (const control of controls) {
    for (const value of control.vocabulary) {
      const withValue = { ...BASE_CONTROLS, [control.name]: value };
      const presetTokens = tokensForRecordControls(withValue);
      const moved = [...presetTokens.keys()].filter((k) => presetTokens.get(k) !== baseTokens.get(k));
      if (moved.length === 0) continue; // this value IS the base value (or the control is dead — probe 1's job)
      const forked = tokensAfterFork(withValue, fork);
      if (moved.some((k) => forked.get(k) !== presetTokens.get(k))) {
        lost.push(control.name);
        break;
      }
    }
  }
  return lost;
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

  it("no theme at all (an unthemed funnel) is byte-identical — every applier is opt-in", () => {
    const withoutRecord = resolveTokens(defaultFunnelDesign);
    expect(withoutRecord.design.input.minHeight).toBe(defaultFunnelDesign.input.minHeight);
    expect(withoutRecord.design.input.padding).toBe(defaultFunnelDesign.input.padding);
    expect(withoutRecord.design.primaryButton.minHeight).toBe(defaultFunnelDesign.primaryButton.minHeight);
    expect(withoutRecord.theme_controls).toBeUndefined();
    // …and an inline theme that authors NEITHER size axis is equally untouched.
    const colourOnly = resolveTokens(defaultFunnelDesign, { palette: { brand_primary: "#123456" } }, null, null);
    expect(colourOnly.design.input.minHeight).toBe(defaultFunnelDesign.input.minHeight);
    expect(colourOnly.design.input.padding).toBe(defaultFunnelDesign.input.padding);
    expect(colourOnly.design.primaryButton.minHeight).toBe(defaultFunnelDesign.primaryButton.minHeight);
    expect(colourOnly.theme_controls).toBeUndefined();
  });

  // R2 F-3 — the ladder must be VISIBLE, not merely declared. A floor under the
  // field's own intrinsic box paints nothing (measured 54/54/60 for
  // small/medium/large at HEAD), so each rung carries the padding that puts the
  // intrinsic box ON the rung. Asserted as the arithmetic the browser performs:
  // 2*padding + the 22px non-padding chrome == the floor.
  it("field_height's three rungs are VISIBLY distinct — padding tracks the floor (not just a declared min-height)", () => {
    const seen = themeControlVocabulary("field_height").map((value) => {
      const painted = paintedForThemeControls({ ...BASE_CONTROLS, field_height: value });
      const rule = /\.lg-input\{([^}]*)\}/.exec(painted)?.[1] ?? "";
      const minHeight = /min-height:([0-9]+)px/.exec(rule)?.[1];
      const padding = /padding:([0-9]+)px ([0-9]+)px/.exec(rule);
      return {
        value,
        minHeight: Number(minHeight),
        padBlock: Number(padding?.[1]),
        padInline: padding?.[2],
      };
    });
    for (const step of seen) {
      expect(2 * step.padBlock + 22, `field_height=${step.value} paints its own floor`).toBe(step.minHeight);
      // The horizontal padding is the design's own, never rewritten.
      expect(step.padInline, `field_height=${step.value} keeps the design's side padding`).toBe("18");
    }
    expect(seen.map((s) => s.minHeight)).toEqual([44, 52, 60]);
    expect(new Set(seen.map((s) => s.padBlock)).size, "three distinct paddings").toBe(3);
  });
});

// ---------------------------------------------------------------------------
// 1b. R2 F-3 — every theme control SURVIVES the preset -> inline fork.
// ---------------------------------------------------------------------------

describe("R2 F-3 dead-control guard — theme.controls survive the preset -> inline fork", () => {
  const fields = declaredFields(path.join(SRC, "theme.ts"), "ThemeRecordControls");

  it("EVERY declared control paints the SAME bytes before and after the operator's first rail edit", () => {
    const allowlisted = new Set(NON_PAINTING_ALLOWLIST.map((a) => a.control));
    const probed = fields
      .filter((f) => !allowlisted.has(f.name))
      .map((f) => ({ name: f.name, vocabulary: themeControlVocabulary(f.name) }));
    expect(probed.length).toBeGreaterThanOrEqual(3);
    expect(lostAcrossFork(probed)).toEqual([]);
  });

  // Per-control named legs, so a regression names the guilty knob.
  for (const control of ["field_height", "button_size", "corners"]) {
    it(`${control} survives the fork at every value in its vocabulary`, () => {
      expect(lostAcrossFork([{ name: control, vocabulary: themeControlVocabulary(control) }])).toEqual([]);
    });
  }

  it("the fork's product carries an inline counterpart for every control (never a partial rescue)", () => {
    const inline = inlineThemeFromPreset(
      themeRecordWith({ field_height: "large", button_size: "l", corners: "pill" }),
    );
    expect(inline["field_defaults"]).toEqual({ min_height: "large" });
    expect((inline["button_defaults"] as Record<string, unknown>)["min_height"]).toBe("l");
    expect(inline["scales"]).toEqual({ radius: "round" });
  });

  it("the node tier's inherit-default survives too (theme_controls is published on the forked funnel)", () => {
    const controls = { field_height: "large", button_size: "l", corners: "pill" };
    const before = resolveTokens(defaultFunnelDesign, { theme_id: "thm_probe" }, null, themeRecordWith(controls));
    const inline = validateTheme(inlineThemeFromPreset(themeRecordWith(controls))).theme;
    const after = resolveTokens(defaultFunnelDesign, inline, null, null);
    expect(after.theme_controls?.field_height).toBe(before.theme_controls?.field_height);
    expect(after.theme_controls?.button_size).toBe(before.theme_controls?.button_size);
  });

  it("a record with NO recognisable controls forks to a theme with no size keys (byte-identical to pre-carry)", () => {
    const inline = inlineThemeFromPreset({ ...themeRecordWith({}), controls: {} });
    expect(inline["field_defaults"]).toBeUndefined();
    expect(inline["scales"]).toBeUndefined();
    expect((inline["button_defaults"] as Record<string, unknown> | undefined)?.["min_height"]).toBeUndefined();
    const offTable = inlineThemeFromPreset(
      themeRecordWith({ field_height: "gigantic", button_size: "xxl", corners: "wobbly" }),
    );
    expect(offTable["field_defaults"]).toBeUndefined();
    expect(offTable["scales"]).toBeUndefined();
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

  // R2 F-3 — the fork probe's OWN proof. A control that paints perfectly under
  // the preset but that the fork resolver forgets is the exact shape
  // field_height and button_size had at HEAD; the probe must report it LOST.
  // The synthetic defect is injected where the real one lived: a fork resolver
  // that drops one carry. Everything else — the record, the validator, the
  // renderers — stays the real thing.
  it("a control that PAINTS but is dropped by the fork resolver is reported LOST", () => {
    const forkThatForgetsFieldHeight: InlineFromPreset = (rec) => {
      const inline = inlineThemeFromPreset(rec);
      delete inline["field_defaults"];
      return inline;
    };
    expect(
      lostAcrossFork(
        [{ name: "field_height", vocabulary: themeControlVocabulary("field_height") }],
        forkThatForgetsFieldHeight,
      ),
      "the probe catches a carry the fork resolver dropped",
    ).toEqual(["field_height"]);

    // …and the SAME probe still calls all three real controls survivors, so the
    // detector is discriminating rather than universally negative.
    expect(
      lostAcrossFork([
        { name: "field_height", vocabulary: themeControlVocabulary("field_height") },
        { name: "button_size", vocabulary: themeControlVocabulary("button_size") },
        { name: "corners", vocabulary: themeControlVocabulary("corners") },
      ]),
    ).toEqual([]);
  });

  it("a control the fork carries to the WRONG value is reported LOST (not just an absent key)", () => {
    const forkThatMisMaps: InlineFromPreset = (rec) => {
      const inline = inlineThemeFromPreset(rec);
      inline["field_defaults"] = { min_height: "small" };
      return inline;
    };
    expect(
      lostAcrossFork([{ name: "field_height", vocabulary: themeControlVocabulary("field_height") }], forkThatMisMaps),
    ).toEqual(["field_height"]);
  });
});

// ===========================================================================
// 4. THE SWEEP (R2 P8 M2 part B / root cause R3) — EVERY AUTHORABLE DESIGN KEY,
//    AGAINST A VISIBLE-COMPUTED-VALUE PREDICATE.
// ===========================================================================
//
// THE OWNER'S WORDS this serves: "theme is only design language!!!! colors,
// fonts, sizes" (docs/leadgen/source-of-truth/SOURCE-OF-TRUTH.md). A design-
// language key the operator can change must move something the visitor sees,
// or not be offered at all — R3's corollary, verbatim: "A control that cannot
// be honoured must not be offered."
//
// ---------------------------------------------------------------------------
// THE UNIVERSE, AND WHY IT IS THE WHOLE ONE.
//
// Four times on this programme an enumeration was declared closed over a
// universe nobody had named, and each time the defect lived in the unnamed
// part. So the universe is named here, in full, and its size is ASSERTED
// (ENUMERATED_TOTAL below) — a key added to any of these interfaces tomorrow
// changes the count and fails this file before it can ship unguarded.
//
//   A. INLINE `theme_json` — `ThemeJson`'s members, each expanded through its
//      declaring sub-interface: `palette` (the FUNNEL_TOKEN_ROLES role set),
//      `typography` (ThemeTypography), `scales` (ThemeScales),
//      `button_defaults` (ThemeButtonDefaults), `card_defaults`
//      (ThemeCardDefaults), `field_defaults` (ThemeFieldDefaults).
//      NOT a key: `version?: 1` — a schema discriminator with exactly one
//      legal value and no operator control; asserted below to stay that way.
//   B. THEME RECORDS — `ThemeRecord`'s members: `roles`
//      (THEME_RECORD_ROLE_KEYS), `typography` (ThemeRecordTypography),
//      `controls` (ThemeRecordControls — also covered by the byte probes
//      above), `spacing`, `extra_roles` (THEME_RECORD_EXTRA_ROLE_KEYS) and
//      `button_style` (ThemeRecordButtonStyle).
//      NOT keys: `id` / `name` — record identity, not design language.
//   C. FRAME CONFIG — `EffectiveFrameConfig`'s `template` plus every member
//      whose declared type is a `Frame…Config` group interface, expanded
//      through that interface and one level into any nested `Frame…` object
//      field (header.secure_badge, header.cta, footer.palette_scope,
//      footer.typography_scope).
//   D. ELEMENT-F PER-LOGO PROPS — `FrameBrandLogoItem`, already enumerated and
//      driven by describe block 2 above; counted here, not re-driven.
//
// WHAT THIS UNIVERSE DELIBERATELY EXCLUDES, so no reader infers coverage that
// is not here (each exclusion is asserted as a NAMED, non-empty set below, so
// it cannot silently grow):
//   • ARRAY-VALUED frame fields — `disclosure.entries`, `footer.links`,
//     `footer.blocks`, `trust_strip.logos`, `benefit_bar.items`. Their element
//     shapes are separate interfaces whose per-item keys are their own
//     universe. This file claims exactly ONE of them, FrameBrandLogoItem (D).
//   • The Round-4 P5a optional ELEMENT members of EffectiveFrameConfig —
//     `free_text`, `brand_logos`, `cta_slots`, `trust_rows`, `images`.
//   • Single-member vocabularies (`section_slot.align`,
//     `section_slot.continue_style_role`): an operator cannot change a control
//     with one legal value, so there is no flip to measure. Asserted to be
//     single-membered rather than probed — if a second member is ever added,
//     that assertion fails and the key must join the sweep.
//   • VariantThemeOverrides (layer 3) — a palette-only re-application of the
//     SAME role keys already swept in A.
//
// ---------------------------------------------------------------------------
// THE PREDICATE, AND WHAT IT DOES NOT PROVE.
//
// A key is ALIVE iff, over the REAL producer chain, flipping ONLY that key
// changes visibleDiffAnyViewport(...) — see test/helpers/leadgen-visible-paint.ts
// and READ ITS LIMITATIONS BANNER. In one line: the change must land in a
// declaration that WINS the cascade on an element the real markup actually
// contains and that is not switched off by display/visibility, on itself or on
// any ancestor; or in that element's own visible text / a visitor-perceivable
// attribute. Custom properties are inherited and substituted into the `var()`s
// that read them, then dropped — publishing `--lg-role-x` that nothing reads is
// not paint.
//
// IT IS NOT A BROWSER. It measures no box, so it cannot see layout collapse,
// a 0px-wide panel, overflow clipping or stacking order; it treats every
// pseudo (`:hover`, `:focus-visible`, `::after`, …) as non-matching, so a key
// alive ONLY in a hover state or a generated box reads dead here; it sees only
// server-rendered output, never the runtime island. The live-browser half of
// every claim here is the conductor's driven re-measurement (E6/E10), not this
// lane.
// ---------------------------------------------------------------------------

const THEME_FILE = path.join(SRC, "theme.ts");
const FRAMES_FILE = path.join(SRC, "frames.ts");
const VOCAB_SOURCES = [
  { path: THEME_FILE, mod: themeModule as unknown as Record<string, unknown> },
  { path: FRAMES_FILE, mod: framesModule as unknown as Record<string, unknown> },
];

// Two distinct probe values for an OPEN (free-string) field. Distinct enough
// that a renderer which escapes, truncates or slugifies them still differs.
const PROBE_TEXTS: readonly string[] = ["Probe alpha", "Probe beta"];
// Two distinct colours for a palette/role value.
const PROBE_COLOURS: readonly string[] = ["#112233", "#AA5566"];

interface KeySpec {
  /** The authoring path the operator's control writes, e.g. "card_defaults.radius". */
  key: string;
  group: string;
  values: readonly unknown[];
}

/** The fields of `name` if it is an interface in `file`, else null (a type alias/scalar). */
function interfaceFieldsOrNull(file: string, name: string): DeclaredField[] | null {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return null;
  try {
    return declaredFieldsOf(file, name);
  } catch {
    return null;
  }
}

function vocabularyFor(field: DeclaredField, owner: string, allowFreeText: boolean): readonly unknown[] {
  const vocab = vocabularyOf(field.typeText, VOCAB_SOURCES);
  if (vocab !== null) return vocab;
  // An OPEN type — free author text — possibly reached through one named alias
  // (`ThemeRecordSpacing = string`). Driven with two distinct strings: an open
  // field still has to reach the page.
  const resolved = /^[A-Za-z_][A-Za-z0-9_]*$/.test(field.typeText)
    ? (typeAliasRhs(THEME_FILE, field.typeText) ?? typeAliasRhs(FRAMES_FILE, field.typeText) ?? field.typeText)
    : field.typeText;
  if (allowFreeText && /^(string|string \| null)$/.test(resolved)) return PROBE_TEXTS;
  throw new Error(
    `"${owner}.${field.name}" is declared \`${field.typeText}\`, which names no closed vocabulary this guard ` +
      `can drive. Give the field a \`(typeof CONST)[number]\` type (or a named alias of one) so every control ` +
      `exposes its value list — a key this guard cannot drive is a key it cannot prove alive.`,
  );
}

// A role MAP member (`Partial<Record<FunnelTokenRole, …>>`, possibly reached
// through one named alias such as `ThemeRecordRoles`) expands into ONE key per
// role — the operator edits roles individually, so the guard must too.
function expandRoleMap(typeTextRaw: string): readonly string[] | null {
  let typeText = typeTextRaw;
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(typeText)) {
    typeText = typeAliasRhs(THEME_FILE, typeText) ?? typeAliasRhs(FRAMES_FILE, typeText) ?? typeText;
  }
  const m = typeText.match(/^(?:Partial<)?Record<([A-Za-z_][A-Za-z0-9_]*),/);
  if (m === null) return null;
  const roles = vocabularyOf(m[1] as string, VOCAB_SOURCES);
  if (roles === null) throw new Error(`role map key type "${m[1]}" resolves to no exported vocabulary`);
  return roles as readonly string[];
}

// --- A. inline theme_json -------------------------------------------------

const THEME_JSON_NON_KEYS: ReadonlyArray<{ member: string; reason: string }> = [
  {
    member: "version",
    reason:
      "`version?: 1` is the schema discriminator: exactly one legal value, so there is nothing an operator can flip and no control offers it.",
  },
];

function themeJsonKeys(): KeySpec[] {
  const skipped = new Set(THEME_JSON_NON_KEYS.map((n) => n.member));
  const out: KeySpec[] = [];
  for (const member of declaredFields(THEME_FILE, "ThemeJson")) {
    if (skipped.has(member.name)) continue;
    const roles = expandRoleMap(member.typeText);
    if (roles !== null) {
      for (const role of roles) out.push({ group: member.name, key: `${member.name}.${role}`, values: PROBE_COLOURS });
      continue;
    }
    for (const leaf of declaredFields(THEME_FILE, member.typeText)) {
      out.push({
        group: member.name,
        key: `${member.name}.${leaf.name}`,
        values: vocabularyFor(leaf, member.typeText, false),
      });
    }
  }
  return out;
}

// --- B. theme records -----------------------------------------------------

const THEME_RECORD_NON_KEYS: ReadonlyArray<{ member: string; reason: string }> = [
  { member: "id", reason: "the KV record's identity, written by the store, never a design value the operator paints with." },
  { member: "name", reason: "the preset's label in the picker; it names the record, it does not style the funnel." },
];

function themeRecordKeys(): KeySpec[] {
  const skipped = new Set(THEME_RECORD_NON_KEYS.map((n) => n.member));
  const out: KeySpec[] = [];
  for (const member of declaredFields(THEME_FILE, "ThemeRecord")) {
    if (skipped.has(member.name)) continue;
    const roles = expandRoleMap(member.typeText);
    if (roles !== null) {
      for (const role of roles) out.push({ group: member.name, key: `${member.name}.${role}`, values: PROBE_COLOURS });
      continue;
    }
    const leaves = interfaceFieldsOrNull(THEME_FILE, member.typeText);
    if (leaves === null) {
      // A scalar member of the record itself (e.g. `spacing`).
      out.push({ group: member.name, key: member.name, values: vocabularyFor(member, "ThemeRecord", true) });
      continue;
    }
    for (const leaf of leaves) {
      out.push({
        group: member.name,
        key: `${member.name}.${leaf.name}`,
        values: vocabularyFor(leaf, member.typeText, true),
      });
    }
  }
  return out;
}

// --- C. frame config ------------------------------------------------------

// EXCLUDED, by name, with the reason. Each list is asserted NON-EMPTY and
// EXACT below, so it cannot quietly absorb a new member.
const FRAME_NON_KEYS: ReadonlyArray<{ member: string; reason: string }> = [
  { member: "version", reason: "`version: 1` is the schema discriminator — one legal value, no control." },
  {
    member: "compat",
    reason:
      "FrameCompatConfig is swept as a group like every other; listed here only so this table stays exhaustive over EffectiveFrameConfig.",
  },
];
const FRAME_ELEMENT_MEMBERS: readonly string[] = ["free_text", "brand_logos", "cta_slots", "trust_rows", "images"];
const FRAME_ARRAY_FIELDS: readonly string[] = [
  "disclosure.entries",
  "footer.links",
  "footer.blocks",
  "trust_strip.logos",
  "benefit_bar.items",
];
const FRAME_SINGLE_VALUE_FIELDS: readonly string[] = ["section_slot.align", "section_slot.continue_style_role"];

/** The `Frame…Config` group members of EffectiveFrameConfig, source-derived. */
function frameGroupMembers(): DeclaredField[] {
  return declaredFields(FRAMES_FILE, "EffectiveFrameConfig").filter(
    (m) => !FRAME_ELEMENT_MEMBERS.includes(m.name) && /^Frame[A-Za-z]+Config$/.test(m.typeText),
  );
}

function frameConfigKeys(): { keys: KeySpec[]; arrays: string[]; singles: string[] } {
  const keys: KeySpec[] = [
    { group: "template", key: "template", values: vocabularyFor(
      { name: "template", typeText: "FrameTemplateId", optional: false }, "EffectiveFrameConfig", false) },
  ];
  const arrays: string[] = [];
  const singles: string[] = [];
  for (const group of frameGroupMembers()) {
    for (const field of declaredFields(FRAMES_FILE, group.typeText)) {
      const dotted = `${group.name}.${field.name}`;
      if (/\[\]$/.test(field.typeText)) {
        arrays.push(dotted);
        continue;
      }
      const nested = interfaceFieldsOrNull(FRAMES_FILE, field.typeText);
      if (nested !== null) {
        for (const leaf of nested) {
          keys.push({
            group: group.name,
            key: `${dotted}.${leaf.name}`,
            values: vocabularyFor(leaf, field.typeText, true),
          });
        }
        continue;
      }
      const values = vocabularyFor(field, group.typeText, true);
      if (values.length < 2) {
        singles.push(dotted);
        continue;
      }
      keys.push({ group: group.name, key: dotted, values });
    }
  }
  return { keys, arrays, singles };
}

// ---------------------------------------------------------------------------
// THE PROBE PAGES. Both are the REAL composition a visitor is served:
// resolveTokens -> funnelChromeCss for the sheet, renderSectionComponents
// wrapped by renderQuoteFrame for the markup. Nothing is hand-built.
// ---------------------------------------------------------------------------

// The section an authored funnel page actually has: a bound headline and
// subheadline, a text field, the Continue control and an answer pair — the
// exact surfaces R3's live measurements were read from. It deliberately does
// NOT place a CardPanel or a DisclosureLink panel: those are the components
// `card_defaults` used to steer ALONE, and a probe page that rendered them
// would credit the very mis-target this predicate exists to catch. Asserted
// below.
const SWEEP_NODES: LeadgenComponentNode[] = [
  { type: "QuestionHeadline", question_id: "sweep_h", bind: "section_headline" },
  { type: "Subheadline", question_id: "sweep_s", bind: "section_subheadline" },
  { type: "FreeTextQuestion", question_id: "sweep_text", question_key: "sw", internal_field: "sw" },
  { type: "ContinueButton", question_id: "sweep_continue" },
  {
    type: "TwoButtonYesNo",
    question_id: "sweep_yesno",
    question_key: "swyn",
    internal_field: "swyn",
    answer_type: "boolean",
  },
] as unknown as LeadgenComponentNode[];

interface SweepPage {
  css: string;
  html: string;
}

function sweepPage(opts: {
  theme?: ThemeJson | { theme_id: string };
  record?: ThemeRecord | null;
  template?: string;
  frame?: Record<string, unknown>;
}): SweepPage {
  const tokens = resolveTokens(
    defaultFunnelDesign,
    (opts.theme ?? {}) as ThemeJson,
    null,
    opts.record ?? null,
  );
  const css = funnelChromeCss(tokens.design, DEFAULT_FUNNEL_SCOPE, { frameRegions: true });
  const { frame, problems } = effectiveFrame(
    (opts.template ?? "centered") as never,
    (opts.frame ?? {}) as unknown as FrameConfig,
  );
  expect(
    problems.filter((p) => p.severity === "error"),
    `the probe frame config validates: ${JSON.stringify(problems)}`,
  ).toEqual([]);
  const sections = renderSectionComponents(SWEEP_NODES, tokens.design as typeof defaultFunnelDesign, {
    headline_text: "Probe headline",
    subheadline_text: "Probe subheadline",
    theme_controls: tokens.theme_controls,
    // serve.ts:712 wires the frame's slot placement into the section render
    // context; the probe mirrors that so `section_slot.continue_placement` is
    // measured on the same seam the live route uses.
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
      funnelId: "lgf_0000000000000000000GUARD01",
      funnelVariantId: "lgn_0000000000000000000GUARD02",
      quoteId: "lgq_0000000000000000000GUARD03",
      contentVersion: 1,
    },
  });
  return { css, html };
}

// The record every ThemeRecord probe mutates ONE key of.
const SWEEP_RECORD_BASE = (): ThemeRecord => themeRecordWith(BASE_CONTROLS);

// ---------------------------------------------------------------------------
// DECLARED PROBE CONTEXTS — the LOGO_PROBE_OMITS idiom, generalised.
//
// A key whose surface only exists when a SIBLING setting selects it cannot be
// measured on a page where that sibling is at its default. That is a property
// of the probe, not of the key, so the context is declared HERE with its
// reason rather than buried in a helper — and the key is still required to
// paint.
// ---------------------------------------------------------------------------

const THEME_PROBE_CONTEXT: ReadonlyArray<{ match: RegExp; reason: string }> = [
  {
    match: /^(palette|roles|extra_roles)\./,
    reason:
      "A colour ROLE is a value the operator points controls at; it paints wherever it is selected. The probe selects the role under test on the frame's own Progress colour control (its vocabulary IS FunnelTokenRole) so the role is IN USE on a region the default template renders. What this proves: the role's value reaches paint. What it does not prove: that every surface the role's LABEL promises consumes it.",
  },
];

// A frame key cannot paint out of a group the operator has not switched on:
// `disclosure.location` moves nothing while the disclosure is disabled, and a
// trust strip with no logos renders no strip. So the frame sweep runs against a
// base that turns every group ON with a minimal real payload — the state an
// operator reaches by using the Templates tab — and then flips ONE key of it.
// This base is NOT used for the theme sweep: that one deliberately runs on the
// bare `centered` default, which renders no card-panel/disclosure-panel for a
// mis-targeted theme key to hide behind.
const FRAME_PROBE_BASE: Record<string, unknown> = {
  compat: { allow_section_chrome: true },
  header: {
    enabled: true,
    logo_source: "manual",
    logo_media_id: "probe-logo-a",
    logo_size: "m",
    logo_align: "left",
    tagline: "Probe tagline",
    secure_badge: { enabled: true, text: "Secure" },
    cta: { enabled: true, label: "Call now", href: "/probe", tel: null },
    disclosure_link: true,
    sticky: true,
  },
  progress: { style: "bar", position: "under_header", thickness: "m", width: "content", color_role: "brand_primary", show_label: true, align: "center" },
  back: { style: "text", position: "in_card", label: "Back", history_fallback: true },
  disclosure: { enabled: true, location: "footer", link_label: "Disclosure", text: "Probe disclosure copy" },
  footer: {
    enabled: true,
    show_on: "all",
    links_source: "manual",
    links: [{ label: "Terms", href: "/terms" }],
    trust_text: "Probe trust",
    description: "Probe description",
    show_logo: true,
    hide_on_mobile: false,
  },
  trust_strip: { enabled: true, source: "manual", logos: [{ media_id: "probe-trust", alt: "Trust" }], placement: "below_unit", mobile: "wrap" },
  benefit_bar: { enabled: true, items: [{ icon: "check", text: "Fast" }], placement: "below_unit" },
  background: { role: "page_background", image_media_id: null, style: "flat" },
  section_slot: { max_width: "m", align: "center", card: "card", padding: "m", offset_y: "none", allow_section_card: true, transition: "fade", continue_placement: "inside_unit", continue_style_role: "button_primary" },
  mobile: { hide_footer: false, progress_position: "top", logo_size: "m", trust_strip_mobile: "wrap" },
};

const FOOTER_LINK_ROW_BLOCKS = {
  footer: {
    blocks: [
      {
        type: "link_row",
        links_source: "manual",
        links: [
          { label: "Terms", href: "/terms" },
          { label: "Privacy", href: "/privacy" },
        ],
      },
    ],
  },
};

const FRAME_PROBE_CONTEXT: ReadonlyArray<{ key: string; patch: Record<string, unknown>; reason: string }> = [
  {
    key: "progress.icon",
    patch: { progress: { style: "icon_on_track" } },
    reason:
      "frame.ts:485 reads progress.icon ONLY under style==='icon_on_track'; on any other style there is no mark to move. The probe selects that style, exactly as the operator must.",
  },
  {
    key: "footer.link_underline",
    patch: FOOTER_LINK_ROW_BLOCKS,
    reason:
      "link_underline styles the footer v2 BLOCK model's links (.lg-frame-footer2-link); with no `blocks` authored the legacy footer bar renders and there is no such link. The probe authors one link_row block, which is what the operator's own Blocks list does.",
  },
  {
    key: "footer.link_separator",
    patch: FOOTER_LINK_ROW_BLOCKS,
    reason:
      "The separator is rendered BETWEEN the anchors of a footer v2 link_row, so it needs a block with at least two links; the legacy footer bar has no separator seam at all.",
  },
  {
    key: "header.cta.tel",
    patch: { header: { cta: { href: null } } },
    reason:
      "frame.ts resolves the header CTA's href FIRST and only falls back to tel — the same precedence FrameBrandLogoItem.url has behind media_id (LOGO_PROBE_OMITS above). A probe that set both could never observe tel move the paint, so the probe clears href, exactly as the operator must to use a phone CTA.",
  },
  {
    key: "footer.palette_scope.link",
    patch: FOOTER_LINK_ROW_BLOCKS,
    reason:
      "The footer's own link colour scopes the footer v2 block model's anchors (.lg-frame-footer2-link); the legacy footer bar renders no anchor for it to colour. The probe authors the same link_row block the operator's Blocks list creates.",
  },
];

// ---------------------------------------------------------------------------
// "…OR IS REMOVED FROM THE UI" — the other half of R3's rule, mechanised.
//
// R3: "Every one of the 80 keys either governs a measurable painted value on a
// visible element, or is REMOVED FROM THE UI. A control that cannot be honoured
// must not be offered." So a key that paints nothing is only acceptable when it
// is genuinely not offered — and that is not a claim to take on trust: the
// admin's own source is scanned for the key's authoring path, which is how every
// control in these panels is declared (`themeSelect(label, "card_defaults.radius")`,
// `frameCheck(label, "footer.link_underline")`, `data-tplbox-list="footer.blocks"`).
// If someone later adds the control, the scan finds it and this file goes red.
// ---------------------------------------------------------------------------

const ADMIN_LEADGEN_DIR = path.join(HERE, "..", "src", "admin", "leadgen");

// "Offered" means RENDERED AS A CONTROL, which is what R3's rule is about. The
// admin's UI-emitting modules are `quotes-tabs/**` (the Themes / Templates /
// Funnel rail panels) and the top-level `ui-*.ts` surfaces. The `*-handlers.ts`
// modules are the HTTP + store plane: one of them VALIDATING a stored field is
// persistence, not a control an operator can turn — `themes-handlers.ts` reads
// and round-trips `spacing`, and no panel anywhere renders a Spacing input for
// a theme record.
function adminUiFiles(dir: string = ADMIN_LEADGEN_DIR, inUiDir = false): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...adminUiFiles(full, entry.name === "quotes-tabs" || inUiDir));
    else if (entry.name.endsWith(".ts") && (inUiDir || entry.name.startsWith("ui-"))) out.push(full);
  }
  return out;
}

const ADMIN_UI_SOURCES: ReadonlyArray<{ file: string; text: string }> = adminUiFiles().map((file) => ({
  file,
  text: readFileSync(file, "utf8"),
}));

/** Every admin UI module that renders a control writing this authoring path. */
function offeredIn(keyPath: string): string[] {
  return ADMIN_UI_SOURCES.filter((s) => s.text.includes(`"${keyPath}"`)).map((s) => path.basename(s.file));
}

// ---------------------------------------------------------------------------
// THE EXEMPTIONS — FOUR, all of ONE kind, all falsifiable.
//
// AN EXEMPTION IS NEVER A PLACE TO PARK A DEAD CONTROL. A key the operator can
// change that paints nothing is a DEFECT and is reported as one; that is the
// whole reason this sweep exists. So every entry below makes the SAME claim —
// "no operator control offers this key" — which is R3's own second branch
// ("…or is removed from the UI"), and every entry is CHECKED against the admin
// UI scan above: add the control to a panel and the exemption goes red. Each
// also names what would prove the key if that ever changes.
//
// Not one entry is of the shape "offered, but this harness cannot prove it":
// that shape would be a dead control wearing an exemption. The list is pinned
// by an exact-set assertion below, so it cannot grow by accident.
// ---------------------------------------------------------------------------

interface Exemption {
  key: string;
  /** true ⇒ the exemption's claim is "no operator control offers this key". */
  notOffered: boolean;
  reason: string;
}

const SWEEP_EXEMPTIONS: readonly Exemption[] = [
  {
    key: "compat.allow_section_chrome",
    notOffered: true,
    reason:
      "Honoured, but in the ADMIN validation plane, not in paint: quotes-handlers.ts:6103 reads it into state.allowSectionChrome to decide a save-time WARNING about section chrome. No operator control writes it (the frame Templates tab offers no compat group), so R3's 'or is removed from the UI' holds. What would prove it: an admin save of a section carrying chrome under compat.allow_section_chrome=false returning the warning.",
  },
  {
    key: "back.history_fallback",
    notOffered: true,
    reason:
      "Honoured as RUNTIME BEHAVIOUR, not as paint: frame.ts:528 emits data-history-fallback and engine.ts:1729 arms the same-origin-referrer back leg from it. A data-* hook is plumbing and is excluded from the visible fingerprint on purpose. No operator control writes it. What would prove it: a driven funnel entered from a same-origin referrer, Back pressed on the first section, and the browser navigating back.",
  },
  {
    key: "spacing",
    notOffered: true,
    reason:
      "designs/theme.ts:986 declares ThemeRecordSpacing as the contract's PROPOSED, reserved density label: 'Round-tripped only; never rendered without a design addendum' — and the admin scan below confirms no control writes it (the only Spacing control in the Themes rail is the inline theme_json key `scales.spacing`, which IS swept and IS alive). What would prove it: a design addendum plus a resolveTokens branch reading record.spacing — at which point this exemption must be deleted and the key must paint.",
  },
  {
    key: "section_slot.allow_section_card",
    notOffered: true,
    reason:
      "NEITHER painted NOR offered: a repo-wide search finds no reader outside designs/frames.ts (its own default + validator) and no admin control writes it. It is a stored field with no consumer, which satisfies R3 only because it is absent from the UI. What would prove it otherwise: any renderer or handler reading frame.section_slot.allow_section_card — the moment one exists this exemption must be deleted and the key must paint.",
  },
];

// ---------------------------------------------------------------------------
// THE PROBE RUNNERS.
// ---------------------------------------------------------------------------

const RECORD_ROLE_TO_TOKEN = themeModule.THEME_RECORD_ROLE_TO_TOKEN_ROLE as Record<string, string>;
const RECORD_EXTRA_ROLE_TO_TOKEN = themeModule.THEME_RECORD_EXTRA_ROLE_TO_TOKEN_ROLE as Record<string, string>;

/** The frame patch that puts a colour ROLE in use (see THEME_PROBE_CONTEXT). */
function roleInUseFrame(key: string): Record<string, unknown> | undefined {
  const [group, name] = key.split(".");
  if (name === undefined) return undefined;
  if (group === "palette") return { progress: { color_role: name } };
  if (group === "roles") return { progress: { color_role: RECORD_ROLE_TO_TOKEN[name] } };
  if (group === "extra_roles") return { progress: { color_role: RECORD_EXTRA_ROLE_TO_TOKEN[name] } };
  return undefined;
}

function setDotted(target: Record<string, unknown>, key: string, value: unknown): Record<string, unknown> {
  const parts = key.split(".");
  let node = target;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i] as string;
    const child = node[part];
    const next = typeof child === "object" && child !== null ? { ...(child as Record<string, unknown>) } : {};
    node[part] = next;
    node = next;
  }
  node[parts[parts.length - 1] as string] = value;
  return target;
}

function paintedForInlineKey(spec: KeySpec, value: unknown): SweepPage {
  return sweepPage({
    theme: setDotted({}, spec.key, value) as ThemeJson,
    frame: roleInUseFrame(spec.key),
  });
}

function paintedForRecordKey(spec: KeySpec, value: unknown): SweepPage {
  const record = setDotted(SWEEP_RECORD_BASE() as unknown as Record<string, unknown>, spec.key, value);
  return sweepPage({
    theme: { theme_id: (record["id"] as string) },
    record: record as unknown as ThemeRecord,
    frame: roleInUseFrame(spec.key),
  });
}

function deepMerge(into: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  for (const [k, v] of Object.entries(patch)) {
    const cur = into[k];
    if (v !== null && typeof v === "object" && !Array.isArray(v) && cur !== null && typeof cur === "object" && !Array.isArray(cur)) {
      into[k] = deepMerge({ ...(cur as Record<string, unknown>) }, v as Record<string, unknown>);
    } else {
      into[k] = v;
    }
  }
  return into;
}

function paintedForFrameKey(spec: KeySpec, value: unknown): SweepPage {
  const ctx = FRAME_PROBE_CONTEXT.find((c) => c.key === spec.key);
  let base = structuredClone(FRAME_PROBE_BASE);
  if (ctx !== undefined) base = deepMerge(base, structuredClone(ctx.patch));
  if (spec.key === "template") return sweepPage({ template: value as string, frame: base });
  return sweepPage({ frame: setDotted(base, spec.key, value) });
}

/**
 * The keys whose flip moves NOTHING a visitor could see.
 *
 * Each render is resolved to its BOTH-VIEWPORT fingerprint once and the
 * fingerprints are compared — identical to asking visibleDiffAnyViewport for an
 * empty diff (that is how visibleFingerprint is defined), without re-resolving
 * the first render for every subsequent value.
 */
function deadUnderVisiblePaint(
  specs: readonly KeySpec[],
  paint: (spec: KeySpec, value: unknown) => SweepPage,
): string[] {
  const dead: string[] = [];
  for (const spec of specs) {
    const first = visibleFingerprint(paint(spec, spec.values[0]));
    let alive = false;
    for (let i = 1; i < spec.values.length && !alive; i++) {
      alive = visibleFingerprint(paint(spec, spec.values[i])) !== first;
    }
    if (!alive) dead.push(spec.key);
  }
  return dead;
}

const INLINE_KEYS = themeJsonKeys();
const RECORD_KEYS = themeRecordKeys();
const FRAME_KEYS = frameConfigKeys();
const LOGO_KEYS = declaredFields(FRAMES_FILE, "FrameBrandLogoItem");
const ENUMERATED_TOTAL = INLINE_KEYS.length + RECORD_KEYS.length + FRAME_KEYS.keys.length + LOGO_KEYS.length;

describe("R2 P8 M2/R3 sweep — the enumerated universe is source-derived and CLOSED", () => {
  it("the inline theme_json universe is the 34 keys R3 inventoried, expanded from ThemeJson's own sub-interfaces", () => {
    const perGroup = new Map<string, number>();
    for (const k of INLINE_KEYS) perGroup.set(k.group, (perGroup.get(k.group) ?? 0) + 1);
    expect(Object.fromEntries([...perGroup].sort())).toEqual({
      button_defaults: 8,
      card_defaults: 4,
      field_defaults: 1,
      palette: 14,
      scales: 3,
      typography: 4,
    });
    expect(INLINE_KEYS.length, "R3: '34 inline theme_json'").toBe(34);
    // The one member deliberately not a key is still DECLARED and still has
    // exactly one legal value — if `version` ever widens, this fails.
    expect(THEME_JSON_NON_KEYS.map((n) => n.member)).toEqual(["version"]);
    const version = declaredFields(THEME_FILE, "ThemeJson").find((f) => f.name === "version");
    expect(version?.typeText, "version is a single-valued discriminator").toBe("1");
  });

  it("the ThemeRecord universe is the 25 keys R3 inventoried, expanded from ThemeRecord's own members", () => {
    const perGroup = new Map<string, number>();
    for (const k of RECORD_KEYS) perGroup.set(k.group, (perGroup.get(k.group) ?? 0) + 1);
    expect(Object.fromEntries([...perGroup].sort())).toEqual({
      button_style: 3,
      controls: 3,
      extra_roles: 7,
      roles: 7,
      spacing: 1,
      typography: 4,
    });
    expect(RECORD_KEYS.length, "R3: '25 ThemeRecord'").toBe(25);
    expect(THEME_RECORD_NON_KEYS.map((n) => n.member).sort()).toEqual(["id", "name"]);
  });

  it("the theme universe is R3's 59 keys — 56 more than the 3 this file used to enumerate", () => {
    expect(INLINE_KEYS.length + RECORD_KEYS.length, "R3: 'all 59 theme keys'").toBe(59);
    expect(declaredFields(THEME_FILE, "ThemeRecordControls").length, "the old enumeration").toBe(3);
  });

  it("the FrameConfig universe is derived from EffectiveFrameConfig's own group members", () => {
    expect(frameGroupMembers().map((m) => m.name)).toEqual([
      "compat",
      "header",
      "progress",
      "back",
      "disclosure",
      "footer",
      "trust_strip",
      "benefit_bar",
      "background",
      "section_slot",
      "mobile",
    ]);
    // Every EffectiveFrameConfig member is accounted for: a swept group, a
    // named non-key, or a named P5a element member. Nothing falls between.
    const members = declaredFields(FRAMES_FILE, "EffectiveFrameConfig").map((m) => m.name);
    const swept = new Set([...frameGroupMembers().map((m) => m.name), "template"]);
    const unaccounted = members.filter(
      (m) => !swept.has(m) && !FRAME_ELEMENT_MEMBERS.includes(m) && !FRAME_NON_KEYS.some((n) => n.member === m),
    );
    expect(unaccounted, "every EffectiveFrameConfig member is swept or named as excluded").toEqual([]);
    expect(FRAME_ELEMENT_MEMBERS.length).toBeGreaterThan(0);
    expect(FRAME_KEYS.arrays.sort()).toEqual([...FRAME_ARRAY_FIELDS].sort());
    expect(FRAME_KEYS.singles.sort()).toEqual([...FRAME_SINGLE_VALUE_FIELDS].sort());
  });

  it("prints and pins the total — a key added to ANY of these interfaces fails here first", () => {
    // eslint-disable-next-line no-console
    console.log(
      `[R3 sweep] enumerated keys: inline theme_json=${INLINE_KEYS.length} ThemeRecord=${RECORD_KEYS.length} ` +
        `frame groups=${FRAME_KEYS.keys.length} element-F logo props=${LOGO_KEYS.length} TOTAL=${ENUMERATED_TOTAL} ` +
        `(excluded by name: frame arrays=${FRAME_KEYS.arrays.length}, single-valued=${FRAME_KEYS.singles.length}, ` +
        `P5a element members=${FRAME_ELEMENT_MEMBERS.length})`,
    );
    expect(ENUMERATED_TOTAL).toBe(129);
  });

  it("the probe page is a REAL funnel page — and renders none of the surfaces the mis-targeted keys hid behind", () => {
    const { html, css } = sweepPage({});
    expect(html.match(/class="lg-question-card"/g)).toHaveLength(1);
    expect(html).not.toContain("lg-card-panel");
    expect(html).not.toContain("lg-disclosure-panel");
    const page = visiblePage(css, html);
    expect(page.visible.length, "the probe page has visible elements to measure").toBeGreaterThan(20);
    expect(page.hiddenPaths.length, "…and hidden ones the predicate drops").toBeGreaterThan(0);
    for (const cls of ["lg-question-card", "lg-input", "lg-continue", "lg-btn-answer", "lg-headline"]) {
      expect(
        page.visible.some((v) => v.classes.includes(cls)),
        `the visitor can see .${cls}`,
      ).toBe(true);
    }
  });
});

describe("R2 P8 M2/R3 sweep — EVERY authorable design key moves a value a visitor can see", () => {
  const exempt = new Set(SWEEP_EXEMPTIONS.map((e) => e.key));

  it("the admin scan is CALIBRATED — it finds the controls that ARE offered (else every 'not offered' claim is vacuous)", () => {
    expect(ADMIN_UI_SOURCES.length, "the admin UI modules were found").toBeGreaterThan(5);
    for (const offered of [
      "card_defaults.radius",
      "button_defaults.casing",
      "scales.shadow",
      "footer.link_underline",
      "progress.style",
    ]) {
      expect(offeredIn(offered), `${offered} is a control the operator really has`).not.toEqual([]);
    }
  });

  it("every exemption carries a written reason AND is falsifiable by the admin scan", () => {
    for (const e of SWEEP_EXEMPTIONS) {
      expect(e.reason.trim().length, `exemption ${e.key} states why + what would prove it`).toBeGreaterThan(120);
      if (e.notOffered) {
        expect(
          offeredIn(e.key),
          `exemption ${e.key} claims no operator control offers it — the admin scan must find none`,
        ).toEqual([]);
      }
    }
    // The exemption list is PINNED. Adding one is a deliberate, reviewable
    // edit here, never a quiet append that makes a red sweep go green.
    expect(SWEEP_EXEMPTIONS.map((e) => e.key).sort()).toEqual([
      "back.history_fallback",
      "compat.allow_section_chrome",
      "section_slot.allow_section_card",
      "spacing",
    ]);
    // …and every single one of them makes the SAME claim: no operator control
    // offers this key. Not one is "offered, but this harness cannot prove it" —
    // that shape would be a dead control wearing an exemption.
    expect(SWEEP_EXEMPTIONS.every((e) => e.notOffered)).toBe(true);
    // The 59 THEME keys carry exactly one, and it is the contract's own
    // reserved-but-unrendered storage key.
    expect(SWEEP_EXEMPTIONS.filter((e) => !e.key.includes(".")).map((e) => e.key)).toEqual(["spacing"]);
  });

  // Renders + cascade-resolves one page per key per value; the vitest default
  // 5s budget is a wall-clock coin flip for this leg, so it is stated.
  it("INLINE theme_json — all 34 keys paint a visible element", { timeout: 120_000 }, () => {
    const dead = deadUnderVisiblePaint(
      INLINE_KEYS.filter((k) => !exempt.has(k.key)),
      paintedForInlineKey,
    );
    expect(dead, "inline theme_json keys that move nothing a visitor can see").toEqual([]);
  });

  // Renders + cascade-resolves one page per key per value; the vitest default
  // 5s budget is a wall-clock coin flip for this leg, so it is stated.
  it("THEME RECORDS — all 25 keys paint a visible element", { timeout: 120_000 }, () => {
    const dead = deadUnderVisiblePaint(
      RECORD_KEYS.filter((k) => !exempt.has(k.key)),
      paintedForRecordKey,
    );
    expect(dead, "ThemeRecord keys that move nothing a visitor can see").toEqual([]);
  });

  // Renders + cascade-resolves one page per key per value; the vitest default
  // 5s budget is a wall-clock coin flip for this leg, so it is stated.
  it("FRAME CONFIG — every swept group key paints a visible element", { timeout: 120_000 }, () => {
    const dead = deadUnderVisiblePaint(
      FRAME_KEYS.keys.filter((k) => !exempt.has(k.key)),
      paintedForFrameKey,
    );
    expect(dead, "frame group keys that move nothing a visitor can see").toEqual([]);
  });

  // The four keys R3 measured DEAD/MIS-TARGETED, each named so a regression
  // says which knob died rather than hiding inside a set comparison.
  for (const [key, values] of [
    ["card_defaults.background_role", ["error", "success"]],
    ["card_defaults.border_role", ["error", "success"]],
    ["card_defaults.radius", ["sm", "full"]],
    ["card_defaults.shadow", ["none", "xl"]],
    ["button_defaults.casing", ["none", "upper"]],
    ["scales.shadow", ["none", "high"]],
  ] as ReadonlyArray<[string, string[]]>) {
    it(`${key} (R3-measured) moves a value on a VISIBLE element, not just bytes`, () => {
      const spec: KeySpec = { group: key.split(".")[0] as string, key, values };
      const diff = visibleDiffAnyViewport(paintedForInlineKey(spec, values[0]), paintedForInlineKey(spec, values[1]));
      expect(diff.length, `${key}: ${JSON.stringify(diff)}`).toBeGreaterThan(0);
    });
  }
});

// ---------------------------------------------------------------------------
// 5. THE SWEEP'S OWN PROOF — the visible-paint predicate can go RED, and it
//    goes red for the RIGHT reason.
//
// A predicate nobody has seen fail is not known to work. These legs drive the
// SAME runner used above and assert it names a key as dead in each of the three
// shapes the class actually takes:
//   (a) no consumer at all — a key the renderers have never heard of;
//   (b) MIS-TARGETED — a real declaration change, on a selector the rendered
//       page contains NO element for. This is the exact shape that passed the
//       old byte predicate (card_defaults.border_role -> .lg-card-panel);
//   (c) HIDDEN — a real declaration change, on a real rendered element that is
//       switched off. This is the other shape that passed (card_defaults.radius
//       -> the 0x0 disclosure modal panel).
// (b) and (c) inject the defect the way the real ones existed: in the SHEET,
// against the REAL rendered page. Nothing is hand-built on the markup side.
// ---------------------------------------------------------------------------

// An injected rule must land in the BASE cascade, not after the trailing
// `@media` block, or the viewport splitter would never see it.
function withExtraRule(css: string, rule: string): string {
  const at = css.indexOf("\n@media");
  return at < 0 ? `${css}\n${rule}` : `${css.slice(0, at)}\n${rule}${css.slice(at)}`;
}

describe("R2 P8 M2/R3 sweep — the predicate itself fails on a dead, a MIS-TARGETED and a HIDDEN key", () => {
  it("(a) a synthetic key no renderer reads is reported DEAD, while the real keys stay alive", () => {
    const synthetic: KeySpec = { group: "card_defaults", key: "card_defaults.halo_depth", values: ["sharp", "pill"] };
    expect(deadUnderVisiblePaint([synthetic], paintedForInlineKey)).toEqual(["card_defaults.halo_depth"]);
    // …and the SAME runner still calls the four R3 keys alive, so it is
    // discriminating rather than universally negative.
    expect(
      deadUnderVisiblePaint(
        INLINE_KEYS.filter((k) => k.group === "card_defaults"),
        paintedForInlineKey,
      ),
    ).toEqual([]);
  });

  it("(b) a MIS-TARGETED key — real CSS change, selector the page renders no element for — is reported DEAD", () => {
    const { css, html } = sweepPage({});
    const misTargeted = (value: string): SweepPage => ({
      // A rule for .lg-card-panel: a REAL selector this sheet really ships, and
      // a real declaration change. The page renders no such element.
      css: withExtraRule(css, `${DEFAULT_FUNNEL_SCOPE} .lg-card-panel{border:1px solid ${value}}`),
      html,
    });
    expect(html).not.toContain("lg-card-panel");
    expect(visibleDiffAnyViewport(misTargeted("#D32F2F"), misTargeted("#0E7C3A"))).toEqual([]);
    // The byte predicate the old guard used would have called this ALIVE:
    expect(misTargeted("#D32F2F").css).not.toBe(misTargeted("#0E7C3A").css);
  });

  it("(c) a HIDDEN key — real CSS change on a real element that is switched off — is reported DEAD", () => {
    const { css, html } = sweepPage({});
    const page = visiblePage(css, html);
    // `.lg-error-auto` is a REAL element of the REAL rendered page that the
    // renderer ships with the `hidden` attribute — the terminal
    // `${scope} [hidden]{display:none}` rule resolves it to display:none.
    expect(html).toContain("lg-error-auto");
    expect(page.visible.some((v) => v.classes.includes("lg-error-auto"))).toBe(false);
    const onHidden = (value: string): SweepPage => ({
      css: withExtraRule(css, `${DEFAULT_FUNNEL_SCOPE} .lg-error-auto{border:1px solid ${value}}`),
      html,
    });
    expect(visibleDiffAnyViewport(onHidden("#D32F2F"), onHidden("#0E7C3A"))).toEqual([]);
    // …and the SAME injection on a VISIBLE element of the same page IS caught,
    // so the leg above proves hiddenness, not a blind resolver.
    const onVisible = (value: string): SweepPage => ({
      css: withExtraRule(css, `${DEFAULT_FUNNEL_SCOPE} .lg-question-card{border:1px solid ${value}}`),
      html,
    });
    expect(visibleDiffAnyViewport(onVisible("#D32F2F"), onVisible("#0E7C3A")).length).toBeGreaterThan(0);
  });

  it("a custom property nothing reads is NOT paint (the --lg-role-* false green)", () => {
    const { css, html } = sweepPage({});
    const onlyAVariable = (value: string): SweepPage => ({
      css: withExtraRule(css, `${DEFAULT_FUNNEL_SCOPE}{--lg-probe-unread:${value}}`),
      html,
    });
    expect(visibleDiffAnyViewport(onlyAVariable("#D32F2F"), onlyAVariable("#0E7C3A"))).toEqual([]);
    // …but the moment a real rule READS it on a visible element, it is paint.
    const readByARule = (value: string): SweepPage => ({
      css: withExtraRule(css, `${DEFAULT_FUNNEL_SCOPE}{--lg-probe-read:${value}}\n${DEFAULT_FUNNEL_SCOPE} .lg-question-card{outline-color:var(--lg-probe-read)}`),
      html,
    });
    expect(visibleDiffAnyViewport(readByARule("#D32F2F"), readByARule("#0E7C3A")).length).toBeGreaterThan(0);
  });
});
