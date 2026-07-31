// LeadGen R2 · P6 terminal — the DRIVEN PRODUCT for the #11C funnel-board and
// routing-rules owner sentences (SRC-11C-A/B/C/D/R and SRC-11C-N01…N12).
// Every test is ONE real operator journey on the real admin board / real
// Themes+A/B tabs, and (where the sentence is about what a visitor gets) ONE
// real visitor journey on the live /lg shell. Nothing hand-builds both sides of
// a boundary (E10/E11): funnels are added with the real "+ Add funnel" stub,
// sections are DRAGGED from the real library rail, pages are reordered with the
// real pointer stream AND the real kebab menu, rules are authored in the real
// modal, and the routing outcome is read back out of the LIVE-written
// leadgen_routing_outcomes table.
//
// Owner sentences (verbatim — these ARE the acceptance):
//  11C-A "the order of the pages could be changed and not only what pages we
//         show per funnel name"
//  11C-B "each page could include more than one section and we should be able
//         to A/B test or creating in-funnel rules (show in CA this section in
//         this page, and in the rest show this sectio, for example)"
//  11C-C "The AB test can be also in the funnel level and not only in the page
//         level"
//  11C-D "Theme picker per funnel name"
//  11C-R "the funnel is decided per user answers durring the questionarie or
//         per the user parameters (UTMs/ Claudflare data such as device/os/
//         time/day and so on)"
//  N01   "there is no \"control\" funnel!!!"
//  N02   "the first page is shared by all the funnels"
//  N03   "we can do AB test for this page as well!"
//  N04   "kick out all the stupid and unusable components from the 'Funnel
//         builder' - the canvas, the canvas controllers on the top, the varient"
//  N05   "add in the left side all the available sections in draggable boxes"
//  N06   "in the middle create different funnels side by side and drag sections
//         boxes to the page of the wanted funnle"
//  N07   "add button of 'add funnel', user should be able to add as many funnel
//         he wants"
//  N08   "why the user can choose the same page more than ones in the same
//         funnel???"
//  N09   "the routing rules table has got out of its box - disaster!!!!!!"
//  N10   "Unified the \"Rules\" with this tab and show them in the right side
//         where we define rules of what funnel name we are showing for each
//         user"
//  N11   "the rules you build are using jargon, have no actions"
//  N12   "Image42 here it how it builds in the reference"  (human side-by-side)
//
// Run (worktree-isolated, fresh D1, this worktree's port):
//   cd api && npm run db:reset:local && npm run seed:leadgen-fixture
//   PW_PORT=8901 npx playwright test test-ui/leadgen-r2p6-d11c-drive.spec.ts \
//     --project=chromium --workers=1 --reporter=line

import { test, expect, request as playwrightRequest, type APIRequestContext, type Page } from "@playwright/test";
import { appendFileSync, mkdirSync } from "node:fs";
import {
  CONTINUE_ONLY,
  LG_API,
  ORIGIN,
  REAL_CHROME_UA,
  captureCheckpoints,
  createRoutingRule,
  createSection,
  d1Query,
  distinctiveSection,
  dragCenterToCenter,
  json,
  ready,
  seedRoutingQuote,
  shellUrl,
  uniqueTag,
} from "./leadgen-rework-acceptance-helpers";

const EVIDENCE_DIR = "../docs/leadgen/r2/evidence/p6/d11c";
mkdirSync(EVIDENCE_DIR, { recursive: true });
const MEASUREMENTS = `${EVIDENCE_DIR}/measurements.txt`;

test.use({
  launchOptions: { args: ["--host-resolver-rules=MAP *.e2e.test 127.0.0.1"] },
  userAgent: REAL_CHROME_UA,
  viewport: { width: 1440, height: 1000 },
});

let apiCtx: APIRequestContext;
test.beforeAll(async () => {
  apiCtx = await playwrightRequest.newContext({ baseURL: ORIGIN });
  appendFileSync(MEASUREMENTS, `\n===== run ${new Date().toISOString()} =====\n`);
});
test.afterAll(async () => {
  await apiCtx.dispose();
});

// What the visitor can actually READ on the funnel: the engine keeps every
// section of the plan in the DOM and shows one at a time, so textContent()
// returns ALL arms at once — innerText returns only the rendered one.
async function visibleFunnelText(page: Page): Promise<string> {
  return page.locator("#lg-funnel-root").evaluate((el) => (el as HTMLElement).innerText.trim());
}

// The engine's own funnel_attempt_id — the join key of the LIVE-written
// leadgen_routing_outcomes row (the table has no public endpoint).
async function attemptIdOf(page: Page): Promise<string> {
  return page.evaluate(
    () => (window as unknown as { __LG_ENGINE__?: { getState(): { funnel_attempt_id: string } } }).__LG_ENGINE__?.getState().funnel_attempt_id ?? "",
  );
}

function note(line: string): void {
  appendFileSync(MEASUREMENTS, `${line}\n`);
}

// Capture the SAME state at 1280 AND 375 (E6) and record the 375 overflow
// measurement alongside the artifact.
async function shot(page: Page, name: string, focus?: string): Promise<void> {
  const prev = page.viewportSize() ?? { width: 1440, height: 1000 };
  const bring = async (): Promise<void> => {
    if (focus === undefined) return;
    const el = page.locator(focus).first();
    if ((await el.count()) > 0) await el.scrollIntoViewIfNeeded().catch(() => undefined);
  };
  await page.setViewportSize({ width: 1280, height: 900 });
  await bring();
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${EVIDENCE_DIR}/${name}-1280.png`, fullPage: false });
  await page.setViewportSize({ width: 375, height: 812 });
  await bring();
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${EVIDENCE_DIR}/${name}-375.png`, fullPage: false });
  const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  note(`${name} @375 scrollWidth=${m.sw} innerWidth=${m.iw} overflow=${m.sw > m.iw ? "YES" : "no"}`);
  await page.setViewportSize(prev);
  await page.waitForTimeout(150);
}

// createSection returns only { id, public_id }; every board assertion below
// matches the chip/option by the operator-visible NAME, so carry it along.
interface NamedSection {
  id: number;
  public_id: string;
  name: string;
}
async function namedSection(name: string): Promise<NamedSection> {
  const created = await createSection(apiCtx, name, [
    { type: "QuestionHeadline", question_id: "h", props: { text: name } },
    ...CONTINUE_ONLY,
  ]);
  return { id: created.id, public_id: created.public_id, name };
}

interface BoardQuote {
  quotePublicId: string;
  funnelPublicId: string;
  variantPublicId: string;
}
async function seedBoardQuote(request: APIRequestContext, tag: string): Promise<BoardQuote> {
  const u = uniqueTag(tag);
  const quote = await json<{ public_id: string; funnels: Array<{ public_id: string; variants: Array<{ public_id: string }> }> }>(
    // verticals MUST match createSection's default vertical ("life") — the
    // variant PUT rejects a slot whose section vertical is outside the quote's.
    await request.post(`${LG_API}/quotes`, { data: { quote_name: `P6C ${u}`, activity: "quote_funnel", verticals: ["life"] } }),
    "quote create",
  );
  return {
    quotePublicId: quote.public_id,
    funnelPublicId: quote.funnels[0]!.public_id,
    variantPublicId: quote.funnels[0]!.variants[0]!.public_id,
  };
}

async function openBoard(page: Page, quotePublicId: string): Promise<void> {
  await page.goto(`${ORIGIN}/admin/leadgen/quotes/${quotePublicId}/edit`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("[data-board]")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("#lg-qr-rail")).toBeAttached({ timeout: 20_000 });
}

// One page carrying `sectionIds` (in order) on the funnel's active variant.
async function setPages(request: APIRequestContext, variantPublicId: string, pages: number[][]): Promise<void> {
  await json(
    await request.put(`${LG_API}/variants/${variantPublicId}`, {
      data: { pages: pages.map((ids, i) => ({ name: `Page ${i + 1}`, slots: ids.map((id) => ({ kind: "fixed", section_id: id })) })) },
    }),
    "variant pages",
  );
}

