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
import {
  LEADGEN_ELIGIBILITY_REASON_LABELS,
  LEADGEN_OFFER_USAGE_KINDS,
} from "../src/admin/leadgen/ui-offers";

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

// The §9.2 columns, in contract order (8 descriptive + the 05 §5.1
// eligibility badge column + 8 analytics + actions).
const EXPECTED_COLUMNS = [
  "Name",
  "Placement ID",
  "Provider",
  "Vertical / Activity",
  "Type",
  "Dynamic/Static",
  "Eligibility",
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

// ---------------------------------------------------------------------------
// 05 §5.1 (fix-contract v2.4, R4) — offer eligibility surfaces:
// additive GET/list `eligibility` verdict, the editor banner, the list badge.
// ---------------------------------------------------------------------------

// The 8 §5.1 reason codes, exactly (leadgen/validation.ts).
const ALL_ELIGIBILITY_CODES = [
  "no_active_schema",
  "schema_validation_errors",
  "test_untested",
  "test_failed",
  "endpoint_missing",
  "invalid_headers",
  "carrier_parse_missing",
  "carrier_parse_invalid",
] as const;

interface EligibilityBody {
  eligibility: { eligible: boolean; reasons: string[] } | null;
  [key: string]: unknown;
}

async function getOfferJson(env: Env, id: string): Promise<EligibilityBody> {
  const res = await admin.request(`${API}/offers/${id}`, {}, env);
  expect(res.status).toBe(200);
  return (await res.json()) as EligibilityBody;
}

function seedPassedTest(sdb: SqliteDb, offerPublicId: string, statusCode: number): void {
  sdb
    .prepare(
      "INSERT INTO leadgen_provider_request_log (offer_public_id, environment, status_code) VALUES (?, 'production', ?)",
    )
    .run(offerPublicId, statusCode);
}

// A FULLY-configured dynamic offer: active schema + usable carrier parse +
// production endpoint + a passed operator Test → eligible.
async function seedEligibleDynamicOffer(env: Env, sdb: SqliteDb): Promise<OfferDetail> {
  const offer = await createOffer(env, "request_dynamic_bid", { offer_name: "Ready Dyn Offer" });
  await postSchema(env, offer.public_id, {
    carriers_path: "carriers",
    fields: { carrier_name: "name", bid: "bid", click_url: "url" },
  });
  await patchOffer(env, offer.public_id, { endpoint_production: "https://provider.example/quote" });
  seedPassedTest(sdb, offer.public_id, 200);
  return offer;
}

describeDb("leadgen offer eligibility — additive API fields (05 §5.1)", () => {
  it("the label map covers ALL 8 reason codes with operator English (no raw codes)", () => {
    expect(Object.keys(LEADGEN_ELIGIBILITY_REASON_LABELS).sort()).toEqual(
      [...ALL_ELIGIBILITY_CODES].sort(),
    );
    for (const code of ALL_ELIGIBILITY_CODES) {
      const label = LEADGEN_ELIGIBILITY_REASON_LABELS[code]!;
      expect(label, `label for ${code}`).toBeTruthy();
      expect(label, `label for ${code} must be prose, not the code`).not.toBe(code);
      expect(label, `label for ${code} must not leak snake_case`).not.toMatch(/_/);
    }
  });

  it("offer GET carries the additive eligibility verdict; nothing existing is dropped", async () => {
    const { env } = newHarness();
    const dynamic = await createOffer(env, "request_dynamic_bid", { offer_name: "Fresh Dyn" });
    const body = await getOfferJson(env, dynamic.public_id);
    // additive verdict: a fresh dynamic offer is blocked for these reasons
    expect(body.eligibility).not.toBeNull();
    expect(body.eligibility!.eligible).toBe(false);
    for (const code of ["no_active_schema", "test_untested", "endpoint_missing", "carrier_parse_missing"]) {
      expect(body.eligibility!.reasons, `reason ${code}`).toContain(code);
    }
    // DENY nothing existing: the detail collections all still ride the GET
    expect(Array.isArray(body["placements"])).toBe(true);
    expect(Array.isArray(body["headers"])).toBe(true);
    expect(Array.isArray(body["region_rules"])).toBe(true);
    expect(body["offer_name"]).toBe("Fresh Dyn");
  });

  it("a static offer is outside the gate: eligibility rides eligible:true", async () => {
    const { env } = newHarness();
    const staticOffer = await createOffer(env, "static_no_request", { offer_name: "Pure Static" });
    const body = await getOfferJson(env, staticOffer.public_id);
    expect(body.eligibility).toEqual({ eligible: true, reasons: [] });
  });

  it("a fully-configured dynamic offer becomes eligible (schema + parse + endpoint + passed test)", async () => {
    const { sdb, env } = newHarness();
    const offer = await seedEligibleDynamicOffer(env, sdb);
    const body = await getOfferJson(env, offer.public_id);
    expect(body.eligibility).toEqual({ eligible: true, reasons: [] });
  });

  it("the offers LIST carries the additive per-item eligibility verdict", async () => {
    const { env } = newHarness();
    await createOffer(env, "request_dynamic_bid", { offer_name: "List Dyn" });
    await createOffer(env, "static_no_request", { offer_name: "List Static" });
    const res = await admin.request(`${API}/offers`, {}, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ offer_name: string; eligibility: { eligible: boolean; reasons: string[] } | null }> };
    const dyn = body.items.find((i) => i.offer_name === "List Dyn");
    const stat = body.items.find((i) => i.offer_name === "List Static");
    expect(dyn?.eligibility?.eligible).toBe(false);
    expect(dyn?.eligibility?.reasons).toContain("no_active_schema");
    expect(stat?.eligibility).toEqual({ eligible: true, reasons: [] });
  });
});

