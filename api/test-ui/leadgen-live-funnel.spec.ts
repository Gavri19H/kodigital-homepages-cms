// LeadGen fix-contract v2.4 — Group 1 LIVE FUNNEL E2E (11 §11.2, the Phase-1
// exit gate) + the §11.6 anti-false-PASS permanent set (may never be waived).
//
// Drives the REAL public runtime end-to-end on a tenant host over a REAL
// seeded funnel (test-ui/leadgen-fix-p1-seed.ts — admin HTTP APIs only):
// server-rendered first question (JS-disabled check) → hydration → defaults
// transitions → answer clicks + selected state → auto-advance → Continue-mode
// required blocking (+validation_error) → Back restore → dependency
// reveal/hide → /lg/auction POST with the signed binding + answers + mapping
// versions → banners_html render → carrier_impression + offer_impression
// exactly once per slot (duplicate scroll fires none) → governed /lg/lc 302
// with resolved {session_id}/{utm_source}/{response:quote_ref} macros → the
// provider payload the LOCAL MOCK actually received (real ua + traffic +
// computed + placement + value-mapped answer) → CLS-with-content budget →
// sessionStorage mid-funnel restore keeping answers + A/B identity (10 §10.4).
//
// EVIDENCE DISCIPLINE (E4 / 11 §11.6): every beacon assertion is a NETWORK
// interception of the actual POST /lg/track HTTP request payload — never a
// queue/JS inspection. navigator.sendBeacon is disabled per page (init
// script) so the engine uses its OWN production fallback transport,
// fetch(keepalive), whose body Playwright can read (a sendBeacon Blob body is
// opaque to the test harness). The provider-side proof reads the mock
// provider's captured requests (GET :8788/__requests) — the worker's
// server-side fetch is invisible to browser interception by design.
//
// DEV-GUARD NOTE: /lg/auction runs runtimeRequestGuard; local wrangler dev has
// no request.cf, so only the UA heuristics fire — every funnel-driving context
// uses a realistic (non-headless) Chrome UA or the bot arm would 403.
//
// Screenshots (mission live-runtime-proof artifacts): desktop 1280 + mobile
// 375 of the first question and the rendered-banners state, saved under
// test-artifacts/fix-p1/.

import {
  test,
  expect,
  request as playwrightRequest,
  type Page,
} from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  seedFixP1Funnel,
  MOCK_PROVIDER_ORIGIN,
  MOCK_QUOTE_REF,
  type SeededFixP1Funnel,
} from "./leadgen-fix-p1-seed";

const ORIGIN = "http://127.0.0.1:8787";
const SHOT_DIR = "test-artifacts/fix-p1";

// Realistic desktop Chrome UA (see DEV-GUARD NOTE above) — also the exact
// string the payload's source:"macro" ua node must surface to the provider.
const REAL_CHROME_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

test.use({
  launchOptions: { args: ["--host-resolver-rules=MAP *.e2e.test 127.0.0.1"] },
  userAgent: REAL_CHROME_UA,
});

let seeded: SeededFixP1Funnel;

test.beforeAll(async () => {
  mkdirSync(SHOT_DIR, { recursive: true });
  const ctx = await playwrightRequest.newContext({ baseURL: ORIGIN });
  seeded = await seedFixP1Funnel(ctx, { hostPrefix: "lg-fixp1", slug: "fix-p1" });
  await ctx.dispose();
});

function shellUrl(query = ""): string {
  return `http://${seeded.host}:8787/lg/${seeded.slug}${query}`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type TrackedEvent = Record<string, unknown>;

// Capture every event the engine BEACONS over HTTP to POST /lg/track.
// Must be installed BEFORE page.goto (init script + request listener).
async function installTrackCapture(page: Page): Promise<TrackedEvent[]> {
  const events: TrackedEvent[] = [];
  await page.addInitScript(() => {
    // Force the engine's fetch(keepalive) fallback transport (see the module
    // header EVIDENCE DISCIPLINE note) — the beacon still rides a REAL HTTP
    // POST to /lg/track; only the browser API used to send it changes. Both
    // the prototype method and an instance shadow are cleared (belt and
    // braces: a Blob-bodied sendBeacon request is body-opaque to Playwright).
    try {
      delete (Navigator.prototype as unknown as Record<string, unknown>)["sendBeacon"];
    } catch {
      /* prototype may be sealed */
    }
    try {
      Object.defineProperty(navigator, "sendBeacon", { get: () => undefined });
    } catch {
      /* keep sendBeacon — the capture below then sees the beacon URL only */
    }
  });
  page.on("request", (req) => {
    if (req.method() !== "POST" || !req.url().includes("/lg/track")) return;
    const body = req.postData();
    if (body === null) return;
    try {
      const parsed = JSON.parse(body) as { events?: TrackedEvent[] };
      if (Array.isArray(parsed.events)) events.push(...parsed.events);
    } catch {
      /* non-JSON body — ignore */
    }
  });
  return events;
}

function ofType(events: TrackedEvent[], type: string): TrackedEvent[] {
  return events.filter((e) => e["event_type"] === type);
}

async function waitForEventCount(
  events: TrackedEvent[],
  type: string,
  min: number,
  timeout = 10_000,
): Promise<TrackedEvent[]> {
  await expect
    .poll(() => ofType(events, type).length, {
      timeout,
      message: `waiting for >=${min} '${type}' beacon(s) on /lg/track`,
    })
    .toBeGreaterThanOrEqual(min);
  return ofType(events, type);
}

// Collect console errors + uncaught page errors (GA4-unaffected leg asserts
// a clean console — 11 §11.2).
function installConsoleCapture(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => {
    errors.push(`pageerror: ${err.message}`);
  });
  return errors;
}

