// LeadGen redesign-contract-v3.1 §10 — the Themes MANAGER page (Phase D).
// Covers: the pure usage-scan/classification helpers (no DB), the live D1
// scan (real 0036-0041 migrations via the node:sqlite harness — the
// leadgen-v31-themes-integration.test.ts pattern), and the full-page render
// through the REAL admin router (§10.3 three-column layout, the LIVE·A /
// A/B·B / DRAFT badges, the §10.5 A/B panel + fixture-value rule, Appendix A
// string assertions, the §10.4 "no Spacing control" rule, and strict-ES5
// verification of the inline island).
//
// Seeding rides the REAL admin HTTP API only (POST /quotes, /themes,
// /funnels/:id/variants, PUT /funnels/:id/theme, PUT /variants/:id) — no
// direct DB writes, mirroring every other leadgen-*-ui.test.ts file.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import admin from "../src/admin/router";
import { mintPublicId } from "../src/leadgen/ids";
import type { Env } from "../src/env";
import type { ThemeRecord } from "../src/public/leadgen/designs/theme";
import {
  THEME_MGR_SCRIPT,
  otherFunnelsUsing,
  primaryUsage,
  scanVariantThemeUsage,
  themeUseLine,
  usageBadgeKind,
  usageBadgeText,
  usageForTheme,
  variantsForFunnel,
  type VariantThemeUsage,
} from "../src/admin/leadgen/ui-theme-manager";

// --- node:sqlite harness (repo pattern — duplicated per test file) ---------

type SqliteStatement = { run(...p: unknown[]): unknown; get(...p: unknown[]): unknown; all(...p: unknown[]): unknown[] };
type SqliteDb = { prepare(sql: string): SqliteStatement; close(): void; [m: string]: unknown };
type DatabaseSyncCtor = new (path: string) => SqliteDb;

function loadDatabaseSync(): DatabaseSyncCtor | null {
  try {
    const { createRequire } = require("node:module") as typeof import("node:module");
    const nodeRequire = createRequire(import.meta.url);
    return (nodeRequire("node:sqlite") as { DatabaseSync: DatabaseSyncCtor }).DatabaseSync;
  } catch {
    try {
      const getBuiltin = (process as unknown as { getBuiltinModule?: (n: string) => unknown }).getBuiltinModule;
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
          return { success: true, meta: { changes: Number(r?.changes ?? 0), last_row_id: Number(r?.lastInsertRowid ?? 0) } };
        },
      };
      return stmt;
    },
    async batch(statements: Array<{ run(): Promise<unknown> }>) {
      runSql(sdb, "BEGIN");
      const out: unknown[] = [];
      try {
        for (const s of statements) out.push(await s.run());
        runSql(sdb, "COMMIT");
      } catch (err) {
        runSql(sdb, "ROLLBACK");
        throw err;
      }
      return out;
    },
  } as unknown as D1Database;
  return db;
}

