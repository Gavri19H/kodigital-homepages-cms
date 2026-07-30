// R2 P4 — the FIVE DRAG RECORDINGS contract §5.5 names ("the five built
// renders placed beside their pinned images … as HUMAN side-by-sides + five
// drag recordings"). One video per slider type, each a REAL pointer drag
// (mouse.down → a stream of moves → up) on the live public runtime, so the
// human reviewing the pack watches the readout / handle / fill / arc track the
// pointer instead of reading a static frame.
//
// Output: docs/leadgen/r2/evidence/p4/pack/drag-<type>.webm — playwright's own
// video capture (test.use video:on), saved off the page's video handle.
//
// Prerequisites (mission smoke lane, not CI): the r2fix fixture seeded
// (npm run seed:leadgen-fixture) against the same dev server.

import { test, expect, request as playwrightRequest, type Page, type Locator } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { PW_PORT } from "./utils/base-url";

// The admin plane is host-gated to ADMIN_HOST, and under the DOCUMENTED runner
// that host is 127.0.0.1 — playwright.config.ts:281 launches wrangler with
// `--var ADMIN_HOST:127.0.0.1`, and a CLI --var OVERRIDES wrangler.toml's
// `ADMIN_HOST = "localhost"`. DO NOT flip this to localhost.
const ORIGIN = `http://127.0.0.1:${PW_PORT}`;
const SITE_HOST = "r2fix.e2e.test";
const FUNNEL_SLUG = "r2fix";
const PACK_DIR = "../docs/leadgen/r2/evidence/p4/pack";
const HEADLINE = "P4 sliders — all five";

const REAL_CHROME_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

test.use({
  launchOptions: { args: ["--host-resolver-rules=MAP *.e2e.test 127.0.0.1"] },
  userAgent: REAL_CHROME_UA,
  viewport: { width: 1280, height: 900 },
  video: { mode: "on", size: { width: 1280, height: 900 } },
});
test.describe.configure({ mode: "serial" });

// The SAME five authored sliders S4a/S4b drove (identical qids/fields/values).
const SLIDERS = [
  { type: "single", qid: "p4_single", field: "p4_loan_amount", label: "Single — Loan amount", min: 0, max: 100, def: 37, step: 1, currency: true },
  { type: "stepper", qid: "p4_stepper", field: "p4_coverage_step", label: "Stepper — Coverage", min: 5000, max: 500000, def: 170000, step: 5000, currency: true },
  { type: "from_to", qid: "p4_fromto", field: "p4_price_band", label: "From / To — Price band", min: 0, max: 100000, def: null, step: 5000, currency: true },
  { type: "dual_range", qid: "p4_dual", field: "p4_deductible", label: "Dual range — Deductible", min: 0, max: 100, def: null, step: 1, currency: false },
  { type: "radial", qid: "p4_radial", field: "p4_driver_age", label: "Radial — Age", min: 0, max: 100, def: 45, step: 1, currency: false },
] as const;

interface SectionRow { id: number; public_id: string; section_name: string }

