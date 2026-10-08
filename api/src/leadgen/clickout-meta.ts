// LeadGen — the Meta (Facebook) event fired when a visitor CLICKS an Offer's
// banner (0058, widened by 0064).
//
// WHY THIS EXISTS: the Meta campaign that bought the visit has nothing to
// optimise on unless we tell it what a click was worth. Owner, 2026-10-08: "we
// want to fire the browser side event to facebook, the system should support it
// in the offer level, including the generated click revenue value ... and also
// server side event". Rulings: R1 "Every click" — every click is its own event;
// R2 — Purchase (configurable) on click, value = the click's bid x a multiplier
// (default 1); browser + server events for the click share ONE event id.
//
// 0064 widened 0058 (which was "static Offers only, Meta-ad visitors only, once
// per funnel visit per Offer") to EVERY Offer with the switch on, EVERY visitor
// (the reference funnel sends for every click) and EVERY click. The browser
// half lives in the funnel shell (serve.ts metaPixelShellScript): it mints the
// event id, appends it to the /lg/lc link as `eid`, and fires the same event
// through the pixel; this module sends the server half with that same id so
// Meta deduplicates the pair.
//
// WHAT IT IS NOT — each of these is a deliberate boundary, not an omission:
//   * not §26 (s2s-dispatch.ts). §26 fires on a MATCHED conversion booked by
//     /lg/pb or /lg/px and is untouched here — its platform row's URL template
//     and `enabled` flag are not read.
//   * not revenue. Nothing here writes leadgen_revenue_raw,
//     leadgen_conversion_log or a cap counter.
//   * not Admin → Conversions. That product has its own Meta connection; this
//     is configured on the LeadGen Offer.
//   * not a second credential store. The Meta dataset id is an Offer setting;
//     the access token is the secret LeadGen's `facebook` media platform row
//     already names (auth_secret_ref, outbound-allowlisted).
//
// WHO THE VISITOR IS comes ONLY from the auction that showed this Offer. /lg/lc
// is an unguarded public GET (a click must always 302), so anything on its
// query string is attacker-controlled: an fbclid pasted onto a hand-made
// /lg/lc URL would otherwise let a script mint unlimited Meta events. The fbc,
// fbclid, session, the hashed contact fields (meta_user_data) and the clicked
// card's bid come from the auction's persisted rows, and the send happens only
// when that auction (a) exists, (b) belongs to the funnel attempt the click
// names, and (c) actually showed this Offer. /lg/auction is the guarded
// endpoint (bot + rate limit + signed attempt binding). The only request
// values used are the visitor's own: IP, user agent, the `_fbp` cookie, and the
// `eid` the browser minted (shape-checked; it only names the event).
//
// TRANSPORT matches the two known-good Meta senders in this estate (the
// Conversions engine's destination-meta adapter and the reference funnel's
// CAPI handler): POST JSON to https://graph.facebook.com/v25.0/<dataset>/events
// with the token as the access_token query parameter. The URL therefore
// carries a secret and is NEVER logged; only the dataset id is.
//
// DEDUPE: one Meta event per event id (R1: every click is its own event). The
// KV seen-set uses the LeadGen S2S prefix `lg_s2s:` and only stops a replay of
// the SAME click (the same `eid`); Meta's own event_id dedupe pairs the server
// event with the browser one. A send Meta refuses (a bad token, say) gives the
// slot back.
//
// Never throws. Runs on waitUntil after the 302 has been returned, so a Meta
// outage cannot slow or break a visitor's click. The outcome is logged AND
// stored on the Offer, so whoever runs a test click can read what happened on
// the Offer page instead of in Workers Logs.

import type { Env } from "../env";
import { resolveAllowedOutboundSecretReference } from "../env";
import { deriveFbc } from "./s2s-dispatch";
import { safeErrorName } from "../safety/safe-error";
// Meta's browser id cookie `_fbp` shape — the one definition (meta-hash.ts).
import { META_FBP_RE } from "./meta-hash";

