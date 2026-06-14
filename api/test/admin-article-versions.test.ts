import { describe, expect, it } from "vitest";
import admin from "../src/admin/router";
import { buildEnv, makeFakeDb } from "./helpers/admin-test-kit";

// T26 ([B5] AC2) — version history surface:
//   GET  /api/admin/articles/:id/versions            (list)
//   GET  /api/admin/articles/:id/versions/:versionId (full row)
//   POST /api/admin/articles/:id/versions/:versionId/restore
// Restore semantics (legacy admin): snapshot the CURRENT article state
// into article_versions first (so restore is restore-able), then copy the
// chosen version's content_json back onto the article row.

const VERSION_CONTENT =
  '{"blocks":[{"type":"paragraph","data":{"text":"v1"}}]}';
const CURRENT_CONTENT =
  '{"blocks":[{"type":"paragraph","data":{"text":"current"}}]}';

const VERSION_ROW = {
  id: 7,
  article_id: 42,
  version_number: 1,
  content_json: VERSION_CONTENT,
  status: "draft",
  created_by: null,
  change_summary: null,
  created_at: 100,
};

const ARTICLE_ROW = {
  id: 42,
  slug: "hello",
  title: "Hello",
  content_json: CURRENT_CONTENT,
  content_html: null,
  category_id: null,
  status: "draft",
  published_at: null,
  scheduled_at: null,
  author_name: null,
  featured_image_id: null,
  is_featured: 0,
  is_trending: 0,
  created_at: 0,
  updated_at: 0,
  site_id: "siteA",
};

describe("admin article versions: list + restore (T26.AC2)", () => {
  it("GET /api/admin/articles/:id/versions returns the version list newest-first", async () => {
    const { db, calls } = makeFakeDb(
      [{ match: "SELECT id FROM articles WHERE id = ?", row: { id: 42 } }],
      [
        {
          match: "FROM article_versions WHERE article_id = ?",
          rows: [
            { ...VERSION_ROW, id: 9, version_number: 2, created_at: 200 },
            VERSION_ROW,
          ],
        },
      ],
    );
    const res = await admin.request(
      "/api/admin/articles/42/versions",
      { method: "GET" },
      buildEnv(db),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      versions: Array<{ id: number; version_number: number }>;
    };
    expect(body.versions).toHaveLength(2);
    expect(body.versions[0]?.version_number).toBe(2);

    const q = calls.find(
      (c) => c.sql.indexOf("FROM article_versions WHERE article_id = ?") >= 0,
    );
    expect(q).toBeDefined();
    expect(q?.binds).toEqual([42]);
  });

  it("GET versions answers 404 JSON for an unknown article", async () => {
    const { db } = makeFakeDb();
    const res = await admin.request(
      "/api/admin/articles/999/versions",
      { method: "GET" },
      buildEnv(db),
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Article not found");
  });

  it("GET /api/admin/articles/:id/versions/:versionId returns the full version row", async () => {
    const { db, calls } = makeFakeDb([
      {
        match: "FROM article_versions WHERE id = ? AND article_id = ?",
        row: VERSION_ROW,
      },
    ]);
    const res = await admin.request(
      "/api/admin/articles/42/versions/7",
      { method: "GET" },
      buildEnv(db),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      version: { id: number; content_json: string };
    };
    expect(body.version.id).toBe(7);
    expect(body.version.content_json).toBe(VERSION_CONTENT);

    const q = calls.find(
      (c) =>
        c.sql.indexOf("FROM article_versions WHERE id = ? AND article_id = ?") >=
        0,
    );
    expect(q?.binds).toEqual([7, 42]);
  });

  it("POST .../versions/:versionId/restore snapshots current state then writes the version's content back", async () => {
    const { db, calls } = makeFakeDb([
      {
        match: "FROM article_versions WHERE id = ? AND article_id = ?",
        row: VERSION_ROW,
      },
      { match: "SELECT * FROM articles WHERE id = ?", row: ARTICLE_ROW },
      { match: "MAX(version_number)", row: { max_version: 3 } },
    ]);
    const res = await admin.request(
      "/api/admin/articles/42/versions/7/restore",
      { method: "POST" },
      buildEnv(db),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      restored_version_number: number;
    };
    expect(body.ok).toBe(true);
    expect(body.restored_version_number).toBe(1);

    // (1) Pre-restore snapshot of the CURRENT state at MAX+1.
    const snap = calls.find((c) =>
      c.sql.startsWith("INSERT INTO article_versions"),
    );
    expect(snap, "restore must snapshot the current state").toBeDefined();
    expect(snap?.binds[0]).toBe(42);
    expect(snap?.binds[1]).toBe(4);
    expect(snap?.binds[2]).toBe(CURRENT_CONTENT);

    // (2) The chosen version's content_json written back onto the row.
    const upd = calls.find((c) =>
      c.sql.startsWith("UPDATE articles SET content_json = ?"),
    );
    expect(upd, "restore must write the version content back").toBeDefined();
    expect(upd?.binds[0]).toBe(VERSION_CONTENT);
    expect(upd?.binds[2]).toBe(42);
  });

  it("restore answers 404 for an unknown version and never writes", async () => {
    const { db, calls } = makeFakeDb();
    const res = await admin.request(
      "/api/admin/articles/42/versions/123/restore",
      { method: "POST" },
      buildEnv(db),
    );
    expect(res.status).toBe(404);
    expect(
      calls.find((c) => c.sql.startsWith("UPDATE articles")),
    ).toBeUndefined();
    expect(
      calls.find((c) => c.sql.startsWith("INSERT INTO article_versions")),
    ).toBeUndefined();
  });
});
