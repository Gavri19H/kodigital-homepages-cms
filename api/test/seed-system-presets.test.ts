import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SUPPORTED_TEXT_MODELS, SUPPORTED_IMAGE_MODELS } from "../src/ai/models";

// T5 / Rescue 4: seed editable is_system=1 prompt presets for every automatic
// provisioning task (migration 0020). RC-011 backs T5-AC1, RC-012 backs
// T5-AC2 (the deploy.yml grep anchor).
//
// Part 1 parses the seed migration SQL into structured rows and asserts every
// provisioning task key is seeded as is_system=1 with a real, non-empty,
// editable prompt and that the seed is idempotent (INSERT OR IGNORE on the
// slug UNIQUE index, no duplicate slug). Like the 0019 schema test this is the
// portable proof: CI floor is Node 20 (package.json engines) where
// node:sqlite's DatabaseSync (Node >= 22.5) is unavailable.
//
// Part 2 (skipped where node:sqlite is absent) actually applies the seed INSERT
// twice against an in-memory SQLite DB and asserts the row count is identical
// after the second apply — a live, behavioral idempotency proof.
//
// Every it() title embeds the literal [api/test/seed-system-presets.test.ts] so
// the evidence runner's parse_test_output route observes a per-test name
// matching the RC-011 expected_test_name_regex.

const MIGRATIONS_DIR = resolve(__dirname, "..", "migrations");
const MIGRATION_0020 = "0020_rescue4_seed_system_presets.sql";

// The six automatic provisioning task keys this story must seed (story intent
// BCL-044): each is the resolvable `category` lookup key; slug is system-<key>.
const TASK_KEYS = [
  "starter-articles",
  "tagline",
  "site-description",
  "logo",
  "hero-image",
  "feature-image",
] as const;

const IMAGE_TASK_KEYS = new Set(["logo", "hero-image", "feature-image"]);

function readMigration(): string {
  return readFileSync(join(MIGRATIONS_DIR, MIGRATION_0020), "utf8");
}

// Strip -- line comments so the SQL parser only sees the statement body.
function stripComments(sql: string): string {
  return sql.replace(/--[^\n]*\n/g, "\n");
}

// Split on top-level commas, respecting single-quoted strings ('' escapes) and
// parenthesis depth. Used both to split VALUES into row groups and a row into
// its fields.
function splitTopLevel(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let inStr = false;
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      cur += c;
      if (c === "'") {
        if (s[i + 1] === "'") {
          cur += "'";
          i++;
        } else {
          inStr = false;
        }
      }
      continue;
    }
    if (c === "'") {
      inStr = true;
      cur += c;
      continue;
    }
    if (c === "(") depth++;
    else if (c === ")") depth--;
    if (c === "," && depth === 0) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  if (cur.trim().length > 0) out.push(cur);
  return out;
}

// SQL literal -> JS value: 'string' (unescaped), NULL, or a numeric literal.
function parseField(raw: string): string | number | null {
  const t = raw.trim();
  if (/^null$/i.test(t)) return null;
  if (t.startsWith("'") && t.endsWith("'")) {
    return t.slice(1, -1).replace(/''/g, "'");
  }
  const n = Number(t);
  return Number.isNaN(n) ? t : n;
}

interface SeededPreset {
  slug: string;
  prompt_template: string | number | null;
  category: string | number | null;
  is_system: string | number | null;
  is_active: string | number | null;
  name: string | number | null;
  system_prompt_template: string | number | null;
  user_prompt_template: string | number | null;
  text_model: string | number | null;
  image_model: string | number | null;
}

// Parse the single INSERT ... VALUES statement into column-keyed rows.
function parseSeed(sql: string): { columns: string[]; rows: SeededPreset[] } {
  const body = stripComments(sql);
  const colMatch = body.match(
    /INSERT\s+OR\s+IGNORE\s+INTO\s+prompt_presets\s*\(([\s\S]*?)\)\s*VALUES/i,
  );
  if (!colMatch) throw new Error("could not locate INSERT column list");
  const columns = splitTopLevel(colMatch[1] ?? "").map((c) => c.trim());

  const valuesPart = body.slice(body.toUpperCase().indexOf("VALUES") + "VALUES".length);
  const valuesBody = valuesPart.trim().replace(/;\s*$/, "");
  const rowGroups = splitTopLevel(valuesBody)
    .map((g) => g.trim())
    .filter((g) => g.startsWith("(") && g.endsWith(")"));

  const rows = rowGroups.map((g) => {
    const fields = splitTopLevel(g.slice(1, -1)).map(parseField);
    const obj: Record<string, string | number | null> = {};
    columns.forEach((col, idx) => {
      obj[col] = fields[idx] ?? null;
    });
    return obj as unknown as SeededPreset;
  });
  return { columns, rows };
}

