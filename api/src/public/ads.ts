// T22: The ads subsystem — config, gating, the provider head script, the
// lazy-load AdManager client JS, the design-doc slot dimensions, and the
// ads.txt resolver.
//
// Everything here except `loadAdsConfig` is a pure function of an AdsConfig
// (no DB/IO), so the render path loads the config once (loadAdsConfig reads
// the per-site key/value rows from site_settings) and threads it into the
// public templates + the layout <head>.
//
// Ad config keys on site_settings (per-site, site_id-scoped):
//   ads_enabled            "1"/"true"            master on/off
//   ad_provider            "adsense" | "none"    network
//   adsense_publisher_id   "ca-pub-XXXXXXXX"     AdSense client id
//   ad_unit_leaderboard    unit id               970×90 slot
//   ad_unit_in_feed        unit id               728×90 slot
//   ad_unit_rect           unit id               300×250 slot
//   ad_in_content_position integer (paragraph)   in-content slot anchor
//   ad_lazy_load           "1"/"true"            IntersectionObserver lazy
//   ad_lazy_load_margin    e.g. "200px"          observer rootMargin
//   ad_disable_logged_in   "1"/"true"            hide ads for signed-in users
//   ad_excluded_pages      newline/comma paths   pages that never show ads
//   ads_txt                full ads.txt body     /ads.txt override

import { ADS_TXT_DEFAULT } from "./sitemap";

export type AdProvider = "adsense" | "none";
export type AdSlotType = "leaderboard" | "in-feed" | "rect";

export interface AdSlotDimensions {
  width: number;
  height: number;
}

// Design-doc slot dimensions (docs/design-contract.md): the home leaderboard
// (§5), the home in-feed unit (§9), and the article sidebar rectangle (§11).
export const AD_SLOT_DIMENSIONS: Readonly<Record<AdSlotType, AdSlotDimensions>> = {
  leaderboard: { width: 970, height: 90 },
  "in-feed": { width: 728, height: 90 },
  rect: { width: 300, height: 250 },
};

export const AD_IN_CONTENT_POSITION_DEFAULT = 3;
export const AD_LAZY_LOAD_MARGIN_DEFAULT = "200px";

export interface AdsConfig {
  enabled: boolean;
  provider: AdProvider;
  adsensePublisherId: string | null;
  slotUnitIds: Readonly<Record<AdSlotType, string | null>>;
  inContentPosition: number;
  lazyLoad: boolean;
  lazyLoadMargin: string;
  disableForLoggedIn: boolean;
  excludedPages: ReadonlyArray<string>;
  adsTxt: string | null;
}

export interface AdsPageContext {
  path?: string;
  loggedIn?: boolean;
}

