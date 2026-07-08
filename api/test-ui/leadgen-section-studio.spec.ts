// LeadGen fix-contract v2.4 Phase 4 Slice D2 — the §8.12 SECTION-STUDIO
// browser flows (08 §8.2 E1/E9 · §8.7 E2 · §8.9+09 §9.1 events panel · 05
// §5.2 R5 integration). Every scenario drives the REAL studio pages in a REAL
// browser against the wrangler-dev webServer — no HTML string checks:
//
//   ① Activity dropdown SOURCED FROM OFFERS (two seeded activities appear);
//     Vertical dropdown FILTERED by the selected Activity (switching
//     activities swaps the vertical option set and resets the selection).
//   ② E9 empty state: a Section whose saved pair matches ZERO active Offers
//     renders the exact "No active Offers match Activity '<a>' + Vertical
//     '<v>'." copy with [Open Offers] + [Change Activity/Vertical] — never a
//     silent empty list.
//   ③ Map answers to TWO Offers via PICKERS ONLY (path select + question
//     dropdown; no typed ids/paths): per-row status flips to complete, the
//     top-bar badge live-updates to "Mapping 2/2 Offers complete", the save
//     round-trips and the fresh SSR page re-derives the same verdict.
//   ④ Create-question-for-field: the boolean schema field spawns a pre-bound
//     TwoButtonYesNo on the canvas with the path-derived internal_field and
//     an immediately-complete mapping edge.
//   ⑤ R5: quote ACTIVATION preflight blocks on the missing required mapping
//     (blocked panel + missing_required_provider_fields card) and its "Open
//     Section Mapping" fix link lands in THIS studio with the mapping drawer
//     tab open (#mapping hash).
//   ⑥ §8.9/§9.1 events panel: the preview iframe boots the REAL runtime
//     bundle in preview mode — the boot beacons (quote_view/section_view)
//     arrive over postMessage, and clicking an answer INSIDE the preview
//     appends the answer event. Analytics-preview sim = live.
//
// Seeding rides the REAL admin HTTP APIs only (leadgen-offers-mgmt.spec.ts
// convention; no direct DB writes). Runs against the playwright.config.ts
// webServer (wrangler dev on :8787 with DEV_BYPASS_AUTH:true +
// ADMIN_HOST:127.0.0.1). Local D1 must be migrated + seeded once:
// `rm -rf .wrangler/state/v3/d1 && npm run db:migrate:local && npm run seed:local`.
//
// Screenshots (1280×800) land in test-artifacts/leadgen-section-studio/.

import { test, expect, type APIRequestContext } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 800 } });

const SHOT_DIR = 'test-artifacts/leadgen-section-studio';
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

interface Created {
  id: number;
  public_id: string;
}

interface SchemaFieldSeed {
  path: string;
  type: string;
  required?: boolean;
  internal_field?: string;
  valid_values?: Array<string | number | boolean>;
}

// A STATIC offer + (optionally) an ACTIVE payload schema whose answer-source
// nodes feed the §8.7 mapping grid — all through the real §10.1/§11.8 APIs.
async function createStudioOffer(
  request: APIRequestContext,
  name: string,
  activity: string,
  vertical: string,
  fields: SchemaFieldSeed[],
): Promise<Created> {
  const offer = await json<Created>(
    await request.post(`${LG_API}/offers`, {
      data: {
        offer_name: name,
        provider: 'studioprov',
        activity,
        vertical,
        conversion_tracking_method: 's2s_postback',
        offer_type: 'cpc',
        placements: [`pl-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`],
        calls_provider_api: false,
        bid_source: 'static',
        cap_enabled: false,
      },
    }),
    `studio offer create (${name})`,
  );
  if (fields.length > 0) {
    const children: Array<Record<string, unknown>> = fields.map((f) => ({
      path: f.path,
      name: f.path.split('.').pop(),
      type: f.type,
      ...(f.required === true ? { required: true } : {}),
      source: 'answer',
      internal_field: f.internal_field ?? f.path.split('.').pop(),
      ...(f.valid_values !== undefined ? { valid_values: f.valid_values } : {}),
    }));
    await json(
      await request.post(`${LG_API}/offers/${offer.public_id}/payload-schemas`, {
        data: { schema_json: { version: 1, root: { type: 'object', children } } },
      }),
      `studio offer schema (${name})`,
    );
  }
  return offer;
}

