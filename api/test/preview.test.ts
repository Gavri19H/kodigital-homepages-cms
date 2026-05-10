import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import preview, {
  signPreviewToken,
  verifyPreviewToken,
  type PreviewPayload,
} from "../src/preview";
import type { Env } from "../src/env";

interface VersionRow {
  id: number;
  article_id: number;
  content_json: string;
  status: string;
}

const SECRET = "preview-secret-test-only";
const FUTURE_EXP = Math.floor(Date.now() / 1000) + 600;
const PAST_EXP = Math.floor(Date.now() / 1000) - 600;
const DRAFT_BLOCKS = JSON.stringify({
  blocks: [{ type: "paragraph", data: { text: "Draft body" } }],
});

function makeFakeDb(versions: VersionRow[]): D1Database {
  return {
    prepare(sql: string) {
      let bound: unknown[] = [];
      const stmt = {
        bind(...args: unknown[]) {
          bound = args;
          return stmt;
        },
        async first<T = unknown>(): Promise<T | null> {
          if (sql.includes("FROM article_versions WHERE id = ? AND article_id = ?")) {
            const [versionId, articleId] = bound as [number, number];
            const row = versions.find((v) => v.id === versionId && v.article_id === articleId);
            if (!row) return null;
            return {
              content_json: row.content_json,
              status: row.status,
              article_id: row.article_id,
            } as unknown as T;
          }
          return null;
        },
        async all<T = unknown>() {
          return { results: [] as T[], success: true, meta: {} };
        },
        async run() {
          return { success: true, meta: {} };
        },
      };
      return stmt as unknown as D1PreparedStatement;
    },
  } as unknown as D1Database;
}

function buildEnv(db: D1Database, secret: string | undefined): Env {
  return {
    DB: db,
    CACHE: {} as KVNamespace,
    MEDIA: {} as R2Bucket,
    APP_ENV: "test",
    ADMIN_BASE_URL: "http://localhost:8787",
    CACHE_API_ENABLED: "false",
    OPENAI_TEXT_MODEL: "",
    OPENAI_IMAGE_MODEL: "",
    PREVIEW_SECRET: secret,
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
    const versions = [{ id: 3, article_id: 7, content_json: DRAFT_BLOCKS, status: "draft" }];
    const token = await tokenFor(validPayload);
    const res = await getPreview(`/preview/7?token=${encodeURIComponent(token)}`, versions);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Draft body");
    expect(res.headers.get("cache-control") ?? "").toContain("no-store");
    expect(res.headers.get("x-robots-tag") ?? "").toContain("noindex");
  });

  it("BEHAVIORAL T11.AC3: GET /preview/<articleId> with tampered token returns 401", async () => {
    const versions = [{ id: 3, article_id: 7, content_json: DRAFT_BLOCKS, status: "draft" }];
    const token = await tokenFor(validPayload);
    const tampered = token.slice(0, -1) + (token.endsWith("A") ? "B" : "A");
    const res = await getPreview(`/preview/7?token=${encodeURIComponent(tampered)}`, versions);
    expect(res.status).toBe(401);
  });

  it("BEHAVIORAL T11.AC3: GET /preview/<articleId> with expired token returns 401", async () => {
    const versions = [{ id: 3, article_id: 7, content_json: DRAFT_BLOCKS, status: "draft" }];
    const token = await tokenFor({ ...validPayload, exp: PAST_EXP });
    const res = await getPreview(`/preview/7?token=${encodeURIComponent(token)}`, versions);
    expect(res.status).toBe(401);
  });

  it("rejects when token's articleId does not match URL id (401)", async () => {
    const versions = [{ id: 3, article_id: 7, content_json: DRAFT_BLOCKS, status: "draft" }];
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
