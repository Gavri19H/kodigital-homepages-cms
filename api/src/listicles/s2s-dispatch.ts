// Listicles §20 — outbound server-to-server (S2S) pixel dispatcher.
//
// On a MATCHED conversion we fire an outbound S2S pixel back to the media
// platform that sent the traffic, so the platform's optimization models learn
// from the conversion WITHOUT a browser pixel (§19 "prefer S2S over browser
// pixels"). Fully config-driven (migration 0034 `listicle_media_platforms`):
//   * look up the ENABLED platform row whose `platform` matches the click's
//     `traffic_source` (case-insensitive);
//   * resolve its `postback_url_template` macros from the click/revenue context
//     ({fbc},{fbclid},{click_id},{value},{currency},{event_name},{auth_token});
//   * FB `fbc` is derived from `fbclid` when absent (fb.1.<ts>.<fbclid>, §20);
//   * fire the resolved URL on ctx.waitUntil — a failure is LOGGED, never
//     thrown, never blocks ingestion;
//   * a new platform = a new config row + macro mapping, NO code change; a
//     disabled row (enabled=0, the seeded default) fires NOTHING.
//
// The dispatcher is CALLED from two matched-conversion sites (both wired):
//   (a) the browser `conversion` beacon (analytics/listicle-track.ts) — the
//       event carries traffic_source/fbc/fbclid/click_id directly (primary,
//       ClickHouse-independent path);
//   (b) the inbound provider postback (public/listicle/postback.ts) — best
//       effort: the click context is resolved from ClickHouse when configured
//       (documented residual — see resolveClickContextFromCh).
//
// Idempotency: a best-effort KV seen-set fires each (platform, click_id,
// event_name) at most once within a TTL window, so a browser conversion and a
// provider postback for the SAME conversion do not double-fire the pixel.

import type { Env } from "../env";
import { resolveAllowedOutboundSecretReference } from "../env";
import type { WaitUntilContext } from "../wait-until-context";
import { resolveMacros } from "./macros";
import { createListicleChClient, type ListicleChClient } from "./clickhouse";
import { safeErrorCode, safeErrorName } from "../safety/safe-error";

export interface MediaPlatformRow {
  id: number;
  platform: string;
  enabled: number;
  postback_url_template: string;
  auth_secret_ref: string | null;
  event_name: string | null;
}

export interface S2SClickContext {
  click_id: string;
  traffic_source: string;
  fbc: string;
  fbclid: string;
}

// The postback path also needs the matched click's offer (for the §9.3
// conversion-cap increment) — resolveClickContextFromCh returns this superset.
export interface ResolvedClickContext extends S2SClickContext {
  offer_id: string;
}

export interface S2SRevenueContext {
  value: string;    // the conversion value as a string (native currency amount)
  currency: string;
  event_name?: string; // overrides the platform row's default event_name
  // The conversion IDENTITY (FIX 4): external_txn_id (postback) or the §31.7
  // booking key (browser). Part of the dedup key so genuine REPEAT conversions
  // on the same click fire distinct pixels, while a replay of the SAME
  // conversion is deduped. Empty ⇒ dedup falls back to (platform, click_id,
  // event_name) alone.
  conversion_id?: string;
}

export interface S2SDispatchOutcome {
  status: "fired" | "skipped" | "deduped" | "failed";
  platform?: string;
  reason?: string;
}

const S2S_SEEN_TTL_SECONDS = 24 * 3600; // one pixel per click/platform/event/day

// §20: the enabled platform for a traffic_source. `platform` is matched
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
      `SELECT id, platform, enabled, postback_url_template, auth_secret_ref, event_name
       FROM listicle_media_platforms
       WHERE lower(platform) = ? AND enabled = 1 LIMIT 1`,
    )
    .bind(ts)
    .first<MediaPlatformRow>();
  return row ?? null;
}

