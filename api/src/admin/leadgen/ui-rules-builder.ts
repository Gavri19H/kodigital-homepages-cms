// LeadGen admin UI — Rules visual condition builder (v2.5.1 04 intro line:
// "Rules additionally adopts the v2.4 06 §6.10 visual condition builder in
// place of the raw JSON textarea — same evaluator, no schema change").
//
// The module renders/edits the §21.4 typed-conditions grammar EXACTLY as the
// runtime evaluator accepts it (auction-rules.ts `conditionsMatch` over
// payload.ts `conditionalMet`; funnel.ts `validateFunnelRule` validates the
// same shape for leadgen_funnel_rules.conditions_json):
//
//   { "groups": [ { "field": string, "op": eq|neq|gt|lt|gte|lte|range|in|not_in,
//                   "value"?: primitive, "values"?: primitive[],
//                   "from"?: number, "to"?: number } ] }
//
// §21.4 NORMATIVE combination semantics: entries sharing a `field` are OR'd,
// distinct fields are AND'd, empty/absent groups = always matches. The grammar
// has NO deeper nesting — so the builder's AND/OR surface is exactly: OR rows
// inside a per-field cluster, AND between clusters (§6.10 "OR groups only if
// the current evaluator supports them" — it supports same-field OR only).
// Operators NOT in the evaluator (contains, …) are omitted from the dropdown
// per §6.10 (never disabled-but-visible). "is empty"/"is not empty" are pure
// §6.10 sugar over eq/neq with value "" (identical serialized bytes).
//
// MOUNT CONTRACT (consumed by the ui-quotes.ts sibling — FROZEN):
//   renderRulesBuilderPanel(data) → SSR HTML containing
//     #lg-rules-builder-root  (carries data-target-input)
//     one builder card per data.rules entry (data-rule-index="i"), each with
//       its OWN hidden output `<input type="hidden" data-rule-conditions
//       data-lg-rb-out data-rule-index="i">` — drop-in compatible with the
//       existing collectRules() selector `[data-rule-conditions]` when the
//       host nests a card inside its `[data-rule-row]`,
//     <script id="lg-rules-builder-data" type="application/json"> blob
//       (every literal "<" emitted as the 6-char JSON escape backslash-u003c
//       — the ui-auctions.ts house idiom).
//   RULES_BUILDER_SCRIPT — strict-ES5 island (no arrows/const/let/template
//     literals/backticks — layout.ts constraint, asserted by the ES5 parse
//     gate in test/leadgen-rules-builder.test.ts).
//
// target_input choice (documented per the interface note): the target input id
// is accepted as OPTIONAL `data.target_input_id` (default
// DEFAULT_RULES_CONDITIONS_INPUT_ID = "lg-rule-conditions" — the stable id the
// ui-quotes.ts host stamps on rule row 0's [data-rule-conditions] carrier).
// It is rendered verbatim into `data-target-input` on the root; the host may
// alternatively rewrite that attribute before the island runs — the island
// reads the ATTRIBUTE at init.
//
// Output routing (every edit, in order):
//   1. The card's own hidden input (always).
//   2. HOST-ROW SYNC: the ui-quotes.ts Rules form keeps one
//      `[data-rule-conditions]` carrier per `[data-rule-row]` inside
//      `#lg-rule-list` (collectRules() reads them row-by-row). Card i's JSON
//      is synced into row i's carrier — index-aligned because the host SSRs
//      rows from the SAME variant.rules array this panel receives. Raw
//      fallback cards NEVER write the host carrier (the host's Advanced
//      textarea stays the operator's edit surface for those).
//   3. Single-card external mirror: with EXACTLY ONE card, the JSON is also
//      mirrored into document.getElementById(<data-target-input>) — the
//      frozen-contract single-input mount (skipped when it is the same
//      element the host-row sync already wrote).
//
// Pre-existing stored conditions: parsed → sentence rows. Any construct the
// grammar/evaluator does not support (non-primitive values, unknown ops,
// extra keys, nesting, invalid JSON) puts THAT card into raw fallback mode:
// warning banner + the ORIGINAL JSON preserved byte-exactly in the Advanced
// view AND in the hidden output (never destroyed, never re-serialized).
//
// offers usage: decorative only — resolves a redirect rule's target offer
// name for the card header chip (matched via target_offer_public_id /
// target_offer_name when the host provides them; numeric-only ids render no
// chip). The offers list is passed through in the data blob for the host.
//
// Island extras (additive, for the host's dynamic "+ Add rule" rows):
//   window.lgRulesBuilder = { parseConditions, serializeRows,
//     normalizeClusterOrder, cardSentence, mount(containerEl, rawText, outEl,
//     options), getValues() }.

import { escapeHtml } from "../templates/layout";

// ---------------------------------------------------------------------------
// Types + operator metadata (single source for SSR, island mirror, and tests)
// ---------------------------------------------------------------------------

export type RulesBuilderStorageOp =
  | "eq"
  | "neq"
  | "gt"
  | "lt"
  | "gte"
  | "lte"
  | "range"
  | "in"
  | "not_in";

export type RulesBuilderUiOp = RulesBuilderStorageOp | "is_empty" | "not_empty";

// value  = typed single value (eq/neq)     number = numeric bound (gt/lt/gte/lte)
// range  = from+to                          list  = values chips (in/not_in)
// none   = no value control (empty sugar)
export type RulesBuilderValueKind = "value" | "number" | "range" | "list" | "none";

export interface RulesBuilderOpMeta {
  ui: RulesBuilderUiOp;
  storage: RulesBuilderStorageOp;
  label: string;
  kind: RulesBuilderValueKind;
}

// §6.10 operator dropdown — human labels; raw op enums never appear in
// normal-mode copy. `contains`/`does not contain` are OMITTED (the evaluator
// does not implement them; §6.10: unsupported operators are omitted).
export const RULES_BUILDER_OPS: readonly RulesBuilderOpMeta[] = [
  { ui: "eq", storage: "eq", label: "is (=)", kind: "value" },
  { ui: "neq", storage: "neq", label: "is not (≠)", kind: "value" },
  { ui: "gt", storage: "gt", label: "greater than (>)", kind: "number" },
  { ui: "lt", storage: "lt", label: "less than (<)", kind: "number" },
  { ui: "gte", storage: "gte", label: "at least (≥)", kind: "number" },
  { ui: "lte", storage: "lte", label: "at most (≤)", kind: "number" },
  { ui: "range", storage: "range", label: "between", kind: "range" },
  { ui: "in", storage: "in", label: "in list", kind: "list" },
  { ui: "not_in", storage: "not_in", label: "not in list", kind: "list" },
  { ui: "is_empty", storage: "eq", label: "is empty", kind: "none" },
  { ui: "not_empty", storage: "neq", label: "is not empty", kind: "none" },
] as const;

// The ui-quotes.ts host stamps this id on rule row 0's conditions carrier
// (`renderRuleRow`: index 0 → id="lg-rule-conditions").
export const DEFAULT_RULES_CONDITIONS_INPUT_ID = "lg-rule-conditions";

export type RulesBuilderPrimitive = string | number | boolean;
export type RulesBuilderValueType = "text" | "number" | "bool";

export interface RulesBuilderChip {
  vtype: RulesBuilderValueType;
  value: RulesBuilderPrimitive;
}

export interface RulesBuilderRow {
  field: string;
  op: RulesBuilderUiOp;
  vtype?: RulesBuilderValueType;
  value?: RulesBuilderPrimitive;
  from?: number;
  to?: number;
  values?: RulesBuilderChip[];
}

export type RulesBuilderParseResult =
  | { ok: true; rows: RulesBuilderRow[] }
  | { ok: false; reason: string };

export interface RulesBuilderField {
  internal_field: string;
  label: string;
}

export interface RulesBuilderOffer {
  public_id: string;
  name: string;
}

// ---------------------------------------------------------------------------
// Parse (stored conditions → ui rows) — STRICT: anything the visual editor
// could not re-serialize with identical evaluation goes to raw fallback.
// ---------------------------------------------------------------------------

