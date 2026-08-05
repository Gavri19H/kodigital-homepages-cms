// LeadGen v2.5 THEME / TOKEN / PALETTE module (redesign-contract-v2.5
// 09 §9.1–§9.3 + 03 §3.6). PURE: no DB, no Hono, no admin imports — the SAME
// module feeds runtime serve, both preview endpoints, and the admin canvases
// (§9.2 "one function … drift is impossible by construction").
//
// Owns:
//   - the 14 semantic colour roles (§9.1) and their compile-time-exhaustive
//     mapping onto base design token paths (ROLE_TO_BASE_TOKEN — the
//     REQUIRED_FIELDS idiom from components/content-schema.ts: a new role or
//     a renamed token path is a compile error, so every registered design
//     satisfies the mapping by construction);
//   - the `theme_json` contract (§3.2 versioned {version:1}: palette /
//     typography / scales / button_defaults / card_defaults, §9.3);
//   - resolveTokens — priority layers 1 base visual design → 2 Funnel theme →
//     3 Variant frame_overrides theme (§9.2; layers 4–6 stay per-node at
//     render, unchanged);
//   - validateTheme — typed, path-precise `problems[]` per 03 §3.6.

import type { FunnelDesign } from "./registry";

// ---------------------------------------------------------------------------
// 03 §3.6 validation problem shape (shared by frame + theme validators; the
// section/component validators keep their existing {error, fields} shape and
// adopt `problems` additively when touched). `message` is a human sentence in
// operator language — NEVER raw JSON or internal ids. `fix_url` deep-links to
// the owning editor surface; it is enriched by the admin handlers (a pure
// design module cannot know admin routes), hence optional here.
// ---------------------------------------------------------------------------

export type ProblemScope = "frame" | "theme" | "section" | "component" | "choice" | "mapping";
export type ProblemSeverity = "error" | "warning";

export interface Problem {
  path: string;
  scope: ProblemScope;
  severity: ProblemSeverity;
  message: string;
  fix_url?: string;
}

// ---------------------------------------------------------------------------
// §9.1 semantic roles — the ONLY colour vocabulary in normal flows.
// ---------------------------------------------------------------------------

export const FUNNEL_TOKEN_ROLES = [
  "brand_primary",
  "brand_secondary",
  "accent",
  "success",
  "error",
  "page_background",
  "card_background",
  "surface_wash",
  "border",
  "text_primary",
  "text_muted",
  "button_primary_bg",
  "button_primary_text",
  "button_secondary_bg",
] as const;

export type FunnelTokenRole = (typeof FUNNEL_TOKEN_ROLES)[number];

const ROLE_SET: ReadonlySet<string> = new Set(FUNNEL_TOKEN_ROLES);

export function isFunnelTokenRole(value: unknown): value is FunnelTokenRole {
  return typeof value === "string" && ROLE_SET.has(value);
}

// P8-6 Q7 (M5 jargon sweep, owner verbatim: "the rules you build are using
// jargon"): the operator's own labels for these 14 roles, converged VERBATIM
// with quotes-tabs/shared.ts's ROLE_META and sections.ts's THEME_ROLE_LABELS
// (see that file's P8-6 Q6 comment for why a label map is kept as local data
// beside its role vocabulary rather than importing across the admin/domain
// layer boundary — this module is PURE, same as that one). Unlike sections.ts
// — which cannot reuse a label table without inverting its domain->admin
// boundary — THIS module is where FUNNEL_TOKEN_ROLES is itself DEFINED, and
// both frames.ts and content-schema.ts already import FUNNEL_TOKEN_ROLES from
// here; exporting the label map from the same place gives every consumer ONE
// canonical source instead of a third divergent local copy.
export const FUNNEL_TOKEN_ROLE_LABELS: Readonly<Record<FunnelTokenRole, string>> = {
  brand_primary: "Brand primary",
  brand_secondary: "Brand secondary",
  accent: "Accent",
  success: "Success",
  error: "Error",
  page_background: "Page background",
  card_background: "Card background",
  surface_wash: "Soft fill",
  border: "Border",
  text_primary: "Text",
  text_muted: "Muted text",
  button_primary_bg: "Button",
  button_primary_text: "Button text",
  button_secondary_bg: "Secondary button",
};

export function funnelTokenRoleLabel(role: string): string {
  return FUNNEL_TOKEN_ROLE_LABELS[role as FunnelTokenRole] ?? role;
}

export function funnelTokenRoleLabelList(): string {
  return FUNNEL_TOKEN_ROLES.map(funnelTokenRoleLabel).join(", ");
}

// Every `group.key` path into a FunnelDesign whose leaf is a string token.
// Computed from the design TYPE, so ROLE_TO_BASE_TOKEN below can only name
// paths that actually exist on every registered design (the registry types
// all designs as FunnelDesign) — the compile-time half of "every registered
// design must satisfy the mapping" (§9.1).
type DesignStringLeafPath = {
  [G in keyof FunnelDesign & string]: FunnelDesign[G] extends string
    ? never
    : {
        [K in keyof FunnelDesign[G] & string]: FunnelDesign[G][K] extends string
          ? `${G}.${K}`
          : never;
      }[keyof FunnelDesign[G] & string];
}[keyof FunnelDesign & string];

// §9.1 role → base token path (the "Base mapping (default-funnel token)"
// column, verbatim). `satisfies` enforces BOTH exhaustiveness over the 14
// roles (a missing/extra row is a compile error) AND that each path is a real
// string-valued token on the design shape.
export const ROLE_TO_BASE_TOKEN = {
  brand_primary: "color.primary",
  brand_secondary: "color.primaryLight",
  accent: "color.accent",
  success: "color.success",
  error: "color.error",
  page_background: "page.backgroundColor",
  card_background: "color.card",
  surface_wash: "color.primaryWash",
  border: "color.border",
  text_primary: "page.textColor",
  text_muted: "page.textSecondaryColor",
  button_primary_bg: "primaryButton.background",
  button_primary_text: "primaryButton.color",
  button_secondary_bg: "color.primaryGhost",
} as const satisfies Record<FunnelTokenRole, DesignStringLeafPath>;

// A design with the FunnelDesign STRUCTURE but widened, mutable leaves — what
// resolveTokens returns as `design` (the registry design is a deeply-literal
// `as const` singleton; a themed copy carries new values).
type WidenLeaves<T> = T extends string
  ? string
  : T extends number
    ? number
    : T extends boolean
      ? boolean
      : { -readonly [K in keyof T]: WidenLeaves<T[K]> };

export type EffectiveFunnelDesign = WidenLeaves<FunnelDesign>;

// Runtime read of a role's base token value. For a conforming design (which
// the compile-time mapping guarantees) this always yields a non-empty string;
// the "" fallback only defends against untyped junk at runtime.
export function baseTokenForRole(
  design: FunnelDesign | EffectiveFunnelDesign,
  role: FunnelTokenRole,
): string {
  const path = ROLE_TO_BASE_TOKEN[role];
  const dot = path.indexOf(".");
  const group = (design as Record<string, unknown>)[path.slice(0, dot)];
  const value = isRecord(group) ? group[path.slice(dot + 1)] : undefined;
  return typeof value === "string" ? value : "";
}

function setRoleToken(design: EffectiveFunnelDesign, role: FunnelTokenRole, value: string): void {
  const path = ROLE_TO_BASE_TOKEN[role];
  const dot = path.indexOf(".");
  const group = (design as unknown as Record<string, unknown>)[path.slice(0, dot)];
  if (isRecord(group)) group[path.slice(dot + 1)] = value;
}

// ---------------------------------------------------------------------------
// §9.3 scales — lookups/multipliers over the base design scales.
// ---------------------------------------------------------------------------

export const THEME_SPACING_SCALES = ["compact", "regular", "roomy"] as const;
export type ThemeSpacingScale = (typeof THEME_SPACING_SCALES)[number];

export const THEME_RADIUS_SCALES = ["sharp", "soft", "round"] as const;
export type ThemeRadiusScale = (typeof THEME_RADIUS_SCALES)[number];

export const THEME_SHADOW_SCALES = ["none", "low", "mid", "high"] as const;
export type ThemeShadowScale = (typeof THEME_SHADOW_SCALES)[number];

// spacing = multiplier over the base spacing scale; `regular` is the identity
// (absent theme = base design, §9.2).
export const THEME_SPACING_FACTORS: Record<ThemeSpacingScale, number> = {
  compact: 0.8,
  regular: 1,
  roomy: 1.25,
};

// radius/shadow = LOOKUP over the base scale steps (§9.3 "radius sharp = one
// step down the base radius scale"), clamped at the ends. `soft`/`mid` are
// the identities. radius.full (the 9999px pill) is semantic "fully round" and
// never shifts; shadow `none` blanks every step (glow included).
export const THEME_RADIUS_SHIFTS: Record<ThemeRadiusScale, -1 | 0 | 1> = {
  sharp: -1,
  soft: 0,
  round: 1,
};

export const THEME_SHADOW_SHIFTS: Record<Exclude<ThemeShadowScale, "none">, -1 | 0 | 1> = {
  low: -1,
  mid: 0,
  high: 1,
};

// §9.3 typography — the curated theme font vocabulary.
//
// P6 THEME v2 (D-7): widened from the original 3 back-compat ids
// (literata/sora/system) to add a CURATED SELF-HOSTED family set. The three
// original ids are KEPT UNCHANGED for back-compat: their stacks name families
// the base design already references (`'Literata'`/`'Sora'`) or a pure system
// stack, and NONE of them is self-hosted — so a v1 theme picking one of them
// emits ZERO @font-face and renders byte-identically to pre-P6 (the base
// design's own font values are 'Sora'/'Literata'/'Newsreader', so those names
// are DELIBERATELY excluded from the self-hosted set below — see
// fonts.generated.ts + styles.ts's scan: a self-hosted @font-face is emitted
// ONLY for a family a theme explicitly opts into, never for a base-design
// family, so every legacy/v1 funnel stays byte-identical).
//
// The NEW self-hosted ids map onto WOFF2 Latin subsets vendored at BUILD time
// into fonts.generated.ts (base64 data: URLs, served same-origin — ZERO
// external font requests on live; the same build-time-vendoring precedent as
// the P1 Tabler icon pipeline, scripts/build-fonts.mjs). Their CSS family
// names (Poppins/Manrope/DM Sans/Work Sans/Space Grotesk/Fraunces/Playfair
// Display/Lexend) are what styles.ts scans the resolved design's font slots
// for, and what fonts.generated.ts emits @font-face for — the ONE coupling
// point between this id list and the vendored assets.
export const THEME_FONT_IDS = [
  // --- back-compat (unchanged; NOT self-hosted; byte-identical to pre-P6) ---
  "literata",
  "sora",
  "system",
  // --- P6 self-hosted display families (WOFF2 Latin subset, same-origin) ---
  "poppins",
  "space_grotesk",
  "fraunces",
  "playfair",
  // --- P6 self-hosted body families ---
  "manrope",
  "dm_sans",
  "work_sans",
  "lexend",
] as const;
export type ThemeFontId = (typeof THEME_FONT_IDS)[number];

// The CSS font-family stack each id resolves to. The self-hosted families lead
// with the vendored family name (a real @font-face target — see
// fonts.generated.ts) then documented fallbacks (so a family fails safe to a
// sane system font if its @font-face somehow does not load). The quoted family
// name here is the EXACT string styles.ts matches when scanning the resolved
// design for self-hosted families to emit @font-face for.
export const THEME_FONT_STACKS: Record<ThemeFontId, string> = {
  // back-compat (unchanged)
  literata: "'Literata',Georgia,serif",
  sora: "'Sora',system-ui,Arial,sans-serif",
  system: "system-ui,-apple-system,'Segoe UI',Arial,sans-serif",
  // self-hosted display
  poppins: "'Poppins',system-ui,Arial,sans-serif",
  space_grotesk: "'Space Grotesk',system-ui,Arial,sans-serif",
  fraunces: "'Fraunces',Georgia,'Times New Roman',serif",
  playfair: "'Playfair Display',Georgia,'Times New Roman',serif",
  // self-hosted body
  manrope: "'Manrope',system-ui,Arial,sans-serif",
  dm_sans: "'DM Sans',system-ui,Arial,sans-serif",
  work_sans: "'Work Sans',system-ui,Arial,sans-serif",
  lexend: "'Lexend',system-ui,Arial,sans-serif",
};

export const THEME_SIZE_SCALES = ["s", "m", "l"] as const;
export type ThemeSizeScale = (typeof THEME_SIZE_SCALES)[number];

// font-size multiplier over every *FontSize* token; `m` is the identity. This
// is the UNIFORM/overall (body) size ramp — it scales display AND body tokens
// together, exactly as pre-P6. Kept at 3 steps (s/m/l) UNCHANGED: a uniform
// ramp cannot express a display-XXL headline (~72px, Image37) without blowing
// body text up with it, so the P6 display ramp lives on its OWN axis
// (typography.display_size / THEME_DISPLAY_SIZE_FACTORS below) that scales the
// DISPLAY font-size tokens only. (Widening THIS enum to xl/xxl is intentionally
// avoided — it is the DISPLAY axis that carries the new tiers.)
export const THEME_SIZE_FACTORS: Record<ThemeSizeScale, number> = {
  s: 0.9,
  m: 1,
  l: 1.1,
};

// P6 THEME v2 (D-7 / deliverable 2) — the DISPLAY size ramp. A SEPARATE axis
// from typography.size so the display/body distinction is explicit: `size` is
// the paragraph/body ramp (uniform, above), `display_size` is the headline
// ramp, scaling ONLY the DISPLAY font-size tokens (DISPLAY_FONTSIZE_PATHS
// below — the *FontSize* siblings of the applyDisplayFont family slots:
// headline / logo / range value / success heading). `m` is the identity
// (absent display_size ⇒ factor 1 ⇒ byte-identical to pre-P6). The top tier
// `xxl` takes the base 31px question headline to ~72px (31 × 2.3 ≈ 71.3),
// matching the operator's Image37 display-XXL reference; l/xl are the
// intermediate display tiers (43 / 56px).
export const THEME_DISPLAY_SIZE_SCALES = ["m", "l", "xl", "xxl"] as const;
export type ThemeDisplaySizeScale = (typeof THEME_DISPLAY_SIZE_SCALES)[number];

export const THEME_DISPLAY_SIZE_FACTORS: Record<ThemeDisplaySizeScale, number> = {
  m: 1,
  l: 1.4,
  xl: 1.8,
  xxl: 2.3,
};

// The DISPLAY font-size token paths display_size scales (the *FontSize*
// siblings of applyDisplayFont's family slots — headline / range value /
// success heading). Body/paragraph font-size tokens are deliberately absent
// so a display-XXL headline never enlarges body copy.
//
// R2 P8 N18 — `header.logoFontSize` WAS in this list and is not any more.
// The display ramp is the ramp for DISPLAY TYPE (the words the visitor reads
// as content); the header logo is CHROME whose size is governed by its own
// per-logo Size control — the three-rung strip `.lg-frame-header--logo-{s|m|l}`
// (styles.ts, 0.95rem / header.logoFontSize / 1.35rem). Keeping the logo in the
// ramp scaled exactly ONE of those three rungs: at display_size=xxl the `-m`
// logo went 1.1rem -> 2.53rem while `-s` (hard-coded 0.95rem) and `-l`
// (hard-coded 1.35rem) did not move at all, so "medium" painted nearly twice
// "large" and the operator's own size control was inverted by an unrelated
// typography knob. Removing the path makes the rendered logo font-size
// IDENTICAL at every display_size for all three rungs; display type (headline,
// range value, success heading) still scales exactly as before.
const DISPLAY_FONTSIZE_PATHS: ReadonlyArray<readonly [group: string, key: string]> = [
  ["headline", "fontSizeDesktop"],
  ["headline", "fontSizeMobile"],
  ["rangeQuestion", "valueFontSize"],
  ["successState", "headingFontSize"],
];

// R5 SEAM-1 (register E.5 "Theme base_px … ZERO consumers — dead theme
// feature"): the neutral reference for ThemeRecordTypography.base_px
// (§10.4) — CSS's own universal default root font-size, and the only value
// the ThemeManager "New theme" payload ever sends today (ui-theme-
// manager.ts:730 — no input control exists yet to author a different one).
// base_px === this default is the identity scale (factor 1) for every theme
// record reachable through the shipped UI.
const THEME_RECORD_BASE_PX_DEFAULT = 16;

// Steps on the BASE design scales (radius sm..full, shadow none+sm..xl) that
// button/card defaults may pick (§9.3 "radius step" / "shadow step").
export const THEME_RADIUS_STEPS = ["sm", "md", "lg", "xl", "full"] as const;
export type ThemeRadiusStep = (typeof THEME_RADIUS_STEPS)[number];

export const THEME_SHADOW_STEPS = ["none", "sm", "md", "lg", "xl"] as const;
export type ThemeShadowStep = (typeof THEME_SHADOW_STEPS)[number];

