// LeadGen v2.5 Phase A — contract test `activation-preflight-v25`
// (redesign-contract-v2.5 14 §14.1–14.4, C2 PHASING):
//
//   * every 14 §14.1 check row FIRES with its contract severity on crafted
//     fixtures, surfaced through the ADDITIVE `problems[]` projection on the
//     preflight result;
//   * a LEGACY Quote (NULL frame/theme/overrides) yields ZERO new problems —
//     even with chrome-bearing / duplicate-continue / hex-override sections
//     (14 §14.4: every new check is conditional on the new data existing);
//   * the existing hard-409 block list is UNCHANGED by the new rows: a quote
//     with error-severity problems but zero blocks still ACTIVATES (200), and
//     activationBlockedReport carries exactly its historical keys (no
//     `problems` in the 409 body until Phase D).
//
// Plus the 03 §3.1 bump helper: bumpActiveVariantContentVersions bumps
// content_version on every ACTIVE variant of the funnel and only those.
//
// Row → fixture map (severity per the §14.1 table):
//   1  frame_config_json schema invalid            error    Quote A
//   2  theme_json invalid                          error    Quote A
//   3  variant frame_overrides_json invalid        error    Quote A
//   4  site logo unresolvable (logo_source=site)   warning  Quote B (PUT site)
//   5  frame_scope_component, compat OFF           error    Quote A · S1
//   6  frame_scope_component, compat ON            warning  Quote B · S3
//   7  duplicate Continue buttons                  warning  Quote A · S1
//   8  Section-local progress/back                 warning  Quote A · S1
//   9  bound headline missing + no visible one     warning  Quote A · S2
//   10 legacy hex literals in overrides (count)    warning  Quote A · S2
//   11 theme contrast lint (role pair named)       warning  Quote B
//   12 trust-strip logo missing alt                error    Quote A

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import admin from "../src/admin/router";
import type { Env } from "../src/env";
import { mintPublicId } from "../src/leadgen/ids";
import {
  activationBlockedReport,
  bumpActiveVariantContentVersions,
  computeQuoteActivationPreflight,
  type QuoteActivationPreflight,
} from "../src/admin/leadgen/quotes-handlers";
import type { Problem } from "../src/public/leadgen/designs/theme";
import type { LeadgenQuoteRow } from "../src/admin/leadgen/db-types";

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

// --- fixture seeding ----------------------------------------------------------

function seedSection(
  sdb: SqliteDb,
  opts: { headline?: string; contentJson: string; designOverridesJson?: string | null },
): { id: number; public_id: string } {
  const publicId = mintPublicId("section");
  sdb
    .prepare(
      "INSERT INTO leadgen_sections (public_id, section_name, activity, vertical, headline_text, content_json, continue_mode, design_overrides_json, address_validation_enabled, status) VALUES (?, ?, 'quote_funnel', 'life', ?, ?, 'button', ?, 0, 'active')",
    )
    .run(
      publicId,
      `Section ${publicId.slice(-4)}`,
      opts.headline ?? "Headline",
      opts.contentJson,
      opts.designOverridesJson ?? null,
    );
  const row = sdb.prepare("SELECT id FROM leadgen_sections WHERE public_id = ?").get(publicId) as {
    id: number;
  };
  return { id: row.id, public_id: publicId };
}

// S1 (Quote A): chrome (HeaderBar container + ProgressBar + BackButton) +
// TWO ContinueButtons + a visible headline. Fires rows 5 + 7 + 8.
const CHROME_DUP_CONTENT = JSON.stringify({
  components: [
    { type: "HeaderBar", question_id: "hb1", props: {}, children: [] },
    { type: "ProgressBar", question_id: "p1", props: { mode: "percent", percent: 20 } },
    { type: "BackButton", question_id: "b1", props: {} },
    { type: "QuestionHeadline", question_id: "h1", props: { text: "Insured?" } },
    {
      type: "TwoButtonYesNo",
      question_id: "q1",
      question_key: "k1",
      internal_field: "f1",
      answer_type: "boolean",
    },
    { type: "ContinueButton", question_id: "c1", props: { label: "Continue" } },
    { type: "ContinueButton", question_id: "c2", props: { label: "Next" } },
  ],
});

