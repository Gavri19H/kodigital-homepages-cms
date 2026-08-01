export type Dataset = "conversions" | "deliveries" | "runs";
export type FieldRole = "dimension" | "measure";
export type Operator = "equals" | "not_equals" | "contains" | "is_empty" | "before" | "on_or_after" | "greater_than" | "less_than";

export interface ReportField {
  readonly id: string;
  readonly label: string;
  readonly role: FieldRole;
  readonly type: "date" | "uuid" | "string" | "currency_code" | "uint64" | "decimal" | "ratio";
  readonly operators: ReadonlyArray<Operator>;
  readonly help: string;
  readonly requiredDimension?: string;
  readonly requiredCompanions?: ReadonlyArray<string>;
  readonly additive?: boolean;
}

const textOperators: ReadonlyArray<Operator> = ["equals", "not_equals", "contains", "is_empty"];
const idOperators: ReadonlyArray<Operator> = ["equals", "not_equals"];
const dateOperators: ReadonlyArray<Operator> = ["equals", "not_equals", "before", "on_or_after"];
const measureOperators: ReadonlyArray<Operator> = ["greater_than", "less_than"];

const dimension = (
  id: string,
  label: string,
  help: string,
  type: ReportField["type"] = "string",
  operators: ReadonlyArray<Operator> = textOperators,
): ReportField => ({ id, label, role: "dimension", type, operators, help });
const measure = (
  id: string,
  label: string,
  help: string,
  options: Partial<ReportField> = {},
): ReportField => ({
  id, label, role: "measure", type: "uint64", operators: measureOperators,
  additive: true, help, ...options,
});

export const REPORT_FIELDS: Readonly<Record<Dataset, ReadonlyArray<ReportField>>> = {
  conversions: [
    dimension("dimension.day", "Date", "UTC day of the canonical conversion state.", "date", dateOperators),
    dimension("dimension.hour", "Hour", "Canonical UTC event hour."),
    dimension("dimension.flow_id", "Flow", "Stable Flow identity.", "uuid", idOperators),
    dimension("dimension.source_connection", "Source Connection", "Connection that admitted the current conversion state.", "uuid", idOperators),
    dimension("dimension.product_type", "Product", "Listicles or LeadGen product."),
    dimension("dimension.activity_id", "Activity", "Stable versioned Activity identity."),
    dimension("dimension.vertical_id", "Vertical", "Stable versioned Vertical identity."),
    dimension("dimension.offer_public_id", "Offer", "Namespaced public Offer identity."),
    dimension("dimension.provider", "Source provider", "Provider recorded on the canonical conversion state."),
    dimension("dimension.qualification_status", "Qualification status", "Qualified, waiting, ignored, or invalid current state."),
    dimension("dimension.attribution_state", "Attribution state", "Current canonical attribution state."),
    dimension("dimension.media_platform", "Platform", "Media platform recorded by the conversion."),
    dimension("dimension.platform_account_id", "Platform account", "Authorized platform account identity."),
    dimension("dimension.campaign_id", "Campaign", "Attributed campaign identity."),
    dimension("dimension.adset_id", "Ad set", "Attributed ad-set identity."),
    dimension("dimension.ad_id", "Ad", "Attributed ad identity."),
    dimension("dimension.source_currency", "Source currency", "Original ISO currency; required beside source money.", "currency_code", idOperators),
    dimension("dimension.reporting_currency", "Reporting currency", "Workspace reporting ISO currency; required beside converted money.", "currency_code", idOperators),
    dimension("dimension.destination_eligibility", "Destination eligibility", "Deleted, eligible, or ineligible destination-admission state."),
    measure("measure.candidates", "Candidates", "Current canonical candidate rows."),
    measure("measure.qualified_count", "Qualified conversions", "Qualified conversion units.", { type: "decimal" }),
    measure("measure.conversion_count", "Conversion count", "Current canonical conversion-count measure.", { type: "decimal" }),
    measure("measure.effective_value", "Effective value", "Effective value in original source currency.", { type: "decimal", requiredDimension: "dimension.source_currency" }),
    measure("measure.bid_value", "Bid value", "Known source bid amounts; missing amounts remain unavailable.", { type: "decimal", requiredDimension: "dimension.source_currency" }),
    measure("measure.actual_payout", "Actual payout", "Known source payout amounts; missing amounts remain unavailable.", { type: "decimal", requiredDimension: "dimension.source_currency" }),
    measure("measure.reporting_value", "Reporting value", "Known value converted by event-date FX; missing FX is excluded, never zero.", {
      type: "decimal", requiredDimension: "dimension.reporting_currency",
      requiredCompanions: ["measure.fx_missing_count"],
    }),
    measure("measure.fx_missing_count", "FX missing", "Rows excluded from reporting-currency totals because no approved rate existed."),
    measure("measure.attributed_count", "Attributed conversions", "Qualified units with approved attribution.", { type: "decimal" }),
    measure("measure.unattributed_count", "Unattributed conversions", "Qualified units whose current state is not attributed.", { type: "decimal" }),
    measure("measure.waiting_count", "Waiting", "Records waiting for required enrichment or matching."),
    measure("measure.ignored_count", "Ignored", "Records intentionally excluded by a Flow rule."),
    measure("measure.invalid_count", "Invalid", "Records that failed the defined contract."),
    measure("measure.attribution_rate", "Attribution rate", "Attributed divided by qualified, recomputed from additive bases.", { type: "ratio", additive: false }),
  ],
  deliveries: [
    dimension("dimension.day", "Date", "UTC day of destination delivery activity.", "date", dateOperators),
    dimension("dimension.flow_id", "Flow", "Stable Flow identity.", "uuid", idOperators),
    dimension("dimension.destination_type", "Destination", "Destination adapter type."),
    dimension("dimension.destination_account", "Destination account", "Safe public destination-account identity."),
    dimension("dimension.delivery_state", "Delivery state", "Pending, sent, retry, terminal, unknown, or cancelled state."),
    dimension("dimension.error_class", "Error class", "Redacted provider/delivery error classification."),
    measure("measure.delivery_attempts", "Attempts", "Provider attempts in the selected scope."),
    measure("measure.delivery_successes", "Successes", "Deliveries accepted by a provider."),
    measure("measure.delivery_retries", "Retries", "Retry decisions made by delivery authority."),
    measure("measure.delivery_failures", "Terminal failures", "Deliveries that cannot retry."),
    measure("measure.delivery_unknown", "Unknown outcomes", "Provider calls whose remote outcome cannot be proven."),
    measure("measure.delivery_latency_p95_ms", "P95 latency (ms)", "Daily P95 provider latency; it is never summed.", { additive: false }),
  ],
  runs: [
    dimension("dimension.day", "Date", "UTC day of source run activity.", "date", dateOperators),
    dimension("dimension.flow_id", "Flow", "Stable Flow identity.", "uuid", idOperators),
    dimension("dimension.connection_id", "Connection", "Stable source Connection identity.", "uuid", idOperators),
    dimension("dimension.trigger_type", "Trigger", "Schedule, webhook, upload, email, or manual trigger."),
    dimension("dimension.run_status", "Run status", "Visible completion state."),
    measure("measure.run_runs", "Runs", "Source runs in the selected scope."),
    measure("measure.run_records_seen", "Records seen", "Parsed input records."),
    measure("measure.run_records_accepted", "Records accepted", "Durably accepted source records."),
    measure("measure.run_records_changed", "Changed", "Records that created a new canonical state."),
    measure("measure.run_records_noop", "No-op", "Valid records that did not change state."),
    measure("measure.run_records_waiting", "Waiting", "Records awaiting a required match/enrichment."),
    measure("measure.run_records_invalid", "Invalid", "Contract-invalid records."),
    measure("measure.run_bytes_received", "Bytes received", "Raw source bytes read."),
    measure("measure.run_duration_ms", "Duration (ms)", "Total run duration."),
  ],
};