const STORAGE_OP_SET: ReadonlySet<string> = new Set<RulesBuilderStorageOp>([
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

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isPrimitive(v: unknown): v is RulesBuilderPrimitive {
  const t = typeof v;
  return t === "string" || t === "number" || t === "boolean";
}

function vtypeOf(v: RulesBuilderPrimitive): RulesBuilderValueType {
  if (typeof v === "number") return "number";
  if (typeof v === "boolean") return "bool";
  return "text";
}

// Allowed key sets per op-kind — a stored entry carrying ANY other key is
// unsupported (re-serializing would silently drop it; fallback preserves it).
function entryKeysSupported(g: Record<string, unknown>, kind: RulesBuilderValueKind): boolean {
  const allowed: Record<string, true> =
    kind === "range"
      ? { field: true, op: true, from: true, to: true }
      : kind === "list"
        ? { field: true, op: true, values: true }
        : { field: true, op: true, value: true };
  for (const key of Object.keys(g)) {
    if (allowed[key] !== true) return false;
  }
  return true;
}

function rowFromEntry(g: Record<string, unknown>): RulesBuilderRow | string {
  const field = g["field"];
  if (typeof field !== "string" || field.trim() === "") return "field_invalid";
  const op = g["op"];
  if (typeof op !== "string" || !STORAGE_OP_SET.has(op)) return "op_unsupported";
  const storageOp = op as RulesBuilderStorageOp;

  if (storageOp === "range") {
    if (!entryKeysSupported(g, "range")) return "extra_entry_keys";
    const from = g["from"];
    const to = g["to"];
    if (typeof from !== "number" || typeof to !== "number") return "value_shape_unsupported";
    return { field, op: "range", from, to };
  }

  if (storageOp === "in" || storageOp === "not_in") {
    if (!entryKeysSupported(g, "list")) return "extra_entry_keys";
    const values = g["values"];
    if (!Array.isArray(values)) return "value_shape_unsupported";
    const chips: RulesBuilderChip[] = [];
    for (const member of values) {
      if (!isPrimitive(member)) return "value_shape_unsupported";
      chips.push({ vtype: vtypeOf(member), value: member });
    }
    return { field, op: storageOp, values: chips };
  }

  // eq / neq / gt / lt / gte / lte — all single-`value` entries.
  if (!entryKeysSupported(g, "value")) return "extra_entry_keys";
  if (!("value" in g)) return "value_shape_unsupported";
  const value = g["value"];

  if (storageOp === "gt" || storageOp === "lt" || storageOp === "gte" || storageOp === "lte") {
    // The evaluator treats a non-number bound as never-matching; round-tripping
    // it through a numeric input would CHANGE semantics → unsupported.
    if (typeof value !== "number") return "value_shape_unsupported";
    return { field, op: storageOp, value, vtype: "number" };
  }

  if (!isPrimitive(value)) return "value_shape_unsupported";
  // §6.10 sugar: eq/neq with value "" renders as "is empty"/"is not empty"
  // (identical serialized bytes on the way back out).
  if (value === "") {
    return { field, op: storageOp === "eq" ? "is_empty" : "not_empty" };
  }
  return { field, op: storageOp, value, vtype: vtypeOf(value) };
}

function rowsFromParsedValue(value: unknown): RulesBuilderParseResult {
  if (value === null || value === undefined) return { ok: true, rows: [] };
  if (!isRecord(value)) return { ok: false, reason: "not_object" };
  for (const key of Object.keys(value)) {
    if (key !== "groups") return { ok: false, reason: "extra_root_keys" };
  }
  const groups = value["groups"];
  if (!Array.isArray(groups)) return { ok: false, reason: "groups_missing" };
  const rows: RulesBuilderRow[] = [];
  for (const g of groups) {
    if (!isRecord(g)) return { ok: false, reason: "entry_not_object" };
    const row = rowFromEntry(g);
    if (typeof row === "string") return { ok: false, reason: row };
    rows.push(row);
  }
  return { ok: true, rows: normalizeClusterOrder(rows) };
}

// Parse stored conditions_json (object from the API shape, or the raw string
// from a DB row / textarea). Absent / empty ⇒ zero rows (always matches).
export function parseStoredConditions(raw: unknown): RulesBuilderParseResult {
  if (raw === null || raw === undefined) return { ok: true, rows: [] };
  if (typeof raw === "string") {
    const t = raw.trim();
    if (t === "") return { ok: true, rows: [] };
    let parsed: unknown;
    try {
      parsed = JSON.parse(t);
    } catch {
      return { ok: false, reason: "invalid_json" };
    }
    return rowsFromParsedValue(parsed);
  }
  return rowsFromParsedValue(raw);
}

// ---------------------------------------------------------------------------
// Serialize (ui rows → evaluator-exact conditions JSON)
// ---------------------------------------------------------------------------

// §21.4 evaluation is order-independent (AND across fields, OR within a
// field), so grouping same-field rows contiguously never changes a verdict —
// it only makes groups[] mirror the visual clusters.
export function normalizeClusterOrder(rows: readonly RulesBuilderRow[]): RulesBuilderRow[] {
  const fieldOrder: string[] = [];
  for (const row of rows) {
    if (!fieldOrder.includes(row.field)) fieldOrder.push(row.field);
  }
  const out: RulesBuilderRow[] = [];
  for (const field of fieldOrder) {
    for (const row of rows) {
      if (row.field === field) out.push(row);
    }
  }
  return out;
}

function groupFromRow(row: RulesBuilderRow): Record<string, unknown> {
  if (row.op === "is_empty") return { field: row.field, op: "eq", value: "" };
  if (row.op === "not_empty") return { field: row.field, op: "neq", value: "" };
  if (row.op === "range") {
    return {
      field: row.field,
      op: "range",
      from: typeof row.from === "number" ? row.from : 0,
      to: typeof row.to === "number" ? row.to : 0,
    };
  }
  if (row.op === "in" || row.op === "not_in") {
    const values = (row.values ?? []).map((c) => c.value);
    return { field: row.field, op: row.op, values };
  }
  if (row.op === "gt" || row.op === "lt" || row.op === "gte" || row.op === "lte") {
    return { field: row.field, op: row.op, value: typeof row.value === "number" ? row.value : 0 };
  }
  return { field: row.field, op: row.op, value: row.value === undefined ? "" : row.value };
}

// Rows with an empty field are not conditions yet (mid-edit) — skipped, so the
// output NEVER fails validateFunnelRule's field-required check.
export function serializeRows(rows: readonly RulesBuilderRow[]): string {
  const usable = normalizeClusterOrder(rows.filter((r) => r.field !== ""));
  return JSON.stringify({ groups: usable.map(groupFromRow) });
}

// ---------------------------------------------------------------------------
// Sentences (plain-language; §6.10 live preview)
// ---------------------------------------------------------------------------

function fmtValue(v: RulesBuilderPrimitive | undefined): string {
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number") return String(v);
  if (v === undefined || v === "") return '""';
  return '"' + v + '"';
}

function fmtList(chips: readonly RulesBuilderChip[] | undefined): string {
  if (!chips || chips.length === 0) return "(no values yet)";
  return chips.map((c) => fmtValue(c.value)).join(", ");
}

function rowSentence(row: RulesBuilderRow, labelOf: (field: string) => string): string {
  const label = row.field === "" ? "(choose a field)" : labelOf(row.field);
  switch (row.op) {
    case "eq":
      return label + " is " + fmtValue(row.value);
    case "neq":
      return label + " is not " + fmtValue(row.value);
    case "gt":
      return label + " is greater than " + fmtValue(row.value);
    case "lt":
      return label + " is less than " + fmtValue(row.value);
    case "gte":
      return label + " is at least " + fmtValue(row.value);
    case "lte":
      return label + " is at most " + fmtValue(row.value);
    case "range":
      return label + " is between " + String(row.from ?? 0) + " and " + String(row.to ?? 0);
    case "in":
      return label + " is any of " + fmtList(row.values);
    case "not_in":
      return label + " is none of " + fmtList(row.values);
    case "is_empty":
      return label + " is empty";
    case "not_empty":
      return label + " is not empty";
  }
}

interface RowCluster {
  field: string;
  rows: RulesBuilderRow[];
}

function clustersOf(rows: readonly RulesBuilderRow[]): RowCluster[] {
  const out: RowCluster[] = [];
  let current: RowCluster | null = null;
  for (const row of rows) {
    if (current !== null && current.field === row.field) {
      current.rows.push(row);
    } else {
      current = { field: row.field, rows: [row] };
      out.push(current);
    }
  }
  return out;
}

export function conditionsSentence(
  rows: readonly RulesBuilderRow[],
  labelOf: (field: string) => string,
): string {
  if (rows.length === 0) return "Always matches — no conditions.";
  const parts = clustersOf(normalizeClusterOrder(rows)).map((cluster) => {
    const s = cluster.rows.map((r) => rowSentence(r, labelOf)).join(" or ");
    return cluster.rows.length > 1 ? "(" + s + ")" : s;
  });
  return "Matches when " + parts.join(" and ") + ".";
}

// ---------------------------------------------------------------------------
// SSR rendering
// ---------------------------------------------------------------------------

const RULE_TYPE_LABELS: Record<string, string> = {
  redirect_direct_offer: "Redirect to offer",
  skip_section: "Skip a section",
  show_section: "Show a section",
  eligibility: "Eligibility",
  disqualification: "Disqualification",
  auction_entry: "Auction entry",
};

function humanizeToken(token: string): string {
  return token.replace(/_/g, " ");
}

interface RuleView {
  index: number;
  label: string;
  offerName: string | null;
  priority: number | null;
  enabled: boolean;
  raw: string;
  parse: RulesBuilderParseResult;
}

// data.rules entries are shape-tolerant (rules: unknown[] is FROZEN):
//   • the ui-quotes.ts host passes BARE conditions documents
//     (`selected.rules.map((r) => r.conditions_json ?? { groups: [] })`) —
//     an object whose only key is `groups`, or a raw JSON string;
//   • richer hosts may pass full rule records ({ rule_type, conditions_json,
//     priority, enabled, target_offer_name/target_offer_public_id, … }) —
//     detected via the conditions_json/conditions key and used for the card
//     header chips.
// Anything else falls through parseStoredConditions' strict checks into the
// raw fallback (preserved, never destroyed).
function extractRuleView(
  entry: unknown,
  index: number,
  offers: readonly RulesBuilderOffer[],
): RuleView {
  const rec = isRecord(entry) ? entry : {};
  const isRuleRecord = isRecord(entry) && ("conditions_json" in rec || "conditions" in rec);

  const rt = isRuleRecord && typeof rec["rule_type"] === "string" ? (rec["rule_type"] as string) : "";
  const label = RULE_TYPE_LABELS[rt] ?? (rt !== "" ? humanizeToken(rt) : "Rule");

  let offerName: string | null = null;
  if (isRuleRecord) {
    const explicitName = rec["target_offer_name"];
    if (typeof explicitName === "string" && explicitName !== "") {
      offerName = explicitName;
    } else {
      const pub = rec["target_offer_public_id"];
      if (typeof pub === "string" && pub !== "") {
        const hit = offers.find((o) => o.public_id === pub);
        if (hit !== undefined) offerName = hit.name;
      }
    }
  }

  const priority = isRuleRecord && typeof rec["priority"] === "number" ? (rec["priority"] as number) : null;
  const enabled = !isRuleRecord || !(rec["enabled"] === false || rec["enabled"] === 0);

  // Bare shape: the entry ITSELF is the conditions document (or JSON string).
  const conditions = isRuleRecord
    ? "conditions_json" in rec
      ? rec["conditions_json"]
      : rec["conditions"]
    : entry;
  const raw =
    typeof conditions === "string"
      ? conditions
      : conditions === undefined || conditions === null
        ? ""
        : JSON.stringify(conditions);

  return { index, label, offerName, priority, enabled, raw, parse: parseStoredConditions(conditions) };
}

function labelResolver(fields: readonly RulesBuilderField[]): (field: string) => string {
  return (field: string): string => {
    const hit = fields.find((f) => f.internal_field === field);
    if (hit !== undefined) return hit.label;
    return field === "" ? "(choose a field)" : field;
  };
}

function renderFieldSelect(
  row: RulesBuilderRow,
  fields: readonly RulesBuilderField[],
  extraFields: readonly string[],
): string {
  const options: string[] = [];
  for (const f of fields) {
    const selected = f.internal_field === row.field ? " selected" : "";
    options.push(
      `<option value="${escapeHtml(f.internal_field)}"${selected}>${escapeHtml(f.label)}</option>`,
    );
  }
  for (const extra of extraFields) {
    const selected = extra === row.field ? " selected" : "";
    options.push(`<option value="${escapeHtml(extra)}"${selected}>${escapeHtml(extra)} (custom)</option>`);
  }
  const customSelected = row.field === "" ? " selected" : "";
  options.push(`<option value="__lgcustom__"${customSelected}>Custom field…</option>`);
  return (
    `<select class="form-select lg-rb-field" data-lg-rb-field aria-label="Field">${options.join("")}</select>` +
    `<input class="form-input lg-rb-field-custom" data-lg-rb-field-custom type="text" aria-label="Custom field name" value=""${row.field === "" ? "" : " hidden"} />`
  );
}

function renderOpSelect(row: RulesBuilderRow): string {
  const options = RULES_BUILDER_OPS.map(
    (op) => `<option value="${op.ui}"${op.ui === row.op ? " selected" : ""}>${escapeHtml(op.label)}</option>`,
  ).join("");
  return `<select class="form-select lg-rb-op" data-lg-rb-op aria-label="Condition">${options}</select>`;
}

function renderVtypeSelect(vtype: RulesBuilderValueType): string {
  const opts: Array<[RulesBuilderValueType, string]> = [
    ["text", "Text"],
    ["number", "Number"],
    ["bool", "Yes/no"],
  ];
  const options = opts
    .map(([v, label]) => `<option value="${v}"${v === vtype ? " selected" : ""}>${label}</option>`)
    .join("");
  return `<select class="form-select lg-rb-vtype" data-lg-rb-vtype aria-label="Value type">${options}</select>`;
}

function renderChip(chip: RulesBuilderChip, index: number): string {
  const display = typeof chip.value === "boolean" ? (chip.value ? "Yes" : "No") : String(chip.value);
  const typeHint = chip.vtype === "text" ? "" : ` title="${chip.vtype === "number" ? "Number value" : "Yes/no value"}"`;
  return (
    `<span class="lg-rb-chip" data-lg-rb-chip data-chip-index="${index}"${typeHint}>${escapeHtml(display)}` +
    `<button type="button" data-lg-rb-chip-remove aria-label="Remove value">×</button></span>`
  );
}

function renderValueZone(row: RulesBuilderRow): string {
  const meta = RULES_BUILDER_OPS.find((op) => op.ui === row.op);
  const kind = meta === undefined ? "value" : meta.kind;
  if (kind === "none") return "";
  if (kind === "number") {
    const v = typeof row.value === "number" ? String(row.value) : "0";
    return `<input class="form-input lg-rb-value" data-lg-rb-value type="number" step="any" aria-label="Value" value="${escapeHtml(v)}" />`;
  }
  if (kind === "range") {
    const from = typeof row.from === "number" ? String(row.from) : "0";
    const to = typeof row.to === "number" ? String(row.to) : "0";
    return (
      `<input class="form-input lg-rb-from" data-lg-rb-from type="number" step="any" aria-label="From" value="${escapeHtml(from)}" />` +
      `<span class="lg-rb-joiner">and</span>` +
      `<input class="form-input lg-rb-to" data-lg-rb-to type="number" step="any" aria-label="To" value="${escapeHtml(to)}" />`
    );
  }
  if (kind === "list") {
    const chips = (row.values ?? []).map((c, i) => renderChip(c, i)).join("");
    return (
      `<span class="lg-rb-chips" data-lg-rb-chips>${chips}</span>` +
      `<input class="form-input lg-rb-chip-entry" data-lg-rb-chip-entry type="text" aria-label="New value" />` +
      `<select class="form-select lg-rb-chip-vtype" data-lg-rb-chip-vtype aria-label="New value type">` +
      `<option value="text">Text</option><option value="number">Number</option></select>` +
      `<button type="button" class="btn btn-sm btn-outline" data-lg-rb-chip-add>Add</button>`
    );
  }
  // kind === "value" (eq/neq): typed input per vtype.
  const vtype = row.vtype ?? (row.value === undefined ? "text" : vtypeOf(row.value));
  let control: string;
  if (vtype === "bool") {
    const isNo = row.value === false;
    control =
      `<select class="form-select lg-rb-value" data-lg-rb-value aria-label="Value">` +
      `<option value="yes"${isNo ? "" : " selected"}>Yes</option>` +
      `<option value="no"${isNo ? " selected" : ""}>No</option></select>`;
  } else if (vtype === "number") {
    const v = typeof row.value === "number" ? String(row.value) : "0";
    control = `<input class="form-input lg-rb-value" data-lg-rb-value type="number" step="any" aria-label="Value" value="${escapeHtml(v)}" />`;
  } else {
    const v = row.value === undefined ? "" : String(row.value);
    control = `<input class="form-input lg-rb-value" data-lg-rb-value type="text" aria-label="Value" value="${escapeHtml(v)}" />`;
  }
  return renderVtypeSelect(vtype) + control;
}

function renderRow(
  row: RulesBuilderRow,
  fields: readonly RulesBuilderField[],
  extraFields: readonly string[],
): string {
  return (
    `<div class="lg-rb-row" data-lg-rb-row>` +
    renderFieldSelect(row, fields, extraFields) +
    renderOpSelect(row) +
    `<span class="lg-rb-val" data-lg-rb-val>${renderValueZone(row)}</span>` +
    `<button type="button" class="btn btn-sm btn-danger" data-lg-rb-remove aria-label="Remove condition">×</button>` +
    `</div>`
  );
}

const EMPTY_ROWS_COPY = "No conditions — this rule always applies.";

function renderClusters(
  rows: readonly RulesBuilderRow[],
  fields: readonly RulesBuilderField[],
): string {
  if (rows.length === 0) {
    return `<p class="form-help lg-rb-empty" data-lg-rb-empty>${EMPTY_ROWS_COPY}</p>`;
  }
  const known = new Set(fields.map((f) => f.internal_field));
  const extraFields: string[] = [];
  for (const row of rows) {
    if (row.field !== "" && !known.has(row.field) && !extraFields.includes(row.field)) {
      extraFields.push(row.field);
    }
  }
  const clusters = clustersOf(normalizeClusterOrder(rows));
  const parts: string[] = [];
  clusters.forEach((cluster, i) => {
    if (i > 0) parts.push(`<div class="lg-rb-andsep" data-lg-rb-andsep>and</div>`);
    const rowsHtml = cluster.rows
      .map((row) => renderRow(row, fields, extraFields))
      .join(`<div class="lg-rb-orsep" data-lg-rb-orsep>or</div>`);
    parts.push(
      `<div class="lg-rb-cluster" data-lg-rb-cluster data-cluster-field="${escapeHtml(cluster.field)}">` +
        rowsHtml +
        `<div class="lg-rb-clusteractions"><button type="button" class="btn btn-sm btn-outline" data-lg-rb-add-or data-field="${escapeHtml(cluster.field)}" title="Add another accepted answer for this field">+ or</button></div>` +
        `</div>`,
    );
  });
  return parts.join("");
}

// FIX 6a (15 §15.2): operator language — "JSON" never appears outside the
// Advanced details this card also renders (the summary label names it there).
const RAW_FALLBACK_COPY =
  "This rule uses advanced settings this visual builder can’t edit safely. " +
  "The original settings are preserved exactly.";

function renderCard(view: RuleView, fields: readonly RulesBuilderField[]): string {
  const chips: string[] = [];
  if (view.offerName !== null) chips.push(`<span class="lg-rb-chiplet">→ ${escapeHtml(view.offerName)}</span>`);
  if (view.priority !== null) chips.push(`<span class="lg-rb-chiplet">Order ${escapeHtml(String(view.priority))}</span>`);
  if (!view.enabled) chips.push(`<span class="lg-rb-chiplet lg-rb-chiplet-off">Disabled</span>`);

  const header =
    `<header class="lg-rb-head">` +
    `<span class="lg-rb-title">Rule ${view.index + 1}: ${escapeHtml(view.label)}</span>` +
    chips.join("") +
    `</header>`;

  if (!view.parse.ok) {
    // Raw fallback: the ORIGINAL bytes live in the Advanced view + the hidden
    // output; the island never re-serializes this card.
    return (
      `<section class="card lg-rb-card" data-lg-rb-card data-rule-index="${view.index}" data-mode="raw" data-unsupported-reason="${escapeHtml(view.parse.reason)}">` +
      header +
      `<div class="lg-rb-warning" role="alert" data-lg-rb-warning>${RAW_FALLBACK_COPY}</div>` +
      `<details class="lg-rb-advanced" data-lg-rb-advanced open>` +
      `<summary>Advanced</summary>` +
      `<pre class="lg-rb-json" data-lg-rb-json>${escapeHtml(view.raw)}</pre>` +
      `</details>` +
      `<input type="hidden" data-rule-conditions data-lg-rb-out data-rule-index="${view.index}" value="${escapeHtml(view.raw)}" />` +
      `</section>`
    );
  }

  const rows = view.parse.rows;
  const serialized = serializeRows(rows);
  let pretty = serialized;
  try {
    pretty = JSON.stringify(JSON.parse(serialized), null, 2);
  } catch {
    // serializeRows output is always valid JSON; defensive only.
  }
  const sentence = conditionsSentence(rows, labelResolver(fields));

  return (
    `<section class="card lg-rb-card" data-lg-rb-card data-rule-index="${view.index}" data-mode="visual">` +
    header +
    `<p class="lg-rb-sentence" data-lg-rb-sentence>${escapeHtml(sentence)}</p>` +
    `<div class="lg-rb-clusters" data-lg-rb-clusters>${renderClusters(rows, fields)}</div>` +
    `<div class="lg-rb-cardactions"><button type="button" class="btn btn-sm btn-secondary" data-lg-rb-add>+ Add condition</button></div>` +
    `<details class="lg-rb-advanced" data-lg-rb-advanced>` +
    `<summary>Advanced</summary>` +
    `<pre class="lg-rb-json" data-lg-rb-json>${escapeHtml(pretty)}</pre>` +
    `</details>` +
    `<input type="hidden" data-rule-conditions data-lg-rb-out data-rule-index="${view.index}" value="${escapeHtml(serialized)}" />` +
    `</section>`
  );
}

// Structural styles only — layout/spacing; NO hex colors anywhere (normal-mode
// copy stays free of raw hex per the program's plain-language policy).
const RULES_BUILDER_STYLES = `<style>
.lg-rb-card{margin:0 0 16px}
.lg-rb-head{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:4px}
.lg-rb-title{font-weight:600}
.lg-rb-chiplet{font-size:12px;padding:2px 8px;border:1px solid rgba(0,0,0,0.2);border-radius:999px}
.lg-rb-chiplet-off{opacity:0.6}
.lg-rb-sentence{font-style:italic;margin:4px 0 12px;opacity:0.85}
.lg-rb-cluster{border:1px solid rgba(0,0,0,0.12);border-radius:8px;padding:8px;margin:4px 0}
.lg-rb-andsep,.lg-rb-orsep{font-weight:600;text-transform:uppercase;font-size:11px;letter-spacing:0.06em;opacity:0.7}
.lg-rb-andsep{margin:6px 4px}
.lg-rb-orsep{margin:4px 8px}
.lg-rb-row{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:4px 0}
.lg-rb-row .form-select,.lg-rb-row .form-input{width:auto;min-width:96px}
.lg-rb-val{display:inline-flex;gap:6px;align-items:center;flex-wrap:wrap}
.lg-rb-joiner{opacity:0.7}
.lg-rb-chips{display:inline-flex;gap:4px;flex-wrap:wrap}
.lg-rb-chip{display:inline-flex;align-items:center;gap:4px;padding:2px 6px;border:1px solid rgba(0,0,0,0.15);border-radius:6px;font-size:12px}
.lg-rb-chip button{border:0;background:none;cursor:pointer;padding:0 2px}
.lg-rb-warning{border:1px solid rgba(180,83,9,0.5);background:rgba(251,191,36,0.12);padding:8px 12px;border-radius:8px;margin:8px 0}
.lg-rb-advanced{margin-top:8px}
.lg-rb-advanced pre{overflow:auto;font-size:12px;background:rgba(0,0,0,0.04);padding:8px;border-radius:6px}
.lg-rb-empty{opacity:0.75}
.lg-rb-cardactions{margin-top:8px}
</style>`;

function sanitizeFields(fields: readonly RulesBuilderField[] | undefined): RulesBuilderField[] {
  const out: RulesBuilderField[] = [];
  const seen = new Set<string>();
  for (const f of fields ?? []) {
    if (!isRecord(f)) continue;
    const internal = f["internal_field"];
    if (typeof internal !== "string" || internal === "" || seen.has(internal)) continue;
    const label = typeof f["label"] === "string" && f["label"] !== "" ? (f["label"] as string) : internal;
    seen.add(internal);
    out.push({ internal_field: internal, label });
  }
  return out;
}

function sanitizeOffers(offers: readonly RulesBuilderOffer[] | undefined): RulesBuilderOffer[] {
  const out: RulesBuilderOffer[] = [];
  for (const o of offers ?? []) {
    if (!isRecord(o)) continue;
    const publicId = o["public_id"];
    const name = o["name"];
    if (typeof publicId !== "string" || typeof name !== "string") continue;
    out.push({ public_id: publicId, name });
  }
  return out;
}

// FROZEN INTERFACE — the ui-quotes.ts sibling consumes exactly this.
export function renderRulesBuilderPanel(data: {
  rules: unknown[];
  fields: { internal_field: string; label: string }[];
  offers: { public_id: string; name: string }[];
  target_input_id?: string;
}): string {
  const fields = sanitizeFields(data.fields);
  const offers = sanitizeOffers(data.offers);
  const targetInputId =
    typeof data.target_input_id === "string" && data.target_input_id !== ""
      ? data.target_input_id
      : DEFAULT_RULES_CONDITIONS_INPUT_ID;

  const ruleInputs = Array.isArray(data.rules) && data.rules.length > 0 ? data.rules : [null];
  const views = ruleInputs.map((entry, i) => extractRuleView(entry, i, offers));

  const blob = {
    target_input_id: targetInputId,
    fields,
    offers,
    rules: views.map((v) => ({
      index: v.index,
      rule_label: v.label,
      raw: v.raw,
      parsed_rows: v.parse.ok ? v.parse.rows : null,
      unsupported_reason: v.parse.ok ? null : v.parse.reason,
    })),
  };
  const blobJson = JSON.stringify(blob).replace(/</g, "\\u003c");

  return (
    `<div id="lg-rules-builder-root" class="lg-rb" data-target-input="${escapeHtml(targetInputId)}">` +
    RULES_BUILDER_STYLES +
    `<div class="lg-rb-cards">${views.map((v) => renderCard(v, fields)).join("")}</div>` +
    `<script id="lg-rules-builder-data" type="application/json">${blobJson}</script>` +
    `</div>`
  );
}

// ---------------------------------------------------------------------------
// ES5 island — mirrors parse/serialize/sentence semantics 1:1 (drift is
// pinned by the round-trip test comparing both sides byte-for-byte).
// Strict ES5: var/function only; no arrows, const/let, or template literals.
// DOM writes go through createElement/textContent only (XSS discipline).
// ---------------------------------------------------------------------------

export const RULES_BUILDER_SCRIPT = `(function () {
  'use strict';

  var STORAGE_OPS = ['eq', 'neq', 'gt', 'lt', 'gte', 'lte', 'range', 'in', 'not_in'];
  var OP_META = [
    { ui: 'eq', label: 'is (=)', kind: 'value' },
    { ui: 'neq', label: 'is not (\\u2260)', kind: 'value' },
    { ui: 'gt', label: 'greater than (>)', kind: 'number' },
    { ui: 'lt', label: 'less than (<)', kind: 'number' },
    { ui: 'gte', label: 'at least (\\u2265)', kind: 'number' },
    { ui: 'lte', label: 'at most (\\u2264)', kind: 'number' },
    { ui: 'range', label: 'between', kind: 'range' },
    { ui: 'in', label: 'in list', kind: 'list' },
    { ui: 'not_in', label: 'not in list', kind: 'list' },
    { ui: 'is_empty', label: 'is empty', kind: 'none' },
    { ui: 'not_empty', label: 'is not empty', kind: 'none' }
  ];
  var EMPTY_COPY = 'No conditions \\u2014 this rule always applies.';
  var TIMES = '\\u00d7';

  function opKind(ui) {
    var i;
    for (i = 0; i < OP_META.length; i++) { if (OP_META[i].ui === ui) { return OP_META[i].kind; } }
    return 'value';
  }
  function isArr(v) { return Object.prototype.toString.call(v) === '[object Array]'; }
  function isRec(v) { return typeof v === 'object' && v !== null && !isArr(v); }
  function isPrim(v) { var t = typeof v; return t === 'string' || t === 'number' || t === 'boolean'; }
  function vtypeOf(v) {
    if (typeof v === 'number') { return 'number'; }
    if (typeof v === 'boolean') { return 'bool'; }
    return 'text';
  }
  function finiteNum(v) { return typeof v === 'number' && isFinite(v); }
  function trimStr(s) { return s.replace(/^\\s+|\\s+$/g, ''); }

  // ---- parse (stored conditions text/object -> ui rows) --------------------

  function entryKeysSupported(g, kind) {
    var allowed = kind === 'range' ? ['field', 'op', 'from', 'to']
      : kind === 'list' ? ['field', 'op', 'values']
      : ['field', 'op', 'value'];
    var keys = Object.keys(g);
    var i;
    for (i = 0; i < keys.length; i++) {
      var found = false;
      var j;
      for (j = 0; j < allowed.length; j++) { if (allowed[j] === keys[i]) { found = true; break; } }
      if (!found) { return false; }
    }
    return true;
  }

  function rowFromEntry(g) {
    var field = g.field;
    if (typeof field !== 'string' || trimStr(field) === '') { return 'field_invalid'; }
    var op = g.op;
    var known = false;
    var i;
    for (i = 0; i < STORAGE_OPS.length; i++) { if (STORAGE_OPS[i] === op) { known = true; break; } }
    if (!known) { return 'op_unsupported'; }

    if (op === 'range') {
      if (!entryKeysSupported(g, 'range')) { return 'extra_entry_keys'; }
      if (typeof g.from !== 'number' || typeof g.to !== 'number') { return 'value_shape_unsupported'; }
      return { field: field, op: 'range', from: g.from, to: g.to };
    }
    if (op === 'in' || op === 'not_in') {
      if (!entryKeysSupported(g, 'list')) { return 'extra_entry_keys'; }
      if (!isArr(g.values)) { return 'value_shape_unsupported'; }
      var chips = [];
      for (i = 0; i < g.values.length; i++) {
        if (!isPrim(g.values[i])) { return 'value_shape_unsupported'; }
        chips.push({ vtype: vtypeOf(g.values[i]), value: g.values[i] });
      }
      return { field: field, op: op, values: chips };
    }
    if (!entryKeysSupported(g, 'value')) { return 'extra_entry_keys'; }
    if (!Object.prototype.hasOwnProperty.call(g, 'value')) { return 'value_shape_unsupported'; }
    var value = g.value;
    if (op === 'gt' || op === 'lt' || op === 'gte' || op === 'lte') {
      if (typeof value !== 'number') { return 'value_shape_unsupported'; }
      return { field: field, op: op, value: value, vtype: 'number' };
    }
    if (!isPrim(value)) { return 'value_shape_unsupported'; }
    if (value === '') { return { field: field, op: op === 'eq' ? 'is_empty' : 'not_empty' }; }
    return { field: field, op: op, value: value, vtype: vtypeOf(value) };
  }

  function rowsFromValue(value) {
    if (value === null || value === undefined) { return { ok: true, rows: [] }; }
    if (!isRec(value)) { return { ok: false, reason: 'not_object' }; }
    var keys = Object.keys(value);
    var i;
    for (i = 0; i < keys.length; i++) { if (keys[i] !== 'groups') { return { ok: false, reason: 'extra_root_keys' }; } }
    if (!isArr(value.groups)) { return { ok: false, reason: 'groups_missing' }; }
    var rows = [];
    for (i = 0; i < value.groups.length; i++) {
      var g = value.groups[i];
      if (!isRec(g)) { return { ok: false, reason: 'entry_not_object' }; }
      var row = rowFromEntry(g);
      if (typeof row === 'string') { return { ok: false, reason: row }; }
      rows.push(row);
    }
    return { ok: true, rows: normalizeClusterOrder(rows) };
  }

  function parseConditions(raw) {
    if (raw === null || raw === undefined) { return { ok: true, rows: [] }; }
    if (typeof raw !== 'string') { return rowsFromValue(raw); }
    var t = trimStr(raw);
    if (t === '') { return { ok: true, rows: [] }; }
    var v;
    try { v = JSON.parse(t); } catch (e) { return { ok: false, reason: 'invalid_json' }; }
    return rowsFromValue(v);
  }

  // ---- serialize (ui rows -> evaluator-exact conditions JSON) --------------

  function normalizeClusterOrder(rows) {
    var fields = [];
    var i;
    for (i = 0; i < rows.length; i++) {
      var f = rows[i].field;
      var seen = false;
      var j;
      for (j = 0; j < fields.length; j++) { if (fields[j] === f) { seen = true; break; } }
      if (!seen) { fields.push(f); }
    }
    var out = [];
    for (i = 0; i < fields.length; i++) {
      for (var k = 0; k < rows.length; k++) { if (rows[k].field === fields[i]) { out.push(rows[k]); } }
    }
    return out;
  }

  function groupFromRow(row) {
    if (row.op === 'is_empty') { return { field: row.field, op: 'eq', value: '' }; }
    if (row.op === 'not_empty') { return { field: row.field, op: 'neq', value: '' }; }
    if (row.op === 'range') {
      return { field: row.field, op: 'range', from: finiteNum(row.from) ? row.from : 0, to: finiteNum(row.to) ? row.to : 0 };
    }
    if (row.op === 'in' || row.op === 'not_in') {
      var values = [];
      var chips = isArr(row.values) ? row.values : [];
      var i;
      for (i = 0; i < chips.length; i++) { values.push(chips[i].value); }
      return { field: row.field, op: row.op, values: values };
    }
    if (row.op === 'gt' || row.op === 'lt' || row.op === 'gte' || row.op === 'lte') {
      return { field: row.field, op: row.op, value: finiteNum(row.value) ? row.value : 0 };
    }
    return { field: row.field, op: row.op, value: row.value === undefined ? '' : row.value };
  }

  function serializeRows(rows) {
    var withField = [];
    var i;
    for (i = 0; i < rows.length; i++) { if (rows[i].field !== '') { withField.push(rows[i]); } }
    var norm = normalizeClusterOrder(withField);
    var groups = [];
    for (i = 0; i < norm.length; i++) { groups.push(groupFromRow(norm[i])); }
    return JSON.stringify({ groups: groups });
  }

  // ---- sentences ------------------------------------------------------------

  function fmtValue(v) {
    if (typeof v === 'boolean') { return v ? 'Yes' : 'No'; }
    if (typeof v === 'number') { return String(v); }
    if (v === undefined || v === '') { return '""'; }
    return '"' + v + '"';
  }
  function fmtList(chips) {
    if (!chips || chips.length === 0) { return '(no values yet)'; }
    var parts = [];
    var i;
    for (i = 0; i < chips.length; i++) { parts.push(fmtValue(chips[i].value)); }
    return parts.join(', ');
  }
  function rowSentence(row, labelOf) {
    var label = row.field === '' ? '(choose a field)' : labelOf(row.field);
    if (row.op === 'eq') { return label + ' is ' + fmtValue(row.value); }
    if (row.op === 'neq') { return label + ' is not ' + fmtValue(row.value); }
    if (row.op === 'gt') { return label + ' is greater than ' + fmtValue(row.value); }
    if (row.op === 'lt') { return label + ' is less than ' + fmtValue(row.value); }
    if (row.op === 'gte') { return label + ' is at least ' + fmtValue(row.value); }
    if (row.op === 'lte') { return label + ' is at most ' + fmtValue(row.value); }
    if (row.op === 'range') { return label + ' is between ' + String(finiteNum(row.from) ? row.from : 0) + ' and ' + String(finiteNum(row.to) ? row.to : 0); }
    if (row.op === 'in') { return label + ' is any of ' + fmtList(row.values); }
    if (row.op === 'not_in') { return label + ' is none of ' + fmtList(row.values); }
    if (row.op === 'is_empty') { return label + ' is empty'; }
    return label + ' is not empty';
  }
  function clustersOf(rows) {
    var out = [];
    var current = null;
    var i;
    for (i = 0; i < rows.length; i++) {
      if (current !== null && current.field === rows[i].field) { current.rows.push(rows[i]); }
      else { current = { field: rows[i].field, rows: [rows[i]] }; out.push(current); }
    }
    return out;
  }
  function cardSentence(rows, labelOf) {
    if (rows.length === 0) { return 'Always matches \\u2014 no conditions.'; }
    var clusters = clustersOf(normalizeClusterOrder(rows));
    var parts = [];
    var i;
    for (i = 0; i < clusters.length; i++) {
      var inner = [];
      var j;
      for (j = 0; j < clusters[i].rows.length; j++) { inner.push(rowSentence(clusters[i].rows[j], labelOf)); }
      var s = inner.join(' or ');
      parts.push(clusters[i].rows.length > 1 ? '(' + s + ')' : s);
    }
    return 'Matches when ' + parts.join(' and ') + '.';
  }

  // ---- DOM helpers ----------------------------------------------------------

  function el(tag, cls) {
    var n = document.createElement(tag);
    if (cls) { n.className = cls; }
    return n;
  }
  function clearNode(node) {
    while (node.firstChild) { node.removeChild(node.firstChild); }
  }
  function fire(target, type) {
    try {
      var ev = document.createEvent('Event');
      ev.initEvent(type, true, true);
      target.dispatchEvent(ev);
    } catch (e) { /* older engines without createEvent: outputs still written */ }
  }
  function fireRoot(state, json) {
    if (!state.card) { return; }
    try {
      var ev = document.createEvent('CustomEvent');
      ev.initCustomEvent('lg:rules-builder-change', true, false, { index: state.index, json: json });
      state.card.dispatchEvent(ev);
    } catch (e) { fire(state.card, 'change'); }
  }

  // The ui-quotes.ts Rules form keeps one [data-rule-conditions] carrier per
  // [data-rule-row] inside #lg-rule-list (collectRules() reads them). Resolve
  // card i's carrier FRESH on every write (the host re-renders rows on
  // add/remove). Raw-fallback cards never write the host carrier.
  function hostCarrier(state) {
    if (state.index < 0 || state.mode === 'raw') { return null; }
    var list = document.getElementById('lg-rule-list');
    if (!list || !list.querySelectorAll) { return null; }
    var rows = list.querySelectorAll('[data-rule-row]');
    if (!rows || state.index >= rows.length) { return null; }
    var row = rows[state.index];
    if (!row || !row.querySelector) { return null; }
    var carrier = row.querySelector('[data-rule-conditions]');
    if (!carrier) { return null; }
    if (carrier.hasAttribute && carrier.hasAttribute('data-lg-rb-out')) { return null; }
    return carrier;
  }

  function writeOut(state, silent) {
    var json = state.mode === 'raw' ? state.raw : serializeRows(state.rows);
    if (state.out) {
      state.out.value = json;
      if (!silent) { fire(state.out, 'input'); fire(state.out, 'change'); }
    }
    var host = hostCarrier(state);
    if (host && host !== state.out) {
      host.value = json;
      if (!silent) { fire(host, 'input'); fire(host, 'change'); }
    }
    if (state.mirror && state.ext && state.ext !== state.out && state.ext !== host) {
      state.ext.value = json;
      if (!silent) { fire(state.ext, 'input'); fire(state.ext, 'change'); }
    }
    if (state.sentenceEl) { state.sentenceEl.textContent = cardSentence(state.rows, state.labelOf); }
    if (state.jsonEl && state.mode !== 'raw') {
      try { state.jsonEl.textContent = JSON.stringify(JSON.parse(json), null, 2); }
      catch (e) { state.jsonEl.textContent = json; }
    }
    if (!silent) { fireRoot(state, json); }
  }

  // ---- editors ---------------------------------------------------------------

  function convertRowToOp(row, ui) {
    var kind = opKind(ui);
    if (kind === 'value') {
      if (!isPrim(row.value)) { row.value = ''; }
      row.vtype = vtypeOf(row.value);
    } else if (kind === 'number') {
      var n = typeof row.value === 'number' ? row.value : parseFloat(String(row.value));
      row.value = isFinite(n) ? n : 0;
      row.vtype = 'number';
    } else if (kind === 'range') {
      if (!finiteNum(row.from)) { row.from = 0; }
      if (!finiteNum(row.to)) { row.to = 0; }
    } else if (kind === 'list') {
      if (!isArr(row.values)) { row.values = []; }
    }
    row.op = ui;
  }

  function renderValueZone(state, row, zone) {
    clearNode(zone);
    var kind = opKind(row.op);
    if (kind === 'none') { return; }

    if (kind === 'number') {
      var num = el('input', 'form-input lg-rb-value');
      num.type = 'number';
      num.setAttribute('step', 'any');
      num.setAttribute('aria-label', 'Value');
      num.value = String(finiteNum(row.value) ? row.value : 0);
      num.addEventListener('input', function () {
        var v = parseFloat(num.value);
        row.value = isFinite(v) ? v : 0;
        writeOut(state);
      });
      zone.appendChild(num);
      return;
    }

    if (kind === 'range') {
      var from = el('input', 'form-input lg-rb-from');
      from.type = 'number';
      from.setAttribute('step', 'any');
      from.setAttribute('aria-label', 'From');
      from.value = String(finiteNum(row.from) ? row.from : 0);
      from.addEventListener('input', function () {
        var v = parseFloat(from.value);
        row.from = isFinite(v) ? v : 0;
        writeOut(state);
      });
      var joiner = el('span', 'lg-rb-joiner');
      joiner.textContent = 'and';
      var to = el('input', 'form-input lg-rb-to');
      to.type = 'number';
      to.setAttribute('step', 'any');
      to.setAttribute('aria-label', 'To');
      to.value = String(finiteNum(row.to) ? row.to : 0);
      to.addEventListener('input', function () {
        var v = parseFloat(to.value);
        row.to = isFinite(v) ? v : 0;
        writeOut(state);
      });
      zone.appendChild(from);
      zone.appendChild(joiner);
      zone.appendChild(to);
      return;
    }

    if (kind === 'list') {
      var chipsWrap = el('span', 'lg-rb-chips');
      if (!isArr(row.values)) { row.values = []; }
      var chips = row.values;
      var renderChips = function () {
        clearNode(chipsWrap);
        var i;
        for (i = 0; i < chips.length; i++) {
          (function (idx) {
            var chip = el('span', 'lg-rb-chip');
            var v = chips[idx].value;
            chip.appendChild(document.createTextNode(typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v)));
            if (chips[idx].vtype === 'number') { chip.title = 'Number value'; }
            if (chips[idx].vtype === 'bool') { chip.title = 'Yes/no value'; }
            var rm = el('button');
            rm.type = 'button';
            rm.setAttribute('aria-label', 'Remove value');
            rm.textContent = TIMES;
            rm.addEventListener('click', function () {
              chips.splice(idx, 1);
              renderChips();
              writeOut(state);
            });
            chip.appendChild(rm);
            chipsWrap.appendChild(chip);
          })(i);
        }
      };
      renderChips();

      var entry = el('input', 'form-input lg-rb-chip-entry');
      entry.type = 'text';
      entry.setAttribute('aria-label', 'New value');
      var entryType = el('select', 'form-select lg-rb-chip-vtype');
      entryType.setAttribute('aria-label', 'New value type');
      var optText = el('option');
      optText.value = 'text';
      optText.textContent = 'Text';
      var optNum = el('option');
      optNum.value = 'number';
      optNum.textContent = 'Number';
      entryType.appendChild(optText);
      entryType.appendChild(optNum);
      var addBtn = el('button', 'btn btn-sm btn-outline');
      addBtn.type = 'button';
      addBtn.textContent = 'Add';
      var addChip = function () {
        var rawText = entry.value;
        if (entryType.value === 'number') {
          var n = parseFloat(rawText);
          if (!isFinite(n)) { entry.focus(); return; }
          chips.push({ vtype: 'number', value: n });
        } else {
          if (rawText === '') { entry.focus(); return; }
          chips.push({ vtype: 'text', value: rawText });
        }
        entry.value = '';
        renderChips();
        writeOut(state);
      };
      addBtn.addEventListener('click', addChip);
      entry.addEventListener('keydown', function (e) {
        var code = e.keyCode || e.which;
        if (code === 13) {
          if (e.preventDefault) { e.preventDefault(); }
          addChip();
        }
      });
      zone.appendChild(chipsWrap);
      zone.appendChild(entry);
      zone.appendChild(entryType);
      zone.appendChild(addBtn);
      return;
    }

    // kind 'value' (eq / neq): value-type select + typed control.
    var vtype = row.vtype || vtypeOf(isPrim(row.value) ? row.value : '');
    var typeSel = el('select', 'form-select lg-rb-vtype');
    typeSel.setAttribute('aria-label', 'Value type');
    var types = [['text', 'Text'], ['number', 'Number'], ['bool', 'Yes/no']];
    var i;
    for (i = 0; i < types.length; i++) {
      var o = el('option');
      o.value = types[i][0];
      o.textContent = types[i][1];
      if (types[i][0] === vtype) { o.selected = true; }
      typeSel.appendChild(o);
    }
    typeSel.addEventListener('change', function () {
      var next = typeSel.value;
      if (next === 'number') {
        var n = parseFloat(String(row.value));
        row.value = isFinite(n) ? n : 0;
      } else if (next === 'bool') {
        row.value = true;
      } else {
        row.value = row.value === undefined ? '' : String(row.value);
      }
      row.vtype = next;
      renderValueZone(state, row, zone);
      writeOut(state);
    });
    zone.appendChild(typeSel);

    if (vtype === 'bool') {
      var boolSel = el('select', 'form-select lg-rb-value');
      boolSel.setAttribute('aria-label', 'Value');
      var oYes = el('option');
      oYes.value = 'yes';
      oYes.textContent = 'Yes';
      var oNo = el('option');
      oNo.value = 'no';
      oNo.textContent = 'No';
      boolSel.appendChild(oYes);
      boolSel.appendChild(oNo);
      boolSel.value = row.value === false ? 'no' : 'yes';
      boolSel.addEventListener('change', function () {
        row.value = boolSel.value === 'yes';
        writeOut(state);
      });
      zone.appendChild(boolSel);
    } else if (vtype === 'number') {
      var numeric = el('input', 'form-input lg-rb-value');
      numeric.type = 'number';
      numeric.setAttribute('step', 'any');
      numeric.setAttribute('aria-label', 'Value');
      numeric.value = String(finiteNum(row.value) ? row.value : 0);
      numeric.addEventListener('input', function () {
        var v = parseFloat(numeric.value);
        row.value = isFinite(v) ? v : 0;
        writeOut(state);
      });
      zone.appendChild(numeric);
    } else {
      var textInput = el('input', 'form-input lg-rb-value');
      textInput.type = 'text';
      textInput.setAttribute('aria-label', 'Value');
      textInput.value = row.value === undefined ? '' : String(row.value);
      textInput.addEventListener('input', function () {
        row.value = textInput.value;
        writeOut(state);
      });
      zone.appendChild(textInput);
    }
  }

  function extraFieldsOf(state) {
    var out = [];
    var i;
    for (i = 0; i < state.rows.length; i++) {
      var f = state.rows[i].field;
      if (f === '') { continue; }
      var known = false;
      var j;
      for (j = 0; j < state.fields.length; j++) { if (state.fields[j].internal_field === f) { known = true; break; } }
      if (known) { continue; }
      var dup = false;
      for (j = 0; j < out.length; j++) { if (out[j] === f) { dup = true; break; } }
      if (!dup) { out.push(f); }
    }
    return out;
  }

  function renderRowEl(state, row) {
    var wrap = el('div', 'lg-rb-row');

    var fieldSel = el('select', 'form-select lg-rb-field');
    fieldSel.setAttribute('aria-label', 'Field');
    var i;
    for (i = 0; i < state.fields.length; i++) {
      var opt = el('option');
      opt.value = state.fields[i].internal_field;
      opt.textContent = state.fields[i].label;
      if (state.fields[i].internal_field === row.field) { opt.selected = true; }
      fieldSel.appendChild(opt);
    }
    var extras = extraFieldsOf(state);
    for (i = 0; i < extras.length; i++) {
      var ex = el('option');
      ex.value = extras[i];
      ex.textContent = extras[i] + ' (custom)';
      if (extras[i] === row.field) { ex.selected = true; }
      fieldSel.appendChild(ex);
    }
    var customOpt = el('option');
    customOpt.value = '__lgcustom__';
    customOpt.textContent = 'Custom field\\u2026';
    if (row.field === '') { customOpt.selected = true; }
    fieldSel.appendChild(customOpt);

    var customInput = el('input', 'form-input lg-rb-field-custom');
    customInput.type = 'text';
    customInput.setAttribute('aria-label', 'Custom field name');
    customInput.value = '';
    if (row.field !== '') { customInput.setAttribute('hidden', 'hidden'); }
    customInput.addEventListener('input', function () {
      row.field = trimStr(customInput.value);
      writeOut(state);
    });
    customInput.addEventListener('change', function () {
      renderCardBody(state);
      writeOut(state);
    });
    fieldSel.addEventListener('change', function () {
      if (fieldSel.value === '__lgcustom__') {
        row.field = '';
        customInput.removeAttribute('hidden');
        state.pendingFocus = customInput;
        renderCardBody(state);
        writeOut(state);
        return;
      }
      row.field = fieldSel.value;
      renderCardBody(state);
      writeOut(state);
    });
    wrap.appendChild(fieldSel);
    wrap.appendChild(customInput);

    var opSel = el('select', 'form-select lg-rb-op');
    opSel.setAttribute('aria-label', 'Condition');
    for (i = 0; i < OP_META.length; i++) {
      var opOpt = el('option');
      opOpt.value = OP_META[i].ui;
      opOpt.textContent = OP_META[i].label;
      if (OP_META[i].ui === row.op) { opOpt.selected = true; }
      opSel.appendChild(opOpt);
    }
    opSel.addEventListener('change', function () {
      convertRowToOp(row, opSel.value);
      renderCardBody(state);
      writeOut(state);
    });
    wrap.appendChild(opSel);

    var zone = el('span', 'lg-rb-val');
    renderValueZone(state, row, zone);
    wrap.appendChild(zone);

    var removeBtn = el('button', 'btn btn-sm btn-danger');
    removeBtn.type = 'button';
    removeBtn.setAttribute('aria-label', 'Remove condition');
    removeBtn.textContent = TIMES;
    removeBtn.addEventListener('click', function () {
      var idx = state.rows.indexOf(row);
      if (idx !== -1) { state.rows.splice(idx, 1); }
      renderCardBody(state);
      writeOut(state);
    });
    wrap.appendChild(removeBtn);

    return wrap;
  }

  function newRow(field) {
    return { field: field, op: 'eq', vtype: 'text', value: '' };
  }
  function defaultField(state) {
    return state.fields.length > 0 ? state.fields[0].internal_field : '';
  }

  function renderCardBody(state) {
    var zone = state.zone;
    if (!zone) { return; }
    state.rows = normalizeClusterOrder(state.rows);
    clearNode(zone);

    if (state.rows.length === 0) {
      var empty = el('p', 'form-help lg-rb-empty');
      empty.textContent = EMPTY_COPY;
      zone.appendChild(empty);
    } else {
      var clusters = clustersOf(state.rows);
      var i;
      for (i = 0; i < clusters.length; i++) {
        if (i > 0) {
          var andSep = el('div', 'lg-rb-andsep');
          andSep.textContent = 'and';
          zone.appendChild(andSep);
        }
        var clusterEl = el('div', 'lg-rb-cluster');
        clusterEl.setAttribute('data-lg-rb-cluster', '');
        clusterEl.setAttribute('data-cluster-field', clusters[i].field);
        var j;
        for (j = 0; j < clusters[i].rows.length; j++) {
          if (j > 0) {
            var orSep = el('div', 'lg-rb-orsep');
            orSep.textContent = 'or';
            clusterEl.appendChild(orSep);
          }
          clusterEl.appendChild(renderRowEl(state, clusters[i].rows[j]));
        }
        (function (clusterField) {
          var actions = el('div', 'lg-rb-clusteractions');
          var orBtn = el('button', 'btn btn-sm btn-outline');
          orBtn.type = 'button';
          orBtn.textContent = '+ or';
          orBtn.title = 'Add another accepted answer for this field';
          orBtn.addEventListener('click', function () {
            var last = -1;
            var k;
            for (k = 0; k < state.rows.length; k++) { if (state.rows[k].field === clusterField) { last = k; } }
            var added = newRow(clusterField);
            if (last === -1) { state.rows.push(added); }
            else { state.rows.splice(last + 1, 0, added); }
            renderCardBody(state);
            writeOut(state);
          });
          actions.appendChild(orBtn);
          clusterEl.appendChild(actions);
        })(clusters[i].field);
        zone.appendChild(clusterEl);
      }
    }

    if (state.pendingFocus) {
      var target = state.pendingFocus;
      state.pendingFocus = null;
      if (target.focus) { try { target.focus(); } catch (e) { /* focus is best-effort */ } }
    }
  }

  function wireCard(state) {
    if (state.addBtn) {
      state.addBtn.addEventListener('click', function () {
        state.rows.push(newRow(defaultField(state)));
        renderCardBody(state);
        writeOut(state);
      });
    }
  }

  function makeLabelOf(fields) {
    return function (field) {
      var i;
      for (i = 0; i < fields.length; i++) {
        if (fields[i].internal_field === field) { return fields[i].label; }
      }
      return field === '' ? '(choose a field)' : field;
    };
  }

  // ---- panel init + public api ------------------------------------------------

  var states = [];

  function initFromPanel() {
    var root = document.getElementById('lg-rules-builder-root');
    if (!root) { return; }
    var blobEl = document.getElementById('lg-rules-builder-data');
    if (!blobEl) { return; }
    var data;
    try { data = JSON.parse(blobEl.textContent || ''); } catch (e) { return; }
    if (!data || !isArr(data.rules)) { return; }

    var extId = root.getAttribute('data-target-input') || data.target_input_id || '';
    var ext = extId ? document.getElementById(extId) : null;
    var mirror = data.rules.length === 1;
    var fields = isArr(data.fields) ? data.fields : [];
    var labelOf = makeLabelOf(fields);

    var i;
    for (i = 0; i < data.rules.length; i++) {
      var entry = data.rules[i];
      var card = root.querySelector('[data-lg-rb-card][data-rule-index="' + entry.index + '"]');
      if (!card) { continue; }
      var out = card.querySelector('[data-lg-rb-out]');
      if (entry.unsupported_reason) {
        // Raw fallback: SSR already carries the exact original bytes in the
        // hidden input + Advanced view; the island must never rewrite them.
        states.push({ index: entry.index, mode: 'raw', raw: entry.raw, rows: [], out: out, ext: null, mirror: false, labelOf: labelOf, fields: fields, card: card });
        continue;
      }
      var state = {
        index: entry.index,
        mode: 'visual',
        raw: entry.raw,
        rows: isArr(entry.parsed_rows) ? entry.parsed_rows : [],
        out: out,
        ext: ext,
        mirror: mirror,
        labelOf: labelOf,
        fields: fields,
        card: card,
        zone: card.querySelector('[data-lg-rb-clusters]'),
        sentenceEl: card.querySelector('[data-lg-rb-sentence]'),
        jsonEl: card.querySelector('[data-lg-rb-json]'),
        addBtn: card.querySelector('[data-lg-rb-add]'),
        pendingFocus: null
      };
      states.push(state);
      wireCard(state);
      renderCardBody(state);
      writeOut(state, true);
    }
  }

  // Additive host affordance: mount a builder into a dynamically-created rule
  // row. rawText: the stored conditions JSON string ('' = none). outEl: the
  // hidden input to keep updated (created inside container when null).
  function mount(container, rawText, outEl, options) {
    var opts = options || {};
    var fields = isArr(opts.fields) ? opts.fields : [];
    var out = outEl;
    if (!out) {
      out = el('input');
      out.type = 'hidden';
      out.setAttribute('data-rule-conditions', '');
      out.setAttribute('data-lg-rb-out', '');
      container.appendChild(out);
    }
    var parsed = parseConditions(rawText);
    if (!parsed.ok) {
      var rawString = typeof rawText === 'string' ? rawText : JSON.stringify(rawText);
      var warning = el('div', 'lg-rb-warning');
      warning.setAttribute('role', 'alert');
      warning.textContent = 'This rule uses advanced settings this visual builder can\\u2019t edit safely. The original settings are preserved exactly.';
      container.appendChild(warning);
      var details = el('details', 'lg-rb-advanced');
      details.setAttribute('open', 'open');
      var summary = el('summary');
      summary.textContent = 'Advanced';
      var pre = el('pre', 'lg-rb-json');
      pre.textContent = rawString;
      details.appendChild(summary);
      details.appendChild(pre);
      container.appendChild(details);
      out.value = rawString;
      var rawState = { index: -1, mode: 'raw', raw: rawString, rows: [], out: out, ext: null, mirror: false, labelOf: makeLabelOf(fields), fields: fields, card: container };
      states.push(rawState);
      return { state: rawState, serialize: function () { return rawString; } };
    }

    var sentence = el('p', 'lg-rb-sentence');
    var zone = el('div', 'lg-rb-clusters');
    var actions = el('div', 'lg-rb-cardactions');
    var addBtn = el('button', 'btn btn-sm btn-secondary');
    addBtn.type = 'button';
    addBtn.textContent = '+ Add condition';
    actions.appendChild(addBtn);
    var details2 = el('details', 'lg-rb-advanced');
    var summary2 = el('summary');
    summary2.textContent = 'Advanced';
    var pre2 = el('pre', 'lg-rb-json');
    details2.appendChild(summary2);
    details2.appendChild(pre2);
    container.appendChild(sentence);
    container.appendChild(zone);
    container.appendChild(actions);
    container.appendChild(details2);

    var state = {
      index: -1,
      mode: 'visual',
      raw: typeof rawText === 'string' ? rawText : '',
      rows: parsed.rows,
      out: out,
      ext: opts.mirrorEl || null,
      mirror: !!opts.mirrorEl,
      labelOf: makeLabelOf(fields),
      fields: fields,
      card: container,
      zone: zone,
      sentenceEl: sentence,
      jsonEl: pre2,
      addBtn: addBtn,
      pendingFocus: null
    };
    states.push(state);
    wireCard(state);
    renderCardBody(state);
    writeOut(state, true);
    return {
      state: state,
      serialize: function () { return serializeRows(state.rows); }
    };
  }

  function getValues() {
    var out = [];
    var i;
    for (i = 0; i < states.length; i++) {
      out.push({
        index: states[i].index,
        json: states[i].mode === 'raw' ? states[i].raw : serializeRows(states[i].rows)
      });
    }
    return out;
  }

  var api = {
    parseConditions: parseConditions,
    serializeRows: serializeRows,
    normalizeClusterOrder: normalizeClusterOrder,
    cardSentence: cardSentence,
    mount: mount,
    getValues: getValues,
    ops: OP_META
  };
  if (typeof window !== 'undefined') { window.lgRulesBuilder = api; }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading' && document.addEventListener) {
      document.addEventListener('DOMContentLoaded', initFromPanel);
    } else {
      initFromPanel();
    }
  }
})();
`;

// ---------------------------------------------------------------------------
// Round-4 P4b — the unified routing-rules builder (Image42-shaped modal +
// table). ADDITIVE below the module above: renderRulesBuilderPanel /
// RULES_BUILDER_SCRIPT / DEFAULT_RULES_CONDITIONS_INPUT_ID are UNCHANGED and
// still own the §21.4 CONDITIONS sub-widget — this modal MOUNTS that exact,
// already-tested builder (window.lgRulesBuilder.mount, the module's own
// documented "Island extras" API) for its Conditions section rather than
// reimplementing condition-row editing. This section owns the ENVELOPE: rule
// name, auto-derived checkpoint display, priority, status, match_mode, the
// per-rule-type action panel (variant/offer/section pickers BY NAME — never
// a raw integer id in front of the operator), and the rules table (priority/
// name/checkpoint/type/status + Edit/Duplicate/Delete). ui-quotes.ts's
// renderRuleRow keeps rendering its per-rule hidden-carrier scaffold (the
// collectRules()/seam-test/vitest-pinned wire contract — see that module) but
// its VISIBLE grid is now `lg-hidden`; this table+modal is the operator
// surface, reading/writing those SAME hidden carriers by row index.
// ---------------------------------------------------------------------------

// The routing rule's ENTRY-KNOWN field registry — mirrors resolver.ts's
// exported ROUTING_ENTRY_KNOWN_FIELDS (state/device/utm_source/utm_medium/
// utm_content/hour/weekday; utm_campaign is a documented ALIAS of utm_content
// at evaluation time, so it is not offered as a separate picker option here,
// matching the dispatch's exact 7-item list).
export const ROUTING_FIELD_OPTIONS: ReadonlyArray<{ internal_field: string; label: string }> = [
  { internal_field: "state", label: "State" },
  { internal_field: "device", label: "Device" },
  { internal_field: "utm_source", label: "UTM source" },
  { internal_field: "utm_medium", label: "UTM medium" },
  { internal_field: "utm_content", label: "UTM content" },
  { internal_field: "hour", label: "Hour (UTC 0–23)" },
  { internal_field: "weekday", label: "Weekday (UTC 0–6)" },
];
// Rework M3 (§5-M3, §4.3-9, D5): leadgen_funnel_rules' CHECK is now
// tightened, via full-table recreation, to exactly these four auction-domain
// types (migration 0048). `route_funnel_variant` rows were migrated to the
// NEW quote-scoped leadgen_quote_routing_rules table (its own UI is P3b, per
// §4.3 multi-action routing); `skip_section`/`show_section` rows are guarded
// off entirely (the migration aborts if any exist — none do, pre-migration
// data has zero such rows). Offering a removed type here would let a save
// attempt hit the DB CHECK it can never satisfy again.
export type RoutingRuleType = "redirect_direct_offer" | "eligibility" | "disqualification" | "auction_entry";

export const ROUTING_RULE_TYPES: readonly RoutingRuleType[] = [
  "redirect_direct_offer",
  "eligibility",
  "disqualification",
  "auction_entry",
];

const ROUTING_RULE_TYPE_LABELS: Record<RoutingRuleType, string> = {
  redirect_direct_offer: "Redirect to offer",
  eligibility: "Eligibility",
  disqualification: "Disqualification",
  auction_entry: "Auction entry",
};

export interface RoutingRuleRowData {
  index: number;
  public_id: string;
  rule_type: RoutingRuleType;
  rule_name: string | null;
  status: "active" | "disabled";
  priority: number;
  match_mode: "all" | "any";
  // Rework M3: the checkpoint concept belonged only to route_funnel_variant,
  // now relocated off this table entirely (P3b's quote-scoped rules own it).
  // None of the four remaining auction-domain types has a checkpoint; this
  // field stays on the wire shape (server read compatibility) but is always
  // not-applicable here.
  checkpoint_page: number | null;
  conditions_json: unknown;
  target_offer_id: number | null;
  target_section_id: number | null;
  target_funnel_variant_id: number | null; // raw internal id (server read shape) — resolved to a public_id client-side via `variants`
  value_multiplier: number | null;
  redirect_url: string | null;
  redirect_url_allowlisted: boolean;
  // §15.5 (0044) — the redirect_direct_offer session-sticky percentage gate.
  redirect_pct: number | null;
}

export interface RoutingBuilderNumericRef {
  id: number;
  name: string;
}
export interface RoutingBuilderVariantRef {
  id: number;
  public_id: string;
  name: string;
}

// FROZEN INTERFACE — the ui-quotes.ts sibling builds exactly this.
export interface RoutingBuilderData {
  rules: RoutingRuleRowData[];
  fields: { internal_field: string; label: string }[]; // ANSWER fields (section internal_fields)
  offers: RoutingBuilderNumericRef[];
  sections: RoutingBuilderNumericRef[];
  variants: RoutingBuilderVariantRef[]; // the SAME funnel's OTHER variants (route target scope — P4a anti-leak: same-funnel only)
  field_pages: Record<string, number>; // internal_field -> 0-based page index (checkpoint mirror input; resolver.ts fieldToPageIndex parity)
  page_count: number;
}

// Rework M3: route_funnel_variant (the only type with a checkpoint) is gone
// from this table's CHECK — none of the four remaining auction-domain types
// has ever had a checkpoint (this returned "—" for them before the rework
// too); now it is unconditional.
function checkpointLabel(_rule: Pick<RoutingRuleRowData, "rule_type" | "checkpoint_page">): string {
  return "—";
}

function statusPillHtml(status: "active" | "disabled"): string {
  return `<span class="lg-status-pill lg-status-${status}" data-row-status-pill>${status === "active" ? "Active" : "Disabled"}</span>`;
}

function renderRulesTableRow(rule: RoutingRuleRowData): string {
  const name = rule.rule_name !== null && rule.rule_name.trim() !== "" ? rule.rule_name : "(unnamed rule)";
  return `<tr data-rules-table-row data-row-index="${rule.index}">
    <td data-row-priority>${escapeHtml(String(rule.priority))}</td>
    <td data-row-name>${escapeHtml(name)}</td>
    <td data-row-checkpoint>${escapeHtml(checkpointLabel(rule))}</td>
    <td data-row-type>${escapeHtml(ROUTING_RULE_TYPE_LABELS[rule.rule_type] ?? rule.rule_type)}</td>
    <td data-row-status-cell>${statusPillHtml(rule.status)}</td>
    <td class="lg-rules-table-actions">
      <button type="button" class="btn btn-sm btn-outline" data-rule-edit data-row-index="${rule.index}">Edit</button>
      <button type="button" class="btn btn-sm btn-outline" data-rule-duplicate data-row-index="${rule.index}" data-rule-public-id="${escapeHtml(rule.public_id)}">Duplicate</button>
      <button type="button" class="btn btn-sm btn-outline" data-rule-toggle-status data-row-index="${rule.index}">${rule.status === "active" ? "Disable" : "Enable"}</button>
      <button type="button" class="btn btn-sm btn-danger" data-rule-delete data-row-index="${rule.index}">Delete</button>
    </td>
  </tr>`;
}

function renderRulesTable(rules: readonly RoutingRuleRowData[]): string {
  const sorted = [...rules].sort((a, b) => a.priority - b.priority);
  const rows = sorted.map(renderRulesTableRow).join("");
  return `<table class="lg-rules-table" id="lg-rules-table" aria-label="Funnel routing rules">
    <thead><tr><th>Priority</th><th>Name</th><th>Checkpoint</th><th>Type</th><th>Status</th><th>Actions</th></tr></thead>
    <tbody id="lg-rules-table-body">${rows || `<tr data-empty-rules-table><td colspan="6" class="form-help">No rules yet.</td></tr>`}</tbody>
  </table>`;
}

function numericRefOptions(refs: readonly RoutingBuilderNumericRef[], placeholder: string): string {
  const opts = refs.map((r) => `<option value="${r.id}">${escapeHtml(r.name)}</option>`).join("");
  return `<option value="">${escapeHtml(placeholder)}</option>${opts}`;
}

function variantRefOptions(refs: readonly RoutingBuilderVariantRef[]): string {
  const opts = refs.map((r) => `<option value="${escapeHtml(r.public_id)}">${escapeHtml(r.name)}</option>`).join("");
  return `<option value="">— choose a funnel variant —</option>${opts}`;
}

function renderRuleTypeOptions(): string {
  return ROUTING_RULE_TYPES.map((t) => `<option value="${t}">${escapeHtml(ROUTING_RULE_TYPE_LABELS[t])}</option>`).join("");
}

// One action-panel section per rule type — the modal JS shows exactly one
// via `data-action-for="<type>"`, matching the currently-selected rule type.
// Rework M3: route_funnel_variant / skip_section / show_section panels
// removed — those types no longer exist on leadgen_funnel_rules' CHECK (see
// RoutingRuleType's doc comment). data.variants/data.sections stay on
// RoutingBuilderData (the frozen wire contract with ui-quotes.ts) even
// though the section-target pickers they fed are gone here — variantRef/
// numericRefOptions helpers are left in place (harmless, unreferenced) per
// "stub/drop only as far as needed for coherence"; the full rebuild onto
// leadgen_quote_routing_rules is P3b.
function renderActionPanels(data: RoutingBuilderData): string {
  return `
  <div class="lg-rule-action-panel" data-action-for="redirect_direct_offer">
    <div class="form-group">
      <label class="form-label">Redirect to offer</label>
      <select class="form-select" data-modal-target-offer aria-label="Target offer">${numericRefOptions(data.offers, "— choose an offer —")}</select>
    </div>
    <div class="form-group">
      <label class="form-label">Redirect %</label>
      <input class="form-input" type="number" step="any" min="0" max="100" data-modal-redirect-pct aria-label="Redirect percent" />
      <p class="form-help">0 or empty = no redirect; 100 = all matched visitors.</p>
    </div>
    <details class="lg-advanced">
      <summary>Advanced — raw redirect URL (allowlist-gated)</summary>
      <div class="form-group"><input class="form-input" type="text" data-modal-redirect-url aria-label="Raw redirect URL" /></div>
      <label class="lg-check"><input type="checkbox" data-modal-allowlisted /> Redirect URL is on the approved list</label>
    </details>
  </div>
  <div class="lg-rule-action-panel" data-action-for="eligibility">
    <p class="form-help">No extra fields — the conditions below decide who is eligible.</p>
  </div>
  <div class="lg-rule-action-panel" data-action-for="disqualification">
    <p class="form-help">No extra fields — the conditions below decide who is disqualified.</p>
  </div>
  <div class="lg-rule-action-panel" data-action-for="auction_entry">
    <p class="form-help">No extra fields — the conditions below decide who enters the auction.</p>
  </div>`;
}

// The Image42-shaped modal: ONE shared editing surface, populated per-row by
// the ES5 island (readRow/writeRow below) — never SSR'd pre-filled for a
// SPECIFIC rule (there is exactly one modal DOM instance for however many
// rules the table lists).
function renderRuleModal(data: RoutingBuilderData): string {
  return `<div class="lg-modal-overlay lg-hidden" id="lg-rule-modal" role="dialog" aria-modal="true" aria-label="Routing rule" hidden>
  <div class="lg-modal-body card">
    <h3 id="lg-rule-modal-title">Rule</h3>
    <div class="lg-rule-grid">
      <div class="form-group"><label class="form-label" for="lg-modal-rule-name">Rule name</label><input id="lg-modal-rule-name" class="form-input" type="text" /></div>
      <div class="form-group"><label class="form-label">Checkpoint</label><p class="form-help" id="lg-modal-checkpoint" data-modal-checkpoint>Entry</p></div>
      <div class="form-group"><label class="form-label" for="lg-modal-priority">Priority (1 = highest)</label><input id="lg-modal-priority" class="form-input" type="number" min="1" max="100" step="1" /></div>
    </div>
    <div class="lg-rule-grid">
      <div class="form-group"><label class="form-label" for="lg-modal-rule-type">Rule type</label><select id="lg-modal-rule-type" class="form-select">${renderRuleTypeOptions()}</select></div>
      <div class="form-group"><label class="form-label" for="lg-modal-match-mode">Match</label><select id="lg-modal-match-mode" class="form-select"><option value="all">ALL of the following</option><option value="any">ANY of the following</option></select></div>
      <div class="form-group"><label class="form-label" for="lg-modal-status">Status</label><select id="lg-modal-status" class="form-select"><option value="active">Active</option><option value="disabled">Disabled</option></select></div>
    </div>
    <div id="lg-rule-action-panels">${renderActionPanels(data)}</div>
    <div class="form-group">
      <label class="form-label">Conditions</label>
      <div id="lg-modal-conditions-mount"></div>
    </div>
    <p class="alert alert-error lg-hidden" id="lg-modal-error" role="alert"></p>
    <div class="toolbar">
      <button type="button" class="btn btn-primary" id="lg-modal-save">Save rule</button>
      <button type="button" class="btn btn-outline" id="lg-modal-cancel">Cancel</button>
      <button type="button" class="btn btn-danger" id="lg-modal-delete">Delete</button>
    </div>
  </div>
</div>`;
}

const ROUTING_BUILDER_STYLES = `<style>
.lg-rules-table{width:100%;border-collapse:collapse;margin:8px 0}
.lg-rules-table th,.lg-rules-table td{text-align:left;padding:6px 8px;border-bottom:1px solid rgba(0,0,0,0.1)}
.lg-rules-table-actions{white-space:nowrap}
.lg-status-pill{font-size:12px;padding:2px 8px;border:1px solid rgba(0,0,0,0.2);border-radius:999px}
.lg-status-disabled{opacity:0.6}
.lg-modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.4);display:flex;align-items:flex-start;justify-content:center;overflow:auto;z-index:1000;padding:32px 16px}
.lg-modal-overlay.lg-hidden{display:none}
.lg-modal-body{max-width:720px;width:100%;margin:0 auto}
.lg-rule-action-panel{display:none}
.lg-rule-action-panel.lg-action-active{display:block}
</style>`;

// FROZEN INTERFACE — the ui-quotes.ts sibling consumes exactly this (mirrors
// renderRulesBuilderPanel's own frozen-interface convention above).
export function renderRoutingRulesPanel(data: RoutingBuilderData): string {
  const blob = {
    entry_fields: ROUTING_FIELD_OPTIONS.map((f) => f.internal_field),
    field_pages: data.field_pages,
    page_count: data.page_count,
    fields: data.fields,
    offers: data.offers,
    sections: data.sections,
    variants: data.variants,
  };
  const blobJson = JSON.stringify(blob).replace(/</g, "\\u003c");
  return `<div id="lg-routing-rules-root" class="lg-panel-card">
  ${ROUTING_BUILDER_STYLES}
  <h3>Routing rules</h3>
  <p class="form-help">Rules decide which funnel variant a visitor sees, and can redirect, skip/show a section, or gate eligibility. Highest priority (lowest number) wins when more than one rule matches.</p>
  ${renderRulesTable(data.rules)}
  <div class="toolbar"><button type="button" class="btn btn-secondary" id="lg-rule-new">+ New rule</button></div>
  ${renderRuleModal(data)}
  <script id="lg-routing-builder-data" type="application/json">${blobJson}</script>
</div>`;
}

// ---------------------------------------------------------------------------
// ES5 island — the modal/table controller. Reads/writes ui-quotes.ts's
// per-rule hidden carriers by row index (the SAME collectRules() contract
// that module already reads); the Conditions section mounts the EXISTING
// window.lgRulesBuilder.mount() builder (RULES_BUILDER_SCRIPT above) fresh
// each time the modal opens for a different row, targeting that row's own
// [data-rule-conditions] carrier directly as `outEl` — every edit inside the
// modal therefore writes LIVE into the real row, with no separate copy-back
// step. Strict ES5 (var/function only; no arrows/const/let/template
// literals/backticks — the layout.ts inline-script constraint). DOM writes
// use createElement/textContent/setAttribute only (no innerHTML) — the SAME
// XSS discipline the RULES_BUILDER_SCRIPT island above documents.
// ---------------------------------------------------------------------------
export const ROUTING_RULES_SCRIPT = `(function () {
  'use strict';

  function byId(id) { return document.getElementById(id); }
  function qs(root, sel) { return root ? root.querySelector(sel) : null; }
  function qsa(root, sel) { return root ? root.querySelectorAll(sel) : []; }
  function el(tag, cls) { var n = document.createElement(tag); if (cls) { n.className = cls; } return n; }

  var root = byId('lg-routing-rules-root');
  if (!root) { return; }
  var dataEl = byId('lg-routing-builder-data');
  var data = null;
  try { data = dataEl ? JSON.parse(dataEl.textContent || '') : null; } catch (e) { data = null; }
  if (!data) { return; }

  var entryFields = data.entry_fields || [];
  var fieldPages = data.field_pages || {};
  var pageCount = data.page_count || 1;
  var lastPageIndex = pageCount - 1;
  var combinedFields = (data.fields || []).slice();
  var i;
  for (i = 0; i < entryFields.length; i++) {
    combinedFields.unshift({ internal_field: entryFields[i], label: entryFields[i] });
  }
  // Plain-language labels for the entry-known fields (mirrors ROUTING_FIELD_OPTIONS).
  var ENTRY_LABELS = {
    state: 'State', device: 'Device', utm_source: 'UTM source', utm_medium: 'UTM medium',
    utm_content: 'UTM content', hour: 'Hour (UTC 0\\u201323)', weekday: 'Weekday (UTC 0\\u20136)'
  };
  for (i = 0; i < combinedFields.length; i++) {
    if (ENTRY_LABELS[combinedFields[i].internal_field]) { combinedFields[i].label = ENTRY_LABELS[combinedFields[i].internal_field]; }
  }

  function isEntryField(f) {
    var k;
    for (k = 0; k < entryFields.length; k++) { if (entryFields[k] === f) { return true; } }
    return false;
  }

  // Mirrors resolver.ts deriveRuleCheckpointPage / quotes-handlers.ts
  // computeFieldToPageIndex+prepareRules (same algorithm, client copy for
  // instant display — the SERVER recomputes authoritatively at save).
  function deriveCheckpoint(rows) {
    var k, allEntry = true;
    for (k = 0; k < rows.length; k++) {
      if (rows[k].field !== '' && !isEntryField(rows[k].field)) { allEntry = false; break; }
    }
    if (allEntry) { return null; }
    var max = -1;
    for (k = 0; k < rows.length; k++) {
      var f = rows[k].field;
      if (f === '' || isEntryField(f)) { continue; }
      var p = Object.prototype.hasOwnProperty.call(fieldPages, f) ? fieldPages[f] : lastPageIndex;
      if (p > max) { max = p; }
    }
    return max === -1 ? lastPageIndex : max;
  }
  function checkpointLabel(ruleType, page) {
    if (ruleType !== 'route_funnel_variant') { return '\\u2014'; }
    return page === null ? 'Entry' : ('Page ' + (page + 1));
  }

  function ruleListEl() { return byId('lg-rule-list'); }
  function rowAt(index) {
    var list = ruleListEl();
    if (!list) { return null; }
    var rows = list.querySelectorAll('[data-rule-row]');
    return rows[index] || null;
  }
  function rowCount() {
    var list = ruleListEl();
    return list ? list.querySelectorAll('[data-rule-row]').length : 0;
  }
  function markDirty() {
    // Mirrors the host's own dirty-arming path EXACTLY: ui-quotes.ts's
    // markDirtyFor(ev.target) walks ev.target's ANCESTORS looking for
    // id==='lg-rule-list' to call markVariantDirty() (not the generic
    // markDirty()) — so the event must be dispatched with #lg-rule-list AS
    // (or a descendant of) its target, never on #lg-quote-editor itself
    // (which is an ANCESTOR of #lg-rule-list, not a descendant — the walk
    // would never match and silently fall through to the WRONG dirty flag).
    // writeRowEnvelope's own per-field fireChange() calls already bubble
    // correctly from inside #lg-rule-list; this helper exists for the
    // NON-field mutations (Delete's removeChild) that have no input/change
    // event of their own to bubble.
    var host = byId('lg-rule-list');
    if (host && host.dispatchEvent) {
      try {
        var ev = document.createEvent('Event');
        ev.initEvent('input', true, true);
        host.dispatchEvent(ev);
      } catch (e) { /* best-effort */ }
    }
  }

  function readRow(index) {
    var row = rowAt(index);
    if (!row) { return null; }
    var typeEl = qs(row, '[data-rule-type]');
    var nameEl = qs(row, '[data-rule-name]');
    var statusEl = qs(row, '[data-rule-status]');
    var matchEl = qs(row, '[data-rule-match-mode]');
    var prioEl = qs(row, '[data-rule-priority]');
    var offerEl = qs(row, '[data-rule-target-offer]');
    var sectionEl = qs(row, '[data-rule-target-section]');
    var variantEl = qs(row, '[data-rule-target-variant]');
    var multEl = qs(row, '[data-rule-value-multiplier]');
    var urlEl = qs(row, '[data-rule-redirect-url]');
    var allowEl = qs(row, '[data-rule-allowlisted]');
    var pctEl = qs(row, '[data-rule-redirect-pct]');
    var condEl = qs(row, '[data-rule-conditions]');
    var condRows = [];
    if (condEl && condEl.value && window.lgRulesBuilder) {
      var parsed = window.lgRulesBuilder.parseConditions(condEl.value);
      if (parsed.ok) { condRows = parsed.rows; }
    }
    return {
      row: row,
      rule_type: typeEl ? typeEl.value : 'eligibility',
      rule_name: nameEl ? nameEl.value : '',
      status: statusEl ? statusEl.value : 'active',
      match_mode: matchEl ? matchEl.value : 'all',
      priority: prioEl && prioEl.value ? Number(prioEl.value) : 100,
      target_offer_id: offerEl ? offerEl.value : '',
      target_section_id: sectionEl ? sectionEl.value : '',
      target_variant_public_id: variantEl ? variantEl.value : '',
      value_multiplier: multEl ? multEl.value : '',
      redirect_url: urlEl ? urlEl.value : '',
      redirect_url_allowlisted: allowEl ? allowEl.checked : false,
      redirect_pct: pctEl ? pctEl.value : '',
      condRows: condRows,
      condEl: condEl
    };
  }

  function fireChange(el2) {
    if (!el2) { return; }
    try {
      var ev = document.createEvent('Event');
      ev.initEvent('input', true, true);
      el2.dispatchEvent(ev);
      var ev2 = document.createEvent('Event');
      ev2.initEvent('change', true, true);
      el2.dispatchEvent(ev2);
    } catch (e) { /* older engines: value already set */ }
  }

  function writeRowEnvelope(index, fields) {
    var row = rowAt(index);
    if (!row) { return; }
    var map = {
      '[data-rule-type]': fields.rule_type,
      '[data-rule-name]': fields.rule_name,
      '[data-rule-status]': fields.status,
      '[data-rule-match-mode]': fields.match_mode,
      '[data-rule-priority]': String(fields.priority),
      '[data-rule-target-offer]': fields.target_offer_id,
      '[data-rule-target-section]': fields.target_section_id,
      '[data-rule-target-variant]': fields.target_variant_public_id,
      '[data-rule-value-multiplier]': fields.value_multiplier,
      '[data-rule-redirect-url]': fields.redirect_url,
      '[data-rule-redirect-pct]': fields.redirect_pct
    };
    var sel;
    for (sel in map) {
      if (Object.prototype.hasOwnProperty.call(map, sel)) {
        var target = qs(row, sel);
        if (target) { target.value = map[sel]; fireChange(target); }
      }
    }
    var allowEl = qs(row, '[data-rule-allowlisted]');
    if (allowEl) { allowEl.checked = !!fields.redirect_url_allowlisted; fireChange(allowEl); }
    var enabledEl = qs(row, '[data-rule-enabled]');
    if (enabledEl) { enabledEl.checked = fields.status === 'active'; fireChange(enabledEl); }
    markDirty();
  }

  // Re-derives the checkpoint from the row's CURRENT conditions carrier and
  // re-renders that one <tr>'s visible cells from the row's hidden carriers —
  // the table stays a pure projection of the SAME hidden state collectRules()
  // reads, never a second source of truth.
  function refreshTableRow(index) {
    var read = readRow(index);
    var tr = qs(byId('lg-rules-table-body'), '[data-rules-table-row][data-row-index="' + index + '"]');
    if (!read || !tr) { return; }
    var checkpoint = read.rule_type === 'route_funnel_variant' ? deriveCheckpoint(read.condRows) : null;
    var priorityCell = qs(tr, '[data-row-priority]');
    if (priorityCell) { priorityCell.textContent = String(read.priority); }
    var nameCell = qs(tr, '[data-row-name]');
    if (nameCell) { nameCell.textContent = read.rule_name && read.rule_name.replace(/^\\s+|\\s+$/g, '') !== '' ? read.rule_name : '(unnamed rule)'; }
    var cpCell = qs(tr, '[data-row-checkpoint]');
    if (cpCell) { cpCell.textContent = checkpointLabel(read.rule_type, checkpoint); }
    var typeLabels = {
      redirect_direct_offer: 'Redirect to offer', eligibility: 'Eligibility',
      disqualification: 'Disqualification', auction_entry: 'Auction entry'
    };
    var typeCell = qs(tr, '[data-row-type]');
    if (typeCell) { typeCell.textContent = typeLabels[read.rule_type] || read.rule_type; }
    var statusCell = qs(tr, '[data-row-status-cell]');
    if (statusCell) {
      var pill = qs(statusCell, '[data-row-status-pill]');
      if (pill) {
        pill.textContent = read.status === 'active' ? 'Active' : 'Disabled';
        pill.className = 'lg-status-pill lg-status-' + read.status;
      }
    }
    var toggleBtn = qs(tr, '[data-rule-toggle-status]');
    if (toggleBtn) { toggleBtn.textContent = read.status === 'active' ? 'Disable' : 'Enable'; }
  }

  function sortTable() {
    var tbody = byId('lg-rules-table-body');
    if (!tbody) { return; }
    var rows = [];
    var trs = tbody.querySelectorAll('[data-rules-table-row]');
    var k;
    for (k = 0; k < trs.length; k++) { rows.push(trs[k]); }
    rows.sort(function (a, b) {
      var pa = Number(qs(a, '[data-row-priority]').textContent) || 0;
      var pb = Number(qs(b, '[data-row-priority]').textContent) || 0;
      return pa - pb;
    });
    for (k = 0; k < rows.length; k++) { tbody.appendChild(rows[k]); }
  }

  // ---- action panel visibility ----------------------------------------------

  function showActionPanel(ruleType) {
    var panels = qsa(byId('lg-rule-action-panels'), '[data-action-for]');
    var k;
    for (k = 0; k < panels.length; k++) {
      if (panels[k].getAttribute('data-action-for') === ruleType) { panels[k].className = 'lg-rule-action-panel lg-action-active'; }
      else { panels[k].className = 'lg-rule-action-panel'; }
    }
  }

  // ---- modal lifecycle -------------------------------------------------------

  var modal = byId('lg-rule-modal');
  var nameInput = byId('lg-modal-rule-name');
  var checkpointDisplay = byId('lg-modal-checkpoint');
  var priorityInput = byId('lg-modal-priority');
  var typeSelect = byId('lg-modal-rule-type');
  var matchSelect = byId('lg-modal-match-mode');
  var statusSelect = byId('lg-modal-status');
  var conditionsMount = byId('lg-modal-conditions-mount');
  var errorEl = byId('lg-modal-error');
  var saveBtn = byId('lg-modal-save');
  var cancelBtn = byId('lg-modal-cancel');
  var deleteBtn = byId('lg-modal-delete');
  var editingIndex = -1;
  var mountedConditions = null;

  function showError(msg) {
    if (!errorEl) { return; }
    if (!msg) { errorEl.className = 'alert alert-error lg-hidden'; errorEl.textContent = ''; return; }
    errorEl.className = 'alert alert-error';
    errorEl.textContent = msg;
  }

  function clearConditionsMount() {
    if (!conditionsMount) { return; }
    while (conditionsMount.firstChild) { conditionsMount.removeChild(conditionsMount.firstChild); }
  }

  function updateCheckpointDisplay() {
    if (!checkpointDisplay || !mountedConditions) { return; }
    var ruleType = typeSelect ? typeSelect.value : 'eligibility';
    var rows = mountedConditions.state ? mountedConditions.state.rows : [];
    var cp = ruleType === 'route_funnel_variant' ? deriveCheckpoint(rows) : null;
    checkpointDisplay.textContent = checkpointLabel(ruleType, cp);
  }

  function openModalFor(index, isNew) {
    editingIndex = index;
    showError('');
    var read = isNew ? null : readRow(index);
    var ruleType = read ? read.rule_type : 'eligibility';
    if (nameInput) { nameInput.value = read ? read.rule_name : ''; }
    if (priorityInput) { priorityInput.value = read ? String(read.priority) : '100'; }
    if (typeSelect) { typeSelect.value = ruleType; }
    if (matchSelect) { matchSelect.value = read ? read.match_mode : 'all'; }
    if (statusSelect) { statusSelect.value = read ? read.status : 'active'; }
    var offerSel = byId('lg-rule-action-panels') ? qs(byId('lg-rule-action-panels'), '[data-modal-target-offer]') : null;
    if (offerSel) { offerSel.value = read ? read.target_offer_id : ''; }
    var sectionSkipSel = qs(byId('lg-rule-action-panels'), '[data-modal-target-section]');
    var sectionShowSel = qs(byId('lg-rule-action-panels'), '[data-modal-target-section-show]');
    if (sectionSkipSel) { sectionSkipSel.value = read && ruleType === 'skip_section' ? read.target_section_id : ''; }
    if (sectionShowSel) { sectionShowSel.value = read && ruleType === 'show_section' ? read.target_section_id : ''; }
    var variantSel = qs(byId('lg-rule-action-panels'), '[data-modal-target-variant]');
    if (variantSel) { variantSel.value = read ? read.target_variant_public_id : ''; }
    var multInput = qs(byId('lg-rule-action-panels'), '[data-modal-value-multiplier]');
    if (multInput) { multInput.value = read && read.value_multiplier ? String(read.value_multiplier) : ''; }
    var urlInput = qs(byId('lg-rule-action-panels'), '[data-modal-redirect-url]');
    if (urlInput) { urlInput.value = read ? read.redirect_url : ''; }
    var allowInput = qs(byId('lg-rule-action-panels'), '[data-modal-allowlisted]');
    if (allowInput) { allowInput.checked = read ? !!read.redirect_url_allowlisted : false; }
    var pctInput = qs(byId('lg-rule-action-panels'), '[data-modal-redirect-pct]');
    if (pctInput) { pctInput.value = read && read.redirect_pct !== '' && read.redirect_pct !== undefined && read.redirect_pct !== null ? String(read.redirect_pct) : ''; }
    showActionPanel(ruleType);

    clearConditionsMount();
    // The row PHYSICALLY exists in #lg-rule-list by the time this runs (the
    // "+ New rule" handler calls addNewRow() BEFORE openModalFor) — resolve
    // its REAL [data-rule-conditions] carrier directly (not via the 'read'
    // variable, which is null for isNew) so the mounted builder writes LIVE
    // into the actual row, never a throwaway hidden input inside the modal
    // that collectRules() would never read (the bug this replaces: a brand-
    // new rule's conditions used to vanish on save, forcing the checkpoint
    // display to fall back to "Entry").
    var targetRow = rowAt(index);
    var condEl = targetRow ? qs(targetRow, '[data-rule-conditions]') : null;
    var rawConditions = condEl ? condEl.value : '';
    mountedConditions = window.lgRulesBuilder.mount(conditionsMount, rawConditions, condEl, { fields: combinedFields });
    if (mountedConditions && mountedConditions.card) {
      mountedConditions.card.addEventListener('lg:rules-builder-change', updateCheckpointDisplay);
      mountedConditions.card.addEventListener('change', updateCheckpointDisplay);
    } else if (conditionsMount) {
      conditionsMount.addEventListener('input', updateCheckpointDisplay);
    }
    updateCheckpointDisplay();

    if (modal) { modal.hidden = false; modal.className = 'lg-modal-overlay'; }
    if (deleteBtn) { deleteBtn.style.display = isNew ? 'none' : ''; }
  }

  function closeModal() {
    if (modal) { modal.hidden = true; modal.className = 'lg-modal-overlay lg-hidden'; }
    editingIndex = -1;
    mountedConditions = null;
  }

  function addNewRow() {
    var tpl = byId('lg-rule-row-tpl');
    var list = ruleListEl();
    if (!tpl || !list || !tpl.content) { return -1; }
    var frag = document.importNode(tpl.content, true);
    var row = frag.querySelector('[data-rule-row]');
    if (!row) { return -1; }
    list.appendChild(row);
    var empty = list.querySelector('[data-empty-rules]');
    if (empty && empty.parentNode) { empty.parentNode.removeChild(empty); }
    return rowCount() - 1;
  }

  // Builds ONE <tr> via createElement/textContent only (no innerHTML — same
  // XSS discipline as RULES_BUILDER_SCRIPT above). refreshTableRow (called
  // right after, by every caller) fills in the real priority/name/checkpoint/
  // type/status text — this only lays out the skeleton + action buttons.
  function addTableRow(index) {
    var tbody = byId('lg-rules-table-body');
    if (!tbody) { return; }
    var placeholder = tbody.querySelector('[data-empty-rules-table]');
    if (placeholder && placeholder.parentNode) { placeholder.parentNode.removeChild(placeholder); }
    var tr = document.createElement('tr');
    tr.setAttribute('data-rules-table-row', '');
    tr.setAttribute('data-row-index', String(index));
    var cellAttrs = ['data-row-priority', 'data-row-name', 'data-row-checkpoint', 'data-row-type'];
    var k;
    for (k = 0; k < cellAttrs.length; k++) {
      var td = document.createElement('td');
      td.setAttribute(cellAttrs[k], '');
      tr.appendChild(td);
    }
    var statusTd = document.createElement('td');
    statusTd.setAttribute('data-row-status-cell', '');
    var pill = el('span', 'lg-status-pill lg-status-active');
    pill.setAttribute('data-row-status-pill', '');
    pill.textContent = 'Active';
    statusTd.appendChild(pill);
    tr.appendChild(statusTd);
    var actionsTd = document.createElement('td');
    actionsTd.className = 'lg-rules-table-actions';
    function actionBtn(attr, cls, label) {
      var b = el('button', cls);
      b.type = 'button';
      b.setAttribute(attr, '');
      b.setAttribute('data-row-index', String(index));
      b.textContent = label;
      return b;
    }
    actionsTd.appendChild(actionBtn('data-rule-edit', 'btn btn-sm btn-outline', 'Edit'));
    actionsTd.appendChild(document.createTextNode(' '));
    actionsTd.appendChild(actionBtn('data-rule-duplicate', 'btn btn-sm btn-outline', 'Duplicate'));
    actionsTd.appendChild(document.createTextNode(' '));
    actionsTd.appendChild(actionBtn('data-rule-toggle-status', 'btn btn-sm btn-outline', 'Disable'));
    actionsTd.appendChild(document.createTextNode(' '));
    actionsTd.appendChild(actionBtn('data-rule-delete', 'btn btn-sm btn-danger', 'Delete'));
    tr.appendChild(actionsTd);
    tbody.appendChild(tr);
  }

  function reindexTable() {
    var trs = qsa(byId('lg-rules-table-body'), '[data-rules-table-row]');
    var k, j;
    for (k = 0; k < trs.length; k++) {
      trs[k].setAttribute('data-row-index', String(k));
      var btnSels = ['[data-rule-edit]', '[data-rule-duplicate]', '[data-rule-toggle-status]', '[data-rule-delete]'];
      for (j = 0; j < btnSels.length; j++) {
        var btn = qs(trs[k], btnSels[j]);
        if (btn) { btn.setAttribute('data-row-index', String(k)); }
      }
    }
  }

  if (saveBtn) {
    saveBtn.addEventListener('click', function () {
      if (editingIndex < 0) { return; }
      var priorityVal = priorityInput ? parseInt(priorityInput.value, 10) : 100;
      if (!isFinite(priorityVal) || priorityVal < 1 || priorityVal > 100) {
        showError('Priority must be a number between 1 and 100.');
        return;
      }
      var ruleType = typeSelect ? typeSelect.value : 'eligibility';
      var variantSel = qs(byId('lg-rule-action-panels'), '[data-modal-target-variant]');
      if (ruleType === 'route_funnel_variant' && (!variantSel || variantSel.value === '')) {
        showError('Pick which funnel variant this rule routes to.');
        return;
      }
      var offerSel = qs(byId('lg-rule-action-panels'), '[data-modal-target-offer]');
      var sectionSkipSel = qs(byId('lg-rule-action-panels'), '[data-modal-target-section]');
      var sectionShowSel = qs(byId('lg-rule-action-panels'), '[data-modal-target-section-show]');
      var multInput = qs(byId('lg-rule-action-panels'), '[data-modal-value-multiplier]');
      var urlInput = qs(byId('lg-rule-action-panels'), '[data-modal-redirect-url]');
      var allowInput = qs(byId('lg-rule-action-panels'), '[data-modal-allowlisted]');
      var pctInput = qs(byId('lg-rule-action-panels'), '[data-modal-redirect-pct]');
      var targetSectionId = ruleType === 'skip_section' ? (sectionSkipSel ? sectionSkipSel.value : '')
        : ruleType === 'show_section' ? (sectionShowSel ? sectionShowSel.value : '') : '';
      var redirectPctVal = '';
      if (ruleType === 'redirect_direct_offer' && pctInput && pctInput.value !== '') {
        var pctNum = parseFloat(pctInput.value);
        if (!isFinite(pctNum) || pctNum < 0 || pctNum > 100) {
          showError('Redirect % must be a number between 0 and 100.');
          return;
        }
        redirectPctVal = String(pctNum);
      }
      writeRowEnvelope(editingIndex, {
        rule_type: ruleType,
        rule_name: nameInput ? nameInput.value : '',
        status: statusSelect ? statusSelect.value : 'active',
        match_mode: matchSelect ? matchSelect.value : 'all',
        priority: priorityVal,
        target_offer_id: ruleType === 'redirect_direct_offer' && offerSel ? offerSel.value : '',
        target_section_id: targetSectionId,
        target_variant_public_id: ruleType === 'route_funnel_variant' && variantSel ? variantSel.value : '',
        value_multiplier: ruleType === 'route_funnel_variant' && multInput ? multInput.value : '',
        redirect_url: ruleType === 'redirect_direct_offer' && urlInput ? urlInput.value : '',
        redirect_url_allowlisted: ruleType === 'redirect_direct_offer' && allowInput ? allowInput.checked : false,
        redirect_pct: redirectPctVal
      });
      refreshTableRow(editingIndex);
      sortTable();
      closeModal();
    });
  }
  if (cancelBtn) { cancelBtn.addEventListener('click', closeModal); }
  if (typeSelect) { typeSelect.addEventListener('change', function () { showActionPanel(typeSelect.value); updateCheckpointDisplay(); }); }

  if (deleteBtn) {
    deleteBtn.addEventListener('click', function () {
      if (editingIndex < 0) { return; }
      var row = rowAt(editingIndex);
      if (row && row.parentNode) { row.parentNode.removeChild(row); }
      var tr = qs(byId('lg-rules-table-body'), '[data-rules-table-row][data-row-index="' + editingIndex + '"]');
      if (tr && tr.parentNode) { tr.parentNode.removeChild(tr); }
      reindexTable();
      markDirty();
      closeModal();
    });
  }

  var newBtn = byId('lg-rule-new');
  if (newBtn) {
    newBtn.addEventListener('click', function () {
      var index = addNewRow();
      if (index < 0) { return; }
      addTableRow(index);
      refreshTableRow(index);
      openModalFor(index, true);
    });
  }

  root.addEventListener('click', function (ev) {
    var el2 = ev.target;
    while (el2 && el2.getAttribute) {
      if (el2.hasAttribute('data-rule-edit')) {
        openModalFor(Number(el2.getAttribute('data-row-index')), false);
        return;
      }
      if (el2.hasAttribute('data-rule-toggle-status')) {
        var idx = Number(el2.getAttribute('data-row-index'));
        var current = readRow(idx);
        if (current) {
          var next = current.status === 'active' ? 'disabled' : 'active';
          writeRowEnvelope(idx, {
            rule_type: current.rule_type, rule_name: current.rule_name, status: next,
            match_mode: current.match_mode, priority: current.priority, target_offer_id: current.target_offer_id,
            target_section_id: current.target_section_id, target_variant_public_id: current.target_variant_public_id,
            value_multiplier: current.value_multiplier, redirect_url: current.redirect_url,
            redirect_url_allowlisted: current.redirect_url_allowlisted, redirect_pct: current.redirect_pct
          });
          refreshTableRow(idx);
        }
        return;
      }
      if (el2.hasAttribute('data-rule-delete')) {
        var delIdx = Number(el2.getAttribute('data-row-index'));
        var delRow = rowAt(delIdx);
        if (delRow && delRow.parentNode) { delRow.parentNode.removeChild(delRow); }
        var delTr = qs(byId('lg-rules-table-body'), '[data-rules-table-row][data-row-index="' + delIdx + '"]');
        if (delTr && delTr.parentNode) { delTr.parentNode.removeChild(delTr); }
        reindexTable();
        markDirty();
        return;
      }
      if (el2.hasAttribute('data-rule-duplicate')) {
        var dupIdx = Number(el2.getAttribute('data-row-index'));
        var dupPublicId = el2.getAttribute('data-rule-public-id') || '';
        var source = readRow(dupIdx);
        if (!source) { return; }
        var newIndex = addNewRow();
        if (newIndex < 0) { return; }
        var newRuleName = source.rule_name && source.rule_name.replace(/^\\s+|\\s+$/g, '') !== '' ? (source.rule_name + ' (copy)') : source.rule_name;
        writeRowEnvelope(newIndex, {
          rule_type: source.rule_type, rule_name: newRuleName, status: source.status, match_mode: source.match_mode,
          priority: source.priority, target_offer_id: source.target_offer_id, target_section_id: source.target_section_id,
          target_variant_public_id: source.target_variant_public_id, value_multiplier: source.value_multiplier,
          redirect_url: source.redirect_url, redirect_url_allowlisted: source.redirect_url_allowlisted,
          redirect_pct: source.redirect_pct
        });
        var newCondEl = rowAt(newIndex) ? qs(rowAt(newIndex), '[data-rule-conditions]') : null;
        if (newCondEl && source.condEl) { newCondEl.value = source.condEl.value; fireChange(newCondEl); }
        addTableRow(newIndex);
        refreshTableRow(newIndex);
        markDirty();
        // Best-effort server-side instant clone too (matches the duplicateSection/
        // duplicateOffer precedent — the client-only clone above is what actually
        // ships on the next Save regardless of whether this call succeeds).
        var hostEl = byId('lg-quote-editor');
        var variantPublicId = hostEl ? hostEl.getAttribute('data-variant-public-id') : '';
        if (dupPublicId && variantPublicId && typeof fetch === 'function') {
          fetch('/api/admin/leadgen/variants/' + variantPublicId + '/rules/' + dupPublicId + '/duplicate', { method: 'POST' }).then(function () {}, function () {});
        }
        return;
      }
      el2 = el2.parentNode;
    }
  });
})();
`;
