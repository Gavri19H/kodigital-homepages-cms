// LeadGen v2.5 Phase B (slice B1) — the EXTENDED POST /variants/:id/preview
// (13 §13.4 + 04 §4.8):
//
//   * mode:"frame"   → the composed frame with the slot PLACEHOLDER;
//   * mode:"section" → the full composed body, chosen/current Section visible
//     (default = the runtime-shell shape, byte-parity by construction);
//   * mode:"all"     → pages[] — one composed document per Section with
//     CORRECT per-step progress values (step k of N advances);
//   * site_id        → ANY CMS site's branding (C4 — activation NOT required);
//   * draft_frame_config / draft_theme → substitute the stored config for
//     THIS render only — NOTHING persists (C5 preview-before-apply);
//   * a body WITHOUT any v2.5 param → the LEGACY response, byte-identical
//     (the committed leadgen-legacy-pin fixture is the authoritative gate —
//     run alongside this file; here the same-harness determinism + shape).
//
// Harness: node:sqlite + migrations 0036–0041 + site_settings.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import admin from "../src/admin/router";
import type { Env } from "../src/env";
import { mintPublicId } from "../src/leadgen/ids";
import { renderComposedVariantPreview } from "../src/admin/leadgen/quotes-handlers";
import type {
  LeadgenFunnelRow,
  LeadgenFunnelVariantRow,
  LeadgenQuoteRow,
  LeadgenSectionRow,
} from "../src/admin/leadgen/db-types";

// --- node:sqlite harness (repo pattern) --------------------------------------

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
] as const;

const API = "/api/admin/leadgen";
const SITE_LOGO_URL = "https://cdn.example.com/site-one-logo.png";

