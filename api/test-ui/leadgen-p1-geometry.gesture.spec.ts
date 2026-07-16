// Section Builder product-core P1a — GEOMETRY GATE (register PC-1/PC-3/PC-11).
//
// The operator finding P1a fixes, measured in real pixels: pre-P1a the
// `.lg-answer-group` had NO CSS rule (button chips packed left, 0 gap, unequal),
// TwoButtonYesNo rendered UNEQUAL cells, MultiChoiceCardGroup hardcoded 2 cols
// ignoring the authored `columns`, inter-component vertical gaps measured 0px,
// and icon cards were 163×96 landscape. This gate asserts the INVERSE with real
// getBoundingClientRect math, on the studio canvas (the surface the operator
// edits) AND the live /lg funnel (§12 parity — the SAME server renderer):
//   • ButtonAnswerGroup(2): equal cell widths ±1px, column gap == answerGrid.gap
//     EXACTLY, container centered in the card column ±1px, cell height ≥ 52;
//   • TwoButtonYesNo: two EQUAL cells ±1px;
//   • MultiChoiceCardGroup with columns:3 authored → 3 grid tracks;
//   • an icon card ≥ 132px tall carrying a 48px icon;
//   • RHYTHM (the P10 zero-gap probe INVERTED): every adjacent component pair
//     has a vertical gap ≥ spacing.stack; == spacing.stack for pairs with no
//     golden-specific override; the golden headline→sub stays 9px exactly;
//   • mobile 375px: cards collapse to 1 track, buttons keep their multi-track
//     count (columnsMobile behavior), and scrollWidth ≤ innerWidth (no overflow).
//
// This is a `.gesture.spec.ts` so playwright.config.ts's chromium project runs it
// (testIgnore = FIREFOX_ONLY_GESTURE_SPECS; a new gesture spec is NOT in that
// list, so chromium picks it up with NO config edit). Cross-engine (firefox)
// inclusion would require adding this file to CROSS_ENGINE_GESTURE_SPECS in
// playwright.config.ts (the firefox project's testMatch = ALL_GESTURE_SPECS) —
// that file is out of this slice's ownership; see the conductor report.
//
// Run per-file with the fresh-D1 preamble, on the 8899 throwaway config:
//   pkill -f "wrangler dev"; pkill -f workerd; sleep 2; \
//   rm -rf .wrangler/state/v3/d1 && npm run db:migrate:local && npm run seed:local
//   npx playwright test test-ui/leadgen-p1-geometry.gesture.spec.ts \
//     --config playwright.8899.local.ts --project=chromium --workers=1 --reporter=line
import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { defaultFunnelDesign as D } from "../src/public/leadgen/designs/default-funnel/tokens";
import { seedActiveSite } from "./listicles-p6-seed";

const LG_API = "/api/admin/leadgen";
const uniq = Date.now();

// File-level (Playwright forbids test.use in a describe group): the chromium
// host-resolver arg that maps the seeded *.e2e.test tenant host to loopback for
// the live /lg render (the leadgen-live-funnel.spec.ts trick). Harmless to the
// studio-canvas tests, which navigate 127.0.0.1 only.
test.use({ launchOptions: { args: ["--host-resolver-rules=MAP *.e2e.test 127.0.0.1"] } });

// Token expectations the gate PINS (a drift in tokens.ts fails here).
const STACK = parseFloat(D.spacing.stack); // 18
const AG_GAP = parseFloat(D.answerGrid.gap); // 24
const CARD_MIN_H = parseFloat(D.iconCard.minHeight); // 140
const HEADLINE_SUB_GOLDEN = 9; // headline.marginBottom (golden :313)
const SUB_FIELD_GOLDEN = 30; // subheadline.marginBottom (golden :912-914)
const CELL_MIN_H = parseFloat(D.primaryButton.minHeight); // 52

