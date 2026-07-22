// LeadGen rework — content migrations M6/M7/M9/M12 (migrations 0050–0053) over
// REAL SQLite. Contract LEADGEN-REWORK-03 §5 (M6/M7/M9/M12) + §11 "Migrations" AC
// + E2's proven `<nodeQid>::<field>` id preservation.
//
// These four are PURE-SQL rewrites of leadgen_sections.content_json (SQLite
// JSON1). This suite exercises the ACTUAL migration files against a real
// node:sqlite engine (no JS mock of SQL), over golden fixtures that are REAL,
// validate-clean stored content (the migration's precondition), and proves per
// the slice: the exact per-node transform, that the output still passes the REAL
// validateSectionContent, the field-universe invariant (projected empty + the raw
// delta fully characterised), answer-map count invariance, idempotency, and that
// a no-target section is not rewritten at all (byte-identical + WHERE-excluded).
//
// NOTE ON SEED: `npm run seed:local` (scripts/seed/seed-sql.ts) seeds NO leadgen
// sections at all (only the homepage/articles corpus — 0 `leadgen` references),
// so there is no real grid/other/slider/address seed content to draw a fixture
// from; the fixtures below are hand-built to the shapes verified in
// content-schema.ts + leadgen-p5-multi-question-grid.test.ts. (Reported to the
// conductor.)

import { describe, expect, it } from "vitest";
import { validateSectionContent } from "../src/public/leadgen/components/content-schema";
import type { LeadgenComponentNode } from "../src/public/leadgen/components/content-schema";
import {
  loadDatabaseSync,
  createSectionsDb,
  insertFixtureSection,
  insertFixtureAnswerMap,
  applyMigrationFile,
  answerMapCount,
  projectedFieldUniverse,
  rawFieldUniverse,
  diffSets,
  topLevelTargetSections,
  nestedTargetSections,
  migrationSpec,
  FIXTURE_SECTIONS,
  FIXTURE_ANSWER_MAPS,
  type SqliteDb,
  type DatabaseSyncCtor,
} from "../src/scripts/leadgen-rework-migration-report";

const DatabaseSync = loadDatabaseSync();
const describeDb = DatabaseSync === null ? describe.skip : describe;

function freshDb(): SqliteDb {
  const db = createSectionsDb(DatabaseSync as DatabaseSyncCtor);
  for (const s of FIXTURE_SECTIONS) insertFixtureSection(db, s);
  FIXTURE_ANSWER_MAPS.forEach((m, i) => insertFixtureAnswerMap(db, m, i));
  return db;
}

function rawJson(db: SqliteDb, id: number): string {
  return (db.prepare("SELECT content_json AS c FROM leadgen_sections WHERE id = ?").get(id) as { c: string }).c;
}
function components(db: SqliteDb, id: number): LeadgenComponentNode[] {
  return (JSON.parse(rawJson(db, id)) as { components: LeadgenComponentNode[] }).components;
}
function byId(db: SqliteDb, id: number, questionId: string): LeadgenComponentNode {
  const c = components(db, id).find((n) => n.question_id === questionId);
  if (c === undefined) throw new Error(`no component ${questionId} in section ${id}`);
  return c;
}
function validateOk(db: SqliteDb, id: number): void {
  const res = validateSectionContent(JSON.parse(rawJson(db, id)));
  expect(res.errors, `section ${id} must validate clean; errors: ${JSON.stringify(res.errors)}`).toEqual([]);
}
function fieldUniverseEmptyDiff(before: string, after: string): void {
  const d = diffSets(projectedFieldUniverse(before), projectedFieldUniverse(after));
  expect({ added: d.added, removed: d.removed }).toEqual({ added: [], removed: [] });
}
const M6 = migrationSpec("m6").file;
const M7 = migrationSpec("m7").file;
const M9 = migrationSpec("m9").file;
const M12 = migrationSpec("m12").file;

// ---------------------------------------------------------------------------
// Fixtures are valid stored content BEFORE any migration (a migration's precondition).
// ---------------------------------------------------------------------------
describeDb("rework content migrations — fixtures are valid stored content", () => {
  it("every golden fixture passes the REAL validateSectionContent before migration", () => {
    const db = freshDb();
    for (const s of FIXTURE_SECTIONS) validateOk(db, s.id);
    db.close();
  });
});

