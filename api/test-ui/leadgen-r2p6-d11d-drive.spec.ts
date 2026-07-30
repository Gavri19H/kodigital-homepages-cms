// LeadGen R2 · P6 terminal — the DRIVEN PRODUCT for the four #11D owner
// sentences (SRC-11D-N01…N04). Each test is ONE real operator journey through
// the real admin UI / real live /lg shell, and writes the 1280 + 375 artifacts
// the register cites. Nothing here hand-builds both sides of a boundary
// (E10/E11): templates are authored by clicking the real Templates tab, the
// per-quote default is set from the real chip menu, the A/B arms are created by
// the real "A/B templates…" dialog and then OBSERVED BEING SERVED on the live
// funnel, and the theme switch is read back as a real computed style inside the
// canvas iframe.
//
// Owner sentences (verbatim — the acceptance):
//  N01 "I should be able to create as many templates I want, to save them, and
//       to use them as presets in different 'Quotes'"
//  N02 "The user should be able to define the 'default' template, but to A/B
//       test different templates"          (D5: the default is PER-QUOTE)
//  N03 "the canvas should include one section in the middle so the user could
//       see a real reference of how is design is gonna look like in real life"
//  N04 "and to swich 'Themes' so he will see how it looks on different themes
//       designs"
//
// Run (worktree-isolated, fresh D1, this worktree's port):
//   cd api && npm run db:reset:local && npm run seed:leadgen-fixture
//   PW_PORT=8901 npx playwright test test-ui/leadgen-r2p6-d11d-drive.spec.ts --workers=1

import { test, expect, request as playwrightRequest, type APIRequestContext, type FrameLocator, type Page } from "@playwright/test";
import { appendFileSync, mkdirSync } from "node:fs";
import { seedActiveSite } from "./listicles-p6-seed";
import { LG_API, ORIGIN, REAL_CHROME_UA, createSection, json, shellUrl, uniqueTag } from "./leadgen-rework-acceptance-helpers";

const EVIDENCE_DIR = "../docs/leadgen/r2/evidence/p6/d11d";
mkdirSync(EVIDENCE_DIR, { recursive: true });
const MEASUREMENTS = `${EVIDENCE_DIR}/measurements.txt`;

test.use({
  launchOptions: { args: ["--host-resolver-rules=MAP *.e2e.test 127.0.0.1"] },
  userAgent: REAL_CHROME_UA,
  viewport: { width: 1280, height: 900 },
});

let apiCtx: APIRequestContext;
test.beforeAll(async () => {
  apiCtx = await playwrightRequest.newContext({ baseURL: ORIGIN });
  appendFileSync(MEASUREMENTS, `\n===== run ${new Date().toISOString()} =====\n`);
});
test.afterAll(async () => {
  await apiCtx.dispose();
});

function note(line: string): void {
  appendFileSync(MEASUREMENTS, `${line}\n`);
}

// Capture the SAME state at 1280 AND 375 (E6) and record the 375 overflow
// measurement (scrollWidth ≤ innerWidth) alongside the artifact.
async function shot(page: Page, name: string, focus?: string): Promise<void> {
  const bring = async (): Promise<void> => {
    if (focus === undefined) return;
    const el = page.locator(focus).first();
    if ((await el.count()) > 0) await el.scrollIntoViewIfNeeded().catch(() => undefined);
  };
  await page.setViewportSize({ width: 1280, height: 900 });
  await bring();
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${EVIDENCE_DIR}/${name}-1280.png`, fullPage: false });
  await page.setViewportSize({ width: 375, height: 812 });
  await bring();
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${EVIDENCE_DIR}/${name}-375.png`, fullPage: false });
  const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  note(`${name} @375 scrollWidth=${m.sw} innerWidth=${m.iw} overflow=${m.sw > m.iw ? "YES" : "no"}`);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(150);
}

interface SeededQuote {
  quotePublicId: string;
  funnelPublicId: string;
  variantPublicId: string;
  sectionHeadline: string;
}

