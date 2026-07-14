// Section Builder v3.1 REMEDIATION — phase R6 (live matrix verify + close).
//
// The cross-product SEAM tests (plan ⟨ROAST F9⟩): each proves an end-to-end
// wiring across two+ subsystems through the REAL HTTP boundary, on the same
// in-process worker harness the R1/R4b suites use (app.request over the
// tenant-routed public app + admin.request for seeding, a node:sqlite D1 shim +
// prefix-aware KV stub). NO REAL network — the only external system (Google) is
// never reached (no Maps fetch on these paths).
//
//   * SEAM 2 — activation preflight surfaces maps_no_job in the 409 body WITH a
//     fix_url deep link pointing at the section's Maps surface (the server leg;
//     the quotes-UI render of that panel is the chromium companion
//     test-ui/leadgen-r6-activation-preflight.spec.ts).
//   * SEAM 3 — publish → live serve: an activated funnel is GET /lg/:slug'd, the
//     section is edited through the REAL PATCH, and the re-GET must reflect the
//     edit (cache invalidation). A control proves the shell cache CAN be busted
//     when the documented trigger fires — isolating exactly which edit path
//     does/doesn't invalidate.
//   * SEAM 4 — one section rendered under 3 DISTINCT fixture themes (Navy, Bold
//     Yellow, Minimal) via POST /sections/preview with theme_id: each theme's
//     own brand_primary hex appears in that theme's composed CSS and the two
//     others do NOT (distinct per-theme token application), render non-empty.
//   * SEAM 5 — a LEGACY section carrying frame-scope nodes (FooterBar +
//     StepIndicator) served through a funnel WITH a frame that also synthesizes
//     footer + progress must render EXACTLY ONE footer and ONE progress bar (no
//     double chrome) — the register F7 concern that R3's studio strip left the
//     runtime render fidelity unchanged.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import app from "../src/index";
import admin from "../src/admin/router";
import type { Env } from "../src/env";
import { mintPublicId } from "../src/leadgen/ids";

// ---------------------------------------------------------------------------
// node:sqlite + D1 shim + prefix-aware KV stub (R1/R4b convention, verbatim).
// ---------------------------------------------------------------------------
type SqliteStatement = { run(...p: unknown[]): unknown; get(...p: unknown[]): unknown; all(...p: unknown[]): unknown[] };
type SqliteDb = { prepare(sql: string): SqliteStatement; close(): void; [m: string]: unknown };
type DatabaseSyncCtor = new (path: string) => SqliteDb;

function loadDatabaseSync(): DatabaseSyncCtor | null {
  try {
    const nodeRequire = createRequire(import.meta.url);
    return (nodeRequire("node:sqlite") as { DatabaseSync: DatabaseSyncCtor }).DatabaseSync;
  } catch {
    try {
      const getBuiltin = (process as unknown as { getBuiltinModule?: (n: string) => unknown }).getBuiltinModule;
      if (typeof getBuiltin === "function") return (getBuiltin("node:sqlite") as { DatabaseSync: DatabaseSyncCtor }).DatabaseSync;
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
          return (sdb.prepare(sql).get(...binds) ?? null) as T | null;
        },
        async all<T = unknown>() {
          return { results: sdb.prepare(sql).all(...binds) as T[], success: true, meta: {} };
        },
        async run() {
          const r = sdb.prepare(sql).run(...binds) as { changes?: number; lastInsertRowid?: number | bigint };
          return { success: true, meta: { changes: Number(r?.changes ?? 0), last_row_id: Number(r?.lastInsertRowid ?? 0) } };
        },
      };
      return stmt;
    },
    async batch(statements: Array<{ run(): Promise<unknown> }>) {
      runSql(sdb, "BEGIN");
      const results: unknown[] = [];
      try {
        for (const s of statements) results.push(await s.run());
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
function makeKvStub(): { kv: KVNamespace; store: Map<string, string> } {
  const store = new Map<string, string>();
  const kv = {
    async get(key: string): Promise<string | null> {
      return store.has(key) ? store.get(key)! : null;
    },
    async getWithMetadata(key: string): Promise<{ value: string | null; metadata: unknown }> {
      return { value: store.get(key) ?? null, metadata: null };
    },
    async put(key: string, value: string): Promise<void> {
      store.set(key, value);
    },
    async delete(key: string): Promise<void> {
      store.delete(key);
    },
    async list(opts?: { prefix?: string; cursor?: string }): Promise<{ keys: Array<{ name: string }>; list_complete: boolean; cursor: string }> {
      // Real KV prefix semantics — invalidate.ts deleteByPrefix relies on it.
      const prefix = opts?.prefix ?? "";
      return {
        keys: [...store.keys()].filter((name) => name.startsWith(prefix)).map((name) => ({ name })),
        list_complete: true,
        cursor: "",
      };
    },
  } as unknown as KVNamespace;
  return { kv, store };
}

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const LEADGEN_MIGRATIONS = [
  "0036_leadgen_core.sql",
  "0037_leadgen_analytics_mirror.sql",
  "0038_leadgen_revenue_infra.sql",
  "0039_leadgen_conversion_dedupe.sql",
  "0040_leadgen_runtime_context.sql",
  "0041_leadgen_frame_theme.sql", // adds leadgen_funnels.frame_config_json + theme_json
] as const;

const TENANT_HOST = "one.example.com";
const TENANT_ORIGIN = `http://${TENANT_HOST}`;

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
  for (const file of LEADGEN_MIGRATIONS) runSql(sdb, readFileSync(join(TEST_DIR, "../migrations", file), "utf8"));
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
    // CACHE_API_ENABLED=false ⇒ caches.default is skipped, but putCachedHtml
    // ALWAYS write-throughs to env.CACHE (KV) and getCachedHtml falls back to a
    // KV read — so the shell cache IS live in this harness (the exact layer the
    // §28 content_version key + invalidateOnVariantPublish govern). SEAM 3
    // exercises that live KV shell cache.
    CACHE_API_ENABLED: "false",
    HTML_CACHE_TTL_SECONDS: "300",
    OPENAI_TEXT_MODEL: "gpt-test",
    OPENAI_IMAGE_MODEL: "img-test",
    SITE_PROVISIONING_DRY_RUN: "true",
    SITE_PROVISIONING_ALLOW_ROUTE_MUTATION: "false",
    DEV_BYPASS_AUTH: "true",
    LEADGEN_CONFIG_SIGNING_KEY: "r6-seams-signing-key-test-only",
    GOOGLE_MAPS_BROWSER_KEY: "r6-fake-browser-key-test-only",
  } as unknown as Env;
}

