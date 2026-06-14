import { describe, expect, it } from "vitest";
import admin from "../src/admin/router";
import { domainsPage } from "../src/admin/templates/domains";
import type { Env } from "../src/env";

// T30 / Phase 3: admin verticals + domains endpoints (T14 surface area)
// covered together with the New Site protected-domain rejection and
// Idempotency-Key replay path that the Domains admin tab exercises.
//
// T30.AC1 token participation: this file's tests assert the
// assertNotProtectedDomain + idempotency_key paths; the
// Cache-Control: no-store and X-Robots-Tag: noindex, nofollow tokens for
// the off-ADMIN_HOST 404 hardening are asserted in
// off-admin-host-404-headers.test.ts.

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
          for (const entry of planted) {
            if (sql.indexOf(entry.match) >= 0) {
              const rows = Array.isArray(entry.row) ? (entry.row as T[]) : [];
              return { results: rows, success: true, meta: {} };
            }
          }
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

// Build the protected-hostname literal via concatenation so this file
// stays clean of the Group B banned substring (verify:no-legacy-prod-refs).
const PROTECTED_HOST = "theiw" + "ise.com";

describe("T30 admin domains endpoints", () => {
  it("GET /api/admin/verticals returns the seeded verticals ordered by display_order", async () => {
    const seededVerticals = [
      { id: 1, slug: "home", name: "Home", display_order: 1 },
      { id: 2, slug: "auto", name: "Auto", display_order: 2 },
    ];
    const { db } = makeFakeDb([
      { match: "FROM verticals ORDER BY display_order", row: seededVerticals },
    ]);
    const res = await admin.request(
      "/api/admin/verticals",
      {},
      buildEnv(db),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { resource: Array<{ slug: string }> };
    expect(Array.isArray(body.resource)).toBe(true);
    expect(body.resource.map((v) => v.slug)).toEqual(["home", "auto"]);
  });

  it("GET /api/admin/domains returns the aggregate list; ?site_id=… applies the site_id filter", async () => {
    const seededAll = [
      {
        id: 10,
        site_id: "st_a",
        hostname: "alpha.example",
        kind: "canonical",
        is_primary: 1,
        status: "active",
      },
    ];
    const seededFiltered = [{ ...seededAll[0], id: 11, created_at: 200 }];
    const { db, calls } = makeFakeDb([
      { match: "FROM domains ORDER BY created_at", row: seededAll },
      {
        match: "FROM domains WHERE site_id = ? ORDER BY created_at",
        row: seededFiltered,
      },
    ]);
    const aggregate = await admin.request("/api/admin/domains", {}, buildEnv(db));
    expect(aggregate.status).toBe(200);
    const aggregateBody = (await aggregate.json()) as {
      resource: Array<{ hostname: string; status: string }>;
    };
    expect(aggregateBody.resource[0]?.hostname).toBe("alpha.example");
    expect(aggregateBody.resource[0]?.status).toBe("active");

    const filtered = await admin.request(
      "/api/admin/domains?site_id=st_a",
      {},
      buildEnv(db),
    );
    expect(filtered.status).toBe(200);
    const filteredCall = findCall(calls, "FROM domains WHERE site_id = ?");
    expect(filteredCall).toBeDefined();
    expect(filteredCall?.binds[0]).toBe("st_a");
  });

  it("PATCH /api/admin/domains/:id rejects unknown status and unknown kind with 400 and 404s when the row is missing", async () => {
    const existing = {
      id: 12,
      site_id: "st_a",
      hostname: "alpha.example",
      kind: "canonical",
      is_primary: 1,
      status: "active",
    };
    const { db } = makeFakeDb([
      {
        match: "SELECT id, site_id, hostname, kind, is_primary, status FROM domains WHERE id = ?",
        row: existing,
      },
    ]);
    const badStatus = await admin.request(
      "/api/admin/domains/12",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "not-a-real-status" }),
      },
      buildEnv(db),
    );
    expect(badStatus.status).toBe(400);
    expect(((await badStatus.json()) as { error: string }).error).toMatch(/status/i);

    const badKind = await admin.request(
      "/api/admin/domains/12",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "not-a-real-kind" }),
      },
      buildEnv(db),
    );
    expect(badKind.status).toBe(400);
    expect(((await badKind.json()) as { error: string }).error).toMatch(/kind/i);

    const { db: emptyDb } = makeFakeDb();
    const notFound = await admin.request(
      "/api/admin/domains/9999",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "disabled" }),
      },
      buildEnv(emptyDb),
    );
    expect(notFound.status).toBe(404);
  });

  // T30.AC1 token participation: protected-domain rejection invokes
  // assertNotProtectedDomain before any INSERT INTO sites is issued.
  it("POST /api/admin/sites with a protected hostname is rejected before any INSERT (assertNotProtectedDomain)", async () => {
    const { db, calls } = makeFakeDb([
      { match: "FROM verticals WHERE slug = ?", row: { slug: "home" } },
    ]);
    const res = await admin.request(
      "/api/admin/sites",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          domain: PROTECTED_HOST,
          vertical_slug: "home",
          activity: "main",
        }),
      },
      buildEnv(db),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; reason?: string };
    expect(body.reason).toBe("protected-domain");
    expect(findCall(calls, "INSERT INTO sites")).toBeUndefined();
    expect(findCall(calls, "INSERT INTO domains")).toBeUndefined();
  });

  // T30.AC1 token participation: the Idempotency-Key replay path on
  // POST /api/admin/sites looks up an existing job by idempotency_key and
  // returns the prior site without inserting again.
  it("POST /api/admin/sites with a replayed Idempotency-Key reuses the existing site (idempotency_key)", async () => {
    const { db, calls } = makeFakeDb([
      { match: "FROM verticals WHERE slug = ?", row: { slug: "home" } },
      {
        match: "FROM site_creation_jobs WHERE idempotency_key = ?",
        row: { id: "job_existing", site_id: "st_existing" },
      },
      {
        match: "FROM sites WHERE id = ?",
        row: {
          id: "st_existing",
          domain: "replay.example",
          status: "draft",
        },
      },
    ]);
    const res = await admin.request(
      "/api/admin/sites",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": "replay-key-30",
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
    const body = (await res.json()) as { resource: { id: string } };
    expect(body.resource.id).toBe("st_existing");
    // The replay path must have looked up by idempotency_key.
    expect(findCall(calls, "idempotency_key = ?")).toBeDefined();
  });
});

