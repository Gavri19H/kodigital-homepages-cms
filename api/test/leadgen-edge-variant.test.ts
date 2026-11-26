import { afterAll, afterEach, assert, beforeAll, describe, expect, it, vi } from "vitest";
import { injectLeadgenAssignment, leadgenGatewayCookies } from "../src/edge/leadgen-gateway";
import { buildLeadgenSnapshot, selectLeadgenEntry } from "../src/edge/leadgen-select";
import type { Env } from "../src/env";
import leadgenRouter from "../src/public/leadgen/runtime-routes";
import { injectAssignment } from "../src/public/leadgen/serve";
import { readCookie } from "../src/public/listicle/experiment-pick";
import { addSite, createDb, env, type SqliteDb } from "./helpers/x06-a2-sqlite";

const siteId = "quote-edge";
const origin = `https://${siteId}.example`;
const redirectLocation = "https://partner.example/quotes?campaign=renewal";
const mapsKey = "test-browser-maps-key";
const sentinel = "<!--LG_ASSIGN-->";
const mintedSid = "6bcfd486-e75e-46ff-8510-000000000001";
const returningSid = "visiteur/été";

function publicId(prefix: string, n: number): string {
  return prefix + "_" + String(n).padStart(26, "0");
}

function seed(db: SqliteDb): void {
  for (const site of [siteId, "neighbor"]) {
    addSite(db, site, site, "health");
    db.prepare("INSERT INTO domains (site_id, hostname, status) VALUES (?, ?, 'active')").run(site, site + ".example");
  }
  const quote = db.prepare(`INSERT INTO leadgen_quotes (id, public_id, quote_name, activity, verticals_json, status)
    VALUES (?, ?, ?, 'quote_funnel', '["life"]', 'active')`);
  const activate = db.prepare("INSERT INTO leadgen_site_quotes (site_id, quote_id, enabled, slug) VALUES (?, ?, 1, ?)");
  const funnel = db.prepare(`INSERT INTO leadgen_funnels (id, public_id, quote_id, funnel_name, status)
    VALUES (?, ?, ?, ?, 'active')`);
  for (const [id, name, site, slug] of [
    [1, "Split", siteId, null], [2, "Renewal", siteId, "renewal"], [3, "Neighbor", "neighbor", null],
  ] as const) {
    quote.run(id, publicId("lgq", id), name);
    activate.run(site, id, slug);
    funnel.run(id, publicId("lgf", id), id, name);
  }
  const variant = db.prepare(`INSERT INTO leadgen_funnel_variants
    (id, public_id, funnel_id, variant_label, traffic_allocation_bp) VALUES (?, ?, ?, ?, ?)`);
  variant.run(11, publicId("lgn", 11), 1, "A", 5000);
  variant.run(12, publicId("lgn", 12), 1, "B", 5000);
  variant.run(21, publicId("lgn", 21), 2, "A", 10000);
  variant.run(31, publicId("lgn", 31), 3, "A", 10000);
  db.prepare(`INSERT INTO leadgen_funnel_ab_tests (public_id, funnel_id, name, revision, status)
    VALUES (?, 1, 'Entry split', 7, 'running')`).run(publicId("lgx", 1));

  db.prepare(`INSERT INTO leadgen_sections
    (id, public_id, section_name, activity, vertical, headline_text, content_json)
    VALUES (1, ?, 'ZIP', 'quote_funnel', 'life', 'Votre code postal', ?)`).run(publicId("lgs", 1),
    JSON.stringify({ components: [{
      type: "ZIPInputQuestion", question_id: "q_zip", question_key: "zip", internal_field: "zip", props: { validate: true },
    }] }));
  const attach = db.prepare("INSERT INTO leadgen_funnel_variant_sections (variant_id, section_id, position) VALUES (?, 1, 0)");
  for (const id of [11, 12, 21, 31]) attach.run(id);

  const conditions = JSON.stringify({ groups: [
    { field: "utm_source", op: "eq", value: "paid" },
    { field: "state", op: "eq", value: "CA" },
    { field: "device", op: "eq", value: "mobile" },
  ] });
  const rule = db.prepare(`INSERT INTO leadgen_quote_routing_rules
    (public_id, quote_id, rule_name, conditions_json, conditions_hash, target_funnel_id,
     redirect_pct, redirect_url, redirect_url_allowlisted) VALUES (?, ?, 'Paid mobile CA', ?, 'paid-mobile-ca', ?, ?, ?, ?)`);
  // On the split quote, two different attribution reasons use the very same variant shell.
  rule.run(publicId("lgqr", 1), 1, conditions, 1, null, null, 0);
  rule.run(publicId("lgqr", 2), 2, conditions, null, 100, redirectLocation, 1);
}

