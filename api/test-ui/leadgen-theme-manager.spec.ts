// LeadGen redesign-contract-v3.1 §10 — Themes MANAGER browser flows (Phase
// D). Drives the REAL page at /admin/leadgen/themes against the wrangler-dev
// webServer (playwright.config.ts) — no HTML string checks, real clicks.
//
// Seeding rides the REAL admin HTTP APIs only (POST /themes, /quotes,
// /funnels/:id/variants, PUT /funnels/:id/theme, PUT /variants/:id — the
// leadgen-offers-mgmt.spec.ts / leadgen-section-studio.spec.ts convention;
// no direct DB writes). Local state must be reset once beforehand:
// `npm run db:reset:local`.
//
// Covers: the §10.3 three fixture-shaped cards + computed LIVE·A / A/B·B /
// DRAFT badges; selecting a card re-skins the CENTER editor; an editor edit
// (segmented control) PATCHes + persists across reload; the §10.5 A/B panel
// renders live variant splits + "Other funnels using this theme"; the
// fixture-value rule (60/40, funnel names, "No others yet." all COMPUTED,
// never hardcoded — proven by re-pointing the split away from 60/40 and
// re-reading); "Back to section" nav via ?from=; the REAL "Manage theme →"
// round-trip from a live Section-Studio page.
//
// Fix round (adversarial review, v3.1 §10.2 integration completion):
//   M1 — ui-section-studio.ts's two "Manage theme →" hrefs (Style tab +
//        drawer) now append ?from=<section public_id>, so the round trip
//        from a REAL section actually returns to it (was: always the
//        sections LIST, §10.2 intent broken). The round-trip test below
//        asserts BOTH fixed hrefs and the corrected "Back to section" landing.
//   M2 — "New theme" click -> POST -> redirect -> selected glue.
//   M3 — the 3 previously-rendered-but-unasserted Appendix-A strings.
//
// Screenshots (1280x800) land in test-artifacts/leadgen-theme-manager/.

import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 800 } });

const SHOT_DIR = 'test-artifacts/leadgen-theme-manager';
const LG_API = '/api/admin/leadgen';
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

interface ThemeRecordApi {
  id: string;
  name: string;
  roles: Record<string, string>;
}
interface ThemeCreated {
  item: ThemeRecordApi;
}
interface FunnelVariant {
  public_id: string;
}
interface QuoteCreated {
  public_id: string;
  funnels: Array<{ public_id: string; variants: FunnelVariant[] }>;
}
interface FunnelCreated {
  public_id: string;
  variants: FunnelVariant[];
}

function themeBody(name: string, brand: string, accent: string, pageBg: string, card: string, text: string): Record<string, unknown> {
  // golden-master-source.dc.html swatch hex (lines 646/650/654) + the §10.4
  // thm_navy sample record for success/error.
  return {
    name,
    roles: { brand_primary: brand, accent, page_bg: pageBg, card, text, success: '#0E7C3A', error: '#B23A2C' },
    typography: { headline_font: 'Newsreader', body_font: 'Inter', base_px: 16 },
    controls: { field_height: 'medium', button_size: 'm', corners: 'rounded' },
  };
}

