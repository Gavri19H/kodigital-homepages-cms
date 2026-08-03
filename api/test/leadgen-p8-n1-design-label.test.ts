// LeadGen R2 P8-3 — SLICE S3.5 → S3.7, the fourth N1 control: "Base visual
// design".
//
// Owner verbatim (SOURCE-OF-TRUTH.md): "theme is only design language!!!!
// colors, fonts, sizes" — the operator is a marketer, not an engineer, and a
// control that shows them `default` / `default-funnel` is showing them a
// database id (contract minor N1, §7, fourth control). S3.5 fixed the raw-id
// LABEL (a label map). GROUNDED FINDING (public/leadgen/designs/registry.ts
// FUNNEL_DESIGNS) surfaced a DEEPER defect S3.5 documented but did not fix:
// the registry registers exactly ONE distinct design object
// (defaultFunnelDesign, canonical id "default-funnel") under TWO keys — its
// own id, and "default" (the resolver's own documented fallback alias). Both
// keys resolve to the IDENTICAL object (getFunnelDesign — the SAME resolver
// quotes-handlers.ts/serve.ts use to paint the visitor-facing funnel — and
// funnelChromeCss, the SAME function that turns a resolved design into the
// visitor's chrome CSS, prove this below). Offering one <option> per
// registry KEY therefore offered the operator two choices that do the
// identical thing — not a choice (§4 R3 corollary: "a control that cannot be
// honoured must not be offered"). S3.7 is that fix: listFunnelDesignOptions
// (quotes-handlers.ts) now dedupes to one entry per DISTINCT design and is
// the single source of `label`.
//
// Against the REAL rendered admin markup, never a hand-assembled string:
// creates a quote through the real admin router (mints funnel A + its
// variant), PUTs the variant's funnel_design_id through the real
// PUT /variants/:id handler, then GETs the real served editor page (the
// same node:sqlite D1 harness idiom as leadgen-rework-board.test.ts /
// leadgen-p3a-split-parity.test.ts) and reads the funnel-settings dialog's
// <select id="lg-funnel-design"> straight out of that response.
//
// I1 (an alias is not a choice) is proved two ways: (a) a pure unit check
// that listFunnelDesignOptions() returns exactly one entry per DISTINCT
// design id (source-derived, not a hand-picked pair); (b) the real rendered
// <select> carries exactly that many <option>s.
//
// I2 (a funnel already storing the alias keeps working, unchanged) is proved
// end-to-end for the stored-alias case: visitor-side resolution stays
// byte-identical, the select shows a correct non-empty selected state on
// load, and an explicit resave writes back exactly the value the operator's
// one visible choice means (never a value they did not see selected).
//
// I4 (completeness enforced, not assumed): FUNNEL_DESIGN_LABELS is asserted
// complete against every DISTINCT id the real registry resolves to, AND
// assertFunnelDesignLabelsComplete is shown to THROW (a visible, developer-
// facing failure) for an id it is given that the map does not cover — so a
// future unlabeled design id cannot silently leak its raw id. F5 MINOR-7
// (review-p8-3): that throw moved OFF funnelDesignLabel/listFunnelDesign-
// Options (the operator's render path — ui-quotes.ts:928 on every quote-
// editor GET) into this dedicated, test-invoked completeness check.
// funnelDesignLabel itself now degrades to a neutral, non-id label instead
// of throwing, so an unlabeled design id never 500s the editor.

