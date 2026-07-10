// LeadGen v2.5 Phase A slice A7 — the A-EXIT criterion (16 Phase A) +
// `no-duplicate-headline-storage` (15 §15.1) + the serve-bake leg of
// `site-logo-inheritance`.
//
//   1. A fixture funnel WITH `frame_config_json` set serves a COMPOSED `/lg`
//      page through the REAL serve path (app.request → resolver → composition
//      swap, 13 §13.3): frame regions present, exactly ONE frame-owned
//      `data-lg-progress` engine mount, the sections INSIDE the section_slot's
//      data-lg-mount, and a VALID #lg-config blob whose design_tokens are the
//      EFFECTIVE (themed) tokens (09 §9.2).
//   2. Serve bake (10 §10.2 D4): a site with a logo serves the composed page
//      with that logo baked into the frame header (site-scoped shell cache
//      makes the bake safe).
//   3. `no-duplicate-headline-storage` (15 §15.1 + 03 §3.4):
//      (a) handler leg — POST/PATCH /sections with a BOUND QuestionHeadline:
//          content_html renders the Section's canonical headline column; a
//          headline_text PATCH re-renders content_html with the NEW text; a
//          bound node carrying props.text is REJECTED (bound_node_carries_text)
//          so props.text is never persisted for it;
//      (b) composed leg — renderComposedVariantPreview output contains NO
//          `lg-section-headline` h2 (the §3.4 h2 removal applies to the NEW
//          composed paths; the legacy preview pin keeps the h2 — DEV-54).
//
// Harness: the leadgen-runtime-api node:sqlite pattern + migrations 0036–0041
// (0041 adds the frame/theme columns) + a site_settings table for the logo
// leg. Frame/theme columns are set via direct SQL (their PUT routes are
// Phase B).

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import app from "../src/index";
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

// 0041 included: the frame/theme columns are the fixture surface here.
const LEADGEN_MIGRATIONS = [
  "0036_leadgen_core.sql",
  "0037_leadgen_analytics_mirror.sql",
  "0038_leadgen_revenue_infra.sql",
  "0039_leadgen_conversion_dedupe.sql",
  "0040_leadgen_runtime_context.sql",
  "0041_leadgen_frame_theme.sql",
] as const;

const TENANT_HOST = "one.example.com";
const TENANT_ORIGIN = `http://${TENANT_HOST}`;
const SITE_LOGO_URL = "https://cdn.example.com/site-one-logo.png";

