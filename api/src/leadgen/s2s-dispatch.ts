// LeadGen §26 — outbound server-to-server (S2S) media-platform dispatcher.
//
// On a MATCHED conversion we fire an outbound S2S pixel back to the media
// platform that sent the traffic so its optimization models learn from the
// conversion WITHOUT a browser pixel. Fully config-driven (0038
// leadgen_media_platforms):
//   * look up the ENABLED platform row whose `platform` matches the click's
//     `traffic_source` (case-insensitive);
//   * resolve its `postback_url_template` macros from the click/revenue context
//     ({fbc},{fbclid},{click_id},{value},{currency},{event_name},{auth_token});
//   * §26 report {value} = revenue × the platform's `value_multiplier`;
//   * FB `fbc` is derived from `fbclid` when absent (fb.1.<ts>.<fbclid>);
//   * fire the resolved URL on ctx.waitUntil — a non-2xx / failure is LOGGED,
//     never thrown, never blocks ingestion;
//   * a disabled row (enabled=0, the seeded default) fires NOTHING; a new
//     platform is a new config row + macro mapping, NO code change.
//
// Idempotency: a best-effort KV seen-set fires each (platform, click_id,
// event_name, conversion_id) at most once within a TTL window, so a browser
// conversion and a provider postback for the SAME conversion do not double-fire
// the pixel. The KV key uses the LEADGEN dedupe prefix `lg_s2s:`.
//
// Secrets (§30.2 + conversions plan §18.7): a configured `auth_secret_ref`
// must be safe, explicitly allowlisted, and bound to a non-empty value. Any
// failure returns before fetch; a configured token can never degrade into a
// tokenless partner request.

import type { Env } from "../env";
import { resolveAllowedOutboundSecretReference } from "../env";
import type { WaitUntilContext } from "../wait-until-context";
import { resolveMacros } from "./macros";
import { createLeadgenChClient, type LeadgenChClient } from "./clickhouse";
import { safeErrorCode, safeErrorName } from "../safety/safe-error";

export interface MediaPlatformRow {
  id: number;
  platform: string;
  enabled: number;
  postback_url_template: string;
  auth_secret_ref: string | null;
  event_name: string | null;
  value_multiplier: number; // §26: {value} = revenue × value_multiplier
}

export interface S2SClickContext {
  click_id: string;
  traffic_source: string;
  fbc: string;
  fbclid: string;
  // Round-4 P4a (D-2): the attempt whose SERVER-recorded routing outcome (if a
  // routing rule matched, entry or checkpoint) supplies the value_multiplier
  // that REPLACES the platform base for THIS conversion (the reference FB
  // Multiplier). OPTIONAL — absent, or no outcome row, or a null recorded
  // multiplier => the platform base applies (single value, NO stacking, the
  // default). SEAM: the conversion callers (postback.ts / the browser path,
  // NOT this slice's files) must resolve click_id -> funnel_attempt_id and pass
  // it here for the graft to fire in production; the mechanism + its default
  // are proven at the dispatch layer by this slice's unit test.
  funnel_attempt_id?: string;
}

// The postback path also needs the matched click's offer (for the §25
// conversion-cap increment) — resolveClickContextFromCh returns this superset.
export interface ResolvedClickContext extends S2SClickContext {
  offer_id: string;
}

export interface S2SRevenueContext {
  // The NATIVE conversion value (number). §26: the reported {value} is
  // revenue × the platform's value_multiplier (the reference `fb_multiplier`).
  revenue: number;
  currency: string;
  event_name?: string; // overrides the platform row's default event_name
  // The conversion IDENTITY: external_txn_id (postback) or the §29 booking key
  // (browser). Part of the dedup key so genuine REPEAT conversions on the same
  // click fire distinct pixels, while a replay of the SAME conversion is
  // deduped. Empty ⇒ dedup falls back to (platform, click_id, event_name).
  conversion_id?: string;
}

export interface S2SDispatchOutcome {
  status: "fired" | "skipped" | "deduped" | "failed";
  platform?: string;
  reason?: string;
}

const S2S_SEEN_TTL_SECONDS = 24 * 3600; // one pixel per click/platform/event/day

// §26: the enabled platform for a traffic_source. `platform` is matched
// case-insensitively against the click's traffic_source (the click stores e.g.
// "facebook"; the row's platform is the canonical lowercase name).
export async function getEnabledPlatformByTrafficSource(
  db: D1Database,
  trafficSource: string,
): Promise<MediaPlatformRow | null> {
  const ts = trafficSource.trim().toLowerCase();
  if (ts === "") return null;
  const row = await db
    .prepare(
      `SELECT id, platform, enabled, postback_url_template, auth_secret_ref, event_name, value_multiplier
       FROM leadgen_media_platforms
       WHERE lower(platform) = ? AND enabled = 1 LIMIT 1`,
    )
    .bind(ts)
    .first<MediaPlatformRow>();
  return row ?? null;
}

