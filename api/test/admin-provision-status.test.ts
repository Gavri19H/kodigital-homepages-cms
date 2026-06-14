import { describe, expect, it } from "vitest";
import admin from "../src/admin/router";
import { STEPS } from "../src/site-provisioning";
import { domainsPage } from "../src/admin/templates/domains";
import type { Env } from "../src/env";

// WARN-FIX-1: GET /api/admin/sites/:id/provision returns the latest
// site_creation_job_steps row as {resource:{current_step, status,
// step_key}}. Missing site OR missing job both return 404 with a
// neutral error message — the handler MUST NOT leak whether the site
// exists when there is no provisioning job for it.
//
// T39 (rescue-2 D6): every 200 response also carries a top-level
// `launch_readiness` field — the rollup the update_launch_readiness
// step wrote into its site_creation_job_steps.output row, or null until
// that step has run (or when the stored JSON is corrupt). The domains
// template renders one readiness badge per rollup field from it.

interface PlantedRow {
  match: string;
  row: unknown | null;
}

function makeFakeDb(planted: PlantedRow[] = []): D1Database {
  const db = {
    prepare(sql: string) {
      let captured: unknown[] = [];
      const stmt = {
        bind(...binds: unknown[]) {
          captured = binds;
          return stmt;
        },
        async first<T = unknown>(): Promise<T | null> {
          for (const entry of planted) {
            if (sql.indexOf(entry.match) >= 0) {
              return (entry.row ?? null) as T | null;
            }
          }
          return null;
        },
        async run() {
          void captured;
          return { success: true, meta: {} };
        },
        async all<T = unknown>() {
          return { results: [] as T[], success: true, meta: {} };
        },
      };
      return stmt;
    },
  } as unknown as D1Database;
  return db;
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
  } as Env;
}

