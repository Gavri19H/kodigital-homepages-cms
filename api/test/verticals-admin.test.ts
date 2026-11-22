// X01 Part C (owner, 22 Nov 2026): manage verticals in the CMS.
//
// Runs the REAL admin router over a real in-memory SQLite (node:sqlite) built
// from EVERY migration in api/migrations (0001 → 0067), so the schema, the
// seeded verticals, the UNIQUE slug index and the foreign keys (sites →
// verticals.slug, category_verticals → verticals ON DELETE CASCADE) are the
// production ones. Skipped where node:sqlite is absent (Node 20 floor); run
// with NODE_OPTIONS=--experimental-sqlite on Node 22.
//
// Covers (plan X01 §8 "Done when", Part C):
//   - Add vertical: new row at the end; shows in the New Site and Article
//     editor pickers and in GET /api/admin/verticals (the Categories modal's
//     source); duplicate slug 409; bad slug 400.
//   - Delete vertical: refused 409 VERTICAL_IN_USE with "(N Sites, M Articles)"
//     while a Site or an Article uses it; on an unused one the row and its
//     Category links go.
//   - Article editor "Vertical": PATCH saves and clears it; unknown id 400.
//   - Articles "Set vertical": only the ticked Articles change.
//   - AI writer {{vertical}}: the Article's own vertical when set, else the
//     Site's.
//   - Articles "All verticals" filter: same rule.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

vi.mock("../src/ai/generators/text", () => ({
  generateStarterArticle: vi.fn(async () => ({
    ai_generation_id: "gen-text-1",
    idempotency_key: "k1",
    status: "success",
    parsed: {
      title: "Packing light for a long trip",
      subtitle: "Less in the bag, more on the road.",
      intro: "Intro one.\n\nIntro two.",
      key_idea: "Pack for the trip you take.",
      sections: [
        {
          heading: { level: 2, text: "Start with the shoes" },
          paragraphs: ["P1.", "P2.", "P3."],
          bullets: ["B1", "B2"],
        },
      ],
      takeaways: ["One", "Two"],
      editors_pick: { title: "A roll-top bag", why: "It fits under the seat." },
      faqs: [{ question: "Q?", answer: "A." }],
    },
  })),
}));

import admin from "../src/admin/router";
import { generateStarterArticle } from "../src/ai/generators/text";
import { listAdminArticlesFiltered } from "../src/admin/data";
import { verticalsListPage, articlesListPage, articleFormPage } from "../src/admin/templates";
import type { Env } from "../src/env";
import { buildEnv } from "./helpers/admin-test-kit";

type SqliteStatement = {
  run(...p: unknown[]): { changes?: number | bigint; lastInsertRowid?: number | bigint };
  get(...p: unknown[]): unknown;
  all(...p: unknown[]): unknown[];
};
type SqliteDb = { prepare(sql: string): SqliteStatement; close(): void; [m: string]: unknown };
type DatabaseSyncCtor = new (path: string) => SqliteDb;

function loadDatabaseSync(): DatabaseSyncCtor | null {
  try {
    return (createRequire(import.meta.url)("node:sqlite") as { DatabaseSync: DatabaseSyncCtor })
      .DatabaseSync;
  } catch {
    return null;
  }
}
const DatabaseSync = loadDatabaseSync();
const describeDb = DatabaseSync ? describe : describe.skip;

// Bracket-call: node:sqlite's exec is a pure SQL runner (no shell).
function runSql(sdb: SqliteDb, sql: string): void {
  (sdb["exec"] as (s: string) => void)(sql);
}

function d1FromSqlite(sdb: SqliteDb): D1Database {
  function stmtFor(sql: string) {
    let binds: unknown[] = [];
    const stmt = {
      bind(...a: unknown[]) {
        binds = a;
        return stmt;
      },
      async first<T = unknown>(): Promise<T | null> {
        return (sdb.prepare(sql).get(...binds) ?? null) as T | null;
      },
      async all<T = unknown>() {
        return { results: sdb.prepare(sql).all(...binds) as T[], success: true, meta: {} };
      },
      async run() {
        const r = sdb.prepare(sql).run(...binds);
        return {
          success: true,
          meta: { changes: Number(r?.changes ?? 0), last_row_id: Number(r?.lastInsertRowid ?? 0) },
        };
      },
    };
    return stmt;
  }
  return {
    prepare: stmtFor,
    // D1 batches are atomic: one transaction, rolled back on any error.
    async batch(statements: Array<{ run(): Promise<unknown> }>) {
      runSql(sdb, "BEGIN");
      const results: unknown[] = [];
      try {
        for (const s of statements) results.push(await s.run());
        runSql(sdb, "COMMIT");
      } catch (err) {
        runSql(sdb, "ROLLBACK");
        throw err;
      }
      return results;
    },
  } as unknown as D1Database;
}

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

