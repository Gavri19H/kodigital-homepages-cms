// [G1] T45 seed:local deterministic fixture — SQL-builder guards.
//
// T45.AC2: the SQL builder is idempotent (INSERT OR REPLACE only, explicit
// PKs, no clock/random SQL, byte-identical across calls) and the fixture
// fills ALL Home view-model buckets — proven BEHAVIORALLY by feeding the
// fixture rows through buildHomeViewModel (the same fake-D1 harness as
// public-view-models-home.test.ts) and asserting every bucket is populated.
// T45.AC1/AC3 substance: package.json wires seed:local; seed-local.ts and
// its builder modules contain zero network-call tokens.
//
// The it() titles embed the literal evidence command for the RC-133
// expected_test_name_regex binding (T40/T42/T44 precedent).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { buildHomeViewModel } from "../src/public/view-models/home";
import { buildSeedSql } from "../scripts/seed/seed-sql";
import {
  SEED_HOSTNAME,
  SEED_SITE_ID,
  seedArticles,
  seedCategories,
  seedMedia,
  seedSettings,
} from "../scripts/seed/seed-fixture";

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function makeDbFromFixture(): D1Database {
  const categoryById = new Map(seedCategories.map((c) => [c.id, c]));
  const mediaById = new Map(seedMedia.map((m) => [m.id, m]));
  const articleRows = seedArticles.map((a) => ({
    id: a.id,
    slug: a.slug,
    title: a.title,
    content_html: a.contentHtml,
    category_id: a.categoryId,
    status: "published",
    published_at: a.publishedAt,
    featured_image_id: a.mediaId,
    is_featured: a.isFeatured,
    is_trending: a.isTrending,
    homepage_section: "none",
    homepage_rank: a.homepageRank,
    site_id: SEED_SITE_ID,
    category_name: categoryById.get(a.categoryId)?.name ?? null,
    category_slug: categoryById.get(a.categoryId)?.slug ?? null,
    image_url: mediaById.get(a.mediaId)?.storageKey ?? null,
    image_alt: mediaById.get(a.mediaId)?.altText ?? null,
  }));

  const db = {
    prepare(sql: string) {
      let captured: unknown[] = [];
      const stmt = {
        bind(...args: unknown[]) {
          captured = args;
          return stmt;
        },
        async first<T = unknown>(): Promise<T | null> {
          return null;
        },
        async all<T = unknown>(): Promise<{ results: T[]; success: boolean; meta: object }> {
          if (sql.startsWith("SELECT a.id AS id, a.slug AS slug")) {
            const siteId = String(captured[0] ?? "");
            const limit = Number(captured[1] ?? 0);
            const rows = articleRows
              .filter((a) => a.site_id === siteId)
              .sort((x, y) => {
                if (x.is_featured !== y.is_featured) return y.is_featured - x.is_featured;
                if (x.is_trending !== y.is_trending) return y.is_trending - x.is_trending;
                const rx = x.homepage_rank ?? Number.MAX_SAFE_INTEGER;
                const ry = y.homepage_rank ?? Number.MAX_SAFE_INTEGER;
                if (rx !== ry) return rx - ry;
                if (x.published_at !== y.published_at) return y.published_at - x.published_at;
                return y.id - x.id;
              })
              .slice(0, limit);
            return { results: rows as unknown as T[], success: true, meta: {} };
          }
          if (sql.startsWith("SELECT c.id AS id, c.slug AS slug, c.name AS name")) {
            const siteId = String(captured[0] ?? "");
            const limit = Number(captured[1] ?? 0);
            const rows = seedCategories
              .filter(() => siteId === SEED_SITE_ID)
              .slice(0, limit)
              .map((c) => ({ id: c.id, slug: c.slug, name: c.name }));
            return { results: rows as unknown as T[], success: true, meta: {} };
          }
          if (sql.startsWith("SELECT key AS key, value AS value FROM site_settings")) {
            const siteId = String(captured[0] ?? "");
            const rows = seedSettings
              .filter(() => siteId === SEED_SITE_ID)
              .map((s) => ({ key: s.key, value: s.value }));
            return { results: rows as unknown as T[], success: true, meta: {} };
          }
          return { results: [] as T[], success: true, meta: {} };
        },
      };
      return stmt;
    },
  };
  return db as unknown as D1Database;
}

describe("seed-local-sql", () => {
  it("T45.AC2 buildSeedSql is deterministic and idempotent — INSERT OR REPLACE only, no clock/random SQL [cd api && npx vitest run test/seed-local-sql.test.ts]", () => {
    const first = buildSeedSql();
    const second = buildSeedSql();
    expect(second).toBe(first);

    const inserts = first.match(/INSERT/g) ?? [];
    const orReplace = first.match(/INSERT OR REPLACE INTO /g) ?? [];
    expect(inserts.length).toBeGreaterThanOrEqual(30);
    expect(orReplace.length).toBe(inserts.length);

    // No SQL-side clocks or randomness — re-running must not drift a byte.
    expect(first).not.toMatch(/unixepoch|CURRENT_TIMESTAMP|strftime|random\(|datetime\(/i);

    // Every statement is terminated and the seed targets only the seed site.
    for (const line of first.trim().split("\n")) {
      expect(line.endsWith(";")).toBe(true);
    }
    expect(first).toContain(`'${SEED_SITE_ID}'`);
    expect(first).toContain(`'${SEED_HOSTNAME}'`);
  });

  it("T45.AC2 fixture fills all home buckets — hero, featured, picks, trending, latest, categories, newsletter [cd api && npx vitest run test/seed-local-sql.test.ts]", async () => {
    const vm = await buildHomeViewModel(makeDbFromFixture(), {
      siteId: SEED_SITE_ID,
      hostname: SEED_HOSTNAME,
    });

    expect(vm.hero).not.toBeNull();
    expect(vm.featured.length).toBe(3);
    expect(vm.picks.length).toBe(4);
    expect(vm.trending.length).toBe(5);
    expect(vm.latest.length).toBe(6);
    expect(vm.categories.length).toBe(4);
    expect(vm.newsletter.heading).toBe("The Seed Local Letter");
    expect(vm.site.name).toBe("Seed Local Living");
    expect(vm.meta.canonicalUrl).toBe(`https://${SEED_HOSTNAME}/`);

    // A trending card never duplicates into another bucket (T12 contract).
    const trendingIds = new Set(vm.trending.map((c) => c.id));
    const others = [vm.hero!, ...vm.featured, ...vm.latest];
    expect(others.some((c) => trendingIds.has(c.id))).toBe(false);
  });

  it("T45.AC1+AC3 seed:local is wired in package.json and seed scripts make zero network calls", () => {
    const pkg = JSON.parse(readFileSync(path.join(apiRoot, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["seed:local"]).toContain("seed-local.ts");

    const networkToken = "fetch" + "(";
    for (const rel of [
      "scripts/seed-local.ts",
      "scripts/seed/seed-sql.ts",
      "scripts/seed/seed-fixture.ts",
    ]) {
      const source = readFileSync(path.join(apiRoot, rel), "utf8");
      expect(source.includes(networkToken)).toBe(false);
    }
  });
});
