// LeadGen tracking events — design contract 08 §22 (§22.2 normative dimensions
// + §22.3 event types + §22.5 accuracy), emitted to the Firehose stream
// `LEADGEN_EVENTS_FIREHOSE_STREAM` (S3 `leadgen/events/` → Athena DB `leadgen`,
// tables `events` / `sessions` / `dead_letter_records`).
//
// EXTENDS the homepage + listicles pipelines WITHOUT touching them:
// `sendToFirehose` (aws4fetch PutRecordBatch) is reused via import; the
// `homepage-events` / `listicle-events` streams stay byte-untouched. Exactly
// like both existing paths, delivery is fire-and-forget and a STRUCTURED
// NO-OP when AWS creds OR the stream var are absent (tests, local dev,
// pre-provisioned envs — §22.1 "absent ⇒ no-op"; do NOT create a Listicles
// Athena DB).
//
// Record-kind discriminator (§22.1 — the Athena `leadgen` DB discriminates
// events / sessions / dead_letter_records on it): every record carries
//   record_kind: "event" | "session" | "dead_letter"
// All kinds ride the SAME stream/prefix; the Athena tables select their kind
// with a `record_kind = '…'` predicate (JSON SerDe returns NULL for keys a
// record does not carry, so the three kinds coexist in one S3 location).
//
// §22.5 accuracy enforced here: `event_id` idempotency field + `page_view_id`
// impression-dedupe field are first-class columns; RAW PII / free-text answer
// values are SUPPRESSED by default (§30.3 — only normalized/hashed values ride
// the stream unless an explicit audited allow-flag is passed to the enricher).
// §22.2 issue-31: every reason lives in its OWN dedicated column
// (`carrier_filtered_reason` / `provider_error_reason` / `auction_unfilled_reason`)
// — NEVER encoded into `answer_value_normalized`.

import { sendToFirehose } from "./firehose";
import { readEnvSecret, type Env } from "../env";

// The LeadGen event-type set — 31 types (DEV-23). §22.3 flatly enumerates 30,
// but it DROPPED `offer_impression`, which §6.4 normatively DEFINES (the sibling
// of `carrier_impression`, deduped by (auction_instance_id, offer_id)), §04§10.7
// derives offer CTR (clicks/offer_impressions) from, migration 0037 mirrors, and
// the P12 ClickHouse DDL counts (`sumIf offer_impression`). The normative,
// multiply-referenced definition governs over the flat enumeration: the type
// MUST exist here, or a client offer_impression beacon dead-letters at /lg/track
// (`invalid_event_type`) and P12's offer_impressions column stays NULL forever.
export const LEADGEN_EVENT_TYPES = [
  // funnel / quote lifecycle
  "quote_view",
  "opening_lander_view",
  "opening_lander_cta_click",
  "section_view",
  "answer_click",
  "answer_change",
  "answer_default_applied",
  "continue_click",
  "section_continue",
  "validation_error",
  "address_autofill",
  "address_validation_success",
  "address_validation_error",
  "quote_complete",
  // auction lifecycle
  "auction_start",
  "auction_offer_request",
  "auction_offer_response",
  "auction_offer_timeout",
  "auction_offer_error",
  "auction_carrier_eligible",
  "auction_carrier_filtered",
  "auction_filled",
  "auction_unfilled",
  "carrier_impression",
  "offer_impression", // §6.4 sibling of carrier_impression (deduped (auction_instance_id, offer_id)); §22.3 dropped it — DEV-23
  "carrier_click",
  "offer_click",
  // monetization / redirect
  "conversion",
  "revenue_received",
  "redirect_rule_triggered",
  "direct_offer_redirect",
] as const;

export type LeadgenEventType = (typeof LEADGEN_EVENT_TYPES)[number];

// The 3-way answer provenance (§22.2 issue-driven addition). "" when the event
// is not a section/question event.
export type LeadgenAnswerSource =
  | ""
  | "default_applied"
  | "user_selected"
  | "user_confirmed_default";

