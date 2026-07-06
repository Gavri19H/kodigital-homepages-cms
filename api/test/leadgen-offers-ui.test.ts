// LeadGen Phase 4 Stage B2 — the Offers admin UI (contract 03 §9.2 / 04
// §10–§11) over the REAL admin router + REAL 0036–0039 migrations
// (node:sqlite harness; the leadgen-admin-shell.test.ts pattern with
// DEV_BYPASS_AUTH). All seeding goes through the REAL B1 JSON API.
//
// Covers:
//   - list: seeded rows with the EXACT §9.2 columns, dynamic/static + cap
//     badges, status pills, enabled Create button, filter row + timeframe,
//     analytics skeleton cells + hydration wiring, and the §9.1 NULL-ratio →
//     em-dash contract (API returns NULL on zero denominators; the inline
//     hydrator renders — for null metrics)
//   - §10.1 create modal markup with EXACTLY the required fields marked
//     required (mode picker + cap toggle included; optional fields unmarked)
//   - /offers/new = the list with the create modal auto-open (01 §5.2)
//   - editor tab set per the BINDING RULING for all three §10.2 kinds
//     (pure static / CPC dynamic / CPL request+static-bid)
//   - editor SSR of nested collections (headers, region rules, payload blob,
//     cap status, the §10.1 placements editor)
//   - the §11.1 dry-run panel (Payload tab, results hidden until a run)
//   - the §11.6/§11.7 response-parsing panel (Test tab): canonical rows
//     prefilled from the active schema's carrier_parse_json + pick-source
//     chips from the saved sample response
//   - the 03 §8.2 Shared /verticals + /activities union feeding the toolbar
//   - XSS: hostile offer_name/provider/placement-label render escaped
//   - unknown/malformed/foreign-kind offer id → the in-shell 404 page

import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import admin from "../src/admin/router";
import type { Env } from "../src/env";
import { mintPublicId } from "../src/leadgen/ids";

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