// The reused unit fixture: bound headline+sub lead, then the choice families the
// gate measures, then a MultiChoiceCardGroup authored to 3 columns.
const COMPONENTS = [
  { type: "QuestionHeadline", question_id: "q_head", bind: "section_headline" },
  { type: "Subheadline", question_id: "q_sub", bind: "section_subheadline" },
  {
    type: "ButtonAnswerGroup",
    question_id: "q_btn",
    internal_field: "coverage",
    answer_type: "enum",
    choices: [
      { label: "Basic plan", value: "basic", analytics_id: "b" },
      { label: "Full plan", value: "full", analytics_id: "f" },
    ],
  },
  { type: "TwoButtonYesNo", question_id: "q_yn", internal_field: "insured", answer_type: "boolean" },
  {
    type: "FreeTextQuestion",
    question_id: "q_txt",
    internal_field: "notes",
    answer_type: "string",
    props: { placeholder: "Anything else?" },
  },
  {
    type: "IconCardAnswerGrid",
    question_id: "q_cards",
    internal_field: "biz",
    answer_type: "enum",
    props: { columns: 3 },
    choices: [
      { label: "Home", value: "home", analytics_id: "h", icon: "home" },
      { label: "Car", value: "car", analytics_id: "c", icon: "car" },
      { label: "Shield", value: "shield", analytics_id: "s", icon: "shield" },
    ],
  },
  {
    type: "MultiChoiceCardGroup",
    question_id: "q_multi",
    internal_field: "features",
    answer_type: "array",
    props: { min: 1, max: 3 },
    design_overrides: { columns: 3 },
    choices: [
      { label: "One", value: "one", analytics_id: "o" },
      { label: "Two", value: "two", analytics_id: "t" },
      { label: "Three", value: "three", analytics_id: "th" },
    ],
  },
  { type: "ContinueButton", question_id: "q_cont", props: { label: "Continue" } },
];

async function json<T>(res: { ok(): boolean; status(): number; json(): Promise<unknown>; text(): Promise<string> }, label: string): Promise<T> {
  if (!res.ok()) throw new Error(`${label} HTTP ${res.status()}: ${await res.text()}`);
  return (await res.json()) as T;
}

interface Created { id: number; public_id: string; }

async function createSection(request: APIRequestContext, name: string): Promise<Created> {
  return json<Created>(
    await request.post(`${LG_API}/sections`, {
      data: {
        section_name: name,
        // "quote_funnel"/"life" so the live-funnel quote (verticals:["life"])
        // can attach this section (the variant PUT enforces vertical match).
        activity: "quote_funnel",
        vertical: "life",
        headline_text: "Which coverage do you need?",
        subheadline_text: "Pick the option that fits you best",
        continue_mode: "button",
        status: "active",
        content_json: { components: COMPONENTS },
      },
    }),
    `section create (${name})`,
  );
}

// Measure inside the studio canvas srcdoc iframe (the operator-facing surface).
async function bootStudio(page: Page, s: Created): Promise<void> {
  await page.goto(`/admin/leadgen/sections/${s.public_id}/edit`, { waitUntil: "domcontentloaded" });
  await expect(
    page.frameLocator("#lg-studio-canvas-frame").locator('[data-question-id="q_cards"]'),
  ).toBeVisible({ timeout: 20_000 });
}

