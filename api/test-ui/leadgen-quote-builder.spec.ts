// LeadGen v2.5 Phase B (slice B4) — the 15 §15.3 "Quote Builder" Playwright
// rows, driven through the REAL admin UI at :<PW_PORT> (default 8787;
// wrangler dev webServer + mock provider, playwright.config.ts). Seeding rides the REAL admin HTTP
// APIs only (leadgen-b-seed.ts). Rows covered (each test maps 1:1):
//
//   ① site selector lists ALL sites with Active / Activation off /
//     Not activated yet badges AND previews an UNACTIVATED site's branding
//     (C4);
//   ② choose `centered` template → the site logo auto-appears (site fixture
//     WITH a logo — no manual logo configured anywhere);
//   ③ switch preview site → the logo swaps (two sites, two distinct logos);
//   ④ change progress style dots→bar and step through the all-slides
//     preview (progress values advance per slide);
//   ⑤ footer/disclosure/trust configured → appear around EVERY slide in
//     all-slides mode;
//   ⑥ template switch shows preview-before-apply + a confirmation naming
//     the affected regions; Cancel leaves the stored config untouched (C5);
//   ⑦ the variant override badge appears when a NON-control arm overrides
//     progress (and stays hidden on control);
//   ⑧ 04 §4.7: ONE Save persists frame + theme + overrides and the publish
//     chip refreshes to the server verdict.
//
//   ⑨ (Phase D — the B4-deferred C2 row, now LIVE): publishing a Quote whose
//     Section carries a raw-API-inserted legacy chrome node BLOCKS with the
//     §14.1 copy + a Review-slide fix link (409, nothing persists); enabling
//     the Advanced legacy override (compat.allow_section_chrome) downgrades
//     it to a warning and the SAME activation succeeds. Real UI driving;
//     API read-backs at every step.
//
// Local state must be reset once:
// `npm run db:reset:local`.
// Screenshots (desktop 1280) land in test-artifacts/leadgen-b-*.png.

import { test, expect, request as playwrightRequest, type Page, type FrameLocator } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { seedQuoteBuilder, type QuoteBuilderSeed } from "./leadgen-b-seed";
import { PW_PORT } from "./utils/base-url";

test.use({ viewport: { width: 1280, height: 900 } });

const ORIGIN = `http://127.0.0.1:${PW_PORT}`;
const LG_API = "/api/admin/leadgen";
const SHOT_DIR = "test-artifacts";
const uniq = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

let seed: QuoteBuilderSeed;

test.beforeAll(async () => {
  mkdirSync(SHOT_DIR, { recursive: true });
  const ctx = await playwrightRequest.newContext({ baseURL: ORIGIN });
  seed = await seedQuoteBuilder(ctx, uniq);
  await ctx.dispose();
});

function canvas(page: Page): FrameLocator {
  return page.frameLocator("#lg-preview-iframe");
}

async function openEditor(page: Page, variant?: string): Promise<void> {
  const url = `/admin/leadgen/quotes/${seed.quotePublicId}/edit${variant !== undefined ? `?variant=${variant}` : ""}`;
  await page.goto(url, { waitUntil: "domcontentloaded" });
  // the island boots → debounced preview POST → composed srcdoc canvas
  await expect(canvas(page).locator("[data-frame-region='section_slot']")).toBeVisible({ timeout: 20_000 });
}

// The frame studio's header/logo region for the `centered` template renders
// as data-frame-region="logo" (TEMPLATE_HEADER_REGION) — the site-logo img
// rides inside it when branding resolves a logo.
function logoImg(page: Page) {
  return canvas(page).locator("[data-frame-region='logo'] img.lg-logo-img");
}