export interface ReportTemplate {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly dataset: Dataset;
  readonly dimensions: ReadonlyArray<string>;
  readonly measures: ReadonlyArray<string>;
  readonly display: "table" | "line" | "bar";
}

export const REPORT_TEMPLATES: ReadonlyArray<ReportTemplate> = [
  {
    id: "conversions_overview", name: "Conversions overview",
    description: "Daily qualified, attributed, waiting, ignored, and invalid conversions.",
    dataset: "conversions", dimensions: ["dimension.day"],
    measures: ["measure.qualified_count", "measure.attributed_count", "measure.waiting_count", "measure.ignored_count", "measure.invalid_count"],
    display: "line",
  },
  {
    id: "revenue_by_business", name: "Revenue by Activity / Vertical / Offer",
    description: "Source-currency effective value grouped by business dimensions.",
    dataset: "conversions",
    dimensions: ["dimension.activity_id", "dimension.vertical_id", "dimension.offer_public_id", "dimension.source_currency"],
    measures: ["measure.effective_value"], display: "table",
  },
  {
    id: "campaign_performance", name: "Campaign / Ad Set / Ad performance",
    description: "Qualified conversions and effective value by Meta hierarchy.",
    dataset: "conversions",
    dimensions: ["dimension.campaign_id", "dimension.adset_id", "dimension.ad_id", "dimension.source_currency"],
    measures: ["measure.qualified_count", "measure.effective_value"], display: "table",
  },
  {
    id: "source_freshness", name: "Source freshness and rejection rate",
    description: "Run volume, changed rows, waiting rows, and invalid rows by Connection.",
    dataset: "runs", dimensions: ["dimension.day", "dimension.connection_id"],
    measures: ["measure.run_records_seen", "measure.run_records_changed", "measure.run_records_waiting", "measure.run_records_invalid"], display: "line",
  },
  {
    id: "destination_health", name: "Destination success and retry rate",
    description: "Attempts, successes, retries, failures, and unknown outcomes by destination.",
    dataset: "deliveries", dimensions: ["dimension.destination_type"],
    measures: ["measure.delivery_attempts", "measure.delivery_successes", "measure.delivery_retries", "measure.delivery_failures", "measure.delivery_unknown"], display: "bar",
  },
  {
    id: "unattributed_waiting", name: "Unattributed and waiting-for-enrichment events",
    description: "Unattributed and waiting conversion counts by day and platform.",
    dataset: "conversions", dimensions: ["dimension.day", "dimension.media_platform"],
    measures: ["measure.waiting_count", "measure.unattributed_count"], display: "line",
  },
];

export function fieldFor(dataset: Dataset, id: string): ReportField | undefined {
  return REPORT_FIELDS[dataset].find((field) => field.id === id);
}
