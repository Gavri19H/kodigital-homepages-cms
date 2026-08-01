// Listicles tracking events — design contract §16 (+ §30.7 link dims +
// §31.9 v1.2.2 columns), emitted to the NEW Firehose stream `listicle-events`
// (S3 → Athena DB `listicles`, tables `events` + `sessions`).
//
// EXTENDS the homepage pipeline WITHOUT touching it: `sendToFirehose`
// (aws4fetch PutRecordBatch) is reused via import; `analytics/events.ts` /
// `analytics/router.ts` / the `homepage-events` stream stay byte-untouched.
// Exactly like the homepage path, delivery is fire-and-forget and a
// STRUCTURED NO-OP when AWS creds or the stream name are absent (tests,
// local dev, pre-provisioned envs — §28 Q3: the worker must behave until
// the conductor provisions the stream).
//
// Record-kind discriminator (authored, documented for the Athena DDL in
// infra/listicles/athena-ddl.sql): every record carries
//   record_kind: "event" | "session" | "dead_letter"
// All kinds ride the SAME stream/prefix; the Athena tables select their kind
// with a `record_kind = '…'` predicate (JSON SerDe returns NULL for keys a
// record does not carry, so events and sessions coexist in one S3 location).

import { sendToFirehose } from "./firehose";
import type { Env } from "../env";
import type { WaitUntilContext } from "../wait-until-context";

// The §16 event-type set (6 types; `offer_impression` is first-class §9.3).
export const LISTICLE_EVENT_TYPES = [
  "page_view",
  "page_reach",
  "section_impression",
  "offer_impression",
  "offer_click",
  "conversion",
] as const;

export type ListicleEventType = (typeof LISTICLE_EVENT_TYPES)[number];

// One row in Athena `listicles.events` — §16 columns 1:1 (lowercase keys),
// plus the §30.7 link-instance dims, the §31.9 v1.2.2 additions
// (page_view_id + quality flags) and the record_kind discriminator.
// Strings default to "" (never undefined — a stable column set per record);
// numerics are numbers; quality flags are booleans.
export interface ListicleEvent {
  record_kind: "event";
  // identity/context
  session_id: string;
  event_id: string;
  event_type: string;
  timestamp: number; // client event time, epoch ms (server-clamped)
  received_at: number; // server receive time, epoch ms
  site_id: string;
  article_id: string;
  article_name: string;
  article_url: string;
  lander_v: string;
  // placement
  article_version_id: string;
  article_version_revision: number;
  article_experiment_id: string;
  article_variant_id: string;
  article_variant_label: string;
  article_split_percentage: number | null;
  page: string; // the raw p= value as sent (mirrors the {page} macro)
  page_index: number | null;
  page_selection_mode: string;
  section_id: string;
  section_name: string;
  page_candidate_id: string;
  ab_test_id: string;
  ab_split_percentage: number | null;
  page_rule_set_id: string;
  page_rule_id: string;
  page_rule_priority: number | null;
  selection_reason: string;
  matched_rule_json_hash: string;
  offer_id: string;
  offer_name: string;
  click_id: string;
  // §30.7 link-instance dims
  link_instance_id: string;
  section_block_id: string;
  link_role: string;
  link_position_index: number | null;
  button_style_id: string;
  button_group_id: string;
  anchor_text_hash: string;
  analytics_label: string;
  // acquisition
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
  // client/geo
  device: string;
  os: string;
  os_version: string;
  browser: string;
  browser_version: string;
  country: string;
  state: string;
  city: string;
  ip: string;
  ua: string;
  url: string;
  referer: string;
  language: string;
  // §31.9
  page_view_id: string;
  is_bot: boolean;
  is_internal: boolean;
  is_preview: boolean;
  traffic_quality_flag: string; // clean | bot | internal | preview
}

// One row in Athena `listicles.sessions` (§16 — written on `page_view`).
// first_seen/last_seen are per-record observations: the stream is
// append-only, so the session's true bounds are min(first_seen)/
// max(last_seen) aggregated downstream (ClickHouse lst_sessions collapses by
// session_id — Phase 8); this record carries the §16 column set verbatim
// plus the §31.9 additions.
export interface ListicleSessionRecord {
  record_kind: "session";
  session_id: string;
  first_seen: number;
  last_seen: number;
  site_id: string;
  landing_url: string;
  article_id: string;
  lander_v: string;
  article_version_id: string;
  traffic_source: string;
  utm_source: string;
  utm_medium: string;
  utm_content: string;
  placement: string;
  cpc: string;
  fbclid: string;
  fbc: string;
  device: string;
  os: string;
  os_version: string;
  browser: string;
  browser_version: string;
  country: string;
  state: string;
  city: string;
  ip: string;
  ua: string;
  url: string;
  referer: string;
  language: string;
  // §31.9: sessions carry the quality flags + the minting page_view_id too.
  page_view_id: string;
  is_bot: boolean;
  is_internal: boolean;
  is_preview: boolean;
  traffic_quality_flag: string;
}