// ===========================================================================
// SRC-11C-N01/N04/N05/N06/N07/N10 — the board's anatomy, driven.
// ===========================================================================
test("N01·N04·N05·N06·N07·N10 — the board is library-left / funnels-side-by-side-centre / rules-right, with + Add funnel and no control·canvas·variant", async ({ page }) => {
  const u = uniqueTag("anat");
  const seed = await seedBoardQuote(apiCtx, "anat");
  const secA = await namedSection(`P6C anat A ${u}`);
  const secB = await namedSection(`P6C anat B ${u}`);
  await setPages(apiCtx, seed.variantPublicId, [[secA.id]]);
  await openBoard(page, seed.quotePublicId);

  // N07 — "+ Add funnel", as many as he wants: click it three times.
  await expect(page.locator("[data-add-funnel]")).toBeVisible();
  await expect(page.locator(".lg-col-funnel")).toHaveCount(1);
  for (let i = 2; i <= 4; i++) {
    await page.locator("[data-add-funnel]").click();
    await expect(page.locator(".lg-col-funnel")).toHaveCount(i, { timeout: 20_000 });
  }
  await expect(page.locator("[data-add-funnel]"), "the add-funnel affordance is still offered after the 4th").toBeVisible();
  note(`N07 funnel columns after 3 clicks of + Add funnel = ${await page.locator(".lg-col-funnel").count()}`);

  // N05 — the left rail lists the available sections as draggable boxes.
  const libCards = page.locator(".lg-board-left [data-lib-card]");
  expect(await libCards.count(), "left library rail lists available sections").toBeGreaterThan(0);
  const libCursor = await libCards.first().evaluate((el) => getComputedStyle(el).cursor);
  const libGrip = await page.locator(".lg-board-left [data-lib-card] .lg-grip").count();
  note(`N05 library cards=${await libCards.count()} cursor=${libCursor} grips=${libGrip}`);
  expect(libCursor, "library boxes advertise dragging").toBe("grab");

  // N06 — funnels side by side in the middle: same top, strictly increasing x,
  // and the library is left of them while the rules rail is right of them.
  const boxes = await page.locator(".lg-col-funnel").evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => ({ x: r.x, y: r.y, w: r.width })));
  for (let i = 1; i < boxes.length; i++) {
    expect(boxes[i]!.x, `funnel ${i + 1} sits to the RIGHT of funnel ${i}`).toBeGreaterThan(boxes[i - 1]!.x);
    expect(Math.abs(boxes[i]!.y - boxes[0]!.y), "funnels share one row (side by side, not stacked)").toBeLessThanOrEqual(2);
  }
  const geom = await page.evaluate(() => {
    const r = (s: string): DOMRect | null => document.querySelector(s)?.getBoundingClientRect() ?? null;
    const left = r(".lg-board-left"); const centre = r(".lg-board-center"); const right = r(".lg-board-right");
    return { left: left && { x: left.x, r: left.right }, centre: centre && { x: centre.x, r: centre.right }, right: right && { x: right.x, r: right.right } };
  });
  note(`N06/N10 panes @1440: left=${JSON.stringify(geom.left)} centre=${JSON.stringify(geom.centre)} right=${JSON.stringify(geom.right)}`);
  expect(geom.left!.r, "the section library is the LEFT side").toBeLessThanOrEqual(geom.centre!.x + 1);
  // N10 — the Rules live INSIDE this tab, on the right side.
  expect(geom.right!.x, "the routing-rules rail is the RIGHT side").toBeGreaterThanOrEqual(geom.centre!.r - 1);
  await expect(page.locator('[data-panel="builder"] #lg-qr-rail'), "the rules rail is unified INTO the funnel-builder tab").toHaveCount(1);
  await expect(page.locator('[data-tab="rules"]'), "no separate top-level Rules tab survives").toHaveCount(0);
  await expect(page.locator("#lg-qr-rail .lg-qr-title")).toHaveText("Routing rules");

  // N06 (drag half) — drag a library box onto the SECOND funnel's page card.
  await page.locator(".lg-col-funnel").nth(1).locator("[data-add-page]").click();
  await expect(page.locator(".lg-col-funnel").nth(1).locator("[data-page-card]")).toHaveCount(1, { timeout: 20_000 });
  const target = page.locator(".lg-col-funnel").nth(1).locator("[data-page-card]").first();
  await dragCenterToCenter(page, page.locator(`[data-lib-card][data-section-public-id="${secB.public_id}"]`), target);
  await expect(
    page.locator(".lg-col-funnel").nth(1).locator("[data-sec-chip] .lg-sc-name", { hasText: secB.name }),
    "the dragged section landed on the WANTED funnel's page",
  ).toBeVisible({ timeout: 20_000 });
  note(`N06 dragged "${secB.name}" from the library onto funnel 2's page — chip present after the island's reload`);

  // N01 + N04 — no control funnel, no canvas, no canvas controllers, no variant
  // widget anywhere in the funnel-builder panel.
  // The READABLE text only: <script type="application/json"> data blobs (the
  // board/rules hydration payloads) are not words the operator ever sees, and
  // their key names ("variant_public_id") would false-positive this census.
  const census = await page.locator('[data-panel="builder"]').evaluate((root) => {
    const words = ["control", "canvas", "variant", "varient"];
    const scan = (host: HTMLElement): Record<string, string[]> => {
      const text = (host.textContent ?? "").toLowerCase();
      const out: Record<string, string[]> = {};
      for (const word of words) {
        const hits: string[] = [];
        let i = text.indexOf(word);
        while (i >= 0 && hits.length < 4) {
          hits.push(text.slice(Math.max(0, i - 60), i + 60).replace(/\s+/g, " "));
          i = text.indexOf(word, i + 1);
        }
        out[word] = hits;
      }
      return out;
    };
    // ON SCREEN: what the operator can actually read on the board — script
    // hydration blobs and the not-yet-opened dialogs are excluded.
    const onScreen = root.cloneNode(true) as HTMLElement;
    onScreen.querySelectorAll("script, style, .lg-hidden, [hidden]").forEach((n) => n.remove());
    // WHOLE PANEL: the same census including every hidden dialog's copy.
    const whole = root.cloneNode(true) as HTMLElement;
    whole.querySelectorAll("script, style").forEach((n) => n.remove());
    return { onScreen: scan(onScreen), wholePanel: scan(whole) };
  });
  note(`N01/N04 on-screen word census = ${JSON.stringify(census.onScreen)}`);
  note(`N01/N04 whole-panel word census (incl. hidden dialogs) = ${JSON.stringify(census.wholePanel)}`);
  for (const word of ["control", "canvas", "variant", "varient"]) {
    expect(census.onScreen[word], `the funnel builder never shows the operator the word "${word}"`).toEqual([]);
  }
  const banned = await page.locator('[data-panel="builder"]').evaluate((root) => ({
    canvasEls: root.querySelectorAll("canvas, iframe, [data-canvas], [class*='canvas'], [id*='canvas']").length,
    variantEls: root.querySelectorAll("[data-variant-select], [data-variant-switch], [class*='variant'], [id*='variant']").length,
    controlEls: root.querySelectorAll("[data-is-control], [data-control-chip], [class*='control-funnel']").length,
  }));
  note(`N01/N04 banned-element census inside [data-panel="builder"] = ${JSON.stringify(banned)}`);
  expect(banned.canvasEls, "no canvas / canvas controllers in the funnel builder").toBe(0);
  expect(banned.variantEls, "no variant widget in the funnel builder").toBe(0);
  expect(banned.controlEls, "no control-funnel concept in the funnel builder").toBe(0);

  await shot(page, "anatomy-board");
});