function makeKvStub(): KVNamespace {
  const store = new Map<string, string>();
  return {
    async get(key: string): Promise<string | null> {
      return store.has(key) ? store.get(key)! : null;
    },
    async put(key: string, value: string): Promise<void> {
      store.set(key, value);
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
// Rework P1 coherence sweep (conductor-consolidated round): brought
// current through 0053 (was stale) so this harness's D1 schema matches
// the real Wave-1 shape (handlers now write M1/M2/M4/M5 columns/tables
// this file's schema never had).
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

function createDb(DatabaseSync: DatabaseSyncCtor): SqliteDb {
  const sdb = new DatabaseSync(":memory:");
  runSql(
    sdb,
    "CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT);CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT);",
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
  } as unknown as Env;
}

const DatabaseSync = loadDatabaseSync();
const describeDb = DatabaseSync === null ? describe.skip : describe;

function newHarness(): { sdb: SqliteDb; env: Env } {
  const sdb = createDb(DatabaseSync as DatabaseSyncCtor);
  return { sdb, env: buildEnv(d1FromSqlite(sdb), makeKvStub()) };
}

const API = "/api/admin/leadgen";

function jsonInit(method: string, body?: unknown): RequestInit {
  return body === undefined
    ? { method }
    : { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

async function json<T>(res: Response, label: string): Promise<T> {
  const body = (await res.json()) as T;
  expect(res.status, `${label}: ${JSON.stringify(body)}`).toBeLessThan(300);
  return body;
}

interface QuoteCreateResponse {
  public_id: string;
  funnels: Array<{ public_id: string; variants: Array<{ public_id: string }> }>;
}
interface FunnelCreateResponse {
  public_id: string;
  variants: Array<{ public_id: string }>;
}
interface ThemeCreateResponse {
  item: ThemeRecord;
}

function themeBody(name: string, brand: string, accent: string, pageBg: string, card: string, text: string): Record<string, unknown> {
  return {
    name,
    roles: { brand_primary: brand, accent, page_bg: pageBg, card, text, success: "#0E7C3A", error: "#B23A2C" },
    typography: { headline_font: "Newsreader", body_font: "Inter", base_px: 16 },
    controls: { field_height: "medium", button_size: "m", corners: "rounded" },
  };
}

// One quote -> "Auto Insurance" funnel (control Variant A + a second Variant
// B) -> a second "Home Insurance" funnel (its own control Variant A) -> three
// themes (Navy/Bold Yellow/Minimal), matching the §1.2/§10.3 fixture:
//   Navy       -> Auto Insurance/Variant A (control, 60%) AND Home Insurance/Variant A -> LIVE · A
//   Bold Yellow-> Auto Insurance/Variant B (non-control, 40%)                          -> A/B · B
//   Minimal    -> unused                                                              -> DRAFT
async function seedFixture(sdb: SqliteDb, env: Env): Promise<{
  navy: ThemeRecord;
  bold: ThemeRecord;
  minimal: ThemeRecord;
  autoFunnelId: string;
  homeFunnelId: string;
  variantAId: string;
  variantBId: string;
}> {
  const navy = (
    await json<ThemeCreateResponse>(
      await admin.request(`${API}/themes`, jsonInit("POST", themeBody("Navy", "#1B3A5C", "#F5C518", "#F4F6F9", "#FFFFFF", "#1A1F36")), env),
      "create navy",
    )
  ).item;
  const bold = (
    await json<ThemeCreateResponse>(
      await admin.request(`${API}/themes`, jsonInit("POST", themeBody("Bold Yellow", "#13233B", "#F5C518", "#FFF7DE", "#FFFFFF", "#14181F")), env),
      "create bold",
    )
  ).item;
  const minimal = (
    await json<ThemeCreateResponse>(
      await admin.request(`${API}/themes`, jsonInit("POST", themeBody("Minimal", "#232A34", "#6B7486", "#FFFFFF", "#F6F8FA", "#14181F")), env),
      "create minimal",
    )
  ).item;

  const quote = await json<QuoteCreateResponse>(
    await admin.request(
      `${API}/quotes`,
      jsonInit("POST", { quote_name: "Themes Manager Fixture", activity: "quote_funnel", verticals: ["auto"], funnel_name: "Auto Insurance" }),
      env,
    ),
    "create quote",
  );
  const autoFunnelId = quote.funnels[0]!.public_id;
  const variantAId = quote.funnels[0]!.variants[0]!.public_id;

  // Rework M1 (§4.3-10): POST /funnels/:id/variants (createVariantUnderFunnel)
  // now unconditionally refuses a 2nd active variant — see
  // leadgen-quotes-api.test.ts's Σ-gate test for the full rationale. This
  // fixture just needs a 2nd variant with a different theme override to
  // exist, so it's seeded via raw SQL (leadgen-rework-handlers.test.ts's own
  // equal-arms idiom) instead.
  const autoFunnelRowId = (sdb.prepare("SELECT id FROM leadgen_funnels WHERE public_id = ?").get(autoFunnelId) as { id: number }).id;
  const variantBId = mintPublicId("funnel_variant");
  sdb
    .prepare(
      "INSERT INTO leadgen_funnel_variants (public_id, funnel_id, variant_label, traffic_allocation_bp, funnel_design_id, status) VALUES (?, ?, 'B', 10000, 'default', 'active')",
    )
    .run(variantBId, autoFunnelRowId);

  await json(
    await admin.request(`${API}/funnels/${autoFunnelId}/theme`, jsonInit("PUT", { theme_json: { theme_id: navy.id } }), env),
    "set funnel theme",
  );
  await json(await admin.request(`${API}/variants/${variantAId}`, jsonInit("PUT", { traffic_allocation_bp: 6000 }), env), "set variant A split");
  await json(
    await admin.request(
      `${API}/variants/${variantBId}`,
      jsonInit("PUT", { traffic_allocation_bp: 4000, frame_overrides_json: { theme_id: bold.id } }),
      env,
    ),
    "set variant B split+theme",
  );

  const homeFunnel = await json<FunnelCreateResponse>(
    await admin.request(`${API}/quotes/${quote.public_id}/funnels`, jsonInit("POST", { funnel_name: "Home Insurance" }), env),
    "create home insurance funnel",
  );
  await json(
    await admin.request(`${API}/funnels/${homeFunnel.public_id}/theme`, jsonInit("PUT", { theme_json: { theme_id: navy.id } }), env),
    "set home funnel theme",
  );

  return { navy, bold, minimal, autoFunnelId, homeFunnelId: homeFunnel.public_id, variantAId, variantBId };
}

async function getHtml(env: Env, path: string): Promise<{ status: number; html: string }> {
  const res = await admin.request(path, {}, env);
  return { status: res.status, html: await res.text() };
}

// ===========================================================================
// 1. Pure classification helpers (no DB)
// ===========================================================================

describe("theme manager — pure usage classification (§10.5)", () => {
  const live: VariantThemeUsage = {
    funnelId: 1, funnelPublicId: "lgf_1", funnelName: "Auto Insurance",
    variantLabel: "A", isControl: true, trafficAllocationBp: 6000, themeId: "thm_navy",
  };
  const ab: VariantThemeUsage = {
    funnelId: 1, funnelPublicId: "lgf_1", funnelName: "Auto Insurance",
    variantLabel: "B", isControl: false, trafficAllocationBp: 4000, themeId: "thm_bold",
  };
  const otherLive: VariantThemeUsage = {
    funnelId: 2, funnelPublicId: "lgf_2", funnelName: "Home Insurance",
    variantLabel: "A", isControl: true, trafficAllocationBp: 10000, themeId: "thm_navy",
  };
  const all = [live, ab, otherLive];

  it("usageForTheme filters by theme id", () => {
    expect(usageForTheme(all, "thm_navy")).toEqual([live, otherLive]);
    expect(usageForTheme(all, "thm_minimal")).toEqual([]);
  });

  it("badge kind: live beats ab beats draft", () => {
    expect(usageBadgeKind(usageForTheme(all, "thm_navy"))).toBe("live");
    expect(usageBadgeKind(usageForTheme(all, "thm_bold"))).toBe("ab");
    expect(usageBadgeKind(usageForTheme(all, "thm_minimal"))).toBe("draft");
  });

  it("badge text — Appendix A 'LIVE · A' / 'A/B · B' / 'DRAFT'", () => {
    expect(usageBadgeText(usageForTheme(all, "thm_navy"))).toBe("LIVE · A");
    expect(usageBadgeText(usageForTheme(all, "thm_bold"))).toBe("A/B · B");
    expect(usageBadgeText(usageForTheme(all, "thm_minimal"))).toBe("DRAFT");
  });

  it("themeUseLine — Appendix A remainder strings", () => {
    expect(themeUseLine(usageForTheme(all, "thm_navy"))).toBe("Assigned to Auto Insurance · Variant A");
    expect(themeUseLine(usageForTheme(all, "thm_bold"))).toBe("Assigned to Auto Insurance · Variant B · A/B test");
    expect(themeUseLine(usageForTheme(all, "thm_minimal"))).toBe("Not assigned to a funnel yet");
  });

  it("primaryUsage prefers the control/live match over an A/B match", () => {
    const mixed = [ab, live]; // ab listed first — live must still win
    expect(primaryUsage(mixed)).toBe(live);
  });

  it("variantsForFunnel returns every active variant of one funnel", () => {
    expect(variantsForFunnel(all, 1)).toEqual([live, ab]);
    expect(variantsForFunnel(all, 2)).toEqual([otherLive]);
  });

  it("otherFunnelsUsing excludes the primary funnel and dedupes per funnel", () => {
    const others = otherFunnelsUsing(all, "thm_navy", 1);
    expect(others).toEqual([otherLive]);
    expect(otherFunnelsUsing(all, "thm_navy", 2)).toEqual([live]);
    expect(otherFunnelsUsing(all, "thm_bold", 1)).toEqual([]);
  });
});

// ===========================================================================
// 2. scanVariantThemeUsage against real D1 (0036-0041 migrations)
// ===========================================================================

describeDb("theme manager — scanVariantThemeUsage over real D1 (§10.1/§10.5)", () => {
  it("resolves the funnel-level default AND the variant-level A/B override, active-only", async () => {
    const { sdb, env } = newHarness();
    const fx = await seedFixture(sdb, env);

    const usage = await scanVariantThemeUsage(env.DB);
    const auto = usage.filter((u) => u.funnelPublicId === fx.autoFunnelId);
    expect(auto).toHaveLength(2);
    const a = auto.find((u) => u.variantLabel === "A")!;
    const b = auto.find((u) => u.variantLabel === "B")!;
    expect(a.themeId).toBe(fx.navy.id);
    expect(a.isControl).toBe(true);
    expect(a.trafficAllocationBp).toBe(6000);
    expect(b.themeId).toBe(fx.bold.id);
    expect(b.isControl).toBe(false);
    expect(b.trafficAllocationBp).toBe(4000);

    const home = usage.filter((u) => u.funnelPublicId === fx.homeFunnelId);
    expect(home).toHaveLength(1);
    expect(home[0]!.themeId).toBe(fx.navy.id);
    expect(home[0]!.variantLabel).toBe("A");
  });

  it("excludes archived funnels and archived variants from the live scan", async () => {
    const { env, sdb } = newHarness();
    const fx = await seedFixture(sdb, env);
    sdb.prepare("UPDATE leadgen_funnel_variants SET status = 'archived' WHERE public_id = ?").run(fx.variantBId);

    const usage = await scanVariantThemeUsage(env.DB);
    const auto = usage.filter((u) => u.funnelPublicId === fx.autoFunnelId);
    expect(auto).toHaveLength(1);
    expect(auto[0]!.variantLabel).toBe("A");
  });
});

// ===========================================================================
// 3. Full-page render — GET /admin/leadgen/themes
// ===========================================================================

describeDb("GET /admin/leadgen/themes — full page (§10.2/§10.3, Appendix A)", () => {
  it("renders the top bar, LEFT list with computed badges, defaults to the FIRST theme", async () => {
    const { sdb, env } = newHarness();
    const fx = await seedFixture(sdb, env);

    const { status, html } = await getHtml(env, "/admin/leadgen/themes?from=lgs_zip123");
    expect(status).toBe(200);

    // Top bar (Appendix A "Themes manager")
    expect(html).toContain("Back to section");
    expect(html).toContain('href="/admin/leadgen/sections/lgs_zip123/edit"');
    expect(html).toContain(">Themes<");
    expect(html).toContain("one look &amp; feel per funnel · A/B-testable in a quote");
    expect(html).toContain("New theme");

    // LEFT list — one card per theme, verbatim badges
    expect(html).toContain("Your themes");
    expect(html).toContain(">Navy<");
    expect(html).toContain(">Bold Yellow<");
    expect(html).toContain(">Minimal<");
    expect(html).toContain("LIVE · A");
    expect(html).toContain("A/B · B");
    expect(html).toContain(">DRAFT<");
    expect(html).toContain("A/B testing:");

    // Defaults to Navy (first created) as selected — its CENTER themeUse line
    expect(html).toContain("Assigned to Auto Insurance · Variant A");
    expect(fx.minimal.name).toBe("Minimal"); // fixture sanity (Minimal exists, unselected here)
  });

  it("CENTER editor: Colors/Typography/Buttons&Inputs sections, NO Spacing control", async () => {
    const { sdb, env } = newHarness();
    await seedFixture(sdb, env);

    const { html } = await getHtml(env, "/admin/leadgen/themes");
    expect(html).toContain("Colors — semantic roles");
    expect(html).toContain("Brand primary");
    expect(html).toContain("Accent");
    expect(html).toContain("Page background");
    expect(html).toContain(">Card<");
    expect(html).toContain(">Text<");
    expect(html).toContain(">Success<");
    expect(html).toContain("Typography");
    expect(html).toContain("Headline font");
    expect(html).toContain("Body font");
    expect(html).toContain("Buttons &amp; inputs — the shared size language");
    expect(html).toContain("Field height");
    expect(html).toContain("Button size");
    expect(html).toContain("Corners");
    expect(html).toContain(
      "Every question inherits these. A section can override a single field on its canvas — that field then shows as ",
    );
    expect(html).toMatch(/>Custom<\/b>\./);
    expect(html).toContain("Advanced — exact hex &amp; tokens");
    expect(html).not.toMatch(/>\s*Spacing\s*</);
    expect(html).not.toContain("Cozy");
  });

  // R2 P8-3 M2/S3.11 RE-MINT — four of these six sublabels changed. PRECEDENCE:
  // P8-DEFECT-CONTRACT.md wins over v3.1's Appendix A string list, and its §4 R3
  // corollary is "a control that cannot be honoured must not be offered", so a
  // pinned sublabel naming a surface the role provably does not paint is a pin
  // encoding a defect. Verdict PER STRING (source of truth: the real
  // resolveTokens+funnelChromeCss audit in test/leadgen-p8-m2-role-usedby.test.ts,
  // plus the token literals cited below from designs/default-funnel/tokens.ts and
  // designs/theme.ts ROLE_TO_BASE_TOKEN):
  //
  //  1. brand_primary "buttons · progress · selected" -> "buttons · focus ring".
  //     THE OLD TEXT WAS FALSE. brand_primary writes exactly ONE token,
  //     `color.primary` (theme.ts:90). `progress.fillColor` is the frozen
  //     literal "linear-gradient(90deg,#1B3A5C,#2A5080)" and
  //     `iconCard.selectedBorderColor` is the frozen literal "#1B3A5C" (the
  //     SAME hex as color.primary by coincidence, not by wiring) — no applier
  //     ever rewrites either, so authoring this role moved neither surface.
  //  2. accent "highlights · recommended" — UNCHANGED, still true, still pinned.
  //  3. page_bg "behind the card" -> "frame background". THE OLD TEXT WAS NOT
  //     FALSE: page_background paints the scope root's own background-color,
  //     which is indeed behind the card. This one is a CONVERGENCE re-mint, not
  //     a lie correction — the manager and the funnel-theme rail must not
  //     describe the same role with different words, which
  //     leadgen-p8-m2-role-usedby.test.ts I4 now pins; "frame background" is
  //     the rail's (audited) wording for the same surface.
  //  4. card "question surface" -> "question card · answer cards". The old text
  //     was true but INCOMPLETE: card_background also paints
  //     `.lg-btn.lg-btn-answer`'s resting background, not only
  //     `.lg-question-card`. Same I4 convergence; strictly more of the truth.
  //  5. text "headings &amp; body" -> "body text · input text". THE OLD TEXT WAS
  //     HALF FALSE: text_primary writes only `page.textColor` ("#1A1F36");
  //     `headline.color` is a DIFFERENT frozen literal ("#16324f") that no
  //     applier rewrites, so "headings" never moved with this role.
  //  6. success "reassurance · valid" — UNCHANGED, still true, still pinned.
  //
  // NOT WEAKENED: the four re-minted strings are pinned as the FULL sublabel
  // text (previously three of them were partial substrings), so this leg now
  // constrains more bytes than it did before.
  it("role sublabels + role note + size-language note render verbatim (Appendix A)", async () => {
    const { sdb, env } = newHarness();
    await seedFixture(sdb, env);
    const { html } = await getHtml(env, "/admin/leadgen/themes");
    expect(html).toContain("buttons · focus ring");
    expect(html).toContain("highlights · recommended");
    expect(html).toContain("frame background");
    expect(html).toContain("question card · answer cards");
    expect(html).toContain("body text · input text");
    expect(html).toContain("reassurance · valid");
    expect(html).toContain(
      "Components reference these roles, never fixed shades — change one here and every question in the funnel reskins.",
    );
  });

  it("Advanced discloses ALL 7 role hex chips as editable inputs, hidden by default", async () => {
    const { sdb, env } = newHarness();
    const fx = await seedFixture(sdb, env);
    const { html } = await getHtml(env, "/admin/leadgen/themes");
    expect(html).toContain(`brand ${fx.navy.roles.brand_primary}`);
    expect(html).toContain('id="tm-adv-body" hidden');
    for (const key of ["brand_primary", "accent", "page_bg", "card", "text", "success", "error"]) {
      expect(html).toContain(`data-role="${key}"`);
    }
  });

  it("selecting Bold Yellow via ?theme= shows the A/B badge + suffix + the SAME funnel's A/B box + no other funnels", async () => {
    const { sdb, env } = newHarness();
    const fx = await seedFixture(sdb, env);
    const { html } = await getHtml(env, `/admin/leadgen/themes?theme=${fx.bold.id}`);
    expect(html).toContain("Assigned to Auto Insurance · Variant B · A/B test");
    expect(html).toContain("In this quote");
    expect(html).toContain(">Auto Insurance<");
    expect(html).toContain("A/B test · Theme");
    expect(html).toContain(">Variant A<");
    expect(html).toContain(">Variant B<");
    expect(html).toContain("60%");
    expect(html).toContain("40%");
    expect(html).toContain(
      "Both variants share the same questions — only the theme differs. Promote the winner to 100% from the quote's",
    );
    expect(html).toContain("Other funnels using this theme");
    expect(html).toContain("No others yet.");
    expect(html).not.toContain("Home Insurance · Variant A");
  });

  it("selecting Navy shows 'Other funnels using this theme' -> Home Insurance · Variant A", async () => {
    const { sdb, env } = newHarness();
    const fx = await seedFixture(sdb, env);
    const { html } = await getHtml(env, `/admin/leadgen/themes?theme=${fx.navy.id}`);
    expect(html).toContain("Home Insurance · Variant A");
  });

  it("selecting the unused Minimal theme renders DRAFT + the empty-state copy, no crash", async () => {
    const { sdb, env } = newHarness();
    const fx = await seedFixture(sdb, env);
    const { status, html } = await getHtml(env, `/admin/leadgen/themes?theme=${fx.minimal.id}`);
    expect(status).toBe(200);
    expect(html).toContain("Not assigned to a funnel yet");
    expect(html).toContain("No others yet.");
  });

  it("an unknown ?theme= id falls back to the first theme rather than 404", async () => {
    const { sdb, env } = newHarness();
    await seedFixture(sdb, env);
    const { status, html } = await getHtml(env, "/admin/leadgen/themes?theme=thm_does_not_exist");
    expect(status).toBe(200);
    expect(html).toContain("Assigned to Auto Insurance · Variant A");
  });

  it("an empty theme store renders a 200 empty state, not a crash", async () => {
    const { sdb, env } = newHarness();
    const { status, html } = await getHtml(env, "/admin/leadgen/themes");
    expect(status).toBe(200);
    expect(html).toContain("Your themes");
    expect(html).toContain("Create a theme to get started.");
  });

  it("hostile theme name is escaped, never raw", async () => {
    const { sdb, env } = newHarness();
    await json(
      await admin.request(
        `${API}/themes`,
        jsonInit("POST", themeBody('<script>alert(1)</script>', "#111111", "#222222", "#ffffff", "#ffffff", "#000000")),
        env,
      ),
      "create hostile theme",
    );
    const { html } = await getHtml(env, "/admin/leadgen/themes");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });
});

// ===========================================================================
// 4. Strict ES5 — the inline island
// ===========================================================================

describe("theme manager — inline island is strict ES5", () => {
  it("contains no backticks, arrow functions, const/let, async/await, spread, or optional chaining", () => {
    expect(THEME_MGR_SCRIPT.includes("`")).toBe(false);
    expect(THEME_MGR_SCRIPT).not.toMatch(/=>/);
    expect(THEME_MGR_SCRIPT).not.toMatch(/\bconst\b/);
    expect(THEME_MGR_SCRIPT).not.toMatch(/\blet\b/);
    expect(THEME_MGR_SCRIPT).not.toMatch(/\basync\b/);
    expect(THEME_MGR_SCRIPT).not.toMatch(/\bawait\b/);
    expect(THEME_MGR_SCRIPT).not.toMatch(/\.\.\./);
    expect(THEME_MGR_SCRIPT).not.toMatch(/\?\./);
  });

  it("parses as a script (no syntax error) under Node's vm", async () => {
    const { runInNewContext } = await import("node:vm");
    const sandbox: Record<string, unknown> = {
      document: {
        getElementById: () => null,
        querySelectorAll: () => [],
      },
      fetch: () => Promise.resolve({ ok: true }),
      window: { location: { reload: () => {}, href: "" } },
    };
    expect(() => runInNewContext(THEME_MGR_SCRIPT, sandbox)).not.toThrow();
  });
});