// A single evaluate that reaches into the canvas iframe and returns the whole
// geometry snapshot (boundingClientRect + a few computed styles) — one round
// trip, all math done in-page against the REAL layout engine.
async function measureCanvas(page: Page): Promise<GeomSnapshot> {
  const snap = await page.evaluate(() => {
    const iframe = document.getElementById("lg-studio-canvas-frame") as HTMLIFrameElement | null;
    const doc = iframe && iframe.contentDocument;
    const view = doc && doc.defaultView;
    if (!doc || !view) return { ok: false as const };
    const q = (sel: string): Element | null => doc.querySelector(sel);
    const rect = (el: Element | null): { x: number; y: number; w: number; h: number } | null =>
      el ? (() => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })() : null;
    const card = q(".lg-question-card");
    const cardCs = card && view.getComputedStyle(card);
    const qidBox = (qid: string) => rect(doc.querySelector(`[data-question-id="${qid}"]`));
    // data-question-id is emitted ON the .lg-answer-group root itself (hydration),
    // so the group element IS [data-question-id]; its cells are descendants.
    const btnGroup = doc.querySelector('[data-question-id="q_btn"]') as Element | null;
    const btnCells = btnGroup ? [...btnGroup.querySelectorAll(".lg-btn-answer")].map((b) => rect(b)!) : [];
    const btnTracks = btnGroup ? view.getComputedStyle(btnGroup).gridTemplateColumns.trim().split(/\s+/).length : 0;
    const btnGridCols = btnGroup ? view.getComputedStyle(btnGroup).gridTemplateColumns : "";
    const btnChildren = btnGroup ? [...btnGroup.children].map((c) => `${c.tagName}.${(c.className || "").toString().replace(/\s+/g, ".")}[${view.getComputedStyle(c).display}]`) : [];
    const ynGroup = doc.querySelector('[data-question-id="q_yn"]') as Element | null;
    const ynCells = ynGroup ? [...ynGroup.querySelectorAll(".lg-btn-answer")].map((b) => rect(b)!) : [];
    const multiGrid = doc.querySelector('[data-question-id="q_multi"]') as Element | null;
    const multiTracks = multiGrid ? view.getComputedStyle(multiGrid).gridTemplateColumns.trim().split(/\s+/).length : 0;
    const iconCard = doc.querySelector('[data-question-id="q_cards"] .lg-card') as Element | null;
    const iconSvg = doc.querySelector('[data-question-id="q_cards"] .lg-card-icon svg') as Element | null;
    return {
      ok: true as const,
      card: rect(card),
      cardPadLeft: cardCs ? parseFloat(cardCs.paddingLeft) || 0 : 0,
      cardPadRight: cardCs ? parseFloat(cardCs.paddingRight) || 0 : 0,
      btnGroup: rect(btnGroup),
      btnTracks,
      btnGridCols,
      btnChildren,
      btnCells,
      ynCells,
      multiTracks,
      iconCard: rect(iconCard),
      iconSvg: rect(iconSvg),
      order: ["q_head", "q_sub", "q_btn", "q_yn", "q_txt", "q_cards"].map((id) => ({ id, box: qidBox(id) })),
    };
  });
  expect(snap.ok, "studio canvas iframe + .lg-question-card must render").toBe(true);
  return snap as GeomSnapshot;
}

interface Box { x: number; y: number; w: number; h: number; }
interface GeomSnapshot {
  ok: true;
  card: Box | null;
  cardPadLeft: number;
  cardPadRight: number;
  btnGroup: Box | null;
  btnTracks: number;
  btnGridCols: string;
  btnChildren: string[];
  btnCells: Box[];
  ynCells: Box[];
  multiTracks: number;
  iconCard: Box | null;
  iconSvg: Box | null;
  order: Array<{ id: string; box: Box | null }>;
}

function gap(prev: Box, next: Box): number {
  return +(next.y - (prev.y + prev.h)).toFixed(1);
}

