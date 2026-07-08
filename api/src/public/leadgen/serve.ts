// LeadGen §17.2 / §28 / §30.4 + fix-contract v2.4 03 §3.2 — the PUBLIC `/lg/*`
// funnel runtime shell + client-config + attempt serving (tenant hosts only).
//
// Pipeline (the listicle/serve.ts cacheable-shell mirror for funnels):
//   host→site (public middleware, siteContext) → resolveActivatedFunnel (§17.2
//   host→site→quote→funnel→assigned variant) → (missing/disabled → 404) →
//   leadgenShellKey(site,slug,funnel_id,variant_id,content_version,ab_rev,
//   activation_version) → KV/Cache-API read → cold render → write-through →
//   publicHtmlCacheHeaders (public, max-age=300, swr=86400) + strong ETag +
//   nosniff + 304.
//
// The v2.4 shell (03 §3.2 — SERVER-rendered sections + hydration; the "empty
// mount" false-comfort shell is gone, 11 §11.6):
//   (a) EVERY Section of the resolved variant is server-rendered IN ORDER via
//       the shared renderSectionComponents preset renderer (09 §9.1 — the same
//       code path as admin preview / quote preview / content_html), each in
//       <section data-lg-section data-lg-section-id data-lg-index
//       data-screen-label hidden> with the FIRST section visible — the first
//       question renders without JS (03 §3.11);
//   (b) <script type="application/json" id="lg-config"> carries the SAME
//       LeadgenPublicConfig JSON /lg/config serves (buildPublicConfig in-request
//       — variant/test-scoped, ZERO per-visitor fields, so it may ride the
//       visitor-invariant cached body; `<` is <-escaped);
//   (c) <script src="/lg/runtime/{LEADGEN_TEMPLATE_VERSION}.js" defer> — the
//       hydration engine bundle (route: 03 §3.2 runtime-routes row);
//   (d) the Maps browser key rides the MAPS_KEY_SENTINEL response splice ONLY
//       (below) when the key is configured AND an address/ZIP component with
//       Maps enabled exists in the variant.
// LEADGEN_BOOTSTRAP_JS is REPLACED by a minimal inline pre-hydration stub that
// ONLY queues [data-lg-choice]/[data-lg-continue] clicks into
// window.__LG_PREHYDRATE_QUEUE__ for the engine to replay. data-lg-mount stays;
// data-lg-ready="1" is set by the ENGINE after hydration — the shell MUST NOT
// pre-set it.
//
// CACHE DISCIPLINE (unchanged, now with the ab_rev axis): the cached body is
// deliberately VISITOR-INVARIANT — per-visitor bits ride response-stream
// sentinel splices only (Maps key §30.4; §16.3 assignment dims). The baked
// #lg-config test dims flip on an A/B start/stop/re-bump WITHOUT a
// content_version move, so the shell key + ETag now carry
// `resolved.assignment.funnel_ab_test_revision` — the same axis
// leadgenConfigKey documents (cache-keys.ts).
//
// The browser Google-Maps key (§30.2 referrer-restricted browser key) is
// injected PER-REQUEST via Stage-A resolveBrowserMapsKey and ONLY when the
// funnel has a Maps-enabled address/ZIP component — it NEVER enters the cached
// shell HTML (§30.4). The cached body carries only a sentinel comment; the key
// script is spliced onto the RESPONSE stream, mirroring the listicle
// post-cache injectListicleContext pattern (the KV entry stays
// visitor-invariant).
//
// The shell carries the funnel_id (lgf_) and funnel_variant_id (lgn_) as
// DISTINCT data attributes (contract 06 §15.1 G4 — never aliased), branded
// through the funnel.ts prefix-validating constructors.

