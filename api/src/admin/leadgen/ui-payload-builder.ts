// LeadGen Offers editor — Payload / Request / Test tabs, REBUILT for the
// fix-contract v2.4 Payload Builder UX (docs/leadgen/fix-contract-v2.4/
// 06-payload-builder-ux-contract.md — B1–B12, C1, M2, B8-UI; 04 §§4.4–4.5
// UI halves). A non-technical operator authors everything visually; raw
// JSON exists ONLY behind explicit "Advanced raw JSON" disclosures.
//
//   * §6.1 three panes — left payload TREE (type icons, label, path tail,
//     required/mapped/error badges, expand/collapse, add/duplicate/move/
//     delete, search-filter-highlight; NO dotted-path typing — paths derive
//     from tree position + field name; renames rewrite descendants
//     atomically with a mapped-fields impact warning), center FIELD EDITOR
//     (name/label/type/source + the §§6.3–6.10 per-type panels), right
//     column (live JSON preview with current-node highlight, §6.11
//     validation summary, generated sample payload, last-Test chip).
//   * §6.2 grouped source picker (storage enums unchanged: answer | static |
//     computed | macro | placement | token). The flat 32-macro select is
//     GONE from normal mode (M2); the full list rides "Advanced macro"
//     optgroups that appear only while the field's Advanced drawer is open.
//   * §6.3/§6.4 value-map table (modal + inline compact projection of the
//     existing value_map object) + choiceDisplay ("Other" grouping, B9).
//   * §6.5 free-text mode · §6.6 date mode (formatDate transform emission —
//     never typed JSON) · §6.7 boolean output presets · §6.8 object/array
//     builders (flat dotted-path storage with numeric segments stays; the
//     UI hides path mechanics) · §6.9 default/fallback builder · §6.10
//     condition builder (supported evaluator ops ONLY — no contains, no OR).
//   * §6.11 validation panel — live "Schema has N issues." + per-row Jump
//     (expand ancestors, scroll, pulse, inline badges); Save/Test blocked
//     while blocking-class errors exist; the server's typed 400
//     schema_errors render through the SAME panel.
//   * §6.12 Test tab (C1) — generated sample-answer form (POST
//     …/payload/sample-answers), simulated-context panel (04 §4.7.2
//     overrides), placement picker (04 §4.5), environment select with an
//     explicit production confirm, pre-test validity gate, result view +
//     context_used echo. Raw JSON answers live behind Advanced and
//     round-trip with the form.
//
// Storage formats are UNCHANGED: the UI writes exactly the shapes
// payload.ts consumes (value_map / transform / conditional / default /
// fallback / valid_values / the flat dotted-path node list). choiceDisplay
// (§6.4) and per-field notes are additive node metadata the schema
// validator passes through. Unrepresentable raw edits flag the field
// "advanced-managed" and are preserved byte-for-byte on re-save.
//
// Every dynamic interpolation goes through escapeHtml; dynamic DOM is built
// exclusively with createElement/createTextNode (provider- and operator-
// controlled strings never meet innerHTML). Inline script is strict ES5.

import { escapeHtml } from "../templates/layout";
import { CANONICAL_MACROS } from "../../leadgen/macros";
import { COMPUTED_REGISTRY, LEADGEN_COMPUTED_KEYS } from "../../leadgen/computed";
import { LEADGEN_PAYLOAD_BLOCKING_ERROR_CODES } from "../../leadgen/payload";
import {
  LEADGEN_EXECUTION_MODES,
  LEADGEN_HEADER_VALUE_KINDS,
  LEADGEN_REQUEST_METHODS,
  LEADGEN_TOKEN_PLACEMENTS,
} from "../../leadgen/validation";
import { eligibilityReasonLabel } from "./ui-offers";
import type {
  LeadgenOfferApi,
  LeadgenOfferHeaderApi,
  LeadgenOfferPlacementApi,
} from "./db-types";

// Embedded-JSON hardening: `<` can never terminate the carrier <script> tag.
export function jsonForScriptTag(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function fieldError(name: string): string {
  return `<span class="form-error" data-error-for="${name}" hidden></span>`;
}

function options(
  values: ReadonlyArray<string>,
  selected: string,
  blankLabel: string | null,
): string {
  const blank =
    blankLabel !== null ? `<option value="">${escapeHtml(blankLabel)}</option>` : "";
  const opts = values
    .map((v) => {
      const sel = v === selected ? " selected" : "";
      return `<option value="${escapeHtml(v)}"${sel}>${escapeHtml(v)}</option>`;
    })
    .join("");
  return blank + opts;
}

// ---------------------------------------------------------------------------
// §6.2 — grouped source picker definition (SSR'd; exported for tests)
// ---------------------------------------------------------------------------

export interface PayloadSourceMember {
  // Storage encoding: "answer" | "static" | "placement" | "token" |
  // "macro:<name>" | "computed:<key>". The client splits on ":" and sets
  // { source, macro | computed } — enums unchanged.
  value: string;
  label: string;
  help: string;
}

export interface PayloadSourceGroup {
  group: string;
  advancedOnly: boolean;
  members: ReadonlyArray<PayloadSourceMember>;
}

function macroMember(name: string, label: string, help: string): PayloadSourceMember {
  return { value: `macro:${name}`, label, help };
}

// The §6.2 computed rendering helper: one registry entry rendered as
// `label — description (example)`. Reused by the §6.2 source-picker group
// AND the §6.9 default/fallback computed dropdowns so the two surfaces can
// never drift.
export function computedOptionLabel(key: string): string {
  const v = COMPUTED_REGISTRY[key];
  return v !== undefined ? `${v.label} — ${v.description} (${v.example})` : key;
}

// The §6.2 Computed group: one option per COMPUTED_REGISTRY entry rendered
// as `label — description (example)` (04 §4.4 — free-text keys are gone).
const COMPUTED_MEMBERS: ReadonlyArray<PayloadSourceMember> = LEADGEN_COMPUTED_KEYS.map(
  (key) => {
    const v = COMPUTED_REGISTRY[key];
    const label = computedOptionLabel(key);
    const help = v !== undefined ? `${v.label} — ${v.description}, e.g. ${v.example}` : key;
    return { value: `computed:${key}`, label, help };
  },
);

// Advanced-macro optgroups (M2): the full 32-canonical-macro list, grouped,
// visible ONLY while the field's Advanced drawer is open. Membership is
// asserted complete against CANONICAL_MACROS by the test suite.
const ADVANCED_MACRO_GROUPS: ReadonlyArray<{ group: string; macros: ReadonlyArray<string> }> = [
  {
    group: "Advanced macro · Request / Device",
    macros: [
      "ip", "ua", "url", "referer", "language", "country", "state", "city",
      "device", "os", "os_version", "browser", "browser_version",
    ],
  },
  {
    group: "Advanced macro · Traffic / URL",
    macros: [
      "utm_source", "utm_medium", "utm_content", "traffic_source", "placement",
      "sub1", "sub2", "sub3", "sub4", "sub5", "cpc", "fbclid", "fbc",
    ],
  },
  { group: "Advanced macro · Session / Page", macros: ["session_id", "click_id", "page", "lander_v"] },
  { group: "Advanced macro · Offer", macros: ["offer_id", "offer_name"] },
];

// The 9 §6.2 UI groups. Members OMITTED because no storage-faithful route
// exists today (documented gaps, never fake writes): Postal code (no
// canonical macro / computed key), page_view_id + funnel_attempt_id +
// auction_instance_id (not canonical macros — 04 §4.3 projection).
export const PAYLOAD_SOURCE_GROUPS: ReadonlyArray<PayloadSourceGroup> = [
  {
    group: "User answer",
    advancedOnly: false,
    members: [
      {
        value: "answer",
        label: "Answer from a Section field",
        help: "A visitor's answer — pick the Section field below; its internal value feeds this payload field.",
      },
    ],
  },
  {
    group: "Static value",
    advancedOnly: false,
    members: [
      {
        value: "static",
        label: "Static value",
        help: "A fixed value you type — sent the same on every request.",
      },
    ],
  },
  {
    group: "Request / Cloudflare",
    advancedOnly: false,
    members: [
      macroMember("ip", "IP address", "IP address — the visitor's IP at request time, e.g. 203.0.113.7"),
      macroMember("ua", "User agent", "User agent — the visitor's browser user-agent string."),
      macroMember("referer", "Referrer URL", "Referrer URL — the page that linked the visitor here."),
      macroMember("url", "Current URL", "Current URL — the funnel page URL at request time."),
      macroMember("country", "Country", "Country — 2-letter code from the Cloudflare edge, e.g. US."),
      macroMember("state", "State / Region", "State/Region — region code from the Cloudflare edge, e.g. CA."),
      macroMember("city", "City", "City — the visitor's city from the Cloudflare edge."),
      {
        value: "computed:timezone",
        label: "Timezone",
        help: "Timezone — the visitor's IANA timezone from the Cloudflare edge, e.g. Europe/Berlin.",
      },
      macroMember("language", "Language", "Language — first accept-language tag, e.g. en-US."),
    ],
  },
  {
    group: "Traffic / URL",
    advancedOnly: false,
    members: [
      macroMember("utm_source", "utm_source", "utm_source — the landing URL's utm_source param, e.g. facebook."),
      macroMember("utm_medium", "utm_medium", "utm_medium — the landing URL's utm_medium param, e.g. paid_social."),
      macroMember("utm_content", "utm_content", "utm_content — the landing URL's utm_content param (ad/creative id)."),
      macroMember("traffic_source", "Traffic source", "Traffic source — the landing URL's traffic_source param."),
      macroMember(
        "placement",
        "Placement (traffic param)",
        "placement — the landing URL's placement param; used ONLY when no Offer placement is in scope (04 §4.3).",
      ),
      macroMember("sub1", "sub1", "sub1 — tracking sub-id 1 from the landing URL."),
      macroMember("sub2", "sub2", "sub2 — tracking sub-id 2 from the landing URL."),
      macroMember("sub3", "sub3", "sub3 — tracking sub-id 3 from the landing URL."),
      macroMember("sub4", "sub4", "sub4 — tracking sub-id 4 from the landing URL."),
      macroMember("sub5", "sub5", "sub5 — tracking sub-id 5 from the landing URL."),
      macroMember("cpc", "CPC", "cpc — the click cost param from the landing URL, e.g. 1.25."),
      macroMember("fbclid", "fbclid", "fbclid — the Facebook click id param."),
      macroMember("fbc", "fbc", "fbc — the Facebook click cookie value (derived from fbclid when absent)."),
    ],
  },
  {
    group: "Session",
    advancedOnly: false,
    members: [
      macroMember("session_id", "Session ID", "Session ID — the visitor's session id (ko_sid cookie)."),
    ],
  },
  {
    group: "Offer / Auction",
    advancedOnly: false,
    members: [
      macroMember("offer_id", "Offer ID", "Offer ID — this Offer's public id."),
      macroMember("offer_name", "Offer name", "Offer name — this Offer's display name."),
      {
        value: "placement",
        label: "Placement ID",
        help: "Placement ID — the participating Offer placement id (auction runtime picks the auction's placement; the Test tab uses your picked placement — 04 §4.5).",
      },
    ],
  },
  { group: "Computed", advancedOnly: false, members: COMPUTED_MEMBERS },
  {
    group: "Secret token",
    advancedOnly: false,
    members: [
      {
        value: "token",
        label: "API token (secret)",
        help: "The Offer's API token — resolved server-side from the configured secret ref; the value is always masked and never shown.",
      },
    ],
  },
  ...ADVANCED_MACRO_GROUPS.map((g) => ({
    group: g.group,
    advancedOnly: true,
    members: g.macros.map((m) => macroMember(m, m, `Canonical macro {${m}} — advanced use.`)),
  })),
];

// Every canonical macro must be reachable through the Advanced groups (M2:
// the flat select is gone, the FULL list must still exist somewhere).
const ADVANCED_MACRO_SET: ReadonlySet<string> = new Set(
  ADVANCED_MACRO_GROUPS.flatMap((g) => g.macros),
);
if (ADVANCED_MACRO_SET.size !== CANONICAL_MACROS.length) {
  // Compile-time-adjacent guard: fails loudly in tests if the registry and
  // the advanced groups ever drift (never silently drops a macro).
  throw new Error("ui-payload-builder: ADVANCED_MACRO_GROUPS must cover all canonical macros");
}

// ---------------------------------------------------------------------------
// §6.6 / §6.7 / §6.10 — emission tables (SSR'd as option values; exported
// for tests: the option values ARE the storage emissions)
// ---------------------------------------------------------------------------

// §6.6 date output formats → the EXISTING formatDate transform's format
// string (UTC tokens YYYY MM DD HH mm ss — payload.ts). "Unix timestamp" is
// OMITTED per the §6.10 unsupported-capability principle (omitted, never
// disabled-but-visible): formatDate's token set has no epoch token and no
// other transform kind can emit one, so the option is inexpressible at
// runtime. The vendored SSOT stays unpatched — the erratum is recorded in
// the traceability DEV register (contract-erratum route).
export const PAYLOAD_DATE_FORMATS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "YYYY-MM-DD", label: "YYYY-MM-DD (2026-07-08)" },
  { value: "MM/DD/YYYY", label: "MM/DD/YYYY (07/08/2026)" },
  { value: "DD/MM/YYYY", label: "DD/MM/YYYY (08/07/2026)" },
  { value: "YYYY-MM-DDTHH:mm:ssZ", label: "ISO-8601 (2026-07-08T14:00:00Z)" },
  { value: "__custom__", label: "Custom format…" },
];

// §6.7 boolean output presets. true_json/false_json are the JSON-encoded
// value_map outputs: selecting a preset writes value_map
// {"true": <true_json>, "false": <false_json>} — existing storage.
export const PAYLOAD_BOOLEAN_PRESETS: ReadonlyArray<{
  id: string;
  label: string;
  true_json: string;
  false_json: string;
}> = [
  { id: "bool", label: "true / false (boolean)", true_json: "true", false_json: "false" },
  { id: "str10", label: '"1" / "0" (string)', true_json: '"1"', false_json: '"0"' },
  { id: "num10", label: "1 / 0 (number)", true_json: "1", false_json: "0" },
  { id: "yn", label: '"Y" / "N"', true_json: '"Y"', false_json: '"N"' },
  { id: "yesno", label: '"yes" / "no"', true_json: '"yes"', false_json: '"no"' },
  { id: "custom", label: "Custom…", true_json: "", false_json: "" },
];

// §6.10 operator dropdown — the SUPPORTED evaluator ops only, with human
// labels, + is-empty / is-not-empty sugar (eq/neq against ""). contains /
// does-not-contain / OR are OMITTED entirely (the evaluator has neither —
// never disabled-but-visible).
export const PAYLOAD_CONDITION_OPS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "eq", label: "=" },
  { value: "neq", label: "≠" },
  { value: "gt", label: ">" },
  { value: "lt", label: "<" },
  { value: "gte", label: "≥" },
  { value: "lte", label: "≤" },
  { value: "range", label: "between" },
  { value: "in", label: "in list" },
  { value: "not_in", label: "not in list" },
  { value: "is_empty", label: "is empty" },
  { value: "is_not_empty", label: "is not empty" },
];

// ---------------------------------------------------------------------------
// §6.11 — validation code → operator fix hint (client adds label + hint over
// the server's schema_errors[{code,path,message}])
// ---------------------------------------------------------------------------

export const PAYLOAD_SCHEMA_ERROR_HINTS: Readonly<Record<string, string>> = {
  schema_not_object: "The schema JSON must be an object — re-open the Advanced drawer and fix the structure.",
  version_invalid: "The schema version must be a positive whole number.",
  root_invalid: "The schema root must be an object with a children list — rebuild from the tree.",
  node_not_object: "Every field entry must be an object — remove the broken entry.",
  path_invalid: "Field names may use letters, digits and underscores only (no spaces or dots).",
  path_duplicate: "Two fields resolved to the same place — rename one of them.",
  path_prefix_conflict: "A plain field and a nested group share a name — rename one, or change the field's type to object.",
  name_invalid: "Give the field a name (letters, digits, underscores).",
  name_path_mismatch: "The field name and its tree position disagree — rename the field to fix it.",
  type_invalid: "Pick one of the supported types for this field.",
  source_invalid: "Pick a value source for this field.",
  enum_valid_values_required: "A choice-list field needs at least one valid value — add them in the Valid values editor.",
  valid_values_invalid: "Valid values must be a list — re-add them in the Valid values editor.",
  enum_value_violation: "The default/fallback/static value must be one of the field's valid values.",
  answer_missing_internal_field: "Pick which Section answer feeds this field.",
  value_map_invalid: "The value map must be a set of internal → provider rows — re-open the Value map editor.",
  transform_invalid: "The transform is not a supported pipeline — fix it in the Advanced drawer.",
  static_missing_value: "Type the static value to send.",
  computed_missing_key: "Pick a computed variable from the list.",
  computed_unknown_key: "That computed key is not in the registry — pick one from the Computed dropdown.",
  macro_missing_name: "Pick which macro feeds this field.",
  macro_unknown: "That macro is not one of the canonical macros — pick one from the source list.",
  token_node_invalid: "A token field must be a plain string with no mapping — remove the extra settings.",
  token_node_duplicate: "Only one token field is allowed — delete the extra one.",
  conditional_invalid: "The condition is incomplete — pick a field, an operator and a value.",
  choice_display_invalid: "The Other-grouping settings reference values outside the field's value map — re-check the Main choices.",
  free_text_constraint_invalid:
    "The free-text limits are misconfigured — max length must be a positive whole number and a custom pattern must be a short, valid expression on a free-text field.",
};

// Blocking-class codes documented in the §6.11 panel footer — rendered from
// the payload.ts export (the server's own classification), never hardcoded.
export const PAYLOAD_BLOCKING_ERROR_CODES: ReadonlyArray<string> =
  LEADGEN_PAYLOAD_BLOCKING_ERROR_CODES;

// ---------------------------------------------------------------------------
// §6.12.2 — simulated-context defaults (a realistic US profile; keys are a
// subset of the Test handler's TEST_OVERRIDE_KEYS)
// ---------------------------------------------------------------------------

export const PAYLOAD_TEST_CONTEXT_DEFAULTS: ReadonlyArray<{
  key: string;
  label: string;
  value: string;
}> = [
  { key: "country", label: "Country", value: "US" },
  { key: "state", label: "State / Region", value: "CA" },
  { key: "city", label: "City", value: "Los Angeles" },
  { key: "postalCode", label: "Postal code", value: "90001" },
  { key: "timezone", label: "Timezone", value: "America/Los_Angeles" },
  { key: "ip", label: "IP address", value: "198.51.100.23" },
  {
    key: "ua",
    label: "User agent",
    value:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  },
  { key: "url", label: "Page URL", value: "https://quotes.example.com/funnel?utm_source=facebook" },
  { key: "referer", label: "Referrer", value: "https://www.facebook.com/" },
  { key: "language", label: "Language", value: "en-US" },
  { key: "utm_source", label: "utm_source", value: "facebook" },
  { key: "utm_medium", label: "utm_medium", value: "paid_social" },
  { key: "utm_content", label: "utm_content", value: "ad_variant_a" },
  { key: "traffic_source", label: "Traffic source", value: "facebook" },
  { key: "placement", label: "Placement (traffic param)", value: "feed" },
  { key: "sub1", label: "sub1", value: "" },
  { key: "sub2", label: "sub2", value: "" },
  { key: "sub3", label: "sub3", value: "" },
  { key: "sub4", label: "sub4", value: "" },
  { key: "sub5", label: "sub5", value: "" },
  { key: "cpc", label: "CPC", value: "1.25" },
  { key: "fbclid", label: "fbclid", value: "" },
  { key: "fbc", label: "fbc", value: "" },
];

// ---------------------------------------------------------------------------
// Shapes riding the SSR bootstrap islands
// ---------------------------------------------------------------------------

export interface PayloadBuilderSchemaInfo {
  version: number;
  source: string;
  schema: unknown;
  // Parsed carrier_parse_json of the ACTIVE version (0036: the parser is a
  // COLUMN on the schema-version row, so it versions WITH the schema) — null
  // when the version carries none. Prefills the §11.6/§11.7 parse panel.
  carrier_parse: unknown;
  // Inferred field paths of the ACTIVE version's sample_response_json
  // (the §11.6 response_field_paths mechanics, computed at SSR) — the
  // pick-source chips beside the parse panel. Empty when no sample exists.
  sample_paths: readonly string[];
}

// The additive Offer-GET builder_context (offers-handlers.ts
// offerBuilderContext — LANDED shape): linked_fields feed the §6.2
// User-answer picker, the §6.10 condition field dropdown and the §6.1
// rename impact warning; active_schema.nodes mirror the stored children.
export interface PayloadBuilderLinkedField {
  internal_field: string;
  section_public_id: string;
  section_name: string;
  answer_type: string;
  choice_count: number;
}

export interface PayloadBuilderContext {
  active_schema?: {
    id: number;
    public_id: string;
    version: number;
    nodes: unknown[];
  } | null;
  linked_fields?: PayloadBuilderLinkedField[];
}

export interface PayloadEligibilityVerdict {
  eligible: boolean;
  reasons: string[];
}

// The editor page hands the FULL offer detail object through (ui-offers.ts
// passes its OfferDetail): placements / eligibility / builder_context /
// last_test_at are additive-optional so the widened type stays assignable
// from every caller.
export type PayloadBuilderOffer = LeadgenOfferApi & {
  placements?: readonly LeadgenOfferPlacementApi[];
  eligibility?: PayloadEligibilityVerdict | null;
  builder_context?: PayloadBuilderContext | null;
  // §6.1: ISO timestamp of the newest TEST-TOOL provider-log row
  // (offers-handlers offerLastTestAt) — null when the Offer was never tested.
  last_test_at?: string | null;
};

export interface PayloadPanelProps {
  offer: PayloadBuilderOffer;
  activeSchema: PayloadBuilderSchemaInfo | null;
  schemasCount: number;
  loadError: string | null;
}

// ---------------------------------------------------------------------------
// §6.2 — the grouped source <select> (SSR'd inside the field-editor template)
// ---------------------------------------------------------------------------

function renderSourcePicker(): string {
  const groups = PAYLOAD_SOURCE_GROUPS.map((g) => {
    const adv = g.advancedOnly ? ' data-advanced-only="1"' : "";
    const members = g.members
      .map(
        (m) =>
          `<option value="${escapeHtml(m.value)}" data-help="${escapeHtml(m.help)}"${g.advancedOnly ? ' data-advanced-only="1"' : ""}>${escapeHtml(m.label)}</option>`,
      )
      .join("");
    return `<optgroup label="${escapeHtml(g.group)}"${adv}>${members}</optgroup>`;
  }).join("");
  return `<select class="form-select" data-pb-field="source" data-pb-source-select aria-label="Field value source">${groups}</select>`;
}

// ---------------------------------------------------------------------------
// §6.1 — the field-editor template (cloned per selected node by the island)
// ---------------------------------------------------------------------------

