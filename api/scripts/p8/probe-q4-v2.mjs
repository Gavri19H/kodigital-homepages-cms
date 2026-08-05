#!/usr/bin/env node
// P8-6 Q4 probe v2 — same drive as scripts/p8/probe-p85-fromto-clean.mjs,
// with a REAL pointer drag started at three points across the stacked-thumb
// blob, plus the computed hit-partition geometry. MEASUREMENT ONLY.
import { chromium } from "playwright";

const HOST = "r2fix.e2e.test";
const PORT = "8901";
const SLUG = "r2fix";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const MIN_SEL = '[data-lg-field="p8n_fromto_band_min"] input.lg-input';
const MAX_SEL = '[data-lg-field="p8n_fromto_band_max"] input.lg-input';
const RAIL_MIN = '[data-lg-field="p8n_fromto_band_min"] input.lg-range-input-dual';
const RAIL_MAX = '[data-lg-field="p8n_fromto_band_max"] input.lg-range-input-dual';
const ZIP_SEL = '[data-lg-field="p8_addr_zip"] input';
const say = (l) => console.log(l);

async function pollFor(page, desc, fn, attempts = 12, ms = 2000) {
  for (let i = 1; i <= attempts; i++) {
    const ok = await fn();
    say(`  poll[${desc}] ${i}/${attempts} -> ${ok}`);
    if (ok) return true;
    await page.waitForTimeout(ms);
  }
  return false;
}
const clickLastContinue = (page) =>
  page.evaluate(() => {
    const b = [...document.querySelectorAll("button,[data-lg-continue],.lg-continue")].filter(
      (x) => (x.offsetWidth || x.offsetHeight) && /continue|next|go|submit|see|get/i.test(x.textContent || ""),
    );
    const t = b[b.length - 1];
    if (!t) return false;
    t.click();
    return true;
  });
async function typeClean(page, sel, v) {
  await page.click(sel);
  await page.keyboard.press("End");
  for (let i = 0; i < 12; i++) await page.keyboard.press("Backspace");
  await page.keyboard.type(v, { delay: 25 });
  await page.keyboard.press("Tab");
}
async function driveToFromTo(page) {
  const u = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await page.goto(`http://${HOST}:${PORT}/lg/${SLUG}?_cb=${u}`, { waitUntil: "domcontentloaded" });
  if (!(await pollFor(page, "ready", () => page.evaluate(() => document.getElementById("lg-funnel-root")?.getAttribute("data-lg-ready") === "1"))))
    throw new Error("STOP: engine never ready");
  await clickLastContinue(page);
  await page.waitForTimeout(700);
  await pollFor(page, "addr", () => page.evaluate((s) => !!document.querySelector(s), ZIP_SEL), 8, 1500);
  await page.fill(ZIP_SEL, "90210");
  for (let i = 0; i < 3; i++) {
    await clickLastContinue(page);
    await page.waitForTimeout(700);
  }
  if (
    !(await pollFor(page, "fromto", () => page.evaluate((s) => { const e = document.querySelector(s); return !!e && (e.offsetWidth > 0 || e.offsetHeight > 0); }, MIN_SEL), 8, 1500))
  )
    throw new Error("STOP: from_to never visible");
}
const readGeom = (page) =>
  page.evaluate(() => {
    const w = document.querySelector(".lg-range-from-to");
    const rct = (el) => { const b = el.getBoundingClientRect(); return { x: Math.round(b.x * 10) / 10, w: Math.round(b.width * 10) / 10, cx: Math.round((b.x + b.width / 2) * 10) / 10, cy: Math.round((b.y + b.height / 2) * 10) / 10 }; };
    const rails = [...w.querySelectorAll("input.lg-range-input-dual")];
    const sel = w.querySelectorAll(".lg-range-track > span + span > .lg-range-input-dual");
    return {
      track: rct(w.querySelector(".lg-range-track")),
      handleMin: rct(w.querySelector(".lg-range-handle-min")),
      handleMax: rct(w.querySelector(".lg-range-handle-max")),
      railVals: rails.map((r) => r.value),
      railBox: rails.map((r) => rct(r)),
      railClip: rails.map((r) => getComputedStyle(r).clipPath),
      wrapA: w.style.getPropertyValue("--lg-a"),
      wrapB: w.style.getPropertyValue("--lg-b"),
      selectorMatches: sel.length,
      selectorIsMaxRail: sel.length === 1 && sel[0] === rails[1],
      pills: [...w.querySelectorAll(".lg-range-handle-value")].map((p) => p.textContent),
      pillBoxes: [...w.querySelectorAll(".lg-range-handle-value")].map((p) => rct(p)),
      scrollW: document.documentElement.scrollWidth,
      innerW: window.innerWidth,
    };
  });