function createDb(DatabaseSync: DatabaseSyncCtor): SqliteDb {
  const sdb = new DatabaseSync(":memory:");
  runSql(
    sdb,
    "CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT, domain TEXT, vertical_slug TEXT, status TEXT, content_version INTEGER DEFAULT 1, settings_version INTEGER DEFAULT 1);" +
      "CREATE TABLE domains (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT, hostname TEXT, status TEXT);" +
      "CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT);" +
      "CREATE TABLE site_settings (site_id TEXT, key TEXT, value TEXT);" +
      "INSERT INTO sites (id, name, domain, vertical_slug, status) VALUES ('site-1','Site One','one.example.com','insurance','active');" +
      "INSERT INTO sites (id, name, domain, vertical_slug, status) VALUES ('site-2','Site Two','two.example.com','insurance','active');" +
      "INSERT INTO site_settings (site_id, key, value) VALUES ('site-1','site_name','Site One Brand');" +
      `INSERT INTO site_settings (site_id, key, value) VALUES ('site-1','site_logo_url','${SITE_LOGO_URL}');`,
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

function jsonInit(method: string, body: unknown): RequestInit {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

// --- fixture ------------------------------------------------------------------

// A `centered` frame with a labelled step BAR — the per-step progress values
// (aria-valuenow + "Step k of N") are the mode:"all" assertion surface.
const FRAME_CONFIG = {
  version: 1,
  template: "centered",
  progress: { style: "bar", show_label: true },
} as const;

function seedSection(sdb: SqliteDb, headline: string, qid: string): { id: number; public_id: string } {
  const publicId = mintPublicId("section");
  const content = JSON.stringify({
    components: [
      { type: "QuestionHeadline", question_id: `${qid}_h`, bind: "section_headline", props: {} },
      {
        type: "TwoButtonYesNo",
        question_id: qid,
        question_key: `${qid}_key`,
        internal_field: `${qid}_field`,
        answer_type: "boolean",
      },
      { type: "ContinueButton", question_id: `${qid}_c`, props: { label: "Continue" } },
    ],
  });
  sdb
    .prepare(
      "INSERT INTO leadgen_sections (public_id, section_name, activity, vertical, headline_text, content_json, continue_mode, address_validation_enabled, status) VALUES (?, ?, 'quote_funnel', 'life', ?, ?, 'button', 0, 'active')",
    )
    .run(publicId, `Section ${qid}`, headline, content);
  const row = sdb.prepare("SELECT id FROM leadgen_sections WHERE public_id = ?").get(publicId) as {
    id: number;
  };
  return { id: row.id, public_id: publicId };
}

interface Fixture {
  sdb: SqliteDb;
  env: Env;
  quotePublicId: string;
  funnelPublicId: string;
  variantPublicId: string;
  sections: Array<{ id: number; public_id: string }>;
}

// `sectionCount` (Phase D, additive — default keeps every existing call
// byte-identical): >3 grows the variant for the lazy-pages protocol legs.
async function seedFixture(withFrame = true, sectionCount = 3): Promise<Fixture> {
  const sdb = createDb(DatabaseSync as DatabaseSyncCtor);
  const env = buildEnv(d1FromSqlite(sdb), makeKvStub());
  const createRes = await admin.request(
    `${API}/quotes`,
    jsonInit("POST", { quote_name: "Preview Modes Quote", activity: "quote_funnel", verticals: ["life"] }),
    env,
  );
  expect(createRes.status, `create quote: ${await createRes.clone().text()}`).toBe(201);
  const created = (await createRes.json()) as {
    public_id: string;
    funnels: Array<{ public_id: string; variants: Array<{ public_id: string }> }>;
  };
  const funnelPublicId = created.funnels[0]!.public_id;
  const variantPublicId = created.funnels[0]!.variants[0]!.public_id;

  const headlines = ["Are you insured?", "What is your ZIP?", "Your age band?"];
  const sections: Array<{ id: number; public_id: string }> = [];
  for (let i = 0; i < sectionCount; i++) {
    sections.push(seedSection(sdb, headlines[i] ?? `Question ${i + 1}?`, `q${i + 1}`));
  }
  const putRes = await admin.request(
    `${API}/variants/${variantPublicId}`,
    jsonInit("PUT", { sections: sections.map((s) => ({ section_id: s.id })) }),
    env,
  );
  expect(putRes.status, `put sections: ${await putRes.clone().text()}`).toBe(200);

  if (withFrame) {
    sdb
      .prepare("UPDATE leadgen_funnels SET frame_config_json = ? WHERE public_id = ?")
      .run(JSON.stringify(FRAME_CONFIG), funnelPublicId);
  }
  return {
    sdb,
    env,
    quotePublicId: created.public_id,
    funnelPublicId,
    variantPublicId,
    sections,
  };
}

async function postPreview(fx: Fixture, body: unknown): Promise<Response> {
  return admin.request(`${API}/variants/${fx.variantPublicId}/preview`, jsonInit("POST", body), fx.env);
}

// Section-wrapper visibility probes (the renderVariantSectionsHtml contract).
function sectionOpenTag(html: string, index: number): string {
  const m = html.match(new RegExp(`<section data-lg-section [^>]*data-lg-index="${index}"[^>]*>`));
  expect(m, `section index ${index} present`).not.toBeNull();
  return m![0];
}

type V25Preview = {
  preview: { css: string; html?: string; pages?: string[]; section_count: number };
  config: Record<string, unknown>;
  problems?: Array<{ path: string; severity: string; message: string }>;
};

// ===========================================================================

describeDb("preview modes — POST /variants/:id/preview (13 §13.4)", () => {
  it("LEGACY: a body without any v2.5 param keeps the legacy response — deterministic bytes, legacy shape", async () => {
    const fx = await seedFixture();
    const first = await postPreview(fx, {});
    expect(first.status).toBe(200);
    const firstText = await first.text();
    const second = await postPreview(fx, {});
    expect(await second.text()).toBe(firstText); // same-harness byte identity
    const parsed = JSON.parse(firstText) as {
      preview: { css: string; desktop: string; mobile: string; section_count: number; html?: unknown; pages?: unknown };
    };
    expect(parsed.preview.desktop).toBeTruthy();
    expect(parsed.preview.mobile).toBeTruthy();
    expect(parsed.preview.html).toBeUndefined();
    expect(parsed.preview.pages).toBeUndefined();
    expect(parsed.preview.section_count).toBe(3);

    // Unknown keys are NOT v2.5 triggers — still the legacy shape.
    const stray = await postPreview(fx, { foo: 1 });
    expect(await stray.text()).toBe(firstText);
  });

  it("mode:'frame' renders the composed frame with the slot placeholder (no sections)", async () => {
    const fx = await seedFixture();
    const res = await postPreview(fx, { mode: "frame" });
    expect(res.status, await res.clone().text()).toBe(200);
    const body = (await res.json()) as V25Preview;
    expect(body.preview.html).toContain("data-lg-slot-placeholder");
    expect(body.preview.html).toContain('data-frame-region="section_slot"');
    expect(body.preview.html).toContain('data-frame-template="centered"');
    expect(body.preview.html).not.toContain("<section data-lg-section");
    // Progress totals still count the variant's slides (11 §11.1).
    expect(body.preview.html).toContain('aria-valuemax="3"');
    expect(body.preview.pages).toBeUndefined();
    expect(body.preview.section_count).toBe(3);
    expect(body.config).toBeTruthy();
    expect(body.preview.css).toContain(".lg-frame-region");
  });

  it("mode:'section' default equals the composed runtime-shape body; section_public_id picks the visible slide + advances progress", async () => {
    const fx = await seedFixture();
    const res = await postPreview(fx, { mode: "section" });
    expect(res.status, await res.clone().text()).toBe(200);
    const body = (await res.json()) as V25Preview;

    // Parity by construction: the default mode:"section" html IS the mode-less
    // composed renderer's body (which the preview-runtime-parity suite pins
    // byte-identical to the served /lg shell, 13 §13.5 leg 1).
    const quote = fx.sdb.prepare("SELECT * FROM leadgen_quotes WHERE public_id = ?").get(fx.quotePublicId) as unknown as LeadgenQuoteRow;
    const funnel = fx.sdb.prepare("SELECT * FROM leadgen_funnels WHERE public_id = ?").get(fx.funnelPublicId) as unknown as LeadgenFunnelRow;
    const variant = fx.sdb.prepare("SELECT * FROM leadgen_funnel_variants WHERE public_id = ?").get(fx.variantPublicId) as unknown as LeadgenFunnelVariantRow;
    const sections = (
      fx.sdb
        .prepare(
          `SELECT s.* FROM leadgen_funnel_variant_sections fvs
           JOIN leadgen_sections s ON s.id = fvs.section_id
           WHERE fvs.variant_id = ? ORDER BY fvs.position ASC`,
        )
        .all(variant.id) as unknown[]
    ) as LeadgenSectionRow[];
    // Round-4 P5b (10B admin leg, conductor-granted): postPreview hits the
    // REAL composedVariantPreviewResponse route, which now always passes
    // adminPreview:true (the admin-preview-only no-logo hint) — the
    // reference call must match it for this byte-parity assertion to hold.
    const direct = renderComposedVariantPreview({ quote, funnel, variant, sections, adminPreview: true });
    expect(direct).not.toBeNull();
    expect(body.preview.html).toBe(direct!.html);
    expect(body.preview.css).toBe(direct!.css);

    // First slide visible, the rest hidden; step-1 progress.
    expect(sectionOpenTag(body.preview.html!, 0)).not.toContain(" hidden");
    expect(sectionOpenTag(body.preview.html!, 1)).toContain(" hidden");
    expect(sectionOpenTag(body.preview.html!, 2)).toContain(" hidden");
    expect(body.preview.html).toContain('aria-valuenow="1"');

    // Chosen slide: s2 visible, s1 hidden, progress at step 2 of 3.
    const chosen = await postPreview(fx, { mode: "section", section_public_id: fx.sections[1]!.public_id });
    expect(chosen.status).toBe(200);
    const chosenBody = (await chosen.json()) as V25Preview;
    expect(sectionOpenTag(chosenBody.preview.html!, 0)).toContain(" hidden");
    expect(sectionOpenTag(chosenBody.preview.html!, 1)).not.toContain(" hidden");
    expect(chosenBody.preview.html).toContain('aria-valuenow="2"');
    expect(chosenBody.preview.html).toContain("Step 2 of 3");

    // A section that is not part of this variant → 400 fields.
    const bad = await postPreview(fx, { mode: "section", section_public_id: "lgs_00000000000000000000000000" });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { fields: Record<string, string> }).fields["section_public_id"]).toBeTruthy();
  });

  it("mode:'all' → pages[]: one composed document per Section with correct per-step progress values", async () => {
    const fx = await seedFixture();
    const res = await postPreview(fx, { mode: "all" });
    expect(res.status, await res.clone().text()).toBe(200);
    const body = (await res.json()) as V25Preview;
    expect(body.preview.html).toBeUndefined();
    const pages = body.preview.pages!;
    expect(pages).toHaveLength(3);
    for (let k = 0; k < 3; k++) {
      const page = pages[k]!;
      expect(page, `page ${k} progress value`).toContain(`aria-valuenow="${k + 1}"`);
      expect(page, `page ${k} progress label`).toContain(`Step ${k + 1} of 3`);
      expect(page).toContain('data-frame-template="centered"');
      // Page k shows slide k, hides the others (the runtime's own mechanism —
      // the `hidden` attribute on the section wrappers).
      for (let i = 0; i < 3; i++) {
        const tag = sectionOpenTag(page, i);
        if (i === k) expect(tag, `page ${k}: slide ${i} visible`).not.toContain(" hidden");
        else expect(tag, `page ${k}: slide ${i} hidden`).toContain(" hidden");
      }
    }
    // The progress bar fill width advances too (step/total percent).
    expect(pages[2]).toContain("width:100%");
  });

  it("footer show_on mirrors the ENGINE per page (DEV-57): 'final' hidden until the last page, 'first' visible only on page 1", async () => {
    const fx = await seedFixture();
    const setFooter = (showOn: string): void => {
      fx.sdb
        .prepare("UPDATE leadgen_funnels SET frame_config_json = ? WHERE public_id = ?")
        .run(JSON.stringify({ ...FRAME_CONFIG, footer: { show_on: showOn } }), fx.funnelPublicId);
    };

    // --- show_on:"final" — hidden on pages 1..N-1, visible on page N --------
    setFooter("final");
    const finalRes = await postPreview(fx, { mode: "all" });
    expect(finalRes.status, await finalRes.clone().text()).toBe(200);
    const finalPages = ((await finalRes.json()) as V25Preview).preview.pages!;
    expect(finalPages).toHaveLength(3);
    expect(finalPages[0], "final: page 1 hidden").toContain(' data-show-on="final" hidden>');
    expect(finalPages[1], "final: page 2 hidden").toContain(' data-show-on="final" hidden>');
    expect(finalPages[2], "final: page 3 visible").toContain(' data-show-on="final">');
    expect(finalPages[2]).not.toContain(' data-show-on="final" hidden>');

    // mode:"section" mirrors the same rule for the CHOSEN slide
    const lastChosen = await postPreview(fx, { mode: "section", section_public_id: fx.sections[2]!.public_id });
    expect(lastChosen.status).toBe(200);
    expect(((await lastChosen.json()) as V25Preview).preview.html).toContain(' data-show-on="final">');
    const midChosen = await postPreview(fx, { mode: "section", section_public_id: fx.sections[1]!.public_id });
    expect(((await midChosen.json()) as V25Preview).preview.html).toContain(' data-show-on="final" hidden>');

    // --- show_on:"first" — visible only on page 1 ----------------------------
    setFooter("first");
    const firstRes = await postPreview(fx, { mode: "all" });
    expect(firstRes.status, await firstRes.clone().text()).toBe(200);
    const firstPages = ((await firstRes.json()) as V25Preview).preview.pages!;
    expect(firstPages[0], "first: page 1 visible").toContain(' data-show-on="first">');
    expect(firstPages[0]).not.toContain(' data-show-on="first" hidden>');
    expect(firstPages[1], "first: page 2 hidden").toContain(' data-show-on="first" hidden>');
    expect(firstPages[2], "first: page 3 hidden").toContain(' data-show-on="first" hidden>');
  });

  it("site_id threads ANY CMS site's branding — including an UNACTIVATED site (C4)", async () => {
    const fx = await seedFixture();
    // C4 precondition: no activation rows exist for ANY site.
    const activations = fx.sdb.prepare("SELECT COUNT(*) AS n FROM leadgen_site_quotes").get() as { n: number };
    expect(activations.n).toBe(0);

    const one = await postPreview(fx, { mode: "section", site_id: "site-1" });
    expect(one.status, await one.clone().text()).toBe(200);
    const oneBody = (await one.json()) as V25Preview;
    expect(oneBody.preview.html).toContain(SITE_LOGO_URL); // §10.2 logo leg

    // site-2 has NO settings and NO activation — the §10.4 text-mark leg.
    const two = await postPreview(fx, { mode: "section", site_id: "site-2" });
    expect(two.status).toBe(200);
    const twoBody = (await two.json()) as V25Preview;
    expect(twoBody.preview.html).toContain("two.example.com");
    expect(twoBody.preview.html).not.toContain(SITE_LOGO_URL);

    // No site_id → the CMS fallback branding entry (ladder floor).
    const none = await postPreview(fx, { mode: "section" });
    expect(((await none.json()) as V25Preview).preview.html).toContain("Kodigital");

    // Unknown site → 404 (the selector lists real CMS sites only).
    const missing = await postPreview(fx, { mode: "section", site_id: "site-nope" });
    expect(missing.status).toBe(404);
  });

  it("draft_frame_config / draft_theme render for THIS response only — nothing persists (C5)", async () => {
    const fx = await seedFixture();
    const storedBefore = fx.sdb
      .prepare("SELECT frame_config_json AS f, theme_json AS t FROM leadgen_funnels WHERE public_id = ?")
      .get(fx.funnelPublicId) as { f: string | null; t: string | null };

    // Template preview-before-apply: draft minimal over the stored centered.
    const draft = await postPreview(fx, {
      mode: "frame",
      draft_frame_config: { version: 1, template: "minimal" },
    });
    expect(draft.status, await draft.clone().text()).toBe(200);
    const draftBody = (await draft.json()) as V25Preview;
    expect(draftBody.preview.html).toContain('data-frame-template="minimal"');
    expect(draftBody.preview.html).not.toContain('data-frame-region="footer"'); // minimal: no footer

    // Draft theme: the css resolves the drafted palette.
    const themed = await postPreview(fx, {
      mode: "section",
      draft_theme: { version: 1, palette: { brand_primary: "#ABCDEF" } },
    });
    expect(themed.status).toBe(200);
    const themedBody = (await themed.json()) as V25Preview;
    expect(themedBody.preview.css).toContain("#ABCDEF");
    // The hex palette warning rides the response (§9.3) without blocking.
    expect(themedBody.problems?.some((p) => p.severity === "warning")).toBe(true);

    // NOTHING persisted: the stored columns are byte-identical.
    const storedAfter = fx.sdb
      .prepare("SELECT frame_config_json AS f, theme_json AS t FROM leadgen_funnels WHERE public_id = ?")
      .get(fx.funnelPublicId) as { f: string | null; t: string | null };
    expect(storedAfter).toEqual(storedBefore);
    expect(storedAfter.f).toBe(JSON.stringify(FRAME_CONFIG));
    expect(storedAfter.t).toBeNull();

    // A schema-invalid draft → 400 + §3.6 problems (no silent legacy render).
    const bad = await postPreview(fx, { mode: "frame", draft_frame_config: { bogus: {} } });
    expect(bad.status).toBe(400);
    const badBody = (await bad.json()) as { problems: Array<{ path: string; severity: string }> };
    expect(badBody.problems.some((p) => p.path === "frame.bogus" && p.severity === "error")).toBe(true);

    const badTheme = await postPreview(fx, { mode: "section", draft_theme: { palette: { nope: "#123456" } } });
    expect(badTheme.status).toBe(400);
  });

  it("v2.5 modes on a LEGACY funnel (no frame) compose the pinned legacy shell — never a 500", async () => {
    const fx = await seedFixture(false); // frame_config_json stays NULL
    const res = await postPreview(fx, { mode: "section" });
    expect(res.status, await res.clone().text()).toBe(200);
    const body = (await res.json()) as V25Preview;
    expect(body.preview.html).toContain('<div id="lg-funnel-root"');
    expect(body.preview.html).toContain("data-lg-mount");
    expect(body.preview.html).not.toContain("data-frame-region");
    expect(sectionOpenTag(body.preview.html!, 0)).not.toContain(" hidden");

    const all = await postPreview(fx, { mode: "all" });
    const allBody = (await all.json()) as V25Preview;
    expect(allBody.preview.pages).toHaveLength(3);
    expect(sectionOpenTag(allBody.preview.pages![1]!, 1)).not.toContain(" hidden");

    const frameOnly = await postPreview(fx, { mode: "frame" });
    const frameBody = (await frameOnly.json()) as V25Preview;
    expect(frameBody.preview.html).toContain("data-lg-slot-placeholder");
  });

  it("rejects malformed v2.5 params with 400 fields (mode/viewport/site_id types)", async () => {
    const fx = await seedFixture();
    const badMode = await postPreview(fx, { mode: "diagonal" });
    expect(badMode.status).toBe(400);
    expect(((await badMode.json()) as { fields: Record<string, string> }).fields["mode"]).toBeTruthy();

    const badViewport = await postPreview(fx, { mode: "section", viewport: "tablet" });
    expect(badViewport.status).toBe(400);

    const badSite = await postPreview(fx, { mode: "section", site_id: 42 });
    expect(badSite.status).toBe(400);

    // viewport is accepted when valid (shape-compat; render is width-neutral).
    const ok = await postPreview(fx, { mode: "section", viewport: "mobile" });
    expect(ok.status).toBe(200);
  });
});

// ===========================================================================
// DEV-58 (Phase D) — draft_frame_overrides: the ADDITIVE per-arm overrides
// draft. Substituted for the STORED variant.frame_overrides_json in the same
// composition slot (render-only, nothing persists), validated EXACTLY like
// the stored column (template/version rejected; frame-part via
// validateFrameConfig, theme-part via validateTheme).
// ===========================================================================

describeDb("draft_frame_overrides (DEV-58, Phase D) — render-only per-arm overrides draft", () => {
  const STORED_OVERRIDES = JSON.stringify({ progress: { style: "numbered" } });

  async function overriddenFixture(): Promise<Fixture> {
    const fx = await seedFixture();
    fx.sdb
      .prepare("UPDATE leadgen_funnel_variants SET frame_overrides_json = ? WHERE public_id = ?")
      .run(STORED_OVERRIDES, fx.variantPublicId);
    return fx;
  }

  it("substitutes the STORED overrides for THIS render only — the working value wins over a stored override; nothing persists", async () => {
    const fx = await overriddenFixture();

    // Baseline: WITHOUT the draft the STORED override renders (numbered).
    const stored = await postPreview(fx, { mode: "section" });
    expect(stored.status, await stored.clone().text()).toBe(200);
    expect(((await stored.json()) as V25Preview).preview.html).toContain("lg-frame-progress--numbered");

    // The DEV-58 case: re-editing the STORED override — the WORKING value
    // (dots) must render, not the stored one (the old fold could never win
    // because the server merged the stored column last).
    const working = await postPreview(fx, {
      mode: "section",
      draft_frame_overrides: { progress: { style: "dots" } },
    });
    expect(working.status, await working.clone().text()).toBe(200);
    const workingBody = (await working.json()) as V25Preview;
    expect(workingBody.preview.html).toContain("lg-steps"); // the dots preset
    expect(workingBody.preview.html).not.toContain("lg-frame-progress--numbered");

    // {} substitutes "no overrides" (the inherit preview): funnel truth = bar.
    const cleared = await postPreview(fx, { mode: "section", draft_frame_overrides: {} });
    const clearedBody = (await cleared.json()) as V25Preview;
    expect(clearedBody.preview.html).not.toContain("lg-frame-progress--numbered");
    expect(clearedBody.preview.html).toContain("lg-progress"); // the funnel's bar style

    // null: same "no overrides" semantics as a NULL column.
    const nulled = await postPreview(fx, { mode: "section", draft_frame_overrides: null });
    expect(((await nulled.json()) as V25Preview).preview.html).not.toContain("lg-frame-progress--numbered");

    // The theme part rides the stored-column split: the drafted palette
    // reaches the effective css.
    const themed = await postPreview(fx, {
      mode: "section",
      draft_frame_overrides: { theme: { palette: { accent: "#116611" } } },
    });
    expect(((await themed.json()) as V25Preview).preview.css).toContain("#116611");

    // NOTHING persisted by any of the renders above.
    const after = fx.sdb
      .prepare("SELECT frame_overrides_json AS o FROM leadgen_funnel_variants WHERE public_id = ?")
      .get(fx.variantPublicId) as { o: string | null };
    expect(after.o).toBe(STORED_OVERRIDES);
  });

  it("validated like the stored column: template/version rejected, bad enums + bad theme 400 with §3.6 problems; non-object 400 fields", async () => {
    const fx = await overriddenFixture();

    const template = await postPreview(fx, {
      mode: "section",
      draft_frame_overrides: { template: "minimal" },
    });
    expect(template.status).toBe(400);
    const templateBody = (await template.json()) as { problems: Array<{ path: string; severity: string }> };
    expect(
      templateBody.problems.some((p) => p.path === "frame_overrides.template" && p.severity === "error"),
    ).toBe(true);

    const version = await postPreview(fx, { mode: "section", draft_frame_overrides: { version: 1 } });
    expect(version.status).toBe(400);

    const badEnum = await postPreview(fx, {
      mode: "section",
      draft_frame_overrides: { header: { logo_size: "xxl" } },
    });
    expect(badEnum.status).toBe(400);
    const badEnumBody = (await badEnum.json()) as { problems: Array<{ path: string }> };
    expect(badEnumBody.problems.some((p) => p.path === "frame.header.logo_size")).toBe(true);

    const badTheme = await postPreview(fx, { mode: "section", draft_frame_overrides: { theme: "nope" } });
    expect(badTheme.status).toBe(400);

    const nonObject = await postPreview(fx, { mode: "section", draft_frame_overrides: "x" });
    expect(nonObject.status).toBe(400);
    expect(
      ((await nonObject.json()) as { fields: Record<string, string> }).fields["draft_frame_overrides"],
    ).toBeTruthy();

    // A body carrying ONLY the new key routes composed (it IS a v2.5 trigger)
    // — the mode-less composed default, never the legacy shape.
    const only = await postPreview(fx, { draft_frame_overrides: { progress: { style: "dots" } } });
    expect(only.status, await only.clone().text()).toBe(200);
    const onlyBody = (await only.json()) as V25Preview & { preview: { desktop?: unknown } };
    expect(onlyBody.preview.html).toBeTruthy();
    expect(onlyBody.preview.desktop).toBeUndefined();

    // …and the stored column is byte-untouched after every request above.
    const after = fx.sdb
      .prepare("SELECT frame_overrides_json AS o FROM leadgen_funnel_variants WHERE public_id = ?")
      .get(fx.variantPublicId) as { o: string | null };
    expect(after.o).toBe(STORED_OVERRIDES);
  });
});

// ===========================================================================
// Phase D stepper perf — the mode:"all" lazy per-page protocol: `page: k`
// returns ONE composed page (byte-identical to the eager pages[k-1]) +
// section_count; page-less calls keep the eager pages[] byte-shape for ANY
// section count (the ≤8 flow is untouched — the ISLAND opts into laziness
// above its threshold).
// ===========================================================================

describeDb("mode:'all' lazy pages protocol (Phase D stepper perf)", () => {
  it(">8 sections: page:k ≡ the eager pages[k-1] byte-for-byte, with section_count + clamping", async () => {
    const fx = await seedFixture(true, 9);
    const eager = await postPreview(fx, { mode: "all" });
    expect(eager.status, await eager.clone().text()).toBe(200);
    const eagerBody = (await eager.json()) as V25Preview & { preview: { page?: unknown } };
    expect(eagerBody.preview.pages).toHaveLength(9);
    expect(eagerBody.preview.page).toBeUndefined(); // page-less = the Phase-B shape
    expect(eagerBody.preview.section_count).toBe(9);

    for (const k of [1, 5, 9]) {
      const lazy = await postPreview(fx, { mode: "all", page: k });
      expect(lazy.status, await lazy.clone().text()).toBe(200);
      const lazyBody = (await lazy.json()) as V25Preview & { preview: { page?: number } };
      expect(lazyBody.preview.html, `page ${k} ≡ eager pages[${k - 1}]`).toBe(
        eagerBody.preview.pages![k - 1],
      );
      expect(lazyBody.preview.page).toBe(k);
      expect(lazyBody.preview.section_count).toBe(9);
      expect(lazyBody.preview.pages).toBeUndefined();
      expect(lazyBody.preview.css).toBe(eagerBody.preview.css);
      expect(lazyBody.preview.html).toContain(`Step ${k} of 9`);
    }

    // Out-of-range clamps to the last page (the visibleIndex idiom).
    const over = await postPreview(fx, { mode: "all", page: 99 });
    const overBody = (await over.json()) as V25Preview & { preview: { page?: number } };
    expect(overBody.preview.page).toBe(9);
    expect(overBody.preview.html).toBe(eagerBody.preview.pages![8]);
  });

  it("≤8 sections: the eager pages[] shape is byte-identical (no page key) and page:k still equals its eager page", async () => {
    const fx = await seedFixture(); // the 3-section fixture
    const eager = await postPreview(fx, { mode: "all" });
    const eagerBody = (await eager.json()) as V25Preview & { preview: { page?: unknown } };
    expect(eagerBody.preview.pages).toHaveLength(3);
    expect(eagerBody.preview.page).toBeUndefined();

    const lazy = await postPreview(fx, { mode: "all", page: 2 });
    const lazyBody = (await lazy.json()) as V25Preview & { preview: { page?: number } };
    expect(lazyBody.preview.html).toBe(eagerBody.preview.pages![1]);
    expect(lazyBody.preview.page).toBe(2);
  });

  it("rejects malformed page params: non-integer / <1 / wrong mode → 400 fields", async () => {
    const fx = await seedFixture();
    for (const bad of [0, -1, 1.5, "2", true]) {
      const res = await postPreview(fx, { mode: "all", page: bad });
      expect(res.status, `page=${JSON.stringify(bad)}`).toBe(400);
      expect(
        ((await res.json()) as { fields: Record<string, string> }).fields["page"],
        `page=${JSON.stringify(bad)} fields`,
      ).toBeTruthy();
    }
    const wrongMode = await postPreview(fx, { mode: "section", page: 1 });
    expect(wrongMode.status).toBe(400);
    expect(((await wrongMode.json()) as { fields: Record<string, string> }).fields["page"]).toBeTruthy();
  });
});
