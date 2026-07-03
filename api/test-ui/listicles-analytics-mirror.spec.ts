// Listicles Phase 8 — admin analytics light-up e2e (§18/§30.7).
//
// Seeds the D1 analytics mirrors DIRECTLY into the SAME local D1 the dev
// server reads (via `wrangler d1 execute --local` — the standard local-seed
// path; no live ClickHouse needed, honest per the §17 residual), then drives
// the REAL admin UI + read endpoints in a browser:
//   * the Offers list analytics columns hydrate to the SYNCED numbers
//     (impressions 100, CTR 10.00%, revenue 50.00) — screenshot,
//   * the drilldown endpoint surfaces rule_match_rate = matched/(matched+
//     fallback) = 170/200 = 0.85 (there is no dedicated drilldown-EXPANDER UI
//     yet — only the JSON endpoint + the list analytics columns render; the
//     rate is asserted at the endpoint in-browser),
//   * the §30.7 link-instance read returns the per-CTA row with offer_public_id.
//
// The mirror is written only by the CH→D1 sync in production; in dev there is
// no CH, so we seed the mirror rows directly. The default 30d timeframe ends
// TODAY (UTC), so rows are dated with the real current UTC date.

import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";

const SHOT_DIR = "test-artifacts/listicles-analytics";
const TODAY = new Date().toISOString().slice(0, 10);

// Unique, searchable names so the Offers list isolates our row on page 1.
const OFFER_PUB = "off_pw8";
const OFFER_NAME = "PW8 Analytics Offer";
const ART_PUB = "art_pw8";
const VER_PUB = "ver_pw8";
const SEC_PUB = "sec_pw8";
const LNK_PUB = "lnk_pw8";

function d1Local(command: string): void {
  execFileSync(
    "npx",
    ["wrangler", "d1", "execute", "kodigital-homepages-cms-db", "--local", "--command", command],
    { cwd: process.cwd(), stdio: "pipe", timeout: 120_000 },
  );
}

test.beforeAll(() => {
  mkdirSync(SHOT_DIR, { recursive: true });
  // Ensure the schema exists in the shared local D1 (idempotent).
  try {
    execFileSync("npx", ["wrangler", "d1", "migrations", "apply", "kodigital-homepages-cms-db", "--local"], {
      cwd: process.cwd(), stdio: "pipe", timeout: 120_000,
    });
  } catch {
    // already applied / harness pre-applied — the seed below fails loudly if tables are truly missing.
  }

  const seed = [
    `INSERT OR IGNORE INTO sites (id) VALUES ('st_pw8');`,
    `INSERT OR IGNORE INTO listicle_offers (public_id, offer_name, provider, activity, vertical, conversion_tracking_method, offer_url_template, payout_method) VALUES ('${OFFER_PUB}','${OFFER_NAME}','pw8acme','lead','pets','s2s_postback','https://t.example/c?cid={click_id}','offsite');`,
    `INSERT OR IGNORE INTO listicle_sections (public_id, section_name, headline_text, content_json) VALUES ('${SEC_PUB}','PW8 Section','PW8 Headline','{}');`,
    `INSERT OR IGNORE INTO listicle_articles (public_id, site_id, slug, article_name) VALUES ('${ART_PUB}','st_pw8','pw8-article','PW8 Article');`,
    // Mirror rows (what the CH→D1 sync would write) — INSERT OR REPLACE = idempotent.
    `INSERT OR REPLACE INTO listicle_analytics_offer (offer_public_id, date, impressions, clicks, unique_clicks, conversions, revenue, synced_at) VALUES ('${OFFER_PUB}','${TODAY}',100,10,8,2,50.0,unixepoch());`,
    `INSERT OR REPLACE INTO listicle_analytics_article (article_public_id, article_version_id, article_version_revision, article_experiment_id, article_split_percentage, date, total_visits, unique_visits, impressions, clicks, unique_clicks, conversions, revenue, synced_at) VALUES ('${ART_PUB}','${VER_PUB}',1,'exp_pw8',50,'${TODAY}',300,250,200,20,16,4,80.0,unixepoch());`,
    `INSERT OR REPLACE INTO listicle_analytics_drilldown (article_public_id, article_version_id, article_version_revision, article_experiment_id, article_split_percentage, page_index, page_selection_mode, section_public_id, page_candidate_id, ab_test_id, page_rule_set_id, page_rule_id, selection_reason, matched_rule_json_hash, traffic_allocation, date, impressions, clicks, unique_clicks, conversions, revenue, visits, matched_sessions, fallback_sessions, synced_at) VALUES ('${ART_PUB}','${VER_PUB}',1,'exp_pw8',50,1,'rule_based','${SEC_PUB}','cand_pw8','','rs_pw8','rule_pw8','rule_match','h',70,'${TODAY}',150,15,12,3,60.0,180,170,30,unixepoch());`,
    `INSERT OR REPLACE INTO listicle_analytics_link_instance (link_instance_id, section_public_id, offer_public_id, article_public_id, article_version_id, article_version_revision, page_index, page_candidate_id, page_selection_mode, page_rule_id, selection_reason, section_block_id, link_role, link_position_index, button_style_id, button_group_id, anchor_text_hash, analytics_label, date, impressions, clicks, unique_clicks, conversions, revenue, synced_at) VALUES ('${LNK_PUB}','${SEC_PUB}','${OFFER_PUB}','${ART_PUB}','${VER_PUB}',1,1,'cand_pw8','rule_based','rule_pw8','rule_match','blk_pw8','button',0,'bs_pw8','bg_pw8','ah','lab_pw8','${TODAY}',120,12,10,2,40.0,unixepoch());`,
  ].join(" ");
  d1Local(seed);
});

