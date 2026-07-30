// LeadGen fix-contract v2.4 Phase 2 — the REBUILT Payload Builder UX
// (docs/leadgen/fix-contract-v2.4/06-payload-builder-ux-contract.md,
// §§6.1–6.12 + §6.14/M2) over the REAL admin router + REAL migrations
// (node:sqlite harness; the leadgen-offers-ui.test.ts pattern with
// DEV_BYPASS_AUTH). All seeding goes through the REAL B1 JSON API except
// the Section link rows (direct SQL — no dedicated link route exists).
//
// Every §-surface gets an HTML / bootstrap-island assertion:
//   §6.1 three panes + toolbar + search + badges hooks + last-Test chip +
//        NO dotted-path typing (the old raw-input rows are gone)
//   §6.2 grouped source picker — exact groups/members incl. the computed
//        dropdown carrying label — description (example); Advanced-macro
//        optgroups cover ALL 32 canonical macros; flat select REMOVED (M2)
//   §6.3/§6.4 value-map table — the 8 columns exactly + actions + CSV
//        import + footer warnings + choiceDisplay (Other grouping) controls
//   §6.5 free-text toggle · §6.6 date formats (Unix OMITTED — no epoch
//        transform exists) · §6.7 boolean presets (exact emissions)
//   §6.8 object/array builders (array sources EXACTLY the 3 supported)
//   §6.9 default/fallback modes + typed inputs + looseJson normalize hook
//   §6.10 condition ops — supported set ONLY (no contains, no OR) + help
//   §6.11 validation panel + Jump hooks + blocking-codes footer rendered
//        from the payload.ts export
//   §6.12 Test tab — generated form, simulated context (US defaults,
//        collapsed), placement picker, production confirm, Advanced raw
//        answers round-trip, context_used echo
//   §6.14/M2 — raw JSON inputs exist ONLY inside data-lg-advanced drawers
//   + ES5 token scan + node --check on the emitted page, island JSON
//   round-trips, and XSS discipline.

import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { runInNewContext } from "node:vm";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import admin from "../src/admin/router";
import type { Env } from "../src/env";
import { mintPublicId } from "../src/leadgen/ids";
import { COMPUTED_REGISTRY, LEADGEN_COMPUTED_KEYS } from "../src/leadgen/computed";
import { CANONICAL_MACROS } from "../src/leadgen/macros";
import {
  buildPayload,
  LEADGEN_PAYLOAD_BLOCKING_ERROR_CODES,
  LEADGEN_PAYLOAD_WARNING_ERROR_CODES,
  LEADGEN_TRANSFORM_KINDS,
  type LeadgenPayloadSchema,
} from "../src/leadgen/payload";
import {
  PAYLOAD_BOOLEAN_PRESETS,
  PAYLOAD_DATE_FORMATS,
  PAYLOAD_CONDITION_OPS,
  PAYLOAD_SCHEMA_ERROR_HINTS,
  PAYLOAD_SOURCE_GROUPS,
  PAYLOAD_TEST_CONTEXT_DEFAULTS,
} from "../src/admin/leadgen/ui-payload-builder";

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
          sdb.prepare(sql).run(...binds);
          return { success: true, meta: {} };
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

function createLeadgenDb(DatabaseSync: DatabaseSyncCtor): SqliteDb {
  const sdb = new DatabaseSync(":memory:");
  runSql(
    sdb,
    "CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT);" +
      "CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT);",
  );
  for (const file of LEADGEN_MIGRATIONS) {
    runSql(sdb, readFileSync(join(TEST_DIR, "../migrations", file), "utf8"));
  }
  return sdb;
}

