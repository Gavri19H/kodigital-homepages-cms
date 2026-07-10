// LeadGen v2.5 Phase C — Section-level design_overrides SAVE validation
// (redesign-contract-v2.5 09 §9.5): `leadgen_sections.design_overrides_json`
// now ACCEPTS the sparse layer-4 shape
//   { palette?: {role: role-or-hex}, columnsDefault?, gapDefault? }
// alongside the existing §14.8 curated per-node token keys. The READERS
// existed since Phase A (config-dto parseSectionDesignOverrides → presets
// layer 4); the WRITER was blocked by the curated-key check in
// leadgen/sections.ts — these tests pin the unblocked validator:
//   1. pure validateSection legs — accepted shapes, path-precise rejections
//      (unknown top-level keys, unknown palette roles, bad palette values,
//      out-of-clamp columnsDefault, arbitrary-CSS gapDefault), curated keys
//      unchanged;
//   2. end-to-end PATCH → persisted design_overrides_json → content_html
//      re-rendered WITH the layer-4 overrides applied (grid columns/gap +
//      palette re-points, §5.7 "persists content_html via the shared renderer
//      WITH sectionCtx").

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import admin from "../src/admin/router";
import type { Env } from "../src/env";
import { validateSection } from "../src/leadgen/sections";
import { defaultFunnelDesign } from "../src/public/leadgen/designs/default-funnel/tokens";

// --- node:sqlite harness (repo pattern) --------------------------------------

type SqliteStatement = {
  run(...params: unknown[]): unknown;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
};
type SqliteDb = {
  prepare(sql: string): SqliteStatement;
  close(): void;
  [method: string]: unknown;
};
type DatabaseSyncCtor = new (path: string) => SqliteDb;

function loadDatabaseSync(): DatabaseSyncCtor | null {
  try {
    const { createRequire } = require("node:module") as typeof import("node:module");
    const nodeRequire = createRequire(import.meta.url);
    const mod = nodeRequire("node:sqlite") as { DatabaseSync: DatabaseSyncCtor };
    return mod.DatabaseSync;
  } catch {
    try {
      const getBuiltin = (process as unknown as {
        getBuiltinModule?: (name: string) => unknown;
      }).getBuiltinModule;
      if (typeof getBuiltin === "function") {
        const mod = getBuiltin("node:sqlite") as { DatabaseSync: DatabaseSyncCtor };
        return mod.DatabaseSync;
      }
    } catch {
      /* fall through */
    }
    return null;
  }
}

function runSql(sdb: SqliteDb, sql: string): void {
  (sdb["exec"] as (s: string) => void)(sql);
}

function d1FromSqlite(sdb: SqliteDb): D1Database {
  const db = {
    prepare(sql: string) {
      let binds: unknown[] = [];
      const stmt = {
        bind(...a: unknown[]) {
          binds = a;
          return stmt;
        },
        async first<T = unknown>(): Promise<T | null> {
          const r = sdb.prepare(sql).get(...binds);
          return (r ?? null) as T | null;
        },
        async all<T = unknown>() {
          const rows = sdb.prepare(sql).all(...binds);
          return { results: rows as T[], success: true, meta: {} };
        },
        async run() {
          const r = sdb.prepare(sql).run(...binds) as {
            changes?: number;
            lastInsertRowid?: number | bigint;
          };
          return {
            success: true,
            meta: { changes: Number(r?.changes ?? 0), last_row_id: Number(r?.lastInsertRowid ?? 0) },
          };
        },
      };
      return stmt;
    },
    async batch(statements: Array<{ run(): Promise<unknown> }>) {
      runSql(sdb, "BEGIN");
      const results: unknown[] = [];
      try {
        for (const statement of statements) {
          results.push(await statement.run());
        }
        runSql(sdb, "COMMIT");
      } catch (err) {
        runSql(sdb, "ROLLBACK");
        throw err;
      }
      return results;
    },
  } as unknown as D1Database;
  return db;
}

const TEST_DIR = dirname(fileURLToPath(import.meta.url));

