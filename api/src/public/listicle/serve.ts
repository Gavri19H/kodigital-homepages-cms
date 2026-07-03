// Public listicle serving — §7.2 GET /:slug branch + §22.4 GET /lst-cand/:id.
//
// Pipeline (the servePublicHtml-equivalent for per-Version shells):
//   host→site (middleware) → published listicle_articles row → §15.2 edge
//   sticky Version pick (ko_sid + canonical §31.2 hash over the RUNNING
//   experiment's allocations; no experiment ⇒ the control Version) →
//   listicleKey(site, slug, lander_v, content_version) → KV/Cache-API read →
//   cold render → write-through → publicHtmlCacheHeaders + strong ETag +
//   nosniff (+ 304 on If-None-Match) → Set-Cookie ko_sid/ko_ver echo.
//
// The ETag material includes lander_v (two Versions of one slug MUST carry
// different ETags even when their content_version numbers collide), so the
// computeEtag path component is `/{slug}:{lander_v}` — mirroring exactly the
// identity baked into listicleKey.

import type { Context } from "hono";
import type { Env } from "../../env";
import { parseNumber } from "../../env";
import type { PublicSiteVariables } from "../middleware";
import { listicleKey, listicleCandidateKey } from "../../cache/cache-keys";
import { publicHtmlCacheHeaders } from "../../cache/cache-control";
import {
  computeEtag,
  getCachedHtml,
  putCachedHtml,
  matchesIfNoneMatch,
} from "../../cache/edge-cache";
import { loadPagesForVersions } from "../../admin/listicles/structure";
import { chunk, placeholders } from "../../admin/listicles/shared";
import { mediaUrl } from "../view-models/media-url";
import { listicleBlocksToHtml, offerRefString } from "../../editor/listicle-blocks";
import { isSafeUrl } from "../../editor/sanitize";
import {
  readCookie,
  genSessionId,
  sessionCookie,
  stickyPick,
  controlVersion,
} from "./experiment-pick";
import {
  renderListicleDocument,
  renderSectionCandidateHtml,
  collectOfferRefs,
  type ListicleRenderInput,
  type RenderPage,
  type RenderSectionRow,
} from "./render";
import { getLayout } from "./layouts/registry";
import type { GovernedUrlContext } from "./governed-url";
import { parseKoCtx, buildKoCtx, serializeKoCtxCookie, KO_CTX_COOKIE } from "./ko-ctx";
import {
  injectListicleContext,
  buildRuleContext,
  type InjectedExperimentDims,
} from "./ctx-inject";
import {
  readCfSignals,
  parseClientUa,
  geoFromCf,
  hourInTimezone,
} from "../../analytics/listicle-quality";

type PublicContext = Context<{ Bindings: Env; Variables: PublicSiteVariables }>;

const DEFAULT_HTML_CACHE_TTL_SECONDS = 300;

// ---------------------------------------------------------------------------
// Row shapes
// ---------------------------------------------------------------------------

export interface ListicleArticleRow {
  id: number;
  public_id: string;
  site_id: string;
  slug: string;
  article_name: string;
  status: string;
  active_experiment_id: number | null;
}

export interface ListicleVersionRow {
  id: number;
  public_id: string;
  article_id: number;
  experiment_id: number | null;
  variant_label: string;
  is_control: number;
  traffic_allocation: number;
  headline: string;
  intro_paragraph: string;
  hero_media_id: number | null;
  hero_media_url: string | null;
  layout_style_id: string;
  byline_json: string | null;
  content_version: number;
  status: string;
}

interface ExperimentRow {
  id: number;
  public_id: string;
  status: string;
}

// ---------------------------------------------------------------------------
// Loaders
// ---------------------------------------------------------------------------

export async function loadPublishedListicle(
  db: D1Database,
  siteId: string,
  slug: string,
): Promise<ListicleArticleRow | null> {
  const row = await db
    .prepare(
      `SELECT id, public_id, site_id, slug, article_name, status, active_experiment_id
       FROM listicle_articles WHERE site_id = ? AND slug = ? LIMIT 1`,
    )
    .bind(siteId, slug)
    .first<ListicleArticleRow>();
  return row ?? null;
}

