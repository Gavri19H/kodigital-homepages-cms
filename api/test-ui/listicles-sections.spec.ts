import { test, expect, type Page } from '@playwright/test';

// Listicles Phase 4 — §26 "Sections" manual-QA behaviors, end-to-end:
//   create (name, image upload, clickable headline → Offer modal → chip),
//   check/emoji lists + curated colour spans, a ≥6-button choice group
//   (bulk-offer inheritance + per-button Offer + reorder + duplicate), an
//   inline offerlink via the toolbar (the §13 Offer modal is FORCED — no URL
//   input exists anywhere), final text CTA + linked image, CTA/Link
//   Inventory accuracy (rows == governed elements; jump works; bulk
//   replace), save → reload → content_json round-trip with lnk_… ids, and
//   the list's "Offers used" / "Usage in Articles" dialogs reflecting the
//   new links.
//
// Runs against the playwright.config.ts webServer (wrangler dev on
// :<PW_PORT>, default 8787, DEV_BYPASS_AUTH + ADMIN_HOST=127.0.0.1). Local D1
// must be migrated once: `npm run db:migrate:local`.
//
// Screenshots (1280×800) land in test-artifacts/listicles-sections/.

test.use({ viewport: { width: 1280, height: 800 } });

const SHOT_DIR = 'test-artifacts/listicles-sections';
const uniq = Date.now();
const sectionName = `E2E Section ${uniq}`;
const offerAName = `E2E SecOffer A ${uniq}`;
const offerBName = `E2E SecOffer B ${uniq}`;
const offerCName = `E2E SecOffer C ${uniq}`;
const inlineWord = `zqlinkword${uniq}`;

// A 1×1 transparent PNG for the upload flows.
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

let sectionEditUrl = '';

async function createOffer(page: Page, name: string): Promise<{ id: number; public_id: string }> {
  const res = await page.request.post('/api/admin/listicles/offers', {
    data: {
      offer_name: name,
      provider: 'e2eprov',
      activity: 'lead',
      vertical: 'finance',
      conversion_tracking_method: 'browser_side_pixel',
      offer_url_template: 'https://sec.e2e.example/c?cid={click_id}',
      payout_method: 'offsite',
    },
  });
  expect(res.status()).toBe(201);
  const body = (await res.json()) as { offer: { id: number; public_id: string } };
  return body.offer;
}

// Pick an offer inside the OPEN §13 picker by its unique name.
async function pickOffer(page: Page, name: string): Promise<void> {
  const picker = page.locator('#lst-offer-picker');
  await expect(picker).toBeVisible();
  await page.locator('#lst-offer-picker-search').fill(name);
  const row = picker.locator('.lst-picker-row', { hasText: name }).first();
  await expect(row).toBeVisible();
  await row.click();
  await expect(picker).toBeHidden();
}

function contentJson(page: Page): Promise<string> {
  return page.locator('#content_json').inputValue();
}

