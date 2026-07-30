// Section Builder product-core P1c — editor chrome + infrastructure fixes
// (register PC-8-toast / PC-9 / PC-A9).
//
// Three real-browser gates over the changes this slice owns:
//   A) PC-9 "New Section" overlap: the .lg-editor-pubid badge (ui-sections.ts)
//      no longer paints over renderStudioTopBar's 56px bar, at 1280 AND 1600
//      widths (the bar's own width never changes its fixed height, but the
//      dispatch's proving gate names both explicitly — assert both).
//   B) The P1a HIGH concern (register PC-1/PC-11): a 2-option ButtonAnswerGroup
//      renders its two choices SIDE BY SIDE on the studio canvas (matching the
//      live /lg render) with the per-choice edit decorations
//      (.studio-choice-x / .studio-choice-ghost) present and visible, instead
//      of the pre-fix vertical stack the extra grid-item siblings caused.
//   C) PC-A9 silent preview failures: a blocked/failed
//      /api/admin/leadgen/sections/preview response now shows a visible,
//      actionable .studio-canvas-preview-error banner (never a silently
//      frozen canvas) with a working Retry that clears it on success. The
//      route is blocked IN THIS PROBE via page.route() — never a product
//      change (the dispatch's own instruction).
// A bonus regression check (D) proves the PC-8 undo-toast is now anchored to
// the canvas surface rather than the page viewport.
//
// Run per-file with the fresh-D1 preamble, on the 8899 worktree config:
//   pkill -f "wrangler dev"; pkill -f workerd; sleep 2; \
//   npm run db:reset:local
//   PW_PORT=8899 npx playwright test test-ui/leadgen-p1c-editor-chrome.spec.ts \
//     --project=chromium --workers=1 --reporter=line
import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

const LG_API = "/api/admin/leadgen";
const uniq = Date.now();

test.use({ viewport: { width: 1280, height: 900 } });

async function json<T>(res: { ok(): boolean; status(): number; json(): Promise<unknown>; text(): Promise<string> }, label: string): Promise<T> {
  if (!res.ok()) throw new Error(`${label} HTTP ${res.status()}: ${await res.text()}`);
  return (await res.json()) as T;
}

interface Created {
  id: number;
  public_id: string;
}

// Minimal fixture: a bound headline + a 2-choice ButtonAnswerGroup + Continue
// — the exact shape the P1c dispatch names ("a 2-option ButtonAnswerGroup").
const TWO_CHOICE_COMPONENTS = [
  { type: "QuestionHeadline", question_id: "q_head", bind: "section_headline" },
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
  { type: "ContinueButton", question_id: "q_cont", props: { label: "Continue" } },
];