function createDb(): SqliteDb {
  const sdb = new DatabaseSync!(":memory:");
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .sort();
  for (const f of files) runSql(sdb, readFileSync(join(MIGRATIONS_DIR, f), "utf8"));
  return sdb;
}

function verticalId(sdb: SqliteDb, slug: string): number {
  const row = sdb.prepare("SELECT id FROM verticals WHERE slug = ?").get(slug) as { id: number } | undefined;
  if (!row) throw new Error("no vertical " + slug);
  return row.id;
}

function addSite(sdb: SqliteDb, id: string, name: string, verticalSlug: string): void {
  sdb
    .prepare("INSERT INTO sites (id, name, domain, vertical_slug, status) VALUES (?, ?, ?, ?, 'active')")
    .run(id, name, id + ".example", verticalSlug);
}

function addArticle(sdb: SqliteDb, siteId: string, slug: string, title: string, ownVertical: number | null = null): number {
  const r = sdb
    .prepare(
      "INSERT INTO articles (site_id, slug, title, content_json, vertical_id, updated_at) VALUES (?, ?, ?, '{}', ?, 1000)",
    )
    .run(siteId, slug, title, ownVertical);
  return Number(r.lastInsertRowid);
}

function articleVertical(sdb: SqliteDb, id: number): number | null {
  const row = sdb.prepare("SELECT vertical_id FROM articles WHERE id = ?").get(id) as { vertical_id: number | null };
  return row.vertical_id;
}

function env(sdb: SqliteDb): Env {
  return buildEnv(d1FromSqlite(sdb));
}

