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
