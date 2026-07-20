// LeadGen Round-4 Remediation — Phase P5b probe spec (temporary; final
// consolidation lands in P7). Drives the REAL admin UI at :<PW_PORT>, real
// fill/click/select (ZERO dispatchEvent):
//   * Templates + Themes are promoted to top-level tabs (beside Funnel
//     builder/A/B/Activation/Analytics) and activate;
//   * the Templates tab's seven box pickers (A Background · B Logo · C
//     Phone/URL · D Disclosure · E Free text · F Brand logos · G Footer)
//     each open their own right-side editor;
//   * author a CTA slot (header-right + a __state condition via the
//     plain-language builder), a disclosure entry (bottom/hover), a
//     free-text block (above_section, page-first), a brand-logo item, and a
//     footer about-paragraph + link-row block -> Save -> reload -> ALL
//     round-trip (server JSON read-back AND re-populated DOM);
//   * the progress editor's Image15 layout fix: aligned rows, the selection
//     mark's x > the label's x within EVERY row, rows vertically stacked;
//   * the New Quote form: Activity is a select fed by the real seeded
//     activities + an "add new" escape hatch; Verticals is a multi-select
//     with its own "add new" affordance;
//   * the builder/Templates canvas resolves the SELECTED preview site's real
//     branding logo, and (10B admin leg / seam) the no-logo hint for a
//     logo-less site.
//
// chromium-only (playwright.config.ts: firefox testMatch is the gesture set;
// this non-gesture admin-UI spec is picked up by chromium alone, like
// __p3b-structure / __p4b-rules / __p5a-frame). Admin UI on 127.0.0.1 — no
// tenant host, no --host-resolver-rules.

import { test, expect, request as playwrightRequest, type APIRequestContext, type Page, type FrameLocator } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { seedActiveSite, uploadPng } from "./listicles-p6-seed";
import { PW_PORT } from "./utils/base-url";

const ORIGIN = `http://127.0.0.1:${PW_PORT}`;
const LG_API = "/api/admin/leadgen";
const SHOT_DIR = "test-artifacts/leadgen-p5b";

async function json<T>(
  res: { ok(): boolean; status(): number; json(): Promise<unknown>; text(): Promise<string> },
  label: string,
): Promise<T> {
  if (!res.ok()) throw new Error(`${label} HTTP ${res.status()}: ${await res.text()}`);
  return (await res.json()) as T;
}

// A CMS site with NO leadgen activation and NO logo (the C4 "any CMS site is
// legal to preview" rule + the no-logo-hint fixture) — mirrors leadgen-b-
// seed.ts's local createBareSite helper (no exported twin in listicles-p6-seed).
async function createBareSite(request: APIRequestContext, host: string, name: string): Promise<string> {
  const created = await json<{ resource: { id: string } }>(
    await request.post("/api/admin/sites", { data: { domain: host, name, vertical_slug: "finance", activity: "main" } }),
    `site create ${host}`,
  );
  return created.resource.id;
}

const CONTINUE = { type: "ContinueButton", question_id: "cont", props: { label: "Continue" } };

interface Seeded {
  quotePublicId: string;
  funnelPublicId: string;
  variantPublicId: string;
  activity: string;
  siteWithLogo: { id: string; name: string; logoKey: string };
  siteNoLogo: { id: string; name: string };
}

