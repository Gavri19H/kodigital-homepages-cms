// T45 ([D5]): preview token TTL -> 24h. The brief requires raising the
// preview link lifetime from minutes to a full day. These tests are the
// regression guard for that change: each backing it() title embeds the
// `[api/test/preview-ttl.test.ts]` file literal AND the
// `L2_AUTO_DISAMBIGUATION:T45-AC1:RC-073` pattern so the D13 parse_test_output
// runner binds the passing test name to the required claim unambiguously.
//
// The decisive assertion is the *contrast*: a link that was minted 23 hours
// ago is still valid under the 24h TTL but would already be dead under the
// old 600s (10-minute) TTL. A test that only checked `expires_at > now` would
// pass even if the surface change were reverted to any positive TTL — this one
// fails unless the lifetime is genuinely a full day.

import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import preview, { signPreviewToken, verifyPreviewToken } from "../src/preview";
import {
  createPreviewLink,
  PREVIEW_TOKEN_TTL_SECONDS,
} from "../src/workflow/preview-link";
import type { Env } from "../src/env";

const OLD_TTL_SECONDS = 600; // pre-T45 lifetime (10 minutes)
const SECRET = "preview-secret-test-only";
const DRAFT_BLOCKS = JSON.stringify({
  blocks: [{ type: "paragraph", data: { text: "Draft body" } }],
});

interface VersionRow {
  id: number;
  article_id: number;
  version_number: number;
  content_json: string;
  status: string;
}

interface ArticleRowLite {
  id: number;
  content_json: string;
  status: string;
}

// Fake D1 covering the preview render SELECT plus the preview-link mint SQL
// (articles lookup, latest/MAX version, snapshot INSERT). Mirrors the
// known-good harness in preview.test.ts.
function makeFakeDb(
  versions: VersionRow[],
  articles: ArticleRowLite[] = [],
): D1Database {
  return {
    prepare(sql: string) {
      let bound: unknown[] = [];
      const byArticle = (articleId: number) =>
        versions.filter((v) => v.article_id === articleId);
      const stmt = {
        bind(...args: unknown[]) {
          bound = args;
          return stmt;
        },
        async first<T = unknown>(): Promise<T | null> {
          if (sql.includes("FROM articles WHERE id = ?")) {
            const [id] = bound as [number];
            return (articles.find((a) => a.id === id) ?? null) as T | null;
          }
          if (sql.includes("ORDER BY version_number DESC LIMIT 1")) {
            const [articleId] = bound as [number];
            const row = byArticle(articleId).sort(
              (a, b) => b.version_number - a.version_number,
            )[0];
            return row
              ? ({ id: row.id, content_json: row.content_json } as T)
              : null;
          }
          if (sql.includes("MAX(version_number)")) {
            const [articleId] = bound as [number];
            const max = byArticle(articleId).reduce(
              (m, v) => Math.max(m, v.version_number),
              0,
            );
            return { max_version: max } as T;
          }
          if (
            sql.includes("FROM article_versions WHERE id = ? AND article_id = ?")
          ) {
            const [versionId, articleId] = bound as [number, number];
            const row = versions.find(
              (v) => v.id === versionId && v.article_id === articleId,
            );
            return row ? ({ ...row } as unknown as T) : null;
          }
          return null;
        },
        async all<T = unknown>() {
          return { results: [] as T[], success: true, meta: {} };
        },
        async run() {
          if (sql.startsWith("INSERT INTO article_versions")) {
            const [articleId, versionNumber, contentJson, status] = bound as [
              number,
              number,
              string,
              string,
            ];
            versions.push({
              id: versions.reduce((m, v) => Math.max(m, v.id), 0) + 1,
              article_id: articleId,
              version_number: versionNumber,
              content_json: contentJson,
              status,
            });
          }
          return { success: true, meta: {} };
        },
      };
      return stmt as unknown as D1PreparedStatement;
    },
  } as unknown as D1Database;
}

function buildEnv(db: D1Database, overrides: Partial<Env> = {}): Env {
  return {
    DB: db,
    CACHE: {} as KVNamespace,
    MEDIA: {} as R2Bucket,
    APP_ENV: "test",
    ADMIN_HOST: "localhost",
    ADMIN_BASE_URL: "http://localhost:8787",
    ADMIN_BASE_PATH: "/admin",
    CACHE_API_ENABLED: "false",
    HTML_CACHE_TTL_SECONDS: "60",
    OPENAI_TEXT_MODEL: "",
    OPENAI_IMAGE_MODEL: "",
    PREVIEW_SECRET: SECRET,
    SITE_PROVISIONING_DRY_RUN: "true",
    SITE_PROVISIONING_ALLOW_ROUTE_MUTATION: "false",
    ...overrides,
  } as Env;
}

