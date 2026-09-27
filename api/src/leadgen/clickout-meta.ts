// LeadGen — the Meta (Facebook) conversion fired on CLICKOUT for a
// "Static — no provider request" Offer (0058).
//
// WHY THIS EXISTS: a static Offer is a partner with no API. It never tells us
// who converted, so the Meta campaign that bought the visit has nothing to
// optimise on. The clickout is the one signal we own. Marketing asked for it
// as a MEDIA signal only.
//
// WHAT IT IS NOT — each of these is a deliberate boundary, not an omission:
//   * not §26 (s2s-dispatch.ts). §26 fires on a MATCHED conversion booked by
//     /lg/pb or /lg/px and is untouched here — its platform row's URL template
//     and `enabled` flag are not read. §26 also gates on the click's
//     traffic_source, which is empty on every production auction measured
//     (2026-09-27: 146/146 rows, including all 54 that carry an fbclid).
//   * not revenue. Nothing here writes leadgen_revenue_raw,
//     leadgen_conversion_log or a cap counter. A click is not a sale.
//   * not Admin → Conversions. That product has its own Meta connection; this
//     is configured on the LeadGen Offer.
//   * not a second credential store. The Meta dataset id is an Offer setting;
//     the access token is the secret LeadGen's `facebook` media platform row
//     already names (auth_secret_ref, outbound-allowlisted).
//
// WHO THE VISITOR IS comes ONLY from the auction that showed this Offer. /lg/lc
// is an unguarded public GET (a click must always 302), so anything on its
// query string is attacker-controlled: an fbclid pasted onto a hand-made
// /lg/lc URL would otherwise let a script mint unlimited Meta Leads. The fbc,
// fbclid and session come from the auction's persisted macro snapshot, and the
// send happens only when that auction (a) exists, (b) belongs to the funnel
// attempt the click names, and (c) actually showed this Offer. /lg/auction is
// the guarded endpoint (bot + rate limit + signed attempt binding), so a
// forged Lead now costs a full guarded funnel run — and the dedupe below
// makes that run worth exactly one event.
//
// TRANSPORT matches the two known-good Meta senders in this estate (the
// Conversions engine's destination-meta adapter and the reference funnel's
// CAPI handler): POST JSON to https://graph.facebook.com/v25.0/<dataset>/events
// with the token as the access_token query parameter. The URL therefore
// carries a secret and is NEVER logged; only the dataset id is.
//
// DEDUPE: at most one Meta event per (funnel attempt, Offer). A double-click
// mints a new click_id each time, and counting each as a Lead would inflate
// exactly the number marketing optimises on. The KV seen-set uses the LeadGen
// S2S prefix `lg_s2s:`; the same identity is Meta's event_id, so Meta's own
// event_id dedupe backs up KV's eventual consistency. A send Meta refuses (a
// bad token, say) gives the slot back, so fixing the token does not lose the
// visitor's next click.
//
// Never throws. Runs on waitUntil after the 302 has been returned, so a Meta
// outage cannot slow or break a visitor's click. The outcome is logged AND
// stored on the Offer, so whoever runs a test click can read what happened on
// the Offer page instead of in Workers Logs.

import type { Env } from "../env";
import { resolveAllowedOutboundSecretReference } from "../env";
import { deriveFbc } from "./s2s-dispatch";
import { safeErrorName } from "../safety/safe-error";

// Meta standard events that make sense for a clickout. "Lead" is the default:
// the visitor left for the partner's form, which is what a lead-gen campaign
// optimises toward.
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
export const CLICKOUT_META_DEFAULT_EVENT: ClickoutMetaEventName = "Lead";

// A Meta dataset (pixel) id is all digits.
export const CLICKOUT_META_DATASET_RE = /^[0-9]{5,20}$/;
// Meta Events Manager test codes look like TEST12345; bounded and
// control-char-free so nothing odd reaches the request body.
export const CLICKOUT_META_TEST_CODE_RE = /^[A-Za-z0-9_-]{1,64}$/;
// The Graph API version both known-good Meta senders in this estate use.
export const CLICKOUT_META_GRAPH_VERSION = "v25.0";

const META_PLATFORM = "facebook";
const CLICKOUT_SEEN_TTL_SECONDS = 24 * 3600; // the §26 S2S window
// Meta's fbc cookie shape (fb.<subdomain index>.<creation ms>.<fbclid>).
const FBC_RE = /^fb\.[12]\.[0-9]{10,16}\.[A-Za-z0-9._~-]{1,512}$/;
const IP_RE = /^[0-9A-Fa-f:.]{2,45}$/;
const CONTROL_RE = /[\u0000-\u001f\u007f]/;

// The Offer columns this needs (leadgen_offers + 0058).
export interface ClickoutMetaOffer {
  public_id: string;
  calls_provider_api: number;
  clickout_meta_conversion: number;
  clickout_meta_dataset_id: string | null;
  clickout_meta_event_name: string | null;
  clickout_meta_value: number | null;
  clickout_meta_test_event_code: string | null;
  static_bid_currency: string | null;
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
}

