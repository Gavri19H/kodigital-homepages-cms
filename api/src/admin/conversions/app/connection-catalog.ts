export type ConnectionDirection = "source" | "destination";
export type ConnectionAdapter =
  | "generic_api"
  | "managed_email"
  | "google_sheets"
  | "microsoft_excel"
  | "inbound_webhook"
  | "manual_upload"
  | "kodigital_clickhouse"
  | "meta"
  | "google_data_manager"
  | "taboola"
  | "outbrain"
  | "newsbreak"
  | "generic_https";

export interface AdapterDefinition {
  readonly value: ConnectionAdapter;
  readonly label: string;
  readonly direction: ConnectionDirection;
  readonly purpose: string;
}

export type ConfigFieldKind =
  | "text"
  | "url"
  | "number"
  | "select"
  | "textarea"
  | "csv"
  | "boolean"
  | "pairs"
  | "static";

export interface ConfigField {
  readonly path: string;
  readonly label: string;
  readonly kind: ConfigFieldKind;
  readonly help: string;
  readonly options?: ReadonlyArray<{ readonly value: string; readonly label: string }>;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly pairLabels?: readonly [string, string];
  readonly nullable?: boolean;
  readonly visibleWhen?: {
    readonly path: string;
    readonly equals: string | number | boolean;
  };
}

export interface ConfigSection {
  readonly title: string;
  readonly description: string;
  readonly fields: ReadonlyArray<ConfigField>;
}

const SCHEDULE_OPTIONS = [
  { value: "every_15_minutes", label: "Every 15 minutes" },
  { value: "every_30_minutes", label: "Every 30 minutes" },
  { value: "every_45_minutes", label: "Every 45 minutes" },
  { value: "hourly", label: "Hourly" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "custom", label: "Custom interval" },
] as const;

const CATCH_UP_OPTIONS = [
  { value: "serial_24h_then_issue", label: "Catch up serially for 24 hours, then raise an issue" },
  { value: "skip_and_issue", label: "Skip missed runs and raise an issue" },
] as const;

export const CONNECTION_ADAPTERS: ReadonlyArray<AdapterDefinition> = Object.freeze([
  { value: "generic_api", label: "Generic API", direction: "source", purpose: "Pull rows from a defined HTTPS endpoint." },
  { value: "managed_email", label: "Managed email", direction: "source", purpose: "Receive a recurring report at a generated KODigital email address." },
  { value: "google_sheets", label: "Google Sheets", direction: "source", purpose: "Read a stable worksheet range with provider revision tracking." },
  { value: "microsoft_excel", label: "Microsoft Excel", direction: "source", purpose: "Read an Excel table or worksheet range from OneDrive or SharePoint." },
  { value: "inbound_webhook", label: "Inbound webhook", direction: "source", purpose: "Accept authenticated partner postbacks at a generated KODigital URL." },
  { value: "manual_upload", label: "Manual upload", direction: "source", purpose: "Upload a bounded file and require a dry run before confirmation." },
  { value: "kodigital_clickhouse", label: "KODigital ClickHouse", direction: "source", purpose: "Read an approved internal projection without changing on-site tracking." },
  { value: "meta", label: "Meta", direction: "destination", purpose: "Deliver eligible conversion events to a Meta dataset." },
  { value: "google_data_manager", label: "Google Data Manager", direction: "destination", purpose: "Deliver eligible conversion events to Google Data Manager." },
  { value: "taboola", label: "Taboola", direction: "destination", purpose: "Deliver eligible conversion events to a Taboola advertiser." },
  { value: "outbrain", label: "Outbrain", direction: "destination", purpose: "Deliver eligible conversion events to an Outbrain marketer." },
  { value: "newsbreak", label: "NewsBreak", direction: "destination", purpose: "Deliver eligible conversion events to a NewsBreak pixel." },
  { value: "generic_https", label: "Generic HTTPS", direction: "destination", purpose: "Send an allowlisted HTTPS request to a custom destination." },
]);

function schedule(timeZone: string): Record<string, unknown> {
  return {
    type: "daily",
    timezone: timeZone,
    catch_up_policy: "serial_24h_then_issue",
    local_time: "09:00",
    day_of_week: null,
    day_of_month: null,
  };
}