// §31.6 dead-letter record (audit copy of the D1 `listicle_event_dead_letter`
// row). It rides the same stream flagged record_kind="dead_letter" so the
// Athena `listicles.events` table (record_kind='event') never counts it; the
// physical `listicles/dead-letter/firehose/` S3 prefix is the STREAM's
// ErrorOutputPrefix (Firehose-level failures) — see infra/listicles/
// aws-provision.md for the two-level dead-letter layout.
export interface ListicleDeadLetterRecord {
  record_kind: "dead_letter";
  event_id: string;
  reason: string;
  payload_json: string;
  received_at: number;
}

export type ListicleStreamRecord =
  | ListicleEvent
  | ListicleSessionRecord
  | ListicleDeadLetterRecord;

export interface ListicleEmitOutcome {
  // "queued"   — records handed to ctx.waitUntil for Firehose delivery.
  // "noop"     — creds/stream absent (structured no-op, like the homepage).
  // "empty"    — nothing to send.
  status: "queued" | "noop" | "empty";
  records: number;
}

// Build the firehose config from env and dispatch on ctx.waitUntil so
// delivery never blocks the request. Mirrors analytics/events.ts emitEvents
// exactly, pointed at LISTICLE_EVENTS_FIREHOSE_STREAM. Never throws.
export function emitListicleRecords(
  env: Env,
  ctx: WaitUntilContext,
  records: ListicleStreamRecord[],
): ListicleEmitOutcome {
  if (records.length === 0) return { status: "empty", records: 0 };

  const accessKeyId = env.AWS_ACCESS_KEY_ID ?? "";
  const secretAccessKey = env.AWS_SECRET_ACCESS_KEY ?? "";
  const streamName = env.LISTICLE_EVENTS_FIREHOSE_STREAM ?? "";
  // No creds or no stream configured -> structured no-op (tests / local dev /
  // the stream not yet provisioned). The caller's 204 is unaffected.
  if (!accessKeyId || !secretAccessKey || !streamName) {
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
          `[lst-analytics] firehose dispatch failed: ${message.substring(0, 500)}`,
        );
      }),
    );
  } catch {
    // waitUntil unavailable (some test contexts): tracking must never break
    // the request — drop the batch rather than throw (homepage stance).
    return { status: "noop", records: records.length };
  }
  return { status: "queued", records: records.length };
}

// Blank §16 event with every column present (strings "", numerics null,
// flags false). Producers overlay what they know; the record ALWAYS carries
// the full column set so Athena sees a stable schema.
export function blankListicleEvent(
  eventType: string,
  now: number,
): ListicleEvent {
  return {
    record_kind: "event",
    session_id: "",
    event_id: "",
    event_type: eventType,
    timestamp: now,
    received_at: now,
    site_id: "",
    article_id: "",
    article_name: "",
    article_url: "",
    lander_v: "",
    article_version_id: "",
    article_version_revision: 0,
    article_experiment_id: "",
    article_variant_id: "",
    article_variant_label: "",
    article_split_percentage: null,
    page: "",
    page_index: null,
    page_selection_mode: "",
    section_id: "",
    section_name: "",
    page_candidate_id: "",
    ab_test_id: "",
    ab_split_percentage: null,
    page_rule_set_id: "",
    page_rule_id: "",
    page_rule_priority: null,
    selection_reason: "",
    matched_rule_json_hash: "",
    offer_id: "",
    offer_name: "",
    click_id: "",
    link_instance_id: "",
    section_block_id: "",
    link_role: "",
    link_position_index: null,
    button_style_id: "",
    button_group_id: "",
    anchor_text_hash: "",
    analytics_label: "",
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
    ip: "",
    ua: "",
    url: "",
    referer: "",
    language: "",
    page_view_id: "",
    is_bot: false,
    is_internal: false,
    is_preview: false,
    traffic_quality_flag: "clean",
  };
}