// S2 (Quote A): NO headline node at all + hex literals in BOTH override
// surfaces (1 node value + 1 section palette value = count 2). Rows 9 + 10.
const HEADLINELESS_HEX_CONTENT = JSON.stringify({
  components: [
    {
      type: "TwoButtonYesNo",
      question_id: "q2",
      question_key: "k2",
      internal_field: "f2",
      answer_type: "boolean",
      design_overrides: { buttonBackground: "#FF0000" },
    },
    { type: "ContinueButton", question_id: "c3", props: { label: "Continue" } },
  ],
});
const HEX_SECTION_OVERRIDES = JSON.stringify({ palette: { brand_primary: "#00FF00" } });

// S3 (Quote B): one chrome leaf under the compat-ON funnel. Row 6.
const CHROME_ONLY_CONTENT = JSON.stringify({
  components: [
    { type: "StepIndicator", question_id: "si1", props: { steps: 3, current: 1 } },
    { type: "QuestionHeadline", question_id: "h3", props: { text: "Where?" } },
    {
      type: "TwoButtonYesNo",
      question_id: "q3",
      question_key: "k3",
      internal_field: "f3",
      answer_type: "boolean",
    },
    { type: "ContinueButton", question_id: "c4", props: { label: "Continue" } },
  ],
});

// Quote A columns — structurally INVALID frame (unknown group + unsafe CTA
// href) + trust logo missing alt; INVALID theme (unknown role + bad scale);
// INVALID variant overrides (bad enum).
const INVALID_FRAME = JSON.stringify({
  version: 1,
  template: "centered",
  bogus_group: {},
  header: { cta: { enabled: true, label: "Call now", href: "javascript:alert(1)" } },
  trust_strip: {
    enabled: true,
    source: "manual",
    logos: [{ media_id: "logos/acme.png", alt: "" }],
    placement: "below_unit",
    mobile: "wrap",
  },
});
const INVALID_THEME = JSON.stringify({
  version: 1,
  palette: { not_a_role: "#123456" },
  scales: { radius: "circle" },
});
const INVALID_OVERRIDES = JSON.stringify({ header: { logo_size: "xxl" } });

// Quote B columns — VALID frame with the Advanced legacy override ON; VALID
// theme whose button roles are white-on-white (contrast fail).
const COMPAT_ON_FRAME = JSON.stringify({
  version: 1,
  template: "centered",
  compat: { allow_section_chrome: true },
});
const LOW_CONTRAST_THEME = JSON.stringify({
  version: 1,
  palette: { button_primary_bg: "#FFFFFF", button_primary_text: "#FFFFFF" },
});

interface SeededQuote {
  quoteRow: LeadgenQuoteRow;
  quotePublicId: string;
  funnelPublicId: string;
  funnelId: number;
  variantPublicId: string;
}

async function seedQuote(
  h: Harness,
  name: string,
  sectionIds: number[],
): Promise<SeededQuote> {
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
  const quoteRow = h.sdb
    .prepare("SELECT * FROM leadgen_quotes WHERE public_id = ?")
    .get(created.public_id) as unknown as LeadgenQuoteRow;
  const funnelRow = h.sdb
    .prepare("SELECT id FROM leadgen_funnels WHERE public_id = ?")
    .get(funnelPublicId) as { id: number };
  return {
    quoteRow,
    quotePublicId: created.public_id,
    funnelPublicId,
    funnelId: funnelRow.id,
    variantPublicId,
  };
}

function firstMatch(
  problems: Problem[],
  predicate: (p: Problem) => boolean,
  label: string,
): Problem {
  const hit = problems.find(predicate);
  expect(hit, `${label} — expected a matching problem; got:\n${JSON.stringify(problems, null, 2)}`).toBeDefined();
  return hit!;
}

// ===========================================================================