async function gotoReady(page: Page, query = ""): Promise<void> {
  await page.goto(shellUrl(query), { waitUntil: "load" });
  await expect(page.locator('#lg-funnel-root[data-lg-ready="1"]')).toHaveCount(1, {
    timeout: 10_000,
  });
}

function sectionAt(page: Page, index: number) {
  return page.locator(`[data-lg-section][data-lg-index="${index}"]`);
}

async function readKoSid(page: Page): Promise<string> {
  const cookies = await page.context().cookies(`http://${seeded.host}:8787/`);
  return cookies.find((c) => c.name === "ko_sid")?.value ?? "";
}

async function resetMockProvider(): Promise<void> {
  const ctx = await playwrightRequest.newContext();
  const res = await ctx.post(`${MOCK_PROVIDER_ORIGIN}/__reset`);
  expect(res.status()).toBe(204);
  await ctx.dispose();
}

interface CapturedProviderRequest {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
  received_at: number;
}

async function readMockRequests(): Promise<CapturedProviderRequest[]> {
  const ctx = await playwrightRequest.newContext();
  const res = await ctx.get(`${MOCK_PROVIDER_ORIGIN}/__requests`);
  expect(res.ok()).toBe(true);
  const list = (await res.json()) as CapturedProviderRequest[];
  await ctx.dispose();
  return list;
}

// Drive: answer q1 (Yes), land on section 2. Assumes ready.
async function answerYesAndAdvance(page: Page): Promise<void> {
  await sectionAt(page, 0).locator('[data-lg-choice="true"]').click();
  await expect(sectionAt(page, 1)).toBeVisible();
  await expect(sectionAt(page, 0)).toBeHidden();
}

// ---------------------------------------------------------------------------
// 1 · Server-side first-question render (JS DISABLED) + catalog markup
// ---------------------------------------------------------------------------

test.describe("Group 1 — server render without JS (11 §11.2 / 03 §3.11)", () => {
  test("a javaScriptEnabled:false context sees the first section's question; catalog components are in the served HTML", async ({ browser }) => {
    // Node-side: the EXACT served bytes carry every seeded catalog component's
    // preset markup (the §11.2 "each catalog component type spot-checked
    // rendered" leg, over this funnel's component set).
    const wire = await playwrightRequest.newContext();
    const res = await wire.get(`${ORIGIN}/lg/${seeded.slug}`, {
      headers: { Host: `${seeded.host}:8787` },
    });
    expect(res.status()).toBe(200);
    const html = await res.text();
    for (const marker of [
      'data-lg-question="q_homeowner"', // TwoButtonYesNo (question hook)
      'data-lg-choice="true"', // TwoButtonYesNo yes choice
      'data-lg-choice="false"', // TwoButtonYesNo no choice
      'data-lg-question="q_zip"', // ZIPInputQuestion
      "data-lg-input", // its input hook
      'data-lg-question="q_prior"', // dependent ButtonAnswerGroup
      'data-lg-choice="insured"', // its real stored value
      "data-lg-continue", // ContinueButton
      "data-lg-back", // BackButton
      "data-lg-progress", // ProgressBar
      'data-lg-error-for="zip"', // ValidationError slot
      "data-lg-banners", // auction mount
      "lg-headline", // QuestionHeadline preset markup
    ]) {
      expect(html, `served HTML must contain ${marker}`).toContain(marker);
    }
    // First section visible in the BYTES; the second ships hidden.
    expect(html).toMatch(/<section data-lg-section [^>]*data-lg-index="0"(?![^>]*hidden)/);
    expect(html).toMatch(/<section data-lg-section [^>]*data-lg-index="1"[^>]*hidden/);
    await wire.dispose();

    // Browser-side with JS OFF: the first question is VISIBLE (03 §3.11
    // "renders the first question server-side (visible without JS)").
    const noJs = await browser.newContext({
      javaScriptEnabled: false,
      userAgent: REAL_CHROME_UA,
    });
    const page = await noJs.newPage();
    await page.goto(shellUrl(), { waitUntil: "domcontentloaded" });
    await expect(page.locator('[data-lg-question="q_homeowner"]')).toBeVisible();
    await expect(sectionAt(page, 0).locator('[data-lg-choice="true"]')).toBeVisible();
    await expect(sectionAt(page, 0).locator('[data-lg-choice="false"]')).toBeVisible();
    await expect(sectionAt(page, 1)).toBeHidden();
    // JS never ran: the engine could not have marked readiness.
    await expect(page.locator("#lg-funnel-root")).not.toHaveAttribute("data-lg-ready", "1");
    await noJs.close();
  });
});

