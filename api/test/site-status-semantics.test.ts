// T36 [BCL-070] — Status semantics + transition legality.
//
// Backs RC-061 (T36-AC1) and RC-062 (T36-AC2). Every backing it() title embeds
// BOTH the `[api/test/site-status-semantics.test.ts]` file literal (the
// expected_test_name_regex the D13 parse_test_output runner matches against
// passing test names) AND the L2_AUTO_DISAMBIGUATION:T36-AC<n>:RC-<nnn>
// observation pattern, so the finalize/evaluator RC<->test binding is
// unambiguous.
//
// The proof is BEHAVIORAL, not a source grep:
//   AC1 — drive the LIVE public router (app.request) on a disabled host and
//         assert 410 Gone on /, /sitemap.xml and /robots.txt (the disabled
//         site drops from the index), while a draft host on the SAME router
//         still gets 404 — the two states no longer behave identically.
//   AC2 — drive the LIVE admin updateSiteHandler (admin.request PATCH) and
//         assert an illegal from->to transition is rejected (409), that
//         flipping to 'active' is refused unless the site has a reconciled
//         (servable) domain, and that it succeeds once a domain is reconciled.
//         A fetch spy proves the whole flow emits 0 outbound fetches.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import publicRouter from "../src/public/router";
import type { PublicSiteVariables } from "../src/public/middleware";
import admin from "../src/admin/router";
import type { Env } from "../src/env";

const ADMIN_HOST = "cms.kodigital.app";