describeDb("activation-preflight-v25 (14 §14.1 rows fire with contract severities)", () => {
  it("Quote A: invalid frame/theme/overrides + chrome/dup-continue/headline/hex section rows", async () => {
    const h = newHarness();
    const s1 = seedSection(h.sdb, { contentJson: CHROME_DUP_CONTENT });
    const s2 = seedSection(h.sdb, {
      contentJson: HEADLINELESS_HEX_CONTENT,
      designOverridesJson: HEX_SECTION_OVERRIDES,
    });
    const seeded = await seedQuote(h, "Crafted Invalid Quote", [s1.id, s2.id]);
    h.sdb
      .prepare("UPDATE leadgen_funnels SET frame_config_json = ?, theme_json = ? WHERE id = ?")
      .run(INVALID_FRAME, INVALID_THEME, seeded.funnelId);
    h.sdb
      .prepare("UPDATE leadgen_funnel_variants SET frame_overrides_json = ? WHERE public_id = ?")
      .run(INVALID_OVERRIDES, seeded.variantPublicId);

    const preflight = await computeQuoteActivationPreflight(h.d1, seeded.quoteRow);
    const problems = preflight.problems;

    // Row 1 — frame schema invalid → error (unknown group + unsafe href).
    const frameUnknown = firstMatch(
      problems,
      (p) => p.path === "frame.bogus_group" && p.scope === "frame",
      "row 1 (unknown frame group)",
    );
    expect(frameUnknown.severity).toBe("error");
    expect(frameUnknown.message).toContain("The funnel's layout has an invalid setting"); // MAJOR-1: renamed from "page frame"
    const frameHref = firstMatch(
      problems,
      (p) => p.path === "frame.header.cta.href",
      "row 1 (unsafe CTA href)",
    );
    expect(frameHref.severity).toBe("error");

    // Row 12 — trust-strip logo missing alt → error, dedicated a11y copy —
    // and EXACTLY ONE problem on that path: the generic schema row (alt is a
    // required_text frame field) is deduped in favour of the a11y copy.
    const trustAltRows = problems.filter((p) => p.path === "frame.trust_strip.logos[0].alt");
    expect(trustAltRows, `row 12 deduped by path; got:\n${JSON.stringify(trustAltRows, null, 2)}`).toHaveLength(1);
    const trustAlt = trustAltRows[0]!;
    expect(trustAlt.message).toContain("screen readers");
    expect(trustAlt.severity).toBe("error");

    // Row 2 — theme invalid → error.
    const themeRole = firstMatch(
      problems,
      (p) => p.path === "theme.palette.not_a_role",
      "row 2 (unknown theme role)",
    );
    expect(themeRole.severity).toBe("error");
    expect(themeRole.message).toContain("The funnel theme has an invalid value");
    expect(
      firstMatch(problems, (p) => p.path === "theme.scales.radius", "row 2 (bad scale)").severity,
    ).toBe("error");

    // Row 3 — variant overrides invalid → error, per-variant message.
    const overrides = firstMatch(
      problems,
      (p) => p.path === "frame.header.logo_size" && p.message.startsWith("Variant '"),
      "row 3 (variant overrides)",
    );
    expect(overrides.severity).toBe("error");

    // Row 5 — chrome in section, compat OFF → ERROR naming the chrome types.
    const chrome = firstMatch(
      problems,
      (p) => p.path === `section.${s1.public_id}.content`,
      "row 5 (frame_scope_component)",
    );
    expect(chrome.severity).toBe("error");
    for (const t of ["HeaderBar", "ProgressBar", "BackButton"]) {
      expect(chrome.message, `chrome row names ${t}`).toContain(t);
    }
    expect(chrome.message).toContain("render twice");
    // §14.1 full copy pattern: the remedy names the Section Builder's
    // [Move to funnel layout] action next to the legacy-override alternative.
    // U15 fix-round (2026-07-15): renamed from "[Move to Quote frame]" to
    // match ui-section-studio.ts's renamed button verbatim.
    expect(chrome.message).toContain("[Move to funnel layout] in the Section Builder");

    // Row 7 — duplicate Continue → warning.
    const dup = firstMatch(
      problems,
      (p) => p.path === `section.${s1.public_id}.continue`,
      "row 7 (duplicate_continue)",
    );
    expect(dup.severity).toBe("warning");
    expect(dup.message).toContain("more than one Continue");

    // Row 8 — Section-local progress AND back → warnings.
    expect(
      firstMatch(problems, (p) => p.path === `section.${s1.public_id}.progress`, "row 8 (progress)")
        .severity,
    ).toBe("warning");
    expect(
      firstMatch(problems, (p) => p.path === `section.${s1.public_id}.back`, "row 8 (back)").severity,
    ).toBe("warning");

    // Row 9 — no bound headline AND no visible headline → warning.
    const headline = firstMatch(
      problems,
      (p) => p.path === `section.${s2.public_id}.headline`,
      "row 9 (missing headline)",
    );
    expect(headline.severity).toBe("warning");
    expect(headline.message).toContain("shows no question headline");

    // Row 10 — legacy hex literal count (1 node + 1 section palette = 2).
    const hex = firstMatch(
      problems,
      (p) => p.path === `section.${s2.public_id}.design_overrides`,
      "row 10 (legacy hex)",
    );
    expect(hex.severity).toBe("warning");
    expect(hex.message).toContain("2 custom colors");
    expect(hex.message).toContain("convert to theme colors");

    // The hard-409 inputs are untouched by every row above: zero blocks, ok.
    expect(preflight.blocks).toEqual([]);
    expect(preflight.ok).toBe(true);
  });

  it("Quote B: compat-ON chrome warning + contrast lint + site-logo warning through the REAL activation PUT (which stays 200)", async () => {
    const h = newHarness();
    const s3 = seedSection(h.sdb, { contentJson: CHROME_ONLY_CONTENT });
    const seeded = await seedQuote(h, "Crafted Valid Quote", [s3.id]);
    h.sdb
      .prepare("UPDATE leadgen_funnels SET frame_config_json = ?, theme_json = ? WHERE id = ?")
      .run(COMPAT_ON_FRAME, LOW_CONTRAST_THEME, seeded.funnelId);

    // End-to-end through the activation PUT: site-1 has NO logo → row 4 fires
    // in the response's preflight; error-free otherwise → 200, never a 409
    // from problems alone (C2 phasing).
    const actRes = await admin.request(
      `${API}/quotes/${seeded.quotePublicId}/activation/site-1`,
      jsonInit("PUT", { enabled: true, slug: "crafted-valid" }),
      h.env,
    );
    expect(actRes.status, await actRes.clone().text()).toBe(200);
    const body = (await actRes.json()) as { activation_preflight: QuoteActivationPreflight };
    const problems = body.activation_preflight.problems;

    // Row 4 — site logo unresolvable while logo_source="site" → warning with
    // the §10.4 copy + a fix link to the site's Settings.
    const logo = firstMatch(
      problems,
      (p) => p.path === "frame.header.logo_source" && p.message.includes("has no logo"),
      "row 4 (site logo)",
    );
    expect(logo.severity).toBe("warning");
    expect(logo.fix_url).toContain("site_id=site-1");

    // Row 6 — chrome in section with compat.allow_section_chrome=true →
    // WARNING (the Advanced legacy override downgrade).
    const chrome = firstMatch(
      problems,
      (p) => p.path === `section.${s3.public_id}.content`,
      "row 6 (compat-on chrome)",
    );
    expect(chrome.severity).toBe("warning");
    expect(chrome.message).toContain("Legacy override is ON");
    expect(chrome.message).toContain("StepIndicator");

    // Row 11 — WCAG AA contrast lint on the button role pair → warning naming
    // the pair (white-on-white = 1:1).
    const contrast = firstMatch(
      problems,
      (p) => p.message.includes("button_primary_text on button_primary_bg"),
      "row 11 (contrast)",
    );
    expect(contrast.severity).toBe("warning");
    expect(contrast.message).toContain("WCAG AA");

    // The block list stayed empty → activation succeeded (asserted by the 200
    // above); the stored blocks shape is unchanged.
    expect(body.activation_preflight.blocks).toEqual([]);
    expect(body.activation_preflight.ok).toBe(true);
  });

  it("14 §14.4: a LEGACY Quote (NULL frame/theme/overrides) yields ZERO new problems — even with chrome/dup/hex sections — and activates", async () => {
    const h = newHarness();
    // The nastiest possible legacy sections: chrome + duplicate Continue + no
    // headline + hex overrides. With NULL v2.5 columns NONE of the new rows
    // may fire.
    const s1 = seedSection(h.sdb, { contentJson: CHROME_DUP_CONTENT });
    const s2 = seedSection(h.sdb, {
      contentJson: HEADLINELESS_HEX_CONTENT,
      designOverridesJson: HEX_SECTION_OVERRIDES,
    });
    const seeded = await seedQuote(h, "Legacy Quote", [s1.id, s2.id]);

    const preflight = await computeQuoteActivationPreflight(h.d1, seeded.quoteRow);
    expect(preflight.problems).toEqual([]);
    expect(preflight.blocks).toEqual([]);
    expect(preflight.ok).toBe(true);

    const actRes = await admin.request(
      `${API}/quotes/${seeded.quotePublicId}/activation/site-1`,
      jsonInit("PUT", { enabled: true, slug: "legacy-ok" }),
      h.env,
    );
    expect(actRes.status, await actRes.clone().text()).toBe(200);
    const body = (await actRes.json()) as { activation_preflight: QuoteActivationPreflight };
    expect(body.activation_preflight.problems).toEqual([]);
  });

  // NOTE (Phase D, C2 LIVE): this pins the activationBlockedReport FUNCTION —
  // the normative report SHAPE is frozen forever. The Phase-D activation PUT
  // composes its 409 body as {...report, problems} at the call site (see the
  // "C2 LIVE" describe below), so this byte-pin holds unchanged.
  it("C2 phasing: the 409 report body keeps its EXACT historical keys — no problems key rides it", () => {
    const preflight: QuoteActivationPreflight = {
      ok: false,
      quote_id: "lgq_x",
      funnel_id: "lgf_x",
      funnel_variant_id: "lgn_x",
      blocks: [
        {
          section_id: "lgs_x",
          section_name: "S",
          offer_id: "off_x",
          offer_name: "O",
          code: "mapping_incomplete",
          fields: ["a"],
          fix_links: {},
        },
      ],
      computed_at: 1,
      problems: [
        { path: "frame", scope: "frame", severity: "error", message: "would-block in Phase D" },
      ],
    };
    const report = activationBlockedReport(preflight);
    expect(Object.keys(report).sort()).toEqual([
      "blocks",
      "error",
      "funnel_id",
      "funnel_variant_id",
      "quote_id",
    ]);
    expect("problems" in report).toBe(false);
    expect(report["error"]).toBe("quote_activation_blocked");
  });
});

