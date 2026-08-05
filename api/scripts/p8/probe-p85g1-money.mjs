#!/usr/bin/env node
// P8-5 FIX-FIRST slice G1 — the B-1 MONEY PATH probe (contract R6-2 / M4).
//
// MISSION EVIDENCE TOOLING ONLY: never wired into CI / package.json /
// verify:all (contract §1). Client of the already-running wrangler dev.
//
// The blocker was defined on the REAL `POST /lg/auction` answers object, so it
// is closed on that same surface. This walks the REAL visitor funnel on the
// real worker: it types a distinct string into EVERY visible [data-lg-input]
// (so which key each typed value lands under is unambiguous), advances, and
// captures the auction request body the engine actually posts.
//
// Usage: node scripts/p8/probe-p85g1-money.mjs [--slug r2fix] [--label before]

import { chromium } from "playwright";

const args = process.argv.slice(2);
const argOf = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const SLUG = argOf("--slug", "r2fix");
const HOST = argOf("--host", "r2fix.e2e.test");
const PORT = argOf("--port", "8901");
const LABEL = argOf("--label", "before");

const browser = await chromium.launch({ args: [`--host-resolver-rules=MAP ${HOST} 127.0.0.1`] });
const page = await browser.newPage({ viewport: { width: 1280, height: 950 } });
const auctions = [];
page.on("request", (r) => {
  if (r.url().includes("/lg/auction")) {
    let body = null;
    try { body = JSON.parse(r.postData() ?? "null"); } catch { body = r.postData(); }
    auctions.push(body);
  }
});
const errs = [];
page.on("pageerror", (e) => errs.push("pageerror: " + e.message));

await page.goto(`http://${HOST}:${PORT}/lg/${SLUG}?_cb=${Date.now()}`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2200);

// Walk forward, typing a DISTINCT marker into every visible input on each step,
// until the funnel stops advancing or the auction fires.
const typed = [];
for (let hop = 0; hop < 14 && auctions.length === 0; hop++) {
  const filled = await page.evaluate((h) => {
    const out = [];
    document.querySelectorAll("[data-lg-input]").forEach((el, i) => {
      if (!(el.offsetWidth || el.offsetHeight)) return;
      const holder = el.closest("[data-lg-field]");
      const key = holder ? holder.getAttribute("data-lg-field") : null;
      const label = (holder?.closest("[data-lg-question],.lg-field-boxed,.lg-qgrid-q")?.querySelector(".lg-label")?.textContent || "").trim();
      // Values that SATISFY the other slices' authored validation (zip5,
      // phone mask, email) so the walk can actually reach the final section —
      // still distinct per input, so which key a value lands under is
      // unambiguous.
      const t = (el.getAttribute("type") || "").toLowerCase();
      const k = (key || "") + " " + (el.getAttribute("inputmode") || "") + " " + (el.getAttribute("placeholder") || "");
      let value = `G1 ${h}-${i} typed`;
      if (/zip|postal/i.test(k)) value = "9021" + (i % 10);
      else if (t === "tel" || /phone/i.test(k)) value = "415555123" + (i % 10);
      else if (t === "email" || /email/i.test(k)) value = `g1-${h}-${i}@example.com`;
      else if (t === "number" || /age|year|amount|income/i.test(k)) value = String(30 + i);
      else if (/state/i.test(k)) value = "CA";
      el.value = value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      out.push({ key, label, value, inputId: el.id || null });
    });
    return out;
  }, hop);
  typed.push({ hop, filled });
  // All sections of this funnel live on ONE page, so only the page's LAST
  // section shows its Continue (engine applyContinueVisibility / isLastInPage)
  // — click the LAST visible one, which is the page-level advance/submit.
  // Answer any choice-based question on this step too (a required
  // ButtonAnswerGroup/Yes-No blocks Continue just as a required input does).
  await page.evaluate(() => {
    document.querySelectorAll("[data-lg-question]").forEach((q) => {
      if (!(q.offsetWidth || q.offsetHeight)) return;
      if (q.querySelector('[aria-checked="true"],[data-lg-choice][aria-pressed="true"]')) return;
      const c = [...q.querySelectorAll("[data-lg-choice]")].find((e) => e.offsetWidth || e.offsetHeight);
      if (c) c.click();
    });
  });
  await page.waitForTimeout(900);
  const advanced = await page.evaluate(() => {
    const btns = [...document.querySelectorAll("button,[data-lg-continue],.lg-continue")].filter(
      (b) => (b.offsetWidth || b.offsetHeight) && /continue|next|go|submit|see|get/i.test(b.textContent || ""),
    );
    const btn = btns[btns.length - 1];
    if (!btn) return false;
    btn.click();
    return true;
  });
  await page.waitForTimeout(2000);
  if (!advanced) break;
}
await page.waitForTimeout(1500);
await page.screenshot({ path: `../docs/leadgen/r2/evidence/p8/p85-g1/${LABEL}-money-1280.png` });
await browser.close();

console.log(`\n=== P8-5 G1 MONEY-PATH PROBE (${LABEL}) /lg/${SLUG} ===`);
for (const step of typed) {
  console.log(`step ${step.hop}: ${step.filled.length} visible input(s)`);
  for (const f of step.filled) console.log(`   label=${JSON.stringify(f.label)} data-lg-field=${JSON.stringify(f.key)} typed=${JSON.stringify(f.value)}`);
}
console.log(`POST /lg/auction requests: ${auctions.length}`);
for (const a of auctions) {
  const ans = a && a.answers ? a.answers : null;
  console.log(`  answers object: ${JSON.stringify(ans)}`);
}
if (errs.length) console.log(`page errors: ${JSON.stringify(errs.slice(0, 4))}`);
