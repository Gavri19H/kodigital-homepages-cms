// Phase 3 / T8.AC1: PATCH /api/admin/settings is strictly site-scoped and
// increments sites.settings_version atomically with the per-(site_id,key)
// UPSERT. The first test name below matches the RC-020 evidence runner
// `-t "PATCH /api/admin/settings increments settings_version"` filter
// exactly so the canonical runner binding is satisfied by name alone.
//
// Two distinct behaviours are pinned here:
//   1. version bump   — settings_version goes from N to N+1 for the target
//                       site and the UPSERT + bump ride one D1 batch.
//   2. site isolation — when site A is patched, every recorded SQL bind
//                       targets site A; nothing in the batch references
//                       site B's id, so site B's settings rows cannot be
//                       mutated by the round trip.

import { describe, expect, it } from "vitest";
import admin from "../src/admin/router";
import type { Env } from "../src/env";

interface RecordedCall {
  sql: string;
  binds: unknown[];
  via: "run" | "batch";
}

interface PlantedRow {
  match: string;
  row: unknown | null;
}

function makeFakeDb(planted: PlantedRow[] = []): {
  db: D1Database;
  calls: RecordedCall[];
  batches: RecordedCall[][];
} {
  const calls: RecordedCall[] = [];
  const batches: RecordedCall[][] = [];

  function makeStmt(sql: string) {
    let captured: unknown[] = [];
    const stmt = {
      _sql: sql,
      _binds: () => captured,
      bind(...binds: unknown[]) {
        captured = binds;
        return stmt;
      },
      async first<T = unknown>(): Promise<T | null> {
        calls.push({ sql, binds: captured, via: "run" });
        for (const entry of planted) {
          if (sql.indexOf(entry.match) >= 0) {
            return (entry.row ?? null) as T | null;
          }
        }
        return null;
      },
      async run() {
        calls.push({ sql, binds: captured, via: "run" });
        return { success: true, meta: {} };
      },
      async all<T = unknown>() {
        calls.push({ sql, binds: captured, via: "run" });
        return { results: [] as T[], success: true, meta: {} };
      },
    };
    return stmt;
  }

  const db = {
    prepare(sql: string) {
      return makeStmt(sql);
    },
    async batch(statements: ReturnType<typeof makeStmt>[]) {
      const batchRecord: RecordedCall[] = [];
      for (const s of statements) {
        const rec = { sql: s._sql, binds: s._binds(), via: "batch" as const };
        batchRecord.push(rec);
        calls.push(rec);
      }
      batches.push(batchRecord);
      return statements.map(() => ({ success: true, meta: {} }));
    },
  } as unknown as D1Database;
  return { db, calls, batches };
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

describe("admin settings PATCH (T8.AC1)", () => {
  it("PATCH /api/admin/settings increments settings_version", async () => {
    const { db, calls, batches } = makeFakeDb([
      {
        match: "FROM sites WHERE id = ?",
        row: { id: "st_a", settings_version: 7 },
      },
    ]);
    const res = await admin.request(
      "/api/admin/settings",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          site_id: "st_a",
          updates: { tagline: "Site A tagline." },
        }),
      },
      buildEnv(db),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      site_id: string;
      settings_version: number;
      updated_keys: string[];
    };
    expect(body.site_id).toBe("st_a");
    expect(body.settings_version).toBe(8);
    expect(body.updated_keys).toEqual(["tagline"]);

    // One D1 batch, two statements: UPSERT then version bump. Riding the
    // same batch is what makes the version + value transition atomic.
    expect(batches.length).toBe(1);
    const batch = batches[0];
    if (!batch) throw new Error("batch not recorded");
    expect(batch.length).toBe(2);

    const upsert = batch[0];
    if (!upsert) throw new Error("UPSERT statement missing");
    expect(upsert.sql).toMatch(/INSERT INTO site_settings/);
    expect(upsert.sql).toMatch(/ON CONFLICT\(site_id, key\)/);
    expect(upsert.binds).toEqual(["st_a", "tagline", "Site A tagline."]);

    const bump = batch[1];
    if (!bump) throw new Error("version-bump statement missing");
    expect(bump.sql).toMatch(/UPDATE sites SET settings_version = settings_version \+ 1/);
    expect(bump.binds).toEqual(["st_a"]);

    // The settings_version SELECT runs OUTSIDE the batch so the response
    // can report the post-bump number without a follow-up read.
    const lookup = calls.find((c) => c.sql.indexOf("FROM sites WHERE id = ?") >= 0);
    expect(lookup).toBeDefined();
    expect(lookup?.via).toBe("run");
  });

  it("PATCH /api/admin/settings does not touch other sites' settings rows", async () => {
    const { db, calls, batches } = makeFakeDb([
      {
        match: "FROM sites WHERE id = ?",
        row: { id: "st_a", settings_version: 3 },
      },
    ]);
    const res = await admin.request(
      "/api/admin/settings",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          site_id: "st_a",
          updates: {
            tagline: "A only.",
            contact_email: "a@example.test",
          },
        }),
      },
      buildEnv(db),
    );
    expect(res.status).toBe(200);

    // Every SQL fired by the handler must carry site_id="st_a" as the
    // first positional bind (settings UPSERT) or the only bind (version
    // bump + SELECT). No statement references site_id="st_b" because the
    // handler refuses to operate without a `site_id` body field — global
    // updates are not reachable through this route.
    for (const call of calls) {
      expect(call.binds).not.toContain("st_b");
    }

    // The batch contains exactly N UPSERTs + 1 version bump, all bound
    // to site A.
    expect(batches.length).toBe(1);
    const batch = batches[0];
    if (!batch) throw new Error("batch not recorded");
    expect(batch.length).toBe(3);
    const [upsert1, upsert2, bump] = batch;
    if (!upsert1 || !upsert2 || !bump) throw new Error("missing batch entries");
    expect(upsert1.binds[0]).toBe("st_a");
    expect(upsert2.binds[0]).toBe("st_a");
    expect(bump.binds).toEqual(["st_a"]);

    // No UPDATE/INSERT statement is allowed to omit the site_id WHERE
    // clause — i.e. a "global" write would lack the WHERE id = ? guard
    // on sites OR the (site_id, key) ON CONFLICT clause on site_settings.
    for (const call of calls) {
      if (call.sql.indexOf("UPDATE sites") >= 0) {
        expect(call.sql).toMatch(/WHERE id = \?/);
      }
      if (call.sql.indexOf("INSERT INTO site_settings") >= 0) {
        expect(call.sql).toMatch(/ON CONFLICT\(site_id, key\)/);
      }
    }
  });

  it("PATCH /api/admin/settings refuses request with no site_id (no global mutation reachable)", async () => {
    const { db, calls, batches } = makeFakeDb([]);
    const res = await admin.request(
      "/api/admin/settings",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          updates: { tagline: "Anywhere." },
        }),
      },
      buildEnv(db),
    );
    expect(res.status).toBe(400);
    // No batch shipped, no SQL fired — the 400 short-circuits before any
    // D1 round trip so a missing site_id cannot become a global write.
    expect(batches.length).toBe(0);
    expect(calls.length).toBe(0);
  });
});
