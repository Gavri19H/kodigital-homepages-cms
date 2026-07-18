// Section Builder v3.1 REMEDIATION — phase R4b (Google Maps end-to-end).
//
// The Maps-tab AUTHORING browser proof (chromium, no drags — every
// interaction below is a click/check/selectOption, never page.mouse):
//   ① toggling the auction job shows the plain-words server-key degradation
//     note; toggling it back off hides it again.
//   ② toggling the autocomplete job (with auction off) shows the S3-7
//     sibling-fill picker; the degradation note stays hidden (auction is off).
//   ③ the fills picker OFFERS the Section's OTHER internal_field values
//     (self excluded) and WRITES + PERSISTS props.maps.fills through a real
//     save/reload — proven both via the re-fetched content_json AND via the
//     inspector re-populating the same selections on a fresh page load.
//
// Follows the EXISTING leadgen-section-studio.spec.ts conventions (seed via
// the real admin API, drive the real studio page against the wrangler-dev
// webServer, canvas node selection via the srcdoc iframe frameLocator) —
// self-contained here since this phase's slice owns only NEW test files.
//
// D1 preamble (api/): pkill -f "wrangler dev"; pkill -f workerd;
// pkill -f cms-panel; sleep 2; npm run db:reset:local
//
// Screenshots (1280×800) land in test-artifacts/leadgen-r4b-maps-tab/.

import { test, expect, type APIRequestContext } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 800 } });

const SHOT_DIR = 'test-artifacts/leadgen-r4b-maps-tab';
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
        headline_text: 'What is your ZIP code?',
        continue_mode: 'button',
        status: 'active',
        content_json: {
          components: [
            { type: 'ZIPInputQuestion', question_id: 'q_zip', internal_field: 'zip', answer_type: 'string', props: { placeholder: 'ZIP code' } },
            { type: 'FreeTextQuestion', question_id: 'q_city', internal_field: 'city', answer_type: 'string' },
            { type: 'FreeTextQuestion', question_id: 'q_state', internal_field: 'state', answer_type: 'string' },
          ],
        },
        ...over,
      },
    }),
    `studio section create (${name})`,
  );
}

const ACT = `r4b-maps-act-${uniq}`;

test.describe('LeadGen Section Studio R4b — Maps-tab authoring (S3-6 degradation note + S3-7 fills picker)', () => {
  test('auction job shows the server-key degradation note; autocomplete job shows the fills picker; fills write + persist through save/reload', async ({ page }) => {
    test.setTimeout(90_000);
    const vert = `maps-tab-${uniq}`;
    const section = await createStudioSection(page.request, `R4b Maps Tab ${uniq}`, ACT, vert);

    await page.goto(`/admin/leadgen/sections/${section.public_id}/edit`, { waitUntil: 'domcontentloaded' });

    // Select the ZIP component → the Maps tab appears; open it.
    const canvasZip = page.frameLocator('#lg-studio-canvas-frame').locator('#lg-studio-canvas-render [data-component-type="ZIPInputQuestion"]');
    await canvasZip.click();
    const mapsTab = page.locator('[data-studio-inspector-tab="maps"]');
    await expect(mapsTab).toBeVisible();
    await mapsTab.click();

    // Turn Maps on.
    const toggle = page.locator('[data-maps-enabled-toggle]');
    await toggle.check();
    const jobsBlock = page.locator('[data-maps-jobs-block]');
    await expect(jobsBlock).toBeVisible();

    const degradationNote = page.locator('[data-maps-degradation-note]');
    const fillsBlock = page.locator('[data-maps-fills-block]');
    // Neither auxiliary panel shows before any job is picked.
    await expect(degradationNote).toBeHidden();
    await expect(fillsBlock).toBeHidden();

    // ① checking "Use in auction rules" reveals the degradation note.
    const auctionJob = page.locator('[data-maps-job="auction"]');
    await auctionJob.check();
    await expect(degradationNote).toBeVisible();
    await expect(degradationNote).toHaveText(
      'State and city targeting need the server key — without it, only the ZIP itself is available to auction rules.',
    );
    await expect(fillsBlock).toBeHidden(); // autocomplete still off
    await page.screenshot({ path: `${SHOT_DIR}/01-degradation-note-visible.png` });

    // unchecking auction hides the note again.
    await auctionJob.uncheck();
    await expect(degradationNote).toBeHidden();

    // ② checking "Auto-complete the address" reveals the fills picker (and
    // the degradation note stays hidden — auction is off).
    const autocompleteJob = page.locator('[data-maps-job="autocomplete"]');
    await autocompleteJob.check();
    await expect(fillsBlock).toBeVisible();
    await expect(degradationNote).toBeHidden();
    await page.screenshot({ path: `${SHOT_DIR}/02-fills-picker-visible.png` });

    // ③ the picker offers the Section's OTHER internal_field values (self —
    // "zip" — excluded) for every slot.
    const citySelect = page.locator('select[data-maps-fill-slot="city"]');
    const stateSelect = page.locator('select[data-maps-fill-slot="state"]');
    const streetSelect = page.locator('select[data-maps-fill-slot="street"]');
    const cityOptionValues = await citySelect.locator('option').evaluateAll((opts) => opts.map((o) => (o as HTMLOptionElement).value));
    expect(cityOptionValues, 'city slot offers city/state, not zip (self)').toEqual(['', 'city', 'state']);

    // Pick targets: the "City" slot fills the section's `city` field, the
    // "State" slot fills `state`. Leave "street"/"zip" as "Don't fill".
    await citySelect.selectOption('city');
    await stateSelect.selectOption('state');
    await expect(streetSelect).toHaveValue('');

    // Save → reload; re-fetch via the real GET and assert the EXACT §9.2+
    // S3-7 shape persisted (validate/auction false, autocomplete true, only
    // the two chosen fills present — no stray street/zip keys).
    await Promise.all([page.waitForEvent('load'), page.locator('#lg-section-save').click()]);
    const saved = await json<{ content_json: { components: Array<{ question_id: string; props?: Record<string, unknown> }> } }>(
      await page.request.get(`${LG_API}/sections/${section.public_id}`),
      'maps-tab section detail (post-save)',
    );
    const savedZip = saved.content_json.components.find((c) => c.question_id === 'q_zip');
    expect(savedZip?.props?.['maps'], 'the persisted §9.2+S3-7 shape').toEqual({
      enabled: true,
      jobs: { validate: false, auction: false, autocomplete: true },
      fills: { city: 'city', state: 'state' },
    });

    // Persistence proof (not just save): re-select the ZIP node on the FRESH
    // reloaded page and confirm the inspector re-populates the exact same
    // toggle/job/fill state from the re-fetched content.
    await page.frameLocator('#lg-studio-canvas-frame').locator('#lg-studio-canvas-render [data-component-type="ZIPInputQuestion"]').click();
    await page.locator('[data-studio-inspector-tab="maps"]').click();
    await expect(page.locator('[data-maps-enabled-toggle]')).toBeChecked();
    await expect(page.locator('[data-maps-job="autocomplete"]')).toBeChecked();
    await expect(page.locator('[data-maps-job="auction"]')).not.toBeChecked();
    await expect(page.locator('[data-maps-fills-block]')).toBeVisible();
    await expect(page.locator('select[data-maps-fill-slot="city"]')).toHaveValue('city');
    await expect(page.locator('select[data-maps-fill-slot="state"]')).toHaveValue('state');
    await expect(page.locator('select[data-maps-fill-slot="street"]')).toHaveValue('');
    await page.screenshot({ path: `${SHOT_DIR}/03-fills-persisted-on-reload.png` });
  });
});