function createRuntimeDb(DatabaseSync: DatabaseSyncCtor): SqliteDb {
  const sdb = new DatabaseSync(":memory:");
  runSql(
    sdb,
    "CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT, domain TEXT, vertical_slug TEXT, status TEXT, content_version INTEGER DEFAULT 1, settings_version INTEGER DEFAULT 1);" +
      "CREATE TABLE domains (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT, hostname TEXT, status TEXT);" +
      "CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT);" +
      // §10.1 branding source — the logo leg reads it through resolveSiteBranding.
      "CREATE TABLE site_settings (site_id TEXT, key TEXT, value TEXT);" +
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
  env: Env;
}

function newHarness(): Harness {
  const sdb = createRuntimeDb(DatabaseSync as DatabaseSyncCtor);
  return { sdb, env: buildEnv(d1FromSqlite(sdb), makeKvStub()) };
}

// --- fixture seeding ----------------------------------------------------------

// Two sections: one with a BOUND headline (03 §3.4 canonical binding) + a
// question + Continue; one legacy unbound section. Both quote-compatible.
const BOUND_HEADLINE_1 = "How much coverage do you need?";
const BOUND_HEADLINE_2 = "Where do you live?";

function seedSection(
  sdb: SqliteDb,
  opts: { headline: string; contentJson: string; designOverridesJson?: string | null },
): { id: number; public_id: string } {
  const publicId = mintPublicId("section");
  sdb
    .prepare(
      "INSERT INTO leadgen_sections (public_id, section_name, activity, vertical, headline_text, content_json, continue_mode, design_overrides_json, address_validation_enabled, status) VALUES (?, ?, 'quote_funnel', 'life', ?, ?, 'button', ?, 0, 'active')",
    )
    .run(publicId, `Section ${publicId.slice(-4)}`, opts.headline, opts.contentJson, opts.designOverridesJson ?? null);
  const row = sdb.prepare("SELECT id FROM leadgen_sections WHERE public_id = ?").get(publicId) as {
    id: number;
  };
  return { id: row.id, public_id: publicId };
}

function boundSectionContent(headlineQid: string): string {
  return JSON.stringify({
    components: [
      { type: "QuestionHeadline", question_id: headlineQid, bind: "section_headline", props: {} },
      {
        type: "TwoButtonYesNo",
        question_id: `${headlineQid}_q`,
        question_key: `${headlineQid}_key`,
        internal_field: `${headlineQid}_field`,
        answer_type: "boolean",
      },
      { type: "ContinueButton", question_id: `${headlineQid}_c`, props: { label: "Continue" } },
    ],
  });
}

const FRAME_CONFIG = {
  version: 1,
  template: "centered",
  footer: { trust_text: "Free. No obligation." },
} as const;

const THEME_JSON = {
  version: 1,
  palette: { brand_primary: "#123456" },
} as const;

interface SeededComposedFunnel {
  quotePublicId: string;
  funnelPublicId: string;
  variantPublicId: string;
  sections: Array<{ id: number; public_id: string }>;
}

async function seedComposedFunnel(
  h: Harness,
  opts?: { slug?: string; frame?: unknown; theme?: unknown },
): Promise<SeededComposedFunnel> {
  const createRes = await admin.request(
    `${API}/quotes`,
    jsonInit("POST", { quote_name: "Composed Quote", activity: "quote_funnel", verticals: ["life"] }),
    h.env,
  );
  expect(createRes.status, `create quote: ${await createRes.clone().text()}`).toBe(201);
  const quote = (await createRes.json()) as {
    public_id: string;
    funnels: Array<{ public_id: string; variants: Array<{ public_id: string }> }>;
  };
  const funnelPublicId = quote.funnels[0]!.public_id;
  const variantPublicId = quote.funnels[0]!.variants[0]!.public_id;

  const s1 = seedSection(h.sdb, { headline: BOUND_HEADLINE_1, contentJson: boundSectionContent("h1") });
  const s2 = seedSection(h.sdb, { headline: BOUND_HEADLINE_2, contentJson: boundSectionContent("h2") });
  const putRes = await admin.request(
    `${API}/variants/${variantPublicId}`,
    jsonInit("PUT", { sections: [{ section_id: s1.id }, { section_id: s2.id }] }),
    h.env,
  );
  expect(putRes.status, `put sections: ${await putRes.clone().text()}`).toBe(200);

  // Frame + theme land via direct SQL (their PUT routes are Phase B).
  h.sdb
    .prepare("UPDATE leadgen_funnels SET frame_config_json = ?, theme_json = ? WHERE public_id = ?")
    .run(
      JSON.stringify(opts?.frame ?? FRAME_CONFIG),
      JSON.stringify(opts?.theme ?? THEME_JSON),
      funnelPublicId,
    );

  const actRes = await admin.request(
    `${API}/quotes/${quote.public_id}/activation/site-1`,
    jsonInit("PUT", { enabled: true, slug: opts?.slug ?? "composed" }),
    h.env,
  );
  expect(actRes.status, `activate: ${await actRes.clone().text()}`).toBe(200);
  return {
    quotePublicId: quote.public_id,
    funnelPublicId,
    variantPublicId,
    sections: [s1, s2],
  };
}

function extractConfigBlob(html: string): Record<string, unknown> {
  const marker = '<script type="application/json" id="lg-config">';
  const from = html.indexOf(marker);
  expect(from, "config blob present").toBeGreaterThan(-1);
  const start = from + marker.length;
  const end = html.indexOf("</script>", start);
  const raw = html.slice(start, end).split("\\u003c").join("<");
  return JSON.parse(raw) as Record<string, unknown>;
}

// ===========================================================================

describeDb("A-exit: a frame-configured funnel serves a COMPOSED /lg page (13 §13.3)", () => {
  it("frame regions + one progress mount + sections inside the slot + valid effective config blob", async () => {
    const h = newHarness();
    const seeded = await seedComposedFunnel(h);

    const res = await app.request(`${TENANT_ORIGIN}/lg/composed`, {}, h.env);
    expect(res.status, await res.clone().text()).toBe(200);
    const html = await res.text();

    // Composed root — the frame classes + template stamp replace the bare
    // legacy root; identity attributes unchanged (G4 ids + content_version).
    expect(html).toContain('id="lg-funnel-root"');
    expect(html).toContain("lg-frame lg-frame--centered");
    expect(html).toContain('data-frame-template="centered"');
    expect(html).toContain(`data-funnel-id="${seeded.funnelPublicId}"`);
    expect(html).toContain(`data-funnel-variant-id="${seeded.variantPublicId}"`);

    // Frame regions present (13 §13.1 region stamps; the `centered` template
    // stamps its top band as the bare "logo" region per 04 §4.3).
    for (const region of ["logo", "progress", "section_slot", "footer", "background"]) {
      expect(html, `region ${region}`).toContain(`data-frame-region="${region}"`);
    }
    // The configured footer trust text rides the frame footer.
    expect(html).toContain("Free. No obligation.");

    // EXACTLY ONE frame-owned engine progress mount (data-lg-progress
    // data-mode=…; the label/bar sub-hooks are distinct attribute names).
    expect((html.match(/ data-lg-progress data-mode=/g) ?? []).length).toBe(1);

    // Sections ride INSIDE the section_slot's data-lg-mount, in order, with
    // the 03 §3.2 wrapper contract intact.
    const slotAt = html.indexOf('data-frame-region="section_slot"');
    const mountAt = html.indexOf("data-lg-mount", slotAt);
    const s1At = html.indexOf(`data-lg-section-id="${seeded.sections[0]!.public_id}"`);
    const s2At = html.indexOf(`data-lg-section-id="${seeded.sections[1]!.public_id}"`);
    const mountCloseAt = html.indexOf("</main>", mountAt);
    expect(slotAt).toBeGreaterThan(-1);
    expect(mountAt).toBeGreaterThan(slotAt);
    expect(s1At).toBeGreaterThan(mountAt);
    expect(s2At).toBeGreaterThan(s1At);
    expect(mountCloseAt).toBeGreaterThan(s2At);
    // Banners mount still inside the mount, after the sections.
    const bannersAt = html.indexOf("data-lg-banners");
    expect(bannersAt).toBeGreaterThan(s2At);
    expect(bannersAt).toBeLessThan(mountCloseAt);

    // 03 §3.4: the BOUND headline renders the Section column text through the
    // preset h1 — and NO legacy h2 duplicate exists anywhere on the page.
    expect(html).toContain(BOUND_HEADLINE_1);
    expect(html).not.toContain("lg-section-headline");

    // Frame-region CSS rides the ONE style block.
    expect(html).toContain(".lg-frame-region");
    expect((html.match(/<style>/g) ?? []).length).toBe(1);

    // Config blob valid + EFFECTIVE tokens baked (theme brand_primary → the
    // design's color.primary, 09 §9.1 role mapping).
    const config = extractConfigBlob(html);
    expect(config["funnel_id"]).toBe(seeded.funnelPublicId);
    expect(config["funnel_variant_id"]).toBe(seeded.variantPublicId);
    const sections = config["sections"] as Array<Record<string, unknown>>;
    expect(sections).toHaveLength(2);
    expect(sections[0]).toMatchObject({ headline: BOUND_HEADLINE_1, section_index: 0 });
    const tokens = config["design_tokens"] as { color: { primary: string } };
    expect(tokens.color.primary).toBe("#123456");

    // Engine chrome unchanged: prehydrate stub + versioned engine script.
    expect(html).toContain("__LG_PREHYDRATE_QUEUE__");
    expect(html).toMatch(/<script src="\/lg\/runtime\/\d+\.js" defer><\/script>/);
  });

  it("GET /lg/config carries the SAME effective design tokens as the shell blob", async () => {
    const h = newHarness();
    const seeded = await seedComposedFunnel(h, { slug: "cfg" });
    const shellRes = await app.request(`${TENANT_ORIGIN}/lg/cfg`, {}, h.env);
    expect(shellRes.status).toBe(200);
    const shellConfig = extractConfigBlob(await shellRes.text());

    const cfgRes = await app.request(`${TENANT_ORIGIN}/lg/config/${seeded.variantPublicId}`, {}, h.env);
    expect(cfgRes.status, await cfgRes.clone().text()).toBe(200);
    const routeConfig = (await cfgRes.json()) as Record<string, unknown>;
    expect(routeConfig["design_tokens"]).toEqual(shellConfig["design_tokens"]);
    expect((routeConfig["design_tokens"] as { color: { primary: string } }).color.primary).toBe(
      "#123456",
    );
  });

  it("serve bake (10 §10.2): the activated site's logo appears in the composed frame header", async () => {
    const h = newHarness();
    h.sdb
      .prepare("INSERT INTO site_settings (site_id, key, value) VALUES ('site-1','site_logo_url',?)")
      .run(SITE_LOGO_URL);
    h.sdb
      .prepare("INSERT INTO site_settings (site_id, key, value) VALUES ('site-1','site_name','Site One Brand')")
      .run();
    await seedComposedFunnel(h, { slug: "branded" });

    const res = await app.request(`${TENANT_ORIGIN}/lg/branded`, {}, h.env);
    expect(res.status).toBe(200);
    const html = await res.text();
    // The §10.4 ladder's image leg, baked server-side into the frame header.
    expect(html).toContain(`<img class="lg-logo-img" src="${SITE_LOGO_URL}"`);
    expect(html).toContain('alt="Site One Brand"');
  });

  it("frame_config_json NULL keeps the exact legacy shell (no frame markup)", async () => {
    const h = newHarness();
    const seeded = await seedComposedFunnel(h, { slug: "legacyish" });
    // Strip the frame/theme → the funnel must serve the legacy shell again.
    h.sdb
      .prepare("UPDATE leadgen_funnels SET frame_config_json = NULL, theme_json = NULL WHERE public_id = ?")
      .run(seeded.funnelPublicId);
    const res = await app.request(`${TENANT_ORIGIN}/lg/legacyish`, {}, h.env);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).not.toContain("data-frame-region");
    expect(html).not.toContain("lg-frame--");
    expect(html).toContain('<main class="lg-content" data-lg-mount>');
  });
});