// One row in Athena `leadgen.events` — the §22.2 normative dimensions 1:1
// (lowercase keys). Strings default "" (never undefined — a stable column set
// per record); numerics that may be absent are `| null`; quality flags are
// booleans. `record_kind` discriminates the row within the shared stream.
export interface LeadgenEvent {
  record_kind: "event";
  // --- identity / context (§22.2) ---
  event_id: string; // §22.5 idempotency key
  event_type: string;
  timestamp: number; // client event time, epoch ms (server-clamped)
  received_at: number; // server receive time, epoch ms
  session_id: string;
  page_view_id: string; // §22.5 impression-dedupe key
  site_id: string;
  quote_id: string;
  quote_name: string;
  funnel_id: string;
  funnel_name: string;
  funnel_variant_id: string;
  funnel_ab_test_id: string;
  funnel_ab_test_revision: number;
  assignment_bucket: string;
  assignment_reason: string;
  funnel_attempt_id: string;
  section_order_hash: string;
  // --- section / question (§22.2) ---
  section_id: string;
  section_name: string;
  section_index: number | null;
  question_id: string;
  question_key: string;
  answer_id: string;
  answer_value_normalized: string; // reasons are NEVER encoded here (issue 31)
  answer_value_raw: string; // §30.3 SUPPRESSED by default (audited allow-flag only)
  answer_source: LeadgenAnswerSource; // 3-way (issue-driven)
  continue_mode: string;
  continued_to_next_section: boolean;
  section_mapping_version: number | null;
  answer_mapping_version: string;
  // --- auction / provider (§22.2 issue-22 IDs + issue-31 reasons) ---
  auction_config_id: string;
  auction_config_version: string;
  auction_instance_id: string;
  auction_request_id: string;
  provider_request_id: string;
  auction_result_id: string;
  banner_render_id: string;
  auction_type: string;
  winner_logic: string;
  offer_id: string;
  offer_name: string;
  placement_id: string;
  payload_schema_version: string;
  offer_type: string;
  provider: string;
  carrier_key: string;
  carrier_key_source: string;
  carrier_name: string;
  carrier_position: number | null;
  bid_value: number | null;
  bid_currency: string;
  bid_source: string;
  carrier_filtered_reason: string; // dedicated field (issue 31)
  provider_error_reason: string; // dedicated field (issue 31)
  auction_unfilled_reason: string; // dedicated field (issue 31)
  // --- monetization (§22.2) ---
  click_id: string;
  conversion_id: string;
  revenue: number | null;
  booking_trigger: string;
  // --- acquisition / client / geo (§22.2) ---
  utm_source: string;
  utm_medium: string;
  utm_content: string;
  traffic_source: string;
  placement: string;
  cpc: string;
  fbc: string;
  fbclid: string;
  sub1: string;
  sub2: string;
  sub3: string;
  sub4: string;
  sub5: string;
  device: string;
  os: string;
  os_version: string;
  browser: string;
  browser_version: string;
  country: string;
  state: string;
  city: string;
  zip: string;
  ip: string;
  ua: string;
  url: string;
  referer: string;
  language: string;
  // --- quality (§22.2; `tampered` set by the §19.1 auction path) ---
  is_bot: boolean;
  is_internal: boolean;
  is_preview: boolean;
  traffic_quality_flag: string; // clean | bot | internal | preview | tampered
}