export async function loadActiveVersions(
  db: D1Database,
  articleId: number,
): Promise<ListicleVersionRow[]> {
  const rows = await db
    .prepare(
      `SELECT id, public_id, article_id, experiment_id, variant_label, is_control,
              traffic_allocation, headline, intro_paragraph, hero_media_id,
              hero_media_url, layout_style_id, byline_json, content_version, status
       FROM listicle_article_versions
       WHERE article_id = ? AND status = 'active' ORDER BY id ASC`,
    )
    .bind(articleId)
    .all<ListicleVersionRow>();
  return rows.results ?? [];
}

async function loadRunningExperiment(
  db: D1Database,
  article: ListicleArticleRow,
): Promise<ExperimentRow | null> {
  if (article.active_experiment_id === null) return null;
  const row = await db
    .prepare(
      `SELECT id, public_id, status FROM listicle_article_experiments
       WHERE id = ? AND status = 'running' LIMIT 1`,
    )
    .bind(article.active_experiment_id)
    .first<ExperimentRow>();
  return row ?? null;
}

async function loadSectionRows(
  db: D1Database,
  sectionIds: readonly number[],
): Promise<Map<number, RenderSectionRow>> {
  const map = new Map<number, RenderSectionRow>();
  const unique = [...new Set(sectionIds)];
  for (const ids of chunk(unique)) {
    if (ids.length === 0) continue;
    const rows = await db
      .prepare(
        `SELECT id, public_id, section_name, headline_text, headline_offer_id, image_json, content_json
         FROM listicle_sections WHERE id IN (${placeholders(ids.length)})`,
      )
      .bind(...ids)
      .all<RenderSectionRow>();
    for (const row of rows.results ?? []) map.set(row.id, row);
  }
  // §30.7: attach each section's __headline__ link-instance id (the ledger
  // row the Section save mints for a clickable headline) so the governed
  // headline anchor carries its lnk_… identity.
  for (const ids of chunk(unique)) {
    if (ids.length === 0) continue;
    const rows = await db
      .prepare(
        `SELECT section_id, public_id FROM listicle_section_link_instances
         WHERE link_role = 'headline' AND block_id = '__headline__'
           AND section_id IN (${placeholders(ids.length)})`,
      )
      .bind(...ids)
      .all<{ section_id: number; public_id: string }>();
    for (const row of rows.results ?? []) {
      const section = map.get(row.section_id);
      if (section !== undefined) section.headline_link_instance_id = row.public_id;
    }
  }
  return map;
}

async function loadSiteSettings(
  db: D1Database,
  siteId: string,
): Promise<Record<string, string>> {
  const result = await db
    .prepare("SELECT key AS key, value AS value FROM site_settings WHERE site_id = ?")
    .bind(siteId)
    .all<{ key: string; value: string | null }>();
  const settings: Record<string, string> = {};
  for (const row of result.results ?? []) {
    if (typeof row.value === "string") settings[row.key] = row.value;
  }
  return settings;
}

// HostLogo — the ONLY per-host brand swap (§30.3): logo_media_id (a media
// storage key, same source the homepage layout uses) with site_logo_url as
// the secondary setting; everything else on the page is token-owned.
function brandFromSettings(
  settings: Readonly<Record<string, string>>,
  hostname: string,
): { siteName: string; logoUrl: string | null } {
  const siteName =
    typeof settings.site_name === "string" && settings.site_name.trim() !== ""
      ? settings.site_name.trim()
      : hostname;
  let logoUrl = mediaUrl(settings.logo_media_id);
  if (logoUrl === null) {
    const direct = (settings.site_logo_url ?? "").trim();
    logoUrl = direct !== "" && isSafeUrl(direct) ? direct : null;
  }
  return { siteName, logoUrl };
}

