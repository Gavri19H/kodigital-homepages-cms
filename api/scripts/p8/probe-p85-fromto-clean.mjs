#!/usr/bin/env node
// P8-5 MEASUREMENT-ONLY probe (mission P8-5, this is NOT a fix, NEVER wired
// into CI/package.json/verify:all). Client of the already-running wrangler
// dev on :8901.
//
// Purpose: a conductor drive of an unrelated probe reported that a from_to
// control's `max` field posted 5000 when 40 was typed, but that probe typed
// non-numeric garbage ("H1 4-8") into the field FIRST — so the result is not
// trustworthy. This script drives the SAME live control with ONLY real,
// per-character keyboard typing of clean digits (no garbage, ever), captures
// the real POST /lg/auction body, and separately reads the declared min/max/
// step off the rendered markup + confirms whether the two elements per key
// (range rail + number box) stay in sync.
//
// Usage: node scripts/p8/probe-p85-fromto-clean.mjs

import { chromium } from "playwright";

const HOST = "r2fix.e2e.test";
const PORT = "8901";
const SLUG = "r2fix";
const REAL_CHROME_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const MIN_SEL = '[data-lg-field="p8n_fromto_band_min"] input.lg-input';
const MAX_SEL = '[data-lg-field="p8n_fromto_band_max"] input.lg-input';
const RAIL_MIN_SEL = '[data-lg-field="p8n_fromto_band_min"] input.lg-range-input-dual';
const RAIL_MAX_SEL = '[data-lg-field="p8n_fromto_band_max"] input.lg-range-input-dual';
const ZIP_SEL = '[data-lg-field="p8_addr_zip"] input';
// The NEIGHBOURING dual_range control (same section 4 of the r2fix funnel).
// It shares syncDualRange with from_to, so the same lens is pointed at it: it
// is handles-only (§6.8 "dual_range (= from_to, handles not inputs)"), so its
// only real input path is the rail — driven here with the native keyboard rail
// (role=slider: Arrow = one step, Home/End = the ends), never el.value=.
const DUAL_MIN_RAIL = '[data-lg-field="p8n_dual_band_min"] input.lg-range-input-dual';
const DUAL_MAX_RAIL = '[data-lg-field="p8n_dual_band_max"] input.lg-range-input-dual';

function say(line) {
  console.log(line);
}

async function pollFor(page, desc, fn, attempts = 12, intervalMs = 2000) {
  for (let i = 1; i <= attempts; i++) {
    const ok = await fn();
    say(`  poll[${desc}] attempt ${i}/${attempts} -> ${ok}`);
    if (ok) return true;
    await page.waitForTimeout(intervalMs);
  }
  return false;
}

async function clickLastContinue(page) {
  return page.evaluate(() => {
    const btns = [...document.querySelectorAll("button,[data-lg-continue],.lg-continue")].filter(
      (b) => (b.offsetWidth || b.offsetHeight) && /continue|next|go|submit|see|get/i.test(b.textContent || ""),
    );
    const btn = btns[btns.length - 1];
    if (!btn) return false;
    btn.click();
    return true;
  });
}

async function typeClean(page, selector, value) {
  await page.click(selector);
  await page.keyboard.press("End");
  for (let i = 0; i < 12; i++) await page.keyboard.press("Backspace");
  await page.keyboard.type(value, { delay: 25 });
  await page.keyboard.press("Tab"); // blur -> commit/reconcile
}

async function driveToFromTo(page) {
  const uniq = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await page.goto(`http://${HOST}:${PORT}/lg/${SLUG}?_cb=${uniq}`, { waitUntil: "domcontentloaded" });
  const ready = await pollFor(page, "engine-ready", () =>
    page.evaluate(() => document.getElementById("lg-funnel-root")?.getAttribute("data-lg-ready") === "1"),
  );
  if (!ready) throw new Error("STOP: engine never reached data-lg-ready=1 (server may be down)");

  await clickLastContinue(page); // step0: plain continue
  await page.waitForTimeout(700);
  await pollFor(page, "address-visible", () => page.evaluate((s) => !!document.querySelector(s), ZIP_SEL), 8, 1500);
  await page.fill(ZIP_SEL, "90210");
  await clickLastContinue(page); // step1: address
  await page.waitForTimeout(700);
  await clickLastContinue(page); // step2: RVW2D probe
  await page.waitForTimeout(700);
  await clickLastContinue(page); // step3: R2C3 probe
  await page.waitForTimeout(700);
  const gotFromTo = await pollFor(
    page,
    "fromto-visible",
    () =>
      page.evaluate((s) => {
        const el = document.querySelector(s);
        return !!el && (el.offsetWidth > 0 || el.offsetHeight > 0);
      }, MIN_SEL),
    8,
    1500,
  );
  if (!gotFromTo) throw new Error("STOP: from_to number inputs never became visible");
}