// Meta standard events that make sense for a click. "Purchase" is the default
// (owner R2, 2026-10-08: the ad sets optimise Purchase value, and the click's
// bid is the value). 0058 rows that are switched on with no saved name were
// pinned to "Lead" by 0064, so no existing Offer changes event.
export const CLICKOUT_META_EVENT_NAMES = [
  "Lead",
  "CompleteRegistration",
  "SubmitApplication",
  "Contact",
  "Schedule",
  "Subscribe",
  "Purchase",
] as const;
export type ClickoutMetaEventName = (typeof CLICKOUT_META_EVENT_NAMES)[number];
export const CLICKOUT_META_DEFAULT_EVENT: ClickoutMetaEventName = "Purchase";

// A Meta dataset (pixel) id is all digits.
export const CLICKOUT_META_DATASET_RE = /^[0-9]{5,20}$/;
// Meta Events Manager test codes look like TEST12345; bounded and
// control-char-free so nothing odd reaches the request body.
export const CLICKOUT_META_TEST_CODE_RE = /^[A-Za-z0-9_-]{1,64}$/;
// The Graph API version both known-good Meta senders in this estate use.
export const CLICKOUT_META_GRAPH_VERSION = "v25.0";
// The click's event id as the browser mints it (serve.ts metaPixelShellScript:
// 'lgc_' + random letters/digits) and appends to the /lg/lc link as `eid`.
// Anything else on that parameter is ignored and the server names the event
// itself ('lgc_' + click id).
export const CLICKOUT_META_EID_RE = /^lgc_[A-Za-z0-9]{8,40}$/;
// The value multiplier an operator may set (0064). Bounded so a typo cannot
// report a click worth a thousand times its bid.
export const CLICKOUT_META_MULTIPLIER_MAX = 100;
// The hashed contact fields the auction snapshot may carry (meta_user_data):
// Meta's customer-information keys, each already a lowercase hex SHA-256.
export const CLICKOUT_META_USER_DATA_KEYS = ["em", "ph", "fn", "ln", "db", "ct", "st", "zp", "country"] as const;

const META_PLATFORM = "facebook";
const CLICKOUT_SEEN_TTL_SECONDS = 24 * 3600; // the §26 S2S window
// Meta's fbc cookie shape (fb.<subdomain index>.<creation ms>.<fbclid>).
const FBC_RE = /^fb\.[12]\.[0-9]{10,16}\.[A-Za-z0-9._~-]{1,512}$/;
const SHA256_HEX_RE = /^[0-9a-f]{64}$/;
const IP_RE = /^[0-9A-Fa-f:.]{2,45}$/;
const CONTROL_RE = /[\u0000-\u001f\u007f]/;

// The Offer columns this needs (leadgen_offers + 0058 + 0064).
// `calls_provider_api` is no longer read (0064: every Offer may send); it stays
// optional so callers that still select it type-check.
export interface ClickoutMetaOffer {
  public_id: string;
  calls_provider_api?: number;
  offer_type?: string | null;
  clickout_meta_conversion: number;
  clickout_meta_dataset_id: string | null;
  clickout_meta_event_name: string | null;
  clickout_meta_value: number | null;
  clickout_meta_value_multiplier?: number | null;
  clickout_meta_test_event_code: string | null;
  static_bid_currency?: string | null;
}

// What the /lg/lc request itself contributes. Deliberately NO Meta
// identifiers: those are read from the auction (see the header).
export interface ClickoutMetaClick {
  click_id: string;
  auction_instance_id: string;
  funnel_attempt_id: string;
  ip: string;
  ua: string;
  // The funnel page the visitor clicked from (the /lg/lc request's Referer).
  page_url: string;
  // Fallback event_source_url when the Referer is absent: the tenant origin.
  host: string;
  // The event id the browser minted for this click (the `eid` the shell
  // appends to the link). Shape-checked; anything else is ignored.
  eid?: string;
  // The visitor's own `_fbp` cookie as sent on this request (shape-checked).
  fbp?: string;
  // Which card was clicked (the link's ck/slot) — selects the bid the auction
  // recorded for it. Never a price: the price is read from the auction.
  carrier_key?: string;
  slot?: number | null;
}

