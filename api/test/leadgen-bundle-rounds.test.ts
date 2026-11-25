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

// Complete output bytes from 19bc4063 under TZ=UTC, with the attempt kickoff
// and the runtime URL updated to v17. The shell includes the 1fe503ca head script and retry.
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
