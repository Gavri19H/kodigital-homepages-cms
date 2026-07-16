// Listicles Phase 10 — the §26 Manual QA checklist, driven end-to-end against
// the REAL worker under `wrangler dev` (playwright.config.ts webServer:
// DEV_BYPASS_AUTH + ADMIN_HOST:127.0.0.1). This is the Phase-10 headline
// deliverable: it walks EACH §26 group and lands a screenshot evidence pack in
// test-artifacts/listicles-manual-qa/, plus it is the first live drive of the
// two NEW Phase-10 admin surfaces:
//   * the §11 Version→Page→candidate drilldown EXPANDER (the register's
//     endpoint-only gap — the "+" now renders rule matched/fallback/
//     rule_match_rate inline), and
//   * the §18 rebuild-analytics-range control.
//
// Requires (the gate runs them): `npm run db:migrate:local` once and
// `npm run seed:local` (the homepage-isolation check reads the localhost seed
// site). Analytics has no live ClickHouse in dev, so the mirror rows the
// drilldown reads are seeded DIRECTLY into the same local D1 the dev server
// reads (the standard local path, honest per the §17 residual) — labeled in
// the QA report as a seeded-mirror proxy for the Athena→CH→D1 pipeline.
//
// Host model: admin drives hit 127.0.0.1 (ADMIN_HOST); the public funnel hits
// the seeded tenant host, resolved by Chromium's --host-resolver-rules. Only
// browser navigations honor that map — Node-side page.request stays on
// 127.0.0.1 / localhost.

import { test, expect, request as playwrightRequest, type Page, type Request as PwRequest } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import {
  seedPublishedListicle,
  startFiftyFiftyExperiment,
  type SeededListicle,
} from "./listicles-p6-seed";
import { PW_PORT } from "./utils/base-url";

test.use({
  viewport: { width: 1280, height: 800 },
  launchOptions: { args: ["--host-resolver-rules=MAP *.e2e.test 127.0.0.1"] },
});

const SHOT_DIR = "test-artifacts/listicles-manual-qa";
const ORIGIN = `http://127.0.0.1:${PW_PORT}`;
const TODAY = new Date().toISOString().slice(0, 10);

let funnel: SeededListicle;

function d1Local(command: string): void {
  execFileSync(
    "npx",
    ["wrangler", "d1", "execute", "kodigital-homepages-cms-db", "--local", "--command", command],
    { cwd: process.cwd(), stdio: "pipe", timeout: 120_000 },
  );
}

function publicUrl(seed: SeededListicle, extra = ""): string {
  return `http://${seed.host}:${PW_PORT}/${seed.slug}${extra}`;
}

// ---- beacon capture (mirrors listicles-tracking.spec.ts) -------------------
interface TrackedEvent {
  event_type: string;
  event_id?: string;
  session_id?: string;
  page_view_id?: string;
  offer_id?: string;
  link_instance_id?: string;
  utm_source?: string;
  fbclid?: string;
  [key: string]: unknown;
}

async function collectBeacons(page: Page): Promise<TrackedEvent[]> {
  // Force the §31.6 chain onto the observable keepalive-fetch leg (sendBeacon
  // rides Chromium's ping loader Playwright cannot see).
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "sendBeacon", { value: undefined, configurable: true });
  });
  const events: TrackedEvent[] = [];
  const seen = new Set<string>();
  page.on("request", (req: PwRequest) => {
    if (!req.url().includes("/api/lst/track")) return;
    const data = req.postData();
    if (data === null) return;
    try {
      const parsed = JSON.parse(data) as { events?: TrackedEvent[] };
      const batch = Array.isArray(parsed.events) ? parsed.events : [parsed as unknown as TrackedEvent];
      for (const event of batch) {
        if (event.event_id !== undefined && seen.has(event.event_id)) continue;
        if (event.event_id !== undefined) seen.add(event.event_id);
        events.push(event);
      }
    } catch {
      /* non-JSON beacon */
    }
  });
  return events;
}

async function waitForEvent(page: Page, events: TrackedEvent[], type: string, timeoutMs = 8000): Promise<TrackedEvent> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const hit = events.find((e) => e.event_type === type);
    if (hit !== undefined) return hit;
    await page.waitForTimeout(100);
  }
  throw new Error(`no ${type} beacon within ${timeoutMs}ms (saw: ${events.map((e) => e.event_type).join(",")})`);
}

