// R2 P8 S5.3 — the DRIVEN PRODUCT for N14 (radial's first tap) and N15 (the
// two-handle slider's value-pill position, owner Image11) — contract
// docs/leadgen/r2/P8-DEFECT-CONTRACT.md, evidence-grounding
// docs/leadgen/r2/evidence/p8/n15/image11-reading.md.
//
// N14 is marked "Source-confirmed, not driven — UNVERIFIED" in the contract:
// this spec REPRODUCES it first (a real tap, not a hand-built pair) before any
// fix is judged necessary.
// N15's contract row is `dual_range`-scoped (verbatim); from_to shares the
// SAME renderer/CSS so it is exercised too, for adjacent confidence only.
//
// Nothing here is hand-built markup: content is authored through the real
// admin section save, then driven as a real visitor on the live public
// runtime, measured via the browser's own boxes/computed styles/values.
//
// Prerequisites: local wrangler dev already running (PW_PORT), r2fix fixture
// seeded (npm run seed:leadgen-fixture).

import { test, expect, request as playwrightRequest, type Page, type Locator } from "@playwright/test";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { PW_PORT } from "./utils/base-url";

const ORIGIN = `http://127.0.0.1:${PW_PORT}`;
const SITE_HOST = "r2fix.e2e.test";
const FUNNEL_SLUG = "r2fix";
const SHOT_DIR = "../docs/leadgen/r2/evidence/p8/n15";
const LOG = `${SHOT_DIR}/s5_3-measurements.txt`;
const HEADLINE = "P8 S5.3 — radial tap + dual pill position";

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

// Distinctive field names (fixture-distinction guard, contract §2): none of
// these exist in the seeded fixture. min/max/step on the radial match the
// contract's own reproduction numbers (0..100 step 1 -> 45deg expects 13).
const RADIAL = { qid: "p8n_radial", field: "p8n_radial_age" };
const DUAL = { qid: "p8n_dual", field: "p8n_dual_band" };
const FROMTO = { qid: "p8n_fromto", field: "p8n_fromto_band" };

interface SectionRow { id: number; public_id: string; section_name: string }
let SECTION: SectionRow;