// Round-4 P4a (D-2): the SERVER-recorded routing multiplier for an attempt, or
// null. null on: no attempt id, no outcome row, a NULL recorded multiplier, or
// a read error — in every case the platform base applies (the safe default).
// Read straight from leadgen_routing_outcomes (0043) — the single source of
// truth the /lg/auction variant re-derivation shares; NEVER a client echo.
export async function resolveRoutingMultiplier(
  db: D1Database,
  funnelAttemptId: string,
): Promise<number | null> {
  if (funnelAttemptId === "") return null;
  try {
    const row = await db
      .prepare("SELECT value_multiplier FROM leadgen_routing_outcomes WHERE funnel_attempt_id = ? LIMIT 1")
      .bind(funnelAttemptId)
      .first<{ value_multiplier: number | null }>();
    if (row === null) return null;
    const v = row.value_multiplier;
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

// §26: derive the FB `fbc` from `fbclid` when the browser never captured one.
// Format is fb.1.<creation_ms>.<fbclid> (Meta's click-id cookie shape).
export function deriveFbc(fbclid: string, fbc: string, now: number): string {
  if (fbc !== "") return fbc;
  if (fbclid === "") return "";
  return `fb.1.${now}.${fbclid}`;
}

// §26 the reported value: revenue × value_multiplier, as a macro string. A
// non-finite product (or non-finite inputs) reports "0" rather than "NaN".
// `value_multiplier` uses a finite-guard (not `|| 1`) so a legitimate 0
// multiplier is preserved (report value 0) instead of coerced to 1.
function reportedValue(revenue: number, valueMultiplier: number): string {
  const rev = typeof revenue === "number" && Number.isFinite(revenue) ? revenue : 0;
  const mult =
    typeof valueMultiplier === "number" && Number.isFinite(valueMultiplier) ? valueMultiplier : 1;
  const product = rev * mult;
  return Number.isFinite(product) ? String(product) : "0";
}

// Absolute http(s) gate for the RESOLVED outbound URL (never fire a
// javascript:/data:/relative destination even if a template is malformed).
function isFireableUrl(url: string): boolean {
  if (!/^https?:\/\//i.test(url)) return false;
  try {
    const p = new URL(url);
    return p.protocol === "http:" || p.protocol === "https:";
  } catch {
    return false;
  }
}

// Best-effort KV dedupe: true ⇒ already fired within the window (skip). The key
// includes the conversion identity so distinct conversions on the same click
// each fire; only a replay of the SAME conversion is deduped. Uses the LEADGEN
// dedupe prefix `lg_s2s:` (never the listicles prefix).
async function alreadyFired(
  env: Env,
  platform: string,
  clickId: string,
  eventName: string,
  conversionId: string,
): Promise<boolean> {
  try {
    const key = `lg_s2s:${platform}:${clickId}:${eventName}:${conversionId}`;
    if ((await env.CACHE.get(key)) !== null) return true;
    await env.CACHE.put(key, "1", { expirationTtl: S2S_SEEN_TTL_SECONDS });
    return false;
  } catch {
    // KV hiccup ⇒ do not block the fire (a rare double-pixel is safer than a
    // dropped conversion signal).
    return false;
  }
}

// Resolve + fire the outbound pixel for a MATCHED conversion. Never throws.
// Returns a structured outcome (tests assert against it); the actual network
// fire is registered on ctx.waitUntil so it never blocks the caller.
export async function dispatchMatchedConversionS2S(
  env: Env,
  ctx: WaitUntilContext,
  db: D1Database,
  click: S2SClickContext,
  revenue: S2SRevenueContext,
  opts?: { now?: number; fetchImpl?: typeof fetch },
): Promise<S2SDispatchOutcome> {
  try {
    if (click.click_id === "" || click.traffic_source === "") {
      return { status: "skipped", reason: "no click_id or traffic_source" };
    }
    const platform = await getEnabledPlatformByTrafficSource(db, click.traffic_source);
    if (platform === null) {
      // A disabled row (enabled=0) is not returned by the query ⇒ fires nothing.
      return { status: "skipped", reason: "no enabled platform for traffic_source" };
    }
    const now = opts?.now ?? Date.now();
    const eventName =
      (revenue.event_name ?? "").trim() || (platform.event_name ?? "").trim() || "Purchase";

    let authToken = "";
    if (platform.auth_secret_ref !== null && platform.auth_secret_ref !== "") {
      const resolution = resolveAllowedOutboundSecretReference(env, platform.auth_secret_ref);
      if (!resolution.ok) {
        console.error(JSON.stringify({
          message: "leadgen outbound secret reference rejected",
          platform: platform.platform,
          code: resolution.code,
        }));
        return {
          status: "failed",
          platform: platform.platform,
          reason: `outbound secret reference rejected: ${resolution.code}`,
        };
      }
      authToken = resolution.value;
    }

    // Do not consume the conversion's dedupe slot when configuration fails.
    // Operators can repair the binding and safely replay the same conversion.
    if (await alreadyFired(env, platform.platform, click.click_id, eventName, revenue.conversion_id ?? "")) {
      return { status: "deduped", platform: platform.platform };
    }

    // P4a (D-2, roast minor-7): the highest-priority MATCHED routing rule's
    // multiplier REPLACES the platform base for this conversion (single value,
    // NO stacking); the base applies when no routing rule matched the attempt.
    const routingMultiplier =
      click.funnel_attempt_id !== undefined && click.funnel_attempt_id !== ""
        ? await resolveRoutingMultiplier(db, click.funnel_attempt_id)
        : null;
    const effectiveMultiplier = routingMultiplier ?? platform.value_multiplier;

    const macroValues: Record<string, string> = {
      click_id: click.click_id,
      fbclid: click.fbclid,
      fbc: deriveFbc(click.fbclid, click.fbc, now),
      value: reportedValue(revenue.revenue, effectiveMultiplier),
      currency: revenue.currency,
      event_name: eventName,
      auth_token: authToken,
    };
    const url = resolveMacros(platform.postback_url_template, macroValues);
    if (!isFireableUrl(url)) {
      return { status: "failed", platform: platform.platform, reason: "resolved URL is not absolute http(s)" };
    }

    const doFetch = opts?.fetchImpl ?? fetch;
    const fire = doFetch(url, { method: "GET", redirect: "manual" })
      .then((resp) => {
        if (!resp.ok && resp.status < 300) {
          // §26: a non-2xx response is LOGGED, never thrown, never re-fired.
          console.error(`[lg-s2s] ${platform.platform} pixel non-2xx: ${resp.status}`);
        }
      })
      .catch((err) => {
        // Log the error NAME only — never the message: a fetch rejection can
        // embed the request URL, which carries the resolved {auth_token} query
        // param (§30.3 "access tokens redacted in all logs").
        console.error(`[lg-s2s] ${platform.platform} pixel failed: ${safeErrorName(err)}`);
      });
    try {
      ctx.waitUntil(fire);
    } catch {
      // executionCtx unavailable (some harnesses): let the promise settle on
      // its own — still never blocks/throws.
      void fire;
    }
    return { status: "fired", platform: platform.platform };
  } catch (err) {
    const code = safeErrorCode("dispatch_error", err);
    console.error(`[lg-s2s] ${code}`);
    return { status: "failed", reason: code };
  }
}

// ---------------------------------------------------------------------------
// Postback-path click-context resolution (best effort, ClickHouse-backed)
// ---------------------------------------------------------------------------

// The inbound postback carries only a click_id — not the traffic_source / fbc /
// fbclid the outbound pixel needs. LeadGen has no D1 click log (the click
// resolver emits offer_click to the external Athena→CH pipeline, §23), so the
// context is resolved from ClickHouse: the offer_click row (traffic_source +
// session_id) from lg_events_raw, then fbc/fbclid from lg_sessions by
// session_id. HONEST RESIDUAL: this yields context ONLY when CH is configured
// AND the click has already landed in CH; absent either, the postback path
// fires no S2S (the browser-conversion path is the primary CH-independent
// trigger). Returns null when unresolved; never throws.
export async function resolveClickContextFromCh(
  env: Env,
  clickId: string,
  opts?: { client?: LeadgenChClient },
): Promise<ResolvedClickContext | null> {
  if (clickId === "") return null;
  const client = opts?.client ?? createLeadgenChClient(env);
  if (!client.configured) return null;
  try {
    const clickRes = await client.query<{ traffic_source: string; session_id: string; offer_id: string; funnel_attempt_id: string }>(
      "SELECT traffic_source, session_id, offer_id, funnel_attempt_id FROM lg_events_raw " +
        "WHERE event_type = 'offer_click' AND click_id = {click_id} " +
        "AND traffic_quality_flag = 'clean' ORDER BY ts DESC LIMIT 1",
      { click_id: clickId },
    );
    const click = clickRes.rows[0];
    if (click === undefined || (click.traffic_source ?? "") === "") return null;
    let fbc = "";
    let fbclid = "";
    if ((click.session_id ?? "") !== "") {
      const sessRes = await client.query<{ fbc: string; fbclid: string }>(
        "SELECT fbc, fbclid FROM lg_sessions WHERE session_id = {sid} ORDER BY ver DESC LIMIT 1",
        { sid: click.session_id },
      );
      const sess = sessRes.rows[0];
      if (sess !== undefined) {
        fbc = String(sess.fbc ?? "");
        fbclid = String(sess.fbclid ?? "");
      }
    }
    const funnelAttemptId = String(click.funnel_attempt_id ?? "");
    return {
      click_id: clickId,
      traffic_source: String(click.traffic_source),
      fbc,
      fbclid,
      offer_id: String(click.offer_id ?? ""),
      // Round-4 P4a review MAJOR-1: without this, resolveRoutingMultiplier
      // (called inside dispatchMatchedConversionS2S below) is UNREACHABLE on
      // the real postback path — the offer_click event stamps
      // funnel_attempt_id (click.ts buildClickEvent), but this SELECT never
      // read it back, so every S2S postback conversion silently fell back to
      // the platform base multiplier even for a routed attempt.
      ...(funnelAttemptId !== "" ? { funnel_attempt_id: funnelAttemptId } : {}),
    };
  } catch (err) {
    console.error(`[lg-s2s] CH click-context lookup failed: ${safeErrorName(err)}`);
    return null;
  }
}
