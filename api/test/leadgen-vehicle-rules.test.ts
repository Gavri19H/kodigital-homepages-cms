// F18 Vehicle database — the Section save rules (content-schema.ts) and the
// Quote "Publish…" link / order checks (quotes-handlers.ts
// computeVehicleLinkProblems, wired into the activation preflight).

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { validateSectionContent, collectKnownAnswerFields } from "../src/public/leadgen/components/content-schema";
import {
  computeQuoteActivationPreflight,
  computeVehicleLinkProblems,
} from "../src/admin/leadgen/quotes-handlers";
import type { LeadgenQuoteRow } from "../src/admin/leadgen/db-types";

// --- helpers ------------------------------------------------------------------

type Node = Record<string, unknown>;

function vehicleNode(type: string, field: string, props: Record<string, unknown>, extra: Node = {}): Node {
  return {
    type,
    question_id: `q_${field}`,
    internal_field: field,
    props: { choice_source: "vehicle", ...props },
    ...extra,
  };
}

function makeDropdown(field = "vehicle_make"): Node {
  return vehicleNode("DropdownQuestion", field, { vehicle_asks: "make" });
}

function errorsOf(components: Node[]): Array<{ path: string; message: string; code: string }> {
  return validateSectionContent({ components }).errors;
}

function messagesOf(components: Node[]): string[] {
  return errorsOf(components).map((e) => e.message);
}

// --- save rules -------------------------------------------------------------------

