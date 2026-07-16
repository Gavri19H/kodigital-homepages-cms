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
//   • RHYTHM (the P10 zero-gap probe INVERTED): every adjacent component pair's
//     gap == max(the predecessor's own margin-bottom, spacing.stack) — a
//     collapse-emulation table in styles.ts (P1a FIX ROUND, register PC-3)
//     makes this hold even where the follower is a display:grid box (.lg-
//     answer-group/.lg-card-grid), which does NOT margin-collapse with a
//     sibling the way two normal blocks do (live-measured proof in styles.ts's
//     own comment). Golden headline→sub stays 9px exactly; golden sub→(any
//     follower, incl. a grid) now stays 30px exactly (was a fix-round finding:
//     summed to 48 pre-fix, since the grid didn't collapse); a non-golden pair
//     with no preceding margin gets exactly spacing.stack; a card-grid
//     predecessor (mb 24 ≥ stack) gives exactly its own 24 to ANY follower;
//   • mobile 375px: cards collapse to 1 track, buttons keep their multi-track
//     count (columnsMobile behavior), and scrollWidth ≤ innerWidth (no overflow).
//
// This is a `.gesture.spec.ts` in CROSS_ENGINE_GESTURE_SPECS (playwright.config.ts,
// wired by P1c), so it runs on BOTH the chromium and firefox projects. The
// studio-canvas describe (real getBoundingClientRect math against the same
// srcdoc iframe the operator edits) is fully engine-agnostic and runs on both.
// The live-/lg describe's ONE test needs a DYNAMIC `{uniq}.e2e.test` tenant
// host, resolved via chromium's `--host-resolver-rules=MAP *.e2e.test
// 127.0.0.1` launch arg (file-level test.use below) — firefox's equivalent
// mechanism, `network.dns.localDomains`, only accepts exact PRE-KNOWN
// hostnames, not a wildcard/suffix (confirmed by P1c; the repo's other
// live-funnel specs are chromium-only for the identical reason — see
// leadgen-live-funnel.spec.ts / leadgen-runtime-inputs.gesture.spec.ts's own
// fixed-hostname `network.dns.localDomains` usage). So that ONE test
// `test.skip`s itself on firefox — see its own comment — while every OTHER
// test in this file (the studio-canvas core assertions) runs on both engines.
//
// Run per-file with the fresh-D1 preamble (PW_PORT redirects the SAME
// playwright.config.ts webServer/baseURL to a worktree-isolated port so a
// parallel mission's 8787 wrangler is untouched):
//   pkill -f "wrangler dev"; pkill -f workerd; sleep 2; \
//   rm -rf .wrangler/state/v3/d1 && npm run db:migrate:local && npm run seed:local
//   PW_PORT=8899 npx playwright test test-ui/leadgen-p1-geometry.gesture.spec.ts \
//     --project=chromium --workers=1 --reporter=line
//   PW_PORT=8899 npx playwright test test-ui/leadgen-p1-geometry.gesture.spec.ts \
//     --project=firefox --workers=1 --reporter=line
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
// P1a FIX ROUND (conductor, register PC-3): subheadline.marginBottom(30) is now
// UNIVERSALLY the sub->follower gap, including grid followers — the new
// styles.ts collapse-emulation table (.lg-subheadline + .lg-answer-group,
// .lg-card-grid { margin-top:0 }) zeros the grid follower's own margin-top so
// the total equals subheadline's own 30, matching the operator's reference
// (~28-30px), not the pre-fix-round 48 (30 sub-mb + 18 stack, summed because
// grid containers don't margin-collapse with a sibling — see styles.ts's
// P1a FIX ROUND comment for the live-measured proof).
const SUB_GROUP_GOLDEN = 30; // subheadline.marginBottom (golden :912-914), now applied to ANY follower
const CARD_GRID_GAP = parseFloat(D.iconCardGrid.marginBottom) * 16; // 1.5rem -> 24 (16px-root)
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
      order: ["q_head", "q_sub", "q_btn", "q_yn", "q_txt", "q_cards", "q_multi", "q_cont"].map((id) => ({ id, box: qidBox(id) })),
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

  test("ButtonAnswerGroup + TwoButtonYesNo carry the 2-track answer grid, SIDE BY SIDE, equal cells ≥52px, gap == token", () => {
    // eslint-disable-next-line no-console
    console.log(`[P1a btn studio] tracks=${snap.btnTracks} cols="${snap.btnGridCols}" children=${JSON.stringify(snap.btnChildren)} cells=${JSON.stringify(snap.btnCells)}`);
    // P1c fixed the studio canvas's per-choice EDIT decoration (the
    // .studio-choice-x remove buttons no longer ride as grid siblings between
    // the answer cells — verified live: btnChildren now shows the two
    // .lg-btn-answer buttons ADJACENT, with only the trailing
    // .studio-choice-ghost add-tile after them, and the measured cells sit
    // side by side (x=387/652, gap exactly 24, identical to the live /lg
    // measurement below) — so this test now asserts the SAME cell-geometry
    // truth the studio canvas and the live funnel BOTH render, not just track
    // counts/heights.
    expect(snap.btnTracks, "ButtonAnswerGroup grid has 2 tracks").toBe(2);
    expect(snap.btnCells.length, "two answer cells render").toBe(2);
    const [a, b] = snap.btnCells;
    expect(Math.abs(a!.w - b!.w), `equal cell widths (${a!.w} vs ${b!.w})`).toBeLessThanOrEqual(1);
    expect(Math.abs(a!.y - b!.y), `side by side, same row (${a!.y} vs ${b!.y})`).toBeLessThanOrEqual(1);
    const colGap = +(b!.x - (a!.x + a!.w)).toFixed(1);
    expect(Math.abs(colGap - AG_GAP), `column gap ${colGap} == answerGrid.gap ${AG_GAP}`).toBeLessThanOrEqual(1.5);
    expect(a!.h, `answer cell height ${a!.h} ≥ ${CELL_MIN_H}`).toBeGreaterThanOrEqual(CELL_MIN_H - 0.5);
    expect(snap.ynCells.length, "yes/no = two cells").toBe(2);
    const [y, n] = snap.ynCells;
    expect(Math.abs(y!.w - n!.w), `equal yes/no widths (${y!.w} vs ${n!.w})`).toBeLessThanOrEqual(1);
    expect(y!.h, `yes/no cell height ${y!.h} ≥ ${CELL_MIN_H}`).toBeGreaterThanOrEqual(CELL_MIN_H - 0.5);
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

  test("RHYTHM: every adjacent pair matches its collapse-emulated gap (max(predecessor mb, stack)); golden headline→sub stays 9px; sub→grid stays 30px (the P10 zero-gap probe inverted)", () => {
    const boxes = new Map(snap.order.map((o) => [o.id, o.box]));
    for (const o of snap.order) expect(o.box, `component ${o.id} renders`).not.toBeNull();
    const g = (prev: string, next: string) => gap(boxes.get(prev)!, boxes.get(next)!);
    const headSub = g("q_head", "q_sub");
    const subBtn = g("q_sub", "q_btn");
    const btnYn = g("q_btn", "q_yn");
    const ynTxt = g("q_yn", "q_txt");
    const txtCards = g("q_txt", "q_cards");
    const cardsMulti = g("q_cards", "q_multi");
    const multiCont = g("q_multi", "q_cont");
    // eslint-disable-next-line no-console
    console.log(
      `[P1a rhythm] head->sub=${headSub} sub->btn=${subBtn} btn->yn=${btnYn} yn->txt=${ynTxt} txt->cards=${txtCards} cards->multi=${cardsMulti} multi->cont=${multiCont} (stack=${STACK} cardGridGap=${CARD_GRID_GAP})`,
    );
    // golden headline→sub: block↔block, margins COLLAPSE to the golden 9px
    // (also armed exactly by leadgen-r3a-effects + leadgen-u12-rhythm).
    expect(headSub, `golden headline→sub = ${HEADLINE_SUB_GOLDEN}`).toBeCloseTo(HEADLINE_SUB_GOLDEN, 0);
    // P1a FIX ROUND (conductor, register PC-3): sub→button-group now matches
    // the golden 30 EXACTLY — the new styles.ts collapse-emulation table zeros
    // the answer-group's margin-top after a subheadline (`.lg-subheadline +
    // .lg-answer-group, .lg-card-grid { margin-top:0 }`), so the total is just
    // subheadline's own 30px margin-bottom, matching the operator's reference
    // (~28-30px) instead of the pre-fix-round 48 (30+18 summed, since grid
    // containers do not margin-collapse with a sibling — see styles.ts's
    // P1a FIX ROUND comment for the live-measured proof of that non-collapse).
    expect(subBtn, `sub→grid == the golden 30 (collapse-emulated): ${subBtn}`).toBeCloseTo(SUB_GROUP_GOLDEN, 0);
    // non-golden grid pairs with NO preceding bottom-margin (.lg-answer-group
    // itself carries none): EXACTLY the stack floor (were 0px pre-P1a — the
    // inverted zero-gap probe).
    for (const [label, val] of [["btn→yn", btnYn], ["yn→txt", ynTxt], ["txt→cards", txtCards]] as const) {
      expect(val, `${label} gap ${val} == spacing.stack ${STACK}`).toBeGreaterThanOrEqual(STACK - 1.5);
      expect(val, `${label} gap ${val} == spacing.stack ${STACK}`).toBeLessThanOrEqual(STACK + 1.5);
    }
    // card-grid AS PREDECESSOR (mb 24 >= stack): the collapse-emulation table's
    // `.lg-card-grid + *` rule zeros ANY follower's margin-top, so the gap is
    // exactly the card-grid's own 24 — for another grid (cards→multi) AND for
    // Continue (multi→cont, overriding Continue's own golden 26 since no
    // golden reference pins THIS specific adjacency).
    for (const [label, val] of [["cards→multi", cardsMulti], ["multi→cont", multiCont]] as const) {
      expect(val, `${label} gap ${val} == iconCardGrid.marginBottom ${CARD_GRID_GAP}`).toBeCloseTo(CARD_GRID_GAP, 0);
    }
    // the inverted zero-gap probe: NO adjacent pair is the pre-P1a 0px.
    for (const [label, val] of [
      ["head→sub", headSub], ["sub→btn", subBtn], ["btn→yn", btnYn], ["yn→txt", ynTxt],
      ["txt→cards", txtCards], ["cards→multi", cardsMulti], ["multi→cont", multiCont],
    ] as const) {
      expect(val, `${label} is spaced (not the pre-P1a 0px)`).toBeGreaterThan(4);
    }
  });
});

