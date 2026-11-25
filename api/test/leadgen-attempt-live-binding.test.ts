import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import leadgenAdmin from "../src/admin/leadgen/router";
import { leadgenBundleKey } from "../src/cache/cache-keys";
import { D1Timing, sessionReadDb } from "../src/db/read-session";
import { gatewayFetch } from "../src/edge/gateway";
import { PublicPage } from "../src/edge/public-page";
import type { PublicPageProps } from "../src/edge/types";
import type { Env } from "../src/env";
import { readLiveAttemptConfig, type ConfigTokenTuple, type FunnelAttempt } from "../src/public/leadgen/attempt";
import leadgenRouter from "../src/public/leadgen/runtime-routes";
import {
  attachOffer, buildLeadgenEnv, carrierBody, createLeadgenDb, ctxCapture, d1FromSqlite,
  loadDatabaseSync, makeKvStub, seedAuction, seedAuctionOffer, settle, stubLeadgenFetch, type SqliteDb,
} from "./helpers/leadgen-analytics-harness";

vi.mock("cloudflare:workers", () => ({
  WorkerEntrypoint: class {
    constructor(readonly ctx: ExecutionContext, readonly env: Env) {}
  },
}));

const origin = "https://one.example.com";
const site = "site-1";
const snapshot = "a".repeat(64);
const id = (prefix: string, n: number) => prefix + "_" + String(n).padStart(26, "0");
const variant = id("lgn", 1);
const key = leadgenBundleKey(site, variant, snapshot);
const session = "returning";
const landing = origin + "/lg/life?utm_source=paid";
const attemptUrl = origin + "/lg/attempt?vid=" + variant + "&u=" + encodeURIComponent(landing);
const headers = { Cookie: "ko_sid=" + session, "User-Agent": "Mozilla/5.0 (iPhone)" };
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
type Start = FunnelAttempt & { session_id: string };

let sql: SqliteDb;
let env: Env;
let cache: ReturnType<typeof makeKvStub>;
let capture: ReturnType<typeof ctxCapture>;
let provider: ReturnType<typeof stubLeadgenFetch>;
let timing: D1Timing;
let primary: D1Database;

function replaceMap(version: number) {
  sql.prepare("DELETE FROM leadgen_section_answer_maps WHERE section_id = ?").run(10);
  sql.prepare(`INSERT INTO leadgen_section_answer_maps
    (id, public_id, section_id, question_id, question_key, internal_field, answer_type, offer_id,
     payload_schema_id, payload_schema_public_id, offer_payload_field_path, provider_expected_type)
    VALUES (?, ?, 10, 'q_zip', 'zip', 'zip', 'string', 1, 1, 'schema', ?, 'string')`)
    .run(version, id("lgm", version), "zip" + version);
}

