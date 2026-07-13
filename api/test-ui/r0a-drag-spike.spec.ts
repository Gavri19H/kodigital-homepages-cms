// R0a real-input drivability spike (register S1 · L5/P3/P4 · W6 · S4-B1).
//
// DECIDE-BY-EVIDENCE outcome (recorded here so the gate is self-documenting):
//
//   Option (i) — serve the canvas frame from a same-origin `src` route instead
//   of `srcdoc` — was implemented and driven with a REAL page.mouse drag under
//   the default CHROMIUM/CDP engine. It DID NOT WORK: page.mouse.move still
//   HANGS at the 2nd move call, byte-for-byte reproducing the register's
//   documented limitation ("even a neutral, non-interactive point ... hangs the
//   SAME way on the second page.mouse.move() call — an environment/CDP
//   limitation with nested same-origin-iframe raw pointer injection"). The hang
//   is inherent to CDP + a nested iframe; it is NOT a srcdoc-vs-src property, so
//   the src-URL frame gave no benefit (and regressed the srcdoc-asserting vitest
//   suite). Option (i) was therefore REVERTED — the product keeps its `srcdoc`
//   canvas frame.
//
//   Option (ii) — prove the real gesture under a NON-CDP engine — is what this
//   spec exercises: it launches Playwright's FIREFOX (Juggler protocol, no CDP)
//   and drives the SAME real page.mouse width-drag into the UNCHANGED srcdoc
//   canvas frame. Firefox completes the multi-move drag without hanging, so
//   real-input gesture gates (R2/R6) must run on firefox. (playwright.config
//   ships only a chromium project and is outside this slice's ownership, so this
//   spec launches firefox in-process via `firefox.launch()`; a dedicated firefox
//   project belongs in playwright.config — flagged for the conductor.)
//
// It also verifies Deliverable 2 (register S4-B1): the Question headline/
// subheadline strip renders at golden width instead of collapsing to a ~90px
// half-column ("Wh" / "rates d").
//
// Boot pattern mirrors leadgen-section-studio.spec.ts (seed a Section through
// the real admin API, open its /edit studio). Runs against the
// playwright.config webServer (wrangler dev on :8787, DEV_BYPASS_AUTH). Run
// per-file only:
//   npx playwright test test-ui/r0a-drag-spike.spec.ts --workers=1 --reporter=line --timeout=120000

import { test, expect, firefox, type APIRequestContext } from '@playwright/test';

const BASE = 'http://127.0.0.1:8787';
const LG_API = '/api/admin/leadgen';
const SHOT_DIR = 'test-artifacts/r0a-drag-spike';
const uniq = Date.now();

async function json<T>(
  res: { ok(): boolean; status(): number; json(): Promise<unknown>; text(): Promise<string> },
  label: string,
): Promise<T> {
  if (!res.ok()) {
    throw new Error(`${label} HTTP ${res.status()}: ${await res.text()}`);
  }
  return (await res.json()) as T;
}

interface Created {
  id: number;
  public_id: string;
}

// A minimal Section carrying a bound headline/subheadline pair + ONE real
// answer field (ZIP). findDefaultSelectionId() auto-selects the ZIP field on
// open (the first real answer node), so its 8-handle field chrome — including
// the two interactive E/W width handles — paints without a click. Mirrors the
// §7.1.3 fixture in leadgen-section-studio.spec.ts.
async function createSpikeSection(request: APIRequestContext): Promise<Created> {
  return json<Created>(
    await request.post(`${LG_API}/sections`, {
      data: {
        section_name: `R0a Spike ${uniq}`,
        activity: `r0a-act-${uniq}`,
        vertical: `r0a-vert-${uniq}`,
        headline_text: 'What is your ZIP code?',
        continue_mode: 'button',
        status: 'active',
        content_json: {
          components: [
            { type: 'QuestionHeadline', question_id: 'q_bound_headline', bind: 'section_headline' },
            { type: 'Subheadline', question_id: 'q_bound_subheadline', bind: 'section_subheadline' },
            {
              type: 'ZIPInputQuestion',
              question_id: 'q_zip',
              internal_field: 'zip',
              answer_type: 'string',
              props: { placeholder: 'ZIP code' },
            },
          ],
        },
      },
    }),
    'spike section create',
  );
}

