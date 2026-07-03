// Listicles §31.8 traffic-quality stamping + request-time client/geo
// enrichment shared by the /api/lst/track ingest and the /lc resolver.
//
// Reuses the repo's existing free IVT signals (safety/ivt.ts: datacenter ASN
// + declared-bot UA) and parseDeviceOs from the homepage pipeline (import
// only — analytics/events.ts stays byte-untouched). Flags:
//   is_bot      — CF verified bot (ANY category: for ANALYTICS quality a
//                 verified crawler is still a bot, unlike ad-serving where
//                 search engines get the human page), OR paid Bot-Management
//                 score < 30, OR datacenter ASN, OR declared-bot UA.
//   is_internal — the first-party `ko_internal=1` cookie. (No office-IP
//                 allowlist exists in this repo; the cookie is the §31.8
//                 "internal cookie" arm. Documented residual: an IP
//                 allowlist can be added later without schema change.)
//   is_preview  — the event/page URL carries ?preview=1 or lives under the
//                 /preview/ route (the repo's draft-preview surface). No
//                 dedicated preview host exists.
//   traffic_quality_flag — rollup with authored precedence
//                 bot > internal > preview > clean (a bot on a preview page
//                 is 'bot': the strongest exclusion wins).
// §31.8 consumers: default A/B + revenue analytics EXCLUDE non-clean rows
// (Phase 8 CH queries); cap counters + postbacks ignore non-clean (the /lc
// resolver checks `isClean` before incrementing).

import { isDatacenterAsn, isDeclaredBotUA } from "../safety/ivt";
import { parseDeviceOs } from "./events";

// The request.cf edge fields this module consumes (typed locally — the
// workers-types IncomingRequestCfProperties is not asserted repo-wide).
export interface EdgeRequestSignals {
  country?: string;
  region?: string;
  regionCode?: string;
  city?: string;
  asn?: number;
  timezone?: string;
  verifiedBot?: boolean;
  verifiedBotCategory?: string;
  botManagement?: { score?: number; verifiedBot?: boolean };
}

export function readCfSignals(request: Request): EdgeRequestSignals {
  const cf = (request as unknown as { cf?: EdgeRequestSignals }).cf;
  return cf ?? {};
}

export interface TrafficQualityFlags {
  is_bot: boolean;
  is_internal: boolean;
  is_preview: boolean;
  traffic_quality_flag: "clean" | "bot" | "internal" | "preview";
}

function cookieHas(cookieHeader: string | null | undefined, pair: string): boolean {
  if (typeof cookieHeader !== "string" || cookieHeader.length === 0) return false;
  return cookieHeader.split(";").some((part) => part.trim() === pair);
}

// URL-shaped preview detection: ?preview=1 anywhere or a /preview/ path.
// Applied to the event's own url AND (for the track endpoint) the referer.
export function urlLooksPreview(url: string): boolean {
  if (typeof url !== "string" || url === "") return false;
  try {
    const parsed = new URL(url, "https://placeholder.invalid");
    if (parsed.searchParams.get("preview") === "1") return true;
    return parsed.pathname === "/preview" || parsed.pathname.startsWith("/preview/");
  } catch {
    return false;
  }
}

export function isBotSignals(
  cf: EdgeRequestSignals,
  userAgent: string | null | undefined,
): boolean {
  if (cf.verifiedBot === true || cf.botManagement?.verifiedBot === true) return true;
  const score = cf.botManagement?.score;
  // Cloudflare bot score: 1 (bot) .. 99 (human); <30 = likely automation.
  // Present only with the paid add-on (else 0/undefined — ignored).
  if (typeof score === "number" && score > 0 && score < 30) return true;
  if (isDatacenterAsn(cf.asn)) return true;
  if (isDeclaredBotUA(userAgent)) return true;
  // parseDeviceOs's own bot heuristic (headless etc.) as the last free signal.
  if (typeof userAgent === "string" && parseDeviceOs(userAgent).device === "bot") return true;
  return false;
}

export function computeTrafficQuality(input: {
  cf: EdgeRequestSignals;
  userAgent: string | null | undefined;
  cookieHeader: string | null | undefined;
  urls: ReadonlyArray<string>;
}): TrafficQualityFlags {
  const is_bot = isBotSignals(input.cf, input.userAgent);
  const is_internal = cookieHas(input.cookieHeader, "ko_internal=1");
  const is_preview = input.urls.some((u) => urlLooksPreview(u));
  const traffic_quality_flag = is_bot
    ? "bot"
    : is_internal
      ? "internal"
      : is_preview
        ? "preview"
        : "clean";
  return { is_bot, is_internal, is_preview, traffic_quality_flag };
}