async function seedQuote(request: APIRequestContext, tag: string): Promise<Seeded> {
  const uniq = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const activity = `p5b_${tag}_${uniq}`;

  const quote = await json<{ public_id: string; funnels: Array<{ public_id: string; variants: Array<{ public_id: string }> }> }>(
    await request.post(`${LG_API}/quotes`, { data: { quote_name: `P5b ${tag} ${uniq}`, activity, verticals: ["life"] } }),
    "quote create",
  );
  const funnelPublicId = quote.funnels[0]!.public_id;
  const variantPublicId = quote.funnels[0]!.variants[0]!.public_id;

  const section = await json<{ public_id: string }>(
    await request.post(`${LG_API}/sections`, {
      data: {
        activity,
        vertical: "life",
        status: "active",
        section_name: `p5b-${tag}`,
        headline_text: "Are you currently insured?",
        content_json: JSON.stringify({
          components: [
            { type: "TwoButtonYesNo", question_id: "q1", question_key: "insured", internal_field: "insured", answer_type: "boolean", required: true },
            CONTINUE,
          ],
        }),
      },
    }),
    "section create",
  );
  await json(
    await request.put(`${LG_API}/variants/${variantPublicId}`, {
      data: { pages: [{ name: "Page 1", slots: [{ kind: "fixed", section_id: section.public_id }] }] },
    }),
    "variant pages",
  );

  const nameLogo = `P5b logo site ${uniq}`;
  const nameBare = `P5b bare site ${uniq}`;
  const siteWithLogoId = await seedActiveSite(request, `lg-p5b-logo-${uniq}.e2e.test`, nameLogo);
  const logo = await uploadPng(request, `p5b-logo-${uniq}.png`);
  await json(
    await request.patch("/api/admin/settings", { data: { site_id: siteWithLogoId, updates: { site_name: nameLogo, logo_media_id: logo.storage_key } } }),
    "site branding (logo)",
  );
  const siteNoLogoId = await createBareSite(request, `lg-p5b-bare-${uniq}.e2e.test`, nameBare);

  return {
    quotePublicId: quote.public_id,
    funnelPublicId,
    variantPublicId,
    activity,
    siteWithLogo: { id: siteWithLogoId, name: nameLogo, logoKey: logo.storage_key },
    siteNoLogo: { id: siteNoLogoId, name: nameBare },
  };
}

function canvas(page: Page): FrameLocator {
  return page.frameLocator("#lg-preview-iframe");
}

async function openEditor(page: Page, quotePublicId: string): Promise<void> {
  await page.goto(`/admin/leadgen/quotes/${quotePublicId}/edit`, { waitUntil: "domcontentloaded" });
  await expect(canvas(page).locator("[data-frame-region='section_slot']")).toBeVisible({ timeout: 20_000 });
}

test.beforeAll(() => {
  mkdirSync(SHOT_DIR, { recursive: true });
});

