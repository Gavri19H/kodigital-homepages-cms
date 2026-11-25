import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import leadgenAdmin from "../src/admin/leadgen/router";
import * as cacheKeys from "../src/cache/cache-keys";
import { LEADGEN_TEMPLATE_VERSION, leadgenBundleKey } from "../src/cache/cache-keys";
import { gatewayFetch } from "../src/edge/gateway";
import { PublicPage } from "../src/edge/public-page";
import type { PublicPageProps, SiteSnapshot } from "../src/edge/types";
import type { Env } from "../src/env";
import type { FunnelAttempt } from "../src/public/leadgen/attempt";
import { LEADGEN_THEMES_KV_KEY } from "../src/public/leadgen/designs/theme-store";
import leadgenRouter from "../src/public/leadgen/runtime-routes";
import {
  buildLeadgenEnv, createLeadgenDb, ctxCapture, d1FromSqlite, loadDatabaseSync, makeKvStub, type SqliteDb,
} from "./helpers/leadgen-analytics-harness";

vi.mock("cloudflare:workers", () => ({
  WorkerEntrypoint: class {
    constructor(readonly ctx: ExecutionContext, readonly env: Env) {}
  },
}));

const now = Date.UTC(2026, 0, 15, 12);
const origin = "https://one.example.com";
const siteId = "site-1";
const bookmark = "bookmark-001";
const testVersion = "a".repeat(64);
const landing = origin + "/lg/life?utm_source=paid";
const publicId = (prefix: string, n: number) => prefix + "_" + String(n).padStart(26, "0");
const variant = publicId("lgn", 2);
const attemptUrl = origin + "/lg/attempt?vid=" + variant + "&u=" + encodeURIComponent(landing);
const visitor = { Cookie: "ko_sid=returning", "User-Agent": "iPhone" };
const cf = { regionCode: "CA" };

function cta(id: string, label: string) {
  return { id, slot: "under_header", label, tel: "+15551234567",
    condition: { match: "all", conditions: [{ when: "__state", op: "eq", value: "CA" }] } };
}

