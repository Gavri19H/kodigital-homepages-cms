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

// Complete output bytes from 19bc4063, generated under TZ=UTC before batching.
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
