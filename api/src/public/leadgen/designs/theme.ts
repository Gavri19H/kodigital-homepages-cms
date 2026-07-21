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
// siblings of applyDisplayFont's family slots — headline / logo / range value
// / success heading). Body/paragraph font-size tokens are deliberately absent
// so a display-XXL headline never enlarges body copy.
const DISPLAY_FONTSIZE_PATHS: ReadonlyArray<readonly [group: string, key: string]> = [
  ["headline", "fontSizeDesktop"],
  ["headline", "fontSizeMobile"],
  ["header", "logoFontSize"],
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

export const THEME_BUTTON_MIN_HEIGHTS = ["m", "l"] as const;
export type ThemeButtonMinHeight = (typeof THEME_BUTTON_MIN_HEIGHTS)[number];

// m = the measured base primaryButton.minHeight; l = the taller variant.
const BUTTON_MIN_HEIGHT_CSS: Record<ThemeButtonMinHeight, string> = {
  m: "52px",
  l: "60px",
};

export const THEME_BUTTON_CASINGS = ["none", "upper"] as const;
export type ThemeButtonCasing = (typeof THEME_BUTTON_CASINGS)[number];

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

export const THEME_BUTTON_LAYOUTS = ["grid", "list"] as const;
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
  layout?: ThemeButtonLayout; // grid (default) | list (Image 38)
  selected?: ThemeButtonSelectedStyle; // wash (default) | mark (Image 40)
}

export interface ThemeCardDefaults {
  background_role?: FunnelTokenRole;
  border_role?: FunnelTokenRole;
  radius?: ThemeRadiusStep;
  shadow?: ThemeShadowStep;
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

// §10.4 "Buttons & inputs — the shared size language" — the record fields the
// §7 field-size resolver (a PARALLEL slice, content-schema/registry/presets)
// reads as the funnel-theme-default layer of its own size resolution; this
// module only resolves + exposes them (never interprets e.g. `field_height`
// into pixels itself — that math belongs to the size resolver).
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
    } else {
      roles[role] = baseTokenForRole(baseDesign, role);
    }
  }

  // --- scales (§9.3) --------------------------------------------------------
  const spacingScale: ThemeSpacingScale = theme.scales?.spacing ?? "regular";
  const radiusScale: ThemeRadiusScale = theme.scales?.radius ?? "soft";
  const shadowScale: ThemeShadowScale = theme.scales?.shadow ?? "mid";
  applySpacingScale(design, spacingScale);
  applyRadiusScale(design, radiusScale);
  applyShadowScale(design, shadowScale);

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
  const button_defaults: EffectiveButtonDefaults = {
    background: design.primaryButton.background,
    color: design.primaryButton.color,
    border_radius: design.primaryButton.borderRadius,
    min_height: design.primaryButton.minHeight,
    text_transform: bd.casing === "upper" ? "uppercase" : "none",
  };

  // --- card defaults (§9.3) --------------------------------------------------
  const cd = theme.card_defaults ?? {};
  if (cd.background_role !== undefined) design.color.card = roles[cd.background_role];
  if (cd.radius !== undefined) design.content.cardRadius = design.radius[cd.radius];
  if (cd.border_role !== undefined) design.cardPanel.border = `1px solid ${roles[cd.border_role]}`;
  const card_defaults: EffectiveCardDefaults = {
    background: design.color.card,
    border_color: cd.border_role !== undefined ? roles[cd.border_role] : design.color.border,
    border_radius: design.content.cardRadius,
    shadow: cd.shadow !== undefined ? shadowStepValue(design, cd.shadow) : design.shadow.md,
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

function shadowStepValue(design: EffectiveFunnelDesign, step: ThemeShadowStep): string {
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
}

const SHADOW_ORDER = ["sm", "md", "lg", "xl"] as const;

function applyShadowScale(design: EffectiveFunnelDesign, scale: ThemeShadowScale): void {
  if (scale === "mid") return;
  if (scale === "none") {
    for (const key of SHADOW_ORDER) design.shadow[key] = "none";
    design.shadow.glow = "none";
    return;
  }
  const shift = THEME_SHADOW_SHIFTS[scale];
  const base = { ...design.shadow };
  for (let i = 0; i < SHADOW_ORDER.length; i++) {
    const to = SHADOW_ORDER[i];
    const from = SHADOW_ORDER[Math.min(Math.max(i + shift, 0), SHADOW_ORDER.length - 1)];
    if (to !== undefined && from !== undefined) design.shadow[to] = base[from];
  }
  // glow is an accent effect outside the ordered scale — unchanged here.
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
]);

