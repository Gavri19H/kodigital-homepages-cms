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
//     /lg/pb or /lg/px and is untouched here. It also gates on the click's
//     traffic_source, which is empty on every production auction measured
//     (2026-09-27: 146/146 rows, including all 54 that carry an fbclid), so it
//     could not have been reused even if the ticket had allowed it.
//   * not revenue. Nothing here writes leadgen_revenue_raw,
//     leadgen_conversion_log or a cap counter. A click is not a sale.
//   * not Admin → Conversions. That product has its own Meta connection; this
//     is configured on the LeadGen Offer.
//   * not a second pixel system. The Meta dataset id and the Conversions API
//     token come from the ONE place LeadGen already keeps them: the
//     `facebook` row of leadgen_media_platforms (its postback_url_template is
//     the Graph endpoint, its auth_secret_ref names the allowlisted token).
//
// THE SWITCH is the Offer's clickout_meta_conversion flag (default 0). The
// platform row's own `enabled` flag keeps meaning what §26 documents — "fire
// matched-conversion pixels" — and is NOT consulted here: turning on a clickout
// signal for one static Offer must not also switch on matched-conversion
// pixels for every dynamic Offer.
//
// TRANSPORT matches the two known-good Meta senders in this estate (the
// Conversions engine's destination-meta adapter and the reference funnel's
// CAPI handler): POST JSON to https://graph.facebook.com/v25.0/<dataset>/events
// with the token as the access_token query parameter. The URL therefore
// carries a secret and is NEVER logged; only the dataset id is.
//
// DEDUPE: at most one Meta event per (funnel attempt, Offer) — a double-click
// or a back-and-click-again mints a new click_id each time, and counting each
// as a Lead would inflate exactly the number marketing optimises on. The KV
// seen-set uses the LeadGen S2S prefix `lg_s2s:`, and the same identity is
// sent as Meta's event_id so Meta's own event_id dedupe backs up KV's
// eventual consistency.
//
// Never throws. Everything runs on waitUntil after the 302 has been returned,
// so a Meta outage cannot slow or break a visitor's click.

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

// Meta Events Manager test codes look like TEST12345; bounded and
// control-char-free so nothing odd reaches the request body.
export const CLICKOUT_META_TEST_CODE_RE = /^[A-Za-z0-9_-]{1,64}$/;

const META_PLATFORM = "facebook";
const CLICKOUT_SEEN_TTL_SECONDS = 24 * 3600; // the §26 S2S window
// The Graph endpoint shape the media platform row must hold. Same guard as the
// Conversions engine's materializeMetaRequest, plus a numeric dataset id.
const META_CAPI_ENDPOINT_RE = /^https:\/\/graph\.facebook\.com\/(v[0-9]+\.[0-9]+)\/([0-9]{5,20})\/events\/?$/;
// Meta's fbc cookie shape (fb.<subdomain index>.<creation ms>.<fbclid>).
const FBC_RE = /^fb\.[12]\.[0-9]{10,16}\.[A-Za-z0-9._~-]{1,512}$/;
const IP_RE = /^[0-9A-Fa-f:.]{2,45}$/;
const CONTROL_RE = /[\u0000-\u001f\u007f]/;

// The Offer columns this needs (leadgen_offers + 0058).
export interface ClickoutMetaOffer {
  public_id: string;
  calls_provider_api: number;
  clickout_meta_conversion: number;
  clickout_meta_event_name: string | null;
  clickout_meta_value: number | null;
  clickout_meta_test_event_code: string | null;
  static_bid_currency: string | null;
}

// What the click request knows about the visitor. All of it is already on the
// click: fbc/fbclid/session_id from the auction's persisted macro snapshot,
// ip/ua/referer fresh from the /lg/lc request itself.
export interface ClickoutMetaClick {
  click_id: string;
  funnel_attempt_id: string;
  session_id: string;
  fbc: string;
  fbclid: string;
  ip: string;
  ua: string;
  // The funnel page the visitor clicked from (the /lg/lc request's Referer).
  page_url: string;
  // Fallback event_source_url when the Referer is absent: the tenant origin.
  host: string;
}