async function readBounds(page) {
  return page.evaluate(
    ({ minSel, maxSel, railMinSel, railMaxSel }) => {
      const g = (sel, attr) => document.querySelector(sel)?.getAttribute(attr) ?? null;
      return {
        num_min: { min: g(minSel, "min"), max: g(minSel, "max"), step: g(minSel, "step") },
        num_max: { min: g(maxSel, "min"), max: g(maxSel, "max"), step: g(maxSel, "step") },
        rail_min: { min: g(railMinSel, "min"), max: g(railMinSel, "max"), step: g(railMinSel, "step") },
        rail_max: { min: g(railMaxSel, "min"), max: g(railMaxSel, "max"), step: g(railMaxSel, "step") },
        countMin: document.querySelectorAll('[data-lg-field="p8n_fromto_band_min"] [data-lg-input]').length,
        countMax: document.querySelectorAll('[data-lg-field="p8n_fromto_band_max"] [data-lg-input]').length,
      };
    },
    { minSel: MIN_SEL, maxSel: MAX_SEL, railMinSel: RAIL_MIN_SEL, railMaxSel: RAIL_MAX_SEL },
  );
}

// dual_range: declared attrs + the STRUCTURAL fact that decides whether the
// typed-value class can exist there at all (how many .lg-input boxes it has).
async function readDualBounds(page) {
  return page.evaluate(
    ({ loSel, hiSel }) => {
      const el = (sel) => document.querySelector(sel);
      const g = (sel, attr) => el(sel)?.getAttribute(attr) ?? null;
      const wrap = el(loSel)?.closest(".lg-range") ?? null;
      return {
        sliderType: wrap?.getAttribute("data-slider-type") ?? null,
        rail_lo: { type: el(loSel)?.type ?? null, min: g(loSel, "min"), max: g(loSel, "max"), step: g(loSel, "step") },
        rail_hi: { type: el(hiSel)?.type ?? null, min: g(hiSel, "min"), max: g(hiSel, "max"), step: g(hiSel, "step") },
        railsInWrapper: wrap ? wrap.querySelectorAll("input.lg-range-input-dual").length : null,
        numberBoxesInWrapper: wrap ? wrap.querySelectorAll("input.lg-input").length : null,
      };
    },
    { loSel: DUAL_MIN_RAIL, hiSel: DUAL_MAX_RAIL },
  );
}

// Real keyboard on the real rail (role=slider). No .fill(), no el.value=.
async function driveDual(page, plan) {
  for (const [sel, key, times] of plan) {
    await page.focus(sel);
    for (let i = 0; i < times; i++) {
      await page.keyboard.press(key);
      await page.waitForTimeout(40);
    }
  }
  await page.keyboard.press("Tab"); // blur -> commit, same as the typed path
}

async function readDualState(page) {
  return page.evaluate(
    ({ loSel, hiSel }) => {
      const v = (sel) => document.querySelector(sel)?.value ?? null;
      const aria = (sel) => document.querySelector(sel)?.getAttribute("aria-valuenow") ?? null;
      return { dualLoVal: v(loSel), dualHiVal: v(hiSel), dualLoAria: aria(loSel), dualHiAria: aria(hiSel) };
    },
    { loSel: DUAL_MIN_RAIL, hiSel: DUAL_MAX_RAIL },
  );
}

async function readLiveState(page) {
  return page.evaluate(
    ({ minSel, maxSel, railMinSel, railMaxSel }) => {
      const v = (sel) => document.querySelector(sel)?.value ?? null;
      const aria = (sel) => document.querySelector(sel)?.getAttribute("aria-valuenow") ?? null;
      return {
        numMinBox: v(minSel),
        numMaxBox: v(maxSel),
        railMinVal: v(railMinSel),
        railMaxVal: v(railMaxSel),
        railMinAria: aria(railMinSel),
        railMaxAria: aria(railMaxSel),
      };
    },
    { minSel: MIN_SEL, maxSel: MAX_SEL, railMinSel: RAIL_MIN_SEL, railMaxSel: RAIL_MAX_SEL },
  );
}