describeDb("leadgen offer editor eligibility banner (05 §5.1 site 1)", () => {
  it("blocked dynamic offer: persistent banner with operator labels + fix links (Payload/Test tabs)", async () => {
    const { env } = newHarness();
    const offer = await createOffer(env, "request_dynamic_bid", { offer_name: "Blocked Dyn" });
    const html = await getHtml(env, `/admin/leadgen/offers/${offer.public_id}/edit`);
    expect(html).toContain('data-eligibility-banner="blocked"');
    expect(html).toContain("Blocked from live auction:");
    for (const code of ["no_active_schema", "test_untested", "endpoint_missing", "carrier_parse_missing"]) {
      expect(html, `reason item ${code}`).toContain(`data-eligibility-reason="${code}"`);
      expect(html, `label for ${code}`).toContain(LEADGEN_ELIGIBILITY_REASON_LABELS[code]!);
    }
    // fix links jump to the schema editor (Payload) tab + the Test tab
    expect(html).toContain('data-eligibility-fix="payload"');
    expect(html).toContain("Open Payload Schema");
    expect(html).toContain('data-eligibility-fix="test"');
    expect(html).toContain("Open Test tab");
    // the editor script wires the fix links onto the tab switcher
    expect(html).toContain("closest('[data-eligibility-fix]')");
  });

  it("eligible dynamic offer: the green banner", async () => {
    const { sdb, env } = newHarness();
    const offer = await seedEligibleDynamicOffer(env, sdb);
    const html = await getHtml(env, `/admin/leadgen/offers/${offer.public_id}/edit`);
    expect(html).toContain('data-eligibility-banner="eligible"');
    expect(html).toContain("Eligible for live auction");
    expect(html).not.toContain('data-eligibility-banner="blocked"');
  });

  it("static offer: NO banner (outside the gate)", async () => {
    const { env } = newHarness();
    const offer = await createOffer(env, "static_no_request", { offer_name: "No Banner" });
    const html = await getHtml(env, `/admin/leadgen/offers/${offer.public_id}/edit`);
    expect(html).not.toContain("data-eligibility-banner");
  });

  it("ALL 8 reason codes render as operator labels across two crafted offers", async () => {
    const { sdb, env } = newHarness();

    // Offer A: no schema, untested, no endpoint, unresolvable header →
    // no_active_schema + test_untested + endpoint_missing + invalid_headers +
    // carrier_parse_missing (5 of 8).
    const offerA = await createOffer(env, "request_dynamic_bid", { offer_name: "Matrix A" });
    sdb
      .prepare(
        "INSERT INTO leadgen_offer_headers (offer_id, header_name, value_kind, value_text) VALUES (?, 'X-Auth', 'macro', '')",
      )
      .run(offerA.id);

    // Offer B: schema present but INVALID, carrier parse INVALID, last test
    // FAILED, endpoint present → schema_validation_errors + test_failed +
    // carrier_parse_invalid (the remaining 3 of 8).
    const offerB = await createOffer(env, "request_dynamic_bid", { offer_name: "Matrix B" });
    await postSchema(env, offerB.public_id, {
      carriers_path: "carriers",
      fields: { carrier_name: "name", bid: "bid", click_url: "url" },
    });
    await patchOffer(env, offerB.public_id, { endpoint_production: "https://provider.example/q" });
    sdb
      .prepare("UPDATE leadgen_offer_payload_schemas SET schema_json = ?, carrier_parse_json = ? WHERE offer_id = ?")
      .run('{"nope":true}', '{"fields":[]}', offerB.id);
    seedPassedTest(sdb, offerB.public_id, 500);

    const bodyA = await getOfferJson(env, offerA.public_id);
    const bodyB = await getOfferJson(env, offerB.public_id);
    expect(bodyA.eligibility!.reasons.sort()).toEqual(
      ["carrier_parse_missing", "endpoint_missing", "invalid_headers", "no_active_schema", "test_untested"].sort(),
    );
    expect(bodyB.eligibility!.reasons.sort()).toEqual(
      ["carrier_parse_invalid", "schema_validation_errors", "test_failed"].sort(),
    );
    // together the two verdicts exercise ALL 8 codes
    expect([...bodyA.eligibility!.reasons, ...bodyB.eligibility!.reasons].sort()).toEqual(
      [...ALL_ELIGIBILITY_CODES].sort(),
    );

    const htmlA = await getHtml(env, `/admin/leadgen/offers/${offerA.public_id}/edit`);
    for (const code of bodyA.eligibility!.reasons) {
      expect(htmlA, `A label for ${code}`).toContain(LEADGEN_ELIGIBILITY_REASON_LABELS[code]!);
    }
    const htmlB = await getHtml(env, `/admin/leadgen/offers/${offerB.public_id}/edit`);
    for (const code of bodyB.eligibility!.reasons) {
      expect(htmlB, `B label for ${code}`).toContain(LEADGEN_ELIGIBILITY_REASON_LABELS[code]!);
    }
  });
});

