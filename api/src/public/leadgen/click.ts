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
//
// OWNER 2026-10-08 (R1 "Every click"): the click event carries the money. The
// Offer's offer_type is read from leadgen_offers; a CPC click books the clicked
// card's bid in USD as `revenue` (booking_trigger "click", bid_currency "USD")
// on EVERY click — no per-visitor dedupe. The USD bid is the one the auction
// stored for that card (leadgen_auction_result_log.carriers_shown_json .bid),
// else the carrier's own bid / the Offer's static_bid_value converted the same
// way (fx.normalizeToUsd). CPL/CPA/CPI clicks book nothing (revenue null,
// booking_trigger ""). The event also carries Meta's `fbp` (the click
// request's _fbp cookie, else the one the auction persisted) and the
// server-resolved quote / funnel / template names. Every lookup is FAIL-OPEN
// and runs on waitUntil (after the 302), before the event is emitted.
//
// Fix round 1 (review B1 + M4): the same CPC click is also booked into the CMS
// revenue ledger (leadgen_revenue_raw — revenue-ingest.ts
// recordInSiteClickRevenue: source 'in_site', booking_trigger 'click',
// conversions 0, the event's USD revenue, idempotent per click_id), on the same
// waitUntil task, fail-open. And a replayed link is bounded: at most
// CLICK_REPLAY_CAP clicks per (funnel attempt, offer) per 24 h book / send to
// Facebook (revenue-ingest.ts claimClickReplaySlot); a click over the cap still
// 302s and still emits its event, with revenue 0 and booking_trigger 'capped'
// (NOT null — the dashboard falls back to the bid when revenue is null), and
// writes no ledger row. The decision is handed to the route
// (`replay_capped`) so the Facebook send obeys the same cap.
//
// Fix round 2 (review N1 / N3 / N6) — a click books (Athena revenue + ledger
// row) and sends to Facebook ONLY when it is real and clean:
//   * REAL: the auction it names exists, belongs to the link's funnel attempt
//     and showed this Offer — clickout-meta.ts checkClickoutMetaAuction, the
//     SAME function the Facebook send uses (one check, not two). A forged /
//     unknown click books revenue 0 (not null) with booking_trigger
//     'unverified', no ledger row, no Facebook send;
//   * CLEAN: /lg/lc stamps is_bot / is_internal / is_preview /
//     traffic_quality_flag exactly as /lg/px does (computeTrafficQuality, in
//     the route); a non-clean click books revenue 0 with booking_trigger
//     'not_clean', no ledger row, no Facebook send;
//   then the replay cap. The 302 happens in every case.
//   * bid_currency is "USD" only when the bid really was converted to USD; an
//     FX miss keeps the bid in its own currency and leaves revenue null.

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
import { resolveLeadgenFunnelNames, type LeadgenFunnelNames } from "../../analytics/leadgen-enrich";
import { normalizeToUsd } from "../../leadgen/fx";
import { META_FBP_RE, readFbpCookie } from "../../leadgen/meta-hash";
import { claimClickReplaySlot, recordInSiteClickRevenue } from "../../leadgen/revenue-ingest";
import {
  checkClickoutMetaAuction,
  loadClickoutMetaAuction,
  type ClickoutMetaShownCard,
} from "../../leadgen/clickout-meta";

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

  // --- OWNER 2026-10-08: Meta browser id ---
  // The click request's Cookie header: Meta's _fbp is read from it (shape-
  // checked). Absent / no valid _fbp ⇒ the auction snapshot's `fbp`
  // (canonical_macros.fbp, persisted at /lg/auction).
  request_cookie_header?: string | null;

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
  // physical click: carrier_click when carrier-scoped, else offer_click. Its
  // D1 facts (offer_type / USD bid / revenue / names) are stamped by the
  // waitUntil task — settle the context before asserting them.
  events: LeadgenEvent[];
  // Fix round 1 (review M4): resolves true when this click is over the replay
  // cap (the route's Facebook send then sends nothing). Never rejects.
  replay_capped: Promise<boolean>;
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

// OWNER 2026-10-08 — what the click event needs from D1: the Offer's type, the
// clicked card's USD bid, and the funnel names. Resolved in parallel with the
// cap / suppression writes; every miss degrades to "unknown" (never throws).
interface LeadgenClickFacts {
  offer_type: string; // "" when the Offer row could not be read
  usd_bid: number | null; // null when no USD bid could be determined
  // N6: the bid that could NOT be converted to USD (an FX miss), in its own
  // currency — stamped as bid_value / bid_currency instead; null otherwise.
  native_bid: { value: number; currency: string } | null;
  names: LeadgenFunnelNames | null;
  // The Offer's Facebook click-event switch (0058) is on.
  clickout_on: boolean;
  // N1: the auction behind the click is real (checkClickoutMetaAuction).
  verified: boolean;
  // The funnel attempt the AUCTION behind the click belongs to ("" when the
  // auction has none) — the replay cap keys on it, not on the link's faid.
  auction_attempt_id: string;
}