// The builder island loads a draft through env.CACHE (KV) — a tiny in-memory
// stub keeps the sample-answers endpoint functional in-process.
function memoryKv(): KVNamespace {
  const store = new Map<string, string>();
  return {
    async get(key: string) {
      return store.has(key) ? (store.get(key) as string) : null;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
  } as unknown as KVNamespace;
}

function buildEnv(db: D1Database): Env {
  return {
    DB: db,
    CACHE: memoryKv(),
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
  };
}

const DatabaseSync = loadDatabaseSync();
const describeDb = DatabaseSync === null ? describe.skip : describe;

function newHarness(): { sdb: SqliteDb; env: Env } {
  const ctor = DatabaseSync as DatabaseSyncCtor;
  const sdb = createLeadgenDb(ctor);
  return { sdb, env: buildEnv(d1FromSqlite(sdb)) };
}

// --- seed through the REAL B1 API ---------------------------------------------

const API = "/api/admin/leadgen";

function jsonInit(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

interface OfferDetail {
  id: number;
  public_id: string;
  placements: Array<{ id: number; public_id: string; placement_id: string; is_default: boolean }>;
  [key: string]: unknown;
}

async function createOffer(
  env: Env,
  overrides: Record<string, unknown> = {},
): Promise<OfferDetail> {
  const res = await admin.request(
    `${API}/offers`,
    jsonInit("POST", {
      offer_name: "Builder Offer",
      activity: "quote_funnel",
      vertical: "auto",
      conversion_tracking_method: "s2s_postback",
      offer_type: "cpc",
      placements: [`pl-${mintPublicId("offer").slice(-8)}`],
      cap_enabled: false,
      calls_provider_api: true,
      bid_source: "response",
      ...overrides,
    }),
    env,
  );
  expect(res.status).toBe(201);
  return (await res.json()) as OfferDetail;
}

async function patchOffer(
  env: Env,
  id: string | number,
  body: Record<string, unknown>,
): Promise<void> {
  const res = await admin.request(`${API}/offers/${id}`, jsonInit("PATCH", body), env);
  expect(res.status, `PATCH offer ${id}: ${await res.clone().text()}`).toBe(200);
}

// A schema exercising EVERY §6 surface: nested object, value map +
// choiceDisplay (§6.3/§6.4), date mode via formatDate (§6.6), boolean
// value-map preset (§6.7), macro/computed/placement/token sources (§6.2),
// array + numeric-segment item (§6.8), default/fallback + notes (§6.9),
// conditional (§6.10). MUST pass the server's save validation as-is.
const RICH_SCHEMA = {
  version: 1,
  root: {
    type: "object",
    children: [
      { path: "data", name: "data", type: "object", required: false, source: "static", value: {} },
      {
        path: "data.home_own",
        name: "home_own",
        label: "Home ownership",
        type: "string",
        required: true,
        source: "answer",
        internal_field: "homeowner",
        value_map: { own: "H", rent: "R", other_situation: "O" },
        choiceDisplay: {
          mainValues: ["own", "rent"],
          otherGroupEnabled: true,
          otherGroupLabel: "More options",
          searchableOther: true,
        },
      },
      {
        path: "data.dob",
        name: "dob",
        label: "Date of birth",
        type: "string",
        source: "answer",
        internal_field: "dob",
        transform: [{ kind: "formatDate", format: "MM/DD/YYYY" }],
      },
      {
        path: "data.newsletter",
        name: "newsletter",
        type: "string",
        source: "answer",
        internal_field: "newsletter",
        value_map: { true: "1", false: "0" },
      },
      {
        path: "data.src",
        name: "src",
        type: "string",
        source: "static",
        value: "web",
        default: "web",
        fallback: "web",
        notes: "traffic source tag",
      },
      { path: "meta.click_id", name: "click_id", type: "string", source: "macro", macro: "click_id" },
      { path: "meta.ts", name: "ts", type: "number", source: "computed", computed: "request_timestamp" },
      { path: "meta.pl", name: "pl", type: "string", source: "placement" },
      { path: "auth_token", name: "auth_token", type: "string", source: "token" },
      { path: "drivers", name: "drivers", type: "array", required: false, source: "static", value: [] },
      {
        path: "drivers.0.age",
        name: "age",
        type: "number",
        source: "answer",
        internal_field: "driver_1_age",
        conditional: { when: "homeowner", op: "eq", value: "own" },
      },
    ],
  },
};

async function postSchema(
  env: Env,
  id: string | number,
  schema: unknown = RICH_SCHEMA,
  carrierParse?: Record<string, unknown>,
): Promise<number> {
  const res = await admin.request(
    `${API}/offers/${id}/payload-schemas`,
    jsonInit("POST", {
      schema_json: schema,
      ...(carrierParse !== undefined ? { carrier_parse_json: carrierParse } : {}),
    }),
    env,
  );
  expect(res.status, `POST schema for ${id}: ${await res.clone().text()}`).toBe(201);
  return ((await res.json()) as { id: number }).id;
}

// Link a Section carrying answer components → builder_context.linked_fields
// (offers-handlers.readLinkedSectionFields parses content_json.components).
function linkSection(sdb: SqliteDb, offerId: number, sectionName: string): void {
  const contentJson = JSON.stringify({
    components: [
      {
        id: "q1",
        type: "ChoiceGroup",
        internal_field: "homeowner",
        answer_type: "enum",
        choices: [
          { value: "own", label: "I own my home" },
          { value: "rent", label: "I rent" },
          { value: "other_situation", label: "Something else" },
        ],
      },
      { id: "q2", type: "DateQuestion", internal_field: "dob", answer_type: "date" },
      { id: "q3", type: "YesNoQuestion", internal_field: "newsletter", answer_type: "boolean" },
      { id: "q4", type: "NumberQuestion", internal_field: "driver_1_age", answer_type: "number" },
    ],
  });
  sdb
    .prepare(
      "INSERT INTO leadgen_sections (public_id, section_name, activity, vertical, headline_text, content_json) VALUES (?, ?, 'quote_funnel', 'auto', 'H', ?)",
    )
    .run(mintPublicId("section"), sectionName, contentJson);
  const row = sdb
    .prepare("SELECT id FROM leadgen_sections WHERE section_name = ?")
    .get(sectionName) as { id: number };
  sdb
    .prepare(
      "INSERT INTO leadgen_section_available_offers (section_id, offer_id, selected) VALUES (?, ?, 1)",
    )
    .run(row.id, offerId);
}

async function getHtml(env: Env, path: string, expectedStatus = 200): Promise<string> {
  const res = await admin.request(path, {}, env);
  expect(res.status, `${path} status`).toBe(expectedStatus);
  return res.text();
}

// The fully-seeded editor page most tests read: rich schema + 2 placements +
// a linked Section + a production endpoint.
async function richEditorPage(): Promise<{ html: string; offer: OfferDetail; sdb: SqliteDb; env: Env }> {
  const { sdb, env } = newHarness();
  const offer = await createOffer(env, { placements: ["pl-main", "pl-alt"] });
  await patchOffer(env, offer.public_id, {
    endpoint_production: "https://provider.example/api/quotes",
  });
  linkSection(sdb, offer.id, "Home Details");
  await postSchema(env, offer.public_id);
  const html = await getHtml(env, `/admin/leadgen/offers/${offer.public_id}/edit`);
  return { html, offer, sdb, env };
}

// Extract a JSON bootstrap island's parsed payload.
function island(html: string, id: string): unknown {
  const re = new RegExp(
    `<script type="application/json" id="${id}">([\\s\\S]*?)</script>`,
  );
  const m = html.match(re);
  expect(m, `island ${id} present`).not.toBeNull();
  return JSON.parse(m![1] ?? "null");
}

// Extract one <select ...> block (opening tag matched by marker attribute).
function selectBlock(html: string, marker: string): string {
  const start = html.indexOf(marker);
  expect(start, `select marker ${marker}`).toBeGreaterThan(-1);
  const open = html.lastIndexOf("<select", start);
  const close = html.indexOf("</select>", start);
  expect(open).toBeGreaterThan(-1);
  expect(close).toBeGreaterThan(open);
  return html.slice(open, close);
}

function optionValues(block: string): string[] {
  return [...block.matchAll(/<option value="([^"]*)"/g)].map((m) => m[1] ?? "");
}

// ---------------------------------------------------------------------------
// §6.1 — three-pane shell
// ---------------------------------------------------------------------------

describeDb("payload builder §6.1 — three-pane shell", () => {
  it("renders the tree / editor / right-column panes with toolbar, search and templates", async () => {
    const { html } = await richEditorPage();
    for (const hook of [
      'data-pb-shell',
      'data-pb-pane="tree"',
      'data-pb-pane="editor"',
      'data-pb-pane="side"',
      'id="lg-pb-tree"',
      'id="lg-pb-editor"',
      'id="lg-pb-search"',
      'data-pb-add="field"',
      'data-pb-add="object"',
      'data-pb-add="array"',
      'id="lg-schema-preview"',
      'id="lg-pb-validation"',
      'id="lg-pb-validation-summary"',
      'id="lg-pb-sample"',
      'id="lg-pb-test-chip"',
      'data-pb-open-test',
      'id="lg-pb-editor-template"',
      'id="lg-pb-valuemap-modal"',
      'id="lg-schema-save"',
      'id="lg-schema-copy"',
    ]) {
      expect(html, `shell hook ${hook}`).toContain(hook);
    }
    // tree row anatomy + badge + jump hooks live in the inline script
    for (const hook of [
      "data-pb-toggle",
      "data-pb-select",
      "data-pb-act",
      "lg-pb-badge-required",
      "lg-pb-badge-mapped",
      "lg-pb-badge-error",
      "lg-pb-pulse",
    ]) {
      expect(html, `script hook ${hook}`).toContain(hook);
    }
  });

  it("normal mode has NO dotted-path typing and none of the old raw-input rows (M2)", async () => {
    const { html } = await richEditorPage();
    // the old §11.1 MVP rows are gone entirely
    expect(html).not.toContain("data-node-field=");
    expect(html).not.toContain('id="lg-node-rows"');
    expect(html).not.toContain('id="lg-node-template"');
    // no path input anywhere in the editor template — names only
    expect(html).not.toContain('data-pb-field="path"');
    expect(html).toContain("The tree position decides the full path");
  });

  it("last-Test chip: untested for a fresh offer; passed for a fully-proven offer", async () => {
    const { html } = await richEditorPage();
    expect(html).toContain('data-test-status="untested"');

    const { sdb, env } = newHarness();
    const offer = await createOffer(env, { placements: ["pl-solo"] });
    await patchOffer(env, offer.public_id, {
      endpoint_production: "https://provider.example/api/quotes",
    });
    await postSchema(env, offer.public_id, RICH_SCHEMA, {
      carriers_path: "carriers",
      fields: { carrier_name: "name", bid: "bid", click_url: "url" },
    });
    sdb
      .prepare(
        "INSERT INTO leadgen_provider_request_log (offer_public_id, environment, status_code) VALUES (?, 'production', 200)",
      )
      .run(offer.public_id);
    const provenHtml = await getHtml(env, `/admin/leadgen/offers/${offer.public_id}/edit`);
    expect(provenHtml).toContain('data-test-status="passed"');
  });

  it("rename impact warning + descendant rewrite hooks ride the island script", async () => {
    const { html } = await richEditorPage();
    expect(html).toContain("data-pb-rename-impact");
    expect(html).toContain("mapped field");
    expect(html).toContain("renamePrefix");
  });

  it("§6.1 last-Test chip SSRs `passed <ts>` / `failed <ts>` from the additive last_test_at", async () => {
    // PASSED with a deterministic timestamp
    const passed = await (async () => {
      const { sdb, env } = newHarness();
      const offer = await createOffer(env, { placements: ["pl-ts"] });
      await patchOffer(env, offer.public_id, {
        endpoint_production: "https://provider.example/api/quotes",
      });
      await postSchema(env, offer.public_id, RICH_SCHEMA, {
        carriers_path: "carriers",
        fields: { carrier_name: "name", bid: "bid", click_url: "url" },
      });
      sdb
        .prepare(
          "INSERT INTO leadgen_provider_request_log (offer_public_id, environment, status_code, created_at) VALUES (?, 'production', 200, ?)",
        )
        .run(offer.public_id, 1_783_468_800);
      return getHtml(env, `/admin/leadgen/offers/${offer.public_id}/edit`);
    })();
    const expectedTs = `${new Date(1_783_468_800 * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC`;
    expect(passed).toContain('data-test-status="passed"');
    expect(passed).toContain(`Test: passed at ${expectedTs}`);

    // FAILED keeps the eligibility-derived state + gains the timestamp
    const failed = await (async () => {
      const { sdb, env } = newHarness();
      const offer = await createOffer(env, { placements: ["pl-ts2"] });
      sdb
        .prepare(
          "INSERT INTO leadgen_provider_request_log (offer_public_id, environment, status_code, created_at) VALUES (?, 'production', 500, ?)",
        )
        .run(offer.public_id, 1_783_468_800);
      return getHtml(env, `/admin/leadgen/offers/${offer.public_id}/edit`);
    })();
    expect(failed).toContain('data-test-status="failed"');
    expect(failed).toContain(`Test: failed at ${expectedTs}`);

    // UNTESTED (no rows) stays timestamp-free
    const { html: untested } = await richEditorPage();
    expect(untested).toContain('data-test-status="untested"');
    expect(untested).not.toContain("Test: untested at");
  });
});

// ---------------------------------------------------------------------------
// §6.2 — grouped source picker
// ---------------------------------------------------------------------------

describeDb("payload builder §6.2 — grouped source picker", () => {
  it("renders the UI groups with exact members and storage-encoded option values", async () => {
    const { html } = await richEditorPage();
    const block = selectBlock(html, "data-pb-source-select");
    for (const group of [
      "User answer",
      "Static value",
      "Request / Cloudflare",
      "Traffic / URL",
      "Session",
      "Offer / Auction",
      "Computed",
      "Secret token",
    ]) {
      expect(block, `group ${group}`).toContain(`<optgroup label="${group}"`);
    }
    const values = optionValues(block);
    // storage encodings — enums unchanged underneath
    for (const v of ["answer", "static", "placement", "token", "macro:ip", "macro:utm_source", "macro:session_id", "macro:offer_id", "computed:timezone"]) {
      expect(values, `member ${v}`).toContain(v);
    }
    // per-member inline help (§6.2 example verbatim)
    expect(block).toContain(
      "IP address — the visitor&#39;s IP at request time, e.g. 203.0.113.7",
    );
    // Placement ID member maps to source:"placement" (04 §4.5)
    expect(block).toMatch(/<option value="placement"[^>]*>Placement ID<\/option>/);
  });

  it("Computed dropdown = registry keys ONLY, each option label — description (example)", async () => {
    const { html } = await richEditorPage();
    const block = selectBlock(html, "data-pb-source-select");
    const values = optionValues(block);
    for (const key of LEADGEN_COMPUTED_KEYS) {
      expect(values, `computed:${key}`).toContain(`computed:${key}`);
    }
    // no computed option outside the registry
    const computedValues = values.filter((v) => v.startsWith("computed:"));
    expect(new Set(computedValues).size).toBe(LEADGEN_COMPUTED_KEYS.length);
    // label carries `label — description (example)` (04 §4.4)
    const rt = COMPUTED_REGISTRY["request_timestamp"]!;
    expect(block).toContain(`${rt.label} — ${rt.description} (${rt.example})`);
  });

  it("the full 32-macro list rides Advanced-only optgroups; the flat select is gone (M2)", async () => {
    const { html } = await richEditorPage();
    const block = selectBlock(html, "data-pb-source-select");
    const advancedGroups = [...block.matchAll(/<optgroup label="Advanced macro[^"]*" data-advanced-only="1">/g)];
    expect(advancedGroups.length).toBeGreaterThanOrEqual(4);
    const values = optionValues(block);
    for (const macro of CANONICAL_MACROS) {
      expect(values, `advanced macro ${macro}`).toContain(`macro:${macro}`);
    }
    // exported groups agree: advanced-only groups carry every canonical macro
    const advMembers = PAYLOAD_SOURCE_GROUPS.filter((g) => g.advancedOnly)
      .flatMap((g) => g.members.map((m) => m.value.replace("macro:", "")))
      .sort();
    expect(advMembers).toEqual([...CANONICAL_MACROS].sort());
    // the script strips advanced groups in normal mode
    expect(html).toContain("stripAdvancedSourceGroups");
  });

  it("inexpressible members are OMITTED, never disabled-but-visible (postal / page_view_id / auction_instance_id)", async () => {
    const { html } = await richEditorPage();
    const block = selectBlock(html, "data-pb-source-select");
    expect(block).not.toContain("page_view_id");
    expect(block).not.toContain("funnel_attempt_id");
    expect(block).not.toContain("auction_instance_id");
    expect(block).not.toContain("Postal code");
    expect(block).not.toContain("disabled");
  });
});

// ---------------------------------------------------------------------------
// §6.3 + §6.4 — value-map table + Other grouping
// ---------------------------------------------------------------------------

describeDb("payload builder §6.3/§6.4 — value-map table + choiceDisplay", () => {
  // P5 F1 (MINOR-2): the "Other group?" column is GONE — it rendered
  // node.choiceDisplay.otherGroupEnabled, retired in §10 and unauthorable
  // anywhere since, so every cell was a permanent em-dash placeholder. The
  // remaining 7 columns are the live §6.3 set.
  it("modal table renders the 7 live §6.3 columns exactly, in order — the retired Other-group column is GONE", async () => {
    const { html } = await richEditorPage();
    const expected = [
      "Display label",
      "Internal normalized value",
      "Provider output value",
      "Output type",
      "Main choice?",
      "Analytics label",
      "Notes",
    ];
    let cursor = html.indexOf('data-vm-table');
    expect(cursor).toBeGreaterThan(-1);
    for (const label of expected) {
      const at = html.indexOf(`>${label}</th>`, cursor);
      expect(at, `column ${label} in order`).toBeGreaterThan(cursor);
      cursor = at;
    }
    const colKeys = [...html.matchAll(/data-vm-col="([^"]+)"/g)].map((m) => m[1]);
    expect(colKeys).toEqual([
      "display_label",
      "internal",
      "output",
      "output_type",
      "main",
      "analytics_label",
      "notes",
    ]);
    expect(html, "the retired Other-group column header is gone").not.toContain("Other group?");
  });

  it("actions: Add value · Add many · Bulk paste · Import CSV (client-side, column mapping) · search · sort", async () => {
    const { html } = await richEditorPage();
    for (const hook of [
      "data-vm-add>",
      "data-vm-add-many>",
      "data-vm-bulk>",
      'data-vm-csv accept=".csv,text/csv"',
      "data-vm-search",
      "data-vm-sort",
      'data-vm-csv-col="internal"',
      'data-vm-csv-col="output"',
      'data-vm-csv-col="main"',
      "data-vm-csv-apply",
      "data-vm-add-many-text",
    ]) {
      expect(html, `vm hook ${hook}`).toContain(hook);
    }
    // row actions + CSV parse live in the script
    for (const s of ["Mark as main", "parseCsv", "FileReader", "data-vm-row-act"]) {
      expect(html, `vm script ${s}`).toContain(s);
    }
    expect(html).toContain("internal=provider");
  });

  // P5 F1 (MINOR-2): every trace of the retired Other-group vocabulary is gone
  // from what this builder SERVES — the column, the "N in Other" chip wording,
  // the "Move to Other" row action AND the HTML/JS comments that still named
  // the dead otherGroupEnabled/searchableOther/"Group extra choices under
  // Other" controls in the bytes shipped to the browser.
  it("MINOR-2: the retired Other-group vocabulary is absent from the SERVED bytes (column, chip wording, row action, comments)", async () => {
    const { html } = await richEditorPage();
    for (const dead of [
      "Other group?",
      'data-vm-col="other"',
      "Move to Other",
      "Group extra choices under Other",
      "Searchable Other panel",
      "in Other",
      "moving some to Other",
    ]) {
      expect(html, `retired Other-group token still served: ${dead}`).not.toContain(dead);
    }
    // The retired KEYS survive only as PRESERVED STORED DATA on a legacy node
    // (the RICH_SCHEMA fixture carries one, and the builder round-trips unknown
    // keys verbatim) — never as code, a control or a served comment. The
    // island script must not mention them at all.
    const islandCode = extractScripts(html).join("\n");
    for (const dead of ["otherGroupEnabled", "otherGroupLabel", "searchableOther"]) {
      expect(islandCode, `retired key still referenced by the island: ${dead}`).not.toContain(dead);
    }
    // the still-live Main-choice mechanism is untouched
    expect(html).toContain("Main choice?");
    expect(html).toContain("mainValues");
    expect(html).toContain("Mark as main");
    // both count chips now speak the one live wording
    expect(html).toContain("' main \\u00b7 ' + rows.length + ' values'");
    expect(html).toContain("' main \\u00b7 ' + entries.length + ' values'");
  });

  it("footer: unmapped-internal-values warning + the miss ⇒ invalid ⇒ fallback reminder", async () => {
    const { html } = await richEditorPage();
    expect(html).toContain("data-vm-unmapped-warning");
    expect(html).toContain("missing from this map");
    // the reminder renders (entity-encoded arrows) in modal + compact panel
    expect(html.split("miss &#8658; invalid &#8658; fallback").length).toBeGreaterThanOrEqual(2);
  });

  // P5 S5c — Issue #10 remnant REMOVED: otherGroupEnabled/otherGroupLabel/
  // searchableOther were leftover authoring controls for the choiceDisplay
  // "Other group" mechanism the STUDIO already retired (§10) and the funnel
  // runtime never reads (presets.ts: "the §10-retired choiceDisplay/
  // Other-group mechanism is fully removed") — an operator could toggle them
  // with zero live effect. "Main choice?" (mainValues) is a SEPARATE,
  // still-live mechanism and keeps its own controls/chips/warn threshold.
  it("§6.4 Main-choice controls: Main checkbox column, count chips, soft >9 warn — the retired otherGroup/searchableOther authoring controls are GONE", async () => {
    const { html } = await richEditorPage();
    for (const hook of ["data-pb-choice-chips", "data-pb-main-warn", "data-vm-count-chips", "data-vm-main-warn"]) {
      expect(html, `Main-choice hook ${hook}`).toContain(hook);
    }
    // emission target + soft-warn threshold live in the script
    expect(html).toContain("mainValues");
    expect(html).toContain("more than 9 gets crowded");
    // the retired remnant control is gone from the SSR markup
    for (const hook of ['data-pb-field="otherGroupEnabled"', 'data-pb-field="otherGroupLabel"', 'data-pb-field="searchableOther"']) {
      expect(html, `retired hook ${hook} must be gone`).not.toContain(hook);
    }
  });

  // MINOR-6 (adversarial): a `"` only opens a quoted cell when the cell buffer
  // is EMPTY, so a mid-cell quote is literal and a comma still splits.
  it("MINOR-6: CSV parser only quotes at cell start — a mid-cell quote does not swallow the comma", async () => {
    const { html } = await richEditorPage();
    const script = extractScripts(html).find((s) => s.includes("function parseCsv("));
    expect(script, "parseCsv island present").toBeDefined();
    const source = ["trimStr", "parseCsv"].map((n) => sliceIslandFunction(script!, n)).join("\n");
    const { parseCsv } = runInNewContext(`${source}\n({ parseCsv: parseCsv })`, {}) as {
      parseCsv: (t: string) => string[][];
    };
    // mid-cell quote is literal; the comma still delimits (pre-fix: one merged cell).
    expect(parseCsv('ab"cd,ef"g\n')).toEqual([['ab"cd', 'ef"g']]);
    // a genuinely quoted cell (quote at cell start) still protects its comma.
    expect(parseCsv('"a,b",c\n')).toEqual([["a,b", "c"]]);
    // escaped quote inside a quoted cell still collapses.
    expect(parseCsv('"a""b",c\n')).toEqual([['a"b', "c"]]);
  });

  // nano-7 (adversarial): a reserved-name internal value (__proto__ etc.) would
  // be a silent no-op on a plain-object map (the row would vanish). The apply
  // path skips it EXPLICITLY and surfaces a notice, rather than swallowing it.
  it("nano-7: value-map apply guards reserved internal keys explicitly (not a silent no-op)", async () => {
    const { html } = await richEditorPage();
    const script = extractScripts(html).find((s) => s.includes("data-vm-apply"));
    expect(script, "value-map apply island present").toBeDefined();
    // the FORBIDDEN_SEGMENTS guard + the operator notice live in the apply path
    expect(script).toContain("FORBIDDEN_SEGMENTS.indexOf(internalKey)");
    expect(script).toContain("reserved-name row(s) skipped");
  });
});

// ---------------------------------------------------------------------------
// §6.5 / §6.6 / §6.7 — free text, date mode, boolean presets
// ---------------------------------------------------------------------------

describeDb("payload builder §6.5–§6.7 — free text / date / boolean", () => {
  it("§6.5 free-text toggle with explanation; mapping disabled visually, required/default/fallback kept", async () => {
    const { html } = await richEditorPage();
    expect(html).toContain('data-pb-field="free_text"');
    expect(html).toContain("Free text (no fixed answer list)");
    expect(html).toContain("value-map table and valid-values chips are off");
    expect(html).toContain("data-pb-freetext-note");
  });

  it("§6.5 constraints: max-length input + pattern preset select (+custom input) live in the NORMAL-mode panel", async () => {
    const { html } = await richEditorPage();
    expect(html).toContain("data-pb-freetext-constraints");
    expect(html).toContain('data-pb-field="free_text_max_length"');
    const patternBlock = selectBlock(html, 'data-pb-field="free_text_pattern"');
    expect(optionValues(patternBlock)).toEqual(["none", "letters", "digits", "custom"]);
    expect(html).toContain('data-pb-field="free_text_pattern_custom"');
    // violation semantics explained beside the controls
    expect(html).toContain("does not match the pattern is INVALID at runtime");
    // NORMAL mode: the constraint controls are NOT gated behind an Advanced drawer
    const constraintsAt = html.indexOf("data-pb-freetext-constraints");
    const advancedRe = /<details[^>]*data-lg-advanced[^>]*>[\s\S]*?<\/details>/g;
    let gated = false;
    for (const m of html.matchAll(advancedRe)) {
      const start = m.index ?? 0;
      if (constraintsAt >= start && constraintsAt < start + m[0].length) gated = true;
    }
    expect(gated).toBe(false);
  });

  it("§6.5 the island script represents the new fields (KNOWN_NODE_KEYS) and mirrors the typed error", async () => {
    const { html } = await richEditorPage();
    // KNOWN_NODE_KEYS extension — constrained nodes are NOT advanced-managed
    expect(html).toContain("'free_text_max_length', 'free_text_pattern', 'free_text_pattern_custom'");
    // live client mirror of the server's typed blocking error
    expect(html).toContain("free_text_constraint_invalid");
    // ...and the blocking-codes footer documents it (rendered from payload.ts)
    expect(LEADGEN_PAYLOAD_BLOCKING_ERROR_CODES).toContain("free_text_constraint_invalid");
    expect(html).toContain("<li><code>free_text_constraint_invalid</code></li>");
    // the §6.11 hint table covers it
    expect(PAYLOAD_SCHEMA_ERROR_HINTS["free_text_constraint_invalid"]).toBeTruthy();
  });

  it("§6.5 a schema with free-text constraints round-trips through the bootstrap island", async () => {
    const { sdb, env } = newHarness();
    const offer = await createOffer(env, { placements: ["pl-main"] });
    linkSection(sdb, offer.id, "Home Details");
    const schema = JSON.parse(JSON.stringify(RICH_SCHEMA)) as typeof RICH_SCHEMA & {
      root: { children: Array<Record<string, unknown>> };
    };
    schema.root.children.push({
      path: "first_name",
      name: "first_name",
      type: "string",
      source: "answer",
      internal_field: "first_name",
      free_text_max_length: 40,
      free_text_pattern: "custom",
      free_text_pattern_custom: "^[A-Za-z '-]+$",
    });
    await postSchema(env, offer.public_id, schema);
    const html = await getHtml(env, `/admin/leadgen/offers/${offer.public_id}/edit`);
    const data = island(html, "lg-payload-data") as {
      active_schema: { schema: { root: { children: Array<Record<string, unknown>> } } };
    };
    const node = data.active_schema.schema.root.children.find((n) => n["path"] === "first_name");
    expect(node).toBeDefined();
    expect(node!["free_text_max_length"]).toBe(40);
    expect(node!["free_text_pattern"]).toBe("custom");
    expect(node!["free_text_pattern_custom"]).toBe("^[A-Za-z '-]+$");
  });

  it("§6.6 date format picker: the formatDate-expressible formats + Custom; Unix timestamp OMITTED", async () => {
    const { html } = await richEditorPage();
    const block = selectBlock(html, 'data-pb-field="date_format"');
    const values = optionValues(block);
    expect(values).toEqual(PAYLOAD_DATE_FORMATS.map((f) => f.value));
    expect(values).toEqual([
      "YYYY-MM-DD",
      "MM/DD/YYYY",
      "DD/MM/YYYY",
      "YYYY-MM-DDTHH:mm:ssZ",
      "__custom__",
    ]);
    expect(block).not.toContain("Unix");
    // token help + live preview + invalid→fallback note
    expect(html).toContain("Tokens: YYYY MM DD HH mm ss (UTC)");
    expect(html).toContain("data-pb-date-sample");
    expect(html).toContain("data-pb-date-preview");
    expect(html).toContain("data-pb-date-invalid-note");
    // emission is the existing formatDate transform, never typed JSON
    expect(html).toContain("formatDate");
  });

  // P5 S5c (SRC-7B, owner A.1 #7B verbatim: "I can define that I want the
  // currency will be passed to the offer in the auction and I can define
  // that only the number is sent, and I can define that the number will be
  // sent as string"). A first-class visual control, emitting formatCurrency/
  // toNumber/toString exactly the way the date panel above emits formatDate
  // (LEADGEN_TRANSFORM_KINDS, src/leadgen/payload.ts) — never raw JSON.
  it("SRC-7B: the output-format picker offers currency/number/string, live-previews, and is EXCLUDED from computeAdvReasons' transform-pipeline Advanced-drawer flag", async () => {
    const { html } = await richEditorPage();
    const block = selectBlock(html, 'data-pb-field="output_format"');
    expect(optionValues(block)).toEqual(["", "formatCurrency", "toNumber", "toString"]);
    expect(block).toContain("Currency string");
    expect(block).toContain("Number as string");
    expect(html).toContain("data-pb-outputformat-sample");
    expect(html).toContain("data-pb-outputformat-preview");
    expect(html).toContain("data-pb-outputformat-invalid-note");
    // emission is the real transform kinds, never typed JSON
    expect(html).toContain("formatCurrency");
    // isOutputFormatNode recognizes exactly the 3 kinds this control offers
    // (the SAME real function computeAdvReasons consults to skip the generic
    // "transform pipeline" Advanced-drawer flag, mirroring isDateNode's own
    // carve-out for formatDate) — a 4th, unrelated kind (e.g. trim) does not
    // match, so it still routes to Advanced.
    const script = extractScripts(html).find((s) => s.includes("function isOutputFormatNode("));
    expect(script, "isOutputFormatNode island present").toBeDefined();
    const source = ["outputFormatTypeFor", "isOutputFormatNode"]
      .map((n) => sliceIslandFunction(script!, n))
      .join("\n");
    const sandbox = runInNewContext(
      `${source}\n({
        currency: isOutputFormatNode({ transform: [{ kind: "formatCurrency" }] }),
        num: isOutputFormatNode({ transform: [{ kind: "toNumber" }] }),
        str: isOutputFormatNode({ transform: [{ kind: "toString" }] }),
        trim: isOutputFormatNode({ transform: [{ kind: "trim" }] }),
        none: isOutputFormatNode({}),
      })`,
      {},
    ) as { currency: boolean; num: boolean; str: boolean; trim: boolean; none: boolean };
    expect(sandbox).toEqual({ currency: true, num: true, str: true, trim: false, none: false });
  });

  it("§6.7 boolean presets: the 6 options with exact value_map emissions + preview chips", async () => {
    const { html } = await richEditorPage();
    const block = selectBlock(html, 'data-pb-field="bool_preset"');
    const pairs = [...block.matchAll(/<option value="([^"]+)" data-true-json="([^"]*)" data-false-json="([^"]*)"/g)].map(
      (m) => [m[1], m[2], m[3]],
    );
    expect(pairs).toEqual(
      PAYLOAD_BOOLEAN_PRESETS.map((p) => [
        p.id,
        p.true_json.replace(/"/g, "&quot;"),
        p.false_json.replace(/"/g, "&quot;"),
      ]),
    );
    expect(pairs.map((p) => p[0])).toEqual(["bool", "str10", "num10", "yn", "yesno", "custom"]);
    expect(html).toContain("data-pb-bool-chip-true");
    expect(html).toContain("data-pb-bool-chip-false");
    expect(html).toContain("data-pb-bool-custom");
  });
});

// ---------------------------------------------------------------------------
// P5 F1 — the output-format control OWNS the emitted shape (owner A.1 #7B +
// A.1 #6 second imperative, ruling D9)
// ---------------------------------------------------------------------------
//
// The defect this pins closed: the control wrote node.transform ONLY. payload.ts
// resolveNode runs coerceToType AFTER applyTransformPipeline, so the stored
// type had the last word and silently undid the pick — "Currency string" on a
// number field emitted {} (field DROPPED) and "Number as string" emitted an
// unquoted 170000, while this panel previewed "170000 → $170,000" and the
// validation panel read "✓ No issues". Three surfaces agreeing over a runtime
// that threw the value away.
//
// E11: the preview matrix below compares the ISLAND's own mirror against the
// REAL buildPayload from src/leadgen/payload.ts — one side of the boundary is
// always the real artifact, never two hand-built sides.

interface OutputFormatIsland {
  outputFormatTypeFor(kind: string | null): string | null;
  isOutputFormatNode(node: Record<string, unknown>): boolean;
  outputFormatKindOf(node: Record<string, unknown>): string;
  applyOutputFormat(node: Record<string, unknown>, kind: string): void;
  outputFormatPreviewValue(node: Record<string, unknown>, raw: unknown): unknown;
}

// The REAL served island functions, sliced out of the REAL rendered page.
function outputFormatIsland(html: string): { island: OutputFormatIsland; source: string } {
  const script = extractScripts(html).find((s) => s.includes("function outputFormatPreviewValue("));
  expect(script, "output-format island present").toBeDefined();
  const names = [
    "trimStr",
    "isRecordVal",
    "outputFormatTypeFor",
    "isOutputFormatNode",
    "outputFormatKindOf",
    "applyOutputFormat",
    "clientFormatCurrency",
    "clientRunOutputFormat",
    "clientCoerceToType",
    "outputFormatPreviewValue",
  ];
  const source = names.map((n) => sliceIslandFunction(script!, n)).join("\n");
  const island = runInNewContext(
    `${source}\n({
      outputFormatTypeFor: outputFormatTypeFor,
      isOutputFormatNode: isOutputFormatNode,
      outputFormatKindOf: outputFormatKindOf,
      applyOutputFormat: applyOutputFormat,
      outputFormatPreviewValue: outputFormatPreviewValue
    })`,
    {},
  ) as OutputFormatIsland;
  return { island, source };
}

// One answer node, exactly as the builder stores it, fed to the REAL runtime.
function realPayload(node: Record<string, unknown>, answer: unknown): Record<string, unknown> {
  const schema = {
    version: 1,
    root: {
      type: "object",
      children: [{ path: "lead.amt", name: "amt", source: "answer", internal_field: "amount", ...node }],
    },
  } as unknown as LeadgenPayloadSchema;
  return buildPayload(schema, { answers: { amount: answer } });
}

describeDb("payload builder P5 F1 (SRC-7B / owner #7B + #6-second) — the output format writes type AND transform", () => {
  // The owner's three formats, plus "As entered". Each row is the WHOLE
  // contract of one <option>: what it stores, and what 170000 becomes.
  const TABLE = [
    { option: "", type: undefined as string | undefined, transform: undefined as unknown },
    { option: "formatCurrency", type: "string", transform: [{ kind: "formatCurrency" }] },
    { option: "toNumber", type: "number", transform: [{ kind: "toNumber" }] },
    { option: "toString", type: "string", transform: [{ kind: "toString" }] },
  ];

  it("ATOMIC: each option writes node.type AND node.transform together (As entered leaves the Type select in charge)", async () => {
    const { html } = await richEditorPage();
    const { island } = outputFormatIsland(html);
    for (const row of TABLE) {
      // start from the pre-fix hazard shape: a plain number answer node
      const node: Record<string, unknown> = { type: "number" };
      island.applyOutputFormat(node, row.option);
      expect(node["transform"], `${row.option || "(as entered)"} transform`).toEqual(row.transform);
      expect(node["type"], `${row.option || "(as entered)"} type`).toBe(row.type ?? "number");
      // and re-picking is idempotent, never a partial step
      island.applyOutputFormat(node, row.option);
      expect(node["transform"]).toEqual(row.transform);
    }
    // "As entered" on a STRING node leaves that type alone too
    const strNode: Record<string, unknown> = { type: "string", transform: [{ kind: "toNumber" }] };
    island.applyOutputFormat(strNode, "");
    expect(strNode).toEqual({ type: "string" });
  });

  it("NO HIDDEN STATE: every node the control writes is recognized by isOutputFormatNode (the control can always display what is stored)", async () => {
    const { html } = await richEditorPage();
    const { island } = outputFormatIsland(html);
    for (const row of TABLE.filter((r) => r.option !== "")) {
      const node: Record<string, unknown> = { type: "number" };
      island.applyOutputFormat(node, row.option);
      expect(island.isOutputFormatNode(node), `${row.option} recognized`).toBe(true);
      expect(island.outputFormatKindOf(node)).toBe(row.option);
      // …and the recognizer is type-BLIND, so a legacy/raw-JSON node whose
      // type contradicts its format is still DISPLAYED (and flagged), never
      // silently hidden with a live transform.
      const contradicting = { type: "boolean", transform: [{ kind: row.option }] };
      expect(island.isOutputFormatNode(contradicting)).toBe(true);
      expect(island.outputFormatTypeFor(row.option)).not.toBe("boolean");
    }
  });

  // MINOR-3: the island inlines its kind list (self-contained for vm-probe
  // slicing). This pins that copy set-equal to the control's own <option>
  // values AND inside the exported LEADGEN_TRANSFORM_KINDS, so the copies can
  // never drift apart again.
  it("MINOR-3: the inlined kind list == the control's <option> values == a subset of the exported LEADGEN_TRANSFORM_KINDS", async () => {
    const { html } = await richEditorPage();
    const { island, source } = outputFormatIsland(html);
    const optionKinds = optionValues(selectBlock(html, 'data-pb-field="output_format"')).filter((v) => v !== "");
    const inlined = [...sliceIslandFunction(source, "outputFormatTypeFor").matchAll(/kind === '([A-Za-z]+)'/g)].map(
      (m) => m[1] as string,
    );
    expect(inlined.slice().sort()).toEqual(optionKinds.slice().sort());
    for (const kind of inlined) {
      expect([...LEADGEN_TRANSFORM_KINDS], `${kind} is a real transform kind`).toContain(kind);
      expect(["string", "number"], `${kind} maps to a real node type`).toContain(island.outputFormatTypeFor(kind));
    }
    // a kind the control does NOT offer is not claimed by it
    expect(island.outputFormatTypeFor("trim")).toBeNull();
    expect(island.outputFormatTypeFor("formatDate")).toBeNull();
  });

  // E11 — the truthful preview. The island mirror must agree with the REAL
  // buildPayload for every option × every sample, including the shapes that
  // used to lie: currency-into-number (dropped) and number-as-string (emitted
  // unquoted).
  it("E11: the island preview == the REAL buildPayload output across {4 options} × {170000, 0, \"07032\", \"\", \"abc\"}", async () => {
    const { html } = await richEditorPage();
    const { island } = outputFormatIsland(html);
    const RAWS = ["170000", "0", "07032", "", "abc"];
    const rows: string[] = [];
    for (const option of TABLE.map((r) => r.option)) {
      // "As entered" is exercised on BOTH types the Type select can hold.
      const baseTypes = option === "" ? ["string", "number"] : ["number"];
      for (const baseType of baseTypes) {
        for (const raw of RAWS) {
          const node: Record<string, unknown> = { type: baseType };
          island.applyOutputFormat(node, option);
          const previewed = island.outputFormatPreviewValue(node, raw);
          const payload = realPayload(node, raw);
          const lead = (payload["lead"] ?? {}) as Record<string, unknown>;
          const emitted = Object.prototype.hasOwnProperty.call(lead, "amt") ? lead["amt"] : undefined;
          // buildPayload's cleanObject drops "" (and undefined) fields, so the
          // island's "" and undefined both mean "no field sent".
          if (previewed === undefined || previewed === "") {
            expect(emitted, `${option || "(as entered)"}/${baseType} "${raw}": field must be ABSENT`).toBeUndefined();
          } else {
            expect(emitted, `${option || "(as entered)"}/${baseType} "${raw}"`).toBe(previewed);
            expect(typeof emitted, `${option || "(as entered)"}/${baseType} "${raw}" JSON type`).toBe(typeof previewed);
          }
          rows.push(`${option || "(as entered)"}/${baseType} "${raw}" -> ${JSON.stringify(emitted ?? null)}`);
        }
      }
    }
    // 3 formats × 1 base type + "As entered" × 2 base types, all × 5 samples
    expect(rows).toHaveLength(25);
  });

  // Ruling D9 + the two shapes the owner named, through the STORED node the
  // control writes — the exact bytes one 170000 answer becomes per offer.
  it("D9: the control's own three nodes send \"$170,000\" · 170000 · \"170000\" for the same 170000 answer", async () => {
    const { html } = await richEditorPage();
    const { island } = outputFormatIsland(html);
    const sent = (option: string): unknown => {
      const node: Record<string, unknown> = { type: "number" };
      island.applyOutputFormat(node, option);
      return ((realPayload(node, 170000)["lead"] ?? {}) as Record<string, unknown>)["amt"];
    };
    expect(sent("formatCurrency")).toBe("$170,000");
    expect(sent("toNumber")).toBe(170000);
    expect(sent("toString")).toBe("170000");
    // the pre-fix shapes are now unreachable through the control: a
    // number-typed currency node DROPS the field, a number-typed toString node
    // emits an unquoted number. Both are what the control USED to store.
    const preFixCurrency = { type: "number", transform: [{ kind: "formatCurrency" }] };
    const preFixString = { type: "number", transform: [{ kind: "toString" }] };
    expect(realPayload(preFixCurrency, 170000)).toEqual({});
    expect(((realPayload(preFixString, 170000)["lead"] ?? {}) as Record<string, unknown>)["amt"]).toBe(170000);
  });

  // Owner A.1 #6 second imperative: "every component that include more than
  // one field- each field is potentially answering another offer field in
  // different formats per offer!!!" — an Address sub-field is a STRING answer,
  // so a number-only panel made that unauthorable through the named control.
  it("owner #6-second: the panel is authorable for STRING answers too (an address sub-field), date nodes excluded", async () => {
    const { html } = await richEditorPage();
    // the visibility predicate itself, read from the served island
    const script = extractScripts(html).find((s) => s.includes('data-pb-panel="outputformat"'));
    expect(script, "visibility island present").toBeDefined();
    expect(script).toContain("isAnswer && !isDateNode(node) && (dtype === 'number' || dtype === 'string'");
    // and the runtime half: a string ZIP answer reaches two offers in two
    // formats, both authored by this control (the SRC-6B pair).
    const { island } = outputFormatIsland(html);
    const asText: Record<string, unknown> = { type: "string" };
    island.applyOutputFormat(asText, "toString");
    const asNumber: Record<string, unknown> = { type: "string" };
    island.applyOutputFormat(asNumber, "toNumber");
    expect(asNumber["type"]).toBe("number");
    expect(((realPayload(asText, "07032")["lead"] ?? {}) as Record<string, unknown>)["amt"]).toBe("07032");
    expect(((realPayload(asNumber, "07032")["lead"] ?? {}) as Record<string, unknown>)["amt"]).toBe(7032);
  });

  it("the panel's own markup: sample box takes TEXT (a leading-zero ZIP survives), JSON-shape chip, type-owned note", async () => {
    const { html } = await richEditorPage();
    const block = selectBlock(html, 'data-pb-field="output_format"');
    expect(optionValues(block)).toEqual(["", "formatCurrency", "toNumber", "toString"]);
    expect(block).toContain("As entered (no formatting)");
    expect(html).toContain('<input type="text" inputmode="decimal" class="form-input" data-pb-outputformat-sample');
    expect(html).not.toContain('type="number" class="form-input" data-pb-outputformat-sample');
    expect(html).toContain("Try a sample value");
    expect(html).toContain("data-pb-outputformat-json");
    expect(html).toContain("data-pb-outputformat-type-note");
    // the Type select is disabled while a format owns the sent type
    expect(html).toContain("typeSel.disabled = isOutputFormatNode(node);");
    // and a type/format disagreement is a BLOCKING issue, never "✓ No issues"
    expect(html).toContain("output format sends");
    expect(html).toContain("transform_invalid");
  });
});

// ---------------------------------------------------------------------------
// §6.8 — object / array builders
// ---------------------------------------------------------------------------

describeDb("payload builder §6.8 — object/array builders", () => {
  it("object panel: child builder + subtree preview; array panel: item type + EXACTLY the 3 supported sources", async () => {
    const { html } = await richEditorPage();
    expect(html).toContain("data-pb-add-child");
    expect(html).toContain("data-pb-subtree-preview");
    const itemTypeBlock = selectBlock(html, 'data-pb-field="array_item_type"');
    expect(optionValues(itemTypeBlock)).toEqual(["string", "number", "boolean", "date", "object"]);
    const sourceBlock = selectBlock(html, 'data-pb-field="array_source"');
    // Computed + Split string are OMITTED (no runtime support — no computed
    // resolver emits a list; no split transform exists), never disabled.
    expect(optionValues(sourceBlock)).toEqual(["static_list", "multi_answer", "repeated_group"]);
    expect(sourceBlock).not.toContain("computed");
    expect(sourceBlock.toLowerCase()).not.toContain("split");
    // items[] presentation + path mechanics hidden
    expect(html).toContain("items[]");
    expect(html).toContain("you never type index paths");
    expect(html).toContain("data-pb-array-static-chips");
    expect(html).toContain("data-pb-array-add-item");
  });
});

// ---------------------------------------------------------------------------
// §6.9 — default / fallback builder
// ---------------------------------------------------------------------------

describeDb("payload builder §6.9 — default/fallback", () => {
  it("both controls offer Disabled · Static · Computed · Copied-from-field with inputs typed by the field", async () => {
    const { html } = await richEditorPage();
    for (const prefix of ["default", "fallback"] as const) {
      const modeBlock = selectBlock(html, `data-pb-${prefix}-mode`);
      expect(optionValues(modeBlock)).toEqual(["disabled", "static", "computed", "copy"]);
      expect(modeBlock).toContain("Computed value");
      expect(modeBlock).toContain("Copied from another field");
      for (const kind of ["text", "number", "boolean", "date"]) {
        expect(html, `${prefix} typed input ${kind}`).toContain(`data-pb-${prefix}-value="${kind}"`);
      }
      expect(html).toContain(`data-pb-${prefix}-copy-from`);
      expect(html).toContain(`data-pb-${prefix}-loose`);
    }
    // authoring-time copy semantics are explicit
    expect(html).toContain("a one-time copy, not a live link");
    // looseJson kill: typed inputs + a normalize prompt for legacy strings
    expect(html).toContain("data-pb-normalize");
    expect(html).toContain("Inputs always match the field type");
  });

  it("§6.9 computed option: BOTH slots carry a registry dropdown rendered through the §6.2 computed helper", async () => {
    const { html } = await richEditorPage();
    for (const prefix of ["default", "fallback"] as const) {
      expect(html, `${prefix} computed wrap`).toContain(`data-pb-${prefix}-computed-wrap`);
      const block = selectBlock(html, `data-pb-${prefix}-computed aria-label`);
      // registry keys only, complete
      expect(optionValues(block)).toEqual([...LEADGEN_COMPUTED_KEYS]);
      // §6.2 rendering: label — description (example)
      const rt = COMPUTED_REGISTRY["today_date_utc"]!;
      expect(block).toContain(`${rt.label} — ${rt.description} (${rt.example})`);
    }
  });

  it("§6.9 the island script EMITS the typed object and re-detects it (round-trip logic present)", async () => {
    const { html } = await richEditorPage();
    // emission: mode/dropdown handlers write { source: 'computed', key }
    expect(html).toContain("{ source: 'computed', key:");
    // detection: a stored ref renders as the computed mode (isComputedRef)
    expect(html).toContain("function isComputedRef(");
    // the sample payload reflects a computed DEFAULT via the registry example
    expect(html).toContain("computedExample(node['default'].key)");
  });

  it("§6.9 a schema with computed default/fallback refs round-trips through the bootstrap island", async () => {
    const { sdb, env } = newHarness();
    const offer = await createOffer(env, { placements: ["pl-main"] });
    linkSection(sdb, offer.id, "Home Details");
    const schema = JSON.parse(JSON.stringify(RICH_SCHEMA)) as typeof RICH_SCHEMA & {
      root: { children: Array<Record<string, unknown>> };
    };
    schema.root.children.push({
      path: "sent_at",
      name: "sent_at",
      type: "string",
      source: "answer",
      internal_field: "sent_at",
      default: { source: "computed", key: "today_date_utc" },
      fallback: { source: "computed", key: "timezone" },
    });
    await postSchema(env, offer.public_id, schema);
    const html = await getHtml(env, `/admin/leadgen/offers/${offer.public_id}/edit`);
    const data = island(html, "lg-payload-data") as {
      active_schema: { schema: { root: { children: Array<Record<string, unknown>> } } };
    };
    const node = data.active_schema.schema.root.children.find((n) => n["path"] === "sent_at");
    expect(node).toBeDefined();
    expect(node!["default"]).toEqual({ source: "computed", key: "today_date_utc" });
    expect(node!["fallback"]).toEqual({ source: "computed", key: "timezone" });
  });
});

// ---------------------------------------------------------------------------
// §6.10 — condition builder
// ---------------------------------------------------------------------------

// Executable-island harness (F-1): the REAL condition-builder functions are
// sliced out of the served script and executed in a vm over a minimal element
// stand-in that implements exactly the DOM surface they touch (attribute-
// presence selectors, children, value/hidden/tagName/type, cloneNode). This
// proves the render→read→render BEHAVIOR, not just source text.
interface FakeEl {
  tagName: string;
  nodeType: number;
  attrs: Map<string, string>;
  children: FakeEl[];
  className: string;
  hidden: boolean;
  value: string;
  type?: string;
  selected?: boolean;
  placeholder?: string;
  textContent: string;
  readonly firstChild: FakeEl | null;
  appendChild(c: FakeEl): FakeEl;
  removeChild(c: FakeEl): FakeEl;
  setAttribute(k: string, v: string): void;
  getAttribute(k: string): string | null;
  removeAttribute(k: string): void;
  cloneNode(deep?: boolean): FakeEl;
  querySelector(sel: string): FakeEl | null;
}

function fakeElement(tag: string): FakeEl {
  const attrs = new Map<string, string>();
  const children: FakeEl[] = [];
  const node: FakeEl = {
    tagName: String(tag).toUpperCase(),
    nodeType: 1,
    attrs,
    children,
    className: "",
    hidden: false,
    value: "",
    textContent: "",
    get firstChild() {
      return children.length > 0 ? children[0]! : null;
    },
    appendChild(c) {
      children.push(c);
      // real <select> semantics: appending a selected <option> sets the value
      if (node.tagName === "SELECT" && c.tagName === "OPTION" && c.selected === true) {
        node.value = c.value;
      }
      return c;
    },
    removeChild(c) {
      const i = children.indexOf(c);
      if (i !== -1) children.splice(i, 1);
      return c;
    },
    setAttribute(k, v) {
      attrs.set(k, String(v));
    },
    getAttribute(k) {
      return attrs.has(k) ? attrs.get(k)! : null;
    },
    removeAttribute(k) {
      attrs.delete(k);
    },
    cloneNode(deep) {
      const copy = fakeElement(tag);
      for (const [k, v] of attrs) copy.setAttribute(k, v);
      copy.className = node.className;
      copy.hidden = node.hidden;
      copy.value = node.value;
      copy.textContent = node.textContent;
      if (node.type !== undefined) copy.type = node.type;
      if (deep === true) for (const c of children) copy.appendChild(c.cloneNode(true));
      return copy;
    },
    querySelector(sel) {
      const attr = sel.replace(/^\[|\]$/g, "");
      for (const c of children) {
        if (c.nodeType !== 1) continue;
        if (c.attrs.has(attr)) return c;
        const nested = c.querySelector(sel);
        if (nested !== null) return nested;
      }
      return null;
    },
  };
  return node;
}

function fakeTextNode(text: string): FakeEl {
  const n = fakeElement("#text");
  n.nodeType = 3;
  n.textContent = String(text);
  return n;
}

// The §6.10 panel skeleton fillConditionPanel expects: rows box, add button,
// preview line, and the SSR'd op-template <select> carrying the real op set.
function conditionPanelDom(): FakeEl {
  const bodyEl = fakeElement("div");
  const rowsBox = fakeElement("div");
  rowsBox.setAttribute("data-pb-condition-rows", "");
  const addBtn = fakeElement("button");
  addBtn.setAttribute("data-pb-condition-add", "");
  const preview = fakeElement("div");
  preview.setAttribute("data-pb-cond-preview", "");
  preview.hidden = true;
  const opTemplate = fakeElement("select");
  opTemplate.setAttribute("data-pb-cond-op-template", "");
  opTemplate.setAttribute("aria-hidden", "true");
  opTemplate.hidden = true;
  for (const op of PAYLOAD_CONDITION_OPS) {
    const o = fakeElement("option");
    o.value = op.value;
    o.textContent = op.label;
    opTemplate.appendChild(o);
  }
  bodyEl.appendChild(rowsBox);
  bodyEl.appendChild(addBtn);
  bodyEl.appendChild(preview);
  bodyEl.appendChild(opTemplate);
  return bodyEl;
}

function sliceIslandFunction(script: string, name: string): string {
  const marker = `function ${name}(`;
  const start = script.indexOf(marker);
  expect(start, `island function ${name} present`).toBeGreaterThan(-1);
  const open = script.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < script.length; i += 1) {
    if (script[i] === "{") depth += 1;
    else if (script[i] === "}") {
      depth -= 1;
      if (depth === 0) return script.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced braces while slicing island function ${name}`);
}

interface ConditionIsland {
  condUiOp(cond: Record<string, unknown>): string;
  fillConditionPanel(bodyEl: FakeEl, node: Record<string, unknown>): void;
  readConditionFromRow(bodyEl: FakeEl, node: Record<string, unknown>): void;
  condChipAdd(bodyEl: FakeEl, node: Record<string, unknown>): void;
  condChipRemove(node: Record<string, unknown>, idx: number): void;
}

function conditionIsland(html: string, linkedFields: Array<Record<string, unknown>>): ConditionIsland {
  const script = extractScripts(html).find((s) => s.includes("data-pb-condition-rows"));
  expect(script, "payload-builder island script present").toBeDefined();
  const source = [
    "trimStr",
    "clearChildren",
    "el",
    "displayScalar",
    "linkedByInternal",
    "conditionFieldOptions",
    "condChoiceTypedValue",
    "condChoiceMeta",
    "condChipAdd",
    "condChipRemove",
    "condUiOp",
    "condSentence",
    "fillConditionPanel",
    "readConditionFromRow",
  ]
    .map((n) => sliceIslandFunction(script!, n))
    .join("\n");
  const sandbox = {
    document: { createElement: fakeElement, createTextNode: fakeTextNode },
    linkedFields,
    items: [] as unknown[],
  };
  return runInNewContext(
    `${source}\n({ condUiOp: condUiOp, fillConditionPanel: fillConditionPanel, readConditionFromRow: readConditionFromRow, condChipAdd: condChipAdd, condChipRemove: condChipRemove })`,
    sandbox,
  ) as ConditionIsland;
}

const CONDITION_LINKED_FIELDS: Array<Record<string, unknown>> = [
  { internal_field: "homeowner", section_name: "Home Details", answer_type: "boolean" },
  {
    internal_field: "carrier",
    section_name: "Home Details",
    answer_type: "enum",
    // F-1 (§6.10): choices now ride the linked-fields projection
    choices: [
      { value: "geico", label: "GEICO" },
      { value: "progressive", label: "Progressive" },
    ],
  },
  {
    internal_field: "vehicle_count",
    section_name: "Home Details",
    answer_type: "enum",
    choices: [
      { value: 1, label: "One" },
      { value: 2, label: "Two" },
    ],
  },
  { internal_field: "zip_code", section_name: "Home Details", answer_type: "string" },
  // number/currency-typed fields WITHOUT Section choices — the chips entry is
  // free text; finite numeric tokens must store as NUMBERS (evaluator ===).
  { internal_field: "driver_age", section_name: "Home Details", answer_type: "number" },
  { internal_field: "home_value", section_name: "Home Details", answer_type: "currency" },
];

describeDb("payload builder §6.10 — condition builder", () => {
  it("operator list = the supported evaluator ops + empty-sugar ONLY; contains/OR omitted entirely", async () => {
    const { html } = await richEditorPage();
    const block = selectBlock(html, "data-pb-cond-op-template");
    const values = optionValues(block);
    expect(values).toEqual(PAYLOAD_CONDITION_OPS.map((o) => o.value));
    expect(values).toEqual([
      "eq", "neq", "gt", "lt", "gte", "lte", "range", "in", "not_in", "is_empty", "is_not_empty",
    ]);
    expect(block.toLowerCase()).not.toContain("contains");
    expect(values).not.toContain("or");
    // human labels (escapeHtml escapes <>& only; ≠ ≥ ≤ ride as UTF-8)
    for (const label of ["=", "≠", "&gt;", "&lt;", "≥", "≤", "between", "in list", "not in list", "is empty", "is not empty"]) {
      expect(block, `op label ${label}`).toContain(`>${label}</option>`);
    }
  });

  it("AND-row + OR guidance, live preview sentence, and evaluator-exact sugar emission", async () => {
    const { html } = await richEditorPage();
    expect(html).toContain("Need OR (either / or)? Create a second field with its own condition.");
    expect(html).toContain("data-pb-cond-preview");
    expect(html).toContain("data-pb-condition-add");
    expect(html).toContain("data-pb-condition-rows");
    // is-empty / is-not-empty are sugar over eq/neq against "" (§6.10)
    expect(html).toContain("cond.op = 'eq'; cond.value = '';");
    expect(html).toContain("cond.op = 'neq'; cond.value = '';");
    // preview sentence shape
    expect(html).toContain("'Send this field when '");
  });

  // F-1 (live-probed defect): "+ Add condition" stores {op:'eq', value:''} —
  // the is_empty sugar shape. Picking "=" used to snap straight back to
  // "is empty" on the read→render cycle (the renderer re-inferred sugar from
  // value === ''), so §6.10's own example — "when homeowner = true" — could
  // not be authored. The op <select> must be the source of truth while the
  // row is live.
  it("F-1: an explicit '=' pick sticks through the read→render cycle and reaches eq+true (no is_empty snap-back)", async () => {
    const { html } = await richEditorPage();
    const island10 = conditionIsland(html, CONDITION_LINKED_FIELDS);
    const bodyEl = conditionPanelDom();
    const node: Record<string, unknown> = { conditional: { when: "homeowner", op: "eq", value: "" } };
    const opSel = () => bodyEl.querySelector("[data-pb-cond-op]")!;

    // Fresh from storage the empty-eq shape renders as the is_empty sugar.
    island10.fillConditionPanel(bodyEl, node);
    expect(opSel().value).toBe("is_empty");
    expect(bodyEl.querySelector("[data-pb-cond-value]")).toBeNull();

    // The user picks "=" — the delegated change handler runs read → render.
    opSel().value = "eq";
    island10.readConditionFromRow(bodyEl, node);
    island10.fillConditionPanel(bodyEl, node);
    expect(opSel().value, "the op select keeps the explicit = pick").toBe("eq");
    const valueInput = bodyEl.querySelector("[data-pb-cond-value]");
    expect(valueInput, "the typed value input appears on picking =").not.toBeNull();
    // homeowner is a boolean linked field → the true/false dropdown renders.
    expect(valueInput!.tagName).toBe("SELECT");
    // MINOR-2: the boolean dropdown shows "false" by default, so the STORED
    // value is written to match the SHOWN value immediately — an operator who
    // leaves it saves "= false", never a silent is-empty masquerade.
    expect(JSON.parse(JSON.stringify(node["conditional"]))).toEqual({
      when: "homeowner",
      op: "eq",
      value: false,
    });

    // Picking true emits the evaluator-exact boolean + the §6.10 sentence.
    valueInput!.value = "true";
    island10.readConditionFromRow(bodyEl, node);
    island10.fillConditionPanel(bodyEl, node);
    expect(JSON.parse(JSON.stringify(node["conditional"]))).toEqual({
      when: "homeowner",
      op: "eq",
      value: true,
    });
    expect(opSel().value).toBe("eq");
    expect(bodyEl.querySelector("[data-pb-cond-value]")!.value).toBe("true");
    const preview = bodyEl.querySelector("[data-pb-cond-preview]")!;
    expect(preview.hidden).toBe(false);
    expect(preview.textContent).toBe("Send this field when homeowner = true.");
  });

  it("eq WITH a value survives render→read round-trips without collapsing to sugar; stored empty eq/neq still render the sugar ops", async () => {
    const { html } = await richEditorPage();
    const island10 = conditionIsland(html, CONDITION_LINKED_FIELDS);

    // eq + value round-trips unchanged (no sugar collapse). carrier is an
    // enum field WITH choices, so post-F-1 the value input is the §6.10
    // choices dropdown (asserted in depth by the F-1 dropdown test below).
    const bodyEl = conditionPanelDom();
    const node: Record<string, unknown> = { conditional: { when: "carrier", op: "eq", value: "geico" } };
    island10.fillConditionPanel(bodyEl, node);
    expect(bodyEl.querySelector("[data-pb-cond-op]")!.value).toBe("eq");
    expect(bodyEl.querySelector("[data-pb-cond-value]")!.tagName).toBe("SELECT");
    expect(bodyEl.querySelector("[data-pb-cond-value]")!.value).toBe("geico");
    island10.readConditionFromRow(bodyEl, node);
    island10.fillConditionPanel(bodyEl, node);
    expect(JSON.parse(JSON.stringify(node["conditional"]))).toEqual({
      when: "carrier",
      op: "eq",
      value: "geico",
    });
    expect(bodyEl.querySelector("[data-pb-cond-op]")!.value).toBe("eq");

    // MINOR-3 (relocated to a no-choices field post-F-1): a STRING field
    // without Section choices keeps the free-text input, and typing the
    // literal "true" keeps the STRING "true" — coercing it to boolean would
    // make it never === the string answer at runtime and silently drop the
    // conditional payload field. Only boolean fields (the SELECT branch)
    // emit a boolean.
    const strBody = conditionPanelDom();
    const strNode: Record<string, unknown> = { conditional: { when: "zip_code", op: "eq", value: "90001" } };
    island10.fillConditionPanel(strBody, strNode);
    const strIn = strBody.querySelector("[data-pb-cond-value]")!;
    expect(strIn.tagName).toBe("INPUT");
    strIn.value = "true";
    island10.readConditionFromRow(strBody, strNode);
    expect(JSON.parse(JSON.stringify(strNode["conditional"]))).toEqual({
      when: "zip_code",
      op: "eq",
      value: "true",
    });

    // Explicitly re-picking the sugar still emits evaluator-exact eq + "".
    island10.fillConditionPanel(bodyEl, node);
    bodyEl.querySelector("[data-pb-cond-op]")!.value = "is_empty";
    island10.readConditionFromRow(bodyEl, node);
    island10.fillConditionPanel(bodyEl, node);
    expect(JSON.parse(JSON.stringify(node["conditional"]))).toEqual({
      when: "carrier",
      op: "eq",
      value: "",
    });
    expect(bodyEl.querySelector("[data-pb-cond-op]")!.value).toBe("is_empty");
    expect(bodyEl.querySelector("[data-pb-cond-value]")).toBeNull();

    // Stored empty shapes rendered fresh from storage keep the sugar ops.
    const emptyEq = conditionPanelDom();
    island10.fillConditionPanel(emptyEq, { conditional: { when: "carrier", op: "eq", value: "" } });
    expect(emptyEq.querySelector("[data-pb-cond-op]")!.value).toBe("is_empty");
    expect(emptyEq.querySelector("[data-pb-cond-value]")).toBeNull();
    const emptyNeq = conditionPanelDom();
    island10.fillConditionPanel(emptyNeq, { conditional: { when: "carrier", op: "neq", value: "" } });
    expect(emptyNeq.querySelector("[data-pb-cond-op]")!.value).toBe("is_not_empty");
  });

  // F-1 (§6.10 letter, retro audit): "Value input typed by the field —
  // dropdown for enums". An enum-typed linked field with known Section
  // choices renders a <select> of those choices (label + value) and stores
  // the picked choice's TYPED value.
  it("F-1: an enum field's condition value is a dropdown of its Section choices; the picked value stores TYPED", async () => {
    const { html } = await richEditorPage();
    const island10 = conditionIsland(html, CONDITION_LINKED_FIELDS);
    const bodyEl = conditionPanelDom();
    const node: Record<string, unknown> = { conditional: { when: "carrier", op: "eq", value: "geico" } };
    island10.fillConditionPanel(bodyEl, node);
    const valueInput = bodyEl.querySelector("[data-pb-cond-value]")!;
    expect(valueInput.tagName).toBe("SELECT");
    // exactly the field's choices, label text + string option values
    expect(valueInput.children.map((c) => [c.value, c.firstChild?.textContent])).toEqual([
      ["geico", "GEICO"],
      ["progressive", "Progressive"],
    ]);
    expect(valueInput.value).toBe("geico");
    // picking another choice stores that choice's value
    valueInput.value = "progressive";
    island10.readConditionFromRow(bodyEl, node);
    island10.fillConditionPanel(bodyEl, node);
    expect(JSON.parse(JSON.stringify(node["conditional"]))).toEqual({
      when: "carrier",
      op: "eq",
      value: "progressive",
    });
    expect(bodyEl.querySelector("[data-pb-cond-preview]")!.textContent).toBe(
      "Send this field when carrier = progressive.",
    );

    // NUMERIC choice values store TYPED (=== the runtime answer), not the
    // select's string form.
    const numBody = conditionPanelDom();
    const numNode: Record<string, unknown> = { conditional: { when: "vehicle_count", op: "eq", value: 1 } };
    island10.fillConditionPanel(numBody, numNode);
    const numSel = numBody.querySelector("[data-pb-cond-value]")!;
    expect(numSel.tagName).toBe("SELECT");
    expect(numSel.value).toBe("1");
    numSel.value = "2";
    island10.readConditionFromRow(numBody, numNode);
    expect(JSON.parse(JSON.stringify(numNode["conditional"]))).toEqual({
      when: "vehicle_count",
      op: "eq",
      value: 2,
    });

    // MINOR-2 pattern carried over: a fresh "=" pick on an enum field shows
    // the first choice AND writes it into the model immediately — the shown
    // value is the stored value, never a silent is-empty masquerade.
    const freshBody = conditionPanelDom();
    const freshNode: Record<string, unknown> = { conditional: { when: "carrier", op: "eq", value: "" } };
    island10.fillConditionPanel(freshBody, freshNode);
    expect(freshBody.querySelector("[data-pb-cond-op]")!.value).toBe("is_empty");
    freshBody.querySelector("[data-pb-cond-op]")!.value = "eq";
    island10.readConditionFromRow(freshBody, freshNode);
    island10.fillConditionPanel(freshBody, freshNode);
    expect(freshBody.querySelector("[data-pb-cond-value]")!.value).toBe("geico");
    expect(JSON.parse(JSON.stringify(freshNode["conditional"]))).toEqual({
      when: "carrier",
      op: "eq",
      value: "geico",
    });
  });

  // F-1 (§6.10 letter, retro audit): "chips for lists". in/not_in render a
  // chips editor storing the evaluator's `values` array — tokens add/remove
  // on the MODEL (never re-parsed from a comma string); the token entry is a
  // choices select for enum fields, a text input otherwise.
  it("F-1: in/not_in use a chips editor — add/remove tokens store the values array; enum entry is a select, string entry is text", async () => {
    const { html } = await richEditorPage();
    const island10 = conditionIsland(html, CONDITION_LINKED_FIELDS);

    // enum field: chips render from storage; the entry is a choices select.
    const bodyEl = conditionPanelDom();
    const node: Record<string, unknown> = { conditional: { when: "carrier", op: "in", values: ["geico"] } };
    island10.fillConditionPanel(bodyEl, node);
    const chips = bodyEl.querySelector("[data-pb-cond-chips]")!;
    expect(chips.children).toHaveLength(1);
    expect(chips.children[0]!.firstChild!.textContent).toBe("geico");
    // every chip carries a remove control
    expect(chips.children[0]!.querySelector("[data-pb-cond-chip-del]")).not.toBeNull();
    const entry = bodyEl.querySelector("[data-pb-cond-list-entry]")!;
    expect(entry.tagName).toBe("SELECT");
    expect(entry.children.map((c) => c.value)).toEqual(["geico", "progressive"]);
    // the old comma-separated input is gone
    expect(bodyEl.querySelector("[data-pb-cond-list]")).toBeNull();

    // add via the entry: the picked choice's TYPED value joins values[]
    entry.value = "progressive";
    island10.condChipAdd(bodyEl, node);
    expect(JSON.parse(JSON.stringify(node["conditional"]))).toEqual({
      when: "carrier",
      op: "in",
      values: ["geico", "progressive"],
    });
    // duplicate adds are refused
    island10.condChipAdd(bodyEl, node);
    expect((node["conditional"] as { values: unknown[] }).values).toHaveLength(2);
    // re-render shows both chips
    island10.fillConditionPanel(bodyEl, node);
    expect(bodyEl.querySelector("[data-pb-cond-chips]")!.children).toHaveLength(2);
    expect(bodyEl.querySelector("[data-pb-cond-preview]")!.textContent).toBe(
      "Send this field when carrier is one of [geico, progressive].",
    );

    // remove a token
    island10.condChipRemove(node, 0);
    expect(JSON.parse(JSON.stringify(node["conditional"]))).toEqual({
      when: "carrier",
      op: "in",
      values: ["progressive"],
    });

    // switching in -> not_in through read/render PRESERVES the stored array
    island10.fillConditionPanel(bodyEl, node);
    bodyEl.querySelector("[data-pb-cond-op]")!.value = "not_in";
    island10.readConditionFromRow(bodyEl, node);
    island10.fillConditionPanel(bodyEl, node);
    expect(JSON.parse(JSON.stringify(node["conditional"]))).toEqual({
      when: "carrier",
      op: "not_in",
      values: ["progressive"],
    });

    // string field without choices: the entry is a TEXT input; typed tokens
    // store as strings.
    const strBody = conditionPanelDom();
    const strNode: Record<string, unknown> = { conditional: { when: "zip_code", op: "in", values: [] } };
    island10.fillConditionPanel(strBody, strNode);
    const strEntry = strBody.querySelector("[data-pb-cond-list-entry]")!;
    expect(strEntry.tagName).toBe("INPUT");
    strEntry.value = "90210";
    island10.condChipAdd(strBody, strNode);
    expect(JSON.parse(JSON.stringify(strNode["conditional"]))).toEqual({
      when: "zip_code",
      op: "in",
      values: ["90210"],
    });
  });

  // Residual (SHIP adversarial review): a number/currency-typed condition
  // field WITHOUT Section choices takes free-text chip tokens — stored as
  // strings ("25") they can NEVER match a numeric answer in the runtime
  // evaluator (conditionalMet `in`/`not_in`: values.includes(actual), strict
  // equality). Finite numeric tokens must store as NUMBERS; non-numeric
  // tokens and string-typed fields keep strings.
  it("F-1 residual: number/currency-typed no-choices fields store finite numeric chip tokens as NUMBERS; string fields keep strings", async () => {
    const { html } = await richEditorPage();
    const island10 = conditionIsland(html, CONDITION_LINKED_FIELDS);

    // number-typed field: the entry is free text (no choices dropdown), yet
    // "25" / "30" land in values[] as typeof number.
    const numBody = conditionPanelDom();
    const numNode: Record<string, unknown> = { conditional: { when: "driver_age", op: "in", values: [] } };
    island10.fillConditionPanel(numBody, numNode);
    const numEntry = numBody.querySelector("[data-pb-cond-list-entry]")!;
    expect(numEntry.tagName).toBe("INPUT");
    numEntry.value = "25";
    island10.condChipAdd(numBody, numNode);
    numEntry.value = "30";
    island10.condChipAdd(numBody, numNode);
    const numVals = (numNode["conditional"] as { values: unknown[] }).values;
    expect(numVals).toEqual([25, 30]);
    expect(numVals.map((v) => typeof v)).toEqual(["number", "number"]);
    // a NON-numeric token on the same number field stays a string (never NaN)
    numEntry.value = "unknown";
    island10.condChipAdd(numBody, numNode);
    expect(numVals[2]).toBe("unknown");
    // chips re-render unchanged (displayScalar) — 3 chips, numeric text intact
    island10.fillConditionPanel(numBody, numNode);
    const numChips = numBody.querySelector("[data-pb-cond-chips]")!;
    expect(numChips.children).toHaveLength(3);
    expect(numChips.children[0]!.firstChild!.textContent).toBe("25");

    // currency-typed field behaves like number
    const curBody = conditionPanelDom();
    const curNode: Record<string, unknown> = { conditional: { when: "home_value", op: "not_in", values: [] } };
    island10.fillConditionPanel(curBody, curNode);
    curBody.querySelector("[data-pb-cond-list-entry]")!.value = "250000";
    island10.condChipAdd(curBody, curNode);
    expect((curNode["conditional"] as { values: unknown[] }).values).toEqual([250000]);
    expect(typeof (curNode["conditional"] as { values: unknown[] }).values[0]).toBe("number");

    // string-typed field: a numeric-LOOKING token stays a string
    const strBody = conditionPanelDom();
    const strNode: Record<string, unknown> = { conditional: { when: "zip_code", op: "in", values: [] } };
    island10.fillConditionPanel(strBody, strNode);
    strBody.querySelector("[data-pb-cond-list-entry]")!.value = "25";
    island10.condChipAdd(strBody, strNode);
    const strVals = (strNode["conditional"] as { values: unknown[] }).values;
    expect(strVals).toEqual(["25"]);
    expect(typeof strVals[0]).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// Retro-audit executed regressions (F-2 / F-4 / F-5) — REAL island functions
// sliced from the served script and run in a vm (the F-1 probe pattern).
// ---------------------------------------------------------------------------

interface FreeTextIsland {
  validateFreeTextClient(
    node: Record<string, unknown>,
    path: string,
    errors: Array<{ code: string; message: string }>,
  ): void;
  isCatastrophicShape(pattern: string): boolean;
}

function freeTextIsland(html: string): FreeTextIsland {
  const script = extractScripts(html).find((s) => s.includes("function isCatastrophicShape("));
  expect(script, "free-text island script present").toBeDefined();
  const source = ["trimStr", "isUnboundedBraceAt", "isCatastrophicShape", "validateFreeTextClient"]
    .map((n) => sliceIslandFunction(script!, n))
    .join("\n");
  const sandbox = {
    // island-scoped consts the sliced validator reads (values mirror the
    // island bootstrap block; the §6.5 KNOWN_NODE_KEYS test pins them).
    FREE_TEXT_KEYS: ["free_text_max_length", "free_text_pattern", "free_text_pattern_custom"],
    FREE_TEXT_PATTERNS: ["none", "letters", "digits", "custom"],
    FREE_TEXT_CUSTOM_MAX: 200,
  };
  return runInNewContext(
    `${source}\n({ validateFreeTextClient: validateFreeTextClient, isCatastrophicShape: isCatastrophicShape })`,
    sandbox,
  ) as FreeTextIsland;
}

interface ValueMapIsland {
  valueMapEntries(node: Record<string, unknown>): Array<Record<string, unknown>>;
  vmApplyRowsToNode(node: Record<string, unknown>, rows: Array<Record<string, unknown>>): number;
  vmRegroupRow(rows: Array<Record<string, unknown>>, idx: number, group: string): void;
  vmDropOnRow(rows: Array<Record<string, unknown>>, fromIdx: number, toIdx: number): void;
}

function valueMapIsland(html: string): ValueMapIsland {
  const script = extractScripts(html).find((s) => s.includes("function vmApplyRowsToNode("));
  expect(script, "value-map island script present").toBeDefined();
  const source = ["trimStr", "isRecordVal", "hasOwn", "valueMapEntries", "vmApplyRowsToNode", "vmRegroupRow", "vmDropOnRow"]
    .map((n) => sliceIslandFunction(script!, n))
    .join("\n");
  const sandbox = { FORBIDDEN_SEGMENTS: ["__proto__", "constructor", "prototype"] };
  return runInNewContext(
    `${source}\n({ valueMapEntries: valueMapEntries, vmApplyRowsToNode: vmApplyRowsToNode, vmRegroupRow: vmRegroupRow, vmDropOnRow: vmDropOnRow })`,
    sandbox,
  ) as ValueMapIsland;
}

describeDb("payload builder — retro-audit regressions (F-2/F-4/F-5)", () => {
  // F-5: the island's client-side ReDoS screen was the pre-DEV-38 FLAT
  // regex — it missed nested `((a)+)+` and alternation `(a|a)+` bombs, so
  // the client showed "no issues" for a pattern the server 400s. Now an ES5
  // port of the depth-aware payload.ts isCatastrophicRegexShape.
  it("F-5: the client free-text validator flags nested + alternation bombs (depth-aware, matching the server); linear patterns stay clean", async () => {
    const { html } = await richEditorPage();
    const ft = freeTextIsland(html);
    const flagged = (pattern: string): string[] => {
      const errors: Array<{ code: string; message: string }> = [];
      ft.validateFreeTextClient(
        { source: "answer", type: "string", free_text_pattern: "custom", free_text_pattern_custom: pattern },
        "lead.name",
        errors,
      );
      return errors.map((e) => `${e.code}: ${e.message}`);
    };
    const BOMB = "free_text_constraint_invalid: custom pattern risks catastrophic backtracking (nested quantifier)";
    // the two evasion classes the flat mirror admitted (fail-before)
    expect(flagged("((a)+)+$")).toEqual([BOMB]);
    expect(flagged("(a|a)+$")).toEqual([BOMB]);
    // the §6.5 letters preset shape stays clean end-to-end
    expect(flagged("^[A-Za-z ]+$")).toEqual([]);
    expect(flagged("^\\d{5}$")).toEqual([]);

    // walker parity spot-checks against the server truth (payload.ts
    // isCatastrophicRegexShape semantics, DEV-38)
    expect(ft.isCatastrophicShape("(a+)+")).toBe(true); // flat class still caught
    expect(ft.isCatastrophicShape("((a+))+$")).toBe(true); // nesting evasion
    expect(ft.isCatastrophicShape("(([a-z])+)+$")).toBe(true);
    expect(ft.isCatastrophicShape("(a{2,}){2,}")).toBe(true); // unbounded brace nest
    expect(ft.isCatastrophicShape("(cat|dog)+")).toBe(true); // documented safe-side over-reject (DEV-38)
    expect(ft.isCatastrophicShape("(abc){2,}")).toBe(false); // single-level quantified group is fine
    expect(ft.isCatastrophicShape("\\(a+\\)+")).toBe(false); // escaped parens are literals
    expect(ft.isCatastrophicShape("[(a+)]+")).toBe(false); // char-class contents are literal
  });

  // F-4 (§6.13 letter): "object child add/rename path rewrite" executed —
  // renamePrefix rewrites EVERY descendant path atomically; the renamed
  // node's name tracks its new last segment; descendants keep their names;
  // mapped references (internal_field / value_map / choiceDisplay) ride
  // along untouched; prefix-sharing NON-descendants are untouched.
  it("F-4: renamePrefix rewrites a populated subtree's descendant paths and returns the moved items", async () => {
    const { html } = await richEditorPage();
    const script = extractScripts(html).find((s) => s.includes("function renamePrefix("));
    expect(script, "rename island script present").toBeDefined();
    const source = ["lastSegment", "renamePrefix"].map((n) => sliceIslandFunction(script!, n)).join("\n");
    const items = [
      { uid: 1, node: { path: "driver", name: "driver", type: "object", source: "static", value: {} } as Record<string, unknown> },
      {
        uid: 2,
        node: {
          path: "driver.first_name",
          name: "first_name",
          type: "string",
          source: "answer",
          internal_field: "first_name",
          value_map: { a: "b" },
          choiceDisplay: { mainValues: ["a"] },
        } as Record<string, unknown>,
      },
      { uid: 3, node: { path: "driver.vehicle", name: "vehicle", type: "object", source: "static", value: {} } as Record<string, unknown> },
      { uid: 4, node: { path: "driver.vehicle.make", name: "make", type: "string", source: "answer", internal_field: "veh_make" } as Record<string, unknown> },
      // shares the "driver" character prefix but is NOT a descendant
      { uid: 5, node: { path: "drivers_count", name: "drivers_count", type: "number", source: "answer", internal_field: "drivers_count" } as Record<string, unknown> },
    ];
    const sandbox = { items, expandedOff: { driver: 1 } as Record<string, number> };
    const { renamePrefix } = runInNewContext(`${source}\n({ renamePrefix: renamePrefix })`, sandbox) as {
      renamePrefix(oldPath: string, newPath: string): Array<{ uid: number }>;
    };
    const moved = renamePrefix("driver", "primary_driver");
    expect(items.map((i) => i.node["path"])).toEqual([
      "primary_driver",
      "primary_driver.first_name",
      "primary_driver.vehicle",
      "primary_driver.vehicle.make",
      "drivers_count",
    ]);
    // the renamed node's name tracks the new last segment; descendants keep theirs
    expect(items[0]!.node["name"]).toBe("primary_driver");
    expect(items[1]!.node["name"]).toBe("first_name");
    expect(items[3]!.node["name"]).toBe("make");
    // exactly the subtree moved (root + 3 descendants), in tree order
    expect(moved.map((m) => m.uid)).toEqual([1, 2, 3, 4]);
    // mapped references ride along byte-identical
    expect(items[1]!.node["internal_field"]).toBe("first_name");
    expect(items[1]!.node["value_map"]).toEqual({ a: "b" });
    expect(items[1]!.node["choiceDisplay"]).toEqual({ mainValues: ["a"] });
    // collapse state migrates to the new path
    expect(sandbox.expandedOff).toEqual({ primary_driver: 1 });
  });

  // F-4 (§6.13 letter): "value-map projection round-trip (table ⇄
  // output_value_map)" executed — rows → apply → node.value_map +
  // choiceDisplay.mainValues → rows again (previously only proven in
  // Playwright).
  it("F-4: value-map rows→apply→storage→rows round-trips executed, typed outputs + main flags intact", async () => {
    const { html } = await richEditorPage();
    const vm = valueMapIsland(html);
    const node: Record<string, unknown> = {};
    const rows = [
      { internal: "own", output: "H", main: true },
      { internal: "rent", output: "R", main: false },
      { internal: "size", output: 2, main: false },
      { internal: "flag", output: true, main: true },
    ];
    expect(vm.vmApplyRowsToNode(node, rows)).toBe(0);
    expect(node["value_map"]).toEqual({ own: "H", rent: "R", size: 2, flag: true });
    expect(node["choiceDisplay"]).toEqual({ mainValues: ["own", "flag"] });
    // …and back: the table regenerates from storage
    expect(vm.valueMapEntries(node)).toEqual(rows);
    // empty internals are dropped; reserved keys are counted, not written (nano-7)
    expect(vm.vmApplyRowsToNode(node, [
      { internal: "own", output: "H", main: false },
      { internal: " ", output: "x", main: false },
      { internal: "__proto__", output: "boom", main: false },
    ])).toBe(1);
    expect(node["value_map"]).toEqual({ own: "H" });
    // a no-mains apply removes mainValues (and the then-empty choiceDisplay)
    expect(node["choiceDisplay"]).toBeUndefined();
    expect(vm.valueMapEntries(node)).toEqual([{ internal: "own", output: "H", main: false }]);
  });

  // F-2 (§6.4 letter): "drag between groups". The drop handler path funnels
  // into vmDropOnRow → vmRegroupRow — the SAME mutation the Mark-as-main /
  // Move-to-Other buttons call — and the regrouped rows flow into
  // choiceDisplay.mainValues on apply.
  it("F-2: dropping a row onto the other group regroups it via the shared mutation; mainValues updates on apply", async () => {
    const { html } = await richEditorPage();
    const vm = valueMapIsland(html);
    const rows = [
      { internal: "own", output: "H", main: true },
      { internal: "rent", output: "R", main: false },
      { internal: "other_situation", output: "O", main: false },
    ];
    // drop "rent" (Other) onto "own" (Main) → rent joins the Main group
    vm.vmDropOnRow(rows, 1, 0);
    expect(rows[1]!.main).toBe(true);
    // drop "own" (Main) onto "other_situation" (Other) → own moves to Other
    vm.vmDropOnRow(rows, 0, 2);
    expect(rows[0]!.main).toBe(false);
    // dropping a row on itself is a no-op
    vm.vmDropOnRow(rows, 2, 2);
    expect(rows[2]!.main).toBe(false);
    // the regroup lands in storage exactly like the buttons do
    const node: Record<string, unknown> = {};
    vm.vmApplyRowsToNode(node, rows);
    expect(node["choiceDisplay"]).toEqual({ mainValues: ["rent"] });
    // the button path is the SAME function
    vm.vmRegroupRow(rows, 2, "main");
    vm.vmApplyRowsToNode(node, rows);
    expect(node["choiceDisplay"]).toEqual({ mainValues: ["rent", "other_situation"] });

    // the modal wires the HTML5 drag events to this exact path, and rows
    // are draggable (buttons stay as the keyboard-accessible path)
    const script = extractScripts(html).find((s) => s.includes("function vmApplyRowsToNode("));
    expect(script).toContain("tr.setAttribute('draggable', 'true');");
    expect(script).toContain("addEventListener('dragstart'");
    expect(script).toContain("addEventListener('dragover'");
    expect(script).toContain("addEventListener('drop'");
    expect(script).toContain("vmDropOnRow(vmState.rows, vmDragIdx, Number(tr.getAttribute('data-vm-row')));");
    expect(script).toContain("data-vm-row-act");
  });
});

// ---------------------------------------------------------------------------
// §6.11 — validation panel
// ---------------------------------------------------------------------------

describeDb("payload builder §6.11 — validation panel", () => {
  it("summary + issue rows + Jump hooks + the blocking-codes footer from the payload.ts export", async () => {
    const { html } = await richEditorPage();
    expect(html).toContain('id="lg-pb-validation-summary"');
    expect(html).toContain('id="lg-pb-validation-list"');
    expect(html).toContain('id="lg-pb-validation-codes"');
    expect(html).toContain("Blocking error codes (Save and Test stay blocked while any exists)");
    for (const code of LEADGEN_PAYLOAD_BLOCKING_ERROR_CODES) {
      expect(html, `blocking code ${code} documented`).toContain(`<code>${code}</code>`);
    }
    // live count + Jump behavior ride the script
    expect(html).toContain("'Schema has ' + entries.length + ' issue'");
    expect(html).toContain("data-pb-jump");
    expect(html).toContain("jumpToIssue");
    expect(html).toContain("scrollIntoView");
  });

  it("every blocking + warning code carries an operator fix hint in the island", async () => {
    const { html } = await richEditorPage();
    const data = island(html, "lg-payload-data") as {
      error_hints: Record<string, string>;
      blocking_codes: string[];
    };
    expect(data.blocking_codes).toEqual([...LEADGEN_PAYLOAD_BLOCKING_ERROR_CODES]);
    for (const code of [...LEADGEN_PAYLOAD_BLOCKING_ERROR_CODES, ...LEADGEN_PAYLOAD_WARNING_ERROR_CODES]) {
      expect(PAYLOAD_SCHEMA_ERROR_HINTS[code], `hint for ${code}`).toBeTruthy();
      expect(data.error_hints[code], `island hint for ${code}`).toBeTruthy();
    }
  });

  it("server 400 schema_errors render through the same panel: save + test paths are wired", async () => {
    const { html } = await richEditorPage();
    // save path consumes res.body.schema_errors; test path renders into the
    // §6.12.5 pre-test box with the SAME issue renderer
    expect(html).toContain("renderServerOutcome");
    expect(html).toContain("res.body.schema_errors");
    expect(html).toContain("data-test-schema-errors");
    expect(html).toContain("renderTestIssues");
    // Save/Test blocked while blocking-class errors exist
    expect(html).toContain("Save is blocked");
    expect(html).toContain("splitBlocking");
  });
});

// ---------------------------------------------------------------------------
// §6.12 — Test tab (C1)
// ---------------------------------------------------------------------------

describeDb("payload builder §6.12 — Test tab", () => {
  it("generated sample-answer form + regenerate + per-Offer draft persistence (POST/PUT sample-answers)", async () => {
    const { html } = await richEditorPage();
    expect(html).toContain('id="lg-test-form"');
    expect(html).toContain('id="lg-test-form-status"');
    expect(html).toContain('id="lg-test-regenerate"');
    expect(html).toContain('id="lg-test-save-draft"');
    expect(html).toContain('id="lg-test-draft-status"');
    // pinned endpoint wiring: POST = generate (draft-merged), PUT = persist
    expect(html).toContain("'/payload/sample-answers'");
    expect(html).toContain("getJson('PUT', apiBase + '/payload/sample-answers'");
    // per-kind rendering (enum select / boolean pair / date input / zip preset)
    expect(html).toContain("data-test-kind");
    expect(html).toContain("'lg-tf-' + field.internal_field");
    expect(html).toContain("input.type = 'date';");
  });

  it("simulated-context panel: collapsed by default, realistic US defaults, override keys only", async () => {
    const { html } = await richEditorPage();
    expect(html).toContain('id="lg-test-context"');
    expect(html).not.toMatch(/<details[^>]*id="lg-test-context"[^>]*\sopen[\s>]/);
    for (const f of PAYLOAD_TEST_CONTEXT_DEFAULTS) {
      expect(html, `context input ${f.key}`).toContain(`data-test-ctx="${f.key}"`);
    }
    // spot-check the US profile values render as input values
    expect(html).toMatch(/data-test-ctx="country" value="US"/);
    expect(html).toMatch(/data-test-ctx="city" value="Los Angeles"/);
    expect(html).toMatch(/data-test-ctx="postalCode" value="90001"/);
    expect(html).toMatch(/data-test-ctx="timezone" value="America\/Los_Angeles"/);
    expect(html).toContain("feed the SAME runtime context builder");
  });

  it("placement picker: visible with >1 placements (default pre-selected); hidden for a single placement", async () => {
    const { html } = await richEditorPage();
    expect(html).toContain('data-test-placement-count="2"');
    expect(html).not.toMatch(/id="lg-test-placement-wrap"[^>]*hidden/);
    const block = selectBlock(html, 'id="lg-test-placement"');
    expect(optionValues(block)).toHaveLength(2);
    expect(block).toMatch(/<option value="lgpl_[0-9A-HJKMNP-TV-Z]{26}" selected>pl-main[^<]*\(default\)/);

    const { env } = newHarness();
    const solo = await createOffer(env, { placements: ["pl-only"] });
    await postSchema(env, solo.public_id);
    const soloHtml = await getHtml(env, `/admin/leadgen/offers/${solo.public_id}/edit`);
    expect(soloHtml).toMatch(/id="lg-test-placement-wrap"[^>]*data-test-placement-count="1" hidden/);
  });

  it("environment select requires an explicit production confirm; result view echoes context_used", async () => {
    const { html } = await richEditorPage();
    expect(html).toContain('data-confirm-production="1"');
    expect(html).toContain("Run this test against the PRODUCTION endpoint?");
    expect(html).toContain('id="lg-test-context-used"');
    expect(html).toContain("renderContextUsed");
    expect(html).toContain("offer_placement_id");
    // legacy result surfaces stay
    for (const id of [
      "lg-test-status-line",
      "lg-test-request-payload",
      "lg-test-request-headers",
      "lg-test-response-body",
      "lg-test-parse-errors",
      "lg-test-carriers",
      "lg-test-chips",
      "lg-test-macro-flags",
    ]) {
      expect(html, `result element ${id}`).toContain(`id="${id}"`);
    }
  });

  it("Advanced raw-JSON answers editor round-trips with the form (form→JSON / JSON→form)", async () => {
    const { html } = await richEditorPage();
    expect(html).toContain('id="lg-test-advanced"');
    expect(html).toContain('id="lg-test-answers"');
    expect(html).toContain('id="lg-test-form-to-json"');
    expect(html).toContain('id="lg-test-json-to-form"');
    expect(html).toContain("collectFormAnswers");
  });
});

// ---------------------------------------------------------------------------
// §6.14 / M2 — raw JSON exists ONLY behind Advanced disclosures
// ---------------------------------------------------------------------------

describeDb("payload builder §6.14/M2 — no normal-mode JSON input reachable", () => {
  function advancedRanges(html: string): Array<[number, number]> {
    const ranges: Array<[number, number]> = [];
    const re = /<details[^>]*data-lg-advanced[^>]*>[\s\S]*?<\/details>/g;
    for (const m of html.matchAll(re)) {
      ranges.push([m.index ?? 0, (m.index ?? 0) + m[0].length]);
    }
    return ranges;
  }
  function insideAdvanced(ranges: Array<[number, number]>, idx: number): boolean {
    return ranges.some(([a, b]) => idx >= a && idx < b);
  }

  it("every raw-JSON input (data-raw-json) sits inside a data-lg-advanced drawer", async () => {
    const { html } = await richEditorPage();
    const ranges = advancedRanges(html);
    expect(ranges.length).toBeGreaterThanOrEqual(4);
    const rawIdxs = [...html.matchAll(/data-raw-json/g)].map((m) => m.index ?? 0);
    expect(rawIdxs.length).toBeGreaterThanOrEqual(4); // schema, field, dry run, test answers
    for (const idx of rawIdxs) {
      expect(insideAdvanced(ranges, idx), `data-raw-json at ${idx} inside an Advanced drawer`).toBe(true);
    }
    for (const id of ['id="lg-schema-raw"', 'id="lg-dryrun-answers"', 'id="lg-test-answers"', 'id="lg-example-input"']) {
      const at = html.indexOf(id);
      expect(at, `${id} present`).toBeGreaterThan(-1);
      expect(insideAdvanced(ranges, at), `${id} inside an Advanced drawer`).toBe(true);
    }
  });

  it("no JSON-shaped placeholder input exists outside Advanced drawers", async () => {
    const { html } = await richEditorPage();
    const ranges = advancedRanges(html);
    for (const m of html.matchAll(/placeholder='\{/g)) {
      expect(insideAdvanced(ranges, m.index ?? 0), `JSON placeholder at ${m.index} gated`).toBe(true);
    }
    // Advanced drawers are explicit disclosures with visible summaries
    expect(html).toContain("<summary>Advanced raw JSON (whole schema)</summary>");
    expect(html).toContain("<summary>Advanced raw JSON (this field)</summary>");
    expect(html).toContain("<summary>Advanced raw JSON answers</summary>");
    // advanced-managed flag for unrepresentable raw edits
    expect(html).toContain("data-pb-advanced-managed");
    expect(html).toContain("advanced-managed");
  });
});

// ---------------------------------------------------------------------------
// Bootstrap-data islands — JSON round-trip + builder_context passthrough
// ---------------------------------------------------------------------------

describeDb("payload builder — bootstrap islands", () => {
  it("lg-payload-data round-trips: schema, computed options, hints, offer + builder_context.linked_fields", async () => {
    const { html } = await richEditorPage();
    const data = island(html, "lg-payload-data") as {
      active_schema: { version: number; schema: { root: { children: unknown[] } } };
      schemas_count: number;
      computed_options: Array<{ key: string; label: string; description: string; example: string; output_type: string }>;
      builder_context: {
        active_schema: { version: number; nodes: unknown[] } | null;
        linked_fields: Array<Record<string, unknown>>;
      };
      offer: { placements: Array<{ public_id: string; is_default: boolean }> };
    };
    expect(data.active_schema.version).toBe(1);
    expect(data.active_schema.schema.root.children).toHaveLength(RICH_SCHEMA.root.children.length);
    expect(data.schemas_count).toBe(1);
    expect(data.computed_options.map((c) => c.key)).toEqual([...LEADGEN_COMPUTED_KEYS]);
    for (const c of data.computed_options) {
      expect(c.label, `computed ${c.key} label`).toBeTruthy();
      expect(c.example, `computed ${c.key} example`).toBeTruthy();
    }
    // builder_context (LANDED shape): active_schema.nodes + linked_fields
    expect(data.builder_context.active_schema?.nodes).toHaveLength(RICH_SCHEMA.root.children.length);
    const fields = data.builder_context.linked_fields;
    expect(fields.length).toBeGreaterThanOrEqual(4);
    const homeowner = fields.find((f) => f["internal_field"] === "homeowner");
    expect(homeowner).toBeDefined();
    expect(homeowner!["section_name"]).toBe("Home Details");
    expect(homeowner!["answer_type"]).toBe("enum");
    expect(homeowner!["choice_count"]).toBe(3);
    expect(Object.keys(homeowner!).sort()).toEqual([
      "answer_type",
      "choice_count",
      "choices",
      "internal_field",
      "section_name",
      "section_public_id",
    ]);
    // F-1 (§6.10): the projection carries the Section choices (label+value)
    // for the typed condition-value inputs.
    expect(homeowner!["choices"]).toEqual([
      { value: "own", label: "I own my home" },
      { value: "rent", label: "I rent" },
      { value: "other_situation", label: "Something else" },
    ]);
    expect(data.offer.placements).toHaveLength(2);
  });

  it("lg-test-data round-trips: placements + endpoint configuration flags", async () => {
    const { html } = await richEditorPage();
    const data = island(html, "lg-test-data") as {
      placements: Array<{ public_id: string; placement_id: string; is_default: boolean }>;
      endpoints: { production: boolean; staging: boolean };
    };
    expect(data.placements).toHaveLength(2);
    expect(data.placements.filter((p) => p.is_default)).toHaveLength(1);
    expect(data.endpoints).toEqual({ production: true, staging: false });
  });
});

// ---------------------------------------------------------------------------
// XSS discipline
// ---------------------------------------------------------------------------

describeDb("payload builder — XSS discipline", () => {
  it("hostile schema labels + placement labels render escaped; islands cannot break the script tag", async () => {
    const { sdb, env } = newHarness();
    const HOSTILE = `</script><script>alert(1)</script>"&`;
    const offer = await createOffer(env, { placements: ["pl-x", "pl-y"] });
    await patchOffer(env, offer.public_id, {
      placements: [
        { public_id: offer.placements[0]?.public_id, placement_id: "pl-x", label: HOSTILE, is_default: true },
        { public_id: offer.placements[1]?.public_id, placement_id: "pl-y", is_default: false },
      ],
    });
    const schema = JSON.parse(JSON.stringify(RICH_SCHEMA)) as typeof RICH_SCHEMA;
    (schema.root.children[1] as { label?: string }).label = HOSTILE;
    await postSchema(env, offer.public_id, schema);
    void sdb;
    const html = await getHtml(env, `/admin/leadgen/offers/${offer.public_id}/edit`);
    // raw injection sequence never appears (jsonForScriptTag escapes `<`)
    expect(html).not.toContain("</script><script>alert(1)</script>");
    // placement label is escaped in the Test picker option text
    expect(html).toContain("&lt;/script&gt;&lt;script&gt;alert(1)&lt;/script&gt;&quot;&amp;");
    // the island carries the label safely as <-escaped JSON
    expect(html).toContain("\\u003c/script");
  });
});

// ---------------------------------------------------------------------------
// ES5-only inline scripts + parse gate (house mechanism)
// ---------------------------------------------------------------------------

const SCRIPT_RE = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;

function extractScripts(html: string): string[] {
  const blocks: string[] = [];
  for (const match of html.matchAll(SCRIPT_RE)) {
    const body = match[1] ?? "";
    if ((match[0] ?? "").includes('type="application/json"')) continue;
    blocks.push(body);
  }
  return blocks;
}

const scratchDir = mkdtempSync(join(tmpdir(), "leadgen-pb-script-parse-"));
let fileSeq = 0;

function parseError(label: string, source: string): string | null {
  const file = join(scratchDir, `${++fileSeq}-${label.replace(/[^\w-]/g, "_")}.js`);
  writeFileSync(file, source, "utf-8");
  try {
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
    return null;
  } catch (err) {
    const stderr = (err as { stderr?: Buffer }).stderr?.toString() ?? String(err);
    return `${label}: ${stderr.split("\n").slice(0, 5).join("\n")}`;
  }
}

describeDb("payload builder — ES5-only inline scripts", () => {
  it("every inline <script> on the rich editor page is ES5 and parses standalone (node --check)", async () => {
    const { html } = await richEditorPage();
    const scripts = extractScripts(html);
    expect(scripts.length).toBeGreaterThan(0);
    const errors: string[] = [];
    scripts.forEach((script, i) => {
      expect(script, `script ${i + 1} arrow`).not.toMatch(/=>/);
      expect(script, `script ${i + 1} const`).not.toMatch(/\bconst\b/);
      expect(script, `script ${i + 1} let`).not.toMatch(/\blet\b/);
      expect(script, `script ${i + 1} async`).not.toMatch(/\basync\b/);
      expect(script, `script ${i + 1} await`).not.toMatch(/\bawait\b/);
      expect(script, `script ${i + 1} backtick`).not.toContain("`");
      const err = parseError(`pb-script${i + 1}`, script);
      if (err) errors.push(err);
    });
    expect(errors, errors.join("\n\n")).toEqual([]);
  });
});

