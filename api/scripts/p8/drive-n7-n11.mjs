#!/usr/bin/env node
// P8-3 CONDUCTOR DRIVE — N7 (select truncation) and N11 (preset actions).
//
// MISSION EVIDENCE TOOLING ONLY: never wired into CI/package.json/verify:all
// (contract §1). Client of the conductor's already-running wrangler dev.
//
// WHY: both fixes are of a kind no unit lane can settle.
//  · N7 was fixed by SHORTENING the option string, not by changing the width
//    that truncates it — the cause lives in files the slice did not own. So
//    "is it still truncated" is an empirical question about rendered pixels.
//  · N11 ships both buttons `disabled` from SSR and lets the island enable
//    them once it has CONFIRMED presets exist. That is honest only if the
//    enable actually happens when presets DO exist.
//
// Method: real Chromium at 1280, the real admin editor, computed styles and
// measured text widths — never a string comparison standing in for a pixel.

import { chromium } from "playwright";

const ADMIN = "http://127.0.0.1:8901/admin/leadgen/quotes/lgq_01KZ271383Y0MPV4BM2WKKCC4W/edit";
const SHOT = "../docs/leadgen/r2/evidence/p8/m2";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
const errs = [];
page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error") errs.push("console: " + m.text()); });

await page.goto(`${ADMIN}?_cb=${Date.now()}#tab=themes`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3500); // island boot + the preset-availability fetch

// ---------------------------------------------------------------------------
// N7 — does any select still display a truncated version of its own value?
// A <select> clips its own text; scrollWidth is not meaningful on it. So the
// selected option's label is measured in a canvas with the select's OWN
// computed font and compared with the control's real CONTENT BOX
// (clientWidth minus horizontal padding).
//
// CONDUCTOR ERROR, CORRECTED IN PLACE: a first version of this script also
// subtracted an ASSUMED 20px dropdown arrow, and stacked Math.ceil(text)
// against Math.floor(avail). That manufactured a 1px shortfall and reported
// all 16 selects truncated when NONE is — a false defect produced by my own
// arithmetic. The native arrow does sit inside the content box, so a label
// within ~20px of contentBox is "tight"; those are settled by the 3x element
// screenshot (n7-select-zoom-3x.png), never by arithmetic alone.
// ---------------------------------------------------------------------------
const n7 = await page.evaluate(() => {
  const TIGHT_PX = 20; // the native arrow renders inside the content box
  const out = [];
  document.querySelectorAll("select[data-theme-key]").forEach((sel) => {
    if (!(sel.offsetWidth > 0 && sel.offsetHeight > 0)) return;
    const cs = getComputedStyle(sel);
    const ctx = document.createElement("canvas").getContext("2d");
    ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const label = sel.options[sel.selectedIndex]?.text ?? "";
    const textPx = ctx.measureText(label).width;
    const contentPx =
      sel.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    out.push({
      key: sel.getAttribute("data-theme-key"),
      label,
      textPx: Math.round(textPx * 100) / 100,
      contentPx,
      truncated: textPx > contentPx,
      tight: textPx <= contentPx && textPx > contentPx - TIGHT_PX,
      boxW: Math.round(sel.getBoundingClientRect().width),
    });
  });
  return out;
});

// ---------------------------------------------------------------------------
// N11 — with presets present, are the actions actually usable, and does the
// help text agree with the button state?
// ---------------------------------------------------------------------------
const presets = await (await fetch("http://127.0.0.1:8901/api/admin/leadgen/themes")).json();
const n11 = await page.evaluate(() => {
  const g = (id) => document.getElementById(id);
  const b = (el) => (el ? { present: true, disabled: el.disabled, title: el.title, text: el.textContent.trim() } : { present: false });
  const help = g("lg-theme-preset-help");
  return {
    apply: b(g("lg-theme-preset-apply")),
    ab: b(g("lg-theme-ab-this")),
    help: help ? help.textContent.trim() : null,
  };
});

await page.screenshot({ path: `${SHOT}/n7-n11-themes-rail-1280.png`, fullPage: false });

console.log("# P8-3 N7 / N11 conductor drive — 1280, real admin editor");
console.log(`presets present: ${(presets.items || []).length}`);
console.log(`page errors: ${errs.length ? JSON.stringify(errs.slice(0, 4)) : "none"}`);
console.log("");
console.log("## N7 — truncation of each visible theme select's OWN displayed value");
console.log("key                              label                              text  content box   verdict");
for (const r of n7) {
  console.log(
    `${r.key.padEnd(32)} ${r.label.slice(0, 33).padEnd(34)} ${String(r.textPx).padStart(6)} ${String(r.contentPx).padStart(7)} ${String(r.boxW).padStart(5)}   ${r.truncated ? "TRUNCATED <<<<" : r.tight ? "fits (tight — see 3x shot)" : "fits"}`,
  );
}
console.log(`\ntruncated selects: ${n7.filter((r) => r.truncated).length} of ${n7.length}`);
console.log("");
console.log("## N11 — preset actions with presets PRESENT");
console.log(JSON.stringify(n11, null, 2));

await browser.close();