const OFFER_TYPES: ReadonlySet<string> = new Set(["cpc", "cpl", "cpa", "cpi"]);

function finiteNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

// The USD bid the auction stored for the clicked card (the auction's shown
// cards, read once by clickout-meta.ts loadClickoutMetaAuction).
function shownUsdBid(cards: readonly ClickoutMetaShownCard[], offerPublicId: string, carrierKey: string): number | null {
  for (const c of cards) {
    if (c.offer_id !== offerPublicId) continue;
    if (carrierKey !== "" && c.carrier_key !== carrierKey) continue;
    if (c.bid !== null) return c.bid;
  }
  return null;
}

async function loadClickFacts(env: Env, input: LeadgenClickInput, now: number): Promise<LeadgenClickFacts> {
  const db = env.DB;
  // `SELECT *` so a database a column behind still reads (absent columns
  // default); every column is read defensively below.
  const offerRead = (async () => {
    if (input.offer_public_id === "") return null;
    try {
      return await db
        .prepare("SELECT * FROM leadgen_offers WHERE public_id = ? LIMIT 1")
        .bind(input.offer_public_id)
        .first<{
          offer_type?: string | null;
          static_bid_value?: number | null;
          static_bid_currency?: string | null;
          clickout_meta_conversion?: number | null;
        }>();
    } catch {
      return null;
    }
  })();
  // N1: the auction behind the click, read by the SAME loader the Facebook
  // send uses (null for an unknown / unreadable auction — never throws).
  const auctionRead = loadClickoutMetaAuction(db, input.auction_instance_id).catch(() => null);
  const ec = input.event_context ?? {};
  const namesRead = resolveLeadgenFunnelNames(
    db,
    { quote_id: ec.quote_id ?? "", funnel_id: ec.funnel_id ?? "", funnel_variant_id: ec.funnel_variant_id ?? "" },
    now,
  ).catch(() => null);

  const [offer, auction, names] = await Promise.all([offerRead, auctionRead, namesRead]);
  const offerType = offer !== null && typeof offer.offer_type === "string" && OFFER_TYPES.has(offer.offer_type) ? offer.offer_type : "";

  let usdBid: number | null = auction !== null ? shownUsdBid(auction.shown_cards ?? [], input.offer_public_id, input.carrier_key) : null;
  let nativeBid: { value: number; currency: string } | null = null;
  // Fallbacks, converted exactly like the auction converts: the carrier's own
  // bid in its currency, else the Offer's static bid. An FX miss (N6) keeps
  // the bid in its own currency (native_bid) and leaves the USD bid unknown.
  try {
    const fallbacks: Array<[number | null, string | null]> = [
      [finiteNumber(input.carrier?.bid), input.carrier?.bid_currency ?? null],
      [finiteNumber(offer?.static_bid_value), offer?.static_bid_currency ?? null],
    ];
    for (const [bid, currency] of fallbacks) {
      if (usdBid !== null || bid === null) continue;
      const fx = await normalizeToUsd(db, bid, currency);
      usdBid = fx.usd;
      if (fx.usd === null && nativeBid === null) nativeBid = { value: bid, currency: fx.currency };
    }
  } catch {
    // an FX error leaves the bid unknown (never a fabricated value)
  }
  return {
    offer_type: offerType,
    usd_bid: usdBid,
    native_bid: usdBid === null ? nativeBid : null,
    names,
    clickout_on: offer !== null && offer.clickout_meta_conversion === 1,
    verified: checkClickoutMetaAuction(auction, input.offer_public_id, input.funnel_attempt_id) === null,
    auction_attempt_id: auction?.funnel_attempt_id ?? "",
  };
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
  // Meta browser id: the click request's _fbp, else the auction's persisted one.
  const liveFbp = readFbpCookie(input.request_cookie_header ?? null);
  const snapshotFbp = input.canonical_macros?.["fbp"] ?? "";
  e.fbp = liveFbp !== "" ? liveFbp : META_FBP_RE.test(snapshotFbp) ? snapshotFbp : "";
  if (e.event_id === "") e.event_id = mintPublicId("link_click", now); // per-event idempotency id
  return e;
}