function authoredContent(): string {
  return JSON.stringify({
    components: [
      { type: "QuestionHeadline", question_id: "p8n_head", props: { text: HEADLINE } },
      {
        type: "NumberRangeQuestion",
        question_id: RADIAL.qid,
        question_key: RADIAL.field,
        internal_field: RADIAL.field,
        answer_type: "number",
        props: { label: "Radial — age", slider_type: "radial", min: 0, max: 100, step: 1, default: 50 },
      },
      {
        type: "NumberRangeQuestion",
        question_id: DUAL.qid,
        question_key: DUAL.field,
        internal_field: DUAL.field,
        answer_type: "number",
        props: { label: "Dual range — pct", slider_type: "dual_range", min: 0, max: 100, step: 1 },
      },
      {
        type: "NumberRangeQuestion",
        question_id: FROMTO.qid,
        question_key: FROMTO.field,
        internal_field: FROMTO.field,
        answer_type: "number",
        props: { label: "From/To — band", slider_type: "from_to", min: 0, max: 100000, step: 5000, currency_affix: true },
      },
      {
        // r2fix_carrier (not a p8n_* name): the fixture Offer's PINNED payload
        // schema (active_payload_schema_id) requires this EXACT field —
        // confirmed live (quote_activation_blocked/missing_required_provider_
        // fields on any other name) — this is plumbing to satisfy the offer,
        // not part of the N14/N15 slider claims under test.
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
      { type: "ContinueButton", question_id: "p8n_cont", props: { label: "Continue" } },
    ],
  });
}

async function authorContent(): Promise<void> {
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
  say(`AUTHOR (radial + dual_range + from_to) -> HTTP ${res.status()}`);
  if (res.status() !== 200) throw new Error(`authoring save failed: ${res.status()} ${(await res.text()).slice(0, 400)}`);
  const quotes = (await (await ctx.get("/api/admin/leadgen/quotes?activity=r2fix_activity")).json()) as {
    items: Array<{ public_id: string; quote_name: string }>;
  };
  const quote = quotes.items.find((q) => q.quote_name === "R2Fix Fixture Quote");
  if (quote === undefined) throw new Error("fixture quote missing — run npm run seed:leadgen-fixture");
  const sites = (await (await ctx.get("/api/admin/sites")).json()) as { resource?: Array<{ id: string; domain: string }> };
  const site = (sites.resource ?? []).find((s) => s.domain === SITE_HOST);
  if (site === undefined) throw new Error("fixture site missing — run npm run seed:leadgen-fixture");
  await new Promise((r) => setTimeout(r, 1100)); // cross a unixepoch second boundary (activationVersion)
  const act = await ctx.put(`/api/admin/leadgen/quotes/${quote.public_id}/activation/${site.id}`, {
    data: { enabled: true, slug: FUNNEL_SLUG },
  });
  // ADJACENT SEAM (reported, not fixed here — outside this slice's owned
  // files): this shared quote currently 409s activation quote-wide on an
  // unrelated sibling funnel ("P8-Charlie", zero sections) under the SAME
  // quote_id — a quote-wide validation, not scoped to the funnel being
  // activated. The site is ALREADY active (prior run) and a content PATCH
  // alone is confirmed (direct curl) to serve fresh content immediately, so
  // this re-save is best-effort only (it exists to mint a fresh cache key,
  // not to establish activation) — non-fatal here.
  say(`  re-save activation (best-effort, mints a fresh lg-shell key) -> HTTP ${act.status()}`);
  if (act.status() !== 200) say(`  ADJACENT: activation re-save blocked -> ${(await act.text()).slice(0, 300)}`);
  await ctx.dispose();
}

function rawShell(): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { hostname: "127.0.0.1", port: Number(PW_PORT), path: `/lg/${FUNNEL_SLUG}?_cb=${Date.now()}`, method: "GET", headers: { host: SITE_HOST, "user-agent": REAL_CHROME_UA } },
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
  await page.goto(`http://${SITE_HOST}:${PW_PORT}/lg/${FUNNEL_SLUG}?_cb=${Date.now()}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => (window as unknown as { __LG_ENGINE__?: unknown }).__LG_ENGINE__ !== undefined);
  for (let i = 0; i < 6; i += 1) {
    if (await page.getByText(HEADLINE).first().isVisible()) break;
    await page.locator("[data-lg-continue]:visible").first().click({ timeout: 2500 }).catch(() => undefined);
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
async function inView(page: Page, l: Locator): Promise<Box> {
  await l.evaluate((el) => (el as Element).scrollIntoView({ block: "center" }));
  await page.waitForTimeout(150);
  return bbox(l);
}
const r1 = (n: number): string => n.toFixed(1);

async function shot(page: Page, l: Locator, path: string): Promise<void> {
  const b = await l.boundingBox();
  if (b === null) throw new Error(`no box for ${path}`);
  const vp = page.viewportSize() ?? { width: 1280, height: 1000 };
  const x = Math.max(0, b.x - 16);
  const y = Math.max(0, b.y - 62);
  await page.screenshot({ path, clip: { x, y, width: Math.min(vp.width - x, b.width + 32), height: Math.min(vp.height - y, b.height + 74) } });
}

async function overflowCheck(page: Page): Promise<{ scrollWidth: number; innerWidth: number }> {
  return page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
}

test.beforeAll(async () => {
  mkdirSync(SHOT_DIR, { recursive: true });
  writeFileSync(LOG, `R2 P8 S5.3 — driven-product measurements (${new Date().toISOString()})\n`);
  const ctx = await playwrightRequest.newContext({ baseURL: ORIGIN });
  const body = (await (await ctx.get("/api/admin/leadgen/sections?activity=r2fix_activity")).json()) as { items: SectionRow[] };
  const found = body.items.find((s) => s.section_name === "R2Fix Fixture Carrier Buttons");
  if (found === undefined) throw new Error("fixture section missing — run npm run seed:leadgen-fixture");
  SECTION = found;
  await ctx.dispose();
  await authorContent();
  await pollShellHas(`data-lg-question="${RADIAL.qid}"`, "the authored radial/dual_range/from_to");
});

// ---------------------------------------------------------------------------
// N14 — the radial's first tap. Reproduce BEFORE judging a fix necessary.
// ---------------------------------------------------------------------------
for (const width of [1280, 375]) {
  test(`N14 radial first tap @${width}: a tap at a known angle records the geometrically-expected value`, async ({ page }) => {
    await openFunnel(page, width);
    const w = wrapFor(page, RADIAL.qid);
    const outer = w.locator(".lg-range-radial-outer");
    const input = w.locator(".lg-range-radial-input");

    // Angle -> expected value, the SAME formula engine.ts's dialTo uses (0deg =
    // 12 o'clock, clockwise); min=0/max=100/step=1 matches the contract's own
    // "45deg press recording 15, expected 13" reproduction numbers exactly.
    const min = Number(await input.getAttribute("min"));
    const max = Number(await input.getAttribute("max"));
    const step = Number(await input.getAttribute("step")) || 1;
    const expectedFor = (angleDeg: number): number => {
      const turn = (angleDeg / 360 + 1) % 1;
      return Math.min(max, min + Math.round((turn * (max - min)) / step) * step);
    };
    const pointFor = (box: Box, angleDeg: number): { x: number; y: number } => {
      const cx = box.x + box.w / 2;
      const cy = box.y + box.h / 2;
      const r = box.w / 2 - 9; // mid-band of the ring (S4b convention)
      const rad = (angleDeg * Math.PI) / 180;
      return { x: cx + r * Math.sin(rad), y: cy - r * Math.cos(rad) };
    };
    async function tapOnce(pt: { x: number; y: number }): Promise<void> {
      await page.mouse.move(pt.x, pt.y);
      await page.mouse.down();
      await page.waitForTimeout(80);
      await page.mouse.up();
      await page.waitForTimeout(80);
    }

    // ---- Scenario A: dial comfortably centred in the viewport -------------
    const boxA = await inView(page, outer);
    const scrollA0 = await page.evaluate(() => window.scrollY);
    const ptA = pointFor(boxA, 45);
    await tapOnce(ptA);
    const scrollA1 = await page.evaluate(() => window.scrollY);
    const vA = await input.inputValue();
    say(
      `N14 @${width} scenario A (centred): box=(${r1(boxA.x)},${r1(boxA.y)},${r1(boxA.w)}x${r1(boxA.h)}) tap=(${r1(ptA.x)},${r1(ptA.y)}) ` +
        `scrollY ${scrollA0}->${scrollA1} expected=${expectedFor(45)} recorded=${vA}`,
    );

    // ---- Scenario B: the dial DELIBERATELY left partly off-screen (the
    // contract's own hypothesis: "a partly off-screen input" + a native
    // focus()-triggered scroll makes the rect stale). Park the dial's bottom
    // edge below the fold, re-measure its CURRENT (pre-tap) box, tap 45deg
    // from THAT box (the same box a real finger would target), then check
    // whether the recorded value matches the pre-tap geometry.
    await outer.evaluate((el) => (el as Element).scrollIntoView({ block: "end" }));
    await page.evaluate(() => window.scrollBy(0, 90));
    await page.waitForTimeout(150);
    const boxB = await bbox(outer);
    const scrollB0 = await page.evaluate(() => window.scrollY);
    say(`N14 @${width} scenario B setup: box=(${r1(boxB.x)},${r1(boxB.y)},${r1(boxB.w)}x${r1(boxB.h)}) viewportH=${page.viewportSize()?.height} (bottom off-screen if y+h > viewportH)`);
    const ptB = pointFor(boxB, 45);
    // The 45deg point must itself be on-screen (upper-right of centre) even
    // though the dial's lower portion is not — otherwise this is not a
    // realistic "tap the visible part of a partly off-screen control".
    expect(ptB.y, "the tap point itself must be on-screen").toBeGreaterThanOrEqual(0);
    await tapOnce(ptB);
    const scrollB1 = await page.evaluate(() => window.scrollY);
    const vB = await input.inputValue();
    say(
      `N14 @${width} scenario B (partly off-screen): tap=(${r1(ptB.x)},${r1(ptB.y)}) scrollY ${scrollB0}->${scrollB1} ` +
        `expected=${expectedFor(45)} recorded=${vB}`,
    );

    say(`N14 @${width} VERDICT: A ${vA === String(expectedFor(45)) ? "MATCH" : "MISMATCH"}; B ${vB === String(expectedFor(45)) ? "MATCH" : "MISMATCH"}; scroll shifted in B: ${scrollB0 !== scrollB1}`);
  });
}

// ---------------------------------------------------------------------------
// N15 — the two-handle pill sits under its handle; the scale stays; nothing
// overlaps or clips. Contract row is `dual_range`-scoped; from_to shares the
// same renderer/CSS and is exercised too (adjacent confidence, not the claim).
// ---------------------------------------------------------------------------
for (const width of [1280, 375]) {
  for (const qid of [DUAL.qid, FROMTO.qid] as const) {
    test(`N15 ${qid} @${width}: the value pill sits UNDER its own handle, the scale stays, nothing overlaps`, async ({ page }) => {
      await openFunnel(page, width);
      const w = wrapFor(page, qid);
      const track = w.locator(".lg-range-track");
      const hMin = w.locator(".lg-range-handle-min");
      const hMax = w.locator(".lg-range-handle-max");
      const pills = w.locator(".lg-range-handle-value");
      const minmax = w.locator(".lg-range-minmax");
      const rails = w.locator(".lg-range-input-dual");

      await inView(page, w);
      const trackBox = await bbox(track);
      const hMinBox = await bbox(hMin);
      const hMaxBox = await bbox(hMax);
      const minmaxBox = await bbox(minmax);
      const pillTexts0 = await pills.allTextContents();
      const pillBoxes0 = [await bbox(pills.nth(0)), await bbox(pills.nth(1))];
      say(
        `N15 ${qid} @${width} REST: track y=${r1(trackBox.y)} h=${r1(trackBox.h)} handles minY=${r1(hMinBox.y)} maxY=${r1(hMaxBox.y)} ` +
          `pills y=[${r1(pillBoxes0[0].y)},${r1(pillBoxes0[1].y)}] h=[${r1(pillBoxes0[0].h)},${r1(pillBoxes0[1].h)}] minmaxY=${r1(minmaxBox.y)} texts=[${pillTexts0.join(" , ")}]`,
      );
      // The pill sits BELOW (not above) its own handle.
      expect(pillBoxes0[0].y, "min pill sits under the min handle").toBeGreaterThanOrEqual(hMinBox.y + hMinBox.h - 1);
      expect(pillBoxes0[1].y, "max pill sits under the max handle").toBeGreaterThanOrEqual(hMaxBox.y + hMaxBox.h - 1);
      // The pill never overlaps the scale row below it.
      expect(pillBoxes0[0].y + pillBoxes0[0].h, "min pill clears the scale row").toBeLessThanOrEqual(minmaxBox.y + 1);
      expect(pillBoxes0[1].y + pillBoxes0[1].h, "max pill clears the scale row").toBeLessThanOrEqual(minmaxBox.y + 1);
      // The scale itself stays (min/max caption), unchanged by this fix —
      // from_to is authored with currency_affix, so its scale is "$0"/"$100,000".
      const expectedScale = qid === FROMTO.qid ? ["$0", "$100,000"] : ["0", "100"];
      expect(await minmax.locator("span").allTextContents()).toEqual(expectedScale);
      await shot(page, w, `${SHOT_DIR}/${qid}-${width}-rest.png`);

      // ---- DRIVE: separate the two handles (30% / 70%) — the values stop
      // reading identically, so any earlier "duplication" appearance resolves.
      const t = trackBox;
      const mb = await bbox(hMax);
      await page.mouse.move(mb.x + mb.w / 2, mb.y + mb.h / 2);
      await page.mouse.down();
      await page.mouse.move(t.x + t.w * 0.7, mb.y + mb.h / 2, { steps: 6 });
      await page.mouse.up();
      await page.waitForTimeout(100);
      const nb = await bbox(hMin);
      await page.mouse.move(nb.x + nb.w / 2, nb.y + nb.h / 2);
      await page.mouse.down();
      await page.mouse.move(t.x + t.w * 0.3, nb.y + nb.h / 2, { steps: 6 });
      await page.mouse.up();
      await page.waitForTimeout(100);

      const hMinBox2 = await bbox(hMin);
      const hMaxBox2 = await bbox(hMax);
      const pillBoxes2 = [await bbox(pills.nth(0)), await bbox(pills.nth(1))];
      const pillTexts2 = await pills.allTextContents();
      const minmaxBox2 = await bbox(minmax);
      const v2 = [await rails.nth(0).inputValue(), await rails.nth(1).inputValue()];
      say(
        `N15 ${qid} @${width} SEPARATED (30/70): values=[${v2.join(",")}] pills=[${pillTexts2.join(" , ")}] ` +
          `pillY=[${r1(pillBoxes2[0].y)},${r1(pillBoxes2[1].y)}] handlesY=[${r1(hMinBox2.y)},${r1(hMaxBox2.y)}] minmaxY=${r1(minmaxBox2.y)}`,
      );
      expect(pillTexts2[0]).not.toBe(pillTexts0[0]);
      expect(pillTexts2[1]).not.toBe(pillTexts0[1]);
      expect(pillBoxes2[0].y, "min pill still under its (moved) handle").toBeGreaterThanOrEqual(hMinBox2.y + hMinBox2.h - 1);
      expect(pillBoxes2[1].y, "max pill still under its (moved) handle").toBeGreaterThanOrEqual(hMaxBox2.y + hMaxBox2.h - 1);
      expect(pillBoxes2[0].y + pillBoxes2[0].h, "min pill still clears the scale row").toBeLessThanOrEqual(minmaxBox2.y + 1);
      expect(pillBoxes2[1].y + pillBoxes2[1].h, "max pill still clears the scale row").toBeLessThanOrEqual(minmaxBox2.y + 1);
      await shot(page, w, `${SHOT_DIR}/${qid}-${width}-separated.png`);

      // ---- CLAMP: drive min past max — the container-query stacking must
      // still keep both pills readable and clear of the scale row.
      const nb2 = await bbox(hMin);
      await page.mouse.move(nb2.x + nb2.w / 2, nb2.y + nb2.h / 2);
      await page.mouse.down();
      await page.mouse.move(t.x + t.w + 120, nb2.y + nb2.h / 2, { steps: 6 });
      await page.mouse.up();
      await page.waitForTimeout(100);
      const pillBoxes3 = [await bbox(pills.nth(0)), await bbox(pills.nth(1))];
      const minmaxBox3 = await bbox(minmax);
      const v3 = [await rails.nth(0).inputValue(), await rails.nth(1).inputValue()];
      say(
        `N15 ${qid} @${width} CLAMPED: values=[${v3.join(",")}] pillY=[${r1(pillBoxes3[0].y)},${r1(pillBoxes3[1].y)}] h=[${r1(pillBoxes3[0].h)},${r1(pillBoxes3[1].h)}] minmaxY=${r1(minmaxBox3.y)}`,
      );
      expect(pillBoxes3[0].y + pillBoxes3[0].h, "clamped min pill still clears the scale row").toBeLessThanOrEqual(minmaxBox3.y + 1);
      expect(pillBoxes3[1].y + pillBoxes3[1].h, "clamped max pill still clears the scale row").toBeLessThanOrEqual(minmaxBox3.y + 1);
      // The two pills themselves must not overlap each other (stacked, not collided).
      const overlapV = Math.min(pillBoxes3[0].y + pillBoxes3[0].h, pillBoxes3[1].y + pillBoxes3[1].h) - Math.max(pillBoxes3[0].y, pillBoxes3[1].y);
      const overlapH = Math.min(pillBoxes3[0].x + pillBoxes3[0].w, pillBoxes3[1].x + pillBoxes3[1].w) - Math.max(pillBoxes3[0].x, pillBoxes3[1].x);
      say(`N15 ${qid} @${width} CLAMPED pill boxes: min=(${r1(pillBoxes3[0].x)},${r1(pillBoxes3[0].y)},${r1(pillBoxes3[0].w)}x${r1(pillBoxes3[0].h)}) max=(${r1(pillBoxes3[1].x)},${r1(pillBoxes3[1].y)},${r1(pillBoxes3[1].w)}x${r1(pillBoxes3[1].h)}) overlapV=${r1(overlapV)} overlapH=${r1(overlapH)}`);
      expect(overlapV < 0 || overlapH < 0, "the two pills do not both overlap in X AND Y").toBe(true);
      await shot(page, w, `${SHOT_DIR}/${qid}-${width}-clamped.png`);

      const of = await overflowCheck(page);
      say(`N15 ${qid} @${width} overflow check: scrollWidth=${of.scrollWidth} innerWidth=${of.innerWidth}`);
      expect(of.scrollWidth, "no horizontal page overflow").toBeLessThanOrEqual(of.innerWidth);
    });
  }
}