// ===========================================================================
// SRC-11C-N09 (+ 11C-A's board-reachability leg) — "the routing rules table has
// got out of its box - disaster!!!!!!". Measured at FIVE widths with 6 funnels
// and a populated rail.
// ===========================================================================
test("N09 — the rules rail/table stays inside its box and clips nothing at 375 · 1280 · 1600 · 1640 · 1680, with 6 funnels reachable", async ({ page }) => {
  const u = uniqueTag("n09");
  const seed = await seedBoardQuote(apiCtx, "n09");
  const sec = await namedSection(`P6C n09 ${u}`);
  await setPages(apiCtx, seed.variantPublicId, [[sec.id]]);
  // 6 funnels (the ≥6 board-reachability leg of 11C-A).
  const funnelIds: string[] = [seed.funnelPublicId];
  for (let i = 2; i <= 6; i++) {
    const f = await json<{ public_id: string }>(
      await apiCtx.post(`${LG_API}/quotes/${seed.quotePublicId}/funnels`, { data: { funnel_name: `Funnel ${i} ${u}` } }),
      `funnel ${i}`,
    );
    funnelIds.push(f.public_id);
  }
  // A populated rail: two rules with long names + many condition chips (the
  // widest content the rail can carry).
  await createRoutingRule(apiCtx, seed.quotePublicId, {
    rule_name: `Very long California desktop weekday morning rule ${u}`,
    priority: 1,
    conditions: { groups: [{ field: "state", op: "eq", value: "CA" }, { field: "device", op: "eq", value: "desktop" }, { field: "utm_source", op: "eq", value: "an-extremely-long-utm-source-value-for-overflow" }] },
    target_funnel_id: funnelIds[1]!,
    feed_name: "long_pii",
    value_multiplier: 0.25,
  });
  await createRoutingRule(apiCtx, seed.quotePublicId, {
    rule_name: `Second rule ${u}`,
    priority: 2,
    conditions: { groups: [{ field: "os", op: "eq", value: "iOS" }] },
    target_funnel_id: funnelIds[2]!,
  });
  await openBoard(page, seed.quotePublicId);
  await expect(page.locator("#lg-qr-rail [data-qr-card]")).toHaveCount(2);
  await expect(page.locator(".lg-col-funnel")).toHaveCount(6);

  const widths = [375, 1280, 1600, 1640, 1680];
  const results: Array<Record<string, unknown>> = [];
  for (const w of widths) {
    await page.setViewportSize({ width: w, height: w === 375 ? 812 : 1000 });
    await page.waitForTimeout(300);
    const m = await page.evaluate(() => {
      const q = (s: string): HTMLElement | null => document.querySelector(s);
      const rail = q(".lg-board-right")!;
      const shell = q(".lg-board-shell")!;
      const list = q("#lg-qr-list")!;
      const railR = rail.getBoundingClientRect();
      const shellR = shell.getBoundingClientRect();
      const cards = Array.from(document.querySelectorAll("#lg-qr-rail [data-qr-card]")).map((c) => c.getBoundingClientRect());
      return {
        bodySW: document.documentElement.scrollWidth,
        bodyIW: window.innerWidth,
        shell: { x: Math.round(shellR.x), right: Math.round(shellR.right) },
        rail: { x: Math.round(railR.x), right: Math.round(railR.right), sw: rail.scrollWidth, cw: rail.clientWidth },
        list: { sw: list.scrollWidth, cw: list.clientWidth },
        cardMaxRight: cards.length === 0 ? null : Math.round(Math.max(...cards.map((c) => c.right))),
        railContentRight: Math.round(railR.right),
      };
    });
    results.push({ w, ...m });
    note(`N09 @${w}: body sw=${m.bodySW} iw=${m.bodyIW} | shell[${m.shell.x}..${m.shell.right}] rail[${m.rail.x}..${m.rail.right}] railScroll ${m.rail.sw}<=${m.rail.cw} | list ${m.list.sw}<=${m.list.cw} | widest card right=${m.cardMaxRight}`);
    expect(m.bodySW, `@${w}: the page body must not scroll horizontally`).toBeLessThanOrEqual(m.bodyIW + 1);
    expect(m.rail.right, `@${w}: the rail's right edge stays inside its shell`).toBeLessThanOrEqual(m.shell.right + 1);
    expect(m.rail.x, `@${w}: the rail's left edge stays inside its shell`).toBeGreaterThanOrEqual(m.shell.x - 1);
    expect(m.rail.sw, `@${w}: the rail itself does not overflow horizontally`).toBeLessThanOrEqual(m.rail.cw + 1);
    expect(m.list.sw, `@${w}: the rules TABLE does not overflow its box`).toBeLessThanOrEqual(m.list.cw + 1);
    expect(m.cardMaxRight!, `@${w}: no rule card paints past the rail`).toBeLessThanOrEqual(m.railContentRight + 1);
    await page.screenshot({ path: `${EVIDENCE_DIR}/n09-rail-in-box-${w}.png`, fullPage: false });
  }

  // 11C-A's occlusion leg: with the board scrolled fully right, the LAST funnel
  // column's right edge still stays left of the rail — nothing painted under it.
  for (const w of [1600, 1640, 1680]) {
    await page.setViewportSize({ width: w, height: 1000 });
    await page.waitForTimeout(200);
    const occ = await page.evaluate(() => {
      const board = document.querySelector(".lg-board") as HTMLElement;
      board.scrollLeft = board.scrollWidth;
      const cols = Array.from(document.querySelectorAll(".lg-col-funnel"));
      const last = cols[cols.length - 1]!.getBoundingClientRect();
      const rail = document.querySelector(".lg-board-right")!.getBoundingClientRect();
      return { lastRight: Math.round(last.right), railLeft: Math.round(rail.x), cols: cols.length, boardScrolled: board.scrollLeft > 0 };
    });
    note(`N09/11C-A @${w}: board scrolled right (${occ.boardScrolled}); last of ${occ.cols} funnel columns right=${occ.lastRight} vs rail left=${occ.railLeft}`);
    expect(occ.lastRight, `@${w}: the last funnel column is not occluded by the rules rail`).toBeLessThanOrEqual(occ.railLeft + 1);
    await page.screenshot({ path: `${EVIDENCE_DIR}/n09-six-funnels-scrolled-${w}.png`, fullPage: false });
  }
  await shot(page, "n09-rail-and-six-funnels");
});