// One row in Athena `leadgen.sessions` — written on the funnel-entry event
// (`quote_view`, §22.3). Append-only; downstream collapses by session_id. It
// carries the identity + acquisition/client/geo + quality dims (the session
// context), mirroring the listicles sessions record.
export interface LeadgenSessionRecord {
  record_kind: "session";
  session_id: string;
  first_seen: number;
  last_seen: number;
  site_id: string;
  landing_url: string;
  quote_id: string;
  funnel_id: string;
  funnel_name: string;
  funnel_variant_id: string;
  funnel_ab_test_id: string;
  funnel_attempt_id: string;
  assignment_bucket: string;
  assignment_reason: string;
  traffic_source: string;
  utm_source: string;
  utm_medium: string;
  utm_content: string;
  placement: string;
  cpc: string;
  fbc: string;
  fbclid: string;
  sub1: string;
  sub2: string;
  sub3: string;
  sub4: string;
  sub5: string;
  device: string;
  os: string;
  os_version: string;
  browser: string;
  browser_version: string;
  country: string;
  state: string;
  city: string;
  zip: string;
  ip: string;
  ua: string;
  url: string;
  referer: string;
  language: string;
  page_view_id: string;
  is_bot: boolean;
  is_internal: boolean;
  is_preview: boolean;
  traffic_quality_flag: string;
}

// §22.5 dead-letter record — an audit copy (of the D1 `leadgen_event_dead_letter`
// row, migration 0038). It rides the same stream flagged
// record_kind="dead_letter" so the Athena `leadgen.events` table
// (record_kind='event') never counts it.
export interface LeadgenDeadLetterRecord {
  record_kind: "dead_letter";
  event_id: string;
  reason: string;
  payload_json: string;
  received_at: number;
}

export type LeadgenStreamRecord =
  | LeadgenEvent
  | LeadgenSessionRecord
  | LeadgenDeadLetterRecord;

export interface LeadgenEmitOutcome {
  // "queued"   — records handed to ctx.waitUntil for Firehose delivery.
  // "noop"     — creds/stream absent (structured no-op, §22.1).
  // "empty"    — nothing to send.
  status: "queued" | "noop" | "empty";
  records: number;
}

// The name of the LeadGen Firehose stream var (§22.1). Read via readEnvSecret
// (a constructed-name lookup) rather than a typed Env field so this phase adds
// no env.ts edit; Stage B declares the wrangler [vars] entry + wiring.
export const LEADGEN_EVENTS_FIREHOSE_STREAM_VAR = "LEADGEN_EVENTS_FIREHOSE_STREAM";

// Build the firehose config from env and dispatch on ctx.waitUntil so delivery
// never blocks the request. Mirrors analytics/listicle-events.ts
// emitListicleRecords exactly, pointed at LEADGEN_EVENTS_FIREHOSE_STREAM. Never
// throws — FAIL-OPEN (§22.5 / §22.1): any dispatch problem is swallowed so the
// beacon/click response is never affected.
export function emitLeadgenRecords(
  env: Env,
  ctx: ExecutionContext,
  records: LeadgenStreamRecord[],
): LeadgenEmitOutcome {
  if (records.length === 0) return { status: "empty", records: 0 };

  const accessKeyId = env.AWS_ACCESS_KEY_ID ?? "";
  const secretAccessKey = env.AWS_SECRET_ACCESS_KEY ?? "";
  const streamName = readEnvSecret(env, LEADGEN_EVENTS_FIREHOSE_STREAM_VAR) ?? "";
  // No creds or no stream configured → structured no-op (tests / local dev /
  // the stream not yet provisioned). The caller's response is unaffected.
  if (accessKeyId === "" || secretAccessKey === "" || streamName === "") {
    return { status: "noop", records: records.length };
  }

  const config = {
    accessKeyId,
    secretAccessKey,
    region: env.AWS_REGION ?? "us-east-1",
    streamName,
  };

  try {
    ctx.waitUntil(
      sendToFirehose(config, records).catch((err) => {
        const message = err instanceof Error ? err.message : "Unknown error";
        console.error(
          `[lg-analytics] firehose dispatch failed: ${message.substring(0, 500)}`,
        );
      }),
    );
  } catch {
    // waitUntil unavailable (some test contexts): tracking must never break
    // the request — drop the batch rather than throw (homepage/listicles stance).
    return { status: "noop", records: records.length };
  }
  return { status: "queued", records: records.length };
}