import { describe, expect, it, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import admin from "../src/admin/router";
import type { Env } from "../src/env";
import { FUNNEL_DESIGNS, getFunnelDesign } from "../src/public/leadgen/designs/registry";
import { funnelChromeCss } from "../src/public/leadgen/designs/default-funnel/styles";
import { FUNNEL_DESIGN_LABELS, assertFunnelDesignLabelsComplete, funnelDesignLabel, listFunnelDesignOptions } from "../src/admin/leadgen/quotes-handlers";

// --- node:sqlite harness (repo pattern; duplicated per test file, e.g. -----
// --- leadgen-rework-board.test.ts, leadgen-p3a-split-parity.test.ts) -------

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
  return {
    prepare(sql: string) {
      let binds: unknown[] = [];
      const stmt = {
        bind(...a: unknown[]) { binds = a; return stmt; },
        async first<T = unknown>(): Promise<T | null> { return (sdb.prepare(sql).get(...binds) ?? null) as T | null; },
        async all<T = unknown>() { return { results: sdb.prepare(sql).all(...binds) as T[], success: true, meta: {} }; },
        async run() {
          const r = sdb.prepare(sql).run(...binds) as { changes?: number; lastInsertRowid?: number | bigint };
          return { success: true, meta: { changes: Number(r?.changes ?? 0), last_row_id: Number(r?.lastInsertRowid ?? 0) } };
        },
      };
      return stmt;
    },
    async batch(statements: Array<{ run(): Promise<unknown> }>) {
      runSql(sdb, "BEGIN");
      try {
        const out: unknown[] = [];
        for (const s of statements) out.push(await s.run());
        runSql(sdb, "COMMIT");
        return out;
      } catch (e) {
        runSql(sdb, "ROLLBACK");
        throw e;
      }
    },
  } as unknown as D1Database;
}

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const LEADGEN_MIGRATIONS = [
  "0036_leadgen_core.sql", "0037_leadgen_analytics_mirror.sql", "0038_leadgen_revenue_infra.sql",
  "0039_leadgen_conversion_dedupe.sql", "0040_leadgen_runtime_context.sql", "0041_leadgen_frame_theme.sql",
  "0042_leadgen_pages.sql", "0043_leadgen_routing_rules.sql", "0044_leadgen_redirect_pct.sql",
  "0045_leadgen_persona_quota.sql", "0046_leadgen_rework_m1_variants.sql", "0047_leadgen_rework_m2_shared_pages.sql",
  "0048_leadgen_rework_m3_routing.sql", "0049_leadgen_rework_m4_m5_defaults_templates.sql",
  "0050_leadgen_rework_m6_grid_expansion.sql", "0051_leadgen_rework_m7_slider_collapse.sql",
  "0052_leadgen_rework_m9_address_fields.sql", "0053_leadgen_rework_m12_othergroup_retirement.sql",
] as const;

function createLeadgenDb(DatabaseSync: DatabaseSyncCtor): SqliteDb {
  const sdb = new DatabaseSync(":memory:");
  runSql(
    sdb,
    "CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT, domain TEXT);" +
      "CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT);" +
      "INSERT INTO sites (id, name, domain) VALUES ('site-1','Site One','one.example.com');",
  );
  for (const file of LEADGEN_MIGRATIONS) runSql(sdb, readFileSync(join(TEST_DIR, "../migrations", file), "utf8"));
  return sdb;
}

function buildEnv(db: D1Database): Env {
  return {
    DB: db, CACHE: {} as KVNamespace, MEDIA: {} as R2Bucket, APP_ENV: "test",
    ADMIN_HOST: "localhost", ADMIN_BASE_URL: "http://localhost:8787", ADMIN_BASE_PATH: "/admin",
    CACHE_API_ENABLED: "false", HTML_CACHE_TTL_SECONDS: "60", OPENAI_TEXT_MODEL: "gpt-test",
    OPENAI_IMAGE_MODEL: "img-test", SITE_PROVISIONING_DRY_RUN: "true",
    SITE_PROVISIONING_ALLOW_ROUTE_MUTATION: "false", DEV_BYPASS_AUTH: "true",
  } as Env;
}

const DatabaseSync = loadDatabaseSync();
const describeDb = DatabaseSync === null ? describe.skip : describe;
const API = "/api/admin/leadgen";

