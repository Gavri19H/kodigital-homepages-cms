import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { FunnelAttempt } from "../src/public/leadgen/attempt";
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
  const bundleReads: ({ rules: boolean; template: boolean; directPages: boolean } | null)[] = [];
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
  const members = new WeakMap<D1PreparedStatement, { query: string; stmt: D1PreparedStatement }>();
  db.batch = async <T>(statements: D1PreparedStatement[]) => {
    const entries = statements.map(stmt => members.get(stmt)!);
    await Promise.all(entries.map(entry => send(entry.query)));
    return batch<T>(entries.map(entry => entry.stmt));
  };
  db.prepare = (query) => {
    const stmt = prepare(query);
    const { first, all, run } = stmt; // harness bind() returns this same statement
    // Native D1 returns each SELECT's rows in the single batch reply.
    members.set(stmt, { query, stmt: {
      bind: stmt.bind, raw: stmt.raw, first, all, run: /^\s*(?:WITH|SELECT)\b/i.test(query) ? all : run,
    } });
    stmt.first = async <T>(column?: string) => {
      await send(query);
      return column === undefined ? first<T>() : first<T>(column);
    };
    stmt.all = async <T>() => {
      await send(query);
      const result = await all<T>();
      if (query.includes("AS bundle_row")) {
        const header = (result.results as { id: number | null; bundle_row: string }[]).find(row => row.id !== null);
        if (header) {
          const data = JSON.parse(header.bundle_row) as {
            rules: unknown[] | null; pages: { id: number; quote_id: number | null }[]; slots: { page_id: number }[];
          };
          const slotted = new Set(data.slots.map(slot => slot.page_id));
          bundleReads.push({
            rules: query.includes("FROM leadgen_quote_routing_rules") && data.rules !== null,
            template: query.includes("leadgen_frame_templates"),
            directPages: query.includes("WHERE fvs.page_id") && data.pages.some(p => p.quote_id !== null && !slotted.has(p.id)),
          });
        } else {
          bundleReads.push(null);
        }
      }
      return result;
    };
    stmt.run = async <T>() => { await send(query); return run<T>(); };
    return stmt;
  };
  return { db, rounds, bundleReads };
}

