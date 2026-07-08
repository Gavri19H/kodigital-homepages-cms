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
  LEADGEN_PAYLOAD_BLOCKING_ERROR_CODES,
  LEADGEN_PAYLOAD_WARNING_ERROR_CODES,
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

const LEADGEN_MIGRATIONS = [
  "0036_leadgen_core.sql",
  "0037_leadgen_analytics_mirror.sql",
  "0038_leadgen_revenue_infra.sql",
  "0039_leadgen_conversion_dedupe.sql",
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
  it("modal table renders the 8 §6.3 columns exactly, in order", async () => {
    const { html } = await richEditorPage();
    const expected = [
      "Display label",
      "Internal normalized value",
      "Provider output value",
      "Output type",
      "Main choice?",
      "Other group?",
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
      "other",
      "analytics_label",
      "notes",
    ]);
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
    for (const s of ["Mark as main", "Move to Other", "parseCsv", "FileReader", "data-vm-row-act"]) {
      expect(html, `vm script ${s}`).toContain(s);
    }
    expect(html).toContain("internal=provider");
  });

  it("footer: unmapped-internal-values warning + the miss ⇒ invalid ⇒ fallback reminder", async () => {
    const { html } = await richEditorPage();
    expect(html).toContain("data-vm-unmapped-warning");
    expect(html).toContain("missing from this map");
    // the reminder renders (entity-encoded arrows) in modal + compact panel
    expect(html.split("miss &#8658; invalid &#8658; fallback").length).toBeGreaterThanOrEqual(2);
  });

  it("§6.4 Other-grouping controls: Main checkbox column, count chips, soft >9 warn, searchableOther + otherGroupLabel", async () => {
    const { html } = await richEditorPage();
    for (const hook of [
      'data-pb-field="otherGroupEnabled"',
      'data-pb-field="otherGroupLabel"',
      'data-pb-field="searchableOther"',
      "data-pb-choice-chips",
      "data-pb-main-warn",
      "data-vm-count-chips",
      "data-vm-main-warn",
    ]) {
      expect(html, `choiceDisplay hook ${hook}`).toContain(hook);
    }
    // emission target + soft-warn threshold live in the script
    expect(html).toContain("mainValues");
    expect(html).toContain("more than 9 gets crowded");
    expect(html).toContain('placeholder="Other"');
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
      "internal_field",
      "section_name",
      "section_public_id",
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

