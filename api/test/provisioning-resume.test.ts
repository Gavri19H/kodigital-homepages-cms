// T39 [BCL-013] — Resume a stalled provisioning job from the UI.
//
// Backs RC-066 (T39-AC1). Every backing it() title embeds BOTH the
// `[api/test/provisioning-resume.test.ts]` file literal (the
// expected_test_name_regex the D13 parse_test_output runner matches against
// passing test names) AND the L2_AUTO_DISAMBIGUATION:T39-AC1:RC-066
// observation pattern, so the finalize/evaluator RC<->test binding is
// unambiguous.
//
// AC1: "a deliberately-stalled site resumes to active from the UI action
// (drives advanceNextStep / provision-next); a re-openable progress panel
// shows status."
//
// The proof has three layers, all develop-legal and pre-deploy:
//   (1) runner — drive a build PART-WAY (deliberately stall it), then
//       resumeProvisioning() drives it the rest of the way; the site flips to
//       status='active', all 16 step rows end completed, every side-effect
//       table has rows, and the WHOLE dry-run walk emits ZERO outbound fetch.
//   (2) handler — POST /api/admin/sites/:id/provision/resume drives the
//       stalled site to active and returns the {status, site_status} shape.
//   (3) UI — the SHIPPED DOMAINS_ACTIONS_SCRIPT (run in a node vm against a
//       DOM stub): the "Resume" action POSTs /provision/resume + opens the
//       progress panel (reading the real GET /provision shape), Close hides
//       it, and "View progress" re-opens it (re-openable, shows status).

import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import admin from "../src/admin/router";
import {
  STEP_KEYS,
  TOTAL_STEPS,
  resumeProvisioning,
  runProvisioningToCompletion,
} from "../src/site-provisioning";
import { DOMAINS_ACTIONS_SCRIPT } from "../src/admin/templates/domains";
import type { Env } from "../src/env";

const nodeRequire = createRequire(import.meta.url);
const vm = nodeRequire("node:vm") as typeof import("node:vm");

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

// ---------------------------------------------------------------------------
// In-process D1 fake that drives the real 16-step runner end-to-end (adapted
// from site-provisioning-run-to-completion.test.ts). It tracks every
// side-effect table the steps write, exposes the live `job` row so a test can
// SIMULATE a stall (park it 'failed'), and answers `SELECT status FROM sites`
// from the live `site` object so resumeProvisioning's readSiteStatus observes
// the go-live flip.
// ---------------------------------------------------------------------------
interface StepRow {
  job_id: string;
  step_key: string;
  step_order: number;
  status: string;
  attempt_count: number;
  output: string | null;
}
interface ArticleRow {
  site_id: string;
  slug: string;
  status: string;
  homepage_section: string;
  published_at: number | null;
  category_id: number | null;
}
interface FakeJob {
  id: string;
  site_id: string;
  status: string;
  current_step_index: number;
  total_steps: number;
}

interface FakeWorld {
  db: D1Database;
  job: FakeJob;
  stepsRows: StepRow[];
  articles: ArticleRow[];
  settings: Array<{ site_id: string; key: string }>;
  pages: Array<{ site_id: string; slug: string }>;
  site: { content_version: number; status: string };
  siteCategories: Array<{ site_id: string; category_id: number }>;
}