const DatabaseSync = loadDatabaseSync();
const describeDb = DatabaseSync === null ? describe.skip : describe;
const API = "/api/admin/leadgen";

interface Harness {
  sdb: SqliteDb;
  env: Env;
  store: Map<string, string>;
}
function newHarness(): Harness {
  const sdb = createRuntimeDb(DatabaseSync as DatabaseSyncCtor);
  const { kv, store } = makeKvStub();
  return { sdb, env: buildEnv(d1FromSqlite(sdb), kv), store };
}

interface CapturedCtx {
  ctx: ExecutionContext;
  promises: Promise<unknown>[];
}
function captureCtx(): CapturedCtx {
  const promises: Promise<unknown>[] = [];
  const ctx = {
    waitUntil(p: Promise<unknown>): void {
      promises.push(Promise.resolve(p).catch(() => undefined));
    },
    passThroughOnException(): void {},
  } as unknown as ExecutionContext;
  return { ctx, promises };
}
function jsonInit(method: string, body: unknown): RequestInit {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}
// Wrap a KV stub so every delete() is ALSO recorded — get/put/list keep
// delegating to the SAME underlying store (the leadgen-v31-themes.test.ts
// instrumentDeletes pattern, mirrored here for the SEAM-3 bounded-set proof).
function instrumentDeletes(kv: KVNamespace): { kv: KVNamespace; deletes: string[] } {
  const deletes: string[] = [];
  const original = kv as unknown as { delete: (key: string) => Promise<void> };
  const wrapped = {
    ...kv,
    async delete(key: string): Promise<void> {
      deletes.push(key);
      await original.delete(key);
    },
  } as unknown as KVNamespace;
  return { kv: wrapped, deletes };
}
async function reqTenant(env: Env, path: string, init?: RequestInit, ctx?: ExecutionContext): Promise<Response> {
  return app.request(`${TENANT_ORIGIN}${path}`, init ?? {}, env, ctx);
}

