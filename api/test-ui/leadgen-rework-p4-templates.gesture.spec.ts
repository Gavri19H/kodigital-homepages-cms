// LeadGen Rework (LEADGEN-REWORK-03) — P4 slice S4.1: the §8.3 Templates tab
// gesture gate. Every action is a REAL Playwright gesture (Locator.click/
// fill/selectOption — NEVER dispatchEvent, L-189). Patterns cribbed verbatim
// in shape from leadgen-round4-quotes-acceptance.gesture.spec.ts (seedQuote/
// putFrame helpers, canvas frameLocator idiom, dynamic-host skip pattern) and
// leadgen-rework-p2-studio.gesture.spec.ts (header conventions) — per this
// codebase's own test-file-local-duplication convention, nothing shared is
// exported for these.
//
// ENGINE NOTE (disclosed): this file is NOT registered in playwright.config
// .ts's CROSS_ENGINE_GESTURE_SPECS/FIREFOX_ONLY_GESTURE_SPECS/ALL_GESTURE_SPECS
// arrays — that file is outside this slice's exclusive ownership (this file +
// api/test/leadgen-rework-templates-ui.test.ts + api/src/admin/leadgen/
// quotes-tabs/templates.ts + frame-handlers.ts only). Practical effect:
// chromium's `testIgnore: FIREFOX_ONLY_GESTURE_SPECS` is a blocklist, so this
// file runs on chromium today with no config change; firefox's `testMatch:
// ALL_GESTURE_SPECS` is an explicit allowlist that does not name this file,
// so it does not run on firefox until the conductor adds it — every test
// below is written engine-agnostically (plain click/fill/selectOption, no
// Chromium-only API) so that addition is a pure config change.
//
// Run (per-file, fresh D1, worktree-isolated, this worktree's dedicated port):
//   pkill -f "wrangler dev.*8901"; sleep 1
//   npm run db:reset:local
//   PW_PORT=8901 npx playwright test test-ui/leadgen-rework-p4-templates.gesture.spec.ts \
//     --project=chromium --workers=1 --reporter=line --timeout=120000

import { test, expect, request as playwrightRequest, type APIRequestContext, type FrameLocator, type Page } from "@playwright/test";
import { PW_PORT } from "./utils/base-url";

test.use({ launchOptions: { args: ["--host-resolver-rules=MAP *.e2e.test 127.0.0.1"] }, viewport: { width: 1280, height: 900 } });

const ORIGIN = `http://127.0.0.1:${PW_PORT}`;
const LG_API = "/api/admin/leadgen";

async function json<T>(
  res: { ok(): boolean; status(): number; json(): Promise<unknown>; text(): Promise<string> },
  label: string,
): Promise<T> {
  if (!res.ok()) throw new Error(`${label} HTTP ${res.status()}: ${await res.text()}`);
  return (await res.json()) as T;
}

const CONTINUE = { type: "ContinueButton", question_id: "cont", props: { label: "Continue" } };
function yesNoSection(name: string, field: string, activity: string): Record<string, unknown> {
  return {
    activity,
    vertical: "life",
    status: "active",
    section_name: name,
    headline_text: name,
    content_json: JSON.stringify({
      components: [
        { type: "TwoButtonYesNo", question_id: `q_${field}`, question_key: field, internal_field: field, answer_type: "boolean", required: true },
        CONTINUE,
      ],
    }),
  };
}

interface SeededQuote {
  quotePublicId: string;
  funnelPublicId: string;
  variantPublicId: string;
  activity: string;
}

// A quote+funnel+variant, optionally with ONE section assigned to the
// variant (`withSection`) — through the REAL admin API. Disjoint namespace
// "p4t-" so this file never collides with sibling suites' fixtures.
async function seedQuote(request: APIRequestContext, tag: string, withSection: boolean): Promise<SeededQuote> {
  const u = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const safe = `p4t-${tag}-${u}`.replace(/[^a-z0-9-]/gi, "");
  const activity = `p4t_${tag}_${u}`;
  const quote = await json<{ public_id: string; funnels: Array<{ public_id: string; variants: Array<{ public_id: string }> }> }>(
    await request.post(`${LG_API}/quotes`, { data: { quote_name: `P4T ${tag} ${u}`, activity, verticals: ["life"] } }),
    "quote create",
  );
  const funnelPublicId = quote.funnels[0]!.public_id;
  const variantPublicId = quote.funnels[0]!.variants[0]!.public_id;
  if (withSection) {
    const section = await json<{ public_id: string }>(
      await request.post(`${LG_API}/sections`, { data: yesNoSection(`${safe}-s1`, `f_${u}`, activity) }),
      "section create",
    );
    await json(
      await request.put(`${LG_API}/variants/${variantPublicId}`, {
        data: { pages: [{ name: "Page 1", slots: [{ kind: "fixed", section_id: section.public_id }] }] },
      }),
      "variant pages",
    );
  }
  return { quotePublicId: quote.public_id, funnelPublicId, variantPublicId, activity };
}

