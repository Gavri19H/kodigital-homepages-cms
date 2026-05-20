// RX3 / MQAFIX-3 — GET /api/admin/tags MUST honor ?site_id=<id> and
// return ONLY site-scoped rows. Globals AND other-site rows MUST be
// excluded (tags are not federated globally — unlike media — per the
// existing T10 / data.ts listTagsForSite contract).
//
// AC2 BEHAVIORAL contract (.ralph/execution_stories.json#RX3.AC2):
//   GIVEN tags exist for site_A AND site_B (no globals; tags have no
//   global tier per schema 0001 + 0002)
//   WHEN  GET /api/admin/tags?site_id=<A>
//   THEN  response carries ONLY site_A rows (no site_B, no globals).
//
// AC4 FUNCTIONAL: site_id MUST be bound via .bind(siteId), NEVER
// template-literal-interpolated (per .claude/rules/d1-database-safety.md).

import { describe, expect, it } from "vitest";
import admin from "../src/admin/router";
import type { Env } from "../src/env";

interface TagRow {
  id: number;
  slug: string;
  name: string;
  site_id: string | null;
  article_count: number;
}

interface RecordedCall {
  sql: string;
  binds: unknown[];
}

function makeFakeDb(allRows: TagRow[]): {
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
        async first(): Promise<unknown> {
          calls.push({ sql, binds: captured });
          return null;
        },
        async run() {
          calls.push({ sql, binds: captured });
          return { success: true, meta: {} };
        },
        async all<T = unknown>() {
          calls.push({ sql, binds: captured });
          if (!sql.includes("FROM tags")) {
            return { results: [] as T[], success: true, meta: {} };
          }
          // Apply the production predicate against the fake row set:
          // WHERE site_id = ? — globals (site_id IS NULL) are EXCLUDED
          // for tags (unlike media).
          const siteId = captured.length > 0 ? String(captured[0]) : null;
          const filtered = siteId === null
            ? allRows
            : allRows.filter((r) => r.site_id === siteId);
          filtered.sort((a, b) =>
            a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
          );
          return {
            results: filtered as unknown as T[],
            success: true,
            meta: {},
          };
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

function findTagsCall(calls: RecordedCall[]): RecordedCall | undefined {
  return calls.find((c) => c.sql.includes("FROM tags"));
}

describe("GET /api/admin/tags applies site_id filter (no globals)", () => {
  const SITE_A = "site-a";
  const SITE_B = "site-b";

  // 3 tags for site_A + 2 tags for site_B + 1 global (site_id IS NULL).
  // The contract is: site_id=A returns 3 rows (only site_A) — globals
  // are NOT joined in for tags.
  const rows: TagRow[] = [
    { id: 1, slug: "alpha", name: "alpha", site_id: SITE_A, article_count: 0 },
    { id: 2, slug: "beta", name: "beta", site_id: SITE_A, article_count: 1 },
    { id: 3, slug: "gamma", name: "gamma", site_id: SITE_A, article_count: 2 },
    { id: 4, slug: "delta", name: "delta", site_id: SITE_B, article_count: 0 },
    { id: 5, slug: "epsilon", name: "epsilon", site_id: SITE_B, article_count: 3 },
    { id: 6, slug: "ghost", name: "ghost", site_id: null, article_count: 0 },
  ];

  it("RX3.AC2: returns ONLY site_A rows (no site_B, no globals)", async () => {
    const { db, calls } = makeFakeDb(rows);
    const res = await admin.request(
      "/api/admin/tags?site_id=" + SITE_A,
      { method: "GET" },
      buildEnv(db),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tags: TagRow[]; site_id?: string };
    expect(body.site_id).toBe(SITE_A);
    expect(body.tags).toHaveLength(3);
    expect(body.tags.every((r) => r.site_id === SITE_A)).toBe(true);

    // Other-site rows MUST NOT leak across the tenant boundary.
    expect(body.tags.filter((r) => r.site_id === SITE_B)).toHaveLength(0);
    // Globals MUST be excluded (tags have no global tier).
    expect(body.tags.filter((r) => r.site_id === null)).toHaveLength(0);

    const tagsCall = findTagsCall(calls);
    expect(tagsCall).toBeDefined();
    expect(tagsCall?.sql).toContain("FROM tags");
    expect(tagsCall?.sql).toContain("site_id = ?");
    // Tags handler MUST NOT carry the "OR site_id IS NULL" predicate.
    expect(tagsCall?.sql).not.toContain("IS NULL");
    expect(tagsCall?.binds).toEqual([SITE_A]);
  });

  it("RX3.AC4: site_id is bound (parameterized), not template-interpolated", async () => {
    const { db, calls } = makeFakeDb(rows);
    const attacker = "evil' OR 1=1 --";
    const res = await admin.request(
      "/api/admin/tags?site_id=" + encodeURIComponent(attacker),
      { method: "GET" },
      buildEnv(db),
    );
    expect(res.status).toBe(200);

    const tagsCall = findTagsCall(calls);
    expect(tagsCall).toBeDefined();
    expect(tagsCall?.sql).toContain("site_id = ?");
    expect(tagsCall?.sql).not.toContain("evil");
    expect(tagsCall?.binds).toEqual([attacker]);
  });

  it("RX3.AC2 (no site_id query): falls through to the unfiltered listing", async () => {
    // Without ?site_id=, the legacy "list all tags" path runs (no WHERE
    // site_id predicate). The existing /api/admin/tags route (line 362+)
    // returns the unscoped result set so admin clients without the
    // filter form keep working.
    const { db, calls } = makeFakeDb(rows);
    const res = await admin.request(
      "/api/admin/tags",
      { method: "GET" },
      buildEnv(db),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tags: TagRow[]; site_id?: string };
    expect(body.site_id).toBeUndefined();

    const tagsCall = findTagsCall(calls);
    expect(tagsCall).toBeDefined();
    expect(tagsCall?.sql).toContain("FROM tags");
    expect(tagsCall?.sql).not.toContain("WHERE site_id");
    expect(tagsCall?.binds).toEqual([]);
  });
});
