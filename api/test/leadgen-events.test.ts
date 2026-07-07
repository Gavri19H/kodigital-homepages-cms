// LeadGen Phase 11 STAGE A — tracking event schema (contract 08 §22.2 dims +
// §22.3 event types + §22.5 accuracy + §30.3 raw-PII suppression).
//
// Proves: the §22.3 enumerated event-type set (the 30 types the contract lists
// verbatim — the SSOT enumeration; the §12 matrix's "31" is a documented
// off-by-one summary); every §22.2 normative dimension is a first-class column
// on the blank event (incl. the issue-22 auction IDs, the issue-31
// reasons-in-dedicated-fields, the 3-way answer_source, event_id + page_view_id);
// leadgenEventFromPayload stamps client-issued dims + SUPPRESSES raw answer PII
// by default; emitLeadgenRecords is a structured no-op without the stream/creds
// and queues on waitUntil when configured.

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import type { Env } from "../src/env";
import {
  LEADGEN_EVENT_TYPES,
  blankLeadgenEvent,
  emitLeadgenRecords,
  leadgenEventFromPayload,
  leadgenSessionFromQuoteView,
  type LeadgenEvent,
  type LeadgenStreamRecord,
} from "../src/analytics/leadgen-events";

// The 30 §22.3 event types, enumerated verbatim from the contract line.
const EXPECTED_EVENT_TYPES = [
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
  "carrier_click",
  "offer_click",
  "conversion",
  "revenue_received",
  "redirect_rule_triggered",
  "direct_offer_redirect",
];

describe("LEADGEN_EVENT_TYPES — §22.3 enumerated event types", () => {
  it("contains every §22.3-enumerated type, in order, with no duplicates", () => {
    expect([...LEADGEN_EVENT_TYPES]).toEqual(EXPECTED_EVENT_TYPES);
    expect(new Set(LEADGEN_EVENT_TYPES).size).toBe(LEADGEN_EVENT_TYPES.length);
  });

  it("covers the funnel lifecycle, the full auction chain, and monetization/redirect", () => {
    const set = new Set<string>(LEADGEN_EVENT_TYPES);
    // funnel/quote
    for (const t of ["quote_view", "section_view", "answer_click", "answer_default_applied", "quote_complete"]) {
      expect(set.has(t)).toBe(true);
    }
    // full auction chain (start → request → response/timeout/error → eligible/filtered → filled/unfilled → impression/click)
    for (const t of [
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
      "carrier_click",
      "offer_click",
    ]) {
      expect(set.has(t)).toBe(true);
    }
    // monetization / redirect
    for (const t of ["conversion", "revenue_received", "redirect_rule_triggered", "direct_offer_redirect"]) {
      expect(set.has(t)).toBe(true);
    }
  });
});

describe("blankLeadgenEvent — every §22.2 dimension is a stable column", () => {
  const e = blankLeadgenEvent("quote_view", 1000);

  it("carries the identity/context dims incl. event_id, page_view_id, funnel_attempt_id, section_order_hash", () => {
    for (const k of [
      "event_id",
      "event_type",
      "timestamp",
      "received_at",
      "session_id",
      "page_view_id",
      "site_id",
      "quote_id",
      "quote_name",
      "funnel_id",
      "funnel_name",
      "funnel_variant_id",
      "funnel_ab_test_id",
      "funnel_ab_test_revision",
      "assignment_bucket",
      "assignment_reason",
      "funnel_attempt_id",
      "section_order_hash",
    ]) {
      expect(k in e).toBe(true);
    }
    expect(e.event_type).toBe("quote_view");
    expect(e.record_kind).toBe("event");
  });

  it("carries the section/question dims incl. the 3-way answer_source + mapping versions", () => {
    for (const k of [
      "section_id",
      "section_name",
      "section_index",
      "question_id",
      "question_key",
      "answer_id",
      "answer_value_normalized",
      "answer_value_raw",
      "answer_source",
      "continue_mode",
      "continued_to_next_section",
      "section_mapping_version",
      "answer_mapping_version",
    ]) {
      expect(k in e).toBe(true);
    }
    expect(e.answer_source).toBe(""); // default: not a section/question event
  });

  it("carries the issue-22 auction IDs and the issue-31 dedicated reason fields", () => {
    for (const k of [
      "auction_config_id",
      "auction_config_version",
      "auction_instance_id",
      "auction_request_id",
      "provider_request_id",
      "auction_result_id",
      "banner_render_id",
      "auction_type",
      "winner_logic",
      "offer_id",
      "offer_name",
      "placement_id",
      "payload_schema_version",
      "offer_type",
      "provider",
      "carrier_key",
      "carrier_key_source",
      "carrier_name",
      "carrier_position",
      "bid_value",
      "bid_currency",
      "bid_source",
      "carrier_filtered_reason",
      "provider_error_reason",
      "auction_unfilled_reason",
    ]) {
      expect(k in e).toBe(true);
    }
  });

  it("carries monetization, acquisition/client/geo (incl. zip) and quality dims", () => {
    for (const k of [
      "click_id",
      "conversion_id",
      "revenue",
      "booking_trigger",
      "utm_source",
      "utm_medium",
      "utm_content",
      "traffic_source",
      "placement",
      "cpc",
      "fbc",
      "fbclid",
      "sub1",
      "sub2",
      "sub3",
      "sub4",
      "sub5",
      "device",
      "os",
      "os_version",
      "browser",
      "browser_version",
      "country",
      "state",
      "city",
      "zip",
      "ip",
      "ua",
      "url",
      "referer",
      "language",
      "is_bot",
      "is_internal",
      "is_preview",
      "traffic_quality_flag",
    ]) {
      expect(k in e).toBe(true);
    }
    expect(e.is_bot).toBe(false);
    expect(e.traffic_quality_flag).toBe("clean");
    expect(e.revenue).toBeNull();
  });
});