function seed(sql: SqliteDb) {
  for (const name of ["0032_listicles_core", "0055_leadgen_quote_default_template", "0058_leadgen_offer_clickout_meta",
    "0061_leadgen_routing_present_only_offer", "0072_sites_write_bookmark"]) {
    (sql.exec as (s: string) => void)(readFileSync(new URL("../migrations/" + name + ".sql", import.meta.url), "utf8"));
  }
  if (typeof sql.function !== "function") throw new Error("SQLite clock override required");
  sql.function("unixepoch", () => Math.floor(Date.now() / 1000));
  sql.prepare("CREATE TABLE cache_purge_log (id INTEGER PRIMARY KEY, site_id TEXT, action TEXT, status TEXT, dry_run INTEGER, payload TEXT)").run();
  sql.prepare("CREATE TABLE site_settings (site_id TEXT, key TEXT, value TEXT)").run();
  sql.prepare("INSERT INTO site_settings VALUES (?, 'site_name', 'Family Quotes')").run(siteId);
  sql.prepare("UPDATE sites SET write_bookmark = ? WHERE id = ?").run(bookmark, siteId);
  sql.prepare(`INSERT INTO leadgen_quotes (id, public_id, quote_name, activity, verticals_json, status, default_funnel_id)
    VALUES (1, ?, 'Life', 'quote_funnel', '["life"]', 'active', 1)`).run(publicId("lgq", 1));
  sql.prepare(`INSERT INTO leadgen_site_quotes (site_id, quote_id, enabled, slug, settings_overrides_json)
    VALUES (?, 1, 1, 'life', '{"ga4_measurement_id":"G-FAMILY"}')`).run(siteId);
  sql.prepare(`INSERT INTO leadgen_funnels (id, public_id, quote_id, funnel_name, status, theme_json)
    VALUES (1, ?, 1, 'Family', 'active', '{"theme_id":"family"}')`).run(publicId("lgf", 1));
  sql.prepare(`INSERT INTO leadgen_funnel_ab_tests (public_id, funnel_id, name, revision, status)
    VALUES (?, 1, 'Split', 7, 'running')`).run(publicId("lgx", 1));
  sql.prepare(`INSERT INTO leadgen_auctions (id, public_id, auction_name, auction_type, carrier_normalization_version)
    VALUES (1, ?, 'Offers', 'static', 3)`).run(publicId("lga", 1));
  sql.prepare(`INSERT INTO leadgen_offers (id, public_id, offer_name, activity, vertical, conversion_tracking_method,
    offer_type, status, clickout_meta_conversion, clickout_meta_dataset_id)
    VALUES (1, ?, 'Quote', 'quote_funnel', 'life', 's2s_postback', 'cpc', 'active', 1, '123456789')`).run(publicId("lgo", 1));
  sql.prepare("INSERT INTO leadgen_auction_offers (auction_id, offer_placement_id, offer_id, enabled) VALUES (1, 1, 1, 1)").run();
  sql.prepare("UPDATE leadgen_frame_templates SET frame_json = json_set(frame_json, '$.cta_slots', json(?)) WHERE id = 1")
    .run(JSON.stringify([cta("mobile_line", "Talk to us")]));
  sql.prepare("INSERT INTO leadgen_quote_default_template VALUES (?, 1)").run(publicId("lgq", 1));
  const rule = sql.prepare(`INSERT INTO leadgen_quote_routing_rules
    (public_id, quote_id, rule_name, priority, conditions_hash, conditions_json, target_funnel_id, feed_name, value_multiplier)
    VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?)`);
  rule.run(publicId("lgqr", 1), "Paid", 1, "paid", '{"groups":[{"field":"utm_source","op":"eq","value":"paid"}]}', null, "paid_life", 1.75);
  rule.run(publicId("lgqr", 2), "Checkpoint", 2, "zip", '{"groups":[{"field":"zip","op":"eq","value":"90001"}]}', 1, null, null);
  const page = sql.prepare("INSERT INTO leadgen_funnel_pages (id, public_id, quote_id, variant_id, position) VALUES (?, ?, ?, ?, 0)");
  const slot = sql.prepare("INSERT INTO leadgen_funnel_page_slots (id, page_id, position) VALUES (?, ?, 0)");
  const section = sql.prepare(`INSERT INTO leadgen_sections (id, public_id, section_name, activity, vertical, headline_text, content_json)
    VALUES (?, ?, 'Question', 'quote_funnel', 'life', ?, ?)`);
  const attach = sql.prepare(`INSERT INTO leadgen_funnel_variant_sections (quote_id, variant_id, section_id, page_id, slot_id, position)
    VALUES (?, ?, ?, ?, ?, 0)`);
  // Direct shared page first, followed by the selected arm's slotted page.
  page.run(10, publicId("lgpg", 10), 1, null);
  section.run(10, publicId("lgs", 10), "Your ZIP", JSON.stringify({ components: [
    { type: "ZIPInputQuestion", question_id: "q_zip", question_key: "zip", internal_field: "zip" },
  ] }));
  attach.run(1, null, 10, 10, null);
  sql.prepare(`INSERT INTO leadgen_section_answer_maps (id, public_id, section_id, question_id, question_key, internal_field, answer_type,
    offer_id, payload_schema_id, payload_schema_public_id, offer_payload_field_path, provider_expected_type)
    VALUES (47, ?, 10, 'q_zip', 'zip', 'zip', 'string', 1, 1, 'schema', 'zip', 'string')`).run(publicId("lgm", 47));
  for (const arm of [1, 2]) {
    sql.prepare(`INSERT INTO leadgen_funnel_variants (id, public_id, funnel_id, variant_label, traffic_allocation_bp, auction_id)
      VALUES (?, ?, 1, ?, 5000, 1)`).run(arm, publicId("lgn", arm), arm === 1 ? "A" : "B");
    page.run(arm, publicId("lgpg", arm), null, arm);
    slot.run(arm, arm);
    section.run(arm, publicId("lgs", arm), "Arm " + arm, '{"components":[]}');
    attach.run(null, arm, arm, arm, arm);
  }
}

let sql: SqliteDb;
let env: Env;
let kv: ReturnType<typeof makeKvStub>;
let capture: ReturnType<typeof ctxCapture>;
const statements: { connection: string; query: string }[] = [];
const sessions: string[] = [];
let failRead: string | undefined;