import type { Context } from "hono";
import type { Env } from "../../env";
import { parseNumber } from "../../env";
import type { PublicSiteVariables } from "../middleware";
import { escapeHtml } from "../../editor/sanitize";
import {
  resolveActivatedFunnel,
  resolveActivatedFunnelByVariant,
  type ResolvedActivatedFunnel,
  type FunnelAssignment,
} from "./resolver";
import { buildPublicConfig, parseSectionComponents, loadAnswerMapVersions } from "./config-dto";
import { flattenComponents } from "./components/content-schema";
import { mintFunnelAttempt } from "./attempt";
import { getFunnelDesign, type FunnelDesign } from "./designs/registry";
import { funnelChromeCss, FUNNEL_DESIGN_SCOPE_ATTR } from "./designs/default-funnel/styles";
// 03 §3.2a / 09 §9.1: the ONE shared renderer — the same presets that power
// admin preview, quote preview, and persisted content_html render the live
// shell sections. Pure over (nodes, design) with a pinned en-US locale, so the
// server-rendered body stays variant-invariant under the cache-key axes.
import { renderSectionComponents } from "./components/presets";
import { toFunnelId, toFunnelVariantId } from "../../leadgen/funnel";
import { resolveBrowserMapsKey } from "../../leadgen/maps";
// §16.2 sticky assignment reads the SAME ko_sid session cookie the listicle
// runtime uses (set-if-absent, path=/, Max-Age=1800, SameSite=Lax) — reused
// verbatim so a funnel assignment is sticky per session and never a new cookie.
import { readCookie, genSessionId, sessionCookie } from "../listicle/experiment-pick";
import {
  leadgenShellKey,
  leadgenConfigKey,
  LEADGEN_TEMPLATE_VERSION,
} from "../../cache/cache-keys";
import { publicHtmlCacheHeaders } from "../../cache/cache-control";
import {
  computeEtag,
  getCachedHtml,
  putCachedHtml,
  matchesIfNoneMatch,
} from "../../cache/edge-cache";

type PublicContext = Context<{ Bindings: Env; Variables: PublicSiteVariables }>;

const DEFAULT_TTL_SECONDS = 300;

// The sentinel the cached shell carries in <head>. injectMapsKey replaces it on
// the RESPONSE only — so the Maps browser key is never part of the cached body
// / ETag material (§30.4). Absent-key funnels get the sentinel stripped.
const MAPS_KEY_SENTINEL = "<!--LG_MAPS_KEY-->";

// The sentinel the cached shell carries for the §16.3 A/B assignment. The
// NON-session assignment dims are injected on the RESPONSE only (never baked into
// the per-variant cached body). The per-SESSION `assignment_bucket` is deliberately
// NOT emitted on this `public` response (m1): the shell is a public, cacheable
// artifact and a per-session datum must not ride it. The P11 quote_view beacon
// recomputes the bucket itself from its own ko_sid + the injected non-session
// funnel_ab_test_id/revision (§16.2 edge/client parity). Mirrors the Maps-key
// sentinel discipline exactly.
const ASSIGN_SENTINEL = "<!--LG_ASSIGN-->";

// /lg/config Cache-Control (contract 03 §4.3 route map): a shared-cache
// s-maxage=1800 on top of the browser max-age=300 + swr=86400. cache-control.ts
// has no s-maxage/JSON helper (GAP reported), so this wire literal + its JSON
// content-type live here, scoped to the leadgen runtime.
const LEADGEN_CONFIG_CACHE_CONTROL =
  "public, max-age=300, s-maxage=1800, stale-while-revalidate=86400";

const NOSNIFF_HEADER = "X-Content-Type-Options";
const NOSNIFF_VALUE = "nosniff";

function leadgenConfigCacheHeaders(etag: string): Headers {
  const h = new Headers();
  h.set("Cache-Control", LEADGEN_CONFIG_CACHE_CONTROL);
  h.set("Content-Type", "application/json; charset=utf-8");
  h.set(NOSNIFF_HEADER, NOSNIFF_VALUE);
  if (etag) h.set("ETag", etag);
  return h;
}

// /lg/attempt is session-specific → no-store (§4.3 / §8.3). cache-control.ts's
// adminCacheHeaders is private,no-store BUT stamps X-Robots-Tag noindex,nofollow
// (admin semantics) — wrong for a public runtime endpoint, so a scoped no-store
// header lives here (GAP reported).
export function leadgenNoStoreHeaders(): Headers {
  const h = new Headers();
  h.set("Cache-Control", "no-store");
  h.set("Content-Type", "application/json; charset=utf-8");
  h.set(NOSNIFF_HEADER, NOSNIFF_VALUE);
  return h;
}