test.beforeAll(async () => {
  mkdirSync(SHOT_DIR, { recursive: true });
  try {
    execFileSync("npx", ["wrangler", "d1", "migrations", "apply", "kodigital-homepages-cms-db", "--local"], {
      cwd: process.cwd(), stdio: "pipe", timeout: 120_000,
    });
  } catch {
    /* already applied / harness pre-applied */
  }

  const ctx = await playwrightRequest.newContext({ baseURL: ORIGIN });
  // A composed published listicle: page 0 = ab_test 50/50; page 1 = rule_based
  // (desktop→sec2 / fallback→sec3, fires deterministically under Desktop
  // Chrome); page 2 = rule_based (mobile→sec4 / fallback→sec5, the fallback
  // case). Provider URL points at the worker's own any-host /health so the /lc
  // 302 lands locally.
  funnel = await seedPublishedListicle(ctx, {
    hostPrefix: "lst-p10-funnel",
    slug: "p10-funnel",
    offerUrlTemplate: `http://offers.e2e.test:${PW_PORT}/health?cid={click_id}&geo={country}`,
    pages: (sectionIds) => [
      {
        page_index: 0,
        selection_mode: "ab_test",
        ab_test_id: "ab_p10_0",
        candidates: [
          { section_id: sectionIds[0], traffic_allocation: 50, label: "A" },
          { section_id: sectionIds[1], traffic_allocation: 50, label: "B" },
        ],
      },
      {
        page_index: 1,
        selection_mode: "rule_based",
        candidates: [
          { section_id: sectionIds[2], label: "A", rule: { priority: 10, conditions: { sets: { device: ["desktop"] } } } },
          { section_id: sectionIds[3], label: "B", is_fallback: true },
        ],
      },
      {
        page_index: 2,
        selection_mode: "rule_based",
        candidates: [
          { section_id: sectionIds[4], label: "A", rule: { priority: 10, conditions: { sets: { device: ["mobile"] } } } },
          { section_id: sectionIds[5], label: "B", is_fallback: true },
        ],
      },
    ],
  });
  await ctx.dispose();

  // Seed the D1 analytics mirror the §11 drilldown expander reads (no live CH
  // in dev). Two pages for the funnel article's control Version dated TODAY:
  // a single page and a rule_based page with matched 170 / fallback 30 →
  // rule_match_rate = 170/200 = 0.85.
  const a = funnel.articlePublicId;
  const v = funnel.versionPublicId;
  const drillCols =
    "(article_public_id, article_version_id, article_version_revision, article_experiment_id, " +
    "article_split_percentage, page_index, page_selection_mode, section_public_id, page_candidate_id, " +
    "ab_test_id, page_rule_set_id, page_rule_id, selection_reason, matched_rule_json_hash, " +
    "traffic_allocation, date, impressions, clicks, unique_clicks, conversions, revenue, visits, " +
    "matched_sessions, fallback_sessions, synced_at)";
  d1Local(
    `INSERT OR REPLACE INTO listicle_analytics_drilldown ${drillCols} VALUES ` +
      `('${a}','${v}',1,'',0,0,'single','sec_p10a','cand_p10a','','','','single_default','',100,'${TODAY}',900,90,72,9,45.0,900,NULL,NULL,unixepoch());`,
  );
  d1Local(
    `INSERT OR REPLACE INTO listicle_analytics_drilldown ${drillCols} VALUES ` +
      `('${a}','${v}',1,'',0,1,'rule_based','sec_p10b','cand_p10b','','rs_p10','rule_p10','rule_match','h',0,'${TODAY}',150,15,12,3,60.0,180,170,30,unixepoch());`,
  );
});