// Count real statement executions. A distinct connection label detects writes
// accidentally routed to the render session, even though both use this SQLite DB.
function tracedDb(connection: string) {
  const db = d1FromSqlite(sql);
  const prepare = db.prepare.bind(db);
  db.prepare = query => {
    const stmt = prepare(query);
    const { first, all, run } = stmt;
    function record() {
      statements.push({ connection, query });
      if (failRead && query.includes(failRead)) throw new Error("simulated unavailable read");
    }
    stmt.first = async <T>(column?: string) => { record(); return column === undefined ? first<T>() : first<T>(column); };
    stmt.all = async <T>() => { record(); return all<T>(); };
    stmt.run = async <T>() => {
      record();
      // The SQLite shim calls run() for each batch member. D1 returns rows for batched reads.
      return /^\s*(?:SELECT|WITH)\b/i.test(query) ? all<T>() : run<T>();
    };
    return stmt;
  };
  return db;
}

beforeEach(() => {
  const DatabaseSync = loadDatabaseSync();
  if (!DatabaseSync) throw new Error("node:sqlite required");
  vi.useFakeTimers({ toFake: ["Date"], now });
  vi.spyOn(crypto, "getRandomValues").mockImplementation(bytes => {
    if (bytes instanceof Uint8Array) bytes.fill(7);
    return bytes;
  });
  sql = createLeadgenDb(DatabaseSync);
  seed(sql);
  kv = makeKvStub();
  kv.store.set(LEADGEN_THEMES_KV_KEY, JSON.stringify({ family: {
    id: "family", name: "Family", roles: { brand_primary: "#15375C", accent: "#F5C518", page_bg: "#F4F6F9",
      card: "#FFFFFF", text: "#1A1F36", success: "#0E7C3A", error: "#B23A2C" },
    typography: { headline_font: "Newsreader", body_font: "Inter", base_px: 16 },
    controls: { field_height: "medium", button_size: "m", corners: "rounded" },
  } }));
  Object.assign(kv.kv, { async getWithMetadata(key: string) { return { value: kv.store.get(key) ?? null, metadata: null }; } });
  vi.spyOn(kv.kv, "get");
  vi.spyOn(kv.kv, "getWithMetadata");
  vi.spyOn(kv.kv, "put");
  vi.spyOn(kv.kv, "delete");
  const primary = tracedDb("primary");
  primary.withSession = (constraint = "first-primary") => {
    sessions.push(constraint);
    const db = tracedDb(constraint);
    return { prepare: db.prepare, batch: db.batch, getBookmark: () => "bookmark-002" };
  };
  env = buildLeadgenEnv(primary, kv.kv);
  capture = ctxCapture();
  statements.length = sessions.length = 0;
  failRead = undefined;
});