const LEADGEN_MIGRATIONS = [
  "0036_leadgen_core.sql",
  "0037_leadgen_analytics_mirror.sql",
  "0038_leadgen_revenue_infra.sql",
  "0039_leadgen_conversion_dedupe.sql",
] as const;

function createLeadgenDb(DatabaseSync: DatabaseSyncCtor): SqliteDb {
  const sdb = new DatabaseSync(":memory:");
  runSql(
    sdb,
    "CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT);" +
      "CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT);",
  );
  for (const file of LEADGEN_MIGRATIONS) {
    runSql(sdb, readFileSync(join(TEST_DIR, "../migrations", file), "utf8"));
  }
  return sdb;
}

function buildEnv(db: D1Database): Env {
  return {
    DB: db,
    CACHE: {} as KVNamespace,
    MEDIA: {} as R2Bucket,
    APP_ENV: "test",
    ADMIN_HOST: "localhost",
    ADMIN_BASE_URL: "http://localhost:8787",
    ADMIN_BASE_PATH: "/admin",
    CACHE_API_ENABLED: "false",
    HTML_CACHE_TTL_SECONDS: "60",
    OPENAI_TEXT_MODEL: "gpt-test",
    OPENAI_IMAGE_MODEL: "img-test",
    SITE_PROVISIONING_DRY_RUN: "true",
    SITE_PROVISIONING_ALLOW_ROUTE_MUTATION: "false",
    DEV_BYPASS_AUTH: "true",
  };
}

const DatabaseSync = loadDatabaseSync();
const describeDb = DatabaseSync === null ? describe.skip : describe;

function newHarness(): { sdb: SqliteDb; env: Env } {
  const ctor = DatabaseSync as DatabaseSyncCtor;
  const sdb = createLeadgenDb(ctor);
  return { sdb, env: buildEnv(d1FromSqlite(sdb)) };
}

const API = "/api/admin/leadgen";

function jsonInit(method: string, body: unknown): RequestInit {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

// --- fixtures -----------------------------------------------------------------

// A grid that leaves columns/gap UNSET (the §9.5 layer-4 defaults fill them)
// + a ContinueButton with no per-node colors (the palette re-points reach it).
const GRID_CONTENT = {
  components: [
    {
      type: "IconCardAnswerGrid",
      question_id: "g1",
      question_key: "coverage_q",
      internal_field: "coverage",
      answer_type: "enum",
      choices: [
        { label: "Up to $250k", value: "250k", analytics_id: "a_250", icon: "S" },
        { label: "Up to $1m", value: "1m", analytics_id: "a_1m", icon: "L" },
      ],
    },
    { type: "ContinueButton", question_id: "c1", props: { label: "Continue" } },
  ],
};

function sectionBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    section_name: "Coverage",
    activity: "quote_funnel",
    vertical: "life",
    headline_text: "How much coverage?",
    content_json: JSON.stringify(GRID_CONTENT),
    ...overrides,
  };
}

const VALID_95_OVERRIDES = {
  palette: { button_primary_bg: "accent", button_primary_text: "#00AA00" },
  columnsDefault: 4,
  gapDefault: "1.25rem",
};

// ===========================================================================
// 1. pure validateSection legs (leadgen/sections.ts §9.5 writer)
// ===========================================================================

