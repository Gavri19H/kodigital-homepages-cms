// R2 P3 FIX-FIRST round — the adversarial review's 2 BLOCKERS + 3 MAJORS +
// minors, each pinned at the boundary the defect actually lives on. The
// review's own repros are the fail-before specs; the driven proof (the real
// editor rebuilding Image28 + Image45, and a visitor at 1280/375) lives in
// docs/leadgen/r2/evidence/p3/fixround/.
//
// FAIL-BEFORE (recorded at 9ffed25, before any fix in this round — see
// docs/leadgen/r2/evidence/p3/fixround/fail-before.txt for the raw run):
//   BLOCKER-1  the editor's clientEffective() hydrated ONLY from the built-in
//              arrangement registry, so a funnel seeded by an APPLIED SAVED
//              TEMPLATE (frame_template_id set, frame_config_json NULL) showed
//              0 footer blocks while the visitor was served 8 — and the very
//              next save persisted that empty view over the served set.
//   BLOCKER-2  resolvePickedLegalPageLinks keyed on page_type ALONE, which a
//              stock site is not unique in: contact / do-not-sell /
//              privacy-policy / terms all seed as page_type 'legal', so four
//              distinct picks resolved to ONE href.
//   MAJOR-3    frame.ts emits data-align on every footer block; NO CSS rule
//              matched it, so .lg-frame-footer2{text-align:center} won.
//   MAJOR-4    .lg-frame-footer2-list / -heading / -logo-img had ZERO rules.
//   MAJOR-5    .lg-frame-footer2-link hard-coded text-decoration:none with no
//              operator control (Image45's underlined links undeliverable).
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import admin from "../src/admin/router";
import type { Env } from "../src/env";
import { resolvePickedLegalPageLinks, resolveSiteBranding } from "../src/leadgen/branding";
import type { SiteBrandingLegalPagePick } from "../src/leadgen/branding";
import { LG_BANNERS_MOUNT_HTML, renderQuoteFrame } from "../src/public/leadgen/designs/frame";
import type { RenderQuoteFrameInput } from "../src/public/leadgen/designs/frame";
import { effectiveFrame, validateFrameConfig } from "../src/public/leadgen/designs/frames";
import type { EffectiveFrameConfig, FrameConfig } from "../src/public/leadgen/designs/frames";
import { resolveTokens } from "../src/public/leadgen/designs/theme";
import { defaultFunnelDesign } from "../src/public/leadgen/designs/default-funnel/tokens";
import { funnelChromeCss } from "../src/public/leadgen/designs/default-funnel/styles";
import { QUOTE_EDITOR_SCRIPT } from "../src/admin/leadgen/quotes-tabs/funnel";
import { renderTemplatesTabPanel } from "../src/admin/leadgen/quotes-tabs/templates";

