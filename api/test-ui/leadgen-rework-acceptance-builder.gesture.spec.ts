// LEADGEN-REWORK-03 — P6 acceptance (slice S6.1a): the §11 terminal journeys
// for #11A (site logo), #11B (no duplicated Template/Theme builder buttons),
// #11D (Templates tab), #11E (Themes tab). Real system only: real admin CRUD /
// real composed /lg shell / real segmented-control clicks — never injected
// content, never a unit shortcut. Each test is named with its §11 AC id.
//
// CROSS-ENGINE (registered in playwright.config.ts CROSS_ENGINE_GESTURE_SPECS):
// the #11B/#11D/#11E journeys drive the admin UI only (plain click/fill/select,
// no dynamic tenant host) and run FULLY on chromium AND firefox. #11A drives a
// live /lg tenant shell (a dynamic {uniq}.e2e.test host resolved by chromium's
// --host-resolver-rules) — its live legs are guarded by liveLegChromiumOnly()
// (firefox records a documented skip; the admin/API assertions before it run on
// both). Same shape as leadgen-operator-acceptance / leadgen-rework-p4-themes.
//
// Run per-file (worktree-isolated, fresh D1, this worktree's port):
//   cd api && npm run db:reset:local
//   PW_PORT=8901 npx playwright test test-ui/leadgen-rework-acceptance-builder.gesture.spec.ts --workers=1
// (append --project=chromium or --project=firefox to run one engine.)

import { test, expect, request as playwrightRequest, type APIRequestContext, type FrameLocator, type Page } from "@playwright/test";
import {
  LG_API,
  ORIGIN,
  REAL_CHROME_UA,
  json,
  createSection,
  liveLegChromiumOnly,
  ready,
  uniqueTag,
  type Created,
} from "./leadgen-rework-acceptance-helpers";
import { seedActiveSite, uploadPng } from "./listicles-p6-seed";

test.use({
  launchOptions: { args: ["--host-resolver-rules=MAP *.e2e.test 127.0.0.1"] },
  userAgent: REAL_CHROME_UA,
  viewport: { width: 1280, height: 900 },
});

let apiCtx: APIRequestContext;
test.beforeAll(async () => {
  apiCtx = await playwrightRequest.newContext({ baseURL: ORIGIN });
});
test.afterAll(async () => {
  await apiCtx.dispose();
});

// A minimal quote + funnel + variant (optionally with one section on the
// variant) through the REAL admin API — the p4-templates seed shape, local to
// this file per the codebase's test-file-local-duplication convention.
interface SeededQuote {
  quotePublicId: string;
  quoteId: number;
  funnelPublicId: string;
  variantPublicId: string;
}
async function seedQuote(request: APIRequestContext, tag: string, withSection: boolean): Promise<SeededQuote> {
  const u = uniqueTag(tag);
  const quote = await json<{
    id: number;
    public_id: string;
    funnels: Array<{ public_id: string; variants: Array<{ public_id: string }> }>;
  }>(await request.post(`${LG_API}/quotes`, { data: { quote_name: `ACC6D ${u}`, activity: "quote_funnel", verticals: ["life"] } }), "quote create");
  const funnelPublicId = quote.funnels[0]!.public_id;
  const variantPublicId = quote.funnels[0]!.variants[0]!.public_id;
  if (withSection) {
    const section = await createSection(request, `ACC6D sec ${u}`, [
      { type: "TwoButtonYesNo", question_id: "q_ok", internal_field: "ok", answer_type: "boolean", props: { label: "OK?" } },
      { type: "ContinueButton", question_id: "cont", props: { label: "Continue" } },
    ]);
    await json(await request.put(`${LG_API}/variants/${variantPublicId}`, { data: { pages: [{ name: "Page 1", slots: [{ kind: "fixed", section_id: section.id }] }] } }), "variant page");
  }
  return { quotePublicId: quote.public_id, quoteId: quote.id, funnelPublicId, variantPublicId };
}

async function createTemplate(request: APIRequestContext, name: string, frameJson: Record<string, unknown> = {}): Promise<{ id: number; public_id: string; name: string; is_default: boolean }> {
  return json(await request.post(`${LG_API}/frame-template-records`, { data: { name, frame_json: frameJson } }), `template create (${name})`);
}

// Open the funnel-builder board (the "+ Add funnel" gesture's home) — the
// leadgen-rework-p3b-board / leadgen-rework-acceptance-routing openEditor
// shape, duplicated locally per this codebase's own test-file-local-
// duplication convention (nothing shared is exported for these).
async function openBoard(page: Page, quotePublicId: string): Promise<void> {
  await page.goto(`/admin/leadgen/quotes/${quotePublicId}/edit`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("[data-board]")).toBeVisible({ timeout: 20_000 });
}

