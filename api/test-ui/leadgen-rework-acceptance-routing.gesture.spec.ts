// LEADGEN-REWORK-03 — P6 acceptance (slice S6.1a): the §11 terminal journeys
// for #11C (funnel-builder architecture + quote-scoped routing). Real system
// only — real admin CRUD, the real board + rules rail, and REAL composed /lg
// routed sessions. NO injected content, NO unit shortcut.
//
// This file closes the HONEST GAP __p4a-routing.spec.ts recorded on retirement:
// "no test-ui spec drives a LIVE served funnel through an ENTRY or CHECKPOINT
// redirect via the NEW quote-scoped routing table." The L* tests below are that
// live proof (entry/UTM/OS pre-selection, shared-first, default funnel,
// checkpoint switch, sticky outcome, first-match-wins, all-actions recorded).
//
// CROSS-ENGINE (playwright.config.ts CROSS_ENGINE_GESTURE_SPECS): the admin
// board/rails/A-B/modal journeys are engine-agnostic (main-document pointer
// streams + plain click/fill, no dynamic tenant host) and run on chromium AND
// firefox. The live-/lg legs drive a dynamic {uniq}.e2e.test host resolved by
// chromium's --host-resolver-rules; each is guarded by liveLegChromiumOnly()
// (firefox records a documented skip after the both-engine assertions before
// it). Same shape as leadgen-operator-acceptance / leadgen-round4-*-acceptance.
//
// Run per-file (worktree-isolated, fresh D1, this worktree's port):
//   cd api && npm run db:reset:local
//   PW_PORT=8901 npx playwright test test-ui/leadgen-rework-acceptance-routing.gesture.spec.ts --workers=1