// ---------------------------------------------------------------------------
// ETag material — mirrors each cache key's identity so ETag changes iff the key
// would (the edge-cache.ts computeEtag invariant).
// ---------------------------------------------------------------------------

function leadgenShellEtag(
  siteId: string,
  quoteSlug: string | null,
  funnelId: string,
  funnelVariantId: string,
  contentVersion: number,
  abRev: number,
  activationVersion: number,
): Promise<string> {
  // Material mirrors leadgenShellKey (variant-scoped + ab_rev'd + activation-
  // versioned, §16.2/§28 + v2.4 03 §3.2) so the ETag changes iff the key would
  // — two assigned variants get DISTINCT ETags; an A/B start/stop/re-bump
  // (which flips the BAKED #lg-config test dims without a content_version
  // move) mints a fresh ETag; and an activation/settings edit (incl. the
  // baked-in GA4 id) does too — a returning visitor never 304-loops a stale
  // shell.
  return computeEtag({
    site_id: siteId,
    path: `/lg/${quoteSlug ?? ""}:${funnelId}:${funnelVariantId}:${abRev}:${activationVersion}`,
    content_version: contentVersion,
    template_version: LEADGEN_TEMPLATE_VERSION,
  });
}

function leadgenConfigEtag(
  siteId: string,
  funnelId: string,
  funnelVariantId: string,
  contentVersion: number,
  abRev: number,
  activationVersion: number,
): Promise<string> {
  // Material = site + funnel + variant + content_version + ab_rev + activation_version,
  // matching leadgenConfigKey so the ETag changes iff the cache key would. site_id is
  // a first-class component (the config bakes in the site-specific ga4 id), so two
  // tenant sites serving the SAME funnel/variant get DISTINCT ETags. ab_rev (the
  // running-test revision, 0 when none) makes a test start/stop/re-bump change the
  // ETag; activation_version (leadgen_site_quotes.updated_at) makes a settings-only
  // GA4-id edit change it too — a conditional GET never 304s a stale body.
  return computeEtag({
    site_id: siteId,
    path: `/lg/config/${funnelId}/${funnelVariantId}/${abRev}/${activationVersion}`,
    content_version: contentVersion,
    template_version: LEADGEN_TEMPLATE_VERSION,
  });
}

// §17.2 reverse resolution for /lg/config + /lg/attempt (variant-id → activation)
// now lives in resolver.ts (resolveActivatedFunnelByVariant, imported above) so
// all §17.2 SQL + the P8 servability/anti-leak rules stay in one module.

// ---------------------------------------------------------------------------
// Maps-key presence + per-request injection (§30.2 / §30.4)
// ---------------------------------------------------------------------------

// True when the funnel has a Maps-enabled address/ZIP component — the only
// place the browser Maps key is needed (§28 + v2.4 03 §3.2d / 08 §8.8).
// Signals, mirroring the presets' data-lg-maps emission exactly:
//   * address_validation_enabled=1 on a section (the global-checkbox compat
//     fallback — the column stays for compat, §8.8);
//   * an AddressAutocompleteQuestion component (always Maps-capable);
//   * a ZIPInputQuestion with the legacy per-node validate flag OR a
//     field-level props.maps config (§8.8 — per-field config wins).
// content_json parses through the shared parseSectionComponents (dedicated
// try/catch per the D1 JSON-parse safety rule — a corrupt blob never throws)
// and the walk runs over the §8.5 canonical flattenComponents projection so a
// Maps-enabled address/ZIP component nested inside a layout container is
// found exactly like a top-level one (flat legacy content is unchanged).
function funnelNeedsMapsKey(resolved: ResolvedActivatedFunnel): boolean {
  for (const rs of resolved.sections) {
    if (rs.section.address_validation_enabled === 1) return true;
    const raw = rs.section.content_json;
    if (typeof raw !== "string" || raw === "") continue;
    for (const c of flattenComponents(parseSectionComponents(raw))) {
      if (c === null || typeof c !== "object") continue;
      if (c.type === "AddressAutocompleteQuestion") return true;
      if (c.type === "ZIPInputQuestion") {
        const props = c.props ?? {};
        const maps = props["maps"];
        if (props["validate"] === true) return true;
        if (typeof maps === "object" && maps !== null && !Array.isArray(maps)) return true;
      }
    }
  }
  return false;
}

