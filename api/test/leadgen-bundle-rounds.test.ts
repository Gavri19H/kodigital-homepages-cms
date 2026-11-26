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
