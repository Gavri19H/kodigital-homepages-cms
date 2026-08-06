// R2 P4 FIX-FIRST — the two MAJOR visitor-facing from_to defects the phase's
// adversarial review DROVE and measured (docs/leadgen/r2/evidence/p4/review/).
// Both are proven the only way they can be proven: a REAL visitor on the live
// public runtime, then the number the SERVER actually received.
//
//   F-1 (money path) — a TYPED from_to value was silently replaced. Review
//     drive: To=40000, the visitor types 90000 into "From ($)"; the box kept
//     reading 90000 while the rails/pills and the live auction row carried
//     35000 (the one-step clamp). The buyer is billed a number the visitor
//     never chose and can still see contradicted on screen.
//     GATE: the From box's OWN value === the value in the /lg/auction payload.
//
//   F-2 (E6) — driving the min handle to the clamp at 375 pushed the min pill
//     off-card: review measured minPill x=319.1..393.0, documentElement
//     .scrollWidth=393 vs innerWidth=375 (18px overflow), pill visibly cut.
//     The CSS comment claimed the inward anchor "keeps its readout fully
//     on-card at both viewports" — true at rest, FALSE when driven.
//     GATE: scrollWidth <= innerWidth AND every pill inside the card, measured
//     AFTER the drive, at 375 AND 1280.
//
// Prerequisites (mission smoke lane, not CI): the r2fix fixture seeded
// (npm run seed:leadgen-fixture) against the same dev server.

import { test, expect, request as playwrightRequest, type Page, type Locator } from "@playwright/test";
import { appendFileSync, mkdirSync } from "node:fs";
import { PW_PORT } from "./utils/base-url";

// The admin plane is host-gated to ADMIN_HOST, and under the DOCUMENTED runner
// that host is 127.0.0.1 — playwright.config.ts:281 launches wrangler with
// `--var ADMIN_HOST:127.0.0.1`, and a CLI --var OVERRIDES wrangler.toml's
// `ADMIN_HOST = "localhost"`. DO NOT flip this to localhost.
const ORIGIN = `http://127.0.0.1:${PW_PORT}`;
const SITE_HOST = "r2fix.e2e.test";
const FUNNEL_SLUG = "r2fix";
const SHOT_DIR = "../docs/leadgen/r2/evidence/p4/fixfirst";
const LOG = `${SHOT_DIR}/measurements.txt`;
const HEADLINE = "P4 fix-first — from_to";

// Distinctive field base (fixture-distinction guard, contract §2): the two
// sub-fields the engine derives are FT_FIELD_min / FT_FIELD_max.
const FT_QID = "p4ff_fromto";
const FT_FIELD = "p4ff_price_band";
const FT_MIN_FIELD = `${FT_FIELD}_min`;
const STEP = 5000;
const MAXV = 100000;
const TO_VALUE = 40000;
const TYPED_FROM = 90000; // out of order on purpose — the clamp lands at 35000

const REAL_CHROME_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

test.use({
  launchOptions: { args: ["--host-resolver-rules=MAP *.e2e.test 127.0.0.1"] },
  userAgent: REAL_CHROME_UA,
});
test.describe.configure({ mode: "serial" });

mkdirSync(SHOT_DIR, { recursive: true });
function say(line: string): void {
  console.log(line);
  appendFileSync(LOG, `${line}\n`);
}

interface SectionRow { id: number; public_id: string; section_name: string }
let SECTION: SectionRow;