function jsonInit(method: string, body: unknown): RequestInit {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

interface QuoteDetail {
  public_id: string;
  funnels: Array<{ public_id: string; funnel_name: string; variants: Array<{ public_id: string }> }>;
}

// -----------------------------------------------------------------------
// Unit-level I1 proof: listFunnelDesignOptions dedupes registry KEYS down to
// DISTINCT designs — an alias is never offered as a second choice. Pure (no
// DB), so it runs regardless of node:sqlite availability.
//
// RETIRED (was here through S3.5, now covered by the tests below + the
// driven describeDb block's I1 test): an assertion that option COUNT must
// equal Object.keys(FUNNEL_DESIGNS).length (the raw registry KEY count, 2
// today) and that both "default" and "default-funnel" render as separate
// options. That behaviour was the exact false-choice defect S3.7 fixes;
// asserting it would assert the bug. Superseded by "returns exactly one
// option per distinct design id" below, which is source-derived (recomputes
// the expected count from the real registry every run) rather than a
// hand-picked pair, so it remains correct if a genuinely distinct design is
// added tomorrow.
describe("I1 — listFunnelDesignOptions dedupes registry KEYS down to DISTINCT designs (an alias is never offered as a second choice)", () => {
  const distinctDesignIds = [...new Set(Object.values(FUNNEL_DESIGNS).map((d) => d.id))];

  it("sanity: the real registry still has more KEYS than DISTINCT designs today (this proof is not vacuous)", () => {
    expect(Object.keys(FUNNEL_DESIGNS).length).toBeGreaterThan(distinctDesignIds.length);
  });

  it("returns exactly one option per distinct design id, never one per registry key", () => {
    const options = listFunnelDesignOptions();
    expect(options.map((o) => o.id).sort()).toEqual(distinctDesignIds.sort());
  });

  it("every returned option carries a real label (never its raw id), sourced from FUNNEL_DESIGN_LABELS — the single source of these labels (I3)", () => {
    const options = listFunnelDesignOptions();
    for (const o of options) {
      expect(o.label).not.toBe(o.id);
      expect(o.label).toBe(FUNNEL_DESIGN_LABELS[o.id]);
    }
  });
});

// -----------------------------------------------------------------------
// Unit-level I4 proof: FUNNEL_DESIGN_LABELS completeness + failure
// surfacing, scoped to DISTINCT design ids (an alias KEY like "default" is
// deliberately never independently labelled — it is never independently
// rendered as its own option post-S3.7). Pure (no DB).
// -----------------------------------------------------------------------

describe("I4 — FUNNEL_DESIGN_LABELS is complete against every DISTINCT design the real registry resolves to; an unlabeled id is a developer-visible failure (never reachable from an operator's request), never a silent id leak", () => {
  const distinctDesignIds = [...new Set(Object.values(FUNNEL_DESIGNS).map((d) => d.id))];

  it("the real registry resolves to at least one distinct design (sanity: this proof is not vacuous)", () => {
    expect(distinctDesignIds.length).toBeGreaterThan(0);
  });

  it("every distinct design id the real registry resolves to has a label, and that label is not the raw id", () => {
    for (const id of distinctDesignIds) {
      expect(FUNNEL_DESIGN_LABELS[id], `FUNNEL_DESIGN_LABELS is missing an entry for real distinct design id "${id}"`).toBeDefined();
      expect(FUNNEL_DESIGN_LABELS[id]).not.toBe(id);
    }
  });

  it("funnelDesignLabel resolves every distinct design id through the same map", () => {
    for (const id of distinctDesignIds) {
      expect(funnelDesignLabel(id)).toBe(FUNNEL_DESIGN_LABELS[id]);
    }
  });

  it("assertFunnelDesignLabelsComplete passes for the REAL registry's distinct ids (nothing unlabeled today)", () => {
    expect(() => assertFunnelDesignLabelsComplete()).not.toThrow();
  });

  // F5 MINOR-7 (review-p8-3) RETIRED: "an id the map does not cover throws
  // (visible failure) ... surfaced as early as listFunnelDesignOptions
  // itself" — that throw WAS the defect: a distinct design id added without
  // a label would 500 the operator's quote editor on every render (it is
  // unreachable today — one design, labelled — but registering a second
  // would crash the editor rather than degrade). Replaced by the two tests
  // below: funnelDesignLabel now degrades gracefully on the render path,
  // and assertFunnelDesignLabelsComplete (never called from that path) is
  // what now throws for an uncovered id — the SAME completeness guarantee,
  // moved off the operator's request.
  it("funnelDesignLabel NEVER throws — an id the map does not cover degrades to a neutral, honest label, never the raw id, never a render-path failure", () => {
    expect(() => funnelDesignLabel("some-future-design-nobody-labelled")).not.toThrow();
    const label = funnelDesignLabel("some-future-design-nobody-labelled");
    expect(label).not.toBe("some-future-design-nobody-labelled");
    expect(label.length).toBeGreaterThan(0);
  });

  it("assertFunnelDesignLabelsComplete throws (a developer-visible failure) when given an id the map does not cover", () => {
    expect(() => assertFunnelDesignLabelsComplete(["default-funnel", "some-future-design-nobody-labelled"])).toThrow(
      /FUNNEL_DESIGN_LABELS is missing an entry/,
    );
  });
});

// -----------------------------------------------------------------------
// I1/I3 grounding: both registry keys resolve to the IDENTICAL design via
// the SAME resolver/renderer the visitor-facing path uses (registry.ts /
// default-funnel/styles.ts) — real functions, not hand-built stand-ins.
// -----------------------------------------------------------------------

describe("I1/I3 grounding — what actually differs between 'default' and 'default-funnel' (nothing, today)", () => {
  it("getFunnelDesign resolves both registry keys to the SAME design object", () => {
    expect(getFunnelDesign("default")).toBe(getFunnelDesign("default-funnel"));
    expect(getFunnelDesign("default").id).toBe("default-funnel");
  });

  it("funnelChromeCss (the real visitor-chrome CSS generator) emits byte-identical CSS for both", () => {
    const cssViaDefault = funnelChromeCss(getFunnelDesign("default"));
    const cssViaDefaultFunnel = funnelChromeCss(getFunnelDesign("default-funnel"));
    expect(cssViaDefault.length).toBeGreaterThan(0);
    expect(cssViaDefault).toBe(cssViaDefaultFunnel);
  });
});

// -----------------------------------------------------------------------
// Driven proof: the REAL admin editor page, through the REAL router + a
// REAL (in-memory) D1, never a hand-built fixture.
// -----------------------------------------------------------------------

describeDb("S3.7 — N1 4th control: 'Base visual design' offers ONE choice per distinct design, never a second option for an alias (real rendered admin markup)", () => {
  let html = "";
  let env: Env;
  let variantPublic = "";
  let quotePublicId = "";

  beforeAll(async () => {
    const sdb = createLeadgenDb(DatabaseSync as DatabaseSyncCtor);
    env = buildEnv(d1FromSqlite(sdb));
    const cq = await admin.request(`${API}/quotes`, jsonInit("POST", { quote_name: "Design Label Quote", activity: "quote_funnel", verticals: ["car"] }), env);
    expect(cq.status, `create quote: ${await cq.clone().text()}`).toBe(201);
    const quote = (await cq.json()) as QuoteDetail;
    quotePublicId = quote.public_id;
    variantPublic = quote.funnels[0]!.variants[0]!.public_id;

    // Seed the variant's design to the canonical id (through the real
    // PUT /variants/:id) so "selected" is exercised on a KNOWN, non-default value.
    const pv = await admin.request(`${API}/variants/${variantPublic}`, jsonInit("PUT", { funnel_design_id: "default-funnel" }), env);
    expect(pv.status, `seed design: ${await pv.clone().text()}`).toBe(200);

    html = await (await admin.request(`/admin/leadgen/quotes/${quotePublicId}/edit`, {}, env)).text();
  });

  function designSelectBlock(source: string): string {
    const start = source.indexOf('id="lg-funnel-design"');
    expect(start, "lg-funnel-design select must be present").toBeGreaterThan(-1);
    const end = source.indexOf("</select>", start);
    expect(end, "lg-funnel-design select must close").toBeGreaterThan(-1);
    return source.slice(start, end);
  }

  function designOptionsOf(source: string): Array<{ value: string; label: string; selected: boolean }> {
    const block = designSelectBlock(source);
    return [...block.matchAll(/<option value="([^"]*)"( selected)?>([^<]*)<\/option>/g)].map((m) => ({
      value: m[1] as string,
      selected: m[2] !== undefined,
      label: m[3] as string,
    }));
  }

  it("I1: exactly ONE option is offered — one entry per DISTINCT design, never one per registry key (the registry has 2 keys resolving to 1 design today)", () => {
    const distinctDesignIds = [...new Set(Object.values(FUNNEL_DESIGNS).map((d) => d.id))];
    expect(Object.keys(FUNNEL_DESIGNS).length, "sanity: this registry still has more keys than distinct designs").toBeGreaterThan(distinctDesignIds.length);
    const opts = designOptionsOf(html);
    expect(opts.length, "option count must match DISTINCT design count, not registry key count").toBe(distinctDesignIds.length);
    expect(opts.map((o) => o.value).sort()).toEqual(distinctDesignIds.sort());
  });

  it("I3: the one option's label is a real design word, never a raw registry key — 'default' is never offered as its own separate choice", () => {
    const opts = designOptionsOf(html);
    expect(opts[0]!.value).toBe("default-funnel");
    expect(opts[0]!.label).toBe("Default Funnel Design");
    const block = designSelectBlock(html);
    expect(block).not.toContain(">default<");
    expect(block).not.toContain(">default-funnel<");
    expect(block).not.toContain("Default (Automatic)");
  });

  it("the seeded canonical id is marked selected (correct, non-empty state on load)", () => {
    expect(designOptionsOf(html)[0]!.selected).toBe(true);
  });

  it("I2 end-to-end, stored-alias case: a funnel storing the ALIAS id ('default') still shows exactly one option in a correct, non-empty selected state, and still resolves the IDENTICAL visitor-facing design", async () => {
    // Real save path: PUT the alias id (never hand-built — the same
    // PUT /variants/:id every other seed in this file uses).
    const pv = await admin.request(`${API}/variants/${variantPublic}`, jsonInit("PUT", { funnel_design_id: "default" }), env);
    expect(pv.status, `seed ALIAS design: ${await pv.clone().text()}`).toBe(200);
    const htmlAlias = await (await admin.request(`/admin/leadgen/quotes/${quotePublicId}/edit`, {}, env)).text();
    const opts = designOptionsOf(htmlAlias);

    // (1) still exactly one option — the alias never resurrects a second choice (I1).
    expect(opts.length).toBe(1);
    expect(opts[0]!.value).toBe("default-funnel");

    // (2) correct, non-empty selected state for the alias-stored funnel: the
    // select displays the canonical entry as selected. This IS "deciding the
    // stored alias should be displayed as the canonical entry" (I2) — the
    // ONLY rendered option is the canonical one, so displaying anything else
    // is impossible without re-offering a second, non-choice option (I1
    // forbids that).
    expect(opts[0]!.selected, "the alias-stored funnel must show a selected option, not a blank select").toBe(true);

    // (3) byte-identical visitor-side resolution regardless of which of the
    // two keys is stored — the SAME resolver/renderer the visitor-facing
    // path uses (registry.ts / default-funnel/styles.ts), fed the REAL
    // stored value this test just wrote through the real PUT.
    const resolvedAlias = getFunnelDesign("default");
    const resolvedCanonical = getFunnelDesign("default-funnel");
    expect(resolvedAlias).toBe(resolvedCanonical);
    expect(funnelChromeCss(resolvedAlias)).toBe(funnelChromeCss(resolvedCanonical));
  });

  it("round-trip through an explicit resave keeps the alias-stored funnel on the SAME visitor-facing design — the value written back (the canonical id) is exactly what the operator's one visible choice means, never a value they did not see selected", async () => {
    // Precondition: the variant is still storing the ALIAS from the previous test.
    const before = designOptionsOf(await (await admin.request(`/admin/leadgen/quotes/${quotePublicId}/edit`, {}, env)).text());
    expect(before.length).toBe(1);
    expect(before[0]!.selected).toBe(true);
    expect(before[0]!.value).toBe("default-funnel");

    // The client only ever submits what it displays (funnel.ts's
    // saveFunnelSettings collects the select's live .value, and
    // openFunnelSettings/the SSR selected-marking both resolve the alias to
    // this same canonical value — quotes-tabs/funnel.ts); the select's only
    // option is "default-funnel", so an explicit Save on this dialog writes
    // exactly that value back. This is a real, admin-visible write (the
    // persisted funnel_design_id changes from "default" to "default-funnel"
    // on this save) — never a value the operator did not see selected, and
    // never a behavioural change: it was already resolving to the SAME
    // design object before this save (proved above).
    const resave = await admin.request(`${API}/variants/${variantPublic}`, jsonInit("PUT", { funnel_design_id: before[0]!.value }), env);
    expect(resave.status, `resave design: ${await resave.clone().text()}`).toBe(200);

    const after = designOptionsOf(await (await admin.request(`/admin/leadgen/quotes/${quotePublicId}/edit`, {}, env)).text());
    expect(after.length).toBe(1);
    expect(after[0]!.selected).toBe(true);
    expect(after[0]!.value).toBe("default-funnel");
    expect(getFunnelDesign("default-funnel")).toBe(getFunnelDesign("default"));
  });
});
