// Section Builder v3.1 REMEDIATION — phase R6, SEAM 2 (browser half).
//
// The server 409 + maps_no_job problem + fix_url is proven at the HTTP boundary
// in test/leadgen-r6-seams.test.ts. THIS proves the wired CONSUMER: the quotes
// UI renders the activation preflight panel with the maps_no_job problem row AND
// a fix_url deep link pointing at the section's MAPS surface (the #mapping
// anchor). Real admin UI driving (chromium), API read-back on the 409 — modelled
// on leadgen-quote-builder.spec.ts test ⑨ (the C2 chrome BLOCK), the SAME
// preflight-panel render path.
import { test, expect, type APIRequestContext } from '@playwright/test';
import { seedActiveSite } from './listicles-p6-seed';

test.use({ viewport: { width: 1280, height: 900 } });

const LG_API = '/api/admin/leadgen';
const SHOT = 'test-artifacts';
const uniq = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

async function json<T>(res: { ok(): boolean; status(): number; json(): Promise<unknown>; text(): Promise<string> }, label: string): Promise<T> {
  if (!res.ok()) throw new Error(`${label} HTTP ${res.status()}: ${await res.text()}`);
  return (await res.json()) as T;
}
async function createMapsNoJobSection(request: APIRequestContext): Promise<{ id: number; public_id: string; name: string }> {
  const name = `R6 Seam2 Maps-No-Job ${uniq}`;
  const s = await json<{ id: number; public_id: string }>(await request.post(`${LG_API}/sections`, {
    data: {
      section_name: name, activity: 'quote_funnel', vertical: 'life', headline_text: 'What is your ZIP code?',
      continue_mode: 'button', status: 'active',
      content_json: { components: [
        { type: 'QuestionHeadline', question_id: 'q_head', props: { text: 'What is your ZIP code?' } },
        // Maps ENABLED with ZERO jobs → the unconditional §9.3 activation BLOCK.
        { type: 'ZIPInputQuestion', question_id: 'q_zip', question_key: 'k_zip', internal_field: 'zip', props: { maps: { enabled: true, jobs: { validate: false, auction: false, autocomplete: false } } } },
        { type: 'ContinueButton', question_id: 'q_cont', props: { label: 'Continue' } },
      ] },
    },
  }), 'seam2 section');
  return { ...s, name };
}

test('SEAM 2 (browser) — a maps_no_job BLOCK renders the preflight panel + a fix link to the section Maps surface', async ({ page }) => {
  test.setTimeout(120_000);
  // --- seed a site + a quote whose section is maps-enabled with 0 jobs --------
  const host = `lg-r6seam2-${uniq}.e2e.test`;
  const siteId = await seedActiveSite(page.request, host, `R6 Seam2 Site ${uniq}`);
  const section = await createMapsNoJobSection(page.request);
  const quote = await json<{ public_id: string; funnels: Array<{ public_id: string; variants: Array<{ public_id: string }> }> }>(
    await page.request.post(`${LG_API}/quotes`, { data: { quote_name: `R6 Seam2 Quote ${uniq}`, activity: 'quote_funnel', verticals: ['life'] } }), 'seam2 quote');
  const funnelPublicId = quote.funnels[0]!.public_id;
  const variantId = quote.funnels[0]!.variants[0]!.public_id;
  await json(await page.request.put(`${LG_API}/variants/${variantId}`, { data: { sections: [{ section_id: section.id }] } }), 'seam2 variant');
  await json(await page.request.put(`${LG_API}/funnels/${funnelPublicId}/frame`, { data: { frame_config_json: { version: 1, template: 'centered' } } }), 'seam2 frame');

  // --- drive the REAL activation attempt in the quotes UI ---------------------
  await page.goto(`/admin/leadgen/quotes/${quote.public_id}/edit`, { waitUntil: 'domcontentloaded' });
  await page.locator('.lg-qtab[data-tab="activation"]').click();
  const row = page.locator(`.lg-activation-row[data-site-id="${siteId}"]`);
  await expect(row, 'the seeded site appears in the activation list').toBeVisible({ timeout: 20_000 });
  await row.locator('[data-site-enabled]').check();
  await row.locator('[data-site-slug]').fill(`r6-seam2-${uniq}`);
  const blockedResponse = page.waitForResponse((r) => r.request().method() === 'PUT' && r.url().includes(`/quotes/${quote.public_id}/activation/`));
  await row.locator('[data-save-activation]').click();

  // --- the 409 carries the maps_no_job problem (server truth) -----------------
  const blocked = await blockedResponse;
  expect(blocked.status(), 'activation is BLOCKED (409)').toBe(409);
  const body = (await blocked.json()) as { error: string; problems: Array<{ path: string; severity: string; message: string; fix_url?: string }> };
  expect(body.error).toBe('quote_activation_blocked');
  const mapsPath = `section.${section.public_id}.components[q_zip].props.maps`;
  const mapsProblem = body.problems.find((p) => p.path === mapsPath);
  expect(mapsProblem, `409 body carries the maps_no_job problem; got ${JSON.stringify(body.problems)}`).toBeDefined();
  expect(mapsProblem!.fix_url).toBe(`/admin/leadgen/sections/${section.public_id}/edit#mapping`);

  // --- the quotes UI renders the preflight panel + the maps fix link ----------
  await expect(page.locator('#lg-preflight-panel')).toHaveAttribute('data-preflight-state', 'blocked');
  const problemRow = page.locator(`#lg-preflight-problems [data-problem-path="${mapsPath}"]`);
  await expect(problemRow, 'the maps_no_job problem row renders in the panel').toBeVisible();
  await expect(problemRow.locator('.lg-problem-chip[data-severity="error"]')).toHaveText('Error');
  await expect(problemRow, 'the operator-facing copy explains the no-job state').toContainText('no job selected');
  // The fix link's label comes from quotes-tabs/activation.ts problemFixLabel
  // (re-exported by ui-quotes.ts, ONE source for SSR + the fetched panel
  // refresh — no ES5 duplicate) — a fix_url containing "/sections/" renders
  // "Edit Section", not "Review slide" (MEASURED live; quotes-handlers.ts:6727
  // names the same convention "[Edit Section]"). The deep link ITSELF (the
  // #mapping anchor — SECTION_MAPPING_LINK) is the wired seam under test here;
  // re-minted to the shipped label.
  const fixLink = problemRow.locator('a', { hasText: 'Edit Section' });
  await expect(fixLink, 'the fix link renders').toBeVisible();
  await expect(fixLink).toHaveAttribute('href', `/admin/leadgen/sections/${section.public_id}/edit#mapping`);
  await page.screenshot({ path: `${SHOT}/leadgen-r6-seam2-maps-no-job-blocked.png` });

  // --- API read-back: the blocked activation persisted NOTHING ----------------
  const after = await json<{ sites: Array<{ site_id: string; activated: boolean }> }>(await page.request.get(`${LG_API}/quotes/${quote.public_id}/activation`), 'seam2 activation read');
  const siteRow = after.sites.find((s) => s.site_id === siteId);
  expect(siteRow?.activated ?? false, 'the blocked PUT persisted no activation').toBe(false);
});