// ===========================================================================
// SRC-11C-A — "the order of the pages could be changed and not only what pages
// we show per funnel name": BOTH the drag and the menu equivalent, each
// persisting across a full reload.
// ===========================================================================
test("11C-A — page order changes by DRAG and by the page kebab menu, and both survive a reload", async ({ page }) => {
  const u = uniqueTag("11ca");
  const seed = await seedBoardQuote(apiCtx, "11ca");
  const p1 = await namedSection(`P6C A one ${u}`);
  const p2 = await namedSection(`P6C A two ${u}`);
  const p3 = await namedSection(`P6C A three ${u}`);
  await setPages(apiCtx, seed.variantPublicId, [[p1.id], [p2.id], [p3.id]]);
  await openBoard(page, seed.quotePublicId);

  const order = async (): Promise<string[]> =>
    page.locator(".lg-col-funnel [data-page-card] .lg-sc-name").allTextContents();
  const before = await order();
  expect(before, "the seeded page order").toEqual([p1.name, p2.name, p3.name]);
  await shot(page, "11c-a-order-before");

  // MENU equivalent: page 3's kebab -> Move up.
  await page.locator(".lg-col-funnel [data-page-card]").nth(2).locator("[data-page-kebab]").click();
  await page.locator('[data-board-menu="page"] [data-menu-action="page-up"]').click();
  await expect(page.locator(".lg-col-funnel [data-page-card] .lg-sc-name").nth(1)).toHaveText(p3.name, { timeout: 20_000 });
  await openBoard(page, seed.quotePublicId);
  const afterMenu = await order();
  note(`11C-A menu Move-up: before=${JSON.stringify(before)} after-reload=${JSON.stringify(afterMenu)}`);
  expect(afterMenu, "the menu reorder PERSISTED across a full reload").toEqual([p1.name, p3.name, p2.name]);
  await shot(page, "11c-a-order-after-menu");

  // DRAG: grab page 1's grip and drop it onto page 2's card. A taller viewport
  // keeps every page card inside the column's own scroller, so the pointer
  // stream lands on real pixels (the board column is `max-height:560px`).
  await page.setViewportSize({ width: 1440, height: 1200 });
  await page.waitForTimeout(200);
  const puts: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "PUT" && r.url().includes("/variants/")) puts.push(r.url());
  });
  const cards = page.locator(".lg-col-funnel [data-page-card]");
  // A plain pointer stream with NO pre-scroll: the shared dragCenterToCenter
  // helper calls scrollIntoViewIfNeeded on both endpoints first, and on the
  // board's nested scrollers that moved the press point off the page grip (0
  // PUTs, no reorder). Page cards are all on screen at 1200px height, so the
  // stream below presses the real grip.
  const grip = cards.first().locator("[data-page-grip]");
  const gBox = (await grip.boundingBox())!;
  const dBox = (await cards.nth(1).boundingBox())!;
  note(`11C-A drag geometry: grip=${JSON.stringify({ x: Math.round(gBox.x), y: Math.round(gBox.y) })} target=${JSON.stringify({ x: Math.round(dBox.x), y: Math.round(dBox.y), h: Math.round(dBox.height) })}`);
  await page.mouse.move(gBox.x + gBox.width / 2, gBox.y + gBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(gBox.x + gBox.width / 2 + 8, gBox.y + gBox.height / 2 + 8, { steps: 4 });
  await page.mouse.move(dBox.x + dBox.width / 2, dBox.y + dBox.height / 2, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(1500);
  note(`11C-A drag fired PUT /variants/ requests = ${puts.length}`);
  expect(puts.length, "the page drag reached the server (a real PUT /variants/:id)").toBeGreaterThanOrEqual(1);
  await expect(page.locator(".lg-col-funnel [data-page-card] .lg-sc-name").first()).not.toHaveText(p1.name, { timeout: 20_000 });
  await openBoard(page, seed.quotePublicId);
  const afterDrag = await order();
  note(`11C-A drag: after-menu=${JSON.stringify(afterMenu)} after-drag-reload=${JSON.stringify(afterDrag)}`);
  expect(afterDrag, "the DRAG reorder persisted and differs from the pre-drag order").not.toEqual(afterMenu);
  expect(afterDrag.slice().sort(), "the same three pages, reordered — none lost").toEqual(afterMenu.slice().sort());
  expect(afterDrag[1], "the dragged page landed on the position it was dropped on").toBe(p1.name);
  await shot(page, "11c-a-order-after-drag");
});

// ===========================================================================
// SRC-11C-N08 — "why the user can choose the same page more than ones in the
// same funnel???"
// ===========================================================================
test("N08 — dropping a section already in this funnel is refused with the verbatim message and no second chip", async ({ page }) => {
  const u = uniqueTag("n08");
  const seed = await seedBoardQuote(apiCtx, "n08");
  const dup = await namedSection(`P6C n08 ${u}`);
  await setPages(apiCtx, seed.variantPublicId, [[dup.id]]);
  await openBoard(page, seed.quotePublicId);

  const pageCard = page.locator(".lg-col-funnel [data-page-card]").first();
  await expect(pageCard.locator("[data-sec-chip]")).toHaveCount(1);
  await dragCenterToCenter(page, page.locator(`[data-lib-card][data-section-public-id="${dup.public_id}"]`), pageCard);
  const err = page.locator(".lg-board-inline-err");
  await expect(err).toBeVisible({ timeout: 20_000 });
  const msg = (await err.textContent()) ?? "";
  note(`N08 refusal message = ${JSON.stringify(msg)}`);
  expect(msg).toContain("is already in this funnel");
  expect(msg).toContain(dup.name);
  await expect(pageCard.locator("[data-sec-chip]"), "still exactly ONE chip — the duplicate never landed").toHaveCount(1);
  await shot(page, "n08-same-page-twice-refused");
});

// ===========================================================================
// SRC-11C-N02 + N03 — "the first page is shared by all the funnels" /
// "we can do AB test for this page as well!"
// ===========================================================================
test("N02·N03 — one shared first page fronts EVERY funnel live, and that shared page is A/B-able from the board (both arms served)", async ({ page }) => {
  const u = uniqueTag("n02");
  const seed = await seedRoutingQuote(apiCtx, {
    tag: "p6cn02",
    funnels: [
      { headline: `P6C N02 funnel ONE ${u}`, field: "n02_one" },
      { headline: `P6C N02 funnel TWO ${u}`, field: "n02_two" },
    ],
  });
  // N02 (board): ONE shared column, marked shared, sitting before the funnels.
  await openBoard(page, seed.quotePublicId);
  await expect(page.locator(".lg-col-shared")).toHaveCount(1);
  const sharedHead = ((await page.locator(".lg-col-shared .lg-col-head").textContent()) ?? "").replace(/\s+/g, " ").trim();
  note(`N02 shared column head = ${JSON.stringify(sharedHead)}; funnel columns = ${await page.locator(".lg-col-funnel").count()}`);
  expect(sharedHead.toLowerCase()).toContain("shared");
  await shot(page, "n02-shared-first-page-column");

  // N02 (live): BOTH funnels front the SAME shared first page. An entry rule
  // sends utm_source=two to funnel TWO; the default serves funnel ONE.
  await createRoutingRule(apiCtx, seed.quotePublicId, {
    rule_name: `N02 to two ${u}`,
    priority: 1,
    conditions: { groups: [{ field: "utm_source", op: "eq", value: "twoarm" }] },
    target_funnel_id: seed.funnels[1]!.public_id,
  });
  const firstPageTextFor = async (qs: string, sid: string): Promise<{ shared: string; funnel: string | null }> => {
    await page.context().clearCookies();
    await page.context().addCookies([{ name: "ko_sid", value: sid, domain: seed.host, path: "/" }]);
    await page.goto(shellUrl(seed.host, seed.slug, `${qs}&_cb=${Date.now()}`), { waitUntil: "domcontentloaded" });
    await ready(page);
    const shared = await visibleFunnelText(page);
    return { shared, funnel: await page.locator("#lg-funnel-root").getAttribute("data-funnel-id") };
  };
  const one = await firstPageTextFor("?utm_source=default", `p6c-n02-a-${u}`);
  const two = await firstPageTextFor("?utm_source=twoarm", `p6c-n02-b-${u}`);
  note(`N02 live: funnel(default)=${one.funnel} funnel(utm=twoarm)=${two.funnel}; shared headline present in both = ${one.shared.includes(seed.sharedHeadline)}/${two.shared.includes(seed.sharedHeadline)}`);
  expect(one.funnel, "the two visitors really landed in DIFFERENT funnels").not.toBe(two.funnel);
  expect(one.shared, "funnel ONE's first page is the shared page").toContain(seed.sharedHeadline);
  expect(two.shared, "funnel TWO's first page is the SAME shared page").toContain(seed.sharedHeadline);
  await shot(page, "n02-live-shared-first-page");

  // N03: A/B that shared page from the board — the real shared-chip kebab.
  const altShared = await namedSection(`P6C N03 shared ARM B ${u}`);
  await openBoard(page, seed.quotePublicId);
  await page.locator(".lg-col-shared [data-sec-chip] [data-chip-kebab]").first().click();
  await page.locator('[data-board-menu="shared-chip"] [data-menu-action="ab-slot"]').click();
  const abDialog = page.locator("[data-shared-ab-dialog]");
  await expect(abDialog).toBeVisible({ timeout: 10_000 });
  // The dialog opens pre-seeded with a second, empty arm; only add one if it
  // did not (never leave a third, unfilled arm behind — that fails the Σ=100).
  const arms = abDialog.locator("[data-ab-arm]");
  if ((await arms.count()) < 2) await abDialog.locator("[data-ab-add-arm]").click();
  await expect(arms).toHaveCount(2);
  await arms.nth(1).locator("[data-ab-arm-section]").selectOption({ label: altShared.name });
  await arms.nth(0).locator("[data-ab-arm-pct]").fill("50");
  await arms.nth(1).locator("[data-ab-arm-pct]").fill("50");
  const abSentence = (await abDialog.locator("[data-ab-sentence]").textContent()) ?? "";
  note(`N03 A/B dialog sentence = ${JSON.stringify(abSentence.trim())}`);
  await shot(page, "n03-shared-page-ab-dialog");
  await abDialog.locator("[data-shared-ab-save]").click();
  await expect(page.locator('.lg-col-shared [data-sec-chip][data-slot-kind="ab"]'), "the shared slot is now an A/B slot").toHaveCount(1, { timeout: 20_000 });
  const chipLabel = (await page.locator(".lg-col-shared [data-sec-chip] .lg-sc-name").first().textContent()) ?? "";
  note(`N03 shared chip after save = ${JSON.stringify(chipLabel.trim())}`);
  await shot(page, "n03-shared-page-ab-saved");

  // N03 live: walk cookie-distinct sessions until BOTH arms have been served.
  // A shared-page slot save changes the served plan; re-save the activation past
  // a 1.1s boundary so no visitor is answered off the pre-save shell (ADJ-N20).
  await page.waitForTimeout(1200);
  await json(await apiCtx.put(`${LG_API}/quotes/${seed.quotePublicId}/activation/${seed.siteId}`, { data: { enabled: true, slug: seed.slug } }), "re-activate");
  const seenArms = new Map<string, string>();
  const draws: string[] = [];
  let lastPlan: unknown = null;
  for (let i = 0; i < 40 && seenArms.size < 2; i++) {
    await page.context().clearCookies();
    await page.context().addCookies([{ name: "ko_sid", value: `p6c-n03-${u}-${i}`, domain: seed.host, path: "/" }]);
    const attemptRes = page.waitForResponse((r) => r.url().includes("/lg/attempt"), { timeout: 15_000 }).catch(() => null);
    await page.goto(shellUrl(seed.host, seed.slug, `?_cb=${Date.now()}-${i}`), { waitUntil: "domcontentloaded" });
    await ready(page);
    const res = await attemptRes;
    lastPlan = res === null ? null : ((await res.json().catch(() => null)) as { page_plan?: unknown } | null)?.page_plan ?? null;
    const txt = await visibleFunnelText(page);
    const arm = txt.includes(altShared.name) ? "B" : txt.includes(seed.sharedHeadline) ? "A" : "?";
    draws.push(arm);
    if (i < 4) {
      const st = await page.evaluate(() => {
        const eng = (window as unknown as { __LG_ENGINE__?: { getState(): Record<string, unknown> } }).__LG_ENGINE__;
        const raw = eng === undefined ? {} : eng.getState();
        return { session: String(raw["session_id"] ?? "") };
      });
      // The plan the SERVER assigned for this session, beside the arm the
      // visitor actually saw — the two must move together.
      note(`N03 draw#${i} visibleArm=${arm} session=${JSON.stringify(st.session)} serverPlan=${JSON.stringify(lastPlan).slice(0, 200)}`);
    }
    if (arm !== "?" && !seenArms.has(arm)) {
      seenArms.set(arm, txt.slice(0, 120));
      await shot(page, `n03-live-shared-arm-${arm}`);
    }
  }
  note(`N03 live shared-page draws (${draws.length}) = ${draws.join("")}`);
  note(`N03 live shared-page arms served = ${seenArms.size} (${[...seenArms.keys()].sort().join(",")})`);
  expect([...seenArms.keys()].sort(), "BOTH arms of the shared first page were actually served").toEqual(["A", "B"]);
});