async function resolveHeroUrl(
  db: D1Database,
  version: ListicleVersionRow,
): Promise<string | null> {
  if (version.hero_media_url !== null && version.hero_media_url !== "") {
    return version.hero_media_url;
  }
  if (version.hero_media_id === null) return null;
  const row = await db
    .prepare("SELECT storage_key FROM media WHERE id = ? LIMIT 1")
    .bind(version.hero_media_id)
    .first<{ storage_key: string }>();
  return row?.storage_key ? `/media/${row.storage_key}` : null;
}

// Resolve every data-offer reference (off_… public ids pass through when
// they exist; legacy numeric ids map via listicle_offers.id) → off_… id.
async function resolveOfferRefs(
  db: D1Database,
  refs: readonly string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const numeric: number[] = [];
  const publicIds: string[] = [];
  for (const ref of refs) {
    if (/^\d+$/.test(ref)) numeric.push(parseInt(ref, 10));
    else publicIds.push(ref);
  }
  for (const ids of chunk(numeric)) {
    if (ids.length === 0) continue;
    const rows = await db
      .prepare(
        `SELECT id, public_id FROM listicle_offers WHERE id IN (${placeholders(ids.length)})`,
      )
      .bind(...ids)
      .all<{ id: number; public_id: string }>();
    for (const row of rows.results ?? []) map.set(String(row.id), row.public_id);
  }
  for (const ids of chunk(publicIds)) {
    if (ids.length === 0) continue;
    const rows = await db
      .prepare(
        `SELECT public_id FROM listicle_offers WHERE public_id IN (${placeholders(ids.length)})`,
      )
      .bind(...ids)
      .all<{ public_id: string }>();
    for (const row of rows.results ?? []) map.set(row.public_id, row.public_id);
  }
  return map;
}

// Structure pages → renderer pages (rule public ids ride along for the
// governed URL `r` param; allocations + parsed rule conditions ride along
// for the §15.3 selector boot payload, Phase 7).
async function loadRenderPages(
  db: D1Database,
  versionId: number,
): Promise<RenderPage[]> {
  const byVersion = await loadPagesForVersions(db, [versionId]);
  const pages = byVersion.get(versionId) ?? [];
  return pages.map((page) => ({
    public_id: page.public_id,
    page_index: page.page_index,
    selection_mode: page.selection_mode,
    ab_test_id: page.ab_test_id,
    rule_set_id: page.rule_set_id,
    candidates: page.candidates.map((cand) => ({
      public_id: cand.public_id,
      section_id: cand.section_id,
      is_fallback: cand.is_fallback,
      rule_public_id: cand.rule?.public_id ?? null,
      section_public_id: cand.section_public_id,
      section_name: cand.section_name,
      traffic_allocation: cand.traffic_allocation,
      rule_priority: cand.rule?.priority ?? null,
      rule_conditions_json: cand.rule?.conditions_json ?? null,
      rule_conditions_hash: cand.rule?.conditions_hash ?? null,
    })),
  }));
}

// ---------------------------------------------------------------------------
// Shell render (shared by the live route AND the §22.2 warm pass)
// ---------------------------------------------------------------------------