beforeEach(() => {
  const DatabaseSync = loadDatabaseSync();
  if (!DatabaseSync) throw new Error("node:sqlite is required for the live binding regression");
  sql = createLeadgenDb(DatabaseSync);
  for (const name of ["0055_leadgen_quote_default_template", "0058_leadgen_offer_clickout_meta",
    "0061_leadgen_routing_present_only_offer"]) {
    (sql.exec as (query: string) => void)(readFileSync(new URL("../migrations/" + name + ".sql", import.meta.url), "utf8"));
  }
  sql.prepare("CREATE TABLE site_settings (site_id TEXT, key TEXT, value TEXT)").run();
  const auction = seedAuction(sql);
  attachOffer(sql, auction.id, seedAuctionOffer(sql));
  sql.prepare(`INSERT INTO leadgen_quotes (id, public_id, quote_name, activity, verticals_json, status, default_funnel_id)
    VALUES (1, ?, 'Life', 'quote_funnel', '["life"]', 'active', 1)`).run(id("lgq", 1));
  sql.prepare("INSERT INTO leadgen_site_quotes (site_id, quote_id, enabled, slug) VALUES (?, 1, 1, 'life')").run(site);
  sql.prepare("INSERT INTO leadgen_funnels (id, public_id, funnel_name, quote_id, status) VALUES (1, ?, 'Life', 1, 'active')")
    .run(id("lgf", 1));
  sql.prepare("INSERT INTO leadgen_funnel_variants (id, public_id, funnel_id, variant_label, auction_id) VALUES (1, ?, 1, 'A', ?)")
    .run(variant, auction.id);
  const add = sql.prepare(`INSERT INTO leadgen_sections
    (id, public_id, section_name, activity, vertical, headline_text, content_json)
    VALUES (?, ?, ?, 'quote_funnel', 'life', ?, ?)`);
  for (const [n, field] of [[10, "zip"], [20, "email"]] as const) {
    add.run(n, id("lgs", n), field, field, JSON.stringify({ components: [
      { type: "TextInputQuestion", question_id: "q_" + field, question_key: field, internal_field: field },
    ] }));
  }
  sql.prepare("INSERT INTO leadgen_funnel_pages (id, public_id, quote_id, position) VALUES (10, ?, 1, 0)").run(id("lgpg", 10));
  sql.prepare("INSERT INTO leadgen_funnel_variant_sections (quote_id, page_id, section_id, position) VALUES (1, 10, 10, 0)").run();
  sql.prepare("INSERT INTO leadgen_funnel_variant_sections (variant_id, section_id, position) VALUES (1, 20, 0)").run();
  replaceMap(11);
  const rule = sql.prepare(`INSERT INTO leadgen_quote_routing_rules
    (public_id, quote_id, rule_name, priority, conditions_hash, conditions_json, target_funnel_id, feed_name)
    VALUES (?, 1, ?, ?, ?, ?, ?, ?)`);
  rule.run(id("lgqr", 1), "Paid", 1, "paid", '{"groups":[{"field":"utm_source","op":"eq","value":"paid"}]}', null, "original");
  rule.run(id("lgqr", 2), "Checkpoint", 2, "zip", '{"groups":[{"field":"zip","op":"eq","value":"90001"}]}', 1, null);

  primary = d1FromSqlite(sql);
  const prepare = primary.prepare.bind(primary);
  primary.prepare = query => {
    const stmt = prepare(query);
    // The SQLite shim executes each batch member via run(). Native D1 returns SELECT rows.
    if (/^\s*(?:WITH|SELECT)\b/i.test(query)) stmt.run = stmt.all;
    return stmt;
  };
  vi.spyOn(primary, "batch");
  timing = new D1Timing();
  cache = makeKvStub();
  Object.assign(cache.kv, {
    async getWithMetadata(k: string) { return { value: cache.store.get(k) ?? null, metadata: null }; },
  });
  env = buildLeadgenEnv(sessionReadDb(primary, undefined, timing), cache.kv);
  capture = ctxCapture();
  provider = stubLeadgenFetch(() => new Response(carrierBody([{ name: "Acme", bid: 12 }])));
  // Identical request, attempt id and signing inputs except for the edited D1 fields.
  vi.useFakeTimers({ toFake: ["Date"], now: Date.UTC(2026, 0, 15, 12) });
  vi.spyOn(crypto, "getRandomValues").mockImplementation(bytes => {
    if (bytes instanceof Uint8Array) bytes.fill(7);
    return bytes;
  });
});

