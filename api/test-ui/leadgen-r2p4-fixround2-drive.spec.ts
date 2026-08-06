// R2 P4 FIX-FIRST round 2 — the DRIVEN PRODUCT for the two closure findings.
//
// The round-1 F-1 fix was proved against the REPORTED REPRO only (one final
// out-of-order value) and never against ordinary typing around it, so it
// shipped N-1: syncDualRange rewrote the box under the caret on every `input`,
// which committed the one-step anti-deadlock clamp into that box and made most
// intended numbers unreachable ("6" -> "40000" -> "400000" -> max). This spec
// therefore drives the WHOLE INTERACTION, not the bug report:
//
//   N-1  for BOTH from_to fields (From and To) x BOTH viewports (1280, 375):
//        type-up, type-down, clear-and-retype digit-by-digit, paste, and a
//        final out-of-order value — reading, after every step, (a) the field
//        text of BOTH boxes, (b) the rails and the pills, and — for the two
//        decisive cases — (c) the answer the buyer is actually billed for, read
//        back out of leadgen_provider_request_log via the live admin plane.
//   N-2  at the LOW clamp (both handles at the bottom of the track) the stacked
//        min pill must not cover the operator's question label, at 1280 and at
//        375, measured as real bounding boxes.
//
// Nothing here is hand-built markup: the slider is AUTHORED through the real
// admin section save and DRIVEN as a real visitor on the live public runtime.
//
// Prerequisites (mission smoke lane, not CI): local wrangler dev on PW_PORT
// with the r2fix fixture seeded (npm run seed:leadgen-fixture).

import { test, expect, request as playwrightRequest, type Page, type Locator } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { PW_PORT } from "./utils/base-url";

// The admin plane is host-gated to ADMIN_HOST, and under the DOCUMENTED runner
// that host is 127.0.0.1 (playwright.config.ts launches wrangler with
// `--var ADMIN_HOST:127.0.0.1`, and a CLI --var overrides wrangler.toml).
const ORIGIN = `http://127.0.0.1:${PW_PORT}`;
const SITE_HOST = "r2fix.e2e.test";
const FUNNEL_SLUG = "r2fix";
const SHOT_DIR = "../docs/leadgen/r2/evidence/p4/fix2";
const LOG = `${SHOT_DIR}/matrix.txt`;
const HEADLINE = "P4 fix-round-2 — from_to typing";
// Fixture-distinction (contract §2): neither this field nor these numbers exist
// in the seeded fixture, nor in S4a/S4b's or the review's authored sections.
const QID = "fr2_fromto";
const FIELD = "fr2_band";
const LABEL = "From / To — Price band";
const MIN = 0;
const MAX = 100000;
const STEP = 5000;

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

interface SectionRow { id: number; public_id: string; section_name: string }
let SECTION: SectionRow;