export async function renderListicleShellForVersion(
  db: D1Database,
  site: { siteId: string; hostname: string },
  article: { public_id: string; slug: string; article_name?: string },
  version: ListicleVersionRow,
): Promise<{ html: string; lazyCandidateIds: string[] }> {
  const pages = await loadRenderPages(db, version.id);
  const sectionIds = pages.flatMap((page) => page.candidates.map((cand) => cand.section_id));
  const sections = await loadSectionRows(db, sectionIds);

  // Offer refs: block content + linked headlines.
  const refs = new Set<string>();
  for (const section of sections.values()) {
    for (const ref of collectOfferRefs(listicleBlocksToHtml(section.content_json))) {
      refs.add(ref);
    }
    const headlineRef = offerRefString(section.headline_offer_id);
    if (headlineRef !== "") refs.add(headlineRef);
  }
  const offerPublicIdByRef = await resolveOfferRefs(db, [...refs]);

  const settings = await loadSiteSettings(db, site.siteId);
  const heroUrl = await resolveHeroUrl(db, version);

  const input: ListicleRenderInput = {
    hostname: site.hostname,
    brand: brandFromSettings(settings, site.hostname),
    settings,
    siteId: site.siteId,
    article: {
      public_id: article.public_id,
      slug: article.slug,
      article_name: article.article_name ?? "",
    },
    version: {
      public_id: version.public_id,
      headline: version.headline,
      intro_paragraph: version.intro_paragraph,
      hero_url: heroUrl,
      byline_json: version.byline_json,
      layout_style_id: version.layout_style_id,
      content_version: version.content_version,
    },
    pages,
    sections,
    offerPublicIdByRef,
  };
  return renderListicleDocument(input);
}

// ---------------------------------------------------------------------------
// §15.2 + §22 — the /:slug listicle branch
// ---------------------------------------------------------------------------

// ETag material: the SAME identity as listicleKey (site, slug+lander_v,
// content_version, template_version).
function listicleEtag(
  siteId: string,
  slug: string,
  landerV: string,
  contentVersion: number,
): Promise<string> {
  return computeEtag({
    site_id: siteId,
    path: `/${slug}:${landerV}`,
    content_version: contentVersion,
  });
}

// Returns null when this slug is NOT a published listicle → the router's
// /:slug catch-all continues with its normal page/article/404 behavior
// (draft/scheduled/archived listicles fall through too — §7.2).
export async function tryServePublishedListicle(c: PublicContext): Promise<Response | null> {
  const slug = c.req.param("slug") ?? "";
  if (slug === "") return null;
  const siteContext = c.get("siteContext");
  const article = await loadPublishedListicle(c.env.DB, siteContext.siteId, slug);
  if (article === null || article.status !== "published") return null;

  const versions = await loadActiveVersions(c.env.DB, article.id);
  if (versions.length === 0) return null; // unservable → normal fallthrough

  // §15.2: sid → sticky pick over the running experiment's allocations.
  const cookieHeader = c.req.header("Cookie") ?? null;
  let sid = readCookie(cookieHeader, "ko_sid");
  const sidWasAbsent = sid === "";
  if (sidWasAbsent) sid = genSessionId();

  const experiment = await loadRunningExperiment(c.env.DB, article);
  let version: ListicleVersionRow | null;
  if (experiment !== null) {
    const arms = versions.filter((v) => v.experiment_id === experiment.id);
    version = arms.length > 0 ? stickyPick(sid, experiment.public_id, arms) : controlVersion(versions);
  } else {
    version = controlVersion(versions);
  }
  if (version === null) return null;

  const key = listicleKey(siteContext.siteId, article.slug, version.public_id, version.content_version);
  const etag = await listicleEtag(
    siteContext.siteId,
    article.slug,
    version.public_id,
    version.content_version,
  );

  // ---- Phase 7: per-request context (never part of the cache key) --------
  // ko_ctx acquisition cookie (§9.4/§16): merge landing params over the
  // previously captured context; refreshed on every listicle render.
  const query = c.req.query();
  const siteBehavior = await loadSiteBehaviorSettings(c.env.DB, siteContext.siteId);
  const koCtx = buildKoCtx({
    existing: parseKoCtx(readCookie(cookieHeader, KO_CTX_COOKIE)),
    query,
    landerV: version.public_id,
    siteLanguage: siteBehavior.language,
    acceptLanguage: c.req.header("Accept-Language") ?? null,
    nowMs: Date.now(),
  });

  const withCookies = (headers: Headers): Headers => {
    if (sidWasAbsent) headers.append("Set-Cookie", sessionCookie("ko_sid", sid));
    headers.append("Set-Cookie", sessionCookie("ko_ver", version.public_id));
    headers.append("Set-Cookie", serializeKoCtxCookie(koCtx));
    return headers;
  };

  const ifNoneMatch = c.req.header("If-None-Match") ?? null;
  if (matchesIfNoneMatch(ifNoneMatch, etag)) {
    return new Response(null, {
      status: 304,
      headers: withCookies(publicHtmlCacheHeaders({ etag })),
    });
  }

  // §15.4/§31.3 post-cache injection payload: request-time geo/device from
  // CF + UA, hour in the SITE timezone (register Q13), acquisition dims from
  // ko_ctx, and the LIVE experiment dims (§15.7 — request-time state, an
  // experiment can start/stop while shells stay cached).
  const cf = readCfSignals(c.req.raw);
  const uaDetails = parseClientUa(c.req.header("user-agent"));
  const exp: InjectedExperimentDims | null =
    experiment !== null
      ? {
          experiment_id: experiment.public_id,
          variant_id: version.public_id,
          variant_label: version.variant_label,
          split: version.traffic_allocation,
        }
      : null;
  const inject = (response: Response): Response =>
    injectListicleContext(response, {
      sid,
      ctx: buildRuleContext({
        geo: geoFromCf(cf),
        ua: { device: uaDetails.device, os: uaDetails.os, browser: uaDetails.browser },
        hourSiteTz: hourInTimezone(siteBehavior.timezone, new Date()),
        koCtx,
      }),
      exp,
    });

  const cached = await getCachedHtml(c.env, key);
  if (cached !== null) {
    // The KV entry stays byte-identical; the context script is injected on
    // the RESPONSE stream only (§15.4 post-cache HTMLRewriter).
    return inject(
      new Response(cached.body, {
        status: 200,
        headers: withCookies(publicHtmlCacheHeaders({ etag: cached.etag || etag })),
      }),
    );
  }

  const { html } = await renderListicleShellForVersion(
    c.env.DB,
    { siteId: siteContext.siteId, hostname: siteContext.hostname },
    article,
    version,
  );
  const ttl = parseNumber(c.env.HTML_CACHE_TTL_SECONDS, DEFAULT_HTML_CACHE_TTL_SECONDS);
  // Write-through stores the PRISTINE shell (visitor-invariant); the live
  // response below is the injected variant of the same bytes.
  await putCachedHtml(c.env, key, html, { expirationTtl: ttl, etag });
  return inject(
    new Response(html, {
      status: 200,
      headers: withCookies(publicHtmlCacheHeaders({ etag })),
    }),
  );
}

