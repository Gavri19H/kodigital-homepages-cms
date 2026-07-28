// LeadGen R2 fixing mission, Phase P0, slice S0-B1 — activation-preflight
// PARITY regression (quotes-handlers.ts).
//
// OWNER PROBE (in-use, 2026-07-27): "every well-formed draft quote shows
// 'Blocked (N errors)' and activation 409s (quote_activation_blocked) with NO
// reason surfaced anywhere in the UI." A 2026-07-28 replay refinement: a
// MINIMAL well-formed quote DID activate once — the blocker is STATE-
// SPECIFIC, not universal.
//
// LIVE ROOT CAUSE (this round, driven through wrangler dev :8901 against a
// quote authored through the real admin APIs — activity/vertical/quote/
// default funnel/one TwoButtonYesNo section, no shared page yet):
//
//   storeVariantPreflight() — the ADVISORY preflight a variant SAVE
//   (PUT /variants/:id) returns, which quotes-tabs/funnel.ts's Save chain
//   re-renders into the SAME #lg-preflight-panel via renderPreflight — never
//   called computeReworkActivationProblems(), unlike
//   computeQuoteActivationPreflight() (the GET /quotes/:id/activation source
//   AND the real activation-PUT gate, both of which DO call it). So the
//   SAME quote's two preflight sources DISAGREED: a PUT /variants/:id
//   returned `{ ok:false, blocks:[...], problems: [] }` (no shared_page
//   entry) while GET /quotes/:id/activation, in the SAME instant, returned
//   `{ ok:false, blocks:[...], problems: [{ path:"activation.shared_page",
//   severity:"error", ... }] }` for the identical quote. Once every
//   `blocks[]`-triggering issue is cleared (as in a MINIMAL quote), the
//   variant-save advisory flips all the way to a false "Ready to activate —
//   all preflight checks pass" (0 blocks, 0 problems) while the real
//   activation-PUT gate still hard-409s on the missing shared page — exactly
//   the "no reason surfaced anywhere" experience on a quote that has just
//   been saved (i.e. "every well-formed draft quote", since saving is the
//   normal authoring rhythm). Root-cause fix: storeVariantPreflight() now
//   also folds in computeReworkActivationProblems() so its `problems[]`
//   stays byte-identical in content to computeQuoteActivationPreflight()'s
//   for the SAME quote at the SAME instant (fires when missing, clears when
//   fixed — both directions asserted below).
//
// CLIENT-RENDER surface (a) (quotes-tabs/funnel.ts's ~:3417 activation-409
// handler + ~:800 renderPreflight/preflightBlockCard/appendProblemGroups)
// was live-audited (wrangler dev :8901 + Playwright) against this EXACT
// captured quote_activation_blocked body —
//   {"error":"quote_activation_blocked","blocks":[],"problems":
//    [{"path":"activation.shared_page","scope":"section","severity":"error",
//      "message":"The shared first page needs at least one section.",
//      "fix_url":"/admin/leadgen/quotes/<id>/edit"}]}
// — and rendered fully: "Cannot activate this Quote." title, a "Slides"
// problem group, the operator-facing message, and an "Open Quote Builder"
// fix link. No defect reproduced on that seam, so no test/change lives here
// for it (see the P0 S0-B1 dispatch report for the full drive transcript).

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import admin from "../src/admin/router";
import type { Env } from "../src/env";
import { mintPublicId } from "../src/leadgen/ids";
import { computeQuoteActivationPreflight, type QuoteActivationPreflight } from "../src/admin/leadgen/quotes-handlers";
import type { LeadgenQuoteRow } from "../src/admin/leadgen/db-types";

// --- node:sqlite harness (repo pattern — mirrors leadgen-activation-preflight-v25.test.ts) --

type SqliteStatement = {
  run(...params: unknown[]): unknown;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
};
type SqliteDb = {
  prepare(sql: string): SqliteStatement;
  close(): void;
  [method: string]: unknown;
};
type DatabaseSyncCtor = new (path: string) => SqliteDb;

function loadDatabaseSync(): DatabaseSyncCtor | null {
  try {
    const { createRequire } = require("node:module") as typeof import("node:module");
    const nodeRequire = createRequire(import.meta.url);
    const mod = nodeRequire("node:sqlite") as { DatabaseSync: DatabaseSyncCtor };
    return mod.DatabaseSync;
  } catch {
    try {
      const getBuiltin = (process as unknown as {
        getBuiltinModule?: (name: string) => unknown;
      }).getBuiltinModule;
      if (typeof getBuiltin === "function") {
        const mod = getBuiltin("node:sqlite") as { DatabaseSync: DatabaseSyncCtor };
        return mod.DatabaseSync;
      }
    } catch {
      /* fall through */
    }
    return null;
  }
}