afterEach(async () => {
  await Promise.all(capture.promises);
  sql.close();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function clearTrace() {
  statements.length = sessions.length = 0;
  vi.clearAllMocks();
}

const bundleKey = () => leadgenBundleKey(siteId, variant, testVersion, env.CF_VERSION_METADATA?.id);

function expectedVersion(snapshot: SiteSnapshot) {
  const content: Partial<SiteSnapshot> = { ...snapshot };
  delete content.builtAt;
  return createHash("sha256").update(JSON.stringify(content)).digest("hex");
}

function attempt(version?: string, supplied = visitor) {
  const headers = new Headers(supplied);
  if (version !== undefined) {
    headers.set("x-cms-site-id", siteId);
    headers.set("x-cms-bookmark", bookmark);
    headers.set("x-cms-snap-version", version);
    headers.set("x-cms-snap-built-at", String(now));
  }
  return leadgenRouter.fetch(Object.assign(new Request(attemptUrl, { headers }), { cf }), env, capture.ctx);
}

function shell(version?: string, path = "/lg/life") {
  const headers = new Headers({ "x-cms-bookmark": bookmark });
  if (version !== undefined) headers.set("x-cms-snap-version", version);
  const page = new PublicPage({ ...capture.ctx, props: { siteKey: siteId, variantKey: "lg:" + variant } }, env);
  return page.fetch(new Request(origin + path, { headers }));
}

function expectOneKvRead(key: string) {
  expect(kv.kv.get).toHaveBeenCalledExactlyOnceWith(key);
  expect(kv.kv.getWithMetadata).not.toHaveBeenCalled();
}

function liveBindingReads() {
  return ["carrier_normalization_version AS auction_version", "FROM placements p JOIN leadgen_sections",
    "FROM leadgen_quote_routing_rules WHERE quote_id"].map(fragment => ({
    connection: "primary", query: expect.stringContaining(fragment),
  }));
}

it("mints byte-identical attempts from a shell-prepared bundle with the live binding reads and primary outcome write", async () => {
  const baseline = await attempt();
  const body = await baseline.text();
  expect(baseline.status).toBe(200);
  const result = JSON.parse(body) as FunnelAttempt;
  expect(result.cc).toEqual(["mobile_line"]);
  expect(result.cps).toEqual([publicId("lgs", 10)]);
  expect(result.page_plan?.map(slot => slot.section_public_id)).toEqual([10, 2].map(n => publicId("lgs", n)));
  const outcomes = sql.prepare("SELECT * FROM leadgen_routing_outcomes");
  const row = outcomes.all();
  expect(row).toEqual([expect.objectContaining({ session_id: "returning", feed_name: "paid_life", value_multiplier: 1.75,
    routed_to_variant: variant, matched_rule_hash: "paid" })]);
  const writes = statements.filter(s => s.query.startsWith("INSERT"));
  expect(writes).toHaveLength(1);
  expect(statements).toHaveLength(6);
  expect(kv.kv.get).not.toHaveBeenCalled();
  sql.prepare("DELETE FROM leadgen_routing_outcomes").run();

  expect((await shell(testVersion)).status).toBe(200);
  await Promise.all(capture.promises);
  clearTrace();
  const warm = await attempt(testVersion);
  expect(warm.status).toBe(baseline.status);
  expect([...warm.headers]).toEqual([...baseline.headers]);
  expect(await warm.text()).toBe(body);
  expect(outcomes.all()).toEqual(row);
  expectOneKvRead(bundleKey());
  expect(statements).toEqual([...liveBindingReads(), ...writes]);
  expect(sessions).toEqual([]);
});

it("renders byte-identical shell HTML from an attempt-prepared bundle, including the theme and offer click config", async () => {
  env.PERFSTAGE = "true";
  env.CF_VERSION_METADATA = { id: "worker-42" };
  const before = await shell();
  const html = await before.text();
  expect(before.status).toBe(200);
  for (const value of ["Family Quotes", "Your ZIP", "Arm 2", "Talk to us", "#15375C", '"answer_mapping_version":"47"',
    "https://connect.facebook.net/en_US/fbevents.js", "<!--LG_ASSIGN-->"]) expect(html).toContain(value);
  expect(statements).toHaveLength(4);
  const hostRead = statements.filter(s => s.query.includes("FROM domains d INNER JOIN sites"));
  expect(hostRead).toHaveLength(1);
  expect(kv.kv.get).toHaveBeenCalledExactlyOnceWith(LEADGEN_THEMES_KV_KEY);

  clearTrace();
  expect((await attempt(testVersion)).status).toBe(200);
  await Promise.all(capture.promises);
  const key = "lgbundle:" + siteId + ":" + variant + ":" + testVersion + ":" + LEADGEN_TEMPLATE_VERSION + ":worker-42";
  expect(kv.kv.put).toHaveBeenCalledExactlyOnceWith(key, expect.any(String), { expirationTtl: 604800 });
  expect(sessions).toEqual([bookmark]);
  expect(statements.filter(s => s.connection === "primary")).toEqual([
    ...liveBindingReads(), { connection: "primary", query: expect.stringContaining("INSERT OR REPLACE") },
  ]);
  clearTrace();
  const warm = await shell(testVersion);
  expect(warm.status).toBe(before.status);
  const coldHeaders = new Headers(before.headers);
  const warmHeaders = new Headers(warm.headers);
  expect(coldHeaders.get("Server-Timing")).toContain(" calls=4 ");
  expect(warmHeaders.get("Server-Timing")).toContain("rounds=1 calls=1 ");
  coldHeaders.delete("Server-Timing");
  warmHeaders.delete("Server-Timing");
  expect([...warmHeaders]).toEqual([...coldHeaders]);
  expect(await warm.text()).toBe(html);
  expectOneKvRead(key);
  expect(statements).toEqual(hostRead);

  // The same variant still requires its enabled activation at the requested slug.
  expect((await shell(testVersion, "/lg/wrong-slug")).status).toBe(404);
  expect(kv.kv.delete).not.toHaveBeenCalled();
});

// Model only the Workers Cache boundary. Both snapshot creation and shell
// misses enter the real PublicPage, and the real admin writer calls purgeTags.
function cachedSnapshotGateway() {
  let cached: Response | null = null;
  const built: SiteSnapshot[] = [];
  const purgeTags = vi.fn(async (tags: string[]) => {
    const cachedTags = cached?.headers.get("Cache-Tag")?.split(",") ?? [];
    if (tags.some(tag => cachedTags.includes(tag))) cached = null;
    return { success: true, errors: [] };
  });
  const entrypoint = Object.assign(({ props }: { props: PublicPageProps }) => ({
    async fetch(request: Request) {
      if (props.variantKey === "snap" && cached) return cached.clone();
      const response = await new PublicPage({ ...capture.ctx, props }, env).fetch(request);
      if (props.variantKey === "snap" && response.ok) {
        cached = response.clone();
        built.push(await cached.clone().json() as SiteSnapshot);
      }
      return response;
    },
  }), { purgeTags });
  Object.assign(capture.ctx, { exports: { PublicPage: entrypoint } });
  const visit = (url: string) => gatewayFetch(Object.assign(new Request(url, { headers: visitor }), { cf }),
    env, capture.ctx, leadgenRouter.fetch);
  return { visit, built, purgeTags };
}

it("reuses the first location's bundle for a fresh shell build at a second location", async () => {
  const first = cachedSnapshotGateway();
  const before = await first.visit(landing);
  expect(before.status).toBe(200);
  const html = await before.text();
  const arm = /data-funnel-variant-id="([^"]+)"/.exec(html)?.[1];
  expect(arm).toBeDefined();
  await Promise.all(capture.promises);
  const key = leadgenBundleKey(siteId, arm!, expectedVersion(first.built[0]!));
  expect(kv.store.has(key)).toBe(true);

  vi.setSystemTime(now + 1000);
  const second = cachedSnapshotGateway();
  clearTrace();
  const after = await second.visit(landing);
  expect(after.status).toBe(200);
  expect(await after.text()).toBe(html);
  expect(first.built[0]!.builtAt).toBe(now);
  expect(second.built).toEqual([{ ...first.built[0], builtAt: now + 1000 }]);
  expectOneKvRead(key);
  await Promise.all(capture.promises);
  expect(kv.kv.put).not.toHaveBeenCalled();
  expect(sessions).toEqual(["first-primary", bookmark]);
  // First-primary reads build the second snapshot. The shell reuses its site context and the KV bundle without querying D1.
  expect(statements.filter(s => s.connection !== "first-primary")).toEqual([]);
});