// site_settings behavior keys the Phase-7 context needs per request:
// `site_timezone` (register Q13 — the rules hour/daypart basis; "" → UTC)
// and `site_language` (register Q8 — the {language} fallback). One indexed
// point query; both default "" when unset.
async function loadSiteBehaviorSettings(
  db: D1Database,
  siteId: string,
): Promise<{ timezone: string; language: string }> {
  const result = await db
    .prepare(
      "SELECT key AS key, value AS value FROM site_settings WHERE site_id = ? AND key IN ('site_timezone', 'site_language')",
    )
    .bind(siteId)
    .all<{ key: string; value: string | null }>();
  let timezone = "";
  let language = "";
  for (const row of result.results ?? []) {
    if (row.key === "site_timezone" && typeof row.value === "string") timezone = row.value.trim();
    if (row.key === "site_language" && typeof row.value === "string") language = row.value.trim();
  }
  return { timezone, language };
}

// ---------------------------------------------------------------------------
// §22.4 — GET /lst-cand/:candidate_public_id (cached per-candidate fragment)
// ---------------------------------------------------------------------------

interface CandidateJoinRow {
  candidate_id: number;
  candidate_public_id: string;
  section_id: number;
  is_fallback: number;
  page_index: number;
  selection_mode: string;
  lander_v: string;
  version_content_version: number;
  version_status: string;
  article_public_id: string;
  article_status: string;
  site_id: string;
}

