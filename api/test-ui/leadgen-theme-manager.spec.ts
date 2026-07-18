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
// CONDUCTOR ROUND (gate1c-unmasked defect; register note: themes have
// CREATE/UPDATE but NO DELETE endpoint — contract §10.1 explicitly excluded
// it, an open product gap, see the mission report): this file used to mint
// a FRESH `Date.now()`-suffixed theme/quote/funnel trio on EVERY ONE of its
// own 11 tests (seedThemesFixture called per-test, not once) — with no
// delete endpoint to clean any of it up, 11 tests x however many file-runs
// meant the "YOUR THEMES" list only ever grew, across the whole program's
// lifetime, never shrank. Converted to a SINGLE, file-level, FIXED-NAME
// idempotent fixture (ensureThemesFixture, called once in beforeAll):
// "Navy"/"Bold Yellow"/"Minimal" are found-by-exact-name and RESET (PATCH)
// if they already exist, created fresh only the very first time — the SAME
// 3 records are reused forever after, in any composition, on any machine.
// The quote/funnel/variant tree is idempotent the same way (found by exact
// quote_name, its funnels detail re-fetched, re-PATCHed/re-PUT to the exact
// desired split/theme state every time) so repeated runs never accumulate
// duplicates. leadgen-v31-gate1c-baselines.spec.ts's own beforeAll seeds the
// IDENTICAL "Navy"/"Bold Yellow"/"Minimal" names (see its own matching
// comment) so whichever file runs first creates them and the second one
// just reuses them — the themes-list CONTENT (name/colours/typography/
// controls) converges to the same superset regardless of composition order.
//
// That convergence is necessary but turned out NOT sufficient for gate1c's
// own state-6/7 screenshots to be composition-invariant: a SEPARATE axis —
// which funnel/variant currently references a theme_id, hence its
// DRAFT/LIVE·A/A/B·B badge and the whole right-hand detail panel — lives on
// the funnel/variant records THIS file's own ensureThemesFixture assigns
// (Navy -> Auto Insurance·Variant A + Home Insurance·Variant A; Bold Yellow
// -> Auto Insurance·Variant B), and no per-file theme-naming convention can
// make that assignment state invariant too without one file reaching into
// another's fixture data. Measured directly (conductor composition proof:
// this file's tests, then gate1c-baselines, same D1/KV session): the Navy
// state's pixel delta was 1.87% — ~19x the 0.1% gate budget — root-caused to
// exactly this (Navy showing "Assigned to Auto Insurance · Variant A" +
// a live "In this quote" A/B panel instead of "Not assigned to a funnel
// yet" / "No others yet."). Full diagnosis + the resolution (gate1c's
// states 6/7 are now solo-only BY DESIGN, self-detecting and skipping
// loudly rather than reporting a false red) lives in
// leadgen-v31-gate1c-baselines.spec.ts's own file header — this file's
// fixture (assigning Navy/Bold Yellow to real funnels) is exactly the
// trigger those two tests detect and skip on.
//
// M2's "+ New theme" click below used to mint a genuinely NEW, permanently-
// growing theme record on every run of this file (no name to de-dup on —
// the product always calls it literally "New theme" — and no DELETE
// endpoint to clean any of them up; see the register note above). Converted
// (conductor ruling) to a page.route-MOCKED POST: the click -> fetch ->
// parse-response -> redirect GLUE the ES5 island (wireNewTheme) owns is
// still exercised for real — a genuine click fires a genuine fetch, which
// the route handler intercepts and fulfils with a canned body — but no
// record is ever actually written to KV, so this test now creates zero
// persistent state. Honesty boundary: the REAL POST /themes create path
// (body validation, id-minting, KV write) is exercised for real, without
// mocking, elsewhere — themes-handlers.ts's own unit suite, and this very
// file's ensureTheme (a real POST the very first time each fixture theme is
// created, a real PATCH on every run thereafter).

import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