// Make a funnel serve with the COMPOSED frame (header region present). The live
// serve renders the header logo chip ONLY on the renderQuoteFrame path, which
// needs a non-null frame_config_json with header.enabled=true — the default
// legacy/themed-default paths keep the header OFF (serve.ts NARROW_DEFAULT). So
// apply a built-in (header.enabled=true) template, then persist its resolved
// effective_frame as the funnel's explicit frame_config via PUT /funnels/:id/
// frame. All through the REAL admin API (own-hand-verified this slice: the
// chip/img render live only after this).
async function enableHeaderFrame(request: APIRequestContext, funnelPublicId: string): Promise<void> {
  const tpls = await json<{ items: Array<{ public_id: string }> }>(await request.get(`${LG_API}/frame-template-records`), "templates");
  await json(await request.post(`${LG_API}/funnels/${funnelPublicId}/apply-template`, { data: { template_id: tpls.items[1]!.public_id } }), "apply frame template");
  const fr = await json<{ effective_frame: Record<string, unknown> }>(await request.get(`${LG_API}/funnels/${funnelPublicId}/frame`), "get frame");
  await json(await request.put(`${LG_API}/funnels/${funnelPublicId}/frame`, { data: { frame_config_json: fr.effective_frame } }), "put frame config");
}

// ===========================================================================
// #11A — Site logo (contract §2 #11A / §8.8; Appendix A-8). Deeper render-level
// gate: test/leadgen-rework-themes-ui.test.ts + leadgen-frame-render.test.ts
// (every branding permutation). This is the terminal LIVE-shell journey those
// files deliberately did not add (seedActiveSite is shared infra) — now built
// here because §11A is this slice's own AC.
// ===========================================================================
test.describe("#11A — site logo (live shell)", () => {
  test('#11A a site WITHOUT a logo shows the placeholder chip (A-8), never a bare name', async ({ page, browserName }) => {
    const u = uniqueTag("11a-nologo");
    const host = `${u}.e2e.test`;
    const slug = u.replace(/[^a-z0-9-]/gi, "").toLowerCase();
    // seedActiveSite provisions a site with NO logo_media_id set → the header
    // logo ladder floors with no resolvable logoUrl → the fallback chip
    // (frame.ts renderHeaderRegion:361-364).
    const siteId = await seedActiveSite(apiCtx, host, `ACC6 11A nologo ${u}`);
    const quote = await json<{ public_id: string; funnels: Array<{ public_id: string; variants: Array<{ public_id: string }> }> }>(
      await apiCtx.post(`${LG_API}/quotes`, { data: { quote_name: `ACC6 11A ${u}`, activity: "quote_funnel", verticals: ["life"] } }),
      "quote",
    );
    // compose a header-bearing frame so the live serve renders the logo region.
    await enableHeaderFrame(apiCtx, quote.funnels[0]!.public_id);
    // §4.3-13: a section is unique within {shared ∪ a funnel}, so the shared
    // page and the funnel need DISTINCT sections.
    const sharedSec = await createSection(apiCtx, `ACC6 11A shared ${u}`, [
      { type: "QuestionHeadline", question_id: "h", props: { text: "Q" } },
      { type: "ContinueButton", question_id: "c", props: { label: "Continue" } },
    ]);
    const funnelSec = await createSection(apiCtx, `ACC6 11A funnel ${u}`, [
      { type: "QuestionHeadline", question_id: "fh", props: { text: "F" } },
      { type: "ContinueButton", question_id: "fc", props: { label: "Continue" } },
    ]);
    await json(await apiCtx.post(`${LG_API}/quotes/${quote.public_id}/shared-page`, { data: { sections: [{ section_id: sharedSec.id }] } }), "shared");
    await json(await apiCtx.put(`${LG_API}/variants/${quote.funnels[0]!.variants[0]!.public_id}`, { data: { sections: [{ section_id: funnelSec.id }] } }), "variant");
    await json(await apiCtx.put(`${LG_API}/quotes/${quote.public_id}/activation/${siteId}`, { data: { enabled: true, slug } }), "activation");

    if (!liveLegChromiumOnly(browserName, "#11A live /lg shell needs chromium --host-resolver-rules; render-level chip proof is test/leadgen-rework-themes-ui.test.ts.")) return;

    await page.goto(`http://${host}:${new URL(ORIGIN).port}/lg/${slug}`, { waitUntil: "load" });
    await ready(page);
    const chip = page.locator(".lg-frame-logo-fallback");
    await expect(chip).toBeVisible();
    await expect(chip).toContainText("No logo — set it in Site settings.");
    // the fix: the header logo region shows the honest chip, NOT a logo image.
    await expect(page.locator('[data-frame-region="logo"] img')).toHaveCount(0);
  });

  test('#11A a site WITH a logo shows the image (not the chip)', async ({ page, browserName }) => {
    const u = uniqueTag("11a-logo");
    const host = `${u}.e2e.test`;
    const slug = u.replace(/[^a-z0-9-]/gi, "").toLowerCase();
    const siteId = await seedActiveSite(apiCtx, host, `ACC6 11A logo ${u}`);
    // set a real logo asset the resolver can resolve (site_settings.logo_media_id
    // → mediaUrl) — the positive control for the chip fix.
    const logo = await uploadPng(apiCtx, `acc6-11a-logo-${u}.png`);
    await json(await apiCtx.patch(`/api/admin/settings`, { data: { site_id: siteId, updates: { logo_media_id: logo.storage_key } } }), "settings logo");
    const quote = await json<{ public_id: string; funnels: Array<{ public_id: string; variants: Array<{ public_id: string }> }> }>(
      await apiCtx.post(`${LG_API}/quotes`, { data: { quote_name: `ACC6 11A logo ${u}`, activity: "quote_funnel", verticals: ["life"] } }),
      "quote",
    );
    await enableHeaderFrame(apiCtx, quote.funnels[0]!.public_id);
    const sharedSec = await createSection(apiCtx, `ACC6 11A logo shared ${u}`, [
      { type: "QuestionHeadline", question_id: "h", props: { text: "Q" } },
      { type: "ContinueButton", question_id: "c", props: { label: "Continue" } },
    ]);
    const funnelSec = await createSection(apiCtx, `ACC6 11A logo funnel ${u}`, [
      { type: "QuestionHeadline", question_id: "fh", props: { text: "F" } },
      { type: "ContinueButton", question_id: "fc", props: { label: "Continue" } },
    ]);
    await json(await apiCtx.post(`${LG_API}/quotes/${quote.public_id}/shared-page`, { data: { sections: [{ section_id: sharedSec.id }] } }), "shared");
    await json(await apiCtx.put(`${LG_API}/variants/${quote.funnels[0]!.variants[0]!.public_id}`, { data: { sections: [{ section_id: funnelSec.id }] } }), "variant");
    await json(await apiCtx.put(`${LG_API}/quotes/${quote.public_id}/activation/${siteId}`, { data: { enabled: true, slug } }), "activation");

    if (!liveLegChromiumOnly(browserName, "#11A live /lg shell needs chromium --host-resolver-rules.")) return;

    await page.goto(`http://${host}:${new URL(ORIGIN).port}/lg/${slug}`, { waitUntil: "load" });
    await ready(page);
    // a resolvable logo → the header renders the image (src → /media/<key>),
    // and the fallback chip is absent.
    const logoImg = page.locator(`#lg-funnel-root img[src*="/media/"]`).first();
    await expect(logoImg).toBeVisible();
    await expect(page.locator(".lg-frame-logo-fallback")).toHaveCount(0);
  });
});

