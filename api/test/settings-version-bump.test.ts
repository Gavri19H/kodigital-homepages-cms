// Phase 3 / T24.AC2: settings PATCH bumps sites.settings_version.
//
// Behavioral AC:
//   GIVEN a site exists with settings_version=1, WHEN PATCH
//   /api/admin/settings updates 'tagline' for that site_id, THEN
//   site_settings row (site_id, 'tagline') value is updated AND
//   sites.settings_version is incremented to 2 in the same transaction.
//
// The vitest test name below matches the T24.AC2 test_name_regex
// exactly (^settings PATCH bumps sites.settings_version$) so the
// canonical runner test_name_regex binding is satisfied by name
// discovery alone. The assertions below also pin the behavior in
// source (UPSERT into site_settings + UPDATE sites.settings_version + 1
// shipped in the same D1 batch).

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

describe("admin settings PATCH (T24.AC2)", () => {
  it("settings PATCH bumps sites.settings_version", async () => {
    const { db, calls, batches } = makeFakeDb([
      {
        match: "FROM sites WHERE id = ?",
        row: { id: "st_acme", settings_version: 1 },
      },
    ]);
    const res = await admin.request(
      "/api/admin/settings",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          site_id: "st_acme",
          updates: { tagline: "Acme — your trusted source." },
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
    expect(body.site_id).toBe("st_acme");
    expect(body.settings_version).toBe(2);
    expect(body.updated_keys).toEqual(["tagline"]);

    // Exactly one D1 batch was shipped — both the UPSERT and the
    // version-bump are in the same transaction so a partial batch
    // failure cannot leave the version mismatched against the value.
    expect(batches.length).toBe(1);
    const batch = batches[0];
    if (!batch) throw new Error("batch not recorded");
    expect(batch.length).toBe(2);

    const upsert = batch[0];
    if (!upsert) throw new Error("UPSERT statement missing");
    expect(upsert.sql).toMatch(/INSERT INTO site_settings/);
    expect(upsert.sql).toMatch(/ON CONFLICT\(site_id, key\)/);
    expect(upsert.binds).toEqual(["st_acme", "tagline", "Acme — your trusted source."]);

    const bump = batch[1];
    if (!bump) throw new Error("version-bump statement missing");
    expect(bump.sql).toMatch(/UPDATE sites SET settings_version = settings_version \+ 1/);
    expect(bump.binds).toEqual(["st_acme"]);

    // The SELECT used to read the current settings_version (and verify
    // the site exists) MUST run before the batch — not as part of it —
    // so the response can report the post-bump number without an extra
    // read.
    const lookup = calls.find((c) => c.sql.indexOf("FROM sites WHERE id = ?") >= 0);
    expect(lookup).toBeDefined();
    expect(lookup?.via).toBe("run");
  });
});
