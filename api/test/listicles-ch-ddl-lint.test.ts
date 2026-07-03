// Listicles Phase 8 — ClickHouse DDL structural lint (§17/§31.8). Parses
// infra/listicles/clickhouse-ddl.sql and asserts the schema is complete and
// convention-correct WITHOUT a live CH (the DDL is applied by the operator):
//   * 3 raw tables + revenue-attributed target/MV + 5 daily targets/MVs
//   * every target has a matching MV; every MV `REFRESH EVERY … TO <target>`
//   * every CREATE is IF NOT EXISTS
//   * every default-analytics MV filters traffic_quality_flag='clean' (§31.8)
//   * offer MV: WHERE notEmpty(offer_id) FOLLOWS the JOIN, never `= ''` (§17.3)
//   * no §1 banned tokens

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const DDL_PATH = join(TEST_DIR, "../../infra/listicles/clickhouse-ddl.sql");
const RAW = readFileSync(DDL_PATH, "utf8");

// Comment-stripped code (drop `-- …` to end-of-line) for structural parsing.
const CODE = RAW.split("\n")
  .map((l) => {
    const i = l.indexOf("--");
    return i >= 0 ? l.slice(0, i) : l;
  })
  .join("\n");

const STATEMENTS = CODE.split(";").map((s) => s.trim()).filter((s) => s.length > 0);
const TABLE_STMTS = STATEMENTS.filter((s) => /^CREATE\s+TABLE/i.test(s));
const MV_STMTS = STATEMENTS.filter((s) => /^CREATE\s+MATERIALIZED\s+VIEW/i.test(s));

function tableName(stmt: string): string {
  const m = stmt.match(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+(\w+)/i);
  return (m?.[1] ?? "").toLowerCase();
}
function mvNameAndTarget(stmt: string): { name: string; target: string } {
  const name = stmt.match(/CREATE\s+MATERIALIZED\s+VIEW\s+IF\s+NOT\s+EXISTS\s+(\w+)/i)?.[1] ?? "";
  const target = stmt.match(/\bTO\s+(\w+)\s+AS\b/i)?.[1] ?? stmt.match(/\bTO\s+(\w+)/i)?.[1] ?? "";
  return { name: name.toLowerCase(), target: target.toLowerCase() };
}

const TABLE_NAMES = new Set(TABLE_STMTS.map(tableName));
const MVS = MV_STMTS.map(mvNameAndTarget);

// The OUTER SELECT list of an MV: from `AS SELECT` to the first paren-depth-0
// FROM (so a subquery's own SELECT/FROM inside the JOIN is skipped).
function mvSelectList(mvStmt: string): string {
  const m = mvStmt.match(/\bAS\s+SELECT\b/i);
  if (!m || m.index === undefined) return "";
  const start = m.index + m[0].length;
  let depth = 0;
  for (let i = start; i < mvStmt.length; i++) {
    const ch = mvStmt[i];
    if (ch === undefined) continue;
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (depth === 0 && /\s/.test(ch) && /^\s+FROM\b/i.test(mvStmt.slice(i))) {
      return mvStmt.slice(start, i);
    }
  }
  return mvStmt.slice(start);
}

// Split a SELECT list into top-level items (commas at paren-depth 0).
function topLevelItems(list: string): string[] {
  const items: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of list) {
    if (ch === "(") { depth++; cur += ch; }
    else if (ch === ")") { depth--; cur += ch; }
    else if (ch === "," && depth === 0) { items.push(cur.trim()); cur = ""; }
    else cur += ch;
  }
  if (cur.trim() !== "") items.push(cur.trim());
  return items;
}

const RAW_TABLES = ["lst_events_raw", "lst_sessions", "lst_revenue_raw"];
const AGG_TARGETS = [
  "lst_revenue_attributed",
  "lst_offer_daily",
  "lst_section_daily",
  "lst_article_daily",
  "lst_drilldown_daily",
  "lst_link_instance_daily",
];
const EXPECTED_MVS = [
  "lst_revenue_attributed_mv",
  "lst_offer_daily_mv",
  "lst_section_daily_mv",
  "lst_article_daily_mv",
  "lst_drilldown_daily_mv",
  "lst_link_instance_daily_mv",
];

describe("CH DDL — completeness", () => {
  it("declares the 3 §17.1 raw tables", () => {
    for (const t of RAW_TABLES) expect(TABLE_NAMES.has(t)).toBe(true);
  });

  it("declares the revenue-attributed target + 5 daily targets", () => {
    for (const t of AGG_TARGETS) expect(TABLE_NAMES.has(t)).toBe(true);
  });

  it("declares the revenue MV + 5 daily MVs", () => {
    const names = new Set(MVS.map((m) => m.name));
    for (const mv of EXPECTED_MVS) expect(names.has(mv)).toBe(true);
    expect(MVS).toHaveLength(EXPECTED_MVS.length);
  });

  it("every aggregation target has a matching MV that writes TO it", () => {
    const targets = new Set(MVS.map((m) => m.target));
    for (const t of AGG_TARGETS) expect(targets.has(t)).toBe(true);
    // every MV target is a real table
    for (const m of MVS) expect(TABLE_NAMES.has(m.target)).toBe(true);
  });
});

