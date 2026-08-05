#!/usr/bin/env node
// P8-5 FIX-FIRST slice G1 — driven measurement probe for M-1 and M-5.
//
// MISSION EVIDENCE TOOLING ONLY: never wired into CI / package.json /
// verify:all (contract §1). Client of the already-running wrangler dev on
// 127.0.0.1:8901.
//
// M-1: the selection badges are enumerated STRUCTURALLY — every
//      [data-selection-chrome] the canvas srcdoc holds while a node is
//      selected, plus the .studio-container-chip — and each is intersected
//      with every visible .lg-label. The overlap rectangle is measured, not
//      inferred from a CSS string.
// M-5: fail-before is elementFromPoint(centre of #lg-section-save) !== the
//      save button at 375 AND 0 PATCH requests from a REAL mouse click
//      (page.mouse.click, not el.click()).
//
// Usage: node scripts/p8/probe-p85g1.mjs --section lgs_...

import { chromium } from "playwright";

const args = process.argv.slice(2);
const argOf = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const BASE = argOf("--base", "http://127.0.0.1:8901");
const SECTION = argOf("--section", "lgs_01KZ6PKV0EBF6E10DQ6GX23K0Y");
const LABEL = argOf("--label", "before");
const URL = `${BASE}/admin/leadgen/sections/${SECTION}/edit`;

const rectOf = (r) => ({ x: Math.round(r.x * 10) / 10, y: Math.round(r.y * 10) / 10, w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10 });

// Overlap of two DOMRect-likes, in px. 0×0 = no overlap.
function overlap(a, b) {
  const w = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const h = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return { w: Math.round(w * 10) / 10, h: Math.round(h * 10) / 10 };
}

const browser = await chromium.launch();

// ---------------------------------------------------------------- M-1 ------
async function measureBadges(page, vw) {
  await page.setViewportSize({ width: vw, height: 900 });
  await page.waitForTimeout(700);
  const frame = page.frames().find((f) => f.name() === "" && f !== page.mainFrame() && f.url().startsWith("about:"))
    ?? page.frames().find((f) => f !== page.mainFrame());
  if (!frame) return { error: "no canvas frame" };
  // select the first grid question by clicking its answer group
  await frame.evaluate(() => {
    const el = document.querySelector('[data-question-id="q_g1"]');
    if (el) el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await page.waitForTimeout(900);
  return await frame.evaluate(() => {
    const R = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x * 10) / 10, y: Math.round(r.y * 10) / 10, w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10 }; };
    const vis = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    // EVERY selection badge: chrome nodes that carry TEXT (an outline/handle
    // carries none), plus the container chip which is a plain class.
    const badges = [];
    document.querySelectorAll("[data-selection-chrome]").forEach((el) => {
      const t = (el.textContent || "").trim();
      if (t === "" || !vis(el)) return;
      badges.push({ kind: "data-selection-chrome", text: t.slice(0, 40), box: R(el) });
    });
    document.querySelectorAll(".studio-container-chip").forEach((el) => {
      if (!vis(el)) return;
      badges.push({ kind: "studio-container-chip", text: (el.textContent || "").trim().slice(0, 40), box: R(el) });
    });
    const labels = [];
    document.querySelectorAll(".lg-label").forEach((el) => {
      if (!vis(el)) return;
      labels.push({ text: (el.textContent || "").trim().slice(0, 40), box: R(el) });
    });
    return { badges, labels };
  });
}

