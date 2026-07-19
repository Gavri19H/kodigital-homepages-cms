// LeadGen Section `content_json` — the TypeScript CONTRACT every consumer
// shares (contract 05 §12.3 / §13.1 / §14.8). A Section body is an ordered
// list of component nodes drawn from the component CAPABILITY catalog
// (components/registry.ts); each node carries its authorable props, an
// optional inline dependency (`conditional`), a design-preset selection, and
// a curated (never free-CSS) `design_overrides` bag.
//
// `validateSectionContent` is I/O-free and returns FIELD-PATH-keyed typed
// errors, mirroring the Offer-validator idiom (leadgen/validation.ts). It
// performs exactly ONE normalization on its input — pruning orphan
// MultiQuestionGrid shared choices beyond the pill bound (Round-4 R4-34) so a
// legacy/corrupted grid stays saveable — and is otherwise non-mutating. The
// server runs it on save (client validation is never trusted, §12.3); the
// same shape is what the runtime engine + preview consume. Referential checks
// against Offers (answer→payload mapping) are a Stage-B/handler concern —
// this validator is content-internal only.

import { FUNNEL_TOKEN_ROLES } from "../designs/theme";
import { COMPONENT_CATALOG } from "./registry";
import type { ComponentType, ComponentScope } from "./registry";
import type { LeadgenConditionOp, LeadgenContinueMode } from "../../../admin/leadgen/db-types";
// P1b (register PC-11): the leading-icon enum's name vocabulary is sourced
// from the build-time-vendored Tabler (MIT) icon map — see the
// LEADGEN_FIELD_LEADING_ICONS comment below.
import { LEADGEN_ICON_NAMES } from "./icons.generated";

// ---------------------------------------------------------------------------
// Node + content types
// ---------------------------------------------------------------------------

// The normalized answer a component emits (the catalog `produces`, minus the
// chrome/control `null`). Alias for a Section node's `answer_type`.
export type LeadgenAnswerType =
  | "number"
  | "currency"
  | "enum"
  | "boolean"
  | "array"
  | "object"
  | "string";

// One authorable answer choice (§13.1 per-choice fields). `value` is the
// normalized UI value; `analytics_id` is its stable tracking id (§22).
//
// v2.5 08 §8.4 ADDITIVE extension: `title`/`subtitle`/`badge`/`emoji`/
// `image_alt`/`disabled`/`aria_label`. `subtitle` SUPERSEDES `description`
// (which stays as a read alias — no migration). Validator rules (§8.4):
// `image_alt` REQUIRED when `imageMediaId` is present on ImageCardAnswerGrid
// (reuses `invalid_choice`); `emoji` and `icon` are mutually exclusive.
//
// P2a (register PC-11 completion / decision R-A) ADDITIVE extension: an
// OPTIONAL per-element `style` bag (see LeadgenChoiceStyle below) — DIFF-ONLY
// overrides of the node-level "all elements" default (theme ← node ← choice).
// A choice carrying no `style` renders byte-identically to pre-P2a.
export interface LeadgenChoice {
  label: string;
  value: string | number | boolean;
  analytics_id: string;
  icon?: string;
  // legacy read alias — superseded by `subtitle` (v2.5 §8.4)
  description?: string;
  imageMediaId?: string;
  title?: string;
  subtitle?: string;
  badge?: string;
  emoji?: string;
  image_alt?: string;
  disabled?: boolean;
  aria_label?: string;
  // P2a §R-A per-element theme freedom (optional; diff-only). See
  // LeadgenChoiceStyle + validateChoiceStyle below.
  style?: LeadgenChoiceStyle;
}

// B9 Other-group display metadata MIRROR (fix-contract v2.4 06 §6.4) — the
// schema-side original lives on the Offer payload node (payload.ts
// LeadgenPayloadChoiceDisplay); a Section node carries this mirrored copy
// where it renders the choices. Every field is OPTIONAL in storage: the
// Phase-1 render leg (presets.ts readChoiceDisplay — the SINGLE normalizing
// reader) applies the contract defaults (otherGroupLabel → "Other",
// booleans → false). This module only VALIDATES the authored value.
export interface LeadgenComponentChoiceDisplay {
  // Choice values (matched by String(choice.value)) shown as normal choices;
  // the rest fold into the "Other" secondary panel.
  mainValues?: string[];
  otherGroupEnabled?: boolean;
  otherGroupLabel?: string;
  searchableOther?: boolean;
}

// Inline dependency stored on a component (§12.3): "show/require this when
// field <when> <op> <value>". `op` reuses the canonical LeadGen condition-op
// vocabulary (db-types.ts / payload.ts — eq|neq|gt|lt|gte|lte|range|in|not_in).
export interface LeadgenComponentConditional {
  when: string;
  op: LeadgenConditionOp;
  value?: unknown;
  values?: unknown[];
  from?: number;
  to?: number;
}

// ---------------------------------------------------------------------------
// v2.5 03 §3.4 canonical headline binding — the bind VALUE vocabulary and the
// ONE component type each value is legal on (`bind_type_mismatch` otherwise).
// A bound node's text is the Section's headline/subheadline COLUMN, resolved
// at render — so a bound node must NOT carry props.text
// (`bound_node_carries_text`), and each bind value may appear at most once
// per Section, whole tree (`duplicate_bind`). flattenComponents ignores
// `bind` entirely (a bound node projects like any other affordance leaf).
// ---------------------------------------------------------------------------

export const LEADGEN_COMPONENT_BINDS = ["section_headline", "section_subheadline"] as const;
export type LeadgenComponentBind = (typeof LEADGEN_COMPONENT_BINDS)[number];

const BIND_SET: ReadonlySet<string> = new Set(LEADGEN_COMPONENT_BINDS);

const BIND_EXPECTED_TYPE: Record<LeadgenComponentBind, ComponentType> = {
  section_headline: "QuestionHeadline",
  section_subheadline: "Subheadline",
};

// The curated design-override key set (§14.8 "safe, tokenized — no arbitrary
// CSS"). §14.8 enumerates the inspector's tokenized style controls; the ones
// that write per-component STYLE token values into `design_overrides` are:
//   icon color token · card layout selector (columns) / card count per row ·
//   feature color token · range color token · button background token ·
//   button text token · answer-grid gap token · per-component mobile behavior.
// (The preset selector, per-choice icon selector, badge enable/icon/text and
// helper text are node CONTENT/structure fields — `design_preset`, `choices`,
// `props` — not style overrides.) `design_overrides` accepts ONLY these keys;
// any other key is rejected at save (§14.8 "unknown keys are rejected";
// §14.10 "no arbitrary-CSS escapes").
export const CURATED_DESIGN_OVERRIDE_KEYS = [
  "iconColor",
  "columns",
  "featureColor",
  "rangeColor",
  "buttonBackground",
  "buttonText",
  "gridGap",
  "mobileBehavior",
  // v3.1 §7.2 — NEW: width/height preset-or-custom_px (object-valued; see
  // `LeadgenSizeOverride` below).
  "size",
  // v3.1 §8.5/§8.5b — Phase C (this phase) adds the two node.design_overrides
  // keys §11.3's example already showed but Phase A explicitly deferred
  // ("corners/border_color stay unsupported... until a later phase adds
  // them" — this IS that later phase, the Style tab). Both are plain
  // enum-scalar keys (never object-shaped like `size`); values are
  // role/preset NAMES only — never hex (§8.5 "no hex anywhere on this tab").
  "corners",
  "border_color",
] as const;

export type CuratedDesignOverrideKey = (typeof CURATED_DESIGN_OVERRIDE_KEYS)[number];

const CURATED_OVERRIDE_KEY_SET: ReadonlySet<string> = new Set(CURATED_DESIGN_OVERRIDE_KEYS);

// A design override value is a fixed token reference / scalar — NEVER a CSS
// string — for every curated key EXCEPT `size`, which is the one
// object-shaped override (§7.2 `{width?, height?}`); `LeadgenDesignOverrides`
// is a partial map over the curated keys with that one carve-out.
export type LeadgenDesignOverrides = Partial<
  Record<Exclude<CuratedDesignOverrideKey, "size">, string | number | boolean>
> & {
  size?: LeadgenSizeOverride;
};

// ---------------------------------------------------------------------------
// v2.5 09 §9.4 — color-typed design_overrides VALUE vocabulary.
// ---------------------------------------------------------------------------

// The 14 semantic color roles (09 §9.1) — the ONLY color vocabulary in normal
// flows. Canonical list: designs/theme.ts (ROLE_TO_BASE_TOKEN keys); re-exported
// here under the schema-local name so validation and the theme layer can never
// drift.

export const LEADGEN_THEME_ROLES = FUNNEL_TOKEN_ROLES;

export type LeadgenThemeRole = (typeof LEADGEN_THEME_ROLES)[number];

const THEME_ROLE_SET: ReadonlySet<string> = new Set(LEADGEN_THEME_ROLES);

// The curated override keys whose VALUE is a color (per how presets.ts
// consumes them: featureColor → categoryLabel color, rangeColor → range fill
// background-color, iconColor → card icon color, buttonBackground →
// --lg-btn-bg, buttonText → button color). The other keys (columns, gridGap,
// mobileBehavior) are structural/spacing-typed — the §9.4 rule does NOT apply
// to them. NB (P1a, register PC-1): `columns`/`gridGap` are consumed by the
// WHOLE answer-grid family now — the two card grids (renderCardGrid), the
// multi-choice card group (renderMultiChoiceCardGroup) AND the ButtonAnswerGroup
// /TwoButtonYesNo choice grids (renderButtonAnswerGroup/renderTwoButtonYesNo via
// answerGroupRootStyle). The keys are type-agnostic here (any curated key
// validates on any node); the studio gates the authoring control to those
// consumers (ui-section-studio isAnswerLayoutType), the renderers clamp the
// value defensively.
export const COLOR_TYPED_OVERRIDE_KEYS = [
  "iconColor",
  "featureColor",
  "rangeColor",
  "buttonBackground",
  "buttonText",
] as const satisfies readonly CuratedDesignOverrideKey[];

const COLOR_TYPED_KEY_SET: ReadonlySet<string> = new Set(COLOR_TYPED_OVERRIDE_KEYS);

// §9.4/§9.6: a legacy raw `#hex` literal stays VALID (existing stored/seeded
// content carries raw design-token hex from curatedTokenOptions — rendered
// as-is, surfaced in the UI as "Custom color (legacy)"). Anything that is
// neither a known role nor a #hex literal → `invalid_override_value`.
const LEGACY_HEX_RE = /^#[0-9a-fA-F]{3,8}$/;

function isValidColorOverrideValue(value: unknown): boolean {
  return typeof value === "string" && (THEME_ROLE_SET.has(value) || LEGACY_HEX_RE.test(value));
}

// ---------------------------------------------------------------------------
// v3.1 §11.3 — NEW additive field-content props (Content tab §8.3 / Style tab
// §8.5b). Every value below is OPTIONAL on the node; a node carrying none of
// them validates exactly as it did before v3.1 (no existing content_json is
// affected).
// ---------------------------------------------------------------------------

// §8.5b "Enumerations (exact, asserted)" — the leading-icon picker on an
// answer/input field's Content tab (§8.3 `node.props.icon`). Ids are
// lowercase kebab-case names matching the display label (§11.3's own worked
// example anchors "location" for "Location pin"); this is a NEW semantic-id
// vocabulary — distinct from the pre-existing *raw glyph* `icon` props on
// ReassuranceBadge/SecureFormBadge/TrustBar/choices (e.g. "✓", "🔒", "★"),
// which stay glyphs (no repo precedent stores icons as semantic ids before
// this contract; BENEFIT_BAR_ICONS in ui-quotes.ts is a glyph-value list too).
//
// P1b (register PC-11): the SOURCE of this vocabulary is now
// icons.generated.ts's curated Tabler (MIT) subset (build-time vendored by
// scripts/build-icons.mjs — every name here has a matching
// LEADGEN_ICONS[name] SVG). This enum is re-exported unchanged in SHAPE (a
// readonly string-literal tuple) so every existing consumer (validation
// below, the studio pickers, the vitest completeness pins) keeps working —
// only the VALUE grew from the pre-Tabler 12 to the curated ~100+aliases.
// Back-compat: the pre-Tabler 12 (location/calendar/dollar/phone/email/lock/
// person/home/car/shield/star/none) is a proper subset — every one of those
// ids still resolves to a real icon (7 spell a real Tabler name directly;
// location/dollar/email/person are aliased to map-pin/currency-dollar/mail/
// user — see icons.generated.ts LEGACY_ALIASES) — so no existing
// content_json needs migration.
export const LEADGEN_FIELD_LEADING_ICONS = LEADGEN_ICON_NAMES;
export type LeadgenFieldLeadingIcon = (typeof LEADGEN_FIELD_LEADING_ICONS)[number];
const FIELD_LEADING_ICON_SET: ReadonlySet<string> = new Set(LEADGEN_FIELD_LEADING_ICONS);

// Conductor fix-round correction: the 12-value semantic enum above must NOT
// swallow the PRE-EXISTING free-form glyph/emoji `props.icon` convention
// already live (and unvalidated) on ReassuranceBadge/SecureFormBadge/
// SuccessState (registry.ts `props: [...,"icon?"]` on all three;
// renderReassuranceBadge/renderSecureFormBadge/renderSuccessState all do
// `propStr(node, "icon") ?? "<default glyph>"` verbatim, never enum-checked).
// A blanket enum check here would reject already-stored, already-rendering
// content — the ONE thing this whole slice must never do ("every existing
// content_json must validate unchanged"). TextBlock's reassurance/
// secure_badge roles carry the SAME glyph convention forward (the §5.3
// migration target for two of these three types) and share this exemption.
const GLYPH_ICON_TYPES: ReadonlySet<string> = new Set([
  "ReassuranceBadge",
  "SecureFormBadge",
  "SuccessState",
]);

// §5.6 "The Accept-swap rule" — the 8-value Accept enum (`node.props.format`).
// "us_zip" is anchored verbatim by the §11.3 worked example; the rest follow
// the same short-snake-case convention. This key does not collide with the
// PRE-EXISTING (dead/unread) `format` catalog entries — RangeQuestion's
// `format(number|currency)` is a different node family entirely, and
// PhoneInputQuestion's registry-documented `format` prop has zero readers
// today (grep-verified) — so there is no live behavior to conflict with.
export const LEADGEN_FIELD_ACCEPT_FORMATS = [
  "text",
  "number",
  "currency",
  "email",
  "phone",
  "us_zip",
  "date",
  "street_address",
] as const;
export type LeadgenFieldAcceptFormat = (typeof LEADGEN_FIELD_ACCEPT_FORMATS)[number];
const FIELD_ACCEPT_FORMAT_SET: ReadonlySet<string> = new Set(LEADGEN_FIELD_ACCEPT_FORMATS);

// v3.1 §5.6 "The Accept-swap rule" — the reverse map every text-input tile's
// Accept dropdown needs: Accept value -> the concrete stored type. Additive
// (Phase B slice 5); the natural home next to LEADGEN_FIELD_ACCEPT_FORMATS.
// Phase C's inspector imports this for the actual Accept <select>; the
// Section Studio's toolbar (Phase B) imports it for the toolbar-hosted
// equivalent (§6.1's "quick" controls host the Searchable/Card-style/Accept
// swaps, matching the pre-existing toggleSearchableDropdown idiom).
export const LEADGEN_FIELD_ACCEPT_TYPE: Record<LeadgenFieldAcceptFormat, ComponentType> = {
  text: "FreeTextQuestion",
  number: "NumberInputQuestion",
  currency: "CurrencyInputQuestion",
  email: "EmailInputQuestion",
  phone: "PhoneInputQuestion",
  us_zip: "ZIPInputQuestion",
  date: "DateQuestion",
  street_address: "AddressAutocompleteQuestion",
};

// The inverse lookup: a concrete stored type -> its Accept value, or
// undefined for any type outside the 8-value Accept-swap family (e.g.
// choice/container/copy types never have an Accept format).
const ACCEPT_FORMAT_BY_TYPE: Partial<Record<ComponentType, LeadgenFieldAcceptFormat>> = Object.fromEntries(
  Object.entries(LEADGEN_FIELD_ACCEPT_TYPE).map(([format, type]) => [type, format]),
) as Partial<Record<ComponentType, LeadgenFieldAcceptFormat>>;

// The Accept value implied by a node's CURRENT concrete type — undefined if
// the type isn't one of the 8 Accept-swappable text-input types.
export function acceptFormatOfType(type: ComponentType): LeadgenFieldAcceptFormat | undefined {
  return ACCEPT_FORMAT_BY_TYPE[type];
}

// ---------------------------------------------------------------------------
// PC-5 / PC-A5 (P4b) — DateQuestion bounds: real type + dynamic token grammar
// ---------------------------------------------------------------------------
// The investigation ground: DateQuestion had ZERO app-level validation — the
// registry's "date range" claim was fictional (Number(ISO)=NaN dead path), so
// garbage min/max saved silently AND silently disabled the native constraint.
// P4b makes min/max real date BOUNDS, each either an ISO date (YYYY-MM-DD) or a
// dynamic token resolved SERVER-side into concrete ISO at config build
// (config-dto.buildClientValidation) so the runtime stays a pure lexical ISO
// compare (validation.ts) with NO token grammar in the bundle.
//
// TOKEN GRAMMAR (studio picker -> stored string):
//   today            -> today's date
//   year_end         -> Dec 31 of the current year ("This year end")
//   +Nd / -Nd        -> today +/- N days      (e.g. +7d = "in 7 days")
//   +Nw / -Nw        -> today +/- N weeks
//   +Nm / -Nm        -> today +/- N months    (day clamped to the target month end)
// A "Custom date" pick stores a literal ISO date (not a token).
const DATE_TOKEN_RE = /^([+-])(\d{1,4})([dwm])$/;