// The two-question Section content the mapping flows bind from.
function mappableContent(): Record<string, unknown> {
  return {
    components: [
      {
        type: 'TwoButtonYesNo',
        question_id: 'q_ins',
        question_key: 'insured_q',
        internal_field: 'currently_insured',
        answer_type: 'boolean',
        props: { yesLabel: 'Yes', noLabel: 'No' },
      },
      {
        type: 'ZIPInputQuestion',
        question_id: 'q_zip',
        question_key: 'zip_q',
        internal_field: 'zip',
        answer_type: 'string',
        props: { placeholder: 'ZIP code' },
      },
    ],
  };
}

async function createStudioSection(
  request: APIRequestContext,
  name: string,
  activity: string,
  vertical: string,
  over: Record<string, unknown> = {},
): Promise<Created> {
  return json<Created>(
    await request.post(`${LG_API}/sections`, {
      data: {
        section_name: name,
        activity,
        vertical,
        headline_text: 'Are you currently insured?',
        continue_mode: 'button',
        status: 'active',
        content_json: mappableContent(),
        ...over,
      },
    }),
    `studio section create (${name})`,
  );
}

// Isolated vocabulary per run — the dropdown-sourcing assertions must not
// collide with seed data or parallel suites.
const ACT_A = `studio-act-${uniq}`;
const VERT_A = `sv-life-${uniq}`;
const ACT_B = `studio-quiz-${uniq}`;
const VERT_B = `qv-psychic-${uniq}`;