// One card the auction showed (leadgen_auction_result_log.carriers_shown_json).
export interface ClickoutMetaShownCard {
  offer_id: string;
  carrier_key: string;
  bid: number | null;
  slot: number | null;
}

// The auction that showed the banner, as persisted by the engine.
export interface ClickoutMetaAuction {
  funnel_attempt_id: string;
  shown_offer_ids: ReadonlySet<string>;
  // Every card shown, with the USD bid the engine recorded for it.
  shown_cards?: readonly ClickoutMetaShownCard[];
  fbc: string;
  fbclid: string;
  // The visitor's `_fbp` as the auction request carried it (snapshot `fbp`) —
  // the fallback when the click request itself has no `_fbp` cookie.
  fbp?: string;
  session_id: string;
  // The snapshot's `meta_user_data`: Meta key → lowercase hex SHA-256, only
  // well-formed entries kept (absent/malformed → {}).
  meta_user_data?: Readonly<Record<string, string>>;
}

export type ClickoutMetaOutcome =
  | { status: "fired"; dataset_id: string; event_name: string; event_id: string; http_status: number; events_received: number | null; fbtrace_id: string | null; test: boolean }
  | { status: "skipped"; reason: ClickoutMetaSkipReason }
  | { status: "deduped"; event_id: string }
  | { status: "failed"; reason: string; http_status?: number; meta_error?: MetaErrorFacts };

// What Meta says when it refuses an event — its numeric code, type and trace
// id only (e.g. 190/OAuthException = bad token). Never its message text, which
// is free-form and can quote back what was sent.
export interface MetaErrorFacts {
  code: number | null;
  subcode: number | null;
  type: string | null;
  fbtrace_id: string | null;
}

// 0064 dropped "offer_not_static" (every Offer may send) and
// "not_meta_traffic" (the reference funnel sends for every click).
export type ClickoutMetaSkipReason =
  | "offer_setting_off"
  | "no_auction" // the click names no auction we ran
  | "attempt_mismatch" // the auction belongs to another funnel attempt
  | "offer_not_shown" // that auction never showed this Offer
  | ClickoutMetaDestinationProblem;

export type ClickoutMetaDestinationProblem =
  | "meta_dataset_missing" // the Offer has no (valid) dataset id
  | "meta_platform_missing" // no `facebook` row, so no token reference
  | "meta_token_missing"; // its auth_secret_ref is unset, not allowlisted, or unbound

export type ClickoutMetaDestination =
  | { ok: true; dataset_id: string; endpoint: string; token: string }
  | { ok: false; problem: ClickoutMetaDestinationProblem };

// Whether the server holds a usable Meta token — shared by the sender and by
// the Offer editor's status line. The token VALUE never leaves this module
// except into the request URL.
export async function resolveClickoutMetaToken(
  env: Env,
  db: D1Database,
): Promise<{ ok: true; token: string } | { ok: false; problem: "meta_platform_missing" | "meta_token_missing" }> {
  let row: { auth_secret_ref: string | null } | null = null;
  try {
    row = await db
      .prepare("SELECT auth_secret_ref FROM leadgen_media_platforms WHERE lower(platform) = ? LIMIT 1")
      .bind(META_PLATFORM)
      .first<{ auth_secret_ref: string | null }>();
  } catch {
    row = null;
  }
  if (row === null) return { ok: false, problem: "meta_platform_missing" };
  const ref = (row.auth_secret_ref ?? "").trim();
  if (ref === "") return { ok: false, problem: "meta_token_missing" };
  const resolved = resolveAllowedOutboundSecretReference(env, ref);
  if (!resolved.ok) return { ok: false, problem: "meta_token_missing" };
  const token = resolved.value.trim();
  if (token === "" || /[\u0000- \u007f]/.test(token)) return { ok: false, problem: "meta_token_missing" };
  return { ok: true, token };
}