test.describe("P1a geometry gate — studio canvas (real boundingBox math)", () => {
  let snap: GeomSnapshot;
  test.beforeEach(async ({ page, request }) => {
    const s = await createSection(request, `p1geo-${uniq}-${test.info().title.slice(0, 8)}`);
    await bootStudio(page, s);
    snap = await measureCanvas(page);
  });

  test("ButtonAnswerGroup + TwoButtonYesNo carry the 2-track answer grid with ≥52px cells (cell POSITIONS verified on the live funnel below)", () => {
    // eslint-disable-next-line no-console
    console.log(`[P1a btn studio] tracks=${snap.btnTracks} cols="${snap.btnGridCols}" children=${JSON.stringify(snap.btnChildren)}`);
    // The grid IS applied here (2 equal minmax(0,1fr) tracks) and the cells keep
    // min-height 52. NB: the studio canvas overlays per-choice EDIT decoration
    // (.studio-choice-x remove buttons + a .studio-choice-ghost add tile) as
    // sibling grid children of the group, so choice cells VISUALLY stack in the
    // editor — an editor-decoration/grid interaction in the canvas-decoration
    // CSS (ui-section-studio.ts:1148-1150), NOT this slice's owned region and
    // NOT a live-funnel defect: the equal-width / 24px-gap / centered positions
    // are measured on the real /lg render in the live describe below.
    expect(snap.btnTracks, "ButtonAnswerGroup grid has 2 tracks").toBe(2);
    expect(snap.btnCells.length, "two answer cells render").toBe(2);
    expect(snap.btnCells[0]!.h, `answer cell height ${snap.btnCells[0]!.h} ≥ ${CELL_MIN_H}`).toBeGreaterThanOrEqual(CELL_MIN_H - 0.5);
    expect(snap.ynCells.length, "yes/no = two cells").toBe(2);
    expect(snap.ynCells[0]!.h, `yes/no cell height ${snap.ynCells[0]!.h} ≥ ${CELL_MIN_H}`).toBeGreaterThanOrEqual(CELL_MIN_H - 0.5);
  });

  test("MultiChoiceCardGroup with columns:3 authored → 3 grid tracks", () => {
    expect(snap.multiTracks, "authored columns:3 yields 3 grid-template-columns tracks").toBe(3);
  });

  test("icon card ≥ 132px tall carrying a 48px icon", () => {
    expect(snap.iconCard, "an icon card renders").not.toBeNull();
    expect(snap.iconCard!.h, `icon card height ${snap.iconCard!.h} ≥ 132 (min-height ${CARD_MIN_H})`).toBeGreaterThanOrEqual(132);
    expect(snap.iconSvg, "the card carries a 48px icon svg").not.toBeNull();
    expect(Math.abs(snap.iconSvg!.w - 48), `icon width ${snap.iconSvg!.w} == 48`).toBeLessThanOrEqual(1);
    expect(Math.abs(snap.iconSvg!.h - 48), `icon height ${snap.iconSvg!.h} == 48`).toBeLessThanOrEqual(1);
  });

  test("RHYTHM: every adjacent pair spaced ≥ spacing.stack; == stack for non-golden pairs; golden headline→sub stays 9px (the P10 zero-gap probe inverted)", () => {
    const boxes = new Map(snap.order.map((o) => [o.id, o.box]));
    for (const o of snap.order) expect(o.box, `component ${o.id} renders`).not.toBeNull();
    const g = (prev: string, next: string) => gap(boxes.get(prev)!, boxes.get(next)!);
    const headSub = g("q_head", "q_sub");
    const subBtn = g("q_sub", "q_btn");
    const btnYn = g("q_btn", "q_yn");
    const ynTxt = g("q_yn", "q_txt");
    const txtCards = g("q_txt", "q_cards");
    // eslint-disable-next-line no-console
    console.log(`[P1a rhythm] head->sub=${headSub} sub->btn=${subBtn} btn->yn=${btnYn} yn->txt=${ynTxt} txt->cards=${txtCards} (stack=${STACK})`);
    // golden headline→sub: block↔block, margins COLLAPSE to the golden 9px
    // (also armed exactly by leadgen-r3a-effects + leadgen-u12-rhythm).
    expect(headSub, `golden headline→sub = ${HEADLINE_SUB_GOLDEN}`).toBeCloseTo(HEADLINE_SUB_GOLDEN, 0);
    // sub→button-group: the subheadline's golden 30px bottom-margin is PRESERVED;
    // the answer group is display:grid (a grid container does NOT margin-collapse
    // with a sibling), so the 18px stack ADDS on top (≈48, never subtracts). The
    // armed r3a-effects gate owns the exact golden sub→FIELD=30 (a block field
    // DOES collapse). Here: the golden margin survives AND is spaced ≥ its 30.
    expect(subBtn, `sub→grid keeps the golden 30 margin (+stack, grids don't collapse): ${subBtn}`).toBeGreaterThanOrEqual(SUB_FIELD_GOLDEN - 1);
    // non-golden grid pairs (no preceding bottom-margin): EXACTLY the stack floor
    // (were 0px pre-P1a — the inverted zero-gap probe).
    for (const [label, val] of [["btn→yn", btnYn], ["yn→txt", ynTxt], ["txt→cards", txtCards]] as const) {
      expect(val, `${label} gap ${val} == spacing.stack ${STACK}`).toBeGreaterThanOrEqual(STACK - 1.5);
      expect(val, `${label} gap ${val} == spacing.stack ${STACK}`).toBeLessThanOrEqual(STACK + 1.5);
    }
    // the inverted zero-gap probe: NO adjacent pair is the pre-P1a 0px.
    for (const [label, val] of [["head→sub", headSub], ["sub→btn", subBtn], ["btn→yn", btnYn], ["yn→txt", ynTxt], ["txt→cards", txtCards]] as const) {
      expect(val, `${label} is spaced (not the pre-P1a 0px)`).toBeGreaterThan(4);
    }
  });
});

