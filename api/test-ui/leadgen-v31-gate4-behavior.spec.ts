// LeadGen v3.1 §13 Gate 4 — the BROWSER-level behavior probes that the
// jsdom/data-layer Gate 4 vitest file (api/test/leadgen-v31-gate4-behavior.
// test.ts) explicitly could NOT reach, called out there as Findings §8/§9/§10
// (see also leadgen-v31-gate-map.md). Each drives the REAL studio/quote pages
// in a REAL browser against the wrangler-dev webServer — live DOM + live D1,
// no HTML-string checks:
//
//   • Finding 8 — the REAL Reset button (data-reset-width): drag a width
//     handle to commit a custom_px, then CLICK Reset and assert the custom_px
//     is removed (live DOM + persisted storage) — the field re-inherits the
//     theme preset. The vitest probe 3 proves the resolveFieldSize RESOLUTION;
//     this proves the UI-click-triggers-the-delete wiring the vitest file said
//     had "no live-browser proof."
//   • Finding 9 — presets DESELECT on drag: after a drag commits a custom_px,
//     the previously-active Width preset button loses its `active` class
//     (populateSizeControls: a preset is active only when !isCustomWidth).
//   • Finding 10 — activation BLOCKS specifically for maps_no_job: a section
//     with a Maps-enabled field and ZERO jobs, wired to a quote variant with
//     no offers, makes the activation preflight panel `blocked` SOLELY via the
//     path-precise maps_no_job error problem (computeMapsNoJobProblems, §9.3
//     "escalates ... same pattern as frame_scope_component") — not any other
//     cause. The vitest probe 4 proves the validator emits the WARNING; this
//     proves the preflight ESCALATION-to-blocking keyed to that exact cause.
//
// Seeding rides the REAL admin HTTP APIs only (repo convention — see
// leadgen-section-studio.spec.ts). Local state must be reset once:
// `npm run db:reset:local`.
//
// PLAYWRIGHT HARD LESSON (dispatch instruction): run THIS FILE ONLY —
// `npx playwright test test-ui/leadgen-v31-gate4-behavior.spec.ts --workers=1 --reporter=line`
// — never the full `npm run test:ui` (parks the harness).

import { test, expect, type APIRequestContext, type FrameLocator } from "@playwright/test";

test.use({ viewport: { width: 1280, height: 900 } });

const SHOT_DIR = "test-artifacts/leadgen-v31-gate4";
const LG_API = "/api/admin/leadgen";
const uniq = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

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

interface SectionDetail {
  content_json: {
    components: Array<{
      question_id: string;
      design_overrides?: { size?: { width?: unknown; height?: unknown } };
    }>;
  };
}

// A ZIP-only section (headline + subheadline + ZIP + continue), unambiguous so
// `[data-question-id="q_zip"]` is deterministically the resize target the
// moment the canvas loads (mirrors leadgen-section-studio.spec.ts §7.1.3).
async function createZipSection(request: APIRequestContext, name: string, vertical: string): Promise<Created> {
  return json<Created>(
    await request.post(`${LG_API}/sections`, {
      data: {
        section_name: name,
        activity: "Insurance",
        vertical,
        headline_text: "What's your ZIP code?",
        subheadline_text: "Rates differ by up to 40% based on ZIP code",
        continue_mode: "button",
        status: "active",
        content_json: {
          components: [
            { type: "QuestionHeadline", question_id: "q_bound_headline", bind: "section_headline" },
            { type: "Subheadline", question_id: "q_bound_subheadline", bind: "section_subheadline" },
            { type: "ZIPInputQuestion", question_id: "q_zip", internal_field: "zip", answer_type: "string", props: { placeholder: "ZIP code" } },
            { type: "ContinueButton", question_id: "q_cont", props: { label: "View My Quote" } },
          ],
        },
      },
    }),
    `create ZIP section (${name})`,
  );
}

// A CUSTOM (non-native) width drag: onWidthHandleMouseDown reads the mousedown
// clientX, REQUIRES an intervening mousemove (m3 fix), then the mouseup
// clientX. Raw CDP page.mouse.move() hangs inside the same-origin srcdoc iframe
// (a documented environment/CDP limitation — see §7.1.3's own comment), so we
// dispatch real MouseEvents via the DOM: the EXACT SAME JS listeners, the EXACT
// SAME event shape a real drag delivers.
async function dragRightWidthHandle(canvas: FrameLocator, deltaPx: number): Promise<void> {
  const rightHandle = canvas.locator('[data-width-handle][data-handle-side="right"]');
  await expect(rightHandle).toBeVisible();
  await rightHandle.evaluate((el, deltaX) => {
    const r = el.getBoundingClientRect();
    const clientY = r.top + r.height / 2;
    const startClientX = r.left + r.width / 2;
    const doc = el.ownerDocument;
    const view = doc.defaultView as Window;
    el.dispatchEvent(new MouseEvent("mousedown", { clientX: startClientX, clientY, bubbles: true, cancelable: true, view }));
    doc.dispatchEvent(new MouseEvent("mousemove", { clientX: startClientX + deltaX / 2, clientY, bubbles: true, cancelable: true, view }));
    doc.dispatchEvent(new MouseEvent("mouseup", { clientX: startClientX + deltaX, clientY, bubbles: true, cancelable: true, view }));
  }, deltaPx);
}