export async function resolveClickoutMetaDestination(
  env: Env,
  db: D1Database,
  offer: Pick<ClickoutMetaOffer, "clickout_meta_dataset_id">,
): Promise<ClickoutMetaDestination> {
  const dataset = (offer.clickout_meta_dataset_id ?? "").trim();
  if (!CLICKOUT_META_DATASET_RE.test(dataset)) return { ok: false, problem: "meta_dataset_missing" };
  const token = await resolveClickoutMetaToken(env, db);
  if (!token.ok) return { ok: false, problem: token.problem };
  return {
    ok: true,
    dataset_id: dataset,
    endpoint: `https://graph.facebook.com/${CLICKOUT_META_GRAPH_VERSION}/${dataset}/events`,
    token: token.token,
  };
}

// The auction behind a click, or null. Dedicated JSON parses — a corrupt blob
// reads as "nothing shown / no identifiers", which sends nothing.
export async function loadClickoutMetaAuction(db: D1Database, auctionInstanceId: string): Promise<ClickoutMetaAuction | null> {
  if (auctionInstanceId.trim() === "") return null;
  let row: { funnel_attempt_id: string | null; session_id: string | null; carriers_shown_json: string | null; macro_context_json: string | null } | null = null;
  try {
    row = await db
      .prepare(
        "SELECT funnel_attempt_id, session_id, carriers_shown_json, macro_context_json FROM leadgen_auction_result_log WHERE auction_instance_id = ? LIMIT 1",
      )
      .bind(auctionInstanceId)
      .first();
  } catch {
    row = null;
  }
  if (row === null) return null;
  const shown = new Set<string>();
  const cards: ClickoutMetaShownCard[] = [];
  try {
    const carriers = JSON.parse(row.carriers_shown_json ?? "[]") as unknown;
    if (Array.isArray(carriers)) {
      for (const c of carriers) {
        if (c === null || typeof c !== "object") continue;
        const entry = c as { offer_id?: unknown; carrier_key?: unknown; bid?: unknown; slot?: unknown };
        const id = entry.offer_id;
        if (typeof id !== "string" || id === "") continue;
        shown.add(id);
        cards.push({
          offer_id: id,
          carrier_key: typeof entry.carrier_key === "string" ? entry.carrier_key : "",
          bid: typeof entry.bid === "number" && Number.isFinite(entry.bid) ? entry.bid : null,
          slot: typeof entry.slot === "number" && Number.isInteger(entry.slot) ? entry.slot : null,
        });
      }
    }
  } catch {
    /* nothing shown */
  }
  let snapshot: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(row.macro_context_json ?? "{}") as unknown;
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) snapshot = parsed as Record<string, unknown>;
  } catch {
    snapshot = {};
  }
  const text = (v: unknown): string => (typeof v === "string" ? v : "");
  return {
    funnel_attempt_id: row.funnel_attempt_id ?? "",
    shown_offer_ids: shown,
    shown_cards: cards,
    fbc: text(snapshot["fbc"]),
    fbclid: text(snapshot["fbclid"]),
    fbp: text(snapshot["fbp"]),
    session_id: row.session_id ?? text(snapshot["session_id"]),
    meta_user_data: readMetaUserData(snapshot["meta_user_data"]),
  };
}

// The snapshot's hashed contact fields, read defensively: only Meta's keys,
// only lowercase hex SHA-256 values (the other side hashes before it stores).
// A string (a JSON blob persisted as text) is parsed in its own try/catch.
export function readMetaUserData(raw: unknown): Record<string, string> {
  let value: unknown = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      return {};
    }
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const key of CLICKOUT_META_USER_DATA_KEYS) {
    const v = (value as Record<string, unknown>)[key];
    if (typeof v === "string" && SHA256_HEX_RE.test(v)) out[key] = v;
  }
  return out;
}

