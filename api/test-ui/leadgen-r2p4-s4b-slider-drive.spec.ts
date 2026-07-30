// R2 P4 S4b — the DRIVEN PRODUCT for the §6.8 sliders MOVING (contract §5.5).
//
// S4a proved the five types RENDER (anatomy, docs/leadgen/r2/evidence/p4/s4a/).
// This spec proves they MOVE: for each of the five, a REAL pointer drag AND a
// REAL keypress on the live public runtime at 1280 and 375, with the readout,
// the handle position, the fill geometry and (radial) the arc angle MEASURED
// before and after. Numbers, not adjectives — this phase exists because unit
// tests were green while the renders were broken, so nothing here is asserted
// from code, only from the browser's own boxes and computed styles.
//
// The two defects S4a handed over are the headline checks:
//   * radial — "centre value FROZEN while the real value changes" was fixed at
//     the root by S4a (the centre carries lg-range-value); the ARC did not
//     follow. Here --lg-deg must move with the value, under BOTH input modes.
//   * from_to / dual_range — S4a measured "fill x/w 477/326 -> 477/245;
//     pills=[$0 , $100,000]" while the input read 75000. Here the fill must
//     span BETWEEN both handles and BOTH pills must read their own handle.
//
// Prerequisites (mission smoke lane, not CI): local wrangler dev on PW_PORT
// with the r2fix fixture seeded (npm run seed:leadgen-fixture).

import { test, expect, request as playwrightRequest, type Page, type Locator } from "@playwright/test";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { PW_PORT } from "./utils/base-url";

// The admin plane is host-gated to ADMIN_HOST, and under the DOCUMENTED runner
// that host is 127.0.0.1 — playwright.config.ts:281 launches wrangler with
// `--var ADMIN_HOST:127.0.0.1`, and a CLI --var OVERRIDES wrangler.toml's
// `ADMIN_HOST = "localhost"`. So `localhost` 404s here whenever playwright
// boots its own webServer (it only ever worked against a hand-started server).
// DO NOT flip this back to localhost.
const ORIGIN = `http://127.0.0.1:${PW_PORT}`;
const SITE_HOST = "r2fix.e2e.test";
const FUNNEL_SLUG = "r2fix";
const SHOT_DIR = "../docs/leadgen/r2/evidence/p4/s4b";
const LOG = `${SHOT_DIR}/measurements.txt`;
const HEADLINE = "P4 sliders — all five";

const REAL_CHROME_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

test.use({
  launchOptions: { args: ["--host-resolver-rules=MAP *.e2e.test 127.0.0.1"] },
  userAgent: REAL_CHROME_UA,
});
test.describe.configure({ mode: "serial" });

function say(line: string): void {
  console.log(line);
  appendFileSync(LOG, `${line}\n`);
}

// The SAME five authored sliders S4a drove (identical qids/fields/values), so
// the two evidence sets are directly comparable side by side.
const SLIDERS = [
  { type: "single", qid: "p4_single", field: "p4_loan_amount", label: "Single — Loan amount", min: 0, max: 100, def: 37, step: 1, currency: true },
  { type: "stepper", qid: "p4_stepper", field: "p4_coverage_step", label: "Stepper — Coverage", min: 5000, max: 500000, def: 170000, step: 5000, currency: true },
  { type: "from_to", qid: "p4_fromto", field: "p4_price_band", label: "From / To — Price band", min: 0, max: 100000, def: null, step: 5000, currency: true },
  { type: "dual_range", qid: "p4_dual", field: "p4_deductible", label: "Dual range — Deductible", min: 0, max: 100, def: null, step: 1, currency: false },
  { type: "radial", qid: "p4_radial", field: "p4_driver_age", label: "Radial — Age", min: 0, max: 100, def: 45, step: 1, currency: false },
] as const;

interface SectionRow { id: number; public_id: string; section_name: string }
let SECTION: SectionRow;

function authoredContent(): string {
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
          ...(s.currency ? { currency_affix: true } : {}),
        },
      })),
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