async function call(
  sdb: SqliteDb,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await admin.request(
    path,
    {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    env(sdb),
  );
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

async function page(sdb: SqliteDb, path: string): Promise<string> {
  const res = await admin.request(path, { method: "GET" }, env(sdb));
  expect(res.status).toBe(200);
  return res.text();
}

describeDb("X01 Part C — Add vertical", () => {
  it("adds a vertical at the end of the list; it shows in the New Site, Categories and Article editor pickers", async () => {
    const sdb = createDb();
    const before = sdb.prepare("SELECT MAX(display_order) AS m FROM verticals").get() as { m: number };

    const res = await call(sdb, "POST", "/api/admin/verticals", { name: "Insurance", slug: "insurance" });
    expect(res.status).toBe(201);
    const created = res.json.resource as { id: number; slug: string; name: string; display_order: number };
    expect(created).toMatchObject({ slug: "insurance", name: "Insurance", display_order: before.m + 1 });

    // GET /api/admin/verticals — the list the Categories "New Category" modal
    // loads its vertical picker from.
    const list = await call(sdb, "GET", "/api/admin/verticals");
    const rows = list.json.resource as Array<{ slug: string }>;
    expect(rows[rows.length - 1]!.slug).toBe("insurance");

    // Domains → "+ New Site" picker.
    expect(await page(sdb, "/admin/domains")).toMatch(/<option value="insurance"[^>]*>Insurance<\/option>/);
    // Article editor "Vertical" picker (new and edit).
    expect(await page(sdb, "/admin/articles/new")).toContain(
      `<option value="${created.id}" data-slug="insurance">Insurance</option>`,
    );
    // Verticals screen row.
    const screen = await page(sdb, "/admin/verticals");
    expect(screen).toContain(`data-vertical-id="${created.id}"`);
    expect(screen).toContain('href="/admin/verticals" class="nav-item active"');
  });

  it("refuses a slug already in use (409) and a badly formed slug or empty name (400)", async () => {
    const sdb = createDb();
    const dup = await call(sdb, "POST", "/api/admin/verticals", { name: "Money", slug: "finance" });
    expect(dup.status).toBe(409);
    expect(dup.json.code).toBe("VERTICAL_SLUG_TAKEN");
    expect(String(dup.json.error)).toContain('"finance"');

    for (const slug of ["Home Insurance", "home_insurance", "-home", "home-", "home--insurance", ""]) {
      const bad = await call(sdb, "POST", "/api/admin/verticals", { name: "Home Insurance", slug });
      expect(bad.status, slug).toBe(400);
      expect(bad.json.code, slug).toBe("INVALID_SLUG");
    }
    const noName = await call(sdb, "POST", "/api/admin/verticals", { name: "  ", slug: "pets" });
    expect(noName.status).toBe(400);
    expect(noName.json.code).toBe("NAME_REQUIRED");

    const count = sdb.prepare("SELECT COUNT(*) AS n FROM verticals").get() as { n: number };
    expect(count.n).toBe(9); // the seeded 9, nothing added
  });
});

describeDb("X01 Part C — Delete vertical", () => {
  it("is refused while a Site uses it, with the counts in the message", async () => {
    const sdb = createDb();
    const finance = verticalId(sdb, "finance");
    addSite(sdb, "st_money", "Money Site", "finance");
    addArticle(sdb, "st_money", "a1", "First");
    addArticle(sdb, "st_money", "a2", "Second");

    const res = await call(sdb, "DELETE", `/api/admin/verticals/${finance}`);
    expect(res.status).toBe(409);
    expect(res.json.code).toBe("VERTICAL_IN_USE");
    expect(res.json.error).toBe(
      "Cannot delete vertical in use. Move its Sites and Articles first. (1 Sites, 2 Articles)",
    );
    expect(sdb.prepare("SELECT id FROM verticals WHERE id = ?").get(finance)).toBeDefined();
  });

  it("is refused while only an Article's own vertical uses it", async () => {
    const sdb = createDb();
    await call(sdb, "POST", "/api/admin/verticals", { name: "Insurance", slug: "insurance" });
    const insurance = verticalId(sdb, "insurance");
    addSite(sdb, "st_money", "Money Site", "finance");
    addArticle(sdb, "st_money", "a1", "Own vertical", insurance);

    const res = await call(sdb, "DELETE", `/api/admin/verticals/${insurance}`);
    expect(res.status).toBe(409);
    expect(res.json.error).toBe(
      "Cannot delete vertical in use. Move its Sites and Articles first. (0 Sites, 1 Articles)",
    );
  });

  it("on an unused vertical removes the row and only its Category links", async () => {
    const sdb = createDb();
    await call(sdb, "POST", "/api/admin/verticals", { name: "Insurance", slug: "insurance" });
    const insurance = verticalId(sdb, "insurance");
    const finance = verticalId(sdb, "finance");
    sdb.prepare("INSERT INTO categories (slug, name) VALUES ('cover', 'Cover')").run();
    sdb.prepare("INSERT INTO categories (slug, name) VALUES ('claims', 'Claims')").run();
    const cover = (sdb.prepare("SELECT id FROM categories WHERE slug = 'cover'").get() as { id: number }).id;
    const claims = (sdb.prepare("SELECT id FROM categories WHERE slug = 'claims'").get() as { id: number }).id;
    const link = sdb.prepare("INSERT INTO category_verticals (category_id, vertical_id) VALUES (?, ?)");
    link.run(cover, insurance);
    link.run(claims, insurance);
    link.run(cover, finance);
    const otherLinksBefore = (sdb.prepare("SELECT COUNT(*) AS n FROM category_verticals WHERE vertical_id <> ?").get(insurance) as { n: number }).n;

    // The screen shows the 2 Category links the confirm names.
    const screen = await page(sdb, "/admin/verticals");
    expect(screen).toContain(`data-delete-vertical="${insurance}" data-vertical-name="Insurance" data-vertical-categories="2"`);

    const res = await call(sdb, "DELETE", `/api/admin/verticals/${insurance}`);
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ ok: true, id: insurance, categories_unlinked: 2 });
    expect(sdb.prepare("SELECT id FROM verticals WHERE id = ?").get(insurance)).toBeUndefined();
    expect((sdb.prepare("SELECT COUNT(*) AS n FROM category_verticals WHERE vertical_id = ?").get(insurance) as { n: number }).n).toBe(0);
    expect((sdb.prepare("SELECT COUNT(*) AS n FROM category_verticals WHERE vertical_id <> ?").get(insurance) as { n: number }).n).toBe(otherLinksBefore);
    // Categories themselves stay.
    expect((sdb.prepare("SELECT COUNT(*) AS n FROM categories WHERE id IN (?, ?)").get(cover, claims) as { n: number }).n).toBe(2);

    const missing = await call(sdb, "DELETE", `/api/admin/verticals/${insurance}`);
    expect(missing.status).toBe(404);
  });
});