// Blank §22.2 event with every column present (strings "", numerics null,
// flags false, answer_source ""). Producers overlay what they know; the record
// ALWAYS carries the full column set so Athena sees a stable schema.
export function blankLeadgenEvent(eventType: string, now: number): LeadgenEvent {
  return {
    record_kind: "event",
    event_id: "",
    event_type: eventType,
    timestamp: now,
    received_at: now,
    session_id: "",
    page_view_id: "",
    site_id: "",
    quote_id: "",
    quote_name: "",
    funnel_id: "",
    funnel_name: "",
    funnel_variant_id: "",
    funnel_ab_test_id: "",
    funnel_ab_test_revision: 0,
    assignment_bucket: "",
    assignment_reason: "",
    funnel_attempt_id: "",
    section_order_hash: "",
    section_id: "",
    section_name: "",
    section_index: null,
    question_id: "",
    question_key: "",
    answer_id: "",
    answer_value_normalized: "",
    answer_value_raw: "",
    answer_source: "",
    continue_mode: "",
    continued_to_next_section: false,
    section_mapping_version: null,
    answer_mapping_version: "",
    auction_config_id: "",
    auction_config_version: "",
    auction_instance_id: "",
    auction_request_id: "",
    provider_request_id: "",
    auction_result_id: "",
    banner_render_id: "",
    auction_type: "",
    winner_logic: "",
    offer_id: "",
    offer_name: "",
    placement_id: "",
    payload_schema_version: "",
    offer_type: "",
    provider: "",
    carrier_key: "",
    carrier_key_source: "",
    carrier_name: "",
    carrier_position: null,
    bid_value: null,
    bid_currency: "",
    bid_source: "",
    carrier_filtered_reason: "",
    provider_error_reason: "",
    auction_unfilled_reason: "",
    click_id: "",
    conversion_id: "",
    revenue: null,
    booking_trigger: "",
    utm_source: "",
    utm_medium: "",
    utm_content: "",
    traffic_source: "",
    placement: "",
    cpc: "",
    fbc: "",
    fbclid: "",
    sub1: "",
    sub2: "",
    sub3: "",
    sub4: "",
    sub5: "",
    device: "",
    os: "",
    os_version: "",
    browser: "",
    browser_version: "",
    country: "",
    state: "",
    city: "",
    zip: "",
    ip: "",
    ua: "",
    url: "",
    referer: "",
    language: "",
    is_bot: false,
    is_internal: false,
    is_preview: false,
    traffic_quality_flag: "clean",
  };
}

// ---------------------------------------------------------------------------
// Event builder / enricher (§22.2 stamping + §22.5 / §30.3 privacy)
// ---------------------------------------------------------------------------

export interface LeadgenEnrichOptions {
  // §30.3 audited allow-flag: raw answer PII / free-text is SUPPRESSED from the
  // event stream by default (only normalized/hashed values ride). Set true ONLY
  // for an explicitly-audited caller; every other caller leaves answer_value_raw
  // empty.
  allowRawAnswerValue?: boolean;
}

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function asNumberOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function asBool(v: unknown): boolean {
  return v === true;
}

const ANSWER_SOURCES: ReadonlySet<string> = new Set([
  "default_applied",
  "user_selected",
  "user_confirmed_default",
]);

function asAnswerSource(v: unknown): LeadgenAnswerSource {
  return typeof v === "string" && ANSWER_SOURCES.has(v) ? (v as LeadgenAnswerSource) : "";
}

// Clamp the client timestamp: accepted when it is a finite epoch-ms within ±24h
// of now (queued retries legitimately arrive late, §22.5); anything else takes
// the server clock. Mirrors the listicles clamp.
export function clampLeadgenTimestamp(raw: unknown, now: number): number {
  const n = asNumberOrNull(raw);
  if (n === null) return now;
  const dayMs = 24 * 3600 * 1000;
  if (n < now - dayMs || n > now + dayMs) return now;
  return n;
}

