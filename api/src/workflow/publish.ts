// Phase-1 publish workflow: state machine + publish() entry point.
//
// The state machine enumerates exactly the legal { from -> to } pairs for
// Phase 1 (T6.AC1). Any transition not listed here MUST be rejected by
// `isValidTransition`. New transitions belong in this table — never as
// scattered status comparisons in callers.
//
// publish() (T6.AC2) is the canonical "draft -> published" path. It
// snapshots the pre-publish content into article_versions, renders the
// stored content_json to HTML via the editor module, flips the article
// row to status='published' with a fresh published_at, bumps the owning
// site's content_version monotonically (Phase 7 / T14.AC1 — keying the
// public cache namespace), and invalidates the per-site public-content
// cache surface (html/article/category/sitemap/feed) via
// invalidatePublishCaches (T14.AC2). The legacy invalidateFeeds() call is
// preserved for the pre-multi-tenant code path (article rows without
// site_id) so Phase 1/2 callers still see RSS/Atom invalidation.
//
// Hard rule (mirrors db/index.ts): every D1 call uses
// `db.prepare(<static SQL>).bind(...)` — NO template-literal SQL.

import { invalidateFeeds } from "../cache";
import type { ArticleRow } from "../db";
import { contentJsonToHtml } from "../editor";
import type { Env } from "../env";

export type ArticleStatus = "draft" | "published" | "scheduled" | "archived";

export interface StatusTransition {
  from: ArticleStatus;
  to: ArticleStatus;
}

// T6.AC1: exactly these six legal pairs (order matches the PRD wording).
export const VALID_TRANSITIONS: ReadonlyArray<StatusTransition> = [
  { from: "draft", to: "published" },
  { from: "draft", to: "scheduled" },
  { from: "scheduled", to: "published" },
  { from: "scheduled", to: "draft" },
  { from: "published", to: "archived" },
  { from: "published", to: "draft" },
];

export function isValidTransition(
  from: ArticleStatus,
  to: ArticleStatus,
): boolean {
  return VALID_TRANSITIONS.some((t) => t.from === from && t.to === to);
}

export interface PublishOptions {
  createdBy?: string;
  changeSummary?: string;
}

export async function publish(
  env: Env,
  articleId: number,
  options: PublishOptions = {},
): Promise<ArticleRow> {
  const article = await env.DB
    .prepare("SELECT * FROM articles WHERE id = ? LIMIT 1")
    .bind(articleId)
    .first<ArticleRow>();
  if (!article) throw new Error(`Article ${articleId} not found`);

  const from = article.status as ArticleStatus;
  if (!isValidTransition(from, "published")) {
    throw new Error(
      `Illegal transition from '${from}' to 'published' for article ${articleId}`,
    );
  }

  // (a) Snapshot pre-publish state into article_versions.
  await snapshotVersion(env, article, options);

  // (b) Render content_json -> HTML via editor module.
  const contentHtml = contentJsonToHtml(article.content_json);

  // (c) Flip article row to published with fresh published_at.
  const now = nowSeconds();
  await env.DB
    .prepare(
      "UPDATE articles SET status = 'published', content_html = ?, published_at = ?, scheduled_at = NULL, updated_at = ? WHERE id = ?",
    )
    .bind(contentHtml, now, now, articleId)
    .run();

  // (d) Phase-7 T14.AC1: monotonically bump the owning site's
  //     content_version so public cache keys (which suffix
  //     content_version) orphan the prior cached HTML/article/category/
  //     sitemap/feed entries. The site_id is the tenant scope — every
  //     prepared statement is parameterized so a missing site_id cannot
  //     turn into a cross-tenant bump.
  const siteId = article.site_id ?? null;
  if (siteId) {
    await env.DB
      .prepare(
        "UPDATE sites SET content_version = content_version + 1 WHERE id = ?",
      )
      .bind(siteId)
      .run();

    // T14.AC2: wipe the per-site public-content cache surface in the same
    // pass (explicit deletes are a courtesy — the version suffix already
    // orphans the entries — but the explicit pass keeps KV list-output
    // tight for operators and removes the stale entries from the LRU).
    await invalidatePublishCaches(env, siteId);
  } else {
    // (e) Legacy compatibility: pre-multi-tenant article rows have no
    //     site_id. Preserve the original Phase-1 feed-wipe (broad
    //     "feed:*" prefix) so RSS/Atom/sitemap still refresh after
    //     publish on those rows. Once article.site_id is populated in
    //     production the invalidatePublishCaches() path takes over.
    await invalidateFeeds(env);
  }

  return {
    ...article,
    status: "published",
    content_html: contentHtml,
    published_at: now,
    scheduled_at: null,
    updated_at: now,
  };
}

// T14.AC2: per-site cache wipe. Lists every key under the public-content
// namespaces (html, article, category, page, homepage-data, sitemap,
// feed:rss, feed:atom) scoped to the site_id and deletes them in pages.
// Versions are key SUFFIXES (see src/cache/cache-keys.ts) so the bumped
// content_version already prevents reads of stale entries; this explicit
// wipe just removes the orphans so KV list calls stay cheap.
const PUBLISH_CACHE_PREFIXES = [
  "html:",
  "article:",
  "category:",
  "page:",
  "homepage-data:",
  "sitemap:",
  "feed:rss:",
  "feed:atom:",
] as const;

export async function invalidatePublishCaches(
  env: Env,
  siteId: string,
): Promise<void> {
  for (const ns of PUBLISH_CACHE_PREFIXES) {
    const prefix = `${ns}${siteId}:`;
    let cursor: string | undefined;
    while (true) {
      const result: KVNamespaceListResult<unknown, string> =
        await env.CACHE.list({ prefix, cursor });
      for (const entry of result.keys) {
        await env.CACHE.delete(entry.name);
      }
      if (result.list_complete) break;
      cursor = result.cursor;
    }
  }
}

// Exported for reuse by the restore flow (versions.ts): restoring a
// version snapshots the CURRENT article state first so a restore is
// itself restore-able.
export async function snapshotVersion(
  env: Env,
  article: ArticleRow,
  options: PublishOptions,
): Promise<void> {
  const result = await env.DB
    .prepare(
      "SELECT COALESCE(MAX(version_number), 0) AS max_version FROM article_versions WHERE article_id = ?",
    )
    .bind(article.id)
    .first<{ max_version: number }>();
  const nextVersion = (result?.max_version ?? 0) + 1;

  await env.DB
    .prepare(
      "INSERT INTO article_versions (article_id, version_number, content_json, status, created_by, change_summary, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(
      article.id,
      nextVersion,
      article.content_json,
      article.status,
      options.createdBy ?? null,
      options.changeSummary ?? null,
      nowSeconds(),
    )
    .run();
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}
