import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import preview, {
  signPreviewToken,
  verifyPreviewToken,
  type PreviewPayload,
} from "../src/preview";
import admin from "../src/admin/router";
import type { Env } from "../src/env";

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

const SECRET = "preview-secret-test-only";
const FUTURE_EXP = Math.floor(Date.now() / 1000) + 600;
const PAST_EXP = Math.floor(Date.now() / 1000) - 600;
const DRAFT_BLOCKS = JSON.stringify({
  blocks: [{ type: "paragraph", data: { text: "Draft body" } }],
});

// Fake D1 covering the preview render SQL plus the preview-link mint SQL
// (articles lookup, latest/MAX version, snapshot INSERT, getVersion).
// `versions` is mutated by the INSERT so snapshot-on-demand is observable.
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
          if (sql.includes("FROM article_versions WHERE id = ? AND article_id = ?")) {
            const [versionId, articleId] = bound as [number, number];
            const row = versions.find((v) => v.id === versionId && v.article_id === articleId);
            if (!row) return null;
            return {
              ...row,
              created_by: null,
              change_summary: null,
              created_at: 0,
            } as unknown as T;
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

function buildEnv(
  db: D1Database,
  secret: string | undefined,
  overrides: Partial<Env> = {},
): Env {
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
    PREVIEW_SECRET: secret,
    SITE_PROVISIONING_DRY_RUN: "true",
    SITE_PROVISIONING_ALLOW_ROUTE_MUTATION: "false",
    ...overrides,
  };
}

function mountApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.route("/", preview);
  return app;
}

const validPayload: PreviewPayload = { articleId: 7, versionId: 3, exp: FUTURE_EXP };

async function tokenFor(payload: PreviewPayload, secret = SECRET): Promise<string> {
  return signPreviewToken(secret, payload);
}

async function getPreview(
  url: string,
  versions: VersionRow[],
  options: { secret?: string | undefined; useSecret?: boolean } = {},
): Promise<Response> {
  const secret = options.useSecret === false ? undefined : (options.secret ?? SECRET);
  return mountApp().request(url, { method: "GET" }, buildEnv(makeFakeDb(versions), secret));
}

describe("preview module: HMAC-signed short-lived token sign/verify", () => {
  it("signPreviewToken produces a `<body>.<sig>` pair using HMAC-SHA-256", async () => {
    const token = await tokenFor(validPayload);
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(token.split(".")).toHaveLength(2);
  });

  it("verifyPreviewToken accepts a self-signed token and returns the payload", async () => {
    const verified = await verifyPreviewToken(SECRET, await tokenFor(validPayload));
    expect(verified).not.toBeNull();
    expect(verified!.articleId).toBe(7);
    expect(verified!.versionId).toBe(3);
    expect(verified!.exp).toBe(FUTURE_EXP);
  });

  it("verifyPreviewToken rejects expired token, wrong secret, and exp=0 (typeof guard)", async () => {
    const expired = await tokenFor({ ...validPayload, exp: PAST_EXP });
    expect(await verifyPreviewToken(SECRET, expired)).toBeNull();

    const valid = await tokenFor(validPayload);
    expect(await verifyPreviewToken("wrong-secret", valid)).toBeNull();

    const expZero = await tokenFor({ ...validPayload, exp: 0 });
    expect(await verifyPreviewToken(SECRET, expZero)).toBeNull();
  });

  it("verifyPreviewToken rejects a tampered payload (signature mismatch)", async () => {
    const token = await tokenFor(validPayload);
    const [body, sig] = token.split(".");
    const evilBody = body!.slice(0, -1) + (body!.endsWith("A") ? "B" : "A");
    expect(await verifyPreviewToken(SECRET, `${evilBody}.${sig}`)).toBeNull();
  });

  it("BEHAVIORAL T11.AC3: GET /preview/<articleId> with valid signed token renders the draft (200)", async () => {
    const versions = [{ id: 3, article_id: 7, version_number: 1, content_json: DRAFT_BLOCKS, status: "draft" }];
    const token = await tokenFor(validPayload);
    const res = await getPreview(`/preview/7?token=${encodeURIComponent(token)}`, versions);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Draft body");
    expect(res.headers.get("cache-control") ?? "").toContain("no-store");
    expect(res.headers.get("x-robots-tag") ?? "").toContain("noindex");
  });

  it("BEHAVIORAL T11.AC3: GET /preview/<articleId> with tampered token returns 401", async () => {
    const versions = [{ id: 3, article_id: 7, version_number: 1, content_json: DRAFT_BLOCKS, status: "draft" }];
    const token = await tokenFor(validPayload);
    // Flip the FIRST char of the signature segment — all 6 of its bits are
    // significant on base64url decode. (The token's LAST char carries only
    // 4 significant bits; atob discards the low 2, so an 'A'<->'B' flip
    // there can decode to identical signature bytes and correctly 200.)
    const sigStart = token.lastIndexOf(".") + 1;
    const tampered =
      token.slice(0, sigStart) +
      (token[sigStart] === "A" ? "B" : "A") +
      token.slice(sigStart + 1);
    const res = await getPreview(`/preview/7?token=${encodeURIComponent(tampered)}`, versions);
    expect(res.status).toBe(401);
  });

  it("BEHAVIORAL T11.AC3: GET /preview/<articleId> with expired token returns 401", async () => {
    const versions = [{ id: 3, article_id: 7, version_number: 1, content_json: DRAFT_BLOCKS, status: "draft" }];
    const token = await tokenFor({ ...validPayload, exp: PAST_EXP });
    const res = await getPreview(`/preview/7?token=${encodeURIComponent(token)}`, versions);
    expect(res.status).toBe(401);
  });

  it("rejects when token's articleId does not match URL id (401)", async () => {
    const versions = [{ id: 3, article_id: 7, version_number: 1, content_json: DRAFT_BLOCKS, status: "draft" }];
    const token = await tokenFor({ ...validPayload, articleId: 99 });
    const res = await getPreview(`/preview/7?token=${encodeURIComponent(token)}`, versions);
    expect(res.status).toBe(401);
  });

  it("returns 401 with no token, 500 with no PREVIEW_SECRET, 404 when version row missing", async () => {
    expect((await getPreview("/preview/7", [])).status).toBe(401);
    expect((await getPreview("/preview/7?token=a.b", [], { useSecret: false })).status).toBe(500);

    const token = await tokenFor({ ...validPayload, versionId: 999 });
    expect(
      (await getPreview(`/preview/7?token=${encodeURIComponent(token)}`, [])).status,
    ).toBe(404);
  });
});