describeDb("leadgen offers list eligibility badge column (05 §5.1)", () => {
  it("dynamic rows badge Eligible/Blocked (labels in the title); static rows show a neutral dash", async () => {
    const { sdb, env } = newHarness();
    await seedEligibleDynamicOffer(env, sdb);
    await createOffer(env, "request_dynamic_bid", { offer_name: "Blocked List Dyn" });
    await createOffer(env, "static_no_request", { offer_name: "Static List" });

    const html = await getHtml(env, "/admin/leadgen/offers");
    // the new column header sits between Dynamic/Static and Cap
    const dynIdx = html.indexOf(">Dynamic/Static</th>");
    const eligIdx = html.indexOf(">Eligibility</th>");
    const capIdx = html.indexOf(">Cap</th>");
    expect(dynIdx).toBeGreaterThan(-1);
    expect(eligIdx).toBeGreaterThan(dynIdx);
    expect(capIdx).toBeGreaterThan(eligIdx);
    // badges per row state
    expect(html).toContain('data-offer-eligibility="eligible"');
    expect(html).toContain('data-offer-eligibility="blocked"');
    expect(html).toContain('data-offer-eligibility="na"');
    expect(html).toContain(">Eligible</span>");
    expect(html).toContain(">Blocked</span>");
    // blocked badge title carries operator labels, not raw codes
    expect(html).toContain(LEADGEN_ELIGIBILITY_REASON_LABELS["no_active_schema"]!);
    // every existing column/action stays (the §9.2 walker above also holds)
    expect(html).toContain("data-offer-archive=");
    expect(html).toContain("data-offer-usage=");
  });
});