// ===========================================================================
// SRC-11C-C — "The AB test can be also in the funnel level and not only in the
// page level": a funnel-level A/B with BOTH arms served.
// ===========================================================================
test("11C-C — a funnel-level A/B test authored in the A/B tab serves BOTH arms on the live funnel", async ({ page }) => {
  const u = uniqueTag("11cc");
  const seed = await seedRoutingQuote(apiCtx, { tag: "p6c11cc", funnels: [{ headline: `P6C C arm A ${u}`, field: "c_a" }] });
  const quote = seed.quotePublicId;
  const funnel = seed.funnels[0]!;

  // The real A/B-tab order (§4.3-10): CREATE the test, START it, and only then
  // does "Add variant…" bootstrap the funnel's 2nd arm (a fork adding a second
  // ACTIVE variant is legal only while a test is running — quotes-handlers.ts
  // forkVariantHandler's canBootstrapArm).
  const openAb = async (): Promise<void> => {
    await page.goto(`${ORIGIN}/admin/leadgen/quotes/${quote}/edit`, { waitUntil: "domcontentloaded" });
    await page.locator('[data-tab="ab"]').click();
    await expect(page.locator('[data-panel="ab"]')).toBeVisible();
  };
  await openAb();
  await expect(page.locator(".lg-alloc-row")).toHaveCount(1);
  await page.locator("#lg-create-experiment").click();
  await page.waitForTimeout(1500);
  await openAb();
  await page.locator("[data-start-experiment]").click();
  await page.waitForTimeout(1500);
  await openAb();
  await expect(page.locator('[data-ab-status="running"]'), "the funnel-level A/B test is RUNNING before the 2nd arm is added").toBeVisible({ timeout: 10_000 });
  // "Add variant…" asks (window.prompt) for the NEW ARM'S TRAFFIC SHARE in
  // percent — not a name (funnel.ts forkWithAllocation).
  page.once("dialog", (d) => void d.accept("50"));
  const forkRes = page.waitForResponse((r) => r.url().includes("/fork") && r.request().method() === "POST", { timeout: 20_000 });
  await page.locator("#lg-add-variant").click();
  note(`11C-C fork POST status = ${(await forkRes).status()}`);
  await page.waitForTimeout(1500);
  const err = page.locator("#lg-quote-error");
  if (await err.isVisible().catch(() => false)) note(`11C-C add-variant error banner = ${JSON.stringify((await err.textContent()) ?? "")}`);
  await openAb();
  await expect(page.locator(".lg-alloc-row"), "the funnel now has TWO arms").toHaveCount(2, { timeout: 20_000 });
  await shot(page, "11c-c-two-arms-authored");

  // Give arm B its own distinctive section so the served arm is observable.
  const variants = await json<{ items: Array<{ public_id: string; variant_label: string; traffic_allocation_bp: number }> }>(
    await apiCtx.get(`${LG_API}/funnels/${funnel.public_id}/variants`),
    "variants",
  );
  const armA = variants.items.find((v) => v.public_id === funnel.variant_public_id)!;
  const armB = variants.items.find((v) => v.public_id !== funnel.variant_public_id)!;
  const secB = await distinctiveSection(apiCtx, `P6C C arm B ${u}`, "c_b");
  await setPages(apiCtx, armB.public_id, [[secB.id]]);

  // The bootstrap rebalanced both arms to an even split; confirm the running
  // shape the operator sees before driving visitors.
  await openAb();
  const allocs = await page.locator("[data-alloc-input]").evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
  note(`11C-C arm allocations shown in the A/B tab = ${JSON.stringify(allocs)}`);
  await expect(page.locator('[data-ab-status="running"]'), "the funnel-level A/B test is RUNNING").toBeVisible({ timeout: 10_000 });
  await shot(page, "11c-c-experiment-running");

  // Re-save the activation past a 1.1s boundary (ADJ-N20 shell cache) and walk
  // cookie-distinct sessions until BOTH arms have served.
  await page.waitForTimeout(1200);
  await json(await apiCtx.put(`${LG_API}/quotes/${quote}/activation/${seed.siteId}`, { data: { enabled: true, slug: seed.slug } }), "re-activate");
  const seen = new Map<string, string>();
  for (let i = 0; i < 30 && seen.size < 2; i++) {
    await page.context().clearCookies();
    await page.context().addCookies([{ name: "ko_sid", value: `p6c-11cc-${u}-${i}`, domain: seed.host, path: "/" }]);
    await page.goto(shellUrl(seed.host, seed.slug, `?_cb=${Date.now()}-${i}`), { waitUntil: "domcontentloaded" });
    await ready(page);
    const armId = await page.locator("#lg-funnel-root").getAttribute("data-funnel-variant-id");
    if (armId === null || seen.has(armId)) continue;
    seen.set(armId, armId === armA.public_id ? "A" : "B");
    await shot(page, `11c-c-live-arm-${armId === armA.public_id ? "A" : "B"}`);
  }
  note(`11C-C funnel-level arms served = ${seen.size}: ${JSON.stringify([...seen.entries()])} (A=${armA.public_id} B=${armB.public_id})`);
  expect([...seen.keys()].sort(), "BOTH funnel-level arms actually served").toEqual([armA.public_id, armB.public_id].sort());
});

