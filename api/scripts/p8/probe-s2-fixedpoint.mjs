#!/usr/bin/env node
// P8-6 S2 MEASUREMENT-ONLY probe. Same host/slug/selectors/drive as
// scripts/p8/probe-q4-thumb-drag.mjs. The ONE difference that matters: the
// press point is ALWAYS the min handle's own centre (hMin.cx) -- never
// cx-7 -- and it is printed on every row so before/after are comparable.
// Usage: node probe-s2-fixedpoint.mjs <label> [viewportCsv] [caseCsv]
//
// FLAKINESS WARNING (T2): the synthetic drag below is 20 steps of
// `mouse.move` with a 50ms wait between each -- do not shorten this. An
// earlier 10-step/20ms version under-reported at 1280 only: case F2
// (separated 20000/60000, drag MIN LEFT to 5%) recorded postedMin unchanged
// at 20000 with the fast drag, but the browser's pointer capture legitimately
// DOES lower it to 5000 at 1280 once the drag is slow enough -- confirmed
// stable across 5 direct runs (F2 identical at both viewports every time,
// see styles.ts comment for the table). A too-fast drag is an INSTRUMENT
// bug, not a product bug.
//
// RESIDUAL, NOT FULLY ELIMINATED: even at 20 steps/50ms, 3 of those same 5
// runs each showed ONE OTHER separated-pair row (F1 or F3, never the same
// one twice, never F2) record NO movement at 1280 while 375 moved -- i.e.
// the drag was still occasionally swallowed at 1280, just far less often
// and no longer pinned to one case. Tried adding a 100ms settle right after
// mouse.down() before moving to fix this -- made it WORSE (regressed F2/H
// in the very next run) -- reverted, do not re-add it without re-measuring
// 5+ runs. If a future run shows ANY row disagreeing by viewport, re-run
// the probe 3-5x before concluding it's a product regression; suspect this
// timing first, not engine.ts.
import { chromium } from "playwright";
const HOST = "r2fix.e2e.test", PORT = "8901", SLUG = "r2fix";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const ZIP = '[data-lg-field="p8_addr_zip"] input';
const MINB = '[data-lg-field="p8n_fromto_band_min"] input.lg-input';
const MAXB = '[data-lg-field="p8n_fromto_band_max"] input.lg-input';
const RMIN = '[data-lg-field="p8n_fromto_band_min"] input.lg-range-input-dual';
const RMAX = '[data-lg-field="p8n_fromto_band_max"] input.lg-range-input-dual';
const say = (l) => console.log(l);
async function poll(p, d, f, n = 8, ms = 1200) { for (let i = 1; i <= n; i++) { const o = await f(); if (o) return true; await p.waitForTimeout(ms); } say(`  poll[${d}] EXHAUSTED`); return false; }
const cont = (p) => p.evaluate(() => { const b = [...document.querySelectorAll("button,[data-lg-continue],.lg-continue")].filter((x) => (x.offsetWidth || x.offsetHeight) && /continue|next|go|submit|see|get/i.test(x.textContent || "")); const t = b[b.length - 1]; if (!t) return false; t.click(); return true; });
async function type(p, s, v) { await p.click(s); await p.keyboard.press("End"); for (let i = 0; i < 12; i++) await p.keyboard.press("Backspace"); await p.keyboard.type(v, { delay: 20 }); await p.keyboard.press("Tab"); }
const geom = (p) => p.evaluate(() => { const w = document.querySelector(".lg-range-from-to"); const r = (s) => { const e = w.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { x: Math.round(b.x * 10) / 10, w: Math.round(b.width * 10) / 10, cx: Math.round((b.x + b.width / 2) * 10) / 10, cy: Math.round((b.y + b.height / 2) * 10) / 10 }; }; return { hMin: r(".lg-range-handle-min"), hMax: r(".lg-range-handle-max"), track: r(".lg-range-track"), clip: [...w.querySelectorAll("input.lg-range-input-dual")].map((x) => getComputedStyle(x).clipPath) }; });
const state = (p) => p.evaluate(({ a, b, c, d }) => ({ numMin: document.querySelector(a).value, numMax: document.querySelector(b).value, railMin: document.querySelector(c).value, railMax: document.querySelector(d).value }), { a: MINB, b: MAXB, c: RMIN, d: RMAX });

