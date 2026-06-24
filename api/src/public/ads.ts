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
//   ads_txt_content        full ads.txt body     /ads.txt override (T27)

import { ADS_TXT_DEFAULT } from "./sitemap";

export type AdProvider = "adsense" | "gam" | "none";
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
// Ad auto-refresh (Google Ad Manager only; AdSense has no refresh API). 0 = off.
// GAM viewability policy requires >=30s between refreshes, so a non-zero value
// is clamped up to the floor.
export const AD_REFRESH_SECONDS_DEFAULT = 0;
export const AD_REFRESH_SECONDS_MIN = 30;

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
  // Google Ad Manager (GPT) — serves a direct Ad Exchange / GAM account. The
  // per-slot units are GAM ad-unit names (or full /NETWORK/unit paths).
  gamNetworkCode: string | null;
  gamSlotUnits: Readonly<Record<AdSlotType, string | null>>;
  stickyEnabled: boolean;
  gamStickyUnit: string | null;
  refreshSeconds: number;
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

// GAM ad-unit paths are /NETWORK_CODE/unit_name (slashes + dots allowed) on top
// of [A-Za-z0-9_-]. Strip anything else so a hostile value can never break out
// of the JS string / HTML attribute it is interpolated into.
function sanitiseGamUnit(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw.replace(/[^A-Za-z0-9_./-]/g, "").trim();
  return cleaned.length > 0 ? cleaned : null;
}