describe("CH DDL — conventions", () => {
  it("every CREATE TABLE / MATERIALIZED VIEW is IF NOT EXISTS", () => {
    for (const s of TABLE_STMTS) expect(/^CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS/i.test(s)).toBe(true);
    for (const s of MV_STMTS) expect(/^CREATE\s+MATERIALIZED\s+VIEW\s+IF\s+NOT\s+EXISTS/i.test(s)).toBe(true);
  });

  it("every MV declares REFRESH EVERY", () => {
    for (const s of MV_STMTS) expect(/REFRESH\s+EVERY/i.test(s)).toBe(true);
  });

  it("every default-analytics MV filters traffic_quality_flag='clean' (§31.8)", () => {
    for (const s of MV_STMTS) {
      expect(/traffic_quality_flag\s*=\s*'clean'/i.test(s)).toBe(true);
    }
  });

  it("all six MVs REFRESH EVERY 2 MINUTE (§17.2/§17.3)", () => {
    for (const s of MV_STMTS) expect(/REFRESH\s+EVERY\s+2\s+MINUTE/i.test(s)).toBe(true);
  });

  it("uses ReplacingMergeTree + PARTITION BY toYYYYMM(dt) on every target", () => {
    for (const s of TABLE_STMTS) {
      expect(/ReplacingMergeTree\s*\(/i.test(s)).toBe(true);
      expect(/PARTITION\s+BY\s+toYYYYMM\(dt\)/i.test(s)).toBe(true);
    }
  });
});

describe("CH DDL — offer MV §17.3 counting rules", () => {
  const offerMv = MV_STMTS.find((s) => /lst_offer_daily_mv/i.test(s)) ?? "";

  it("offer MV exists and impressions come from offer_impression", () => {
    expect(offerMv).not.toBe("");
    expect(/sumIf\(1,\s*e\.event_type='offer_impression'\)/i.test(offerMv)).toBe(true);
  });

  it("WHERE notEmpty(offer_id) FOLLOWS the JOIN and is never `= ''`", () => {
    const joinIdx = offerMv.search(/LEFT\s+JOIN/i);
    const notEmptyIdx = offerMv.search(/notEmpty\(\s*e\.offer_id\s*\)/i);
    expect(joinIdx).toBeGreaterThanOrEqual(0);
    expect(notEmptyIdx).toBeGreaterThan(joinIdx); // WHERE follows the JOIN
    expect(/offer_id\s*=\s*''/i.test(offerMv)).toBe(false); // never `= ''`
  });

  it("unique_clicks uses uniqExactIf over offer_click", () => {
    expect(/uniqExactIf\(e\.session_id,\s*e\.event_type='offer_click'\)/i.test(offerMv)).toBe(true);
  });
});

describe("CH DDL — REFRESH…TO output-name aliasing (THERE_IS_NO_COLUMN regression)", () => {
  // A `REFRESH … TO <target>` MV names its output columns by the projection
  // expression. A bare qualified ref (e.g. `c.offer_id`, `r.source`) emits an
  // output column literally named `c.offer_id`, which the target table has no
  // column for → ClickHouse rejects with THERE_IS_NO_COLUMN. Every projected
  // item that references a qualified column MUST carry an `AS <name>` alias.
  it("every projected column referencing a qualified alias.column is AS-aliased (SELECT list only)", () => {
    for (const mv of MV_STMTS) {
      const list = mvSelectList(mv);
      expect(list).not.toBe("");
      for (const item of topLevelItems(list)) {
        // Only the projected item matters: if it references a qualified column
        // (alias.column) anywhere, it must also assign an AS alias.
        const referencesQualifiedColumn = /\b\w+\.\w+/.test(item);
        if (referencesQualifiedColumn) {
          const hasAlias = /\bAS\s+\w+/i.test(item);
          expect(hasAlias, `MV SELECT item lacks an AS alias (would emit a qualified output name): "${item}"`).toBe(true);
        }
      }
    }
  });

  it("the revenue-attributed MV aliases the exact columns ClickHouse rejected (offer_id, source)", () => {
    const rev = MV_STMTS.find((s) => /lst_revenue_attributed_mv/i.test(s)) ?? "";
    expect(rev).not.toBe("");
    expect(/c\.offer_id\s+AS\s+offer_id/i.test(rev)).toBe(true);
    expect(/r\.source\s+AS\s+source/i.test(rev)).toBe(true);
    // and no bare (unaliased) qualified projection survives in its SELECT list
    for (const item of topLevelItems(mvSelectList(rev))) {
      if (/\b[cr]\.\w+/.test(item)) expect(/\bAS\s+\w+/i.test(item)).toBe(true);
    }
  });
});

describe("CH DDL — no banned §1 tokens", () => {
  // Tokens assembled at runtime so THIS source file never contains a
  // contiguous banned literal (which would itself trip verify:no-legacy-prod-refs);
  // the concatenated values still match the full banned identifier in the DDL.
  const BANNED = [
    "insure" + "primo",
    "psychic" + "-quiz",
    "rental" + "-booking",
    "quotes" + "Routes",
    "the" + "iwise.com",
    "a2z-cf-cms-" + "v1-api",
    "a2z-cf-cms-" + "v1-db",
  ];
  it("clickhouse-ddl.sql contains no banned production identifiers", () => {
    for (const tok of BANNED) expect(RAW.includes(tok)).toBe(false);
  });
});