async function createSection(request: APIRequestContext, name: string): Promise<Created> {
  return json<Created>(
    await request.post(`${LG_API}/sections`, {
      data: {
        section_name: name,
        activity: "quote_funnel",
        vertical: "life",
        headline_text: "Which coverage do you need?",
        continue_mode: "button",
        status: "active",
        content_json: { components: TWO_CHOICE_COMPONENTS },
      },
    }),
    `section create (${name})`,
  );
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

async function boxOf(page: Page, selector: string): Promise<Rect> {
  const loc = page.locator(selector).first();
  await expect(loc, `${selector} must render`).toBeVisible({ timeout: 15_000 });
  const box = await loc.boundingBox();
  expect(box, `${selector} must have a real bounding box`).not.toBeNull();
  return box as Rect;
}

test.describe("P1c A — PC-9 create-flow chrome: no badge/topbar overlap", () => {
  for (const width of [1280, 1600]) {
    test(`the "New Section" pubid badge clears the studio topbar entirely at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/admin/leadgen/sections/new", { waitUntil: "domcontentloaded" });

      const badge = await boxOf(page, ".lg-editor-pubid");
      const topbar = await boxOf(page, "[data-studio-topbar]");
      const backLink = await boxOf(page, ".studio-back");

      // eslint-disable-next-line no-console
      console.log(`[P1c PC-9 @${width}] badge=${JSON.stringify(badge)} topbar=${JSON.stringify(topbar)} back=${JSON.stringify(backLink)}`);

      expect(rectsOverlap(badge, topbar), `badge ${JSON.stringify(badge)} must not overlap the topbar ${JSON.stringify(topbar)}`).toBe(false);
      expect(rectsOverlap(badge, backLink), `badge ${JSON.stringify(badge)} must not overlap the back link ${JSON.stringify(backLink)}`).toBe(false);
      // still a floating, visible affordance — not merely "not overlapping"
      // because it scrolled off-screen or collapsed to zero size.
      expect(badge.width).toBeGreaterThan(0);
      expect(badge.height).toBeGreaterThan(0);
    });
  }
});

test.describe("P1c B — studio canvas choice-decoration grid fix (P1a HIGH concern, register PC-1/PC-11)", () => {
  test("a 2-option ButtonAnswerGroup renders its two choices SIDE BY SIDE in the studio canvas, with visible remove-x + add-choice ghost decorations", async ({ page, request }) => {
    const s = await createSection(request, `p1c-decoration-${uniq}`);
    await page.goto(`/admin/leadgen/sections/${s.public_id}/edit`, { waitUntil: "domcontentloaded" });
    await expect(page.frameLocator("#lg-studio-canvas-frame").locator('[data-question-id="q_btn"]')).toBeVisible({ timeout: 20_000 });

    const snap = await page.evaluate(() => {
      const iframe = document.getElementById("lg-studio-canvas-frame") as HTMLIFrameElement | null;
      const doc = iframe && iframe.contentDocument;
      if (!doc) return { ok: false as const };
      const rect = (el: Element | null) =>
        el
          ? (() => {
              const r = el.getBoundingClientRect();
              return { x: r.left, y: r.top, w: r.width, h: r.height };
            })()
          : null;
      const group = doc.querySelector('[data-question-id="q_btn"]');
      const cells = group ? [...group.querySelectorAll(".lg-btn-answer")].map((c) => rect(c)!) : [];
      const xButtons = group ? [...group.querySelectorAll(".studio-choice-x")].map((x) => rect(x)!) : [];
      // Rework §6.1 (#1/#3/#9) renamed AND re-parented this affordance: the
      // "+ Add choice" ghost is no longer a `.studio-choice-ghost` grid cell
      // INSIDE the component — ui-section-studio.ts now emits a
      // `.studio-add-ghost-btn[data-choice-ghost=<qid>]` inside a
      // `.studio-add-ghost-row` SIBLING inserted immediately after the
      // component root. Query the ruled hook from the document (it is outside
      // `group` by design) and additionally PIN the sibling-ness the ruling
      // introduced, so this assertion is strictly stronger than before.
      const ghostEls = [...doc.querySelectorAll('[data-choice-ghost="q_btn"]')];
      const ghosts = ghostEls.map((g) => rect(g)!);
      const ghostInsideComponent = ghostEls.some((g) => group !== null && group.contains(g));
      return { ok: true as const, cells, xButtons, ghosts, ghostInsideComponent };
    });
    expect(snap.ok, "studio canvas iframe + the answer group must render").toBe(true);
    if (!snap.ok) return;

    // eslint-disable-next-line no-console
    console.log(`[P1c decoration] cells=${JSON.stringify(snap.cells)} x=${JSON.stringify(snap.xButtons)} ghosts=${JSON.stringify(snap.ghosts)}`);

    // THE regression: pre-fix, the two choices stacked vertically (same
    // column, different rows) because the sibling .studio-choice-x items
    // doubled the grid's item count. Post-fix: same row (y within 1px),
    // second cell strictly to the right of the first (side by side).
    expect(snap.cells.length, "two answer cells render").toBe(2);
    expect(Math.abs(snap.cells[0]!.y - snap.cells[1]!.y), `cells must share a row: ${JSON.stringify(snap.cells)}`).toBeLessThanOrEqual(1);
    expect(snap.cells[1]!.x, `cell 2 must sit to the right of cell 1: ${JSON.stringify(snap.cells)}`).toBeGreaterThan(snap.cells[0]!.x + snap.cells[0]!.w - 1);

    // the decorations are PRESENT and genuinely visible (nonzero box), not
    // merely still-existing-but-invisible.
    expect(snap.xButtons.length, "one remove-x per choice").toBe(2);
    for (const x of snap.xButtons) {
      expect(x.w, `remove-x must be visible (nonzero width): ${JSON.stringify(x)}`).toBeGreaterThan(0);
      expect(x.h, `remove-x must be visible (nonzero height): ${JSON.stringify(x)}`).toBeGreaterThan(0);
    }
    expect(snap.ghosts.length, "the + Add choice ghost tile renders once").toBe(1);
    expect(snap.ghosts[0]!.w, "ghost tile must be visible").toBeGreaterThan(0);
    expect(snap.ghosts[0]!.h, "ghost tile must be visible (nonzero height)").toBeGreaterThan(0);
    // Rework §6.1: the ghost is a SIBLING row, never inside the component's
    // border — that is exactly what keeps the group's geometry identical
    // with and without it (the live == edit claim this file gates).
    expect(snap.ghostInsideComponent, "the + Add choice ghost must sit OUTSIDE the component root (§6.1)").toBe(false);

    await page.screenshot({ path: "test-artifacts/p1c-canvas-decoration.png" });
  });
});

test.describe("P1c C — PC-A9 preview-refresh failure is visible + actionable", () => {
  test("a blocked preview request shows a Retry banner over the canvas; Retry re-fetches and clears it on success", async ({ page, request }) => {
    const s = await createSection(request, `p1c-previewfail-${uniq}`);
    await page.goto(`/admin/leadgen/sections/${s.public_id}/edit`, { waitUntil: "domcontentloaded" });
    await expect(page.frameLocator("#lg-studio-canvas-frame").locator('[data-question-id="q_btn"]')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator("[data-studio-canvas-preview-error]")).toHaveCount(0);

    // Simulate the failure THIS PROBE creates (never a product change): block
    // the preview endpoint with a 500.
    await page.route("**/api/admin/leadgen/sections/preview", (route) => route.fulfill({ status: 500, contentType: "application/json", body: "{}" }));

    // The Mobile viewport toggle calls renderCanvasNow() synchronously (no
    // debounce) — the most deterministic trigger available for a fresh render.
    await page.locator('[data-canvas-viewport="mobile"]').click();

    const banner = page.locator("[data-studio-canvas-preview-error]");
    await expect(banner, "the preview-failure banner must appear").toBeVisible({ timeout: 10_000 });
    await expect(banner).toContainText("Preview failed to update");
    const retryBtn = banner.locator("button");
    await expect(retryBtn).toContainText("Retry");
    const bannerBox = await banner.boundingBox();
    const canvasBox = await page.locator("#lg-studio-canvas").boundingBox();
    expect(bannerBox, "banner must have a real box").not.toBeNull();
    expect(canvasBox, "canvas surface must have a real box").not.toBeNull();
    // "over the canvas": the banner's box sits within the canvas surface's
    // horizontal span (it is a child of #lg-studio-canvas, position:absolute).
    expect(bannerBox!.x).toBeGreaterThanOrEqual(canvasBox!.x - 1);
    expect(bannerBox!.x + bannerBox!.width).toBeLessThanOrEqual(canvasBox!.x + canvasBox!.width + 1);

    // A5 manual-verification evidence: the banner visibly over the canvas.
    await page.screenshot({ path: "test-artifacts/p1c-preview-failure-banner.png" });

    // Unblock, retry, and prove it clears + the canvas genuinely refreshes.
    await page.unroute("**/api/admin/leadgen/sections/preview");
    await retryBtn.click();
    await expect(banner, "the banner clears on the next successful render").toHaveCount(0, { timeout: 10_000 });
    await expect(page.frameLocator("#lg-studio-canvas-frame").locator('[data-question-id="q_btn"]')).toBeVisible({ timeout: 10_000 });
  });
});

test.describe("P1c D (bonus regression) — PC-8 undo toast anchored to the canvas, not the page", () => {
  test("deleting the selected component shows the undo toast positioned over the canvas surface", async ({ page, request }) => {
    const s = await createSection(request, `p1c-toastanchor-${uniq}`);
    await page.goto(`/admin/leadgen/sections/${s.public_id}/edit`, { waitUntil: "domcontentloaded" });
    const canvasFrame = page.frameLocator("#lg-studio-canvas-frame");
    await expect(canvasFrame.locator('[data-question-id="q_head"]')).toBeVisible({ timeout: 20_000 });

    // Select the bound QuestionHeadline (a plain unit-scope node — clicking
    // INSIDE the ButtonAnswerGroup's own box instead lands on a CHOICE cell
    // and selects the choice; ContinueButton is funnel-layout/frame-scoped
    // and its own Delete affordance is replaced by the Move/Keep frame-badge
    // flow — headline is deletable with a plain undo toast, per the vitest
    // suite's "delete bound node keeps the canonical store; [Show]
    // re-inserts... AT THE TOP" coverage). R5 D3 moved the structural actions
    // (move/duplicate/group/Delete) behind a compact "More actions" popover
    // (data-studio-more-toggle / data-studio-more-panel) — open it before
    // the Delete button is reachable.
    await canvasFrame.locator('[data-question-id="q_head"]').click();
    await page.locator('[data-studio-more-toggle]').click();
    await page.locator('[data-studio-act="delete"]').click();

    const toast = page.locator("[data-studio-undo-toast]");
    await expect(toast, "the undo toast must appear after delete").toBeVisible({ timeout: 5_000 });
    const toastBox = await toast.boundingBox();
    const canvasBox = await page.locator("#lg-studio-canvas").boundingBox();
    expect(toastBox, "toast must have a real box").not.toBeNull();
    expect(canvasBox, "canvas surface must have a real box").not.toBeNull();
    // eslint-disable-next-line no-console
    console.log(`[P1c toast-anchor] toast=${JSON.stringify(toastBox)} canvas=${JSON.stringify(canvasBox)}`);
    // Anchored WITHIN the canvas surface's horizontal span — no longer a
    // page-viewport-fixed element that can land far from a tall page's
    // scrolled canvas.
    expect(toastBox!.x).toBeGreaterThanOrEqual(canvasBox!.x - 1);
    expect(toastBox!.x + toastBox!.width).toBeLessThanOrEqual(canvasBox!.x + canvasBox!.width + 1);
    expect(toastBox!.y).toBeGreaterThanOrEqual(canvasBox!.y - 1);
    expect(toastBox!.y + toastBox!.height).toBeLessThanOrEqual(canvasBox!.y + canvasBox!.height + 1);

    await toast.locator("button").click();
    await expect(toast, "Undo dismisses the toast").toHaveCount(0);
  });
});
