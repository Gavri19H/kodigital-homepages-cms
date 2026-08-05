// LeadGen Section `content_json` — the TypeScript CONTRACT every consumer
// shares (contract 05 §12.3 / §13.1 / §14.8). A Section body is an ordered
// list of component nodes drawn from the component CAPABILITY catalog
// (components/registry.ts); each node carries its authorable props, an
// optional inline dependency (`conditional`), a design-preset selection, and
// a curated (never free-CSS) `design_overrides` bag.
//
// `validateSectionContent` is I/O-free and returns FIELD-PATH-keyed typed
// errors, mirroring the Offer-validator idiom (leadgen/validation.ts). It is
// non-mutating (the Round-4 orphan-shared-choice prune went out with the §10
// grid removal). The server runs it on save (client validation is never trusted, §12.3); the
// same shape is what the runtime engine + preview consume. Referential checks
// against Offers (answer→payload mapping) are a Stage-B/handler concern —
// this validator is content-internal only.

import { FUNNEL_TOKEN_ROLES, funnelTokenRoleLabel } from "../designs/theme";
import { COMPONENT_CATALOG, COMPONENT_CAPABILITIES } from "./registry";
import type { ComponentType, ComponentScope, ComponentCapabilitySpec } from "./registry";
import type { LeadgenConditionOp, LeadgenContinueMode } from "../../../admin/leadgen/db-types";
// P1b (register PC-11): the leading-icon enum's name vocabulary is sourced
// from the build-time-vendored Tabler (MIT) icon map — see the
// LEADGEN_FIELD_LEADING_ICONS comment below.
import { LEADGEN_ICON_NAMES } from "./icons.generated";
// P2b review-round (MAJOR-1): the phone_format custom regex is an author-
// facing custom-pattern surface exactly like the free-text custom pattern —
// reuse the SAME ReDoS screen + length cap (one detection engine, never two).
import { isCatastrophicRegexShape, FREE_TEXT_CUSTOM_PATTERN_MAX_LENGTH } from "../../../leadgen/payload";

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
// the same short-snake-case convention. This key does not collide with any
// live behavior: PhoneInputQuestion's registry-documented `format` prop has
// zero readers today (grep-verified) — so there is nothing to conflict with.
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
// Round-4 A-6b / Part D — phone-format presets (`node.props.phone_format`).
// ---------------------------------------------------------------------------
// The investigation ground (A-6b): the runtime hard-coded NANP + the message
// "Enter a valid US phone number." with NO author choice — wrong for IL /
// international funnels (operator examples: US, IL 0XX-XXXXXXX, intl +code).
// A phone-typed field may now select a preset: 'nanp' (default, US/Canada) |
// 'e164_intl' (+ and 8-15 digits) | 'il' (Israeli national) | a {custom:{regex,
// mask?, message?}} rule. content-schema VALIDATES the shape at save (below);
// config-dto COMPILES it into the client contract (buildPhoneContract); the
// runtime CHECKER (validation.ts) consumes the contract. Absent ⇒ byte-
// identical legacy NANP behavior (the runtime's normalizePhoneE164 default).
export const LEADGEN_PHONE_FORMAT_PRESETS = ["nanp", "e164_intl", "il"] as const;
export type LeadgenPhoneFormatPreset = (typeof LEADGEN_PHONE_FORMAT_PRESETS)[number];
const PHONE_FORMAT_PRESET_SET: ReadonlySet<string> = new Set(LEADGEN_PHONE_FORMAT_PRESETS);

// A phone-typed field: the concrete PhoneInputQuestion, or any text tile
// Accept-swapped to the `phone` format (§5.6). props.phone_format is valid ONLY
// here, and config-dto compiles a phone contract ONLY here — one definition so
// the save-gate and the config-builder can never disagree on "is this a phone".
export function isPhoneTypedComponent(type: ComponentType, props: Record<string, unknown>): boolean {
  return acceptFormatOfType(type) === "phone" || props["format"] === "phone";
}

// ===========================================================================
// LeadGen Rework (LEADGEN-REWORK-03) — the P2 component-model additions.
// Every field below is OPTIONAL/ADDITIVE: a node carrying none of them
// validates EXACTLY as pre-rework (the §6 seam rule — the runtime tolerates
// legacy shapes the editor no longer authors). Gating is driven off the §6.2
// COMPONENT_CAPABILITIES matrix (registry.ts) so the authoring surface, the
// save gate, and the §6.2 matrix test can never disagree.
// ===========================================================================

// The maximum authored label length (§6.3).
const LEADGEN_LABEL_MAX_LENGTH = 120;

// §6.6 ✓-in-selected marker (per-choice via choice.style.selected_marker AND
// per-node via props.selected_marker) — an override of the theme's Selected
// axis (wash = tint the selected item; mark = a ✓ glyph inside it).
export const LEADGEN_SELECTED_MARKERS = ["wash", "mark"] as const;
export type LeadgenSelectedMarker = (typeof LEADGEN_SELECTED_MARKERS)[number];
const SELECTED_MARKER_SET: ReadonlySet<string> = new Set(LEADGEN_SELECTED_MARKERS);

// §6.8 slider types (the ONE collapsed NumberRangeQuestion catalog entry). A
// dual_range / from_to slider collects an OBJECT of two number sub-fields
// ({base}_min / {base}_max — join answers.ts fieldsOf, the field universe,
// rules pickers and mapping exactly like Address sub-fields); single / stepper
// / radial collect one number on the node's internal_field.
export const LEADGEN_SLIDER_TYPES = ["single", "dual_range", "stepper", "from_to", "radial"] as const;
export type LeadgenSliderType = (typeof LEADGEN_SLIDER_TYPES)[number];
const SLIDER_TYPE_SET: ReadonlySet<string> = new Set(LEADGEN_SLIDER_TYPES);
// The two slider types whose answer is an object of _min/_max sub-fields.
const SLIDER_OBJECT_TYPE_SET: ReadonlySet<string> = new Set(["dual_range", "from_to"]);

// A NumberRangeQuestion collecting the dual/from_to object answer — the ONE
// predicate content-schema (field universe), config-dto and answers.ts fieldsOf
// share so all three expand the SAME {base}_min/{base}_max pair for the SAME
// node (the reviewer-flagged parity requirement, §6.8). single/stepper/radial
// keep the scalar internal_field.
export function isDualRangeSlider(node: {
  type?: unknown;
  internal_field?: unknown;
  props?: unknown;
}): boolean {
  if (node.type !== "NumberRangeQuestion") return false;
  if (!isNonEmptyString(node.internal_field)) return false;
  const props = isRecord(node.props) ? node.props : {};
  const st = props["slider_type"];
  return st === "dual_range" || st === "from_to";
}

// §6.10 address field-set (M9). props.fields[] = ordered per-field specs;
// `full_address` may only appear alone (it IS the whole address).
export const LEADGEN_ADDRESS_FIELD_KINDS = ["street", "city", "state", "zip", "full_address"] as const;
export type LeadgenAddressFieldKind = (typeof LEADGEN_ADDRESS_FIELD_KINDS)[number];
const ADDRESS_FIELD_KIND_SET: ReadonlySet<string> = new Set(LEADGEN_ADDRESS_FIELD_KINDS);
export const LEADGEN_ADDRESS_FIELD_MODES = ["manual", "autofill"] as const;
export type LeadgenAddressFieldMode = (typeof LEADGEN_ADDRESS_FIELD_MODES)[number];
const ADDRESS_FIELD_MODE_SET: ReadonlySet<string> = new Set(LEADGEN_ADDRESS_FIELD_MODES);
const ADDRESS_VALIDATION_PRESET_SET: ReadonlySet<string> = new Set(["none", "zip5"]);

// §6.5 authored "Other" values bag — SINGLE-select choice groups only.
export const LEADGEN_OTHER_MAX_CHOICES = 50;

// M8 (§6.9) — the phone MASK grammar. A mask `pattern` is a string of LITERALS
// (any of `( ) - . / space`) and DIGIT RUNS; each MAXIMAL run of digit
// characters is ONE group whose LENGTH is the run's NUMERIC value
// (`"(3) 3-4"` → groups [3,3,4]; `"10-5"` → [10,5]). Bounds: 1-6 groups, each
// 1-14, total 4-20 digits. Any violation is the A-10 save error (verbatim). The
// compiled result carries the runtime-contract material: the scaffold (each
// group → underscores of its length, literals kept verbatim), the digit_count
// (Σ group lengths) and the stripped-digit regex `^\d{digit_count}$`.
export const LEADGEN_PHONE_MASK_ERROR = "Format must be digit groups with separators, like (3) 3-4.";
const PHONE_MASK_LITERALS: ReadonlySet<string> = new Set(["(", ")", "-", ".", "/", " "]);
const PHONE_MASK_MIN_GROUPS = 1;
const PHONE_MASK_MAX_GROUPS = 6;
const PHONE_MASK_MIN_GROUP_LEN = 1;
const PHONE_MASK_MAX_GROUP_LEN = 14;
const PHONE_MASK_MIN_TOTAL = 4;
const PHONE_MASK_MAX_TOTAL = 20;

export interface LeadgenParsedPhoneMask {
  // Group lengths in order ("(3) 3-4" → [3,3,4]).
  groups: number[];
  // The display scaffold ("(3) 3-4" → "(___) ___-____").
  scaffold: string;
  // Σ group lengths — the exact number of digits a complete answer holds.
  digit_count: number;
}

// Parse + grammar-check a phone mask pattern. Returns the compiled mask on
// success, or null on ANY grammar violation (the grammar is all-or-nothing by
// contract — the caller emits the SINGLE A-10 message). PURE + I/O-free.
// EXPORTED so config-dto compiles the SAME parse into the client contract
// (buildPhoneContract) — one grammar, save-gate and config-builder can never
// disagree.
export function parsePhoneMaskPattern(pattern: unknown): LeadgenParsedPhoneMask | null {
  if (typeof pattern !== "string" || pattern === "") return null;
  const groups: number[] = [];
  let scaffold = "";
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i]!;
    if (ch >= "0" && ch <= "9") {
      // A MAXIMAL digit run → ONE group whose length is the run's numeric value.
      let j = i;
      while (j < pattern.length && pattern[j]! >= "0" && pattern[j]! <= "9") j++;
      const len = Number(pattern.slice(i, j));
      if (!Number.isInteger(len) || len < PHONE_MASK_MIN_GROUP_LEN || len > PHONE_MASK_MAX_GROUP_LEN) {
        return null;
      }
      groups.push(len);
      scaffold += "_".repeat(len);
      i = j;
    } else if (PHONE_MASK_LITERALS.has(ch)) {
      scaffold += ch;
      i++;
    } else {
      return null; // an illegal (non-literal, non-digit) character
    }
  }
  if (groups.length < PHONE_MASK_MIN_GROUPS || groups.length > PHONE_MASK_MAX_GROUPS) return null;
  const digit_count = groups.reduce((a, b) => a + b, 0);
  if (digit_count < PHONE_MASK_MIN_TOTAL || digit_count > PHONE_MASK_MAX_TOTAL) return null;
  return { groups, scaffold, digit_count };
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
  // Rework §6.6: per-CHOICE ✓-in-selected marker (wash | mark) — overrides the
  // node-level props.selected_marker and the theme's Selected axis for THIS
  // choice. Optional; absent ⇒ inherit node/theme.
  selected_marker?: LeadgenSelectedMarker;
}

