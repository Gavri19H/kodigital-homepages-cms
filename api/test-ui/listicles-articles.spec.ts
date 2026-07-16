import { test, expect, type Page } from '@playwright/test';

// Listicles Phase 5 — the §26 "Articles + experimentation" manual-QA flow,
// end-to-end (the parts that do not require live traffic):
//   create (Site is required gate) → auto control Version → edit control →
//   Pages builder: ab_test 70/30 (per-page Σ green only at 100) + rule_based
//   with the §26 example verbatim (state=CA & device=mobile → C,
//   traffic_source=newsbreak → D, fallback → E) → an equal-priority overlap
//   attempt BLOCKED with the §15.5 conflict matrix → fixed → saved (cross-
//   priority warning surfaced) → "A/B this Article" (draft) → fork Version B
//   → 60/40 with the Σ indicator green only at 100 → start → running
//   immutability → the §15.6/§30.7 fork + new-revision flows through the UI
//   → the §30.6 Version preview (rule simulation, forced candidates, CTA
//   density, desktop/mobile) → publish.
//
// Runs against the playwright.config.ts webServer (wrangler dev on
// :<PW_PORT>, default 8787, DEV_BYPASS_AUTH + ADMIN_HOST=127.0.0.1). Local D1
// must be migrated once: `npm run db:migrate:local`.
//
// Screenshots (1280×800) land in test-artifacts/listicles-articles/.

test.use({ viewport: { width: 1280, height: 800 } });

const SHOT_DIR = 'test-artifacts/listicles-articles';
const uniq = Date.now();
const siteName = `E2E Articles Site ${uniq}`;
const articleName = `E2E Article ${uniq}`;
const slug = `e2e-article-${uniq}`;
const richName = `Rich Section ${uniq}`;
const secC = `Section C ${uniq}`;
const secD = `Section D ${uniq}`;
const secE = `Section E ${uniq}`;

// A 1×1 transparent PNG for the hero upload.
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

let editUrl = '';
let siteId = '';

async function seedSite(page: Page): Promise<void> {
  const res = await page.request.post('/api/admin/sites', {
    data: {
      domain: `e2e-articles-${uniq}.example`,
      name: siteName,
      vertical_slug: 'finance',
      activity: 'main',
    },
  });
  expect(res.ok(), `site create HTTP ${res.status()}`).toBeTruthy();
  siteId = ((await res.json()) as { resource: { id: string } }).resource.id;
}

async function seedPlainSection(page: Page, name: string): Promise<void> {
  const res = await page.request.post('/api/admin/listicles/sections', {
    data: {
      section_name: name,
      headline_text: `${name} headline`,
      content_json: { blocks: [{ type: 'paragraph', data: { text: `${name} copy.` } }] },
    },
  });
  expect(res.status(), `section ${name}`).toBe(201);
}

// A section with GOVERNED content: clickable headline (1) + 2 choice buttons
// (2) + a final CTA (1) = 4 ledger rows → §30.6 CTA density 4.
async function seedRichSection(page: Page): Promise<void> {
  const offerRes = await page.request.post('/api/admin/listicles/offers', {
    data: {
      offer_name: `E2E Articles Offer ${uniq}`,
      provider: 'e2eprov',
      activity: 'lead',
      vertical: 'finance',
      conversion_tracking_method: 'browser_side_pixel',
      offer_url_template: 'https://art.e2e.example/c?cid={click_id}',
      payout_method: 'offsite',
    },
  });
  expect(offerRes.status()).toBe(201);
  const offer = ((await offerRes.json()) as { offer: { id: number } }).offer;
  const res = await page.request.post('/api/admin/listicles/sections', {
    data: {
      section_name: richName,
      headline_text: `${richName} headline`,
      headline_offer_id: offer.id,
      content_json: {
        blocks: [
          { type: 'paragraph', data: { text: 'Rich copy.' } },
          {
            type: 'choice_button_group',
            data: {
              layout_binding: 'default.choiceButtonGroup',
              items: [
                { text: 'Yes', offer_id: offer.id },
                { text: 'No', offer_id: offer.id },
              ],
            },
          },
          {
            type: 'final_text_cta',
            data: { text: 'See if you qualify', offer_id: offer.id, layout_binding: 'default.textCta' },
          },
        ],
      },
    },
  });
  expect(res.status()).toBe(201);
}