// Quote + funnel + variant (optionally one REAL authored section on the
// variant) through the real admin API — the p4-templates/acceptance-builder
// seed shape, file-local per this directory's convention.
async function seedQuote(request: APIRequestContext, tag: string, withSection: boolean): Promise<SeededQuote> {
  const u = uniqueTag(tag);
  const quote = await json<{
    public_id: string;
    funnels: Array<{ public_id: string; variants: Array<{ public_id: string }> }>;
  }>(await request.post(`${LG_API}/quotes`, { data: { quote_name: `P6D ${u}`, activity: "quote_funnel", verticals: ["life"] } }), "quote create");
  const funnelPublicId = quote.funnels[0]!.public_id;
  const variantPublicId = quote.funnels[0]!.variants[0]!.public_id;
  const sectionHeadline = `P6D REAL SECTION ${u}`;
  if (withSection) {
    const section = await createSection(request, `P6D sec ${u}`, [
      { type: "QuestionHeadline", question_id: "q_head", props: { text: sectionHeadline } },
      { type: "TwoButtonYesNo", question_id: "q_ok", internal_field: "ok", answer_type: "boolean", props: { label: "Do you own your home?" } },
      { type: "ContinueButton", question_id: "cont", props: { label: "Continue" } },
    ]);
    await json(
      await request.put(`${LG_API}/variants/${variantPublicId}`, { data: { pages: [{ name: "Page 1", slots: [{ kind: "fixed", section_id: section.id }] }] } }),
      "variant page",
    );
  }
  return { quotePublicId: quote.public_id, funnelPublicId, variantPublicId, sectionHeadline };
}

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

// The REAL "New template" journey: pick a distinctive design in the Progress
// box (so the saved frame_json differs per template AND the saved template has
// a rendered effect), then Create with a name.
async function createTemplateThroughUi(page: Page, name: string, progressStyle: string): Promise<void> {
  await page.locator(`[data-tplbox-panel="progress"] input[data-frame-key="progress.style"][value="${progressStyle}"]`).check({ force: true });
  await expect(tplCanvas(page).locator(`[data-frame-region="progress"].lg-frame-progress--${progressStyle}`)).toHaveCount(1, { timeout: 10_000 });
  await page.locator("#lg-tpl-new-btn").click();
  await page.locator("#lg-tpl-new-name").fill(name);
  await page.locator("#lg-tpl-new-save").click();
  await expect(page.locator("[data-tpl-chip]", { hasText: name })).toBeVisible({ timeout: 10_000 });
}

interface TplRecord {
  id: number;
  public_id: string;
  name: string;
  is_default: boolean;
}
async function templateByName(request: APIRequestContext, name: string): Promise<TplRecord> {
  const records = await json<{ items: TplRecord[] }>(await request.get(`${LG_API}/frame-template-records`), "records");
  const rec = records.items.find((t) => t.name === name);
  expect(rec, `saved template "${name}" is retrievable from the real records API`).toBeTruthy();
  return rec!;
}

