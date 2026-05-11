import { describe, it, expect } from "vitest";
import {
  isAdminHost,
  assertPublicSiteHostNotAdminHost,
  resolveSiteByHostname,
  resolveSiteContextFromRequest,
  type SiteContext,
} from "../src/site/site-context";
import type { Env } from "../src/env";

// T10 / Phase 3: SiteContext tenant boundary.
//
// Behavioral AC (T10.AC2): GIVEN ADMIN_HOST='cms.kodigital.app',
// WHEN isAdminHost('cms.kodigital.app', env) is called, THEN true;
// WHEN isAdminHost('mysite.com', env) is called, THEN false;
// WHEN resolveSiteByHostname(db, 'cms.kodigital.app') is called,
// THEN it returns null (admin host never resolves as a public site).

const ADMIN_HOST = "cms.kodigital.app";

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    DB: {} as D1Database,
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

interface FakeStmt {
  bind: (...args: unknown[]) => FakeStmt;
  first: <T>() => Promise<T | null>;
}

// Minimal D1Database fake: records the SELECT + bound params and
// returns the row queued by `rowsByHostname`. If a hostname is not
// queued, first() resolves to null.
function makeFakeDb(rowsByHostname: Record<string, SiteContext>): {
  db: D1Database;
  calls: Array<{ sql: string; binds: unknown[] }>;
} {
  const calls: Array<{ sql: string; binds: unknown[] }> = [];
  const db = {
    prepare(sql: string) {
      let captured: unknown[] = [];
      const stmt: FakeStmt = {
        bind(...args: unknown[]) {
          captured = args;
          calls.push({ sql, binds: args });
          return stmt;
        },
        async first<T>(): Promise<T | null> {
          const host = String(captured[0] ?? "").toLowerCase();
          const row = rowsByHostname[host];
          return (row ?? null) as T | null;
        },
      };
      return stmt;
    },
  } as unknown as D1Database;
  return { db, calls };
}

describe("site-context (T10)", () => {
  it("isAdminHost returns true for ADMIN_HOST and false for tenant host", () => {
    const env = makeEnv();
    expect(isAdminHost(ADMIN_HOST, env)).toBe(true);
    expect(isAdminHost("mysite.com", env)).toBe(false);
  });

  it("isAdminHost is case-insensitive and tolerates trailing dot", () => {
    const env = makeEnv();
    expect(isAdminHost(ADMIN_HOST.toUpperCase(), env)).toBe(true);
    expect(isAdminHost(`${ADMIN_HOST}.`, env)).toBe(true);
  });

  it("isAdminHost returns false when ADMIN_HOST is unset", () => {
    const env = makeEnv({ ADMIN_HOST: "" });
    expect(isAdminHost(ADMIN_HOST, env)).toBe(false);
  });

  it("assertPublicSiteHostNotAdminHost throws for admin host, no-ops for tenant", () => {
    const env = makeEnv();
    expect(() => assertPublicSiteHostNotAdminHost(ADMIN_HOST, env)).toThrow(
      /Tenant boundary violation/,
    );
    expect(() =>
      assertPublicSiteHostNotAdminHost("mysite.com", env),
    ).not.toThrow();
  });

  it("resolveSiteByHostname returns null for admin host (env supplied)", async () => {
    const env = makeEnv();
    const { db, calls } = makeFakeDb({});
    const ctx = await resolveSiteByHostname(db, ADMIN_HOST, env);
    expect(ctx).toBeNull();
    // Defense-in-depth: admin host short-circuits BEFORE we touch the
    // domains registry — `calls` MUST be empty.
    expect(calls.length).toBe(0);
  });

  it("resolveSiteByHostname returns null for admin host even without env (no domains row)", async () => {
    const { db } = makeFakeDb({});
    const ctx = await resolveSiteByHostname(db, ADMIN_HOST);
    expect(ctx).toBeNull();
  });

  it("resolveSiteByHostname returns SiteContext for a registered tenant host", async () => {
    const env = makeEnv();
    const row: SiteContext = {
      site_id: "site_abc",
      hostname: "mysite.com",
      vertical_slug: "health",
      status: "active",
    };
    const { db, calls } = makeFakeDb({ "mysite.com": row });
    const ctx = await resolveSiteByHostname(db, "MySite.com", env);
    expect(ctx).toEqual(row);
    expect(calls.length).toBe(1);
    expect(calls[0]?.binds).toEqual(["mysite.com"]);
  });

  it("resolveSiteByHostname returns null for empty / null hostname", async () => {
    const env = makeEnv();
    const { db } = makeFakeDb({});
    expect(await resolveSiteByHostname(db, "", env)).toBeNull();
    expect(
      await resolveSiteByHostname(db, null as unknown as string, env),
    ).toBeNull();
  });

  it("resolveSiteContextFromRequest derives hostname from request URL and refuses admin host", async () => {
    const env = makeEnv();
    const { db, calls } = makeFakeDb({});
    const req = new Request(`https://${ADMIN_HOST}/article/foo`);
    const ctx = await resolveSiteContextFromRequest(req, db, env);
    expect(ctx).toBeNull();
    expect(calls.length).toBe(0);
  });

  it("resolveSiteContextFromRequest resolves tenant host via domains JOIN sites", async () => {
    const env = makeEnv();
    const row: SiteContext = {
      site_id: "site_xyz",
      hostname: "tenant.example",
      vertical_slug: "food",
      status: "active",
    };
    const { db, calls } = makeFakeDb({ "tenant.example": row });
    const req = new Request("https://tenant.example/page/about");
    const ctx = await resolveSiteContextFromRequest(req, db, env);
    expect(ctx).toEqual(row);
    expect(calls.length).toBe(1);
    expect(calls[0]?.sql).toMatch(/FROM domains d INNER JOIN sites s/);
  });
});
