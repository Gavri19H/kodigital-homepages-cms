#!/usr/bin/env node
// P8-3 CONDUCTOR REPRODUCTION — the six inline-theme_json findings the
// contract's R3 table asserts (§4 R3, docs/leadgen/r2/P8-DEFECT-CONTRACT.md).
//
// MISSION EVIDENCE TOOLING ONLY: never wired into CI, package.json or
// verify:all (contract §1 — no gates/validators no clause asks for). Run by
// hand from the api/ cwd against the conductor's already-running wrangler dev.
// This is a CLIENT of that server; it starts/stops/binds nothing.
//
// WHY IT EXISTS: the contract's R3 numbers were measured at an OLDER sha and
// several comparable contract numbers have already been falsified in earlier
// phases. Every claim gets re-measured by the conductor's own hand BEFORE a
// slice is dispatched to fix it.
//
// METHOD (E10/E11 — never a stylesheet byte): write a FULL inline theme_json
// via the real operator write path (PUT /funnels/:id/theme), fetch the live
// visitor page in a real chromium on a fresh ?_cb, and read
// getComputedStyle on the element the key's own operator-facing LABEL implies
// — plus, for mis-target candidates, the element the key actually reaches.
//
// Exit 0 when the sweep completes (verdicts are DATA, not a gate); exit 1 only
// on harness failure (server unreachable / browser will not launch).

import { chromium } from "playwright";

const LG_BASE = "http://127.0.0.1:8901";
const SITE_HOST = "r2fix.e2e.test";
const FUNNEL_ID = "lgf_01KZ271383F5X1SQ3DXTXKNJE5"; // funnel A — the one /lg/r2fix serves
const THEME_API = `${LG_BASE}/api/admin/leadgen/funnels/${FUNNEL_ID}/theme`;
const RESTORE = { theme_id: "thm_p8-repro" }; // A's binding before this run

const REAL_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

// Known, deliberately far-apart palette so a role-reference flip produces an
// unmistakable colour delta. Present in BOTH arms of every pair, so the only
// difference between arm A and arm B is the key under test.
const PALETTE = {
  brand_primary: "#1D9BF0",
  error: "#D32F2F",
  success: "#0E7C3A",
  page_background: "#F5F7FA",
  card_background: "#FFFFFF",
  border: "#CBD5E1",
};

let cb = 0;
const freshUrl = () => `http://${SITE_HOST}:8901/lg/r2fix?_cb=${Date.now()}-${++cb}`;

async function putTheme(theme_json) {
  const res = await fetch(THEME_API, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ theme_json }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`PUT -> HTTP ${res.status}: ${text.slice(0, 400)}`);
  return JSON.parse(text);
}

// The fixture's page order is NOT hard-coded here: earlier phases added and
// removed sections, so a walk pinned to a named Continue id (r2fix_shared_cont)
// silently broke the moment the first page changed. Advance by clicking
// whichever Continue is actually VISIBLE, filling the visible fields a
// required-question gate would otherwise block on, until the target appears.
async function advanceUntil(page, targetSel, maxSteps = 8) {
  const seen = async () => (await page.locator(targetSel).evaluateAll(
    (els) => els.some((el) => el.offsetWidth > 0 && el.offsetHeight > 0),
  ));
  for (let i = 0; i < maxSteps; i += 1) {
    if (await seen()) return true;
    await page.evaluate(() => {
      const val = (el) => {
        const id = el.id || "";
        if (/zip/i.test(id)) return "62704";
        if (/state/i.test(id)) return "IL";
        if (/city/i.test(id)) return "Springfield";
        if (el.type === "email") return "p8@example.com";
        if (el.type === "tel") return "5551234567";
        return "123 Main St";
      };
      document.querySelectorAll("input.lg-input, input[type=text], input[type=tel], input[type=email]").forEach((el) => {
        if (el.offsetWidth > 0 && el.offsetHeight > 0 && !el.value) {
          el.value = val(el);
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        }
      });
    });
    const cont = page.locator("[data-lg-continue]:visible").first();
    if ((await cont.count()) === 0) return false;
    await cont.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(700);
  }
  return seen();
}