// A strict ISO calendar date (YYYY-MM-DD, real month/day).
export function isIsoDate(raw: unknown): raw is string {
  if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return false;
  const y = Number(raw.slice(0, 4));
  const m = Number(raw.slice(5, 7));
  const d = Number(raw.slice(8, 10));
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

// Whether a raw min/max value is an authorable date bound (ISO date or token).
export function isDateBound(raw: unknown): boolean {
  return (
    isIsoDate(raw) ||
    raw === "today" ||
    raw === "year_end" ||
    (typeof raw === "string" && DATE_TOKEN_RE.test(raw))
  );
}

// Resolve a date bound (ISO literal OR token) to a concrete ISO date relative to
// `todayIso` (itself an ISO date). Returns null for anything unresolvable — the
// content-schema authoring gate (isDateBound) already rejects garbage upstream,
// so a null here only ever means "no bound".
export function resolveDateBound(raw: unknown, todayIso: string): string | null {
  if (isIsoDate(raw)) return raw;
  if (typeof raw !== "string" || raw === "" || !isIsoDate(todayIso)) return null;
  const ty = Number(todayIso.slice(0, 4));
  const tm = Number(todayIso.slice(5, 7));
  const td = Number(todayIso.slice(8, 10));
  const base = new Date(Date.UTC(ty, tm - 1, td));
  if (raw === "today") return base.toISOString().slice(0, 10);
  if (raw === "year_end") return `${ty}-12-31`;
  const parts = raw.match(DATE_TOKEN_RE);
  if (parts === null) return null;
  const n = (parts[1] === "-" ? -1 : 1) * Number(parts[2]);
  const unit = parts[3];
  if (unit === "d") base.setUTCDate(base.getUTCDate() + n);
  else if (unit === "w") base.setUTCDate(base.getUTCDate() + n * 7);
  else {
    // months: pin to the 1st before shifting, then clamp the day to the target
    // month's last day (so today=Jan 31, +1m -> Feb 28/29, never a Mar rollover).
    const day = base.getUTCDate();
    base.setUTCDate(1);
    base.setUTCMonth(base.getUTCMonth() + n);
    const lastDay = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)).getUTCDate();
    base.setUTCDate(Math.min(day, lastDay));
  }
  return base.toISOString().slice(0, 10);
}

// §5.3/§8.5b — the TextBlock `role` enum (TextBlock only).
export const LEADGEN_TEXT_BLOCK_ROLES = [
  "heading",
  "body",
  "category_label",
  "helper",
  "legal",
  "reassurance",
  "secure_badge",
] as const;
export type LeadgenTextBlockRole = (typeof LEADGEN_TEXT_BLOCK_ROLES)[number];
const TEXT_BLOCK_ROLE_SET: ReadonlySet<string> = new Set(LEADGEN_TEXT_BLOCK_ROLES);

// §5.3 — the ImageBlock `source` enum (ImageBlock only): "media" is an
// explicitly-authored image (a logoMediaId prop, the HeaderBar/LogoStrip
// convention); "auto_logo" is the §5.3 "Auto-fill: site logo" toggle target.
export const LEADGEN_IMAGE_BLOCK_SOURCES = ["media", "auto_logo"] as const;
export type LeadgenImageBlockSource = (typeof LEADGEN_IMAGE_BLOCK_SOURCES)[number];
const IMAGE_BLOCK_SOURCE_SET: ReadonlySet<string> = new Set(LEADGEN_IMAGE_BLOCK_SOURCES);

// v3.1 §8.5b Style tab — the node-level `design_overrides.corners` /
// `.border_color` enums (Phase C). Distinct from the 14-value funnel-wide
// THEME roles (LEADGEN_THEME_ROLES/§9.1) — border_color is its OWN small
// 3-value role vocabulary, never the general color-role set and never hex.
export const LEADGEN_NODE_CORNERS = ["sharp", "rounded", "pill"] as const;
export type LeadgenNodeCorners = (typeof LEADGEN_NODE_CORNERS)[number];
const NODE_CORNERS_SET: ReadonlySet<string> = new Set(LEADGEN_NODE_CORNERS);

export const LEADGEN_NODE_BORDER_COLOR_ROLES = ["neutral", "brand", "accent"] as const;
export type LeadgenNodeBorderColorRole = (typeof LEADGEN_NODE_BORDER_COLOR_ROLES)[number];
const NODE_BORDER_COLOR_ROLE_SET: ReadonlySet<string> = new Set(LEADGEN_NODE_BORDER_COLOR_ROLES);

// §9.2 — the field-level Maps config (`node.props.maps`), valid only on
// ZIP/Address types (§9 "field Maps tab").
export interface LeadgenFieldMapsConfig {
  enabled: boolean;
  jobs: {
    validate: boolean;
    auction: boolean;
    autocomplete: boolean;
  };
}
const MAPS_ELIGIBLE_TYPES: ReadonlySet<string> = new Set([
  "ZIPInputQuestion",
  "AddressAutocompleteQuestion",
]);

// ---------------------------------------------------------------------------
// v3.1 §7.2 — design_overrides.size (width/height preset-or-custom_px).
// ---------------------------------------------------------------------------

export const LEADGEN_SIZE_WIDTH_PRESETS = ["s", "m", "l", "full"] as const;
export type LeadgenSizeWidthPreset = (typeof LEADGEN_SIZE_WIDTH_PRESETS)[number];
const SIZE_WIDTH_PRESET_SET: ReadonlySet<string> = new Set(LEADGEN_SIZE_WIDTH_PRESETS);

export const LEADGEN_SIZE_HEIGHT_PRESETS = ["small", "medium", "large"] as const;
export type LeadgenSizeHeightPreset = (typeof LEADGEN_SIZE_HEIGHT_PRESETS)[number];
const SIZE_HEIGHT_PRESET_SET: ReadonlySet<string> = new Set(LEADGEN_SIZE_HEIGHT_PRESETS);

export interface LeadgenSizeOverride {
  width?: LeadgenSizeWidthPreset | { custom_px: number };
  height?: LeadgenSizeHeightPreset | { custom_px: number };
}

// §7.1 bullet 3 (binding): "stored value = the drag's measured content-box
// width in px, snapped to a 4px grid, clamped to [200, 600]" — the 600 is the
// Appendix B "Unit column width". This numeric range is stated for WIDTH.
//
// FLAGGED (not asserted as contract fact): §7.2's storage example shows a
// HEIGHT custom_px of 56 — below the width floor of 200 — and §7.3's own
// callout confirms height-dragging is NOT part of v3.1 ("height is
// preset-only unless the product owner opts height into custom... enabling
// height is a UI-only change, no schema impact"); no drag-measurement formula
// is defined for height anywhere in the contract. Applying the width floor of
// 200 to height would reject the contract's own worked example, so height
// keeps only the shared 600 ceiling (the one axis-agnostic constant in the
// doc) with a grid-native floor of 4 — an inferred engineering default, NOT
// an explicit contract number. Flagged for conductor/adversarial-review
// confirmation against the golden master / a future design addendum.
const SIZE_WIDTH_CUSTOM_PX_MIN = 200;
const SIZE_WIDTH_CUSTOM_PX_MAX = 600;
const SIZE_HEIGHT_CUSTOM_PX_MIN = 4;
const SIZE_HEIGHT_CUSTOM_PX_MAX = 600;
const SIZE_GRID_PX = 4;

function snapToSizeGrid(px: number): number {
  return Math.round(px / SIZE_GRID_PX) * SIZE_GRID_PX;
}
function clampSizePx(px: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, px));
}

// §10.4 "Buttons & inputs — the shared size language" — the theme record's
// `controls` sub-object VERBATIM (KV `lg-funnel-themes`). Defined here (not
// imported from designs/theme.ts, which this module must not depend on — a
// parallel slice owns the theme KV/resolution layer) so `resolveFieldSize`
// stays pure and wiring-agnostic; the caller extracts `theme.controls` and
// passes it through unchanged.
export interface LeadgenSizeThemeControls {
  field_height: LeadgenSizeHeightPreset;
  button_size: "s" | "m" | "l";
  corners: "sharp" | "rounded" | "pill";
}

export type LeadgenResolvedSizeAxis =
  | { mode: "preset"; preset: string }
  | { mode: "custom"; px: number };

export interface LeadgenResolvedFieldSize {
  width: LeadgenResolvedSizeAxis;
  height: LeadgenResolvedSizeAxis;
}

// §7.1 "Reset ... (demo resets to Full)": the theme's `controls` object (§10.4
// JSON) carries NO width knob — only `field_height`/`button_size`/`corners` —
// so an absent WIDTH override has no theme tier to inherit from (confirmed by
// §10.4's own resolution sentence: "a field with no `size` override resolves
// to `controls.field_height`" — height ONLY). Absent width falls straight to
// this fixed design default. Flagged (not asserted as contract fact) for
// conductor/adversarial-review confirmation.
const DEFAULT_WIDTH_PRESET: LeadgenSizeWidthPreset = "full";

function resolveSizeAxis(
  raw: string | { custom_px: number } | undefined,
  fallbackPreset: string,
  min: number,
  max: number,
): LeadgenResolvedSizeAxis {
  if (raw === undefined) return { mode: "preset", preset: fallbackPreset };
  if (typeof raw === "string") return { mode: "preset", preset: raw };
  // Defensive re-clamp/re-snap (belt-and-suspenders over validate-time
  // enforcement) — mirrors the clampInt-at-render idiom used throughout
  // presets.ts for legacy/corrupt stored values.
  return { mode: "custom", px: clampSizePx(snapToSizeGrid(raw.custom_px), min, max) };
}

// PURE (sizeOverride, themeControls) -> resolved width/height decision (§7.1
// state machine: node override -> funnel theme default -> design default;
// §12 "preset name -> theme.controls resolved px; {custom_px} -> explicit
// px; absent -> theme default"). Returns a DECISION, not a CSS/px value for
// preset names — the actual preset->px token table lives wherever the design
// tokens are resolved (out of this module's reach by design: "do NOT import
// designs/theme.ts"); custom_px resolutions ARE concrete px (clamped/snapped
// here). Height inherits `themeControls.field_height` when absent; width has
// no theme knob to inherit (see DEFAULT_WIDTH_PRESET above) so it falls to
// the fixed design default "full". `button_size`/`corners` are accepted for
// call-site shape convenience (the caller passes the whole `theme.controls`
// object) but are not consumed by this resolver — corners is a SIBLING
// design_overrides key (not part of `size`) and button_size governs the
// frame's Continue button, a separate concern from field width/height.
export function resolveFieldSize(
  sizeOverride: LeadgenSizeOverride | undefined,
  themeControls: LeadgenSizeThemeControls,
): LeadgenResolvedFieldSize {
  return {
    width: resolveSizeAxis(
      sizeOverride?.width,
      DEFAULT_WIDTH_PRESET,
      SIZE_WIDTH_CUSTOM_PX_MIN,
      SIZE_WIDTH_CUSTOM_PX_MAX,
    ),
    height: resolveSizeAxis(
      sizeOverride?.height,
      themeControls.field_height,
      SIZE_HEIGHT_CUSTOM_PX_MIN,
      SIZE_HEIGHT_CUSTOM_PX_MAX,
    ),
  };
}

// ---------------------------------------------------------------------------
// P3a (register PC-2 / decision D1, axiom R-B) — STRUCTURED PLACEMENT.
// ---------------------------------------------------------------------------
// The operator's "drag = defining custom locations" (R-B) is delivered as a
// STRUCTURED model, NOT arbitrary x/y pixels: sibling elements group into a
// ROW (2-3 slots side by side); each element carries an alignment, an optional
// width (the SAME s/m/l/full/custom_px vocabulary + resolver as
// design_overrides.size.width — never a new width scale), and a bounded numeric
// nudge (±48px) as the deliberate escape hatch. Rows stack to a column
// automatically at the 480px breakpoint (presets.ts renderNodes + styles.ts).
//
// The field is OPTIONAL on any node; a node carrying no `layout` (or an empty
// `{}`) validates AND renders byte-identically to pre-P3a (the phase invariant,
// leadgen-p3a-backcompat). It is NOT allowed on a frame-scope component
// (ProgressBar/HeaderLogo/BackButton/… — chrome the funnel frame owns; placement
// is a Section-unit concern) — a NEW field, so rejecting it there breaks no
// stored content.
//
// P3b WRITE-SHAPE CONTRACT (the drag/canvas island that DRIVES this model):
//   • To put element B beside element A in a row, set BOTH nodes'
//     `layout.row` to the SAME row-id string (e.g. crypto id or "row_<n>").
//     They MUST be CONTIGUOUS siblings at the same tree depth (adjacent in the
//     parent's children/root list) — a non-contiguous row is a save ERROR
//     (unrenderable). Insert/reorder so members sit next to each other.
//   • A row holds 2-3 members (a 4th is a save ERROR). A lone element carrying
//     a row-id is harmless (renders as a normal single element).
//   • `align` positions content within a row slot AND positions a fixed-width
//     lone element within its column (start/center/end).
//   • `width` reuses the size-width vocabulary; on a row member it sets the
//     slot's fixed basis (unauthored members share the rest equally); on a lone
//     element it sets the box width (then `align` positions it).
//   • `nudge_x`/`nudge_y` are integer px in [-48, 48] — a translate-only visual
//     offset that never affects flow/rhythm (and is dropped on mobile).
//   • row-id shape: [A-Za-z0-9_-], ≤ 64 chars (a stored token, never CSS).

// The three alignment keywords (start | center | end) — the ONLY placement
// alignment vocabulary. Maps to justify/self alignment inside a row slot and to
// the generalized widthCenteringEntries margins for a lone fixed-width element
// (presets.ts). NB: "stretch"/"justify" are NOT offered — an element either
// hugs an edge or centers; filling is the un-authored default.
export const LEADGEN_PLACEMENT_ALIGNS = ["start", "center", "end"] as const;
export type LeadgenPlacementAlign = (typeof LEADGEN_PLACEMENT_ALIGNS)[number];
const PLACEMENT_ALIGN_SET: ReadonlySet<string> = new Set(LEADGEN_PLACEMENT_ALIGNS);

// Bounded numeric nudge (§R-B "deliberate escape hatch"): integer px clamped to
// [-48, 48] on BOTH axes. Small enough that a translate can never move an
// element out of its own rhythm band (the intent: a few px of visual polish,
// not free positioning).
const PLACEMENT_NUDGE_MIN = -48;
const PLACEMENT_NUDGE_MAX = 48;

// row-id: a stored TOKEN, never CSS. Sane shape (kebab/snake/alnum) + a length
// cap; the looksLikeArbitraryCss guard (shared with design_overrides) is the
// belt over the suspenders regex.
const PLACEMENT_ROW_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

// A row holds at most 3 members (§D1 "2-3 slots side by side"). A run of 4+
// contiguous same-row siblings is a save ERROR.
export const LEADGEN_MAX_ROW_MEMBERS = 3;

// CONDUCTOR FIX (post-P3a-dispatch, surfaced by P3b): ContinueButton and
// AutoAdvanceButton are catalog `scope: "unit"` (Section-palette placeable),
// but their POSITION is FUNNEL-LAYOUT-owned — the §8.5b/§11.5 continue-
// placement model (continue_placement "below_unit" deferral, the single
// end-of-subtree slot, ctx.continue_style_role; presets.ts SectionRenderState.
// deferContinue/deferredContinue). The Quote Builder — not free per-node
// placement — already decides WHERE the section's one continue control lands.
// Letting either type join a row / carry an align/width/nudge would contradict
// that ownership: `layout` is REJECTED on both, the SAME "a NEW field breaks no
// stored content" reasoning as the frame-scope rejection below. Exported so the
// P3b studio island can mirror this EXACT exclusion in its own UI gating
// (disable/hide the placement controls for these two types) without
// duplicating — or drifting from — the list.
export const LEADGEN_PLACEMENT_EXCLUDED_TYPES = [
  "ContinueButton",
  "AutoAdvanceButton",
] as const satisfies readonly ComponentType[];
const PLACEMENT_EXCLUDED_TYPE_SET: ReadonlySet<string> = new Set(LEADGEN_PLACEMENT_EXCLUDED_TYPES);

// The per-node structured-placement bag. Every field OPTIONAL; the `width`
// field is the EXACT `LeadgenSizeOverride["width"]` union (s/m/l/full or
// {custom_px}) — one width vocabulary, one resolver (resolveSizeAxis).
export interface LeadgenPlacementLayout {
  row?: string;
  align?: LeadgenPlacementAlign;
  width?: LeadgenSizeWidthPreset | { custom_px: number };
  nudge_x?: number;
  nudge_y?: number;
}

const PLACEMENT_LAYOUT_KEYS = ["row", "align", "width", "nudge_x", "nudge_y"] as const;
const PLACEMENT_LAYOUT_KEY_SET: ReadonlySet<string> = new Set(PLACEMENT_LAYOUT_KEYS);

// ---------------------------------------------------------------------------
// P2a (register PC-11 completion / decision R-A) — per-ELEMENT theme freedom.
// A choice's OPTIONAL `style` bag (LeadgenChoice.style above) overrides the
// node-level "all elements" default DIFF-ONLY (Webflow-style: only the keys
// the author explicitly set override; the theme/node defaults keep cascading
// to every OTHER property — never the Wix trap where an override orphans the
// element from theme updates). Every field is optional; a choice carrying no
// `style` (or `{}`) is byte-identical to pre-P2a. Save-time validation MIRRORS
// the node-level rules: `size` reuses the node HEIGHT axis' custom_px
// clamp/snap ([4,600], 4px grid); `color_role`/`text_color_role` reuse the
// SAME 14-role funnel vocabulary the node-level color pipeline (§9.4 ovColor)
// accepts; `color_hex`/`text_color_hex` are the deliberate OFF-THEME escape,
// validated by the SAME legacy-#hex rule + the arbitrary-CSS guard. Setting
// BOTH color_role AND color_hex (or both text_color_*) is an explicit
// precedence ERROR (`invalid_choice_style`) — never silently resolved.
// ---------------------------------------------------------------------------

// The per-choice SIZE vocabulary is the theme "button size" scale
// (LeadgenSizeThemeControls.button_size — "s"|"m"|"l"), applied as the item's
// HEIGHT (min-height) exactly like the node-level size.height axis. A choice
// has NO width axis (grid cells stay equal-width — §R-A "per-element sizes"
// vary HEIGHT only; the node owns group/grid width) so this is deliberately
// the 3-value button scale, not the node WIDTH presets (s/m/l/full).
export const LEADGEN_CHOICE_SIZE_PRESETS = ["s", "m", "l"] as const;
export type LeadgenChoiceSizePreset = (typeof LEADGEN_CHOICE_SIZE_PRESETS)[number];
const CHOICE_SIZE_PRESET_SET: ReadonlySet<string> = new Set(LEADGEN_CHOICE_SIZE_PRESETS);