// §10.3 fixture: Navy -> Auto Insurance/Variant A (control, 60%) AND Home
// Insurance/Variant A; Bold Yellow -> Auto Insurance/Variant B (A/B, 40%);
// Minimal -> unused (DRAFT). Ground truth: golden lines 646/650/654 + §10.4's
// thm_navy example.
async function seedThemesFixture(request: APIRequestContext): Promise<{
  navy: ThemeRecordApi;
  bold: ThemeRecordApi;
  minimal: ThemeRecordApi;
  autoFunnelId: string;
  homeFunnelId: string;
  variantAId: string;
  variantBId: string;
}> {
  const navy = (
    await json<ThemeCreated>(await request.post(`${LG_API}/themes`, { data: themeBody(`Navy ${uniq}`, '#1B3A5C', '#F5C518', '#F4F6F9', '#FFFFFF', '#1A1F36') }), 'create navy')
  ).item;
  const bold = (
    await json<ThemeCreated>(await request.post(`${LG_API}/themes`, { data: themeBody(`Bold Yellow ${uniq}`, '#13233B', '#F5C518', '#FFF7DE', '#FFFFFF', '#14181F') }), 'create bold')
  ).item;
  const minimal = (
    await json<ThemeCreated>(await request.post(`${LG_API}/themes`, { data: themeBody(`Minimal ${uniq}`, '#232A34', '#6B7486', '#FFFFFF', '#F6F8FA', '#14181F') }), 'create minimal')
  ).item;

  const quote = await json<QuoteCreated>(
    await request.post(`${LG_API}/quotes`, {
      data: { quote_name: `Themes Manager Fixture ${uniq}`, activity: `tm-quote-${uniq}`, verticals: ['auto'], funnel_name: `Auto Insurance ${uniq}` },
    }),
    'create quote',
  );
  const autoFunnelId = quote.funnels[0]!.public_id;
  const variantAId = quote.funnels[0]!.variants[0]!.public_id;

  const variantB = await json<FunnelVariant>(await request.post(`${LG_API}/funnels/${autoFunnelId}/variants`, { data: {} }), 'create variant B');
  const variantBId = variantB.public_id;

  await json(await request.put(`${LG_API}/funnels/${autoFunnelId}/theme`, { data: { theme_json: { theme_id: navy.id } } }), 'set funnel theme');
  await json(await request.put(`${LG_API}/variants/${variantAId}`, { data: { traffic_allocation_bp: 6000 } }), 'set variant A split');
  await json(
    await request.put(`${LG_API}/variants/${variantBId}`, { data: { traffic_allocation_bp: 4000, frame_overrides_json: { theme_id: bold.id } } }),
    'set variant B split+theme',
  );

  const homeFunnel = await json<FunnelCreated>(
    await request.post(`${LG_API}/quotes/${quote.public_id}/funnels`, { data: { funnel_name: `Home Insurance ${uniq}` } }),
    'create home insurance funnel',
  );
  await json(await request.put(`${LG_API}/funnels/${homeFunnel.public_id}/theme`, { data: { theme_json: { theme_id: navy.id } } }), 'set home funnel theme');

  return { navy, bold, minimal, autoFunnelId, homeFunnelId: homeFunnel.public_id, variantAId, variantBId };
}

function cardLocator(page: Page, themeId: string) {
  return page.locator(`a[href*="theme=${themeId}"]`).first();
}

