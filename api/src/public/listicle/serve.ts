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
import type { RedirectRow } from "../queries";
import { cacheExecutionCtx } from "../html-pipeline";
import { listicleKey, listicleCandidateKey } from "../../cache/cache-keys";
import { publicHtmlCacheHeaders } from "../../cache/cache-control";
import {
  computeEtag,
  getCachedHtml,
  putCachedHtml,
  matchesIfNoneMatch,
} from "../../cache/edge-cache";
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
  type RenderCandidate,
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
import { withoutAiSetupLogo } from "../site-brand";

type PublicContext = Context<{ Bindings: Env; Variables: PublicSiteVariables }>;

const DEFAULT_HTML_CACHE_TTL_SECONDS = 300;

// ---------------------------------------------------------------------------
// Row shapes
// ---------------------------------------------------------------------------

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

interface PublishedVersionRow extends ListicleVersionRow {
  article_public_id: string;
  article_name: string;
  active_experiment_id: number | null;
  running_experiment: string | null;
  site_language: string | null;
  site_timezone: string | null;
}

// ---------------------------------------------------------------------------
// Loaders
// ---------------------------------------------------------------------------

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

function publishedVersionsStatement(
  db: D1Database,
  siteId: string,
  slug: string,
): D1PreparedStatement {
  return db.prepare(
    `SELECT a.public_id AS article_public_id, a.article_name, a.active_experiment_id,
            e.public_id AS running_experiment, lang.value AS site_language, tz.value AS site_timezone,
            v.id, v.public_id, v.article_id, v.experiment_id, v.variant_label, v.is_control,
            v.traffic_allocation, v.headline, v.intro_paragraph, v.hero_media_id, v.hero_media_url,
            v.layout_style_id, v.byline_json, v.content_version, v.status
     FROM listicle_articles a
     JOIN listicle_article_versions v ON v.article_id = a.id AND v.status = 'active'
     LEFT JOIN listicle_article_experiments e ON e.id = a.active_experiment_id AND e.status = 'running'
     LEFT JOIN site_settings lang ON lang.site_id = a.site_id AND lang.key = 'site_language'
     LEFT JOIN site_settings tz ON tz.site_id = a.site_id AND tz.key = 'site_timezone'
     WHERE a.site_id = ? AND a.slug = ? AND a.status = 'published'
     ORDER BY v.id ASC`,
  ).bind(siteId, slug);
}

// Both the shell and its lazy fragments use the same headline link identity.
// In old ledgers with duplicates the last headline row supplied the identity.
const RENDER_SECTIONS = `SELECT s.id, s.public_id, s.section_name, s.headline_text,
       s.headline_offer_id, s.image_json, s.content_json,
       (SELECT l.public_id FROM listicle_section_link_instances l
        WHERE l.section_id = s.id AND l.link_role = 'headline' AND l.block_id = '__headline__'
        ORDER BY l.id DESC LIMIT 1) AS headline_link_instance_id
     FROM listicle_sections s`;

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
  // X14 v2 (owner Q4, 22 Nov 2026): the same logo rule as the homepage —
  // uploaded /media/ logos only; the AI-made setup logo counts as none.
  let logoUrl = mediaUrl(settings.logo_media_id);
  if (logoUrl === null) {
    const direct = (settings.site_logo_url ?? "").trim();
    logoUrl = direct !== "" && isSafeUrl(direct) ? direct : null;
  }
  return { siteName, logoUrl: withoutAiSetupLogo(logoUrl) };
}

interface OfferRow {
  id: number;
  public_id: string;
}

// Resolve every data-offer reference (off_… public ids pass through when
// they exist; legacy numeric ids map via listicle_offers.id) → off_… id.
async function resolveOfferRefs(
  db: D1Database,
  refs: Iterable<string>,
  indexed: readonly OfferRow[] = [],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const row of indexed) {
    if (row.id >= 0) map.set(String(row.id), row.public_id);
    if (!/^\d+$/.test(row.public_id)) map.set(row.public_id, row.public_id);
  }
  // Older content can contain a governed anchor with no ledger row. Only the
  // block renderer can supply its exact ref (including HTML entity decoding).
  const numeric: number[] = [];
  const publicIds: string[] = [];
  for (const ref of refs) {
    if (map.has(ref)) continue;
    if (/^\d+$/.test(ref)) numeric.push(parseInt(ref, 10));
    else publicIds.push(ref);
  }
  if (numeric.length === 0 && publicIds.length === 0) return map;
  const rows = await db.prepare(
    `SELECT CAST(id AS TEXT) AS ref, public_id FROM listicle_offers WHERE id IN (SELECT value FROM json_each(?))
     UNION ALL
     SELECT public_id AS ref, public_id FROM listicle_offers WHERE public_id IN (SELECT value FROM json_each(?))`,
  ).bind(JSON.stringify(numeric), JSON.stringify(publicIds)).all<{ ref: string; public_id: string }>();
  for (const row of rows.results) map.set(row.ref, row.public_id);
  return map;
}