// ===========================================================================

describeDb("no-duplicate-headline-storage (15 §15.1 + 03 §3.4)", () => {
  it("handler leg: a bound node renders the headline COLUMN into content_html; a headline_text PATCH re-renders it; bound+props.text is rejected", async () => {
    const h = newHarness();

    const createRes = await admin.request(
      `${API}/sections`,
      jsonInit("POST", {
        section_name: "Bound Section",
        activity: "quote_funnel",
        vertical: "life",
        headline_text: "First headline",
        content_json: boundSectionContent("hb"),
      }),
      h.env,
    );
    expect(createRes.status, await createRes.clone().text()).toBe(201);
    const created = (await createRes.json()) as { public_id: string; content_html: string };
    // The persisted content_html carries the CANONICAL column text through the
    // bound node (h1 preset) — single store, no per-node copy.
    expect(created.content_html).toContain("First headline");
    expect(created.content_html).toContain('class="lg-headline"');

    // PATCH the canonical column → content_html re-renders with the NEW text.
    const patchRes = await admin.request(
      `${API}/sections/${created.public_id}`,
      jsonInit("PATCH", { headline_text: "Second headline" }),
      h.env,
    );
    expect(patchRes.status, await patchRes.clone().text()).toBe(200);
    const patched = (await patchRes.json()) as { content_html: string; content_json: unknown };
    expect(patched.content_html).toContain("Second headline");
    expect(patched.content_html).not.toContain("First headline");

    // The stored bound node still carries NO props.text (its text IS the column).
    const row = h.sdb
      .prepare("SELECT content_json FROM leadgen_sections WHERE public_id = ?")
      .get(created.public_id) as { content_json: string };
    const storedNodes = (JSON.parse(row.content_json) as { components: Array<Record<string, unknown>> })
      .components;
    const bound = storedNodes.find((n) => n["bind"] === "section_headline")!;
    expect(bound).toBeDefined();
    expect((bound["props"] as Record<string, unknown>)["text"]).toBeUndefined();

    // A bound node CARRYING props.text is rejected (bound_node_carries_text) —
    // saving can never persist per-node text for a bound node.
    const badContent = JSON.stringify({
      components: [
        {
          type: "QuestionHeadline",
          question_id: "hb",
          bind: "section_headline",
          props: { text: "smuggled copy" },
        },
        {
          type: "TwoButtonYesNo",
          question_id: "q1",
          question_key: "k",
          internal_field: "f",
          answer_type: "boolean",
        },
      ],
    });
    const badRes = await admin.request(
      `${API}/sections/${created.public_id}`,
      jsonInit("PATCH", { content: badContent }),
      h.env,
    );
    expect(badRes.status).toBe(400);
    // The handler maps the typed code onto its {error, fields} shape: the
    // bound_node_carries_text failure rides the node's props.text path.
    const badBody = (await badRes.json()) as { fields: Record<string, string> };
    expect(badBody.fields["content.components[0].props.text"]).toContain(
      "must not carry props.text",
    );
    // And the stored content is untouched by the rejected save.
    const after = h.sdb
      .prepare("SELECT content_json FROM leadgen_sections WHERE public_id = ?")
      .get(created.public_id) as { content_json: string };
    expect(after.content_json).toBe(row.content_json);
  });

  it("composed leg: renderComposedVariantPreview emits NO lg-section-headline h2 and binds the column text", async () => {
    const h = newHarness();
    const seeded = await seedComposedFunnel(h, { slug: "composed-preview" });

    const quote = h.sdb
      .prepare("SELECT * FROM leadgen_quotes WHERE public_id = ?")
      .get(seeded.quotePublicId) as unknown as LeadgenQuoteRow;
    const funnel = h.sdb
      .prepare("SELECT * FROM leadgen_funnels WHERE public_id = ?")
      .get(seeded.funnelPublicId) as unknown as LeadgenFunnelRow;
    const variant = h.sdb
      .prepare("SELECT * FROM leadgen_funnel_variants WHERE public_id = ?")
      .get(seeded.variantPublicId) as unknown as LeadgenFunnelVariantRow;
    const sections = seeded.sections.map(
      (s) =>
        h.sdb
          .prepare("SELECT * FROM leadgen_sections WHERE id = ?")
          .get(s.id) as unknown as LeadgenSectionRow,
    );

    const preview = renderComposedVariantPreview({ quote, funnel, variant, sections });
    expect(preview).not.toBeNull();
    // NO legacy duplicate-headline h2 anywhere in the composed output …
    expect(preview!.html).not.toContain("lg-section-headline");
    // … the canonical text renders ONCE per section through the bound h1.
    expect(preview!.html).toContain(BOUND_HEADLINE_1);
    expect(preview!.html).toContain(BOUND_HEADLINE_2);
    expect(preview!.html).toContain('data-frame-region="section_slot"');
    expect(preview!.section_count).toBe(2);
    // The css leg is the frame-extended chrome sheet.
    expect(preview!.css).toContain(".lg-frame-region");

    // A frame-less funnel has NO composed preview in Phase A.
    h.sdb
      .prepare("UPDATE leadgen_funnels SET frame_config_json = NULL WHERE public_id = ?")
      .run(seeded.funnelPublicId);
    const legacyFunnel = h.sdb
      .prepare("SELECT * FROM leadgen_funnels WHERE public_id = ?")
      .get(seeded.funnelPublicId) as unknown as LeadgenFunnelRow;
    expect(renderComposedVariantPreview({ quote, funnel: legacyFunnel, variant, sections })).toBeNull();
  });
});

