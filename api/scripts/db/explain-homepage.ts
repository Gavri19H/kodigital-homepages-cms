#!/usr/bin/env tsx
/**
 * db:explain-homepage
 *
 * Runs `EXPLAIN QUERY PLAN` against the local D1 database for the SQL
 * statements the public homepage route executes (`GET /`), so a developer
 * can confirm that the Phase-7 indexes from migration
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
 * Homepage queries inspected (kept in sync with src/public/router.ts and
 * src/db/index.ts):
 *
 *   Q1 — listArticles published per tenant (the per-request workhorse;
 *        site_id + status + ORDER BY published_at DESC + LIMIT/OFFSET).
 *        EXPLAIN QUERY PLAN MUST hit idx_articles_site_status_pub_desc
 *        (added in 0009) — if it falls back to idx_articles_site_status_pub
 *        (the ASC index from 0002) SQLite needs an extra sort step.
 *
 *   Q2 — fetchPublishedPage / sitemap "published pages per tenant" path
 *        (status + (site_id = ? OR site_id IS NULL) — used by the
 *        homepage on inner-page anchors AND by /sitemap.xml).
 *
 *   Q3 — listCategories per tenant (the categories nav rendered on the
 *        homepage shell; joins categories → category_verticals →
 *        verticals → sites).
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
 *   npm run db:explain-homepage
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const DB_NAME = "kodigital-homepages-cms-db";
const LOCAL_D1_STATE_DIR = resolve(process.cwd(), ".wrangler", "state", "v3", "d1");

interface HomepageQuery {
  id: string;
  description: string;
  sql: string;
}

const HOMEPAGE_QUERIES: readonly HomepageQuery[] = [
  {
    id: "Q1",
    description:
      "listArticles published per tenant (homepage workhorse — must hit idx_articles_site_status_pub_desc)",
    sql:
      "SELECT * FROM articles WHERE status = 'published' AND site_id = 'demo-site' " +
      "ORDER BY published_at DESC, id DESC LIMIT 20 OFFSET 0",
  },
  {
    id: "Q2",
    description:
      "fetchSitemapPages / homepage inner-page anchor lookup (published pages per tenant + global)",
    sql:
      "SELECT slug, updated_at FROM pages WHERE status = 'published' " +
      "AND (site_id = 'demo-site' OR site_id IS NULL) ORDER BY updated_at DESC",
  },
  {
    id: "Q3",
    description:
      "listCategories per tenant (homepage nav — joins categories → category_verticals → verticals → sites)",
    sql:
      "SELECT c.*, s.id AS site_id FROM categories c " +
      "INNER JOIN category_verticals cv ON cv.category_id = c.id " +
      "INNER JOIN verticals v ON v.id = cv.vertical_id " +
      "INNER JOIN sites s ON s.vertical_slug = v.slug " +
      "WHERE s.id = 'demo-site' ORDER BY c.display_order ASC, c.name ASC LIMIT 100 OFFSET 0",
  },
];

function printSkipped(reason: string): void {
  console.log(`db:explain-homepage — skipped: no local D1 (${reason}).`);
  console.log(
    "  Hint: create the local D1 with `npm run db:migrate:local` and then re-run this script.",
  );
}

function runExplainQueryPlan(query: HomepageQuery): boolean {
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
  console.log(`db:explain-homepage — inspecting planner for ${HOMEPAGE_QUERIES.length} homepage queries`);
  console.log(`D1 binding: DB / database: ${DB_NAME}`);
  if (!existsSync(LOCAL_D1_STATE_DIR)) {
    printSkipped(`${LOCAL_D1_STATE_DIR} does not exist`);
    return;
  }
  let allOk = true;
  for (const query of HOMEPAGE_QUERIES) {
    const ok = runExplainQueryPlan(query);
    allOk = allOk && ok;
  }
  if (!allOk) {
    console.error("");
    console.error("db:explain-homepage — one or more EXPLAIN QUERY PLAN runs failed; see output above.");
    process.exit(1);
  }
}

try {
  main();
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`db:explain-homepage: ${message}`);
  process.exit(1);
}
