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
// and v16 runtime preload. The shell includes the 1fe503ca head script and retry.
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