// name, typeMin, typeMax, grab ("min"|"max"|null), toFrac (null = no drag)
const CASES = [
  ["A coincident: typed max=40, press hMin.cx, drag RIGHT to 50%", null, "40", "min", 0.5],
  ["B coincident: typed max=40, press hMin.cx, drag LEFT to 0%", null, "40", "min", 0.0],
  ["C ordering conflict: min=20000 then typed max=100", "20000", "100", null, null],
  ["D declared max: typed max=100000", null, "100000", null, null],
  ["E above max: typed max=200000", null, "200000", null, null],
  ["F1 separated 20000/60000: drag MIN RIGHT to 40%", "20000", "60000", "min", 0.4],
  ["F2 separated 20000/60000: drag MIN LEFT to 5%", "20000", "60000", "min", 0.05],
  ["F3 separated 20000/60000: drag MAX RIGHT to 90%", "20000", "60000", "max", 0.9],
  ["F4 separated 20000/60000: drag MAX LEFT to 70%", "20000", "60000", "max", 0.7],
  ["G coincident-by-correction (20000/20000): press hMin.cx, drag RIGHT to 90%", "20000", "100", "min", 0.9],
  ["H coincident-by-correction (20000/20000): press hMin.cx, drag LEFT to 5%", "20000", "100", "min", 0.05],
];
const LABEL = process.argv[2] || "run";
const VPS = (process.argv[3] || "1280,375").split(",").map(Number);
const ONLY = process.argv[4] ? process.argv[4].split(",") : null;
const br = await chromium.launch({ args: [`--host-resolver-rules=MAP ${HOST} 127.0.0.1`] });
const rows = [];
try {
  for (const vw of VPS) {
    for (const [name, tMin, tMax, grab, frac] of CASES) {
      if (ONLY && !ONLY.includes(name[0] + (name[1] === " " ? "" : name[1]))) continue;
      const ctx = await br.newContext({ userAgent: UA, viewport: { width: vw, height: 950 } });
      const p = await ctx.newPage();
      const auctions = [];
      p.on("request", (r) => { if (r.url().includes("/lg/auction")) { try { auctions.push(JSON.parse(r.postData() ?? "null")); } catch { auctions.push(r.postData()); } } });
      try {
        let ready = false;
        for (let att = 1; att <= 3 && !ready; att++) {
          await p.goto(`http://${HOST}:${PORT}/lg/${SLUG}?_cb=${Date.now()}-${att}`, { waitUntil: "domcontentloaded" });
          ready = await poll(p, "ready", () => p.evaluate(() => document.getElementById("lg-funnel-root")?.getAttribute("data-lg-ready") === "1"), 6, 1200);
        }
        if (!ready) throw new Error("engine never ready");
        await cont(p); await p.waitForTimeout(600);
        await poll(p, "addr", () => p.evaluate((s) => !!document.querySelector(s), ZIP), 6, 1200);
        await p.fill(ZIP, "90210");
        for (let i = 0; i < 3; i++) { await cont(p); await p.waitForTimeout(600); }
        if (!await poll(p, "ft", () => p.evaluate((s) => { const e = document.querySelector(s); return !!e && (e.offsetWidth > 0 || e.offsetHeight > 0); }, MINB), 6, 1200)) throw new Error("from_to never visible");
        if (tMin) await type(p, MINB, tMin);
        if (tMax) await type(p, MAXB, tMax);
        const g = await geom(p);
        const st0 = await state(p);
        let press = null;
        if (grab) {
          const h = grab === "min" ? g.hMin : g.hMax;
          press = h.cx;
          const to = g.track.x + g.track.w * frac;
          await p.mouse.move(press, h.cy); await p.mouse.down();
          for (let i = 1; i <= 20; i++) { await p.mouse.move(press + (to - press) * i / 20, h.cy, { steps: 1 }); await p.waitForTimeout(50); }
          await p.mouse.up(); await p.waitForTimeout(250);
        }
        const st1 = await state(p);
        await p.evaluate(() => document.querySelector('[data-value="acme_insurance"]')?.click());
        await p.waitForTimeout(400);
        await poll(p, "auction", async () => { if (auctions.length) return true; await cont(p); await p.waitForTimeout(1100); return auctions.length > 0; }, 8, 1200);
        const a = auctions.length && auctions[auctions.length - 1]?.answers ? auctions[auctions.length - 1].answers : null;
        rows.push({
          vw, case: name, pressX: press, hMinCx: g.hMin.cx, hMaxCx: g.hMax.cx,
          clipMax: g.clip[1], beforeDrag: st0, afterDrag: st1,
          postedMin: a ? a["p8n_fromto_band_min"]?.value ?? "(absent)" : "(no auction)",
          postedMax: a ? a["p8n_fromto_band_max"]?.value ?? "(absent)" : "(no auction)",
        });
      } catch (e) { rows.push({ vw, case: name, error: e.message }); }
      finally { await ctx.close(); }
      say(`[${LABEL}] done ${vw} :: ${name}`);
    }
  }
} finally { await br.close(); }
say(`\n=== ${LABEL} SUMMARY (${rows.length} rows) ===`);
for (const r of rows) say(JSON.stringify(r));