describeDb("X01 Part C — Verticals screen counts", () => {
  it("counts Sites by slug, Category links, and Articles (own vertical, or the Site's when empty)", async () => {
    const sdb = createDb();
    const travel = verticalId(sdb, "travel");
    const finance = verticalId(sdb, "finance");
    addSite(sdb, "st_money", "Money Site", "finance");
    addSite(sdb, "st_trips", "Trips Site", "travel");
    addArticle(sdb, "st_money", "m1", "Money one"); // finance via Site
    addArticle(sdb, "st_money", "m2", "Money two", travel); // own travel
    addArticle(sdb, "st_trips", "t1", "Trips one"); // travel via Site
    addArticle(sdb, "st_trips", "t2", "Trips two", finance); // own finance

    const html = await page(sdb, "/admin/verticals");
    function row(id: number): string {
      const m = html.match(new RegExp(`<tr data-vertical-id="${id}">([\\s\\S]*?)</tr>`));
      expect(m).not.toBeNull();
      return Array.from(m![1]!.matchAll(/<td>([^<]*)<\/td>/g)).map((x) => x[1]).join("|");
    }
    const financeLinks = (sdb.prepare("SELECT COUNT(*) AS n FROM category_verticals WHERE vertical_id = ?").get(finance) as { n: number }).n;
    expect(row(finance)).toBe(`Finance|finance|1|${financeLinks}|2`);
    const travelLinks = (sdb.prepare("SELECT COUNT(*) AS n FROM category_verticals WHERE vertical_id = ?").get(travel) as { n: number }).n;
    expect(row(travel)).toBe(`Travel|travel|1|${travelLinks}|2`);
  });
});

describeDb("X01 Part C — Article editor Vertical field", () => {
  it("saves the Article's vertical, clears it back to Same as site, and refuses an unknown one", async () => {
    const sdb = createDb();
    const travel = verticalId(sdb, "travel");
    addSite(sdb, "st_money", "Money Site", "finance");
    const id = addArticle(sdb, "st_money", "a1", "First");

    // Editor shows "Same as site (Finance)" selected while empty.
    let html = await page(sdb, `/admin/articles/${id}/edit`);
    expect(html).toContain('<option value="" data-same-as-site="1" selected>Same as site (Finance)</option>');

    const set = await call(sdb, "PATCH", `/api/admin/articles/${id}`, { vertical_id: travel });
    expect(set.status).toBe(200);
    expect(articleVertical(sdb, id)).toBe(travel);
    html = await page(sdb, `/admin/articles/${id}/edit`);
    expect(html).toContain(`<option value="${travel}" data-slug="travel" selected>Travel</option>`);

    // Saving other fields without vertical_id leaves it alone.
    const other = await call(sdb, "PATCH", `/api/admin/articles/${id}`, { title: "Renamed" });
    expect(other.status).toBe(200);
    expect(articleVertical(sdb, id)).toBe(travel);

    const clear = await call(sdb, "PATCH", `/api/admin/articles/${id}`, { vertical_id: null });
    expect(clear.status).toBe(200);
    expect(articleVertical(sdb, id)).toBeNull();

    const unknown = await call(sdb, "PATCH", `/api/admin/articles/${id}`, { vertical_id: 9999 });
    expect(unknown.status).toBe(400);
    expect(unknown.json.code).toBe("UNKNOWN_VERTICAL");
    const junk = await call(sdb, "PATCH", `/api/admin/articles/${id}`, { vertical_id: "abc" });
    expect(junk.status).toBe(400);
    expect(articleVertical(sdb, id)).toBeNull();
  });

  it("accepts a vertical on Article create", async () => {
    const sdb = createDb();
    const travel = verticalId(sdb, "travel");
    addSite(sdb, "st_money", "Money Site", "finance");
    const res = await call(sdb, "POST", "/api/admin/articles", {
      site_id: "st_money",
      slug: "new-one",
      title: "New one",
      vertical_id: travel,
    });
    expect(res.status).toBe(201);
    const art = res.json.article as { id: number; vertical_id: number | null };
    expect(art.vertical_id).toBe(travel);
    const plain = await call(sdb, "POST", "/api/admin/articles", {
      site_id: "st_money",
      slug: "new-two",
      title: "New two",
    });
    expect((plain.json.article as { vertical_id: number | null }).vertical_id).toBeNull();
  });
});