// ---------------------------------------------------------------- M-5 ------
async function measureSave(page, vw) {
  await page.setViewportSize({ width: vw, height: 900 });
  await page.waitForTimeout(700);
  const geom = await page.evaluate(() => {
    const b = document.querySelector("#lg-section-save");
    const bar = document.querySelector("[data-studio-topbar]");
    const set = document.querySelector("[data-studio-settings]");
    const R = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
    const rb = b.getBoundingClientRect();
    const cx = rb.x + rb.width / 2, cy = rb.y + rb.height / 2;
    const hit = document.elementFromPoint(cx, cy);
    const cs = getComputedStyle(b);
    return {
      save: R(b), topbar: R(bar), settings: R(set),
      topbarCssHeight: getComputedStyle(bar).height,
      topbarScrollH: bar.scrollHeight,
      centre: { x: Math.round(cx), y: Math.round(cy) },
      hitTag: hit ? hit.tagName + "." + (hit.className || "").toString().split(" ")[0] : null,
      hitIsSave: hit === b || b.contains(hit),
      disabled: b.disabled, pointerEvents: cs.pointerEvents,
      docScrollW: document.documentElement.scrollWidth,
      innerW: window.innerWidth,
    };
  });
  // a REAL mouse click at the button's centre, counting PATCH/PUT/POST saves
  const saves = [];
  const onReq = (r) => { if (/\/api\/admin\/leadgen\/sections\//.test(r.url()) && r.method() !== "GET") saves.push(r.method() + " " + r.url().replace(BASE, "")); };
  page.on("request", onReq);
  await page.mouse.click(geom.centre.x, geom.centre.y);
  await page.waitForTimeout(1600);
  page.off("request", onReq);
  return { ...geom, realMouseClickSaveRequests: saves.length, saveRequests: saves };
}

const out = {};
for (const vw of [1280, 375]) {
  const page = await browser.newPage({ viewport: { width: vw, height: 900 } });
  const errs = [];
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  await page.goto(`${URL}?_cb=${Date.now()}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3200);
  out[`m1_${vw}`] = await measureBadges(page, vw);
  out[`m5_${vw}`] = await measureSave(page, vw);
  out[`errs_${vw}`] = errs.slice(0, 5);
  await page.screenshot({ path: `../docs/leadgen/r2/evidence/p8/p85-g1/${LABEL}-studio-${vw}.png` });
  await page.close();
}

console.log(`\n=== P8-5 G1 PROBE (${LABEL}) section=${SECTION} ===`);
for (const vw of [1280, 375]) {
  const m1 = out[`m1_${vw}`];
  console.log(`\n--- M-1 selection badges vs labels @${vw} ---`);
  if (m1.error) { console.log("  " + m1.error); }
  else {
    console.log(`  badges: ${m1.badges.length}   visible labels: ${m1.labels.length}`);
    for (const b of m1.badges) {
      const hits = m1.labels
        .map((l) => ({ l, o: overlap(b.box, l.box) }))
        .filter((z) => z.o.w > 0 && z.o.h > 0);
      console.log(`   badge [${b.kind}] "${b.text}" box ${JSON.stringify(b.box)}`);
      if (hits.length === 0) console.log(`      overlap: NONE`);
      for (const h of hits) console.log(`      OVERLAPS label "${h.l.text}" box ${JSON.stringify(h.l.box)} by ${h.o.w}px x ${h.o.h}px`);
    }
  }
  const m5 = out[`m5_${vw}`];
  console.log(`--- M-5 save reachability @${vw} ---`);
  console.log(`  #lg-section-save box ${JSON.stringify(m5.save)} disabled=${m5.disabled} pointer-events=${m5.pointerEvents}`);
  console.log(`  topbar box ${JSON.stringify(m5.topbar)} computed height=${m5.topbarCssHeight} scrollHeight=${m5.topbarScrollH}`);
  console.log(`  settings box ${JSON.stringify(m5.settings)}`);
  console.log(`  elementFromPoint(${m5.centre.x},${m5.centre.y}) = ${m5.hitTag}   isSaveButton=${m5.hitIsSave}`);
  console.log(`  REAL mouse click -> section write requests: ${m5.realMouseClickSaveRequests} ${JSON.stringify(m5.saveRequests)}`);
  console.log(`  document.scrollWidth=${m5.docScrollW} innerWidth=${m5.innerW} horizontalOverflow=${m5.docScrollW > m5.innerW}`);
  if (out[`errs_${vw}`].length) console.log(`  page errors: ${JSON.stringify(out[`errs_${vw}`])}`);
}
await browser.close();