describe("F18 save rules — Source: Vehicle database (content-schema.ts)", () => {
  it("a Vehicle database Dropdown needs no typed choices (a typed one still does)", () => {
    expect(errorsOf([makeDropdown()])).toEqual([]);
    const typed = { type: "DropdownQuestion", question_id: "q1", internal_field: "x", choices: [] };
    expect(messagesOf([typed])).toContain("The Dropdown needs at least one answer. Add an answer.");
  });

  it("Source is allowed only on Buttons, Cards and Dropdown", () => {
    const node = { type: "FreeTextQuestion", question_id: "q1", internal_field: "x", props: { choice_source: "vehicle" } };
    const errors = errorsOf([node]);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.code).toBe("invalid_vehicle_source");
    expect(errors[0]!.path).toBe("components[0].props.choice_source");
    expect(errors[0]!.message).toMatch(/^'Source' is only available on Buttons, Cards and Dropdown questions\. Remove it from the /);
  });

  it("Source must be Typed choices or Vehicle database", () => {
    const node = { ...makeDropdown(), props: { choice_source: "database" } };
    expect(messagesOf([node])).toContain("'Source' must be Typed choices or Vehicle database. Pick one of those.");
  });

  it("'This question asks for' is required and must be Make, Year or Model", () => {
    expect(messagesOf([vehicleNode("DropdownQuestion", "m", {})])).toContain(
      "'This question asks for' is required when the Source is Vehicle database. Pick Make, Year or Model.",
    );
    expect(messagesOf([vehicleNode("DropdownQuestion", "m", { vehicle_asks: "trim" })])).toContain(
      "'This question asks for' must be Make, Year or Model. Pick one of those.",
    );
  });

  it("typed choices, default and Other are IGNORED (kept, not checked) while the Source is Vehicle database", () => {
    // Icon cards whose stale typed rows have no icon, a default that is not a
    // choice and a broken Other list — all fine while the Source is vehicle.
    const stale = {
      choices: [{ label: "Old", value: "old", analytics_id: "old" }],
    };
    const props = {
      vehicle_asks: "make",
      vehicle_featured_makes: [448, 474],
      defaultValue: "not-a-choice",
      other: { enabled: true, choices: [] },
    };
    const vehicle = vehicleNode("IconCardAnswerGrid", "vehicle_make", props, stale);
    expect(errorsOf([vehicle])).toEqual([]);
    // the same rows, switched back to Typed choices, are checked again
    const typed = { ...vehicle, props: { ...props, choice_source: "typed" } };
    const messages = messagesOf([typed]);
    expect(messages).toContain("Every answer on the Icon answer cards needs an icon. Pick an icon for this answer.");
    expect(messages.some((m) => m.startsWith("The default answer 'not-a-choice' is not one of this question's answers"))).toBe(true);
  });

  it("Featured makes are required on Buttons / Cards asking for the Make, within limits", () => {
    const cards = (featured: unknown): Node => vehicleNode("ButtonAnswerGroup", "vehicle_make", { vehicle_asks: "make", vehicle_featured_makes: featured });
    expect(messagesOf([cards(undefined)])).toContain(
      "'Featured makes' is required on Buttons and Cards. Pick at least one make to show as a card.",
    );
    expect(messagesOf([cards([])])).toContain(
      "'Featured makes' is required on Buttons and Cards. Pick at least one make to show as a card.",
    );
    expect(messagesOf([cards([448, "abc"])])).toContain(
      "Every featured make must be a make from the vehicle database. Pick the makes again.",
    );
    expect(messagesOf([cards([448, 448])])).toContain("A make is listed twice in 'Featured makes'. Remove the copy.");
    expect(messagesOf([cards(Array.from({ length: 25 }, (_, i) => i + 1))])).toContain(
      "'Featured makes' holds at most 24 makes. Remove some.",
    );
    expect(errorsOf([cards([448, "474"])])).toEqual([]);
    // a Dropdown lists every make — no featured makes needed
    expect(errorsOf([makeDropdown()])).toEqual([]);
  });

  it("Year needs 'Make answer comes from' that is not itself and, in this Section, is a Make question", () => {
    const year = (makeField: unknown): Node =>
      vehicleNode("DropdownQuestion", "vehicle_year", { vehicle_asks: "year", vehicle_make_field: makeField });
    expect(messagesOf([year(undefined)])).toContain(
      "A Year question needs 'Make answer comes from'. Pick the field of the Make question.",
    );
    expect(messagesOf([year("vehicle_year")])).toContain(
      "'Make answer comes from' can't be this question's own field. Pick the field of the Make question.",
    );
    const notAMake = { type: "FreeTextQuestion", question_id: "q_free", internal_field: "free_text" };
    expect(messagesOf([notAMake, year("free_text")])).toContain(
      "'Make answer comes from' names 'free_text', but that question isn't set to Vehicle database · Make. Pick the field of the Make question.",
    );
    // a Make question in this Section, or one on another page (checked at Publish)
    expect(errorsOf([makeDropdown(), year("vehicle_make")])).toEqual([]);
    expect(errorsOf([year("vehicle_make")])).toEqual([]);
  });

  it("Model needs both links, to two different questions of the right kind", () => {
    const model = (props: Record<string, unknown>): Node =>
      vehicleNode("SearchableDropdownQuestion", "vehicle_model", { vehicle_asks: "model", ...props });
    expect(messagesOf([model({ vehicle_make_field: "vehicle_make" })])).toContain(
      "A Model question needs 'Year answer comes from'. Pick the field of the Year question.",
    );
    expect(messagesOf([model({ vehicle_make_field: "vehicle_make", vehicle_year_field: "vehicle_model" })])).toContain(
      "'Year answer comes from' can't be this question's own field. Pick the field of the Year question.",
    );
    expect(messagesOf([model({ vehicle_make_field: "vehicle_make", vehicle_year_field: "vehicle_make" })])).toContain(
      "'Year answer comes from' and 'Make answer comes from' must name two different questions. Pick the field of the Year question.",
    );
    expect(messagesOf([makeDropdown(), model({ vehicle_make_field: "vehicle_make", vehicle_year_field: "vehicle_make" })])).toContain(
      "'Year answer comes from' names 'vehicle_make', but that question isn't set to Vehicle database · Year. Pick the field of the Year question.",
    );
    const year = vehicleNode("DropdownQuestion", "vehicle_year", { vehicle_asks: "year", vehicle_make_field: "vehicle_make" });
    expect(
      errorsOf([makeDropdown(), year, model({ vehicle_make_field: "vehicle_make", vehicle_year_field: "vehicle_year" })]),
    ).toEqual([]);
  });

  it("year cards and the Other label stay within their limits", () => {
    const year = (n: unknown): Node =>
      vehicleNode("ButtonAnswerGroup", "vehicle_year", { vehicle_asks: "year", vehicle_make_field: "vehicle_make", vehicle_year_cards: n });
    const message = "'Newest years shown as cards' must be a whole number from 1 to 12. Enter one.";
    expect(messagesOf([year(0)])).toContain(message);
    expect(messagesOf([year(13)])).toContain(message);
    expect(messagesOf([year(2.5)])).toContain(message);
    expect(errorsOf([year(6)])).toEqual([]);
    const label = { ...makeDropdown(), props: { ...(makeDropdown()["props"] as Node), vehicle_other_label: "x".repeat(61) } };
    expect(messagesOf([label])).toContain("The 'Other' card label must be text of 60 characters or fewer. Shorten it.");
  });

  it("the Make question's snapshot record may not clash with another field in the Section", () => {
    const clash = { type: "FreeTextQuestion", question_id: "q_free", internal_field: "vehicle_make_snapshot" };
    const errors = errorsOf([makeDropdown(), clash]);
    expect(errors).toEqual([
      {
        code: "invalid_vehicle_source",
        path: "components[0].internal_field",
        message:
          "This Make question also saves the vehicle list version under 'vehicle_make_snapshot', but another question in this Section already uses that name. Rename one of them.",
      },
    ]);
  });

  it("the snapshot record joins the known-field universe (rules may name it)", () => {
    expect(collectKnownAnswerFields([makeDropdown()]).has("vehicle_make_snapshot")).toBe(true);
    const year = vehicleNode("DropdownQuestion", "vehicle_year", { vehicle_asks: "year", vehicle_make_field: "vehicle_make" });
    expect(collectKnownAnswerFields([year]).has("vehicle_year_snapshot")).toBe(false);
  });
});

