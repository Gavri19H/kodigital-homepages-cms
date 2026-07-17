import { test, expect } from '@playwright/test';

// Listicles Phase 3 — §26 "Offers" manual-QA behaviors, end-to-end:
//   create with all fields (required-field block visible first), macro chip
//   insertion at the caret, {clickid}→{click_id} normalization on save,
//   In-site conditional reveal, cap conditional reveal + fallback, edit,
//   delete-in-use → 409 usage dialog → "Archive instead", and the
//   "View attribution to Sections" dialog.
//
// Runs against the playwright.config.ts webServer (wrangler dev on
// :<PW_PORT>, default 8787, with DEV_BYPASS_AUTH:true + ADMIN_HOST:127.0.0.1
// — see that file's header for why the local ADMIN_HOST substitutes the
// loopback hostname). Local D1
// must be migrated once: `npm run db:migrate:local`.
//
// Screenshots (1280×800) land in test-artifacts/listicles-offers/ — the
// repo's per-test Playwright artifact location (playwright.config.ts
// outputDir; gitignored). The html reporter clears ./test-results when it
// writes its report, so durable evidence lives in the sibling folder.

test.use({ viewport: { width: 1280, height: 800 } });

const SHOT_DIR = 'test-artifacts/listicles-offers';
const uniq = Date.now();
const offerName = `E2E Offer ${uniq}`;
const editedName = `E2E Offer ${uniq} v2`;
const sectionName = `E2E Section ${uniq}`;
const fallbackName = `E2E Fallback Target ${uniq}`;
// Set in the create test (serial suite) and asserted again on edit.
let fallbackOfferId = 0;