export type ClickoutMetaOutcome =
  | { status: "fired"; dataset_id: string; event_name: string; event_id: string; http_status: number; events_received: number | null; fbtrace_id: string | null; test: boolean }
  | { status: "skipped"; reason: ClickoutMetaSkipReason }
  | { status: "deduped"; event_id: string }
  | { status: "failed"; reason: string; http_status?: number; meta_error?: MetaErrorFacts };

// What Meta says when it refuses an event — its numeric code, type and trace
// id only (e.g. 190/OAuthException = bad token). Never its message text, which
// is free-form and not ours to log.
export interface MetaErrorFacts {
  code: number | null;
  subcode: number | null;
  type: string | null;
  fbtrace_id: string | null;
}

export type ClickoutMetaSkipReason =
  | "offer_setting_off"
  | "offer_not_static"
  | "not_meta_traffic" // no fbc and no fbclid — this visit was not bought on Meta
  | ClickoutMetaDestinationProblem;

export type ClickoutMetaDestinationProblem =
  | "meta_platform_missing" // no `facebook` row in leadgen_media_platforms
  | "meta_endpoint_not_configured" // its URL is not a Graph /events endpoint
  | "meta_token_missing"; // its auth_secret_ref is unset, not allowlisted, or unbound

export type ClickoutMetaDestination =
  | { ok: true; dataset_id: string; api_version: string; endpoint: string; token: string }
  | { ok: false; problem: ClickoutMetaDestinationProblem; dataset_id: string | null };