// §20: derive the FB `fbc` from `fbclid` when the browser never captured one.
// Format is fb.1.<creation_ms>.<fbclid> (Meta's click-id cookie shape).
export function deriveFbc(fbclid: string, fbc: string, now: number): string {
  if (fbc !== "") return fbc;
  if (fbclid === "") return "";
  return `fb.1.${now}.${fbclid}`;
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
// includes the conversion identity (FIX 4) so distinct conversions on the same
// click each fire; only a replay of the SAME conversion is deduped.
async function alreadyFired(
  env: Env,
  platform: string,
  clickId: string,
  eventName: string,
  conversionId: string,
): Promise<boolean> {
  try {
    const key = `lst_s2s:${platform}:${clickId}:${eventName}:${conversionId}`;
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
      return { status: "skipped", reason: "no enabled platform for traffic_source" };
    }
    const now = opts?.now ?? Date.now();
    const eventName = (revenue.event_name ?? "").trim() || (platform.event_name ?? "").trim() || "Purchase";

    let authToken = "";
    if (platform.auth_secret_ref !== null && platform.auth_secret_ref !== "") {
      const resolution = resolveAllowedOutboundSecretReference(env, platform.auth_secret_ref);
      if (!resolution.ok) {
        console.error(JSON.stringify({
          message: "listicle outbound secret reference rejected",
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

    const macroValues: Record<string, string> = {
      click_id: click.click_id,
      fbclid: click.fbclid,
      fbc: deriveFbc(click.fbclid, click.fbc, now),
      value: revenue.value,
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
          console.error(`[lst-s2s] ${platform.platform} pixel non-2xx: ${resp.status}`);
        }
      })
      .catch((err) => {
        // §20: failures are LOGGED, NEVER thrown, NEVER block ingestion.
        console.error(`[lst-s2s] ${platform.platform} pixel failed: ${safeErrorName(err)}`);
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
    console.error(`[lst-s2s] ${code}`);
    return { status: "failed", reason: code };
  }
}

// ---------------------------------------------------------------------------
// Postback-path click-context resolution (best effort, ClickHouse-backed)
// ---------------------------------------------------------------------------

// The inbound postback carries only a click_id — not the traffic_source / fbc /
// fbclid the outbound pixel needs. There is NO D1 click log in this repo (the
// /lc resolver emits offer_click to Firehose → the external Athena→CH pipeline,
// DEV-14), so the click context is resolved from ClickHouse: the offer_click
// row (traffic_source + session_id) from lst_events_raw, then fbc/fbclid from
// lst_sessions by session_id. HONEST RESIDUAL: this yields context ONLY when
// the CH secrets are configured AND the click has already landed in CH; absent
// either, the postback path fires no S2S (the browser-conversion path is the
// primary, CH-independent trigger). Returns null when unresolved.
export async function resolveClickContextFromCh(
  env: Env,
  clickId: string,
  opts?: { client?: ListicleChClient },
): Promise<ResolvedClickContext | null> {
  if (clickId === "") return null;
  const client = opts?.client ?? createListicleChClient(env);
  if (!client.configured) return null;
  try {
    const clickRes = await client.query<{ traffic_source: string; session_id: string; offer_id: string }>(
      "SELECT traffic_source, session_id, offer_id FROM lst_events_raw " +
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
        "SELECT fbc, fbclid FROM lst_sessions WHERE session_id = {sid} ORDER BY ver DESC LIMIT 1",
        { sid: click.session_id },
      );
      const sess = sessRes.rows[0];
      if (sess !== undefined) {
        fbc = String(sess.fbc ?? "");
        fbclid = String(sess.fbclid ?? "");
      }
    }
    return {
      click_id: clickId,
      traffic_source: String(click.traffic_source),
      fbc,
      fbclid,
      offer_id: String(click.offer_id ?? ""),
    };
  } catch (err) {
    console.error(`[lst-s2s] CH click-context lookup failed: ${safeErrorName(err)}`);
    return null;
  }
}