test('R0a spike (Firefox) — a REAL page.mouse width-drag into the srcdoc canvas frame completes WITHOUT hang under a non-CDP engine and commits a snapped custom_px; the headline strip renders at golden width', { timeout: 120_000 }, async () => {
  // playwright.config ships only a chromium project (and is not in this slice's
  // ownership), so launch firefox in-process against the same wrangler-dev
  // webServer the config already boots.
  const browser = await firefox.launch();
  const context = await browser.newContext({ viewport: { width: 1760, height: 1100 }, baseURL: BASE });
  const page = await context.newPage();
  try {
    const section = await createSpikeSection(page.request);
    await page.goto(`/admin/leadgen/sections/${section.public_id}/edit`, { waitUntil: 'domcontentloaded' });

    // ---- Deliverable 1 (the spike): a REAL pointer drag on the canvas -------
    // Select the ZIP field via a trusted click INSIDE the canvas frame (no
    // dispatchEvent — real hit-testing, per M1). It is also the default
    // selection; the click proves the frame is genuinely pointer-reachable.
    const canvas = page.frameLocator('#lg-studio-canvas-frame').locator('#lg-studio-canvas-render');
    await canvas.locator('[data-question-id="q_zip"]').click();

    // The two interactive E/W handles are the only draggable ones (the other
    // six are presentation, S1-3). Grab the RIGHT (E) width handle.
    const rightHandle = page
      .frameLocator('#lg-studio-canvas-frame')
      .locator('[data-width-handle][data-handle-side="right"]');
    await expect(rightHandle).toBeVisible();

    // No custom badge before the drag — a fresh section carries no custom_px,
    // so decorateFieldSelection paints no "≈ N px · custom" badge yet.
    const customBadge = page
      .frameLocator('#lg-studio-canvas-frame')
      .locator('text=/≈ \\d+ px · custom/');
    await expect(customBadge).toHaveCount(0);

    // Measure the field's rendered width BEFORE, so we can prove a VISIBLE
    // change (not just a badge string).
    const zipInput = page.frameLocator('#lg-studio-canvas-frame').locator('[data-question-id="q_zip"]');
    const widthBefore = (await zipInput.boundingBox())?.width ?? 0;

    // THE REAL GESTURE — page.mouse.down → several page.mouse.move steps →
    // page.mouse.up, driven at the handle's real viewport coordinates. This is
    // the exact stream that HANGS at the 2nd move against a nested iframe under
    // CDP (L5/P3 + the reproduction recorded in this file's header).
    // onWidthHandleMouseDown requires an ACTUAL intervening mousemove before a
    // mouseup commits a width, so the multi-step move is load-bearing.
    const box = await rightHandle.boundingBox();
    if (!box) throw new Error('right width handle has no bounding box (frame not pointer-reachable)');
    const startX = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(startX, y);
    await page.mouse.down();
    await page.mouse.move(startX + 24, y, { steps: 4 });
    await page.mouse.move(startX + 52, y, { steps: 4 });
    await page.mouse.move(startX + 80, y, { steps: 4 });
    await page.mouse.up();

    // The drag COMPLETED (reaching this line at all means no hang) and committed
    // a width: the golden custom badge appears with a REAL snapped, clamped
    // value (afterModelChange → ~300ms debounced re-render → decoration
    // re-paints it).
    await expect(customBadge).toBeVisible({ timeout: 8_000 });
    const badgeText = await customBadge.textContent();
    const match = badgeText?.match(/≈ (\d+) px/);
    expect(match, `custom badge reads a real number: "${badgeText}"`).not.toBeNull();
    const px = Number(match![1]);
    expect(px % 4, 'the measured width is snapped to the 4px grid').toBe(0);
    expect(px, 'clamped to the Appendix-B unit column [200,600]').toBeGreaterThanOrEqual(200);
    expect(px, 'clamped to the Appendix-B unit column [200,600]').toBeLessThanOrEqual(600);

    // The field width VISIBLY changed to the committed custom_px (poll — the
    // re-render is debounced and replaces the input element).
    await expect
      .poll(async () => Math.round((await zipInput.boundingBox())?.width ?? 0), { timeout: 8_000 })
      .toBe(px);
    expect(
      Math.abs(px - Math.round(widthBefore)),
      `the field width changed from ~${Math.round(widthBefore)}px to ${px}px`,
    ).toBeGreaterThan(0);

    // ---- Deliverable 2 (register S4-B1): the headline strip is not collapsed -
    // With the `.studio-settings` grid→flex-column fix AND the #lg-section-form
    // flex-wrap:wrap co-fix (the form's `flex-basis:100%` spacer + fieldset
    // must wrap onto their own lines, else they steal the whole flex line and
    // the flex-basis:0 headline collapses to min-content), the Question-headline
    // input spans the strip's full width (golden :83-91), not the ~90px
    // half-column the 2-col grid squeezed it into.
    const headlineInput = page.locator('#lg-section-headline');
    await expect(headlineInput).toBeVisible();
    const headlineWidth = await headlineInput.evaluate((el) => (el as HTMLElement).clientWidth);
    expect(
      headlineWidth,
      `Question-headline input clientWidth (${headlineWidth}px) must exceed 400 at a 1760px viewport (S4-B1 collapse was ~90px)`,
    ).toBeGreaterThan(400);

    await page.screenshot({ path: `${SHOT_DIR}/r0a-real-drag-and-headline-width.png` });
  } finally {
    await context.close();
    await browser.close();
  }
});
