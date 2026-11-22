// Send-only Offers: the stored setting and the "Accepted when" rule
// (src/leadgen/send-only.ts). Pure functions, no database.
import { describe, expect, it } from "vitest";
import {
  evaluateSendOnlyAcceptance,
  isSendOnlyOffer,
  normalizeSendOnlyInput,
  parseSendOnly,
  sendOnlyConfigFor,
  sendOnlyDedupeKey,
} from "../src/leadgen/send-only";

const ANY_OK = { kind: "any_ok" } as const;
const STATUS_ACCEPTED = { kind: "field_equals", field: "status", value: "accepted" } as const;

describe("send-only stored setting", () => {
  it("NULL, empty, unreadable and 'card' all mean Show a card", () => {
    expect(parseSendOnly(null)).toBeNull();
    expect(parseSendOnly("")).toBeNull();
    expect(parseSendOnly("{not json")).toBeNull();
    expect(parseSendOnly('{"display":"card"}')).toBeNull();
    expect(parseSendOnly('["send_only"]')).toBeNull();
  });

  it("reads both rules", () => {
    expect(parseSendOnly('{"display":"send_only","accept":{"kind":"any_ok"}}')).toEqual({
      display: "send_only",
      accept: ANY_OK,
    });
    expect(parseSendOnly(JSON.stringify({ display: "send_only", accept: STATUS_ACCEPTED }))).toEqual({
      display: "send_only",
      accept: STATUS_ACCEPTED,
    });
    // A missing rule falls back to "Any OK reply".
    expect(parseSendOnly('{"display":"send_only"}')).toEqual({ display: "send_only", accept: ANY_OK });
  });

  it("applies only to Provider request · static bid (CPL) Offers", () => {
    const json = '{"display":"send_only","accept":{"kind":"any_ok"}}';
    expect(isSendOnlyOffer({ calls_provider_api: 1, bid_source: "static", send_only_json: json })).toBe(true);
    expect(isSendOnlyOffer({ calls_provider_api: 1, bid_source: "dynamic", send_only_json: json })).toBe(false);
    expect(isSendOnlyOffer({ calls_provider_api: 0, bid_source: "static", send_only_json: json })).toBe(false);
    expect(isSendOnlyOffer({ calls_provider_api: 1, bid_source: "static", send_only_json: null })).toBe(false);
    expect(sendOnlyConfigFor({ calls_provider_api: 1, bid_source: "static" })).toBeNull();
  });
});

describe("send-only admin input", () => {
  it("Show a card stores NULL", () => {
    expect(normalizeSendOnlyInput(null)).toEqual({ stored: null, errors: {} });
    expect(normalizeSendOnlyInput({ display: "card", accept: STATUS_ACCEPTED })).toEqual({ stored: null, errors: {} });
  });

  it("stores the canonical JSON for each rule", () => {
    expect(normalizeSendOnlyInput({ display: "send_only" }).stored).toBe(
      '{"display":"send_only","accept":{"kind":"any_ok"}}',
    );
    expect(
      normalizeSendOnlyInput({ display: "send_only", accept: { kind: "field_equals", field: " result.status ", value: " Accepted " } })
        .stored,
    ).toBe('{"display":"send_only","accept":{"kind":"field_equals","field":"result.status","value":"Accepted"}}');
    // The {response:…} chip form is accepted and stored as the bare path.
    expect(
      JSON.parse(
        normalizeSendOnlyInput({ display: "send_only", accept: { kind: "field_equals", field: "{response:status}", value: "ok" } })
          .stored ?? "null",
      ).accept.field,
    ).toBe("status");
    // A JSON string is accepted too.
    expect(normalizeSendOnlyInput('{"display":"send_only","accept":{"kind":"any_ok"}}').errors).toEqual({});
  });

  it("refuses a field rule without a field or a value, and unknown choices", () => {
    const r = normalizeSendOnlyInput({ display: "send_only", accept: { kind: "field_equals", field: "", value: "" } });
    expect(r.stored).toBeNull();
    expect(Object.keys(r.errors).sort()).toEqual(["send_only_accept_field", "send_only_accept_value"]);
    expect(normalizeSendOnlyInput({ display: "send_only", accept: { kind: "field_equals", field: "a b", value: "x" } }).errors)
      .toHaveProperty("send_only_accept_field");
    expect(normalizeSendOnlyInput({ display: "banner" }).errors).toHaveProperty("send_only_display");
    expect(normalizeSendOnlyInput({ display: "send_only", accept: { kind: "regex" } }).errors).toHaveProperty(
      "send_only_accept_kind",
    );
    expect(normalizeSendOnlyInput("{oops").errors).toHaveProperty("send_only_display");
    // An "accept" that is not an object is refused, never read as "Any OK reply".
    expect(normalizeSendOnlyInput({ display: "send_only", accept: "field_equals" }).errors).toHaveProperty(
      "send_only_accept_kind",
    );
  });
});