// The auction that showed the banner, as persisted by the engine.
export interface ClickoutMetaAuction {
  funnel_attempt_id: string;
  shown_offer_ids: ReadonlySet<string>;
  fbc: string;
  fbclid: string;
  session_id: string;
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

export type ClickoutMetaSkipReason =
  | "offer_setting_off"
  | "offer_not_static"
  | "no_auction" // the click names no auction we ran
  | "attempt_mismatch" // the auction belongs to another funnel attempt
  | "offer_not_shown" // that auction never showed this Offer
  | "not_meta_traffic" // the auction's visitor had no fbc and no fbclid
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
  try {
    const carriers = JSON.parse(row.carriers_shown_json ?? "[]") as unknown;
    if (Array.isArray(carriers)) {
      for (const c of carriers) {
        const id = c !== null && typeof c === "object" ? (c as { offer_id?: unknown }).offer_id : undefined;
        if (typeof id === "string" && id !== "") shown.add(id);
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
    fbc: text(snapshot["fbc"]),
    fbclid: text(snapshot["fbclid"]),
    session_id: row.session_id ?? text(snapshot["session_id"]),
  };
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

// One (funnel attempt, Offer) → one Meta event. The attempt is the auction's
// own (server truth), falling back to the auction instance.
export function clickoutMetaEventId(offerPublicId: string, auction: Pick<ClickoutMetaAuction, "funnel_attempt_id">, auctionInstanceId: string): string {
  const attempt = auction.funnel_attempt_id.trim();
  return `lgco.${attempt !== "" ? attempt : auctionInstanceId}.${offerPublicId}`;
}

// Build the Graph API body (exported for the tests that pin its shape).
export async function buildClickoutMetaBody(
  offer: ClickoutMetaOffer,
  click: ClickoutMetaClick,
  auction: ClickoutMetaAuction,
  eventId: string,
  now: number,
): Promise<Record<string, unknown>> {
  const userData: Record<string, unknown> = { fbc: clickoutMetaFbc(auction, now) };
  if (IP_RE.test(click.ip.trim())) userData.client_ip_address = click.ip.trim();
  const ua = click.ua.trim();
  if (ua !== "" && ua.length <= 1024 && !CONTROL_RE.test(ua)) userData.client_user_agent = ua;
  if (auction.session_id.trim() !== "") userData.external_id = [await sha256Hex(auction.session_id)];

  const event: Record<string, unknown> = {
    event_name: clickoutMetaEventName(offer),
    event_time: Math.floor(now / 1000),
    event_id: eventId,
    action_source: "website",
    event_source_url: httpUrlOrNull(click.page_url) ?? `https://${click.host}/`,
    user_data: userData,
  };
  const value = offer.clickout_meta_value;
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    const currency = (offer.static_bid_currency ?? "").trim().toUpperCase();
    event.custom_data = { value, currency: /^[A-Z]{3}$/.test(currency) ? currency : "USD" };
  }
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
      return "Not sent again: this visitor's clickout on this offer was already sent.";
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
        case "offer_not_static":
          return "Not sent: this offer is not Static — no provider request.";
        case "no_auction":
          return "Not sent: the click did not come from a banner LeadGen showed.";
        case "attempt_mismatch":
        case "offer_not_shown":
          return "Not sent: the click does not match the auction that showed this banner.";
        case "not_meta_traffic":
          return "Not sent: the visitor did not arrive from a Meta ad (no fbclid on the funnel link).";
        case "meta_dataset_missing":
          return "Not sent: no Meta dataset (pixel) ID is set on this offer.";
        case "meta_platform_missing":
        case "meta_token_missing":
          return "Not sent: the Meta Conversions API access token is not installed on the server.";
      }
  }
}

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
  // "Off" is every ordinary Offer's every click — nothing worth recording.
  if (!(outcome.status === "skipped" && outcome.reason === "offer_setting_off")) {
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
    // The setting is only offered for static Offers and the save path refuses
    // it otherwise; this re-check keeps a hand-edited row from firing for a
    // provider-request Offer.
    if (offer.calls_provider_api !== 0) return { status: "skipped", reason: "offer_not_static" };

    const auction = await loadClickoutMetaAuction(db, click.auction_instance_id);
    if (auction === null) return { status: "skipped", reason: "no_auction" };
    if (auction.funnel_attempt_id !== "" && auction.funnel_attempt_id !== click.funnel_attempt_id.trim()) {
      return { status: "skipped", reason: "attempt_mismatch" };
    }
    if (!auction.shown_offer_ids.has(offer.public_id)) return { status: "skipped", reason: "offer_not_shown" };
    if (clickoutMetaFbc(auction, now) === "") return { status: "skipped", reason: "not_meta_traffic" };

    const destination = await resolveClickoutMetaDestination(env, db, offer);
    if (!destination.ok) return { status: "skipped", reason: destination.problem };

    const eventName = clickoutMetaEventName(offer);
    const eventId = clickoutMetaEventId(offer.public_id, auction, click.auction_instance_id);
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