type ShellPageRow = Omit<RenderPage, "candidates"> & { id: number };
type ShellCandidateRow = RenderCandidate & { page_id: number };

type ShellRows = [
  D1Result<ShellPageRow>,
  D1Result<ShellCandidateRow>,
  D1Result<RenderSectionRow>,
  D1Result<OfferRow>,
  D1Result<{ key: string; value: string | null }>,
  D1Result<{ storage_key: string }>?,
];

// The gateway already picked a public version ID. Each shell read can resolve
// it by index, with the same tenant, slug and lifecycle checks as the version row.
const SELECTED_VERSION_ID = `(SELECT v.id FROM listicle_article_versions v
  JOIN listicle_articles a ON a.id = v.article_id
  WHERE a.site_id = ? AND a.slug = ? AND v.public_id = ?
    AND a.status = 'published' AND v.status = 'active')`;

function shellStatements(
  db: D1Database, siteId: string,
  version: ListicleVersionRow | { slug: string; publicId: string },
) {
  const byId = "id" in version;
  const versionId = byId ? "?" : SELECTED_VERSION_ID;
  const binds = byId ? [version.id] : [siteId, version.slug, version.publicId];
  const versionSections = `WITH version_sections AS (
    SELECT c.section_id FROM listicle_pages p
    JOIN listicle_page_section_candidates c ON c.page_id = p.id
    WHERE p.article_version_id = ` + versionId + ")";
  const indexedOffers = `SELECT id, public_id FROM listicle_offers WHERE id IN (
    SELECT offer_id FROM listicle_section_link_instances WHERE section_id IN (SELECT section_id FROM version_sections)
    UNION ALL
    SELECT offer_id FROM listicle_section_offers WHERE section_id IN (SELECT section_id FROM version_sections)
    UNION ALL
    SELECT headline_offer_id FROM listicle_sections WHERE id IN (SELECT section_id FROM version_sections)
  )`;
  // Structured block refs can be looked up by either index, including refs
  // in older documents without link instances. Raw inline HTML can encode a
  // different ref after sanitization. In that case include the global offer
  // ID aliases so the block renderer can perform the exact lookup locally.
  const selectedOffers = `, documents AS (
    SELECT content_json FROM listicle_sections WHERE id IN (SELECT section_id FROM version_sections)
  ), fields AS (
    SELECT field.key, field.atom FROM documents,
      json_tree(CASE WHEN json_valid(content_json) THEN content_json END) field
    WHERE field.atom IS NOT NULL
  ), refs AS (SELECT trim(atom) AS ref FROM fields WHERE key = 'offer_id'),
  needs_aliases AS (
    SELECT 1 FROM documents WHERE NOT json_valid(content_json)
    UNION ALL
    SELECT 1 FROM fields WHERE
      (instr(atom, '<') AND instr(atom, '-')) OR (instr(atom, '&') AND instr(atom, ';'))
      OR instr(atom, char(0))
      OR (key = 'offer_id' AND trim(atom) GLOB '*[^a-zA-Z0-9_-]*')
    LIMIT 1
  )
  SELECT id, public_id FROM (` + indexedOffers + `
    UNION
    SELECT id, public_id FROM listicle_offers WHERE id IN (SELECT ref FROM refs) OR public_id IN (SELECT ref FROM refs)
  ) WHERE NOT EXISTS (SELECT 1 FROM needs_aliases)
  UNION ALL
  SELECT o.id, o.public_id FROM needs_aliases CROSS JOIN listicle_offers o`;
  const statements = [
    db.prepare(`SELECT id, public_id, page_index, selection_mode, ab_test_id, rule_set_id
      FROM listicle_pages WHERE article_version_id = ` + versionId + " ORDER BY page_index").bind(...binds),
    db.prepare("WITH version_pages AS (SELECT id FROM listicle_pages WHERE article_version_id = " + versionId + `)
      SELECT c.page_id, c.public_id, c.section_id, c.is_fallback, c.traffic_allocation,
             s.public_id AS section_public_id, s.section_name,
             r.public_id AS rule_public_id, r.priority AS rule_priority,
             r.conditions_json AS rule_conditions_json, r.conditions_hash AS rule_conditions_hash
      FROM listicle_page_section_candidates c
      JOIN listicle_sections s ON s.id = c.section_id
      LEFT JOIN listicle_page_rules r ON r.candidate_id = c.id AND r.page_id IN (SELECT id FROM version_pages)
      WHERE c.page_id IN (SELECT id FROM version_pages) ORDER BY c.id`).bind(...binds),
    db.prepare(versionSections + "\n" + RENDER_SECTIONS +
      " WHERE s.id IN (SELECT section_id FROM version_sections)").bind(...binds),
    db.prepare(versionSections + (byId ? "\n" + indexedOffers : selectedOffers)).bind(...binds),
    db.prepare("SELECT key, value FROM site_settings WHERE site_id = ?").bind(siteId),
  ];
  if (!byId) {
    statements.push(db.prepare(`SELECT m.storage_key FROM listicle_article_versions v
      JOIN media m ON m.id = v.hero_media_id WHERE v.id = ` + versionId +
      " AND COALESCE(v.hero_media_url, '') = ''").bind(...binds));
  } else if (!version.hero_media_url && version.hero_media_id !== null) {
    statements.push(db.prepare("SELECT storage_key FROM media WHERE id = ?").bind(version.hero_media_id));
  }
  return statements;
}