// ---------------------------------------------------------------------------
// 2 · Hydration + defaults transitions + answer click + auto-advance
// ---------------------------------------------------------------------------

test.describe("Group 1 — answers, defaults, auto-advance (11 §11.2 / 03 §3.4-3.5)", () => {
  test("default applies (answer_default_applied) → same-value click converts to user_confirmed_default; selected state + auto-advance", async ({ page }) => {
    const events = await installTrackCapture(page);
    await gotoReady(page);

    // §3.4: the authored default_answer was applied ONCE on section entry.
    const defaults = await waitForEventCount(events, "answer_default_applied", 1);
    const def = defaults[0]!;
    expect(def["internal_field"]).toBe(seeded.fields.homeowner);
    expect(def["answer_source"]).toBe("default_applied");
    expect(def["answer_value_normalized"]).toBe("true");

    // Funnel-entry beacons carry the identity envelope.
    const views = await waitForEventCount(events, "quote_view", 1);
    expect(views[0]!["funnel_variant_id"]).toBe(seeded.variantId);
    expect(views[0]!["quote_id"]).toBe(seeded.quotePublicId);
    expect(String(views[0]!["session_id"] ?? "")).not.toBe("");

    // Click the SAME value as the default → selected state + the
    // default_applied → user_confirmed_default transition (§3.4).
    const yes = sectionAt(page, 0).locator('[data-lg-choice="true"]');
    await yes.click();
    await expect(yes).toHaveClass(/lg-selected/);
    await expect(yes).toHaveAttribute("aria-pressed", "true");

    // §11.6: no answer_click beacon after a scripted answer = FAIL.
    const clicks = await waitForEventCount(events, "answer_click", 1);
    const click = clicks[0]!;
    expect(click["internal_field"]).toBe(seeded.fields.homeowner);
    expect(click["question_id"]).toBe("q_homeowner");
    expect(click["answer_value_normalized"]).toBe("true");
    expect(click["answer_source"]).toBe("user_confirmed_default");
    expect(click["section_id"]).toBe(seeded.sectionOnePublicId);

    // §3.5.4 auto-advance: the single-question auto_advance section advanced.
    await expect(sectionAt(page, 1)).toBeVisible();
    await expect(sectionAt(page, 0)).toBeHidden();
    const sectionViews = await waitForEventCount(events, "section_view", 2);
    expect(sectionViews.some((e) => e["section_id"] === seeded.sectionTwoPublicId)).toBe(true);
    const continues = await waitForEventCount(events, "section_continue", 1);
    expect(continues[0]!["section_id"]).toBe(seeded.sectionOnePublicId);

    // Progress over the visible sections: 2 / 2 on the second step.
    const progress = sectionAt(page, 1).locator("[data-lg-progress]");
    await expect(progress).toHaveAttribute("data-lg-progress-current", "2");
    await expect(progress).toHaveAttribute("data-lg-progress-total", "2");
  });
});

// ---------------------------------------------------------------------------
// 3 · Continue-mode blocking, Back restore, dependency reveal/hide
// ---------------------------------------------------------------------------

