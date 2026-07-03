// GET /lc/:offer_public_id — the first-party click resolver (design
// contract §7.3 pseudo-code implemented faithfully, + §9.3 real-time caps,
// §9.4 macro resolution, §16 offer_click emission, §24 fail-safety,
// §30.7 link-instance dims, §31.8 quality gating, §31.9 pv passthrough).
//
// Flow (§7.3, verbatim order):
//   resolveDestination(depth):
//     depth > 1                → "/"            (HARD loop guard: ONE hop)
//     offer unknown/paused/…   → "/"            (fail-safe, never 500)
//     cap reached              → fallback OFFER re-resolved ONCE
//                                → else SAFE fallback URL → else "/"
//     read ctx (ko_sid + ko_ctx + CF geo/ua) · mint click_id
//     cap_count_by='clicks'    → atomic counter increment BEFORE redirect
//                                (skipped for non-clean traffic, §31.8)
//     resolve macros           → provider URL
//     emit offer_click         → ctx.waitUntil (full §16 dimension set;
//                                enrichment lookups run post-redirect)
//   302 → destination; Cache-Control: private, no-store (§7.2/§24).
//
// No open redirect (§24): the ONLY absolute destinations are (a) the
// validated offer_url_template of a KNOWN ACTIVE offer (post-substitution
// re-parsed; non-http(s) → "/") and (b) a cap_fallback_url that passes the
// same http(s)-or-local-path gate. Everything else 302s to "/".

import type { Env } from "../../env";
import { resolveMacros } from "../../listicles/macros";
import { readCookie, genSessionId } from "./experiment-pick";
import { parseKoCtx, KO_CTX_COOKIE, type KoCtx } from "./ko-ctx";
import {
  blankListicleEvent,
  emitListicleRecords,
  type ListicleEvent,
} from "../../analytics/listicle-events";
import {
  readCfSignals,
  parseClientUa,
  geoFromCf,
  computeTrafficQuality,
  dateInTimezone,
  type TrafficQualityFlags,
} from "../../analytics/listicle-quality";
import { bumpListicleDailyAcceptCounter } from "../../analytics/listicle-reconciliation";

// The /lc handler needs no site context (Offers are GLOBAL) — a minimal
// STRUCTURAL view of the Hono context (any router's Context satisfies it,
// whatever its Variables), so the route registers host-independently.
export interface LcContext {
  env: Env;
  executionCtx: ExecutionContext;
  req: {
    param(name: string): string | undefined;
    query(): Record<string, string>;
    header(name: string): string | undefined;
    url: string;
    raw: Request;
  };
}

const MAX_FALLBACK_DEPTH = 1; // §7.3: at most ONE fallback hop

// ---------------------------------------------------------------------------
// Offer row (+ the fallback offer's public id resolved in the same query)
// ---------------------------------------------------------------------------

interface ActiveOfferRow {
  id: number;
  public_id: string;
  offer_name: string;
  offer_url_template: string;
  cap_enabled: number;
  cap_amount: number | null;
  cap_timezone: string | null;
  cap_count_by: string | null;
  cap_fallback_url: string | null;
  cap_fallback_public_id: string | null;
}

export async function getActiveOfferByPublicId(
  db: D1Database,
  offerPublicId: string,
): Promise<ActiveOfferRow | null> {
  if (offerPublicId === "") return null;
  const row = await db
    .prepare(
      `SELECT o.id, o.public_id, o.offer_name, o.offer_url_template,
              o.cap_enabled, o.cap_amount, o.cap_timezone, o.cap_count_by,
              o.cap_fallback_url, fb.public_id AS cap_fallback_public_id
       FROM listicle_offers o
       LEFT JOIN listicle_offers fb ON fb.id = o.cap_fallback_offer_id
       WHERE o.public_id = ? AND o.status = 'active' LIMIT 1`,
    )
    .bind(offerPublicId)
    .first<ActiveOfferRow>();
  return row ?? null;
}

// ---------------------------------------------------------------------------
// §9.3 cap counters — read + atomic increment on listicle_offer_cap_counters
// keyed (offer_id, cap_date in the offer's cap_timezone)
// ---------------------------------------------------------------------------

