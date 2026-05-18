// T10 — Site-scoped Tags filter contract (WARN-FIX-4: site->site_id field
// name on the Tags + Media admin templates so the select filter form
// submits ?site_id=<id> matching GET /api/admin/tags + /api/admin/media).
//
// T10.AC1 (syntactic) is grep-anchored to templates/tags.ts.
//
// T10.AC2 BEHAVIORAL: GIVEN tags exist for site A (3) and site B (2),
// WHEN GET /api/admin/tags?site_id=A is called, THEN exactly 3 tag rows
// are returned.
//
// The top-level describe name matches the typed evidence binding regex
// `tags filter applies site_id filter to query` (implementation_digest.md
// T10.AC2 test_name_regex).

import { describe, it, expect } from "vitest";
import { listTagsForSite } from "../src/admin/data";
import type { Env } from "../src/env";

interface TagRow {
  id: number;
  name: string;
  slug: string;
  site_id: string | null;
  article_count: number;
}

// Fake D1 shim. Captures the executed SQL + binds so the test can assert
// both the row filter (returned rows) AND the parameterized predicate
// (WHERE site_id = ?).
function makeFakeDb(allRows: TagRow[]): {
  db: D1Database;
  capturedSql: { value: string | null };
  capturedBinds: { value: unknown[] };
} {
  const capturedSql: { value: string | null } = { value: null };
  const capturedBinds: { value: unknown[] } = { value: [] };
  const db = {
    prepare(sql: string) {
      capturedSql.value = sql;
      const stmt = {
        bind(...args: unknown[]) {
          capturedBinds.value = args;
          return stmt;
        },
        async first(): Promise<unknown> {
          return null;
        },
        async run() {
          return { success: true, meta: {} };
        },
        async all<T = unknown>() {
          if (!sql.includes("FROM tags")) {
            return { results: [] as T[], success: true, meta: {} };
          }
          const siteId = String(capturedBinds.value[0] ?? "");
          const filtered = allRows.filter((r) => r.site_id === siteId);
          filtered.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
          return {
            results: filtered as unknown as T[],
            success: true,
            meta: {},
          };
        },
      };
      return stmt as unknown as D1PreparedStatement;
    },
  } as unknown as D1Database;
  return { db, capturedSql, capturedBinds };
}

function makeEnv(db: D1Database): Env {
  return {
    DB: db,
    CACHE: {} as KVNamespace,
    MEDIA: {} as R2Bucket,
    APP_ENV: "test",
    ADMIN_HOST: "cms.kodigital.app",
    ADMIN_BASE_URL: "http://localhost:8787",
    ADMIN_BASE_PATH: "/admin",
    CACHE_API_ENABLED: "false",
    HTML_CACHE_TTL_SECONDS: "60",
    OPENAI_TEXT_MODEL: "",
    OPENAI_IMAGE_MODEL: "",
    SITE_PROVISIONING_DRY_RUN: "true",
    SITE_PROVISIONING_ALLOW_ROUTE_MUTATION: "false",
  } as Env;
}

describe("tags filter applies site_id filter to query", () => {
  const SITE_A = "site-a";
  const SITE_B = "site-b";

  // 3 tags for site A + 2 tags for site B (no globals). T10.AC2.
  const rows: TagRow[] = [
    { id: 1, name: "alpha", slug: "alpha", site_id: SITE_A, article_count: 0 },
    { id: 2, name: "beta", slug: "beta", site_id: SITE_A, article_count: 1 },
    { id: 3, name: "gamma", slug: "gamma", site_id: SITE_A, article_count: 2 },
    { id: 4, name: "delta", slug: "delta", site_id: SITE_B, article_count: 0 },
    { id: 5, name: "epsilon", slug: "epsilon", site_id: SITE_B, article_count: 3 },
  ];

  it("T10.AC2: listTagsForSite(A) returns exactly 3 rows (site A only, site B excluded)", async () => {
    const { db, capturedSql, capturedBinds } = makeFakeDb(rows);
    const env = makeEnv(db);

    const result = await listTagsForSite(env, SITE_A);

    expect(result).toHaveLength(3);
    expect(result.every((r) => r.site_id === SITE_A)).toBe(true);

    // Site B's tags MUST NOT leak across the tenant boundary.
    const otherSite = result.filter((r) => r.site_id === SITE_B);
    expect(otherSite).toHaveLength(0);

    // The site_id MUST be bound (parameterized) — not interpolated.
    expect(capturedBinds.value).toEqual([SITE_A]);

    // SQL contract: WHERE site_id = ? with no LIKE / interpolation.
    expect(capturedSql.value).toContain("FROM tags");
    expect(capturedSql.value).toContain("site_id = ?");
  });

  it("T10.AC2: listTagsForSite(B) returns exactly 2 rows (site B only, site A excluded)", async () => {
    const { db, capturedBinds } = makeFakeDb(rows);
    const env = makeEnv(db);

    const result = await listTagsForSite(env, SITE_B);

    expect(result).toHaveLength(2);
    expect(result.every((r) => r.site_id === SITE_B)).toBe(true);
    expect(capturedBinds.value).toEqual([SITE_B]);
  });

  it("T10.AC2: listTagsForSite parameterizes site_id (no template interpolation)", async () => {
    const { db, capturedSql, capturedBinds } = makeFakeDb(rows);
    const env = makeEnv(db);

    // Inject a string that would corrupt the query if interpolated rather
    // than bound. With .bind() the value lands in the binding slot and
    // the SQL still contains the literal '?' placeholder.
    await listTagsForSite(env, "evil' OR 1=1 --");

    expect(capturedSql.value).toContain("site_id = ?");
    expect(capturedSql.value).not.toContain("evil");
    expect(capturedBinds.value).toEqual(["evil' OR 1=1 --"]);
  });
});

describe("tags filter template renders site_id form name", () => {
  it("T10.AC1: tags template select uses name=\"site_id\" (not legacy 'site')", async () => {
    const tagsTemplate = await import("../src/admin/templates/tags");
    const html = tagsTemplate.tagsListPage([], [{ id: "site-a", name: "Site A" }], {});
    expect(html).toContain('name="site_id"');
    // Defense: the legacy select[name="site"] MUST NOT survive the migration.
    expect(html).not.toContain('name="site"');
  });

  it("T10.AC1: media template select uses name=\"site_id\" (not legacy 'site')", async () => {
    const mediaTemplate = await import("../src/admin/templates/media");
    const html = mediaTemplate.mediaListPage([], [{ id: "site-a", name: "Site A" }], {});
    expect(html).toContain('name="site_id"');
    expect(html).not.toContain('name="site"');
  });
});