// ===========================================================================
// SRC-11C-D — "Theme picker per funnel name": each funnel column carries its
// own Theme picker, and two funnels render two DISTINCT themes live.
// ===========================================================================
test("11C-D — every funnel column has its own Theme picker, and two funnels render two distinct themes live", async ({ page }) => {
  const u = uniqueTag("11cd");
  const seed = await seedRoutingQuote(apiCtx, {
    tag: "p6c11cd",
    funnels: [
      { headline: `P6C D funnel A ${u}`, field: "d_a" },
      { headline: `P6C D funnel B ${u}`, field: "d_b" },
    ],
  });

  // The picker is PER funnel name — one on each column, and it opens the theme
  // editor for THAT funnel (SRC-11B: themes live in the top bar).
  await openBoard(page, seed.quotePublicId);
  await expect(page.locator(".lg-col-funnel [data-theme-picker]"), "a Theme picker on EVERY funnel column").toHaveCount(2);
  const names = await page.locator(".lg-col-funnel [data-funnel-name]").allTextContents();
  note(`11C-D funnel names carrying their own Theme picker = ${JSON.stringify(names)}`);
  await page.locator(".lg-col-funnel [data-theme-picker]").first().click();
  await expect(page.locator('[data-panel="themes"]')).toBeVisible({ timeout: 10_000 });
  await shot(page, "11c-d-theme-picker-per-funnel");

  // Author a DIFFERENT theme on each funnel through the real Themes tab (the
  // editor is scoped to the selected funnel's active variant via ?variant=).
  const setThemeVia = async (variantPublicId: string, radius: string, display: string, size: string): Promise<void> => {
    await page.goto(`${ORIGIN}/admin/leadgen/quotes/${seed.quotePublicId}/edit?variant=${variantPublicId}`, { waitUntil: "domcontentloaded" });
    await page.locator('[data-tab="themes"]').click();
    await expect(page.locator("#lg-theme-editor")).toBeVisible({ timeout: 15_000 });
    await page.locator('#lg-theme-editor [data-theme-key="scales.radius"]').selectOption(radius);
    await page.locator('#lg-theme-editor [data-theme-key="typography.display"]').selectOption(display);
    await page.locator('#lg-theme-editor [data-theme-key="typography.size"]').selectOption(size);
    await page.locator("#lg-variant-save").click();
    await expect(page.locator("#lg-quote-ok")).toBeVisible({ timeout: 15_000 });
  };
  await setThemeVia(seed.funnels[0]!.variant_public_id, "sharp", "sora", "s");
  await shot(page, "11c-d-funnel-A-theme-authored");
  await setThemeVia(seed.funnels[1]!.variant_public_id, "round", "fraunces", "l");
  await shot(page, "11c-d-funnel-B-theme-authored");

  const themeA = await json<Record<string, unknown>>(await apiCtx.get(`${LG_API}/funnels/${seed.funnels[0]!.public_id}/theme`), "theme A");
  const themeB = await json<Record<string, unknown>>(await apiCtx.get(`${LG_API}/funnels/${seed.funnels[1]!.public_id}/theme`), "theme B");
  note(`11C-D stored theme A = ${JSON.stringify(themeA).slice(0, 300)}`);
  note(`11C-D stored theme B = ${JSON.stringify(themeB).slice(0, 300)}`);
  expect(JSON.stringify(themeA), "the two funnels hold DIFFERENT themes").not.toBe(JSON.stringify(themeB));

  // LIVE: route one visitor into each funnel and read the PAINTED background.
  await createRoutingRule(apiCtx, seed.quotePublicId, {
    rule_name: `D to B ${u}`,
    priority: 1,
    conditions: { groups: [{ field: "utm_source", op: "eq", value: "funnelb" }] },
    target_funnel_id: seed.funnels[1]!.public_id,
  });
  await page.waitForTimeout(1200);
  await json(await apiCtx.put(`${LG_API}/quotes/${seed.quotePublicId}/activation/${seed.siteId}`, { data: { enabled: true, slug: seed.slug } }), "re-activate");
  const paintOf = async (utm: string, sid: string, label: string): Promise<{ funnel: string | null; bg: string }> => {
    await page.context().clearCookies();
    await page.context().addCookies([{ name: "ko_sid", value: sid, domain: seed.host, path: "/" }]);
    await page.goto(shellUrl(seed.host, seed.slug, `?utm_source=${utm}&_cb=${Date.now()}`), { waitUntil: "domcontentloaded" });
    await ready(page);
    const bg = await page.locator("#lg-funnel-root").evaluate((el) => {
      const cs = getComputedStyle(el);
      const card = el.querySelector("[data-question-id], .lg-card, button") as HTMLElement | null;
      const cardCs = card === null ? null : getComputedStyle(card);
      const head = el.querySelector("h1, h2, .lg-headline") as HTMLElement | null;
      const headCs = head === null ? null : getComputedStyle(head);
      return JSON.stringify({
        rootFont: cs.fontFamily,
        rootSize: cs.fontSize,
        cardRadius: cardCs === null ? null : cardCs.borderRadius,
        headFont: headCs === null ? null : headCs.fontFamily,
        headSize: headCs === null ? null : headCs.fontSize,
      });
    });
    await shot(page, `11c-d-live-${label}`);
    return { funnel: await page.locator("#lg-funnel-root").getAttribute("data-funnel-id"), bg };
  };
  const liveA = await paintOf("plain", `p6c-11cd-a-${u}`, "funnel-A");
  const liveB = await paintOf("funnelb", `p6c-11cd-b-${u}`, "funnel-B");
  note(`11C-D live A funnel=${liveA.funnel} paint=${liveA.bg}`);
  note(`11C-D live B funnel=${liveB.funnel} paint=${liveB.bg}`);
  expect(liveA.funnel, "the two visitors really landed in different funnels").not.toBe(liveB.funnel);
  expect(liveA.bg, "the two funnels PAINT two distinct themes").not.toBe(liveB.bg);
});

