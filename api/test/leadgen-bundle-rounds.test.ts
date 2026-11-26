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