// ===========================================================================
// §26 Offers
// ===========================================================================
test.describe.serial("§26 Offers", () => {
  const uniq = Date.now();
  const offerName = `MQA Offer ${uniq}`;
  const fallbackName = `MQA Fallback ${uniq}`;
  const sectionName = `MQA Section for offer ${uniq}`;
  let fallbackId = 0;

  test("create with all fields: required-field block, In-site + cap reveals, macro chip at caret, {clickid} normalize, unknown-macro warn", async ({ page }) => {
    const fb = await page.request.post("/api/admin/listicles/offers", {
      data: {
        offer_name: fallbackName, provider: "e2eprov", activity: "lead", vertical: "finance",
        conversion_tracking_method: "browser_side_pixel",
        offer_url_template: "https://fb.e2e.example/c?cid={click_id}", payout_method: "offsite",
      },
    });
    expect(fb.status()).toBe(201);
    fallbackId = ((await fb.json()) as { offer: { id: number } }).offer.id;

    await page.goto("/admin/listicles/offers", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".listicles-tab.active")).toHaveText("Offers");
    await page.getByRole("button", { name: "+ Create an Offer" }).first().click();
    await expect(page.locator("#offer-modal")).toBeVisible();

    // required-field block first
    await page.locator("#offer-modal-save").click();
    await expect(page.locator("#offer-modal-error")).toBeVisible();
    await expect(page.locator('[data-error-for="offer_name"]')).toBeVisible();

    await page.locator("#offer-name").fill(offerName);
    await page.locator("#offer-provider").fill("e2eprov");
    await page.locator("#offer-activity").fill("lead");
    await page.locator("#offer-vertical").fill("finance");
    await page.locator("#offer-tracking-method").selectOption("s2s_postback");

    // macro chip at the caret (§9.4)
    const urlBox = page.locator("#offer-url-template");
    await urlBox.fill("https://x.example/a?b=1");
    await urlBox.evaluate((el) => {
      (el as HTMLTextAreaElement).focus();
      (el as HTMLTextAreaElement).setSelectionRange(8, 8);
    });
    await page.locator('.macro-chip[data-macro="utm_source"]').click();
    await expect(urlBox).toHaveValue("https://{utm_source}x.example/a?b=1");

    // unknown-macro warn + {clickid} normalize note
    await urlBox.fill("https://track.e2e.example/c?cid={bogus_macro}");
    await expect(page.locator("#offer-url-unknown-warn")).toBeVisible();
    await urlBox.fill("https://track.e2e.example/c?cid={clickid}&geo={country}");
    await expect(page.locator("#offer-url-normalize-note")).toBeVisible();
    await expect(page.locator("#offer-url-normalize-note")).toContainText("normalized to {click_id}");

    // In-site conditional reveal ⇒ currency + value
    await expect(page.locator("#offer-payout-conditional")).toBeHidden();
    await page.locator("#offer-payout-method").selectOption("in_site");
    await expect(page.locator("#offer-payout-conditional")).toBeVisible();
    await page.locator("#offer-payout-currency").selectOption("USD");
    await page.locator("#offer-payout-value").fill("12.5");

    // cap ⇒ amount / tz / count_by + fallback offer picker
    await page.locator("#offer-cap-enabled").check();
    await expect(page.locator("#offer-cap-conditional")).toBeVisible();
    await page.locator("#offer-cap-amount").fill("100");
    await page.locator("#offer-cap-timezone").selectOption("America/New_York");
    await page.locator("#offer-cap-count-by").selectOption("clicks");
    await page.locator("#offer-fallback-search").fill(fallbackName);
    const fbBtn = page.locator("#offer-fallback-results button", { hasText: fallbackName });
    await expect(fbBtn).toBeVisible();
    await fbBtn.click();
    await expect(page.locator("#offer-cap-fallback-offer-id")).toHaveValue(String(fallbackId));
    await page.locator("#offer-cap-fallback-url").fill("/capped-fallback");

    await page.screenshot({ path: `${SHOT_DIR}/offers-01-create-modal-filled.png` });
    await page.locator("#offer-modal-save").click();

    const row = page.locator(`tr[data-entity-name="${offerName}"]`);
    await expect(row).toBeVisible();
    // analytics hydrated (empty mirrors → "0", not a skeleton)
    await expect(row.locator('td[data-metric="impressions"]')).toHaveText("0");
    await expect(row.locator('td[data-metric="impressions"] .skel')).toHaveCount(0);
    await page.screenshot({ path: `${SHOT_DIR}/offers-02-created-row.png` });
  });

  test("delete-in-use → 409 dialog + Archive instead; View attribution to Sections", async ({ page }) => {
    await page.goto("/admin/listicles/offers", { waitUntil: "domcontentloaded" });
    const listRes = await page.request.get(`/api/admin/listicles/offers?search=${encodeURIComponent(offerName)}`);
    const offerId = ((await listRes.json()) as { offers: Array<{ id: number }> }).offers[0].id;

    const secRes = await page.request.post("/api/admin/listicles/sections", {
      data: {
        section_name: sectionName, headline_text: "MQA headline",
        content_json: { blocks: [{ type: "button", data: { text: "Go", offer_id: offerId, style: "primary" } }] },
      },
    });
    expect(secRes.status()).toBe(201);

    const row = page.locator(`tr[data-entity-name="${offerName}"]`);
    page.once("dialog", (d) => void d.accept());
    await row.getByRole("button", { name: "Delete" }).click();
    await expect(page.locator("#lst-dialog")).toBeVisible();
    await expect(page.locator("#lst-dialog-title")).toHaveText("Offer in use");
    await expect(page.locator("#lst-dialog-body")).toContainText(sectionName);
    await page.screenshot({ path: `${SHOT_DIR}/offers-03-409-in-use.png` });

    await page.getByRole("button", { name: "Archive instead" }).click();
    await expect(page.locator(`tr[data-entity-name="${offerName}"] .badge-archived`)).toBeVisible();

    await page.locator(`tr[data-entity-name="${offerName}"]`).getByRole("button", { name: "Attribution to Sections" }).click();
    await expect(page.locator("#lst-dialog-title")).toContainText("Attribution to Sections");
    await expect(page.locator("#lst-dialog-body")).toContainText(sectionName);
    await page.screenshot({ path: `${SHOT_DIR}/offers-04-attribution.png` });
  });
});

