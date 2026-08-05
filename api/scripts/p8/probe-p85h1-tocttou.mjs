#!/usr/bin/env node
// P8-5 FIX-FIRST round 2, slice H1 — the TIME-OF-CHECK / TIME-OF-USE probe.
//
// MISSION EVIDENCE TOOLING ONLY: never wired into CI / package.json /
// verify:all (contract §1). Client of the already-running wrangler dev on
// :8901 — starts/stops nothing.
//
// The finding: the fills picker's sibling rule (ui-section-studio.ts, gate
// `rendersSlot[slot] === true`) is evaluated at PICK time, and the rendered-
// slot set is operator-editable AFTERWARDS. Nothing re-validates a stored
// fill. So:
//   stage A  Address renders street+city; fills.state -> a SIBLING's key
//            (offered ENABLED — correct under the pick-time rule), saved 200.
//   stage B  "+ Add field -> State" makes the state slot rendered; the stored
//            fill now RENAMES that visible box to the sibling's key. Two
//            visible inputs on one answer key; the real POST /lg/auction body
//            carries one of them and the other's answer is gone.
//
// Closed on the MONEY PATH (POST /lg/auction), not on DOM counts alone.
//
// Usage:
//   node scripts/p8/probe-p85h1-tocttou.mjs --label before
//   node scripts/p8/probe-p85h1-tocttou.mjs --label after
//   node scripts/p8/probe-p85h1-tocttou.mjs --restore

import { chromium } from "playwright";
import http from "node:http";

// The worker routes by Host; `Host` is a forbidden header for fetch(), so the
// served-page polls go through node:http where it can be set.
const getServed = (path, hostHeader) =>
  new Promise((resolve) => {
    const req = http.request(
      { host: "127.0.0.1", port: Number(PORT), path, method: "GET", headers: { Host: hostHeader } },
      (res) => {
        let d = "";
        res.on("data", (c) => (d += c));
        res.on("end", () => resolve({ status: res.statusCode, html: d }));
      },
    );
    req.on("error", (e) => resolve({ status: 0, html: "ERR " + e.message }));
    req.end();
  });

const args = process.argv.slice(2);
const argOf = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const has = (n) => args.indexOf(n) >= 0;
const BASE = argOf("--base", "http://127.0.0.1:8901");
const HOST = argOf("--host", "r2fix.e2e.test");
const PORT = argOf("--port", "8901");
const SLUG = argOf("--slug", "r2fix");
const SECTION = argOf("--section", "lgs_01KZ27DTF599M85YHNEDHS6WA0");
const LABEL = argOf("--label", "before");
const HDRS = { "cf-access-authenticated-user-email": "guy@kodigital.io", "content-type": "application/json" };

const SIB = "p8n_h1_town";      // the sibling FreeTextQuestion's own answer key
const ADDR = "p8_addr";         // the Address node's internal_field (base)
const CREATE_SIB = "p8_addr_zip"; // a sibling deliberately named {base}_{slot}

const say = (...a) => console.log(...a);

// ---------------------------------------------------------------------------
// content states
// ---------------------------------------------------------------------------
const addrNode = (fields, fills) => ({
  type: "AddressAutocompleteQuestion",
  question_id: "p8_addr",
  internal_field: ADDR,
  props: {
    fields: fields.map((f) => ({ field: f, mode: "autofill" })),
    maps: { enabled: true, jobs: { validate: false, auction: false, autocomplete: true }, ...(fills ? { fills } : {}) },
  },
});
const sibNode = (key, label) => ({
  type: "FreeTextQuestion",
  question_id: "q_" + key,
  internal_field: key,
  answer_type: "string",
  props: { label },
});
const contNode = { type: "ContinueButton", question_id: "p8_addr_cont", props: { label: "Continue" } };