test.describe("Group 1 — validation, back-nav, dependencies (11 §11.2 / 03 §3.5)", () => {
  test("Continue blocks until required answered (+validation_error); Back restores answers+progress; dependency reveals/hides", async ({ page }) => {
    const events = await installTrackCapture(page);
    await gotoReady(page);
    await answerYesAndAdvance(page);

    // Dependency REVEAL: homeowner="true" satisfies the dependent's rule.
    const dependent = page.locator('[data-lg-question="q_prior"]');
    await expect(dependent).toBeVisible();

    // Continue with the required ZIP empty → blocked + inline error +
    // validation_error beacon; the funnel stays on section 2 (§3.5.4).
    await sectionAt(page, 1).locator("[data-lg-continue]").click();
    await waitForEventCount(events, "continue_click", 1);
    const validationErrors = await waitForEventCount(events, "validation_error", 1);
    expect(validationErrors[0]!["internal_field"]).toBe(seeded.fields.zip);
    expect(String(validationErrors[0]!["answer_value_normalized"] ?? "")).not.toBe("");
    const errorSlot = sectionAt(page, 1).locator('[data-lg-error-for="zip"]');
    await expect(errorSlot).toBeVisible();
    await expect(errorSlot).not.toHaveText("");
    await expect(sectionAt(page, 1)).toBeVisible();
    await expect(sectionAt(page, 0)).toBeHidden();

    // Back → section 1 restored: prior answer still selected, progress 1/2,
    // section_view fires with nav="back" (§3.5.2).
    await sectionAt(page, 1).locator("[data-lg-back]").click();
    await expect(sectionAt(page, 0)).toBeVisible();
    await expect(sectionAt(page, 0).locator('[data-lg-choice="true"]')).toHaveClass(/lg-selected/);
    const progress = sectionAt(page, 0).locator("[data-lg-progress]");
    await expect(progress).toHaveAttribute("data-lg-progress-current", "1");
    await expect
      .poll(() =>
        ofType(events, "section_view").filter(
          (e) => e["nav"] === "back" && e["section_id"] === seeded.sectionOnePublicId,
        ).length,
      )
      .toBeGreaterThanOrEqual(1);

    // Different value (No) → user_selected + dependency HIDE on section 2.
    await sectionAt(page, 0).locator('[data-lg-choice="false"]').click();
    await expect(sectionAt(page, 1)).toBeVisible();
    await expect(dependent).toBeHidden();
    await expect
      .poll(() =>
        ofType(events, "answer_click").filter(
          (e) => e["answer_value_normalized"] === "false" && e["answer_source"] === "user_selected",
        ).length,
      )
      .toBeGreaterThanOrEqual(1);

    // Back again + Yes again → the dependent REVEALS again.
    await sectionAt(page, 1).locator("[data-lg-back]").click();
    await sectionAt(page, 0).locator('[data-lg-choice="true"]').click();
    await expect(sectionAt(page, 1)).toBeVisible();
    await expect(dependent).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 4 · Full traversal: auction binding, banners, impressions, /lg/lc macros,
//     provider payload, GA4 untouched, desktop screenshots
// ---------------------------------------------------------------------------

test.describe("Group 1 — auction → banners → impressions → click (11 §11.2 / 03 §3.6)", () => {
  test("full traversal POSTs /lg/auction with binding+answers+versions; banners render; impressions beacon once; /lg/lc 302 resolves macros; the MOCK captured the real payload", async ({ page }) => {
    test.setTimeout(90_000);
    await resetMockProvider();
    const events = await installTrackCapture(page);
    const consoleErrors = installConsoleCapture(page);

    // m15: count EVERY /lg/auction request from page-load onward — §3.5.6
    // ("the final Section triggers the auction — never before") is ASSERTED
    // below, not narrated.
    let auctionCalls = 0;
    page.on("request", (r) => {
      if (r.url().includes("/lg/auction")) auctionCalls += 1;
    });

    // Navigate WITH acquisition params: utm_source rides the beacons, the
    // /lg/attempt landing-url token slice, the provider payload macro node,
    // and the /lg/lc {utm_source} macro — the traffic-persistence money path.
    await gotoReady(page, "?utm_source=fixp1-fb&sub1=fixp1-sub");
    const koSid = await readKoSid(page);
    expect(koSid).not.toBe("");

    // The inline config is the binding source the engine posts back.
    const cfg = (await page.evaluate(() => {
      const el = document.getElementById("lg-config");
      return el === null ? null : (JSON.parse(el.textContent ?? "{}") as Record<string, unknown>);
    })) as {
      content_version: number;
      section_order_hash: string;
      funnel_variant_id: string;
    } | null;
    expect(cfg).not.toBeNull();

    await page.screenshot({ path: `${SHOT_DIR}/desktop-1280-first-question.png`, fullPage: true });

    // ---- traverse ---------------------------------------------------------
    await answerYesAndAdvance(page);
    await sectionAt(page, 1).locator("[data-lg-input]").first().fill("90210");
    await page.locator('[data-lg-question="q_prior"] [data-lg-choice="insured"]').click();

    // §3.5.6: advancing past the LAST visible section — and never before —
    // triggers the auction. m15: ZERO /lg/auction calls occurred between
    // page-load and this final section advance (asserted, not narrated).
    expect(auctionCalls, "no /lg/auction call may exist before the final section advance").toBe(0);
    const [auctionReq, auctionRes] = await Promise.all([
      page.waitForRequest((r) => r.url().includes("/lg/auction") && r.method() === "POST", {
        timeout: 20_000,
      }),
      page.waitForResponse((r) => r.url().includes("/lg/auction"), { timeout: 20_000 }),
      sectionAt(page, 1).locator("[data-lg-continue]").click(),
    ]);

    // ---- §3.6 request: binding + answers + answer_mapping_versions --------
    const body = auctionReq.postDataJSON() as {
      funnel_attempt_id: string;
      signed_config_token: string;
      funnel_variant_id: string;
      content_version: number;
      section_order_hash: string;
      answers: Record<string, { value: unknown; answer_source: string }>;
      answer_mapping_versions: Record<string, string>;
      session_id: string;
      page_view_id: string;
    };
    expect(body.funnel_attempt_id).toMatch(/^att_/);
    // .dev.vars carries LEADGEN_CONFIG_SIGNING_KEY → a REAL v2 signed token.
    expect(body.signed_config_token).toMatch(/^v2\./);
    expect(body.funnel_variant_id).toBe(seeded.variantId);
    expect(body.content_version).toBe(cfg!.content_version);
    expect(body.section_order_hash).toBe(cfg!.section_order_hash);
    expect(body.section_order_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(body.session_id).toBe(koSid);
    expect(body.page_view_id).not.toBe("");
    expect(body.answers[seeded.fields.homeowner]).toEqual({
      value: "true",
      answer_source: "user_confirmed_default",
    });
    expect(body.answers[seeded.fields.zip]).toEqual({
      value: "90210",
      answer_source: "user_selected",
    });
    expect(body.answers[seeded.fields.dependent]).toEqual({
      value: "insured",
      answer_source: "user_selected",
    });
    // R6: per-section answer_mapping_versions — s1 carries its real mapped
    // version (>0), s2 honestly reports "0" (nothing mapped there).
    expect(body.answer_mapping_versions[seeded.sectionOnePublicId]).toMatch(/^[1-9]\d*$/);
    expect(body.answer_mapping_versions[seeded.sectionTwoPublicId]).toBe("0");

    // ---- §3.6 response: banners + ids + impressions -----------------------
    expect(auctionRes.status()).toBe(200);
    const auction = (await auctionRes.json()) as {
      banners_html: string;
      auction_result_id: string;
      banner_render_id: string;
      impressions: Array<{
        event_type: string;
        offer_id: string;
        placement_id: string;
        slot_index: number;
        auction_result_id: string;
        banner_render_id: string;
      }>;
      unfilled?: true;
    };
    expect(auction.unfilled).toBeUndefined();
    expect(auction.banners_html).toContain("lg-banner");
    expect(auction.auction_result_id).not.toBe("");
    expect(auction.banner_render_id).not.toBe("");
    // 2 mock carriers (one offer): 2 carrier_impression rows + 1
    // offer_impression row, all on the seeded placement.
    const carrierRows = auction.impressions.filter((i) => i.event_type === "carrier_impression");
    const offerRows = auction.impressions.filter((i) => i.event_type === "offer_impression");
    expect(carrierRows.length).toBe(2);
    expect(offerRows.length).toBe(1);
    for (const row of auction.impressions) {
      expect(row.offer_id).toBe(seeded.offerPublicId);
      expect(row.placement_id).toBe(seeded.placementExternalId);
      expect(row.banner_render_id).toBe(auction.banner_render_id);
      expect(row.auction_result_id).toBe(auction.auction_result_id);
    }

    // ---- banners render from banners_html (§3.5.7) ------------------------
    const bannersMount = page.locator("[data-lg-banners]");
    await expect(bannersMount).toBeVisible();
    const anchors = bannersMount.locator("a.lg-banner");
    await expect(anchors).toHaveCount(2);
    await expect(page.locator("#lg-funnel-root")).toHaveAttribute("data-lg-auction", "filled");
    await expect(page.locator("#lg-funnel-root")).toHaveAttribute("data-lg-complete", "1");
    for (const href of await anchors.evaluateAll((els) => els.map((a) => a.getAttribute("href")))) {
      expect(href ?? "").toContain(`/lg/lc/${seeded.offerPublicId}?`);
      for (const param of ["ck=", "aiid=", "brid=", "slot=", "faid="]) {
        expect(href ?? "").toContain(param);
      }
    }

    // quote_complete fires when the auction response is received; the
    // per-attempt sessionStorage state is cleared (§3.5.6 / §3.2 state row).
    const completes = await waitForEventCount(events, "quote_complete", 1);
    expect(completes[0]!["auction_result_id"]).toBe(auction.auction_result_id);
    expect(completes[0]!["banner_render_id"]).toBe(auction.banner_render_id);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const keys: string[] = [];
          for (let i = 0; i < sessionStorage.length; i++) {
            const k = sessionStorage.key(i);
            if (k !== null && k.startsWith("lg:")) keys.push(k);
          }
          return keys.length;
        }),
      )
      .toBe(0);

    // ---- R7 impressions: EXACTLY once per (render, slot, type) ------------
    await bannersMount.scrollIntoViewIfNeeded();
    await expect
      .poll(() => ofType(events, "carrier_impression").length, { timeout: 15_000 })
      .toBe(2);
    await expect
      .poll(() => ofType(events, "offer_impression").length, { timeout: 15_000 })
      .toBe(1);
    const impressionKey = (e: TrackedEvent): string =>
      `${String(e["event_type"])}|${String(e["banner_render_id"])}|${String(e["carrier_position"])}`;
    const fired = [...ofType(events, "carrier_impression"), ...ofType(events, "offer_impression")];
    expect(new Set(fired.map(impressionKey)).size).toBe(3); // no duplicates
    for (const e of fired) {
      expect(e["banner_render_id"]).toBe(auction.banner_render_id);
      expect(e["auction_result_id"]).toBe(auction.auction_result_id);
      expect(e["offer_id"]).toBe(seeded.offerPublicId);
      expect(e["placement_id"]).toBe(seeded.placementExternalId);
    }
    // Duplicate scroll-out/scroll-in fires NOTHING further (fired-set + ids).
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(400);
    await bannersMount.scrollIntoViewIfNeeded();
    await page.waitForTimeout(2_500); // > dwell(1s) + flush(0.8s)
    expect(ofType(events, "carrier_impression").length).toBe(2);
    expect(ofType(events, "offer_impression").length).toBe(1);

    await page.screenshot({ path: `${SHOT_DIR}/desktop-1280-banners.png`, fullPage: true });

    // ---- GA4 untouched + clean console (11 §11.2) --------------------------
    // No GA4 id is seeded: the engine must not create/patch gtag/dataLayer
    // (the dedicated ga4 spec covers the with-GA4 path).
    const ga4State = await page.evaluate(() => ({
      dataLayer: typeof (window as unknown as { dataLayer?: unknown }).dataLayer,
      gtag: typeof (window as unknown as { gtag?: unknown }).gtag,
    }));
    expect(ga4State.dataLayer).toBe("undefined");
    expect(ga4State.gtag).toBe("undefined");
    expect(consoleErrors, `console errors: ${consoleErrors.join(" | ")}`).toEqual([]);

    // No horizontal overflow at 1280 (E6 evidence standard).
    const overflowDesktop = await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    );
    expect(overflowDesktop).toBe(true);

    // ---- governed /lg/lc click → 302 with RESOLVED macros ------------------
    // The mock carriers carry no click_url, so the resolver expands the
    // Offer's banner_url_template: {session_id} + {utm_source} come from the
    // persisted auction macro snapshot; {response:quote_ref} from the
    // redacted winning provider response. The destination is the worker's
    // own any-host /health so the REAL click completes navigation locally.
    const [lcRes] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/lg/lc/"), { timeout: 15_000 }),
      anchors.first().click(),
    ]);
    expect(lcRes.status()).toBe(302);
    const location = lcRes.headers()["location"] ?? "";
    const resolved = new URL(location);
    expect(`${resolved.protocol}//${resolved.host}${resolved.pathname}`).toBe(
      "http://offers.e2e.test:8787/health",
    );
    expect(resolved.searchParams.get("sid")).toBe(koSid); // {session_id}
    expect(resolved.searchParams.get("src")).toBe("fixp1-fb"); // {utm_source}
    expect(resolved.searchParams.get("qr")).toBe(MOCK_QUOTE_REF); // {response:quote_ref}
    await page.waitForURL("**/health**", { timeout: 15_000 });

    // ---- the payload the PROVIDER actually received (user DoD #6) ----------
    const providerRequests = await readMockRequests();
    expect(providerRequests.length).toBe(1); // eligibility gate: exactly the live auction call
    const provider = providerRequests[0]!;
    expect(provider.method).toBe("POST");
    const headerValue = (name: string): string => {
      const v = provider.headers[name];
      return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
    };
    expect(headerValue("x-fix-p1")).toMatch(/^fixp1-/); // seeded static header
    const payload = JSON.parse(provider.body) as {
      lead?: { homeowner_status?: string; zip?: string };
      traffic?: { utm_source?: string };
      meta?: { ua?: string; request_timestamp?: number; placement_id?: string };
    };
    // Evidence for the mission report — the full captured provider payload.
    console.log(`[provider-payload-evidence] ${provider.body}`);
    expect(payload.lead?.homeowner_status).toBe("own"); // value_map "true"→"own"
    expect(payload.lead?.zip).toBe("90210");
    expect(payload.traffic?.utm_source).toBe("fixp1-fb"); // token-persisted traffic
    expect(payload.meta?.ua).toBe(REAL_CHROME_UA); // real client ua macro
    expect(typeof payload.meta?.request_timestamp).toBe("number"); // computed, numeric
    const nowSeconds = Math.floor(Date.now() / 1000);
    expect(payload.meta?.request_timestamp).toBeGreaterThan(nowSeconds - 600);
    expect(payload.meta?.request_timestamp).toBeLessThanOrEqual(nowSeconds + 60);
    expect(payload.meta?.placement_id).toBe(seeded.placementExternalId); // source:"placement"
  });
});

