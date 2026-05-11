import { describe, expect, it } from "vitest";
import admin from "../src/admin/router";
import type { Env } from "../src/env";

// WARN-FIX-2: POST /api/admin/sites/:id/purge-cache.
// Dry-run mode (default): no real CF call, a cache_purge_log row is
// inserted with status='completed_dry_run', response is 200 +
// {resource:{purge_id:string, status:'completed_dry_run'}}.
// Missing site: 404 + {error:string}.

interface PlantedRow {
  match: string;
  row: unknown | null;
}

interface RecordedCall {
  sql: string;
  binds: unknown[];
}

function makeFakeDb(
  planted: PlantedRow[],
  recorded: RecordedCall[],
  insertReturnId: number | null,
): D1Database {
  const db = {
    prepare(sql: string) {
      let captured: unknown[] = [];
      const stmt = {
        bind(...binds: unknown[]) {
          captured = binds;
          return stmt;
        },
        async first<T = unknown>(): Promise<T | null> {
          recorded.push({ sql, binds: captured });
          if (sql.indexOf("INSERT INTO cache_purge_log") >= 0) {
            return insertReturnId === null
              ? null
              : ({ id: insertReturnId } as T);
          }
          for (const entry of planted) {
            if (sql.indexOf(entry.match) >= 0) {
              return (entry.row ?? null) as T | null;
            }
          }
          return null;
        },
        async run() {
          recorded.push({ sql, binds: captured });
          return { success: true, meta: {} };
        },
        async all<T = unknown>() {
          recorded.push({ sql, binds: captured });
          return { results: [] as T[], success: true, meta: {} };
        },
      };
      return stmt;
    },
  } as unknown as D1Database;
  return db;
}

function buildEnv(db: D1Database, overrides: Partial<Env> = {}): Env {
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
    ...overrides,
  } as Env;
}

function findCall(recorded: RecordedCall[], needle: string): RecordedCall | null {
  for (const call of recorded) {
    if (call.sql.indexOf(needle) >= 0) return call;
  }
  return null;
}

describe("POST /api/admin/sites/:id/purge-cache (WARN-FIX-2)", () => {
  it("dry-run: inserts cache_purge_log row + returns 200 with purge_id and completed_dry_run status", async () => {
    const recorded: RecordedCall[] = [];
    const db = makeFakeDb(
      [
        {
          match: "SELECT id, domain FROM sites WHERE id = ?",
          row: { id: "st_one", domain: "acme.example" },
        },
        {
          match: "SELECT hostname FROM domains WHERE site_id = ?",
          row: { hostname: "acme.example" },
        },
      ],
      recorded,
      42,
    );
    const res = await admin.request(
      "/api/admin/sites/st_one/purge-cache",
      { method: "POST" },
      buildEnv(db),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      resource: { purge_id: string; status: string };
    };
    expect(typeof body.resource.purge_id).toBe("string");
    expect(body.resource.purge_id.length).toBeGreaterThan(0);
    expect(body.resource.purge_id).toBe("42");
    expect(body.resource.status).toBe("completed_dry_run");

    const insertCall = findCall(recorded, "INSERT INTO cache_purge_log");
    expect(insertCall).not.toBeNull();
    expect(insertCall!.binds[0]).toBe("st_one");
    expect(insertCall!.binds[1]).toBe("acme.example");
    expect(insertCall!.binds[2]).toBe("completed_dry_run");
    expect(insertCall!.binds[3]).toBe(1);
    expect(insertCall!.binds[4]).toBe(0);
  });

  it("falls back to sites.domain when no primary domain row exists yet", async () => {
    const recorded: RecordedCall[] = [];
    const db = makeFakeDb(
      [
        {
          match: "SELECT id, domain FROM sites WHERE id = ?",
          row: { id: "st_two", domain: "fallback.example" },
        },
      ],
      recorded,
      7,
    );
    const res = await admin.request(
      "/api/admin/sites/st_two/purge-cache",
      { method: "POST" },
      buildEnv(db),
    );
    expect(res.status).toBe(200);
    const insertCall = findCall(recorded, "INSERT INTO cache_purge_log");
    expect(insertCall).not.toBeNull();
    expect(insertCall!.binds[1]).toBe("fallback.example");
  });

  it("returns 404 + {error:string} when site_id does not exist", async () => {
    const recorded: RecordedCall[] = [];
    const db = makeFakeDb([], recorded, null);
    const res = await admin.request(
      "/api/admin/sites/st_missing/purge-cache",
      { method: "POST" },
      buildEnv(db),
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(typeof body.error).toBe("string");
    expect(body.error.length).toBeGreaterThan(0);
    const insertCall = findCall(recorded, "INSERT INTO cache_purge_log");
    expect(insertCall).toBeNull();
  });
});