// A safe JS string literal for a `<script>` context: JSON quoting + `<`
// neutralized so no `</script>` / markup can be forged from the value.
function jsStringLiteral(value: string): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

// §28 GA4 pass-through — emit the site's GA4 into the shell <head> when the
// resolved activation has a ga4_measurement_id (from settings_overrides_json).
// The STANDARD non-destructive gtag snippet: the async gtag.js loader + the
// inline dataLayer/gtag bootstrap. RULES:
//   (a) `window.dataLayer = window.dataLayer || []` — an existing dataLayer (a
//       site-level GA4 tag, a §27 browser pixel) is NEVER reset;
//   (b) the id is the PER-SITE ga4_measurement_id and the shell is cached per
//       site_id (lg-shell:{site_id}:…), so baking it in is correct and can never
//       carry another tenant's id (the key is site-scoped);
//   (c) absent id ⇒ emit NOTHING;
//   (d) /lg/track is a header-only no-store beacon — it never touches
//       window.dataLayer (proven in leadgen-ga4.spec.ts).
// The measurement id is operator-authored, so it is escaped for BOTH the JS-string
// context (jsStringLiteral) and the URL/attribute context (encodeURIComponent +
// escapeHtml) — no `</script>` / markup can be forged. The shell sets no CSP, so
// no host allowlist is required; if one is ever added it MUST allow
// www.googletagmanager.com.
function ga4HeadSnippet(measurementId: string | null): string {
  if (measurementId === null) return "";
  const id = measurementId.trim();
  if (id === "") return "";
  const srcId = encodeURIComponent(id);
  return (
    `<script async src="https://www.googletagmanager.com/gtag/js?id=${escapeHtml(srcId)}"></script>` +
    "<script>window.dataLayer=window.dataLayer||[];" +
    "function gtag(){dataLayer.push(arguments);}" +
    "gtag('js',new Date());" +
    `gtag('config',${jsStringLiteral(id)});</script>`
  );
}

// Splice the per-request browser Maps key onto the RESPONSE body only. The
// `pristine` shell (the exact bytes cached + ETag'd) carries only the sentinel;
// the key global is set before the bootstrap runs. No address section OR no key
// ⇒ the sentinel is stripped (the key never appears anywhere).
function injectMapsKey(pristine: string, resolved: ResolvedActivatedFunnel, env: Env): string {
  let script = "";
  if (funnelNeedsMapsKey(resolved)) {
    const key = resolveBrowserMapsKey(env);
    if (key !== null) {
      script = `<script>window.__LG_MAPS_KEY__=${jsStringLiteral(key)};</script>`;
    }
  }
  // Function replacement (not a string): String.prototype.replace expands `$`
  // patterns ($&, $1, $`, …) in a STRING replacement, which would corrupt a
  // `$`-bearing value. A function replacement returns the script verbatim.
  return pristine.replace(MAPS_KEY_SENTINEL, () => script);
}