function escAttr(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// AdSense client / unit ids are operator-set; they only ever contain
// [A-Za-z0-9_-] (e.g. ca-pub-1234567890123456). Strip anything else so a
// hostile value can never break out of the URL query / HTML attribute.
function sanitiseAdId(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw.replace(/[^A-Za-z0-9_-]/g, "").trim();
  return cleaned.length > 0 ? cleaned : null;
}

function parseBool(raw: string | undefined, fallback = false): boolean {
  if (raw === undefined) return fallback;
  const v = raw.trim().toLowerCase();
  if (v === "1" || v === "true" || v === "yes" || v === "on") return true;
  if (v === "0" || v === "false" || v === "no" || v === "off" || v === "") {
    return false;
  }
  return fallback;
}

// `??`-style numeric parse (L-002: never `|| <number>`, which treats 0 as
// falsy). A blank / non-finite / negative value falls back to the default.
function parseIntOr(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const n = Number.parseInt(raw.trim(), 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

// Normalise a path for excluded-page matching: trim, ensure a single leading
// slash, drop a trailing slash (except for the bare root).
function normalisePath(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  let p = raw.trim();
  if (p.length === 0) return null;
  if (p[0] !== "/") p = `/${p}`;
  if (p.length > 1 && p.endsWith("/")) p = p.replace(/\/+$/, "");
  return p;
}

function parseExcludedPages(raw: string | undefined): string[] {
  if (raw === undefined || raw.length === 0) return [];
  const out: string[] = [];
  for (const part of raw.split(/[\n,]+/)) {
    const norm = normalisePath(part);
    if (norm !== null && !out.includes(norm)) out.push(norm);
  }
  return out;
}

export function parseAdsConfig(
  settings: Readonly<Record<string, string | undefined>>,
): AdsConfig {
  const providerRaw = (settings.ad_provider ?? "").trim().toLowerCase();
  const provider: AdProvider = providerRaw === "adsense" ? "adsense" : "none";
  return {
    enabled: parseBool(settings.ads_enabled, false),
    provider,
    adsensePublisherId: sanitiseAdId(settings.adsense_publisher_id),
    slotUnitIds: {
      leaderboard: sanitiseAdId(settings.ad_unit_leaderboard),
      "in-feed": sanitiseAdId(settings.ad_unit_in_feed),
      rect: sanitiseAdId(settings.ad_unit_rect),
    },
    inContentPosition: parseIntOr(
      settings.ad_in_content_position,
      AD_IN_CONTENT_POSITION_DEFAULT,
    ),
    lazyLoad: parseBool(settings.ad_lazy_load, true),
    lazyLoadMargin:
      settings.ad_lazy_load_margin !== undefined &&
      settings.ad_lazy_load_margin.trim().length > 0
        ? settings.ad_lazy_load_margin.trim()
        : AD_LAZY_LOAD_MARGIN_DEFAULT,
    disableForLoggedIn: parseBool(settings.ad_disable_logged_in, false),
    excludedPages: parseExcludedPages(settings.ad_excluded_pages),
    adsTxt:
      settings.ads_txt !== undefined && settings.ads_txt.length > 0
        ? settings.ads_txt
        : null,
  };
}

// Per-site loader: read every site_settings row for the tenant and parse the
// ad config from it. Mirrors fetchPublicLayoutSiteInfo's read shape so the
// tenant-scoping grep stays accurate (`WHERE site_id = ?`).
export async function loadAdsConfig(
  db: D1Database,
  siteId: string,
): Promise<AdsConfig> {
  const result = await db
    .prepare("SELECT key AS key, value AS value FROM site_settings WHERE site_id = ?")
    .bind(siteId)
    .all<{ key: string; value: string | null }>();
  const settings: Record<string, string> = {};
  for (const row of result.results ?? []) {
    if (typeof row.value === "string") settings[row.key] = row.value;
  }
  return parseAdsConfig(settings);
}

// AdSense is "live" only when the network is selected AND a publisher id is
// present. Anything short of that yields NO provider script and NO <ins> —
// never a silent placeholder that the AdSense loader would reject.
export function hasAdsense(config: AdsConfig): boolean {
  return (
    config.provider === "adsense" &&
    config.adsensePublisherId !== null &&
    config.adsensePublisherId.length > 0
  );
}

// Whether ads should render on THIS page. Off when disabled / no provider,
// excluded for signed-in users (when disable-for-logged-in is set), and
// excluded on any operator-listed page path.
export function shouldShowAds(config: AdsConfig, ctx: AdsPageContext = {}): boolean {
  if (!config.enabled) return false;
  if (!hasAdsense(config)) return false;
  if (ctx.loggedIn === true && config.disableForLoggedIn) return false;
  const path = normalisePath(ctx.path);
  if (path !== null && config.excludedPages.includes(path)) return false;
  return true;
}

// The provider <head> script. AdSense loads its library async + crossorigin,
// keyed to the publisher client id. Empty string when AdSense is not live.
export function renderAdProviderHead(config: AdsConfig): string {
  if (!hasAdsense(config)) return "";
  const client = escAttr(config.adsensePublisherId as string);
  return (
    `<script async ` +
    `src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${client}" ` +
    `crossorigin="anonymous"></script>`
  );
}

// The AdSense <ins> unit that fills a slot container. Carries the publisher
// client id + the per-slot unit id at the design dimensions. Empty string
// when AdSense is not live (the slot container then renders as a reserved
// placeholder only).
export function renderAdSenseUnit(config: AdsConfig, type: AdSlotType): string {
  if (!hasAdsense(config)) return "";
  const dims = AD_SLOT_DIMENSIONS[type];
  const client = escAttr(config.adsensePublisherId as string);
  const unit = config.slotUnitIds[type];
  const slotAttr = unit !== null ? ` data-ad-slot="${escAttr(unit)}"` : "";
  return (
    `<ins class="adsbygoogle" ` +
    `style="display:inline-block;width:${dims.width}px;height:${dims.height}px" ` +
    `data-ad-client="${client}"${slotAttr}></ins>`
  );
}

// The AdManager client JS, emitted in the <head>. ES5-only (L-014): no arrow
// functions, template literals, const/let. It defers until the DOM is ready,
// then either lazy-loads each `.ad-slot` via IntersectionObserver (rootMargin
// = ad_lazy_load_margin, with an immediate-fill fallback when IO is absent) or
// fills every slot immediately when lazy-load is off. Filling pushes the
// AdSense queue: (window.adsbygoogle = window.adsbygoogle || []).push({}).
export function renderAdManagerScript(config: AdsConfig): string {
  if (!hasAdsense(config)) return "";
  const margin = config.lazyLoadMargin.replace(/[^0-9a-z%.\s-]/gi, "");
  const fill =
    "function fill(el){" +
    "if(!el||el.getAttribute('data-ad-filled')==='1'){return;}" +
    "el.setAttribute('data-ad-filled','1');" +
    "try{(window.adsbygoogle=window.adsbygoogle||[]).push({});}catch(e){}" +
    "}";
  const run = config.lazyLoad
    ? "if(typeof window.IntersectionObserver==='function'){" +
      "var io=new IntersectionObserver(function(entries){" +
      "for(var i=0;i<entries.length;i++){" +
      "if(entries[i].isIntersecting){fill(entries[i].target);io.unobserve(entries[i].target);}" +
      "}" +
      "},{rootMargin:'" +
      margin +
      "'});" +
      "for(var j=0;j<slots.length;j++){io.observe(slots[j]);}" +
      "}else{for(var k=0;k<slots.length;k++){fill(slots[k]);}}"
    : "for(var m=0;m<slots.length;m++){fill(slots[m]);}";
  const body =
    "(function(){" +
    fill +
    "function boot(){" +
    "var slots=document.querySelectorAll('.ad-slot[data-ad-type]');" +
    "if(!slots||!slots.length){return;}" +
    run +
    "}" +
    "if(document.readyState!=='loading'){boot();}" +
    "else{document.addEventListener('DOMContentLoaded',boot);}" +
    "})();";
  return `<script>${body}</script>`;
}

// /ads.txt body resolution: an operator override (the ads_txt site setting,
// or AdsConfig.adsTxt) wins; otherwise the documented default placeholder.
export function resolveAdsTxt(args: {
  override?: string | null;
  config?: AdsConfig;
}): string {
  const candidate =
    args.override !== undefined && args.override !== null && args.override.length > 0
      ? args.override
      : args.config?.adsTxt ?? null;
  return candidate !== null && candidate.length > 0 ? candidate : ADS_TXT_DEFAULT;
}