test.describe.serial('Listicles Offers — §26 behaviors', () => {
  test('required-field block: an empty submit is blocked with inline errors', async ({ page }) => {
    await page.goto('/admin/listicles/offers', { waitUntil: 'domcontentloaded' });

    // §4: the Listicles nav entry + active sub-tab render
    await expect(page.locator('.sidebar-nav a[href="/admin/listicles"]')).toBeVisible();
    await expect(page.locator('.listicles-tab.active')).toHaveText('Offers');

    await page.getByRole('button', { name: '+ Create an Offer' }).first().click();
    await expect(page.locator('#offer-modal')).toBeVisible();

    await page.locator('#offer-modal-save').click();
    // §8 validation state: top alert + inline field error + aria-live status
    await expect(page.locator('#offer-modal-error')).toBeVisible();
    await expect(page.locator('#offer-modal-error')).toContainText('Please fix the highlighted');
    await expect(page.locator('[data-error-for="offer_name"]')).toBeVisible();
    await expect(page.locator('#offer-modal-status')).toHaveText('Validation failed');

    await page.screenshot({ path: `${SHOT_DIR}/01-required-field-block.png` });
    await page.locator('#offer-modal-cancel').click();
    await expect(page.locator('#offer-modal')).toBeHidden();
  });

  test('create with all fields: chip at caret, {clickid} feedback, In-site + cap reveals, fallback', async ({ page }) => {
    // Seed a deterministic, ACTIVE fallback target for the search-fed picker
    // (§9 cap fallback / §13 search behavior).
    const fallbackRes = await page.request.post('/api/admin/listicles/offers', {
      data: {
        offer_name: fallbackName,
        provider: 'e2eprov',
        activity: 'lead',
        vertical: 'finance',
        conversion_tracking_method: 'browser_side_pixel',
        offer_url_template: 'https://fallback.e2e.example/c?cid={click_id}',
        payout_method: 'offsite',
      },
    });
    expect(fallbackRes.status()).toBe(201);
    fallbackOfferId = ((await fallbackRes.json()) as { offer: { id: number } }).offer.id;

    await page.goto('/admin/listicles/offers', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: '+ Create an Offer' }).first().click();
    await expect(page.locator('#offer-modal')).toBeVisible();

    await page.locator('#offer-name').fill(offerName);
    await page.locator('#offer-provider').fill('e2eprov');
    await page.locator('#offer-activity').fill('lead');
    await page.locator('#offer-vertical').fill('finance');
    await page.locator('#offer-tag').fill('summer');
    await page.locator('#offer-tracking-method').selectOption('s2s_postback');

    // §9.4 macro chip inserts AT THE CARET (deterministic mid-string caret)
    const urlBox = page.locator('#offer-url-template');
    await urlBox.fill('https://x.example/a?b=1');
    await urlBox.evaluate((el) => {
      (el as HTMLTextAreaElement).focus();
      (el as HTMLTextAreaElement).setSelectionRange(8, 8);
    });
    await page.locator('.macro-chip[data-macro="utm_source"]').click();
    await expect(urlBox).toHaveValue('https://{utm_source}x.example/a?b=1');

    // unknown-macro warn (client mirror of §23; server stays authoritative)
    await urlBox.fill('https://track.e2e.example/c?cid={bogus_macro}');
    await expect(page.locator('#offer-url-unknown-warn')).toBeVisible();
    await expect(page.locator('#offer-url-unknown-warn')).toContainText('bogus_macro');

    // the real template with the {clickid} alias → normalization feedback
    await urlBox.fill('https://track.e2e.example/c?cid={clickid}&geo={country}');
    await expect(page.locator('#offer-url-unknown-warn')).toBeHidden();
    await expect(page.locator('#offer-url-normalize-note')).toBeVisible();
    await expect(page.locator('#offer-url-normalize-note')).toContainText('normalized to {click_id}');

    // §9 In-site conditional reveal
    await expect(page.locator('#offer-payout-conditional')).toBeHidden();
    await page.locator('#offer-payout-method').selectOption('in_site');
    await expect(page.locator('#offer-payout-conditional')).toBeVisible();
    await page.locator('#offer-payout-currency').selectOption('USD');
    await page.locator('#offer-payout-value').fill('12.5');

    // §9 cap conditional reveal + fallback
    await expect(page.locator('#offer-cap-conditional')).toBeHidden();
    await page.locator('#offer-cap-enabled').check();
    await expect(page.locator('#offer-cap-conditional')).toBeVisible();
    await page.locator('#offer-cap-amount').fill('100');
    await page.locator('#offer-cap-timezone').selectOption('America/New_York');
    await page.locator('#offer-cap-count-by').selectOption('clicks');

    // §9/§13: search-fed fallback-OFFER picker — type → debounced results →
    // select → the hidden cap_fallback_offer_id binds the chosen offer
    await expect(page.locator('#offer-fallback-search')).toBeVisible();
    await page.locator('#offer-fallback-search').fill(fallbackName);
    const resultBtn = page.locator('#offer-fallback-results button', { hasText: fallbackName });
    await expect(resultBtn).toBeVisible();
    await resultBtn.click();
    await expect(page.locator('#offer-cap-fallback-offer-id')).toHaveValue(String(fallbackOfferId));
    await expect(page.locator('#offer-fallback-selected')).toBeVisible();
    await expect(page.locator('#offer-fallback-selected')).toContainText(fallbackName);

    await page.locator('#offer-cap-fallback-url').fill('/capped-fallback');

    await page.screenshot({ path: `${SHOT_DIR}/02-create-modal-filled.png` });

    await page.locator('#offer-modal-save').click();
    // §8 Save state → success toast → list refresh renders the new row
    const createdRow = page.locator(`tr[data-entity-name="${offerName}"]`);
    await expect(createdRow).toBeVisible();
    await expect(createdRow.locator('td').nth(4)).toHaveText('S2S postback');
    // §8 analytics hydration completed: the impressions cell shows a real
    // post-hydration value ("0" from the empty mirrors), not a skeleton
    await expect(createdRow.locator('td[data-metric="impressions"]')).toHaveText('0');
    await expect(createdRow.locator('td[data-metric="impressions"] .skel')).toHaveCount(0);
    await page.screenshot({ path: `${SHOT_DIR}/03-offers-list-created.png` });
  });

  test('{clickid} was normalized to {click_id} on save (visible in Edit)', async ({ page }) => {
    await page.goto('/admin/listicles/offers', { waitUntil: 'domcontentloaded' });
    const row = page.locator(`tr[data-entity-name="${offerName}"]`);
    await row.getByRole('button', { name: 'Edit' }).click();
    await expect(page.locator('#offer-modal')).toBeVisible();
    await expect(page.locator('#offer-modal-title')).toHaveText('Edit Offer');

    const value = await page.locator('#offer-url-template').inputValue();
    expect(value).toContain('{click_id}');
    expect(value).not.toContain('{clickid}');
    // the persisted conditional fields render revealed on edit
    await expect(page.locator('#offer-payout-conditional')).toBeVisible();
    await expect(page.locator('#offer-cap-conditional')).toBeVisible();
    await expect(page.locator('#offer-cap-fallback-url')).toHaveValue('/capped-fallback');
    // the fallback OFFER chosen via the picker persisted on save; the label
    // resolves asynchronously to the target's display name
    await expect(page.locator('#offer-cap-fallback-offer-id')).toHaveValue(String(fallbackOfferId));
    await expect(page.locator('#offer-fallback-selected')).toContainText(fallbackName);

    await page.screenshot({ path: `${SHOT_DIR}/04-edit-normalized.png` });

    // §26 edit: rename and save
    await page.locator('#offer-name').fill(editedName);
    await page.locator('#offer-modal-save').click();
    await expect(page.locator(`tr[data-entity-name="${editedName}"]`)).toBeVisible();
  });

  test('delete-in-use → 409 usage dialog → Archive instead; attribution view', async ({ page }) => {
    await page.goto('/admin/listicles/offers', { waitUntil: 'domcontentloaded' });

    // Make the offer "in use": create a section whose button links it (§5.3).
    const listRes = await page.request.get(
      `/api/admin/listicles/offers?search=${encodeURIComponent(editedName)}`,
    );
    expect(listRes.ok()).toBeTruthy();
    const listBody = (await listRes.json()) as { offers: Array<{ id: number }> };
    expect(listBody.offers.length).toBeGreaterThan(0);
    const offerId = listBody.offers[0].id;

    const sectionRes = await page.request.post('/api/admin/listicles/sections', {
      data: {
        section_name: sectionName,
        headline_text: 'E2E headline',
        content_json: {
          blocks: [
            { type: 'paragraph', data: { text: 'Why we love it' } },
            { type: 'button', data: { text: 'Get the deal', offer_id: offerId, style: 'primary' } },
          ],
        },
      },
    });
    expect(sectionRes.status()).toBe(201);

    // Delete → confirm() → 409 dialog with usage + "Archive instead" (§26)
    const row = page.locator(`tr[data-entity-name="${editedName}"]`);
    page.once('dialog', (dialog) => void dialog.accept());
    await row.getByRole('button', { name: 'Delete' }).click();

    await expect(page.locator('#lst-dialog')).toBeVisible();
    await expect(page.locator('#lst-dialog-title')).toHaveText('Offer in use');
    await expect(page.locator('#lst-dialog-body')).toContainText(sectionName);
    await expect(page.locator('#lst-dialog-body')).toContainText('Archive the offer instead');
    await page.screenshot({ path: `${SHOT_DIR}/05-409-usage-dialog.png` });

    await page.getByRole('button', { name: 'Archive instead' }).click();
    // archived via PATCH status=archived → row survives with the archived badge
    await expect(
      page.locator(`tr[data-entity-name="${editedName}"] .badge-archived`),
    ).toBeVisible();
    await expect(
      page.locator(`tr[data-entity-name="${editedName}"] .badge-archived`),
    ).toHaveText('archived');

    // §9/§26 View attribution to Sections
    await page
      .locator(`tr[data-entity-name="${editedName}"]`)
      .getByRole('button', { name: 'Attribution to Sections' })
      .click();
    await expect(page.locator('#lst-dialog-title')).toContainText('Attribution to Sections');
    await expect(page.locator('#lst-dialog-body')).toContainText(sectionName);
    await page.screenshot({ path: `${SHOT_DIR}/06-attribution-to-sections.png` });
  });
});
