// Pure Flow-draft helpers for the "Find our visitor" box and the destination value field.
// Kept free of UI code so they can be unit tested.

type Item = Record<string, unknown>;

export type VisitorFill = "fbc" | "client_ip_address" | "client_user_agent";
export type VisitorKeyKind = "click_id" | "session_id" | "funnel_attempt_id";

export interface VisitorLookup {
  readonly key_source_field: string;
  readonly key_kind: VisitorKeyKind;
  readonly event_types: ReadonlyArray<string>;
  readonly fill: ReadonlyArray<VisitorFill>;
}

export const VISITOR_FILLS: ReadonlyArray<{ readonly value: VisitorFill; readonly label: string }> = Object.freeze([
  { value: "fbc", label: "Ad click ID" },
  { value: "client_ip_address", label: "Visitor IP address" },
  { value: "client_user_agent", label: "Visitor browser" },
]);

export const VISITOR_KEY_KINDS: ReadonlyArray<{ readonly value: VisitorKeyKind; readonly label: string }> = Object.freeze([
  { value: "click_id", label: "Click ID from our site" },
  { value: "session_id", label: "Visit ID" },
  { value: "funnel_attempt_id", label: "Funnel attempt ID" },
]);

export const VISITOR_SOURCE_PREFIX = "kd_visitor_";
export const CONSENT_FIELD = "personal_data_consent";
export const EVENT_TYPE_PATTERN = /^[a-z][a-z0-9_]{0,63}$/u;
export const MAX_EVENT_TYPES = 20;

const FILL_VALUES = new Set<string>(VISITOR_FILLS.map(({ value }) => value));
const KEY_KINDS = new Set<string>(VISITOR_KEY_KINDS.map(({ value }) => value));