afterEach(async () => {
  await settle(capture.promises);
  sql.close();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function requestStart() {
  return leadgenRouter.request(attemptUrl, { headers: { ...headers, "x-cms-site-id": site,
    "x-cms-snap-built-at": String(Date.now()), "x-cms-snap-version": snapshot } }, env, capture.ctx);
}
async function start(): Promise<Start> {
  const res = await requestStart();
  expect(res.status).toBe(200);
  return await res.json() as Start;
}
function payload(start: Start): ConfigTokenTuple {
  const [scheme, data] = start.signed_config_token.split(".");
  expect(scheme).toBe("v2");
  return JSON.parse(Buffer.from(data!, "base64url").toString("utf8"));
}
function post(path: string, body: object) {
  return leadgenRouter.request(origin + path, { method: "POST", headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(body) }, env, capture.ctx);
}
function checkpoint(s: Start) {
  return post("/lg/ck", { k: s.signed_config_token, f: s.funnel_attempt_id, v: variant, s: s.session_id, a: {} });
}
function runAuction(s: Start, sectionOrderHash: string) {
  return post("/lg/auction", { funnel_variant_id: variant, funnel_attempt_id: s.funnel_attempt_id,
    session_id: s.session_id, signed_config_token: s.signed_config_token, section_order_hash: sectionOrderHash, answers: {} });
}
async function configHash() {
  const res = await leadgenRouter.request(origin + "/lg/config/" + variant, { headers }, env, capture.ctx);
  expect(res.status).toBe(200);
  return (await res.json() as { section_order_hash: string }).section_order_hash;
}

it.each([
  { name: "site bookmark", bookmark: "write-001", constraint: "write-001", replicaBatches: 1 },
  { name: "missing bookmark", bookmark: undefined, constraint: undefined, replicaBatches: 0 },
  { name: "malformed bookmark", bookmark: "bad,bookmark", constraint: "first-primary", replicaBatches: 0 },
])("selects the binding reader's connection for a $name", async ({ bookmark, constraint, replicaBatches }) => {
  const replica = d1FromSqlite(sql);
  replica.batch = <T>(statements: D1PreparedStatement[]) => Promise.all(statements.map(stmt => stmt.all<T>()));
  vi.spyOn(replica, "prepare");
  vi.spyOn(replica, "batch");
  const openSession = vi.fn((requested?: string) => {
    const connection = requested === "first-primary" ? primary : replica;
    return { prepare: connection.prepare, batch: connection.batch, getBookmark: () => null };
  });
  primary.withSession = openSession;
  const live = await readLiveAttemptConfig(primary, site, variant, bookmark);

  expect(openSession.mock.calls).toEqual(constraint ? [[constraint]] : []);
  expect(replica.prepare).toHaveBeenCalledTimes(3 * replicaBatches);
  expect(replica.batch).toHaveBeenCalledTimes(replicaBatches);
  expect(primary.batch).toHaveBeenCalledTimes(1 - replicaBatches);
  expect(live?.binding).toMatchObject({ auction_config_version: "1", answer_mapping_hash: sha('["11","0"]') });
});

it("forwards the bookmark recorded by an admin auction edit and mints its new version on the next start", async () => {
  for (const file of ["0032_listicles_core.sql", "0072_sites_write_bookmark.sql"]) {
    (sql.exec as (query: string) => void)(readFileSync(new URL("../migrations/" + file, import.meta.url), "utf8"));
  }
  sql.prepare("CREATE TABLE cache_purge_log (id INTEGER PRIMARY KEY, site_id TEXT, action TEXT, status TEXT, dry_run INTEGER, payload TEXT)").run();
  sql.prepare("UPDATE sites SET write_bookmark = ? WHERE id = ?").run("write-001", site);
  primary.withSession = () => ({ prepare: primary.prepare, batch: primary.batch, getBookmark: () => "write-002" });
  const purgeTags = vi.fn(async (_tags: string[]) => ({ success: true, errors: [] }));
  const entrypoint = Object.assign(({ props }: { props: PublicPageProps }) => new PublicPage({ ...capture.ctx, props }, env), { purgeTags });
  Object.assign(capture.ctx, { exports: { PublicPage: entrypoint } });
  const route = vi.fn(leadgenRouter.fetch);
  async function visit() {
    const response = await gatewayFetch(new Request(attemptUrl, { headers }), env, capture.ctx, route);
    expect(response.status).toBe(200);
    return payload(await response.json() as Start);
  }
  const old = await visit();
  expect(old.auction_config_version).toBe("1");
  await settle(capture.promises);
  const edit = await leadgenAdmin.request("/api/admin/leadgen/auctions/1", {
    method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ carrier_normalization_version: 2 }),
  }, env, capture.ctx);
  expect(edit.status).toBe(200);
  expect(purgeTags).toHaveBeenCalledExactlyOnceWith(expect.arrayContaining(["snap:" + site]));
  expect(sql.prepare("SELECT write_bookmark FROM sites WHERE id = ?").get(site)).toEqual({ write_bookmark: "write-002" });

  expect(await visit()).toEqual({ ...old, auction_config_version: "2" });
  expect(route.mock.calls.map(([request]) => request.headers.get("x-cms-bookmark"))).toEqual(["write-001", "write-002"]);
});

it.each(["auction", "map", "both"] as const)("accepts a warm start after a direct %s edit, and rejects the old binding", async edit => {
  const previous = await start();
  await settle(capture.promises);
  const old = payload(previous);
  expect(old).toMatchObject({ answer_mapping_hash: sha('["11","0"]'), auction_config_version: "1" });

  // Leave a valid previous-release bundle in KV, including its now-obsolete binding.
  const definition = JSON.parse(JSON.parse(cache.store.get(key)!).body);
  expect(definition).not.toHaveProperty("bindings");
  const body = JSON.stringify({ ...definition, bindings: {
    answer_mapping_hash: old.answer_mapping_hash, auction_config_version: old.auction_config_version,
  } });
  const stored = JSON.stringify({ body, digest: createHash("sha256").update(key + "\n" + body).digest("base64") });
  cache.store.set(key, stored);
  sql.prepare("DELETE FROM leadgen_routing_outcomes WHERE funnel_attempt_id = ?").run(previous.funnel_attempt_id);
  if (edit !== "map") sql.prepare("UPDATE leadgen_auctions SET carrier_normalization_version = ? WHERE id = ?").run(2, 1);
  if (edit !== "auction") replaceMap(27);

  const { rounds, calls } = timing;
  vi.mocked(primary.batch).mockClear();
  let batchesDuringLookup = 0;
  const lookup = vi.fn(async (k: string) => {
    await Promise.resolve();
    batchesDuringLookup = vi.mocked(primary.batch).mock.calls.length;
    return cache.store.get(k) ?? null;
  });
  Object.assign(cache.kv, { get: lookup });
  const fresh = await start();
  expect(lookup).toHaveBeenCalledExactlyOnceWith(key);
  expect(batchesDuringLookup).toBe(1);
  expect(cache.store.get(key)).toBe(stored);
  expect(primary.batch).toHaveBeenCalledOnce();
  const warm = { rounds: timing.rounds - rounds, calls: timing.calls - calls };
  expect(warm).toEqual({ rounds: 2, calls: 2 });
  expect(sql.prepare("SELECT feed_name FROM leadgen_routing_outcomes WHERE funnel_attempt_id = ?").get(fresh.funnel_attempt_id))
    .toEqual({ feed_name: "original" });
  expect(payload(fresh)).toEqual({ ...old,
    auction_config_version: edit === "map" ? "1" : "2",
    answer_mapping_hash: edit === "auction" ? old.answer_mapping_hash : sha('["27","0"]'),
  });
  const hash = await configHash(); // the independent order hash the client actually posts
  const stale = [await checkpoint(previous), await runAuction(previous, hash)];
  for (const res of stale) {
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ traffic_quality_flag: "tampered" });
  }
  expect(provider.providerCalls).toHaveLength(0);
  const ck = await checkpoint(fresh);
  expect(ck.status).toBe(200);
  expect(await ck.json()).toEqual({ sw: false });
  const auction = await runAuction(fresh, hash);
  expect(auction.status).toBe(200);
  expect(await auction.json()).toMatchObject({ status: "ok", banners: [expect.objectContaining({ bid: 12 })] });
  expect(provider.providerCalls).toHaveLength(1);
  if (edit === "both") {
    console.info(`Warm /lg/attempt: ${warm.calls} D1 calls in ${warm.rounds} rounds (batch + outcome write).`,
      `/lg/ck and /lg/auction: stale ${stale.map(res => res.status).join("/")}, fresh ${ck.status}/${auction.status}.`);
  }
});