describe("validateSection — §9.5 section-level design_overrides shapes", () => {
  const validate = (design_overrides: unknown): Record<string, string> =>
    validateSection(sectionBody({ design_overrides })).errors as Record<string, string>;

  it("accepts the full §9.5 shape (palette role→role, role→hex, columnsDefault, gapDefault)", () => {
    const result = validateSection(sectionBody({ design_overrides: VALID_95_OVERRIDES }));
    expect(result.errors).toEqual({});
    expect(result.value?.design_overrides_json).toBe(JSON.stringify(VALID_95_OVERRIDES));
  });

  it("accepts each §9.5 key alone and mixed with the existing curated per-node keys", () => {
    expect(validate({ palette: { accent: "brand_primary" } })).toEqual({});
    expect(validate({ columnsDefault: 2 })).toEqual({});
    expect(validate({ columnsDefault: 5 })).toEqual({});
    expect(validate({ gapDefault: "0.75rem" })).toEqual({});
    // §14.8 curated keys keep validating exactly as before, §9.5 keys beside them.
    expect(validate({ iconColor: "#1B3A5C", gridGap: "1rem", palette: { error: "#CC0000" } })).toEqual({});
  });

  it("rejects unknown top-level keys path-precisely (§14.8 unchanged)", () => {
    const errors = validate({ bogus: "x", columnsDefault: 3 });
    expect(Object.keys(errors)).toEqual(["design_overrides.bogus"]);
    expect(errors["design_overrides.bogus"]).toContain("not a curated design-override token key");
  });

  it("rejects unknown palette roles and non role-or-hex palette values, path-precise per role", () => {
    const errors = validate({
      palette: { hotpink: "#FF00FF", accent: "not-a-role", error: "#12" },
    });
    expect(errors["design_overrides.palette.hotpink"]).toContain("not a theme colour role");
    expect(errors["design_overrides.palette.accent"]).toContain("must be a theme colour role");
    expect(errors["design_overrides.palette.error"]).toContain("must be a theme colour role");
    expect(Object.keys(errors)).toHaveLength(3);
    // non-record palette
    expect(validate({ palette: "accent" })["design_overrides.palette"]).toContain("must be an object");
  });

  it("clamps columnsDefault to the renderer range (integer 2..5)", () => {
    for (const bad of [1, 6, 3.5, "3", true, null]) {
      const errors = validate({ columnsDefault: bad });
      expect(errors["design_overrides.columnsDefault"], `columnsDefault=${String(bad)}`).toContain(
        "integer between 2 and 5",
      );
    }
  });

  it("gapDefault must be a fixed spacing token — arbitrary CSS rejected (§14.10)", () => {
    expect(validate({ gapDefault: "1rem;background:url(x)" })["design_overrides.gapDefault"]).toContain(
      "not arbitrary CSS",
    );
    expect(validate({ gapDefault: "" })["design_overrides.gapDefault"]).toContain("spacing token string");
    expect(validate({ gapDefault: 4 })["design_overrides.gapDefault"]).toContain("spacing token string");
  });

  it("still rejects arbitrary CSS in curated keys (pre-§9.5 rule untouched)", () => {
    const errors = validate({ gridGap: "1rem;}" });
    expect(errors["design_overrides.gridGap"]).toContain("not arbitrary CSS");
  });
});

// ===========================================================================
// 2. end-to-end: PATCH → persisted → content_html rendered with layer 4
// ===========================================================================

