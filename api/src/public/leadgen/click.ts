// GET /lg/lc — the LeadGen governed click resolver LOGIC (contract 01 §4.2,
// 07 §19 step 16, 04 §10.5, 07 §18.7, 04 §10.6, 08 §22.3).
//
// Stage-A ships the resolve→mint→side-effects FUNCTION the Stage-B route will
// call; the route + the actual 302 + loading the persisted auction/carrier
// context by the banner href params are Stage B. Keeping the logic in a
// function (I/O = cap increment + clicked write + event emit; the 302 is the
// route's) makes it unit-testable with mocked DB / Firehose.
//
// §19 step 16 flow, in order:
//   1. mint click_id (`lgl_` — ids.mintPublicId('link_click')).
//   2. resolve the destination URL: a usable provider click_url wins (07 §20 /
//      §10.5), else the Offer `banner_url_template` + the 32 canonical macros
//      (macros.resolveMacros — with the freshly-minted {click_id} injected) +
//      `{response:<dotted.path>}` from the winning carrier's parsed response
//      (parse.getAtPath). §10.5 REQUIRED-missing response macro at click time is
//      an ERROR → NO 302 to a broken URL (a required-missing carrier was dropped
//      at render, so a click that still resolves required-missing is treated as
//      unresolvable). OPTIONAL-missing → the configured safe_fallback.
//   3. SAFETY: NEVER 302 to a non-http(s) or macro-in-authority URL (any `{`
//      left in the resolved string, or a non-http scheme, fails the gate — the
//      same guard family macros.ts enforces at save time).
//   4. §10.6 cap: increment the Offer counter when cap_count_by='clicks' (the
//      click is the counted event; conversions-capped Offers count elsewhere).
//   5. §18.7 remove-clicked: write the suppression row to
//      `leadgen_session_clicked_offers` keyed on funnel_attempt_id
//      (removal_scope 'offer' ⇒ carrier_key '' — suppress the whole Offer;
//      'carrier' ⇒ this carrier_key).
//   6. §22.3 emit EXACTLY ONE click event (via leadgen-events → Firehose on
//      waitUntil), stamped with the minted click_id + the auction ids:
//      `carrier_click` when carrier-scoped (01§210 / 12-row-16), else
//      `offer_click`. NEVER both — the P12 CH DDL union-counts them, so a double
//      emit is 2× clicks + 2× revenue attribution.
//
// ALL side effects are FAIL-OPEN: a cap / clicked-row / Firehose failure never
// prevents the resolved 302 (or the safe no-redirect fallback).

import type { Env } from "../../env";
import type { WaitUntilContext } from "../../wait-until-context";
import { mintPublicId } from "../../leadgen/ids";
import { incrementCap, effectiveCountBy, type LeadgenCapOffer } from "../../leadgen/caps";
import {
  analyzeResponseMacros,
  resolveMacros,
  responseMacroFallback,
  type LeadgenResponseMacroFallbacks,
} from "../../leadgen/macros";
import { getAtPath, type LeadgenParsedCarrier } from "./auction/parse";
import {
  blankLeadgenEvent,
  emitLeadgenRecords,
  type LeadgenEvent,
} from "../../analytics/leadgen-events";

// Why the resolver could not produce a 302 to a real destination.
export type LeadgenClickUnresolvedReason =
  | "required_missing" // a required {response:*} macro had no value at click time (§10.5)
  | "non_http_destination" // resolved URL is not absolute http(s) / still holds a macro token
  | "no_click_target"; // no usable provider click_url AND no banner_url_template

export interface LeadgenClickInput {
  // --- identity carried on the governed banner href (Stage-B route parses it) ---
  offer_public_id: string;
  carrier_key: string;
  auction_instance_id: string;
  banner_render_id: string;
  slot: number | null;
  funnel_attempt_id: string;
  session_id?: string | null;
  // The internal auction id (leadgen_auctions.id) for the clicked row's
  // (nullable) auction_id column; null when the route did not resolve it.
  auction_id?: number | null;

  // --- URL resolution inputs (the Stage-B route loads these from persistence) ---
  // The winning carrier (its http(s) click_url wins; its name/bid stamp events).
  carrier?: LeadgenParsedCarrier | null;
  // The Offer's stored banner_url_template + its per-macro safe_fallback config.
  banner_url_template?: string | null;
  response_macro_fallbacks?: LeadgenResponseMacroFallbacks | null;
  // The winning carrier's parsed provider response `{response:*}` resolves over.
  response_context?: unknown;
  // Request-derived canonical macro values ({click_id} is injected by the
  // resolver from the freshly-minted id — do NOT pre-set it here).
  canonical_macros?: Readonly<Record<string, string>>;

  // --- §10.6 cap + §18.7 suppression inputs ---
  // The Offer cap projection (id + cap_* ). `id` is also the FK for the clicked
  // row. Absent ⇒ no cap increment / no clicked row.
  offer?: LeadgenCapOffer | null;
  removal_scope?: "offer" | "carrier";

