// Section Builder product-core P3a — STRUCTURED PLACEMENT effect gate (register
// PC-2 / decision D1 / axiom R-B). The operator's case, authored via API and
// measured in the REAL render: a TextBlock + a short-text field grouped into a
// side-by-side ROW (member 1 aligned start, member 2 width "m"), a lone
// width:"m" align:"center" element, and a nudged element — each producing its
// EXACT expected geometry, on the studio canvas (the surface the operator
// edits) AND the live /lg funnel (§12 parity — the SAME server renderer), plus
// automatic mobile stacking at 375px.
//
// Mirrors leadgen-p2a-element-freedom.gesture.spec.ts's structure: the studio-
// canvas describe (getBoundingClientRect + computed styles — engine-agnostic)
// runs on BOTH chromium+firefox; the live-/lg describe's dynamic {uniq}.e2e.test
// host needs chromium's --host-resolver-rules, so it test.skip()s on firefox
// (the repo-wide dynamic-host constraint the live-funnel specs document).
//
// Run per-file with the fresh-D1 preamble:
//   pkill -f "wrangler dev"; pkill -f workerd; sleep 2; \
//   npm run db:reset:local
//   PW_PORT=8899 npx playwright test test-ui/leadgen-p3a-placement.gesture.spec.ts \
//     --project=chromium --workers=1 --reporter=line
//   PW_PORT=8899 npx playwright test test-ui/leadgen-p3a-placement.gesture.spec.ts \
//     --project=firefox --workers=1 --reporter=line
import { test, expect, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { defaultFunnelDesign as D } from "../src/public/leadgen/designs/default-funnel/tokens";
import { seedActiveSite } from "./listicles-p6-seed";
import { seedSharedFirstPage, createPassThroughSection } from "./leadgen-shared-page-seed";
import { realDragFromLocator } from "./utils/real-input";
import { assertOverlayAligned } from "./utils/effect-assert";

const LG_API = "/api/admin/leadgen";
const uniq = Date.now();
const PORT = process.env.PW_PORT ?? "8899";
const ROW_GAP = parseInt(D.answerGrid.gap, 10); // 24 — the reused theme gutter token
const M_WIDTH = 384; // WIDTH_PRESET_CSS.m (presets.ts) — the "m" width preset in px

test.use({ launchOptions: { args: ["--host-resolver-rules=MAP *.e2e.test 127.0.0.1"] } });

// The operator's authored placement content. A bound headline (so a known
// predecessor sits above the row for the rhythm check), then row A = [TextBlock
// (align start), ShortText (width m)], a lone centered element, a nudged
// element, and the Continue.
const COMPONENTS = [
  { type: "QuestionHeadline", question_id: "q_head", bind: "section_headline" },
  {
    type: "TextBlock",
    question_id: "tb_row",
    props: { role: "body", text: "Left in the row" },
    layout: { row: "rowA", align: "start" },
  },
  {
    type: "FreeTextQuestion",
    question_id: "ft_row",
    internal_field: "ft_row",
    answer_type: "string",
    props: { placeholder: "Right in the row" },
    layout: { row: "rowA", width: "m" },
  },
  {
    type: "FreeTextQuestion",
    question_id: "lone_center",
    internal_field: "lone_center",
    answer_type: "string",
    props: { placeholder: "Centered" },
    layout: { width: "m", align: "center" },
  },
  {
    type: "FreeTextQuestion",
    question_id: "nudged",
    internal_field: "nudged",
    answer_type: "string",
    props: { placeholder: "Nudged" },
    layout: { nudge_x: 24, nudge_y: 8 },
  },
  { type: "ContinueButton", question_id: "q_cont", props: { label: "Continue" } },
];

async function json<T>(
  res: { ok(): boolean; status(): number; json(): Promise<unknown>; text(): Promise<string> },
  label: string,
): Promise<T> {
  if (!res.ok()) throw new Error(`${label} HTTP ${res.status()}: ${await res.text()}`);
  return (await res.json()) as T;
}
interface Created {
  id: number;
  public_id: string;
}
async function createSection(request: APIRequestContext, name: string): Promise<Created> {
  return json<Created>(
    await request.post(`${LG_API}/sections`, {
      data: {
        section_name: name,
        activity: "quote_funnel",
        vertical: "life",
        headline_text: "Where should each element sit?",
        continue_mode: "button",
        status: "active",
        content_json: { components: COMPONENTS },
      },
    }),
    `section create (${name})`,
  );
}

interface Rect {
  top: number;
  left: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}
function rectOf(loc: Locator): Promise<Rect> {
  return loc.evaluate((el: Element): Rect => {
    const r = (el as HTMLElement).getBoundingClientRect();
    return { top: r.top, left: r.left, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
  });
}
function transformOf(loc: Locator): Promise<string> {
  return loc.evaluate((el: Element) => getComputedStyle(el as HTMLElement).transform);
}
// The reviewer's exact citation shape for the MINOR-2 re-review regression:
// a slot's COMPUTED display (not just Playwright's toBeVisible, which also
// factors in ancestor visibility/size) — "slotDisplay: none" was the fail-
// before evidence for the container-collapse bug.
function displayOf(loc: Locator): Promise<string> {
  return loc.evaluate((el: Element) => getComputedStyle(el as HTMLElement).display);
}

// Named locators inside a render root (studio canvas OR live body).
function locators(root: Locator) {
  return {
    row: root.locator(".lg-el-row"),
    member1: root.locator('.lg-el-row > .lg-el[data-align="start"]'), // TextBlock slot
    member2: root.locator(".lg-el-row > .lg-el[data-el-basis]"), // width:m slot
    tbRowContent: root.locator('[data-question-id="tb_row"]'),
    loneCenter: root.locator('.lg-el:has([data-question-id="lone_center"])'),
    nudged: root.locator('.lg-el:has([data-question-id="nudged"])'),
    headline: root.locator('[data-component-type="QuestionHeadline"]'),
  };
}

// The shared EXPECTED-VALUE assertions (studio canvas AND live parity share
// them — the SAME server renderer). `tol` absorbs sub-pixel/font differences.
async function assertDesktopPlacement(root: Locator): Promise<void> {
  const L = locators(root);
  const [m1, m2] = [await rectOf(L.member1), await rectOf(L.member2)];

  // 1. Side by side, same y-band, member 1 LEFT of member 2.
  expect(Math.abs(m1.top - m2.top), "row members share a y-band").toBeLessThanOrEqual(2);
  expect(m1.right, "member 1 is left of member 2").toBeLessThanOrEqual(m2.left + 0.5);

  // 2. Gap == the reused theme token (answerGrid.gap = 24px).
  expect(Math.abs(m2.left - m1.right - ROW_GAP), `inter-slot gap == ${ROW_GAP}px`).toBeLessThanOrEqual(2);

  // 3. Width token "m" → a 384px slot (exact preset geometry).
  expect(Math.abs(m2.width - M_WIDTH), `width:m slot == ${M_WIDTH}px`).toBeLessThanOrEqual(1.5);

  // 4. align:start on member 1 → its content hugs the slot's LEFT edge.
  const tb = await rectOf(L.tbRowContent);
  expect(Math.abs(tb.left - m1.left), "align:start content hugs the slot left").toBeLessThanOrEqual(2);

  // 5. Lone width:m align:center → a 384px box CENTERED in its column
  //    (equal left/right gaps within its parent).
  const lone = await rectOf(L.loneCenter);
  const parent = await rectOf(L.loneCenter.locator("xpath=..")); // the card / render root
  expect(Math.abs(lone.width - M_WIDTH), `lone box == ${M_WIDTH}px`).toBeLessThanOrEqual(1.5);
  const leftGap = lone.left - parent.left;
  const rightGap = parent.right - lone.right;
  expect(leftGap, "lone box is inset from the left (centered, not full width)").toBeGreaterThan(4);
  expect(Math.abs(leftGap - rightGap), "lone box centered: equal left/right gaps").toBeLessThanOrEqual(2);

  // 6. Nudge → an EXACT translate transform (never a bare "moved").
  expect(await transformOf(L.nudged), "nudge translate(24px, 8px)").toBe("matrix(1, 0, 0, 1, 24, 8)");

  // 7. The row is ONE stack unit: the rhythm floor holds around it — the gap
  //    above the row is the ~18px stack floor (headline mb 9 + emulated row mt
  //    9), NEITHER collapsed to 0 (the pre-P1a bug) NOR doubled to ~48 (the
  //    grid/flex non-collapse the emulation table fixes).
  const [head, row] = [await rectOf(L.headline), await rectOf(L.row)];
  const rowGapAbove = row.top - head.bottom;
  expect(rowGapAbove, "row participates in rhythm (not collapsed to 0)").toBeGreaterThan(8);
  expect(rowGapAbove, "row rhythm is the stack floor, not the doubled non-collapse").toBeLessThanOrEqual(30);
}

async function bootStudioCanvas(page: Page, s: Created): Promise<Locator> {
  await page.goto(`/admin/leadgen/sections/${s.public_id}/edit`, { waitUntil: "domcontentloaded" });
  const frame = page.frameLocator("#lg-studio-canvas-frame");
  await expect(frame.locator(".lg-el-row")).toBeVisible({ timeout: 20_000 });
  return frame.locator("#lg-studio-canvas-render");
}

// ---------------------------------------------------------------------------
// STUDIO CANVAS — both engines
// ---------------------------------------------------------------------------
test.describe("P3a structured placement — studio canvas (both engines)", () => {
  let root: Locator;
  test.beforeEach(async ({ page, request }) => {
    const s = await createSection(request, `p3a-canvas-${uniq}-${Math.random().toString(36).slice(2, 7)}`);
    root = await bootStudioCanvas(page, s);
  });

  test("row side-by-side + gap; width:m == 384px; align:start hugs left; lone centered; nudge exact; rhythm floor holds", async () => {
    await assertDesktopPlacement(root);
  });
});

// ---------------------------------------------------------------------------
// LIVE /lg FUNNEL — §12 parity + automatic mobile stacking (chromium; firefox-skip)
// ---------------------------------------------------------------------------
test.describe("P3a structured placement — live /lg funnel (§12 parity + mobile stack)", () => {
  test("live render carries the SAME placement geometry; the row stacks full-width at 375px", async ({
    page,
    request,
    browserName,
  }) => {
    test.skip(
      browserName === "firefox",
      "live /lg leg needs chromium --host-resolver-rules; firefox cannot resolve the dynamic e2e host — the studio-canvas describe above runs on BOTH engines",
    );
    const host = `p3a-${uniq}.e2e.test`;
    const siteId = await seedActiveSite(request, host, `P3a Placement ${uniq}`);
    const s = await createSection(request, `p3a-live-${uniq}`);
    const quote = await json<{ public_id: string; funnels: Array<{ public_id: string; variants: Array<{ public_id: string }> }> }>(
      await request.post(`${LG_API}/quotes`, { data: { quote_name: `P3a Live ${uniq}`, activity: "quote_funnel", verticals: ["life"] } }),
      "quote create",
    );
    const variantId = quote.funnels[0]!.variants[0]!.public_id;
    // Rework §4.3-1: the quote's shared first page is mandatory for activation and
    // resolver.ts composes [...sharedPages, ...variantPages] — the section under test IS
    // page 1, so it moves onto the shared page. Composed order (and therefore every
    // geometry/index assertion below) is unchanged.
    await json(await request.put(`${LG_API}/variants/${variantId}`, { data: { sections: [{ section_id: await createPassThroughSection(request, "P3a live") }] } }), "variant sections");
    await seedSharedFirstPage(request, quote.public_id, [s.id]);
    await json(await request.put(`${LG_API}/quotes/${quote.public_id}/activation/${siteId}`, { data: { enabled: true, slug: "p3a" } }), "activation");

    // Desktop (default 1280 viewport → the 600px content column): SAME geometry
    // as the studio canvas — the §12 parity claim (one server renderer).
    await page.goto(`http://${host}:${PORT}/lg/p3a`, { waitUntil: "load" });
    const live = page.locator("body");
    await expect(live.locator(".lg-el-row")).toBeVisible({ timeout: 20_000 });
    await assertDesktopPlacement(live);

    // Automatic mobile stacking at 375px: the row becomes a vertical column,
    // each member full-width, NO horizontal overflow — no authoring involved.
    await page.setViewportSize({ width: 375, height: 900 });
    const L = locators(live);
    // The media query is width-based; re-read after the reflow.
    const [m1, m2] = [await rectOf(L.member1), await rectOf(L.member2)];
    expect(m2.top, "member 2 stacks BELOW member 1 (vertical, not side by side)").toBeGreaterThanOrEqual(m1.bottom - 2);
    expect(Math.abs(m1.left - m2.left), "stacked members share the left edge").toBeLessThanOrEqual(2);
    expect(Math.abs(m1.width - m2.width), "stacked members are equal (full) width").toBeLessThanOrEqual(2);
    const rowRect = await rectOf(L.row);
    const viewport = page.viewportSize()!;
    expect(rowRect.width, "the row itself has no horizontal overflow at 375px").toBeLessThanOrEqual(viewport.width);
    // NIT (P3 review): the ROW-width check above only proves the row's OWN box
    // fits — the E6 evidence shape (evidence-standards.md) is the PAGE-level
    // guarantee (document.documentElement.scrollWidth <= window.innerWidth),
    // the SAME check leadgen-patterns-v25.spec.ts's gotoLive already asserts.
    // A row could fit while some OTHER element on the page overflows; only the
    // page-level measurement proves "no horizontal overflow" in the E6 sense.
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    expect(
      overflow.scrollWidth,
      `E6 no horizontal overflow at 375px (scrollWidth ${overflow.scrollWidth} <= innerWidth ${overflow.innerWidth})`,
    ).toBeLessThanOrEqual(overflow.innerWidth);
    // The fixed 384px "m" member is now clamped to the column (max-width:100%).
    expect(m2.width, "the width:m member is full-width when stacked, not a fixed 384px").toBeLessThan(M_WIDTH);
  });
});

// ===========================================================================
// P3b — drag-beside ROW FORMATION (the R-B deliverable), inspector PLACEMENT
// controls, and the PC-A6 container-select affordance. REAL page.mouse gestures
// (never dispatchEvent) into the sandbox+CSP srcdoc canvas the U13 fix made
// deliverable on BOTH engines — so the studio-canvas legs run chromium+firefox
// (like leadgen-u11u12-move); the live-/lg parity leg self-skips on firefox
// (the dynamic e2e host needs chromium --host-resolver-rules).
// ===========================================================================

interface Layout {
  row?: string;
  align?: string;
  width?: unknown;
  nudge_x?: number;
  nudge_y?: number;
}
interface SavedNode {
  type: string;
  question_id: string;
  layout?: Layout;
}
async function createSectionComps(request: APIRequestContext, name: string, components: unknown[]): Promise<Created> {
  return json<Created>(
    await request.post(`${LG_API}/sections`, {
      data: {
        section_name: name,
        activity: "quote_funnel",
        vertical: "life",
        headline_text: "Where should each element sit?",
        continue_mode: "button",
        status: "active",
        content_json: { components },
      },
    }),
    `section create (${name})`,
  );
}
function frameOf(page: Page) {
  return page.frameLocator("#lg-studio-canvas-frame");
}
function canvasRoot(page: Page): Locator {
  return frameOf(page).locator("#lg-studio-canvas-render");
}
async function bootCanvas(page: Page, s: Created): Promise<void> {
  await page.goto(`/admin/leadgen/sections/${s.public_id}/edit`, { waitUntil: "domcontentloaded" });
  await expect(frameOf(page).locator("[data-question-id]").first()).toBeVisible({ timeout: 20_000 });
}
async function savedComps(request: APIRequestContext, publicId: string): Promise<SavedNode[]> {
  const detail = await json<{ content_json: { components: SavedNode[] } }>(
    await request.get(`${LG_API}/sections/${publicId}`),
    "refetch after save",
  );
  return detail.content_json.components;
}
async function saveAndReload(page: Page): Promise<void> {
  await Promise.all([page.waitForEvent("load"), page.locator("#lg-section-save").click()]);
}
// A guarded raw press+move that LEAVES the button down (so a mid-drag assertion
// can observe the drop guideline before release). Same trusted page.mouse
// pipeline as utils/real-input (NO dispatchEvent); the per-move steps mirror
// realDrag so the U13 srcdoc delivery stays observable.
async function pressDragTo(page: Page, fromLoc: Locator, to: { x: number; y: number }, steps = 6): Promise<void> {
  const fb = await fromLoc.boundingBox();
  if (!fb) throw new Error("pressDragTo: source has no bounding box");
  const from = { x: fb.x + fb.width / 2, y: fb.y + fb.height / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  const dx = (to.x - from.x) / steps;
  const dy = (to.y - from.y) / steps;
  for (let i = 1; i <= steps; i++) await page.mouse.move(from.x + dx * i, from.y + dy * i);
  await page.mouse.move(to.x, to.y);
}
// The LEFT / RIGHT third drop point on a canvas node (page coords).
async function thirdPoint(loc: Locator, side: "left" | "right"): Promise<{ x: number; y: number }> {
  const b = await loc.boundingBox();
  if (!b) throw new Error("thirdPoint: target has no bounding box");
  return { x: b.x + b.width * (side === "left" ? 0.15 : 0.85), y: b.y + b.height * 0.5 };
}
function rowOf(node: SavedNode | undefined): string | undefined {
  return node && node.layout && typeof node.layout.row === "string" ? node.layout.row : undefined;
}

const P3B_ROW = [
  { type: "QuestionHeadline", question_id: "q_head", bind: "section_headline" },
  { type: "TextBlock", question_id: "a", props: { role: "body", text: "Alpha" } },
  { type: "FreeTextQuestion", question_id: "b", internal_field: "b", answer_type: "string", props: { placeholder: "Beta" } },
  { type: "ContinueButton", question_id: "q_cont", props: { label: "Continue" } },
];

// ---------------------------------------------------------------------------
// STUDIO CANVAS + inspector — both engines
// ---------------------------------------------------------------------------
test.describe("P3b drag-beside + inspector placement + container select (both engines)", () => {
  // (a) drag B onto A's RIGHT third -> vertical guideline -> release -> both
  // carry the SAME layout.row (saved model proves it), and the canvas shows the
  // two members side by side (same y-band, A left of B).
  test("(a) drag-beside forms a row: guideline appears, shared layout.row saved, canvas shows side-by-side", async ({ page, request }) => {
    const s = await createSectionComps(request, `p3b-a-${uniq}-${Math.random().toString(36).slice(2, 7)}`, P3B_ROW);
    await bootCanvas(page, s);
    const root = canvasRoot(page);
    const A = frameOf(page).locator('[data-question-id="a"]');
    const B = frameOf(page).locator('[data-question-id="b"]');
    await expect(A).toBeVisible();
    await expect(B).toBeVisible();

    // press-drag B onto A's RIGHT third, holding the button down to observe the
    // vertical beside guideline BEFORE release.
    await pressDragTo(page, B, await thirdPoint(A, "right"));
    await expect(frameOf(page).locator(".studio-drop-beside-right"), "the vertical beside guideline shows on the host").toHaveCount(1);
    await page.mouse.up();

    // the canvas re-renders (debounced) with a real .lg-el-row: A left of B,
    // same y-band — WYSIWYG, exactly like the live render.
    await expect(root.locator(".lg-el-row")).toBeVisible({ timeout: 10_000 });
    const members = root.locator(".lg-el-row > .lg-el");
    await expect(members).toHaveCount(2);
    const m1 = await rectOf(members.nth(0));
    const m2 = await rectOf(members.nth(1));
    expect(Math.abs(m1.top - m2.top), "row members share a y-band on the canvas").toBeLessThanOrEqual(2);
    expect(m1.right, "member 1 is left of member 2").toBeLessThanOrEqual(m2.left + 0.5);

    // WYSIWYG measured-overlay gate class: B is the just-dropped selection — its
    // measured selection overlay must track the ROW MEMBER's box within 4px
    // (the P1c/R2 measured-overlay contract, now on a flex-slot member).
    const bOutline = frameOf(page)
      .locator('[data-question-id="b"]')
      .locator("xpath=..")
      .locator("div[data-selection-chrome]")
      .first();
    await expect(bOutline, "the selected row member shows its measured overlay").toBeVisible({ timeout: 8000 });
    const bBox = await frameOf(page).locator('[data-question-id="b"]').boundingBox();
    const outlineBox = await bOutline.boundingBox();
    if (!bBox || !outlineBox) throw new Error("row member / overlay has no bounding box");
    assertOverlayAligned(bBox, outlineBox, 4);

    await saveAndReload(page);
    const comps = await savedComps(request, s.public_id);
    const a = comps.find((c) => c.question_id === "a");
    const b = comps.find((c) => c.question_id === "b");
    expect(rowOf(a), "A carries a saved layout.row").toBeTruthy();
    expect(rowOf(b), "B carries a saved layout.row").toBeTruthy();
    expect(rowOf(a), "A and B share the SAME saved row id").toBe(rowOf(b));
    const ai = comps.findIndex((c) => c.question_id === "a");
    const bi = comps.findIndex((c) => c.question_id === "b");
    expect(bi, "the row members are contiguous (B immediately after A)").toBe(ai + 1);
  });

  // (b) drag a row member OUT (drop after a sibling in the middle band) -> its
  // layout.row is cleared and the 1-member remainder row DISSOLVES.
  test("(b) drag a member out clears its row and dissolves the 1-member remainder", async ({ page, request }) => {
    const s = await createSectionComps(request, `p3b-b-${uniq}-${Math.random().toString(36).slice(2, 7)}`, [
      { type: "QuestionHeadline", question_id: "q_head", bind: "section_headline" },
      { type: "TextBlock", question_id: "a", props: { role: "body", text: "Alpha" }, layout: { row: "rowAB" } },
      { type: "FreeTextQuestion", question_id: "b", internal_field: "b", answer_type: "string", props: { placeholder: "Beta" }, layout: { row: "rowAB" } },
      { type: "FreeTextQuestion", question_id: "c", internal_field: "c", answer_type: "string", props: { placeholder: "Gamma" } },
      { type: "ContinueButton", question_id: "q_cont", props: { label: "Continue" } },
    ]);
    await bootCanvas(page, s);
    await expect(canvasRoot(page).locator(".lg-el-row")).toBeVisible({ timeout: 10_000 });
    const B = frameOf(page).locator('[data-question-id="b"]');
    const C = frameOf(page).locator('[data-question-id="c"]');
    // drop B in the LOWER half of C (middle band -> 'after'): B LEAVES the row.
    const cBox = (await C.boundingBox())!;
    await realDragFromLocator(page, B, { x: cBox.x + cBox.width / 2, y: cBox.y + cBox.height * 0.85 }, { steps: 5, perStepGuardMs: 8000, settleMs: 500 });

    await saveAndReload(page);
    const comps = await savedComps(request, s.public_id);
    expect(rowOf(comps.find((c) => c.question_id === "b")), "B left the row (no layout.row)").toBeUndefined();
    expect(rowOf(comps.find((c) => c.question_id === "a")), "A's 1-member remainder row dissolved").toBeUndefined();
    const bi = comps.findIndex((c) => c.question_id === "b");
    const ci = comps.findIndex((c) => c.question_id === "c");
    expect(bi, "B now sits after C (the vertical reorder still happened)").toBeGreaterThan(ci);
  });

  // (c) join-refusal at 3 members: dropping a 4th beside a full row surfaces the
  // inline note and leaves the model UNCHANGED (no corruption).
  test("(c) join-refusal at 3 members shows the note and does not corrupt the model", async ({ page, request }) => {
    const s = await createSectionComps(request, `p3b-c-${uniq}-${Math.random().toString(36).slice(2, 7)}`, [
      { type: "QuestionHeadline", question_id: "q_head", bind: "section_headline" },
      { type: "TextBlock", question_id: "a", props: { role: "body", text: "A" }, layout: { row: "r3" } },
      { type: "TextBlock", question_id: "b", props: { role: "body", text: "B" }, layout: { row: "r3" } },
      { type: "TextBlock", question_id: "c", props: { role: "body", text: "C" }, layout: { row: "r3" } },
      { type: "FreeTextQuestion", question_id: "d", internal_field: "d", answer_type: "string", props: { placeholder: "D" } },
      { type: "ContinueButton", question_id: "q_cont", props: { label: "Continue" } },
    ]);
    await bootCanvas(page, s);
    await expect(canvasRoot(page).locator('.lg-el-row[data-row-cols="3"]')).toBeVisible({ timeout: 10_000 });
    const A = frameOf(page).locator('[data-question-id="a"]');
    const Dnode = frameOf(page).locator('[data-question-id="d"]');
    // drag D onto A's LEFT third -> beside -> joinRowBeside refuses (row full).
    await realDragFromLocator(page, Dnode, await thirdPoint(A, "left"), { steps: 6, perStepGuardMs: 8000, settleMs: 400 });
    // the inline refusal note (main admin doc, NOT the frame) is shown.
    const refusal = page.locator("[data-studio-drop-refusal]");
    await expect(refusal).toBeVisible({ timeout: 5000 });
    await expect(refusal).toContainText("at most 3");

    await saveAndReload(page);
    const comps = await savedComps(request, s.public_id);
    expect(rowOf(comps.find((c) => c.question_id === "d")), "D did NOT join (still lone)").toBeUndefined();
    const rows = ["a", "b", "c"].map((q) => rowOf(comps.find((c) => c.question_id === q)));
    expect(rows[0], "the 3-member row is intact").toBe("r3");
    expect(rows[1]).toBe("r3");
    expect(rows[2]).toBe("r3");
  });

  // (d) inspector align + nudge produce EXACT rendered geometry on the canvas.
  test("(d) inspector align:start hugs left and a nudge writes an exact translate (saved + rendered)", async ({ page, request }) => {
    const s = await createSectionComps(request, `p3b-d-${uniq}-${Math.random().toString(36).slice(2, 7)}`, [
      { type: "QuestionHeadline", question_id: "q_head", bind: "section_headline" },
      { type: "FreeTextQuestion", question_id: "a", internal_field: "a", answer_type: "string", props: { placeholder: "Solo" }, layout: { width: "m" } },
      { type: "ContinueButton", question_id: "q_cont", props: { label: "Continue" } },
    ]);
    await bootCanvas(page, s);
    // select A, open the Style tab, drive the placement controls.
    await frameOf(page).locator('[data-question-id="a"]').click();
    await page.locator('[data-studio-inspector-tab="style"]').click();
    await expect(page.locator("[data-style-placement-block]")).toBeVisible({ timeout: 8000 });
    const lone = canvasRoot(page).locator('.lg-el:has([data-question-id="a"])');
    await expect(lone).toBeVisible({ timeout: 8000 });

    // align:start -> a fixed-width (m) lone box hugs the LEFT; align:end pushes
    // it RIGHT. A RELATIVE start-vs-end comparison is robust to the card's own
    // padding (an absolute "left == 0" would depend on that padding).
    //
    // FIX-ROUND (conductor, firefox shard-3 flake — passed 5/5 isolated, failed
    // 1-in-3 under full-shard load): the canvas re-render after any placement
    // click is a DEBOUNCED preview POST (the SAME mechanism leadgen-p2a-
    // element-freedom.gesture.spec.ts's expectComputedStyle documents) — a
    // fixed page.waitForTimeout raced it, so a rect/transform read could land
    // mid-debounce. Replaced every fixed wait below with a toPass poll (the
    // p2a idiom) on the ACTUAL property the debounced render writes, so each
    // downstream read is guaranteed to happen only once that render settled:
    // for align, the lone `.lg-el` wrapper's own inline margin-left/margin-
    // right (widthCenteringEntries, presets.ts) — "0"/"auto" for align:start,
    // "auto"/"0" for align:end; for nudge, transformOf's exact matrix string
    // (unchanged target, now polled instead of timed).
    // NOTE: the browser normalizes the raw inline "0" to "0px" when read back
    // via el.style (confirmed live, chromium) — the CSSOM re-serializes a
    // dimensionless zero length to a canonical px value; "auto" is a keyword
    // and stays verbatim on both engines.
    await page.locator('[data-set-placement-align="start"]').click();
    await expect(async () => {
      const m = await lone.evaluate((el) => ({
        left: (el as HTMLElement).style.marginLeft,
        right: (el as HTMLElement).style.marginRight,
      }));
      expect(m, "align:start settled (margin-left:0px, margin-right:auto)").toEqual({ left: "0px", right: "auto" });
    }).toPass({ timeout: 8_000 });
    const startLeft = (await rectOf(lone)).left;
    await page.locator('[data-set-placement-align="end"]').click();
    await expect(async () => {
      const m = await lone.evaluate((el) => ({
        left: (el as HTMLElement).style.marginLeft,
        right: (el as HTMLElement).style.marginRight,
      }));
      expect(m, "align:end settled (margin-left:auto, margin-right:0px)").toEqual({ left: "auto", right: "0px" });
    }).toPass({ timeout: 8_000 });
    const endLeft = (await rectOf(lone)).left;
    expect(endLeft, "align:end renders the box to the RIGHT of align:start").toBeGreaterThan(startLeft + 20);

    // nudge x: +4 four times = +16px -> an EXACT translate transform.
    for (let i = 0; i < 4; i++) await page.locator('[data-nudge-step="x:4"]').click();
    await expect(async () => {
      expect(await transformOf(lone), "nudge_x 16 -> exact translate").toBe("matrix(1, 0, 0, 1, 16, 0)");
    }).toPass({ timeout: 8_000 });

    await saveAndReload(page);
    const a = (await savedComps(request, s.public_id)).find((c) => c.question_id === "a");
    expect(a && a.layout && a.layout.align, "layout.align saved (last set = end)").toBe("end");
    expect(a && a.layout && a.layout.nudge_x, "layout.nudge_x saved").toBe(16);
  });

  // (e) PC-A6 container select + delete: the container-select chip selects the
  // container by canvas click; Backspace deletes it with the undo toast.
  test("(e) a container is selectable via its chip and deletable with Backspace (+ undo toast)", async ({ page, request }) => {
    const s = await createSectionComps(request, `p3b-e-${uniq}-${Math.random().toString(36).slice(2, 7)}`, [
      { type: "QuestionHeadline", question_id: "q_head", bind: "section_headline" },
      {
        type: "CardPanel",
        question_id: "panel",
        props: { width: "full", padding: "m" },
        children: [{ type: "FreeTextQuestion", question_id: "kid", internal_field: "kid", answer_type: "string", props: { placeholder: "inside" } }],
      },
      { type: "ContinueButton", question_id: "q_cont", props: { label: "Continue" } },
    ]);
    await bootCanvas(page, s);
    const chip = frameOf(page).locator('[data-container-chip="panel"]');
    await expect(chip, "the container-select chip is present").toBeVisible({ timeout: 8000 });
    await chip.click();
    // selection reflects on the container node (studio-selected-node).
    await expect(frameOf(page).locator('[data-question-id="panel"].studio-selected-node'), "the container is selected").toHaveCount(1, { timeout: 8000 });
    // delete via Backspace -> the undo toast appears, the container is gone.
    await page.keyboard.press("Backspace");
    await expect(page.locator("[data-studio-undo-toast]"), "the standard undo toast shows").toBeVisible({ timeout: 8000 });

    await saveAndReload(page);
    const comps = await savedComps(request, s.public_id);
    expect(comps.find((c) => c.question_id === "panel"), "the container was deleted from the saved model").toBeUndefined();
  });

  // (f) CONDUCTOR FIX: ContinueButton/AutoAdvanceButton are catalog scope
  // "unit" (otherwise placement-eligible) but content-schema.ts's
  // LEADGEN_PLACEMENT_EXCLUDED_TYPES rejects layout() on both — the Style tab
  // must show the honest ownership note INSTEAD OF the placement controls,
  // never both, never neither.
  test("(f) ContinueButton shows the placement ownership note, not the placement controls (the CONDUCTOR FIX exclusion)", async ({ page, request }) => {
    const s = await createSectionComps(request, `p3b-f-${uniq}-${Math.random().toString(36).slice(2, 7)}`, [
      { type: "QuestionHeadline", question_id: "q_head", bind: "section_headline" },
      { type: "FreeTextQuestion", question_id: "a", internal_field: "a", answer_type: "string", props: { placeholder: "Solo" } },
      { type: "ContinueButton", question_id: "q_cont", props: { label: "Continue" } },
    ]);
    await bootCanvas(page, s);

    // an ORDINARY placement-eligible selection shows the controls, not the note.
    await frameOf(page).locator('[data-question-id="a"]').click();
    await page.locator('[data-studio-inspector-tab="style"]').click();
    await expect(page.locator("[data-placement-controls]"), "an ordinary field shows the placement controls").toBeVisible({ timeout: 8000 });
    await expect(page.locator("[data-placement-excluded-note]"), "an ordinary field hides the excluded note").toBeHidden();

    // ContinueButton: a NEW selection resets the active tab to Content
    // (populateInspector's isNewSelection rule) — re-open Style before
    // checking visibility, same as every other selection-then-Style-tab leg.
    await frameOf(page).locator('[data-question-id="q_cont"]').click();
    await page.locator('[data-studio-inspector-tab="style"]').click();
    await expect(page.locator("[data-style-placement-block]"), "the Placement block itself still shows (non-frame-scope)").toBeVisible({ timeout: 8000 });
    await expect(page.locator("[data-placement-excluded-note]"), "ContinueButton shows the ownership note").toBeVisible();
    await expect(page.locator("[data-placement-controls]"), "ContinueButton hides the placement controls").toBeHidden();
    await expect(page.locator("[data-placement-excluded-note]")).toContainText("funnel layout");
    await expect(page.locator("[data-placement-excluded-note]")).toContainText("Quote Builder");

    // the deep link is wired to the SAME shared Quote Builder navigation
    // (openQuoteBuilderNav; zero usage funnels -> funnelQuoteUrl(null) ->
    // the quotes list, the documented empty-state fallback).
    await page.locator("[data-placement-excluded-change-in-frame]").click();
    await expect(page).toHaveURL(/\/admin\/leadgen\/quotes(\?|$)/, { timeout: 8000 });
  });
});

// ---------------------------------------------------------------------------
// LIVE /lg FUNNEL — the R-B drag→save→live parity leg (chromium; firefox-skip)
// ---------------------------------------------------------------------------
test.describe("P3b drag-formed row -> live /lg parity (chromium; firefox-skip)", () => {
  test("a row FORMED BY DRAG persists and renders side-by-side on the live funnel", async ({ page, request, browserName }) => {
    test.skip(
      browserName === "firefox",
      "live /lg leg needs chromium --host-resolver-rules; the studio-canvas drag legs above run on BOTH engines",
    );
    const host = `p3b-${uniq}.e2e.test`;
    const siteId = await seedActiveSite(request, host, `P3b Placement ${uniq}`);
    const s = await createSectionComps(request, `p3b-live-${uniq}`, P3B_ROW);
    await bootCanvas(page, s);
    // form the row via a REAL drag (B beside A), then save.
    const A = frameOf(page).locator('[data-question-id="a"]');
    const B = frameOf(page).locator('[data-question-id="b"]');
    await realDragFromLocator(page, B, await thirdPoint(A, "right"), { steps: 6, perStepGuardMs: 8000, settleMs: 500 });
    await expect(canvasRoot(page).locator(".lg-el-row")).toBeVisible({ timeout: 10_000 });
    await saveAndReload(page);

    // activate the section on a funnel + load the live /lg render.
    const quote = await json<{ public_id: string; funnels: Array<{ public_id: string; variants: Array<{ public_id: string }> }> }>(
      await request.post(`${LG_API}/quotes`, { data: { quote_name: `P3b Live ${uniq}`, activity: "quote_funnel", verticals: ["life"] } }),
      "quote create",
    );
    const variantId = quote.funnels[0]!.variants[0]!.public_id;
    // Rework §4.3-1: the quote's shared first page is mandatory for activation and
    // resolver.ts composes [...sharedPages, ...variantPages] — the section under test IS
    // page 1, so it moves onto the shared page. Composed order (and therefore every
    // geometry/index assertion below) is unchanged.
    await json(await request.put(`${LG_API}/variants/${variantId}`, { data: { sections: [{ section_id: await createPassThroughSection(request, "P3b live") }] } }), "variant sections");
    await seedSharedFirstPage(request, quote.public_id, [s.id]);
    await json(await request.put(`${LG_API}/quotes/${quote.public_id}/activation/${siteId}`, { data: { enabled: true, slug: "p3b" } }), "activation");

    await page.goto(`http://${host}:${PORT}/lg/p3b`, { waitUntil: "load" });
    const live = page.locator("body");
    await expect(live.locator(".lg-el-row")).toBeVisible({ timeout: 20_000 });
    const members = live.locator(".lg-el-row > .lg-el");
    await expect(members).toHaveCount(2);
    const m1 = await rectOf(members.nth(0));
    const m2 = await rectOf(members.nth(1));
    expect(Math.abs(m1.top - m2.top), "the drag-formed row renders side-by-side (same y-band) on the LIVE funnel").toBeLessThanOrEqual(2);
    expect(m1.right, "member 1 is left of member 2 live").toBeLessThanOrEqual(m2.left + 0.5);
  });

  // JOIN-TO-3 (conductor fix round): dragging a THIRD element beside an
  // EXISTING 2-member row joins it (not just formation-from-scratch, (a)'s
  // case, nor the full-row refusal, (c)'s case) — the saved model shows all
  // 3 sharing the row id, and BOTH the studio canvas and the live funnel
  // render the resulting 3-slot row.
  test("join-to-3: dragging a third element beside an existing 2-member row joins it — 3 share the saved row id, canvas AND live render 3 slots", async ({
    page,
    request,
    browserName,
  }) => {
    test.skip(
      browserName === "firefox",
      "live /lg leg needs chromium --host-resolver-rules; the studio-canvas join-to-3 mechanics are already proven both-engines by (a)'s identical drag path",
    );
    const s = await createSectionComps(request, `p3b-join3-${uniq}`, [
      { type: "QuestionHeadline", question_id: "q_head", bind: "section_headline" },
      { type: "TextBlock", question_id: "a", props: { role: "body", text: "Alpha" }, layout: { row: "rowAB" } },
      { type: "FreeTextQuestion", question_id: "b", internal_field: "b", answer_type: "string", props: { placeholder: "Beta" }, layout: { row: "rowAB" } },
      { type: "FreeTextQuestion", question_id: "c", internal_field: "c", answer_type: "string", props: { placeholder: "Gamma" } },
      { type: "ContinueButton", question_id: "q_cont", props: { label: "Continue" } },
    ]);
    await bootCanvas(page, s);
    await expect(canvasRoot(page).locator('.lg-el-row[data-row-cols="2"]')).toBeVisible({ timeout: 10_000 });
    const B = frameOf(page).locator('[data-question-id="b"]');
    const Cnode = frameOf(page).locator('[data-question-id="c"]');
    // drag C onto B's RIGHT third -> beside-right on an EXISTING 2-member row
    // -> joinRowBeside sees hostRow="rowAB", count=2, prospective=3 (<=3) ->
    // joins (C gets layout.row="rowAB", relocated contiguous after B).
    await realDragFromLocator(page, Cnode, await thirdPoint(B, "right"), { steps: 6, perStepGuardMs: 8000, settleMs: 500 });

    // canvas: the row is now a real 3-slot .lg-el-row, all 3 in one y-band.
    const row3 = canvasRoot(page).locator('.lg-el-row[data-row-cols="3"]');
    await expect(row3, "the row grew to 3 slots on the canvas").toBeVisible({ timeout: 10_000 });
    const slots = row3.locator(".lg-el");
    await expect(slots).toHaveCount(3);
    const r0 = await rectOf(slots.nth(0));
    const r1 = await rectOf(slots.nth(1));
    const r2 = await rectOf(slots.nth(2));
    expect(Math.abs(r0.top - r1.top), "slot 1/2 share a y-band").toBeLessThanOrEqual(2);
    expect(Math.abs(r1.top - r2.top), "slot 2/3 share a y-band").toBeLessThanOrEqual(2);

    await saveAndReload(page);
    const comps = await savedComps(request, s.public_id);
    const rowIds = ["a", "b", "c"].map((q) => rowOf(comps.find((c) => c.question_id === q)));
    expect(rowIds[0], "A carries a saved layout.row").toBeTruthy();
    expect(rowIds[1], "B and A share the SAME saved row id").toBe(rowIds[0]);
    expect(rowIds[2], "C JOINED — shares the SAME saved row id as A/B").toBe(rowIds[0]);
    const idx = ["a", "b", "c"].map((q) => comps.findIndex((c) => c.question_id === q));
    const sortedIdx = [...idx].sort((x, y) => x - y);
    expect(idx.slice().sort((x, y) => x - y), "the 3 row members are contiguous").toEqual(sortedIdx);
    expect(sortedIdx[2] - sortedIdx[0], "no gap between the first and last row member").toBe(2);

    // live /lg parity: the SAME 3-member row renders 3 slots on the live funnel.
    const host = `p3b-join3-${uniq}.e2e.test`;
    const siteId = await seedActiveSite(request, host, `P3b Join3 ${uniq}`);
    const quote = await json<{ public_id: string; funnels: Array<{ public_id: string; variants: Array<{ public_id: string }> }> }>(
      await request.post(`${LG_API}/quotes`, { data: { quote_name: `P3b Join3 ${uniq}`, activity: "quote_funnel", verticals: ["life"] } }),
      "quote create",
    );
    const variantId = quote.funnels[0]!.variants[0]!.public_id;
    // Rework §4.3-1: the quote's shared first page is mandatory for activation and
    // resolver.ts composes [...sharedPages, ...variantPages] — the section under test IS
    // page 1, so it moves onto the shared page. Composed order (and therefore every
    // geometry/index assertion below) is unchanged.
    await json(await request.put(`${LG_API}/variants/${variantId}`, { data: { sections: [{ section_id: await createPassThroughSection(request, "P3b join3") }] } }), "variant sections");
    await seedSharedFirstPage(request, quote.public_id, [s.id]);
    await json(await request.put(`${LG_API}/quotes/${quote.public_id}/activation/${siteId}`, { data: { enabled: true, slug: "p3b-join3" } }), "activation");

    await page.goto(`http://${host}:${PORT}/lg/p3b-join3`, { waitUntil: "load" });
    const liveRow3 = page.locator('.lg-el-row[data-row-cols="3"]');
    await expect(liveRow3, "the live funnel renders the SAME 3-slot row").toBeVisible({ timeout: 20_000 });
    await expect(liveRow3.locator(".lg-el")).toHaveCount(3);
  });
});

// ===========================================================================
// P3 REVIEW fix round — MINOR-1 (duplicate bypasses the row cap) + MINOR-2
// (hidden row member leaves an empty live column) + NITS.
// ===========================================================================

// Open the canvas toolbar's "More actions" popover (leadgen-studio-patterns
// idiom — a real click on the visible "⋮" toggle, never force-clicking
// the hidden popover action directly) then click a data-studio-act button.
async function studioAct(page: Page, act: string): Promise<void> {
  await page.locator("[data-studio-more-toggle]").click();
  await expect(page.locator("[data-studio-more-panel]")).toBeVisible();
  await page.locator(`[data-studio-act="${act}"]`).click();
}

test.describe("P3 review MINOR-1 — duplicate/ungroup/wrap respect the row cap (both engines)", () => {
  // Regression: duplicating a MIDDLE member of an already-FULL (3) row used to
  // preserve layout.row on the clone AND insert it contiguously — a silent
  // 4-member run the canvas rendered but only the SAVE 400'd on. The clone
  // must now land LONE right after the row, with the row itself untouched.
  test("duplicating a member of a full 3-member row: clone lands lone (not a 4th slot), the row is untouched, the model saves clean", async ({ page, request }) => {
    const s = await createSectionComps(request, `p3rev-dup-${uniq}-${Math.random().toString(36).slice(2, 7)}`, [
      { type: "QuestionHeadline", question_id: "q_head", bind: "section_headline" },
      { type: "TextBlock", question_id: "a", props: { role: "body", text: "A" }, layout: { row: "r3" } },
      { type: "TextBlock", question_id: "b", props: { role: "body", text: "B" }, layout: { row: "r3" } },
      { type: "TextBlock", question_id: "c", props: { role: "body", text: "C" }, layout: { row: "r3" } },
      { type: "FreeTextQuestion", question_id: "d", internal_field: "d", answer_type: "string", props: { placeholder: "D" } },
      { type: "ContinueButton", question_id: "q_cont", props: { label: "Continue" } },
    ]);
    await bootCanvas(page, s);
    await expect(canvasRoot(page).locator('.lg-el-row[data-row-cols="3"]')).toBeVisible({ timeout: 10_000 });

    // select the MIDDLE member (b) — the harder case: a naive "insert right
    // after the duplicated node" would land the clone BETWEEN b and c,
    // splitting the run into two non-contiguous groups if its row were kept.
    await frameOf(page).locator('[data-question-id="b"]').click();
    await studioAct(page, "duplicate");

    // the inline note (join-refusal copy style) explains the accommodation.
    const note = page.locator("[data-studio-drop-refusal]");
    await expect(note, "the row-cap note shows").toBeVisible({ timeout: 8000 });
    await expect(note).toContainText("at most 3");

    // canvas: the row is STILL exactly 3 members (a,b,c unaffected) — the
    // clone rendered as a SEPARATE lone element, never a 4th row slot.
    const row3 = canvasRoot(page).locator('.lg-el-row[data-row-cols="3"]');
    await expect(row3, "the row stays at 3 slots (no 4th slot)").toBeVisible({ timeout: 8000 });
    await expect(row3.locator(".lg-el")).toHaveCount(3);

    await saveAndReload(page);
    const comps = await savedComps(request, s.public_id);
    const known = new Set(["q_head", "a", "b", "c", "d", "q_cont"]);
    const clone = comps.find((c) => !known.has(c.question_id));
    expect(clone, "the duplicate persisted as a NEW node").toBeTruthy();
    expect(rowOf(clone), "the clone carries NO layout.row (lands lone)").toBeUndefined();
    const rowIds = ["a", "b", "c"].map((q) => rowOf(comps.find((cc) => cc.question_id === q)));
    expect(rowIds[0], "a still carries its row").toBeTruthy();
    expect(rowIds[1], "the row is UNCHANGED — b still shares it").toBe(rowIds[0]);
    expect(rowIds[2], "the row is UNCHANGED — c still shares it").toBe(rowIds[0]);
    const ci = comps.findIndex((cc) => cc.question_id === "c");
    const cloneIdx = comps.findIndex((cc) => cc === clone);
    expect(cloneIdx, "the clone lands immediately after the WHOLE row (after c), never mid-run").toBe(ci + 1);
  });
});

test.describe("P3 review MINOR-2 — a hidden row member collapses its slot on the live funnel (chromium; firefox-skip)", () => {
  // Grounded in the REAL emitted markup: render.ts applyComponentVisibility
  // toggles `hidden` DIRECTLY on `[data-lg-question="{qid}"]` (the hydration()
  // anchor every answer-producing renderer stamps — presets.ts confirms it
  // lands as a DIRECT child of .lg-el for a bare input, but NESTED for the
  // icon/helper-boxed path and inside .lg-answer-group's own root).
  //
  // RE-REVIEW FIX (fresh regression from the first cut of this rule, proven
  // live by the conductor's reviewer): a plain descendant :has() (no `>`)
  // matches ANY hidden question ANYWHERE inside the slot — including one
  // buried inside a CONTAINER row member's OWN children, wrongly collapsing
  // the WHOLE container (and its OTHER, still-visible content) whenever just
  // ONE descendant happened to be hidden. The corrected CSS
  // (`.lg-el[data-el-leaf]:has([data-lg-question][hidden])`) requires
  // presets.ts wrapRowMember's new `data-el-leaf` marker — stamped ONLY on a
  // non-container slot — so a container's slot can NEVER match this rule; a
  // container's own conditional children keep hiding INSIDE it (the second
  // test below is the permanent regression gate for that exact case). A
  // conditional's answer is fail-closed (an unanswered trigger ALWAYS reads
  // as unmet — dependencies.ts "an ABSENT answer NEVER satisfies a
  // conditional"), so a hidden row member starts HIDDEN at page load with
  // zero interaction; clicking the trigger reveals it, and clicking the
  // OTHER trigger value hides it again — the "live-toggle it" moment the
  // dispatch names.
  test("row member B starts hidden (row collapses to A full-row); clicking Yes reveals it (2 slots); clicking No hides it again (collapses back)", async ({
    page,
    request,
    browserName,
  }) => {
    test.skip(browserName === "firefox", "live /lg leg needs chromium --host-resolver-rules; the studio-canvas drag legs run on BOTH engines elsewhere in this file");
    const host = `p3rev-min2-${uniq}.e2e.test`;
    const siteId = await seedActiveSite(request, host, `P3 review MINOR-2 ${uniq}`);
    const s = await createSectionComps(request, `p3rev-min2-${uniq}`, [
      { type: "QuestionHeadline", question_id: "q_head", bind: "section_headline" },
      { type: "TwoButtonYesNo", question_id: "trigger", internal_field: "trigger", answer_type: "boolean", props: { yesLabel: "Yes", noLabel: "No" } },
      { type: "TextBlock", question_id: "a", props: { role: "body", text: "Alpha" }, layout: { row: "r2" } },
      {
        type: "FreeTextQuestion",
        question_id: "b",
        internal_field: "beta",
        answer_type: "string",
        props: { placeholder: "Beta" },
        layout: { row: "r2" },
        // NOTE (grounded via a live debug probe): TwoButtonYesNo's stored
        // answer is the STRING "true"/"false" (mirroring its data-value), not
        // a JS boolean — conditionMet's eq/neq are STRICT (===), so the
        // conditional value must match that stored shape exactly.
        conditional: { when: "trigger", op: "eq", value: "true" },
      },
      { type: "ContinueButton", question_id: "q_cont", props: { label: "Continue" } },
    ]);
    const quote = await json<{ public_id: string; funnels: Array<{ public_id: string; variants: Array<{ public_id: string }> }> }>(
      await request.post(`${LG_API}/quotes`, { data: { quote_name: `P3 review MINOR-2 ${uniq}`, activity: "quote_funnel", verticals: ["life"] } }),
      "quote create",
    );
    const variantId = quote.funnels[0]!.variants[0]!.public_id;
    await json(await request.put(`${LG_API}/variants/${variantId}`, { data: { sections: [{ section_id: s.id }] } }), "variant sections");
    await json(await request.put(`${LG_API}/quotes/${quote.public_id}/activation/${siteId}`, { data: { enabled: true, slug: "p3rev-min2" } }), "activation");

    await page.goto(`http://${host}:${PORT}/lg/p3rev-min2`, { waitUntil: "load" });
    const row = page.locator(".lg-el-row");
    await expect(row, "the row renders (both members physically in the DOM)").toBeVisible({ timeout: 20_000 });
    const slotA = page.locator('.lg-el:has([data-question-id="a"])');
    const slotB = page.locator('.lg-el:has([data-lg-field="beta"])');

    // (1) page load, ZERO interaction: trigger is unanswered -> B's conditional
    // is unmet (fail-closed) -> B starts HIDDEN -> its SLOT collapses, A takes
    // the full row width (matching the SSR preview's degrade semantics).
    await expect(slotB, "B's slot is hidden at page load (unanswered trigger)").toBeHidden();
    const aFull = await rectOf(slotA);
    const rowFull = await rectOf(row);
    expect(Math.abs(aFull.width - rowFull.width), "A fills the WHOLE row width while B is collapsed").toBeLessThanOrEqual(2);

    // (2) click Yes -> trigger becomes true -> B's conditional is now met ->
    // the row expands to 2 real slots, side by side.
    await page.locator('[data-lg-question="trigger"] [data-lg-choice="true"]').click();
    await expect(slotB, "B reveals once the conditional is met").toBeVisible({ timeout: 8000 });
    const aRect = await rectOf(slotA);
    const bRect = await rectOf(slotB);
    expect(Math.abs(aRect.top - bRect.top), "A and B share a y-band once both are visible").toBeLessThanOrEqual(2);
    expect(aRect.right, "A is left of B").toBeLessThanOrEqual(bRect.left + 0.5);

    // (3) the LIVE TOGGLE moment: click No -> trigger becomes false -> B's
    // conditional is unmet again -> its slot COLLAPSES back, measured live —
    // not merely "starts hidden," but observed transitioning DURING the run.
    await page.locator('[data-lg-question="trigger"] [data-lg-choice="false"]').click();
    await expect(slotB, "B's slot collapses again after the live toggle").toBeHidden({ timeout: 8000 });
    const aAfterToggle = await rectOf(slotA);
    const rowAfterToggle = await rectOf(row);
    expect(Math.abs(aAfterToggle.width - rowAfterToggle.width), "A re-fills the row after B collapses").toBeLessThanOrEqual(2);
  });

  // THE PERMANENT REGRESSION GATE for the re-review's fresh finding: a row
  // [leaf A + CardPanel{always-visible TextBlock, conditionally-hidden
  // FreeTextQuestion}] — the reviewer's exact probe. Cited fail-before (the
  // FIRST cut of the CSS rule, a plain descendant :has()): the CardPanel
  // slot's computed display went "none" and its always-visible TextBlock
  // child measured 0×0 (collapsed along with the slot) — even though the
  // CardPanel itself was NOT empty. Pass-after (the data-el-leaf-scoped
  // rule): the CardPanel slot never collapses (leaf-only rule), its
  // always-visible child stays visible with a real box, AND the inner
  // conditional child still hides correctly (the runtime's own per-
  // descendant applyComponentVisibility, unaffected by this CSS fix either
  // way) — toggling the trigger reveals it in place, still inside the SAME
  // non-collapsed container slot.
  test("a CONTAINER row member never collapses from an inner hidden descendant — its always-visible content stays visible; the inner conditional child still hides/reveals correctly", async ({
    page,
    request,
    browserName,
  }) => {
    test.skip(browserName === "firefox", "live /lg leg needs chromium --host-resolver-rules; the studio-canvas drag legs run on BOTH engines elsewhere in this file");
    const host = `p3rev-min2c-${uniq}.e2e.test`;
    const siteId = await seedActiveSite(request, host, `P3 review MINOR-2 container ${uniq}`);
    const s = await createSectionComps(request, `p3rev-min2c-${uniq}`, [
      { type: "QuestionHeadline", question_id: "q_head", bind: "section_headline" },
      { type: "TwoButtonYesNo", question_id: "trigger", internal_field: "trigger", answer_type: "boolean", props: { yesLabel: "Yes", noLabel: "No" } },
      { type: "TextBlock", question_id: "leafA", props: { role: "body", text: "Leaf A" }, layout: { row: "rCard" } },
      {
        type: "CardPanel",
        question_id: "panel",
        props: { width: "full", padding: "m" },
        layout: { row: "rCard" },
        children: [
          { type: "TextBlock", question_id: "alwaysVisible", props: { role: "body", text: "Always visible inside the card" } },
          {
            type: "FreeTextQuestion",
            question_id: "innerConditional",
            internal_field: "innerConditional",
            answer_type: "string",
            props: { placeholder: "Conditional inside the card" },
            conditional: { when: "trigger", op: "eq", value: "true" },
          },
        ],
      },
      { type: "ContinueButton", question_id: "q_cont", props: { label: "Continue" } },
    ]);
    const quote = await json<{ public_id: string; funnels: Array<{ public_id: string; variants: Array<{ public_id: string }> }> }>(
      await request.post(`${LG_API}/quotes`, { data: { quote_name: `P3 review MINOR-2 container ${uniq}`, activity: "quote_funnel", verticals: ["life"] } }),
      "quote create",
    );
    const variantId = quote.funnels[0]!.variants[0]!.public_id;
    await json(await request.put(`${LG_API}/variants/${variantId}`, { data: { sections: [{ section_id: s.id }] } }), "variant sections");
    await json(await request.put(`${LG_API}/quotes/${quote.public_id}/activation/${siteId}`, { data: { enabled: true, slug: "p3rev-min2c" } }), "activation");

    await page.goto(`http://${host}:${PORT}/lg/p3rev-min2c`, { waitUntil: "load" });
    const row = page.locator(".lg-el-row");
    await expect(row, "the row renders (leaf + container, both physically in the DOM)").toBeVisible({ timeout: 20_000 });
    const slotPanel = page.locator('.lg-el:has([data-question-id="panel"])');
    const alwaysVisible = page.locator('[data-question-id="alwaysVisible"]');
    const innerConditional = page.locator('[data-question-id="innerConditional"]');

    // Page load, ZERO interaction: trigger unanswered -> innerConditional's
    // OWN conditional is unmet (fail-closed) -> IT hides — but the CardPanel
    // it lives in is NOT empty (alwaysVisible has no conditional at all), so
    // the container's SLOT must stay laid out (never display:none).
    await expect(innerConditional, "the inner conditional child hides correctly (fail-closed, unanswered trigger)").toBeHidden({ timeout: 8000 });
    const slotDisplay = await displayOf(slotPanel);
    expect(slotDisplay, `the container slot's computed display must NOT be "none" — pass-after measurement (fail-before citation: the first CSS cut measured slotDisplay: "none" here)`).not.toBe("none");
    await expect(slotPanel, "the container slot itself is visible").toBeVisible();
    const slotBox = await rectOf(slotPanel);
    expect(slotBox.width, "the container slot has a real (non-zero) width").toBeGreaterThan(0);
    expect(slotBox.height, "the container slot has a real (non-zero) height").toBeGreaterThan(0);
    await expect(alwaysVisible, "the always-visible child inside the container stays visible").toBeVisible();
    const alwaysVisibleBox = await rectOf(alwaysVisible);
    expect(alwaysVisibleBox.width, `the always-visible child has a real (non-zero) width — pass-after measurement (fail-before citation: the first CSS cut measured this child's box as 0×0, collapsed along with its container)`).toBeGreaterThan(0);
    expect(alwaysVisibleBox.height, "the always-visible child has a real (non-zero) height").toBeGreaterThan(0);

    // Verify the OTHER direction too: toggling the trigger reveals the inner
    // conditional child IN PLACE, inside the SAME (never-collapsed) slot —
    // confirming the runtime's own per-descendant applyComponentVisibility
    // still works correctly for a container's children, independent of this
    // CSS fix either way.
    await page.locator('[data-lg-question="trigger"] [data-lg-choice="true"]').click();
    await expect(innerConditional, "the inner conditional child reveals once its OWN condition is met").toBeVisible({ timeout: 8000 });
    await expect(slotPanel, "the container slot is still visible (unaffected either way)").toBeVisible();
    await expect(alwaysVisible, "the always-visible child is still visible").toBeVisible();
  });
});

test.describe("P3 review NIT — Align inspector honesty on a lone, width-less element (both engines)", () => {
  // NIT: Align on a LONE (non-row) element with no placement Width is a
  // COMPLETE no-op at render time (presets.ts finishLonePlacement only wraps
  // a lone node in .lg-el — the ONLY element align's margins can apply to —
  // when it has a fixed width or a nudge; align alone changes nothing). The
  // Style tab must say so instead of silently letting the operator pick a
  // dead control.
  test("the align governance note shows for a lone width-less element and hides once Width or row membership makes it meaningful", async ({ page, request }) => {
    const s = await createSectionComps(request, `p3rev-nit-${uniq}-${Math.random().toString(36).slice(2, 7)}`, [
      { type: "QuestionHeadline", question_id: "q_head", bind: "section_headline" },
      { type: "FreeTextQuestion", question_id: "a", internal_field: "a", answer_type: "string", props: { placeholder: "Solo" } },
      { type: "ContinueButton", question_id: "q_cont", props: { label: "Continue" } },
    ]);
    await bootCanvas(page, s);
    await frameOf(page).locator('[data-question-id="a"]').click();
    await page.locator('[data-studio-inspector-tab="style"]').click();
    await expect(page.locator("[data-placement-controls]")).toBeVisible({ timeout: 8000 });
    const note = page.locator("[data-placement-align-note]");
    await expect(note, "no align set yet -> note hidden").toBeHidden();

    // set Align with NO width authored -> the note explains it is inert.
    await page.locator('[data-set-placement-align="center"]').click();
    await expect(note, "align set, no width, lone element -> governance note shows").toBeVisible({ timeout: 8000 });
    await expect(note).toContainText("fixed Width");

    // author a Width -> align now has a real effect -> the note hides.
    await page.locator('[data-set-placement-width="m"]').click();
    await expect(note, "a fixed width makes align meaningful -> note hides").toBeHidden({ timeout: 8000 });
  });
});