// ---------------------------------------------------------------------------
// Browser / version parsing (§9.4 request-time macros: os_version, browser,
// browser_version). parseDeviceOs (reused) covers device+os family only, so
// the version/browser split is authored here: coarse, order-sensitive UA
// regexes (Edge before Chrome, Chrome before Safari — engine-token overlap),
// deterministic "other"/"" fallbacks. Values feed macros + event columns.
// ---------------------------------------------------------------------------

export interface ClientUaDetails {
  device: string;
  os: string;
  os_version: string;
  browser: string;
  browser_version: string;
}

function firstMatch(ua: string, re: RegExp): string {
  const m = ua.match(re);
  return m?.[1] ?? "";
}

export function parseClientUa(userAgent: string | null | undefined): ClientUaDetails {
  const ua = typeof userAgent === "string" ? userAgent : "";
  const { device, os } = parseDeviceOs(ua);

  let os_version = "";
  if (os === "ios") {
    os_version = firstMatch(ua, /OS (\d+[_.]\d+(?:[_.]\d+)?) like Mac OS X/i).replace(/_/g, ".");
  } else if (os === "android") {
    os_version = firstMatch(ua, /Android (\d+(?:\.\d+)*)/i);
  } else if (os === "windows") {
    os_version = firstMatch(ua, /Windows NT (\d+(?:\.\d+)*)/i);
  } else if (os === "macos") {
    os_version = firstMatch(ua, /Mac OS X (\d+[_.]\d+(?:[_.]\d+)?)/i).replace(/_/g, ".");
  }

  let browser = "other";
  let browser_version = "";
  if (/edg(?:e|a|ios)?\//i.test(ua)) {
    browser = "edge";
    browser_version = firstMatch(ua, /edg(?:e|a|ios)?\/(\d+(?:\.\d+)*)/i);
  } else if (/opr\/|opera/i.test(ua)) {
    browser = "opera";
    browser_version = firstMatch(ua, /(?:opr|opera)[/ ](\d+(?:\.\d+)*)/i);
  } else if (/samsungbrowser\//i.test(ua)) {
    browser = "samsung";
    browser_version = firstMatch(ua, /samsungbrowser\/(\d+(?:\.\d+)*)/i);
  } else if (/firefox\/|fxios\//i.test(ua)) {
    browser = "firefox";
    browser_version = firstMatch(ua, /(?:firefox|fxios)\/(\d+(?:\.\d+)*)/i);
  } else if (/crios\/|chrome\/|chromium\//i.test(ua)) {
    browser = "chrome";
    browser_version = firstMatch(ua, /(?:crios|chrome|chromium)\/(\d+(?:\.\d+)*)/i);
  } else if (/safari\//i.test(ua) && /version\//i.test(ua)) {
    browser = "safari";
    browser_version = firstMatch(ua, /version\/(\d+(?:\.\d+)*)/i);
  }

  return { device, os, os_version, browser, browser_version };
}

// Geo columns from the edge signals. state prefers the ISO regionCode (what
// rules like state=CA target), falling back to the region display name.
export function geoFromCf(cf: EdgeRequestSignals): {
  country: string;
  state: string;
  city: string;
} {
  return {
    country: typeof cf.country === "string" ? cf.country : "",
    state:
      typeof cf.regionCode === "string" && cf.regionCode !== ""
        ? cf.regionCode
        : typeof cf.region === "string"
          ? cf.region
          : "",
    city: typeof cf.city === "string" ? cf.city : "",
  };
}

// Local hour (0-23) in an IANA timezone — the rules `hour`/`daypart` axis.
// DEV register Q13: the daypart basis is the SITE timezone (site_settings
// `site_timezone`), resolved by the serve path; invalid/absent tz → UTC.
export function hourInTimezone(tz: string, at: Date): number {
  try {
    const formatted = new Intl.DateTimeFormat("en-US", {
      timeZone: tz === "" ? "UTC" : tz,
      hour: "numeric",
      hourCycle: "h23",
    }).format(at);
    const hour = parseInt(formatted, 10);
    if (Number.isFinite(hour) && hour >= 0 && hour <= 23) return hour;
  } catch {
    // invalid tz → UTC below
  }
  return at.getUTCHours();
}

// 'YYYY-MM-DD' in an IANA timezone — the §9.3 cap_date key basis (the
// Offer's cap_timezone). Invalid/absent tz → UTC (documented fail-safe).
export function dateInTimezone(tz: string, at: Date): string {
  try {
    // en-CA formats as YYYY-MM-DD.
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: tz === "" ? "UTC" : tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(at);
  } catch {
    return at.toISOString().slice(0, 10);
  }
}
