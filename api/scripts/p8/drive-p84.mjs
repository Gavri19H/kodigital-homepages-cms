#!/usr/bin/env node
// P8-4 CONDUCTOR VERIFICATION — mission evidence tooling, never wired into CI.
// Client of the already-running wrangler dev on :8901. Starts/binds nothing.
import { chromium } from "playwright";
const A = "lgf_01KZ271383F5X1SQ3DXTXKNJE5";
const API = "http://127.0.0.1:8901/api/admin/leadgen";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const SHOT = "../docs/leadgen/r2/evidence/p8/p8-4-conductor";
const j = async (u, o) => { const r = await fetch(u, o); return { status: r.status, body: await r.json().catch(() => null) }; };
let cb = 0;
const url = () => `http://r2fix.e2e.test:8901/lg/r2fix?_cb=${Date.now()}-${++cb}`;

const before = await j(`${API}/funnels/${A}/frame`);
console.log("frame_config BEFORE apply:", JSON.stringify(before.body?.frame_config ?? null).slice(0, 160));

const cat = await j(`${API}/frame-template-records`);  // SAVED records — resolveFrameTemplateRow reads this table, not the built-in arrangement registry
const list = cat.body?.items ?? [];
console.log(`saved records: ${list.length}; ${list.map(t => t.id + ":" + t.name).slice(0, 6).join(" | ")}`);
const curTpl = String(before.body?.frame_config?.template ?? "");
const pick = list.find(t => String(t.frame_json?.template ?? "") !== curTpl) ?? list[list.length - 1];
console.log(`picked record ${pick.id} "${pick.name}"`);

const dry = await j(`${API}/funnels/${A}/apply-template`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ template_id: pick.id, dry_run: true }) });
console.log(`DRY RUN on ${pick.id}: changes=${dry.body?.changes?.length ?? "?"} replaced=${JSON.stringify(dry.body?.replaced_customisations ?? null)}`);
console.log("confirmations:"); (dry.body?.confirmations ?? []).forEach(s => console.log("   - " + s));

const b = await chromium.launch({ args: ["--host-resolver-rules=MAP r2fix.e2e.test 127.0.0.1"] });
const p = await b.newPage({ userAgent: UA, viewport: { width: 1280, height: 900 } });
const errs = []; p.on("pageerror", e => errs.push(e.message));
const shot = async (n) => { await p.goto(url(), { waitUntil: "domcontentloaded" }); await p.waitForTimeout(1200); await p.screenshot({ path: `${SHOT}/${n}.png` }); 
  return p.evaluate(() => {
    // Sample what the FRAME actually controls. NOTE (conductor error, corrected):
    // my first pass sampled `.lg-question-card` presence as the card/bare signal —
    // that wrapper exists on every page regardless of the frame's section_slot.card,
    // so it could never move. The frame's own classes are the real signal.
    const frame = document.querySelector('[class*="lg-frame-"]');
    const cls = (sel) => { const e = document.querySelector(sel); return e ? e.className : null; };
    const bgEl = document.querySelector(".lg-frame-background");
    return {
      frameClasses: frame ? frame.className : null,
      header: cls(".lg-frame-header"),
      progressRegion: cls(".lg-frame-progress"),
      slot: cls(".lg-frame-slot") || cls('[class*="lg-frame-section-slot"]'),
      bgClass: bgEl ? bgEl.className : null,
      bgPaint: bgEl ? getComputedStyle(bgEl).backgroundColor : null,
      sticky: cls(".lg-frame-header") ? getComputedStyle(document.querySelector(".lg-frame-header")).position : null,
    };
  }); };
const s1 = await shot("visitor-before-apply-1280");
const applied = await j(`${API}/funnels/${A}/apply-template`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ template_id: pick.id }) });
console.log(`APPLIED: status=${applied.status} changes=${applied.body?.changes?.length ?? "?"}`);
const s2 = await shot("visitor-after-apply-1280");
const stored = await j(`${API}/funnels/${A}/frame`);
console.log("frame_config AFTER apply (stored leaves):", Object.keys(stored.body?.frame_config ?? {}).length, JSON.stringify(stored.body?.frame_config ?? {}).slice(0, 200));
const re = await j(`${API}/funnels/${A}/apply-template`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ template_id: pick.id, dry_run: true }) });
console.log(`RE-APPLY dry run: changes=${re.body?.changes?.length} replaced=${JSON.stringify(re.body?.replaced_customisations)}`);
console.log("visitor before:", JSON.stringify(s1)); console.log("visitor after :", JSON.stringify(s2));
console.log("page errors:", errs.length ? errs.slice(0,3) : "none");
await j(`${API}/funnels/${A}/apply-template`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ template_id: null }) });
const restored = await j(`${API}/funnels/${A}/frame`);
console.log("RESTORED frame_config:", JSON.stringify(restored.body?.frame_config ?? null));
await b.close();