// --- publish checks (sqlite harness) ---------------------------------------------

type SqliteStatement = { run(...p: unknown[]): unknown; get(...p: unknown[]): unknown; all(...p: unknown[]): unknown[] };
type SqliteDb = { prepare(sql: string): SqliteStatement; close(): void; [m: string]: unknown };
type DatabaseSyncCtor = new (path: string, options?: { enableForeignKeyConstraints?: boolean }) => SqliteDb;

function loadDatabaseSync(): DatabaseSyncCtor | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return (require("node:sqlite") as { DatabaseSync: DatabaseSyncCtor }).DatabaseSync;
  } catch {
    return null;
  }
}

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(TEST_DIR, "..", "migrations");

function d1FromSqlite(sdb: SqliteDb): D1Database {
  let queries = 0;
  const prep = (sql: string, binds: unknown[] = []): D1PreparedStatement =>
    ({
      bind: (...next: unknown[]) => prep(sql, next),
      first: async <T>() => {
        queries += 1;
        return (sdb.prepare(sql).get(...binds) ?? null) as T | null;
      },
      all: async <T>() => {
        queries += 1;
        return { results: sdb.prepare(sql).all(...binds) as T[], success: true };
      },
      run: async () => {
        queries += 1;
        const r = sdb.prepare(sql).run(...binds) as { changes?: number; lastInsertRowid?: number };
        return { success: true, meta: { changes: r.changes ?? 0, last_row_id: r.lastInsertRowid ?? 0 } };
      },
    }) as unknown as D1PreparedStatement;
  return {
    prepare: (sql: string) => prep(sql),
    batch: async (statements: D1PreparedStatement[]) => {
      const out = [];
      for (const s of statements) out.push(await (s as unknown as { run(): Promise<unknown> }).run());
      return out;
    },
    get queryCount() {
      return queries;
    },
  } as unknown as D1Database;
}

const DatabaseSync = loadDatabaseSync();
const describeDb = DatabaseSync === null ? describe.skip : describe;

interface Funnel {
  sdb: SqliteDb;
  db: D1Database;
  quoteId: number;
  variantId: number;
  /** add a variant page holding the given Sections (one slot each) */
  page(...sections: Node[][]): void;
  /** put Sections on the Quote's shared first page */
  shared(...sections: Node[][]): void;
}

