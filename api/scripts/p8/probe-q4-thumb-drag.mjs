#!/usr/bin/env node
// P8-6 Q4 MEASUREMENT-ONLY probe. Extends scripts/p8/probe-p85-fromto-clean.mjs
// (same host/slug/selectors/drive) with the missing half: after a TYPED value,
// a REAL POINTER DRAG on each thumb, plus the pixel geometry of both thumbs.
// Never wired into CI. Client of the already-running wrangler dev on :8901.
//
// Usage: node probe-q4-thumb-drag.mjs

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
  await clickLastContinue(page);
  await page.waitForTimeout(700);
  await pollFor(page, "address-visible", () => page.evaluate((s) => !!document.querySelector(s), ZIP_SEL), 8, 1500);
  await page.fill(ZIP_SEL, "90210");
  await clickLastContinue(page);
  await page.waitForTimeout(700);
  await clickLastContinue(page);
  await page.waitForTimeout(700);
  await clickLastContinue(page);
  await page.waitForTimeout(700);
  const got = await pollFor(
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
  if (!got) throw new Error("STOP: from_to number inputs never became visible");
}

// The geometry that decides which thumb the pointer grabs.
async function readGeom(page) {
  return page.evaluate(() => {
    const wrap = document.querySelector(".lg-range-from-to");
    if (!wrap) return { error: "no .lg-range-from-to" };
    const r = (sel) => {
      const el = wrap.querySelector(sel);
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { x: Math.round(b.x * 10) / 10, w: Math.round(b.width * 10) / 10, cx: Math.round((b.x + b.width / 2) * 10) / 10, cy: Math.round((b.y + b.height / 2) * 10) / 10 };
    };
    const rails = [...wrap.querySelectorAll("input.lg-range-input-dual")];
    return {
      track: r(".lg-range-track"),
      fill: r(".lg-range-fill"),
      handleMin: r(".lg-range-handle-min"),
      handleMax: r(".lg-range-handle-max"),
      railCount: rails.length,
      railVals: rails.map((x) => x.value),
      railZ: rails.map((x) => getComputedStyle(x).zIndex),
      railPE: rails.map((x) => getComputedStyle(x).pointerEvents),
      railClip: rails.map((x) => getComputedStyle(x).clipPath),
      pills: [...wrap.querySelectorAll(".lg-range-handle-value")].map((p) => p.textContent),
    };
  });
}

async function readLiveState(page) {
  return page.evaluate(
    ({ minSel, maxSel, railMinSel, railMaxSel }) => {
      const v = (sel) => document.querySelector(sel)?.value ?? null;
      return {
        numMinBox: v(minSel),
        numMaxBox: v(maxSel),
        railMinVal: v(railMinSel),
        railMaxVal: v(railMaxSel),
      };
    },
    { minSel: MIN_SEL, maxSel: MAX_SEL, railMinSel: RAIL_MIN_SEL, railMaxSel: RAIL_MAX_SEL },
  );
}

// A REAL pointer drag: press at (x,y), move in steps, release.
async function dragFrom(page, x, y, toX) {
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(x + ((toX - x) * i) / 10, y, { steps: 1 });
    await page.waitForTimeout(20);
  }
  await page.mouse.up();
  await page.waitForTimeout(200);
}

const CASES = [
  {
    name: "TYPED max=40 then REAL DRAG on the MIN thumb to ~50% of the track",
    typeMax: "40",
    grab: "handleMin",
    toFrac: 0.5,
  },
  {
    name: "TYPED max=40 then REAL DRAG on the MAX thumb to ~50% of the track",
    typeMax: "40",
    grab: "handleMax",
    toFrac: 0.5,
  },
  {
    name: "SEPARATED (min=20000,max=60000): drag MIN thumb right to ~40%",
    typeMin: "20000",
    typeMax: "60000",
    grab: "handleMin",
    toFrac: 0.4,
  },
  {
    name: "SEPARATED (min=20000,max=60000): drag MAX thumb left to ~70%",
    typeMin: "20000",
    typeMax: "60000",
    grab: "handleMax",
    toFrac: 0.7,
  },
];

const browser = await chromium.launch({ args: [`--host-resolver-rules=MAP ${HOST} 127.0.0.1`] });
const results = [];
try {
  for (const c of CASES) {
    say(`\n=== case="${c.name}" ===`);
    const context = await browser.newContext({ userAgent: REAL_CHROME_UA, viewport: { width: 1280, height: 950 } });
    const page = await context.newPage();
    const auctions = [];
    page.on("request", (r) => {
      if (r.url().includes("/lg/auction")) {
        try {
          auctions.push(JSON.parse(r.postData() ?? "null"));
        } catch {
          auctions.push(r.postData());
        }
      }
    });
    const errs = [];
    page.on("pageerror", (e) => errs.push(e.message));
    try {
      await driveToFromTo(page);
      if (c.typeMin) await typeClean(page, MIN_SEL, c.typeMin);
      if (c.typeMax) await typeClean(page, MAX_SEL, c.typeMax);
      const before = await readGeom(page);
      say(`GEOM BEFORE DRAG: ${JSON.stringify(before)}`);
      say(`STATE BEFORE DRAG: ${JSON.stringify(await readLiveState(page))}`);
      const h = before[c.grab];
      if (!h) throw new Error(`STOP: no ${c.grab} rect`);
      const t = before.track;
      const toX = t.x + t.w * c.toFrac;
      say(`DRAG: grab ${c.grab} at (${h.cx},${h.cy}) -> x=${Math.round(toX)} (track ${t.x}..${Math.round(t.x + t.w)})`);
      await dragFrom(page, h.cx, h.cy, toX);
      const after = await readLiveState(page);
      say(`STATE AFTER DRAG: ${JSON.stringify(after)}`);
      say(`GEOM AFTER DRAG: ${JSON.stringify((await readGeom(page)).pills)}`);

      await page.evaluate(() => document.querySelector('[data-value="acme_insurance"]')?.click());
      await page.waitForTimeout(500);
      await pollFor(
        page,
        "advance-to-auction",
        async () => {
          if (auctions.length > 0) return true;
          await clickLastContinue(page);
          await page.waitForTimeout(1200);
          return auctions.length > 0;
        },
        8,
        1500,
      );
      const ans = auctions.length > 0 && auctions[auctions.length - 1]?.answers ? auctions[auctions.length - 1].answers : null;
      const row = {
        case: c.name,
        typedMin: c.typeMin ?? null,
        typedMax: c.typeMax ?? null,
        grabbed: c.grab,
        postedMin: ans ? ans["p8n_fromto_band_min"]?.value ?? "(absent)" : "(no auction)",
        postedMax: ans ? ans["p8n_fromto_band_max"]?.value ?? "(absent)" : "(no auction)",
        liveNumMinBox: after.numMinBox,
        liveNumMaxBox: after.numMaxBox,
        liveRailMin: after.railMinVal,
        liveRailMax: after.railMaxVal,
        pageErrors: errs.slice(0, 3),
      };
      results.push(row);
      say(`RESULT: ${JSON.stringify(row)}`);
    } catch (e) {
      say(`ERROR in case="${c.name}": ${e.message}`);
      results.push({ case: c.name, error: e.message });
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
say(`\n=== SUMMARY (${results.length} rows) ===`);
for (const r of results) say(JSON.stringify(r));