test.describe("admin analytics lights up from a seeded mirror (§18)", () => {
  test("Offers list analytics columns show the synced numbers (screenshot)", async ({ page }) => {
    await page.goto(`/admin/listicles/offers?search=${encodeURIComponent("PW8 Analytics")}`, {
      waitUntil: "domcontentloaded",
    });

    // The seeded offer row.
    const row = page.locator("tbody tr[data-entity-id]", { hasText: OFFER_NAME }).first();
    await expect(row).toBeVisible();

    // Analytics hydrate after paint from /offers/:id/analytics → the mirror.
    const impressions = row.locator('td[data-metric="impressions"]');
    await expect(impressions).toHaveText("100", { timeout: 15_000 }); // fmtInt(100)
    await expect(row.locator('td[data-metric="clicks"]')).toHaveText("10");
    await expect(row.locator('td[data-metric="ctr"]')).toHaveText("10.00%"); // fmtPct(0.1)
    await expect(row.locator('td[data-metric="revenue"]')).toHaveText("50.00"); // fmtDec(50)

    await page.screenshot({ path: `${SHOT_DIR}/offers-analytics-nonzero.png`, fullPage: true });
  });

  test("drilldown endpoint surfaces rule_match_rate (0.85) + link-instance read (§30.7)", async ({ page }) => {
    // In-browser fetch through the real worker (DEV_BYPASS_AUTH on the dev server).
    const drill = await page.request.get(
      `/api/admin/listicles/articles/${ART_PUB}/drilldown?from=${TODAY}&to=${TODAY}`,
    );
    expect(drill.ok()).toBeTruthy();
    const drillBody = (await drill.json()) as {
      drilldown: { versions: Array<{ pages: Array<{ candidates: Array<Record<string, number>> }> }> };
    };
    const cand = drillBody.drilldown.versions[0].pages[0].candidates[0];
    expect(cand.matched_sessions).toBe(170);
    expect(cand.fallback_sessions).toBe(30);
    expect(cand.rule_match_rate).toBeCloseTo(0.85, 6);

    const li = await page.request.get(
      `/api/admin/listicles/articles/${ART_PUB}/link-instances?from=${TODAY}&to=${TODAY}`,
    );
    expect(li.ok()).toBeTruthy();
    const liBody = (await li.json()) as { link_instances: { items: Array<Record<string, number | string>> } };
    const item = liBody.link_instances.items[0];
    expect(item.link_instance_id).toBe(LNK_PUB);
    expect(item.offer_public_id).toBe(OFFER_PUB); // DEV-6 map survived the whole path
    expect(item.clicks).toBe(12);
    expect(item.ctr).toBeCloseTo(0.1, 6);
  });
});