// Splice the NON-session §16.3 assignment dims onto the RESPONSE body only
// (per-request). window.__LG_ASSIGNMENT__ = { funnel_ab_test_id,
// funnel_ab_test_revision, variant_label, traffic_allocation_bp,
// funnel_variant_id, assignment_bucket: null, assignment_reason } — the P11
// quote_view beacon reads this. All emitted fields are TEST/VARIANT-scoped (not
// per-session); `assignment_bucket` is deliberately null even on the ab_hash path
// (m1): a per-session datum must not ride a `public` cacheable-shell response, so
// the client recomputes the §16.2 bucket from its own ko_sid + funnel_ab_test_id +
// funnel_ab_test_revision (edge/client parity). This matches the cached /lg/config
// DTO, which already omits the per-session bucket. `<` is neutralized so an
// authored variant_label can never forge </script> / markup.
function injectAssignment(
  html: string,
  assignment: FunnelAssignment,
  funnelVariantId: string,
): string {
  const json = JSON.stringify({
    funnel_ab_test_id: assignment.funnel_ab_test_id,
    funnel_ab_test_revision: assignment.funnel_ab_test_revision,
    variant_label: assignment.variant_label,
    traffic_allocation_bp: assignment.traffic_allocation_bp,
    funnel_variant_id: funnelVariantId,
    assignment_bucket: null,
    assignment_reason: assignment.assignment_reason,
  }).replace(/</g, "\\u003c");
  const script = `<script>window.__LG_ASSIGNMENT__=${json};</script>`;
  return html.replace(ASSIGN_SENTINEL, () => script);
}

// ---------------------------------------------------------------------------
// Shell render (pristine, cacheable — visitor-invariant, no secrets)
// ---------------------------------------------------------------------------

// The minimal inline PRE-HYDRATION stub (v2.4 03 §3.2 — replaces the old
// LEADGEN_BOOTSTRAP_JS): it ONLY queues clicks on [data-lg-choice] /
// [data-lg-continue] into window.__LG_PREHYDRATE_QUEUE__ so the engine
// (/lg/runtime/{version}.js, another module) can replay an eager visitor's
// first taps after it hydrates. It fetches NOTHING, renders NOTHING, and never
// touches data-lg-ready — the ENGINE fetches /lg/attempt and sets
// data-lg-ready="1" (03 §3.5). Queueing stops once the engine marks ready.
// STATIC (no interpolation) so nothing here needs escaping.
const LEADGEN_PREHYDRATE_JS =
  "(function(){var q=window.__LG_PREHYDRATE_QUEUE__=[];" +
  'document.addEventListener("click",function(e){' +
  'var t=e.target;if(!t||typeof t.closest!=="function")return;' +
  'var el=t.closest("[data-lg-choice],[data-lg-continue]");if(!el)return;' +
  'var root=document.getElementById("lg-funnel-root");' +
  'if(root&&root.getAttribute("data-lg-ready")==="1")return;' +
  "q.push({el:el,t:Date.now()});" +
  "},true);})();";