// ---------------------------------------------------------------------------
// Phase 3 (fix-contract v2.4 · 07) — offer management UI
// ---------------------------------------------------------------------------

// The open tag around a marker (a module-level twin of the create-modal helper).
function tagAround(html: string, marker: string): string {
  const start = html.indexOf(marker);
  expect(start, `element ${marker} present`).toBeGreaterThan(-1);
  const open = html.lastIndexOf("<", start);
  const close = html.indexOf(">", start);
  return html.slice(open, close + 1);
}

describeDb("leadgen offers list — §7.1 row actions (kebab)", () => {
  it("every row exposes a kebab with Edit·Duplicate·Archive·Delete·Usage (Delete always visible)", async () => {
    const { env } = newHarness();
    const offer = await createOffer(env, "request_dynamic_bid", { offer_name: "Row Actions Offer" });
    const html = await getHtml(env, "/admin/leadgen/offers");
    // kebab toggle + menu
    expect(html).toContain(`data-offer-kebab-toggle="${offer.public_id}"`);
    expect(html).toContain("data-offer-kebab-menu");
    // all five actions keyed to the offer (Delete always present — guarded, never hidden)
    expect(html).toContain(`data-offer-duplicate="${offer.public_id}"`);
    expect(html).toContain(`data-offer-archive="${offer.public_id}"`);
    expect(html).toContain(`data-offer-delete="${offer.public_id}"`);
    expect(html).toContain(`data-offer-usage="${offer.public_id}"`);
    // inline Edit link preserved (additive)
    expect(html).toContain(
      `href="/admin/leadgen/offers/${offer.public_id}/edit" class="btn btn-sm btn-secondary">Edit</a>`,
    );
    // the eligibility badge column is preserved
    expect(html).toContain("data-eligibility-cell");
  });
});

describeDb("leadgen offers — §7.3 duplicate modal", () => {
  it("renders the modal: REQUIRED default placement id + the three copy toggles at their defaults", async () => {
    const { env } = newHarness();
    await createOffer(env, "request_dynamic_bid", { offer_name: "Dup Source" });
    const html = await getHtml(env, "/admin/leadgen/offers");
    expect(html).toContain('id="lg-offer-duplicate-modal"');
    expect(html).toContain('id="lg-dup-name"');
    const placement = tagAround(html, 'id="lg-dup-placement"');
    expect(placement, "default placement id required").toContain("required");
    expect(placement).toContain('aria-required="true"');
    // §7.3 defaults: region ON, endpoint ON, cap OFF ("copied disabled")
    expect(tagAround(html, 'id="lg-dup-copy-region"')).toContain("checked");
    expect(tagAround(html, 'id="lg-dup-copy-endpoint"')).toContain("checked");
    expect(tagAround(html, 'id="lg-dup-copy-cap"')).not.toContain("checked");
    expect(html).toContain("copied disabled");
    expect(html).toContain(">Create draft</button>");
  });

  it("the island blocks submit when the placement id is empty, prefills '<name> (copy)', and POSTs the pinned body", async () => {
    const { env } = newHarness();
    await createOffer(env, "static_no_request", { offer_name: "Dup Source 2" });
    const html = await getHtml(env, "/admin/leadgen/offers");
    // client-side required-placement block (submit blocked when empty)
    expect(html).toContain("placementVal === ''");
    expect(html).toContain("A new default placement ID is required");
    // prefill "<name> (copy)"
    expect(html).toContain("(name || 'Offer') + ' (copy)'");
    // POSTs to the pinned duplicate endpoint with the pinned body fields
    expect(html).toContain("'/duplicate'");
    expect(html).toContain("default_placement_id: placementVal");
    expect(html).toContain("copy_region_rules: copyRegion");
    expect(html).toContain("copy_cap_settings: copyCap");
    expect(html).toContain("copy_endpoint_config: copyEndpoint");
  });

  it("the editor renders the 'Duplicated from <name>' banner from the navigation query params", async () => {
    const { env } = newHarness();
    const offer = await createOffer(env, "request_dynamic_bid", { offer_name: "Dup Target" });
    const html = await getHtml(
      env,
      `/admin/leadgen/offers/${offer.public_id}/edit?duplicated_from=Source%20Offer&copied=copy_region_rules,copy_endpoint_config&skipped=copy_cap_settings&pending=2`,
    );
    expect(html).toContain("data-dup-banner");
    expect(html).toContain("Duplicated from Source Offer");
    expect(html).toContain('data-dup-copied="copy_region_rules"');
    expect(html).toContain('data-dup-copied="copy_endpoint_config"');
    expect(html).toContain('data-dup-skipped="copy_cap_settings"');
    expect(html).toContain("Region rules: copied");
    expect(html).toContain("Cap settings (copied disabled): not copied");
    expect(html).toContain('data-dup-pending="2"');
  });

  it("no banner without the duplicated_from param", async () => {
    const { env } = newHarness();
    const offer = await createOffer(env, "static_no_request", { offer_name: "Plain Editor" });
    const html = await getHtml(env, `/admin/leadgen/offers/${offer.public_id}/edit`);
    expect(html).not.toContain("data-dup-banner");
  });
});

