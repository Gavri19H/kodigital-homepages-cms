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
import { onPublicChange } from "../edge/public-change";
import { listicleTag } from "../edge/tags";
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
  // Phase 7: the warm render passes article_name into the shell boot data —
  // it MUST match what the live cold-render emits so the warmed KV entry is
  // byte-identical to a live render of the same version. Optional at the
  // call-site (the publish handler predates the field); resolved from D1
  // when absent.
  article_name?: string;
  status: string;
}

export interface ListicleFanOutResult {
  affected_versions: number;
  affected_articles: number;
  cache_keys_deleted: number;
  shells_warmed: number;
}

interface SectionConsumer extends AffectedArticle {
  version_id: number;
  version_status: string;
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

async function loadSectionConsumers(db: D1Database, sectionIds: number[]): Promise<SectionConsumer[]> {
  const rows = await db.prepare(
    `SELECT DISTINCT a.id, a.public_id, a.site_id, a.slug, a.article_name, a.status,
            ver.id AS version_id, ver.status AS version_status
     FROM listicle_page_section_candidates cand
     JOIN listicle_pages p ON p.id = cand.page_id
     JOIN listicle_article_versions ver ON ver.id = p.article_version_id
     JOIN listicle_articles a ON a.id = ver.article_id
     WHERE cand.section_id IN (SELECT value FROM json_each(?))
     ORDER BY a.site_id, a.id, ver.id`,
  ).bind(JSON.stringify(sectionIds)).all<SectionConsumer>();
  return rows.results;
}

function isLiveConsumer(row: SectionConsumer): boolean {
  return row.status === "published" && row.version_status === "active";
}

async function purgeLiveConsumers(
  env: Env,
  consumers: SectionConsumer[],
  reason: string,
  ctx?: ExecutionContext,
): Promise<void> {
  const tagsBySite = new Map<string, Set<string>>();
  for (const consumer of consumers.filter(isLiveConsumer)) {
    let tags = tagsBySite.get(consumer.site_id);
    if (!tags) {
      tags = new Set<string>();
      tagsBySite.set(consumer.site_id, tags);
    }
    tags.add(listicleTag(consumer.public_id));
  }
  for (const [siteId, tags] of tagsBySite) {
    await onPublicChange(env, ctx, { siteId, tags: [...tags], reason });
  }
}

async function bumpConsumerVersions(
  db: D1Database,
  consumers: SectionConsumer[],
): Promise<void> {
  for (const ids of chunk(consumers.map(row => row.version_id))) {
    await db
      .prepare(
        `UPDATE listicle_article_versions
         SET content_version = content_version + 1
         WHERE id IN (${placeholders(ids.length)})`,
      )
      .bind(...ids)
      .run();
  }
}

// §22.2 — Preserve the legacy bump for ALL consuming versions. Only active
// versions of published articles can render a public shell or candidate.
export async function fanOutSectionInvalidate(
  env: Env,
  db: D1Database,
  sectionId: number,
  ctx?: ExecutionContext,
): Promise<ListicleFanOutResult> {
  const consumers = await loadSectionConsumers(db, [sectionId]);
  await bumpConsumerVersions(db, consumers);
  // The new revisions are readable now. Release the old edge shells before
  // the per-article legacy warm, which can take longer for a shared section.
  await purgeLiveConsumers(env, consumers, "listicle.section.update", ctx);
  const articles = [...new Map(consumers.map(row => [row.id, row])).values()];
  const { deleted, warmed } = await invalidateAndWarmArticles(env, db, articles);
  return {
    affected_versions: consumers.length,
    affected_articles: articles.length,
    cache_keys_deleted: deleted,
    shells_warmed: warmed,
  };
}

export async function purgeSectionConsumers(
  env: Env,
  sectionId: number,
  reason: string,
  ctx?: ExecutionContext,
): Promise<void> {
  const consumers = await loadSectionConsumers(env.DB, [sectionId]);
  await purgeLiveConsumers(env, consumers, reason, ctx);
}

export async function invalidateOfferSections(
  env: Env,
  sectionIds: number[],
  reason: string,
  ctx?: ExecutionContext,
): Promise<void> {
  if (sectionIds.length === 0) return;
  const consumers = (await loadSectionConsumers(env.DB, sectionIds)).filter(isLiveConsumer);
  // Both shell and lazy candidate KV keys include the version's revision.
  await bumpConsumerVersions(env.DB, consumers);
  await purgeLiveConsumers(env, consumers, reason, ctx);
}

// §7.1 publish → invalidate + warm the published article's per-lander_v
// shells (replaces the Phase-2 TODO(listicles-phase6) marker).
export async function invalidateAndWarmOnPublish(
  env: Env,
  db: D1Database,
  article: AffectedArticle,
  ctx?: ExecutionContext,
): Promise<ListicleFanOutResult> {
  // Phase 7: resolve article_name when the caller predates the field so the
  // warmed shell's boot data is byte-identical to a live cold render.
  if (article.article_name === undefined) {
    const row = await db
      .prepare("SELECT article_name FROM listicle_articles WHERE id = ? LIMIT 1")
      .bind(article.id)
      .first<{ article_name: string }>();
    article = { ...article, article_name: row?.article_name ?? "" };
  }
  const { deleted, warmed } = await invalidateAndWarmArticles(env, db, [article]);
  await onPublicChange(env, ctx, {
    siteId: article.site_id, tags: [listicleTag(article.public_id)], reason: "listicle.article.publish",
  });
  return {
    affected_versions: 0,
    affected_articles: 1,
    cache_keys_deleted: deleted,
    shells_warmed: warmed,
  };
}