let seq = 0;
function funnel(): Funnel {
  const sdb = new (DatabaseSync as DatabaseSyncCtor)(":memory:", { enableForeignKeyConstraints: false });
  (sdb["exec"] as (s: string) => void)(
    "CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT);CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT);",
  );
  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql") && f.includes("leadgen")).sort()) {
    (sdb["exec"] as (s: string) => void)(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
  }
  sdb
    .prepare("INSERT INTO leadgen_quotes (public_id, quote_name, activity, verticals_json, status) VALUES ('lgq_VEH', 'Car', 'quote_funnel', '[\"auto\"]', 'draft')")
    .run();
  const quoteId = (sdb.prepare("SELECT id FROM leadgen_quotes WHERE public_id = 'lgq_VEH'").get() as { id: number }).id;
  sdb.prepare("INSERT INTO leadgen_funnels (public_id, quote_id, funnel_name, status) VALUES ('lgf_VEH', ?, 'F', 'active')").run(quoteId);
  const funnelId = (sdb.prepare("SELECT id FROM leadgen_funnels WHERE public_id = 'lgf_VEH'").get() as { id: number }).id;
  sdb.prepare("INSERT INTO leadgen_funnel_variants (public_id, funnel_id, variant_label, status) VALUES ('lgn_VEH', ?, 'A', 'active')").run(funnelId);
  const variantId = (sdb.prepare("SELECT id FROM leadgen_funnel_variants WHERE public_id = 'lgn_VEH'").get() as { id: number }).id;
  let pagePos = 0;
  let sectionPos = 0;
  let sharedPos = 0;
  const addSection = (components: Node[]): number => {
    seq += 1;
    const publicId = `lgs_VEH${String(seq).padStart(4, "0")}`;
    sdb
      .prepare(
        "INSERT INTO leadgen_sections (public_id, section_name, activity, vertical, headline_text, content_json) VALUES (?, ?, 'quote_funnel', 'auto', 'H', ?)",
      )
      .run(publicId, `Section ${seq}`, JSON.stringify({ components }));
    return (sdb.prepare("SELECT id FROM leadgen_sections WHERE public_id = ?").get(publicId) as { id: number }).id;
  };
  const db = d1FromSqlite(sdb);
  return {
    sdb,
    db,
    quoteId,
    variantId,
    page(...sections) {
      pagePos += 1;
      const pagePublic = `lgpg_V${pagePos}`;
      sdb.prepare("INSERT INTO leadgen_funnel_pages (public_id, variant_id, position) VALUES (?, ?, ?)").run(pagePublic, variantId, pagePos);
      const pageId = (sdb.prepare("SELECT id FROM leadgen_funnel_pages WHERE public_id = ?").get(pagePublic) as { id: number }).id;
      sections.forEach((components, slot) => {
        sdb.prepare("INSERT INTO leadgen_funnel_page_slots (page_id, position) VALUES (?, ?)").run(pageId, slot);
        const slotId = (sdb.prepare("SELECT id FROM leadgen_funnel_page_slots WHERE page_id = ? AND position = ?").get(pageId, slot) as { id: number }).id;
        sectionPos += 1;
        sdb
          .prepare("INSERT INTO leadgen_funnel_variant_sections (variant_id, section_id, position, page_id, slot_id) VALUES (?, ?, ?, ?, ?)")
          .run(variantId, addSection(components), sectionPos, pageId, slotId);
      });
    },
    shared(...sections) {
      sdb.prepare("INSERT INTO leadgen_funnel_pages (public_id, quote_id, position) VALUES ('lgpg_SHARED', ?, 0)").run(quoteId);
      const pageId = (sdb.prepare("SELECT id FROM leadgen_funnel_pages WHERE public_id = 'lgpg_SHARED'").get() as { id: number }).id;
      for (const components of sections) {
        sharedPos += 1;
        sdb
          .prepare("INSERT INTO leadgen_funnel_variant_sections (quote_id, section_id, position, page_id) VALUES (?, ?, ?, ?)")
          .run(quoteId, addSection(components), sharedPos, pageId);
      }
    },
  };
}

const MAKE = makeDropdown();
const YEAR = vehicleNode("ButtonAnswerGroup", "vehicle_year", { vehicle_asks: "year", vehicle_make_field: "vehicle_make" });
const MODEL = vehicleNode("SearchableDropdownQuestion", "vehicle_model", {
  vehicle_asks: "model",
  vehicle_make_field: "vehicle_make",
  vehicle_year_field: "vehicle_year",
});

async function messages(f: Funnel): Promise<string[]> {
  return (await computeVehicleLinkProblems(f.db, f.quoteId, f.variantId)).map((p) => p.message);
}

