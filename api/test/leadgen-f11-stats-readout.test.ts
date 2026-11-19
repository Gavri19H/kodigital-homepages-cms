// F11 — the written (never applied) ClickHouse change and the how-to's
// read-out query (plan Section 3 E/F, Section 6 red lines, Section 8;
// backlog/CONTRACT-F11.md tasks 11 and 14).
//
//   * the repo's ClickHouse file (docs/leadgen/contract/infra/clickhouse-ddl.sql,
//     vendored byte-identical at infra/leadgen/clickhouse-ddl.sql) has the new
//     lg_events_raw.click_source, lg_offer_daily.redirect_clicks, and the
//     lg_offer_daily_mv sum;
//   * the S3 loader (analytics/event-loader.ts) fills the new column by name
//     once it exists, and simply doesn't send it before — so it needs no
//     change (pure compatibility checks: these two pass before F11 too);
//   * the one-time change script is add-only: two ADD COLUMN IF NOT EXISTS
//     and the view re-created with exactly one added line — every other line
//     of the view is the pre-F11 text; no row is changed or deleted; its
//     header says to apply it only with the owner's go, after reading the
//     live view;
//   * the how-to exists in the CMS docs and its ONE read-only query runs on
//     the real D1 schema and gives the right "opened" / "held back" numbers.
// Nothing here connects to ClickHouse.

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mintPublicId } from "../src/leadgen/ids";
import { blankLeadgenEvent } from "../src/analytics/leadgen-events";
import { mapRecordToRow } from "../src/analytics/event-loader";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const REPO = join(TEST_DIR, "..", "..");
const DDL = join(REPO, "docs/leadgen/contract/infra/clickhouse-ddl.sql");
const DDL_VENDORED = join(REPO, "infra/leadgen/clickhouse-ddl.sql");
const CHANGE = join(REPO, "docs/leadgen/contract/infra/changes/2026-11-f11-redirect-clicks.sql");
const HOWTO = join(REPO, "docs/leadgen/how-to/redirect-after-offer-shown.md");

const read = (p: string): string => (existsSync(p) ? readFileSync(p, "utf8") : "");