describe("leadgenEventFromPayload — §22.5 stamping + §30.3 raw-PII suppression", () => {
  it("stamps client-issued identity / config-version / auction-id dims", () => {
    const e = leadgenEventFromPayload(
      {
        event_type: "carrier_impression",
        event_id: "ev-1",
        page_view_id: "pv-9",
        session_id: "sid-1",
        funnel_attempt_id: "fa-1",
        section_order_hash: "soh-1",
        funnel_id: "lgf_1",
        funnel_name: "Auto",
        funnel_ab_test_revision: 4,
        answer_mapping_version: "amv-2",
        section_mapping_version: 3,
        auction_config_id: "lga_1",
        auction_config_version: "7",
        auction_instance_id: "aiid-1",
        auction_request_id: "areq-1",
        provider_request_id: "preq-1",
        auction_result_id: "ares-1",
        banner_render_id: "brid-1",
        payload_schema_version: "lgp_3",
        carrier_key: "acme",
        carrier_key_source: "provider_id",
        bid_value: 3.5,
      },
      2000,
    );
    expect(e.event_id).toBe("ev-1");
    expect(e.page_view_id).toBe("pv-9");
    expect(e.funnel_attempt_id).toBe("fa-1");
    expect(e.section_order_hash).toBe("soh-1");
    expect(e.funnel_ab_test_revision).toBe(4);
    expect(e.answer_mapping_version).toBe("amv-2");
    expect(e.section_mapping_version).toBe(3);
    expect(e.auction_config_version).toBe("7");
    expect(e.auction_instance_id).toBe("aiid-1");
    expect(e.provider_request_id).toBe("preq-1");
    expect(e.auction_result_id).toBe("ares-1");
    expect(e.banner_render_id).toBe("brid-1");
    expect(e.carrier_key).toBe("acme");
    expect(e.carrier_key_source).toBe("provider_id");
    expect(e.bid_value).toBe(3.5);
  });

  it("normalizes the 3-way answer_source and rejects unknown values to empty", () => {
    for (const v of ["default_applied", "user_selected", "user_confirmed_default"]) {
      expect(leadgenEventFromPayload({ event_type: "answer_click", answer_source: v }, 1).answer_source).toBe(v);
    }
    expect(leadgenEventFromPayload({ event_type: "answer_click", answer_source: "garbage" }, 1).answer_source).toBe("");
    expect(leadgenEventFromPayload({ event_type: "answer_click", answer_source: 7 }, 1).answer_source).toBe("");
  });

  it("SUPPRESSES raw answer PII by default; only the audited allow-flag emits it (§30.3)", () => {
    const payload = {
      event_type: "answer_click",
      answer_value_normalized: "homeowner",
      answer_value_raw: "123 Main St, Springfield",
    };
    // default: raw suppressed, normalized retained
    const suppressed = leadgenEventFromPayload(payload, 1);
    expect(suppressed.answer_value_raw).toBe("");
    expect(suppressed.answer_value_normalized).toBe("homeowner");
    // audited allow-flag: raw emitted
    const allowed = leadgenEventFromPayload(payload, 1, { allowRawAnswerValue: true });
    expect(allowed.answer_value_raw).toBe("123 Main St, Springfield");
  });

  it("keeps reasons in their dedicated fields — never in answer_value_normalized (issue 31)", () => {
    const e = leadgenEventFromPayload(
      {
        event_type: "auction_carrier_filtered",
        answer_value_normalized: "some-answer",
        carrier_filtered_reason: "missing_required_response_field",
        provider_error_reason: "timeout",
        auction_unfilled_reason: "all_carriers_shown",
      },
      1,
    );
    expect(e.carrier_filtered_reason).toBe("missing_required_response_field");
    expect(e.provider_error_reason).toBe("timeout");
    expect(e.auction_unfilled_reason).toBe("all_carriers_shown");
    expect(e.answer_value_normalized).toBe("some-answer"); // untouched by the reasons
  });

  it("clamps a wildly-out-of-range client timestamp to the server clock", () => {
    const now = 1_000_000_000_000;
    expect(leadgenEventFromPayload({ event_type: "quote_view", timestamp: now + 1000 }, now).timestamp).toBe(now + 1000);
    expect(leadgenEventFromPayload({ event_type: "quote_view", timestamp: 42 }, now).timestamp).toBe(now);
    expect(leadgenEventFromPayload({ event_type: "quote_view", timestamp: "nope" }, now).timestamp).toBe(now);
  });

  it("leadgenSessionFromQuoteView carries the funnel/session context", () => {
    const e = leadgenEventFromPayload(
      { event_type: "quote_view", session_id: "sid-1", site_id: "st_1", funnel_id: "lgf_1", url: "https://x/f" },
      5000,
    );
    const s = leadgenSessionFromQuoteView(e);
    expect(s.record_kind).toBe("session");
    expect(s.session_id).toBe("sid-1");
    expect(s.funnel_id).toBe("lgf_1");
    expect(s.landing_url).toBe("https://x/f");
  });
});