// ===========================================================================
// #11B — no duplicated Template/Theme buttons in the builder (contract §2 #11B
// / §8.2 / §10). Rewritten sibling suites: leadgen-quote-builder.spec.ts,
// leadgen-quote-builder-ui.test.ts. Both engines.
// ===========================================================================
test.describe("#11B — no duplicated Template/Theme builder buttons", () => {
  test("#11B the builder has top Templates + Themes TABS and none of the removed canvas Template/Theme/variant chrome", async ({ page }) => {
    const seed = await seedQuote(apiCtx, "11b", true);
    await page.goto(`/admin/leadgen/quotes/${seed.quotePublicId}/edit`, { waitUntil: "domcontentloaded" });

    // top tabs only: Templates + Themes are TOP tabs (§8.3/§8.4 promotion).
    await expect(page.locator('.lg-qtab[data-tab="templates"]')).toHaveText("Templates");
    await expect(page.locator('.lg-qtab[data-tab="themes"]')).toHaveText("Themes");
    // the old standalone "Rules" tab was removed (rules live in the board rail).
    await expect(page.locator('.lg-qtab[data-tab="rules"]')).toHaveCount(0);
    // the six-tab bar, Funnel builder first + active.
    await expect(page.locator(".lg-qtab")).toHaveCount(6);
    await expect(page.locator('.lg-qtab[data-tab="builder"]')).toHaveClass(/active/);

    // the board is the builder panel (library/board/rail) — the removed canvas
    // chrome (§10: variant selector, "Fork this variant", canvas Template/Theme
    // buttons + canvas template picker) is absent from the whole editor.
    await expect(page.locator("[data-board]")).toBeVisible();
    await expect(page.getByRole("button", { name: /Fork this variant/i })).toHaveCount(0);
    await expect(page.locator("#lg-template-btn, #lg-template-picker, #lg-theme-btn")).toHaveCount(0);
    // the removed variant selector is gone (the head's ONLY <select> is the
    // legitimate "Preview site" picker #lg-site-select, not a variant switcher).
    await expect(page.locator("#lg-quote-editor .lg-editor-head #lg-variant-select")).toHaveCount(0);
    await expect(page.locator("#lg-quote-editor .lg-editor-head #lg-site-select")).toHaveCount(1);
  });
});