// The font-weight step (normal → the theme default weight; strong → a bold
// step). A resting-state distinction (like the color); the renderer resolves
// it to a concrete weight.
export const LEADGEN_CHOICE_EMPHASES = ["normal", "strong"] as const;
export type LeadgenChoiceEmphasis = (typeof LEADGEN_CHOICE_EMPHASES)[number];
const CHOICE_EMPHASIS_SET: ReadonlySet<string> = new Set(LEADGEN_CHOICE_EMPHASES);

export interface LeadgenChoiceStyle {
  // HEIGHT (min-height): a button-size preset OR a custom px on the SAME
  // [SIZE_HEIGHT_CUSTOM_PX_MIN, SIZE_HEIGHT_CUSTOM_PX_MAX] snap-4 grid the
  // node-level size.height custom_px uses.
  size?: LeadgenChoiceSizePreset | { custom_px: number };
  // RESTING background — a theme color role (the 14-role funnel vocabulary,
  // §9.1) …
  color_role?: LeadgenThemeRole;
  // … OR a deliberate OFF-THEME #hex escape (mutually exclusive with color_role).
  color_hex?: string;
  // Label color (legibility against a custom background) — role or off-theme #hex.
  text_color_role?: LeadgenThemeRole;
  text_color_hex?: string;
  // Font-weight step.
  emphasis?: LeadgenChoiceEmphasis;
}

const CHOICE_STYLE_KEYS = [
  "size",
  "color_role",
  "color_hex",
  "text_color_role",
  "text_color_hex",
  "emphasis",
] as const;
const CHOICE_STYLE_KEY_SET: ReadonlySet<string> = new Set(CHOICE_STYLE_KEYS);

// One component node in a Section's `content_json`.
//
// LAYOUT CONTAINERS (fix-contract v2.4 08 §8.5, issue E4): a node whose type
// is one of the 5 children-bearing container types (LEADGEN_CONTAINER_TYPES)
// may additionally carry `children` — an ordered sub-tree of nodes — plus an
// optional stable `container_id`. Both fields live on the SHARED node
// interface (pragmatic: one parse type for the whole tree); the VALIDATOR
// enforces "children only on container types", the depth-4 cap, and that
// containers never carry answer fields. A flat array (zero containers) is the
// degenerate tree and validates + renders byte-identically to pre-§8.5
// content (§8.13 legacy compat: "flat legacy arrays render as an implicit
// root Stack" — i.e. the root list itself).
export interface LeadgenComponentNode {
  type: ComponentType;
  question_id: string;
  question_key?: string;
  internal_field?: string;
  answer_type?: LeadgenAnswerType;
  required?: boolean;
  valid_values?: Array<string | number | boolean>;
  choices?: LeadgenChoice[];
  // B9 §6.4 mirrored Other-group display metadata (choice components only).
  choiceDisplay?: LeadgenComponentChoiceDisplay;
  conditional?: LeadgenComponentConditional;
  // §3.4 canonical headline binding: "section_headline" is legal ONLY on a
  // QuestionHeadline, "section_subheadline" ONLY on a Subheadline; at most one
  // node per bind value per Section; a bound node carries NO props.text (its
  // text is the Section column, resolved at render). Ignored by
  // flattenComponents and every non-renderer consumer.
  bind?: LeadgenComponentBind;
  design_preset?: string;
  design_overrides?: LeadgenDesignOverrides;
  // P3a (register PC-2 / D1 / R-B) — structured placement (row grouping,
  // per-element align/width, bounded nudge). OPTIONAL; absent ⇒ byte-identical
  // pre-P3a render. Not allowed on frame-scope components (validator-enforced).
  layout?: LeadgenPlacementLayout;
  // Per-type authorable extras (min/max/step/labels/placeholder/text/html/
  // logoMediaId/columns/…). Preset-specific; presets read them defensively.
  props?: Record<string, unknown>;
  // §8.5 container extension — VALID ONLY on the 5 container types (validator-
  // enforced); a leaf carrying children is a typed error.
  children?: LeadgenComponentNode[];
  container_id?: string;
}

export interface LeadgenSectionContent {
  components: LeadgenComponentNode[];
  // P4c (register PC-12): section-level Continue-button visibility rule —
  // SAME LeadgenComponentConditional shape as a node's `conditional`, but
  // keyed at the Section (not any one node) because a Section may carry
  // zero-or-many ContinueButton nodes (auto_advance mode renders none at
  // all). Authored via the studio's CONTINUE inspector panel; consumed by
  // the runtime engine (conditionMet) to hide/show [data-lg-continue].
  continue_visible_when?: LeadgenComponentConditional;
}

// ---------------------------------------------------------------------------
// §8.5 layout containers — the container-type vocabulary + the ONE canonical
// flatten helper every answer/dependency/config consumer shares.
// ---------------------------------------------------------------------------

// The 5 children-BEARING container types (§8.5). The 3 prop-driven layout
// leaves (Spacer / HeaderBar / FooterBar) are NOT here — they carry no
// children and flow through flattenComponents like any other leaf.
export const LEADGEN_CONTAINER_TYPES = [
  "Stack",
  "GridContainer",
  "Columns",
  "CardPanel",
  "BackgroundPanel",
] as const;

export type LeadgenContainerType = (typeof LEADGEN_CONTAINER_TYPES)[number];

const CONTAINER_TYPE_SET: ReadonlySet<string> = new Set(LEADGEN_CONTAINER_TYPES);

// §8.5 "max depth 4": container nesting is capped at 4 container levels. The
// cap doubles as the circularity guard — neither the validator nor the
// flatten walk ever descends past it, so a (non-JSON) cyclic object
// terminates instead of recursing forever.
export const LEADGEN_MAX_CONTAINER_DEPTH = 4;

// True when `type` names a children-bearing §8.5 layout container.
export function isLayoutContainerType(type: unknown): type is LeadgenContainerType {
  return typeof type === "string" && CONTAINER_TYPE_SET.has(type);
}

// THE canonical flatten: every non-container node of the tree in depth-first
// render order. Containers are a SERVER-side rendering concern — every
// consumer that iterates a Section's components for questions / answers /
// dependencies / config projection consumes THIS list; ONLY the validator and
// the preset renderer recurse the tree. For flat legacy content (zero
// containers) the result is the input list unchanged (same nodes, same
// order — §8.13). Defensive: non-object junk entries pass through exactly as
// they always did in the flat world (callers keep their own isRecord guards);
// a container nested beyond the depth cap is not descended into (the
// validator is the gate; this walk just refuses to blow the stack).
export function flattenComponents(
  components: readonly LeadgenComponentNode[],
): LeadgenComponentNode[] {
  const out: LeadgenComponentNode[] = [];
  const walk = (nodes: readonly LeadgenComponentNode[], depth: number): void => {
    for (const node of nodes) {
      const type =
        typeof node === "object" && node !== null ? (node as { type?: unknown }).type : undefined;
      if (isLayoutContainerType(type)) {
        if (depth >= LEADGEN_MAX_CONTAINER_DEPTH + 1) continue; // corrupt over-deep data
        const children = (node as { children?: unknown }).children;
        if (Array.isArray(children)) walk(children as LeadgenComponentNode[], depth + 1);
      } else {
        out.push(node);
      }
    }
  };
  walk(components, 1);
  return out;
}

// ---------------------------------------------------------------------------
// P4a (register PC-4-behavior / PC-A1) — continue_mode="auto_advance" eligibility
// ---------------------------------------------------------------------------
//
// auto_advance is a SECTION-level flag (db-types.ts LeadgenContinueMode). It
// makes the runtime advance to the next section the instant an answer is
// recorded, with NO Continue button. But the engine (runtime/engine.ts
// handleChoiceActivation) only ever fires that advance from a [data-lg-choice]
// CLICK, for a NON-multi component, and ONLY when EXACTLY ONE interactive
// component is visible; every other answer path (text/number/range/dropdown/
// date/address inputs → handleInputEvent) NEVER advances. A section whose
// answer cannot reach that single-click trigger is STUCK under auto_advance:
// presets suppresses the Continue and nothing advances (PC-A1, live-proven).
//
// Operator rule (binding): "in this specific component there is no button to
// click, so the only option must be continue button … if we have few different
// components the only valid option should be Wait for continue … in multi-choice
// components this feature must be disabled as well."
//
// Grounded in the engine's ACTUAL advance trigger, auto_advance is valid for a
// section ONLY when its answer-producing components (catalog.produces !== null)
// number EXACTLY ONE, that one is a single-select CLICK-to-answer control, and
// it carries no `conditional` (so it is ALWAYS the one visible interactive —
// "exactly one visible simultaneously" is provable, never merely hoped).

// The click-to-answer, single-select component types: the engine's
// handleChoiceActivation advance set (components that render clickable
// [data-lg-choice] buttons/cards) MINUS the inherently-multi one
// (MultiChoiceCardGroup). Dropdowns render a <select> whose selection fires
// `change`→handleInputEvent (NOT the click delegate), so they are NOT here.
export const AUTO_ADVANCE_CLICK_TYPES: ReadonlySet<ComponentType> = new Set<ComponentType>([
  "ButtonAnswerGroup",
  "TwoButtonYesNo",
  "IconCardAnswerGrid",
  "ImageCardAnswerGrid",
  "OtherGroupSelector",
]);

export type AutoAdvanceIneligibleReason =
  | "no_producers"
  | "multiple_producers"
  | "not_click_to_answer"
  | "multi_select"
  | "conditional_producer";

export interface AutoAdvanceEligibility {
  eligible: boolean;
  // Flattened answer-producing components in render order (names the offenders).
  producers: { type: string; question_id: string }[];
  // Populated ONLY when !eligible.
  reason?: AutoAdvanceIneligibleReason;
}

function isAnswerProducingNode(node: unknown): node is LeadgenComponentNode {
  if (!isRecord(node)) return false;
  const type = node["type"];
  return isKnownComponentType(type) && COMPONENT_CATALOG[type].produces !== null;
}

function isMultiSelectNode(node: LeadgenComponentNode): boolean {
  // The catalog `produces:"array"` (MultiChoiceCardGroup) is the authoritative
  // multi signal even when the node omits an explicit answer_type; the engine's
  // per-node signals (answer_type "array" / props.multiple) cover a
  // single-select type CONFIGURED multi (e.g. ButtonAnswerGroup props.multiple).
  if (isKnownComponentType(node.type) && COMPONENT_CATALOG[node.type].produces === "array") return true;
  if (node.answer_type === "array") return true;
  // P5 (PC-10): a MultiQuestionGrid records SEVERAL answers (one per row), so —
  // exactly like a multi-select — a single tap can never advance the section.
  // This routes auto_advance to the HONEST "multi_select" reason ("choose
  // several answers, so one tap can't advance") rather than the false
  // "not_click_to_answer" (its rows ARE click-to-answer). Always Continue.
  if (node.type === "MultiQuestionGrid") return true;
  const props = node.props;
  return isRecord(props) && props["multiple"] === true;
}

// PURE: does continue_mode="auto_advance" make sense for this section body?
export function autoAdvanceEligibility(
  components: readonly LeadgenComponentNode[],
): AutoAdvanceEligibility {
  const producers = flattenComponents(components).filter(isAnswerProducingNode);
  const list = producers.map((p) => ({
    type: String(p.type),
    question_id: isNonEmptyString(p.question_id) ? p.question_id : "",
  }));
  if (producers.length === 0) return { eligible: false, producers: list, reason: "no_producers" };
  if (producers.length > 1) return { eligible: false, producers: list, reason: "multiple_producers" };
  const only = producers[0] as LeadgenComponentNode;
  // multi FIRST: a multi-choice component (e.g. MultiChoiceCardGroup) IS
  // click-to-answer, so "multi_select" is the honest reason, not "no click".
  if (isMultiSelectNode(only)) return { eligible: false, producers: list, reason: "multi_select" };
  if (!AUTO_ADVANCE_CLICK_TYPES.has(only.type)) {
    return { eligible: false, producers: list, reason: "not_click_to_answer" };
  }
  if (only.conditional !== undefined) {
    return { eligible: false, producers: list, reason: "conditional_producer" };
  }
  return { eligible: true, producers: list };
}

// The operator-voiced, component-naming save-error copy (PC-A1). Exported so the
// server validator and the studio Behavior panel show IDENTICAL wording.
export function autoAdvanceConflictMessage(result: AutoAdvanceEligibility): string {
  const n = result.producers.length;
  const names = result.producers.map((p) => p.type).join(", ");
  const tail = " 'Go to next' works only for a single choice-style question (buttons or cards).";
  switch (result.reason) {
    case "multiple_producers":
      return `This section has ${n} answer components (${names}) — visitors need the Continue button.` + tail;
    case "no_producers":
      return `This section has no answer component to advance from — visitors need the Continue button.` + tail;
    case "not_click_to_answer":
      return `The answer here is a ${names} — visitors type or pick a value, so there is nothing to click to advance. Use the Continue button.` + tail;
    case "multi_select":
      return `This is a multi-select question (${names}) — visitors choose several answers, so one tap can't advance. Use the Continue button.` + tail;
    case "conditional_producer":
      return `This answer component (${names}) only appears under a condition, so it can't be the section's single always-present question. Use the Continue button.` + tail;
    default:
      return `This section can't auto-advance — use the Continue button.` + tail;
  }
}

// ---------------------------------------------------------------------------
// P5 (register PC-10 / operator decision D2 — Image9) — MultiQuestionGrid rows
// ---------------------------------------------------------------------------
//
// A MultiQuestionGrid node renders SEVERAL labeled sub-questions ("rows"), each
// its OWN answer field. Like NameFieldsGroup/Address (catalog produces
// "object"), the node carries NO single internal_field; each row's
// `internal_field` is a real field the whole answer space sees (answers.ts
// fieldsOf, config-dto row projection, rules pickers). The SHARED pill set is
// the node's top-level `choices`; a row MAY override it with its own `choices`.
// A row's optional `default` (∈ its effective choices) pre-selects a pill AND
// seeds the row's initial answer — config-dto projects each row as a synthetic
// single-field component with a `default_answer`, so the runtime's EXISTING
// TwoButtonYesNo default-seed path (applySectionDefaults) records it with ZERO
// new engine logic.

export interface MultiQuestionRow {
  label: string;
  internal_field: string;
  default?: string | number | boolean;
  required?: boolean;
  // Optional per-row override of the node-level shared `choices` (LeadgenChoice[]).
  choices?: LeadgenChoice[];
}

// Authoring bounds (the catalog `validation` column). 1..8 rows; each pill set
// 2..4 (pill pairs → small sets, per the reference).
export const MULTI_QUESTION_MAX_ROWS = 8;
export const MULTI_QUESTION_MIN_CHOICES = 2;
export const MULTI_QUESTION_MAX_CHOICES = 4;

// THE one normalizing reader for a node's rows — shared by the presets
// renderer, the config-dto row projection, answers.ts fieldsOf, and the studio
// field enumeration, so no two consumers can disagree on the row set. Defensive
// (validation is the save-time gate): a malformed / field-less entry is skipped
// so a render/projection over stored junk never throws or emits a nameless row.
export function readMultiQuestionRows(node: LeadgenComponentNode): MultiQuestionRow[] {
  const raw = node.props?.["rows"];
  if (!Array.isArray(raw)) return [];
  const out: MultiQuestionRow[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const internalField = entry["internal_field"];
    if (!isNonEmptyString(internalField)) continue;
    const row: MultiQuestionRow = {
      label: typeof entry["label"] === "string" ? entry["label"] : "",
      internal_field: internalField,
    };
    if (isChoicePrimitive(entry["default"])) row.default = entry["default"];
    if (typeof entry["required"] === "boolean") row.required = entry["required"];
    if (Array.isArray(entry["choices"])) row.choices = entry["choices"] as LeadgenChoice[];
    out.push(row);
  }
  return out;
}

// A row's EFFECTIVE choices: its own `choices` override, else the node's shared
// `choices` (the common case — every row the same pill pair). Empty when
// neither is authored (a save-time invalid_choice).
export function multiQuestionRowChoices(
  node: LeadgenComponentNode,
  row: MultiQuestionRow,
): LeadgenChoice[] {
  if (Array.isArray(row.choices) && row.choices.length > 0) return row.choices;
  return Array.isArray(node.choices) ? node.choices : [];
}

// The synthetic per-row question_id — the stable id config-dto assigns each
// row's projected single-field component AND presets stamps on each row's
// [data-lg-question] wrapper, so the runtime's enterSection paint /
// handleChoiceActivation / componentByQuestionId resolve a row exactly like any
// scalar question. MUST be byte-identical on both sides: derived purely from
// the node's question_id + the row's (section-unique) internal_field.
export function multiQuestionRowQuestionId(nodeQuestionId: string, internalField: string): string {
  return `${nodeQuestionId}::${internalField}`;
}

// ---------------------------------------------------------------------------
// Typed validation errors
// ---------------------------------------------------------------------------

export type SectionContentErrorCode =
  | "content_not_object"
  | "components_not_array"
  | "components_empty"
  | "node_not_object"
  | "unknown_component_type"
  | "missing_question_id"
  | "duplicate_question_id"
  | "duplicate_question_key"
  | "duplicate_internal_field"
  | "missing_required_field"
  | "invalid_choice"
  // P2a §R-A per-element theme freedom — choice.style shape / vocabulary /
  // color-precedence violations (+ TwoButtonYesNo props.yesStyle/noStyle).
  | "invalid_choice_style"
  | "invalid_valid_values"
  | "answer_type_mismatch"
  | "conditional_invalid"
  | "conditional_unknown_field"
  | "non_curated_override_key"
  | "arbitrary_css_override"
  | "choice_display_invalid"
  // §8.5 layout-container errors
  | "container_depth_exceeded"
  | "children_not_allowed"
  | "container_answer_field_forbidden"
  | "container_prop_invalid"
  // v2.5 §3.4 canonical headline binding errors
  | "bind_type_mismatch"
  | "duplicate_bind"
  | "bound_node_carries_text"
  // v2.5 §9.4 color-typed override VALUE vocabulary (role name or legacy #hex)
  | "invalid_override_value"
  // v2.5 §3.5/§8.2 WARNING code (emitted into `warnings`, never `errors`)
  | "frame_scope_component"
  // v2.5 11 §11.5 WARNING code (emitted into `warnings`, never `errors`)
  | "duplicate_continue"
  // P4a (register PC-4-behavior / PC-A1) BLOCKING code: continue_mode
  // "auto_advance" on a section whose composition can never reach the engine's
  // single-click advance trigger (see autoAdvanceEligibility) — a stuck funnel.
  | "auto_advance_conflict"
  // v3.1 §11.3 NEW field-content props (label/helper/icon/required/format/
  // error_text/role/source) — shape, enum, and type-restriction violations.
  | "invalid_field_prop"
  // v3.1 §9.2 field-level Maps config shape / type-restriction (ZIP/Address only)
  | "invalid_maps_prop"
  // v3.1 §7.2 design_overrides.size shape / preset-enum / custom_px range
  | "invalid_size_override"
  // P3a (register PC-2 / D1 / R-B) structured placement — node.layout shape /
  // enum / clamp violations, plus the sibling-level row-grouping rules
  // (contiguity, max-3, frame-scope restriction).
  | "invalid_placement"
  // v3.1 §9.3 WARNING code (emitted into `warnings`, never `errors`):
  // maps.enabled with zero jobs selected
  | "maps_no_job"
  // P4c (register PC-12) WARNING code (emitted into `warnings`, never
  // `errors`): continue_mode "button" + a continue_visible_when set — the
  // condition's reachability is not statically provable, so this names the
  // stuck-funnel RISK rather than blocking the save.
  | "continue_visibility_risk";