it("binds a reassigned auction, variant version and live slot order, including repeated placements", async () => {
  await start();
  await settle(capture.promises);
  const replacement = seedAuction(sql);
  sql.prepare("UPDATE leadgen_auctions SET carrier_normalization_version = ? WHERE id = ?").run(9, replacement.id);
  sql.prepare("UPDATE leadgen_funnel_variants SET content_version = ?, auction_id = ? WHERE id = ?").run(8, replacement.id, 1);
  sql.prepare("UPDATE leadgen_sections SET content_version = ? WHERE id = ?").run(5, 20);
  sql.prepare("INSERT INTO leadgen_funnel_pages (id, public_id, variant_id, position) VALUES (20, ?, 1, 0)").run(id("lgpg", 20));
  sql.prepare("INSERT INTO leadgen_funnel_page_slots (id, page_id, position) VALUES (1, 20, 1), (2, 20, 0)").run();
  sql.prepare("UPDATE leadgen_funnel_variant_sections SET page_id = 20, slot_id = 1 WHERE variant_id = 1").run();
  sql.prepare("INSERT INTO leadgen_funnel_variant_sections (variant_id, page_id, slot_id, section_id, position) VALUES (1, 20, 2, 10, 1)").run();
  const fresh = await start();
  const hash = await configHash();
  expect(payload(fresh)).toMatchObject({ funnel_variant_id: variant, content_version: 8, auction_config_version: "9",
    section_order_hash: hash, answer_mapping_hash: sha('["11","11","0"]') });
  expect((await checkpoint(fresh)).status).toBe(200);
  expect((await runAuction(fresh, hash)).status).toBe(200);
});

it("uses edited entry actions and checkpoint anchors from the same live batch", async () => {
  expect((await start()).cps).toEqual([id("lgs", 10)]);
  await settle(capture.promises);
  sql.prepare("UPDATE leadgen_quote_routing_rules SET feed_name = ?, value_multiplier = ? WHERE priority = 1").run("updated", 2.5);
  sql.prepare("UPDATE leadgen_quote_routing_rules SET conditions_json = ? WHERE priority = 2")
    .run('{"groups":[{"field":"email","op":"eq","value":"yes"}]}');
  const fresh = await start();
  expect(fresh.cps).toEqual([id("lgs", 20)]);
  expect(sql.prepare("SELECT feed_name, value_multiplier FROM leadgen_routing_outcomes WHERE funnel_attempt_id = ?")
    .get(fresh.funnel_attempt_id)).toEqual({ feed_name: "updated", value_multiplier: 2.5 });
});

it("falls back to the live resolver if the binding batch fails", async () => {
  await start();
  await settle(capture.promises);
  replaceMap(27);
  vi.mocked(primary.batch).mockRejectedValueOnce(new Error("unavailable"));
  const fresh = await start();
  expect(payload(fresh).answer_mapping_hash).toBe(sha('["27","0"]'));
  expect((await checkpoint(fresh)).status).toBe(200);
});

it("refuses a warm bundle after the site's activation is disabled", async () => {
  await start();
  await settle(capture.promises);
  sql.prepare("UPDATE leadgen_site_quotes SET enabled = 0 WHERE site_id = ?").run(site);
  const res = await requestStart();
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: "Not Found" });
});