describeDb("leadgen offers — §7.2 delete + §7.4 usage panel", () => {
  it("renders the type-to-confirm delete modal (submit disabled) + the 409/mode=hard island wiring", async () => {
    const { env } = newHarness();
    await createOffer(env, "static_no_request", { offer_name: "Del Offer" });
    const html = await getHtml(env, "/admin/leadgen/offers");
    expect(html).toContain('id="lg-offer-delete-modal"');
    expect(html).toContain("data-delete-offer-name");
    expect(tagAround(html, 'id="lg-del-submit"')).toContain("disabled");
    // hard-delete path + type-to-confirm gate
    expect(html).toContain("'?mode=hard'");
    expect(html).toContain("delTarget.name");
    // 409 offer_in_use → the usage report as the "in use" (blocked) modal + Archive instead
    expect(html).toContain("res.status === 409");
    expect(html).toContain("'blocked'");
    expect(html).toContain("data-usage-archive");
    expect(html).toContain("Archive instead");
  });

  it("the usage-kinds bootstrap island round-trips ALL §7.4 kinds; the panel renders them data-driven", async () => {
    const { env } = newHarness();
    await createOffer(env, "static_no_request", { offer_name: "Usage Offer" });
    const html = await getHtml(env, "/admin/leadgen/offers");
    const m = html.match(/<script type="application\/json" id="lg-offer-usage-kinds">([\s\S]*?)<\/script>/);
    expect(m, "usage-kinds bootstrap island present").not.toBeNull();
    const parsed = JSON.parse(m![1]!) as Array<{ kind: string; label: string; warning_only: boolean }>;
    const kinds = parsed.map((k) => k.kind);
    for (const meta of LEADGEN_OFFER_USAGE_KINDS) {
      expect(kinds, `kind ${meta.kind} in island`).toContain(meta.kind);
    }
    // warning-only kinds (logs/revenue/analytics) are flagged as non-blocking
    expect(kinds).toContain("provider_request_logs");
    expect(parsed.find((k) => k.kind === "provider_request_logs")!.warning_only).toBe(true);
    // island renders each kind + the delete_eligibility verdict; links are XSS-guarded
    expect(html).toContain("data-usage-kind");
    expect(html).toContain("delete_eligibility");
    expect(html).toContain("data-usage-verdict");
    expect(html).toContain("function safeLink");
  });
});