// Copy the client-claimed §22.2 columns onto a blank event, STAMPING the
// identity / config-version / auction-id dims the client was issued at
// config/auction time and ENFORCING §22.5 / §30.3:
//   * `answer_value_raw` is SUPPRESSED (forced "") unless opts.allowRawAnswerValue;
//   * reasons stay in their dedicated fields (issue 31 — never copied into
//     answer_value_normalized);
//   * event_id / page_view_id are carried verbatim (the track handler mints a
//     server event_id only when the client omitted one — documented as
//     not-replay-dedupable there).
// Server-owned columns (ip/ua/device/os/…/geo/received_at/flags) are stamped by
// the TRACK handler AFTER this, overriding any client claim.
export function leadgenEventFromPayload(
  payload: Record<string, unknown>,
  now: number,
  opts: LeadgenEnrichOptions = {},
): LeadgenEvent {
  const e = blankLeadgenEvent(asString(payload["event_type"]), now);
  // identity / context
  e.event_id = asString(payload["event_id"]);
  e.timestamp = clampLeadgenTimestamp(payload["timestamp"], now);
  e.session_id = asString(payload["session_id"]);
  e.page_view_id = asString(payload["page_view_id"]);
  e.site_id = asString(payload["site_id"]);
  e.quote_id = asString(payload["quote_id"]);
  e.quote_name = asString(payload["quote_name"]);
  e.funnel_id = asString(payload["funnel_id"]);
  e.funnel_name = asString(payload["funnel_name"]);
  e.funnel_variant_id = asString(payload["funnel_variant_id"]);
  e.funnel_ab_test_id = asString(payload["funnel_ab_test_id"]);
  const abRev = asNumberOrNull(payload["funnel_ab_test_revision"]);
  e.funnel_ab_test_revision = abRev === null ? 0 : abRev;
  e.assignment_bucket = asString(payload["assignment_bucket"]);
  e.assignment_reason = asString(payload["assignment_reason"]);
  e.funnel_attempt_id = asString(payload["funnel_attempt_id"]);
  e.section_order_hash = asString(payload["section_order_hash"]);
  // section / question
  e.section_id = asString(payload["section_id"]);
  e.section_name = asString(payload["section_name"]);
  e.section_index = asNumberOrNull(payload["section_index"]);
  e.question_id = asString(payload["question_id"]);
  e.question_key = asString(payload["question_key"]);
  e.answer_id = asString(payload["answer_id"]);
  e.answer_value_normalized = asString(payload["answer_value_normalized"]);
  // §30.3: raw answer PII / free-text is suppressed unless an audited allow-flag
  // is set. Default posture: only the normalized value rides the stream.
  e.answer_value_raw = opts.allowRawAnswerValue === true ? asString(payload["answer_value_raw"]) : "";
  e.answer_source = asAnswerSource(payload["answer_source"]);
  e.continue_mode = asString(payload["continue_mode"]);
  e.continued_to_next_section = asBool(payload["continued_to_next_section"]);
  e.section_mapping_version = asNumberOrNull(payload["section_mapping_version"]);
  e.answer_mapping_version = asString(payload["answer_mapping_version"]);
  // auction / provider (IDs the client was issued at auction time)
  e.auction_config_id = asString(payload["auction_config_id"]);
  e.auction_config_version = asString(payload["auction_config_version"]);
  e.auction_instance_id = asString(payload["auction_instance_id"]);
  e.auction_request_id = asString(payload["auction_request_id"]);
  e.provider_request_id = asString(payload["provider_request_id"]);
  e.auction_result_id = asString(payload["auction_result_id"]);
  e.banner_render_id = asString(payload["banner_render_id"]);
  e.auction_type = asString(payload["auction_type"]);
  e.winner_logic = asString(payload["winner_logic"]);
  e.offer_id = asString(payload["offer_id"]);
  e.offer_name = asString(payload["offer_name"]);
  e.placement_id = asString(payload["placement_id"]);
  e.payload_schema_version = asString(payload["payload_schema_version"]);
  e.offer_type = asString(payload["offer_type"]);
  e.provider = asString(payload["provider"]);
  e.carrier_key = asString(payload["carrier_key"]);
  e.carrier_key_source = asString(payload["carrier_key_source"]);
  e.carrier_name = asString(payload["carrier_name"]);
  e.carrier_position = asNumberOrNull(payload["carrier_position"]);
  e.bid_value = asNumberOrNull(payload["bid_value"]);
  e.bid_currency = asString(payload["bid_currency"]);
  e.bid_source = asString(payload["bid_source"]);
  e.carrier_filtered_reason = asString(payload["carrier_filtered_reason"]);
  e.provider_error_reason = asString(payload["provider_error_reason"]);
  e.auction_unfilled_reason = asString(payload["auction_unfilled_reason"]);
  // monetization
  e.click_id = asString(payload["click_id"]);
  e.conversion_id = asString(payload["conversion_id"]);
  e.revenue = asNumberOrNull(payload["revenue"]);
  e.booking_trigger = asString(payload["booking_trigger"]);
  // acquisition / client / geo (server OVERRIDES device/os/geo/ip/ua later)
  e.utm_source = asString(payload["utm_source"]);
  e.utm_medium = asString(payload["utm_medium"]);
  e.utm_content = asString(payload["utm_content"]);
  e.traffic_source = asString(payload["traffic_source"]);
  e.placement = asString(payload["placement"]);
  e.cpc = asString(payload["cpc"]);
  e.fbc = asString(payload["fbc"]);
  e.fbclid = asString(payload["fbclid"]);
  e.sub1 = asString(payload["sub1"]);
  e.sub2 = asString(payload["sub2"]);
  e.sub3 = asString(payload["sub3"]);
  e.sub4 = asString(payload["sub4"]);
  e.sub5 = asString(payload["sub5"]);
  e.zip = asString(payload["zip"]);
  e.url = asString(payload["url"]);
  e.referer = asString(payload["referer"]);
  e.language = asString(payload["language"]);
  return e;
}