// ===========================================================================
// SRC-11C-R — "the funnel is decided per user answers durring the questionarie
// or per the user parameters (UTMs / Claudflare data such as device/os/time/day
// and so on)": the ANSWER plane (checkpoint) and the PARAMETER plane (entry),
// each with its recorded leadgen_routing_outcomes row.
// ===========================================================================
test("11C-R — a UTM/device parameter routes at ENTRY and a questionnaire ANSWER routes at CHECKPOINT, both recorded in leadgen_routing_outcomes", async ({ page }) => {
  const u = uniqueTag("11cr");
  const seed = await seedRoutingQuote(apiCtx, {
    tag: "p6c11cr",
    sharedQuestionField: "own_home",
    sharedChoices: [{ label: "Yes I own", value: "yes" }, { label: "No I rent", value: "no" }],
    funnels: [
      { headline: `P6C R DEFAULT ${u}`, field: "r_def" },
      { headline: `P6C R PARAM ${u}`, field: "r_param" },
      { headline: `P6C R ANSWER ${u}`, field: "r_answer" },
    ],
  });
  // PARAM plane (entry): UTM source + device.
  await createRoutingRule(apiCtx, seed.quotePublicId, {
    rule_name: `R entry utm+device ${u}`,
    priority: 1,
    conditions: { groups: [{ field: "utm_source", op: "eq", value: "paramplane" }, { field: "device", op: "eq", value: "desktop" }] },
    target_funnel_id: seed.funnels[1]!.public_id,
  });
  // ANSWER plane (checkpoint): the shared questionnaire answer.
  await createRoutingRule(apiCtx, seed.quotePublicId, {
    rule_name: `R checkpoint answer ${u}`,
    priority: 2,
    conditions: { groups: [{ field: "own_home", op: "eq", value: "yes" }] },
    target_funnel_id: seed.funnels[2]!.public_id,
  });
  // The rail shows both, and each states its own checkpoint plane in words.
  await openBoard(page, seed.quotePublicId);
  const ckpts = await page.locator("#lg-qr-rail [data-qr-ckpt-text]").allTextContents();
  note(`11C-R rail checkpoints = ${JSON.stringify(ckpts)}`);
  await shot(page, "11c-r-two-planes-in-rail");

  await page.waitForTimeout(1200);
  await json(await apiCtx.put(`${LG_API}/quotes/${seed.quotePublicId}/activation/${seed.siteId}`, { data: { enabled: true, slug: seed.slug } }), "re-activate");

  // ENTRY drive — the parameter decides the funnel before a single answer.
  await page.context().clearCookies();
  const entrySid = `p6c-11cr-entry-${u}`;
  await page.context().addCookies([{ name: "ko_sid", value: entrySid, domain: seed.host, path: "/" }]);
  await page.goto(shellUrl(seed.host, seed.slug, `?utm_source=paramplane&_cb=${Date.now()}`), { waitUntil: "domcontentloaded" });
  await ready(page);
  const entryFunnel = await page.locator("#lg-funnel-root").getAttribute("data-funnel-id");
  const entryVariant = await page.locator("#lg-funnel-root").getAttribute("data-funnel-variant-id");
  const entryAttempt = await attemptIdOf(page);
  await shot(page, "11c-r-entry-param-routed");
  expect(entryFunnel, "the UTM/device parameter alone chose the PARAM funnel at entry").toBe(seed.funnels[1]!.public_id);
  expect(entryVariant).toBe(seed.funnels[1]!.variant_public_id);

  // CHECKPOINT drive — a fresh visitor with NO matching parameter answers the
  // questionnaire, and the ANSWER moves them.
  await page.context().clearCookies();
  const ckSid = `p6c-11cr-ck-${u}`;
  await page.context().addCookies([{ name: "ko_sid", value: ckSid, domain: seed.host, path: "/" }]);
  const cks = captureCheckpoints(page);
  await page.goto(shellUrl(seed.host, seed.slug, `?utm_source=none&_cb=${Date.now()}`), { waitUntil: "domcontentloaded" });
  await ready(page);
  const beforeAnswer = await page.locator("#lg-funnel-root").getAttribute("data-funnel-id");
  const ckAttempt = await attemptIdOf(page);
  await page.locator('[data-lg-choice="yes"]').first().click();
  await page.locator("[data-lg-continue]").first().click();
  await expect
    .poll(() => cks.filter((c) => c.sw === true).length, { timeout: 12_000, message: "the questionnaire ANSWER fired a checkpoint switch" })
    .toBeGreaterThanOrEqual(1);
  const sw = cks.find((c) => c.sw === true)!;
  await page.waitForTimeout(1200);
  const bodyAfter = await visibleFunnelText(page);
  await shot(page, "11c-r-checkpoint-answer-routed");
  expect(beforeAnswer, "before answering, the no-parameter visitor sits in the DEFAULT funnel").toBe(seed.funnels[0]!.public_id);
  expect(sw.v, "the ANSWER switched the visitor into the ANSWER funnel's variant").toBe(seed.funnels[2]!.variant_public_id);

  const rows = d1Query<{ plane: string; routed_to_funnel: string; matched_rule_hash: string | null }>(
    `SELECT plane, routed_to_funnel, matched_rule_hash FROM leadgen_routing_outcomes WHERE funnel_attempt_id IN ('${(entryAttempt ?? "").replace(/'/g, "")}','${(ckAttempt ?? "").replace(/'/g, "")}')`,
  );
  note(`11C-R entry: funnel=${entryFunnel} attempt=${entryAttempt}; checkpoint: before=${beforeAnswer} attempt=${ckAttempt} switchedTo=${sw.v}; after-answer body contains ANSWER section = ${bodyAfter.includes(`P6C R ANSWER ${u}`)}`);
  note(`11C-R leadgen_routing_outcomes rows = ${JSON.stringify(rows)}`);
  const planes = rows.map((r) => r.plane).sort();
  expect(planes, "BOTH planes recorded a routing outcome").toEqual(["checkpoint", "entry"]);
  expect(rows.every((r) => r.matched_rule_hash !== null && r.matched_rule_hash !== ""), "each outcome names the rule that matched").toBe(true);
  expect(rows.find((r) => r.plane === "entry")!.routed_to_funnel, "the PARAMETER plane recorded the PARAM funnel").toBe(seed.funnels[1]!.public_id);
  expect(rows.find((r) => r.plane === "checkpoint")!.routed_to_funnel, "the ANSWER plane recorded the ANSWER funnel").toBe(seed.funnels[2]!.public_id);
  note(`11C-R post-answer visible body head = ${JSON.stringify(bodyAfter.slice(0, 160))}`);
});

