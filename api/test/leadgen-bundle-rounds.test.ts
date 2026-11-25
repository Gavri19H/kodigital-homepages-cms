import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { loadPreparedFunnelBundle } from "../src/public/leadgen/bundle";
import leadgenRouter from "../src/public/leadgen/runtime-routes";
import {
  buildLeadgenEnv, createLeadgenDb, d1FromSqlite, loadDatabaseSync, makeKvStub, type SqliteDb,
} from "./helpers/leadgen-analytics-harness";

const origin = "https://one.example.com";
const landing = origin + "/lg/life?utm_source=paid";
const redirect = "https://partner.example/start";
const now = Date.UTC(2026, 0, 15, 12);
const sid = "returning";
const headers = { Cookie: "ko_sid=" + sid, "User-Agent": "iPhone" };

function publicId(prefix: string, id: number): string {
  return prefix + "_" + String(id).padStart(26, "0");
}

function seed(sql: SqliteDb): void {
  // Bring the analytics fixture up to the columns used by the live entry routes.
  for (const file of ["0055_leadgen_quote_default_template.sql", "0058_leadgen_offer_clickout_meta.sql",
    "0061_leadgen_routing_present_only_offer.sql"]) {
    (sql.exec as (s: string) => void)(readFileSync(new URL("../migrations/" + file, import.meta.url), "utf8"));
  }
  if (typeof sql.function !== "function") throw new Error("SQLite clock override required for row parity");
  sql.function("unixepoch", () => now / 1000);
  sql.prepare("CREATE TABLE site_settings (site_id TEXT, key TEXT, value TEXT)").run();
  sql.prepare("INSERT INTO site_settings VALUES ('site-1', 'site_name', 'Example Quotes')").run();
  sql.prepare(`INSERT INTO leadgen_quotes (id, public_id, quote_name, activity, verticals_json, status, default_funnel_id)
    VALUES (1, ?, 'Life', 'quote_funnel', '["life"]', 'active', 1)`).run(publicId("lgq", 1));
  sql.prepare("INSERT INTO leadgen_site_quotes (site_id, quote_id, enabled, slug) VALUES ('site-1', 1, 1, 'life')").run();
  sql.prepare(`INSERT INTO leadgen_funnels (id, public_id, funnel_name, quote_id, status)
    VALUES (1, ?, 'Family', 1, 'active')`).run(publicId("lgf", 1));
  sql.prepare(`INSERT INTO leadgen_funnel_ab_tests (public_id, funnel_id, name, revision, status)
    VALUES (?, 1, 'Split', 7, 'running')`).run(publicId("lgx", 1));
  sql.prepare(`INSERT INTO leadgen_auctions (id, public_id, auction_name, auction_type, carrier_normalization_version)
    VALUES (1, ?, 'Offers', 'static', 3)`).run(publicId("lga", 1));
  const variant = sql.prepare(`INSERT INTO leadgen_funnel_variants
    (id, public_id, funnel_id, variant_label, traffic_allocation_bp, auction_id) VALUES (?, ?, 1, ?, 5000, 1)`);
  variant.run(1, publicId("lgn", 1), "A");
  variant.run(2, publicId("lgn", 2), "B");

  const ctas = [{ id: "mobile_line", slot: "under_header", label: "Talk to us", tel: "+15551234567",
    condition: { match: "all", conditions: [{ when: "__state", op: "eq", value: "CA" }] } }];
  sql.prepare("UPDATE leadgen_frame_templates SET frame_json = json_set(frame_json, '$.cta_slots', json(?)) WHERE id = 1")
    .run(JSON.stringify(ctas));
  sql.prepare("INSERT INTO leadgen_quote_default_template VALUES (?, 1)").run(publicId("lgq", 1));

  const rule = sql.prepare(`INSERT INTO leadgen_quote_routing_rules
    (public_id, quote_id, rule_name, priority, conditions_hash, conditions_json, target_funnel_id,
     feed_name, value_multiplier, redirect_pct, redirect_url, redirect_url_allowlisted)
    VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const condition = (field: string, value: string) => JSON.stringify({ groups: [{ field, op: "eq", value }] });
  rule.run(publicId("lgqr", 1), "Partner redirect", 1, "redirect", condition("utm_source", "partner"),
    null, null, null, 100, redirect, 1);
  rule.run(publicId("lgqr", 2), "Paid feed", 2, "paid", condition("utm_source", "paid"),
    null, "paid_life", 1.75, null, null, 0);
  rule.run(publicId("lgqr", 3), "Checkpoint", 3, "answer", condition("zip", "90001"),
    1, null, null, null, null, 0);

  // Interleave slotted and direct shared pages. Page IDs and insertion order
  // deliberately disagree with page/section position order.
  const page = sql.prepare(`INSERT INTO leadgen_funnel_pages (id, public_id, quote_id, variant_id, position)
    VALUES (?, ?, ?, ?, ?)`);
  page.run(30, publicId("lgpg", 30), 1, null, 0);
  page.run(10, publicId("lgpg", 10), 1, null, 1);
  page.run(20, publicId("lgpg", 20), 1, null, 2);
  const slot = sql.prepare("INSERT INTO leadgen_funnel_page_slots (id, page_id, position) VALUES (?, ?, 0)");
  slot.run(10, 10);
  const section = sql.prepare(`INSERT INTO leadgen_sections
    (id, public_id, section_name, activity, vertical, headline_text, content_json)
    VALUES (?, ?, ?, 'quote_funnel', 'life', ?, ?)`);
  const attach = sql.prepare(`INSERT INTO leadgen_funnel_variant_sections
    (id, section_id, quote_id, variant_id, page_id, slot_id, position) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  for (const [id, pageId, slotId, position] of [[2, 30, null, 1], [3, 10, 10, 2], [4, 20, null, 3], [1, 30, null, 0]] as const) {
    const components = id === 3 ? [{ type: "ZIPInputQuestion", question_id: "q_zip", question_key: "zip", internal_field: "zip" }] : [];
    section.run(id, publicId("lgs", id), "Shared " + id, "Shared " + id, JSON.stringify({ components }));
    attach.run(id, id, 1, null, pageId, slotId, position);
  }
  for (const arm of [1, 2]) {
    const id = 40 + arm;
    page.run(id, publicId("lgpg", id), null, arm, 0);
    slot.run(id, id);
    section.run(id, publicId("lgs", id), "Arm " + arm, "Arm " + arm, '{"components":[]}');
    attach.run(id, id, null, arm, id, id, 0);
  }
}

// Hold each D1 reply until the next event-loop turn. Statements issued before
// the same reply are one round. Awaiting that reply starts a new round. Count
// executions (including writes), excluding fixture setup and inspection.
function measure(sql: SqliteDb) {
  const db = d1FromSqlite(sql);
  const rounds: string[][] = [];
  let reply: Promise<void> | undefined;
  function send(query: string): Promise<void> {
    if (!reply) {
      rounds.push([]);
      reply = new Promise<void>((resolve) => setImmediate(() => {
        reply = undefined;
        resolve();
      }));
    }
    rounds[rounds.length - 1]!.push(query);
    return reply;
  }
  const prepare = db.prepare.bind(db);
  db.prepare = (query) => {
    const stmt = prepare(query);
    const { first, all, run } = stmt; // harness bind() returns this same statement
    stmt.first = async <T>(column?: string) => {
      await send(query);
      return column === undefined ? first<T>() : first<T>(column);
    };
    stmt.all = async <T>() => { await send(query); return all<T>(); };
    stmt.run = async <T>() => { await send(query); return run<T>(); };
    return stmt;
  };
  return { db, rounds };
}

const variant = publicId("lgn", 2);
const bundlePrefix = `lgbundle:site-1:${variant}:`;
const attemptUrl = origin + "/lg/attempt?vid=" + variant + "&u=" + encodeURIComponent(landing);

let sql: SqliteDb;
let trace: ReturnType<typeof measure>;
let env: ReturnType<typeof buildLeadgenEnv>;
let buildStart: number;
let buildEnd: number;

beforeEach(() => {
  const DatabaseSync = loadDatabaseSync();
  if (!DatabaseSync) throw new Error("node:sqlite is required to measure bundle misses");
  vi.useFakeTimers({ toFake: ["Date"], now });
  vi.spyOn(crypto, "getRandomValues").mockImplementation((bytes) => {
    if (bytes instanceof Uint8Array) bytes.fill(7);
    return bytes;
  });
  sql = createLeadgenDb(DatabaseSync);
  seed(sql);
  trace = measure(sql);

  // Measure from the cold bundle lookup through storage of the completed build.
  // The shell resolves its host before the lookup. A paid attempt records its
  // routing outcome on the primary after the definition has been stored.
  buildStart = buildEnd = -1;
  const { kv, store } = makeKvStub();
  Object.assign(kv, {
    async get(name: string) {
      if (name.startsWith(bundlePrefix)) {
        expect(store.has(name)).toBe(false);
        buildStart = trace.rounds.length;
      }
      return store.get(name) ?? null;
    },
    async put(name: string, value: string) {
      if (name.startsWith(bundlePrefix)) buildEnd = trace.rounds.length;
      store.set(name, value);
    },
    async getWithMetadata(name: string) { return { value: store.get(name) ?? null, metadata: null }; },
  });
  env = buildLeadgenEnv(trace.db, kv);
});
afterEach(() => {
  sql.close();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function edgeHeaders() {
  return new Headers({ ...headers, "x-cms-site-id": "site-1", "x-cms-snap-built-at": String(now),
    "x-cms-snap-version": "a".repeat(64), "x-cms-bookmark": "bookmark-001" });
}

// Complete output bytes from 19bc4063 under TZ=UTC, with the attempt kickoff
// and v16 runtime preload and script URLs in the shell.
// Store them losslessly in this test so parity also covers omitted fields and key order.
const original = {
  bundle:
    "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",
  shell:
    "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" +
    "KZyFAQA=",
  attempt:
    "H4sIAAAAAAAAE62TX2+bPBTGv4uvswkMdE3ukhIorHYGJYA9TYh/IQaboAKBUPW7vyJ9J20X26Soliz7WEePfn6Onldw6Os651HcdblouohlYAXirosk+ashubpjSlKgmFvZ/fLzBAvQsqLOsyg91QdWRN2pymuw" +
    "Amf4Ob/YIgu0ngbjIRPGJQ6MPjOWDX2w7iwx1gm/H5C+/vtmVmvVmBPFbRKoHRLFrmhoH2LTmOKrjiNjr4BYR+pO54x4lYKgIXYeGsi0l3aeM2Kxl0lpl8QzBC7dCunVgHVHowGtsOdAJPYX7BlH7B0F1V1OSsSe" +
    "HuwygZpEA00KFcrTGjcJVNmu3LaWoHIiNJ4Yy2P26PIk3Egh5JVVnhgJXSmc1uOzRIZ95brutB78CT+6nvGMp02IpMxAvqVYbGAp9KcU8nPC//ektnn26F8SwXt6sVpLGH2qZDzly46EmyEOtDqEx2MKC7Zj1kgm" +
    "u0TlXkUl0ojAFS1tQctNiadCQxMVuMTlzltDUu5lKrYKFo6KJuOIJkshwlHIZHA02QLplkb1+e6zmYuEfpmZV67ZAxEH2SET/uXKyqw7692flgRadWVS/EtyncVRyh43047dnxOo8SfhqySQh8Tc9wQuuyc41k9w" +
    "bKjYR1nodqGCz1lol9STBxLw6uqJadTUXw6JafS//pV6RMJ6KtGyGKm5nchkQayTEUNHwVOhIogGLLYj8jaClsfjzjQE9hyZmtsBmUjeeVsFQ8yRTjQqcIV1S7Vq6fO3L58OpiPfJ4naq99yRw7jr+sEvmh34eWg" +
    "ORF2wmcv9WC4HcACpN0IVq+g7eIuByvwsAYLkOVnls6VOCWM5+BtAZq4yKOGxzVYfX99r65R4kVTRNIfliLNWeKn99h9khegzdOOneqo6RPO0p8S7R8VJBksQNzOeRR53UUvedye5iwe2Jhn4G1xKwu8gQV+FIv8" +
    "G4ss3cCifBQL/N0X9QYW9aNYVPgri3rDjNR/zOjHAqRNC1bf/+Xu3JjOfe8RiDir8/mxzdt2BrqSvORd/1KzugBv/wGq4kqZaQYAAA==",
};

function buildRounds() {
  expect(buildStart).toBeGreaterThanOrEqual(0);
  expect(buildEnd).toBeGreaterThan(buildStart);
  return trace.rounds.slice(buildStart, buildEnd);
}

function expectOriginalBuild(kind: keyof typeof original, bytes: string) {
  const rounds = buildRounds();
  expect(bytes).toBe(gunzipSync(Buffer.from(original[kind], "base64")).toString("utf8"));
  expect(rounds.length).toBeLessThanOrEqual(3);
  // One definition read followed by the three concurrent binding/shell reads.
  expect(rounds.map(round => round.length)).toEqual([1, 3]);
}

it("preserves the complete freshly resolved bundle", async () => {
  const bundle = await loadPreparedFunnelBundle(env, edgeHeaders(), "site-1", variant, undefined, "life");
  expect(bundle?.resolved.variant.public_id).toBe(variant);
  expectOriginalBuild("bundle", JSON.stringify(bundle));
});

it.each(["shell", "attempt"] as const)("rebuilds a cold %s bundle in at most three D1 rounds", async kind => {
  const h = edgeHeaders();
  if (kind === "shell") h.set("x-cms-variant", "lg:" + variant);
  const req = Object.assign(new Request(kind === "shell" ? landing : attemptUrl, { headers: h }), {
    cf: { regionCode: "CA" },
  });
  const res = await leadgenRouter.request(req, undefined, kind === "shell" ? { ...env, EDGE_INNER: "1" } : env);
  expect(res.status).toBe(200);
  expectOriginalBuild(kind, await res.text());
  expect(trace.rounds.slice(0, buildStart)).toEqual(kind === "shell"
    ? [[expect.stringContaining("FROM domains d INNER JOIN sites")]] : []);
  expect(trace.rounds.slice(buildEnd)).toEqual(kind === "attempt"
    ? [[expect.stringContaining("INSERT OR REPLACE INTO leadgen_routing_outcomes")]] : []);
});

it("loads only the serving site's published footer picks in the dependent round", async () => {
  sql.prepare(`CREATE TABLE pages (id INTEGER PRIMARY KEY, site_id TEXT, slug TEXT, page_type TEXT,
    status TEXT, show_in_footer INTEGER, display_order INTEGER)`).run();
  const add = sql.prepare("INSERT INTO pages (site_id, slug, page_type, status) VALUES (?, ?, ?, ?)");
  const picks = Array.from({ length: 85 }, (_, i) => ({ page_type: "legal", slug: "page-" + i, label: "Page " + i }));
  for (const pick of picks) add.run("site-1", pick.slug, pick.page_type, "published");
  add.run("site-2", "another-site", "privacy", "published");
  add.run("site-1", "draft", "privacy", "draft");
  const footer = { enabled: true, blocks: [{ type: "link_row", links_source: "picked", picks: [
    ...picks, { page_type: "privacy", label: "Privacy", manual_url: "/fallback" },
  ] }] };
  sql.prepare("UPDATE leadgen_frame_templates SET frame_json = json_set(frame_json, '$.footer', json(?)) WHERE id = 1")
    .run(JSON.stringify(footer));
  const bundle = await loadPreparedFunnelBundle(env, edgeHeaders(), "site-1", variant, undefined, "life");
  expect(bundle?.resolved.site_branding?.legal_links).toEqual([
    ...picks.map(pick => ({ label: pick.label, href: "/" + pick.slug })), { label: "Privacy", href: "/fallback" },
  ]);
  const rounds = buildRounds();
  expect(rounds.map(round => round.length)).toEqual([1, 1, 3]);
  expect(rounds[1]![0]).toContain("FROM pages");
});

it("requires the correct site, explicit root slug and served arm before loading a bundle", async () => {
  sql.prepare("UPDATE leadgen_funnel_ab_tests SET status = 'stopped'").run();
  const control = publicId("lgn", 1);
  for (const [site, arm, slug] of [["site-1", variant, "life"], ["site-2", control, "life"], ["site-1", control, null]] as const) {
    expect(await loadPreparedFunnelBundle(env, edgeHeaders(), site, arm, undefined, slug)).toBeNull();
  }
  expect(trace.rounds.map(round => round.length)).toEqual([1, 1, 1]);
  // Old rows without page records still form one shared first page, then one
  // synthetic page per variant placement, with the original negative slot ids.
  sql.prepare("DELETE FROM leadgen_funnel_pages").run();
  sql.prepare("UPDATE leadgen_site_quotes SET slug = NULL").run();
  const bundle = await loadPreparedFunnelBundle(env, edgeHeaders(), "site-1", control, undefined, null);
  expect(bundle?.resolved.assignment.assignment_reason).toBe("single_control");
  expect(bundle?.resolved.pages?.map(page => [page.public_id, page.slots.map(slot => slot.id)])).toEqual([
    ["lgpg_shared_q1", [-1000001, -1000002, -1000003, -1000004]], ["lgpg_v41", [-1]],
  ]);
  expect(bundle?.resolved.sections.map(row => row.section.id)).toEqual([1, 2, 3, 4, 41]);
});

it("reads a large page tree in one definition query and preserves full-precision routing values", async () => {
  const add = sql.prepare(`INSERT INTO leadgen_sections (id, public_id, section_name, activity, vertical, headline_text, content_json)
    VALUES (?, ?, 'Question', 'quote_funnel', 'life', 'Question', '{"components":[]}')`);
  const attach = sql.prepare(`INSERT INTO leadgen_funnel_variant_sections (quote_id, page_id, section_id, position)
    VALUES (1, 20, ?, ?)`);
  const extraIds = Array.from({ length: 156 }, (_, i) => 100 + i);
  for (const id of extraIds) {
    add.run(id, publicId("lgs", id));
    attach.run(id, id);
  }
  const multiplier = 1.2345678901234567;
  const percent = 12.345678901234567;
  sql.prepare("UPDATE leadgen_quote_routing_rules SET value_multiplier = ?, redirect_pct = ? WHERE conditions_hash = 'paid'")
    .run(multiplier, percent);

  const bundle = await loadPreparedFunnelBundle(env, edgeHeaders(), "site-1", variant);
  expect(bundle?.resolved.sections.map(row => row.section.id)).toEqual([1, 2, 3, 4, ...extraIds, 42]);
  expect(Object.keys(bundle!.shell.answerMapVersions)).toHaveLength(161);
  expect(bundle?.resolved.routing_rules?.find(rule => rule.hash === "paid")).toMatchObject({
    value_multiplier: multiplier, redirect_pct: percent,
  });
  const rounds = buildRounds();
  expect(rounds[0]).toHaveLength(1);
  expect(rounds[0]![0]).toContain("FROM leadgen_funnel_variants");
  for (const query of rounds.slice(2).flat()) expect(query).toContain("FROM leadgen_section_answer_maps");
  console.info(`161 distinct sections: ${rounds.length} build rounds, ${rounds.flat().length} D1 calls`);
});