export interface SectionContentError {
  code: SectionContentErrorCode;
  path: string;
  message: string;
}

export interface SectionContentValidation {
  ok: boolean;
  errors: SectionContentError[];
  // v2.5 08 §8.6 ADDITIVE: non-blocking problems (`frame_scope_component`).
  // `ok` stays keyed to `errors` ONLY — a Section with warnings saves fine
  // (severity escalation to a blocking error happens at Quote
  // publish/activation, 14 §14.1 — outside this validator).
  warnings: SectionContentError[];
}

// ---------------------------------------------------------------------------
// Required-field table (derived from the catalog `props` contract). A prop
// listed WITHOUT a trailing `?` in components/registry.ts is required; this
// table is the curated, exhaustive resolution of that contract per type
// (with the `...RangeQuestion` spread resolved). A new ComponentType added to
// the catalog forces a new row here (compile error otherwise) — keeping the
// content contract and the capability catalog in lockstep.
// ---------------------------------------------------------------------------

// Exported (read-only) so the Section Studio (admin/leadgen/ui-section-studio)
// can PROJECT the same required-field truth into its island bootstrap for the
// live in-editor validation chip — one table, no drift. The server-side
// validateSectionContent below stays the authoritative gate on save.
export interface RequiredSpec {
  internalField?: boolean; // catalog props include "internal_field"
  choices?: boolean; // catalog props include a "choices…" token
  choiceIcon?: boolean; // §14.4: each choice needs an icon
  choiceImage?: boolean; // catalog choices[{imageMediaId,…}]
  textProps?: readonly string[]; // simple required scalar props (in node.props)
  numericProps?: readonly string[]; // required numeric props (in node.props)
}

export const REQUIRED_FIELDS: Record<ComponentType, RequiredSpec> = {
  // chrome
  ProgressBar: {},
  HeaderLogo: { textProps: ["logoMediaId"] },
  BackButton: {},
  DisclosureLink: { textProps: ["panelHtml"] },
  StepIndicator: {}, // props (steps/current) read defensively by the preset

  // affordances (copy)
  CategoryLabel: { textProps: ["text"] },
  QuestionHeadline: { textProps: ["text"] },
  Subheadline: { textProps: ["text"] },
  // range family (§14.5)
  RangeQuestion: { internalField: true, numericProps: ["min", "max"] },
  CurrencyRangeQuestion: { internalField: true, numericProps: ["min", "max"] },
  NumberRangeQuestion: { internalField: true, numericProps: ["min", "max"] },
  // choice questions
  ButtonAnswerGroup: { internalField: true, choices: true },
  TwoButtonYesNo: { internalField: true },
  IconCardAnswerGrid: { internalField: true, choices: true, choiceIcon: true },
  ImageCardAnswerGrid: { internalField: true, choices: true, choiceImage: true },
  MultiChoiceCardGroup: { internalField: true, choices: true },
  // P5 (PC-10): NO single internal_field (each ROW carries its own — like
  // NameFieldsGroup/Address). `choices: true` gates the SHARED pill set through
  // the generic per-choice validation + the studio's existing choices editor;
  // the row structure (1-8 rows, unique/defaulted fields, 2-4 per pill set) is
  // enforced by the dedicated MultiQuestionGrid block in validateNode.
  MultiQuestionGrid: { choices: true },
  DropdownQuestion: { internalField: true, choices: true },
  SearchableDropdownQuestion: { internalField: true, choices: true },
  OtherGroupSelector: { internalField: true, choices: true },
  // free-form + PII inputs
  FreeTextQuestion: { internalField: true },
  NumberInputQuestion: { internalField: true },
  CurrencyInputQuestion: { internalField: true },
  EmailInputQuestion: { internalField: true },
  PhoneInputQuestion: { internalField: true },
  NameFieldsGroup: {}, // uses `fields(first,last)` — no single internal_field
  DateQuestion: { internalField: true },
  ZIPInputQuestion: { internalField: true },
  AddressAutocompleteQuestion: {}, // uses `internal_fields(street,city,state,zip)`
  // controls + remaining affordances
  ContinueButton: {},
  AutoAdvanceButton: {},
  ReassuranceBadge: { textProps: ["text"] },
  SuccessState: {}, // heading/message/icon all optional; preset reads defensively
  SecureFormBadge: {}, // text/icon optional (token exampleCopy fallback)
  TrustBar: {}, // props.items read defensively by the preset
  LogoStrip: {}, // props.logos read defensively by the preset
  HelperText: { textProps: ["text"] },
  ValidationError: {},
  LegalNote: { textProps: ["html"] },
  // v3.1 §5.3 Text/Image primitives: role/source/text/icon/logoMediaId/alt
  // are all OPTIONAL — the renderer applies sensible defaults (role defaults
  // to "heading"; source defaults to "media") exactly like SuccessState/
  // SecureFormBadge above.
  TextBlock: {},
  ImageBlock: {},
  // §8.5 layout containers + layout leaves: every prop is OPTIONAL (presets
  // apply token defaults); when PRESENT it must pass the §8.5 token-enum
  // check (validateContainerProps) — not this generic required-field table.
  Stack: {},
  GridContainer: {},
  Columns: {},
  CardPanel: {},
  BackgroundPanel: {},
  Spacer: {},
  HeaderBar: {},
  FooterBar: {},
};

const CONDITION_OPS: ReadonlySet<string> = new Set<LeadgenConditionOp>([
  "eq",
  "neq",
  "gt",
  "lt",
  "gte",
  "lte",
  "range",
  "in",
  "not_in",
]);

// ---------------------------------------------------------------------------
// §8.5 container prop token enums — TOKEN-VALUED only, no raw CSS. These are
// the AUTHORING vocabulary; each design maps them to measured CSS values in
// its token file (default-funnel/tokens.ts stack/gridContainer/columns/
// cardPanel/backgroundPanel/spacer/headerBar/footerBar groups) and the preset
// resolves the enum → token value at render (components/presets.ts).
// ---------------------------------------------------------------------------

// Shared gap / spacer size scale (xs..xl → the design spacing tokens).
export const LEADGEN_GAP_TOKENS = ["xs", "s", "m", "l", "xl"] as const;
export type LeadgenGapToken = (typeof LEADGEN_GAP_TOKENS)[number];

export const LEADGEN_STACK_DIRECTIONS = ["vertical", "horizontal"] as const;
export const LEADGEN_STACK_ALIGNS = ["start", "center", "end", "stretch"] as const;
export const LEADGEN_GRID_SIZINGS = ["auto", "equal"] as const;
export const LEADGEN_COLUMN_RATIOS = ["50/50", "60/40", "40/60", "70/30"] as const;
export const LEADGEN_COLUMN_MOBILE_MODES = ["stack", "keep"] as const;
export const LEADGEN_PANEL_WIDTHS = ["s", "m", "l", "full"] as const;
export const LEADGEN_PANEL_BACKGROUNDS = ["card", "wash", "ghost", "transparent"] as const;
export const LEADGEN_PANEL_SHADOWS = ["none", "sm", "md", "lg", "xl"] as const;
export const LEADGEN_PANEL_RADII = ["sm", "md", "lg", "xl"] as const;
export const LEADGEN_PANEL_PADDINGS = ["s", "m", "l"] as const;
export const LEADGEN_BG_PANEL_BACKGROUNDS = ["card", "wash", "ghost", "page", "primary"] as const;
export const LEADGEN_BG_PANEL_GRADIENTS = ["primary", "accent", "wash"] as const;
// v2.5 05 §5.5 (A6 placement decision): `image_fit` is a COMPONENT prop on
// ImageCardAnswerGrid (§5.5 lists it among the grid's editor controls; the
// §8.4 per-choice list omits it). Optional; curated enum, never author CSS.
// The preset renderer treats a legacy PER-CHOICE `image_fit` as a defensive
// fallback only (presets.ts renderCardGrid).
export const LEADGEN_IMAGE_FIT_MODES = ["cover", "contain"] as const;
export type LeadgenImageFitMode = (typeof LEADGEN_IMAGE_FIT_MODES)[number];

// v3.1 §5.6 (adversarial review m2): the Spacer leaf's two authoring
// variants — a plain gap (the Layout group's own "Spacer" tile; unchanged,
// default) or a visible center rule (the "Divider" tile). Additive: an
// absent variant behaves EXACTLY as before this field existed.
export const LEADGEN_SPACER_VARIANTS = ["gap", "line"] as const;
export type LeadgenSpacerVariant = (typeof LEADGEN_SPACER_VARIANTS)[number];

const GAP_SET: ReadonlySet<string> = new Set(LEADGEN_GAP_TOKENS);

