export type LoadState = "idle" | "loading" | "ready" | "empty" | "error";

export interface ProductState<T> {
  readonly state: LoadState;
  readonly items: ReadonlyArray<T>;
  readonly message: string;
}

const ACCOUNT_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const CURRENCY = /^[A-Z]{3}$/;
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TIME_ZONE = /^[!-~]{1,128}$/;

export class CoreWireError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "CoreWireError";
    this.code = code;
  }
}

function invalidWire(): never {
  throw new CoreWireError("invalid_response", "The service returned an invalid response.");
}

function exactKeys(value: Record<string, unknown>, keys: ReadonlyArray<string>): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

/** Decode Core mutation/detail responses. Collection and query routes have distinct wire shapes. */
export function unwrapCoreResult(payload: unknown): unknown {
  if (!isRecord(payload) || !exactKeys(payload, ["result"])) invalidWire();
  return payload.result;
}

export interface CorePage {
  readonly items: ReadonlyArray<Record<string, unknown>>;
  readonly nextCursor: string | null;
}

/** Decode the Core list-page wire shape: { items, next_cursor }. */
export function unwrapCorePage(payload: unknown): CorePage {
  if (!isRecord(payload) || !exactKeys(payload, ["items", "next_cursor"])
      || !Array.isArray(payload.items) || !payload.items.every(isRecord)
      || (payload.next_cursor !== null && typeof payload.next_cursor !== "string")) invalidWire();
  return Object.freeze({
    items: Object.freeze(payload.items.map((item) => Object.freeze({ ...item }))),
    nextCursor: payload.next_cursor,
  });
}

/** Decode repository-style result collections such as report recipients. */
export function unwrapCoreResultCollection(payload: unknown): ReadonlyArray<Record<string, unknown>> {
  const result = unwrapCoreResult(payload);
  if (!isRecord(result) || !exactKeys(result, ["items", "outcome"])
      || result.outcome !== "listed" || !Array.isArray(result.items)
      || !result.items.every(isRecord)) invalidWire();
  return Object.freeze(result.items.map((item) => Object.freeze({ ...item })));
}

/** Decode the dedicated Controls response: { controls }. */
export function unwrapCoreControls(payload: unknown): ReadonlyArray<Record<string, unknown>> {
  if (!isRecord(payload) || !exactKeys(payload, ["controls"])
      || !Array.isArray(payload.controls) || !payload.controls.every(isRecord)) invalidWire();
  return Object.freeze(payload.controls.map((item) => Object.freeze({ ...item })));
}

export function unwrapCreatedConnectionOrFlow(payload: unknown): Record<string, unknown> {
  const result = unwrapCoreResult(payload);
  if (!isRecord(result)) invalidWire();
  const id = typeof result.connection_id === "string"
    ? result.connection_id
    : typeof result.flow_id === "string" ? result.flow_id : null;
  if (id === null || !UUID_V7.test(id)) invalidWire();
  return result;
}

export function unwrapCreatedReport(payload: unknown): Record<string, unknown> {
  const result = unwrapCoreResult(payload);
  if (!isRecord(result) || !isRecord(result.report)
      || typeof result.report.report_id !== "string" || !UUID_V7.test(result.report.report_id)) invalidWire();
  return result.report;
}

export function unwrapReportQueryRows(payload: unknown): ReadonlyArray<Record<string, unknown>> {
  if (!isRecord(payload)
      || (!exactKeys(payload, ["next_cursor", "result"])
        && !exactKeys(payload, ["comparison_result", "next_cursor", "result"]))
      || (payload.next_cursor !== null && typeof payload.next_cursor !== "string")) invalidWire();
  const result = payload.result;
  if (!isRecord(result) || typeof result.outcome !== "string") invalidWire();
  if (result.outcome !== "completed") {
    const accepted = new Set(["async_required", "cancelled", "not_found", "resource_changed"]);
    if (!accepted.has(result.outcome)) invalidWire();
    throw new CoreWireError(result.outcome, "The report did not complete synchronously.");
  }
  if (!isRecord(result.result) || !Array.isArray(result.result.rows)
      || !result.result.rows.every(isRecord)) invalidWire();
  return Object.freeze(result.result.rows.map((row) => Object.freeze({ ...row })));
}

