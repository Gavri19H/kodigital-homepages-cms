import { describe, expect, it } from "vitest";
import admin from "../src/admin/router";
import { articlesListPage } from "../src/admin/templates/articles";
import type { Env } from "../src/env";

// T25 ([B4] Articles list port) — row actions target registered endpoints.
// The list page's row actions are (a) an Edit link into the article editor
// and (b) a Delete button whose script issues DELETE /api/admin/articles/:id.
// Each target URL is extracted from the RENDERED template (not hardcoded)
// and then requested through the real admin router, so a template/router
// drift (unregistered action target) fails here.

interface RecordedCall {
  sql: string;
  binds: unknown[];
}

interface PlantedRow {
  match: string;
  row: unknown | null;
}

function makeFakeDb(planted: PlantedRow[] = []): {
  db: D1Database;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const db = {
    prepare(sql: string) {
      let captured: unknown[] = [];
      const stmt = {
        bind(...binds: unknown[]) {
          captured = binds;
          return stmt;
        },
        async first<T = unknown>(): Promise<T | null> {
          calls.push({ sql, binds: captured });
          for (const entry of planted) {
            if (sql.indexOf(entry.match) >= 0) {
              return (entry.row ?? null) as T | null;
            }
          }
          return null;
        },
        async run() {
          calls.push({ sql, binds: captured });
          return { success: true, meta: {} };
        },
        async all<T = unknown>() {
          calls.push({ sql, binds: captured });
          return { results: [] as T[], success: true, meta: {} };
        },
      };
      return stmt;
    },
  } as unknown as D1Database;
  return { db, calls };
}

function buildEnv(db: D1Database): Env {
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
    OPENAI_TEXT_MODEL: "gpt-test",
    OPENAI_IMAGE_MODEL: "img-test",
    SITE_PROVISIONING_DRY_RUN: "true",
    SITE_PROVISIONING_ALLOW_ROUTE_MUTATION: "false",
    DEV_BYPASS_AUTH: "true",
  };
}

const SAMPLE_ARTICLE = {
  id: "42",
  title: "Row Action Probe",
  slug: "row-action-probe",
  site: "Site A",
  site_id: "siteA",
  category: "News",
  status: "published",
  homepage_section: "hero",
  published_at: "2026-06-01",
  updated_at: "2026-06-02",
};

function renderListHtml(): string {
  return articlesListPage(
    [SAMPLE_ARTICLE],
    [{ id: "siteA", name: "Site A" }],
    [{ slug: "news", label: "News" }],
    [{ id: "7", name: "News" }],
    {},
    { site_id: "siteA" },
  );
}

describe("articles list row actions target registered endpoints (T25)", () => {
  it("renders toolbar-search, select[name=site_id] and a table-actions cell", () => {
    const html = renderListHtml();
    expect(html).toContain('class="toolbar-search"');
    expect(html).toContain('name="site_id"');
    expect(html).toContain('class="table-actions"');
    // Delete row action carries the article id for the script wiring.
    expect(html).toContain('data-delete-article="42"');
    // Script targets the admin articles API with the DELETE method.
    expect(html).toContain("'/api/admin/articles/' + id");
    expect(html).toContain("window.api('DELETE'");
  });

  it("Edit row action href resolves through the admin router (200, editor HTML)", async () => {
    const html = renderListHtml();
    const match = html.match(
      /class="table-actions">\s*<a href="([^"]+)" class="btn btn-secondary btn-sm">Edit<\/a>/,
    );
    expect(match).not.toBeNull();
    const editHref = match?.[1] ?? "";
    expect(editHref).toBe("/admin/articles/42/edit");

    const { db } = makeFakeDb([
      {
        match: "FROM articles WHERE id = ?",
        row: {
          id: 42,
          title: "Row Action Probe",
          slug: "row-action-probe",
          site_id: "siteA",
          category_id: 7,
          status: "published",
          content_json: "",
          content_html: "",
          homepage_section: "hero",
          homepage_rank: 1,
          is_featured: 1,
          is_trending: 0,
          seo_title: "",
          seo_description: "",
          published_at: 1750000000,
          updated_at: 1750000000,
        },
      },
    ]);
    const res = await admin.request(editHref, { method: "GET" }, buildEnv(db));
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("article-form");
  });

  it("Delete row action target DELETE /api/admin/articles/:id is registered and deletes the row", async () => {
    const html = renderListHtml();
    const idMatch = html.match(/data-delete-article="(\d+)"/);
    expect(idMatch).not.toBeNull();
    // Build the URL exactly the way the inline script does:
    // '/api/admin/articles/' + id with method DELETE.
    const deleteUrl = "/api/admin/articles/" + (idMatch?.[1] ?? "");

    const { db, calls } = makeFakeDb([
      { match: "SELECT id FROM articles WHERE id = ?", row: { id: 42 } },
    ]);
    const res = await admin.request(
      deleteUrl,
      { method: "DELETE" },
      buildEnv(db),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok?: boolean; id?: number };
    expect(body.ok).toBe(true);
    expect(body.id).toBe(42);

    const del = calls.find((c) => c.sql.indexOf("DELETE FROM articles") >= 0);
    expect(del).toBeDefined();
    expect(del?.binds[0]).toBe(42);
  });

  it("DELETE handler (not a route miss) answers for unknown articles with JSON 404", async () => {
    const { db, calls } = makeFakeDb();
    const res = await admin.request(
      "/api/admin/articles/999",
      { method: "DELETE" },
      buildEnv(db),
    );
    expect(res.status).toBe(404);
    // The registered handler returns a JSON body — a Hono route miss
    // would return its plain-text default instead.
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Not Found");
    expect(
      calls.find((c) => c.sql.indexOf("DELETE FROM articles") >= 0),
    ).toBeUndefined();
  });
});