// The multiplier an Offer applies to the click's bid (0064). NULL / absent /
// non-finite / out of range ⇒ 1 (the bid itself).
export function clickoutMetaMultiplier(offer: Pick<ClickoutMetaOffer, "clickout_meta_value_multiplier">): number {
  const m = offer.clickout_meta_value_multiplier;
  return typeof m === "number" && Number.isFinite(m) && m > 0 && m <= CLICKOUT_META_MULTIPLIER_MAX ? m : 1;
}

// THE value rule (owner R2), shared by the browser card (banner.ts) and the
// server event so both halves of one click report the same number:
//   * a fixed clickout_meta_value on the Offer wins;
//   * otherwise a CPC Offer reports the clicked card's USD bid x multiplier;
//   * no bid (or not a CPC Offer) ⇒ null — no value is sent at all.
// Always USD: the engine records shown bids FX-normalized to USD.
export function clickoutMetaValue(
  offer: Pick<ClickoutMetaOffer, "clickout_meta_value" | "clickout_meta_value_multiplier" | "offer_type">,
  usdBid: number | null | undefined,
): number | null {
  const fixed = offer.clickout_meta_value;
  if (typeof fixed === "number" && Number.isFinite(fixed) && fixed > 0) return fixed;
  if ((offer.offer_type ?? "").trim().toLowerCase() !== "cpc") return null;
  if (typeof usdBid !== "number" || !Number.isFinite(usdBid) || usdBid <= 0) return null;
  const value = Math.round(usdBid * clickoutMetaMultiplier(offer) * 100) / 100;
  return value > 0 ? value : null;
}

// What the card link carries for the browser half (banner.ts renders these as
// data-lg-px* attributes), or null when the Offer sends nothing.
export interface ClickoutMetaCardPixel {
  dataset_id: string;
  event_name: ClickoutMetaEventName;
  value: number | null;
  currency: "USD";
}

export function clickoutMetaCardPixel(
  offer: Partial<Pick<ClickoutMetaOffer, "clickout_meta_conversion" | "clickout_meta_dataset_id" | "clickout_meta_event_name" | "clickout_meta_value" | "clickout_meta_value_multiplier" | "offer_type">> | null | undefined,
  usdBid: number | null | undefined,
): ClickoutMetaCardPixel | null {
  if (offer === null || offer === undefined) return null;
  if ((offer.clickout_meta_conversion ?? 0) !== 1) return null;
  const dataset = (offer.clickout_meta_dataset_id ?? "").trim();
  if (!CLICKOUT_META_DATASET_RE.test(dataset)) return null;
  return {
    dataset_id: dataset,
    event_name: clickoutMetaEventName({ clickout_meta_event_name: offer.clickout_meta_event_name ?? null }),
    value: clickoutMetaValue(
      {
        clickout_meta_value: offer.clickout_meta_value ?? null,
        clickout_meta_value_multiplier: offer.clickout_meta_value_multiplier ?? null,
        offer_type: offer.offer_type ?? null,
      },
      usdBid,
    ),
    currency: "USD",
  };
}

// The USD bid the auction recorded for the clicked card: the shown entry for
// this Offer with the link's carrier key (the slot breaks a tie). No match ⇒
// null — the value is never taken from the request.
export function clickoutMetaClickedBid(
  auction: Pick<ClickoutMetaAuction, "shown_cards">,
  offerPublicId: string,
  click: Pick<ClickoutMetaClick, "carrier_key" | "slot">,
): number | null {
  const ck = click.carrier_key ?? "";
  const matches = (auction.shown_cards ?? []).filter((c) => c.offer_id === offerPublicId && c.carrier_key === ck);
  if (matches.length === 0) return null;
  const bySlot = typeof click.slot === "number" ? matches.find((c) => c.slot === click.slot) : undefined;
  return (bySlot ?? matches[0]!).bid;
}

