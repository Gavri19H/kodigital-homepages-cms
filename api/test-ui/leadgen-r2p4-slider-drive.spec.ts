// R2 P4 S4a — the DRIVEN PRODUCT for the §6.8 slider anatomy (contract §5.5).
//
// Nothing here is hand-built markup: the five slider types are AUTHORED through
// the real admin section save (the studio's own endpoint), then DRIVEN as a
// real visitor on the live public runtime at 1280 AND 375, and MEASURED in the
// browser (bounding boxes, computed styles) — because this phase exists
// precisely because green unit tests sat beside four visually broken renders.
//
// Evidence lands in docs/leadgen/r2/evidence/p4/s4a/ (one PNG per type per
// viewport + one all-five sheet), for the side-by-side against the owner's
// pins: single→Image11 · stepper→Image10 · from_to→Image13 ·
// dual_range→Image11 "Range" · radial→Image14, and §6.8's own examples.
//
// Prerequisites (mission smoke lane, not CI): local wrangler dev on PW_PORT
// with the r2fix fixture seeded (npm run seed:leadgen-fixture).

import { test, expect, request as playwrightRequest, type Page, type Locator } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { PW_PORT } from "./utils/base-url";

// The admin plane is host-gated to ADMIN_HOST (wrangler.toml dev value:
// "localhost"), so the authoring context must speak that host — 127.0.0.1
// 404s the ADMIN_HOST safety net (P4 cleanup fix; S4b's sibling spec already
// uses this same host).
const ORIGIN = `http://localhost:${PW_PORT}`;
const SITE_HOST = "r2fix.e2e.test";
const FUNNEL_SLUG = "r2fix";
const SHOT_DIR = "../docs/leadgen/r2/evidence/p4/s4a";
const CLEANUP_DIR = "../docs/leadgen/r2/evidence/p4/cleanup";
const HEADLINE = "P4 sliders — all five";

const REAL_CHROME_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

test.use({
  launchOptions: { args: ["--host-resolver-rules=MAP *.e2e.test 127.0.0.1"] },
  userAgent: REAL_CHROME_UA,
});
test.describe.configure({ mode: "serial" });

// Distinctive, per-type values (fixture-distinction guard, contract §2): none
// of these numbers or field names exist in the seeded fixture.
const SLIDERS = [
  { type: "single", qid: "p4_single", field: "p4_loan_amount", label: "Single — Loan amount", min: 0, max: 100, def: 37, step: 1, currency: true },
  { type: "stepper", qid: "p4_stepper", field: "p4_coverage_step", label: "Stepper — Coverage", min: 5000, max: 500000, def: 170000, step: 5000, currency: true },
  { type: "from_to", qid: "p4_fromto", field: "p4_price_band", label: "From / To — Price band", min: 0, max: 100000, def: null, step: 5000, currency: true },
  { type: "dual_range", qid: "p4_dual", field: "p4_deductible", label: "Dual range — Deductible", min: 0, max: 100, def: null, step: 1, currency: false },
  { type: "radial", qid: "p4_radial", field: "p4_driver_age", label: "Radial — Age", min: 0, max: 100, def: 45, step: 1, currency: false },
] as const;

interface SectionRow { id: number; public_id: string; section_name: string }
let SECTION: SectionRow;

function authoredContent(currencyOn: boolean): string {
  return JSON.stringify({
    components: [
      { type: "QuestionHeadline", question_id: "p4_head", props: { text: HEADLINE } },
      ...SLIDERS.map((s) => ({
        type: "NumberRangeQuestion",
        question_id: s.qid,
        question_key: s.field,
        internal_field: s.field,
        answer_type: "number",
        props: {
          label: s.label,
          slider_type: s.type,
          min: s.min,
          max: s.max,
          step: s.step,
          ...(s.def === null ? {} : { default: s.def }),
          ...(currencyOn && s.currency ? { currency_affix: true } : {}),
        },
      })),
      // the fixture's own mapped carrier question stays IN the section: the
      // offer's required provider field must keep a mapping or the quote's
      // activation preflight blocks (409 missing_required_provider_fields).
      {
        type: "ButtonAnswerGroup",
        question_id: "r2fix_q_carrier",
        question_key: "r2fix_carrier",
        internal_field: "r2fix_carrier",
        answer_type: "enum",
        required: true,
        choices: [
          { label: "Acme Insurance", value: "acme_insurance", analytics_id: "r2fix_acme_insurance" },
          { label: "Beta Mutual", value: "beta_mutual", analytics_id: "r2fix_beta_mutual" },
        ],
      },
      { type: "ContinueButton", question_id: "p4_cont", props: { label: "Continue" } },
    ],
  });
}