describeDb("X01 Part C — Articles Set vertical (bulk)", () => {
  it("changes only the ticked Articles, and only their vertical", async () => {
    const sdb = createDb();
    const travel = verticalId(sdb, "travel");
    const food = verticalId(sdb, "food");
    addSite(sdb, "st_money", "Money Site", "finance");
    const a = addArticle(sdb, "st_money", "a", "A");
    const b = addArticle(sdb, "st_money", "b", "B");
    const c = addArticle(sdb, "st_money", "c", "C", food);

    const res = await call(sdb, "POST", "/api/admin/articles/bulk-vertical", {
      article_ids: [a, b, b],
      vertical_id: travel,
    });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ ok: true, updated: 2, requested: 2, vertical_id: travel });
    expect(articleVertical(sdb, a)).toBe(travel);
    expect(articleVertical(sdb, b)).toBe(travel);
    expect(articleVertical(sdb, c)).toBe(food); // not ticked → untouched
    const upd = sdb.prepare("SELECT updated_at FROM articles WHERE id IN (?, ?, ?)").all(a, b, c) as Array<{ updated_at: number }>;
    expect(upd.every((r) => r.updated_at === 1000)).toBe(true);

    // "Same as site" clears.
    const clear = await call(sdb, "POST", "/api/admin/articles/bulk-vertical", { article_ids: [a], vertical_id: null });
    expect(clear.status).toBe(200);
    expect(articleVertical(sdb, a)).toBeNull();
    expect(articleVertical(sdb, b)).toBe(travel);
  });

  it("works past one statement's binding limit and refuses bad input", async () => {
    const sdb = createDb();
    const travel = verticalId(sdb, "travel");
    addSite(sdb, "st_money", "Money Site", "finance");
    const ids: number[] = [];
    for (let i = 0; i < 170; i++) ids.push(addArticle(sdb, "st_money", "s" + i, "T" + i));
    const res = await call(sdb, "POST", "/api/admin/articles/bulk-vertical", { article_ids: ids, vertical_id: travel });
    expect(res.status).toBe(200);
    expect(res.json.updated).toBe(170);

    const tooMany = await call(sdb, "POST", "/api/admin/articles/bulk-vertical", {
      article_ids: Array.from({ length: 201 }, (_, i) => i + 1),
      vertical_id: travel,
    });
    expect(tooMany.status).toBe(400);
    expect(tooMany.json.code).toBe("TOO_MANY_ARTICLES");
    expect((await call(sdb, "POST", "/api/admin/articles/bulk-vertical", { article_ids: [], vertical_id: travel })).status).toBe(400);
    expect((await call(sdb, "POST", "/api/admin/articles/bulk-vertical", { article_ids: ["x"], vertical_id: travel })).status).toBe(400);
    const unknown = await call(sdb, "POST", "/api/admin/articles/bulk-vertical", { article_ids: [ids[0]], vertical_id: 9999 });
    expect(unknown.status).toBe(400);
    expect(unknown.json.code).toBe("UNKNOWN_VERTICAL");
  });

  it("the Articles list has row checkboxes and the Set vertical action", async () => {
    const sdb = createDb();
    addSite(sdb, "st_money", "Money Site", "finance");
    const a = addArticle(sdb, "st_money", "a", "A");
    const html = await page(sdb, "/admin/articles?site_id=st_money");
    expect(html).toContain(`<input type="checkbox" class="article-select" value="${a}"`);
    expect(html).toContain('id="bulk-set-vertical"');
    expect(html).toContain('<option value="">Same as site</option>');
  });
});

describeDb("X01 Part C — AI writer {{vertical}}", () => {
  beforeEach(() => {
    vi.mocked(generateStarterArticle).mockClear();
  });

  async function writerVertical(sdb: SqliteDb, extra: Record<string, unknown>): Promise<string> {
    const res = await call(sdb, "POST", "/api/admin/ai/article", {
      site_id: "st_money",
      title: "Packing light",
      images: { hero: false, mid: false },
      ...extra,
    });
    expect(res.status).toBe(200);
    const calls = vi.mocked(generateStarterArticle).mock.calls;
    const input = calls[calls.length - 1]![1] as { vertical: string };
    return input.vertical;
  }

  it("uses the Article's own vertical when set, else the Site's", async () => {
    const sdb = createDb();
    const travel = verticalId(sdb, "travel");
    addSite(sdb, "st_money", "Money Site", "finance");
    const own = addArticle(sdb, "st_money", "own", "Own vertical", travel);
    const plain = addArticle(sdb, "st_money", "plain", "No own vertical");

    // The open Article's saved vertical wins over the Site's.
    expect(await writerVertical(sdb, { article_id: own })).toBe("travel");
    // No own vertical → the Site's.
    expect(await writerVertical(sdb, { article_id: plain })).toBe("finance");
    // The editor's live choice wins: "Same as site" (null) → the Site's…
    expect(await writerVertical(sdb, { article_id: own, vertical_id: null })).toBe("finance");
    // …and a picked vertical → that one, even before saving.
    expect(await writerVertical(sdb, { article_id: plain, vertical_id: travel })).toBe("travel");
    // A new Article (no id, no field) → the Site's, as before.
    expect(await writerVertical(sdb, {})).toBe("finance");
  });
});