// §10.4 "Buttons & inputs — THE SHARED SIZE LANGUAGE": ONE px ladder, spelled
// in each path's own vocabulary. Declared here (before its first consumer) and
// consumed by every size table in this module + presets.ts's HEIGHT_PRESET_CSS,
// so the theme tier and the per-node override tier can never drift apart.
export const SHARED_SIZE_LANGUAGE_PX = ["44px", "52px", "60px"] as const;

// R2 F-3 (gap 2) — THE PAIRED PADDING, and WHY the ladder needs one.
//
// MEASURED at HEAD on the live visitor page (evidence p7-owner/fork-survival,
// ARM=before): field_height small/medium/large emitted min-height 44/52/60 but
// PAINTED 54/54/60. `.lg-input`'s own intrinsic box is 54px (2x16px padding +
// an 18px line box + 2x2px border), so a 44px and a 52px FLOOR are both under
// it — measurably governed, visually identical at 2 of 3 steps. From the
// operator's chair that is still a control that does nothing.
//
// THE SEMANTIC THIS MODULE STANDARDISES ON: the FLOOR (`min-height`), for the
// theme tier AND the per-node override tier (presets.ts). Reasons, in order:
//   1. A floor CANNOT clip. An exact `height:44px` on this box leaves 8px of
//      content area for an 18px line — the text is cut. `height` would have to
//      be re-justified for every font, zoom level and UA default line box; a
//      floor degrades gracefully (a taller line box simply grows the field).
//   2. presets.ts ALREADY DOCUMENTS this semantic for both idioms ("Applied as
//      `min-height` on the item/text idioms … so a preset only ever FLOORS the
//      box — it never clips"). The choice family honours it; the text-input
//      family emitted a bare `height:` — code vs its own stated contract.
//   3. It makes all three families (theme base rule, choice items, text
//      inputs) speak ONE semantic instead of two.
// A floor alone, though, is exactly what produced 54/54/60. So each rung of the
// ladder ALSO carries the vertical padding that puts the intrinsic box ON the
// rung: the floor then IS the painted height, and the three steps are visibly
// distinct. Content is never clipped, because the floor still only floors.
//
// ONE DERIVATION, never a second ladder: FIELD_BOX_CHROME_PX is the measured
// non-padding part of the box (18px line box + 2x2px border = 22px) and every
// padding value — the three preset rungs AND a hand-dragged custom_px — comes
// from the same subtraction below.
const FIELD_BOX_CHROME_PX = 22;

// FLOOR, never round: rounding an odd target up would push the intrinsic box
// PAST the floor by a pixel and the floor would stop governing. Flooring keeps
// the intrinsic box at or just under the rung, so the floor is what paints. The
// three ladder rungs divide exactly (44/52/60 -> 11/15/19); only a hand-dragged
// odd custom_px ever hits the remainder.
export function fieldPaddingBlockForPx(px: number): string {
  const pad = (px - FIELD_BOX_CHROME_PX) / 2;
  return `${pad > 0 ? Math.floor(pad) : 0}px`;
}

export const THEME_BUTTON_MIN_HEIGHTS = ["s", "m", "l"] as const;
export type ThemeButtonMinHeight = (typeof THEME_BUTTON_MIN_HEIGHTS)[number];

// R2 F-3 (gap 1): WIDENED from ["m","l"] to the full shared ladder. The record
// path's `controls.button_size` vocabulary IS s/m/l, and until this change the
// inline vocabulary had no `s` — so a preset's Button size = Small had no
// inline counterpart to be carried into and was DISCARDED the moment the
// operator's first rail edit forked theme_json (measured: painted button
// min-height 60px -> 52px after editing one colour). Widening a closed enum is
// additive: `m`/`l` keep their exact values and every stored theme stays valid.
const BUTTON_MIN_HEIGHT_CSS: Record<ThemeButtonMinHeight, string> = {
  s: SHARED_SIZE_LANGUAGE_PX[0],
  m: SHARED_SIZE_LANGUAGE_PX[1],
  l: SHARED_SIZE_LANGUAGE_PX[2],
};

// R2 F-3 (gap 1) — the INLINE field-height axis that did not exist before.
// `controls.field_height` had NO inline counterpart at all, so it too was lost
// at the fork (measured: painted field min-height 60px -> 44px, box 60px ->
// 54px, after editing one colour). This is the `button_defaults`/`card_defaults`
// idiom applied to the field box, spelled in the record's OWN words so the
// preset->inline bridge is a compile-checked identity rather than a translation
// table that can drift.
export const THEME_FIELD_MIN_HEIGHTS = ["small", "medium", "large"] as const;
export type ThemeFieldMinHeight = (typeof THEME_FIELD_MIN_HEIGHTS)[number];

const FIELD_MIN_HEIGHT_CSS: Record<ThemeFieldMinHeight, string> = {
  small: SHARED_SIZE_LANGUAGE_PX[0],
  medium: SHARED_SIZE_LANGUAGE_PX[1],
  large: SHARED_SIZE_LANGUAGE_PX[2],
};

export const THEME_BUTTON_CASINGS = ["none", "upper"] as const;
export type ThemeButtonCasing = (typeof THEME_BUTTON_CASINGS)[number];

// R2 P8 M2 — THE CASING STASH, and why `button_defaults.casing` needed one.
//
// MEASURED at HEAD on the live visitor page (docs/leadgen/r2/evidence/p8/m2/
// repro-before.txt): flipping casing none -> upper through the real operator
// route left `.lg-continue` (320x52) and `.lg-btn-answer` (151x66) at
// `text-transform:none` on BOTH arms. The value DID resolve — onto
// EffectiveButtonDefaults.text_transform (below) — but that readout has ZERO
// CSS consumers: the only two `text-transform` declarations the stylesheet ever
// emits read categoryLabel.textTransform and banner.ctaTextTransform, neither
// of which is a button. A control the operator can set that moves no pixel is
// the dead-control class this product has already shipped four times.
//
// WHY A SYMBOL STASH AND NOT A NEW TOKEN: funnelChromeCss receives only the
// resolved `design`, so the casing has to travel ON that object. A new
// `primaryButton.textTransform` KEY would change the serialized `design_tokens`
// bytes (buildPublicConfig) and break the A0 legacy config byte-pin — the
// explicit constraint tokens.ts's own header states. A Symbol-keyed stash is
// skipped by JSON.stringify, so the public config is byte-identical, and it is
// the SAME mechanism the P6 button-style triple already uses to reach the very
// same two renderers (readButtonStyle above). It is DELIBERATELY a SEPARATE
// stash from that triple rather than a fourth axis on it: EffectiveButtonStyle
// is the {fill,layout,selected} vocabulary whose presence gates the
// data-btn-* attributes and the whole pushButtonStyleRules block, and a theme
// that sets ONLY casing must not start emitting those.
//
// Stashed ONLY for the non-default value, so a theme with no casing (and every
// legacy funnel) leaves the design — and every consumer's bytes — untouched.
const BUTTON_CASING_STASH = Symbol("lgButtonCasing");

function setButtonCasing(design: EffectiveFunnelDesign, casing: ThemeButtonCasing): void {
  (design as unknown as Record<symbol, unknown>)[BUTTON_CASING_STASH] = casing;
}

// Read the stashed button casing off a resolved design (styles.ts consumer).
// Undefined ⇒ the theme asked for no casing ⇒ the consumer emits exactly its
// pre-M2 CSS. Accepts the base FunnelDesign too (the legacy render path passes
// the un-stashed registry design) — always undefined there.
export function readButtonCasing(
  design: FunnelDesign | EffectiveFunnelDesign,
): ThemeButtonCasing | undefined {
  const stash = (design as unknown as Record<symbol, unknown>)[BUTTON_CASING_STASH];
  return typeof stash === "string" && (THEME_BUTTON_CASINGS as readonly string[]).includes(stash)
    ? (stash as ThemeButtonCasing)
    : undefined;
}

// ---------------------------------------------------------------------------
// P6 THEME v2 (D-7 / deliverable 3) — the BUTTON-STYLE sub-schema. Three
// INDEPENDENT, OPTIONAL axes that together let a theme express the operator's
// reference looks (Images 38-40) as THEME-LEVEL defaults (the R-A design
// language — per-ELEMENT overrides already exist from P2 and are NOT
// duplicated here). Each axis has a `default` member that reproduces the
// pre-P6 look exactly, so an absent/default value emits ZERO new markup or CSS
// (byte-identical):
//
//   • fill      — the primary/answer fill treatment.
//                   fill    (default) = today's solid navy primary + white
//                                       bordered answer chip.
//                   outline           = transparent fill + a coloured 2px
//                                       border (ghost buttons).
//                   soft (Image 39)   = pill radius + a soft elevation shadow
//                                       ("soft-shadow pill stacks").
//   • layout    — the answer-group arrangement.
//                   grid    (default) = today's equal-cell grid.
//                   list (Image 38)   = a single-column, left-aligned,
//                                       two-line (title + subtitle) list of
//                                       full-width list-buttons.
//   • selected  — the icon-card selected-state treatment.
//                   wash    (default) = today's border-colour + wash fill.
//                   mark (Image 40)   = a bigger selected state: heavier
//                                       border + a slight scale-up + a check
//                                       badge in the corner.
//
// resolveTokens STASHES the resolved (defaults-applied) triple on the
// effective design under a Symbol key (readButtonStyle / setButtonStyle
// below) — Symbol-keyed so JSON.stringify (buildPublicConfig's design_tokens)
// never serializes it (ZERO public-config byte change) while it still travels
// on the SAME design object reference to funnelChromeCss (styles.ts) and the
// section renderers (presets.ts), the two live-render consumers. It is stashed
// ONLY when at least one axis is non-default, so a legacy/v1 theme leaves the
// design untouched.
export const THEME_BUTTON_STYLES = ["fill", "outline", "soft"] as const;
export type ThemeButtonStyle = (typeof THEME_BUTTON_STYLES)[number];

// LeadGen Rework §8.4 gap round (2026-07-23): "card" is the NEW Answer-layout
// value (Image23, P0 pack docs/leadgen/rework/design-pack/themes.html
// data-pin 8.4-title-subtitle-card-* — the pack's own "Card as a new enum
// value" note, owner-signed). Widening this ONE array is the WHOLE theme.ts
// change: every consumer (readButtonStyle's own re-validation below,
// safeRecordButtonStyle, and the theme_json `btn_layout` validator) is
// already keyed generically off THEME_BUTTON_LAYOUTS membership, so "card"
// round-trips the theme editor's save path (validation + the stash) with
// zero additional wiring. Render (presets.ts) and CSS (styles.ts) are the
// ONLY places that need a NEW branch for the new value.
export const THEME_BUTTON_LAYOUTS = ["grid", "list", "card"] as const;
export type ThemeButtonLayout = (typeof THEME_BUTTON_LAYOUTS)[number];

export const THEME_BUTTON_SELECTED_STYLES = ["wash", "mark"] as const;
export type ThemeButtonSelectedStyle = (typeof THEME_BUTTON_SELECTED_STYLES)[number];

// The defaults-applied triple stashed on the effective design. The `default`
// member of each axis is what an absent theme value resolves to, and the ONE
// value for which NOTHING new is emitted (byte-identical).
export interface EffectiveButtonStyle {
  fill: ThemeButtonStyle; // default: "fill"
  layout: ThemeButtonLayout; // default: "grid"
  selected: ThemeButtonSelectedStyle; // default: "wash"
}

const BUTTON_STYLE_DEFAULTS: EffectiveButtonStyle = { fill: "fill", layout: "grid", selected: "wash" };

// Symbol key (never a string key) — JSON.stringify skips Symbol-keyed
// properties, so the stash never leaks into the serialized public config.
const BUTTON_STYLE_STASH = Symbol("lgButtonStyle");

// True iff at least one axis differs from its default (i.e. the theme actually
// asked for a P6 button look — the ONLY case anything new is emitted).
function buttonStyleIsNonDefault(s: EffectiveButtonStyle): boolean {
  return s.fill !== "fill" || s.layout !== "grid" || s.selected !== "wash";
}

// Stash the resolved triple on the effective design (mutates the fresh clone
// resolveTokens already made — never the frozen registry singleton).
function setButtonStyle(design: EffectiveFunnelDesign, style: EffectiveButtonStyle): void {
  (design as unknown as Record<symbol, unknown>)[BUTTON_STYLE_STASH] = style;
}

// Read the stashed button style off a resolved design (styles.ts + presets.ts
// consumers). Undefined ⇒ no P6 button look was requested ⇒ the consumer emits
// exactly its pre-P6 markup/CSS (byte-identical). Accepts the base
// FunnelDesign too (the legacy render path passes the un-stashed registry
// design) — always undefined there.
export function readButtonStyle(
  design: FunnelDesign | EffectiveFunnelDesign,
): EffectiveButtonStyle | undefined {
  const stash = (design as unknown as Record<symbol, unknown>)[BUTTON_STYLE_STASH];
  return isRecord(stash) &&
    (THEME_BUTTON_STYLES as readonly string[]).includes(stash["fill"] as string) &&
    (THEME_BUTTON_LAYOUTS as readonly string[]).includes(stash["layout"] as string) &&
    (THEME_BUTTON_SELECTED_STYLES as readonly string[]).includes(stash["selected"] as string)
    ? (stash as unknown as EffectiveButtonStyle)
    : undefined;
}

// ---------------------------------------------------------------------------
// theme_json contract (§3.2 storage, §9.3 editor groups). All keys optional —
// absent keys inherit from the base design (`funnel_design_id`).
// ---------------------------------------------------------------------------

// §9.3 typography group. The display/body FONT families were already
// separated; P6 makes the display/body RAMP distinction explicit too:
//   • display — the HEADLINE family (`display`) + the HEADLINE ramp
//               (`display_size`, DISPLAY_FONTSIZE_PATHS only).
//   • body    — the PARAGRAPH family (`body`) + the overall/body ramp
//               (`size`, uniform).
export interface ThemeTypography {
  display?: ThemeFontId;
  body?: ThemeFontId;
  size?: ThemeSizeScale;
  // P6 (deliverable 2): the display-only headline ramp (m..xxl; absent ⇒ m ⇒
  // identity). xxl ≈ 72px headline (Image37). Independent of `size`.
  display_size?: ThemeDisplaySizeScale;
}

export interface ThemeScales {
  spacing?: ThemeSpacingScale;
  radius?: ThemeRadiusScale;
  shadow?: ThemeShadowScale;
}

export interface ThemeButtonDefaults {
  background_role?: FunnelTokenRole;
  text_role?: FunnelTokenRole;
  radius?: ThemeRadiusStep;
  min_height?: ThemeButtonMinHeight;
  casing?: ThemeButtonCasing;
  // P6 (deliverable 3) — the button-style vocabulary (Images 38-40). All
  // OPTIONAL; each absent ⇒ its `default` member ⇒ byte-identical to pre-P6.
  fill?: ThemeButtonStyle; // fill (default) | outline | soft (Image 39)
  layout?: ThemeButtonLayout; // grid (default) | list (Image 38) | card (Image23, §8.4)
  selected?: ThemeButtonSelectedStyle; // wash (default) | mark (Image 40)
}

export interface ThemeCardDefaults {
  background_role?: FunnelTokenRole;
  border_role?: FunnelTokenRole;
  radius?: ThemeRadiusStep;
  shadow?: ThemeShadowStep;
}

// R2 F-3 — the FIELD's inline component defaults (the third member of the
// button_defaults/card_defaults family). Absent ⇒ the base design's own
// `.lg-input` box, byte-identical to before this axis existed.
export interface ThemeFieldDefaults {
  min_height?: ThemeFieldMinHeight;
}

// Palette values: a #hex colour literal (allowed, but flagged as a warning —
// custom colours skip the design system, §9.3/§9.4) OR another role name (an
// alias, resolved against the BASE design's value for that role — never
// recursively through the theme, so aliases cannot cycle).
export type ThemePaletteValue = string;

export interface ThemeJson {
  version?: 1;
  palette?: Partial<Record<FunnelTokenRole, ThemePaletteValue>>;
  typography?: ThemeTypography;
  scales?: ThemeScales;
  button_defaults?: ThemeButtonDefaults;
  card_defaults?: ThemeCardDefaults;
  field_defaults?: ThemeFieldDefaults;
}

// Layer 3 (§9.2): the `theme` sub-object of a Variant's frame_overrides_json.
// §4.5 scopes variant theme overrides to palette roles only.
export interface VariantThemeOverrides {
  palette?: Partial<Record<FunnelTokenRole, ThemePaletteValue>>;
}