const HEX_COLOR_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

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
            `'${key}' isn't a theme colour role. Roles are: ${FUNNEL_TOKEN_ROLES.join(", ")}.`,
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
            `Palette colours must be a theme colour role (${FUNNEL_TOKEN_ROLES.join(", ")}) or a hex colour.`,
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
            `The ${key} font must be one of the curated fonts: ${THEME_FONT_IDS.join(", ")}.`,
          );
        }
      }
      const size = typography["size"];
      if (size !== undefined && !(THEME_SIZE_SCALES as readonly string[]).includes(size as string)) {
        push("error", "theme.typography.size", `The text size scale must be one of: ${THEME_SIZE_SCALES.join(", ")}.`);
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
          `The display size scale must be one of: ${THEME_DISPLAY_SIZE_SCALES.join(", ")}.`,
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
  validateComponentDefaults(raw["button_defaults"], "theme.button_defaults", "button", push, {
    background_role: "role",
    text_role: "role",
    radius: "radius_step",
    min_height: "min_height",
    casing: "casing",
    // P6 (deliverable 3): the button-style vocabulary — each a closed enum.
    fill: "btn_fill",
    layout: "btn_layout",
    selected: "btn_selected",
  });
  validateComponentDefaults(raw["card_defaults"], "theme.card_defaults", "card", push, {
    background_role: "role",
    border_role: "role",
    radius: "radius_step",
    shadow: "shadow_step",
  });

  const hasErrors = problems.some((p) => p.severity === "error");
  return { theme: hasErrors ? null : (raw as ThemeJson), problems };
}

type DefaultsFieldKind =
  | "role"
  | "radius_step"
  | "shadow_step"
  | "min_height"
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
          `The ${label} ${human} must be a theme colour role: ${FUNNEL_TOKEN_ROLES.join(", ")}.`,
        );
      }
    } else if (kind === "radius_step") {
      if (!(THEME_RADIUS_STEPS as readonly string[]).includes(value as string)) {
        push("error", path, `The ${label} ${human} must be one of: ${THEME_RADIUS_STEPS.join(", ")}.`);
      }
    } else if (kind === "shadow_step") {
      if (!(THEME_SHADOW_STEPS as readonly string[]).includes(value as string)) {
        push("error", path, `The ${label} ${human} must be one of: ${THEME_SHADOW_STEPS.join(", ")}.`);
      }
    } else if (kind === "min_height") {
      if (!(THEME_BUTTON_MIN_HEIGHTS as readonly string[]).includes(value as string)) {
        push("error", path, `The ${label} ${human} must be one of: ${THEME_BUTTON_MIN_HEIGHTS.join(", ")}.`);
      }
    } else if (kind === "btn_fill") {
      if (!(THEME_BUTTON_STYLES as readonly string[]).includes(value as string)) {
        push("error", path, `The ${label} ${human} must be one of: ${THEME_BUTTON_STYLES.join(", ")}.`);
      }
    } else if (kind === "btn_layout") {
      if (!(THEME_BUTTON_LAYOUTS as readonly string[]).includes(value as string)) {
        push("error", path, `The ${label} ${human} must be one of: ${THEME_BUTTON_LAYOUTS.join(", ")}.`);
      }
    } else if (kind === "btn_selected") {
      if (!(THEME_BUTTON_SELECTED_STYLES as readonly string[]).includes(value as string)) {
        push("error", path, `The ${label} ${human} must be one of: ${THEME_BUTTON_SELECTED_STYLES.join(", ")}.`);
      }
    } else {
      if (!(THEME_BUTTON_CASINGS as readonly string[]).includes(value as string)) {
        push("error", path, `The ${label} ${human} must be one of: ${THEME_BUTTON_CASINGS.join(", ")}.`);
      }
    }
  }
}