// ===========================================================================
// #11D — Templates tab (contract §8.3, §11D). Deeper gate:
// leadgen-rework-p4-templates.gesture.spec.ts + test/leadgen-rework-templates-
// ui.test.ts. This is the terminal §11 record; the reuse-across-two-quotes +
// default-seeds-new-funnel legs are net-new here. Both engines.
// ===========================================================================
async function openTemplatesTab(page: Page, quotePublicId: string): Promise<void> {
  await page.goto(`/admin/leadgen/quotes/${quotePublicId}/edit`, { waitUntil: "domcontentloaded" });
  await page.locator('[data-tab="templates"]').click();
  await expect(page.locator('[data-panel="templates"]')).toHaveClass(/active/);
  await expect(page.locator('[data-tplbox-panel="progress"]')).toBeVisible({ timeout: 15_000 });
}
function tplCanvas(page: Page): FrameLocator {
  return page.frameLocator("#lg-tpl-canvas-iframe");
}
async function tplCanvasText(page: Page): Promise<string> {
  const body = tplCanvas(page).locator("body");
  await expect(body).not.toBeEmpty({ timeout: 10_000 });
  return (await body.textContent()) ?? "";
}

test.describe("#11D — Templates tab", () => {
  test("#11D create → save → REUSE one template across TWO quotes (both funnels reference it)", async ({ page }) => {
    const u = uniqueTag("11d-reuse");
    const qa = await seedQuote(apiCtx, "11d-a", true);
    const qb = await seedQuote(apiCtx, "11d-b", true);

    // create through the real Templates tab of quote A
    await openTemplatesTab(page, qa.quotePublicId);
    await page.locator("#lg-tpl-new-btn").click();
    await page.locator("#lg-tpl-new-name").fill(`ACC6 Reuse ${u}`);
    await page.locator("#lg-tpl-new-save").click();
    const chip = page.locator("[data-tpl-chip]", { hasText: `ACC6 Reuse ${u}` });
    await expect(chip).toBeVisible({ timeout: 10_000 });
    const tplPublicId = await chip.getAttribute("data-tpl-chip");
    expect(tplPublicId).toBeTruthy();

    // read the created template's numeric id for the funnel-row assertions
    const records = await json<{ items: Array<{ id: number; public_id: string; name: string }> }>(
      await apiCtx.get(`${LG_API}/frame-template-records`),
      "records",
    );
    const rec = records.items.find((t) => t.public_id === tplPublicId);
    expect(rec, "created template is retrievable").toBeTruthy();

    // apply to quote A's funnel (real API the tab drives) and quote B's funnel —
    // proving the SAME saved template is reusable across quotes.
    await json(await apiCtx.post(`${LG_API}/funnels/${qa.funnelPublicId}/apply-template`, { data: { template_id: tplPublicId } }), "apply A");
    await json(await apiCtx.post(`${LG_API}/funnels/${qb.funnelPublicId}/apply-template`, { data: { template_id: tplPublicId } }), "apply B");
    const funnelA = await json<{ frame_template_id: number | null }>(await apiCtx.get(`${LG_API}/funnels/${qa.funnelPublicId}`), "funnel A");
    const funnelB = await json<{ frame_template_id: number | null }>(await apiCtx.get(`${LG_API}/funnels/${qb.funnelPublicId}`), "funnel B");
    expect(funnelA.frame_template_id).toBe(rec!.id);
    expect(funnelB.frame_template_id).toBe(rec!.id);
  });

  // §11D "default template seeds new funnels": the DEFAULT-TEMPLATE mechanism
  // (a single is_default template, atomic swap) is proven here through the real
  // UI. The AUTO-ASSIGN half ("seeds new funnels") is proven in the next test,
  // below — S6.2 fix: createQuoteFunnelHandler now stamps the current
  // is_default template's id onto every funnel created via "+ Add funnel"
  // (create-time; a later "Set as default" swap never retroactively re-skins
  // an existing funnel). The quote's auto-created FIRST funnel is deliberately
  // NOT seeded this way (STAGING-SIGNOFF §6 owner-decision disclosure).
  test("#11D 'Set as default' is a single atomic swap — the default-template mechanism", async ({ page }) => {
    const u = uniqueTag("11d-def");
    const seed = await seedQuote(apiCtx, "11d-def", true);
    const t1 = await createTemplate(apiCtx, `ACC6 Def A ${u}`);
    const t2 = await createTemplate(apiCtx, `ACC6 Def B ${u}`);

    await openTemplatesTab(page, seed.quotePublicId);
    const chip1 = page.locator(`[data-tpl-chip="${t1.public_id}"]`);
    const chip2 = page.locator(`[data-tpl-chip="${t2.public_id}"]`);
    await expect(chip1).toBeVisible({ timeout: 10_000 });
    await chip1.locator("[data-tpl-more]").click();
    await page.locator(".lg-tpl2-tpl-menu button", { hasText: "Set as default" }).click();
    await expect(chip1).toHaveClass(/is-default/, { timeout: 10_000 });

    await chip2.locator("[data-tpl-more]").click();
    await page.locator(".lg-tpl2-tpl-menu button", { hasText: "Set as default" }).click();
    await expect(chip2).toHaveClass(/is-default/, { timeout: 10_000 });
    await expect(chip1).not.toHaveClass(/is-default/, { timeout: 10_000 }); // atomic: only one default

    const records = await json<{ items: Array<{ public_id: string; is_default: boolean }> }>(await apiCtx.get(`${LG_API}/frame-template-records`), "records");
    expect(records.items.filter((t) => t.is_default).map((t) => t.public_id), "exactly one default, the last set").toEqual([t2.public_id]);
  });

  // S6.2 fix (GAP 3): the current default template SEEDS a funnel created via
  // the real "+ Add funnel" board gesture (create-time stamp) — proven both by
  // the stored frame_template_id AND a rendered effect (the template's own
  // distinctive setting is now in the new funnel's effective/composed frame).
  // The quote's auto-created FIRST funnel is deliberately NOT seeded this way
  // (STAGING-SIGNOFF §6 owner-decision disclosure) — not asserted here.
  test("#11D default template seeds a funnel created via the real '+ Add funnel' gesture (create-time stamp + rendered effect)", async ({ page }) => {
    const u = uniqueTag("11d-seed");
    const seed = await seedQuote(apiCtx, "11d-seed", false);
    // a distinctive setting so the seeded funnel's rendered effect is
    // independently verifiable, not just the stored frame_template_id.
    const tpl = await createTemplate(apiCtx, `ACC6 Seed Default ${u}`, { footer: { enabled: false } });
    await json(await apiCtx.put(`${LG_API}/frame-template-records/${tpl.public_id}/default`, { data: {} }), "set default");

    await openBoard(page, seed.quotePublicId);
    await expect(page.locator(".lg-col-funnel")).toHaveCount(1);
    await page.locator("[data-add-funnel]").click();
    await expect(page.locator(".lg-col-funnel")).toHaveCount(2, { timeout: 20_000 });

    const newFunnelPub = await page.locator(".lg-col-funnel").nth(1).getAttribute("data-funnel-public-id");
    expect(newFunnelPub, "the new funnel column carries its public id").toBeTruthy();

    const funnelRow = await json<{ frame_template_id: number | null }>(await apiCtx.get(`${LG_API}/funnels/${newFunnelPub}`), "new funnel row");
    expect(funnelRow.frame_template_id, "the new funnel's frame_template_id is the current default (create-time stamp)").toBe(tpl.id);

    // rendered effect: the seeded template's own distinctive setting is now
    // live in the new funnel's effective (composed) frame.
    const fr = await json<{ effective_frame: { footer?: { enabled?: boolean } } }>(await apiCtx.get(`${LG_API}/funnels/${newFunnelPub}/frame`), "new funnel frame");
    expect(fr.effective_frame.footer?.enabled, "rendered effect: the default template's footer.enabled:false is in effect on the new funnel").toBe(false);
  });

  test("#11D Apply to funnel: preview-before-apply + region-naming confirm; Cancel leaves the funnel untouched", async ({ page }) => {
    const u = uniqueTag("11d-apply");
    const seed = await seedQuote(apiCtx, "11d-apply", true);
    const target = await createTemplate(apiCtx, `ACC6 Apply ${u}`, { section_slot: { card: "bare" }, footer: { enabled: false } });
    await openTemplatesTab(page, seed.quotePublicId);

    const before = await json<{ effective_frame: { template: string } }>(await apiCtx.get(`${LG_API}/funnels/${seed.funnelPublicId}/frame`), "frame before");

    // Cancel path: preview shown, region list named, then Cancel → no apply call.
    await page.locator("#lg-tpl-apply-btn").click();
    const dialog = page.locator("#lg-tpl-apply-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('[data-apply-state="choose"]')).toBeVisible();
    let applyFired = false;
    page.on("request", (r) => { if (r.url().includes("/apply-template")) applyFired = true; });
    await page.locator(`[data-apply-choice="${target.public_id}"]`).click();
    await expect(dialog.locator('[data-apply-state="confirm"]')).toBeVisible({ timeout: 10_000 });
    await expect(dialog.locator("#lg-tpl-apply-confirm-list li").first()).toBeVisible(); // region-naming confirm
    await page.locator("#lg-tpl-apply-cancel-btn").click();
    await expect(dialog).toBeHidden();
    expect(applyFired, "Cancel must never call apply-template").toBe(false);
    const afterCancel = await json<{ effective_frame: { template: string } }>(await apiCtx.get(`${LG_API}/funnels/${seed.funnelPublicId}/frame`), "frame after cancel");
    expect(afterCancel.effective_frame.template).toBe(before.effective_frame.template);

    // Confirm path: applies for real (funnel row now references the template).
    await page.locator("#lg-tpl-apply-btn").click();
    await page.locator(`[data-apply-choice="${target.public_id}"]`).click();
    await expect(dialog.locator('[data-apply-state="confirm"]')).toBeVisible({ timeout: 10_000 });
    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/apply-template") && r.request().method() === "POST"),
      page.waitForNavigation({ waitUntil: "domcontentloaded" }).catch(() => null),
      page.locator("#lg-tpl-apply-confirm-btn").click(),
    ]);
    const funnelRow = await json<{ frame_template_id: number | null }>(await apiCtx.get(`${LG_API}/funnels/${seed.funnelPublicId}`), "funnel row after apply");
    expect(funnelRow.frame_template_id).toBe(target.id);
  });

  test("#11D A/B templates: forks the variant into an arm with a DIFFERENT frame_template_id (variant-level override)", async ({ page }) => {
    const u = uniqueTag("11d-ab");
    const seed = await seedQuote(apiCtx, "11d-ab", true);
    const alt = await createTemplate(apiCtx, `ACC6 Alt ${u}`);
    await openTemplatesTab(page, seed.quotePublicId);

    await page.locator("#lg-tpl-ab-btn").click();
    await expect(page.locator("#lg-tpl-ab-dialog")).toBeVisible();
    await page.locator("#lg-tpl-ab-template-select").selectOption({ label: `ACC6 Alt ${u}` });
    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/fork") && r.request().method() === "POST"),
      page.waitForNavigation({ waitUntil: "domcontentloaded" }).catch(() => null),
      page.locator("#lg-tpl-ab-confirm-btn").click(),
    ]);
    const variants = await json<{ items: Array<{ public_id: string; frame_template_id: number | null }> }>(
      await apiCtx.get(`${LG_API}/funnels/${seed.funnelPublicId}/variants`),
      "variants",
    );
    expect(variants.items.length, "a second arm now exists").toBeGreaterThanOrEqual(2);
    const newArm = variants.items.find((v) => v.public_id !== seed.variantPublicId);
    expect(newArm?.frame_template_id, "the new arm carries the alt template (variant-level override)").toBe(alt.id);
  });

  test("#11D layout = elements-left / live-canvas-middle / settings-right; section picker + theme switch re-render; no-sections fixture", async ({ page }) => {
    // with a section: the picker has a real option + the canvas renders it.
    const withSec = await seedQuote(apiCtx, "11d-lay", true);
    await openTemplatesTab(page, withSec.quotePublicId);
    // three-column layout markers
    await expect(page.locator("#lg-tpl-canvas-iframe")).toBeVisible();
    await expect(page.locator("#lg-tpl-section-select")).toBeVisible();
    await expect(page.locator("#lg-tpl-theme-select")).toBeVisible();
    const withText = await tplCanvasText(page);
    expect(withText).not.toContain("Sample section (add sections to preview your own).");
    // theme switch fires a live preview round-trip
    const themeOpts = await page.locator("#lg-tpl-theme-select option").count();
    if (themeOpts > 1) {
      const [req] = await Promise.all([
        page.waitForRequest((r) => r.url().includes("/preview") && r.request().method() === "POST"),
        page.locator("#lg-tpl-theme-select").selectOption({ index: 1 }),
      ]);
      expect(req.method()).toBe("POST");
    }

    // no-sections quote → the canvas renders the Appendix A-9 fixture through
    // the REAL renderer (a real control element, not a hand-authored empty div).
    const noSec = await seedQuote(apiCtx, "11d-fix", false);
    await openTemplatesTab(page, noSec.quotePublicId);
    const fixtureText = await tplCanvasText(page);
    expect(fixtureText).toContain("Sample section (add sections to preview your own).");
    await expect(tplCanvas(page).locator("button, .answer-btn, [data-question-id]").first()).toBeVisible({ timeout: 10_000 });
  });

  test("#11D progress box I offers the 5 types, each re-rendering its design in the canvas", async ({ page }) => {
    const seed = await seedQuote(apiCtx, "11d-prog", true);
    await openTemplatesTab(page, seed.quotePublicId);
    // the 5 industry-taxonomy styles (contract §9 / R4-40). A 6th radio exists
    // in the DOM — the aria-hidden "hidden" proxy that the Show-progress toggle
    // drives (templates.ts:536) — so scope the count to the VISIBLE type radios.
    const styleRadios = page.locator('[data-tplbox-panel="progress"] input[data-frame-key="progress.style"]:not([aria-hidden="true"])');
    await expect(styleRadios).toHaveCount(5);

    // picking a type re-renders the canvas region (dots → the dots region node).
    await page.locator('[data-tplbox-panel="progress"] input[data-frame-key="progress.style"][value="dots"]').check({ force: true });
    await expect(tplCanvas(page).locator('[data-frame-region="progress"].lg-frame-progress--dots')).toHaveCount(1, { timeout: 10_000 });
    // and its design box (show toggle) drives style ↔ hidden — a real round trip.
    await page.locator("#lg-tpl-progress-show-checkbox").uncheck({ force: true });
    await expect(tplCanvas(page).locator('[data-frame-region="progress"]')).toHaveCount(0, { timeout: 10_000 });
  });
});