// Resolve a configured GAM unit to its full ad-unit path. An operator may enter
// either a full path ("/23456789/home_leaderboard") or just the unit name
// ("home_leaderboard"), in which case the network code is prepended.
export function gamUnitPath(config: AdsConfig, unit: string): string {
  if (unit.startsWith("/")) return unit;
  const net = config.gamNetworkCode ?? "";
  return net.length > 0 ? `/${net}/${unit}` : unit;
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

// Auto-refresh seconds: 0 = off; any positive value is clamped UP to the GAM
// viewability floor (you cannot refresh a slot faster than the policy allows).
function parseRefreshSeconds(raw: string | undefined): number {
  const n = parseIntOr(raw, AD_REFRESH_SECONDS_DEFAULT);
  if (n <= 0) return 0;
  return n < AD_REFRESH_SECONDS_MIN ? AD_REFRESH_SECONDS_MIN : n;
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
  const provider: AdProvider =
    providerRaw === "adsense"
      ? "adsense"
      : providerRaw === "gam"
        ? "gam"
        : "none";
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
    gamNetworkCode: sanitiseAdId(settings.gam_network_code),
    gamSlotUnits: {
      leaderboard: sanitiseGamUnit(settings.gam_unit_leaderboard),
      "in-feed": sanitiseGamUnit(settings.gam_unit_in_feed),
      rect: sanitiseGamUnit(settings.gam_unit_rect),
    },
    stickyEnabled: parseBool(settings.ad_sticky_enabled, false),
    gamStickyUnit: sanitiseGamUnit(settings.gam_unit_anchor),
    refreshSeconds: parseRefreshSeconds(settings.ad_refresh_seconds),
    adsTxt:
      settings.ads_txt_content !== undefined &&
      settings.ads_txt_content.length > 0
        ? settings.ads_txt_content
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

// Google Ad Manager (GPT) is "live" when the network is selected AND a network
// code is present. Per-slot units are optional (a slot with no unit renders a
// reserved placeholder; the anchor is separate).
export function hasGam(config: AdsConfig): boolean {
  return (
    config.provider === "gam" &&
    config.gamNetworkCode !== null &&
    config.gamNetworkCode.length > 0
  );
}

// Any live ad provider (AdSense OR Google Ad Manager).
export function hasAnyAds(config: AdsConfig): boolean {
  return hasAdsense(config) || hasGam(config);
}

// Whether ads should render on THIS page. Off when disabled / no provider,
// excluded for signed-in users (when disable-for-logged-in is set), and
// excluded on any operator-listed page path.
// An excluded entry matches the path EXACTLY or as a path prefix (so listing
// "/category" also excludes "/category/jobs"). The bare root "/" only matches
// the root exactly (never treated as a prefix of every page).
export function isExcluded(path: string, excluded: ReadonlyArray<string>): boolean {
  for (const entry of excluded) {
    if (path === entry) return true;
    if (entry !== "/" && path.startsWith(entry + "/")) return true;
  }
  return false;
}

export function shouldShowAds(config: AdsConfig, ctx: AdsPageContext = {}): boolean {
  if (!config.enabled) return false;
  if (!hasAnyAds(config)) return false;
  if (ctx.loggedIn === true && config.disableForLoggedIn) return false;
  const path = normalisePath(ctx.path);
  if (path !== null && isExcluded(path, config.excludedPages)) return false;
  return true;
}

// The provider <head> script. AdSense loads its library async + crossorigin,
// keyed to the publisher client id. Empty string when AdSense is not live.
export function renderAdProviderHead(config: AdsConfig): string {
  if (hasGam(config)) {
    // Google Publisher Tag (GPT) loader for a direct GAM / Ad Exchange account.
    return (
      `<script async ` +
      `src="https://securepubads.g.doubleclick.net/tag/js/gpt.js" ` +
      `crossorigin="anonymous"></script>` +
      `<script>window.googletag=window.googletag||{cmd:[]};</script>`
    );
  }
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

// The GAM (GPT) slot div a container fills: the resolved ad-unit path + design
// dims. The AdManager script defines + displays it by querying .gpt-slot. Empty
// string when GAM is not live OR no unit is configured for this slot (the
// container then renders a reserved placeholder only — never a broken slot).
export function renderGamSlot(config: AdsConfig, type: AdSlotType): string {
  if (!hasGam(config)) return "";
  const unit = config.gamSlotUnits[type];
  if (unit === null) return "";
  const dims = AD_SLOT_DIMENSIONS[type];
  const path = escAttr(gamUnitPath(config, unit));
  return (
    `<div class="gpt-slot" data-gpt-unit="${path}" ` +
    `data-gpt-w="${dims.width}" data-gpt-h="${dims.height}" ` +
    `style="display:inline-block;width:${dims.width}px;height:${dims.height}px"></div>`
  );
}

// Provider-agnostic slot unit: the AdSense <ins> or the GAM <div>, whichever
// provider is live. The public slot container calls this so it never needs to
// know the provider.
export function renderAdUnit(config: AdsConfig, type: AdSlotType): string {
  if (hasGam(config)) return renderGamSlot(config, type);
  if (hasAdsense(config)) return renderAdSenseUnit(config, type);
  return "";
}

// The AdManager client JS, emitted in the <head>. ES5-only (L-014): no arrow
// functions, template literals, const/let. It defers until the DOM is ready,
// then either lazy-loads each `.ad-slot` via IntersectionObserver (rootMargin
// = ad_lazy_load_margin, with an immediate-fill fallback when IO is absent) or
// fills every slot immediately when lazy-load is off. Filling pushes the
// AdSense queue: (window.adsbygoogle = window.adsbygoogle || []).push({}).
export function renderAdManagerScript(config: AdsConfig): string {
  if (hasGam(config)) return renderGamManagerScript(config);
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

// The GAM (GPT) client script, emitted in <head>. ES5-only (L-014): no arrow
// functions, template literals, or const/let. It waits for DOM-ready (so the
// .gpt-slot divs exist) AND for gpt.js (via googletag.cmd), then defines every
// slot single-request, optionally enables GAM native lazy-load, optionally
// defines a dismissible BOTTOM_ANCHOR sticky slot, displays everything, and
// optionally refreshes all slots on a timer (>=30s, the viewability floor).
function renderGamManagerScript(config: AdsConfig): string {
  // Compose the optional blocks SERVER-side so disabled features are omitted
  // from the emitted script entirely (no dead `if(false)` code shipped).
  const anchorBlock =
    config.stickyEnabled && config.gamStickyUnit !== null
      ? "try{var a=g.defineOutOfPageSlot('" +
        gamUnitPath(config, config.gamStickyUnit) +
        "',g.enums.OutOfPageFormat.BOTTOM_ANCHOR);if(a){a.addService(g.pubads());defined.push(a);}}catch(e){}"
      : "";
  const lazyBlock = config.lazyLoad
    ? "g.pubads().enableLazyLoad({fetchMarginPercent:100,renderMarginPercent:50,mobileScaling:2.0});"
    : "";
  const refreshBlock =
    config.refreshSeconds > 0
      ? "var rs=" +
        String(config.refreshSeconds) +
        ";if(defined.length){window.setInterval(function(){try{g.pubads().refresh(defined);}catch(e){}},rs*1000);}"
      : "";
  const body =
    "(function(){" +
    "var g=window.googletag=window.googletag||{cmd:[]};" +
    "function boot(){g.cmd.push(function(){" +
    "var defined=[];" +
    "var nodes=document.querySelectorAll('.gpt-slot[data-gpt-unit]');" +
    "for(var i=0;i<nodes.length;i++){" +
    "var el=nodes[i];" +
    "if(el.getAttribute('data-gpt-defined')==='1'){continue;}" +
    "el.setAttribute('data-gpt-defined','1');" +
    "var id='div-gpt-ad-'+i;el.id=id;" +
    "var w=parseInt(el.getAttribute('data-gpt-w'),10)||0;" +
    "var h=parseInt(el.getAttribute('data-gpt-h'),10)||0;" +
    "var unit=el.getAttribute('data-gpt-unit');" +
    "var slot=g.defineSlot(unit,[[w,h]],id);" +
    "if(slot){slot.addService(g.pubads());defined.push(slot);}" +
    "}" +
    anchorBlock +
    "g.pubads().enableSingleRequest();" +
    lazyBlock +
    "g.enableServices();" +
    "for(var d=0;d<defined.length;d++){g.display(defined[d]);}" +
    refreshBlock +
    "});}" +
    "if(document.readyState!=='loading'){boot();}else{document.addEventListener('DOMContentLoaded',boot);}" +
    "})();";
  return `<script>${body}</script>`;
}

// /ads.txt body resolution: an operator override (the ads_txt_content site
// setting, or AdsConfig.adsTxt) wins; otherwise the documented default placeholder.
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
