// RX3 / MQAFIX-3 — GET /api/admin/media MUST honor ?site_id=<id> and
// return ONLY site-scoped + global (site_id IS NULL) rows. Rows for
// other sites MUST NOT leak across the tenant boundary.
//
// AC2 BEHAVIORAL contract (.ralph/execution_stories.json#RX3.AC2):
//   GIVEN media rows for site_A AND site_B AND a global (site_id IS NULL)
//   WHEN  GET /api/admin/media?site_id=<A>
//   THEN  response carries ONLY site_A + global rows (NOT site_B).
//
// AC4 FUNCTIONAL: site_id MUST be bound via .bind(siteId), NEVER
// template-literal-interpolated (per .claude/rules/d1-database-safety.md).
// This is asserted by injecting a SQL-injection-shaped string and
// verifying both the captured SQL placeholder + the captured bind value.

import { describe, expect, it } from "vitest";
import admin from "../src/admin/router";
import type { Env } from "../src/env";

interface MediaRow {
  id: number;
  filename: string;
  storage_key: string;
  mime_type: string;
  size_bytes: number;
  site_id: string | null;
  created_at: string;
}

interface RecordedCall {
  sql: string;
  binds: unknown[];
}

function makeFakeDb(allRows: MediaRow[]): {
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
          if (!sql.includes("FROM media")) {
            return { results: [] as T[], success: true, meta: {} };
          }
          // Apply the production predicate against the fake row set so the
          // returned shape matches the SQL contract (WHERE site_id = ? OR
          // site_id IS NULL — globals join in alongside the scoped rows).
          const siteId = captured.length > 0 ? String(captured[0]) : null;
          const filtered = siteId === null
            ? allRows
            : allRows.filter((r) => r.site_id === siteId || r.site_id === null);
          filtered.sort((a, b) => {
            if (a.created_at !== b.created_at) {
              return a.created_at < b.created_at ? 1 : -1;
            }
            return b.id - a.id;
          });
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

function findMediaCall(calls: RecordedCall[]): RecordedCall | undefined {
  return calls.find((c) => c.sql.includes("FROM media"));
}

describe("GET /api/admin/media applies site_id filter with globals", () => {
  const SITE_A = "site-a";
  const SITE_B = "site-b";

  const rows: MediaRow[] = [
    {
      id: 1,
      filename: "a-1.png",
      storage_key: "a1.png",
      mime_type: "image/png",
      size_bytes: 100,
      site_id: SITE_A,
      created_at: "2026-05-17T10:00:00Z",
    },
    {
      id: 2,
      filename: "a-2.png",
      storage_key: "a2.png",
      mime_type: "image/png",
      size_bytes: 200,
      site_id: SITE_A,
      created_at: "2026-05-17T11:00:00Z",
    },
    {
      id: 3,
      filename: "global-1.png",
      storage_key: "g1.png",
      mime_type: "image/png",
      size_bytes: 300,
      site_id: null,
      created_at: "2026-05-17T12:00:00Z",
    },
    {
      id: 4,
      filename: "b-only.png",
      storage_key: "b1.png",
      mime_type: "image/png",
      size_bytes: 400,
      site_id: SITE_B,
      created_at: "2026-05-17T13:00:00Z",
    },
  ];

  it("RX3.AC2: returns site_A + global rows; excludes site_B", async () => {
    const { db, calls } = makeFakeDb(rows);
    const res = await admin.request(
      "/api/admin/media?site_id=" + SITE_A,
      { method: "GET" },
      buildEnv(db),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      media: MediaRow[];
      site_id?: string;
    };
    expect(body.site_id).toBe(SITE_A);
    expect(body.media).toHaveLength(3);

    const scoped = body.media.filter((r) => r.site_id === SITE_A);
    const globals = body.media.filter((r) => r.site_id === null);
    const otherSite = body.media.filter((r) => r.site_id === SITE_B);
    expect(scoped).toHaveLength(2);
    expect(globals).toHaveLength(1);
    expect(otherSite).toHaveLength(0);

    // SQL contract: WHERE site_id = ? OR site_id IS NULL (globals merge in).
    const mediaCall = findMediaCall(calls);
    expect(mediaCall).toBeDefined();
    expect(mediaCall?.sql).toContain("FROM media");
    expect(mediaCall?.sql).toContain("site_id = ?");
    expect(mediaCall?.sql).toContain("site_id IS NULL");
    expect(mediaCall?.binds).toEqual([SITE_A]);
  });

  it("RX3.AC4: site_id is bound (parameterized), not template-interpolated", async () => {
    const { db, calls } = makeFakeDb(rows);
    // A SQL-injection-shaped string. With .bind() the value lands in the
    // binding slot; the prepared SQL still carries the literal '?' and
    // does NOT contain the attacker payload.
    const attacker = "evil' OR 1=1 --";
    const res = await admin.request(
      "/api/admin/media?site_id=" + encodeURIComponent(attacker),
      { method: "GET" },
      buildEnv(db),
    );
    expect(res.status).toBe(200);

    const mediaCall = findMediaCall(calls);
    expect(mediaCall).toBeDefined();
    expect(mediaCall?.sql).toContain("site_id = ?");
    expect(mediaCall?.sql).not.toContain("evil");
    expect(mediaCall?.binds).toEqual([attacker]);
  });

  it("RX3.AC2 (no site_id query): falls through to the unfiltered listing", async () => {
    // Without ?site_id=, the legacy "list all media" path runs (no WHERE
    // site_id predicate). This preserves the pre-RX3 unscoped behavior
    // for admin clients that have not yet adopted the filter form.
    const { db, calls } = makeFakeDb(rows);
    const res = await admin.request(
      "/api/admin/media",
      { method: "GET" },
      buildEnv(db),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { media: MediaRow[]; site_id?: string };
    expect(body.site_id).toBeUndefined();

    const mediaCall = findMediaCall(calls);
    expect(mediaCall).toBeDefined();
    expect(mediaCall?.sql).toContain("FROM media");
    // Unfiltered branch: no WHERE site_id predicate, no binds.
    expect(mediaCall?.sql).not.toContain("WHERE site_id");
    expect(mediaCall?.binds).toEqual([]);
  });
});
