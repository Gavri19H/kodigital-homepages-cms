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
  type ResolvedFunnelSection,
  type FunnelAssignment,
} from "./resolver";
import {
  buildPublicConfig,
  parseSectionComponents,
  parseSectionDesignOverrides,
  loadAnswerMapVersions,
} from "./config-dto";
import { flattenComponents } from "./components/content-schema";
// R6 SEAM 5 (register F7): the frame-scope check renderVariantSectionsHtml
// below applies at serve time — same catalog the content-schema save-time
// warning (frame_scope_component) already reads.
import { COMPONENT_CATALOG } from "./components/registry";
import { mintFunnelAttempt } from "./attempt";
import { getFunnelDesign, type FunnelDesign } from "./designs/registry";
import { funnelChromeCss, FUNNEL_DESIGN_SCOPE_ATTR } from "./designs/default-funnel/styles";
// 03 §3.2a / 09 §9.1: the ONE shared renderer — the same presets that power
// admin preview, quote preview, and persisted content_html render the live
// shell sections. Pure over (nodes, design) with a pinned en-US locale, so the
// server-rendered body stays variant-invariant under the cache-key axes.
import { isNewMapsShape, renderSectionComponents, type LeadgenSectionRenderCtx } from "./components/presets";
// v2.5 redesign §13.3 composition swap: `frame_config_json` NULL → the
// byte-pinned legacy shell (renderLegacyShell mirrors the historical inline
// root construction 1:1); non-NULL → the ONE composition path renderQuoteFrame
// over resolveTokens + effectiveFrame (13 §13.1 "same functions, never a
// fork"). Cache keys / sentinels / config blob mechanics are UNCHANGED — a
// frame/theme edit reaches visitors via the 03 §3.1 content_version bump.
import { renderLegacyShell, renderQuoteFrame, LG_BANNERS_MOUNT_HTML } from "./designs/frame";
import { effectiveFrame, validateFrameConfig } from "./designs/frames";
import type { EffectiveFrameConfig, FrameOverrides, StoredFrameConfig } from "./designs/frames";
import { resolveTokens, validateTheme, winningThemeId } from "./designs/theme";
import type {
  EffectiveFunnelDesign,
  EffectiveTokens,
  ThemeJson,
  ThemeRecord,
  ThemeRecordControls,
  VariantThemeOverrides,
} from "./designs/theme";
// v3.1 §10.1/§12 (fix round): the live runtime path resolves a funnel/
// variant's {theme_id} exactly like the admin preview paths do — ONE KV read
// per cold render, hoisted here (the nearest async caller) since
// resolveFrameComposition below stays a PURE, synchronous function (theme.ts's
// own discipline: "PURE — no DB, no Hono, no admin imports", extended here to
// "no KV either"). theme-store.ts is the PUBLIC module the admin CRUD
// (themes-handlers.ts) ALSO reads through — one KV reader, never two.
import { getThemeRecord } from "./designs/theme-store";
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
//   * an AddressAutocompleteQuestion component: Maps-capable UNLESS a v3.1
//     §9.2 NEW-shape config explicitly sets enabled:false (§9.3 per-field
//     precedence — isNewMapsShape/presets.ts, the same check the renderer
//     uses, so this key-injection gate and the rendered data-lg-maps
//     attribute never disagree);
//   * a ZIPInputQuestion with the legacy per-node validate flag, a
//     legacy flat-shape props.maps object (unconditional, §12 no-regression),
//     or a NEW-shape config with enabled:true.
// content_json parses through the shared parseSectionComponents (dedicated
// try/catch per the D1 JSON-parse safety rule — a corrupt blob never throws)
// and the walk runs over the §8.5 canonical flattenComponents projection so a
// Maps-enabled address/ZIP component nested inside a layout container is
// found exactly like a top-level one (flat legacy content is unchanged).
function funnelNeedsMapsKey(resolved: ResolvedActivatedFunnel): boolean {
  for (const rs of resolved.sections) {
    const columnEnabled = rs.section.address_validation_enabled === 1;
    const raw = rs.section.content_json;
    const components =
      typeof raw === "string" && raw !== "" ? flattenComponents(parseSectionComponents(raw)) : [];
    // v3.1 §9.3 (S3-8) per-field precedence: an address/ZIP node carrying its
    // OWN props.maps config is AUTHORITATIVE for THAT field — the legacy Section
    // column (address_validation_enabled) is only a FALLBACK for nodes with no
    // per-field opinion. The old code checked the column FIRST, letting it
    // OVERRIDE a per-field enabled:false (the S3-8 defect); it is now consulted
    // per-node AFTER per-field config, matching sections-handlers.ts's
    // zipValidation leg and the renderer's own per-field decision.
    let sawAddressOrZipField = false;
    for (const c of components) {
      if (c === null || typeof c !== "object") continue;
      const props = c.props ?? {};
      const maps = props["maps"];
      if (c.type === "AddressAutocompleteQuestion") {
        sawAddressOrZipField = true;
        if (isNewMapsShape(maps)) {
          if (maps.enabled === true) return true;
          continue; // explicit enabled:false — per-field wins over the column
        }
        return true; // legacy/absent config — unconditional (§12 no-regression)
      }
      if (c.type === "ZIPInputQuestion") {
        sawAddressOrZipField = true;
        if (isNewMapsShape(maps)) {
          if (maps.enabled === true) return true;
          continue; // per-field wins over the column
        }
        if (props["validate"] === true) return true;
        if (typeof maps === "object" && maps !== null && !Array.isArray(maps)) return true;
        // No per-field opinion — fall back to the legacy Section column.
        if (columnEnabled) return true;
      }
    }
    // Legacy content whose Section column is on but which carries NO address/ZIP
    // field with a per-field opinion: preserve the pre-fix behavior (column ⇒
    // key) so no existing funnel regresses.
    if (columnEnabled && !sawAddressOrZipField) return true;
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
// v2.5 §13.3 frame composition inputs (per-request, cold path only)
// ---------------------------------------------------------------------------

// Dedicated try/catch JSON-object read of a 0041 column (D1 JSON-parse safety:
// a corrupt blob yields null — the legacy path — never a thrown funnel serve).
function parseJsonRecordColumn(raw: string | null | undefined): Record<string, unknown> | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : null;
}

// The raw 0041 columns for one (funnel, variant) — the exact fields
// resolveFrameComposition consumes. Both the runtime callers (a
// ResolvedActivatedFunnel) and the admin composed-variant preview
// (quotes-handlers, plain funnel/variant rows) satisfy it structurally.
export interface LeadgenFrameSource {
  frame_config_json: string | null | undefined;
  theme_json: string | null | undefined;
  frame_overrides_json: string | null | undefined;
}

// The resolved v2.5 composition bundle for one (funnel, variant): the effective
// frame + effective tokens, or null on the legacy path. NULL/absent/corrupt/
// structurally-invalid stored config degrades to null (fail-safe: an invalid
// stored frame must never break a revenue-serving page — activation preflight
// is where the invalidity is REPORTED, 14 §14.1). Shared by the shell renderer,
// /lg/config, and the admin composed preview so all three resolve the SAME
// frame + tokens from the same columns (§13.4 parity by construction).
export interface LeadgenFrameComposition {
  frame: EffectiveFrameConfig;
  effectiveTokens: EffectiveTokens;
}

// v3.1 §10.1/§12 (fix round, ADDITIVE 3rd param): `themeRecord` is the
// ALREADY-FETCHED KV record for whichever theme_id won (variant frame_
// overrides_json.theme_id over funnel theme_json.theme_id, winningThemeId) —
// this function performs NO KV I/O itself (stays synchronous/pure); the
// caller resolves it (resolveThemeRecordFor below, on the live path; the
// admin preview/quote-builder call sites do the equivalent). Absent (undefined/
// null) is BYTE-IDENTICAL to today: a NULL/legacy-inline theme_json resolves
// exactly as before, since resolveTokens's 4th arg only changes anything when
// non-null AND the 2nd arg is a {theme_id} ref.
export function resolveFrameComposition(
  source: LeadgenFrameSource,
  design: FunnelDesign,
  themeRecord?: ThemeRecord | null,
): LeadgenFrameComposition | null {
  const rawFrame = parseJsonRecordColumn(source.frame_config_json ?? null);
  if (rawFrame === null) return null; // legacy funnel — exact current behavior (03 §3.1)
  const frameValidation = validateFrameConfig(rawFrame);
  if (frameValidation.config === null) return null; // invalid stored frame → fail-safe legacy render

  // theme_json: applied only when structurally valid (validateTheme is the
  // save-time gate; serve re-checks so drifted/corrupt json can never feed
  // resolveTokens junk scales). Invalid → base design (theme = null).
  const rawTheme = parseJsonRecordColumn(source.theme_json ?? null);
  let theme: ThemeJson | null = null;
  if (rawTheme !== null) {
    theme = validateTheme(rawTheme).theme;
  }

  // Variant frame_overrides_json (§13.2): the frame groups deep-merge; the
  // `theme.palette` part rides resolveTokens layer 3 (§9.2). An invalid
  // overrides patch is dropped whole (preflight reports it; the funnel-level
  // frame still renders).
  const rawOverrides = parseJsonRecordColumn(source.frame_overrides_json ?? null);
  let frameOverrides: FrameOverrides | null = null;
  let overridesTheme: VariantThemeOverrides | null = null;
  if (rawOverrides !== null) {
    const { theme: overridesThemeRaw, ...frameParts } = rawOverrides;
    const overridesValidation = validateFrameConfig(frameParts);
    if (overridesValidation.config !== null) {
      frameOverrides = overridesValidation.config as FrameOverrides;
    }
    if (
      typeof overridesThemeRaw === "object" &&
      overridesThemeRaw !== null &&
      !Array.isArray(overridesThemeRaw)
    ) {
      const palette = (overridesThemeRaw as Record<string, unknown>)["palette"];
      if (typeof palette === "object" && palette !== null && !Array.isArray(palette)) {
        overridesTheme = { palette: palette as VariantThemeOverrides["palette"] };
      }
    }
  }

  const effectiveTokens = resolveTokens(design, theme, overridesTheme, themeRecord ?? null);
  const { frame } = effectiveFrame(frameValidation.config as StoredFrameConfig, null, frameOverrides);
  return { frame, effectiveTokens };
}

// A ResolvedActivatedFunnel's frame source columns (funnel + assigned variant).
function frameSourceOf(resolved: ResolvedActivatedFunnel): LeadgenFrameSource {
  return {
    frame_config_json: resolved.funnel.frame_config_json,
    theme_json: resolved.funnel.theme_json,
    frame_overrides_json: resolved.variant.frame_overrides_json,
  };
}

// v3.1 §10.1/§12 (fix round): resolve the WINNING theme_id (variant overrides
// > funnel, winningThemeId — mirrors the existing variant-over-funnel palette
// precedence one layer up) for a frame source and fetch its KV record — AT
// MOST ONE KV read, called once per cold render (see the two call sites
// below, both already gated behind a `cached === null` check exactly like
// loadAnswerMapVersions). Degrades to null (never throws) when: neither side
// carries a theme_id (legacy inline / no theme), or the id no longer exists
// in the store (deleted theme) — resolveFrameComposition/resolveTokens then
// fall back to the legacy default look, the SAME degrade path a NULL theme
// already takes today. A public funnel is NEVER 500'd by an unknown/deleted
// theme_id.
async function resolveThemeRecordFor(env: Env, source: LeadgenFrameSource): Promise<ThemeRecord | null> {
  const funnelTheme = parseJsonRecordColumn(source.theme_json ?? null);
  const variantOverrides = parseJsonRecordColumn(source.frame_overrides_json ?? null);
  const id = winningThemeId(funnelTheme, variantOverrides);
  if (id === null) return null;
  return getThemeRecord(env.CACHE, id);
}

// The ordered `<section data-lg-section …>` list — wrapper contract EXACTLY
// per 03 §3.2 (data-lg-section + data-lg-section-id + data-lg-index +
// data-screen-label="{i+1:02d} · {headline}", first section not hidden), each
// body through the ONE shared preset renderer with the 03 §3.4 sectionCtx
// (canonical headline/subheadline columns, continue_mode, §9.5 Section
// overrides; plus the frame's §11.5 continue placement fields when a frame is
// configured). EXPORTED: the admin composed-variant preview (quotes-handlers
// renderComposedVariantPreview) renders its slot content through THIS function
// — preview and runtime section markup can never drift (13 §13.5 leg 1).
// v3.1 §7/§12 (ADDITIVE 4th param, adversarial review MAJOR-1): the
// composition's resolved theme_controls (EffectiveTokens.theme_controls) —
// undefined for a legacy/NULL-theme funnel (byte-identical). Threaded into
// EVERY section's ctx so the §7 field-size resolver's "funnel theme
// default" tier (fieldSizeStyle in components/presets.ts) reads the REAL
// resolved controls instead of always falling back to its own
// DEFAULT_SIZE_THEME_CONTROLS constant — this was the dead-deliverable gap
// (resolveTokens computed theme_controls but no production caller threaded
// it into LeadgenSectionRenderCtx).
export function renderVariantSectionsHtml(
  sections: readonly ResolvedFunnelSection[],
  design: FunnelDesign | EffectiveFunnelDesign,
  frame: EffectiveFrameConfig | null,
  themeControls?: ThemeRecordControls,
): string {
  const presetDesign = design as FunnelDesign;
  return sections
    .map((rs, i) => {
      const nodes = parseSectionComponents(
        typeof rs.section.content_json === "string" ? rs.section.content_json : "",
      );
      // R6 SEAM 5 (register F7): the frame owns chrome. When a frame IS present
      // it synthesizes its OWN footer/progress/etc (designs/frame.ts) via the
      // SAME leaf renderers (renderFooterBar/renderStepIndicator) a legacy
      // scope:"frame" node inside this section's content would ALSO emit —
      // double chrome. content-schema.ts flags such a node as a save-time
      // WARNING only (legal in stored content, never blocking), so it can
      // persist from before R3's studio strip; skip it HERE, at render, rather
      // than mutating stored content. A frameless legacy funnel has no frame
      // chrome at all, so its section-embedded frame-scope nodes are the ONLY
      // chrome and must keep rendering — never orphan frameless legacy content.
      // Optional-chained: an unknown/non-catalog type string (legacy/imported/
      // version-skew content — parseSectionComponents does zero type
      // validation and activation preflight never runs the full content
      // validator) must NOT throw here. A throw would 500 EVERY request for
      // this funnel (renderFunnelShell has no try/catch, nothing ever caches)
      // — a full outage, regressing the pre-R6 graceful "" render
      // (renderComponent's default case). An unknown type is KEPT (never
      // filtered out) and falls through to that same default case.
      const renderNodes =
        frame === null ? nodes : nodes.filter((n) => COMPONENT_CATALOG[n.type]?.scope !== "frame");
      const ctx: LeadgenSectionRenderCtx = {
        headline_text: rs.section.headline_text,
        subheadline_text: rs.section.subheadline_text ?? null,
        continue_mode: rs.section.continue_mode,
        design_overrides: parseSectionDesignOverrides(rs.section.design_overrides_json),
      };
      if (frame !== null) {
        ctx.continue_placement = frame.section_slot.continue_placement;
        ctx.continue_style_role = frame.section_slot.continue_style_role;
      }
      if (themeControls !== undefined) {
        ctx.theme_controls = themeControls;
      }
      const label = `${String(i + 1).padStart(2, "0")} · ${rs.section.headline_text}`;
      return (
        `<section data-lg-section data-lg-section-id="${escapeHtml(rs.section.public_id)}"` +
        ` data-lg-index="${i}" data-screen-label="${escapeHtml(label)}"${i === 0 ? "" : " hidden"}>` +
        renderSectionComponents(renderNodes, presetDesign, ctx) +
        `</section>`
      );
    })
    .join("");
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
  themeRecord: ThemeRecord | null,
): string {
  const funnelId = toFunnelId(resolved.funnel.public_id);
  const funnelVariantId = toFunnelVariantId(resolved.variant.public_id);
  const quoteId = resolved.quote.public_id;
  const designId = design.id;
  const scope = `[${FUNNEL_DESIGN_SCOPE_ATTR}="${designId}"]`;
  const contentVersion = resolved.variant.content_version;

  // v2.5 §13.3: the ONE fork — a configured frame composes through
  // renderQuoteFrame over the EFFECTIVE tokens; NULL/invalid frame renders the
  // byte-pinned legacy shell over the base design (resolveTokens is identity-
  // free on that path: the pin proves css/config/design_tokens bytes
  // unchanged). resolveTokens keeps design.id, so the scope selector is the
  // same string on both paths.
  const composition = resolveFrameComposition(frameSourceOf(resolved), design, themeRecord);
  const effectiveDesign: FunnelDesign | EffectiveFunnelDesign =
    composition === null ? design : composition.effectiveTokens.design;
  const chromeCss =
    composition === null
      ? funnelChromeCss(design, scope)
      : funnelChromeCss(composition.effectiveTokens.design, scope, { frameRegions: true });

  // (a) all Sections server-rendered in ORDER via the shared preset renderer
  // (renderVariantSectionsHtml — wrapper contract exactly per 03 §3.2), with
  // the 03 §3.4 sectionCtx; the frame path additionally threads the §11.5
  // continue placement fields from the effective frame's section_slot.
  const sectionsHtml = renderVariantSectionsHtml(
    resolved.sections,
    effectiveDesign,
    composition === null ? null : composition.frame,
    composition === null ? undefined : composition.effectiveTokens.theme_controls,
  );

  // (b) the SAME LeadgenPublicConfig JSON /lg/config serves, baked in-request
  // (the frame path bakes the EFFECTIVE design tokens — the ones this page
  // renders with, 09 §9.2). `<` → < (the injectAssignment pattern) so an
  // authored value can never forge </script> out of the JSON block.
  const configJson = JSON.stringify(
    buildPublicConfig(resolved, effectiveDesign, answerMapVersions),
  ).replace(/</g, "\\u003c");

  // The full body inside #lg-funnel-root: legacy = the pinned 1:1 mirror of
  // the historical inline construction; frame = the 13 §13.1 composed page
  // (regions + engine hooks + the sections UNTOUCHED inside the section slot).
  const rootHtml =
    composition === null
      ? renderLegacyShell({
          designId,
          funnelId,
          funnelVariantId,
          quoteId,
          contentVersion,
          sectionsHtml,
          bannersMountHtml: LG_BANNERS_MOUNT_HTML,
        })
      : renderQuoteFrame({
          effectiveTokens: composition.effectiveTokens,
          frame: composition.frame,
          siteBranding: resolved.site_branding ?? null,
          sectionsHtml,
          bannersMountHtml: LG_BANNERS_MOUNT_HTML,
          // 11 §11.1: progress totals = the Funnel Variant's section order.
          sectionCount: resolved.sections.length,
          root: { funnelId, funnelVariantId, quoteId, contentVersion },
        });

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
    rootHtml +
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
    // v3.1 §10.1/§12: the SAME cold-path-only discipline for the theme_id KV
    // read — a cache hit already carries whatever theme was baked in at
    // write time (a theme_json/frame_overrides_json EDIT bumps content_version,
    // §3.1, which busts this cache key; a THEME RECORD content edit does not —
    // see the open concern in the phase report).
    const themeRecord = await resolveThemeRecordFor(c.env, frameSourceOf(resolved));
    pristine = renderFunnelShell(resolved, design, answerMapVersions, themeRecord);
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
    // v3.1 §10.1/§12: the theme_id KV read — cold path only, mirrors the
    // shell's own placement exactly (resolveThemeRecordFor's doc comment).
    const themeRecord = await resolveThemeRecordFor(c.env, frameSourceOf(resolved));
    // v2.5 §13.3: the config route carries the SAME design tokens the shell
    // bakes — the EFFECTIVE design on the frame path, the base design on the
    // legacy path (one resolver, no drift).
    const composition = resolveFrameComposition(frameSourceOf(resolved), design, themeRecord);
    const effectiveDesign = composition === null ? design : composition.effectiveTokens.design;
    // buildPublicConfig is the RED-LINE strip point: it copies only whitelisted
    // public fields, so no provider endpoint / token ref / bid strategy / raw
    // schema / signed token / attempt id can appear (proven in
    // leadgen-config-dto.test.ts; re-proven over HTTP in the runtime test).
    body = JSON.stringify(buildPublicConfig(resolved, effectiveDesign, answerMapVersions));
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