function renderEditorTemplate(): string {
  const typeOptions = [
    { value: "string", label: "Text (string)" },
    { value: "number", label: "Number" },
    { value: "boolean", label: "Yes / No (boolean)" },
    { value: "date", label: "Date" },
    { value: "object", label: "Object (group of fields)" },
    { value: "array", label: "List (array)" },
    // Legacy enum-typed nodes still load + edit; new fields use string +
    // valid values / value map. Hidden unless the node already is one.
    { value: "enum", label: "Choice list (enum, legacy)" },
  ]
    .map(
      (t) =>
        `<option value="${t.value}"${t.value === "enum" ? ' data-legacy-only="1"' : ""}>${escapeHtml(t.label)}</option>`,
    )
    .join("");
  const dateFormatOptions = PAYLOAD_DATE_FORMATS.map(
    (f) => `<option value="${escapeHtml(f.value)}">${escapeHtml(f.label)}</option>`,
  ).join("");
  const booleanPresetOptions = PAYLOAD_BOOLEAN_PRESETS.map(
    (p) =>
      `<option value="${p.id}" data-true-json="${escapeHtml(p.true_json)}" data-false-json="${escapeHtml(p.false_json)}">${escapeHtml(p.label)}</option>`,
  ).join("");
  const conditionOpOptions = PAYLOAD_CONDITION_OPS.map(
    (o) => `<option value="${o.value}">${escapeHtml(o.label)}</option>`,
  ).join("");
  const defaultModeOptions = `
      <option value="disabled">Disabled</option>
      <option value="static">Static value</option>
      <option value="computed">Computed value</option>
      <option value="copy">Copied from another field</option>`;
  // §6.9 computed dropdown for both slots — rendered through the SAME §6.2
  // computed helper (label — description (example)); emits the TYPED object
  // {source:"computed", key} into default/fallback.
  const computedValueOptions = LEADGEN_COMPUTED_KEYS.map(
    (key) => `<option value="${escapeHtml(key)}">${escapeHtml(computedOptionLabel(key))}</option>`,
  ).join("");
  return `<template id="lg-pb-editor-template">
  <div class="lg-pb-editor-body" data-pb-editor-body>
    <p class="form-error" data-pb-node-error hidden></p>
    <p class="alert alert-warning" data-pb-rename-impact hidden></p>
    <span class="badge badge-draft lg-pb-advmanaged" data-pb-advanced-managed hidden title="This field carries raw-JSON settings the visual editor preserves but cannot fully represent.">advanced-managed</span>
    <div class="lg-pb-grid">
      <div><label class="form-label">Name *</label>
        <input type="text" class="form-input" data-pb-field="name" aria-label="Field name" />
        <span class="form-help">The JSON key. The tree position decides the full path — no dotted paths to type.</span></div>
      <div><label class="form-label">Label</label>
        <input type="text" class="form-input" data-pb-field="label" aria-label="Field label" placeholder="Shown in the tree" /></div>
      <div><label class="form-label">Type</label>
        <select class="form-select" data-pb-field="type" aria-label="Field type">${typeOptions}</select></div>
      <div class="lg-pb-required-cell"><label class="form-label lg-pb-required"><input type="checkbox" data-pb-field="required" /> Required</label></div>
    </div>
    <div class="form-group">
      <label class="form-label">Source</label>
      ${renderSourcePicker()}
      <p class="form-help" data-pb-source-help></p>
    </div>

    <div data-pb-panel="answer" hidden>
      <label class="form-label">Section field *</label>
      <input type="search" class="form-input" data-pb-answer-search placeholder="Search Section fields…" aria-label="Search Section fields" />
      <select class="form-select" data-pb-answer-picker aria-label="Section answer field"></select>
      <input type="text" class="form-input" data-pb-answer-manual placeholder="internal_field (no Sections linked yet)" aria-label="Internal field name" hidden />
      <p class="form-help" data-pb-answer-meta></p>
    </div>

    <div data-pb-panel="static" hidden>
      <label class="form-label">Static value *</label>
      <input type="text" class="form-input" data-pb-static="text" aria-label="Static text value" />
      <input type="number" class="form-input" data-pb-static="number" aria-label="Static number value" hidden />
      <select class="form-select" data-pb-static="boolean" aria-label="Static boolean value" hidden>
        <option value="true">true</option><option value="false">false</option>
      </select>
      <input type="date" class="form-input" data-pb-static="date" aria-label="Static date value" hidden />
    </div>

    <div data-pb-panel="token" hidden>
      <p class="form-help" data-pb-token-note></p>
    </div>

    <div data-pb-panel="freetext" hidden>
      <label class="form-label lg-pb-required"><input type="checkbox" data-pb-field="free_text" /> Free text (no fixed answer list)</label>
      <p class="form-help">Free text: the value-map table and valid-values chips are off — the visitor's text is sent as typed (trimmed, control characters stripped, coerced to text). Required, default and fallback still apply.</p>
      <p class="form-help" data-pb-freetext-note hidden>This field is in free-text mode — mapping is disabled.</p>
      <div data-pb-freetext-constraints hidden>
        <div class="lg-pb-grid-2">
          <div><label class="form-label">Max length (optional)</label>
            <input type="number" min="1" step="1" class="form-input" data-pb-field="free_text_max_length" aria-label="Free text max length" placeholder="No limit" /></div>
          <div><label class="form-label">Pattern (optional)</label>
            <select class="form-select" data-pb-field="free_text_pattern" aria-label="Free text pattern preset">
              <option value="none">None</option>
              <option value="letters">Letters only</option>
              <option value="digits">Digits only</option>
              <option value="custom">Custom&#8230;</option>
            </select>
            <input type="text" class="form-input" data-pb-field="free_text_pattern_custom" placeholder="e.g. ^[A-Z]{2}[0-9]{4}$" aria-label="Custom pattern" hidden /></div>
        </div>
        <p class="form-help">Text that is too long or does not match the pattern is INVALID at runtime &#8658; the field's fallback is sent instead (never the raw text).</p>
      </div>
    </div>

    <div data-pb-panel="valuemap" hidden>
      <h4 class="form-label">Value map</h4>
      <div class="lg-pb-vm-compact-wrap"><table class="lg-pb-vm-table lg-pb-vm-compact" data-pb-valuemap-compact aria-label="Value map (compact)">
        <thead><tr><th>Internal normalized value</th><th>Provider output value</th><th>Main choice?</th></tr></thead>
        <tbody></tbody>
      </table></div>
      <p class="form-help" data-pb-valuemap-empty hidden>No mapped values yet — open the editor to add rows, paste many, or import a CSV.</p>
      <div class="lg-pb-actions-row">
        <button type="button" class="btn btn-secondary btn-sm" data-pb-valuemap-open>Open value map editor</button>
        <span class="lg-pb-chip" data-pb-choice-chips hidden></span>
      </div>
      <p class="alert alert-warning" data-pb-main-warn hidden></p>
      <div class="lg-pb-other-controls">
        <label class="form-label lg-pb-required"><input type="checkbox" data-pb-field="otherGroupEnabled" /> Group extra choices under &quot;Other&quot;</label>
        <input type="text" class="form-input" data-pb-field="otherGroupLabel" placeholder="Other" aria-label="Other group label" />
        <label class="form-label lg-pb-required"><input type="checkbox" data-pb-field="searchableOther" /> Searchable &quot;Other&quot; panel</label>
      </div>
      <p class="form-help">A value the map misses is INVALID at runtime — invalid falls to the field's fallback (miss &#8658; invalid &#8658; fallback).</p>
    </div>

    <div data-pb-panel="validvalues" hidden>
      <h4 class="form-label">Valid values (allow-list)</h4>
      <div class="lg-pb-chips" data-pb-validvalues-chips></div>
      <input type="text" class="form-input" data-pb-validvalues-input placeholder="Type a value and press Enter" aria-label="Add valid value" />
      <p class="form-help">Optional for text fields; required for legacy choice-list fields. A value outside the list is invalid &#8658; fallback.</p>
    </div>

    <div data-pb-panel="date" hidden>
      <h4 class="form-label">Date output format</h4>
      <select class="form-select" data-pb-field="date_format" aria-label="Provider date format">${dateFormatOptions}</select>
      <input type="text" class="form-input" data-pb-field="date_format_custom" placeholder="e.g. YYYY/MM/DD HH:mm" aria-label="Custom date format" hidden />
      <p class="form-help">Tokens: YYYY MM DD HH mm ss (UTC). Stored as the formatDate transform — no JSON to type.</p>
      <div class="lg-pb-grid-2">
        <div><label class="form-label">Try a sample date</label><input type="date" class="form-input" data-pb-date-sample aria-label="Sample date input" /></div>
        <div><label class="form-label">Output preview</label><span class="lg-pb-chip" data-pb-date-preview>&#8212;</span></div>
      </div>
      <p class="form-help" data-pb-date-invalid-note hidden>An invalid or empty date is INVALID at runtime &#8658; the field's fallback is sent instead.</p>
    </div>

    <div data-pb-panel="boolean" hidden>
      <h4 class="form-label">Boolean output</h4>
      <select class="form-select" data-pb-field="bool_preset" aria-label="Boolean output preset">${booleanPresetOptions}</select>
      <div class="lg-pb-grid-2" data-pb-bool-custom hidden>
        <div><label class="form-label">When yes / true send</label><input type="text" class="form-input" data-pb-bool-true aria-label="Custom true output" /></div>
        <div><label class="form-label">When no / false send</label><input type="text" class="form-input" data-pb-bool-false aria-label="Custom false output" /></div>
        <p class="form-help">Typed by the field type: number fields send numbers, text fields send text.</p>
      </div>
      <p class="form-help">Preview: yes &#8594; <span class="lg-pb-chip" data-pb-bool-chip-true></span> &#183; no &#8594; <span class="lg-pb-chip" data-pb-bool-chip-false></span></p>
    </div>

    <div data-pb-panel="object" hidden>
      <p class="form-help">A group of nested fields. Children ride under it in the tree.</p>
      <button type="button" class="btn btn-secondary btn-sm" data-pb-add-child>+ Add child field</button>
      <h4 class="form-label">Generated JSON for this group</h4>
      <pre class="lg-json-pre lg-pb-subtree" data-pb-subtree-preview aria-label="Subtree JSON preview"></pre>
    </div>

    <div data-pb-panel="array" hidden>
      <div class="lg-pb-grid-2">
        <div><label class="form-label">Item type</label>
          <select class="form-select" data-pb-field="array_item_type" aria-label="Array item type">
            <option value="string">Text</option><option value="number">Number</option>
            <option value="boolean">Yes / No</option><option value="date">Date</option>
            <option value="object">Object</option>
          </select></div>
        <div><label class="form-label">List source</label>
          <select class="form-select" data-pb-field="array_source" aria-label="Array source">
            <option value="static_list">Static list</option>
            <option value="multi_answer">Multi-select answer</option>
            <option value="repeated_group">Repeated answer group</option>
          </select>
          <p class="form-help">Computed and split-string lists have no runtime support yet (no computed variable emits a list; no split transform exists), so those options are not offered.</p></div>
      </div>
      <div data-pb-array-panel="static_list" hidden>
        <div class="lg-pb-chips" data-pb-array-static-chips></div>
        <input type="text" class="form-input" data-pb-array-static-input placeholder="Type an item and press Enter" aria-label="Add list item" />
      </div>
      <div data-pb-array-panel="multi_answer" hidden>
        <p class="form-help">The multi-select answer's values are sent as the list. Pick the Section field in the Source panel above (source = User answer).</p>
      </div>
      <div data-pb-array-panel="repeated_group" hidden>
        <p class="form-help">Item objects ride as children in the tree (item 1, item 2, &#8230;) — each item's fields map to their own answers (e.g. driver_1_age, driver_2_age).</p>
        <button type="button" class="btn btn-secondary btn-sm" data-pb-array-add-item>+ Add item</button>
      </div>
      <p class="form-help">The tree shows the list's items as <code>items[]</code> children — you never type index paths.</p>
    </div>

    <div data-pb-panel="defaults" hidden>
      <div class="lg-pb-grid-2">
        <div>
          <h4 class="form-label">Default when absent</h4>
          <select class="form-select" data-pb-default-mode aria-label="Default mode">${defaultModeOptions}</select>
          <div data-pb-default-inputs hidden>
            <input type="text" class="form-input" data-pb-default-value="text" aria-label="Default text value" />
            <input type="number" class="form-input" data-pb-default-value="number" aria-label="Default number value" hidden />
            <select class="form-select" data-pb-default-value="boolean" aria-label="Default boolean value" hidden><option value="true">true</option><option value="false">false</option></select>
            <input type="date" class="form-input" data-pb-default-value="date" aria-label="Default date value" hidden />
          </div>
          <div data-pb-default-computed-wrap hidden>
            <select class="form-select" data-pb-default-computed aria-label="Default computed variable">${computedValueOptions}</select>
            <p class="form-help">The computed value is resolved at request time (e.g. today&#39;s date) and sent when the answer is absent.</p>
          </div>
          <div data-pb-default-copy-wrap hidden>
            <select class="form-select" data-pb-default-copy-from aria-label="Copy default from field"></select>
            <button type="button" class="btn btn-outline btn-sm" data-pb-default-copy>Copy its value now</button>
            <p class="form-help">Copies that field's current static/default value into this default (a one-time copy, not a live link).</p>
          </div>
          <p class="form-help" data-pb-default-loose hidden></p>
        </div>
        <div>
          <h4 class="form-label">Fallback when invalid</h4>
          <select class="form-select" data-pb-fallback-mode aria-label="Fallback mode">${defaultModeOptions}</select>
          <div data-pb-fallback-inputs hidden>
            <input type="text" class="form-input" data-pb-fallback-value="text" aria-label="Fallback text value" />
            <input type="number" class="form-input" data-pb-fallback-value="number" aria-label="Fallback number value" hidden />
            <select class="form-select" data-pb-fallback-value="boolean" aria-label="Fallback boolean value" hidden><option value="true">true</option><option value="false">false</option></select>
            <input type="date" class="form-input" data-pb-fallback-value="date" aria-label="Fallback date value" hidden />
          </div>
          <div data-pb-fallback-computed-wrap hidden>
            <select class="form-select" data-pb-fallback-computed aria-label="Fallback computed variable">${computedValueOptions}</select>
            <p class="form-help">The computed value is resolved at request time and sent when the answer is invalid.</p>
          </div>
          <div data-pb-fallback-copy-wrap hidden>
            <select class="form-select" data-pb-fallback-copy-from aria-label="Copy fallback from field"></select>
            <button type="button" class="btn btn-outline btn-sm" data-pb-fallback-copy>Copy its value now</button>
            <p class="form-help">Copies that field's current static/default value into this fallback (a one-time copy, not a live link).</p>
          </div>
          <p class="form-help" data-pb-fallback-loose hidden></p>
        </div>
      </div>
      <p class="form-help">Inputs always match the field type — no JSON guessing.</p>
    </div>

    <div data-pb-panel="condition" hidden>
      <h4 class="form-label">Send this field only when&#8230;</h4>
      <select data-pb-cond-op-template hidden aria-hidden="true">${conditionOpOptions}</select>
      <div data-pb-condition-rows></div>
      <button type="button" class="btn btn-secondary btn-sm" data-pb-condition-add>+ Add condition</button>
      <p class="lg-pb-cond-preview" data-pb-cond-preview hidden></p>
      <p class="form-help">Need OR (either / or)? Create a second field with its own condition. Conditions on one field combine with AND; today one condition per field is stored.</p>
    </div>

    <div class="form-group" data-pb-panel="notes">
      <label class="form-label">Notes</label>
      <textarea class="form-textarea" rows="2" data-pb-field="notes" aria-label="Field notes" placeholder="Operator notes (saved with the schema)"></textarea>
    </div>

    <details class="lg-advanced-drawer" data-lg-advanced data-pb-advanced>
      <summary>Advanced raw JSON (this field)</summary>
      <p class="form-help">The stored field object — value_map / transform / conditional included. While this drawer is open the Source list also offers the full Advanced-macro groups. Edits round-trip into the visual editors; anything they cannot represent keeps riding the schema untouched and flags the field advanced-managed.</p>
      <textarea class="form-textarea" rows="8" data-pb-field-raw data-raw-json aria-label="Raw field JSON"></textarea>
      <span class="form-error" data-pb-field-raw-error hidden></span>
      <div class="modal-actions"><button type="button" class="btn btn-secondary btn-sm" data-pb-field-raw-apply>Apply raw JSON to this field</button></div>
    </details>

    <div class="lg-pb-editor-actions">
      <button type="button" class="btn btn-outline btn-sm" data-pb-duplicate>Duplicate</button>
      <button type="button" class="btn btn-outline btn-sm" data-pb-move="up">Move up</button>
      <button type="button" class="btn btn-outline btn-sm" data-pb-move="down">Move down</button>
      <button type="button" class="btn btn-danger btn-sm" data-pb-delete>Delete field</button>
    </div>
  </div>
</template>`;
}

// ---------------------------------------------------------------------------
// §6.3 — value-map modal (SSR shell; rows are JS-built)
// ---------------------------------------------------------------------------

function renderValueMapModal(): string {
  // The 8 §6.3 columns EXACTLY, in order, + an actions column.
  const cols: ReadonlyArray<{ key: string; label: string; sortable: boolean }> = [
    { key: "display_label", label: "Display label", sortable: true },
    { key: "internal", label: "Internal normalized value", sortable: true },
    { key: "output", label: "Provider output value", sortable: true },
    { key: "output_type", label: "Output type", sortable: true },
    { key: "main", label: "Main choice?", sortable: true },
    { key: "other", label: "Other group?", sortable: false },
    { key: "analytics_label", label: "Analytics label", sortable: false },
    { key: "notes", label: "Notes", sortable: false },
  ];
  const headCells = cols
    .map(
      (c) =>
        `<th scope="col" data-vm-col="${c.key}"${c.sortable ? " data-vm-sort role=\"button\" tabindex=\"0\" title=\"Sort by this column\"" : ""}>${escapeHtml(c.label)}</th>`,
    )
    .join("");
  return `<div id="lg-pb-valuemap-modal" class="modal hidden" style="display:none;" role="dialog" aria-modal="true" aria-labelledby="lg-pb-vm-title" aria-hidden="true">
  <div class="modal-content lg-pb-vm-content">
    <h2 id="lg-pb-vm-title" class="modal-title">Value map &#8212; <span data-vm-field-label></span></h2>
    <div class="lg-pb-actions-row">
      <button type="button" class="btn btn-secondary btn-sm" data-vm-add>Add value</button>
      <button type="button" class="btn btn-secondary btn-sm" data-vm-add-many>Add many</button>
      <button type="button" class="btn btn-secondary btn-sm" data-vm-bulk>Bulk paste</button>
      <label class="btn btn-secondary btn-sm lg-pb-file-btn">Import CSV<input type="file" id="lg-pb-vm-csv" data-vm-csv accept=".csv,text/csv" hidden aria-label="Import value map CSV" /></label>
      <input type="search" class="form-input lg-pb-vm-search" data-vm-search placeholder="Search values…" aria-label="Search value map rows" />
    </div>
    <div data-vm-add-many-wrap hidden>
      <label class="form-label">One mapping per line: <code>internal=provider</code></label>
      <textarea class="form-textarea" rows="5" data-vm-add-many-text aria-label="Add many mappings" placeholder="homeowner=H&#10;renter=R"></textarea>
      <div class="modal-actions"><button type="button" class="btn btn-secondary btn-sm" data-vm-add-many-apply>Add these rows</button></div>
    </div>
    <div data-vm-csv-map hidden>
      <p class="form-help">Map the CSV columns, then import. The first row is treated as headers.</p>
      <div class="lg-pb-grid-2">
        <div><label class="form-label">Internal value column</label><select class="form-select" data-vm-csv-col="internal"></select></div>
        <div><label class="form-label">Provider output column</label><select class="form-select" data-vm-csv-col="output"></select></div>
        <div><label class="form-label">Main-choice column (optional)</label><select class="form-select" data-vm-csv-col="main"></select></div>
      </div>
      <div class="modal-actions"><button type="button" class="btn btn-secondary btn-sm" data-vm-csv-apply>Import rows</button></div>
    </div>
    <div class="lg-pb-vm-count"><span class="lg-pb-chip" data-vm-count-chips></span> <span class="form-error" data-vm-main-warn hidden></span></div>
    <div class="table-wrapper lg-pb-vm-scroll"><table class="lg-pb-vm-table" data-vm-table aria-label="Value map">
      <thead><tr>${headCells}<th scope="col">Actions</th></tr></thead>
      <tbody data-vm-rows></tbody>
    </table></div>
    <p class="alert alert-warning" data-vm-unmapped-warning hidden></p>
    <p class="form-help">A visitor value the map misses is INVALID at runtime &#8658; the field's fallback is sent (miss &#8658; invalid &#8658; fallback).</p>
    <div class="modal-actions">
      <button type="button" class="btn btn-primary" data-vm-apply>Apply to field</button>
      <button type="button" class="btn btn-secondary" data-vm-cancel>Cancel</button>
    </div>
  </div>
</div>`;
}

// ---------------------------------------------------------------------------
// §6.1 — the Payload tab panel (three-pane shell)
// ---------------------------------------------------------------------------

// §6.1 chip timestamp: compact UTC form of the offer's last_test_at ISO
// string ("2026-07-08 14:00 UTC" — the SSR sibling of the live-run chip's
// local "at HH:MM"). Unparseable input renders verbatim (never a crash).
function formatTestTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

// Derives the SSR last-Test chip state from the server eligibility verdict
// (state stays eligibility-derived; the additive last_test_at timestamp
// dresses the passed/failed states as `passed <ts>` / `failed <ts>` —
// §6.1). A live run updates the chip with the run time client-side.
function testChip(offer: PayloadBuilderOffer): { status: string; text: string } {
  const reasons = offer.eligibility?.reasons ?? [];
  const ts =
    typeof offer.last_test_at === "string" && offer.last_test_at !== ""
      ? ` at ${formatTestTimestamp(offer.last_test_at)}`
      : "";
  if (reasons.indexOf("test_untested") !== -1) {
    return { status: "untested", text: `Test: untested — ${eligibilityReasonLabel("test_untested")}` };
  }
  if (reasons.indexOf("test_failed") !== -1) {
    return { status: "failed", text: `Test: failed${ts} — ${eligibilityReasonLabel("test_failed")}` };
  }
  if (offer.eligibility === undefined || offer.eligibility === null) {
    return { status: "untested", text: "Test: untested" };
  }
  return { status: "passed", text: `Test: passed${ts}` };
}

export function renderPayloadPanel(props: PayloadPanelProps): string {
  const active = props.activeSchema;
  const offer = props.offer;
  const metaText =
    active !== null
      ? `Active schema: v${active.version} (${active.source})`
      : "No payload schema yet — build one below.";
  const loadErrorHtml = props.loadError
    ? `<p class="alert alert-error" role="alert">${escapeHtml(props.loadError)}</p>`
    : "";
  const chip = testChip(offer);
  const blob = jsonForScriptTag({
    active_schema: active,
    schemas_count: props.schemasCount,
    builder_context: offer.builder_context ?? null,
    error_hints: PAYLOAD_SCHEMA_ERROR_HINTS,
    blocking_codes: PAYLOAD_BLOCKING_ERROR_CODES,
    computed_options: LEADGEN_COMPUTED_KEYS.map((key) => {
      const v = COMPUTED_REGISTRY[key];
      return {
        key,
        label: v?.label ?? key,
        description: v?.description ?? "",
        example: v?.example ?? "",
        output_type: v?.outputType ?? "string",
      };
    }),
    offer: {
      public_id: offer.public_id,
      api_token_secret_ref: offer.api_token_secret_ref,
      api_token_placement: offer.api_token_placement,
      placements: (offer.placements ?? []).map((p) => ({
        public_id: p.public_id,
        placement_id: p.placement_id,
        label: p.label,
        is_default: p.is_default,
      })),
      eligibility: offer.eligibility ?? null,
    },
  });
  const blockingCodes = PAYLOAD_BLOCKING_ERROR_CODES.map(
    (c) => `<li><code>${escapeHtml(c)}</code></li>`,
  ).join("");
  return `<section class="lg-editor-panel" data-lg-tab-panel="payload" hidden>
  <div class="card">
    ${loadErrorHtml}
    <div class="card-header"><h3 class="card-title">Payload builder</h3>
      <span id="lg-payload-meta" class="form-help">${escapeHtml(metaText)}</span></div>
    <p class="form-help">Build the provider payload visually — every save creates a NEW immutable schema version and makes it active. No JSON to type; raw JSON lives only behind the Advanced drawers.</p>
    <div class="lg-pb-shell" data-pb-shell>
      <div class="lg-pb-pane lg-pb-tree-pane" data-pb-pane="tree">
        <div class="lg-pb-toolbar">
          <button type="button" id="lg-pb-add-field" class="btn btn-secondary btn-sm" data-pb-add="field">+ Field</button>
          <button type="button" id="lg-pb-add-object" class="btn btn-secondary btn-sm" data-pb-add="object">+ Object</button>
          <button type="button" id="lg-pb-add-array" class="btn btn-secondary btn-sm" data-pb-add="array">+ Array</button>
        </div>
        <input type="search" id="lg-pb-search" class="form-input" placeholder="Search fields…" aria-label="Search payload fields" />
        <div id="lg-pb-tree" role="tree" aria-label="Payload tree"></div>
      </div>
      <div class="lg-pb-pane lg-pb-editor-pane" data-pb-pane="editor">
        <div id="lg-pb-editor"><p class="form-help">Select a field in the tree — or add one — to edit it here.</p></div>
      </div>
      <div class="lg-pb-pane lg-pb-side-pane" data-pb-pane="side">
        <h4 class="form-label">Live JSON preview</h4>
        <pre id="lg-schema-preview" class="lg-json-pre" data-pb-preview aria-label="Payload schema JSON preview"></pre>
        <h4 class="form-label">Validation</h4>
        <div id="lg-pb-validation" class="lg-validation-panel" data-pb-validation>
          <p id="lg-pb-validation-summary" data-pb-validation-summary class="form-help">No issues found yet.</p>
          <div id="lg-pb-validation-list" data-pb-validation-list></div>
          <details id="lg-pb-validation-codes" class="lg-pb-codes"><summary>Blocking error codes (Save and Test stay blocked while any exists)</summary><ul>${blockingCodes}</ul></details>
        </div>
        <h4 class="form-label">Sample payload</h4>
        <pre id="lg-pb-sample" class="lg-json-pre" data-pb-sample aria-label="Generated sample payload"></pre>
        <p id="lg-pb-test-chip" class="lg-pb-test-chip" data-pb-test-chip data-test-status="${escapeHtml(chip.status)}">${escapeHtml(chip.text)} <button type="button" class="btn btn-outline btn-sm" data-pb-open-test>Open Test tab</button></p>
      </div>
    </div>
    <div class="lg-builder-actions">
      <button type="button" id="lg-schema-save" class="btn btn-primary">Save schema version</button>
      <button type="button" id="lg-schema-copy" class="btn btn-outline">Copy JSON</button>
    </div>
    <details id="lg-schema-advanced" class="lg-advanced-drawer" data-lg-advanced>
      <summary>Advanced raw JSON (whole schema)</summary>
      <p class="form-help">The full schema object. Applying re-loads the visual editor; anything it cannot represent is preserved and flagged advanced-managed.</p>
      <textarea id="lg-schema-raw" class="form-textarea" rows="10" data-raw-json aria-label="Raw schema JSON"></textarea>
      <span id="lg-schema-raw-error" class="form-error" hidden></span>
      <div class="modal-actions"><button type="button" id="lg-schema-raw-apply" class="btn btn-secondary">Apply raw JSON to the tree</button></div>
      <div class="lg-example-panel" id="lg-example-panel">
        <h4 class="form-label">Generate from an example provider payload</h4>
        <textarea id="lg-example-input" class="form-textarea" rows="6" placeholder='{"data":{"zip":"10001"},"meta":{"click_id":"abc"}}' aria-label="Example provider payload"></textarea>
        <span id="lg-example-error" class="form-error" hidden></span>
        <div class="modal-actions"><button type="button" id="lg-example-generate" class="btn btn-secondary">Generate schema from example</button></div>
      </div>
    </details>
    <details class="lg-advanced-drawer" data-lg-advanced id="lg-dryrun-advanced">
      <summary>Advanced: dry run with raw JSON answers</summary>
      <div id="lg-dryrun-panel" class="lg-dryrun-panel">
        <h4 class="form-label">Test with sample answers (dry run)</h4>
        <p class="form-help">Builds the payload from the ACTIVE saved schema + your sample answers, with headers/token resolved and masked exactly like the Test tool — no request is sent, nothing is persisted or logged. Save the schema first to test unsaved edits.</p>
        <label for="lg-dryrun-answers" class="form-label">Sample answers (JSON object)</label>
        <textarea id="lg-dryrun-answers" class="form-textarea" rows="4" data-raw-json placeholder='{"zip":"10001","homeowner":true}' aria-label="Dry-run sample answers"></textarea>
        <span id="lg-dryrun-answers-error" class="form-error" hidden></span>
        <div class="modal-actions"><button type="button" id="lg-dryrun-run" class="btn btn-secondary">Test with sample answers</button></div>
        <p id="lg-dryrun-error" class="alert alert-error" hidden role="alert"></p>
        <div id="lg-dryrun-results" hidden>
          <div class="lg-test-grid">
            <div><h4 class="form-label">Built payload (masked)</h4><pre id="lg-dryrun-payload" class="lg-json-pre"></pre></div>
            <div><h4 class="form-label">Resolved headers (masked)</h4><pre id="lg-dryrun-headers" class="lg-json-pre"></pre></div>
          </div>
          <div id="lg-dryrun-notes"></div>
        </div>
      </div>
    </details>
  </div>
  ${renderEditorTemplate()}
  ${renderValueMapModal()}
  <script type="application/json" id="lg-payload-data">${blob}</script>
</section>`;
}

// ---------------------------------------------------------------------------
// §11.3–11.4 + §10.3 — Request tab panel (transport config — UNCHANGED by
// the v2.4 §6 rebuild; kept exactly as shipped)
// ---------------------------------------------------------------------------

const HEADER_KIND_HELP =
  "static = sent verbatim · macro = canonical-macro template · secret_ref = a wrangler secret NAME (the value is resolved server-side and never displayed, §30.2)";

function renderHeaderRow(header: LeadgenOfferHeaderApi | null): string {
  const name = header !== null ? escapeHtml(header.header_name) : "";
  const kind = header !== null ? header.value_kind : "static";
  const value = header !== null ? escapeHtml(header.value_text ?? "") : "";
  return `<div class="lg-header-row">
    <input type="text" class="form-input" data-header-field="header_name" placeholder="x-api-key" aria-label="Header name" value="${name}" />
    <select class="form-select" data-header-field="value_kind" aria-label="Header value kind">${options(LEADGEN_HEADER_VALUE_KINDS, kind, null)}</select>
    <input type="text" class="form-input" data-header-field="value_text" placeholder="value / {macro} / SECRET_NAME" aria-label="Header value" value="${value}" />
    <button type="button" class="btn btn-sm btn-danger" data-header-remove>Remove</button>
  </div>`;
}

// §11.3–11.4: headers + endpoints + token placement + the §10.3 execution
// mode picker. All fields feed the editor's PATCH; rows are a replace-set.
export function renderRequestPanel(
  offer: LeadgenOfferApi,
  headers: ReadonlyArray<LeadgenOfferHeaderApi>,
): string {
  const existingRows = headers.map((h) => renderHeaderRow(h)).join("");
  const clientWarningHidden = offer.request_execution_mode === "client" ? "" : " hidden";
  const modeInputs = LEADGEN_EXECUTION_MODES.map((mode) => {
    const checked = offer.request_execution_mode === mode ? " checked" : "";
    return `<label class="form-label lg-radio"><input type="radio" name="request_execution_mode" value="${mode}"${checked} /> ${mode === "server" ? "Server (default) — the Worker calls the provider; secrets resolve server-side" : "Client — the browser calls the provider (§10.3)"}</label>`;
  }).join("");
  return `<section class="lg-editor-panel" data-lg-tab-panel="request" hidden>
  <div class="card">
    <div class="card-header"><h3 class="card-title">Endpoints (§11.4)</h3></div>
    <div class="form-group">
      <label for="lg-endpoint-production" class="form-label">Production endpoint</label>
      <input id="lg-endpoint-production" name="endpoint_production" type="text" class="form-input" placeholder="https://provider.example/api/quotes" value="${escapeHtml(offer.endpoint_production ?? "")}" />
      ${fieldError("endpoint_production")}
    </div>
    <div class="form-group">
      <label for="lg-endpoint-staging" class="form-label">Staging endpoint (optional)</label>
      <input id="lg-endpoint-staging" name="endpoint_staging" type="text" class="form-input" placeholder="https://staging.provider.example/api/quotes" value="${escapeHtml(offer.endpoint_staging ?? "")}" />
      ${fieldError("endpoint_staging")}
    </div>
    <div class="form-group">
      <label for="lg-request-method" class="form-label">Request method</label>
      <select id="lg-request-method" name="request_method" class="form-select">${options(LEADGEN_REQUEST_METHODS, offer.request_method ?? "", "Default (POST)")}</select>
      ${fieldError("request_method")}
    </div>
  </div>
  <div class="card">
    <div class="card-header"><h3 class="card-title">Execution mode (§10.3)</h3></div>
    <div class="form-group">${modeInputs}${fieldError("request_execution_mode")}</div>
    <p id="lg-client-mode-warning" class="alert alert-warning"${clientWarningHidden}>Client mode: the request runs in the browser. No secret is ever exposed — remove secret_ref headers and the API token secret; endpoints must be https and CORS-enabled (validated on save).</p>
  </div>
  <div class="card">
    <div class="card-header"><h3 class="card-title">Headers (§11.3)</h3></div>
    <p class="form-help">${escapeHtml(HEADER_KIND_HELP)}</p>
    <div id="lg-headers-rows">${existingRows}</div>
    <button type="button" id="lg-header-add" class="btn btn-secondary">+ Add header</button>
    ${fieldError("headers")}
  </div>
  <div class="card">
    <div class="card-header"><h3 class="card-title">API token (§11.3)</h3></div>
    <div class="form-group">
      <label for="lg-token-placement" class="form-label">Token placement</label>
      <select id="lg-token-placement" name="api_token_placement" class="form-select">${options(LEADGEN_TOKEN_PLACEMENTS, offer.api_token_placement ?? "", "No token")}</select>
      ${fieldError("api_token_placement")}
    </div>
    <div class="form-group">
      <label for="lg-token-param" class="form-label">Header / query param name</label>
      <input id="lg-token-param" name="api_token_param_name" type="text" class="form-input" placeholder="authorization" value="${escapeHtml(offer.api_token_param_name ?? "")}" />
      ${fieldError("api_token_param_name")}
    </div>
    <div class="form-group">
      <label for="lg-token-secret" class="form-label">Token secret ref (wrangler secret name)</label>
      <input id="lg-token-secret" name="api_token_secret_ref" type="text" class="form-input" placeholder="PROVIDER_API_TOKEN" value="${escapeHtml(offer.api_token_secret_ref ?? "")}" />
      <span class="form-help">The secret NAME only — values live in Wrangler secrets and are never displayed (§30.2). Client-mode offers cannot use secret tokens (§10.3).</span>
      ${fieldError("api_token_secret_ref")}
    </div>
  </div>
  <template id="lg-header-template">${renderHeaderRow(null)}</template>
</section>`;
}