test.describe.serial('LeadGen Section Studio — §8.12 browser flows (E1, E2, E9, R5, §9.1)', () => {
  test('① Activity dropdown sourced from Offers; Vertical filtered by the selected Activity (reset on switch)', async ({ page }) => {
    await createStudioOffer(page.request, `Studio Src A ${uniq}`, ACT_A, VERT_A, []);
    await createStudioOffer(page.request, `Studio Src B ${uniq}`, ACT_B, VERT_B, []);

    await page.goto('/admin/leadgen/sections/new', { waitUntil: 'domcontentloaded' });
    const activity = page.locator('#lg-section-activity');
    const vertical = page.locator('#lg-section-vertical');
    // the island feeds Activity from GET /activities — BOTH seeded Offer
    // activities appear (E1: sourced from Offers, no free text input)
    await expect(activity.locator(`option[value="${ACT_A}"]`)).toHaveCount(1);
    await expect(activity.locator(`option[value="${ACT_B}"]`)).toHaveCount(1);
    expect(await page.locator('input#lg-section-activity').count(), 'activity is a SELECT, not free text').toBe(0);

    // picking activity A filters the vertical list to A's verticals only
    await activity.selectOption(ACT_A);
    await expect(vertical.locator(`option[value="${VERT_A}"]`)).toHaveCount(1);
    await expect(vertical.locator(`option[value="${VERT_B}"]`)).toHaveCount(0);
    await vertical.selectOption(VERT_A);

    // switching Activity RESETS Vertical and swaps the option set (§8.2)
    await activity.selectOption(ACT_B);
    await expect(vertical).toHaveValue('');
    await expect(vertical.locator(`option[value="${VERT_B}"]`)).toHaveCount(1);
    await expect(vertical.locator(`option[value="${VERT_A}"]`)).toHaveCount(0);
    await page.screenshot({ path: `${SHOT_DIR}/01-activity-vertical-dropdowns.png` });
  });

  test('② E9 empty state: zero matching Offers renders the exact copy + [Open Offers] [Change Activity/Vertical]', async ({ page }) => {
    const emptyVert = `no-offers-${uniq}`;
    const section = await createStudioSection(page.request, `E9 Section ${uniq}`, ACT_A, emptyVert);

    await page.goto(`/admin/leadgen/sections/${section.public_id}/edit`, { waitUntil: 'domcontentloaded' });
    await page.locator('[data-studio-drawer-tab="mapping"]').click();
    const empty = page.locator('[data-studio-offers-empty]');
    await expect(empty).toBeVisible();
    // the E9 verbatim pattern — never a silent empty list
    await expect(empty.locator('[data-studio-offers-empty-copy]')).toHaveText(
      `No active Offers match Activity '${ACT_A}' + Vertical '${emptyVert}'.`,
    );
    await expect(empty.locator('[data-studio-open-offers]')).toHaveAttribute('href', '/admin/leadgen/offers');
    await expect(empty.locator('[data-studio-change-pair]')).toHaveText('Change Activity/Vertical');
    // the affordance moves focus back to the pair controls
    await empty.locator('[data-studio-change-pair]').click();
    await expect(page.locator('#lg-section-activity')).toBeFocused();
    await page.screenshot({ path: `${SHOT_DIR}/02-e9-empty-state.png` });
  });

  test('③ map answers to TWO Offers via pickers only: statuses flip, the badge live-updates to 2/2 and survives the save round trip', async ({ page }) => {
    test.setTimeout(90_000);
    const offerA = await createStudioOffer(page.request, `Map Offer A ${uniq}`, ACT_A, VERT_A, [
      { path: 'data.insured', type: 'boolean', required: true, internal_field: 'currently_insured' },
      { path: 'data.zip', type: 'string', required: true, internal_field: 'zip' },
    ]);
    const offerB = await createStudioOffer(page.request, `Map Offer B ${uniq}`, ACT_A, VERT_A, [
      { path: 'lead.zip_code', type: 'string', required: true, internal_field: 'zip' },
    ]);
    const section = await createStudioSection(page.request, `Map Section ${uniq}`, ACT_A, VERT_A);

    await page.goto(`/admin/leadgen/sections/${section.public_id}/edit`, { waitUntil: 'domcontentloaded' });
    await page.locator('[data-studio-drawer-tab="mapping"]').click();

    // the §8.7 table lists BOTH matched offers with provider + schema v1 +
    // required counts — and no raw numeric ids anywhere on the surface
    const rowA = page.locator(`tr[data-studio-offer-row="${offerA.public_id}"]`);
    const rowB = page.locator(`tr[data-studio-offer-row="${offerB.public_id}"]`);
    await expect(rowA).toBeVisible();
    await expect(rowB).toBeVisible();
    await expect(rowA).toContainText('studioprov');
    await expect(rowA).toContainText('v1');
    await expect(rowA.locator('[data-offer-mapping-state]')).toHaveAttribute('data-offer-mapping-state', 'not_selected');

    // offer A: open the Map-fields grid and map BOTH schema fields via the
    // question dropdowns (pickers only — no typed paths)
    await rowA.getByRole('button', { name: 'Map fields' }).click();
    const grid = page.locator('[data-studio-map-grid]');
    await expect(grid).toBeVisible();
    // the path picker SHOWS type + required — never a free-text path input
    await expect(grid.locator('[data-map-row="data.insured"] select[data-map-path]')).toBeVisible();
    await expect(grid.locator('[data-map-row="data.insured"] option[value="data.insured"]').first()).toContainText('boolean');
    expect(await grid.locator('input[type="text"]').count(), 'no free-text inputs in the grid').toBe(0);
    await grid.locator('[data-map-row="data.insured"] select[data-map-question]').selectOption('currently_insured');
    await expect(grid.locator('[data-map-row="data.insured"] [data-map-state]')).toHaveAttribute('data-map-state', 'complete');
    await grid.locator('[data-map-row="data.zip"] select[data-map-question]').selectOption('zip');
    await expect(grid.locator('[data-map-row="data.zip"] [data-map-state]')).toHaveAttribute('data-map-state', 'complete');
    await expect(rowA.locator('[data-offer-mapping-state]')).toHaveAttribute('data-offer-mapping-state', 'complete');
    // the top-bar badge live-updates from the panel state (§8.1)
    await expect(page.locator('[data-studio-mapping-badge]')).toHaveText('Mapping 1/1 Offers complete');

    // offer B: one required field → complete → badge 2/2
    await rowB.getByRole('button', { name: 'Map fields' }).click();
    await grid.locator('[data-map-row="lead.zip_code"] select[data-map-question]').selectOption('zip');
    await expect(rowB.locator('[data-offer-mapping-state]')).toHaveAttribute('data-offer-mapping-state', 'complete');
    await expect(page.locator('[data-studio-mapping-badge]')).toHaveText('Mapping 2/2 Offers complete');
    await page.screenshot({ path: `${SHOT_DIR}/03-two-offers-mapped-badge-2-2.png` });

    // save → the editor reloads (same URL) → the SERVER re-derived the same
    // verdict and the fresh page's panel re-renders complete/complete + 2/2
    await Promise.all([page.waitForEvent('load'), page.locator('#lg-section-save').click()]);
    await page.locator('[data-studio-drawer-tab="mapping"]').click();
    await expect(page.locator(`tr[data-studio-offer-row="${offerA.public_id}"] [data-offer-mapping-state]`)).toHaveAttribute(
      'data-offer-mapping-state',
      'complete',
    );
    await expect(page.locator(`tr[data-studio-offer-row="${offerB.public_id}"] [data-offer-mapping-state]`)).toHaveAttribute(
      'data-offer-mapping-state',
      'complete',
    );
    await expect(page.locator('[data-studio-mapping-badge]')).toHaveText('Mapping 2/2 Offers complete');
    await page.screenshot({ path: `${SHOT_DIR}/04-mapping-persisted-after-save.png` });
  });

  test('④ create-question-for-field spawns the pre-bound component (boolean → TwoButtonYesNo, internal_field from the path)', async ({ page }) => {
    const vert = `cq-${uniq}`;
    await createStudioOffer(page.request, `CQ Offer ${uniq}`, ACT_A, vert, [
      { path: 'data.homeowner', type: 'boolean', required: true, internal_field: 'homeowner' },
    ]);
    // a Section with NO mappable question yet (headline only)
    const section = await createStudioSection(page.request, `CQ Section ${uniq}`, ACT_A, vert, {
      content_json: {
        components: [{ type: 'QuestionHeadline', question_id: 'q_head', props: { text: 'Do you own your home?' } }],
      },
    });

    await page.goto(`/admin/leadgen/sections/${section.public_id}/edit`, { waitUntil: 'domcontentloaded' });
    await page.locator('[data-studio-drawer-tab="mapping"]').click();
    const row = page.locator(`tr[data-studio-offer-row]`, { hasText: `CQ Offer ${uniq}` });
    await row.getByRole('button', { name: 'Map fields' }).click();
    const grid = page.locator('[data-studio-map-grid]');
    await grid.locator('[data-map-row="data.homeowner"] select[data-map-question]').selectOption('__create__');

    // the pre-bound component landed on the CANVAS via the D1 add machinery
    const canvasNode = page.locator('#lg-studio-canvas-render [data-component-type="TwoButtonYesNo"]');
    await expect(canvasNode).toBeVisible();
    // …and the grid row is now mapped COMPLETE to the path-derived field
    await expect(grid.locator('[data-map-row="data.homeowner"] select[data-map-question]')).toHaveValue('homeowner');
    await expect(grid.locator('[data-map-row="data.homeowner"] [data-map-state]')).toHaveAttribute('data-map-state', 'complete');
    await page.screenshot({ path: `${SHOT_DIR}/05-create-question-for-field.png` });
  });

  test('⑤ R5: activation preflight BLOCKS on the missing required mapping; the fix link opens THIS studio on the mapping drawer', async ({ page }) => {
    test.setTimeout(90_000);
    const vert = `r5-${uniq}`;
    const offer = await createStudioOffer(page.request, `R5 Offer ${uniq}`, ACT_A, vert, [
      { path: 'data.zip', type: 'string', required: true, internal_field: 'zip' },
    ]);
    // the Section SELECTS the offer but maps nothing → the required provider
    // field is unmapped (the §5.2 block class this flow pins)
    const section = await createStudioSection(page.request, `R5 Section ${uniq}`, ACT_A, vert, {
      selected_offers: [offer.id],
    });
    const quote = await json<{ id: number; public_id: string; funnels: Array<{ public_id: string; variants: Array<{ public_id: string }> }> }>(
      await page.request.post(`${LG_API}/quotes`, {
        data: { quote_name: `R5 Quote ${uniq}`, activity: ACT_A, verticals: [vert] },
      }),
      'r5 quote create',
    );
    await json(
      await page.request.put(`${LG_API}/variants/${quote.funnels[0]!.variants[0]!.public_id}`, {
        data: { sections: [{ section_id: section.id, position: 0 }] },
      }),
      'r5 variant sections',
    );

    await page.goto(`/admin/leadgen/quotes/${quote.public_id}/edit`, { waitUntil: 'domcontentloaded' });
    await page.locator('.lg-qtab[data-tab="activation"]').click();
    const panel = page.locator('#lg-preflight-panel');
    await expect(panel).toHaveAttribute('data-preflight-state', 'blocked');
    const card = panel.locator('[data-preflight-code="missing_required_provider_fields"]');
    await expect(card).toBeVisible();
    await expect(card).toContainText(`R5 Section ${uniq}`);
    await expect(card).toContainText(`R5 Offer ${uniq}`);
    await expect(card).toContainText('data.zip');
    // the head badge mirrors the same server verdict
    await expect(page.locator('#lg-publish-badge')).toHaveAttribute('data-publish-verdict', 'blocked');
    await page.screenshot({ path: `${SHOT_DIR}/06-r5-activation-blocked.png` });

    // the fix link deep-links into THIS studio's mapping drawer (#mapping)
    const fixLink = card.getByRole('link', { name: 'Open Section Mapping' });
    await expect(fixLink).toHaveAttribute('href', `/admin/leadgen/sections/${section.public_id}/edit#mapping`);
    await fixLink.click();
    await page.waitForURL(/\/admin\/leadgen\/sections\/lgs_[^/]+\/edit#mapping/);
    await expect(page.locator('[data-studio-drawer-panel="mapping"]')).toBeVisible();
    await expect(page.locator('[data-studio-drawer-panel="preview"]')).toBeHidden();
    // the panel shows exactly the incomplete offer the preflight named
    const row = page.locator(`tr[data-studio-offer-row="${offer.public_id}"]`);
    await expect(row.locator('[data-offer-mapping-state]')).toHaveAttribute('data-offer-mapping-state', 'selected');
    await page.screenshot({ path: `${SHOT_DIR}/07-r5-fix-link-opens-mapping-drawer.png` });
  });

  test('⑥ §8.9/§9.1 events panel: the runtime boots in preview mode and streams would-fire events; an answer click inside the preview lists its event', async ({ page }) => {
    test.setTimeout(90_000);
    const section = await createStudioSection(page.request, `Events Section ${uniq}`, ACT_A, `ev-${uniq}`);

    await page.goto(`/admin/leadgen/sections/${section.public_id}/edit`, { waitUntil: 'domcontentloaded' });
    // the preview drawer tab is active by default; the iframe carries the
    // runtime events DOCUMENT (§9.1: data-lg-preview root + the real bundle)
    const frame = page.frameLocator('#lg-preview-frame');
    await expect(frame.locator('#lg-funnel-root[data-lg-preview="1"]')).toBeVisible({ timeout: 15_000 });

    // the engine BOOT beacons arrive over postMessage — suppressed as real
    // requests, listed in the panel instead (§8.9 "events that would fire")
    const list = page.locator('[data-studio-events-list]');
    await expect(list.locator('li[data-event-type="section_view"]').first()).toBeVisible({ timeout: 15_000 });
    await expect(list.locator('li[data-event-type="quote_view"]').first()).toBeVisible();

    // interacting INSIDE the hydrated preview fires the answer event into the
    // panel (the §14.9 analytics-preview sim, live)
    await frame.locator('[data-lg-choice]').first().click();
    await expect(list.locator('li[data-event-type="answer_click"]').first()).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: `${SHOT_DIR}/08-events-panel-live.png` });

    // Clear resets the panel
    await page.locator('[data-studio-events-clear]').click();
    await expect(list.locator('li')).toHaveCount(0);
  });

  test('⑦ §8.8 ZIP Maps config via the inspector: exact runtime keys persist through save/reload; linked-field chip + key banner', async ({ page }) => {
    test.setTimeout(90_000);
    const vert = `maps-${uniq}`;
    const section = await createStudioSection(page.request, `Maps Section ${uniq}`, ACT_A, vert, {
      content_json: {
        components: [
          { type: 'ZIPInputQuestion', question_id: 'q_zip', internal_field: 'zip', answer_type: 'string', props: { placeholder: 'ZIP code' } },
          { type: 'FreeTextQuestion', question_id: 'q_city', internal_field: 'city', answer_type: 'string' },
          { type: 'FreeTextQuestion', question_id: 'q_state', internal_field: 'state', answer_type: 'string' },
        ],
      },
    });

    await page.goto(`/admin/leadgen/sections/${section.public_id}/edit`, { waitUntil: 'domcontentloaded' });

    // a NON-Maps component shows no Maps tab (visible ONLY for address/ZIP)
    await page.locator('#lg-studio-canvas-render [data-component-type="FreeTextQuestion"]').first().click();
    const mapsTab = page.locator('[data-studio-inspector-tab="maps"]');
    await expect(mapsTab).toBeHidden();

    // select the ZIP component on the canvas → Maps tab appears; open it
    await page.locator('#lg-studio-canvas-render [data-component-type="ZIPInputQuestion"]').click();
    await expect(mapsTab).toBeVisible();
    await mapsTab.click();

    // zip mode: validate toggle + city/state pickers; address-only controls hidden
    const validateZip = page.locator('[data-maps-flag="validate_zip"]');
    await expect(validateZip).toBeVisible();
    await expect(page.locator('[data-maps-flag="enable_autocomplete"]')).toBeHidden();
    await expect(page.locator('[data-maps-flag="validate_full_address"]')).toBeHidden();
    await expect(page.locator('[data-maps-fill="autofill_zip"]')).toBeHidden();

    // the pickers list THIS Section's internal fields, excluding the ZIP itself
    const cityPick = page.locator('[data-maps-fill="autofill_city"]');
    const statePick = page.locator('[data-maps-fill="autofill_state"]');
    await expect(cityPick.locator('option[value="city"]')).toHaveCount(1);
    await expect(cityPick.locator('option[value="zip"]')).toHaveCount(0);

    // configure: validate ZIP + autofill city/state via pickers only
    await validateZip.check();
    await cityPick.selectOption('city');
    await statePick.selectOption('state');

    // the §8.8 linked-field chip appears on the canvas from the config's
    // autofill keys — "fills: city, state"
    const chip = page.locator('#lg-studio-canvas-render [data-studio-maps-chip]');
    await expect(chip).toHaveCount(1);
    await expect(chip).toHaveAttribute('data-fills', 'city,state');
    await expect(chip).toHaveText('fills: city, state');

    // key-missing banner: shown ONLY when a Maps-enabled component exists AND
    // no browser key is configured (local dev ships no GOOGLE_MAPS_BROWSER_KEY)
    const banner = page.locator('[data-studio-maps-banner]');
    if ((await banner.getAttribute('data-maps-key-configured')) === 'false') {
      await expect(banner).toBeVisible();
      await expect(banner).toContainText('Autocomplete/validation will no-op; manual entry still works');
    } else {
      await expect(banner).toBeHidden();
    }
    await page.screenshot({ path: `${SHOT_DIR}/09-maps-config-chip-banner.png` });

    // save → reload (same URL): the config persisted with the EXACT runtime keys
    await Promise.all([page.waitForEvent('load'), page.locator('#lg-section-save').click()]);
    const detail = await json<{ content_json: { components: Array<{ question_id: string; props?: Record<string, unknown> }> } }>(
      await page.request.get(`${LG_API}/sections/${section.public_id}`),
      'maps section detail',
    );
    const zipNode = detail.content_json.components.find((c) => c.question_id === 'q_zip');
    expect(zipNode?.props?.['maps'], 'the §8.8 emission — exactly the runtime parseMapsConfig keys').toEqual({
      validate_zip: true,
      autofill_city: 'city',
      autofill_state: 'state',
      enable_autocomplete: true,
    });

    // the fresh page re-derives the chip from the saved model, and the
    // inspector re-populates the saved config
    await expect(page.locator('#lg-studio-canvas-render [data-studio-maps-chip]')).toHaveAttribute('data-fills', 'city,state');
    await page.locator('#lg-studio-canvas-render [data-component-type="ZIPInputQuestion"]').click();
    await page.locator('[data-studio-inspector-tab="maps"]').click();
    await expect(page.locator('[data-maps-flag="validate_zip"]')).toBeChecked();
    await expect(page.locator('[data-maps-fill="autofill_city"]')).toHaveValue('city');
    await expect(page.locator('[data-maps-fill="autofill_state"]')).toHaveValue('state');
    await page.screenshot({ path: `${SHOT_DIR}/10-maps-config-persisted.png` });

    // clearing everything deletes props.maps (clean node) on the next save
    await page.locator('[data-maps-flag="validate_zip"]').uncheck();
    await page.locator('[data-maps-fill="autofill_city"]').selectOption('');
    await page.locator('[data-maps-fill="autofill_state"]').selectOption('');
    await expect(page.locator('#lg-studio-canvas-render [data-studio-maps-chip]')).toHaveCount(0);
    await Promise.all([page.waitForEvent('load'), page.locator('#lg-section-save').click()]);
    const cleared = await json<{ content_json: { components: Array<{ question_id: string; props?: Record<string, unknown> }> } }>(
      await page.request.get(`${LG_API}/sections/${section.public_id}`),
      'maps section cleared',
    );
    expect(cleared.content_json.components.find((c) => c.question_id === 'q_zip')?.props?.['maps']).toBeUndefined();
  });
});