it.each([false, true])("follows a real frame save through snapshot purge and both next requests (omit version = %s)", async omitVersion => {
  if (omitVersion) {
    // Fail-before control: run the identical writer + readers with only the
    // snapshot version removed. The old CTA then survives the successful purge.
    vi.spyOn(cacheKeys, "leadgenBundleKey").mockImplementation((site, arm, _snapshotVersion, version = "dev") =>
      ["lgbundle", site, arm, LEADGEN_TEMPLATE_VERSION, version].join(":"));
  }
  const { visit, built, purgeTags } = cachedSnapshotGateway();
  const before = await visit(landing);
  expect(before.status).toBe(200);
  const html = await before.text();
  expect(html).toContain("Talk to us");
  const arm = /data-funnel-variant-id="([^"]+)"/.exec(html)?.[1];
  expect(arm).toBeDefined();
  const url = new URL(attemptUrl);
  url.searchParams.set("vid", arm!);
  await Promise.all(capture.promises);
  const oldKey = cacheKeys.leadgenBundleKey(siteId, arm!, expectedVersion(built[0]!));
  expect(kv.store.has(oldKey)).toBe(true);
  expect((await (await visit(url.href)).json() as FunnelAttempt).cc).toEqual(["mobile_line"]);

  vi.setSystemTime(now + 2000);
  const edit = await leadgenAdmin.request("/api/admin/leadgen/funnels/1/frame", {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ frame_config_json: { version: 1, template: "centered", cta_slots: [cta("updated_line", "Updated quote help")] } }),
  }, env, capture.ctx);
  expect(edit.status).toBe(200);
  expect(await edit.json()).toMatchObject({ bumped_variants: 2 });
  expect(purgeTags).toHaveBeenCalledExactlyOnceWith(expect.arrayContaining(["snap:" + siteId]));
  expect(built).toHaveLength(1);
  const after = await visit(url.href);
  expect(after.status).toBe(200);
  const minted = await after.json() as FunnelAttempt;
  expect(built.map(s => s.builtAt)).toEqual([now, now + 2000]);
  expect(built[1]?.writeBookmark).toBe("bookmark-002");
  await Promise.all(capture.promises);
  const newKey = cacheKeys.leadgenBundleKey(siteId, arm!, expectedVersion(built[1]!));
  expect(newKey === oldKey).toBe(omitVersion);
  expect(kv.store.has(oldKey)).toBe(true);
  expect(kv.store.has(newKey)).toBe(true);
  clearTrace();
  const afterShell = await visit(landing);
  expect(afterShell.status).toBe(200);
  const afterHtml = await afterShell.text();
  expectOneKvRead(newKey);
  if (omitVersion) {
    expect(minted.cc).toEqual(["mobile_line"]);
    expect(afterHtml).toBe(html);
  } else {
    expect(minted.cc).toEqual(["updated_line"]);
    expect(afterHtml).toContain("Updated quote help");
    expect(afterHtml).not.toContain("Talk to us");
  }
});