function bindings(db: SqliteDb): Env {
  const result = env(db);
  const cache = new Map<string, string>();
  Object.assign(result.CACHE, {
    async get(key: string) { return cache.get(key) ?? null; },
    async getWithMetadata(key: string) { return { value: cache.get(key) ?? null, metadata: null }; },
    async put(key: string, value: string) { cache.set(key, value); },
  });
  return Object.assign(result, { GOOGLE_MAPS_BROWSER_KEY: mapsKey });
}

const traffic = [
  { name: "direct", query: "", state: "", ua: "", matched: false },
  { name: "paid California phone", query: "?utm_source=paid", state: "CA", ua: "iPhone", matched: true },
  { name: "paid New York phone", query: "?utm_source=paid", state: "NY", ua: "iPhone", matched: false },
  { name: "paid California desktop", query: "?utm_source=paid", state: "CA", ua: "Windows NT", matched: false },
  { name: "organic California phone", query: "?utm_source=organic", state: "CA", ua: "Android Mobile", matched: false },
  { name: "repeat UTM on Android", query: "?utm_source=paid&utm_source=organic&utm_content=caf%C3%A9",
    state: "CA", ua: "Android Mobile", matched: true },
];
const visits = [
  { visit: "first", cookie: "", splitArm: 11 },
  { visit: "returning", cookie: "other=1; ko_sid=" + encodeURIComponent(returningSid), splitArm: 12 },
];
const cases = ["/lg", "/lg/renewal"].flatMap((path) =>
  visits.flatMap((visit) => traffic.map((landing) => ({ path, ...visit, ...landing }))),
);