// stage A — state slot NOT rendered, so the picker legitimately offers the
// sibling (external-fill feature) and the fill is stored.
const STAGE_A = { components: [addrNode(["street", "city"], { state: SIB }), sibNode(SIB, "RR Town 2"), contNode] };
// stage B — "+ Add field -> State". Nothing re-validated the stored fill.
const STAGE_B = { components: [addrNode(["street", "city", "state"], { state: SIB }), sibNode(SIB, "RR Town 2"), contNode] };
// stage C — the `Create "<base>_<slot>"` re-check under the same lens: the
// picker offers `p8_addr_zip` for the (unrendered) zip slot because
// ownRoleNames excludes it from `others`; a sibling question is ALSO named
// p8_addr_zip. Then the operator adds the zip row.
const STAGE_C = {
  components: [
    addrNode(["street", "city", "zip"], { zip: CREATE_SIB }),
    sibNode(CREATE_SIB, "Legacy ZIP"),
    contNode,
  ],
};
// stage D — the same shape with NO fill at all: the Address's own default
// {base}_{slot} key vs a sibling question that carries that literal key.
const STAGE_D = {
  components: [addrNode(["street", "city", "zip"], null), sibNode(CREATE_SIB, "Legacy ZIP"), contNode],
};

const RESTORE = {
  components: [
    {
      type: "AddressAutocompleteQuestion",
      question_id: "p8_addr",
      internal_field: "p8_addr",
      props: {
        fields: [
          { field: "street", mode: "autofill" },
          { field: "city", mode: "autofill" },
          { field: "state", mode: "autofill" },
          { field: "zip", mode: "manual", required: true, validation: { regex: "^[0-9]{5}(-[0-9]{4})?$", message: "Enter a ZIP like 90210 or 90210-1234." } },
        ],
      },
    },
    contNode,
  ],
};

// ---------------------------------------------------------------------------
async function patch(content, name) {
  const r = await fetch(`${BASE}/api/admin/leadgen/sections/${SECTION}`, {
    method: "PATCH", headers: HDRS, body: JSON.stringify({ content: content }),
  });
  const t = await r.text();
  let v = null;
  try { v = JSON.parse(t).content_version ?? JSON.parse(t).item?.content_version ?? null; } catch { /* raw */ }
  say(`PATCH ${name}: HTTP ${r.status}${v !== null ? ` content_version=${v}` : ""}${r.status >= 400 ? " body=" + t.slice(0, 300) : ""}`);
  return r.status;
}

// Short LOGGED polling steps — never one long silent wait. A freshly PATCHed
// section can take >20s to reach the served shell.
async function pollServed(needle, absent, tries = 24) {
  for (let i = 1; i <= tries; i++) {
    const r = await getServed(`/lg/${SLUG}?_cb=${Date.now()}-${i}`, HOST);
    const html = r.html;
    const okIn = needle === null || html.includes(needle);
    const okOut = absent === null || absent === undefined || !html.includes(absent);
    say(`   poll ${i}/${tries}: HTTP ${r.status} len=${html.length} has(${JSON.stringify(needle)})=${okIn} lacks(${JSON.stringify(absent ?? null)})=${okOut}`);
    if (r.status === 200 && okIn && okOut) return html;
    await new Promise((res) => setTimeout(res, 2000));
  }
  say("   poll: never converged");
  return null;
}