// ===========================================================================
// C2 LIVE (Phase D — 14 §14.1/§14.2): error-severity problems join the
// activation-blocking decision ADDITIVELY. The 409 fires on (existing blocks)
// OR (any error-severity problem); the 409 body = the EXACT historical
// normative report + the additive `problems` key. Warnings never block. The
// §14.4 legacy guarantee is re-proven by the untouched test above.
// ===========================================================================

describeDb("C2 LIVE (Phase D) — error-severity problems block the activation PUT", () => {
  // A structurally VALID centered frame with compat OFF (the §3.3 default).
  const COMPAT_OFF_FRAME = JSON.stringify({ version: 1, template: "centered" });

  it("configured frame + chrome section (compat OFF) → 409 with the report byte-shape + additive problems; nothing persists; disabling stays 200", async () => {
    const h = newHarness();
    const s1 = seedSection(h.sdb, { contentJson: CHROME_ONLY_CONTENT });
    const seeded = await seedQuote(h, "C2 Chrome Quote", [s1.id]);
    h.sdb
      .prepare("UPDATE leadgen_funnels SET frame_config_json = ? WHERE id = ?")
      .run(COMPAT_OFF_FRAME, seeded.funnelId);

    const put = await admin.request(
      `${API}/quotes/${seeded.quotePublicId}/activation/site-1`,
      jsonInit("PUT", { enabled: true, slug: "c2-blocked" }),
      h.env,
    );
    expect(put.status, await put.clone().text()).toBe(409);
    const body = (await put.json()) as Record<string, unknown>;

    // §14.2: the EXISTING normative report byte-shape + additive `problems`.
    expect(Object.keys(body).sort()).toEqual([
      "blocks",
      "error",
      "funnel_id",
      "funnel_variant_id",
      "problems",
      "quote_id",
    ]);
    expect(body["error"]).toBe("quote_activation_blocked");
    // The pure C2 leg: ZERO legacy blocks — the error-severity problem alone
    // fired the 409 (the OR's new arm).
    expect(body["blocks"]).toEqual([]);
    const problems = body["problems"] as Problem[];
    const chrome = firstMatch(
      problems,
      (p) => p.path === `section.${s1.public_id}.content`,
      "C2 chrome row in the 409 body",
    );
    expect(chrome.severity).toBe("error");
    expect(chrome.message).toContain("contains funnel-layout elements"); // MAJOR-1: renamed from "page-frame elements"
    expect(chrome.message).toContain("render twice");
    // §14.1 full copy pattern: BOTH remedies — the Section Builder's
    // [Move to funnel layout] action and the Advanced legacy override.
    expect(chrome.message).toContain("Remove them ([Move to funnel layout] in the Section Builder)");
    expect(chrome.message).toContain("legacy override under Advanced");
    // §14.2 fix link: the [Review slide] deep link the copy table names —
    // the message mention never replaces it.
    expect(chrome.fix_url).toBe(`/admin/leadgen/sections/${s1.public_id}/edit`);

    // The blocked PUT persisted NOTHING.
    const row = h.sdb.prepare("SELECT id FROM leadgen_site_quotes WHERE site_id = 'site-1'").get();
    expect(row ?? null).toBeNull();

    // Disabling is never blocked — even with the error problem standing.
    const off = await admin.request(
      `${API}/quotes/${seeded.quotePublicId}/activation/site-1`,
      jsonInit("PUT", { enabled: false, slug: "c2-off" }),
      h.env,
    );
    expect(off.status, await off.clone().text()).toBe(200);
  });

  it("compat.allow_section_chrome=true downgrades the SAME chrome to a warning → activation 200 (warnings never block)", async () => {
    const h = newHarness();
    const s1 = seedSection(h.sdb, { contentJson: CHROME_ONLY_CONTENT });
    const seeded = await seedQuote(h, "C2 Compat Quote", [s1.id]);
    h.sdb
      .prepare("UPDATE leadgen_funnels SET frame_config_json = ? WHERE id = ?")
      .run(COMPAT_ON_FRAME, seeded.funnelId);

    const put = await admin.request(
      `${API}/quotes/${seeded.quotePublicId}/activation/site-1`,
      jsonInit("PUT", { enabled: true, slug: "c2-compat-on" }),
      h.env,
    );
    expect(put.status, await put.clone().text()).toBe(200);
    const body = (await put.json()) as {
      enabled: boolean;
      activation_preflight: QuoteActivationPreflight;
    };
    expect(body.enabled).toBe(true);
    const chrome = firstMatch(
      body.activation_preflight.problems,
      (p) => p.path === `section.${s1.public_id}.content`,
      "compat-ON chrome row on the 200 body",
    );
    expect(chrome.severity).toBe("warning");
    expect(chrome.message).toContain("Legacy override is ON");
    // …and the row really persisted.
    const row = h.sdb
      .prepare("SELECT enabled, slug FROM leadgen_site_quotes WHERE site_id = 'site-1'")
      .get() as { enabled: number; slug: string };
    expect(row.enabled).toBe(1);
    expect(row.slug).toBe("c2-compat-on");
  });
});