it.each(["malformed", "wrong shape", "altered rule", "other site"])("evicts and repairs corrupt KV data (%s)", async kind => {
  const baseline = await attempt(testVersion);
  const expected = await baseline.text();
  await Promise.all(capture.promises);
  const key = bundleKey();
  const stored = kv.store.get(key)!;
  expect(stored).toContain("paid_life");
  let bad = "{";
  if (kind === "wrong shape") bad = '{"resolved":{}}';
  if (kind === "altered rule") bad = stored.replace("paid_life", "wrong_feed");
  if (kind === "other site") {
    sql.prepare("INSERT INTO sites (id, domain, status) VALUES ('neighbor', 'neighbor.example', 'active')").run();
    sql.prepare("INSERT INTO domains (site_id, hostname, status) VALUES ('neighbor', 'neighbor.example', 'active')").run();
    sql.prepare("INSERT INTO leadgen_site_quotes (site_id, quote_id, enabled, slug) VALUES ('neighbor', 1, 1, 'life')").run();
    const req = new Request("https://neighbor.example/lg/attempt?vid=" + variant, {
      headers: { ...visitor, "x-cms-site-id": "neighbor", "x-cms-snap-version": testVersion,
        "x-cms-snap-built-at": String(now) },
    });
    expect((await leadgenRouter.fetch(req, env, capture.ctx)).status).toBe(200);
    await Promise.all(capture.promises);
    bad = kv.store.get(leadgenBundleKey("neighbor", variant, testVersion))!;
  }
  kv.store.set(key, bad);
  clearTrace();
  const rebuilt = await attempt(testVersion);
  expect(rebuilt.status).toBe(200);
  expect(await rebuilt.text()).toBe(expected);
  expect(kv.kv.delete).toHaveBeenCalledExactlyOnceWith(key);
  expect(sessions).toEqual([bookmark]);
  await Promise.all(capture.promises);
  expect(kv.store.get(key)).toBe(stored);
  clearTrace();
  expect(await (await attempt(testVersion)).text()).toBe(expected);
  expectOneKvRead(key);
  expect(statements).toEqual([...liveBindingReads(), { connection: "primary", query: expect.stringContaining("INSERT OR REPLACE") }]);
});

