// Send-only Offers (plan "Send-only Offers", 5 Nov 2026; migration 0068).
//
// A "Provider request · static bid (CPL)" Offer can be set to "Send the lead
// only, no card": the lead is posted to the Provider, the Offer never becomes a
// clickable card, and the Provider's reply decides whether the lead was
// ACCEPTED. When no card shows at all and a send-only Offer accepted, the
// visitor sees that Offer's non-clickable banner instead of "no match".
//
// This module owns the stored format of leadgen_offers.send_only_json and the
// one acceptance rule, so the admin API, the admin Test tool, the live auction
// and the Simulator all read it the same way. Pure functions, no I/O, no
// partner names.

import { getAtPath, unwrapResponseMacro } from "../public/leadgen/auction/parse";

export type SendOnlyAcceptRule =
  | { kind: "any_ok" }
  | { kind: "field_equals"; field: string; value: string };

export interface SendOnlyConfig {
  display: "send_only";
  accept: SendOnlyAcceptRule;
}

// Limits for the operator-typed reply field and value.
export const SEND_ONLY_FIELD_MAX = 200;
export const SEND_ONLY_VALUE_MAX = 200;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// Read the stored column. NULL, empty, unreadable or "card" ⇒ null ("Show a
// card", today's behaviour). Fail-safe: a damaged value never turns an Offer
// into send-only.
export function parseSendOnly(raw: unknown): SendOnlyConfig | null {
  let v: unknown = raw;
  if (typeof v === "string") {
    if (v.trim() === "") return null;
    try {
      v = JSON.parse(v) as unknown;
    } catch {
      return null;
    }
  }
  if (!isRecord(v) || v["display"] !== "send_only") return null;
  const a = v["accept"];
  if (isRecord(a) && a["kind"] === "field_equals") {
    const field = typeof a["field"] === "string" ? a["field"].trim() : "";
    const value = typeof a["value"] === "string" ? a["value"].trim() : "";
    // A stored field rule missing its field or value is unusable. Treat it as
    // "never accepted" rather than "always accepted": money is booked on
    // acceptance, so the safe failure is to book nothing.
    return { display: "send_only", accept: { kind: "field_equals", field, value } };
  }
  return { display: "send_only", accept: { kind: "any_ok" } };
}

// The Offer is send-only only in the "Provider request · static bid (CPL)"
// mode. In any other mode the setting is ignored (the admin also refuses it).
export function sendOnlyConfigFor(offer: {
  calls_provider_api?: number | null;
  bid_source?: string | null;
  send_only_json?: string | null;
}): SendOnlyConfig | null {
  if (offer.calls_provider_api !== 1 || offer.bid_source !== "static") return null;
  return parseSendOnly(offer.send_only_json ?? null);
}

export function isSendOnlyOffer(offer: {
  calls_provider_api?: number | null;
  bid_source?: string | null;
  send_only_json?: string | null;
}): boolean {
  return sendOnlyConfigFor(offer) !== null;
}

// --- admin input --------------------------------------------------------------

export interface SendOnlyInputResult {
  // The value to store: null for "Show a card", else the canonical JSON text.
  stored: string | null;
  // Field-keyed errors, empty when valid. Keys: send_only_display,
  // send_only_accept_kind, send_only_accept_field, send_only_accept_value.
  errors: Record<string, string>;
}