function isRecord(value: unknown): value is Item {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function mappingFields(draft: Item): Item[] {
  const mapping = draft.mapping;
  return isRecord(mapping) && Array.isArray(mapping.fields) ? mapping.fields.filter(isRecord) : [];
}

function withMappingFields(draft: Item, fields: Item[]): Item {
  const mapping = isRecord(draft.mapping) ? draft.mapping : {};
  return { ...draft, mapping: { ...mapping, fields } };
}

/** The entry "Find our visitor" adds for one filled field. */
export function visitorFillEntry(fill: VisitorFill): Item {
  return {
    canonical_field: fill,
    source_field: `${VISITOR_SOURCE_PREFIX}${fill}`,
    fixed_value: null,
    required: false,
    transforms: [],
  };
}

/** The entry the consent box adds. */
export function consentEntry(): Item {
  return { canonical_field: CONSENT_FIELD, source_field: null, fixed_value: "true", required: false, transforms: [] };
}

function isAutoFillEntry(field: Item, fill: string): boolean {
  return field.canonical_field === fill && field.source_field === `${VISITOR_SOURCE_PREFIX}${fill}`;
}

function isConsentEntry(field: Item): boolean {
  return field.canonical_field === CONSENT_FIELD && field.source_field === null && field.fixed_value === "true";
}

/** Unique source columns in the draft mapping, in order, without the columns this box adds itself. */
export function mappingSourceFields(draft: Item): string[] {
  const seen = new Set<string>();
  for (const field of mappingFields(draft)) {
    const source = field.source_field;
    if (typeof source === "string" && source.trim() !== "" && !source.startsWith(VISITOR_SOURCE_PREFIX)) {
      seen.add(source);
    }
  }
  return [...seen];
}

/** The saved lookup, or null when it is off or not readable. */
export function readVisitorLookup(draft: Item): VisitorLookup | null {
  const value = draft.visitor_lookup;
  if (!isRecord(value) || typeof value.key_source_field !== "string"
      || !KEY_KINDS.has(String(value.key_kind)) || !Array.isArray(value.event_types)) return null;
  const fill = Array.isArray(value.fill)
    ? value.fill.filter((item): item is VisitorFill => FILL_VALUES.has(String(item)))
    : VISITOR_FILLS.map(({ value: item }) => item);
  return {
    key_source_field: value.key_source_field,
    key_kind: value.key_kind as VisitorKeyKind,
    event_types: value.event_types.filter((item): item is string => typeof item === "string"),
    fill,
  };
}

/** Starting choices for the box: the saved lookup, or sensible defaults. */
export function initialVisitorLookup(draft: Item): VisitorLookup {
  return readVisitorLookup(draft) ?? {
    key_source_field: mappingSourceFields(draft)[0] ?? "",
    key_kind: "click_id",
    event_types: [],
    fill: VISITOR_FILLS.map(({ value }) => value),
  };
}

export function hasVisitorConsent(draft: Item): boolean {
  return mappingFields(draft).some(isConsentEntry);
}

/** Why the lookup cannot be turned on yet, or null when it can. */
export function visitorLookupBlocker(draft: Item, spec: VisitorLookup): string | null {
  if (!hasVisitorConsent(draft)) return "Tick the agreement box first.";
  if (!mappingSourceFields(draft).includes(spec.key_source_field)) return "Choose the column that holds the visitor key.";
  if (spec.event_types.length < 1) return "Choose at least one visitor action.";
  if (spec.event_types.length > MAX_EVENT_TYPES) return `Choose at most ${MAX_EVENT_TYPES} visitor actions.`;
  if (!spec.event_types.every((type) => EVENT_TYPE_PATTERN.test(type))) return "One of the chosen visitor actions is not valid.";
  if (spec.fill.length < 1) return "Choose at least one detail to fill in.";
  return null;
}

/**
 * Turn the lookup on (spec) or off (null).
 * On: stores the lookup, adds a mapping entry for each chosen detail that has none yet,
 * and removes entries this box added for details no longer chosen.
 * Off: clears the lookup and removes every entry this box added for details.
 * Entries the user made by hand and the consent entry are never removed here.
 */
export function applyVisitorLookup(draft: Item, spec: VisitorLookup | null): Item {
  const chosen = new Set<string>(spec?.fill ?? []);
  const kept = mappingFields(draft).filter((field) => !VISITOR_FILLS.some(
    ({ value }) => !chosen.has(value) && isAutoFillEntry(field, value),
  ));
  if (spec === null) return { ...withMappingFields(draft, kept), visitor_lookup: null };
  const missing = spec.fill
    .filter((fill) => !kept.some((field) => field.canonical_field === fill))
    .map(visitorFillEntry);
  return {
    ...withMappingFields(draft, [...kept, ...missing]),
    visitor_lookup: {
      key_source_field: spec.key_source_field,
      key_kind: spec.key_kind,
      event_types: [...spec.event_types],
      fill: VISITOR_FILLS.map(({ value }) => value).filter((value) => chosen.has(value)),
    },
  };
}

/**
 * Tick or untick the consent box. Unticking also turns the lookup off,
 * because the lookup needs the visitor's agreement.
 */
export function applyVisitorConsent(draft: Item, consent: boolean): Item {
  const fields = mappingFields(draft).filter((field) => field.canonical_field !== CONSENT_FIELD);
  if (consent) return withMappingFields(draft, [...fields, consentEntry()]);
  const withoutConsent = withMappingFields(draft, fields);
  return readVisitorLookup(draft) === null ? withoutConsent : applyVisitorLookup(withoutConsent, null);
}

/** Reads the event-type list response {result:{event_types:[...]}}; null when it is not usable. */
export function parseEventTypes(payload: unknown): string[] | null {
  if (!isRecord(payload) || !isRecord(payload.result) || !Array.isArray(payload.result.event_types)) return null;
  return [...new Set(payload.result.event_types.filter(
    (item): item is string => typeof item === "string" && EVENT_TYPE_PATTERN.test(item),
  ))];
}

// ---- Destination value ----

export const DEFAULT_VALUE_FIELD = "effective_value";

/** Fields that can never hold a money value, so they are not offered as the value to send. */
const NON_MONEY_FIELDS = new Set<string>([
  ...VISITOR_FILLS.map(({ value }) => value),
  CONSENT_FIELD,
  "click_id",
  "session_id",
  "attempt_id",
  "funnel_attempt_id",
]);

function canHoldMoney(name: string): boolean {
  return !NON_MONEY_FIELDS.has(name)
    && !/(^|_)id$/u.test(name)
    && !/^(click|session|attempt|funnel_attempt)_/u.test(name);
}

/** Value choices: the rule value first, then every mapped field that can hold money. "" means no value. */
export function destinationValueOptions(draft: Item): string[] {
  const fields = new Set<string>([DEFAULT_VALUE_FIELD]);
  for (const field of mappingFields(draft)) {
    const name = field.canonical_field;
    if (typeof name === "string" && name.trim() !== "" && canHoldMoney(name)) fields.add(name);
  }
  return [...fields];
}

/** Plain-English name for a value choice: the mapping entry's own label when it has one, else "Field: <name>". */
export function destinationValueLabel(draft: Item, name: string): string {
  if (name === DEFAULT_VALUE_FIELD) return "Value from the partner's report (effective value)";
  const entry = mappingFields(draft).find((field) => field.canonical_field === name);
  const label = entry?.label;
  return typeof label === "string" && label.trim() !== "" ? label.trim() : `Field: ${name}`;
}

/** Sets value_field and keeps currency_field in step: "currency" when a value is sent, otherwise null. */
export function applyDestinationValue(mapping: Item, valueField: string | null): Item {
  const value = valueField === null || valueField === "" ? null : valueField;
  return { ...mapping, value_field: value, currency_field: value === null ? null : "currency" };
}

/** Meta does not take a click ID field; it needs an action source instead. */
export function applyDestinationKind(mapping: Item, isMeta: boolean): Item {
  if (isMeta) {
    return {
      ...mapping,
      click_id_field: null,
      action_source: typeof mapping.action_source === "string" ? mapping.action_source : "other",
    };
  }
  return { ...mapping, click_id_field: mapping.click_id_field ?? "click_id" };
}

export function defaultDestination(connectionId: string, isMeta: boolean): Item {
  return {
    connection_id: connectionId,
    enabled: false,
    event_filter: { qualification_statuses: ["qualified"], required_fields: ["event_id", "occurred_at"] },
    mapping: {
      event_name: "Purchase", event_id_field: "event_id", event_time_field: "occurred_at",
      value_field: DEFAULT_VALUE_FIELD, currency_field: "currency", click_id_field: isMeta ? null : "click_id",
      source_url_field: null, action_source: "other", query_templates: [], header_templates: [], body_template: null,
    },
    delivery_policy: {
      batch_size: 100, maximum_attempts: 12, maximum_age_seconds: 604800,
      retry_profile: "bounded_24h", unknown_outcome_policy: "hold_for_review", dedupe_mode: "provider_native",
    },
  };
}

/** A Meta destination saved earlier with "website" is switched to "other", which Facebook accepts here. */
export const ACTION_SOURCE_CHANGED_NOTE = "Changed 'Where the conversion happened' to Other, which Facebook accepts.";

export function fixMetaActionSource(draft: Item, isMeta: (connectionId: unknown) => boolean): { draft: Item; changed: boolean } {
  if (!Array.isArray(draft.destinations)) return { draft, changed: false };
  let changed = false;
  const destinations = draft.destinations.map((destination: unknown) => {
    if (!isRecord(destination) || !isRecord(destination.mapping)
        || destination.mapping.action_source !== "website" || !isMeta(destination.connection_id)) return destination;
    changed = true;
    return { ...destination, mapping: { ...destination.mapping, action_source: "other" } };
  });
  return changed ? { draft: { ...draft, destinations }, changed } : { draft, changed };
}

// ---- Conversion time ----

export const DEFAULT_TIME_ZONE = "UTC";
export const DEFAULT_TIME_FIELD = "occurred_at";
export const TIME_HEADING = "When did the conversion happen?";
export const TIME_RECEIVED_LABEL = "When we received it (recommended)";
export const TIME_FIELD_LABEL = "From a field the partner sends";
export const TIME_FIELD_NOTE = "We understand most date formats (for example 2026-11-03T14:05:00Z, 2026-11-03 14:05:00, or a Unix timestamp). "
  + "If the time is missing or unreadable, we use the time we received it.";
export const TIME_ZONE_HELP = "Used only when the partner's time has no time zone.";
export const TIME_STRICT_NOTE = "This Flow reads the time in one exact format and refuses a conversion whose time is missing or unreadable.";
export const TIME_RECOMMENDED_BUTTON = "Use the recommended setting";

/** The time block a new Flow draft sends: the time we received the postback, read forgivingly. */
export function defaultTime(): Item {
  return { occurred_at_field: null, input_format: "auto", timezone: DEFAULT_TIME_ZONE, invalid_policy: "received_at" };
}

function timeOf(draft: Item): Item {
  return isRecord(draft.time) ? draft.time : {};
}

function withoutOccurredAtMapping(draft: Item): Item {
  const fields = mappingFields(draft);
  const kept = fields.filter((field) => field.canonical_field !== "occurred_at");
  return kept.length === fields.length ? draft : withMappingFields(draft, kept);
}

/** True when the conversion time is the time we received the postback. */
export function usesReceivedTime(draft: Item): boolean {
  return timeOf(draft).occurred_at_field === null;
}

/** True for a draft that still reads the partner time strictly (saved before the forgiving setting existed). */
export function needsRecommendedTime(draft: Item): boolean {
  const time = timeOf(draft);
  return time.occurred_at_field !== null && !(time.input_format === "auto" && time.invalid_policy === "received_at");
}

/** The partner field the time is read from, or null when the received time is used. */
export function timeSourceField(draft: Item): string | null {
  const time = timeOf(draft);
  if (time.occurred_at_field === null) return null;
  // On the strict setting an explicit occurred_at mapping entry wins over the time block.
  if (needsRecommendedTime(draft)) {
    const entry = mappingFields(draft).find((field) => field.canonical_field === "occurred_at");
    if (typeof entry?.source_field === "string" && entry.source_field !== "") return entry.source_field;
  }
  return typeof time.occurred_at_field === "string" ? time.occurred_at_field : null;
}

/** Use the time we received the postback. */
export function applyReceivedTime(draft: Item): Item {
  return {
    ...withoutOccurredAtMapping(draft),
    time: { ...timeOf(draft), occurred_at_field: null, input_format: "auto", invalid_policy: "received_at" },
  };
}

/** Read the time from a partner field. A draft still on the strict setting keeps it and only changes the field. */
export function applyFieldTime(draft: Item, field: string): Item {
  if (needsRecommendedTime(draft)) {
    const fields = mappingFields(draft).map((entry) => entry.canonical_field === "occurred_at" && entry.source_field !== null
      ? { ...entry, source_field: field }
      : entry);
    return { ...withMappingFields(draft, fields), time: { ...timeOf(draft), occurred_at_field: field } };
  }
  return {
    ...withoutOccurredAtMapping(draft),
    time: { ...timeOf(draft), occurred_at_field: field, input_format: "auto", invalid_policy: "received_at" },
  };
}

/** One click for a strict draft: keep the field it reads, read it forgivingly, fall back to the received time. */
export function applyRecommendedTime(draft: Item, zones: ReadonlyArray<string> = timeZoneOptions()): Item {
  const timezone = timeOf(draft).timezone;
  return {
    ...withoutOccurredAtMapping(draft),
    time: {
      occurred_at_field: timeSourceField(draft) ?? DEFAULT_TIME_FIELD,
      input_format: "auto",
      timezone: typeof timezone === "string" && zones.includes(timezone) ? timezone : DEFAULT_TIME_ZONE,
      invalid_policy: "received_at",
    },
  };
}

export function applyTimeZone(draft: Item, timezone: string): Item {
  return { ...draft, time: { ...timeOf(draft), timezone } };
}

/** Time zones to choose from: UTC first, then every zone this browser knows, plus the saved one. */
export function timeZoneOptions(saved?: unknown): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
  let zones: string[] = [];
  try {
    zones = typeof intl.supportedValuesOf === "function" ? intl.supportedValuesOf("timeZone") : [];
  } catch {
    zones = [];
  }
  const list = new Set<string>([DEFAULT_TIME_ZONE, ...zones]);
  if (typeof saved === "string" && saved !== "") list.add(saved);
  return [...list];
}

