#!/usr/bin/env node
// P8-5 FIX-FIRST slice G1 — driven B-1 probe (contract R6-2 / M4:
// "`fills` collides keys"; R6-2 verbatim: "The picker deliberately offers
// exactly the siblings that collide.").
//
// MISSION EVIDENCE TOOLING ONLY: never wired into CI / package.json /
// verify:all (contract §1). Client of the already-running wrangler dev.
//
// Drives the REAL Section Studio at 1280: select the Address → Maps tab →
// enable Maps → tick the autocomplete job → read the City slot's REAL option
// list → try to pick the sibling FreeTextQuestion's key → Save → read the
// STORED row back from the API and count how many VISIBLE inputs the rendered
// content_html gives that one answer key.
//
// Usage: node scripts/p8/probe-p85g1-b1.mjs --section lgs_... [--label before]

import { chromium } from "playwright";

const args = process.argv.slice(2);
const argOf = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const BASE = argOf("--base", "http://127.0.0.1:8901");
const SECTION = argOf("--section", "");
const TARGET = argOf("--target", "town_field");
const LABEL = argOf("--label", "before");
const HDRS = { "cf-access-authenticated-user-email": "guy@kodigital.io" };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 950 } });
const errs = [];
page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error") errs.push("console: " + m.text().slice(0, 160)); });
const writes = [];
page.on("response", async (r) => {
  if (/\/api\/admin\/leadgen\/sections\//.test(r.url()) && r.request().method() !== "GET") {
    writes.push({ m: r.request().method(), status: r.status() });
  }
});

await page.goto(`${BASE}/admin/leadgen/sections/${SECTION}/edit?_cb=${Date.now()}`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3200);

// --- select the Address node on the REAL canvas (srcdoc iframe) ------------
const frame = page.frames().find((f) => f !== page.mainFrame());
await frame.evaluate(() => {
  const el = document.querySelector('[data-question-id="q_addr"]');
  if (el) el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
});
await page.waitForTimeout(900);

// --- Maps tab -------------------------------------------------------------
await page.evaluate(() => {
  const t = [...document.querySelectorAll("[data-studio-inspector-tab]")].find((b) => b.getAttribute("data-studio-inspector-tab") === "maps");
  if (t) t.click();
});
await page.waitForTimeout(500);
// enable Maps + tick the autocomplete job through REAL clicks (locator.click
// scrolls the control into view first and then issues a real mouse press —
// the inspector rail is scrollable, so a raw page.mouse.click at the
// unscrolled coordinate lands nowhere).
await page.locator("[data-maps-enabled-toggle]").click();
await page.waitForTimeout(400);
await page.locator('[data-maps-job="autocomplete"]').click();
await page.waitForTimeout(600);

// --- what does the City slot REALLY offer? --------------------------------
const cityOptions = await page.evaluate(() => {
  const sel = document.querySelector('[data-maps-fill-slot="city"]');
  if (!sel) return { missing: true, options: [] };
  return {
    hidden: !!(document.querySelector("[data-maps-fills-block]") || {}).hidden,
    options: [...sel.options].map((o) => ({ value: o.value, text: o.textContent, disabled: o.disabled, selected: o.selected })),
  };
});

// --- try to claim the sibling's key, exactly as an operator would ---------
const picked = await page.evaluate((t) => {
  const sel = document.querySelector('[data-maps-fill-slot="city"]');
  const opt = [...sel.options].find((o) => o.value === t);
  if (!opt) return { found: false };
  if (opt.disabled) return { found: true, disabled: true, applied: false, selValue: sel.value };
  sel.value = t;
  sel.dispatchEvent(new Event("change", { bubbles: true }));
  return { found: true, disabled: false, applied: true, selValue: sel.value };
}, TARGET);
await page.waitForTimeout(500);

const modelFills = await page.evaluate(() => {
  const s = window.__lgStudioState;
  return s ? JSON.stringify((s.content.components.find((c) => c.question_id === "q_addr") || {}).props) : "(no state handle)";
});

// --- Save through the REAL button -----------------------------------------
await page.locator("#lg-section-save").click();
await page.waitForTimeout(2000);

const banner = await page.evaluate(() => {
  const b = document.querySelector("[data-studio-save-banner],[data-save-banner],.studio-save-banner");
  const chip = document.querySelector("[data-studio-issue-chip],.studio-chip-issues");
  return { bannerHidden: b ? b.hidden : "(no banner el)", bannerText: b ? (b.textContent || "").trim().slice(0, 160) : "", issueChip: chip ? (chip.textContent || "").trim().slice(0, 60) : "" };
});
await page.screenshot({ path: `../docs/leadgen/r2/evidence/p8/p85-g1/${LABEL}-b1-after-save-1280.png` });
await browser.close();

// --- what is actually STORED, and what does it render? --------------------
const row = await (await fetch(`${BASE}/api/admin/leadgen/sections/${SECTION}?_cb=${Date.now()}`, { headers: HDRS })).json();
const addr = (row.content_json?.components || []).find((c) => c.question_id === "q_addr");
const html = row.content_html || "";
const fieldCounts = {};
for (const m of html.matchAll(/data-lg-field="([^"]+)"/g)) fieldCounts[m[1]] = (fieldCounts[m[1]] || 0) + 1;

console.log(`\n=== P8-5 G1 B-1 PROBE (${LABEL}) section=${SECTION} target=${TARGET} ===`);
console.log(`City slot options (REAL, from the served island):`);
for (const o of cityOptions.options || []) console.log(`   value=${JSON.stringify(o.value)} disabled=${o.disabled} selected=${o.selected} text=${JSON.stringify(o.text)}`);
console.log(`pick attempt:            ${JSON.stringify(picked)}`);
console.log(`in-memory props (addr):  ${modelFills}`);
console.log(`save writes:             ${JSON.stringify(writes)}`);
console.log(`save banner:             ${JSON.stringify(banner)}`);
console.log(`STORED props.maps.fills: ${JSON.stringify(addr?.props?.maps?.fills ?? null)}`);
console.log(`STORED props.fields:     ${JSON.stringify(addr?.props?.fields ?? null)}`);
console.log(`content_html data-lg-field counts: ${JSON.stringify(fieldCounts)}`);
const dupes = Object.entries(fieldCounts).filter(([, n]) => n > 1);
console.log(`DUPLICATE answer keys in the rendered HTML: ${dupes.length ? JSON.stringify(dupes) : "none"}`);
if (errs.length) console.log(`page errors: ${JSON.stringify(errs.slice(0, 5))}`);
