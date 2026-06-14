// T26 ([B5]): article version history — list / get / restore over the
// article_versions table (snapshots written by publish() and by restore
// itself). Restore semantics from the legacy admin:
//   1. Snapshot the CURRENT article state into article_versions (so a
//      restore is itself restore-able).
//   2. Copy the chosen version's content_json back onto the article row.
// Restore touches the EDITING surface only — status, published_at and the
// rendered content_html are untouched until the next publish(), so no
// content_version bump happens here.
//
// Hard rule (mirrors db/index.ts): every D1 call uses
// `db.prepare(<static SQL>).bind(...)` — NO template-literal SQL.

import type { ArticleRow } from "../db";
import type { Env } from "../env";
import { snapshotVersion } from "./publish";

export interface ArticleVersionRow {
  id: number;
  article_id: number;
  version_number: number;
  content_json: string;
  status: string;
  created_by: string | null;
  change_summary: string | null;
  created_at: number;
}

export type ArticleVersionListEntry = Omit<ArticleVersionRow, "content_json">;

export async function listVersions(
  env: Env,
  articleId: number,
): Promise<ArticleVersionListEntry[]> {
  const result = await env.DB
    .prepare(
      "SELECT id, article_id, version_number, status, created_by, change_summary, created_at FROM article_versions WHERE article_id = ? ORDER BY version_number DESC",
    )
    .bind(articleId)
    .all<ArticleVersionListEntry>();
  return result.results ?? [];
}

export async function getVersion(
  env: Env,
  articleId: number,
  versionId: number,
): Promise<ArticleVersionRow | null> {
  const row = await env.DB
    .prepare(
      "SELECT id, article_id, version_number, content_json, status, created_by, change_summary, created_at FROM article_versions WHERE id = ? AND article_id = ? LIMIT 1",
    )
    .bind(versionId, articleId)
    .first<ArticleVersionRow>();
  return row ?? null;
}

export interface RestoreResult {
  article_id: number;
  version_id: number;
  restored_version_number: number;
}

export async function restoreVersion(
  env: Env,
  articleId: number,
  versionId: number,
  createdBy?: string,
): Promise<RestoreResult> {
  const version = await getVersion(env, articleId, versionId);
  if (!version) {
    throw new Error(
      `Version ${versionId} not found for article ${articleId}`,
    );
  }
  const article = await env.DB
    .prepare("SELECT * FROM articles WHERE id = ? LIMIT 1")
    .bind(articleId)
    .first<ArticleRow>();
  if (!article) throw new Error(`Article ${articleId} not found`);

  // (1) Snapshot the pre-restore state so the restore can be undone.
  await snapshotVersion(env, article, {
    createdBy,
    changeSummary: `restore from v${version.version_number}`,
  });

  // (2) Copy the chosen version's content back onto the article row.
  await env.DB
    .prepare(
      "UPDATE articles SET content_json = ?, updated_at = ? WHERE id = ?",
    )
    .bind(version.content_json, Math.floor(Date.now() / 1000), articleId)
    .run();

  return {
    article_id: articleId,
    version_id: versionId,
    restored_version_number: version.version_number,
  };
}