export async function isCapReached(
  db: D1Database,
  offer: ActiveOfferRow,
  now: Date,
): Promise<boolean> {
  if (offer.cap_enabled !== 1) return false;
  const capAmount = offer.cap_amount;
  if (typeof capAmount !== "number" || capAmount <= 0) return false;
  const capDate = dateInTimezone(offer.cap_timezone ?? "", now);
  const row = await db
    .prepare(
      "SELECT click_count, conversion_count FROM listicle_offer_cap_counters WHERE offer_id = ? AND cap_date = ?",
    )
    .bind(offer.id, capDate)
    .first<{ click_count: number; conversion_count: number }>();
  if (row === null) return false;
  const count = offer.cap_count_by === "conversions" ? row.conversion_count : row.click_count;
  return count >= capAmount;
}

// Atomic upsert (§9.3 baseline: D1 `UPDATE … click_count = click_count + 1`
// as a single conflict-clause statement — no read-modify-write race).
export async function bumpCapClicks(
  db: D1Database,
  offer: ActiveOfferRow,
  now: Date,
): Promise<void> {
  const tz = offer.cap_timezone ?? "";
  const capDate = dateInTimezone(tz, now);
  await db
    .prepare(
      `INSERT INTO listicle_offer_cap_counters (offer_id, cap_date, timezone, click_count, conversion_count, updated_at)
       VALUES (?, ?, ?, 1, 0, unixepoch())
       ON CONFLICT(offer_id, cap_date)
       DO UPDATE SET click_count = click_count + 1, updated_at = unixepoch()`,
    )
    .bind(offer.id, capDate, tz === "" ? "UTC" : tz)
    .run();
}

// ---------------------------------------------------------------------------
// §24 fallback-URL gate: absolute http(s) OR a local path — never
// javascript:/data:/protocol-relative.
// ---------------------------------------------------------------------------

