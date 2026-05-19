// Phase 5 / T12 BEHAVIORAL guard for the GET / public-Home handler.
//
// T12.AC2 (BEHAVIORAL): GIVEN a request to GET / on a resolved tenant
// hostname (with sites/domains seeded so the public middleware can
// resolve a site_id), WHEN the route handler runs, THEN it returns 200
// text/html and the body contains the site-header marker AND the
// site-footer marker emitted by renderHome's §1 and §13 sections.
//
// The test name MUST match `^public-router-home.*renders[_-]?home` per
// the implementation digest's RC-038 binding.

import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import publicRouter from "../src/public/router";
import type { PublicSiteVariables } from "../src/public/middleware";
import type { Env } from "../src/env";

interface DomainSeed {
  hostname: string;
  site_id: string;
  vertical_slug: string;
}

interface SettingRow {
  key: string;
  value: string | null;
}

// Minimal D1 stub: answers the public middleware's site-resolution SELECT,
// returns empty arrays for the article/category/settings reads issued by
// buildHomeViewModel, and short-circuits feed-side SELECTs not hit by /.
function makeDb(domains: DomainSeed[], settings: SettingRow[]): D1Database {
  const db = {
    prepare(sql: string) {
      let captured: unknown[] = [];
      const stmt = {
        bind(...args: unknown[]) {
          captured = args;
          return stmt;
        },
        async first<T = unknown>(): Promise<T | null> {
          if (sql.startsWith("SELECT s.id AS site_id")) {
            const host = String(captured[0] ?? "").toLowerCase();
            const d = domains.find((x) => x.hostname === host);
            if (d === undefined) return null;
            return {
              site_id: d.site_id,
              hostname: d.hostname,
              vertical_slug: d.vertical_slug,
              status: "active",
            } as unknown as T;
          }
          return null;
        },
        async all<T = unknown>() {
          if (sql.includes("FROM site_settings WHERE site_id = ?")) {
            return {
              results: settings as unknown as T[],
              success: true,
              meta: {},
            };
          }
          // Articles + categories listings: empty buckets are still a
          // valid Home (renderHome emits all 13 markers under empty
          // buckets — see public-templates-home.test.ts).
          return { results: [] as T[], success: true, meta: {} };
        },
        async run() {
          return { success: true, meta: {} };
        },
      };
      return stmt as unknown as D1PreparedStatement;
    },
  } as unknown as D1Database;
  return db;
}

function makeEnv(db: D1Database): Env {
  return {
    DB: db,
    CACHE: {} as KVNamespace,
    MEDIA: {} as R2Bucket,
    APP_ENV: "test",
    ADMIN_HOST: "cms.kodigital.app",
    ADMIN_BASE_URL: "https://cms.kodigital.app",
    ADMIN_BASE_PATH: "/admin",
    CACHE_API_ENABLED: "false",
    HTML_CACHE_TTL_SECONDS: "60",
    OPENAI_TEXT_MODEL: "",
    OPENAI_IMAGE_MODEL: "",
    SITE_PROVISIONING_DRY_RUN: "true",
    SITE_PROVISIONING_ALLOW_ROUTE_MUTATION: "false",
  };
}

describe("public-router-home", () => {
  it("renders-home — GET / on tenant returns 200 text/html with site-header + site-footer", async () => {
    const domains: DomainSeed[] = [
      {
        hostname: "tenant-a.example",
        site_id: "site_A",
        vertical_slug: "home",
      },
    ];
    const settings: SettingRow[] = [
      { key: "site_name", value: "Tenant A News" },
      { key: "tagline", value: "Stories from Tenant A" },
      { key: "site_description", value: "Tenant A description" },
    ];
    const db = makeDb(domains, settings);
    const app = new Hono<{
      Bindings: Env;
      Variables: PublicSiteVariables;
    }>();
    app.route("/", publicRouter);

    const res = await app.request(
      "https://tenant-a.example/",
      {},
      makeEnv(db),
    );

    expect(res.status).toBe(200);
    const contentType = res.headers.get("content-type") ?? "";
    expect(contentType.toLowerCase()).toContain("text/html");

    const body = await res.text();
    expect(body.startsWith("<!DOCTYPE html>")).toBe(true);
    // §1 (renderHome's first marker) + §13 (last marker) prove the full
    // 13-section body was composed, not a truncated/empty render.
    expect(body).toContain("<!-- home-section:1 site-header -->");
    expect(body).toContain("<!-- home-section:13 site-footer -->");
    // Per-site brand string surfaces in the rendered <head> title
    // (no hardcoded TheIWise / cms.kodigital.app — PART 12 RED LINE).
    expect(body).toContain("Tenant A News");
    expect(body.toLowerCase()).not.toContain("theiwise");
    expect(body).not.toContain("cms.kodigital.app");
  });

  it("renders-home — admin host on public router still returns safe 404 (no Home rendered)", async () => {
    const db = makeDb([], []);
    const app = new Hono<{
      Bindings: Env;
      Variables: PublicSiteVariables;
    }>();
    app.route("/", publicRouter);

    const res = await app.request(
      "https://cms.kodigital.app/",
      {},
      makeEnv(db),
    );
    expect(res.status).toBe(404);
    const body = await res.text();
    expect(body).not.toContain("home-section:1");
    expect(body).not.toContain("cms.kodigital.app");
  });
});