// ===========================================================================
// SRC-11D-N01 — "create as many templates I want, save them, use them as
// presets in different 'Quotes'"
// ===========================================================================
test("SRC-11D-N01 — create MANY templates in quote A, save them, then USE one as a preset in a DIFFERENT quote B", async ({ page }) => {
  const u = uniqueTag("n01");
  const qa = await seedQuote(apiCtx, "n01a", true);
  const qb = await seedQuote(apiCtx, "n01b", true);

  const names = [`P6D N01 Dots ${u}`, `P6D N01 Numbered ${u}`, `P6D N01 Percent ${u}`];
  const styles = ["dots", "numbered", "percent"];
  await openTemplatesTab(page, qa.quotePublicId);
  for (let i = 0; i < names.length; i++) await createTemplateThroughUi(page, names[i]!, styles[i]!);

  // "as many as I want": all three are chips in quote A, and nothing capped the
  // create button (it is still enabled after the third).
  for (const n of names) await expect(page.locator("[data-tpl-chip]", { hasText: n })).toHaveCount(1);
  await expect(page.locator("#lg-tpl-new-btn")).toBeEnabled();
  note(`N01 chips in quote A after 3 creates = ${await page.locator("[data-tpl-chip]").count()}`);
  await shot(page, "n01-a-three-templates-saved");

  // "to save them": they survive a full reload (persisted rows, not island state).
  await openTemplatesTab(page, qa.quotePublicId);
  for (const n of names) await expect(page.locator("[data-tpl-chip]", { hasText: n })).toHaveCount(1, { timeout: 10_000 });

  // "to use them as presets in different 'Quotes'": quote B — a DIFFERENT quote
  // — offers the same saved templates.
  await openTemplatesTab(page, qb.quotePublicId);
  for (const n of names) await expect(page.locator("[data-tpl-chip]", { hasText: n }), `${n} is offered in the other quote`).toHaveCount(1, { timeout: 10_000 });
  await shot(page, "n01-b-presets-listed-in-other-quote");

  // …and USING one there is the real Apply-to-funnel journey (preview → confirm).
  const chosen = await templateByName(apiCtx, names[1]!); // the "numbered" one
  await page.locator("#lg-tpl-apply-btn").click();
  const dialog = page.locator("#lg-tpl-apply-dialog");
  await expect(dialog).toBeVisible();
  await page.locator(`[data-apply-choice="${chosen.public_id}"]`).click();
  await expect(dialog.locator('[data-apply-state="confirm"]')).toBeVisible({ timeout: 10_000 });
  await shot(page, "n01-b-apply-preset-confirm");
  await Promise.all([
    page.waitForResponse((r) => r.url().includes("/apply-template") && r.request().method() === "POST"),
    page.waitForNavigation({ waitUntil: "domcontentloaded" }).catch(() => null),
    page.locator("#lg-tpl-apply-confirm-btn").click(),
  ]);

  // the preset actually APPLIED in quote B: the funnel row references it AND
  // the template's own design is now the funnel's effective frame.
  const funnelB = await json<{ frame_template_id: number | null }>(await apiCtx.get(`${LG_API}/funnels/${qb.funnelPublicId}`), "quote B funnel");
  expect(funnelB.frame_template_id, "quote B's funnel now references the template saved in quote A").toBe(chosen.id);
  const frameB = await json<{ effective_frame: { progress?: { style?: string } } }>(await apiCtx.get(`${LG_API}/funnels/${qb.funnelPublicId}/frame`), "quote B frame");
  expect(frameB.effective_frame.progress?.style, "the applied preset's own design is in effect in quote B").toBe("numbered");
  // quote A's funnel is untouched by quote B's use of the preset.
  const funnelA = await json<{ frame_template_id: number | null }>(await apiCtx.get(`${LG_API}/funnels/${qa.funnelPublicId}`), "quote A funnel");
  expect(funnelA.frame_template_id, "using a preset in quote B never re-skins quote A").toBeNull();
  note(`N01 quote B funnel.frame_template_id=${funnelB.frame_template_id} (template ${chosen.name} id=${chosen.id}); effective progress.style=${frameB.effective_frame.progress?.style}; quote A funnel.frame_template_id=${funnelA.frame_template_id}`);

  await openTemplatesTab(page, qb.quotePublicId);
  await expect(tplCanvas(page).locator('[data-frame-region="progress"].lg-frame-progress--numbered')).toHaveCount(1, { timeout: 10_000 });
  await shot(page, "n01-b-preset-applied", "#lg-tpl-canvas-iframe");
});