// Render the pristine funnel shell (v2.4 03 §3.2): scoped chrome CSS from the
// resolved design + EVERY Section of the resolved variant server-rendered in
// order inside the data-lg-mount (first section visible — the first question
// renders without JS, 03 §3.11), the #lg-config LeadgenPublicConfig JSON, the
// [data-lg-banners] auction mount, the pre-hydration click-queue stub, and the
// deferred hydration-engine script tag. The funnel_id (lgf_) and
// funnel_variant_id (lgn_) ride as DISTINCT data attributes (G4,
// prefix-branded). VISITOR-INVARIANT: everything here is variant/test-scoped
// (buildPublicConfig carries zero per-visitor fields; renderSectionComponents
// is pure over nodes+design with a pinned locale); per-visitor bits ride the
// sentinel splices only. No secrets; the Maps-key sentinel keeps the browser
// key out of these bytes (§30.4). data-lg-ready is NOT pre-set — the engine
// sets it after hydration.
function renderFunnelShell(
  resolved: ResolvedActivatedFunnel,
  design: FunnelDesign,
  answerMapVersions: Readonly<Record<string, string>>,
): string {
  const funnelId = toFunnelId(resolved.funnel.public_id);
  const funnelVariantId = toFunnelVariantId(resolved.variant.public_id);
  const quoteId = resolved.quote.public_id;
  const designId = design.id;
  const scope = `[${FUNNEL_DESIGN_SCOPE_ATTR}="${designId}"]`;
  const chromeCss = funnelChromeCss(design, scope);
  const contentVersion = resolved.variant.content_version;

  // (a) all Sections server-rendered in ORDER via the shared preset renderer;
  // wrapper contract EXACTLY per 03 §3.2: data-lg-section + data-lg-section-id
  // + data-lg-index + data-screen-label="{i+1:02d} · {headline}", first section
  // not hidden.
  const sectionsHtml = resolved.sections
    .map((rs, i) => {
      const nodes = parseSectionComponents(
        typeof rs.section.content_json === "string" ? rs.section.content_json : "",
      );
      const label = `${String(i + 1).padStart(2, "0")} · ${rs.section.headline_text}`;
      return (
        `<section data-lg-section data-lg-section-id="${escapeHtml(rs.section.public_id)}"` +
        ` data-lg-index="${i}" data-screen-label="${escapeHtml(label)}"${i === 0 ? "" : " hidden"}>` +
        renderSectionComponents(nodes, design) +
        `</section>`
      );
    })
    .join("");

  // (b) the SAME LeadgenPublicConfig JSON /lg/config serves, baked in-request.
  // `<` → < (the injectAssignment pattern) so an authored value can never
  // forge </script> out of the JSON block.
  const configJson = JSON.stringify(buildPublicConfig(resolved, design, answerMapVersions)).replace(
    /</g,
    "\\u003c",
  );

  return (
    "<!doctype html>" +
    '<html lang="en">' +
    "<head>" +
    '<meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    `<title>${escapeHtml(resolved.funnel.funnel_name)}</title>` +
    // §28 GA4: the site's measurement id is baked into this per-site-cached shell
    // (absent id ⇒ nothing). Non-destructive: it never resets an existing dataLayer.
    ga4HeadSnippet(resolved.ga4_measurement_id) +
    `<style>${chromeCss}</style>` +
    MAPS_KEY_SENTINEL +
    "</head>" +
    "<body>" +
    `<div id="lg-funnel-root" ${FUNNEL_DESIGN_SCOPE_ATTR}="${escapeHtml(designId)}"` +
    ` data-funnel-id="${escapeHtml(funnelId)}"` +
    ` data-funnel-variant-id="${escapeHtml(funnelVariantId)}"` +
    ` data-quote-id="${escapeHtml(quoteId)}"` +
    ` data-content-version="${escapeHtml(String(contentVersion))}">` +
    '<main class="lg-content" data-lg-mount>' +
    sectionsHtml +
    // The 03 §3.3 auction mount — the engine injects banners_html here after
    // the final Section's /lg/auction call; hidden until filled.
    '<div class="lg-banners" data-lg-banners hidden></div>' +
    "</main>" +
    "</div>" +
    // (b) the inline config the engine parses FIRST (03 §3.5 init).
    `<script type="application/json" id="lg-config">${configJson}</script>` +
    // Per-request §16.3 assignment dims are spliced here (injectAssignment)
    // BEFORE any script runs so window.__LG_ASSIGNMENT__ is set when the
    // engine initializes.
    ASSIGN_SENTINEL +
    `<script>${LEADGEN_PREHYDRATE_JS}</script>` +
    // (c) the hydration engine — versioned, deferred; the /lg/runtime/:version.js
    // route serves the generated bundle (03 §3.2 runtime-routes row).
    `<script src="/lg/runtime/${LEADGEN_TEMPLATE_VERSION}.js" defer></script>` +
    "</body></html>"
  );
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

// GET /lg (root activation) + GET /lg/:quote_slug — the cacheable funnel shell.
export async function serveFunnelShell(
  c: PublicContext,
  quoteSlug: string | null,
): Promise<Response> {
  const siteContext = c.get("siteContext");

  // §16.2 sticky assignment: read the ko_sid session cookie (generate + set it
  // when absent, same semantics as the listicle runtime) and thread it into the
  // resolver, which runs the deterministic edge hash BEFORE the cache key is
  // built — so a running test decides WHICH variant's cached shell to serve.
  const cookieHeader = c.req.header("Cookie") ?? null;
  let sid = readCookie(cookieHeader, "ko_sid");
  const sidWasAbsent = sid === "";
  if (sidWasAbsent) sid = genSessionId();

  const resolved = await resolveActivatedFunnel(c.env, {
    site_id: siteContext.siteId,
    quote_slug: quoteSlug,
    session_id: sid,
  });
  // Disabled / missing activation → 404 (the reserved /lg head never falls
  // through to publicRouter's /:slug catch-all — §17.2 / §4.3).
  if (resolved === null) return c.json({ error: "Not Found" }, 404);

  const design = getFunnelDesign(resolved.variant.funnel_design_id);
  const funnelId = resolved.funnel.public_id;
  const variantId = resolved.variant.public_id; // the ASSIGNED variant (§16.2)
  const contentVersion = resolved.variant.content_version;
  const slug = resolved.site_quote.slug;
  // v2.4 03 §3.2 ab_rev axis: the running test's revision (0 when none). The
  // shell now BAKES the #lg-config test dims, and a start/stop/re-bump flips
  // them WITHOUT a content_version move — without this axis the stale baked
  // dims would serve until TTL (the exact class the leadgenConfigKey comment
  // documents).
  const abRev = resolved.assignment.funnel_ab_test_revision;
  // §28: the activation's updated_at bumps on any enable/disable/slug/settings
  // (incl. the baked-in GA4 id) edit → a fresh key + ETag, so a settings-only
  // GA4 change never serves a stale shell (no content_version move on that path).
  const activationVersion = resolved.site_quote.updated_at;

  // §28 cache correctness: key by the ASSIGNED variant (never the control
  // unconditionally) so a running 2-variant test serves two DISTINCT cached
  // shells — one per assigned variant.
  const key = leadgenShellKey(siteContext.siteId, slug, funnelId, variantId, contentVersion, abRev, activationVersion);
  const etag = await leadgenShellEtag(siteContext.siteId, slug, funnelId, variantId, contentVersion, abRev, activationVersion);

  // A freshly-minted ko_sid rides the RESPONSE (never the cached body) so the
  // assignment is sticky across this session's requests (§16.2).
  const withSession = (headers: Headers): Headers => {
    if (sidWasAbsent) headers.append("Set-Cookie", sessionCookie("ko_sid", sid));
    return headers;
  };

  const ifNoneMatch = c.req.header("If-None-Match") ?? null;
  if (matchesIfNoneMatch(ifNoneMatch, etag)) {
    return new Response(null, { status: 304, headers: withSession(publicHtmlCacheHeaders({ etag })) });
  }

  let pristine: string;
  const cached = await getCachedHtml(c.env, key);
  if (cached !== null) {
    pristine = cached.body;
  } else {
    // R6 (v2.4 03 §3.8): the per-section answer-map version markers, read at
    // resolve time on the COLD path only (a cache hit already carries them
    // baked into #lg-config).
    const answerMapVersions = await loadAnswerMapVersions(c.env.DB, resolved.sections);
    pristine = renderFunnelShell(resolved, design, answerMapVersions);
    const ttl = parseNumber(c.env.HTML_CACHE_TTL_SECONDS, DEFAULT_TTL_SECONDS);
    // Write-through stores the PRISTINE shell (visitor-invariant: no Maps key,
    // no per-session assignment dims — only the sentinels).
    await putCachedHtml(c.env, key, pristine, { expirationTtl: ttl, etag });
  }

  // Per-request injections on the RESPONSE stream only (never cached): the Maps
  // key, then the NON-session §16.3 assignment dims (the per-session bucket is
  // deliberately null on this public shell — the client recomputes it, m1).
  let body = injectMapsKey(pristine, resolved, c.env);
  body = injectAssignment(body, resolved.assignment, toFunnelVariantId(resolved.variant.public_id));
  return new Response(body, { status: 200, headers: withSession(publicHtmlCacheHeaders({ etag })) });
}

// GET /lg/config/:funnel_variant_id — the cacheable public client config
// (Stage-A buildPublicConfig; server-only fields stripped, §30.4). 404 for a
// variant not under an enabled activation on this host (never leak a config).
export async function serveLeadgenConfig(c: PublicContext): Promise<Response> {
  const siteContext = c.get("siteContext");
  const variantId = c.req.param("funnel_variant_id") ?? "";
  const resolved = await resolveActivatedFunnelByVariant(c.env, siteContext.siteId, variantId);
  if (resolved === null) return c.json({ error: "Not Found" }, 404);

  const design = getFunnelDesign(resolved.variant.funnel_design_id);
  const funnelId = resolved.funnel.public_id;
  const funnelVariantId = resolved.variant.public_id;
  const contentVersion = resolved.variant.content_version;
  // §16.2 ab_rev axis: the running test's revision (0 on the single_control path).
  // The resolver already detected the running test and surfaced its revision on the
  // assignment dims, so keying by it guarantees the cache identity changes exactly
  // when the baked §16.3 dims do — a start/stop/re-bump mints a fresh key/ETag and
  // never serves the stale pre-transition config body.
  const abRev = resolved.assignment.funnel_ab_test_revision;
  // §28: activation updated_at → a fresh key/ETag on any settings edit (the GA4
  // id lives in settings_overrides_json and does not move content_version).
  const activationVersion = resolved.site_quote.updated_at;

  // site_id + funnel_variant_id are part of the key + ETag material so one
  // funnel activated on two tenant sites can never share a cached config entry
  // (each site bakes in its OWN ga4_measurement_id from settings_overrides_json).
  const key = leadgenConfigKey(siteContext.siteId, funnelId, funnelVariantId, contentVersion, abRev, activationVersion);
  const etag = await leadgenConfigEtag(siteContext.siteId, funnelId, funnelVariantId, contentVersion, abRev, activationVersion);

  const ifNoneMatch = c.req.header("If-None-Match") ?? null;
  if (matchesIfNoneMatch(ifNoneMatch, etag)) {
    return new Response(null, { status: 304, headers: leadgenConfigCacheHeaders(etag) });
  }

  let body: string;
  const cached = await getCachedHtml(c.env, key);
  if (cached !== null) {
    body = cached.body;
  } else {
    // R6 (v2.4 03 §3.8): per-section answer_mapping_version markers, read at
    // resolve time on the COLD path (the cached body already bakes them).
    const answerMapVersions = await loadAnswerMapVersions(c.env.DB, resolved.sections);
    // buildPublicConfig is the RED-LINE strip point: it copies only whitelisted
    // public fields, so no provider endpoint / token ref / bid strategy / raw
    // schema / signed token / attempt id can appear (proven in
    // leadgen-config-dto.test.ts; re-proven over HTTP in the runtime test).
    body = JSON.stringify(buildPublicConfig(resolved, design, answerMapVersions));
    const ttl = parseNumber(c.env.HTML_CACHE_TTL_SECONDS, DEFAULT_TTL_SECONDS);
    await putCachedHtml(c.env, key, body, { expirationTtl: ttl, etag });
  }
  return new Response(body, { status: 200, headers: leadgenConfigCacheHeaders(etag) });
}

// GET /lg/attempt?funnel_variant_id=lgn_… — mint a per-session funnel_attempt_id
// + HMAC-signed signed_config_token (Stage-A mintFunnelAttempt). no-store
// (§4.3 / §8.3 — session-specific, never cached, never in /lg/config). The
// funnel is resolved from the funnel_variant_id query param (same anti-leak
// reverse lookup as /lg/config; a foreign/unactivated variant → 404).
export async function serveLeadgenAttempt(c: PublicContext): Promise<Response> {
  const siteContext = c.get("siteContext");
  const variantId = c.req.query("funnel_variant_id") ?? "";
  const resolved = await resolveActivatedFunnelByVariant(c.env, siteContext.siteId, variantId);
  if (resolved === null) {
    return new Response(JSON.stringify({ error: "Not Found" }), {
      status: 404,
      headers: leadgenNoStoreHeaders(),
    });
  }
  const attempt = await mintFunnelAttempt(c.env, resolved);
  return new Response(JSON.stringify(attempt), {
    status: 200,
    headers: leadgenNoStoreHeaders(),
  });
}