export interface ReportComparisonRows {
  readonly kind: "prior_period" | "year_over_year";
  readonly dateRange: Readonly<{ start: string; end: string }>;
  readonly rows: ReadonlyArray<Record<string, unknown>>;
}

export function unwrapReportComparisonRows(payload: unknown): ReadonlyArray<ReportComparisonRows> {
  if (!isRecord(payload) || !Object.hasOwn(payload, "comparison_result")) return Object.freeze([]);
  const comparison = payload.comparison_result;
  if (!isRecord(comparison)
      || !exactKeys(comparison, ["series", "version"])
      || comparison.version !== "report_comparison_query_result.v1"
      || !Array.isArray(comparison.series)) invalidWire();
  return Object.freeze(comparison.series.map((candidate) => {
    if (!isRecord(candidate)
        || !exactKeys(candidate, ["date_range", "kind", "query"])
        || (candidate.kind !== "prior_period" && candidate.kind !== "year_over_year")
        || !isRecord(candidate.date_range)
        || !exactKeys(candidate.date_range, ["end", "start"])
        || typeof candidate.date_range.start !== "string"
        || typeof candidate.date_range.end !== "string") invalidWire();
    return Object.freeze({
      kind: candidate.kind,
      dateRange: Object.freeze({
        start: candidate.date_range.start,
        end: candidate.date_range.end,
      }),
      rows: unwrapCalculatedReportQueryRows({
        result: candidate.query,
        next_cursor: null,
      }),
    });
  }));
}

export interface ReportAdvancedResult {
  readonly topN: number;
  readonly subtotals: ReadonlyArray<Readonly<{
    level: number;
    grouping: Readonly<Record<string, unknown>>;
    values: Readonly<Record<string, unknown>>;
  }>>;
  readonly drillThrough: Readonly<{
    enabled: boolean;
    maximumRows: number;
    snapshotSha256: string;
  }>;
}

export function unwrapReportAdvancedResult(payload: unknown): ReportAdvancedResult | null {
  if (!isRecord(payload) || !isRecord(payload.result)
      || !Object.hasOwn(payload.result, "advanced_result")) return null;
  const advanced = payload.result.advanced_result;
  if (!isRecord(advanced)
      || !exactKeys(advanced, ["drill_through", "subtotals", "top_n", "version"])
      || advanced.version !== "report_advanced_query_result.v1"
      || !Number.isSafeInteger(advanced.top_n)
      || !Array.isArray(advanced.subtotals)
      || !advanced.subtotals.every((item) => isRecord(item)
        && exactKeys(item, ["grouping", "level", "values"])
        && Number.isSafeInteger(item.level)
        && isRecord(item.grouping)
        && isRecord(item.values))
      || !isRecord(advanced.drill_through)
      || !exactKeys(advanced.drill_through, ["enabled", "maximum_rows", "snapshot_sha256"])
      || typeof advanced.drill_through.enabled !== "boolean"
      || !Number.isSafeInteger(advanced.drill_through.maximum_rows)
      || typeof advanced.drill_through.snapshot_sha256 !== "string"
      || !/^[0-9a-f]{64}$/.test(advanced.drill_through.snapshot_sha256)) invalidWire();
  return Object.freeze({
    topN: advanced.top_n as number,
    subtotals: Object.freeze((advanced.subtotals as Array<Record<string, unknown>>).map((item) => Object.freeze({
      level: item.level as number,
      grouping: Object.freeze({ ...(item.grouping as Record<string, unknown>) }),
      values: Object.freeze({ ...(item.values as Record<string, unknown>) }),
    }))),
    drillThrough: Object.freeze({
      enabled: advanced.drill_through.enabled,
      maximumRows: advanced.drill_through.maximum_rows as number,
      snapshotSha256: advanced.drill_through.snapshot_sha256,
    }),
  });
}

export interface ReportDrillResult {
  readonly fields: ReadonlyArray<Readonly<{ fieldId: string; label: string }>>;
  readonly rows: ReadonlyArray<Record<string, unknown>>;
}