// ---------------------------------------------------------------------------
// v3.1 §10.1/§10.4 — Themes manager RECORDS (KV `lg-funnel-themes`, additive,
// PROPOSED storage model per the contract). A funnel's theme_json / a
// variant's frame_overrides_json.theme_id may now hold a REFERENCE
// `{theme_id}` instead of (never alongside) the legacy inline ThemeJson shape
// above — a discriminated union on the presence of `theme_id`. This module
// stays PURE: it defines the record shape + the resolution math; the admin
// handler layer (themes-handlers.ts) owns the KV read/write and fetches the
// record BEFORE calling resolveTokens (its 4th, optional `themeRecord`
// parameter below).
// ---------------------------------------------------------------------------

// A theme_json value that references a theme RECORD by id rather than
// carrying inline settings. Mutually exclusive with the legacy ThemeJson keys
// (§10.1 "NULL ⇒ legacy default look" — a {theme_id} value is the ONLY key
// present; validateTheme rejects a mix of theme_id + legacy keys).
export interface ThemeIdRef {
  theme_id: string;
}

export function isThemeIdRef(value: unknown): value is ThemeIdRef {
  return (
    isRecord(value) &&
    typeof value["theme_id"] === "string" &&
    value["theme_id"].trim() !== "" &&
    Object.keys(value).length === 1
  );
}

// §10.4 record example's 7 authoring roles — a CURATED subset of the 14
// FUNNEL_TOKEN_ROLES an operator edits in the Themes manager (Phase D). Names
// differ from the design-system roles (`page_bg` not `page_background`,
// `card` not `card_background`, `text` not `text_primary`) because they are
// the contract's own vocabulary (§10.4 JSON sample) —
// THEME_RECORD_ROLE_TO_TOKEN_ROLE below is the exhaustive, compile-checked
// bridge onto the existing token layer.
export const THEME_RECORD_ROLE_KEYS = [
  "brand_primary",
  "accent",
  "page_bg",
  "card",
  "text",
  "success",
  "error",
] as const;

export type ThemeRecordRoleKey = (typeof THEME_RECORD_ROLE_KEYS)[number];

export type ThemeRecordRoles = Record<ThemeRecordRoleKey, string>;

// The bridge onto FUNNEL_TOKEN_ROLES (§9.1) — resolveTokens applies a
// record's roles at EXACTLY the position inline theme_json.palette already
// feeds (below), so a theme record reskins through the SAME palette layer;
// no parallel colour system. `satisfies` keeps this exhaustive over the 7
// keys AND every value a real FunnelTokenRole (a compile error otherwise).
export const THEME_RECORD_ROLE_TO_TOKEN_ROLE = {
  brand_primary: "brand_primary",
  accent: "accent",
  page_bg: "page_background",
  card: "card_background",
  text: "text_primary",
  success: "success",
  error: "error",
} as const satisfies Record<ThemeRecordRoleKey, FunnelTokenRole>;

// P6 THEME v2 (follow-on ruling — "save-as-preset must carry the SAME
// richness as inline theme_json"): the 7 ADDITIONAL FUNNEL_TOKEN_ROLES
// completing the 14-role palette a rich preset can author, on a SEPARATE
// OPTIONAL field (`ThemeRecord.extra_roles` below) — never widening the
// original 7-key `ThemeRecordRoles`/`THEME_RECORD_ROLE_KEYS` above, so every
// existing typed literal/consumer of that exact 7-key shape stays untouched.
// Named identically to their FunnelTokenRole (no established alternate
// "contract vocabulary" exists for these 7 the way the original 7 have one —
// §10.4's JSON sample never enumerated them; P6b/product should rename here
// if a spec later surfaces a different authoring label). A pre-P6 record has
// no `extra_roles` key at all ⇒ contributes nothing ⇒ byte-identical to today.
export const THEME_RECORD_EXTRA_ROLE_KEYS = [
  "brand_secondary",
  "surface_wash",
  "border",
  "text_muted",
  "button_primary_bg",
  "button_primary_text",
  "button_secondary_bg",
] as const;

export type ThemeRecordExtraRoleKey = (typeof THEME_RECORD_EXTRA_ROLE_KEYS)[number];

// Every key OPTIONAL — a rich preset may author some/all/none of the 7.
export type ThemeRecordExtraRoles = Partial<Record<ThemeRecordExtraRoleKey, string>>;

// The bridge onto FUNNEL_TOKEN_ROLES — identity-shaped (the extra keys are
// already spelled as their FunnelTokenRole), but written out `satisfies`-style
// like the original 7's bridge for the SAME exhaustiveness guarantee: a
// renamed/removed FunnelTokenRole is a compile error here too.
export const THEME_RECORD_EXTRA_ROLE_TO_TOKEN_ROLE = {
  brand_secondary: "brand_secondary",
  surface_wash: "surface_wash",
  border: "border",
  text_muted: "text_muted",
  button_primary_bg: "button_primary_bg",
  button_primary_text: "button_primary_text",
  button_secondary_bg: "button_secondary_bg",
} as const satisfies Record<ThemeRecordExtraRoleKey, FunnelTokenRole>;

export const THEME_RECORD_FIELD_HEIGHTS = ["small", "medium", "large"] as const;
export type ThemeRecordFieldHeight = (typeof THEME_RECORD_FIELD_HEIGHTS)[number];

export const THEME_RECORD_BUTTON_SIZES = ["s", "m", "l"] as const;
export type ThemeRecordButtonSize = (typeof THEME_RECORD_BUTTON_SIZES)[number];

export const THEME_RECORD_CORNERS = ["sharp", "rounded", "pill"] as const;
export type ThemeRecordCorners = (typeof THEME_RECORD_CORNERS)[number];

// R2 F-1 — the record path's corner vocabulary bridged onto the §9.3 radius
// SCALE, exactly the way THEME_RECORD_ROLE_TO_TOKEN_ROLE bridges the record's
// colour roles onto FUNNEL_TOKEN_ROLES.
//
// DEFECT this closes (MEASURED on the live visitor page, three arms of ONE
// preset flipped through the real Themes-manager control: card 16px / answer
// 10px / continue 10px for sharp AND rounded AND pill, and identical
// --lg-radius-* on all three): a funnel whose theme_json is a {theme_id}
// REFERENCE gets `theme = {}` from isThemeIdRef in resolveTokens, so
// `theme.scales?.radius` is ALWAYS undefined on the preset path and radiusScale
// pinned to the "soft" identity — applyRadiusScale returned early on its zero
// shift and the P6 painted-corner shift (which genuinely works for inline
// theming) never ran. `controls.corners` reached EffectiveTokens.theme_controls
// and no consumer read it: the operator's very first act in the Themes manager
// (build a preset, pick Pill, look at the funnel) painted square corners.
//
// WHY A BRIDGE AND NOT A SECOND MECHANISM: the two vocabularies are the SAME
// 3-step corner language spelled in each path's own words, so the record's word
// is translated ONCE, here, into the value `radiusScale` already carries — one
// derivation (applyRadiusScale), both paths. A parallel "record corners"
// applier would have to re-derive the nearest-step component shift and would
// drift from the inline path the first time either side changed.
//
// The mapping is the order-preserving pairing of the two 3-value ladders
// (tighter / identity / looser). `rounded` is the record DEFAULT that every
// theme the shipped UI creates carries (ui-theme-manager.ts wireNewTheme) and
// it maps to `soft`, the SAME identity resolveTokens defaulted to before this
// bridge existed — so every pre-F-1 preset, and every funnel with no theme at
// all, renders byte-identically (applyRadiusScale still returns early on the
// zero shift). Only an operator who deliberately picks Sharp or Pill moves a
// pixel. `satisfies` keeps it exhaustive: a new corners value or a renamed
// radius scale is a compile error here, never a silent no-op.
export const THEME_RECORD_CORNERS_TO_RADIUS_SCALE = {
  sharp: "sharp",
  rounded: "soft",
  pill: "round",
} as const satisfies Record<ThemeRecordCorners, ThemeRadiusScale>;

// R2 F-2 — the record path's BUTTON-SIZE vocabulary bridged onto the primary
// button's own min-height token, the same shape F-1 used for corners.
//
// DEFECT this closes: `controls.button_size` was written by the Themes manager
// (ui-theme-manager.ts:914 "Button size"), validated (themes-handlers.ts),
// persisted to KV, re-checked on read (theme-store.ts) and published on
// EffectiveTokens.theme_controls — and then read by NOBODY. A grep of the whole
// public runtime for `button_size` returned only this type, the fallback
// constant DEFAULT_SIZE_THEME_CONTROLS and prose; content-schema.ts said so
// verbatim ("not consumed by this resolver"). The operator's Button size S/M/L
// under a heading that promises "Every question inherits these" moved zero
// pixels — the dead-control class the owner rejected the last build for.
//
// THE LADDER IS NOT INVENTED. presets.ts's own HEIGHT_PRESET_CSS documents its
// three steps by CITING this design's button heights: "medium = 52px — the
// theme Button-size M min-height", "large = 60px — the theme Button-size L
// min-height", "small = 44px — the base `.lg-input` min-height". §10.4's title
// says the same thing in words: "Buttons & inputs — THE SHARED SIZE LANGUAGE".
// So the field ladder and the button ladder are literally ONE px ladder spelled
// in each path's vocabulary — declared ONCE below and consumed by both, so the
// two can never drift (presets.ts's HEIGHT_PRESET_CSS is now built from the
// field-height table, not a second hand-typed copy).
//
// `m` -> "52px" IS defaultFunnelDesign.primaryButton.minHeight and `medium` ->
// "52px"… no: `small` -> "44px" IS the base `.lg-input` min-height. Each
// vocabulary's DEFAULT therefore lands on the value its target already had —
// button `m` = 52px (the manager's wireNewTheme default), field `medium` is the
// record default but the base input floor is `small`/44px, so a default record
// DOES raise an untouched field from 44 to 52. That is the §10.4 contract
// sentence quoted verbatim in content-schema.ts — "a field with no `size`
// override resolves to `controls.field_height`" — and the manager's own printed
// promise above the control, "Every question inherits these."
//
// `satisfies` keeps both tables exhaustive: a new size word is a compile error
// here, never a silent no-op.
// (SHARED_SIZE_LANGUAGE_PX is declared above, next to its first consumer.)

// R2 F-3 (gap 1) — THE TWO SIZE CONTROLS' PRESET->INLINE BRIDGES, the exact
// counterparts of THEME_RECORD_CORNERS_TO_RADIUS_SCALE above and the reason
// field_height/button_size can now survive the fork at all.
//
// Both are the IDENTITY on the word, because the inline vocabularies added in
// this change (THEME_FIELD_MIN_HEIGHTS, the widened THEME_BUTTON_MIN_HEIGHTS)
// are deliberately spelled in the RECORD's own words. `satisfies` is what makes
// that load-bearing rather than a coincidence: rename or re-order either
// vocabulary and this is a compile error, never a silent mis-map. Declaring the
// bridge explicitly (instead of letting the caller assume the words match) is
// also what lets theme-preset-resolve.ts SERIALIZE it into the admin island —
// the island can never hand-copy a stale table.
export const THEME_RECORD_BUTTON_SIZE_TO_INLINE_MIN_HEIGHT = {
  s: "s",
  m: "m",
  l: "l",
} as const satisfies Record<ThemeRecordButtonSize, ThemeButtonMinHeight>;

export const THEME_RECORD_FIELD_HEIGHT_TO_INLINE_MIN_HEIGHT = {
  small: "small",
  medium: "medium",
  large: "large",
} as const satisfies Record<ThemeRecordFieldHeight, ThemeFieldMinHeight>;

export const THEME_RECORD_BUTTON_SIZE_TO_MIN_HEIGHT = {
  s: SHARED_SIZE_LANGUAGE_PX[0],
  m: SHARED_SIZE_LANGUAGE_PX[1],
  l: SHARED_SIZE_LANGUAGE_PX[2],
} as const satisfies Record<ThemeRecordButtonSize, string>;

// R2 F-2 — the record path's FIELD-HEIGHT vocabulary on the SAME ladder.
//
// DEFECT this closes: `controls.field_height` did reach a consumer, but only
// one that could never fire for the operator who set it. presets.ts's
// sizeStyleEntries returns {} the instant a node carries NO
// `design_overrides.size` — which is every field on a funnel nobody has styled
// on the canvas — so the theme tier applied ONLY to a node that already had a
// size override with the height key missing. Set Field height = Large in the
// Themes manager, look at the funnel: nothing moves. Measured on the live
// visitor page before this fix (see the slice report): small/medium/large all
// painted the identical 55px field.
//
// WHY THE TOKEN AND NOT AN INLINE STYLE: emitting the theme tier as an inline
// `height:` on each un-overridden `.lg-input` would contradict a standing
// acceptance pin — leadgen-v31-themes-size-parity.test.ts asserts, for a funnel
// WITH a theme assigned, that an absent `design_overrides.size` leaves the
// field with no style attribute at all ("data-lg-input style=" must not
// appear). The BASE CSS layer is the correct home for a funnel-wide default
// anyway: `.lg-input`'s min-height stops being a hard-coded literal and becomes
// the `input.minHeight` token this applier writes, so a per-node override's
// inline height still wins by cascade exactly as before.
export const THEME_RECORD_FIELD_HEIGHT_TO_MIN_HEIGHT = {
  small: SHARED_SIZE_LANGUAGE_PX[0],
  medium: SHARED_SIZE_LANGUAGE_PX[1],
  large: SHARED_SIZE_LANGUAGE_PX[2],
} as const satisfies Record<ThemeRecordFieldHeight, string>;

// §10.4 "Buttons & inputs — the shared size language" — the record fields the
// §7 field-size resolver (a PARALLEL slice, content-schema/registry/presets)
// reads as the funnel-theme-default layer of its own size resolution; this
// module resolves + exposes them, and (R2 F-2) interprets `button_size` and
// `field_height` into the two design TOKENS above.
//
// That last part reverses this comment's original "never interprets
// `field_height` into pixels itself — that math belongs to the size resolver".
// It had to: the size resolver only ever runs for a node that carries a
// `design_overrides.size`, so leaving the math there left the theme control
// dead for every un-styled field, and the button pill never reaches the size
// resolver at all. The px ladder is NOT duplicated by the move — it is declared
// once here (SHARED_SIZE_LANGUAGE_PX) and presets.ts's HEIGHT_PRESET_CSS is
// built FROM it, so the per-node override tier and the theme tier remain one
// ladder with one owner.
export interface ThemeRecordControls {
  field_height: ThemeRecordFieldHeight;
  button_size: ThemeRecordButtonSize;
  corners: ThemeRecordCorners;
}

// P0 STORED-XSS FIX (adversarial review): headline_font/body_font used to be
// unconstrained strings. They flow resolveTokens -> applyDisplayFont/
// applyBodyFont -> design.page.fontDisplay/fontFamily (+ 5 sibling font
// slots) -> default-funnel/styles.ts's `rule()`/`decls()` (NO escaping,
// `${k}:${v}` literal) -> serve.ts `` `<style>${chromeCss}</style>` `` on a
// shell that sets NO CSP (serve.ts ga4HeadSnippet's own comment: "The shell
// sets no CSP"). An unconstrained string carrying `</style><script>…`
// breaks out of the <style> block into a real, PARSED <script> on every
// public /lg/:slug visitor — a stored XSS via a theme PATCH.
//
// FIX: headline_font/body_font are a CLOSED enum — the contract's OWN
// locked font vocabulary (§3.2 "Inter, Newsreader and Roboto Mono are OFL
// Google Fonts — no substitution permitted"), NOT the legacy inline theme's
// ThemeFontId enum above (literata/sora/system is a DIFFERENT, unrelated
// font set for a different, pre-v3.1 mechanism — reusing THAT set's VALUES
// would reject the contract's own "Newsreader"/"Inter" §10.4 sample). This
// reuses THEME_FONT_STACKS's ARCHITECTURE (closed enum + a
// Record<Enum,string> pre-vetted CSS-stack lookup), applied to the correct
// vocabulary. THEME_RECORD_FONT_STACKS below is the ONLY place a
// headline_font/body_font value may turn into a CSS string; the validator
// (themes-handlers.ts validateThemeBody) is the AUTHORITATIVE gate (REJECTS
// anything outside this set with a 400, mirroring the roles HEX_RE
// rejection); the KV-shape reader (theme-store.ts isThemeRecordShape) and
// resolveTokens's lookup below are DEFENSE IN DEPTH — even a corrupted KV
// blob or a caller that bypasses validation can never make a raw string
// reach the served <style> block through this path.
// P6 THEME v2 (follow-on ruling): widened with the SAME 8 self-hosted
// families the inline theme_json font ids name (THEME_FONT_STACKS
// poppins/space_grotesk/fraunces/playfair/manrope/dm_sans/work_sans/lexend),
// spelled as the REAL family name — this vocabulary's own established
// convention ("Newsreader"/"Inter", not a short id) — so a rich preset can
// pick the SAME self-hosted families inline theming can. The original 3 are
// UNCHANGED (same array positions/values) — back-compat.
export const THEME_RECORD_FONT_NAMES = [
  "Newsreader",
  "Inter",
  "Roboto Mono",
  "Poppins",
  "Space Grotesk",
  "Fraunces",
  "Playfair Display",
  "Manrope",
  "DM Sans",
  "Work Sans",
  "Lexend",
] as const;
export type ThemeRecordFontName = (typeof THEME_RECORD_FONT_NAMES)[number];

