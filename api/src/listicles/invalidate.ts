// §22.2 Section fan-out invalidation + §7.1 publish invalidate/warm.
//
// On Section save: walk the consumption graph
//   listicle_page_section_candidates → listicle_pages →
//   listicle_article_versions → listicle_articles,
// bump each affected VERSION's content_version (a NEW cache identity for
// that lander_v — §15.6/§30.7 "a content_version bump does not create a new
// lander_v, it creates a new cache key"), then per affected site run
// invalidate (targeted `html:{site}:/{slug}:` prefix wipe — the courtesy
// pass; the version bump is the correctness mechanism, exactly like
// cache/invalidate.ts documents) + warm (in-process re-render of each
// PUBLISHED article's active-Version shells through the SAME renderer the
// live route uses — zero outbound fetch, the warmHomepageInProcess stance).
//
// The version bump is AWAITED business logic (D1 rule: fire-and-forget
// writes with downstream reads = bug); the KV invalidate + warm passes are
// best-effort (per-target failures never fail the admin save).

import type { Env } from "../env";
import { chunk, placeholders } from "../admin/listicles/shared";
import { listicleKey } from "../cache/cache-keys";
import { computeEtag, putCachedHtml } from "../cache/edge-cache";
import { parseNumber } from "../env";
import {
  loadActiveVersions,
  renderListicleShellForVersion,
  type ListicleVersionRow,
} from "../public/listicle/serve";

const DEFAULT_HTML_CACHE_TTL_SECONDS = 300;

export interface AffectedArticle {
  id: number;
  public_id: string;
  site_id: string;
  slug: string;
  status: string;
}

export interface ListicleFanOutResult {
  affected_versions: number;
  affected_articles: number;
  cache_keys_deleted: number;
  shells_warmed: number;
}

interface AffectedVersionRow {
  id: number;
  article_id: number;
}

// Delete every cached shell (all lander_v × content_version variants) of one
// article: the listicleKey wire format is `html:{site}:/{slug}:{lander_v}:…`,
// so the per-article prefix is `html:{site}:/{slug}:`.
async function deleteArticleShellKeys(
  env: Env,
  siteId: string,
  slug: string,
): Promise<number> {
  const prefix = `html:${siteId}:/${slug}:`;
  let cursor: string | undefined;
  let deleted = 0;
  while (true) {
    const result: KVNamespaceListResult<unknown, string> = await env.CACHE.list({
      prefix,
      cursor,
    });
    for (const entry of result.keys) {
      await env.CACHE.delete(entry.name);
      deleted += 1;
    }
    if (result.list_complete) break;
    cursor = result.cursor;
  }
  return deleted;
}