// ---------------------------------------------------------------------------
// §11.6/§11.7 — response-parser authoring panel (Test tab; UNCHANGED)
// ---------------------------------------------------------------------------

// The canonical Carrier field set (04 §11.7), one authoring row each. The
// identity row edits the config's `provider_id` source (it FEEDS carrier_key
// — 07 §18.8 carrier_key_source='provider_id'); carrier_key itself is
// derived, never authored.
const CARRIER_PARSE_FIELDS: ReadonlyArray<{ key: string; label: string }> = [
  { key: "provider_id", label: "Carrier key (provider_id)" },
  { key: "carrier_name", label: "Carrier name" },
  { key: "carrier_logo", label: "Carrier logo" },
  { key: "bid", label: "Bid" },
  { key: "bid_currency", label: "Bid currency" },
  { key: "click_url", label: "Click URL" },
  { key: "tracking_id", label: "Tracking id" },
  { key: "headline", label: "Headline" },
  { key: "subheadline", label: "Subheadline" },
  { key: "disclaimer", label: "Disclaimer" },
  { key: "pricing_model", label: "Pricing model" },
];

// Defensive read of the ACTIVE version's authored parse config into display
// text: a string path renders verbatim, a fallback array renders
// comma-joined (the first-wins §11.7 fallback chain).
function parseConfigDisplay(activeSchema: PayloadBuilderSchemaInfo | null): {
  carriersPath: string;
  fieldText: Record<string, string>;
} {
  const fieldText: Record<string, string> = {};
  let carriersPath = "";
  const cfg = activeSchema !== null ? activeSchema.carrier_parse : null;
  if (typeof cfg === "object" && cfg !== null && !Array.isArray(cfg)) {
    const rec = cfg as Record<string, unknown>;
    if (typeof rec["carriers_path"] === "string") carriersPath = rec["carriers_path"];
    const fields = rec["fields"];
    if (typeof fields === "object" && fields !== null && !Array.isArray(fields)) {
      for (const [key, value] of Object.entries(fields as Record<string, unknown>)) {
        if (typeof value === "string") {
          fieldText[key] = value;
        } else if (Array.isArray(value)) {
          fieldText[key] = value.filter((v): v is string => typeof v === "string").join(", ");
        }
      }
    }
  }
  return { carriersPath, fieldText };
}

// §11.6/§11.7 + 03 §9.2 "response parsing/carrier extraction". PLACEMENT
// DECISION: this panel lives in the TEST tab — §9.2's Dynamic grouping lists
// "response parsing/carrier extraction" immediately AFTER "Test tool", and
// §11.6 ties parser authoring to the sample_response_json the Test tool
// persists (its inferred field paths render here as pick-source chips). The
// Request tab is transport config (§11.3–11.4), not response semantics.
function renderResponseParsingPanel(activeSchema: PayloadBuilderSchemaInfo | null): string {
  const { carriersPath, fieldText } = parseConfigDisplay(activeSchema);
  const rows = CARRIER_PARSE_FIELDS.map((field) => {
    const value = fieldText[field.key] ?? "";
    return `<div class="lg-parse-row" data-parse-field="${field.key}">
      <span class="form-label">${escapeHtml(field.label)}</span>
      <input type="text" class="form-input" data-parse-input aria-label="${escapeHtml(field.label)} response paths" placeholder="dotted.path, fallback.path" value="${escapeHtml(value)}" />
    </div>`;
  }).join("");
  const samplePaths = activeSchema !== null ? activeSchema.sample_paths : [];
  const chips =
    samplePaths.length > 0
      ? samplePaths
          .map(
            (path) =>
              `<button type="button" class="macro-chip" data-parse-chip="${escapeHtml(path)}">${escapeHtml(path)}</button>`,
          )
          .join("")
      : `<p class="form-help">No sample response saved yet — run the Test tool; a 2xx JSON response is persisted as the sample and its field paths appear here (§11.6).</p>`;
  return `<div class="card">
    <div class="card-header"><h3 class="card-title">Response parsing (§11.6/§11.7)</h3>
      <span class="form-help">carrier_parse_json versions WITH the payload schema (§7.1 — a column on the schema-version row)</span></div>
    <p class="form-help">Maps the provider response onto the canonical Carrier fields (§11.7) before the auction/banner layer sees it. Each field takes one or more dotted paths — comma-separated, first match wins. Saving creates the NEXT immutable schema version carrying this parser (§11.8).</p>
    <div class="form-group">
      <label for="lg-parse-carriers-path" class="form-label">Carriers path</label>
      <input id="lg-parse-carriers-path" type="text" class="form-input" placeholder="carriers (empty = response root)" value="${escapeHtml(carriersPath)}" />
    </div>
    <div id="lg-parse-rows">${rows}</div>
    <h4 class="form-label">Pick-source chips (from the saved sample response)</h4>
    <p class="form-help">Click a chip to append its path to the last-focused field row (or copy it when none is focused).</p>
    <div id="lg-parse-chips" class="macro-chips">${chips}</div>
    <div class="modal-actions"><button type="button" id="lg-parse-save" class="btn btn-primary">Save response parser (new schema version)</button></div>
    <div id="lg-parse-errors"></div>
  </div>`;
}

// ---------------------------------------------------------------------------
// §6.12 — Test tab panel (C1: generated form + simulated context + placement
// + environment + validity gate + context_used; raw JSON behind Advanced)
// ---------------------------------------------------------------------------