// ---------------------------------------------------------------------------
// 5 · Mobile 375: funnel completes; screenshots; no overflow
// ---------------------------------------------------------------------------

test.describe("Group 1 — mobile 375 (11 §11.2 screenshots + E6)", () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test("mobile funnel renders, completes to banners; 375px screenshots; no horizontal overflow", async ({ page }) => {
    test.setTimeout(60_000);
    await gotoReady(page);
    await expect(page.locator('[data-lg-question="q_homeowner"]')).toBeVisible();
    await page.screenshot({ path: `${SHOT_DIR}/mobile-375-first-question.png`, fullPage: true });

    const noOverflowStart = await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    );
    expect(noOverflowStart).toBe(true);

    await answerYesAndAdvance(page);
    await sectionAt(page, 1).locator("[data-lg-input]").first().fill("90210");
    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/lg/auction"), { timeout: 20_000 }),
      sectionAt(page, 1).locator("[data-lg-continue]").click(),
    ]);
    const bannersMount = page.locator("[data-lg-banners]");
    await expect(bannersMount).toBeVisible();
    await expect(bannersMount.locator("a.lg-banner")).toHaveCount(2);
    await page.screenshot({ path: `${SHOT_DIR}/mobile-375-banners.png`, fullPage: true });

    const noOverflowEnd = await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    );
    expect(noOverflowEnd).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6 · CLS budget met WITH content (11 §11.2 / §11.6 replaced-perf semantics)