test.describe("P5b — Templates/Themes top tabs + the seven box pickers", () => {
  let seed: Seeded;

  test.beforeAll(async () => {
    const ctx = await playwrightRequest.newContext({ baseURL: ORIGIN });
    seed = await seedQuote(ctx, "core");
    await ctx.dispose();
  });

  test("Templates + Themes tabs exist and activate; each of the seven box pickers opens its own editor", async ({ page }) => {
    await openEditor(page, seed.quotePublicId);

    const templatesTab = page.locator('.lg-qtab[data-tab="templates"]');
    const themesTab = page.locator('.lg-qtab[data-tab="themes"]');
    await expect(templatesTab).toBeVisible();
    await expect(themesTab).toBeVisible();

    await templatesTab.click();
    await expect(page.locator('[data-panel="templates"]')).toHaveClass(/active/);

    const boxes = ["background", "logo", "cta", "disclosure", "free_text", "brand_logos", "footer"] as const;
    for (const key of boxes) {
      await page.locator(`[data-tplbox-pick="${key}"]`).click();
      await expect(page.locator(`[data-tplbox-panel="${key}"]`), `box ${key} opens`).toHaveClass(/active/);
    }
    await page.screenshot({ path: `${SHOT_DIR}/templates-tab.png`, fullPage: true });

    await themesTab.click();
    await expect(page.locator('[data-panel="themes"]')).toHaveClass(/active/);
    await expect(page.locator("#lg-themes-panel-mount #lg-theme-editor")).toBeVisible();
  });

  test("author a CTA slot + a __state condition, a disclosure entry, a free-text block, a brand logo, and a footer about+link_row block -> Save -> reload -> ALL round-trip", async ({ page }) => {
    test.setTimeout(180_000);
    await openEditor(page, seed.quotePublicId);
    await page.locator('.lg-qtab[data-tab="templates"]').click();

    // --- C: Phone/URL (cta_slots) — header-right + a __state condition -------
    await page.locator('[data-tplbox-pick="cta"]').click();
    const ctaPanel = page.locator('[data-tplbox-panel="cta"]');
    await ctaPanel.locator('[data-tplbox-add="cta_slots"]').click();
    const ctaRow = ctaPanel.locator('[data-cta-row]').first();
    await ctaRow.locator('[data-cta-slot]').selectOption("header_right");
    await ctaRow.locator('[data-cta-label]').fill("Call now");
    await ctaRow.locator('[data-cta-label]').blur();
    await ctaRow.locator('[data-cta-tel]').fill("+1 555 222 3333");
    await ctaRow.locator('[data-cta-tel]').blur();
    await ctaRow.locator('[data-cta-cond-toggle]').click();
    const condRow = ctaRow.locator('[data-cta-cond-row]').first();
    await expect(condRow).toBeVisible();
    await condRow.locator('[data-cta-cond-field]').selectOption("__state");
    await condRow.locator('[data-cta-cond-op]').selectOption("eq");
    await condRow.locator('[data-cta-cond-value]').fill("CA");
    await condRow.locator('[data-cta-cond-value]').blur();

    // --- D: Disclosure (disclosure.entries) — bottom / hover -----------------
    await page.locator('[data-tplbox-pick="disclosure"]').click();
    const discPanel = page.locator('[data-tplbox-panel="disclosure"]');
    await discPanel.locator('[data-tplbox-add="disclosure.entries"]').click();
    const discRow = discPanel.locator('[data-disc-entry-row]').first();
    await discRow.locator('[data-disc-location]').selectOption("bottom");
    await discRow.locator('[data-disc-mode]').selectOption("hover");
    await discRow.locator('[data-disc-text]').fill("We may be compensated by our partners.");
    await discRow.locator('[data-disc-text]').blur();

    // --- E: Free text (free_text) — above_section, page-first ----------------
    await page.locator('[data-tplbox-pick="free_text"]').click();
    const ftPanel = page.locator('[data-tplbox-panel="free_text"]');
    await ftPanel.locator('[data-tplbox-add="free_text"]').click();
    const ftRow = ftPanel.locator('[data-ft-entry-row]').first();
    await ftRow.locator('[data-ft-slot]').selectOption("above_section");
    await ftRow.locator('[data-pt-mode]').selectOption("first");
    const ftBlockRow = ftRow.locator('[data-ft-block-row]').first();
    await expect(ftBlockRow).toBeVisible();
    await ftBlockRow.locator('[data-ft-block-text]').fill("Free text shown on page 1 only.");
    await ftBlockRow.locator('[data-ft-block-text]').blur();

    // --- F: Brand logos (brand_logos) — one item by URL -----------------------
    await page.locator('[data-tplbox-pick="brand_logos"]').click();
    const blPanel = page.locator('[data-tplbox-panel="brand_logos"]');
    await blPanel.locator('[data-bl-enabled]').check();
    await blPanel.locator('[data-tplbox-add="brand_logos.items"]').click();
    const blRow = blPanel.locator('[data-bl-item-row]').first();
    await blRow.locator('[data-bl-item-url]').fill("https://example.com/partner-logo.png");
    await blRow.locator('[data-bl-item-url]').blur();
    await blRow.locator('[data-bl-item-alt]').fill("Partner logo");
    await blRow.locator('[data-bl-item-alt]').blur();

    // --- G: Footer (footer.blocks) — about paragraph + a manual link row -----
    await page.locator('[data-tplbox-pick="footer"]').click();
    const footerPanel = page.locator('[data-tplbox-panel="footer"]');
    await footerPanel.locator('[data-tplbox-add="footer.blocks"]').click();
    const aboutRow = footerPanel.locator('[data-footer-block-row]').first();
    await aboutRow.locator('[data-footer-block-type]').selectOption("about_paragraph");
    await aboutRow.locator('[data-footer-block-text]').fill("Operated by Acme Insure Inc.");
    await aboutRow.locator('[data-footer-block-text]').blur();
    await footerPanel.locator('[data-tplbox-add="footer.blocks"]').click();
    const linkRow = footerPanel.locator('[data-footer-block-row]').nth(1);
    await linkRow.locator('[data-footer-block-type]').selectOption("link_row");
    await linkRow.locator('[data-footer-block-linksource]').selectOption("manual");
    await linkRow.locator('[data-footer-block-link-add]').click();
    const linkEntry = linkRow.locator('[data-footer-link-row]').first();
    await linkEntry.locator('[data-footer-link-label]').fill("Privacy");
    await linkEntry.locator('[data-footer-link-label]').blur();
    await linkEntry.locator('[data-footer-link-href]').fill("/privacy");
    await linkEntry.locator('[data-footer-link-href]').blur();

    await page.screenshot({ path: `${SHOT_DIR}/authored-before-save.png`, fullPage: true });

    // --- SAVE ------------------------------------------------------------------
    const framePutPromise = page.waitForResponse(
      (r) => r.request().method() === "PUT" && r.url().includes(`/funnels/${seed.funnelPublicId}/frame`),
    );
    await page.locator("#lg-variant-save").click();
    const framePut = await framePutPromise;
    expect(framePut.status(), await framePut.text()).toBe(200);
    await expect(page.locator("#lg-quote-ok")).toBeVisible({ timeout: 20_000 });

    // --- server-side JSON read-back --------------------------------------------
    interface FrameConfig {
      cta_slots?: Array<{ slot: string; label: string; tel?: string; condition?: { when: string; op: string; value: unknown } }>;
      disclosure?: { entries?: Array<{ location: string; mode: string; text: string }> };
      free_text?: Array<{ slot: string; pages?: { mode: string }; blocks: Array<{ type: string; html?: string; text?: string }> }>;
      brand_logos?: { enabled: boolean; items: Array<{ url?: string; alt: string }> };
      footer?: { blocks?: Array<{ type: string; text?: string; links_source?: string; links?: Array<{ label: string; href: string }> }> };
    }
    const frameRes = await page.request.get(`${LG_API}/funnels/${seed.funnelPublicId}/frame`);
    const frameBody = (await frameRes.json()) as { frame_config: FrameConfig };
    const cfg = frameBody.frame_config;

    const ctaSaved = cfg.cta_slots?.[0];
    expect(ctaSaved?.slot).toBe("header_right");
    expect(ctaSaved?.label).toBe("Call now");
    expect(ctaSaved?.tel).toBe("+1 555 222 3333");
    expect(ctaSaved?.condition).toEqual({ when: "__state", op: "eq", value: "CA" });

    const discSaved = cfg.disclosure?.entries?.[0];
    expect(discSaved?.location).toBe("bottom");
    expect(discSaved?.mode).toBe("hover");
    expect(discSaved?.text).toBe("We may be compensated by our partners.");

    const ftSaved = cfg.free_text?.[0];
    expect(ftSaved?.slot).toBe("above_section");
    expect(ftSaved?.pages?.mode).toBe("first");
    expect(ftSaved?.blocks[0]?.type).toBe("paragraph");
    expect(ftSaved?.blocks[0]?.html).toBe("Free text shown on page 1 only.");

    expect(cfg.brand_logos?.enabled).toBe(true);
    expect(cfg.brand_logos?.items[0]?.url).toBe("https://example.com/partner-logo.png");
    expect(cfg.brand_logos?.items[0]?.alt).toBe("Partner logo");

    const footerBlocks = cfg.footer?.blocks ?? [];
    const aboutSaved = footerBlocks.find((b) => b.type === "about_paragraph");
    const linkSaved = footerBlocks.find((b) => b.type === "link_row");
    expect(aboutSaved?.text).toBe("Operated by Acme Insure Inc.");
    expect(linkSaved?.links_source).toBe("manual");
    expect(linkSaved?.links).toEqual([{ label: "Privacy", href: "/privacy" }]);

    // --- RELOAD -> the authoring DOM round-trips from the SAME stored config --
    await openEditor(page, seed.quotePublicId);
    await page.locator('.lg-qtab[data-tab="templates"]').click();

    await page.locator('[data-tplbox-pick="cta"]').click();
    const ctaRow2 = ctaPanel.locator('[data-cta-row]').first();
    await expect(ctaRow2.locator('[data-cta-label]')).toHaveValue("Call now");
    await expect(ctaRow2.locator('[data-cta-tel]')).toHaveValue("+1 555 222 3333");
    await expect(ctaRow2.locator('[data-cta-slot]')).toHaveValue("header_right");
    const condRow2 = ctaRow2.locator('[data-cta-cond-row]').first();
    await expect(condRow2.locator('[data-cta-cond-field]')).toHaveValue("__state");
    await expect(condRow2.locator('[data-cta-cond-op]')).toHaveValue("eq");
    await expect(condRow2.locator('[data-cta-cond-value]')).toHaveValue("CA");

    await page.locator('[data-tplbox-pick="disclosure"]').click();
    const discRow2 = discPanel.locator('[data-disc-entry-row]').first();
    await expect(discRow2.locator('[data-disc-location]')).toHaveValue("bottom");
    await expect(discRow2.locator('[data-disc-mode]')).toHaveValue("hover");
    await expect(discRow2.locator('[data-disc-text]')).toHaveValue("We may be compensated by our partners.");

    await page.locator('[data-tplbox-pick="free_text"]').click();
    const ftRow2 = ftPanel.locator('[data-ft-entry-row]').first();
    await expect(ftRow2.locator('[data-ft-slot]')).toHaveValue("above_section");
    await expect(ftRow2.locator('[data-pt-mode]')).toHaveValue("first");
    await expect(ftRow2.locator('[data-ft-block-row]').first().locator('[data-ft-block-text]')).toHaveValue("Free text shown on page 1 only.");

    await page.locator('[data-tplbox-pick="brand_logos"]').click();
    await expect(blPanel.locator('[data-bl-enabled]')).toBeChecked();
    const blRow2 = blPanel.locator('[data-bl-item-row]').first();
    await expect(blRow2.locator('[data-bl-item-url]')).toHaveValue("https://example.com/partner-logo.png");
    await expect(blRow2.locator('[data-bl-item-alt]')).toHaveValue("Partner logo");

    await page.locator('[data-tplbox-pick="footer"]').click();
    const footerRows2 = footerPanel.locator('[data-footer-block-row]');
    await expect(footerRows2).toHaveCount(2);
    const aboutRow2 = footerRows2.filter({ has: page.locator('[data-footer-block-type]') }).first();
    await expect(aboutRow2.locator('[data-footer-block-text]')).toHaveValue("Operated by Acme Insure Inc.");
    const linkRow2 = footerRows2.nth(1);
    await expect(linkRow2.locator('[data-footer-block-linksource]')).toHaveValue("manual");
    await expect(linkRow2.locator('[data-footer-link-row]').first().locator('[data-footer-link-label]')).toHaveValue("Privacy");
    await expect(linkRow2.locator('[data-footer-link-row]').first().locator('[data-footer-link-href]')).toHaveValue("/privacy");

    await page.screenshot({ path: `${SHOT_DIR}/round-trip-after-reload.png`, fullPage: true });
  });
});