test.describe.serial('LeadGen Themes manager — §10 browser flows (Phase D)', () => {
  test('LEFT list: one card per theme with computed LIVE·A / A/B·B / DRAFT badges (§10.3, Appendix A)', async ({ page }) => {
    const fx = await seedThemesFixture(page.request);

    await page.goto(`/admin/leadgen/themes?theme=${fx.navy.id}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Themes', { exact: true })).toBeVisible();
    await expect(page.getByText('one look & feel per funnel · A/B-testable in a quote')).toBeVisible();
    // the button, not getByText('New theme') — M2 below legitimately creates
    // a theme RECORD literally named "New theme", which would otherwise make
    // this assertion ambiguous (button + card both carry that text).
    await expect(page.locator('#tm-new-theme')).toBeVisible();
    await expect(page.getByText('Your themes')).toBeVisible();

    const navyCard = cardLocator(page, fx.navy.id);
    const boldCard = cardLocator(page, fx.bold.id);
    const minimalCard = cardLocator(page, fx.minimal.id);
    await expect(navyCard).toContainText('LIVE · A');
    await expect(boldCard).toContainText('A/B · B');
    await expect(minimalCard).toContainText('DRAFT');
    await expect(page.getByText('A/B testing:')).toBeVisible();

    await page.screenshot({ path: `${SHOT_DIR}/d1-list-badges.png` });
  });

  test('selecting a card re-skins the CENTER editor (themeUse line + Colors/Typography/Controls) and the RIGHT A/B panel', async ({ page }) => {
    const fx = await seedThemesFixture(page.request);
    await page.goto(`/admin/leadgen/themes?theme=${fx.navy.id}`, { waitUntil: 'domcontentloaded' });

    await expect(page.getByText(`Assigned to Auto Insurance ${uniq} · Variant A`, { exact: false })).toBeVisible();
    await expect(page.getByText('Colors — semantic roles')).toBeVisible();
    await expect(page.getByText('Buttons & inputs — the shared size language')).toBeVisible();
    await expect(page.locator('#tm-headline-font')).toHaveValue('Newsreader');

    // §10.5: "In this quote" A/B box shows BOTH sibling variants (the SAME
    // funnel's full variant set), live 60%/40%, before any card click.
    await expect(page.getByText('In this quote')).toBeVisible();
    await expect(page.getByText(`Auto Insurance ${uniq}`, { exact: true })).toBeVisible();
    await expect(page.getByText('A/B test · Theme')).toBeVisible();
    await expect(page.getByText('60%')).toBeVisible();
    await expect(page.getByText('40%')).toBeVisible();
    await expect(page.getByText('Other funnels using this theme')).toBeVisible();
    await expect(page.getByText(`Home Insurance ${uniq} · Variant A`)).toBeVisible();

    // click the Bold Yellow card (full navigation, per the ES5-guardrail
    // "plain fetch without a complex island" steer) -> CENTER + RIGHT re-skin
    const boldCard = cardLocator(page, fx.bold.id);
    await boldCard.click();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByText(`Assigned to Auto Insurance ${uniq} · Variant B · A/B test`)).toBeVisible();
    // same funnel's A/B box still shows both variants...
    await expect(page.getByText('60%')).toBeVisible();
    await expect(page.getByText('40%')).toBeVisible();
    // ...but Bold Yellow has no OTHER funnel usage -> "No others yet."
    await expect(page.getByText('No others yet.')).toBeVisible();
    await expect(page.getByText(`Home Insurance ${uniq} · Variant A`)).toHaveCount(0);

    await page.screenshot({ path: `${SHOT_DIR}/d2-center-right-reskin.png` });
  });

  test('an editor edit PATCHes the theme and PERSISTS across reload (§10.4 Buttons & inputs)', async ({ page }) => {
    const fx = await seedThemesFixture(page.request);
    await page.goto(`/admin/leadgen/themes?theme=${fx.navy.id}`, { waitUntil: 'domcontentloaded' });

    const large = page.locator('[data-tm-seg][data-group="button_size"][data-value="l"]');
    await expect(large).toBeVisible();

    const [patchRes] = await Promise.all([
      page.waitForResponse((res) => res.url().includes(`/api/admin/leadgen/themes/${fx.navy.id}`) && res.request().method() === 'PATCH'),
      large.click(),
    ]);
    expect(patchRes.status(), 'PATCH button_size=l').toBe(200);
    await page.waitForLoadState('domcontentloaded'); // the island reloads on success

    // Re-fetch the record directly to prove the write round-tripped (not just
    // a client-side visual flip that a reload would have reverted).
    const record = await json<{ item: { controls: { button_size: string } } }>(
      await page.request.get(`${LG_API}/themes/${fx.navy.id}`),
      'get theme after patch',
    );
    expect(record.item.controls.button_size).toBe('l');

    // and the reloaded page reflects it — the "L" segment now carries the
    // active (navy-text, white-bg) style, not the muted inactive one.
    const style = await page.locator('[data-tm-seg][data-group="button_size"][data-value="l"]').getAttribute('style');
    expect(style).toContain('#1B3A5C');
  });

  test('editing a hex value under Advanced round-trips (the ONLY place hex appears, §10.4)', async ({ page }) => {
    const fx = await seedThemesFixture(page.request);
    await page.goto(`/admin/leadgen/themes?theme=${fx.minimal.id}`, { waitUntil: 'domcontentloaded' });

    await expect(page.locator('#tm-adv-body')).toBeHidden();
    await page.locator('#tm-adv-toggle').click();
    await expect(page.locator('#tm-adv-body')).toBeVisible();

    const successHex = page.locator('[data-tm-hex][data-role="success"]');
    await successHex.fill('#00AA55');
    const [patchRes] = await Promise.all([
      page.waitForResponse((res) => res.url().includes(`/api/admin/leadgen/themes/${fx.minimal.id}`) && res.request().method() === 'PATCH'),
      successHex.blur(),
    ]);
    expect(patchRes.status(), 'PATCH roles.success').toBe(200);
    await page.waitForLoadState('domcontentloaded');

    const record = await json<{ item: { roles: { success: string } } }>(await page.request.get(`${LG_API}/themes/${fx.minimal.id}`), 'get theme after hex patch');
    expect(record.item.roles.success.toUpperCase()).toBe('#00AA55');

    await page.screenshot({ path: `${SHOT_DIR}/d3-advanced-hex-edit.png` });
  });

  test('fixture-value rule: re-pointing the split away from 60/40 changes the rendered percentages (proves LIVE, not hardcoded)', async ({ page }) => {
    const fx = await seedThemesFixture(page.request);
    await page.request.put(`${LG_API}/variants/${fx.variantAId}`, { data: { traffic_allocation_bp: 7500 } });
    await page.request.put(`${LG_API}/variants/${fx.variantBId}`, { data: { traffic_allocation_bp: 2500 } });

    await page.goto(`/admin/leadgen/themes?theme=${fx.navy.id}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('75%')).toBeVisible();
    await expect(page.getByText('25%')).toBeVisible();
    await expect(page.getByText('60%')).toHaveCount(0);
    await expect(page.getByText('40%')).toHaveCount(0);
  });

  test('an unused theme shows DRAFT + "Not assigned to a funnel yet" + "No others yet." (no crash)', async ({ page }) => {
    const fx = await seedThemesFixture(page.request);
    await page.goto(`/admin/leadgen/themes?theme=${fx.minimal.id}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Not assigned to a funnel yet')).toBeVisible();
    await expect(page.getByText('No others yet.')).toBeVisible();
    await expect(cardLocator(page, fx.minimal.id)).toContainText('DRAFT');
  });

  test('"Back to section" nav: ?from=<sectionPublicId> targets that section\'s editor', async ({ page }) => {
    const fx = await seedThemesFixture(page.request);
    const section = await json<{ public_id: string }>(
      await page.request.post(`${LG_API}/sections`, {
        data: {
          section_name: `TM Back Nav ${uniq}`,
          activity: `tm-back-${uniq}`,
          vertical: `tm-back-v-${uniq}`,
          headline_text: 'Back nav fixture',
          continue_mode: 'button',
          status: 'active',
          content_json: {
            components: [
              { type: 'TwoButtonYesNo', question_id: 'q1', question_key: 'q1_key', internal_field: 'q1_field', answer_type: 'boolean' },
            ],
          },
        },
      }),
      'create section for back-nav',
    );

    await page.goto(`/admin/leadgen/themes?from=${section.public_id}&theme=${fx.navy.id}`, { waitUntil: 'domcontentloaded' });
    const backLink = page.getByText('Back to section');
    await expect(backLink).toHaveAttribute('href', `/admin/leadgen/sections/${section.public_id}/edit`);
    await backLink.click();
    await page.waitForLoadState('domcontentloaded');
    await expect(page).toHaveURL(new RegExp(`/admin/leadgen/sections/${section.public_id}/edit$`));
  });

  test('M1: "Manage theme →" round-trip from a REAL section now RETURNS to that section (both fixed hrefs)', async ({ page }) => {
    const fx = await seedThemesFixture(page.request);
    const section = await json<{ public_id: string }>(
      await page.request.post(`${LG_API}/sections`, {
        data: {
          section_name: `TM Manage RT ${uniq}`,
          activity: `tm-rt-${uniq}`,
          vertical: `tm-rt-v-${uniq}`,
          headline_text: 'Manage theme round trip',
          continue_mode: 'button',
          status: 'active',
          content_json: {
            components: [
              { type: 'TwoButtonYesNo', question_id: 'q1', question_key: 'q1_key', internal_field: 'q1_field', answer_type: 'boolean' },
            ],
          },
        },
      }),
      'create section for manage-theme round trip',
    );
    const expectedHref = `/admin/leadgen/themes?from=${section.public_id}`;

    await page.goto(`/admin/leadgen/sections/${section.public_id}/edit`, { waitUntil: 'domcontentloaded' });

    // drawer link (ui-section-studio.ts renderStudioDrawer, ~:2222) — visible
    // by default (the drawer's "preview" tab is active on load).
    const drawerManageLink = page.locator('[data-studio-manage-theme-link]');
    await expect(drawerManageLink).toHaveAttribute('href', expectedHref);
    await expect(drawerManageLink).toHaveText('Manage theme →');

    // Style-tab link (ui-section-studio.ts renderStudioInspector, ~:1938) —
    // only rendered once a FIELD is selected and the Style tab is active;
    // a static href check (the drawer link below drives the full click
    // round-trip so both fixed hrefs are proven end-to-end / at-rest).
    await page.frameLocator('#lg-studio-canvas-frame').locator('#lg-studio-canvas-render [data-component-type="TwoButtonYesNo"]').click();
    await page.locator('[data-studio-inspector-tab="style"]').click();
    const styleManageLink = page.locator('[data-open-manage-theme]');
    await expect(styleManageLink).toHaveAttribute('href', expectedHref);
    await expect(styleManageLink).toHaveText('Manage theme →');

    // R5 D6 (register S4-A11, golden :627-721): "Manage theme →" now opens
    // the Themes manager as an IN-PAGE OVERLAY (a real click — the link's
    // own JS handler intercepts navigation and calls openThemesOverlay(),
    // ui-section-studio.ts:9267) instead of navigating away. The hrefs
    // asserted above are UNCHANGED (openThemesOverlay reads state.public_id
    // independently) — only the click BEHAVIOR changed. "Returns to that
    // section" is now trivially true: the section editor is never left.
    const sectionEditorUrl = page.url();
    await drawerManageLink.click();
    const overlay = page.locator('[data-themes-overlay]');
    await expect(overlay).toBeVisible();
    const expectedEmbedSrc = `/admin/leadgen/themes?embed=1&from=${section.public_id}`;
    await expect(page.locator('#lg-themes-overlay-frame')).toHaveAttribute('src', expectedEmbedSrc);
    expect(page.url(), 'the overlay never navigates the top-level page away from the section editor').toBe(sectionEditorUrl);

    // Round-trip SUBSTANCE preserved: the theme list renders INSIDE the
    // overlay, carrying the same from=<id> the pre-overlay hrefs asserted.
    const overlayFrame = page.frameLocator('#lg-themes-overlay-frame');
    await expect(overlayFrame.getByText('Themes', { exact: true })).toBeVisible();
    await expect(overlayFrame.getByText('Your themes')).toBeVisible();
    await expect(overlayFrame.locator(`a[href*="theme=${fx.navy.id}"]`).first()).toBeVisible();

    // ...and M1's fix, in its new shape: "Back to section" (inside the
    // overlay) CLOSES it via postMessage (TM_EMBED_SCRIPT, a real click —
    // no state injection) instead of navigating — "returns to that
    // section" because the section editor was never navigated away from.
    const backLink = overlayFrame.getByText('Back to section');
    await expect(backLink).toBeVisible();
    await backLink.click();
    await expect(overlay).toBeHidden();
    expect(page.url(), 'still on the section editor after closing the overlay').toBe(sectionEditorUrl);

    await page.screenshot({ path: `${SHOT_DIR}/d4-manage-theme-roundtrip.png` });
  });

  test('M2: "New theme" click -> POST -> redirect to ?theme=<newId> -> the new theme renders selected', async ({ page }) => {
    // The POST API + payload shape are already proven (unit tests +
    // themes-handlers.ts's own suite) — this covers the click->redirect glue
    // the ES5 island (wireNewTheme) owns. The new theme's id is read back
    // from the POST-redirect URL (NOT the POST response body): the island's
    // `window.location.href = ...` reassignment fires immediately inside the
    // same fetch .then(), which tears down the response's CDP resource
    // before Playwright can reliably read its body — a known race, not a
    // product bug. Reading the id from the LANDED url sidesteps it and is
    // exactly the same signal the coordinator asked to prove either way.
    await page.goto('/admin/leadgen/themes', { waitUntil: 'domcontentloaded' });

    const [postRes] = await Promise.all([
      page.waitForResponse((res) => res.url().endsWith('/api/admin/leadgen/themes') && res.request().method() === 'POST'),
      page.locator('#tm-new-theme').click(),
    ]);
    expect(postRes.status(), 'POST create New theme').toBe(201);

    await page.waitForURL(/[?&]theme=/, { waitUntil: 'domcontentloaded' }); // the click -> POST -> redirect glue under test
    const newId = new URL(page.url()).searchParams.get('theme');
    expect(newId, 'redirects to ?theme=<newId>').toBeTruthy();

    const newCard = cardLocator(page, newId as string);
    await expect(newCard).toBeVisible();
    await expect(newCard).toContainText('New theme');
    await expect(newCard).toContainText('DRAFT'); // brand new, unused by any funnel/variant
    const style = await newCard.getAttribute('style');
    expect(style, 'the new theme lands SELECTED (active card border)').toContain('#1B3A5C');

    await expect(page.locator('#tm-headline-font')).toHaveValue('Newsreader'); // the seeded default persisted

    const record = await json<{ item: { name: string } }>(await page.request.get(`${LG_API}/themes/${newId}`), 'get new theme');
    expect(record.item.name).toBe('New theme');
  });

  test('M3: Appendix-A strings rendered but previously unasserted (footer note, "for developers", Advanced intro)', async ({ page }) => {
    const fx = await seedThemesFixture(page.request);
    await page.goto(`/admin/leadgen/themes?theme=${fx.navy.id}`, { waitUntil: 'domcontentloaded' });

    // LEFT list footer note (full sentence, spans a <b> boundary).
    await expect(
      page.getByText('A/B testing: assign different themes to two variants of the same funnel to see which converts better.'),
    ).toBeVisible();

    // Advanced header sub-label — always visible, collapsed or not.
    await expect(page.getByText('for developers', { exact: true })).toBeVisible();

    // Advanced BODY intro sentence — only visible once expanded.
    await expect(page.locator('#tm-adv-body')).toBeHidden();
    await page.locator('#tm-adv-toggle').click();
    await expect(page.locator('#tm-adv-body')).toBeVisible();
    await expect(page.getByText('For developers. Renaming these can unlink Offer mappings.')).toBeVisible();
  });

  test('an unknown ?theme= id degrades gracefully to SOME real selection, never a crash', async ({ page }) => {
    // NOTE: this spec's tests share one wrangler-dev instance (and thus one
    // KV store) across the whole .serial run, so "falls back to the FIRST
    // theme" is not independently provable here (several earlier tests have
    // already appended their own fixture themes ahead of this one) — that
    // precise, order-sensitive claim is covered in isolation by
    // test/leadgen-theme-manager-ui.test.ts's fresh-per-test harness. This
    // browser-level check proves the weaker, still load-bearing claim: an
    // unrecognised ?theme= id never 500s and still lands on a real,
    // structurally-complete manager page with SOME theme selected.
    await seedThemesFixture(page.request);
    const res = await page.request.get('/admin/leadgen/themes?theme=thm_does_not_exist_at_all');
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toContain('Your themes');
    expect(body).toContain('Colors — semantic roles');
    expect(body).toMatch(/Assigned to .+ · Variant \S|Not assigned to a funnel yet/);
  });
});