// depth 0 = shared page (question card + Continue). 1 = the address page
// (4 .lg-input text fields). 2 = the carrier ButtonAnswerGroup page (3
// .lg-btn-answer choices). The walk NEVER submits the carrier page — that
// would post to /lg/auction, out of this probe's scope.
async function load(page, depth = 0) {
  await page.goto(freshUrl(), { waitUntil: "domcontentloaded" });
  await page
    .waitForSelector('#lg-funnel-root[data-lg-ready="1"]', { timeout: 8000 })
    .catch(() => {});
  if (depth >= 1) await advanceUntil(page, "#lg-addr-p8_addr_street");
  if (depth >= 2) await advanceUntil(page, ".lg-btn-answer");
  // .lg-input:focus is a higher-specificity rule than the role-driven resting
  // border — the engine autofocuses a freshly revealed section's first field,
  // so an un-blurred read measures the FOCUS colour (a script artifact).
  await page.evaluate(() => {
    const el = document.activeElement;
    if (el && typeof el.blur === "function") el.blur();
  });
}

// Measures the first VISIBLE match, never merely the first match — a 0x0 node
// still yields computed values, and comparing those would let "the key does
// nothing the operator can see" hide behind a number that happens to differ
// (or agree) off-screen. Reports how many matched vs how many are visible, so
// an ABSENT/INVISIBLE reading is stated rather than silently constant.
async function probe(page, selector, props) {
  return page.locator(selector).evaluateAll(
    (els, ps) => {
      const vis = els.filter((el) => el.offsetWidth > 0 && el.offsetHeight > 0);
      const el = vis[0] ?? els[0];
      if (!el) return null;
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const out = {
        _vis: el.offsetWidth > 0 && el.offsetHeight > 0,
        _w: Math.round(r.width),
        _h: Math.round(r.height),
        _matched: els.length,
        _visible: vis.length,
      };
      for (const p of ps) out[p] = cs[p];
      return out;
    },
    props,
  );
}

async function count(page, selector) {
  return page.locator(selector).count();
}

// Each case: the key, its two arms, and every element measured per arm.
// `implied` = the element the key's own operator label names. `alt` = where
// the contract says the effect actually lands (mis-target audit).
const CASES = [
  {
    key: "button_defaults.casing",
    depth: 2, // the carrier page — .lg-btn-answer painted; .lg-continue rides every page
    contract: "DEAD — none vs upper emit a byte-identical sheet; .lg-continue and .lg-btn-answer stay text-transform:none",
    arms: [
      ["none", { version: 1, palette: PALETTE, button_defaults: { casing: "none" } }],
      ["upper", { version: 1, palette: PALETTE, button_defaults: { casing: "upper" } }],
    ],
    measure: [
      { name: "implied .lg-continue", sel: ".lg-continue", props: ["textTransform"] },
      { name: "implied .lg-btn-answer", sel: ".lg-btn-answer", props: ["textTransform"] },
    ],
  },
  {
    key: "card_defaults.shadow",
    contract: "DEAD — all five values emit one identical sheet; .lg-question-card box-shadow fixed",
    arms: [
      ["none", { version: 1, palette: PALETTE, card_defaults: { shadow: "none" } }],
      ["xl", { version: 1, palette: PALETTE, card_defaults: { shadow: "xl" } }],
    ],
    measure: [
      { name: "implied .lg-question-card", sel: ".lg-question-card", props: ["boxShadow"] },
      { name: "alt .lg-disclosure-panel", sel: ".lg-disclosure-panel", props: ["boxShadow"] },
    ],
  },
  {
    key: "card_defaults.radius",
    contract: "MIS-TARGETED — only .lg-frame-disclosure--modal .lg-disclosure-panel (0x0); .lg-question-card stays 16px",
    arms: [
      ["sm", { version: 1, palette: PALETTE, card_defaults: { radius: "sm" } }],
      ["full", { version: 1, palette: PALETTE, card_defaults: { radius: "full" } }],
    ],
    measure: [
      { name: "implied .lg-question-card", sel: ".lg-question-card", props: ["borderRadius"] },
      { name: "alt .lg-disclosure-panel", sel: ".lg-disclosure-panel", props: ["borderRadius"] },
    ],
  },
  {
    key: "card_defaults.border_role",
    contract: "MIS-TARGETED — only .lg-card-panel, which no driven page renders",
    arms: [
      ["error", { version: 1, palette: PALETTE, card_defaults: { border_role: "error" } }],
      ["success", { version: 1, palette: PALETTE, card_defaults: { border_role: "success" } }],
    ],
    measure: [
      { name: "implied .lg-question-card", sel: ".lg-question-card", props: ["borderTopColor", "borderTopWidth"] },
      { name: "alt .lg-card-panel", sel: ".lg-card-panel", props: ["borderTopColor"] },
    ],
    counts: [".lg-card-panel", ".lg-question-card"],
  },
  {
    key: "card_defaults.background_role",
    depth: 1, // the address page — the .lg-input the contract says this key really repaints
    contract: "MIS-TARGETED — the sole painted effect is input.lg-input background; 'Card background' repaints the text input",
    arms: [
      ["error", { version: 1, palette: PALETTE, card_defaults: { background_role: "error" } }],
      ["success", { version: 1, palette: PALETTE, card_defaults: { background_role: "success" } }],
    ],
    measure: [
      { name: "implied .lg-question-card", sel: ".lg-question-card", props: ["backgroundColor"] },
      { name: "alt input.lg-input", sel: "input.lg-input", props: ["backgroundColor"] },
    ],
  },
  {
    key: "scales.shadow",
    depth: 2, // buttons must be VISIBLE for a box-shadow reading to mean anything
    contract: "PARTIAL — zero painted diffs on default surfaces; reaches only the hidden modal panel and the icon_on_track fill ::after",
    arms: [
      ["none", { version: 1, palette: PALETTE, scales: { shadow: "none" } }],
      ["high", { version: 1, palette: PALETTE, scales: { shadow: "high" } }],
    ],
    measure: [
      { name: "implied .lg-question-card", sel: ".lg-question-card", props: ["boxShadow"] },
      { name: "implied .lg-btn-answer", sel: ".lg-btn-answer", props: ["boxShadow"] },
      { name: "implied .lg-continue", sel: ".lg-continue", props: ["boxShadow"] },
      { name: "alt .lg-disclosure-panel", sel: ".lg-disclosure-panel", props: ["boxShadow"] },
    ],
  },
];