it("uses the live loaders without a valid snapshot version even when KV is warm", async () => {
  expect((await attempt(testVersion)).status).toBe(200);
  await Promise.all(capture.promises);
  for (const extra of [{}, { "x-cms-snap-built-at": String(now) }, { "x-cms-snap-version": String(now) }]) {
    clearTrace();
    expect((await attempt(undefined, { ...visitor, ...extra })).status).toBe(200);
    expect(statements).toHaveLength(6);
    expect(statements.every(s => s.connection === "primary")).toBe(true);
    expect(kv.kv.get).not.toHaveBeenCalled();
  }
  clearTrace();
  expect((await shell()).status).toBe(200);
  expect(statements).toHaveLength(4);
  expect(kv.kv.get).toHaveBeenCalledExactlyOnceWith(LEADGEN_THEMES_KV_KEY);
  expect(kv.kv.put).not.toHaveBeenCalled();
});

it("uses the current visitor's cookie, landing URL and geography on a warm attempt", async () => {
  const first = await (await attempt(testVersion)).json() as FunnelAttempt;
  await Promise.all(capture.promises);
  clearTrace();
  vi.setSystemTime(now + 1000);
  const newLanding = origin + "/lg/life?utm_source=organic";
  const request = new Request(origin + "/lg/attempt?funnel_variant_id=" + variant + "&u=" + encodeURIComponent(newLanding), {
    headers: { "x-cms-site-id": siteId, "x-cms-bookmark": bookmark, "x-cms-snap-version": testVersion,
      "x-cms-snap-built-at": String(now) },
  });
  const response = await leadgenRouter.fetch(Object.assign(request, { cf: { regionCode: "NY" } }), env, capture.ctx);
  const second = await response.json() as FunnelAttempt & { session_id: string };
  expect(response.status).toBe(200);
  expect(response.headers.get("Set-Cookie")).toContain("ko_sid=" + second.session_id);
  expect(second.session_id).not.toBe("returning");
  expect(second.funnel_attempt_id).not.toBe(first.funnel_attempt_id);
  expect(second.signed_config_token).not.toBe(first.signed_config_token);
  const signed = JSON.parse(Buffer.from(second.signed_config_token.split(".")[1]!, "base64url").toString());
  expect(signed).toMatchObject({ session_id: second.session_id, landing_url: newLanding, auction_config_version: "3" });
  expect(second.ctx?.state).toBe("NY");
  expect(second.cc).toBeUndefined();
  expectOneKvRead(bundleKey());
  expect(statements).toEqual(liveBindingReads()); // organic traffic did not match the paid routing rule
});

it("hands the bundle put to waitUntil while the outcome has already committed", async () => {
  let finish!: () => void;
  const gate = new Promise<void>(resolve => { finish = resolve; });
  vi.mocked(kv.kv.put).mockImplementationOnce(async (key, value) => {
    await gate;
    kv.store.set(key, String(value));
  });
  try {
    const response = await attempt(testVersion);
    expect(response.status).toBe(200);
    expect(capture.promises).toHaveLength(1);
    expect(kv.store.has(bundleKey())).toBe(false);
    expect(sql.prepare("SELECT feed_name FROM leadgen_routing_outcomes").all()).toEqual([{ feed_name: "paid_life" }]);
  } finally {
    finish();
  }
  await Promise.all(capture.promises);
  expect(kv.store.has(bundleKey())).toBe(true);
});

it("retries a degraded rule read on the next request and mints through KV outages", async () => {
  failRead = "FROM leadgen_quote_routing_rules";
  const degraded = await attempt(testVersion);
  expect(degraded.status).toBe(200);
  expect((await degraded.json() as FunnelAttempt).cps).toBeUndefined();
  await Promise.all(capture.promises);
  expect(kv.kv.put).not.toHaveBeenCalled();
  failRead = undefined;
  vi.mocked(kv.kv.get).mockRejectedValueOnce(new Error("KV read unavailable"));
  vi.mocked(kv.kv.put).mockRejectedValueOnce(new Error("KV put unavailable"));
  const retry = await attempt(testVersion);
  expect(retry.status).toBe(200);
  expect((await retry.json() as FunnelAttempt).cps).toEqual([publicId("lgs", 10)]);
  await Promise.all(capture.promises);
  expect(kv.store.has(bundleKey())).toBe(false);
});

