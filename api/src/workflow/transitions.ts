// T26 ([B5]): the non-publish workflow transitions from the legacy admin —
// unpublish / schedule / cancel-schedule / archive. Each one is validated
// against the same VALID_TRANSITIONS table publish() uses (never scattered
// status comparisons in callers).
//
// Cache semantics: transitions that LEAVE 'published' (unpublish, archive)
// change the public surface, so they bump the owning site's
// content_version (orphaning versioned public cache keys) and wipe the
// per-site cache namespaces — exactly mirroring publish()'s entry into
// 'published'. Draft-side transitions (schedule, cancel-schedule) touch
// nothing public and therefore do NOT bump.
//
// Hard rule (mirrors db/index.ts): every D1 call uses
// `db.prepare(<static SQL>).bind(...)` — NO template-literal SQL.

import { invalidateFeeds } from "../cache";
import type { ArticleRow } from "../db";
import type { Env } from "../env";
import {
  invalidatePublishCaches,
  isValidTransition,
  type ArticleStatus,
} from "./publish";

async function loadArticle(env: Env, articleId: number): Promise<ArticleRow> {
  const article = await env.DB
    .prepare("SELECT * FROM articles WHERE id = ? LIMIT 1")
    .bind(articleId)
    .first<ArticleRow>();
  if (!article) throw new Error(`Article ${articleId} not found`);
  return article;
}

function assertTransition(
  articleId: number,
  from: ArticleStatus,
  to: ArticleStatus,
): void {
  if (!isValidTransition(from, to)) {
    throw new Error(
      `Illegal transition from '${from}' to '${to}' for article ${articleId}`,
    );
  }
}

// Leaving 'published' invalidates the public surface: bump the tenant's
// content_version (cache keys suffix it) and wipe the per-site
// namespaces. Legacy rows without site_id fall back to the broad
// feed-wipe, matching publish().
async function invalidatePublicSurface(
  env: Env,
  siteId: string | null,
): Promise<void> {
  if (siteId) {
    await env.DB
      .prepare(
        "UPDATE sites SET content_version = content_version + 1 WHERE id = ?",
      )
      .bind(siteId)
      .run();
    await invalidatePublishCaches(env, siteId);
  } else {
    await invalidateFeeds(env);
  }
}

export async function unpublish(
  env: Env,
  articleId: number,
): Promise<ArticleRow> {
  const article = await loadArticle(env, articleId);
  assertTransition(articleId, article.status as ArticleStatus, "draft");
  const now = nowSeconds();
  await env.DB
    .prepare(
      "UPDATE articles SET status = 'draft', published_at = NULL, updated_at = ? WHERE id = ?",
    )
    .bind(now, articleId)
    .run();
  await invalidatePublicSurface(env, article.site_id ?? null);
  return { ...article, status: "draft", published_at: null, updated_at: now };
}

export async function archive(
  env: Env,
  articleId: number,
): Promise<ArticleRow> {
  const article = await loadArticle(env, articleId);
  assertTransition(articleId, article.status as ArticleStatus, "archived");
  const now = nowSeconds();
  await env.DB
    .prepare(
      "UPDATE articles SET status = 'archived', updated_at = ? WHERE id = ?",
    )
    .bind(now, articleId)
    .run();
  await invalidatePublicSurface(env, article.site_id ?? null);
  return { ...article, status: "archived", updated_at: now };
}

export async function schedule(
  env: Env,
  articleId: number,
  scheduledAt: number,
): Promise<ArticleRow> {
  if (!Number.isFinite(scheduledAt) || scheduledAt <= 0) {
    throw new Error(`Invalid scheduled_at for article ${articleId}`);
  }
  const article = await loadArticle(env, articleId);
  assertTransition(articleId, article.status as ArticleStatus, "scheduled");
  const now = nowSeconds();
  await env.DB
    .prepare(
      "UPDATE articles SET status = 'scheduled', scheduled_at = ?, updated_at = ? WHERE id = ?",
    )
    .bind(scheduledAt, now, articleId)
    .run();
  return {
    ...article,
    status: "scheduled",
    scheduled_at: scheduledAt,
    updated_at: now,
  };
}

export async function cancelSchedule(
  env: Env,
  articleId: number,
): Promise<ArticleRow> {
  const article = await loadArticle(env, articleId);
  assertTransition(articleId, article.status as ArticleStatus, "draft");
  if (article.status !== "scheduled") {
    throw new Error(
      `Illegal transition from '${article.status}' to 'draft' for article ${articleId}: not scheduled`,
    );
  }
  const now = nowSeconds();
  await env.DB
    .prepare(
      "UPDATE articles SET status = 'draft', scheduled_at = NULL, updated_at = ? WHERE id = ?",
    )
    .bind(now, articleId)
    .run();
  return { ...article, status: "draft", scheduled_at: null, updated_at: now };
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}