// ===========================================================================
// SRC-11D-N02 — "define the 'default' template, but A/B test different
// templates" (D5: the default is PER-QUOTE; serve chain variant ?? funnel ??
// per-quote-default ?? none) — BOTH halves in one journey, with the two arms
// OBSERVED BEING SERVED on the live funnel.
// ===========================================================================
test("SRC-11D-N02 — set this quote's DEFAULT template and A/B a DIFFERENT one; both arms serve their own template live", async ({ page }) => {
  const u = uniqueTag("n02");
  const host = `${u}.e2e.test`;
  const slug = u.replace(/[^a-z0-9-]/gi, "").toLowerCase();
  const siteId = await seedActiveSite(apiCtx, host, `P6D N02 ${u}`);
  const seed = await seedQuote(apiCtx, "n02", true);
  // §4.3-1: activation needs a shared first page; §4.3-13: it must be a
  // DIFFERENT section from the funnel's own.
  const sharedSection = await createSection(apiCtx, `P6D N02 shared ${u}`, [
    { type: "QuestionHeadline", question_id: "sh", props: { text: `P6D N02 shared ${u}` } },
    { type: "ContinueButton", question_id: "sc", props: { label: "Continue" } },
  ]);
  await json(await apiCtx.post(`${LG_API}/quotes/${seed.quotePublicId}/shared-page`, { data: { sections: [{ section_id: sharedSection.id }] } }), "shared page");
  await json(await apiCtx.put(`${LG_API}/quotes/${seed.quotePublicId}/default-funnel`, { data: { funnel_id: seed.funnelPublicId } }), "default funnel");
  const activate = async (): Promise<void> => {
    await json(await apiCtx.put(`${LG_API}/quotes/${seed.quotePublicId}/activation/${siteId}`, { data: { enabled: true, slug } }), "activation");
  };
  await activate();

  // Two DIFFERENT templates, both authored through the real Templates tab.
  const defName = `P6D N02 Default ${u}`;
  const altName = `P6D N02 Alt ${u}`;
  await openTemplatesTab(page, seed.quotePublicId);
  await createTemplateThroughUi(page, defName, "dots");
  await createTemplateThroughUi(page, altName, "percent");
  const defTpl = await templateByName(apiCtx, defName);
  const altTpl = await templateByName(apiCtx, altName);

  // HALF 1 — "define the 'default' template": the real chip menu. D5 renamed
  // the control to "Set as this quote's default" (per-quote, migration 0055).
  const defChip = page.locator(`[data-tpl-chip="${defTpl.public_id}"]`);
  await defChip.locator("[data-tpl-more]").click();
  const menuLabels = await page.locator(".lg-tpl2-tpl-menu button").allTextContents();
  note(`N02 chip-menu labels = ${JSON.stringify(menuLabels)}`);
  await page.locator(".lg-tpl2-tpl-menu button", { hasText: "Set as this quote’s default" }).click();
  await expect(defChip).toHaveClass(/is-default/, { timeout: 10_000 });
  await expect(defChip.locator(".lg-tpl2-tpl-chip-default-badge")).toHaveText("DEFAULT FOR THIS QUOTE");
  const quoteRow = await json<{ default_template_id: string | null }>(await apiCtx.get(`${LG_API}/quotes/${seed.quotePublicId}`), "quote row");
  expect(quoteRow.default_template_id, "the per-quote default (migration 0055) persisted").toBe(defTpl.public_id);
  await shot(page, "n02-default-defined");

  // HALF 2 — "but to A/B test different templates": the real A/B dialog forks a
  // second arm onto the ALT template (and starts a running test).
  await page.locator("#lg-tpl-ab-btn").click();
  await expect(page.locator("#lg-tpl-ab-dialog")).toBeVisible();
  await page.locator("#lg-tpl-ab-template-select").selectOption({ label: altName });
  await Promise.all([
    page.waitForResponse((r) => r.url().includes("/fork") && r.request().method() === "POST"),
    page.waitForNavigation({ waitUntil: "domcontentloaded" }).catch(() => null),
    page.locator("#lg-tpl-ab-confirm-btn").click(),
  ]);
  const variants = await json<{ items: Array<{ public_id: string; frame_template_id: number | null; status: string }> }>(
    await apiCtx.get(`${LG_API}/funnels/${seed.funnelPublicId}/variants`),
    "variants",
  );
  const armA = variants.items.find((v) => v.public_id === seed.variantPublicId)!;
  const armB = variants.items.find((v) => v.public_id !== seed.variantPublicId)!;
  expect(armA.frame_template_id, "arm A carries no override — it inherits this quote's DEFAULT template").toBeNull();
  expect(armB.frame_template_id, "arm B carries the OTHER template (variant-level override)").toBe(altTpl.id);
  note(`N02 arms: A=${armA.public_id} tpl=${armA.frame_template_id} status=${armA.status} | B=${armB.public_id} tpl=${armB.frame_template_id} status=${armB.status}`);
  await openTemplatesTab(page, seed.quotePublicId);
  await shot(page, "n02-ab-two-templates", "#lg-tpl-canvas-iframe");

  // BOTH ARMS ACTUALLY SERVED: re-save the activation past a 1.1s boundary
  // (ADJ-N20 shell cache), then walk distinct ko_sid sessions until each arm
  // has served, and read the frame each arm rendered.
  await page.waitForTimeout(1200);
  await activate();
  const seen = new Map<string, { progressClass: string; frameTemplate: string | null }>();
  for (let i = 0; i < 24 && seen.size < 2; i++) {
    const ctx = page.context();
    await ctx.clearCookies();
    await ctx.addCookies([{ name: "ko_sid", value: `p6d-n02-${u}-${i}`, domain: host, path: "/" }]);
    // ?_cb: the shell ships `Cache-Control: public, max-age=300` (serve.ts:164),
    // so WITHOUT a cache-buster the browser replays its own cached copy and one
    // arm appears to serve forever. Own-hand diagnostic (8 cookie-distinct curl
    // requests, no browser cache): 6× arm B / 2× arm A — the SERVER splits
    // correctly; the single-arm reading was the browser HTTP cache, not the
    // product (manualqa-patterns "cache-bust ?_cb=").
    await page.goto(shellUrl(host, slug, `?_cb=${Date.now()}-${i}`), { waitUntil: "domcontentloaded" });
    await expect(page.locator('#lg-funnel-root[data-lg-ready="1"]')).toHaveCount(1, { timeout: 12_000 });
    const armId = await page.locator("#lg-funnel-root").getAttribute("data-funnel-variant-id");
    if (armId === null || seen.has(armId)) continue;
    const progressClass = (await page.locator('[data-frame-region="progress"]').first().getAttribute("class")) ?? "";
    const frameTemplate = await page.locator("#lg-funnel-root").getAttribute("data-frame-template");
    seen.set(armId, { progressClass, frameTemplate });
    await shot(page, `n02-live-arm-${armId === armA.public_id ? "A-quote-default" : "B-ab-alt"}`);
  }
  note(`N02 live arms served = ${seen.size}: ${JSON.stringify([...seen.entries()])}`);
  expect([...seen.keys()].sort(), "BOTH arms actually served on the live funnel").toEqual([armA.public_id, armB.public_id].sort());
  expect(seen.get(armA.public_id)!.progressClass, "arm A serves THIS QUOTE'S DEFAULT template's design (dots)").toContain("lg-frame-progress--dots");
  expect(seen.get(armB.public_id)!.progressClass, "arm B serves the A/B template's design (percent)").toContain("lg-frame-progress--percent");
});

