// LeadGen §17.2 / §28 / §30.4 — the PUBLIC `/lg/*` funnel runtime shell +
// client-config + attempt serving (Phase 7 Stage C, tenant hosts only).
//
// Pipeline (the listicle/serve.ts cacheable-shell mirror for funnels):
//   host→site (public middleware, siteContext) → resolveActivatedFunnel (§17.2
//   host→site→quote→funnel→control variant) → (missing/disabled → 404) →
//   leadgenShellKey(site,slug,funnel_id,content_version) → KV/Cache-API read →
//   cold render (funnelChromeCss(getFunnelDesign(variant.funnel_design_id)) +
//   shell scaffold + a bootstrap fetching /lg/config + /lg/attempt) →
//   write-through → publicHtmlCacheHeaders (public, max-age=300, swr=86400) +
//   strong ETag + nosniff + 304.
//
// The browser Google-Maps key (§30.2 referrer-restricted browser key) is
// injected PER-REQUEST via Stage-A resolveBrowserMapsKey and ONLY when the
// funnel has an address section — it NEVER enters the cached shell HTML
// (§30.4). The cached body carries only a sentinel comment; the key script is
// spliced onto the RESPONSE stream, mirroring the listicle post-cache
// injectListicleContext pattern (the KV entry stays visitor-invariant).
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
import { buildPublicConfig } from "./config-dto";
import { mintFunnelAttempt } from "./attempt";
import { getFunnelDesign, type FunnelDesign } from "./designs/registry";
import { funnelChromeCss, FUNNEL_DESIGN_SCOPE_ATTR } from "./designs/default-funnel/styles";
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
// PER-SESSION dims (esp. assignment_bucket) are injected on the RESPONSE only —
// never baked into the per-variant cached body — so one cached shell serves
// every session assigned that variant while each still gets its OWN bucket for
// the P11 quote_view beacon. Mirrors the Maps-key sentinel discipline exactly.
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
function leadgenNoStoreHeaders(): Headers {
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
): Promise<string> {
  // Material mirrors leadgenShellKey (now variant-scoped, §16.2/§28) so the ETag
  // changes iff the key would — two assigned variants get DISTINCT ETags and a
  // conditional GET never 304s one variant's shell against another's.
  return computeEtag({
    site_id: siteId,
    path: `/lg/${quoteSlug ?? ""}:${funnelId}:${funnelVariantId}`,
    content_version: contentVersion,
    template_version: LEADGEN_TEMPLATE_VERSION,
  });
}