async function authorFiveSliders(currencyOn: boolean): Promise<number> {
  const ctx = await playwrightRequest.newContext({ baseURL: ORIGIN });
  const offers = (await (await ctx.get("/api/admin/leadgen/offers?activity=r2fix_activity")).json()) as {
    items: Array<{ id: number; offer_name: string }>;
  };
  const offer = offers.items.find((o) => o.offer_name === "R2Fix Fixture Offer");
  if (offer === undefined) throw new Error("fixture offer missing — run npm run seed:leadgen-fixture");
  const res = await ctx.patch(`/api/admin/leadgen/sections/${SECTION.public_id}`, {
    data: {
      content_json: authoredContent(currencyOn),
      selected_offers: [offer.id],
      answer_maps: [
        {
          question_id: "r2fix_q_carrier",
          offer_id: offer.id,
          offer_payload_field_path: "lead.r2fix_carrier",
          provider_expected_type: "string",
          required_for_offer: true,
          internal_field: "r2fix_carrier",
          answer_type: "enum",
        },
      ],
    },
  });
  const status = res.status();
  const body = await res.text();
  console.log(`AUTHOR five sliders (currency_affix=${currencyOn}) -> HTTP ${status}`);
  if (status !== 200) throw new Error(`authoring save failed: ${status} ${body.slice(0, 400)}`);
  // ADJACENT (reported, not fixed by this slice): a SECTION content save bumps
  // the SECTION's content_version only — the lg-shell cache key carries the
  // VARIANT's content_version + the activation's updated_at (cache-keys.ts
  // leadgenShellKey), and sections-handlers.ts calls no invalidation — so a
  // visitor keeps the previous shell for the full 300s TTL. Re-saving the
  // ACTIVATION (a real operator write) bumps activationVersion, which the key
  // comment names as the self-correcting axis: it mints a fresh shell key.
  const quotes = (await (await ctx.get("/api/admin/leadgen/quotes?activity=r2fix_activity")).json()) as {
    items: Array<{ public_id: string; quote_name: string }>;
  };
  // ADJACENT (reported, not fixed by this slice): a PARALLEL round's own
  // fixture ("P4 Thumbnail-Fix Evidence Quote") now shares this activity
  // value in the same D1 state, so a positional items[0] intermittently
  // resolves to THEIR quote instead of ours — activating it under the SAME
  // "r2fix" slug then 400s (site-level slug is unique per site, owned by
  // the ORIGINAL fixture quote). Find by name (same pattern the offer
  // lookup above already uses) so this spec is immune to sibling rounds
  // adding their own quotes under the same activity string.
  const quote = quotes.items.find((q) => q.quote_name === "R2Fix Fixture Quote");
  if (quote === undefined) throw new Error("fixture quote missing — run npm run seed:leadgen-fixture");
  const sites = (await (await ctx.get("/api/admin/sites")).json()) as { resource?: Array<{ id: string; domain: string }> };
  const site = (sites.resource ?? []).find((s) => s.domain === SITE_HOST);
  if (site === undefined) throw new Error("fixture site missing — run npm run seed:leadgen-fixture");
  // activationVersion is leadgen_site_quotes.updated_at = unixepoch() — SECOND
  // granularity. Two activation writes inside the same wall-clock second mint
  // the SAME key, so the previous body is served (a real staleness window, part
  // of the same adjacent finding). Cross the second boundary first.
  await new Promise((r) => setTimeout(r, 1100));
  const act = await ctx.put(`/api/admin/leadgen/quotes/${quote.public_id}/activation/${site.id}`, {
    data: { enabled: true, slug: FUNNEL_SLUG },
  });
  console.log(`  re-save activation (mints a fresh lg-shell key) -> HTTP ${act.status()}`);
  await ctx.dispose();
  return status;
}

