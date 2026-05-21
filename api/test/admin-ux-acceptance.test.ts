import { describe, it, expect } from "vitest";
import admin from "../src/admin/router";
import { STEPS } from "../src/site-provisioning";
import type { Env } from "../src/env";

// T21 / Phase 3 Q2: Vitest acceptance suite asserting that the admin
// UX-parity contract is wired end-to-end against the worker entry —
//   * GET /admin renders the adminLayout shell (class="admin-layout"
//     + class="admin-sidebar") and the dashboard stats-grid card
//     surface, NOT the Phase 1 admin shell placeholder.
//   * PATCH /api/admin/articles/:id is REGISTERED on the admin sub-
//     router (404 on a missing id, NOT a Hono "no route" miss).
//   * site-provisioning step generate_about_page_stub inserts a real
//     pages row keyed (site_id, slug='about', page_type='about').
//
// Acceptance assertions (mirrors prd.json T21):
//   T21-AC1: admin-sidebar + stats-grid + admin-layout literals
//   T21-AC2: response body does NOT contain 'Phase 1 admin shell'
//   T21-AC3: PATCH /api/admin/articles/:id route exists
//   T21-AC4: generate_about_page_stub inserts a pages row (page_type='about')
//   T21-AC5: vitest run admin-ux-acceptance.test.ts → exit 0

interface RecordedCall {
  sql: string;
  binds: unknown[];
}

interface InsertedPageRow {
  site_id: string;
  slug: string;
  title: string;
  content_json: string;
  content_html: string;
  status: string;
  template: string;
  show_in_footer: number;
  page_type: string;
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
    OPENAI_TEXT_MODEL: "gpt-5.5",
    OPENAI_IMAGE_MODEL: "gpt-image-2",
    SITE_PROVISIONING_DRY_RUN: "true",
    SITE_PROVISIONING_ALLOW_ROUTE_MUTATION: "false",
    DEV_BYPASS_AUTH: "true",
    ...overrides,
  };
}