// ---------------------------------------------------------------------------

test.describe("Group 1 — CLS with content (11 §11.2)", () => {
  test("layout-shift total stays 0 through server render + hydration of a CONTENT-BEARING funnel", async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __clsTotal: number }).__clsTotal = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as unknown as Array<{
          value: number;
          hadRecentInput: boolean;
        }>) {
          if (!entry.hadRecentInput) {
            (window as unknown as { __clsTotal: number }).__clsTotal += entry.value;
          }
        }
      }).observe({ type: "layout-shift", buffered: true });
    });

    await gotoReady(page);
    await page.evaluate(() => document.fonts.ready);
    // The first section is server-rendered CONTENT (not an empty mount);
    // hydration (ready flag above) must not shift it.
    await expect(page.locator('[data-lg-question="q_homeowner"]')).toBeVisible();
    await page.waitForTimeout(500);

    const cls = await page.evaluate(() => (window as unknown as { __clsTotal: number }).__clsTotal);
    console.log(`[cls-evidence] live-funnel WITH-CONTENT layout-shift total=${cls}`);
    // Budget justification (11 §11.2 "CLS budget met WITH content"): the
    // content-bearing funnel measures a real sub-millipoint shift (~0.0004,
    // observed) from the ProgressBar label hydration — render.ts
    // updateProgress writes "1 / 2" textContent into the server-rendered
    // .lg-progress (a presets↔render slot drift: presets emit
    // .lg-progress-track/.lg-progress-fill, render.ts looks for
    // [data-lg-progress-bar]/[data-lg-progress-label]; parity is the 09 §9.3
    // Phase-5 matrix). 0.01 keeps the budget 10x under the 0.1 "good"
    // web-vitals threshold while measuring REAL content — the old empty-mount
    // 0 was the 11 §11.6 false comfort. The no-progress p14 perf funnel
    // still pins CLS === 0 (leadgen-perf.spec.ts).
    expect(cls).toBeLessThan(0.01);
  });
});