interface CreatedTemplate {
  id: number;
  public_id: string;
  name: string;
  is_default: boolean;
}
async function createTemplate(request: APIRequestContext, name: string, frameJson: Record<string, unknown> = {}): Promise<CreatedTemplate> {
  return json<CreatedTemplate>(
    await request.post(`${LG_API}/frame-template-records`, { data: { name, frame_json: frameJson } }),
    `template create (${name})`,
  );
}

function canvas(page: Page): FrameLocator {
  return page.frameLocator("#lg-tpl-canvas-iframe");
}
async function openTemplatesTab(page: Page, quotePublicId: string): Promise<void> {
  await page.goto(`/admin/leadgen/quotes/${quotePublicId}/edit`, { waitUntil: "domcontentloaded" });
  await page.locator('[data-tab="templates"]').click();
  await expect(page.locator('[data-panel="templates"]')).toHaveClass(/active/);
  // the Progress box (I) is pre-selected — wait for its controls to exist
  // before driving anything (deflakes against the panel's own async init).
  await expect(page.locator('[data-tplbox-panel="progress"]')).toBeVisible({ timeout: 15_000 });
}

async function canvasBodyText(page: Page): Promise<string> {
  // The canvas is a srcdoc iframe re-rendered on a 300ms debounce; poll its
  // body text via Playwright's own auto-retrying expect rather than a raw
  // read, then return the settled text.
  const body = canvas(page).locator("body");
  await expect(body).not.toBeEmpty({ timeout: 10_000 });
  return (await body.textContent()) ?? "";
}

let apiCtx: APIRequestContext;
test.beforeAll(async () => {
  apiCtx = await playwrightRequest.newContext({ baseURL: ORIGIN });
});
test.afterAll(async () => {
  await apiCtx.dispose();
});