// ---------------------------------------------------------------------------
// Shell render (shared by the live route AND the §22.2 warm pass)
// ---------------------------------------------------------------------------

export async function renderListicleShellForVersion(
  db: D1Database,
  site: { siteId: string; hostname: string },
  article: { public_id: string; slug: string; article_name?: string },
  version: ListicleVersionRow,
  preload?: ShellRows,
): Promise<{ html: string; lazyCandidateIds: string[] }> {
  const [pageRows, candidateRows, sectionRows, offerRows, settingRows, mediaRows] =
    preload ?? await db.batch(shellStatements(db, site.siteId, version)) as ShellRows;
  const pages = new Map<number, RenderPage>();
  for (const { id, ...page } of pageRows.results) pages.set(id, { ...page, candidates: [] });
  for (const { page_id, ...candidate } of candidateRows.results) pages.get(page_id)!.candidates.push(candidate);
  const sections = new Map(sectionRows.results.map((section) => [section.id, section]));

  // Selected shells already have the aliases needed by the block renderer.
  // For a warm pass or a direct request, resolve any refs absent from the ledger.
  const refs = new Set<string>();
  if (preload === undefined) {
    for (const section of sections.values()) {
      for (const ref of collectOfferRefs(listicleBlocksToHtml(section.content_json))) {
        refs.add(ref);
      }
      const headlineRef = offerRefString(section.headline_offer_id);
      if (headlineRef !== "") refs.add(headlineRef);
    }
  }
  const offerPublicIdByRef = await resolveOfferRefs(db, refs, offerRows.results);
  const settings: Record<string, string> = {};
  for (const { key, value } of settingRows.results) {
    if (typeof value === "string") settings[key] = value;
  }
  const storageKey = mediaRows?.results[0]?.storage_key;
  const heroUrl = version.hero_media_url || (storageKey ? `/media/${storageKey}` : null);

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
    pages: [...pages.values()],
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
  version: ListicleVersionRow,
): Promise<string> {
  return computeEtag({
    site_id: siteId,
    path: `/${slug}:${version.public_id}`,
    content_version: version.content_version,
  });
}

async function serveListicleShell(
  c: PublicContext,
  article: ListicleRenderInput["article"],
  version: ListicleVersionRow,
  etag: string,
  preload?: ShellRows,
): Promise<Response> {
  const site = c.get("siteContext");
  const key = listicleKey(site.siteId, article.slug, version.public_id, version.content_version);
  const waitUntil = cacheExecutionCtx(c);
  const cached = await getCachedHtml(c.env, key, waitUntil);
  if (cached !== null) {
    return new Response(cached.body, {
      status: 200,
      headers: publicHtmlCacheHeaders({ etag: cached.etag || etag }),
    });
  }

  const { html } = await renderListicleShellForVersion(c.env.DB, site, article, version, preload);
  const ttl = parseNumber(c.env.HTML_CACHE_TTL_SECONDS, DEFAULT_HTML_CACHE_TTL_SECONDS);
  await putCachedHtml(c.env, key, html, { expirationTtl: ttl, etag }, waitUntil);
  return new Response(html, { status: 200, headers: publicHtmlCacheHeaders({ etag }) });
}

