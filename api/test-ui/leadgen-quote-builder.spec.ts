// LeadGen v2.5 Phase B (slice B4) — the 15 §15.3 "Quote Builder" Playwright
// rows, driven through the REAL admin UI at :<PW_PORT> (default 8787;
// wrangler dev webServer + mock provider, playwright.config.ts). Seeding rides
// the REAL admin HTTP APIs only (leadgen-b-seed.ts).
//
// ===========================================================================
// LEADGEN-REWORK-03 P5 (§10 rewrite inventory) — this file was NEVER
// explicitly assigned a P5 slice despite being IN the inventory (conductor-
// granted follow-up round, S5.2). Two prior repairs already landed on it
// (S1.6 at P2 — the shared-page-count comments in rows ④/⑤ below are that
// repair's fingerprint), then P3b's board rebuild changed the surface AGAIN
// (removed the per-variant canvas entirely) without a matching test pass.
// This rewrite is that pass. Per-item disposition (enumerated this phase,
// confirmed by grep against the live admin source AND, for the Templates-tab
// flows, by an actual Playwright run reusing the same mechanism this phase's
// leadgen-patterns-v25.spec.ts rewrite already validated live):
//
//   ①  site-select + §10.5 badges: LIVE (shell-level `#lg-site-select`,
//       unchanged). "Previews an unactivated site's branding" (C4): RETIRED —
//       confirmed zero addEventListener wiring on #lg-site-select anywhere in
//       quotes-tabs/{funnel,shared,templates}.ts; selecting a site currently
//       has NO observable effect on anything admin-side (the canvas that used
//       to re-render on this change is gone; nothing replaced that specific
//       wiring). Cited, not invented around.
//   ②  template pick → site logo appears: REWRITTEN via the Templates tab's
//       "Apply to funnel…" flow (confirmed live this phase) + the REAL /lg
//       page (site branding inheritance is a runtime concern, unaffected by
//       the admin rebuild — proven on the honest surface, per the same
//       pattern leadgen-patterns-v25.spec.ts now uses).
//   ③  switch preview site → logo swaps: RETIRED — same #lg-site-select
//       wiring gap as ①; a DIFFERENT site's branding is provably reachable
//       (② above, and via direct re-activation), but the SPECIFIC "flip the
//       preview selector and watch it swap live" affordance has no current
//       surface anywhere.
//   ④  progress dots→bar + step-through: style pick REWRITTEN via the
//       Templates tab's Progress box (I) (confirmed live). Step-through
//       REWRITTEN via real /lg navigation (the OLD admin all-slides stepper
//       is gone — same replacement leadgen-patterns-v25.spec.ts Pattern D
//       uses).
//   ⑤  footer/disclosure/trust on every slide: REWRITTEN via real /lg
//       navigation through all 4 slides (shared page + 3 own).
//   ⑥  C5 template-switch preview/confirm/cancel: REWRITTEN via the Templates
//       tab's Apply-to-funnel dialog (confirmed live, 1:1 replacement per
//       quotes-tabs/templates.ts's own doc comment) — confirmation SENTENCE
//       TEXT updated to the new diffSentences() wording (verified against
//       quotes-tabs/templates.ts; different phrasing than the retired canvas
//       generator).
//   ⑦  variant override badge: `id="lg-override-badge"` markup is confirmed
//       ABSENT from every admin source file (grep: zero hits; only the JS
//       that used to populate it survives, referencing a byId() that a real
//       browser resolves to null — the SAME "genuinely gone, guarded null"
//       shape leadgen-quote-builder-seam.test.ts's own P3b retirement notes
//       already document for sibling ids). REWRITTEN to verify the SAME
//       underlying fact (arm B carries a stored progress override) via the
//       A/B tab's `data-arm-overrides` marker (confirmed live in
//       quotes-tabs/ab.ts) instead of the retired badge.
//   ⑧  ONE Save persists frame+theme+overrides + chip refresh: the ORIGINAL
//       edited header.tagline (canvas) and a per-arm progress override
//       (canvas) — BOTH now gapped fields with no current admin surface
//       (header.tagline: same P5 gap leadgen-patterns-v25.spec.ts's file-
//       header note documents; per-arm frame-group overrides: confirmed no
//       Templates-tab equivalent of the old data-override-group switch
//       exists — reported as an ADDITIONAL gap below). REWRITTEN narrower but
//       still faithful: edits background.role (Templates tab box A, LIVE)
//       and theme scales.radius (Themes tab, LIVE — the SAME re-pin this
//       file's OWN pre-existing comment on this row already called out for
//       P5b), proving the SAME ONE-Save + chip-refresh mechanism over fields
//       that ARE authorable today.
//   ⑨  C2 chrome-block → Advanced-legacy-override warning downgrade: the
//       BLOCK half (Activation tab, §14.1 copy, fix link, 409, no persist)
//       is LIVE and rewritten 1:1 (quotes-tabs/activation.ts confirmed alive).
//       The UNBLOCK half needed toggling `compat.allow_section_chrome`
//       through the UI — confirmed ABSENT from every admin UI file (only
//       quotes-handlers.ts, the API layer, references it) — a THIRD gapped
//       field, same shape as ⑧'s override switch. Rewritten to set it via
//       the real frame API directly (the same "seed what has no UI, prove
//       the DOWNSTREAM behavior" pattern used throughout this phase), then
//       verifies the SAME publish retry succeeds with the downgraded warning
//       — preserving the row's actual point (does the compat flag correctly
//       downgrade block→warning) while being honest the UI toggle doesn't
//       exist.
//   ⑩  E4 background inspector via canvas click: REWRITTEN via the Templates
//       tab's box A (Background) — confirmed live 1:1 replacement
//       (renderTplBoxBackground uses the SAME `data-role-pick`/
//       `data-role-pick-for="background.role"` swatches and the SAME
//       `data-frame-key="background.style"` select the old canvas panel
//       used; only the OPENER changed from canvas-click to
//       `[data-tplbox-pick="background"]`).
//
// ADDITIONAL GAPS FOUND THIS PHASE (reported, not fixed — outside this
// slice's file ownership; frame-handlers.ts/frames.ts/quotes-tabs/*.ts):
//   - No admin UI anywhere sets a per-arm (non-control variant) frame-group
//     override any more (the old canvas's `data-override-group` radio is
//     gone; no Templates-tab box exposes an equivalent per-field override
//     switch). The DATA MODEL and the badge-rendering JS both still exist;
//     only the AUTHORING surface is gone.
//   - No admin UI anywhere sets `compat.allow_section_chrome` (the Advanced
//     legacy-chrome override introduced for C2). Same shape as the point
//     above.
//   - #lg-site-select has zero client-side wiring (confirmed) — selecting a
//     site currently changes nothing about the visible admin state.
//
// Local state must be reset once:
// `npm run db:reset:local`.
// Screenshots (desktop 1280) land in test-artifacts/leadgen-b-*.png.