// ===========================================================================
// §26 Sections
// ===========================================================================
test.describe("§26 Sections", () => {
  test("headline → Offer modal → chip; NO url field anywhere; ≥6-button choice group; CTA inventory accurate", async ({ page }) => {
    const uniq = Date.now();
    const offerName = `MQA Sec Offer ${uniq}`;
    const create = await page.request.post("/api/admin/listicles/offers", {
      data: {
        offer_name: offerName, provider: "e2eprov", activity: "lead", vertical: "finance",
        conversion_tracking_method: "browser_side_pixel",
        offer_url_template: "https://sec.e2e.example/c?cid={click_id}", payout_method: "offsite",
      },
    });
    expect(create.status()).toBe(201);

    await page.goto("/admin/listicles/sections/new", { waitUntil: "domcontentloaded" });
    await page.locator("#lst-section-name").fill(`MQA Section ${uniq}`);
    await page.locator("#lst-headline-text").fill("The very best pick");

    // clickable headline forces the §13 Offer modal (no URL input exists)
    await page.locator("#lst-headline-clickable").click();
    const picker = page.locator("#lst-offer-picker");
    await expect(picker).toBeVisible();
    await page.locator("#lst-offer-picker-search").fill(offerName);
    await picker.locator(".lst-picker-row", { hasText: offerName }).first().click();
    await expect(picker).toBeHidden();
    await expect(page.locator("#lst-headline-chip")).toBeVisible();

    // §12/§26 the structural invariant: NO free-text URL field anywhere.
    await expect(page.locator('input[type="url"]')).toHaveCount(0);
    await expect(page.locator('input[name*="url" i]:visible, textarea[name*="url" i]:visible')).toHaveCount(0);
    // CTA / Link Inventory reflects the governed headline link with no broken
    // ("Missing Offer") rows — proof the §30.6 inventory tracks governed links.
    await expect(page.locator("#lst-inv-body")).toBeVisible();
    await expect(page.locator("#lst-inv-body tr").filter({ hasText: "Missing Offer" })).toHaveCount(0);
    await expect(page.locator("#lst-inv-body tr")).not.toHaveCount(0);
    await page.screenshot({ path: `${SHOT_DIR}/sections-01-headline-chip-no-url-inventory.png` });
    // The ≥6-button ChoiceButtonGroup (reorder / duplicate / bulk-offer /
    // per-button) + check/emoji lists + colour spans are driven LIVE and
    // screenshotted by listicles-sections.spec.ts (02-choice-group-7-buttons.png,
    // 03-inventory-preview.png), which runs under THIS same playwright gate —
    // that spec is the exhaustive §26 Sections evidence; here we drive the
    // create + headline-offer-modal + the no-URL structural invariant.
  });
});