export function safeFallbackUrl(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const url = raw.trim();
  if (url === "") return null;
  // A local path with NO control char (a C0 char would throw when it reaches
  // the 302 Location header — MINOR-1). WHATWG has no path to normalize a
  // bare path through, so reject control chars here explicitly.
  if (url.startsWith("/") && !url.startsWith("//")) {
    return /[\u0000-\u001f\u007f]/.test(url) ? null : url;
  }
  if (!/^https?:\/\//i.test(url)) return null;
  try {
    const parsed = new URL(url);
    // Return the NORMALIZED href (parsed.href) — WHATWG strips C0 control
    // chars, so the returned value is always Header-safe (MINOR-1). Returning
    // the raw string would let a `\n`/`\r` reach the Location header and 500.
    if (parsed.protocol === "http:" || parsed.protocol === "https:") return parsed.href;
  } catch {
    // fall through
  }
  return null;
}

// ---------------------------------------------------------------------------
// §9.4 macro value assembly
// ---------------------------------------------------------------------------

interface ClickRequestContext {
  sid: string;
  koCtx: KoCtx;
  ua: string;
  ip: string;
  uaDetails: ReturnType<typeof parseClientUa>;
  geo: { country: string; state: string; city: string };
  requestUrl: string;
  referer: string;
  quality: TrafficQualityFlags;
}

function readClickContext(c: LcContext): ClickRequestContext {
  const cookieHeader = c.req.header("Cookie") ?? null;
  const cf = readCfSignals(c.req.raw);
  const ua = c.req.header("user-agent") ?? "";
  const requestUrl = c.req.url;
  const referer = c.req.header("referer") ?? "";
  return {
    sid: readCookie(cookieHeader, "ko_sid"),
    koCtx: parseKoCtx(readCookie(cookieHeader, KO_CTX_COOKIE)),
    ua,
    ip: c.req.header("cf-connecting-ip") ?? "",
    uaDetails: parseClientUa(ua),
    geo: geoFromCf(cf),
    requestUrl,
    referer,
    quality: computeTrafficQuality({
      cf,
      userAgent: ua,
      cookieHeader,
      // §31.8 preview detection on the CLICK: the /lc URL itself plus the
      // page that hosted the link (referer).
      urls: [requestUrl, referer],
    }),
  };
}

// The 32 canonical macro values (§9.4; {clickid} normalizes upstream).
// Landing-time dims come from ko_ctx; request-time dims from CF + UA.
// {url} = the full /lc request URL; {referer} = the hosting page (authored,
// documented — §9.4 lists both; the click's own URL is `url`, the listicle
// page is `referer`).
function buildMacroValues(
  ctx: ClickRequestContext,
  offer: ActiveOfferRow,
  clickId: string,
  q: Readonly<Record<string, string>>,
): Record<string, string> {
  const ko = ctx.koCtx;
  return {
    click_id: clickId,
    utm_medium: ko.utm_medium ?? "",
    utm_content: ko.utm_content ?? "",
    utm_source: ko.utm_source ?? "",
    traffic_source: ko.traffic_source ?? "",
    placement: ko.placement ?? "",
    lander_v: q.lv !== undefined && q.lv !== "" ? q.lv : (ko.lander_v ?? ""),
    offer_id: offer.public_id,
    offer_name: offer.offer_name,
    page: q.p ?? "",
    device: ctx.uaDetails.device,
    os: ctx.uaDetails.os,
    os_version: ctx.uaDetails.os_version,
    browser: ctx.uaDetails.browser,
    browser_version: ctx.uaDetails.browser_version,
    country: ctx.geo.country,
    state: ctx.geo.state,
    city: ctx.geo.city,
    ip: ctx.ip,
    ua: ctx.ua,
    sub1: ko.sub1 ?? "",
    sub2: ko.sub2 ?? "",
    sub3: ko.sub3 ?? "",
    sub4: ko.sub4 ?? "",
    sub5: ko.sub5 ?? "",
    url: ctx.requestUrl,
    referer: ctx.referer,
    language: ko.language ?? "",
    cpc: ko.cpc ?? "",
    session_id: ctx.sid,
    fbc: ko.fbc ?? "",
    fbclid: ko.fbclid ?? "",
  };
}

// ---------------------------------------------------------------------------
// §16 offer_click event
// ---------------------------------------------------------------------------

function asIntOrNull(raw: string | undefined): number | null {
  if (raw === undefined || raw === "") return null;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

// selection_reason derivation for clicks (authored, documented): the
// governed URL carries the page's selection MODE (m=) and the candidate's
// rule id (r=), not the client's live reason — so: single → single_default,
// ab_test → ab_hash, rule_based → rule_match when r= names a rule else
// fallback. This mirrors how the §15.3 selector labels the same candidate.
function deriveSelectionReason(mode: string, ruleId: string): string {
  if (mode === "single") return "single_default";
  if (mode === "ab_test") return "ab_hash";
  if (mode === "rule_based") return ruleId !== "" ? "rule_match" : "fallback";
  return "";
}

function buildClickEvent(
  ctx: ClickRequestContext,
  offer: ActiveOfferRow,
  clickId: string,
  q: Readonly<Record<string, string>>,
  now: number,
): ListicleEvent {
  const event = blankListicleEvent("offer_click", now);
  const ko = ctx.koCtx;
  event.session_id = ctx.sid;
  event.event_id = genSessionId();
  event.article_id = q.a ?? "";
  event.lander_v = q.lv ?? "";
  event.article_version_id = q.lv ?? "";
  event.article_variant_id = q.lv ?? "";
  event.page = q.p ?? "";
  event.page_index = asIntOrNull(q.p);
  event.page_selection_mode = q.m ?? "";
  event.section_id = q.s ?? "";
  event.page_candidate_id = q.c ?? "";
  event.page_rule_id = q.r ?? "";
  event.selection_reason = deriveSelectionReason(q.m ?? "", q.r ?? "");
  event.offer_id = offer.public_id;
  event.offer_name = offer.offer_name;
  event.click_id = clickId;
  // §30.7 link-instance dims from the governed URL.
  event.link_instance_id = q.lnk ?? "";
  event.section_block_id = q.blk ?? "";
  event.link_role = q.role ?? "";
  // §31.9: &pv= passes the page_view_id onto the offer_click event.
  event.page_view_id = q.pv ?? "";
  // acquisition (landing-time, ko_ctx).
  event.utm_source = ko.utm_source ?? "";
  event.utm_medium = ko.utm_medium ?? "";
  event.utm_content = ko.utm_content ?? "";
  event.traffic_source = ko.traffic_source ?? "";
  event.placement = ko.placement ?? "";
  event.cpc = ko.cpc ?? "";
  event.fbc = ko.fbc ?? "";
  event.fbclid = ko.fbclid ?? "";
  event.sub1 = ko.sub1 ?? "";
  event.sub2 = ko.sub2 ?? "";
  event.sub3 = ko.sub3 ?? "";
  event.sub4 = ko.sub4 ?? "";
  event.sub5 = ko.sub5 ?? "";
  event.language = ko.language ?? "";
  // client/geo (request-time).
  event.device = ctx.uaDetails.device;
  event.os = ctx.uaDetails.os;
  event.os_version = ctx.uaDetails.os_version;
  event.browser = ctx.uaDetails.browser;
  event.browser_version = ctx.uaDetails.browser_version;
  event.country = ctx.geo.country;
  event.state = ctx.geo.state;
  event.city = ctx.geo.city;
  event.ip = ctx.ip;
  event.ua = ctx.ua;
  event.url = ctx.requestUrl;
  event.referer = ctx.referer;
  // §31.8 flags.
  event.is_bot = ctx.quality.is_bot;
  event.is_internal = ctx.quality.is_internal;
  event.is_preview = ctx.quality.is_preview;
  event.traffic_quality_flag = ctx.quality.traffic_quality_flag;
  return event;
}

// Best-effort enrichment (runs POST-redirect inside ctx.waitUntil): resolves
// the remaining §16 dims that need D1 point lookups — article_name/site_id/
// article_url + experiment dims (via lander_v), section_name, the matched
// rule's conditions_hash + priority, the candidate's allocation, and the
// §30.7 link-instance columns. Each lookup is individually guarded; a miss
// leaves the column at its blank default (never blocks the click).
async function enrichClickEvent(db: D1Database, event: ListicleEvent): Promise<void> {
  if (event.lander_v !== "") {
    try {
      const row = await db
        .prepare(
          `SELECT v.content_version, v.variant_label, v.traffic_allocation,
                  e.public_id AS experiment_public_id,
                  a.public_id AS article_public_id, a.article_name, a.site_id, a.slug
           FROM listicle_article_versions v
           JOIN listicle_articles a ON a.id = v.article_id
           LEFT JOIN listicle_article_experiments e
             ON e.id = v.experiment_id AND e.status = 'running'
           WHERE v.public_id = ? LIMIT 1`,
        )
        .bind(event.lander_v)
        .first<{
          content_version: number;
          variant_label: string;
          traffic_allocation: number;
          experiment_public_id: string | null;
          article_public_id: string;
          article_name: string;
          site_id: string;
          slug: string;
        }>();
      if (row !== null) {
        event.article_version_revision = row.content_version;
        event.article_variant_label = row.variant_label;
        event.site_id = row.site_id;
        event.article_name = row.article_name;
        if (event.article_id === "") event.article_id = row.article_public_id;
        if (row.experiment_public_id !== null) {
          event.article_experiment_id = row.experiment_public_id;
          event.article_split_percentage = row.traffic_allocation;
        }
      }
    } catch {
      // enrichment is best-effort
    }
  }
  if (event.section_id !== "") {
    try {
      const row = await db
        .prepare("SELECT section_name FROM listicle_sections WHERE public_id = ? LIMIT 1")
        .bind(event.section_id)
        .first<{ section_name: string }>();
      if (row !== null) event.section_name = row.section_name;
    } catch {
      /* best-effort */
    }
  }
  if (event.page_rule_id !== "") {
    try {
      const row = await db
        .prepare(
          "SELECT priority, conditions_hash FROM listicle_page_rules WHERE public_id = ? LIMIT 1",
        )
        .bind(event.page_rule_id)
        .first<{ priority: number; conditions_hash: string }>();
      if (row !== null) {
        event.page_rule_priority = row.priority;
        event.matched_rule_json_hash = row.conditions_hash;
      }
    } catch {
      /* best-effort */
    }
  }
  if (event.page_candidate_id !== "") {
    try {
      const row = await db
        .prepare(
          `SELECT c.traffic_allocation, p.ab_test_id, p.rule_set_id
           FROM listicle_page_section_candidates c
           JOIN listicle_pages p ON p.id = c.page_id
           WHERE c.public_id = ? LIMIT 1`,
        )
        .bind(event.page_candidate_id)
        .first<{ traffic_allocation: number | null; ab_test_id: string | null; rule_set_id: string | null }>();
      if (row !== null) {
        if (row.traffic_allocation !== null) event.ab_split_percentage = row.traffic_allocation;
        event.ab_test_id = row.ab_test_id ?? "";
        event.page_rule_set_id = row.rule_set_id ?? "";
      }
    } catch {
      /* best-effort */
    }
  }
  if (event.link_instance_id !== "") {
    try {
      const row = await db
        .prepare(
          `SELECT position_index, button_style_id, button_group_id, anchor_text_hash, analytics_label
           FROM listicle_section_link_instances WHERE public_id = ? LIMIT 1`,
        )
        .bind(event.link_instance_id)
        .first<{
          position_index: number;
          button_style_id: string | null;
          button_group_id: string | null;
          anchor_text_hash: string | null;
          analytics_label: string | null;
        }>();
      if (row !== null) {
        event.link_position_index = row.position_index;
        event.button_style_id = row.button_style_id ?? "";
        event.button_group_id = row.button_group_id ?? "";
        event.anchor_text_hash = row.anchor_text_hash ?? "";
        event.analytics_label = row.analytics_label ?? "";
      }
    } catch {
      /* best-effort */
    }
  }
  if (event.article_url === "" && event.site_id !== "") {
    // article_url from the hosting page when the click carried a referer;
    // otherwise left "" (the Athena layer derives it from article_id).
    if (event.referer !== "") event.article_url = event.referer;
  }
}

// ---------------------------------------------------------------------------
// §7.3 resolveDestination + the route handler
// ---------------------------------------------------------------------------

export interface ResolvedDestination {
  url: string;
}

export async function resolveDestination(
  c: LcContext,
  offerPublicId: string,
  depth: number,
): Promise<ResolvedDestination> {
  if (depth > MAX_FALLBACK_DEPTH) return { url: "/" }; // loop guard: at most ONE fallback hop
  const offer = await getActiveOfferByPublicId(c.env.DB, offerPublicId);
  if (offer === null) return { url: "/" }; // unknown/paused/archived → fail safe
  const now = new Date();
  const ctx = readClickContext(c);

  if (await isCapReached(c.env.DB, offer, now)) {
    if (offer.cap_fallback_public_id !== null && offer.cap_fallback_public_id !== "") {
      // → fallback OFFER, re-resolved ONCE (depth guard above).
      return resolveDestination(c, offer.cap_fallback_public_id, depth + 1);
    }
    // → fallback URL (scheme-gated) → safe "/".
    return { url: safeFallbackUrl(offer.cap_fallback_url) ?? "/" };
  }

  const q = c.req.query();
  const clickId = crypto.randomUUID();

  // §9.3/§31.8: clicks-counted caps increment synchronously BEFORE the
  // redirect — CLEAN traffic only (cap counters ignore bot/internal/preview).
  if (offer.cap_enabled === 1 && offer.cap_count_by === "clicks" && ctx.quality.traffic_quality_flag === "clean") {
    await bumpCapClicks(c.env.DB, offer, now);
  }

  const url = resolveMacros(offer.offer_url_template, buildMacroValues(ctx, offer, clickId, q));

  // Emit offer_click with the FULL §16 dimension set (enrichment lookups run
  // in the background, after the redirect is already on the wire). The event
  // is emitted for NON-clean traffic too — flagged, so analytics can exclude
  // it while the raw audit view retains it (§31.8).
  const event = buildClickEvent(ctx, offer, clickId, q, now.getTime());
  try {
    c.executionCtx.waitUntil(
      (async () => {
        await enrichClickEvent(c.env.DB, event);
        emitListicleRecords(c.env, c.executionCtx, [event]);
        await bumpListicleDailyAcceptCounter(c.env, event.site_id, 1, now);
      })().catch(() => {
        // tracking can never break the click path
      }),
    );
  } catch {
    // executionCtx unavailable (some unit-test harnesses) — drop tracking,
    // never the redirect.
  }

  // Post-substitution safety: the template was validated absolute http(s) at
  // save; re-parse the final URL and refuse anything else (belt for legacy /
  // hand-edited rows — never an open redirect, never a javascript: sink).
  // Return parsed.href (NORMALIZED) not the raw substituted string: WHATWG
  // strips C0 control chars, so a stored template carrying a `\n`/`\r` (which
  // slips past new URL()'s protocol guard) can never reach the 302 Location
  // header and 500 the click (MINOR-1).
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return { url: "/" };
    return { url: parsed.href };
  } catch {
    return { url: "/" };
  }
}

// The route handler (§7.3): 302 + private,no-store; ANY internal failure
// fail-safes to a 302 "/" — a click is never answered with a 5xx.
export async function handleListicleClick(c: LcContext): Promise<Response> {
  let destination = "/";
  try {
    const resolved = await resolveDestination(c, c.req.param("oid") ?? "", 0);
    destination = resolved.url;
  } catch {
    destination = "/"; // fail safe, never 500 a click (§7.3/§24)
  }
  // Belt-and-braces (MINOR-1): the Headers/Response constructor THROWS on a
  // control char in the Location value. resolveDestination already returns a
  // normalized (control-char-stripped) href, but a legacy/hand-edited path or
  // a future producer must NEVER 500 a click — so the construction itself is
  // guarded and any throw fail-safes to a bare 302 "/".
  try {
    return new Response(null, {
      status: 302,
      headers: {
        Location: destination,
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return new Response(null, {
      status: 302,
      headers: { Location: "/", "Cache-Control": "private, no-store" },
    });
  }
}