function mountPreview() {
  const app = new Hono<{ Bindings: Env }>();
  app.route("/", preview);
  return app;
}

describe("T45 preview token TTL -> 24h", () => {
  it("[api/test/preview-ttl.test.ts] L2_AUTO_DISAMBIGUATION:T45-AC1:RC-073 the TTL constant is exactly 24h (86400s), up from the old 10-minute value", () => {
    expect(PREVIEW_TOKEN_TTL_SECONDS).toBe(86400);
    expect(PREVIEW_TOKEN_TTL_SECONDS).toBe(24 * 60 * 60);
    expect(PREVIEW_TOKEN_TTL_SECONDS).toBeGreaterThan(OLD_TTL_SECONDS);
  });

  it("[api/test/preview-ttl.test.ts] L2_AUTO_DISAMBIGUATION:T45-AC1:RC-073 a freshly minted link expires 24h from mint and renders the draft now with noindex + no-store", async () => {
    const article: ArticleRowLite = {
      id: 7,
      content_json: DRAFT_BLOCKS,
      status: "draft",
    };
    const versions: VersionRow[] = [];
    const env = buildEnv(makeFakeDb(versions, [article]));

    const before = Math.floor(Date.now() / 1000);
    const link = await createPreviewLink(env, SECRET, 7);
    const after = Math.floor(Date.now() / 1000);

    // Expiry is mint-time + 24h (allow for the second boundary spanning the call).
    expect(link.expires_at).toBeGreaterThanOrEqual(before + PREVIEW_TOKEN_TTL_SECONDS);
    expect(link.expires_at).toBeLessThanOrEqual(after + PREVIEW_TOKEN_TTL_SECONDS);
    expect(link.expires_at - before).toBe(86400);

    // The token itself carries the same 24h expiry and verifies now.
    const tokenMatch = link.preview_url.match(/token=([^&]+)/);
    expect(tokenMatch).not.toBeNull();
    const token = decodeURIComponent(tokenMatch![1]!);
    const payload = await verifyPreviewToken(SECRET, token);
    expect(payload).not.toBeNull();
    expect(payload!.exp).toBe(link.expires_at);

    // Within 24h (right now) the draft still renders, noindex + no-store.
    const page = await mountPreview().request(
      link.preview_url,
      { method: "GET" },
      env,
    );
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("Draft body");
    expect(page.headers.get("cache-control") ?? "").toContain("no-store");
    expect(page.headers.get("x-robots-tag") ?? "").toContain("noindex");
  });

  it("[api/test/preview-ttl.test.ts] L2_AUTO_DISAMBIGUATION:T45-AC1:RC-073 a link minted 23h ago is STILL valid under the 24h TTL but would already be dead under the old 600s TTL", async () => {
    const versions: VersionRow[] = [
      {
        id: 3,
        article_id: 7,
        version_number: 1,
        content_json: DRAFT_BLOCKS,
        status: "draft",
      },
    ];
    const env = buildEnv(makeFakeDb(versions));

    const now = Math.floor(Date.now() / 1000);
    const mintedTwentyThreeHoursAgo = now - 23 * 60 * 60;

    // exp as the 24h TTL would have stamped it 23h ago -> ~1h of life left.
    const expNewTtl = mintedTwentyThreeHoursAgo + PREVIEW_TOKEN_TTL_SECONDS;
    expect(expNewTtl).toBeGreaterThan(now); // still within the 24h window

    const liveToken = await signPreviewToken(SECRET, {
      articleId: 7,
      versionId: 3,
      exp: expNewTtl,
    });
    const page = await mountPreview().request(
      `/preview/7?token=${encodeURIComponent(liveToken)}`,
      { method: "GET" },
      env,
    );
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("Draft body");
    expect(page.headers.get("cache-control") ?? "").toContain("no-store");
    expect(page.headers.get("x-robots-tag") ?? "").toContain("noindex");

    // The same 23h-old mint under the OLD 10-minute TTL is long expired:
    // verify rejects it (401 surface) — proving the lifetime extension matters.
    const expOldTtl = mintedTwentyThreeHoursAgo + OLD_TTL_SECONDS;
    expect(expOldTtl).toBeLessThan(now);
    const staleToken = await signPreviewToken(SECRET, {
      articleId: 7,
      versionId: 3,
      exp: expOldTtl,
    });
    expect(await verifyPreviewToken(SECRET, staleToken)).toBeNull();
    const stalePage = await mountPreview().request(
      `/preview/7?token=${encodeURIComponent(staleToken)}`,
      { method: "GET" },
      env,
    );
    expect(stalePage.status).toBe(401);
  });
});