// ---------------------------------------------------------------------------
// M6 — grid expansion (fixtures a + b)
// ---------------------------------------------------------------------------
describeDb("M6 — MultiQuestionGrid → independent components", () => {
  it("(a) mixed grid: Yes/No-override row → TwoButtonYesNo; inherited-choice rows → ButtonAnswerGroup; label/default/required/conditional carried; `<nodeQid>::<field>` ids preserved", () => {
    const db = freshDb();
    const before = rawJson(db, 601);
    applyMigrationFile(db, M6);

    const ids = components(db, 601).map((c) => `${c.type} ${c.question_id}`);
    expect(ids).toEqual([
      "TwoButtonYesNo m6a_prequal", // pre-existing sibling — untouched
      "QuestionHeadline m6a_head",
      "TwoButtonYesNo m6a_grid::homeowner",
      "ButtonAnswerGroup m6a_grid::grade",
      "ButtonAnswerGroup m6a_grid::married",
      "ContinueButton m6a_cont",
    ]);

    const homeowner = byId(db, 601, "m6a_grid::homeowner");
    expect(homeowner.type).toBe("TwoButtonYesNo");
    expect(homeowner.internal_field).toBe("homeowner");
    expect((homeowner.props as Record<string, unknown>).label).toBe("Homeowner?");
    expect((homeowner.choices as Array<{ label: string }>).map((c) => c.label)).toEqual(["Yes", "No"]);
    expect(homeowner.conditional).toEqual({ when: "prequal", op: "eq", value: "yes" }); // node conditional copied
    expect("required" in homeowner).toBe(false); // row had none
    expect("defaultValue" in (homeowner.props as Record<string, unknown>)).toBe(false);

    const grade = byId(db, 601, "m6a_grid::grade");
    expect(grade.type).toBe("ButtonAnswerGroup");
    expect((grade.choices as Array<{ value: string }>).map((c) => c.value)).toEqual(["a", "b", "c"]); // inherited node choices
    expect((grade.props as Record<string, unknown>).label).toBe("Pick a grade");
    expect(grade.conditional).toEqual({ when: "prequal", op: "eq", value: "yes" });

    const married = byId(db, 601, "m6a_grid::married");
    expect(married.type).toBe("ButtonAnswerGroup");
    expect((married.props as Record<string, unknown>).defaultValue).toBe("b"); // row.default → props.defaultValue
    expect(married.required).toBe(true); // row.required → required
    expect(married.conditional).toEqual({ when: "prequal", op: "eq", value: "yes" });

    validateOk(db, 601); // output still passes the REAL schema
    fieldUniverseEmptyDiff(before, rawJson(db, 601)); // projected field universe preserved
    db.close();
  });

  it("(b) grid whose node choices are [Yes,No] and rows without overrides → all TwoButtonYesNo", () => {
    const db = freshDb();
    const before = rawJson(db, 602);
    applyMigrationFile(db, M6);
    const comps = components(db, 602);
    expect(comps.map((c) => `${c.type} ${c.question_id}`)).toEqual([
      "TwoButtonYesNo m6b_grid::insured",
      "TwoButtonYesNo m6b_grid::owner",
    ]);
    validateOk(db, 602);
    fieldUniverseEmptyDiff(before, rawJson(db, 602));
    db.close();
  });

  it("(h) projected field-universe diff is empty and the raw diff is EXACTLY the grid-node-id → per-row-id retirement (no answer field lost)", () => {
    const db = freshDb();
    const before601 = rawJson(db, 601);
    applyMigrationFile(db, M6);
    const raw = diffSets(rawFieldUniverse(before601), rawFieldUniverse(rawJson(db, 601)));
    expect(raw.removed).toEqual(["m6a_grid"]); // the grid's own (non-producing) node id
    expect(raw.added).toEqual(["m6a_grid::grade", "m6a_grid::homeowner", "m6a_grid::married"]); // the projected ids answer-maps already key on
    db.close();
  });

  it("(h) answer-map row count is unchanged (M6 never touches leadgen_section_answer_maps)", () => {
    const db = freshDb();
    const before = answerMapCount(db, 601);
    applyMigrationFile(db, M6);
    expect(answerMapCount(db, 601)).toBe(before);
    expect(before).toBe(3); // non-trivial: three grid-row maps keyed on the projected ids
    db.close();
  });

  it("(g) idempotent: applying M6 twice equals applying it once (byte-equal)", () => {
    const db = freshDb();
    applyMigrationFile(db, M6);
    const once = rawJson(db, 601);
    applyMigrationFile(db, M6);
    expect(rawJson(db, 601)).toBe(once);
    db.close();
  });
});