// The tenant host only resolves inside the browser (--host-resolver-rules), so
// the SSR poll speaks raw HTTP to loopback with an explicit Host header — the
// same technique scripts/seed-leadgen-fixture.ts uses.
function rawShell(): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: "127.0.0.1",
        port: Number(PW_PORT),
        path: `/lg/${FUNNEL_SLUG}?_cb=${Date.now()}`,
        method: "GET",
        headers: { host: SITE_HOST, "user-agent": REAL_CHROME_UA },
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (c: string) => (body += c));
        res.on("end", () => resolve(body));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

// SSR convergence: the save bumps content_version, so poll the PUBLIC shell
// until the freshly authored markup is the served markup (never assume).
async function pollShellHas(needle: string, label: string): Promise<void> {
  const t0 = Date.now();
  for (let i = 0; i < 40; i += 1) {
    const html = await rawShell();
    if (html.includes(needle)) {
      console.log(`SSR converged in ${Date.now() - t0}ms (${i + 1} poll(s)): ${label}`);
      return;
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`SSR never served ${label} (${Date.now() - t0}ms)`);
}

async function openFunnel(page: Page, width: number): Promise<void> {
  await page.setViewportSize({ width, height: width < 500 ? 900 : 1000 });
  await page.goto(`http://${SITE_HOST}:${PW_PORT}/lg/${FUNNEL_SLUG}?_cb=${Date.now()}`, {
    waitUntil: "domcontentloaded",
  });
  for (let i = 0; i < 4; i += 1) {
    if (await page.getByText(HEADLINE).first().isVisible()) break;
    await page.locator("[data-lg-continue]:visible").first().click();
    await page.waitForTimeout(600);
  }
  await expect(page.getByText(HEADLINE).first()).toBeVisible();
}

function box(l: Locator) {
  return l.boundingBox();
}

interface Geo { cx: number; cy: number; w: number; h: number }
async function geo(l: Locator): Promise<Geo> {
  const b = await box(l);
  if (b === null) throw new Error("element has no box (not rendered)");
  return { cx: b.x + b.width / 2, cy: b.y + b.height / 2, w: b.width, h: b.height };
}

function wrapFor(page: Page, qid: string): Locator {
  return page.locator(`[data-lg-question="${qid}"]`).first();
}

// A padded clip, not a bare element screenshot: the two-handle tracks carry
// 40px of top margin (pill clearance) and the label sits above the wrapper's
// border box, so an element-only shot would cut exactly the anatomy under
// review. Clamped to the viewport.
async function shot(page: Page, l: Locator, path: string): Promise<void> {
  const b = await l.boundingBox();
  if (b === null) throw new Error(`no box for ${path}`);
  const vp = page.viewportSize() ?? { width: 1280, height: 1000 };
  const x = Math.max(0, b.x - 16);
  const y = Math.max(0, b.y - 62);
  await page.screenshot({
    path,
    clip: {
      x,
      y,
      width: Math.min(vp.width - x, b.width + 32),
      height: Math.min(vp.height - y, b.height + 74),
    },
  });
}

test.beforeAll(async () => {
  mkdirSync(SHOT_DIR, { recursive: true });
  const ctx = await playwrightRequest.newContext({ baseURL: ORIGIN });
  const body = (await (await ctx.get("/api/admin/leadgen/sections?activity=r2fix_activity")).json()) as {
    items: SectionRow[];
  };
  const found = body.items.find((s) => s.section_name === "R2Fix Fixture Carrier Buttons");
  if (found === undefined) throw new Error("fixture section missing — run npm run seed:leadgen-fixture");
  SECTION = found;
  await ctx.dispose();
  await authorFiveSliders(true);
  await pollShellHas(`data-lg-question="p4_radial"`, "the five authored sliders");
});

for (const width of [1280, 375]) {
  test(`the five §6.8 sliders render + measure correctly at ${width}`, async ({ page }) => {
    await openFunnel(page, width);
    const card = page.locator(".lg-question-card").filter({ hasText: HEADLINE }).first();
    await card.screenshot({ path: `${SHOT_DIR}/all-five-${width}.png` });

    // ---- single: handle ON the track (the detached-handle defect) ----------
    {
      const w = wrapFor(page, "p4_single");
      const track = w.locator(".lg-range-track");
      const fill = w.locator(".lg-range-fill");
      const handle = w.locator(".lg-range-handle");
      await expect(track).toHaveCount(1);
      await expect(handle).toHaveCount(1);
      const t = await geo(track);
      const h = await geo(handle);
      const f = (await box(fill))!;
      const dy = Math.abs(h.cy - t.cy);
      const dxFillEdge = Math.abs(h.cx - (f.x + f.width));
      const readout = (await w.locator(".lg-range-value").innerText()).trim();
      const caps = await w.locator(".lg-range-minmax span").allInnerTexts();
      console.log(
        `SINGLE @${width}: readout="${readout}" captions=[${caps.join(" , ")}] track(h=${t.h.toFixed(1)}) ` +
          `handle(${h.w.toFixed(1)}x${h.h.toFixed(1)}) |handleCY-trackCY|=${dy.toFixed(2)}px |handleCX-fillRight|=${dxFillEdge.toFixed(2)}px`,
      );
      expect(dy, "handle centre sits on the track centre-line").toBeLessThanOrEqual(1.5);
      expect(dxFillEdge, "handle rides the fill's leading edge").toBeLessThanOrEqual(1.5);
      expect(readout).toBe("$37");
      expect(caps).toEqual(["$0", "$100"]);
      await shot(page, w, `${SHOT_DIR}/single-${width}.png`);
    }

    // ---- stepper: −/＋ FLANK the readout, ≥44px, captions -------------------
    {
      const w = wrapFor(page, "p4_stepper");
      const dec = w.locator('[data-lg-step="dec"]');
      const inc = w.locator('[data-lg-step="inc"]');
      const val = w.locator(".lg-range-value");
      const d = await geo(dec);
      const i = await geo(inc);
      const v = await geo(val);
      const h = await geo(w.locator(".lg-range-handle"));
      const t = await geo(w.locator(".lg-range-track"));
      const caps = await w.locator(".lg-range-minmax span").allInnerTexts();
      console.log(
        `STEPPER @${width}: "${(await val.innerText()).trim()}" dec(${d.w}x${d.h})@${d.cx.toFixed(0)} ` +
          `value@${v.cx.toFixed(0)} inc(${i.w}x${i.h})@${i.cx.toFixed(0)} sameRow=${Math.abs(d.cy - v.cy) < 4} ` +
          `captions=[${caps.join(" , ")}] |handleCY-trackCY|=${Math.abs(h.cy - t.cy).toFixed(2)}px`,
      );
      expect(d.cx, "− is LEFT of the readout").toBeLessThan(v.cx);
      expect(i.cx, "＋ is RIGHT of the readout").toBeGreaterThan(v.cx);
      expect(Math.abs(d.cy - v.cy), "the row is one line").toBeLessThan(4);
      expect(Math.min(d.w, d.h, i.w, i.h), "≥44px targets").toBeGreaterThanOrEqual(44);
      expect(caps).toEqual(["$5,000", "$500,000"]);
      expect(Math.abs(h.cy - t.cy)).toBeLessThanOrEqual(1.5);
      await shot(page, w, `${SHOT_DIR}/stepper-${width}.png`);
    }

    // ---- from_to: ONE track, TWO handles, TWO labelled inputs --------------
    {
      const w = wrapFor(page, "p4_fromto");
      await expect(w.locator(".lg-range-track")).toHaveCount(1);
      const handles = w.locator(".lg-range-handle");
      await expect(handles).toHaveCount(2);
      const t = await geo(w.locator(".lg-range-track"));
      const h0 = await geo(handles.nth(0));
      const h1 = await geo(handles.nth(1));
      const labels = await w.locator(".lg-range-ft-label").allInnerTexts();
      const pills = await w.locator(".lg-range-handle-value").allInnerTexts();
      const caps = await w.locator(".lg-range-minmax span").allInnerTexts();
      const inputs = await w.locator('input[type="number"]').evaluateAll((els) =>
        els.map((e) => (e as HTMLInputElement).value),
      );
      console.log(
        `FROM_TO @${width}: handles cy=[${h0.cy.toFixed(1)},${h1.cy.toFixed(1)}] trackCY=${t.cy.toFixed(1)} ` +
          `sameTrack=${Math.abs(h0.cy - h1.cy) < 1.5} pills=[${pills.join(" , ")}] captions=[${caps.join(" , ")}] ` +
          `labels=[${labels.join(" , ")}] numberInputs=[${inputs.join(" , ")}]`,
      );
      expect(Math.abs(h0.cy - h1.cy), "both handles on the SAME track").toBeLessThanOrEqual(1.5);
      expect(Math.abs(h0.cy - t.cy)).toBeLessThanOrEqual(1.5);
      expect(h1.cx, "the max handle is right of the min handle").toBeGreaterThan(h0.cx);
      expect(labels).toEqual(["From ($)", "To ($)"]);
      expect(caps).toEqual(["$0", "$100,000"]);
      expect(inputs).toEqual(["0", "100000"]);
      await shot(page, w, `${SHOT_DIR}/from_to-${width}.png`);
    }

    // ---- dual_range: ONE track, TWO handles, NO number inputs --------------
    {
      const w = wrapFor(page, "p4_dual");
      await expect(w.locator(".lg-range-track")).toHaveCount(1);
      await expect(w.locator(".lg-range-handle")).toHaveCount(2);
      await expect(w.locator('input[type="number"]')).toHaveCount(0);
      const t = await geo(w.locator(".lg-range-track"));
      const h0 = await geo(w.locator(".lg-range-handle").nth(0));
      const h1 = await geo(w.locator(".lg-range-handle").nth(1));
      const pills = await w.locator(".lg-range-handle-value").allInnerTexts();
      const caps = await w.locator(".lg-range-minmax span").allInnerTexts();
      console.log(
        `DUAL @${width}: oneTrack=true handles=[${h0.cx.toFixed(0)},${h1.cx.toFixed(0)}] ` +
          `sameY=${Math.abs(h0.cy - h1.cy) < 1.5} onTrack=${Math.abs(h0.cy - t.cy) < 1.5} ` +
          `readouts=[${pills.join(" , ")}] captions=[${caps.join(" , ")}]`,
      );
      expect(Math.abs(h0.cy - h1.cy)).toBeLessThanOrEqual(1.5);
      expect(pills).toEqual(["0", "100"]);
      expect(caps).toEqual(["0", "100"]);
      await shot(page, w, `${SHOT_DIR}/dual_range-${width}.png`);
    }

    // ---- radial: a REAL circular dial with the handle ON the ring ----------
    {
      const w = wrapFor(page, "p4_radial");
      const outer = w.locator(".lg-range-radial-outer");
      const inner = w.locator(".lg-range-radial-inner");
      const handle = w.locator(".lg-range-radial-handle");
      const o = await geo(outer);
      const h = await geo(handle);
      const shape = await outer.evaluate((el) => {
        const cs = getComputedStyle(el);
        return { radius: cs.borderRadius, bg: cs.backgroundImage.slice(0, 60), deg: cs.getPropertyValue("--lg-deg").trim() };
      });
      const ringR = (o.w - 18 * (width < 500 ? 15 / 18 : 1)) / 2; // (size - band)/2, band 18/15
      const dist = Math.hypot(h.cx - o.cx, h.cy - o.cy);
      console.log(
        `RADIAL @${width}: dial=${o.w.toFixed(0)}x${o.h.toFixed(0)} round=${o.w === o.h} radius=${shape.radius} ` +
          `arc="${shape.bg}…" --lg-deg=${shape.deg} centre="${(await inner.innerText()).trim()}" ` +
          `handleDistFromCentre=${dist.toFixed(1)}px expectedRingR≈${ringR.toFixed(1)}px`,
      );
      expect(o.w, "the dial is a circle").toBe(o.h);
      expect(shape.bg, "a real conic-gradient arc").toContain("conic-gradient");
      expect(shape.deg, "the arc angle follows the value (45/100 -> 162deg)").toBe("162deg");
      expect((await inner.innerText()).trim()).toBe("45");
      expect(Math.abs(dist - ringR), "the handle sits ON the ring").toBeLessThanOrEqual(3);
      await shot(page, w, `${SHOT_DIR}/radial-${width}.png`);
    }
  });
}

// The live legs the CURRENT runtime already serves (S4b owns the rest — this
// test states, by measurement, exactly which per-type live updates work today).
test("live value changes: what moves today (keyboard on the real control)", async ({ page }) => {
  await openFunnel(page, 1280);

  const single = wrapFor(page, "p4_single");
  const sInput = single.locator('input[type="range"]');
  const before = (await single.locator(".lg-range-value").innerText()).trim();
  const beforeX = (await geo(single.locator(".lg-range-handle"))).cx;
  await sInput.focus();
  for (let i = 0; i < 8; i += 1) await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(200);
  const after = (await single.locator(".lg-range-value").innerText()).trim();
  const afterX = (await geo(single.locator(".lg-range-handle"))).cx;
  console.log(`LIVE single: readout ${before} -> ${after}; handle x ${beforeX.toFixed(1)} -> ${afterX.toFixed(1)}`);
  expect(after).not.toBe(before);
  expect(afterX).toBeGreaterThan(beforeX);
  await single.screenshot({ path: `${SHOT_DIR}/single-1280-after-keyboard.png` });

  const stepper = wrapFor(page, "p4_stepper");
  const sBefore = (await stepper.locator(".lg-range-value").innerText()).trim();
  const sHandleBefore = (await geo(stepper.locator(".lg-range-handle"))).cx;
  await stepper.locator('[data-lg-step="inc"]').click();
  await stepper.locator('[data-lg-step="inc"]').click();
  await page.waitForTimeout(200);
  const sAfter = (await stepper.locator(".lg-range-value").innerText()).trim();
  const sHandleAfter = (await geo(stepper.locator(".lg-range-handle"))).cx;
  console.log(`LIVE stepper: readout ${sBefore} -> ${sAfter}; handle x ${sHandleBefore.toFixed(1)} -> ${sHandleAfter.toFixed(1)}`);
  expect(sAfter).not.toBe(sBefore);
  expect(sHandleAfter).toBeGreaterThan(sHandleBefore);
  await stepper.screenshot({ path: `${SHOT_DIR}/stepper-1280-after-plus.png` });

  // radial: the centre value is LIVE again (the frozen-centre root cause was a
  // class the runtime never looked for). The ARC angle is S4b's write.
  const radial = wrapFor(page, "p4_radial");
  const rInput = radial.locator('input[type="range"]');
  const rBefore = (await radial.locator(".lg-range-radial-inner").innerText()).trim();
  const degBefore = await radial.locator(".lg-range-radial-outer").evaluate((el) => getComputedStyle(el).getPropertyValue("--lg-deg").trim());
  await rInput.focus();
  for (let i = 0; i < 10; i += 1) await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(200);
  const rAfter = (await radial.locator(".lg-range-radial-inner").innerText()).trim();
  const degAfter = await radial.locator(".lg-range-radial-outer").evaluate((el) => getComputedStyle(el).getPropertyValue("--lg-deg").trim());
  const rValue = await rInput.inputValue();
  console.log(
    `LIVE radial: centre ${rBefore} -> ${rAfter} (input value=${rValue}); --lg-deg ${degBefore} -> ${degAfter} ` +
      `[S4b owes the arc/handle write: --lg-deg on .lg-range-radial-outer]`,
  );
  expect(rAfter, "the centre value is no longer frozen").toBe(rValue);
  await radial.screenshot({ path: `${SHOT_DIR}/radial-1280-after-keyboard.png` });
});

// S4b HANDOFF MEASUREMENT (no correctness claim): what the CURRENT runtime does
// when a two-handle slider moves. render.updateRangeDisplay is single-handle by
// construction (it writes the FIRST .lg-range-fill's width from the one input
// that fired), so the two-handle fill needs S4b's own branch. Recorded as
// numbers so S4b builds against measured behaviour, not a description.
test("S4b handoff: measured two-handle live behaviour today", async ({ page }) => {
  await openFunnel(page, 1280);
  for (const qid of ["p4_fromto", "p4_dual"]) {
    const w = wrapFor(page, qid);
    const fillBefore = (await box(w.locator(".lg-range-fill")))!;
    const maxInput = w.locator('input[type="range"]').nth(1);
    await maxInput.focus();
    for (let i = 0; i < 5; i += 1) await page.keyboard.press("ArrowLeft");
    await page.waitForTimeout(200);
    const fillAfter = (await box(w.locator(".lg-range-fill")))!;
    const h0 = await geo(w.locator(".lg-range-handle").nth(0));
    const h1 = await geo(w.locator(".lg-range-handle").nth(1));
    const pills = await w.locator(".lg-range-handle-value").allInnerTexts();
    console.log(
      `S4b-HANDOFF ${qid}: max input value=${await maxInput.inputValue()} ; ` +
        `fill x/w ${fillBefore.x.toFixed(0)}/${fillBefore.width.toFixed(0)} -> ${fillAfter.x.toFixed(0)}/${fillAfter.width.toFixed(0)} ; ` +
        `handles ${h0.cx.toFixed(0)}/${h1.cx.toFixed(0)} ; pills=[${pills.join(" , ")}] ` +
        `[S4b owes: recompute .lg-range-fill left+width from BOTH inputs and rewrite both .lg-range-handle-value texts]`,
    );
  }
  await page.screenshot({ path: `${SHOT_DIR}/s4b-handoff-two-handle-1280.png`, fullPage: false });
});

// $ toggles freely, no save error (owner A.1 #7 B — the Image9 class).
test("the $ affix toggles OFF then ON with no save error, and the render follows", async ({ page }) => {
  const off = await authorFiveSliders(false);
  // the needle must be the SINGLE slider's own wrapper — dual_range/radial are
  // authored without the affix, so a bare data-format="number" always matches.
  await pollShellHas(`data-lg-field="p4_loan_amount" data-format="number"`, "currency OFF");
  await openFunnel(page, 1280);
  const offReadout = (await wrapFor(page, "p4_single").locator(".lg-range-value").innerText()).trim();
  const offCaps = await wrapFor(page, "p4_single").locator(".lg-range-minmax span").allInnerTexts();
  await wrapFor(page, "p4_single").screenshot({ path: `${SHOT_DIR}/single-1280-currency-off.png` });

  const on = await authorFiveSliders(true);
  await pollShellHas(`data-lg-field="p4_loan_amount" data-format="currency"`, "currency ON");
  await openFunnel(page, 1280);
  const onReadout = (await wrapFor(page, "p4_single").locator(".lg-range-value").innerText()).trim();
  const onCaps = await wrapFor(page, "p4_single").locator(".lg-range-minmax span").allInnerTexts();
  console.log(
    `CURRENCY TOGGLE: save OFF=HTTP ${off} readout="${offReadout}" captions=[${offCaps.join(" , ")}] | ` +
      `save ON=HTTP ${on} readout="${onReadout}" captions=[${onCaps.join(" , ")}]`,
  );
  expect(off).toBe(200);
  expect(on).toBe(200);
  expect(offReadout).toBe("37");
  expect(onReadout).toBe("$37");
});

// P4 cleanup Item 1 (S4b's own cosmetic finding, ratified as pin fidelity):
// the two .lg-range-handle-value pills collide when a from_to drag clamps the
// handles one step apart (S4b evidence:
// docs/leadgen/r2/evidence/p4/s4b/p4_fromto-1280-clamped.png). The fix
// (styles.ts, this file's owned sibling) is a `@container` query on
// `.lg-range-fill` — its own box IS the live handle gap (engine.ts already
// writes left/width on every drag; no engine change) — that raises the min
// pill clear of the max pill once the gap narrows below 96px. CSS only, zero
// runtime bytes. This drives BOTH states (S4b's own separated/clamped
// recipe), asserts the computed-style delta that IS the mechanism, and
// captures the evidence pair into docs/leadgen/r2/evidence/p4/cleanup/.
test("P4 cleanup: the value pills stack instead of colliding when clamped; Image13 fidelity holds separated", async ({ page }) => {
  mkdirSync(CLEANUP_DIR, { recursive: true });
  await openFunnel(page, 1280);
  const w = wrapFor(page, "p4_fromto");
  const track = w.locator(".lg-range-track");
  const hMin = w.locator(".lg-range-handle-min");
  const hMax = w.locator(".lg-range-handle-max");
  const pillMin = w.locator(".lg-range-handle-value").nth(0);
  const pillMax = w.locator(".lg-range-handle-value").nth(1);
  const rail0 = w.locator(".lg-range-input-dual").nth(0);

  async function drag(from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 6 });
    await page.mouse.move(to.x, to.y, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(120);
  }
  function overlaps(a: { x: number; y: number; width: number; height: number }, b: typeof a): boolean {
    return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  }

  await w.evaluate((el) => (el as Element).scrollIntoView({ block: "center" }));
  await page.waitForTimeout(150);
  const t = (await box(track))!;

  // ---- SEPARATED (S4b's own recipe: drag max to 70%, then min to 25%) -----
  const mb = (await box(hMax))!;
  await drag({ x: mb.x + mb.width / 2, y: mb.y + mb.height / 2 }, { x: t.x + t.width * 0.7, y: t.y + t.height / 2 });
  const nb = (await box(hMin))!;
  await drag({ x: nb.x + nb.width / 2, y: nb.y + nb.height / 2 }, { x: t.x + t.width * 0.25, y: t.y + t.height / 2 });

  const sepMin = (await box(pillMin))!;
  const sepMax = (await box(pillMax))!;
  const sepMinBottom = await pillMin.evaluate((el) => getComputedStyle(el as Element).bottom);
  const sepMaxBottom = await pillMax.evaluate((el) => getComputedStyle(el as Element).bottom);
  console.log(
    `P4 CLEANUP separated: minPill=${JSON.stringify(sepMin)} maxPill=${JSON.stringify(sepMax)} ` +
      `minBottom=${sepMinBottom} maxBottom=${sepMaxBottom} overlap=${overlaps(sepMin, sepMax)}`,
  );
  await shot(page, w, `${CLEANUP_DIR}/p4_fromto-1280-separated.png`);
  expect(overlaps(sepMin, sepMax), "Image13 fidelity: separated pills do not collide").toBe(false);
  expect(sepMinBottom, "Image13 fidelity: the container query is NOT engaged on a wide (separated) gap").toBe(
    sepMaxBottom,
  );

  // ---- CLAMPED (S4b's own recipe: 2x keyboard, then drag min past max) ----
  await rail0.focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(120);
  const nb2 = (await box(hMin))!;
  await drag(
    { x: nb2.x + nb2.width / 2, y: nb2.y + nb2.height / 2 },
    { x: t.x + t.width + 120, y: t.y + t.height / 2 },
  );

  const clMin = (await box(pillMin))!;
  const clMax = (await box(pillMax))!;
  const clMinBottom = await pillMin.evaluate((el) => getComputedStyle(el as Element).bottom);
  console.log(
    `P4 CLEANUP clamped: minPill=${JSON.stringify(clMin)} maxPill=${JSON.stringify(clMax)} ` +
      `minBottom=${clMinBottom} overlap=${overlaps(clMin, clMax)}`,
  );
  await shot(page, w, `${CLEANUP_DIR}/p4_fromto-1280-clamped.png`);
  expect(
    clMinBottom,
    "the container-query mechanism engaged (min pill's computed bottom shifted) once the gap clamped",
  ).not.toBe(sepMinBottom);
  expect(overlaps(clMin, clMax), "the mechanism prevents the pill collision in the clamped state").toBe(false);
});