// v3.1 §9.3 — maps_no_job escalates to a BLOCKING error at activation
// preflight, UNCONDITIONALLY (unlike the frame-scope C2 rows above): this
// Quote has NO frame_config_json at all (the exact §14.4 "legacy Quote"
// shape the earlier describe block proved yields ZERO problems) — proving
// the escalation is a per-field content concern, not gated on a configured
// frame.
describeDb("v3.1 §9.3 — maps_no_job escalates to a BLOCKING activation error", () => {
  const MAPS_NO_JOB_CONTENT = JSON.stringify({
    components: [
      { type: "QuestionHeadline", question_id: "h5", props: { text: "ZIP?" } },
      {
        type: "ZIPInputQuestion",
        question_id: "q_zip",
        question_key: "k_zip",
        internal_field: "zip",
        props: { maps: { enabled: true, jobs: { validate: false, auction: false, autocomplete: false } } },
      },
      { type: "ContinueButton", question_id: "c5", props: { label: "Continue" } },
    ],
  });

  it("a maps.enabled + 0-jobs field → 409 even with NO frame configured (legacy Quote shape); nothing persists", async () => {
    const h = newHarness();
    const s1 = seedSection(h.sdb, { contentJson: MAPS_NO_JOB_CONTENT });
    const seeded = await seedQuote(h, "Maps No-Job Quote", [s1.id]);
    // Deliberately NO frame_config_json update — this is the §14.4 "legacy
    // Quote" shape that the C2 describe block's sibling test proves yields
    // zero FRAME-gated problems.

    const put = await admin.request(
      `${API}/quotes/${seeded.quotePublicId}/activation/site-1`,
      jsonInit("PUT", { enabled: true, slug: "maps-no-job-blocked" }),
      h.env,
    );
    expect(put.status, await put.clone().text()).toBe(409);
    const body = (await put.json()) as Record<string, unknown>;
    expect(body["error"]).toBe("quote_activation_blocked");
    const problems = body["problems"] as Problem[];
    const mapsProblem = firstMatch(
      problems,
      (p) => p.path === `section.${s1.public_id}.components[q_zip].props.maps`,
      "maps_no_job row in the 409 body",
    );
    expect(mapsProblem.severity).toBe("error");
    expect(mapsProblem.message).toContain("no job selected");
    expect(mapsProblem.scope).toBe("component");

    // Nothing persisted.
    const row = h.sdb.prepare("SELECT id FROM leadgen_site_quotes WHERE site_id = 'site-1'").get();
    expect(row ?? null).toBeNull();
  });

  it("selecting a job (e.g. jobs.validate=true) removes the block → activation 200", async () => {
    const h = newHarness();
    const fixedContent = JSON.stringify({
      components: [
        { type: "QuestionHeadline", question_id: "h6", props: { text: "ZIP?" } },
        {
          type: "ZIPInputQuestion",
          question_id: "q_zip2",
          question_key: "k_zip2",
          internal_field: "zip2",
          props: { maps: { enabled: true, jobs: { validate: true, auction: false, autocomplete: false } } },
        },
        { type: "ContinueButton", question_id: "c6", props: { label: "Continue" } },
      ],
    });
    const s1 = seedSection(h.sdb, { contentJson: fixedContent });
    const seeded = await seedQuote(h, "Maps Fixed Quote", [s1.id]);

    const put = await admin.request(
      `${API}/quotes/${seeded.quotePublicId}/activation/site-1`,
      jsonInit("PUT", { enabled: true, slug: "maps-fixed" }),
      h.env,
    );
    expect(put.status, await put.clone().text()).toBe(200);
  });
});