export function unwrapReportDrillResult(payload: unknown): ReportDrillResult {
  const result = unwrapCoreResult(payload);
  if (!isRecord(result) || result.outcome !== "completed" || !isRecord(result.detail_result)
      || result.detail_result.version !== "report_drill_through_result.v1"
      || !Array.isArray(result.detail_result.field_metadata)
      || !result.detail_result.field_metadata.every((field) => isRecord(field)
        && typeof field.field_id === "string" && typeof field.label === "string")
      || !Array.isArray(result.detail_result.rows)
      || !result.detail_result.rows.every(isRecord)) invalidWire();
  return Object.freeze({
    fields: Object.freeze(result.detail_result.field_metadata.map((field) => Object.freeze({
      fieldId: (field as Record<string, unknown>).field_id as string,
      label: (field as Record<string, unknown>).label as string,
    }))),
    rows: Object.freeze(result.detail_result.rows.map((row) => Object.freeze({ ...row }))),
  });
}

export function unwrapCalculatedReportQueryRows(
  payload: unknown,
): ReadonlyArray<Record<string, unknown>> {
  const base = unwrapReportQueryRows(payload);
  if (!isRecord(payload) || !isRecord(payload.result)
      || !isRecord(payload.result.calculated_result)) return base;
  const calculated = payload.result.calculated_result;
  if (calculated.version !== "report_calculated_query_result.v1"
      || !Array.isArray(calculated.rows) || calculated.rows.length !== base.length
      || calculated.rows.some((row) => !isRecord(row))) invalidWire();
  return base.map((row, index) => ({
    ...row,
    ...(calculated.rows as Array<Record<string, unknown>>)[index],
  }));
}

export function unwrapExportStatus(payload: unknown): Record<string, unknown> {
  const result = unwrapCoreResult(payload);
  if (!isRecord(result)) invalidWire();
  if (Object.hasOwn(result, "download")) {
    if (!isRecord(result.download) || typeof result.download.path !== "string"
        || !result.download.path.startsWith("/api/admin/conversions/v1/exports/")) invalidWire();
  }
  return result;
}

export interface ConversionsUiContext {
  readonly workspaceId: string;
  readonly role: "accountable_owner" | "administrator" | "reporter";
  readonly capabilities: ReadonlyArray<string>;
  readonly accountScope: ReadonlyArray<{
    readonly accountId: string;
    readonly currency: string;
  }>;
  readonly reportingCurrency: string;
  readonly timeZone: string;
  readonly recipientScope: ReadonlyArray<{
    readonly recipientId: string;
    readonly displayLabel: string;
  }>;
}

export function unwrapConversionsUiContext(payload: unknown): ConversionsUiContext {
  if (!isRecord(payload) || !exactKeys(payload, [
    "account_scope", "capabilities", "recipient_scope", "reporting_currency", "role",
    "schema_version", "time_zone", "workspace_id",
  ]) || payload.schema_version !== "cms_conversions_ui_context.v2"
      || typeof payload.workspace_id !== "string" || !UUID_V7.test(payload.workspace_id)
      || !["accountable_owner", "administrator", "reporter"].includes(String(payload.role))
      || !Array.isArray(payload.capabilities)
      || !payload.capabilities.every((value) => typeof value === "string")
      || typeof payload.reporting_currency !== "string" || !CURRENCY.test(payload.reporting_currency)
      || typeof payload.time_zone !== "string" || !TIME_ZONE.test(payload.time_zone)
      || !Array.isArray(payload.account_scope) || !Array.isArray(payload.recipient_scope)) invalidWire();
  const accountScope = payload.account_scope.map((value) => {
    if (!isRecord(value) || !exactKeys(value, ["account_id", "currency"])
        || typeof value.account_id !== "string" || !ACCOUNT_ID.test(value.account_id)
        || typeof value.currency !== "string" || value.currency !== payload.reporting_currency) invalidWire();
    return Object.freeze({ accountId: value.account_id, currency: value.currency });
  });
  if (accountScope.length > 256 || new Set(accountScope.map(({ accountId }) => accountId)).size !== accountScope.length) {
    invalidWire();
  }
  const recipientScope = payload.recipient_scope.map((value) => {
    if (!isRecord(value) || !exactKeys(value, ["display_label", "recipient_id"])
        || typeof value.recipient_id !== "string" || !UUID_V7.test(value.recipient_id)
        || typeof value.display_label !== "string" || value.display_label.length < 1
        || value.display_label.length > 320) invalidWire();
    return Object.freeze({
      recipientId: value.recipient_id,
      displayLabel: value.display_label,
    });
  });
  if (recipientScope.length < 1 || recipientScope.length > 25
      || new Set(recipientScope.map(({ recipientId }) => recipientId)).size !== recipientScope.length) invalidWire();
  return Object.freeze({
    workspaceId: payload.workspace_id,
    role: payload.role as ConversionsUiContext["role"],
    capabilities: Object.freeze([...payload.capabilities]),
    accountScope: Object.freeze(accountScope),
    reportingCurrency: payload.reporting_currency,
    timeZone: payload.time_zone,
    recipientScope: Object.freeze(recipientScope),
  });
}