  // --- server-derived context dims stamped onto both click events ---
  // Funnel/quote/site/utm/geo/etc. the route already knows. MUST be
  // server-derived + safe (§30.3): never raw answer PII.
  event_context?: Partial<LeadgenEvent>;

  // --- injectables (tests) ---
  now?: number;
  mintClickId?: () => string;
}

export interface LeadgenClickResult {
  click_id: string;
  // true ⇒ the route should 302 to destination_url; false ⇒ a safe
  // no-redirect fallback (never a broken URL) with the reason attached.
  redirect: boolean;
  destination_url: string | null;
  unresolved_reason: LeadgenClickUnresolvedReason | null;
  cap_incremented: boolean;
  clicked_recorded: boolean;
  // The single §22.3 click event built + handed to Firehose (returned so a
  // caller/test can assert it without intercepting the stream). Exactly one per
  // physical click: carrier_click when carrier-scoped, else offer_click.
  events: LeadgenEvent[];
}

// True for an absolute http(s) URL — the only shape accepted into a 302.
function isHttpUrl(value: unknown): value is string {
  return typeof value === "string" && /^https?:\/\//i.test(value.trim());
}

// A carrier/response value coerced to display text ("" for absent/objects).
function asText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

// The §19-step-16 SAFETY gate: absolute http(s) only, no residual macro token
// (any `{` left — including one in the host/authority position — is rejected),
// parseable with an http/https protocol. NEVER 302 to anything else.
function isSafeDestination(url: string): boolean {
  if (!isHttpUrl(url)) return false;
  if (url.includes("{")) return false; // unresolved macro token (authority or elsewhere)
  // §10.5 no C0/DEL control chars: a provider click_url wins RAW (not
  // save-validated), and the WHATWG URL parser SILENTLY STRIPS \r\n/\t — which
  // can change the effective destination (response-splitting / authority
  // rewrite). Reject here rather than trust `new URL()` to have preserved them.
  if (/[\u0000-\u001f\u007f]/.test(url)) return false;
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

type Candidate = { url: string } | { drop: LeadgenClickUnresolvedReason };

// Resolve the click destination candidate (07 §20 / §10.5). `macros` already
// carries the injected {click_id}. Mirrors banner.resolveClickUrl's precedence
// (provider click_url wins → banner_url_template + canonical + {response:*}),
// but with CLICK-TIME semantics: a required-missing response macro is an ERROR
// (drop → no 302), not a render-time carrier drop.
function resolveCandidate(
  input: LeadgenClickInput,
  macros: Readonly<Record<string, string>>,
): Candidate {
  // A usable provider click_url wins.
  if (isHttpUrl(input.carrier?.click_url)) {
    return { url: (input.carrier?.click_url ?? "").trim() };
  }

  const template =
    typeof input.banner_url_template === "string" ? input.banner_url_template.trim() : "";
  if (template === "") return { drop: "no_click_target" };

  const refs = analyzeResponseMacros(template);
  // Required-missing ⇒ ERROR (never resolve to empty / never 302 to broken).
  for (const ref of refs) {
    if (!ref.required) continue;
    const raw = getAtPath(input.response_context, ref.path);
    if (raw === undefined || raw === null || asText(raw) === "") {
      return { drop: "required_missing" };
    }
  }

  // Canonical macros first (resolveMacros escapes them + leaves {response:*}
  // intact), then substitute each response token with its encoded value.
  let url = resolveMacros(template, macros);
  for (const ref of refs) {
    const raw = getAtPath(input.response_context, ref.path);
    const present = raw !== undefined && raw !== null && asText(raw) !== "";
    const value = ref.required
      ? asText(raw)
      : present
        ? asText(raw)
        : responseMacroFallback(input.response_macro_fallbacks, ref.path);
    url = url.split(ref.token).join(encodeURIComponent(value));
  }
  return { url };
}

// Build one §22.3 click event stamped with the click identity + auction ids.
// `event_context` is merged first (server-derived safe dims), then the
// click-specific fields override. answer_value_raw is never set here (§30.3).
function buildClickEvent(
  eventType: "carrier_click" | "offer_click",
  now: number,
  input: LeadgenClickInput,
  clickId: string,
): LeadgenEvent {
  const e = blankLeadgenEvent(eventType, now);
  if (input.event_context !== undefined) Object.assign(e, input.event_context);
  // Re-assert the discriminator + click-owned fields AFTER the context merge.
  e.record_kind = "event";
  e.event_type = eventType;
  e.timestamp = now;
  e.received_at = now;
  e.click_id = clickId;
  e.offer_id = input.offer_public_id;
  e.carrier_key = input.carrier_key;
  e.auction_instance_id = input.auction_instance_id;
  e.banner_render_id = input.banner_render_id;
  e.funnel_attempt_id = input.funnel_attempt_id;
  e.carrier_position = input.slot;
  if (input.session_id !== undefined && input.session_id !== null) {
    e.session_id = input.session_id;
  }
  if (input.carrier !== undefined && input.carrier !== null) {
    e.carrier_name = asText(input.carrier.carrier_name);
    e.carrier_key_source = asText(input.carrier.carrier_key_source);
    e.bid_value = typeof input.carrier.bid === "number" ? input.carrier.bid : e.bid_value;
    e.bid_currency = asText(input.carrier.bid_currency);
  }
  if (e.event_id === "") e.event_id = mintPublicId("link_click", now); // per-event idempotency id
  return e;
}

// The /lg/lc resolve→mint→side-effects flow (§19 step 16). Never throws — every
// side effect is FAIL-OPEN so the caller can always 302 (or safely not).
export async function resolveLeadgenClick(
  env: Env,
  ctx: WaitUntilContext,
  input: LeadgenClickInput,
): Promise<LeadgenClickResult> {
  const now = input.now ?? Date.now();

  // 1. mint the click_id (`lgl_`).
  const clickId = input.mintClickId ? input.mintClickId() : mintPublicId("link_click", now);

  // 2. resolve the destination with {click_id} injected into the canonical set.
  const macros: Record<string, string> = { ...(input.canonical_macros ?? {}), click_id: clickId };
  const candidate = resolveCandidate(input, macros);

  let destination: string | null = null;
  let unresolvedReason: LeadgenClickUnresolvedReason | null = null;
  if ("drop" in candidate) {
    unresolvedReason = candidate.drop;
  } else if (isSafeDestination(candidate.url)) {
    destination = candidate.url.trim();
  } else {
    // 3. resolved but unsafe (non-http / residual macro / macro-in-authority).
    unresolvedReason = "non_http_destination";
  }

  // 4. §10.6 cap increment — clicks-capped Offers only; the click is the counted
  //    event. FAIL-OPEN. (A conversions-capped Offer counts on conversion, P13.)
  let capIncremented = false;
  if (
    input.offer !== undefined &&
    input.offer !== null &&
    input.offer.cap_enabled === 1 &&
    effectiveCountBy(input.offer) === "clicks"
  ) {
    try {
      await incrementCap(env.DB, input.offer, new Date(now));
      capIncremented = true;
    } catch {
      // cap counting must never break the click
    }
  }

  // 5. §18.7 remove-clicked suppression row (keyed on funnel_attempt_id).
  //    scope 'offer' ⇒ carrier_key '' (whole Offer); 'carrier' ⇒ this carrier.
  //    Recording is unconditional when we have the keys; the engine gates
  //    whether it is CONSULTED on the auction's remove_clicked_offers flag.
  //    FAIL-OPEN. ON CONFLICT DO NOTHING (PK funnel_attempt_id, offer_id, carrier_key).
  let clickedRecorded = false;
  const offerId = input.offer?.id;
  if (
    input.funnel_attempt_id !== "" &&
    typeof offerId === "number"
  ) {
    const scope: "offer" | "carrier" = input.removal_scope === "carrier" ? "carrier" : "offer";
    const carrierKeyForRow = scope === "carrier" ? input.carrier_key : "";
    try {
      await env.DB.prepare(
        "INSERT INTO leadgen_session_clicked_offers (funnel_attempt_id, offer_id, carrier_key, session_id, auction_id, removal_scope, clicked_at) " +
          "VALUES (?, ?, ?, ?, ?, ?, unixepoch()) " +
          "ON CONFLICT(funnel_attempt_id, offer_id, carrier_key) DO NOTHING",
      )
        .bind(
          input.funnel_attempt_id,
          offerId,
          carrierKeyForRow,
          input.session_id ?? null,
          input.auction_id ?? null,
          scope,
        )
        .run();
      clickedRecorded = true;
    } catch {
      // suppression bookkeeping must never break the click
    }
  }

  // 6. §22.3 emit EXACTLY ONE click event (FAIL-OPEN Firehose, on waitUntil).
  //    Carrier-scoped click (a specific carrier — carrier_key present) ⇒
  //    `carrier_click` (01§210 / 12-row-16); offer-level click (no carrier) ⇒
  //    `offer_click`. NEVER both: the P12 CH DDL counts offer/quote clicks as
  //    sumIf(event_type IN ('offer_click','carrier_click')) and joins revenue on
  //    the same union, so a double emit is 2× clicks + 2× revenue attribution.
  const clickType: "carrier_click" | "offer_click" =
    input.carrier_key !== "" ? "carrier_click" : "offer_click";
  const events = [buildClickEvent(clickType, now, input, clickId)];
  emitLeadgenRecords(env, ctx, [...events]);

  return {
    click_id: clickId,
    redirect: destination !== null,
    destination_url: destination,
    unresolved_reason: unresolvedReason,
    cap_incremented: capIncremented,
    clicked_recorded: clickedRecorded,
    events,
  };
}
