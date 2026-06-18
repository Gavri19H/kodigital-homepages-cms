// T47 ([G3]): draft preview links. createPreviewLink() resolves the
// article_versions row a preview token should pin to, then signs the
// short-lived HMAC token via src/preview. Pinning to a version row (not
// the live article) means a shared link keeps showing exactly what the
// editor saw when minting it, even if the draft is edited afterwards.
//
// Version resolution is snapshot-on-demand: an explicit version_id is
// honored as-is; with no version_id the newest snapshot is reused when
// its content_json already equals the article's current draft content,
// otherwise the current draft state is snapshotted first (so a
// never-published draft is previewable at all). Snapshot rows minted
// here carry change_summary "preview" so version history self-explains.
//
// Hard rule (mirrors db/index.ts): every D1 call uses
// `db.prepare(<static SQL>).bind(...)` — NO template-literal SQL. The
// INSERT inside snapshotVersion is awaited before the follow-up SELECT
// (no fire-and-forget write feeding a downstream read).

import type { ArticleRow } from "../db";
import type { Env } from "../env";
import { signPreviewToken } from "../preview";
import { snapshotVersion } from "./publish";
import { getVersion } from "./versions";

// T45 ([D5]): preview links stay valid for a full day (24h) instead of
// expiring in minutes. 86400 = 24 * 60 * 60 seconds.
export const PREVIEW_TOKEN_TTL_SECONDS = 86400;

export interface PreviewLink {
  article_id: number;
  version_id: number;
  expires_at: number;
  preview_url: string;
}

interface LatestVersionRow {
  id: number;
  content_json: string;
}

async function latestVersion(
  env: Env,
  articleId: number,
): Promise<LatestVersionRow | null> {
  const row = await env.DB
    .prepare(
      "SELECT id, content_json FROM article_versions WHERE article_id = ? ORDER BY version_number DESC LIMIT 1",
    )
    .bind(articleId)
    .first<LatestVersionRow>();
  return row ?? null;
}

export async function createPreviewLink(
  env: Env,
  secret: string,
  articleId: number,
  requestedVersionId?: number,
): Promise<PreviewLink> {
  const article = await env.DB
    .prepare("SELECT * FROM articles WHERE id = ? LIMIT 1")
    .bind(articleId)
    .first<ArticleRow>();
  if (!article) throw new Error(`Article ${articleId} not found`);

  let versionId: number;
  if (typeof requestedVersionId === "number") {
    const version = await getVersion(env, articleId, requestedVersionId);
    if (!version) {
      throw new Error(
        `Version ${requestedVersionId} not found for article ${articleId}`,
      );
    }
    versionId = version.id;
  } else {
    let latest = await latestVersion(env, articleId);
    if (!latest || latest.content_json !== article.content_json) {
      await snapshotVersion(env, article, { changeSummary: "preview" });
      latest = await latestVersion(env, articleId);
    }
    if (!latest) {
      throw new Error(`Version snapshot failed for article ${articleId}`);
    }
    versionId = latest.id;
  }

  const expiresAt =
    Math.floor(Date.now() / 1000) + PREVIEW_TOKEN_TTL_SECONDS;
  const token = await signPreviewToken(secret, {
    articleId,
    versionId,
    exp: expiresAt,
  });
  return {
    article_id: articleId,
    version_id: versionId,
    expires_at: expiresAt,
    preview_url: `/preview/${articleId}?token=${encodeURIComponent(token)}`,
  };
}