// ===========================================================================
// SRC-11D-N03 — "the canvas should include one section in the middle so the
// user could see a real reference of how is design is gonna look like in real
// life" (register row records DEVIATES from probe 5a: the EMPTY path showed a
// static, frameless sample card).
// ===========================================================================
test("SRC-11D-N03 — the canvas renders ONE REAL section in the MIDDLE column, and the empty funnel's sample renders inside the REAL frame", async ({ page }) => {
  const withSec = await seedQuote(apiCtx, "n03a", true);
  await openTemplatesTab(page, withSec.quotePublicId);

  // MIDDLE: elements-left | canvas-centre | settings-right, measured.
  const left = (await page.locator(".lg-tpl2-left").boundingBox())!;
  const centre = (await page.locator(".lg-tpl2-center").boundingBox())!;
  const right = (await page.locator(".lg-tpl2-right").boundingBox())!;
  note(`N03 columns @1280: left.x=${left.x} w=${left.width} | centre.x=${centre.x} w=${centre.width} | right.x=${right.x} w=${right.width}`);
  expect(left.x + left.width, "the elements column ends before the canvas starts").toBeLessThanOrEqual(centre.x + 1);
  expect(centre.x + centre.width, "the canvas ends before the settings column starts").toBeLessThanOrEqual(right.x + 1);
  await expect(page.locator("#lg-tpl-canvas-iframe")).toBeVisible();

  // ONE REAL SECTION: the operator's OWN authored section renders in the canvas
  // — its headline text, its real answer control, inside the real frame.
  const text = await tplCanvasText(page);
  expect(text, "the operator's own authored section is what the canvas shows").toContain(withSec.sectionHeadline);
  expect(text).not.toContain("Sample section (add sections to preview your own).");
  await expect(tplCanvas(page).locator("[data-question-id]").first(), "a REAL rendered question control, not a placeholder strip").toBeVisible({ timeout: 10_000 });
  await expect(tplCanvas(page).locator('[data-frame-region="progress"]'), "the section renders INSIDE the real frame regions").toHaveCount(1, { timeout: 10_000 });
  const picked = await page.locator("#lg-tpl-section-select option").allTextContents();
  note(`N03 section picker options = ${JSON.stringify(picked)}; canvas contains authored headline = ${text.includes(withSec.sectionHeadline)}`);
  await shot(page, "n03-canvas-real-section-middle", "#lg-tpl-canvas-iframe");

  // EMPTY funnel (the recorded deviation): the A-9 sample renders through the
  // REAL renderer INSIDE the real frame — and a frame edit re-renders around it,
  // which a static sample card could never do.
  const noSec = await seedQuote(apiCtx, "n03b", false);
  await openTemplatesTab(page, noSec.quotePublicId);
  const emptyText = await tplCanvasText(page);
  expect(emptyText).toContain("Sample section (add sections to preview your own).");
  await expect(tplCanvas(page).locator("[data-question-id], button, .answer-btn").first(), "the sample is REAL rendered output").toBeVisible({ timeout: 10_000 });
  await shot(page, "n03-empty-funnel-sample-in-real-frame", "#lg-tpl-canvas-iframe");

  await page.locator('[data-tplbox-panel="progress"] input[data-frame-key="progress.style"][value="dots"]').check({ force: true });
  await expect(tplCanvas(page).locator('[data-frame-region="progress"].lg-frame-progress--dots'), "the operator's frame edit re-renders AROUND the sample section").toHaveCount(1, { timeout: 10_000 });
  await page.locator("#lg-tpl-progress-show-checkbox").uncheck({ force: true });
  await expect(tplCanvas(page).locator('[data-frame-region="progress"]')).toHaveCount(0, { timeout: 10_000 });
  await page.locator("#lg-tpl-progress-show-checkbox").check({ force: true });
  await expect(tplCanvas(page).locator('[data-frame-region="progress"]')).toHaveCount(1, { timeout: 10_000 });
  note("N03 empty-funnel canvas: frame edit (progress dots → hidden → back) re-rendered around the sample section");
  await shot(page, "n03-empty-funnel-frame-edit-rerender", "#lg-tpl-canvas-iframe");
});