export function isThemeRecordFontName(value: unknown): value is ThemeRecordFontName {
  return typeof value === "string" && (THEME_RECORD_FONT_NAMES as readonly string[]).includes(value);
}

// The ONLY CSS font-family values a theme record's typography may ever
// produce — closed, pre-vetted, no interpolation of the stored name itself.
// P6: the 8 new entries REUSE THEME_FONT_STACKS' values verbatim (not
// re-typed literals) so the record path and the inline path produce
// byte-IDENTICAL stack strings for the same family — preset-vs-inline parity,
// and the SAME string styles.ts's font-face family-substring scan matches
// regardless of which path produced it (no styles.ts change needed).
export const THEME_RECORD_FONT_STACKS: Record<ThemeRecordFontName, string> = {
  Newsreader: "'Newsreader',Georgia,serif",
  Inter: "'Inter',system-ui,Arial,sans-serif",
  "Roboto Mono": "'Roboto Mono',monospace",
  Poppins: THEME_FONT_STACKS.poppins,
  "Space Grotesk": THEME_FONT_STACKS.space_grotesk,
  Fraunces: THEME_FONT_STACKS.fraunces,
  "Playfair Display": THEME_FONT_STACKS.playfair,
  Manrope: THEME_FONT_STACKS.manrope,
  "DM Sans": THEME_FONT_STACKS.dm_sans,
  "Work Sans": THEME_FONT_STACKS.work_sans,
  Lexend: THEME_FONT_STACKS.lexend,
};

export interface ThemeRecordTypography {
  headline_font: ThemeRecordFontName;
  body_font: ThemeRecordFontName;
  base_px: number;
  // P6 THEME v2 (follow-on ruling) — mirrors inline theme_json.typography.
  // display_size exactly (the SAME THEME_DISPLAY_SIZE_SCALES/_FACTORS table,
  // SAME scaleDisplayFontSizes call — resolveTokens below). OPTIONAL; absent
  // ⇒ "m" ⇒ identity ⇒ byte-identical to every pre-P6 record. No write-time
  // validator exists for this field yet (P6b's themes-handlers.ts /
  // theme-store.ts widening is the authoritative gate) — resolveTokens
  // defense-in-depth-validates it at read (safeRecordDisplaySize below),
  // mirroring this file's own base_px clamp discipline just above.
  display_size?: ThemeDisplaySizeScale;
}

// Defense-in-depth lookup (never the primary gate): an unrecognised name —
// which validateThemeBody + isThemeRecordShape should already have made
// unreachable — degrades to a safe generic stack rather than ever letting
// the raw value reach a CSS string.
function safeThemeRecordFontStack(value: string): string {
  return isThemeRecordFontName(value) ? THEME_RECORD_FONT_STACKS[value] : "inherit";
}

// §10.4 "Spacing PROPOSED … storage key reserved" — a free-form density
// label (e.g. "cozy"). Round-tripped only; never rendered without a design
// addendum (§0 fidelity-vs-function rule) — no Phase-A code interprets it.
export type ThemeRecordSpacing = string;

// P6 THEME v2 (follow-on ruling) — mirrors inline theme_json.button_defaults'
// {fill, layout, selected} vocabulary EXACTLY (the SAME THEME_BUTTON_STYLES /
// THEME_BUTTON_LAYOUTS / THEME_BUTTON_SELECTED_STYLES enums) — deliberately
// NOT the role/radius/min_height/casing axes (those stay theme_json-only;
// this follow-on's scope is exactly the 3 "button-style vocab" fields the
// ruling names). All optional; absent/all-default ⇒ resolveTokens stashes
// nothing ⇒ byte-identical to pre-P6.
export interface ThemeRecordButtonStyle {
  fill?: ThemeButtonStyle;
  layout?: ThemeButtonLayout;
  selected?: ThemeButtonSelectedStyle;
}

// One KV `lg-funnel-themes` record (§10.4 JSON sample, verbatim shape).
export interface ThemeRecord {
  id: string;
  name: string;
  roles: ThemeRecordRoles;
  typography: ThemeRecordTypography;
  controls: ThemeRecordControls;
  spacing?: ThemeRecordSpacing;
  // P6 THEME v2 (follow-on ruling — "save-as-preset must carry the SAME
  // richness as inline theme_json; a resolved ThemeRecord must not drop the
  // P6a axes"). Both OPTIONAL and ADDITIVE: a pre-P6 record (7 roles / 3
  // fonts / no button_style) has NEITHER key ⇒ resolveTokens's record branch
  // resolves BYTE-IDENTICAL to today (the same discipline as the inline
  // theme_json v1 back-compat gate — new fields are optional with defaults
  // that reproduce v1).
  extra_roles?: ThemeRecordExtraRoles;
  button_style?: ThemeRecordButtonStyle;
}

// PURE precedence rule (§10.1 "A funnel variant overrides it for A/B via
// frame_overrides_json.theme_id"): the variant's OWN theme_id wins over the
// funnel's, mirroring the existing variant-over-funnel palette precedence
// one layer up (§9.2). Takes the RAW parsed JSON columns (or null/
// undefined) — no KV I/O; the caller fetches whichever id wins and feeds
// that ONE record to resolveTokens as `themeRecord`. Returns null when
// neither carries a theme_id (legacy inline theme_json, or no theme at all).
export function winningThemeId(
  funnelThemeJson: unknown,
  variantFrameOverridesJson: unknown,
): string | null {
  const variantRef = isRecord(variantFrameOverridesJson)
    ? variantFrameOverridesJson["theme_id"]
    : undefined;
  if (typeof variantRef === "string" && variantRef.trim() !== "") return variantRef.trim();
  if (isThemeIdRef(funnelThemeJson)) return funnelThemeJson.theme_id;
  return null;
}

// ---------------------------------------------------------------------------
// EffectiveTokens — what resolveTokens returns. `design` keeps the FunnelDesign
// STRUCTURE (so funnelChromeCss + the presets consume it unchanged); `roles`
// is the resolved role → value table (§4.8 GET theme `effective_tokens`, the
// editor swatch grid).
// ---------------------------------------------------------------------------

// NOTE (P6): EffectiveTypography's SHAPE is deliberately unchanged — the
// display ramp lands in the design's display font-size tokens
// (scaleDisplayFontSizes), not as a new readout field here, so every existing
// exact-shape consumer/test of EffectiveTokens stays byte-identical. The §4.8
// editor reads the requested tier off theme_json.typography.display_size.
export interface EffectiveTypography {
  display: string;
  body: string;
  size: ThemeSizeScale;
}

export interface EffectiveScales {
  spacing: ThemeSpacingScale;
  radius: ThemeRadiusScale;
  shadow: ThemeShadowScale;
}

// NOTE (P6): EffectiveButtonDefaults's SHAPE is deliberately unchanged — the
// button-style triple travels on the design stash (readButtonStyle), NOT as new
// fields here, so every existing exact-shape consumer/test stays byte-identical.
// The live-render consumers (styles.ts / presets.ts) read the stash; the §4.8
// editor reads theme_json.button_defaults.{fill,layout,selected}.
export interface EffectiveButtonDefaults {
  background: string;
  color: string;
  border_radius: string;
  min_height: string;
  text_transform: "none" | "uppercase";
}

export interface EffectiveCardDefaults {
  background: string;
  border_color: string;
  border_radius: string;
  shadow: string;
}

export interface EffectiveTokens {
  design: EffectiveFunnelDesign;
  roles: Record<FunnelTokenRole, string>;
  typography: EffectiveTypography;
  scales: EffectiveScales;
  button_defaults: EffectiveButtonDefaults;
  card_defaults: EffectiveCardDefaults;
  // v3.1 §10.4/§12 (ADDITIVE) — present only when a theme RECORD resolved
  // (the 4th resolveTokens argument was supplied, i.e. theme_json / frame_
  // overrides_json referenced a theme_id and the caller fetched its KV
  // record). Consumed by: (a) the §7 field-size resolver (a parallel slice —
  // reads theme_controls.field_height as the funnel-theme-default size
  // layer); (b) preview/runtime parity for corners/button_size. Undefined
  // for legacy inline theme_json and for no theme (both existing-caller
  // shapes — strictly additive, no existing reader is affected).
  theme_controls?: ThemeRecordControls;
  theme_typography?: ThemeRecordTypography;
}

// ---------------------------------------------------------------------------
// resolveTokens — §9.2 priority layers 1 → 3, one pure function.
// ---------------------------------------------------------------------------