export function defaultConnectionConfig(
  adapter: ConnectionAdapter,
  timeZone: string,
): Record<string, unknown> {
  if (adapter === "generic_api") return {
    adapter_type: adapter,
    base_url: "https://",
    approved_origins: ["https://"],
    method: "GET",
    query_templates: [],
    header_templates: [],
    body_template: null,
    body_content_type: null,
    success_statuses: [200],
    success_content_types: ["application/json"],
    response_format: "json",
    response_encoding: "utf-8",
    root_path: "$.rows",
    pagination: { mode: "none", request_field: null, response_field: null, start: null, step: null },
    watermark: { field: "updated_at", type: "iso_datetime", overlap_seconds: 300, request_field: "updated_since" },
    stable_record_id_fields: ["id"],
    operation: { field: null, upsert_values: ["upsert"], delete_values: [] },
    timezone: timeZone,
    schedule: schedule(timeZone),
    limits: { max_response_bytes: 10_485_760, max_pages: 1_000, max_records: 250_000 },
  };
  if (adapter === "managed_email") return {
    adapter_type: adapter,
    allowed_sender_addresses: [],
    allowed_sender_domains: [],
    subject_match: { mode: "contains", value: "report" },
    payload_source: "attachment",
    filename_match: "*.csv",
    format: "csv",
    encoding: "utf-8",
    delimiter: ",",
    header_row: 1,
    worksheet: null,
    table: null,
    range: null,
    stable_row_id_fields: ["id"],
    patch_match_field: null,
    expected_cadence: { schedule: schedule(timeZone), timezone: timeZone, late_threshold_minutes: 120 },
    max_mime_bytes: 20_971_520,
  };
  if (adapter === "google_sheets") return {
    adapter_type: adapter,
    spreadsheet_id: "",
    worksheet_id: "",
    worksheet_name: "",
    range_a1: "A:Z",
    header_row: 1,
    stable_row_id_fields: ["id"],
    revision_strategy: "drive_revision_id",
    overlap_seconds: 300,
    full_reconciliation_schedule: schedule(timeZone),
    schedule: schedule(timeZone),
    timezone: timeZone,
  };
  if (adapter === "microsoft_excel") return {
    adapter_type: adapter,
    tenant_id: "",
    site_id: "",
    drive_id: "",
    item_id: "",
    selection_kind: "workbook_table",
    table_id: "",
    table_name: null,
    worksheet_id: null,
    worksheet_name: null,
    range_a1: null,
    header_row: 1,
    stable_row_id_fields: ["id"],
    revision_strategy: "etag",
    overlap_seconds: 300,
    full_reconciliation_schedule: schedule(timeZone),
    schedule: schedule(timeZone),
    timezone: timeZone,
  };
  if (adapter === "inbound_webhook") return {
    adapter_type: adapter,
    allowed_methods: ["POST"],
    allowed_content_types: ["application/json"],
    mode: "single",
    field_location: "json_body",
    batch_member_field: null,
    field_mapping: [{ source_field: "id", target_field: "id" }],
    auth: {
      mode: "hmac",
      authorization_header: null,
      timestamp_header: "x-signature-timestamp",
      signature_header: "x-signature",
    },
    limits: {
      max_body_bytes: 1_048_576,
      max_members: 500,
      rate_limit_per_minute: 600,
      rate_alert_per_minute: 480,
    },
    response: { status: 202, fixed_body: null },
    stable_record_id_fields: ["id"],
  };
  if (adapter === "manual_upload") return {
    adapter_type: adapter,
    allowed_formats: ["csv", "xlsx", "json"],
    encoding: "utf-8",
    delimiter: ",",
    header_row: 1,
    sheet_selection: null,
    stable_row_id_fields: ["id"],
    maximum_bytes: 104_857_600,
    maximum_rows: 250_000,
    reporting_only_default: true,
    dry_run_confirmation_required: true,
  };
  if (adapter === "kodigital_clickhouse") return {
    adapter_type: adapter,
    projection_name: "approved_projection",
    product: "listicles",
    field_map: [{ source_field: "event_id", target_field: "event_id" }],
    watermark_field: "occurred_at",
    tie_breaker_field: "event_id",
    overlap_seconds: 300,
    reconciliation_schedule: schedule(timeZone),
    batch_size: 1_000,
    lag_threshold_seconds: 900,
    schedule: schedule(timeZone),
    timezone: timeZone,
    read_only: true,
  };
  if (adapter === "meta") return {
    adapter_type: adapter,
    dataset_id: "",
    api_version: "",
    test_event_code: null,
  };
  if (adapter === "google_data_manager") return {
    adapter_type: adapter,
    customer_id: "",
    destination_id: "",
    api_version: "",
    schema_version: "",
    access_mode: "test",
  };
  if (adapter === "taboola") return { adapter_type: adapter, advertiser_id: "" };
  if (adapter === "outbrain") return { adapter_type: adapter, marketer_id: "" };
  if (adapter === "newsbreak") return {
    adapter_type: adapter,
    account_id: "",
    pixel_id: "",
    partner_id: "",
    endpoint_contract_version: "",
  };
  return {
    adapter_type: adapter,
    url: "https://",
    method: "POST",
    success_statuses: [200, 201, 202],
    response_check: { mode: "status_only", value: null },
    timeout_ms: 10_000,
    redirect_policy: "deny",
    rate_limit_per_minute: 600,
    batch_size: 100,
    hmac_header: null,
    idempotency_header: "idempotency-key",
  };
}

function isConfigRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readConfigPath(config: Record<string, unknown>, path: string): unknown {
  let current: unknown = config;
  for (const segment of path.split(".")) {
    if (!isConfigRecord(current)) return undefined;
    current = current[segment];
  }
  return current;
}

function writeConfigPath(
  config: Record<string, unknown>,
  path: string,
  value: unknown,
): Record<string, unknown> {
  const segments = path.split(".");
  const root = structuredClone(config);
  let current = root;
  for (const segment of segments.slice(0, -1)) {
    const next = current[segment];
    if (!isConfigRecord(next)) current[segment] = {};
    current = current[segment] as Record<string, unknown>;
  }
  current[segments.at(-1)!] = value;
  return root;
}

export function normalizeConnectionConfigField(
  config: Record<string, unknown>,
  path: string,
  value: unknown,
): Record<string, unknown> {
  let next = writeConfigPath(config, path, value);
  if (path === "method" && value === "GET" && config.adapter_type === "generic_api") {
    next = writeConfigPath(
      writeConfigPath(next, "body_template", null),
      "body_content_type",
      null,
    );
  }
  if (path === "pagination.mode") {
    next = writeConfigPath(
      writeConfigPath(
        writeConfigPath(
          writeConfigPath(next, "pagination.request_field", null),
          "pagination.response_field",
          null,
        ),
        "pagination.start",
        null,
      ),
      "pagination.step",
      null,
    );
  }
  if (path === "payload_source") {
    next = writeConfigPath(
      next,
      "filename_match",
      value === "attachment" ? "*.csv" : null,
    );
  }
  if (path === "format") {
    next = writeConfigPath(next, "delimiter", value === "csv" ? "," : null);
    if (value !== "xlsx") {
      next = writeConfigPath(
        writeConfigPath(writeConfigPath(next, "worksheet", null), "table", null),
        "range",
        null,
      );
    }
  }
  if (path === "selection_kind") {
    if (value === "workbook_table") {
      next = writeConfigPath(
        writeConfigPath(
          writeConfigPath(next, "worksheet_id", null),
          "worksheet_name",
          null,
        ),
        "range_a1",
        null,
      );
      next = writeConfigPath(next, "table_id", "");
    } else {
      next = writeConfigPath(
        writeConfigPath(next, "table_id", null),
        "table_name",
        null,
      );
      next = writeConfigPath(
        writeConfigPath(next, "worksheet_id", ""),
        "range_a1",
        "A:Z",
      );
    }
  }
  if (path === "mode" && config.adapter_type === "inbound_webhook") {
    next = writeConfigPath(
      next,
      "batch_member_field",
      value === "batch" ? "records" : null,
    );
    if (value === "batch") next = writeConfigPath(next, "field_location", "json_body");
  }
  if (path === "auth.mode") {
    if (value === "hmac") {
      next = writeConfigPath(
        writeConfigPath(
          writeConfigPath(next, "auth.authorization_header", null),
          "auth.timestamp_header",
          "x-signature-timestamp",
        ),
        "auth.signature_header",
        "x-signature",
      );
    } else {
      next = writeConfigPath(
        writeConfigPath(
          writeConfigPath(next, "auth.authorization_header", "authorization"),
          "auth.timestamp_header",
          null,
        ),
        "auth.signature_header",
        null,
      );
    }
  }
  if (path === "response.status" && value === 202) {
    next = writeConfigPath(next, "response.fixed_body", null);
  }
  if (path === "response_check.mode") {
    next = writeConfigPath(
      next,
      "response_check.value",
      value === "status_only" ? null : "",
    );
  }
  if (path.endsWith(".type")) {
    const prefix = path.slice(0, -".type".length);
    next = writeConfigPath(
      next,
      `${prefix}.day_of_week`,
      value === "weekly" ? 1 : null,
    );
    next = writeConfigPath(
      next,
      `${prefix}.day_of_month`,
      value === "monthly" ? 1 : null,
    );
    next = writeConfigPath(
      next,
      `${prefix}.local_time`,
      ["daily", "weekly", "monthly"].includes(String(value)) ? "09:00" : null,
    );
    if (value === "custom") {
      next = writeConfigPath(next, `${prefix}.interval_minutes`, 60);
    } else {
      const scheduleValue = readConfigPath(next, prefix);
      if (isConfigRecord(scheduleValue)) {
        const { interval_minutes: ignored, ...withoutInterval } = scheduleValue;
        void ignored;
        next = writeConfigPath(next, prefix, withoutInterval);
      }
    }
  }
  return next;
}