test.describe("LeadGen Rework P4 — Templates tab (contract §8.3)", () => {
  test("no-sections fixture: the canvas renders Appendix A-9 verbatim through the real renderer", async ({ page }) => {
    const seed = await seedQuote(apiCtx, "fixture", false);
    await openTemplatesTab(page, seed.quotePublicId);
    const bodyText = await canvasBodyText(page);
    expect(bodyText, "canvas shows the A-9 fixture copy").toContain("Sample section (add sections to preview your own).");
    // it went through the REAL component renderer (a real button element, not a hand-authored empty-state div)
    await expect(canvas(page).locator("button, .answer-btn, [data-question-id]").first()).toBeVisible({ timeout: 10_000 });
  });

  test("section picker + theme switcher re-render the canvas (content changes)", async ({ page }) => {
    const seed = await seedQuote(apiCtx, "pickers", true);
    // -------------------------------------------------------------------
    // R2 P6 terminal clearance (ruling R-B) — ROOT CAUSE of this test's
    // "option being selected is not enabled" failure, fixed by making the
    // leg DETERMINISTIC rather than by relaxing it.
    // The theme switcher (#lg-tpl-theme-select) is populated client-side
    // from GET /themes (quotes-tabs/templates.ts wireThemeSwitcher). When
    // that list is EMPTY the island appends a deliberate, `disabled`
    // placeholder option: "No themes yet — create one in the Themes tab"
    // (templates.ts:1714-1720, `empty.disabled = true`). So a themeless
    // fixture still reports option count 2, the old `if (count > 1)` guard
    // fired, and `selectOption({ index: 1 })` targeted that placeholder —
    // Playwright correctly refused it for 30s. This is a LEGITIMATE
    // zero-theme placeholder in the product, verified by reading the render
    // (not assumed): nothing to fix in src.
    // Seeding one real theme makes the switcher leg run EVERY time instead
    // of being silently skipped on a themeless fixture, and lets the option
    // be picked by its real id rather than a positional index.
    // -------------------------------------------------------------------
    const themeName = `P4T Picker Theme ${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const seededTheme = await json<{ item: { id: string } }>(
      await apiCtx.post(`${LG_API}/themes`, {
        data: {
          name: themeName,
          roles: { brand_primary: "#123456", accent: "#654321", page_bg: "#FFFFFF", card: "#FFFFFF", text: "#101010", success: "#0E7C3A", error: "#B23A2C" },
          typography: { headline_font: "Inter", body_font: "Inter", base_px: 16 },
          controls: { field_height: "medium", button_size: "m", corners: "rounded" },
        },
      }),
      "seed a theme for the switcher",
    );
    await openTemplatesTab(page, seed.quotePublicId);

    // section select has a real option (not just the "no sections" placeholder)
    const sectionSelect = page.locator("#lg-tpl-section-select");
    await expect(sectionSelect.locator("option")).not.toHaveCount(0);
    const beforeText = await canvasBodyText(page);
    expect(beforeText).not.toContain("Sample section (add sections to preview your own).");

    // theme switcher: selecting an explicit theme changes the resolved
    // config (network round trip) — assert a preview POST actually fires.
    const themeSelect = page.locator("#lg-tpl-theme-select");
    // The seeded theme really reaches the switcher (client-side fetch), and it
    // is ENABLED — i.e. not the zero-theme placeholder described above. This
    // leg is now unconditional; the old `if (count > 1)` escape hatch is gone.
    const realOption = themeSelect.locator(`option[value="${seededTheme.item.id}"]`);
    await expect(realOption).toHaveCount(1, { timeout: 10_000 });
    await expect(realOption).not.toBeDisabled();
    const [req] = await Promise.all([
      // P6 terminal: a waitForRequest predicate receives a Request, which has NO
      // .request() — the old form threw "r.request is not a function" before the
      // predicate could ever match (the sibling builder spec fixed this already).
      // waitForRESPONSE predicates below are untouched: those DO get a Response.
      page.waitForRequest((r) => r.url().includes("/preview") && r.method() === "POST"),
      themeSelect.selectOption(seededTheme.item.id),
    ]);
    expect(req.method()).toBe("POST");
    await expect(themeSelect).toHaveValue(seededTheme.item.id);
  });

  test("Progress type picker updates the canvas (a live, pre-Save preview round trip)", async ({ page }) => {
    const seed = await seedQuote(apiCtx, "progress", true);
    await openTemplatesTab(page, seed.quotePublicId);

    // Scoped to THIS panel: the SAME progress.style key also exists on the
    // pre-existing canvas-click Progress region inspector (funnel.ts) — the
    // deliberate "harmless duplicate" pattern documented in templates.ts's
    // top-of-file comment — so an unscoped locator would match 2 elements,
    // AND both canvases' debounced previews hit the identical /variants/:id
    // /preview URL (intercepting the request body would be ambiguous about
    // which canvas's request was captured). Assert the OBSERVABLE outcome
    // instead: frame.ts's renderProgressRegion emits NO [data-frame-region=
    // "progress"] node at all when style:"hidden" (empty-string return), so
    // presence/absence in THIS canvas is an unambiguous, real-render signal.
    const dotsRadio = page.locator('[data-tplbox-panel="progress"] input[data-frame-key="progress.style"][value="dots"]');
    await dotsRadio.check({ force: true });
    await expect(canvas(page).locator('[data-frame-region="progress"]')).toHaveCount(1, { timeout: 10_000 });

    // "Show progress bar" OFF drives the style to 'hidden' — the region
    // disappears from the canvas entirely (not just visually dimmed).
    await page.locator("#lg-tpl-progress-show-checkbox").uncheck({ force: true });
    await expect(canvas(page).locator('[data-frame-region="progress"]')).toHaveCount(0, { timeout: 10_000 });

    // ON again restores the LAST real style (dots), proving the toggle is a
    // true style<->hidden round trip, not a one-way switch.
    await page.locator("#lg-tpl-progress-show-checkbox").check({ force: true });
    await expect(canvas(page).locator('[data-frame-region="progress"].lg-frame-progress--dots')).toHaveCount(1, { timeout: 10_000 });
  });

  test("template bar: create -> rename -> duplicate -> delete (in-use guarded, then unblocked)", async ({ page }) => {
    const seed = await seedQuote(apiCtx, "crud", true);
    await openTemplatesTab(page, seed.quotePublicId);
    const u = Date.now();

    // create
    await page.locator("#lg-tpl-new-btn").click();
    await page.locator("#lg-tpl-new-name").fill(`P4T Created ${u}`);
    await page.locator("#lg-tpl-new-save").click();
    const chip = page.locator(`[data-tpl-chip]`, { hasText: `P4T Created ${u}` });
    await expect(chip).toBeVisible({ timeout: 10_000 });

    // rename (native prompt — accept with a new name). Capture the chip's
    // stable data-tpl-chip id right away — "P4T Renamed <u>" is a TEXT
    // substring of "P4T Renamed <u> (copy)" once duplicated below, so every
    // later step targets the id, never a hasText re-derivation.
    const createdPublicId = await chip.getAttribute("data-tpl-chip");
    expect(createdPublicId).toBeTruthy();
    page.once("dialog", (d) => d.accept(`P4T Renamed ${u}`));
    await chip.locator("[data-tpl-more]").click();
    await page.locator('.lg-tpl2-tpl-menu button', { hasText: "Rename" }).click();
    const renamed = page.locator(`[data-tpl-chip="${createdPublicId}"]`);
    await expect(renamed).toContainText(`P4T Renamed ${u}`, { timeout: 10_000 });
    const renamedPublicId = createdPublicId;

    // duplicate
    await renamed.locator("[data-tpl-more]").click();
    await page.locator('.lg-tpl2-tpl-menu button', { hasText: "Duplicate" }).click();
    const copyChipLocator = page.locator(`[data-tpl-chip]:not([data-tpl-chip="${renamedPublicId}"])`, { hasText: `P4T Renamed ${u} (copy)` });
    await expect(copyChipLocator).toBeVisible({ timeout: 10_000 });
    const copyPublicId = await copyChipLocator.getAttribute("data-tpl-chip");
    expect(copyPublicId).toBeTruthy();

    // delete-in-use guard: apply the renamed template to this funnel, then
    // try to delete it -> the SERVER's real 409 referrer message renders.
    await json(
      await apiCtx.post(`${LG_API}/funnels/${seed.funnelPublicId}/apply-template`, { data: { template_id: renamedPublicId } }),
      "apply template (seed in-use)",
    );
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator('[data-tab="templates"]').click();
    const renamedAfterReload = page.locator(`[data-tpl-chip="${renamedPublicId}"]`);
    await expect(renamedAfterReload).toBeVisible({ timeout: 10_000 });
    await renamedAfterReload.locator("[data-tpl-more]").click();
    await page.locator('.lg-tpl2-tpl-menu button', { hasText: "Delete" }).click();
    const guard = page.locator("#lg-tpl-delete-guard");
    await expect(guard).toBeVisible({ timeout: 10_000 });
    await expect(guard).toContainText("in use");

    // deleting an UNUSED (copy) template succeeds. Id-scoped (not a text
    // match) — "P4T Renamed <u>" is still a substring of this chip's own
    // "(copy)" label, so a hasText locator would stay ambiguous here too.
    const copyChip = page.locator(`[data-tpl-chip="${copyPublicId}"]`);
    await copyChip.locator("[data-tpl-more]").click();
    await page.locator('.lg-tpl2-tpl-menu button', { hasText: "Delete" }).click();
    await expect(page.locator(`[data-tpl-chip="${copyPublicId}"]`)).toHaveCount(0, { timeout: 10_000 });
  });

  const SET_QUOTE_DEFAULT = "Set as this quote’s default"; // U+2019, exactly as templates.ts renders it
  test("set default is a single atomic swap", async ({ page }) => {
    const seed = await seedQuote(apiCtx, "default", true);
    const u = Date.now();
    const t1 = await createTemplate(apiCtx, `P4T Def A ${u}`);
    const t2 = await createTemplate(apiCtx, `P4T Def B ${u}`);
    await openTemplatesTab(page, seed.quotePublicId);

    const chip1 = page.locator(`[data-tpl-chip="${t1.public_id}"]`);
    const chip2 = page.locator(`[data-tpl-chip="${t2.public_id}"]`);
    await expect(chip1).toBeVisible({ timeout: 10_000 });
    // R2 ruling D5 (contract §7 D5) re-scoped this control to be PER-QUOTE and
    // renamed it — templates.ts renders `Set as this quote’s default`, so the old
    // exact substring never matched and the click timed out (stale spec, not a
    // product defect). Same atomic-swap claim, driven through the ruled control.
    await chip1.locator("[data-tpl-more]").click();
    await page.locator('.lg-tpl2-tpl-menu button', { hasText: SET_QUOTE_DEFAULT }).click();
    await expect(chip1).toHaveClass(/is-default/, { timeout: 10_000 });

    await chip2.locator("[data-tpl-more]").click();
    await page.locator('.lg-tpl2-tpl-menu button', { hasText: SET_QUOTE_DEFAULT }).click();
    await expect(chip2).toHaveClass(/is-default/, { timeout: 10_000 });
    // atomic swap: exactly one default remains — chip1 no longer carries it.
    await expect(chip1).not.toHaveClass(/is-default/, { timeout: 10_000 });
    // -----------------------------------------------------------------
    // REWRITTEN 2026-07-30 (R2 P6 terminal clearance, ruling R-B) — this
    // was the file's last STALE assertion, and it is now STRICTER, not
    // weaker. It used to re-fetch the GLOBAL /frame-template-records and
    // demand `is_default == [t2]`. R2 ruling D5 (contract §7 D5, migration
    // 0055 `leadgen_quote_default_template`) made the control the test
    // clicks — "Set as this quote’s default" — PER-QUOTE: it PATCHes
    // /quotes/:id {default_template_id} and deliberately leaves the global
    // `is_default` alone (that flag stays the cross-quote seed for "+ Add
    // funnel"). So the old line asserted a write the ruled product must NOT
    // make. Re-pointed at the per-quote truth using the pattern already
    // proven in leadgen-rework-acceptance-builder.gesture.spec.ts's
    // "#11D 'Set as this quote's default' is a single atomic PER-QUOTE swap
    // (D5)" test: (1) exactly one per-quote default and it is the LAST one
    // set, (2) a DIFFERENT quote is untouched — i.e. genuinely per-quote,
    // not a renamed global, and (3) the global is_default was never written.
    // Three assertions where there was one; the atomic-swap claim is intact.
    // -----------------------------------------------------------------
    const quoteRow = await json<{ default_template_id: string | null }>(
      await apiCtx.get(`${LG_API}/quotes/${seed.quotePublicId}`),
      "quote row re-fetch",
    );
    expect(quoteRow.default_template_id, "exactly one per-quote default remains — the last one set (atomic swap)").toBe(t2.public_id);

    const otherSeed = await seedQuote(apiCtx, "default-other", true);
    const otherRow = await json<{ default_template_id: string | null }>(
      await apiCtx.get(`${LG_API}/quotes/${otherSeed.quotePublicId}`),
      "other quote row",
    );
    expect(otherRow.default_template_id, "another quote's default is untouched — the swap is PER-QUOTE, not global").not.toBe(t2.public_id);

    const defaultRecords = await json<{ items: CreatedTemplate[] }>(
      await apiCtx.get(`${LG_API}/frame-template-records`),
      "template records re-fetch",
    );
    expect(
      defaultRecords.items.filter((t) => t.is_default).map((t) => t.public_id),
      "the per-quote control never writes the GLOBAL is_default flag (D5)",
    ).not.toContain(t2.public_id);
  });

  test("Apply to funnel: preview-before-apply + confirm, and Cancel leaves the funnel untouched", async ({ page }) => {
    const seed = await seedQuote(apiCtx, "apply", true);
    const u = Date.now();
    const target = await createTemplate(apiCtx, `P4T Apply ${u}`, { section_slot: { card: "bare" }, footer: { enabled: false } });
    await openTemplatesTab(page, seed.quotePublicId);

    const before = await json<{ frame_config: unknown; effective_frame: { template: string } }>(
      await apiCtx.get(`${LG_API}/funnels/${seed.funnelPublicId}/frame`),
      "frame before",
    );

    // --- Cancel path: untouched proof --------------------------------------
    await page.locator("#lg-tpl-apply-btn").click();
    const applyDialog = page.locator("#lg-tpl-apply-dialog");
    await expect(applyDialog).toBeVisible();
    await expect(applyDialog.locator('[data-apply-state="choose"]')).toBeVisible();
    let applyRequestFired = false;
    page.on("request", (r) => {
      if (r.url().includes("/apply-template")) applyRequestFired = true;
    });
    await page.locator(`[data-apply-choice="${target.public_id}"]`).click();
    await expect(applyDialog.locator('[data-apply-state="confirm"]')).toBeVisible({ timeout: 10_000 });
    await expect(applyDialog.locator("#lg-tpl-apply-confirm-list li").first()).toBeVisible();
    await page.locator("#lg-tpl-apply-cancel-btn").click();
    await expect(applyDialog).toBeHidden();
    expect(applyRequestFired, "Cancel must never call apply-template").toBe(false);
    const afterCancel = await json<{ effective_frame: { template: string } }>(
      await apiCtx.get(`${LG_API}/funnels/${seed.funnelPublicId}/frame`),
      "frame after cancel",
    );
    expect(afterCancel.effective_frame.template).toBe(before.effective_frame.template);

    // --- Confirm path: actually applies -------------------------------------
    await page.locator("#lg-tpl-apply-btn").click();
    await page.locator(`[data-apply-choice="${target.public_id}"]`).click();
    await expect(applyDialog.locator('[data-apply-state="confirm"]')).toBeVisible({ timeout: 10_000 });
    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/apply-template") && r.request().method() === "POST"),
      page.waitForNavigation({ waitUntil: "domcontentloaded" }).catch(() => null),
      page.locator("#lg-tpl-apply-confirm-btn").click(),
    ]);
    const after = await json<{ frame_config: { frame_template_id?: unknown } | null; effective_frame: unknown }>(
      await apiCtx.get(`${LG_API}/funnels/${seed.funnelPublicId}/frame`),
      "frame after apply",
    );
    const funnelRow = await json<{ frame_template_id: number | null }>(
      await apiCtx.get(`${LG_API}/funnels/${seed.funnelPublicId}`),
      "funnel row after apply",
    );
    expect(funnelRow.frame_template_id).toBe(target.id);
    void after;
  });

  test("A/B templates: forks the current variant into a new arm with a DIFFERENT frame_template_id", async ({ page }) => {
    const seed = await seedQuote(apiCtx, "abtpl", true);
    const u = Date.now();
    const altTemplate = await createTemplate(apiCtx, `P4T Alt ${u}`);
    await openTemplatesTab(page, seed.quotePublicId);

    await page.locator("#lg-tpl-ab-btn").click();
    const abDialog = page.locator("#lg-tpl-ab-dialog");
    await expect(abDialog).toBeVisible();
    await page.locator("#lg-tpl-ab-template-select").selectOption({ label: `P4T Alt ${u}` });
    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/fork") && r.request().method() === "POST"),
      page.waitForNavigation({ waitUntil: "domcontentloaded" }).catch(() => null),
      page.locator("#lg-tpl-ab-confirm-btn").click(),
    ]);

    const variants = await json<{ items: Array<{ public_id: string; variant_label: string; frame_template_id: number | null }> }>(
      await apiCtx.get(`${LG_API}/funnels/${seed.funnelPublicId}/variants`),
      "variants after A/B templates",
    );
    expect(variants.items.length, "a second arm now exists").toBeGreaterThanOrEqual(2);
    const newArm = variants.items.find((v) => v.public_id !== seed.variantPublicId);
    expect(newArm?.frame_template_id).toBe(altTemplate.id);
  });

  test("screenshots: Templates tab at 1280 desktop and 375 mobile, no horizontal overflow", async ({ page }) => {
    const seed = await seedQuote(apiCtx, "shots", true);
    await page.setViewportSize({ width: 1280, height: 900 });
    await openTemplatesTab(page, seed.quotePublicId);
    await canvasBodyText(page); // let the first preview settle
    const overflow1280 = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow1280, "no horizontal overflow at 1280").toBeLessThanOrEqual(1);
    await page.screenshot({ path: "test-artifacts/leadgen-p4-templates-1280.png", fullPage: true });

    await page.setViewportSize({ width: 375, height: 800 });
    await page.waitForTimeout(200);
    const overflow375 = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow375, "no horizontal overflow at 375").toBeLessThanOrEqual(1);
    await page.screenshot({ path: "test-artifacts/leadgen-p4-templates-375.png", fullPage: true });
  });
});
