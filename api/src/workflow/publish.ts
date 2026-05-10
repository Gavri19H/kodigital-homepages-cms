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
// row to status='published' with a fresh published_at, and finally
// invalidates the feed cache so RSS/Atom/sitemap reflect the new article.
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

  // (d) Invalidate feed cache so RSS/Atom/sitemap reflect the new article.
  await invalidateFeeds(env);

  return {
    ...article,
    status: "published",
    content_html: contentHtml,
    published_at: now,
    scheduled_at: null,
    updated_at: now,
  };
}

async function snapshotVersion(
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