// --- node:sqlite harness (the repo pattern, mirrors leadgen-element-j-pages-
// links.test.ts 1:1 — same helpers, so both files exercise the same seam) ----

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
    return (nodeRequire("node:sqlite") as { DatabaseSync: DatabaseSyncCtor }).DatabaseSync;
  } catch {
    try {
      const getBuiltin = (process as unknown as {
        getBuiltinModule?: (name: string) => unknown;
      }).getBuiltinModule;
      if (typeof getBuiltin === "function") {
        return (getBuiltin("node:sqlite") as { DatabaseSync: DatabaseSyncCtor }).DatabaseSync;
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
          return (sdb.prepare(sql).get(...binds) ?? null) as T | null;
        },
        async all<T = unknown>() {
          return { results: sdb.prepare(sql).all(...binds) as T[], success: true, meta: {} };
        },
        async run() {
          const r = sdb.prepare(sql).run(...binds) as { changes?: number; lastInsertRowid?: number | bigint };
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
        for (const statement of statements) results.push(await statement.run());
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

function createTestDb(DatabaseSync: DatabaseSyncCtor): SqliteDb {
  const sdb = new DatabaseSync(":memory:");
  runSql(
    sdb,
    "CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT, domain TEXT, vertical_slug TEXT, status TEXT, content_version INTEGER DEFAULT 1, settings_version INTEGER DEFAULT 1);" +
      "CREATE TABLE domains (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT, hostname TEXT, status TEXT);" +
      "CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT);" +
      "CREATE TABLE site_settings (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT, key TEXT NOT NULL, value TEXT NOT NULL, UNIQUE(site_id, key));" +
      "CREATE TABLE pages (" +
      " id INTEGER PRIMARY KEY AUTOINCREMENT," +
      " site_id TEXT," +
      " slug TEXT NOT NULL," +
      " title TEXT NOT NULL," +
      " content_json TEXT NOT NULL," +
      " content_html TEXT," +
      " status TEXT NOT NULL DEFAULT 'draft'," +
      " template TEXT NOT NULL DEFAULT 'default'," +
      " show_in_footer INTEGER NOT NULL DEFAULT 0," +
      " display_order INTEGER NOT NULL DEFAULT 0," +
      " page_type TEXT NOT NULL DEFAULT 'generic'," +
      " seo_title TEXT," +
      " seo_description TEXT," +
      " created_at INTEGER NOT NULL DEFAULT (unixepoch())," +
      " updated_at INTEGER NOT NULL DEFAULT (unixepoch())" +
      ");" +
      // The per-site UNIQUE slug index the real schema carries (migration 0007
      // idx_pages_site_slug_unique) — the fix's identity choice rests on it.
      "CREATE UNIQUE INDEX idx_pages_site_slug_unique ON pages(site_id, slug);" +
      "INSERT INTO sites (id, name, domain, vertical_slug, status) VALUES ('stock-a','Stock A','a.example.com','insurance','active');" +
      "INSERT INTO sites (id, name, domain, vertical_slug, status) VALUES ('stock-b','Stock B','b.example.com','insurance','active');" +
      "INSERT INTO domains (site_id, hostname, status) VALUES ('stock-a','a.example.com','active');" +
      "INSERT INTO domains (site_id, hostname, status) VALUES ('stock-b','b.example.com','active');",
  );
  return sdb;
}

function buildEnv(db: D1Database): Env {
  return {
    DB: db,
    CACHE: makeKvStub(),
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

async function createPage(
  env: Env,
  input: { site_id: string; slug: string; title: string; page_type: string; show_in_footer?: boolean; status?: string },
): Promise<void> {
  const res = await admin.request(
    "/api/admin/pages",
    jsonInit("POST", {
      site_id: input.site_id,
      slug: input.slug,
      title: input.title,
      page_type: input.page_type,
      show_in_footer: input.show_in_footer ?? false,
      status: input.status ?? "published",
    }),
    env,
  );
  expect(res.status, `create page ${input.slug}: ${await res.clone().text()}`).toBe(201);
}

// What site-provisioning's legal-renderer actually seeds on a STOCK site: the
// four LEGAL_TEMPLATE_SLUGS. The reviewer's live picker feed showed
// `about, legal x4, privacy-policy, terms` — i.e. FOUR rows sharing one
// page_type. This reproduces exactly that collision.
async function seedStockLegalPages(env: Env, siteId: string): Promise<void> {
  await createPage(env, { site_id: siteId, slug: "contact", title: "Contact", page_type: "legal", show_in_footer: true });
  await createPage(env, { site_id: siteId, slug: "do-not-sell", title: "Do Not Sell My Personal Information", page_type: "legal" });
  await createPage(env, { site_id: siteId, slug: "privacy-policy", title: "Privacy Policy", page_type: "legal" });
  await createPage(env, { site_id: siteId, slug: "terms", title: "Terms of Service", page_type: "legal" });
}

const STOCK_PICKS: SiteBrandingLegalPagePick[] = [
  { page_type: "legal", slug: "contact", label: "Contact" },
  { page_type: "legal", slug: "do-not-sell", label: "Do Not Sell My Personal Information" },
  { page_type: "legal", slug: "privacy-policy", label: "Privacy Policy" },
  { page_type: "legal", slug: "terms", label: "Terms of Service" },
];

// ===========================================================================
// BLOCKER-2 — a pick must resolve to ITS page, on whichever site serves it
// ===========================================================================

describeDb("R2 P3 FIX-FIRST BLOCKER-2 — picked legal links resolve by a UNIQUE identity", () => {
  it("on a STOCK-seeded site (four pages sharing page_type 'legal'), four picks serve FOUR DISTINCT hrefs", async () => {
    const sdb = createTestDb(DatabaseSync!);
    const env = buildEnv(d1FromSqlite(sdb));
    await seedStockLegalPages(env, "stock-a");

    const links = await resolvePickedLegalPageLinks(env.DB, "stock-a", STOCK_PICKS);
    expect(links.map((l) => l.label)).toEqual([
      "Contact",
      "Do Not Sell My Personal Information",
      "Privacy Policy",
      "Terms of Service",
    ]);
    const hrefs = links.map((l) => l.href);
    expect(hrefs).toEqual(["/contact", "/do-not-sell", "/privacy-policy", "/terms"]);
    expect(new Set(hrefs).size, "every picked page must serve its OWN href").toBe(4);
    sdb.close();
  });

  it("the D2 semantic survives: the SAME saved pick set resolves per serving site", async () => {
    const sdb = createTestDb(DatabaseSync!);
    const env = buildEnv(d1FromSqlite(sdb));
    await seedStockLegalPages(env, "stock-a");
    // Site B publishes its OWN rows under the same slugs (a stock sibling) plus
    // one it renamed — so B's resolution must be B's rows, and the renamed one
    // must fall through the ladder rather than borrow A's.
    await createPage(env, { site_id: "stock-b", slug: "contact", title: "Contact B", page_type: "legal" });
    await createPage(env, { site_id: "stock-b", slug: "privacy-policy", title: "Privacy B", page_type: "legal" });
    await createPage(env, { site_id: "stock-b", slug: "terms", title: "Terms B", page_type: "legal" });

    const a = await resolvePickedLegalPageLinks(env.DB, "stock-a", STOCK_PICKS);
    const b = await resolvePickedLegalPageLinks(env.DB, "stock-b", STOCK_PICKS);
    expect(a.map((l) => l.href)).toEqual(["/contact", "/do-not-sell", "/privacy-policy", "/terms"]);
    // R2 P3 flake-fix — CONDUCTOR-ORDERED UPDATE of this expectation. It used
    // to read ["/contact", "/contact", "/privacy-policy", "/terms"], i.e. it
    // pinned the defect: B has no do-not-sell page, so that pick fell to the
    // page_type leg on B's THREE same-type rows and first-wins handed it
    // "/contact" — a second, distinct operator pick pointing at a page the
    // operator never picked. On a compliance surface a wrong link is an
    // invisible legal failure while a missing one is visible to the operator
    // in their own footer, so an AMBIGUOUS type now omits (no manual_url set
    // on these picks). The three B DOES publish still resolve by slug.
    expect(b.map((l) => l.href)).toEqual(["/contact", "/privacy-policy", "/terms"]);
    expect(new Set(b.map((l) => l.href)).size, "no two picks may share an href").toBe(b.length);
    // …and each surviving link still carries ITS OWN label→page pairing
    expect(b.map((l) => l.label)).toEqual(["Contact", "Privacy Policy", "Terms of Service"]);
    expect(
      b.some((l) => l.label === "Do Not Sell My Personal Information"),
      "the unresolvable pick is dropped, never pointed at another page",
    ).toBe(false);
    expect(b.every((l) => l.href.startsWith("/")), "never another site's absolute URL").toBe(true);
    sdb.close();
  });

  it("the page_type leg resolves ONLY when the type identifies ONE published row: ambiguous+no manual_url ⇒ omitted, ambiguous+manual_url ⇒ the manual URL, single row ⇒ resolves (the renamed-site case)", async () => {
    const sdb = createTestDb(DatabaseSync!);
    const env = buildEnv(d1FromSqlite(sdb));
    // stock-a: FOUR published rows share page_type 'legal' — the type cannot
    // identify a page. (This replaces the old "BACK-COMPAT … first-wins per
    // type" test, which asserted this exact ambiguous state resolved to
    // '/contact'. Conductor ruling: first-wins across same-type rows was a
    // coin flip on a legal link, not a resolution.)
    await seedStockLegalPages(env, "stock-a");
    const legacy: SiteBrandingLegalPagePick[] = [{ page_type: "legal", label: "Legal" }];
    expect(
      await resolvePickedLegalPageLinks(env.DB, "stock-a", legacy),
      "ambiguous + no manual_url ⇒ OMITTED (never a guessed compliance link)",
    ).toEqual([]);

    // the same ambiguous pick WITH an operator-supplied manual_url keeps a link
    expect(
      await resolvePickedLegalPageLinks(env.DB, "stock-a", [
        { page_type: "legal", label: "Legal", manual_url: "https://legal.example.com/notices" },
      ]),
    ).toEqual([{ label: "Legal", href: "https://legal.example.com/notices" }]);
    // …and the SAFE_HREF_RE gate still governs that fallback
    expect(
      await resolvePickedLegalPageLinks(env.DB, "stock-a", [
        { page_type: "legal", label: "Legal", manual_url: "javascript:alert(1)" },
      ]),
      "an unsafe manual_url is still refused, so the pick is omitted",
    ).toEqual([]);

    // stock-b publishes exactly ONE row of each type, under RENAMED slugs —
    // which is what site-provisioning now produces (legal-renderer.ts binds a
    // canonical page_type per page). The owner's renamed-site clause is
    // therefore preserved: a slug-less / foreign-slug pick still resolves.
    await createPage(env, { site_id: "stock-b", slug: "datenschutz", title: "Privacy B", page_type: "privacy-policy" });
    await createPage(env, { site_id: "stock-b", slug: "nutzungsbedingungen", title: "Terms B", page_type: "terms" });
    await createPage(env, { site_id: "stock-b", slug: "b-legal-notices", title: "Notices B", page_type: "legal" });
    expect(
      await resolvePickedLegalPageLinks(env.DB, "stock-b", [
        { page_type: "privacy-policy", slug: "privacy-policy", label: "Privacy Policy" },
        { page_type: "terms", slug: "terms", label: "Terms of Use" },
        { page_type: "legal", label: "Legal" },
      ]),
      "one row per type ⇒ the page_type leg still resolves each pick to ITS page",
    ).toEqual([
      { label: "Privacy Policy", href: "/datenschutz" },
      { label: "Terms of Use", href: "/nutzungsbedingungen" },
      { label: "Legal", href: "/b-legal-notices" },
    ]);

    // a draft sibling does not make a type ambiguous (only PUBLISHED rows count)
    await createPage(env, { site_id: "stock-b", slug: "datenschutz-entwurf", title: "Draft", page_type: "privacy-policy", status: "draft" });
    expect(
      await resolvePickedLegalPageLinks(env.DB, "stock-b", [{ page_type: "privacy-policy", label: "Privacy Policy" }]),
    ).toEqual([{ label: "Privacy Policy", href: "/datenschutz" }]);
    sdb.close();
  });

  it("a slug the serving site does NOT publish falls back to page_type, then manual_url, then omission", async () => {
    const sdb = createTestDb(DatabaseSync!);
    const env = buildEnv(d1FromSqlite(sdb));
    await createPage(env, { site_id: "stock-a", slug: "privacy-policy", title: "Privacy", page_type: "privacy-policy" });

    const links = await resolvePickedLegalPageLinks(env.DB, "stock-a", [
      // slug missing on this site, but its page_type is published → page_type leg
      { page_type: "privacy-policy", slug: "datenschutz", label: "Privacy" },
      // neither slug nor page_type here → the manual fallback
      { page_type: "accessibility", slug: "accessibility", label: "Accessibility", manual_url: "/a11y" },
      // nothing at all → omitted, never a dead link
      { page_type: "licenses", slug: "licenses", label: "Licenses" },
      // an unsafe manual fallback stays rejected
      { page_type: "evil", slug: "evil", label: "Evil", manual_url: "javascript:alert(1)" },
    ]);
    expect(links).toEqual([
      { label: "Privacy", href: "/privacy-policy" },
      { label: "Accessibility", href: "/a11y" },
    ]);
    sdb.close();
  });

  it("resolveSiteBranding's 3rd arg carries the slug identity end-to-end", async () => {
    const sdb = createTestDb(DatabaseSync!);
    const env = buildEnv(d1FromSqlite(sdb));
    await seedStockLegalPages(env, "stock-a");
    const branding = await resolveSiteBranding(env.DB, "stock-a", STOCK_PICKS);
    expect(branding.legal_links.map((l) => l.href)).toEqual(["/contact", "/do-not-sell", "/privacy-policy", "/terms"]);
    sdb.close();
  });

  it("the picker's row template carries the slug AND the stored pick shape validates it", () => {
    const panel = renderTemplatesTabPanel(true, []);
    expect(panel, "the picker row must carry the unique identity").toContain("data-footer-pick-slug");
    const cfg: Record<string, unknown> = {
      template: "centered",
      version: 1,
      footer: {
        blocks: [
          {
            type: "link_row",
            links_source: "picked",
            picks: [{ page_type: "legal", slug: "do-not-sell", label: "Do Not Sell" }],
          },
        ],
      },
    };
    const v = validateFrameConfig(cfg);
    expect(v.problems.filter((p) => p.severity === "error")).toEqual([]);
    expect(v.config).not.toBeNull();
  });
});

// ===========================================================================
// BLOCKER-1 — the editor hydrates from the SERVER's composition
// ===========================================================================

// Runs the REAL shipped island functions (sliced verbatim out of
// QUOTE_EDITOR_SCRIPT, never re-typed) in a node:vm sandbox.
function loadIsland(startMarker: string, endMarker: string, sandbox: Record<string, unknown>, expr: string): unknown {
  const start = QUOTE_EDITOR_SCRIPT.indexOf(startMarker);
  expect(start, `island must contain ${startMarker}`).toBeGreaterThan(-1);
  const end = QUOTE_EDITOR_SCRIPT.indexOf(endMarker, start);
  expect(end, `island must contain ${endMarker} after ${startMarker}`).toBeGreaterThan(start);
  const src = QUOTE_EDITOR_SCRIPT.slice(start, end);
  return runInNewContext(`${src}; ${expr}`, sandbox);
}

// The eight footer blocks a saved template contributes — the reviewer's repro
// shape (an applied saved template, frame_config_json still NULL).
const SAVED_TEMPLATE_FOOTER_BLOCKS = [
  { type: "heading", align: "left", html: "Equal Opportunity Notice", level: 4 },
  { type: "about_paragraph", align: "left", text: "Become does not discriminate.", html: "Become does not discriminate." },
  { type: "heading", align: "left", html: "Licensing &amp; Regulatory Status", level: 4 },
  { type: "about_paragraph", align: "left", text: "Become operates solely as a marketing lead generator.", html: "Become operates solely as a marketing lead generator." },
  { type: "list", align: "left", items: ["Not a security provider", "Not an installer"], list_style: "unordered" },
  { type: "link_row", align: "center", links_source: "manual", links: [{ label: "Terms And Conditions", href: "/terms" }] },
  { type: "disclosure", align: "center", text: "2026 Become - All Rights Reserved.", html: "2026 Become - All Rights Reserved." },
  { type: "logo", align: "center", logo_source: "site" },
];

describe("R2 P3 FIX-FIRST BLOCKER-1 — one benign save can never wipe the served footer", () => {
  // The server's OWN boot projection for the reviewer's exact state: apply-
  // template wrote frame_template_id only, so frame_config_json is NULL and
  // effective_frame is FRAME_TEMPLATES[].defaults + savedTemplateDefaults.
  function serverProjection(): EffectiveFrameConfig {
    const savedTemplateDefaults = {
      template: "centered",
      version: 1,
      footer: {
        enabled: true,
        typography_scope: { size: "s", font_family: "Inter" },
        blocks: SAVED_TEMPLATE_FOOTER_BLOCKS,
      },
    } as unknown as EffectiveFrameConfig;
    return effectiveFrame(null, undefined, undefined, savedTemplateDefaults).frame;
  }

  it("the server's boot projection carries the applied saved template's 8 blocks (the truth the visitor is served)", () => {
    expect(serverProjection().footer.blocks).toHaveLength(8);
  });

  // The island's REAL boot block (deepClone/deepMerge/templateDefaults/
  // currentTemplateId/hydrationBase/clientEffective, plus the workingFrame /
  // workingTheme / workingOverrides initialisation it depends on) sliced
  // verbatim and run over the SAME state shapes the SSR blob supplies.
  function runClientEffective(state: {
    frame_config: Record<string, unknown> | null;
    effective_frame: unknown;
    overrides?: Record<string, unknown>;
    templates: Array<{ id: string; label: string; defaults: Record<string, unknown> }>;
  }): Record<string, unknown> {
    const sandbox = {
      frameState: { frame_config: state.frame_config, effective_frame: state.effective_frame, template_defaults: {}, problems: [] },
      themeState: { theme: null, effective_tokens: {}, problems: [] },
      lgData: { overrides: state.overrides ?? {} },
      slideList: [],
      templates: state.templates,
      editorArmOwnsTarget: () => true,
      themeOverrideActive: () => false,
      shownOverridePalette: () => ({}),
    };
    return loadIsland("  function deepClone(v) {", "\n\n  // --- override routing", sandbox, "clientEffective()") as Record<
      string,
      unknown
    >;
  }

  // The built-in registry entry apply-template does NOT seed a footer from —
  // the ONLY layer the pre-fix hydration ever read.
  const REGISTRY = [{ id: "centered", label: "Centered", defaults: { header: { enabled: true }, footer: { enabled: true, blocks: [] } } }];

  it("ROOT: clientEffective() hydrates the editor from that SAME composition (fail-before: 0 blocks)", () => {
    const eff = runClientEffective({ frame_config: null, effective_frame: serverProjection(), templates: REGISTRY }) as {
      footer?: { blocks?: unknown[] };
    };
    expect(eff.footer?.blocks, "the editor must show what the visitor gets").toHaveLength(8);
  });

  it("ROOT: an in-session/stored edit still wins over the served composition (the editor is not frozen)", () => {
    // frame_config is what the island seeds workingFrame from — a funnel that
    // HAS authored its own footer must keep authoring it.
    const stored = { footer: { typography_scope: { size: "l" }, blocks: [{ type: "address", align: "left", text: "New" }] } };
    const eff = runClientEffective({ frame_config: stored, effective_frame: serverProjection(), templates: REGISTRY }) as {
      footer?: { blocks?: unknown[]; typography_scope?: { size?: string } };
    };
    expect(eff.footer?.blocks).toHaveLength(1);
    expect(eff.footer?.typography_scope?.size).toBe("l");
  });

  it("ROOT: with no server projection (legacy/blank state) the pre-fix registry-defaults base still applies", () => {
    const eff = runClientEffective({ frame_config: null, effective_frame: null, templates: REGISTRY }) as {
      footer?: { blocks?: unknown[] };
      header?: { enabled?: boolean };
    };
    expect(eff.header?.enabled).toBe(true);
    expect(eff.footer?.blocks).toEqual([]);
  });

  // --- the structural guard ------------------------------------------------
  // collectFooterBlocks() runs on EVERY footer-panel change, including
  // controls that own no blocks (the reviewer's repro was "Text size"). The
  // guard makes an accidental blank unreachable while leaving a DELIBERATE
  // empty-out intact.
  function loadCollector(rowCount: number, servedBlocks: unknown[]): {
    collect: () => unknown[];
    touch: () => void;
  } {
    const emptyRow = {
      querySelector: () => ({ value: "", checked: false, querySelector: () => null, querySelectorAll: () => [] }),
      querySelectorAll: () => [],
    };
    const rows = Array.from({ length: rowCount }, () => emptyRow);
    const sandbox = {
      frameState: { effective_frame: { footer: { blocks: servedBlocks } } },
      tplList: () => ({ querySelectorAll: () => rows }),
      deepClone: (v: unknown) => JSON.parse(JSON.stringify(v)),
    };
    const api = loadIsland(
      "  var footerBlocksTouched = false;",
      "\n  function addFooterPickRow(",
      sandbox,
      "({ collect: collectFooterBlocks, touch: touchFooterBlocks })",
    ) as { collect: () => unknown[]; touch: () => void };
    return api;
  }

  it("GUARD: an UNTOUCHED collect that yields [] keeps the served block set (fail-before: it returned [] and the save persisted it)", () => {
    const { collect } = loadCollector(0, SAVED_TEMPLATE_FOOTER_BLOCKS);
    expect(collect()).toHaveLength(8);
  });

  it("GUARD: after the operator touches the block list, an empty collect IS honoured (deliberate deletion still works)", () => {
    const { collect, touch } = loadCollector(0, SAVED_TEMPLATE_FOOTER_BLOCKS);
    touch();
    expect(collect()).toEqual([]);
  });

  it("GUARD: with nothing served, an empty collect stays empty (no phantom blocks invented)", () => {
    const { collect } = loadCollector(0, []);
    expect(collect()).toEqual([]);
  });

  it("GUARD: the non-block footer controls do NOT mark the list touched; a control INSIDE a block row does", () => {
    // The dispatcher's own predicate, verbatim from the shipped island.
    expect(QUOTE_EDITOR_SCRIPT).toContain(
      "if (panel === 'footer' && closestAttr(el, 'data-footer-block-row') !== null) { touchFooterBlocks(); }",
    );
    // …and every block-level mutation path marks it.
    for (const path of [
      "footerBlockTypeChanged(frow); touchFooterBlocks();",
      "data-footer-block-remove",
      "data-footer-block-up",
      "data-footer-block-down",
    ]) {
      expect(QUOTE_EDITOR_SCRIPT, `${path} must be a touch path`).toContain(path);
    }
  });
});

// ===========================================================================
// MAJOR-3 / MAJOR-4 / MAJOR-5 / MINOR-8 — the render + CSS axes
// ===========================================================================

const TOKENS = resolveTokens(defaultFunnelDesign);
const ROOT = {
  funnelId: "lgf_0000000000000000000P3FIX01",
  funnelVariantId: "lgn_0000000000000000000P3FIX02",
  quoteId: "lgq_0000000000000000000P3FIX03",
  contentVersion: 1,
};

function frameWithFooter(footer: Record<string, unknown>): EffectiveFrameConfig {
  const { frame, problems } = effectiveFrame("centered", { footer } as unknown as FrameConfig);
  expect(problems).toEqual([]);
  return frame;
}

function renderFooterHtml(frame: EffectiveFrameConfig, legalLinks: Array<{ label: string; href: string }> = []): string {
  const input: RenderQuoteFrameInput = {
    effectiveTokens: TOKENS,
    frame,
    siteBranding: {
      site_name: "Become",
      logo_url: "/media/logo.png",
      tagline: null,
      legal_links: legalLinks,
      trust_logos: null,
    },
    sectionsHtml: "",
    bannersMountHtml: LG_BANNERS_MOUNT_HTML,
    sectionCount: 2,
    root: ROOT,
  };
  return renderQuoteFrame(input);
}

// The SAME chrome CSS the served shell embeds (frameRegions: true).
const CSS = funnelChromeCss(defaultFunnelDesign, `[data-lg-design="default-funnel"]`, { frameRegions: true });

describe("R2 P3 FIX-FIRST MAJOR-3 — the per-block alignment control is honoured", () => {
  it("frame.ts emits data-align for every block type (unchanged) AND the CSS now matches it", () => {
    const html = renderFooterHtml(
      frameWithFooter({
        enabled: true,
        blocks: [
          { type: "about_paragraph", align: "left", text: "Left body" },
          { type: "heading", align: "left", html: "Left heading", level: 4 },
          { type: "list", align: "left", items: ["one"], list_style: "unordered" },
          { type: "address", align: "left", text: "1 Main St" },
          { type: "disclosure", align: "center", text: "Centered note" },
        ],
      }),
    );
    expect((html.match(/data-align="left"/g) ?? []).length).toBe(4);
    expect((html.match(/data-align="center"/g) ?? []).length).toBe(1);
    for (const cls of ["about", "heading", "list", "address", "disclosure", "logo"]) {
      expect(CSS, `${cls} must honour data-align=left`).toContain(`.lg-frame-footer2-${cls}[data-align="left"]`);
      expect(CSS, `${cls} must honour data-align=right`).toContain(`.lg-frame-footer2-${cls}[data-align="right"]`);
    }
    // the two FLEX rows take justify-content, not text-align
    expect(CSS).toContain(`.lg-frame-footer2-links[data-align="left"]`);
    expect(CSS).toContain(`.lg-frame-footer2-socials[data-align="right"]`);
    expect(CSS).toMatch(/\.lg-frame-footer2-links\[data-align="left"\][^{]*\{justify-content:flex-start\}/);
    expect(CSS).toMatch(/\.lg-frame-footer2-links\[data-align="center"\][^{]*\{justify-content:center\}/);
  });

  it("a left-aligned block and a centered sibling get DIFFERENT declarations (the regression the review named)", () => {
    const left = CSS.match(/\.lg-frame-footer2-about\[data-align="left"\][^{]*\{([^}]*)\}/);
    const center = CSS.match(/\.lg-frame-footer2-about\[data-align="center"\][^{]*\{([^}]*)\}/);
    expect(left?.[1]).toContain("text-align:left");
    expect(center?.[1]).toContain("text-align:center");
  });
});

describe("R2 P3 FIX-FIRST MAJOR-4 — the new block types ship with CSS", () => {
  it("list / heading / logo-img each have their OWN rule", () => {
    expect(CSS).toContain(".lg-frame-footer2-list{");
    expect(CSS).toContain(".lg-frame-footer2-heading{");
    expect(CSS).toContain(".lg-frame-footer2-logo-img{");
  });

  it("the list is readable centred AND left-aligned: markers ride with the text, no UA 40px indent", () => {
    const rule = CSS.match(/\.lg-frame-footer2-list\{([^}]*)\}/)?.[1] ?? "";
    expect(rule).toContain("list-style-position:inside");
    expect(rule).toContain("padding-left:0");
  });

  it("a manual footer logo is CONSTRAINED (MINOR-7: a 2000px asset can no longer blow the band out)", () => {
    const rule = CSS.match(/\.lg-frame-footer2-logo-img\{([^}]*)\}/)?.[1] ?? "";
    expect(rule).toMatch(/max-height:/);
    expect(rule).toContain("max-width:100%");
    const html = renderFooterHtml(
      frameWithFooter({
        enabled: true,
        blocks: [{ type: "logo", align: "center", logo_source: "manual", logo_url: "https://cdn.example.com/2000px.png", logo_alt: "Become" }],
      }),
    );
    expect(html).toContain('class="lg-frame-footer2-logo-img"');
  });

  it("the heading scales with the footer's OWN typography scope (em, not a page-level rem)", () => {
    const rule = CSS.match(/\.lg-frame-footer2-heading\{([^}]*)\}/)?.[1] ?? "";
    expect(rule).toMatch(/font-size:[0-9.]+em/);
    expect(rule).toContain("font-weight:600");
  });
});

describe("R2 P3 FIX-FIRST MAJOR-5 + MINOR-8 — the footer's own link axes (Image45 underline, Image28 separators)", () => {
  it("default (axis off) is byte-identical: no custom property, and the rule falls back to none", () => {
    const html = renderFooterHtml(frameWithFooter({ enabled: true, blocks: [{ type: "link_row", align: "center", links_source: "manual", links: [{ label: "Terms", href: "/terms" }] }] }));
    expect(html).not.toContain("--lg-footer-link-decoration");
    expect(CSS).toContain("text-decoration:var(--lg-footer-link-decoration,none)");
  });

  it("link_underline:true emits the property, so the anchors compute text-decoration: underline", () => {
    const html = renderFooterHtml(
      frameWithFooter({
        enabled: true,
        link_underline: true,
        blocks: [{ type: "link_row", align: "center", links_source: "manual", links: [{ label: "Terms And Conditions", href: "/terms" }] }],
      }),
    );
    expect(html).toContain("--lg-footer-link-decoration:underline");
  });

  it("link_separator renders BETWEEN anchors only — never leading, trailing, or inside a link", () => {
    const html = renderFooterHtml(
      frameWithFooter({
        enabled: true,
        link_separator: " | ",
        blocks: [{ type: "link_row", align: "center", links_source: "site" }],
      }),
      [
        { label: "Privacy Policy", href: "/privacy-policy" },
        { label: "Your Privacy Choices", href: "/do-not-sell" },
        { label: "Terms of Use", href: "/terms" },
      ],
    );
    const row = html.slice(html.indexOf('class="lg-frame-footer2-links"'));
    const rowEnd = row.slice(0, row.indexOf("</div>"));
    expect((rowEnd.match(/lg-frame-footer2-link-sep/g) ?? []).length, "n links → n-1 separators").toBe(2);
    expect(rowEnd).not.toMatch(/<div[^>]*><span class="lg-frame-footer2-link-sep"/);
    expect(rowEnd.endsWith("</a>")).toBe(true);
    expect(rowEnd).toContain('aria-hidden="true"');
  });

  it("the separator is ESCAPED, never a markup sink", () => {
    const html = renderFooterHtml(
      frameWithFooter({
        enabled: true,
        link_separator: '<img src=x onerror=alert(1)>',
        blocks: [{ type: "link_row", align: "center", links_source: "site" }],
      }),
      [
        { label: "A", href: "/a" },
        { label: "B", href: "/b" },
      ],
    );
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("both axes validate through the REAL frame validator and round-trip effectiveFrame", () => {
    const v = validateFrameConfig({ template: "centered", version: 1, footer: { link_underline: true, link_separator: " | " } });
    expect(v.problems.filter((p) => p.severity === "error")).toEqual([]);
    const frame = frameWithFooter({ enabled: true, link_underline: true, link_separator: " | " });
    expect(frame.footer.link_underline).toBe(true);
    expect(frame.footer.link_separator).toBe(" | ");
  });
});

// ===========================================================================
// MINOR-6 / MINOR-9 / MINOR-10 / MINOR-13
// ===========================================================================

describe("R2 P3 FIX-FIRST minors", () => {
  const panel = renderTemplatesTabPanel(true, []);

  it("MINOR-6: the heading LEVEL is authorable, hydrated, collected, and rendered", () => {
    expect(panel).toContain("data-footer-block-level");
    expect(QUOTE_EDITOR_SCRIPT).toContain("var levelEl = r.querySelector('[data-footer-block-level]');");
    expect(QUOTE_EDITOR_SCRIPT).toContain("block.level = Number(levelEl.value);");
    const html = renderFooterHtml(
      frameWithFooter({ enabled: true, blocks: [{ type: "heading", align: "left", html: "Equal Opportunity Notice", level: 2 }] }),
    );
    expect(html).toContain('<h2 class="lg-frame-footer2-heading"');
  });

  it("MINOR-9: a rich-text block stores markup ONLY in html; text keeps the plain projection", () => {
    // the shipped island's own rule, both twins
    expect(QUOTE_EDITOR_SCRIPT).toContain("block.text = hasHtml ? plainFromMarkup(text) : text;");
    const strip = runInNewContext(
      `${QUOTE_EDITOR_SCRIPT.slice(
        QUOTE_EDITOR_SCRIPT.indexOf("  function plainFromMarkup(s)"),
        QUOTE_EDITOR_SCRIPT.indexOf("\n", QUOTE_EDITOR_SCRIPT.indexOf("  function plainFromMarkup(s)")),
      )}; plainFromMarkup;`,
      {},
    ) as (s: string) => string;
    expect(strip("<strong>Bold</strong> and <a href=\"/x\">link</a>")).toBe("Bold and link");
    // address (no html field) still stores exactly what was typed
    expect(strip("1 Main St")).toBe("1 Main St");
  });

  it("MINOR-10: logo_media_id is SAFE_HREF-gated at render, closing the asymmetry with logo_url", () => {
    // mediaUrl() returns an already-rooted/absolute/`data:` ref UNCHANGED (its
    // own documented contract), so before this fix a logo_media_id could put a
    // data: URI straight into an <img src> while its sibling logo_url could
    // not — the exact one-sided-gate asymmetry R2 minor-6 forbids.
    expect(
      renderFooterHtml(
        frameWithFooter({
          enabled: true,
          blocks: [
            { type: "logo", align: "center", logo_source: "manual", logo_media_id: "data:text/html;base64,PHN2Zz4=", logo_alt: "x" },
          ],
        }),
      ),
      "an unsafe media ref must never reach an img src",
    ).not.toContain("data:text/html");
    // a real media id still resolves
    expect(
      renderFooterHtml(
        frameWithFooter({
          enabled: true,
          blocks: [{ type: "logo", align: "center", logo_source: "manual", logo_media_id: "sites/a/logo.png", logo_alt: "Become" }],
        }),
      ),
    ).toContain('class="lg-frame-footer2-logo-img"');
  });

  it("MINOR-13: the rich toolbar's Link button is a studio MODAL, never window.prompt", () => {
    expect(panel, "the modal must ship with the panel").toContain('id="lg-link-modal"');
    expect(panel).toContain('role="dialog"');
    expect(panel).toContain('aria-modal="true"');
    expect(panel).toContain("data-link-modal-cancel");
    expect(panel).toContain("data-link-modal-confirm");
    expect(panel).toContain('id="lg-link-modal-error"');
    // the toolbar path no longer calls a browser dialog at all
    expect(QUOTE_EDITOR_SCRIPT).toContain("if (fmt === 'link') { openLinkModal(ta, after); return; }");
    expect(QUOTE_EDITOR_SCRIPT).not.toContain("window.prompt('Link address");
  });

  it("MINOR-13: the modal's inline-error gate is a REAL working regex in the SHIPPED island source", () => {
    // The island is emitted from a TS template literal, so an under-escaped
    // regex literal ships BROKEN (a bare \/ collapses to / and terminates the
    // literal — it took the whole island down). Execute the shipped line.
    const at = QUOTE_EDITOR_SCRIPT.indexOf("  var SAFE_HREF_CLIENT =");
    expect(at, "the modal's href gate must exist in the shipped island").toBeGreaterThan(-1);
    const line = QUOTE_EDITOR_SCRIPT.slice(at, QUOTE_EDITOR_SCRIPT.indexOf("\n", at));
    const re = runInNewContext(`${line}; SAFE_HREF_CLIENT;`, {}) as RegExp;
    for (const ok of ["https://example.com/x", "http://x.io", "/privacy-policy", "#top", "tel:+1555", "mailto:a@b.c"]) {
      expect(re.test(ok), `${ok} must be accepted`).toBe(true);
    }
    for (const bad of ["javascript:alert(1)", "data:text/html;base64,x", "//evil.example.com", "vbscript:x"]) {
      expect(re.test(bad), `${bad} must be rejected`).toBe(false);
    }
  });

  it("the island stays plain ES5 (no arrow functions, no const/let) — the file's own invariant", () => {
    expect(QUOTE_EDITOR_SCRIPT).not.toMatch(/=>/);
    expect(QUOTE_EDITOR_SCRIPT).not.toMatch(/\b(const|let)\s/);
  });
});