test.beforeAll(async () => {
  say(`=== P4 FIX-FIRST drive ${new Date().toISOString()} ===`);
  const ctx = await playwrightRequest.newContext({ baseURL: ORIGIN });
  const quotes = (await (await ctx.get("/api/admin/leadgen/quotes?activity=r2fix_activity")).json()) as {
    items: Array<{ public_id: string; quote_name: string }>;
  };
  const quote = quotes.items.find((q) => q.quote_name === "R2Fix Fixture Quote");
  if (quote === undefined) throw new Error("fixture quote missing — run npm run seed:leadgen-fixture");
  const body = (await (await ctx.get("/api/admin/leadgen/sections?activity=r2fix_activity")).json()) as {
    items: SectionRow[];
  };
  const found = body.items.find((s) => s.section_name === "R2Fix Fixture Carrier Buttons");
  if (found === undefined) throw new Error("fixture section missing — run npm run seed:leadgen-fixture");
  SECTION = found;

  const offers = (await (await ctx.get("/api/admin/leadgen/offers?activity=r2fix_activity")).json()) as {
    items: Array<{ id: number; offer_name: string }>;
  };
  const offer = offers.items.find((o) => o.offer_name === "R2Fix Fixture Offer");
  if (offer === undefined) throw new Error("fixture offer missing — run npm run seed:leadgen-fixture");

  const res = await ctx.patch(`/api/admin/leadgen/sections/${SECTION.public_id}`, {
    data: {
      content_json: JSON.stringify({
        components: [
          { type: "QuestionHeadline", question_id: "p4ff_head", props: { text: HEADLINE } },
          {
            type: "NumberRangeQuestion",
            question_id: FT_QID,
            question_key: FT_FIELD,
            internal_field: FT_FIELD,
            answer_type: "number",
            props: {
              label: "From / To — Price band",
              slider_type: "from_to",
              min: 0,
              max: MAXV,
              step: STEP,
              currency_affix: true,
            },
          },
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
          { type: "ContinueButton", question_id: "p4ff_cont", props: { label: "Continue" } },
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
        // NOTE: the from_to sub-fields are deliberately NOT answer-mapped —
        // the fixture offer's ACTIVE payload schema only declares
        // lead.r2fix_carrier, and mapping an undeclared path makes the
        // activation preflight refuse the funnel (orphaned_provider_fields,
        // observed HTTP 409). The /lg/auction payload the client posts carries
        // EVERY recorded answer regardless of provider mapping, and that
        // payload is exactly the money-path artifact F-1 is about.
      ],
    },
  });
  say(`AUTHOR from_to section -> HTTP ${res.status()}`);
  if (res.status() !== 200) throw new Error(`authoring save failed: ${res.status()} ${(await res.text()).slice(0, 400)}`);

  // A SECTION save bumps only the section's content_version while the lg-shell
  // cache key carries the VARIANT's — re-saving the activation mints a fresh
  // key (activationVersion is unixepoch(), so cross a second boundary first).
  const sites = (await (await ctx.get("/api/admin/sites")).json()) as { resource?: Array<{ id: string; domain: string }> };
  const site = (sites.resource ?? []).find((s) => s.domain === SITE_HOST);
  if (site === undefined) throw new Error("fixture site missing — run npm run seed:leadgen-fixture");
  await new Promise((r) => setTimeout(r, 1100));
  const act = await ctx.put(`/api/admin/leadgen/quotes/${quote.public_id}/activation/${site.id}`, {
    data: { enabled: true, slug: FUNNEL_SLUG },
  });
  say(`  re-save activation -> HTTP ${act.status()}`);
  if (act.status() !== 200) throw new Error(`activation re-save failed: ${act.status()} ${(await act.text()).slice(0, 400)}`);
  await ctx.dispose();
});

// Each recorded answer is posted as { value, answer_source } (the wire shape
// the auction/provider log carries downstream).
interface AuctionPost { answers: Record<string, { value: unknown }> }
function captureAuction(page: Page): AuctionPost[] {
  const posts: AuctionPost[] = [];
  page.on("request", (req) => {
    if (req.method() !== "POST" || !req.url().includes("/lg/auction")) return;
    const body = req.postData();
    if (body === null) return;
    try {
      posts.push(JSON.parse(body) as AuctionPost);
    } catch {
      /* non-JSON body is not ours */
    }
  });
  return posts;
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

async function dragTo(page: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 6 });
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(150);
}

// ---------------------------------------------------------------------------
// F-1 — the typed box and the recorded/auctioned number must be the SAME number
//
// P6 C1 RE-RULED, at the COMMIT point (measured, not assumed). This test used
// to read the From box straight after fill() — i.e. WITH THE CARET STILL IN IT,
// since Playwright's fill() dispatches `input` and never `change` — and require
// it to already equal the payload. R2 P4 FIX-FIRST round 2 deliberately re-ruled
// exactly that instant: round 1's box-mirroring on every `input` was itself the
// N-1 regression ("syncDualRange rewrote the box under the caret on every
// `input`, which committed the one-step anti-deadlock clamp into that box and
// made most intended numbers unreachable ('6' -> '40000' -> '400000' -> max)").
//
// P8 (ADJ-P8-51 / slice J1, docs/leadgen/r2/P8-REGISTER.md) went further and
// REMOVED the FIX-FIRST-2 "every keystroke bakes in the one-step anti-deadlock
// clamp" behaviour this comment used to describe: "a TYPED out-of-order value
// is NEVER silently rewritten" for values that do not actually invert order,
// and a GENUINE ordering conflict (this test's case: From typed above the
// committed To) now corrects — at commit — to the NEIGHBOUR's EXACT value, not
// a step-separated grid number (P8-REGISTER ADJ-P8-51: "a genuine ordering
// conflict corrects to the neighbour's EXACT value … instead of the grid
// number"). Own-hand re-measurement at HEAD (this spec, silenced-assertion
// probe run): mid-typing (caret still in From, before blur) box=[90000,40000]
// rails=[40000,40000] pills=[$40,000 , $40,000] — the rail/pill already read
// the COINCIDENT value (40000, matching To exactly — the native
// `<input type=range>`'s own min/max sanitisation, not a code-level gap clamp),
// never the old 35000 one-step figure. At COMMIT (blur): box=[40000,40000]
// rails=[40000,40000] pills=[$40,000 , $40,000], and the real `POST /lg/auction`
// carries `p4ff_price_band_min:{"value":"40000"}` — box, rail, pill and payload
// are one number (40000), which is the money-path guarantee this test exists
// to gate; only the NUMBER changed (35000 -> 40000), never the equality.
// The superseding acceptance is leadgen-r2p4-fixround2-drive.spec.ts's N-1
// matrix (both fields x both viewports x type-up/type-down/clear-and-retype/
// paste/out-of-order, plus the provider-row payload), whose expectAgreement()
// is commented "F-1's guarantee at commit" and whose payload case 2 is this
// very out-of-order drive (re-minted alongside this file to the same 40000
// coincidence truth).
// ---------------------------------------------------------------------------
test("F-1: a typed out-of-order From is never silently replaced — at commit the box and the /lg/auction payload carry the same number", async ({
  page,
}) => {
  const posts = captureAuction(page);
  await openFunnel(page, 1280);

  const w = page.locator(`[data-lg-question="${FT_QID}"]`).first();
  await inView(page, w);
  const from = w.locator(".lg-range-from");
  const to = w.locator(".lg-range-to");
  const rails = w.locator(".lg-range-input-dual");
  const pills = w.locator(".lg-range-handle-value");

  // The review's exact drive: To=40000, then TYPE 90000 into From.
  await to.fill(String(TO_VALUE));
  await page.waitForTimeout(150);
  await from.fill(String(TYPED_FROM));
  await page.waitForTimeout(250);

  // (i) MID-TYPING (the caret is still in the From box; fill() dispatches
  // `input`, never `change`). P8-5/J1 removed the FIX-FIRST-2 gap clamp, so
  // mid-typing the rail/pill carry the COINCIDENT value (matching To exactly —
  // native range-input min/max sanitisation), never a subtracted step. Nothing
  // unseen can still be billed if the visitor submits right then, because the
  // coincident value IS what rail/pill/recorded-answer already show.
  const typingBoxFrom = await from.inputValue();
  const typingRails = [await rails.nth(0).inputValue(), await rails.nth(1).inputValue()];
  const typingPills = await pills.allTextContents();
  say(
    `F-1 mid-typing (caret in From): box=[${typingBoxFrom},${await to.inputValue()}] rails=[${typingRails.join(",")}] pills=[${typingPills.join(" , ")}]`,
  );
  expect(Number(typingRails[0]), "mid-typing, the rail ALREADY carries the coincident value (P8-5: no gap clamp)").toBe(
    TO_VALUE,
  );
  expect(
    typingPills[0],
    "mid-typing, the pill ALREADY reads the coincident value — nothing unseen can be billed",
  ).toBe(`$${TO_VALUE.toLocaleString("en-US")}`);

  // (ii) COMMIT — the real visitor gesture that ends the edit (blur; Enter is
  // the same `change`). This is where F-1's guarantee is defined and observable.
  await from.blur();
  await page.waitForTimeout(200);
  const boxFrom = await from.inputValue();
  const boxTo = await to.inputValue();
  const railV = [await rails.nth(0).inputValue(), await rails.nth(1).inputValue()];
  const pillV = await pills.allTextContents();
  say(`F-1 typed ${TYPED_FROM} into From (To=${TO_VALUE}), COMMITTED -> box=[${boxFrom},${boxTo}] rails=[${railV.join(",")}] pills=[${pillV.join(" , ")}]`);
  await page.screenshot({ path: `${SHOT_DIR}/f1-typed-1280.png`, fullPage: false });

  // Complete the funnel so the REAL auction carries the recorded answer.
  await page.locator('[data-lg-choice="acme_insurance"]').first().click();
  await page.locator("[data-lg-continue]:visible").first().click();
  await page.waitForTimeout(2500);
  const post = posts.find((p) => p.answers !== undefined);
  say(`F-1 /lg/auction answers = ${JSON.stringify(post?.answers ?? null)}`);
  expect(post, "the drive posted an auction").toBeTruthy();
  const payloadMin = String(post!.answers[FT_MIN_FIELD]?.value);
  say(`F-1 VERDICT: box="${boxFrom}" vs payload ${FT_MIN_FIELD}=${payloadMin} vs rail=${railV[0]} vs pill=${pillV[0]}`);

  // The genuine ordering conflict (From typed ABOVE the committed To) now
  // corrects to the NEIGHBOUR's EXACT value at commit (P8-5/J1 coincidence,
  // not the old FIX-FIRST-2 one-step-short grid clamp).
  expect(Number(railV[0]), "the genuine ordering conflict corrects to the neighbour's exact value").toBe(TO_VALUE);
  // The defect this test guards: the screen and the payload must never
  // disagree — asserted at COMMIT.
  expect(boxFrom, "the From box shows the number that was actually recorded").toBe(payloadMin);
  expect(boxFrom, "the From box agrees with its own rail").toBe(railV[0]);
  expect(pillV[0], "the min pill agrees with the box").toBe(`$${Number(boxFrom).toLocaleString("en-US")}`);
});

// ---------------------------------------------------------------------------
// F-2 — the pill stays on-card at EVERY handle position, measured AFTER driving
// ---------------------------------------------------------------------------
for (const width of [375, 1280] as const) {
  test(`F-2: driving the min handle to the clamp keeps every pill on-card at ${width}`, async ({ page }) => {
    await openFunnel(page, width);
    const w = page.locator(`[data-lg-question="${FT_QID}"]`).first();
    await inView(page, w);
    const track = w.locator(".lg-range-track");
    const rails = w.locator(".lg-range-input-dual");
    const pills = w.locator(".lg-range-handle-value");
    const hMin = w.locator(".lg-range-handle-min");

    const t = await bbox(track);
    const rest = await page.evaluate(() => ({
      sw: document.documentElement.scrollWidth,
      iw: window.innerWidth,
    }));
    say(`F-2 @${width} AT REST: scrollWidth=${rest.sw} innerWidth=${rest.iw}`);

    // DRIVE: press the min thumb where it sits and drag it past the track's
    // right end — the clamp parks it one step short of max (95000 of 100000).
    const nb = await bbox(hMin);
    await dragTo(page, { x: nb.x + nb.w / 2, y: nb.y + nb.h / 2 }, { x: t.x + t.w + 120, y: t.y + t.h / 2 });
    const railV = [await rails.nth(0).inputValue(), await rails.nth(1).inputValue()];
    expect(Number(railV[1]) - Number(railV[0]), "the drive reached the one-step clamp").toBe(STEP);

    const boxes = await pills.evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.x, right: r.right, y: r.y, w: r.width };
      }),
    );
    const driven = await page.evaluate(() => ({
      sw: document.documentElement.scrollWidth,
      iw: window.innerWidth,
      // "on-card" = the frame's section-slot card (frame.ts renderSlotRegion),
      // the painted box the pill must never leave.
      card: (() => {
        const c = document.querySelector(".lg-frame-slot") ?? document.querySelector(".lg-content");
        const r = (c ?? document.body).getBoundingClientRect();
        return { left: r.left, right: r.right };
      })(),
    }));
    say(
      `F-2 @${width} AFTER DRIVE rails=[${railV.join(" , ")}] pills=[${(await pills.allTextContents()).join(" , ")}]`,
    );
    say(
      `  minPill x=${r1(boxes[0]!.x)}..${r1(boxes[0]!.right)} | maxPill x=${r1(boxes[1]!.x)}..${r1(boxes[1]!.right)} ` +
        `| track x=${r1(t.x)}..${r1(t.x + t.w)} | card x=${r1(driven.card.left)}..${r1(driven.card.right)}`,
    );
    say(`  OVERFLOW: scrollWidth=${driven.sw} innerWidth=${driven.iw} overflowPx=${Math.max(0, driven.sw - driven.iw)}`);
    await page.screenshot({ path: `${SHOT_DIR}/f2-clamped-${width}.png`, fullPage: false });

    expect(driven.sw, `no horizontal overflow after driving the min handle to the clamp at ${width}`).toBeLessThanOrEqual(
      driven.iw,
    );
    for (const [i, b] of boxes.entries()) {
      expect(b.x, `pill ${i} starts inside the card`).toBeGreaterThanOrEqual(driven.card.left - 0.5);
      expect(b.right, `pill ${i} ends inside the card`).toBeLessThanOrEqual(driven.card.right + 0.5);
    }
  });
}