// ===========================================================================
// SRC-11D-N04 — "and to swich 'Themes' so he will see how it looks on
// different themes designs" (register row records DEVIATES from probe 5b: one
// option, no presets, no create affordance).
// ===========================================================================
interface ThemeRoles {
  brand_primary: string;
  accent: string;
  page_bg: string;
  card: string;
  text: string;
  success: string;
  error: string;
}
async function createTheme(request: APIRequestContext, name: string, roles: ThemeRoles): Promise<string> {
  const res = await json<{ item: { id: string } }>(
    await request.post(`${LG_API}/themes`, {
      data: {
        name,
        roles,
        typography: { headline_font: "Newsreader", body_font: "Inter", base_px: 16 },
        controls: { field_height: "medium", button_size: "m", corners: "rounded" },
      },
    }),
    `theme create (${name})`,
  );
  return res.item.id;
}

// A style fingerprint of what the canvas ACTUALLY paints (E10: the rendered
// product, not the request that asked for it).
async function canvasFingerprint(page: Page): Promise<string> {
  return tplCanvas(page)
    .locator("body")
    .evaluate((body) => {
      const el = body.querySelector("button, .answer-btn, [data-question-id]") as HTMLElement | null;
      const cs = el === null ? null : getComputedStyle(el);
      const bodyCs = getComputedStyle(body);
      const root = body.querySelector("#lg-funnel-root") as HTMLElement | null;
      const rootCs = root === null ? null : getComputedStyle(root);
      return JSON.stringify({
        bodyBg: bodyCs.backgroundColor,
        rootBg: rootCs === null ? null : rootCs.backgroundColor,
        rootColor: rootCs === null ? null : rootCs.color,
        elBg: cs === null ? null : cs.backgroundColor,
        elColor: cs === null ? null : cs.color,
        elBorder: cs === null ? null : cs.borderColor,
      });
    });
}

