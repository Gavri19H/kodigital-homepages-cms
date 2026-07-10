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

// §9.3 typography — curated list only (the fonts already shipped by designs).
export const THEME_FONT_IDS = ["literata", "sora", "system"] as const;
export type ThemeFontId = (typeof THEME_FONT_IDS)[number];

export const THEME_FONT_STACKS: Record<ThemeFontId, string> = {
  literata: "'Literata',Georgia,serif",
  sora: "'Sora',system-ui,Arial,sans-serif",
  system: "system-ui,-apple-system,'Segoe UI',Arial,sans-serif",
};

export const THEME_SIZE_SCALES = ["s", "m", "l"] as const;
export type ThemeSizeScale = (typeof THEME_SIZE_SCALES)[number];

// font-size multiplier over every *FontSize* token; `m` is the identity.
export const THEME_SIZE_FACTORS: Record<ThemeSizeScale, number> = {
  s: 0.9,
  m: 1,
  l: 1.1,
};

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
// theme_json contract (§3.2 storage, §9.3 editor groups). All keys optional —
// absent keys inherit from the base design (`funnel_design_id`).
// ---------------------------------------------------------------------------

export interface ThemeTypography {
  display?: ThemeFontId;
  body?: ThemeFontId;
  size?: ThemeSizeScale;
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
// EffectiveTokens — what resolveTokens returns. `design` keeps the FunnelDesign
// STRUCTURE (so funnelChromeCss + the presets consume it unchanged); `roles`
// is the resolved role → value table (§4.8 GET theme `effective_tokens`, the
// editor swatch grid).
// ---------------------------------------------------------------------------

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
  theme_json?: ThemeJson | null,
  frameOverridesTheme?: VariantThemeOverrides | null,
): EffectiveTokens {
  const theme: ThemeJson = theme_json ?? {};
  const overrides: VariantThemeOverrides = frameOverridesTheme ?? {};

  // Fresh, widened working copy (plain JSON data by construction).
  const design = cloneJson(baseDesign) as EffectiveFunnelDesign;

  // --- palette (roles), layers 3 → 2 → 1 -----------------------------------
  const roles = {} as Record<FunnelTokenRole, string>;
  for (const role of FUNNEL_TOKEN_ROLES) {
    const layered = pickPaletteValue(overrides.palette, role) ?? pickPaletteValue(theme.palette, role);
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
  const displayId = theme.typography?.display;
  const bodyId = theme.typography?.body;
  if (displayId !== undefined) applyDisplayFont(design, THEME_FONT_STACKS[displayId]);
  if (bodyId !== undefined) applyBodyFont(design, THEME_FONT_STACKS[bodyId]);
  if (THEME_SIZE_FACTORS[sizeScale] !== 1) {
    scaleFontSizes(design as unknown as Record<string, unknown>, THEME_SIZE_FACTORS[sizeScale]);
  }

  // --- button defaults (§9.3) — applied AFTER palette + scales so a radius
  // step reads the effective radius scale and role picks read resolved roles.
  const bd = theme.button_defaults ?? {};
  if (bd.background_role !== undefined) design.primaryButton.background = roles[bd.background_role];
  if (bd.text_role !== undefined) design.primaryButton.color = roles[bd.text_role];
  if (bd.radius !== undefined) design.primaryButton.borderRadius = design.radius[bd.radius];
  if (bd.min_height !== undefined) design.primaryButton.minHeight = BUTTON_MIN_HEIGHT_CSS[bd.min_height];
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

  return {
    design,
    roles,
    typography: {
      display: displayId !== undefined ? THEME_FONT_STACKS[displayId] : design.page.fontDisplay,
      body: bodyId !== undefined ? THEME_FONT_STACKS[bodyId] : design.page.fontFamily,
      size: sizeScale,
    },
    scales: { spacing: spacingScale, radius: radiusScale, shadow: shadowScale },
    button_defaults,
    card_defaults,
  };
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
// error-severity problem was found (warnings alone keep the theme).
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
        if (key !== "display" && key !== "body" && key !== "size") {
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

type DefaultsFieldKind = "role" | "radius_step" | "shadow_step" | "min_height" | "casing";

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
    } else {
      if (!(THEME_BUTTON_CASINGS as readonly string[]).includes(value as string)) {
        push("error", path, `The ${label} ${human} must be one of: ${THEME_BUTTON_CASINGS.join(", ")}.`);
      }
    }
  }
}