test.describe("P5b — progress editor Image15 layout: aligned rows, the mark right of the label", () => {
  let seed: Seeded;

  test.beforeAll(async () => {
    const ctx = await playwrightRequest.newContext({ baseURL: ORIGIN });
    seed = await seedQuote(ctx, "progress");
    await ctx.dispose();
  });

  test("every style row is aligned; the radio's x sits right of the label's x; rows stack vertically", async ({ page }) => {
    await openEditor(page, seed.quotePublicId);
    await canvas(page).locator("[data-frame-region='progress']").first().click();
    const panel = page.locator('[data-region-panel="progress"]');
    await expect(panel).toBeVisible();

    const rows = panel.locator(".lg-progress-style-opt");
    const count = await rows.count();
    // FRAME_PROGRESS_STYLES: hidden/bar/dots/numbered/percent/icon_on_track.
    expect(count).toBe(6);

    let previousY: number | null = null;
    for (let i = 0; i < count; i += 1) {
      const row = rows.nth(i);
      const labelBox = await row.locator(".lg-progress-style-label").boundingBox();
      const radioBox = await row.locator('input[type="radio"]').boundingBox();
      expect(labelBox, `row ${i} label box`).not.toBeNull();
      expect(radioBox, `row ${i} radio box`).not.toBeNull();
      expect(radioBox!.x, `row ${i}: mark x (${radioBox!.x}) > label x (${labelBox!.x})`).toBeGreaterThan(labelBox!.x);
      if (previousY !== null) {
        expect(labelBox!.y, `row ${i} stacked below the previous row`).toBeGreaterThan(previousY);
      }
      previousY = labelBox!.y;
    }
    // the P5a icon_on_track style is labeled correctly (not the old "Percent" mislabel).
    await expect(rows.last().locator(".lg-progress-style-label")).toHaveText("Icon on track");
  });
});

