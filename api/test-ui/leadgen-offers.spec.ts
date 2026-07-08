// LeadGen Phase 4 Stage B2 — the Offers admin UI CP2 click-through
// (contract 03 §9.2 / 04 §10–§11), end-to-end:
//   ① the offers list loads with the seeded rows + §10.2 kind badges and
//     after-paint analytics hydration (0 counts + em-dash NULL ratios);
//   ② the §10.1 create modal: empty submit blocked with inline errors +
//     top summary, fill the required fields (static kind) → save → lands
//     in the editor (draft-then-configure);
//   ③ the editor for a static offer: Basics + Static tabs visible,
//     Payload/Request/Test hidden (BINDING-RULING tab union); set the
//     static bid + banner URL → Save → success + persisted;
//   ④ back on the list the created row shows the Static badge;
//   ⑤ the dynamic seeded offer's editor: Payload/Request/Test present, the
//     §11.1 builder renders the seeded schema tree + live preview + the
//     inline dry-run panel, the §11.6 Test panel renders, and the
//     §11.6/§11.7 Response-parsing panel shows its 11 canonical-Carrier
//     rows prefilled from the seeded carrier_parse_json (NO live provider
//     call is made);
//   ⑥ archive from the list row actions behind a confirm → the status pill
//     flips to archived.
//
// Runs against the playwright.config.ts webServer (wrangler dev on :8787
// with DEV_BYPASS_AUTH:true + ADMIN_HOST:127.0.0.1 — see that file's header
// for why the local ADMIN_HOST substitutes the loopback hostname). Local D1
// must be migrated once: `npm run db:migrate:local`.
//
// Screenshots (1280×800) land in test-artifacts/leadgen-offers/ — the
// repo's per-test Playwright artifact location (playwright.config.ts
// outputDir; gitignored).

import { test, expect } from '@playwright/test';
import { seedLeadgenOffers, type SeededLeadgenOffers } from './leadgen-p4-seed';

test.use({ viewport: { width: 1280, height: 800 } });

const SHOT_DIR = 'test-artifacts/leadgen-offers';
const uniq = Date.now();
const createdName = `E2E LG Created ${uniq}`;
// Set in ① (serial suite) and reused by every later step.
let seed: SeededLeadgenOffers;
// Set in ② after the create modal redirects to the editor.
let createdEditorPath = '';

