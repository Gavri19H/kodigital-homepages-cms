#!/usr/bin/env tsx
/**
 * cost:estimate
 *
 * Prints the Phase-7 cost-driver breakdown for kodigital-homepages-cms at
 * the target steady-state scale documented in Part 8 / docs/storage-cost-model.md:
 *
 *   - 200 sites
 *   - 15 starter articles per site (growing to ~100)
 *   - 10000 page renders / day across all sites
 *
 * The table sizes the three Cloudflare storage primitives we use (D1, KV, R2)
 * against that scale and shows how D1 read volume scales with the edge-cache
 * hit ratio. Useful as a quick sanity check before approving a Phase-7
 * change that could move the D1 reads/day budget.
 *
 * Usage:
 *   cd api
 *   npm run cost:estimate
 *   npm run cost:estimate -- --homepage-hit-ratio=0.95 --article-hit-ratio=0.80
 *
 * Flags (all optional — documented defaults match docs/storage-cost-model.md):
 *   --homepage-hit-ratio=<0..1>   edge-cache hit ratio for homepage / inner pages.
 *                                 default: 0.90
 *   --article-hit-ratio=<0..1>    edge-cache hit ratio for article routes.
 *                                 default: 0.90
 *
 * Exits 0 with the breakdown table on stdout when inputs are valid; exits 1
 * with a one-line error on stderr when a flag value is out of range.
 */

const DEFAULT_HOMEPAGE_HIT_RATIO = 0.90;
const DEFAULT_ARTICLE_HIT_RATIO = 0.90;

const SITES = 200;
const STARTER_ARTICLES_PER_SITE = 15;
const DAILY_RENDERS = 10000;
const HOMEPAGE_RENDER_SHARE = 0.6;
const ARTICLE_RENDER_SHARE = 0.4;

interface Flags {
  homepageHitRatio: number;
  articleHitRatio: number;
}

function parseFlags(argv: readonly string[]): Flags {
  let homepageHitRatio = DEFAULT_HOMEPAGE_HIT_RATIO;
  let articleHitRatio = DEFAULT_ARTICLE_HIT_RATIO;

  for (const arg of argv) {
    const match = arg.match(/^--([a-z-]+)=(.+)$/);
    if (!match) continue;
    const [, key, raw] = match;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error(`cost:estimate: --${key} must be a number in [0, 1], got ${raw}`);
    }
    if (key === "homepage-hit-ratio") homepageHitRatio = value;
    else if (key === "article-hit-ratio") articleHitRatio = value;
  }

  return { homepageHitRatio, articleHitRatio };
}

function formatRow(label: string, value: string, note: string): string {
  return `| ${label.padEnd(30)} | ${value.padStart(14)} | ${note} |`;
}

function main(): void {
  const flags = parseFlags(process.argv.slice(2));

  const homepageRenders = DAILY_RENDERS * HOMEPAGE_RENDER_SHARE;
  const articleRenders = DAILY_RENDERS * ARTICLE_RENDER_SHARE;
  const homepageMisses = homepageRenders * (1 - flags.homepageHitRatio);
  const articleMisses = articleRenders * (1 - flags.articleHitRatio);
  const d1ReadsPerDay = Math.round(homepageMisses + articleMisses);

  const startingArticles = SITES * STARTER_ARTICLES_PER_SITE;
  const d1RowsAtLaunch = SITES * (1 + 10 + STARTER_ARTICLES_PER_SITE);
  const kvHotPayloads = SITES * 25;
  const r2AssetsAtLaunch = SITES * 30;

  console.log("Phase-7 cost drivers — kodigital-homepages-cms");
  console.log(
    `assumptions: ${SITES} sites / ${STARTER_ARTICLES_PER_SITE} starter articles per site / ${DAILY_RENDERS} renders per day`
  );
  console.log(
    `hit ratios:  homepage=${flags.homepageHitRatio.toFixed(2)} article=${flags.articleHitRatio.toFixed(2)} ` +
      `(defaults homepage=${DEFAULT_HOMEPAGE_HIT_RATIO.toFixed(2)} article=${DEFAULT_ARTICLE_HIT_RATIO.toFixed(2)})`
  );
  console.log("");
  console.log(formatRow("driver", "value", "source"));
  console.log(formatRow("------------------------------", "--------------", "---------------------"));
  console.log(formatRow("D1 rows at launch", String(d1RowsAtLaunch), "200 x (1 + 10 + 15)"));
  console.log(formatRow("D1 starting articles", String(startingArticles), "200 x 15"));
  console.log(formatRow("D1 reads/day (cache-miss)", String(d1ReadsPerDay), "renders x (1 - hit_ratio)"));
  console.log(formatRow("KV hot payloads resident", String(kvHotPayloads), "200 x 25"));
  console.log(formatRow("R2 assets at launch", String(r2AssetsAtLaunch), "200 x 30"));
}

try {
  main();
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(message);
  process.exit(1);
}