// ===========================================================================
// SRC-11C-N11 + N12 — "the rules you build are using jargon, have no actions" /
// "Image42 here it how it builds in the reference".
// ===========================================================================
test("N11·N12 — a rule authored in the real modal reads as a plain-language sentence WITH actions (and the modal is captured for the Image42 side-by-side)", async ({ page }) => {
  const u = uniqueTag("n11");
  const seed = await seedBoardQuote(apiCtx, "n11");
  const sec = await distinctiveSection(apiCtx, `P6C N11 ${u}`, "n11_field");
  await setPages(apiCtx, seed.variantPublicId, [[sec.id]]);
  await json(await apiCtx.post(`${LG_API}/quotes/${seed.quotePublicId}/funnels`, { data: { funnel_name: `Short funnel ${u}` } }), "funnel 2");
  await openBoard(page, seed.quotePublicId);

  // Author through the REAL modal.
  await page.locator("[data-qr-new]").click();
  const modal = page.locator("#lg-qr-modal");
  await expect(modal).toBeVisible({ timeout: 10_000 });
  await modal.locator("[data-qr-modal-name]").fill(`Desktop California ${u}`);
  await modal.locator("[data-qr-modal-priority]").fill("2");
  const condMount = modal.locator("#lg-qr-cond-mount");
  await condMount.getByRole("button", { name: "+ Add condition" }).click();
  await condMount.locator(".lg-rb-field").first().selectOption("device");
  await condMount.locator(".lg-rb-value").first().fill("desktop");
  // Each action row is a switch — set it explicitly (a fresh rule opens with
  // every action OFF, which is why the draft sentence says "do nothing yet").
  const setAction = async (act: string, on: boolean): Promise<void> => {
    const sw = modal.locator(`[data-qr-action="${act}"] [data-qr-action-toggle]`);
    if (((await sw.getAttribute("aria-checked")) === "true") !== on) await sw.click();
  };
  await setAction("target_funnel", true);
  await modal.locator("[data-qr-target-funnel]").selectOption({ index: 1 });
  await setAction("feed_name", true);
  await modal.locator("[data-qr-feed-name]").fill("short");
  await setAction("value_multiplier", true);
  await modal.locator("[data-qr-multiplier]").fill("0.5");
  await setAction("redirect_pct", false);
  await setAction("redirect_target", false);
  await page.waitForTimeout(400);
  const sentence = ((await modal.locator("[data-qr-sentence]").textContent()) ?? "").replace(/\s+/g, " ").trim();
  const checkpoint = ((await modal.locator("[data-qr-modal-checkpoint]").textContent()) ?? "").trim();
  note(`N11 modal sentence = ${JSON.stringify(sentence)}`);
  note(`N11 modal checkpoint (read-only, derived) = ${JSON.stringify(checkpoint)}`);
  // N12 artifact: the built rule-builder, same state Image42 shows.
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${EVIDENCE_DIR}/n12-rule-builder-modal-1280.png`, fullPage: false });
  await shot(page, "n11-modal-plain-language");

  expect(sentence.length, "the modal states the rule in plain language BEFORE saving").toBeGreaterThan(20);
  for (const jargon of ["conditions_json", "target_funnel_id", "value_multiplier", "eq", "{", "}"]) {
    expect(sentence, `the sentence carries no jargon token "${jargon}"`).not.toContain(jargon);
  }

  await modal.locator("[data-qr-save]").click();
  await expect(modal).toBeHidden({ timeout: 15_000 });
  const card = page.locator("#lg-qr-rail [data-qr-card]").first();
  await expect(card).toBeVisible({ timeout: 15_000 });
  const condChips = await card.locator("[data-qr-cond-summ] .lg-qr-chip").allTextContents();
  const actChips = await card.locator("[data-qr-act-summ] .lg-qr-chip").allTextContents();
  const footActions = await card.locator(".lg-qr-foot [role='button'], .lg-qr-foot [role='switch']").count();
  note(`N11 saved card conditions = ${JSON.stringify(condChips)}`);
  note(`N11 saved card actions = ${JSON.stringify(actChips)} ; card affordances = ${footActions}`);
  expect(actChips.join(" | "), "the card states real ACTIONS, not 'No actions yet'").not.toContain("No actions yet");
  expect(actChips.length, "at least the two actions authored").toBeGreaterThanOrEqual(2);
  expect(condChips.join(" ").toLowerCase(), "conditions read in words").toContain("device");
  expect(footActions, "the card offers actions on the rule itself (Edit / Duplicate / toggle / delete)").toBeGreaterThanOrEqual(4);
  await shot(page, "n11-saved-rule-card");
});

// ===========================================================================
// SRC-11C-B — "each page could include more than one section and we should be
// able to A/B test or creating in-funnel rules (show in CA this section in this
// page, and in the rest show this sectio, for example)". The LIVE-GEO leg
// (state == CA on a real Cloudflare edge) is POST-DEPLOY and is NOT decided
// here — this drives the multi-section page and the two operator authoring
// paths (A/B slot + ruled slot) on a FUNNEL page.
// ===========================================================================
test("11C-B — a funnel page carries MORE THAN ONE section, and its chips offer both A/B-this-slot and a CA slot rule (live-geo leg is post-deploy)", async ({ page }) => {
  const u = uniqueTag("11cb");
  const seed = await seedBoardQuote(apiCtx, "11cb");
  const s1 = await namedSection(`P6C B first ${u}`);
  const s2 = await namedSection(`P6C B second ${u}`);
  const sCA = await namedSection(`P6C B california ${u}`);
  const sAlt = await namedSection(`P6C B altarm ${u}`);
  // ONE page, TWO sections (the "more than one section" half).
  await setPages(apiCtx, seed.variantPublicId, [[s1.id, s2.id]]);
  await openBoard(page, seed.quotePublicId);
  const pageCards = page.locator(".lg-col-funnel [data-page-card]");
  await expect(pageCards).toHaveCount(1);
  await expect(pageCards.first().locator("[data-sec-chip]"), "ONE page carrying TWO sections").toHaveCount(2);
  note(`11C-B page 1 chips = ${JSON.stringify(await pageCards.first().locator(".lg-sc-name").allTextContents())}`);
  await shot(page, "11c-b-multi-section-page");

  // Authoring path 1 — A/B this slot, from the FUNNEL chip's own kebab.
  await pageCards.first().locator("[data-sec-chip]").first().locator("[data-chip-kebab]").click();
  const menu = page.locator('[data-board-menu="funnel-chip"]');
  await expect(menu).toBeVisible();
  const menuItems = await menu.locator("[data-menu-action]").allTextContents();
  note(`11C-B funnel-page chip kebab entries = ${JSON.stringify(menuItems)}`);
  expect(menuItems.join(" | "), "the funnel-page chip offers A/B this slot").toContain("A/B this slot");
  expect(menuItems.join(" | "), "the funnel-page chip offers Slot rule").toContain("Slot rule");
  await menu.locator('[data-menu-action="ab-slot"]').click();
  const abDialog = page.locator("[data-shared-ab-dialog]");
  await expect(abDialog).toBeVisible({ timeout: 10_000 });
  const arms = abDialog.locator("[data-ab-arm]");
  if ((await arms.count()) < 2) await abDialog.locator("[data-ab-add-arm]").click();
  await expect(arms).toHaveCount(2);
  await arms.nth(1).locator("[data-ab-arm-section]").selectOption({ label: sAlt.name });
  await arms.nth(0).locator("[data-ab-arm-pct]").fill("50");
  await arms.nth(1).locator("[data-ab-arm-pct]").fill("50");
  note(`11C-B A/B dialog sentence = ${JSON.stringify(((await abDialog.locator("[data-ab-sentence]").textContent()) ?? "").trim())}`);
  await shot(page, "11c-b-funnel-slot-ab-dialog");
  await abDialog.locator("[data-shared-ab-save]").click();
  await expect(page.locator('.lg-col-funnel [data-sec-chip][data-slot-kind="ab"]'), "slot 1 is now an A/B slot").toHaveCount(1, { timeout: 20_000 });

  // Authoring path 2 — the owner's own example: "show in CA this section in
  // this page, and in the rest show this sectio". Re-open the board first: the
  // A/B save reloads it, and clicking into a half-rendered board leaves the
  // chip menu closed.
  await openBoard(page, seed.quotePublicId);
  await expect(page.locator(".lg-col-funnel [data-sec-chip]")).toHaveCount(2);
  const chipMenu = page.locator('[data-board-menu="funnel-chip"]');
  await page.locator(".lg-col-funnel [data-sec-chip]").nth(1).locator("[data-chip-kebab]").click();
  await expect(chipMenu).toBeVisible({ timeout: 10_000 });
  await chipMenu.locator('[data-menu-action="slot-rule"]').click();
  const ruled = page.locator("[data-shared-ruled-dialog]");
  await expect(ruled).toBeVisible({ timeout: 10_000 });
  const cases = ruled.locator("[data-ruled-case]");
  if ((await cases.count()) < 1) await ruled.locator("[data-ruled-add-case]").click();
  await expect(cases).toHaveCount(1);
  const kase = cases.first();
  await kase.locator("[data-ruled-field]").selectOption("state");
  await kase.locator("[data-ruled-value]").fill("CA");
  await kase.locator("[data-ruled-section]").selectOption({ label: sCA.name });
  await ruled.locator("[data-ruled-default]").selectOption({ label: s2.name });
  await page.waitForTimeout(300);
  const ruledSentence = ((await ruled.locator("[data-ruled-sentence]").textContent()) ?? "").replace(/\s+/g, " ").trim();
  note(`11C-B ruled-slot plain-language sentence = ${JSON.stringify(ruledSentence)}`);
  await shot(page, "11c-b-ca-slot-rule-dialog");
  await ruled.locator("[data-shared-ruled-save]").click();
  await expect(page.locator('.lg-col-funnel [data-sec-chip][data-slot-kind="ruled"]'), "slot 2 is now a RULED slot").toHaveCount(1, { timeout: 20_000 });
  await shot(page, "11c-b-slots-authored");

  // Server truth: the saved plan really carries an ab slot and a ruled CA slot.
  const structure = await json<{
    funnels: Array<{ public_id: string; active_variant_pages?: Array<{ slots: Array<{ kind: string; candidates: unknown[] }> }> }>;
  }>(await apiCtx.get(`${LG_API}/quotes/${seed.quotePublicId}/structure`), "structure");
  const savedPages = structure.funnels.find((f) => f.public_id === seed.funnelPublicId)?.active_variant_pages ?? [];
  const kinds = savedPages.flatMap((p) => p.slots.map((s) => s.kind));
  note(`11C-B saved slot kinds = ${JSON.stringify(kinds)}`);
  note(`11C-B saved page-1 slots = ${JSON.stringify(savedPages[0]?.slots).slice(0, 500)}`);
  expect(kinds, "both authoring paths round-tripped to the server").toEqual(expect.arrayContaining(["ab", "ruled"]));
  expect(ruledSentence.length, "the ruled-slot dialog states the rule in plain language").toBeGreaterThan(10);
  note("11C-B LIVE-GEO leg (a real CF edge reporting state=CA) is POST-DEPLOY — NOT decided by this run.");
});
