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
//     top-bar badge live-updates through the Appendix-A "Mapping k / n
//     complete" field-count (2 / 2, then 3 / 3 — never the offers-panel's
//     own differently-scoped "N/M Offers complete" wording), the save
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

  test('③ map answers to TWO Offers via pickers only: statuses flip, the top-bar badge live-updates through 2 / 2 then 3 / 3 (field-count, Appendix A — never the offers-panel\'s own "N/M Offers complete" wording) and survives the save round trip', async ({ page }) => {
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
    // the path picker SHOWS type + required — never a free-text path input.
    // DEV-65c (§12.1): the option label speaks OPERATOR WORDS — the field's
    // label + plain-words type ("yes or no", never the raw "boolean" id).
    await expect(grid.locator('[data-map-row="data.insured"] select[data-map-path]')).toBeVisible();
    await expect(grid.locator('[data-map-row="data.insured"] option[value="data.insured"]').first()).toContainText('yes or no');
    await expect(grid.locator('[data-map-row="data.insured"] option[value="data.insured"]').first()).toContainText('(required)');
    expect(await grid.locator('input[type="text"]').count(), 'no free-text inputs in the grid').toBe(0);
    await grid.locator('[data-map-row="data.insured"] select[data-map-question]').selectOption('currently_insured');
    await expect(grid.locator('[data-map-row="data.insured"] [data-map-state]')).toHaveAttribute('data-map-state', 'complete');
    await grid.locator('[data-map-row="data.zip"] select[data-map-question]').selectOption('zip');
    await expect(grid.locator('[data-map-row="data.zip"] [data-map-state]')).toHaveAttribute('data-map-state', 'complete');
    await expect(rowA.locator('[data-offer-mapping-state]')).toHaveAttribute('data-offer-mapping-state', 'complete');
    // M1 (adversarial review): the top-bar badge LIVE-updates (updateMappingBadge,
    // called from renderOffersPanel on every mapping edit) to the Appendix-A
    // "Mapping k / n complete" FIELD-count — offer A alone contributes its 2
    // required fields, both now mapped, so k=n=2. This asserts the SETTLED
    // live DOM text (the offers panel is already loaded and interacted with
    // above), never the SSR snapshot — the badge must NEVER read the offers
    // panel's own "N/M Offers complete" wording (that phrase belongs to a
    // DIFFERENT, offer-scoped concept in the drawer, not this shared element).
    await expect(page.locator('[data-studio-mapping-badge]')).toHaveText('Mapping 2 / 2 complete');

    // offer B: its one required field also becomes mapped+complete — the
    // field-count sum grows to offer A's 2 + offer B's 1 = 3 / 3.
    await rowB.getByRole('button', { name: 'Map fields' }).click();
    await grid.locator('[data-map-row="lead.zip_code"] select[data-map-question]').selectOption('zip');
    await expect(rowB.locator('[data-offer-mapping-state]')).toHaveAttribute('data-offer-mapping-state', 'complete');
    await expect(page.locator('[data-studio-mapping-badge]')).toHaveText('Mapping 3 / 3 complete');
    await page.screenshot({ path: `${SHOT_DIR}/03-two-offers-mapped-badge-3-3.png` });

    // save → the editor reloads (same URL) → the SERVER re-derived the same
    // verdict (SSR renders "Mapping 3 / 3 complete" from required_mapped_total/
    // required_fields_total) and the fresh page's offers panel re-fetch
    // (loadOffers → updateMappingBadge) recomputes the IDENTICAL field-count
    // sum — SSR and the post-load client-recomputed value agree, closing the
    // M1 divergence to one source.
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
    await expect(page.locator('[data-studio-mapping-badge]')).toHaveText('Mapping 3 / 3 complete');
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
    const canvasNode = page.frameLocator('#lg-studio-canvas-frame').locator('#lg-studio-canvas-render [data-component-type="TwoButtonYesNo"]');
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

  // v3.1 §9 — the pre-v3.1 flat autofill-picker Maps panel (data-maps-flag/
  // data-maps-fill) is REPLACED by the golden's toggle + 3 whole-row jobs,
  // writing props.maps = {enabled, jobs:{validate,auction,autocomplete}}. The
  // manual per-field autofill-target picker (and its canvas "fills: city,
  // state" chip) has no successor in the golden design (flagged contract
  // gap — see the phase report); this spec now exercises the zero-job
  // banner instead, a NEW §9.3 behavior the old panel never had.
  test('⑦ §9 ZIP Maps config via the inspector: the enabled toggle + job checkboxes persist through save/reload; zero-job banner; key-missing banner', async ({ page }) => {
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
    await page.frameLocator('#lg-studio-canvas-frame').locator('#lg-studio-canvas-render [data-component-type="FreeTextQuestion"]').first().click();
    const mapsTab = page.locator('[data-studio-inspector-tab="maps"]');
    await expect(mapsTab).toBeHidden();

    // select the ZIP component on the canvas → Maps tab appears; open it
    await page.frameLocator('#lg-studio-canvas-frame').locator('#lg-studio-canvas-render [data-component-type="ZIPInputQuestion"]').click();
    await expect(mapsTab).toBeVisible();
    await mapsTab.click();

    // the toggle + jobs block; jobs stay hidden until enabled
    const toggle = page.locator('[data-maps-enabled-toggle]');
    await expect(toggle).toBeVisible();
    const jobsBlock = page.locator('[data-maps-jobs-block]');
    await expect(jobsBlock).toBeHidden();
    const zeroJobBanner = page.locator('[data-maps-zero-job-banner]');

    // turning the toggle ON with no job selected → the §9.3 amber banner
    await toggle.check();
    await expect(jobsBlock).toBeVisible();
    await expect(zeroJobBanner).toBeVisible();
    await expect(zeroJobBanner).toContainText('Pick at least one job for Maps');
    await page.screenshot({ path: `${SHOT_DIR}/09-maps-zero-job-banner.png` });

    // picking a job clears the banner
    const validateJob = page.locator('[data-maps-job="validate"]');
    await validateJob.check();
    await expect(zeroJobBanner).toBeHidden();

    // key-missing banner: shown ONLY when a Maps-enabled component exists AND
    // no browser key is configured (local dev ships no GOOGLE_MAPS_BROWSER_KEY)
    const banner = page.locator('[data-studio-maps-banner]');
    if ((await banner.getAttribute('data-maps-key-configured')) === 'false') {
      await expect(banner).toBeVisible();
      await expect(banner).toContainText('Autocomplete/validation will no-op; manual entry still works');
    } else {
      await expect(banner).toBeHidden();
    }

    // save → reload (same URL): the config persisted with the EXACT §9.2 shape
    await Promise.all([page.waitForEvent('load'), page.locator('#lg-section-save').click()]);
    const detail = await json<{ content_json: { components: Array<{ question_id: string; props?: Record<string, unknown> }> } }>(
      await page.request.get(`${LG_API}/sections/${section.public_id}`),
      'maps section detail',
    );
    const zipNode = detail.content_json.components.find((c) => c.question_id === 'q_zip');
    expect(zipNode?.props?.['maps'], 'the §9.2 emission — {enabled,jobs}').toEqual({
      enabled: true,
      jobs: { validate: true, auction: false, autocomplete: false },
    });

    // the fresh page re-populates the saved config in the inspector
    await page.frameLocator('#lg-studio-canvas-frame').locator('#lg-studio-canvas-render [data-component-type="ZIPInputQuestion"]').click();
    await page.locator('[data-studio-inspector-tab="maps"]').click();
    await expect(page.locator('[data-maps-enabled-toggle]')).toBeChecked();
    await expect(page.locator('[data-maps-job="validate"]')).toBeChecked();
    await expect(page.locator('[data-maps-job="auction"]')).not.toBeChecked();
    await page.screenshot({ path: `${SHOT_DIR}/10-maps-config-persisted.png` });

    // turning the toggle OFF deletes props.maps (clean node) on the next save
    await page.locator('[data-maps-enabled-toggle]').uncheck();
    await Promise.all([page.waitForEvent('load'), page.locator('#lg-section-save').click()]);
    const cleared = await json<{ content_json: { components: Array<{ question_id: string; props?: Record<string, unknown> }> } }>(
      await page.request.get(`${LG_API}/sections/${section.public_id}`),
      'maps section cleared',
    );
    expect(cleared.content_json.components.find((c) => c.question_id === 'q_zip')?.props?.['maps']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// v3.1 Section Builder redesign (contract-v3.1, Phase B) — golden-chrome
// browser flows: library search + group collapse (§5.1/§5.5), default
// selection + the field's 8-handle chrome (§6.2), the §7 width-drag
// measurement writing a REAL custom_px, and the Frame-hint toggle (§6.3).
// Each test seeds its OWN Section (independent — no .serial needed).
// ---------------------------------------------------------------------------

test.describe('LeadGen Section Studio v3.1 — golden-chrome browser flows (§5/§6/§7)', () => {
  test('§5.5 library search filters tiles by data-name across ALL groups, force-opening the collapsed Layout group', async ({ page }) => {
    const section = await createStudioSection(page.request, `V31 Search ${uniq}`, ACT_A, `v31-search-${uniq}`);
    await page.goto(`/admin/leadgen/sections/${section.public_id}/edit`, { waitUntil: 'domcontentloaded' });

    const search = page.locator('[data-studio-library-search]');
    const layoutItems = page.locator('[data-library-items="layout"]');
    const spacerTile = page.locator('[data-tile][data-name="spacer gap"]');
    const shortTextTiles = page.locator('[data-tile][data-name="short text"]');

    // Layout starts collapsed (default per §5.1); its tiles exist but the
    // group container is hidden.
    await expect(layoutItems).toBeHidden();
    // Unrelated tiles (2 "Short text" instances — Suggested + Answer fields)
    // are visible before any search.
    await expect(shortTextTiles).toHaveCount(2);
    for (const el of await shortTextTiles.all()) await expect(el).toBeVisible();

    await search.fill('spacer');
    // Layout is FORCED open so the match is reachable, even though it was
    // collapsed a moment ago.
    await expect(layoutItems).toBeVisible();
    await expect(spacerTile).toBeVisible();
    // Non-matching tiles (e.g. "Short text") are hidden while the query is active.
    for (const el of await shortTextTiles.all()) await expect(el).toBeHidden();

    await search.fill('');
    // Clearing restores Layout to its own toggled state (still collapsed —
    // the user never manually opened it).
    await expect(layoutItems).toBeHidden();
    for (const el of await shortTextTiles.all()) await expect(el).toBeVisible();
    await page.screenshot({ path: `${SHOT_DIR}/v31-01-library-search.png` });
  });

  test('§5.1 group header chevron toggles open/closed independent of search', async ({ page }) => {
    const section = await createStudioSection(page.request, `V31 Group Toggle ${uniq}`, ACT_A, `v31-toggle-${uniq}`);
    await page.goto(`/admin/leadgen/sections/${section.public_id}/edit`, { waitUntil: 'domcontentloaded' });

    const layoutHeader = page.locator('[data-library-group-toggle="layout"]');
    const layoutItems = page.locator('[data-library-items="layout"]');
    const suggestedHeader = page.locator('[data-library-group-toggle="suggested"]');
    const suggestedItems = page.locator('[data-library-items="suggested"]');

    await expect(layoutHeader).toHaveAttribute('aria-expanded', 'false');
    await expect(layoutItems).toBeHidden();
    await layoutHeader.click();
    await expect(layoutHeader).toHaveAttribute('aria-expanded', 'true');
    await expect(layoutItems).toBeVisible();

    await expect(suggestedHeader).toHaveAttribute('aria-expanded', 'true');
    await expect(suggestedItems).toBeVisible();
    await suggestedHeader.click();
    await expect(suggestedHeader).toHaveAttribute('aria-expanded', 'false');
    await expect(suggestedItems).toBeHidden();
    await page.screenshot({ path: `${SHOT_DIR}/v31-02-group-toggle.png` });
  });

  test('§6.2 default selection on open = the first real answer field; selecting shows the 8-handle field chrome (never on the bound headline)', async ({ page }) => {
    // Explicit fixture: bound headline+subheadline first (skipped by the
    // default-selection rule — they carry `bind`, not a real answer), THEN
    // the ONE real answer field (ZIP) — mirrors the §1.2 fixture's own
    // "default = the ZIP field" wording unambiguously (mappableContent()'s
    // OWN default order puts a TwoButtonYesNo before the ZIP field, which
    // would otherwise become the default here instead).
    const section = await createStudioSection(page.request, `V31 Default Sel ${uniq}`, ACT_A, `v31-defsel-${uniq}`, {
      headline_text: 'What is your ZIP code?',
      content_json: {
        components: [
          { type: 'QuestionHeadline', question_id: 'q_bound_headline', bind: 'section_headline' },
          { type: 'Subheadline', question_id: 'q_bound_subheadline', bind: 'section_subheadline' },
          // ZIP stays FIRST among real-answer nodes so it — not the Yes/No
          // pair below — remains findDefaultSelectionId()'s pick; q_ins only
          // exists to prove M2 (a non-text-input field's name tag).
          { type: 'ZIPInputQuestion', question_id: 'q_zip', internal_field: 'zip', answer_type: 'string', props: { placeholder: 'ZIP code' } },
          {
            type: 'TwoButtonYesNo',
            question_id: 'q_ins',
            internal_field: 'currently_insured',
            answer_type: 'boolean',
            props: { yesLabel: 'Yes', noLabel: 'No' },
          },
        ],
      },
    });
    await page.goto(`/admin/leadgen/sections/${section.public_id}/edit`, { waitUntil: 'domcontentloaded' });

    const canvas = page.frameLocator('#lg-studio-canvas-frame').locator('#lg-studio-canvas-render');
    // Default selection = the ZIP field (this fixture's FIRST real answer
    // node) — its wrapper carries the 8-handle chrome immediately on load,
    // with no click required. ZIP is one of the §5.6 8-value Accept-swap
    // text-input types, so its OWN name tag is the unified "Short text field".
    const zipWrap = canvas.locator('[data-question-id="q_zip"]').locator('xpath=..');
    await expect(zipWrap.locator('[data-width-handle]')).toHaveCount(2); // only the 2 side-midpoints are interactive
    await expect(zipWrap.locator('[data-selection-chrome]')).toHaveCount(10); // outline(1) + name tag(1) + 8 handles (no custom badge yet)
    await expect(canvas.locator('text=Short text field')).toBeVisible();

    // M2 (adversarial review): a NON-text-input field showing the SAME
    // 8-handle chrome must carry ITS OWN operator name — never the literal
    // "Short text field" (selectionChromeKind returns 'field' for ANY
    // non-headline/continue/container node, but the §5.6 tag wording is
    // scoped to the 8-value Accept-swap family only).
    const insWrap = canvas.locator('[data-question-id="q_ins"]').locator('xpath=..');
    await canvas.locator('[data-question-id="q_ins"]').click();
    // R3 (register S2-1/E1-C3): TwoButtonYesNo's renderer now CONSUMES
    // design_overrides.size/.corners/.border_color (presets.ts), so it joins the
    // size-consuming set — the 2 interactive E/W width handles are back. The
    // set-equality pin in test/leadgen-r2-canvas.test.ts forced this flip in
    // lockstep with the renderer widening (conductor-pre-ratified for R3).
    await expect(insWrap.locator('[data-width-handle]')).toHaveCount(2);
    await expect(insWrap.locator('text=Yes / No')).toBeVisible();
    await expect(insWrap.locator('text=Short text field')).toHaveCount(0);

    // selecting the bound headline shows the SIMPLE chrome (outline + tag),
    // never the 8 handles.
    const headline = canvas.locator('[data-question-id="q_bound_headline"], .lg-headline').first();
    await headline.click();
    await expect(canvas.locator('text=Question · shared with header')).toBeVisible();
    await expect(canvas.locator('[data-width-handle]')).toHaveCount(0);
    await page.screenshot({ path: `${SHOT_DIR}/v31-03-default-selection-chrome.png` });
  });

  test('§7.1.3 dragging a width handle writes a REAL measured, snapped, clamped custom_px — never the golden\'s fake 384', async ({ page }) => {
    // Explicit fixture (matches the default-selection test above): the
    // GENERIC createStudioSection default (mappableContent()) puts a
    // TwoButtonYesNo BEFORE the ZIP field, which is a different, unrelated
    // ambiguity this test must not depend on — give it its OWN unambiguous
    // ZIP-only content so `[data-question-id="q_zip"]` is deterministically
    // present the moment the canvas loads.
    const section = await createStudioSection(page.request, `V31 Width Drag ${uniq}`, ACT_A, `v31-widthdrag-${uniq}`, {
      content_json: {
        components: [
          { type: 'QuestionHeadline', question_id: 'q_bound_headline', bind: 'section_headline' },
          { type: 'Subheadline', question_id: 'q_bound_subheadline', bind: 'section_subheadline' },
          { type: 'ZIPInputQuestion', question_id: 'q_zip', internal_field: 'zip', answer_type: 'string', props: { placeholder: 'ZIP code' } },
        ],
      },
    });
    await page.goto(`/admin/leadgen/sections/${section.public_id}/edit`, { waitUntil: 'domcontentloaded' });

    const canvas = page.frameLocator('#lg-studio-canvas-frame').locator('#lg-studio-canvas-render');
    await canvas.locator('[data-question-id="q_zip"]').click(); // ensure selected (also the default)

    const rightHandle = canvas.locator('[data-width-handle][data-handle-side="right"]');
    await expect(rightHandle).toBeVisible();

    // The width-drag gesture is a CUSTOM (non-native) drag: onWidthHandleMouseDown
    // reads the 'mousedown' clientX, requires an ACTUAL intervening 'mousemove'
    // (adversarial re-review m3(a-2): a mousedown+mouseup with NO real movement
    // must never commit a width — that's what let a lost-mouseup-then-unrelated-
    // click silently write a bogus custom_px), then the eventual 'mouseup'
    // clientX — no native HTML5 drag involved. Raw CDP-level page.mouse.move()
    // sequences that land inside this same-origin SRCDOC iframe reproducibly
    // hang here (confirmed independent of this feature: even a neutral,
    // non-interactive point in the canvas hangs the SAME way on the second
    // page.mouse.move() call — an environment/CDP limitation with nested
    // same-origin-iframe raw pointer injection, not a product bug). Dispatching
    // real MouseEvents directly via the DOM (bypassing CDP's Input domain
    // entirely) exercises the EXACT SAME JS listeners with the EXACT SAME
    // event shape a real drag delivers, without depending on CDP pointer
    // injection fidelity this environment doesn't have for nested iframes.
    const dragDeltaPx = 60;
    const drag = await rightHandle.evaluate((el, deltaX) => {
      const r = el.getBoundingClientRect();
      const clientY = r.top + r.height / 2;
      const startClientX = r.left + r.width / 2;
      const doc = el.ownerDocument;
      const view = doc.defaultView as Window;
      el.dispatchEvent(new MouseEvent('mousedown', { clientX: startClientX, clientY, bubbles: true, cancelable: true, view }));
      const midClientX = startClientX + deltaX / 2;
      doc.dispatchEvent(new MouseEvent('mousemove', { clientX: midClientX, clientY, bubbles: true, cancelable: true, view }));
      const endClientX = startClientX + deltaX;
      doc.dispatchEvent(new MouseEvent('mouseup', { clientX: endClientX, clientY, bubbles: true, cancelable: true, view }));
      return { startClientX, endClientX };
    }, dragDeltaPx);
    expect(drag.endClientX - drag.startClientX, 'dispatched delta matches the requested drag').toBe(dragDeltaPx);

    // the canvas badge shows the REAL measured value in the golden's format
    // ("≈ {value} px · custom") — never the fixture's literal "384".
    const badge = canvas.locator('text=/≈ \\d+ px · custom/');
    await expect(badge).toBeVisible({ timeout: 5_000 });
    const badgeText = await badge.textContent();
    const match = badgeText?.match(/≈ (\d+) px/);
    expect(match, `badge reads a real number: "${badgeText}"`).not.toBeNull();
    const px = Number(match![1]);
    expect(px % 4, 'snapped to the 4px grid').toBe(0);
    expect(px).toBeGreaterThanOrEqual(200);
    expect(px).toBeLessThanOrEqual(600);
    await page.screenshot({ path: `${SHOT_DIR}/v31-04-width-drag-custom-badge.png` });

    // persists: the saved node carries design_overrides.size.width.custom_px
    await Promise.all([page.waitForEvent('load'), page.locator('#lg-section-save').click()]);
    const detail = await json<{ content_json: { components: Array<{ question_id: string; design_overrides?: { size?: { width?: { custom_px?: number } } } }> } }>(
      await page.request.get(`${LG_API}/sections/${section.public_id}`),
      'width-drag section detail',
    );
    const zipNode = detail.content_json.components.find((c) => c.question_id === 'q_zip');
    expect(zipNode?.design_overrides?.size?.width?.custom_px).toBe(px);
  });

  test('§5.6 audit-round G FIX 4: drag-insert carries childTypes + defaultProps — Contact drags a 3-child Stack; Divider drags a Spacer variant:line (drag == click == keyboard)', async ({ page }) => {
    // HTML5 drag-drop cannot be driven by CDP raw pointer input (the same
    // nested-srcdoc-iframe limitation the §7.1.3 width-drag test documents), so
    // we dispatch synthetic DragEvents with a REAL shared DataTransfer: the
    // product's OWN library dragstart handler populates it (the 'add:' JSON
    // envelope) and its OWN onCanvasDrop reads it — exercising the exact wiring
    // a real drag delivers, without CDP pointer fidelity this env lacks.
    const section = await createStudioSection(page.request, `V31 Drag Insert ${uniq}`, ACT_A, `v31-draginsert-${uniq}`, {
      content_json: {
        components: [
          { type: 'QuestionHeadline', question_id: 'q_bound_headline', bind: 'section_headline' },
          { type: 'ZIPInputQuestion', question_id: 'q_zip', internal_field: 'zip', answer_type: 'string', props: { placeholder: 'ZIP code' } },
        ],
      },
    });
    await page.goto(`/admin/leadgen/sections/${section.public_id}/edit`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-studio-library]')).toBeVisible();

    // Synthetic HTML5 drag of the library tile matching data-name onto the
    // canvas surface (mode 'append' — no dragover hint needed for a top-level
    // insert). Returns the payload the product's dragstart handler emitted.
    const dragTileToCanvas = (dataName: string) =>
      page.evaluate((name) => {
        const out = { ok: false, reason: '', payload: '' };
        const dt = new DataTransfer();
        const tile = document.querySelector('[data-studio-library] [data-name="' + name + '"]');
        if (!tile) {
          out.reason = 'tile not found: ' + name;
          return out;
        }
        tile.dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true, cancelable: true }));
        out.payload = dt.getData('text/plain');
        const surface = document.querySelector('.studio-canvas-surface');
        if (!surface) {
          out.reason = 'canvas surface not found';
          return out;
        }
        surface.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
        out.ok = true;
        return out;
      }, dataName);

    const contactDrag = await dragTileToCanvas('contact name email phone');
    expect(contactDrag.ok, contactDrag.reason).toBe(true);
    // the dragstart payload is the JSON envelope (not the pre-fix bare type)
    expect(contactDrag.payload).toContain('"childTypes"');
    expect(contactDrag.payload).toContain('NameFieldsGroup');

    const dividerDrag = await dragTileToCanvas('divider line');
    expect(dividerDrag.ok, dividerDrag.reason).toBe(true);
    expect(dividerDrag.payload).toContain('"defaultProps"');
    expect(dividerDrag.payload).toContain('"variant":"line"');

    await page.screenshot({ path: `${SHOT_DIR}/v31-06-drag-insert-childtypes.png` });

    // persist + re-fetch: the saved tree carries the Contact Stack (3 children)
    // and the Divider Spacer(line) — the drag now reproduces the click/keyboard insert.
    await Promise.all([page.waitForEvent('load'), page.locator('#lg-section-save').click()]);
    const detail = await json<{
      content_json: { components: Array<{ type: string; children?: Array<{ type: string }>; props?: { variant?: string } }> };
    }>(await page.request.get(`${LG_API}/sections/${section.public_id}`), 'drag-insert section detail');
    const comps = detail.content_json.components;
    const stack = comps.find((c) => c.type === 'Stack');
    expect(stack, 'a Stack was inserted by the Contact drag').toBeTruthy();
    expect((stack!.children ?? []).map((c) => c.type)).toEqual([
      'NameFieldsGroup',
      'EmailInputQuestion',
      'PhoneInputQuestion',
    ]);
    const spacer = comps.find((c) => c.type === 'Spacer');
    expect(spacer, 'a Spacer was inserted by the Divider drag').toBeTruthy();
    expect(spacer!.props?.variant).toBe('line');
  });

  test('§6.1/§6.3 the canvas toolbar Frame-hint toggle (default ON) shows/hides the dimmed non-interactive skeleton', async ({ page }) => {
    const section = await createStudioSection(page.request, `V31 Frame Hint ${uniq}`, ACT_A, `v31-framehint-${uniq}`);
    await page.goto(`/admin/leadgen/sections/${section.public_id}/edit`, { waitUntil: 'domcontentloaded' });

    const frameHintBtn = page.locator('[data-studio-frame-hint]');
    const topSkeleton = page.locator('[data-studio-frame-skeleton="top"]');
    // default ON (contract §6.1 "toggle (default ON)" — a v3.1 fix over the
    // pre-existing default-OFF behavior)
    await expect(frameHintBtn).toHaveAttribute('aria-pressed', 'true');
    await expect(topSkeleton).toBeVisible();
    await expect(topSkeleton).toContainText('Funnel frame');

    await frameHintBtn.click();
    await expect(frameHintBtn).toHaveAttribute('aria-pressed', 'false');
    await expect(topSkeleton).toBeHidden();

    await frameHintBtn.click();
    await expect(frameHintBtn).toHaveAttribute('aria-pressed', 'true');
    await expect(topSkeleton).toBeVisible();
    await page.screenshot({ path: `${SHOT_DIR}/v31-05-frame-hint-toggle.png` });
  });
});

// ---------------------------------------------------------------------------
// v3.1 Phase C — the golden's 5-tab inspector (Content·Style·Rules·Maps·
// Offers), the Style-tab size presets, the Rules sentence, the Accept-swap
// dropdown, and the Advanced disclosure — through the REAL browser (contract
// §8.2/§8.5/§8.6/§8.8).
// ---------------------------------------------------------------------------

test.describe.serial('LeadGen Section Studio v3.1 Phase C — the golden 5-tab inspector', () => {
  test('§8.2 tab visibility is DYNAMIC per selection: field=Content/Style/Rules/Maps*/Offers; headline/continue=Content/Style only', async ({ page }) => {
    const vert = `c-tabs-${uniq}`;
    // mappableContent() (createStudioSection's default) has no bound
    // headline/continue node — provide the full 4-node set explicitly.
    const section = await createStudioSection(page.request, `C1 Tabs ${uniq}`, ACT_A, vert, {
      content_json: {
        components: [
          { type: 'QuestionHeadline', question_id: 'q_head', bind: 'section_headline' },
          {
            type: 'TwoButtonYesNo',
            question_id: 'q_ins',
            internal_field: 'currently_insured',
            answer_type: 'boolean',
            props: { yesLabel: 'Yes', noLabel: 'No' },
          },
          { type: 'ZIPInputQuestion', question_id: 'q_zip', internal_field: 'zip', answer_type: 'string', props: { placeholder: 'ZIP code' } },
          { type: 'ContinueButton', question_id: 'q_cont', props: { label: 'Continue' } },
        ],
      },
    });
    await page.goto(`/admin/leadgen/sections/${section.public_id}/edit`, { waitUntil: 'domcontentloaded' });

    const tab = (key: string) => page.locator(`[data-studio-inspector-tab="${key}"]`);

    // the ZIP field (answer-producing, ZIP type): all 5 tabs. §5.6/§8.1: the
    // whole 8-value Accept-swap family reads "Short text field", never its
    // own concrete-type catalog label ("ZIP").
    await page.frameLocator('#lg-studio-canvas-frame').locator('#lg-studio-canvas-render [data-component-type="ZIPInputQuestion"]').click();
    await expect(page.locator('[data-scope-editing-name]')).toHaveText('Short text field');
    for (const key of ['content', 'style', 'rules', 'maps', 'offers']) await expect(tab(key), key).toBeVisible();

    // a choice-based answer field (TwoButtonYesNo): Content/Style/Rules/Offers — NO Maps
    await page.frameLocator('#lg-studio-canvas-frame').locator('#lg-studio-canvas-render [data-component-type="TwoButtonYesNo"]').click();
    for (const key of ['content', 'style', 'rules', 'offers']) await expect(tab(key), key).toBeVisible();
    await expect(tab('maps'), 'Maps is ZIP/Address-only').toBeHidden();

    // the bound headline: Content/Style only (no Rules/Maps/Offers)
    await page.frameLocator('#lg-studio-canvas-frame').locator('#lg-studio-canvas-render [data-component-type="QuestionHeadline"]').click();
    await expect(page.locator('[data-scope-editing-name]')).toHaveText('Question headline');
    await expect(tab('content')).toBeVisible();
    await expect(tab('style')).toBeVisible();
    for (const key of ['rules', 'maps', 'offers']) await expect(tab(key), key).toBeHidden();

    // the Continue button: Content/Style only
    await page.frameLocator('#lg-studio-canvas-frame').locator('#lg-studio-canvas-render [data-component-type="ContinueButton"]').click();
    await expect(page.locator('[data-scope-editing-name]')).toHaveText('Continue button');
    await expect(tab('content')).toBeVisible();
    await expect(tab('style')).toBeVisible();
    for (const key of ['rules', 'maps', 'offers']) await expect(tab(key), key).toBeHidden();

    // §6.2: selecting a NEW node resets the active tab back to Content
    await page.locator('[data-studio-inspector-tab="style"]').click();
    await expect(page.locator('[data-studio-panel="style"]')).toBeVisible();
    await page.frameLocator('#lg-studio-canvas-frame').locator('#lg-studio-canvas-render [data-component-type="ZIPInputQuestion"]').click();
    await expect(page.locator('[data-studio-panel="content"]')).toBeVisible();
    await page.screenshot({ path: `${SHOT_DIR}/c1-01-tab-visibility.png` });
  });

  test('§5.6 Accept-swap via the Content-tab dropdown SWAPS the node type, preserving internal_field/required', async ({ page }) => {
    const vert = `c-accept-${uniq}`;
    const section = await createStudioSection(page.request, `C1 Accept ${uniq}`, ACT_A, vert, {
      content_json: {
        components: [
          { type: 'FreeTextQuestion', question_id: 'q_txt', internal_field: 'note', answer_type: 'string', required: true },
        ],
      },
    });
    await page.goto(`/admin/leadgen/sections/${section.public_id}/edit`, { waitUntil: 'domcontentloaded' });

    await page.frameLocator('#lg-studio-canvas-frame').locator('#lg-studio-canvas-render [data-component-type="FreeTextQuestion"]').click();
    await page.locator('[data-studio-inspector-tab="content"]').click();
    const accept = page.locator('[data-inspector-accept]');
    await expect(accept).toBeVisible();
    await expect(accept).toHaveValue('text');

    // the exact 8-value enumeration (§8.5b), in order
    const optionValues = await accept.locator('option').evaluateAll((els) => els.map((e) => (e as HTMLOptionElement).value));
    expect(optionValues).toEqual(['text', 'number', 'currency', 'email', 'phone', 'us_zip', 'date', 'street_address']);

    await accept.selectOption('us_zip');
    // the canvas re-renders under the NEW concrete type; the inspector name
    // stays "Short text field" (§5.6: the Accept-swap rule)
    await expect(page.locator('[data-scope-editing-name]')).toHaveText('Short text field');
    await expect(page.frameLocator('#lg-studio-canvas-frame').locator('#lg-studio-canvas-render [data-component-type="ZIPInputQuestion"]')).toBeVisible();

    await Promise.all([page.waitForEvent('load'), page.locator('#lg-section-save').click()]);
    const detail = await json<{ content_json: { components: Array<{ question_id: string; type: string; internal_field?: string; required?: boolean; props?: Record<string, unknown> }> } }>(
      await page.request.get(`${LG_API}/sections/${section.public_id}`),
      'accept-swap section detail',
    );
    const node = detail.content_json.components.find((c) => c.question_id === 'q_txt');
    expect(node?.type).toBe('ZIPInputQuestion');
    expect(node?.internal_field, 'internal_field survives the swap').toBe('note');
    expect(node?.required, 'required survives the swap').toBe(true);
    expect(node?.props?.['format']).toBe('us_zip');
  });

  test('§8.5 Style-tab Width preset buttons write design_overrides.size.width; Reset removes a custom_px (re-inherits the preset)', async ({ page }) => {
    const vert = `c-size-${uniq}`;
    const section = await createStudioSection(page.request, `C1 Size ${uniq}`, ACT_A, vert);
    await page.goto(`/admin/leadgen/sections/${section.public_id}/edit`, { waitUntil: 'domcontentloaded' });

    await page.frameLocator('#lg-studio-canvas-frame').locator('#lg-studio-canvas-render [data-component-type="ZIPInputQuestion"]').click();
    await page.locator('[data-studio-inspector-tab="style"]').click();
    const fullBtn = page.locator('[data-set-width="full"]');
    await expect(fullBtn).toBeVisible();
    await fullBtn.click();
    await expect(fullBtn).toHaveClass(/active/);

    await Promise.all([page.waitForEvent('load'), page.locator('#lg-section-save').click()]);
    let detail = await json<{ content_json: { components: Array<{ question_id: string; design_overrides?: { size?: { width?: unknown } } }> } }>(
      await page.request.get(`${LG_API}/sections/${section.public_id}`),
      'size-preset section detail (full)',
    );
    let zipNode = detail.content_json.components.find((c) => c.question_id === 'q_zip');
    expect(zipNode?.design_overrides?.size?.width, 'preset writes a STRING preset name').toBe('full');

    // re-select, switch to a DIFFERENT preset, then use Reset (§7.1 bullet 4)
    await page.frameLocator('#lg-studio-canvas-frame').locator('#lg-studio-canvas-render [data-component-type="ZIPInputQuestion"]').click();
    await page.locator('[data-studio-inspector-tab="style"]').click();
    await page.locator('[data-set-width="s"]').click();
    await expect(page.locator('[data-set-width="s"]')).toHaveClass(/active/);
    await expect(page.locator('[data-set-width="full"]')).not.toHaveClass(/active/);

    await Promise.all([page.waitForEvent('load'), page.locator('#lg-section-save').click()]);
    await page.frameLocator('#lg-studio-canvas-frame').locator('#lg-studio-canvas-render [data-component-type="ZIPInputQuestion"]').click();
    await page.locator('[data-studio-inspector-tab="style"]').click();
    await expect(page.locator('[data-set-width="s"]')).toHaveClass(/active/);
    await page.screenshot({ path: `${SHOT_DIR}/c1-02-size-preset-s.png` });

    detail = await json<{ content_json: { components: Array<{ question_id: string; design_overrides?: { size?: { width?: unknown } } }> } }>(
      await page.request.get(`${LG_API}/sections/${section.public_id}`),
      'size-preset section detail (s)',
    );
    zipNode = detail.content_json.components.find((c) => c.question_id === 'q_zip');
    expect(zipNode?.design_overrides?.size?.width).toBe('s');
  });

  test('§8.5b Style-tab Corners + Border color actually render on the canvas field (fix-round adversarial-review MAJOR-1 — was a silent no-op before this fix)', async ({ page }) => {
    const vert = `c-appearance-${uniq}`;
    const section = await createStudioSection(page.request, `C1 Appearance ${uniq}`, ACT_A, vert);
    await page.goto(`/admin/leadgen/sections/${section.public_id}/edit`, { waitUntil: 'domcontentloaded' });

    await page.frameLocator('#lg-studio-canvas-frame').locator('#lg-studio-canvas-render [data-component-type="ZIPInputQuestion"]').click();
    await page.locator('[data-studio-inspector-tab="style"]').click();

    // hydration() stamps data-component-type/data-question-id/data-lg-input
    // on the SAME <input> element (presets.ts) — this locator is the actual
    // rendered field, not a studio-added wrapper.
    const canvasInput = page.frameLocator('#lg-studio-canvas-frame').locator('[data-question-id="q_zip"][data-lg-input]');
    await expect(canvasInput).toBeVisible();
    // BEFORE: proves the assertions below are a REAL, visible CHANGE — not a
    // coincidental match against the base design's own default radius
    // (designs/default-funnel/tokens.ts input.borderRadius = "10px").
    const baseRadius = await canvasInput.evaluate((el) => getComputedStyle(el).borderRadius);
    expect(baseRadius).not.toBe('20px');

    const pillBtn = page.locator('[data-set-corners="pill"]');
    await expect(pillBtn).toBeVisible();
    await pillBtn.click();
    await expect(pillBtn).toHaveClass(/active/);

    const brandBtn = page.locator('[data-set-border-color="brand"]');
    await expect(brandBtn).toBeVisible();
    await brandBtn.click();
    await expect(brandBtn).toHaveClass(/active/);

    // LIVE canvas proof (not just persistence + the segment's own "active"
    // highlight, which is ALL the pre-fix code already did): the rendered
    // field itself now carries the §3.3 pill radius (20px) and the default
    // design's OWN brand token (color.primary #1B3A5C = rgb(27, 58, 92)) as
    // its border color — read via getComputedStyle so a CSS-cascade/
    // specificity regression would be caught too, not just an attribute
    // string. scheduleCanvasRender debounces ~300ms, so poll rather than a
    // single synchronous read.
    await expect.poll(() => canvasInput.evaluate((el) => getComputedStyle(el).borderRadius)).toBe('20px');
    await expect.poll(() => canvasInput.evaluate((el) => getComputedStyle(el).borderColor)).toBe('rgb(27, 58, 92)');
    await page.screenshot({ path: `${SHOT_DIR}/c1-05-style-corners-border-color.png` });

    // persists + reloads with the segment still marked active AND the
    // canvas still visibly reflecting it (mirrors the Width-preset test's
    // own save/reload convention above).
    await Promise.all([page.waitForEvent('load'), page.locator('#lg-section-save').click()]);
    await page.frameLocator('#lg-studio-canvas-frame').locator('#lg-studio-canvas-render [data-component-type="ZIPInputQuestion"]').click();
    await page.locator('[data-studio-inspector-tab="style"]').click();
    await expect(page.locator('[data-set-corners="pill"]')).toHaveClass(/active/);
    await expect(page.locator('[data-set-border-color="brand"]')).toHaveClass(/active/);
    await expect.poll(() => canvasInput.evaluate((el) => getComputedStyle(el).borderRadius)).toBe('20px');

    const detail = await json<{ content_json: { components: Array<{ question_id: string; design_overrides?: { corners?: string; border_color?: string } }> } }>(
      await page.request.get(`${LG_API}/sections/${section.public_id}`),
      'appearance section detail',
    );
    const zipNode = detail.content_json.components.find((c) => c.question_id === 'q_zip');
    expect(zipNode?.design_overrides?.corners).toBe('pill');
    expect(zipNode?.design_overrides?.border_color).toBe('brand');
  });

  test('§8.5b Border color CASCADE close-out — an overridden field still shows the FOCUS/[aria-invalid] state color, not its resting role color (adversarial-review cascade-regression fix)', async ({ page }) => {
    const vert = `c-appearance-cascade-${uniq}`;
    const section = await createStudioSection(page.request, `C1 Appearance Cascade ${uniq}`, ACT_A, vert);
    await page.goto(`/admin/leadgen/sections/${section.public_id}/edit`, { waitUntil: 'domcontentloaded' });

    await page.frameLocator('#lg-studio-canvas-frame').locator('#lg-studio-canvas-render [data-component-type="ZIPInputQuestion"]').click();
    await page.locator('[data-studio-inspector-tab="style"]').click();
    const canvasInput = page.frameLocator('#lg-studio-canvas-frame').locator('[data-question-id="q_zip"][data-lg-input]');
    await expect(canvasInput).toBeVisible();

    // Accent (#E85D26 / rgb(232, 93, 38)) — deliberately NOT Brand: the
    // default design's color.primary (#1B3A5C) is COINCIDENTALLY identical
    // to input.focusBorderColor, so a Brand-colored field can never
    // distinguish "still showing its role color" (the bug) from "showing
    // the focus color" (the fix) — Accent's hex differs from BOTH the focus
    // (#1B3A5C) and invalid (#D32F2F) colors, so each state below is
    // unambiguous.
    const accentBtn = page.locator('[data-set-border-color="accent"]');
    await expect(accentBtn).toBeVisible();
    await accentBtn.click();
    await expect(accentBtn).toHaveClass(/active/);

    // RESTING: the role color shows.
    await expect.poll(() => canvasInput.evaluate((el) => getComputedStyle(el).borderColor)).toBe('rgb(232, 93, 38)');

    // FOCUSED: designs/default-funnel/styles.ts's `.lg-input:focus` rule
    // (higher specificity — a pseudo-class beats a bare class) must win over
    // the resting-state var(--lg-field-border, …) default. Before this fix
    // (a direct inline border-color) this assertion FAILS — the field would
    // stay accent-colored even while focused.
    await canvasInput.focus();
    await expect.poll(() => canvasInput.evaluate((el) => getComputedStyle(el).borderColor)).toBe('rgb(27, 58, 92)');
    await page.screenshot({ path: `${SHOT_DIR}/c1-06-style-border-color-focus.png` });

    // Blur, then simulate the runtime's OWN aria-invalid="true" marker
    // (setFieldError — exercised elsewhere in this file's §9.2 sim tests;
    // this test targets the CSS rule's reaction to the attribute, not the
    // validation logic that sets it) — `.lg-input[aria-invalid="true"]`
    // must ALSO keep winning over the resting-state var default.
    await canvasInput.evaluate((el) => (el as HTMLElement).blur());
    await canvasInput.evaluate((el) => el.setAttribute('aria-invalid', 'true'));
    await expect.poll(() => canvasInput.evaluate((el) => getComputedStyle(el).borderColor)).toBe('rgb(211, 47, 47)');

    // Clearing aria-invalid (still un-focused) reverts to the resting role
    // color — the override itself is untouched by either transient state.
    await canvasInput.evaluate((el) => el.removeAttribute('aria-invalid'));
    await expect.poll(() => canvasInput.evaluate((el) => getComputedStyle(el).borderColor)).toBe('rgb(232, 93, 38)');
  });

  test('§8.6 Rules tab: "Always show" by default; "Add a condition" reveals the picker and renders the sentence "Show this question when X is Y"', async ({ page }) => {
    const vert = `c-rules-${uniq}`;
    const section = await createStudioSection(page.request, `C1 Rules ${uniq}`, ACT_A, vert);
    await page.goto(`/admin/leadgen/sections/${section.public_id}/edit`, { waitUntil: 'domcontentloaded' });

    await page.frameLocator('#lg-studio-canvas-frame').locator('#lg-studio-canvas-render [data-component-type="ZIPInputQuestion"]').click();
    await page.locator('[data-studio-inspector-tab="rules"]').click();

    const alwaysRow = page.locator('[data-rules-always-row]');
    await expect(alwaysRow).toBeVisible();
    await expect(alwaysRow).toContainText('Always show');
    await expect(page.locator('[data-rules-condition-fields]')).toBeHidden();

    await page.locator('[data-rules-add-condition]').click();
    await expect(alwaysRow).toBeHidden();
    const fields = page.locator('[data-rules-condition-fields]');
    await expect(fields).toBeVisible();
    await fields.locator('[data-inspector-cond="when"]').selectOption('currently_insured');
    const boolValue = fields.locator('[data-inspector-cond="value-bool"]');
    await expect(boolValue).toBeVisible();
    await boolValue.selectOption('true');
    await expect(fields.locator('[data-cond-sentence]')).toHaveText('Show this question when currently_insured is true');
    await page.screenshot({ path: `${SHOT_DIR}/c1-03-rules-sentence.png` });

    // "Remove condition" returns to Always show
    await page.locator('[data-rules-remove-condition]').click();
    await expect(alwaysRow).toBeVisible();
    await expect(fields).toBeHidden();

    await Promise.all([page.waitForEvent('load'), page.locator('#lg-section-save').click()]);
    const detail = await json<{ content_json: { components: Array<{ question_id: string; conditional?: unknown }> } }>(
      await page.request.get(`${LG_API}/sections/${section.public_id}`),
      'rules-removed section detail',
    );
    expect(detail.content_json.components.find((c) => c.question_id === 'q_zip')?.conditional).toBeUndefined();
  });

  test('§8.8 Advanced disclosure: collapsed by default, re-collapses per new selection, opening emits section_advanced_opened to the console', async ({ page }) => {
    const vert = `c-adv-${uniq}`;
    const section = await createStudioSection(page.request, `C1 Advanced ${uniq}`, ACT_A, vert);
    await page.goto(`/admin/leadgen/sections/${section.public_id}/edit`, { waitUntil: 'domcontentloaded' });

    await page.frameLocator('#lg-studio-canvas-frame').locator('#lg-studio-canvas-render [data-component-type="ZIPInputQuestion"]').click();
    const toggle = page.locator('[data-studio-advanced-toggle]');
    const body = page.locator('[data-studio-advanced-body]');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(body).toBeHidden();

    const consoleEvents: string[] = [];
    page.on('console', (msg) => {
      if (msg.text().includes('section_advanced_opened')) consoleEvents.push(msg.text());
    });
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(body).toBeVisible();
    await expect(body.locator('input[data-inspector-field="internal_field"]')).toHaveValue('zip');
    await page.waitForTimeout(200);
    expect(consoleEvents.length, 'section_advanced_opened logged on open').toBeGreaterThan(0);
    await page.screenshot({ path: `${SHOT_DIR}/c1-04-advanced-open.png` });

    // re-collapses on a NEW selection (§8.8 "collapsed by default" per selection)
    await page.frameLocator('#lg-studio-canvas-frame').locator('#lg-studio-canvas-render [data-component-type="TwoButtonYesNo"]').click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(body).toBeHidden();
  });

  test('§10.6 drawer "Preview theme" switcher: populates from the REAL themes KV, re-renders via POST theme_id; "Manage theme →" links to /admin/leadgen/themes', async ({ page }) => {
    const themeName = `C1 Bold ${uniq}`;
    const createdTheme = await json<{ item: { id: string; name: string } }>(
      await page.request.post('/api/admin/leadgen/themes', {
        data: {
          name: themeName,
          roles: {
            brand_primary: '#0B5FFF',
            accent: '#AA3300',
            page_bg: '#F4F6F9',
            card: '#F9FAFC',
            text: '#101828',
            success: '#127A3B',
            error: '#B42318',
          },
          typography: { headline_font: 'Newsreader', body_font: 'Inter', base_px: 16 },
          controls: { field_height: 'medium', button_size: 'm', corners: 'rounded' },
          spacing: 'cozy',
        },
      }),
      'create preview theme',
    );

    const vert = `c-theme-${uniq}`;
    const section = await createStudioSection(page.request, `C1 Theme Preview ${uniq}`, ACT_A, vert);
    await page.goto(`/admin/leadgen/sections/${section.public_id}/edit`, { waitUntil: 'domcontentloaded' });

    const themeSelect = page.locator('[data-studio-preview-theme]');
    await expect(themeSelect.locator(`option[value="${createdTheme.item.id}"]`)).toHaveText(themeName, { timeout: 10_000 });

    const manageLink = page.locator('[data-studio-manage-theme-link]');
    // v3.1 §10.2 fix round (M1): the link now carries ?from=<section public_id>
    // so the Themes manager's "Back to section" can return HERE (was a bare
    // href — the stale assertion this replaces predates that fix).
    await expect(manageLink).toHaveAttribute('href', `/admin/leadgen/themes?from=${section.public_id}`);
    await expect(manageLink).toHaveText('Manage theme →');

    // picking a theme re-renders the preview via the SAME additive theme_id
    // param the section-preview endpoint already accepts (Phase A).
    const [previewReq] = await Promise.all([
      page.waitForRequest((req) => req.url().includes('/sections/preview') && req.method() === 'POST'),
      themeSelect.selectOption(createdTheme.item.id),
    ]);
    const body = previewReq.postDataJSON() as { theme_id?: string };
    expect(body.theme_id).toBe(createdTheme.item.id);
    await page.screenshot({ path: `${SHOT_DIR}/c1-05-preview-theme-switcher.png` });
  });
});