// ===========================================================================
// #11E — Themes tab live sample (contract §8.4, §11E). Deeper gate:
// leadgen-rework-p4-themes.gesture.spec.ts + test/leadgen-rework-themes-ui.test
// .ts. Both engines (static server-rendered preview iframe, no tenant host).
// ===========================================================================
function themeCanvas(page: Page): FrameLocator {
  return page.frameLocator(".tm-canvas-frame");
}
interface ThemePayload {
  name: string;
  roles: { brand_primary: string; accent: string; page_bg: string; card: string; text: string; success: string; error: string };
  typography: { headline_font: "Newsreader" | "Inter" | "Roboto Mono"; body_font: "Newsreader" | "Inter" | "Roboto Mono"; base_px: number };
  controls: { field_height: "small" | "medium" | "large"; button_size: "s" | "m" | "l"; corners: "sharp" | "rounded" | "pill" };
}
function themePayload(name: string): ThemePayload {
  return {
    name,
    roles: { brand_primary: "#1B3A5C", accent: "#F5C518", page_bg: "#F4F6F9", card: "#FFFFFF", text: "#1A1F36", success: "#0E7C3A", error: "#B23A2C" },
    typography: { headline_font: "Newsreader", body_font: "Inter", base_px: 16 },
    controls: { field_height: "medium", button_size: "m", corners: "rounded" },
  };
}
// A funnel using a fresh theme + a ButtonAnswerGroup section with title/subtitle
// choices (so the ✓-in-selected + tscard anatomy have real content), through
// the REAL admin API (p4-themes shape).
async function seedThemeFunnel(request: APIRequestContext, tag: string): Promise<{ themeId: string }> {
  const u = uniqueTag(tag);
  const theme = await json<{ item: { id: string } }>(await request.post(`${LG_API}/themes`, { data: themePayload(`ACC6 ${u}`) }), "theme create");
  const quote = await json<{ public_id: string; funnels: Array<{ public_id: string; variants: Array<{ public_id: string }> }> }>(
    await request.post(`${LG_API}/quotes`, { data: { quote_name: `ACC6 ${u}`, activity: "quote_funnel", verticals: ["auto"] } }),
    "quote",
  );
  const section: Created = await json(
    await request.post(`${LG_API}/sections`, {
      data: {
        section_name: `acc6-theme-${u}`,
        headline_text: "What's your business type?",
        activity: "quote_funnel",
        vertical: "auto",
        status: "active",
        content_json: JSON.stringify({
          components: [
            {
              type: "ButtonAnswerGroup",
              question_id: "q_biz",
              question_key: "biz",
              internal_field: "biz",
              props: { label: "What's your business type?" },
              choices: [
                { label: "Construction", value: "construction", analytics_id: "biz_construction", title: "Construction", subtitle: "Contractors, Home Builders" },
                { label: "Retail", value: "retail", analytics_id: "biz_retail", title: "Retail", subtitle: "Shops, Stores" },
              ],
            },
            { type: "ContinueButton", question_id: "q_cont", props: { label: "Continue" } },
          ],
        }),
      },
    }),
    "section",
  );
  await json(await request.put(`${LG_API}/variants/${quote.funnels[0]!.variants[0]!.public_id}`, { data: { sections: [{ section_id: section.public_id }] } }), "attach");
  await json(await request.put(`${LG_API}/funnels/${quote.funnels[0]!.public_id}/theme`, { data: { theme_json: { theme_id: theme.item.id } } }), "assign theme");
  return { themeId: theme.item.id };
}
async function openThemes(page: Page, themeId: string): Promise<void> {
  await page.goto(`/admin/leadgen/themes?theme=${encodeURIComponent(themeId)}`, { waitUntil: "domcontentloaded" });
  await expect(page.locator(".tm-canvas-frame")).toBeVisible({ timeout: 20_000 });
}