// Resolve the effective token set for (base design, funnel theme, variant
// overrides). Absent theme/overrides = IDENTITY to the base design (the
// returned `design` deep-equals the base; it is always a fresh copy, so the
// registry singleton is never mutated).
export function resolveTokens(
  baseDesign: FunnelDesign,
  theme_json?: ThemeJson | ThemeIdRef | null,
  frameOverridesTheme?: VariantThemeOverrides | null,
  themeRecord?: ThemeRecord | null,
): EffectiveTokens {
  // v3.1 §10.1: theme_json may be a {theme_id} REFERENCE instead of the
  // legacy inline shape — this function stays PURE (no KV), so the CALLER
  // resolves theme_id → record and supplies it as `themeRecord`; an absent
  // record (unknown/deleted id) degrades to the base design, identical to a
  // null theme (never a thrown error from a pure resolver).
  const theme: ThemeJson = isThemeIdRef(theme_json) ? {} : (theme_json ?? {});
  const overrides: VariantThemeOverrides = frameOverridesTheme ?? {};
  const record = themeRecord ?? null;

  // Fresh, widened working copy (plain JSON data by construction).
  const design = cloneJson(baseDesign) as EffectiveFunnelDesign;

  // A resolved theme RECORD's 7 authoring roles, bridged onto the 14-role
  // vocabulary (§10.4) — applied at EXACTLY the position inline
  // theme.palette already feeds (below), so `roles`/`design` stay the ONE
  // existing token layer (no parallel colour system for record-backed
  // themes).
  const recordPalette: Partial<Record<FunnelTokenRole, string>> =
    record !== null
      ? {
          ...(Object.fromEntries(
            THEME_RECORD_ROLE_KEYS.map((key) => [THEME_RECORD_ROLE_TO_TOKEN_ROLE[key], record.roles[key]]),
          ) as Partial<Record<FunnelTokenRole, string>>),
          // P6 THEME v2 (follow-on ruling): the 7 additional roles completing
          // the 14-role palette — see recordExtraPalette below for the
          // defense-in-depth hex filter (no upstream validator exists for this
          // field yet). Absent `extra_roles` (every pre-P6 record) contributes
          // nothing — byte-identical to today.
          ...recordExtraPalette(record.extra_roles),
        }
      : {};

  // v3.1 fix (adversarial review MINOR-3): when a WINNING theme record is
  // present, the funnel's legacy INLINE theme_json.palette must NOT
  // partially leak through underneath it. Repro: a funnel with an inline
  // `theme_json.palette` AND a variant `frame_overrides_json.theme_id=B` —
  // winningThemeId correctly picks B, but `theme_json` (the funnel's raw
  // column) is passed to this function UNCHANGED regardless of which id
  // won (only a {theme_id} shape empties `theme` above via isThemeIdRef; an
  // INLINE shape does not), so `theme.palette` used to still compete
  // role-by-role against `recordPalette` and could win for any role the
  // inline blob specified — "variant theme partially masked" (§10.1: a
  // variant theme_id assignment is a clean switch, never a per-role blend
  // with whatever the funnel's inline theme happens to say). Once a record
  // has won, it fully supersedes the funnel-level inline palette; the
  // per-variant AD HOC `overrides.palette` (frame_overrides_json.theme.
  // palette — a different, still-independent layer) keeps its existing
  // top-priority slot.
  const legacyPalette = record !== null ? undefined : theme.palette;

  // --- palette (roles), layers 3 → 2 → 1 -----------------------------------
  const roles = {} as Record<FunnelTokenRole, string>;
  // Which roles the operator actually AUTHORED (any layer). The frozen-copy
  // appliers below must fire only for these: an unauthored role resolves to
  // its own base value, and re-writing that value through a different token
  // SHAPE (e.g. "#0E7C3A" over the border shorthand "1px solid #0E7C3A")
  // would not be a no-op. Gating on "authored" is what keeps a funnel that
  // sets neither key byte-identical (S3.6 invariant I5).
  const authoredRoles = new Set<FunnelTokenRole>();
  for (const role of FUNNEL_TOKEN_ROLES) {
    const layered =
      pickPaletteValue(overrides.palette, role) ??
      pickPaletteValue(legacyPalette, role) ??
      recordPalette[role];
    if (layered !== undefined) {
      // A role-name value is an alias into the BASE design (layer 1) — never
      // recursive through the theme, so aliases cannot cycle.
      const resolved = isFunnelTokenRole(layered) ? baseTokenForRole(baseDesign, layered) : layered;
      roles[role] = resolved;
      setRoleToken(design, role, resolved);
      authoredRoles.add(role);
    } else {
      roles[role] = baseTokenForRole(baseDesign, role);
    }
  }

  // R2 P8 M2 / S3.6 — TWO ROLES THAT DID NOT PAINT WHAT THEY NAME.
  //
  // MEASURED at HEAD on the live visitor page by the driven 34-key inline
  // sweep (docs/leadgen/r2/evidence/p8/m2/inline-sweep-before.txt), each role
  // written through the real operator route and the first VISIBLE match read
  // with getComputedStyle:
  //   • `success` was DEAD (sweep line 20): the ONLY two mentions of
  //     `color.success` in src/public/leadgen/ are its own definitions —
  //     ROLE_TO_BASE_TOKEN above and the unread `--lg-success` custom property
  //     (styles.ts:500). Zero CSS rule read either. The operator was offered a
  //     "Success" colour that painted nothing.
  //   • `card_background` was MIS-TARGETED (sweep line 34): it moved an
  //     `input.lg-input` (326x54, via color.card → styles.ts:1828) while
  //     `.lg-question-card` (420x406) — the element the label "Card
  //     background" names, and the first item in its own ROLE_META `used_by`
  //     ("question card, answer cards") — stayed rgb(255,255,255) on BOTH arms.
  //
  // THE ONE CAUSE: the base design FROZE COPIES of these role colours into
  // component token slots instead of referencing the role token, so writing
  // the role left the painted component untouched. It is the SAME cause the
  // card_defaults fix below (§ "card defaults") already closed on the other
  // authoring axis — one cause, two axes.
  //
  // THE FIX, additive exactly like that one: an AUTHORED role also writes the
  // frozen copies it owns. Every pre-existing write is kept (color.success and
  // color.card still move), so no existing consumer changes shape — `.lg-input`
  // (styles.ts:1828, pinned by leadgen-theme-tokens.test.ts) keeps its
  // behaviour. No control is added, removed or relabelled.
  if (authoredRoles.has("success")) applySuccessRole(design, roles.success);
  // R2 P8 M2 / S3.9 — THE THIRD ROLE OF THE SAME SHAPE: `error` ("Error",
  // used_by "validation errors" — ROLE_META, quotes-tabs/shared.ts:462).
  //
  // MEASURED at this HEAD, by hand: `grep -rn "data-error" src/` returns 19
  // hits and NOT ONE of them writes a `data-error` attribute — 16 are the
  // unrelated admin `data-error-for` slot id, 1 is render-error.ts's
  // `data-error-status`, and the remaining 2 ARE the two CSS rules that read
  // it (styles.ts:282 `.lg-tscard[data-error="true"]` <- color.error and
  // styles.ts:1720 `.lg-card[data-error="true"]` <- iconCard.errorBorderColor).
  // No producer exists anywhere in the product, so `color.error` — the token
  // this role writes through setRoleToken above — reached only those two
  // unreachable rules plus the unread `--lg-error` custom property
  // (styles.ts:501). The operator was offered an "Error" colour that painted
  // nothing a visitor can ever see.
  //
  // THE REAL ERROR STATE, read out of source (runtime/render.ts:228
  // setFieldError — the ONE producer, called by engine.ts on a failed
  // validation): it (a) fills + unhides the `[data-lg-error-for="…"]` slot,
  // (b) adds ERROR_CLASS ("lg-error") to the owning `[data-lg-field]` block,
  // (c) sets `aria-invalid="true"` on its `[data-lg-input]`. The rules that DO
  // match that state read FROZEN COPIES of the same red:
  //   • styles.ts:1834 `.lg-input[aria-invalid="true"]` <- input.errorBorderColor
  //   • styles.ts:1882 `.lg-error`                      <- validation.errorTextColor
  //     (the slot ALSO carries that token inline from the renderer itself —
  //     presets.ts:333/3146/3721 `style({color: validation.errorTextColor})`)
  // Both are frozen "#D32F2F" copies of color.error (tokens.ts:152/156/158) —
  // the SAME cause as success/card_background above, third axis. So the fix is
  // the same additive one: an AUTHORED role also writes the frozen copies it
  // owns. Every pre-existing write is kept (color.error still moves).
  //
  // DONE IN S3.10 (was deferred here as "not done — byte-pinned fixtures this
  // slice does not own"): both `[data-error="true"]` rules are now re-pointed
  // at the state the runtime really produces — styles.ts `${scope} .lg-error
  // .lg-tscard` and `${scope} .lg-error .lg-card`. No `data-error` producer was
  // invented; the two fixtures were re-minted against the real renderer.
  if (authoredRoles.has("error")) applyErrorRole(design, roles.error);
  // R2 P8 M2 / S3.10 — THE FOURTH ROLE OF THE SAME SHAPE: `accent` ("Accent",
  // used_by "category label, highlights, recommended" — ROLE_META,
  // quotes-tabs/shared.ts:460, rendered VERBATIM into the theme rail the
  // operator reads at quotes-tabs/themes.ts:201). See applyAccentRole below for
  // the surface-by-surface enumeration this fires.
  if (authoredRoles.has("accent")) applyAccentRole(design, roles.accent);
  if (authoredRoles.has("card_background")) {
    // PRECEDENCE (S3.6 invariant I3): applied HERE, before the card_defaults
    // block, so an explicit `card_defaults.background_role` — the operator's
    // narrower, component-level "Card background" control — OVERWRITES this
    // theme-wide semantic role. Same direction as the explicit-shadow-step
    // rule below: the more specific control always wins. Pinned both ways by
    // leadgen-p8-m2-palette-roles.test.ts.
    design.questionCard.background = roles.card_background;
  }

  // --- scales (§9.3) --------------------------------------------------------
  const spacingScale: ThemeSpacingScale = theme.scales?.spacing ?? "regular";
  // R2 F-1: a resolved theme RECORD's `controls.corners` IS this path's radius
  // scale (THEME_RECORD_CORNERS_TO_RADIUS_SCALE above), so the preset path and
  // the inline path converge on the ONE derivation below (applyRadiusScale)
  // instead of a second, drift-prone corner mechanism. The two inputs are
  // mutually exclusive by construction — `theme` is {} whenever a record is
  // present (isThemeIdRef) and `record` is null on the inline path — so this
  // ?? chain never blends them; the inline term stays FIRST anyway, preserving
  // the existing precedence for any caller that supplies both. Absent record /
  // `rounded` (the UI's default) resolves to "soft", the pre-F-1 value.
  const radiusScale: ThemeRadiusScale = theme.scales?.radius ?? safeRecordCorners(record) ?? "soft";
  const shadowScale: ThemeShadowScale = theme.scales?.shadow ?? "mid";
  applySpacingScale(design, spacingScale);
  applyRadiusScale(design, radiusScale);
  applyShadowScale(design, shadowScale);
  // R2 F-2: the record's `controls.button_size` IS the primary pill's height
  // step (THEME_RECORD_BUTTON_SIZE_TO_MIN_HEIGHT above). Record-only, exactly
  // like corners' record arm: absent record / off-table value -> undefined ->
  // the token is left at its current value, byte-identical to pre-F-2.
  //
  // R2 F-3: …and its INLINE counterpart, `button_defaults.min_height`, which
  // is what carries the operator's choice across the preset->inline fork. The
  // inline term is FIRST for the same reason radiusScale's is: the two inputs
  // are mutually exclusive by construction, and where a caller supplies both
  // the explicit inline value wins. (button_defaults.min_height is ALSO applied
  // in the component-defaults block further down, which is where it landed
  // before this change; both write the same token from the same table, so the
  // order is immaterial — this position is what makes the record and inline
  // paths converge on ONE applier.)
  applyButtonSizeStep(design, inlineButtonMinHeight(theme) ?? safeRecordButtonSize(record));
  // R2 F-2: and the record's `controls.field_height` IS the base field box's
  // min-height (styles.ts `.lg-input`), on the same shared ladder. Same
  // record-only, fail-soft contract — plus (R2 F-3) the same inline arm.
  applyFieldHeightStep(design, inlineFieldMinHeight(theme) ?? safeRecordFieldHeight(record));

  // --- typography (§9.3) ----------------------------------------------------
  const sizeScale: ThemeSizeScale = theme.typography?.size ?? "m";
  // P6 (deliverable 2): the DISPLAY ramp — a separate axis from `size` scaling
  // ONLY the display font-size tokens, so a display-XXL headline never enlarges
  // body copy. `m` (absent) is the identity ⇒ byte-identical to pre-P6.
  const displaySizeScale: ThemeDisplaySizeScale = theme.typography?.display_size ?? "m";
  const displayId = theme.typography?.display;
  const bodyId = theme.typography?.body;
  if (displayId !== undefined) applyDisplayFont(design, THEME_FONT_STACKS[displayId]);
  if (bodyId !== undefined) applyBodyFont(design, THEME_FONT_STACKS[bodyId]);
  if (THEME_SIZE_FACTORS[sizeScale] !== 1) {
    scaleFontSizes(design as unknown as Record<string, unknown>, THEME_SIZE_FACTORS[sizeScale]);
  }
  // Applied AFTER the uniform size scale so the two compound (display-XXL rides
  // on top of a chosen body size). Scales the display font-size tokens only.
  if (THEME_DISPLAY_SIZE_FACTORS[displaySizeScale] !== 1) {
    scaleDisplayFontSizes(design, THEME_DISPLAY_SIZE_FACTORS[displaySizeScale]);
  }
  // v3.1 §10.4: a resolved theme RECORD's typography feeds the SAME design
  // slots the curated display/body ids above would — record-backed and
  // legacy-curated theme_json are mutually exclusive inputs (isThemeIdRef
  // empties `theme` in the record path), so this never overwrites a legacy
  // pick; it IS the theme_id path's own typography layer.
  if (record !== null) {
    // P0 stored-XSS fix: NEVER the raw record string — always the closed
    // whitelist lookup (safeThemeRecordFontStack), so a corrupted/bypassed-
    // validation record can never inject through this path either.
    applyDisplayFont(design, safeThemeRecordFontStack(record.typography.headline_font));
    applyBodyFont(design, safeThemeRecordFontStack(record.typography.body_font));

    // R5 SEAM-1 (base_px consumer): record.typography.base_px was validated
    // at write time (themes-handlers.ts: finite number, 10-24) and round-
    // tripped through KV since the Themes-manager Phase A slice, but nothing
    // downstream ever read it off theme_typography (below / line ~500) — a
    // resolved theme record could carry any value and no rendered pixel
    // would differ. base_px IS the record path's own typography-scale
    // control: curated theme_json has typography.size (s/m/l, sizeScale
    // above) but ThemeRecordTypography has no `size` field at all — this is
    // that path's one and only size lever, continuously parameterized
    // instead of 3 discrete steps. Reuses the SAME unit-agnostic
    // scaleFontSizes the curated sizeScale above uses — every *FontSize*
    // token (px/rem) scales by the same factor.
    //
    // Defense-in-depth (mirrors the P0 font-name gate above): the write-time
    // gate is authoritative; a KV record read straight from storage only
    // re-checks "is a number" (theme-store.ts), so a hand-edited/corrupted
    // blob could carry an out-of-range value here. Clamping to the same
    // validated 10-24 range (falling back to the neutral default if the
    // stored value isn't even a finite number) keeps a malformed record's
    // factor sane instead of ever reaching scaleCssLength with something a
    // real record could never have produced.
    //
    // BLAST RADIUS (conductor/operator note): factor = base_px / 16. Every
    // ThemeRecord reachable through the shipped UI carries base_px:16 (no
    // input control exists to author a different one yet) and every existing
    // fixture/test in the repo uses base_px:16 too (repo-wide grep, R5) — so
    // this factor is 1 (scaleFontSizes short-circuited, byte-identical
    // output) for every theme in active use today. The day an operator (or a
    // future UI control) sets a non-16 base_px, EVERY font-size token in
    // that theme's funnels scales by base_px/16 — the same KIND of change
    // the s/m/l scale already makes, just continuously parameterized. No KV
    // read access from this slice to confirm no LIVE `lg-funnel-themes`
    // record already carries a hand-edited non-16 value — worth a spot check
    // before this ships.
    const rawBasePx = record.typography.base_px;
    const safeBasePx = Number.isFinite(rawBasePx)
      ? Math.min(24, Math.max(10, rawBasePx))
      : THEME_RECORD_BASE_PX_DEFAULT;
    const basePxFactor = safeBasePx / THEME_RECORD_BASE_PX_DEFAULT;
    if (basePxFactor !== 1) {
      scaleFontSizes(design as unknown as Record<string, unknown>, basePxFactor);
    }

    // P6 THEME v2 (follow-on ruling) — the record path's OWN display-only
    // ramp, mirroring the inline branch's displaySizeScale above EXACTLY (the
    // SAME THEME_DISPLAY_SIZE_FACTORS table, SAME scaleDisplayFontSizes call)
    // so a preset resolves IDENTICALLY to the same display_size applied
    // inline (preset-vs-inline parity). Applied AFTER base_px so the two
    // compound the same way the inline size+display_size pair does above.
    // safeRecordDisplaySize defense-in-depth-validates (no write-time
    // validator exists for this field yet, P6b) — an invalid/absent value
    // defaults to "m" (identity), never reaching scaleCssLength with a factor
    // a real validated record could not have produced.
    const recordDisplaySize = safeRecordDisplaySize(record.typography.display_size);
    if (THEME_DISPLAY_SIZE_FACTORS[recordDisplaySize] !== 1) {
      scaleDisplayFontSizes(design, THEME_DISPLAY_SIZE_FACTORS[recordDisplaySize]);
    }
  }

  // --- button defaults (§9.3) — applied AFTER palette + scales so a radius
  // step reads the effective radius scale and role picks read resolved roles.
  const bd = theme.button_defaults ?? {};
  if (bd.background_role !== undefined) design.primaryButton.background = roles[bd.background_role];
  if (bd.text_role !== undefined) design.primaryButton.color = roles[bd.text_role];
  if (bd.radius !== undefined) design.primaryButton.borderRadius = design.radius[bd.radius];
  if (bd.min_height !== undefined) design.primaryButton.minHeight = BUTTON_MIN_HEIGHT_CSS[bd.min_height];
  // P6 THEME v2 (follow-on ruling): a resolved theme RECORD's button_style
  // feeds the SAME resolution the inline theme_json.button_defaults fill/
  // layout/selected would — mutually exclusive inputs (`bd` is `{}` on the
  // record path since `theme = {}` there; `record` is null on the inline
  // path), so a preset's button-style axes resolve through the ONE existing
  // mechanism. safeRecordButtonStyle defense-in-depth-validates each field
  // (no write-time validator exists for this field yet, P6b) — an invalid
  // value is dropped (falls through to default), never stashed raw;
  // readButtonStyle's own downstream enum re-check (above) is a SECOND,
  // unconditional layer regardless of source.
  const recordButtonStyle = safeRecordButtonStyle(record?.button_style);
  // P6 (deliverable 3): resolve the button-style triple (defaults applied) and
  // STASH it on the design (Symbol key) so the live-render consumers
  // (funnelChromeCss / the section renderers) reskin through ONE source. Only
  // stashed when at least one axis is non-default — a legacy/v1 theme leaves
  // the design (and therefore every consumer's output) byte-identical.
  const buttonStyle: EffectiveButtonStyle = {
    fill: bd.fill ?? recordButtonStyle.fill ?? BUTTON_STYLE_DEFAULTS.fill,
    layout: bd.layout ?? recordButtonStyle.layout ?? BUTTON_STYLE_DEFAULTS.layout,
    selected: bd.selected ?? recordButtonStyle.selected ?? BUTTON_STYLE_DEFAULTS.selected,
  };
  if (buttonStyleIsNonDefault(buttonStyle)) setButtonStyle(design, buttonStyle);
  // R2 P8 M2: the SAME casing value that feeds the readout below now also
  // travels to the stylesheet (readButtonCasing → styles.ts's `.lg-btn`
  // text-transform rule, which reaches BOTH surfaces the visitor presses:
  // `.lg-continue` and `.lg-btn-answer` both carry `.lg-btn`). One resolution,
  // two consumers — the readout can no longer say "uppercase" while the page
  // paints lowercase.
  if (bd.casing === "upper") setButtonCasing(design, "upper");
  const button_defaults: EffectiveButtonDefaults = {
    background: design.primaryButton.background,
    color: design.primaryButton.color,
    border_radius: design.primaryButton.borderRadius,
    min_height: design.primaryButton.minHeight,
    text_transform: bd.casing === "upper" ? "uppercase" : "none",
  };

  // --- card defaults (§9.3) --------------------------------------------------
  //
  // R2 P8 M2 — THE CARD THE OPERATOR MEANS IS `.lg-question-card`.
  //
  // MEASURED at HEAD on the live visitor page (docs/leadgen/r2/evidence/p8/m2/
  // repro-before.txt), each key flipped through the real operator route and the
  // first VISIBLE match read with getComputedStyle: `shadow` none->xl, `radius`
  // sm->full and `border_role` error->success all left the one card a visitor
  // sees (420x86 `.lg-question-card`) IDENTICAL, and `background_role`
  // error->success moved the wrong element — an `input.lg-input`.
  //
  // WHY: the four keys resolved onto design.color.card / design.content.
  // cardRadius / design.cardPanel.border (+ a shadow that reached no design
  // token at all), whose only card-shaped selectors are `.lg-card-panel` /
  // `.lg-disclosure-panel` — components a driven funnel page renders ZERO nodes
  // of. The card that IS painted reads the `questionCard` token group
  // (styles.ts `.lg-question-card`), which no theme layer ever wrote. The
  // operator's own labels are "Card background / Card border / Card corners /
  // Card shadow" (quotes-tabs/themes.ts), and in this product those words name
  // `.lg-question-card`.
  //
  // THE FIX: each key ALSO writes the questionCard slot its label names. The
  // pre-existing writes are KEPT (byte-identical for every consumer of
  // color.card / content.cardRadius / cardPanel.border — a theme that sets none
  // of these keys is untouched either way), so this is purely additive: the
  // label now reaches the surface it names as well as the ones it already did.
  const cd = theme.card_defaults ?? {};
  if (cd.background_role !== undefined) {
    // R2 P8 F4 (review MAJOR-1) — THE `design.color.card = …` WRITE THAT USED TO
    // SIT HERE IS GONE, deliberately.
    //
    // `color.card` is NOT a card slot: it is the base token OF THE
    // `card_background` ROLE (ROLE_TO_BASE_TOKEN, top of file). Writing it from
    // a COMPONENT control re-pointed the role itself, so a control the operator
    // reads as "Card background" dragged every consumer of that role with it.
    // MEASURED on the live product (docs/leadgen/r2/evidence/p8/review-p8-3/
    // REVIEW.md) with `palette.card_background` pinned #FFFFFF and
    // `palette.page_background` pinned #F5F7FA in BOTH arms and ONLY
    // `card_defaults.background_role` flipped error -> success:
    //   .lg-question-card    rgb(194,24,7) -> rgb(18,165,148)   INTENDED, 420x484
    //   input.lg-input       rgb(194,24,7) -> rgb(18,165,148)   4/4 fields, 326x54
    //   .lg-frame-background rgb(194,24,7) -> rgb(18,165,148)   1280x900 FIXED OVERLAY
    // The page flooded, all four form fields went teal-on-teal, and the
    // operator's OWN `palette.card_background` swatch — a DIFFERENT control in
    // the same rail — was silently overridden.
    //
    // A component-scoped control writes its component's slot ONLY. The role
    // keeps its own writers (setRoleToken + the palette block above), so
    // `palette.card_background` still moves `.lg-input`, `.lg-frame-background`,
    // `--lg-card` and the answer-card fill exactly as before: nothing is
    // re-routed, and the two controls now COMPOSE (role paints the family, the
    // component control wins the card). Pinned both ways, plus the negative leg,
    // by leadgen-p8-f4-component-scope.test.ts.
    design.questionCard.background = roles[cd.background_role];
  }
  if (cd.radius !== undefined) {
    design.content.cardRadius = design.radius[cd.radius];
    // Applied AFTER applyRadiusScale (above), which shifts this same field —
    // so an explicit STEP wins over the scale, exactly as applyRadiusScale's
    // own comment already promised for the other component corners.
    design.questionCard.borderRadius = design.radius[cd.radius];
  }
  if (cd.border_role !== undefined) {
    design.cardPanel.border = `1px solid ${roles[cd.border_role]}`;
    // The base card border is `1px solid #E9EDF3` — the same 1px-solid shape,
    // so only the colour moves.
    design.questionCard.border = `1px solid ${roles[cd.border_role]}`;
  }
  // PRECEDENCE, decided deliberately (R2 P8 M2 invariant I3): where BOTH
  // `scales.shadow` (a scale) and `card_defaults.shadow` (an explicit step)
  // reach this surface, the EXPLICIT STEP WINS — unconditionally. It is
  // therefore resolved against the BASE design's shadow ladder, not the
  // scale-shifted one: `scales.shadow:"none"` blanks every step of the working
  // ladder (applyShadowScale), so resolving the step there would silently hand
  // the scale the win for exactly the combination this rule exists to settle
  // ("no shadows overall, but this card is elevated"). The step is applied
  // after the scale, so it overwrites the scale's component shift too.
  // Pinned both ways by leadgen-p8-m2-theme-keys.test.ts.
  const explicitCardShadow = cd.shadow !== undefined ? shadowStepValue(baseDesign, cd.shadow) : undefined;
  if (explicitCardShadow !== undefined) design.questionCard.boxShadow = explicitCardShadow;
  const card_defaults: EffectiveCardDefaults = {
    // F4: the value that PAINTS the card (one resolution, never a second
    // opinion), exactly like `shadow` below. Until F4 this read
    // `design.color.card` — the ROLE token — which after the fix above can
    // legitimately differ from what the card paints, so the readout would have
    // reported the role while the card showed the component control's colour.
    // With no component control authored this is the role's value anyway
    // (the palette block writes both slots), so an unauthored/palette-only
    // theme reports byte-identically to before.
    background: design.questionCard.background,
    border_color: cd.border_role !== undefined ? roles[cd.border_role] : design.color.border,
    border_radius: design.content.cardRadius,
    // The readout is the value that PAINTS (one resolution, never a second
    // opinion) — `design.shadow.md` when no step was authored, i.e. the scale.
    shadow: explicitCardShadow ?? design.shadow.md,
  };

  const result: EffectiveTokens = {
    design,
    roles,
    typography: {
      // record-backed display/body already landed in design.page.fontDisplay
      // / fontFamily above (applyDisplayFont/applyBodyFont just wrote them),
      // so reading them back here keeps ONE source of truth (no third branch).
      display: displayId !== undefined ? THEME_FONT_STACKS[displayId] : design.page.fontDisplay,
      body: bodyId !== undefined ? THEME_FONT_STACKS[bodyId] : design.page.fontFamily,
      size: sizeScale,
    },
    scales: { spacing: spacingScale, radius: radiusScale, shadow: shadowScale },
    button_defaults,
    card_defaults,
  };
  if (record !== null) {
    result.theme_controls = record.controls;
    result.theme_typography = record.typography;
  } else {
    // R2 F-3: the forked (inline) funnel publishes the SAME node-tier
    // inherit-default the preset published — see inlineThemeControls.
    const inlineControls = inlineThemeControls(theme);
    if (inlineControls !== undefined) result.theme_controls = inlineControls;
  }
  return result;
}

