#!/usr/bin/env tsx
/**
 * db:explain-article
 *
 * Runs `EXPLAIN QUERY PLAN` against the local D1 database for the SQL
 * statements the public article-page route executes (`GET /article/:slug`),
 * so a developer can confirm that the Phase-7 indexes from migration
 * 0009_phase7_content_version_and_indexes.sql are actually getting picked
 * up by SQLite's planner before the change is shipped.
 *
 * Why this script and not a vitest test:
 *   * Vitest's miniflare D1 layer reports `EXPLAIN QUERY PLAN` rows
 *     differently across versions, so asserting on planner output in a
 *     unit test produces flaky CI. A scoped local script keeps the
 *     planner-inspection capability without coupling it to CI.
 *   * The planner output is most useful as a human-readable signal when
 *     a developer is changing an index or a query — printing it to stdout
 *     means the diff is reviewable in a terminal alongside the SQL.
 *
 * Article-page queries inspected (kept in sync with src/public/router.ts,
 * src/db/index.ts, and src/public/queries.ts):
 *
 *   Q1 — getArticleBySlug per tenant (the per-request workhorse for
 *        /article/:slug — slug + site_id lookup). EXPLAIN QUERY PLAN
 *        MUST hit a slug-bearing index (idx_articles_slug_site from
 *        migration 0009, or the legacy unique index from 0002 on
 *        (slug, site_id)).
 *
 *   Q2 — fetchCategoryArticles per (category_id, site_id) tenant
 *        (related-articles / category-page workhorse — category_id +
 *        site_id + status + ORDER BY published_at DESC). The composite
 *        index idx_articles_category_site_status (0009) is the
 *        expected pick.
 *
 *   Q3 — fetchCategory by slug (the category nav lookup rendered on the
 *        article shell). The categories table has a unique index on
 *        slug so the planner should USE INDEX, NOT scan.
 *
 * Behavior:
 *   * Checks for the wrangler local-D1 state directory first
 *     (.wrangler/state/v3/d1). When the directory is missing the script
 *     prints a documented `skipped: no local D1` line and exits 0 — the
 *     same surface the AC contract documents so CI / fresh clones do
 *     not break.
 *   * When local D1 is present, spawns
 *       npx wrangler d1 execute kodigital-homepages-cms-db --local
 *         --command "EXPLAIN QUERY PLAN <SQL>"
 *     for each query and prints the planner table.
 *   * Always exits 0 on the happy path. Exits 1 only on a programmer
 *     error (e.g. wrangler is in PATH but refuses to execute — surfaces
 *     so the developer can fix the env).
 *
 * Usage:
 *   cd api
 *   npm run db:explain-article
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const DB_NAME = "kodigital-homepages-cms-db";
const LOCAL_D1_STATE_DIR = resolve(process.cwd(), ".wrangler", "state", "v3", "d1");

interface ArticleQuery {
  id: string;
  description: string;
  sql: string;
}

const ARTICLE_QUERIES: readonly ArticleQuery[] = [
  {
    id: "Q1",
    description:
      "getArticleBySlug per tenant (article-page workhorse — must hit a slug-bearing index, not a full scan)",
    sql:
      "SELECT * FROM articles WHERE slug = 'demo-article' AND site_id = 'demo-site' LIMIT 1",
  },
  {
    id: "Q2",
    description:
      "fetchCategoryArticles per (category_id, site_id) (related/category list — must hit idx_articles_category_site_status)",
    sql:
      "SELECT * FROM articles WHERE category_id = 1 AND site_id = 'demo-site' AND status = 'published' " +
      "ORDER BY published_at DESC, id DESC LIMIT 20 OFFSET 0",
  },
  {
    id: "Q3",
    description:
      "fetchCategory by slug (category nav rendered alongside article — must hit the unique slug index, not a scan)",
    sql: "SELECT id, slug, name FROM categories WHERE slug = 'demo-category' LIMIT 1",
  },
];

function printSkipped(reason: string): void {
  console.log(`db:explain-article — skipped: no local D1 (${reason}).`);
  console.log(
    "  Hint: create the local D1 with `npm run db:migrate:local` and then re-run this script.",
  );
}

function runExplainQueryPlan(query: ArticleQuery): boolean {
  const command = `EXPLAIN QUERY PLAN ${query.sql}`;
  console.log("");
  console.log(`---- ${query.id}: ${query.description} ----`);
  console.log(`SQL: ${query.sql}`);
  console.log("");
  const result = spawnSync(
    "npx",
    ["wrangler", "d1", "execute", DB_NAME, "--local", "--command", command],
    { stdio: "inherit", encoding: "utf8" },
  );
  if (result.error) {
    console.error(`  ERROR: ${result.error.message}`);
    return false;
  }
  if (typeof result.status === "number" && result.status !== 0) {
    console.error(`  EXPLAIN QUERY PLAN failed for ${query.id} (wrangler exit ${result.status}).`);
    return false;
  }
  return true;
}

function main(): void {
  console.log(`db:explain-article — inspecting planner for ${ARTICLE_QUERIES.length} article-page queries`);
  console.log(`D1 binding: DB / database: ${DB_NAME}`);
  if (!existsSync(LOCAL_D1_STATE_DIR)) {
    printSkipped(`${LOCAL_D1_STATE_DIR} does not exist`);
    return;
  }
  let allOk = true;
  for (const query of ARTICLE_QUERIES) {
    const ok = runExplainQueryPlan(query);
    allOk = allOk && ok;
  }
  if (!allOk) {
    console.error("");
    console.error("db:explain-article — one or more EXPLAIN QUERY PLAN runs failed; see output above.");
    process.exit(1);
  }
}

try {
  main();
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`db:explain-article: ${message}`);
  process.exit(1);
}