describeDb("F18 publish checks — Make → Year → Model links in page order (quotes-handlers.ts)", () => {
  it("three pages in order: no problem", async () => {
    const f = funnel();
    f.page([MAKE]);
    f.page([YEAR]);
    f.page([MODEL]);
    expect(await computeVehicleLinkProblems(f.db, f.quoteId, f.variantId)).toEqual([]);
  });

  it("one Section with all three questions (Q5), or two slots on one page: no problem", async () => {
    const one = funnel();
    one.page([MAKE, YEAR, MODEL]);
    expect(await messages(one)).toEqual([]);
    const slots = funnel();
    slots.page([YEAR], [MAKE]);
    slots.page([MODEL]);
    expect(await messages(slots)).toEqual([]);
  });

  it("the Make question on the Quote's shared first page counts as earliest", async () => {
    const f = funnel();
    f.shared([MAKE]);
    f.page([YEAR]);
    f.page([MODEL]);
    expect(await messages(f)).toEqual([]);
  });

  it("Year before its Make is an error row with a fix link to the Section", async () => {
    const f = funnel();
    f.page([YEAR]);
    f.page([MAKE]);
    const problems = await computeVehicleLinkProblems(f.db, f.quoteId, f.variantId);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({
      scope: "component",
      severity: "error",
      path: expect.stringMatching(/^section\.lgs_VEH\d{4}\.components\[q_vehicle_year\]\.props\.vehicle_make_field$/),
      fix_url: expect.stringMatching(/^\/admin\/leadgen\/sections\/lgs_VEH\d{4}\/edit$/),
    });
    expect(problems[0]!.message).toMatch(
      /^'Section \d+': Year needs a Make question earlier in this funnel\. The Make question \('vehicle_make'\) comes on a later page\. Move it to the same page or an earlier one\.$/,
    );
  });

  it("Model before its Year is an error row", async () => {
    const f = funnel();
    f.page([MAKE]);
    f.page([MODEL]);
    f.page([YEAR]);
    expect(await messages(f)).toEqual([
      expect.stringMatching(
        /^'Section \d+': Model needs a Year question earlier in this funnel\. The Year question \('vehicle_year'\) comes on a later page\. Move it to the same page or an earlier one\.$/,
      ),
    ]);
  });

  it("a link to a field that is not a Vehicle database question of that kind is an error row", async () => {
    const f = funnel();
    f.page([{ type: "FreeTextQuestion", question_id: "q_free", internal_field: "vehicle_make" }]);
    f.page([YEAR]);
    expect(await messages(f)).toEqual([
      expect.stringMatching(
        /^'Section \d+': Year needs a Make question earlier in this funnel\. 'Make answer comes from' names 'vehicle_make', but no question in this funnel is set to Vehicle database · Make with that field\.$/,
      ),
    ]);
  });

  it("a missing link on a stored question is an error row", async () => {
    const f = funnel();
    f.page([MAKE]);
    f.page([vehicleNode("DropdownQuestion", "vehicle_year", { vehicle_asks: "year" })]);
    expect(await messages(f)).toEqual([
      expect.stringMatching(/^'Section \d+': Year needs a Make question earlier in this funnel\. Set 'Make answer comes from' on the Year question\.$/),
    ]);
  });

  it("Model and its Year question must use the same Make question", async () => {
    const f = funnel();
    f.page([MAKE, vehicleNode("DropdownQuestion", "other_make", { vehicle_asks: "make" })]);
    f.page([vehicleNode("DropdownQuestion", "vehicle_year", { vehicle_asks: "year", vehicle_make_field: "other_make" })]);
    f.page([MODEL]);
    expect(await messages(f)).toEqual([
      expect.stringMatching(
        /^'Section \d+': Model and its Year question must use the same Make question\. Model uses 'vehicle_make', the Year question uses 'other_make'\.$/,
      ),
    ]);
  });

  it("the Make question's snapshot record may not clash with a field on another page", async () => {
    const f = funnel();
    f.page([MAKE]);
    f.page([{ type: "FreeTextQuestion", question_id: "q_free", internal_field: "vehicle_make_snapshot" }]);
    expect(await messages(f)).toEqual([
      expect.stringMatching(
        /^'Section \d+': this Make question saves the vehicle list version under 'vehicle_make_snapshot', but another question in this funnel already uses that name\. Rename one of them\.$/,
      ),
    ]);
  });

  it("a Quote with no vehicle question: one small query, no rows", async () => {
    const f = funnel();
    f.page([{ type: "FreeTextQuestion", question_id: "q_free", internal_field: "name" }]);
    const before = (f.db as unknown as { queryCount: number }).queryCount;
    expect(await messages(f)).toEqual([]);
    expect((f.db as unknown as { queryCount: number }).queryCount - before).toBe(1);
  });

  it("the activation preflight carries the row as a blocking error", async () => {
    const f = funnel();
    f.page([YEAR]);
    f.page([MAKE]);
    const quote = f.sdb.prepare("SELECT * FROM leadgen_quotes WHERE id = ?").get(f.quoteId) as LeadgenQuoteRow;
    const preflight = await computeQuoteActivationPreflight(f.db, quote);
    const rows = preflight.problems.filter((p) => p.message.includes("Year needs a Make question earlier in this funnel"));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.severity).toBe("error");
  });
});