test.describe("P5b — New Quote form: Activity select + Verticals multi-select, both with 'add new'", () => {
  let seed: Seeded;

  test.beforeAll(async () => {
    const ctx = await playwrightRequest.newContext({ baseURL: ORIGIN });
    seed = await seedQuote(ctx, "newform");
    await ctx.dispose();
  });

  test("Activity is a select with the real seeded activity + 'add new'; Verticals is a multi-select + 'add new'", async ({ page }) => {
    await page.goto("/admin/leadgen/quotes/new", { waitUntil: "domcontentloaded" });

    const activitySel = page.locator("#lg-q-activity");
    await expect(activitySel).toBeVisible();
    await expect(page.locator("#lg-q-verticals")).toBeVisible();
    // the seeded quote's real activity rides the select's option list.
    await expect(activitySel.locator(`option[value="${seed.activity}"]`)).toHaveCount(1);

    const uniq = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    await page.locator("#lg-q-name").fill(`P5b new quote ${uniq}`);

    // Activity "add new" escape hatch.
    await activitySel.selectOption("__new__");
    const activityNew = page.locator("#lg-q-activity-new");
    await expect(activityNew).toBeVisible();
    const newActivity = `p5b_newform_activity_${uniq}`;
    await activityNew.fill(newActivity);

    // Verticals "add new" affordance.
    await page.locator("#lg-q-verticals-new").fill("p5bvertical");
    await page.locator("#lg-q-verticals-add").click();
    await expect(page.locator('#lg-q-verticals option[value="p5bvertical"]')).toHaveJSProperty("selected", true);

    // The success handler navigates immediately (`window.location.href =
    // .../edit`) after parsing the SAME response body itself — reading it a
    // second time from the test races the CDP network resource being torn
    // down by that navigation (a real Playwright gotcha for redirect-on-
    // success flows). Verify via the resulting URL + a FRESH API read-back
    // instead of the original response object.
    await page.locator("#lg-quote-new-save").click();
    await page.waitForURL(/\/admin\/leadgen\/quotes\/[^/]+\/edit/);
    const createdPublicId = page.url().match(/\/quotes\/([^/]+)\/edit/)?.[1];
    expect(createdPublicId, `created quote public_id from ${page.url()}`).toBeTruthy();
    const structureRes = await page.request.get(`${LG_API}/quotes/${createdPublicId}/structure`);
    const structure = (await structureRes.json()) as { quote: { activity: string; verticals_json: string[] } };
    expect(structure.quote.activity).toBe(newActivity);
    expect(structure.quote.verticals_json).toEqual(["p5bvertical"]);
  });
});

