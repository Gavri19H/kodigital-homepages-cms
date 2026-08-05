#!/usr/bin/env node
// P8-6 SLICE C DRIVE — N8 "Create A/B test gives the operator nothing".
//
// MISSION EVIDENCE TOOLING ONLY: never wired into CI/package.json/verify:all.
// Client of the already-running wrangler dev on 127.0.0.1:8901.
//
// WHY a drive and not a unit test: the whole defect lives ACROSS a page
// reload. A unit test can assert that a handler called showMsg; it cannot show
// that the operator never sees the result, because the discarding is done by
// the navigation itself. So:
//   FAIL-BEFORE  the naive idiom (paint the alert, then reload) executed on
//                the real page: visible before, gone after.
//   PASS-AFTER   the real button, and what the operator reads once the page
//                has settled.
//   FAILURE PATH the create route forced to a non-2xx by route interception
//                (the server is never broken): what is said, and whether the
//                button can be clicked again.
//
// Everything it creates (two throwaway quotes) is deleted in the finally.

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = "http://127.0.0.1:8901";
const API = `${BASE}/api/admin/leadgen`;
const SHOT = "../docs/leadgen/r2/evidence/p8/n8";
mkdirSync(SHOT, { recursive: true });

const made = [];

async function newQuote(name) {
  const res = await fetch(`${API}/quotes`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ quote_name: name, activity: "quote_funnel", verticals: ["life"] }),
  });
  if (res.status !== 201) throw new Error(`create quote ${res.status}: ${await res.text()}`);
  const q = await res.json();
  made.push(q.public_id);
  console.log(`[setup] quote ${q.public_id} created (${name})`);
  return q.public_id;
}

// Short LOGGED polling steps, never one long silent wait.
async function poll(label, page, fn, attempts = 12, everyMs = 2000) {
  for (let i = 1; i <= attempts; i++) {
    let got = null;
    try {
      got = await page.evaluate(fn);
    } catch (e) {
      // a reload can destroy the execution context mid-poll: that is the very
      // navigation we are waiting out, so log it as an attempt and keep going.
      got = { done: false, note: "context busy: " + String(e.message).slice(0, 60) };
    }
    console.log(`  [poll ${label}] attempt ${i}/${attempts}: ${JSON.stringify(got)}`);
    if (got && got.done) return got;
    await page.waitForTimeout(everyMs);
  }
  return null;
}

// the page (not Playwright) triggers the navigation, exactly as the handler does
async function pageReload(page) {
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded" }).catch(() => {}),
    page.evaluate(() => { setTimeout(function () { window.location.reload(); }, 0); }),
  ]);
}