/** Partner fields offered for the time: the saved one, the usual name, then the mapped columns. */
export function timeFieldOptions(draft: Item): string[] {
  const saved = timeSourceField(draft);
  return [...new Set([...(saved === null ? [] : [saved]), DEFAULT_TIME_FIELD, ...mappingSourceFields(draft)])];
}

/** One line for the partner link: what a partner must send at minimum. */
export const POSTBACK_MINIMUM_LINE = "At minimum, the partner must send the record id field (set in the Flow's Map fields step, usually id). "
  + "The time field is needed only if the Flow takes the conversion time 'From a field the partner sends'.";

// ---- New drafts and saving ----

/** A rule outcome with no value. */
export function defaultOutcome(status = "invalid"): Item {
  return { status, effective_value_rule: status, value: null };
}

/** A new Flow draft with safe defaults; nothing qualifies until rules are set. */
export function defaultFlowDraft(context: { readonly timeZone: string; readonly reportingCurrency: string }, sourceId: string): Item {
  return {
    name: "",
    description: "",
    product_scope: "both",
    activity_label: "Conversion",
    vertical_label: "All",
    offer_scope: { type: "all", value: "all" },
    primary_connection_id: sourceId,
    primary_config: {
      input_ordinal: 0,
      precedence: { business_version_field: null, business_version_kind: "none", input_priority: 100 },
    },
    identity_namespace: `flow-${crypto.randomUUID()}`,
    identity_fields: ["source_record_id"],
    normalization: {
      fields: [{ source_field: "id", transforms: [{ op: "trim" }, { op: "unicode_nfc" }] }],
    },
    rules: {
      ordered: [{
        id: "default_invalid",
        predicate: { op: "always" },
        outcome: defaultOutcome(),
        on_value_error: null,
      }],
      default_outcome: defaultOutcome(),
    },
    mapping: {
      fields: [{
        canonical_field: "source_record_id",
        source_field: "id",
        fixed_value: null,
        required: true,
        transforms: [{ op: "trim" }, { op: "unicode_nfc" }],
      }],
    },
    // The time block alone decides the conversion time, so there is no occurred_at mapping entry.
    // The time zone is UTC, not the browser's or workspace's: it applies only to partner times without one.
    time: defaultTime(),
    currency: {
      reporting_currency: context.reportingCurrency,
      source_currency_field: null,
      fixed_source_currency: context.reportingCurrency,
      conversion_policy: "same_currency_only",
    },
    patch_inputs: [],
    internal_outputs: {
      canonical_storage: true,
      reporting: true,
      dashboard: false,
      dashboard_revenue: false,
    },
    destinations: [],
  };
}