function pickPaletteValue(
  palette: Partial<Record<FunnelTokenRole, ThemePaletteValue>> | undefined,
  role: FunnelTokenRole,
): string | undefined {
  const value = palette?.[role];
  return typeof value === "string" ? value : undefined;
}

// R2 P8 M2 / S3.6 — the frozen copies of `color.success`, wired to the role.
//
// THE ENUMERATION this list is built from — every surface in this product
// where a success state is rendered to a VISITOR, read out of source, which is
// what settled "wire it" over "remove the control" (contract R3 corollary):
//   • SuccessState     `.lg-success` / `.lg-success-icon` — renderSuccessState
//                      (presets.ts), node type "SuccessState"; painted from
//                      successState.border / .iconColor (styles.ts) AND styled
//                      inline by the renderer from the same two tokens.
//   • ReassuranceBadge `.lg-badge` / `.lg-badge-icon` — renderReassuranceBadge,
//                      node type "ReassuranceBadge"; painted from
//                      reassuranceBadge.border / .textColor / .iconColor.
//                      ("reassurance" is the first word of this role's own
//                      ROLE_META `used_by`, quotes-tabs/shared.ts.)
//   • TrustBar         `.lg-trustbar-icon` — renderTrustBar, node type
//                      "TrustBar"; painted from trustBar.iconColor.
// Real success surfaces exist, so the control stays and is made honest; no
// success surface was invented to justify keeping it.
//
// `validation.successColor` has ZERO consumers in styles.ts/presets.ts. It is
// written for coherence (one success colour, no stale second opinion in the
// resolved design) — never counted as paint.
//
// The border tokens are `1px solid <colour>` in the base design, so only the
// COLOUR moves and the 1px-solid shape is preserved — the same treatment
// questionCard.border already gets in the card_defaults block.
function applySuccessRole(design: EffectiveFunnelDesign, value: string): void {
  design.successState.border = `1px solid ${value}`;
  design.successState.iconColor = value;
  design.reassuranceBadge.border = `1px solid ${value}`;
  design.reassuranceBadge.iconColor = value;
  design.reassuranceBadge.textColor = value;
  design.trustBar.iconColor = value;
  design.validation.successColor = value;
}

// R2 P8 M2 / S3.9 — the frozen copies of `color.error`, wired to the role.
// Read the applySuccessRole comment above first: this is the SAME pattern on
// the error axis, deliberately not a second invention.
//
// THE ENUMERATION this list is built from — every place a base token IS the
// error red at HEAD (`grep -n "#D32F2F" tokens.ts` = 4 slots: color.error:30,
// iconCard.errorBorderColor:148, input.errorBorderColor:156,
// validation.errorTextColor:158) crossed with the rule that reads it:
//   • input.errorBorderColor    -> `.lg-input[aria-invalid="true"]`
//                                  (styles.ts:1834). REAL: render.ts:228 sets
//                                  exactly that attribute on [data-lg-input].
//   • validation.errorTextColor -> `.lg-error` (styles.ts:1882) AND the error
//                                  slot's own inline `color` from the renderer
//                                  (presets.ts:333/3146/3721). REAL: the slot
//                                  render.ts:228 fills and unhides carries the
//                                  class, and ERROR_CLASS is that same class.
//   • iconCard.errorBorderColor -> WAS `.lg-card[data-error="true"]`
//                                  (styles.ts:1720) — unreachable, because no
//                                  producer anywhere writes `data-error`.
//                                  S3.10 RE-POINTED that rule at the state the
//                                  runtime does produce (`${scope} .lg-error
//                                  .lg-card`: ERROR_CLASS lands on the
//                                  [data-lg-field] group root — presets.ts:178
//                                  hydration() — and the choice cards are its
//                                  descendants), so this write now PAINTS.
// `color.error` itself keeps its existing write (setRoleToken, above) — it also
// reaches the re-pointed `${scope} .lg-error .lg-tscard` (styles.ts:282), the
// same treatment on the title/subtitle answer pack.
// This applier is additive and re-routes nothing.
function applyErrorRole(design: EffectiveFunnelDesign, value: string): void {
  design.input.errorBorderColor = value;
  design.validation.errorTextColor = value;
  design.iconCard.errorBorderColor = value;
}

// R2 P8 M2 / S3.10 — the frozen copies of `color.accent`, wired to the role.
// Read the applySuccessRole comment above first: this is the SAME pattern on
// the accent axis, deliberately not a fourth invention.
//
// THE ENUMERATION, built exactly the way applyErrorRole's was — every base
// token that IS the accent orange (`grep -n "E85D26" default-funnel/tokens.ts`
// = 7 slots on 5 lines) crossed with the rule that reads it, and matched
// against the three things the operator's OWN "Used by" line promises
// ("category label, highlights, recommended"):
//   • categoryLabel.color   -> "CATEGORY LABEL". `${scope} .lg-category`
//                              (styles.ts:877) AND the renderer's own inline
//                              `style({color})` (presets.ts:911/3802, the
//                              `?? design.categoryLabel.color` default).
//                              REAL: node types CategoryLabel and TextBlock
//                              role "Category label" both render .lg-category.
//   • header.logoAccentColor -> "HIGHLIGHTS". `${scope} .lg-logo-accent`
//                              (styles.ts:812) AND the renderer's inline
//                              style (presets.ts:846/3952) on the Header /
//                              auto-logo image block. MEASURED: the product
//                              has NO element called a "highlight" (`grep -rni
//                              highlight src/public/leadgen` = 0 hits); the one
//                              accent-painted emphasis surface that exists is
//                              the highlighted word of the logo, so that is
//                              what the word is honoured against. No highlight
//                              element was invented to satisfy the label.
//   • banner.recommendedBorder -> "RECOMMENDED". `${scope} .lg-banner[data-
//                              recommended="true"]` (styles.ts:1909). REAL and
//                              REACHABLE: auction/banner.ts:303 renders
//                              `data-recommended="true"` for the winner, and
//                              runtime/render.ts:285 injects that markup into
//                              the funnel frame's [data-lg-banners], where the
//                              FUNNEL sheet paints it. Base is "2px solid
//                              #E85D26", so only the COLOUR moves — the same
//                              shape-preserving treatment applySuccessRole
//                              gives its "1px solid" borders.
// COHERENCE ONLY — written so a themed design carries ONE accent with no stale
// second opinion, NEVER counted as paint (exactly like validation.successColor
// in applySuccessRole):
//   • color.recommendedBorder          — zero consumers anywhere in src/.
//   • banner.recommendedCtaBackground  — its ONLY reader is banner-default/
//     styles.ts:80, whose scope `[data-banner-design="banner-default"]` no
//     element in src/ ever sets (measured: 0 producers). Reported, not fixed
//     here: that whole banner sub-sheet is scope-dead, and it is also fed the
//     UNRESOLVED base tokens (registry getBannerDesign returns
//     defaultFunnelDesign.banner), so no theme reaches it by any path.
// NOT WRITTEN, deliberately: banner.recommendedBg ("#FFFAF7") and
// banner.recommendedGlow ("rgba(232,93,38,.12)") are accent TINTS, not copies
// of the accent hex — moving them needs colour math, which is a different
// change from "the frozen copy follows its role". color.accentHover /
// color.accentLight are likewise different hexes, and their only readers are
// the admin colour picker's list (ui-section-studio.ts:1707/1714), not paint.
// `color.accent` itself keeps its existing write (setRoleToken, above): it
// still reaches the per-node `design_overrides.border_color:"accent"` enum
// (presets.ts:2382) and the `--lg-accent` custom property (styles.ts:497).
function applyAccentRole(design: EffectiveFunnelDesign, value: string): void {
  design.categoryLabel.color = value;
  design.header.logoAccentColor = value;
  design.banner.recommendedBorder = `2px solid ${value}`;
  design.banner.recommendedCtaBackground = value;
  design.color.recommendedBorder = value;
}

function shadowStepValue(
  design: FunnelDesign | EffectiveFunnelDesign,
  step: ThemeShadowStep,
): string {
  return step === "none" ? "none" : design.shadow[step];
}

// P6 THEME v2 (follow-on ruling) — bridge a resolved ThemeRecord's
// `extra_roles` onto FUNNEL_TOKEN_ROLES, HEX-FILTERED (HEX_COLOR_RE — the same
// anchored pattern validateTheme uses below for the inline palette): unlike
// the original 7 `roles` (validated at the theme-store.ts KV-shape-read
// layer), NO upstream validator exists yet for this NEW field (P6b's
// themes-handlers.ts / theme-store.ts widening is the write/read-time
// authoritative gate) — an invalid/non-hex value for any one role is simply
// DROPPED (that role falls through to the base design's own value via the
// normal recordPalette[role] === undefined path), never passed through raw.
// Absent `extra_roles` (every pre-P6 record) returns {} — byte-identical.
function recordExtraPalette(extra: ThemeRecordExtraRoles | undefined): Partial<Record<FunnelTokenRole, string>> {
  if (extra === undefined) return {};
  const out: Partial<Record<FunnelTokenRole, string>> = {};
  for (const key of THEME_RECORD_EXTRA_ROLE_KEYS) {
    const value = extra[key];
    if (typeof value === "string" && HEX_COLOR_RE.test(value)) {
      out[THEME_RECORD_EXTRA_ROLE_TO_TOKEN_ROLE[key]] = value;
    }
  }
  return out;
}

// P6 THEME v2 (follow-on ruling) — defense-in-depth validation for a
// ThemeRecord's `typography.display_size` (mirrors the base_px clamp's own
// "the write-time gate is authoritative; a hand-edited/corrupted blob could
// carry an out-of-range value here" discipline, applied to this NEW field
// which has no write-time validator yet). An invalid/absent value degrades to
// "m" (identity) — never reaches THEME_DISPLAY_SIZE_FACTORS with a key a real
// validated record could not have produced (which would otherwise read back
// `undefined` and corrupt every scaled font-size token to "NaNpx").
function safeRecordDisplaySize(value: unknown): ThemeDisplaySizeScale {
  return typeof value === "string" && (THEME_DISPLAY_SIZE_SCALES as readonly string[]).includes(value)
    ? (value as ThemeDisplaySizeScale)
    : "m";
}

// R2 F-1 — a resolved ThemeRecord's `controls.corners` as the §9.3 radius
// scale it names, or undefined when there is no record / no recognisable value
// (so resolveTokens's ?? chain falls through to the "soft" identity and the
// design stays byte-identical). Defense in depth mirrors safeRecordDisplaySize:
// controls.corners IS validated at write time (themes-handlers.ts
// validateThemeBody) and re-checked on the KV read (theme-store.ts
// isThemeRecordShape), but a value off the closed table must never reach
// THEME_RADIUS_SHIFTS — an undefined shift would make applyRadiusScale's
// `shift === 0` early-out miss and clamp every radius step to base.sm.
// R2 F-2 — a resolved ThemeRecord's `controls.button_size` as the primary
// pill's min-height, or undefined when there is no record / no recognisable
// value (so the token keeps its current value and the design stays
// byte-identical). Same defense-in-depth as safeRecordCorners: the value IS
// validated at write time (themes-handlers.ts validateThemeBody) and re-checked
// on the KV read (theme-store.ts isThemeRecordShape), but an off-table value
// must never reach the lookup and write `undefined` into a CSS declaration.
function safeRecordButtonSize(record: ThemeRecord | null): string | undefined {
  const size: unknown = record?.controls?.button_size;
  return typeof size === "string" && (THEME_RECORD_BUTTON_SIZES as readonly string[]).includes(size)
    ? THEME_RECORD_BUTTON_SIZE_TO_MIN_HEIGHT[size as ThemeRecordButtonSize]
    : undefined;
}

// Write the resolved button height step onto the design token styles.ts reads
// for `.lg-btn`/`.lg-continue`/`.lg-auto-advance` (min-height). undefined =
// no record / unrecognised value = leave the token untouched.
function applyButtonSizeStep(design: EffectiveFunnelDesign, minHeight: string | undefined): void {
  if (minHeight === undefined) return;
  design.primaryButton.minHeight = minHeight;
}

// R2 F-2 — the same pair for `controls.field_height` -> the base `.lg-input`
// min-height token (styles.ts). Same defense-in-depth + fail-soft contract.
function safeRecordFieldHeight(record: ThemeRecord | null): string | undefined {
  const height: unknown = record?.controls?.field_height;
  return typeof height === "string" && (THEME_RECORD_FIELD_HEIGHTS as readonly string[]).includes(height)
    ? THEME_RECORD_FIELD_HEIGHT_TO_MIN_HEIGHT[height as ThemeRecordFieldHeight]
    : undefined;
}

// R2 F-3 (gap 2): the floor ALONE painted 54/54/60 — see the
// FIELD_BOX_CHROME_PX rationale above. Writing the paired vertical padding puts
// the intrinsic box ON the chosen rung, so the floor IS the painted height and
// the three steps are visibly distinct. The HORIZONTAL padding is read back off
// the design's own token (never re-typed), so a design that changes its side
// padding keeps it. undefined = no record / unrecognised value = both tokens
// untouched, byte-identical.
function applyFieldHeightStep(design: EffectiveFunnelDesign, minHeight: string | undefined): void {
  if (minHeight === undefined) return;
  design.input.minHeight = minHeight;
  design.input.padding = withBlockPadding(design.input.padding, fieldPaddingBlockForPx(Number.parseFloat(minHeight)));
}

// Replace ONLY the block (top/bottom) component of a CSS `padding` shorthand,
// preserving the inline (left/right) component exactly as the design declared
// it. An unrecognised shorthand shape is left untouched (fail-soft: the floor
// still applies, the box just keeps the base padding) rather than emitting a
// malformed declaration.
function withBlockPadding(padding: string, block: string): string {
  const parts = padding.trim().split(/\s+/);
  if (parts.length === 1) return `${block} ${parts[0]}`;
  if (parts.length === 2) return `${block} ${parts[1]}`;
  if (parts.length === 3) return `${block} ${parts[1]} ${block}`;
  if (parts.length === 4) return `${block} ${parts[1]} ${block} ${parts[3]}`;
  return padding;
}