describe("send-only acceptance", () => {
  const ok = (parsed?: unknown) => ({ status: 200, timed_out: false, parsed });

  it("Any OK reply: any 2xx in time is accepted, even a plain-text body", () => {
    expect(evaluateSendOnlyAcceptance(ANY_OK, ok({ success: true }))).toEqual({ accepted: true, reason: "accepted" });
    expect(evaluateSendOnlyAcceptance(ANY_OK, ok(undefined))).toEqual({ accepted: true, reason: "accepted" });
    expect(evaluateSendOnlyAcceptance(ANY_OK, { status: 204, timed_out: false })).toEqual({ accepted: true, reason: "accepted" });
  });

  it("a timeout or an error reply is never accepted", () => {
    expect(evaluateSendOnlyAcceptance(ANY_OK, { status: null, timed_out: true })).toEqual({ accepted: false, reason: "timeout" });
    expect(evaluateSendOnlyAcceptance(ANY_OK, { status: 200, timed_out: true })).toEqual({ accepted: false, reason: "timeout" });
    expect(evaluateSendOnlyAcceptance(ANY_OK, { status: 500, timed_out: false })).toEqual({ accepted: false, reason: "error_reply" });
    expect(evaluateSendOnlyAcceptance(ANY_OK, { status: 302, timed_out: false })).toEqual({ accepted: false, reason: "error_reply" });
    expect(evaluateSendOnlyAcceptance(ANY_OK, { status: null, timed_out: false })).toEqual({ accepted: false, reason: "error_reply" });
    expect(evaluateSendOnlyAcceptance(STATUS_ACCEPTED, { status: 400, timed_out: false, parsed: { status: "accepted" } }))
      .toEqual({ accepted: false, reason: "error_reply" });
  });

  it("field rule: equal value accepted; other value, missing field, non-JSON not", () => {
    expect(evaluateSendOnlyAcceptance(STATUS_ACCEPTED, ok({ status: "accepted" })).accepted).toBe(true);
    expect(evaluateSendOnlyAcceptance(STATUS_ACCEPTED, ok({ status: " ACCEPTED " })).accepted).toBe(true);
    expect(evaluateSendOnlyAcceptance(STATUS_ACCEPTED, ok({ status: "rejected" }))).toEqual({ accepted: false, reason: "field_mismatch" });
    expect(evaluateSendOnlyAcceptance(STATUS_ACCEPTED, ok({ result: "accepted" }))).toEqual({ accepted: false, reason: "field_missing" });
    expect(evaluateSendOnlyAcceptance(STATUS_ACCEPTED, ok({ status: null }))).toEqual({ accepted: false, reason: "field_missing" });
    expect(evaluateSendOnlyAcceptance(STATUS_ACCEPTED, ok(undefined))).toEqual({ accepted: false, reason: "field_missing" });
    expect(evaluateSendOnlyAcceptance(STATUS_ACCEPTED, ok({ status: { code: "accepted" } }))).toEqual({
      accepted: false,
      reason: "field_mismatch",
    });
  });

  it("field rule: booleans and numbers compare by text, nested paths work", () => {
    const success = { kind: "field_equals", field: "success", value: "true" } as const;
    expect(evaluateSendOnlyAcceptance(success, ok({ success: true })).accepted).toBe(true);
    expect(evaluateSendOnlyAcceptance(success, ok({ success: false }))).toEqual({ accepted: false, reason: "field_mismatch" });
    const code = { kind: "field_equals", field: "data.0.code", value: "1" } as const;
    expect(evaluateSendOnlyAcceptance(code, ok({ data: [{ code: 1 }] })).accepted).toBe(true);
  });

  it("a damaged stored field rule never accepts (books nothing)", () => {
    const broken = parseSendOnly('{"display":"send_only","accept":{"kind":"field_equals","field":"","value":""}}');
    expect(broken).not.toBeNull();
    expect(evaluateSendOnlyAcceptance(broken!.accept, ok({ status: "accepted" }))).toEqual({
      accepted: false,
      reason: "rule_incomplete",
    });
  });

  it("one dedupe key per Offer", () => {
    expect(sendOnlyDedupeKey("lgo_1")).toBe("lg:send_only:lgo_1");
    expect(sendOnlyDedupeKey("lgo_1")).not.toBe(sendOnlyDedupeKey("lgo_2"));
  });
});