/** The draft body to send on create or update. The service may return description as null but accepts only text. */
export function draftBodyForSave(draft: Item): Item {
  return { ...draft, description: typeof draft.description === "string" ? draft.description : "" };
}

// ---- Publish review ----

const PAGE_ADDRESS_SENTENCE = "Facebook needs the page address for Website conversions, and this Flow does not send one. "
  + "Open the Facebook connection this Flow sends to (Connections → that connection → Sending to the ad platform), set Where the conversion happened to Other, save, and review again.";

const PUBLISH_REVIEW_SENTENCES: Readonly<Record<string, string>> = Object.freeze({
  ownership_conflict: "Another Flow already sends conversions for these offers. In Basics → Offers, choose only this partner's offers.",
  ownership_scope_unresolved: "Some chosen offers could not be found. In Basics → Offers, check the offer or group reference.",
  ownership_claim_set_not_exact: "The offers this Flow sends for have changed. Run the previews again, then review again.",
  connection_test_not_current: "Run the connection test again (Connections → this connection → Run test).",
  source_input_not_ready: "Open the partner link once (Connections → Try the link) to create a preview sample.",
  destination_not_ready: "A destination is not ready. Open each destination connection, save its credentials, run the test, then review again.",
  source_preview_not_ready: "The source preview did not pass. In Preview real data, choose a sample and run Preview source again.",
  rule_preview_not_ready: "The rules preview did not pass. In Side-effect-free test, run Preview rules again.",
  destination_preview_not_ready: "The destinations preview did not pass. In Side-effect-free test, run Preview destinations again.",
  connection_facts_changed: "A connection changed after the previews ran. Run all previews again, then review again.",
  identity_uniqueness_bounded_sample_only: "Duplicate checks used only the preview sample, not all past data.",
  sample_contains_invalid_rows: "Some rows in the preview sample were not valid. Check the field mapping and rules.",
  sample_contains_duplicate_commands: "The preview sample contains repeated rows. Repeats are counted once.",
});