// ---------------------------------------------------------------------------
async function censusAndMoney(tag) {
  const browser = await chromium.launch({ args: [`--host-resolver-rules=MAP ${HOST} 127.0.0.1`] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 950 } });
  const auctions = [];
  page.on("request", (r) => {
    if (r.url().includes("/lg/auction")) {
      let b = null; try { b = JSON.parse(r.postData() ?? "null"); } catch { b = r.postData(); }
      auctions.push(b);
    }
  });
  const errs = [];
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));

  await page.goto(`http://${HOST}:${PORT}/lg/${SLUG}?_cb=${Date.now()}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2200);

  // VISIBLE-input census: which answer key each visible [data-lg-input] posts.
  const census = await page.evaluate(() => {
    const rows = [];
    document.querySelectorAll("[data-lg-input]").forEach((el) => {
      if (!(el.offsetWidth || el.offsetHeight)) return;
      const h = el.closest("[data-lg-field]");
      rows.push(h ? h.getAttribute("data-lg-field") : null);
    });
    const counts = {};
    for (const k of rows) counts[k] = (counts[k] || 0) + 1;
    return { rows, counts, dupes: Object.keys(counts).filter((k) => counts[k] > 1) };
  });
  say(`\n[${tag}] VISIBLE-input data-lg-field census (step 0): ${JSON.stringify(census.counts)}`);
  say(`[${tag}] keys on MORE THAN ONE visible input: ${JSON.stringify(census.dupes)}`);

  // Walk the real visitor funnel to the auction.
  const typed = [];
  for (let hop = 0; hop < 14 && auctions.length === 0; hop++) {
    const filled = await page.evaluate((h) => {
      const out = [];
      document.querySelectorAll("[data-lg-input]").forEach((el, i) => {
        if (!(el.offsetWidth || el.offsetHeight)) return;
        const holder = el.closest("[data-lg-field]");
        const key = holder ? holder.getAttribute("data-lg-field") : null;
        const t = (el.getAttribute("type") || "").toLowerCase();
        const k = (key || "") + " " + (el.getAttribute("inputmode") || "") + " " + (el.getAttribute("placeholder") || "");
        let value = `H1 ${h}-${i}`;
        if (/zip|postal/i.test(k)) value = "9021" + (i % 10);
        else if (t === "tel" || /phone/i.test(k)) value = "415555123" + (i % 10);
        else if (t === "email" || /email/i.test(k)) value = `h1-${h}-${i}@example.com`;
        else if (t === "number" || /age|year|amount|income/i.test(k)) value = String(30 + i);
        else if (/state/i.test(k)) value = "CA";
        else if (/town/i.test(k)) value = "SIBLING-TOWN";
        el.value = value;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        out.push({ key, value });
      });
      return out;
    }, hop);
    typed.push({ hop, filled });
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
  await page.waitForTimeout(1200);
  await browser.close();

  // Per-STEP census: only one step is on screen at a time, so a key on two
  // visible inputs is a key that repeats WITHIN one step.
  for (const s of typed) {
    if (s.filled.length === 0) continue;
    const c = {};
    for (const f of s.filled) c[f.key] = (c[f.key] || 0) + 1;
    const dup = Object.keys(c).filter((k) => c[k] > 1);
    say(`[${tag}] step ${s.hop}: ${s.filled.map((f) => `${f.key}<-${JSON.stringify(f.value)}`).join("  ")}`);
    say(`[${tag}] step ${s.hop} census=${JSON.stringify(c)}  KEYS ON >1 VISIBLE INPUT=${JSON.stringify(dup)}`);
  }
  say(`[${tag}] POST /lg/auction requests: ${auctions.length}`);
  for (const a of auctions) say(`[${tag}] auction answers: ${JSON.stringify(a && a.answers ? a.answers : a)}`);
  if (errs.length) say(`[${tag}] page errors: ${JSON.stringify(errs.slice(0, 4))}`);
  return { census, auctions };
}

// ---------------------------------------------------------------------------
// Read the REAL Studio's fills picker for one slot.
async function studioSlots(tag, slotsWanted) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 950 } });
  const errs = [];
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  await page.goto(`${BASE}/admin/leadgen/sections/${SECTION}/edit?_cb=${Date.now()}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3400);
  const frame = page.frames().find((f) => f !== page.mainFrame());
  if (frame) {
    await frame.evaluate(() => {
      const el = document.querySelector('[data-question-id="p8_addr"]');
      if (el) el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  }
  await page.waitForTimeout(1000);
  await page.evaluate(() => {
    const t = [...document.querySelectorAll("[data-studio-inspector-tab]")].find((b) => b.getAttribute("data-studio-inspector-tab") === "maps");
    if (t) t.click();
  });
  await page.waitForTimeout(700);
  const out = await page.evaluate((wanted) => {
    const res = {};
    for (const s of wanted) {
      const sel = document.querySelector(`[data-maps-fill-slot="${s}"]`);
      res[s] = sel ? [...sel.options].map((o) => ({ v: o.value, t: o.textContent, d: o.disabled, s: o.selected })) : null;
    }
    return res;
  }, slotsWanted);
  await browser.close();
  for (const s of slotsWanted) {
    say(`[${tag}] STUDIO slot "${s}" options: ${JSON.stringify(out[s])}`);
  }
  if (errs.length) say(`[${tag}] studio page errors: ${JSON.stringify(errs.slice(0, 3))}`);
  return out;
}

// ---------------------------------------------------------------------------
if (has("--restore")) {
  await patch(RESTORE, "RESTORE");
  await pollServed('data-lg-field="p8_addr_zip"', null, 20);
  process.exit(0);
}

say(`\n================ P8-5 H1 TOCTTOU PROBE (${LABEL}) ================`);
say(`section ${SECTION}  ·  page /lg/${SLUG}  ·  sibling key ${SIB}\n`);

say("--- STAGE A: Address renders street+city; fills.state -> the sibling ---");
await patch(STAGE_A, "stage A");
await pollServed(`data-lg-field="${SIB}"`, `data-lg-field="${ADDR}_state"`, 24);
await studioSlots(`${LABEL} A`, ["state"]);

say("\n--- STAGE B: '+ Add field -> State'. Nothing re-validates the stored fill ---");
await patch(STAGE_B, "stage B");
// Converged only when the state box is on the page: either renamed onto the
// sibling's key (2 boxes, the defect) or keeping its own key (the resolution).
await pollServed(`lg-addr-${ADDR}_state`, null, 24) ??
  (await pollServed(`for="lg-addr-${SIB}"`, null, 24));
const stageB = await censusAndMoney(`${LABEL} B`);
await studioSlots(`${LABEL} B`, ["state"]);
// The two REAL artifacts the server leg joins, dumped for the normalizeAnswers
// measurement (scripts/p8/probe-p85h1-normalize.mts): the STORED content the
// API hands back, and the answers object the driven browser really POSTed.
{
  const stored = await (await fetch(`${BASE}/api/admin/leadgen/sections/${SECTION}`, { headers: HDRS })).json();
  const { writeFileSync } = await import("node:fs");
  writeFileSync(argOf("--dump", "/tmp/p85h1-stageB.json"), JSON.stringify({
    content: stored.content_json ?? stored.item?.content_json ?? null,
    posted: stageB.auctions[0]?.answers ?? null,
  }, null, 1));
  say(`[${LABEL} B] dumped stored content + posted answers -> ${argOf("--dump", "/tmp/p85h1-stageB.json")}`);
}

say(`\n--- STAGE C: the Create "<base>_<slot>" re-check (fills.zip = ${CREATE_SIB}, zip row added) ---`);
await patch(STAGE_C, "stage C");
await pollServed(`data-lg-field="${CREATE_SIB}"`, null, 24);
await censusAndMoney(`${LABEL} C`);

say(`\n--- STAGE D: no fill at all — the Address's OWN {base}_{slot} vs a sibling named ${CREATE_SIB} ---`);
await patch(STAGE_D, "stage D");
await pollServed(`data-lg-field="${CREATE_SIB}"`, null, 24);
await censusAndMoney(`${LABEL} D`);

say("\n--- restoring the fixture ---");
await patch(RESTORE, "RESTORE");
await pollServed('data-lg-field="p8_addr_state"', null, 20);
say("done.");