describe("0020_rescue4_seed_system_presets.sql — T5 seed (AC1)", () => {
  it("[api/test/seed-system-presets.test.ts] the seed migration exists in the migrations directory", () => {
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
    expect(files).toContain(MIGRATION_0020);
  });

  it("[api/test/seed-system-presets.test.ts] uses INSERT OR IGNORE (idempotent) and no destructive ops", () => {
    const sql = readMigration();
    expect(sql).toMatch(/INSERT\s+OR\s+IGNORE\s+INTO\s+prompt_presets/i);
    expect(sql).not.toMatch(/DROP\s+TABLE/i);
    expect(sql).not.toMatch(/DROP\s+INDEX/i);
    expect(sql).not.toMatch(/CREATE\s+TABLE/i);
    expect(sql).not.toMatch(/DELETE\s+FROM/i);
    expect(sql).not.toMatch(/UPDATE\s+prompt_presets/i);
  });

  it("[api/test/seed-system-presets.test.ts] seeds an is_system=1 preset for every provisioning task key", () => {
    const { rows } = parseSeed(readMigration());
    const byKey = new Map(rows.map((r) => [String(r.category), r]));
    for (const key of TASK_KEYS) {
      const row = byKey.get(key);
      expect(row, `missing seed for task key ${key}`).toBeDefined();
      expect(Number(row!.is_system)).toBe(1);
      expect(Number(row!.is_active)).toBe(1);
      expect(row!.slug).toBe(`system-${key}`);
    }
    // No extra rows beyond the six declared task keys.
    expect(rows).toHaveLength(TASK_KEYS.length);
  });

  it("[api/test/seed-system-presets.test.ts] every seeded preset carries a real, non-empty editable prompt", () => {
    const { rows } = parseSeed(readMigration());
    for (const row of rows) {
      const flat = typeof row.prompt_template === "string" ? row.prompt_template.trim() : "";
      const sys =
        typeof row.system_prompt_template === "string" ? row.system_prompt_template.trim() : "";
      const usr =
        typeof row.user_prompt_template === "string" ? row.user_prompt_template.trim() : "";
      // prompt_template is NOT NULL (migration 0001) — must be a real prompt.
      expect(flat.length, `empty prompt_template for ${row.slug}`).toBeGreaterThan(0);
      // The reference System/User split must also be populated and editable.
      expect(sys.length, `empty system_prompt_template for ${row.slug}`).toBeGreaterThan(0);
      expect(usr.length, `empty user_prompt_template for ${row.slug}`).toBeGreaterThan(0);
      expect(row.name, `missing display name for ${row.slug}`).toBeTruthy();
    }
  });

  it("[api/test/seed-system-presets.test.ts] slugs are unique (no in-migration duplicate → idempotent)", () => {
    const { rows } = parseSeed(readMigration());
    const slugs = rows.map((r) => r.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("[api/test/seed-system-presets.test.ts] bakes only supported model ids (image models on image tasks)", () => {
    const { rows } = parseSeed(readMigration());
    const textOk = new Set<string>(SUPPORTED_TEXT_MODELS as readonly string[]);
    const imageOk = new Set<string>(SUPPORTED_IMAGE_MODELS as readonly string[]);
    for (const row of rows) {
      if (typeof row.text_model === "string") {
        expect(textOk.has(row.text_model), `unsupported text_model ${row.text_model}`).toBe(true);
      }
      if (typeof row.image_model === "string") {
        expect(imageOk.has(row.image_model), `unsupported image_model ${row.image_model}`).toBe(
          true,
        );
      }
      // Image provisioning tasks must declare a supported image_model.
      if (IMAGE_TASK_KEYS.has(String(row.category))) {
        expect(typeof row.image_model, `image task ${row.slug} lacks image_model`).toBe("string");
      }
    }
  });
});

// --- Part 2: live SQLite idempotency proof (Node >= 22.5 only) -------------
describe("0020 seed applies idempotently against live SQLite (AC1)", () => {
  it("[api/test/seed-system-presets.test.ts] re-applying the seed does not duplicate rows", async (ctx) => {
    // Load node:sqlite via Node's native resolver (createRequire) — vite's SSR
    // transform cannot resolve the bare `node:sqlite` dynamic import.
    let DatabaseSync: typeof import("node:sqlite").DatabaseSync;
    try {
      const { createRequire } = await import("node:module");
      const nodeRequire = createRequire(import.meta.url);
      ({ DatabaseSync } = nodeRequire("node:sqlite") as typeof import("node:sqlite"));
    } catch {
      // CI floor (Node 20): node:sqlite unavailable — the SQL-text parse above
      // is the portable idempotency proof.
      ctx.skip();
      return;
    }

    const sql = readMigration();
    const stripped = stripComments(sql);
    const insertStmt = stripped.slice(stripped.toUpperCase().indexOf("INSERT")).trim();

    // Minimal prompt_presets schema (static, no interpolation) reproducing the
    // migration-0001 columns the seed INSERT names — slug is UNIQUE so
    // INSERT OR IGNORE dedupes on re-apply.
    const CREATE_TABLE =
      "CREATE TABLE prompt_presets (" +
      "id INTEGER PRIMARY KEY AUTOINCREMENT, " +
      "slug TEXT NOT NULL UNIQUE, prompt_template TEXT, category TEXT, " +
      "variables TEXT, is_system INTEGER, is_active INTEGER, name TEXT, " +
      "description TEXT, system_prompt_template TEXT, user_prompt_template TEXT, " +
      "text_model TEXT, image_model TEXT)";

    const db = new DatabaseSync(":memory:");
    db.prepare(CREATE_TABLE).run();
    const countSystem = () =>
      (
        db.prepare("SELECT COUNT(*) AS n FROM prompt_presets WHERE is_system = 1").get() as {
          n: number;
        }
      ).n;

    db.prepare(insertStmt).run();
    const afterFirst = countSystem();
    db.prepare(insertStmt).run(); // re-apply
    const afterSecond = countSystem();

    expect(afterFirst).toBe(TASK_KEYS.length);
    expect(afterSecond).toBe(afterFirst); // idempotent: no duplicates

    // Each task key resolves to exactly one is_system=1 row with a prompt.
    for (const key of TASK_KEYS) {
      const resolved = db
        .prepare(
          "SELECT slug, prompt_template FROM prompt_presets WHERE category = ? AND is_system = 1",
        )
        .all(key) as Array<{ slug: string; prompt_template: string }>;
      expect(resolved, `task key ${key} did not resolve to one row`).toHaveLength(1);
      expect(resolved[0]?.prompt_template.length ?? 0).toBeGreaterThan(0);
    }
    db.close();
  });
});