let sql: SqliteDb;
let trace: ReturnType<typeof measure>;
beforeEach(() => {
  const DatabaseSync = loadDatabaseSync();
  if (!DatabaseSync) throw new Error("node:sqlite is required to measure the public routes");
  vi.useFakeTimers({ toFake: ["Date"], now });
  vi.spyOn(crypto, "getRandomValues").mockImplementation((bytes) => {
    if (bytes instanceof Uint8Array) bytes.fill(7);
    return bytes;
  });
  sql = createLeadgenDb(DatabaseSync);
  seed(sql);
  trace = measure(sql);
});
afterEach(() => {
  sql.close();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function request(url: string, edgeVariant?: string) {
  const { kv, store } = makeKvStub();
  Object.assign(kv, { async getWithMetadata(key: string) { return { value: store.get(key) ?? null, metadata: null }; } });
  const env = buildLeadgenEnv(trace.db, kv, { extra: edgeVariant ? { EDGE_INNER: "1" } : {} });
  const h = new Headers(headers);
  if (edgeVariant) h.set("x-cms-variant", "lg:" + edgeVariant);
  return leadgenRouter.request(Object.assign(new Request(url, { headers: h }), { cf: { regionCode: "CA" } }), undefined, env);
}

function counts() {
  const statements = trace.rounds.flat();
  // Count one call for the joined statement and the definitions it actually
  // returned. A rejected activation returns no header. An omitted rule read
  // returns null and a completed empty rule read returns [].
  const individual = statements.filter(s => !s.includes("AS bundle_row"));
  const readsOf = (fragment: string) => individual.filter(s => s.includes(fragment)).length;
  const served = trace.bundleReads.filter(row => row !== null);
  return {
    statements: statements.length,
    rounds: trace.rounds.length,
    rules: readsOf("FROM leadgen_quote_routing_rules") + served.filter(row => row.rules).length,
    templates: readsOf("leadgen_frame_templates") + served.filter(row => row.template).length,
    directPages: readsOf("WHERE fvs.page_id") + served.filter(row => row.directPages).length,
    writes: individual.filter(s => /\b(?:INSERT|UPDATE|DELETE|REPLACE)\b/i.test(s)).length,
  };
}

function digest(body: string) {
  return createHash("sha256").update(body).digest("hex");
}

// Pin the full visitor and edge-selected shells, including the early attempt
// kickoff, v17 runtime retry and inline vitals beacon. At 7dfb84fc the visitor shell took 22 statements / 22
// rounds, the edge-selected shell 20 / 20 and the signed attempt 23 / 23.
const visitorHtmlHash = "1e15e0a07bd87ea61c4285e03bf74ee572a738762541f364288ca5fe3afed5f2";
it.each([
  { path: "visitor", sha256: visitorHtmlHash, statements: 19, rounds: 8, rules: 1 },
  { path: "lg:", sha256: "d98fbcd610e26937b1d507832e6712483fc20e90f6ce83f419b6caf806f4d871",
    statements: 4, rounds: 3, rules: 0 },
])("serves the pinned cold $path shell", async ({ path, sha256, statements, rounds, rules }) => {
  const res = await request(landing, path === "lg:" ? publicId("lgn", 2) : undefined);
  expect(res.status).toBe(200);
  const html = await res.text();
  expect(html).toContain("Talk to us");
  expect(html).toContain(path === "visitor" ? "window.__LG_ASSIGNMENT__=" : "<!--LG_ASSIGN-->");
  expect(digest(html)).toBe(sha256);
  expect(counts()).toEqual({ statements, rounds, rules, templates: 1, directPages: 1, writes: 0 });
});

it("loads only the serving quote's rules and template after a stale lg: selection", async () => {
  sql.prepare(`INSERT INTO leadgen_quotes (id, public_id, quote_name, activity, verticals_json, status)
    VALUES (2, ?, 'Neighbor', 'quote_funnel', '["life"]', 'active')`).run(publicId("lgq", 2));
  sql.prepare("INSERT INTO leadgen_site_quotes (site_id, quote_id, enabled, slug) VALUES ('site-1', 2, 1, 'neighbor')").run();
  sql.prepare(`INSERT INTO leadgen_funnels (id, public_id, funnel_name, quote_id, status, frame_template_id)
    VALUES (2, ?, 'Other template', 2, 'active', 2)`).run(publicId("lgf", 2));
  sql.prepare(`INSERT INTO leadgen_funnel_variants (id, public_id, funnel_id, variant_label, traffic_allocation_bp)
    VALUES (3, ?, 2, 'A', 10000)`).run(publicId("lgn", 3));
  const templateIds: number[] = [];
  if (typeof sql.function !== "function") throw new Error("SQLite read observation required");
  sql.function("observe_frame", (id: number, frame: string) => { templateIds.push(id); return frame; });
  sql.prepare("ALTER TABLE leadgen_frame_templates RENAME TO stored_templates").run();
  sql.prepare(`CREATE VIEW leadgen_frame_templates AS
    SELECT id, observe_frame(id, frame_json) AS frame_json FROM stored_templates`).run();
  const res = await request(landing, publicId("lgn", 3));
  expect(res.status).toBe(200);
  expect(digest(await res.text())).toBe(visitorHtmlHash);
  expect(trace.bundleReads).toEqual([null]);
  expect(templateIds).toEqual([1]);
  expect(counts()).toMatchObject({ rules: 1, templates: 1, directPages: 1, writes: 0 });
});

const attemptUrl = origin + "/lg/attempt?vid=" + publicId("lgn", 2) + "&u=" + encodeURIComponent(landing);
it("mints the original signed attempt and persists its entry outcome", async () => {
  const res = await request(attemptUrl);
  expect(res.status).toBe(200);
  const body = await res.text();
  expect(digest(body)).toBe("ab0f17e37ce81ca7436d654f3d2ab577c2615ec17b90d9b2cc6e085cf457f3f4");
  const attempt = JSON.parse(body) as FunnelAttempt;
  expect(attempt.cc).toEqual(["mobile_line"]);
  expect(attempt.cps).toEqual([publicId("lgs", 3)]);
  expect(attempt.page_plan?.map((slot) => slot.section_public_id)).toEqual([1, 2, 3, 4, 42].map((id) => publicId("lgs", id)));
  expect(sql.prepare("SELECT * FROM leadgen_routing_outcomes").all()).toEqual([{
    funnel_attempt_id: "att_01KF0RDQG00W3GE1R70W3GE1R7",
    session_id: sid, routed_from_variant: null, routed_to_variant: publicId("lgn", 2), routed_to_funnel: publicId("lgf", 1),
    matched_rule_hash: "paid", value_multiplier: 1.75, feed_name: "paid_life", plane: "entry", created_at: now / 1000, force_offer_id: null,
  }]);
  expect(counts()).toEqual({ statements: 6, rounds: 3, rules: 1, templates: 1, directPages: 1, writes: 1 });
  expect(trace.rounds.map(round => round.length)).toEqual([1, 4, 1]);
});

it("honors the entry redirect using the same rules as funnel selection", async () => {
  const res = await request(origin + "/lg/life?utm_source=partner");
  expect(res.status).toBe(302);
  expect(res.headers.get("Location")).toBe(redirect);
  expect(await res.text()).toBe("");
  expect(counts()).toEqual({ statements: 17, rounds: 7, rules: 1, templates: 1, directPages: 1, writes: 0 });
});

it("reuses an empty rule set and null template defaults", async () => {
  sql.prepare("UPDATE leadgen_quote_routing_rules SET status = 'disabled'").run();
  sql.prepare("UPDATE leadgen_frame_templates SET frame_json = '{broken' WHERE id = 1").run();
  const res = await request(attemptUrl);
  expect(res.status).toBe(200);
  const attempt = await res.json() as FunnelAttempt;
  expect(attempt.cc).toBeUndefined();
  expect(attempt.cps).toBeUndefined();
  expect(counts()).toMatchObject({ rules: 1, templates: 1, writes: 0 });
});

it("reads direct sections in page and position order above D1's 100-binding limit", async () => {
  sql.prepare("UPDATE leadgen_funnel_variant_sections SET position = 5 WHERE id = 1").run();
  const addPage = sql.prepare("INSERT INTO leadgen_funnel_pages (id, public_id, quote_id, position) VALUES (?, ?, 1, ?)");
  const attach = sql.prepare("INSERT INTO leadgen_funnel_variant_sections (page_id, section_id, position, quote_id) VALUES (?, 4, ?, 1)");
  for (let id = 100; id <= 200; id++) {
    addPage.run(id, publicId("lgpg", id), id);
    attach.run(id, id);
  }
  const res = await request(attemptUrl);
  expect(res.status).toBe(200);
  const { page_plan } = await res.json() as FunnelAttempt;
  expect(page_plan?.slice(0, 2).map((slot) => slot.section_public_id)).toEqual([publicId("lgs", 2), publicId("lgs", 1)]);
  expect(page_plan?.map((slot) => slot.page_id)).toEqual([
    30, 30, 10, 20, ...Array.from({ length: 101 }, (_, i) => 100 + i), 42,
  ].map((id) => publicId("lgpg", id)));
  expect(counts()).toEqual({ statements: 6, rounds: 3, rules: 1, templates: 1, directPages: 1, writes: 1 });
});