// R2 F-3 — the INLINE arms of the two size appliers. Same closed-vocabulary
// defense-in-depth as the record arms above (validateTheme is the authoritative
// write-time gate; a stored blob that bypassed it can never reach the lookup).
function inlineButtonMinHeight(theme: ThemeJson): string | undefined {
  const value: unknown = theme.button_defaults?.min_height;
  return typeof value === "string" && (THEME_BUTTON_MIN_HEIGHTS as readonly string[]).includes(value)
    ? BUTTON_MIN_HEIGHT_CSS[value as ThemeButtonMinHeight]
    : undefined;
}

function inlineFieldMinHeight(theme: ThemeJson): string | undefined {
  const value: unknown = theme.field_defaults?.min_height;
  return typeof value === "string" && (THEME_FIELD_MIN_HEIGHTS as readonly string[]).includes(value)
    ? FIELD_MIN_HEIGHT_CSS[value as ThemeFieldMinHeight]
    : undefined;
}

// R2 F-3 — the per-NODE size tier's inherit-default, on the inline path.
//
// `theme_controls` used to be published ONLY for a resolved record, so the
// instant an operator's rail edit forked theme_json the node tier's
// "absent axis inherits the theme default" chain (presets.ts resolveFieldSize)
// silently dropped from the preset's field_height back to
// DEFAULT_SIZE_THEME_CONTROLS — the SAME silent-loss shape one layer down.
// Publishing the inline axes in the same shape closes it: a node whose
// design_overrides.size omits the height key keeps inheriting the operator's
// chosen step after the fork. Absent inline axes ⇒ undefined ⇒ byte-identical
// to before (the node tier's own DEFAULT_SIZE_THEME_CONTROLS still applies).
function inlineThemeControls(theme: ThemeJson): ThemeRecordControls | undefined {
  const field: unknown = theme.field_defaults?.min_height;
  const button: unknown = theme.button_defaults?.min_height;
  const known =
    (typeof field === "string" && (THEME_FIELD_MIN_HEIGHTS as readonly string[]).includes(field)) ||
    (typeof button === "string" && (THEME_BUTTON_MIN_HEIGHTS as readonly string[]).includes(button));
  if (!known) return undefined;
  return {
    field_height: (typeof field === "string" && (THEME_FIELD_MIN_HEIGHTS as readonly string[]).includes(field)
      ? field
      : "medium") as ThemeRecordFieldHeight,
    button_size: (typeof button === "string" && (THEME_BUTTON_MIN_HEIGHTS as readonly string[]).includes(button)
      ? button
      : "m") as ThemeRecordButtonSize,
    corners: "rounded",
  };
}

function safeRecordCorners(record: ThemeRecord | null): ThemeRadiusScale | undefined {
  const corners: unknown = record?.controls?.corners;
  return typeof corners === "string" && (THEME_RECORD_CORNERS as readonly string[]).includes(corners)
    ? THEME_RECORD_CORNERS_TO_RADIUS_SCALE[corners as ThemeRecordCorners]
    : undefined;
}

// P6 THEME v2 (follow-on ruling) — defense-in-depth validation for a
// ThemeRecord's `button_style` triple (no write-time validator exists yet for
// this NEW field, P6b's job). Each axis independently degrades to "not
// authored" (undefined, so resolveTokens's buttonStyle merge falls through to
// BUTTON_STYLE_DEFAULTS) rather than ever stashing a raw, unrecognised value —
// readButtonStyle's own downstream enum re-check is a SECOND, unconditional
// layer on top of this one.
function safeRecordButtonStyle(raw: ThemeRecordButtonStyle | undefined): Partial<EffectiveButtonStyle> {
  if (raw === undefined) return {};
  const fill =
    typeof raw.fill === "string" && (THEME_BUTTON_STYLES as readonly string[]).includes(raw.fill)
      ? raw.fill
      : undefined;
  const layout =
    typeof raw.layout === "string" && (THEME_BUTTON_LAYOUTS as readonly string[]).includes(raw.layout)
      ? raw.layout
      : undefined;
  const selected =
    typeof raw.selected === "string" && (THEME_BUTTON_SELECTED_STYLES as readonly string[]).includes(raw.selected)
      ? raw.selected
      : undefined;
  return { fill, layout, selected };
}

// --- scale application helpers ----------------------------------------------

const SPACING_KEYS = ["xs", "sm", "md", "lg", "xl", "xxl"] as const;

function applySpacingScale(design: EffectiveFunnelDesign, scale: ThemeSpacingScale): void {
  const factor = THEME_SPACING_FACTORS[scale];
  if (factor === 1) return; // identity — base values stay byte-identical
  for (const key of SPACING_KEYS) {
    design.spacing[key] = scaleCssLength(design.spacing[key], factor);
  }
}

const RADIUS_ORDER = ["sm", "md", "lg", "xl"] as const;

// P6 fixes3 (E2) — map ONE component corner token through the same step shift.
// §9.3 defines radius as a LOOKUP over the base scale steps ("radius sharp =
// one step down the base radius scale"), so a component value that is not
// itself a scale step (questionCard 16px) is placed at its NEAREST step and
// moved from there. Anything outside the base scale's span is left alone: the
// 9999px pill is semantic "fully round" (the same carve-out design.radius.full
// already has) and a sub-`sm` hairline is not a corner-language value.
function shiftComponentRadius(base: Record<(typeof RADIUS_ORDER)[number], string>, value: string, shift: -1 | 1): string {
  const trimmed = value.trim();
  if (!/^[0-9]+(\.[0-9]+)?px$/.test(trimmed)) return value;
  const px = Number.parseFloat(trimmed);
  const steps = RADIUS_ORDER.map((k) => Number.parseFloat(base[k]));
  const lo = steps[0];
  const hi = steps[steps.length - 1];
  if (lo === undefined || hi === undefined || !Number.isFinite(px) || px < lo || px > hi) return value;
  let nearest = 0;
  for (let i = 1; i < steps.length; i++) {
    const s = steps[i];
    const best = steps[nearest];
    if (s !== undefined && best !== undefined && Math.abs(s - px) < Math.abs(best - px)) nearest = i;
  }
  const key = RADIUS_ORDER[Math.min(Math.max(nearest + shift, 0), RADIUS_ORDER.length - 1)];
  return key === undefined ? value : base[key];
}

function applyRadiusScale(design: EffectiveFunnelDesign, scale: ThemeRadiusScale): void {
  const shift = THEME_RADIUS_SHIFTS[scale];
  if (shift === 0) return;
  const base = { ...design.radius };
  for (let i = 0; i < RADIUS_ORDER.length; i++) {
    const to = RADIUS_ORDER[i];
    const from = RADIUS_ORDER[Math.min(Math.max(i + shift, 0), RADIUS_ORDER.length - 1)];
    if (to !== undefined && from !== undefined) design.radius[to] = base[from];
  }
  // design.radius.full (9999px pill) intentionally untouched.

  // P6 fixes3 (E2) — the scale must reach the PAINTED corners, not just the
  // emitted --lg-radius-* custom properties. MEASURED before this fix (two live
  // funnels, sharp vs round, 32 shared elements compared): the custom
  // properties DID move (sharp sm6/md6/lg10/xl14 vs round sm10/md14/lg20/xl20)
  // and ZERO painted elements differed — every corner a visitor actually sees
  // is painted from a COMPONENT token (.lg-question-card 16px, .lg-btn-answer /
  // .lg-continue 10px, disclosure modal 14px), none of which read the scale, so
  // an operator-authored radius did nothing. The owner's ruling is that the
  // theme IS the design language between components, so those component corners
  // follow the scale too. `soft` (shift 0) returned early above, so an unthemed
  // or soft funnel stays byte-identical — the golden CSS pins are untouched. An
  // explicit button_defaults/card_defaults radius STEP still wins: those are
  // applied after this and overwrite the same fields.
  design.content.cardRadius = shiftComponentRadius(base, design.content.cardRadius, shift);
  design.questionCard.borderRadius = shiftComponentRadius(base, design.questionCard.borderRadius, shift);
  design.primaryButton.borderRadius = shiftComponentRadius(base, design.primaryButton.borderRadius, shift);
  design.reassuranceBadge.borderRadius = shiftComponentRadius(base, design.reassuranceBadge.borderRadius, shift);
  design.secureFormBadge.borderRadius = shiftComponentRadius(base, design.secureFormBadge.borderRadius, shift);
  design.successState.borderRadius = shiftComponentRadius(base, design.successState.borderRadius, shift);
  design.cardPanel.radiusSm = shiftComponentRadius(base, design.cardPanel.radiusSm, shift);
  design.cardPanel.radiusMd = shiftComponentRadius(base, design.cardPanel.radiusMd, shift);
  design.cardPanel.radiusLg = shiftComponentRadius(base, design.cardPanel.radiusLg, shift);
  design.cardPanel.radiusXl = shiftComponentRadius(base, design.cardPanel.radiusXl, shift);
}

const SHADOW_ORDER = ["sm", "md", "lg", "xl"] as const;

// R2 P8 M2 — the shadow twin of shiftComponentRadius above, and for the SAME
// measured reason.
//
// MEASURED at HEAD (docs/leadgen/r2/evidence/p8/m2/repro-before.txt):
// `scales.shadow` none -> high moved the emitted --lg-shadow-* custom
// properties and left `.lg-question-card`, `.lg-btn-answer` and `.lg-continue`
// with IDENTICAL painted box-shadows. The buttons carry no box-shadow at all in
// the default look (nothing to scale — see the spec's own assertion), but the
// card DOES: its `0 8px 28px rgba(20,32,54,.10)` is a component literal that
// reads no scale step, so a "shadow scale" that could not touch the only
// shadowed surface a visitor sees.
//
// A component shadow is placed at its NEAREST base step and moved from there —
// the identical rule §9.3 already states for radius ("radius sharp = one step
// down the base radius scale"). Nearness is measured on the shadow's own
// elevation magnitude (|y-offset| + blur, the two lengths that read as height);
// a value outside the base scale's span, or one this cannot parse (gradients,
// `inset`, multi-shadow lists), is left alone rather than guessed at.
function shadowElevation(value: string): number | null {
  // The colour function goes FIRST — its own commas/decimals are not lengths.
  const stripped = value.replace(/(?:rgba?|hsla?)\([^)]*\)/g, " ").trim();
  // A comma survives only in a MULTI-shadow list; `inset` is a different shape.
  if (stripped === "" || stripped.includes(",") || /inset/i.test(stripped)) return null;
  const lengths = stripped.match(/-?\d*\.?\d+(?:px)?/g);
  if (lengths === null || lengths.length < 3) return null;
  const y = Number.parseFloat(lengths[1] as string);
  const blur = Number.parseFloat(lengths[2] as string);
  return Number.isFinite(y) && Number.isFinite(blur) ? Math.abs(y) + blur : null;
}

function shiftComponentShadow(
  base: Record<(typeof SHADOW_ORDER)[number], string>,
  value: string,
  shift: -1 | 1,
): string {
  const px = shadowElevation(value);
  if (px === null) return value;
  const steps = SHADOW_ORDER.map((k) => shadowElevation(base[k]));
  const lo = steps[0];
  const hi = steps[steps.length - 1];
  if (lo === null || lo === undefined || hi === null || hi === undefined || px < lo || px > hi) return value;
  let nearest = 0;
  for (let i = 1; i < steps.length; i++) {
    const s = steps[i];
    const best = steps[nearest];
    if (s !== null && s !== undefined && best !== null && best !== undefined && Math.abs(s - px) < Math.abs(best - px)) {
      nearest = i;
    }
  }
  const key = SHADOW_ORDER[Math.min(Math.max(nearest + shift, 0), SHADOW_ORDER.length - 1)];
  return key === undefined ? value : base[key];
}

function applyShadowScale(design: EffectiveFunnelDesign, scale: ThemeShadowScale): void {
  if (scale === "mid") return;
  if (scale === "none") {
    for (const key of SHADOW_ORDER) design.shadow[key] = "none";
    design.shadow.glow = "none";
    // …and the painted card, whose shadow is a component literal, not a step.
    design.questionCard.boxShadow = "none";
    return;
  }
  const shift = THEME_SHADOW_SHIFTS[scale];
  if (shift === 0) return; // unreachable ("mid" returned above) — narrows the step
  const base = { ...design.shadow };
  for (let i = 0; i < SHADOW_ORDER.length; i++) {
    const to = SHADOW_ORDER[i];
    const from = SHADOW_ORDER[Math.min(Math.max(i + shift, 0), SHADOW_ORDER.length - 1)];
    if (to !== undefined && from !== undefined) design.shadow[to] = base[from];
  }
  // glow is an accent effect outside the ordered scale — unchanged here.
  // The scale must reach the PAINTED shadow, not just the --lg-shadow-* custom
  // properties (the exact failure applyRadiusScale's own note records for
  // corners). An explicit card_defaults.shadow STEP still wins: it is applied
  // after this and overwrites this same field.
  design.questionCard.boxShadow = shiftComponentShadow(base, design.questionCard.boxShadow, shift);
}

// Display-font token slots (the serif/display family consumers in tokens.ts).
function applyDisplayFont(design: EffectiveFunnelDesign, stack: string): void {
  design.page.fontDisplay = stack;
  design.header.logoFontFamily = stack;
  design.headline.fontFamily = stack;
  design.rangeQuestion.valueFontFamily = stack;
  design.successState.headingFontFamily = stack;
}

// Body-font token slots.
function applyBodyFont(design: EffectiveFunnelDesign, stack: string): void {
  design.page.fontFamily = stack;
  design.primaryButton.fontFamily = stack;
}

// Multiply every *FontSize* token (px/rem) across the design — the s/m/l size
// scale (§9.3). Non-length values (inherit/composites) pass through.
function scaleFontSizes(node: Record<string, unknown>, factor: number): void {
  for (const [key, value] of Object.entries(node)) {
    if (isRecord(value)) {
      scaleFontSizes(value, factor);
    } else if (typeof value === "string" && /fontsize/i.test(key)) {
      node[key] = scaleCssLength(value, factor);
    }
  }
}

// P6 (deliverable 2): scale ONLY the DISPLAY font-size tokens
// (DISPLAY_FONTSIZE_PATHS — the *FontSize* siblings of the display-family
// slots) — the display/headline ramp, distinct from the uniform `size` scale
// above which touches body tokens too. A missing/non-length token passes
// through unchanged (never a thrown error from a pure resolver).
function scaleDisplayFontSizes(design: EffectiveFunnelDesign, factor: number): void {
  for (const [group, key] of DISPLAY_FONTSIZE_PATHS) {
    const groupObj = (design as unknown as Record<string, unknown>)[group];
    if (isRecord(groupObj) && typeof groupObj[key] === "string") {
      groupObj[key] = scaleCssLength(groupObj[key] as string, factor);
    }
  }
}

function scaleCssLength(value: string, factor: number): string {
  const match = value.trim().match(/^(-?\d*\.?\d+)(px|rem|em)$/);
  const num = match?.[1];
  const unit = match?.[2];
  if (num === undefined || unit === undefined) return value;
  const scaled = Math.round(Number(num) * factor * 1000) / 1000;
  return `${scaled}${unit}`;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// §9.3 contrast lint — WCAG AA relative-luminance check for the preflight
// contrast rows (14 §14.1: button-bg/button-text + text/page role pairs →
// warnings). PURE + additive: nothing else in this module consumes it.
//
// contrastRatioAA(fg, bg) → { ratio, passes } for two #hex colours, or null
// when either value is not a parseable hex literal (role-resolved tokens are
// normally hex, but a design may carry gradients/rgb() composites — an
// unparseable pair is UNLINTABLE, never a fake failure). The AA threshold is
// the normal-text 4.5:1 (both lint pairs are text-on-surface pairs).
// ---------------------------------------------------------------------------

export const WCAG_AA_MIN_CONTRAST = 4.5;

// #rgb / #rgba / #rrggbb / #rrggbbaa → [r, g, b] (alpha ignored — the lint
// compares base colours), or null when the value is not a hex literal.
function parseHexColor(value: unknown): [number, number, number] | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!HEX_COLOR_RE.test(raw)) return null;
  let hex = raw.slice(1);
  if (hex.length === 4 || hex.length === 8) {
    hex = hex.slice(0, hex.length === 4 ? 3 : 6); // strip alpha
  }
  if (hex.length === 3) {
    hex = hex
      .split("")
      .map((c) => c + c)
      .join("");
  }
  const n = Number.parseInt(hex, 16);
  if (Number.isNaN(n)) return null;
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