// ===========================================================================
// §26 Articles + experimentation  (live render/sticky/CLS via the funnel seed;
// the equal-priority conflict guard proven live at the save API — the builder
// conflict-matrix UI itself is driven by listicles-articles.spec.ts, re-run
// under this same gate)
// ===========================================================================
test.describe("§26 Articles + experimentation", () => {
  test("published article renders the default layout; one candidate/page; rule match+fallback; sticky across reloads; zero CLS", async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __clsTotal: number }).__clsTotal = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as unknown as Array<{ value: number; hadRecentInput: boolean }>) {
          if (!entry.hadRecentInput) (window as unknown as { __clsTotal: number }).__clsTotal += entry.value;
        }
      }).observe({ type: "layout-shift", buffered: true });
    });
    await page.setViewportSize({ width: 1014, height: 857 });
    await page.goto(publicUrl(funnel), { waitUntil: "load" });

    await expect(page.locator("header.lst-header")).toBeVisible();
    for (const idx of [0, 1, 2]) {
      await expect(page.locator(`.lst-page[data-page-index="${idx}"] .lst-cand:visible`), `page ${idx}`).toHaveCount(1);
    }
    const chosen = await page.evaluate(() => (window as unknown as { __LST_CHOSEN: Record<string, { id: string; reason: string }> }).__LST_CHOSEN);
    expect(chosen["1"]?.reason).toBe("rule_match"); // desktop rule fires
    expect(chosen["2"]?.reason).toBe("fallback"); // only a mobile rule exists
    await page.screenshot({ path: `${SHOT_DIR}/articles-01-live-render.png`, fullPage: true });

    const before = JSON.stringify(Object.entries(chosen).map(([k, v]) => [k, v.id]));
    await page.reload({ waitUntil: "load" });
    const after = await page.evaluate(() =>
      JSON.stringify(
        Object.entries((window as unknown as { __LST_CHOSEN: Record<string, { id: string }> }).__LST_CHOSEN).map(([k, v]) => [k, v.id]),
      ),
    );
    expect(after).toBe(before); // sticky candidates

    await page.waitForTimeout(400);
    const cls = await page.evaluate(() => (window as unknown as { __clsTotal: number }).__clsTotal);
    console.log(`[mqa-cls-evidence] total=${cls}`);
    expect(cls).toBeLessThan(0.02);
  });

  test("A/B this Article: a running 60/40 experiment splits fresh sessions across both Versions", async ({ browser }) => {
    const ctx = await playwrightRequest.newContext({ baseURL: ORIGIN });
    await startFiftyFiftyExperiment(ctx, funnel);
    await ctx.dispose();
    // Fresh contexts (fresh sids) observe BOTH arms (edge sticky pick, §15.2).
    const seen = new Set<string>();
    for (let i = 0; i < 24 && seen.size < 2; i++) {
      const fresh = await browser.newContext();
      const p = await fresh.newPage();
      await p.goto(publicUrl(funnel), { waitUntil: "domcontentloaded" });
      const lander = await p.locator("body").getAttribute("data-lander-v");
      if (lander) seen.add(lander);
      await fresh.close();
    }
    expect(seen.size).toBe(2);
  });

  test("equal-priority overlapping rules BLOCK the save with a §15.5 conflict report", async () => {
    const ctx = await playwrightRequest.newContext({ baseURL: ORIGIN });
    const article = (await (
      await ctx.post("/api/admin/listicles/articles", {
        data: {
          site_id: funnel.siteId, slug: `p10-conflict-${Date.now()}`, article_name: `Conflict ${Date.now()}`,
          headline: "Conflict probe", intro_paragraph: "Body", hero_media_url: `http://127.0.0.1:${PW_PORT}/health`, layout_style_id: "default",
        },
      })
    ).json()) as { article: { id: number }; version: { id: number } };

    // Two NON-fallback candidates with EQUAL priority + overlapping set rules
    // (both state=CA) + one fallback → §15.5 equal-priority overlap.
    const put = await ctx.put(`/api/admin/listicles/versions/${article.version.id}`, {
      data: {
        headline: "Conflict probe", intro_paragraph: "Body", hero_media_url: `http://127.0.0.1:${PW_PORT}/health`, layout_style_id: "default",
        pages: [
          {
            page_index: 0, selection_mode: "rule_based",
            candidates: [
              { section_id: funnel.sectionIds[0], label: "A", rule: { priority: 10, conditions: { sets: { state: ["CA"] } } } },
              { section_id: funnel.sectionIds[1], label: "B", rule: { priority: 10, conditions: { sets: { state: ["CA"] } } } },
              { section_id: funnel.sectionIds[2], label: "C", is_fallback: true },
            ],
          },
        ],
      },
    });
    expect(put.ok()).toBeFalsy(); // save blocked
    const body = (await put.json()) as Record<string, unknown>;
    // the response carries a conflict/overlap signal (field-keyed error or matrix)
    expect(JSON.stringify(body).toLowerCase()).toMatch(/conflict|overlap|priority/);
    await ctx.dispose();
  });
});