describe("quote shell and gateway parity", () => {
  let db: SqliteDb;
  let directEnv: Env;
  let innerEnv: Env;
  let snapshot: Awaited<ReturnType<typeof buildLeadgenSnapshot>>;

  beforeAll(async () => {
    db = createDb();
    seed(db);
    // Independent KV stores exercise both cold renders before either path can reuse its own shells.
    directEnv = bindings(db);
    innerEnv = bindings(db);
    snapshot = await buildLeadgenSnapshot(innerEnv.DB, siteId);
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(() => db.close());

  it.each(cases)("$path, $visit visit, $name", async ({ path, query, state, ua, cookie, splitArm, matched }) => {
    const uuid = vi.spyOn(crypto, "randomUUID").mockReturnValue(mintedSid);
    const url = new URL(path + query, origin);
    const cf = { regionCode: state };
    const headers = new Headers();
    if (ua) headers.set("User-Agent", ua);
    if (cookie) headers.set("Cookie", cookie);
    const request = Object.assign(new Request(url.href, { headers }), { cf });
    const direct = await leadgenRouter.request(request, undefined, directEnv);

    const existingSid = readCookie(cookie, "ko_sid");
    const sid = existingSid || mintedSid;
    const selection = selectLeadgenEntry(snapshot[path === "/lg" ? "/lg" : "renewal"], {
      url, headers, cf, nowMs: Date.now(), sid, cookies: existingSid ? { ko_sid: existingSid } : {},
    });
    const cookies = leadgenGatewayCookies(sid, !existingSid);
    expect(cookies).toEqual(direct.headers.getSetCookie());
    expect(cookies).toHaveLength(existingSid ? 0 : 1);
    if (path === "/lg/renewal" && matched) {
      expect(direct.status).toBe(302);
      expect(direct.headers.get("Location")).toBe(redirectLocation);
      expect(selection).toEqual({ kind: "redirect", status: direct.status, location: direct.headers.get("Location") });
      expect(await direct.text()).toBe("");
      return;
    }

    assert(selection.kind === "render");
    expect(selection.funnelVariantId).toBe(publicId("lgn", path === "/lg" ? splitArm : 21));
    expect(selection.assignment.routing_rule_hash).toBe(matched ? "paid-mobile-ca" : undefined);
    expect(direct.status).toBe(200);
    const etag = direct.headers.get("ETag");
    assert(etag);
    const innerHeaders = new Headers(headers);
    innerHeaders.delete("Cookie");
    innerHeaders.set("Accept", "text/html");
    innerHeaders.set("x-cms-variant", "lg:" + selection.funnelVariantId);
    innerHeaders.set("If-None-Match", etag);
    const inner = await leadgenRouter.request(origin + path, { headers: innerHeaders }, innerEnv);
    expect(inner.status).toBe(200);
    expect(inner.headers.get("ETag")).toBe(etag);
    expect(inner.headers.getSetCookie()).toEqual([]);
    expect(uuid).toHaveBeenCalledTimes(existingSid ? 0 : 1);
    const shell = await inner.clone().text();
    expect(shell).toContain(sentinel);
    expect(shell).not.toContain("window.__LG_ASSIGNMENT__=");
    expect(shell).toContain(mapsKey);
    expect(shell).not.toContain("<!--LG_MAPS_KEY-->");

    const result = await injectLeadgenAssignment(inner, selection);
    for (const line of cookies) result.headers.append("Set-Cookie", line);
    expect(result.status).toBe(direct.status);
    expect([...result.headers]).toEqual([...direct.headers]);
    const directBody = await direct.text();
    expect(directBody).toContain("<script>window.__LG_ASSIGNMENT__=");
    expect(directBody).not.toContain(sentinel);
    if (matched) expect(directBody).toContain('"assignment_reason":"routing_rule:paid-mobile-ca"');
    expect(await result.text()).toBe(directBody);
  });

  it.each([
    ["unknown", publicId("lgn", 999)], ["another site", publicId("lgn", 31)],
    ["another quote on this site", publicId("lgn", 21)], ["malformed", "bad-id"],
  ])("falls back to the direct visit for a variant from %s", async (_name, id) => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue(mintedSid);
    const url = origin + "/lg";
    const direct = await leadgenRouter.request(url, {}, directEnv);
    const fallback = await leadgenRouter.request(url, { headers: { "x-cms-variant": "lg:" + id } }, innerEnv);
    expect(direct.status).toBe(200);
    expect(direct.headers.getSetCookie()).toHaveLength(1);
    expect(fallback.status).toBe(direct.status);
    expect([...fallback.headers]).toEqual([...direct.headers]);
    expect(await fallback.text()).toBe(await direct.text());
  });

  it("ignores redirect inputs on an already selected shell", async () => {
    const url = origin + "/lg/renewal?utm_source=paid";
    const headers = new Headers({ "User-Agent": "iPhone", Cookie: "ko_sid=return", "If-None-Match": "*" });
    const cf = { regionCode: "CA" };
    const request = () => Object.assign(new Request(url, { headers }), { cf });
    expect((await leadgenRouter.request(request(), undefined, directEnv)).status).toBe(302);
    headers.set("x-cms-variant", "lg:" + publicId("lgn", 21));
    const inner = await leadgenRouter.request(request(), undefined, innerEnv);
    expect(inner.status).toBe(200);
    expect(inner.headers.getSetCookie()).toEqual([]);
    expect(await inner.text()).toContain(sentinel);
  });

  it("preserves response metadata and measures the injected HTML in UTF-8 bytes", async () => {
    const selection = selectLeadgenEntry(snapshot["/lg"], {
      url: new URL("/lg", origin), headers: new Headers(), cf: {}, nowMs: Date.now(), sid: returningSid, cookies: {},
    });
    assert(selection.kind === "render");
    const html = "<title>Québec</title>" + sentinel;
    const response = new Response(html, { status: 203, statusText: "Cached copy", headers: {
      "cf-cache-status": "HIT", "Cache-Tag": "quote:1", ETag: '"split"', "Content-Length": String(Buffer.byteLength(html)),
    } });
    const expected = injectAssignment(html, selection.assignment, selection.funnelVariantId);
    const result = await injectLeadgenAssignment(response, selection);
    expect(result.status).toBe(203);
    expect(result.statusText).toBe(response.statusText);
    expect(await result.text()).toBe(expected);
    const headers = new Headers(response.headers);
    headers.set("Content-Length", String(Buffer.byteLength(expected)));
    expect([...result.headers]).toEqual([...headers]);

    const head = new Response(null, { headers });
    expect(await injectLeadgenAssignment(head, selection)).toBe(head);
  });

  it.each(["/lg", "/lg/config/" + publicId("lgn", 11)])("passes waitUntil to cold and warm cache calls on %s", async (path) => {
    const fresh = bindings(db);
    vi.spyOn(Math, "random").mockReturnValue(0); // Sample both cache counters.
    const jobs: Promise<unknown>[] = [];
    const ctx = { waitUntil(job: Promise<unknown>) { jobs.push(job); }, passThroughOnException() {}, props: {} };
    const init = { headers: { "x-cms-variant": "lg:" + publicId("lgn", 11) } };
    expect((await leadgenRouter.request(origin + path, init, fresh, ctx)).status).toBe(200);
    expect(jobs).toHaveLength(2); // Cache fill and sampled miss.
    await Promise.all(jobs);
    jobs.length = 0;
    expect((await leadgenRouter.request(origin + path, init, fresh, ctx)).status).toBe(200);
    expect(jobs).toHaveLength(1); // Sampled hit.
    await Promise.all(jobs);
  });
});