// OWNER 2026-10-08 — stamp the D1 facts onto the built click event (IN
// PLACE): the Offer's type, the card's USD bid, the funnel names, and the R1
// booking — a CPC click books its USD bid on EVERY click; cpl/cpa/cpi book
// nothing at click time. `facts` null (every read failed) ⇒ only an offer_type
// already on the event decides the booking.
function applyClickFacts(e: LeadgenEvent, facts: LeadgenClickFacts | null): void {
  if (facts !== null) {
    if (facts.offer_type !== "") e.offer_type = facts.offer_type;
    // N6: "USD" only for a bid really converted to USD; an FX miss keeps the
    // bid in its own currency.
    if (facts.usd_bid !== null) {
      e.bid_value = facts.usd_bid;
      e.bid_currency = "USD";
    } else if (facts.native_bid !== null) {
      e.bid_value = facts.native_bid.value;
      e.bid_currency = facts.native_bid.currency;
    }
    const n = facts.names;
    if (n !== null) {
      if (e.quote_id === "" && n.quote_id !== "") e.quote_id = n.quote_id;
      e.quote_name = n.quote_name;
      e.funnel_name = n.funnel_name;
      e.template_id = n.template_id;
      e.template_name = n.template_name;
    }
  }
  // R1 "Every click": a CPC click books its bid (USD) — no dedupe; every
  // other Offer type books nothing at click time. No USD bid (an FX miss) ⇒
  // revenue null.
  if (e.offer_type === "cpc") {
    e.revenue = facts?.usd_bid ?? null;
    e.booking_trigger = "click";
  } else if (OFFER_TYPES.has(e.offer_type)) {
    e.revenue = null;
    e.booking_trigger = "";
  }
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
  //    OWNER 2026-10-08: the event's D1 facts (offer type, USD bid → revenue,
  //    names) are read on waitUntil — the visitor's 302 never waits on them —
  //    then the event is emitted from the same background task. A failed read
  //    still emits the event (FAIL-OPEN). `events` is the SAME object the task
  //    stamps, so a caller that settles the context sees the stamped event.
  const events = [buildClickEvent(clickType, now, input, clickId)];
  let settleCapped: (capped: boolean) => void = () => undefined;
  const replayCapped = new Promise<boolean>((resolve) => {
    settleCapped = resolve;
  });
  const emitTask = (async () => {
    const facts = await loadClickFacts(env, input, now).catch(() => null);
    for (const e of events) applyClickFacts(e, facts);
    // A click that would book (CPC) or send to Facebook (switch on) must be
    // real (N1: the shared auction check), then clean (N3: the route's
    // traffic-quality stamp), then within the replay cap (M4 — keyed on the
    // attempt the AUCTION belongs to; the link's own faid only when the
    // auction was persisted without one). The first that fails names the
    // booking_trigger and the click books revenue 0 (NOT null — the dashboard
    // falls back to the bid when revenue is null), no ledger row, no Facebook
    // send (clickout-meta.ts runs the same auction check and the same
    // traffic-quality rule; `replay_capped` carries the cap decision). Only a
    // real, clean click spends a replay slot.
    let blocked: "unverified" | "not_clean" | "capped" | null = null;
    const e0 = events[0];
    try {
      if (facts !== null && e0 !== undefined && (e0.offer_type === "cpc" || facts.clickout_on)) {
        if (!facts.verified) blocked = "unverified";
        else if (e0.traffic_quality_flag !== "clean") blocked = "not_clean";
        else {
          const attempt = facts.auction_attempt_id !== "" ? facts.auction_attempt_id : input.funnel_attempt_id;
          if (!(await claimClickReplaySlot(env.CACHE, attempt, input.offer_public_id, now))) blocked = "capped";
        }
      }
    } catch {
      // claimClickReplaySlot never throws (KV errors fail open inside it)
    }
    settleCapped(blocked === "capped");
    if (blocked !== null) {
      for (const e of events) {
        e.revenue = 0;
        e.booking_trigger = blocked;
      }
    } else if (e0 !== undefined && e0.offer_type === "cpc") {
      // Fix round 1 (review B1): the CMS revenue ledger books the same value.
      try {
        await recordInSiteClickRevenue(env.DB, {
          offer_public_id: input.offer_public_id,
          offer_type: e0.offer_type,
          click_id: clickId,
          revenue: e0.revenue,
          dt: new Date(now).toISOString().slice(0, 10),
          clean: e0.traffic_quality_flag === "clean",
        });
      } catch {
        // the ledger write never breaks the click or its event
      }
    }
    const sends: Promise<unknown>[] = [];
    emitLeadgenRecords(env, { waitUntil: (p) => void sends.push(p) }, [...events]);
    await Promise.all(sends.map((p) => Promise.resolve(p).catch(() => undefined)));
  })().catch(() => {
    /* tracking never breaks the click */
  }).finally(() => settleCapped(false));
  try {
    ctx.waitUntil(emitTask);
  } catch {
    void emitTask;
  }

  return {
    click_id: clickId,
    redirect: destination !== null,
    destination_url: destination,
    unresolved_reason: unresolvedReason,
    cap_incremented: capIncremented,
    clicked_recorded: clickedRecorded,
    events,
    replay_capped: replayCapped,
  };
}