export function renderTestPanel(
  offer: PayloadBuilderOffer,
  activeSchema: PayloadBuilderSchemaInfo | null,
): string {
  const prodState = offer.endpoint_production ? "configured" : "not configured";
  const stagingState = offer.endpoint_staging ? "configured" : "not configured";
  const placements = offer.placements ?? [];
  const placementOptions = placements
    .map((p) => {
      const label = `${p.placement_id}${p.label !== null && p.label !== "" ? ` — ${p.label}` : ""}${p.is_default ? " (default)" : ""}`;
      return `<option value="${escapeHtml(p.public_id)}"${p.is_default ? " selected" : ""}>${escapeHtml(label)}</option>`;
    })
    .join("");
  const placementHidden = placements.length > 1 ? "" : " hidden";
  const eligibility = offer.eligibility ?? null;
  const eligibilityNote =
    eligibility !== null && !eligibility.eligible
      ? `<p class="form-help" data-test-eligibility>Blocked from live auction: ${escapeHtml(
          eligibility.reasons.map(eligibilityReasonLabel).join(" · "),
        )}</p>`
      : "";
  const contextInputs = PAYLOAD_TEST_CONTEXT_DEFAULTS.map(
    (f) => `<div><label class="form-label">${escapeHtml(f.label)}</label>
      <input type="text" class="form-input" data-test-ctx="${escapeHtml(f.key)}" value="${escapeHtml(f.value)}" aria-label="Simulated ${escapeHtml(f.label)}" /></div>`,
  ).join("");
  const testBlob = jsonForScriptTag({
    placements: placements.map((p) => ({
      public_id: p.public_id,
      placement_id: p.placement_id,
      label: p.label,
      is_default: p.is_default,
    })),
    eligibility,
    endpoints: {
      production: offer.endpoint_production !== null && offer.endpoint_production !== "",
      staging: offer.endpoint_staging !== null && offer.endpoint_staging !== "",
    },
  });
  return `<section class="lg-editor-panel" data-lg-tab-panel="test" hidden>
  <div class="card">
    <div class="card-header"><h3 class="card-title">Test tool</h3></div>
    <p class="form-help">Runs server-side so secrets stay masked ([REDACTED]) in everything echoed below (§30.2). A 2xx JSON response is persisted as the schema's sample response.</p>
    ${eligibilityNote}
    <div class="form-group">
      <h4 class="form-label">Sample answers (generated from the active schema)</h4>
      <p class="form-help">One input per answer field — dropdowns for choice lists, yes/no pairs for booleans, date pickers for dates. Edits are saved as this Offer's draft.</p>
      <div id="lg-test-form" data-test-form></div>
      <p id="lg-test-form-status" class="form-help" role="status">Loading the answer form&#8230;</p>
      <div class="lg-pb-actions-row">
        <button type="button" id="lg-test-regenerate" class="btn btn-secondary btn-sm">Regenerate sample answers</button>
        <button type="button" id="lg-test-save-draft" class="btn btn-secondary btn-sm">Save draft</button>
        <span id="lg-test-draft-status" class="form-help" role="status"></span>
      </div>
    </div>
    <details id="lg-test-context" class="lg-test-context" data-test-context>
      <summary>Simulated visitor context (US defaults)</summary>
      <p class="form-help">These values feed the SAME runtime context builder the live auction uses — Test and runtime cannot drift (04 §4.7.2). Blank fields fall back to the request's real values.</p>
      <div class="lg-pb-grid" data-test-context-grid>${contextInputs}</div>
    </details>
    <div class="form-group" id="lg-test-placement-wrap" data-test-placement-count="${placements.length}"${placementHidden}>
      <label for="lg-test-placement" class="form-label">Placement</label>
      <select id="lg-test-placement" class="form-select" aria-label="Test placement">${placementOptions}</select>
      <span class="form-help">This Offer has ${placements.length} placements — the default is pre-selected; the one used is echoed in the result (04 §4.5).</span>
    </div>
    <div class="form-group">
      <label for="lg-test-environment" class="form-label">Environment</label>
      <select id="lg-test-environment" class="form-select" data-confirm-production="1">
        <option value="staging">staging (${escapeHtml(stagingState)})</option>
        <option value="production">production (${escapeHtml(prodState)})</option>
      </select>
      <span class="form-help">Production runs ask for an explicit confirmation.</span>
    </div>
    <div class="modal-actions"><button type="button" id="lg-test-run" class="btn btn-primary">Run test</button></div>
    <div id="lg-test-schema-errors" class="lg-validation-panel" data-test-schema-errors hidden></div>
    <p id="lg-test-error" class="alert alert-error" hidden role="alert"></p>
    <details class="lg-advanced-drawer" data-lg-advanced id="lg-test-advanced">
      <summary>Advanced raw JSON answers</summary>
      <p class="form-help">The generated form is the normal path — this editor round-trips with it: copy the form into JSON, edit, apply back.</p>
      <div class="lg-pb-actions-row">
        <button type="button" id="lg-test-form-to-json" class="btn btn-outline btn-sm">Copy form &#8594; JSON</button>
        <button type="button" id="lg-test-json-to-form" class="btn btn-outline btn-sm">Apply JSON &#8594; form</button>
      </div>
      <textarea id="lg-test-answers" class="form-textarea" rows="5" data-raw-json placeholder='{"zip":"10001","homeowner":true}' aria-label="Raw JSON sample answers"></textarea>
      <span id="lg-test-answers-error" class="form-error" hidden></span>
    </details>
    <div id="lg-test-results" hidden>
      <h4 class="form-label">Status</h4>
      <p id="lg-test-status-line" class="lg-test-status"></p>
      <div id="lg-test-notes"></div>
      <h4 class="form-label">Context used</h4>
      <div id="lg-test-context-used" data-test-context-used></div>
      <div class="lg-test-grid">
        <div><h4 class="form-label">Request payload sent</h4><pre id="lg-test-request-payload" class="lg-json-pre"></pre></div>
        <div><h4 class="form-label">Request headers (masked)</h4><pre id="lg-test-request-headers" class="lg-json-pre"></pre></div>
      </div>
      <h4 class="form-label">Response body</h4>
      <pre id="lg-test-response-body" class="lg-json-pre"></pre>
      <h4 class="form-label">Parse errors</h4>
      <div id="lg-test-parse-errors"></div>
      <h4 class="form-label">Extracted carriers</h4>
      <div id="lg-test-carriers"></div>
      <h4 class="form-label">Response fields (macro chips, §10.5)</h4>
      <p class="form-help">Click a chip to copy its {response:&#8230;} macro for the banner URL template.</p>
      <div id="lg-test-chips" class="macro-chips"></div>
      <div id="lg-test-macro-flags"></div>
    </div>
  </div>
  ${renderResponseParsingPanel(activeSchema)}
  <script type="application/json" id="lg-test-data">${testBlob}</script>
</section>`;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

export const PAYLOAD_BUILDER_STYLES = `
.lg-pb-shell{display:grid;grid-template-columns:minmax(240px,1fr) minmax(300px,1.4fr) minmax(240px,1fr);gap:14px;align-items:start;margin-top:8px}
@media (max-width:1100px){.lg-pb-shell{grid-template-columns:1fr 1fr}.lg-pb-side-pane{grid-column:1 / -1}}
@media (max-width:760px){.lg-pb-shell{grid-template-columns:1fr}}
.lg-pb-pane{border:1px solid var(--c-border);border-radius:6px;padding:10px;background:var(--c-bg);min-height:120px}
.lg-pb-toolbar{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px}
#lg-pb-search{margin-bottom:8px}
#lg-pb-tree{max-height:520px;overflow:auto}
.lg-pb-node{display:flex;align-items:center;gap:6px;padding:3px 4px;border-radius:4px;font-size:13px}
.lg-pb-node:hover{background:var(--c-bg-alt)}
.lg-pb-node.lg-pb-selected{background:var(--c-bg-alt);outline:1px solid var(--c-primary)}
.lg-pb-node.lg-pb-search-hit{background:#fef9c3}
.lg-pb-node.lg-pb-search-miss{opacity:.35}
.lg-pb-pulse{animation:lgPbPulse 1.2s ease-out 2}
@keyframes lgPbPulse{0%{box-shadow:0 0 0 0 rgba(59,130,246,.55)}100%{box-shadow:0 0 0 10px rgba(59,130,246,0)}}
.lg-pb-caret{width:18px;border:0;background:none;cursor:pointer;color:var(--c-muted);font-size:11px;padding:0}
.lg-pb-caret[disabled]{visibility:hidden}
.lg-pb-icon{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10px;color:var(--c-muted);border:1px solid var(--c-border);border-radius:4px;padding:0 4px;min-width:22px;text-align:center}
.lg-pb-node-label{border:0;background:none;cursor:pointer;font-size:13px;color:var(--c-text);padding:0;text-align:left;flex:0 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lg-pb-path-tail{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;color:var(--c-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1 1 auto}
.lg-pb-badge{font-size:10px;border-radius:9999px;padding:0 6px;border:1px solid var(--c-border)}
.lg-pb-badge-required{color:#9a3412;border-color:#fdba74;background:#fff7ed}
.lg-pb-badge-mapped{color:#166534;border-color:#86efac;background:#f0fdf4}
.lg-pb-badge-error{color:#991b1b;border-color:#fca5a5;background:#fef2f2}
.lg-pb-badge-adv{color:#6b21a8;border-color:#d8b4fe;background:#faf5ff}
.lg-pb-node-actions{display:none;gap:2px}
.lg-pb-node:hover .lg-pb-node-actions,.lg-pb-node.lg-pb-selected .lg-pb-node-actions{display:inline-flex}
.lg-pb-node-actions button{border:0;background:none;cursor:pointer;color:var(--c-muted);font-size:11px;padding:1px 3px}
.lg-pb-node-actions button:hover{color:var(--c-primary)}
.lg-pb-children{margin-left:16px;border-left:1px dotted var(--c-border);padding-left:4px}
.lg-pb-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-bottom:8px}
.lg-pb-grid-2{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:8px 0;align-items:start}
@media (max-width:760px){.lg-pb-grid-2{grid-template-columns:1fr}}
.lg-pb-required{display:inline-flex;align-items:center;gap:6px;font-weight:400}
.lg-pb-required-cell{align-self:end}
.lg-pb-editor-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:12px;border-top:1px solid var(--c-border);padding-top:10px}
.lg-pb-actions-row{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin:8px 0}
.lg-pb-chip{display:inline-block;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;padding:2px 8px;border:1px solid var(--c-border);border-radius:9999px;background:var(--c-bg-alt)}
.lg-pb-chips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px}
.lg-pb-chips button{border:0;background:none;cursor:pointer;color:var(--c-muted);padding:0 2px}
.lg-pb-test-chip{font-size:12px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.lg-pb-test-chip[data-test-status="passed"]{color:#166534}
.lg-pb-test-chip[data-test-status="failed"]{color:#991b1b}
.lg-pb-codes{font-size:11px;color:var(--c-muted);margin-top:8px}
.lg-pb-codes ul{margin:6px 0 0 18px;columns:2}
.lg-pb-advmanaged{margin-bottom:8px;display:inline-block}
.lg-pb-subtree{max-height:180px}
.lg-pb-vm-content{max-width:960px}
.lg-pb-vm-scroll{max-height:420px;overflow:auto}
.lg-pb-vm-table{width:100%;border-collapse:collapse;font-size:12px}
.lg-pb-vm-table th,.lg-pb-vm-table td{padding:4px 6px;border-bottom:1px solid var(--c-border);text-align:left;vertical-align:middle}
.lg-pb-vm-table th[data-vm-sort]{cursor:pointer}
.lg-pb-vm-table input.form-input,.lg-pb-vm-table select.form-select{font-size:12px;padding:2px 6px}
.lg-pb-vm-compact tbody tr td{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.lg-pb-vm-compact-wrap{max-height:180px;overflow:auto;border:1px solid var(--c-border);border-radius:6px}
.lg-pb-vm-search{max-width:220px}
.lg-pb-vm-count{margin:6px 0}
.lg-pb-file-btn{position:relative;overflow:hidden}
.lg-pb-other-controls{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin:8px 0}
.lg-pb-cond-row{display:grid;grid-template-columns:1.2fr .8fr 1.4fr auto;gap:6px;align-items:start;margin-bottom:6px}
@media (max-width:760px){.lg-pb-cond-row{grid-template-columns:1fr}}
.lg-pb-cond-preview{font-size:13px;font-style:italic;color:var(--c-muted)}
.lg-advanced-drawer{margin:12px 0;border:1px dashed var(--c-border);border-radius:6px;padding:8px 12px}
.lg-advanced-drawer>summary{cursor:pointer;font-size:12px;color:var(--c-muted);font-weight:500}
.lg-validation-panel{border:1px solid var(--c-border);border-radius:6px;padding:10px;font-size:13px}
.lg-validation-panel .form-error{display:block}
.lg-pb-issue{display:flex;gap:6px;align-items:baseline;flex-wrap:wrap;margin-bottom:6px;font-size:12px}
.lg-pb-issue code{font-size:11px;color:var(--c-muted)}
.lg-pb-issue .lg-pb-issue-hint{color:var(--c-muted);flex-basis:100%}
.lg-builder-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
.lg-json-pre{background:var(--c-bg-dark);border:1px solid var(--c-border);border-radius:6px;padding:10px;font-size:12px;max-height:320px;overflow:auto;white-space:pre-wrap;word-break:break-word}
.lg-json-pre .lg-pb-hl{background:#fde68a;color:#1f2937;border-radius:2px}
.lg-example-panel{margin:12px 0;border-top:1px solid var(--c-border);padding-top:8px}
.lg-header-row{display:grid;grid-template-columns:2fr 1fr 3fr auto;gap:8px;margin-bottom:8px;align-items:center}
@media (max-width:768px){.lg-header-row{grid-template-columns:1fr}}
.lg-radio{display:flex;align-items:center;gap:8px;font-weight:400}
.lg-test-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
@media (max-width:900px){.lg-test-grid{grid-template-columns:1fr}}
.lg-test-status{font-variant-numeric:tabular-nums;margin-bottom:8px}
.lg-test-context{margin:12px 0;border:1px solid var(--c-border);border-radius:6px;padding:8px 12px}
.lg-test-context>summary{cursor:pointer;font-weight:500;font-size:13px}
.lg-test-form-row{display:grid;grid-template-columns:minmax(140px,1fr) 2fr;gap:8px;align-items:center;margin-bottom:6px}
@media (max-width:760px){.lg-test-form-row{grid-template-columns:1fr}}
.lg-test-form-row .form-help{grid-column:2}
.lg-test-bool{display:flex;gap:12px}
.lg-test-bool label{display:inline-flex;align-items:center;gap:4px;font-size:13px}
.lg-dryrun-panel{margin-top:4px}
.lg-parse-row{display:grid;grid-template-columns:200px 1fr;gap:8px;align-items:center;margin-bottom:6px}
@media (max-width:768px){.lg-parse-row{grid-template-columns:1fr}}
.lg-parse-row .form-label{margin:0}
#lg-parse-errors .form-error{display:block}
.lg-carriers-table{width:100%;border-collapse:collapse;font-size:12px}
.lg-carriers-table th,.lg-carriers-table td{padding:4px 8px;border-bottom:1px solid var(--c-border);text-align:left;word-break:break-all}
`;

// ---------------------------------------------------------------------------
// Inline script (strict ES5) — the payload/request/test interaction island
// ---------------------------------------------------------------------------
//
// Reads the offer identity from #lg-offer-editor data attributes and the
// builder/test state from the #lg-payload-data / #lg-test-data JSON blobs.
// Uses window.lgUi.getJson (the shared leadgen fetch helper from
// ui-offers.ts — load order matters). Storage node objects are edited in
// place and re-emitted verbatim — unknown keys survive round trips.

export const PAYLOAD_BUILDER_SCRIPT = `
(function () {
  var root = document.getElementById('lg-offer-editor');
  if (!root || !window.lgUi) { return; }
  var getJson = window.lgUi.getJson;
  var offerId = root.getAttribute('data-offer-public-id') || root.getAttribute('data-offer-id') || '';
  var apiBase = '/api/admin/leadgen/offers/' + encodeURIComponent(offerId);

  // --- tiny helpers -----------------------------------------------------------
  function trimStr(s) { return String(s === undefined || s === null ? '' : s).replace(/^\\s+|\\s+$/g, ''); }
  function clearChildren(el) { while (el && el.firstChild) { el.removeChild(el.firstChild); } }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) { n.className = cls; }
    if (text !== undefined && text !== null) { n.appendChild(document.createTextNode(String(text))); }
    return n;
  }
  function textP(parent, cls, text) { var p = el('p', cls, text); parent.appendChild(p); return p; }
  function copyText(text, label) {
    function done() { if (window.showToast) { window.showToast(label, 'success'); } }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () {
        if (window.showToast) { window.showToast('Clipboard unavailable \\u2014 copy manually', 'warning'); }
      });
    } else if (window.showToast) {
      window.showToast('Clipboard unavailable \\u2014 copy manually', 'warning');
    }
  }
  function readIsland(id) {
    var node = document.getElementById(id);
    if (!node) { return null; }
    try { return JSON.parse(node.textContent || node.innerText || 'null'); } catch (e) { return null; }
  }
  function deepClone(v) { try { return JSON.parse(JSON.stringify(v)); } catch (e) { return null; } }
  function isRecordVal(v) { return typeof v === 'object' && v !== null && Object.prototype.toString.call(v) !== '[object Array]'; }
  function hasOwn(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function switchTab(key) {
    var btn = document.querySelector('[data-lg-tab-btn="' + key + '"]');
    if (btn) { btn.click(); }
  }

  // --- bootstrap state ----------------------------------------------------------
  var bootstrap = readIsland('lg-payload-data') || {};
  var testBootstrap = readIsland('lg-test-data') || {};
  var builderContext = bootstrap.builder_context || {};
  var linkedFields = builderContext.linked_fields || [];
  var computedOptions = bootstrap.computed_options || [];
  var errorHints = bootstrap.error_hints || {};
  var blockingCodes = bootstrap.blocking_codes || [];
  var offerMeta = bootstrap.offer || {};
  var blockingSet = {};
  var bi;
  for (bi = 0; bi < blockingCodes.length; bi++) { blockingSet[blockingCodes[bi]] = 1; }

  var treeEl = document.getElementById('lg-pb-tree');
  var editorEl = document.getElementById('lg-pb-editor');
  var previewEl = document.getElementById('lg-schema-preview');
  var sampleEl = document.getElementById('lg-pb-sample');
  var metaEl = document.getElementById('lg-payload-meta');
  var builderActive = !!(treeEl && editorEl);

  // Working schema state: items[i].node IS the storage object (edited in
  // place; unknown keys ride along untouched).
  var items = [];
  var uidSeq = 0;
  var activeVersion = 0;
  var selectedRef = null;            // {kind:'item', uid} | {kind:'implicit', path}
  var expandedOff = {};              // path -> 1 when COLLAPSED (default expanded)
  var searchTerm = '';
  var serverErrors = [];
  var serverWarnings = [];
  var advReasons = {};               // uid -> [reason strings]
  var advOpen = {};                  // uid -> drawer open flag
  var sampleFieldsCache = null;      // {answers, fields[]} from POST sample-answers

  // Node keys the visual editors fully represent; anything else on a node =
  // advanced-managed (preserved verbatim, flagged).
  var KNOWN_NODE_KEYS = ['path', 'name', 'label', 'type', 'required', 'valid_values',
    'default', 'fallback', 'source', 'internal_field', 'value_map', 'transform',
    'value', 'computed', 'macro', 'conditional', 'choiceDisplay', 'notes',
    'free_text_max_length', 'free_text_pattern', 'free_text_pattern_custom'];
  var FREE_TEXT_KEYS = ['free_text_max_length', 'free_text_pattern', 'free_text_pattern_custom'];
  var FREE_TEXT_PATTERNS = ['none', 'letters', 'digits', 'custom'];
  var FREE_TEXT_CUSTOM_MAX = 200;
  // §6.5 nested-quantifier screen — mirrors payload.ts NESTED_QUANTIFIER_BOMB_RE.
  var FREE_TEXT_BOMB_RE = /\\([^()]*[+*{][^()]*\\)\\s*[+*{]/;
  // §6.9 typed computed default/fallback reference (payload.ts
  // isComputedValueRef): {source:'computed', key:'<registry key>'}.
  function isComputedRef(v) {
    return isRecordVal(v) && v.source === 'computed' && typeof v.key === 'string';
  }
  var KNOWN_COND_OPS = ['eq', 'neq', 'gt', 'lt', 'gte', 'lte', 'range', 'in', 'not_in'];
  var FORBIDDEN_SEGMENTS = ['__proto__', 'constructor', 'prototype'];
  var NAME_RE = /^[A-Za-z0-9_]+$/;

  var MACRO_SAMPLES = {
    ip: '203.0.113.7', ua: 'Mozilla/5.0 (iPhone)', url: 'https://quotes.example.com/funnel',
    referer: 'https://www.facebook.com/', language: 'en-US', country: 'US', state: 'CA',
    city: 'Los Angeles', utm_source: 'facebook', utm_medium: 'paid_social',
    utm_content: 'ad_variant_a', traffic_source: 'facebook', placement: 'feed',
    sub1: 'a1', sub2: '', sub3: '', sub4: '', sub5: '', cpc: '1.25', fbclid: 'fb.abc',
    fbc: 'fb.1.123.abc', session_id: 'sess_abc123', click_id: 'clk_abc123', page: '/funnel',
    lander_v: 'A', offer_id: offerId, offer_name: 'Offer', device: 'mobile', os: 'iOS',
    os_version: '17', browser: 'Safari', browser_version: '17'
  };

  function computedByKey(key) {
    var i;
    for (i = 0; i < computedOptions.length; i++) {
      if (computedOptions[i].key === key) { return computedOptions[i]; }
    }
    return null;
  }
  // The registry example, typed by output_type (sample-payload rendering for
  // computed sources AND §6.9 computed defaults).
  function computedExample(key) {
    var c = computedByKey(key);
    if (!c) { return undefined; }
    return c.output_type === 'number' ? Number(c.example) : c.example;
  }
  function linkedByInternal(internal) {
    var i;
    for (i = 0; i < linkedFields.length; i++) {
      if (linkedFields[i].internal_field === internal) { return linkedFields[i]; }
    }
    return null;
  }

  // --- node shape derivations -----------------------------------------------------
  function parentPathOf(path) {
    var idx = path.lastIndexOf('.');
    return idx === -1 ? '' : path.slice(0, idx);
  }
  function lastSegment(path) {
    var idx = path.lastIndexOf('.');
    return idx === -1 ? path : path.slice(idx + 1);
  }
  function isDateNode(node) {
    return node.type === 'string' && Object.prototype.toString.call(node.transform) === '[object Array]' &&
      node.transform.length === 1 && node.transform[0] && node.transform[0].kind === 'formatDate';
  }
  function displayTypeOf(node) {
    if (isDateNode(node)) { return 'date'; }
    return node.type || 'string';
  }
  function isFreeText(node) {
    return node.source === 'answer' && displayTypeOf(node) === 'string' &&
      node.value_map === undefined && node.valid_values === undefined;
  }
  // §6.5: constraints ride ONLY free-text string answer nodes — clear them
  // whenever the node leaves that mode (toggle off / source / type change).
  function clearFreeTextConstraints(node) {
    delete node.free_text_max_length;
    delete node.free_text_pattern;
    delete node.free_text_pattern_custom;
  }
  function sourceValueOf(node) {
    if (node.source === 'macro') { return 'macro:' + (node.macro || ''); }
    if (node.source === 'computed') { return 'computed:' + (node.computed || ''); }
    return node.source || 'answer';
  }
  function itemByUid(uid) {
    var i;
    for (i = 0; i < items.length; i++) { if (items[i].uid === uid) { return items[i]; } }
    return null;
  }
  function itemIndexByUid(uid) {
    var i;
    for (i = 0; i < items.length; i++) { if (items[i].uid === uid) { return i; } }
    return -1;
  }
  function itemByPath(path) {
    var i;
    for (i = 0; i < items.length; i++) { if (items[i].node.path === path) { return items[i]; } }
    return null;
  }
  function subtreeUids(path) {
    var out = [];
    var i, p;
    for (i = 0; i < items.length; i++) {
      p = items[i].node.path;
      if (p === path || p.indexOf(path + '.') === 0) { out.push(items[i].uid); }
    }
    return out;
  }
  function computeAdvReasons(node) {
    var reasons = [];
    var k, i;
    for (k in node) {
      if (hasOwn(node, k) && KNOWN_NODE_KEYS.indexOf(k) === -1) { reasons.push('key ' + k); }
    }
    if (node.transform !== undefined && !isDateNode(node)) { reasons.push('transform pipeline'); }
    if (node.conditional !== undefined && isRecordVal(node.conditional)) {
      if (KNOWN_COND_OPS.indexOf(node.conditional.op) === -1) { reasons.push('conditional'); }
    } else if (node.conditional !== undefined) { reasons.push('conditional'); }
    if (node.value_map !== undefined && !isRecordVal(node.value_map)) { reasons.push('value_map'); }
    for (i = 0; i < FORBIDDEN_SEGMENTS.length; i++) { /* path guard is validation's job */ }
    return reasons;
  }
  function refreshAdvReasons(item) { advReasons[item.uid] = computeAdvReasons(item.node); }

  function loadItemsFromChildren(children, version) {
    items = [];
    advReasons = {};
    var i, cloned;
    for (i = 0; i < children.length; i++) {
      cloned = deepClone(children[i]);
      if (!isRecordVal(cloned)) { continue; }
      uidSeq += 1;
      items.push({ uid: uidSeq, node: cloned });
      advReasons[uidSeq] = computeAdvReasons(cloned);
    }
    activeVersion = version || 0;
  }

  // --- emission -------------------------------------------------------------------
  function buildSchemaJson() {
    var children = [];
    var i;
    for (i = 0; i < items.length; i++) { children.push(items[i].node); }
    return { version: activeVersion > 0 ? activeVersion : 1, root: { type: 'object', children: children } };
  }

  // --- client validation (mirrors payload.ts codes so hints line up) ---------------
  function validMacroSet() {
    var out = {};
    var tpl = document.getElementById('lg-pb-editor-template');
    if (!tpl || !tpl.content) { return out; }
    var opts = tpl.content.querySelectorAll('[data-pb-source-select] option');
    var i, v;
    for (i = 0; i < opts.length; i++) {
      v = opts[i].getAttribute('value') || '';
      if (v.indexOf('macro:') === 0) { out[v.slice(6)] = 1; }
    }
    return out;
  }
  // §6.9 mirror of the server's computed default/fallback-reference checks
  // (payload.ts) so hints line up live.
  function validateComputedRefSlots(node, path, errors) {
    var slots = ['default', 'fallback'];
    var si, sv;
    for (si = 0; si < slots.length; si++) {
      sv = node[slots[si]];
      if (!isRecordVal(sv) || sv.source !== 'computed') { continue; }
      if (typeof sv.key !== 'string' || trimStr(sv.key) === '') {
        errors.push({ code: 'computed_missing_key', path: path, message: slots[si] + ': a computed value reference requires a key' });
      } else if (!computedByKey(sv.key)) {
        errors.push({ code: 'computed_unknown_key', path: path, message: slots[si] + ': ' + sv.key + ' is not a computed variable' });
      }
    }
  }
  // §6.5 mirror of the server's free_text_constraint_invalid checks.
  function validateFreeTextClient(node, path, errors) {
    var present = [];
    var fi;
    for (fi = 0; fi < FREE_TEXT_KEYS.length; fi++) {
      if (node[FREE_TEXT_KEYS[fi]] !== undefined) { present.push(FREE_TEXT_KEYS[fi]); }
    }
    if (present.length === 0) { return; }
    function pushFt(message) {
      errors.push({ code: 'free_text_constraint_invalid', path: path, message: message });
    }
    var ftOk = node.source === 'answer' && node.type === 'string' &&
      node.value_map === undefined && node.valid_values === undefined;
    if (!ftOk) {
      pushFt('free-text limits need a free-text string answer field');
      return;
    }
    var ftMax = node.free_text_max_length;
    if (ftMax !== undefined && (typeof ftMax !== 'number' || ftMax % 1 !== 0 || ftMax < 1)) {
      pushFt('max length must be a positive whole number');
    }
    var ftPat = node.free_text_pattern;
    if (ftPat !== undefined && FREE_TEXT_PATTERNS.indexOf(ftPat) === -1) {
      pushFt('unknown pattern preset');
    }
    var ftCustom = node.free_text_pattern_custom;
    if (ftPat === 'custom') {
      if (typeof ftCustom !== 'string' || trimStr(ftCustom) === '') {
        pushFt('the Custom preset needs a pattern');
      } else if (ftCustom.length > FREE_TEXT_CUSTOM_MAX) {
        pushFt('custom pattern is too long (max ' + FREE_TEXT_CUSTOM_MAX + ' characters)');
      } else if (FREE_TEXT_BOMB_RE.test(ftCustom)) {
        pushFt('custom pattern risks catastrophic backtracking (nested quantifier)');
      } else {
        var reOk = true;
        try { void new RegExp(ftCustom); } catch (reErr) { reOk = false; }
        if (!reOk) { pushFt('custom pattern is not a valid regular expression'); }
      }
    } else if (ftCustom !== undefined) {
      pushFt('a custom pattern requires the Custom preset');
    }
  }

  var MACRO_SET = null;
  function clientValidate() {
    if (MACRO_SET === null) { MACRO_SET = validMacroSet(); }
    var errors = [];
    var seen = {};
    var scalarPaths = [];
    var tokenCount = 0;
    var i, j, node, path, segs, s, cond;
    for (i = 0; i < items.length; i++) {
      node = items[i].node;
      path = String(node.path || '');
      if (path === '' || !NAME_RE.test(path.replace(/\\./g, ''))) {
        if (!/^[A-Za-z0-9_]+(\\.[A-Za-z0-9_]+)*$/.test(path)) {
          errors.push({ code: 'path_invalid', path: path, message: 'path must use letters, digits and underscores' });
          continue;
        }
      }
      segs = path.split('.');
      for (j = 0; j < segs.length; j++) {
        if (FORBIDDEN_SEGMENTS.indexOf(segs[j]) !== -1) {
          errors.push({ code: 'path_invalid', path: path, message: 'reserved name ' + segs[j] + ' is not allowed' });
        }
      }
      if (seen[path]) {
        errors.push({ code: 'path_duplicate', path: path, message: 'duplicate field ' + path });
      }
      seen[path] = 1;
      s = trimStr(node.name);
      if (s === '' || !NAME_RE.test(s)) {
        errors.push({ code: 'name_invalid', path: path, message: 'name is required (letters, digits, underscores)' });
      } else if (s !== lastSegment(path)) {
        errors.push({ code: 'name_path_mismatch', path: path, message: 'name must equal the last path segment' });
      }
      if (node.type !== 'object' && node.type !== 'array') { scalarPaths.push(path); }
      if (node.type === 'enum' && (Object.prototype.toString.call(node.valid_values) !== '[object Array]' || node.valid_values.length === 0)) {
        errors.push({ code: 'enum_valid_values_required', path: path, message: 'a choice-list field needs valid values' });
      }
      if (node.source === 'answer' && trimStr(node.internal_field) === '') {
        errors.push({ code: 'answer_missing_internal_field', path: path, message: 'pick which answer feeds this field' });
      }
      if (node.source === 'static' && node.value === undefined) {
        errors.push({ code: 'static_missing_value', path: path, message: 'type the static value to send' });
      }
      if (node.source === 'computed') {
        if (trimStr(node.computed) === '') {
          errors.push({ code: 'computed_missing_key', path: path, message: 'pick a computed variable' });
        } else if (!computedByKey(node.computed)) {
          errors.push({ code: 'computed_unknown_key', path: path, message: node.computed + ' is not a computed variable' });
        }
      }
      if (node.source === 'macro') {
        if (trimStr(node.macro) === '') {
          errors.push({ code: 'macro_missing_name', path: path, message: 'pick which macro feeds this field' });
        } else if (!MACRO_SET[node.macro]) {
          errors.push({ code: 'macro_unknown', path: path, message: node.macro + ' is not a canonical macro' });
        }
      }
      if (node.source === 'token') {
        tokenCount += 1;
        if (tokenCount > 1) {
          errors.push({ code: 'token_node_duplicate', path: path, message: 'at most one token field' });
        }
        if (node.type !== 'string') {
          errors.push({ code: 'token_node_invalid', path: path, message: 'a token field must be a plain string' });
        }
      }
      cond = node.conditional;
      if (cond !== undefined) {
        if (!isRecordVal(cond) || trimStr(cond.when) === '' || KNOWN_COND_OPS.indexOf(cond.op) === -1) {
          errors.push({ code: 'conditional_invalid', path: path, message: 'the condition is incomplete' });
        } else if (cond.op === 'range' && (typeof cond.from !== 'number' || typeof cond.to !== 'number')) {
          errors.push({ code: 'conditional_invalid', path: path, message: 'between needs both bounds' });
        } else if ((cond.op === 'in' || cond.op === 'not_in') && Object.prototype.toString.call(cond.values) !== '[object Array]') {
          errors.push({ code: 'conditional_invalid', path: path, message: 'list operators need values' });
        }
      }
      validateComputedRefSlots(node, path, errors);
      validateFreeTextClient(node, path, errors);
    }
    for (i = 0; i < scalarPaths.length; i++) {
      for (j = 0; j < items.length; j++) {
        if (items[j].node.path !== scalarPaths[i] && String(items[j].node.path || '').indexOf(scalarPaths[i] + '.') === 0) {
          errors.push({ code: 'path_prefix_conflict', path: scalarPaths[i], message: 'a plain field and a nested group share the name ' + scalarPaths[i] });
          break;
        }
      }
    }
    return errors;
  }

  function allIssues() {
    var merged = [];
    var seenKeys = {};
    var lists = [clientValidate(), serverErrors];
    var i, j, e, key;
    for (i = 0; i < lists.length; i++) {
      for (j = 0; j < lists[i].length; j++) {
        e = lists[i][j];
        key = (e.code || '') + '|' + (e.path || '') + '|' + (e.message || '');
        if (!seenKeys[key]) { seenKeys[key] = 1; merged.push(e); }
      }
    }
    return merged;
  }
  function splitBlocking(entries) {
    var blocking = [];
    var warnings = [];
    var i;
    for (i = 0; i < entries.length; i++) {
      if (blockingSet[entries[i].code]) { blocking.push(entries[i]); } else { warnings.push(entries[i]); }
    }
    return { blocking: blocking, warnings: warnings };
  }

  // --- validation panel (§6.11) ---------------------------------------------------
  function issueRow(entry, jumpHandler) {
    var row = el('div', 'lg-pb-issue');
    var pathText = entry.path ? entry.path : '(schema)';
    var item = entry.path ? itemByPath(entry.path) : null;
    var label = item && item.node.label ? String(item.node.label) : (item ? String(item.node.name || '') : '');
    row.appendChild(el('strong', null, pathText));
    if (label && label !== pathText) { row.appendChild(el('span', null, label)); }
    row.appendChild(el('code', null, entry.code || ''));
    row.appendChild(el('span', null, entry.message || ''));
    var hint = errorHints[entry.code];
    if (hint) { row.appendChild(el('span', 'lg-pb-issue-hint', hint)); }
    if (entry.path && item) {
      var jump = el('button', 'btn btn-outline btn-sm', 'Jump');
      jump.type = 'button';
      jump.setAttribute('data-pb-jump', entry.path);
      jump.addEventListener('click', function () { jumpHandler(entry); });
      row.appendChild(jump);
    }
    return row;
  }
  function renderIssuesInto(listBox, summaryBox, entries, warningsList) {
    if (!listBox) { return; }
    clearChildren(listBox);
    var i;
    for (i = 0; i < entries.length; i++) {
      listBox.appendChild(issueRow(entries[i], jumpToIssue));
    }
    for (i = 0; i < (warningsList || []).length; i++) {
      var w = issueRow(warningsList[i], jumpToIssue);
      w.className = 'lg-pb-issue lg-pb-issue-warning';
      listBox.appendChild(w);
    }
    if (summaryBox) {
      clearChildren(summaryBox);
      if (entries.length === 0) {
        summaryBox.className = 'form-help';
        summaryBox.appendChild(document.createTextNode('\\u2713 No issues \\u2014 the schema looks good.'));
      } else {
        summaryBox.className = 'form-error';
        summaryBox.appendChild(document.createTextNode('Schema has ' + entries.length + ' issue' + (entries.length === 1 ? '' : 's') + '.'));
      }
    }
  }
  function refreshValidation() {
    var split = splitBlocking(allIssues());
    var warnRows = split.warnings.slice();
    var i;
    for (i = 0; i < serverWarnings.length; i++) { warnRows.push(serverWarnings[i]); }
    renderIssuesInto(
      document.getElementById('lg-pb-validation-list'),
      document.getElementById('lg-pb-validation-summary'),
      split.blocking,
      warnRows
    );
    return split;
  }
  function hasBlocking() { return splitBlocking(allIssues()).blocking.length > 0; }

  // Control focus map for Jump: error code -> the editor hook to flag.
  var JUMP_CONTROL = {
    answer_missing_internal_field: '[data-pb-answer-picker]',
    static_missing_value: '[data-pb-static="text"]',
    computed_missing_key: '[data-pb-source-select]',
    computed_unknown_key: '[data-pb-source-select]',
    macro_missing_name: '[data-pb-source-select]',
    macro_unknown: '[data-pb-source-select]',
    name_invalid: '[data-pb-field="name"]',
    name_path_mismatch: '[data-pb-field="name"]',
    path_duplicate: '[data-pb-field="name"]',
    path_prefix_conflict: '[data-pb-field="name"]',
    enum_valid_values_required: '[data-pb-validvalues-input]',
    valid_values_invalid: '[data-pb-validvalues-input]',
    value_map_invalid: '[data-pb-valuemap-open]',
    choice_display_invalid: '[data-pb-valuemap-open]',
    conditional_invalid: '[data-pb-condition-rows]',
    free_text_constraint_invalid: '[data-pb-field="free_text_pattern"]'
  };
  function jumpToIssue(entry) {
    var item = itemByPath(entry.path);
    if (!item) { return; }
    switchTab('payload');
    // expand every collapsed ancestor
    var parts = entry.path.split('.');
    var acc = '';
    var i;
    for (i = 0; i < parts.length - 1; i++) {
      acc = acc === '' ? parts[i] : acc + '.' + parts[i];
      delete expandedOff[acc];
    }
    selectedRef = { kind: 'item', uid: item.uid };
    renderAll();
    var row = treeEl ? treeEl.querySelector('[data-pb-uid="' + item.uid + '"]') : null;
    if (row) {
      row.classList.add('lg-pb-pulse');
      if (row.scrollIntoView) { row.scrollIntoView({ block: 'center' }); }
      window.setTimeout(function () { row.classList.remove('lg-pb-pulse'); }, 2600);
    }
    var body = editorEl ? editorEl.querySelector('[data-pb-editor-body]') : null;
    if (body) {
      body.classList.add('lg-pb-pulse');
      window.setTimeout(function () { body.classList.remove('lg-pb-pulse'); }, 2600);
      var msg = body.querySelector('[data-pb-node-error]');
      if (msg) {
        msg.hidden = false;
        var hint = errorHints[entry.code];
        msg.textContent = (entry.message || '') + (hint ? ' \\u2014 ' + hint : '');
      }
      var sel = JUMP_CONTROL[entry.code];
      var control = sel ? body.querySelector(sel) : null;
      if (control) {
        control.classList.add('lg-pb-pulse');
        if (control.focus) { try { control.focus(); } catch (e) { /* non-focusable */ } }
      }
    }
    if (editorEl && editorEl.scrollIntoView) { editorEl.scrollIntoView({ block: 'nearest' }); }
  }

  // --- tree model + rendering (§6.1) ---------------------------------------------
  function buildTreeModel() {
    var rootEntry = { kind: 'root', path: '', children: [] };
    var entries = {};
    var order = [];
    var i, key, item2;
    for (i = 0; i < items.length; i++) {
      item2 = items[i];
      key = String(item2.node.path || '');
      if (entries[key]) { key = key + '#dup' + item2.uid; }
      entries[key] = { kind: 'node', path: String(item2.node.path || ''), key: key, uid: item2.uid, node: item2.node, children: [] };
      order.push(key);
    }
    function ensureEntry(path) {
      if (path === '') { return rootEntry; }
      if (!entries[path]) {
        entries[path] = { kind: 'implicit', path: path, key: path, uid: null, node: null, children: [] };
        var parent = ensureEntry(parentPathOf(path));
        parent.children.push(entries[path]);
      }
      return entries[path];
    }
    for (i = 0; i < order.length; i++) {
      var e = entries[order[i]];
      var parent2 = ensureEntry(parentPathOf(e.path));
      parent2.children.push(e);
    }
    return rootEntry;
  }
  var TYPE_ICONS = { string: 'Aa', number: '#', boolean: 'y/n', date: 'dt', object: '{}', array: '[]', enum: 'ab' };
  function entryMatches(entry, term) {
    if (term === '') { return true; }
    var hay = (entry.path + ' ' + (entry.node && entry.node.label ? entry.node.label : '')).toLowerCase();
    return hay.indexOf(term) !== -1;
  }
  function subtreeHasMatch(entry, term) {
    if (entryMatches(entry, term)) { return true; }
    var i;
    for (i = 0; i < entry.children.length; i++) {
      if (subtreeHasMatch(entry.children[i], term)) { return true; }
    }
    return false;
  }
  function errorPathSet() {
    var issues = allIssues();
    var out = {};
    var i;
    for (i = 0; i < issues.length; i++) { if (issues[i].path) { out[issues[i].path] = 1; } }
    return out;
  }
  function renderTree() {
    if (!treeEl) { return; }
    clearChildren(treeEl);
    var model = buildTreeModel();
    var term = searchTerm.toLowerCase();
    var errPaths = errorPathSet();
    var i;
    function renderEntry(entry, parentBox, parentIsArray) {
      if (term !== '' && !subtreeHasMatch(entry, term)) { return; }
      var row = el('div', 'lg-pb-node');
      row.setAttribute('role', 'treeitem');
      row.setAttribute('data-pb-path', entry.path);
      if (entry.uid !== null) { row.setAttribute('data-pb-uid', String(entry.uid)); }
      else { row.setAttribute('data-pb-implicit', '1'); }
      var isSelected =
        (selectedRef && selectedRef.kind === 'item' && entry.uid === selectedRef.uid) ||
        (selectedRef && selectedRef.kind === 'implicit' && entry.kind === 'implicit' && selectedRef.path === entry.path);
      if (isSelected) { row.classList.add('lg-pb-selected'); }
      if (term !== '' && entryMatches(entry, term)) { row.classList.add('lg-pb-search-hit'); }
      row.setAttribute('aria-selected', isSelected ? 'true' : 'false');
      var caret = el('button', 'lg-pb-caret', expandedOff[entry.path] ? '\\u25b8' : '\\u25be');
      caret.type = 'button';
      caret.setAttribute('data-pb-toggle', entry.path);
      caret.setAttribute('aria-label', 'Toggle children');
      if (entry.children.length === 0) { caret.disabled = true; }
      row.appendChild(caret);
      var dtype = entry.node ? displayTypeOf(entry.node) : 'object';
      row.appendChild(el('span', 'lg-pb-icon', TYPE_ICONS[dtype] || '?'));
      var seg = lastSegment(entry.path);
      var labelText = entry.node && entry.node.label ? String(entry.node.label) : seg;
      if (parentIsArray && /^\\d+$/.test(seg)) { labelText = 'item ' + (Number(seg) + 1); }
      if (entry.kind === 'implicit') { labelText = seg + ' (group)'; }
      var labelBtn = el('button', 'lg-pb-node-label', labelText);
      labelBtn.type = 'button';
      labelBtn.setAttribute('data-pb-select', entry.path);
      labelBtn.title = entry.path;
      row.appendChild(labelBtn);
      row.appendChild(el('span', 'lg-pb-path-tail', entry.path));
      if (entry.node && entry.node.required === true) { row.appendChild(el('span', 'lg-pb-badge lg-pb-badge-required', 'required')); }
      if (entry.node && entry.node.source === 'answer' && trimStr(entry.node.internal_field) !== '') {
        row.appendChild(el('span', 'lg-pb-badge lg-pb-badge-mapped', 'mapped'));
      }
      if (errPaths[entry.path]) { row.appendChild(el('span', 'lg-pb-badge lg-pb-badge-error', 'error')); }
      if (entry.uid !== null && (advReasons[entry.uid] || []).length > 0) {
        row.appendChild(el('span', 'lg-pb-badge lg-pb-badge-adv', 'adv'));
      }
      var actions = el('span', 'lg-pb-node-actions');
      var acts = [['dup', 'Duplicate', '\\u29c9'], ['up', 'Move up', '\\u2191'], ['down', 'Move down', '\\u2193'], ['del', 'Delete', '\\u2715']];
      var ai;
      for (ai = 0; ai < acts.length; ai++) {
        var a = el('button', null, acts[ai][2]);
        a.type = 'button';
        a.title = acts[ai][1];
        a.setAttribute('data-pb-act', acts[ai][0]);
        a.setAttribute('data-pb-act-path', entry.path);
        if (entry.uid !== null) { a.setAttribute('data-pb-act-uid', String(entry.uid)); }
        actions.appendChild(a);
      }
      row.appendChild(actions);
      parentBox.appendChild(row);
      if (entry.children.length > 0 && !expandedOff[entry.path]) {
        var box = el('div', 'lg-pb-children');
        box.setAttribute('role', 'group');
        var childIsArray = !!(entry.node && entry.node.type === 'array');
        var j;
        for (j = 0; j < entry.children.length; j++) { renderEntry(entry.children[j], box, childIsArray); }
        parentBox.appendChild(box);
      }
    }
    if (model.children.length === 0) {
      textP(treeEl, 'form-help', 'No fields yet \\u2014 add the first one with the buttons above.');
    }
    for (i = 0; i < model.children.length; i++) { renderEntry(model.children[i], treeEl, false); }
  }

  // --- live JSON preview (right pane; selected node highlighted) -------------------
  function indentBlock(text, pad) {
    var lines = text.split('\\n');
    var out = [];
    var i;
    for (i = 0; i < lines.length; i++) { out.push(pad + lines[i]); }
    return out.join('\\n');
  }
  function refreshPreview() {
    if (!previewEl) { return; }
    clearChildren(previewEl);
    var schema = buildSchemaJson();
    var head = '{\\n  "version": ' + schema.version + ',\\n  "root": {\\n    "type": "object",\\n    "children": [';
    previewEl.appendChild(document.createTextNode(head));
    var i, chunk, spanEl;
    for (i = 0; i < items.length; i++) {
      chunk = (i === 0 ? '\\n' : ',\\n') + indentBlock(JSON.stringify(items[i].node, null, 2), '      ');
      if (selectedRef && selectedRef.kind === 'item' && selectedRef.uid === items[i].uid) {
        spanEl = el('span', 'lg-pb-hl');
        spanEl.appendChild(document.createTextNode(chunk));
        previewEl.appendChild(spanEl);
      } else {
        previewEl.appendChild(document.createTextNode(chunk));
      }
    }
    previewEl.appendChild(document.createTextNode('\\n    ]\\n  }\\n}'));
  }

  // --- generated sample payload (right pane) ---------------------------------------
  function sampleByType(t) {
    if (t === 'number') { return 42; }
    if (t === 'boolean') { return true; }
    if (t === 'date') { return '1996-07-08'; }
    if (t === 'object') { return {}; }
    if (t === 'array') { return []; }
    return 'text';
  }
  function firstMapOutput(map) {
    var k;
    for (k in map) { if (hasOwn(map, k)) { return map[k]; } }
    return undefined;
  }
  function sampleValueFor(node) {
    var dtype = displayTypeOf(node);
    if (node.source === 'static') { return node.value; }
    if (node.source === 'computed') {
      return computedExample(node.computed || '');
    }
    if (node.source === 'macro') {
      return hasOwn(MACRO_SAMPLES, node.macro || '') ? MACRO_SAMPLES[node.macro] : '';
    }
    if (node.source === 'placement') {
      var i;
      for (i = 0; i < (offerMeta.placements || []).length; i++) {
        if (offerMeta.placements[i].is_default) { return offerMeta.placements[i].placement_id; }
      }
      return (offerMeta.placements || []).length > 0 ? offerMeta.placements[0].placement_id : 'pl-12345';
    }
    if (node.source === 'token') { return '[REDACTED]'; }
    if (node.value_map !== undefined && isRecordVal(node.value_map)) {
      var out = firstMapOutput(node.value_map);
      if (out !== undefined) { return out; }
    }
    if (dtype === 'date') { return '07/08/1996'; }
    // §6.5: a digits-constrained free-text field samples a compliant value.
    if (node.free_text_pattern === 'digits') { return '12345'; }
    return sampleByType(node.type || 'string');
  }
  function setAtPathLite(target, path, value) {
    var segs = path.split('.');
    var cursor = target;
    var i, seg, isLast, nextIsIndex, existing;
    for (i = 0; i < segs.length; i++) {
      if (FORBIDDEN_SEGMENTS.indexOf(segs[i]) !== -1) { return; }
    }
    for (i = 0; i < segs.length; i++) {
      seg = segs[i];
      isLast = i === segs.length - 1;
      nextIsIndex = !isLast && /^\\d+$/.test(segs[i + 1]);
      if (Object.prototype.toString.call(cursor) === '[object Array]') { seg = Number(seg); }
      if (isLast) { cursor[seg] = value; }
      else {
        existing = cursor[seg];
        if (existing === undefined || existing === null || typeof existing !== 'object') {
          cursor[seg] = nextIsIndex ? [] : {};
        }
        cursor = cursor[seg];
      }
    }
  }
  function refreshSample() {
    if (!sampleEl) { return; }
    var out = {};
    var i, node, v;
    for (i = 0; i < items.length; i++) {
      node = items[i].node;
      if (node.type === 'object' || node.type === 'array') {
        if (node.value !== undefined && node.source === 'static') { setAtPathLite(out, node.path, deepClone(node.value)); }
        continue;
      }
      v = sampleValueFor(node);
      // §6.9: a node with no sample of its own reflects its computed DEFAULT
      // (the registry example) — exactly the absent→default runtime path.
      if (v === undefined && isComputedRef(node['default'])) { v = computedExample(node['default'].key); }
      if (v !== undefined) { setAtPathLite(out, node.path, v); }
    }
    sampleEl.textContent = JSON.stringify(out, null, 2);
  }

  function renderAll() {
    renderTree();
    renderEditor();
    refreshPreview();
    refreshSample();
    refreshValidation();
  }

  // --- structural tree operations (§6.1) --------------------------------------------
  function uniqueChildName(parentPath, base) {
    var name = base;
    var n = 1;
    while (itemByPath(parentPath === '' ? name : parentPath + '.' + name)) {
      n += 1;
      name = base + '_' + n;
    }
    return name;
  }
  function selectedContainerPath() {
    if (!selectedRef) { return ''; }
    if (selectedRef.kind === 'implicit') { return selectedRef.path; }
    var item = itemByUid(selectedRef.uid);
    if (!item) { return ''; }
    if (item.node.type === 'object' || item.node.type === 'array') { return item.node.path; }
    return parentPathOf(item.node.path);
  }
  function insertItemAfterSubtree(parentPath, node) {
    uidSeq += 1;
    var entry = { uid: uidSeq, node: node };
    var insertAt = items.length;
    if (parentPath !== '') {
      var i;
      for (i = items.length - 1; i >= 0; i--) {
        var p = items[i].node.path;
        if (p === parentPath || p.indexOf(parentPath + '.') === 0) { insertAt = i + 1; break; }
      }
    }
    items.splice(insertAt, 0, entry);
    advReasons[entry.uid] = computeAdvReasons(node);
    return entry;
  }
  function addField(kind, parentPathArg) {
    var parentPath = parentPathArg !== undefined ? parentPathArg : selectedContainerPath();
    var parentItem = parentPath === '' ? null : itemByPath(parentPath);
    var base = kind === 'object' ? 'group' : (kind === 'array' ? 'list' : 'field');
    if (parentItem && parentItem.node.type === 'array') {
      // items[] child: the next numeric index
      var maxIdx = -1;
      var i, seg;
      for (i = 0; i < items.length; i++) {
        if (items[i].node.path.indexOf(parentPath + '.') === 0) {
          seg = items[i].node.path.slice(parentPath.length + 1).split('.')[0];
          if (/^\\d+$/.test(seg) && Number(seg) > maxIdx) { maxIdx = Number(seg); }
        }
      }
      base = String(maxIdx + 1);
    } else {
      base = uniqueChildName(parentPath, base);
    }
    var path = parentPath === '' ? base : parentPath + '.' + base;
    var node;
    if (kind === 'object') { node = { path: path, name: base, type: 'object', required: false, source: 'static', value: {} }; }
    else if (kind === 'array') { node = { path: path, name: base, type: 'array', required: false, source: 'static', value: [] }; }
    else { node = { path: path, name: base, type: 'string', required: false, source: 'answer' }; }
    var entry = insertItemAfterSubtree(parentPath, node);
    delete expandedOff[parentPath];
    selectedRef = { kind: 'item', uid: entry.uid };
    renderAll();
    var nameInput = editorEl ? editorEl.querySelector('[data-pb-field="name"]') : null;
    if (nameInput && nameInput.focus) { nameInput.focus(); if (nameInput.select) { nameInput.select(); } }
  }
  function renamePrefix(oldPath, newPath) {
    var moved = [];
    var i, node, rest;
    for (i = 0; i < items.length; i++) {
      node = items[i].node;
      if (node.path === oldPath) {
        node.path = newPath;
        node.name = lastSegment(newPath);
        moved.push(items[i]);
      } else if (node.path.indexOf(oldPath + '.') === 0) {
        rest = node.path.slice(oldPath.length);
        node.path = newPath + rest;
        moved.push(items[i]);
      }
    }
    if (expandedOff[oldPath]) { expandedOff[newPath] = 1; delete expandedOff[oldPath]; }
    return moved;
  }
  // §6.1 rename: rewrite descendants atomically + the mapped-fields impact
  // warning listing affected Section mappings (builder_context.linked_fields).
  function renameSelected(newName, impactBox) {
    var isImplicit = selectedRef && selectedRef.kind === 'implicit';
    var oldPath = isImplicit ? selectedRef.path : itemByUid(selectedRef.uid).node.path;
    var parent = parentPathOf(oldPath);
    var newPath = parent === '' ? newName : parent + '.' + newName;
    if (newPath === oldPath) { return; }
    if (!NAME_RE.test(newName) || FORBIDDEN_SEGMENTS.indexOf(newName) !== -1) {
      if (impactBox) { impactBox.hidden = false; impactBox.textContent = 'Names may use letters, digits and underscores only.'; }
      return;
    }
    if (itemByPath(newPath)) {
      if (impactBox) { impactBox.hidden = false; impactBox.textContent = 'A field named ' + newName + ' already exists here \\u2014 pick another name.'; }
      return;
    }
    var moved = renamePrefix(oldPath, newPath);
    if (isImplicit) { selectedRef = { kind: 'implicit', path: newPath }; }
    var mapped = [];
    var i, node, lf;
    for (i = 0; i < moved.length; i++) {
      node = moved[i].node;
      if (node.source === 'answer' && trimStr(node.internal_field) !== '') {
        lf = linkedByInternal(node.internal_field);
        mapped.push(node.internal_field + (lf ? ' (Section: ' + lf.section_name + ')' : ''));
      }
    }
    renderAll();
    var box = editorEl ? editorEl.querySelector('[data-pb-rename-impact]') : null;
    if (box && mapped.length > 0) {
      box.hidden = false;
      box.textContent = 'Renamed ' + oldPath + ' \\u2192 ' + newPath + '. ' + mapped.length +
        ' mapped field' + (mapped.length === 1 ? '' : 's') + ' moved with it: ' + mapped.join(', ') + '.';
    } else if (box && moved.length > 1) {
      box.hidden = false;
      box.textContent = 'Renamed ' + oldPath + ' \\u2192 ' + newPath + ' (' + moved.length + ' fields updated).';
    }
  }
  // First/last item index of a subtree (descendants may be non-contiguous in
  // legacy schemas — min/max give a sane anchor either way).
  function subtreeBlock(path) {
    var start = -1;
    var end = -1;
    var i, p;
    for (i = 0; i < items.length; i++) {
      p = items[i].node.path;
      if (p === path || p.indexOf(path + '.') === 0) {
        if (start === -1) { start = i; }
        end = i;
      }
    }
    return { start: start, end: end };
  }
  function subtreeIndexes(path) {
    var out = [];
    var i, p;
    for (i = 0; i < items.length; i++) {
      p = items[i].node.path;
      if (p === path || p.indexOf(path + '.') === 0) { out.push(i); }
    }
    return out;
  }
  function duplicateByPath(path) {
    var idxs = subtreeIndexes(path);
    if (idxs.length === 0) { return; }
    var parent = parentPathOf(path);
    var copyName = uniqueChildName(parent, lastSegment(path) + '_copy');
    var newPath = parent === '' ? copyName : parent + '.' + copyName;
    var clones = [];
    var i, cloned;
    for (i = 0; i < idxs.length; i++) {
      cloned = deepClone(items[idxs[i]].node);
      if (cloned.path === path) { cloned.path = newPath; cloned.name = copyName; }
      else { cloned.path = newPath + cloned.path.slice(path.length); }
      uidSeq += 1;
      clones.push({ uid: uidSeq, node: cloned });
      advReasons[uidSeq] = computeAdvReasons(cloned);
    }
    var insertAt = idxs[idxs.length - 1] + 1;
    for (i = 0; i < clones.length; i++) { items.splice(insertAt + i, 0, clones[i]); }
    selectedRef = { kind: 'item', uid: clones[0].uid };
    renderAll();
  }
  function deleteByPath(path) {
    var uids = subtreeUids(path);
    if (uids.length === 0) { return; }
    if (uids.length > 1 && !window.confirm('Delete ' + path + ' and its ' + (uids.length - 1) + ' nested field(s)?')) { return; }
    var i;
    for (i = items.length - 1; i >= 0; i--) {
      if (uids.indexOf(items[i].uid) !== -1) { delete advReasons[items[i].uid]; items.splice(i, 1); }
    }
    selectedRef = null;
    renderAll();
  }
  // Move the node's contiguous subtree block before the previous sibling
  // block / after the next sibling block (same parent only).
  function siblingPaths(parentPath) {
    var out = [];
    var seenSeg = {};
    var i, p, seg;
    for (i = 0; i < items.length; i++) {
      p = items[i].node.path;
      if (parentPath === '' ? p.indexOf('.') === -1 : (p.indexOf(parentPath + '.') === 0 && p.slice(parentPath.length + 1).indexOf('.') === -1)) {
        seg = p;
        if (!seenSeg[seg]) { seenSeg[seg] = 1; out.push(seg); }
      }
    }
    return out;
  }
  function moveByPath(path, dir) {
    var parent = parentPathOf(path);
    var sibs = siblingPaths(parent);
    var idx = sibs.indexOf(path);
    if (idx === -1) { return; }
    var targetIdx = dir === 'up' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= sibs.length) { return; }
    // extract the whole subtree (order preserved), then re-insert around the
    // target sibling's block (recomputed AFTER extraction).
    var moving = [];
    var i;
    for (i = items.length - 1; i >= 0; i--) {
      var p = items[i].node.path;
      if (p === path || p.indexOf(path + '.') === 0) { moving.unshift(items.splice(i, 1)[0]); }
    }
    var block = subtreeBlock(sibs[targetIdx]);
    var insertAt = dir === 'up' ? block.start : block.end + 1;
    if (block.start === -1) { insertAt = items.length; }
    for (i = 0; i < moving.length; i++) { items.splice(insertAt + i, 0, moving[i]); }
    renderAll();
  }

  // --- editor rendering (§6.1 center pane) -------------------------------------------
  function setVal(bodyEl, sel, value) {
    var n = bodyEl.querySelector(sel);
    if (!n) { return null; }
    if (n.type === 'checkbox') { n.checked = !!value; }
    else { n.value = value === undefined || value === null ? '' : String(value); }
    return n;
  }
  function show(bodyEl, sel, visible) {
    var n = bodyEl.querySelector(sel);
    if (n) { n.hidden = !visible; }
    return n;
  }
  function displayScalar(v) {
    if (v === undefined) { return ''; }
    if (typeof v === 'string') { return v; }
    try { return JSON.stringify(v); } catch (e) { return String(v); }
  }

  function fillAnswerPicker(bodyEl, node, filter) {
    var picker = bodyEl.querySelector('[data-pb-answer-picker]');
    var manual = bodyEl.querySelector('[data-pb-answer-manual]');
    var meta = bodyEl.querySelector('[data-pb-answer-meta]');
    if (!picker) { return; }
    clearChildren(picker);
    var term = (filter || '').toLowerCase();
    var current = trimStr(node.internal_field);
    if (linkedFields.length === 0) {
      picker.hidden = true;
      if (manual) { manual.hidden = false; manual.value = current; }
      if (meta) { meta.textContent = 'No Sections are linked to this Offer yet \\u2014 type the internal field name; the picker appears once Sections are linked.'; }
      return;
    }
    picker.hidden = false;
    if (manual) { manual.hidden = true; }
    var blank = el('option', null, 'Choose a Section field\\u2026');
    blank.value = '';
    picker.appendChild(blank);
    var groups = {};
    var order = [];
    var i, f, key;
    for (i = 0; i < linkedFields.length; i++) {
      f = linkedFields[i];
      key = f.section_name;
      if (!groups[key]) { groups[key] = []; order.push(key); }
      groups[key].push(f);
    }
    var matchedCurrent = false;
    for (i = 0; i < order.length; i++) {
      var og = document.createElement('optgroup');
      og.label = order[i];
      var j, opt, labelText;
      for (j = 0; j < groups[order[i]].length; j++) {
        f = groups[order[i]][j];
        labelText = f.internal_field + ' (' + f.answer_type + (f.choice_count > 0 ? ', ' + f.choice_count + ' choices' : '') + ')';
        if (term !== '' && (f.internal_field + ' ' + order[i]).toLowerCase().indexOf(term) === -1) { continue; }
        opt = el('option', null, labelText);
        opt.value = f.internal_field;
        if (f.internal_field === current) { opt.selected = true; matchedCurrent = true; }
        og.appendChild(opt);
      }
      if (og.childNodes.length > 0) { picker.appendChild(og); }
    }
    if (current !== '' && !matchedCurrent) {
      var extra = el('option', null, current + ' (not on a linked Section)');
      extra.value = current;
      extra.selected = true;
      picker.appendChild(extra);
    }
    if (meta) {
      var lf = linkedByInternal(current);
      meta.textContent = lf
        ? 'From Section \\u201c' + lf.section_name + '\\u201d \\u00b7 ' + lf.answer_type + (lf.choice_count > 0 ? ' \\u00b7 ' + lf.choice_count + ' choices' : '')
        : (current !== '' ? 'Mapped to ' + current : 'Searchable \\u2014 grouped by Section, with answer type + choice count.');
    }
  }

  function valueMapEntries(node) {
    var out = [];
    var vm = node.value_map;
    var mains = (node.choiceDisplay && node.choiceDisplay.mainValues) || [];
    var k;
    if (isRecordVal(vm)) {
      for (k in vm) {
        if (hasOwn(vm, k)) { out.push({ internal: k, output: vm[k], main: mains.indexOf(k) !== -1 }); }
      }
    }
    return out;
  }
  function fillValueMapCompact(bodyEl, node) {
    var table = bodyEl.querySelector('[data-pb-valuemap-compact]');
    if (!table) { return; }
    var tbody = table.querySelector('tbody');
    clearChildren(tbody);
    var entries = valueMapEntries(node);
    show(bodyEl, '[data-pb-valuemap-empty]', entries.length === 0);
    var i, tr;
    for (i = 0; i < entries.length && i < 6; i++) {
      tr = document.createElement('tr');
      tr.appendChild(el('td', null, entries[i].internal));
      tr.appendChild(el('td', null, displayScalar(entries[i].output)));
      tr.appendChild(el('td', null, entries[i].main ? '\\u2713' : ''));
      tbody.appendChild(tr);
    }
    if (entries.length > 6) {
      tr = document.createElement('tr');
      var td = el('td', null, '\\u2026 ' + (entries.length - 6) + ' more \\u2014 open the editor');
      td.colSpan = 3;
      tr.appendChild(td);
      tbody.appendChild(tr);
    }
    var cd = node.choiceDisplay || {};
    var chips = bodyEl.querySelector('[data-pb-choice-chips]');
    if (chips) {
      var mains = (cd.mainValues || []).length;
      if (cd.otherGroupEnabled) {
        chips.hidden = false;
        chips.textContent = mains + ' main \\u00b7 ' + Math.max(entries.length - mains, 0) + ' in ' + (cd.otherGroupLabel || 'Other');
      } else if (mains > 0) {
        chips.hidden = false;
        chips.textContent = mains + ' main \\u00b7 ' + entries.length + ' values';
      } else {
        chips.hidden = true;
      }
    }
    var warn = bodyEl.querySelector('[data-pb-main-warn]');
    if (warn) {
      var mainCount = (cd.mainValues || []).length;
      warn.hidden = mainCount <= 9;
      if (mainCount > 9) { warn.textContent = mainCount + ' main choices \\u2014 more than 9 gets crowded; consider moving some to Other.'; }
    }
  }

  function clientFormatDate(isoDate, fmt) {
    if (trimStr(isoDate) === '') { return null; }
    var d = new Date(isoDate + 'T00:00:00Z');
    if (isNaN(d.getTime())) { return null; }
    function pad(n, w) {
      var s = String(n);
      while (s.length < w) { s = '0' + s; }
      return s;
    }
    return fmt
      .replace(/YYYY/g, pad(d.getUTCFullYear(), 4))
      .replace(/MM/g, pad(d.getUTCMonth() + 1, 2))
      .replace(/DD/g, pad(d.getUTCDate(), 2))
      .replace(/HH/g, pad(d.getUTCHours(), 2))
      .replace(/mm/g, pad(d.getUTCMinutes(), 2))
      .replace(/ss/g, pad(d.getUTCSeconds(), 2));
  }
  function currentDateFormat(node) {
    if (isDateNode(node)) { return node.transform[0].format || 'YYYY-MM-DD'; }
    return 'YYYY-MM-DD';
  }
  function fillDatePanel(bodyEl, node) {
    var fmt = currentDateFormat(node);
    var sel = bodyEl.querySelector('[data-pb-field="date_format"]');
    var custom = bodyEl.querySelector('[data-pb-field="date_format_custom"]');
    var known = false;
    var i;
    if (sel) {
      for (i = 0; i < sel.options.length; i++) {
        if (sel.options[i].value === fmt) { known = true; }
      }
      sel.value = known ? fmt : '__custom__';
    }
    if (custom) {
      custom.hidden = known;
      custom.value = known ? '' : fmt;
    }
    var sample = bodyEl.querySelector('[data-pb-date-sample]');
    if (sample && sample.value === '') { sample.value = '1996-07-08'; }
    updateDatePreview(bodyEl, node);
    show(bodyEl, '[data-pb-date-invalid-note]', true);
  }
  function updateDatePreview(bodyEl, node) {
    var sample = bodyEl.querySelector('[data-pb-date-sample]');
    var preview = bodyEl.querySelector('[data-pb-date-preview]');
    if (!preview) { return; }
    var out = clientFormatDate(sample ? sample.value : '', currentDateFormat(node));
    if (out === null) {
      preview.textContent = 'invalid date \\u2192 fallback' + (node.fallback !== undefined ? ' (' + displayScalar(node.fallback) + ')' : ' (field omitted)');
    } else {
      preview.textContent = (sample ? sample.value : '') + ' \\u2192 ' + out;
    }
  }

  function detectBoolPreset(bodyEl, node) {
    var sel = bodyEl.querySelector('[data-pb-field="bool_preset"]');
    if (!sel) { return 'bool'; }
    var vm = isRecordVal(node.value_map) ? node.value_map : null;
    var tJson = vm && hasOwn(vm, 'true') ? JSON.stringify(vm['true']) : 'true';
    var fJson = vm && hasOwn(vm, 'false') ? JSON.stringify(vm['false']) : 'false';
    var i, o;
    for (i = 0; i < sel.options.length; i++) {
      o = sel.options[i];
      if (o.value !== 'custom' && o.getAttribute('data-true-json') === tJson && o.getAttribute('data-false-json') === fJson) {
        return o.value;
      }
    }
    return 'custom';
  }
  function fillBooleanPanel(bodyEl, node) {
    var preset = detectBoolPreset(bodyEl, node);
    var sel = bodyEl.querySelector('[data-pb-field="bool_preset"]');
    if (sel) { sel.value = preset; }
    var vm = isRecordVal(node.value_map) ? node.value_map : { 'true': true, 'false': false };
    show(bodyEl, '[data-pb-bool-custom]', preset === 'custom');
    var tIn = bodyEl.querySelector('[data-pb-bool-true]');
    var fIn = bodyEl.querySelector('[data-pb-bool-false]');
    if (tIn) { tIn.value = displayScalar(hasOwn(vm, 'true') ? vm['true'] : true); }
    if (fIn) { fIn.value = displayScalar(hasOwn(vm, 'false') ? vm['false'] : false); }
    var chipT = bodyEl.querySelector('[data-pb-bool-chip-true]');
    var chipF = bodyEl.querySelector('[data-pb-bool-chip-false]');
    if (chipT) { chipT.textContent = displayScalar(hasOwn(vm, 'true') ? vm['true'] : true); }
    if (chipF) { chipF.textContent = displayScalar(hasOwn(vm, 'false') ? vm['false'] : false); }
  }

  function fillChips(box, values, removable) {
    clearChildren(box);
    var i, chip, x;
    for (i = 0; i < values.length; i++) {
      chip = el('span', 'lg-pb-chip', displayScalar(values[i]));
      if (removable) {
        x = el('button', null, '\\u2715');
        x.type = 'button';
        x.setAttribute('data-chip-remove', String(i));
        x.setAttribute('aria-label', 'Remove');
        chip.appendChild(x);
      }
      box.appendChild(chip);
    }
  }

  // --- §6.9 default / fallback panel ---------------------------------------------
  function looseNote(node, key, dtype) {
    var v = node[key];
    if (v === undefined || typeof v !== 'string') { return null; }
    if (dtype === 'number' && trimStr(v) !== '' && !isNaN(Number(v))) {
      return { text: 'Stored as text "' + v + '" \\u2014 convert to the number ' + Number(v) + '?', value: Number(v) };
    }
    if (dtype === 'boolean' && (v === 'true' || v === 'false')) {
      return { text: 'Stored as text "' + v + '" \\u2014 convert to the yes/no value ' + v + '?', value: v === 'true' };
    }
    return null;
  }
  function fillDefaultSide(bodyEl, node, key) {
    var prefix = key === 'default' ? 'default' : 'fallback';
    var mode = bodyEl.querySelector('[data-pb-' + prefix + '-mode]');
    var inputsBox = bodyEl.querySelector('[data-pb-' + prefix + '-inputs]');
    var copyWrap = bodyEl.querySelector('[data-pb-' + prefix + '-copy-wrap]');
    var computedWrap = bodyEl.querySelector('[data-pb-' + prefix + '-computed-wrap]');
    var dtype = displayTypeOf(node);
    var typedKind = dtype === 'number' ? 'number' : (dtype === 'boolean' ? 'boolean' : (dtype === 'date' ? 'date' : 'text'));
    // §6.9: a stored {source:'computed', ...} object is the TYPED computed
    // reference (ref intent even when malformed — validation owns errors).
    var isRef = isRecordVal(node[key]) && node[key].source === 'computed';
    if (mode) { mode.value = node[key] === undefined ? 'disabled' : (isRef ? 'computed' : 'static'); }
    if (inputsBox) {
      inputsBox.hidden = node[key] === undefined || isRef;
      var kinds = ['text', 'number', 'boolean', 'date'];
      var i, input;
      for (i = 0; i < kinds.length; i++) {
        input = bodyEl.querySelector('[data-pb-' + prefix + '-value="' + kinds[i] + '"]');
        if (!input) { continue; }
        input.hidden = kinds[i] !== typedKind;
        if (kinds[i] === typedKind && node[key] !== undefined && !isRef) {
          if (typedKind === 'boolean') { input.value = node[key] === true ? 'true' : 'false'; }
          else { input.value = typeof node[key] === 'string' ? node[key] : displayScalar(node[key]); }
        }
      }
    }
    if (computedWrap) {
      computedWrap.hidden = !isRef;
      var compSel = bodyEl.querySelector('[data-pb-' + prefix + '-computed]');
      if (compSel && isRef && typeof node[key].key === 'string') { compSel.value = node[key].key; }
    }
    if (copyWrap) {
      copyWrap.hidden = true;
      var fromSel = bodyEl.querySelector('[data-pb-' + prefix + '-copy-from]');
      if (fromSel) {
        clearChildren(fromSel);
        var j, opt;
        for (j = 0; j < items.length; j++) {
          if (selectedRef && selectedRef.kind === 'item' && items[j].uid === selectedRef.uid) { continue; }
          opt = el('option', null, items[j].node.path);
          opt.value = items[j].node.path;
          fromSel.appendChild(opt);
        }
      }
    }
    var loose = looseNote(node, key, dtype);
    var looseBox = bodyEl.querySelector('[data-pb-' + prefix + '-loose]');
    if (looseBox) {
      looseBox.hidden = loose === null;
      if (loose !== null) {
        clearChildren(looseBox);
        looseBox.appendChild(document.createTextNode(loose.text + ' '));
        var btn = el('button', 'btn btn-outline btn-sm', 'Convert');
        btn.type = 'button';
        btn.setAttribute('data-pb-normalize', prefix);
        looseBox.appendChild(btn);
      }
    }
  }
  function readTypedInput(bodyEl, prefix, dtype) {
    var typedKind = dtype === 'number' ? 'number' : (dtype === 'boolean' ? 'boolean' : (dtype === 'date' ? 'date' : 'text'));
    var input = bodyEl.querySelector('[data-pb-' + prefix + '-value="' + typedKind + '"]');
    if (!input) { return undefined; }
    if (typedKind === 'number') {
      return trimStr(input.value) === '' ? undefined : Number(input.value);
    }
    if (typedKind === 'boolean') { return input.value === 'true'; }
    return input.value;
  }

  // --- §6.10 condition builder -------------------------------------------------------
  function conditionFieldOptions() {
    var out = [];
    var seenF = {};
    var i;
    for (i = 0; i < linkedFields.length; i++) {
      if (!seenF[linkedFields[i].internal_field]) {
        seenF[linkedFields[i].internal_field] = 1;
        out.push({ value: linkedFields[i].internal_field, label: linkedFields[i].internal_field + ' (' + linkedFields[i].section_name + ')', answer_type: linkedFields[i].answer_type });
      }
    }
    for (i = 0; i < items.length; i++) {
      var f = trimStr(items[i].node.internal_field);
      if (items[i].node.source === 'answer' && f !== '' && !seenF[f]) {
        seenF[f] = 1;
        out.push({ value: f, label: f + ' (payload field)', answer_type: '' });
      }
    }
    return out;
  }
  function condUiOp(cond) {
    if (cond.op === 'eq' && cond.value === '') { return 'is_empty'; }
    if (cond.op === 'neq' && cond.value === '') { return 'is_not_empty'; }
    return cond.op;
  }
  function condSentence(cond) {
    if (!cond || trimStr(cond.when) === '') { return ''; }
    var opLabels = { eq: '=', neq: '\\u2260', gt: '>', lt: '<', gte: '\\u2265', lte: '\\u2264' };
    var ui = condUiOp(cond);
    if (ui === 'is_empty') { return 'Send this field when ' + cond.when + ' is empty.'; }
    if (ui === 'is_not_empty') { return 'Send this field when ' + cond.when + ' is not empty.'; }
    if (cond.op === 'range') { return 'Send this field when ' + cond.when + ' is between ' + cond.from + ' and ' + cond.to + '.'; }
    if (cond.op === 'in') { return 'Send this field when ' + cond.when + ' is one of [' + (cond.values || []).join(', ') + '].'; }
    if (cond.op === 'not_in') { return 'Send this field when ' + cond.when + ' is not one of [' + (cond.values || []).join(', ') + '].'; }
    return 'Send this field when ' + cond.when + ' ' + (opLabels[cond.op] || cond.op) + ' ' + displayScalar(cond.value) + '.';
  }
  function fillConditionPanel(bodyEl, node) {
    var rowsBox = bodyEl.querySelector('[data-pb-condition-rows]');
    var addBtn = bodyEl.querySelector('[data-pb-condition-add]');
    var preview = bodyEl.querySelector('[data-pb-cond-preview]');
    if (!rowsBox) { return; }
    // F-1: while a row is live its op select is the source of truth for the
    // rendered UI op — an explicit "=" or "not equal" pick must not snap back
    // to the is_empty sugar just because the value is still empty. Sugar is
    // inferred only when no live row exists (a stored {op:'eq', value:''}
    // rendered fresh from storage). An empty value at save time still means
    // is-empty: the stored shape is unchanged.
    var liveOpSel = rowsBox.querySelector('[data-pb-cond-op]');
    var chosenUiOp = liveOpSel ? liveOpSel.value : '';
    clearChildren(rowsBox);
    var cond = node.conditional;
    if (addBtn) { addBtn.hidden = cond !== undefined; }
    if (preview) {
      var sentence = condSentence(cond);
      preview.hidden = sentence === '';
      preview.textContent = sentence;
    }
    if (cond === undefined) { return; }
    var row = el('div', 'lg-pb-cond-row');
    var fieldSel = document.createElement('select');
    fieldSel.className = 'form-select';
    fieldSel.setAttribute('data-pb-cond-field', '');
    fieldSel.setAttribute('aria-label', 'Condition field');
    var blank = el('option', null, 'Choose a field\\u2026');
    blank.value = '';
    fieldSel.appendChild(blank);
    var opts = conditionFieldOptions();
    var i, o, matched;
    matched = false;
    for (i = 0; i < opts.length; i++) {
      o = el('option', null, opts[i].label);
      o.value = opts[i].value;
      if (opts[i].value === cond.when) { o.selected = true; matched = true; }
      fieldSel.appendChild(o);
    }
    if (!matched && trimStr(cond.when) !== '') {
      o = el('option', null, cond.when);
      o.value = cond.when;
      o.selected = true;
      fieldSel.appendChild(o);
    }
    row.appendChild(fieldSel);
    // ONE op source: clone the SSR'd template select (the §6.10 supported
    // set — server-rendered, asserted by tests) instead of a JS-side list.
    var opTemplate = bodyEl.querySelector('[data-pb-cond-op-template]');
    var opSel = opTemplate ? opTemplate.cloneNode(true) : document.createElement('select');
    opSel.hidden = false;
    opSel.removeAttribute('data-pb-cond-op-template');
    opSel.removeAttribute('aria-hidden');
    opSel.className = 'form-select';
    opSel.setAttribute('data-pb-cond-op', '');
    opSel.setAttribute('aria-label', 'Condition operator');
    var ui = cond.op === chosenUiOp ? chosenUiOp : condUiOp(cond);
    opSel.value = ui;
    row.appendChild(opSel);
    var valueBox = el('span', null, null);
    valueBox.setAttribute('data-pb-cond-values', '');
    var lfMeta = null;
    for (i = 0; i < opts.length; i++) { if (opts[i].value === cond.when) { lfMeta = opts[i]; } }
    if (ui === 'is_empty' || ui === 'is_not_empty') {
      valueBox.appendChild(el('span', 'form-help', 'no value needed'));
    } else if (cond.op === 'range') {
      var fromIn = document.createElement('input');
      fromIn.type = 'number'; fromIn.className = 'form-input'; fromIn.setAttribute('data-pb-cond-from', '');
      fromIn.setAttribute('aria-label', 'From'); fromIn.value = cond.from !== undefined ? String(cond.from) : '';
      var toIn = document.createElement('input');
      toIn.type = 'number'; toIn.className = 'form-input'; toIn.setAttribute('data-pb-cond-to', '');
      toIn.setAttribute('aria-label', 'To'); toIn.value = cond.to !== undefined ? String(cond.to) : '';
      valueBox.appendChild(fromIn); valueBox.appendChild(toIn);
    } else if (cond.op === 'in' || cond.op === 'not_in') {
      var listIn = document.createElement('input');
      listIn.type = 'text'; listIn.className = 'form-input'; listIn.setAttribute('data-pb-cond-list', '');
      listIn.setAttribute('aria-label', 'Values (comma-separated)');
      listIn.placeholder = 'CA, TX, NY';
      listIn.value = (cond.values || []).join(', ');
      valueBox.appendChild(listIn);
    } else if (lfMeta && lfMeta.answer_type === 'boolean') {
      var boolSel = document.createElement('select');
      boolSel.className = 'form-select'; boolSel.setAttribute('data-pb-cond-value', '');
      boolSel.setAttribute('aria-label', 'Condition value');
      var tOpt = el('option', null, 'true'); tOpt.value = 'true';
      var fOpt = el('option', null, 'false'); fOpt.value = 'false';
      boolSel.appendChild(tOpt); boolSel.appendChild(fOpt);
      boolSel.value = cond.value === true ? 'true' : 'false';
      // MINOR-2: under a live eq/neq pick a boolean field shows "false" for a
      // stored is-empty ('' / undefined) value; write the SHOWN value into the
      // model NOW so an operator who leaves the select can't silently save
      // is-empty when they meant "= false". A genuine stored boolean is kept.
      if (typeof cond.value !== 'boolean') { cond.value = boolSel.value === 'true'; }
      valueBox.appendChild(boolSel);
    } else {
      var valIn = document.createElement('input');
      valIn.type = ['gt', 'lt', 'gte', 'lte'].indexOf(cond.op) !== -1 ? 'number' : 'text';
      valIn.className = 'form-input'; valIn.setAttribute('data-pb-cond-value', '');
      valIn.setAttribute('aria-label', 'Condition value');
      valIn.value = cond.value === undefined ? '' : (typeof cond.value === 'string' ? cond.value : displayScalar(cond.value));
      valueBox.appendChild(valIn);
    }
    row.appendChild(valueBox);
    var removeBtn = el('button', 'btn btn-sm btn-danger', 'Remove');
    removeBtn.type = 'button';
    removeBtn.setAttribute('data-pb-cond-remove', '');
    row.appendChild(removeBtn);
    rowsBox.appendChild(row);
  }
  function readConditionFromRow(bodyEl, node) {
    var rowsBox = bodyEl.querySelector('[data-pb-condition-rows]');
    if (!rowsBox || !rowsBox.firstChild) { return; }
    var fieldSel = rowsBox.querySelector('[data-pb-cond-field]');
    var opSel = rowsBox.querySelector('[data-pb-cond-op]');
    if (!fieldSel || !opSel) { return; }
    var when = fieldSel.value;
    var uiOp = opSel.value;
    var cond = { when: when, op: uiOp };
    if (uiOp === 'is_empty') { cond.op = 'eq'; cond.value = ''; }
    else if (uiOp === 'is_not_empty') { cond.op = 'neq'; cond.value = ''; }
    else if (uiOp === 'range') {
      var fromIn = rowsBox.querySelector('[data-pb-cond-from]');
      var toIn = rowsBox.querySelector('[data-pb-cond-to]');
      if (fromIn && trimStr(fromIn.value) !== '') { cond.from = Number(fromIn.value); }
      if (toIn && trimStr(toIn.value) !== '') { cond.to = Number(toIn.value); }
    } else if (uiOp === 'in' || uiOp === 'not_in') {
      var listIn = rowsBox.querySelector('[data-pb-cond-list]');
      var values = [];
      var parts = String(listIn ? listIn.value : '').split(',');
      var i, piece;
      for (i = 0; i < parts.length; i++) {
        piece = trimStr(parts[i]);
        if (piece !== '') { values.push(piece); }
      }
      cond.values = values;
    } else {
      var valIn = rowsBox.querySelector('[data-pb-cond-value]');
      var raw = valIn ? valIn.value : '';
      if (valIn && valIn.tagName === 'SELECT') { cond.value = raw === 'true'; }
      else if (valIn && valIn.type === 'number') { cond.value = trimStr(raw) === '' ? undefined : Number(raw); }
      // MINOR-3: do NOT coerce a string field's literal "true"/"false" to a
      // boolean. A boolean field uses the SELECT branch above; here the field
      // is string/other, and conditionalMet compares with ===, so coercing
      // would make the string answer "true" never match and the conditional
      // payload field would silently drop. Keep the raw string. Numeric
      // ordering ops still coerce (a numeric comparison needs a number).
      else if (trimStr(raw) !== '' && !isNaN(Number(raw)) && ['gt', 'lt', 'gte', 'lte'].indexOf(cond.op) !== -1) { cond.value = Number(raw); }
      else { cond.value = raw; }
    }
    node.conditional = cond;
  }

  // --- the editor (center pane) --------------------------------------------------
  function stripAdvancedSourceGroups(bodyEl, node, drawerOpen) {
    var sel = bodyEl.querySelector('[data-pb-source-select]');
    if (!sel) { return; }
    var needAdvanced = node.source === 'macro' && node.macro !== undefined && !isNormalModeMacro(node.macro);
    if (needAdvanced || drawerOpen) { return; }
    var groups = sel.querySelectorAll('optgroup[data-advanced-only]');
    var i;
    for (i = groups.length - 1; i >= 0; i--) { groups[i].parentNode.removeChild(groups[i]); }
  }
  var NORMAL_MACROS = null;
  function isNormalModeMacro(name) {
    if (NORMAL_MACROS === null) {
      NORMAL_MACROS = {};
      var tpl = document.getElementById('lg-pb-editor-template');
      if (tpl && tpl.content) {
        var groups = tpl.content.querySelectorAll('[data-pb-source-select] optgroup');
        var i, j, opts, v;
        for (i = 0; i < groups.length; i++) {
          if (groups[i].getAttribute('data-advanced-only')) { continue; }
          opts = groups[i].querySelectorAll('option');
          for (j = 0; j < opts.length; j++) {
            v = opts[j].getAttribute('value') || '';
            if (v.indexOf('macro:') === 0) { NORMAL_MACROS[v.slice(6)] = 1; }
          }
        }
      }
    }
    return !!NORMAL_MACROS[name];
  }
  function derivedArraySource(node) {
    if (node.source === 'answer') { return 'multi_answer'; }
    var i;
    for (i = 0; i < items.length; i++) {
      if (items[i].node.path.indexOf(node.path + '.') === 0) { return 'repeated_group'; }
    }
    return 'static_list';
  }
  function applyEditorVisibility(bodyEl, node) {
    var dtype = displayTypeOf(node);
    var freeText = isFreeText(node);
    var isAnswer = node.source === 'answer';
    show(bodyEl, '[data-pb-panel="answer"]', isAnswer);
    show(bodyEl, '[data-pb-panel="static"]', node.source === 'static' && dtype !== 'object' && dtype !== 'array');
    show(bodyEl, '[data-pb-panel="token"]', node.source === 'token');
    show(bodyEl, '[data-pb-panel="freetext"]', isAnswer && dtype === 'string');
    show(bodyEl, '[data-pb-panel="valuemap"]', isAnswer && !freeText && (dtype === 'string' || dtype === 'enum' || dtype === 'number'));
    show(bodyEl, '[data-pb-panel="validvalues"]', isAnswer && !freeText && (dtype === 'string' || dtype === 'enum' || dtype === 'number'));
    show(bodyEl, '[data-pb-panel="date"]', dtype === 'date');
    show(bodyEl, '[data-pb-panel="boolean"]', dtype === 'boolean' && isAnswer);
    show(bodyEl, '[data-pb-panel="object"]', dtype === 'object');
    show(bodyEl, '[data-pb-panel="array"]', dtype === 'array');
    show(bodyEl, '[data-pb-panel="defaults"]', node.source !== 'token' && dtype !== 'object' && dtype !== 'array');
    show(bodyEl, '[data-pb-panel="condition"]', node.source !== 'token');
    var ftNote = bodyEl.querySelector('[data-pb-freetext-note]');
    if (ftNote) { ftNote.hidden = !freeText; }
    var ftToggle = bodyEl.querySelector('[data-pb-field="free_text"]');
    if (ftToggle) { ftToggle.checked = freeText; }
    // §6.5: the optional max-length + pattern controls exist only in
    // free-text mode.
    var ftConstraints = bodyEl.querySelector('[data-pb-freetext-constraints]');
    if (ftConstraints) { ftConstraints.hidden = !freeText; }
  }
  // §6.5 constraint controls ⇄ storage fields (free_text_max_length /
  // free_text_pattern / free_text_pattern_custom).
  function fillFreeTextPanel(bodyEl, node) {
    var maxIn = bodyEl.querySelector('[data-pb-field="free_text_max_length"]');
    if (maxIn) { maxIn.value = node.free_text_max_length === undefined ? '' : String(node.free_text_max_length); }
    var pat = typeof node.free_text_pattern === 'string' && FREE_TEXT_PATTERNS.indexOf(node.free_text_pattern) !== -1
      ? node.free_text_pattern : 'none';
    var patSel = bodyEl.querySelector('[data-pb-field="free_text_pattern"]');
    if (patSel) { patSel.value = pat; }
    var customIn = bodyEl.querySelector('[data-pb-field="free_text_pattern_custom"]');
    if (customIn) {
      customIn.hidden = pat !== 'custom';
      customIn.value = typeof node.free_text_pattern_custom === 'string' ? node.free_text_pattern_custom : '';
    }
  }
  function renderImplicitEditor(path) {
    clearChildren(editorEl);
    var box = el('div', 'lg-pb-editor-body');
    box.setAttribute('data-pb-editor-body', '');
    textP(box, 'form-help', 'Group \\u201c' + path + '\\u201d \\u2014 created by the fields inside it. Rename it to move every child at once, or add fields.');
    var impact = el('p', 'alert alert-warning');
    impact.setAttribute('data-pb-rename-impact', '');
    impact.hidden = true;
    box.appendChild(impact);
    var lbl = el('label', 'form-label', 'Name *');
    box.appendChild(lbl);
    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'form-input';
    input.setAttribute('data-pb-field', 'name');
    input.value = lastSegment(path);
    box.appendChild(input);
    var add = el('button', 'btn btn-secondary btn-sm', '+ Add child field');
    add.type = 'button';
    add.setAttribute('data-pb-add-child', '');
    box.appendChild(add);
    editorEl.appendChild(box);
  }
  function renderEditor() {
    if (!editorEl) { return; }
    if (!selectedRef) {
      clearChildren(editorEl);
      textP(editorEl, 'form-help', 'Select a field in the tree \\u2014 or add one \\u2014 to edit it here.');
      return;
    }
    if (selectedRef.kind === 'implicit') { renderImplicitEditor(selectedRef.path); return; }
    var item = itemByUid(selectedRef.uid);
    if (!item) { selectedRef = null; renderEditor(); return; }
    var node = item.node;
    var tpl = document.getElementById('lg-pb-editor-template');
    if (!tpl || !tpl.content) { return; }
    clearChildren(editorEl);
    editorEl.appendChild(document.importNode(tpl.content, true));
    var bodyEl = editorEl.querySelector('[data-pb-editor-body]');
    if (!bodyEl) { return; }
    // identity
    setVal(bodyEl, '[data-pb-field="name"]', node.name || lastSegment(node.path || ''));
    setVal(bodyEl, '[data-pb-field="label"]', node.label);
    var typeSel = bodyEl.querySelector('[data-pb-field="type"]');
    if (typeSel) {
      var dtype = displayTypeOf(node);
      if (dtype !== 'enum') {
        var legacyOpt = typeSel.querySelector('option[data-legacy-only]');
        if (legacyOpt) { legacyOpt.parentNode.removeChild(legacyOpt); }
      }
      typeSel.value = dtype;
    }
    setVal(bodyEl, '[data-pb-field="required"]', node.required === true);
    var srcSel = bodyEl.querySelector('[data-pb-source-select]');
    stripAdvancedSourceGroups(bodyEl, node, !!advOpen[item.uid]);
    if (srcSel) { srcSel.value = sourceValueOf(node); }
    var help = bodyEl.querySelector('[data-pb-source-help]');
    if (help && srcSel && srcSel.selectedIndex >= 0 && srcSel.options[srcSel.selectedIndex]) {
      help.textContent = srcSel.options[srcSel.selectedIndex].getAttribute('data-help') || '';
    }
    // advanced-managed badge
    var adv = advReasons[item.uid] || [];
    var advBadge = bodyEl.querySelector('[data-pb-advanced-managed]');
    if (advBadge) {
      advBadge.hidden = adv.length === 0;
      if (adv.length > 0) { advBadge.title = 'Preserved raw settings: ' + adv.join(', '); }
    }
    // token note
    var tokenNote = bodyEl.querySelector('[data-pb-token-note]');
    if (tokenNote) {
      tokenNote.textContent = offerMeta.api_token_secret_ref
        ? 'Token ref: ' + offerMeta.api_token_secret_ref + ' \\u2014 the value resolves server-side and is always masked.'
        : 'No token secret is configured yet \\u2014 set the token secret ref in the Request tab.';
    }
    // panels
    applyEditorVisibility(bodyEl, node);
    fillAnswerPicker(bodyEl, node, '');
    var dtype2 = displayTypeOf(node);
    if (node.source === 'static' && dtype2 !== 'object' && dtype2 !== 'array') {
      var kinds = ['text', 'number', 'boolean', 'date'];
      var typedKind = dtype2 === 'number' ? 'number' : (dtype2 === 'boolean' ? 'boolean' : (dtype2 === 'date' ? 'date' : 'text'));
      var i, input;
      for (i = 0; i < kinds.length; i++) {
        input = bodyEl.querySelector('[data-pb-static="' + kinds[i] + '"]');
        if (!input) { continue; }
        input.hidden = kinds[i] !== typedKind;
        if (kinds[i] === typedKind && node.value !== undefined) {
          if (typedKind === 'boolean') { input.value = node.value === true ? 'true' : 'false'; }
          else { input.value = typeof node.value === 'string' ? node.value : displayScalar(node.value); }
        }
      }
    }
    fillValueMapCompact(bodyEl, node);
    fillFreeTextPanel(bodyEl, node);
    setVal(bodyEl, '[data-pb-field="otherGroupEnabled"]', !!(node.choiceDisplay && node.choiceDisplay.otherGroupEnabled));
    setVal(bodyEl, '[data-pb-field="otherGroupLabel"]', node.choiceDisplay ? node.choiceDisplay.otherGroupLabel : '');
    setVal(bodyEl, '[data-pb-field="searchableOther"]', !!(node.choiceDisplay && node.choiceDisplay.searchableOther));
    var vvBox = bodyEl.querySelector('[data-pb-validvalues-chips]');
    if (vvBox) { fillChips(vvBox, node.valid_values || [], true); }
    if (dtype2 === 'date') { fillDatePanel(bodyEl, node); }
    if (dtype2 === 'boolean' && node.source === 'answer') { fillBooleanPanel(bodyEl, node); }
    if (dtype2 === 'object') {
      var pre = bodyEl.querySelector('[data-pb-subtree-preview]');
      if (pre) {
        var sub = {};
        var j, v2;
        for (j = 0; j < items.length; j++) {
          if (items[j].node.path.indexOf(node.path + '.') === 0 && items[j].node.type !== 'object' && items[j].node.type !== 'array') {
            v2 = sampleValueFor(items[j].node);
            if (v2 !== undefined) { setAtPathLite(sub, items[j].node.path.slice(node.path.length + 1), v2); }
          }
        }
        pre.textContent = JSON.stringify(sub, null, 2);
      }
    }
    if (dtype2 === 'array') {
      var itemTypeSel = bodyEl.querySelector('[data-pb-field="array_item_type"]');
      var srcModeSel = bodyEl.querySelector('[data-pb-field="array_source"]');
      var arraySource = derivedArraySource(node);
      if (srcModeSel) { srcModeSel.value = arraySource; }
      var panels = ['static_list', 'multi_answer', 'repeated_group'];
      for (i = 0; i < panels.length; i++) {
        show(bodyEl, '[data-pb-array-panel="' + panels[i] + '"]', panels[i] === arraySource);
      }
      if (itemTypeSel) {
        var itemType = 'string';
        if (arraySource === 'static_list' && Object.prototype.toString.call(node.value) === '[object Array]' && node.value.length > 0) {
          itemType = typeof node.value[0] === 'number' ? 'number' : (typeof node.value[0] === 'boolean' ? 'boolean' : 'string');
        } else if (arraySource === 'repeated_group') { itemType = 'object'; }
        itemTypeSel.value = itemType;
      }
      var chipsBox = bodyEl.querySelector('[data-pb-array-static-chips]');
      if (chipsBox && arraySource === 'static_list') {
        fillChips(chipsBox, Object.prototype.toString.call(node.value) === '[object Array]' ? node.value : [], true);
      }
    }
    fillDefaultSide(bodyEl, node, 'default');
    fillDefaultSide(bodyEl, node, 'fallback');
    fillConditionPanel(bodyEl, node);
    setVal(bodyEl, '[data-pb-field="notes"]', node.notes);
    var rawTa = bodyEl.querySelector('[data-pb-field-raw]');
    if (rawTa) { rawTa.value = JSON.stringify(node, null, 2); }
    var drawer = bodyEl.querySelector('[data-pb-advanced]');
    if (drawer && advOpen[item.uid]) { drawer.open = true; }
  }

  function afterModelChange() {
    renderTree();
    refreshPreview();
    refreshSample();
    refreshValidation();
  }

  // --- editor event wiring (delegated once) -------------------------------------------
  function selectedItem() {
    return selectedRef && selectedRef.kind === 'item' ? itemByUid(selectedRef.uid) : null;
  }
  function applyDateFormat(node, fmt) {
    if (trimStr(fmt) === '') { return; }
    node.type = 'string';
    node.transform = [{ kind: 'formatDate', format: fmt }];
  }
  function setDisplayType(item, newType) {
    var node = item.node;
    var hadChildren = subtreeUids(node.path).length > 1;
    if (hadChildren && newType !== 'object' && newType !== 'array') {
      window.alert('This field has nested fields \\u2014 delete or move them before changing its type.');
      renderEditor();
      return;
    }
    // §6.5: free-text constraints require the plain string display type.
    if (newType !== 'string') { clearFreeTextConstraints(node); }
    var wasDate = isDateNode(node);
    if (newType === 'date') {
      applyDateFormat(node, 'YYYY-MM-DD');
    } else {
      if (wasDate) { delete node.transform; }
      node.type = newType;
      if (newType === 'object' && node.source === 'static' && !isRecordVal(node.value)) { node.value = {}; }
      if (newType === 'array' && node.source === 'static' && Object.prototype.toString.call(node.value) !== '[object Array]') { node.value = []; }
      if (newType === 'boolean' && node.source === 'answer' && node.value_map === undefined) {
        node.value_map = { 'true': true, 'false': false };
      }
      if (newType !== 'boolean' && node.source === 'answer' && node.value_map !== undefined) {
        var vm = node.value_map;
        var onlyBool = isRecordVal(vm) && hasOwn(vm, 'true') && hasOwn(vm, 'false');
        var k, extra;
        extra = 0;
        for (k in vm) { if (hasOwn(vm, k) && k !== 'true' && k !== 'false') { extra += 1; } }
        if (onlyBool && extra === 0) { delete node.value_map; }
      }
    }
    refreshAdvReasons(item);
    renderAll();
  }
  function setSource(item, encoded) {
    var node = item.node;
    delete node.internal_field;
    delete node.value;
    delete node.computed;
    delete node.macro;
    if (node.source === 'answer' && encoded.indexOf('answer') !== 0) {
      delete node.value_map;
      delete node.choiceDisplay;
      clearFreeTextConstraints(node);
      if (!isDateNode(node)) { delete node.transform; }
    }
    if (encoded === 'answer') { node.source = 'answer'; }
    else if (encoded === 'static') {
      node.source = 'static';
      if (node.type === 'object') { node.value = {}; }
      else if (node.type === 'array') { node.value = []; }
      else { node.value = ''; }
    }
    else if (encoded === 'placement') { node.source = 'placement'; }
    else if (encoded === 'token') { node.source = 'token'; node.type = 'string'; delete node.value_map; delete node.transform; delete node.valid_values; }
    else if (encoded.indexOf('macro:') === 0) { node.source = 'macro'; node.macro = encoded.slice(6); }
    else if (encoded.indexOf('computed:') === 0) { node.source = 'computed'; node.computed = encoded.slice(9); }
    if (node.source === 'answer' && displayTypeOf(node) === 'boolean' && node.value_map === undefined) {
      node.value_map = { 'true': true, 'false': false };
    }
    refreshAdvReasons(item);
    renderAll();
  }
  function typedStaticValue(node, raw, kind) {
    if (kind === 'number') { return trimStr(raw) === '' ? undefined : Number(raw); }
    if (kind === 'boolean') { return raw === 'true'; }
    return raw;
  }

  if (builderActive) {
    editorEl.addEventListener('change', function (e) {
      var t = e.target;
      var item = selectedRef && selectedRef.kind === 'implicit' ? null : selectedItem();
      if (!t || !t.getAttribute) { return; }
      var field = t.getAttribute('data-pb-field');
      if (selectedRef && selectedRef.kind === 'implicit') {
        if (field === 'name') { renameSelected(trimStr(t.value), editorEl.querySelector('[data-pb-rename-impact]')); }
        return;
      }
      if (!item) { return; }
      var node = item.node;
      if (field === 'name') { renameSelected(trimStr(t.value), editorEl.querySelector('[data-pb-rename-impact]')); return; }
      if (field === 'label') {
        if (trimStr(t.value) === '') { delete node.label; } else { node.label = t.value; }
        afterModelChange();
        return;
      }
      if (field === 'type') { setDisplayType(item, t.value); return; }
      if (field === 'required') {
        if (t.checked) { node.required = true; } else { delete node.required; }
        afterModelChange();
        return;
      }
      if (t.getAttribute('data-pb-source-select') !== null) { setSource(item, t.value); return; }
      if (t.getAttribute('data-pb-answer-picker') !== null || t.getAttribute('data-pb-answer-manual') !== null) {
        var iv = trimStr(t.value);
        if (iv === '') { delete node.internal_field; } else { node.internal_field = iv; }
        renderEditor();
        afterModelChange();
        return;
      }
      if (t.getAttribute('data-pb-static') !== null) {
        node.value = typedStaticValue(node, t.value, t.getAttribute('data-pb-static'));
        afterModelChange();
        return;
      }
      if (field === 'free_text') {
        if (t.checked) {
          delete node.value_map;
          delete node.valid_values;
          delete node.choiceDisplay;
        } else {
          // leaving free-text mode: the §6.5 constraints are meaningless on
          // a mapped node — drop them with it.
          clearFreeTextConstraints(node);
          if (node.value_map === undefined) { node.value_map = {}; }
        }
        refreshAdvReasons(item);
        renderEditor();
        afterModelChange();
        return;
      }
      if (field === 'free_text_max_length') {
        var maxRaw = trimStr(t.value);
        var maxNum = Number(maxRaw);
        if (maxRaw === '' || !isFinite(maxNum)) { delete node.free_text_max_length; }
        else { node.free_text_max_length = maxNum; }
        afterModelChange();
        return;
      }
      if (field === 'free_text_pattern') {
        if (t.value === 'none') {
          // "None" = unconstrained — drop the pattern pair entirely.
          delete node.free_text_pattern;
          delete node.free_text_pattern_custom;
        } else {
          node.free_text_pattern = t.value;
          if (t.value !== 'custom') { delete node.free_text_pattern_custom; }
        }
        renderEditor();
        afterModelChange();
        return;
      }
      if (field === 'free_text_pattern_custom') {
        if (trimStr(t.value) === '') { delete node.free_text_pattern_custom; }
        else { node.free_text_pattern_custom = t.value; }
        afterModelChange();
        return;
      }
      if (field === 'otherGroupEnabled' || field === 'searchableOther' || field === 'otherGroupLabel') {
        var cd = isRecordVal(node.choiceDisplay) ? node.choiceDisplay : {};
        if (field === 'otherGroupLabel') {
          if (trimStr(t.value) === '') { delete cd.otherGroupLabel; } else { cd.otherGroupLabel = t.value; }
        } else if (t.checked) { cd[field] = true; } else { delete cd[field]; }
        var anyKey = false;
        var ck;
        for (ck in cd) { if (hasOwn(cd, ck)) { anyKey = true; } }
        if (anyKey) { node.choiceDisplay = cd; } else { delete node.choiceDisplay; }
        renderEditor();
        afterModelChange();
        return;
      }
      if (field === 'date_format' || field === 'date_format_custom') {
        var fmtSel = editorEl.querySelector('[data-pb-field="date_format"]');
        var customIn = editorEl.querySelector('[data-pb-field="date_format_custom"]');
        var fmt = fmtSel && fmtSel.value === '__custom__' ? (customIn ? customIn.value : '') : (fmtSel ? fmtSel.value : '');
        if (customIn) { customIn.hidden = !(fmtSel && fmtSel.value === '__custom__'); }
        if (trimStr(fmt) !== '') { applyDateFormat(node, fmt); }
        refreshAdvReasons(item);
        updateDatePreview(editorEl, node);
        afterModelChange();
        return;
      }
      if (field === 'bool_preset') {
        var opt = t.options[t.selectedIndex];
        show(editorEl, '[data-pb-bool-custom]', t.value === 'custom');
        if (t.value !== 'custom' && opt) {
          try {
            node.value_map = {
              'true': JSON.parse(opt.getAttribute('data-true-json')),
              'false': JSON.parse(opt.getAttribute('data-false-json'))
            };
          } catch (err) { /* unreachable: SSR JSON */ }
          fillBooleanPanel(editorEl, node);
          afterModelChange();
        }
        return;
      }
      if (field === 'array_item_type' || field === 'array_source') {
        var srcModeSel = editorEl.querySelector('[data-pb-field="array_source"]');
        var mode = srcModeSel ? srcModeSel.value : 'static_list';
        if (mode === 'static_list') { node.source = 'static'; delete node.internal_field; if (Object.prototype.toString.call(node.value) !== '[object Array]') { node.value = []; } }
        if (mode === 'multi_answer') { node.source = 'answer'; delete node.value; }
        if (mode === 'repeated_group') { node.source = 'static'; delete node.internal_field; node.value = []; }
        refreshAdvReasons(item);
        renderEditor();
        afterModelChange();
        return;
      }
      if (t.getAttribute('data-pb-default-mode') !== null || t.getAttribute('data-pb-fallback-mode') !== null) {
        var prefix = t.getAttribute('data-pb-default-mode') !== null ? 'default' : 'fallback';
        var keyName = prefix;
        var wasRef = isRecordVal(node[keyName]) && node[keyName].source === 'computed';
        if (t.value === 'disabled') { delete node[keyName]; }
        else if (t.value === 'static' && (node[keyName] === undefined || wasRef)) {
          var dt = displayTypeOf(node);
          node[keyName] = dt === 'number' ? 0 : (dt === 'boolean' ? false : '');
        }
        else if (t.value === 'computed') {
          // §6.9: emit the TYPED object — the registry dropdown picks the key.
          var compSel = editorEl.querySelector('[data-pb-' + prefix + '-computed]');
          node[keyName] = { source: 'computed', key: compSel ? compSel.value : '' };
        }
        show(editorEl, '[data-pb-' + prefix + '-inputs]', t.value === 'static');
        show(editorEl, '[data-pb-' + prefix + '-computed-wrap]', t.value === 'computed');
        show(editorEl, '[data-pb-' + prefix + '-copy-wrap]', t.value === 'copy');
        if (t.value !== 'copy') { renderEditor(); }
        afterModelChange();
        return;
      }
      if (t.getAttribute('data-pb-default-computed') !== null || t.getAttribute('data-pb-fallback-computed') !== null) {
        var prefixC = t.getAttribute('data-pb-default-computed') !== null ? 'default' : 'fallback';
        node[prefixC] = { source: 'computed', key: t.value };
        afterModelChange();
        return;
      }
      if (t.getAttribute('data-pb-default-value') !== null || t.getAttribute('data-pb-fallback-value') !== null) {
        var prefix2 = t.getAttribute('data-pb-default-value') !== null ? 'default' : 'fallback';
        node[prefix2] = readTypedInput(editorEl, prefix2, displayTypeOf(node));
        afterModelChange();
        return;
      }
      if (t.getAttribute('data-pb-cond-field') !== null || t.getAttribute('data-pb-cond-op') !== null ||
          t.getAttribute('data-pb-cond-value') !== null || t.getAttribute('data-pb-cond-from') !== null ||
          t.getAttribute('data-pb-cond-to') !== null || t.getAttribute('data-pb-cond-list') !== null) {
        readConditionFromRow(editorEl, node);
        fillConditionPanel(editorEl, node);
        afterModelChange();
        return;
      }
      if (field === 'notes') {
        if (trimStr(t.value) === '') { delete node.notes; } else { node.notes = t.value; }
        afterModelChange();
        return;
      }
    });

    editorEl.addEventListener('input', function (e) {
      var t = e.target;
      var item = selectedItem();
      if (!t || !t.getAttribute || !item) { return; }
      if (t.getAttribute('data-pb-answer-search') !== null) {
        fillAnswerPicker(editorEl, item.node, t.value);
        return;
      }
      if (t.getAttribute('data-pb-date-sample') !== null) { updateDatePreview(editorEl, item.node); }
      if (t.getAttribute('data-pb-bool-true') !== null || t.getAttribute('data-pb-bool-false') !== null) {
        var presetSel = editorEl.querySelector('[data-pb-field="bool_preset"]');
        if (presetSel && presetSel.value === 'custom') {
          var dt = item.node.type;
          var tRaw = editorEl.querySelector('[data-pb-bool-true]');
          var fRaw = editorEl.querySelector('[data-pb-bool-false]');
          function typedBoolOut(raw) {
            if (dt === 'number') { return trimStr(raw) === '' ? 0 : Number(raw); }
            if (dt === 'boolean') { return raw === 'true'; }
            return raw;
          }
          item.node.value_map = { 'true': typedBoolOut(tRaw ? tRaw.value : ''), 'false': typedBoolOut(fRaw ? fRaw.value : '') };
          var chipT = editorEl.querySelector('[data-pb-bool-chip-true]');
          var chipF = editorEl.querySelector('[data-pb-bool-chip-false]');
          if (chipT) { chipT.textContent = displayScalar(item.node.value_map['true']); }
          if (chipF) { chipF.textContent = displayScalar(item.node.value_map['false']); }
          refreshPreview();
          refreshSample();
          refreshValidation();
        }
      }
    });

    editorEl.addEventListener('keydown', function (e) {
      var t = e.target;
      if (!t || !t.getAttribute || e.key !== 'Enter') { return; }
      var item = selectedItem();
      if (!item) { return; }
      if (t.getAttribute('data-pb-validvalues-input') !== null) {
        e.preventDefault();
        var v = trimStr(t.value);
        if (v === '') { return; }
        var typed = item.node.type === 'number' && !isNaN(Number(v)) ? Number(v) : v;
        if (Object.prototype.toString.call(item.node.valid_values) !== '[object Array]') { item.node.valid_values = []; }
        item.node.valid_values.push(typed);
        t.value = '';
        fillChips(editorEl.querySelector('[data-pb-validvalues-chips]'), item.node.valid_values, true);
        afterModelChange();
      }
      if (t.getAttribute('data-pb-array-static-input') !== null) {
        e.preventDefault();
        var raw = trimStr(t.value);
        if (raw === '') { return; }
        var itemTypeSel = editorEl.querySelector('[data-pb-field="array_item_type"]');
        var itKind = itemTypeSel ? itemTypeSel.value : 'string';
        var typed2 = itKind === 'number' ? Number(raw) : (itKind === 'boolean' ? raw === 'true' : raw);
        if (Object.prototype.toString.call(item.node.value) !== '[object Array]') { item.node.value = []; }
        item.node.value.push(typed2);
        t.value = '';
        fillChips(editorEl.querySelector('[data-pb-array-static-chips]'), item.node.value, true);
        afterModelChange();
      }
    });

    editorEl.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) { return; }
      var item = selectedItem();
      var btn;
      btn = t.closest('[data-chip-remove]');
      if (btn && item) {
        var idx = Number(btn.getAttribute('data-chip-remove'));
        var chipsBox = btn.parentNode.parentNode;
        if (chipsBox.getAttribute('data-pb-validvalues-chips') !== null && item.node.valid_values) {
          item.node.valid_values.splice(idx, 1);
          if (item.node.valid_values.length === 0) { delete item.node.valid_values; }
        } else if (chipsBox.getAttribute('data-pb-array-static-chips') !== null && item.node.value) {
          item.node.value.splice(idx, 1);
        }
        renderEditor();
        afterModelChange();
        return;
      }
      if (t.closest('[data-pb-add-child]')) {
        addField('field', selectedRef.kind === 'implicit' ? selectedRef.path : (item ? item.node.path : ''));
        return;
      }
      if (t.closest('[data-pb-array-add-item]') && item) {
        addField('object', item.node.path);
        return;
      }
      if (t.closest('[data-pb-valuemap-open]') && item) { openValueMapModal(item); return; }
      if (t.closest('[data-pb-condition-add]') && item) {
        item.node.conditional = { when: '', op: 'eq', value: '' };
        renderEditor();
        afterModelChange();
        return;
      }
      if (t.closest('[data-pb-cond-remove]') && item) {
        delete item.node.conditional;
        renderEditor();
        afterModelChange();
        return;
      }
      btn = t.closest('[data-pb-normalize]');
      if (btn && item) {
        var which = btn.getAttribute('data-pb-normalize');
        var note = looseNote(item.node, which, displayTypeOf(item.node));
        if (note !== null) { item.node[which] = note.value; }
        renderEditor();
        afterModelChange();
        return;
      }
      btn = t.closest('[data-pb-default-copy],[data-pb-fallback-copy]');
      if (btn && item) {
        var prefix3 = btn.getAttribute('data-pb-default-copy') !== null ? 'default' : 'fallback';
        var fromSel = editorEl.querySelector('[data-pb-' + prefix3 + '-copy-from]');
        var src = fromSel ? itemByPath(fromSel.value) : null;
        if (src) {
          var copied = src.node.value !== undefined ? src.node.value : src.node['default'];
          if (copied === undefined) {
            window.alert('That field has no static/default value to copy yet.');
          } else {
            item.node[prefix3] = deepClone(copied);
            renderEditor();
            afterModelChange();
          }
        }
        return;
      }
      btn = t.closest('[data-pb-field-raw-apply]');
      if (btn && item) {
        var ta = editorEl.querySelector('[data-pb-field-raw]');
        var errEl = editorEl.querySelector('[data-pb-field-raw-error]');
        if (errEl) { errEl.hidden = true; errEl.textContent = ''; }
        var parsed = null;
        try { parsed = JSON.parse(ta ? ta.value : ''); } catch (err) { parsed = null; }
        if (!isRecordVal(parsed) || typeof parsed.path !== 'string' || trimStr(parsed.path) === '') {
          if (errEl) { errEl.hidden = false; errEl.textContent = 'Raw field JSON must be an object with a path.'; }
          return;
        }
        item.node = parsed;
        refreshAdvReasons(item);
        advOpen[item.uid] = true;
        renderAll();
        if (window.showToast) { window.showToast('Raw JSON applied to the field', 'success'); }
        return;
      }
      if (t.closest('[data-pb-duplicate]') && item) { duplicateByPath(item.node.path); return; }
      btn = t.closest('[data-pb-move]');
      if (btn && item) { moveByPath(item.node.path, btn.getAttribute('data-pb-move')); return; }
      if (t.closest('[data-pb-delete]') && item) { deleteByPath(item.node.path); return; }
    });

    // per-field Advanced drawer toggle re-renders so the Advanced-macro
    // optgroups appear/disappear with it (§6.2 visible-only-in-Advanced).
    editorEl.addEventListener('toggle', function (e) {
      var t = e.target;
      var item = selectedItem();
      if (!t || !t.getAttribute || t.getAttribute('data-pb-advanced') === null || !item) { return; }
      if (advOpen[item.uid] !== t.open) {
        advOpen[item.uid] = t.open;
        renderEditor();
      }
    }, true);
  }

  // --- tree pane events ------------------------------------------------------------
  if (builderActive) {
    treeEl.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) { return; }
      var toggle = t.closest('[data-pb-toggle]');
      if (toggle) {
        var p = toggle.getAttribute('data-pb-toggle');
        if (expandedOff[p]) { delete expandedOff[p]; } else { expandedOff[p] = 1; }
        renderTree();
        return;
      }
      var act = t.closest('[data-pb-act]');
      if (act) {
        var actPath = act.getAttribute('data-pb-act-path');
        var kind = act.getAttribute('data-pb-act');
        if (kind === 'dup') { duplicateByPath(actPath); }
        else if (kind === 'del') { deleteByPath(actPath); }
        else { moveByPath(actPath, kind); }
        return;
      }
      var sel = t.closest('[data-pb-select]');
      if (sel) {
        var row = sel.closest('.lg-pb-node');
        var uidAttr = row ? row.getAttribute('data-pb-uid') : null;
        if (uidAttr !== null) { selectedRef = { kind: 'item', uid: Number(uidAttr) }; }
        else { selectedRef = { kind: 'implicit', path: sel.getAttribute('data-pb-select') }; }
        renderTree();
        renderEditor();
        refreshPreview();
        return;
      }
    });
    var addBtnsBox = document.querySelector('.lg-pb-toolbar');
    if (addBtnsBox) {
      addBtnsBox.addEventListener('click', function (e) {
        var btn = e.target && e.target.closest ? e.target.closest('[data-pb-add]') : null;
        if (btn) { addField(btn.getAttribute('data-pb-add')); }
      });
    }
    var searchIn = document.getElementById('lg-pb-search');
    if (searchIn) {
      searchIn.addEventListener('input', function () {
        searchTerm = trimStr(searchIn.value);
        renderTree();
      });
    }
    var openTestBtn = document.querySelector('[data-pb-open-test]');
    if (openTestBtn) { openTestBtn.addEventListener('click', function () { switchTab('test'); }); }
  }

  // --- §6.3 value-map modal -----------------------------------------------------------
  var vmModal = document.getElementById('lg-pb-valuemap-modal');
  var vmState = null; // {item, rows:[{internal,output,main}], sortKey, sortDir, filter}

  // Section choice labels for the Display label / Analytics label columns +
  // the unmapped-internal-values footer — from the sample-answers endpoint
  // (fields[].options carry the Section's choices per internal field).
  function ensureSampleFields(cb) {
    if (sampleFieldsCache !== null) { cb(sampleFieldsCache); return; }
    getJson('POST', apiBase + '/payload/sample-answers', {}).then(function (res) {
      if (res.ok && res.body && res.body.fields) { sampleFieldsCache = res.body; }
      cb(sampleFieldsCache);
    }).catch(function () { cb(null); });
  }
  function choiceOptionsFor(internal) {
    if (!sampleFieldsCache || !sampleFieldsCache.fields) { return null; }
    var i, f;
    for (i = 0; i < sampleFieldsCache.fields.length; i++) {
      f = sampleFieldsCache.fields[i];
      if (f.internal_field === internal && f.options && f.options.length > 0) { return f.options; }
    }
    return null;
  }
  function choiceLabelFor(internal, value) {
    var opts = choiceOptionsFor(internal);
    if (!opts) { return null; }
    var i;
    for (i = 0; i < opts.length; i++) {
      if (String(opts[i].value) === String(value)) { return opts[i].label; }
    }
    return null;
  }

  function vmRenderRows() {
    if (!vmState || !vmModal) { return; }
    var tbody = vmModal.querySelector('[data-vm-rows]');
    clearChildren(tbody);
    var internal = trimStr(vmState.item.node.internal_field);
    var filter = (vmState.filter || '').toLowerCase();
    var rows = vmState.rows;
    var i, r, tr, td, input, sel2, cb2;
    for (i = 0; i < rows.length; i++) {
      r = rows[i];
      if (filter !== '' && (r.internal + ' ' + displayScalar(r.output)).toLowerCase().indexOf(filter) === -1) { continue; }
      tr = document.createElement('tr');
      tr.setAttribute('data-vm-row', String(i));
      // Display label (from the Section choice) — read-only projection
      var dl = choiceLabelFor(internal, r.internal);
      tr.appendChild(el('td', null, dl !== null ? dl : '\\u2014'));
      // Internal normalized value
      td = document.createElement('td');
      input = document.createElement('input');
      input.type = 'text'; input.className = 'form-input';
      input.setAttribute('data-vm-in', 'internal');
      input.setAttribute('aria-label', 'Internal value');
      input.value = r.internal;
      td.appendChild(input);
      tr.appendChild(td);
      // Provider output value
      td = document.createElement('td');
      input = document.createElement('input');
      input.type = 'text'; input.className = 'form-input';
      input.setAttribute('data-vm-in', 'output');
      input.setAttribute('aria-label', 'Provider output value');
      input.value = typeof r.output === 'string' ? r.output : displayScalar(r.output);
      td.appendChild(input);
      tr.appendChild(td);
      // Output type
      td = document.createElement('td');
      sel2 = document.createElement('select');
      sel2.className = 'form-select';
      sel2.setAttribute('data-vm-in', 'output_type');
      sel2.setAttribute('aria-label', 'Output type');
      var types = ['string', 'number', 'boolean'];
      var j, o2;
      for (j = 0; j < types.length; j++) {
        o2 = el('option', null, types[j]);
        o2.value = types[j];
        sel2.appendChild(o2);
      }
      sel2.value = typeof r.output === 'number' ? 'number' : (typeof r.output === 'boolean' ? 'boolean' : 'string');
      td.appendChild(sel2);
      tr.appendChild(td);
      // Main choice?
      td = document.createElement('td');
      cb2 = document.createElement('input');
      cb2.type = 'checkbox';
      cb2.setAttribute('data-vm-in', 'main');
      cb2.setAttribute('aria-label', 'Main choice');
      cb2.checked = !!r.main;
      td.appendChild(cb2);
      tr.appendChild(td);
      // Other group? (derived)
      var otherOn = !!(vmState.item.node.choiceDisplay && vmState.item.node.choiceDisplay.otherGroupEnabled);
      tr.appendChild(el('td', null, otherOn ? (r.main ? '' : 'Other') : '\\u2014'));
      // Analytics label (the Section choice label used in analytics — projection)
      tr.appendChild(el('td', null, dl !== null ? dl : '\\u2014'));
      // Notes (no storage slot on value_map rows — read-only placeholder)
      td = el('td', null, '\\u2014');
      td.title = 'Per-row notes have no storage on value_map \\u2014 use the field notes.';
      tr.appendChild(td);
      // Actions
      td = document.createElement('td');
      td.className = 'table-actions';
      var acts = [['main', 'Mark as main'], ['other', 'Move to Other'], ['dup', 'Duplicate'], ['del', 'Delete']];
      for (j = 0; j < acts.length; j++) {
        var ab = el('button', 'btn btn-sm btn-outline', acts[j][1]);
        ab.type = 'button';
        ab.setAttribute('data-vm-row-act', acts[j][0]);
        td.appendChild(ab);
      }
      tr.appendChild(td);
      tbody.appendChild(tr);
    }
    // count chips + main-count soft warning (§6.4)
    var mains = 0;
    for (i = 0; i < rows.length; i++) { if (rows[i].main) { mains += 1; } }
    var chips = vmModal.querySelector('[data-vm-count-chips]');
    if (chips) {
      var otherLabel = (vmState.item.node.choiceDisplay && vmState.item.node.choiceDisplay.otherGroupLabel) || 'Other';
      chips.textContent = mains + ' main \\u00b7 ' + (rows.length - mains) + ' in ' + otherLabel;
    }
    var warn = vmModal.querySelector('[data-vm-main-warn]');
    if (warn) {
      warn.hidden = mains <= 9;
      if (mains > 9) { warn.textContent = mains + ' main choices \\u2014 more than 9 gets crowded.'; }
    }
    // unmapped-internal-values footer warning
    var unmapped = vmModal.querySelector('[data-vm-unmapped-warning]');
    if (unmapped) {
      var opts = choiceOptionsFor(internal);
      var missing = [];
      if (opts) {
        var have = {};
        for (i = 0; i < rows.length; i++) { have[rows[i].internal] = 1; }
        for (i = 0; i < opts.length; i++) {
          if (!have[String(opts[i].value)]) { missing.push(String(opts[i].value)); }
        }
      }
      unmapped.hidden = missing.length === 0;
      if (missing.length > 0) {
        unmapped.textContent = missing.length + ' Section choice value' + (missing.length === 1 ? '' : 's') + ' missing from this map (will fall to default/fallback): ' + missing.join(', ');
      }
    }
  }
  function openValueMapModal(item) {
    if (!vmModal) { return; }
    vmState = { item: item, rows: valueMapEntries(item.node), sortKey: null, sortDir: 1, filter: '' };
    var lbl = vmModal.querySelector('[data-vm-field-label]');
    if (lbl) { lbl.textContent = (item.node.label || item.node.name || '') + ' (' + trimStr(item.node.internal_field) + ')'; }
    var search = vmModal.querySelector('[data-vm-search]');
    if (search) { search.value = ''; }
    var addMany = vmModal.querySelector('[data-vm-add-many-wrap]');
    if (addMany) { addMany.hidden = true; }
    var csvMap = vmModal.querySelector('[data-vm-csv-map]');
    if (csvMap) { csvMap.hidden = true; }
    vmModal.style.display = 'flex';
    vmModal.classList.remove('hidden');
    vmModal.setAttribute('aria-hidden', 'false');
    vmRenderRows();
    ensureSampleFields(function () { vmRenderRows(); });
  }
  function closeValueMapModal() {
    if (!vmModal) { return; }
    vmModal.style.display = 'none';
    vmModal.classList.add('hidden');
    vmModal.setAttribute('aria-hidden', 'true');
    vmState = null;
  }
  function vmTypedOutput(raw, kind) {
    if (kind === 'number') { return trimStr(raw) === '' ? 0 : Number(raw); }
    if (kind === 'boolean') { return raw === 'true' || raw === '1'; }
    return raw;
  }
  function vmSyncRowFromInputs(tr) {
    if (!vmState) { return; }
    var idx = Number(tr.getAttribute('data-vm-row'));
    var r = vmState.rows[idx];
    if (!r) { return; }
    var internalIn = tr.querySelector('[data-vm-in="internal"]');
    var outputIn = tr.querySelector('[data-vm-in="output"]');
    var typeSel = tr.querySelector('[data-vm-in="output_type"]');
    var mainCb = tr.querySelector('[data-vm-in="main"]');
    if (internalIn) { r.internal = internalIn.value; }
    if (outputIn && typeSel) { r.output = vmTypedOutput(outputIn.value, typeSel.value); }
    if (mainCb) { r.main = mainCb.checked; }
  }

  // Minimal CSV parser (quotes + escaped quotes + commas + newlines).
  function parseCsv(text) {
    var rows = [];
    var row = [];
    var cur = '';
    var inQuotes = false;
    var i, ch;
    for (i = 0; i < text.length; i++) {
      ch = text.charAt(i);
      if (inQuotes) {
        if (ch === '"') {
          if (text.charAt(i + 1) === '"') { cur += '"'; i += 1; }
          else { inQuotes = false; }
        } else { cur += ch; }
      } else if (ch === '"' && cur === '') { inQuotes = true; }
      else if (ch === ',') { row.push(cur); cur = ''; }
      else if (ch === '\\n' || ch === '\\r') {
        if (ch === '\\r' && text.charAt(i + 1) === '\\n') { i += 1; }
        row.push(cur); cur = '';
        if (row.length > 1 || trimStr(row[0]) !== '') { rows.push(row); }
        row = [];
      } else { cur += ch; }
    }
    row.push(cur);
    if (row.length > 1 || trimStr(row[0]) !== '') { rows.push(row); }
    return rows;
  }
  var vmCsvRows = null;
  function vmShowCsvMapping(rows) {
    if (!vmModal || rows.length < 2) {
      if (window.showToast) { window.showToast('CSV needs a header row + at least one data row', 'error'); }
      return;
    }
    vmCsvRows = rows;
    var box = vmModal.querySelector('[data-vm-csv-map]');
    if (!box) { return; }
    box.hidden = false;
    var headers = rows[0];
    var sels = box.querySelectorAll('[data-vm-csv-col]');
    var i, j, sel3, opt;
    for (i = 0; i < sels.length; i++) {
      sel3 = sels[i];
      clearChildren(sel3);
      if (sel3.getAttribute('data-vm-csv-col') === 'main') {
        opt = el('option', null, '(none)');
        opt.value = '';
        sel3.appendChild(opt);
      }
      for (j = 0; j < headers.length; j++) {
        opt = el('option', null, headers[j]);
        opt.value = String(j);
        sel3.appendChild(opt);
      }
      if (sel3.getAttribute('data-vm-csv-col') === 'output' && headers.length > 1) { sel3.value = '1'; }
    }
  }

  if (vmModal) {
    vmModal.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) { return; }
      if (e.target === vmModal || t.closest('[data-vm-cancel]')) { closeValueMapModal(); return; }
      if (t.closest('[data-vm-add]')) {
        vmState.rows.push({ internal: '', output: '', main: false });
        vmRenderRows();
        return;
      }
      if (t.closest('[data-vm-add-many]') || t.closest('[data-vm-bulk]')) {
        var wrap = vmModal.querySelector('[data-vm-add-many-wrap]');
        if (wrap) { wrap.hidden = !wrap.hidden; }
        return;
      }
      if (t.closest('[data-vm-add-many-apply]')) {
        var ta = vmModal.querySelector('[data-vm-add-many-text]');
        var lines = String(ta ? ta.value : '').split('\\n');
        var n = 0;
        var i, line, eq;
        for (i = 0; i < lines.length; i++) {
          line = trimStr(lines[i]);
          if (line === '') { continue; }
          eq = line.indexOf('=');
          if (eq === -1) { vmState.rows.push({ internal: line, output: line, main: false }); }
          else { vmState.rows.push({ internal: trimStr(line.slice(0, eq)), output: trimStr(line.slice(eq + 1)), main: false }); }
          n += 1;
        }
        if (ta) { ta.value = ''; }
        var wrap2 = vmModal.querySelector('[data-vm-add-many-wrap]');
        if (wrap2) { wrap2.hidden = true; }
        if (window.showToast && n > 0) { window.showToast(n + ' rows added', 'success'); }
        vmRenderRows();
        return;
      }
      if (t.closest('[data-vm-csv-apply]')) {
        if (!vmCsvRows) { return; }
        var colOf = {};
        var sels = vmModal.querySelectorAll('[data-vm-csv-col]');
        for (i = 0; i < sels.length; i++) { colOf[sels[i].getAttribute('data-vm-csv-col')] = sels[i].value; }
        var added = 0;
        var r2;
        for (i = 1; i < vmCsvRows.length; i++) {
          r2 = vmCsvRows[i];
          var internalV = trimStr(r2[Number(colOf.internal)] || '');
          if (internalV === '') { continue; }
          var outputV = colOf.output === '' ? internalV : trimStr(r2[Number(colOf.output)] || '');
          var mainV = colOf.main !== '' && /^(1|true|yes|y|main)$/i.test(trimStr(r2[Number(colOf.main)] || ''));
          vmState.rows.push({ internal: internalV, output: outputV, main: mainV });
          added += 1;
        }
        vmCsvRows = null;
        var mapBox = vmModal.querySelector('[data-vm-csv-map]');
        if (mapBox) { mapBox.hidden = true; }
        if (window.showToast) { window.showToast(added + ' rows imported from CSV', 'success'); }
        vmRenderRows();
        return;
      }
      var th = t.closest('[data-vm-sort]');
      if (th) {
        var key = th.getAttribute('data-vm-col');
        if (vmState.sortKey === key) { vmState.sortDir = -vmState.sortDir; } else { vmState.sortKey = key; vmState.sortDir = 1; }
        var dir = vmState.sortDir;
        var internalField = trimStr(vmState.item.node.internal_field);
        vmState.rows.sort(function (a, b) {
          var av, bv;
          if (key === 'main') { av = a.main ? 0 : 1; bv = b.main ? 0 : 1; }
          else if (key === 'output') { av = displayScalar(a.output); bv = displayScalar(b.output); }
          else if (key === 'output_type') { av = typeof a.output; bv = typeof b.output; }
          else if (key === 'display_label') {
            av = choiceLabelFor(internalField, a.internal) || '';
            bv = choiceLabelFor(internalField, b.internal) || '';
          }
          else { av = a.internal; bv = b.internal; }
          if (av < bv) { return -dir; }
          if (av > bv) { return dir; }
          return 0;
        });
        vmRenderRows();
        return;
      }
      var rowAct = t.closest('[data-vm-row-act]');
      if (rowAct) {
        var tr = rowAct.closest('tr');
        var idx = Number(tr.getAttribute('data-vm-row'));
        var kind2 = rowAct.getAttribute('data-vm-row-act');
        if (kind2 === 'main') { vmState.rows[idx].main = true; }
        else if (kind2 === 'other') { vmState.rows[idx].main = false; }
        else if (kind2 === 'dup') { vmState.rows.splice(idx + 1, 0, deepClone(vmState.rows[idx])); }
        else if (kind2 === 'del') { vmState.rows.splice(idx, 1); }
        vmRenderRows();
        return;
      }
      if (t.closest('[data-vm-apply]')) {
        var node = vmState.item.node;
        var map = {};
        var mains2 = [];
        var skippedForbidden = 0;
        for (i = 0; i < vmState.rows.length; i++) {
          r2 = vmState.rows[i];
          var internalKey = trimStr(r2.internal);
          if (internalKey === '') { continue; }
          // nano-7: a reserved-name internal key (proto/constructor/prototype)
          // would be a silent no-op on a plain-object map (the row would just
          // vanish); skip it EXPLICITLY and tell the operator, not swallow it.
          if (FORBIDDEN_SEGMENTS.indexOf(internalKey) !== -1) { skippedForbidden += 1; continue; }
          map[internalKey] = r2.output;
          if (r2.main) { mains2.push(internalKey); }
        }
        if (skippedForbidden > 0 && window.showToast) {
          window.showToast(skippedForbidden + ' reserved-name row(s) skipped (__proto__/constructor/prototype are not valid values)', 'warning');
        }
        node.value_map = map;
        var cd = isRecordVal(node.choiceDisplay) ? node.choiceDisplay : {};
        if (mains2.length > 0) { cd.mainValues = mains2; } else { delete cd.mainValues; }
        var anyCd = false;
        var ck2;
        for (ck2 in cd) { if (hasOwn(cd, ck2)) { anyCd = true; } }
        if (anyCd) { node.choiceDisplay = cd; } else { delete node.choiceDisplay; }
        refreshAdvReasons(vmState.item);
        closeValueMapModal();
        renderEditor();
        afterModelChange();
        if (window.showToast) { window.showToast('Value map applied', 'success'); }
        return;
      }
    });
    vmModal.addEventListener('change', function (e) {
      var t = e.target;
      if (!t || !t.closest) { return; }
      var tr = t.closest('tr[data-vm-row]');
      if (tr) { vmSyncRowFromInputs(tr); vmRenderRows(); }
      var csvIn = t.closest('[data-vm-csv]');
      if (csvIn && csvIn.files && csvIn.files.length > 0) {
        var reader = new FileReader();
        reader.onload = function () { vmShowCsvMapping(parseCsv(String(reader.result || ''))); };
        reader.readAsText(csvIn.files[0]);
        csvIn.value = '';
      }
    });
    vmModal.addEventListener('input', function (e) {
      var t = e.target;
      if (t && t.getAttribute && t.getAttribute('data-vm-search') !== null) {
        vmState.filter = trimStr(t.value);
        vmRenderRows();
      }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && vmState !== null) { closeValueMapModal(); }
    });
  }

  // --- save / copy / schema-level Advanced (raw + from-example) ------------------------
  function renderServerOutcome(body) {
    serverErrors = (body && body.schema_errors) || [];
    serverWarnings = [];
    var i;
    for (i = 0; i < ((body && body.warnings) || []).length; i++) { serverWarnings.push(body.warnings[i]); }
    refreshValidation();
    renderTree();
  }
  var saveBtn = document.getElementById('lg-schema-save');
  if (saveBtn && builderActive) {
    saveBtn.addEventListener('click', function () {
      serverErrors = [];
      var split = refreshValidation();
      if (split.blocking.length > 0) {
        if (window.showToast) { window.showToast('Save is blocked \\u2014 fix the ' + split.blocking.length + ' schema issue' + (split.blocking.length === 1 ? '' : 's') + ' first', 'error'); }
        return;
      }
      saveBtn.disabled = true;
      saveBtn.classList.add('lg-saving');
      getJson('POST', apiBase + '/payload-schemas', { schema_json: buildSchemaJson() }).then(function (res) {
        saveBtn.disabled = false;
        saveBtn.classList.remove('lg-saving');
        if (res.ok && res.body && res.body.version) {
          activeVersion = res.body.version;
          if (metaEl) { metaEl.textContent = 'Active schema: v' + res.body.version + ' (' + (res.body.source || 'manual') + ')'; }
          renderServerOutcome(res.body);
          sampleFieldsCache = null; // regenerate the Test form off the new version
          if (window.showToast) { window.showToast('Payload schema v' + res.body.version + ' saved', 'success'); }
          refreshPreview();
          return;
        }
        renderServerOutcome(res.body);
        if (serverErrors.length === 0 && res.body && res.body.error) {
          serverErrors = [{ code: 'save_failed', path: '', message: res.body.error }];
          refreshValidation();
        }
        if (window.showToast) { window.showToast('Schema not saved \\u2014 fix validation errors', 'error'); }
      }).catch(function () {
        saveBtn.disabled = false;
        saveBtn.classList.remove('lg-saving');
        serverErrors = [{ code: 'network_error', path: '', message: 'Network error \\u2014 the schema was not saved.' }];
        refreshValidation();
      });
    });
  }
  var copyBtn = document.getElementById('lg-schema-copy');
  if (copyBtn && builderActive) {
    copyBtn.addEventListener('click', function () {
      copyText(JSON.stringify(buildSchemaJson(), null, 2), 'Schema JSON copied');
    });
  }
  var schemaAdvanced = document.getElementById('lg-schema-advanced');
  var rawTa = document.getElementById('lg-schema-raw');
  if (schemaAdvanced && rawTa) {
    schemaAdvanced.addEventListener('toggle', function () {
      if (schemaAdvanced.open) { rawTa.value = JSON.stringify(buildSchemaJson(), null, 2); }
    });
  }
  var rawApply = document.getElementById('lg-schema-raw-apply');
  if (rawApply && builderActive) {
    rawApply.addEventListener('click', function () {
      var errEl = document.getElementById('lg-schema-raw-error');
      if (errEl) { errEl.hidden = true; errEl.textContent = ''; }
      var parsed = null;
      try { parsed = JSON.parse(rawTa ? rawTa.value : ''); } catch (e) { parsed = null; }
      if (!parsed || !parsed.root || Object.prototype.toString.call(parsed.root.children) !== '[object Array]') {
        if (errEl) { errEl.hidden = false; errEl.textContent = 'Raw JSON must be a schema object with root.children[].'; }
        return;
      }
      loadItemsFromChildren(parsed.root.children, typeof parsed.version === 'number' ? parsed.version : activeVersion);
      selectedRef = null;
      serverErrors = [];
      renderAll();
      if (window.showToast) { window.showToast('Raw JSON applied to the tree', 'success'); }
    });
  }
  var exampleBtn = document.getElementById('lg-example-generate');
  if (exampleBtn && builderActive) {
    exampleBtn.addEventListener('click', function () {
      var input = document.getElementById('lg-example-input');
      var errEl = document.getElementById('lg-example-error');
      var raw = input ? input.value : '';
      if (errEl) { errEl.hidden = true; errEl.textContent = ''; }
      if (trimStr(raw) === '') {
        if (errEl) { errEl.hidden = false; errEl.textContent = 'Paste an example payload first.'; }
        return;
      }
      exampleBtn.disabled = true;
      getJson('POST', apiBase + '/payload-schemas/from-example', { example: raw }).then(function (res) {
        exampleBtn.disabled = false;
        if (res.ok && res.body && res.body.schema_json) {
          activeVersion = res.body.version || activeVersion;
          loadItemsFromChildren(res.body.schema_json.root.children, activeVersion);
          selectedRef = null;
          serverErrors = [];
          renderAll();
          if (metaEl) { metaEl.textContent = 'Active schema: v' + res.body.version + ' (auto_from_example)'; }
          if (window.showToast) { window.showToast('Schema generated from example', 'success'); }
          return;
        }
        var msg = (res.body && res.body.fields && res.body.fields.example) || (res.body && res.body.error) || 'Failed to generate schema';
        if (errEl) { errEl.hidden = false; errEl.textContent = msg; }
      }).catch(function () {
        exampleBtn.disabled = false;
        if (errEl) { errEl.hidden = false; errEl.textContent = 'Network error \\u2014 nothing was generated.'; }
      });
    });
  }

  // --- shared result renderers (dry run + §11.6 runner) ---------------------------------
  function renderNotes(boxId, notes) {
    var box = document.getElementById(boxId);
    if (!box) { return; }
    clearChildren(box);
    var i;
    for (i = 0; i < (notes || []).length; i++) {
      textP(box, 'alert alert-warning', '[' + notes[i].scope + '/' + notes[i].code + '] ' + (notes[i].message || ''));
    }
  }
  function renderPre(id, value) {
    var n = document.getElementById(id);
    if (!n) { return; }
    n.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  }

  // --- §11.1 dry run (Advanced drawer in the Payload tab; raw JSON answers) -------------
  var dryrunBtn = document.getElementById('lg-dryrun-run');
  if (dryrunBtn) {
    dryrunBtn.addEventListener('click', function () {
      var answersEl = document.getElementById('lg-dryrun-answers');
      var answersErr = document.getElementById('lg-dryrun-answers-error');
      var topErr = document.getElementById('lg-dryrun-error');
      var results = document.getElementById('lg-dryrun-results');
      if (answersErr) { answersErr.hidden = true; answersErr.textContent = ''; }
      if (topErr) { topErr.hidden = true; topErr.textContent = ''; }
      if (results) { results.hidden = true; }
      var answers = {};
      var raw = answersEl ? String(answersEl.value || '') : '';
      if (trimStr(raw) !== '') {
        try { answers = JSON.parse(raw); } catch (e) { answers = null; }
        if (answers === null || typeof answers !== 'object' || Object.prototype.toString.call(answers) === '[object Array]') {
          if (answersErr) { answersErr.hidden = false; answersErr.textContent = 'Sample answers must be a JSON object.'; }
          return;
        }
      }
      var envSel = document.getElementById('lg-test-environment');
      dryrunBtn.disabled = true;
      dryrunBtn.classList.add('lg-saving');
      getJson('POST', apiBase + '/test', {
        environment: envSel ? envSel.value : 'staging',
        sample_answers: answers,
        dry_run: true
      }).then(function (res) {
        dryrunBtn.disabled = false;
        dryrunBtn.classList.remove('lg-saving');
        if (!res.ok || !res.body) {
          var msg = 'Dry run failed (HTTP ' + res.status + ')';
          if (res.body && res.body.fields) {
            var k, parts = [];
            for (k in res.body.fields) {
              if (hasOwn(res.body.fields, k)) { parts.push(k + ': ' + res.body.fields[k]); }
            }
            if (parts.length > 0) { msg = parts.join(' \\u00b7 '); }
          } else if (res.body && res.body.error) { msg = res.body.error; }
          if (topErr) { topErr.hidden = false; topErr.textContent = msg; }
          return;
        }
        if (results) { results.hidden = false; }
        renderPre('lg-dryrun-payload', res.body.request ? res.body.request.payload : null);
        renderPre('lg-dryrun-headers', res.body.request ? res.body.request.headers : null);
        renderNotes('lg-dryrun-notes', res.body.notes || []);
      }).catch(function () {
        dryrunBtn.disabled = false;
        dryrunBtn.classList.remove('lg-saving');
        if (topErr) { topErr.hidden = false; topErr.textContent = 'Network error \\u2014 the dry run did not run.'; }
      });
    });
  }

  // --- request tab: header rows + client-mode warning -------------------------------------
  var headersRows = document.getElementById('lg-headers-rows');
  var headerAdd = document.getElementById('lg-header-add');
  if (headerAdd && headersRows) {
    headerAdd.addEventListener('click', function () {
      var tpl = document.getElementById('lg-header-template');
      if (tpl && tpl.content) { headersRows.appendChild(document.importNode(tpl.content, true)); }
    });
  }
  if (headersRows) {
    headersRows.addEventListener('click', function (e) {
      var t = e.target;
      var btn = t && t.closest ? t.closest('[data-header-remove]') : null;
      if (btn) {
        var row = btn.closest('.lg-header-row');
        if (row && row.parentNode) { row.parentNode.removeChild(row); }
      }
    });
  }
  var editorForm = document.getElementById('lg-editor-form');
  if (editorForm) {
    editorForm.addEventListener('change', function (e) {
      var t = e.target;
      if (t && t.name === 'request_execution_mode') {
        var warning = document.getElementById('lg-client-mode-warning');
        if (warning) { warning.hidden = t.value !== 'client'; }
      }
    });
  }

  // --- §6.12 Test tab: generated sample-answer form ----------------------------------------
  var testForm = document.getElementById('lg-test-form');
  var testFormStatus = document.getElementById('lg-test-form-status');
  var testFields = [];

  function testFormRow(field) {
    var row = el('div', 'lg-test-form-row');
    row.setAttribute('data-test-field', field.internal_field);
    row.setAttribute('data-test-kind', field.kind);
    var lbl = el('label', 'form-label', field.label + (field.required ? ' *' : ''));
    row.appendChild(lbl);
    var i, input;
    if (field.kind === 'enum') {
      input = document.createElement('select');
      input.className = 'form-select';
      input.setAttribute('data-test-input', '');
      input.setAttribute('aria-label', field.label);
      var opts = field.options || [];
      for (i = 0; i < opts.length; i++) {
        var o = el('option', null, opts[i].label);
        o.value = String(opts[i].value);
        if (String(opts[i].value) === String(field.sample)) { o.selected = true; }
        input.appendChild(o);
      }
      row.appendChild(input);
    } else if (field.kind === 'boolean') {
      var pair = el('span', 'lg-test-bool');
      pair.setAttribute('data-test-input', '');
      var yes = el('label', null, null);
      var yesIn = document.createElement('input');
      yesIn.type = 'radio';
      yesIn.name = 'lg-tf-' + field.internal_field;
      yesIn.value = 'true';
      yesIn.checked = field.sample === true || field.sample === 'true';
      yes.insertBefore(yesIn, null);
      yes.appendChild(document.createTextNode(' Yes'));
      var no = el('label', null, null);
      var noIn = document.createElement('input');
      noIn.type = 'radio';
      noIn.name = 'lg-tf-' + field.internal_field;
      noIn.value = 'false';
      noIn.checked = !yesIn.checked;
      no.insertBefore(noIn, null);
      no.appendChild(document.createTextNode(' No'));
      pair.appendChild(yes);
      pair.appendChild(no);
      row.appendChild(pair);
    } else {
      input = document.createElement('input');
      input.className = 'form-input';
      input.setAttribute('data-test-input', '');
      input.setAttribute('aria-label', field.label);
      if (field.kind === 'date') { input.type = 'date'; }
      else if (field.kind === 'number') { input.type = 'number'; }
      else { input.type = 'text'; }
      input.value = field.sample === undefined || field.sample === null ? '' : String(field.sample);
      if (field.kind === 'text') { input.placeholder = input.value; }
      if (field.kind === 'zip') { input.maxLength = 10; }
      row.appendChild(input);
    }
    var hint = el('span', 'form-help', '\\u2192 ' + field.source_path);
    row.appendChild(hint);
    return row;
  }
  function renderTestForm(fields) {
    if (!testForm) { return; }
    clearChildren(testForm);
    testFields = fields || [];
    var i;
    for (i = 0; i < testFields.length; i++) { testForm.appendChild(testFormRow(testFields[i])); }
    if (testFormStatus) {
      testFormStatus.textContent = testFields.length === 0
        ? 'No answer fields in the active schema \\u2014 save a schema with User-answer fields to generate the form.'
        : '';
      testFormStatus.hidden = testFields.length > 0;
    }
  }
  function loadTestForm() {
    if (!testForm) { return; }
    if (testFormStatus) { testFormStatus.hidden = false; testFormStatus.textContent = 'Loading the answer form\\u2026'; }
    getJson('POST', apiBase + '/payload/sample-answers', {}).then(function (res) {
      if (res.ok && res.body && res.body.fields) {
        sampleFieldsCache = res.body;
        renderTestForm(res.body.fields);
        return;
      }
      if (testFormStatus) {
        testFormStatus.hidden = false;
        testFormStatus.textContent = res.status === 404
          ? 'No active payload schema yet \\u2014 save one in the Payload tab first.'
          : ((res.body && res.body.error) || 'Could not generate the sample-answer form.');
      }
      if (res.body && res.body.schema_errors) { renderTestIssues(res.body.schema_errors); }
    }).catch(function () {
      if (testFormStatus) { testFormStatus.hidden = false; testFormStatus.textContent = 'Network error \\u2014 the form did not load.'; }
    });
  }
  function collectFormAnswers() {
    var out = {};
    if (!testForm) { return out; }
    var rows = testForm.querySelectorAll('[data-test-field]');
    var i, row, field, kind, input, raw;
    for (i = 0; i < rows.length; i++) {
      row = rows[i];
      field = row.getAttribute('data-test-field');
      kind = row.getAttribute('data-test-kind');
      if (kind === 'boolean') {
        input = row.querySelector('input[type="radio"]:checked');
        out[field] = input ? input.value === 'true' : false;
        continue;
      }
      input = row.querySelector('[data-test-input]');
      if (!input) { continue; }
      raw = input.value;
      if (trimStr(raw) === '') { continue; }
      if (kind === 'number') { out[field] = Number(raw); }
      else { out[field] = raw; }
    }
    return out;
  }
  var regenBtn = document.getElementById('lg-test-regenerate');
  if (regenBtn) {
    regenBtn.addEventListener('click', function () {
      // Regenerate = clear the persisted draft, then re-POST for a FRESH
      // generation (the POST merges any draft over the samples).
      regenBtn.disabled = true;
      getJson('PUT', apiBase + '/payload/sample-answers', { answers: {} }).then(function () {
        regenBtn.disabled = false;
        loadTestForm();
      }).catch(function () {
        regenBtn.disabled = false;
        loadTestForm();
      });
    });
  }
  var draftBtn = document.getElementById('lg-test-save-draft');
  var draftStatus = document.getElementById('lg-test-draft-status');
  function saveDraft(cb) {
    getJson('PUT', apiBase + '/payload/sample-answers', { answers: collectFormAnswers() }).then(function (res) {
      if (draftStatus) { draftStatus.textContent = res.ok ? 'Draft saved.' : 'Draft not saved.'; }
      if (cb) { cb(); }
    }).catch(function () {
      if (draftStatus) { draftStatus.textContent = 'Draft not saved (network).'; }
      if (cb) { cb(); }
    });
  }
  if (draftBtn) { draftBtn.addEventListener('click', function () { saveDraft(null); }); }

  // Advanced raw-JSON answers editor round-trips with the form (§6.12.7).
  var advTa = document.getElementById('lg-test-answers');
  var formToJson = document.getElementById('lg-test-form-to-json');
  var jsonToForm = document.getElementById('lg-test-json-to-form');
  if (formToJson && advTa) {
    formToJson.addEventListener('click', function () {
      advTa.value = JSON.stringify(collectFormAnswers(), null, 2);
    });
  }
  if (jsonToForm && advTa) {
    jsonToForm.addEventListener('click', function () {
      var errEl = document.getElementById('lg-test-answers-error');
      if (errEl) { errEl.hidden = true; errEl.textContent = ''; }
      var parsed = null;
      try { parsed = JSON.parse(advTa.value); } catch (e) { parsed = null; }
      if (!isRecordVal(parsed)) {
        if (errEl) { errEl.hidden = false; errEl.textContent = 'Sample answers must be a JSON object.'; }
        return;
      }
      var rows = testForm ? testForm.querySelectorAll('[data-test-field]') : [];
      var i, row, field, kind, input, radios, j;
      for (i = 0; i < rows.length; i++) {
        row = rows[i];
        field = row.getAttribute('data-test-field');
        if (!hasOwn(parsed, field)) { continue; }
        kind = row.getAttribute('data-test-kind');
        if (kind === 'boolean') {
          radios = row.querySelectorAll('input[type="radio"]');
          for (j = 0; j < radios.length; j++) {
            radios[j].checked = radios[j].value === (parsed[field] === true ? 'true' : 'false');
          }
        } else {
          input = row.querySelector('[data-test-input]');
          if (input) { input.value = parsed[field] === null || parsed[field] === undefined ? '' : String(parsed[field]); }
        }
      }
    });
  }

  // --- §6.12 run: validity gate + placement + environment confirm + context_used ------------
  var testErrBox = document.getElementById('lg-test-schema-errors');
  function renderTestIssues(entries) {
    if (!testErrBox) { return; }
    testErrBox.hidden = (entries || []).length === 0;
    clearChildren(testErrBox);
    if ((entries || []).length === 0) { return; }
    textP(testErrBox, 'form-error', 'Schema has ' + entries.length + ' issue' + (entries.length === 1 ? '' : 's') + ' \\u2014 fix them in the Payload tab before testing.');
    var i;
    for (i = 0; i < entries.length; i++) {
      testErrBox.appendChild(issueRow(entries[i], jumpToIssue));
    }
  }
  function renderContextUsed(ctx, environment) {
    var box = document.getElementById('lg-test-context-used');
    if (!box) { return; }
    clearChildren(box);
    if (!ctx) { textP(box, 'form-help', 'No context echo returned.'); return; }
    var line = 'environment: ' + environment;
    if (ctx.placement_id !== null && ctx.placement_id !== undefined) {
      line += ' \\u00b7 placement: ' + ctx.placement_id + (ctx.placement_public_id ? ' (' + ctx.placement_public_id + ')' : '');
    }
    textP(box, 'form-help', line);
    function kvBlock(title, rec) {
      if (!rec) { return; }
      var keys = [];
      var k;
      for (k in rec) { if (hasOwn(rec, k)) { keys.push(k); } }
      if (keys.length === 0) { return; }
      keys.sort();
      var parts = [];
      var i2;
      for (i2 = 0; i2 < keys.length; i2++) {
        parts.push(keys[i2] + '=' + (rec[keys[i2]] === '' ? '\\u2205' : String(rec[keys[i2]])));
      }
      textP(box, 'form-help', title + ': ' + parts.join(' \\u00b7 '));
    }
    kvBlock('macros (redacted)', ctx.macros);
    kvBlock('computed', ctx.computed);
  }
  function setTestChip(status, tsText) {
    var chip = document.getElementById('lg-pb-test-chip');
    if (!chip) { return; }
    chip.setAttribute('data-test-status', status);
    var btn = chip.querySelector('[data-pb-open-test]');
    clearChildren(chip);
    chip.appendChild(document.createTextNode('Test: ' + status + (tsText ? ' at ' + tsText : '') + ' '));
    if (btn) { chip.appendChild(btn); }
  }
  function collectContextOverrides() {
    var out = {};
    var any = false;
    var inputs = document.querySelectorAll('[data-test-ctx]');
    var i, v;
    for (i = 0; i < inputs.length; i++) {
      v = trimStr(inputs[i].value);
      if (v !== '') { out[inputs[i].getAttribute('data-test-ctx')] = v; any = true; }
    }
    return any ? out : null;
  }

  var runBtn = document.getElementById('lg-test-run');

  function renderParseErrors(errors) {
    var box = document.getElementById('lg-test-parse-errors');
    if (!box) { return; }
    clearChildren(box);
    if (!errors || errors.length === 0) {
      textP(box, 'form-help', 'No parse errors.');
      return;
    }
    var i;
    for (i = 0; i < errors.length; i++) {
      textP(box, 'form-error', JSON.stringify(errors[i]));
    }
  }

  var CARRIER_COLUMNS = ['carrier_key', 'carrier_name', 'bid', 'bid_currency', 'click_url', 'pricing_model'];

  function renderCarriers(carriers) {
    var box = document.getElementById('lg-test-carriers');
    if (!box) { return; }
    clearChildren(box);
    if (!carriers || carriers.length === 0) {
      textP(box, 'form-help', 'No carriers extracted.');
      return;
    }
    var table = document.createElement('table');
    table.className = 'lg-carriers-table';
    var thead = document.createElement('thead');
    var headRow = document.createElement('tr');
    var i, j, th, tr, td, v;
    for (i = 0; i < CARRIER_COLUMNS.length; i++) {
      th = document.createElement('th');
      th.appendChild(document.createTextNode(CARRIER_COLUMNS[i]));
      headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);
    var tbody = document.createElement('tbody');
    for (i = 0; i < carriers.length; i++) {
      tr = document.createElement('tr');
      for (j = 0; j < CARRIER_COLUMNS.length; j++) {
        td = document.createElement('td');
        v = carriers[i] ? carriers[i][CARRIER_COLUMNS[j]] : undefined;
        td.appendChild(document.createTextNode(v === undefined || v === null ? '\\u2014' : String(v)));
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    box.appendChild(table);
  }

  // §10.5: chips for every discovered response field; flag REQUIRED
  // {response:path} macros in the banner template with no source among them.
  function renderChips(paths) {
    var box = document.getElementById('lg-test-chips');
    var flags = document.getElementById('lg-test-macro-flags');
    if (!box) { return; }
    clearChildren(box);
    if (flags) { clearChildren(flags); }
    var i, chip;
    if (!paths || paths.length === 0) {
      textP(box, 'form-help', 'No response fields discovered (non-JSON or empty response).');
    } else {
      for (i = 0; i < paths.length; i++) {
        chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'macro-chip';
        chip.setAttribute('data-response-macro', paths[i]);
        chip.appendChild(document.createTextNode('{response:' + paths[i] + '}'));
        box.appendChild(chip);
      }
    }
    var bannerInput = document.querySelector('[name="banner_url_template"]');
    var template = bannerInput ? String(bannerInput.value || '') : '';
    var required = [];
    template.replace(/\\{response:([A-Za-z0-9_.]+)(\\??)\\}/g, function (all, p1, p2) {
      if (p2 !== '?' && required.indexOf(p1) === -1) { required.push(p1); }
      return all;
    });
    var have = {};
    for (i = 0; i < (paths || []).length; i++) { have[paths[i]] = 1; }
    for (i = 0; i < required.length; i++) {
      if (!have[required[i]] && flags) {
        textP(flags, 'form-error', 'Required response macro {response:' + required[i] + '} has no source in the last test response (\\u00a710.5) \\u2014 the carrier would be dropped at runtime.');
      }
    }
  }

  var chipsBox = document.getElementById('lg-test-chips');
  if (chipsBox) {
    chipsBox.addEventListener('click', function (e) {
      var chip = e.target && e.target.closest ? e.target.closest('[data-response-macro]') : null;
      if (!chip) { return; }
      var token = '{response:' + chip.getAttribute('data-response-macro') + '}';
      copyText(token, 'Copied ' + token);
    });
  }

  if (runBtn) {
    runBtn.addEventListener('click', function () {
      var envSel = document.getElementById('lg-test-environment');
      var topErr = document.getElementById('lg-test-error');
      var results = document.getElementById('lg-test-results');
      if (topErr) { topErr.hidden = true; topErr.textContent = ''; }
      renderTestIssues([]);
      // §6.12.5 pre-test validity gate (client mirror; the server 400 is the truth)
      if (builderActive) {
        var split = splitBlocking(allIssues());
        if (split.blocking.length > 0) {
          renderTestIssues(split.blocking);
          return;
        }
      }
      var environment = envSel ? envSel.value : 'staging';
      if (environment === 'production' && !window.confirm('Run this test against the PRODUCTION endpoint?')) { return; }
      // answers: the generated form is the source of truth; an OPEN Advanced
      // drawer with JSON text wins (round-trip contract, §6.12.7).
      var answers = collectFormAnswers();
      var advDrawer = document.getElementById('lg-test-advanced');
      if (advDrawer && advDrawer.open && advTa && trimStr(advTa.value) !== '') {
        var parsed = null;
        try { parsed = JSON.parse(advTa.value); } catch (e) { parsed = null; }
        var answersErr = document.getElementById('lg-test-answers-error');
        if (!isRecordVal(parsed)) {
          if (answersErr) { answersErr.hidden = false; answersErr.textContent = 'Sample answers must be a JSON object.'; }
          return;
        }
        if (answersErr) { answersErr.hidden = true; answersErr.textContent = ''; }
        answers = parsed;
      }
      var body = { environment: environment, sample_answers: answers };
      var overrides = collectContextOverrides();
      if (overrides !== null) { body.overrides = overrides; }
      var placementSel = document.getElementById('lg-test-placement');
      var placementWrap = document.getElementById('lg-test-placement-wrap');
      if (placementSel && placementWrap && !placementWrap.hidden && placementSel.value !== '') {
        body.offer_placement_id = placementSel.value;
      }
      runBtn.disabled = true;
      runBtn.classList.add('lg-saving');
      saveDraft(function () {
        getJson('POST', apiBase + '/test', body).then(function (res) {
          runBtn.disabled = false;
          runBtn.classList.remove('lg-saving');
          if (!res.ok || !res.body) {
            if (res.body && res.body.schema_errors) {
              renderTestIssues(res.body.schema_errors);
              serverErrors = res.body.schema_errors;
              refreshValidation();
              return;
            }
            var msg = 'Test failed (HTTP ' + res.status + ')';
            if (res.body && res.body.fields) {
              var k, parts = [];
              for (k in res.body.fields) {
                if (hasOwn(res.body.fields, k)) { parts.push(k + ': ' + res.body.fields[k]); }
              }
              if (parts.length > 0) { msg = parts.join(' \\u00b7 '); }
            } else if (res.body && res.body.error) { msg = res.body.error; }
            if (topErr) { topErr.hidden = false; topErr.textContent = msg; }
            return;
          }
          var resBody = res.body;
          if (results) { results.hidden = false; }
          var statusLine = document.getElementById('lg-test-status-line');
          if (statusLine) {
            statusLine.textContent =
              (resBody.method || '') + ' ' + (resBody.endpoint || '') +
              ' \\u2192 status ' + (resBody.response && resBody.response.status !== null ? resBody.response.status : 'n/a') +
              ' \\u00b7 ' + (resBody.response ? resBody.response.latency_ms : '?') + ' ms' +
              (resBody.provider_error_reason ? ' \\u00b7 ' + resBody.provider_error_reason : '');
          }
          renderNotes('lg-test-notes', resBody.notes || []);
          renderContextUsed(resBody.context_used, resBody.environment || environment);
          renderPre('lg-test-request-payload', resBody.request ? resBody.request.payload : null);
          renderPre('lg-test-request-headers', resBody.request ? resBody.request.headers : null);
          renderPre('lg-test-response-body', resBody.response ? resBody.response.body : null);
          renderParseErrors(resBody.parse ? resBody.parse.errors : []);
          renderCarriers(resBody.parse ? resBody.parse.carriers : []);
          renderChips(resBody.response_field_paths || []);
          var ok = resBody.response && resBody.response.status !== null && resBody.response.status >= 200 && resBody.response.status < 300;
          var now = new Date();
          function pad2(n) { return (n < 10 ? '0' : '') + n; }
          setTestChip(ok ? 'passed' : 'failed', pad2(now.getHours()) + ':' + pad2(now.getMinutes()));
        }).catch(function () {
          runBtn.disabled = false;
          runBtn.classList.remove('lg-saving');
          if (topErr) { topErr.hidden = false; topErr.textContent = 'Network error \\u2014 the test did not run.'; }
        });
      });
    });
  }

  // --- §11.6/§11.7 response-parser authoring ------------------------------------------------
  // Save = the SAME §11.8 versioning path as the schema Save button (the
  // parser is a column on the schema-version row): the builder tree +
  // carrier_parse_json ride one POST that creates the next active version.
  var parseRowsBox = document.getElementById('lg-parse-rows');
  var parseErrorsBox = document.getElementById('lg-parse-errors');
  var lastParseInput = null;
  if (parseRowsBox) {
    parseRowsBox.addEventListener('focusin', function (e) {
      var t = e.target;
      if (t && t.hasAttribute && t.hasAttribute('data-parse-input')) { lastParseInput = t; }
    });
  }
  var parseChips = document.getElementById('lg-parse-chips');
  if (parseChips) {
    parseChips.addEventListener('click', function (e) {
      var chip = e.target && e.target.closest ? e.target.closest('[data-parse-chip]') : null;
      if (!chip) { return; }
      var path = chip.getAttribute('data-parse-chip') || '';
      if (lastParseInput) {
        var current = trimStr(lastParseInput.value);
        lastParseInput.value = current === '' ? path : current + ', ' + path;
        lastParseInput.focus();
      } else {
        copyText(path, 'Copied ' + path);
      }
    });
  }
  function renderParserSaveErrors(entries) {
    if (!parseErrorsBox) { return; }
    clearChildren(parseErrorsBox);
    var i, e, label;
    for (i = 0; i < (entries || []).length; i++) {
      e = entries[i];
      label = (e.code ? '[' + e.code + '] ' : '') + (e.path ? e.path + ': ' : '') + (e.message || '');
      textP(parseErrorsBox, 'form-error', label);
    }
  }
  // { carriers_path?, fields } — a comma-separated row becomes the §11.7
  // first-wins fallback array; a single path stays a string.
  function buildParseConfig() {
    var fields = {};
    var mapped = 0;
    var rowEls = parseRowsBox ? parseRowsBox.querySelectorAll('.lg-parse-row') : [];
    var i, j, key, input, parts, list, piece;
    for (i = 0; i < rowEls.length; i++) {
      key = rowEls[i].getAttribute('data-parse-field');
      input = rowEls[i].querySelector('[data-parse-input]');
      parts = String(input ? input.value : '').split(',');
      list = [];
      for (j = 0; j < parts.length; j++) {
        piece = trimStr(parts[j]);
        if (piece !== '') { list.push(piece); }
      }
      if (list.length === 1) { fields[key] = list[0]; mapped++; }
      else if (list.length > 1) { fields[key] = list; mapped++; }
    }
    var cpEl = document.getElementById('lg-parse-carriers-path');
    var carriersPath = cpEl ? trimStr(cpEl.value) : '';
    var config = { fields: fields };
    if (carriersPath !== '') { config.carriers_path = carriersPath; }
    return { config: config, mapped: mapped };
  }
  var parseSave = document.getElementById('lg-parse-save');
  if (parseSave) {
    parseSave.addEventListener('click', function () {
      renderParserSaveErrors([]);
      if (builderActive) {
        var split = splitBlocking(allIssues());
        if (split.blocking.length > 0) {
          renderParserSaveErrors(split.blocking);
          if (window.showToast) { window.showToast('Fix the payload tree first \\u2014 the parser saves WITH the schema version', 'error'); }
          return;
        }
      }
      var built = buildParseConfig();
      if (built.mapped === 0) {
        renderParserSaveErrors([{ message: 'Map at least one canonical Carrier field before saving (\\u00a711.7).' }]);
        return;
      }
      parseSave.disabled = true;
      parseSave.classList.add('lg-saving');
      getJson('POST', apiBase + '/payload-schemas', {
        schema_json: buildSchemaJson(),
        carrier_parse_json: built.config
      }).then(function (res) {
        parseSave.disabled = false;
        parseSave.classList.remove('lg-saving');
        if (res.ok && res.body && res.body.version) {
          activeVersion = res.body.version;
          if (metaEl) { metaEl.textContent = 'Active schema: v' + res.body.version + ' (' + (res.body.source || 'manual') + ')'; }
          renderParserSaveErrors([]);
          renderServerOutcome(res.body);
          if (window.showToast) { window.showToast('Response parser saved with schema v' + res.body.version + ' (now active)', 'success'); }
          refreshPreview();
          return;
        }
        var entries = (res.body && res.body.schema_errors) || [];
        if (entries.length === 0 && res.body && res.body.fields) {
          var k;
          for (k in res.body.fields) {
            if (hasOwn(res.body.fields, k)) {
              entries.push({ path: k, message: res.body.fields[k] });
            }
          }
        }
        if (entries.length === 0 && res.body && res.body.error) { entries = [{ message: res.body.error }]; }
        renderParserSaveErrors(entries);
        if (window.showToast) { window.showToast('Response parser not saved \\u2014 fix the errors', 'error'); }
      }).catch(function () {
        parseSave.disabled = false;
        parseSave.classList.remove('lg-saving');
        renderParserSaveErrors([{ message: 'Network error \\u2014 the parser was not saved.' }]);
      });
    });
  }

  // --- init -------------------------------------------------------------------------------------
  if (builderActive) {
    var initialSchema = bootstrap.active_schema && bootstrap.active_schema.schema;
    if (initialSchema && initialSchema.root && Object.prototype.toString.call(initialSchema.root.children) === '[object Array]') {
      loadItemsFromChildren(initialSchema.root.children, bootstrap.active_schema.version || 0);
    }
    renderAll();
  }
  if (testForm) { loadTestForm(); }
  void testBootstrap;
  void testFields;
}());
`;
