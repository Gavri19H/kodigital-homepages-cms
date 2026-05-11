import { describe, expect, it } from "vitest";
import admin from "../src/admin/router";
import type { Env } from "../src/env";
import { PROTECTED_DOMAINS } from "../src/safety/protected-domains";

// T13 / Phase 3: admin sites endpoints.
//
// Behavioral AC (T13.AC2): GIVEN dev bypass + valid domain 'mysite.example',
// WHEN POST /api/admin/sites is called with {domain, vertical_slug:'home',
// activity:'main'}, THEN response is 201 with {resource:{id, domain,
// status:'draft'}} AND a site_creation_job row was created AND
// assertNotProtectedDomain was called (no protected hostname may pass).
//
// Note: the protected-hostname literals are imported from
// ../src/safety/protected-domains so this file stays clean of Group B
// banned substrings (verify:no-legacy-prod-refs hard requirement).

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
  };
}

function findCall(calls: RecordedCall[], substring: string): RecordedCall | undefined {
  return calls.find((c) => c.sql.indexOf(substring) >= 0);
}

describe("admin sites endpoints (T13)", () => {
  it("POST /api/admin/sites creates a site, attaches a domain, and queues a site_creation_job (T13.AC2)", async () => {
    const { db, calls } = makeFakeDb([
      { match: "FROM verticals WHERE slug = ?", row: { slug: "home" } },
    ]);
    const res = await admin.request(
      "/api/admin/sites",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          domain: "mysite.example",
          vertical_slug: "home",
          activity: "main",
        }),
      },
      buildEnv(db),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      resource: { id: string; domain: string; status: string };
    };
    expect(body.resource.domain).toBe("mysite.example");
    expect(body.resource.status).toBe("draft");
    expect(typeof body.resource.id).toBe("string");
    expect(body.resource.id.startsWith("st_")).toBe(true);

    const sitesInsert = findCall(calls, "INSERT INTO sites");
    expect(sitesInsert).toBeDefined();
    expect(sitesInsert?.binds[2]).toBe("mysite.example");
    expect(sitesInsert?.binds[3]).toBe("home");
    expect(sitesInsert?.binds[4]).toBe("main");

    const domainsInsert = findCall(calls, "INSERT INTO domains");
    expect(domainsInsert).toBeDefined();
    expect(domainsInsert?.binds[1]).toBe("mysite.example");

    const jobInsert = findCall(calls, "INSERT INTO site_creation_jobs");
    expect(jobInsert).toBeDefined();
    expect(jobInsert?.binds[1]).toBe(body.resource.id);
  });

  it("POST /api/admin/sites rejects protected-domain hostnames with 400 (protected-domain rejection)", async () => {
    for (const host of PROTECTED_DOMAINS) {
      const { db, calls } = makeFakeDb();
      const res = await admin.request(
        "/api/admin/sites",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            domain: host,
            vertical_slug: "home",
            activity: "main",
          }),
        },
        buildEnv(db),
      );
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string; reason?: string };
      expect(body.error).toMatch(/protected/i);
      expect(body.reason).toBe("protected-domain");
      // No INSERT may run for a protected hostname.
      expect(findCall(calls, "INSERT INTO sites")).toBeUndefined();
      expect(findCall(calls, "INSERT INTO domains")).toBeUndefined();
      expect(findCall(calls, "INSERT INTO site_creation_jobs")).toBeUndefined();
    }
  });

  it("POST /api/admin/sites rejects missing domain with 400", async () => {
    const { db } = makeFakeDb();
    const res = await admin.request(
      "/api/admin/sites",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ vertical_slug: "home", activity: "main" }),
      },
      buildEnv(db),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/domain/i);
  });

  it("POST /api/admin/sites rejects unknown vertical_slug with 400", async () => {
    const { db } = makeFakeDb();
    const res = await admin.request(
      "/api/admin/sites",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          domain: "anothersite.example",
          vertical_slug: "no-such-vertical",
          activity: "main",
        }),
      },
      buildEnv(db),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/vertical/i);
  });

  it("POST /api/admin/sites returns the existing site when Idempotency-Key replays", async () => {
    const { db } = makeFakeDb([
      { match: "FROM verticals WHERE slug = ?", row: { slug: "home" } },
      {
        match: "FROM site_creation_jobs WHERE idempotency_key = ?",
        row: { id: "job_existing", site_id: "st_existing" },
      },
      {
        match: "FROM sites WHERE id = ?",
        row: { id: "st_existing", domain: "replay.example", status: "draft" },
      },
    ]);
    const res = await admin.request(
      "/api/admin/sites",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": "replay-key-1",
        },
        body: JSON.stringify({
          domain: "replay.example",
          vertical_slug: "home",
          activity: "main",
        }),
      },
      buildEnv(db),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      resource: { id: string; domain: string; status: string };
      idempotent_replay?: boolean;
    };
    expect(body.resource.id).toBe("st_existing");
    expect(body.idempotent_replay).toBe(true);
  });
});

describe("admin sites endpoints — list/get/update (T13)", () => {
  it("GET /api/admin/sites returns the sites list wrapped in {resource}", async () => {
    const { db } = makeFakeDb();
    const res = await admin.request("/api/admin/sites", {}, buildEnv(db));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { resource: unknown[] };
    expect(Array.isArray(body.resource)).toBe(true);
  });

  it("GET /api/admin/sites/:id returns 404 when the site is missing", async () => {
    const { db } = makeFakeDb();
    const res = await admin.request(
      "/api/admin/sites/st_missing",
      {},
      buildEnv(db),
    );
    expect(res.status).toBe(404);
  });

  it("PATCH /api/admin/sites/:id rejects an invalid status value", async () => {
    const { db } = makeFakeDb([
      {
        match: "SELECT id, name, status, activity FROM sites WHERE id = ?",
        row: {
          id: "st_one",
          name: "Existing",
          status: "draft",
          activity: "main",
        },
      },
    ]);
    const res = await admin.request(
      "/api/admin/sites/st_one",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "not-a-real-status" }),
      },
      buildEnv(db),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/status/i);
  });
});
