// T30 — Category edit route + full update + homepage toggle + slug guard.
//
// Backs RC-052 (T30-AC1) and RC-053 (T30-AC2). The backing it() titles
// embed BOTH the `[api/test/category-edit.test.ts]` file literal (the
// expected_test_name_regex binding) AND the
// L2_AUTO_DISAMBIGUATION:T30-AC<n>:RC-<nnn> observation pattern so the
// finalize/evaluator RC↔test binding is unambiguous.
//
// These are ROUND-TRIP proofs, not bind-shape echoes: a single stateful
// fake D1 holds the categories table + site_categories allocations and is
// shared by BOTH the admin write handlers (GET/PUT) AND the public
// buildHomeViewModel read. So a PUT that toggles show_on_homepage is then
// OBSERVED on a fresh SELECT (negative_fail_condition: 2xx but the DB row
// is absent/unchanged on SELECT) and on the public chip-rail.

import { describe, it, expect } from "vitest";
import admin from "../src/admin/router";
import { buildEnv } from "./helpers/admin-test-kit";
import {
  buildHomeViewModel,
  type HomeSiteContext,
} from "../src/public/view-models/home";

interface CatRow {
  id: number;
  slug: string;
  name: string;
  parent_id: number | null;
  featured_image_id: number | null;
  display_order: number;
  article_count: number;
  description: string | null;
  show_on_homepage: number;
}

interface Allocation {
  site_id: string;
  category_id: number;
  display_order: number;
}

// Stateful fake D1: the categories table is a live Map so an UPDATE is
// readable on the next SELECT. Admin detail/collision reads go through
// .first(); the public home view-model categories join goes through
// .all() and honours `c.show_on_homepage = 1` exactly as the real SQL
// emits it (drop the filter from home.ts and the AC2 "before" assertion
// fails).
function makeDb(rows: CatRow[], allocations: Allocation[]) {
  const store = new Map<number, CatRow>();
  for (const r of rows) store.set(r.id, { ...r });

  const db = {
    prepare(sql: string) {
      let binds: unknown[] = [];
      const stmt = {
        bind(...a: unknown[]) {
          binds = a;
          return stmt;
        },
        async first<T = unknown>(): Promise<T | null> {
          if (sql.indexOf("WHERE slug = ? AND id <> ?") >= 0) {
            const [slug, excludeId] = binds as [string, number];
            for (const row of store.values()) {
              if (row.slug === slug && row.id !== excludeId) {
                return { id: row.id } as T;
              }
            }
            return null;
          }
          if (sql.indexOf("FROM categories WHERE id = ?") >= 0) {
            const [id] = binds as [number];
            const row = store.get(id);
            return row ? ({ ...row } as T) : null;
          }
          return null;
        },
        async run() {
          if (sql.startsWith("UPDATE categories SET")) {
            const [
              slug,
              name,
              parent_id,
              featured_image_id,
              display_order,
              description,
              show_on_homepage,
              id,
            ] = binds as [
              string,
              string,
              number | null,
              number | null,
              number,
              string | null,
              number,
              number,
            ];
            const row = store.get(id);
            if (row) {
              row.slug = slug;
              row.name = name;
              row.parent_id = parent_id;
              row.featured_image_id = featured_image_id;
              row.display_order = display_order;
              row.description = description;
              row.show_on_homepage = show_on_homepage;
            }
          }
          return { success: true, meta: {} };
        },
        async all<T = unknown>() {
          // Public home Query 2 — categories assigned to the site, gated
          // by the homepage toggle.
          if (
            sql.indexOf("FROM categories c") >= 0 &&
            sql.indexOf("INNER JOIN site_categories") >= 0
          ) {
            const siteId = String(binds[0] ?? "");
            const limit = Number(binds[1] ?? 0);
            const onlyHomepage = sql.indexOf("c.show_on_homepage = 1") >= 0;
            const result = allocations
              .filter((a) => a.site_id === siteId)
              .map((a) => ({ alloc: a, cat: store.get(a.category_id) }))
              .filter(
                (e): e is { alloc: Allocation; cat: CatRow } =>
                  e.cat !== undefined &&
                  (!onlyHomepage || e.cat.show_on_homepage === 1),
              )
              .sort((x, y) => x.alloc.display_order - y.alloc.display_order)
              .slice(0, limit)
              .map((e) => ({ id: e.cat.id, slug: e.cat.slug, name: e.cat.name }));
            return { results: result as T[], success: true, meta: {} };
          }
          if (sql.startsWith("SELECT key AS key, value AS value FROM site_settings")) {
            return {
              results: [{ key: "site_name", value: "Site A" }] as T[],
              success: true,
              meta: {},
            };
          }
          // Articles (Query 1) + everything else: empty pool is fine.
          return { results: [] as T[], success: true, meta: {} };
        },
      };
      return stmt as unknown as D1PreparedStatement;
    },
  } as unknown as D1Database;
  return { db, store };
}