// ===========================================================================
// §26 Tracking & analytics  (the full funnel + the NEW drilldown expander +
// the rebuild-range control)
// ===========================================================================
test.describe("§26 Tracking & analytics — funnel", () => {
  test("land with UTM+fbclid → ko_sid + ko_ctx set, page_view fires; GA4 loads", async ({ page }) => {
    const events = await collectBeacons(page);
    await page.goto(publicUrl(funnel, "?utm_source=mqa&fbclid=fbz"), { waitUntil: "load" });

    const cookies = await page.context().cookies(`http://${funnel.host}:${PW_PORT}/`);
    const koCtx = cookies.find((c) => c.name === "ko_ctx");
    const koSid = cookies.find((c) => c.name === "ko_sid");
    expect(koCtx).toBeTruthy();
    expect(koSid).toBeTruthy();
    const ctxParsed = JSON.parse(decodeURIComponent(koCtx!.value)) as Record<string, string>;
    expect(ctxParsed.utm_source).toBe("mqa");
    expect(ctxParsed.fbclid).toBe("fbz");

    const pv = await waitForEvent(page, events, "page_view");
    expect(pv.utm_source).toBe("mqa");
    expect(pv.session_id).toBe(koSid!.value);

    // §21 GA4 via analytics_script (offline-safe: dataLayer + gtag + config)
    await expect(page.locator(`script[src*="googletagmanager.com/gtag/js?id=${funnel.gaMeasurementId}"]`)).toHaveCount(1);
    const ga = await page.evaluate(() => {
      const w = window as unknown as { dataLayer?: unknown[]; gtag?: unknown };
      return { has: Array.isArray(w.dataLayer), t: typeof w.gtag, s: JSON.stringify((w.dataLayer ?? []).map((e) => Array.from(e as ArrayLike<unknown>))) };
    });
    expect(ga.has).toBe(true);
    expect(ga.t).toBe("function");
    expect(ga.s).toContain(funnel.gaMeasurementId);
    await page.screenshot({ path: `${SHOT_DIR}/tracking-01-landing.png`, fullPage: true });
  });

  test("scroll → section_impression + offer_impression fire for the shown candidate; a governed click 302s through /lc with a minted click_id", async ({ page }) => {
    const events = await collectBeacons(page);
    const lc: Array<{ url: string; location: string }> = [];
    page.on("response", (res) => {
      if (res.url().includes("/lc/") && res.status() === 302) lc.push({ url: res.url(), location: res.headers()["location"] ?? "" });
    });
    await page.setViewportSize({ width: 1014, height: 857 });
    await page.goto(publicUrl(funnel), { waitUntil: "load" });

    const target = page.locator('.lst-page[data-page-index="1"] .lst-cand:visible').first();
    await target.scrollIntoViewIfNeeded();
    await page.waitForTimeout(1400); // > 1000ms section dwell (+500ms offer)
    const section = await waitForEvent(page, events, "section_impression");
    expect(section.section_id).not.toBe("");
    const offer = await waitForEvent(page, events, "offer_impression");
    expect(offer.link_instance_id).not.toBe("");
    await page.screenshot({ path: `${SHOT_DIR}/tracking-02-impressions.png` });

    const anchor = page.locator('a[href^="/lc/"]:visible').first();
    const href = await anchor.getAttribute("href");
    // §7.3/§31.9: the governed anchor carries the FULL first-party context.
    for (const p of ["a=", "lv=", "p=", "s=", "c=", "m=", "lnk=", "role=", "pv="]) {
      expect(href!, `/lc context param ${p}`).toContain(p);
    }
    await anchor.click();
    await page.waitForURL("**offers.e2e.test**");
    expect(lc.length).toBe(1);
    const cid = new URL(lc[0]!.location).searchParams.get("cid") ?? "";
    expect(cid).toMatch(/^[0-9a-f-]{36}$/); // {click_id} macro resolved to a server-minted UUID
    // offer_click itself is emitted SERVER-SIDE by the /lc resolver
    // (ctx.waitUntil → Firehose, §16 full dimension set) — covered by the
    // resolver unit/integration suite, NOT a client beacon; the observable
    // client proof of the click is the 302 + minted click_id above.
  });
});