export function parseExplicitAccountIds(input: string | ReadonlyArray<string>): ReadonlyArray<string> {
  const values = typeof input === "string"
    ? input.split(/[\n,]/u).map((value) => value.trim()).filter(Boolean)
    : [...input];
  if (values.length < 1 || values.length > 256
      || values.some((value) => typeof value !== "string" || !ACCOUNT_ID.test(value))) {
    throw new CoreWireError("invalid_account_scope", "Enter between 1 and 256 valid account IDs.");
  }
  const sorted = [...values].sort();
  if (new Set(sorted).size !== sorted.length) {
    throw new CoreWireError("invalid_account_scope", "Account IDs must be unique.");
  }
  return Object.freeze(sorted);
}

export function buildConnectionCreateBody(input: {
  readonly name: string;
  readonly direction: "source" | "destination";
  readonly adapterType: string;
  readonly accountId: string;
  readonly currency: string;
  readonly config: Record<string, unknown>;
}): Record<string, unknown> {
  if (!ACCOUNT_ID.test(input.accountId) || !CURRENCY.test(input.currency)) {
    throw new CoreWireError("invalid_account_scope", "Enter a valid account ID and three-letter currency.");
  }
  if (input.config.adapter_type !== input.adapterType) {
    throw new CoreWireError("invalid_connection_config", "The Connection configuration does not match its adapter.");
  }
  return Object.freeze({
    name: input.name,
    direction: input.direction,
    adapter_type: input.adapterType,
    config_schema_version: 1,
    config: Object.freeze({ ...input.config }),
    account_id: input.accountId,
    currency: input.currency,
  });
}

export function withReportAccountIds<T extends Record<string, unknown>>(
  body: T,
  explicitAccountIds: string | ReadonlyArray<string>,
): T & { readonly account_ids: ReadonlyArray<string> } {
  return Object.freeze({ ...body, account_ids: parseExplicitAccountIds(explicitAccountIds) });
}

export type ProductAction<T> =
  | { type: "load" }
  | { type: "loaded"; items: ReadonlyArray<T> }
  | { type: "failed"; message: string }
  | { type: "prepend"; item: T };

export function initialProductState<T>(): ProductState<T> {
  return { state: "idle", items: [], message: "" };
}

export function productReducer<T>(state: ProductState<T>, action: ProductAction<T>): ProductState<T> {
  if (action.type === "load") return { ...state, state: "loading", message: "" };
  if (action.type === "loaded") {
    return { state: action.items.length === 0 ? "empty" : "ready", items: action.items, message: "" };
  }
  if (action.type === "failed") return { ...state, state: "error", message: action.message };
  const items = [action.item, ...state.items];
  return { state: "ready", items, message: "" };
}

export function collectionFromPayload(payload: unknown): ReadonlyArray<Record<string, unknown>> {
  if (Array.isArray(payload)) return payload.filter(isRecord);
  if (!isRecord(payload)) return [];
  for (const key of ["items", "results", "data"]) {
    if (Array.isArray(payload[key])) return payload[key].filter(isRecord);
  }
  return [];
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function itemId(item: Record<string, unknown>): string | null {
  for (const key of ["connection_id", "flow_id", "run_id", "control_key", "id"]) {
    if (typeof item[key] === "string") return item[key];
  }
  return null;
}

export function itemLabel(item: Record<string, unknown>, fallback: string): string {
  for (const key of ["name", "display_name", "control_key", "status", "state"]) {
    if (typeof item[key] === "string" && item[key].length > 0) return item[key];
  }
  return fallback;
}