test.describe("#11E — Themes tab live sample", () => {
  test("#11E the live sample updates with an edit: flipping Selected → Mark renders the real ✓-in-selected markup", async ({ page }) => {
    const seed = await seedThemeFunnel(apiCtx, "11e-mark");
    await openThemes(page, seed.themeId);
    // live sample present, showing the REAL assigned section through the REAL renderer.
    await expect(page.locator('[data-pin="8.4-live-canvas"]')).toBeVisible();
    await expect(themeCanvas(page).getByText("What's your business type?")).toBeVisible();
    // rest: no filled check-badge markup (default axis 'wash').
    await expect(themeCanvas(page).locator(".lg-check-badge")).toHaveCount(0);

    const patch = page.waitForResponse((r) => r.request().method() === "PATCH" && r.url().includes("/api/admin/leadgen/themes/"));
    await page.locator('[data-tm-seg][data-group="selected"][data-value="mark"]').click();
    expect((await patch).status(), "theme PATCH saved").toBe(200);
    await page.goto(page.url(), { waitUntil: "load" });
    await expect(page.locator(".tm-canvas-frame")).toBeVisible({ timeout: 20_000 });
    // the ✓-in-selected markup now renders (hollow rest marker + one filled
    // badge per button) — the theme axis reached the REAL renderer live.
    await expect(themeCanvas(page).locator(".lg-check-hollow").first()).toBeVisible();
    await expect(themeCanvas(page).locator(".lg-check-badge")).toHaveCount(2);
  });

  test("#11E title+subtitle full-width cards render live and are selectable (Answer layout → Card)", async ({ page }) => {
    const seed = await seedThemeFunnel(apiCtx, "11e-card");
    await openThemes(page, seed.themeId);
    await expect(themeCanvas(page).locator(".lg-tscard")).toHaveCount(0);

    const patch = page.waitForResponse((r) => r.request().method() === "PATCH" && r.url().includes("/api/admin/leadgen/themes/"));
    await page.locator('[data-tm-seg][data-group="layout"][data-value="card"]').click();
    expect((await patch).status(), "theme PATCH saved").toBe(200);
    await page.goto(page.url(), { waitUntil: "load" });
    await expect(page.locator(".tm-canvas-frame")).toBeVisible({ timeout: 20_000 });
    // the title+subtitle tscard anatomy renders live through the REAL renderer.
    await expect(themeCanvas(page).locator(".lg-tscard-title", { hasText: "Construction" })).toBeVisible();
    await expect(themeCanvas(page).locator(".lg-tscard-subtitle", { hasText: "Contractors, Home Builders" })).toBeVisible();
    await expect(themeCanvas(page).locator(".lg-tscard-title", { hasText: "Retail" })).toBeVisible();
  });
});