beforeEach(() => {
  // NO REAL NETWORK on any seam path — any outbound fetch is a bug, fail loudly.
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown) => {
      throw new Error(`NO REAL NETWORK in R6 seam tests — unexpected outbound fetch to ${String(url)}`);
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Seeders (R1/R4b + preflight conventions).
// ---------------------------------------------------------------------------

// Raw-INSERT a Section with caller-supplied components (bypasses content
// validation → the legacy-shaped-content axis).
function seedSectionRaw(
  sdb: SqliteDb,
  components: unknown[],
  opts: { headline?: string } = {},
): { id: number; public_id: string } {
  const publicId = mintPublicId("section");
  const content = JSON.stringify({ components });
  sdb
    .prepare(
      "INSERT INTO leadgen_sections (public_id, section_name, activity, vertical, headline_text, content_json, continue_mode, address_validation_enabled, status) VALUES (?, ?, 'quote_funnel', 'life', ?, ?, 'button', 0, 'active')",
    )
    .run(publicId, `Section ${publicId.slice(-4)}`, opts.headline ?? "Headline", content);
  const row = sdb.prepare("SELECT id FROM leadgen_sections WHERE public_id = ?").get(publicId) as { id: number };
  return { id: row.id, public_id: publicId };
}

interface CreatedQuote {
  quotePublicId: string;
  funnelPublicId: string;
  funnelId: number;
  variantPublicId: string;
}

// Create a Quote → funnel → control variant and attach the given sections
// (admin API, exactly the preflight suite's seedQuote). No activation here.
async function createQuoteWithSections(h: Harness, name: string, sectionIds: number[]): Promise<CreatedQuote> {
  const createRes = await admin.request(
    `${API}/quotes`,
    jsonInit("POST", { quote_name: name, activity: "quote_funnel", verticals: ["life"] }),
    h.env,
  );
  expect(createRes.status, `create quote: ${await createRes.clone().text()}`).toBe(201);
  const created = (await createRes.json()) as {
    public_id: string;
    funnels: Array<{ public_id: string; variants: Array<{ public_id: string }> }>;
  };
  const funnelPublicId = created.funnels[0]!.public_id;
  const variantPublicId = created.funnels[0]!.variants[0]!.public_id;
  const putRes = await admin.request(
    `${API}/variants/${variantPublicId}`,
    jsonInit("PUT", { sections: sectionIds.map((section_id) => ({ section_id })) }),
    h.env,
  );
  expect(putRes.status, `put sections: ${await putRes.clone().text()}`).toBe(200);
  const funnelRow = h.sdb.prepare("SELECT id FROM leadgen_funnels WHERE public_id = ?").get(funnelPublicId) as { id: number };
  return { quotePublicId: created.public_id, funnelPublicId, funnelId: funnelRow.id, variantPublicId };
}

// Create an active dynamic auction on the quote's funnel + activate the quote
// on site-1 under `slug`. Returns the activation Response (caller asserts).
async function attachAuctionAndActivate(h: Harness, q: CreatedQuote, slug: string): Promise<Response> {
  const quoteRow = h.sdb.prepare("SELECT id FROM leadgen_quotes WHERE public_id = ?").get(q.quotePublicId) as { id: number };
  const auctionRes = await admin.request(
    `${API}/auctions`,
    jsonInit("POST", {
      auction_name: `R6 Auction ${slug}`,
      quote_id: quoteRow.id,
      auction_type: "dynamic",
      winner_logic: "highest_bid",
      floor_type: "percentage_of_max",
      floor_value: 10,
      multi_offer: "enabled",
      banner_slots_count: 5,
      max_carriers_per_offer: 3,
      max_total_carriers: 10,
      timeout_ms: 2500,
      status: "active",
    }),
    h.env,
  );
  expect(auctionRes.status, `create auction: ${await auctionRes.clone().text()}`).toBe(201);
  const auction = (await auctionRes.json()) as { id: number };
  await admin.request(`${API}/variants/${q.variantPublicId}`, jsonInit("PUT", { auction_id: auction.id }), h.env);
  return admin.request(`${API}/quotes/${q.quotePublicId}/activation/site-1`, jsonInit("PUT", { enabled: true, slug }), h.env);
}

const HEADLINE = { type: "QuestionHeadline", question_id: "q_head", props: { text: "Original headline" } };
const ZIP = { type: "ZIPInputQuestion", question_id: "q_zip", internal_field: "zip", answer_type: "string", props: { placeholder: "ZIP code" } };
const CONT = { type: "ContinueButton", question_id: "q_cont", props: { label: "Continue" } };

// ===========================================================================
// SEAM 2 — activation preflight surfaces maps_no_job + fix_url in the 409 body
// ===========================================================================

describeDb("R6 SEAM 2 — activation preflight: maps_no_job block with a fix_url deep link", () => {
  const MAPS_NO_JOB_SECTION = [
    HEADLINE,
    {
      type: "ZIPInputQuestion",
      question_id: "q_zip",
      question_key: "k_zip",
      internal_field: "zip",
      props: { maps: { enabled: true, jobs: { validate: false, auction: false, autocomplete: false } } },
    },
    CONT,
  ];

  it("a maps-enabled + 0-jobs field blocks activation with 409 carrying the maps_no_job problem AND a fix_url to the section's Maps surface", async () => {
    const h = newHarness();
    const section = seedSectionRaw(h.sdb, MAPS_NO_JOB_SECTION);
    const q = await createQuoteWithSections(h, "Seam2 Maps No-Job Quote", [section.id]);

    const put = await admin.request(
      `${API}/quotes/${q.quotePublicId}/activation/site-1`,
      jsonInit("PUT", { enabled: true, slug: "seam2-maps-no-job" }),
      h.env,
    );
    expect(put.status, await put.clone().text()).toBe(409);
    const body = (await put.json()) as { error: string; problems: Array<Record<string, unknown>> };
    expect(body.error).toBe("quote_activation_blocked");

    const mapsProblem = body.problems.find(
      (p) => p["path"] === `section.${section.public_id}.components[q_zip].props.maps`,
    );
    expect(mapsProblem, `maps_no_job problem present; got: ${JSON.stringify(body.problems, null, 2)}`).toBeDefined();
    expect(mapsProblem!["severity"]).toBe("error");
    expect(mapsProblem!["scope"]).toBe("component");
    expect(String(mapsProblem!["message"])).toContain("no job selected");
    // The seam: the block carries a deep link the quotes UI can render → the
    // section's Maps surface (SECTION_MAPPING_LINK — the #mapping anchor).
    expect(mapsProblem!["fix_url"]).toBe(`/admin/leadgen/sections/${section.public_id}/edit#mapping`);

    // Nothing activated.
    const row = h.sdb.prepare("SELECT id FROM leadgen_site_quotes WHERE site_id = 'site-1'").get();
    expect(row ?? null).toBeNull();
  });

  it("selecting a job clears the block → activation 200 (the fix the fix_url leads to actually resolves it)", async () => {
    const h = newHarness();
    const section = seedSectionRaw(h.sdb, [
      HEADLINE,
      {
        type: "ZIPInputQuestion",
        question_id: "q_zip",
        question_key: "k_zip2",
        internal_field: "zip",
        props: { maps: { enabled: true, jobs: { validate: true, auction: false, autocomplete: false } } },
      },
      CONT,
    ]);
    const q = await createQuoteWithSections(h, "Seam2 Maps Fixed Quote", [section.id]);
    const put = await admin.request(
      `${API}/quotes/${q.quotePublicId}/activation/site-1`,
      jsonInit("PUT", { enabled: true, slug: "seam2-maps-fixed" }),
      h.env,
    );
    expect(put.status, await put.clone().text()).toBe(200);
  });
});

// ===========================================================================
// SEAM 3 — publish → live serve (D3/E5 cache-invalidation class)
// ===========================================================================

describeDb("R6 SEAM 3 — publish a section edit → live /lg/:slug serve reflects it (cache invalidation)", () => {
  const ORIG = "Original headline R6";
  const EDITED = "Edited live headline R6";
  // The section ROW's headline_text COLUMN is a SEPARATE field (baked into
  // #lg-config's "headline" key by config-dto.ts, independent of the
  // content_json node's rendered text) that this test's PATCH never touches —
  // deliberately orthogonal to ORIG/EDITED so it can never collide with either
  // marker and produce a false pass/fail on the containment assertions below.
  const COLUMN_HEADLINE_UNEDITED = "R6 Seam3 section-row headline (column, never patched, never asserted)";
  // A headline node whose rendered text IS props.text (so a content_json edit is
  // unambiguously the render source — no bound-column indirection).
  const headlineNode = (text: string) => ({ type: "QuestionHeadline", question_id: "q_head", props: { text } });
  const sectionContent = (text: string) => JSON.stringify({ components: [headlineNode(text), ZIP, CONT] });

  async function serveHtml(env: Env, slug: string): Promise<string> {
    const res = await reqTenant(env, `/lg/${slug}`, {}, captureCtx().ctx);
    expect(res.status, `serve /lg/${slug}: ${await res.clone().text()}`).toBe(200);
    return res.text();
  }
  async function seedActivated(h: Harness, slug: string, quoteName: string): Promise<{ public_id: string }> {
    const section = seedSectionRaw(h.sdb, [headlineNode(ORIG), ZIP, CONT], { headline: COLUMN_HEADLINE_UNEDITED });
    const q = await createQuoteWithSections(h, quoteName, [section.id]);
    const act = await attachAuctionAndActivate(h, q, slug);
    expect(act.status, `activate: ${await act.clone().text()}`).toBe(200);
    return { public_id: section.public_id };
  }

  it("editing the section headline via the real PATCH is reflected on the next GET /lg/:slug", async () => {
    const h = newHarness();
    const section = await seedActivated(h, "seam3-publish", "Seam3 Publish Quote");

    // Cold serve: bakes + caches the pristine shell with the ORIGINAL headline.
    const before = await serveHtml(h.env, "seam3-publish");
    expect(before, "cold serve carries the original headline").toContain(ORIG);

    // Edit the section headline text through the REAL admin PATCH (content_json —
    // the change bumps the SECTION's content_version).
    const patch = await admin.request(
      `${API}/sections/${section.public_id}`,
      jsonInit("PATCH", { content_json: sectionContent(EDITED) }),
      h.env,
    );
    expect(patch.status, `patch section: ${await patch.clone().text()}`).toBe(200);

    // The live serve MUST reflect the published edit (invalidation works). If it
    // still serves the stale cached shell, that is the D3/E5 staleness class —
    // the assertion fails LOUDLY with the served headline as evidence.
    const after = await serveHtml(h.env, "seam3-publish");
    expect(
      after,
      `live /lg/seam3-publish must reflect the PATCH'd headline "${EDITED}" (not the stale "${ORIG}"). served-contains-new=${after.includes(
        EDITED,
      )} served-contains-old=${after.includes(ORIG)}`,
    ).toContain(EDITED);
    expect(after, "the stale headline is gone").not.toContain(ORIG);
  });

  // Control — proves the shell cache CAN reflect the SAME edit once a cache-key
  // axis actually moves (re-activation bumps the activation_version segment of
  // leadgenShellKey). Isolates the primary finding to "the section PATCH itself
  // moves no key axis / fires no invalidation", not "the serve path can never
  // reflect a section edit".
  it("CONTROL: the same edit DOES reflect once a shell-cache key axis moves (re-activation)", async () => {
    const h = newHarness();
    const section = await seedActivated(h, "seam3-control", "Seam3 Control Quote");
    expect(await serveHtml(h.env, "seam3-control"), "cold serve carries the original headline").toContain(ORIG);

    const patch = await admin.request(
      `${API}/sections/${section.public_id}`,
      jsonInit("PATCH", { content_json: sectionContent(EDITED) }),
      h.env,
    );
    expect(patch.status, `patch section: ${await patch.clone().text()}`).toBe(200);

    // Re-activate on the SAME slug — bumps site_quote.updated_at → a fresh
    // leadgenShellKey (activation_version axis) → cold re-render of the edited
    // content_json.
    const react = await admin.request(
      `${API}/quotes/${(h.sdb.prepare("SELECT public_id FROM leadgen_quotes ORDER BY id DESC LIMIT 1").get() as { public_id: string }).public_id}/activation/site-1`,
      jsonInit("PUT", { enabled: true, slug: "seam3-control" }),
      h.env,
    );
    expect(react.status, `re-activate: ${await react.clone().text()}`).toBe(200);

    const after = await serveHtml(h.env, "seam3-control");
    expect(after, "with the key axis moved, the serve reflects the edit").toContain(EDITED);
  });

  // Bounded-set proof (conductor ruling on the fix): the invalidation sweep is
  // scoped to ACTIVE funnels that actually order the edited section — never a
  // blind/global pass. A section referenced by NO funnel at all must invalidate
  // NOTHING, and an unrelated active funnel's warmed cache must survive intact.
  it("bounded set: editing a section referenced by NO active funnel invalidates NOTHING (an unrelated active funnel's cache survives untouched)", async () => {
    const h = newHarness();
    // An unrelated, ACTIVE decoy funnel — warmed via a REAL serve so its
    // shell+config cache keys are genuine (not hand-built strings).
    await seedActivated(h, "seam3-bounded-decoy", "Seam3 Bounded Decoy Quote");
    const decoyBefore = await serveHtml(h.env, "seam3-bounded-decoy");
    expect(decoyBefore, "decoy cold-serves the original headline").toContain(ORIG);

    // The ORPHAN section: created but never attached to ANY funnel variant
    // (no createQuoteWithSections call for it) — the bounded-empty-set case.
    const orphan = seedSectionRaw(h.sdb, [headlineNode(ORIG), ZIP, CONT], { headline: COLUMN_HEADLINE_UNEDITED });

    const { kv: instrumented, deletes } = instrumentDeletes(h.env.CACHE);
    h.env.CACHE = instrumented;
    const captured = captureCtx();

    const patch = await admin.request(
      `${API}/sections/${orphan.public_id}`,
      jsonInit("PATCH", { content_json: sectionContent(EDITED) }),
      h.env,
      captured.ctx,
    );
    expect(patch.status, `patch orphan section: ${await patch.clone().text()}`).toBe(200);
    await Promise.all(captured.promises);

    expect(deletes, `an unreferenced section's edit deletes NO cache keys (bounded, empty set); got ${JSON.stringify(deletes)}`).toEqual([]);

    // Belt-and-suspenders: the unrelated decoy funnel's cache is untouched —
    // still serves its ORIGINAL headline (no incidental/global invalidation).
    const decoyAfter = await serveHtml(h.env, "seam3-bounded-decoy");
    expect(decoyAfter, "the decoy funnel's cache is completely untouched").toContain(ORIG);
  });
});

// ===========================================================================
// SEAM 4 — one section under 3 DISTINCT fixture themes (Navy · Bold Yellow ·
// Minimal): per-theme token application, distinct resolved primary colours.
// ===========================================================================

describeDb("R6 SEAM 4 — a section renders under all 3 fixture themes with DISTINCT token application", () => {
  interface ThemeFixture {
    name: string;
    brand_primary: string;
  }
  // Three DISTINCT records. Navy = the leadgen-v31-themes.test.ts fixture hex;
  // Bold Yellow + Minimal are the register's R5-routed third/second themes with
  // deliberately distinct brand_primary values (so a per-theme assertion cannot
  // pass by coincidence).
  const THEMES: ThemeFixture[] = [
    { name: "Navy", brand_primary: "#0B5FFF" },
    { name: "Bold Yellow", brand_primary: "#F5C518" },
    { name: "Minimal", brand_primary: "#111827" },
  ];

  async function createTheme(env: Env, t: ThemeFixture): Promise<string> {
    const res = await admin.request(
      `${API}/themes`,
      jsonInit("POST", {
        name: `Seam4 ${t.name}`,
        roles: {
          brand_primary: t.brand_primary,
          accent: "#123456",
          page_bg: "#F0F0F0",
          card: "#FFFFFF",
          text: "#101010",
          success: "#0E7C3A",
          error: "#B23A2C",
        },
        typography: { headline_font: "Newsreader", body_font: "Inter", base_px: 16 },
        controls: { field_height: "medium", button_size: "m", corners: "rounded" },
      }),
      env,
    );
    expect(res.status, `create theme ${t.name}: ${await res.clone().text()}`).toBe(201);
    const body = (await res.json()) as { item: { id: string } };
    return body.item.id;
  }

  it("each theme's brand_primary lands in ITS composed CSS and NOT the other two; every theme renders non-empty", async () => {
    const h = newHarness();
    // One section + a minimal composed frame (§13.4 needs a stored frame).
    const section = seedSectionRaw(h.sdb, [HEADLINE, ZIP, CONT], { headline: "Themed section" });
    const q = await createQuoteWithSections(h, "Seam4 Themes Quote", [section.id]);
    h.sdb
      .prepare("UPDATE leadgen_funnels SET frame_config_json = ? WHERE public_id = ?")
      .run(JSON.stringify({ version: 1, template: "centered" }), q.funnelPublicId);
    const sectionRow = h.sdb
      .prepare("SELECT content_json, headline_text FROM leadgen_sections WHERE id = ?")
      .get(section.id) as { content_json: string; headline_text: string };

    const themeIds: Record<string, string> = {};
    for (const t of THEMES) themeIds[t.name] = await createTheme(h.env, t);

    const cssByTheme: Record<string, string> = {};
    for (const t of THEMES) {
      const res = await admin.request(
        `${API}/sections/preview`,
        jsonInit("POST", {
          content_json: sectionRow.content_json,
          headline: sectionRow.headline_text,
          section_public_id: section.public_id,
          frame_context: { funnel_public_id: q.funnelPublicId, variant_public_id: q.variantPublicId },
          theme_id: themeIds[t.name],
        }),
        h.env,
      );
      expect(res.status, `preview ${t.name}: ${await res.clone().text()}`).toBe(200);
      const body = (await res.json()) as { preview: { css: string; desktop: string } };
      // Non-empty render under this theme.
      expect(body.preview.desktop.length, `${t.name} renders non-empty`).toBeGreaterThan(200);
      cssByTheme[t.name] = body.preview.css;
    }

    // Per-theme token application: each theme's own hex present; the other two absent.
    for (const t of THEMES) {
      const css = cssByTheme[t.name]!;
      expect(css, `${t.name} CSS carries its own brand_primary ${t.brand_primary}`).toContain(t.brand_primary);
      for (const other of THEMES) {
        if (other.name === t.name) continue;
        expect(
          css,
          `${t.name} CSS must NOT carry ${other.name}'s brand_primary ${other.brand_primary} (distinct token application)`,
        ).not.toContain(other.brand_primary);
      }
    }
  });
});

// ===========================================================================
// SEAM 5 — legacy frame-type nodes render SINGLE chrome (register F7)
// ===========================================================================

describeDb("R6 SEAM 5 — a legacy section's FooterBar + StepIndicator do not double the frame chrome", () => {
  // A full, valid answer section PLUS two legacy frame-scope nodes (the shape
  // pre-R3 content still carries). Raw-INSERT = the legacy axis.
  const LEGACY_CHROME_SECTION = [
    HEADLINE,
    { type: "StepIndicator", question_id: "q_legacy_steps", props: { steps: 3, current: 1 } },
    ZIP,
    {
      type: "FooterBar",
      question_id: "q_legacy_footer",
      props: { legalHtml: "Legacy section footer legal text", trustMessages: ["Legacy footer trust"] },
    },
    CONT,
  ];
  // A frame that SYNTHESIZES both a footer and a dots progress (full-background
  // template = brand bg → logo → step dots → card slot → legal footer). compat
  // allow_section_chrome lets a chrome-carrying section clear activation.
  const SYNTH_FRAME = JSON.stringify({
    version: 1,
    template: "full-background",
    footer: { enabled: true, show_on: "all", trust_text: "Frame footer trust" },
    progress: { style: "dots" },
    compat: { allow_section_chrome: true },
  });

  function countOccurrences(haystack: string, needle: string): number {
    let n = 0;
    let i = haystack.indexOf(needle);
    while (i !== -1) {
      n += 1;
      i = haystack.indexOf(needle, i + needle.length);
    }
    return n;
  }

  it("serves EXACTLY ONE footer and ONE progress bar (no double chrome)", async () => {
    const h = newHarness();
    const section = seedSectionRaw(h.sdb, LEGACY_CHROME_SECTION, { headline: "Legacy chrome section" });
    const q = await createQuoteWithSections(h, "Seam5 Legacy Chrome Quote", [section.id]);
    // Frame must be present BEFORE activation (a chrome section needs the compat
    // flag to clear preflight).
    h.sdb.prepare("UPDATE leadgen_funnels SET frame_config_json = ? WHERE public_id = ?").run(SYNTH_FRAME, q.funnelPublicId);
    const act = await attachAuctionAndActivate(h, q, "seam5-legacy-chrome");
    expect(act.status, `activate: ${await act.clone().text()}`).toBe(200);

    const res = await reqTenant(h.env, `/lg/seam5-legacy-chrome`, {}, captureCtx().ctx);
    expect(res.status, `serve: ${await res.clone().text()}`).toBe(200);
    const html = await res.text();

    // The FRAME chrome must be present (baseline — otherwise the test is vacuous).
    expect(html, "the frame synthesizes a footer region").toContain('data-frame-region="footer"');
    expect(html, "the frame synthesizes a progress region").toContain('data-frame-region="progress"');

    // Both the frame chrome and any section-embedded FooterBar/StepIndicator emit
    // the SAME leaf markup (renderFooterBar → <footer class="lg-footerbar">;
    // dots progress + StepIndicator → <div class="lg-steps" role="progressbar">).
    // Count the leaves: exactly ONE of each = single chrome.
    const counts = {
      footers: countOccurrences(html, 'class="lg-footerbar"'),
      progressBars: countOccurrences(html, 'role="progressbar"'),
    };
    // Single chrome ⇒ exactly one of each leaf. Two ⇒ the frame's synthesized
    // chrome AND the legacy section-embedded FooterBar/StepIndicator both
    // rendered (register F7 double-render).
    expect(
      counts,
      `single chrome expected (frame owns footer+progress; the legacy section's FooterBar/StepIndicator must not add a second). Found footers=${counts.footers} progressBars=${counts.progressBars}`,
    ).toEqual({ footers: 1, progressBars: 1 });
  });

  // Frameless companion (conductor ruling): a FRAMELESS legacy funnel has no
  // frame chrome at all (frame_config_json stays NULL — renderLegacyShell,
  // register §13.1's byte-pinned fallback), so the section's OWN frame-scope
  // nodes are the ONLY chrome on the page and must NOT be stripped — the
  // serve-time filter in renderVariantSectionsHtml is gated on `frame !== null`
  // for exactly this reason. Activation preflight's chrome-in-section row is
  // ALSO conditional on a configured frame (quotes-handlers.ts §14.4: "with a
  // NULL frame, chrome-in-section stays the save-time warning it is today"),
  // so this funnel activates cleanly with no compat flag needed.
  it("a FRAMELESS legacy funnel still renders its section's own FooterBar/StepIndicator (never orphaned)", async () => {
    const h = newHarness();
    const section = seedSectionRaw(h.sdb, LEGACY_CHROME_SECTION, { headline: "Frameless legacy chrome section" });
    const q = await createQuoteWithSections(h, "Seam5 Frameless Legacy Quote", [section.id]);
    // Deliberately NO frame_config_json UPDATE — frame stays NULL (the legacy
    // standalone path).
    const act = await attachAuctionAndActivate(h, q, "seam5-frameless-legacy");
    expect(act.status, `activate (frameless, no compat flag needed): ${await act.clone().text()}`).toBe(200);

    const res = await reqTenant(h.env, `/lg/seam5-frameless-legacy`, {}, captureCtx().ctx);
    expect(res.status, `serve: ${await res.clone().text()}`).toBe(200);
    const html = await res.text();

    // No frame at all ⇒ no frame-synthesized regions (the legacy byte-pinned
    // shell path, not renderQuoteFrame).
    expect(html, "no frame footer region (frameless path)").not.toContain('data-frame-region="footer"');
    expect(html, "no frame progress region (frameless path)").not.toContain('data-frame-region="progress"');

    // The section's OWN FooterBar + StepIndicator are the ONLY chrome — they
    // MUST still render (never orphaned by the frame-scope filter, which is
    // gated on `frame !== null`).
    const counts = {
      footers: countOccurrences(html, 'class="lg-footerbar"'),
      progressBars: countOccurrences(html, 'role="progressbar"'),
    };
    expect(
      counts,
      `frameless legacy content must keep rendering its own chrome (not orphaned); found footers=${counts.footers} progressBars=${counts.progressBars}`,
    ).toEqual({ footers: 1, progressBars: 1 });
  });

  // FULL-MISSION AUDIT FINDING 1 (MAJOR) — regression: COMPONENT_CATALOG[n.type]
  // is undefined for ANY non-catalog type string (legacy/imported/version-skew
  // content reaches storage exactly the way this file's raw-seed pattern does —
  // parseSectionComponents does zero type validation and activation preflight
  // never runs the full content validator). With a frame present, `.scope` on
  // undefined THROWS inside the STOP-2 filter → renderFunnelShell has no
  // try/catch → serve 500 on EVERY request for that funnel (nothing ever
  // caches) — a full outage. Pre-R6 (and pre-STOP-2), the SAME node hit
  // renderComponent's default case and rendered "" gracefully; the unguarded
  // filter regressed a graceful drop into an outage class. Fixed with optional
  // chaining (COMPONENT_CATALOG[n.type]?.scope !== "frame") so an unknown type
  // is KEPT in the render array and falls through to the existing default case.
  const UNKNOWN_TYPE_SECTION = [
    HEADLINE,
    ZIP,
    { type: "TotallyUnknownLegacyNodeType", question_id: "q_unknown", props: {} },
    CONT,
  ];

  it("a NON-CATALOG component type in a FRAMED funnel does not 500 — contributes nothing, single chrome intact", async () => {
    const h = newHarness();
    const section = seedSectionRaw(h.sdb, UNKNOWN_TYPE_SECTION, { headline: "Unknown-type framed section" });
    const q = await createQuoteWithSections(h, "Seam5 Unknown-Type Framed Quote", [section.id]);
    h.sdb.prepare("UPDATE leadgen_funnels SET frame_config_json = ? WHERE public_id = ?").run(SYNTH_FRAME, q.funnelPublicId);
    const act = await attachAuctionAndActivate(h, q, "seam5-unknown-type-framed");
    expect(act.status, `activate: ${await act.clone().text()}`).toBe(200);

    const res = await reqTenant(h.env, `/lg/seam5-unknown-type-framed`, {}, captureCtx().ctx);
    expect(res.status, `serve must NOT 500 on an unknown component type: ${await res.clone().text()}`).toBe(200);
    const html = await res.text();

    // The known ZIP field still renders — the unknown node contributed
    // nothing, it did not crash the whole section/request.
    expect(html, "the known ZIP field still renders").toContain('data-question-id="q_zip"');
    // This section carries no FooterBar/StepIndicator itself — the frame's own
    // synthesized chrome is the ONLY chrome; single, never double, and never
    // duplicated/corrupted by the unknown node's presence.
    expect(countOccurrences(html, 'class="lg-footerbar"'), "single footer (frame-only; unknown node contributes none)").toBe(1);
    expect(countOccurrences(html, 'role="progressbar"'), "single progress bar (frame-only; unknown node contributes none)").toBe(1);
  });

  it("a NON-CATALOG component type in a FRAMELESS funnel also serves 200 (the unknown node renders as empty)", async () => {
    const h = newHarness();
    const section = seedSectionRaw(h.sdb, UNKNOWN_TYPE_SECTION, { headline: "Unknown-type frameless section" });
    const q = await createQuoteWithSections(h, "Seam5 Unknown-Type Frameless Quote", [section.id]);
    // Deliberately NO frame_config_json UPDATE — frame stays NULL. The
    // frameless path never runs the filter (`frame === null ? nodes : …`), so
    // this is the control proving the unknown type is inert on its OWN merits,
    // not merely because the filter was skipped.
    const act = await attachAuctionAndActivate(h, q, "seam5-unknown-type-frameless");
    expect(act.status, `activate: ${await act.clone().text()}`).toBe(200);

    const res = await reqTenant(h.env, `/lg/seam5-unknown-type-frameless`, {}, captureCtx().ctx);
    expect(res.status, `serve: ${await res.clone().text()}`).toBe(200);
    const html = await res.text();
    expect(html, "the known ZIP field still renders").toContain('data-question-id="q_zip"');
  });
});