test.describe("P5b — 10B admin leg: the builder/Templates preview resolves the real preview-site logo", () => {
  let seed: Seeded;

  test.beforeAll(async () => {
    const ctx = await playwrightRequest.newContext({ baseURL: ORIGIN });
    seed = await seedQuote(ctx, "branding");
    await ctx.dispose();
  });

  test("a site WITH a logo shows the real logo img; a logo-less site shows the no-logo hint", async ({ page }) => {
    await openEditor(page, seed.quotePublicId);

    await page.locator("#lg-site-select").selectOption(seed.siteWithLogo.id);
    const logoImg = canvas(page).locator("[data-frame-region='logo'] img.lg-logo-img");
    await expect(logoImg).toBeVisible({ timeout: 20_000 });
    await expect(logoImg).toHaveAttribute(
      "src",
      new RegExp(seed.siteWithLogo.logoKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
    await page.screenshot({ path: `${SHOT_DIR}/preview-real-logo.png` });

    // Round-4 P5a's admin-preview-only no-logo hint (frame.ts renderNoLogoHint,
    // `[data-admin-preview-hint="1"]`) requires the composition call to pass
    // `adminPreview: true` into renderQuoteFrame — see the P5b report's cited
    // seam (quotes-handlers.ts renderComposedVariantPreview's renderBody).
    await page.locator("#lg-site-select").selectOption(seed.siteNoLogo.id);
    const hint = canvas(page).locator('[data-admin-preview-hint="1"]');
    await expect(hint).toBeVisible({ timeout: 20_000 });
    await page.screenshot({ path: `${SHOT_DIR}/preview-no-logo-hint.png` });
  });
});