// what the OPERATOR can read in the two alert slots, right now
const readAlerts = () => {
  const one = (id) => {
    const el = document.getElementById(id);
    if (!el) return { present: false };
    return { present: true, hidden: el.hidden, text: el.textContent };
  };
  const btn = document.getElementById("lg-create-experiment");
  return {
    done: true,
    ok: one("lg-quote-ok"),
    err: one("lg-quote-error"),
    createBtn: btn ? { present: true, disabled: btn.disabled } : { present: false },
    status: (document.querySelector("[data-ab-status]") || {}).textContent || null,
    activeTab: (document.querySelector(".lg-qtab.active") || {}).textContent || null,
    stamp: window.__n8stamp === undefined ? null : window.__n8stamp,
  };
};

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const errs = [];
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errs.push("console: " + m.text()); });

  // ======================================================================
  // 1. FAIL-BEFORE — the naive "showMsg then reload" idiom, on the real page
  // ======================================================================
  const qA = await newQuote("P8-6 N8 drive A");
  await page.goto(`${BASE}/admin/leadgen/quotes/${qA}/edit?_cb=${Date.now()}#tab=ab`, { waitUntil: "domcontentloaded" });
  await poll("boot-A", page, readAlerts, 6);

  const painted = await page.evaluate(() => {
    // literally showMsg's body (funnel.ts): textContent + hidden = false
    const el = document.getElementById("lg-quote-ok");
    el.textContent = "NAIVE PRE-RELOAD MESSAGE: A/B test created.";
    el.hidden = false;
    return { text: el.textContent, hidden: el.hidden, visible: el.offsetHeight > 0 };
  });
  console.log("[fail-before] painted BEFORE reload:", JSON.stringify(painted));
  await page.screenshot({ path: `${SHOT}/n8-failbefore-1-painted.png` });

  await pageReload(page);
  const after = await poll("fail-before-after-reload", page, readAlerts, 6);
  console.log("[fail-before] AFTER reload the operator reads:", JSON.stringify(after && after.ok));
  await page.screenshot({ path: `${SHOT}/n8-failbefore-2-after-reload.png` });

  // ======================================================================
  // 2. PASS-AFTER — the real button, success path
  // ======================================================================
  await page.evaluate(() => { window.__n8stamp = "pre-click"; });
  console.log("[success] clicking #lg-create-experiment ...");
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded" }).catch(() => {}),
    page.click("#lg-create-experiment"),
  ]);
  const okState = await poll("success-after-settle", page, readAlerts, 12);
  console.log("[success] AFTER the page settled:", JSON.stringify(okState));
  await page.screenshot({ path: `${SHOT}/n8-success-after-reload.png` });
  const okBox = await page.locator("#lg-quote-ok").boundingBox();
  console.log("[success] #lg-quote-ok bounding box:", JSON.stringify(okBox));
  // and it is ONE-SHOT: a plain refresh must not re-announce it
  await page.reload({ waitUntil: "domcontentloaded" });
  const second = await poll("success-second-load", page, readAlerts, 4);
  console.log("[success] after a PLAIN refresh (one-shot check):", JSON.stringify(second && second.ok));

  // ======================================================================
  // 3. FAILURE PATH — forced non-2xx from the create route (server untouched)
  // ======================================================================
  const qB = await newQuote("P8-6 N8 drive B");
  await page.route("**/api/admin/leadgen/quotes/*/experiments", (route) =>
    route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({ error: "another experiment already exists on this funnel" }),
    }),
  );
  await page.goto(`${BASE}/admin/leadgen/quotes/${qB}/edit?_cb=${Date.now()}#tab=ab`, { waitUntil: "domcontentloaded" });
  await poll("boot-B", page, readAlerts, 6);
  await page.evaluate(() => { window.__n8stamp = "no-reload-marker"; });
  console.log("[failure] clicking #lg-create-experiment with the route forced to 409 ...");
  await page.click("#lg-create-experiment");
  const failState = await poll(
    "failure-after-click",
    page,
    () => {
      const el = document.getElementById("lg-quote-error");
      const btn = document.getElementById("lg-create-experiment");
      const shown = !!el && el.hidden === false && (el.textContent || "") !== "";
      return {
        done: shown,
        err: el ? { hidden: el.hidden, text: el.textContent } : null,
        createBtn: btn ? { present: true, disabled: btn.disabled } : { present: false },
        stamp: window.__n8stamp === undefined ? null : window.__n8stamp,
      };
    },
    8,
  );
  console.log("[failure] operator reads:", JSON.stringify(failState));
  await page.screenshot({ path: `${SHOT}/n8-failure-409.png` });

  // the button must be usable again: click it once more and watch the request
  await page.unroute("**/api/admin/leadgen/quotes/*/experiments");
  let retried = false;
  page.on("request", (r) => { if (r.url().includes("/experiments") && r.method() === "POST") retried = true; });
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded" }).catch(() => {}),
    page.click("#lg-create-experiment"),
  ]);
  const retryState = await poll("failure-retry", page, readAlerts, 10);
  console.log("[failure] retry fired a POST?", retried, "| after settle:", JSON.stringify(retryState && retryState.ok));
  await page.screenshot({ path: `${SHOT}/n8-failure-retry-succeeds.png` });

  // ======================================================================
  // 4. CLASS SWEEP — the two siblings that reloaded the same silent way
  //    (quote B now carries the draft test the retry created)
  // ======================================================================
  console.log("[sweep] clicking Start A/B test ...");
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded" }).catch(() => {}),
    page.click("[data-start-experiment]"),
  ]);
  const started = await poll("sweep-start", page, readAlerts, 10);
  console.log("[sweep] after Start settled:", JSON.stringify(started && { ok: started.ok, status: started.status }));
  await page.screenshot({ path: `${SHOT}/n8-sweep-start.png` });

  console.log("[sweep] clicking Stop A/B test ...");
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded" }).catch(() => {}),
    page.click("[data-stop-experiment]"),
  ]);
  const stopped = await poll("sweep-stop", page, readAlerts, 10);
  console.log("[sweep] after Stop settled:", JSON.stringify(stopped && { ok: stopped.ok, status: stopped.status }));
  await page.screenshot({ path: `${SHOT}/n8-sweep-stop.png` });

  console.log("[console] page errors:", errs.length === 0 ? "none" : JSON.stringify(errs));
} finally {
  for (const id of made) {
    const res = await fetch(`${API}/quotes/${id}`, { method: "DELETE" });
    console.log(`[cleanup] DELETE quote ${id} -> ${res.status}`);
  }
  await browser.close();
}