// ---------------------------------------------------------------------------
// 7 · sessionStorage mid-funnel restore + A/B identity (10 §10.4)
// ---------------------------------------------------------------------------

test.describe("Group 1 — mid-funnel reload restore (11 §11.2 / 10 §10.4)", () => {
  test("reload mid-funnel restores answers + section pointer + A/B identity; state re-keys to the fresh attempt", async ({ page }) => {
    await gotoReady(page);
    const before = await page.evaluate(() => {
      const eng = (window as unknown as {
        __LG_ENGINE__?: { getState: () => { funnel_attempt_id: string } };
      }).__LG_ENGINE__;
      return { attempt: eng?.getState().funnel_attempt_id ?? "" };
    });
    expect(before.attempt).toMatch(/^att_/);
    const variantBefore = await page
      .locator("#lg-funnel-root")
      .getAttribute("data-funnel-variant-id");
    const sidBefore = await readKoSid(page);

    await answerYesAndAdvance(page);
    await sectionAt(page, 1).locator("[data-lg-input]").first().fill("90210");

    await page.reload({ waitUntil: "load" });
    await expect(page.locator('#lg-funnel-root[data-lg-ready="1"]')).toHaveCount(1, {
      timeout: 10_000,
    });

    // Section pointer + answers restored (§3.5.1 restore-by-binding-tuple).
    await expect(sectionAt(page, 1)).toBeVisible();
    await expect(sectionAt(page, 0)).toBeHidden();
    const restored = await page.evaluate(() => {
      const eng = (window as unknown as {
        __LG_ENGINE__?: {
          getState: () => { funnel_attempt_id: string; section_index: number };
          getAnswers: () => Record<string, unknown>;
        };
      }).__LG_ENGINE__;
      const keys: string[] = [];
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i);
        if (k !== null && k.startsWith("lg:")) keys.push(k);
      }
      return {
        attempt: eng?.getState().funnel_attempt_id ?? "",
        sectionIndex: eng?.getState().section_index ?? -1,
        answers: eng?.getAnswers() ?? {},
        lgKeys: keys,
      };
    });
    expect(restored.sectionIndex).toBe(1);
    expect(restored.answers[seeded.fields.homeowner]).toBe("true");
    expect(restored.answers[seeded.fields.zip]).toBe("90210");
    // The dependent (driven by the RESTORED cross-section answer) is visible.
    await expect(page.locator('[data-lg-question="q_prior"]')).toBeVisible();

    // /lg/attempt is no-store: the reload minted a FRESH attempt id and the
    // persisted snapshot was RE-KEYED under it (exactly one lg:* entry).
    expect(restored.attempt).toMatch(/^att_/);
    expect(restored.attempt).not.toBe(before.attempt);
    expect(restored.lgKeys).toEqual([`lg:${restored.attempt}`]);

    // 10 §10.4 A/B identity survives the reload: same session cookie → same
    // assigned variant (identity dims stable across the restore).
    expect(await page.locator("#lg-funnel-root").getAttribute("data-funnel-variant-id")).toBe(
      variantBefore,
    );
    expect(await readKoSid(page)).toBe(sidBefore);
  });
});