function authoredContent(): string {
  return JSON.stringify({
    components: [
      { type: "QuestionHeadline", question_id: "fr2_head", props: { text: HEADLINE } },
      {
        type: "NumberRangeQuestion",
        question_id: QID,
        question_key: FIELD,
        internal_field: FIELD,
        answer_type: "number",
        props: { label: LABEL, slider_type: "from_to", min: MIN, max: MAX, step: STEP, currency_affix: true },
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
      { type: "ContinueButton", question_id: "fr2_cont", props: { label: "Continue" } },
    ],
  });
}

/** Author the section + re-save the activation (ADJ-N20 stale-shell). */
async function authorFromTo(): Promise<void> {
  const ctx = await playwrightRequest.newContext({ baseURL: ORIGIN });
  const offers = (await (await ctx.get("/api/admin/leadgen/offers?activity=r2fix_activity")).json()) as {
    items: Array<{ id: number; public_id: string; offer_name: string }>;
  };
  const offer = offers.items.find((o) => o.offer_name === "R2Fix Fixture Offer");
  if (offer === undefined) throw new Error("fixture offer missing — run npm run seed:leadgen-fixture");
  // The band's two sub-fields must EXIST in the Offer's active payload schema
  // before a section answer_map may point at them (the activation preflight
  // 409s with `orphaned_provider_fields` otherwise) — so declare them the way
  // an operator would, as a new schema version, carrying the earlier versions'
  // fields forward so sibling specs' maps keep resolving.
  const schemas = (await (await ctx.get(`/api/admin/leadgen/offers/${offer.public_id}/payload-schemas`)).json()) as {
    items: Array<{
      version: number;
      schema_json: { root: { children: Array<Record<string, unknown>> } };
      carrier_parse_json: Record<string, unknown> | null;
    }>;
  };
  const latest = schemas.items.reduce((a, b) => (b.version > a.version ? b : a));
  const kids = latest.schema_json.root.children;
  // carrier_parse_json rides the VERSION, so a version saved without it makes
  // the offer ineligible (`carrier_parse_missing` at the activation preflight).
  // Carry the newest one that HAS it forward with the fields.
  const parse = schemas.items
    .slice()
    .sort((a, b) => b.version - a.version)
    .find((v) => v.carrier_parse_json !== null)?.carrier_parse_json ?? null;
  if (!kids.some((k) => k["path"] === `lead.${FIELD}_max`) || latest.carrier_parse_json === null) {
    const add = (f: string) => ({
      path: `lead.${f}`,
      name: f,
      type: "number",
      required: false,
      source: "answer",
      internal_field: f,
    });
    const kept = kids.filter((k) => k["path"] !== `lead.${FIELD}_min` && k["path"] !== `lead.${FIELD}_max`);
    const post = await ctx.post(`/api/admin/leadgen/offers/${offer.public_id}/payload-schemas`, {
      data: {
        schema_json: {
          version: latest.version + 1,
          root: { type: "object", children: [...kept, add(`${FIELD}_min`), add(`${FIELD}_max`)] },
        },
        ...(parse === null ? {} : { carrier_parse_json: parse }),
      },
    });
    say(`DECLARE ${FIELD}_min/_max in payload schema v${latest.version + 1} -> HTTP ${post.status()}`);
    if (post.status() >= 300) throw new Error(`schema save failed: ${post.status()} ${(await post.text()).slice(0, 400)}`);
  } else {
    say(`payload schema v${latest.version} already declares ${FIELD}_min/_max`);
  }
  // The band's two sub-fields are MAPPED into the provider payload: that is the
  // only way the buyer-visible number (c) can be read back per case.
  const map = (qid: string, field: string, type: string, atype: string, required: boolean) => ({
    question_id: qid,
    offer_id: offer.id,
    offer_payload_field_path: `lead.${field}`,
    provider_expected_type: type,
    required_for_offer: required,
    internal_field: field,
    answer_type: atype,
  });
  const res = await ctx.patch(`/api/admin/leadgen/sections/${SECTION.public_id}`, {
    data: {
      content_json: authoredContent(),
      selected_offers: [offer.id],
      answer_maps: [
        map("r2fix_q_carrier", "r2fix_carrier", "string", "enum", true),
        map(QID, `${FIELD}_min`, "number", "number", false),
        map(QID, `${FIELD}_max`, "number", "number", false),
      ],
    },
  });
  say(`AUTHOR from_to (${FIELD}) -> HTTP ${res.status()}`);
  if (res.status() !== 200) throw new Error(`authoring save failed: ${res.status()} ${(await res.text()).slice(0, 400)}`);
  // ADJ-N20 (registered, not fixed here): a SECTION save bumps only the
  // SECTION's content_version while the lg-shell cache key carries the
  // VARIANT's, so a visitor can hold the stale shell for the full 300s TTL.
  // Re-saving the ACTIVATION mints a fresh key; activationVersion is
  // unixepoch(), so cross a second boundary first.
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
  say(`  re-save activation (fresh lg-shell key) -> HTTP ${act.status()}`);
  if (act.status() !== 200) throw new Error(`activation re-save failed: ${act.status()} ${(await act.text()).slice(0, 400)}`);
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
  await page.waitForFunction(() => (window as unknown as { __LG_ENGINE__?: unknown }).__LG_ENGINE__ !== undefined);
  for (let i = 0; i < 6; i += 1) {
    if (await page.getByText(HEADLINE).first().isVisible()) break;
    await page
      .locator("[data-lg-continue]:visible")
      .first()
      .click({ timeout: 2500 })
      .catch(() => undefined);
    await page.waitForTimeout(600);
  }
  await expect(page.getByText(HEADLINE).first()).toBeVisible();
}

function wrapFor(page: Page): Locator {
  return page.locator(`[data-lg-question="${QID}"]`).first();
}

/** Everything the visitor can see about the band, in one read. */
interface Snap { from: string; to: string; railLo: string; railHi: string; pillMin: string; pillMax: string }
async function snap(page: Page): Promise<Snap> {
  const w = wrapFor(page);
  const rails = w.locator(".lg-range-input-dual");
  const pills = w.locator(".lg-range-handle-value");
  return {
    from: await w.locator(".lg-range-from").inputValue(),
    to: await w.locator(".lg-range-to").inputValue(),
    railLo: await rails.nth(0).inputValue(),
    railHi: await rails.nth(1).inputValue(),
    pillMin: ((await pills.nth(0).textContent()) ?? "").trim(),
    pillMax: ((await pills.nth(1).textContent()) ?? "").trim(),
  };
}
const fmt = (s: Snap): string =>
  `field[From=${s.from} To=${s.to}] rails=[${s.railLo},${s.railHi}] pills=[${s.pillMin},${s.pillMax}]`;

/** Type digit-by-digit into a box after a REAL clear, logging every keystroke. */
async function retype(page: Page, box: Locator, digits: string, tag: string): Promise<Snap> {
  await box.click();
  await box.fill("");
  say(`   ${tag} [clear]   -> ${fmt(await snap(page))}`);
  for (const ch of digits) {
    await box.press(ch);
    await page.waitForTimeout(60);
    say(`   ${tag} type '${ch}' -> ${fmt(await snap(page))}`);
  }
  // COMMIT: blur is where F-1's guarantee is owed (field == rails == pill ==
  // the recorded answer). `change` fires here and syncDualRange mirrors.
  await box.blur();
  await page.waitForTimeout(120);
  const s = await snap(page);
  say(`   ${tag} [blur]    -> ${fmt(s)}`);
  return s;
}

/** A REAL paste (clipboard insertText through the browser's own input path). */
async function paste(page: Page, box: Locator, text: string, tag: string): Promise<Snap> {
  await box.click();
  await box.fill("");
  await page.keyboard.insertText(text);
  await page.waitForTimeout(80);
  say(`   ${tag} paste "${text}" -> ${fmt(await snap(page))}`);
  await box.blur();
  await page.waitForTimeout(120);
  const s = await snap(page);
  say(`   ${tag} [blur]    -> ${fmt(s)}`);
  return s;
}

const money = (n: number): string => `$${n.toLocaleString("en-US")}`;
/** The whole visible surface agrees with `lo`/`hi` — F-1's guarantee at commit. */
function expectAgreement(s: Snap, lo: number, hi: number, tag: string): void {
  expect([s.from, s.railLo, s.pillMin], `${tag}: min box/rail/pill agree on ${lo}`).toEqual([
    String(lo),
    String(lo),
    money(lo),
  ]);
  expect([s.to, s.railHi, s.pillMax], `${tag}: max box/rail/pill agree on ${hi}`).toEqual([
    String(hi),
    String(hi),
    money(hi),
  ]);
}

test.beforeAll(async () => {
  mkdirSync(SHOT_DIR, { recursive: true });
  writeFileSync(LOG, `R2 P4 FIX-FIRST-2 — driven interaction matrix (${new Date().toISOString()})\n`);
  const ctx = await playwrightRequest.newContext({ baseURL: ORIGIN });
  const body = (await (await ctx.get("/api/admin/leadgen/sections?activity=r2fix_activity")).json()) as {
    items: SectionRow[];
  };
  const found = body.items.find((s) => s.section_name === "R2Fix Fixture Carrier Buttons");
  if (found === undefined) throw new Error("fixture section missing — run npm run seed:leadgen-fixture");
  SECTION = found;
  await ctx.dispose();
  await authorFromTo();
  await pollShellHas(`data-lg-question="${QID}"`, "the fix-round-2 from_to slider");
});

// ---------------------------------------------------------------------------
// N-1 — the interaction matrix (both fields x both viewports)
// ---------------------------------------------------------------------------
for (const width of [1280, 375]) {
  test(`N-1 @${width}: every way a visitor types into From/To lands the number they typed`, async ({ page }) => {
    await openFunnel(page, width);
    const w = wrapFor(page);
    await w.evaluate((el) => (el as Element).scrollIntoView({ block: "center" }));
    await page.waitForTimeout(150);
    const from = w.locator(".lg-range-from");
    const to = w.locator(".lg-range-to");
    say(`\n=== N-1 @${width} === rest -> ${fmt(await snap(page))}`);

    // Build the clamp pressure the regression needs: From up to 35000 first,
    // which is ALSO the To field's "type-up across the clamp" precondition.
    say(` A. From type-up 35000 (digit-by-digit)`);
    const a = await retype(page, from, "35000", "A");
    expectAgreement(a, 35000, MAX, "A From type-up");

    // --- To: type-up across the clamp (the N-1 regression) -----------------
    say(` B. To type-up 60000 — the exact keystroke path N-1 made unreachable`);
    const b = await retype(page, to, "60000", "B");
    expectAgreement(b, 35000, 60000, "B To type-up");

    // --- To: type-down (still above From) ----------------------------------
    say(` C. To type-down 45000`);
    const c = await retype(page, to, "45000", "C");
    expectAgreement(c, 35000, 45000, "C To type-down");

    // --- To: paste ----------------------------------------------------------
    say(` D. To paste 80000`);
    const d = await paste(page, to, "80000", "D");
    expectAgreement(d, 35000, 80000, "D To paste");

    // --- From: type-up (crosses nothing), type-down, paste ------------------
    say(` E. From type-up 50000`);
    const e = await retype(page, from, "50000", "E");
    expectAgreement(e, 50000, 80000, "E From type-up");
    say(` F. From type-down 10000`);
    const f = await retype(page, from, "10000", "F");
    expectAgreement(f, 10000, 80000, "F From type-down");
    say(` G. From paste 25000`);
    const g = await paste(page, from, "25000", "G");
    expectAgreement(g, 25000, 80000, "G From paste");

    // --- final OUT-OF-ORDER values: F-1's own guarantee, still held ---------
    // To below From -> the whole surface must show ONE agreed number, and the
    // box may NOT keep showing a number that never left the browser. P8-5/J1
    // removed the FIX-FIRST-2 one-step-short grid clamp this used to pin
    // (25000/30000): a GENUINE ordering conflict now corrects — at commit — to
    // the NEIGHBOUR's EXACT value (P8-REGISTER ADJ-P8-51: "a genuine ordering
    // conflict corrects to the neighbour's EXACT value … instead of the grid
    // number"). Measured at HEAD (this spec's own silenced-assertion probe,
    // both viewports): box/rail/pill all converge on 25000 (From's value),
    // not 30000 — pinned exactly as measured, box == rail == pill.
    say(` H. To final out-of-order 5000 (below From=25000) -> coincides with From`);
    const h = await retype(page, to, "5000", "H");
    expectAgreement(h, 25000, 25000, "H To out-of-order");
    // From above To -> same, from the other side. H already left To at 25000
    // (not the old 30000), so the precondition here is From=25000/To=25000 —
    // typing 90000 into From is still a genuine inversion against To=25000,
    // and measured at HEAD it corrects to the same coincident 25000/25000.
    say(` I. From final out-of-order 90000 (above To=25000, post-H) -> coincides with To`);
    const i = await retype(page, from, "90000", "I");
    expectAgreement(i, 25000, 25000, "I From out-of-order");

    // --- an OFF-GRID committed value (not a multiple of `step`) -------------
    // Kept in the matrix because it is the one commit shape where a surface
    // still disagrees, and that disagreement must stay where it is: the native
    // <input type=range> snaps its own value to the step grid, so the RAIL
    // reads 35000 while the box, the pill and the recorded answer all read the
    // 37000 the visitor typed. Pre-existing (identical before af330ee, after
    // it, and now) and money-safe — the buyer is billed the typed number, only
    // the handle's pixel position rounds. Reported, not changed here.
    say(` J. To paste 37000 (off the ${STEP} grid)`);
    const j = await paste(page, to, "37000", "J");
    expect([j.to, j.pillMax], "J: the box and the pill carry the typed number").toEqual(["37000", money(37000)]);
    say(` J. rail(step-snapped, native input) = ${j.railHi}`);

    await page.screenshot({ path: `${SHOT_DIR}/n1-matrix-${width}.png`, fullPage: false });
  });
}

// ---------------------------------------------------------------------------
// N-1 (c) — the buyer's number, read back out of leadgen_provider_request_log
// ---------------------------------------------------------------------------
// The payload the BUYER receives is the `lead` object persisted in
// leadgen_provider_request_log — read straight out of the local D1 the worker
// under drive just wrote to (no admin read-model in between, so nothing can
// re-derive or re-clamp the number on the way back out).
interface ProvRow { id: number; instance: string | null; payload: Record<string, unknown> }
function readProviderRow(): ProvRow {
  const out = execFileSync(
    "npx",
    [
      "wrangler",
      "d1",
      "execute",
      "DB",
      "--local",
      "--json",
      "--command",
      `SELECT id, auction_instance_id, request_payload_redacted_json FROM leadgen_provider_request_log WHERE request_payload_redacted_json LIKE '%${FIELD}_max%' ORDER BY id DESC LIMIT 1;`,
    ],
    { cwd: process.cwd(), encoding: "utf8", maxBuffer: 8 << 20 },
  );
  const rows = (JSON.parse(out.slice(out.indexOf("["))) as Array<{
    results: Array<{ id: number; auction_instance_id: string | null; request_payload_redacted_json: string }>;
  }>)[0].results;
  if (rows.length === 0) throw new Error(`no leadgen_provider_request_log row carrying ${FIELD}_max`);
  const body = JSON.parse(rows[0].request_payload_redacted_json) as { lead?: Record<string, unknown> };
  return { id: rows[0].id, instance: rows[0].auction_instance_id, payload: body.lead ?? {} };
}

test("N-1 payload: the two decisive cases bill the number the visitor committed", async ({ page }) => {
  // Case 1 (the regression): ordinary typing must bill 60000.
  const posts: Array<Record<string, unknown>> = [];
  const capture = (p: Page): void => {
    p.on("request", (r) => {
      if (r.url().includes("/lg/auction") && r.method() === "POST") {
        try {
          posts.push(JSON.parse(r.postData() ?? "{}") as Record<string, unknown>);
        } catch {
          /* non-JSON body is not an auction envelope */
        }
      }
    });
  };
  capture(page);
  await openFunnel(page, 1280);
  const w = wrapFor(page);
  await w.evaluate((el) => (el as Element).scrollIntoView({ block: "center" }));
  await page.waitForTimeout(150);
  say(`\n=== N-1 payload case 1: From 35000 typed, To 60000 typed ===`);
  await retype(page, wrapFor(page).locator(".lg-range-from"), "35000", "P1a");
  const c1 = await retype(page, wrapFor(page).locator(".lg-range-to"), "60000", "P1b");
  expectAgreement(c1, 35000, 60000, "payload case 1 pre-submit");
  await page.locator('[data-lg-choice="acme_insurance"]').first().click();
  await page.locator("[data-lg-continue]:visible").first().click();
  await page.waitForTimeout(3000);
  const row1 = readProviderRow();
  say(`case 1 provider row id=${row1.id} payload=${JSON.stringify(row1.payload)}`);
  expect(row1.payload[`${FIELD}_min`], "case 1 bills the typed From").toBe(35000);
  expect(row1.payload[`${FIELD}_max`], "case 1 bills the typed To (N-1 billed 100000)").toBe(60000);

  // Case 2 (F-1's own guarantee): a final out-of-order value bills the
  // NEIGHBOUR'S EXACT VALUE (P8-5/J1 coincidence, not the old FIX-FIRST-2
  // one-step-short grid clamp — P8-REGISTER ADJ-P8-51), and the box the
  // visitor is looking at shows that same coincident number. Measured at HEAD
  // (this spec's own silenced-assertion probe): committed snap =
  // {from:"35000",to:"35000",railLo:"35000",railHi:"35000",pillMin/Max:"$35,000"}
  // — box, rail and pill all converge on 35000 (From's value), not 40000.
  const page2 = await page.context().newPage();
  await openFunnel(page2, 1280);
  const w2 = wrapFor(page2);
  await w2.evaluate((el) => (el as Element).scrollIntoView({ block: "center" }));
  await page2.waitForTimeout(150);
  say(`\n=== N-1 payload case 2: From 35000 typed, To 20000 typed (out of order) ===`);
  await retype(page2, w2.locator(".lg-range-from"), "35000", "P2a");
  const c2 = await retype(page2, w2.locator(".lg-range-to"), "20000", "P2b");
  expectAgreement(c2, 35000, 35000, "payload case 2 pre-submit");
  await page2.locator('[data-lg-choice="acme_insurance"]').first().click();
  await page2.locator("[data-lg-continue]:visible").first().click();
  await page2.waitForTimeout(3000);
  const row2 = readProviderRow();
  say(`case 2 provider row id=${row2.id} payload=${JSON.stringify(row2.payload)}`);
  expect(row2.payload[`${FIELD}_min`]).toBe(35000);
  expect(row2.payload[`${FIELD}_max`], "case 2 bills the coincident value the box shows").toBe(35000);
});

// ---------------------------------------------------------------------------
// N-2 — the stacked min pill must never cover the operator's question label
// ---------------------------------------------------------------------------
for (const width of [1280, 375]) {
  test(`N-2 @${width}: at the LOW clamp the raised min pill clears the question label`, async ({ page }) => {
    await openFunnel(page, width);
    const w = wrapFor(page);
    await w.evaluate((el) => (el as Element).scrollIntoView({ block: "center" }));
    await page.waitForTimeout(150);
    const label0 = page.locator(".lg-label").filter({ hasText: "Price band" }).first();
    const box0 = async (l: Locator): Promise<{ top: number; bottom: number; left: number; right: number }> => {
      const b = await l.boundingBox();
      if (b === null) throw new Error("element has no box");
      return { top: b.y, bottom: b.y + b.height, left: b.x, right: b.x + b.width };
    };
    // AT REST first (both handles on the rails, ONE pill row) — the cost side
    // of N-2's clearance change is this gap, recorded so it is never a guess.
    const rl = await box0(label0);
    const rp = await box0(w.locator(".lg-range-handle-value").nth(1));
    say(`\n=== N-2 @${width} === at rest: label.bottom=${rl.bottom.toFixed(1)} pillRow.top=${rp.top.toFixed(1)} gap=${(rp.top - rl.bottom).toFixed(1)}px`);
    await page.screenshot({ path: `${SHOT_DIR}/n2-rest-${width}.png`, fullPage: false });

    // Drive the MAX handle down to ~5% with REAL keyboard input on the rail
    // itself (the §6.8 keyboard rail): Home parks it at min, which the clamp
    // lifts to one step above the min handle; PageUp/ArrowUp walk it to 5000.
    const railHi = w.locator(".lg-range-input-dual").nth(1);
    await railHi.focus();
    await page.keyboard.press("Home");
    await page.waitForTimeout(120);
    // Home lands on min -> clamped to MIN+STEP (5000) = 5% of the span.
    const s = await snap(page);
    say(`=== N-2 @${width} === low clamp -> ${fmt(s)}`);
    expect([s.railLo, s.railHi], "both handles sit at the low clamp").toEqual([String(MIN), String(MIN + STEP)]);

    // The operator's question label is a SIBLING of the .lg-range wrapper
    // (presets.ts labelLine emits it just before it), not a descendant.
    const label = page.locator(".lg-label").filter({ hasText: "Price band" }).first();
    const pillMin = w.locator(".lg-range-handle-value").nth(0);
    const pillMax = w.locator(".lg-range-handle-value").nth(1);
    const box = async (l: Locator): Promise<{ top: number; bottom: number; left: number; right: number }> => {
      const b = await l.boundingBox();
      if (b === null) throw new Error("element has no box");
      return { top: b.y, bottom: b.y + b.height, left: b.x, right: b.x + b.width };
    };
    const lb = await box(label);
    const pmin = await box(pillMin);
    const pmax = await box(pillMax);
    const overlaps = (a: typeof lb, b: typeof lb): boolean =>
      a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    say(
      `label  top=${lb.top.toFixed(1)} bottom=${lb.bottom.toFixed(1)} left=${lb.left.toFixed(1)} right=${lb.right.toFixed(1)}`,
    );
    say(`minPill top=${pmin.top.toFixed(1)} bottom=${pmin.bottom.toFixed(1)} left=${pmin.left.toFixed(1)} right=${pmin.right.toFixed(1)}`);
    say(`maxPill top=${pmax.top.toFixed(1)} bottom=${pmax.bottom.toFixed(1)} left=${pmax.left.toFixed(1)} right=${pmax.right.toFixed(1)}`);
    say(`gap(label.bottom -> minPill.top) = ${(pmin.top - lb.bottom).toFixed(1)}px`);
    // The whole vertical budget the stack has to live inside, so a later round
    // can see WHY the clearance is the number it is.
    for (const [name, sel] of [
      ["track", ".lg-range-track"],
      ["minmax", ".lg-range-minmax"],
      ["ftInputs", ".lg-range-from-to-inputs"],
    ] as const) {
      const b = await w.locator(sel).first().boundingBox();
      if (b !== null) say(`${name}  top=${b.y.toFixed(1)} bottom=${(b.y + b.height).toFixed(1)} h=${b.height.toFixed(1)}`);
    }
    const sw = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    say(`scrollWidth=${sw[0]}/${sw[1]}`);
    await page.screenshot({ path: `${SHOT_DIR}/n2-lowclamp-${width}.png`, fullPage: false });

    expect(overlaps(lb, pmin), "the raised min pill does not cover the question label").toBe(false);
    expect(overlaps(lb, pmax), "the max pill does not cover the question label").toBe(false);
    expect(overlaps(pmin, pmax), "the two pills are stacked, not collided").toBe(false);
    expect(sw[0], "no horizontal overflow at the low clamp").toBe(sw[1]);

    // The SYMMETRIC stacked state: both handles clamped at the TOP of the
    // track, where the readouts are at their widest ($95,000 / $100,000).
    // The clamp rule is "the moved handle stops one step short, the neighbour
    // never moves", so the MAX must go up first — otherwise End on the min rail
    // is clamped straight back down to (current max - step).
    const railLo = w.locator(".lg-range-input-dual").nth(0);
    await railHi.focus();
    await page.keyboard.press("End");
    await page.waitForTimeout(120);
    await railLo.focus();
    await page.keyboard.press("End");
    await page.waitForTimeout(150);
    const hs = await snap(page);
    say(`=== N-2 @${width} === high clamp -> ${fmt(hs)}`);
    expect([hs.railLo, hs.railHi], "both handles sit at the high clamp").toEqual([String(MAX - STEP), String(MAX)]);
    const hl = await box(label);
    const hmin = await box(pillMin);
    const hmax = await box(pillMax);
    say(`label  top=${hl.top.toFixed(1)} bottom=${hl.bottom.toFixed(1)}`);
    say(`minPill top=${hmin.top.toFixed(1)} bottom=${hmin.bottom.toFixed(1)} left=${hmin.left.toFixed(1)} right=${hmin.right.toFixed(1)}`);
    say(`maxPill top=${hmax.top.toFixed(1)} bottom=${hmax.bottom.toFixed(1)} left=${hmax.left.toFixed(1)} right=${hmax.right.toFixed(1)}`);
    say(`gap(label.bottom -> minPill.top) = ${(hmin.top - hl.bottom).toFixed(1)}px`);
    const hsw = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    say(`scrollWidth=${hsw[0]}/${hsw[1]}`);
    await page.screenshot({ path: `${SHOT_DIR}/n2-highclamp-${width}.png`, fullPage: false });
    expect(overlaps(hl, hmin), "the raised min pill clears the label at the high clamp too").toBe(false);
    expect(overlaps(hmin, hmax), "the two pills are stacked, not collided, at the high clamp").toBe(false);
    expect(hsw[0], "no horizontal overflow at the high clamp").toBe(hsw[1]);
  });
}