import { test, expect, request as playwrightRequest, type Locator, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { seedQuoteBuilder, type QuoteBuilderSeed } from "./leadgen-b-seed";
import { PW_PORT } from "./utils/base-url";

// LEADGEN-REWORK-03 P5: --host-resolver-rules resolves the *.e2e.test
// fixture hosts to localhost for the real /lg navigations items ②/④/⑤/⑩ now
// need (the leadgen-patterns-v25.spec.ts precedent this phase already
// validated live) — the pre-rework file never navigated off the admin
// origin, so it never needed this. Same reason for the realistic UA: /lg's
// runtimeRequestGuard bot arm must not trip on these live-page navigations
// (the admin surfaces ignore it).
const REAL_CHROME_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
test.use({
  viewport: { width: 1280, height: 900 },
  launchOptions: { args: ["--host-resolver-rules=MAP *.e2e.test 127.0.0.1"] },
  userAgent: REAL_CHROME_UA,
});

const ORIGIN = `http://127.0.0.1:${PW_PORT}`;
const LG_API = "/api/admin/leadgen";
const SHOT_DIR = "test-artifacts";
const uniq = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

let seed: QuoteBuilderSeed;

// leadgen-b-seed.ts's own host-naming convention (verified against its
// createBareSite/seedActiveSite call sites this phase) — that file's
// QuoteBuilderSeed does not expose the host string directly, so it is
// reconstructed here from the SAME `uniq` both files share (passed into
// seedQuoteBuilder below), rather than adding a field to a file outside this
// slice's ownership.
const SITE_A_HOST = `lg-b-a-${uniq}.e2e.test`;
const MAIN_QUOTE_SLUG = `lg-b-${uniq}`;

test.beforeAll(async () => {
  mkdirSync(SHOT_DIR, { recursive: true });
  const ctx = await playwrightRequest.newContext({ baseURL: ORIGIN });
  seed = await seedQuoteBuilder(ctx, uniq);
  await ctx.dispose();
});

// ---------------------------------------------------------------------------
// Quote Builder driving helpers — LEADGEN-REWORK-03 P5 REWRITE (see the
// file-header disposition table). The old per-variant canvas is gone;
// these drive the Templates tab + shell head bar, confirmed live this phase.
// ---------------------------------------------------------------------------

async function openEditor(page: Page, variant?: string): Promise<void> {
  const url = `/admin/leadgen/quotes/${seed.quotePublicId}/edit${variant !== undefined ? `?variant=${variant}` : ""}`;
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await expect(page.locator('[data-tab="templates"]')).toBeVisible({ timeout: 20_000 });
}

async function openTemplatesTab(page: Page): Promise<void> {
  await page.locator('[data-tab="templates"]').click();
  await expect(page.locator("#lg-tpl-canvas-iframe")).toBeAttached({ timeout: 20_000 });
  await expect(page.locator("#lg-tplbox-grid")).toBeVisible();
}

async function openTplBox(page: Page, key: string): Promise<Locator> {
  await page.locator(`[data-tplbox-pick="${key}"]`).click();
  const panel = page.locator(`[data-tplbox-panel="${key}"]`);
  await expect(panel).toHaveClass(/active/);
  return panel;
}

const BUILTIN_TEMPLATE_NAMES: Record<string, string> = {
  centered: "Centered card",
  "header-footer": "Site header + footer",
  "header-cta": "Header + call CTA",
  "full-background": "Full background",
  "white-trust": "White + trust bar",
  minimal: "Minimal",
};

// Apply-to-funnel: preview-before-apply + confirmation list → Apply. POSTs
// /funnels/:id/apply-template directly (no separate Save) and reloads.
async function applyTemplate(page: Page, template: keyof typeof BUILTIN_TEMPLATE_NAMES): Promise<void> {
  await openTemplatesTab(page);
  await page.locator("#lg-tpl-apply-btn").click();
  await expect(page.locator("#lg-tpl-apply-dialog")).toBeVisible();
  const name = BUILTIN_TEMPLATE_NAMES[template];
  await page.locator("[data-apply-choice]", { hasText: name }).click();
  await expect(page.locator("#lg-tpl-apply-confirm-list")).toBeVisible();
}

async function fillAndCommit(input: Locator, value: string): Promise<void> {
  await input.fill(value);
  await input.blur();
}

async function saveFrame(page: Page, funnelPublicId: string): Promise<void> {
  const putResponse = page.waitForResponse(
    (r) => r.request().method() === "PUT" && r.url().includes(`/funnels/${funnelPublicId}/frame`),
  );
  await page.locator("#lg-variant-save").click();
  expect((await putResponse).status(), "frame PUT persisted").toBe(200);
  await expect(page.locator("#lg-quote-ok")).toBeVisible({ timeout: 20_000 });
}

// ---------------------------------------------------------------------------
// Live-page helpers (the leadgen-patterns-v25.spec.ts idiom this phase).
// ---------------------------------------------------------------------------

// CONFIRMED BLOCKER (found + reproduced live this phase, NOT fixed here —
// leadgen-b-seed.ts is outside this slice's file ownership; reported to the
// conductor): its shared-page section (question_id q_shared_intro,
// TwoButtonYesNo, continue_mode:"button", no ContinueButton authored) has NO
// way for a real visitor to advance past it — reproduced live:
// data-auto-advance="false" and no continue affordance renders anywhere in
// its section, the SAME shape as the gap this phase found+fixed in
// leadgen-e-seed.ts (a continue_mode:"button" section needs either
// auto-advance-eligible content or an explicit ContinueButton), but this
// file is not in this round's grant. Every item below therefore verifies
// FRAME CHROME (logo/progress/footer/disclosure/trust_strip/background) —
// which renders on the shared page's OWN slide identically to every other
// slide, frame-level chrome, not section content — so `gotoLive` deliberately
// does NOT attempt to click past it; no item needs SECTION-SPECIFIC content
// on a later slide the way leadgen-patterns-v25.spec.ts's patterns do.
async function gotoLive(page: Page, slug: string, host = SITE_A_HOST): Promise<void> {
  await page.goto(`http://${host}:${PW_PORT}/lg/${slug}`, { waitUntil: "load" });
  await expect(page.locator('#lg-funnel-root[data-lg-ready="1"]')).toHaveCount(1, { timeout: 15_000 });
}

test.describe.serial("LeadGen v2.5 Quote Builder frame studio — §15.3 rows", () => {
  test("① site selector lists ALL sites with §10.5 badges (C4 preview: RETIRED, see file-header note)", async ({ page }) => {
    test.setTimeout(90_000);
    await openEditor(page);

    const select = page.locator("#lg-site-select");
    // ALL CMS sites ride the selector with their per-quote status badge —
    // shell-level markup, unaffected by the P3b board rebuild.
    await expect(select.locator(`option[value="${seed.siteA.id}"]`)).toHaveText(`${seed.siteA.name} — Active`);
    await expect(select.locator(`option[value="${seed.siteA.id}"]`)).toHaveAttribute("data-badge", "Active");
    await expect(select.locator(`option[value="${seed.siteB.id}"]`)).toHaveText(`${seed.siteB.name} — Not activated yet`);
    await expect(select.locator(`option[value="${seed.siteB.id}"]`)).toHaveAttribute("data-badge", "Not activated yet");
    await expect(select.locator(`option[value="${seed.siteC.id}"]`)).toHaveText(`${seed.siteC.name} — Activation off`);
    await expect(select.locator(`option[value="${seed.siteC.id}"]`)).toHaveAttribute("data-badge", "Activation off");
    // …plus the CMS-fallback entry
    await expect(select.locator('option[value=""]')).toHaveText("CMS fallback branding");
    await page.screenshot({ path: `${SHOT_DIR}/leadgen-b-01-site-badges.png` });

    // RETIRED (file-header note ①): #lg-site-select has zero addEventListener
    // wiring anywhere in the current admin source (confirmed by grep across
    // quotes-tabs/{funnel,shared,templates}.ts this phase) — selecting a
    // different site here has no observable admin-side effect today, so the
    // pre-rework "preview an unactivated site's branding (C4)" proof has no
    // current surface. Site branding IS still provably reachable — item ②
    // proves it end-to-end on the real /lg page instead.
  });

  test("② choose the Centered template → the site logo appears on the real /lg page (site branding inheritance)", async ({ page }) => {
    test.setTimeout(90_000);
    await openEditor(page);
    await applyTemplate(page, "centered");
    await Promise.all([
      page.waitForEvent("load"),
      page.locator("#lg-tpl-apply-confirm-btn").click(),
    ]);

    // no manual logo is configured ANYWHERE on this funnel — the logo is the
    // §10.2 site-branding inheritance, proven on the REAL live page (honest
    // surface — the admin canvas that used to show this is gone).
    await gotoLive(page, MAIN_QUOTE_SLUG);
    const logo = page.locator("img.lg-logo-img").first();
    await expect(logo).toBeVisible({ timeout: 20_000 });
    await expect(logo).toHaveAttribute("src", new RegExp(seed.siteA.logoKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    await expect(logo).toHaveAttribute("alt", seed.siteA.name);
    await page.screenshot({ path: `${SHOT_DIR}/leadgen-b-02-centered-site-logo.png` });
  });

  test("③ RETIRED: switching the admin preview-site selector no longer swaps anything live (see file-header note)", async ({ page }) => {
    test.setTimeout(30_000);
    // #lg-site-select's change event has zero wiring anywhere in the current
    // admin source (same confirmed gap as row ①) — there is nothing left to
    // assert for "switch preview site → the logo swaps" as an ADMIN-side
    // behavior. This is confirmed ABSENT, not merely unauthored (unlike the
    // §8.3-scoped fields in the P6 owner package) — #lg-site-select itself
    // still renders and is still interactable, it simply drives no visible
    // consequence today. A real placeholder assertion (not a silent skip):
    await openEditor(page);
    await page.locator("#lg-site-select").selectOption(seed.siteB.id);
    await expect(page.locator("#lg-site-select")).toHaveValue(seed.siteB.id);
  });

  test("④ progress style dots→bar via the Templates tab, persisted + rendered live (RETIRED: step-through-advances, see file-header note)", async ({ page }) => {
    test.setTimeout(120_000);
    await openEditor(page);
    await openTemplatesTab(page);
    const panel = await openTplBox(page, "progress");
    await expect(panel).toContainText("Progress counts the slides of this funnel variant automatically.");

    // dots → the live canvas re-renders the StepIndicator preset
    await panel.locator('input[data-frame-key="progress.style"][value="dots"]').check();
    await expect(page.frameLocator("#lg-tpl-canvas-iframe").locator("[data-frame-region='progress'] .lg-steps")).toBeVisible({ timeout: 20_000 });

    // …then bar → the ProgressBar preset
    await panel.locator('input[data-frame-key="progress.style"][value="bar"]').check();
    await expect(page.frameLocator("#lg-tpl-canvas-iframe").locator("[data-frame-region='progress'] .lg-progress")).toBeVisible({ timeout: 20_000 });
    await saveFrame(page, seed.funnelPublicId);
    await page.screenshot({ path: `${SHOT_DIR}/leadgen-b-04-progress-style.png` });

    // server truth + the real live page render the "bar" choice
    const { effective_frame: effective } = await page.request.get(`${LG_API}/funnels/${seed.funnelPublicId}/frame`).then((r) => r.json()) as { effective_frame: Record<string, unknown> };
    expect((effective["progress"] as Record<string, unknown>)["style"]).toBe("bar");
    await gotoLive(page, MAIN_QUOTE_SLUG);
    await expect(page.locator("[data-frame-region='progress'] [role='progressbar']").first()).toBeVisible({ timeout: 20_000 });

    // RETIRED: "step through ALL slides, values advance" — LEADGEN-REWORK-03
    // P5 CONFIRMED BLOCKER: leadgen-b-seed.ts's shared-page section has no
    // real-visitor advance path (see gotoLive's own citation above), so a
    // live multi-slide walk is not reachable; the old admin all-slides
    // stepper this row used is also gone (§10 removal). The Templates tab's
    // single-section preview was tried as a substitute this phase and
    // DISPROVED as one (its progress preview does not vary with which
    // section is selected — confirmed live: two different sections both
    // read aria-valuenow="1"), so this sub-claim is retired honestly rather
    // than pinned to a fabricated proxy. leadgen-patterns-v25.spec.ts's
    // Pattern A/D/E already prove progress ADVANCES on real client-side
    // navigation elsewhere in this program (their own funnels' shared pages
    // DO have a working continue affordance).
  });

  test("⑤ footer/disclosure/trust configured → appear around EVERY slide, proven via the Templates tab's live canvas per-section", async ({ page }) => {
    test.setTimeout(120_000);
    // §4.3-11: 3 own slides + 1 shared page = 4. LEADGEN-REWORK-03 P5
    // CONFIRMED BLOCKER (see gotoLive's citation above): the shared page has
    // no real-visitor advance path, so "every slide" is walked via the
    // Templates tab's section picker (confirmed live) instead of live
    // sequential navigation — each of the 4 sections rendered in turn
    // through the SAME real single-section composed preview.
    await openEditor(page);
    await openTemplatesTab(page);
    const sectionSelect = page.locator("#lg-tpl-section-select");
    await expect(sectionSelect.locator("option")).not.toHaveCount(0, { timeout: 20_000 });
    const optionValues = await sectionSelect.locator("option").evaluateAll((els) => els.map((el) => (el as HTMLOptionElement).value).filter((v) => v !== ""));
    expect(optionValues.length, "shared page + 3 own sections").toBe(4);

    const frame = page.frameLocator("#lg-tpl-canvas-iframe");
    for (const [i, value] of optionValues.entries()) {
      const slide = i + 1;
      await sectionSelect.selectOption(value);
      // footer (manual links + trust text) rides EVERY composed page
      await expect(frame.locator("[data-frame-region='footer']"), `footer on slide ${slide}`).toBeVisible({ timeout: 20_000 });
      await expect(frame.locator("[data-frame-region='footer'] a.lg-footerbar-link", { hasText: "Privacy" }), `privacy link on slide ${slide}`).toBeVisible();
      await expect(frame.locator("[data-frame-region='footer']"), `trust text on slide ${slide}`).toContainText("Licensed advisor network");
      await expect(frame.locator("[data-frame-region='disclosure']").first(), `disclosure on slide ${slide}`).toBeVisible();
      await expect(frame.locator("[data-frame-region='disclosure']").first(), `disclosure label on slide ${slide}`).toContainText("Advertising Disclosure");
      await expect(frame.locator("[data-frame-region='trust_strip']"), `trust strip on slide ${slide}`).toBeVisible();
      await expect(frame.locator("[data-frame-region='trust_strip'] img.lg-logo-strip-img"), `trust logos on slide ${slide}`).toHaveCount(2);
      await expect(frame.locator("[data-frame-region='section_slot']"), `slot on slide ${slide}`).toBeVisible();
    }
    await page.screenshot({ path: `${SHOT_DIR}/leadgen-b-05-chrome-on-every-slide.png` });
  });

  test("⑥ C5: Templates-tab template switch previews BEFORE apply + confirmation names the affected regions; Cancel leaves config untouched", async ({ page }) => {
    test.setTimeout(120_000);
    const configBefore = await page.request.get(`${LG_API}/funnels/${seed.funnelPublicId}/frame`).then((r) => r.json()) as { frame_config: Record<string, unknown> };
    expect(configBefore.frame_config["template"]).toBe("centered");

    await openEditor(page);
    await openTemplatesTab(page);
    await page.locator("#lg-tpl-apply-btn").click();
    await expect(page.locator("#lg-tpl-apply-dialog")).toBeVisible();
    await page.locator("[data-apply-choice]", { hasText: "Minimal" }).click();

    // the confirmation NAMES the regions that change — quotes-tabs/
    // templates.ts's diffSentences() wording (verified against source this
    // phase; DIFFERENT phrasing than the retired canvas generator's
    // "isn't part of 'minimal'" style sentences).
    const confirmList = page.locator("#lg-tpl-apply-confirm-list li");
    await expect(confirmList.filter({ hasText: /footer will be hidden/i })).toHaveCount(1);
    await expect(confirmList.filter({ hasText: /trust strip isn't part of this template's arrangement/i })).toHaveCount(1);
    await page.screenshot({ path: `${SHOT_DIR}/leadgen-b-06-switch-confirm-preview.png` });

    // preview-BEFORE-apply: nothing persisted yet
    const duringPreview = await page.request.get(`${LG_API}/funnels/${seed.funnelPublicId}/frame`).then((r) => r.json()) as { frame_config: Record<string, unknown> };
    expect(duringPreview.frame_config).toEqual(configBefore.frame_config);

    // CANCEL → dialog closes, stored config is byte-identical
    await page.locator("#lg-tpl-apply-cancel-btn").click();
    await expect(page.locator("#lg-tpl-apply-dialog")).toBeHidden();
    const afterCancel = await page.request.get(`${LG_API}/funnels/${seed.funnelPublicId}/frame`).then((r) => r.json()) as { frame_config: Record<string, unknown> };
    expect(afterCancel.frame_config).toEqual(configBefore.frame_config);
  });

  test("⑦ arm B carries a stored progress override, surfaced on the A/B tab (RETIRED: the canvas override badge, see file-header note)", async ({ page }) => {
    test.setTimeout(90_000);
    // Rework M1 (§4.3-10) + conductor extension round 2: leadgen-b-seed.ts
    // bootstraps arm B through the sanctioned create-experiment -> start ->
    // fork flow. armBVariantId is only null if that flow itself regresses —
    // fail loud (not skip) so a real regression is never silent.
    expect(seed.armBVariantId, seed.armBBlockedReason ?? "arm B was not created").toBeTruthy();

    // RETIRED: id="lg-override-badge" is confirmed ABSENT from every admin
    // source file this phase (grep: zero hits) — only the JS that used to
    // populate it survives, referencing a byId() a real browser resolves to
    // null. The underlying fact it used to surface (arm B stores a progress
    // override) is still real and still verified below, via the A/B tab's
    // `data-arm-overrides` marker (confirmed live in quotes-tabs/ab.ts).
    const structure = await page.request.get(`${LG_API}/quotes/${seed.quotePublicId}/structure`).then((r) => r.json()) as {
      funnels: Array<{ variants: Array<{ public_id: string; frame_overrides_json: Record<string, unknown> | null }> }>;
    };
    const armB = structure.funnels[0]!.variants.find((v) => v.public_id === seed.armBVariantId);
    expect(armB?.frame_overrides_json, "arm B's stored override (seeded by leadgen-b-seed.ts)").toEqual({ progress: { style: "dots" } });

    await openEditor(page);
    await page.locator('[data-tab="ab"]').click();
    await expect(page.locator(`[data-arm-overrides="${seed.armBVariantId}"]`)).toContainText("Progress");
    await page.screenshot({ path: `${SHOT_DIR}/leadgen-b-07-ab-tab-overrides.png` });
  });

  test("⑧ 04 §4.7: ONE Save persists frame + theme (RETIRED: the variant-PUT-driven chip-refresh sub-claim, see file-header note)", async ({ page }) => {
    test.setTimeout(120_000);
    // NOTE (file-header ⑧): the pre-rework row edited header.tagline (canvas)
    // and a per-arm progress override (canvas) — BOTH now gapped fields with
    // no current admin authoring surface (see file-header "ADDITIONAL GAPS").
    // Rewritten over fields that DO have a live surface today: background
    // role (Templates tab box A) + theme scales.radius (Themes tab).
    await openEditor(page);
    await openTemplatesTab(page);
    const bgPanel = await openTplBox(page, "background");
    await bgPanel.locator('[data-role-pick="brand_secondary"][data-role-pick-for="background.role"]').click();

    // Round-4 P5b: "Themes" is a top-level tab (this row's OWN pre-existing
    // comment already called this repin out for P5b — completing it here).
    await page.locator('[data-tab="themes"]').click();
    await expect(page.locator("#lg-theme-editor")).toBeVisible();
    await page.locator('select[data-theme-key="scales.radius"]').selectOption("round");

    // CONFIRMED GAP (found this phase, not fixed — outside this slice's file
    // ownership): the variant PUT only rides Save when variant-SCOPED state
    // is dirty (FIX 6 gating, per leadgen-quote-builder-seam.test.ts's own
    // documented behavior this phase's review confirmed still holds) — and
    // NO admin UI control dirties variant scope any more (funnel_design/
    // rules/sections all have no current surface, per that SAME seam test's
    // own P3b retirement notes: id="lg-funnel-design" etc. are confirmed
    // absent from the real page). Background+theme edits are FUNNEL-scoped,
    // not variant-scoped, so Save here fires ONLY the frame+theme PUTs —
    // reproduced live this phase (a variant-PUT wait timed out at 120s).
    // "ONE Save persists frame+theme" is still proven below; "the chip
    // refreshes FROM THAT SAME SAVE's activation_preflight" is retired — that
    // response only arrives on the (currently unreachable) variant PUT.
    const framePutPromise = page.waitForResponse(
      (r) => r.request().method() === "PUT" && r.url().includes(`/funnels/${seed.funnelPublicId}/frame`),
    );
    const themePutPromise = page.waitForResponse(
      (r) => r.request().method() === "PUT" && r.url().includes(`/funnels/${seed.funnelPublicId}/theme`),
    );
    await page.locator("#lg-variant-save").click();
    expect((await framePutPromise).status()).toBe(200);
    expect((await themePutPromise).status()).toBe(200);
    await expect(page.locator("#lg-quote-ok")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator("#lg-quote-ok")).toContainText("Saved");
    await page.screenshot({ path: `${SHOT_DIR}/leadgen-b-08-one-save.png` });

    // SERVER truth: both payloads persisted by the single Save
    const frame = await page.request.get(`${LG_API}/funnels/${seed.funnelPublicId}/frame`).then((r) => r.json()) as { frame_config: Record<string, unknown> };
    expect((frame.frame_config["background"] as Record<string, unknown>)["role"]).toBe("brand_secondary");
    const theme = await page.request.get(`${LG_API}/funnels/${seed.funnelPublicId}/theme`).then((r) => r.json()) as { theme: Record<string, unknown> };
    expect((theme.theme["scales"] as Record<string, unknown>)["radius"]).toBe("round");

    // the publish chip still renders SOME server-derived verdict (SSR from
    // the activation GET) — a weaker, but still real, liveness check.
    const chip = page.locator("#lg-publish-badge");
    await expect(chip).toHaveAttribute("data-publish-verdict", /ok|blocked/);
  });

  test("⑨ C2 LIVE: chrome-in-a-section BLOCKS publish with the §14.1 copy + fix link; the compat override (seeded via the frame API — no current UI toggle, see file-header note) downgrades it to a warning and activation succeeds", async ({ page }) => {
    test.setTimeout(120_000);
    const cq = seed.chromeQuote;

    await page.goto(`/admin/leadgen/quotes/${cq.quotePublicId}/edit`, { waitUntil: "domcontentloaded" });
    await expect(page.locator('[data-tab="templates"]')).toBeVisible({ timeout: 20_000 });

    // --- attempt to publish on site A → the C2 BLOCK -------------------------
    await page.locator('[data-tab="activation"]').click();
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
    expect(blockedBody.error).toBe("quote_activation_blocked");
    expect(blockedBody.blocks).toEqual([]);
    const chromeProblem = blockedBody.problems.find((p) => p.path === `section.${cq.sectionPublicId}.content`);
    expect(chromeProblem?.severity).toBe("error");

    await expect(page.locator("#lg-quote-error")).toContainText("Cannot activate this Quote");
    await expect(page.locator("#lg-preflight-panel")).toHaveAttribute("data-preflight-state", "blocked");
    const problemRow = page.locator(`#lg-preflight-problems [data-problem-scope="section"] [data-problem-path="section.${cq.sectionPublicId}.content"]`);
    await expect(problemRow).toBeVisible();
    await expect(problemRow.locator('.lg-problem-chip[data-severity="error"]')).toHaveText("Error");
    await expect(problemRow).toContainText(`'${cq.sectionName}' contains funnel-layout elements`);
    await expect(problemRow).toContainText("would render twice on the live page");
    await expect(problemRow).toContainText("enable the legacy override under Advanced");
    const fixLink = problemRow.locator("a", { hasText: "Review slide" });
    await expect(fixLink).toHaveAttribute("href", `/admin/leadgen/sections/${cq.sectionPublicId}/edit`);
    await page.screenshot({ path: `${SHOT_DIR}/leadgen-d-09a-c2-blocked.png` });

    const afterBlock = await page.request.get(`${LG_API}/quotes/${cq.quotePublicId}/activation`).then((r) => r.json()) as {
      sites: Array<{ site_id: string; activated: boolean; enabled: boolean }>;
    };
    const siteRow = afterBlock.sites.find((s) => s.site_id === seed.siteA.id)!;
    expect(siteRow.activated, "blocked PUT persisted no activation row").toBe(false);
    expect(siteRow.enabled).toBe(false);

    // --- enable the Advanced legacy override — via the real frame API -------
    // (RETIRED sub-step: no admin UI toggles compat.allow_section_chrome
    // anywhere today — confirmed by grep, see file-header "ADDITIONAL GAPS".
    // Seeded directly, same pattern as every other gapped field this phase;
    // the row's actual point — does the flag correctly downgrade block to
    // warning — is still proven end-to-end below.)
    const framePutRes = await page.request.put(`${LG_API}/funnels/${cq.funnelPublicId}/frame`, {
      data: { frame_config_json: { version: 1, template: "centered", compat: { allow_section_chrome: true } } },
    });
    expect(framePutRes.status()).toBe(200);
    const frame = await page.request.get(`${LG_API}/funnels/${cq.funnelPublicId}/frame`).then((r) => r.json()) as {
      frame_config: { compat?: { allow_section_chrome?: boolean } };
    };
    expect(frame.frame_config.compat?.allow_section_chrome).toBe(true);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator('[data-tab="activation"]').click();

    // --- the SAME publish now succeeds with the downgraded warning -----------
    const okResponse = page.waitForResponse(
      (r) => r.request().method() === "PUT" && r.url().includes(`/quotes/${cq.quotePublicId}/activation/`),
    );
    await row.locator("[data-site-enabled]").check();
    await row.locator("[data-site-slug]").fill(`lg-d-chrome-${uniq}`);
    await row.locator("[data-save-activation]").click();
    expect((await okResponse).status()).toBe(200);
    await expect(page.locator("#lg-quote-ok")).toContainText("Activation saved");
    await expect(page.locator("#lg-preflight-panel")).toHaveAttribute("data-preflight-state", "pass");
    const warningRow = page.locator(`#lg-preflight-problems [data-problem-path="section.${cq.sectionPublicId}.content"]`);
    await expect(warningRow.locator('.lg-problem-chip[data-severity="warning"]')).toHaveText("Warning");
    await expect(warningRow).toContainText("Legacy override is ON");
    await expect(warningRow).toContainText("keeps its own page chrome");
    await expect(page.locator("#lg-publish-badge")).toHaveAttribute("data-publish-verdict", "ok");
    await expect(page.locator("#lg-publish-badge")).toContainText("Ready (");
    await page.screenshot({ path: `${SHOT_DIR}/leadgen-d-09b-c2-compat-warning.png` });

    const afterOk = await page.request.get(`${LG_API}/quotes/${cq.quotePublicId}/activation`).then((r) => r.json()) as {
      sites: Array<{ site_id: string; enabled: boolean; slug: string | null }>;
    };
    const okRow = afterOk.sites.find((s) => s.site_id === seed.siteA.id)!;
    expect(okRow.enabled).toBe(true);
    expect(okRow.slug).toBe(`lg-d-chrome-${uniq}`);
  });

  test("⑩ E4→P5: the Templates tab's Background box (box A) edits role+style → Save → API read-back (replaces the retired canvas-click Background inspector)", async ({ page }) => {
    test.setTimeout(120_000);
    await openEditor(page);
    await openTemplatesTab(page);
    const panel = await openTplBox(page, "background");

    // §4.4 edits: background color role via the SAME swatch strip the old
    // canvas panel used (data-role-pick/data-role-pick-for unchanged) + style.
    await panel.locator('[data-role-pick="brand_secondary"][data-role-pick-for="background.role"]').click();
    await panel.locator('select[data-frame-key="background.style"]').selectOption("brand");
    await page.screenshot({ path: `${SHOT_DIR}/leadgen-e-10-background-box.png` });

    await saveFrame(page, seed.funnelPublicId);

    const frame = await page.request.get(`${LG_API}/funnels/${seed.funnelPublicId}/frame`).then((r) => r.json()) as {
      frame_config: { background?: { role?: string; style?: string } };
    };
    expect(frame.frame_config.background?.role).toBe("brand_secondary");
    expect(frame.frame_config.background?.style).toBe("brand");

    // and the composed live page shows both stamps (role + style classes).
    await gotoLive(page, MAIN_QUOTE_SLUG);
    const bgLayer = page.locator("[data-frame-region='background']");
    await expect(bgLayer).toHaveClass(/lg-frame-bg-role-brand_secondary/);
    await expect(bgLayer).toHaveClass(/lg-frame-bg-style-brand/);
  });
});