function makeFakeDb(initialJob: { id: string; site_id: string }): FakeWorld {
  const job: FakeJob = {
    id: initialJob.id,
    site_id: initialJob.site_id,
    status: "pending",
    current_step_index: 0,
    total_steps: TOTAL_STEPS,
  };
  const stepsRows: StepRow[] = [];
  const aiGenerations = new Map<string, Record<string, unknown>>();
  const articles: ArticleRow[] = [];
  const site = { content_version: 0, status: "draft" };
  const settings: Array<{ site_id: string; key: string }> = [];
  const pages: Array<{ site_id: string; slug: string }> = [];
  const siteCategories: Array<{ site_id: string; category_id: number }> = [];

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
            // Live status so readSiteStatus + update_launch_readiness observe
            // the 'draft' -> 'active' go-live flip.
            return ({
              id: job.site_id,
              name: "Health Site",
              domain: "health.example",
              vertical_slug: "health",
              status: site.status,
              content_mode: "ai",
            } as unknown) as T;
          }
          if (sql.indexOf("FROM site_creation_jobs WHERE site_id = ?") >= 0) {
            return ({
              id: job.id,
              site_id: job.site_id,
              status: job.status,
              current_step_index: job.current_step_index,
              total_steps: job.total_steps,
            } as unknown) as T;
          }
          if (sql.indexOf("FROM ai_generations WHERE idempotency_key = ?") >= 0) {
            const [idempotency_key] = captured as [string];
            return (aiGenerations.get(idempotency_key) ?? null) as unknown as T | null;
          }
          if (sql.indexOf("SELECT COUNT(*) AS published_count FROM articles") >= 0) {
            const [site_id] = captured as [string];
            const published_count = articles.filter(
              (a) =>
                a.site_id === site_id &&
                a.homepage_section === "starter" &&
                a.status === "published" &&
                a.published_at !== null,
            ).length;
            return ({ published_count } as unknown) as T;
          }
          if (sql.indexOf("SELECT COUNT(*) AS settings_count FROM site_settings") >= 0) {
            const [site_id] = captured as [string];
            const settings_count = settings.filter((s) => s.site_id === site_id).length;
            return ({ settings_count } as unknown) as T;
          }
          if (sql.indexOf("SELECT COUNT(*) AS pages_count FROM pages") >= 0) {
            const [site_id] = captured as [string];
            const pages_count = pages.filter((p) => p.site_id === site_id).length;
            return ({ pages_count } as unknown) as T;
          }
          return null;
        },
        async run() {
          if (sql.indexOf("INSERT INTO site_creation_job_steps") >= 0) {
            const [job_id, step_key, step_order] = captured as [string, string, number];
            const existing = stepsRows.find(
              (r) => r.job_id === job_id && r.step_key === step_key,
            );
            if (existing) {
              existing.status = "running";
              existing.attempt_count += 1;
            } else {
              stepsRows.push({
                job_id,
                step_key,
                step_order,
                status: "running",
                attempt_count: 1,
                output: null,
              });
            }
          } else if (sql.indexOf("UPDATE site_creation_job_steps") >= 0) {
            const [status, output, , jobId, step_key] = captured as [
              string,
              string,
              string | null,
              string,
              string,
            ];
            const row = stepsRows.find(
              (r) => r.job_id === jobId && r.step_key === step_key,
            );
            if (row) {
              row.status = status;
              row.output = output;
            }
          } else if (
            sql.indexOf("UPDATE site_creation_jobs SET status = 'running', last_error = NULL") >= 0
          ) {
            // T39 resumeProvisioning reset of a parked 'failed' job.
            job.status = "running";
          } else if (sql.indexOf("UPDATE site_creation_jobs SET") >= 0) {
            // advanceJobPointer: binds [current_step, current_step_index, status, ...]
            const [, current_step_index, status] = captured as [
              string,
              number,
              string,
              string | null,
              string,
            ];
            job.current_step_index = current_step_index;
            job.status = status;
          } else if (sql.indexOf("INSERT INTO ai_generations") >= 0) {
            const [id, site_id, task, provider, model, prompt_version, idempotency_key, request_json, target_type, target_id] = captured as [string, string | null, string, string, string, string, string, string | null, string | null, string | null];
            if (!aiGenerations.has(idempotency_key)) {
              aiGenerations.set(idempotency_key, { id, site_id, task, provider, model, prompt_version, idempotency_key, request_json, response_json: null, parsed_json: null, status: "pending", target_type, target_id, error_message: null, created_at: 0, updated_at: 0 });
            }
          } else if (sql.indexOf("UPDATE ai_generations") >= 0) {
            const idempotency_key = captured[captured.length - 1] as string;
            const r = aiGenerations.get(idempotency_key);
            if (r) {
              if (sql.indexOf("status = 'success'") >= 0) (r as { status: string }).status = "success";
              else if (sql.indexOf("status = 'failed'") >= 0) (r as { status: string }).status = "failed";
              else if (sql.indexOf("status = 'fallback'") >= 0) (r as { status: string }).status = "fallback";
            }
          } else if (sql.indexOf("INSERT OR IGNORE INTO articles") >= 0) {
            const [site_id, slug] = captured as [string, string];
            const category_id = (captured[6] ?? null) as number | null;
            if (!articles.some((a) => a.site_id === site_id && a.slug === slug)) {
              articles.push({
                site_id,
                slug,
                status: "published",
                homepage_section: "starter",
                published_at: null,
                category_id,
              });
            }
          } else if (sql.indexOf("INSERT OR IGNORE INTO site_settings") >= 0) {
            const [site_id, key] = captured as [string, string];
            if (!settings.some((s) => s.site_id === site_id && s.key === key)) {
              settings.push({ site_id, key });
            }
          } else if (
            sql.indexOf("INSERT INTO site_settings") >= 0 &&
            sql.indexOf("ON CONFLICT(site_id, key)") >= 0
          ) {
            const [site_id, key] = captured as [string, string];
            if (!settings.some((s) => s.site_id === site_id && s.key === key)) {
              settings.push({ site_id, key });
            }
          } else if (sql.indexOf("INSERT OR IGNORE INTO pages") >= 0) {
            const [site_id] = captured as [string];
            if (!pages.some((p) => p.site_id === site_id && p.slug === "about")) {
              pages.push({ site_id, slug: "about" });
            }
          } else if (
            sql.indexOf("INSERT INTO pages") >= 0 &&
            sql.indexOf("ON CONFLICT(site_id, slug)") >= 0
          ) {
            const [site_id, slug] = captured as [string, string];
            if (!pages.some((p) => p.site_id === site_id && p.slug === slug)) {
              pages.push({ site_id, slug });
            }
          } else if (sql.indexOf("UPDATE articles SET status = 'published'") >= 0) {
            const [site_id] = captured as [string];
            for (const a of articles) {
              if (a.site_id === site_id && a.homepage_section === "starter") {
                a.status = "published";
                if (a.published_at === null) a.published_at = 1_700_000_000;
              }
            }
          } else if (sql.indexOf("UPDATE sites SET content_version") >= 0) {
            site.content_version += 1;
          } else if (sql.indexOf("UPDATE sites SET status = 'active'") >= 0) {
            site.status = "active";
          } else if (sql.indexOf("INSERT OR IGNORE INTO site_categories") >= 0) {
            const [site_id, category_id] = captured as [string, number, number];
            if (!siteCategories.some((c) => c.site_id === site_id && c.category_id === category_id)) {
              siteCategories.push({ site_id, category_id });
            }
          }
          return { success: true, meta: {} };
        },
        async all<T = unknown>() {
          if (
            sql.indexOf("FROM category_verticals") >= 0 &&
            sql.indexOf("JOIN verticals") >= 0
          ) {
            return {
              results: [
                { category_id: 4, display_order: 0 },
                { category_id: 1, display_order: 1 },
              ] as unknown as T[],
              success: true,
              meta: {},
            };
          }
          if (sql.indexOf("FROM site_categories WHERE site_id = ?") >= 0) {
            const [site_id] = captured as [string];
            const rows = siteCategories
              .filter((c) => c.site_id === site_id)
              .map((c) => ({ category_id: c.category_id }));
            return { results: rows as unknown as T[], success: true, meta: {} };
          }
          return { results: [] as T[], success: true, meta: {} };
        },
      };
      return stmt;
    },
  } as unknown as D1Database;

  return { db, job, stepsRows, articles, settings, pages, site, siteCategories };
}