function makeEnv(db: D1Database, overrides: Partial<Env> = {}): Env {
  return {
    DB: db,
    CACHE: {} as KVNamespace,
    MEDIA: {} as R2Bucket,
    APP_ENV: "test",
    ADMIN_HOST,
    ADMIN_BASE_URL: `https://${ADMIN_HOST}`,
    ADMIN_BASE_PATH: "/admin",
    CACHE_API_ENABLED: "false",
    HTML_CACHE_TTL_SECONDS: "60",
    OPENAI_TEXT_MODEL: "",
    OPENAI_IMAGE_MODEL: "",
    SITE_PROVISIONING_DRY_RUN: "true",
    SITE_PROVISIONING_ALLOW_ROUTE_MUTATION: "false",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// AC1 fake D1: keyed by hostname -> site status. Distinguishes the two SELECTs
// the public path runs:
//   * resolveSiteByHostname's ACTIVE-GATE query (contains "d.status = 'active'")
//     resolves a row ONLY when the site is active.
//   * resolveSiteStatusByHostname's status query (T36; no active gate) returns
//     the raw site status so the middleware can pick 410 vs 404.
// ---------------------------------------------------------------------------
function makePublicDb(siteByHost: Record<string, { status: string }>): D1Database {
  return {
    prepare(sql: string) {
      let binds: unknown[] = [];
      const stmt = {
        bind(...args: unknown[]) {
          binds = args;
          return stmt;
        },
        async first<T = unknown>(): Promise<T | null> {
          const host = String(binds[0] ?? "").toLowerCase();
          const entry = siteByHost[host];
          if (entry === undefined) return null;
          if (sql.indexOf("d.status = 'active'") >= 0) {
            // active-gate resolution: only an active site resolves
            if (entry.status !== "active") return null;
            return {
              site_id: "st_active",
              hostname: host,
              vertical_slug: "home",
              status: "active",
              content_version: 1,
              settings_version: 1,
            } as unknown as T;
          }
          if (sql.indexOf("SELECT s.status AS status") >= 0) {
            return { status: entry.status } as unknown as T;
          }
          return null;
        },
        async all<T = unknown>() {
          return { results: [] as T[], success: true, meta: {} };
        },
        async run() {
          return { success: true, meta: {} };
        },
      };
      return stmt as unknown as D1PreparedStatement;
    },
  } as unknown as D1Database;
}

function publicApp() {
  const app = new Hono<{ Bindings: Env; Variables: PublicSiteVariables }>();
  app.route("/", publicRouter);
  return app;
}

describe("T36-AC1 disabled site returns 410 (distinct from draft 404) and drops from sitemap/robots", () => {
  it("[api/test/site-status-semantics.test.ts] L2_AUTO_DISAMBIGUATION:T36-AC1:RC-061 a disabled host returns 410 Gone on / while a draft host returns 404 Not Found", async () => {
    const app = publicApp();
    const env = makeEnv(
      makePublicDb({
        "disabled.example": { status: "disabled" },
        "draft.example": { status: "draft" },
      }),
    );

    const disabled = await app.request("https://disabled.example/", {}, env);
    expect(disabled.status).toBe(410);
    const disabledBody = (await disabled.json()) as { error: string };
    expect(disabledBody.error).toMatch(/gone/i);

    const draft = await app.request("https://draft.example/", {}, env);
    expect(draft.status).toBe(404);

    // The two states no longer behave identically.
    expect(disabled.status).not.toBe(draft.status);
  });

  it("[api/test/site-status-semantics.test.ts] L2_AUTO_DISAMBIGUATION:T36-AC1:RC-061 a disabled site drops from the sitemap and robots — /sitemap.xml and /robots.txt are 410 Gone", async () => {
    const app = publicApp();
    const env = makeEnv(
      makePublicDb({ "disabled.example": { status: "disabled" } }),
    );

    const sitemap = await app.request(
      "https://disabled.example/sitemap.xml",
      {},
      env,
    );
    expect(sitemap.status).toBe(410);

    const robots = await app.request(
      "https://disabled.example/robots.txt",
      {},
      env,
    );
    expect(robots.status).toBe(410);
  });

  it("[api/test/site-status-semantics.test.ts] L2_AUTO_DISAMBIGUATION:T36-AC1:RC-061 an unmapped host stays 404 (only an actually-disabled site is Gone)", async () => {
    const app = publicApp();
    const env = makeEnv(makePublicDb({}));
    const res = await app.request("https://nobody.example/", {}, env);
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// AC2 fake D1: planted-row matcher (mirrors admin-sites-create.test.ts) plus a
// reconciled-domain COUNT responder. Records every (sql, binds) so the test can
// assert the UPDATE fired only when the transition was legal.
// ---------------------------------------------------------------------------
interface RecordedCall {
  sql: string;
  binds: unknown[];
}

function makeAdminDb(opts: {
  existing: { id: string; name: string; status: string; activity: string };
  reconciledDomains: number;
  updatedRow?: Record<string, unknown>;
}): { db: D1Database; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const db = {
    prepare(sql: string) {
      let binds: unknown[] = [];
      const stmt = {
        bind(...args: unknown[]) {
          binds = args;
          return stmt;
        },
        async first<T = unknown>(): Promise<T | null> {
          calls.push({ sql, binds });
          if (sql.indexOf("SELECT id, name, status, activity FROM sites") >= 0) {
            return opts.existing as unknown as T;
          }
          if (
            sql.indexOf("COUNT(*) AS n FROM domains") >= 0 &&
            sql.indexOf("status = 'active'") >= 0
          ) {
            return { n: opts.reconciledDomains } as unknown as T;
          }
          if (sql.indexOf("SELECT id, name, domain") >= 0) {
            return (opts.updatedRow ?? null) as T | null;
          }
          return null;
        },
        async run() {
          calls.push({ sql, binds });
          return { success: true, meta: {} };
        },
        async all<T = unknown>() {
          calls.push({ sql, binds });
          return { results: [] as T[], success: true, meta: {} };
        },
      };
      return stmt;
    },
  } as unknown as D1Database;
  return { db, calls };
}

function adminEnv(db: D1Database): Env {
  return makeEnv(db, { ADMIN_HOST: "localhost", DEV_BYPASS_AUTH: "true" });
}

function patch(id: string, status: string, env: Env) {
  return admin.request(
    `/api/admin/sites/${id}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status }),
    },
    env,
  );
}

function findCall(calls: RecordedCall[], substr: string): RecordedCall | undefined {
  return calls.find((c) => c.sql.indexOf(substr) >= 0);
}

describe("T36-AC2 illegal status transition is rejected; active implies a reconciled domain", () => {
  // Fetch-mock harness: any outbound fetch is recorded. The status-change flow
  // MUST emit zero outbound fetches (definition_of_done) — it only touches D1.
  const outbound: string[] = [];
  let savedFetch: typeof globalThis.fetch;
  beforeEach(() => {
    outbound.length = 0;
    savedFetch = globalThis.fetch;
    globalThis.fetch = ((input: unknown) => {
      outbound.push(String(input));
      return Promise.resolve(new Response("{}", { status: 200 }));
    }) as typeof globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = savedFetch;
  });
  const noOutbound = () => {
    expect(outbound).toEqual([]);
    expect(outbound.filter((u) => u.indexOf("api.cloudflare.com") >= 0)).toEqual(
      [],
    );
  };

  it("[api/test/site-status-semantics.test.ts] L2_AUTO_DISAMBIGUATION:T36-AC2:RC-062 an illegal transition (draft -> active, skipping provisioning) is rejected with 409 and the sites row is not updated", async () => {
    const { db, calls } = makeAdminDb({
      existing: { id: "st_one", name: "Existing", status: "draft", activity: "main" },
      reconciledDomains: 1,
    });
    const res = await patch("st_one", "active", adminEnv(db));
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/illegal status transition/i);
    // The UPDATE never ran — an illegal transition leaves state untouched.
    expect(findCall(calls, "UPDATE sites SET")).toBeUndefined();
    // Zero outbound fetches.
    noOutbound();
  });

  it("[api/test/site-status-semantics.test.ts] L2_AUTO_DISAMBIGUATION:T36-AC2:RC-062 flipping a site to active is refused (409) when it has no reconciled (servable) domain", async () => {
    const { db, calls } = makeAdminDb({
      existing: {
        id: "st_two",
        name: "Pending",
        status: "provisioning",
        activity: "main",
      },
      reconciledDomains: 0, // dry-run left the domain pending — not servable
    });
    const res = await patch("st_two", "active", adminEnv(db));
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/reconciled|servable/i);
    expect(findCall(calls, "UPDATE sites SET")).toBeUndefined();
    noOutbound();
  });

  it("[api/test/site-status-semantics.test.ts] L2_AUTO_DISAMBIGUATION:T36-AC2:RC-062 a legal activation succeeds (200) once the site has a reconciled domain, and the UPDATE persists status='active'", async () => {
    const { db, calls } = makeAdminDb({
      existing: {
        id: "st_three",
        name: "Ready",
        status: "provisioning",
        activity: "main",
      },
      reconciledDomains: 1, // route attached -> domain reconciled (servable)
      updatedRow: {
        id: "st_three",
        name: "Ready",
        domain: "ready.example",
        vertical_slug: "home",
        activity: "main",
        status: "active",
        settings_version: 1,
        last_provisioned_at: null,
        created_at: 1,
        updated_at: 2,
      },
    });
    const res = await patch("st_three", "active", adminEnv(db));
    expect(res.status).toBe(200);
    const update = findCall(calls, "UPDATE sites SET");
    expect(update, "the legal activation persists via UPDATE sites").toBeDefined();
    // UPDATE sites SET name = ?, status = ?, activity = ?, ... — bind[1] is status.
    expect(update!.binds[1]).toBe("active");
    noOutbound();
  });

  it("[api/test/site-status-semantics.test.ts] L2_AUTO_DISAMBIGUATION:T36-AC2:RC-062 a legal non-activation transition (active -> disabled) succeeds without any reconciled-domain gate", async () => {
    const { db, calls } = makeAdminDb({
      existing: {
        id: "st_four",
        name: "Live",
        status: "active",
        activity: "main",
      },
      reconciledDomains: 0, // disabling never checks reconciliation
      updatedRow: {
        id: "st_four",
        name: "Live",
        domain: "live.example",
        vertical_slug: "home",
        activity: "main",
        status: "disabled",
        settings_version: 1,
        last_provisioned_at: null,
        created_at: 1,
        updated_at: 2,
      },
    });
    const res = await patch("st_four", "disabled", adminEnv(db));
    expect(res.status).toBe(200);
    const update = findCall(calls, "UPDATE sites SET");
    expect(update!.binds[1]).toBe("disabled");
    noOutbound();
  });

  it("[api/test/site-status-semantics.test.ts] L2_AUTO_DISAMBIGUATION:T36-AC2:RC-062 an unknown status value is still rejected with 400", async () => {
    const { db } = makeAdminDb({
      existing: { id: "st_five", name: "X", status: "draft", activity: "main" },
      reconciledDomains: 1,
    });
    const res = await patch("st_five", "not-a-real-status", adminEnv(db));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/status/i);
  });
});