export async function serveListicleCandidate(c: PublicContext): Promise<Response> {
  const candidateId = c.req.param("cid") ?? "";
  const siteContext = c.get("siteContext");
  const row = await c.env.DB.prepare(
    `SELECT cand.id AS candidate_id, cand.public_id AS candidate_public_id,
            cand.section_id AS section_id, cand.is_fallback AS is_fallback,
            p.page_index AS page_index, p.selection_mode AS selection_mode,
            ver.public_id AS lander_v, ver.content_version AS version_content_version,
            ver.status AS version_status,
            a.public_id AS article_public_id, a.status AS article_status,
            a.site_id AS site_id
     FROM listicle_page_section_candidates cand
     JOIN listicle_pages p ON p.id = cand.page_id
     JOIN listicle_article_versions ver ON ver.id = p.article_version_id
     JOIN listicle_articles a ON a.id = ver.article_id
     WHERE cand.public_id = ? LIMIT 1`,
  )
    .bind(candidateId)
    .first<CandidateJoinRow>();

  // Tenant + lifecycle guards: the candidate must belong to a PUBLISHED
  // article of THIS site on an ACTIVE version — anything else is a plain 404
  // (no cross-tenant existence oracle).
  if (
    row === null ||
    row.site_id !== siteContext.siteId ||
    row.article_status !== "published" ||
    row.version_status !== "active"
  ) {
    return c.json({ error: "Not Found" }, 404);
  }

  const key = listicleCandidateKey(
    siteContext.siteId,
    row.candidate_public_id,
    row.version_content_version,
  );
  const etag = await computeEtag({
    site_id: siteContext.siteId,
    path: `/lst-cand/${row.candidate_public_id}`,
    content_version: row.version_content_version,
  });
  const ifNoneMatch = c.req.header("If-None-Match") ?? null;
  if (matchesIfNoneMatch(ifNoneMatch, etag)) {
    return new Response(null, { status: 304, headers: publicHtmlCacheHeaders({ etag }) });
  }
  const cached = await getCachedHtml(c.env, key);
  if (cached !== null) {
    return new Response(cached.body, {
      status: 200,
      headers: publicHtmlCacheHeaders({ etag: cached.etag || etag }),
    });
  }

  const sections = await loadSectionRows(c.env.DB, [row.section_id]);
  const section = sections.get(row.section_id);
  if (section === undefined) return c.json({ error: "Not Found" }, 404);

  const rule = await c.env.DB.prepare(
    "SELECT public_id FROM listicle_page_rules WHERE candidate_id = ? LIMIT 1",
  )
    .bind(row.candidate_id)
    .first<{ public_id: string }>();

  const refs = new Set<string>(collectOfferRefs(listicleBlocksToHtml(section.content_json)));
  const headlineRef = offerRefString(section.headline_offer_id);
  if (headlineRef !== "") refs.add(headlineRef);
  const offerPublicIdByRef = await resolveOfferRefs(c.env.DB, [...refs]);

  const ctx: GovernedUrlContext = {
    articlePublicId: row.article_public_id,
    landerV: row.lander_v,
    pageIndex: row.page_index,
    sectionPublicId: section.public_id,
    candidatePublicId: row.candidate_public_id,
    selectionMode: row.selection_mode,
    ruleId: rule?.public_id ?? "",
  };
  // The candidate's page ordinal drives the numbered badge (§30.1
  // numberBadge): ordinal = page_index + 1 (pages are 0-indexed contiguous).
  const layout = getLayout("default");
  const fragment = layout.renderSection(
    renderSectionCandidateHtml(section, row.page_index + 1, ctx, offerPublicIdByRef),
  );

  const ttl = parseNumber(c.env.HTML_CACHE_TTL_SECONDS, DEFAULT_HTML_CACHE_TTL_SECONDS);
  await putCachedHtml(c.env, key, fragment, { expirationTtl: ttl, etag });
  return new Response(fragment, { status: 200, headers: publicHtmlCacheHeaders({ etag }) });
}