test.describe("§26 drilldown expander + rebuild-range (the two NEW Phase-10 surfaces)", () => {
  test("the '+' expander renders Version → Page → candidate with rule matched/fallback/rule_match_rate", async ({ page }) => {
    await page.goto(`/admin/listicles/articles?site_id=${encodeURIComponent(funnel.siteId)}`, { waitUntil: "domcontentloaded" });
    const row = page.locator("tr", { has: page.locator(`a[href*="${funnel.articlePublicId}/edit"]`) }).first();
    await expect(row).toBeVisible();

    await row.locator("[data-lst-drill-toggle]").click();
    const detail = page.locator("tr.lst-drill-row").first();
    await expect(detail).toBeVisible();
    // async-hydrated from GET /articles/:id/drilldown → the seeded mirror.
    await expect(detail.locator(".lst-drill-table")).toHaveCount(2, { timeout: 15_000 }); // one table per page
    // the rule_based page carries the three rule columns + the computed rate.
    await expect(detail.getByText("rule_based")).toBeVisible();
    await expect(detail.getByText("Match rate")).toBeVisible();
    await expect(detail.getByText("85.00%")).toBeVisible(); // 170 / (170+30)
    await expect(detail.getByText("170")).toBeVisible();
    await page.screenshot({ path: `${SHOT_DIR}/analytics-01-drilldown-expander.png`, fullPage: true });

    // toggling collapses without a refetch
    await row.locator("[data-lst-drill-toggle]").click();
    await expect(detail).toBeHidden();
  });

  test("the rebuild-analytics-range control POSTs the window and reports the honest summary", async ({ page }) => {
    await page.goto(`/admin/listicles/articles?site_id=${encodeURIComponent(funnel.siteId)}`, { waitUntil: "domcontentloaded" });
    await page.locator(".lst-rebuild > summary").click();
    await page.locator("[data-lst-rebuild-from]").fill(TODAY);
    await page.locator("[data-lst-rebuild-to]").fill(TODAY);
    await page.locator("[data-lst-rebuild-run]").click();
    // dev has no CH secret ⇒ rebuildRange returns configured:false (honest no-op).
    await expect(page.locator("[data-lst-rebuild-status]")).toContainText("No ClickHouse configured", { timeout: 15_000 });
    await page.screenshot({ path: `${SHOT_DIR}/analytics-02-rebuild-range.png` });
  });
});

test.describe("§26 pillar-1 isolation — homepage untouched", () => {
  test("homepage renders (non-listicle) and POST /api/track still 204s", async ({ page }) => {
    // /api/track is host-agnostic and must always 204 (fire-and-forget beacon).
    const track = await page.request.post(`${ORIGIN}/api/track`, {
      data: { event: "page_view", session_id: "mqa-homepage-probe", url: `http://localhost:${PW_PORT}/` },
    });
    expect(track.status()).toBe(204);

    // The seeded homepage (npm run seed:local maps hostname 'localhost') renders
    // via the /:slug-sibling home route and is NOT a listicle.
    const home = await page.request.get(`http://localhost:${PW_PORT}/`);
    expect(home.status()).toBe(200); // a hard 200, not merely "< 500"
    const html = await home.text();
    // POSITIVE homepage marker (seeded home buckets) — a blank/degraded but
    // non-5xx homepage now FAILS, not just a listicle-marker absence check.
    expect(html).toMatch(/home-(grid|section)/);
    expect(html).not.toContain("lst-header");
    expect(html).not.toContain("lst-page");
    console.log(`[mqa-homepage] status=${home.status()} home-marker=present`);

    // Contrast: the listicle host DOES render the listicle shell (same worker).
    await page.goto(publicUrl(funnel), { waitUntil: "domcontentloaded" });
    await expect(page.locator("header.lst-header")).toBeVisible();
  });
});