function runSql(sdb: SqliteDb, sql: string): void {
  (sdb["exec"] as (s: string) => void)(sql);
}

function d1FromSqlite(sdb: SqliteDb): D1Database {
  const db = {
    prepare(sql: string) {
      let binds: unknown[] = [];
      const stmt = {
        bind(...a: unknown[]) {
          binds = a;
          return stmt;
        },
        async first<T = unknown>(): Promise<T | null> {
          const r = sdb.prepare(sql).get(...binds);
          return (r ?? null) as T | null;
        },
        async all<T = unknown>() {
          const rows = sdb.prepare(sql).all(...binds);
          return { results: rows as T[], success: true, meta: {} };
        },
        async run() {
          const r = sdb.prepare(sql).run(...binds) as {
            changes?: number;
            lastInsertRowid?: number | bigint;
          };
          return {
            success: true,
            meta: { changes: Number(r?.changes ?? 0), last_row_id: Number(r?.lastInsertRowid ?? 0) },
          };
        },
      };
      return stmt;
    },
    async batch(statements: Array<{ run(): Promise<unknown> }>) {
      runSql(sdb, "BEGIN");
      const results: unknown[] = [];
      try {
        for (const statement of statements) {
          results.push(await statement.run());
        }
        runSql(sdb, "COMMIT");
      } catch (err) {
        runSql(sdb, "ROLLBACK");
        throw err;
      }
      return results;
    },
  } as unknown as D1Database;
  return db;
}

function makeKvStub(): KVNamespace {
  const store = new Map<string, { value: string; metadata: unknown }>();
  return {
    async get(key: string): Promise<string | null> {
      return store.has(key) ? store.get(key)!.value : null;
    },
    async getWithMetadata(key: string): Promise<{ value: string | null; metadata: unknown }> {
      const e = store.get(key);
      return e ? { value: e.value, metadata: e.metadata ?? null } : { value: null, metadata: null };
    },
    async put(key: string, value: string, opts?: { metadata?: unknown }): Promise<void> {
      store.set(key, { value, metadata: opts?.metadata ?? null });
    },
    async delete(key: string): Promise<void> {
      store.delete(key);
    },
    async list(): Promise<{ keys: Array<{ name: string }>; list_complete: boolean; cursor: string }> {
      return { keys: [...store.keys()].map((name) => ({ name })), list_complete: true, cursor: "" };
    },
  } as unknown as KVNamespace;
}

const TEST_DIR = dirname(fileURLToPath(import.meta.url));

const LEADGEN_MIGRATIONS = [
  "0036_leadgen_core.sql",
  "0037_leadgen_analytics_mirror.sql",
  "0038_leadgen_revenue_infra.sql",
  "0039_leadgen_conversion_dedupe.sql",
  "0040_leadgen_runtime_context.sql",
  "0041_leadgen_frame_theme.sql",
  "0042_leadgen_pages.sql",
  "0043_leadgen_routing_rules.sql",
  "0044_leadgen_redirect_pct.sql",
  "0045_leadgen_persona_quota.sql",
  "0046_leadgen_rework_m1_variants.sql",
  "0047_leadgen_rework_m2_shared_pages.sql",
  "0048_leadgen_rework_m3_routing.sql",
  "0049_leadgen_rework_m4_m5_defaults_templates.sql",
  "0050_leadgen_rework_m6_grid_expansion.sql",
  "0051_leadgen_rework_m7_slider_collapse.sql",
  "0052_leadgen_rework_m9_address_fields.sql",
  "0053_leadgen_rework_m12_othergroup_retirement.sql",
] as const;

function createRuntimeDb(DatabaseSync: DatabaseSyncCtor): SqliteDb {
  const sdb = new DatabaseSync(":memory:");
  runSql(
    sdb,
    "CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT, domain TEXT, vertical_slug TEXT, status TEXT, content_version INTEGER DEFAULT 1, settings_version INTEGER DEFAULT 1);" +
      "CREATE TABLE domains (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT, hostname TEXT, status TEXT);" +
      "CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT);" +
      "INSERT INTO sites (id, name, domain, vertical_slug, status) VALUES ('site-1','Site One','one.example.com','insurance','active');" +
      "INSERT INTO domains (site_id, hostname, status) VALUES ('site-1','one.example.com','active');",
  );
  for (const file of LEADGEN_MIGRATIONS) {
    runSql(sdb, readFileSync(join(TEST_DIR, "../migrations", file), "utf8"));
  }
  return sdb;
}