function buildEnv(db: D1Database): Env {
  return {
    DB: db,
    CACHE: {} as KVNamespace,
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
  offer_name: string;
  status: string;
  placements: Array<{ id: number; public_id: string; placement_id: string; is_default: boolean }>;
  [key: string]: unknown;
}

// §10.2 mode → the two flags (the 0036 DDL comment mapping).
const MODE_BODIES: Record<string, { calls_provider_api: boolean; bid_source: string }> = {
  static_no_request: { calls_provider_api: false, bid_source: "static" },
  request_static_bid: { calls_provider_api: true, bid_source: "static" },
  request_dynamic_bid: { calls_provider_api: true, bid_source: "response" },
};

async function createOffer(
  env: Env,
  mode: keyof typeof MODE_BODIES,
  overrides: Record<string, unknown> = {},
): Promise<OfferDetail> {
  const res = await admin.request(
    `${API}/offers`,
    jsonInit("POST", {
      offer_name: "UI Offer",
      activity: "quote_funnel",
      vertical: "life",
      conversion_tracking_method: "s2s_postback",
      offer_type: "cpc",
      placements: [`pl-${mintPublicId("offer").slice(-8)}`],
      cap_enabled: false,
      ...MODE_BODIES[mode],
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

const MINIMAL_SCHEMA = {
  version: 1,
  root: {
    type: "object",
    children: [
      {
        path: "data.zip",
        name: "zip",
        type: "string",
        required: true,
        source: "answer",
        internal_field: "zip",
      },
      { path: "meta.click_id", name: "click_id", type: "string", source: "macro", macro: "click_id" },
    ],
  },
};

async function postSchema(
  env: Env,
  id: string | number,
  carrierParse?: Record<string, unknown>,
): Promise<number> {
  const res = await admin.request(
    `${API}/offers/${id}/payload-schemas`,
    jsonInit("POST", {
      schema_json: MINIMAL_SCHEMA,
      ...(carrierParse !== undefined ? { carrier_parse_json: carrierParse } : {}),
    }),
    env,
  );
  expect(res.status, `POST schema for ${id}: ${await res.clone().text()}`).toBe(201);
  return ((await res.json()) as { id: number }).id;
}

async function getHtml(env: Env, path: string, expectedStatus = 200): Promise<string> {
  const res = await admin.request(path, {}, env);
  expect(res.status, `${path} status`).toBe(expectedStatus);
  return res.text();
}

// The §9.2 columns, in contract order (8 descriptive + 8 analytics + actions).
const EXPECTED_COLUMNS = [
  "Name",
  "Placement ID",
  "Provider",
  "Vertical / Activity",
  "Type",
  "Dynamic/Static",
  "Cap",
  "Status",
  "Impressions",
  "Clicks",
  "CTR",
  "Conversions",
  "CVR",
  "Revenue",
  "RPC",
  "RPM",
  "Actions",
] as const;

const ANALYTICS_METRICS = [
  "offer_impressions",
  "clicks",
  "ctr",
  "conversions",
  "cvr",
  "revenue",
  "rpc",
  "rpm",
] as const;

// ---------------------------------------------------------------------------
// List page (03 §9.2)
// ---------------------------------------------------------------------------

describeDb("leadgen offers list page (03 §9.2)", () => {
  it("renders seeded rows with the exact §9.2 columns, badges and row actions", async () => {
    const { env } = newHarness();
    const staticOffer = await createOffer(env, "static_no_request", {
      offer_name: "Pure Static Offer",
      provider: "prov-a",
      placements: ["pl-static-1"],
      static_bid_value: 4.5,
      static_bid_currency: "USD",
    });
    const dynamicOffer = await createOffer(env, "request_dynamic_bid", {
      offer_name: "Dynamic CPC Offer",
      provider: "prov-b",
      placements: ["pl-dyn-1"],
      cap_enabled: true,
    });

    const html = await getHtml(env, "/admin/leadgen/offers");

    // §9.2 column headers in contract order
    let cursor = -1;
    for (const label of EXPECTED_COLUMNS) {
      const idx = html.indexOf(`<th scope="col"`, cursor + 1);
      expect(idx, `header cell for ${label}`).toBeGreaterThan(-1);
      const at = html.indexOf(`>${label}</th>`, cursor + 1);
      expect(at, `${label} column present in order`).toBeGreaterThan(cursor);
      cursor = at;
    }

    // seeded rows + per-row anatomy
    expect(html).toContain('data-entity-name="Pure Static Offer"');
    expect(html).toContain('data-entity-name="Dynamic CPC Offer"');
    expect(html).toContain("pl-static-1");
    expect(html).toContain("pl-dyn-1");
    expect(html).toContain(">prov-a</td>");
    expect(html).toContain("life / quote_funnel");
    // §10.2 badge axis = calls_provider_api (matches the list API's `dynamic` filter)
    expect(html).toContain('<span class="badge badge-draft">Static</span>');
    expect(html).toContain('<span class="badge badge-scheduled">Dynamic</span>');
    // cap badge only on the cap-enabled offer (toggle without detail → generic label)
    expect(html).toContain('<span class="badge badge-scheduled">Cap</span>');
    // status pill
    expect(html).toContain('<span class="badge badge-published">active</span>');
    // row actions: Edit link → editor, Archive + Usage buttons
    expect(html).toContain(
      `href="/admin/leadgen/offers/${staticOffer.public_id}/edit" class="btn btn-sm btn-secondary">Edit</a>`,
    );
    expect(html).toContain(`data-offer-archive="${dynamicOffer.public_id}"`);
    expect(html).toContain(`data-offer-usage="${dynamicOffer.public_id}"`);
    // Create button top-left — ENABLED, opens the modal
    expect(html).toContain(
      '<button type="button" class="btn btn-primary" data-open-offer-modal>+ Create an Offer</button>',
    );
    expect(html).not.toMatch(/<button[^>]*disabled[^>]*>\+ Create an Offer/);
    // §9.2 filter row + timeframe control
    for (const name of ["provider", "vertical", "activity", "status", "offer_type", "dynamic", "range"]) {
      expect(html, `filter select ${name}`).toContain(`<select name="${name}"`);
    }
    expect(html).toContain('name="search"');
    // seeded distinct filter options surface in the selects
    expect(html).toContain('<option value="prov-a">prov-a</option>');
  });

  it("analytics columns: skeleton cells wired to the §10.7 endpoint; NULL ratios render as em-dash", async () => {
    const { env } = newHarness();
    const offer = await createOffer(env, "static_no_request", { offer_name: "Zero Data Offer" });

    const html = await getHtml(env, "/admin/leadgen/offers");
    // §9.1 loading skeletons per analytics cell, hydration wiring on the table
    expect(html).toContain("data-lg-analytics");
    expect(html).toContain('data-analytics-url-prefix="/api/admin/leadgen/offers/"');
    for (const metric of ANALYTICS_METRICS) {
      expect(html, `skeleton cell ${metric}`).toContain(
        `<td class="lg-num" data-metric="${metric}"><span class="skel" aria-hidden="true"></span></td>`,
      );
    }
    // the hydrator renders — (em-dash) for null metrics — the §9.1
    // NULLIF contract end-to-end: null from the API, dash in the cell
    expect(html).toContain("has ? fmt(metrics[key]) : '\\u2014'");

    // the API side of the contract: zero denominators → NULL ratios (not 0)
    const analyticsRes = await admin.request(
      `${API}/offers/${offer.public_id}/analytics`,
      {},
      env,
    );
    expect(analyticsRes.status).toBe(200);
    const body = (await analyticsRes.json()) as {
      analytics: { ctr: number | null; cvr: number | null; rpc: number | null; rpm: number | null };
    };
    expect(body.analytics.ctr).toBeNull();
    expect(body.analytics.cvr).toBeNull();
    expect(body.analytics.rpc).toBeNull();
    expect(body.analytics.rpm).toBeNull();
  });

  it("empty DB renders the empty state with an enabled create entry point", async () => {
    const { env } = newHarness();
    const html = await getHtml(env, "/admin/leadgen/offers");
    expect(html).toContain('class="empty-state"');
    expect(html).toContain("No offers yet.");
    expect(html).toContain("data-open-offer-modal");
  });

  it("vertical/activity dropdowns consume the 03 §8.2 Shared endpoints (cross-table union)", async () => {
    const { sdb, env } = newHarness();
    // offers leg contributes life/quote_funnel...
    await createOffer(env, "static_no_request", {
      offer_name: "Union Offer",
      vertical: "life",
      activity: "quote_funnel",
    });
    // ...and a SECTION contributes home/banner — values that exist in NO
    // leadgen_offers row, so their presence in the toolbar selects proves
    // the dropdowns read the shared union endpoints, not an offers-only
    // DISTINCT (the deleted B2 workaround).
    sdb
      .prepare(
        "INSERT INTO leadgen_sections (public_id, section_name, activity, vertical, headline_text, content_json) VALUES (?, 'S', 'banner', 'home', 'H', '{}')",
      )
      .run(mintPublicId("section"));

    const html = await getHtml(env, "/admin/leadgen/offers");
    for (const option of ["life", "home"]) {
      expect(html, `vertical option ${option}`).toContain(`<option value="${option}">${option}</option>`);
    }
    for (const option of ["quote_funnel", "banner"]) {
      expect(html, `activity option ${option}`).toContain(`<option value="${option}">${option}</option>`);
    }

    // the endpoints themselves return the sorted union envelope
    const verticals = await admin.request(`${API}/verticals`, {}, env);
    expect(await verticals.json()).toEqual({ items: ["home", "life"] });
    const activities = await admin.request(`${API}/activities`, {}, env);
    expect(await activities.json()).toEqual({ items: ["banner", "quote_funnel"] });
  });
});

// ---------------------------------------------------------------------------
// §10.1 create modal
// ---------------------------------------------------------------------------

describeDb("leadgen create-offer modal (04 §10.1)", () => {
  function tagFor(html: string, marker: string): string {
    const start = html.indexOf(marker);
    expect(start, `element ${marker} present`).toBeGreaterThan(-1);
    const open = html.lastIndexOf("<", start);
    const close = html.indexOf(">", start);
    return html.slice(open, close + 1);
  }

  it("renders EXACTLY the §10.1 required fields marked required; optional fields unmarked", async () => {
    const { env } = newHarness();
    const html = await getHtml(env, "/admin/leadgen/offers");

    expect(html).toContain('id="lg-offer-modal"');
    expect(html).toContain('<form id="lg-offer-form" novalidate>');

    // Required: offer_name, activity, vertical, conversion_tracking_method,
    // offer_type, ≥1 placement input, the 3 mode radios.
    for (const id of [
      'id="lg-offer-name"',
      'id="lg-offer-activity"',
      'id="lg-offer-vertical"',
      'id="lg-offer-tracking-method"',
      'id="lg-offer-type"',
    ]) {
      const tag = tagFor(html, id);
      expect(tag, `${id} marked required`).toContain("required");
      expect(tag).toContain('aria-required="true"');
    }
    const placementTag = tagFor(html, "data-placement-input");
    expect(placementTag).toContain("required");
    // §10.2 mode picker: three radios, all required
    for (const value of ["static_no_request", "request_static_bid", "request_dynamic_bid"]) {
      const radio = tagFor(html, `value="${value}"`);
      expect(radio, `mode radio ${value}`).toContain('name="auction_mode"');
      expect(radio, `mode radio ${value} required`).toContain("required");
    }
    // cap_enabled toggle present (a checkbox is inherently always-valued —
    // `required` on it would mean "must be checked", which §10.1 does not say)
    const capTag = tagFor(html, 'id="lg-offer-cap-enabled"');
    expect(capTag).toContain('type="checkbox"');
    expect(capTag).not.toContain("required");

    // Optional fields NOT marked required: tag, provider, static-bid fields
    for (const id of [
      'id="lg-offer-tag"',
      'id="lg-offer-provider"',
      'id="lg-offer-static-bid-value"',
      'id="lg-offer-static-bid-currency"',
      'id="lg-offer-static-order"',
    ]) {
      const tag = tagFor(html, id);
      expect(tag, `${id} must not be required`).not.toContain("required");
    }

    // §9.6 anatomy: top-of-modal summary + aria-live status + inline slots
    expect(html).toContain('id="lg-offer-modal-error"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('data-error-for="offer_name"');
    expect(html).toContain('data-error-for="placements"');
    expect(html).toContain('data-error-for="auction_mode"');
  });

  it("/offers/new serves the list with the create modal auto-open (01 §5.2)", async () => {
    const { env } = newHarness();
    const newHtml = await getHtml(env, "/admin/leadgen/offers/new");
    expect(newHtml).toContain('id="lg-offers-root"');
    expect(newHtml).toContain('data-autopen-create="1"');
    expect(newHtml).toContain('id="lg-offer-modal"');
    // the plain list does NOT auto-open (the script's getAttribute lookup
    // mentions the name; only /new carries the attribute itself)
    const listHtml = await getHtml(env, "/admin/leadgen/offers");
    expect(listHtml).not.toContain('data-autopen-create="1"');
  });
});

// ---------------------------------------------------------------------------
// Editor tab set (the BINDING RULING union) + SSR data
// ---------------------------------------------------------------------------

describeDb("leadgen offer editor (BINDING RULING tab union)", () => {
  function tabHidden(html: string, key: string): boolean {
    const marker = `data-lg-tab-btn="${key}"`;
    const start = html.indexOf(marker);
    expect(start, `tab button ${key} present`).toBeGreaterThan(-1);
    const close = html.indexOf(">", start);
    return html.slice(start, close).includes(" hidden");
  }

  it("pure static offer (calls=0, bid=static): Static shown; Payload/Request/Test hidden", async () => {
    const { env } = newHarness();
    const offer = await createOffer(env, "static_no_request", { offer_name: "Static Kind" });
    const html = await getHtml(env, `/admin/leadgen/offers/${offer.public_id}/edit`);
    for (const key of ["basics", "static", "region", "cap", "analytics"]) {
      expect(tabHidden(html, key), `${key} visible`).toBe(false);
    }
    for (const key of ["payload", "request", "test"]) {
      expect(tabHidden(html, key), `${key} hidden`).toBe(true);
    }
  });

  it("dynamic CPC offer (calls=1, bid=response): Payload/Request/Test shown; Static hidden", async () => {
    const { env } = newHarness();
    const offer = await createOffer(env, "request_dynamic_bid", { offer_name: "CPC Kind" });
    const html = await getHtml(env, `/admin/leadgen/offers/${offer.public_id}/edit`);
    for (const key of ["basics", "payload", "request", "test", "region", "cap", "analytics"]) {
      expect(tabHidden(html, key), `${key} visible`).toBe(false);
    }
    expect(tabHidden(html, "static"), "static hidden for a response-bid offer").toBe(true);
  });

  it("CPL offer (calls=1, bid=static): the full union — all 8 tabs visible", async () => {
    const { env } = newHarness();
    const offer = await createOffer(env, "request_static_bid", { offer_name: "CPL Kind" });
    const html = await getHtml(env, `/admin/leadgen/offers/${offer.public_id}/edit`);
    for (const key of ["basics", "static", "payload", "request", "test", "region", "cap", "analytics"]) {
      expect(tabHidden(html, key), `${key} visible`).toBe(false);
    }
  });

  it("editor anatomy: save/archive, §9.6 guards, mode picker, panels and §11 surfaces", async () => {
    const { env } = newHarness();
    const offer = await createOffer(env, "request_dynamic_bid", {
      offer_name: "Anatomy Offer",
      cap_enabled: true,
    });
    await patchOffer(env, offer.public_id, {
      endpoint_production: "https://provider.example/api/quotes",
      request_method: "POST",
      headers: [
        { header_name: "x-api-key", value_kind: "secret_ref", value_text: "PROVIDER_KEY" },
      ],
      region_rules: [
        { dimension: "state", action: "exclude", values: ["CA", "NY"], priority: 10, enabled: true },
      ],
      cap_amount: 100,
      cap_timezone: "UTC",
      cap_count_by: "clicks",
    });
    await postSchema(env, offer.public_id);

    const html = await getHtml(env, `/admin/leadgen/offers/${offer.public_id}/edit`);

    // header controls + §9.6 unsaved-changes guard + archive confirm
    expect(html).toContain('id="lg-editor-save"');
    expect(html).toContain('id="lg-editor-archive"');
    expect(html).toContain("beforeunload");
    expect(html).toContain("Archive offer");
    // §10.2 mode picker radios present with the CPC mode selected
    expect(html).toMatch(/name="auction_mode" value="request_dynamic_bid"[^>]*checked/);
    // all 8 panels exist in the DOM
    for (const key of ["basics", "static", "payload", "request", "test", "region", "cap", "analytics"]) {
      expect(html, `panel ${key}`).toContain(`data-lg-tab-panel="${key}"`);
    }
    // Request tab SSR: endpoints + header replace-set row + token editor
    expect(html).toContain('value="https://provider.example/api/quotes"');
    expect(html).toContain('value="x-api-key"');
    expect(html).toContain('value="PROVIDER_KEY"');
    expect(html).toContain('name="api_token_placement"');
    expect(html).toContain('id="lg-client-mode-warning"');
    // Region rules SSR: the stored rule row with its lgrr_ identity + values
    expect(html).toMatch(/data-rule-public-id="lgrr_[0-9A-HJKMNP-TV-Z]{26}"/);
    expect(html).toContain('value="CA, NY"');
    // Cap tab SSR: counter status card + fields
    expect(html).toContain("Counter for ");
    expect(html).toMatch(/id="lg-edit-cap-amount"[^>]*value="100"/);
    // Payload tab: the state blob carries the active schema for the builder
    expect(html).toContain('id="lg-payload-data"');
    expect(html).toContain("data.zip");
    expect(html).toContain("Active schema: v1 (manual)");
    // Test tab §11.6 panels
    for (const id of [
      "lg-test-environment",
      "lg-test-answers",
      "lg-test-run",
      "lg-test-request-payload",
      "lg-test-request-headers",
      "lg-test-response-body",
      "lg-test-parse-errors",
      "lg-test-carriers",
      "lg-test-chips",
      "lg-test-macro-flags",
    ]) {
      expect(html, `test panel element ${id}`).toContain(`id="${id}"`);
    }
    // §11.6 Test-runner parse errors must reach the TEST box, not the parser-
    // authoring box. Two same-named nested functions would hoist the last over
    // the first (silently emptying lg-test-parse-errors) — so assert the
    // runner's renderer is uniquely named and bound to the test box.
    expect((html.match(/function renderParseErrors\(/g) ?? []).length).toBe(1);
    expect(html).toContain("document.getElementById('lg-test-parse-errors')");
    expect(html).toContain("function renderParserSaveErrors(");
    // Analytics tab (read-only §10.7): all nine metric cards
    for (const label of [
      "Impressions",
      "Clicks",
      "Unique clicks",
      "Conversions",
      "CTR",
      "CVR",
      "Revenue",
      "RPC",
      "RPM",
    ]) {
      expect(html, `analytics card ${label}`).toContain(`<div class="stat-label">${label}</div>`);
    }
  });

  it("Basics tab renders the §10.1 placements editor: rows with values, ONE default radio, hostile label escaped", async () => {
    const { env } = newHarness();
    const offer = await createOffer(env, "static_no_request", {
      offer_name: "Placement Editor Offer",
      placements: ["pl-main", "pl-alt"],
    });
    const HOSTILE_LABEL = `<img src=x onerror=alert(9)>"&`;
    // author a label through the F2 PATCH surface itself
    await patchOffer(env, offer.public_id, {
      placements: [
        { public_id: offer.placements[0]?.public_id, placement_id: "pl-main", label: HOSTILE_LABEL, is_default: true },
        { public_id: offer.placements[1]?.public_id, placement_id: "pl-alt", is_default: false },
      ],
    });

    const html = await getHtml(env, `/admin/leadgen/offers/${offer.public_id}/edit`);
    // editor anatomy: rows container + add button + template + error slot
    expect(html).toContain('id="lg-placements-rows"');
    expect(html).toContain('id="lg-placement-add"');
    expect(html).toContain('id="lg-placement-editor-template"');
    expect(html).toContain('data-error-for="placements"');
    // both rows carry their lgpl_ identity + value-filled inputs
    const rowMatches = html.match(/data-placement-public-id="lgpl_[0-9A-HJKMNP-TV-Z]{26}"/g) ?? [];
    expect(rowMatches).toHaveLength(2);
    expect(html).toMatch(/data-placement-field="placement_id"[^>]*value="pl-main"/);
    expect(html).toMatch(/data-placement-field="placement_id"[^>]*value="pl-alt"/);
    // exactly ONE checked default radio (uq_leadgen_offerplacement_default mirror)
    const checkedRadios = html.match(/name="placement_default"[^>]*checked/g) ?? [];
    expect(checkedRadios).toHaveLength(1);
    // hostile label renders ESCAPED, never raw
    expect(html).not.toContain(HOSTILE_LABEL);
    expect(html).toContain("&lt;img src=x onerror=alert(9)&gt;&quot;&amp;");
  });

  it("Payload tab renders the §11.1 dry-run panel (results hidden until a run)", async () => {
    const { env } = newHarness();
    const offer = await createOffer(env, "request_dynamic_bid", { offer_name: "Dry Run Offer" });
    await postSchema(env, offer.public_id);
    const html = await getHtml(env, `/admin/leadgen/offers/${offer.public_id}/edit`);
    // the §11.1 panel: answers input + run button + inline error slots +
    // the result containers (payload/headers/notes), hidden until a run
    for (const id of [
      "lg-dryrun-panel",
      "lg-dryrun-answers",
      "lg-dryrun-answers-error",
      "lg-dryrun-run",
      "lg-dryrun-error",
      "lg-dryrun-results",
      "lg-dryrun-payload",
      "lg-dryrun-headers",
      "lg-dryrun-notes",
    ]) {
      expect(html, `dry-run element ${id}`).toContain(`id="${id}"`);
    }
    expect(html).toContain('<div id="lg-dryrun-results" hidden>');
    // it lives INSIDE the payload panel (no tab switch, §11.1)
    const payloadPanelStart = html.indexOf('data-lg-tab-panel="payload"');
    const testPanelStart = html.indexOf('data-lg-tab-panel="test"');
    const dryRunStart = html.indexOf('id="lg-dryrun-panel"');
    expect(payloadPanelStart).toBeGreaterThan(-1);
    expect(dryRunStart).toBeGreaterThan(payloadPanelStart);
    expect(dryRunStart).toBeLessThan(testPanelStart);
  });

  it("Test tab renders the §11.6/§11.7 response-parsing panel from the active schema's carrier_parse_json", async () => {
    const { sdb, env } = newHarness();
    const offer = await createOffer(env, "request_dynamic_bid", { offer_name: "Parser Offer" });
    const schemaId = await postSchema(env, offer.public_id, {
      carriers_path: "data.carriers",
      // a fallback ARRAY renders comma-joined (first-wins §11.7 chain)
      fields: { carrier_name: "name", bid: ["price.amount", "bid"], click_url: "url" },
    });

    let html = await getHtml(env, `/admin/leadgen/offers/${offer.public_id}/edit`);
    expect(html).toContain("Response parsing (§11.6/§11.7)");
    expect(html).toContain('id="lg-parse-save"');
    expect(html).toContain('id="lg-parse-errors"');
    expect(html).toMatch(/id="lg-parse-carriers-path"[^>]*value="data\.carriers"/);
    // one authoring row per canonical Carrier field (04 §11.7 set)
    const rowKeys = [
      "provider_id",
      "carrier_name",
      "carrier_logo",
      "bid",
      "bid_currency",
      "click_url",
      "tracking_id",
      "headline",
      "subheadline",
      "disclaimer",
      "pricing_model",
    ];
    for (const key of rowKeys) {
      expect(html, `parse row ${key}`).toContain(`data-parse-field="${key}"`);
    }
    expect((html.match(/data-parse-field="/g) ?? []).length).toBe(rowKeys.length);
    // mapped values prefill; unmapped rows render empty
    expect(html).toMatch(/data-parse-field="carrier_name"[\s\S]*?value="name"/);
    expect(html).toMatch(/data-parse-field="bid"[\s\S]*?value="price\.amount, bid"/);
    // no sample yet → the chips help text, no chip buttons
    expect(html).toContain("No sample response saved yet");
    expect(html).not.toContain("data-parse-chip=");

    // a saved sample (the §11.6 Test-tool persistence target) renders its
    // inferred field paths as pick-source chips — the response_field_paths
    // mechanics reused at SSR
    sdb
      .prepare("UPDATE leadgen_offer_payload_schemas SET sample_response_json = ? WHERE id = ?")
      .run(JSON.stringify({ data: { carriers: [{ name: "Acme", bid: 3.2 }] }, session: "s-1" }), schemaId);
    html = await getHtml(env, `/admin/leadgen/offers/${offer.public_id}/edit`);
    for (const path of ["data.carriers.0.name", "data.carriers.0.bid", "session"]) {
      expect(html, `pick-source chip ${path}`).toContain(`data-parse-chip="${path}"`);
    }
  });
});

// ---------------------------------------------------------------------------
// XSS + 404 semantics
// ---------------------------------------------------------------------------

describeDb("leadgen offers UI — escaping + 404 semantics", () => {
  const HOSTILE_NAME = `<script>alert(1)</script>"&'`;
  const HOSTILE_PROVIDER = `"><img src=x onerror=alert(2)>`;

  it("hostile offer_name/provider render escaped on the list page", async () => {
    const { env } = newHarness();
    await createOffer(env, "static_no_request", {
      offer_name: HOSTILE_NAME,
      provider: HOSTILE_PROVIDER,
    });
    const html = await getHtml(env, "/admin/leadgen/offers");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain('"><img src=x onerror=alert(2)>');
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;&quot;&amp;&#39;");
    expect(html).toContain("&quot;&gt;&lt;img src=x onerror=alert(2)&gt;");
  });

  it("hostile offer_name/provider render escaped on the editor page", async () => {
    const { env } = newHarness();
    const offer = await createOffer(env, "static_no_request", {
      offer_name: HOSTILE_NAME,
      provider: HOSTILE_PROVIDER,
    });
    const html = await getHtml(env, `/admin/leadgen/offers/${offer.public_id}/edit`);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain('"><img src=x onerror=alert(2)>');
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;&quot;&amp;&#39;");
    expect(html).toContain("&quot;&gt;&lt;img src=x onerror=alert(2)&gt;");
  });

  it("unknown / foreign-kind / malformed offer ids → the in-shell 404 page", async () => {
    const { env } = newHarness();
    const cases = [
      mintPublicId("offer"), // well-formed, nonexistent
      mintPublicId("section"), // foreign kind
      "999999", // numeric, nonexistent
      "lgo_short", // malformed
    ];
    for (const id of cases) {
      const res = await admin.request(`/admin/leadgen/offers/${id}/edit`, {}, env);
      expect(res.status, `${id} → 404`).toBe(404);
      const html = await res.text();
      expect(html).toContain("Offer not found.");
      expect(html).toContain('data-marker="kodigital-admin-shell"');
      expect(res.headers.get("Cache-Control"), `${id} no-store`).toBe("private, no-store");
    }
  });
});

// ---------------------------------------------------------------------------
// ES5-only inline scripts (the layout.ts constraint the listicles pages hold
// too — listicles-ui-es5.test.ts mechanism: forbidden-token scan + a
// node --check parse of every EMITTED <script> block)
// ---------------------------------------------------------------------------

const SCRIPT_RE = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;

function extractScripts(html: string): string[] {
  const blocks: string[] = [];
  for (const match of html.matchAll(SCRIPT_RE)) {
    const body = match[1] ?? "";
    // JSON state blobs (type="application/json") are data, not scripts.
    if ((match[0] ?? "").includes('type="application/json"')) continue;
    blocks.push(body);
  }
  return blocks;
}

const scratchDir = mkdtempSync(join(tmpdir(), "leadgen-script-parse-"));
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

describeDb("leadgen offers pages — ES5-only inline scripts", () => {
  async function renderedPages(): Promise<Array<[string, string]>> {
    const { env } = newHarness();
    const offer = await createOffer(env, "request_dynamic_bid", { offer_name: "ES5 Offer" });
    await postSchema(env, offer.public_id);
    return [
      ["offers-list", await getHtml(env, "/admin/leadgen/offers")],
      ["offers-new", await getHtml(env, "/admin/leadgen/offers/new")],
      ["offer-editor", await getHtml(env, `/admin/leadgen/offers/${offer.public_id}/edit`)],
    ];
  }

  it("every inline <script> block is ES5 (no arrow/const/let/async/await/backtick)", async () => {
    for (const [label, html] of await renderedPages()) {
      const scripts = extractScripts(html);
      expect(scripts.length, `${label} must ship at least one inline script block`).toBeGreaterThan(0);
      for (const script of scripts) {
        expect(script, `${label} arrow`).not.toMatch(/=>/);
        expect(script, `${label} const`).not.toMatch(/\bconst\b/);
        expect(script, `${label} let`).not.toMatch(/\blet\b/);
        expect(script, `${label} async`).not.toMatch(/\basync\b/);
        expect(script, `${label} await`).not.toMatch(/\bawait\b/);
        expect(script, `${label} backtick`).not.toContain("`");
      }
    }
  });

  it("every emitted inline <script> parses as standalone JavaScript (node --check)", async () => {
    for (const [label, html] of await renderedPages()) {
      const scripts = extractScripts(html);
      const errors: string[] = [];
      scripts.forEach((script, i) => {
        const err = parseError(`${label}-script${i + 1}`, script);
        if (err) errors.push(err);
      });
      expect(errors, errors.join("\n\n")).toEqual([]);
    }
  });
});