const SHOT_DIR = 'test-artifacts/leadgen-theme-manager';
const LG_API = '/api/admin/leadgen';

// Fixed, idempotent fixture identity. The 3 THEME names MUST MATCH
// leadgen-v31-gate1c-baselines.spec.ts's own copy of these exact same
// strings (see that file's matching comment) — that is the whole point:
// both files' "ensure this theme exists" converges on the SAME 3 records
// regardless of which one runs first. The quote/funnel names are private to
// this file (gate1c never creates a quote), so they only need to be
// internally consistent.
const NAVY_NAME = 'Navy';
const BOLD_NAME = 'Bold Yellow';
const MINIMAL_NAME = 'Minimal';
const QUOTE_NAME = 'TM Fixture Quote';
const ACTIVITY = 'tm-fixture';
const AUTO_FUNNEL_NAME = 'TM Fixture Auto Insurance';
const HOME_FUNNEL_NAME = 'TM Fixture Home Insurance';
const BACK_NAV_SECTION_NAME = 'TM Back Nav Fixture';
const MANAGE_RT_SECTION_NAME = 'TM Manage RT Fixture';

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
interface FunnelVariantApi {
  public_id: string;
  variant_label: string;
}
interface QuoteFunnelApi {
  public_id: string;
  funnel_name: string;
  variants: FunnelVariantApi[];
}
interface QuoteDetailApi {
  public_id: string;
  quote_name: string;
  funnels: QuoteFunnelApi[];
}
interface QuoteListItemApi {
  public_id: string;
  quote_name: string;
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

// Idempotent: find an EXISTING theme by exact name (themes have no unique
// index or delete endpoint, so a name match is the only handle available —
// see the file header's register note) and reset it via PATCH to the
// desired shape; only POSTs a new record the very first time it has never
// existed at all.
async function ensureTheme(
  request: APIRequestContext,
  name: string,
  brand: string,
  accent: string,
  pageBg: string,
  card: string,
  text: string,
): Promise<ThemeRecordApi> {
  const list = await json<{ items: ThemeRecordApi[] }>(await request.get(`${LG_API}/themes`), `list themes (finding ${name})`);
  const existing = list.items.find((t) => t.name === name);
  const body = themeBody(name, brand, accent, pageBg, card, text);
  if (existing) {
    return (await json<ThemeCreated>(await request.patch(`${LG_API}/themes/${existing.id}`, { data: body }), `reset existing theme (${name})`)).item;
  }
  return (await json<ThemeCreated>(await request.post(`${LG_API}/themes`, { data: body }), `create theme (${name})`)).item;
}

// §10.3 fixture: Navy -> Auto Insurance/Variant A (control, 60%) AND Home
// Insurance/Variant A; Bold Yellow -> Auto Insurance/Variant B (A/B, 40%);
// Minimal -> unused (DRAFT). Ground truth: golden lines 646/650/654 + §10.4's
// thm_navy example. Fully idempotent (file header) — safe to call any
// number of times, in any composition with any other spec file: finds and
// reuses existing records by exact name, always re-applies the theme/split
// PUTs so a prior run's mutation (e.g. the fixture-value-rule test's 75/25
// re-point) never leaks into a later one.
async function ensureThemesFixture(request: APIRequestContext): Promise<{
  navy: ThemeRecordApi;
  bold: ThemeRecordApi;
  minimal: ThemeRecordApi;
  autoFunnelId: string;
  homeFunnelId: string;
  variantAId: string;
  variantBId: string;
}> {
  const navy = await ensureTheme(request, NAVY_NAME, '#1B3A5C', '#F5C518', '#F4F6F9', '#FFFFFF', '#1A1F36');
  const bold = await ensureTheme(request, BOLD_NAME, '#13233B', '#F5C518', '#FFF7DE', '#FFFFFF', '#14181F');
  const minimal = await ensureTheme(request, MINIMAL_NAME, '#232A34', '#6B7486', '#FFFFFF', '#F6F8FA', '#14181F');

  const quoteList = await json<{ items: QuoteListItemApi[] }>(
    await request.get(`${LG_API}/quotes?search=${encodeURIComponent(QUOTE_NAME)}`),
    'list quotes (finding fixture)',
  );
  const existingQuote = quoteList.items.find((q) => q.quote_name === QUOTE_NAME);

  let quotePublicId: string;
  let autoFunnelId: string;
  let variantAId: string;
  let variantBId: string | undefined;
  let homeFunnelId: string | undefined;

  if (existingQuote) {
    quotePublicId = existingQuote.public_id;
    const detail = await json<QuoteDetailApi>(await request.get(`${LG_API}/quotes/${quotePublicId}`), 'get existing fixture quote detail');
    const autoFunnel = detail.funnels.find((f) => f.funnel_name === AUTO_FUNNEL_NAME);
    if (!autoFunnel) {
      throw new Error(`fixture quote "${QUOTE_NAME}" exists but its "${AUTO_FUNNEL_NAME}" funnel is missing — inspect local state`);
    }
    autoFunnelId = autoFunnel.public_id;
    const variantA = autoFunnel.variants.find((v) => v.variant_label === 'A');
    if (!variantA) {
      throw new Error(`fixture funnel "${AUTO_FUNNEL_NAME}" exists but its control variant A is missing`);
    }
    variantAId = variantA.public_id;
    variantBId = autoFunnel.variants.find((v) => v.variant_label !== 'A')?.public_id;
    homeFunnelId = detail.funnels.find((f) => f.funnel_name === HOME_FUNNEL_NAME)?.public_id;
  } else {
    const quote = await json<QuoteDetailApi>(
      await request.post(`${LG_API}/quotes`, {
        data: { quote_name: QUOTE_NAME, activity: ACTIVITY, verticals: ['auto'], funnel_name: AUTO_FUNNEL_NAME },
      }),
      'create fixture quote',
    );
    quotePublicId = quote.public_id;
    autoFunnelId = quote.funnels[0]!.public_id;
    variantAId = quote.funnels[0]!.variants[0]!.public_id;
  }

  if (variantBId === undefined) {
    variantBId = (await json<FunnelVariantApi>(await request.post(`${LG_API}/funnels/${autoFunnelId}/variants`, { data: {} }), 'create variant B'))
      .public_id;
  }
  if (homeFunnelId === undefined) {
    homeFunnelId = (
      await json<{ public_id: string }>(
        await request.post(`${LG_API}/quotes/${quotePublicId}/funnels`, { data: { funnel_name: HOME_FUNNEL_NAME } }),
        'create home insurance funnel',
      )
    ).public_id;
  }

  await json(await request.put(`${LG_API}/funnels/${autoFunnelId}/theme`, { data: { theme_json: { theme_id: navy.id } } }), 'set funnel theme');
  await json(await request.put(`${LG_API}/variants/${variantAId}`, { data: { traffic_allocation_bp: 6000 } }), 'set variant A split');
  await json(
    await request.put(`${LG_API}/variants/${variantBId}`, { data: { traffic_allocation_bp: 4000, frame_overrides_json: { theme_id: bold.id } } }),
    'set variant B split+theme',
  );
  await json(await request.put(`${LG_API}/funnels/${homeFunnelId}/theme`, { data: { theme_json: { theme_id: navy.id } } }), 'set home funnel theme');

  return { navy, bold, minimal, autoFunnelId, homeFunnelId, variantAId, variantBId };
}

function cardLocator(page: Page, themeId: string) {
  return page.locator(`a[href*="theme=${themeId}"]`).first();
}

test.describe.serial('LeadGen Themes manager — §10 browser flows (Phase D)', () => {
  let fx: Awaited<ReturnType<typeof ensureThemesFixture>>;
  test.beforeAll(async ({ playwright }) => {
    const ctx = await playwright.request.newContext();
    fx = await ensureThemesFixture(ctx);
    await ctx.dispose();
  });

  test('LEFT list: one card per theme with computed LIVE·A / A/B·B / DRAFT badges (§10.3, Appendix A)', async ({ page }) => {
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
    await page.goto(`/admin/leadgen/themes?theme=${fx.navy.id}`, { waitUntil: 'domcontentloaded' });

    await expect(page.getByText(`Assigned to ${AUTO_FUNNEL_NAME} · Variant A`, { exact: false })).toBeVisible();
    await expect(page.getByText('Colors — semantic roles')).toBeVisible();
    await expect(page.getByText('Buttons & inputs — the shared size language')).toBeVisible();
    await expect(page.locator('#tm-headline-font')).toHaveValue('Newsreader');

    // §10.5: "In this quote" A/B box shows BOTH sibling variants (the SAME
    // funnel's full variant set), live 60%/40%, before any card click.
    await expect(page.getByText('In this quote')).toBeVisible();
    await expect(page.getByText(AUTO_FUNNEL_NAME, { exact: true })).toBeVisible();
    await expect(page.getByText('A/B test · Theme')).toBeVisible();
    await expect(page.getByText('60%')).toBeVisible();
    await expect(page.getByText('40%')).toBeVisible();
    await expect(page.getByText('Other funnels using this theme')).toBeVisible();
    await expect(page.getByText(`${HOME_FUNNEL_NAME} · Variant A`)).toBeVisible();

    // click the Bold Yellow card (full navigation, per the ES5-guardrail
    // "plain fetch without a complex island" steer) -> CENTER + RIGHT re-skin
    const boldCard = cardLocator(page, fx.bold.id);
    await boldCard.click();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByText(`Assigned to ${AUTO_FUNNEL_NAME} · Variant B · A/B test`)).toBeVisible();
    // same funnel's A/B box still shows both variants...
    await expect(page.getByText('60%')).toBeVisible();
    await expect(page.getByText('40%')).toBeVisible();
    // ...but Bold Yellow has no OTHER funnel usage -> "No others yet."
    await expect(page.getByText('No others yet.')).toBeVisible();
    await expect(page.getByText(`${HOME_FUNNEL_NAME} · Variant A`)).toHaveCount(0);

    await page.screenshot({ path: `${SHOT_DIR}/d2-center-right-reskin.png` });
  });

  test('an editor edit PATCHes the theme and PERSISTS across reload (§10.4 Buttons & inputs)', async ({ page }) => {
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
    await page.request.put(`${LG_API}/variants/${fx.variantAId}`, { data: { traffic_allocation_bp: 7500 } });
    await page.request.put(`${LG_API}/variants/${fx.variantBId}`, { data: { traffic_allocation_bp: 2500 } });

    await page.goto(`/admin/leadgen/themes?theme=${fx.navy.id}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('75%')).toBeVisible();
    await expect(page.getByText('25%')).toBeVisible();
    await expect(page.getByText('60%')).toHaveCount(0);
    await expect(page.getByText('40%')).toHaveCount(0);
  });

  test('an unused theme shows DRAFT + "Not assigned to a funnel yet" + "No others yet." (no crash)', async ({ page }) => {
    await page.goto(`/admin/leadgen/themes?theme=${fx.minimal.id}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Not assigned to a funnel yet')).toBeVisible();
    await expect(page.getByText('No others yet.')).toBeVisible();
    await expect(cardLocator(page, fx.minimal.id)).toContainText('DRAFT');
  });

  test('"Back to section" nav: ?from=<sectionPublicId> targets that section\'s editor', async ({ page }) => {
    const section = await json<{ public_id: string }>(
      await page.request.post(`${LG_API}/sections`, {
        data: {
          section_name: BACK_NAV_SECTION_NAME,
          activity: 'tm-back-fixture',
          vertical: 'tm-back-v-fixture',
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
    const section = await json<{ public_id: string }>(
      await page.request.post(`${LG_API}/sections`, {
        data: {
          section_name: MANAGE_RT_SECTION_NAME,
          activity: 'tm-rt-fixture',
          vertical: 'tm-rt-v-fixture',
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

  test('M2: "New theme" click -> POST (mocked, see file header) -> redirect to ?theme=<id> -> the glue fired', async ({ page }) => {
    // The POST API + payload shape are already proven FOR REAL, without
    // mocking, elsewhere (themes-handlers.ts's own unit suite, and this
    // file's own ensureTheme's real create-on-first-use calls above) — this
    // test covers ONLY the click->redirect GLUE the ES5 island
    // (wireNewTheme) owns. Mocked (page.route) per conductor ruling: this
    // was the one place in the whole program that clicked "+ New theme" for
    // real, and a real click here mints a theme record the product can
    // never delete (no DELETE endpoint — see the register note above) — 11
    // tests x every file-run meant the "YOUR THEMES" list only ever grew.
    // The mock removes that growth vector entirely: the button click, the
    // fetch it fires, and the client's handling of the response are all
    // still exercised for real; only the SERVER's create is replaced with a
    // canned 201 so no KV write ever happens.
    const MOCK_ID = 'thm_mock_m2_new_theme';
    await page.route('**/api/admin/leadgen/themes', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          item: {
            id: MOCK_ID,
            name: 'New theme',
            roles: { brand_primary: '#1B3A5C', accent: '#2E6BB0', page_bg: '#FFFFFF', card: '#FFFFFF', text: '#1A1F36', success: '#0E7C3A', error: '#B23A2C' },
          },
        }),
      });
    });

    await page.goto('/admin/leadgen/themes', { waitUntil: 'domcontentloaded' });

    const [postRes] = await Promise.all([
      page.waitForResponse((res) => res.url().endsWith('/api/admin/leadgen/themes') && res.request().method() === 'POST'),
      page.locator('#tm-new-theme').click(),
    ]);
    expect(postRes.status(), 'POST create New theme (mocked)').toBe(201);

    // wireNewTheme reads data.item.id from the (mocked) response body and
    // navigates to /admin/leadgen/themes?theme=<that id> — the redirect
    // landing on the MOCKED id is exactly the glue under test.
    await page.waitForURL(/[?&]theme=/, { waitUntil: 'domcontentloaded' });
    const newId = new URL(page.url()).searchParams.get('theme');
    expect(newId, "redirects using the mocked response's item.id").toBe(MOCK_ID);

    // Honesty boundary (not asserted past this point): no real "New theme"
    // record was ever written to KV, so the landed page necessarily falls
    // back to SOME real selection for this unrecognised id — precisely the
    // already-covered "an unknown ?theme= id degrades gracefully" behaviour
    // below, not a new claim. Re-asserting "New theme"/DRAFT/selected-style/
    // persisted-font here would be asserting against a record that was
    // deliberately never created; that create-then-render path is proven
    // for real by ensureTheme's own POST + this describe's OTHER tests
    // (which select fx.navy/fx.bold/fx.minimal — all real, PATCH-reset
    // records — and assert their rendered content).
    await expect(page.getByText('Your themes')).toBeVisible();
  });

  test('M3: Appendix-A strings rendered but previously unasserted (footer note, "for developers", Advanced intro)', async ({ page }) => {
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
    // theme" is not independently provable here (the fixture trio plus M2's
    // own "New theme" have already appended ahead of this one) — that
    // precise, order-sensitive claim is covered in isolation by
    // test/leadgen-theme-manager-ui.test.ts's fresh-per-test harness. This
    // browser-level check proves the weaker, still load-bearing claim: an
    // unrecognised ?theme= id never 500s and still lands on a real,
    // structurally-complete manager page with SOME theme selected.
    const res = await page.request.get('/admin/leadgen/themes?theme=thm_does_not_exist_at_all');
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toContain('Your themes');
    expect(body).toContain('Colors — semantic roles');
    expect(body).toMatch(/Assigned to .+ · Variant \S|Not assigned to a funnel yet/);
  });
});