test.beforeAll(async () => {
  mkdirSync(PACK_DIR, { recursive: true });
  const ctx = await playwrightRequest.newContext({ baseURL: ORIGIN });
  const body = (await (await ctx.get("/api/admin/leadgen/sections?activity=r2fix_activity")).json()) as {
    items: SectionRow[];
  };
  const section = body.items.find((s) => s.section_name === "R2Fix Fixture Carrier Buttons");
  if (section === undefined) throw new Error("fixture section missing — run npm run seed:leadgen-fixture");
  const offers = (await (await ctx.get("/api/admin/leadgen/offers?activity=r2fix_activity")).json()) as {
    items: Array<{ id: number; offer_name: string }>;
  };
  const offer = offers.items.find((o) => o.offer_name === "R2Fix Fixture Offer");
  if (offer === undefined) throw new Error("fixture offer missing — run npm run seed:leadgen-fixture");
  const res = await ctx.patch(`/api/admin/leadgen/sections/${section.public_id}`, {
    data: {
      content_json: JSON.stringify({
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
      }),
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
  if (res.status() !== 200) throw new Error(`authoring save failed: ${res.status()} ${(await res.text()).slice(0, 400)}`);
  const quotes = (await (await ctx.get("/api/admin/leadgen/quotes?activity=r2fix_activity")).json()) as {
    items: Array<{ public_id: string; quote_name: string }>;
  };
  const quote = quotes.items.find((q) => q.quote_name === "R2Fix Fixture Quote")!;
  const sites = (await (await ctx.get("/api/admin/sites")).json()) as { resource?: Array<{ id: string; domain: string }> };
  const site = (sites.resource ?? []).find((s) => s.domain === SITE_HOST)!;
  await new Promise((r) => setTimeout(r, 1100));
  const act = await ctx.put(`/api/admin/leadgen/quotes/${quote.public_id}/activation/${site.id}`, {
    data: { enabled: true, slug: FUNNEL_SLUG },
  });
  if (act.status() !== 200) throw new Error(`activation re-save failed: ${act.status()} ${(await act.text()).slice(0, 400)}`);
  await ctx.dispose();
});

// The video only finalizes once the page is closed, so close it here and save
// the handle under the pack's stable per-type filename.
let CURRENT_TYPE = "";
test.afterEach(async ({ page }) => {
  const video = page.video();
  await page.close();
  if (video !== null) {
    const dest = `${PACK_DIR}/drag-${CURRENT_TYPE}.webm`;
    await video.saveAs(dest);
    console.log(`RECORDING drag-${CURRENT_TYPE} -> ${dest}`);
  }
});

async function openFunnel(page: Page): Promise<void> {
  await page.goto(`http://${SITE_HOST}:${PW_PORT}/lg/${FUNNEL_SLUG}?_cb=${Date.now()}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => (window as unknown as { __LG_ENGINE__?: unknown }).__LG_ENGINE__ !== undefined);
  for (let i = 0; i < 6; i += 1) {
    if (await page.getByText(HEADLINE).first().isVisible()) break;
    await page.locator("[data-lg-continue]:visible").first().click({ timeout: 2500 }).catch(() => undefined);
    await page.waitForTimeout(600);
  }
  await expect(page.getByText(HEADLINE).first()).toBeVisible();
}

interface Box { x: number; y: number; w: number; h: number }
async function bbox(l: Locator): Promise<Box> {
  const b = await l.boundingBox();
  if (b === null) throw new Error("element has no box (not rendered)");
  return { x: b.x, y: b.y, w: b.width, h: b.height };
}
async function inView(page: Page, l: Locator): Promise<Box> {
  await l.evaluate((el) => (el as Element).scrollIntoView({ block: "center" }));
  await page.waitForTimeout(400);
  return bbox(l);
}

/** A REAL, SLOW pointer drag: press, stream moves (visible in the video), release. */
async function slowDrag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, hops = 5): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.waitForTimeout(250);
  await page.mouse.down();
  for (let i = 1; i <= hops; i += 1) {
    await page.mouse.move(from.x + ((to.x - from.x) * i) / hops, from.y + ((to.y - from.y) * i) / hops, { steps: 8 });
    await page.waitForTimeout(150);
  }
  await page.mouse.up();
  await page.waitForTimeout(400);
}

function wrapFor(page: Page, qid: string): Locator {
  return page.locator(`[data-lg-question="${qid}"]`).first();
}

// --- single / stepper: ONE handle riding ONE track ---------------------------
for (const qid of ["p4_single", "p4_stepper"] as const) {
  const type = qid === "p4_single" ? "single" : "stepper";
  test(`drag recording — ${type}`, async ({ page }) => {
    CURRENT_TYPE = type;
    await openFunnel(page);
    const w = wrapFor(page, qid);
    await inView(page, w);
    const track = await bbox(w.locator(".lg-range-track"));
    const handle = await bbox(w.locator(".lg-range-handle"));
    const readout = w.locator(".lg-range-value").first();
    const before = await readout.textContent();
    await slowDrag(
      page,
      { x: handle.x + handle.w / 2, y: handle.y + handle.h / 2 },
      { x: track.x + track.w * 0.82, y: track.y + track.h / 2 },
    );
    const after = await readout.textContent();
    console.log(`${type} drag: readout "${before}" -> "${after}"`);
    expect(after, "the readout followed the pointer").not.toBe(before);
  });
}

// --- from_to / dual_range: TWO handles on ONE track --------------------------
for (const qid of ["p4_fromto", "p4_dual"] as const) {
  const type = qid === "p4_fromto" ? "from_to" : "dual_range";
  test(`drag recording — ${type}`, async ({ page }) => {
    CURRENT_TYPE = type;
    await openFunnel(page);
    const w = wrapFor(page, qid);
    await inView(page, w);
    const track = await bbox(w.locator(".lg-range-track"));
    const rails = w.locator(".lg-range-input-dual");
    const pills = w.locator(".lg-range-handle-value");
    const before = await pills.allTextContents();

    const hMax = await bbox(w.locator(".lg-range-handle-max"));
    await slowDrag(
      page,
      { x: hMax.x + hMax.w / 2, y: hMax.y + hMax.h / 2 },
      { x: track.x + track.w * 0.68, y: track.y + track.h / 2 },
    );
    const hMin = await bbox(w.locator(".lg-range-handle-min"));
    await slowDrag(
      page,
      { x: hMin.x + hMin.w / 2, y: hMin.y + hMin.h / 2 },
      { x: track.x + track.w * 0.24, y: track.y + track.h / 2 },
    );
    const after = await pills.allTextContents();
    const vals = [await rails.nth(0).inputValue(), await rails.nth(1).inputValue()];
    console.log(`${type} drag: pills [${before.join(" , ")}] -> [${after.join(" , ")}] rails=[${vals.join(",")}]`);
    expect(after[0], "the min pill followed its handle").not.toBe(before[0]);
    expect(after[1], "the max pill followed its handle").not.toBe(before[1]);
  });
}

// --- radial: the ring drag ---------------------------------------------------
test("drag recording — radial", async ({ page }) => {
  CURRENT_TYPE = "radial";
  await openFunnel(page);
  const w = wrapFor(page, "p4_radial");
  const outer = w.locator(".lg-range-radial-outer");
  const centre = w.locator(".lg-range-radial-inner");
  const ob = await inView(page, outer);
  const cx = ob.x + ob.w / 2;
  const cy = ob.y + ob.h / 2;
  const rr = ob.w / 2 - 9; // mid-band of the ring
  const before = (await centre.textContent()) ?? "";
  const deg0 = await outer.evaluate((el) => getComputedStyle(el as Element).getPropertyValue("--lg-deg").trim());
  // 3 o'clock -> 6 o'clock, hop by hop around the ring so the arc sweeps.
  await page.mouse.move(cx + rr, cy);
  await page.waitForTimeout(250);
  await page.mouse.down();
  for (let i = 1; i <= 6; i += 1) {
    const a = (Math.PI / 2) * (i / 6);
    await page.mouse.move(cx + rr * Math.cos(a), cy + rr * Math.sin(a), { steps: 6 });
    await page.waitForTimeout(150);
  }
  await page.mouse.up();
  await page.waitForTimeout(400);
  const after = (await centre.textContent()) ?? "";
  const deg1 = await outer.evaluate((el) => getComputedStyle(el as Element).getPropertyValue("--lg-deg").trim());
  console.log(`radial drag: centre "${before}" -> "${after}" ; --lg-deg ${deg0} -> ${deg1}`);
  expect(after, "the centre value followed the ring drag").toBe("50");
  expect(deg1, "the arc angle followed the ring drag").not.toBe(deg0);
});