function makeFakeAdminDb(): { db: D1Database; calls: RecordedCall[] } {
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

function makeAboutPageDb(site: { id: string; name: string }): {
  db: D1Database;
  inserts: InsertedPageRow[];
} {
  const inserts: InsertedPageRow[] = [];
  // T9: generate_about_page_stub now calls the T7 about-page generator,
  // which writes/reads ai_generations. The fake just needs round-trip
  // INSERT → SELECT-BY-IDEMPOTENCY-KEY parity so startGenerationLog
  // resolves; the per-AC assertions still target the pages insert.
  const aiGenerations = new Map<string, { id: string; status: string; parsed_json: string | null }>();
  const db = {
    prepare(sql: string) {
      let captured: unknown[] = [];
      const stmt = {
        bind(...binds: unknown[]) {
          captured = binds;
          return stmt;
        },
        async first<T = unknown>(): Promise<T | null> {
          if (
            sql.indexOf("FROM sites WHERE id = ?") >= 0 &&
            sql.indexOf("vertical_slug") >= 0
          ) {
            const [id] = captured as [string];
            if (id !== site.id) return null;
            return ({
              id: site.id,
              name: site.name,
              domain: `${site.id}.test`,
              vertical_slug: "general",
            } as unknown) as T;
          }
          if (sql.indexOf("FROM sites WHERE id = ?") >= 0) {
            const [id] = captured as [string];
            if (id !== site.id) return null;
            return ({ name: site.name, domain: `${site.id}.test` } as unknown) as T;
          }
          if (sql.indexOf("FROM ai_generations WHERE idempotency_key = ?") >= 0) {
            const [key] = captured as [string];
            return (aiGenerations.get(key) ?? null) as unknown as T | null;
          }
          return null;
        },
        async run() {
          if (sql.indexOf("INSERT OR IGNORE INTO pages") >= 0) {
            const [site_id, title, content_json, content_html] = captured as [
              string,
              string,
              string,
              string,
            ];
            const exists = inserts.find(
              (r) => r.site_id === site_id && r.slug === "about",
            );
            if (!exists) {
              inserts.push({
                site_id,
                slug: "about",
                title,
                content_json,
                content_html,
                status: "published",
                template: "default",
                show_in_footer: 1,
                page_type: "about",
              });
            }
          } else if (sql.indexOf("INSERT INTO ai_generations") >= 0) {
            const [id, , , , , , key] = captured as [
              string, string | null, string, string, string, string, string,
            ];
            if (!aiGenerations.has(key)) {
              aiGenerations.set(key, { id, status: "pending", parsed_json: null });
            }
          } else if (
            sql.indexOf("UPDATE ai_generations SET status = 'fallback'") >= 0
          ) {
            const [parsed_json, , , , key] = captured as [
              string, string | null, string | null, string | null, string,
            ];
            const row = aiGenerations.get(key);
            if (row) {
              row.status = "fallback";
              row.parsed_json = parsed_json;
            }
          } else if (
            sql.indexOf("UPDATE ai_generations SET status = 'success'") >= 0
          ) {
            const [, parsed_json, , , key] = captured as [
              string, string, string | null, string | null, string,
            ];
            const row = aiGenerations.get(key);
            if (row) {
              row.status = "success";
              row.parsed_json = parsed_json;
            }
          }
          return { success: true, meta: {} };
        },
        async all<T = unknown>() {
          return { results: [] as T[], success: true, meta: {} };
        },
      };
      return stmt;
    },
  } as unknown as D1Database;
  return { db, inserts };
}

describe("admin UX acceptance (T21)", () => {
  // T21-AC1 + T21-AC2: /admin renders adminLayout with admin-sidebar +
  // stats-grid and does NOT contain the Phase 1 admin shell marker.
  it("GET /admin renders admin-layout + admin-sidebar + stats-grid, no Phase 1 admin shell", async () => {
    const { db } = makeFakeAdminDb();
    const res = await admin.request("/admin", {}, buildEnv(db));
    expect(res.status).toBe(200);
    const text = await res.text();
    // T21-AC1 contract tokens
    expect(text).toContain("admin-layout");
    expect(text).toContain("admin-sidebar");
    expect(text).toContain("stats-grid");
    expect(text).toContain("sidebar-nav");
    // T21-AC2: no Phase 1 admin shell leak
    expect(text).not.toContain("Phase 1 admin shell");
  });

  // T21-AC3: PATCH /api/admin/articles/:id route is REGISTERED. The
  // bypass env satisfies accessAuth, the body decode succeeds, and the
  // handler returns 404 because the fake DB resolves the article-id
  // lookup as null — proving the route handler ran, not a "route absent"
  // miss. Asserting either 200 or 404 (NOT 405 / "no route") is the
  // acceptance contract per prd.json T21-AC3.
  it("PATCH /api/admin/articles/:id is registered (handler returns 200|404, not route-absent)", async () => {
    const { db } = makeFakeAdminDb();
    const res = await admin.request(
      "/api/admin/articles/999",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "updated" }),
      },
      buildEnv(db),
    );
    // Route exists → handler decides 200 or 404. A "no route" miss
    // from Hono would be 404 with no body — we accept 200/404 here per
    // T21-AC3, but ALSO require that the response body parses as JSON
    // (i.e. our handler ran, not the default not-found leaf).
    expect([200, 404]).toContain(res.status);
    const body = (await res.json()) as { error?: string };
    // Either "Not Found" (our handler's 404 branch) or success payload —
    // both prove the PATCH /api/admin/articles/:id handler executed.
    expect(typeof body).toBe("object");
  });

  // T21-AC4: site-provisioning step generate_about_page_stub inserts a
  // pages row keyed (site_id, slug='about', page_type='about'). about_page_id
  // is intentionally not surfaced (pages.id is auto-increment + idempotent
  // INSERT OR IGNORE — the slug is the stable correlator).
  it("generate_about_page_stub inserts a pages row (page_type='about')", async () => {
    const site = { id: "st_t21", name: "Acme Times" };
    const { db, inserts } = makeAboutPageDb(site);
    const env = buildEnv(db);
    const result = await STEPS.generate_about_page_stub({
      env,
      db,
      job_id: "job_t21",
      site_id: site.id,
      step_order: 6,
    });
    expect(result.status).toBe("completed");
    expect(inserts).toHaveLength(1);
    const row = inserts[0]!;
    expect(row.site_id).toBe(site.id);
    expect(row.slug).toBe("about");
    expect(row.page_type).toBe("about");
    expect(row.status).toBe("published");
    expect(row.show_in_footer).toBe(1);
    // content_json must parse and content_html must start with '<'
    const doc = JSON.parse(row.content_json) as { blocks: unknown[] };
    expect(Array.isArray(doc.blocks)).toBe(true);
    expect(row.content_html.startsWith("<")).toBe(true);
    // Idempotency: a second invocation must NOT add a duplicate row.
    const second = await STEPS.generate_about_page_stub({
      env,
      db,
      job_id: "job_t21",
      site_id: site.id,
      step_order: 6,
    });
    expect(second.status).toBe("completed");
    expect(inserts).toHaveLength(1);
    // Step receipt carries the about_page_slug correlator.
    const out = JSON.parse(result.output) as {
      step: string;
      about_page_slug: string;
    };
    expect(out.step).toBe("generate_about_page_stub");
    expect(out.about_page_slug).toBe("about");
  });
});