export function clickoutMetaEventName(offer: Pick<ClickoutMetaOffer, "clickout_meta_event_name">): ClickoutMetaEventName {
  const raw = (offer.clickout_meta_event_name ?? "").trim();
  return (CLICKOUT_META_EVENT_NAMES as readonly string[]).includes(raw)
    ? (raw as ClickoutMetaEventName)
    : CLICKOUT_META_DEFAULT_EVENT;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value.trim().toLowerCase()));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function httpUrlOrNull(raw: string): string | null {
  const t = raw.trim();
  if (t === "" || CONTROL_RE.test(t) || !/^https?:\/\//i.test(t)) return null;
  try {
    const u = new URL(t);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

// The Meta click identifier for the auction's visitor, or "" when the visit
// was not bought on Meta. A captured fbc wins; otherwise one is derived from
// the fbclid exactly as §26 does.
export function clickoutMetaFbc(ids: Pick<ClickoutMetaAuction, "fbc" | "fbclid">, now: number): string {
  const captured = ids.fbc.trim();
  if (FBC_RE.test(captured)) return captured;
  const fbclid = ids.fbclid.trim();
  if (fbclid === "") return "";
  const derived = deriveFbc(fbclid, "", now);
  return FBC_RE.test(derived) ? derived : "";
}

// One click → one Meta event (owner R1). The id is the one the browser minted
// for its half of the same click (`eid`), so Meta pairs the two; a link that
// carries none (no pixel script on the page, or a hand-made URL) gets the
// server's own: 'lgc_' + the click id /lg/lc minted.
export function clickoutMetaEventId(click: Pick<ClickoutMetaClick, "eid" | "click_id">): string {
  const eid = (click.eid ?? "").trim();
  return CLICKOUT_META_EID_RE.test(eid) ? eid : `lgc_${click.click_id}`;
}

// The visitor's `_fbp` cookie when it is well-formed, else "".
export function clickoutMetaFbp(raw: string | undefined): string {
  const t = (raw ?? "").trim();
  return META_FBP_RE.test(t) ? t : "";
}

// Build the Graph API body (exported for the tests that pin its shape).
export async function buildClickoutMetaBody(
  offer: ClickoutMetaOffer,
  click: ClickoutMetaClick,
  auction: ClickoutMetaAuction,
  eventId: string,
  now: number,
): Promise<Record<string, unknown>> {
  const userData: Record<string, unknown> = {};
  const fbc = clickoutMetaFbc(auction, now);
  if (fbc !== "") userData.fbc = fbc;
  const fbp = clickoutMetaFbp(click.fbp) || clickoutMetaFbp(auction.fbp);
  if (fbp !== "") userData.fbp = fbp;
  if (IP_RE.test(click.ip.trim())) userData.client_ip_address = click.ip.trim();
  const ua = click.ua.trim();
  if (ua !== "" && ua.length <= 1024 && !CONTROL_RE.test(ua)) userData.client_user_agent = ua;
  if (auction.session_id.trim() !== "") userData.external_id = [await sha256Hex(auction.session_id)];
  // The contact details the visitor typed into the funnel, hashed upstream
  // (owner R2: "Contact details from the funnel go hashed for matching").
  for (const [key, hash] of Object.entries(readMetaUserData(auction.meta_user_data ?? {}))) {
    userData[key] = [hash];
  }

  const event: Record<string, unknown> = {
    event_name: clickoutMetaEventName(offer),
    event_time: Math.floor(now / 1000),
    event_id: eventId,
    action_source: "website",
    event_source_url: httpUrlOrNull(click.page_url) ?? `https://${click.host}/`,
    user_data: userData,
  };
  const value = clickoutMetaValue(offer, clickoutMetaClickedBid(auction, offer.public_id, click));
  if (value !== null) event.custom_data = { value, currency: "USD" };
  const body: Record<string, unknown> = { data: [event] };
  const testCode = (offer.clickout_meta_test_event_code ?? "").trim();
  if (CLICKOUT_META_TEST_CODE_RE.test(testCode)) body.test_event_code = testCode;
  return body;
}

function seenKey(eventName: string, eventId: string): string {
  return `lg_s2s:${META_PLATFORM}:clickout:${eventName}:${eventId}`;
}

// Best-effort KV seen-set (the §26 idiom): true ⇒ already sent, skip.
async function claimSlot(env: Env, key: string): Promise<boolean> {
  try {
    if ((await env.CACHE.get(key)) !== null) return false;
    await env.CACHE.put(key, "1", { expirationTtl: CLICKOUT_SEEN_TTL_SECONDS });
    return true;
  } catch {
    // KV hiccup ⇒ send anyway; Meta's own event_id dedupe is the backstop.
    return true;
  }
}

async function releaseSlot(env: Env, key: string): Promise<void> {
  try {
    await env.CACHE.delete(key);
  } catch {
    /* the slot expires on its own */
  }
}

// The operator-facing sentence for an outcome, stored on the Offer.
export function describeClickoutMetaOutcome(outcome: ClickoutMetaOutcome): string {
  switch (outcome.status) {
    case "fired":
      return `Sent to Meta dataset ${outcome.dataset_id}: ${outcome.event_name}, Meta accepted ${outcome.events_received ?? "?"} event${outcome.events_received === 1 ? "" : "s"}${outcome.test ? " (with the test event code)" : ""}.`;
    case "deduped":
      return "Not sent again: this exact click was already sent.";
    case "failed": {
      const e = outcome.meta_error;
      if (e !== undefined && e.code === 190) return "Meta refused it: the access token is invalid or expired (Meta error 190).";
      if (e !== undefined && e.code !== null) {
        return `Meta refused it (HTTP ${outcome.http_status ?? "?"}, Meta error ${e.code}${e.type !== null ? ` ${e.type}` : ""}${e.fbtrace_id !== null ? `, trace ${e.fbtrace_id}` : ""}).`;
      }
      return outcome.http_status !== undefined ? `Meta refused it (HTTP ${outcome.http_status}).` : "Could not reach Meta.";
    }
    case "skipped":
      switch (outcome.reason) {
        case "offer_setting_off":
          return "Not sent: the setting is off.";
        case "no_auction":
          return "Not sent: the click did not come from a banner LeadGen showed.";
        case "attempt_mismatch":
        case "offer_not_shown":
          return "Not sent: the click does not match the auction that showed this banner.";
        case "meta_dataset_missing":
          return "Not sent: no Meta dataset (pixel) ID is set on this offer.";
        case "meta_platform_missing":
        case "meta_token_missing":
          return "Not sent: the Meta Conversions API access token is not installed on the server.";
      }
  }
}

const UNRECORDED_SKIPS: ReadonlySet<ClickoutMetaSkipReason> = new Set<ClickoutMetaSkipReason>([
  "offer_setting_off",
  "no_auction",
  "attempt_mismatch",
  "offer_not_shown",
]);

async function recordOutcome(db: D1Database, offerPublicId: string, outcome: ClickoutMetaOutcome, now: number): Promise<void> {
  try {
    await db
      .prepare(
        "UPDATE leadgen_offers SET clickout_meta_last_status = ?, clickout_meta_last_detail = ?, clickout_meta_last_at = ? WHERE public_id = ?",
      )
      .bind(outcome.status, describeClickoutMetaOutcome(outcome), Math.floor(now / 1000), offerPublicId)
      .run();
  } catch {
    // bookkeeping only — the log line below still carries the outcome
  }
}

function logOutcome(offerPublicId: string, clickId: string, outcome: ClickoutMetaOutcome): void {
  // One structured line per clickout, so a test click can be found in Workers
  // Logs by offer or click id. Never the URL (it carries the token).
  const line = { message: "leadgen clickout meta conversion", offer_id: offerPublicId, click_id: clickId, ...outcome };
  if (outcome.status === "failed") console.error(JSON.stringify(line));
  else console.log(JSON.stringify(line));
}

export async function sendClickoutMetaConversion(
  env: Env,
  db: D1Database,
  offer: ClickoutMetaOffer,
  click: ClickoutMetaClick,
  opts?: { now?: number; fetchImpl?: typeof fetch },
): Promise<ClickoutMetaOutcome> {
  const now = opts?.now ?? Date.now();
  const outcome = await send(env, db, offer, click, now, opts?.fetchImpl ?? fetch);
  logOutcome(offer.public_id, click.click_id, outcome);
  // Recorded only for clicks that are really this Offer's: "off" is every
  // ordinary Offer's every click, and a click no auction of ours backs is
  // anyone's hand-made URL — letting those write would let a stranger
  // overwrite the operator's "last clickout" line (and buy a D1 write per GET).
  if (!(outcome.status === "skipped" && UNRECORDED_SKIPS.has(outcome.reason))) {
    await recordOutcome(db, offer.public_id, outcome, now);
  }
  return outcome;
}

async function send(
  env: Env,
  db: D1Database,
  offer: ClickoutMetaOffer,
  click: ClickoutMetaClick,
  now: number,
  doFetch: typeof fetch,
): Promise<ClickoutMetaOutcome> {
  try {
    if (offer.clickout_meta_conversion !== 1) return { status: "skipped", reason: "offer_setting_off" };

    const auction = await loadClickoutMetaAuction(db, click.auction_instance_id);
    if (auction === null) return { status: "skipped", reason: "no_auction" };
    if (auction.funnel_attempt_id !== "" && auction.funnel_attempt_id !== click.funnel_attempt_id.trim()) {
      return { status: "skipped", reason: "attempt_mismatch" };
    }
    if (!auction.shown_offer_ids.has(offer.public_id)) return { status: "skipped", reason: "offer_not_shown" };

    const destination = await resolveClickoutMetaDestination(env, db, offer);
    if (!destination.ok) return { status: "skipped", reason: destination.problem };

    const eventName = clickoutMetaEventName(offer);
    const eventId = clickoutMetaEventId(click);
    const key = seenKey(eventName, eventId);
    // Configuration is proven good before the slot is claimed, so an operator
    // who fixes a missing setting does not find the next click eaten.
    if (!(await claimSlot(env, key))) return { status: "deduped", event_id: eventId };

    const body = await buildClickoutMetaBody(offer, click, auction, eventId, now);
    const url = new URL(destination.endpoint);
    url.searchParams.set("access_token", destination.token);
    let res: Response;
    try {
      res = await doFetch(url.toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (err) {
      await releaseSlot(env, key);
      // The error NAME only — a fetch rejection can embed the request URL, and
      // that URL carries the access token.
      return { status: "failed", reason: `send_error:${safeErrorName(err)}` };
    }
    let parsed: Record<string, unknown> = {};
    try {
      const raw = (await res.json()) as unknown;
      if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) parsed = raw as Record<string, unknown>;
    } catch {
      parsed = {};
    }
    const token = (v: unknown): string | null => (typeof v === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(v) ? v : null);
    const int = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) ? v : null);
    if (!res.ok) {
      await releaseSlot(env, key);
      const e = (parsed["error"] ?? {}) as Record<string, unknown>;
      return {
        status: "failed",
        reason: "meta_rejected",
        http_status: res.status,
        meta_error: { code: int(e["code"]), subcode: int(e["error_subcode"]), type: token(e["type"]), fbtrace_id: token(e["fbtrace_id"]) },
      };
    }
    return {
      status: "fired",
      dataset_id: destination.dataset_id,
      event_name: eventName,
      event_id: eventId,
      http_status: res.status,
      events_received: int(parsed["events_received"]),
      fbtrace_id: token(parsed["fbtrace_id"]),
      test: typeof body.test_event_code === "string",
    };
  } catch (err) {
    return { status: "failed", reason: `send_error:${safeErrorName(err)}` };
  }
}