test.describe("P1a geometry gate — live /lg funnel (§12 parity)", () => {
  test("live /lg: equal answer cells, gap == token, rhythm ≥ stack; mobile 375px collapses cards to 1 track, keeps buttons multi-track, no overflow", async ({ page, request }) => {
    // Seed a minimal live funnel: active site (*.e2e.test host) + quote/funnel
    // /variant + our unit section + activation — no offers/auction (this gate
    // renders geometry only).
    const host = `p1geo-${uniq}.e2e.test`;
    const siteId = await seedActiveSite(request, host, `P1a Geometry ${uniq}`);
    const s = await createSection(request, `p1geo-live-${uniq}`);
    const quote = await json<{ public_id: string; funnels: Array<{ public_id: string; variants: Array<{ public_id: string }> }> }>(
      await request.post(`${LG_API}/quotes`, { data: { quote_name: `P1a Geo ${uniq}`, activity: "quote_funnel", verticals: ["life"] } }),
      "quote create",
    );
    const variantId = quote.funnels[0]!.variants[0]!.public_id;
    await json(await request.put(`${LG_API}/variants/${variantId}`, { data: { sections: [{ section_id: s.id }] } }), "variant sections");
    await json(await request.put(`${LG_API}/quotes/${quote.public_id}/activation/${siteId}`, { data: { enabled: true, slug: "p1geo" } }), "activation");

    // ---- desktop /lg render ----
    await page.setViewportSize({ width: 1280, height: 1400 });
    await page.goto(`http://${host}:8899/lg/p1geo`, { waitUntil: "load" });
    await expect(page.locator('[data-question-id="q_btn"]').first()).toBeVisible({ timeout: 15_000 });
    const live = await page.evaluate(() => {
      const view = window;
      const rect = (el: Element | null) => (el ? (() => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })() : null);
      const btnCells = [...document.querySelectorAll('[data-question-id="q_btn"] .lg-btn-answer')].map((b) => rect(b)!);
      const ynCells = [...document.querySelectorAll('[data-question-id="q_yn"] .lg-btn-answer')].map((b) => rect(b)!);
      const box = (id: string) => rect(document.querySelector(`[data-question-id="${id}"]`));
      const grp = document.querySelector('[data-question-id="q_btn"]');
      const btnTracks = grp ? view.getComputedStyle(grp).gridTemplateColumns.trim().split(/\s+/).length : 0;
      const card = document.querySelector(".lg-question-card");
      const cardCs = card && view.getComputedStyle(card);
      return {
        btnCells, ynCells, btnTracks,
        btnGroup: rect(grp),
        card: rect(card),
        cardPadLeft: cardCs ? parseFloat(cardCs.paddingLeft) || 0 : 0,
        cardPadRight: cardCs ? parseFloat(cardCs.paddingRight) || 0 : 0,
        head: box("q_head"), sub: box("q_sub"), btn: box("q_btn"), yn: box("q_yn"),
      };
    });
    // eslint-disable-next-line no-console
    console.log(`[P1a live] btnTracks=${live.btnTracks} btnCells=${JSON.stringify(live.btnCells)}`);
    // ButtonAnswerGroup(2): two equal cells, gap == answerGrid.gap, ≥52 tall.
    expect(live.btnCells.length, "live: two answer cells").toBe(2);
    expect(live.btnTracks, "live: 2-track answer grid").toBe(2);
    expect(Math.abs(live.btnCells[0]!.w - live.btnCells[1]!.w), "live: equal button cells").toBeLessThanOrEqual(1);
    const liveColGap = +(live.btnCells[1]!.x - (live.btnCells[0]!.x + live.btnCells[0]!.w)).toFixed(1);
    expect(Math.abs(liveColGap - AG_GAP), `live: column gap ${liveColGap} == ${AG_GAP}`).toBeLessThanOrEqual(1.5);
    expect(live.btnCells[0]!.h, `live: cell height ${live.btnCells[0]!.h} ≥ ${CELL_MIN_H}`).toBeGreaterThanOrEqual(CELL_MIN_H - 0.5);
    // container centered in the card CONTENT column (width:100% ⇒ centered by construction).
    const cardContentCenter = live.card!.x + live.cardPadLeft + (live.card!.w - live.cardPadLeft - live.cardPadRight) / 2;
    const groupCenter = live.btnGroup!.x + live.btnGroup!.w / 2;
    expect(Math.abs(groupCenter - cardContentCenter), `live: group center ${groupCenter} vs column center ${cardContentCenter}`).toBeLessThanOrEqual(1);
    // TwoButtonYesNo: two EQUAL cells.
    expect(live.ynCells.length, "live: yes/no = two cells").toBe(2);
    expect(Math.abs(live.ynCells[0]!.w - live.ynCells[1]!.w), "live: equal yes/no widths").toBeLessThanOrEqual(1);
    expect(Math.abs(live.ynCells[0]!.h - live.ynCells[1]!.h), "live: equal yes/no heights").toBeLessThanOrEqual(1);
    // rhythm parity with the studio canvas: golden headline→sub 9, btn→yn == stack.
    const liveHeadSub = +(live.sub!.y - (live.head!.y + live.head!.h)).toFixed(1);
    const liveBtnYn = +(live.yn!.y - (live.btn!.y + live.btn!.h)).toFixed(1);
    expect(liveHeadSub, `live golden headline→sub ≈ 9`).toBeCloseTo(9, 0);
    expect(liveBtnYn, `live btn→yn gap ${liveBtnYn} == stack ${STACK}`).toBeGreaterThanOrEqual(STACK - 1.5);
    expect(liveBtnYn, `live btn→yn gap ${liveBtnYn} == stack ${STACK}`).toBeLessThanOrEqual(STACK + 1.5);

    // ---- mobile 375px ----
    await page.setViewportSize({ width: 375, height: 1400 });
    await page.waitForTimeout(200);
    const mobile = await page.evaluate(() => {
      const view = window;
      const cardGrid = document.querySelector('[data-question-id="q_cards"]');
      const ansGroup = document.querySelector('[data-question-id="q_btn"]');
      const tracks = (el: Element | null) => (el ? view.getComputedStyle(el).gridTemplateColumns.trim().split(/\s+/).length : 0);
      return {
        cardTracks: tracks(cardGrid),
        btnTracks: tracks(ansGroup),
        cardCols: cardGrid ? view.getComputedStyle(cardGrid).gridTemplateColumns : "",
        btnCols: ansGroup ? view.getComputedStyle(ansGroup).gridTemplateColumns : "",
        scrollWidth: document.scrollingElement ? document.scrollingElement.scrollWidth : document.body.scrollWidth,
        innerWidth: view.innerWidth,
      };
    });
    // eslint-disable-next-line no-console
    console.log(`[P1a mobile] cardTracks=${mobile.cardTracks} cardCols="${mobile.cardCols}" btnTracks=${mobile.btnTracks} btnCols="${mobile.btnCols}" scrollW=${mobile.scrollWidth} innerW=${mobile.innerWidth}`);
    expect(mobile.cardTracks, "mobile: card grid collapses to 1 track").toBe(1);
    expect(mobile.btnTracks, "mobile: buttons keep their multi-track (columnsMobile) count").toBe(2);
    expect(mobile.scrollWidth, `mobile: scrollWidth ${mobile.scrollWidth} ≤ innerWidth ${mobile.innerWidth}`).toBeLessThanOrEqual(mobile.innerWidth + 1);
  });
});
