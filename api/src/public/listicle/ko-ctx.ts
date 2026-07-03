// `ko_ctx` — the first-party acquisition cookie (design contract §9.4/§16).
//
// Set at listicle render ("on landing", Phase-6 serve path): captures the
// LANDING-TIME macro dims — utm_source/utm_medium/utm_content,
// traffic_source, placement, cpc, fbclid, fbc, lander_v, sub1–5, language —
// so the /lc resolver can substitute those macros server-side and the edge
// can inject them into `window.__LST_CTX` for rule evaluation (§15.4).
//
// Authored semantics (documented):
//   * MERGE, params win: a landing WITH acquisition params (re)writes those
//     dims; internal navigation (no params) PRESERVES the prior captured
//     values — the original acquisition context survives the session.
//   * traffic_source falls back to utm_source when the dedicated param is
//     absent (the common media-buy URL shape carries only utm_source).
//   * fbc: when absent as a param, derived from fbclid per the standard
//     `fb.1.<epoch-ms>.<fbclid>` format (§9.4 "fbc built from fbclid").
//   * language precedence: ?language/?lang param → site_settings
//     `site_language` → the request's Accept-Language primary tag → ""
//     (register Q8 resolution, extended with the honest landing signal).
//   * lander_v refreshes on every listicle render (it names the Version the
//     visitor last landed on; the /lc URL's lv= param stays the per-click
//     source of truth, ko_ctx is its fallback).
//   * First-party, 30 days, Path=/, SameSite=Lax, NOT HttpOnly (§15.4: the
//     cookie is part of the client-readable rule-context surface).
//
// The cookie value is encodeURIComponent(JSON) of a flat string map; every
// value is length-clamped so the cookie stays far under the 4KB budget.

export const KO_CTX_COOKIE = "ko_ctx";
export const KO_CTX_MAX_AGE_SECONDS = 30 * 24 * 3600; // 30 days
const VALUE_MAX_LENGTH = 200;

// Landing-time dims captured 1:1 from query params (§9.4).
const PARAM_DIMS = [
  "utm_source",
  "utm_medium",
  "utm_content",
  "traffic_source",
  "placement",
  "cpc",
  "fbclid",
  "fbc",
  "sub1",
  "sub2",
  "sub3",
  "sub4",
  "sub5",
] as const;

export type KoCtx = Partial<Record<(typeof PARAM_DIMS)[number], string>> & {
  lander_v?: string;
  language?: string;
};

function clamp(value: string): string {
  return value.length > VALUE_MAX_LENGTH ? value.slice(0, VALUE_MAX_LENGTH) : value;
}

// Parse a stored ko_ctx cookie value (the raw cookie string, already
// cookie-decoded by the caller or not — both accepted). Corrupt → {}.
export function parseKoCtx(raw: string | null | undefined): KoCtx {
  if (typeof raw !== "string" || raw === "") return {};
  let text = raw;
  try {
    text = decodeURIComponent(raw);
  } catch {
    // not percent-encoded — try as-is
  }
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "string" && value !== "") out[key] = clamp(value);
    }
    return out as KoCtx;
  } catch {
    return {};
  }
}

// The standard fbc format when only fbclid is known: fb.1.<epoch-ms>.<fbclid>.
export function buildFbcFromFbclid(fbclid: string, nowMs: number): string {
  return `fb.1.${nowMs}.${fbclid}`;
}

// Accept-Language primary tag ("en-US,en;q=0.9" → "en-US"). Empty on junk.
export function primaryLanguageTag(acceptLanguage: string | null | undefined): string {
  if (typeof acceptLanguage !== "string" || acceptLanguage.trim() === "") return "";
  const first = acceptLanguage.split(",")[0]?.trim() ?? "";
  const tag = first.split(";")[0]?.trim() ?? "";
  return /^[a-zA-Z]{1,8}(?:-[a-zA-Z0-9]{1,8})*$/.test(tag) ? tag : "";
}

export interface BuildKoCtxInput {
  existing: KoCtx;
  query: Readonly<Record<string, string>>;
  landerV: string;
  siteLanguage: string; // site_settings.site_language ("" when unset)
  acceptLanguage: string | null | undefined;
  nowMs: number;
}

// Merge landing params over the previously captured context (params win;
// absent params preserve prior values) and stamp lander_v + language.
export function buildKoCtx(input: BuildKoCtxInput): KoCtx {
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(input.existing)) {
    if (typeof value === "string" && value !== "") next[key] = clamp(value);
  }
  for (const dim of PARAM_DIMS) {
    const value = input.query[dim];
    if (typeof value === "string" && value !== "") next[dim] = clamp(value);
  }
  // traffic_source fallback: utm_source (only when nothing captured it yet
  // or utm_source arrived fresh without a dedicated traffic_source param).
  const freshUtmSource = input.query.utm_source;
  const freshTrafficSource = input.query.traffic_source;
  if (
    (freshTrafficSource === undefined || freshTrafficSource === "") &&
    typeof freshUtmSource === "string" &&
    freshUtmSource !== ""
  ) {
    next.traffic_source = clamp(freshUtmSource);
  }
  // fbc from fbclid when no explicit fbc was ever captured (§9.4 format).
  if ((next.fbc === undefined || next.fbc === "") && typeof next.fbclid === "string" && next.fbclid !== "") {
    next.fbc = clamp(buildFbcFromFbclid(next.fbclid, input.nowMs));
  }
  // language precedence (register Q8): param → site setting → Accept-Language.
  const langParam = input.query.language ?? input.query.lang ?? "";
  if (langParam !== "") {
    next.language = clamp(langParam);
  } else if (next.language === undefined || next.language === "") {
    const fromSite = input.siteLanguage.trim();
    next.language = clamp(
      fromSite !== "" ? fromSite : primaryLanguageTag(input.acceptLanguage),
    );
    if (next.language === "") delete next.language;
  }
  // lander_v refreshes on every render — the Version this landing served.
  if (input.landerV !== "") next.lander_v = clamp(input.landerV);
  return next as KoCtx;
}

export function serializeKoCtxCookie(ctx: KoCtx): string {
  const json = JSON.stringify(ctx);
  return `${KO_CTX_COOKIE}=${encodeURIComponent(json)}; Path=/; Max-Age=${KO_CTX_MAX_AGE_SECONDS}; SameSite=Lax`;
}