async function authorFiveSliders(): Promise<void> {
  const ctx = await playwrightRequest.newContext({ baseURL: ORIGIN });
  const offers = (await (await ctx.get("/api/admin/leadgen/offers?activity=r2fix_activity")).json()) as {
    items: Array<{ id: number; offer_name: string }>;
  };
  const offer = offers.items.find((o) => o.offer_name === "R2Fix Fixture Offer");
  if (offer === undefined) throw new Error("fixture offer missing — run npm run seed:leadgen-fixture");
  const res = await ctx.patch(`/api/admin/leadgen/sections/${SECTION.public_id}`, {
    data: {
      content_json: authoredContent(),
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
  say(`AUTHOR five sliders -> HTTP ${res.status()}`);
  if (res.status() !== 200) throw new Error(`authoring save failed: ${res.status()} ${(await res.text()).slice(0, 400)}`);
  // KNOWN ADJACENT SEAM (S4a measured it; registered for the owner, NOT fixed
  // here): a SECTION content save bumps only the SECTION's content_version,
  // while the lg-shell cache key carries the VARIANT's — so a visitor can hold
  // the old shell for the full 300s TTL. Re-saving the ACTIVATION mints a fresh
  // key; activationVersion is unixepoch(), so cross a second boundary first.
  // ADJACENT (reported, not fixed by this slice): a PARALLEL round's own
  // fixture ("P4 Thumbnail-Fix Evidence Quote") now shares this activity value
  // in the same D1 state, so a positional items[0] intermittently resolves to
  // THEIR quote instead of ours — activating it under the SAME "r2fix" slug then
  // 400s (site-level slug is unique per site, owned by the ORIGINAL fixture
  // quote). Find by name (same pattern the offer lookup above already uses) so
  // this spec is immune to sibling rounds adding their own quotes under the same
  // activity string.
  const quotes = (await (await ctx.get("/api/admin/leadgen/quotes?activity=r2fix_activity")).json()) as {
    items: Array<{ public_id: string; quote_name: string }>;
  };
  const quote = quotes.items.find((q) => q.quote_name === "R2Fix Fixture Quote");
  if (quote === undefined) throw new Error("fixture quote missing — run npm run seed:leadgen-fixture");
  const sites = (await (await ctx.get("/api/admin/sites")).json()) as { resource?: Array<{ id: string; domain: string }> };
  const site = (sites.resource ?? []).find((s) => s.domain === SITE_HOST);
  if (site === undefined) throw new Error("fixture site missing — run npm run seed:leadgen-fixture");
  await new Promise((r) => setTimeout(r, 1100));
  const act = await ctx.put(`/api/admin/leadgen/quotes/${quote.public_id}/activation/${site.id}`, {
    data: { enabled: true, slug: FUNNEL_SLUG },
  });
  const actStatus = act.status();
  say(`  re-save activation (mints a fresh lg-shell key) -> HTTP ${actStatus}`);
  if (actStatus !== 200) {
    const actBody = await act.text();
    throw new Error(`activation re-save failed: ${actStatus} ${actBody.slice(0, 400)}`);
  }
  await ctx.dispose();
}

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

async function pollShellHas(needle: string, label: string): Promise<void> {
  const t0 = Date.now();
  for (let i = 0; i < 40; i += 1) {
    if ((await rawShell()).includes(needle)) {
      say(`SSR converged in ${Date.now() - t0}ms (${i + 1} poll(s)): ${label}`);
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
  // The engine must be live BEFORE the walk (and before any drag): a click or a
  // pointer drag on a not-yet-hydrated page would "pass" by doing nothing.
  await page.waitForFunction(() => (window as unknown as { __LG_ENGINE__?: unknown }).__LG_ENGINE__ !== undefined);
  for (let i = 0; i < 6; i += 1) {
    if (await page.getByText(HEADLINE).first().isVisible()) break;
    // Bounded click: the section can advance mid-retry, which leaves the
    // resolved Continue detached — that is success, not a failure.
    await page
      .locator("[data-lg-continue]:visible")
      .first()
      .click({ timeout: 2500 })
      .catch(() => undefined);
    await page.waitForTimeout(600);
  }
  await expect(page.getByText(HEADLINE).first()).toBeVisible();
}

function wrapFor(page: Page, qid: string): Locator {
  return page.locator(`[data-lg-question="${qid}"]`).first();
}

interface Box { x: number; y: number; w: number; h: number }
async function bbox(l: Locator): Promise<Box> {
  const b = await l.boundingBox();
  if (b === null) throw new Error("element has no box (not rendered)");
  return { x: b.x, y: b.y, w: b.width, h: b.height };
}
// A mouse drag can only land on pixels that are ON SCREEN: page.mouse works in
// VIEWPORT coordinates, and boundingBox() of a below-the-fold element returns a
// y past the viewport height, where nothing is hit-testable. Scroll the widget
// into view, settle, and re-measure — then the coordinates are real.
async function inView(page: Page, l: Locator): Promise<Box> {
  // block:"center" (not scrollIntoViewIfNeeded, which parks a tall widget flush
  // against the fold and leaves its last pixels off-screen at 375).
  await l.evaluate((el) => (el as Element).scrollIntoView({ block: "center" }));
  await page.waitForTimeout(150);
  const b = await bbox(l);
  const vp = page.viewportSize() ?? { width: 1280, height: 1000 };
  if (b.y < 0 || b.y + b.h > vp.height) {
    throw new Error(`element is not fully in the viewport after scrolling (y=${b.y} h=${b.h} vp=${vp.height})`);
  }
  return b;
}
const r1 = (n: number): string => n.toFixed(1);

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

/** A REAL pointer drag: press on the element's own hit point, move, release. */
async function dragTo(page: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  // Intermediate moves: a single jump would not exercise the move stream the
  // radial ring listens to.
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 6 });
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(120);
}

/** A REAL keypress on the focused native control (the §6.8 keyboard rail). */
async function keyOn(page: Page, input: Locator, key: string, times = 1): Promise<void> {
  await input.focus();
  for (let i = 0; i < times; i += 1) await page.keyboard.press(key);
  await page.waitForTimeout(120);
}

async function styleOf(l: Locator, prop: string): Promise<string> {
  return l.evaluate((el, p) => getComputedStyle(el as Element).getPropertyValue(p).trim(), prop);
}

test.beforeAll(async () => {
  mkdirSync(SHOT_DIR, { recursive: true });
  writeFileSync(LOG, `R2 P4 S4b — driven-product measurements (${new Date().toISOString()})\n`);
  const ctx = await playwrightRequest.newContext({ baseURL: ORIGIN });
  const body = (await (await ctx.get("/api/admin/leadgen/sections?activity=r2fix_activity")).json()) as {
    items: SectionRow[];
  };
  const found = body.items.find((s) => s.section_name === "R2Fix Fixture Carrier Buttons");
  if (found === undefined) throw new Error("fixture section missing — run npm run seed:leadgen-fixture");
  SECTION = found;
  await ctx.dispose();
  await authorFiveSliders();
  await pollShellHas(`data-lg-question="p4_radial"`, "the five authored sliders");
});

for (const width of [1280, 375]) {
  test(`single + stepper: a real drag and a real keypress move readout/handle/fill at ${width}`, async ({ page }) => {
    await openFunnel(page, width);

    // ---- single ----------------------------------------------------------
    const w = wrapFor(page, "p4_single");
    const track = w.locator(".lg-range-track");
    const fill = w.locator(".lg-range-fill");
    const handle = w.locator(".lg-range-handle");
    const input = w.locator(".lg-range-input");
    const value = w.locator(".lg-range-value");

    await inView(page, w);
    const t = await bbox(track);
    const before = {
      readout: (await value.textContent()) ?? "",
      fillW: (await bbox(fill)).w,
      handleX: (await bbox(handle)).x,
      v: await input.inputValue(),
    };
    // Grab the visible handle and drag it to 80% of the track.
    const hb = await bbox(handle);
    await dragTo(page, { x: hb.x + hb.w / 2, y: hb.y + hb.h / 2 }, { x: t.x + t.w * 0.8, y: t.y + t.h / 2 });
    const after = {
      readout: (await value.textContent()) ?? "",
      fillW: (await bbox(fill)).w,
      handleX: (await bbox(handle)).x,
      v: await input.inputValue(),
    };
    say(
      `SINGLE @${width} DRAG: value ${before.v}->${after.v} readout "${before.readout}"->"${after.readout}" ` +
        `fillW ${r1(before.fillW)}->${r1(after.fillW)} handleX ${r1(before.handleX)}->${r1(after.handleX)} ` +
        `aria-valuenow=${await input.getAttribute("aria-valuenow")}`,
    );
    expect(Number(after.v), "the drag changed the real value").toBeGreaterThan(Number(before.v));
    expect(after.fillW, "the fill followed the value").toBeGreaterThan(before.fillW);
    expect(after.handleX, "the handle followed the value").toBeGreaterThan(before.handleX);
    expect(after.readout).toBe(`$${Number(after.v).toLocaleString("en-US")}`);
    expect(await input.getAttribute("aria-valuenow")).toBe(after.v);

    // ...and the keyboard moves the SAME three surfaces.
    const kb0 = { v: after.v, fillW: after.fillW, handleX: after.handleX };
    await keyOn(page, input, "ArrowRight", 3);
    const kb1 = { v: await input.inputValue(), fillW: (await bbox(fill)).w, handleX: (await bbox(handle)).x };
    say(
      `SINGLE @${width} KEYS(3x Right): value ${kb0.v}->${kb1.v} fillW ${r1(kb0.fillW)}->${r1(kb1.fillW)} ` +
        `handleX ${r1(kb0.handleX)}->${r1(kb1.handleX)} readout="${await value.textContent()}"`,
    );
    expect(Number(kb1.v)).toBe(Number(kb0.v) + 3);
    expect(kb1.fillW).toBeGreaterThan(kb0.fillW);
    expect(await value.textContent()).toBe(`$${Number(kb1.v).toLocaleString("en-US")}`);
    await shot(page, w, `${SHOT_DIR}/single-${width}-after-drag.png`);

    // ---- stepper ---------------------------------------------------------
    const sw = wrapFor(page, "p4_stepper");
    const sInput = sw.locator(".lg-range-input");
    const sFill = sw.locator(".lg-range-fill");
    const sValue = sw.locator(".lg-range-value");
    const sHandle = sw.locator(".lg-range-handle");
    const s0 = { v: await sInput.inputValue(), fillW: (await bbox(sFill)).w, handleX: (await bbox(sHandle)).x };
    await sw.locator(".lg-range-stepper-inc").click();
    await page.waitForTimeout(100);
    const s1 = { v: await sInput.inputValue(), fillW: (await bbox(sFill)).w, handleX: (await bbox(sHandle)).x };
    // and a real drag of the stepper's own track handle
    await inView(page, sw);
    const st = await bbox(sw.locator(".lg-range-track"));
    const shb = await bbox(sHandle);
    await dragTo(page, { x: shb.x + shb.w / 2, y: shb.y + shb.h / 2 }, { x: st.x + st.w * 0.6, y: st.y + st.h / 2 });
    const s2 = { v: await sInput.inputValue(), fillW: (await bbox(sFill)).w, handleX: (await bbox(sHandle)).x };
    say(
      `STEPPER @${width}: + button ${s0.v}->${s1.v} (fillW ${r1(s0.fillW)}->${r1(s1.fillW)}, handleX ${r1(s0.handleX)}->${r1(s1.handleX)}) ; ` +
        `DRAG ${s1.v}->${s2.v} (fillW ${r1(s2.fillW)}, handleX ${r1(s2.handleX)}) readout="${await sValue.textContent()}"`,
    );
    expect(Number(s1.v)).toBe(Number(s0.v) + 5000);
    expect(s1.fillW).toBeGreaterThan(s0.fillW);
    expect(Number(s2.v)).not.toBe(Number(s1.v));
    expect(await sValue.textContent()).toBe(`$${Number(s2.v).toLocaleString("en-US")}`);
    await shot(page, sw, `${SHOT_DIR}/stepper-${width}-after-drag.png`);
  });

  test(`from_to + dual_range: both handles drag independently, the fill spans BETWEEN them at ${width}`, async ({ page }) => {
    await openFunnel(page, width);

    for (const qid of ["p4_fromto", "p4_dual"] as const) {
      const w = wrapFor(page, qid);
      const track = w.locator(".lg-range-track");
      const fill = w.locator(".lg-range-fill");
      const rails = w.locator(".lg-range-input-dual");
      const pills = w.locator(".lg-range-handle-value");
      const hMin = w.locator(".lg-range-handle-min");
      const hMax = w.locator(".lg-range-handle-max");
      await inView(page, w);
      const t = await bbox(track);

      const f0 = await bbox(fill);
      const p0 = await pills.allTextContents();
      const v0 = [await rails.nth(0).inputValue(), await rails.nth(1).inputValue()];

      // MAX handle: drag it to 70% of the track (the S4a handoff case).
      const mb = await bbox(hMax);
      await dragTo(page, { x: mb.x + mb.w / 2, y: mb.y + mb.h / 2 }, { x: t.x + t.w * 0.7, y: t.y + t.h / 2 });
      const f1 = await bbox(fill);
      const p1 = await pills.allTextContents();
      const v1 = [await rails.nth(0).inputValue(), await rails.nth(1).inputValue()];

      // MIN handle: drag it to 25% of the track.
      const nb = await bbox(hMin);
      await dragTo(page, { x: nb.x + nb.w / 2, y: nb.y + nb.h / 2 }, { x: t.x + t.w * 0.25, y: t.y + t.h / 2 });
      const f2 = await bbox(fill);
      const p2 = await pills.allTextContents();
      const v2 = [await rails.nth(0).inputValue(), await rails.nth(1).inputValue()];
      const g2 = { min: await bbox(hMin), max: await bbox(hMax) };

      say(
        `${qid.toUpperCase()} @${width}: values [${v0.join(",")}] -> maxDrag [${v1.join(",")}] -> minDrag [${v2.join(",")}]`,
      );
      say(
        `  fill x/w ${r1(f0.x)}/${r1(f0.w)} -> ${r1(f1.x)}/${r1(f1.w)} -> ${r1(f2.x)}/${r1(f2.w)} ` +
          `(track x/w ${r1(t.x)}/${r1(t.w)})`,
      );
      say(`  pills [${p0.join(" , ")}] -> [${p1.join(" , ")}] -> [${p2.join(" , ")}]`);
      say(
        `  handles minCX=${r1(g2.min.x + g2.min.w / 2)} maxCX=${r1(g2.max.x + g2.max.w / 2)} ` +
          `fillL=${r1(f2.x)} fillR=${r1(f2.x + f2.w)} aria=[${await rails.nth(0).getAttribute("aria-valuenow")},${await rails.nth(1).getAttribute("aria-valuenow")}]`,
      );

      // The MAX drag moved ONLY the max side, and shrank the span from the right.
      expect(Number(v1[1]), "max handle moved").toBeLessThan(Number(v0[1]));
      expect(v1[0], "min handle untouched by a max drag").toBe(v0[0]);
      expect(f1.w, "the fill shrank from the right").toBeLessThan(f0.w);
      expect(Math.abs(f1.x - f0.x), "the fill's LEFT edge did not move").toBeLessThan(1.5);

      // The MIN drag moved ONLY the min side, and moved the fill's left edge.
      expect(Number(v2[0]), "min handle moved").toBeGreaterThan(Number(v1[0]));
      expect(v2[1], "max handle untouched by a min drag").toBe(v1[1]);
      expect(f2.x, "the fill's LEFT edge followed the min handle").toBeGreaterThan(f0.x + 1.5);

      // The fill SPANS BETWEEN the two handles (the S4a defect: it did not).
      expect(Math.abs(f2.x - (g2.min.x + g2.min.w / 2)), "fill left edge sits on the min handle").toBeLessThan(2);
      expect(Math.abs(f2.x + f2.w - (g2.max.x + g2.max.w / 2)), "fill right edge sits on the max handle").toBeLessThan(2);

      // BOTH pills track their OWN handle (S4a: both were frozen at the rails).
      expect(p2[0], "min pill tracks the min handle").not.toBe(p0[0]);
      expect(p2[1], "max pill tracks the max handle").not.toBe(p0[1]);
      const fmt = (v: string): string =>
        (qid === "p4_fromto" ? "$" : "") + Number(v).toLocaleString("en-US");
      expect(p2[0]).toBe(fmt(v2[0] as string));
      expect(p2[1]).toBe(fmt(v2[1] as string));

      // The Image13-comparable frame: both handles well apart, the fill spanning
      // between them, each pill on its own handle. (The clamp shot below is the
      // adversarial end state, where two adjacent pills necessarily overlap.)
      await shot(page, w, `${SHOT_DIR}/${qid}-${width}-separated.png`);

      // Keyboard on a handle moves that handle only.
      const k0 = [await rails.nth(0).inputValue(), await rails.nth(1).inputValue()];
      await keyOn(page, rails.nth(0), "ArrowRight", 2);
      const k1 = [await rails.nth(0).inputValue(), await rails.nth(1).inputValue()];
      say(`  KEYS(min 2x Right): [${k0.join(",")}] -> [${k1.join(",")}] pills=[${(await pills.allTextContents()).join(" , ")}]`);
      expect(Number(k1[0])).toBeGreaterThan(Number(k0[0]));
      expect(k1[1]).toBe(k0[1]);

      // CLAMP: drive the min handle all the way past the max and prove it stops
      // one step short, that the max never moved, and that both stay grabbable.
      const step = qid === "p4_fromto" ? 5000 : 1;
      const nb2 = await bbox(hMin);
      await dragTo(page, { x: nb2.x + nb2.w / 2, y: nb2.y + nb2.h / 2 }, { x: t.x + t.w + 120, y: t.y + t.h / 2 });
      const c = [await rails.nth(0).inputValue(), await rails.nth(1).inputValue()];
      const cg = { min: await bbox(hMin), max: await bbox(hMax) };
      say(
        `  CLAMP (min dragged past max): [${c.join(",")}] gap=${Number(c[1]) - Number(c[0])} (step=${step}) ` +
          `handleCX min=${r1(cg.min.x + cg.min.w / 2)} max=${r1(cg.max.x + cg.max.w / 2)}`,
      );
      expect(Number(c[0]), "min never crosses max").toBeLessThan(Number(c[1]));
      expect(Number(c[1]) - Number(c[0]), "the clamp parks it exactly one step short").toBe(step);
      expect(c[1], "the neighbour never moved").toBe(k1[1]);
      expect(
        Math.abs(cg.min.x + cg.min.w / 2 - (cg.max.x + cg.max.w / 2)),
        "the two thumbs never share a pixel (both stay grabbable)",
      ).toBeGreaterThan(1);

      await shot(page, w, `${SHOT_DIR}/${qid}-${width}-clamped.png`);
    }

    // from_to's labelled number fields are the SAME value as the rails.
    const ft = wrapFor(page, "p4_fromto");
    const fromV = await ft.locator(".lg-range-from").inputValue();
    const toV = await ft.locator(".lg-range-to").inputValue();
    const railV = [
      await ft.locator(".lg-range-input-dual").nth(0).inputValue(),
      await ft.locator(".lg-range-input-dual").nth(1).inputValue(),
    ];
    say(`FROM_TO @${width} fields mirror the rails: fields=[${fromV},${toV}] rails=[${railV.join(",")}]`);
    expect([fromV, toV]).toEqual(railV);
  });

  test(`radial: a real ring drag AND real keys move the arc, the handle and the centre at ${width}`, async ({ page }) => {
    await openFunnel(page, width);
    const w = wrapFor(page, "p4_radial");
    const outer = w.locator(".lg-range-radial-outer");
    const handle = w.locator(".lg-range-radial-handle");
    const centre = w.locator(".lg-range-radial-inner");
    const input = w.locator(".lg-range-radial-input");

    const ob = await inView(page, outer);
    const cx = ob.x + ob.w / 2;
    const cy = ob.y + ob.h / 2;
    const ringR = ob.w / 2 - 9; // mid-band of the ring

    say(`RADIAL @${width} dial box: centre=(${r1(cx)},${r1(cy)}) ring r=${r1(ringR)} size=${r1(ob.w)}x${r1(ob.h)}`);
    const deg0 = await styleOf(outer, "--lg-deg");
    const v0 = await input.inputValue();
    const txt0 = (await centre.textContent()) ?? "";
    const h0 = await bbox(handle);

    // ---- KEYBOARD first: the defect S4a handed over is that the ARC did not
    // follow the value even though the centre did.
    await keyOn(page, input, "ArrowRight", 10);
    const degK = await styleOf(outer, "--lg-deg");
    const vK = await input.inputValue();
    const txtK = (await centre.textContent()) ?? "";
    const hK = await bbox(handle);
    say(
      `RADIAL @${width} KEYS(10x Right): value ${v0}->${vK} centre "${txt0}"->"${txtK}" ` +
        `--lg-deg ${deg0}->${degK} handle (${r1(h0.x)},${r1(h0.y)})->(${r1(hK.x)},${r1(hK.y)}) ` +
        `aria-valuenow=${await input.getAttribute("aria-valuenow")}`,
    );
    expect(Number(vK)).toBe(Number(v0) + 10);
    expect(txtK).toBe(vK);
    expect(degK, "the ARC angle followed the value (S4a's open defect)").not.toBe(deg0);
    expect(Math.round(parseFloat(degK))).toBe(Math.round((Number(vK) / 100) * 360));
    expect(Math.hypot(hK.x - h0.x, hK.y - h0.y), "the ring handle moved with the arc").toBeGreaterThan(2);
    expect(await input.getAttribute("aria-valuenow")).toBe(vK);
    await shot(page, w, `${SHOT_DIR}/radial-${width}-after-keys.png`);

    // ---- POINTER DRAG around the ring: 3 o'clock (25) -> 6 o'clock (50).
    // Focusing the input above may have scrolled the page — re-measure the dial
    // so the ring coordinates are the ones actually on screen.
    const ob2 = await inView(page, outer);
    const cx2 = ob2.x + ob2.w / 2;
    const cy2 = ob2.y + ob2.h / 2;
    const rr = ob2.w / 2 - 9;
    await dragTo(page, { x: cx2 + rr, y: cy2 }, { x: cx2, y: cy2 + rr });
    const degD = await styleOf(outer, "--lg-deg");
    const vD = await input.inputValue();
    const txtD = (await centre.textContent()) ?? "";
    const hD = await bbox(handle);
    say(
      `RADIAL @${width} RING DRAG (3 o'clock -> 6 o'clock): value ${vK}->${vD} centre "${txtK}"->"${txtD}" ` +
        `--lg-deg ${degK}->${degD} handle (${r1(hK.x)},${r1(hK.y)})->(${r1(hD.x)},${r1(hD.y)}) dial=${r1(ob.w)}x${r1(ob.h)}`,
    );
    expect(vD, "a drag to 6 o'clock is half the 0..100 rail").toBe("50");
    expect(txtD).toBe("50");
    expect(Math.round(parseFloat(degD))).toBe(180);
    // The handle sits ON the ring at the dragged angle (6 o'clock = below centre).
    expect(hD.y + hD.h / 2, "the ring handle is at the bottom of the dial").toBeGreaterThan(cy2 + rr * 0.8);
    expect(Math.abs(hD.x + hD.w / 2 - cx2), "…and on the vertical centre line").toBeLessThan(3);

    // A quarter turn back to 9 o'clock = 75.
    await dragTo(page, { x: cx2, y: cy2 + rr }, { x: cx2 - rr, y: cy2 });
    const vD2 = await input.inputValue();
    const degD2 = await styleOf(outer, "--lg-deg");
    say(`RADIAL @${width} RING DRAG (6 -> 9 o'clock): value ${vD}->${vD2} --lg-deg ${degD}->${degD2} centre="${await centre.textContent()}"`);
    expect(vD2).toBe("75");
    expect(Math.round(parseFloat(degD2))).toBe(270);
    expect(await centre.textContent()).toBe("75");
    expect(await input.getAttribute("aria-valuenow")).toBe("75");

    // The conic arc itself (not just the variable) resolves to the new sweep.
    const bg = await styleOf(outer, "background-image");
    say(`RADIAL @${width} arc: ${bg.slice(0, 96)}…`);
    expect(bg).toContain("270deg");

    // The dial carries exactly ONE slider landmark and it is the real control.
    const roles = await w.locator('[role="slider"]').count();
    const tag = await w.locator('[role="slider"]').first().evaluate((el) => (el as Element).tagName.toLowerCase());
    say(`RADIAL @${width} a11y: role=slider count=${roles} on <${tag}> aria-hidden(dial)=${await outer.getAttribute("aria-hidden")}`);
    expect(roles).toBe(1);
    expect(tag).toBe("input");
    await shot(page, w, `${SHOT_DIR}/radial-${width}-after-drag.png`);
  });
}

test("an all-five sheet after every type has been driven", async ({ page }) => {
  await openFunnel(page, 1280);
  const card = page.locator(".lg-question-card").filter({ hasText: HEADLINE }).first();
  await shot(page, card, `${SHOT_DIR}/all-five-1280-driven.png`);
  await openFunnel(page, 375);
  await shot(page, page.locator(".lg-question-card").filter({ hasText: HEADLINE }).first(), `${SHOT_DIR}/all-five-375-driven.png`);
  say("all-five sheets captured at 1280 and 375");
});