import { test, expect, request as playwrightRequest, type APIRequestContext, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import {
  LG_API,
  ORIGIN,
  PORT,
  REAL_CHROME_UA,
  IPHONE_UA,
  json,
  createSection,
  distinctiveSection,
  seedRoutingQuote,
  createRoutingRule,
  shellUrl,
  ready,
  passSharedPage,
  funnelRootAttr,
  progressTotal,
  captureCheckpoints,
  liveLegChromiumOnly,
  dragCenterToCenter,
  d1Query,
  uniqueTag,
} from "./leadgen-rework-acceptance-helpers";

// A WIDE viewport so the board's columns fit without internal h-scroll during
// drag interactions (the p3b-board precedent); the 1280 screenshot test resets
// it explicitly.
test.use({
  launchOptions: { args: ["--host-resolver-rules=MAP *.e2e.test 127.0.0.1"] },
  userAgent: REAL_CHROME_UA,
  viewport: { width: 1920, height: 1000 },
});

mkdirSync("test-results", { recursive: true });

let apiCtx: APIRequestContext;
test.beforeAll(async () => {
  apiCtx = await playwrightRequest.newContext({ baseURL: ORIGIN });
});
test.afterAll(async () => {
  await apiCtx.dispose();
});

async function openEditor(page: Page, quotePublicId: string): Promise<void> {
  await page.goto(`/admin/leadgen/quotes/${quotePublicId}/edit`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("[data-board]")).toBeVisible({ timeout: 20_000 });
}

// A quote with one funnel carrying `sec` on one page — the board-authoring seed
// (mirrors p3b-board's, but returns the section id so its library card is
// locatable by exact public id).
async function seedBoardQuote(request: APIRequestContext, tag: string): Promise<{ quotePublicId: string; funnelPublicId: string; variantPublicId: string; section: { id: number; public_id: string; name: string } }> {
  const u = uniqueTag(tag);
  const sectionName = `ACC6C ${tag} ${u}`;
  const section = await createSection(request, sectionName, [
    { type: "TwoButtonYesNo", question_id: "q", internal_field: "f", answer_type: "boolean", required: true },
    { type: "ContinueButton", question_id: "cont", props: { label: "Continue" } },
  ]);
  const quote = await json<{ public_id: string; funnels: Array<{ public_id: string; variants: Array<{ public_id: string }> }> }>(
    await request.post(`${LG_API}/quotes`, { data: { quote_name: `ACC6C ${u}`, activity: "quote_funnel", verticals: ["life"] } }),
    "quote",
  );
  return { quotePublicId: quote.public_id, funnelPublicId: quote.funnels[0]!.public_id, variantPublicId: quote.funnels[0]!.variants[0]!.public_id, section: { ...section, name: sectionName } };
}

// A minimal dynamic offer through the REAL admin API (placements required) —
// used as a rule's redirect TARGET (target_offer_id; the dev redirect-URL
// allowlist is empty, so an offer is the reachable "Redirect target").
async function createMinimalOffer(request: APIRequestContext, tag: string): Promise<{ id: number; public_id: string }> {
  const u = uniqueTag(tag);
  return json<{ id: number; public_id: string }>(
    await request.post(`${LG_API}/offers`, {
      data: {
        offer_name: `ACC6 offer ${u}`,
        provider: "mockprov",
        activity: "quote_funnel",
        vertical: "life",
        conversion_tracking_method: "s2s_postback",
        offer_type: "cpc",
        placements: [`acc6-plc-${u}`],
        calls_provider_api: true,
        bid_source: "response",
        cap_enabled: false,
      },
    }),
    "offer create",
  );
}

// A saved frame-template RECORD through the real admin API (M5) — the SAME
// DB-record source (+ public ids) the board's template picker lists (S6.2
// fix: GET /frame-template-records) and POST /apply-template resolves.
async function createTemplate(request: APIRequestContext, name: string, frameJson: Record<string, unknown> = {}): Promise<{ id: number; public_id: string; name: string; is_default: boolean }> {
  return json(await request.post(`${LG_API}/frame-template-records`, { data: { name, frame_json: frameJson } }), `template create (${name})`);
}

// ===========================================================================
// ADMIN-SIDE clauses (both engines). Sibling-proven mechanisms are re-run lean
// here as the terminal §11 record with a citation.
// ===========================================================================
test.describe("#11C — builder structure, board authoring & rules (admin, both engines)", () => {
  test("#11C the builder is library-left / board-center / rules-right, none of the removed chrome, and '+ Add funnel' is unlimited", async ({ page }) => {
    const seed = await seedBoardQuote(apiCtx, "struct");
    await openEditor(page, seed.quotePublicId);

    // library-left / board-center (shared column + funnel column) / rules-right
    // Two co-existing tab panels stamp class `lg-board-left` on their own left rail —
    // the funnel tab's section library (funnel.ts data-pin="8.2-left-library") and the
    // themes tab's chooser (themes.ts data-pin="r2-theme-chooser"). Both are in the DOM
    // at once, so the bare class is a strict-mode violation (2 elements). This assertion
    // is about the LIBRARY rail, so pin its own ruled hook — stricter than the class,
    // which could have been satisfied by the wrong panel.
    await expect(page.locator('.lg-board-left[data-pin="8.2-left-library"]')).toBeVisible();
    await expect(page.locator(".lg-col-shared")).toBeVisible();
    await expect(page.locator(".lg-col-funnel")).toHaveCount(1);
    await expect(page.locator("[data-rules-rail]")).toBeVisible();

    // none of the removed chrome (§10): no variant selector / Fork / canvas
    // Template-Theme buttons anywhere in the editor.
    await expect(page.getByRole("button", { name: /Fork this variant/i })).toHaveCount(0);
    await expect(page.locator("#lg-template-btn, #lg-template-picker, #lg-theme-btn")).toHaveCount(0);
    // the removed variant selector is gone (the head's only <select> is the
    // legitimate Preview-site picker, not a variant switcher).
    await expect(page.locator("#lg-quote-editor .lg-editor-head #lg-variant-select")).toHaveCount(0);

    // '+ Add funnel' unlimited — add three more columns (4 total).
    for (let i = 0; i < 3; i++) {
      await page.locator("[data-add-funnel]").click();
      await expect(page.locator(".lg-col-funnel")).toHaveCount(i + 2, { timeout: 20_000 });
    }
  });

  test("#11C page-order persists via the menu path (a11y equivalent) — cite leadgen-rework-p3b-board S5.3 4a/4b", async ({ page }) => {
    const aName = `ACC6C pg1 ${uniqueTag("pg")}`;
    const bName = `ACC6C pg2 ${uniqueTag("pg")}`;
    const a = await createSection(apiCtx, aName, [{ type: "ContinueButton", question_id: "c", props: { label: "Continue" } }]);
    const b = await createSection(apiCtx, bName, [{ type: "ContinueButton", question_id: "c", props: { label: "Continue" } }]);
    const seed = await seedBoardQuote(apiCtx, "pageorder");
    await json(await apiCtx.put(`${LG_API}/variants/${seed.variantPublicId}`, {
      data: { pages: [{ name: null, slots: [{ kind: "fixed", section_id: a.id }] }, { name: null, slots: [{ kind: "fixed", section_id: b.id }] }] },
    }), "seed 2 pages");
    await openEditor(page, seed.quotePublicId);

    // menu path: move page-1's chip DOWN across the page boundary → it leads page 2 (persists across the island's reload).
    const p1 = page.locator(".lg-col-funnel [data-page-card]").nth(0);
    await p1.locator("[data-sec-chip]").first().locator("[data-chip-kebab]").click();
    await page.locator('[data-board-menu="funnel-chip"] [data-menu-action="chip-down"]').click();
    await expect(page.locator(".lg-col-funnel [data-page-card]").nth(1).locator(".lg-sc-name").first()).toHaveText(aName, { timeout: 20_000 });
  });

  test("#11C §4.3-13 uniqueness is enforced on drop with the A-4 inline message — cite leadgen-rework-p3b-board", async ({ page }) => {
    const seed = await seedBoardQuote(apiCtx, "uniq");
    await json(await apiCtx.put(`${LG_API}/variants/${seed.variantPublicId}`, { data: { pages: [{ name: null, slots: [{ kind: "fixed", section_id: seed.section.id }] }] } }), "seed page");
    await openEditor(page, seed.quotePublicId);
    const libCard = page.locator(`[data-lib-card][data-section-public-id="${seed.section.public_id}"]`);
    const pageCard = page.locator(".lg-col-funnel [data-page-card]").first();
    await expect(libCard).toBeVisible();
    await dragCenterToCenter(page, libCard, pageCard);
    const err = page.locator(".lg-board-inline-err");
    await expect(err).toBeVisible({ timeout: 20_000 });
    await expect(err).toContainText("is already in this funnel");
    await expect(pageCard.locator("[data-sec-chip]")).toHaveCount(1); // rejected — no duplicate
  });

  // R2 SRC-11B RE-POINT (P6 terminal). Owner ruling, verbatim in
  // quotes-tabs/funnel.ts:5120-5124: "the themes and the templates are moving
  // to the top bar, why you kept the old and wrong option in the funnel
  // builder??" — the per-funnel-column Template pickchip no longer opens an
  // embedded apply-popover; it NAVIGATES to the top-bar Templates tab, exactly
  // like its Theme sibling. The popover this test used to drive
  // ([data-template-menu] filled by openTemplatePicker/applyTemplate/
  // frameTemplateRecordItems) is REMOVED by that ruling (funnel.ts:3735-3739;
  // `frameTemplateRecordItems` now survives only inside that comment).
  // [data-template-menu] still exists as the SHARED generic popover container
  // (openPopoverList, funnel.ts:4456 — the "＋ section" picker), which is why
  // the old locator resolved to an element that never lists templates.
  // Nothing is relaxed: every assertion below is the ORIGINAL claim re-pointed
  // at the ruled surface — the DB-record template is now located by its own
  // public id ([data-tpl-chip], strictly stronger than the old hasText match
  // on a generic menu row), and applying it goes through the Templates tab's
  // real Apply-to-funnel dialog. The navigation half is also covered by
  // leadgen-rework-p3b-board.gesture.spec.ts "template pickchip navigates to
  // the top-bar Templates tab (no embedded popover)"; the apply half by
  // leadgen-rework-acceptance-builder.gesture.spec.ts "#11D Apply to funnel".
  test("#11C per-funnel theme picker jumps to Themes and the template pickchip jumps to Templates (SRC-11B); the Templates tab lists DB-record templates and applying one updates frame_template_id + the rendered frame", async ({ page }) => {
    const seed = await seedBoardQuote(apiCtx, "pickers");
    const u = uniqueTag("pickers-tpl");
    // a template with a DISTINCTIVE setting (footer.enabled:false) so the
    // apply's rendered effect is independently verifiable, not just the stored id.
    const tpl = await createTemplate(apiCtx, `ACC6C Picker ${u}`, { footer: { enabled: false } });
    await openEditor(page, seed.quotePublicId);
    const col = page.locator(".lg-col-funnel").first();

    // theme picker → Themes tab (works).
    await col.locator("[data-theme-picker]").click();
    await expect(page.locator('[data-panel="themes"]')).toHaveClass(/active/, { timeout: 10_000 });

    // template pickchip → the top-bar Templates TAB (SRC-11B), never an
    // embedded builder popover.
    await page.locator('[data-tab="builder"]').click();
    await expect(page.locator("[data-board]")).toBeVisible();
    await page.locator(".lg-col-funnel").first().locator("[data-template-picker]").click();
    await expect(page.locator('[data-panel="templates"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("[data-template-menu]"), "the removed embedded popover never opens for the Template chip").not.toBeVisible();

    // the Templates tab LISTS the DB-record template — located by the record's
    // own public id, and carrying its name.
    const chip = page.locator(`[data-tpl-chip="${tpl.public_id}"]`);
    await expect(chip).toBeVisible({ timeout: 10_000 });
    await expect(chip).toContainText(`ACC6C Picker ${u}`);

    // applying it goes through the tab's real Apply-to-funnel dialog.
    await page.locator("#lg-tpl-apply-btn").click();
    const applyDialog = page.locator("#lg-tpl-apply-dialog");
    await expect(applyDialog.locator('[data-apply-state="choose"]')).toBeVisible({ timeout: 10_000 });
    await page.locator(`[data-apply-choice="${tpl.public_id}"]`).click();
    await expect(applyDialog.locator('[data-apply-state="confirm"]')).toBeVisible({ timeout: 10_000 });
    const [applyRes] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/apply-template") && r.request().method() === "POST"),
      page.waitForNavigation({ waitUntil: "domcontentloaded" }).catch(() => null),
      page.locator("#lg-tpl-apply-confirm-btn").click(),
    ]);
    expect(applyRes.ok(), "apply-template succeeded (the DB-record public id resolves)").toBe(true);

    const funnelRow = await json<{ frame_template_id: number | null }>(await apiCtx.get(`${LG_API}/funnels/${seed.funnelPublicId}`), "funnel row");
    expect(funnelRow.frame_template_id, "the funnel's frame_template_id is updated").toBe(tpl.id);
    // a rendered effect is visible beyond the stored id: the template's own
    // distinctive setting is now in the funnel's effective (composed) frame.
    const fr = await json<{ effective_frame: { footer?: { enabled?: boolean } } }>(await apiCtx.get(`${LG_API}/funnels/${seed.funnelPublicId}/frame`), "funnel frame");
    expect(fr.effective_frame.footer?.enabled, "rendered effect: footer.enabled:false from the applied template is now in effect").toBe(false);
  });

  test("#11C funnel A/B = equal arms, no control label anywhere, delete-variant exists", async ({ page }) => {
    const seed = await seedBoardQuote(apiCtx, "ab");
    // attach the section as a page so the funnel is valid to START an A/B test.
    await json(await apiCtx.put(`${LG_API}/variants/${seed.variantPublicId}`, { data: { pages: [{ name: null, slots: [{ kind: "fixed", section_id: seed.section.id }] }] } }), "attach page");
    // Full A/B lifecycle → TWO non-running arms: a 2nd active variant is only
    // legal as an arm of a RUNNING test (a bare fork 409s), and delete-variant
    // needs >1 variant AND no running test — so create → start → fork → stop.
    const exp = await json<{ public_id: string }>(await apiCtx.post(`${LG_API}/quotes/${seed.quotePublicId}/experiments`, { data: {} }), "create experiment");
    await json(await apiCtx.post(`${LG_API}/experiments/${exp.public_id}/start`, { data: {} }), "start");
    await json(await apiCtx.post(`${LG_API}/variants/${seed.variantPublicId}/fork`, { data: {} }), "fork arm B");
    await json(await apiCtx.post(`${LG_API}/experiments/${exp.public_id}/stop`, { data: {} }), "stop");
    const variants = await json<{ items: Array<{ variant_label: string }> }>(await apiCtx.get(`${LG_API}/funnels/${seed.funnelPublicId}/variants`), "variants");
    expect(variants.items.length, "two equal arms exist").toBe(2);

    await page.goto(`/admin/leadgen/quotes/${seed.quotePublicId}/edit`, { waitUntil: "domcontentloaded" });
    await page.locator('[data-tab="ab"]').click();
    const panel = page.locator('[data-panel="ab"]');
    await expect(panel).toBeVisible();
    // equal-arms / no-control doctrine is stated verbatim + two arms render.
    await expect(panel).toContainText("Every variant is treated the same — none of them is a baseline");
    await expect(panel.locator("[data-variant]")).toHaveCount(2);
    // arms are labelled A/B — no "(control)" label anywhere (the removed control vocabulary).
    await expect(panel.getByText(/\(control\)/i)).toHaveCount(0);
    expect(variants.items.map((v) => v.variant_label).sort()).toEqual(["A", "B"]);
    // delete-variant exists (>1 arm, no running test).
    await expect(panel.locator("[data-delete-variant]").first()).toBeVisible();
  });

  // The clause: "one rule carrying Funnel+Feed+Multiplier+Redirect%+Target
  // saves … and ALL apply on a live routed session." SAVE (all five persist) is
  // proven here through the real API; the modal authoring of all five actions
  // is proven in leadgen-rework-p3b-rules.gesture.spec.ts; the live application
  // of the wired actions is the "all-actions on a live routed session" test
  // below. The redirect TARGET here is an offer (target_offer_id) — the dev
  // redirect-URL allowlist (LEADGEN_REDIRECT_URL_ALLOWLIST) is empty, so a raw
  // URL is unreachable in this env; an offer is the reachable target.
  test("#11C a rule carrying ALL FIVE actions saves and every action persists (Funnel+Feed+Multiplier+Redirect%+Target)", async () => {
    const seed = await seedRoutingQuote(apiCtx, {
      tag: uniqueTag("11c-save"),
      funnels: [{ headline: "Save One", field: "f1" }, { headline: "Save Two", field: "f2" }],
      activate: false,
    });
    const offer = await createMinimalOffer(apiCtx, "save");
    await createRoutingRule(apiCtx, seed.quotePublicId, {
      rule_name: "All five actions",
      priority: 3,
      conditions: { groups: [{ field: "device", op: "eq", value: "desktop" }] },
      target_funnel_id: seed.funnels[1]!.public_id,
      feed_name: "premium",
      value_multiplier: 2.5,
      redirect_pct: 100,
      target_offer_id: offer.id,
    });
    // persistence: every one of the five actions round-trips through the server.
    const rules = await json<{ items: Array<Record<string, unknown>> }>(await apiCtx.get(`${LG_API}/quotes/${seed.quotePublicId}/routing-rules`), "rules");
    const saved = rules.items.find((r) => r["rule_name"] === "All five actions");
    expect(saved, "the rule persisted").toBeTruthy();
    expect(saved!["target_funnel_id"], "1) target funnel").toBeTruthy();
    expect(saved!["feed_name"], "2) feed name").toBe("premium");
    expect(saved!["value_multiplier"], "3) FB multiplier").toBe(2.5);
    expect(saved!["redirect_pct"], "4) redirect %").toBe(100);
    expect(saved!["target_offer_id"], "5) redirect target (offer)").toBe(offer.id);
  });

  test("#11C the rules rail fits 1280 with no horizontal overflow (screenshot) — cite leadgen-rework-p3b-rules", async ({ page }) => {
    const seed = await seedRoutingQuote(apiCtx, {
      tag: uniqueTag("11c-fit"),
      funnels: [{ headline: "Fit One", field: "a" }, { headline: "Fit Two", field: "b" }],
      activate: false,
    });
    await createRoutingRule(apiCtx, seed.quotePublicId, { rule_name: "Desktop from a very long campaign name that must wrap", priority: 1, conditions: { groups: [{ field: "device", op: "eq", value: "desktop" }] }, target_funnel_id: seed.funnels[1]!.public_id, feed_name: "long_feed_name_value" });
    await page.setViewportSize({ width: 1280, height: 900 });
    await openEditor(page, seed.quotePublicId);
    const rail = page.locator("#lg-qr-rail");
    await expect(rail).toBeVisible();
    const dims = await rail.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
    expect(dims.scrollWidth, "rail content must not overflow its column at 1280").toBeLessThanOrEqual(dims.clientWidth + 1);
    const body = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
    expect(body, "no page-level horizontal overflow at 1280").toBe(true);
    await page.screenshot({ path: "test-results/acc6-rules-1280.png", fullPage: false });
    await page.setViewportSize({ width: 375, height: 812 });
    await page.screenshot({ path: "test-results/acc6-rules-375.png", fullPage: false });
  });

  test("#11C funnel delete is blocked while it is the DEFAULT and while it is a RULE TARGET (messages name the blockers)", async ({ page }) => {
    const seed = await seedRoutingQuote(apiCtx, {
      tag: uniqueTag("11c-del"),
      funnels: [{ headline: "Keep Default", field: "a" }, { headline: "Rule Target", field: "b" }],
      defaultFunnelIndex: 0,
      activate: false,
    });
    // a rule targeting funnel[1] so it is rule-targeted.
    await createRoutingRule(apiCtx, seed.quotePublicId, { rule_name: "Sends to target", priority: 1, conditions: { groups: [{ field: "device", op: "eq", value: "mobile" }] }, target_funnel_id: seed.funnels[1]!.public_id });

    // delete the DEFAULT funnel via the API → 409 naming the default blocker.
    const delDefault = await apiCtx.delete(`${LG_API}/funnels/${seed.funnels[0]!.public_id}`);
    expect(delDefault.status(), "default funnel delete is blocked").toBe(409);
    expect(JSON.stringify(await delDefault.json())).toContain("it is the default funnel.");

    // delete the RULE-TARGET funnel → 409 naming the rule blocker.
    const delTarget = await apiCtx.delete(`${LG_API}/funnels/${seed.funnels[1]!.public_id}`);
    expect(delTarget.status(), "rule-targeted funnel delete is blocked").toBe(409);
    expect(JSON.stringify(await delTarget.json())).toContain("it is the target of rule 'Sends to target'.");

    // the board also surfaces the guard dialog (a11y equivalent of the API 409).
    await openEditor(page, seed.quotePublicId);
    await page.locator(".lg-col-funnel").first().locator("[data-funnel-kebab]").click();
    await page.locator('[data-board-menu="funnel"] [data-menu-action="delete"]').click();
    const guard = page.locator("[data-board-guard]");
    await expect(guard).toBeVisible({ timeout: 20_000 });
    await expect(guard.locator("[data-board-guard-body]")).toContainText("it is the default funnel.");
  });

  test("#11C shared-page sections can be slot-A/B'd; the composed route serves the page — cite leadgen-rework-p3b-board S5.3 item 3", async ({ page }) => {
    const armA = await createSection(apiCtx, `ACC6C ArmA ${uniqueTag("a")}`, [{ type: "ContinueButton", question_id: "c", props: { label: "Continue" } }]);
    const armB = await createSection(apiCtx, `ACC6C ArmB ${uniqueTag("b")}`, [{ type: "ContinueButton", question_id: "c", props: { label: "Continue" } }]);
    const seed = await seedBoardQuote(apiCtx, "sharedab");
    await json(await apiCtx.put(`${LG_API}/quotes/${seed.quotePublicId}/shared-page`, { data: { slots: [{ kind: "fixed", section_id: armA.public_id }] } }), "seed shared");
    await openEditor(page, seed.quotePublicId);
    await page.locator(".lg-col-shared [data-sec-chip]").first().locator("[data-chip-kebab]").click();
    await page.locator('[data-board-menu="shared-chip"] [data-menu-action="ab-slot"]').click();
    await expect(page.locator("[data-shared-ab-dialog]")).toBeVisible();
    await page.locator("[data-shared-ab-dialog] [data-ab-arm]").nth(1).locator("[data-ab-arm-section]").selectOption(armB.public_id);
    await page.locator("[data-shared-ab-save]").click();
    await expect(page.locator('.lg-col-shared [data-sec-chip] .lg-sc-name', { hasText: "A/B:" })).toBeVisible({ timeout: 20_000 });
  });

  test("#11C an in-funnel rule shows its read-only checkpoint and the A-6 unreachable warning in the builder — cite leadgen-rework-p3b-rules", async ({ page }) => {
    const seed = await seedRoutingQuote(apiCtx, {
      tag: uniqueTag("11c-ckpt"),
      sharedQuestionField: "track",
      funnels: [{ headline: "In One", field: "coverage" }, { headline: "In Two", field: "z" }],
      activate: false,
    });
    await openEditor(page, seed.quotePublicId);
    await page.locator("[data-qr-new]").click();
    await expect(page.locator("#lg-qr-modal")).toBeVisible();
    const ckpt = page.locator("[data-qr-modal-checkpoint]");
    const a6 = page.locator("[data-qr-modal-a6]");
    await page.locator("#lg-qr-cond-mount").getByRole("button", { name: "+ Add condition" }).click();
    const fieldSel = page.locator("#lg-qr-cond-mount .lg-rb-field").first();

    // a field collected only inside a funnel → an in-funnel checkpoint, no warning.
    await fieldSel.selectOption("coverage");
    await expect(ckpt).toContainText("In funnel");
    await expect(a6).toBeHidden();

    // a field NO funnel collects → the A-6 unreachable warning shows.
    await fieldSel.selectOption("__lgcustom__");
    await page.locator("#lg-qr-cond-mount .lg-rb-field-custom").first().fill("ghost_field_none");
    await expect(a6).toBeVisible();
    await expect(a6).toContainText("This rule can never apply before a visitor enters a funnel that asks these questions.");
  });

  test("#11C ctx.feed_name is mappable into an offer payload (authorable macro node; runtime resolution proven in test/leadgen-rework-routing.test.ts)", async ({ page: _page }) => {
    // Authorability through the REAL offer + payload-schema API. Runtime
    // resolution (routing outcome → resolveRoutingOutcomeDims → ctx.feed_name →
    // fetchProvider payload) is proven END-TO-END through the real producer flow
    // in test/leadgen-rework-routing.test.ts ("a rule with feed_name matches ->
    // outcome recorded -> … -> the payload carries the value"); this leg proves
    // the offer side can MAP it (§11C "ctx.feed_name mappable into an offer
    // payload", D3 stamp mechanism).
    const offer = await createMinimalOffer(apiCtx, "feed");
    await json(
      await apiCtx.post(`${LG_API}/offers/${offer.id}/payload-schemas`, {
        data: {
          schema_json: {
            version: 1,
            root: { type: "object", children: [{ path: "lead.feed", name: "feed", type: "string", source: "macro", macro: "feed_name" }] },
          },
        },
      }),
      "payload schema create",
    );
    // read the schema back — the feed_name macro node persists (authorable).
    const detail = await json<{ payload_schema?: { schema_json?: unknown }; active_payload_schema?: { schema_json?: unknown } }>(
      await apiCtx.get(`${LG_API}/offers/${offer.id}`),
      "offer detail",
    );
    const blob = JSON.stringify(detail);
    expect(blob).toContain('"macro":"feed_name"');
    expect(blob).toContain('"source":"macro"');
  });
});

// ===========================================================================
// LIVE routing (chromium full; firefox documented-skip). The __p4a gap: real
// served funnels routed through the NEW quote-scoped table.
// ===========================================================================
test.describe("#11C — live routed sessions", () => {
  test("#11C shared page serves FIRST for everyone incl. entry-routed; a UTM entry rule pre-selects the funnel; unmatched visitors get the default", async ({ page, browserName }) => {
    const seed = await seedRoutingQuote(apiCtx, {
      tag: uniqueTag("11c-entry"),
      sharedHeadline: "SHARED FIRST PAGE",
      funnels: [{ headline: "DEFAULT FUNNEL SECTION", field: "a1" }, { headline: "FACEBOOK FUNNEL SECTION", field: "a2" }],
      defaultFunnelIndex: 0,
    });
    // entry rule: utm_source=facebook → funnel[1].
    await createRoutingRule(apiCtx, seed.quotePublicId, { rule_name: "FB → funnel two", priority: 1, conditions: { groups: [{ field: "utm_source", op: "eq", value: "facebook" }] }, target_funnel_id: seed.funnels[1]!.public_id });

    if (!liveLegChromiumOnly(browserName, "#11C live routing needs chromium --host-resolver-rules; the resolver semantics are unit-proven in test/leadgen-rework-routing.test.ts (R-01/02/07).")) return;

    // (a) entry-routed visitor (utm=facebook): served funnel = funnel[1], yet
    // the SHARED page serves FIRST.
    await page.goto(shellUrl(seed.host, seed.slug, "?utm_source=facebook"), { waitUntil: "load" });
    await ready(page);
    expect(await funnelRootAttr(page, "data-funnel-variant-id"), "entry-routed to the FB funnel's variant").toBe(seed.funnels[1]!.variant_public_id);
    await expect(page.getByText("SHARED FIRST PAGE")).toBeVisible(); // shared first, even when entry-routed
    await passSharedPage(page);
    await expect(page.getByText("FACEBOOK FUNNEL SECTION")).toBeVisible();

    // (b) unmatched visitor (no utm): default funnel serves; shared first too.
    await page.goto(shellUrl(seed.host, seed.slug), { waitUntil: "load" });
    await ready(page);
    expect(await funnelRootAttr(page, "data-funnel-variant-id"), "unmatched → the DEFAULT funnel's variant").toBe(seed.funnels[0]!.variant_public_id);
    await expect(page.getByText("SHARED FIRST PAGE")).toBeVisible();
    await passSharedPage(page);
    await expect(page.getByText("DEFAULT FUNNEL SECTION")).toBeVisible();
  });

  test("#11C an OS-conditioned entry rule routes correctly at shell-serve (iPhone → target; desktop → default)", async ({ page, browser, browserName }) => {
    const seed = await seedRoutingQuote(apiCtx, {
      tag: uniqueTag("11c-os"),
      funnels: [{ headline: "DESKTOP DEFAULT", field: "a1" }, { headline: "IOS ONLY", field: "a2" }],
      defaultFunnelIndex: 0,
    });
    await createRoutingRule(apiCtx, seed.quotePublicId, { rule_name: "iOS → funnel two", priority: 1, conditions: { groups: [{ field: "os", op: "eq", value: "ios" }] }, target_funnel_id: seed.funnels[1]!.public_id });

    if (!liveLegChromiumOnly(browserName, "#11C OS live routing needs chromium --host-resolver-rules; deriveOs SHELL-SERVE parity is unit-proven in test/leadgen-rework-routing.test.ts.")) return;

    // iPhone UA → deriveOs "ios" → funnel[1] at shell-serve.
    const iosCtx = await browser.newContext({ userAgent: IPHONE_UA, baseURL: ORIGIN });
    const iosPage = await iosCtx.newPage();
    await iosPage.goto(shellUrl(seed.host, seed.slug), { waitUntil: "load" });
    await ready(iosPage);
    expect(await funnelRootAttr(iosPage, "data-funnel-variant-id"), "iPhone routes to the iOS funnel").toBe(seed.funnels[1]!.variant_public_id);
    await iosCtx.close();

    // desktop UA (the default REAL_CHROME_UA) → does not match ios → default funnel.
    await page.goto(shellUrl(seed.host, seed.slug), { waitUntil: "load" });
    await ready(page);
    expect(await funnelRootAttr(page, "data-funnel-variant-id"), "desktop stays on the default funnel").toBe(seed.funnels[0]!.variant_public_id);
  });

  test("#11C a shared-page ANSWER rule routes correctly via /lg/ck, and the progress denominator = shared + the served funnel's pages (§4.3-11)", async ({ page, browserName }) => {
    // funnel[0] (default) = 1 page; funnel[1] (target) = 2 pages → distinct totals.
    const seed = await seedRoutingQuote(apiCtx, {
      tag: uniqueTag("11c-ck"),
      sharedHeadline: "PICK YOUR TRACK",
      sharedQuestionField: "track",
      sharedChoices: [{ label: "VIP", value: "vip" }, { label: "Regular", value: "regular" }],
      funnels: [{ headline: "REGULAR FUNNEL", field: "r1", pages: 1 }, { headline: "VIP FUNNEL", field: "v1", pages: 2 }],
      defaultFunnelIndex: 0,
    });
    await createRoutingRule(apiCtx, seed.quotePublicId, { rule_name: "VIP → funnel two", priority: 1, conditions: { groups: [{ field: "track", op: "eq", value: "vip" }] }, target_funnel_id: seed.funnels[1]!.public_id });

    if (!liveLegChromiumOnly(browserName, "#11C checkpoint live routing needs chromium --host-resolver-rules; the /lg/ck switch is unit-proven in test/leadgen-rework-routing.test.ts (R-05/08).")) return;

    // unmatched entry → default funnel[0] (1 page): progress total = 1 shared + 1 = 2.
    const cks = captureCheckpoints(page);
    await page.goto(shellUrl(seed.host, seed.slug), { waitUntil: "load" });
    await ready(page);
    expect(await funnelRootAttr(page, "data-funnel-variant-id")).toBe(seed.funnels[0]!.variant_public_id);
    expect(await progressTotal(page), "default funnel denominator = shared(1) + funnel(1)").toBe(2);

    // answer the shared question "vip" + Continue → the engine posts /lg/ck and
    // the server switches to funnel[1] (the authoritative live routing decision).
    await page.locator('[data-lg-choice="vip"], [data-lg-choice="true"]').first().click().catch(async () => {
      await page.getByRole("radio", { name: "VIP" }).click();
    });
    await page.locator("[data-lg-continue]").first().click();
    await expect.poll(() => cks.filter((c) => c.sw === true).length, { timeout: 12_000, message: "a checkpoint switch fired" }).toBeGreaterThanOrEqual(1);
    const sw = cks.find((c) => c.sw === true)!;
    expect(sw.v, "switched to the VIP funnel's variant").toBe(seed.funnels[1]!.variant_public_id);

    // a FRESH VIP visitor is served the VIP funnel from the start (entry-plane
    // for a fresh session that already carries the answer is not possible, so we
    // re-prove the denominator on the entry-routed comparison): the target
    // funnel[1] denominator = 1 shared + 2 = 3 (progress recomputes per served
    // funnel, §4.3-11).
    await page.goto(shellUrl(seed.host, seed.slug, "?_p=vip"), { waitUntil: "load" });
    await ready(page);
    // still default at serve (no entry rule matches a bare visitor) → total 2.
    expect(await progressTotal(page)).toBe(2);
  });

  test("#11C the outcome is STICKY — an entry-routed visitor who changes a shared answer does NOT re-route (back-nav)", async ({ page, browserName }) => {
    const seed = await seedRoutingQuote(apiCtx, {
      tag: uniqueTag("11c-sticky"),
      sharedHeadline: "STICKY SHARED",
      sharedQuestionField: "track",
      sharedChoices: [{ label: "VIP", value: "vip" }, { label: "Regular", value: "regular" }],
      funnels: [{ headline: "STICKY DEFAULT", field: "a1" }, { headline: "STICKY FB", field: "a2" }],
      defaultFunnelIndex: 0,
    });
    // entry rule utm=fb → funnel[1]; AND a shared-answer rule track=vip → funnel[0].
    await createRoutingRule(apiCtx, seed.quotePublicId, { rule_name: "FB entry", priority: 1, conditions: { groups: [{ field: "utm_source", op: "eq", value: "fb" }] }, target_funnel_id: seed.funnels[1]!.public_id });
    await createRoutingRule(apiCtx, seed.quotePublicId, { rule_name: "VIP checkpoint", priority: 2, conditions: { groups: [{ field: "track", op: "eq", value: "vip" }] }, target_funnel_id: seed.funnels[0]!.public_id });

    if (!liveLegChromiumOnly(browserName, "#11C sticky live routing needs chromium --host-resolver-rules; the PK-guard stickiness is unit-proven in test/leadgen-rework-routing.test.ts (R-06).")) return;

    const cks = captureCheckpoints(page);
    // entry-routed (utm=fb) → funnel[1]; the entry outcome is recorded at /lg/attempt.
    await page.goto(shellUrl(seed.host, seed.slug, "?utm_source=fb"), { waitUntil: "load" });
    await ready(page);
    expect(await funnelRootAttr(page, "data-funnel-variant-id")).toBe(seed.funnels[1]!.variant_public_id);
    // answer track=vip (which WOULD match the checkpoint rule) + Continue → the
    // sticky entry outcome refuses the switch: /lg/ck returns sw:false.
    await page.getByRole("radio", { name: "VIP" }).click().catch(async () => {
      await page.locator('[data-lg-choice="vip"]').first().click();
    });
    await page.locator("[data-lg-continue]").first().click();
    await expect.poll(() => cks.length, { timeout: 12_000, message: "the engine posted /lg/ck" }).toBeGreaterThanOrEqual(1);
    expect(cks.some((c) => c.sw === true), "no re-route: the sticky entry outcome refuses the checkpoint switch").toBe(false);
  });

  test("#11C two overlapping entry rules — first-match-wins: the higher-priority rule's target applies and the lower rule is ignored", async ({ page, browserName }) => {
    const seed = await seedRoutingQuote(apiCtx, {
      tag: uniqueTag("11c-fmw"),
      funnels: [{ headline: "FMW DEFAULT", field: "a" }, { headline: "HIGH PRIORITY WINNER", field: "b" }, { headline: "LOW PRIORITY LOSER", field: "c" }],
      defaultFunnelIndex: 0,
    });
    // both match utm=fb; priority 1 → funnel[1] (winner), priority 50 → funnel[2] (loser).
    await createRoutingRule(apiCtx, seed.quotePublicId, { rule_name: "Winner p1", priority: 1, conditions: { groups: [{ field: "utm_source", op: "eq", value: "fb" }] }, target_funnel_id: seed.funnels[1]!.public_id, feed_name: "hi" });
    await createRoutingRule(apiCtx, seed.quotePublicId, { rule_name: "Loser p50", priority: 50, conditions: { groups: [{ field: "utm_source", op: "eq", value: "fb" }] }, target_funnel_id: seed.funnels[2]!.public_id, feed_name: "lo" });

    if (!liveLegChromiumOnly(browserName, "#11C first-match-wins live routing needs chromium --host-resolver-rules; the priority-ASC / full-action-set semantics are unit-proven in test/leadgen-rework-routing.test.ts (R-04).")) return;

    await page.goto(shellUrl(seed.host, seed.slug, "?utm_source=fb"), { waitUntil: "load" });
    await ready(page);
    // the higher-priority (priority 1) rule's target serves; the lower is ignored.
    expect(await funnelRootAttr(page, "data-funnel-variant-id"), "priority-1 winner serves").toBe(seed.funnels[1]!.variant_public_id);
    await passSharedPage(page);
    await expect(page.getByText("HIGH PRIORITY WINNER")).toBeVisible();
    await expect(page.getByText("LOW PRIORITY LOSER")).toHaveCount(0);
  });

  // S6.2 fix (GAP 1): resolveEntryRedirect is now wired into serveFunnelShell —
  // the redirect_pct/redirect_target actions have a LIVE consumer (previously
  // an OPEN CONCERN in this report: carried but unread). This test proves ONE
  // rule SHAPE carrying all FIVE actions (Funnel+Feed+Multiplier+Redirect%+
  // Target) applies live, in two legs of the SAME shape (pct=100 vs pct=0 —
  // the redirect_pct gate itself is exclusive-or by construction, so the two
  // legs together are how a single rule's five actions are ALL observed on a
  // live session): LEG A (pct=100) proves Redirect%+Target — the entry-plane
  // 302 fires to the offer-governed /lg/lc URL and is sticky across a reload
  // (same session, same verdict — the §4.3-6 stickiness contract). LEG B
  // (pct=0) proves the remainder still gets Funnel+Feed+Multiplier: the
  // redirect gate is inert, the target funnel serves, and the recorded
  // /lg/attempt outcome carries feed_name + value_multiplier + routed_to_funnel.
  // Unit complement (server-side proof, same mechanism): test/leadgen-rework-
  // routing.test.ts "§4.3-9 entry-plane redirect" describe block — specifically
  // "redirect_pct=100 + target_offer_id: GET /lg?utm_source=fb 302s…", "~50
  // sessions at redirect_pct=50: BOTH outcomes occur and each session is STICKY
  // across reload", "non-allowlisted raw URL: RUNTIME fail-closed…", and
  // "remainder (not redirected) still gets the rule's feed_name + value_
  // multiplier recorded at /lg/attempt".
  test("#11C all-actions: ONE rule shape carrying Funnel+Feed+Multiplier+Redirect%+Target — pct=100 leg 302s to the governed offer URL (sticky across reload); pct=0 leg serves the target funnel and records feed_name+multiplier+routed_to_funnel", async ({ page, browserName }) => {
    // --- seed both legs up front (admin API work — identical on both engines) ---
    const legA = await seedRoutingQuote(apiCtx, {
      tag: uniqueTag("11c-all-pct100"),
      funnels: [{ headline: "ALL DEFAULT A", field: "a1" }, { headline: "ALL TARGET A", field: "a2" }],
      defaultFunnelIndex: 0,
    });
    const offerA = await createMinimalOffer(apiCtx, "all-pct100");
    await createRoutingRule(apiCtx, legA.quotePublicId, {
      rule_name: "All actions pct100",
      priority: 1,
      conditions: { groups: [{ field: "utm_source", op: "eq", value: "partner" }] },
      target_funnel_id: legA.funnels[1]!.public_id,
      feed_name: "premium",
      value_multiplier: 3,
      redirect_pct: 100,
      target_offer_id: offerA.id,
    });

    const legB = await seedRoutingQuote(apiCtx, {
      tag: uniqueTag("11c-all-pct0"),
      funnels: [{ headline: "ALL DEFAULT B", field: "b1" }, { headline: "ALL TARGET B", field: "b2" }],
      defaultFunnelIndex: 0,
    });
    const offerB = await createMinimalOffer(apiCtx, "all-pct0");
    await createRoutingRule(apiCtx, legB.quotePublicId, {
      rule_name: "All actions pct0",
      priority: 1,
      conditions: { groups: [{ field: "utm_source", op: "eq", value: "partner" }] },
      target_funnel_id: legB.funnels[1]!.public_id,
      feed_name: "premium",
      value_multiplier: 3,
      redirect_pct: 0,
      target_offer_id: offerB.id,
    });

    if (!liveLegChromiumOnly(browserName, "#11C all-actions live routing needs chromium --host-resolver-rules; the redirect/stickiness/fail-closed mechanism is unit-proven in test/leadgen-rework-routing.test.ts's §4.3-9 entry-plane redirect describe block.")) return;

    // --- LEG A (pct=100): Redirect% + Target ------------------------------
    // A raw HTTP check against the REAL wrangler-dev worker: page.request (and
    // Node fetch) run OUTSIDE the browser process, so they do their OWN DNS
    // lookup and never see chromium's --host-resolver-rules (own-hand-verified
    // this round: page.request against the tenant hostname ENOTFOUNDs). The
    // fix — own-hand-verified working — connects to the loopback IP directly
    // and sets an explicit Host header: this is not a workaround around the
    // tenant-routing mechanism, it IS the mechanism (publicSiteContextMiddleware
    // resolves the tenant from the Host header; in production DNS resolves the
    // custom domain to Cloudflare's edge and Host conveys tenant identity to the
    // Worker exactly the same way). A fresh context (not the shared admin
    // `apiCtx`) so its cookie jar carries only this leg's ko_sid.
    const hostCtx = await playwrightRequest.newContext({ baseURL: ORIGIN });
    const pathA = `/lg/${legA.slug}?utm_source=partner`;
    const tenantHeaders = { Host: legA.host };
    const res1 = await hostCtx.get(pathA, { headers: tenantHeaders, maxRedirects: 0 });
    expect(res1.status(), "redirect_pct=100 + target_offer_id: entry-plane 302 (never the shell)").toBe(302);
    expect(res1.headers()["location"], "Location = the offer-governed /lg/lc click route").toBe(`/lg/lc/${offerA.public_id}`);
    // sticky across reload (§4.3-6): the SAME context's cookie jar resends the
    // ko_sid Set-Cookie res1 minted (confirmed empirically: the 2nd response
    // carries NO Set-Cookie, meaning the server recognized the returning
    // session) — the SAME session must get the SAME verdict.
    const res2 = await hostCtx.get(pathA, { headers: tenantHeaders, maxRedirects: 0 });
    expect(res2.status(), "sticky across reload: same 302").toBe(302);
    expect(res2.headers()["location"], "sticky across reload: same Location").toBe(res1.headers()["location"]);
    await hostCtx.dispose();

    // --- LEG B (pct=0): Funnel + Feed + Multiplier (the remainder) --------
    await page.goto(shellUrl(legB.host, legB.slug, "?utm_source=partner"), { waitUntil: "load" });
    await ready(page);
    // never redirected (pct=0 ⇒ the gate is inert) — the FUNNEL action still
    // applies: the target funnel serves, exactly as at pct=100 (proven above
    // the gate would have redirected it away).
    expect(await funnelRootAttr(page, "data-funnel-variant-id"), "Funnel action applies: target funnel served (redirect gate inert at pct=0)").toBe(legB.funnels[1]!.variant_public_id);

    const attemptId = await page.evaluate(() => (window as unknown as { __LG_ENGINE__?: { getState(): { funnel_attempt_id: string } } }).__LG_ENGINE__?.getState().funnel_attempt_id ?? "");
    expect(attemptId, "the engine minted a funnel_attempt_id (its /lg/attempt call records the entry outcome)").toBeTruthy();

    // the outcome RECORDED Feed + Multiplier + the routed funnel
    // (leadgen_routing_outcomes has no public endpoint — read the live-written
    // row from the local D1, the __p4a-routing.spec.ts idiom).
    const rows = d1Query<{ routed_to_funnel: string; feed_name: string | null; value_multiplier: number | null; plane: string }>(
      `SELECT routed_to_funnel, feed_name, value_multiplier, plane FROM leadgen_routing_outcomes WHERE funnel_attempt_id = '${attemptId.replace(/'/g, "")}'`,
    );
    expect(rows.length, "an entry outcome was recorded for the remainder").toBe(1);
    expect(rows[0]!.routed_to_funnel, "Target action applied: routed_to_funnel is the rule's target funnel").toBe(legB.funnels[1]!.public_id);
    expect(rows[0]!.feed_name, "Feed action applied").toBe("premium");
    expect(rows[0]!.value_multiplier, "Multiplier action applied (resolveRoutingMultiplier→S2S source)").toBe(3);
    expect(rows[0]!.plane).toBe("entry");

    // §8.7: routed_to_funnel + feed_name are analytics drilldown dimensions.
    const analytics = await json<{ analytics: { breakdowns: { by_routed_funnel: unknown[]; by_feed_name: unknown[] } } }>(
      await apiCtx.get(`${LG_API}/quotes/${legB.quotePublicId}/analytics`),
      "analytics",
    );
    expect(Array.isArray(analytics.analytics.breakdowns.by_routed_funnel), "analytics exposes the routed_to_funnel dimension").toBe(true);
    expect(Array.isArray(analytics.analytics.breakdowns.by_feed_name), "analytics exposes the feed_name dimension").toBe(true);
  });
});