const readState = (page) =>
  page.evaluate(({ a, b, c, d }) => {
    const v = (s) => document.querySelector(s)?.value ?? null;
    return { numMin: v(a), numMax: v(b), railMin: v(c), railMax: v(d) };
  }, { a: MIN_SEL, b: MAX_SEL, c: RAIL_MIN, d: RAIL_MAX });
async function drag(page, x, y, toX) {
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) { await page.mouse.move(x + ((toX - x) * i) / 10, y, { steps: 1 }); await page.waitForTimeout(20); }
  await page.mouse.up();
  await page.waitForTimeout(200);
}

const CASES = [
  { n: "typed max=40; press MIN half of the blob (centre-7px), drag to 50%", tMax: "40", off: -7, frac: 0.5 },
  { n: "typed max=40; press blob CENTRE, drag to 50%", tMax: "40", off: 0, frac: 0.5 },
  { n: "typed max=40; press MAX half of the blob (centre+7px), drag to 50%", tMax: "40", off: 7, frac: 0.5 },
  { n: "separated 20000/60000: drag MIN handle to 40%", tMin: "20000", tMax: "60000", grab: "handleMin", off: 0, frac: 0.4 },
  { n: "separated 20000/60000: drag MAX handle to 70%", tMin: "20000", tMax: "60000", grab: "handleMax", off: 0, frac: 0.7 },
  { n: "untouched server render: drag MAX handle (100%) to 30%", grab: "handleMax", off: 0, frac: 0.3 },
  { n: "untouched server render: drag MIN handle (0%) to 20%", grab: "handleMin", off: 0, frac: 0.2 },
];
const VPS = [{ l: "1280", w: 1280, h: 950 }, { l: "375", w: 375, h: 812 }];
const browser = await chromium.launch({ args: [`--host-resolver-rules=MAP ${HOST} 127.0.0.1`] });
const rows = [];
try {
  for (const vp of VPS) for (const c of CASES) {
    say(`\n=== ${c.n} @${vp.l} ===`);
    const ctx = await browser.newContext({ userAgent: UA, viewport: { width: vp.w, height: vp.h } });
    const page = await ctx.newPage();
    const auctions = [];
    page.on("request", (r) => { if (r.url().includes("/lg/auction")) { try { auctions.push(JSON.parse(r.postData() ?? "null")); } catch { auctions.push(r.postData()); } } });
    const errs = [];
    page.on("pageerror", (e) => errs.push(e.message));
    try {
      await driveToFromTo(page);
      if (c.tMin) await typeClean(page, MIN_SEL, c.tMin);
      if (c.tMax) await typeClean(page, MAX_SEL, c.tMax);
      const g = await readGeom(page);
      say(`GEOM: ${JSON.stringify(g)}`);
      say(`STATE BEFORE: ${JSON.stringify(await readState(page))}`);
      const h = g[c.grab ?? "handleMin"];
      const x = h.cx + c.off;
      const toX = g.track.x + g.track.w * c.frac;
      say(`DRAG: down x=${x} y=${h.cy} -> up x=${Math.round(toX)}`);
      await drag(page, x, h.cy, toX);
      const s = await readState(page);
      say(`STATE AFTER: ${JSON.stringify(s)}`);
      await page.evaluate(() => document.querySelector('[data-value="acme_insurance"]')?.click());
      await page.waitForTimeout(400);
      await pollFor(page, "auction", async () => { if (auctions.length) return true; await clickLastContinue(page); await page.waitForTimeout(1200); return auctions.length > 0; }, 8, 1500);
      const a = auctions.length && auctions[auctions.length - 1]?.answers ? auctions[auctions.length - 1].answers : null;
      const row = { case: c.n, vp: vp.l, postedMin: a ? a["p8n_fromto_band_min"]?.value ?? "(absent)" : "(none)", postedMax: a ? a["p8n_fromto_band_max"]?.value ?? "(absent)" : "(none)", ...s, clipMax: g.railClip[1], selOK: g.selectorIsMaxRail, errs: errs.slice(0, 2) };
      rows.push(row);
      say(`RESULT: ${JSON.stringify(row)}`);
    } catch (e) {
      say(`ERROR: ${e.message}`);
      rows.push({ case: c.n, vp: vp.l, error: e.message });
    } finally { await ctx.close(); }
  }
} finally { await browser.close(); }
say(`\n=== SUMMARY (${rows.length}) ===`);
for (const r of rows) say(JSON.stringify(r));