const scheduleFields = (prefix = "schedule"): ReadonlyArray<ConfigField> => [
  { path: `${prefix}.type`, label: "Run schedule", kind: "select", options: SCHEDULE_OPTIONS, help: "How often KODigital checks this source." },
  { path: `${prefix}.timezone`, label: "Schedule time zone", kind: "text", help: "IANA time zone used to interpret the schedule." },
  { path: `${prefix}.catch_up_policy`, label: "Missed-run policy", kind: "select", options: CATCH_UP_OPTIONS, help: "What happens when one or more scheduled runs were missed." },
  {
    path: `${prefix}.interval_minutes`,
    label: "Custom interval minutes",
    kind: "number",
    minimum: 1,
    maximum: 44_640,
    help: "Run interval used only when the schedule is Custom interval.",
    visibleWhen: { path: `${prefix}.type`, equals: "custom" },
  },
  { path: `${prefix}.local_time`, label: "Local run time", kind: "text", nullable: true, help: "HH:MM for daily, weekly, or monthly schedules." },
  { path: `${prefix}.day_of_week`, label: "Day of week", kind: "number", minimum: 1, maximum: 7, nullable: true, help: "1–7 for a weekly schedule; leave blank otherwise." },
  { path: `${prefix}.day_of_month`, label: "Day of month", kind: "number", minimum: 1, maximum: 31, nullable: true, help: "1–31 for a monthly schedule; leave blank otherwise." },
];

const pair = (
  path: string,
  label: string,
  help: string,
  first: string,
  second: string,
): ConfigField => ({ path, label, kind: "pairs", help, pairLabels: [first, second] });