const SAMPLE_RECORD_REASONS: Readonly<Record<string, string>> = Object.freeze({
  identity_missing: "the record id",
  time_missing: "the conversion time",
  time_invalid: "a readable conversion time",
});

/**
 * Sentence for the sample_record_invalid blocker, from the review's
 * sample_record_issue { sample_index, reason, field }.
 */
export function sampleRecordInvalidSentence(issue: unknown): string {
  const reason = isRecord(issue) && typeof issue.reason === "string" ? issue.reason : null;
  if (reason === "sample_unavailable") {
    return "The test postback could not be read. Send the test link again, then run the previews and review again.";
  }
  const words = reason === null ? undefined : SAMPLE_RECORD_REASONS[reason];
  const field = isRecord(issue) && typeof issue.field === "string" && issue.field !== "" ? issue.field : null;
  const what = words === undefined ? "" : `: ${words}${field === null ? "" : ` (field '${field}')`}`;
  return `The test postback is missing something the Flow needs${what}. Fix the partner link or the mapping, then send the test link again.`;
}

/** Plain-English sentence, with the action to take, for a publish-review blocker or warning code. */
export function publishReviewSentence(code: string, kind: "blocker" | "warning" = "blocker", review?: Item): string {
  if (code === "sample_record_invalid") return sampleRecordInvalidSentence(review?.sample_record_issue);
  const known = PUBLISH_REVIEW_SENTENCES[code];
  if (known !== undefined) return known;
  // The page-address blocker is matched by meaning so any spelling of its code gets the same help.
  if (/page_address|source_url|event_source/u.test(code)) return PAGE_ADDRESS_SENTENCE;
  return kind === "blocker"
    ? `Something blocks publishing (code: ${code}). Contact support with this code.`
    : `Something needs a look (code: ${code}). Contact support with this code.`;
}
