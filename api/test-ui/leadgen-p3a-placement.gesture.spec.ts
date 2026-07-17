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
//   rm -rf .wrangler/state/v3/d1 && npm run db:migrate:local && npm run seed:local
//   PW_PORT=8899 npx playwright test test-ui/leadgen-p3a-placement.gesture.spec.ts \
//     --project=chromium --workers=1 --reporter=line
//   PW_PORT=8899 npx playwright test test-ui/leadgen-p3a-placement.gesture.spec.ts \
//     --project=firefox --workers=1 --reporter=line
import { test, expect, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { defaultFunnelDesign as D } from "../src/public/leadgen/designs/default-funnel/tokens";
import { seedActiveSite } from "./listicles-p6-seed";

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
    await json(await request.put(`${LG_API}/variants/${variantId}`, { data: { sections: [{ section_id: s.id }] } }), "variant sections");
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
    expect(rowRect.width, "no horizontal overflow at 375px").toBeLessThanOrEqual(viewport.width);
    // The fixed 384px "m" member is now clamped to the column (max-width:100%).
    expect(m2.width, "the width:m member is full-width when stacked, not a fixed 384px").toBeLessThan(M_WIDTH);
  });
});