describeDb("PATCH /sections/:id — §9.5 overrides persist + render into content_html (05 §5.7)", () => {
  async function createSection(env: Env): Promise<{ id: number; public_id: string }> {
    const res = await admin.request(`${API}/sections`, jsonInit("POST", sectionBody()), env);
    expect(res.status, `create: ${await res.clone().text()}`).toBe(201);
    return (await res.json()) as { id: number; public_id: string };
  }

  it("valid §9.5 overrides: 200, persisted verbatim, content_html re-rendered with columns/gap/palette applied", async () => {
    const { sdb, env } = newHarness();
    const section = await createSection(env);

    // Pre-PATCH: the grid renders the design defaults (3 cols, token gap) and
    // the continue button carries no --lg-btn-bg.
    const before = sdb
      .prepare("SELECT content_html, design_overrides_json FROM leadgen_sections WHERE id = ?")
      .get(section.id) as { content_html: string; design_overrides_json: string | null };
    expect(before.design_overrides_json).toBeNull();
    expect(before.content_html).toContain(`--lg-cols:${defaultFunnelDesign.iconCardGrid.columnsDesktop}`);
    expect(before.content_html).not.toContain("--lg-btn-bg");

    const patch = await admin.request(
      `${API}/sections/${section.public_id}`,
      jsonInit("PATCH", { design_overrides: VALID_95_OVERRIDES }),
      env,
    );
    expect(patch.status, await patch.clone().text()).toBe(200);

    const after = sdb
      .prepare("SELECT content_html, design_overrides_json FROM leadgen_sections WHERE id = ?")
      .get(section.id) as { content_html: string; design_overrides_json: string };
    // persisted verbatim (§9.5 shape survives the round-trip)
    expect(JSON.parse(after.design_overrides_json)).toEqual(VALID_95_OVERRIDES);
    // layer 4 rendered into the persisted html (05 §5.7 shared renderer WITH ctx):
    // columnsDefault fills the grid slot the node left unset…
    expect(after.content_html).toContain('style="--lg-cols:4;gap:1.25rem"');
    // …and the palette re-points reach the continue control (role → base token;
    // hex literal renders as-is).
    expect(after.content_html).toContain(`--lg-btn-bg:${defaultFunnelDesign.color.accent}`);
    expect(after.content_html).toContain("color:#00AA00");
  });

  it("unknown §9.5-level key via PATCH → 400 with the path-precise field", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const patch = await admin.request(
      `${API}/sections/${section.public_id}`,
      jsonInit("PATCH", { design_overrides: { palette: { accent: "brand_primary" }, sneaky: 1 } }),
      env,
    );
    expect(patch.status).toBe(400);
    const body = (await patch.json()) as { fields: Record<string, string> };
    expect(body.fields["design_overrides.sneaky"]).toContain("not a curated design-override token key");
  });

  it("bad palette entry via PATCH → 400 path-precise; nothing persists", async () => {
    const { sdb, env } = newHarness();
    const section = await createSection(env);
    const patch = await admin.request(
      `${API}/sections/${section.public_id}`,
      jsonInit("PATCH", { design_overrides: { palette: { accent: "javascript:alert(1)" } } }),
      env,
    );
    expect(patch.status).toBe(400);
    const body = (await patch.json()) as { fields: Record<string, string> };
    expect(body.fields["design_overrides.palette.accent"]).toBeDefined();
    const row = sdb
      .prepare("SELECT design_overrides_json FROM leadgen_sections WHERE id = ?")
      .get(section.id) as { design_overrides_json: string | null };
    expect(row.design_overrides_json).toBeNull();
  });

  it("existing curated PER-NODE overrides in content_json still validate through PATCH (§9.4 unchanged)", async () => {
    const { sdb, env } = newHarness();
    const section = await createSection(env);
    const content = {
      components: [
        {
          ...GRID_CONTENT.components[0],
          design_overrides: { iconColor: "accent", columns: 2, gridGap: "0.5rem" },
        },
        GRID_CONTENT.components[1],
      ],
    };
    const patch = await admin.request(
      `${API}/sections/${section.public_id}`,
      jsonInit("PATCH", { content_json: JSON.stringify(content) }),
      env,
    );
    expect(patch.status, await patch.clone().text()).toBe(200);
    const row = sdb
      .prepare("SELECT content_html FROM leadgen_sections WHERE id = ?")
      .get(section.id) as { content_html: string };
    // the per-node role value resolved via §9.4 (accent role → base token).
    expect(row.content_html).toContain(`color:${defaultFunnelDesign.color.accent}`);
    expect(row.content_html).toContain("--lg-cols:2");
  });

  it("section-level curated keys (pre-§9.5 bag) keep saving unchanged", async () => {
    const { sdb, env } = newHarness();
    const section = await createSection(env);
    const patch = await admin.request(
      `${API}/sections/${section.public_id}`,
      jsonInit("PATCH", { design_overrides: { iconColor: "#1B3A5C", mobileBehavior: "stack" } }),
      env,
    );
    expect(patch.status, await patch.clone().text()).toBe(200);
    const row = sdb
      .prepare("SELECT design_overrides_json FROM leadgen_sections WHERE id = ?")
      .get(section.id) as { design_overrides_json: string };
    expect(JSON.parse(row.design_overrides_json)).toEqual({ iconColor: "#1B3A5C", mobileBehavior: "stack" });
  });
});
