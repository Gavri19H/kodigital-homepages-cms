// Send-only Offers (plan "Send-only Offers", migration 0068) — the ADMIN
// screens, rendered by the REAL admin app over a node:sqlite D1 built from the
// repo's leadgen migrations, and the pages' OWN inline scripts run in node:vm
// against the rendered HTML (test/helpers/mini-dom.ts).
//
//   1. Offer editor → Request tab: "What the visitor sees" (only in the
//      "Provider request · static bid (CPL)" mode), "Accepted when" (only for
//      "Send the lead only, no card"), the field + value (only for "A field in
//      the reply equals a value"), the non-blocking sample-reply warning, and
//      the Save body; the Static tab's "Banner creative" card also shows for a
//      send-only Offer.
//   2. The Test result line says "Accepted" / "Not accepted: <reason>".
//   3. Redirect pickers leave send-only Offers out (a saved rule that already
//      points at one keeps it, not selectable): Funnel rules window and the
//      Quote routing-rules rail.

import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import admin from "../src/admin/router";
import type { Env } from "../src/env";
import { mintPublicId } from "../src/leadgen/ids";
import { renderRequestPanel, sendOnlyFieldWarningText } from "../src/admin/leadgen/ui-payload-builder";
import { renderQuoteRulesRail, type QuoteRulesRailData } from "../src/admin/leadgen/ui-rules-builder";
import type { LeadgenOfferApi } from "../src/admin/leadgen/db-types";
import { MiniNode, miniDocument, type MiniDocument } from "./helpers/mini-dom";

// --- node:sqlite harness (repo pattern) -------------------------------------------

type SqliteStatement = { run(...p: unknown[]): unknown; get(...p: unknown[]): unknown; all(...p: unknown[]): unknown[] };
type SqliteDb = { prepare(sql: string): SqliteStatement; close(): void; [m: string]: unknown };
type DatabaseSyncCtor = new (path: string) => SqliteDb;

function loadDatabaseSync(): DatabaseSyncCtor | null {
  try {
    return (createRequire(import.meta.url)("node:sqlite") as { DatabaseSync: DatabaseSyncCtor }).DatabaseSync;
  } catch {
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
      const results: unknown[] = [];
      try {
        for (const s of statements) results.push(await s.run());
        runSql(sdb, "COMMIT");
      } catch (err) {
        runSql(sdb, "ROLLBACK");
        throw err;
      }
      return results;
    },
  } as unknown as D1Database;
}
function kvStub(): KVNamespace {
  const store = new Map<string, string>();
  return {
    async get(key: string) { return store.get(key) ?? null; },
    async getWithMetadata(key: string) { return { value: store.get(key) ?? null, metadata: null }; },
    async put(key: string, value: string) { store.set(key, value); },
    async delete(key: string) { store.delete(key); },
    async list() { return { keys: [...store.keys()].map((name) => ({ name })), list_complete: true, cursor: "" }; },
  } as unknown as KVNamespace;
}

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(TEST_DIR, "..", "migrations");
const DatabaseSync = loadDatabaseSync();
const describeDb = DatabaseSync === null ? describe.skip : describe;

function newHarness(): { sdb: SqliteDb; env: Env } {
  const sdb = new (DatabaseSync as DatabaseSyncCtor)(":memory:");
  runSql(
    sdb,
    "CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT, domain TEXT);" +
      "CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT);" +
      "INSERT INTO sites (id, name, domain) VALUES ('site-1','Site One','one.example.com');",
  );
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{4}_leadgen_.*\.sql$/.test(f))
    .filter((f) => Number(f.slice(0, 4)) >= 36)
    .sort();
  for (const f of files) runSql(sdb, readFileSync(join(MIGRATIONS_DIR, f), "utf8"));
  const env = {
    DB: d1FromSqlite(sdb),
    CACHE: kvStub(),
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
    LEADGEN_REDIRECT_URL_ALLOWLIST: "partner.example.com",
  } as unknown as Env;
  return { sdb, env };
}