// Validate what the admin sent for send_only_json (an object, a JSON string, or
// null). It does NOT check the Offer's mode, logo or headline; the handler does,
// on the merged row.
export function normalizeSendOnlyInput(input: unknown): SendOnlyInputResult {
  const errors: Record<string, string> = {};
  if (input === null || input === undefined || input === "") return { stored: null, errors };
  let v: unknown = input;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v) as unknown;
    } catch {
      errors["send_only_display"] = "Could not read this setting. Pick an option and save again.";
      return { stored: null, errors };
    }
  }
  if (!isRecord(v)) {
    errors["send_only_display"] = "Could not read this setting. Pick an option and save again.";
    return { stored: null, errors };
  }
  const display = v["display"];
  if (display === "card" || display === undefined || display === null) return { stored: null, errors };
  if (display !== "send_only") {
    errors["send_only_display"] = 'Pick "Show a card" or "Send the lead only, no card".';
    return { stored: null, errors };
  }
  const rawAccept = v["accept"];
  if (rawAccept !== undefined && rawAccept !== null && !isRecord(rawAccept)) {
    errors["send_only_accept_kind"] = 'Pick "Any OK reply" or "A field in the reply equals a value".';
    return { stored: null, errors };
  }
  const a: Record<string, unknown> = isRecord(rawAccept) ? rawAccept : { kind: "any_ok" };
  const kind = a["kind"] ?? "any_ok";
  if (kind === "any_ok") {
    return { stored: JSON.stringify({ display: "send_only", accept: { kind: "any_ok" } }), errors };
  }
  if (kind !== "field_equals") {
    errors["send_only_accept_kind"] = 'Pick "Any OK reply" or "A field in the reply equals a value".';
    return { stored: null, errors };
  }
  const field = typeof a["field"] === "string" ? unwrapResponseMacro(a["field"].trim()).trim() : "";
  const value = typeof a["value"] === "string" ? a["value"].trim() : "";
  if (field === "") errors["send_only_accept_field"] = "Enter the reply field to check, for example status.";
  else if (field.length > SEND_ONLY_FIELD_MAX) errors["send_only_accept_field"] = `Keep the field under ${SEND_ONLY_FIELD_MAX} characters.`;
  else if (/\s/.test(field)) errors["send_only_accept_field"] = "A reply field has no spaces. Use dots for nested fields, for example result.status.";
  if (value === "") errors["send_only_accept_value"] = "Enter the value that means accepted, for example accepted.";
  else if (value.length > SEND_ONLY_VALUE_MAX) errors["send_only_accept_value"] = `Keep the value under ${SEND_ONLY_VALUE_MAX} characters.`;
  if (Object.keys(errors).length > 0) return { stored: null, errors };
  return { stored: JSON.stringify({ display: "send_only", accept: { kind: "field_equals", field, value } }), errors };
}

// --- acceptance ---------------------------------------------------------------

export type SendOnlyOutcomeReason =
  | "accepted"
  | "timeout"
  | "error_reply" // non-2xx, network error, or no status at all
  | "field_missing" // the field rule's field is not in the reply (or the reply is not JSON)
  | "field_mismatch" // the field is there with another value
  | "rule_incomplete"; // a stored field rule without field or value

export interface SendOnlyOutcome {
  accepted: boolean;
  reason: SendOnlyOutcomeReason;
}

// The minimum a Provider call result must carry (FetchProviderResult and the
// admin Test tool both have these).
export interface SendOnlyReply {
  status: number | null;
  timed_out: boolean;
  // JSON-parsed body when the body was JSON; undefined otherwise.
  parsed?: unknown;
}

// Compare a reply value to the operator's value: trimmed, case-insensitive,
// numbers and booleans compared by their text ("true", "1").
function sameValue(raw: unknown, expected: string): boolean {
  let text: string;
  if (typeof raw === "string") text = raw;
  else if (typeof raw === "number" && Number.isFinite(raw)) text = String(raw);
  else if (typeof raw === "boolean") text = raw ? "true" : "false";
  else return false;
  return text.trim().toLowerCase() === expected.trim().toLowerCase();
}

// Was the lead accepted? A timeout or an error reply is never accepted. "Any OK
// reply" accepts any 2xx in time, even when the body is not JSON (some hooks
// answer plain "OK"). A field rule needs a JSON body with that field equal to
// the value.
export function evaluateSendOnlyAcceptance(rule: SendOnlyAcceptRule, reply: SendOnlyReply): SendOnlyOutcome {
  if (reply.timed_out) return { accepted: false, reason: "timeout" };
  const s = reply.status;
  if (typeof s !== "number" || s < 200 || s > 299) return { accepted: false, reason: "error_reply" };
  if (rule.kind === "any_ok") return { accepted: true, reason: "accepted" };
  if (rule.field === "" || rule.value === "") return { accepted: false, reason: "rule_incomplete" };
  if (reply.parsed === undefined) return { accepted: false, reason: "field_missing" };
  const raw = getAtPath(reply.parsed, rule.field);
  if (raw === undefined || raw === null) return { accepted: false, reason: "field_missing" };
  return sameValue(raw, rule.value) ? { accepted: true, reason: "accepted" } : { accepted: false, reason: "field_mismatch" };
}

// Plain-English reason for the admin (Test tool, Simulator).
export function sendOnlyReasonLabel(reason: SendOnlyOutcomeReason): string {
  switch (reason) {
    case "accepted":
      return "accepted";
    case "timeout":
      return "no reply in time";
    case "error_reply":
      return "the Provider answered with an error";
    case "field_missing":
      return "the reply field is not in the reply";
    case "field_mismatch":
      return "the reply field has a different value";
    case "rule_incomplete":
      return '"Accepted when" is missing its field or value';
  }
}

// Dedupe key for the one booking per funnel attempt and Offer (leadgen_conversion_log
// UNIQUE (click_id, dedupe_key), click_id = the funnel attempt id).
export function sendOnlyDedupeKey(offerPublicId: string): string {
  return `lg:send_only:${offerPublicId}`;
}