describeDb("leadgen offers — §7.5 region rules UX (D1/D2/D3)", () => {
  async function regionEditorHtml(): Promise<string> {
    const { env } = newHarness();
    const offer = await createOffer(env, "static_no_request", { offer_name: "Region Offer" });
    return getHtml(env, `/admin/leadgen/offers/${offer.public_id}/edit`);
  }

  it("D1: the action select shows the two frozen behaviors, never the raw enum aliases", async () => {
    const html = await regionEditorHtml();
    expect(html).toContain(">Allow only these regions</option>");
    expect(html).toContain(">Block these regions</option>");
    expect(html).toContain('value="include_only"');
    expect(html).toContain('value="exclude"');
    // storage enum unchanged, but the aliases are never OFFERED as options
    expect(html).not.toContain('<option value="allow_list"');
    expect(html).not.toContain('<option value="block_list"');
  });

  it("D1: a legacy allow_list rule displays as 'Allow only these regions' (include_only selected)", async () => {
    const { env, sdb } = newHarness();
    const offer = await createOffer(env, "static_no_request", { offer_name: "Legacy Region Offer" });
    sdb
      .prepare(
        "INSERT INTO leadgen_offer_region_rules (public_id, offer_id, dimension, action, values_json, priority, enabled) VALUES (?,?,?,?,?,?,1)",
      )
      .run(mintPublicId("offer_region_rule"), offer.id, "country", "allow_list", JSON.stringify(["US"]), 50);
    const html = await getHtml(env, `/admin/leadgen/offers/${offer.public_id}/edit`);
    expect(html).toContain('<option value="include_only" selected>Allow only these regions</option>');
  });

  it("D2: the priority field is labeled 'Evaluation order' with the ordering help", async () => {
    const html = await regionEditorHtml();
    expect(html).toContain("Evaluation order");
    expect(html).toContain('aria-label="Evaluation order"');
    expect(html).toContain("Rules run lowest number first; the first blocking rule wins. Default 100.");
  });

  it("D3: the section header help separates provider region-blocks from Auction participation", async () => {
    const html = await regionEditorHtml();
    expect(html).toContain(
      "These are provider region-block rules only. Answer-based Offer participation rules are configured in Auction.",
    );
  });

  it("D3: Country (ISO alpha-2) + State (filtered) dropdowns + City/ZIP text entry + paste-multiple", async () => {
    const html = await regionEditorHtml();
    expect(html).toContain('data-region-input="country"');
    expect(html).toContain('data-region-input="state"');
    expect(html).toContain('data-region-input="text"');
    expect(html).toContain("data-region-state-country");
    // ISO alpha-2 country option + a US state SSR'd in the state select
    expect(html).toContain('<option value="US">United States (US)</option>');
    expect(html).toContain(">California (CA)</option>");
    // paste-multiple affordance
    expect(html).toContain("Paste multiple");
    expect(html).toContain("data-region-paste");
    // the geo bootstrap island (states-by-country) round-trips; CA provinces baseline present
    const gm = html.match(/<script type="application\/json" id="lg-region-geo">([\s\S]*?)<\/script>/);
    expect(gm, "region-geo island present").not.toBeNull();
    const geo = JSON.parse(gm![1]!) as { states: Record<string, Array<[string, string]>> };
    expect(geo.states.US!.length).toBeGreaterThan(40);
    expect(geo.states.CA!.some(([code]) => code === "AB")).toBe(true);
  });

  it("D3: island client ZIP validation + comma/newline paste split + inline region_value_invalid", async () => {
    const html = await regionEditorHtml();
    // ZIP client validation /^\d{5}$/
    expect(html).toContain("/^\\d{5}$/");
    // paste-multiple split on comma/newline
    expect(html).toContain("/[,\\n\\r]+/");
    // typed server region_value_invalid surfaced inline (dimension + token)
    expect(html).toContain("region_value_invalid");
    expect(html).toContain("data-region-invalid");
    expect(html).toContain("window.lgRegionErrors");
  });

  it("keeps the canonical comma-joined values field (collectRegionRules contract) for a stored rule", async () => {
    const { env } = newHarness();
    const offer = await createOffer(env, "static_no_request", { offer_name: "Region Values Offer" });
    await patchOffer(env, offer.public_id, {
      region_rules: [{ dimension: "state", action: "exclude", values: ["CA", "NY"], priority: 10, enabled: true }],
    });
    const html = await getHtml(env, `/admin/leadgen/offers/${offer.public_id}/edit`);
    // hidden canonical values field (the replace-set the editor Save collects)
    expect(html).toMatch(/data-rule-field="values"[^>]*value="CA, NY"/);
    expect(html).toMatch(/data-rule-public-id="lgrr_[0-9A-HJKMNP-TV-Z]{26}"/);
  });
});