// ===========================================================================

// Serve fork FAIL-SAFE (13 §13.3 / resolveFrameComposition degrade contract):
// a corrupt or schema-invalid stored frame_config_json must never break — or
// even ALTER — a revenue-serving page. Each case writes the bad column value
// directly into the funnel row, GETs the REAL funnel route, and asserts the
// response body is BYTE-EQUAL to the NULL-frame legacy body of the very same
// funnel (rendered through the same route in the same test).
//
// Cache note: the shell cache key (site/slug/ids/content_version/ab_rev/
// activation updated_at) carries NO frame axis, so each GET below rides a
// FRESH env (fresh KV stub) over the SAME sqlite db — every render is a cold,
// honest pass through resolveFrameComposition, never a cache echo.
describeDb("serve fork fail-safe (13 §13.3): bad frame_config_json degrades BYTE-EQUAL to the legacy shell", () => {
  async function coldServeBody(h: Harness, slug: string): Promise<string> {
    const env = buildEnv(d1FromSqlite(h.sdb), makeKvStub());
    const res = await app.request(`${TENANT_ORIGIN}/lg/${slug}`, {}, env);
    expect(res.status, await res.clone().text()).toBe(200);
    return res.text();
  }

  async function legacyReferenceBody(h: Harness, funnelPublicId: string, slug: string): Promise<string> {
    h.sdb
      .prepare("UPDATE leadgen_funnels SET frame_config_json = NULL WHERE public_id = ?")
      .run(funnelPublicId);
    const body = await coldServeBody(h, slug);
    // Sanity: the reference IS the legacy shell (no frame markup).
    expect(body).not.toContain("data-frame-region");
    expect(body).toContain('<main class="lg-content" data-lg-mount>');
    return body;
  }

  it("corrupt frame_config_json ('{not json') serves the NULL-frame legacy body byte-for-byte", async () => {
    const h = newHarness();
    const seeded = await seedComposedFunnel(h, { slug: "failsafe-corrupt" });
    const legacy = await legacyReferenceBody(h, seeded.funnelPublicId, "failsafe-corrupt");

    h.sdb
      .prepare("UPDATE leadgen_funnels SET frame_config_json = ? WHERE public_id = ?")
      .run("{not json", seeded.funnelPublicId);
    const corrupt = await coldServeBody(h, "failsafe-corrupt");
    expect(corrupt).toBe(legacy);
  });

  it("valid-JSON schema-INVALID frame (unsafe javascript: CTA href) serves the NULL-frame legacy body byte-for-byte", async () => {
    const h = newHarness();
    const seeded = await seedComposedFunnel(h, { slug: "failsafe-invalid" });
    const legacy = await legacyReferenceBody(h, seeded.funnelPublicId, "failsafe-invalid");

    const schemaInvalid = JSON.stringify({
      version: 1,
      template: "centered",
      header: { cta: { enabled: true, label: "Call now", href: "javascript:alert(1)" } },
    });
    h.sdb
      .prepare("UPDATE leadgen_funnels SET frame_config_json = ? WHERE public_id = ?")
      .run(schemaInvalid, seeded.funnelPublicId);
    const invalid = await coldServeBody(h, "failsafe-invalid");
    // Fail-safe: the unsafe href never reaches the page AND the whole body is
    // exactly the legacy render.
    expect(invalid).not.toContain("javascript:alert(1)");
    expect(invalid).toBe(legacy);
  });
});
