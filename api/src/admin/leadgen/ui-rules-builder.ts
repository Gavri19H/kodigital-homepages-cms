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

// R2 P7 (register ADJ-N8, owner A.1 #11C "the rules you build are using
// jargon") — the VALUE side of a condition sentence. A choice question stores
// a slug (`excellent_rvw7q3`); the operator authored a LABEL ("Excellent").
// Every sentence surface below resolves the stored value through this map so
// the storage slug never reaches an operator sentence (§12.4 "raw storage keys
// never surface"). `value` is stringified at collection time because a stored
// choice value may be string | number | boolean (LeadgenChoice).
export interface RulesBuilderFieldChoice {
  value: string;
  label: string;
}

export interface RulesBuilderField {
  internal_field: string;
  label: string;
  // OPTIONAL and additive: a field with no authored choices (free text,
  // number, UTM, custom) carries none and renders its value verbatim.
  choices?: RulesBuilderFieldChoice[];
}

export interface RulesBuilderOffer {
  public_id: string;
  name: string;
}

// ADJ-N8 value-side resolution, shared by EVERY sentence surface (the SSR
// rules-builder card, the SSR quote rules-rail card, and the two ES5 islands
// that mirror them 1:1).
//
//   1. the stored value matches a choice with a non-empty label → the LABEL;
//   2. the field HAS choices but the value matches none (a removed/renamed
//      answer) → the token humanized ("excellent_rvw7q3" → "Excellent
//      rvw7q3"), so a stale rule still reads as words, never as a bare id;
//   3. the field has NO choices → the stored string VERBATIM. For free-text /
//      UTM / number conditions the stored string IS what the rule matches, and
//      prettifying it (`google_ads` → "Google ads") would misstate the rule.
export function humanizeChoiceToken(token: string): string {
  const spaced = token.replace(/[_-]+/g, " ").trim();
  if (spaced === "") return token;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function resolveChoiceValueText(
  choices: readonly RulesBuilderFieldChoice[] | undefined,
  value: RulesBuilderPrimitive | undefined,
): string {
  const raw = value === undefined || value === null ? "" : String(value);
  if (choices === undefined || choices.length === 0) return raw;
  for (const c of choices) {
    if (c.value === raw && c.label !== "") return c.label;
  }
  return humanizeChoiceToken(raw);
}

function choicesOfField(
  fields: readonly RulesBuilderField[],
  field: string,
): RulesBuilderFieldChoice[] | undefined {
  for (const f of fields) if (f.internal_field === field) return f.choices;
  return undefined;
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

// ADJ-N8: `valueOf` resolves the STORED value to the operator's own words for
// the row's field. Optional so existing callers (and the frozen exported
// conditionsSentence signature) keep working unchanged.
type RulesBuilderValueResolver = (field: string, v: RulesBuilderPrimitive | undefined) => string;

function fmtValue(
  v: RulesBuilderPrimitive | undefined,
  field?: string,
  valueOf?: RulesBuilderValueResolver,
): string {
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number" && valueOf === undefined) return String(v);
  if (v === undefined || v === "") return '""';
  if (valueOf !== undefined && field !== undefined) {
    const resolved = valueOf(field, v);
    if (typeof v === "number" && resolved === String(v)) return resolved;
    return '"' + resolved + '"';
  }
  return '"' + v + '"';
}

function fmtList(
  chips: readonly RulesBuilderChip[] | undefined,
  field?: string,
  valueOf?: RulesBuilderValueResolver,
): string {
  if (!chips || chips.length === 0) return "(no values yet)";
  return chips.map((c) => fmtValue(c.value, field, valueOf)).join(", ");
}

function rowSentence(
  row: RulesBuilderRow,
  labelOf: (field: string) => string,
  valueOf?: RulesBuilderValueResolver,
): string {
  const label = row.field === "" ? "(choose a field)" : labelOf(row.field);
  const f = row.field;
  switch (row.op) {
    case "eq":
      return label + " is " + fmtValue(row.value, f, valueOf);
    case "neq":
      return label + " is not " + fmtValue(row.value, f, valueOf);
    case "gt":
      return label + " is greater than " + fmtValue(row.value, f, valueOf);
    case "lt":
      return label + " is less than " + fmtValue(row.value, f, valueOf);
    case "gte":
      return label + " is at least " + fmtValue(row.value, f, valueOf);
    case "lte":
      return label + " is at most " + fmtValue(row.value, f, valueOf);
    case "range":
      return label + " is between " + String(row.from ?? 0) + " and " + String(row.to ?? 0);
    case "in":
      return label + " is any of " + fmtList(row.values, f, valueOf);
    case "not_in":
      return label + " is none of " + fmtList(row.values, f, valueOf);
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
  valueOf?: RulesBuilderValueResolver,
): string {
  if (rows.length === 0) return "Always matches — no conditions.";
  const parts = clustersOf(normalizeClusterOrder(rows)).map((cluster) => {
    const s = cluster.rows.map((r) => rowSentence(r, labelOf, valueOf)).join(" or ");
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

// ADJ-N8 twin of labelResolver for the VALUE side.
function valueResolver(fields: readonly RulesBuilderField[]): RulesBuilderValueResolver {
  return (field, v) => resolveChoiceValueText(choicesOfField(fields, field), v);
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
  const sentence = conditionsSentence(rows, labelResolver(fields), valueResolver(fields));

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
    const choices = sanitizeFieldChoices(f["choices"]);
    out.push(choices === undefined ? { internal_field: internal, label } : { internal_field: internal, label, choices });
  }
  return out;
}

// ADJ-N8 — the value→label map, defensively narrowed (the host may thread any
// shape). Stringifies the stored value so string|number|boolean choices all
// compare against the row's serialized value the same way.
function sanitizeFieldChoices(raw: unknown): RulesBuilderFieldChoice[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: RulesBuilderFieldChoice[] = [];
  for (const c of raw) {
    if (!isRecord(c)) continue;
    const v = c["value"];
    if (typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean") continue;
    const label = c["label"];
    if (typeof label !== "string" || label.trim() === "") continue;
    out.push({ value: String(v), label: label.trim() });
  }
  return out.length > 0 ? out : undefined;
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
// ADJ-N8 widened it ADDITIVELY only: `choices` is optional, so every existing
// caller type-checks and renders unchanged.
export function renderRulesBuilderPanel(data: {
  rules: unknown[];
  fields: { internal_field: string; label: string; choices?: RulesBuilderFieldChoice[] }[];
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

  // ADJ-N8 mirror of resolveChoiceValueText/valueResolver: label → humanized
  // token (choice field only) → verbatim (no choices).
  function humanizeToken(token) {
    var spaced = String(token).replace(/[_-]+/g, ' ').replace(/^\\s+|\\s+$/g, '');
    if (spaced === '') { return String(token); }
    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
  }
  function makeValueOf(fieldsArg) {
    return function (field, v) {
      var raw = (v === undefined || v === null) ? '' : String(v);
      var i, j, choices;
      for (i = 0; i < fieldsArg.length; i++) {
        if (fieldsArg[i].internal_field !== field) { continue; }
        choices = isArr(fieldsArg[i].choices) ? fieldsArg[i].choices : null;
        if (!choices || choices.length === 0) { return raw; }
        for (j = 0; j < choices.length; j++) {
          if (String(choices[j].value) === raw && choices[j].label) { return String(choices[j].label); }
        }
        return humanizeToken(raw);
      }
      return raw;
    };
  }
  function fmtValue(v, field, valueOf) {
    if (typeof v === 'boolean') { return v ? 'Yes' : 'No'; }
    if (typeof v === 'number' && !valueOf) { return String(v); }
    if (v === undefined || v === '') { return '""'; }
    if (valueOf && field !== undefined) {
      var resolved = valueOf(field, v);
      if (typeof v === 'number' && resolved === String(v)) { return resolved; }
      return '"' + resolved + '"';
    }
    return '"' + v + '"';
  }
  function fmtList(chips, field, valueOf) {
    if (!chips || chips.length === 0) { return '(no values yet)'; }
    var parts = [];
    var i;
    for (i = 0; i < chips.length; i++) { parts.push(fmtValue(chips[i].value, field, valueOf)); }
    return parts.join(', ');
  }
  function rowSentence(row, labelOf, valueOf) {
    var label = row.field === '' ? '(choose a field)' : labelOf(row.field);
    var f = row.field;
    if (row.op === 'eq') { return label + ' is ' + fmtValue(row.value, f, valueOf); }
    if (row.op === 'neq') { return label + ' is not ' + fmtValue(row.value, f, valueOf); }
    if (row.op === 'gt') { return label + ' is greater than ' + fmtValue(row.value, f, valueOf); }
    if (row.op === 'lt') { return label + ' is less than ' + fmtValue(row.value, f, valueOf); }
    if (row.op === 'gte') { return label + ' is at least ' + fmtValue(row.value, f, valueOf); }
    if (row.op === 'lte') { return label + ' is at most ' + fmtValue(row.value, f, valueOf); }
    if (row.op === 'range') { return label + ' is between ' + String(finiteNum(row.from) ? row.from : 0) + ' and ' + String(finiteNum(row.to) ? row.to : 0); }
    if (row.op === 'in') { return label + ' is any of ' + fmtList(row.values, f, valueOf); }
    if (row.op === 'not_in') { return label + ' is none of ' + fmtList(row.values, f, valueOf); }
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
  function cardSentence(rows, labelOf, valueOf) {
    if (rows.length === 0) { return 'Always matches \\u2014 no conditions.'; }
    var clusters = clustersOf(normalizeClusterOrder(rows));
    var parts = [];
    var i;
    for (i = 0; i < clusters.length; i++) {
      var inner = [];
      var j;
      for (j = 0; j < clusters[i].rows.length; j++) { inner.push(rowSentence(clusters[i].rows[j], labelOf, valueOf)); }
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
    if (state.sentenceEl) { state.sentenceEl.textContent = cardSentence(state.rows, state.labelOf, state.valueOf); }
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
    var valueOf = makeValueOf(fields);

    var i;
    for (i = 0; i < data.rules.length; i++) {
      var entry = data.rules[i];
      var card = root.querySelector('[data-lg-rb-card][data-rule-index="' + entry.index + '"]');
      if (!card) { continue; }
      var out = card.querySelector('[data-lg-rb-out]');
      if (entry.unsupported_reason) {
        // Raw fallback: SSR already carries the exact original bytes in the
        // hidden input + Advanced view; the island must never rewrite them.
        states.push({ index: entry.index, mode: 'raw', raw: entry.raw, rows: [], out: out, ext: null, mirror: false, labelOf: labelOf, valueOf: valueOf, fields: fields, card: card });
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
        valueOf: valueOf,
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
      var rawState = { index: -1, mode: 'raw', raw: rawString, rows: [], out: out, ext: null, mirror: false, labelOf: makeLabelOf(fields), valueOf: makeValueOf(fields), fields: fields, card: container };
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
      valueOf: makeValueOf(fields),
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
// ===========================================================================
// LeadGen Rework P3b (§8.2 RIGHT rail) — QUOTE-SCOPED routing-rules rail + modal
// ===========================================================================
// The funnel builder's 344px right rail (contract §8.2 RIGHT, pack regions
// 8.2-rules-rail / 8.2-rules-table / 8.2-rule-modal / 4.3-3-checkpoint /
// 4.3-9-actions / A-6-inline / A-11-validation / 8.2-rule-sentence). This is
// the QUOTE-SCOPED rules surface (leadgen_quote_routing_rules, M3) — a rule
// carries an ENTIRE action set (§4.3-9): Target funnel · Feed name · FB
// multiplier · Redirect % · Redirect target (offer / allowlisted URL). It is
// NOT the four auction-domain leadgen_funnel_rules types — those relocate to
// the Auction tab (ui-auctions.ts, §13-D5).
//
// REUSE (contract "reuse what's marked reusable"): the §21.4 ANY/ALL condition
// builder above (renderRulesBuilderPanel / window.lgRulesBuilder + RULES_
// BUILDER_SCRIPT) is MOUNTED for the modal's Conditions section — never
// re-implemented. The read-only derived Checkpoint uses the SAME pure
// deriveRuleCheckpoint (rule-checkpoint.ts) the runtime + server share, so the
// builder's "Entry / Shared page / In funnel X — page N / unreachable" label
// can never diverge from the runtime's plane partition (§4.3-3).
//
// MOUNT CONTRACT (consumed by the P3b board — quotes-tabs/funnel.ts renders it
// at the pack's 344px right-rail mount point):
//   renderQuoteRulesRail(data: QuoteRulesRailData) -> SSR HTML rooted at
//     #lg-qr-rail (carries data-quote-public-id), the card-per-rule list
//     #lg-qr-list, the "+ New rule" button, and the single modal DOM instance.
//   QUOTE_RULES_SCRIPT -> the strict-ES5 island (var/function only; no
//     arrows/const/let/template literals/backticks — layout.ts constraint,
//     asserted by the ES5 parse gate in the P3b rules-ui test). It CRUDs the
//     landed API (GET/POST /quotes/:id/routing-rules, PATCH/DELETE + duplicate
//     /routing-rules/:rule_id) and re-derives the checkpoint live.
//   The page that mounts this rail MUST also include RULES_BUILDER_SCRIPT (the
//   window.lgRulesBuilder condition builder) and QUOTE_RULES_SCRIPT.

import {
  deriveRuleCheckpoint,
  ENTRY_KNOWN_ROUTING_FIELDS,
  type RuleCheckpoint,
  type RuleCheckpointFunnel,
} from "../../leadgen/rule-checkpoint";

// ---------------------------------------------------------------------------
// Interface (FROZEN — quotes-tabs/funnel.ts builds exactly this)
// ---------------------------------------------------------------------------

// One funnel's per-page answer-field universe (board/display_order order),
// exactly the shape deriveRuleCheckpoint consumes (pages in position order).
export interface QuoteRulesRailFunnel {
  id: number;
  public_id: string;
  name: string;
  is_default: boolean;
  pages: { position: number; fields: string[] }[];
}

export interface QuoteRulesRailOffer {
  id: number;
  name: string;
}

export interface QuoteRulesRailAnswerField {
  internal_field: string;
  label: string;
  // ADJ-N8 — the question's authored choice labels, so a condition on a
  // choice/enum field reads "is Excellent", never "is excellent_rvw7q3".
  choices?: RulesBuilderFieldChoice[];
}

// A rule row in the API shape (quoteRoutingRuleRowToApi): conditions_json is a
// parsed object; redirect_url_allowlisted is a boolean.
export interface QuoteRulesRailRule {
  public_id: string;
  rule_name: string;
  priority: number;
  status: "active" | "disabled";
  match_mode: string | null;
  conditions_json: unknown;
  target_funnel_id: number | null;
  feed_name: string | null;
  value_multiplier: number | null;
  redirect_pct: number | null;
  target_offer_id: number | null;
  redirect_url: string | null;
  redirect_url_allowlisted: boolean;
}

export interface QuoteRulesRailData {
  quote_public_id: string;
  rules: QuoteRulesRailRule[];
  funnels: QuoteRulesRailFunnel[];
  default_funnel_id: number | null;
  shared_page_fields: string[];
  answer_fields: QuoteRulesRailAnswerField[];
  offers: QuoteRulesRailOffer[];
  feed_values: string[];
}

// The entry-known condition sources (§4.3-3a) as builder field options. Labels
// are the pack's (region 8.2-rule-conditions dropdown). OWNER 2026-09-01:
// utm_campaign used to be a documented ALIAS of utm_content at evaluation time
// — this dropdown offered "UTM Campaign" while the evaluator read the creative
// id. It is now its own captured landing param end to end. Kept in sync with
// ENTRY_KNOWN_ROUTING_FIELDS below.
export const QR_ENTRY_FIELD_OPTIONS: ReadonlyArray<QuoteRulesRailAnswerField> = [
  { internal_field: "utm_source", label: "UTM Source" },
  { internal_field: "utm_medium", label: "UTM Medium" },
  { internal_field: "utm_campaign", label: "UTM Campaign" },
  { internal_field: "utm_content", label: "UTM Content" },
  { internal_field: "device", label: "Device" },
  { internal_field: "os", label: "OS" },
  { internal_field: "state", label: "State" },
  { internal_field: "hour", label: "Hour" },
  { internal_field: "weekday", label: "Weekday" },
];

// Defensive: prove QR_ENTRY_FIELD_OPTIONS ⊆ the shared entry-known set (so the
// SSR checkpoint derivation and the picker can never drift).
for (const _opt of QR_ENTRY_FIELD_OPTIONS) {
  if (!ENTRY_KNOWN_ROUTING_FIELDS.has(_opt.internal_field)) {
    throw new Error(`QR_ENTRY_FIELD_OPTIONS drift: ${_opt.internal_field} not entry-known`);
  }
}

// ---------------------------------------------------------------------------
// Pure helpers shared by SSR (the ES5 island mirrors them 1:1)
// ---------------------------------------------------------------------------

// The field names a rule's §21.4 conditions reference (groups[].field).
function qrConditionFields(conditions: unknown): string[] {
  if (typeof conditions !== "object" || conditions === null) return [];
  const groups = (conditions as { groups?: unknown }).groups;
  if (!Array.isArray(groups)) return [];
  const out: string[] = [];
  for (const g of groups) {
    if (g !== null && typeof g === "object") {
      const f = (g as { field?: unknown }).field;
      if (typeof f === "string" && f.trim() !== "") out.push(f);
    }
  }
  return out;
}

// data.funnels -> the RuleCheckpointFunnel[] deriveRuleCheckpoint consumes.
function qrCheckpointFunnels(funnels: readonly QuoteRulesRailFunnel[]): RuleCheckpointFunnel[] {
  return funnels.map((f) => ({
    id: f.id,
    publicId: f.public_id,
    name: f.name,
    pages: f.pages.map((p) => ({ position: p.position, fields: new Set(p.fields) })),
  }));
}

// The read-only checkpoint label (§4.3-3, pack 4.3-3-checkpoint). Unreachable
// (§4.3-3c / A-6): the pure derivation returns no representative funnel, so the
// label reads "In a funnel" and the A-6 warning is shown alongside.
// N4 — the board's OWN numbering (quotes-tabs/funnel.ts renderBoardPageCard:
// "Page " + (index + 1), the page's ARRAY INDEX in this funnel's own pages)
// for the checkpoint's representative page — NEVER the raw `position` number
// verbatim. `position` is an opaque per-funnel key (dense 0-based today only
// because the caller recomputes it from that same pages array — ui-quotes.ts
// funnelPageFieldSets), so a funnel's own FIRST page carries position 0 and
// printing it raw read "page 0" where the board calls that same card "Page 1".
// Looking the page back up BY POSITION inside its funnel's own pages array
// (in board order) and using ITS INDEX + 1 agrees with the board regardless of
// whether `position` stays dense.
function qrPageOrdinal(cp: RuleCheckpoint, data: QuoteRulesRailData): number {
  const funnel = data.funnels.find((f) => f.name === cp.funnelName);
  const idx = funnel === undefined ? -1 : funnel.pages.findIndex((p) => p.position === cp.pagePosition);
  return (idx >= 0 ? idx : (cp.pagePosition ?? 0)) + 1;
}

function qrCheckpointLabel(cp: RuleCheckpoint, data: QuoteRulesRailData): string {
  if (cp.plane === "entry") return "Entry";
  if (cp.plane === "shared") return "Shared page";
  if (cp.unreachable === true) return "In a funnel";
  const name = cp.funnelName !== null && cp.funnelName !== undefined ? cp.funnelName : "a funnel";
  return "In funnel " + name + " — page " + String(qrPageOrdinal(cp, data));
}

function qrDeriveCheckpoint(rule: QuoteRulesRailRule, data: QuoteRulesRailData): RuleCheckpoint {
  return deriveRuleCheckpoint(
    qrConditionFields(rule.conditions_json),
    new Set(data.shared_page_fields),
    qrCheckpointFunnels(data.funnels),
  );
}

// Plain-language operator labels for the condition summary (mirrors the pack's
// operator vocabulary is/is not/greater than/less than/at least/at most).
const QR_OP_WORDS: Record<string, string> = {
  eq: "is",
  neq: "is not",
  gt: "greater than",
  lt: "less than",
  gte: "at least",
  lte: "at most",
  range: "between",
  in: "in",
  not_in: "not in",
};

function qrFieldLabel(field: string, data: QuoteRulesRailData): string {
  for (const e of QR_ENTRY_FIELD_OPTIONS) if (e.internal_field === field) return e.label;
  for (const a of data.answer_fields) if (a.internal_field === field) return a.label;
  // N3 (owner A.1 #11C "using jargon") — a condition field id that resolves to
  // no known label (the question was renamed/removed after the rule was
  // authored) used to print the raw internal id verbatim. Name what it is, in
  // the operator's own words, never the storage key (§12.4).
  return "(removed field)";
}

// ADJ-N8 — the rail's answer-field choice map for one field (the entry-known
// sources UTM/device/state/hour/… are free-form and carry none).
function qrFieldChoices(
  field: string,
  data: QuoteRulesRailData,
): RulesBuilderFieldChoice[] | undefined {
  for (const a of data.answer_fields) if (a.internal_field === field) return a.choices;
  return undefined;
}

function qrValueText(g: Record<string, unknown>, field: string, data: QuoteRulesRailData): string {
  if (g["op"] === "range") return String(g["from"] ?? "") + "–" + String(g["to"] ?? "");
  const choices = qrFieldChoices(field, data);
  if (g["op"] === "in" || g["op"] === "not_in") {
    const vals = Array.isArray(g["values"]) ? (g["values"] as unknown[]) : [];
    return vals.map((v) => resolveChoiceValueText(choices, v as RulesBuilderPrimitive)).join(", ");
  }
  const v = g["value"];
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (v === undefined || v === null) return "";
  return resolveChoiceValueText(choices, v as RulesBuilderPrimitive);
}

// Condition summary chips (pack rule-field · Conditions). Each group -> one
// chip "<Field> <op> <value>"; joined by the rule's match word (all -> "and",
// any -> "or"). Empty conditions -> "Always".
function qrConditionChips(rule: QuoteRulesRailRule, data: QuoteRulesRailData): string[] {
  const conditions = rule.conditions_json;
  if (typeof conditions !== "object" || conditions === null) return ["Always"];
  const groups = (conditions as { groups?: unknown }).groups;
  if (!Array.isArray(groups) || groups.length === 0) return ["Always"];
  const chips: string[] = [];
  for (const raw of groups) {
    if (raw === null || typeof raw !== "object") continue;
    const g = raw as Record<string, unknown>;
    const field = typeof g["field"] === "string" ? (g["field"] as string) : "";
    const op = typeof g["op"] === "string" ? (g["op"] as string) : "eq";
    const word = QR_OP_WORDS[op] ?? op;
    chips.push(qrFieldLabel(field, data) + " " + word + " " + qrValueText(g, field, data));
  }
  return chips.length > 0 ? chips : ["Always"];
}

function qrFunnelName(id: number | null, data: QuoteRulesRailData): string {
  if (id === null) return "";
  for (const f of data.funnels) if (f.id === id) return f.name;
  return "";
}

function qrOfferName(id: number | null, data: QuoteRulesRailData): string {
  if (id === null) return "";
  for (const o of data.offers) if (o.id === id) return o.name;
  return "";
}

// Action summary chips (pack rule-field · Actions). Only present actions.
function qrActionChips(rule: QuoteRulesRailRule, data: QuoteRulesRailData): string[] {
  const chips: string[] = [];
  if (rule.target_funnel_id !== null) chips.push("→ " + qrFunnelName(rule.target_funnel_id, data));
  if (rule.feed_name !== null && rule.feed_name !== "") chips.push("Feed " + rule.feed_name);
  if (rule.value_multiplier !== null) chips.push("×" + String(rule.value_multiplier));
  const hasTarget = rule.target_offer_id !== null || (rule.redirect_url !== null && rule.redirect_url !== "");
  if (rule.redirect_pct !== null || hasTarget) {
    const pct = rule.redirect_pct !== null ? String(rule.redirect_pct) : "0";
    const tgt =
      rule.target_offer_id !== null
        ? qrOfferName(rule.target_offer_id, data)
        : rule.redirect_url !== null && rule.redirect_url !== ""
          ? rule.redirect_url
          : "";
    chips.push("Redirect " + pct + "%" + (tgt !== "" ? " → " + tgt : ""));
  }
  return chips;
}

// ---------------------------------------------------------------------------
// SSR — the rail + one card per rule (priority ascending; pack 8.2-rules-table)
// ---------------------------------------------------------------------------

function qrMatchWord(rule: QuoteRulesRailRule): string {
  return rule.match_mode === "any" ? "any" : "all";
}

function renderQuoteRuleCard(rule: QuoteRulesRailRule, data: QuoteRulesRailData): string {
  const cp = qrDeriveCheckpoint(rule, data);
  const cpLabel = qrCheckpointLabel(cp, data);
  const unreachable = cp.unreachable === true;
  const isDisabled = rule.status === "disabled";
  const name = rule.rule_name !== null && rule.rule_name.trim() !== "" ? rule.rule_name : "(unnamed rule)";
  const condChips = qrConditionChips(rule, data);
  const actChips = qrActionChips(rule, data);
  const joinWord = qrMatchWord(rule) === "any" ? "or" : "and";

  const condHtml = condChips
    .map((chip, i) => {
      const sep = i > 0 ? `<span class="lg-qr-chip join">${escapeHtml(joinWord)}</span>` : "";
      return sep + `<span class="lg-qr-chip">${escapeHtml(chip)}</span>`;
    })
    .join("");
  const actHtml =
    actChips.length > 0
      ? actChips.map((chip) => `<span class="lg-qr-chip act">${escapeHtml(chip)}</span>`).join("")
      : `<span class="lg-qr-chip">No actions yet</span>`;

  const a6 = unreachable
    ? `<div class="lg-qr-callout warn" role="note" data-pin="A-6-inline"><span class="lg-qr-warnico" aria-hidden="true">⚠</span><span>This rule can never apply before a visitor enters a funnel that asks these questions.</span></div>`
    : "";

  return (
    `<div class="lg-qr-card${isDisabled ? " disabled" : ""}"${isDisabled ? ' data-pin="8.2-rule-disabled"' : ""} data-qr-card data-rule-public-id="${escapeHtml(rule.public_id)}" data-rule-priority="${escapeHtml(String(rule.priority))}">` +
    `<div class="lg-qr-top">` +
    `<span class="lg-qr-prio" data-qr-prio>${escapeHtml(String(rule.priority))}</span>` +
    `<span class="lg-qr-name" data-qr-name title="${escapeHtml(name)}">${escapeHtml(name)}</span>` +
    `<span class="lg-qr-status ${isDisabled ? "disabled" : "active"}" data-qr-status><span class="lg-qr-dot"></span>${isDisabled ? "Disabled" : "Active"}</span>` +
    `</div>` +
    `<div class="lg-qr-ckpt" data-qr-ckpt><span class="lg-qr-ckico" aria-hidden="true">◷</span><span data-qr-ckpt-text>${escapeHtml(cpLabel)}</span></div>` +
    `<div class="lg-qr-field"><div class="lg-qr-flab">Conditions · ${escapeHtml(qrMatchWord(rule))}</div><div class="lg-qr-summ" data-qr-cond-summ>${condHtml}</div></div>` +
    `<div class="lg-qr-field"><div class="lg-qr-flab">Actions</div><div class="lg-qr-summ" data-qr-act-summ>${actHtml}</div></div>` +
    a6 +
    `<div class="lg-qr-foot">` +
    `<span class="lg-qr-act" role="button" tabindex="0" data-qr-edit>✎ Edit</span>` +
    `<span class="lg-qr-act" role="button" tabindex="0" data-qr-duplicate>⎘ Duplicate</span>` +
    `<span class="lg-qr-toggle-wrap"><span class="lg-qr-swi${isDisabled ? "" : " on"}" role="switch" tabindex="0" aria-checked="${isDisabled ? "false" : "true"}" aria-label="Enabled" data-qr-toggle><span class="lg-qr-knob"></span></span></span>` +
    `<span class="lg-qr-act del" role="button" tabindex="0" data-qr-delete aria-label="Delete rule">✖</span>` +
    `</div>` +
    `</div>`
  );
}

function qrSortedRules(rules: readonly QuoteRulesRailRule[]): QuoteRulesRailRule[] {
  return [...rules].sort((a, b) => a.priority - b.priority);
}

// The five action rows (pack 4.3-9-actions) — ALL rendered, each toggleable,
// ≥1 required (A-11). Populated per-rule by the island.
function renderQuoteRuleActions(data: QuoteRulesRailData): string {
  const funnelOpts = data.funnels
    .map((f) => `<option value="${escapeHtml(f.public_id)}" data-funnel-id="${f.id}">${escapeHtml(f.name)}${f.is_default ? " (Default)" : ""}</option>`)
    .join("");
  const offerOpts = data.offers.map((o) => `<option value="${o.id}">${escapeHtml(o.name)}</option>`).join("");
  const feedListId = "lg-qr-feeds";
  const feedOpts = data.feed_values.map((v) => `<option value="${escapeHtml(v)}"></option>`).join("");
  const feedHelp = data.feed_values.length > 0 ? `Used in this quote: ${escapeHtml(data.feed_values.join(" · "))}` : "No feed names used yet.";

  return (
    `<div data-pin="4.3-9-actions">` +
    `<div class="lg-qr-actions-head"><span class="lg-qr-cbtitle">Actions</span> <span class="lg-qr-opt">· pick at least one</span></div>` +
    // target funnel
    `<div class="lg-qr-arow" data-pin="action-target-funnel" data-qr-action="target_funnel">` +
    `<span class="lg-qr-swi on" role="switch" tabindex="0" aria-checked="true" data-qr-action-toggle><span class="lg-qr-knob"></span></span>` +
    `<div class="lg-qr-amain"><div class="lg-qr-aname">Target funnel</div><div class="lg-qr-adesc">Serve this funnel to matching visitors.</div>` +
    `<select class="form-select" data-qr-target-funnel aria-label="Target funnel"><option value="">— choose a funnel —</option>${funnelOpts}</select></div></div>` +
    // feed name
    `<div class="lg-qr-arow" data-pin="action-feed-name" data-qr-action="feed_name">` +
    `<span class="lg-qr-swi on" role="switch" tabindex="0" aria-checked="true" data-qr-action-toggle><span class="lg-qr-knob"></span></span>` +
    `<div class="lg-qr-amain"><div class="lg-qr-aname">Feed name</div><div class="lg-qr-adesc">Tag matching leads for analytics &amp; offer routing.</div>` +
    `<input class="form-input" type="text" list="${feedListId}" data-qr-feed-name aria-label="Feed name" />` +
    `<datalist id="${feedListId}">${feedOpts}</datalist>` +
    `<div class="lg-qr-help" data-qr-feed-help>${feedHelp}</div></div></div>` +
    // fb multiplier
    `<div class="lg-qr-arow" data-pin="action-fb-multiplier" data-qr-action="value_multiplier">` +
    `<span class="lg-qr-swi on" role="switch" tabindex="0" aria-checked="true" data-qr-action-toggle><span class="lg-qr-knob"></span></span>` +
    `<div class="lg-qr-amain"><div class="lg-qr-aname">FB multiplier</div><div class="lg-qr-adesc">Replaces the base S2S multiplier for this conversion.</div>` +
    `<input class="form-input" type="number" step="any" min="0" data-qr-multiplier aria-label="FB multiplier" style="max-width:140px" /></div></div>` +
    // redirect %
    `<div class="lg-qr-arow" data-pin="action-redirect-pct" data-qr-action="redirect_pct">` +
    `<span class="lg-qr-swi on" role="switch" tabindex="0" aria-checked="true" data-qr-action-toggle><span class="lg-qr-knob"></span></span>` +
    `<div class="lg-qr-amain"><div class="lg-qr-aname">Redirect %</div><div class="lg-qr-adesc">0 = no redirect. Share of matching sessions sent to the target instead of our funnel; the rest continue with the other actions.</div>` +
    `<input class="form-input" type="number" step="any" min="0" max="100" data-qr-redirect-pct aria-label="Redirect percent" style="max-width:140px" /></div></div>` +
    // redirect target
    `<div class="lg-qr-arow" data-pin="action-redirect-target" data-qr-action="redirect_target">` +
    `<span class="lg-qr-swi on" role="switch" tabindex="0" aria-checked="true" data-qr-action-toggle><span class="lg-qr-knob"></span></span>` +
    `<div class="lg-qr-amain"><div class="lg-qr-aname">Redirect target</div><div class="lg-qr-adesc">Where redirected sessions go — an offer, or an allowlisted URL.</div>` +
    `<div class="lg-qr-seg" data-qr-target-mode><span class="lg-qr-segitem active" data-qr-mode="offer" role="button" tabindex="0">Offer</span><span class="lg-qr-segitem" data-qr-mode="url" role="button" tabindex="0">Allowlisted URL</span></div>` +
    `<select class="form-select" data-qr-target-offer aria-label="Redirect offer"><option value="">— choose an offer —</option>${offerOpts}</select>` +
    `<div data-qr-url-wrap hidden><input class="form-input" type="text" data-qr-redirect-url aria-label="Allowlisted redirect URL" placeholder="https://…" />` +
    `<div class="lg-qr-help">Only hosts on the site allowlist can be entered here.</div></div>` +
    `</div></div>` +
    `</div>`
  );
}

// The conditions helper sentence — derived from the SAME single-source arrays
// #lg-qr-cond-mount's embedded field/operator pickers render from
// (QR_ENTRY_FIELD_OPTIONS :1908, RULES_BUILDER_OPS :110/renderOpSelect :609)
// so this summary can never drift from what the picker actually offers again
// (the bug this replaces: a hand-transcribed 6-of-11 operator list went stale
// the moment a 7th+ operator — range/in/not_in/is_empty/not_empty — existed).
// Fields are joined with the same "·" separator as everything else in this
// sentence (dropping the old ad-hoc "UTM Source/Medium/Campaign/Content"
// slash-grouping) — one separator convention, zero manual regrouping to keep
// in sync. Operator labels are reused VERBATIM from RULES_BUILDER_OPS,
// including the "(=)"-style symbols renderOpSelect itself renders, so the
// helper always reads identically to the dropdown beside it.
function renderConditionsHelpText(): string {
  const sources = QR_ENTRY_FIELD_OPTIONS.map((f) => escapeHtml(f.label)).join(" · ");
  const ops = RULES_BUILDER_OPS.map((op) => escapeHtml(op.label)).join(" · ");
  return `Sources: answer fields (by name) · ${sources}. Operators: ${ops}.`;
}

// The single modal DOM instance (pack 8.2-rule-modal / restyle of Image42).
function renderQuoteRuleModal(data: QuoteRulesRailData): string {
  return (
    `<div class="lg-qr-overlay" id="lg-qr-modal" data-pin="8.2-rule-modal" role="dialog" aria-modal="true" aria-label="Routing rule" hidden>` +
    `<div class="lg-qr-modal card">` +
    `<div class="lg-qr-modal-head"><h3 id="lg-qr-modal-title">New routing rule</h3>` +
    `<span class="lg-qr-x" role="button" tabindex="0" data-qr-cancel aria-label="Close">✖</span></div>` +
    `<div class="lg-qr-modal-body">` +
    // name
    `<div class="lg-qr-fieldblock" data-pin="8.2-rule-name"><label class="lg-qr-label" for="lg-qr-name">Rule name<span class="lg-qr-req">*</span> <span class="lg-qr-opt">· up to 80 characters</span></label>` +
    `<input class="form-input" id="lg-qr-name" type="text" maxlength="80" data-qr-modal-name /></div>` +
    // checkpoint + priority
    `<div class="lg-qr-grid2">` +
    `<div data-pin="4.3-3-checkpoint"><label class="lg-qr-label">Checkpoint <span class="lg-qr-opt">· read-only</span></label>` +
    `<div class="lg-qr-readonly" data-qr-modal-checkpoint>Entry</div>` +
    `<div class="lg-qr-help">Derived from the conditions — where this rule can first apply.</div>` +
    `<div class="lg-qr-callout warn" data-qr-modal-a6 data-pin="A-6-inline" hidden><span class="lg-qr-warnico" aria-hidden="true">⚠</span><span>This rule can never apply before a visitor enters a funnel that asks these questions.</span></div></div>` +
    `<div data-pin="8.2-rule-priority"><label class="lg-qr-label" for="lg-qr-priority">Priority</label>` +
    `<input class="form-input" id="lg-qr-priority" type="number" min="1" max="100" step="1" value="100" data-qr-modal-priority />` +
    `<div class="lg-qr-help">1 = highest priority, 100 = lowest.</div></div>` +
    `</div>` +
    // conditions
    `<div class="lg-qr-cardblock" data-pin="8.2-rule-conditions">` +
    `<div class="lg-qr-cbhead"><span class="lg-qr-cbtitle">Conditions</span>` +
    `<div class="lg-qr-seg" data-pin="8.2-anyall" data-qr-matchmode><span class="lg-qr-segitem active" data-qr-match="all" role="button" tabindex="0">Match ALL</span><span class="lg-qr-segitem" data-qr-match="any" role="button" tabindex="0">Match ANY</span></div></div>` +
    `<div id="lg-qr-cond-mount"></div>` +
    `<input type="hidden" data-qr-cond-out />` +
    `<div class="lg-qr-help">${renderConditionsHelpText()}</div>` +
    `</div>` +
    // actions
    renderQuoteRuleActions(data) +
    // A-11 error
    `<div class="lg-qr-errmsg" data-pin="A-11-validation" data-qr-action-error hidden><span class="lg-qr-warnico" aria-hidden="true">⚠</span>Pick at least one action for this rule.</div>` +
    `<p class="alert alert-error lg-qr-error" data-qr-modal-error role="alert" hidden></p>` +
    // sentence
    `<div class="lg-qr-sentence" data-pin="8.2-rule-sentence"><span class="lg-qr-sentlab">In plain language</span> <span data-qr-sentence></span></div>` +
    `</div>` +
    `<div class="lg-qr-modal-foot">` +
    `<span class="btn btn-outline" role="button" tabindex="0" data-qr-cancel>Cancel</span>` +
    `<span class="btn btn-primary" role="button" tabindex="0" data-qr-save>Save rule</span>` +
    `</div>` +
    `</div></div>`
  );
}

const QUOTE_RULES_STYLES = `<style>
.lg-qr-rail{display:flex;flex-direction:column;min-height:0}
.lg-qr-head{padding:16px 16px 12px;border-bottom:1px solid rgba(20,32,54,.08)}
.lg-qr-title{font-size:14px;font-weight:800;color:#14233a;margin-bottom:6px}
.lg-qr-desc{font-size:11.5px;color:#5e6b82;line-height:1.5}
.lg-qr-colhead{display:flex;align-items:center;gap:8px;font-size:9.5px;font-weight:800;letter-spacing:.5px;text-transform:uppercase;color:#8894a8;padding:9px 16px 7px}
.lg-qr-colhead .lg-qr-cprio{flex:0 0 auto}
.lg-qr-colhead .lg-qr-cname{flex:1 1 auto}
.lg-qr-list{flex:1 1 auto;overflow-y:auto;padding:6px 14px 14px}
.lg-qr-card{border:1px solid rgba(20,32,54,.12);border-radius:10px;padding:11px 12px;margin-bottom:10px;background:#fff}
.lg-qr-card.disabled{background:#fbfcfd;opacity:.9}
.lg-qr-top{display:flex;align-items:center;gap:9px;margin-bottom:8px}
.lg-qr-prio{flex:0 0 auto;min-width:24px;height:24px;padding:0 6px;border-radius:7px;background:#1b3a5c;color:#fff;font-size:12px;font-weight:800;display:flex;align-items:center;justify-content:center}
.lg-qr-card.disabled .lg-qr-prio{background:#8894a8}
.lg-qr-name{flex:1 1 auto;min-width:0;font-size:13px;font-weight:700;color:#14233a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lg-qr-status{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:700;padding:3px 9px;border-radius:999px}
.lg-qr-status.active{color:#2e7d5b;background:rgba(46,125,91,.12)}
.lg-qr-status.active .lg-qr-dot{background:#2e7d5b}
.lg-qr-status.disabled{color:#5e6b82;background:rgba(20,32,54,.06)}
.lg-qr-status.disabled .lg-qr-dot{background:#8894a8}
.lg-qr-dot{width:6px;height:6px;border-radius:50%}
.lg-qr-ckpt{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;font-weight:600;color:#5e6b82}
.lg-qr-ckico{color:#8894a8}
.lg-qr-field{margin-top:7px}
.lg-qr-flab{font-size:9.5px;font-weight:800;letter-spacing:.4px;text-transform:uppercase;color:#8894a8;margin-bottom:4px}
.lg-qr-summ{display:flex;flex-wrap:wrap;gap:5px}
.lg-qr-chip{display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:600;color:#374966;background:rgba(20,32,54,.06);border-radius:6px;padding:3px 7px;line-height:1.3;overflow-wrap:anywhere}
.lg-qr-chip.act{background:rgba(27,58,92,.10);color:#1b3a5c}
.lg-qr-chip.join{background:transparent;color:#8894a8;font-weight:700;padding:3px 2px}
.lg-qr-callout{display:flex;gap:7px;align-items:flex-start;margin-top:9px;padding:8px 10px;font-size:11px;border-radius:8px;line-height:1.45}
.lg-qr-callout.warn{color:#8a5a00;background:rgba(251,191,36,.12);border:1px solid rgba(180,120,9,.4)}
.lg-qr-warnico{flex:0 0 auto}
.lg-qr-foot{display:flex;align-items:center;gap:4px;margin-top:11px;padding-top:9px;border-top:1px solid rgba(20,32,54,.08)}
.lg-qr-act{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;font-weight:600;color:#5e6b82;padding:4px 7px;border-radius:6px;cursor:pointer}
.lg-qr-act:hover{background:rgba(27,58,92,.10);color:#1b3a5c}
.lg-qr-act.del{color:#8a5050}
.lg-qr-toggle-wrap{margin-left:auto;display:inline-flex}
.lg-qr-swi{width:38px;height:22px;border-radius:999px;background:rgba(20,32,54,.2);position:relative;flex:0 0 auto;cursor:pointer;display:inline-block}
.lg-qr-swi .lg-qr-knob{position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.25)}
.lg-qr-swi.on{background:#1b3a5c}
.lg-qr-swi.on .lg-qr-knob{left:18px}
.lg-qr-newbtn{display:flex;align-items:center;justify-content:center;gap:7px;width:100%;padding:10px;border:1px solid #1b3a5c;border-radius:8px;color:#1b3a5c;font-size:12.5px;font-weight:700;cursor:pointer;background:#fff}
.lg-qr-overlay{position:fixed;inset:0;background:rgba(20,32,54,.45);display:flex;align-items:flex-start;justify-content:center;overflow:auto;z-index:1000;padding:32px 16px}
/* Author [hidden] override (scoped to the rail): a class 'display:' rule beats
   the UA [hidden]{display:none}, so toggling .hidden on styled elements (a6
   callout, action error, redirect-target select/url) would otherwise stay
   visible. The #id-scoped selector out-specifies every .class display rule. */
#lg-qr-rail [hidden]{display:none}
.lg-qr-overlay[hidden]{display:none}
.lg-qr-modal{max-width:640px;width:100%;margin:0 auto}
.lg-qr-modal-head{display:flex;align-items:center;justify-content:space-between;padding:2px 2px 12px}
.lg-qr-modal-head h3{font-size:16px;font-weight:800;color:#14233a;margin:0}
.lg-qr-x{cursor:pointer;color:#5e6b82;padding:2px 6px}
.lg-qr-fieldblock{margin-bottom:14px}
.lg-qr-label{display:block;font-size:12px;font-weight:700;color:#374966;margin-bottom:5px}
.lg-qr-req{color:#b23a2c}
.lg-qr-opt{color:#8894a8;font-weight:500}
.lg-qr-grid2{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:16px}
@media (max-width:560px){.lg-qr-grid2{grid-template-columns:1fr}}
.lg-qr-readonly{border:1px solid rgba(20,32,54,.14);border-radius:7px;padding:8px 10px;font-size:13px;font-weight:600;color:#14233a;background:#f7f9fb}
.lg-qr-help{font-size:11px;color:#5e6b82;margin-top:5px;line-height:1.45}
.lg-qr-cardblock{border:1px solid rgba(20,32,54,.12);border-radius:10px;padding:12px;margin-bottom:16px}
.lg-qr-cbhead{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}
.lg-qr-cbtitle{font-size:13px;font-weight:800;color:#14233a}
.lg-qr-seg{display:inline-flex;border:1px solid rgba(20,32,54,.16);border-radius:8px;overflow:hidden}
.lg-qr-seg.full{display:flex;margin-bottom:8px}
.lg-qr-segitem{font-size:11.5px;font-weight:700;padding:5px 11px;cursor:pointer;color:#5e6b82}
.lg-qr-segitem.active{background:#1b3a5c;color:#fff}
.lg-qr-actions-head{margin-bottom:10px}
.lg-qr-arow{display:flex;gap:10px;align-items:flex-start;padding:10px 0;border-top:1px solid rgba(20,32,54,.08)}
.lg-qr-arow.off{opacity:.55}
.lg-qr-arow.off input,.lg-qr-arow.off select,.lg-qr-arow.off .lg-qr-seg{pointer-events:none;opacity:.7}
.lg-qr-amain{flex:1 1 auto;min-width:0}
.lg-qr-aname{font-size:13px;font-weight:700;color:#14233a}
.lg-qr-adesc{font-size:11px;color:#5e6b82;margin:2px 0 7px;line-height:1.4}
.lg-qr-errmsg{display:flex;gap:6px;align-items:center;color:#b23a2c;font-size:12px;font-weight:600;margin:2px 0 12px}
.lg-qr-error{margin:0 0 12px}
.lg-qr-sentence{font-size:12px;color:#374966;background:#f7f9fb;border-radius:8px;padding:10px 12px;line-height:1.5}
.lg-qr-sentlab{font-size:9.5px;font-weight:800;letter-spacing:.4px;text-transform:uppercase;color:#8894a8;display:block;margin-bottom:4px}
.lg-qr-modal-foot{display:flex;justify-content:flex-end;gap:10px;padding-top:14px}
</style>`;

// FROZEN INTERFACE — quotes-tabs/funnel.ts mounts exactly this at the pack's
// 344px right-rail mount point.
export function renderQuoteRulesRail(data: QuoteRulesRailData): string {
  const cards = qrSortedRules(data.rules)
    .map((r) => renderQuoteRuleCard(r, data))
    .join("");
  const blob = {
    quote_public_id: data.quote_public_id,
    rules: qrSortedRules(data.rules),
    funnels: data.funnels,
    default_funnel_id: data.default_funnel_id,
    shared_page_fields: data.shared_page_fields,
    answer_fields: data.answer_fields,
    entry_fields: QR_ENTRY_FIELD_OPTIONS,
    offers: data.offers,
    feed_values: data.feed_values,
  };
  const blobJson = JSON.stringify(blob).replace(/</g, "\\u003c");
  return (
    `<div class="lg-qr-rail" id="lg-qr-rail" data-pin="8.2-rules-rail" data-quote-public-id="${escapeHtml(data.quote_public_id)}">` +
    QUOTE_RULES_STYLES +
    `<div class="lg-qr-head"><div class="lg-qr-title">Routing rules</div>` +
    `<div class="lg-qr-desc">Rules decide which funnel a visitor sees, and can tag the lead, set the FB multiplier, or redirect. Lowest priority number wins when more than one matches.</div></div>` +
    `<div class="lg-qr-colhead"><span class="lg-qr-cprio">Priority</span><span class="lg-qr-cname">Name · Checkpoint · Conditions · Actions · Status</span></div>` +
    `<div class="lg-qr-list" id="lg-qr-list" data-pin="8.2-rules-table">` +
    `<div data-qr-cards>${cards}</div>` +
    `<div class="lg-qr-newbtn" data-pin="8.2-new-rule-btn" role="button" tabindex="0" data-qr-new>+ New rule</div>` +
    `</div>` +
    renderQuoteRuleModal(data) +
    `<script id="lg-qr-data" type="application/json">${blobJson}</script>` +
    `</div>`
  );
}

// ---------------------------------------------------------------------------
// ES5 island — the rail/modal controller. Strict ES5 (var/function only; no
// arrows/const/let/template literals/backticks — layout.ts constraint). DOM
// writes use createElement/textContent/setAttribute only (no innerHTML). The
// Conditions section mounts the EXISTING window.lgRulesBuilder (RULES_BUILDER_
// SCRIPT); the checkpoint mirror below is deriveRuleCheckpoint (rule-
// checkpoint.ts) re-expressed 1:1 (drift pinned by the P3b rules-ui test).
// ---------------------------------------------------------------------------
export const QUOTE_RULES_SCRIPT = `(function () {
  'use strict';

  // Pure checkpoint API (a 1:1 mirror of rule-checkpoint.ts deriveRuleCheckpoint)
  // exposed BEFORE the DOM boot, so the drift-guard test can call it without a
  // rail root present (vitest node env has no DOM). deriveCheckpointPure /
  // checkpointLabelOf / conditionFieldsOf are hoisted function declarations.
  if (typeof window !== 'undefined') {
    window.lgQuoteRules = {
      deriveCheckpoint: deriveCheckpointPure,
      checkpointLabelOf: checkpointLabelOf,
      conditionFieldsOf: conditionFieldsOf
    };
  }

  var API = '/api/admin/leadgen';
  var root = document.getElementById('lg-qr-rail');
  if (!root) { return; }
  var dataEl = document.getElementById('lg-qr-data');
  var data = null;
  try { data = dataEl ? JSON.parse(dataEl.textContent || '') : null; } catch (e) { data = null; }
  if (!data) { return; }

  var quotePublicId = data.quote_public_id;
  var rules = isArr(data.rules) ? data.rules.slice() : [];
  var funnels = isArr(data.funnels) ? data.funnels : [];
  var entryFields = isArr(data.entry_fields) ? data.entry_fields : [];
  var answerFields = isArr(data.answer_fields) ? data.answer_fields : [];
  var offers = isArr(data.offers) ? data.offers : [];
  var sharedFields = isArr(data.shared_page_fields) ? data.shared_page_fields : [];
  var defaultFunnelId = data.default_funnel_id;

  var modal = document.getElementById('lg-qr-modal');
  var listEl = document.getElementById('lg-qr-list');
  var cardsEl = qs(listEl, '[data-qr-cards]');
  var editingPublicId = null;   // null when creating
  var mountedConditions = null; // window.lgRulesBuilder mount handle
  var targetMode = 'offer';

  // ---- small helpers --------------------------------------------------------
  function isArr(v) { return Object.prototype.toString.call(v) === '[object Array]'; }
  function qs(r, s) { return r ? r.querySelector(s) : null; }
  function qsa(r, s) { return r ? r.querySelectorAll(s) : []; }
  function el(tag, cls) { var n = document.createElement(tag); if (cls) { n.className = cls; } return n; }
  function txt(node, t) { node.textContent = t == null ? '' : String(t); return node; }
  function ENTRY_KNOWN() { return ['state','device','utm_source','utm_medium','utm_content','utm_campaign','hour','weekday','os']; }
  function isEntryKnown(f) { var k = ENTRY_KNOWN(); var i; for (i = 0; i < k.length; i++) { if (k[i] === f) { return true; } } return false; }
  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : null; }

  // ---- checkpoint derivation (mirror of rule-checkpoint.ts deriveRuleCheckpoint)
  function conditionFieldsOf(conditions) {
    var out = [];
    if (!conditions || typeof conditions !== 'object') { return out; }
    var groups = conditions.groups;
    if (!isArr(groups)) { return out; }
    var i;
    for (i = 0; i < groups.length; i++) {
      var g = groups[i];
      if (g && typeof g === 'object' && typeof g.field === 'string' && g.field.replace(/^\\s+|\\s+$/g, '') !== '') { out.push(g.field); }
    }
    return out;
  }
  function setHas(list, v) { var i; for (i = 0; i < list.length; i++) { if (list[i] === v) { return true; } } return false; }
  function earliestPageKnowingAll(funnel, fields) {
    var maxFirst = null;
    var i;
    for (i = 0; i < fields.length; i++) {
      var first = null;
      var p;
      for (p = 0; p < funnel.pages.length; p++) {
        if (setHas(funnel.pages[p].fields, fields[i])) { first = funnel.pages[p].position; break; }
      }
      if (first === null) { return null; }
      if (maxFirst === null || first > maxFirst) { maxFirst = first; }
    }
    return maxFirst;
  }
  // PURE (mirror of deriveRuleCheckpoint): entry (a) / shared (b) / in_funnel (c)
  // + unreachable. sharedArg = shared-page field name list; funnelsArg = board
  // order [{ name, pages:[{ position, fields:[...] }] }].
  function deriveCheckpointPure(conditionFields, sharedArg, funnelsArg) {
    var answer = [];
    var i;
    for (i = 0; i < conditionFields.length; i++) { if (!isEntryKnown(conditionFields[i])) { answer.push(conditionFields[i]); } }
    if (answer.length === 0) { return { plane: 'entry' }; }
    var allShared = true;
    for (i = 0; i < answer.length; i++) { if (!setHas(sharedArg, answer[i])) { allShared = false; break; } }
    if (allShared) { return { plane: 'shared' }; }
    var funnelOnly = [];
    for (i = 0; i < answer.length; i++) { if (!setHas(sharedArg, answer[i])) { funnelOnly.push(answer[i]); } }
    var f;
    for (f = 0; f < funnelsArg.length; f++) {
      var page = earliestPageKnowingAll(funnelsArg[f], funnelOnly);
      if (page !== null) { return { plane: 'in_funnel', funnelName: funnelsArg[f].name, pagePosition: page }; }
    }
    return { plane: 'in_funnel', unreachable: true };
  }
  function deriveCheckpoint(conditionFields) { return deriveCheckpointPure(conditionFields, sharedFields, funnels); }
  // N4 (mirror of qrPageOrdinal) — the board's OWN numbering (quotes-tabs/
  // funnel.ts: "Page " + (index + 1), the ARRAY INDEX in this funnel's own
  // pages) for the checkpoint's representative page. Looks the page back up
  // BY POSITION inside its funnel's own pages array and uses ITS INDEX + 1 so
  // this agrees with the board even if the position field is not dense.
  // funnelsArg defaults to the closure's own funnels var (real card/modal call
  // sites below never pass it); deriveCheckpointPure's exposed-for-test twin
  // takes an explicit funnels list, so this does too.
  function pageOrdinalOf(cp, funnelsArg) {
    var list = funnelsArg || funnels;
    var i, j, funnel, idx;
    funnel = null;
    for (i = 0; i < list.length; i++) { if (list[i].name === cp.funnelName) { funnel = list[i]; break; } }
    idx = -1;
    if (funnel) {
      for (j = 0; j < funnel.pages.length; j++) { if (funnel.pages[j].position === cp.pagePosition) { idx = j; break; } }
    }
    return (idx >= 0 ? idx : (cp.pagePosition || 0)) + 1;
  }
  function checkpointLabelOf(cp, funnelsArg) {
    if (cp.plane === 'entry') { return 'Entry'; }
    if (cp.plane === 'shared') { return 'Shared page'; }
    if (cp.unreachable === true) { return 'In a funnel'; }
    return 'In funnel ' + (cp.funnelName || 'a funnel') + ' \\u2014 page ' + String(pageOrdinalOf(cp, funnelsArg));
  }

  // ---- labels + summaries (mirror the SSR helpers) --------------------------
  function fieldLabel(field) {
    var i;
    for (i = 0; i < entryFields.length; i++) { if (entryFields[i].internal_field === field) { return entryFields[i].label; } }
    for (i = 0; i < answerFields.length; i++) { if (answerFields[i].internal_field === field) { return answerFields[i].label; } }
    return '(removed field)';
  }
  function opWord(op) {
    var m = { eq: 'is', neq: 'is not', gt: 'greater than', lt: 'less than', gte: 'at least', lte: 'at most', range: 'between', 'in': 'in', not_in: 'not in' };
    return m[op] || op;
  }
  // ADJ-N8 (owner A.1 #11C "using jargon") — mirror of the SSR
  // qrFieldChoices/resolveChoiceValueText pair: a choice question's stored slug
  // is printed as the operator's own choice LABEL; a slug with no surviving
  // choice degrades to humanized words; a field with no choices (free text /
  // UTM / number) keeps its stored string verbatim.
  function humanizeChoiceToken(token) {
    var spaced = String(token).replace(/[_-]+/g, ' ').replace(/^\\s+|\\s+$/g, '');
    if (spaced === '') { return String(token); }
    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
  }
  function choiceValueText(field, v) {
    var raw = (v === undefined || v === null) ? '' : String(v);
    var i, j, choices;
    for (i = 0; i < answerFields.length; i++) {
      if (answerFields[i].internal_field !== field) { continue; }
      choices = isArr(answerFields[i].choices) ? answerFields[i].choices : null;
      if (!choices || choices.length === 0) { return raw; }
      for (j = 0; j < choices.length; j++) {
        if (String(choices[j].value) === raw && choices[j].label) { return String(choices[j].label); }
      }
      return humanizeChoiceToken(raw);
    }
    return raw;
  }
  function valueText(g, field) {
    if (g.op === 'range') { return String(g.from == null ? '' : g.from) + '\\u2013' + String(g.to == null ? '' : g.to); }
    if (g.op === 'in' || g.op === 'not_in') { var vals = isArr(g.values) ? g.values : []; var out = []; var i; for (i = 0; i < vals.length; i++) { out.push(choiceValueText(field, vals[i])); } return out.join(', '); }
    if (typeof g.value === 'boolean') { return g.value ? 'Yes' : 'No'; }
    return g.value == null ? '' : choiceValueText(field, g.value);
  }
  function conditionChips(rule) {
    var conditions = rule.conditions_json;
    if (!conditions || typeof conditions !== 'object' || !isArr(conditions.groups) || conditions.groups.length === 0) { return ['Always']; }
    var chips = [];
    var i;
    for (i = 0; i < conditions.groups.length; i++) {
      var g = conditions.groups[i];
      if (!g || typeof g !== 'object') { continue; }
      chips.push(fieldLabel(g.field || '') + ' ' + opWord(g.op || 'eq') + ' ' + valueText(g, g.field || ''));
    }
    return chips.length > 0 ? chips : ['Always'];
  }
  function funnelNameById(id) { var i; for (i = 0; i < funnels.length; i++) { if (funnels[i].id === id) { return funnels[i].name; } } return ''; }
  function funnelPublicById(id) { var i; for (i = 0; i < funnels.length; i++) { if (funnels[i].id === id) { return funnels[i].public_id; } } return ''; }
  function offerNameById(id) { var i; for (i = 0; i < offers.length; i++) { if (offers[i].id === id) { return offers[i].name; } } return ''; }
  function actionChips(rule) {
    var chips = [];
    if (rule.target_funnel_id != null) { chips.push('\\u2192 ' + funnelNameById(rule.target_funnel_id)); }
    if (rule.feed_name) { chips.push('Feed ' + rule.feed_name); }
    if (rule.value_multiplier != null) { chips.push('\\u00d7' + String(rule.value_multiplier)); }
    var hasTarget = rule.target_offer_id != null || (rule.redirect_url && rule.redirect_url !== '');
    if (rule.redirect_pct != null || hasTarget) {
      var pct = rule.redirect_pct != null ? String(rule.redirect_pct) : '0';
      var tgt = rule.target_offer_id != null ? offerNameById(rule.target_offer_id) : (rule.redirect_url || '');
      chips.push('Redirect ' + pct + '%' + (tgt !== '' ? ' \\u2192 ' + tgt : ''));
    }
    return chips;
  }
  function matchWord(rule) { return rule.match_mode === 'any' ? 'any' : 'all'; }

  // ---- sentence (plain language) --------------------------------------------
  function ruleSentence(rule) {
    var conds = conditionChips(rule);
    var acts = actionChips(rule);
    var when = conds.length === 1 && conds[0] === 'Always' ? 'For every visitor' : ('When ' + conds.join(matchWord(rule) === 'any' ? ' or ' : ' and '));
    if (acts.length === 0) { return when + ', do nothing yet \\u2014 pick at least one action.'; }
    return when + ', ' + acts.join(', ') + '.';
  }

  // ---- card rendering (mirror renderQuoteRuleCard) --------------------------
  function actionRow(labelDom) { return labelDom; }
  function buildCard(rule) {
    var cp = deriveCheckpoint(conditionFieldsOf(rule.conditions_json));
    var unreachable = cp.unreachable === true;
    var disabled = rule.status === 'disabled';
    var card = el('div', 'lg-qr-card' + (disabled ? ' disabled' : ''));
    card.setAttribute('data-qr-card', '');
    card.setAttribute('data-rule-public-id', rule.public_id);
    card.setAttribute('data-rule-priority', String(rule.priority));
    if (disabled) { card.setAttribute('data-pin', '8.2-rule-disabled'); }

    var top = el('div', 'lg-qr-top');
    var prio = el('span', 'lg-qr-prio'); prio.setAttribute('data-qr-prio', ''); txt(prio, rule.priority); top.appendChild(prio);
    var nmText = (rule.rule_name && rule.rule_name.replace(/^\\s+|\\s+$/g, '') !== '') ? rule.rule_name : '(unnamed rule)';
    var nm = el('span', 'lg-qr-name'); nm.setAttribute('data-qr-name', ''); nm.title = nmText; txt(nm, nmText); top.appendChild(nm);
    var st = el('span', 'lg-qr-status ' + (disabled ? 'disabled' : 'active')); st.setAttribute('data-qr-status', ''); st.appendChild(el('span', 'lg-qr-dot')); st.appendChild(document.createTextNode(disabled ? 'Disabled' : 'Active')); top.appendChild(st);
    card.appendChild(top);

    var ck = el('div', 'lg-qr-ckpt'); ck.setAttribute('data-qr-ckpt', '');
    var cki = el('span', 'lg-qr-ckico'); cki.setAttribute('aria-hidden', 'true'); txt(cki, '\\u25f7'); ck.appendChild(cki);
    var ckText = el('span'); ckText.setAttribute('data-qr-ckpt-text', ''); txt(ckText, checkpointLabelOf(cp));
    ck.appendChild(ckText); card.appendChild(ck);

    card.appendChild(fieldBlock('Conditions \\u00b7 ' + matchWord(rule), conditionChips(rule), matchWord(rule) === 'any' ? 'or' : 'and', false));
    var acts = actionChips(rule);
    card.appendChild(fieldBlock('Actions', acts.length > 0 ? acts : ['No actions yet'], '', true));

    if (unreachable) {
      var call = el('div', 'lg-qr-callout warn'); call.setAttribute('data-pin', 'A-6-inline'); call.setAttribute('role', 'note');
      var wi = el('span', 'lg-qr-warnico'); wi.setAttribute('aria-hidden', 'true'); txt(wi, '\\u26a0'); call.appendChild(wi);
      call.appendChild(txt(el('span'), 'This rule can never apply before a visitor enters a funnel that asks these questions.'));
      card.appendChild(call);
    }

    var foot = el('div', 'lg-qr-foot');
    foot.appendChild(footAct('\\u270e Edit', 'data-qr-edit'));
    foot.appendChild(footAct('\\u2398 Duplicate', 'data-qr-duplicate'));
    var tw = el('span', 'lg-qr-toggle-wrap');
    var sw = el('span', 'lg-qr-swi' + (disabled ? '' : ' on')); sw.setAttribute('role', 'switch'); sw.setAttribute('tabindex', '0'); sw.setAttribute('aria-checked', disabled ? 'false' : 'true'); sw.setAttribute('aria-label', 'Enabled'); sw.setAttribute('data-qr-toggle', ''); sw.appendChild(el('span', 'lg-qr-knob')); tw.appendChild(sw); foot.appendChild(tw);
    var del = el('span', 'lg-qr-act del'); del.setAttribute('role', 'button'); del.setAttribute('tabindex', '0'); del.setAttribute('data-qr-delete', ''); del.setAttribute('aria-label', 'Delete rule'); txt(del, '\\u2716'); foot.appendChild(del);
    card.appendChild(foot);
    return card;
  }
  function fieldBlock(label, chips, joinWord, isAct) {
    var wrap = el('div', 'lg-qr-field');
    wrap.appendChild(txt(el('div', 'lg-qr-flab'), label));
    var summ = el('div', 'lg-qr-summ');
    summ.setAttribute(isAct ? 'data-qr-act-summ' : 'data-qr-cond-summ', '');
    var i;
    for (i = 0; i < chips.length; i++) {
      if (!isAct && i > 0 && joinWord) { summ.appendChild(txt(el('span', 'lg-qr-chip join'), joinWord)); }
      summ.appendChild(txt(el('span', 'lg-qr-chip' + (isAct ? ' act' : '')), chips[i]));
    }
    wrap.appendChild(summ);
    return wrap;
  }
  function footAct(label, attr) { var s = el('span', 'lg-qr-act'); s.setAttribute('role', 'button'); s.setAttribute('tabindex', '0'); s.setAttribute(attr, ''); txt(s, label); return s; }

  function sortRules() { rules.sort(function (a, b) { return a.priority - b.priority; }); }
  function renderList() {
    if (!cardsEl) { return; }
    while (cardsEl.firstChild) { cardsEl.removeChild(cardsEl.firstChild); }
    sortRules();
    var i;
    for (i = 0; i < rules.length; i++) { cardsEl.appendChild(buildCard(rules[i])); }
  }

  // ---- API ------------------------------------------------------------------
  function refetch(then) {
    fetch(API + '/quotes/' + encodeURIComponent(quotePublicId) + '/routing-rules', { headers: { 'accept': 'application/json' } })
      .then(function (r) { return r.json(); })
      .then(function (body) { rules = (body && isArr(body.items)) ? body.items : []; renderList(); if (then) { then(); } }, function () {});
  }

  // ---- modal ----------------------------------------------------------------
  function findRule(pub) { var i; for (i = 0; i < rules.length; i++) { if (rules[i].public_id === pub) { return rules[i]; } } return null; }
  function combinedFields() {
    var out = [];
    var i;
    // ADJ-N8 — the choice map rides along so the mounted §21.4 builder's own
    // "Matches when ..." line resolves the value side too (the modal shows
    // BOTH sentences; fixing only one leaves the jargon on screen).
    for (i = 0; i < answerFields.length; i++) { out.push({ internal_field: answerFields[i].internal_field, label: 'Answer: ' + answerFields[i].label, choices: isArr(answerFields[i].choices) ? answerFields[i].choices : null }); }
    for (i = 0; i < entryFields.length; i++) { out.push({ internal_field: entryFields[i].internal_field, label: entryFields[i].label }); }
    return out;
  }
  function setToggle(sw, on) {
    sw.className = 'lg-qr-swi' + (on ? ' on' : '');
    sw.setAttribute('aria-checked', on ? 'true' : 'false');
    var rowWrap = sw;
    while (rowWrap && !(rowWrap.getAttribute && rowWrap.getAttribute('data-qr-action') !== null && rowWrap.getAttribute('data-qr-action') !== undefined)) { rowWrap = rowWrap.parentNode; if (!rowWrap || rowWrap === modal) { break; } }
    if (rowWrap && rowWrap.getAttribute && rowWrap.getAttribute('data-qr-action') != null) {
      if (on) { rowWrap.className = rowWrap.className.replace(/\\s*off/g, ''); } else if (rowWrap.className.indexOf('off') < 0) { rowWrap.className = rowWrap.className + ' off'; }
    }
  }
  function actionRowEl(name) { var i; var rowsN = qsa(modal, '[data-qr-action]'); for (i = 0; i < rowsN.length; i++) { if (rowsN[i].getAttribute('data-qr-action') === name) { return rowsN[i]; } } return null; }
  function actionOn(name) { var row = actionRowEl(name); if (!row) { return false; } var sw = qs(row, '[data-qr-action-toggle]'); return sw ? sw.className.indexOf('on') >= 0 : false; }
  function setActionOn(name, on) { var row = actionRowEl(name); if (!row) { return; } var sw = qs(row, '[data-qr-action-toggle]'); if (sw) { setToggle(sw, on); } }

  function openModal(rule) {
    editingPublicId = rule ? rule.public_id : null;
    txt(qs(modal, '#lg-qr-modal-title'), rule ? 'Edit routing rule' : 'New routing rule');
    qs(modal, '[data-qr-modal-name]').value = rule && rule.rule_name ? rule.rule_name : '';
    qs(modal, '[data-qr-modal-priority]').value = rule && rule.priority != null ? String(rule.priority) : '100';
    setMatchMode(rule && rule.match_mode === 'any' ? 'any' : 'all');

    // actions
    setActionOn('target_funnel', rule ? rule.target_funnel_id != null : false);
    var tf = qs(modal, '[data-qr-target-funnel]'); if (tf) { tf.value = rule && rule.target_funnel_id != null ? funnelPublicById(rule.target_funnel_id) : ''; }
    setActionOn('feed_name', rule ? !!rule.feed_name : false);
    var fn = qs(modal, '[data-qr-feed-name]'); if (fn) { fn.value = rule && rule.feed_name ? rule.feed_name : ''; }
    setActionOn('value_multiplier', rule ? rule.value_multiplier != null : false);
    var mu = qs(modal, '[data-qr-multiplier]'); if (mu) { mu.value = rule && rule.value_multiplier != null ? String(rule.value_multiplier) : ''; }
    setActionOn('redirect_pct', rule ? rule.redirect_pct != null : false);
    var rp = qs(modal, '[data-qr-redirect-pct]'); if (rp) { rp.value = rule && rule.redirect_pct != null ? String(rule.redirect_pct) : ''; }
    var hasUrl = rule && rule.redirect_url && rule.redirect_url !== '';
    setActionOn('redirect_target', rule ? (rule.target_offer_id != null || hasUrl) : false);
    setTargetMode(hasUrl ? 'url' : 'offer');
    var toff = qs(modal, '[data-qr-target-offer]'); if (toff) { toff.value = rule && rule.target_offer_id != null ? String(rule.target_offer_id) : ''; }
    var turl = qs(modal, '[data-qr-redirect-url]'); if (turl) { turl.value = hasUrl ? rule.redirect_url : ''; }

    showErr('');
    setActionError(false);

    // conditions builder (REUSE window.lgRulesBuilder)
    var mount = qs(modal, '#lg-qr-cond-mount');
    var outEl = qs(modal, '[data-qr-cond-out]');
    var raw = rule && rule.conditions_json ? JSON.stringify(rule.conditions_json) : '';
    outEl.value = raw;
    if (mount) { while (mount.firstChild) { mount.removeChild(mount.firstChild); } }
    mountedConditions = null;
    if (window.lgRulesBuilder && mount) {
      try { mountedConditions = window.lgRulesBuilder.mount(mount, raw, outEl, { fields: combinedFields() }); } catch (e) { mountedConditions = null; }
    }
    updateLive();
    modal.hidden = false;
  }
  function closeModal() { modal.hidden = true; editingPublicId = null; }

  function setMatchMode(mode) {
    var items = qsa(qs(modal, '[data-qr-matchmode]'), '[data-qr-match]');
    var i; for (i = 0; i < items.length; i++) { if (items[i].getAttribute('data-qr-match') === mode) { items[i].className = 'lg-qr-segitem active'; } else { items[i].className = 'lg-qr-segitem'; } }
  }
  function currentMatchMode() {
    var active = qs(qs(modal, '[data-qr-matchmode]'), '.lg-qr-segitem.active');
    return active ? active.getAttribute('data-qr-match') : 'all';
  }
  function setTargetMode(mode) {
    targetMode = mode;
    var items = qsa(qs(modal, '[data-qr-target-mode]'), '[data-qr-mode]');
    var i; for (i = 0; i < items.length; i++) { if (items[i].getAttribute('data-qr-mode') === mode) { items[i].className = 'lg-qr-segitem active'; } else { items[i].className = 'lg-qr-segitem'; } }
    var off = qs(modal, '[data-qr-target-offer]'); var uw = qs(modal, '[data-qr-url-wrap]');
    if (off) { off.hidden = mode !== 'offer'; }
    if (uw) { uw.hidden = mode !== 'url'; }
  }

  // ---- live checkpoint + sentence -------------------------------------------
  function currentConditions() {
    var outEl = qs(modal, '[data-qr-cond-out]');
    if (!outEl || !outEl.value) { return { groups: [] }; }
    try { return JSON.parse(outEl.value); } catch (e) { return { groups: [] }; }
  }
  function draftRule() {
    var conds = currentConditions();
    var r = { conditions_json: conds, match_mode: currentMatchMode(), rule_name: qs(modal, '[data-qr-modal-name]').value, priority: num(qs(modal, '[data-qr-modal-priority]').value) };
    r.target_funnel_id = null; r.feed_name = null; r.value_multiplier = null; r.redirect_pct = null; r.target_offer_id = null; r.redirect_url = null;
    if (actionOn('target_funnel')) { var tf = qs(modal, '[data-qr-target-funnel]').value; var fi; for (fi = 0; fi < funnels.length; fi++) { if (funnels[fi].public_id === tf) { r.target_funnel_id = funnels[fi].id; } } }
    if (actionOn('feed_name')) { r.feed_name = qs(modal, '[data-qr-feed-name]').value || null; }
    if (actionOn('value_multiplier')) { r.value_multiplier = num(qs(modal, '[data-qr-multiplier]').value); }
    if (actionOn('redirect_pct')) { r.redirect_pct = num(qs(modal, '[data-qr-redirect-pct]').value); }
    if (actionOn('redirect_target')) { if (targetMode === 'offer') { r.target_offer_id = num(qs(modal, '[data-qr-target-offer]').value); } else { r.redirect_url = qs(modal, '[data-qr-redirect-url]').value || null; } }
    return r;
  }
  function updateLive() {
    var draft = draftRule();
    var cp = deriveCheckpoint(conditionFieldsOf(draft.conditions_json));
    var ckEl = qs(modal, '[data-qr-modal-checkpoint]'); if (ckEl) { txt(ckEl, checkpointLabelOf(cp)); }
    var a6 = qs(modal, '[data-qr-modal-a6]'); if (a6) { a6.hidden = cp.unreachable !== true; }
    var sent = qs(modal, '[data-qr-sentence]'); if (sent) { txt(sent, ruleSentence(draft)); }
  }
  function anyAction() {
    return actionOn('target_funnel') || actionOn('feed_name') || actionOn('value_multiplier') || actionOn('redirect_pct') || actionOn('redirect_target');
  }
  function setActionError(on) { var e = qs(modal, '[data-qr-action-error]'); if (e) { e.hidden = !on; } }
  function showErr(msg) { var e = qs(modal, '[data-qr-modal-error]'); if (e) { if (msg) { txt(e, msg); e.hidden = false; } else { e.hidden = true; } } }

  // ---- save/duplicate/delete/toggle -----------------------------------------
  function collectBody() {
    var d = draftRule();
    var body = { rule_name: d.rule_name, priority: d.priority, match_mode: d.match_mode, conditions_json: d.conditions_json };
    body.target_funnel_id = actionOn('target_funnel') ? funnelPublicById(d.target_funnel_id) : null;
    body.feed_name = actionOn('feed_name') ? d.feed_name : null;
    body.value_multiplier = actionOn('value_multiplier') ? d.value_multiplier : null;
    body.redirect_pct = actionOn('redirect_pct') ? d.redirect_pct : null;
    body.target_offer_id = (actionOn('redirect_target') && targetMode === 'offer') ? d.target_offer_id : null;
    body.redirect_url = (actionOn('redirect_target') && targetMode === 'url') ? d.redirect_url : null;
    return body;
  }
  function save() {
    if (!anyAction()) { setActionError(true); return; }
    setActionError(false);
    var body = collectBody();
    var url = editingPublicId ? (API + '/routing-rules/' + encodeURIComponent(editingPublicId)) : (API + '/quotes/' + encodeURIComponent(quotePublicId) + '/routing-rules');
    var method = editingPublicId ? 'PATCH' : 'POST';
    fetch(url, { method: method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, status: r.status, body: j }; }); })
      .then(function (res) {
        if (!res.ok) { showErr(firstError(res.body) || ('Save failed (' + res.status + ').')); return; }
        closeModal(); refetch();
      }, function () { showErr('Network error saving the rule.'); });
  }
  function firstError(body) {
    if (!body) { return null; }
    if (typeof body.error === 'string') { return body.error; }
    if (body.errors && typeof body.errors === 'object') { var k; for (k in body.errors) { if (Object.prototype.hasOwnProperty.call(body.errors, k)) { return body.errors[k]; } } }
    return null;
  }
  function duplicateRule(pub) { fetch(API + '/routing-rules/' + encodeURIComponent(pub) + '/duplicate', { method: 'POST' }).then(function () { refetch(); }, function () {}); }
  function deleteRule(pub) { if (!window.confirm('Delete this rule?')) { return; } fetch(API + '/routing-rules/' + encodeURIComponent(pub), { method: 'DELETE' }).then(function () { refetch(); }, function () {}); }
  function toggleRule(rule) { var next = rule.status === 'disabled' ? 'active' : 'disabled'; fetch(API + '/routing-rules/' + encodeURIComponent(rule.public_id), { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: next }) }).then(function () { refetch(); }, function () {}); }

  // ---- events ---------------------------------------------------------------
  function closestAttr(node, attr) { var n = node; while (n && n !== root) { if (n.getAttribute && n.getAttribute(attr) !== null && n.hasAttribute && n.hasAttribute(attr)) { return n; } n = n.parentNode; } return null; }

  root.addEventListener('click', function (ev) {
    var t = ev.target;
    if (closestAttr(t, 'data-qr-new')) { openModal(null); return; }
    var card = closestAttr(t, 'data-qr-card');
    if (card) {
      var pub = card.getAttribute('data-rule-public-id');
      var rule = findRule(pub);
      if (closestAttr(t, 'data-qr-edit')) { if (rule) { openModal(rule); } return; }
      if (closestAttr(t, 'data-qr-duplicate')) { duplicateRule(pub); return; }
      if (closestAttr(t, 'data-qr-delete')) { deleteRule(pub); return; }
      if (closestAttr(t, 'data-qr-toggle')) { if (rule) { toggleRule(rule); } return; }
    }
  });

  if (modal) {
    modal.addEventListener('click', function (ev) {
      var t = ev.target;
      if (closestAttr2(t, 'data-qr-cancel')) { closeModal(); return; }
      if (closestAttr2(t, 'data-qr-save')) { save(); return; }
      var atog = closestAttr2(t, 'data-qr-action-toggle');
      if (atog) { setToggle(atog, atog.className.indexOf('on') < 0); updateLive(); return; }
      var match = closestAttr2(t, 'data-qr-match');
      if (match) { setMatchMode(match.getAttribute('data-qr-match')); updateLive(); return; }
      var mode = closestAttr2(t, 'data-qr-mode');
      if (mode) { setTargetMode(mode.getAttribute('data-qr-mode')); updateLive(); return; }
    });
    modal.addEventListener('input', function () { updateLive(); });
    modal.addEventListener('change', function () { updateLive(); });
  }
  function closestAttr2(node, attr) { var n = node; while (n && n !== modal) { if (n.getAttribute && n.hasAttribute && n.hasAttribute(attr)) { return n; } n = n.parentNode; } return null; }

  // Boot: SSR already rendered the cards; keep JS state consistent (re-render
  // so client + server card DOM are byte-identical for the gesture tests).
  renderList();
})();
`;



// ===========================================================================
// §13-D5 WIRING ROUND — the relocated four-type editor bound to REAL data.
// ===========================================================================
// S1.4 landed variant-scoped rule CRUD (same validation as the legacy replace-
// set chain, shared prepareOneRule, atomic content_version bumps):
//   GET/POST     /variants/:id/rules
//   PATCH/DELETE /variants/:id/rules/:rule_id
//   POST         /variants/:variant_id/rules/:rule_id/duplicate (pre-existing)
//
// The Auction tab has NO variant context of its own (it is per-AUCTION, never
// per-variant/quote/funnel), so this component carries its OWN quote -> funnel
// -> variant picker, built ENTIRELY from existing endpoints — no new read
// endpoint required (verified):
//   GET /quotes/:id/funnels                          -> funnels WITH nested
//     variants in ONE call (listQuoteFunnelsHandler already embeds
//     `variants: variants.map(variantRowToApi)` per funnel item).
//   GET /sections?activity=X&status=active&page_size=200 -> the activity's
//     answer-field universe. SAME derivation ui-quotes.ts's own answerFields
//     assembly already performs (internal_field + "<section_name> · <field>"),
//     re-implemented here in ES5 since the browser cannot call that TS helper.
//   GET /offers?page_size=200                         -> the redirect_direct_
//     offer by-name target picker (the SAME general list the quote/variant
//     editor already reads from, unfiltered — matching precedent exactly).
//
// §10/S5.1 removal note: renderRoutingRulesPanel/ROUTING_RULES_SCRIPT (the OLD
// per-variant four-type editor this comment used to describe as "stays
// BYTE-IDENTICAL above") had ZERO real callers in any served page (confirmed:
// the quote/variant editor's ROUTING_RULES_SCRIPT concatenation targeted DOM
// this phase's board rewrite already deleted) and were removed entirely. This
// IS the four-type editor now — a NEW, self-contained, REST-driven editor —
// reusing the SAME §21.4 condition builder (window.lgRulesBuilder /
// RULES_BUILDER_SCRIPT) the quote-rules rail (renderQuoteRulesRail, above)
// mounts, the identical pattern.
//
// Every mutating action (create/edit/delete/duplicate/enable-disable) renders
// the SERVER's own validation messages verbatim on failure (never invented,
// never reworded) — the `fields` object prepareOneRule/validateFunnelRule
// return on a 400.
// ===========================================================================

export interface RelocatedRuleQuote {
  id: number;
  public_id: string;
  quote_name: string;
  activity: string;
}

export interface RelocatedRulesPanelData {
  quotes: readonly RelocatedRuleQuote[];
  // The auction's OWN attributed quote (a.quote_id resolved against the SAME
  // quotes list the Auction editor already loads for its Settings picker) —
  // pre-selected so the common case (this auction's own quote) needs no
  // picking, while any quote remains reachable for cross-quote sharing.
  default_quote_public_id: string | null;
}

// Rework M3 (§5-M3, §4.3-9, D5): leadgen_funnel_rules' CHECK is tightened, via
// full-table recreation, to exactly these four auction-domain types (migration
// 0048). §10/S5.1: this used to ALSO back the now-deleted renderRoutingRulesPanel
// (the old per-variant editor); its ONLY remaining consumer is the relocated
// editor's own type `<select>` below, so it is now file-private (no external
// importer needs it — ui-quotes.ts's toRoutingRuleRowData, the other former
// consumer, was deleted in the same sweep).
type RoutingRuleType = "redirect_direct_offer" | "eligibility" | "disqualification" | "auction_entry";

const ROUTING_RULE_TYPES: readonly RoutingRuleType[] = [
  "redirect_direct_offer",
  "eligibility",
  "disqualification",
  "auction_entry",
];

// Human labels for the table's Type column + the modal's type select (jargon
// policy: rendered copy never shows the raw rule_type enum token).
const RELOCATED_RULE_TYPE_LABELS: Record<string, string> = {
  redirect_direct_offer: "Redirect to offer",
  eligibility: "Eligibility",
  disqualification: "Disqualification",
  auction_entry: "Auction entry",
};

const RELOCATED_RULES_STYLES = `<style>
.lg-frr-picker{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:10px}
@media (max-width:640px){.lg-frr-picker{grid-template-columns:1fr}}
.lg-frr-table{width:100%;border-collapse:collapse;margin:8px 0}
.lg-frr-table th,.lg-frr-table td{text-align:left;padding:6px 8px;border-bottom:1px solid rgba(0,0,0,0.1)}
.lg-frr-actions-cell{white-space:nowrap}
.lg-frr-pill{font-size:12px;padding:2px 8px;border:1px solid rgba(0,0,0,0.2);border-radius:999px}
.lg-frr-pill.off{opacity:0.6}
.lg-frr-modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.4);display:flex;align-items:flex-start;justify-content:center;overflow:auto;z-index:1000;padding:32px 16px}
#lg-frr-root [hidden]{display:none}
.lg-frr-modal{max-width:640px;width:100%;margin:0 auto}
.lg-frr-err{white-space:pre-line}
</style>`;

// FROZEN INTERFACE — ui-auctions.ts's renderRelocatedFunnelRulesPanel wraps
// exactly this with the Auction tab's heading/description.
export function renderRelocatedRulesEditor(data: RelocatedRulesPanelData): string {
  const quoteOpts = data.quotes
    .map(
      (q) =>
        `<option value="${escapeHtml(q.public_id)}"${q.public_id === data.default_quote_public_id ? " selected" : ""}>${escapeHtml(q.quote_name)}</option>`,
    )
    .join("");
  const typeOpts = ROUTING_RULE_TYPES.map(
    (t) => `<option value="${t}">${escapeHtml(RELOCATED_RULE_TYPE_LABELS[t] ?? t)}</option>`,
  ).join("");
  const blob = { quotes: data.quotes, default_quote_public_id: data.default_quote_public_id };
  const blobJson = JSON.stringify(blob).replace(/</g, "\\u003c");

  return (
    `<div id="lg-frr-root" data-lg-frr-root>` +
    RELOCATED_RULES_STYLES +
    `<div class="lg-frr-picker">` +
    `<div class="form-group"><label class="form-label" for="lg-frr-quote">Quote</label><select id="lg-frr-quote" class="form-select" data-lg-frr-quote><option value="">— choose a quote —</option>${quoteOpts}</select></div>` +
    `<div class="form-group"><label class="form-label" for="lg-frr-funnel">Funnel</label><select id="lg-frr-funnel" class="form-select" data-lg-frr-funnel disabled><option value="">— pick a quote first —</option></select></div>` +
    `<div class="form-group"><label class="form-label" for="lg-frr-variant">Variant</label><select id="lg-frr-variant" class="form-select" data-lg-frr-variant disabled><option value="">— pick a funnel first —</option></select></div>` +
    `</div>` +
    `<p class="alert alert-error lg-frr-err" id="lg-frr-toplevel-error" role="alert" hidden></p>` +
    `<p class="form-help" data-lg-frr-empty>Pick a quote, funnel and variant to manage its eligibility rules.</p>` +
    `<div data-lg-frr-body hidden>` +
    `<table class="lg-frr-table" id="lg-frr-table" aria-label="Funnel eligibility rules">` +
    `<thead><tr><th>Priority</th><th>Name</th><th>Type</th><th>Status</th><th>Actions</th></tr></thead>` +
    `<tbody id="lg-frr-table-body"></tbody>` +
    `</table>` +
    `<div class="toolbar"><button type="button" class="btn btn-secondary" data-lg-frr-new>+ New rule</button></div>` +
    `</div>` +
    `<div class="lg-frr-modal-overlay" id="lg-frr-modal" data-lg-frr-modal role="dialog" aria-modal="true" aria-label="Funnel eligibility rule" hidden>` +
    `<div class="lg-frr-modal card">` +
    `<h3 id="lg-frr-modal-title">New rule</h3>` +
    `<div class="lg-rule-grid">` +
    `<div class="form-group"><label class="form-label" for="lg-frr-name">Rule name</label><input id="lg-frr-name" class="form-input" type="text" maxlength="80" /></div>` +
    `<div class="form-group"><label class="form-label" for="lg-frr-type">Rule type</label><select id="lg-frr-type" class="form-select">${typeOpts}</select></div>` +
    `<div class="form-group"><label class="form-label" for="lg-frr-priority">Priority (1 = highest)</label><input id="lg-frr-priority" class="form-input" type="number" min="1" max="100" step="1" value="100" /></div>` +
    `</div>` +
    `<div class="lg-rule-grid">` +
    `<div class="form-group"><label class="form-label" for="lg-frr-status">Status</label><select id="lg-frr-status" class="form-select"><option value="active">Active</option><option value="disabled">Disabled</option></select></div>` +
    `<div class="form-group"><label class="form-label" for="lg-frr-match">Match</label><select id="lg-frr-match" class="form-select"><option value="all">ALL of the following</option><option value="any">ANY of the following</option></select></div>` +
    `</div>` +
    `<div class="lg-rule-action-panel" data-lg-frr-type-panel="redirect_direct_offer" hidden>` +
    `<div class="form-group"><label class="form-label" for="lg-frr-offer">Redirect to offer</label><select id="lg-frr-offer" class="form-select" aria-label="Target offer"><option value="">— choose an offer —</option></select></div>` +
    `<div class="form-group"><label class="form-label" for="lg-frr-redirect-pct">Redirect %</label><input id="lg-frr-redirect-pct" class="form-input" type="number" min="0" max="100" step="any" /><p class="form-help">0 or empty = no redirect; 100 = all matched visitors.</p></div>` +
    `<details class="lg-advanced"><summary>Advanced — raw redirect URL (allowlist-gated)</summary>` +
    `<div class="form-group"><input id="lg-frr-redirect-url" class="form-input" type="text" placeholder="https://…" /></div>` +
    `<label class="lg-check"><input type="checkbox" id="lg-frr-allowlisted" /> Redirect URL is on the approved list</label>` +
    `</details>` +
    `</div>` +
    `<div class="lg-rule-action-panel" data-lg-frr-type-panel="eligibility" hidden><p class="form-help">No extra fields — the conditions below decide who is eligible.</p></div>` +
    `<div class="lg-rule-action-panel" data-lg-frr-type-panel="disqualification" hidden><p class="form-help">No extra fields — the conditions below decide who is disqualified.</p></div>` +
    `<div class="lg-rule-action-panel" data-lg-frr-type-panel="auction_entry" hidden><p class="form-help">No extra fields — the conditions below decide who enters the auction.</p></div>` +
    `<div class="form-group"><label class="form-label">Conditions</label><div id="lg-frr-cond-mount"></div><input type="hidden" id="lg-frr-cond-out" /></div>` +
    `<p class="alert alert-error lg-frr-err" id="lg-frr-error" role="alert" hidden></p>` +
    `<div class="toolbar">` +
    `<button type="button" class="btn btn-primary" data-lg-frr-save>Save rule</button>` +
    `<button type="button" class="btn btn-outline" data-lg-frr-cancel>Cancel</button>` +
    `<button type="button" class="btn btn-danger" data-lg-frr-delete>Delete</button>` +
    `</div>` +
    `</div>` +
    `</div>` +
    `<script id="lg-frr-data" type="application/json">${blobJson}</script>` +
    `</div>`
  );
}

// ---------------------------------------------------------------------------
// ES5 island — quote/funnel/variant picker + REST-driven CRUD over the S1.4
// variant-rule endpoints. Self-contained (redeclares its own tiny DOM helpers,
// the SAME per-island convention QUOTE_RULES_SCRIPT/ROUTING_RULES_SCRIPT
// already follow — no cross-island shared state). Mounts window.lgRulesBuilder
// (RULES_BUILDER_SCRIPT) for the Conditions section exactly as the quote-rules
// modal does. Strict ES5 (var/function only; no arrows/const/let/template
// literals/backticks — L-185 / the layout.ts inline-script constraint). DOM
// writes use createElement/textContent/setAttribute only (no innerHTML).
// ---------------------------------------------------------------------------
export const RELOCATED_RULES_SCRIPT = `(function () {
  'use strict';

  var API = '/api/admin/leadgen';
  var root = document.getElementById('lg-frr-root');
  if (!root) { return; }
  var dataEl = document.getElementById('lg-frr-data');
  var boot = null;
  try { boot = dataEl ? JSON.parse(dataEl.textContent || '') : null; } catch (e) { boot = null; }
  if (!boot) { return; }

  function isArr(v) { return Object.prototype.toString.call(v) === '[object Array]'; }
  function qs(r, s) { return r ? r.querySelector(s) : null; }
  function qsa(r, s) { return r ? r.querySelectorAll(s) : []; }
  function el(tag, cls) { var n = document.createElement(tag); if (cls) { n.className = cls; } return n; }
  function txt(node, t) { node.textContent = t == null ? '' : String(t); return node; }
  function byId(id) { return document.getElementById(id); }
  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : null; }

  var quotes = isArr(boot.quotes) ? boot.quotes : [];
  // Per-quote cache: { funnels: [...with nested .variants...], fields: [...], offers: [...] }
  var quoteCache = {};
  var currentQuotePub = '';
  var currentFunnel = null;   // the selected funnel object (from quoteCache[...].funnels)
  var currentVariantPub = '';
  var currentRules = [];
  var editingPublicId = null; // null while creating
  var mountedConditions = null;

  var quoteSel = byId('lg-frr-quote');
  var funnelSel = byId('lg-frr-funnel');
  var variantSel = byId('lg-frr-variant');
  var emptyMsg = qs(root, '[data-lg-frr-empty]');
  var bodyWrap = qs(root, '[data-lg-frr-body]');
  var tableBody = byId('lg-frr-table-body');
  var topError = byId('lg-frr-toplevel-error');
  var newBtn = qs(root, '[data-lg-frr-new]');
  var modal = byId('lg-frr-modal');

  function showTopError(msg) {
    if (!topError) { return; }
    if (msg) { txt(topError, msg); topError.hidden = false; } else { topError.hidden = true; }
  }
  function fieldsErrorText(body) {
    if (!body) { return 'Something went wrong.'; }
    if (body.fields && typeof body.fields === 'object') {
      var lines = [];
      var k;
      for (k in body.fields) { if (Object.prototype.hasOwnProperty.call(body.fields, k)) { lines.push(String(body.fields[k])); } }
      if (lines.length > 0) { return lines.join('\\n'); }
    }
    if (typeof body.error === 'string') { return body.error; }
    return 'Something went wrong.';
  }

  // ---- quote -> funnel(+variants) / fields / offers loading -----------------

  function fieldsFromSections(items) {
    var out = [];
    var seen = {};
    var i, j;
    for (i = 0; i < items.length; i++) {
      var content = items[i].content_json;
      var components = (content && typeof content === 'object' && isArr(content.components)) ? content.components : [];
      for (j = 0; j < components.length; j++) {
        var node = components[j];
        if (!node || typeof node !== 'object') { continue; }
        var f = node.internal_field;
        if (typeof f !== 'string' || f === '' || seen[f]) { continue; }
        seen[f] = true;
        out.push({ internal_field: f, label: (items[i].section_name || '') + ' \\u00b7 ' + f });
      }
    }
    return out;
  }

  function loadQuote(quotePub, then) {
    if (quoteCache[quotePub]) { then(quoteCache[quotePub]); return; }
    var quote = null;
    var i;
    for (i = 0; i < quotes.length; i++) { if (quotes[i].public_id === quotePub) { quote = quotes[i]; break; } }
    if (!quote) { then(null); return; }
    var funnelsP = fetch(API + '/quotes/' + encodeURIComponent(quotePub) + '/funnels').then(function (r) { return r.json(); });
    var sectionsP = fetch(API + '/sections?activity=' + encodeURIComponent(quote.activity) + '&status=active&page_size=200').then(function (r) { return r.json(); });
    var offersP = fetch(API + '/offers?page_size=200').then(function (r) { return r.json(); });
    Promise.all([funnelsP, sectionsP, offersP]).then(function (results) {
      var funnelsBody = results[0], sectionsBody = results[1], offersBody = results[2];
      var entry = {
        funnels: (funnelsBody && isArr(funnelsBody.items)) ? funnelsBody.items : [],
        fields: fieldsFromSections((sectionsBody && isArr(sectionsBody.items)) ? sectionsBody.items : []),
        offers: (offersBody && isArr(offersBody.items)) ? offersBody.items : []
      };
      quoteCache[quotePub] = entry;
      then(entry);
    }, function () { showTopError('Could not load this quote\\u2019s funnels/sections/offers.'); then(null); });
  }

  function resetSelect(sel, placeholder) {
    while (sel.firstChild) { sel.removeChild(sel.firstChild); }
    var opt = el('option'); opt.value = ''; txt(opt, placeholder); sel.appendChild(opt);
    sel.disabled = true;
  }

  function populateFunnelSelect(funnels) {
    resetSelect(funnelSel, '— choose a funnel —');
    var i;
    for (i = 0; i < funnels.length; i++) {
      var opt = el('option'); opt.value = funnels[i].public_id; txt(opt, funnels[i].funnel_name || funnels[i].public_id);
      funnelSel.appendChild(opt);
    }
    funnelSel.disabled = funnels.length === 0;
  }
  function populateVariantSelect(variants) {
    resetSelect(variantSel, '— choose a variant —');
    var i;
    for (i = 0; i < variants.length; i++) {
      var opt = el('option'); opt.value = variants[i].public_id; txt(opt, variants[i].variant_label || variants[i].public_id);
      variantSel.appendChild(opt);
    }
    variantSel.disabled = variants.length === 0;
  }

  function showBody(on) {
    if (bodyWrap) { bodyWrap.hidden = !on; }
    if (emptyMsg) { emptyMsg.hidden = on; }
  }

  function onQuoteChange() {
    showTopError('');
    currentFunnel = null;
    currentVariantPub = '';
    currentRules = [];
    showBody(false);
    resetSelect(funnelSel, '— pick a quote first —');
    resetSelect(variantSel, '— pick a funnel first —');
    currentQuotePub = quoteSel.value;
    if (currentQuotePub === '') { return; }
    loadQuote(currentQuotePub, function (entry) {
      if (!entry) { return; }
      populateFunnelSelect(entry.funnels);
    });
  }
  function onFunnelChange() {
    showTopError('');
    currentVariantPub = '';
    currentRules = [];
    showBody(false);
    resetSelect(variantSel, '— pick a funnel first —');
    var funnelPub = funnelSel.value;
    currentFunnel = null;
    if (funnelPub === '') { return; }
    var entry = quoteCache[currentQuotePub];
    var funnels = entry ? entry.funnels : [];
    var i;
    for (i = 0; i < funnels.length; i++) { if (funnels[i].public_id === funnelPub) { currentFunnel = funnels[i]; break; } }
    if (!currentFunnel) { return; }
    populateVariantSelect(isArr(currentFunnel.variants) ? currentFunnel.variants : []);
  }
  function onVariantChange() {
    showTopError('');
    currentVariantPub = variantSel.value;
    if (currentVariantPub === '') { showBody(false); return; }
    refetchRules();
  }
  if (quoteSel) { quoteSel.addEventListener('change', onQuoteChange); }
  if (funnelSel) { funnelSel.addEventListener('change', onFunnelChange); }
  if (variantSel) { variantSel.addEventListener('change', onVariantChange); }

  // ---- rules list + table -----------------------------------------------------

  function refetchRules() {
    fetch(API + '/variants/' + encodeURIComponent(currentVariantPub) + '/rules')
      .then(function (r) { return r.json(); })
      .then(function (body) {
        currentRules = (body && isArr(body.items)) ? body.items : [];
        renderTable();
        showBody(true);
      }, function () { showTopError('Could not load this variant\\u2019s rules.'); });
  }
  function sortedRules() {
    var copy = currentRules.slice();
    copy.sort(function (a, b) { return a.priority - b.priority; });
    return copy;
  }
  function ruleByPub(pub) { var i; for (i = 0; i < currentRules.length; i++) { if (currentRules[i].public_id === pub) { return currentRules[i]; } } return null; }

  function renderTable() {
    if (!tableBody) { return; }
    while (tableBody.firstChild) { tableBody.removeChild(tableBody.firstChild); }
    var rows = sortedRules();
    var i;
    for (i = 0; i < rows.length; i++) { tableBody.appendChild(buildRow(rows[i])); }
  }
  function buildRow(rule) {
    var tr = el('tr');
    tr.setAttribute('data-frr-row', '');
    tr.setAttribute('data-rule-public-id', rule.public_id);
    tr.appendChild(txt(el('td'), rule.priority));
    var nameTd = el('td'); txt(nameTd, (rule.rule_name && rule.rule_name.replace(/^\\s+|\\s+$/g, '') !== '') ? rule.rule_name : '(unnamed rule)'); tr.appendChild(nameTd);
    tr.appendChild(txt(el('td'), RULE_TYPE_LABEL(rule.rule_type)));
    var disabled = rule.status === 'disabled';
    var statusTd = el('td');
    var pill = el('span', 'lg-frr-pill' + (disabled ? ' off' : '')); txt(pill, disabled ? 'Disabled' : 'Active'); statusTd.appendChild(pill);
    tr.appendChild(statusTd);
    var actTd = el('td', 'lg-frr-actions-cell');
    actTd.appendChild(actBtn('Edit', 'data-frr-edit'));
    actTd.appendChild(document.createTextNode(' '));
    actTd.appendChild(actBtn('Duplicate', 'data-frr-duplicate'));
    actTd.appendChild(document.createTextNode(' '));
    actTd.appendChild(actBtn(disabled ? 'Enable' : 'Disable', 'data-frr-toggle'));
    actTd.appendChild(document.createTextNode(' '));
    actTd.appendChild(actBtn('Delete', 'data-frr-delete'));
    tr.appendChild(actTd);
    return tr;
  }
  function actBtn(label, attr) {
    var b = el('button', 'btn btn-sm btn-outline'); b.type = 'button'; b.setAttribute(attr, ''); txt(b, label); return b;
  }
  function RULE_TYPE_LABEL(t) {
    if (t === 'redirect_direct_offer') { return 'Redirect to offer'; }
    if (t === 'eligibility') { return 'Eligibility'; }
    if (t === 'disqualification') { return 'Disqualification'; }
    if (t === 'auction_entry') { return 'Auction entry'; }
    return t;
  }

  if (tableBody) {
    tableBody.addEventListener('click', function (ev) {
      var tr = closestRow(ev.target);
      if (!tr) { return; }
      var pub = tr.getAttribute('data-rule-public-id');
      var rule = ruleByPub(pub);
      if (!rule) { return; }
      if (hasAttr(ev.target, 'data-frr-edit')) { openModal(rule); return; }
      if (hasAttr(ev.target, 'data-frr-duplicate')) { duplicateRule(pub); return; }
      if (hasAttr(ev.target, 'data-frr-toggle')) { toggleRule(rule); return; }
      if (hasAttr(ev.target, 'data-frr-delete')) { deleteRule(pub); return; }
    });
  }
  function closestRow(node) { var n = node; while (n && n !== tableBody) { if (n.getAttribute && n.hasAttribute && n.hasAttribute('data-frr-row')) { return n; } n = n.parentNode; } return null; }
  function hasAttr(node, attr) { return !!(node && node.hasAttribute && node.hasAttribute(attr)); }

  if (newBtn) { newBtn.addEventListener('click', function () { openModal(null); }); }

  function duplicateRule(pub) {
    fetch(API + '/variants/' + encodeURIComponent(currentVariantPub) + '/rules/' + encodeURIComponent(pub) + '/duplicate', { method: 'POST' })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); })
      .then(function (res) { if (!res.ok) { showTopError(fieldsErrorText(res.body)); return; } refetchRules(); }, function () { showTopError('Network error duplicating the rule.'); });
  }
  function deleteRule(pub) {
    if (!window.confirm('Delete this rule?')) { return; }
    fetch(API + '/variants/' + encodeURIComponent(currentVariantPub) + '/rules/' + encodeURIComponent(pub), { method: 'DELETE' })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); })
      .then(function (res) { if (!res.ok) { showTopError(fieldsErrorText(res.body)); return; } refetchRules(); }, function () { showTopError('Network error deleting the rule.'); });
  }
  function toggleRule(rule) {
    var nextStatus = rule.status === 'disabled' ? 'active' : 'disabled';
    fetch(API + '/variants/' + encodeURIComponent(currentVariantPub) + '/rules/' + encodeURIComponent(rule.public_id), {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: nextStatus })
    })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); })
      .then(function (res) { if (!res.ok) { showTopError(fieldsErrorText(res.body)); return; } refetchRules(); }, function () { showTopError('Network error updating the rule.'); });
  }

  // ---- modal ------------------------------------------------------------------

  var nameEl = byId('lg-frr-name');
  var typeEl = byId('lg-frr-type');
  var priorityEl = byId('lg-frr-priority');
  var statusEl = byId('lg-frr-status');
  var matchEl = byId('lg-frr-match');
  var offerEl = byId('lg-frr-offer');
  var redirectPctEl = byId('lg-frr-redirect-pct');
  var redirectUrlEl = byId('lg-frr-redirect-url');
  var allowlistedEl = byId('lg-frr-allowlisted');
  var modalError = byId('lg-frr-error');
  var condMount = byId('lg-frr-cond-mount');
  var condOut = byId('lg-frr-cond-out');

  function showModalError(msg) { if (!modalError) { return; } if (msg) { txt(modalError, msg); modalError.hidden = false; } else { modalError.hidden = true; } }

  function populateOfferSelect() {
    if (!offerEl) { return; }
    while (offerEl.firstChild) { offerEl.removeChild(offerEl.firstChild); }
    var ph = el('option'); ph.value = ''; txt(ph, '— choose an offer —'); offerEl.appendChild(ph);
    var entry = quoteCache[currentQuotePub];
    var offers = entry ? entry.offers : [];
    var i;
    for (i = 0; i < offers.length; i++) {
      var opt = el('option'); opt.value = String(offers[i].id); txt(opt, offers[i].offer_name || ('#' + offers[i].id));
      offerEl.appendChild(opt);
    }
  }
  function setTypePanel(ruleType) {
    var panels = qsa(modal, '[data-lg-frr-type-panel]');
    var i;
    for (i = 0; i < panels.length; i++) { panels[i].hidden = panels[i].getAttribute('data-lg-frr-type-panel') !== ruleType; }
  }
  if (typeEl) { typeEl.addEventListener('change', function () { setTypePanel(typeEl.value); }); }

  function openModal(rule) {
    editingPublicId = rule ? rule.public_id : null;
    txt(byId('lg-frr-modal-title'), rule ? 'Edit rule' : 'New rule');
    nameEl.value = rule && rule.rule_name ? rule.rule_name : '';
    typeEl.value = rule ? rule.rule_type : 'eligibility';
    priorityEl.value = rule && rule.priority != null ? String(rule.priority) : '100';
    statusEl.value = rule && rule.status === 'disabled' ? 'disabled' : 'active';
    matchEl.value = rule && rule.match_mode === 'any' ? 'any' : 'all';
    populateOfferSelect();
    offerEl.value = rule && rule.target_offer_id != null ? String(rule.target_offer_id) : '';
    redirectPctEl.value = rule && rule.redirect_pct != null ? String(rule.redirect_pct) : '';
    redirectUrlEl.value = rule && rule.redirect_url ? rule.redirect_url : '';
    allowlistedEl.checked = !!(rule && rule.redirect_url_allowlisted);
    setTypePanel(typeEl.value);
    showModalError('');

    var raw = rule && rule.conditions_json ? JSON.stringify(rule.conditions_json) : '';
    condOut.value = raw;
    if (condMount) { while (condMount.firstChild) { condMount.removeChild(condMount.firstChild); } }
    mountedConditions = null;
    var entry = quoteCache[currentQuotePub];
    var fields = entry ? entry.fields : [];
    if (window.lgRulesBuilder && condMount) {
      try { mountedConditions = window.lgRulesBuilder.mount(condMount, raw, condOut, { fields: fields }); } catch (e) { mountedConditions = null; }
    }
    modal.hidden = false;
  }
  function closeModal() { modal.hidden = true; editingPublicId = null; }

  function collectBody() {
    var body = {
      rule_name: nameEl.value,
      rule_type: typeEl.value,
      priority: num(priorityEl.value) || 100,
      status: statusEl.value,
      match_mode: matchEl.value,
      conditions_json: parseCondOut()
    };
    if (typeEl.value === 'redirect_direct_offer') {
      body.target_offer_id = offerEl.value !== '' ? Number(offerEl.value) : null;
      body.redirect_pct = redirectPctEl.value !== '' ? num(redirectPctEl.value) : null;
      body.redirect_url = allowlistedEl.checked && redirectUrlEl.value !== '' ? redirectUrlEl.value : null;
      body.redirect_url_allowlisted = allowlistedEl.checked;
    } else {
      body.target_offer_id = null;
      body.redirect_pct = null;
      body.redirect_url = null;
      body.redirect_url_allowlisted = false;
    }
    return body;
  }
  function parseCondOut() {
    if (!condOut || !condOut.value) { return { groups: [] }; }
    try { return JSON.parse(condOut.value); } catch (e) { return { groups: [] }; }
  }

  function save() {
    var body = collectBody();
    var url = editingPublicId
      ? (API + '/variants/' + encodeURIComponent(currentVariantPub) + '/rules/' + encodeURIComponent(editingPublicId))
      : (API + '/variants/' + encodeURIComponent(currentVariantPub) + '/rules');
    var method = editingPublicId ? 'PATCH' : 'POST';
    fetch(url, { method: method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); })
      .then(function (res) {
        if (!res.ok) { showModalError(fieldsErrorText(res.body)); return; }
        closeModal(); refetchRules();
      }, function () { showModalError('Network error saving the rule.'); });
  }
  function deleteFromModal() {
    if (!editingPublicId) { closeModal(); return; }
    if (!window.confirm('Delete this rule?')) { return; }
    fetch(API + '/variants/' + encodeURIComponent(currentVariantPub) + '/rules/' + encodeURIComponent(editingPublicId), { method: 'DELETE' })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); })
      .then(function (res) { if (!res.ok) { showModalError(fieldsErrorText(res.body)); return; } closeModal(); refetchRules(); }, function () { showModalError('Network error deleting the rule.'); });
  }

  var saveBtn = qs(modal, '[data-lg-frr-save]');
  var cancelBtn = qs(modal, '[data-lg-frr-cancel]');
  var deleteBtn = qs(modal, '[data-lg-frr-delete]');
  if (saveBtn) { saveBtn.addEventListener('click', save); }
  if (cancelBtn) { cancelBtn.addEventListener('click', closeModal); }
  if (deleteBtn) { deleteBtn.addEventListener('click', deleteFromModal); }
})();
`;