const CHOICE_STYLE_KEYS = [
  "size",
  "color_role",
  "color_hex",
  "text_color_role",
  "text_color_hex",
  "emphasis",
  "selected_marker",
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

// ---------------------------------------------------------------------------
// R2 P1 §① — the QUESTION GRID container (owner A.1 #1/#2 + the cosmic §5
// correction: "the question grid is a COMPONENT. Inside the component there are
// different QUESTIONS, each question is answering another field, and can have
// dependency between of them. Some questions could be buttons, and some can be
// dropdown or else.").
// ---------------------------------------------------------------------------
//
// D7 (ruled): this is a NEW node type whose CHILDREN ARE THE EXISTING QUESTION
// NODE TYPES — NOT a bespoke grid schema. Every child is a full component node
// validated by the SAME per-node rules as a top-level question (its own
// internal_field, props.label/helper, choices, props.defaultValue, required,
// per-question design_overrides/style deviation — D4 — and its own
// `conditional`), so the schema, the renderers, the runtime, answers.ts
// fieldsOf and the rules pickers are REUSED rather than re-implemented.
//
// It is deliberately NOT a member of LEADGEN_CONTAINER_TYPES: a §8.5 layout
// container is pure layout chrome (CAP_CONTAINER, no answer semantics), while
// this container's whole reason to exist is QUESTION semantics — sibling-scoped
// dependencies and the "no Main question / no shared Helper text / no shared
// Answer format / no sub-questions" rule the owner spelled out ("you left a lot
// of dead parts- If each question is independent so why did you kept the main
// 'Helper text'? if each question is independent why you kept main 'Answer
// format'? what is it 'sub questions'???? there is no 'Main question'!!!").
// GridContainer (registry.ts) stays exactly what it is — a LAYOUT primitive.
export const LEADGEN_QUESTION_GRID_TYPE = "QuestionGrid";
export type LeadgenQuestionGridType = typeof LEADGEN_QUESTION_GRID_TYPE;

// True when `type` names the question-grid container.
export function isQuestionGridType(type: unknown): type is LeadgenQuestionGridType {
  return type === LEADGEN_QUESTION_GRID_TYPE;
}

// True when `type` names ANY children-bearing node type — the 5 §8.5 layout
// containers OR the question grid. This is the ONE predicate every tree walk
// (flattenComponents, collectKnownAnswerFields) uses to decide "descend",
// which is what makes the grid's child questions INDEPENDENT questions to
// every existing consumer (answers.ts fieldsOf/normalization, dependencies.ts
// evaluateDependencies, sections.ts, serve.ts, the offers/rules field pickers)
// with zero per-consumer changes — the D7 reuse requirement.
export function isChildrenBearingType(type: unknown): boolean {
  return isLayoutContainerType(type) || isQuestionGridType(type);
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
//
// R2 P1 §①: the QuestionGrid container flattens the SAME way (isChildrenBearing
// Type) — the grid itself produces nothing, and its N child questions ARE
// independent questions ("Each question in the component is independent field,
// with independent answers, inefendent defaults!!"). So every answer /
// dependency / field-universe consumer sees them exactly as if they had been
// authored at the top level. The ONE consumer that must keep the grouping is
// the /lg/config projection + the renderer — those use the dedicated
// grouping-preserving walks (config-dto.projectSectionComponents / presets),
// never this flatten.
export function flattenComponents(
  components: readonly LeadgenComponentNode[],
): LeadgenComponentNode[] {
  const out: LeadgenComponentNode[] = [];
  const walk = (nodes: readonly LeadgenComponentNode[], depth: number): void => {
    for (const node of nodes) {
      const type =
        typeof node === "object" && node !== null ? (node as { type?: unknown }).type : undefined;
      if (isChildrenBearingType(type)) {
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
// Operator vocabulary — the words the Section Studio already puts on screen
// ---------------------------------------------------------------------------
// A save error travels validateSectionContent -> sections.ts -> the API ->
// the Section Studio's save banner (ui-section-studio renderSaveFieldErrors),
// so every `message` below is read by a PERSON, not by a developer. The three
// tables here are the operator's own nouns, copied VERBATIM from the controls
// they can see:
//   * component names  <- the studio palette labels (STUDIO_COMPONENT_META)
//   * control labels   <- the inspector <label> text / choice-column headings
//   * answer formats   <- the Accept dropdown labels
// An error must never invent a second name for a control the operator can see,
// and must never print a raw prop id ("props.selected_marker") as if it were
// one.
//
// The component table is EXHAUSTIVE over ComponentType, so adding a catalog
// type without giving the operator a name for it is a compile error here
// rather than a raw "FooBarQuestion" leaking into a banner.
//
// The spec clause a rule comes from stays in this file as a `// §…` code
// comment beside the rule — useful to a developer, meaningless to an operator.
export const LEADGEN_COMPONENT_OPERATOR_NAMES: Readonly<Record<ComponentType, string>> = {
  ProgressBar: "Progress bar",
  HeaderLogo: "Header logo",
  BackButton: "Back / Previous",
  DisclosureLink: "Disclosure link",
  StepIndicator: "Step indicator",
  CategoryLabel: "Category label",
  QuestionHeadline: "Question headline",
  Subheadline: "Subheadline",
  NumberRangeQuestion: "Slider",
  ButtonAnswerGroup: "Simple answer buttons",
  TwoButtonYesNo: "Yes / No",
  IconCardAnswerGrid: "Icon answer cards",
  ImageCardAnswerGrid: "Image answer cards",
  MultiChoiceCardGroup: "Multi-select cards",
  DropdownQuestion: "Dropdown",
  SearchableDropdownQuestion: "Searchable dropdown",
  QuestionGrid: "Question grid",
  FreeTextQuestion: "Text",
  NumberInputQuestion: "Number",
  CurrencyInputQuestion: "Amount ($)",
  EmailInputQuestion: "Email",
  PhoneInputQuestion: "Phone",
  NameFieldsGroup: "Name",
  DateQuestion: "Date",
  ZIPInputQuestion: "ZIP",
  AddressAutocompleteQuestion: "Address",
  ContinueButton: "Continue button",
  AutoAdvanceButton: "Auto-advance",
  ReassuranceBadge: "Reassurance badge",
  SuccessState: "Success state",
  SecureFormBadge: "Secure-form badge",
  TrustBar: "Trust points",
  LogoStrip: "Logo row",
  HelperText: "Helper text",
  ValidationError: "Error message line",
  LegalNote: "Legal note",
  TextBlock: "Text",
  ImageBlock: "Image / Logo",
  Stack: "Stack",
  GridContainer: "Answer grid",
  Columns: "Two columns",
  CardPanel: "Question card",
  BackgroundPanel: "Background panel",
  Spacer: "Spacer",
  HeaderBar: "Header bar",
  FooterBar: "Footer bar",
};

// A CamelCase / snake_case id split into words — the floor for any id that has
// no curated operator name yet (a type outside the catalog is separately
// reported as unknown_component_type, so this only softens how it reads).
function humanizeId(id: string): string {
  const words = id
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .trim();
  return words === "" ? id : words.charAt(0).toUpperCase() + words.slice(1);
}

export function leadgenComponentName(type: string): string {
  return (LEADGEN_COMPONENT_OPERATOR_NAMES as Record<string, string>)[type] ?? humanizeId(type);
}

// The inspector control each authorable prop is edited by. Keys are the stored
// prop ids; values are the studio's own <label> text.
const OPERATOR_CONTROL_LABELS: Readonly<Record<string, string>> = {
  label: "Label",
  helper: "Helper text",
  error_text: "If it's wrong, say",
  firstHelper: "First name helper text",
  lastHelper: "Last name helper text",
  firstIcon: "First name leading icon",
  lastIcon: "Last name leading icon",
  icon: "Leading icon",
  format: "Answer format",
  phone_format: "Pattern preset",
  role: "Role",
  source: "Source",
  required: "Required",
  step: "Step",
  min: "Min",
  max: "Max",
  slider_type: "Slider type",
  currency_affix: "Currency symbol ($) prefix",
  selected_marker: "Selected-state style",
  columns: "Card columns (1–5)",
  gridGap: "Answer-grid gap token",
  iconColor: "Icon color",
  rangeColor: "Range fill",
  corners: "Corners",
  border_color: "Border color",
  width: "Width",
  height: "Height",
  align: "Align",
  row: "Row",
  nudge_x: "Fine-tune position (left / right)",
  nudge_y: "Fine-tune position (up / down)",
  internal_field: "Internal field",
  // The inspector's read-only "Component id" chip and the "Analytics label"
  // text input (ui-section-studio.ts lg-inspector-question-key/-debug-id) —
  // reused here so a save error never prints the raw question_id/question_key
  // stored keys at an operator (M5 residual fix).
  question_id: "Component id",
  question_key: "Analytics label",
  answer_type: "Answer type",
  choices: "Choices",
  text: "Text",
  placeholder: "Placeholder",
  defaultValue: "Default answer",
  alt: "Alt text",
  yesStyle: "Yes button style",
  noStyle: "No button style",
  color_role: "Color role",
  color_hex: "Custom color",
  text_color_role: "Text color role",
  text_color_hex: "Custom text color",
  emphasis: "Emphasis",
  size: "Size",
  gapDefault: "Default answer-grid gap",
  columnsDefault: "Default answer columns",
  palette: "Palette",
};

export function leadgenControlLabel(key: string): string {
  return OPERATOR_CONTROL_LABELS[key] ?? humanizeId(key);
}

// The per-choice columns of the answers table (ui-section-studio
// CHOICE_FIELD_LABELS) — "Analytics ID", never a title-cased "Analytics Id".
const OPERATOR_CHOICE_FIELD_LABELS: Readonly<Record<string, string>> = {
  label: "Label",
  value: "Saved value",
  analytics_id: "Analytics ID",
  title: "Title",
  subtitle: "Subtitle",
  badge: "Badge",
  icon: "Icon",
  emoji: "Emoji",
  imageMediaId: "Image",
  image_alt: "Image alt",
  aria_label: "Screen-reader label",
  description: "Description",
  disabled: "Disabled",
};

export function leadgenChoiceFieldLabel(key: string): string {
  return OPERATOR_CHOICE_FIELD_LABELS[key] ?? humanizeId(key);
}

// The Address field-set rows (ui-section-studio ADDRESS_DEFAULT_LABELS).
const OPERATOR_ADDRESS_FIELD_LABELS: Readonly<Record<string, string>> = {
  street: "Street address",
  city: "City",
  state: "State",
  zip: "ZIP code",
  full_address: "Address",
};

function addressFieldLabel(key: string): string {
  return OPERATOR_ADDRESS_FIELD_LABELS[key] ?? humanizeId(key);
}

// The Maps tab's three job checkboxes (ui-section-studio.ts studio-maps-job-row
// labels, grep-verified: "Validate the answer" / "Use in auction rules" /
// "Auto-complete the address") — a save error must name these, never the
// stored job keys (validate/auction/autocomplete) underneath them.
const OPERATOR_MAPS_JOB_LABELS: Readonly<Record<string, string>> = {
  validate: "Validate the answer",
  auction: "Use in auction rules",
  autocomplete: "Auto-complete the address",
};

function mapsJobLabel(key: string): string {
  return OPERATOR_MAPS_JOB_LABELS[key] ?? humanizeId(key);
}

// The Accept dropdown's own words for the answer formats.
const OPERATOR_ANSWER_FORMAT_LABELS: Readonly<Record<string, string>> = {
  text: "Any text",
  number: "Number",
  currency: "Amount ($)",
  email: "Email",
  phone: "Phone",
  us_zip: "ZIP code (5 digits)",
  date: "Date",
  street_address: "Street address",
};

function answerFormatLabel(key: string): string {
  return OPERATOR_ANSWER_FORMAT_LABELS[key] ?? humanizeId(key);
}

// P8-6 Q7 (M5 jargon sweep): the studio's per-node "Selected-state style"
// override (ui-section-studio.ts data-set-selected-marker, grep-verified) and
// its size-preset chips (CHOICE_SIZE_PRESET_LABELS_UI) show these stored
// values with capitalisation only ("Wash"/"Mark", "S"/"M"/"L") — plain
// English already, not the jargon class, so LEADGEN_SELECTED_MARKERS and
// LEADGEN_CHOICE_SIZE_PRESETS are left as plain .join()/orList() below. Same
// for LEADGEN_NODE_CORNERS/LEADGEN_NODE_BORDER_COLOR_ROLES/
// LEADGEN_PLACEMENT_ALIGNS/LEADGEN_CHOICE_EMPHASES — already common English
// words. LEADGEN_PHONE_FORMAT_PRESETS (nanp/e164_intl/il) is legacy-only:
// ui-section-studio.ts's §6.9 phone mask builder never authors a preset
// string anymore (only {mask}), so no current control names them.

// The slider-type picker's own cards (ui-section-studio.ts CARDS, §6.x).
const OPERATOR_SLIDER_TYPE_LABELS: Readonly<Record<string, string>> = {
  single: "Single",
  dual_range: "Dual range",
  stepper: "Stepper",
  from_to: "From / To",
  radial: "Radial",
};

function sliderTypeLabel(key: string): string {
  return OPERATOR_SLIDER_TYPE_LABELS[key] ?? humanizeId(key);
}

// The Image block's own Source toggle (ui-section-studio.ts data-set-imageblock-source).
const OPERATOR_IMAGE_BLOCK_SOURCE_LABELS: Readonly<Record<string, string>> = {
  media: "Image from library",
  auto_logo: "Site logo",
};

function imageBlockSourceLabel(key: string): string {
  return OPERATOR_IMAGE_BLOCK_SOURCE_LABELS[key] ?? humanizeId(key);
}

// The Text block's own Role select (ui-section-studio.ts TEXT_BLOCK_ROLE_LABELS
// — converged verbatim; kept as local data here for the same PURE-module
// reason as the other label maps in this file: content-schema.ts is domain
// logic several admin files import FROM).
const OPERATOR_TEXT_BLOCK_ROLE_LABELS: Readonly<Record<string, string>> = {
  heading: "Heading",
  body: "Body",
  category_label: "Category label",
  helper: "Helper",
  legal: "Legal",
  reassurance: "Reassurance",
  secure_badge: "Secure badge",
};

function textBlockRoleLabel(key: string): string {
  return OPERATOR_TEXT_BLOCK_ROLE_LABELS[key] ?? humanizeId(key);
}

// The Headline/Subheadline bind is set by the studio when those two
// component types are added (never authored from a raw-value picker) — a
// mismatch here means corrupted content, not an operator's own choice, but
// the two values still read as their component's own name in the studio.
const OPERATOR_COMPONENT_BIND_LABELS: Readonly<Record<string, string>> = {
  section_headline: "Headline",
  section_subheadline: "Subheadline",
};

function componentBindLabel(key: string): string {
  return OPERATOR_COMPONENT_BIND_LABELS[key] ?? humanizeId(key);
}

// "a, b or c" — an operator reads a sentence, not a pipe-delimited enum dump.
function orList(values: readonly string[]): string {
  if (values.length === 0) return "";
  if (values.length === 1) return String(values[0]);
  return `${values.slice(0, -1).join(", ")} or ${values[values.length - 1]}`;
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
  // P2b review-round (minor-4): an internal_field / row internal_field / Maps
  // fill-target starting with "__" (components, MQG rows, Maps fills alike).
  | "reserved_internal_field"
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
  // R2 P1 §① QuestionGrid container errors (owner A.1 #1/#2 + cosmic §5):
  //   question_grid_child_invalid       — children must be QUESTION nodes
  //                                       ("Inside the component there are
  //                                       different QUESTIONS"); a layout
  //                                       container / control / copy node is
  //                                       not a question.
  //   question_grid_shared_field_forbidden
  //                                     — the container carrying a shared
  //                                       question-bearing field: the "dead
  //                                       parts" the owner named (main Helper
  //                                       text, main Answer format, sub
  //                                       questions, a Main question).
  //   question_grid_conditional_scope   — a child dependency whose `when` is
  //                                       not a SIBLING inside the same grid
  //                                       (self-reference included): "the user
  //                                       should be able to manage inner
  //                                       dippendancies between of questions
  //                                       inside the component".
  //   question_grid_conditional_cycle   — sibling dependencies that form a
  //                                       cycle (unresolvable visibility).
  | "question_grid_child_invalid"
  | "question_grid_shared_field_forbidden"
  | "question_grid_conditional_scope"
  | "question_grid_conditional_cycle"
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
// table is the curated, exhaustive resolution of that contract per type.
// A new ComponentType added to
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
  // range family (§14.5) — the ONE collapsed Slider (§10/M7).
  NumberRangeQuestion: { internalField: true, numericProps: ["min", "max"] },
  // choice questions
  ButtonAnswerGroup: { internalField: true, choices: true },
  TwoButtonYesNo: { internalField: true },
  IconCardAnswerGrid: { internalField: true, choices: true, choiceIcon: true },
  ImageCardAnswerGrid: { internalField: true, choices: true, choiceImage: true },
  MultiChoiceCardGroup: { internalField: true, choices: true },
  DropdownQuestion: { internalField: true, choices: true },
  SearchableDropdownQuestion: { internalField: true, choices: true },
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
  // R2 P1 §① QuestionGrid: the container itself requires NOTHING — it has no
  // internal_field, no choices, no text (owner: "there is no 'Main question'!!!").
  // Every required-field truth belongs to its CHILD question nodes, which are
  // validated through their OWN rows in this table.
  QuestionGrid: {},
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

// ---------------------------------------------------------------------------
// P8-6 Q8 — THE CONTAINER-PROP ENUM SEAM (the twin of designs/frames.ts's
// FRAME_ENUM_LABELS; same shape, same rules, so both raw-key paths in this
// product now have ONE lookup each instead of ~40 call sites).
//
// Every vocabulary declared with `enumSpec()` in CONTAINER_PROP_SPECS below
// reaches the operator through exactly ONE sentence: the `spec.kind === "enum"`
// arm of validateContainerProps, which used to end in `orList(spec.values)` —
// a raw dump of the STORED tokens ("xs, s, m, l or xl"). That arm now asks this
// ONE registry for operator words first.
//
// Keyed by the vocabulary ARRAY ITSELF (enumSpec stores the `as const` array by
// reference), so ONE row covers every prop that reuses it (LEADGEN_GAP_TOKENS
// is 4 props) and cannot mislabel a token that means something else in another
// vocabulary ("card" is a CardPanel background AND a BackgroundPanel one; "sm"
// is a radius AND a shadow).
//
// NOT A GATE (§1): an unregistered vocabulary is NOT an error and never throws
// — it renders today's exact sentence.
//
// DELIBERATELY EMPTY TODAY, and that is the honest answer, not an oversight.
// All 15 vocabularies below were traced to their REAL operator control and
// every one of them shows the STORED VALUE ITSELF: ui-section-studio.ts's
// CONTAINER_PROP_CONTROLS rows (L1975+) render `options(control.values)`, i.e.
// `<option value="wash">wash</option>` — the control has a labelled FIELD
// ("Background token") but no labelled VALUES, so there is no operator wording
// to converge with and inventing one here would put a word in the message that
// the operator never sees on screen. The seam is still the win: each of these
// is now ONE row away from reading properly, the day its control gets labels.
//
// The 15, and what their control shows:
//   LEADGEN_GAP_TOKENS (xs/s/m/l/xl)        raw — Stack/Grid "Gap token", Spacer "Size token"
//   LEADGEN_PANEL_SHADOWS (none/sm/md/lg/xl) raw — CardPanel "Shadow token"
//   LEADGEN_PANEL_RADII (sm/md/lg/xl)        raw — CardPanel "Radius token"
//   LEADGEN_PANEL_WIDTHS (s/m/l/full)        raw — CardPanel "Width preset"
//   LEADGEN_PANEL_PADDINGS (s/m/l)           raw — CardPanel "Padding token"
//   LEADGEN_PANEL_BACKGROUNDS (card/wash/ghost/transparent)   raw — "Background token"
//   LEADGEN_BG_PANEL_BACKGROUNDS (card/wash/ghost/page/primary) raw — "Background token"
//   LEADGEN_BG_PANEL_GRADIENTS (primary/accent/wash)          raw — "Gradient token"
//   LEADGEN_GRID_SIZINGS (auto/equal)        raw — GridContainer "Card sizing"
//   LEADGEN_COLUMN_RATIOS (50/50…70/30)      raw — Columns "Ratio preset"; already reads as English
//   LEADGEN_COLUMN_MOBILE_MODES (stack/keep) raw — Columns "Mobile stacking"; already English
//   LEADGEN_STACK_DIRECTIONS (vertical/horizontal) raw — Stack "Direction"; already English
//   LEADGEN_STACK_ALIGNS (start/center/end/stretch) raw — Stack "Align"; already English
//   LEADGEN_SPACER_VARIANTS (gap/line)       raw — Spacer "Style"; already English
//   LEADGEN_IMAGE_FIT_MODES (cover/contain)  its control (renderImageFitControl)
//     IS labelled, but as "Cover — fill the card, may crop": the head word
//     differs from the stored value by CAPITALISATION only, the same exclusion
//     the label maps in theme.ts/frames.ts already apply, and splicing the
//     explanatory tail into a "must be one of:" list would read worse, not
//     better.
const CONTAINER_ENUM_LABELS: ReadonlyMap<readonly string[], Readonly<Record<string, string>>> = new Map<
  readonly string[],
  Readonly<Record<string, string>>
>();

// The one lookup. Unlabelled vocabulary -> today's exact `orList(values)`.
function containerEnumList(values: readonly string[]): string {
  const labels = CONTAINER_ENUM_LABELS.get(values);
  return orList(labels === undefined ? values : values.map((v) => labels[v] ?? v));
}

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
  // R2 P1 §①: the QuestionGrid's ONLY authorable container prop is the spacing
  // between its stacked questions (the design pin's stacked labeled questions).
  // Nothing question-bearing lives here — that is the whole point of the type.
  QuestionGrid: {
    gap: enumSpec(LEADGEN_GAP_TOKENS),
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
          // P8-6 Q8: the ONE place every enumSpec() vocabulary is spoken aloud.
          `'${leadgenControlLabel(key)}' on the ${leadgenComponentName(type)} must be one of: ${containerEnumList(spec.values)}. Pick one of those.`,
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
          `'${leadgenControlLabel(key)}' on the ${leadgenComponentName(type)} must be a whole number from ${spec.min} to ${spec.max}. Enter a number in that range.`,
        );
      }
    } else if (spec.kind === "string") {
      if (typeof value !== "string" || value.trim() === "") {
        push(
          "container_prop_invalid",
          path,
          `'${leadgenControlLabel(key)}' on the ${leadgenComponentName(type)} can't be empty. Enter a value, or clear the setting.`,
        );
      }
    } else if (spec.kind === "boolean") {
      if (typeof value !== "boolean") {
        push(
          "container_prop_invalid",
          path,
          `'${leadgenControlLabel(key)}' on the ${leadgenComponentName(type)} must be on or off. Toggle it.`,
        );
      }
    }
  }

  // HeaderBar cta {label, href|tel} (§8.5 "optional CTA (label + tel/href)").
  if (type === "HeaderBar" && props["cta"] !== undefined) {
    const path = `${base}.props.cta`;
    const cta = props["cta"];
    if (!isRecord(cta)) {
      push(
        "container_prop_invalid",
        path,
        `The ${leadgenComponentName(type)}'s CTA needs a Label and a phone number or link. Set both, or remove the CTA.`,
      );
    } else {
      if (!isNonEmptyString(cta["label"])) {
        push(
          "container_prop_invalid",
          `${path}.label`,
          `The ${leadgenComponentName(type)}'s CTA needs a Label. Enter the CTA's label.`,
        );
      }
      const href = cta["href"];
      const tel = cta["tel"];
      if (!isNonEmptyString(href) && !isNonEmptyString(tel)) {
        push(
          "container_prop_invalid",
          path,
          `The ${leadgenComponentName(type)}'s CTA needs a phone number or a link. Enter one of those.`,
        );
      }
      if (isNonEmptyString(href) && !SAFE_HREF_RE.test(href.trim())) {
        push(
          "container_prop_invalid",
          `${path}.href`,
          `The ${leadgenComponentName(type)}'s CTA link must be a web address, page anchor, or tel:/mailto: link. Fix the link.`,
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
        push(
          "container_prop_invalid",
          path,
          "'Trust messages' must be a list of text lines. Re-enter them, one per line.",
        );
      }
    }
    if (props["links"] !== undefined) {
      const raw = props["links"];
      if (!Array.isArray(raw)) {
        push(
          "container_prop_invalid",
          `${base}.props.links`,
          "'Links' must be a list of label/link pairs. Re-enter them, one per line.",
        );
      } else {
        raw.forEach((link, li) => {
          const path = `${base}.props.links[${li}]`;
          if (!isRecord(link)) {
            push(
              "container_prop_invalid",
              path,
              "Each footer link needs a Label and a link. Re-enter this line as label|href.",
            );
            return;
          }
          if (!isNonEmptyString(link["label"])) {
            push("container_prop_invalid", `${path}.label`, "This footer link needs a Label. Enter the link's label.");
          }
          const href = link["href"];
          if (!isNonEmptyString(href)) {
            push("container_prop_invalid", `${path}.href`, "This footer link needs a web address or link. Enter one.");
          } else if (!SAFE_HREF_RE.test(href.trim())) {
            push(
              "container_prop_invalid",
              `${path}.href`,
              "This footer link must be a web address, page anchor, or tel:/mailto: link. Fix the link.",
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
        `Pick one of the ${orList(presetList)} presets, or set a custom size in pixels.`,
      );
    }
    return;
  }
  if (isRecord(value)) {
    const keys = Object.keys(value);
    if (keys.length !== 1 || keys[0] !== "custom_px") {
      push(code, path, "A custom size is one pixel number. Enter a single custom size, or pick a preset.");
      return;
    }
    const px = value["custom_px"];
    if (typeof px !== "number" || !Number.isFinite(px) || !Number.isInteger(px)) {
      push(code, `${path}.custom_px`, "A custom size must be a whole number of pixels. Round it to a whole number.");
      return;
    }
    if (px < min || px > max) {
      push(
        code,
        `${path}.custom_px`,
        `A custom size must be between ${min} and ${max} pixels. Enter a size in that range.`,
      );
    } else if (px % SIZE_GRID_PX !== 0) {
      push(
        code,
        `${path}.custom_px`,
        `A custom size must be a multiple of ${SIZE_GRID_PX} pixels. Round it to the nearest ${SIZE_GRID_PX}.`,
      );
    }
    return;
  }
  push(code, path, "Pick a size preset, or set a custom size in pixels.");
}

function validateSizeOverride(
  value: unknown,
  path: string,
  push: (code: SectionContentErrorCode, path: string, message: string) => void,
): void {
  if (!isRecord(value)) {
    push("invalid_size_override", path, "Size is a Width and a Height. Set one of those, or clear the size.");
    return;
  }
  for (const key of Object.keys(value)) {
    if (key !== "width" && key !== "height") {
      push(
        "invalid_size_override",
        `${path}.${key}`,
        `'${key}' is not a size setting — a size has only a Width and a Height. Remove '${key}'.`,
      );
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

// The §14.8/§9.4 curated `design_overrides` bag check. Extracted VERBATIM from
// validateSectionContent's per-leaf walk (behavior unchanged, same codes, same
// paths, same order) so the R2 P1 §① QuestionGrid branch — which returns before
// the leaf tail, exactly like the §8.5 container branch — can run the SAME gate
// on the container's own overrides instead of leaving a new type's style bag
// ungated. One override vocabulary, one validator, two call sites.
function validateDesignOverridesBag(
  overrides: unknown,
  base: string,
  push: (code: SectionContentErrorCode, path: string, message: string) => void,
): void {
  if (!isRecord(overrides)) {
    push(
      "non_curated_override_key",
      `${base}.design_overrides`,
      "Style overrides must be a set of named style settings. Clear them, then set the styles again from the Style tab.",
    );
    return;
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (!CURATED_OVERRIDE_KEY_SET.has(key)) {
      push(
        "non_curated_override_key",
        `${base}.design_overrides.${key}`,
        `'${key}' is not a style setting you can override. Remove it — the Style tab lists the settings this component supports.`,
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
          `'Corners' must be one of: ${orList(LEADGEN_NODE_CORNERS)}. Pick one of those in the Style tab.`,
        );
      }
    } else if (key === "border_color") {
      if (typeof value !== "string" || !NODE_BORDER_COLOR_ROLE_SET.has(value)) {
        push(
          "invalid_override_value",
          `${base}.design_overrides.border_color`,
          `'Border color' must be one of: ${orList(LEADGEN_NODE_BORDER_COLOR_ROLES)}. Pick one of those in the Style tab.`,
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
        `'${leadgenControlLabel(key)}' must be one of the theme's values, not arbitrary CSS. Pick a value from the Style tab.`,
      );
    } else if (COLOR_TYPED_KEY_SET.has(key) && !isValidColorOverrideValue(value)) {
      // v2.5 §9.4: a color-typed override VALUE must be a known theme
      // role (09 §9.1) or a legacy raw `#hex` literal (tolerated —
      // existing stored content). Never any other string/scalar.
      // P8-6 Q7 (M5 jargon sweep): this used to dump the raw
      // LEADGEN_THEME_ROLES storage keys ("brand_primary, ...") — labelled
      // via theme.ts's funnelTokenRoleLabel (the canonical map; see its
      // comment for why it lives there rather than a fourth local copy).
      push(
        "invalid_override_value",
        `${base}.design_overrides.${key}`,
        `'${leadgenControlLabel(key)}' must be a theme color role (${orList(LEADGEN_THEME_ROLES.map(funnelTokenRoleLabel))}) or a #hex value like #1A2B3C. Pick a role, or enter a hex value.`,
      );
    }
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
    push(
      "invalid_placement",
      path,
      "This component's position must be a set of placement settings (row, align, width, fine-tune). Reset its position on the canvas.",
    );
    return;
  }
  if (scope === "frame") {
    push(
      "invalid_placement",
      path,
      `The ${leadgenComponentName(type)} belongs to the funnel frame, not to this Section, so it can't be placed on the Section canvas. Remove its position, or move the component to the Quote Builder.`,
    );
  }
  if (PLACEMENT_EXCLUDED_TYPE_SET.has(type)) {
    push(
      "invalid_placement",
      path,
      `The ${leadgenComponentName(type)}'s position is set in the Quote Builder, not here. Remove its position from this Section and set it in the Quote Builder.`,
    );
  }
  for (const key of Object.keys(value)) {
    if (!PLACEMENT_LAYOUT_KEY_SET.has(key)) {
      push(
        "invalid_placement",
        `${path}.${key}`,
        `'${key}' is not a placement setting. Remove it — placement is ${orList(PLACEMENT_LAYOUT_KEYS.map(leadgenControlLabel))}.`,
      );
    }
  }
  if (value["row"] !== undefined) {
    const row = value["row"];
    if (typeof row !== "string" || looksLikeArbitraryCss(row) || !PLACEMENT_ROW_ID_RE.test(row)) {
      push(
        "invalid_placement",
        `${path}.row`,
        "A row name may use letters, numbers, dashes and underscores, up to 64 characters. Rename the row.",
      );
    }
  }
  if (value["align"] !== undefined) {
    const align = value["align"];
    if (typeof align !== "string" || !PLACEMENT_ALIGN_SET.has(align)) {
      push(
        "invalid_placement",
        `${path}.align`,
        `'Align' must be one of: ${orList(LEADGEN_PLACEMENT_ALIGNS)}. Pick one of those.`,
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
        push(
          "invalid_placement",
          `${path}.${axis}`,
          `'${leadgenControlLabel(axis)}' must be a whole number of pixels. Enter a whole number.`,
        );
      } else if (n < PLACEMENT_NUDGE_MIN || n > PLACEMENT_NUDGE_MAX) {
        push(
          "invalid_placement",
          `${path}.${axis}`,
          `'${leadgenControlLabel(axis)}' must be between ${PLACEMENT_NUDGE_MIN} and ${PLACEMENT_NUDGE_MAX} pixels. Bring it back inside that range.`,
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
        `Row '${row}' is split into ${acc.runCount} separate groups — a row can't be drawn with a gap in it. Move its components next to each other.`,
      );
    }
    if (acc.maxLen > LEADGEN_MAX_ROW_MEMBERS) {
      push(
        "invalid_placement",
        acc.firstPath,
        `Row '${row}' holds ${acc.maxLen} components — a row fits at most ${LEADGEN_MAX_ROW_MEMBERS}. Move one out of the row.`,
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
    push("invalid_choice_style", path, "This answer's style must be a set of style settings. Reset the answer's style.");
    return;
  }
  for (const key of Object.keys(value)) {
    if (!CHOICE_STYLE_KEY_SET.has(key)) {
      push(
        "invalid_choice_style",
        `${path}.${key}`,
        `'${key}' is not an answer style setting. Remove it — an answer's style covers ${orList(CHOICE_STYLE_KEYS.map(leadgenControlLabel))}.`,
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
        `An answer's 'Emphasis' must be one of: ${orList(LEADGEN_CHOICE_EMPHASES)}. Pick one of those.`,
      );
    }
  }
  // Rework §6.6: per-choice ✓-in-selected marker (wash | mark).
  if (value["selected_marker"] !== undefined) {
    if (typeof value["selected_marker"] !== "string" || !SELECTED_MARKER_SET.has(value["selected_marker"])) {
      push(
        "invalid_choice_style",
        `${path}.selected_marker`,
        `An answer's 'Selected-state style' must be one of: ${orList(LEADGEN_SELECTED_MARKERS)}. Pick one of those.`,
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
        `This answer's size must be one of the ${orList(LEADGEN_CHOICE_SIZE_PRESETS)} presets, or a custom size in pixels.`,
      );
    }
    return;
  }
  if (isRecord(value)) {
    const keys = Object.keys(value);
    if (keys.length !== 1 || keys[0] !== "custom_px") {
      push(
        "invalid_choice_style",
        path,
        "A custom answer size is one pixel number. Enter a single custom size, or pick a preset.",
      );
      return;
    }
    const px = value["custom_px"];
    if (typeof px !== "number" || !Number.isFinite(px) || !Number.isInteger(px)) {
      push(
        "invalid_choice_style",
        `${path}.custom_px`,
        "A custom answer size must be a whole number of pixels. Round it to a whole number.",
      );
    } else if (px < SIZE_HEIGHT_CUSTOM_PX_MIN || px > SIZE_HEIGHT_CUSTOM_PX_MAX) {
      push(
        "invalid_choice_style",
        `${path}.custom_px`,
        `A custom answer size must be between ${SIZE_HEIGHT_CUSTOM_PX_MIN} and ${SIZE_HEIGHT_CUSTOM_PX_MAX} pixels. Enter a size in that range.`,
      );
    } else if (px % SIZE_GRID_PX !== 0) {
      push(
        "invalid_choice_style",
        `${path}.custom_px`,
        `A custom answer size must be a multiple of ${SIZE_GRID_PX} pixels. Round it to the nearest ${SIZE_GRID_PX}.`,
      );
    }
    return;
  }
  push("invalid_choice_style", path, "Pick an answer size preset, or set a custom size in pixels.");
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
  const roleLabel = leadgenControlLabel(roleKey);
  const hexLabel = leadgenControlLabel(hexKey);
  if (role !== undefined && hex !== undefined) {
    push(
      "invalid_choice_style",
      `${base}.${hexKey}`,
      `'${roleLabel}' and '${hexLabel}' are mutually exclusive — set exactly one. Clear the other.`,
    );
  }
  if (role !== undefined && (typeof role !== "string" || !THEME_ROLE_SET.has(role))) {
    // P8-6 Q7 (M5 jargon sweep): labelled the same way as the
    // design_overrides color-role message above (funnelTokenRoleLabel).
    push(
      "invalid_choice_style",
      `${base}.${roleKey}`,
      `'${roleLabel}' must be a theme color role (${orList(LEADGEN_THEME_ROLES.map(funnelTokenRoleLabel))}). Pick one of those.`,
    );
  }
  if (hex !== undefined && (typeof hex !== "string" || looksLikeArbitraryCss(hex) || !LEGACY_HEX_RE.test(hex))) {
    push(
      "invalid_choice_style",
      `${base}.${hexKey}`,
      `'${hexLabel}' must be a #rrggbb hex color. Enter a hex value like #1A2B3C.`,
    );
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
      push(
        "invalid_field_prop",
        `${base}.props.${key}`,
        `'${leadgenControlLabel(key)}' must be text. Retype it, or clear the field.`,
      );
    }
  }
  // Rework §6.3: the per-question label is capped at 120 chars (the studio's
  // Basics "Question label" input). Additive — an absent/short label is
  // byte-identical to pre-rework.
  if (typeof props["label"] === "string" && props["label"].length > LEADGEN_LABEL_MAX_LENGTH) {
    push(
      "invalid_field_prop",
      `${base}.props.label`,
      `'Question label' must be ${LEADGEN_LABEL_MAX_LENGTH} characters or fewer. Shorten it.`,
    );
  }

  const cap = COMPONENT_CAPABILITIES[type];

  // Rework §6.6: node-level ✓-in-selected marker. Valid only on the choice
  // types the §6.2 matrix flags with a selected-marker control; a misplaced one
  // is rejected (a NEW field ⇒ rejecting it elsewhere breaks no stored content).
  if (props["selected_marker"] !== undefined) {
    if (!cap.selected_marker) {
      push(
        "invalid_field_prop",
        `${base}.props.selected_marker`,
        `The ${leadgenComponentName(type)} has no selected-state style. Remove it — only answer buttons and cards offer one.`,
      );
    } else if (
      typeof props["selected_marker"] !== "string" ||
      !SELECTED_MARKER_SET.has(props["selected_marker"])
    ) {
      push(
        "invalid_field_prop",
        `${base}.props.selected_marker`,
        `'Selected-state style' must be one of: ${orList(LEADGEN_SELECTED_MARKERS)}. Pick one of those.`,
      );
    }
  }

  // Rework §6.8: slider type + currency affix. Valid only on the Slider
  // (NumberRangeQuestion; the §6.2 matrix's slider_type control). Per-type:
  // stepper REQUIRES props.step. currency_affix is a display-only boolean that
  // never touches node.type/answer_type (the Image9 failure class dies here).
  if (props["slider_type"] !== undefined) {
    if (!cap.slider_type) {
      push(
        "invalid_field_prop",
        `${base}.props.slider_type`,
        `'Slider type' is only available on a Slider. Remove it from the ${leadgenComponentName(type)}.`,
      );
    } else if (typeof props["slider_type"] !== "string" || !SLIDER_TYPE_SET.has(props["slider_type"])) {
      push(
        "invalid_field_prop",
        `${base}.props.slider_type`,
        `'Slider type' must be one of: ${orList(LEADGEN_SLIDER_TYPES.map(sliderTypeLabel))}. Pick one of those.`,
      );
    } else if (props["slider_type"] === "stepper") {
      const step = props["step"];
      if (typeof step !== "number" || !Number.isFinite(step)) {
        push(
          "invalid_field_prop",
          `${base}.props.step`,
          "A stepper slider needs a 'Step' number. Enter the step size.",
        );
      }
    }
  }
  if (props["currency_affix"] !== undefined && typeof props["currency_affix"] !== "boolean") {
    push(
      "invalid_field_prop",
      `${base}.props.currency_affix`,
      "'Currency symbol ($) prefix' must be on or off. Toggle it.",
    );
  }

  // Rework §6.10 (M9): the Address field-set. Valid only on
  // AddressAutocompleteQuestion (the §6.2 matrix's field_set_maps control).
  // NOTE — this is DELIBERATELY gated to Address: NameFieldsGroup also carries a
  // `props.fields` (a string[] of first/last names, a different shape entirely),
  // read defensively by answers.ts; the object-shaped field-set below is Address
  // only, so the two never collide.
  if (type === "AddressAutocompleteQuestion" && props["fields"] !== undefined) {
    validateAddressFields(props["fields"], `${base}.props.fields`, push);
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
      "'Required' belongs on the question itself, not inside its content settings. Move it up to the question.",
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
          `'Leading icon' must be one of: ${orList(LEADGEN_FIELD_LEADING_ICONS)}. Pick one from the icon list.`,
        );
      }
    } else if (typeof props["icon"] !== "string") {
      push(
        "invalid_field_prop",
        `${base}.props.icon`,
        "'Leading icon' must be a single icon character. Retype it, or clear it.",
      );
    }
  }

  // format (§5.6 Accept-swap enum, 8 values).
  if (props["format"] !== undefined) {
    if (typeof props["format"] !== "string" || !FIELD_ACCEPT_FORMAT_SET.has(props["format"])) {
      push(
        "invalid_field_prop",
        `${base}.props.format`,
        `'Answer format' must be one of: ${orList(LEADGEN_FIELD_ACCEPT_FORMATS.map(answerFormatLabel))}. Pick one of those.`,
      );
    }
  }

  // Round-4 A-6b / Part D: phone_format — the phone-validation preset. Valid
  // ONLY on a phone-typed field (isPhoneTypedComponent). A string names a
  // built-in preset (nanp | e164_intl | il); an object is a custom rule
  // {custom:{regex, mask?, message?}} whose regex MUST compile (a bad pattern is
  // an author error, never a runtime throw). config-dto compiles the choice into
  // the client contract; absent ⇒ byte-identical NANP default.
  if (props["phone_format"] !== undefined) {
    const pf = props["phone_format"];
    if (!isPhoneTypedComponent(type, props)) {
      push(
        "invalid_field_prop",
        `${base}.props.phone_format`,
        `A phone pattern is only available on a Phone field. Remove it from the ${leadgenComponentName(type)}.`,
      );
    } else if (typeof pf === "string") {
      if (!PHONE_FORMAT_PRESET_SET.has(pf)) {
        push(
          "invalid_field_prop",
          `${base}.props.phone_format`,
          `'Pattern preset' must be one of: ${orList(LEADGEN_PHONE_FORMAT_PRESETS)}, or a custom pattern. Pick a preset, or enter a custom pattern.`,
        );
      }
    } else if (isRecord(pf) && pf["mask"] !== undefined) {
      // Rework M8 (§6.9): the authored digit-group MASK — the new preferred
      // phone format. {mask:{pattern}}; the grammar is enforced by
      // parsePhoneMaskPattern (a violation is the A-10 message VERBATIM). An
      // OPTIONAL mask.message overrides the runtime completeness copy (default
      // A-7, applied in config-dto.buildPhoneContract). config-dto compiles the
      // SAME parse into the client contract.
      const mask = pf["mask"];
      if (!isRecord(mask)) {
        push(
          "invalid_field_prop",
          `${base}.props.phone_format.mask`,
          "A phone mask needs a digit-group pattern. Enter the pattern, or clear the mask.",
        );
      } else {
        if (parsePhoneMaskPattern(mask["pattern"]) === null) {
          push("invalid_field_prop", `${base}.props.phone_format.mask.pattern`, LEADGEN_PHONE_MASK_ERROR);
        }
        if (mask["message"] !== undefined && typeof mask["message"] !== "string") {
          push(
            "invalid_field_prop",
            `${base}.props.phone_format.mask.message`,
            "The phone mask's error message must be text. Retype it, or clear it.",
          );
        }
      }
    } else if (isRecord(pf)) {
      // Legacy custom raw-regex path. Per contract M8 the raw-regex path is
      // removed from the EDITOR (a S2.4/studio change); the SCHEMA keeps
      // TOLERATING it on read AND save so stored content stays valid and the
      // shipped money-path ReDoS/length save-guards (leadgen-p2b-phone.test.ts)
      // remain in force. New authoring uses the mask above.
      const custom = pf["custom"];
      if (!isRecord(custom) || !isNonEmptyString(custom["regex"])) {
        push(
          "invalid_field_prop",
          `${base}.props.phone_format`,
          "A custom phone rule needs a pattern. Enter the pattern, or switch the rule off.",
        );
      } else {
        // P2b review-round (MAJOR-1, money path): a custom phone regex is
        // exactly as author-controlled as the free-text custom pattern —
        // reuse BOTH of its save-time defenses (payload.ts §6.5): the length
        // cap first (cheap, catches degenerate input), then the paren-aware
        // catastrophic-backtracking screen. Evil patterns must never compile
        // into a DTO; both checks run before the compile-check below.
        const regex = custom["regex"];
        if (regex.length > FREE_TEXT_CUSTOM_PATTERN_MAX_LENGTH) {
          push(
            "invalid_field_prop",
            `${base}.props.phone_format.custom.regex`,
            `A custom phone rule's pattern must be at most ${FREE_TEXT_CUSTOM_PATTERN_MAX_LENGTH} characters. Shorten it, or switch the rule off.`,
          );
        } else if (isCatastrophicRegexShape(regex)) {
          push(
            "invalid_field_prop",
            `${base}.props.phone_format.custom.regex`,
            "This pattern could freeze visitors' browsers — simplify it",
          );
        } else {
          try {
            new RegExp(regex);
          } catch {
            push(
              "invalid_field_prop",
              `${base}.props.phone_format.custom.regex`,
              "A custom phone rule's pattern isn't something the browser can read. Fix the pattern, or switch the rule off.",
            );
          }
        }
        if (custom["mask"] !== undefined && typeof custom["mask"] !== "string") {
          push(
            "invalid_field_prop",
            `${base}.props.phone_format.custom.mask`,
            "The custom phone pattern's display mask must be text. Retype it, or clear it.",
          );
        }
        if (custom["message"] !== undefined && typeof custom["message"] !== "string") {
          push(
            "invalid_field_prop",
            `${base}.props.phone_format.custom.message`,
            "The custom phone pattern's error message must be text. Retype it, or clear it.",
          );
        }
      }
    } else {
      push(
        "invalid_field_prop",
        `${base}.props.phone_format`,
        "'Pattern preset' must be a preset name, or a custom pattern object. Pick a preset, or enter a custom pattern.",
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
        `'Step' is only available on Number and Amount fields — a ${answerFormatLabel(acceptFmt)} field has no step. Remove it; changing the answer format clears it for you.`,
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
          `'${leadgenControlLabel(key)}' on a Date field must be a date (YYYY-MM-DD) or one of today, year_end, +7d, +2w, +1m — you entered ${JSON.stringify(v)}. Enter a date, or one of those.`,
        );
      }
    }
  }

  // role — TextBlock only (§5.3/§8.5b).
  if (props["role"] !== undefined) {
    if (type !== "TextBlock") {
      push(
        "invalid_field_prop",
        `${base}.props.role`,
        `'Role' is only available on a Text block. Remove it from the ${leadgenComponentName(type)}.`,
      );
    }
    if (typeof props["role"] !== "string" || !TEXT_BLOCK_ROLE_SET.has(props["role"])) {
      push(
        "invalid_field_prop",
        `${base}.props.role`,
        `'Role' must be one of: ${orList(LEADGEN_TEXT_BLOCK_ROLES.map(textBlockRoleLabel))}. Pick one of those.`,
      );
    }
  }

  // source — ImageBlock only (§5.3).
  if (props["source"] !== undefined) {
    if (type !== "ImageBlock") {
      push(
        "invalid_field_prop",
        `${base}.props.source`,
        `'Source' is only available on an Image / Logo block. Remove it from the ${leadgenComponentName(type)}.`,
      );
    }
    if (typeof props["source"] !== "string" || !IMAGE_BLOCK_SOURCE_SET.has(props["source"])) {
      push(
        "invalid_field_prop",
        `${base}.props.source`,
        `'Source' must be one of: ${orList(LEADGEN_IMAGE_BLOCK_SOURCES.map(imageBlockSourceLabel))}. Pick one of those.`,
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
      push(
        "invalid_field_prop",
        `${base}.props.${key}`,
        `'${leadgenControlLabel(key)}' is only available on a Name field. Remove it from the ${leadgenComponentName(type)}.`,
      );
      continue;
    }
    if (typeof v !== "string" || !FIELD_LEADING_ICON_SET.has(v)) {
      push(
        "invalid_field_prop",
        `${base}.props.${key}`,
        `'${leadgenControlLabel(key)}' must be one of: ${orList(LEADGEN_FIELD_LEADING_ICONS)}. Pick one from the icon list.`,
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
      push(
        "invalid_field_prop",
        `${base}.props.${key}`,
        `'${leadgenControlLabel(key)}' is only available on a Yes / No question. Remove it from the ${leadgenComponentName(type)}.`,
      );
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
    push(
      "invalid_maps_prop",
      path,
      `Maps is only available on a ZIP or an Address field. Turn Maps off on the ${leadgenComponentName(type)}.`,
    );
  }
  if (!isRecord(value)) {
    push("invalid_maps_prop", path, "The Maps settings must be a set of Maps options. Set Maps up again from the Maps tab.");
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
    push(
      "invalid_maps_prop",
      `${path}.${key}`,
      `'${key}' is not a Maps setting. Remove it — Maps has an on/off switch, the jobs it does, and the fields it fills.`,
    );
  }
  const enabled = value["enabled"];
  if (typeof enabled !== "boolean") {
    push("invalid_maps_prop", `${path}.enabled`, "Maps must be on or off. Toggle it in the Maps tab.");
  }
  const jobs = value["jobs"];
  if (!isRecord(jobs)) {
    push(
      "invalid_maps_prop",
      `${path}.jobs`,
      `What Maps does must be a set of jobs (${orList((["validate", "auction", "autocomplete"] as const).map((jobKey) => `'${mapsJobLabel(jobKey)}'`))}). Pick the jobs in the Maps tab.`,
    );
    return;
  }
  const jobExtraKeys = Object.keys(jobs).filter(
    (k) => k !== "validate" && k !== "auction" && k !== "autocomplete",
  );
  for (const key of jobExtraKeys) {
    push(
      "invalid_maps_prop",
      `${path}.jobs.${key}`,
      `'${key}' is not a Maps job (${orList((["validate", "auction", "autocomplete"] as const).map((jobKey) => `'${mapsJobLabel(jobKey)}'`))}). Remove '${key}'.`,
    );
  }
  let anyJobTrue = false;
  for (const key of ["validate", "auction", "autocomplete"] as const) {
    const jobValue = jobs[key];
    if (jobValue !== undefined) {
      if (typeof jobValue !== "boolean") {
        push(
          "invalid_maps_prop",
          `${path}.jobs.${key}`,
          `'${mapsJobLabel(key)}' must be on or off. Toggle it in the Maps tab.`,
        );
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
      "Maps is on but no job is selected ('Validate the answer', 'Use in auction rules' or 'Auto-complete the address') — it does nothing at runtime. Pick a job or turn Maps off.",
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
    push(
      "invalid_maps_prop",
      path,
      "The fields Maps fills must be a set of address slots (street, city, state, ZIP). Pick them in the Maps tab.",
    );
    return;
  }
  const slotSet: ReadonlySet<string> = new Set(MAPS_FILL_SLOTS);
  const extraKeys = Object.keys(value).filter((k) => !slotSet.has(k));
  for (const key of extraKeys) {
    push(
      "invalid_maps_prop",
      `${path}.${key}`,
      `'${key}' is not an address slot Maps can fill — only street, city, state and ZIP. Remove '${key}'.`,
    );
  }
  for (const slot of MAPS_FILL_SLOTS) {
    const v = value[slot];
    if (v !== undefined && (typeof v !== "string" || v === "")) {
      push(
        "invalid_maps_prop",
        `${path}.${slot}`,
        `Pick which field Maps should fill with the ${slot === "zip" ? "ZIP" : slot}, or clear that slot.`,
      );
    } else if (typeof v === "string" && v.startsWith("__")) {
      // P2b review-round (minor-4): a fill target NAMES an internal_field —
      // same reservation as the field it targets.
      push("reserved_internal_field", `${path}.${slot}`, "Field names starting with __ are reserved");
    }
  }
}

// ---------------------------------------------------------------------------
// Rework §6.10 (M9) — the Address field-set validator.
// ---------------------------------------------------------------------------
// props.fields[] = an ORDERED list of per-field specs; ≥1 field; `full_address`
// may appear only ALONE (it IS the whole address). Each field: `field` ∈ the
// 5-value kind enum; optional `label` (string), `mode` ∈ manual|autofill,
// `required` (boolean), and `validation` ∈ 'none' | 'zip5' | {regex, message}
// (a custom regex reuses the SAME ReDoS + length screen the custom phone path
// trusts — a per-field rule reaches the runtime client, the SAME money-path
// reasoning). Additive: an Address WITHOUT props.fields[] validates exactly as
// pre-M9 (the seam). The compiled DTO carries props.fields[] verbatim (config-
// dto passthrough) so the S2.3 runtime validateSection applies the per-field
// rules; the field-NAME universe (collectKnownAnswerFields / answers.ts
// fieldsOf) is UNCHANGED — it still derives from internal_fields/maps.fills
// (P8-6 Q3: plus the keys the section's OTHER questions answer, which is what
// decides whether a maps.fills rename survives — see addressRenderedRoleName),
// never from props.fields[], so this metadata never shifts the answer space
// (the M9 migration invariant).
function validateAddressFields(
  value: unknown,
  path: string,
  push: (code: SectionContentErrorCode, path: string, message: string) => void,
): void {
  if (!Array.isArray(value) || value.length === 0) {
    push("invalid_field_prop", path, "An Address needs at least one field. Add a field, or use a single full-address field.");
    return;
  }
  const hasFullAddress = value.some((f) => isRecord(f) && f["field"] === "full_address");
  if (hasFullAddress && value.length > 1) {
    push(
      "invalid_field_prop",
      path,
      "'Address' is the whole address, so it can't sit beside street, city, state or ZIP. Remove the other fields, or remove 'Address'.",
    );
  }
  for (let i = 0; i < value.length; i++) {
    const fp = `${path}[${i}]`;
    const field = value[i];
    if (!isRecord(field)) {
      push(
        "invalid_field_prop",
        fp,
        "Each address field needs a kind, a fill mode and a validation rule. Set it up again in the Address fields list.",
      );
      continue;
    }
    if (typeof field["field"] !== "string" || !ADDRESS_FIELD_KIND_SET.has(field["field"])) {
      push(
        "invalid_field_prop",
        `${fp}.field`,
        `An address field must be one of: ${orList(LEADGEN_ADDRESS_FIELD_KINDS.map(addressFieldLabel))}. Pick one of those.`,
      );
    }
    if (field["label"] !== undefined && typeof field["label"] !== "string") {
      push("invalid_field_prop", `${fp}.label`, "An address field's label must be text. Retype it, or clear it.");
    }
    if (
      field["mode"] !== undefined &&
      (typeof field["mode"] !== "string" || !ADDRESS_FIELD_MODE_SET.has(field["mode"]))
    ) {
      push(
        "invalid_field_prop",
        `${fp}.mode`,
        `An address field must be filled ${orList(LEADGEN_ADDRESS_FIELD_MODES)}. Pick one of those.`,
      );
    }
    if (field["required"] !== undefined && typeof field["required"] !== "boolean") {
      push("invalid_field_prop", `${fp}.required`, "An address field's 'Required' must be on or off. Toggle it.");
    }
    const validation = field["validation"];
    if (validation === undefined) continue;
    if (typeof validation === "string") {
      if (!ADDRESS_VALIDATION_PRESET_SET.has(validation)) {
        push(
          "invalid_field_prop",
          `${fp}.validation`,
          "An address field's rule must be none, a 5-digit ZIP check, or a custom pattern. Pick one of those.",
        );
      }
    } else if (isRecord(validation)) {
      const regex = validation["regex"];
      if (!isNonEmptyString(regex)) {
        push(
          "invalid_field_prop",
          `${fp}.validation.regex`,
          "A custom address rule needs a pattern. Enter the pattern, or switch the rule off.",
        );
      } else if (regex.length > FREE_TEXT_CUSTOM_PATTERN_MAX_LENGTH) {
        push(
          "invalid_field_prop",
          `${fp}.validation.regex`,
          `A custom address rule's pattern must be at most ${FREE_TEXT_CUSTOM_PATTERN_MAX_LENGTH} characters. Shorten it, or switch the rule off.`,
        );
      } else if (isCatastrophicRegexShape(regex)) {
        push("invalid_field_prop", `${fp}.validation.regex`, "This pattern could freeze visitors' browsers — simplify it");
      } else {
        try {
          new RegExp(regex);
        } catch {
          push(
            "invalid_field_prop",
            `${fp}.validation.regex`,
            "A custom address rule's pattern isn't something the browser can read. Fix the pattern, or switch the rule off.",
          );
        }
      }
      if (validation["message"] !== undefined && typeof validation["message"] !== "string") {
        push(
          "invalid_field_prop",
          `${fp}.validation.message`,
          "The address rule's error message must be text. Retype it, or clear it.",
        );
      }
    } else {
      push(
        "invalid_field_prop",
        `${fp}.validation`,
        "An address field's rule must be none, a 5-digit ZIP check, or a custom pattern. Pick one of those.",
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Rework §6.5 — the authored "Other" values bag validator.
// ---------------------------------------------------------------------------
// props.other = {enabled?, label?, choices: LeadgenChoice[] 1..50}, valid ONLY
// on the SINGLE-select choice groups the §6.2 matrix flags (`other_editor` —
// Buttons / Icon cards / Image cards). Each other choice is shape-checked like a
// base choice; other values must be UNIQUE vs the base choice values (they share
// ONE answer domain). config-dto merges the other values into the DTO
// valid_values so the runtime accepts an "other" selection exactly like a base
// choice. Rejecting props.other on Dropdown/YesNo/MultiChoice is the matrix
// #10 fix — a NEW field ⇒ rejecting it elsewhere breaks no stored content.
function validateOtherEditor(
  cap: ComponentCapabilitySpec,
  value: unknown,
  rawChoices: unknown,
  path: string,
  push: (code: SectionContentErrorCode, path: string, message: string) => void,
): void {
  if (!cap.other_editor) {
    push(
      "invalid_field_prop",
      path,
      "'Other values' are only available on a single-select buttons or cards question. Remove them, or switch this question to buttons or cards.",
    );
    return;
  }
  if (!isRecord(value)) {
    push("invalid_field_prop", path, "'Other values' must be a set of values with a label. Set them up again in the Other values editor.");
    return;
  }
  if (value["enabled"] !== undefined && typeof value["enabled"] !== "boolean") {
    push("invalid_field_prop", `${path}.enabled`, "'Other values' must be on or off. Toggle it.");
  }
  if (value["label"] !== undefined && typeof value["label"] !== "string") {
    push("invalid_field_prop", `${path}.label`, "'Other label' must be text. Retype it, or clear it.");
  }
  const choices = value["choices"];
  if (!Array.isArray(choices) || choices.length === 0) {
    push("invalid_field_prop", `${path}.choices`, "'Other values' needs at least one value. Add a value, or turn Other off.");
    return;
  }
  if (choices.length > LEADGEN_OTHER_MAX_CHOICES) {
    push(
      "invalid_field_prop",
      `${path}.choices`,
      `'Other values' holds at most ${LEADGEN_OTHER_MAX_CHOICES} values. Remove some.`,
    );
  }
  const baseValues = new Set<string>(
    (Array.isArray(rawChoices) ? rawChoices : [])
      .filter(isRecord)
      .map((c) => c["value"])
      .filter(isChoicePrimitive)
      .map((v) => String(v)),
  );
  for (let i = 0; i < choices.length; i++) {
    const cp = `${path}.choices[${i}]`;
    const choice = choices[i];
    if (!isRecord(choice)) {
      push("invalid_choice", cp, "Each Other value needs a label and a saved value. Fill them in.");
      continue;
    }
    if (!isNonEmptyString(choice["label"])) {
      push("invalid_choice", `${cp}.label`, "'Label' is required — it is the text the visitor reads. Enter a label.");
    }
    if (!isChoicePrimitive(choice["value"])) {
      push(
        "invalid_choice",
        `${cp}.value`,
        "'Saved value' must be text, a number, or yes/no. Enter a value.",
      );
    } else if (baseValues.has(String(choice["value"]))) {
      push(
        "invalid_choice",
        `${cp}.value`,
        `The Other value '${String(choice["value"])}' is already one of this question's answers — two answers can't share a saved value. Change one of them.`,
      );
    }
    if (!isNonEmptyString(choice["analytics_id"])) {
      push(
        "invalid_choice",
        `${cp}.analytics_id`,
        "'Analytics ID' is required — it is how this answer is reported. Enter an Analytics ID.",
      );
    }
    if (choice["style"] !== undefined) {
      validateChoiceStyle(choice["style"], `${cp}.style`, push);
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
// R2 P1 §① — QuestionGrid container rules (the owner's "no dead parts" +
// sibling-scoped inner dependencies).
// ---------------------------------------------------------------------------

// NODE-level fields that would make the container itself a question. Owner:
// "there is no 'Main question'!!!" / "Each question in the component is
// independent field, with independent answers, inefendent defaults!!".
const QUESTION_GRID_FORBIDDEN_NODE_FIELDS: readonly [string, string][] = [
  ["internal_field", "the container answers no field of its own — each question inside it answers another field"],
  ["choices", "answer choices belong to the question that offers them, never to the container"],
  ["answer_type", "the container emits no answer — each question inside it emits its own"],
  ["valid_values", "an answer domain belongs to the question that owns it, never to the container"],
  ["required", "'Required' is per question — each question carries its own rule"],
];

// props-level "dead parts" the owner named explicitly. Key -> the reason,
// phrased in the owner's own model so the save error reads like the ruling.
const QUESTION_GRID_FORBIDDEN_PROPS: Readonly<Record<string, string>> = {
  helper: "there is no shared helper text — each question carries its own helper",
  helper_text: "there is no shared helper text — each question carries its own helper",
  format: "there is no shared answer format — each question carries its own",
  answer_format: "there is no shared answer format — each question carries its own",
  rows: "there are no 'sub questions' — the container's children ARE the questions",
  sub_questions: "there are no 'sub questions' — the container's children ARE the questions",
  questions: "there are no 'sub questions' — the container's children ARE the questions",
  label: "there is no 'Main question' — each question carries its own label",
  text: "there is no 'Main question' — each question carries its own label",
  question: "there is no 'Main question' — each question carries its own label",
  defaultValue: "defaults are per question — each question carries its own default",
  placeholder: "a placeholder belongs to the question that shows it",
  other: "an 'Other' list belongs to the question that offers it",
};

// The inner dependency gate (owner: "the user should be able to manage inner
// dippendancies between of questions inside the component"). A child's
// `conditional` must point at a SIBLING question inside the SAME grid — never
// at itself, never out of the grid — and the sibling graph must be acyclic.
//
// TYPE-AGNOSTIC on BOTH sides (owner clarification 2026-07-28): the trigger is
// matched by the sibling's FIELD, never by its component type, and the operator
// vocabulary is the full canonical set (see CONDITION_OPS) — so a Buttons
// question with non-boolean choices triggering a Dropdown, or a Dropdown
// triggering Buttons, validates exactly like the Yes/No case. Field ownership
// is resolved with collectKnownAnswerFields (the SAME enumerator the whole-tree
// universe uses), so a dual-range slider's _min/_max, an Address role and a
// NameFields sub-field are all legal triggers inside a grid too.
//
// R2 P8-6 Q3: per-CHILD enumeration, but resolved against the WHOLE section
// (`foreignAnswerKeysFor`, built once in Pass 1 over rawComponents). A grid
// child's own field list is otherwise derived with no section around it, so an
// Address child whose props.maps.fills.<slot> rename collides with any other
// question — inside the grid or outside it — would be attributed the fill
// target while its box actually posts `{base}_{slot}`, and a sibling rule
// pointing at the REAL key would be rejected as "not another question in this
// group" (same operator-visible class as the rules-rail gap this fixes).
function validateQuestionGridDependencies(
  children: readonly unknown[],
  childPath: (index: number) => string,
  push: (code: SectionContentErrorCode, path: string, message: string) => void,
  foreignAnswerKeysFor: LeadgenForeignAnswerKeyLookup,
): void {
  const fieldOwner = new Map<string, number>();
  const ownFields: Array<ReadonlySet<string>> = [];
  const labelOf: string[] = [];
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    const fields = isRecord(child)
      ? knownAnswerFieldsIn([child], foreignAnswerKeysFor)
      : new Set<string>();
    ownFields.push(fields);
    labelOf.push(
      isRecord(child) && isNonEmptyString(child["question_id"]) ? child["question_id"] : `#${i + 1}`,
    );
    for (const f of fields) if (!fieldOwner.has(f)) fieldOwner.set(f, i);
  }

  // child index -> the sibling indices it depends on (its trigger questions).
  const edges: Array<Set<number>> = children.map(() => new Set<number>());
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (!isRecord(child) || child["conditional"] === undefined) continue;
    const path = `${childPath(i)}.conditional`;
    for (const ref of conditionalFieldRefs(child["conditional"])) {
      if (ownFields[i]!.has(ref)) {
        push(
          "question_grid_conditional_scope",
          `${path}.when`,
          `a question cannot depend on its own answer ('${ref}') — point the rule at another question in this group`,
        );
        continue;
      }
      const owner = fieldOwner.get(ref);
      if (owner === undefined) {
        push(
          "question_grid_conditional_scope",
          `${path}.when`,
          `'${ref}' is not another question in this group — a question group's rules must point at a question inside the same group`,
        );
        continue;
      }
      edges[i]!.add(owner);
    }
  }

  // Cycle detection (white/grey/black DFS). A cycle is unresolvable visibility
  // — Q2 shows only if Q3 is answered, Q3 shows only if Q2 is: neither ever
  // shows. Report ONCE per cycle, naming the chain in question_id terms.
  const state = new Array<0 | 1 | 2>(children.length).fill(0);
  const stack: number[] = [];
  const reported = new Set<string>();
  const visit = (i: number): void => {
    state[i] = 1;
    stack.push(i);
    for (const dep of edges[i]!) {
      if (state[dep] === 1) {
        const from = stack.indexOf(dep);
        const chain = stack.slice(from === -1 ? stack.length - 1 : from).concat(dep);
        const key = [...chain].sort((a, b) => a - b).join(",");
        if (!reported.has(key)) {
          reported.add(key);
          push(
            "question_grid_conditional_cycle",
            `${childPath(i)}.conditional.when`,
            `These questions depend on each other in a loop (${chain.map((n) => labelOf[n]).join(" -> ")}) — none of them could ever show. Point one of them at a different question to break the loop.`,
          );
        }
      } else if (state[dep] === 0) {
        visit(dep);
      }
    }
    stack.pop();
    state[i] = 2;
  };
  for (let i = 0; i < children.length; i++) if (state[i] === 0) visit(i);
}

// ---------------------------------------------------------------------------
// validateSectionContent
// ---------------------------------------------------------------------------

// Validate a Section's parsed `content_json`. I/O-free; returns every problem
// found (never throws). `ok` is true iff `errors` is empty. Non-mutating (the
// Round-4 orphan-shared-choice prune was removed with §10's grid retirement).
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
    push("content_not_object", "content", "A Section's content must be a JSON object.");
    return { ok: false, errors, warnings };
  }
  const rawComponents = content["components"];
  if (!Array.isArray(rawComponents)) {
    push("components_not_array", "components", "A Section's content must list its components as an array.");
    return { ok: false, errors, warnings };
  }
  if (rawComponents.length === 0) {
    push("components_empty", "components", "A Section requires at least one component. Add one from the library.");
    return { ok: false, errors, warnings };
  }

  // Pass 1: collect the known-field universe (internal_field / question_key /
  // question_id + the expanded MQG-row / Address-role / Name-field answer
  // sub-fields) ACROSS THE WHOLE TREE so conditionals can be checked against it
  // order- and level-independently (§8.5: a conditional may reference a field
  // defined inside a sibling container). collectKnownAnswerFields is THE shared
  // enumerator (below) — the SAME field-set the activation preflight
  // (quotes-handlers.ts computeVariantPreflightBlocks) consumes, so save-time
  // validation and activation-time validation can never disagree on which fields
  // exist (Round-4 P7: one collector, no activation-only "missing field" hole).
  // R2 P8-6 Q3: ONE section-context lookup for the whole validation — the
  // universe below and every per-child grid enumeration resolve an Address
  // role's rename collision against the SAME section the renderer sees.
  const foreignAnswerKeysFor = collectForeignAnswerKeyLookup(rawComponents);
  const knownFields = knownAnswerFieldsIn(rawComponents, foreignAnswerKeysFor);

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
      push("node_not_object", base, "This isn't a component. Remove it, or add one from the library.");
      return;
    }

    // type ∈ catalog (registry closing contract: a component NOT in the
    // catalog cannot be placed).
    const type = raw["type"];
    if (!isKnownComponentType(type)) {
      // `type` is `unknown` here (a malformed import can put anything in this
      // slot) — humanizeId (via leadgenComponentName's own fallback) needs a
      // string, so a non-string value falls back to JSON.stringify exactly
      // like it did before this fix, never a runtime throw.
      const typeLabel = typeof type === "string" ? `'${humanizeId(type)}'` : JSON.stringify(type);
      push(
        "unknown_component_type",
        `${base}.type`,
        `${typeLabel} isn't a component this build recognizes. Remove it, or replace it with one from the library.`,
      );
      return; // no further per-type checks possible without a known type
    }
    const spec = REQUIRED_FIELDS[type];
    const catalog = COMPONENT_CATALOG[type];
    const cap = COMPONENT_CAPABILITIES[type];
    const isContainer = isLayoutContainerType(type);

    // question_id: required + unique across the whole tree.
    const questionId = raw["question_id"];
    if (!isNonEmptyString(questionId)) {
      push(
        "missing_question_id",
        `${base}.question_id`,
        `'${leadgenControlLabel("question_id")}' is required. Remove and re-add this question so the studio can generate one.`,
      );
    } else if (seenQuestionIds.has(questionId)) {
      push(
        "duplicate_question_id",
        `${base}.question_id`,
        `Another question already has the same '${leadgenControlLabel("question_id")}' ('${questionId}') — each question needs its own. Remove and re-add one of them.`,
      );
    } else {
      seenQuestionIds.add(questionId);
    }

    // question_key: unique when present (whole tree).
    const questionKey = raw["question_key"];
    if (questionKey !== undefined) {
      if (!isNonEmptyString(questionKey)) {
        push(
          "missing_required_field",
          `${base}.question_key`,
          `'${leadgenControlLabel("question_key")}' can't be empty. Enter a value, or remove the field.`,
        );
      } else if (seenQuestionKeys.has(questionKey)) {
        push(
          "duplicate_question_key",
          `${base}.question_key`,
          `Another question already uses the '${leadgenControlLabel("question_key")}' '${questionKey}' — each question needs its own. Rename one of them.`,
        );
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
        `The ${leadgenComponentName(type)} belongs to the funnel layout, not to this Section. Move it to the Quote Builder, or remove it here.`,
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
          "This Section has more than one Continue button — only the first one is shown. Remove the extra ones.",
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
          `The headline binding must be one of: ${orList(LEADGEN_COMPONENT_BINDS.map(componentBindLabel))}. Pick one of those, or remove the binding.`,
        );
      } else {
        const bind = bindRaw as LeadgenComponentBind;
        const expected = BIND_EXPECTED_TYPE[bind];
        if (seenBinds.has(bind)) {
          push(
            "duplicate_bind",
            `${base}.bind`,
            `Two components are both bound to '${bind}' — a Section has one of each. Remove the binding from one of them.`,
          );
        } else {
          seenBinds.add(bind);
        }
        if (type !== expected) {
          push(
            "bind_type_mismatch",
            `${base}.bind`,
            `Only a ${leadgenComponentName(expected)} can be bound to '${bind}'. Remove the binding, or use a ${leadgenComponentName(expected)}.`,
          );
        } else {
          boundHere = true;
          if (props["text"] !== undefined) {
            push(
              "bound_node_carries_text",
              `${base}.props.text`,
              `A bound ${leadgenComponentName(type)} takes its text from the Section's own headline, so it can't carry its own text. Clear the text, or remove the binding.`,
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

    // R2 P1 §① — the QUESTION GRID container. Checked BEFORE the §8.5 layout
    // branch (it is not a layout container) and before the leaf tail (it is not
    // a question leaf): its children are the questions, and they are validated
    // by the SAME per-node rules one level down (D7 reuse).
    if (isQuestionGridType(type)) {
      if (depth > LEADGEN_MAX_CONTAINER_DEPTH) {
        push(
          "container_depth_exceeded",
          base,
          `Layouts are nested more than ${LEADGEN_MAX_CONTAINER_DEPTH} deep. Move this component up a level.`,
        );
        return;
      }

      // The "dead parts" gate (owner A.1 #1): the container carries NO shared
      // question-bearing field — no Main question, no shared Helper text, no
      // shared Answer format, no 'sub questions', no shared default.
      for (const [key, reason] of QUESTION_GRID_FORBIDDEN_NODE_FIELDS) {
        if (raw[key] !== undefined) {
          // `reason` is already the full operator sentence (see the table's
          // own comment: "phrased in the owner's own model") — no need to
          // prefix it with the raw stored key.
          push(
            "question_grid_shared_field_forbidden",
            `${base}.${key}`,
            `${reason.charAt(0).toUpperCase()}${reason.slice(1)}.`,
          );
        }
      }
      for (const [key, reason] of Object.entries(QUESTION_GRID_FORBIDDEN_PROPS)) {
        if (props[key] !== undefined) {
          push(
            "question_grid_shared_field_forbidden",
            `${base}.props.${key}`,
            `${reason.charAt(0).toUpperCase()}${reason.slice(1)}.`,
          );
        }
      }

      // The container's own (non-question) props + curated style bag.
      validateContainerProps(type, props, base, push);
      if (raw["design_overrides"] !== undefined) {
        validateDesignOverridesBag(raw["design_overrides"], base, push);
      }

      // A grid-LEVEL conditional is the whole group's visibility (the group is
      // a component in the Section like any other) — validated against the
      // whole-Section universe, exactly like any node's conditional. The
      // CHILDREN's conditionals are the INNER dependencies and get the
      // sibling-scope + acyclicity gate below.
      if (raw["conditional"] !== undefined) {
        validateConditional(raw["conditional"], `${base}.conditional`, knownFields, push);
      }

      const gridChildren = raw["children"];
      if (gridChildren !== undefined) {
        if (!Array.isArray(gridChildren)) {
          push(
            "question_grid_child_invalid",
            `${base}.children`,
            "A question group's children must be a list of question components. Remove the group, or set it up again.",
          );
        } else {
          for (let j = 0; j < gridChildren.length; j++) {
            const childPath = `${base}.children[${j}]`;
            const child = gridChildren[j];
            // Owner (cosmic §5): "Inside the component there are different
            // QUESTIONS" — a layout container / control / copy node is not a
            // question and may not live inside the group. An UNKNOWN type is
            // left to the recursive walk's own unknown_component_type error
            // (never double-reported here).
            const childType = isRecord(child) ? child["type"] : undefined;
            if (isKnownComponentType(childType)) {
              const childCategory = COMPONENT_CATALOG[childType].category;
              if (isQuestionGridType(childType)) {
                // A group inside a group has no owner meaning: "Inside the
                // component there are different QUESTIONS" — one level, and
                // every child is a question that answers another field.
                push(
                  "question_grid_child_invalid",
                  `${childPath}.type`,
                  "A question group cannot contain another question group — its children are the questions. Move the inner group's questions up a level, or remove it.",
                );
              } else if (childCategory !== "question") {
                push(
                  "question_grid_child_invalid",
                  `${childPath}.type`,
                  `A question group can only hold questions. Remove the ${leadgenComponentName(childType)}, or move it outside the group.`,
                );
              }
            }
            validateNode(child, childPath, depth + 1);
          }
          // P3a: row-grouping (contiguity + max-3) over THIS child sibling list
          // — a group's questions can sit side by side exactly like any other
          // siblings.
          validateRowGrouping(gridChildren, (j) => `${base}.children[${j}]`, push);
          // The inner dependency gate: sibling-scoped, no self, no cycles.
          validateQuestionGridDependencies(
            gridChildren,
            (j) => `${base}.children[${j}]`,
            push,
            foreignAnswerKeysFor,
          );
        }
      }
      return;
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
          `Layouts are nested more than ${LEADGEN_MAX_CONTAINER_DEPTH} deep. Move this component up a level.`,
        );
        return;
      }

      // Containers carry NO answer fields (§8.5): they produce nothing.
      for (const key of ["internal_field", "choices", "answer_type"] as const) {
        if (raw[key] !== undefined) {
          push(
            "container_answer_field_forbidden",
            `${base}.${key}`,
            `The ${leadgenComponentName(type)} is a layout, not a question, so it has no '${leadgenControlLabel(key)}'. Remove it, or move it to a question inside.`,
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
            `The ${leadgenComponentName(type)} must hold a list of components. Add components to it, or remove it.`,
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
        `The ${leadgenComponentName(type)} can't hold other components inside it. Move them out, or put them in a layout.`,
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
      // P2b review-round (minor-4): "__"-prefixed names are reserved (ctx
      // fields like __page/__hour/__weekday/__state/__device, P2a 10C) — an
      // author-typed field can never collide with/shadow one.
      if (internalField.startsWith("__")) {
        push("reserved_internal_field", `${base}.internal_field`, "Field names starting with __ are reserved");
      } else if (seenInternalFields.has(internalField)) {
        push(
          "duplicate_internal_field",
          `${base}.internal_field`,
          `Another question in this Section already uses the Internal field '${internalField}' — each question needs its own. Rename one of them.`,
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
        `The ${leadgenComponentName(type)} needs an 'Internal field' — the name its answer is saved under. Enter one.`,
      );
    }
    for (const key of spec.textProps ?? []) {
      // §3.4: a BOUND QuestionHeadline/Subheadline must NOT carry props.text —
      // its text is the Section headline/subheadline column, so the legacy
      // required-text rule is waived for it (presence is the error instead).
      if (boundHere && key === "text") continue;
      if (!isNonEmptyString(props[key])) {
        push(
          "missing_required_field",
          `${base}.props.${key}`,
          `The ${leadgenComponentName(type)} needs '${leadgenControlLabel(key)}'. Enter it.`,
        );
      }
    }
    for (const key of spec.numericProps ?? []) {
      if (typeof props[key] !== "number" || !Number.isFinite(props[key])) {
        push(
          "missing_required_field",
          `${base}.props.${key}`,
          `The ${leadgenComponentName(type)} needs a number in '${leadgenControlLabel(key)}'. Enter a number.`,
        );
      }
    }

    // choices (§13.1 per-choice value/analytics_id; §14.4 per-choice icon).
    if (spec.choices === true) {
      const choices = raw["choices"];
      if (!Array.isArray(choices) || choices.length === 0) {
        push(
        "invalid_choice",
        `${base}.choices`,
        `The ${leadgenComponentName(type)} needs at least one answer. Add an answer.`,
      );
      } else {
        for (let c = 0; c < choices.length; c++) {
          const cp = `${base}.choices[${c}]`;
          const choice = choices[c];
          if (!isRecord(choice)) {
            push("invalid_choice", cp, "Each answer needs a label and a saved value. Fill them in.");
            continue;
          }
          if (!isNonEmptyString(choice["label"])) {
            push("invalid_choice", `${cp}.label`, "'Label' is required — it is the text the visitor reads. Enter a label.");
          }
          if (!isChoicePrimitive(choice["value"])) {
            push(
        "invalid_choice",
        `${cp}.value`,
        "'Saved value' must be text, a number, or yes/no. Enter a value.",
      );
          }
          if (!isNonEmptyString(choice["analytics_id"])) {
            push(
        "invalid_choice",
        `${cp}.analytics_id`,
        "'Analytics ID' is required — it is how this answer is reported. Enter an Analytics ID.",
      );
          }
          if (spec.choiceIcon === true && !isNonEmptyString(choice["icon"])) {
            push(
              "invalid_choice",
              `${cp}.icon`,
              `Every answer on the ${leadgenComponentName(type)} needs an icon. Pick an icon for this answer.`,
            );
          }
          if (spec.choiceImage === true && !isNonEmptyString(choice["imageMediaId"])) {
            push(
              "invalid_choice",
              `${cp}.imageMediaId`,
              `Every answer on the ${leadgenComponentName(type)} needs an image. Pick an image for this answer.`,
            );
          }
          // v2.5 §8.4 additive per-choice fields — typed when present.
          for (const key of ["title", "subtitle", "badge", "emoji", "image_alt", "aria_label"] as const) {
            if (choice[key] !== undefined && typeof choice[key] !== "string") {
              push(
                "invalid_choice",
                `${cp}.${key}`,
                `An answer's '${leadgenChoiceFieldLabel(key)}' must be text. Retype it, or clear it.`,
              );
            }
          }
          if (choice["disabled"] !== undefined && typeof choice["disabled"] !== "boolean") {
            push("invalid_choice", `${cp}.disabled`, "An answer's 'Disabled' must be on or off. Toggle it.");
          }
          // §8.4: emoji and icon are mutually exclusive per choice.
          if (isNonEmptyString(choice["emoji"]) && isNonEmptyString(choice["icon"])) {
            push(
              "invalid_choice",
              `${cp}.emoji`,
              "An answer can show an emoji or an icon, not both. Clear one of them.",
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
              "'Image alt' is required once an answer has an image — it is what a screen reader says. Describe the image.",
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

    // Rework §6.4 — defaults for choice groups. A single-select choice group
    // (default_kind 'choice' — Buttons / Icon cards / Image cards) may carry a
    // props.defaultValue that MUST be one of its choice values. A multi-select
    // (MultiChoiceCardGroup) has NO default in v1 — a defaultValue there is a
    // save error. Dropdown/YesNo/Slider keep their EXISTING default handling
    // (untouched here). config-dto projects props.defaultValue → default_answer.
    if (props["defaultValue"] !== undefined) {
      if (type === "MultiChoiceCardGroup") {
        push(
          "invalid_field_prop",
          `${base}.props.defaultValue`,
          "Multi-select cards have no single default answer. Remove the default.",
        );
      } else if (cap.default_kind === "choice") {
        const choiceValues = new Set<string>(
          (Array.isArray(raw["choices"]) ? raw["choices"] : [])
            .filter(isRecord)
            .map((c) => c["value"])
            .filter(isChoicePrimitive)
            .map((v) => String(v)),
        );
        const dv = props["defaultValue"];
        if (isChoicePrimitive(dv) && !choiceValues.has(String(dv))) {
          push(
            "invalid_choice",
            `${base}.props.defaultValue`,
            `The default answer '${String(dv)}' is not one of this question's answers. Pick one of its answers, or clear the default.`,
          );
        }
      }
    }

    // Rework §6.5 — authored "Other" values (single-select choice groups only).
    if (props["other"] !== undefined) {
      validateOtherEditor(cap, props["other"], raw["choices"], `${base}.props.other`, push);
    }

    // valid_values (enum-like domain) when present: non-empty primitive array.
    if (raw["valid_values"] !== undefined) {
      const vv = raw["valid_values"];
      if (!Array.isArray(vv) || vv.length === 0 || !vv.every(isChoicePrimitive)) {
        push(
          "invalid_valid_values",
          `${base}.valid_values`,
          "'Valid values' must be a non-empty list of values. Enter at least one, or remove the field.",
        );
      }
    }

    // answer_type must agree with the catalog `produces` (when it emits one).
    // Rework §6.8 carve-out: a dual_range / from_to Slider produces an OBJECT
    // (two {base}_min/{base}_max number sub-fields, like Address), overriding
    // the range family's scalar `produces: "number"`. Any OTHER mismatch still
    // errors — this is the ONE authored answer_type that legitimately differs
    // from the catalog default, and it fixes (not reintroduces) the Image9
    // answer_type_mismatch failure class.
    const answerType = raw["answer_type"];
    if (answerType !== undefined && catalog.produces !== null && answerType !== catalog.produces) {
      const sliderType = props["slider_type"];
      const dualSliderObject =
        cap.slider_type &&
        typeof sliderType === "string" &&
        SLIDER_OBJECT_TYPE_SET.has(sliderType) &&
        answerType === "object";
      if (!dualSliderObject) {
        push(
          "answer_type_mismatch",
          `${base}.answer_type`,
          `'${leadgenControlLabel("answer_type")}' must be '${catalog.produces}' for a ${leadgenComponentName(type)} — you set '${String(answerType)}'. Remove it, or change it to match.`,
        );
      }
    }

    // conditional (§12.3): shape + referenced field must exist in the Section.
    if (raw["conditional"] !== undefined) {
      validateConditional(raw["conditional"], `${base}.conditional`, knownFields, push);
    }

    // design_overrides: curated keys only; token/scalar values, never CSS.
    if (raw["design_overrides"] !== undefined) {
      validateDesignOverridesBag(raw["design_overrides"], base, push);
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
    push("conditional_invalid", path, "The 'Show this component IF' rule must be set up correctly. Remove it, or set it up again.");
    return;
  }
  // Round-4 A-4 (P2a composed groups): a group is detected STRUCTURALLY by an
  // array `conditions` — the SAME discriminator the runtime + server evaluators
  // use (runtime/dependencies.ts isConditionGroup / payload.ts), so authoring
  // and evaluation can never disagree on which shape a slot carries. `match` ∈
  // {all, any}; every inner condition is validated EXACTLY as a bare conditional
  // (recursively, so nested groups + unknown-field/op/value checks all apply).
  // A bare conditional never carries `conditions`, so the legacy path below is
  // byte-identical for pre-A-4 content. P2a owns the evaluators (both already
  // handle both shapes) — this widens only the save-time AUTHORING gate.
  if (Array.isArray(raw["conditions"])) {
    const match = raw["match"];
    if (match !== undefined && match !== "all" && match !== "any") {
      push("conditional_invalid", `${path}.match`, "A rule group's 'Match' must be 'ALL' or 'ANY'. Pick one of those.");
    }
    const conditions = raw["conditions"];
    for (let i = 0; i < conditions.length; i++) {
      validateConditional(conditions[i], `${path}.conditions[${i}]`, knownFields, push);
    }
    return;
  }
  const when = raw["when"];
  if (!isNonEmptyString(when)) {
    push(
      "conditional_invalid",
      `${path}.when`,
      "The 'Show this component IF' rule needs a field to depend on. Pick a field, or remove the rule.",
    );
  } else if (!knownFields.has(when)) {
    push(
      "conditional_unknown_field",
      `${path}.when`,
      `The 'Show this component IF' rule depends on '${when}', which isn't a field in this Section. Point it at a real field, or remove the rule.`,
    );
  }
  // The enumerated raw comparison codes (eq/neq/gt/lt/gte/lte/…) are the SAME
  // still-open jargon the contract names as N2 (ui-rules-builder.ts) — out of
  // this fix's scope; only the "conditional.op" prefix below is fixed.
  const op = raw["op"];
  if (typeof op !== "string" || !CONDITION_OPS.has(op)) {
    push(
      "conditional_invalid",
      `${path}.op`,
      `'Condition operator' must be one of: ${[...CONDITION_OPS].join("|")}. Pick one of those.`,
    );
    return;
  }
  if (op === "range" && (typeof raw["from"] !== "number" || typeof raw["to"] !== "number")) {
    push(
      "conditional_invalid",
      path,
      "The Condition operator 'range' needs numeric values for both 'from' and 'to'. Enter both, or pick a different Condition operator.",
    );
  }
  if ((op === "in" || op === "not_in") && !Array.isArray(raw["values"])) {
    push(
      "conditional_invalid",
      path,
      `The Condition operator '${op}' needs a list of values. Enter at least one value, or pick a different Condition operator.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Round-4 P7 — THE shared answer-field enumerator + conditional-reference reader
// ---------------------------------------------------------------------------
//
// R2 P8-6 Q3 — an Address role's answer key is a property of the SECTION, not
// of the Address node alone. The renderer DECLINES a props.maps.fills.<slot>
// rename whose target another question in the same section already answers
// (presets.ts m9AddressRenderedFieldName): the box keeps the role's own
// `{base}_{slot}` so the two questions cannot post the same key. The helpers
// below read that resolution out instead of re-deciding it.
//
// MEASURED before this fix, on [ADDR(internal_field "addr", question_id
// "q_addr", props.maps.fills.zip "postal_code_x"), SIB(internal_field
// "postal_code_x")], from api/ via npx tsx:
//   renderSectionComponents  data-lg-field: addr addr_city addr_state addr_street addr_zip postal_code_x
//   collectKnownAnswerFields:              addr addr_city addr_state addr_street postal_code_x q_addr q_pcx
// — `addr_zip`, the key every visitor's ZIP box posts, was NOT in the universe,
// so a rule the operator forced onto it stored checkpoint_page: null and the
// rules rail warned "This rule can never apply". Naming BOTH names instead
// would charge the address a phantom `postal_code_x` (the P8-5 payload-builder
// defect): each role carries exactly ONE key, and the section decides which.
const ADDRESS_ANSWER_SLOTS = ["street", "city", "state", "zip"] as const;

// `${internal_field || question_id || 'address'}` — the same precedence
// presets.ts m9AddressBase and runtime/validation.ts addressBase use.
function addressAnswerBase(raw: Record<string, unknown>): string {
  const ifRaw = raw["internal_field"];
  if (typeof ifRaw === "string" && ifRaw.trim() !== "") return ifRaw.trim();
  return isNonEmptyString(raw["question_id"]) ? raw["question_id"] : "address";
}

function addressFillTargets(raw: Record<string, unknown>): Record<string, unknown> {
  const props = isRecord(raw["props"]) ? raw["props"] : {};
  const maps = isRecord(props["maps"]) ? props["maps"] : {};
  return isRecord(maps["fills"]) ? maps["fills"] : {};
}

// One role's authored rename target, or "" when the author named none.
function addressFillTargetFor(fills: Record<string, unknown>, slot: string): string {
  const f = fills[slot];
  return typeof f === "string" && f.trim() !== "" ? f.trim() : "";
}

// The key ONE Address role's box actually carries, given the keys the OTHER
// questions of the section answer: presets.ts m9AddressRenderedFieldName.
function addressRenderedRoleName(
  base: string,
  fills: Record<string, unknown>,
  slot: string,
  foreignAnswerKeys: ReadonlySet<string>,
): string {
  const own = `${base}_${slot}`;
  const named = addressFillTargetFor(fills, slot) || own;
  if (named === own) return own;
  return foreignAnswerKeys.has(named) ? own : named;
}

// props.fields[0]/[1], default 'first'/'last'.
function nameGroupPartNames(raw: Record<string, unknown>): [string, string] {
  const props = isRecord(raw["props"]) ? raw["props"] : {};
  const parts = Array.isArray(props["fields"]) ? props["fields"] : [];
  return [
    typeof parts[0] === "string" && parts[0].trim() !== "" ? parts[0].trim() : "first",
    typeof parts[1] === "string" && parts[1].trim() !== "" ? parts[1].trim() : "last",
  ];
}

// "Which keys does a node OTHER than this one answer?" — the section context
// addressRenderedRoleName needs, over the SAME leaf set (flattenComponents) and
// the SAME per-node derivation presets.ts collectAnswerKeyClaims uses at render
// time, so the universe and the markup cannot disagree:
//   * node OBJECT identity is the discriminator (flattenComponents pushes the
//     very nodes it was handed), so a node never sees its own keys as foreign;
//   * a ValidationError REPORTS on a field, it never answers one;
//   * claims are the UNSUPPRESSED union — BOTH a rename's target and the role's
//     own `{base}_{slot}` — because the suppression decision is what they feed.
// Returned as a lookup so a per-child caller (validateQuestionGridDependencies)
// can resolve one node against the WHOLE section rather than against itself.
export type LeadgenForeignAnswerKeyLookup = (node: object) => ReadonlySet<string>;

export function collectForeignAnswerKeyLookup(
  components: readonly unknown[],
): LeadgenForeignAnswerKeyLookup {
  const owners = new Map<string, object[]>();
  const claim = (key: unknown, node: object): void => {
    if (typeof key !== "string" || key.trim() === "") return;
    const k = key.trim();
    const list = owners.get(k);
    if (list === undefined) owners.set(k, [node]);
    else if (!list.includes(node)) list.push(node);
  };
  for (const leaf of flattenComponents(components as readonly LeadgenComponentNode[])) {
    if (!isRecord(leaf)) continue;
    if (leaf["type"] === "ValidationError") continue;
    claim(leaf["internal_field"], leaf);
    if (leaf["type"] === "AddressAutocompleteQuestion") {
      const base = addressAnswerBase(leaf);
      const fills = addressFillTargets(leaf);
      for (const slot of ADDRESS_ANSWER_SLOTS) {
        claim(`${base}_${slot}`, leaf);
        claim(addressFillTargetFor(fills, slot), leaf);
      }
    } else if (leaf["type"] === "NameFieldsGroup") {
      const [first, last] = nameGroupPartNames(leaf);
      claim(first, leaf);
      claim(last, leaf);
    }
  }
  const cache = new Map<object, ReadonlySet<string>>();
  return (node: object): ReadonlySet<string> => {
    const hit = cache.get(node);
    if (hit !== undefined) return hit;
    const out = new Set<string>();
    for (const [key, list] of owners) {
      if (list.some((owner) => owner !== node)) out.add(key);
    }
    cache.set(node, out);
    return out;
  };
}

// collectKnownAnswerFields is THE one field-set collector every server-side
// dependency gate consumes: save-time validateSectionContent (Pass 1 above) AND
// activation-time computeVariantPreflightBlocks (quotes-handlers.ts) both call
// it, so the two can never disagree on which fields exist. It expands the whole
// tree — every node's top-level internal_field / question_key / question_id,
// PLUS the MULTI-SUBFIELD classes that carry NO single internal_field yet each
// name a real answer a rule can reference:
//   * AddressAutocompleteQuestion — its four role sub-fields, each resolved the
//     way the RENDERER resolves it: a configured props.maps.fills.<slot> wins
//     UNLESS another question in this section already answers that key, in which
//     case the box (and so this universe) keeps the node-namespaced
//     `${internal_field || question_id || 'address'}_<slot>`;
//   * NameFieldsGroup — its first/last field names (props.fields[0]/[1], default
//     'first'/'last');
//   * a dual_range / from_to NumberRangeQuestion — its {base}_min / {base}_max.
// The derivation MATCHES P1a's studio-side internalFieldsOf/refFieldInfo
// (ui-section-studio.ts) EXACTLY, so the studio's rule-source picker, the save
// gate, and the activation gate all see the identical universe (Round-4 P7 kills
// the activation-only "Address/Name row is a missing field" 409). Depth-
// capped like every other tree walk (terminates on cyclic / over-deep junk).
export function collectKnownAnswerFields(components: readonly unknown[]): Set<string> {
  return knownAnswerFieldsIn(components, collectForeignAnswerKeyLookup(components));
}

// The same enumerator with the section context supplied from OUTSIDE, for a
// caller that must enumerate ONE node's own fields (a grid child) while still
// resolving its Address roles against the whole section.
function knownAnswerFieldsIn(
  components: readonly unknown[],
  foreignAnswerKeysFor: LeadgenForeignAnswerKeyLookup,
): Set<string> {
  const knownFields = new Set<string>();
  const walk = (nodes: readonly unknown[], depth: number): void => {
    for (const raw of nodes) {
      if (!isRecord(raw)) continue;
      // Rework §6.8: a dual_range / from_to Slider carries NO single answer
      // field — its answer space is {base}_min / {base}_max (each a number).
      // This MIRRORS answers.ts fieldsOf EXACTLY (the reviewer-flagged parity
      // requirement) so the save-time known-field universe, the activation
      // preflight, the config-dto projected universe, and normalization all see
      // the SAME two fields — and NOT the base internal_field.
      const isDualSlider = isDualRangeSlider(raw as { type?: unknown; internal_field?: unknown; props?: unknown });
      for (const key of ["internal_field", "question_key", "question_id"] as const) {
        if (key === "internal_field" && isDualSlider) continue; // expanded below, base excluded
        const v = raw[key];
        if (isNonEmptyString(v)) knownFields.add(v);
      }
      if (isDualSlider) {
        const base = raw["internal_field"] as string;
        knownFields.add(`${base}_min`);
        knownFields.add(`${base}_max`);
      }
      // Round-4 A-4 (P1b — P1a seam #1): the two MULTI-SUBFIELD question types
      // carry NO single internal_field, yet each sub-field IS a real answer a
      // rule can reference. Register them so a saved conditional whose `when`
      // names an Address role or a Name field passes validateConditional (no
      // conditional_unknown_field 400) — and, per Round-4 P7, so the activation
      // preflight recognizes them too. A configured props.maps.fills.<slot> wins
      // UNLESS a sibling question already answers that key (then the renderer
      // declines the rename and the box keeps its own name — see
      // addressRenderedRoleName), else the node is namespaced `${internal_field
      // || question_id || 'address'}_<slot>` (P1a default-seeds an Address's
      // internal_field to 'address', so its four roles default to
      // address_street/_city/_state/_zip).
      if (raw["type"] === "AddressAutocompleteQuestion") {
        const base = addressAnswerBase(raw);
        const fills = addressFillTargets(raw);
        const foreign = foreignAnswerKeysFor(raw);
        for (const slot of ADDRESS_ANSWER_SLOTS) {
          knownFields.add(addressRenderedRoleName(base, fills, slot, foreign));
        }
      }
      if (raw["type"] === "NameFieldsGroup") {
        const [first, last] = nameGroupPartNames(raw);
        knownFields.add(first);
        knownFields.add(last);
      }
      // R2 P1 §①: descend into the QuestionGrid exactly like a §8.5 container
      // — its child questions each name a REAL answer field, so the rules
      // pickers, the save gate and the activation preflight all see them.
      if (
        isChildrenBearingType(raw["type"]) &&
        depth <= LEADGEN_MAX_CONTAINER_DEPTH &&
        Array.isArray(raw["children"])
      ) {
        walk(raw["children"], depth + 1);
      }
    }
  };
  walk(components, 1);
  return knownFields;
}

// Every field a `conditional` reads, across BOTH shapes: a BARE {when,op,…}
// yields its single `when`; a composed {match,conditions:[…]} group (Round-4 A-4
// / P2) yields EVERY inner condition's `when`, recursively (nested groups
// included). A group is detected STRUCTURALLY by an array `conditions` — the
// SAME discriminator validateConditional above and the runtime evaluator
// (dependencies.ts isConditionGroup) use, so authoring, evaluation, and the
// activation preflight can never disagree on which shape a slot carries. Round-4
// P7: the activation dependency-check consumes this so a composed rule's `when`s
// are validated too — the prior guard tested only a top-level string `when` and
// so skipped composed rules' dependency validation ENTIRELY. Depth-capped
// (defense in depth over the save-time-bounded shape).
export function conditionalFieldRefs(conditional: unknown): string[] {
  const out: string[] = [];
  const walk = (raw: unknown, depth: number): void => {
    if (!isRecord(raw) || depth > LEADGEN_MAX_CONTAINER_DEPTH + 1) return;
    if (Array.isArray(raw["conditions"])) {
      for (const inner of raw["conditions"]) walk(inner, depth + 1);
      return;
    }
    if (isNonEmptyString(raw["when"])) out.push(raw["when"]);
  };
  walk(conditional, 1);
  return out;
}
