import { describe, expect, it } from "vitest";
import admin from "../src/admin/router";
import { articlesListPage } from "../src/admin/templates/articles";
import { buildEnv, makeFakeDb } from "./helpers/admin-test-kit";

// T25 ([B4] Articles list port) — row actions target registered endpoints.
// The list page's row actions are (a) an Edit link into the article editor
// and (b) a Delete button whose script issues DELETE /api/admin/articles/:id.
// Each target URL is extracted from the RENDERED template (not hardcoded)
// and then requested through the real admin router, so a template/router
// drift (unregistered action target) fails here.
//
// T26 ([B5] AC1) — the full legacy workflow surface
// (publish/unpublish/schedule/cancel-schedule/archive) is registered and
// the public-surface transitions bump sites.content_version.

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

// Workflow article row planted per from-status; "MAX(version_number)"
// backs publish()'s snapshot step. The content_version bump assertion
// pins the exact tenant-scoped UPDATE with the article's site_id bound.
const WORKFLOW_ARTICLE = {
  id: 42, slug: "row-action-probe", title: "Row Action Probe",
  content_json: '{"blocks":[]}', content_html: null, category_id: null,
  published_at: null, scheduled_at: null, author_name: null,
  featured_image_id: null, is_featured: 0, is_trending: 0,
  created_at: 0, updated_at: 0, site_id: "siteA",
};

const WORKFLOW_CASES = [
  { action: "publish", from: "draft", bumps: true },
  { action: "unpublish", from: "published", bumps: true },
  { action: "schedule", from: "draft", bumps: false },
  { action: "cancel-schedule", from: "scheduled", bumps: false },
  { action: "archive", from: "published", bumps: true },
] as const;

describe("all workflow endpoints registered; content_version bumped (T26.AC1)", () => {
  for (const tc of WORKFLOW_CASES) {
    it(`POST /api/admin/articles/:id/${tc.action} answers 200 and ${tc.bumps ? "bumps" : "does not bump"} content_version`, async () => {
      const { db, calls } = makeFakeDb([
        {
          match: "FROM articles WHERE id = ?",
          row: {
            ...WORKFLOW_ARTICLE,
            status: tc.from,
            published_at: tc.from === "published" ? 1750000000 : null,
            scheduled_at: tc.from === "scheduled" ? 1893456000 : null,
          },
        },
        { match: "MAX(version_number)", row: { max_version: 0 } },
      ]);
      const init: RequestInit = { method: "POST" };
      if (tc.action === "schedule") {
        init.body = JSON.stringify({ scheduled_at: 1893456000 });
        init.headers = { "Content-Type": "application/json" };
      }
      const res = await admin.request(
        `/api/admin/articles/42/${tc.action}`,
        init,
        buildEnv(db),
      );
      expect(res.status, `${tc.action} must be a registered handler`).toBe(200);
      const json = (await res.json()) as { ok?: boolean; status?: string };
      expect(json.ok).toBe(true);

      const bump = calls.find((c) =>
        c.sql.startsWith(
          "UPDATE sites SET content_version = content_version + 1",
        ),
      );
      if (tc.bumps) {
        expect(bump, `${tc.action} must bump content_version`).toBeDefined();
        expect(bump?.binds).toEqual(["siteA"]);
      } else {
        expect(bump, `${tc.action} must not bump content_version`).toBeUndefined();
      }
    });
  }
});