// T47 ([G3]): the mint endpoint lives behind the /api/admin/* accessAuth
// gate (admin/router.ts), so requests go through the full admin router.
// Wire field: `version_id` (optional JSON body).
describe("POST /api/admin/articles/:id/preview-link (T47 [G3])", () => {
  const draftArticle: ArticleRowLite = {
    id: 7,
    content_json: DRAFT_BLOCKS,
    status: "draft",
  };

  function postLink(body?: unknown): RequestInit {
    return body === undefined
      ? { method: "POST" }
      : {
          method: "POST",
          body: JSON.stringify(body),
          headers: { "content-type": "application/json" },
        };
  }

  it("is gated by accessAuth (401 without bypass)", async () => {
    const db = makeFakeDb([], [{ ...draftArticle }]);
    const res = await admin.request(
      "/api/admin/articles/7/preview-link",
      postLink(),
      buildEnv(db, SECRET),
    );
    expect(res.status).toBe(401);
  });

  it("mints a link that renders the draft end-to-end (snapshot-on-demand) with noindex + no-store", async () => {
    const versions: VersionRow[] = [];
    const db = makeFakeDb(versions, [{ ...draftArticle }]);
    const env = buildEnv(db, SECRET, { DEV_BYPASS_AUTH: "true" });

    const res = await admin.request(
      "/api/admin/articles/7/preview-link",
      postLink(),
      env,
    );
    expect(res.status).toBe(200);
    const link = (await res.json()) as {
      ok: boolean;
      preview_url: string;
      version_id: number;
      expires_at: number;
    };
    expect(link.ok).toBe(true);
    expect(link.preview_url).toMatch(/^\/preview\/7\?token=/);
    expect(link.expires_at).toBeGreaterThan(Math.floor(Date.now() / 1000));
    expect(versions).toHaveLength(1);
    expect(link.version_id).toBe(versions[0]!.id);

    const page = await mountApp().request(
      link.preview_url,
      { method: "GET" },
      env,
    );
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("Draft body");
    expect(page.headers.get("cache-control") ?? "").toContain("no-store");
    expect(page.headers.get("x-robots-tag") ?? "").toContain("noindex");
  });

  it("reuses a matching snapshot and honors an explicit version_id", async () => {
    const versions: VersionRow[] = [
      { id: 3, article_id: 7, version_number: 1, content_json: DRAFT_BLOCKS, status: "draft" },
    ];
    const db = makeFakeDb(versions, [{ ...draftArticle }]);
    const env = buildEnv(db, SECRET, { DEV_BYPASS_AUTH: "true" });

    const reuse = await admin.request(
      "/api/admin/articles/7/preview-link",
      postLink(),
      env,
    );
    expect(reuse.status).toBe(200);
    expect(((await reuse.json()) as { version_id: number }).version_id).toBe(3);
    expect(versions).toHaveLength(1);

    const pinned = await admin.request(
      "/api/admin/articles/7/preview-link",
      postLink({ version_id: 3 }),
      env,
    );
    expect(pinned.status).toBe(200);
    expect(((await pinned.json()) as { version_id: number }).version_id).toBe(3);
  });

  it("404s unknown article/version, 400s bad version_id, 500s without PREVIEW_SECRET", async () => {
    const versions: VersionRow[] = [
      { id: 3, article_id: 7, version_number: 1, content_json: DRAFT_BLOCKS, status: "draft" },
    ];
    const db = makeFakeDb(versions, [{ ...draftArticle }]);
    const env = buildEnv(db, SECRET, { DEV_BYPASS_AUTH: "true" });

    expect(
      (await admin.request("/api/admin/articles/999/preview-link", postLink(), env)).status,
    ).toBe(404);
    expect(
      (await admin.request("/api/admin/articles/7/preview-link", postLink({ version_id: 999 }), env)).status,
    ).toBe(404);
    expect(
      (await admin.request("/api/admin/articles/7/preview-link", postLink({ version_id: "x" }), env)).status,
    ).toBe(400);

    const noSecret = buildEnv(db, undefined, { DEV_BYPASS_AUTH: "true" });
    expect(
      (await admin.request("/api/admin/articles/7/preview-link", postLink(), noSecret)).status,
    ).toBe(500);
  });
});