// ===========================================================================

describeDb("bumpActiveVariantContentVersions (03 §3.1)", () => {
  it("bumps content_version on every ACTIVE variant of the funnel and ONLY those", async () => {
    const h = newHarness();
    const s1 = seedSection(h.sdb, { contentJson: CHROME_ONLY_CONTENT });
    const seeded = await seedQuote(h, "Bump Quote", [s1.id]);

    // A second ACTIVE variant + an ARCHIVED one, directly on the funnel.
    h.sdb
      .prepare(
        "INSERT INTO leadgen_funnel_variants (public_id, funnel_id, variant_label, is_control, status) VALUES (?, ?, 'B', 0, 'active')",
      )
      .run(mintPublicId("funnel_variant"), seeded.funnelId);
    h.sdb
      .prepare(
        "INSERT INTO leadgen_funnel_variants (public_id, funnel_id, variant_label, is_control, status) VALUES (?, ?, 'C', 0, 'archived')",
      )
      .run(mintPublicId("funnel_variant"), seeded.funnelId);

    const before = h.sdb
      .prepare("SELECT public_id, content_version, status FROM leadgen_funnel_variants WHERE funnel_id = ? ORDER BY id ASC")
      .all(seeded.funnelId) as Array<{ public_id: string; content_version: number; status: string }>;

    const bumped = await bumpActiveVariantContentVersions(h.d1, seeded.funnelId);
    expect(bumped).toBe(2); // the two ACTIVE variants

    const after = h.sdb
      .prepare("SELECT public_id, content_version, status FROM leadgen_funnel_variants WHERE funnel_id = ? ORDER BY id ASC")
      .all(seeded.funnelId) as Array<{ public_id: string; content_version: number; status: string }>;
    for (let i = 0; i < before.length; i++) {
      const delta = after[i]!.content_version - before[i]!.content_version;
      expect(delta, `${after[i]!.public_id} (${after[i]!.status})`).toBe(
        before[i]!.status === "active" ? 1 : 0,
      );
    }

    // Idempotent per call: a second bump moves the active rows again (the
    // §3.1 semantics are "every save bumps" — monotonic, never capped).
    expect(await bumpActiveVariantContentVersions(h.d1, seeded.funnelId)).toBe(2);
  });
});