test("SRC-11D-N04 — the canvas theme switcher offers the REAL presets and switching visibly changes what the canvas paints", async ({ page }) => {
  const u = uniqueTag("n04");
  const nameA = `P6D N04 Midnight ${u}`;
  const nameB = `P6D N04 Ember ${u}`;
  await createTheme(apiCtx, nameA, { brand_primary: "#123456", accent: "#654321", page_bg: "#FFFFFF", card: "#FFFFFF", text: "#101010", success: "#0E7C3A", error: "#B23A2C" });
  await createTheme(apiCtx, nameB, { brand_primary: "#E4572E", accent: "#17BEBB", page_bg: "#FFF3E6", card: "#FFF8F2", text: "#2B2118", success: "#0E7C3A", error: "#B23A2C" });

  const seed = await seedQuote(apiCtx, "n04", true);
  await openTemplatesTab(page, seed.quotePublicId);

  // REAL presets offered (the recorded deviation was "a single option, no
  // presets, no create affordance").
  const options = page.locator("#lg-tpl-theme-select option");
  const labels = await options.allTextContents();
  note(`N04 theme switcher options = ${JSON.stringify(labels)}`);
  await expect(page.locator("#lg-tpl-theme-select option", { hasText: nameA })).toHaveCount(1, { timeout: 10_000 });
  await expect(page.locator("#lg-tpl-theme-select option", { hasText: nameB })).toHaveCount(1);
  await expect(options, "more than the bare 'Current theme' row").not.toHaveCount(1);
  await expect(page.locator("#lg-tpl-theme-select option", { hasText: "No themes yet" }), "no empty-state row when real presets exist").toHaveCount(0);
  await expect(page.locator("#lg-tpl-theme-create"), "the create-a-theme affordance beside the switcher").toBeVisible();

  const beforeSwitch = await canvasFingerprint(page);

  await Promise.all([
    page.waitForResponse((r) => r.url().includes("/preview") && r.request().method() === "POST"),
    page.locator("#lg-tpl-theme-select").selectOption({ label: nameA }),
  ]);
  await expect(tplCanvas(page).locator("[data-question-id]").first()).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(400);
  const fpA = await canvasFingerprint(page);
  await shot(page, "n04-theme-A-midnight", "#lg-tpl-canvas-iframe");

  await Promise.all([
    page.waitForResponse((r) => r.url().includes("/preview") && r.request().method() === "POST"),
    page.locator("#lg-tpl-theme-select").selectOption({ label: nameB }),
  ]);
  await expect(tplCanvas(page).locator("[data-question-id]").first()).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(400);
  const fpB = await canvasFingerprint(page);
  await shot(page, "n04-theme-B-ember", "#lg-tpl-canvas-iframe");

  note(`N04 canvas fingerprint before=${beforeSwitch}`);
  note(`N04 canvas fingerprint themeA=${fpA}`);
  note(`N04 canvas fingerprint themeB=${fpB}`);
  expect(fpA, "switching to a real preset changes what the canvas paints").not.toBe(beforeSwitch);
  expect(fpB, "switching to a DIFFERENT preset paints differently again").not.toBe(fpA);
});