const API = "/api/admin/leadgen";
async function req(env: Env, method: string, path: string, body?: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const init: RequestInit = body === undefined ? { method } : { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
  const res = await admin.request(`${API}${path}`, init, env);
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

type Mode = "static_no_request" | "request_static_bid" | "request_dynamic_bid";
interface Offer { id: number; public_id: string; name: string }

const ANY_OK_JSON = '{"display":"send_only","accept":{"kind":"any_ok"}}';
const FIELD_JSON = (field: string): string =>
  JSON.stringify({ display: "send_only", accept: { kind: "field_equals", field, value: "accepted" } });

function insertOffer(sdb: SqliteDb, opts: { name: string; mode: Mode; sendOnly?: string | null; banner?: string | null }): Offer {
  const publicId = mintPublicId("offer");
  const calls = opts.mode === "static_no_request" ? 0 : 1;
  const bidSource = opts.mode === "request_dynamic_bid" ? "response" : "static";
  sdb
    .prepare(
      `INSERT INTO leadgen_offers (public_id, offer_name, provider, activity, vertical, conversion_tracking_method, offer_type,
         calls_provider_api, bid_source, request_execution_mode, static_bid_value, static_bid_currency, banner_url_template,
         static_logo_url, static_headline, send_only_json, status)
       VALUES (?, ?, NULL, 'quote_funnel', 'life', 's2s_postback', ?, ?, ?, 'server', ?, 'USD', ?, 'https://cdn.example.com/logo.png', 'A headline', ?, 'active')`,
    )
    .run(
      publicId,
      opts.name,
      opts.mode === "request_dynamic_bid" ? "cpc" : "cpl",
      calls,
      bidSource,
      bidSource === "static" ? 25 : null,
      opts.banner === undefined ? "https://partner.example.com/go?sub={click_id}" : opts.banner,
      opts.sendOnly ?? null,
    );
  const id = (sdb.prepare("SELECT id FROM leadgen_offers WHERE public_id = ?").get(publicId) as { id: number }).id;
  sdb
    .prepare("INSERT INTO leadgen_offer_placements (public_id, offer_id, placement_id, is_default) VALUES (?, ?, ?, 1)")
    .run(mintPublicId("offer_placement"), id, `pl-${id}`);
  return { id, public_id: publicId, name: opts.name };
}

function withSampleReply(sdb: SqliteDb, offer: Offer, sample: unknown): void {
  const schema = { version: 1, root: { type: "object", children: [{ path: "plan", name: "plan", type: "string", source: "static", value: "gold" }] } };
  sdb
    .prepare("INSERT INTO leadgen_offer_payload_schemas (public_id, offer_id, version, schema_json, sample_response_json) VALUES (?, ?, 1, ?, ?)")
    .run(mintPublicId("payload_schema_version"), offer.id, JSON.stringify(schema), JSON.stringify(sample));
  const sid = (sdb.prepare("SELECT id FROM leadgen_offer_payload_schemas WHERE offer_id = ?").get(offer.id) as { id: number }).id;
  sdb.prepare("UPDATE leadgen_offers SET active_payload_schema_id = ? WHERE id = ?").run(sid, offer.id);
}

async function editorHtml(env: Env, offer: Offer): Promise<string> {
  const res = await admin.request(`/admin/leadgen/offers/${offer.public_id}/edit`, {}, env);
  expect(res.status).toBe(200);
  return res.text();
}

// mini-dom has no ":checked" and no `name` property; the editor scripts read
// radio groups with the first and route change events by the second.
function withCheckedSelectors(): void {
  const proto = MiniNode.prototype as unknown as {
    querySelector(sel: string): MiniNode | null;
    __sendOnlyPatched?: boolean;
  };
  if (proto.__sendOnlyPatched === true) return;
  Object.defineProperty(MiniNode.prototype, "name", {
    configurable: true,
    get(this: MiniNode): string { return this.getAttribute("name") ?? ""; },
  });
  const original = proto.querySelector;
  proto.querySelector = function patched(this: MiniNode, sel: string): MiniNode | null {
    if (sel.endsWith(":checked")) {
      return this.querySelectorAll(sel.slice(0, -":checked".length)).find((n) => n.checked) ?? null;
    }
    return original.call(this, sel);
  };
  proto.__sendOnlyPatched = true;
}

// One island from the page's concatenated inline script: from `start` to the
// first IIFE end after it.
function island(html: string, start: string): string {
  const from = html.indexOf(start);
  expect(from, `island starting with ${start.slice(0, 60)}…`).toBeGreaterThan(-1);
  const to = html.indexOf("\n}());", from);
  expect(to).toBeGreaterThan(from);
  return html.slice(from, to + "\n}());".length);
}
const EDITOR_START = "(function () {\n  var root = document.getElementById('lg-offer-editor');\n  var form = document.getElementById('lg-editor-form');";
const CREATIVE_START = "(function () {\n  var root = document.getElementById('lg-offer-editor');\n  var card = document.querySelector('[data-lg-static-creative]');";

interface Editor {
  doc: MiniDocument;
  patches: Array<Record<string, unknown>>;
  toasts: Array<{ message: string; type: string }>;
  settle: () => Promise<void>;
  q: (sel: string) => MiniNode;
  pick: (name: string, value: string) => void;
  type: (name: string, value: string) => void;
}

async function bootEditor(env: Env, offer: Offer): Promise<Editor> {
  const html = await editorHtml(env, offer);
  const doc = miniDocument(html);
  withCheckedSelectors();
  const patches: Array<Record<string, unknown>> = [];
  const toasts: Array<{ message: string; type: string }> = [];
  const pending: Array<Promise<unknown>> = [];
  const windowObj: Record<string, unknown> = {
    lgUi: {
      getJson: (method: string, _url: string, body?: unknown) => {
        if (method === "PATCH") patches.push(body as Record<string, unknown>);
        const p = Promise.resolve({ ok: true, status: 200, body: {} });
        pending.push(p);
        return p;
      },
    },
    showToast: (message: string, type: string) => { toasts.push({ message, type }); },
    location: { reload: () => undefined },
    addEventListener: () => undefined,
    setTimeout: () => 0,
    confirm: () => true,
  };
  const fetchStub = (): Promise<unknown> => {
    const p = Promise.resolve({ ok: true, json: async () => ({ document: "", shown: true }) });
    pending.push(p);
    return p;
  };
  const ctx = { window: windowObj, document: doc, fetch: fetchStub, setTimeout: () => 0, clearTimeout: () => undefined, Event: class { constructor(public type: string) {} }, FormData: class {}, console, Promise, JSON };
  runInNewContext(island(html, EDITOR_START), ctx);
  runInNewContext(island(html, CREATIVE_START), ctx);
  const q = (sel: string): MiniNode => {
    const n = doc.querySelector(sel);
    expect(n, sel).not.toBeNull();
    return n as MiniNode;
  };
  const pick = (name: string, value: string): void => {
    const radios = doc.querySelectorAll(`[name="${name}"]`);
    for (const r of radios) r.checked = r.value === value;
    const chosen = radios.find((r) => r.value === value);
    expect(chosen, `${name}=${value}`).toBeDefined();
    (chosen as MiniNode).fire("change");
  };
  const type = (name: string, value: string): void => {
    const input = q(`[name="${name}"]`);
    input.value = value;
    input.fire("input");
  };
  const settle = async (): Promise<void> => {
    for (let i = 0; i < 5; i++) {
      await Promise.all(pending.splice(0));
      await new Promise((r) => setImmediate(r));
    }
  };
  return { doc, patches, toasts, settle, q, pick, type };
}

// ===========================================================================
// 1. Request tab markup (the server render)
// ===========================================================================

function apiOffer(over: Partial<LeadgenOfferApi>): LeadgenOfferApi {
  return {
    calls_provider_api: true,
    bid_source: "static",
    request_execution_mode: "server",
    endpoint_production: null,
    endpoint_staging: null,
    request_method: null,
    api_token_placement: null,
    api_token_param_name: null,
    api_token_present: false,
    api_token_updated_at: null,
    send_only_json: null,
    send_only: false,
    ...over,
  } as unknown as LeadgenOfferApi;
}
function sendOnlyCard(html: string): MiniNode {
  const card = miniDocument(html).querySelector("[data-lg-send-only]");
  expect(card, "the send-only card").not.toBeNull();
  return card as MiniNode;
}

describe("Send-only Offers — Request tab markup", () => {
  it("shows only in \"Provider request · static bid (CPL)\"; starts on \"Show a card\" with \"Accepted when\" hidden; the help text is there", () => {
    const card = sendOnlyCard(renderRequestPanel(apiOffer({}), []));
    expect(card.hidden).toBe(false);
    expect(card.querySelector("legend")?.textContent).toBe("What the visitor sees");
    const display = card.querySelectorAll('[name="send_only_display"]');
    expect(display.map((r) => [r.value, r.checked])).toEqual([["card", true], ["send_only", false]]);
    const text = card.textContent.replace(/\s+/g, " ");
    expect(text).toContain("Show a card Needs a click link from the reply or the Static tab.");
    expect(text).toContain("Send the lead only, no card For Providers that contact the visitor themselves.");
    expect(text).toContain("Type CPL books the fixed bid when the lead is accepted; type CPA waits for the Provider’s report.");
    expect(text).toContain("If no other card shows, the visitor sees this Offer’s banner (logo, headline, subheadline), which can’t be clicked. Needs a logo and a headline.");
    const accept = card.querySelector("[data-lg-send-only-accept]") as MiniNode;
    expect(accept.hidden).toBe(true);
    expect(accept.querySelector("legend")?.textContent).toBe("Accepted when");
    expect(accept.textContent).toContain("For Providers that always answer success");
    expect(accept.textContent).toContain("For Providers that answer OK but say yes or no inside the reply.");
    for (const key of ["send_only_display", "send_only_accept_kind", "send_only_accept_field", "send_only_accept_value"]) {
      expect(card.querySelector(`[data-error-for="${key}"]`), key).not.toBeNull();
    }
    expect(sendOnlyCard(renderRequestPanel(apiOffer({ bid_source: "response" }), [])).hidden).toBe(true);
    expect(sendOnlyCard(renderRequestPanel(apiOffer({ calls_provider_api: false }), [])).hidden).toBe(true);
  });

  it("a saved field rule fills the inputs; the warning shows only when the field is not in the saved sample reply", () => {
    const anyOk = sendOnlyCard(renderRequestPanel(apiOffer({ send_only_json: ANY_OK_JSON, send_only: true }), []));
    expect((anyOk.querySelector("[data-lg-send-only-accept]") as MiniNode).hidden).toBe(false);
    expect((anyOk.querySelector("[data-lg-send-only-field]") as MiniNode).hidden).toBe(true);
    expect(anyOk.querySelectorAll('[name="send_only_accept_kind"]').map((r) => [r.value, r.checked])).toEqual([["any_ok", true], ["field_equals", false]]);

    const inSample = sendOnlyCard(renderRequestPanel(apiOffer({ send_only_json: FIELD_JSON("result.status"), send_only: true }), [], ["id", "result.status"]));
    expect((inSample.querySelector("[data-lg-send-only-field]") as MiniNode).hidden).toBe(false);
    expect(inSample.querySelector('[name="send_only_accept_field"]')?.value).toBe("result.status");
    expect(inSample.querySelector('[name="send_only_accept_value"]')?.value).toBe("accepted");
    expect((inSample.querySelector("[data-lg-send-only-field-warning]") as MiniNode).hidden).toBe(true);

    const missing = sendOnlyCard(renderRequestPanel(apiOffer({ send_only_json: FIELD_JSON("status"), send_only: true }), [], ["result.status"]));
    const warn = missing.querySelector("[data-lg-send-only-field-warning]") as MiniNode;
    expect(warn.hidden).toBe(false);
    expect(warn.className).toContain("alert-warning");
    expect(warn.textContent).toBe(sendOnlyFieldWarningText("status", ["result.status"]));
    expect(warn.textContent).toContain("“status” is not in this Offer’s saved sample reply");

    expect(sendOnlyFieldWarningText("status", [])).toContain("There is no saved sample reply to check “status” against.");
    expect(sendOnlyFieldWarningText("status", ["status"])).toBe("");
  });
});

// ===========================================================================
// 1b. The Offer editor page + its own scripts
// ===========================================================================

describeDb("Send-only Offers — the Offer editor", () => {
  it("the page: the send-only card follows the mode; the Banner creative card shows for a send-only Offer, not for a card one", async () => {
    const { sdb, env } = newHarness();
    const card = insertOffer(sdb, { name: "Card Offer", mode: "request_static_bid" });
    const hook = insertOffer(sdb, { name: "Hook Offer", mode: "request_static_bid", sendOnly: ANY_OK_JSON });
    const dyn = insertOffer(sdb, { name: "Dynamic Offer", mode: "request_dynamic_bid" });
    const stat = insertOffer(sdb, { name: "Static Offer", mode: "static_no_request" });
    const visible = async (o: Offer, sel: string): Promise<boolean> => !(miniDocument(await editorHtml(env, o)).querySelector(sel) as MiniNode).hidden;
    expect(await visible(card, "[data-lg-send-only]")).toBe(true);
    expect(await visible(card, "[data-lg-static-creative]")).toBe(false);
    expect(await visible(hook, "[data-lg-send-only]")).toBe(true);
    expect(await visible(hook, "[data-lg-static-creative]")).toBe(true);
    expect(await visible(dyn, "[data-lg-send-only]")).toBe(false);
    expect(await visible(stat, "[data-lg-send-only]")).toBe(false);
    expect(await visible(stat, "[data-lg-static-creative]")).toBe(true);
  });

  it("the page's sample reply feeds the warning: a field that is not in it warns on load", async () => {
    const { sdb, env } = newHarness();
    const hook = insertOffer(sdb, { name: "Hook Offer", mode: "request_static_bid", sendOnly: FIELD_JSON("status") });
    withSampleReply(sdb, hook, { result: { status: "accepted" }, id: 7 });
    const doc = miniDocument(await editorHtml(env, hook));
    expect(JSON.parse(doc.querySelector("[data-lg-send-only]")?.getAttribute("data-lg-sample-paths") ?? "null")).toEqual(["result.status", "id"]);
    const warn = doc.querySelector("[data-lg-send-only-field-warning]") as MiniNode;
    expect(warn.hidden).toBe(false);
    expect(warn.textContent).toContain("“status” is not in this Offer’s saved sample reply");
  });

  it("the script: picking the choices shows/hides the right parts live, the creative card follows, and Save sends one send_only_json object", async () => {
    const { sdb, env } = newHarness();
    const o = insertOffer(sdb, { name: "Card Offer", mode: "request_static_bid" });
    withSampleReply(sdb, o, { result: { status: "accepted" } });
    const e = await bootEditor(env, o);
    const cardEl = e.q("[data-lg-send-only]");
    const accept = e.q("[data-lg-send-only-accept]");
    const rule = e.q("[data-lg-send-only-field]");
    const warn = e.q("[data-lg-send-only-field-warning]");
    const creative = e.q("[data-lg-static-creative]");
    expect([cardEl.hidden, accept.hidden, rule.hidden, creative.hidden]).toEqual([false, true, true, true]);

    e.pick("send_only_display", "send_only");
    expect([accept.hidden, rule.hidden, creative.hidden]).toEqual([false, true, false]);
    e.pick("send_only_accept_kind", "field_equals");
    expect(rule.hidden).toBe(false);
    e.type("send_only_accept_field", "status");
    expect(warn.hidden).toBe(false);
    expect(warn.textContent).toContain("“status” is not in this Offer’s saved sample reply");
    e.type("send_only_accept_field", "{response:result.status}");
    expect(warn.hidden).toBe(true);

    // an empty value is refused before sending, with the server's words
    (e.q("#lg-editor-save")).click();
    await e.settle();
    expect(e.patches).toHaveLength(0);
    expect(e.q('[data-error-for="send_only_accept_value"]').textContent).toBe("Enter the value that means accepted, for example accepted.");

    e.type("send_only_accept_value", " Accepted ");
    e.type("send_only_accept_field", "status");
    e.q("#lg-editor-save").click();
    await e.settle();
    expect(e.patches).toHaveLength(1);
    expect(e.patches[0]?.["send_only_json"]).toEqual({ display: "send_only", accept: { kind: "field_equals", field: "status", value: "Accepted" } });
    // the warning does not block: the save went out, and a warning toast says why
    expect(e.toasts.map((t) => t.type)).toEqual(["success", "warning"]);
    expect(e.toasts[1]?.message).toContain("“status” is not in this Offer’s saved sample reply");

    e.pick("send_only_accept_kind", "any_ok");
    expect(rule.hidden).toBe(true);
    e.q("#lg-editor-save").click();
    await e.settle();
    expect(e.patches[1]?.["send_only_json"]).toEqual({ display: "send_only", accept: { kind: "any_ok" } });

    // back to "Show a card": "Accepted when" hides and is ignored
    e.pick("send_only_display", "card");
    expect([accept.hidden, creative.hidden]).toEqual([true, true]);
    e.q("#lg-editor-save").click();
    await e.settle();
    expect(e.patches[2]?.["send_only_json"]).toEqual({ display: "card" });
  });

  it("the script: in another mode the card hides and Save sends \"Show a card\", whatever was picked", async () => {
    const { sdb, env } = newHarness();
    const o = insertOffer(sdb, { name: "Hook Offer", mode: "request_static_bid", sendOnly: ANY_OK_JSON });
    const e = await bootEditor(env, o);
    expect(e.q("[data-lg-static-creative]").hidden).toBe(false);
    e.pick("auction_mode", "request_dynamic_bid");
    expect(e.q("[data-lg-send-only]").hidden).toBe(true);
    expect(e.q("[data-lg-static-creative]").hidden).toBe(true);
    e.q("#lg-editor-save").click();
    await e.settle();
    expect(e.patches[0]?.["send_only_json"]).toEqual({ display: "card" });
    expect(e.patches[0]?.["bid_source"]).toBe("response");
    e.pick("auction_mode", "request_static_bid");
    expect(e.q("[data-lg-send-only]").hidden).toBe(false);
    expect(e.q("[data-lg-static-creative]").hidden).toBe(false);
  });

  it("server field errors land on the send-only fields (and on the creative fields) through the existing pattern", async () => {
    const { sdb, env } = newHarness();
    const o = insertOffer(sdb, { name: "Card Offer", mode: "request_static_bid" });
    const html = await editorHtml(env, o);
    async function saveWith(fields: Record<string, string>): Promise<MiniDocument> {
      const doc = miniDocument(html);
      withCheckedSelectors();
      const windowObj: Record<string, unknown> = {
        lgUi: { getJson: () => Promise.resolve({ ok: false, status: 400, body: { error: "Validation failed", fields } }) },
        showToast: () => undefined,
        addEventListener: () => undefined,
      };
      runInNewContext(island(html, EDITOR_START), { window: windowObj, document: doc, setTimeout: () => 0, console, Promise, JSON });
      (doc.getElementById("lg-editor-save") as MiniNode).click();
      for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
      return doc;
    }
    const a = await saveWith({ send_only_display: "MODE", send_only_accept_field: "FIELD", static_logo_url: "LOGO", static_headline: "HEADLINE" });
    for (const [key, text] of [["send_only_display", "MODE"], ["send_only_accept_field", "FIELD"], ["static_logo_url", "LOGO"], ["static_headline", "HEADLINE"]] as const) {
      const el = a.querySelector(`[data-error-for="${key}"]`) as MiniNode;
      expect(el.hidden, key).toBe(false);
      expect(el.textContent).toBe(text);
    }
    expect(a.getElementById("lg-editor-error")?.textContent).toBe("Please fix the highlighted fields (4).");
    // send_only_json has no field of its own: ERROR_ALIASES points it at "What the visitor sees"
    const b = await saveWith({ send_only_json: "ALIASED" });
    expect(b.querySelector('[data-error-for="send_only_display"]')?.textContent).toBe("ALIASED");
    expect(b.getElementById("lg-editor-error")?.textContent).toBe("Please fix the highlighted field (1).");
  });
});

// ===========================================================================
// 2. The Test result line
// ===========================================================================

describeDb("Send-only Offers — the Test result line", () => {
  it("says \"Accepted\" or \"Not accepted: <reason>\" after the reply time, and nothing more for a card Offer", async () => {
    const { sdb, env } = newHarness();
    const o = insertOffer(sdb, { name: "Hook Offer", mode: "request_static_bid", sendOnly: ANY_OK_JSON });
    const html = await editorHtml(env, o);
    const from = html.indexOf("statusLine.textContent =");
    expect(from).toBeGreaterThan(-1);
    const to = html.indexOf(";\n", from);
    const expr = html.slice(from + "statusLine.textContent =".length, to);
    const line = (resBody: Record<string, unknown>): string => runInNewContext(`(${expr})`, { resBody }) as string;
    const base = { method: "POST", endpoint: "https://hooks.provider.example.com/lead", response: { status: 200, latency_ms: 120 }, provider_error_reason: null };
    expect(line({ ...base, send_only: { accepted: true, reason: "accepted", label: "accepted" } })).toBe(
      "POST https://hooks.provider.example.com/lead → status 200 · 120 ms · Accepted",
    );
    expect(line({ ...base, send_only: { accepted: false, reason: "field_mismatch", label: "the reply field has a different value" } })).toBe(
      "POST https://hooks.provider.example.com/lead → status 200 · 120 ms · Not accepted: the reply field has a different value",
    );
    expect(line(base)).toBe("POST https://hooks.provider.example.com/lead → status 200 · 120 ms");
  });
});

// ===========================================================================
// 3. Redirect pickers
// ===========================================================================

function railData(over: Partial<QuoteRulesRailData>): QuoteRulesRailData {
  return {
    quote_public_id: "lgq_test",
    rules: [],
    funnels: [],
    default_funnel_id: null,
    shared_page_fields: [],
    answer_fields: [],
    offers: [],
    feed_values: [],
    ...over,
  };
}
function railRedirectOptions(html: string): Array<{ value: string; text: string; disabled: boolean }> {
  const sel = miniDocument(html).querySelector("[data-qr-target-offer]") as MiniNode;
  return sel
    .querySelectorAll("option")
    .filter((o) => o.value !== "")
    .map((o) => ({ value: o.value, text: o.textContent, disabled: o.hasAttribute("disabled") }));
}

describe("Send-only Offers — Quote routing-rules rail", () => {
  it("leaves a send-only Offer out of \"Redirect target\"; keeps it (not selectable) when a saved rule points at it; \"Present only\" is unchanged", () => {
    const offers = [
      { id: 1, name: "Fixed Address Offer", status: "active", has_own_click_url: true },
      { id: 2, name: "Lead Hook Offer", status: "active", has_own_click_url: true, send_only: true },
    ];
    expect(railRedirectOptions(renderQuoteRulesRail(railData({ offers })))).toEqual([{ value: "1", text: "Fixed Address Offer", disabled: false }]);
    const rule = {
      public_id: "lgqr_1", rule_name: "Old", priority: 1, status: "active" as const, match_mode: null, conditions_json: { groups: [] },
      target_funnel_id: null, feed_name: null, value_multiplier: null, redirect_pct: 100, target_offer_id: 2, redirect_url: null,
      redirect_url_allowlisted: false,
    };
    expect(railRedirectOptions(renderQuoteRulesRail(railData({ offers, rules: [rule] })))).toEqual([
      { value: "1", text: "Fixed Address Offer", disabled: false },
      { value: "2", text: "Lead Hook Offer (sends the lead only, no card)", disabled: true },
    ]);
  });
});

describeDb("Send-only Offers — the Quote page passes send_only to the rail", () => {
  it("the rail's data carries send_only for a send-only Offer", async () => {
    const { sdb, env } = newHarness();
    const q = await req(env, "POST", "/quotes", { quote_name: "Test Quote", activity: "quote_funnel", verticals: ["life"] });
    expect(q.status, JSON.stringify(q.json)).toBe(201);
    const quotePub = q.json["public_id"] as string;
    const fn = await req(env, "POST", `/quotes/${quotePub}/funnels`, { funnel_name: "Main" });
    expect([200, 201]).toContain(fn.status);
    const hook = insertOffer(sdb, { name: "Lead Hook Offer", mode: "request_static_bid", sendOnly: ANY_OK_JSON });
    const plain = insertOffer(sdb, { name: "Fixed Address Offer", mode: "static_no_request" });
    const res = await admin.request(`/admin/leadgen/quotes/${quotePub}/edit`, {}, env);
    expect(res.status).toBe(200);
    const html = await res.text();
    const m = /<script id="lg-qr-data" type="application\/json">([\s\S]*?)<\/script>/.exec(html);
    expect(m, "the rail's data blob").not.toBeNull();
    const data = JSON.parse((m as RegExpExecArray)[1] as string) as { offers: Array<Record<string, unknown>> };
    expect(data.offers.find((o) => o["id"] === hook.id)?.["send_only"]).toBe(true);
    expect(data.offers.find((o) => o["id"] === plain.id)?.["send_only"]).toBeUndefined();
    expect(railRedirectOptions(html).map((o) => o.value)).not.toContain(String(hook.id));
  });
});

// --- the Funnel rules window (the Auction editor page's own script) ----------------

interface Booted {
  doc: MiniDocument;
  byId: (id: string) => MiniNode;
  settle: () => Promise<void>;
}

async function seedAuction(): Promise<{ sdb: SqliteDb; env: Env; auctionPub: string; funnelPub: string; variant: { id: number; public_id: string }; normal: Offer; hook: Offer }> {
  const { sdb, env } = newHarness();
  const q = await req(env, "POST", "/quotes", { quote_name: "Test Quote", activity: "quote_funnel", verticals: ["life"] });
  const quoteId = q.json["id"] as number;
  const a = await req(env, "POST", "/auctions", { auction_name: "Test Auction", quote_id: quoteId, auction_type: "dynamic" });
  expect(a.status, JSON.stringify(a.json)).toBe(201);
  const funnelPub = mintPublicId("funnel");
  sdb.prepare("INSERT INTO leadgen_funnels (public_id, quote_id, funnel_name, status, display_order) VALUES (?, ?, 'Main', 'active', 1)").run(funnelPub, quoteId);
  const funnelId = (sdb.prepare("SELECT id FROM leadgen_funnels WHERE public_id = ?").get(funnelPub) as { id: number }).id;
  const variantPub = mintPublicId("funnel_variant");
  sdb
    .prepare("INSERT INTO leadgen_funnel_variants (public_id, funnel_id, variant_label, traffic_allocation_bp, funnel_design_id, status, content_version, auction_id) VALUES (?, ?, 'A', 10000, 'default', 'active', 1, ?)")
    .run(variantPub, funnelId, a.json["id"] as number);
  const variantId = (sdb.prepare("SELECT id FROM leadgen_funnel_variants WHERE public_id = ?").get(variantPub) as { id: number }).id;
  return {
    sdb,
    env,
    auctionPub: a.json["public_id"] as string,
    funnelPub,
    variant: { id: variantId, public_id: variantPub },
    normal: insertOffer(sdb, { name: "Fixed Address Offer", mode: "static_no_request" }),
    hook: insertOffer(sdb, { name: "Lead Hook Offer", mode: "request_static_bid", sendOnly: null }),
  };
}

async function bootRules(s: Awaited<ReturnType<typeof seedAuction>>): Promise<Booted> {
  const res = await admin.request(`/admin/leadgen/auction/${s.auctionPub}/edit`, {}, s.env);
  expect(res.status).toBe(200);
  const html = await res.text();
  const doc = miniDocument(html);
  const script = [...html.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter((m) => !(m[1] ?? "").includes("application/json"))
    .map((m) => m[2] ?? "")
    .find((src) => src.includes("getElementById('lg-frr-root')"));
  expect(script, "the rule window's script is on the page").toBeDefined();
  const pending: Array<Promise<unknown>> = [];
  const timers: Array<() => void> = [];
  const fetchStub = (url: string, init: RequestInit = {}): Promise<Response> => {
    const method = (init.method ?? "GET").toUpperCase();
    const p = Promise.resolve(admin.request(url, { method, headers: init.headers as HeadersInit, body: init.body as BodyInit | undefined }, s.env));
    pending.push(p);
    return p;
  };
  const windowObj: Record<string, unknown> = {
    location: { reload: () => undefined, href: `http://localhost/admin/leadgen/auction/${s.auctionPub}/edit` },
    confirm: () => true,
    setTimeout: (fn: () => void) => { timers.push(fn); return timers.length; },
    innerWidth: 1280,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    requestAnimationFrame: (fn: () => void) => { timers.push(fn); return timers.length; },
    getComputedStyle: () => ({ getPropertyValue: () => "" }),
    matchMedia: () => ({ matches: false, addListener: () => undefined, addEventListener: () => undefined }),
  };
  runInNewContext(script as string, { window: windowObj, document: doc, fetch: fetchStub, setTimeout: windowObj["setTimeout"], Promise, console });
  const settle = async (): Promise<void> => {
    let quiet = 0;
    for (let i = 0; i < 500 && quiet < 10; i++) {
      while (timers.length > 0) (timers.shift() as () => void)();
      const inFlight = pending.splice(0);
      if (inFlight.length > 0) { quiet = 0; await Promise.all(inFlight); } else quiet += 1;
      await new Promise((r) => setImmediate(r));
    }
  };
  const byId = (id: string): MiniNode => {
    const el = doc.getElementById(id);
    expect(el, `#${id} on the page`).not.toBeNull();
    return el as MiniNode;
  };
  await settle();
  const funnelSel = byId("lg-frr-funnel");
  funnelSel.value = s.funnelPub;
  funnelSel.fire("change");
  const variantSel = byId("lg-frr-variant");
  variantSel.value = s.variant.public_id;
  variantSel.fire("change");
  await settle();
  return { doc, byId, settle };
}

function offerOptions(b: Booted): Array<{ value: string; text: string; disabled: boolean }> {
  return b
    .byId("lg-frr-offer")
    .querySelectorAll("option")
    .filter((o) => o.value !== "")
    .map((o) => ({ value: o.value, text: o.textContent, disabled: o.disabled }));
}

describeDb("Send-only Offers — Funnel rules window", () => {
  it("a new \"Redirect to offer\" rule never lists a send-only Offer, for either timing", async () => {
    const s = await seedAuction();
    s.sdb.prepare("UPDATE leadgen_offers SET send_only_json = ? WHERE id = ?").run(ANY_OK_JSON, s.hook.id);
    const b = await bootRules(s);
    (b.doc.querySelector("[data-lg-frr-new]") as MiniNode).click();
    b.byId("lg-frr-type").value = "redirect_direct_offer";
    b.byId("lg-frr-type").fire("change");
    expect(offerOptions(b).map((o) => o.value)).toEqual([String(s.normal.id)]);
    b.byId("lg-frr-timing-now").checked = false;
    b.byId("lg-frr-timing-after").checked = true;
    b.byId("lg-frr-timing-after").fire("change");
    expect(offerOptions(b).map((o) => o.value)).toEqual([String(s.normal.id)]);
  });

  it("\"Edit\" on a saved rule whose Offer became send-only keeps it shown, not selectable, with the reason", async () => {
    const s = await seedAuction();
    const created = await req(s.env, "POST", `/variants/${s.variant.public_id}/rules`, {
      rule_type: "redirect_direct_offer", rule_name: "Old", conditions_json: { groups: [] }, target_offer_id: s.hook.id, redirect_pct: 100,
    });
    expect(created.status, JSON.stringify(created.json)).toBe(201);
    s.sdb.prepare("UPDATE leadgen_offers SET send_only_json = ? WHERE id = ?").run(ANY_OK_JSON, s.hook.id);
    const b = await bootRules(s);
    const row = b.doc.querySelector(`[data-rule-public-id="${created.json["public_id"] as string}"]`) as MiniNode;
    (row.querySelector("[data-frr-edit]") as MiniNode).click();
    await b.settle();
    expect(b.byId("lg-frr-offer").value).toBe(String(s.hook.id));
    const byValue = (a: { value: string }, z: { value: string }): number => a.value.localeCompare(z.value);
    expect(offerOptions(b).sort(byValue)).toEqual([
      { value: String(s.normal.id), text: "Fixed Address Offer", disabled: false },
      { value: String(s.hook.id), text: "Lead Hook Offer (sends the lead only, no card)", disabled: true },
    ].sort(byValue));
    // a NEW rule afterwards no longer lists it
    (b.byId("lg-frr-modal").querySelector("[data-lg-frr-cancel]") ?? b.doc.querySelector("[data-lg-frr-cancel]"))?.click();
    (b.doc.querySelector("[data-lg-frr-new]") as MiniNode).click();
    b.byId("lg-frr-type").value = "redirect_direct_offer";
    b.byId("lg-frr-type").fire("change");
    expect(offerOptions(b).map((o) => o.value)).toEqual([String(s.normal.id)]);
  });
});