function leadgenConfigEtag(
  siteId: string,
  funnelId: string,
  funnelVariantId: string,
  contentVersion: number,
): Promise<string> {
  // Material = site + funnel + variant + content_version, matching
  // leadgenConfigKey so the ETag changes iff the cache key would. site_id is a
  // first-class component (the config bakes in the site-specific ga4 id), so two
  // tenant sites serving the SAME funnel/variant get DISTINCT ETags.
  return computeEtag({
    site_id: siteId,
    path: `/lg/config/${funnelId}/${funnelVariantId}`,
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

// True when the funnel has an address section — the only place the browser Maps
// key is needed (§28 "Google Maps only on address sections"). Signals:
// address_validation_enabled=1 on a section, OR an AddressAutocompleteQuestion
// component in a section's content_json (dedicated try/catch per the D1
// JSON-parse safety rule — a corrupt blob never throws).
function funnelNeedsMapsKey(resolved: ResolvedActivatedFunnel): boolean {
  for (const rs of resolved.sections) {
    if (rs.section.address_validation_enabled === 1) return true;
    const raw = rs.section.content_json;
    if (typeof raw !== "string" || raw === "") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    if (typeof parsed !== "object" || parsed === null) continue;
    const components = (parsed as { components?: unknown }).components;
    if (!Array.isArray(components)) continue;
    for (const c of components) {
      if (
        c !== null &&
        typeof c === "object" &&
        (c as { type?: unknown }).type === "AddressAutocompleteQuestion"
      ) {
        return true;
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

// Splice the §16.3 assignment dims onto the RESPONSE body only (per-request).
// window.__LG_ASSIGNMENT__ = { funnel_ab_test_id, funnel_ab_test_revision,
// variant_label, traffic_allocation_bp, assignment_bucket, assignment_reason }
// — the P11 quote_view beacon reads this. assignment_bucket is the per-SESSION
// §16.2 bucket (0..9999) on the ab_hash path, null on single_control. `<` is
// neutralized so an authored variant_label can never forge </script> / markup.
function injectAssignment(html: string, assignment: FunnelAssignment): string {
  const json = JSON.stringify({
    funnel_ab_test_id: assignment.funnel_ab_test_id,
    funnel_ab_test_revision: assignment.funnel_ab_test_revision,
    variant_label: assignment.variant_label,
    traffic_allocation_bp: assignment.traffic_allocation_bp,
    assignment_bucket: assignment.assignment_bucket,
    assignment_reason: assignment.assignment_reason,
  }).replace(/</g, "\\u003c");
  const script = `<script>window.__LG_ASSIGNMENT__=${json};</script>`;
  return html.replace(ASSIGN_SENTINEL, () => script);
}

// ---------------------------------------------------------------------------
// Shell render (pristine, cacheable — visitor-invariant, no secrets)
// ---------------------------------------------------------------------------

// The lean vanilla bootstrap (contract 03 §8.3): read the funnel_variant_id off
// the root data attribute, fetch the cacheable /lg/config + the no-store
// /lg/attempt, stash both on window.__LG_BOOTSTRAP__ and fire an lg:bootstrap
// event for the P11 client funnel engine. STATIC (the variant id is read from
// the DOM, never interpolated) so nothing here needs escaping.
const LEADGEN_BOOTSTRAP_JS =
  '(function(){var el=document.getElementById("lg-funnel-root");' +
  'if(!el||typeof el.getAttribute!=="function")return;' +
  'var vid=el.getAttribute("data-funnel-variant-id");if(!vid)return;' +
  "var enc=encodeURIComponent(vid);" +
  "Promise.all([" +
  'fetch("/lg/config/"+enc,{headers:{accept:"application/json"}}).then(function(r){return r.ok?r.json():null;}).catch(function(){return null;}),' +
  'fetch("/lg/attempt?funnel_variant_id="+enc,{headers:{accept:"application/json"}}).then(function(r){return r.ok?r.json():null;}).catch(function(){return null;})' +
  "]).then(function(res){" +
  "window.__LG_BOOTSTRAP__={config:res[0],attempt:res[1]};" +
  'el.setAttribute("data-lg-ready","1");' +
  'document.dispatchEvent(new CustomEvent("lg:bootstrap",{detail:window.__LG_BOOTSTRAP__}));' +
  "});})();";

// Render the pristine funnel shell: scoped chrome CSS from the resolved design +
// a mount point + the bootstrap, with the funnel_id (lgf_) and funnel_variant_id
// (lgn_) as DISTINCT data attributes (G4, prefix-branded). No section content
// (the P11 client engine renders sections from /lg/config); no secrets; the
// Maps-key sentinel keeps the browser key out of these bytes (§30.4). Lean (§28).
function renderFunnelShell(resolved: ResolvedActivatedFunnel, design: FunnelDesign): string {
  const funnelId = toFunnelId(resolved.funnel.public_id);
  const funnelVariantId = toFunnelVariantId(resolved.variant.public_id);
  const quoteId = resolved.quote.public_id;
  const designId = design.id;
  const scope = `[${FUNNEL_DESIGN_SCOPE_ATTR}="${designId}"]`;
  const chromeCss = funnelChromeCss(design, scope);
  const contentVersion = resolved.variant.content_version;

  return (
    "<!doctype html>" +
    '<html lang="en">' +
    "<head>" +
    '<meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    `<title>${escapeHtml(resolved.funnel.funnel_name)}</title>` +
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
    "<noscript>This funnel requires JavaScript to load.</noscript>" +
    "</main>" +
    "</div>" +
    // Per-request §16.3 assignment dims are spliced here (injectAssignment) BEFORE
    // the bootstrap so window.__LG_ASSIGNMENT__ is set when lg:bootstrap fires.
    ASSIGN_SENTINEL +
    `<script>${LEADGEN_BOOTSTRAP_JS}</script>` +
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

  // §28 cache correctness: key by the ASSIGNED variant (never the control
  // unconditionally) so a running 2-variant test serves two DISTINCT cached
  // shells — one per assigned variant.
  const key = leadgenShellKey(siteContext.siteId, slug, funnelId, variantId, contentVersion);
  const etag = await leadgenShellEtag(siteContext.siteId, slug, funnelId, variantId, contentVersion);

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
    pristine = renderFunnelShell(resolved, design);
    const ttl = parseNumber(c.env.HTML_CACHE_TTL_SECONDS, DEFAULT_TTL_SECONDS);
    // Write-through stores the PRISTINE shell (visitor-invariant: no Maps key,
    // no per-session assignment dims — only the sentinels).
    await putCachedHtml(c.env, key, pristine, { expirationTtl: ttl, etag });
  }

  // Per-request injections on the RESPONSE stream only (never cached): the Maps
  // key, then the §16.3 assignment dims (incl. the per-session bucket).
  let body = injectMapsKey(pristine, resolved, c.env);
  body = injectAssignment(body, resolved.assignment);
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

  // site_id + funnel_variant_id are part of the key + ETag material so one
  // funnel activated on two tenant sites can never share a cached config entry
  // (each site bakes in its OWN ga4_measurement_id from settings_overrides_json).
  const key = leadgenConfigKey(siteContext.siteId, funnelId, funnelVariantId, contentVersion);
  const etag = await leadgenConfigEtag(siteContext.siteId, funnelId, funnelVariantId, contentVersion);

  const ifNoneMatch = c.req.header("If-None-Match") ?? null;
  if (matchesIfNoneMatch(ifNoneMatch, etag)) {
    return new Response(null, { status: 304, headers: leadgenConfigCacheHeaders(etag) });
  }

  let body: string;
  const cached = await getCachedHtml(c.env, key);
  if (cached !== null) {
    body = cached.body;
  } else {
    // buildPublicConfig is the RED-LINE strip point: it copies only whitelisted
    // public fields, so no provider endpoint / token ref / bid strategy / raw
    // schema / signed token / attempt id can appear (proven in
    // leadgen-config-dto.test.ts; re-proven over HTTP in the runtime test).
    body = JSON.stringify(buildPublicConfig(resolved, design));
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