test.describe("P1a geometry gate — live /lg funnel (§12 parity)", () => {
  test("live /lg: equal answer cells, gap == token, rhythm ≥ stack; mobile 375px collapses cards to 1 track, keeps buttons multi-track, no overflow", async ({ page, request, browserName }) => {
    // firefox's network.dns.localDomains pref needs an EXACT, pre-known
    // hostname — it cannot resolve this test's dynamic `{uniq}.e2e.test`
    // tenant host the way chromium's --host-resolver-rules wildcard mapping
    // does (confirmed by P1c; mirrors how the repo's other live-funnel specs
    // handle the same constraint — leadgen-live-funnel.spec.ts / leadgen-
    // runtime-inputs.gesture.spec.ts are chromium-only / fixed-hostname for
    // the identical reason). The studio-canvas describe above (the core
    // ButtonAnswerGroup/TwoButtonYesNo/MultiChoiceCardGroup/icon-card/RHYTHM
    // assertions) is fully engine-agnostic and runs on BOTH engines — only
    // this ONE live-render leg is chromium-only.
    test.skip(browserName === "firefox", "live /lg leg needs chromium --host-resolver-rules; firefox cannot resolve the dynamic e2e host — studio-canvas geometry (the core assertions) runs on BOTH engines");
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
    // rhythm parity with the studio canvas: golden headline→sub 9, sub→grid ==
    // the golden 30 (collapse-emulated, P1a FIX ROUND — was 48 pre-fix-round),
    // btn→yn == stack, on the REAL production render path (not just the editor).
    const liveHeadSub = +(live.sub!.y - (live.head!.y + live.head!.h)).toFixed(1);
    const liveSubBtn = +(live.btn!.y - (live.sub!.y + live.sub!.h)).toFixed(1);
    const liveBtnYn = +(live.yn!.y - (live.btn!.y + live.btn!.h)).toFixed(1);
    expect(liveHeadSub, `live golden headline→sub ≈ 9`).toBeCloseTo(9, 0);
    expect(liveSubBtn, `live sub→grid == the golden 30 (collapse-emulated): ${liveSubBtn}`).toBeCloseTo(SUB_GROUP_GOLDEN, 0);
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