// A safe, non-executable link target for HeaderBar cta / FooterBar links:
// absolute http(s), site-relative path (NOT protocol-relative //), fragment,
// tel: or mailto:. Anything else (javascript:, data:, //host) is rejected.
const SAFE_HREF_RE = /^(https?:\/\/|\/(?!\/)|#|tel:|mailto:)/i;

interface EnumPropSpec {
  kind: "enum";
  values: readonly string[];
}
interface IntPropSpec {
  kind: "int";
  min: number;
  max: number;
}
interface StringPropSpec {
  kind: "string";
}
interface BooleanPropSpec {
  kind: "boolean";
}
type ContainerPropSpec = EnumPropSpec | IntPropSpec | StringPropSpec | BooleanPropSpec;

const enumSpec = (values: readonly string[]): EnumPropSpec => ({ kind: "enum", values });
const intSpec = (min: number, max: number): IntPropSpec => ({ kind: "int", min, max });

// The per-type §8.5 prop tables (containers + the 3 layout leaves) PLUS the
// A6 ImageCardAnswerGrid `image_fit` component prop (05 §5.5) — the
// non-container walk applies the same optional-prop enum validation for any
// type listed here. cta / trustMessages / links have structured shapes
// checked by dedicated logic in validateContainerProps (not expressible as a
// scalar spec).
const CONTAINER_PROP_SPECS: Record<string, Record<string, ContainerPropSpec>> = {
  // A6 (05 §5.5): optional image fit on the image answer grid — a curated
  // enum resolved by the preset (`object-fit`), absent ⇒ today's markup.
  ImageCardAnswerGrid: {
    image_fit: enumSpec(LEADGEN_IMAGE_FIT_MODES),
  },
  Stack: {
    direction: enumSpec(LEADGEN_STACK_DIRECTIONS),
    gap: enumSpec(LEADGEN_GAP_TOKENS),
    align: enumSpec(LEADGEN_STACK_ALIGNS),
  },
  GridContainer: {
    columnsDesktop: intSpec(2, 5),
    columnsTablet: intSpec(1, 4),
    columnsMobile: intSpec(1, 2),
    gap: enumSpec(LEADGEN_GAP_TOKENS),
    sizing: enumSpec(LEADGEN_GRID_SIZINGS),
  },
  Columns: {
    ratio: enumSpec(LEADGEN_COLUMN_RATIOS),
    mobile: enumSpec(LEADGEN_COLUMN_MOBILE_MODES),
  },
  CardPanel: {
    width: enumSpec(LEADGEN_PANEL_WIDTHS),
    background: enumSpec(LEADGEN_PANEL_BACKGROUNDS),
    shadow: enumSpec(LEADGEN_PANEL_SHADOWS),
    radius: enumSpec(LEADGEN_PANEL_RADII),
    padding: enumSpec(LEADGEN_PANEL_PADDINGS),
  },
  BackgroundPanel: {
    background: enumSpec(LEADGEN_BG_PANEL_BACKGROUNDS),
    gradient: enumSpec(LEADGEN_BG_PANEL_GRADIENTS),
    imageMediaId: { kind: "string" },
  },
  Spacer: {
    size: enumSpec(LEADGEN_GAP_TOKENS),
    // additive (m2): absent ⇒ "gap" (today's byte-identical rendering).
    variant: enumSpec(LEADGEN_SPACER_VARIANTS),
  },
  HeaderBar: {
    logoMediaId: { kind: "string" },
    logoAlt: { kind: "string" },
    back: { kind: "boolean" },
    backLabel: { kind: "string" },
    secure: { kind: "boolean" },
    secureText: { kind: "string" },
    // cta: structured — dedicated check below.
  },
  FooterBar: {
    legalHtml: { kind: "string" },
    // trustMessages / links: structured — dedicated checks below.
  },
};

// §8.5 token-enum validation for a container/layout-leaf node's props. Every
// prop is optional; a PRESENT prop must satisfy its spec — a violation is the
// typed `container_prop_invalid` (path components[i].props.<key>).
function validateContainerProps(
  type: string,
  props: Record<string, unknown>,
  base: string,
  push: (code: SectionContentErrorCode, path: string, message: string) => void,
): void {
  const specs = CONTAINER_PROP_SPECS[type] ?? {};
  for (const [key, spec] of Object.entries(specs)) {
    const value = props[key];
    if (value === undefined) continue;
    const path = `${base}.props.${key}`;
    if (spec.kind === "enum") {
      if (typeof value !== "string" || !spec.values.includes(value)) {
        push(
          "container_prop_invalid",
          path,
          `${type} props.${key} must be one of ${spec.values.join("|")} (§8.5 token enum)`,
        );
      }
    } else if (spec.kind === "int") {
      if (
        typeof value !== "number" ||
        !Number.isInteger(value) ||
        value < spec.min ||
        value > spec.max
      ) {
        push(
          "container_prop_invalid",
          path,
          `${type} props.${key} must be an integer between ${spec.min} and ${spec.max} (§8.5)`,
        );
      }
    } else if (spec.kind === "string") {
      if (typeof value !== "string" || value.trim() === "") {
        push("container_prop_invalid", path, `${type} props.${key} must be a non-empty string`);
      }
    } else if (spec.kind === "boolean") {
      if (typeof value !== "boolean") {
        push("container_prop_invalid", path, `${type} props.${key} must be a boolean`);
      }
    }
  }

  // HeaderBar cta {label, href|tel} (§8.5 "optional CTA (label + tel/href)").
  if (type === "HeaderBar" && props["cta"] !== undefined) {
    const path = `${base}.props.cta`;
    const cta = props["cta"];
    if (!isRecord(cta)) {
      push("container_prop_invalid", path, "HeaderBar props.cta must be an object {label, href|tel}");
    } else {
      if (!isNonEmptyString(cta["label"])) {
        push("container_prop_invalid", `${path}.label`, "HeaderBar cta.label is required");
      }
      const href = cta["href"];
      const tel = cta["tel"];
      if (!isNonEmptyString(href) && !isNonEmptyString(tel)) {
        push("container_prop_invalid", path, "HeaderBar cta requires href or tel");
      }
      if (isNonEmptyString(href) && !SAFE_HREF_RE.test(href.trim())) {
        push(
          "container_prop_invalid",
          `${path}.href`,
          "HeaderBar cta.href must be http(s)/relative/#/tel:/mailto:",
        );
      }
    }
  }

  // FooterBar trustMessages[] (strings) + links[{label, href}] (§8.5).
  if (type === "FooterBar") {
    if (props["trustMessages"] !== undefined) {
      const path = `${base}.props.trustMessages`;
      const raw = props["trustMessages"];
      if (!Array.isArray(raw) || !raw.every((m) => typeof m === "string")) {
        push("container_prop_invalid", path, "FooterBar props.trustMessages must be an array of strings");
      }
    }
    if (props["links"] !== undefined) {
      const raw = props["links"];
      if (!Array.isArray(raw)) {
        push("container_prop_invalid", `${base}.props.links`, "FooterBar props.links must be an array");
      } else {
        raw.forEach((link, li) => {
          const path = `${base}.props.links[${li}]`;
          if (!isRecord(link)) {
            push("container_prop_invalid", path, "each FooterBar link must be an object {label, href}");
            return;
          }
          if (!isNonEmptyString(link["label"])) {
            push("container_prop_invalid", `${path}.label`, "FooterBar link.label is required");
          }
          const href = link["href"];
          if (!isNonEmptyString(href)) {
            push("container_prop_invalid", `${path}.href`, "FooterBar link.href is required");
          } else if (!SAFE_HREF_RE.test(href.trim())) {
            push(
              "container_prop_invalid",
              `${path}.href`,
              "FooterBar link.href must be http(s)/relative/#/tel:/mailto:",
            );
          }
        });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// helpers (listicles validation idiom)
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function isChoicePrimitive(value: unknown): value is string | number | boolean {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

// A design-override VALUE must be a fixed token/scalar, never a CSS string.
// Reject anything carrying CSS-injection punctuation OR the HTML-attribute
// breakout quotes (" ' `) so a value can never escape an inline style="…"
// attribute even if it reaches a renderer (§14.10 no-arbitrary-CSS). This
// regex MUST stay byte-identical to the copy in src/leadgen/sections.ts.
const CSS_ESCAPE_RE = /[;{}<>()"'`\\]|url\(|expression|@import|\/\*/i;
function looksLikeArbitraryCss(value: unknown): boolean {
  return typeof value === "string" && CSS_ESCAPE_RE.test(value);
}

function isKnownComponentType(type: unknown): type is ComponentType {
  return typeof type === "string" && Object.prototype.hasOwnProperty.call(COMPONENT_CATALOG, type);
}

// ---------------------------------------------------------------------------
// v3.1 §7.2 design_overrides.size — {width?, height?} shape validator.
// ---------------------------------------------------------------------------

// `code` is the error code the caller wants for THIS axis (design_overrides.size
// → invalid_size_override; P3a layout.width → invalid_placement) — the width
// VOCABULARY + clamps are shared (§7.2 s/m/l/full or {custom_px} in [200,600]
// snap-4), only the owning error family differs.
function validateSizeAxis(
  value: unknown,
  path: string,
  presetSet: ReadonlySet<string>,
  presetList: readonly string[],
  min: number,
  max: number,
  code: SectionContentErrorCode,
  push: (code: SectionContentErrorCode, path: string, message: string) => void,
): void {
  if (typeof value === "string") {
    if (!presetSet.has(value)) {
      push(
        code,
        path,
        `must be one of ${presetList.join("|")} or {custom_px:number} (§7.2)`,
      );
    }
    return;
  }
  if (isRecord(value)) {
    const keys = Object.keys(value);
    if (keys.length !== 1 || keys[0] !== "custom_px") {
      push(code, path, "a custom size must be exactly {custom_px:number} (§7.2)");
      return;
    }
    const px = value["custom_px"];
    if (typeof px !== "number" || !Number.isFinite(px) || !Number.isInteger(px)) {
      push(code, `${path}.custom_px`, "custom_px must be an integer");
      return;
    }
    if (px < min || px > max) {
      push(
        code,
        `${path}.custom_px`,
        `custom_px must be between ${min} and ${max} (§7.1/§7.2)`,
      );
    } else if (px % SIZE_GRID_PX !== 0) {
      push(
        code,
        `${path}.custom_px`,
        `custom_px must be snapped to a ${SIZE_GRID_PX}px grid (§7.2)`,
      );
    }
    return;
  }
  push(code, path, "must be a preset string or {custom_px:number} (§7.2)");
}

function validateSizeOverride(
  value: unknown,
  path: string,
  push: (code: SectionContentErrorCode, path: string, message: string) => void,
): void {
  if (!isRecord(value)) {
    push("invalid_size_override", path, "design_overrides.size must be an object {width?, height?} (§7.2)");
    return;
  }
  for (const key of Object.keys(value)) {
    if (key !== "width" && key !== "height") {
      push("invalid_size_override", `${path}.${key}`, `unknown size key '${key}' (only width/height, §7.2)`);
    }
  }
  if (value["width"] !== undefined) {
    validateSizeAxis(
      value["width"],
      `${path}.width`,
      SIZE_WIDTH_PRESET_SET,
      LEADGEN_SIZE_WIDTH_PRESETS,
      SIZE_WIDTH_CUSTOM_PX_MIN,
      SIZE_WIDTH_CUSTOM_PX_MAX,
      "invalid_size_override",
      push,
    );
  }
  if (value["height"] !== undefined) {
    validateSizeAxis(
      value["height"],
      `${path}.height`,
      SIZE_HEIGHT_PRESET_SET,
      LEADGEN_SIZE_HEIGHT_PRESETS,
      SIZE_HEIGHT_CUSTOM_PX_MIN,
      SIZE_HEIGHT_CUSTOM_PX_MAX,
      "invalid_size_override",
      push,
    );
  }
}

// ---------------------------------------------------------------------------
// P3a (register PC-2 / D1 / R-B) — node.layout structured-placement validator.
// ---------------------------------------------------------------------------

// The row-id of a node's layout IFF it is a well-shaped id string — else
// undefined. Used by the sibling-level grouping check to group ONLY valid rows
// (a malformed row-id is flagged per-node by validatePlacementLayout; the
// grouping walk skips it rather than double-reporting).
function placementRowIdIfValid(node: unknown): string | undefined {
  if (!isRecord(node)) return undefined;
  const layout = node["layout"];
  if (!isRecord(layout)) return undefined;
  const row = layout["row"];
  return typeof row === "string" && PLACEMENT_ROW_ID_RE.test(row) ? row : undefined;
}

// Per-node shape/enum/clamp checks. `scope` is the catalog scope of the owning
// node — placement is a Section-unit concern, so a frame-scope component may
// not carry it (a NEW field ⇒ rejecting it there breaks no stored content).
// `type` additionally gates LEADGEN_PLACEMENT_EXCLUDED_TYPES (ContinueButton /
// AutoAdvanceButton — their position is Quote-Builder-owned, not free per-node
// placement, regardless of their catalog scope being "unit").
function validatePlacementLayout(
  value: unknown,
  path: string,
  type: ComponentType,
  scope: ComponentScope,
  push: (code: SectionContentErrorCode, path: string, message: string) => void,
): void {
  if (!isRecord(value)) {
    push("invalid_placement", path, "layout must be an object {row?, align?, width?, nudge_x?, nudge_y?} (§R-B/D1)");
    return;
  }
  if (scope === "frame") {
    push(
      "invalid_placement",
      path,
      `${type} is a funnel-frame component — structured placement (layout) is a Section-unit concern and is not allowed on it (§R-B/D1)`,
    );
  }
  if (PLACEMENT_EXCLUDED_TYPE_SET.has(type)) {
    push(
      "invalid_placement",
      path,
      `${type}'s position is owned by the Quote Builder's continue-placement model (§8.5b/§11.5), not by free per-node placement — structured placement (layout) is not allowed on it`,
    );
  }
  for (const key of Object.keys(value)) {
    if (!PLACEMENT_LAYOUT_KEY_SET.has(key)) {
      push(
        "invalid_placement",
        `${path}.${key}`,
        `unknown layout key '${key}' (allowed: ${PLACEMENT_LAYOUT_KEYS.join(", ")})`,
      );
    }
  }
  if (value["row"] !== undefined) {
    const row = value["row"];
    if (typeof row !== "string" || looksLikeArbitraryCss(row) || !PLACEMENT_ROW_ID_RE.test(row)) {
      push(
        "invalid_placement",
        `${path}.row`,
        "layout.row must be a short id token matching [A-Za-z0-9_-], 1-64 chars (a stored id, never CSS)",
      );
    }
  }
  if (value["align"] !== undefined) {
    const align = value["align"];
    if (typeof align !== "string" || !PLACEMENT_ALIGN_SET.has(align)) {
      push(
        "invalid_placement",
        `${path}.align`,
        `layout.align must be one of ${LEADGEN_PLACEMENT_ALIGNS.join("|")}`,
      );
    }
  }
  if (value["width"] !== undefined) {
    // REUSE the §7.2 width axis (same vocabulary + [200,600] snap-4 clamp), only
    // the error family differs (invalid_placement, not invalid_size_override).
    validateSizeAxis(
      value["width"],
      `${path}.width`,
      SIZE_WIDTH_PRESET_SET,
      LEADGEN_SIZE_WIDTH_PRESETS,
      SIZE_WIDTH_CUSTOM_PX_MIN,
      SIZE_WIDTH_CUSTOM_PX_MAX,
      "invalid_placement",
      push,
    );
  }
  for (const axis of ["nudge_x", "nudge_y"] as const) {
    if (value[axis] !== undefined) {
      const n = value[axis];
      if (typeof n !== "number" || !Number.isFinite(n) || !Number.isInteger(n)) {
        push("invalid_placement", `${path}.${axis}`, `layout.${axis} must be an integer number of pixels`);
      } else if (n < PLACEMENT_NUDGE_MIN || n > PLACEMENT_NUDGE_MAX) {
        push(
          "invalid_placement",
          `${path}.${axis}`,
          `layout.${axis} must be between ${PLACEMENT_NUDGE_MIN} and ${PLACEMENT_NUDGE_MAX} px (§R-B bounded escape hatch)`,
        );
      }
    }
  }
}

// Sibling-level grouping rules (§D1 "2-3 slots side by side"). Called once per
// sibling list (root + each container's children). A row-id must name ONE
// CONTIGUOUS run of at most LEADGEN_MAX_ROW_MEMBERS siblings; a non-contiguous
// run (the id reappears after a gap) is unrenderable, and an oversized run is
// outside the 2-3 slot model — both save ERRORs with a clear message.
function validateRowGrouping(
  siblings: readonly unknown[],
  pathAt: (index: number) => string,
  push: (code: SectionContentErrorCode, path: string, message: string) => void,
): void {
  // Per row-id: how many DISTINCT contiguous runs it forms (>1 ⇒ non-contiguous),
  // the LONGEST run (> max ⇒ oversized), and the running current-run length.
  interface RowAcc {
    runCount: number;
    maxLen: number;
    curLen: number;
    firstPath: string;
  }
  const byRow = new Map<string, RowAcc>();
  let prevRow: string | undefined;
  for (let i = 0; i < siblings.length; i++) {
    const row = placementRowIdIfValid(siblings[i]);
    if (row === undefined) {
      prevRow = undefined;
      continue;
    }
    let acc = byRow.get(row);
    if (acc === undefined) {
      acc = { runCount: 0, maxLen: 0, curLen: 0, firstPath: `${pathAt(i)}.layout.row` };
      byRow.set(row, acc);
    }
    if (row === prevRow) {
      acc.curLen += 1;
    } else {
      acc.runCount += 1;
      acc.curLen = 1;
    }
    if (acc.curLen > acc.maxLen) acc.maxLen = acc.curLen;
    prevRow = row;
  }
  for (const [row, acc] of byRow) {
    if (acc.runCount > 1) {
      push(
        "invalid_placement",
        acc.firstPath,
        `row '${row}' members must be contiguous siblings — found ${acc.runCount} separate groups; a non-contiguous row is unrenderable (§D1)`,
      );
    }
    if (acc.maxLen > LEADGEN_MAX_ROW_MEMBERS) {
      push(
        "invalid_placement",
        acc.firstPath,
        `row '${row}' has ${acc.maxLen} members — a row holds at most ${LEADGEN_MAX_ROW_MEMBERS} slots (§D1)`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// P2a §R-A — choice.style bag validator (save-time; mirrors the node-level
// rules exactly). Every field optional; unknown keys rejected; each present
// field checked against the SAME vocabulary/clamps the node-level path uses.
// Reused by the choices loop (per choice) AND TwoButtonYesNo's per-button
// props.yesStyle/noStyle (validateNewFieldProps) — one shape, one gate.
// ---------------------------------------------------------------------------
function validateChoiceStyle(
  value: unknown,
  path: string,
  push: (code: SectionContentErrorCode, path: string, message: string) => void,
): void {
  if (!isRecord(value)) {
    push("invalid_choice_style", path, "choice.style must be an object (§R-A per-element freedom)");
    return;
  }
  for (const key of Object.keys(value)) {
    if (!CHOICE_STYLE_KEY_SET.has(key)) {
      push(
        "invalid_choice_style",
        `${path}.${key}`,
        `unknown choice.style key '${key}' (allowed: ${CHOICE_STYLE_KEYS.join(", ")})`,
      );
    }
  }
  if (value["size"] !== undefined) {
    validateChoiceSize(value["size"], `${path}.size`, push);
  }
  // color_role / color_hex — theme role OR off-theme #hex; never BOTH.
  validateChoiceColorPair(value["color_role"], value["color_hex"], path, "color", push);
  // text_color_role / text_color_hex — same rules for the label color.
  validateChoiceColorPair(value["text_color_role"], value["text_color_hex"], path, "text_color", push);
  if (value["emphasis"] !== undefined) {
    if (typeof value["emphasis"] !== "string" || !CHOICE_EMPHASIS_SET.has(value["emphasis"])) {
      push(
        "invalid_choice_style",
        `${path}.emphasis`,
        `choice.style.emphasis must be one of ${LEADGEN_CHOICE_EMPHASES.join("|")}`,
      );
    }
  }
}

// size axis: a button-size preset (s/m/l) OR {custom_px:int} on the SAME
// [SIZE_HEIGHT_CUSTOM_PX_MIN, SIZE_HEIGHT_CUSTOM_PX_MAX] snap-4 grid the
// node-level HEIGHT axis (validateSizeAxis) enforces. The looksLikeArbitraryCss
// guard fires first on any string-y value (no-op for a real preset name).
function validateChoiceSize(
  value: unknown,
  path: string,
  push: (code: SectionContentErrorCode, path: string, message: string) => void,
): void {
  if (typeof value === "string") {
    if (looksLikeArbitraryCss(value) || !CHOICE_SIZE_PRESET_SET.has(value)) {
      push(
        "invalid_choice_style",
        path,
        `choice.style.size must be one of ${LEADGEN_CHOICE_SIZE_PRESETS.join("|")} or {custom_px:number}`,
      );
    }
    return;
  }
  if (isRecord(value)) {
    const keys = Object.keys(value);
    if (keys.length !== 1 || keys[0] !== "custom_px") {
      push("invalid_choice_style", path, "a custom choice size must be exactly {custom_px:number}");
      return;
    }
    const px = value["custom_px"];
    if (typeof px !== "number" || !Number.isFinite(px) || !Number.isInteger(px)) {
      push("invalid_choice_style", `${path}.custom_px`, "custom_px must be an integer");
    } else if (px < SIZE_HEIGHT_CUSTOM_PX_MIN || px > SIZE_HEIGHT_CUSTOM_PX_MAX) {
      push(
        "invalid_choice_style",
        `${path}.custom_px`,
        `custom_px must be between ${SIZE_HEIGHT_CUSTOM_PX_MIN} and ${SIZE_HEIGHT_CUSTOM_PX_MAX}`,
      );
    } else if (px % SIZE_GRID_PX !== 0) {
      push(
        "invalid_choice_style",
        `${path}.custom_px`,
        `custom_px must be snapped to a ${SIZE_GRID_PX}px grid`,
      );
    }
    return;
  }
  push("invalid_choice_style", path, "choice.style.size must be a preset string or {custom_px:number}");
}

// A color pair (role, hex): role ∈ the 14 theme roles; hex a legacy #hex
// literal (the SAME LEGACY_HEX_RE the node-level color path tolerates) with
// the arbitrary-CSS guard. Setting BOTH is an explicit precedence error — each
// is still shape-checked so the author sees every problem in one save.
function validateChoiceColorPair(
  role: unknown,
  hex: unknown,
  base: string,
  kind: "color" | "text_color",
  push: (code: SectionContentErrorCode, path: string, message: string) => void,
): void {
  const roleKey = kind === "color" ? "color_role" : "text_color_role";
  const hexKey = kind === "color" ? "color_hex" : "text_color_hex";
  if (role !== undefined && hex !== undefined) {
    push(
      "invalid_choice_style",
      `${base}.${hexKey}`,
      `choice.style.${roleKey} and ${hexKey} are mutually exclusive — set exactly one (explicit precedence, never silent)`,
    );
  }
  if (role !== undefined && (typeof role !== "string" || !THEME_ROLE_SET.has(role))) {
    push(
      "invalid_choice_style",
      `${base}.${roleKey}`,
      `choice.style.${roleKey} must be a theme color role (${LEADGEN_THEME_ROLES.join(", ")})`,
    );
  }
  if (hex !== undefined && (typeof hex !== "string" || looksLikeArbitraryCss(hex) || !LEGACY_HEX_RE.test(hex))) {
    push("invalid_choice_style", `${base}.${hexKey}`, `choice.style.${hexKey} must be a #rrggbb hex color`);
  }
}

// ---------------------------------------------------------------------------
// v3.1 §11.3 NEW field-content props + §9.2 Maps config — all OPTIONAL, all
// additive. `type` is the node's already-known-good ComponentType (the caller
// only reaches here past `isKnownComponentType`).
// ---------------------------------------------------------------------------

function validateNewFieldProps(
  type: ComponentType,
  props: Record<string, unknown>,
  base: string,
  push: (code: SectionContentErrorCode, path: string, message: string) => void,
  warn: (code: SectionContentErrorCode, path: string, message: string) => void,
): void {
  // label / helper / error_text (§8.3 Basics/Answer-format groups): plain
  // optional strings, valid on any node (the Content tab reuses them wherever
  // a field selection shows Basics/Answer-format controls).
  // PC-A8: firstHelper/lastHelper are NameFieldsGroup's own PER-FIELD helper
  // lines (presets.ts renderNameFieldsGroup) — same "plain optional string,
  // valid on any node" looseness as the shared `helper` above (dead-but-
  // harmless on any other type, the established convention for this family;
  // contrast firstIcon/lastIcon below, which mirror `icon`'s type-gated shape
  // instead — each new per-field prop mirrors its own single-field analogue).
  for (const key of ["label", "helper", "error_text", "firstHelper", "lastHelper"] as const) {
    const value = props[key];
    if (value !== undefined && typeof value !== "string") {
      push("invalid_field_prop", `${base}.props.${key}`, `props.${key} must be a string (§8.3)`);
    }
  }

  // required (§8.3 Behavior group): NOTE (repo-reality-over-contract,
  // mission-loop doctrine) — §11.3's own JSON illustration nests this inside
  // `props`, but the REPO's existing, fully-wired mechanism is the TOP-LEVEL
  // `node.required` (LeadgenComponentNode.required — read by hydration() and
  // 4+ presets.ts renderers today). Treated as the same erratum class as the
  // §11.5 "name"/`section_name` mismatch: we validate the EXISTING top-level
  // field (previously untyped at runtime) rather than add a second, competing
  // `props.required`.
  if (props["required"] !== undefined) {
    push(
      "invalid_field_prop",
      `${base}.props.required`,
      "required is a top-level node field (node.required), not props.required — the repo's existing, rendered convention (§11.3 nests it under props; this is a contract erratum, see content-schema.ts comment)",
    );
  }

  // Round-4 A-7 (P1b): props.columns — the per-node layout column count for the
  // grid / button-group answer layouts (IconCardAnswerGrid/ImageCardAnswerGrid/
  // ButtonAnswerGroup). A bounded WHOLE number 1..5 — UNIFIED with the renderer
  // clamps AND design_overrides.columns above (one range, both axes). Optional
  // (absent ⇒ the grid's own default); like the other loose props here it is
  // dead-but-harmless on a non-layout node. Before P1b there was NO server
  // range check on props.columns at all, so a stored 0/6/7 was silent
  // stored-vs-rendered drift (the clamp repaired it on render).
  if (props["columns"] !== undefined) {
    const c = props["columns"];
    if (typeof c !== "number" || !Number.isInteger(c) || c < 1 || c > 5) {
      push("invalid_field_prop", `${base}.props.columns`, "Columns must be a whole number from 1 to 5");
    }
  }

  // icon (§8.3/§8.5b leading-icon picker, 12-value enum) — EXCEPT
  // ReassuranceBadge/SecureFormBadge/SuccessState (pre-existing free-form
  // glyph convention, GLYPH_ICON_TYPES above) and the two TextBlock badge
  // roles that carry that SAME convention forward (byte-identical migration
  // fidelity, §5.3).
  if (props["icon"] !== undefined) {
    const role = props["role"];
    const isGlyphIcon =
      GLYPH_ICON_TYPES.has(type) ||
      (type === "TextBlock" && (role === "reassurance" || role === "secure_badge"));
    if (!isGlyphIcon) {
      if (typeof props["icon"] !== "string" || !FIELD_LEADING_ICON_SET.has(props["icon"])) {
        push(
          "invalid_field_prop",
          `${base}.props.icon`,
          `props.icon must be one of ${LEADGEN_FIELD_LEADING_ICONS.join("|")} (§8.5b)`,
        );
      }
    } else if (typeof props["icon"] !== "string") {
      push("invalid_field_prop", `${base}.props.icon`, "props.icon must be a string glyph (pre-existing badge/success-state convention)");
    }
  }

  // format (§5.6 Accept-swap enum, 8 values).
  if (props["format"] !== undefined) {
    if (typeof props["format"] !== "string" || !FIELD_ACCEPT_FORMAT_SET.has(props["format"])) {
      push(
        "invalid_field_prop",
        `${base}.props.format`,
        `props.format must be one of ${LEADGEN_FIELD_ACCEPT_FORMATS.join("|")} (§5.6)`,
      );
    }
  }

  // PC-7/PC-A3 (P4b): props.step is meaningful ONLY on the numeric Accept-swap
  // tiles (Number / Amount). The Accept-swap bug let a stale `step` SURVIVE onto
  // a text/email/phone/ZIP/date/address field when the type changed (the studio
  // now cleans it on swap — setAcceptFormat); this rule is the authoring gate
  // that rejects it for API authors too. Scoped to the Accept-swap family via
  // acceptFormatOfType so it never touches ProgressBar's own props.step
  // (progress-count) or the Range families (which legitimately carry step).
  if (props["step"] !== undefined) {
    const acceptFmt = acceptFormatOfType(type);
    const isNumericField = type === "NumberInputQuestion" || type === "CurrencyInputQuestion";
    if (acceptFmt !== undefined && !isNumericField) {
      push(
        "invalid_field_prop",
        `${base}.props.step`,
        `props.step is only valid on Number/Amount fields (§5.6/§8.6) — a ${acceptFmt} field has no step; remove it (the Accept-swap cleans this automatically)`,
      );
    }
  }

  // PC-5/PC-A5 (P4b): a DateQuestion's min/max are real date BOUNDS — each an
  // ISO date (YYYY-MM-DD) or a dynamic token (today | year_end | +7d | +2w |
  // +1m …). Garbage was saved silently before (and silently disabled the native
  // constraint); now it is rejected with a plain author message. The concrete
  // ISO is resolved server-side at config build (config-dto.resolveDateBound).
  if (type === "DateQuestion") {
    for (const key of ["min", "max"] as const) {
      const v = props[key];
      if (v !== undefined && v !== null && !isDateBound(v)) {
        push(
          "invalid_field_prop",
          `${base}.props.${key}`,
          `props.${key} on a Date field must be a date (YYYY-MM-DD) or a token (today, year_end, +7d, +2w, +1m) — got ${JSON.stringify(v)}`,
        );
      }
    }
  }

  // role — TextBlock only (§5.3/§8.5b).
  if (props["role"] !== undefined) {
    if (type !== "TextBlock") {
      push("invalid_field_prop", `${base}.props.role`, "props.role is only valid on TextBlock (§5.3)");
    }
    if (typeof props["role"] !== "string" || !TEXT_BLOCK_ROLE_SET.has(props["role"])) {
      push(
        "invalid_field_prop",
        `${base}.props.role`,
        `props.role must be one of ${LEADGEN_TEXT_BLOCK_ROLES.join("|")} (§8.5b)`,
      );
    }
  }

  // source — ImageBlock only (§5.3).
  if (props["source"] !== undefined) {
    if (type !== "ImageBlock") {
      push("invalid_field_prop", `${base}.props.source`, "props.source is only valid on ImageBlock (§5.3)");
    }
    if (typeof props["source"] !== "string" || !IMAGE_BLOCK_SOURCE_SET.has(props["source"])) {
      push(
        "invalid_field_prop",
        `${base}.props.source`,
        `props.source must be one of ${LEADGEN_IMAGE_BLOCK_SOURCES.join("|")} (§5.3)`,
      );
    }
  }

  // maps — ZIP/Address only (§9.2).
  if (props["maps"] !== undefined) {
    validateMapsProp(type, props["maps"], `${base}.props.maps`, push, warn);
  }

  // firstIcon/lastIcon (PC-A8) — NameFieldsGroup's own PER-FIELD leading icon
  // (presets.ts renderNameFieldsGroup, fieldLeadingIcon(node, key)). Meaningful
  // ONLY on NameFieldsGroup (mirrors the role/TextBlock and source/ImageBlock
  // gating above); no GLYPH_ICON_TYPES exception — NameFieldsGroup was never
  // in that legacy free-form-glyph set, so it uses the SAME strict §8.5b
  // 12-value enum the shared `icon` prop enforces for every non-glyph type.
  for (const key of ["firstIcon", "lastIcon"] as const) {
    const v = props[key];
    if (v === undefined) continue;
    if (type !== "NameFieldsGroup") {
      push("invalid_field_prop", `${base}.props.${key}`, `props.${key} is only valid on NameFieldsGroup (§8.5b)`);
      continue;
    }
    if (typeof v !== "string" || !FIELD_LEADING_ICON_SET.has(v)) {
      push(
        "invalid_field_prop",
        `${base}.props.${key}`,
        `props.${key} must be one of ${LEADGEN_FIELD_LEADING_ICONS.join("|")} (§8.5b)`,
      );
    }
  }

  // P2a §R-A per-element freedom for TwoButtonYesNo — it is a FIXED boolean
  // pair (produces "boolean"; yesLabel/noLabel props; NO `choices` array), so
  // its two buttons cannot carry `choice.style`. Optional props.yesStyle /
  // props.noStyle (each a LeadgenChoiceStyle) give the pair the SAME
  // per-element freedom via the SAME validator/renderer. Valid ONLY on
  // TwoButtonYesNo (a misplaced one is an invalid_field_prop, matching the
  // role/source precedent above); absent ⇒ byte-identical.
  for (const key of ["yesStyle", "noStyle"] as const) {
    if (props[key] === undefined) continue;
    if (type === "TwoButtonYesNo") {
      validateChoiceStyle(props[key], `${base}.props.${key}`, push);
    } else {
      push("invalid_field_prop", `${base}.props.${key}`, `props.${key} is only valid on TwoButtonYesNo (§R-A)`);
    }
  }
}

function validateMapsProp(
  type: ComponentType,
  value: unknown,
  path: string,
  push: (code: SectionContentErrorCode, path: string, message: string) => void,
  warn: (code: SectionContentErrorCode, path: string, message: string) => void,
): void {
  if (!MAPS_ELIGIBLE_TYPES.has(type)) {
    push("invalid_maps_prop", path, "props.maps is only valid on ZIPInputQuestion/AddressAutocompleteQuestion (§9)");
  }
  if (!isRecord(value)) {
    push("invalid_maps_prop", path, "props.maps must be an object (§9.2, or the pre-existing §8.8 shape)");
    return;
  }
  // Conductor fix-round correction: a PRE-EXISTING, already-shipped §8.8
  // Maps config (ui-section-studio.ts inspector "Maps" tab — grep-verified
  // live: data-maps-flag="enable_autocomplete"/"validate_zip"/
  // "validate_full_address"/"normalize_address_line" + data-maps-fill=
  // "autofill_state"/"autofill_city"/"autofill_zip", with its own
  // comprehensive test coverage in leadgen-section-studio-ui.test.ts) ALREADY
  // authors this SAME `props.maps` key with a FLAT, DIFFERENT vocabulary —
  // not the §9.2 NESTED {enabled,jobs} shape this contract adds. presets.ts's
  // mapsConfigJson already serializes props.maps VERBATIM regardless of
  // shape (shape-agnostic at render time); this validator must stay equally
  // agnostic for it — the §9.2 shape is ADDITIVE, not a replacement, so a
  // value WITHOUT the `jobs` key (the one marker unique to the new shape) is
  // the legacy shape and is validated ONLY as "a record" — no existing
  // content_json may regress.
  if (!("jobs" in value)) return;
  // R4b (S3-7): `fills` is an OPTIONAL third key alongside enabled/jobs — the
  // sibling-fill targets the Maps-tab picker authors (props.maps.fills.<slot>).
  const extraKeys = Object.keys(value).filter((k) => k !== "enabled" && k !== "jobs" && k !== "fills");
  for (const key of extraKeys) {
    push("invalid_maps_prop", `${path}.${key}`, `unknown maps key '${key}' (only enabled/jobs/fills, §9.2)`);
  }
  const enabled = value["enabled"];
  if (typeof enabled !== "boolean") {
    push("invalid_maps_prop", `${path}.enabled`, "props.maps.enabled must be a boolean (§9.2)");
  }
  const jobs = value["jobs"];
  if (!isRecord(jobs)) {
    push("invalid_maps_prop", `${path}.jobs`, "props.maps.jobs must be an object {validate, auction, autocomplete} (§9.2)");
    return;
  }
  const jobExtraKeys = Object.keys(jobs).filter(
    (k) => k !== "validate" && k !== "auction" && k !== "autocomplete",
  );
  for (const key of jobExtraKeys) {
    push("invalid_maps_prop", `${path}.jobs.${key}`, `unknown maps job '${key}' (only validate/auction/autocomplete, §9.2)`);
  }
  let anyJobTrue = false;
  for (const key of ["validate", "auction", "autocomplete"] as const) {
    const jobValue = jobs[key];
    if (jobValue !== undefined) {
      if (typeof jobValue !== "boolean") {
        push("invalid_maps_prop", `${path}.jobs.${key}`, `props.maps.jobs.${key} must be a boolean (§9.2)`);
      } else if (jobValue) {
        anyJobTrue = true;
      }
    }
  }
  // §9.3: "Save with maps.enabled and zero jobs -> problems[] warning
  // maps_no_job (path-precise)" — non-blocking (the builder shows the amber
  // banner; escalation to a blocking error is an activation-preflight concern,
  // outside this validator, matching the frame_scope_component/
  // duplicate_continue precedent).
  if (enabled === true && !anyJobTrue) {
    warn(
      "maps_no_job",
      path,
      "maps.enabled is true but no job (validate/auction/autocomplete) is selected — it does nothing at runtime (§9.3)",
    );
  }
  // R4b (S3-7): validate the OPTIONAL sibling-fill targets, when authored.
  if (value["fills"] !== undefined) {
    validateMapsFills(value["fills"], `${path}.fills`, push);
  }
}

// R4b (S3-7) — the four sibling-fill slots, mirroring runtime/maps.ts
// parseMapsConfig's nested `fills` reader EXACTLY (the parity source): each
// slot is OPTIONAL, and — when present — must be a non-empty string (the
// target internal_field). No dangling-target validation is performed here
// (whether that internal_field still exists elsewhere in the Section): a
// stale/removed target is a runtime NO-OP by design (runtime/maps.ts's
// autofill simply finds no matching DOM field and skips it), and the
// Maps-tab picker only ever OFFERS the Section's own other internal_field
// values in the first place — a dangling value can only arise if a field is
// deleted AFTER being chosen as a fill target, which this validator
// deliberately does not chase (matching the legacy flat-shape autofill_*
// keys, which have never been target-validated either).
const MAPS_FILL_SLOTS = ["street", "city", "state", "zip"] as const;

function validateMapsFills(
  value: unknown,
  path: string,
  push: (code: SectionContentErrorCode, path: string, message: string) => void,
): void {
  if (!isRecord(value)) {
    push("invalid_maps_prop", path, "props.maps.fills must be an object {street?,city?,state?,zip?} (§9.2)");
    return;
  }
  const slotSet: ReadonlySet<string> = new Set(MAPS_FILL_SLOTS);
  const extraKeys = Object.keys(value).filter((k) => !slotSet.has(k));
  for (const key of extraKeys) {
    push("invalid_maps_prop", `${path}.${key}`, `unknown maps fill slot '${key}' (only street/city/state/zip, §9.2)`);
  }
  for (const slot of MAPS_FILL_SLOTS) {
    const v = value[slot];
    if (v !== undefined && (typeof v !== "string" || v === "")) {
      push("invalid_maps_prop", `${path}.${slot}`, `props.maps.fills.${slot} must be a non-empty string (§9.2)`);
    }
  }
}

// ---------------------------------------------------------------------------
// v3.1 §5.3 retired-type -> primitive mapping utils (studio save-time, a
// LATER phase wires the call site — these are pure and unused by this phase's
// runtime). Cover: CategoryLabel, HelperText, LegalNote, ReassuranceBadge,
// SecureFormBadge, LogoStrip -> ImageBlock(auto logo).
//
// NOT covered (by design, §5.3 exclusions):
//   - QuestionHeadline / Subheadline: these are BOUND-headline nodes (§3.4
//     `bind`/BIND_EXPECTED_TYPE above) — a wholly separate mechanism, edited
//     via the Question strip (§4.2) and inline on canvas, never palette tiles
//     post-v3.1 (§5.4). Their type/renderer/handling is UNCHANGED and they
//     are deliberately absent from this retirement table.
//   - SuccessState: explicitly OUT of the unit palette (§5.3 "Not a palette
//     tile — a section-level completion state... out of the unit palette").
//     Its catalog entry, REQUIRED_FIELDS row, and renderSuccessState are all
//     UNCHANGED/untouched; it is not a "retired" type, so it is absent here.
//
// LOSSY EDGE (flagged): a LogoStrip authored with >1 `props.logos` entry can
// only become ONE auto-site-logo ImageBlock — entries beyond the first are
// dropped by the rewrite. §5.3 frames LogoStrip's retirement target as a
// single "Auto site logo", so this is the contract's own simplification, not
// an implementation shortcut — flagged here for product/adversarial-review
// awareness since multi-logo content is a real, plausible existing case.
export interface LeadgenPrimitiveView {
  type: "TextBlock" | "ImageBlock";
  role?: LeadgenTextBlockRole;
  source?: LeadgenImageBlockSource;
}

const RETIRED_TEXT_ROLE_BY_TYPE: Partial<Record<ComponentType, LeadgenTextBlockRole>> = {
  CategoryLabel: "category_label",
  HelperText: "helper",
  LegalNote: "legal",
  ReassuranceBadge: "reassurance",
  SecureFormBadge: "secure_badge",
};

// The primitive+role/source a retired node maps to, or null when `node` is
// not a retired one-off type (every other node, including TextBlock/
// ImageBlock themselves, QuestionHeadline/Subheadline, and SuccessState).
export function primitiveViewOfNode(node: LeadgenComponentNode): LeadgenPrimitiveView | null {
  if (node.type === "LogoStrip") {
    return { type: "ImageBlock", source: "auto_logo" };
  }
  const role = RETIRED_TEXT_ROLE_BY_TYPE[node.type];
  if (role !== undefined) {
    return { type: "TextBlock", role };
  }
  return null;
}

// PURE rewrite of a retired one-off node into its primitive form (§5.3 "Save
// rewrites the node to the primitive form"). Non-retired nodes (incl. a
// `null` primitiveView) pass through UNCHANGED (same object identity) — the
// studio's save-time call site (a later phase) can call this unconditionally
// on every node without special-casing "is this retired". LegalNote's
// content lives under `props.html` (legacy key); every other retired text
// type already uses `props.text` — both map to the new node's `props.text`
// (both keys render through the identical `esc()` escaping today, so no
// content shape actually changes).
export function rewriteRetiredNodeToPrimitive(node: LeadgenComponentNode): LeadgenComponentNode {
  const view = primitiveViewOfNode(node);
  if (view === null) return node;
  if (view.type === "TextBlock") {
    const text = view.role === "legal" ? node.props?.["html"] : node.props?.["text"];
    const icon = node.props?.["icon"];
    const newProps: Record<string, unknown> = { role: view.role };
    if (typeof text === "string") newProps.text = text;
    if (typeof icon === "string" && icon !== "") newProps.icon = icon;
    return { ...node, type: "TextBlock", props: newProps };
  }
  // ImageBlock (LogoStrip -> auto site logo). See the LOSSY EDGE note above.
  return { ...node, type: "ImageBlock", props: { source: "auto_logo" } };
}

// ---------------------------------------------------------------------------
// validateSectionContent
// ---------------------------------------------------------------------------

// Validate a Section's parsed `content_json`. I/O-free; returns every problem
// found (never throws). `ok` is true iff `errors` is empty. The ONE input
// mutation it makes is the Round-4 R4-34 orphan-MQG-shared-choice prune (see
// the MultiQuestionGrid block below) — a no-op for every well-formed grid.
//
// §8.5 tree shape: the walk is RECURSIVE over container children with the
// SAME per-node checks at every level; nested paths follow the
// `components[i].children[j].…` convention. Uniqueness (question_id /
// question_key / internal_field) and the conditional known-field universe
// span the WHOLE tree (containers' own question_ids included). A flat array
// (zero containers) takes exactly the pre-§8.5 code path node-for-node.
export function validateSectionContent(
  content: unknown,
  // P4a (PC-A1): the section's continue_mode (SECTION-level, not in
  // content_json). Omitted ⇒ no auto_advance check (every legacy call site that
  // passes only `content` behaves byte-identically). Supplied "auto_advance"
  // triggers the composition-eligibility gate below.
  continueMode?: LeadgenContinueMode,
): SectionContentValidation {
  const errors: SectionContentError[] = [];
  const warnings: SectionContentError[] = [];
  const push = (code: SectionContentErrorCode, path: string, message: string): void => {
    errors.push({ code, path, message });
  };
  // §8.6 warnings channel: same {code, path, message} shape, NEVER affects `ok`.
  const warn = (code: SectionContentErrorCode, path: string, message: string): void => {
    warnings.push({ code, path, message });
  };

  if (!isRecord(content)) {
    push("content_not_object", "content", "content_json must be a JSON object");
    return { ok: false, errors, warnings };
  }
  const rawComponents = content["components"];
  if (!Array.isArray(rawComponents)) {
    push("components_not_array", "components", "content_json.components must be an array");
    return { ok: false, errors, warnings };
  }
  if (rawComponents.length === 0) {
    push("components_empty", "components", "a Section requires at least one component");
    return { ok: false, errors, warnings };
  }

  // Pass 1: collect the known-field universe (internal_field / question_key /
  // question_id) ACROSS THE WHOLE TREE so conditionals can be checked against
  // it order- and level-independently (§8.5: a conditional may reference a
  // field defined inside a sibling container). Depth-capped like every other
  // walk (terminates on cyclic non-JSON input).
  const knownFields = new Set<string>();
  const collectKnownFields = (nodes: readonly unknown[], depth: number): void => {
    for (const raw of nodes) {
      if (!isRecord(raw)) continue;
      for (const key of ["internal_field", "question_key", "question_id"] as const) {
        const v = raw[key];
        if (isNonEmptyString(v)) knownFields.add(v);
      }
      // P5 (PC-10): a MultiQuestionGrid carries no single internal_field — its
      // rows' internal_fields are the real answer names, so register each so a
      // conditional (this section or a sibling) may reference a row by field.
      if (raw["type"] === "MultiQuestionGrid") {
        for (const row of readMultiQuestionRows(raw as unknown as LeadgenComponentNode)) {
          knownFields.add(row.internal_field);
        }
      }
      // Round-4 A-4 (P1b — P1a seam #1): the two MULTI-SUBFIELD question types
      // carry NO single internal_field, yet each sub-field IS a real answer a
      // rule can reference. Register them so a saved conditional whose `when`
      // names an Address role or a Name field passes validateConditional (no
      // conditional_unknown_field 400). The derivation MATCHES P1a's studio-side
      // internalFieldsOf/refFieldInfo EXACTLY (ui-section-studio.ts, commit
      // ababbe9): a configured props.maps.fills.<slot> wins, else the node is
      // namespaced `${internal_field || question_id || 'address'}_<slot>` — P1a
      // default-seeds an Address's internal_field to 'address', so its four roles
      // default to address_street/_city/_state/_zip.
      if (raw["type"] === "AddressAutocompleteQuestion") {
        const ifRaw = raw["internal_field"];
        const base =
          typeof ifRaw === "string" && ifRaw.trim() !== ""
            ? ifRaw.trim()
            : isNonEmptyString(raw["question_id"])
              ? raw["question_id"]
              : "address";
        const aProps = isRecord(raw["props"]) ? raw["props"] : {};
        const aMaps = isRecord(aProps["maps"]) ? aProps["maps"] : {};
        const aFills = isRecord(aMaps["fills"]) ? aMaps["fills"] : {};
        for (const slot of ["street", "city", "state", "zip"] as const) {
          const f = aFills[slot];
          knownFields.add(typeof f === "string" && f.trim() !== "" ? f.trim() : `${base}_${slot}`);
        }
      }
      if (raw["type"] === "NameFieldsGroup") {
        const nProps = isRecord(raw["props"]) ? raw["props"] : {};
        const nFields = Array.isArray(nProps["fields"]) ? nProps["fields"] : [];
        const first = typeof nFields[0] === "string" && nFields[0].trim() !== "" ? nFields[0].trim() : "first";
        const last = typeof nFields[1] === "string" && nFields[1].trim() !== "" ? nFields[1].trim() : "last";
        knownFields.add(first);
        knownFields.add(last);
      }
      if (
        isLayoutContainerType(raw["type"]) &&
        depth <= LEADGEN_MAX_CONTAINER_DEPTH &&
        Array.isArray(raw["children"])
      ) {
        collectKnownFields(raw["children"], depth + 1);
      }
    }
  };
  collectKnownFields(rawComponents, 1);

  const seenQuestionIds = new Set<string>();
  const seenQuestionKeys = new Set<string>();
  const seenInternalFields = new Set<string>();
  // §3.4: each bind VALUE may be claimed at most once per Section, whole tree.
  const seenBinds = new Set<string>();
  // 11 §11.5: ContinueButton nodes counted across the whole tree (warning).
  let continueCount = 0;

  // Pass 2: per-node validation, recursive over container children.
  const validateNode = (raw: unknown, base: string, depth: number): void => {
    if (!isRecord(raw)) {
      push("node_not_object", base, "each component must be a JSON object");
      return;
    }

    // type ∈ catalog (registry closing contract: a component NOT in the
    // catalog cannot be placed).
    const type = raw["type"];
    if (!isKnownComponentType(type)) {
      push(
        "unknown_component_type",
        `${base}.type`,
        `unknown component type ${JSON.stringify(type)} — not in the component catalog`,
      );
      return; // no further per-type checks possible without a known type
    }
    const spec = REQUIRED_FIELDS[type];
    const catalog = COMPONENT_CATALOG[type];
    const isContainer = isLayoutContainerType(type);

    // question_id: required + unique across the whole tree.
    const questionId = raw["question_id"];
    if (!isNonEmptyString(questionId)) {
      push("missing_question_id", `${base}.question_id`, "question_id is required (stable id)");
    } else if (seenQuestionIds.has(questionId)) {
      push("duplicate_question_id", `${base}.question_id`, `duplicate question_id '${questionId}'`);
    } else {
      seenQuestionIds.add(questionId);
    }

    // question_key: unique when present (whole tree).
    const questionKey = raw["question_key"];
    if (questionKey !== undefined) {
      if (!isNonEmptyString(questionKey)) {
        push("missing_required_field", `${base}.question_key`, "question_key must be a non-empty string");
      } else if (seenQuestionKeys.has(questionKey)) {
        push("duplicate_question_key", `${base}.question_key`, `duplicate question_key '${questionKey}'`);
      } else {
        seenQuestionKeys.add(questionKey);
      }
    }

    const props = isRecord(raw["props"]) ? raw["props"] : {};

    // P4c (register PC-12): props.requiredWhen — mirrors node.conditional's
    // validateConditional call EXACTLY (same shape check + same known-field
    // universe), closing the gap the studio's own client-side advisory
    // already flagged (a require-if pointing at a field that no longer
    // exists previously saved silently — the server now names it a typed
    // 400, `conditional_unknown_field`, same code as the show-if mirror).
    // Runs for every node (container or leaf) — harmless on a container,
    // exactly like conditional above.
    if (props["requiredWhen"] !== undefined) {
      validateConditional(props["requiredWhen"], `${base}.props.requiredWhen`, knownFields, push);
    }

    // §3.5/§8.2 frame-scope component inside a Section: legal in stored
    // content (legacy renders unchanged) — path-precise save-time WARNING,
    // never a blocking error here. Applies at every tree level (HeaderBar /
    // FooterBar layout leaves, the BackgroundPanel container, chrome types).
    if (catalog.scope === "frame") {
      warn(
        "frame_scope_component",
        base,
        `${type} is a funnel-layout component (§8.2 scope "frame") — it belongs to the funnel layout in the Quote Builder, not a Section unit`,
      );
    }

    // 11 §11.5 duplicate Continue buttons: the SECOND+ ContinueButton anywhere
    // in the tree gets a path-precise save-time WARNING (§11.5 mandates the
    // save-time surface; only the first Continue renders/wires). `ok` is
    // unaffected. The activation-PREFLIGHT row stays frame-gated per 14 §14.4
    // (activating untouched legacy quotes yields zero new problems) — a SAVE
    // is an operator action on this Section, so warning here is
    // §14.4-compatible.
    if (type === "ContinueButton") {
      continueCount += 1;
      if (continueCount > 1) {
        warn(
          "duplicate_continue",
          base,
          "this Section has more than one Continue button — only the first is shown (§11.5)",
        );
      }
    }

    // §3.4 canonical headline binding. Checked for EVERY known-typed node
    // (a container claiming a bind is a type mismatch like any other node).
    const bindRaw = raw["bind"];
    let boundHere = false; // valid bind on the matching type → props.text is Section-column-resolved
    if (bindRaw !== undefined) {
      if (typeof bindRaw !== "string" || !BIND_SET.has(bindRaw)) {
        push(
          "bind_type_mismatch",
          `${base}.bind`,
          `bind must be one of ${LEADGEN_COMPONENT_BINDS.join("|")} (§3.4)`,
        );
      } else {
        const bind = bindRaw as LeadgenComponentBind;
        const expected = BIND_EXPECTED_TYPE[bind];
        if (seenBinds.has(bind)) {
          push(
            "duplicate_bind",
            `${base}.bind`,
            `duplicate bind '${bind}' — at most one node per bind value per Section (§3.4)`,
          );
        } else {
          seenBinds.add(bind);
        }
        if (type !== expected) {
          push(
            "bind_type_mismatch",
            `${base}.bind`,
            `bind '${bind}' is only legal on type ${expected} (§3.4)`,
          );
        } else {
          boundHere = true;
          if (props["text"] !== undefined) {
            push(
              "bound_node_carries_text",
              `${base}.props.text`,
              `a bound ${type} must not carry props.text — its text is the Section column, resolved at render (§3.4)`,
            );
          }
        }
      }
    }

    // P3a (register PC-2 / D1 / R-B) — structured placement. Validated for
    // EVERY known-typed node (leaves AND containers can be row members / carry
    // align/width/nudge); the sibling-level grouping rules (contiguity, max-3)
    // are checked once per sibling list by validateRowGrouping. Absent layout ⇒
    // no-op (byte-identical pre-P3a). Checked here — ahead of the container
    // early-return below — so a container node's own layout is covered too.
    if (raw["layout"] !== undefined) {
      validatePlacementLayout(raw["layout"], `${base}.layout`, type, catalog.scope, push);
    }

    if (isContainer) {
      // §8.5 container node: depth cap, no answer fields, token-enum props,
      // recursive children. Depth counts CONTAINER nesting levels (root = 1);
      // past the cap we stop descending — which also terminates any cyclic
      // (non-JSON) object graph ("containers cannot contain themselves").
      if (depth > LEADGEN_MAX_CONTAINER_DEPTH) {
        push(
          "container_depth_exceeded",
          base,
          `container nesting exceeds the §8.5 maximum depth of ${LEADGEN_MAX_CONTAINER_DEPTH}`,
        );
        return;
      }

      // Containers carry NO answer fields (§8.5): they produce nothing.
      for (const key of ["internal_field", "choices", "answer_type"] as const) {
        if (raw[key] !== undefined) {
          push(
            "container_answer_field_forbidden",
            `${base}.${key}`,
            `${type} is a layout container — ${key} is not allowed on it (§8.5)`,
          );
        }
      }

      // Token-enum props (§8.5 table) — typed container_prop_invalid.
      validateContainerProps(type, props, base, push);

      // conditional on a container: validated for SHAPE + known field like
      // any node (harmless if authored; visibility logic runs on the
      // flattened leaves, so it has no runtime effect today).
      if (raw["conditional"] !== undefined) {
        validateConditional(raw["conditional"], `${base}.conditional`, knownFields, push);
      }

      // children: optional; when present must be an array; each child is
      // validated with the SAME rules at depth + 1 under the
      // `components[i].children[j]` path convention.
      const children = raw["children"];
      if (children !== undefined) {
        if (!Array.isArray(children)) {
          push(
            "container_prop_invalid",
            `${base}.children`,
            `${type} children must be an array of component nodes`,
          );
        } else {
          for (let j = 0; j < children.length; j++) {
            validateNode(children[j], `${base}.children[${j}]`, depth + 1);
          }
          // P3a: row-grouping (contiguity + max-3) over THIS child sibling list.
          validateRowGrouping(children, (j) => `${base}.children[${j}]`, push);
        }
      }
      return;
    }

    // Non-container node: children are forbidden (§8.5 "children only on the
    // 5 container types").
    if (raw["children"] !== undefined) {
      push(
        "children_not_allowed",
        `${base}.children`,
        `${type} is not a layout container — children are not allowed on it (§8.5)`,
      );
    }

    // §8.5 layout LEAVES (Spacer / HeaderBar / FooterBar) + the A6
    // ImageCardAnswerGrid `image_fit` component prop (05 §5.5): their typed
    // scalar props are enum-validated exactly like container props.
    if (Object.prototype.hasOwnProperty.call(CONTAINER_PROP_SPECS, type)) {
      validateContainerProps(type, props, base, push);
    }

    // internal_field: unique across the whole tree when present — scoped to
    // ANSWER-PRODUCING components only (§8.5 "QUESTION components must remain
    // unique by internal_field"). Non-producing nodes (ValidationError,
    // HelperText, …) legitimately REFERENCE a question's internal_field —
    // e.g. a ValidationError carries it as the error-slot binding
    // (data-lg-error-for) — without claiming the answer name, so they never
    // join (or collide with) the uniqueness universe.
    const internalField = raw["internal_field"];
    if (isNonEmptyString(internalField) && catalog.produces !== null) {
      if (seenInternalFields.has(internalField)) {
        push(
          "duplicate_internal_field",
          `${base}.internal_field`,
          `duplicate internal_field '${internalField}' (§8.5 unique across the Section)`,
        );
      } else {
        seenInternalFields.add(internalField);
      }
    }

    // required authorable fields per the catalog entry.
    if (spec.internalField === true && !isNonEmptyString(raw["internal_field"])) {
      push(
        "missing_required_field",
        `${base}.internal_field`,
        `${type} requires internal_field (normalized answer name)`,
      );
    }
    for (const key of spec.textProps ?? []) {
      // §3.4: a BOUND QuestionHeadline/Subheadline must NOT carry props.text —
      // its text is the Section headline/subheadline column, so the legacy
      // required-text rule is waived for it (presence is the error instead).
      if (boundHere && key === "text") continue;
      if (!isNonEmptyString(props[key])) {
        push("missing_required_field", `${base}.props.${key}`, `${type} requires props.${key}`);
      }
    }
    for (const key of spec.numericProps ?? []) {
      if (typeof props[key] !== "number" || !Number.isFinite(props[key])) {
        push("missing_required_field", `${base}.props.${key}`, `${type} requires numeric props.${key}`);
      }
    }

    // choices (§13.1 per-choice value/analytics_id; §14.4 per-choice icon).
    if (spec.choices === true) {
      const choices = raw["choices"];
      if (!Array.isArray(choices) || choices.length === 0) {
        push("invalid_choice", `${base}.choices`, `${type} requires a non-empty choices array`);
      } else {
        for (let c = 0; c < choices.length; c++) {
          const cp = `${base}.choices[${c}]`;
          const choice = choices[c];
          if (!isRecord(choice)) {
            push("invalid_choice", cp, "each choice must be an object");
            continue;
          }
          if (!isNonEmptyString(choice["label"])) {
            push("invalid_choice", `${cp}.label`, "choice.label is required");
          }
          if (!isChoicePrimitive(choice["value"])) {
            push("invalid_choice", `${cp}.value`, "choice.value must be a string, number, or boolean");
          }
          if (!isNonEmptyString(choice["analytics_id"])) {
            push("invalid_choice", `${cp}.analytics_id`, "choice.analytics_id is required (§22 tracking)");
          }
          if (spec.choiceIcon === true && !isNonEmptyString(choice["icon"])) {
            push("invalid_choice", `${cp}.icon`, `${type} requires a per-choice icon (§14.4)`);
          }
          if (spec.choiceImage === true && !isNonEmptyString(choice["imageMediaId"])) {
            push("invalid_choice", `${cp}.imageMediaId`, `${type} requires a per-choice imageMediaId`);
          }
          // v2.5 §8.4 additive per-choice fields — typed when present.
          for (const key of ["title", "subtitle", "badge", "emoji", "image_alt", "aria_label"] as const) {
            if (choice[key] !== undefined && typeof choice[key] !== "string") {
              push("invalid_choice", `${cp}.${key}`, `choice.${key} must be a string (§8.4)`);
            }
          }
          if (choice["disabled"] !== undefined && typeof choice["disabled"] !== "boolean") {
            push("invalid_choice", `${cp}.disabled`, "choice.disabled must be a boolean (§8.4)");
          }
          // §8.4: emoji and icon are mutually exclusive per choice.
          if (isNonEmptyString(choice["emoji"]) && isNonEmptyString(choice["icon"])) {
            push(
              "invalid_choice",
              `${cp}.emoji`,
              "choice.emoji and choice.icon are mutually exclusive (§8.4)",
            );
          }
          // §8.4: image_alt is REQUIRED when imageMediaId is present on an
          // ImageCardAnswerGrid choice (accessible name for the image card).
          if (
            type === "ImageCardAnswerGrid" &&
            isNonEmptyString(choice["imageMediaId"]) &&
            !isNonEmptyString(choice["image_alt"])
          ) {
            push(
              "invalid_choice",
              `${cp}.image_alt`,
              "image_alt is required when imageMediaId is present (§8.4)",
            );
          }
          // P2a §R-A per-element theme freedom — the OPTIONAL per-choice style
          // bag (additive; absent ⇒ pre-P2a). Consumed by the 5 button/card
          // families (presets.ts choiceItemStyle); a dropdown choice may carry
          // a valid shape too (validated here) — the <option> renderer simply
          // does not consume it.
          if (choice["style"] !== undefined) {
            validateChoiceStyle(choice["style"], `${cp}.style`, push);
          }
        }
      }
    }

    // P5 (PC-10) — MultiQuestionGrid rows. The SHARED pill set (node.choices) is
    // already shape-checked by the generic `spec.choices` block above; here we
    // BOUND it (2-4) and validate the ROW structure: 1-8 rows, each a labeled,
    // uniquely-named field with an optional default (∈ its effective choices)
    // and optional per-row pill override. Each row's internal_field JOINS the
    // Section-wide uniqueness universe (duplicate_internal_field), so a row can
    // never shadow another question's answer name.
    if (type === "MultiQuestionGrid") {
      let sharedChoices: unknown[] = Array.isArray(raw["choices"]) ? raw["choices"] : [];
      // Round-4 A-3 / B-4.1 (P1b, register R4-34) — KILL the MQG save trap. The
      // legacy "+ Add choice" ghost pushed blank options into the SHARED pill
      // set past its 2-4 bound, so a corrupted grid 400'd on save and NEVER
      // persisted (the operator's unexplained error). P1a stopped the studio
      // from growing them; this leg makes ALREADY-corrupted content saveable by
      // pruning ORPHAN shared choices — those beyond the pill bound that no row
      // references — IN PLACE. The save handler stringifies THIS validated
      // object (leadgen/sections.ts persists parsedContent.content post-verdict),
      // so the prune persists: the corruption is cleaned, not merely tolerated.
      // A no-op for every valid grid (fires ONLY when the shared set already
      // exceeds MAX), so no well-formed content ever changes.
      if (sharedChoices.length > MULTI_QUESTION_MAX_CHOICES) {
        // A shared pill is REFERENCED when a row that draws on the shared set
        // (no per-row `choices` override) pre-selects it via `default`; a
        // referenced pill is never pruned (that would invalidate the row's
        // default). Order is preserved; only unreferenced excess is dropped.
        const referenced = new Set<string>();
        for (const row of readMultiQuestionRows(raw as unknown as LeadgenComponentNode)) {
          if (!(Array.isArray(row.choices) && row.choices.length > 0) && row.default !== undefined) {
            referenced.add(String(row.default));
          }
        }
        const isRef = (c: unknown): boolean =>
          isRecord(c) && isChoicePrimitive(c["value"]) && referenced.has(String(c["value"]));
        const unrefBudget = Math.max(0, MULTI_QUESTION_MAX_CHOICES - sharedChoices.filter(isRef).length);
        let unrefUsed = 0;
        const kept: unknown[] = [];
        for (const c of sharedChoices) {
          if (isRef(c)) {
            kept.push(c);
          } else if (unrefUsed < unrefBudget) {
            kept.push(c);
            unrefUsed++;
          }
        }
        if (kept.length < sharedChoices.length) {
          raw["choices"] = kept;
          sharedChoices = kept;
        }
      }
      // The bound still guards the pruned set: a grid with too FEW pills (or the
      // pathological "more referenced defaults than the bound" case) still
      // fails — but with a PLAIN-language message an author can act on, never
      // the raw pill-set jargon.
      if (
        sharedChoices.length > 0 &&
        (sharedChoices.length < MULTI_QUESTION_MIN_CHOICES ||
          sharedChoices.length > MULTI_QUESTION_MAX_CHOICES)
      ) {
        push(
          "invalid_choice",
          `${base}.choices`,
          `A question grid's shared answers must be ${MULTI_QUESTION_MIN_CHOICES}-${MULTI_QUESTION_MAX_CHOICES} — remove extras in the rows editor`,
        );
      }
      const sharedValues = new Set<string>(
        sharedChoices
          .filter(isRecord)
          .map((c) => c["value"])
          .filter(isChoicePrimitive)
          .map((v) => String(v)),
      );
      const rows = props["rows"];
      if (!Array.isArray(rows) || rows.length === 0) {
        push("invalid_field_prop", `${base}.props.rows`, "MultiQuestionGrid requires a non-empty rows array");
      } else if (rows.length > MULTI_QUESTION_MAX_ROWS) {
        push(
          "invalid_field_prop",
          `${base}.props.rows`,
          `MultiQuestionGrid allows at most ${MULTI_QUESTION_MAX_ROWS} rows`,
        );
      }
      if (Array.isArray(rows)) {
        const seenRowFields = new Set<string>();
        for (let r = 0; r < rows.length; r++) {
          const rp = `${base}.props.rows[${r}]`;
          const row = rows[r];
          if (!isRecord(row)) {
            push("invalid_field_prop", rp, "each row must be an object");
            continue;
          }
          if (!isNonEmptyString(row["label"])) {
            push("invalid_field_prop", `${rp}.label`, "row.label is required");
          }
          const rowField = row["internal_field"];
          if (!isNonEmptyString(rowField)) {
            push(
              "invalid_field_prop",
              `${rp}.internal_field`,
              "row.internal_field is required (the row's answer name)",
            );
          } else if (seenRowFields.has(rowField) || seenInternalFields.has(rowField)) {
            push(
              "duplicate_internal_field",
              `${rp}.internal_field`,
              `duplicate internal_field '${rowField}' (§8.5 unique across the Section)`,
            );
          } else {
            seenRowFields.add(rowField);
            seenInternalFields.add(rowField);
          }
          if (row["required"] !== undefined && typeof row["required"] !== "boolean") {
            push("invalid_field_prop", `${rp}.required`, "row.required must be a boolean");
          }
          // The row's EFFECTIVE choice-value domain (its own override, else the
          // shared set) — the domain a `default` must belong to.
          let rowValues = sharedValues;
          const rowChoices = row["choices"];
          if (rowChoices !== undefined) {
            if (
              !Array.isArray(rowChoices) ||
              rowChoices.length < MULTI_QUESTION_MIN_CHOICES ||
              rowChoices.length > MULTI_QUESTION_MAX_CHOICES
            ) {
              push(
                "invalid_choice",
                `${rp}.choices`,
                `a row choices override must number ${MULTI_QUESTION_MIN_CHOICES}-${MULTI_QUESTION_MAX_CHOICES}`,
              );
              rowValues = new Set<string>();
            } else {
              rowValues = new Set<string>();
              for (let c = 0; c < rowChoices.length; c++) {
                const cp = `${rp}.choices[${c}]`;
                const choice = rowChoices[c];
                if (!isRecord(choice)) {
                  push("invalid_choice", cp, "each choice must be an object");
                  continue;
                }
                if (!isNonEmptyString(choice["label"])) {
                  push("invalid_choice", `${cp}.label`, "choice.label is required");
                }
                if (!isChoicePrimitive(choice["value"])) {
                  push("invalid_choice", `${cp}.value`, "choice.value must be a string, number, or boolean");
                } else {
                  rowValues.add(String(choice["value"]));
                }
                if (!isNonEmptyString(choice["analytics_id"])) {
                  push("invalid_choice", `${cp}.analytics_id`, "choice.analytics_id is required (§22 tracking)");
                }
                if (choice["style"] !== undefined) {
                  validateChoiceStyle(choice["style"], `${cp}.style`, push);
                }
              }
            }
          }
          if (row["default"] !== undefined) {
            if (!isChoicePrimitive(row["default"])) {
              push("invalid_choice", `${rp}.default`, "row.default must be a string, number, or boolean");
            } else if (!rowValues.has(String(row["default"]))) {
              push(
                "invalid_choice",
                `${rp}.default`,
                `row.default '${String(row["default"])}' is not one of this row's choices`,
              );
            }
          }
        }
      }
    }

    // valid_values (enum-like domain) when present: non-empty primitive array.
    if (raw["valid_values"] !== undefined) {
      const vv = raw["valid_values"];
      if (!Array.isArray(vv) || vv.length === 0 || !vv.every(isChoicePrimitive)) {
        push(
          "invalid_valid_values",
          `${base}.valid_values`,
          "valid_values must be a non-empty array of primitives",
        );
      }
    }

    // answer_type must agree with the catalog `produces` (when it emits one).
    const answerType = raw["answer_type"];
    if (answerType !== undefined && catalog.produces !== null && answerType !== catalog.produces) {
      push(
        "answer_type_mismatch",
        `${base}.answer_type`,
        `answer_type '${String(answerType)}' does not match catalog produces '${catalog.produces}'`,
      );
    }

    // conditional (§12.3): shape + referenced field must exist in the Section.
    if (raw["conditional"] !== undefined) {
      validateConditional(raw["conditional"], `${base}.conditional`, knownFields, push);
    }

    // B9 §6.4 mirrored choiceDisplay (Phase-2 authoring leg): typed shape,
    // known keys only, mainValues ⊆ the node's authored choice values. The
    // render leg (readChoiceDisplay) stays defensive — this validation stops
    // author mistakes at save.
    if (raw["choiceDisplay"] !== undefined) {
      validateChoiceDisplayMirror(raw["choiceDisplay"], raw["choices"], `${base}.choiceDisplay`, push);
    }

    // design_overrides: curated keys only; token/scalar values, never CSS.
    if (raw["design_overrides"] !== undefined) {
      const overrides = raw["design_overrides"];
      if (!isRecord(overrides)) {
        push(
          "non_curated_override_key",
          `${base}.design_overrides`,
          "design_overrides must be an object of curated token keys",
        );
      } else {
        for (const [key, value] of Object.entries(overrides)) {
          if (!CURATED_OVERRIDE_KEY_SET.has(key)) {
            push(
              "non_curated_override_key",
              `${base}.design_overrides.${key}`,
              `'${key}' is not a curated design-override token key (§14.8)`,
            );
          } else if (key === "size") {
            // v3.1 §7.2 — the one object-shaped curated key; never CSS/color
            // typed, so it takes its own dedicated branch ahead of the
            // scalar-only checks below.
            validateSizeOverride(value, `${base}.design_overrides.size`, push);
          } else if (key === "corners") {
            if (typeof value !== "string" || !NODE_CORNERS_SET.has(value)) {
              push(
                "invalid_override_value",
                `${base}.design_overrides.corners`,
                `design_overrides.corners must be one of: ${LEADGEN_NODE_CORNERS.join(", ")} (§8.5b)`,
              );
            }
          } else if (key === "border_color") {
            if (typeof value !== "string" || !NODE_BORDER_COLOR_ROLE_SET.has(value)) {
              push(
                "invalid_override_value",
                `${base}.design_overrides.border_color`,
                `design_overrides.border_color must be one of: ${LEADGEN_NODE_BORDER_COLOR_ROLES.join(", ")} (§8.5b)`,
              );
            }
          } else if (key === "columns") {
            // Round-4 A-7 (P1b): the layout column count is a bounded WHOLE
            // number 1..5 — UNIFIED with both renderers' clamps (button group
            // answerGroupRootStyle + renderCardGrid, presets.ts). Before P1b no
            // server range check existed at all, so a stored 0/6/7 sat as
            // stored-vs-rendered drift (the clamp silently repaired it on
            // render). Reject it plainly at save instead.
            if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 5) {
              push(
                "invalid_override_value",
                `${base}.design_overrides.columns`,
                "Columns must be a whole number from 1 to 5",
              );
            }
          } else if (looksLikeArbitraryCss(value)) {
            push(
              "arbitrary_css_override",
              `${base}.design_overrides.${key}`,
              `design_overrides.${key} must be a fixed token value, not arbitrary CSS (§14.10)`,
            );
          } else if (COLOR_TYPED_KEY_SET.has(key) && !isValidColorOverrideValue(value)) {
            // v2.5 §9.4: a color-typed override VALUE must be a known theme
            // role (09 §9.1) or a legacy raw `#hex` literal (tolerated —
            // existing stored content). Never any other string/scalar.
            push(
              "invalid_override_value",
              `${base}.design_overrides.${key}`,
              `design_overrides.${key} must be a theme color role (${LEADGEN_THEME_ROLES.join(", ")}) or a legacy #hex literal (§9.4)`,
            );
          }
        }
      }
    }

    // v3.1 §8.3 top-level `required` (the repo's REAL mechanism — see the
    // erratum note in validateNewFieldProps below): previously untyped at
    // runtime (only a TS interface field); now type-checked like any other
    // authored value.
    if (raw["required"] !== undefined && typeof raw["required"] !== "boolean") {
      push("invalid_field_prop", `${base}.required`, "required must be a boolean");
    }

    // v3.1 §11.3 NEW field-content props (additive, all optional) + §9.2
    // field-level Maps config. Leaf-only (mirrors design_overrides/choices/
    // valid_values above) — the §8.5 container branch already returned.
    validateNewFieldProps(type, props, base, push, warn);
  };

  for (let i = 0; i < rawComponents.length; i++) {
    validateNode(rawComponents[i], `components[${i}]`, 1);
  }
  // P3a: row-grouping (contiguity + max-3) over the ROOT sibling list.
  validateRowGrouping(rawComponents, (i) => `components[${i}]`, push);

  // P4a (PC-A1): continue_mode="auto_advance" must match a composition the
  // engine can actually auto-advance (see autoAdvanceEligibility). A conflict
  // is a BLOCKING error — a NEW save can never create a stuck funnel. (Stored
  // legacy content that already violates this un-sticks at RENDER time: presets
  // renders the Continue when the section is ineligible — no migration needed.)
  if (continueMode === "auto_advance") {
    const elig = autoAdvanceEligibility(rawComponents as LeadgenComponentNode[]);
    if (!elig.eligible) {
      push("auto_advance_conflict", "continue_mode", autoAdvanceConflictMessage(elig));
    }
  }

  // P4c (register PC-12): continue_visible_when — SECTION-level (not any one
  // node), so it is validated once here against the SAME whole-tree
  // knownFields universe conditional/requiredWhen use (mirrors
  // validateConditional exactly — shape + conditional_unknown_field).
  const continueVisibleWhen = content["continue_visible_when"];
  if (continueVisibleWhen !== undefined) {
    validateConditional(continueVisibleWhen, "continue_visible_when", knownFields, push);
  }
  // Interplay guard (adversarial-review-anticipated ruling, documented per
  // the mission's own instruction): whether continueVisibleWhen can EVER be
  // met is not statically provable for arbitrary conditions (an operator
  // could reference a field only reachable via an unrelated branch, etc.).
  // So this is a save-time WARNING naming the risk — never a blocking 400 —
  // fired only when the Continue button is the section's SOLE advance
  // affordance (continue_mode "button"; auto_advance never renders it, so a
  // stray continue_visible_when there is inert, not risky). Omitted
  // continueMode ⇒ no check, matching the auto_advance_conflict precedent
  // above (every legacy `validateSectionContent(content)` call site behaves
  // byte-identically).
  if (continueMode === "button" && continueVisibleWhen !== undefined) {
    warn(
      "continue_visibility_risk",
      "continue_visible_when",
      "The Continue button is this section's only way to advance, and it is now conditional — if the condition can never be met, visitors will be stuck here. Double-check the condition is reachable.",
    );
  }

  // §8.6: `ok` is keyed to ERRORS only — warnings never block a save.
  return { ok: errors.length === 0, errors, warnings };
}

// B9 §6.4 mirrored-choiceDisplay check (mirrors payload.ts
// validateChoiceDisplay, with the Section-side domain: the node's authored
// choices — mainValues members must equal String(choice.value) of one of
// them, exactly how the render leg (presets.ts splitChoicesForOtherGroup)
// matches membership).
const CHOICE_DISPLAY_KEYS = [
  "mainValues",
  "otherGroupEnabled",
  "otherGroupLabel",
  "searchableOther",
] as const;
const CHOICE_DISPLAY_KEY_SET: ReadonlySet<string> = new Set(CHOICE_DISPLAY_KEYS);

function validateChoiceDisplayMirror(
  raw: unknown,
  rawChoices: unknown,
  path: string,
  push: (code: SectionContentErrorCode, path: string, message: string) => void,
): void {
  if (!isRecord(raw)) {
    push("choice_display_invalid", path, "choiceDisplay must be an object");
    return;
  }
  for (const key of Object.keys(raw)) {
    if (!CHOICE_DISPLAY_KEY_SET.has(key)) {
      push(
        "choice_display_invalid",
        `${path}.${key}`,
        `unknown choiceDisplay key '${key}' (allowed: ${CHOICE_DISPLAY_KEYS.join(", ")})`,
      );
    }
  }
  const choiceValues = new Set<string>();
  const hasChoices = Array.isArray(rawChoices) && rawChoices.length > 0;
  if (hasChoices) {
    for (const choice of rawChoices) {
      if (isRecord(choice) && isChoicePrimitive(choice["value"])) {
        choiceValues.add(String(choice["value"]));
      }
    }
  } else {
    push(
      "choice_display_invalid",
      path,
      "choiceDisplay requires an authorable choices list on the same component",
    );
  }
  const mainValues = raw["mainValues"];
  if (mainValues !== undefined) {
    if (!Array.isArray(mainValues)) {
      push("choice_display_invalid", `${path}.mainValues`, "mainValues must be an array of strings");
    } else {
      const nonStrings = mainValues.filter((v) => typeof v !== "string");
      if (nonStrings.length > 0) {
        push(
          "choice_display_invalid",
          `${path}.mainValues`,
          `mainValues must be strings (offenders: ${nonStrings.map((v) => JSON.stringify(v)).join(", ")})`,
        );
      }
      if (hasChoices) {
        const offenders = mainValues.filter(
          (v): v is string => typeof v === "string" && !choiceValues.has(v),
        );
        if (offenders.length > 0) {
          push(
            "choice_display_invalid",
            `${path}.mainValues`,
            `mainValues not among this component's choice values: ${offenders.join(", ")}`,
          );
        }
      }
    }
  }
  for (const key of ["otherGroupEnabled", "searchableOther"] as const) {
    if (raw[key] !== undefined && typeof raw[key] !== "boolean") {
      push("choice_display_invalid", `${path}.${key}`, `choiceDisplay.${key} must be a boolean`);
    }
  }
  if (raw["otherGroupLabel"] !== undefined && typeof raw["otherGroupLabel"] !== "string") {
    push("choice_display_invalid", `${path}.otherGroupLabel`, "choiceDisplay.otherGroupLabel must be a string");
  }
}

// conditional shape check (mirrors payload.ts validateConditional) + the
// content-specific rule that `when` must reference a field that EXISTS in the
// Section (else the dependency can never fire).
function validateConditional(
  raw: unknown,
  path: string,
  knownFields: ReadonlySet<string>,
  push: (code: SectionContentErrorCode, path: string, message: string) => void,
): void {
  if (!isRecord(raw)) {
    push("conditional_invalid", path, "conditional must be an object {when, op, value}");
    return;
  }
  const when = raw["when"];
  if (!isNonEmptyString(when)) {
    push("conditional_invalid", `${path}.when`, "conditional.when is required");
  } else if (!knownFields.has(when)) {
    push(
      "conditional_unknown_field",
      `${path}.when`,
      `conditional.when '${when}' references a field not present in this Section`,
    );
  }
  const op = raw["op"];
  if (typeof op !== "string" || !CONDITION_OPS.has(op)) {
    push(
      "conditional_invalid",
      `${path}.op`,
      `conditional.op must be one of ${[...CONDITION_OPS].join("|")}`,
    );
    return;
  }
  if (op === "range" && (typeof raw["from"] !== "number" || typeof raw["to"] !== "number")) {
    push("conditional_invalid", path, "range conditional requires numeric from + to");
  }
  if ((op === "in" || op === "not_in") && !Array.isArray(raw["values"])) {
    push("conditional_invalid", path, `${op} conditional requires a values array`);
  }
}
