import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import admin from "../src/admin/router";
import { buildPayload, type LeadgenPayloadSchema } from "../src/leadgen/payload";
import { readAnswerBindings } from "../src/leadgen/answer-bindings";
import type { Env } from "../src/env";

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

function runSql(sdb: SqliteDb, sql: string): void {
  (sdb["exec"] as (s: string) => void)(sql);
}

function d1FromSqlite(sdb: SqliteDb): D1Database {
  const prep = (sql: string, binds: unknown[] = []): D1PreparedStatement =>
    ({
      bind: (...next: unknown[]) => prep(sql, next),
      first: async <T>() => (sdb.prepare(sql).get(...binds) ?? null) as T | null,
      all: async <T>() => ({ results: sdb.prepare(sql).all(...binds) as T[], success: true }),
      run: async () => {
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
  } as unknown as D1Database;
}

const DatabaseSync = loadDatabaseSync();
const describeDb = DatabaseSync === null ? describe.skip : describe;
const API = "/api/admin/leadgen";

interface Harness {
  sdb: SqliteDb;
  env: Env;
  db: D1Database;
}

// Hazard: a hardcoded migration list goes stale the moment one lands. This
// harness SCANS migrations/ in filename order, so a new table is present here
// the day it exists.
function harness(): Harness {
  const sdb = new (DatabaseSync as DatabaseSyncCtor)(":memory:", { enableForeignKeyConstraints: false });
  runSql(
    sdb,
    "CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT);" +
      "CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT);",
  );
  // every leadgen migration, in filename order — SCANNED, never a hardcoded list
  // that goes stale the day the next one lands (0054-0056 were already missing
  // from the older harnesses when this suite was written).
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql") && f.includes("leadgen"))
    .sort()) {
    runSql(sdb, readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
  }
  const db = d1FromSqlite(sdb);
  return { sdb, db, env: { DB: db, DEV_BYPASS_AUTH: "true" } as unknown as Env };
}

function seedOffer(sdb: SqliteDb, name: string, activity: string, vertical: string): number {
  sdb
    .prepare(
      `INSERT INTO leadgen_offers (public_id, offer_name, activity, vertical, conversion_tracking_method, offer_type)
       VALUES (?, ?, ?, ?, 's2s_postback', 'cpl')`,
    )
    .run(`lgo_${name}`, name, activity, vertical);
  return (sdb.prepare("SELECT id FROM leadgen_offers WHERE public_id = ?").get(`lgo_${name}`) as { id: number }).id;
}

// isPublicId gates the admin routes: prefix + a 26-char ULID body.
function sectionPublicId(name: string): string {
  return `lgs_${(name.toUpperCase() + "0123456789ABCDEFGHJKMNPQRS").slice(0, 26)}`;
}

function seedSection(sdb: SqliteDb, name: string, activity = "quote_funnel", vertical = "life"): number {
  sdb
    .prepare(
      `INSERT INTO leadgen_sections (public_id, section_name, activity, vertical, headline_text, content_json)
       VALUES (?, ?, ?, ?, 'H', '{"components":[]}')`,
    )
    .run(sectionPublicId(name), name, activity, vertical);
  return (sdb.prepare("SELECT id FROM leadgen_sections WHERE public_id = ?").get(sectionPublicId(name)) as { id: number }).id;
}

function seedSchema(sdb: SqliteDb, offerId: number, schema: unknown): number {
  sdb
    .prepare(
      `INSERT INTO leadgen_offer_payload_schemas (public_id, offer_id, version, schema_json)
       VALUES (?, ?, 1, ?)`,
    )
    .run(`lgp_${offerId}`, offerId, JSON.stringify(schema));
  const id = (
    sdb.prepare("SELECT id FROM leadgen_offer_payload_schemas WHERE public_id = ?").get(`lgp_${offerId}`) as {
      id: number;
    }
  ).id;
  sdb.prepare("UPDATE leadgen_offers SET active_payload_schema_id = ? WHERE id = ?").run(id, offerId);
  return id;
}

let mapSeq = 0;
function seedMap(
  sdb: SqliteDb,
  row: {
    sectionId: number;
    offerId: number;
    internal_field: string;
    path: string;
    type?: string;
    value_map?: Record<string, unknown> | null;
    transform?: unknown[] | null;
    default_value?: string | null;
    fallback_value?: string | null;
    status?: string;
  },
): void {
  mapSeq += 1;
  sdb
    .prepare(
      `INSERT INTO leadgen_section_answer_maps
         (public_id, section_id, question_id, question_key, internal_field, answer_type, offer_id,
          payload_schema_id, payload_schema_public_id, offer_payload_field_path, provider_expected_type,
          output_value_map_json, transform_json, default_value, fallback_value, mapping_status, validation_status)
       VALUES (?, ?, ?, ?, ?, 'string', ?, 1, 'lgp_x', ?, ?, ?, ?, ?, ?, ?, 'ok')`,
    )
    .run(
      `lgm_${mapSeq}`,
      row.sectionId,
      `q_${row.internal_field}`,
      row.internal_field,
      row.internal_field,
      row.offerId,
      row.path,
      row.type ?? "string",
      row.value_map === undefined || row.value_map === null ? null : JSON.stringify(row.value_map),
      row.transform === undefined || row.transform === null ? null : JSON.stringify(row.transform),
      row.default_value ?? null,
      row.fallback_value ?? null,
      row.status ?? "complete",
    );
}

const SCHEMA: LeadgenPayloadSchema = {
  version: 1,
  root: {
    type: "object",
    children: [
      // declares only that an answer fills it — no pivot of its own
      { path: "lead.zip", name: "zip", type: "string", source: "answer" },
      // a node still carrying the PRE-RULING pivot: it must be inert
      {
        path: "lead.legacy",
        name: "legacy",
        type: "string",
        source: "answer",
        internal_field: "typed_in_the_payload",
      },
      { path: "lead.plan", name: "plan", type: "string", source: "static", value: "gold" },
    ],
  },
};

describeDb("answer bindings — the Section tab is the ONLY binding surface", () => {
  it("the loader keys the Section rows by payload path, per Offer", async () => {
    const h = harness();
    const offer = seedOffer(h.sdb, "a", "quote_funnel", "life");
    const other = seedOffer(h.sdb, "b", "quote_funnel", "life");
    const section = seedSection(h.sdb, "s1");
    seedMap(h.sdb, { sectionId: section, offerId: offer, internal_field: "zip", path: "lead.zip" });
    seedMap(h.sdb, { sectionId: section, offerId: other, internal_field: "zip", path: "other.zip" });

    const bindings = await readAnswerBindings(h.db, [offer, other]);
    expect(Object.keys(bindings.get(offer) ?? {})).toEqual(["lead.zip"]);
    expect(bindings.get(offer)?.["lead.zip"]).toEqual([{ internal_field: "zip" }]);
    expect(Object.keys(bindings.get(other) ?? {})).toEqual(["other.zip"]);
  });

  it("carries the row's per-Offer format: value map, transform, default and fallback", async () => {
    const h = harness();
    const offer = seedOffer(h.sdb, "a", "quote_funnel", "life");
    const section = seedSection(h.sdb, "s1");
    seedMap(h.sdb, {
      sectionId: section,
      offerId: offer,
      internal_field: "homeowner",
      path: "lead.own",
      value_map: { yes: true, no: false },
      transform: [{ kind: "toString" }],
      default_value: "D",
      fallback_value: '"F"',
    });
    const bindings = await readAnswerBindings(h.db, [offer]);
    expect(bindings.get(offer)?.["lead.own"]).toEqual([
      {
        internal_field: "homeowner",
        value_map: { yes: true, no: false },
        transform: [{ kind: "toString" }],
        default: "D", // stored TEXT that is not JSON stays the literal string
        fallback: "F", // JSON in the column keeps its type
      },
    ]);
  });

  it("an INCOMPLETE mapping row never binds (the studio's own status gate)", async () => {
    const h = harness();
    const offer = seedOffer(h.sdb, "a", "quote_funnel", "life");
    const section = seedSection(h.sdb, "s1");
    seedMap(h.sdb, {
      sectionId: section,
      offerId: offer,
      internal_field: "zip",
      path: "lead.zip",
      status: "incomplete",
    });
    expect((await readAnswerBindings(h.db, [offer])).size).toBe(0);
  });

  it("narrows to the lead's OWN Sections, in the funnel's order", async () => {
    const h = harness();
    const offer = seedOffer(h.sdb, "a", "quote_funnel", "life");
    const first = seedSection(h.sdb, "s1");
    const second = seedSection(h.sdb, "s2");
    const absent = seedSection(h.sdb, "s3");
    seedMap(h.sdb, { sectionId: second, offerId: offer, internal_field: "zip_b", path: "lead.zip" });
    seedMap(h.sdb, { sectionId: first, offerId: offer, internal_field: "zip_a", path: "lead.zip" });
    seedMap(h.sdb, { sectionId: absent, offerId: offer, internal_field: "zip_c", path: "lead.zip" });

    // the funnel asked s2 BEFORE s1; s3 is not in this funnel at all
    const bindings = await readAnswerBindings(h.db, [offer], [second, first]);
    expect(bindings.get(offer)?.["lead.zip"]?.map((b) => b.internal_field)).toEqual(["zip_b", "zip_a"]);
  });

  // --- the build rule ------------------------------------------------------

  it("a field is filled by the Section row — and a node-authored pivot is INERT", () => {
    const payload = buildPayload(SCHEMA, {
      answers: { zip: "07032", typed_in_the_payload: "SHOULD NEVER BE SENT" },
      answer_bindings: { "lead.zip": [{ internal_field: "zip" }] },
    });
    expect(payload).toEqual({ lead: { zip: "07032", plan: "gold" } });
  });

  it("with NO Section row the field is absent — never fabricated from the payload", () => {
    const payload = buildPayload(SCHEMA, {
      answers: { zip: "07032", typed_in_the_payload: "SHOULD NEVER BE SENT" },
    });
    expect(payload).toEqual({ lead: { plan: "gold" } });
  });

  it("the row's format overrides the node's; where the row declares none, the node's stands", () => {
    const schema: LeadgenPayloadSchema = {
      version: 1,
      root: {
        type: "object",
        children: [
          { path: "a", name: "a", type: "string", source: "answer", value_map: { x: "NODE" } },
          { path: "b", name: "b", type: "string", source: "answer", value_map: { x: "NODE" } },
        ],
      },
    };
    const payload = buildPayload(schema, {
      answers: { q: "x" },
      answer_bindings: {
        a: [{ internal_field: "q", value_map: { x: "ROW" } }],
        b: [{ internal_field: "q" }],
      },
    });
    expect(payload).toEqual({ a: "ROW", b: "NODE" });
  });

  it("two Sections mapping one field: the one the visitor ANSWERED wins, else the first", () => {
    const schema: LeadgenPayloadSchema = {
      version: 1,
      root: { type: "object", children: [{ path: "zip", name: "zip", type: "string", source: "answer" }] },
    };
    const bindings = { zip: [{ internal_field: "auto_zip" }, { internal_field: "home_zip" }] };
    // only the SECOND Section's question was answered
    expect(buildPayload(schema, { answers: { home_zip: "10001" }, answer_bindings: bindings })).toEqual({
      zip: "10001",
    });
    // both answered → the funnel's first Section wins
    expect(
      buildPayload(schema, { answers: { auto_zip: "07032", home_zip: "10001" }, answer_bindings: bindings }),
    ).toEqual({ zip: "07032" });
    // neither answered → the first row's default/fallback machinery, then absent
    expect(buildPayload(schema, { answers: {}, answer_bindings: bindings })).toEqual({});
  });

  // --- rename safety -------------------------------------------------------

  it("renaming a payload field moves its Section mappings — descendants included", async () => {
    const h = harness();
    const offer = seedOffer(h.sdb, "a", "quote_funnel", "life");
    const section = seedSection(h.sdb, "s1");
    seedSchema(h.sdb, offer, {
      version: 1,
      root: { type: "object", children: [{ path: "lead.zip", name: "zip", type: "string", source: "answer" }] },
    });
    seedMap(h.sdb, { sectionId: section, offerId: offer, internal_field: "zip", path: "lead.zip" });
    seedMap(h.sdb, { sectionId: section, offerId: offer, internal_field: "city", path: "lead" });

    const res = await admin.request(
      `${API}/offers/${offer}/payload-schemas`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          schema_json: {
            version: 1,
            root: { type: "object", children: [{ path: "applicant.zip", name: "zip", type: "string", source: "answer" }] },
          },
          renamed_paths: [{ from: "lead", to: "applicant" }],
        }),
      },
      h.env,
    );
    expect(res.status, await res.clone().text()).toBe(201);
    expect((await res.json()) as { remapped_answer_maps: number }).toMatchObject({
      remapped_answer_maps: 2,
    });
    const paths = (
      h.sdb
        .prepare("SELECT offer_payload_field_path AS p FROM leadgen_section_answer_maps ORDER BY id")
        .all() as Array<{ p: string }>
    ).map((r) => r.p);
    expect(paths).toEqual(["applicant.zip", "applicant"]);
    // and the binding still resolves under the new path
    const bindings = await readAnswerBindings(h.db, [offer]);
    expect(bindings.get(offer)?.["applicant.zip"]).toEqual([{ internal_field: "zip" }]);
  });

  // --- the Section side ----------------------------------------------------

  it("the Section's Offers tab lists Offers matching its activity AND vertical, with their payload fields", async () => {
    const h = harness();
    const match = seedOffer(h.sdb, "match", "quote_funnel", "life");
    seedOffer(h.sdb, "othervert", "quote_funnel", "auto");
    seedOffer(h.sdb, "otheract", "newsletter", "life");
    seedSchema(h.sdb, match, SCHEMA);
    const section = seedSection(h.sdb, "s1", "quote_funnel", "life");
    seedMap(h.sdb, { sectionId: section, offerId: match, internal_field: "zip", path: "lead.zip" });

    const res = await admin.request(`${API}/sections/${sectionPublicId("s1")}/offers`, {}, h.env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      offers: Array<{ offer_name: string; answer_fields: Array<{ path: string }> }>;
      mappings: Array<{ internal_field: string; offer_payload_field_path: string }>;
    };
    expect(body.offers.map((o) => o.offer_name)).toEqual(["match"]);
    expect(body.offers[0]!.answer_fields.map((f) => f.path)).toEqual(["lead.zip", "lead.legacy"]);
    expect(body.mappings).toHaveLength(1);
    expect(body.mappings[0]).toMatchObject({ internal_field: "zip", offer_payload_field_path: "lead.zip" });
  });
});