// WCAG 2.x relative luminance of an sRGB channel byte.
function channelLuminance(byte: number): number {
  const c = byte / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export interface ContrastVerdict {
  ratio: number; // e.g. 4.52 (rounded to 2 decimals)
  passes: boolean; // ratio >= WCAG_AA_MIN_CONTRAST
}

export function contrastRatioAA(fg: string, bg: string): ContrastVerdict | null {
  const f = parseHexColor(fg);
  const b = parseHexColor(bg);
  if (f === null || b === null) return null;
  const lum = (rgb: [number, number, number]): number =>
    0.2126 * channelLuminance(rgb[0]) +
    0.7152 * channelLuminance(rgb[1]) +
    0.0722 * channelLuminance(rgb[2]);
  const lf = lum(f);
  const lb = lum(b);
  const ratio = (Math.max(lf, lb) + 0.05) / (Math.min(lf, lb) + 0.05);
  const rounded = Math.round(ratio * 100) / 100;
  return { ratio: rounded, passes: rounded >= WCAG_AA_MIN_CONTRAST };
}

// ---------------------------------------------------------------------------
// validateTheme — server-side gate for PUT /funnels/:id/theme (§4.8). Unknown
// keys/roles rejected; enums closed; custom #hex palette values are ALLOWED
// but flagged (legacy-literal rule, §9.3/§9.4). `theme` is non-null iff no
// error-severity problem was found (warnings alone keep the theme). v3.1
// §10.1: a `{theme_id}` reference is ALSO accepted — structurally only (a
// non-empty string, alone); the referenced id's EXISTENCE is a KV lookup this
// pure validator cannot perform (the write-path handler checks it, §10.1).
//
// `theme` KEEPS the `ThemeJson | null` declared shape (not widened to
// `| ThemeIdRef`) so every EXISTING `let x: ThemeJson | null = validateTheme(
// …).theme` call site (serve.ts resolveFrameComposition, the quotes-handlers
// v2.5-problems scan, …) keeps compiling untouched — those files are outside
// this slice. A theme_id-ref value is returned as an (intentionally) widened
// object: `isThemeIdRef()` is the correct narrowing tool for any caller that
// needs to branch on it (resolveTokens does this internally); a caller that
// does NOT check it and reads legacy fields (`.palette` etc.) simply sees
// `undefined` for all of them, since a theme_id-ref object never has those
// keys — a safe degrade, never a runtime crash.
// ---------------------------------------------------------------------------

export interface ThemeValidation {
  theme: ThemeJson | null;
  problems: Problem[];
}

const THEME_TOP_KEYS: ReadonlySet<string> = new Set([
  "version",
  "palette",
  "typography",
  "scales",
  "button_defaults",
  "card_defaults",
  // R2 F-3: the inline field box (see ThemeFieldDefaults). Without this key the
  // preset->inline fork had nowhere to put the operator's Field height and
  // discarded it.
  "field_defaults",
]);

const HEX_COLOR_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

// R2 P8 F4 — the component-default VOCABULARIES, hoisted out of validateTheme's
// two call sites below so they are ONE named, exhaustive universe instead of two
// inline literals. `satisfies Record<keyof …, DefaultsFieldKind>` makes them
// compile-time exhaustive over their own interfaces (the ROLE_TO_BASE_TOKEN
// idiom at the top of this file): a NEW key on ThemeButtonDefaults /
// ThemeCardDefaults is a compile error until it is listed here — which is what
// lets leadgen-p8-f4-component-scope.test.ts sweep "every component-default key"
// over a universe that cannot silently grow, rather than a hand-copied list.
export const THEME_BUTTON_DEFAULT_FIELDS = {
  background_role: "role",
  text_role: "role",
  radius: "radius_step",
  min_height: "min_height",
  casing: "casing",
  // P6 (deliverable 3): the button-style vocabulary — each a closed enum.
  fill: "btn_fill",
  layout: "btn_layout",
  selected: "btn_selected",
} as const satisfies Record<keyof ThemeButtonDefaults, DefaultsFieldKind>;

export const THEME_CARD_DEFAULT_FIELDS = {
  background_role: "role",
  border_role: "role",
  radius: "radius_step",
  shadow: "shadow_step",
} as const satisfies Record<keyof ThemeCardDefaults, DefaultsFieldKind>;

// P8-6 Q7 (M5 jargon sweep, "close the raw-key-dump class for good"): every
// closed vocabulary below is picked from a LABELLED control in the Themes
// manager (quotes-tabs/themes.ts) — the abbreviated/underscored STORAGE
// value ("sm", "space_grotesk", "wash") is never what the operator reads on
// screen. Converged VERBATIM with that file's own label maps (kept as local
// data here for the same reason FUNNEL_TOKEN_ROLE_LABELS above is local —
// this module is PURE and several admin files import validateTheme FROM it,
// so importing a label table back from admin would invert the boundary).
// THEME_SPACING_SCALES / THEME_RADIUS_SCALES / THEME_SHADOW_SCALES and
// THEME_FIELD_MIN_HEIGHTS are DELIBERATELY left alone below — their admin
// labels differ from the stored value by capitalisation only
// (compact -> "Compact", small -> "Small"), which already reads as plain
// English in a sentence, not jargon.
const THEME_FONT_LABELS: Readonly<Record<ThemeFontId, string>> = {
  literata: "Literata",
  sora: "Sora",
  system: "System",
  poppins: "Poppins",
  space_grotesk: "Space Grotesk",
  fraunces: "Fraunces",
  playfair: "Playfair Display",
  manrope: "Manrope",
  dm_sans: "DM Sans",
  work_sans: "Work Sans",
  lexend: "Lexend",
};
// Shared by typography.size (THEME_SIZE_SCALES) and the button/field
// min_height defaults (THEME_BUTTON_MIN_HEIGHTS) — both s/m/l.
const THEME_HEIGHT_LABELS: Readonly<Record<string, string>> = { s: "Small", m: "Medium", l: "Large" };
const THEME_DISPLAY_SIZE_LABELS: Readonly<Record<string, string>> = {
  m: "Base",
  l: "Large",
  xl: "X-Large",
  xxl: "XX-Large",
};
const THEME_RADIUS_STEP_LABELS: Readonly<Record<string, string>> = {
  sm: "Small",
  md: "Medium",
  lg: "Large",
  xl: "Extra large",
  full: "Fully round",
};
const THEME_SHADOW_STEP_LABELS: Readonly<Record<string, string>> = {
  none: "None",
  sm: "Small",
  md: "Medium",
  lg: "Large",
  xl: "Extra large",
};
const THEME_BUTTON_STYLE_LABELS: Readonly<Record<string, string>> = {
  fill: "Solid (default)",
  outline: "Outline",
  soft: "Soft pill + shadow",
};
const THEME_BUTTON_LAYOUT_LABELS: Readonly<Record<string, string>> = {
  grid: "Grid (default)",
  list: "Single-column list",
  card: "Full-width cards",
};
const THEME_BUTTON_SELECTED_LABELS: Readonly<Record<string, string>> = {
  wash: "Soft wash (default)",
  mark: "Bigger + check badge",
};
const THEME_BUTTON_CASING_LABELS: Readonly<Record<string, string>> = { none: "As written", upper: "UPPERCASE" };

function labelList(values: readonly string[], labels: Readonly<Record<string, string>>): string {
  return values.map((v) => labels[v] ?? v).join(", ");
}

export function validateTheme(raw: unknown): ThemeValidation {
  const problems: Problem[] = [];
  const push = (severity: ProblemSeverity, path: string, message: string): void => {
    problems.push({ path, scope: "theme", severity, message });
  };

  if (!isRecord(raw)) {
    push("error", "theme", "Theme settings must be a JSON object.");
    return { theme: null, problems };
  }

  // v3.1 §10.1: a {theme_id} REFERENCE is a distinct, mutually-exclusive
  // shape from the legacy inline theme below — checked FIRST so a theme_id
  // value never falls through to the legacy per-key checks (which would
  // otherwise reject `theme_id` as an unrecognised top-level key).
  if ("theme_id" in raw) {
    if (!isThemeIdRef(raw)) {
      push(
        "error",
        "theme.theme_id",
        Object.keys(raw).length > 1
          ? "theme_id can't be combined with other theme settings."
          : "theme_id must be a non-empty string.",
      );
      return { theme: null, problems };
    }
    // Intentional widening cast — see the ThemeValidation doc comment above:
    // `theme` stays declared as `ThemeJson | null` for existing-caller
    // compatibility; a theme_id-ref value is a DIFFERENT (isThemeIdRef-
    // narrowable) shape carried through the same slot.
    return { theme: raw as unknown as ThemeJson, problems };
  }

  for (const key of Object.keys(raw)) {
    if (!THEME_TOP_KEYS.has(key)) {
      push("error", `theme.${key}`, `'${key}' isn't a recognised theme setting.`);
    }
  }

  if (raw["version"] !== undefined && raw["version"] !== 1) {
    push("error", "theme.version", "Theme settings version must be 1.");
  }

  // --- palette ---------------------------------------------------------------
  const palette = raw["palette"];
  if (palette !== undefined) {
    if (!isRecord(palette)) {
      push("error", "theme.palette", "The theme palette must map colour roles to colours.");
    } else {
      for (const [key, value] of Object.entries(palette)) {
        const path = `theme.palette.${key}`;
        if (!isFunnelTokenRole(key)) {
          push(
            "error",
            path,
            `'${key}' isn't a theme colour role. Roles are: ${funnelTokenRoleLabelList()}.`,
          );
          continue;
        }
        if (typeof value !== "string") {
          push("error", path, "Each palette colour must be a colour role or a hex colour.");
          continue;
        }
        if (value.startsWith("#")) {
          if (!HEX_COLOR_RE.test(value)) {
            push("error", path, "That hex colour isn't valid — use a form like #1B3A5C.");
          } else {
            // §9.3 Advanced token administration copy — allowed, flagged.
            push("warning", path, "Custom colors skip the design system — check contrast.");
          }
        } else if (!isFunnelTokenRole(value)) {
          push(
            "error",
            path,
            `Palette colours must be a theme colour role (${funnelTokenRoleLabelList()}) or a hex colour.`,
          );
        }
      }
    }
  }

  // --- typography -------------------------------------------------------------
  const typography = raw["typography"];
  if (typography !== undefined) {
    if (!isRecord(typography)) {
      push("error", "theme.typography", "Typography settings must be a group of settings.");
    } else {
      for (const key of Object.keys(typography)) {
        if (key !== "display" && key !== "body" && key !== "size" && key !== "display_size") {
          push("error", `theme.typography.${key}`, `'${key}' isn't a recognised typography setting.`);
        }
      }
      for (const key of ["display", "body"] as const) {
        const value = typography[key];
        if (value !== undefined && !(THEME_FONT_IDS as readonly string[]).includes(value as string)) {
          push(
            "error",
            `theme.typography.${key}`,
            `The ${key} font must be one of the curated fonts: ${labelList(THEME_FONT_IDS, THEME_FONT_LABELS)}.`,
          );
        }
      }
      const size = typography["size"];
      if (size !== undefined && !(THEME_SIZE_SCALES as readonly string[]).includes(size as string)) {
        push(
          "error",
          "theme.typography.size",
          `The text size scale must be one of: ${labelList(THEME_SIZE_SCALES, THEME_HEIGHT_LABELS)}.`,
        );
      }
      // P6 (deliverable 2): the display headline ramp is a closed enum.
      const displaySize = typography["display_size"];
      if (
        displaySize !== undefined &&
        !(THEME_DISPLAY_SIZE_SCALES as readonly string[]).includes(displaySize as string)
      ) {
        push(
          "error",
          "theme.typography.display_size",
          `The display size scale must be one of: ${labelList(THEME_DISPLAY_SIZE_SCALES, THEME_DISPLAY_SIZE_LABELS)}.`,
        );
      }
    }
  }

  // --- scales ------------------------------------------------------------------
  const scales = raw["scales"];
  if (scales !== undefined) {
    if (!isRecord(scales)) {
      push("error", "theme.scales", "Scale settings must be a group of settings.");
    } else {
      const SCALE_SPECS: Array<[key: string, values: readonly string[], label: string]> = [
        ["spacing", THEME_SPACING_SCALES, "spacing scale"],
        ["radius", THEME_RADIUS_SCALES, "corner radius scale"],
        ["shadow", THEME_SHADOW_SCALES, "shadow level"],
      ];
      const known = new Set(SCALE_SPECS.map(([k]) => k));
      for (const key of Object.keys(scales)) {
        if (!known.has(key)) {
          push("error", `theme.scales.${key}`, `'${key}' isn't a recognised scale setting.`);
        }
      }
      for (const [key, values, label] of SCALE_SPECS) {
        const value = scales[key];
        if (value !== undefined && !values.includes(value as string)) {
          push("error", `theme.scales.${key}`, `The ${label} must be one of: ${values.join(", ")}.`);
        }
      }
    }
  }

  // --- button_defaults / card_defaults ------------------------------------------
  validateComponentDefaults(
    raw["button_defaults"],
    "theme.button_defaults",
    "button",
    push,
    THEME_BUTTON_DEFAULT_FIELDS,
  );
  validateComponentDefaults(raw["card_defaults"], "theme.card_defaults", "card", push, THEME_CARD_DEFAULT_FIELDS);
  // R2 F-3 — the field box, validated through the SAME helper (unknown key ->
  // error, off-vocabulary value -> error) so the new axis can never be looser
  // than its two siblings.
  validateComponentDefaults(raw["field_defaults"], "theme.field_defaults", "field", push, {
    min_height: "field_min_height",
  });

  const hasErrors = problems.some((p) => p.severity === "error");
  return { theme: hasErrors ? null : (raw as ThemeJson), problems };
}

type DefaultsFieldKind =
  | "role"
  | "radius_step"
  | "shadow_step"
  | "min_height"
  | "field_min_height"
  | "casing"
  | "btn_fill"
  | "btn_layout"
  | "btn_selected";

function validateComponentDefaults(
  raw: unknown,
  basePath: string,
  label: string,
  push: (severity: ProblemSeverity, path: string, message: string) => void,
  fields: Record<string, DefaultsFieldKind>,
): void {
  if (raw === undefined) return;
  if (!isRecord(raw)) {
    push("error", basePath, `The ${label} defaults must be a group of settings.`);
    return;
  }
  for (const key of Object.keys(raw)) {
    if (!(key in fields)) {
      push("error", `${basePath}.${key}`, `'${key}' isn't a recognised ${label} default.`);
    }
  }
  for (const [key, kind] of Object.entries(fields)) {
    const value = raw[key];
    if (value === undefined) continue;
    const path = `${basePath}.${key}`;
    const human = key.replace(/_/g, " ");
    if (kind === "role") {
      if (!isFunnelTokenRole(value)) {
        push(
          "error",
          path,
          `The ${label} ${human} must be a theme colour role: ${funnelTokenRoleLabelList()}.`,
        );
      }
    } else if (kind === "radius_step") {
      if (!(THEME_RADIUS_STEPS as readonly string[]).includes(value as string)) {
        push("error", path, `The ${label} ${human} must be one of: ${labelList(THEME_RADIUS_STEPS, THEME_RADIUS_STEP_LABELS)}.`);
      }
    } else if (kind === "shadow_step") {
      if (!(THEME_SHADOW_STEPS as readonly string[]).includes(value as string)) {
        push("error", path, `The ${label} ${human} must be one of: ${labelList(THEME_SHADOW_STEPS, THEME_SHADOW_STEP_LABELS)}.`);
      }
    } else if (kind === "min_height") {
      if (!(THEME_BUTTON_MIN_HEIGHTS as readonly string[]).includes(value as string)) {
        push("error", path, `The ${label} ${human} must be one of: ${labelList(THEME_BUTTON_MIN_HEIGHTS, THEME_HEIGHT_LABELS)}.`);
      }
    } else if (kind === "field_min_height") {
      if (!(THEME_FIELD_MIN_HEIGHTS as readonly string[]).includes(value as string)) {
        push("error", path, `The ${label} ${human} must be one of: ${THEME_FIELD_MIN_HEIGHTS.join(", ")}.`);
      }
    } else if (kind === "btn_fill") {
      if (!(THEME_BUTTON_STYLES as readonly string[]).includes(value as string)) {
        push("error", path, `The ${label} ${human} must be one of: ${labelList(THEME_BUTTON_STYLES, THEME_BUTTON_STYLE_LABELS)}.`);
      }
    } else if (kind === "btn_layout") {
      if (!(THEME_BUTTON_LAYOUTS as readonly string[]).includes(value as string)) {
        push("error", path, `The ${label} ${human} must be one of: ${labelList(THEME_BUTTON_LAYOUTS, THEME_BUTTON_LAYOUT_LABELS)}.`);
      }
    } else if (kind === "btn_selected") {
      if (!(THEME_BUTTON_SELECTED_STYLES as readonly string[]).includes(value as string)) {
        push("error", path, `The ${label} ${human} must be one of: ${labelList(THEME_BUTTON_SELECTED_STYLES, THEME_BUTTON_SELECTED_LABELS)}.`);
      }
    } else {
      if (!(THEME_BUTTON_CASINGS as readonly string[]).includes(value as string)) {
        push("error", path, `The ${label} ${human} must be one of: ${labelList(THEME_BUTTON_CASINGS, THEME_BUTTON_CASING_LABELS)}.`);
      }
    }
  }
}