it("preserves the visitor's URL, CF metadata and cookies and forwards only snapshot-derived CMS headers", async () => {
  const { built } = cachedSnapshotGateway();
  const headers = { ...visitor, "x-cms-site-id": "neighbor", "x-cms-bookmark": "client", "x-cms-snap-built-at": "17",
    "x-cms-snap-version": testVersion, "x-cms-variant": "lg:client", "x-cms-other": "client" };
  const request = Object.assign(new Request(attemptUrl, { headers }), { cf });
  const app = vi.fn<Parameters<typeof gatewayFetch>[3]>(() => new Response("attempt", { headers: { "Cache-Control": "no-store" } }));
  const response = await gatewayFetch(request, env, capture.ctx, app);
  expect(await response.text()).toBe("attempt");
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(built).toHaveLength(1);
  expect(app).toHaveBeenCalledOnce();
  const [inner, appEnv, appCtx] = app.mock.calls[0]!;
  expect(inner.url).toBe(attemptUrl);
  expect(inner.method).toBe("GET");
  expect(inner.cf).toEqual(cf);
  expect([...inner.headers]).toEqual([...new Headers({ ...visitor, "x-cms-site-id": siteId,
    "x-cms-bookmark": bookmark, "x-cms-snap-version": expectedVersion(built[0]!), "x-cms-snap-built-at": String(now) })]);
  expect(appEnv).toBe(env);
  expect(appCtx).toBe(capture.ctx);
  const digest = vi.spyOn(crypto.subtle, "digest");
  await gatewayFetch(request, env, capture.ctx, app);
  expect(digest).not.toHaveBeenCalled();
});

it.each([["HEAD", "/lg/attempt"], ["POST", "/lg/attempt"], ["POST", "/lg/ck"], ["GET", "/lg/lc/offer"]])(
  "bypasses the snapshot on %s %s", async (method, path) => {
    const page = vi.fn();
    Object.assign(capture.ctx, { exports: { PublicPage: page } });
    const request = new Request(origin + path, { method, headers: visitor });
    const app = vi.fn<Parameters<typeof gatewayFetch>[3]>(() => new Response(null));
    await gatewayFetch(request, env, capture.ctx, app);
    expect(page).not.toHaveBeenCalled();
    expect(app).toHaveBeenCalledExactlyOnceWith(request, env, capture.ctx);
  },
);

it.each(["unavailable", "invalid", "wrong host", "inactive", "throw"])("uses the original uncached path on %s snapshot", async mode => {
  const fetch = vi.fn(async () => {
    if (mode === "throw") throw new Error("snapshot unavailable");
    if (mode === "unavailable") return new Response(null, { status: 503 });
    if (mode === "invalid") return new Response("{");
    return Response.json({ v: 1, siteId: "neighbor", hostname: mode === "wrong host" ? "other.example" : "one.example.com",
      status: mode === "inactive" ? "disabled" : "active", writeBookmark: "other-write", builtAt: now, contentVersion: 1,
      settingsVersion: 1, timeZone: null, language: null, listicles: {}, leadgen: {} } satisfies SiteSnapshot);
  });
  Object.assign(capture.ctx, { exports: { PublicPage: () => ({ fetch }) } });
  const request = Object.assign(new Request(attemptUrl, { headers: { ...visitor, "x-cms-site-id": "neighbor",
    "x-cms-snap-version": testVersion, "x-cms-snap-built-at": "17", "x-cms-bookmark": "client" } }), { cf });
  const app = vi.fn(leadgenRouter.fetch);
  const response = await gatewayFetch(request, env, capture.ctx, app);
  expect(fetch).toHaveBeenCalledOnce();
  expect(app).toHaveBeenCalledOnce();
  const [live] = app.mock.calls[0]!;
  expect(live.url).toBe(request.url);
  expect(live.cf).toEqual(cf);
  expect([...live.headers]).toEqual([...new Headers(visitor)]);
  expect(response.status).toBe(200);
  expect(statements).toHaveLength(6);
  expect(kv.kv.get).not.toHaveBeenCalled();
});