describeDb("X01 Part C — Articles All verticals filter", () => {
  it("matches the Article's own vertical, or the Site's when empty", async () => {
    const sdb = createDb();
    const travel = verticalId(sdb, "travel");
    const finance = verticalId(sdb, "finance");
    addSite(sdb, "st_money", "Money Site", "finance");
    addSite(sdb, "st_trips", "Trips Site", "travel");
    addArticle(sdb, "st_money", "m1", "Money via site");
    addArticle(sdb, "st_money", "m2", "Money own travel", travel);
    addArticle(sdb, "st_trips", "t1", "Trips via site");
    addArticle(sdb, "st_trips", "t2", "Trips own finance", finance);

    const envDb = env(sdb);
    const travelRows = await listAdminArticlesFiltered(envDb, { vertical: "travel" });
    expect(travelRows.rows.map((r) => r.title).sort()).toEqual(["Money own travel", "Trips via site"]);
    expect(travelRows.total).toBe(2);
    const financeRows = await listAdminArticlesFiltered(envDb, { vertical: "finance" });
    expect(financeRows.rows.map((r) => r.title).sort()).toEqual(["Money via site", "Trips own finance"]);
    const none = await listAdminArticlesFiltered(envDb, { vertical: "food" });
    expect(none.total).toBe(0);

    // The screen's "All verticals" select drives the same query.
    const html = await page(sdb, "/admin/articles?vertical=travel");
    expect(html).toContain("Money own travel");
    expect(html).toContain("Trips via site");
    expect(html).not.toContain("Money via site");
    expect(html).not.toContain("Trips own finance");
    expect(html).toMatch(/<option value="travel" selected>Travel<\/option>/);
  });
});

// Admin inline scripts must parse and stay ES5 (GUARDRAILS L-014). Runs
// without SQLite: the templates are pure functions.
describe("X01 Part C — inline scripts parse and stay ES5", () => {
  const SCRIPT_RE = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  function scripts(html: string): string[] {
    return Array.from(html.matchAll(SCRIPT_RE)).map((m) => m[1] ?? "");
  }
  const verticals = [
    { id: 2, slug: "finance", label: "Finance" },
    { id: 3, slug: "travel", label: "Travel" },
  ];
  const sites = [{ id: "st_1", name: "Money Site", vertical: "finance" }];

  it("Verticals screen, Articles list and Article editor scripts parse", () => {
    const pages = [
      verticalsListPage([
        { id: 2, slug: "finance", name: "Finance", site_count: 1, category_count: 3, article_count: 4 },
      ]),
      articlesListPage([{ id: "7", title: "T", slug: "t" }], sites, verticals, []),
      articleFormPage({ id: "7", title: "T", site_id: "st_1", vertical_id: "3" }, sites, [], {}, verticals),
      articleFormPage(null, sites, [], {}, verticals),
    ];
    for (const html of pages) {
      const blocks = scripts(html);
      expect(blocks.length).toBeGreaterThan(0);
      for (const src of blocks) {
        // Function() parses without running the body.
        expect(() => new Function(src)).not.toThrow();
      }
    }
  });

  it("the Verticals screen script uses no ES6+ syntax", () => {
    const html = verticalsListPage([]);
    const own = scripts(html).join("\n");
    const start = own.indexOf("var SLUG_RE");
    expect(start).toBeGreaterThan(0);
    const body = own.slice(start);
    expect(body).not.toMatch(/=>/);
    expect(body).not.toMatch(/\bconst\b|\blet\b|`/);
    // The slug rule matches the server's.
    expect(body).toContain("var SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;");
    // Trim regexes survived the TS template string (double-escaped).
    expect(body).toContain("/^\\s+|\\s+$/g");
  });
});