test.describe.serial('Listicles Sections — §26 behaviors', () => {
  test('create: name, image upload, clickable headline → Offer modal → chip', async ({ page }) => {
    await createOffer(page, offerAName);
    await createOffer(page, offerBName);
    await createOffer(page, offerCName);

    await page.goto('/admin/listicles/sections', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.listicles-tab.active')).toHaveText('Sections');
    // Phase 4: the Create button is a LIVE link now.
    await page.locator('a.btn.btn-primary[href="/admin/listicles/sections/new"]').first().click();
    await page.waitForURL('**/admin/listicles/sections/new');

    await page.locator('#lst-section-name').fill(sectionName);
    await page.locator('#lst-headline-text').fill('The very best pick');

    // §10 image upload through the reused (relabeled) card. The AI-image
    // surface is asserted BEFORE the upload (a set image hides the uploader
    // block by design); generation itself needs a live OpenAI key — not
    // exercised in dev.
    await expect(page.locator('#hero-image-card .card-title').first()).toHaveText('Section image');
    await expect(page.locator('#hero-image-ai-generate')).toBeVisible();
    await page.locator('#hero-image-upload').setInputFiles({
      name: 'section.png',
      mimeType: 'image/png',
      buffer: PNG_1PX,
    });
    await expect(page.locator('#hero-image-preview-wrap')).toBeVisible();

    // Clickable headline forces the §13 Offer modal; the chip shows the pick.
    await page.locator('#lst-headline-clickable').click();
    await pickOffer(page, offerAName);
    await expect(page.locator('#lst-headline-chip')).toBeVisible();
    await expect(page.locator('#lst-headline-chip-name')).toHaveText(offerAName);
    await expect(page.locator('#lst-headline-clickable')).toBeChecked();

    await page.screenshot({ path: `${SHOT_DIR}/01-create-headline-chip.png` });
  });

  test('content: check + emoji lists, colour span, 6-button choice group (reorder/dup/per-button), offerlink, final CTA, linked image', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('/admin/listicles/sections/new', { waitUntil: 'domcontentloaded' });
    await page.locator('#lst-section-name').fill(sectionName);
    await page.locator('#lst-headline-text').fill('The very best pick');
    await page.locator('#lst-headline-clickable').click();
    await pickOffer(page, offerAName);

    // --- paragraph + curated colour span + inline offerlink ------------------
    const firstEditable = page.locator('#content-editor .editable-text').first();
    await firstEditable.click();
    await firstEditable.pressSequentially(`Intro copy ${inlineWord} more`);
    // colour: select all → colour menu → brand swatch
    await firstEditable.press('ControlOrMeta+a');
    await page.locator('.editor-toolbar .toolbar-btn', { hasText: /^A$/ }).click();
    await page.locator('.lst-popover .lst-color-swatch[data-token="brand"]').click();
    // content_json is a JSON string — attribute quotes are escaped inside it.
    await expect
      .poll(async () => /data-lst-color=\\?"brand/.test(await contentJson(page)))
      .toBe(true);

    // inline offerlink via the toolbar — the Offer modal is FORCED.
    const para = page.locator('#content-editor .editable-text').first();
    await para.dblclick({ position: { x: 10, y: 10 } });
    // Select the unique word precisely via the DOM selection API.
    await page.evaluate((word) => {
      const root = document.querySelector('#content-editor .editable-text');
      if (!root) return;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node: Node | null = walker.nextNode();
      while (node) {
        const idx = (node.textContent || '').indexOf(word);
        if (idx >= 0) {
          const range = document.createRange();
          range.setStart(node, idx);
          range.setEnd(node, idx + word.length);
          const sel = window.getSelection();
          sel?.removeAllRanges();
          sel?.addRange(range);
          return;
        }
        node = walker.nextNode();
      }
    }, inlineWord);
    await page.locator('.editor-toolbar .toolbar-btn', { hasText: 'Offer link' }).click();
    await pickOffer(page, offerBName);
    await expect
      .poll(async () => /data-offer=\\?"off_/.test(await contentJson(page)))
      .toBe(true);

    // NO URL input exists anywhere in the link flows (§13/§26).
    await expect(page.locator('input[type="url"]')).toHaveCount(0);
    await expect(page.locator('input[name*="url" i]:visible, textarea[name*="url" i]:visible')).toHaveCount(0);

    // --- check list + emoji list ----------------------------------------------
    await page.locator('.add-block-btn').click();
    await page.locator('.block-menu-item', { hasText: 'Bullet List' }).first().click();
    await page.locator('.editable-list .list-item-input').last().pressSequentially('No fees at all');
    await page.locator('.editor-toolbar .toolbar-btn', { hasText: '✔ List' }).click();
    await expect.poll(async () => (await contentJson(page)).includes('"marker": "check"')).toBe(true);

    await page.locator('.add-block-btn').click();
    await page.locator('.block-menu-item', { hasText: 'Bullet List' }).first().click();
    await page.locator('.editable-list').last().locator('.list-item-input').last().pressSequentially('Shiny extra');
    await page.locator('.editor-toolbar .toolbar-btn', { hasText: '😀 List' }).click();
    await page.locator('.lst-popover .lst-emoji-btn').first().click();
    await expect.poll(async () => (await contentJson(page)).includes('"marker": "emoji"')).toBe(true);

    // --- choice button group: ≥6 buttons, bulk-offer, per-button, reorder, dup
    await page.locator('.add-block-btn').click();
    await page.locator('.block-menu-item', { hasText: 'Choice Button Group' }).first().click();
    await pickOffer(page, offerAName); // group preset binds its first button
    const group = page.locator('[data-lst-kind="choice-group"]');
    await expect(group).toBeVisible();
    await group.locator('.lst-choice-item-row[data-item-index="0"] .lst-choice-text').fill('California');
    // + Add button ×5 — each new button REUSES the previous binding (§30.5).
    const addBtn = group.locator('.lst-tool-btn', { hasText: '+ Add button' });
    const labels = ['Texas', 'New York', 'Florida', 'Washington', 'Other'];
    for (let i = 0; i < labels.length; i++) {
      await addBtn.click();
      const row = group.locator(`.lst-choice-item-row[data-item-index="${i + 1}"]`);
      await expect(row).toBeVisible();
      await row.locator('.lst-choice-text').fill(labels[i] as string);
    }
    await expect(group.locator('.lst-choice-item-row')).toHaveCount(6);
    // per-button Offer on button #3
    await group.locator('.lst-choice-item-row[data-item-index="2"] .lst-chip-btn').click();
    await pickOffer(page, offerCName);
    await expect(
      group.locator('.lst-choice-item-row[data-item-index="2"] .lst-offer-chip-label'),
    ).toHaveText(offerCName);
    // reorder: move "Texas" (index 1) up → becomes index 0
    await group.locator('.lst-choice-item-row[data-item-index="1"] .lst-tool-btn[title="Move up"]').click();
    await expect(group.locator('.lst-choice-item-row[data-item-index="0"] .lst-choice-text')).toHaveValue('Texas');
    // duplicate the first button → 7 buttons (≥6 requirement exceeded)
    await group.locator('.lst-choice-item-row[data-item-index="0"] .lst-tool-btn[title="Duplicate"]').click();
    await expect(group.locator('.lst-choice-item-row')).toHaveCount(7);
    await page.screenshot({ path: `${SHOT_DIR}/02-choice-group-7-buttons.png` });

    // --- final text CTA + linked image ----------------------------------------
    await page.locator('.add-block-btn').click();
    await page.locator('.block-menu-item', { hasText: 'Final Text CTA' }).first().click();
    await pickOffer(page, offerBName);
    await page.locator('[data-lst-kind="final-cta"] .lst-field[data-lst-field="text"]').fill('See if you qualify today');

    await page.locator('.add-block-btn').click();
    await page.locator('.block-menu-item', { hasText: 'Linked Image (Offer)' }).first().click();
    await pickOffer(page, offerCName);
    const linkedImage = page.locator('[data-lst-kind="linked-image"]');
    await linkedImage.locator('.lst-li-file').setInputFiles({
      name: 'linked.png',
      mimeType: 'image/png',
      buffer: PNG_1PX,
    });
    await expect(linkedImage.locator('.lst-li-preview-img')).toBeVisible();
    await linkedImage.locator('.lst-field[data-lst-field="alt"]').fill('A cozy home');

    // --- CTA / Link Inventory accuracy (§30.6) ---------------------------------
    // rows == governed elements: headline 1 + inline 1 + choice 7 + CTA 1 + image 1
    const invRows = page.locator('#lst-inv-body tr');
    await expect(invRows).toHaveCount(11);
    const governedCount = await page.evaluate(() => {
      const ed = (window as unknown as { blockEditor: { getGovernedElements(): unknown[] } }).blockEditor;
      return ed.getGovernedElements().length;
    });
    expect(governedCount + 1).toBe(11); // +1 = the headline row
    await expect(invRows.filter({ hasText: 'Missing Offer' })).toHaveCount(0);
    // jump-to-block focuses the target block
    await page.locator('#lst-inv-body tr', { hasText: 'choice_button' }).first()
      .locator('[data-inv-action="jump"]').click();
    await expect(page.locator('.editor-block.focused [data-lst-kind="choice-group"]')).toBeVisible();

    // --- §30.6 Section preview: token wrapper + desktop/mobile toggle ----------
    const previewFrame = page.frameLocator('#lst-section-preview');
    await expect(previewFrame.locator('.lst-choice-btn').first()).toBeVisible({ timeout: 15_000 });
    expect(await previewFrame.locator('.lst-choice-btn').count()).toBeGreaterThanOrEqual(6);
    await page.locator('#lst-preview-mobile').click();
    await expect(page.locator('#lst-section-preview')).toHaveClass(/lst-preview-mobile/);
    await page.locator('#lst-preview-desktop').click();
    await expect(page.locator('#lst-section-preview')).not.toHaveClass(/lst-preview-mobile/);
    await page.screenshot({ path: `${SHOT_DIR}/03-inventory-preview.png` });

    // --- save → redirect (§8 Save state) ----------------------------------------
    await page.locator('#lst-section-save').click();
    await page.waitForURL('**/admin/listicles/sections');
    await page.screenshot({ path: `${SHOT_DIR}/04-saved-list.png` });
  });

  test('reload: content_json round-trips with lnk_… ids; bulk replace across the Section', async ({ page }) => {
    await page.goto('/admin/listicles/sections', { waitUntil: 'domcontentloaded' });
    const row = page.locator('tr', { hasText: sectionName }).first();
    await expect(row).toBeVisible();
    await row.locator('a', { hasText: 'Edit' }).click();
    await page.waitForURL('**/edit');
    sectionEditUrl = page.url();

    // Round-trip: the stored document carries the enriched governance.
    const json = await contentJson(page);
    const doc = JSON.parse(json) as {
      blocks: Array<{ type: string; data: Record<string, unknown> }>;
    };
    const group = doc.blocks.find((b) => b.type === 'choice_button_group');
    expect(group).toBeTruthy();
    const items = (group?.data.items ?? []) as Array<Record<string, unknown>>;
    expect(items.length).toBe(7);
    for (const item of items) {
      expect(String(item.link_instance_id)).toMatch(/^lnk_/);
      expect(String(item.offer_id)).toMatch(/^off_/);
      expect(item.style_id).toBe('reference-choice-button');
    }
    expect(json).toMatch(/"marker":\s*"check"/);
    expect(json).toMatch(/"marker":\s*"emoji"/);
    expect(json).toContain('data-lst-color=');
    expect(json).toContain('final_text_cta');
    expect(json).toContain('linked_image');
    expect(json).toMatch(/data-offer=\\?"off_/);
    expect(json).toMatch(/data-link-instance=\\?"lnk_/);

    // The inventory reflects the STORED ids after reload (no "(on save)").
    await expect(page.locator('#lst-inv-body tr')).toHaveCount(11);
    await expect(page.locator('#lst-inv-body tr', { hasText: '(on save)' })).toHaveCount(0);

    // Bulk replace: every element bound to Offer A moves to Offer C (§30.6).
    await page.locator('#lst-bulk-from').selectOption({ label: offerAName });
    await page.locator('#lst-bulk-replace').click();
    await pickOffer(page, offerCName);
    await expect(page.locator('#lst-inv-body tr', { hasText: offerAName })).toHaveCount(0);
    await page.screenshot({ path: `${SHOT_DIR}/05-bulk-replaced.png` });

    // Leave without saving the bulk change (the round-trip stays canonical).
    page.on('dialog', (dialog) => void dialog.accept());
    await page.goto('/admin/listicles/sections', { waitUntil: 'domcontentloaded' });
  });

  test('"Offers used" / "Usage in Articles" reflect the section links (§10/§26)', async ({ page }) => {
    await page.goto('/admin/listicles/sections', { waitUntil: 'domcontentloaded' });
    const row = page.locator('tr', { hasText: sectionName }).first();
    // Round-4 P1d: these two actions now live inside the shared kebab
    // (layout.ts renderKebabOpen/kebabMenuScript) instead of flat row
    // buttons. Opening the kebab REPARENTS its menu to <body> (a portal —
    // escapes .table-wrapper's forced overflow-y clip and .admin-main's
    // isolated stacking context), so once open its items are document-level,
    // not row-scoped — read the row's OWN numeric id (data-entity-id, which
    // data-section-offers/-usage are keyed on) and locate via page.locator
    // from here on; the toggle button and row stay put, only the menu's
    // contents move.
    const sectionId = await row.getAttribute('data-entity-id');
    await row.getByRole('button', { name: /More actions/i }).click();
    await page.locator(`[data-section-offers="${sectionId}"]`).click();
    const dialog = page.locator('#lst-dialog');
    await expect(dialog).toBeVisible();
    // The saved section's roles are attributed per offer (§5.4 rollup).
    await expect(dialog.locator('.lst-usage-list li', { hasText: 'choice_button' }).first()).toBeVisible();
    await expect(dialog.locator('.lst-usage-list li', { hasText: 'headline' }).first()).toBeVisible();
    await expect(dialog.locator('.lst-usage-list li', { hasText: 'final_text_cta' }).first()).toBeVisible();
    await expect(dialog.locator('.lst-usage-list li', { hasText: 'linked_image' }).first()).toBeVisible();
    await page.screenshot({ path: `${SHOT_DIR}/06-offers-used.png` });
    await dialog.locator('[data-dialog-close]').click();

    await row.getByRole('button', { name: /More actions/i }).click();
    await page.locator(`[data-section-usage="${sectionId}"]`).click();
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('No articles use this section yet.');
    await dialog.locator('[data-dialog-close]').click();
  });

  test('editor page hygiene: no URL field anywhere on the section editor (§13 DOM assertion)', async ({ page }) => {
    await page.goto(sectionEditUrl || '/admin/listicles/sections/new', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#content-editor .editor-toolbar')).toBeVisible();
    // DOM-level: zero url-typed inputs; zero visible url-named fields. The
    // hidden Create-Offer modal's offer_url_template/cap_fallback_url are the
    // §9 Offer DEFINITION (and stay hidden until "＋ New Offer" is used).
    await expect(page.locator('input[type="url"]')).toHaveCount(0);
    await expect(page.locator('input[name*="url" i]:visible, textarea[name*="url" i]:visible')).toHaveCount(0);
    // The legacy link toolbar action (URL prompt) does not exist in listicle
    // mode — the Offer-link action replaces it.
    await expect(page.locator('.editor-toolbar .toolbar-btn[title*="[text](url)"]')).toHaveCount(0);
    await expect(page.locator('.editor-toolbar .toolbar-btn', { hasText: 'Offer link' })).toBeVisible();
    await page.screenshot({ path: `${SHOT_DIR}/07-editor-no-url-field.png` });
  });
});