// §22.3 / §22.1: one leadgen.sessions record per accepted `quote_view` (the
// funnel-entry event). Append-only; downstream collapses by session_id.
export function leadgenSessionFromQuoteView(e: LeadgenEvent): LeadgenSessionRecord {
  return {
    record_kind: "session",
    session_id: e.session_id,
    first_seen: e.timestamp,
    last_seen: e.received_at,
    site_id: e.site_id,
    landing_url: e.url,
    quote_id: e.quote_id,
    funnel_id: e.funnel_id,
    funnel_name: e.funnel_name,
    funnel_variant_id: e.funnel_variant_id,
    funnel_ab_test_id: e.funnel_ab_test_id,
    funnel_attempt_id: e.funnel_attempt_id,
    assignment_bucket: e.assignment_bucket,
    assignment_reason: e.assignment_reason,
    traffic_source: e.traffic_source,
    utm_source: e.utm_source,
    utm_medium: e.utm_medium,
    utm_content: e.utm_content,
    placement: e.placement,
    cpc: e.cpc,
    fbc: e.fbc,
    fbclid: e.fbclid,
    sub1: e.sub1,
    sub2: e.sub2,
    sub3: e.sub3,
    sub4: e.sub4,
    sub5: e.sub5,
    device: e.device,
    os: e.os,
    os_version: e.os_version,
    browser: e.browser,
    browser_version: e.browser_version,
    country: e.country,
    state: e.state,
    city: e.city,
    zip: e.zip,
    ip: e.ip,
    ua: e.ua,
    url: e.url,
    referer: e.referer,
    language: e.language,
    page_view_id: e.page_view_id,
    is_bot: e.is_bot,
    is_internal: e.is_internal,
    is_preview: e.is_preview,
    traffic_quality_flag: e.traffic_quality_flag,
  };
}