// Primary active hostname for a site (the warm render needs the canonical
// tenant host for head/canonical composition). No servable domain → the
// warm pass for that site is skipped (invalidation still ran).
async function primaryHostname(db: D1Database, siteId: string): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT hostname FROM domains WHERE site_id = ? AND status = 'active'
       ORDER BY is_primary DESC, id ASC LIMIT 1`,
    )
    .bind(siteId)
    .first<{ hostname: string }>();
  return row?.hostname ?? null;
}

// In-process warm of every ACTIVE Version shell of one published article
// (each Version = its own cached shell under its lander_v — §15.2/§22).
async function warmArticleShells(
  env: Env,
  db: D1Database,
  article: AffectedArticle,
  hostname: string,
): Promise<number> {
  const versions = await loadActiveVersions(db, article.id);
  const ttl = parseNumber(env.HTML_CACHE_TTL_SECONDS, DEFAULT_HTML_CACHE_TTL_SECONDS);
  let warmed = 0;
  for (const version of versions as ListicleVersionRow[]) {
    try {
      const { html } = await renderListicleShellForVersion(
        db,
        { siteId: article.site_id, hostname },
        article,
        version,
      );
      const key = listicleKey(article.site_id, article.slug, version.public_id, version.content_version);
      const etag = await computeEtag({
        site_id: article.site_id,
        path: `/${article.slug}:${version.public_id}`,
        content_version: version.content_version,
      });
      await putCachedHtml(env, key, html, { expirationTtl: ttl, etag });
      warmed += 1;
    } catch {
      // best-effort: a failed warm target never fails the save/publish.
    }
  }
  return warmed;
}

// Shared invalidate+warm tail for a set of affected articles.
async function invalidateAndWarmArticles(
  env: Env,
  db: D1Database,
  articles: readonly AffectedArticle[],
): Promise<{ deleted: number; warmed: number }> {
  let deleted = 0;
  let warmed = 0;
  const hostnameBySite = new Map<string, string | null>();
  for (const article of articles) {
    try {
      deleted += await deleteArticleShellKeys(env, article.site_id, article.slug);
    } catch {
      // courtesy pass only — the content_version bump already changed identity.
    }
    if (article.status !== "published") continue; // draft/scheduled/archived: nothing servable to warm
    try {
      if (!hostnameBySite.has(article.site_id)) {
        hostnameBySite.set(article.site_id, await primaryHostname(db, article.site_id));
      }
      const hostname = hostnameBySite.get(article.site_id) ?? null;
      if (hostname === null) continue;
      warmed += await warmArticleShells(env, db, article, hostname);
    } catch {
      // BEST-EFFORT (warm.ts stance): a failed warm target — including a
      // deployment where the domains registry is absent — never fails the
      // admin save/publish. Invalidation correctness rests on the version
      // bump, not on this pass.
    }
  }
  return { deleted, warmed };
}

// §22.2 — Section save fan-out. Returns counts for observability/tests.
export async function fanOutSectionInvalidate(
  env: Env,
  db: D1Database,
  sectionId: number,
): Promise<ListicleFanOutResult> {
  // 1. affected versions via candidates → pages → versions.
  const versionRows = await db
    .prepare(
      `SELECT DISTINCT ver.id AS id, ver.article_id AS article_id
       FROM listicle_page_section_candidates cand
       JOIN listicle_pages p ON p.id = cand.page_id
       JOIN listicle_article_versions ver ON ver.id = p.article_version_id
       WHERE cand.section_id = ?`,
    )
    .bind(sectionId)
    .all<AffectedVersionRow>();
  const versions = versionRows.results ?? [];
  if (versions.length === 0) {
    return { affected_versions: 0, affected_articles: 0, cache_keys_deleted: 0, shells_warmed: 0 };
  }

  // 2. bump each affected Version's content_version → new lander_v cache
  //    identity (AWAITED — correctness mechanism).
  for (const ids of chunk(versions.map((v) => v.id))) {
    await db
      .prepare(
        `UPDATE listicle_article_versions
         SET content_version = content_version + 1
         WHERE id IN (${placeholders(ids.length)})`,
      )
      .bind(...ids)
      .run();
  }

  // 3. affected articles.
  const articleIds = [...new Set(versions.map((v) => v.article_id))];
  const articles: AffectedArticle[] = [];
  for (const ids of chunk(articleIds)) {
    const rows = await db
      .prepare(
        `SELECT id, public_id, site_id, slug, status FROM listicle_articles
         WHERE id IN (${placeholders(ids.length)})`,
      )
      .bind(...ids)
      .all<AffectedArticle>();
    articles.push(...(rows.results ?? []));
  }

  // 4. per-site invalidate + warm.
  const { deleted, warmed } = await invalidateAndWarmArticles(env, db, articles);
  return {
    affected_versions: versions.length,
    affected_articles: articles.length,
    cache_keys_deleted: deleted,
    shells_warmed: warmed,
  };
}

// §7.1 publish → invalidate + warm the published article's per-lander_v
// shells (replaces the Phase-2 TODO(listicles-phase6) marker).
export async function invalidateAndWarmOnPublish(
  env: Env,
  db: D1Database,
  article: AffectedArticle,
): Promise<ListicleFanOutResult> {
  const { deleted, warmed } = await invalidateAndWarmArticles(env, db, [article]);
  return {
    affected_versions: 0,
    affected_articles: 1,
    cache_keys_deleted: deleted,
    shells_warmed: warmed,
  };
}