// ---------------------------------------------------------------------------
// M7 — slider collapse (fixture e)
// ---------------------------------------------------------------------------
describeDb("M7 — slider triplet → NumberRangeQuestion", () => {
  it("(e) Range + CurrencyRange + pre-existing NumberRange → all NumberRangeQuestion, answer_type 'number', slider_type 'single', currency_affix true/false/absent", () => {
    const db = freshDb();
    const before = rawJson(db, 701);
    applyMigrationFile(db, M7);

    const range = byId(db, 701, "m7_r");
    expect(range.type).toBe("NumberRangeQuestion");
    expect(range.answer_type).toBe("number");
    expect((range.props as Record<string, unknown>).slider_type).toBe("single");
    expect((range.props as Record<string, unknown>).currency_affix).toBe(false);
    expect((range.props as Record<string, unknown>).min).toBe(0); // props preserved
    expect((range.props as Record<string, unknown>).max).toBe(30);

    const currency = byId(db, 701, "m7_c");
    expect(currency.type).toBe("NumberRangeQuestion");
    expect(currency.answer_type).toBe("number"); // was 'currency' — normalised (fixes Image9)
    expect((currency.props as Record<string, unknown>).currency_affix).toBe(true);

    const number = byId(db, 701, "m7_n");
    expect(number.type).toBe("NumberRangeQuestion");
    expect((number.props as Record<string, unknown>).slider_type).toBe("single");
    expect("currency_affix" in (number.props as Record<string, unknown>)).toBe(false); // absent, not false

    validateOk(db, 701);
    fieldUniverseEmptyDiff(before, rawJson(db, 701));
    db.close();
  });

  it("(g) idempotent", () => {
    const db = freshDb();
    applyMigrationFile(db, M7);
    const once = rawJson(db, 701);
    applyMigrationFile(db, M7);
    expect(rawJson(db, 701)).toBe(once);
    db.close();
  });
});

// ---------------------------------------------------------------------------
// M9 — address field set (fixture f)
// ---------------------------------------------------------------------------
describeDb("M9 — explicit Address field set", () => {
  it("(f) address with and without maps.fills → explicit props.fields[]; maps.fills + node.required untouched; no per-field label/required", () => {
    const db = freshDb();
    const before = rawJson(db, 901);
    applyMigrationFile(db, M9);

    const expected = [
      { field: "street", mode: "autofill", validation: "none" },
      { field: "city", mode: "autofill", validation: "none" },
      { field: "state", mode: "autofill", validation: "none" },
      { field: "zip", mode: "autofill", validation: "zip5" },
    ];
    const a1 = byId(db, 901, "m9_a1");
    expect((a1.props as Record<string, unknown>).fields).toEqual(expected);
    expect((a1.props as { maps: { fills: unknown } }).maps.fills).toEqual({ zip: "home_zip", city: "home_city" }); // untouched
    expect(a1.required).toBe(true); // node-level requiredness untouched
    for (const f of (a1.props as { fields: Array<Record<string, unknown>> }).fields) {
      expect("label" in f).toBe(false); // no per-field label (today's labels are fixed preview strings)
      expect("required" in f).toBe(false); // no per-field required (today requiredness is node-level)
    }

    const a2 = byId(db, 901, "m9_a2");
    expect((a2.props as Record<string, unknown>).fields).toEqual(expected);

    validateOk(db, 901);
    fieldUniverseEmptyDiff(before, rawJson(db, 901));
    db.close();
  });

  it("(g) idempotent: a node already carrying props.fields is skipped", () => {
    const db = freshDb();
    applyMigrationFile(db, M9);
    const once = rawJson(db, 901);
    applyMigrationFile(db, M9);
    expect(rawJson(db, 901)).toBe(once);
    db.close();
  });
});