function fmt(v) {
  if (v === null) return "ABSENT (selector matched 0 nodes)";
  const { _vis, _w, _h, _matched, _visible, ...rest } = v;
  const props = Object.entries(rest).map(([k, val]) => `${k}=${val}`).join("  ");
  return `${props}   [_vis:${_vis} ${_w}x${_h}  matched:${_matched} visible:${_visible}]`;
}

async function main() {
  // The visitor shell is served by Host, and the bot guard 403s an empty UA —
  // so the drive must reach 127.0.0.1 *under the real hostname*.
  const browser = await chromium.launch({
    args: ["--host-resolver-rules=MAP r2fix.e2e.test 127.0.0.1"],
  });
  const page = await browser.newPage({ userAgent: REAL_UA, viewport: { width: 1280, height: 900 } });
  const lines = [];
  const say = (s) => { console.log(s); lines.push(s); };

  say(`# P8-3 M2 inline-key reproduction — conductor, ${new Date().toISOString()}`);
  say(`funnel ${FUNNEL_ID}  ·  write path PUT /funnels/:id/theme  ·  page /lg/r2fix (fresh ?_cb per load)`);
  say("");

  for (const c of CASES) {
    say(`## ${c.key}   (measured at page depth ${c.depth ?? 0})`);
    say(`contract says: ${c.contract}`);
    const readings = {};
    for (const [armName, theme] of c.arms) {
      await putTheme(theme);
      await load(page, c.depth ?? 0);
      readings[armName] = {};
      for (const m of c.measure) readings[armName][m.name] = await probe(page, m.sel, m.props);
      if (c.counts) {
        readings[armName]._counts = {};
        for (const sel of c.counts) readings[armName]._counts[sel] = await count(page, sel);
      }
    }
    const [a, b] = c.arms.map(([n]) => n);
    for (const m of c.measure) {
      const va = readings[a][m.name];
      const vb = readings[b][m.name];
      const moved = JSON.stringify(va) !== JSON.stringify(vb);
      say(`  ${m.name}`);
      say(`    ${a.padEnd(6)} ${fmt(va)}`);
      say(`    ${b.padEnd(6)} ${fmt(vb)}`);
      say(`    -> ${moved ? "MOVED" : "CONSTANT"}`);
    }
    if (c.counts) {
      for (const sel of c.counts) {
        say(`  count ${sel}: ${a}=${readings[a]._counts[sel]}  ${b}=${readings[b]._counts[sel]}`);
      }
    }
    say("");
  }

  await putTheme(RESTORE);
  say(`restored funnel theme to ${JSON.stringify(RESTORE)}`);
  await browser.close();
}

main().catch((e) => {
  console.error("HARNESS FAILURE:", e.message);
  process.exit(1);
});