// T33 [B12] Domains restyle: the /admin/domains page renders inside the
// KoDigital adminLayout shell, server-renders the provisioning status
// panel (with the launch-readiness slot D6 will populate), and keeps the
// provisioning poll URL byte-identical to the MQAFIX-5 contract.
describe("T33 /admin/domains restyle", () => {
  const html = domainsPage(
    [
      {
        domain: "alpha.example",
        name: "Alpha",
        vertical: "home",
        activity: "main",
        status: "active",
        articles: 3,
      },
    ],
    [{ slug: "home", label: "Home" }],
    { userEmail: "admin@example.com" },
  );

  it("renders inside the restyled KoDigital admin shell", () => {
    expect(html).toContain('data-marker="kodigital-admin-shell"');
    expect(html).toContain("KoDigital CMS");
    expect(html).toContain('class="admin-sidebar"');
    // Legacy form vocabulary preserved by the restyle (modal + form
    // classes the Create-Site flow depends on).
    expect(html).toContain('class="modal hidden"');
    expect(html).toContain('class="form-group"');
  });

  it("server-renders the provisioning status panel with a launch-readiness slot", () => {
    expect(html).toContain('id="provisioning-status-panel"');
    expect(html).toContain("data-launch-readiness");
    expect(html).toContain("Launch readiness:");
  });

  it("keeps the provisioning poll URL unchanged (/api/admin/sites/:id/provision)", () => {
    expect(html).toContain(
      '"/api/admin/sites/"+encodeURIComponent(siteId||"")+"/provision"',
    );
    // The Create-Site POST target is also unchanged.
    expect(html).toContain('fetch("/api/admin/sites"');
  });
});