test.describe.serial("LeadGen v3.1 Gate 4 — browser behavior probes (gate-map Findings 8/9/10)", () => {
  test("Finding 8 — the REAL Reset button removes custom_px (live DOM + storage); the field re-inherits the theme preset", async ({ page }) => {
    const section = await createZipSection(page.request, `V31 Gate4 Reset ${uniq}`, `g4-reset-${uniq}`);
    await page.goto(`/admin/leadgen/sections/${section.public_id}/edit`, { waitUntil: "domcontentloaded" });

    const canvas = page.frameLocator("#lg-studio-canvas-frame").locator("#lg-studio-canvas-render");
    const canvasFrame = page.frameLocator("#lg-studio-canvas-frame");
    await canvas.locator('[data-question-id="q_zip"]').click();
    await page.locator('[data-studio-inspector-tab="style"]').click();

    // drag to commit a custom_px — confirmed by the canvas "≈ {n} px · custom" badge
    await dragRightWidthHandle(canvasFrame, 60);
    await expect(canvasFrame.locator("text=/≈ \\d+ px · custom/")).toBeVisible({ timeout: 5_000 });

    // re-select + re-open Style tab so the inspector reflects the committed model
    await canvas.locator('[data-question-id="q_zip"]').click();
    await page.locator('[data-studio-inspector-tab="style"]').click();
    const customChip = page.locator("[data-width-custom-chip]");
    await expect(customChip, "custom chip is visible while a custom_px is set").toBeVisible();
    await expect(page.locator("[data-width-custom-label]")).toContainText(/Custom · ≈ \d+ px/);

    // custom_px persists to storage before Reset (a real starting condition)
    await Promise.all([page.waitForEvent("load"), page.locator("#lg-section-save").click()]);
    let detail = await json<SectionDetail>(await page.request.get(`${LG_API}/sections/${section.public_id}`), "detail (after drag)");
    let zip = detail.content_json.components.find((c) => c.question_id === "q_zip");
    expect(
      (zip?.design_overrides?.size?.width as { custom_px?: number } | undefined)?.custom_px,
      "a real custom_px is stored after the drag",
    ).toBeGreaterThanOrEqual(200);

    // CLICK the real Reset button
    await canvas.locator('[data-question-id="q_zip"]').click();
    await page.locator('[data-studio-inspector-tab="style"]').click();
    await expect(customChip).toBeVisible();
    await page.locator("[data-reset-width]").click();

    // live DOM: the custom chip is gone, and NO width preset is explicitly
    // active — the field carries no stored width override, so it re-inherits
    // the theme preset (resolveFieldSize(undefined) => the theme default;
    // proven at the data layer by gate4-behavior vitest probe 3).
    await expect(customChip, "custom chip hides after Reset").toBeHidden();
    await expect(page.locator('[data-set-width="s"].active, [data-set-width="m"].active, [data-set-width="l"].active, [data-set-width="full"].active'))
      .toHaveCount(0);
    await page.screenshot({ path: `${SHOT_DIR}/finding8-after-reset.png` });

    // storage: the width key is DELETED (§7.2 "Reset deletes the key")
    await Promise.all([page.waitForEvent("load"), page.locator("#lg-section-save").click()]);
    detail = await json<SectionDetail>(await page.request.get(`${LG_API}/sections/${section.public_id}`), "detail (after reset)");
    zip = detail.content_json.components.find((c) => c.question_id === "q_zip");
    expect(zip?.design_overrides?.size?.width, "custom_px removed — width re-inherits the theme preset").toBeUndefined();
  });

  test("Finding 9 — a drag deselects the previously-active Width preset (custom_px overrides the preset)", async ({ page }) => {
    const section = await createZipSection(page.request, `V31 Gate4 Deselect ${uniq}`, `g4-deselect-${uniq}`);
    await page.goto(`/admin/leadgen/sections/${section.public_id}/edit`, { waitUntil: "domcontentloaded" });

    const canvas = page.frameLocator("#lg-studio-canvas-frame").locator("#lg-studio-canvas-render");
    const canvasFrame = page.frameLocator("#lg-studio-canvas-frame");
    await canvas.locator('[data-question-id="q_zip"]').click();
    await page.locator('[data-studio-inspector-tab="style"]').click();

    // establish a "previously active" preset
    const fullBtn = page.locator('[data-set-width="full"]');
    await fullBtn.click();
    await expect(fullBtn, "Full preset is active before the drag").toHaveClass(/active/);

    // drag commits a custom_px
    await dragRightWidthHandle(canvasFrame, 56);
    await expect(canvasFrame.locator("text=/≈ \\d+ px · custom/")).toBeVisible({ timeout: 5_000 });

    // re-select + re-open Style tab; the preset must have DESELECTED
    await canvas.locator('[data-question-id="q_zip"]').click();
    await page.locator('[data-studio-inspector-tab="style"]').click();
    await expect(page.locator("[data-width-custom-chip]"), "custom chip shows once a custom_px exists").toBeVisible();
    await expect(fullBtn, "the previously-active Full preset lost its active class after the drag").not.toHaveClass(/active/);
    await expect(
      page.locator('[data-set-width="s"].active, [data-set-width="m"].active, [data-set-width="l"].active, [data-set-width="full"].active'),
      "no preset is active while custom_px overrides it",
    ).toHaveCount(0);
    await page.screenshot({ path: `${SHOT_DIR}/finding9-preset-deselected.png` });
  });

  test("Finding 10 — activation preflight BLOCKS specifically for maps_no_job (Maps enabled, zero jobs), not another cause", async ({ page }) => {
    test.setTimeout(90_000);
    const vert = `g4-maps-${uniq}`;
    // A clean section: NO offers (so no offer/mapping block), NO rules (so no
    // dependency block); its ONLY activation problem is the Maps-enabled ZIP
    // field with every job false -> maps_no_job (§9.3).
    const section = await json<Created>(
      await page.request.post(`${LG_API}/sections`, {
        data: {
          section_name: `V31 Gate4 MapsNoJob ${uniq}`,
          activity: "Insurance",
          vertical: vert,
          headline_text: "What's your ZIP code?",
          continue_mode: "button",
          status: "active",
          content_json: {
            components: [
              { type: "QuestionHeadline", question_id: "q_bound_headline", bind: "section_headline" },
              {
                type: "ZIPInputQuestion",
                question_id: "q_zip",
                internal_field: "zip",
                answer_type: "string",
                props: { placeholder: "ZIP code", maps: { enabled: true, jobs: { validate: false, auction: false, autocomplete: false } } },
              },
              { type: "ContinueButton", question_id: "q_cont", props: { label: "View My Quote" } },
            ],
          },
        },
      }),
      "create maps-no-job section",
    );

    const quote = await json<{ public_id: string; funnels: Array<{ public_id: string; variants: Array<{ public_id: string }> }> }>(
      await page.request.post(`${LG_API}/quotes`, {
        data: { quote_name: `V31 Gate4 Maps Quote ${uniq}`, activity: "Insurance", verticals: [vert] },
      }),
      "create quote",
    );
    await json(
      await page.request.put(`${LG_API}/variants/${quote.funnels[0]!.variants[0]!.public_id}`, {
        data: { sections: [{ section_id: section.id, position: 0 }] },
      }),
      "wire section to variant",
    );

    await page.goto(`/admin/leadgen/quotes/${quote.public_id}/edit`, { waitUntil: "domcontentloaded" });
    await page.locator('.lg-qtab[data-tab="activation"]').click();

    const panel = page.locator("#lg-preflight-panel");
    await expect(panel, "the quote cannot activate").toHaveAttribute("data-preflight-state", "blocked", { timeout: 15_000 });

    // keyed to maps_no_job SPECIFICALLY: the path-precise problem row for the
    // ZIP field's props.maps, error severity, with the maps_no_job message.
    const mapsProblem = panel.locator('.lg-problem-row[data-problem-severity="error"][data-problem-path*="props.maps"]');
    await expect(mapsProblem, "the blocking problem is the maps_no_job cause").toBeVisible();
    await expect(mapsProblem).toContainText("Maps-enabled field with no job selected");
    await expect(mapsProblem).toContainText(`V31 Gate4 MapsNoJob ${uniq}`);

    // NOT another cause: no coded offer/auction/dependency block card is
    // present (blocks[] is empty — the block is SOLELY the maps_no_job problem).
    await expect(panel.locator("[data-preflight-code]"), "no coded offer/auction block — maps_no_job is the sole cause").toHaveCount(0);

    // the head publish badge mirrors the same server verdict
    await expect(page.locator("#lg-publish-badge")).toHaveAttribute("data-publish-verdict", "blocked");
    await page.screenshot({ path: `${SHOT_DIR}/finding10-maps-no-job-blocked.png` });
  });
});