// ---------------------------------------------------------------------------
// 8 · §11.6 anti-false-PASS permanent set (may NEVER be waived)
// ---------------------------------------------------------------------------

test.describe("§11.6 anti-false-PASS regression (permanent)", () => {
  test("FAIL if: empty mount after ready · zero questions · no answer_click beacon · /lg/auction never called", async ({ page }) => {
    test.setTimeout(60_000);
    const events = await installTrackCapture(page);
    await gotoReady(page);

    // (1) FAIL if [data-lg-mount] is empty after data-lg-ready="1".
    const mountChildren = await page
      .locator("[data-lg-mount]")
      .evaluate((el) => el.children.length);
    expect(mountChildren, "§11.6: [data-lg-mount] must not be empty after ready").toBeGreaterThan(0);

    // (2) FAIL if zero [data-lg-question] elements exist on a Quote whose
    // Sections carry questions.
    const questionCount = await page.locator("[data-lg-question]").count();
    expect(questionCount, "§11.6: zero [data-lg-question] on a question funnel").toBeGreaterThan(0);

    // (3) FAIL if no answer_click beacon is observed after a scripted answer.
    await sectionAt(page, 0).locator('[data-lg-choice="true"]').click();
    await waitForEventCount(events, "answer_click", 1);

    // (4) FAIL if /lg/auction is never called after completing the final
    // Section.
    await expect(sectionAt(page, 1)).toBeVisible();
    await sectionAt(page, 1).locator("[data-lg-input]").first().fill("10001");
    await Promise.all([
      page.waitForRequest((r) => r.url().includes("/lg/auction") && r.method() === "POST", {
        timeout: 20_000,
      }),
      sectionAt(page, 1).locator("[data-lg-continue]").click(),
    ]);
  });

  // (5) §11.6 leg 5 — the VISUAL-SUITE static tripwire (may never be waived).
  // The original false-comfort (01 §1 root-cause RC-6): a green "visual" suite
  // rendered the admin PREVIEW endpoint into a blank page via a page.setContent
  // static-injection harness — never `/lg` — so it stayed green while the live
  // runtime was blank. This reads the sibling leadgen-visual.spec.ts SOURCE and
  // fails CLOSED if that harness is ever re-introduced or the real-runtime
  // navigation is removed. A STATIC assertion (no browser) by design.
  test("§11.6 leg 5: the visual suite navigates to /lg and NEVER uses a setContent harness", () => {
    const visualSpecPath = join(dirname(fileURLToPath(import.meta.url)), "leadgen-visual.spec.ts");
    const src = readFileSync(visualSpecPath, "utf8");

    // FAIL if the visual suite re-introduces a *.setContent(...) injection
    // harness (the exact §11.6 false-comfort tripwire).
    expect(
      src.includes(".setContent("),
      "§11.6: leadgen-visual.spec.ts must NOT use a .setContent(...) static-injection harness",
    ).toBe(false);

    // FAIL if the visual suite does not drive the REAL runtime: it must
    // page.goto a tenant /lg/ URL.
    expect(
      src.includes("page.goto("),
      "§11.6: leadgen-visual.spec.ts must drive the runtime via page.goto(...)",
    ).toBe(true);
    expect(
      src.includes("/lg/"),
      "§11.6: leadgen-visual.spec.ts must navigate to a tenant /lg/ URL (the real runtime)",
    ).toBe(true);
  });
});