const CASES = [
  { name: "clean-in-range (min=20000,max=60000)", min: "20000", max: "60000" },
  { name: "min-untouched, max=40 (exact original numbers)", min: null, max: "40" },
  { name: "min-untouched, max=100000 (at declared max)", min: null, max: "100000" },
  { name: "min-untouched, max=150000 (above declared max)", min: null, max: "150000" },
  // typed max BELOW the typed min — the one real ordering conflict.
  { name: "conflict: min=20000 then max=100 (typed max below min)", min: "20000", max: "100" },
  // dual_range (handles-only) driven by the KEYBOARD rail, not the number box.
  {
    name: "dual_range rails, no crossing (max -5 steps, min +3 steps)",
    min: null,
    max: null,
    dual: [
      [DUAL_MAX_RAIL, "ArrowLeft", 5],
      [DUAL_MIN_RAIL, "ArrowRight", 3],
    ],
  },
  {
    name: "dual_range rails, max dragged onto min (Home = crossing)",
    min: null,
    max: null,
    dual: [[DUAL_MAX_RAIL, "Home", 1]],
  },
];

const VIEWPORTS = [
  { label: "1280", width: 1280, height: 950 },
  { label: "375", width: 375, height: 812 },
];

const browser = await chromium.launch({ args: [`--host-resolver-rules=MAP ${HOST} 127.0.0.1`] });
let boundsPrinted = false;
const results = [];

for (const vp of VIEWPORTS) {
  for (const c of CASES) {
    say(`\n=== case="${c.name}" viewport=${vp.label} ===`);
    const context = await browser.newContext({ userAgent: REAL_CHROME_UA, viewport: { width: vp.width, height: vp.height } });
    const page = await context.newPage();
    const auctions = [];
    page.on("request", (r) => {
      if (r.url().includes("/lg/auction")) {
        let body = null;
        try {
          body = JSON.parse(r.postData() ?? "null");
        } catch {
          body = r.postData();
        }
        auctions.push(body);
      }
    });
    const errs = [];
    page.on("pageerror", (e) => errs.push(e.message));

    try {
      await driveToFromTo(page);
      if (!boundsPrinted) {
        const bounds = await readBounds(page);
        say(`DECLARED BOUNDS (from live markup): ${JSON.stringify(bounds)}`);
        say(`DUAL_RANGE STRUCTURE + BOUNDS: ${JSON.stringify(await readDualBounds(page))}`);
        boundsPrinted = true;
      }
      if (c.min !== null) await typeClean(page, MIN_SEL, c.min);
      if (c.max !== null) await typeClean(page, MAX_SEL, c.max);
      if (c.dual !== undefined) await driveDual(page, c.dual);
      const live = { ...(await readLiveState(page)), ...(await readDualState(page)) };
      say(`post-blur live state: ${JSON.stringify(live)}`);

      await page.evaluate(() => {
        const btn = document.querySelector('[data-value="acme_insurance"]');
        if (btn) btn.click();
      });
      await page.waitForTimeout(500);

      let advanced = await pollFor(page, "advance-to-auction", async () => {
        if (auctions.length > 0) return true;
        await clickLastContinue(page);
        await page.waitForTimeout(1200);
        return auctions.length > 0;
      }, 8, 1500);

      const ans = auctions.length > 0 && auctions[auctions.length - 1]?.answers ? auctions[auctions.length - 1].answers : null;
      const row = {
        case: c.name,
        viewport: vp.label,
        enteredMin: c.min,
        enteredMax: c.max,
        postedMin: ans ? ans["p8n_fromto_band_min"]?.value ?? "(absent)" : "(no auction captured)",
        postedMax: ans ? ans["p8n_fromto_band_max"]?.value ?? "(absent)" : "(no auction captured)",
        postedDualMin: ans ? ans["p8n_dual_band_min"]?.value ?? "(absent)" : "(no auction captured)",
        postedDualMax: ans ? ans["p8n_dual_band_max"]?.value ?? "(absent)" : "(no auction captured)",
        liveNumMinBox: live.numMinBox,
        liveNumMaxBox: live.numMaxBox,
        liveRailMinVal: live.railMinVal,
        liveRailMaxVal: live.railMaxVal,
        liveDualLo: live.dualLoVal,
        liveDualHi: live.dualHiVal,
        pageErrors: errs.slice(0, 3),
      };
      results.push(row);
      say(`RESULT: ${JSON.stringify(row)}`);
    } catch (e) {
      say(`ERROR in case="${c.name}" viewport=${vp.label}: ${e.message}`);
      results.push({ case: c.name, viewport: vp.label, error: e.message });
    } finally {
      await context.close();
    }
  }
}

await browser.close();
say(`\n=== SUMMARY (${results.length} rows) ===`);
for (const r of results) say(JSON.stringify(r));