export const CONNECTION_CONFIG_SECTIONS: Readonly<Record<ConnectionAdapter, ReadonlyArray<ConfigSection>>> = Object.freeze({
  generic_api: [
    {
      title: "Request",
      description: "Define the exact API request. Credentials are saved separately and cannot be placed in headers.",
      fields: [
        { path: "base_url", label: "HTTPS endpoint", kind: "url", help: "Full API endpoint KODigital will call." },
        { path: "approved_origins", label: "Approved origins", kind: "csv", help: "Exact HTTPS origins allowed for the endpoint and any next-page URL." },
        { path: "method", label: "Method", kind: "select", options: [{ value: "GET", label: "GET" }, { value: "POST", label: "POST" }], help: "GET reads by URL; POST may include the body template below." },
        pair("query_templates", "Query parameters", "Fixed parameter names and value templates sent with every request.", "Parameter", "Value template"),
        pair("header_templates", "Non-secret headers", "Fixed safe headers only. Authorization, cookies, host, service headers, and secret values are rejected.", "Header", "Value template"),
        { path: "body_template", label: "Request body template", kind: "textarea", nullable: true, help: "Optional POST body template using only approved source placeholders." },
        { path: "body_content_type", label: "Request body content type", kind: "text", nullable: true, help: "Required when a POST body template is present." },
      ],
    },
    {
      title: "Response and paging",
      description: "Define what a successful response is and where its records and next page are found.",
      fields: [
        { path: "success_statuses", label: "Success HTTP statuses", kind: "csv", help: "Comma-separated 2xx codes accepted as success." },
        { path: "success_content_types", label: "Success content types", kind: "csv", help: "Exact response media types accepted." },
        { path: "response_format", label: "Response format", kind: "select", options: [{ value: "json", label: "JSON" }, { value: "csv", label: "CSV" }, { value: "xml", label: "XML" }], help: "Parser used for the response." },
        { path: "response_encoding", label: "Response encoding", kind: "static", help: "The contract permits UTF-8 only." },
        { path: "root_path", label: "Record root path", kind: "text", nullable: true, help: "Path to the row array, for example $.rows." },
        { path: "pagination.mode", label: "Pagination", kind: "select", options: ["none", "page", "offset", "cursor", "next_url"].map((value) => ({ value, label: value.replace("_", " ") })), help: "How the API exposes additional pages." },
        { path: "pagination.request_field", label: "Paging request field", kind: "text", nullable: true, help: "Query/body field used for page, offset, or cursor modes." },
        { path: "pagination.response_field", label: "Paging response field", kind: "text", nullable: true, help: "Response path containing the next cursor or next URL." },
        { path: "pagination.start", label: "Paging start", kind: "number", minimum: 0, nullable: true, help: "First page or offset." },
        { path: "pagination.step", label: "Paging step", kind: "number", minimum: 1, nullable: true, help: "Page increment or offset size." },
      ],
    },
    {
      title: "Incremental identity",
      description: "Define exactly which records are new or changed without creating duplicate business events.",
      fields: [
        { path: "watermark.field", label: "Watermark response field", kind: "text", help: "Monotonic source field used for incremental pulls." },
        { path: "watermark.type", label: "Watermark type", kind: "select", options: [{ value: "iso_datetime", label: "ISO date/time" }, { value: "integer", label: "Integer" }], help: "How the watermark value is compared." },
        { path: "watermark.overlap_seconds", label: "Watermark overlap seconds", kind: "number", minimum: 0, help: "Overlap protects against late records; deduplication uses stable IDs." },
        { path: "watermark.request_field", label: "Watermark request field", kind: "text", help: "Query/body field that receives the prior watermark." },
        { path: "stable_record_id_fields", label: "Stable record ID columns", kind: "csv", help: "Ordered source columns that uniquely identify one source record." },
        { path: "operation.field", label: "Operation column", kind: "text", nullable: true, help: "Optional column that distinguishes upserts from explicit deletions." },
        { path: "operation.upsert_values", label: "Upsert values", kind: "csv", help: "Operation values treated as create/update." },
        { path: "operation.delete_values", label: "Delete values", kind: "csv", help: "Explicit deletion markers; snapshot absence alone never deletes." },
      ],
    },
    {
      title: "Schedule and limits",
      description: "Bound every run so a bad endpoint cannot create an unbounded job.",
      fields: [
        { path: "timezone", label: "Source time zone", kind: "text", help: "Time zone used for source timestamps." },
        ...scheduleFields(),
        { path: "limits.max_response_bytes", label: "Maximum response bytes per page", kind: "number", minimum: 1, maximum: 26_214_400, help: "Hard stop for a single response." },
        { path: "limits.max_pages", label: "Maximum pages per run", kind: "number", minimum: 1, maximum: 10_000, help: "Hard stop for pagination." },
        { path: "limits.max_records", label: "Maximum records per run", kind: "number", minimum: 1, maximum: 2_000_000, help: "Hard stop for parsed records." },
      ],
    },
  ],
  managed_email: [
    {
      title: "Expected message",
      description: "The generated recipient appears after the draft is saved. Only matching senders and subjects are accepted.",
      fields: [
        { path: "allowed_sender_addresses", label: "Allowed sender email addresses", kind: "csv", help: "Exact sender addresses permitted to submit this report." },
        { path: "allowed_sender_domains", label: "Allowed sender domains", kind: "csv", help: "Sender domains permitted when exact addresses are not practical." },
        { path: "subject_match.mode", label: "Subject match", kind: "select", options: ["exact", "prefix", "contains", "regular_expression"].map((value) => ({ value, label: value.replace("_", " ") })), help: "How the incoming subject is compared." },
        { path: "subject_match.value", label: "Subject value", kind: "text", help: "Exact text or approved regular expression." },
        { path: "payload_source", label: "Read data from", kind: "select", options: [{ value: "attachment", label: "Attachment" }, { value: "body_table", label: "Table in email body" }], help: "Where the report rows are located." },
        { path: "filename_match", label: "Attachment filename match", kind: "text", nullable: true, help: "Required for attachments; leave blank for an email-body table." },
      ],
    },
    {
      title: "Columns and cadence",
      description: "Define the file/table shape and when a missing report becomes an issue.",
      fields: [
        { path: "format", label: "Format", kind: "select", options: ["csv", "xlsx", "json"].map((value) => ({ value, label: value.toUpperCase() })), help: "Expected report format." },
        { path: "encoding", label: "Encoding", kind: "static", help: "The contract permits UTF-8 only." },
        { path: "delimiter", label: "CSV delimiter", kind: "text", nullable: true, help: "One character for CSV; blank for XLSX or JSON." },
        { path: "header_row", label: "Header row", kind: "number", minimum: 1, help: "One-based row containing column names." },
        { path: "worksheet", label: "Worksheet", kind: "text", nullable: true, help: "XLSX worksheet name when applicable." },
        { path: "table", label: "Table", kind: "text", nullable: true, help: "XLSX table name when applicable." },
        { path: "range", label: "Range", kind: "text", nullable: true, help: "XLSX range when applicable." },
        { path: "stable_row_id_fields", label: "Stable record ID columns", kind: "csv", help: "Columns that uniquely identify one row." },
        { path: "patch_match_field", label: "Patch match column", kind: "text", nullable: true, help: "Optional column used when a Flow treats this source as a patch." },
        ...scheduleFields("expected_cadence.schedule"),
        { path: "expected_cadence.timezone", label: "Expected-report time zone", kind: "text", help: "Time zone used for the expected cadence." },
        { path: "expected_cadence.late_threshold_minutes", label: "Late after minutes", kind: "number", minimum: 1, maximum: 10_080, help: "Raise Needs attention when the report is this late." },
        { path: "max_mime_bytes", label: "Maximum complete email bytes", kind: "number", minimum: 1, maximum: 20_971_520, help: "Includes MIME overhead and attachments." },
      ],
    },
  ],
  google_sheets: [{
    title: "Spreadsheet and schedule",
    description: "Use stable provider IDs; formulas may be read, but no macro or formula is executed by KODigital.",
    fields: [
      { path: "spreadsheet_id", label: "Spreadsheet ID", kind: "text", help: "Stable Google Drive spreadsheet ID." },
      { path: "worksheet_id", label: "Worksheet ID", kind: "text", help: "Stable numeric/provider worksheet ID." },
      { path: "worksheet_name", label: "Worksheet name", kind: "text", help: "Visible worksheet name used for operator confirmation." },
      { path: "range_a1", label: "A1 range", kind: "text", help: "Bounded worksheet range, for example A:Z." },
      { path: "header_row", label: "Header row", kind: "number", minimum: 1, help: "One-based row containing column names." },
      { path: "stable_row_id_fields", label: "Stable record ID columns", kind: "csv", help: "Columns that uniquely identify a row." },
      { path: "revision_strategy", label: "Revision strategy", kind: "select", options: [{ value: "drive_revision_id", label: "Drive revision ID" }, { value: "modified_time", label: "Modified time" }], help: "Provider value used to identify a new snapshot." },
      { path: "overlap_seconds", label: "Overlap seconds", kind: "number", minimum: 0, help: "Safety overlap for provider changes." },
      ...scheduleFields(),
      ...scheduleFields("full_reconciliation_schedule"),
      { path: "timezone", label: "Source time zone", kind: "text", help: "Time zone used for source values." },
    ],
  }],
  microsoft_excel: [{
    title: "Workbook selection and schedule",
    description: "Identify one stable workbook object and either a table or a worksheet range.",
    fields: [
      { path: "tenant_id", label: "Microsoft tenant ID", kind: "text", help: "Tenant that owns the workbook." },
      { path: "site_id", label: "SharePoint site ID", kind: "text", help: "Stable site identifier." },
      { path: "drive_id", label: "Drive ID", kind: "text", help: "Stable document-library or OneDrive identifier." },
      { path: "item_id", label: "Workbook item ID", kind: "text", help: "Stable workbook file identifier." },
      { path: "selection_kind", label: "Read from", kind: "select", options: [{ value: "workbook_table", label: "Workbook table" }, { value: "worksheet_range", label: "Worksheet range" }], help: "Choose one exact workbook selection." },
      { path: "table_id", label: "Table ID", kind: "text", nullable: true, help: "Stable table ID for workbook-table mode." },
      { path: "table_name", label: "Table name", kind: "text", nullable: true, help: "Visible table name when no stable ID is supplied." },
      { path: "worksheet_id", label: "Worksheet ID", kind: "text", nullable: true, help: "Stable worksheet ID for range mode." },
      { path: "worksheet_name", label: "Worksheet name", kind: "text", nullable: true, help: "Visible worksheet name used for operator confirmation." },
      { path: "range_a1", label: "A1 range", kind: "text", nullable: true, help: "Required for worksheet-range mode." },
      { path: "header_row", label: "Header row", kind: "number", minimum: 1, help: "One-based row containing column names." },
      { path: "stable_row_id_fields", label: "Stable record ID columns", kind: "csv", help: "Columns that uniquely identify a row." },
      { path: "revision_strategy", label: "Revision strategy", kind: "select", options: [{ value: "etag", label: "ETag" }, { value: "drive_item_version", label: "Drive item version" }], help: "Provider value used to identify a new snapshot." },
      { path: "overlap_seconds", label: "Overlap seconds", kind: "number", minimum: 0, help: "Safety overlap for provider changes." },
      ...scheduleFields(),
      ...scheduleFields("full_reconciliation_schedule"),
      { path: "timezone", label: "Source time zone", kind: "text", help: "Time zone used for source values." },
    ],
  }],
  inbound_webhook: [{
    title: "Request, authentication, and response",
    description: "The generated public URL appears after save. The credential is write-only and saved separately.",
    fields: [
      { path: "allowed_methods", label: "Allowed methods", kind: "csv", help: "POST or PUT." },
      { path: "allowed_content_types", label: "Allowed content types", kind: "csv", help: "JSON or form-encoded input." },
      { path: "mode", label: "Payload mode", kind: "select", options: [{ value: "single", label: "One record" }, { value: "batch", label: "Batch of records" }], help: "Whether each request contains one record or a list." },
      { path: "field_location", label: "Read fields from", kind: "select", options: [{ value: "json_body", label: "JSON body" }, { value: "query", label: "Query string" }], help: "Batch mode requires a JSON body." },
      { path: "batch_member_field", label: "Batch array field", kind: "text", nullable: true, help: "Required only for batch mode." },
      pair("field_mapping", "Inbound field mapping", "Map partner field names into stable source column names.", "Incoming field", "Source column"),
      { path: "auth.mode", label: "Authentication", kind: "select", options: [{ value: "hmac", label: "HMAC (recommended)" }, { value: "bearer", label: "Bearer token" }, { value: "basic", label: "Basic authentication" }], help: "The secret itself is entered in the separate credential section." },
      { path: "auth.authorization_header", label: "Authorization header", kind: "text", nullable: true, help: "Required for bearer/basic; blank for HMAC." },
      { path: "auth.timestamp_header", label: "HMAC timestamp header", kind: "text", nullable: true, help: "Required for HMAC and checked with five-minute tolerance." },
      { path: "auth.signature_header", label: "HMAC signature header", kind: "text", nullable: true, help: "Required for HMAC." },
      { path: "limits.max_body_bytes", label: "Maximum body bytes", kind: "number", minimum: 1, maximum: 1_048_576, help: "Hard request cap before enqueue." },
      { path: "limits.max_members", label: "Maximum batch members", kind: "number", minimum: 1, maximum: 500, help: "Hard batch cap." },
      { path: "limits.rate_limit_per_minute", label: "Rate limit per minute", kind: "number", minimum: 1, maximum: 60_000, help: "Requests above this limit are rejected." },
      { path: "limits.rate_alert_per_minute", label: "Rate alert per minute", kind: "number", minimum: 1, maximum: 60_000, help: "Must not exceed the hard rate limit." },
      { path: "response.status", label: "Durable response status", kind: "select", options: [{ value: "202", label: "202 JSON acceptance" }, { value: "200", label: "200 fixed text" }], help: "Returned only after archive and enqueue are durable." },
      { path: "response.fixed_body", label: "Exact fixed response body", kind: "text", nullable: true, help: "Only for partners that require status 200." },
      { path: "stable_record_id_fields", label: "Stable record ID columns", kind: "csv", help: "Required for replay-safe source command identity." },
    ],
  }],
  manual_upload: [{
    title: "File contract",
    description: "Every upload is dry-run first; no normal or external output occurs without a later explicit confirmation.",
    fields: [
      { path: "allowed_formats", label: "Allowed formats", kind: "csv", help: "Any of csv, xlsx, json." },
      { path: "encoding", label: "Encoding", kind: "static", help: "The contract permits UTF-8 only." },
      { path: "delimiter", label: "CSV delimiter", kind: "text", nullable: true, help: "Required when CSV is allowed." },
      { path: "header_row", label: "Header row", kind: "number", minimum: 1, help: "One-based row containing column names." },
      { path: "sheet_selection", label: "XLSX sheet", kind: "text", nullable: true, help: "Optional fixed worksheet selection." },
      { path: "stable_row_id_fields", label: "Stable record ID columns", kind: "csv", help: "Columns that uniquely identify a row." },
      { path: "maximum_bytes", label: "Maximum file bytes", kind: "number", minimum: 1, maximum: 524_288_000, help: "Hard file-size cap." },
      { path: "maximum_rows", label: "Maximum rows", kind: "number", minimum: 1, maximum: 2_000_000, help: "Hard parsed-row cap." },
      { path: "reporting_only_default", label: "Default to reporting only", kind: "static", help: "Always true." },
      { path: "dry_run_confirmation_required", label: "Require dry-run confirmation", kind: "static", help: "Always true." },
    ],
  }],
  kodigital_clickhouse: [{
    title: "Approved internal projection",
    description: "This read-only source remains unavailable until the upstream schema and scoped-role evidence gates are green.",
    fields: [
      { path: "projection_name", label: "Approved projection", kind: "text", help: "Reviewed projection allowlist name, not arbitrary SQL." },
      { path: "product", label: "Product", kind: "select", options: [{ value: "listicles", label: "Listicles" }, { value: "leadgen", label: "LeadGen" }], help: "Internal product represented by the projection." },
      pair("field_map", "Projection field map", "Map approved projection fields to source columns.", "Projection field", "Source column"),
      { path: "watermark_field", label: "Ingestion watermark field", kind: "text", help: "Monotonic ingestion timestamp." },
      { path: "tie_breaker_field", label: "Tie-breaker field", kind: "text", help: "Stable event ID used with the watermark." },
      { path: "overlap_seconds", label: "Overlap seconds", kind: "number", minimum: 0, help: "Safety overlap for late internal rows." },
      ...scheduleFields(),
      ...scheduleFields("reconciliation_schedule"),
      { path: "batch_size", label: "Batch size", kind: "number", minimum: 1, maximum: 10_000, help: "Rows read per batch." },
      { path: "lag_threshold_seconds", label: "Lag alert seconds", kind: "number", minimum: 1, help: "Source is unhealthy above this measured ingestion lag." },
      { path: "timezone", label: "Source time zone", kind: "text", help: "Time zone used for source values." },
      { path: "read_only", label: "Read-only", kind: "static", help: "Always true; this Connection cannot write to ClickHouse." },
    ],
  }],
  meta: [{
    title: "Meta destination",
    description: "The access token is saved separately and never returned.",
    fields: [
      { path: "dataset_id", label: "Meta dataset ID", kind: "text", help: "Dataset/pixel that receives eligible events." },
      { path: "api_version", label: "Pinned supported API version", kind: "text", help: "Verified API version; it is not guessed or silently upgraded." },
      { path: "test_event_code", label: "Test event code", kind: "text", nullable: true, help: "Optional provider test code for non-production validation." },
    ],
  }],
  google_data_manager: [{
    title: "Google Data Manager destination",
    description: "Service-account credentials are saved separately and never returned.",
    fields: [
      { path: "customer_id", label: "Customer ID", kind: "text", help: "Google customer that owns the destination." },
      { path: "destination_id", label: "Destination ID", kind: "text", help: "Exact Data Manager destination." },
      { path: "api_version", label: "Pinned API version", kind: "text", help: "Verified provider API version." },
      { path: "schema_version", label: "Pinned schema version", kind: "text", help: "Verified upload schema version." },
      { path: "access_mode", label: "Access mode", kind: "select", options: [{ value: "test", label: "Test" }, { value: "production_disabled", label: "Production configured, disabled" }], help: "Connection creation does not activate delivery." },
    ],
  }],
  taboola: [{ title: "Taboola destination", description: "The provider token is saved separately.", fields: [{ path: "advertiser_id", label: "Advertiser ID", kind: "text", help: "Exact Taboola advertiser." }] }],
  outbrain: [{ title: "Outbrain destination", description: "The provider token is saved separately.", fields: [{ path: "marketer_id", label: "Marketer ID", kind: "text", help: "Exact Outbrain marketer." }] }],
  newsbreak: [{
    title: "NewsBreak destination",
    description: "The provider token is saved separately.",
    fields: [
      { path: "account_id", label: "NewsBreak account ID", kind: "text", help: "Provider account, not the KODigital account scope." },
      { path: "pixel_id", label: "Pixel ID", kind: "text", help: "Exact conversion pixel." },
      { path: "partner_id", label: "Partner ID", kind: "text", help: "Exact integration partner." },
      { path: "endpoint_contract_version", label: "Endpoint contract version", kind: "text", help: "Pinned reviewed NewsBreak endpoint contract." },
    ],
  }],
  generic_https: [{
    title: "HTTPS destination",
    description: "Define a bounded custom delivery request. Credentials are saved separately.",
    fields: [
      { path: "url", label: "HTTPS endpoint", kind: "url", help: "Exact destination URL." },
      { path: "method", label: "Method", kind: "select", options: ["GET", "POST", "PUT", "PATCH"].map((value) => ({ value, label: value })), help: "HTTP method used for delivery." },
      { path: "success_statuses", label: "Success statuses", kind: "csv", help: "Comma-separated accepted 2xx statuses." },
      { path: "response_check.mode", label: "Response check", kind: "select", options: [{ value: "status_only", label: "Status only" }, { value: "body_contains", label: "Body contains text" }, { value: "json_field_equals", label: "JSON field equals" }], help: "Additional bounded confirmation of delivery success." },
      { path: "response_check.value", label: "Response check value", kind: "text", nullable: true, help: "Blank for status-only checks." },
      { path: "timeout_ms", label: "Timeout milliseconds", kind: "number", minimum: 100, maximum: 30_000, help: "Hard request timeout." },
      { path: "redirect_policy", label: "Redirect policy", kind: "select", options: [{ value: "deny", label: "Deny" }, { value: "same_origin", label: "Same origin only" }, { value: "approved_origins", label: "Approved origins" }], help: "Credentials never cross a host-changing redirect." },
      { path: "rate_limit_per_minute", label: "Rate limit per minute", kind: "number", minimum: 1, maximum: 60_000, help: "Maximum destination requests." },
      { path: "batch_size", label: "Batch size", kind: "number", minimum: 1, maximum: 1_000, help: "Maximum events in one request." },
      { path: "hmac_header", label: "HMAC header", kind: "text", nullable: true, help: "Header used when the separate credential type is HMAC." },
      { path: "idempotency_header", label: "Idempotency header", kind: "text", nullable: true, help: "Header carrying stable delivery identity." },
    ],
  }],
});

export function adapterDefinition(value: string): AdapterDefinition | undefined {
  return CONNECTION_ADAPTERS.find((adapter) => adapter.value === value);
}

export function adaptersForDirection(direction: ConnectionDirection): ReadonlyArray<AdapterDefinition> {
  return CONNECTION_ADAPTERS.filter((adapter) => adapter.direction === direction);
}

export function credentialTypesForAdapter(adapter: ConnectionAdapter): ReadonlyArray<string> {
  if (adapter === "generic_api") return ["bearer_token", "api_key", "basic"];
  if (adapter === "inbound_webhook") return ["hmac", "bearer_token", "basic"];
  if (adapter === "google_sheets" || adapter === "google_data_manager") return ["service_account"];
  if (["meta", "taboola", "outbrain", "newsbreak"].includes(adapter)) return ["provider_token"];
  if (adapter === "generic_https") return ["bearer_token", "api_key", "basic", "hmac"];
  return [];
}