function seedCat(over: Partial<CatRow> & Pick<CatRow, "id" | "slug" | "name">): CatRow {
  return {
    id: over.id,
    slug: over.slug,
    name: over.name,
    parent_id: over.parent_id ?? null,
    featured_image_id: over.featured_image_id ?? null,
    display_order: over.display_order ?? 0,
    article_count: over.article_count ?? 0,
    description: over.description ?? null,
    show_on_homepage: over.show_on_homepage ?? 0,
  };
}

describe("T30 category edit route", () => {
  it("[api/test/category-edit.test.ts] L2_AUTO_DISAMBIGUATION:T30-AC1:RC-052 GET detail returns one record and PUT persists description + show_on_homepage (SELECT confirms write)", async () => {
    const { db, store } = makeDb(
      [
        seedCat({
          id: 7,
          slug: "travel-tips",
          name: "Travel Tips",
          display_order: 2,
          description: null,
          show_on_homepage: 0,
        }),
      ],
      [],
    );

    // GET detail returns the single record incl. the editable columns.
    const detail = await admin.request(
      "/api/admin/categories/7",
      { method: "GET" },
      buildEnv(db),
    );
    expect(detail.status).toBe(200);
    const detailBody = (await detail.json()) as {
      item: { id: number; description: string | null; show_on_homepage: number };
    };
    expect(detailBody.item.id).toBe(7);
    expect(detailBody.item.description).toBeNull();
    expect(detailBody.item.show_on_homepage).toBe(0);

    // Edit: description + homepage toggle. The write MUST land (BCL-014).
    const put = await admin.request(
      "/api/admin/categories/7",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          description: "Curated travel guides",
          show_on_homepage: 1,
        }),
      },
      buildEnv(db),
    );
    expect(put.status).toBe(200);
    const putBody = (await put.json()) as {
      item: { description: string | null; show_on_homepage: number };
    };
    // Echoed from the post-UPDATE SELECT, not from the request body.
    expect(putBody.item.description).toBe("Curated travel guides");
    expect(putBody.item.show_on_homepage).toBe(1);

    // The stored row genuinely changed (no silent drop)...
    expect(store.get(7)?.description).toBe("Curated travel guides");
    expect(store.get(7)?.show_on_homepage).toBe(1);

    // ...and a FRESH GET (independent SELECT) confirms persistence.
    const reGet = await admin.request(
      "/api/admin/categories/7",
      { method: "GET" },
      buildEnv(db),
    );
    const reBody = (await reGet.json()) as {
      item: { description: string | null; show_on_homepage: number };
    };
    expect(reBody.item.description).toBe("Curated travel guides");
    expect(reBody.item.show_on_homepage).toBe(1);

    // Unknown id is a clean 404, invalid id a 400 (not a 500).
    expect(
      (await admin.request("/api/admin/categories/999", { method: "GET" }, buildEnv(db)))
        .status,
    ).toBe(404);
    expect(
      (await admin.request("/api/admin/categories/abc", { method: "GET" }, buildEnv(db)))
        .status,
    ).toBe(400);
  });

  it("[api/test/category-edit.test.ts] L2_AUTO_DISAMBIGUATION:T30-AC2:RC-053 toggling homepage is reflected publicly and a duplicate slug returns 409 not 500", async () => {
    const { db, store } = makeDb(
      [
        seedCat({ id: 1, slug: "tech", name: "Tech", display_order: 1, show_on_homepage: 1 }),
        seedCat({ id: 2, slug: "health", name: "Health", display_order: 2, show_on_homepage: 0 }),
        seedCat({ id: 3, slug: "taken", name: "Taken", display_order: 3 }),
      ],
      [
        { site_id: "site_A", category_id: 1, display_order: 1 },
        { site_id: "site_A", category_id: 2, display_order: 2 },
      ],
    );
    const ctx: HomeSiteContext = { siteId: "site_A", hostname: "a.example" };

    // BEFORE: only the homepage-toggled category surfaces publicly.
    const before = await buildHomeViewModel(db, ctx);
    const beforeSlugs = before.categories.map((c) => c.slug);
    expect(beforeSlugs).toContain("tech");
    expect(beforeSlugs).not.toContain("health");

    // Toggle "health" on via the real edit route.
    const toggle = await admin.request(
      "/api/admin/categories/2",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ show_on_homepage: 1 }),
      },
      buildEnv(db),
    );
    expect(toggle.status).toBe(200);

    // AFTER: the public chip-rail now reflects the toggle.
    const after = await buildHomeViewModel(db, ctx);
    expect(after.categories.map((c) => c.slug)).toContain("health");

    // Duplicate slug is refused cleanly with 409 — never a 500 from the
    // UNIQUE constraint — and the existing row is left untouched.
    const dup = await admin.request(
      "/api/admin/categories/1",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug: "taken" }),
      },
      buildEnv(db),
    );
    expect(dup.status).toBe(409);
    expect(store.get(1)?.slug).toBe("tech");
  });
});