test.describe.serial("LeadGen v2.5 Quote Builder frame studio — §15.3 rows", () => {
  test("① site selector lists ALL sites with §10.5 badges and previews an UNACTIVATED site's branding (C4)", async ({ page }) => {
    test.setTimeout(90_000);
    await openEditor(page);

    const select = page.locator("#lg-site-select");
    // ALL CMS sites ride the selector with their per-quote status badge
    await expect(select.locator(`option[value="${seed.siteA.id}"]`)).toHaveText(`${seed.siteA.name} — Active`);
    await expect(select.locator(`option[value="${seed.siteA.id}"]`)).toHaveAttribute("data-badge", "Active");
    await expect(select.locator(`option[value="${seed.siteB.id}"]`)).toHaveText(`${seed.siteB.name} — Not activated yet`);
    await expect(select.locator(`option[value="${seed.siteB.id}"]`)).toHaveAttribute("data-badge", "Not activated yet");
    await expect(select.locator(`option[value="${seed.siteC.id}"]`)).toHaveText(`${seed.siteC.name} — Activation off`);
    await expect(select.locator(`option[value="${seed.siteC.id}"]`)).toHaveAttribute("data-badge", "Activation off");
    // …plus the CMS-fallback entry
    await expect(select.locator('option[value=""]')).toHaveText("CMS fallback branding");
    // the canvas toolbar mirror carries the same option set
    await expect(page.locator(`#lg-canvas-site-select option[value="${seed.siteB.id}"]`)).toHaveAttribute("data-badge", "Not activated yet");

    // C4: selecting the UNACTIVATED site previews ITS branding (logo B) —
    // read-only site_settings data, no activation row required
    await select.selectOption(seed.siteB.id);
    await expect(logoImg(page)).toBeVisible({ timeout: 20_000 });
    await expect(logoImg(page)).toHaveAttribute("src", new RegExp(seed.siteB.logoKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    await page.screenshot({ path: `${SHOT_DIR}/leadgen-b-01-site-badges-unactivated-preview.png` });
  });

  test("② choose `centered` template → the site logo auto-appears (site fixture WITH a logo)", async ({ page }) => {
    test.setTimeout(90_000);
    await openEditor(page);
    await page.locator("#lg-site-select").selectOption(seed.siteA.id);
    await expect(logoImg(page)).toBeVisible({ timeout: 20_000 });

    // choose the centered template through the picker (preview-before-apply
    // dialog → apply). No manual logo is configured ANYWHERE — the logo is
    // the §10.2 site-branding inheritance.
    await page.locator("#lg-template-btn").click();
    await page.locator('[data-template-pick="centered"]').click();
    await expect(page.locator("#lg-template-confirm")).toBeVisible({ timeout: 20_000 });
    await page.locator("#lg-template-apply").click();

    await expect(logoImg(page)).toBeVisible({ timeout: 20_000 });
    await expect(logoImg(page)).toHaveAttribute("src", new RegExp(seed.siteA.logoKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    // the img alt carries the site name (the branding projection, not a hardcode)
    await expect(logoImg(page)).toHaveAttribute("alt", seed.siteA.name);
    await page.screenshot({ path: `${SHOT_DIR}/leadgen-b-02-centered-site-logo.png` });
  });

  test("③ switch preview site → the logo swaps", async ({ page }) => {
    test.setTimeout(90_000);
    await openEditor(page);
    const select = page.locator("#lg-site-select");

    await select.selectOption(seed.siteA.id);
    await expect(logoImg(page)).toHaveAttribute("src", new RegExp(seed.siteA.logoKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), { timeout: 20_000 });

    await select.selectOption(seed.siteB.id);
    await expect(logoImg(page)).toHaveAttribute("src", new RegExp(seed.siteB.logoKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), { timeout: 20_000 });
    await page.screenshot({ path: `${SHOT_DIR}/leadgen-b-03-site-switch-logo-swap.png` });
  });

  test("④ progress style dots→bar via the region inspector; all-slides stepping advances the progress values", async ({ page }) => {
    test.setTimeout(120_000);
    await openEditor(page);

    // click the progress region ON THE CANVAS → its inspector opens (§4.1)
    await canvas(page).locator("[data-frame-region='progress']").first().click();
    const panel = page.locator('[data-region-panel="progress"]');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText("Progress counts the slides of this funnel variant automatically.");

    // dots → the canvas re-renders the StepIndicator preset
    await panel.locator('input[name="lg-progress-style"][value="dots"]').check();
    await expect(canvas(page).locator("[data-frame-region='progress'] .lg-steps")).toBeVisible({ timeout: 20_000 });
    await page.screenshot({ path: `${SHOT_DIR}/leadgen-b-04a-progress-dots.png` });

    // …then bar → the ProgressBar preset replaces it
    await panel.locator('input[name="lg-progress-style"][value="bar"]').check();
    await expect(canvas(page).locator("[data-frame-region='progress'] .lg-progress")).toBeVisible({ timeout: 20_000 });
    await expect(canvas(page).locator("[data-frame-region='progress'] .lg-steps")).toHaveCount(0);

    // §4.3-11: the composed denominator now includes the quote's shared-page
    // section (this fixture seeds one) — 3 own slides + 1 shared = 4. "step
    // through ALL slides" now means all 4.
    // step through ALL slides — the per-page progress values ADVANCE
    await page.locator('[data-preview-mode-btn="all"]').click();
    await expect(page.locator("#lg-step-label")).toHaveText("Slide 1 of 4", { timeout: 20_000 });
    const bar = canvas(page).locator("[data-frame-region='progress'] [role='progressbar']").first();
    await expect(bar).toBeVisible({ timeout: 20_000 });
    const v1 = Number(await bar.getAttribute("aria-valuenow"));

    await page.locator("#lg-step-next").click();
    await expect(page.locator("#lg-step-label")).toHaveText("Slide 2 of 4");
    await expect(bar).toBeVisible({ timeout: 20_000 });
    const v2 = Number(await bar.getAttribute("aria-valuenow"));
    expect(v2, `progress advanced (${v1} → ${v2})`).toBeGreaterThan(v1);
    await page.screenshot({ path: `${SHOT_DIR}/leadgen-b-04b-all-slides-step2.png` });

    await page.locator("#lg-step-next").click();
    await expect(page.locator("#lg-step-label")).toHaveText("Slide 3 of 4");
    await expect(bar).toBeVisible({ timeout: 20_000 });
    const v3 = Number(await bar.getAttribute("aria-valuenow"));
    expect(v3, `progress advanced (${v2} → ${v3})`).toBeGreaterThan(v2);

    await page.locator("#lg-step-next").click();
    await expect(page.locator("#lg-step-label")).toHaveText("Slide 4 of 4");
    await expect(bar).toBeVisible({ timeout: 20_000 });
    const v4 = Number(await bar.getAttribute("aria-valuenow"));
    expect(v4, `progress advanced (${v3} → ${v4})`).toBeGreaterThan(v3);
  });

  test("⑤ footer/disclosure/trust configured → appear around EVERY slide in all-slides mode", async ({ page }) => {
    test.setTimeout(120_000);
    await openEditor(page);
    await page.locator('[data-preview-mode-btn="all"]').click();
    // §4.3-11: the composed denominator now includes the quote's shared-page
    // section — 3 own slides + 1 shared = 4.
    await expect(page.locator("#lg-step-label")).toHaveText("Slide 1 of 4", { timeout: 20_000 });

    for (let slide = 1; slide <= 4; slide += 1) {
      if (slide > 1) {
        await page.locator("#lg-step-next").click();
        await expect(page.locator("#lg-step-label")).toHaveText(`Slide ${slide} of 4`);
      }
      const frame = canvas(page);
      // footer (manual links + trust text) rides EVERY composed page
      await expect(frame.locator("[data-frame-region='footer']"), `footer on slide ${slide}`).toBeVisible({ timeout: 20_000 });
      await expect(frame.locator("[data-frame-region='footer'] a.lg-footerbar-link", { hasText: "Privacy" }), `privacy link on slide ${slide}`).toBeVisible();
      await expect(frame.locator("[data-frame-region='footer']"), `trust text on slide ${slide}`).toContainText("Licensed advisor network");
      // top-bar disclosure
      await expect(frame.locator("[data-frame-region='disclosure']").first(), `disclosure on slide ${slide}`).toBeVisible();
      await expect(frame.locator("[data-frame-region='disclosure']").first(), `disclosure label on slide ${slide}`).toContainText("Advertising Disclosure");
      // trust strip with BOTH seeded logos
      await expect(frame.locator("[data-frame-region='trust_strip']"), `trust strip on slide ${slide}`).toBeVisible();
      await expect(frame.locator("[data-frame-region='trust_strip'] img.lg-logo-strip-img"), `trust logos on slide ${slide}`).toHaveCount(2);
      // …and the slide's OWN question unit is the one that changes
      await expect(frame.locator("[data-frame-region='section_slot']"), `slot on slide ${slide}`).toBeVisible();
    }
    await page.screenshot({ path: `${SHOT_DIR}/leadgen-b-05-chrome-on-every-slide.png` });
  });

  test("⑥ C5: template switch previews BEFORE apply + confirmation names the affected regions; Cancel leaves config untouched", async ({ page }) => {
    test.setTimeout(120_000);
    const configBefore = await page.request.get(`${LG_API}/funnels/${seed.funnelPublicId}/frame`).then((r) => r.json()) as { frame_config: Record<string, unknown> };
    expect(configBefore.frame_config["template"]).toBe("centered");

    await openEditor(page);
    // the seeded footer renders on the centered canvas before the switch
    await expect(canvas(page).locator("[data-frame-region='footer']")).toBeVisible({ timeout: 20_000 });

    await page.locator("#lg-template-btn").click();
    await page.locator('[data-template-pick="minimal"]').click();

    // the confirmation NAMES the regions that stop rendering (trust strip +
    // footer are not part of 'minimal') and says the content is kept
    const confirm = page.locator("#lg-template-confirm");
    await expect(confirm).toBeVisible({ timeout: 20_000 });
    const lines = page.locator("#lg-template-confirm-list li");
    await expect(lines.filter({ hasText: /Trust strip isn't part of 'minimal'/ })).toHaveCount(1);
    await expect(lines.filter({ hasText: /2 logos are kept but won't show/ })).toHaveCount(1);
    await expect(lines.filter({ hasText: /Footer isn't part of 'minimal'/ })).toHaveCount(1);

    // preview-BEFORE-apply: the canvas already shows the WOULD-BE minimal
    // composition (no footer region) while nothing is persisted
    await expect(canvas(page).locator("[data-frame-region='footer']")).toHaveCount(0, { timeout: 20_000 });
    await page.screenshot({ path: `${SHOT_DIR}/leadgen-b-06-switch-confirm-preview.png` });

    const duringPreview = await page.request.get(`${LG_API}/funnels/${seed.funnelPublicId}/frame`).then((r) => r.json()) as { frame_config: Record<string, unknown> };
    expect(duringPreview.frame_config).toEqual(configBefore.frame_config); // nothing persisted by the preview

    // CANCEL → dialog closes, the canvas restores the centered composition,
    // and the stored config is byte-identical
    await page.locator("#lg-template-cancel").click();
    await expect(confirm).toBeHidden();
    await expect(canvas(page).locator("[data-frame-region='footer']")).toBeVisible({ timeout: 20_000 });
    const afterCancel = await page.request.get(`${LG_API}/funnels/${seed.funnelPublicId}/frame`).then((r) => r.json()) as { frame_config: Record<string, unknown> };
    expect(afterCancel.frame_config).toEqual(configBefore.frame_config);
  });

  test("⑦ the variant override badge appears when a non-control arm overrides progress (hidden on control)", async ({ page }) => {
    test.setTimeout(90_000);
    // Rework M1 (§4.3-10) + conductor extension round 2: leadgen-b-seed.ts
    // now bootstraps arm B through the sanctioned create-experiment ->
    // start -> fork flow. armBVariantId is only null if that flow itself
    // regresses — fail loud (not skip) so a real regression is never silent.
    expect(seed.armBVariantId, seed.armBBlockedReason ?? "arm B was not created").toBeTruthy();
    // control arm: no overrides → badge hidden
    await openEditor(page);
    await expect(page.locator("#lg-override-badge")).toBeHidden();

    // arm B: stored progress override → badge visible, naming the group
    await openEditor(page, seed.armBVariantId!);
    const badge = page.locator("#lg-override-badge");
    await expect(badge).toBeVisible();
    await expect(badge).toContainText("Variant overrides:");
    await expect(page.locator("#lg-override-badge-list")).toHaveText("Progress");
    // …and the overridden progress renders on THIS arm's canvas (dots)
    await expect(canvas(page).locator("[data-frame-region='progress'] .lg-steps")).toBeVisible({ timeout: 20_000 });
    // the A/B tab lists the overridden group for the arm (§4.5)
    await expect(page.locator(`[data-arm-overrides="${seed.armBVariantId}"]`)).toContainText("Funnel-layout overrides: Progress");
    await page.screenshot({ path: `${SHOT_DIR}/leadgen-b-07-override-badge.png` });
  });

  test("⑧ 04 §4.7: ONE Save persists frame + theme + overrides; the publish chip refreshes to the server verdict", async ({ page }) => {
    test.setTimeout(120_000);
    // Same arm-B bootstrap as row ⑦ above — see that test's comment.
    expect(seed.armBVariantId, seed.armBBlockedReason ?? "arm B was not created").toBeTruthy();
    await openEditor(page, seed.armBVariantId!);

    // FRAME edit (funnel-level): select the header via the canvas logo region
    // → tagline
    await canvas(page).locator("[data-frame-region='logo']").first().click();
    const headerPanel = page.locator('[data-region-panel="header"]');
    await expect(headerPanel).toBeVisible();
    const tagline = headerPanel.locator('input[data-frame-key="header.tagline"]');
    await tagline.fill(`Trusted by reviewers ${uniq}`);
    await tagline.blur();

    // THEME edit: open the theme editor → radius scale
    await page.locator("#lg-theme-btn").click();
    await expect(page.locator("#lg-theme-editor")).toBeVisible();
    await page.locator('select[data-theme-key="scales.radius"]').selectOption("round");

    // Round-4 P5b DELIBERATE RE-PIN (conductor-granted, mandated IA change):
    // "Theme" is now a top-level tab (the operator restructure spec), so
    // #lg-theme-btn navigates away from the Funnel builder tab instead of
    // toggling an inline panel over the SAME always-visible canvas. Re-
    // activate the builder tab before the next canvas interaction.
    await page.locator('.lg-qtab[data-tab="builder"]').click();

    // OVERRIDE edit (this arm): progress inspector → style percent (the
    // stored dots override + the checked override switch come from the seed)
    await canvas(page).locator("[data-frame-region='progress']").first().click();
    const progressPanel = page.locator('[data-region-panel="progress"]');
    await expect(progressPanel).toBeVisible();
    await expect(progressPanel.locator('input[data-override-group="progress"][value="override"]')).toBeChecked();
    await progressPanel.locator('input[name="lg-progress-style"][value="percent"]').check();

    // ONE Save — capture the variant PUT's recomputed preflight (the verdict
    // the chip must refresh FROM, 05 §5.2a: the variant-save leg is scoped to
    // the SAVED arm + funnel-level rows — NOT the all-arms activation GET)
    const chipBefore = await page.locator("#lg-publish-badge").textContent();
    const putResponsePromise = page.waitForResponse(
      (r) => r.request().method() === "PUT" && r.url().includes(`/variants/${seed.armBVariantId}`),
    );
    await page.locator("#lg-variant-save").click();
    const putResponse = await putResponsePromise;
    expect(putResponse.status()).toBe(200);
    const putBody = (await putResponse.json()) as {
      activation_preflight: { ok: boolean; blocks: unknown[]; problems?: Array<{ severity: string }> };
    };
    await expect(page.locator("#lg-quote-ok")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator("#lg-quote-ok")).toContainText("Saved");
    await page.screenshot({ path: `${SHOT_DIR}/leadgen-b-08-one-save.png` });

    // SERVER truth: all three payloads persisted by the single Save
    const frame = await page.request.get(`${LG_API}/funnels/${seed.funnelPublicId}/frame`).then((r) => r.json()) as { frame_config: Record<string, unknown> };
    expect((frame.frame_config["header"] as Record<string, unknown>)["tagline"]).toBe(`Trusted by reviewers ${uniq}`);
    const theme = await page.request.get(`${LG_API}/funnels/${seed.funnelPublicId}/theme`).then((r) => r.json()) as { theme: Record<string, unknown> };
    expect((theme.theme["scales"] as Record<string, unknown>)["radius"]).toBe("round");
    const structure = await page.request.get(`${LG_API}/quotes/${seed.quotePublicId}/structure`).then((r) => r.json()) as {
      funnels: Array<{ variants: Array<{ public_id: string; frame_overrides_json: Record<string, unknown> | null }> }>;
    };
    const armB = structure.funnels[0]!.variants.find((v) => v.public_id === seed.armBVariantId)!;
    expect(armB.frame_overrides_json).toEqual({ progress: { style: "percent" } });

    // publish chip refresh: the chip equals the verdict the SAVE returned
    // (14 §14.2 counts over blocks + problems severities)
    const problems = putBody.activation_preflight.problems ?? [];
    const errors = putBody.activation_preflight.blocks.length + problems.filter((p) => p.severity === "error").length;
    const warnings = problems.filter((p) => p.severity === "warning").length;
    const expectedText = errors > 0
      ? `Blocked (${errors} ${errors === 1 ? "error" : "errors"})`
      : warnings > 0
        ? `Ready (${warnings} ${warnings === 1 ? "warning" : "warnings"})`
        : "Ready";
    const chip = page.locator("#lg-publish-badge");
    await expect(chip).toHaveAttribute("data-publish-verdict", errors > 0 ? "blocked" : "ok");
    await expect(chip).toHaveText(expectedText);
    // the island's post-save re-render stamps the live counts on the chip
    await expect(chip).toHaveAttribute("data-publish-errors", String(errors));
    await expect(chip).toHaveAttribute("data-publish-warnings", String(warnings));
    // the refresh actually happened: the SSR chip carried the all-arms
    // activation-GET verdict; the save re-rendered it to the arm-scoped one
    expect(await chip.textContent(), "chip re-rendered after Save").not.toBe(chipBefore);
    // …and the preflight panel reflects the same verdict
    await expect(page.locator("#lg-preflight-panel")).toHaveAttribute("data-preflight-state", putBody.activation_preflight.ok && errors === 0 ? "pass" : "blocked");
  });

  test("⑨ C2 LIVE: chrome-in-a-section BLOCKS publish with the §14.1 copy + fix link; the Advanced legacy override downgrades it to a warning and activation succeeds", async ({ page }) => {
    test.setTimeout(120_000);
    const cq = seed.chromeQuote;

    // open the chrome quote's editor (composed canvas boots — frame configured)
    await page.goto(`/admin/leadgen/quotes/${cq.quotePublicId}/edit`, { waitUntil: "domcontentloaded" });
    await expect(canvas(page).locator("[data-frame-region='section_slot']")).toBeVisible({ timeout: 20_000 });

    // --- attempt to publish on site A → the C2 BLOCK -------------------------
    await page.locator('.lg-qtab[data-tab="activation"]').click();
    const row = page.locator(`.lg-activation-row[data-site-id="${seed.siteA.id}"]`);
    await row.locator("[data-site-enabled]").check();
    await row.locator("[data-site-slug]").fill(`lg-d-chrome-${uniq}`);
    const blockedResponse = page.waitForResponse(
      (r) => r.request().method() === "PUT" && r.url().includes(`/quotes/${cq.quotePublicId}/activation/`),
    );
    await row.locator("[data-save-activation]").click();
    const blocked = await blockedResponse;
    expect(blocked.status()).toBe(409);
    const blockedBody = (await blocked.json()) as {
      error: string; blocks: unknown[];
      problems: Array<{ path: string; scope: string; severity: string; message: string; fix_url?: string }>;
    };
    // §14.2: the historical report + the additive problems — the C2 error is
    // the ONLY blocker (zero legacy blocks)
    expect(blockedBody.error).toBe("quote_activation_blocked");
    expect(blockedBody.blocks).toEqual([]);
    const chromeProblem = blockedBody.problems.find((p) => p.path === `section.${cq.sectionPublicId}.content`);
    expect(chromeProblem?.severity).toBe("error");

    // the Activation panel renders the §14.1 copy grouped under Slides with
    // the severity chip + the Review-slide fix link
    await expect(page.locator("#lg-quote-error")).toContainText("Cannot activate this Quote");
    await expect(page.locator("#lg-preflight-panel")).toHaveAttribute("data-preflight-state", "blocked");
    const problemRow = page.locator(`#lg-preflight-problems [data-problem-scope="section"] [data-problem-path="section.${cq.sectionPublicId}.content"]`);
    await expect(problemRow).toBeVisible();
    await expect(problemRow.locator('.lg-problem-chip[data-severity="error"]')).toHaveText("Error");
    await expect(problemRow).toContainText(`'${cq.sectionName}' contains funnel-layout elements`); // MAJOR-1: renamed from "page-frame elements"
    await expect(problemRow).toContainText("would render twice on the live page");
    await expect(problemRow).toContainText("enable the legacy override under Advanced");
    const fixLink = problemRow.locator("a", { hasText: "Review slide" });
    await expect(fixLink).toHaveAttribute("href", `/admin/leadgen/sections/${cq.sectionPublicId}/edit`);
    await page.screenshot({ path: `${SHOT_DIR}/leadgen-d-09a-c2-blocked.png` });

    // API read-back: the 409 persisted NOTHING for this quote on site A
    const afterBlock = await page.request.get(`${LG_API}/quotes/${cq.quotePublicId}/activation`).then((r) => r.json()) as {
      sites: Array<{ site_id: string; activated: boolean; enabled: boolean }>;
    };
    const siteRow = afterBlock.sites.find((s) => s.site_id === seed.siteA.id)!;
    expect(siteRow.activated, "blocked PUT persisted no activation row").toBe(false);
    expect(siteRow.enabled).toBe(false);

    // --- enable the Advanced legacy override through the REAL UI -------------
    await page.locator('.lg-qtab[data-tab="builder"]').click();
    await page.locator("[data-region-panel-compat] summary").click();
    await page.locator('[data-region-panel-compat] input[data-frame-key="compat.allow_section_chrome"]').check();
    const framePutResponse = page.waitForResponse(
      (r) => r.request().method() === "PUT" && r.url().includes(`/funnels/${cq.funnelPublicId}/frame`),
    );
    await page.locator("#lg-variant-save").click();
    expect((await framePutResponse).status()).toBe(200);
    await expect(page.locator("#lg-quote-ok")).toBeVisible({ timeout: 20_000 });
    // API read-back: the override persisted on the funnel frame
    const frame = await page.request.get(`${LG_API}/funnels/${cq.funnelPublicId}/frame`).then((r) => r.json()) as {
      frame_config: { compat?: { allow_section_chrome?: boolean } };
    };
    expect(frame.frame_config.compat?.allow_section_chrome).toBe(true);

    // --- the SAME publish now succeeds with the downgraded warning -----------
    await page.locator('.lg-qtab[data-tab="activation"]').click();
    await row.locator("[data-site-enabled]").check();
    await row.locator("[data-site-slug]").fill(`lg-d-chrome-${uniq}`);
    const okResponse = page.waitForResponse(
      (r) => r.request().method() === "PUT" && r.url().includes(`/quotes/${cq.quotePublicId}/activation/`),
    );
    await row.locator("[data-save-activation]").click();
    expect((await okResponse).status()).toBe(200);
    await expect(page.locator("#lg-quote-ok")).toContainText("Activation saved");
    await expect(page.locator("#lg-preflight-panel")).toHaveAttribute("data-preflight-state", "pass");
    const warningRow = page.locator(`#lg-preflight-problems [data-problem-path="section.${cq.sectionPublicId}.content"]`);
    await expect(warningRow.locator('.lg-problem-chip[data-severity="warning"]')).toHaveText("Warning");
    await expect(warningRow).toContainText("Legacy override is ON");
    await expect(warningRow).toContainText("keeps its own page chrome");
    // the publish chip flipped to the ok verdict (warnings never block)
    await expect(page.locator("#lg-publish-badge")).toHaveAttribute("data-publish-verdict", "ok");
    await expect(page.locator("#lg-publish-badge")).toContainText("Ready (");
    await page.screenshot({ path: `${SHOT_DIR}/leadgen-d-09b-c2-compat-warning.png` });

    // API read-back: activation persisted this time
    const afterOk = await page.request.get(`${LG_API}/quotes/${cq.quotePublicId}/activation`).then((r) => r.json()) as {
      sites: Array<{ site_id: string; enabled: boolean; slug: string | null }>;
    };
    const okRow = afterOk.sites.find((s) => s.site_id === seed.siteA.id)!;
    expect(okRow.enabled).toBe(true);
    expect(okRow.slug).toBe(`lg-d-chrome-${uniq}`);
  });

  test("⑩ E4: a REAL click on the bare page-background area opens the §4.4 Background inspector; role+style edit → Save → API read-back", async ({ page }) => {
    test.setTimeout(120_000);
    await openEditor(page);

    // the Background panel is closed until the region is selected
    const panel = page.locator('[data-region-panel="background"]');
    await expect(panel).toBeHidden();

    // The served .lg-frame-background layer is pointer-events:none BEHIND
    // the content (the E1-measured defect: every probed point reported
    // "#lg-funnel-root … intercepts pointer events"), so the page background
    // the operator SEES and clicks is the bare strip beside the centered
    // card slot — a point vertically centered on the slot, horizontally
    // between the root's left edge and the slot's left edge (block regions
    // never overlap the slot's vertical band).
    const root = canvas(page).locator("#lg-funnel-root");
    const slotBox = await canvas(page).locator("[data-frame-region='section_slot']").boundingBox();
    const rootBox = await root.boundingBox();
    expect(slotBox, "slot bounding box").not.toBeNull();
    expect(rootBox, "root bounding box").not.toBeNull();
    await root.click({
      position: {
        x: Math.max(4, (slotBox!.x - rootBox!.x) / 2),
        y: slotBox!.y - rootBox!.y + slotBox!.height / 2,
      },
    });

    // …the Background inspector opens (04 §4.1 canvas click-select)
    await expect(panel).toBeVisible();

    // §4.4 edits: background color role via the swatch strip + style → brand
    await panel.locator('[data-role-pick="brand_secondary"][data-role-pick-for="background.role"]').click();
    await panel.locator('select[data-frame-key="background.style"]').selectOption("brand");
    // the canvas re-composes with BOTH stamps (role + style classes)
    const bgLayer = canvas(page).locator("[data-frame-region='background']");
    await expect(bgLayer).toHaveClass(/lg-frame-bg-role-brand_secondary/, { timeout: 20_000 });
    await expect(bgLayer).toHaveClass(/lg-frame-bg-style-brand/);
    await page.screenshot({ path: `${SHOT_DIR}/leadgen-e-10-background-inspector.png` });

    // ONE Save → the funnel frame PUT persists the background group
    const framePut = page.waitForResponse(
      (r) => r.request().method() === "PUT" && r.url().includes(`/funnels/${seed.funnelPublicId}/frame`),
    );
    await page.locator("#lg-variant-save").click();
    expect((await framePut).status()).toBe(200);
    await expect(page.locator("#lg-quote-ok")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator("#lg-quote-ok")).toContainText("Saved");

    // API read-back: the stored funnel frame carries the authored background
    const frame = await page.request.get(`${LG_API}/funnels/${seed.funnelPublicId}/frame`).then((r) => r.json()) as {
      frame_config: { background?: { role?: string; style?: string } };
    };
    expect(frame.frame_config.background?.role).toBe("brand_secondary");
    expect(frame.frame_config.background?.style).toBe("brand");
  });
});
