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
import { runInNewContext } from "node:vm";
import admin from "../src/admin/router";
import type { Env } from "../src/env";
import { mintPublicId } from "../src/leadgen/ids";
import { LEADGEN_ELIGIBILITY_REASON_LABELS, testStatusChip } from "../src/admin/leadgen/ui-offers";
import {
  REGION_RULE_ACTION_LABELS,
  REGION_RULE_BEHAVIORS,
  REGION_RULE_PRIORITY_HELP,
  REGION_RULE_PRIORITY_LABEL,
  REGION_RULES_SECTION_HELP,
} from "../src/leadgen/rules";

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
  "0040_leadgen_runtime_context.sql",
  "0041_leadgen_frame_theme.sql",
  "0042_leadgen_pages.sql",
  "0043_leadgen_routing_rules.sql",
  "0044_leadgen_redirect_pct.sql",
  "0045_leadgen_persona_quota.sql",
  // Rework P1 (§5 M1-M12): the full migration set so leadgen_funnel_
  // variant_sections carries the M2 owner axis (quote_id) — buildOfferUsage-
  // Report's quotes_indirect check (offers-handlers.ts) now reads it
  // unconditionally, which this file's "F1 (executed)" usage-report tests
  // exercise via GET /offers/:id/usage.
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
// eligibility badge column + the §7.1 test-status chip column + 8 analytics
// + actions).
const EXPECTED_COLUMNS = [
  "Name",
  "Placement ID",
  "Provider",
  "Vertical / Activity",
  "Type",
  "Dynamic/Static",
  "Eligibility",
  "Test status",
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

  it("F1: the drifted client-side kind list is GONE — no lg-offer-usage-kinds island, no keyed-map indexing", async () => {
    const { env } = newHarness();
    await createOffer(env, "static_no_request", { offer_name: "Usage Offer" });
    const html = await getHtml(env, "/admin/leadgen/offers");
    // the drift-prone bootstrap island is deleted; the server's usage.kinds
    // ARRAY is the single source (see the executed F1 suite below)
    expect(html).not.toContain('id="lg-offer-usage-kinds"');
    expect(html).not.toContain("payload_schemas"); // the phantom kind is unreproducible
    // the island reads the kinds array + the delete_eligibility verdict; links XSS-guarded
    expect(html).toContain("usage.kinds");
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

  it("F11: the rendered labels come from leadgen/rules.ts — the ONE source (byte-identical)", async () => {
    const html = await regionEditorHtml();
    // the behavior <option>s carry the rules.ts labels byte-identically
    for (const behavior of REGION_RULE_BEHAVIORS) {
      expect(html, `behavior option ${behavior.value}`).toContain(
        `<option value="${behavior.value}"`,
      );
      expect(html, `behavior label for ${behavior.value}`).toContain(
        `>${REGION_RULE_ACTION_LABELS[behavior.value]}</option>`,
      );
    }
    // priority label + ordering help + the section-scope help, from rules.ts
    expect(html).toContain(`<span>${REGION_RULE_PRIORITY_LABEL}</span>`);
    expect(html).toContain(`aria-label="${REGION_RULE_PRIORITY_LABEL}"`);
    expect(html).toContain(`${REGION_RULE_PRIORITY_LABEL}: ${REGION_RULE_PRIORITY_HELP}`);
    expect(html).toContain(REGION_RULES_SECTION_HELP);
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

// ---------------------------------------------------------------------------
// Executable-island harness (the leadgen-payload-builder-ui.test.ts F-1
// pattern): the REAL island functions are sliced out of the SERVED script and
// executed in a vm over a minimal element stand-in implementing exactly the
// DOM surface they touch. These suites prove island BEHAVIOR against the REAL
// server JSON (produced by the real handlers over the real migrations), not
// source text.
// ---------------------------------------------------------------------------

interface FakeEl {
  tagName: string;
  nodeType: number;
  attrs: Map<string, string>;
  children: FakeEl[];
  className: string;
  hidden: boolean;
  value: string;
  checked: boolean;
  type?: string;
  placeholder?: string;
  textContent: string;
  readonly firstChild: FakeEl | null;
  appendChild(c: FakeEl): FakeEl;
  removeChild(c: FakeEl): FakeEl;
  setAttribute(k: string, v: string): void;
  getAttribute(k: string): string | null;
  removeAttribute(k: string): void;
  dispatchEvent(ev: unknown): boolean;
  querySelector(sel: string): FakeEl | null;
}

// Selector support: '[attr]' and '[attr="value"]' (the only forms the sliced
// island functions use).
function attrSelectorMatch(el: FakeEl, sel: string): boolean {
  const m = sel.match(/^\[([^\]=]+)(?:="([^"]*)")?\]$/);
  if (m === null) return false;
  const name = m[1]!;
  if (!el.attrs.has(name)) return false;
  return m[2] === undefined ? true : el.attrs.get(name) === m[2];
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
    checked: false,
    textContent: "",
    get firstChild() {
      return children.length > 0 ? children[0]! : null;
    },
    appendChild(c) {
      children.push(c);
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
    dispatchEvent() {
      return true;
    },
    querySelector(sel) {
      for (const c of children) {
        if (c.nodeType !== 1) continue;
        if (attrSelectorMatch(c, sel)) return c;
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

// All descendants (element nodes) matching a predicate, in document order.
function findAll(root: FakeEl, pred: (el: FakeEl) => boolean): FakeEl[] {
  const out: FakeEl[] = [];
  for (const c of root.children) {
    if (c.nodeType === 1 && pred(c)) out.push(c);
    out.push(...findAll(c, pred));
  }
  return out;
}

// Concatenated text (createTextNode children + direct textContent writes).
function textOf(node: FakeEl): string {
  let out = node.nodeType === 3 ? node.textContent : node.textContent || "";
  for (const c of node.children) out += textOf(c);
  return out;
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

// ---------------------------------------------------------------------------
// F1 (executed) — the §7.4 usage report island renders the SERVER's kinds
// ARRAY (real handler JSON in, DOM out). The old code indexed usage[kind] as
// a keyed map off a drifted client-side kind list → "(0) None." everywhere.
// ---------------------------------------------------------------------------

interface UsageKindEntry {
  kind: string;
  count: number;
  items: Array<{ id: number; public_id: string; name: string; link: string }>;
  warning_only?: boolean;
}
interface UsageReport {
  kinds: UsageKindEntry[];
  delete_eligibility: { eligible: boolean; blocking_kinds: string[] };
}

interface UsageIsland {
  renderUsage(bodyEl: FakeEl, usage: UsageReport, mode: string, offerId: string, offerName: string): void;
}

function usageIsland(listHtml: string): UsageIsland {
  const script = extractScripts(listHtml).find((s) => s.includes("function renderUsage("));
  expect(script, "list-actions island script present").toBeDefined();
  const source = ["humanizeKind", "safeLink", "itemLabel", "renderUsage"]
    .map((n) => sliceIslandFunction(script!, n))
    .join("\n");
  const sandbox = { document: { createElement: fakeElement, createTextNode: fakeTextNode } };
  return runInNewContext(`${source}\n({ renderUsage: renderUsage })`, sandbox) as UsageIsland;
}

describeDb("F1 (executed) — usage report island over the REAL server body", () => {
  // A REAL reference inventory: a Section offering the offer
  // (sections_available — blocking, links to the section editor), a funnel
  // redirect rule targeting it (funnel_rules_targeting — a kind the deleted
  // client-side list did NOT know), a region rule (warning-only server-side —
  // the deleted list had it WRONGLY blocking) and a provider TEST log row
  // (warning-only synthetic item).
  async function seedReferencedOffer(): Promise<{
    env: Env;
    offer: OfferDetail;
    sectionPublicId: string;
    usage: UsageReport;
  }> {
    const { env, sdb } = newHarness();
    const offer = await createOffer(env, "static_no_request", { offer_name: "Usage Exec Offer" });
    await patchOffer(env, offer.public_id, {
      region_rules: [{ dimension: "state", action: "exclude", values: ["CA"], priority: 10, enabled: true }],
    });
    const sectionPublicId = mintPublicId("section");
    sdb
      .prepare(
        "INSERT INTO leadgen_sections (public_id, section_name, activity, vertical, headline_text, content_json) VALUES (?, 'Usage Section', 'quote_funnel', 'life', 'H', '{}')",
      )
      .run(sectionPublicId);
    const section = sdb.prepare("SELECT id FROM leadgen_sections WHERE public_id = ?").get(sectionPublicId) as { id: number };
    sdb
      .prepare("INSERT INTO leadgen_section_available_offers (section_id, offer_id, selected) VALUES (?, ?, 1)")
      .run(section.id, offer.id);
    // quote → funnel → variant → redirect rule targeting the offer
    sdb
      .prepare("INSERT INTO leadgen_quotes (public_id, quote_name, activity, verticals_json) VALUES (?, 'Usage Quote', 'quote_funnel', '[\"life\"]')")
      .run(mintPublicId("quote"));
    const quote = sdb.prepare("SELECT id FROM leadgen_quotes ORDER BY id DESC LIMIT 1").get() as { id: number };
    sdb
      .prepare("INSERT INTO leadgen_funnels (public_id, quote_id, funnel_name) VALUES (?, ?, 'Usage Funnel')")
      .run(mintPublicId("funnel"), quote.id);
    const funnel = sdb.prepare("SELECT id FROM leadgen_funnels ORDER BY id DESC LIMIT 1").get() as { id: number };
    sdb
      .prepare("INSERT INTO leadgen_funnel_variants (public_id, funnel_id) VALUES (?, ?)")
      .run(mintPublicId("funnel_variant"), funnel.id);
    const variant = sdb.prepare("SELECT id FROM leadgen_funnel_variants ORDER BY id DESC LIMIT 1").get() as { id: number };
    sdb
      .prepare(
        "INSERT INTO leadgen_funnel_rules (public_id, variant_id, rule_type, conditions_json, conditions_hash, target_offer_id) VALUES (?, ?, 'redirect_direct_offer', '{}', 'h', ?)",
      )
      .run(mintPublicId("funnel_rule"), variant.id, offer.id);
    seedPassedTest(sdb, offer.public_id, 200);

    const res = await admin.request(`${API}/offers/${offer.public_id}/usage`, {}, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { usage: UsageReport };
    return { env, offer, sectionPublicId, usage: body.usage };
  }

  it("renders EVERY server kind, in server order, with real counts, item links and warning tags", async () => {
    const { env, usage, sectionPublicId } = await seedReferencedOffer();

    // seam sanity on the REAL body: kinds is an ORDERED ARRAY, not a keyed map
    expect(Array.isArray(usage.kinds)).toBe(true);
    const byKind = new Map(usage.kinds.map((k) => [k.kind, k]));
    expect(byKind.get("sections_available")!.count).toBe(1);
    expect(byKind.get("funnel_rules_targeting")!.count).toBe(1);
    expect(byKind.get("region_rules")!.warning_only).toBe(true);
    expect(usage.delete_eligibility.eligible).toBe(false);

    const island = usageIsland(await getHtml(env, "/admin/leadgen/offers"));
    const bodyEl = fakeElement("div");
    island.renderUsage(bodyEl, usage, "view", "lgo_x", "Usage Exec Offer");

    // every kind block, in exactly the server's order
    const blocks = findAll(bodyEl, (n) => n.attrs.has("data-usage-kind"));
    expect(blocks.map((b) => b.getAttribute("data-usage-kind"))).toEqual(usage.kinds.map((k) => k.kind));

    // sections_available: humanized label + real count + the item ANCHOR
    const sections = blocks.find((b) => b.getAttribute("data-usage-kind") === "sections_available")!;
    expect(textOf(sections)).toContain("Sections available");
    expect(textOf(sections)).toContain("(1)");
    const sectionAnchor = findAll(sections, (n) => n.tagName === "A")[0]!;
    expect(sectionAnchor.getAttribute("href")).toBe(`/admin/leadgen/sections/${sectionPublicId}/edit`);
    expect(textOf(sectionAnchor)).toBe("Usage Section");

    // funnel_rules_targeting (missing from the deleted client list) renders
    const funnelRules = blocks.find((b) => b.getAttribute("data-usage-kind") === "funnel_rules_targeting")!;
    expect(textOf(funnelRules)).toContain("(1)");
    expect(findAll(funnelRules, (n) => n.tagName === "A")[0]!.getAttribute("href")).toBe("/admin/leadgen/quotes");

    // warning-only flags come from the SERVER entry (the deleted list wrongly
    // marked region_rules blocking)
    for (const kind of ["region_rules", "provider_request_logs"]) {
      const block = blocks.find((b) => b.getAttribute("data-usage-kind") === kind)!;
      const warn = findAll(block, (n) => n.className === "lg-usage-warn-tag");
      expect(warn, `${kind} warn tag`).toHaveLength(1);
      expect(textOf(warn[0]!)).toBe("does not block delete");
    }
    // a blocking kind never carries the tag
    expect(findAll(sections, (n) => n.className === "lg-usage-warn-tag")).toHaveLength(0);

    // zero-count kinds render "None."
    const answerMaps = blocks.find((b) => b.getAttribute("data-usage-kind") === "answer_maps")!;
    expect(textOf(answerMaps)).toContain("(0)");
    expect(textOf(answerMaps)).toContain("None.");

    // eligibility-driven verdict (view mode; blocked offer)
    const verdicts = findAll(bodyEl, (n) => n.attrs.has("data-usage-verdict"));
    expect(verdicts).toHaveLength(1);
    expect(verdicts[0]!.getAttribute("data-usage-verdict")).toBe("blocked");
    expect(textOf(verdicts[0]!)).toContain("cannot be permanently deleted");
    // view mode has no Archive CTA
    expect(findAll(bodyEl, (n) => n.attrs.has("data-usage-archive"))).toHaveLength(0);
  });

  it("the 409 blocked-delete modal path: REAL 409 body renders the report + the Archive-instead CTA", async () => {
    const { env, offer } = await seedReferencedOffer();
    const del = await admin.request(`${API}/offers/${offer.public_id}?mode=hard`, { method: "DELETE" }, env);
    expect(del.status).toBe(409);
    const body = (await del.json()) as { error: string; usage: UsageReport };
    expect(body.error).toBe("offer_in_use");

    const island = usageIsland(await getHtml(env, "/admin/leadgen/offers"));
    const bodyEl = fakeElement("div");
    island.renderUsage(bodyEl, body.usage, "blocked", offer.public_id, offer.offer_name);

    const verdict = findAll(bodyEl, (n) => n.attrs.has("data-usage-verdict"))[0]!;
    expect(verdict.getAttribute("data-usage-verdict")).toBe("blocked");
    expect(textOf(verdict)).toContain("in use and cannot be deleted");
    // per-kind content present (not the old all-zero render)
    const sections = findAll(bodyEl, (n) => n.getAttribute("data-usage-kind") === "sections_available")[0]!;
    expect(textOf(sections)).toContain("(1)");
    // the blocked CTA carries the offer identity
    const cta = findAll(bodyEl, (n) => n.attrs.has("data-usage-archive"));
    expect(cta).toHaveLength(1);
    expect(cta[0]!.getAttribute("data-usage-archive")).toBe(offer.public_id);
    expect(textOf(cta[0]!)).toBe("Archive instead");
  });

  it("an unreferenced offer: eligible verdict, every kind renders None., no CTA", async () => {
    const { env } = newHarness();
    const offer = await createOffer(env, "static_no_request", { offer_name: "Clean Offer" });
    const res = await admin.request(`${API}/offers/${offer.public_id}/usage`, {}, env);
    expect(res.status).toBe(200);
    const { usage } = (await res.json()) as { usage: UsageReport };
    expect(usage.delete_eligibility.eligible).toBe(true);

    const island = usageIsland(await getHtml(env, "/admin/leadgen/offers"));
    const bodyEl = fakeElement("div");
    island.renderUsage(bodyEl, usage, "view", offer.public_id, offer.offer_name);

    const verdict = findAll(bodyEl, (n) => n.attrs.has("data-usage-verdict"))[0]!;
    expect(verdict.getAttribute("data-usage-verdict")).toBe("eligible");
    expect(textOf(verdict)).toContain("can be permanently deleted");
    const blocks = findAll(bodyEl, (n) => n.attrs.has("data-usage-kind"));
    expect(blocks).toHaveLength(usage.kinds.length);
    for (const block of blocks) expect(textOf(block)).toContain("None.");
    expect(findAll(bodyEl, (n) => n.attrs.has("data-usage-archive"))).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// F2 (executed) — the §7.3 duplicate success handler navigates off the REAL
// 201 body (offer.public_id + copied.extra_placements_blanked). The old code
// required a top-level public_id that never exists → success rendered as an
// error and retries minted clones.
// ---------------------------------------------------------------------------

interface DuplicateBody {
  offer: { public_id: string; [key: string]: unknown };
  duplicated_from: { id: number; public_id: string; name: string };
  copied: {
    active_schema_as_v1: boolean;
    region_rules: number;
    endpoint_config: boolean;
    cap_settings_copied_disabled: boolean;
    extra_placements_blanked: number;
  };
  not_copied: string[];
  test_status: string;
  public_id?: unknown;
}

interface DupIsland {
  nav(res: unknown, fromName: string, copyRegion: boolean, copyEndpoint: boolean, copyCap: boolean): string | null;
  apply(res: unknown, fromName: string, copyRegion: boolean, copyEndpoint: boolean, copyCap: boolean): boolean;
}

function duplicateIsland(listHtml: string): { island: DupIsland; window: { location: { href: string }; toasts: string[] } } {
  const script = extractScripts(listHtml).find((s) => s.includes("function duplicateResultNav("));
  expect(script, "duplicate island functions present").toBeDefined();
  const source = ["duplicateResultNav", "applyDuplicateResult"]
    .map((n) => sliceIslandFunction(script!, n))
    .join("\n");
  const win = {
    location: { href: "" },
    toasts: [] as string[],
    showToast(msg: string) {
      win.toasts.push(msg);
    },
  };
  const sandbox = { window: win, encodeURIComponent, isFinite };
  const island = runInNewContext(
    `${source}\n({ nav: duplicateResultNav, apply: applyDuplicateResult })`,
    sandbox,
  ) as DupIsland;
  return { island, window: win };
}

describeDb("F2 (executed) — duplicate success handler over the REAL 201/400 bodies", () => {
  it("navigates to the new lgo_ editor with the pending count from copied.extra_placements_blanked", async () => {
    const { env } = newHarness();
    const source = await createOffer(env, "request_dynamic_bid", {
      offer_name: "Dup Exec Source",
      placements: ["pl-src-main", "pl-src-extra"], // 1 extra → 1 blanked on duplicate
    });
    const res = await admin.request(
      `${API}/offers/${source.public_id}/duplicate`,
      jsonInit("POST", { name: "Dup Exec Copy", default_placement_id: "pl-dup-main" }),
      env,
    );
    expect(res.status, `duplicate: ${await res.clone().text()}`).toBe(201);
    const body = (await res.json()) as DuplicateBody;
    // seam sanity: public_id lives on offer.*, NOT at the top level; the
    // blanked count is a NUMBER on copied.*
    expect(body.public_id).toBeUndefined();
    expect(body.offer.public_id).toMatch(/^lgo_/);
    expect(body.copied.extra_placements_blanked).toBe(1);

    const { island, window: win } = duplicateIsland(await getHtml(env, "/admin/leadgen/offers"));
    const applied = island.apply({ ok: true, status: 201, body }, "Dup Exec Source", true, true, false);
    expect(applied).toBe(true);
    const expected =
      `/admin/leadgen/offers/${encodeURIComponent(body.offer.public_id)}/edit` +
      `?duplicated_from=${encodeURIComponent("Dup Exec Source")}` +
      `&copied=${encodeURIComponent("copy_region_rules,copy_endpoint_config")}` +
      `&skipped=${encodeURIComponent("copy_cap_settings")}` +
      `&pending=1`;
    expect(win.location.href).toBe(expected);
    expect(win.toasts).toHaveLength(1);

    // full loop: the island-built URL renders the server-side banner
    const editorHtml = await getHtml(env, win.location.href);
    expect(editorHtml).toContain("data-dup-banner");
    expect(editorHtml).toContain("Duplicated from Dup Exec Source");
    expect(editorHtml).toContain('data-dup-pending="1"');
    expect(editorHtml).toContain('data-dup-copied="copy_region_rules"');
    expect(editorHtml).toContain('data-dup-skipped="copy_cap_settings"');
  });

  it("a REAL 400 body does not navigate (error path preserved); the legacy top-level shape never navigates", async () => {
    const { env } = newHarness();
    const source = await createOffer(env, "static_no_request", { offer_name: "Dup Fail Source" });
    const res = await admin.request(
      `${API}/offers/${source.public_id}/duplicate`,
      jsonInit("POST", { name: "x", default_placement_id: "" }),
      env,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; fields: Record<string, string> };
    expect(body.fields.default_placement_id).toBeDefined();

    const { island, window: win } = duplicateIsland(await getHtml(env, "/admin/leadgen/offers"));
    expect(island.apply({ ok: false, status: 400, body }, "Dup Fail Source", true, true, false)).toBe(false);
    expect(win.location.href).toBe("");
    expect(win.toasts).toHaveLength(0);
    // the OLD false contract (top-level public_id) is not a success signal
    expect(island.nav({ ok: true, status: 201, body: { public_id: "lgo_TOPLEVEL" } }, "n", true, true, false)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// F5 — §7.1 per-row Test-status chip (real list field → distinct chips;
// absent field renders the defensive Untested state)
// ---------------------------------------------------------------------------

describeDb("F5 — offers list test-status chip", () => {
  function rowFor(html: string, publicId: string): string {
    const at = html.indexOf(`data-offer-public-id="${publicId}"`);
    expect(at, `row for ${publicId}`).toBeGreaterThan(-1);
    const start = html.lastIndexOf("<tr", at);
    const end = html.indexOf("</tr>", at);
    return html.slice(start, end);
  }

  it("rows render distinct Passed / Failed / Untested chips from the REAL list field", async () => {
    const { env, sdb } = newHarness();
    const untested = await createOffer(env, "static_no_request", { offer_name: "Chip Untested" });
    const passed = await createOffer(env, "request_dynamic_bid", { offer_name: "Chip Passed" });
    const failed = await createOffer(env, "request_dynamic_bid", { offer_name: "Chip Failed" });
    seedPassedTest(sdb, passed.public_id, 200);
    seedPassedTest(sdb, failed.public_id, 500);

    // the REAL list API emits the field (parallel server slice)
    const listRes = await admin.request(`${API}/offers`, {}, env);
    expect(listRes.status).toBe(200);
    const list = (await listRes.json()) as { items: Array<{ public_id: string; test_status?: string }> };
    const statusOf = (id: string): string | undefined => list.items.find((i) => i.public_id === id)?.test_status;
    expect(statusOf(passed.public_id)).toBe("passed");
    expect(statusOf(failed.public_id)).toBe("failed");
    expect(statusOf(untested.public_id)).toBe("untested");

    const html = await getHtml(env, "/admin/leadgen/offers");
    // header sits between Eligibility and Cap
    const eligIdx = html.indexOf(">Eligibility</th>");
    const testIdx = html.indexOf(">Test status</th>");
    const capIdx = html.indexOf(">Cap</th>");
    expect(eligIdx).toBeGreaterThan(-1);
    expect(testIdx).toBeGreaterThan(eligIdx);
    expect(capIdx).toBeGreaterThan(testIdx);
    // per-row chips
    expect(rowFor(html, passed.public_id)).toContain('data-offer-test-status="passed">Passed</span>');
    expect(rowFor(html, failed.public_id)).toContain('data-offer-test-status="failed">Failed</span>');
    expect(rowFor(html, untested.public_id)).toContain('data-offer-test-status="untested">Untested</span>');
  });

  it("defensive: an absent/unknown test-status field renders the Untested chip (merge-order safety)", () => {
    expect(testStatusChip({} as never)).toContain('data-offer-test-status="untested">Untested</span>');
    expect(testStatusChip({ test_status: "bogus" } as never)).toContain('data-offer-test-status="untested">Untested</span>');
    expect(testStatusChip({ test_status: null } as never)).toContain(">Untested</span>");
    // the variant spellings the parallel slice considered are also consumed
    expect(testStatusChip({ last_test_status: "passed" } as never)).toContain('data-offer-test-status="passed">Passed</span>');
    expect(testStatusChip({ last_test_ok: false } as never)).toContain('data-offer-test-status="failed">Failed</span>');
  });
});

// ---------------------------------------------------------------------------
// F10 (executed) — pasted country/state tokens validate against the SAME
// closed sets the dropdowns use (the REAL lg-region-geo island payload feeds
// the REAL island functions; invalid tokens are listed + rejected like zip)
// ---------------------------------------------------------------------------

interface RegionIsland {
  addValue(row: FakeEl, rawToken: string): boolean;
  pasteMultiple(row: FakeEl): void;
}

function regionIsland(editorHtml: string): RegionIsland {
  const fullScript = extractScripts(editorHtml).find((s) => s.includes("function buildGeoSets("));
  expect(fullScript, "region editor island script present").toBeDefined();
  // the page concatenates every island into one <script>; scope the slicing
  // to the REGION editor island so shared function names (e.g. an analytics
  // setValues) can never shadow the region ones
  const regionStart = fullScript!.indexOf("getElementById('lg-region-rows')");
  expect(regionStart, "region island start marker").toBeGreaterThan(-1);
  const script = fullScript!.slice(regionStart);
  const geoMatch = editorHtml.match(/<script type="application\/json" id="lg-region-geo">([\s\S]*?)<\/script>/);
  expect(geoMatch, "REAL lg-region-geo island payload present").not.toBeNull();
  const geo = JSON.parse(geoMatch![1]!) as { countries: string[]; states: Record<string, Array<[string, string]>> };
  // the closed sets ride the island blob (the same lists the dropdowns render)
  expect(Array.isArray(geo.countries)).toBe(true);
  for (const code of ["US", "GB", "DE"]) expect(geo.countries).toContain(code);
  expect(geo.countries).not.toContain("XX");

  const zipLine = script.match(/var ZIP_RE = [^;]+;/);
  expect(zipLine, "ZIP_RE line present").not.toBeNull();
  const source = [
    zipLine![0],
    ...[
      "trim", "fireChange", "rowOf", "hiddenOf", "chipsOf", "dimOf", "invalidOf",
      "clearInvalid", "showInvalid", "valuesOf", "renderChips", "writeValues",
      "setValues", "normalizeToken", "validToken", "hasValue", "addValue",
      "pasteMultiple", "buildGeoSets",
    ].map((n) => sliceIslandFunction(script, n)),
    `var geoSets = buildGeoSets(${JSON.stringify(geo)});`,
    "({ addValue: addValue, pasteMultiple: pasteMultiple })",
  ].join("\n");
  const sandbox = {
    document: {
      createElement: fakeElement,
      createTextNode: fakeTextNode,
      createEvent: () => ({ initEvent: () => {} }),
    },
  };
  return runInNewContext(source, sandbox) as RegionIsland;
}

function regionRow(dim: string): { row: FakeEl; hidden: FakeEl; box: FakeEl; invalid: FakeEl; chips: FakeEl } {
  const row = fakeElement("div");
  row.setAttribute("data-region-rule", "");
  const dimension = fakeElement("select");
  dimension.setAttribute("data-rule-field", "dimension");
  dimension.value = dim;
  const hidden = fakeElement("input");
  hidden.setAttribute("data-rule-field", "values");
  const chips = fakeElement("div");
  chips.setAttribute("data-region-chips", "");
  const box = fakeElement("textarea");
  box.setAttribute("data-region-paste-box", "");
  const invalid = fakeElement("p");
  invalid.setAttribute("data-region-invalid", "");
  invalid.hidden = true;
  row.appendChild(dimension);
  row.appendChild(hidden);
  row.appendChild(chips);
  row.appendChild(box);
  row.appendChild(invalid);
  return { row, hidden, box, invalid, chips };
}

describeDb("F10 (executed) — region paste validation per dimension", () => {
  async function editorIsland(): Promise<RegionIsland> {
    const { env } = newHarness();
    const offer = await createOffer(env, "static_no_request", { offer_name: "Paste Offer" });
    return regionIsland(await getHtml(env, `/admin/leadgen/offers/${offer.public_id}/edit`));
  }

  it("country paste: valid alpha-2 tokens become chips (uppercased); invalid tokens are listed + rejected", async () => {
    const island = await editorIsland();
    const { row, hidden, box, invalid, chips } = regionRow("country");
    box.value = "us, XX, de\nZZ, GB";
    island.pasteMultiple(row);
    expect(hidden.value).toBe("US, DE, GB");
    expect(chips.children.filter((c) => c.className === "lg-chip")).toHaveLength(3);
    expect(invalid.hidden).toBe(false);
    expect(invalid.textContent).toContain("2 invalid country token(s)");
    expect(invalid.textContent).toContain("XX");
    expect(invalid.textContent).toContain("ZZ");
    expect(box.value).toBe("");
  });

  it("state paste: known state/province codes pass; unknown codes are rejected", async () => {
    const island = await editorIsland();
    const { row, hidden, invalid, box } = regionRow("state");
    box.value = "ca, QQ, on";
    island.pasteMultiple(row);
    expect(hidden.value).toBe("CA, ON");
    expect(invalid.textContent).toContain("1 invalid state token(s)");
    expect(invalid.textContent).toContain("QQ");
  });

  it("the zip path is unchanged; single-add validates country membership too", async () => {
    const island = await editorIsland();
    const zip = regionRow("zip");
    zip.box.value = "90210, abcde";
    island.pasteMultiple(zip.row);
    expect(zip.hidden.value).toBe("90210");
    expect(zip.invalid.textContent).toContain("abcde");

    const country = regionRow("country");
    expect(island.addValue(country.row, "xx")).toBe(false);
    expect(country.invalid.textContent).toContain("ISO alpha-2");
    expect(island.addValue(country.row, "us")).toBe(true);
    expect(country.hidden.value).toBe("US");
  });
});

// ---------------------------------------------------------------------------
// F13 — the __needs_value__N sentinel never shows raw: empty input +
// "needs value" placeholder + a row hint; an unrelated Save round-trips the
// pending row (executed collectPlacements) instead of dropping or blocking.
// ---------------------------------------------------------------------------

describeDb("F13 — needs-value placement sentinel", () => {
  async function duplicatedEditorHtml(): Promise<{ env: Env; html: string; dupId: string }> {
    const { env } = newHarness();
    const source = await createOffer(env, "static_no_request", {
      offer_name: "Sentinel Source",
      placements: ["pl-sent-main", "pl-sent-extra"],
    });
    const res = await admin.request(
      `${API}/offers/${source.public_id}/duplicate`,
      jsonInit("POST", { name: "Sentinel Copy", default_placement_id: "pl-dup-main" }),
      env,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as DuplicateBody;
    const html = await getHtml(env, `/admin/leadgen/offers/${body.offer.public_id}/edit`);
    return { env, html, dupId: body.offer.public_id };
  }

  it("the sentinel row renders an EMPTY input with the needs-value placeholder + a visible hint; real rows render normally", async () => {
    const { html } = await duplicatedEditorHtml();
    // the REAL duplicate handler minted the sentinel row
    expect(html).toContain('data-placement-sentinel="__needs_value__1"');
    // sentinel input: empty value + "needs value" placeholder (template attribute order)
    expect(html).toMatch(/data-placement-field="placement_id" placeholder="needs value" aria-label="Placement id" value=""/);
    // the sentinel is NEVER visible as an input value
    expect(html).not.toMatch(/value="__needs_value__/);
    // exactly one row hint, with operator wording
    expect(html.match(/data-placement-needs-value-hint/g)).toHaveLength(1);
    expect(html).toContain("set a real placement ID");
    // the real default row renders its value normally, standard placeholder
    expect(html).toMatch(/data-placement-field="placement_id" placeholder="pl-12345" aria-label="Placement id" value="pl-dup-main"/);
  });

  it("(executed) collectPlacements round-trips the untouched sentinel row and swaps in a typed value", async () => {
    const { html } = await duplicatedEditorHtml();
    const script = extractScripts(html).find((s) => s.includes("function collectPlacements("));
    expect(script, "editor script present").toBeDefined();
    const source = `${sliceIslandFunction(script!, "collectPlacements")}\n({ collect: collectPlacements })`;

    function placementRow(opts: { publicId?: string; sentinel?: string; value: string; isDefault: boolean }): FakeEl {
      const row = fakeElement("div");
      row.className = "lg-placement-row";
      if (opts.publicId) row.setAttribute("data-placement-public-id", opts.publicId);
      if (opts.sentinel) row.setAttribute("data-placement-sentinel", opts.sentinel);
      const pid = fakeElement("input");
      pid.setAttribute("data-placement-field", "placement_id");
      pid.value = opts.value;
      const label = fakeElement("input");
      label.setAttribute("data-placement-field", "label");
      const def = fakeElement("input");
      def.setAttribute("data-placement-field", "is_default");
      def.checked = opts.isDefault;
      row.appendChild(pid);
      row.appendChild(label);
      row.appendChild(def);
      return row;
    }

    const sentinelRow = placementRow({ publicId: "lgpl_SENT", sentinel: "__needs_value__1", value: "", isDefault: false });
    const defaultRow = placementRow({ publicId: "lgpl_MAIN", value: "pl-dup-main", isDefault: true });
    const blankTemplateRow = placementRow({ value: "", isDefault: false }); // a new empty row stays skipped
    const rows = [defaultRow, sentinelRow, blankTemplateRow];
    const sandbox = {
      document: {
        querySelectorAll: (sel: string) => (sel === "#lg-placements-rows .lg-placement-row" ? rows : []),
      },
    };
    const island = runInNewContext(source, sandbox) as {
      collect(errors: Record<string, string>): Array<{ placement_id: string; public_id?: string; is_default: boolean }>;
    };

    // untouched sentinel row survives an unrelated Save (no drop, no block)
    const errors: Record<string, string> = {};
    const out = island.collect(errors);
    expect(errors).toEqual({});
    expect(out).toHaveLength(2);
    expect(out.map((p) => p.placement_id)).toEqual(["pl-dup-main", "__needs_value__1"]);
    expect(out[1]!.public_id).toBe("lgpl_SENT");
    expect(out[1]!.is_default).toBe(false);

    // typing a real value replaces the sentinel in the PATCH body
    (sentinelRow.querySelector('[data-placement-field="placement_id"]') as FakeEl).value = "pl-real-2";
    const out2 = island.collect({});
    expect(out2.map((p) => p.placement_id)).toEqual(["pl-dup-main", "pl-real-2"]);
  });
});