function buildEnv(db: D1Database, kv: KVNamespace): Env {
  return {
    DB: db,
    CACHE: kv,
    MEDIA: {} as R2Bucket,
    APP_ENV: "test",
    ADMIN_HOST: "cms.kodigital.app",
    ADMIN_BASE_URL: "https://cms.kodigital.app",
    ADMIN_BASE_PATH: "/admin",
    CACHE_API_ENABLED: "false",
    HTML_CACHE_TTL_SECONDS: "300",
    OPENAI_TEXT_MODEL: "gpt-test",
    OPENAI_IMAGE_MODEL: "img-test",
    SITE_PROVISIONING_DRY_RUN: "true",
    SITE_PROVISIONING_ALLOW_ROUTE_MUTATION: "false",
    DEV_BYPASS_AUTH: "true",
    LEADGEN_CONFIG_SIGNING_KEY: "runtime-signing-key-test-only",
  } as unknown as Env;
}

const DatabaseSync = loadDatabaseSync();
const describeDb = DatabaseSync === null ? describe.skip : describe;

const API = "/api/admin/leadgen";

function jsonInit(method: string, body: unknown): RequestInit {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

interface Harness {
  sdb: SqliteDb;
  d1: D1Database;
  env: Env;
}

function newHarness(): Harness {
  const sdb = createRuntimeDb(DatabaseSync as DatabaseSyncCtor);
  const d1 = d1FromSqlite(sdb);
  return { sdb, d1, env: buildEnv(d1, makeKvStub()) };
}

// One TwoButtonYesNo section — the MINIMAL well-formed unit the dispatch's
// live drive used (activity/vertical/quote/default funnel/one Yes-No
// question), seeded directly (mirrors seedSection in the v25 sibling file).
function seedYesNoSection(sdb: SqliteDb, name: string): { id: number; public_id: string } {
  const publicId = mintPublicId("section");
  sdb
    .prepare(
      "INSERT INTO leadgen_sections (public_id, section_name, activity, vertical, headline_text, content_json, continue_mode, status) VALUES (?, ?, 'quote_funnel', 'life', 'Are you insured today?', ?, 'button', 'active')",
    )
    .run(
      publicId,
      name,
      JSON.stringify({
        components: [
          { type: "TwoButtonYesNo", question_id: "q_insured", internal_field: "insured", props: { yesLabel: "Yes", noLabel: "No" } },
        ],
      }),
    );
  const row = sdb.prepare("SELECT id FROM leadgen_sections WHERE public_id = ?").get(publicId) as { id: number };
  return { id: row.id, public_id: publicId };
}

interface SeededMinimalQuote {
  quotePublicId: string;
  variantPublicId: string;
  sectionId: number;
}

// Quote → its auto-set default funnel/variant → ONE Yes/No section attached
// via the REAL PUT /variants/:id (the exact save leg storeVariantPreflight
// rides) — deliberately WITHOUT a shared page, so the ONLY thing blocking
// activation is the rework §4.3-15 "shared first page needs a section" row.
async function seedMinimalQuote(h: Harness, name: string): Promise<SeededMinimalQuote> {
  const createRes = await admin.request(
    `${API}/quotes`,
    jsonInit("POST", { quote_name: name, activity: "quote_funnel", verticals: ["life"] }),
    h.env,
  );
  expect(createRes.status, `create quote: ${await createRes.clone().text()}`).toBe(201);
  const created = (await createRes.json()) as {
    public_id: string;
    default_funnel_id: number | null;
    funnels: Array<{ public_id: string; variants: Array<{ public_id: string }> }>;
  };
  expect(created.default_funnel_id, "default funnel auto-set on create").not.toBeNull();
  const variantPublicId = created.funnels[0]!.variants[0]!.public_id;
  const section = seedYesNoSection(h.sdb, `${name} Section`);
  const putRes = await admin.request(
    `${API}/variants/${variantPublicId}`,
    jsonInit("PUT", { sections: [{ section_id: section.id, position: 0 }] }),
    h.env,
  );
  expect(putRes.status, `attach section: ${await putRes.clone().text()}`).toBe(200);
  return { quotePublicId: created.public_id, variantPublicId, sectionId: section.id };
}

function sharedPageProblem(preflight: QuoteActivationPreflight): { path: string; severity: string } | undefined {
  return preflight.problems.find((p) => p.path === "activation.shared_page");
}

describeDb("P0 S0-B1: variant-save advisory preflight stays in parity with the real activation gate", () => {
  it("FIRES (b): a minimal well-formed quote's variant-save response reports the SAME activation.shared_page error the real GET /activation gate reports", async () => {
    const h = newHarness();
    const seeded = await seedMinimalQuote(h, "S0B1 Parity Quote A");

    // The advisory copy a variant SAVE returns (this is exactly what
    // quotes-tabs/funnel.ts's Save-chain renderPreflight(res3.body.activation_preflight)
    // re-renders into #lg-preflight-panel).
    const resaveRes = await admin.request(
      `${API}/variants/${seeded.variantPublicId}`,
      jsonInit("PUT", { sections: [{ section_id: seeded.sectionId, position: 0 }] }),
      h.env,
    );
    expect(resaveRes.status, await resaveRes.clone().text()).toBe(200);
    const resaveBody = (await resaveRes.json()) as { activation_preflight: QuoteActivationPreflight };
    const advisoryProblem = sharedPageProblem(resaveBody.activation_preflight);

    // The REAL gate's source (GET /quotes/:id/activation → computeQuoteActivationPreflight),
    // read at the same instant, on the same quote.
    const quoteRow = h.sdb
      .prepare("SELECT * FROM leadgen_quotes WHERE public_id = ?")
      .get(seeded.quotePublicId) as unknown as LeadgenQuoteRow;
    const realPreflight = await computeQuoteActivationPreflight(h.d1, quoteRow);
    const realProblem = sharedPageProblem(realPreflight);

    expect(realProblem, "real gate must report the missing shared page").toBeDefined();
    expect(realProblem!.severity).toBe("error");
    // The regression: BEFORE the fix, advisoryProblem was undefined here
    // (storeVariantPreflight never called computeReworkActivationProblems)
    // while realProblem was always defined — a silent disagreement that let
    // the panel show "Ready to activate" right after a save.
    expect(advisoryProblem, "variant-save advisory preflight must report the SAME missing-shared-page error as the real gate").toBeDefined();
    expect(advisoryProblem!.severity).toBe("error");
  });

  it("CLEARS (b): once the shared page is authored, BOTH the variant-save advisory and the real gate agree the check is satisfied", async () => {
    const h = newHarness();
    const seeded = await seedMinimalQuote(h, "S0B1 Parity Quote B");

    // Author the quote's shared first page with one section (§4.3-1/§4.3-15),
    // through the REAL POST /quotes/:id/shared-page route.
    const sharedSection = seedYesNoSection(h.sdb, "S0B1 Parity Quote B Shared Section");
    const sharedPageRes = await admin.request(
      `${API}/quotes/${seeded.quotePublicId}/shared-page`,
      jsonInit("POST", { sections: [{ section_id: sharedSection.id, position: 0 }] }),
      h.env,
    );
    expect(sharedPageRes.status, await sharedPageRes.clone().text()).toBe(201);

    const resaveRes = await admin.request(
      `${API}/variants/${seeded.variantPublicId}`,
      jsonInit("PUT", { sections: [{ section_id: seeded.sectionId, position: 0 }] }),
      h.env,
    );
    expect(resaveRes.status, await resaveRes.clone().text()).toBe(200);
    const resaveBody = (await resaveRes.json()) as { activation_preflight: QuoteActivationPreflight };

    const quoteRow = h.sdb
      .prepare("SELECT * FROM leadgen_quotes WHERE public_id = ?")
      .get(seeded.quotePublicId) as unknown as LeadgenQuoteRow;
    const realPreflight = await computeQuoteActivationPreflight(h.d1, quoteRow);

    expect(sharedPageProblem(realPreflight), "real gate: satisfied requirement must not report a problem").toBeUndefined();
    expect(sharedPageProblem(resaveBody.activation_preflight), "advisory: satisfied requirement must not report a problem either").toBeUndefined();

    // Both sources agree the quote is fully clear (no blocks, no problems at
    // all — this quote has no offers, so computeVariantPreflightBlocks is
    // empty too) — the false-"Ready" panel state this fix targets is now a
    // TRUE "Ready" state.
    expect(resaveBody.activation_preflight.ok).toBe(true);
    expect(resaveBody.activation_preflight.problems).toEqual([]);
    expect(realPreflight.ok).toBe(true);
    expect(realPreflight.problems).toEqual([]);
  });
});