export async function loadSelectedListicle(
  db: D1Database, siteId: string, slug: string, publicId: string,
) {
  const [redirect, published, ...shell] = await db.batch([
    // Same tenant-first, active redirect as checkRedirect in ../queries.
    db.prepare(`SELECT destination_path, status_code FROM redirects
      WHERE source_path = ? AND is_active = 1 AND (site_id = ? OR site_id IS NULL)
      ORDER BY site_id IS NULL LIMIT 1`).bind("/" + slug, siteId),
    publishedVersionsStatement(db, siteId, slug),
    ...shellStatements(db, siteId, { slug, publicId }),
  ]) as [D1Result<RedirectRow>, D1Result<PublishedVersionRow>, ...ShellRows];
  return { redirect: redirect.results[0] ?? null, versions: published.results, shell };
}

// Returns null when this slug is NOT a published listicle → the router's
// /:slug catch-all continues with its normal page/article/404 behavior
// (draft/scheduled/archived listicles fall through too — §7.2).
export async function tryServePublishedListicle(
  c: PublicContext,
  preload?: { versions: PublishedVersionRow[]; shell: ShellRows },
): Promise<Response | null> {
  const slug = c.req.param("slug") ?? "";
  if (slug === "") return null;
  const siteContext = c.get("siteContext");
  const db = c.env.DB;
  const variant = c.req.header("x-cms-variant");
  const versions = preload?.versions ??
    (await publishedVersionsStatement(db, siteContext.siteId, slug).all<PublishedVersionRow>()).results;
  const first = versions[0];
  if (first === undefined) return null; // No published article with an active version.
  const article = { public_id: first.article_public_id, slug, article_name: first.article_name };

  // The gateway handles visitor cookies, context injection and conditional requests
  // for versions that still belong to this published listicle.
  if (variant?.startsWith("lst:")) {
    const versionPublicId = variant.slice(4);
    const selected = versions.find((version) => version.public_id === versionPublicId);
    if (selected !== undefined) {
      const etag = await listicleEtag(siteContext.siteId, article.slug, selected);
      return serveListicleShell(c, article, selected, etag, preload?.shell);
    }
  }

  // §15.2: sid → sticky pick over the running experiment's allocations.
  const cookieHeader = c.req.header("Cookie") ?? null;
  let sid = readCookie(cookieHeader, "ko_sid");
  const sidWasAbsent = sid === "";
  if (sidWasAbsent) sid = genSessionId();

  const experiment = first.running_experiment;
  let version: ListicleVersionRow | null;
  if (experiment !== null) {
    const arms = versions.filter((v) => v.experiment_id === first.active_experiment_id);
    version = arms.length > 0 ? stickyPick(sid, experiment, arms) : controlVersion(versions);
  } else {
    version = controlVersion(versions);
  }
  if (version === null) return null;

  const etag = await listicleEtag(siteContext.siteId, article.slug, version);

  // ---- Phase 7: per-request context (never part of the cache key) --------
  // ko_ctx acquisition cookie (§9.4/§16): merge landing params over the
  // previously captured context; refreshed on every listicle render.
  const query = c.req.query();
  const koCtx = buildKoCtx({
    existing: parseKoCtx(readCookie(cookieHeader, KO_CTX_COOKIE)),
    query,
    landerV: version.public_id,
    siteLanguage: typeof first.site_language === "string" ? first.site_language.trim() : "",
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
          experiment_id: experiment,
          variant_id: version.public_id,
          variant_label: version.variant_label,
          split: version.traffic_allocation,
        }
      : null;
  const shell = await serveListicleShell(c, article, version, etag);
  withCookies(shell.headers);
  return injectListicleContext(shell, {
    sid,
    ctx: buildRuleContext({
      geo: geoFromCf(cf),
      ua: { device: uaDetails.device, os: uaDetails.os, browser: uaDetails.browser },
      hourSiteTz: hourInTimezone(typeof first.site_timezone === "string" ? first.site_timezone.trim() : "", new Date()),
      koCtx,
    }),
    exp,
  });
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
  const waitUntil = cacheExecutionCtx(c);
  const cached = await getCachedHtml(c.env, key, waitUntil);
  if (cached !== null) {
    return new Response(cached.body, {
      status: 200,
      headers: publicHtmlCacheHeaders({ etag: cached.etag || etag }),
    });
  }

  const section = await c.env.DB.prepare(RENDER_SECTIONS + " WHERE s.id = ?")
    .bind(row.section_id).first<RenderSectionRow>();
  if (section === null) return c.json({ error: "Not Found" }, 404);

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
  await putCachedHtml(c.env, key, fragment, { expirationTtl: ttl, etag }, waitUntil);
  return new Response(fragment, { status: 200, headers: publicHtmlCacheHeaders({ etag }) });
}