// Pick a section inside the OPEN builder Section picker by its unique name.
async function pickSection(page: Page, name: string): Promise<void> {
  const picker = page.locator('#lst-section-picker');
  await expect(picker).toBeVisible();
  await page.locator('#lst-section-picker-search').fill(name);
  const row = picker.locator('.lst-picker-row', { hasText: name }).first();
  await expect(row).toBeVisible();
  await row.click();
  await expect(picker).toBeHidden();
}

function pageCard(page: Page, index: number) {
  return page.locator(`.lst-page-card[data-page-index="${index}"]`);
}

// Add one set-dimension tag to a rule editor (dim select → tag input → Enter).
async function addRuleDim(
  ruleEditor: ReturnType<Page['locator']>,
  dim: string,
  value: string,
): Promise<void> {
  await ruleEditor.locator('.lst-rule-add-dim').selectOption(dim);
  const tagInput = ruleEditor.locator(`[data-rule-dim="${dim}"] .lst-tags input`);
  await tagInput.fill(value);
  await tagInput.press('Enter');
  await expect(ruleEditor.locator(`[data-rule-dim="${dim}"] .lst-tag`, { hasText: value })).toBeVisible();
}

test.describe.serial('Listicles Articles — §26 builder flow', () => {
  test('create: "Site is required" gate blocks, then base + auto control Version → builder (§11/§23)', async ({ page }) => {
    await seedSite(page);
    await seedRichSection(page);
    await seedPlainSection(page, secC);
    await seedPlainSection(page, secD);
    await seedPlainSection(page, secE);

    await page.goto('/admin/listicles/articles', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.listicles-tab.active')).toHaveText('Articles');
    // Phase 5: the Create button is a LIVE link now (+ the search box exists).
    await expect(page.locator('input[name="search"][aria-label="Search articles"]')).toBeVisible();
    await page.locator('a.btn.btn-primary[href="/admin/listicles/articles/new"]').first().click();
    await page.waitForURL('**/admin/listicles/articles/new');

    await page.locator('#lst-a-name').fill(articleName);
    await page.locator('#lst-a-slug').fill(slug);
    await page.locator('#lst-v-headline').fill('Control headline');
    await page.locator('#lst-v-intro').fill('First paragraph.\n\nSecond paragraph.');
    await page.locator('#hero-image-upload').setInputFiles({
      name: 'hero.png',
      mimeType: 'image/png',
      buffer: PNG_1PX,
    });
    await expect(page.locator('#hero-image-preview-wrap')).toBeVisible();

    // §26 "create (site required)": submit WITHOUT a site → the server's
    // field-keyed gate renders inline; nothing navigates.
    await page.locator('#lst-article-create').click();
    await expect(page.locator('[data-error-for="site_id"]')).toBeVisible();
    await expect(page.locator('[data-error-for="site_id"]')).toContainText('site_id is required');
    await page.screenshot({ path: `${SHOT_DIR}/01-site-required-gate.png` });

    await page.locator('#lst-a-site').selectOption({ label: siteName });
    await page.locator('#lst-article-create').click();
    await page.waitForURL('**/edit');
    editUrl = page.url();

    // §11: one control Version (A, control badge) exists; versioning stays
    // quiet (no experiment yet).
    await expect(page.locator('.lst-rail-row')).toHaveCount(1);
    await expect(page.locator('.lst-rail-row .badge', { hasText: 'Control' })).toBeVisible();
    await expect(page.locator('#lst-exp-summary')).toContainText('No experiment');
    await page.screenshot({ path: `${SHOT_DIR}/02-builder-control-version.png` });
  });

  test('pages: ab_test 70/30 (Σ green only at 100) + §26 rule_based example; equal-priority overlap BLOCKED with the §15.5 matrix; fixed save surfaces the cross-priority warning', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto(editUrl, { waitUntil: 'domcontentloaded' });

    // --- edit the control Version + §30.2 byline --------------------------------
    await page.locator('#lst-v-headline').fill('Control headline v2');
    await page.locator('#lst-b-enabled').check();
    await page.locator('#lst-b-author').fill('Jane Writer');
    await page.locator('#lst-b-updated-date').fill('June 2026');

    // --- Page 1: single → ab_test with per-candidate traffic Σ ------------------
    await page.locator('#lst-page-add').click();
    await pickSection(page, richName);
    await expect(pageCard(page, 0)).toBeVisible();
    await pageCard(page, 0).locator('.lst-page-mode').selectOption('ab_test');
    await expect(pageCard(page, 0).locator('.lst-page-abid')).toContainText('(on save)');
    await pageCard(page, 0).locator('.lst-cand-add').click();
    await pickSection(page, secD);
    const alloc = pageCard(page, 0).locator('.lst-cand-alloc-input');
    await alloc.nth(0).fill('70');
    await alloc.nth(1).fill('20');
    // §26: the Σ indicator is green ONLY at 100 — 90 is red.
    await expect(pageCard(page, 0).locator('[data-page-sigma]')).toHaveClass(/lst-sigma-bad/);
    await alloc.nth(1).fill('30');
    await expect(pageCard(page, 0).locator('[data-page-sigma]')).toHaveClass(/lst-sigma-ok/);
    await expect(pageCard(page, 0).locator('[data-page-sigma]')).toHaveText('Σ 100%');

    // --- Page 2: the §26 rule_based example --------------------------------------
    await page.locator('#lst-page-add').click();
    await pickSection(page, secC);
    await pageCard(page, 1).locator('.lst-page-mode').selectOption('rule_based');
    await pageCard(page, 1).locator('.lst-cand-add').click();
    await pickSection(page, secD);
    await pageCard(page, 1).locator('.lst-cand-add').click();
    await pickSection(page, secE);
    // fallback → E (exactly one per rule_based page).
    await pageCard(page, 1).locator('.lst-cand-row').nth(2).locator('.lst-cand-fallback').check();

    // Rule C: priority 1, state=CA & device=mobile.
    const rowC = pageCard(page, 1).locator('.lst-cand-row').nth(0);
    await rowC.locator('.lst-rule-priority').fill('1');
    await addRuleDim(rowC.locator('.lst-rule-editor'), 'state', 'CA');
    await addRuleDim(rowC.locator('.lst-rule-editor'), 'device', 'mobile');
    // Rule D: EQUAL priority 1 (the §26 blocked attempt), traffic_source=newsbreak.
    const rowD = pageCard(page, 1).locator('.lst-cand-row').nth(1);
    await rowD.locator('.lst-rule-priority').fill('1');
    await addRuleDim(rowD.locator('.lst-rule-editor'), 'traffic_source', 'newsbreak');

    // --- the equal-priority overlap BLOCKS the save with the §15.5 matrix --------
    await page.locator('#lst-version-save').click();
    await expect(page.locator('#lst-conflict-out')).toBeVisible();
    const matrix = page.locator('#lst-conflict-out .lst-conflict-matrix');
    await expect(matrix).toBeVisible();
    const blockingRow = matrix.locator('tr.lst-mx-blocking');
    await expect(blockingRow).toHaveCount(1);
    await expect(blockingRow).toContainText(secC);
    await expect(blockingRow).toContainText(secD);
    await expect(blockingRow).toContainText('same priority');
    // Overlapping cells are highlighted per dimension.
    await expect(matrix.locator('th', { hasText: 'state' })).toBeVisible();
    await expect(matrix.locator('th', { hasText: 'traffic_source' })).toBeVisible();
    await expect(blockingRow.locator('.lst-mx-hit', { hasText: 'CA' })).toBeVisible();
    await expect(blockingRow.locator('.lst-mx-hit', { hasText: 'newsbreak' })).toBeVisible();
    await page.screenshot({ path: `${SHOT_DIR}/03-conflict-matrix-blocking.png` });

    // --- fix the priority → save succeeds; cross-priority warning surfaced -------
    await rowD.locator('.lst-rule-priority').fill('2');
    await page.locator('#lst-version-save').click();
    // Saved: ab_test_id becomes a stable id (no longer "(on save)").
    await expect(pageCard(page, 0).locator('.lst-page-abid')).not.toContainText('(on save)', { timeout: 15_000 });
    await expect(pageCard(page, 0).locator('.lst-page-abid')).toContainText('ab_test_id: ab_');
    // The §15.5 cross-priority overlap is ALLOWED but surfaced (amber row).
    await expect(page.locator('#lst-conflict-out tr.lst-mx-warning')).toHaveCount(1);
    await expect(page.locator('#lst-conflict-out tr.lst-mx-blocking')).toHaveCount(0);
    await page.screenshot({ path: `${SHOT_DIR}/04-saved-with-warning.png` });

    // --- "Validate rules" runs the same §15.5 guard pre-save ----------------------
    await pageCard(page, 1).locator('.lst-rule-validate').click();
    await expect(page.locator('#lst-conflict-out tr.lst-mx-warning')).toHaveCount(1);
  });

  test('A/B this Article: draft experiment → fork Version B → 60/40 (Σ green only at 100) → start → running immutability dialog (§15.6/§15.8)', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto(editUrl, { waitUntil: 'domcontentloaded' });

    // Create the experiment as a DRAFT.
    await page.locator('#lst-ab-create').click();
    await page.locator('#lst-exp-name').fill('Headline test');
    await page.locator('#lst-exp-create-confirm').click();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('#lst-exp-summary')).toContainText('draft', { timeout: 15_000 });

    // Add Version B by forking the control (deep copy, new lander_v).
    await page.locator('#lst-add-version').click();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('.lst-rail-row')).toHaveCount(2, { timeout: 15_000 });
    const landerA = await page.locator('.lst-rail-row').nth(0).getAttribute('data-lander-v');
    const landerB = await page.locator('.lst-rail-row').nth(1).getAttribute('data-lander-v');
    expect(landerA).toMatch(/^ver_/);
    expect(landerB).toMatch(/^ver_/);
    expect(landerB).not.toBe(landerA);

    // §26: set 60/40 — the Σ indicator is green ONLY at 100.
    const allocA = page.locator('.lst-rail-row').nth(0).locator('.lst-rail-alloc input');
    const allocB = page.locator('.lst-rail-row').nth(1).locator('.lst-rail-alloc input');
    await allocA.fill('60');
    await allocB.fill('30');
    await expect(page.locator('#lst-exp-sigma')).toHaveClass(/lst-sigma-bad/);
    await expect(page.locator('#lst-exp-sigma')).toHaveText('Σ 90%');
    await expect(page.locator('#lst-exp-start')).toBeDisabled();
    await allocB.fill('40');
    await expect(page.locator('#lst-exp-sigma')).toHaveClass(/lst-sigma-ok/);
    await expect(page.locator('#lst-exp-sigma')).toHaveText('Σ 100%');
    await page.screenshot({ path: `${SHOT_DIR}/05-ab-60-40-sigma-green.png` });

    // Start → running.
    await page.locator('#lst-exp-start').click();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('#lst-exp-summary')).toContainText('running', { timeout: 15_000 });
    await expect(page.locator('#lst-exp-stop')).toBeVisible();

    // Editing a RUNNING Version opens the §15.6 immutability dialog. FIX-1:
    // a running experiment is NOT joinable (§15.8 Σ/arm-set lock) — the join
    // checkbox stays hidden and the standalone-fork copy explains why.
    await page.locator('#lst-v-headline').fill('Edited while running');
    await page.locator('#lst-version-save').click();
    await expect(page.locator('#lst-immutable-modal')).toBeVisible();
    await expect(page.locator('#lst-immutable-reason')).toContainText('RUNNING experiment');
    await expect(page.locator('#lst-imm-fork')).toBeVisible();
    await expect(page.locator('#lst-imm-revision')).toBeVisible();
    await expect(page.locator('#lst-imm-join-wrap')).toBeHidden();
    await expect(page.locator('#lst-imm-standalone-note')).toBeVisible();
    await expect(page.locator('#lst-imm-standalone-note')).toContainText('standalone DRAFT Version');
    await expect(page.locator('#lst-imm-standalone-note')).toContainText('stop the experiment and compose a new draft');
    await page.screenshot({ path: `${SHOT_DIR}/06-immutability-dialog.png` });
    await page.locator('#lst-imm-cancel').click();
    await expect(page.locator('#lst-immutable-modal')).toBeHidden();
  });

  test('§15.6/§30.7 case c through the UI: "start a new revision period" (same lander_v, bump) and fork (new lander_v)', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto(editUrl, { waitUntil: 'domcontentloaded' });
    const revisionText = await page.locator('#lst-version-revision').textContent();
    const revBefore = Number((revisionText ?? '').replace(/\D+/g, ''));
    expect(revBefore).toBeGreaterThan(0);
    const landerBefore = await page.locator('.lst-rail-row').nth(0).getAttribute('data-lander-v');

    // --- new revision period: SAME lander_v, content_version bump ---------------
    await page.locator('#lst-v-headline').fill('Explicit revision headline');
    await page.locator('#lst-version-save').click();
    await expect(page.locator('#lst-immutable-modal')).toBeVisible();
    await page.locator('#lst-imm-revision').check();
    await page.locator('#lst-imm-confirm').click();
    await expect(page.locator('#lst-version-revision')).toContainText(
      `(revision): ${revBefore + 1}`,
      { timeout: 15_000 },
    );
    // Same lander_v (the §30.7-case-b/c "same lander_v" invariant).
    await expect(page.locator('.lst-rail-row').nth(0)).toHaveAttribute('data-lander-v', landerBefore ?? '');
    await page.screenshot({ path: `${SHOT_DIR}/07-new-revision-period.png` });

    // --- fork: a NEW Version (new lander_v) carrying the pending edits ----------
    await page.locator('#lst-v-headline').fill('Forked headline');
    await page.locator('#lst-version-save').click();
    await expect(page.locator('#lst-immutable-modal')).toBeVisible();
    await page.locator('#lst-imm-fork').check();
    // leave "join the running experiment" unchecked → draft-standalone fork
    await page.locator('#lst-imm-confirm').click();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('.lst-rail-row')).toHaveCount(3, { timeout: 15_000 });
    const landers = await page.locator('.lst-rail-row').evaluateAll((rows) =>
      rows.map((r) => r.getAttribute('data-lander-v')),
    );
    expect(new Set(landers).size).toBe(3); // three distinct lander_v ids
    // The fork carries the pending edit; switching to it shows the headline.
    await page.locator('.lst-rail-row').nth(2).click();
    await expect(page.locator('#lst-v-headline')).toHaveValue('Forked headline');
    // Standalone fork → no allocation input row is REQUIRED to run; the
    // experiment Σ stays over the two running arms (60/40 = green).
    await expect(page.locator('#lst-exp-sigma')).toHaveClass(/lst-sigma-ok/);
    await page.screenshot({ path: `${SHOT_DIR}/08-forked-new-version.png` });
  });

  test('§30.6 Version preview: rule simulation via the real semantics, forced candidates, per-page CTA density, desktop/mobile', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto(editUrl, { waitUntil: 'domcontentloaded' });

    // Auto preview of the ACTIVE (control) version: full §30.2 page.
    const frame = page.frameLocator('#lst-version-preview');
    await expect(frame.locator('.lst-header')).toBeVisible({ timeout: 20_000 });
    await expect(frame.locator('.lst-title')).toContainText('Explicit revision headline');
    await expect(frame.locator('.lst-byline')).toContainText('Advertorial · By Jane Writer');
    await expect(frame.locator('.lst-disclosure-trigger')).toContainText('Advertiser Disclosure');
    await expect(frame.locator('.lst-legal')).toBeVisible();
    await expect(frame.locator('.lst-footer')).toBeVisible();

    // Density rows: page 1 = rich ab candidate (4 governed CTAs, honest
    // ab_first_preview reason); page 2 = fallback E with no ctx (0 CTAs).
    const density0 = page.locator('#lst-pv-density li[data-pv-density-page="0"]');
    const density1 = page.locator('#lst-pv-density li[data-pv-density-page="1"]');
    await expect(density0).toContainText(richName);
    await expect(density0).toContainText('ab_first_preview');
    await expect(density0.locator('.lst-pv-density-count')).toHaveText('4 CTAs');
    await expect(density1).toContainText(secE);
    await expect(density1).toContainText('fallback');
    await expect(density1.locator('.lst-pv-density-count')).toHaveText('0 CTAs');
    // The chosen candidate's density is stamped into the rendered page too.
    await expect(frame.locator('.lst-page[data-page-index="0"]')).toHaveAttribute('data-cta-density', '4');

    // --- simulate CA + mobile → rule page serves C (rule_match) -----------------
    await page.locator('#lst-pv-ctx summary').click();
    await page.locator('[data-pv-dim="state"]').fill('CA');
    await page.locator('[data-pv-dim="device"]').fill('mobile');
    await page.locator('#lst-pv-run').click();
    await expect(density1).toContainText(secC, { timeout: 15_000 });
    await expect(density1).toContainText('rule_match');
    await page.screenshot({ path: `${SHOT_DIR}/09-preview-rule-match-CA-mobile.png` });

    // --- newsbreak traffic → D (rule_match) --------------------------------------
    await page.locator('[data-pv-dim="state"]').fill('');
    await page.locator('[data-pv-dim="device"]').fill('');
    await page.locator('[data-pv-dim="traffic_source"]').fill('newsbreak');
    await page.locator('#lst-pv-run').click();
    await expect(density1).toContainText(secD, { timeout: 15_000 });
    await expect(density1).toContainText('rule_match');

    // --- force a Page candidate: beats the rules (§30.6) --------------------------
    const forceSelect = page.locator('#lst-pv-forces select[data-pv-force-page="1"]');
    await forceSelect.selectOption({ label: (await forceSelect.locator('option', { hasText: secE }).textContent()) ?? '' });
    await page.locator('#lst-pv-run').click();
    await expect(density1).toContainText(secE, { timeout: 15_000 });
    await expect(density1).toContainText('forced');

    // --- force ANOTHER Version (B) — §30.6 "force Version A/B" --------------------
    const optionB = page.locator('#lst-pv-version option', { hasText: 'Version B' });
    await page.locator('#lst-pv-version').selectOption({ label: (await optionB.textContent()) ?? '' });
    await expect(page.locator('#lst-pv-status')).toHaveText('', { timeout: 20_000 });
    await expect(frame.locator('.lst-header')).toBeVisible({ timeout: 20_000 });

    // --- desktop/mobile toggle -----------------------------------------------------
    await page.locator('#lst-pv-mobile').click();
    await expect(page.locator('#lst-version-preview')).toHaveClass(/lst-preview-mobile/);
    await page.screenshot({ path: `${SHOT_DIR}/10-preview-mobile.png` });
    await page.locator('#lst-pv-desktop').click();
    await expect(page.locator('#lst-version-preview')).not.toHaveClass(/lst-preview-mobile/);
  });

  test('publish: server re-validates and the article goes live-status (§11/§26)', async ({ page }) => {
    await page.goto(editUrl, { waitUntil: 'domcontentloaded' });

    // View structure first (§11 "View structure (read-only)").
    await page.locator('#lst-view-structure').click();
    const dialog = page.locator('#lst-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('#lst-structure-tree')).toBeVisible();
    await expect(dialog).toContainText('Version A (control)');
    await expect(dialog).toContainText('rule_based');
    await expect(dialog).toContainText('fallback');
    await page.screenshot({ path: `${SHOT_DIR}/11-view-structure.png` });
    await dialog.locator('[data-dialog-close]').click();

    await page.locator('#lst-article-publish').click();
    await expect(page.locator('#lst-article-status')).toHaveText('published', { timeout: 15_000 });
    await expect(page.locator('#lst-article-status')).toHaveClass(/badge-published/);
    await page.screenshot({ path: `${SHOT_DIR}/12-published.png` });

    // The list reflects the published article; ?search= finds it by slug
    // (site_id pinned — the list otherwise auto-picks the first site).
    await page.goto(`/admin/listicles/articles?site_id=${encodeURIComponent(siteId)}&search=${slug}`, { waitUntil: 'domcontentloaded' });
    const row = page.locator('tr', { hasText: articleName }).first();
    await expect(row).toBeVisible();
    await expect(row.locator('.badge', { hasText: 'published' })).toBeVisible();
    await expect(row.locator('a', { hasText: 'Edit' })).toBeVisible();
    await page.screenshot({ path: `${SHOT_DIR}/13-list-search-published.png` });
  });
});