// --- emit: structured no-op vs queued -----------------------------------------

function makeEnv(withStream: boolean): Env {
  const env = {
    APP_ENV: "test",
  } as unknown as Env;
  if (withStream) {
    (env as unknown as Record<string, unknown>).AWS_ACCESS_KEY_ID = "k";
    (env as unknown as Record<string, unknown>).AWS_SECRET_ACCESS_KEY = "s";
    (env as unknown as Record<string, unknown>).LEADGEN_EVENTS_FIREHOSE_STREAM = "leadgen-events";
  }
  return env;
}

function ctxStub(): { ctx: ExecutionContext; promises: Promise<unknown>[] } {
  const promises: Promise<unknown>[] = [];
  return {
    promises,
    ctx: {
      waitUntil(p: Promise<unknown>) {
        promises.push(p);
      },
      passThroughOnException() {},
    } as unknown as ExecutionContext,
  };
}

describe("emitLeadgenRecords — §22.1 no-op vs §22.5 fail-open dispatch", () => {
  let realFetch: typeof fetch;
  beforeEach(() => {
    realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.includes("firehose")) {
        return new Response(JSON.stringify({ FailedPutCount: 0, RequestResponses: [] }), { status: 200 });
      }
      return realFetch(input as RequestInfo);
    }) as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  const rec: LeadgenStreamRecord[] = [blankLeadgenEvent("quote_view", 1)];

  it("empty batch → status 'empty'", () => {
    const { ctx } = ctxStub();
    expect(emitLeadgenRecords(makeEnv(true), ctx, [])).toEqual({ status: "empty", records: 0 });
  });

  it("no stream var / no creds → structured 'noop' (never throws)", () => {
    const { ctx } = ctxStub();
    expect(emitLeadgenRecords(makeEnv(false), ctx, [...rec])).toEqual({ status: "noop", records: 1 });
  });

  it("creds + stream present → 'queued' on waitUntil", async () => {
    const { ctx, promises } = ctxStub();
    const out = emitLeadgenRecords(makeEnv(true), ctx, [...rec]);
    expect(out.status).toBe("queued");
    expect(promises.length).toBe(1);
    await Promise.all(promises.map((p) => p.catch(() => undefined)));
  });
});