// ---------------------------------------------------------------------------
// M12 — other-group retirement (fixtures c + d)
// ---------------------------------------------------------------------------
describeDb("M12 — OtherGroupSelector + choiceDisplay retirement", () => {
  it("(c) OtherGroupSelector with mainValues split → ButtonAnswerGroup with ALL choices as base; choiceDisplay stripped", () => {
    const db = freshDb();
    const before = rawJson(db, 1201);
    applyMigrationFile(db, M12);
    const node = byId(db, 1201, "m12c_ins");
    expect(node.type).toBe("ButtonAnswerGroup");
    expect("choiceDisplay" in node).toBe(false);
    expect((node.choices as Array<{ value: string }>).map((c) => c.value)).toEqual(["sf", "geico", "other_co"]); // ALL choices base
    validateOk(db, 1201);
    fieldUniverseEmptyDiff(before, rawJson(db, 1201));
    db.close();
  });

  it("(d) a ButtonAnswerGroup carrying choiceDisplay → prop stripped, choices intact, type unchanged", () => {
    const db = freshDb();
    const before = rawJson(db, 1202);
    applyMigrationFile(db, M12);
    const node = byId(db, 1202, "m12d_col");
    expect(node.type).toBe("ButtonAnswerGroup"); // unchanged
    expect("choiceDisplay" in node).toBe(false);
    expect((node.choices as Array<{ value: string }>).map((c) => c.value)).toEqual(["red", "blue"]); // intact
    validateOk(db, 1202);
    fieldUniverseEmptyDiff(before, rawJson(db, 1202));
    db.close();
  });

  it("(g) idempotent", () => {
    const db = freshDb();
    applyMigrationFile(db, M12);
    const once1201 = rawJson(db, 1201);
    const once1202 = rawJson(db, 1202);
    applyMigrationFile(db, M12);
    expect(rawJson(db, 1201)).toBe(once1201);
    expect(rawJson(db, 1202)).toBe(once1202);
    db.close();
  });
});

// ---------------------------------------------------------------------------
// (i) A section with NO target nodes is not rewritten at all (every migration).
// ---------------------------------------------------------------------------
describeDb("(i) no-target section untouched byte-identically + WHERE-excluded", () => {
  for (const [key, file] of [["M6", M6], ["M7", M7], ["M9", M9], ["M12", M12]] as const) {
    it(`${key} leaves section 999 byte-identical and excludes it from the affected set`, () => {
      const db = freshDb();
      const spec = migrationSpec(key.toLowerCase());
      expect(topLevelTargetSections(db, spec)).not.toContain(999); // WHERE would not match it
      const before = rawJson(db, 999);
      applyMigrationFile(db, file);
      expect(rawJson(db, 999)).toBe(before); // not even JSON1-reserialised
      db.close();
    });
  }
});

// ---------------------------------------------------------------------------
// Cross-cutting: every affected section keeps its projected field universe and
// answer-map count across ITS migration; nested-target detector is a superset.
// ---------------------------------------------------------------------------
describeDb("cross-cutting invariants over the whole corpus", () => {
  const cases = [
    { file: M6, key: "m6" },
    { file: M7, key: "m7" },
    { file: M9, key: "m9" },
    { file: M12, key: "m12" },
  ] as const;

  for (const { file, key } of cases) {
    it(`${key}: projected field-universe diff empty + answer-map count invariant for every affected section`, () => {
      const db = freshDb();
      const spec = migrationSpec(key);
      const affected = topLevelTargetSections(db, spec);
      expect(affected.length).toBeGreaterThan(0);
      // json_tree detector (any depth) is a SUPERSET of the top-level set — read
      // on the BEFORE state (post-migration the target type/marker is gone). With
      // no nested targets in the corpus the two sets are equal.
      const nested = nestedTargetSections(db, spec);
      for (const id of affected) expect(nested).toContain(id);
      const before = new Map(affected.map((id) => [id, { c: rawJson(db, id), m: answerMapCount(db, id) }]));
      applyMigrationFile(db, file);
      for (const id of affected) {
        fieldUniverseEmptyDiff(before.get(id)!.c, rawJson(db, id));
        expect(answerMapCount(db, id)).toBe(before.get(id)!.m);
        validateOk(db, id);
      }
      db.close();
    });
  }
});