// Where a clickout event would go, or exactly why it cannot. Shared by the
// sender and by the Offer editor, which shows the answer next to the switch so
// whoever turns it on can see whether it will actually reach Meta.
export async function resolveClickoutMetaDestination(env: Env, db: D1Database): Promise<ClickoutMetaDestination> {
  let row: { postback_url_template: string; auth_secret_ref: string | null } | null = null;
  try {
    row = await db
      .prepare(
        "SELECT postback_url_template, auth_secret_ref FROM leadgen_media_platforms WHERE lower(platform) = ? LIMIT 1",
      )
      .bind(META_PLATFORM)
      .first<{ postback_url_template: string; auth_secret_ref: string | null }>();
  } catch {
    row = null;
  }
  if (row === null) return { ok: false, problem: "meta_platform_missing", dataset_id: null };
  const endpoint = (row.postback_url_template ?? "").trim();
  const m = endpoint.match(META_CAPI_ENDPOINT_RE);
  if (m === null) return { ok: false, problem: "meta_endpoint_not_configured", dataset_id: null };
  const apiVersion = m[1] ?? "";
  const datasetId = m[2] ?? "";
  const ref = (row.auth_secret_ref ?? "").trim();
  if (ref === "") return { ok: false, problem: "meta_token_missing", dataset_id: datasetId };
  const token = resolveAllowedOutboundSecretReference(env, ref);
  if (!token.ok || token.value.trim() === "" || /[\u0000- \u007f]/.test(token.value.trim())) {
    return { ok: false, problem: "meta_token_missing", dataset_id: datasetId };
  }
  return {
    ok: true,
    dataset_id: datasetId,
    api_version: apiVersion,
    endpoint: `https://graph.facebook.com/${apiVersion}/${datasetId}/events`,
    token: token.value.trim(),
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

// The Meta click identifier for this visit, or "" when the visit was not
// bought on Meta. A captured fbc wins; otherwise one is derived from the
// fbclid exactly as §26 does.
export function clickoutMetaFbc(click: Pick<ClickoutMetaClick, "fbc" | "fbclid">, now: number): string {
  const captured = click.fbc.trim();
  if (FBC_RE.test(captured)) return captured;
  const fbclid = click.fbclid.trim();
  if (fbclid === "") return "";
  const derived = deriveFbc(fbclid, "", now);
  return FBC_RE.test(derived) ? derived : "";
}

// Build the Graph API body (exported for the tests that pin its shape).
export async function buildClickoutMetaBody(
  offer: ClickoutMetaOffer,
  click: ClickoutMetaClick,
  eventId: string,
  now: number,
): Promise<Record<string, unknown>> {
  const userData: Record<string, unknown> = { fbc: clickoutMetaFbc(click, now) };
  if (IP_RE.test(click.ip.trim())) userData.client_ip_address = click.ip.trim();
  const ua = click.ua.trim();
  if (ua !== "" && ua.length <= 1024 && !CONTROL_RE.test(ua)) userData.client_user_agent = ua;
  if (click.session_id.trim() !== "") userData.external_id = [await sha256Hex(click.session_id)];

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

// One (funnel attempt, Offer) → one Meta event. Falls back to the click_id when
// the governed href carried no attempt id.
export function clickoutMetaEventId(offerPublicId: string, click: Pick<ClickoutMetaClick, "funnel_attempt_id" | "click_id">): string {
  const attempt = click.funnel_attempt_id.trim();
  return attempt !== "" ? `lgco.${attempt}.${offerPublicId}` : `lgco.${click.click_id}`;
}

// Best-effort KV seen-set (the §26 idiom): true ⇒ already sent, skip.
async function alreadySent(env: Env, eventName: string, eventId: string): Promise<boolean> {
  try {
    const key = `lg_s2s:${META_PLATFORM}:clickout:${eventName}:${eventId}`;
    if ((await env.CACHE.get(key)) !== null) return true;
    await env.CACHE.put(key, "1", { expirationTtl: CLICKOUT_SEEN_TTL_SECONDS });
    return false;
  } catch {
    // KV hiccup ⇒ send anyway; Meta's own event_id dedupe is the backstop.
    return false;
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
  const outcome = await send(env, db, offer, click, opts);
  logOutcome(offer.public_id, click.click_id, outcome);
  return outcome;
}

async function send(
  env: Env,
  db: D1Database,
  offer: ClickoutMetaOffer,
  click: ClickoutMetaClick,
  opts?: { now?: number; fetchImpl?: typeof fetch },
): Promise<ClickoutMetaOutcome> {
  try {
    if (offer.clickout_meta_conversion !== 1) return { status: "skipped", reason: "offer_setting_off" };
    // The setting is only offered for static Offers and the save path refuses
    // it otherwise; this re-check keeps a hand-edited row from firing for a
    // provider-request Offer.
    if (offer.calls_provider_api !== 0) return { status: "skipped", reason: "offer_not_static" };
    const now = opts?.now ?? Date.now();
    if (clickoutMetaFbc(click, now) === "") return { status: "skipped", reason: "not_meta_traffic" };

    const destination = await resolveClickoutMetaDestination(env, db);
    if (!destination.ok) return { status: "skipped", reason: destination.problem };

    const eventName = clickoutMetaEventName(offer);
    const eventId = clickoutMetaEventId(offer.public_id, click);
    // Configuration is proven good before the dedupe slot is spent, so an
    // operator who fixes a missing token does not find the next click eaten.
    if (await alreadySent(env, eventName, eventId)) return { status: "deduped", event_id: eventId };

    const body = await buildClickoutMetaBody(offer, click, eventId, now);
    const url = new URL(destination.endpoint);
    url.searchParams.set("access_token", destination.token);
    const doFetch = opts?.fetchImpl ?? fetch;
    const res = await doFetch(url.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
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
    // The error NAME only — a fetch rejection can embed the request URL, and
    // that URL carries the access token.
    return { status: "failed", reason: `send_error:${safeErrorName(err)}` };
  }
}