// Drive the build PART-WAY to deliberately stall it (the background driver
// "died" after `steps` ticks); returns once the job is parked mid-build.
async function stallMidBuild(world: FakeWorld, env: Env, siteId: string, steps: number) {
  const summary = await runProvisioningToCompletion(env, world.db, siteId, steps);
  // Precondition assertions live in the callers; this just returns the partial.
  return summary;
}

function everyStepSucceeded(stepsRows: StepRow[]): boolean {
  return (
    stepsRows.length === TOTAL_STEPS &&
    stepsRows.every((r) => /^completed/.test(r.status))
  );
}

// ===========================================================================
// (1) Runner — a deliberately stalled build resumes to active.
// ===========================================================================
describe("T39-AC1 resumeProvisioning drives a stalled build to active", () => {
  it("[api/test/provisioning-resume.test.ts] L2_AUTO_DISAMBIGUATION:T39-AC1:RC-066 a mid-build stall (running, not advancing) resumes to status='active' with all 16 steps completed and every side-effect table populated", async () => {
    const world = makeFakeDb({ id: "job_stall", site_id: "st_stall" });
    const env = buildEnv(world.db);

    // Deliberately stall: drive only 5 of 16 steps, then stop.
    const partial = await stallMidBuild(world, env, "st_stall", 5);
    expect(partial.steps_run).toBe(5);
    expect(world.job.status).toBe("running");
    expect(world.job.current_step_index).toBe(5);
    expect(world.site.status).toBe("draft"); // NOT live yet
    expect(world.stepsRows.length).toBe(5);

    // Resume from the UI: drives advanceNextStep to completion.
    const result = await resumeProvisioning(env, world.db, "st_stall");
    expect(result.resumed).toBe(true);
    expect(result.reason).toBeNull();
    expect(result.final_status).toBe("completed");
    expect(result.site_status).toBe("active");

    // Every declared step ran end-to-end and ended in a completed state.
    expect(everyStepSucceeded(world.stepsRows)).toBe(true);
    for (let i = 0; i < TOTAL_STEPS; i++) {
      expect(world.stepsRows[i]?.step_key).toBe(STEP_KEYS[i]);
    }

    // Every side-effect table has rows (DoD: no "succeeded but 0 rows").
    expect(world.articles.length).toBe(15);
    for (const a of world.articles) {
      expect(a.status).toBe("published");
      expect(a.published_at).not.toBeNull();
      expect(a.category_id).not.toBeNull();
    }
    expect(world.settings.length).toBeGreaterThan(0);
    expect(world.pages.length).toBeGreaterThan(0);
    expect(world.siteCategories.length).toBeGreaterThan(0);
    expect(world.site.status).toBe("active");
  });

  it("[api/test/provisioning-resume.test.ts] L2_AUTO_DISAMBIGUATION:T39-AC1:RC-066 a build PARKED in status='failed' is reset and resumed to active (the parked step re-attempts)", async () => {
    const world = makeFakeDb({ id: "job_failed", site_id: "st_failed" });
    const env = buildEnv(world.db);

    // Drive part-way, then SIMULATE a failed step parking the job.
    await stallMidBuild(world, env, "st_failed", 6);
    expect(world.job.current_step_index).toBe(6);
    world.job.status = "failed"; // operator sees a halted, 'failed' build

    const result = await resumeProvisioning(env, world.db, "st_failed");
    expect(result.resumed).toBe(true);
    expect(result.final_status).toBe("completed");
    expect(result.site_status).toBe("active");
    expect(everyStepSucceeded(world.stepsRows)).toBe(true);
    expect(world.site.status).toBe("active");
  });

  it("[api/test/provisioning-resume.test.ts] L2_AUTO_DISAMBIGUATION:T39-AC1:RC-066 resuming a stalled build emits ZERO outbound fetch to api.cloudflare.com in dry-run", async () => {
    const fetchCalls: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
      fetchCalls.push(typeof input === "string" ? input : input.toString());
      return new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof globalThis.fetch;
    try {
      const world = makeFakeDb({ id: "job_dry", site_id: "st_dry" });
      const env = buildEnv(world.db);
      await stallMidBuild(world, env, "st_dry", 5);
      const result = await resumeProvisioning(env, world.db, "st_dry");
      expect(result.final_status).toBe("completed");
      // The whole dry-run walk — partial drive + resume — hit the network 0 times.
      expect(fetchCalls).toHaveLength(0);
      expect(
        fetchCalls.filter((u) => u.indexOf("api.cloudflare.com") >= 0),
      ).toHaveLength(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("[api/test/provisioning-resume.test.ts] L2_AUTO_DISAMBIGUATION:T39-AC1:RC-066 resume is a no-op for a missing job (no_job) and an already-completed job (already_completed)", async () => {
    // No job for the site.
    const noJobDb = {
      prepare() {
        const stmt = {
          bind() {
            return stmt;
          },
          async first() {
            return null;
          },
          async run() {
            return { success: true, meta: {} };
          },
          async all() {
            return { results: [], success: true, meta: {} };
          },
        };
        return stmt;
      },
    } as unknown as D1Database;
    const noJob = await resumeProvisioning(buildEnv(noJobDb), noJobDb, "st_none");
    expect(noJob.resumed).toBe(false);
    expect(noJob.reason).toBe("no_job");
    expect(noJob.final_status).toBe("no_job");

    // Already-completed job: drive to completion first, then resume is a no-op.
    const world = makeFakeDb({ id: "job_done", site_id: "st_done" });
    const env = buildEnv(world.db);
    await runProvisioningToCompletion(env, world.db, "st_done");
    expect(world.job.status).toBe("completed");
    const again = await resumeProvisioning(env, world.db, "st_done");
    expect(again.resumed).toBe(false);
    expect(again.reason).toBe("already_completed");
    expect(again.final_status).toBe("completed");
    expect(again.steps_run).toBe(0);
  });
});

// ===========================================================================
// (2) Handler — POST /api/admin/sites/:id/provision/resume.
// ===========================================================================
describe("T39-AC1 POST /provision/resume handler", () => {
  it("[api/test/provisioning-resume.test.ts] L2_AUTO_DISAMBIGUATION:T39-AC1:RC-066 drives a stalled site to active and returns {status:'completed', site_status:'active', completed:true}", async () => {
    const world = makeFakeDb({ id: "job_h", site_id: "st_h" });
    const env = buildEnv(world.db);
    await stallMidBuild(world, env, "st_h", 5);
    expect(world.site.status).toBe("draft");

    const res = await admin.request(
      "/api/admin/sites/st_h/provision/resume",
      { method: "POST" },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      site_status: string;
      resumed: boolean;
      completed: boolean;
    };
    expect(body.resumed).toBe(true);
    expect(body.status).toBe("completed");
    expect(body.site_status).toBe("active");
    expect(body.completed).toBe(true);
    expect(world.site.status).toBe("active");
  });

  it("[api/test/provisioning-resume.test.ts] L2_AUTO_DISAMBIGUATION:T39-AC1:RC-066 returns 404 for a missing site and 404 for a site with no provisioning job", async () => {
    // Missing site -> 404.
    const missingSiteDb = {
      prepare() {
        const stmt = {
          bind() {
            return stmt;
          },
          async first() {
            return null;
          },
          async run() {
            return { success: true, meta: {} };
          },
          async all() {
            return { results: [], success: true, meta: {} };
          },
        };
        return stmt;
      },
    } as unknown as D1Database;
    const r1 = await admin.request(
      "/api/admin/sites/st_gone/provision/resume",
      { method: "POST" },
      buildEnv(missingSiteDb),
    );
    expect(r1.status).toBe(404);

    // Site exists, no job -> 404 (neutral).
    const siteOnlyDb = {
      prepare(sql: string) {
        const stmt = {
          bind() {
            return stmt;
          },
          async first<T = unknown>(): Promise<T | null> {
            if (sql.indexOf("SELECT id FROM sites WHERE id = ?") >= 0) {
              return ({ id: "st_nojob" } as unknown) as T;
            }
            return null; // findActiveJobForSite -> null
          },
          async run() {
            return { success: true, meta: {} };
          },
          async all<T = unknown>() {
            return { results: [] as T[], success: true, meta: {} };
          },
        };
        return stmt;
      },
    } as unknown as D1Database;
    const r2 = await admin.request(
      "/api/admin/sites/st_nojob/provision/resume",
      { method: "POST" },
      buildEnv(siteOnlyDb),
    );
    expect(r2.status).toBe(404);
  });
});

// ===========================================================================
// (3) UI — the shipped Resume action + re-openable progress panel.
// ===========================================================================
class FakeNode {
  tag: string;
  tagName: string;
  nodeType = 1;
  attrs: Record<string, string> = {};
  children: FakeNode[] = [];
  parentNode: FakeNode | null = null;
  listeners: Record<string, Array<(e?: unknown) => void>> = {};
  hidden = false;
  className = "";
  nodeValue = "";

  constructor(tag: string) {
    this.tag = tag;
    this.tagName = tag.toUpperCase();
  }

  get firstChild(): FakeNode | null {
    return this.children.length ? this.children[0]! : null;
  }
  appendChild(n: FakeNode): FakeNode {
    n.parentNode = this;
    this.children.push(n);
    return n;
  }
  removeChild(n: FakeNode): FakeNode {
    const i = this.children.indexOf(n);
    if (i >= 0) this.children.splice(i, 1);
    n.parentNode = null;
    return n;
  }
  setAttribute(k: string, v: string): void {
    this.attrs[k] = String(v);
  }
  getAttribute(k: string): string | null {
    return k in this.attrs ? this.attrs[k]! : null;
  }
  addEventListener(type: string, fn: (e?: unknown) => void): void {
    (this.listeners[type] = this.listeners[type] || []).push(fn);
  }
  get textContent(): string {
    if (this.tag === "#text") return this.nodeValue;
    return this.children.map((c) => c.textContent).join("");
  }
  set textContent(v: string) {
    this.children = [];
    const t = new FakeNode("#text");
    t.nodeValue = String(v);
    t.parentNode = this;
    this.children.push(t);
  }
  private matchAttr(sel: string): string | null {
    if (sel.charAt(0) !== "[" || sel.charAt(sel.length - 1) !== "]") return null;
    return sel.slice(1, -1);
  }
  querySelector(sel: string): FakeNode | null {
    const all = this.querySelectorAll(sel);
    return all.length ? all[0]! : null;
  }
  querySelectorAll(sel: string): FakeNode[] {
    const attr = this.matchAttr(sel);
    const out: FakeNode[] = [];
    if (attr === null) return out;
    const walk = (n: FakeNode) => {
      for (const c of n.children) {
        if (c.getAttribute(attr) !== null) out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out;
  }
  fire(type: string, e?: unknown): void {
    (this.listeners[type] || []).forEach((fn) => fn.call(this, e));
  }
}

interface FetchCall {
  url: string;
  method: string;
}
type Json = Record<string, unknown>;

function makeFetch(getJson: (url: string, method: string) => Json) {
  const calls: FetchCall[] = [];
  const fetchStub = (url: string, init?: { method?: string }) => {
    const method = (init && init.method) || "GET";
    calls.push({ url, method });
    return Promise.resolve({
      ok: true,
      status: method === "POST" ? 200 : 200,
      json: () => Promise.resolve(getJson(url, method)),
    });
  };
  return { calls, fetchStub };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

// Build the minimal page DOM the shipped DOMAINS_ACTIONS_SCRIPT addresses: a
// tbody with one row (data-site-id + data-domain + a resume/view-progress
// action menu) and the server-rendered provisioning panel with a close button.
function bootDomainsUi(getJson: (url: string, method: string) => Json) {
  const tbody = new FakeNode("tbody");
  tbody.setAttribute("id", "domains-list-body");
  const tr = new FakeNode("tr");
  tr.setAttribute("data-site-id", "st_ui");
  tr.setAttribute("data-domain", "ui.example");
  tbody.appendChild(tr);
  const actionsTd = tr.appendChild(new FakeNode("td"));
  const items: Record<string, FakeNode> = {};
  for (const a of ["resume", "view-progress"]) {
    const btn = actionsTd.appendChild(new FakeNode("button"));
    btn.setAttribute("data-action", a);
    items[a] = btn;
  }

  // Server-rendered provisioning panel with the slots the poll queries.
  const panel = new FakeNode("section");
  panel.setAttribute("id", "provisioning-status-panel");
  panel.hidden = true;
  for (const a of [
    "data-panel-title",
    "data-status",
    "data-steps",
    "data-launch-readiness",
    "data-launch-readiness-value",
  ]) {
    panel.appendChild(new FakeNode("div")).setAttribute(a, "");
  }
  const closeBtn = panel.appendChild(new FakeNode("button"));
  closeBtn.setAttribute("data-panel-close", "");

  const byId: Record<string, FakeNode> = {
    "domains-list-body": tbody,
    "provisioning-status-panel": panel,
  };
  const doc = {
    getElementById: (id: string) => byId[id] ?? null,
    createElement: (tag: string) => new FakeNode(tag),
    createTextNode: (text: string) => {
      const n = new FakeNode("#text");
      n.nodeValue = String(text);
      return n;
    },
    querySelector: () => null,
    listeners: {} as Record<string, Array<(e?: unknown) => void>>,
    addEventListener(type: string, fn: (e?: unknown) => void) {
      (this.listeners[type] = this.listeners[type] || []).push(fn);
    },
  };
  const { calls, fetchStub } = makeFetch(getJson);
  const win = { setTimeout: () => 0, prompt: () => null, confirm: () => true };
  vm.runInNewContext(DOMAINS_ACTIONS_SCRIPT, {
    document: doc,
    fetch: fetchStub,
    window: win,
  });
  return {
    panel,
    closeBtn,
    calls,
    statusEl: panel.querySelector("[data-status]")!,
    clickAction: (a: string) => tbody.fire("click", { target: items[a] }),
    clickClose: () => panel.fire("click", { target: closeBtn }),
  };
}

describe("T39-AC1 Resume UI action + re-openable progress panel", () => {
  it("[api/test/provisioning-resume.test.ts] L2_AUTO_DISAMBIGUATION:T39-AC1:RC-066 the Resume action POSTs /provision/resume, opens the panel and the panel shows the live GET /provision status", async () => {
    const provisionBody: Json = {
      resource: { status: "running", step_key: "warm_homepage_cache", current_step: 13 },
      launch_readiness: null,
    };
    const ui = bootDomainsUi((url, method) => {
      if (method === "POST" && url.indexOf("/provision/resume") >= 0) {
        return { resumed: true, status: "completed", site_status: "active", completed: true };
      }
      return provisionBody; // GET /provision
    });

    // Panel starts hidden; the Resume action opens it and drives the resume.
    expect(ui.panel.hidden).toBe(true);
    ui.clickAction("resume");
    await flush();
    await flush();

    const resumePost = ui.calls.find(
      (c) => c.method === "POST" && c.url.indexOf("/api/admin/sites/st_ui/provision/resume") >= 0,
    );
    expect(resumePost, "Resume POSTs /provision/resume").toBeDefined();
    // Panel opened and shows the real GET /provision status (resource.status).
    expect(ui.panel.hidden).toBe(false);
    const pollGet = ui.calls.find(
      (c) => c.method === "GET" && c.url.indexOf("/api/admin/sites/st_ui/provision") >= 0,
    );
    expect(pollGet, "panel polls GET /provision").toBeDefined();
    expect(ui.statusEl.textContent).toContain("running");
    expect(ui.statusEl.textContent).toContain("warm_homepage_cache");
  });

  it("[api/test/provisioning-resume.test.ts] L2_AUTO_DISAMBIGUATION:T39-AC1:RC-066 the panel is re-openable: Close hides it and View progress re-opens it showing status", async () => {
    const ui = bootDomainsUi(() => ({
      resource: { status: "completed", step_key: "update_launch_readiness", current_step: 16 },
      launch_readiness: {
        domain_attached: true,
        cache_warmed: true,
        smoke_passed: true,
      },
    }));

    // Open via View progress.
    ui.clickAction("view-progress");
    await flush();
    expect(ui.panel.hidden).toBe(false);
    const firstPolls = ui.calls.filter((c) => c.method === "GET").length;
    expect(firstPolls).toBeGreaterThan(0);
    expect(ui.statusEl.textContent).toContain("completed");

    // Close hides it.
    ui.clickClose();
    expect(ui.panel.hidden).toBe(true);

    // Re-open via View progress: visible again + a fresh poll fired.
    ui.clickAction("view-progress");
    await flush();
    expect(ui.panel.hidden).toBe(false);
    const secondPolls = ui.calls.filter((c) => c.method === "GET").length;
    expect(secondPolls).toBeGreaterThan(firstPolls);
    expect(ui.statusEl.textContent).toContain("completed");
  });
});