test.describe.serial('LeadGen Offers — CP2 click-through', () => {
  test('① offers list loads with seeded rows, kind badges and hydrated analytics', async ({ page }) => {
    seed = await seedLeadgenOffers(page.request, uniq);

    await page.goto(`/admin/leadgen/offers?search=${uniq}`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.leadgen-tab.active')).toHaveText('Offers');

    const staticRow = page.locator(`tr[data-entity-name="${seed.staticOfferName}"]`);
    const dynamicRow = page.locator(`tr[data-entity-name="${seed.dynamicOfferName}"]`);
    await expect(staticRow).toBeVisible();
    await expect(dynamicRow).toBeVisible();

    // §10.2 kind badges (axis = calls_provider_api) + placement id column
    await expect(staticRow.locator('.badge-draft').first()).toHaveText('Static');
    await expect(dynamicRow.locator('.badge-scheduled').first()).toHaveText('Dynamic');
    await expect(staticRow).toContainText(`pl-static-${uniq}`);

    // §9.1 after-paint analytics hydration: real zero counts, em-dash for
    // the NULLIF-null ratios (never a fake 0 ratio), skeletons gone.
    await expect(staticRow.locator('td[data-metric="offer_impressions"]')).toHaveText('0');
    await expect(staticRow.locator('td[data-metric="ctr"]')).toHaveText('—');
    await expect(staticRow.locator('td[data-metric="offer_impressions"] .skel')).toHaveCount(0);

    await page.screenshot({ path: `${SHOT_DIR}/01-list-seeded.png` });
  });

  test('② create modal: empty submit blocked inline; required static kind saves into the editor', async ({ page }) => {
    await page.goto('/admin/leadgen/offers', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: '+ Create an Offer' }).first().click();
    await expect(page.locator('#lg-offer-modal')).toBeVisible();

    // §9.6 validation state: empty submit → inline field errors + top summary
    await page.locator('#lg-offer-modal-save').click();
    await expect(page.locator('#lg-offer-modal-error')).toBeVisible();
    await expect(page.locator('#lg-offer-modal-error')).toContainText('Please fix the highlighted');
    await expect(page.locator('[data-error-for="offer_name"]')).toBeVisible();
    await expect(page.locator('[data-error-for="auction_mode"]')).toBeVisible();
    await expect(page.locator('#lg-offer-modal-status')).toHaveText('Validation failed');
    await page.screenshot({ path: `${SHOT_DIR}/02-modal-required-errors.png` });

    // Fill EXACTLY the §10.1 required fields (static kind).
    await page.locator('#lg-offer-name').fill(createdName);
    await page.locator('#lg-offer-activity').fill('quote_funnel');
    await page.locator('#lg-offer-vertical').fill('life');
    await page.locator('#lg-offer-tracking-method').selectOption('s2s_postback');
    await page.locator('#lg-offer-type').selectOption('cpc');
    await page.locator('[data-placement-input]').first().fill(`pl-created-${uniq}`);
    // §10.2 mode picker: picking the static kind reveals the optional
    // static-bid fields (conditional reveal).
    await expect(page.locator('#lg-offer-static-conditional')).toBeHidden();
    await page.locator('#lg-offer-mode-0').check(); // static_no_request
    await expect(page.locator('#lg-offer-static-conditional')).toBeVisible();
    await page.screenshot({ path: `${SHOT_DIR}/03-modal-filled.png` });

    // Save → draft offer created → redirect to the editor (§10.1).
    await page.locator('#lg-offer-modal-save').click();
    await page.waitForURL(/\/admin\/leadgen\/offers\/[^/]+\/edit$/);
    createdEditorPath = new URL(page.url()).pathname;
    await expect(page.locator('.lg-editor-title')).toHaveText(createdName);
  });

  test('③ static editor: ruling tab set; set static bid + banner URL → save persists', async ({ page }) => {
    expect(createdEditorPath).not.toBe('');
    await page.goto(createdEditorPath, { waitUntil: 'domcontentloaded' });

    // BINDING RULING for a pure-static offer: Basics + Static visible,
    // Payload/Request/Test hidden.
    await expect(page.locator('[data-lg-tab-btn="basics"]')).toBeVisible();
    await expect(page.locator('[data-lg-tab-btn="static"]')).toBeVisible();
    await expect(page.locator('[data-lg-tab-btn="region"]')).toBeVisible();
    await expect(page.locator('[data-lg-tab-btn="cap"]')).toBeVisible();
    await expect(page.locator('[data-lg-tab-btn="analytics"]')).toBeVisible();
    await expect(page.locator('[data-lg-tab-btn="payload"]')).toBeHidden();
    await expect(page.locator('[data-lg-tab-btn="request"]')).toBeHidden();
    await expect(page.locator('[data-lg-tab-btn="test"]')).toBeHidden();
    await page.screenshot({ path: `${SHOT_DIR}/04-editor-static-tabs.png` });

    // Static tab: bid + banner URL template (canonical macro), then Save.
    await page.locator('[data-lg-tab-btn="static"]').click();
    await page.locator('#lg-edit-bid-value').fill('3.75');
    await page.locator('#lg-edit-bid-currency').selectOption('USD');
    await page.locator('#lg-edit-banner-template').fill(`https://banners.e2e.example/c?cid={click_id}&n=${uniq}`);
    await page.locator('#lg-editor-save').click();
    await expect(page.locator('.toast')).toContainText('Offer saved');
    await page.screenshot({ path: `${SHOT_DIR}/05-editor-saved.png` });

    // Fresh SSR proves persistence (PATCH round-trip, not DOM residue).
    await page.goto(createdEditorPath, { waitUntil: 'domcontentloaded' });
    await page.locator('[data-lg-tab-btn="static"]').click();
    await expect(page.locator('#lg-edit-bid-value')).toHaveValue('3.75');
    await expect(page.locator('#lg-edit-banner-template')).toHaveValue(new RegExp('\\{click_id\\}'));
  });

  test('④ back on the list: the created row renders with the Static badge', async ({ page }) => {
    await page.goto(`/admin/leadgen/offers?search=${uniq}`, { waitUntil: 'domcontentloaded' });
    const createdRow = page.locator(`tr[data-entity-name="${createdName}"]`);
    await expect(createdRow).toBeVisible();
    await expect(createdRow.locator('.badge-draft').first()).toHaveText('Static');
    await expect(createdRow).toContainText(`pl-created-${uniq}`);
    await page.screenshot({ path: `${SHOT_DIR}/06-list-created-row.png` });
  });

  test('⑤ dynamic editor: Payload/Request/Test present; builder renders the schema tree; Test panel renders', async ({ page }) => {
    await page.goto(`/admin/leadgen/offers/${seed.dynamicOfferPublicId}/edit`, { waitUntil: 'domcontentloaded' });

    // BINDING RULING for a CPC dynamic offer.
    await expect(page.locator('[data-lg-tab-btn="payload"]')).toBeVisible();
    await expect(page.locator('[data-lg-tab-btn="request"]')).toBeVisible();
    await expect(page.locator('[data-lg-tab-btn="test"]')).toBeVisible();
    await expect(page.locator('[data-lg-tab-btn="static"]')).toBeHidden();

    // §11.1 builder (fix-P2 §6.1 three-pane rebuild): the seeded schema
    // renders as the payload TREE — both explicit nodes with their paths, the
    // answer node badged mapped, the macro node's source held by the grouped
    // source picker — plus the live preview.
    await page.locator('[data-lg-tab-btn="payload"]').click();
    await expect(page.locator('#lg-pb-tree .lg-pb-node[data-pb-uid]')).toHaveCount(2);
    await expect(page.locator('#lg-pb-tree [data-pb-path="data.zip"]')).toBeVisible();
    await expect(page.locator('#lg-pb-tree [data-pb-path="data.zip"] .lg-pb-badge-mapped')).toBeVisible();
    await expect(page.locator('#lg-pb-tree [data-pb-path="meta.click_id"]')).toBeVisible();
    await page.locator('[data-pb-select="meta.click_id"]').click();
    await expect(page.locator('#lg-pb-editor [data-pb-source-select]')).toHaveValue('macro:click_id');
    await expect(page.locator('#lg-schema-preview')).toContainText('data.zip');
    await expect(page.locator('#lg-payload-meta')).toContainText('Active schema: v1');

    // §11.1 "Test with sample answers" = the dry-run panel, INSIDE the
    // Payload tab — now behind a collapsed Advanced drawer (§6.14: raw JSON
    // only behind Advanced). Results stay hidden until a run; none runs here.
    const dryrunDrawer = page.locator('#lg-dryrun-advanced');
    await expect(dryrunDrawer).toBeVisible();
    await expect(page.locator('#lg-dryrun-answers')).toBeHidden();
    await dryrunDrawer.locator('summary').click();
    await expect(page.locator('#lg-dryrun-run')).toBeVisible();
    await expect(page.locator('#lg-dryrun-results')).toBeHidden();
    await page.screenshot({ path: `${SHOT_DIR}/07-dynamic-editor-builder.png` });

    // Request tab SSR'd from the seed (endpoints present).
    await page.locator('[data-lg-tab-btn="request"]').click();
    await expect(page.locator('#lg-endpoint-production')).toHaveValue('https://provider.e2e.example/api/quotes');

    // §11.6 Test panel renders its panels — do NOT run a live provider call.
    // The raw-answers editor sits behind the collapsed Advanced drawer
    // (fix-P2 §6.14); the generated form + run button are the normal path.
    await page.locator('[data-lg-tab-btn="test"]').click();
    await expect(page.locator('#lg-test-environment')).toBeVisible();
    await expect(page.locator('#lg-test-form')).toBeVisible();
    await expect(page.locator('#lg-test-answers')).toBeHidden();
    await expect(page.locator('#lg-test-run')).toBeVisible();
    await expect(page.locator('#lg-test-results')).toBeHidden();

    // §11.6/§11.7 Response-parsing panel: the 11 canonical-Carrier rows,
    // prefilled from the seeded schema version's carrier_parse_json (the
    // fallback array renders comma-joined). Still no provider call.
    await expect(page.locator('#lg-parse-carriers-path')).toHaveValue('carriers');
    await expect(page.locator('#lg-parse-rows .lg-parse-row')).toHaveCount(11);
    await expect(page.locator('[data-parse-field="carrier_name"] [data-parse-input]')).toHaveValue('name');
    await expect(page.locator('[data-parse-field="bid"] [data-parse-input]')).toHaveValue('price.amount, bid');
    await expect(page.locator('[data-parse-field="headline"] [data-parse-input]')).toHaveValue('');
    await expect(page.locator('#lg-parse-save')).toBeVisible();
    await page.screenshot({ path: `${SHOT_DIR}/08-dynamic-test-panel.png` });
  });

  test('⑥ archive from row actions with confirm → the status pill flips', async ({ page }) => {
    await page.goto(`/admin/leadgen/offers?search=${uniq}`, { waitUntil: 'domcontentloaded' });
    const row = page.locator(`tr[data-entity-name="${seed.staticOfferName}"]`);
    await expect(row.locator('.badge-published')).toHaveText('active');

    // §7.1: row actions now live behind a kebab menu — open it, then pick the
    // Archive menuitem (scoped to this offer's row).
    await row.getByRole('button', { name: /More actions/i }).click();
    page.once('dialog', (dialog) => void dialog.accept());
    await row.locator('[data-offer-archive]').click();
    await expect(page.locator('.toast')).toContainText('Offer archived');

    // The archive flow reloads the list (§9.6 reversible status flip — the
    // row survives with the archived pill; DELETE never hard-deletes).
    await expect(
      page.locator(`tr[data-entity-name="${seed.staticOfferName}"] .badge-archived`),
    ).toHaveText('archived');
    await page.screenshot({ path: `${SHOT_DIR}/09-archived.png` });
  });
});
