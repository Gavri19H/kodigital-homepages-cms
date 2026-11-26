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
  const batch = db.batch.bind(db);
  const batchMembers = new WeakMap<D1PreparedStatement, D1PreparedStatement>();
  db.batch = async <T>(statements: D1PreparedStatement[]) => {
    await send(`D1 batch (${statements.length} statements)`);
    return batch<T>(statements.map(stmt => batchMembers.get(stmt)!));
  };
  db.prepare = (query) => {
    const stmt = prepare(query);
    const { first, all, run } = stmt; // harness bind() returns this same statement
    // Native D1 runs the batch in one call and returns the rows of its SELECTs.
    batchMembers.set(stmt, { bind: stmt.bind, raw: stmt.raw, first, all, run: /^\s*(?:WITH|SELECT)\b/i.test(query) ? all : run });
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

// Complete output bytes from 19bc4063 under TZ=UTC, with the attempt kickoff, end-screen CSS
// and v18 runtime URL. The shell includes the 1fe503ca head script and retry.
// Store them losslessly in this test so parity also covers omitted fields and key order.
const original = {
  bundle:
    "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",
  shell:
    "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",
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
  let expected = gunzipSync(Buffer.from(original[kind], "base64")).toString("utf8");
  if (kind === "bundle") {
    // The shell definition no longer stores an attempt's signing inputs.
    const { bindings, ...definition } = JSON.parse(expected);
    expect(bindings).toHaveProperty("auction_config_version");
    expected = JSON.stringify(definition);
  }
  expect(bytes).toBe(expected);
  expect(rounds.length).toBeLessThanOrEqual(3);
  // An attempt's primary batch overlaps the definition read on a cold miss.
  expect(rounds.map(round => round.length)).toEqual(kind === "attempt" ? [2, 2] : [1, 2]);
  if (kind === "attempt") expect(rounds[0]).toContain("D1 batch (3 statements)");
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
  expect(rounds.map(round => round.length)).toEqual([1, 1, 2]);
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