// SQL without comments, whitespace collapsed (so formatting never decides).
function code(sql: string): string {
  return sql
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function statement(sql: string, startsWith: string): string {
  const flat = code(sql);
  const at = flat.indexOf(startsWith);
  if (at === -1) return "";
  const end = flat.indexOf(";", at);
  return flat.slice(at, end === -1 ? flat.length : end + 1);
}

const REDIRECT_SUM = "sumIf(1,e.event_type IN ('offer_click','carrier_click') AND e.click_source='redirect') AS redirect_clicks,";

// lg_offer_daily_mv exactly as it was before F11 (the base commit's DDL).
const PRE_F11_VIEW = code(`CREATE MATERIALIZED VIEW IF NOT EXISTS lg_offer_daily_mv REFRESH EVERY 2 MINUTE TO lg_offer_daily AS
SELECT e.offer_id AS offer_id, e.dt AS dt, sumIf(1,e.event_type='offer_impression') AS offer_impressions,
  sumIf(1,e.event_type IN ('offer_click','carrier_click')) AS clicks, uniqExactIf(e.session_id,e.event_type IN ('offer_click','carrier_click')) AS unique_clicks,
  COALESCE(r.conversions,0) AS conversions, COALESCE(r.revenue,0) AS revenue, now() AS synced_at
FROM lg_events_raw AS e FINAL LEFT JOIN (SELECT offer_id,dt,SUM(conversions) conversions,SUM(revenue) revenue FROM lg_revenue_attributed FINAL GROUP BY offer_id,dt) AS r ON e.offer_id=r.offer_id AND e.dt=r.dt
WHERE notEmpty(e.offer_id) AND e.traffic_quality_flag='clean' GROUP BY e.offer_id,e.dt,r.conversions,r.revenue;`);

describe("the repo's ClickHouse file", () => {
  const ddl = read(DDL);

  it("lg_events_raw has click_source, empty by default (every past click reads as a visitor click)", () => {
    const table = statement(ddl, "CREATE TABLE IF NOT EXISTS lg_events_raw");
    expect(table).toContain("click_source LowCardinality(String) DEFAULT ''");
  });

  it("lg_offer_daily has redirect_clicks", () => {
    const table = statement(ddl, "CREATE TABLE IF NOT EXISTS lg_offer_daily ");
    expect(table).toMatch(/\bredirect_clicks UInt64\b/);
  });

  it("lg_offer_daily_mv sums the redirect clicks the way it counts clicks, and is otherwise unchanged", () => {
    const view = statement(ddl, "CREATE MATERIALIZED VIEW IF NOT EXISTS lg_offer_daily_mv");
    expect(view).toContain(code(REDIRECT_SUM));
    expect(view.replace(` ${code(REDIRECT_SUM)}`, "")).toBe(PRE_F11_VIEW);
  });

  it("the vendored copy (infra/leadgen) stays byte-identical to the contract file", () => {
    expect(ddl).not.toBe("");
    expect(read(DDL_VENDORED)).toBe(ddl);
  });
});

describe("the S3 → ClickHouse loader needs no change (it fills columns by name from the live table)", () => {
  // A redirect click event as click.ts emits it (only the fields that matter here).
  const event = blankLeadgenEvent("offer_click", 1_790_000_000_000);
  event.event_id = "evt-1";
  event.click_source = "redirect";
  const record = event as unknown as Record<string, unknown>;

  it("once lg_events_raw has click_source, the loader fills it from the event's field of the same name", () => {
    const row = mapRecordToRow(record, new Map([["event_id", "String"], ["event_type", "LowCardinality(String)"], ["click_source", "LowCardinality(String)"]]), {}, "event");
    expect(row).toMatchObject({ event_id: "evt-1", event_type: "offer_click", click_source: "redirect" });
  });

  it("before the ClickHouse change, the field is simply not sent (the insert never fails because of it)", () => {
    const row = mapRecordToRow(record, new Map([["event_id", "String"], ["event_type", "LowCardinality(String)"]]), {}, "event");
    expect(row).not.toHaveProperty("click_source");
  });
});

describe("the one-time ClickHouse change script (written, not applied)", () => {
  const script = read(CHANGE);
  const body = code(script);

  it("exists next to the ClickHouse file", () => {
    expect(script).not.toBe("");
  });

  it("adds the two columns, add-only and safe to re-run", () => {
    expect(body).toContain("ALTER TABLE lg_events_raw ADD COLUMN IF NOT EXISTS click_source LowCardinality(String) DEFAULT ''");
    expect(body).toContain("ALTER TABLE lg_offer_daily ADD COLUMN IF NOT EXISTS redirect_clicks UInt64 DEFAULT 0");
  });

  it("re-creates lg_offer_daily_mv with the redirect sum — the same text as the repo's ClickHouse file — after the columns exist", () => {
    const view = statement(script, "CREATE MATERIALIZED VIEW IF NOT EXISTS lg_offer_daily_mv");
    expect(view).toBe(statement(read(DDL), "CREATE MATERIALIZED VIEW IF NOT EXISTS lg_offer_daily_mv"));
    expect(view.replace(` ${code(REDIRECT_SUM)}`, "")).toBe(PRE_F11_VIEW);
    expect(body.indexOf("ADD COLUMN IF NOT EXISTS redirect_clicks")).toBeLessThan(body.indexOf("DROP VIEW IF EXISTS lg_offer_daily_mv"));
    expect(body.indexOf("ADD COLUMN IF NOT EXISTS click_source")).toBeLessThan(body.indexOf("DROP VIEW IF EXISTS lg_offer_daily_mv"));
    expect(body.indexOf("DROP VIEW IF EXISTS lg_offer_daily_mv")).toBeLessThan(body.indexOf("CREATE MATERIALIZED VIEW"));
  });

  it("changes and deletes no rows, drops no table or column, and touches no other object", () => {
    expect(body).not.toMatch(/\b(DELETE|TRUNCATE|UPDATE|INSERT|RENAME|MODIFY|DETACH|OPTIMIZE)\b/i);
    expect(body).not.toMatch(/DROP\s+(TABLE|COLUMN|DATABASE)/i);
    const drops = body.match(/DROP VIEW IF EXISTS \w+/g) ?? [];
    expect(drops).toEqual(["DROP VIEW IF EXISTS lg_offer_daily_mv"]);
    const statements = body.split(";").map((s) => s.trim()).filter((s) => s !== "");
    expect(statements).toHaveLength(4);
  });

  it("its header says: only with the owner's go, read the live view first and keep the rest the same", () => {
    expect(script).toMatch(/OWNER'S GO/);
    expect(script).toContain("SHOW CREATE TABLE lg_offer_daily_mv");
    expect(script).toMatch(/keep everything else in it the same/i);
    expect(script).toMatch(/No row is changed or deleted/);
  });
});

// ---------------------------------------------------------------------------
// the how-to + its read-out query, run on the real D1 schema
// ---------------------------------------------------------------------------

type SqliteStatement = { run(...p: unknown[]): unknown; get(...p: unknown[]): unknown; all(...p: unknown[]): unknown[] };
type SqliteDb = { prepare(sql: string): SqliteStatement; [m: string]: unknown };
type DatabaseSyncCtor = new (path: string) => SqliteDb;

function loadDatabaseSync(): DatabaseSyncCtor | null {
  try {
    const { createRequire } = require("node:module") as typeof import("node:module");
    const nodeRequire = createRequire(import.meta.url);
    return (nodeRequire("node:sqlite") as { DatabaseSync: DatabaseSyncCtor }).DatabaseSync;
  } catch {
    try {
      const getBuiltin = (process as unknown as { getBuiltinModule?: (n: string) => unknown }).getBuiltinModule;
      if (typeof getBuiltin === "function") return (getBuiltin("node:sqlite") as { DatabaseSync: DatabaseSyncCtor }).DatabaseSync;
    } catch {
      /* fall through */
    }
    return null;
  }
}

const DatabaseSync = loadDatabaseSync();
const describeDb = DatabaseSync === null ? describe.skip : describe;

const MIGRATIONS = [
  "0036_leadgen_core.sql",
  "0037_leadgen_analytics_mirror.sql",
  "0038_leadgen_revenue_infra.sql",
  "0039_leadgen_conversion_dedupe.sql",
  "0040_leadgen_runtime_context.sql",
  "0041_leadgen_frame_theme.sql",
  "0042_leadgen_pages.sql",
  "0043_leadgen_routing_rules.sql",
  "0044_leadgen_redirect_pct.sql",
  "0045_leadgen_persona_quota.sql",
  "0046_leadgen_rework_m1_variants.sql",
  "0047_leadgen_rework_m2_shared_pages.sql",
  "0048_leadgen_rework_m3_routing.sql",
  "0049_leadgen_rework_m4_m5_defaults_templates.sql",
  "0050_leadgen_rework_m6_grid_expansion.sql",
  "0051_leadgen_rework_m7_slider_collapse.sql",
  "0052_leadgen_rework_m9_address_fields.sql",
  "0053_leadgen_rework_m12_othergroup_retirement.sql",
  "0062_leadgen_auction_waterfalls.sql",
  "0066_leadgen_redirect_after_shown.sql",
] as const;

function docBlock(marker: string): string {
  const doc = read(HOWTO);
  const block = new RegExp(`<!-- ${marker}:start -->\\s*\`\`\`sql\\n([\\s\\S]*?)\`\`\`\\s*<!-- ${marker}:end -->`).exec(doc);
  return block?.[1] ?? "";
}
const readoutQuery = (): string => docBlock("f11-readout-query"); // step 1 (D1)
const step2aQuery = (): string => docBlock("f11-step2a-query"); // step 2a (D1)
const step2bQuery = (): string => docBlock("f11-step2b-query"); // step 2b (ClickHouse)

// A statement that writes anything (SQLite or ClickHouse). The read-out only reads.
const WRITES = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|PRAGMA|ATTACH|DETACH|TRUNCATE|RENAME|OPTIMIZE|SYSTEM|KILL|GRANT)\b|\bREPLACE\s+INTO\b/i;

// The ClickHouse table's real columns, read from the repo's ClickHouse file.
function chColumns(table: string): Set<string> {
  const body = statement(read(DDL), `CREATE TABLE IF NOT EXISTS ${table} (`);
  return new Set([...body.matchAll(/[(,]\s*(\w+) (?:String|LowCardinality|UInt\d+|Int\d+|Float\d+|Date|DateTime)\b/g)].map((m) => m[1]!));
}

describe("the how-to in the CMS docs", () => {
  const doc = read(HOWTO);

  it("covers setting up and editing an \"After the offer is shown\" rule, the 50% / 2-week tip, and \"Only the animation\"", () => {
    expect(doc).not.toBe("");
    for (const text of [
      '"Funnel eligibility rules"',
      '"+ New rule"',
      '"Redirect to offer"',
      '"When to redirect"',
      '"After the offer is shown"',
      '"Show the offer for (seconds)"',
      '"Redirect %"',
      '"Edit"',
      '"Only the animation"',
      "50%",
      "2 weeks",
      '"opened"',
      '"held back"',
      "partners who have agreed",
    ]) {
      expect(doc, text).toContain(text);
    }
  });

  it("the read-out is two read-only steps: step 1 (D1), step 2a (D1) and step 2b (ClickHouse), and none of them writes", () => {
    expect((read(HOWTO).match(/```sql/g) ?? []).length).toBe(3);
    for (const [name, q] of [["step 1", readoutQuery()], ["step 2a", step2aQuery()], ["step 2b", step2bQuery()]] as const) {
      expect(q, name).not.toBe("");
      expect(code(q), name).not.toMatch(WRITES);
      expect(code(q).split(";").filter((x) => x.trim() !== ""), `${name} is one statement`).toHaveLength(1);
    }
    expect(readoutQuery()).toContain("leadgen_auction_result_log");
    expect(step2aQuery()).toContain("leadgen_auction_result_log");
    expect(step2bQuery()).toContain("FROM lg_events_raw AS e FINAL");
    // 2b stops with an error until the 2a list is pasted in (never a silent empty answer).
    expect(step2bQuery()).toContain("PASTE_STEP_2A_LIST_HERE");
  });

  it("step 2's link is a real shared column: funnel_attempt_id is on the D1 results-log row AND on every ClickHouse click event; lead payments name their click", () => {
    const ch = chColumns("lg_events_raw");
    for (const col of ["funnel_attempt_id", "click_id", "event_type", "revenue", "bid_currency", "traffic_quality_flag"]) {
      expect(ch.has(col), `lg_events_raw.${col}`).toBe(true);
    }
    // the two halves are joined on the funnel attempt id — the only visitor key both sides carry
    expect(step2aQuery()).toContain("r.funnel_attempt_id AS funnel_attempt_id");
    expect(step2bQuery()).toContain("e.funnel_attempt_id IN (SELECT funnel_attempt_id FROM rule_visitors)");
    expect(step2bQuery()).toContain("ON r.click_id = c.click_id");
    expect(step2bQuery()).toContain("r.event_type = 'revenue_received'");
  });

  it("step 2b names only real columns: every lg_events_raw column is in the repo's ClickHouse file, every other one is made inside the query", () => {
    const q = code(step2bQuery());
    const ch = chColumns("lg_events_raw");
    // alias -> the columns it really has
    const cols = new Map<string, Set<string>>();
    const add = (alias: string, set: Set<string>) => cols.set(alias, new Set([...(cols.get(alias) ?? []), ...set]));
    // VALUES('a String, b String', …) AS v
    for (const m of q.matchAll(/VALUES\('([^']*)',[^)]*\) AS (\w+)/g)) {
      add(m[2]!, new Set(m[1]!.split(",").map((part) => part.trim().split(" ")[0]!)));
    }
    // each WITH block's output columns = the `AS name` aliases of its SELECT list
    const ctes = new Map<string, Set<string>>();
    for (const m of q.matchAll(/(\w+) AS \(\s*SELECT ([\s\S]*?) FROM /g)) {
      ctes.set(m[1]!, new Set([...m[2]!.matchAll(/ AS (\w+)/g)].map((a) => a[1]!)));
    }
    expect([...ctes.keys()].sort()).toEqual(["money_rows", "per_visitor", "rule_visitors", "visitor_clicks"]);
    for (const m of q.matchAll(/(?:FROM|JOIN) (\w+) AS (\w+)/g)) {
      const table = m[1]!;
      add(m[2]!, table === "lg_events_raw" ? ch : (ctes.get(table) ?? new Set()));
    }
    const refs = [...q.matchAll(/\b([a-z])\.(\w+)\b/g)].map((m) => [m[1]!, m[2]!] as const);
    expect(refs.length).toBeGreaterThan(15);
    for (const [alias, col] of refs) {
      expect(cols.has(alias), `alias ${alias}`).toBe(true);
      expect(cols.get(alias)!.has(col), `${alias}.${col}`).toBe(true);
    }
    // the bare names read from a WITH block are that block's own columns
    for (const m of q.matchAll(/SELECT (\w+) FROM (\w+)\)/g)) {
      expect(ctes.get(m[2]!)?.has(m[1]!), `${m[2]}.${m[1]}`).toBe(true);
    }
  });
});

// One "After the offer is shown" rule over 14 days: 4 "opened", 4 "held back",
// 1 "no card"; one visitor coming Back later, one visitor outside the window,
// and one results page with no "After" rule.
function seedReadoutScenario(): { sdb: SqliteDb; rulePub: string } {
    const Ctor = DatabaseSync as unknown as new (p: string, o?: { enableForeignKeyConstraints?: boolean }) => SqliteDb;
    const sdb = new Ctor(":memory:", { enableForeignKeyConstraints: false });
    (sdb["exec"] as (s: string) => void)("CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT);CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT);");
    for (const f of MIGRATIONS) (sdb["exec"] as (s: string) => void)(readFileSync(join(TEST_DIR, "../migrations", f), "utf8"));

    const offer = (name: string, type: string): { id: number; pub: string } => {
      const pub = mintPublicId("offer");
      sdb
        .prepare(
          `INSERT INTO leadgen_offers (public_id, offer_name, provider, activity, vertical, conversion_tracking_method, offer_type,
             calls_provider_api, bid_source, request_execution_mode, banner_url_template, static_bid_value, static_bid_currency, cap_enabled, status)
           VALUES (?, ?, 'Sample Provider', 'leadgen', 'Loans', 's2s_postback', ?, 0, 'static', 'server', 'https://partner.example/go', 1, 'USD', 0, 'active')`,
        )
        .run(pub, name, type);
      return { id: (sdb.prepare("SELECT id FROM leadgen_offers WHERE public_id = ?").get(pub) as { id: number }).id, pub };
    };
    const chosen = offer("Chosen CPC Offer", "cpc");
    const other = offer("Other CPC Offer", "cpc");
    const lead = offer("Per-lead Offer", "cpl");
    const rulePub = mintPublicId("funnel_rule");
    sdb
      .prepare(
        "INSERT INTO leadgen_funnel_rules (public_id, variant_id, rule_type, conditions_json, conditions_hash, target_offer_id, priority, rule_name, redirect_pct, redirect_show_seconds) VALUES (?, 1, 'redirect_direct_offer', '{}', 'h', ?, 1, 'Open the chosen offer', 50, 5)",
      )
      .run(rulePub, chosen.id);

    const now = Math.floor(Date.now() / 1000);
    const cards = (...offers: Array<{ pub: string; bid: number }>) =>
      JSON.stringify(offers.map((o, i) => ({ carrier_key: "", offer_id: o.pub, bid: o.bid, slot: i + 1 })));
    let n = 0;
    const auction = (attempt: string, outcome: string | null, shown: string, at = now) => {
      n += 1;
      sdb
        .prepare(
          "INSERT INTO leadgen_auction_result_log (auction_instance_id, auction_result_id, auction_config_id, funnel_attempt_id, carriers_shown_json, redirect_json, created_at) VALUES (?, ?, 'lga_x', ?, ?, ?, ?)",
        )
        .run(`aiid-${n}`, `ares-${n}`, attempt, shown, outcome === null ? null : JSON.stringify({ rule_id: rulePub, offer_id: chosen.pub, outcome }), at);
    };
    const click = (attempt: string, offerId: number) =>
      sdb.prepare("INSERT INTO leadgen_session_clicked_offers (funnel_attempt_id, offer_id, carrier_key) VALUES (?, ?, '')").run(attempt, offerId);

    const withCard = cards({ pub: chosen.pub, bid: 30 }, { pub: other.pub, bid: 10 }, { pub: lead.pub, bid: 200 });
    // "opened": 4 visitors, 3 click the chosen card; att_o1 also clicks the other CPC card.
    for (const a of ["att_o1", "att_o2", "att_o3", "att_o4"]) auction(a, "opened", withCard, now - 100);
    click("att_o1", chosen.id);
    click("att_o1", other.id);
    click("att_o2", chosen.id);
    click("att_o3", chosen.id);
    // att_o1 came Back and got a later results page: the visitor still counts once, as "opened".
    auction("att_o1", "no_card", cards({ pub: other.pub, bid: 10 }), now - 50);
    // "held back": 4 visitors, 2 click the chosen card; one clicks the per-lead card (no click money).
    for (const a of ["att_h1", "att_h2", "att_h3", "att_h4"]) auction(a, "held_back", withCard, now - 100);
    click("att_h1", chosen.id);
    click("att_h2", chosen.id);
    click("att_h3", lead.id);
    // "no card": the chosen Offer had no card.
    auction("att_n1", "no_card", cards({ pub: other.pub, bid: 10 }), now - 100);
    click("att_n1", other.id);
    // Outside the window, and a page with no "After" rule: not counted.
    auction("att_old", "opened", withCard, now - 30 * 86400);
    click("att_old", chosen.id);
    auction("att_plain", null, withCard, now - 100);
    return { sdb, rulePub };
}

describeDb("the how-to's read-out queries on the real D1 schema", () => {
  it("step 1 splits a rule into 'opened' / 'held back' / 'no card': click rate on the chosen card and click money per visitor", () => {
    const { sdb } = seedReadoutScenario();
    const rows = sdb.prepare(readoutQuery()).all() as Array<Record<string, unknown>>;
    expect(rows).toEqual([
      {
        rule: "Open the chosen offer",
        offer: "Chosen CPC Offer",
        half: "held back",
        visitors: 4,
        visitors_with_card: 4,
        clicked_the_card: 2,
        card_click_rate_pct: 50,
        click_money_per_visitor_usd: 15, // (30 + 30) / 4
      },
      {
        rule: "Open the chosen offer",
        offer: "Chosen CPC Offer",
        half: "no card",
        visitors: 1,
        visitors_with_card: 0,
        clicked_the_card: 0,
        card_click_rate_pct: null,
        click_money_per_visitor_usd: null,
      },
      {
        rule: "Open the chosen offer",
        offer: "Chosen CPC Offer",
        half: "opened",
        visitors: 4,
        visitors_with_card: 4,
        clicked_the_card: 3,
        card_click_rate_pct: 75,
        click_money_per_visitor_usd: 25, // (30 + 10 + 30 + 30) / 4
      },
    ]);
  });

  it("step 2a lists the rule's 'opened' and 'held back' visitors once each, in the shape step 2b's VALUES takes (by rule name or rule id)", () => {
    const { sdb, rulePub } = seedReadoutScenario();
    const run = (rule: string): string | null =>
      (sdb.prepare(step2aQuery().split("PUT THE RULE NAME HERE").join(rule)).get() as { paste_into_step_2b: string | null }).paste_into_step_2b;
    const list = run("Open the chosen offer");
    expect(list).toMatch(/^\('[^']+', '(opened|held back)'\)(, \('[^']+', '(opened|held back)'\))*$/);
    const tuples = (list ?? "").split("), (").map((t) => t.replace(/[()']/g, "")).sort();
    expect(tuples).toEqual([
      "att_h1, held back",
      "att_h2, held back",
      "att_h3, held back",
      "att_h4, held back",
      "att_o1, opened",
      "att_o2, opened",
      "att_o3, opened",
      "att_o4, opened",
    ]);
    expect(run(rulePub)).toBe(list);
    expect(run("Some other rule")).toBeNull();
  });
});