describe("GET /api/admin/sites/:id/provision (WARN-FIX-1)", () => {
  it("returns 200 + {resource:{current_step,status,step_key}} from the latest step row", async () => {
    const db = makeFakeDb([
      { match: "SELECT id FROM sites WHERE id = ?", row: { id: "st_one" } },
      {
        match: "FROM site_creation_jobs WHERE site_id = ?",
        row: {
          id: "job_one",
          site_id: "st_one",
          status: "running",
          current_step_index: 5,
          total_steps: 15,
        },
      },
      {
        match: "FROM site_creation_job_steps",
        row: {
          step_key: "create_site_settings",
          step_order: 5,
          status: "completed",
        },
      },
    ]);
    const res = await admin.request(
      "/api/admin/sites/st_one/provision",
      {},
      buildEnv(db),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      resource: { current_step: number; status: string; step_key: string };
    };
    expect(body.resource.current_step).toBe(5);
    expect(body.resource.status).toBe("completed");
    expect(body.resource.step_key).toBe("create_site_settings");
  });

  it("falls back to the job row when no step rows exist yet (pending job)", async () => {
    const db = makeFakeDb([
      { match: "SELECT id FROM sites WHERE id = ?", row: { id: "st_two" } },
      {
        match: "FROM site_creation_jobs WHERE site_id = ?",
        row: {
          id: "job_two",
          site_id: "st_two",
          status: "pending",
          current_step_index: 0,
          total_steps: 15,
        },
      },
    ]);
    const res = await admin.request(
      "/api/admin/sites/st_two/provision",
      {},
      buildEnv(db),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      resource: { current_step: number; status: string; step_key: string };
    };
    expect(body.resource.current_step).toBe(0);
    expect(body.resource.status).toBe("pending");
    expect(body.resource.step_key).toBe("");
  });

  it("returns 404 when no site_creation_jobs row exists for the site_id", async () => {
    const db = makeFakeDb([
      { match: "SELECT id FROM sites WHERE id = ?", row: { id: "st_three" } },
      // No site_creation_jobs row planted -> findActiveJobForSite returns null.
    ]);
    const res = await admin.request(
      "/api/admin/sites/st_three/provision",
      {},
      buildEnv(db),
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(typeof body.error).toBe("string");
    expect(body.error.length).toBeGreaterThan(0);
  });

  it("returns 404 when the site itself does not exist (no internal-state leak)", async () => {
    const db = makeFakeDb();
    const res = await admin.request(
      "/api/admin/sites/st_missing/provision",
      {},
      buildEnv(db),
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(typeof body.error).toBe("string");
  });
});

// ---------------------------------------------------------------------
// T39.AC2 — GET /provision response includes launch_readiness.
// ---------------------------------------------------------------------

const READINESS_ROLLUP = {
  domain_attached: true,
  published_articles: 15,
  media_count: 4,
  cache_warmed: true,
  smoke_passed: true,
  content_mode: "ai",
};

describe("GET /api/admin/sites/:id/provision launch_readiness (T39 D6)", () => {
  it("GET /provision response includes launch_readiness from the update_launch_readiness step output", async () => {
    const db = makeFakeDb([
      { match: "SELECT id FROM sites WHERE id = ?", row: { id: "st_lr" } },
      {
        match: "FROM site_creation_jobs WHERE site_id = ?",
        row: {
          id: "job_lr",
          site_id: "st_lr",
          status: "completed",
          current_step_index: 16,
          total_steps: 16,
        },
      },
      {
        match: "ORDER BY step_order DESC",
        row: {
          step_key: "update_launch_readiness",
          step_order: 15,
          status: "completed",
        },
      },
      {
        match: "step_key = 'update_launch_readiness'",
        row: {
          output: JSON.stringify({
            step: "update_launch_readiness",
            kind: "launch_readiness_rollup",
            schema_version: 1,
            site_id: "st_lr",
            launch_readiness: READINESS_ROLLUP,
          }),
        },
      },
    ]);
    const res = await admin.request(
      "/api/admin/sites/st_lr/provision",
      {},
      buildEnv(db),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      resource: { current_step: number; status: string; step_key: string };
      launch_readiness: typeof READINESS_ROLLUP;
    };
    expect(body.resource.step_key).toBe("update_launch_readiness");
    expect(body.launch_readiness).toEqual(READINESS_ROLLUP);
    expect(body.launch_readiness.domain_attached).toBe(true);
    expect(body.launch_readiness.published_articles).toBe(15);
    expect(body.launch_readiness.content_mode).toBe("ai");
  });

  it("includes launch_readiness: null before the rollup step has run", async () => {
    const db = makeFakeDb([
      { match: "SELECT id FROM sites WHERE id = ?", row: { id: "st_early" } },
      {
        match: "FROM site_creation_jobs WHERE site_id = ?",
        row: {
          id: "job_early",
          site_id: "st_early",
          status: "running",
          current_step_index: 3,
          total_steps: 16,
        },
      },
      {
        match: "ORDER BY step_order DESC",
        row: {
          step_key: "allocate_vertical_categories",
          step_order: 3,
          status: "completed",
        },
      },
      // No update_launch_readiness output row planted -> rollup absent.
    ]);
    const res = await admin.request(
      "/api/admin/sites/st_early/provision",
      {},
      buildEnv(db),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect("launch_readiness" in body).toBe(true);
    expect(body.launch_readiness).toBeNull();
  });

  it("treats corrupt stored readiness JSON as absent (null), not a 500", async () => {
    const db = makeFakeDb([
      { match: "SELECT id FROM sites WHERE id = ?", row: { id: "st_bad" } },
      {
        match: "FROM site_creation_jobs WHERE site_id = ?",
        row: {
          id: "job_bad",
          site_id: "st_bad",
          status: "completed",
          current_step_index: 16,
          total_steps: 16,
        },
      },
      {
        match: "ORDER BY step_order DESC",
        row: {
          step_key: "update_launch_readiness",
          step_order: 15,
          status: "completed",
        },
      },
      {
        match: "step_key = 'update_launch_readiness'",
        row: { output: "{not-valid-json" },
      },
    ]);
    const res = await admin.request(
      "/api/admin/sites/st_bad/provision",
      {},
      buildEnv(db),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.launch_readiness).toBeNull();
  });
});

// ---------------------------------------------------------------------
// T39 — update_launch_readiness step rollup (the producer of the
// launch_readiness object the endpoint above surfaces).
// ---------------------------------------------------------------------

interface StepFakeOpts {
  site?: { id: string; content_mode?: string | null } | null;
  attachedCount?: number;
  publishedCount?: number;
  mediaCount?: number;
  stepStatuses?: Record<string, string>;
}

// Bind-aware fake: the two step-status reads share one SQL string and
// differ only in the bound step_key, so the fake answers from binds.
function makeStepFakeDb(opts: StepFakeOpts): D1Database {
  const db = {
    prepare(sql: string) {
      let captured: unknown[] = [];
      const stmt = {
        bind(...binds: unknown[]) {
          captured = binds;
          return stmt;
        },
        async first<T = unknown>(): Promise<T | null> {
          if (sql.indexOf("FROM sites WHERE id = ?") >= 0) {
            return (opts.site ?? null) as T | null;
          }
          if (sql.indexOf("AS attached_count FROM domains") >= 0) {
            return ({
              attached_count: opts.attachedCount ?? 0,
            } as unknown) as T;
          }
          if (sql.indexOf("AS published_count FROM articles") >= 0) {
            return ({
              published_count: opts.publishedCount ?? 0,
            } as unknown) as T;
          }
          if (sql.indexOf("AS media_count FROM media") >= 0) {
            return ({ media_count: opts.mediaCount ?? 0 } as unknown) as T;
          }
          if (sql.indexOf("SELECT status FROM site_creation_job_steps") >= 0) {
            const stepKey = String(captured[1] ?? "");
            const status = (opts.stepStatuses ?? {})[stepKey];
            return (status ? ({ status } as unknown) : null) as T | null;
          }
          return null;
        },
        async run() {
          void captured;
          return { success: true, meta: {} };
        },
        async all<T = unknown>() {
          return { results: [] as T[], success: true, meta: {} };
        },
      };
      return stmt;
    },
  } as unknown as D1Database;
  return db;
}

interface RollupOutput {
  step: string;
  kind: string;
  schema_version: number;
  site_id: string;
  launch_readiness: {
    domain_attached: boolean;
    published_articles: number;
    media_count: number;
    cache_warmed: boolean;
    smoke_passed: boolean;
    content_mode: string;
  };
}

describe("update_launch_readiness step (T39 D6)", () => {
  it("rolls live D1 counts + prior step statuses into the readiness output", async () => {
    const db = makeStepFakeDb({
      site: { id: "st_roll", content_mode: "ai" },
      attachedCount: 1,
      publishedCount: 15,
      mediaCount: 4,
      stepStatuses: {
        warm_homepage_cache: "completed_dry_run",
        run_site_smoke_tests: "completed",
      },
    });
    const result = await STEPS.update_launch_readiness({
      env: buildEnv(db),
      db,
      job_id: "job_roll",
      site_id: "st_roll",
      step_order: 15,
    });
    expect(result.status).toBe("completed");
    const output = JSON.parse(result.output) as RollupOutput;
    expect(output.step).toBe("update_launch_readiness");
    expect(output.kind).toBe("launch_readiness_rollup");
    expect(output.site_id).toBe("st_roll");
    expect(output.launch_readiness).toEqual({
      domain_attached: true,
      published_articles: 15,
      media_count: 4,
      cache_warmed: true,
      smoke_passed: true,
      content_mode: "ai",
    });
  });

  it("reports not-ready signals honestly (pending domain, no smoke pass, default content_mode)", async () => {
    const db = makeStepFakeDb({
      site: { id: "st_pend", content_mode: null },
      attachedCount: 0,
      publishedCount: 0,
      mediaCount: 0,
      stepStatuses: {},
    });
    const result = await STEPS.update_launch_readiness({
      env: buildEnv(db),
      db,
      job_id: "job_pend",
      site_id: "st_pend",
      step_order: 15,
    });
    expect(result.status).toBe("completed");
    const output = JSON.parse(result.output) as RollupOutput;
    expect(output.launch_readiness).toEqual({
      domain_attached: false,
      published_articles: 0,
      media_count: 0,
      cache_warmed: false,
      smoke_passed: false,
      content_mode: "ai",
    });
  });

  it("fails the step when the sites row is missing", async () => {
    const db = makeStepFakeDb({ site: null });
    const result = await STEPS.update_launch_readiness({
      env: buildEnv(db),
      db,
      job_id: "job_gone",
      site_id: "st_gone",
      step_order: 15,
    });
    expect(result.status).toBe("failed");
    expect(result.error).toContain("st_gone");
  });
});

// ---------------------------------------------------------------------
// T39.AC3 — domains template renders readiness badges.
// ---------------------------------------------------------------------

describe("domains template renders readiness badges (T39 D6)", () => {
  it("server-renders the readiness badge container inside the provisioning panel", () => {
    const html = domainsPage([], [], {});
    expect(html).toContain("data-launch-readiness-badges");
    expect(html).toContain('class="launch-readiness-badges"');
    expect(html).toContain("data-launch-readiness");
    expect(html).toContain("data-launch-readiness-value");
  });

  it("ships the badge renderer driven by the poll body's launch_readiness object", () => {
    const html = domainsPage([], [], {});
    expect(html).toContain("renderReadinessBadges");
    expect(html).toContain("data-readiness-key");
    expect(html).toContain("launch-readiness-badge");
    expect(html).toContain("body.launch_readiness");
    const readinessKeys = [
      "domain_attached",
      "published_articles",
      "media_count",
      "cache_warmed",
      "smoke_passed",
      "content_mode",
    ];
    for (const key of readinessKeys) {
      expect(html).toContain(key);
    }
  });

  it("keeps the inline badge script ES5-only (no arrows, no lexical declarations)", () => {
    const html = domainsPage([], [], {});
    const scriptStart = html.indexOf("renderReadinessBadges");
    expect(scriptStart).toBeGreaterThan(-1);
    const badgeScript = html.slice(scriptStart, scriptStart + 1200);
    expect(badgeScript.indexOf("=>")).toBe(-1);
    expect(badgeScript.indexOf("const ")).toBe(-1);
    expect(badgeScript.indexOf("let ")).toBe(-1);
  });
});
