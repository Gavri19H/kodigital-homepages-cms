// LeadGen redesign-contract-v3.1 remediation R4a — pipeline + UX dead-ends,
// REAL-BROWSER coverage (forensic-defect-register.md rows S3-3/S3-9,
// E3-NEW-1/3/7/9, E3-S1). Real clicks only (no drags needed — chromium is
// the right lane per this file's own gesture-vs-click split in
// playwright.config.ts). Vitest-level coverage (computeIssues mirrors,
// operator-label single source, theme rename, SSR markup) lives in
// test/leadgen-r4a-pipeline.test.ts.
//
// Seeding rides the REAL admin HTTP API only (repo convention). Local state
// must be reset once:
// npm run db:reset:local

import { test, expect, type APIRequestContext } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 900 } });

const SHOT_DIR = 'test-artifacts/leadgen-r4a-pipeline';
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

async function createSection(
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
        content_json: {
          components: [
            { type: 'QuestionHeadline', question_id: 'q_bound_headline', bind: 'section_headline' },
            {
              type: 'TwoButtonYesNo',
              question_id: 'q_ins',
              internal_field: 'currently_insured',
              answer_type: 'boolean',
              props: { yesLabel: 'Yes', noLabel: 'No' },
            },
          ],
        },
        ...over,
      },
    }),
    `section create (${name})`,
  );
}

test.describe('R4a S3-3 — Open full mapping: scroll + pulse + focus (perceptual no-op fixed)', () => {
  test('clicking "Open full mapping →" from the Offers tab switches to the mapping drawer tab, briefly pulses the panel, and moves focus there', async ({ page }) => {
    const section = await createSection(page.request, `S3-3 Section ${uniq}`, `r4a-act-${uniq}`, `r4a-vert-${uniq}`);
    await page.goto(`/admin/leadgen/sections/${section.public_id}/edit`, { waitUntil: 'domcontentloaded' });

    // the default selection is the first real answer node (TwoButtonYesNo) —
    // its Offers tab carries "Open full mapping →"
    await page.locator('[data-studio-inspector-tab="offers"]').click();
    const openMapping = page.locator('[data-studio-open-mapping-drawer]');
    await expect(openMapping).toBeVisible();

    const mappingPanel = page.locator('[data-studio-drawer-panel="mapping"]');
    const mappingTab = page.locator('[data-studio-drawer-tab="mapping"]');
    await expect(mappingPanel).toBeHidden();

    await openMapping.click();

    // the drawer tab switched AND is now visibly noticeable — not just an
    // attribute flip below the fold
    await expect(mappingPanel).toBeVisible();
    await expect(mappingTab).toHaveAttribute('aria-selected', 'true');
    await expect(mappingTab).toBeFocused();
    // the pulse class is present immediately after the click…
    await expect(mappingPanel).toHaveClass(/studio-mapping-pulse/);
    await page.screenshot({ path: `${SHOT_DIR}/01-mapping-pulse-active.png` });
    // …and is gone again once the ~1.5s animation window elapses (JS strips
    // it — never a permanently-stuck highlight).
    await expect(mappingPanel).not.toHaveClass(/studio-mapping-pulse/, { timeout: 3_000 });
  });
});

test.describe('R4a E3-NEW-1 — first-save problems[] survive (no longer silently redirected away from)', () => {
  test('a brand-new Section with a non-blocking warning (2 Continue buttons) shows problems + a Continue affordance instead of auto-redirecting', async ({ page }) => {
    test.setTimeout(60_000);
    const activity = `r4a-new-act-${uniq}`;
    const vertical = `r4a-new-vert-${uniq}`;

    await page.goto('/admin/leadgen/sections/new', { waitUntil: 'domcontentloaded' });
    await page.locator('#lg-section-name').fill(`S3 New Section ${uniq}`);
    await page.locator('#lg-section-headline').fill('Are you currently insured?');

    // Activity/Vertical start empty on a fresh DB — use the real "+New…"
    // prompt flow (promptNewSharedValue fires window.prompt THEN a
    // window.confirm — a persistent handler answers BOTH in sequence).
    page.on('dialog', (d) => {
      if (d.type() === 'prompt') void d.accept(d.message().startsWith('New activity') ? activity : vertical);
      else void d.accept();
    });
    await page.locator('[data-studio-new-activity]').click();
    await page.waitForTimeout(200);
    await page.locator('[data-studio-new-vertical]').click();
    await page.waitForTimeout(200);

    // add a SECOND Continue button (the first is added here too — a fresh
    // Section seeds none) — triggers the non-blocking duplicate_continue
    // warning (§11.5) on save, a REAL problems[] entry from a REAL UI action.
    const continueTile = page.locator('[data-add-component="ContinueButton"]');
    await continueTile.click();
    await continueTile.click();

    const urlBeforeSave = page.url();
    await page.locator('#lg-section-save').click();

    const problemsBox = page.locator('[data-studio-save-problems]');
    await expect(problemsBox).toBeVisible({ timeout: 10_000 });
    await expect(problemsBox).toContainText('Continue button');
    // NOT auto-redirected — the fail-before behavior discarded problems by
    // navigating away immediately; the URL should NOT have changed yet.
    expect(page.url()).toBe(urlBeforeSave);
    await page.screenshot({ path: `${SHOT_DIR}/02-first-save-problems-shown.png` });

    // the explicit, operator-driven Continue affordance is present and works
    const continueBtn = page.locator('[data-continue-to-section]');
    await expect(continueBtn).toBeVisible();
    await continueBtn.click();
    await page.waitForURL(/\/admin\/leadgen\/sections\/lgs_[^/]+\/edit$/);
  });
});

test.describe('R4a E3-NEW-3 — save failure shows per-field message text', () => {
  test('clearing the required Section name and saving shows the field message inline, not just a red outline', async ({ page }) => {
    const section = await createSection(page.request, `S3-New3 ${uniq}`, `r4a-e3n3-act-${uniq}`, `r4a-e3n3-vert-${uniq}`);
    await page.goto(`/admin/leadgen/sections/${section.public_id}/edit`, { waitUntil: 'domcontentloaded' });

    // real click + select-all + Backspace (not .fill('')) — immune to the
    // browser's own autofill re-populating a shared name="section_name"
    // field when run alongside other specs in the same worker/context.
    const nameInput = page.locator('#lg-section-name');
    await nameInput.click({ clickCount: 3 });
    await nameInput.press('Backspace');
    await expect(nameInput).toHaveValue('');
    await page.locator('#lg-section-save').click();

    // the control gets the invalid outline…
    await expect(nameInput).toHaveClass(/studio-control-invalid/, { timeout: 10_000 });
    // …AND readable message text (the actual E3-NEW-3 fix — not just the
    // class). Re-pin (operator item #8 humanization, pre-round-4 raw-id
    // pin): the original assertion here (`toContainText(/section_name/i)`)
    // predates the server-side jargon-humanization pass (validateSection now
    // maps the raw field id to "Section name is required" before it ever
    // reaches this box) — the test's INTENT (a readable inline message
    // appears, not just a red outline) is preserved and strengthened: assert
    // the humanized text is present AND the raw id is gone, matching the
    // same discipline test-ui/__p1a-studio.spec.ts AC-4 already pins.
    const problemsBox = page.locator('[data-studio-save-problems]');
    await expect(problemsBox).toBeVisible();
    await expect(problemsBox).toContainText('Section name is required');
    await expect(problemsBox).not.toContainText('section_name');
    await page.screenshot({ path: `${SHOT_DIR}/03-save-failure-field-message.png` });
  });
});

test.describe('R4a E3-NEW-9 — Archive checks response.ok (client-visible failure, no silent redirect)', () => {
  test('a failed Archive (simulated 500) shows an error banner and does NOT navigate away', async ({ page }) => {
    const section = await createSection(page.request, `Archive Fail ${uniq}`, `r4a-arch-act-${uniq}`, `r4a-arch-vert-${uniq}`);
    await page.goto(`/admin/leadgen/sections/${section.public_id}/edit`, { waitUntil: 'domcontentloaded' });

    await page.route(`**${LG_API}/sections/${section.public_id}`, async (route) => {
      if (route.request().method() === 'DELETE') {
        await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'simulated archive failure' }) });
      } else {
        await route.continue();
      }
    });

    page.once('dialog', (d) => d.accept());
    const urlBeforeArchive = page.url();
    await page.locator('#lg-section-archive').click();

    const errEl = page.locator('#lg-section-error');
    await expect(errEl).toBeVisible({ timeout: 10_000 });
    await expect(errEl).toContainText('simulated archive failure');
    expect(page.url()).toBe(urlBeforeArchive); // no silent redirect on failure
    await page.screenshot({ path: `${SHOT_DIR}/04-archive-failure-shown.png` });
  });

  test('Reactivate on the sections list flips an archived Section back to active (server already supported it — only the UI action was missing)', async ({ page }) => {
    const section = await createSection(page.request, `Reactivate Me ${uniq}`, `r4a-react-act-${uniq}`, `r4a-react-vert-${uniq}`);
    // Round-4 P1c (commit 3943892/4bc4600): DELETE /sections/:id is no longer
    // archive-semantics — it now guards on variant/rule references (409 "used
    // by quotes — archive it instead") and HARD-deletes when unreferenced.
    // "archive via API" now means PATCH {status:'archived'} (the same generic
    // status leg patchSectionHandler already exposes to the Advanced UI) —
    // DELETE here would hard-delete this freshly-created, unreferenced
    // section, leaving no row for the rest of the test to find at all.
    await json(
      await page.request.patch(`${LG_API}/sections/${section.public_id}`, { data: { status: 'archived' } }),
      'archive via API',
    );

    // Round-4 P1d (register R4-02/R4-38): Archive/Usage/Reactivate/Delete now
    // live inside the shared kebab (layout.ts renderKebabOpen/kebabMenuScript)
    // instead of flat row buttons. Opening the kebab REPARENTS its menu to
    // <body> (a portal — escapes .table-wrapper's forced overflow-y clip and
    // .admin-main's isolated stacking context; see kebabMenuScript's own doc
    // comment), so once open, its items are document-level, not row-scoped —
    // locate them via page.locator(the exact public-id value), never
    // row.locator, from here on (the toggle button itself and the row stay
    // put; only the menu's own contents move).
    await page.goto('/admin/leadgen/sections', { waitUntil: 'domcontentloaded' });
    const row = page.locator(`tr[data-entity-id="${section.id}"]`);
    await row.getByRole('button', { name: /More actions/i }).click();
    const reactivateBtn = page.locator(`[data-section-reactivate="${section.public_id}"]`);
    await expect(reactivateBtn).toBeVisible();
    await expect(page.locator(`[data-section-archive="${section.public_id}"]`)).toHaveCount(0);

    page.once('dialog', (d) => d.accept());
    // The reactivate handler closes the kebab (window.lgCloseKebabs()) before
    // firing its own confirm() — a `Promise.all([page.waitForEvent('load'), …])`
    // race against that in-handler DOM mutation proved flaky here (click
    // resolves, 'load' never observed); reopening the kebab post-reload and
    // asserting on it is the same proven wait-out-the-reload idiom
    // test-ui/__p1d-lists.spec.ts already uses for quotes' Archive/Reactivate.
    await reactivateBtn.click();
    const rowAfterReactivate = page.locator(`tr[data-entity-id="${section.id}"]`);
    await expect(rowAfterReactivate.getByRole('button', { name: /More actions/i })).toBeVisible({ timeout: 10_000 });
    await rowAfterReactivate.getByRole('button', { name: /More actions/i }).click();
    await expect(page.locator(`[data-section-archive="${section.public_id}"]`)).toBeVisible();
    await expect(page.locator(`[data-section-reactivate="${section.public_id}"]`)).toHaveCount(0);

    const readBack = await json<{ status: string }>(
      await page.request.get(`${LG_API}/sections/${section.public_id}`),
      'reactivated section read-back',
    );
    expect(readBack.status).toBe('active');
    await page.screenshot({ path: `${SHOT_DIR}/05-reactivate-succeeds.png` });
  });
});

test.describe('R4a E3-NEW-7 — canvas Delete gets an undo toast, never a blocking confirm', () => {
  test('deleting the selected component shows an Undo toast with NO confirm dialog; Undo restores it via the existing history', async ({ page }) => {
    const section = await createSection(page.request, `Delete Undo ${uniq}`, `r4a-del-act-${uniq}`, `r4a-del-vert-${uniq}`);
    await page.goto(`/admin/leadgen/sections/${section.public_id}/edit`, { waitUntil: 'domcontentloaded' });

    // fail loudly if ANY native dialog appears — Delete must NOT confirm()
    page.on('dialog', (d) => {
      throw new Error(`unexpected dialog on Delete: ${d.message()}`);
    });

    // the default selection is the answer field (q_ins) — select it
    // explicitly via its canvas element to be certain, then delete via the
    // canvas toolbar's Delete button.
    const canvasFrame = page.frameLocator('#lg-studio-canvas-frame');
    await canvasFrame.locator('[data-question-id="q_ins"]').click();
    await expect(page.locator('[data-studio-breadcrumb]')).toContainText('Yes / No');

    // R5 D3 toolbar migration: "Delete" moved into the "More actions"
    // popover (data-studio-more-panel) alongside the other structure-cluster
    // actions — a real click on the "⋮" toggle opens it first (the new
    // legitimate flow; never force-clicking the hidden action directly).
    await page.locator('[data-studio-more-toggle]').click();
    await expect(page.locator('[data-studio-more-panel]')).toBeVisible();
    await page.locator('[data-studio-act="delete"]').click();

    const toast = page.locator('[data-studio-undo-toast]');
    await expect(toast).toBeVisible({ timeout: 5_000 });
    await expect(toast).toContainText('deleted');
    await expect(toast.getByRole('button', { name: 'Undo' })).toBeVisible();
    await expect(canvasFrame.locator('[data-question-id="q_ins"]')).toHaveCount(0);
    await page.screenshot({ path: `${SHOT_DIR}/06-delete-undo-toast.png` });

    await toast.getByRole('button', { name: 'Undo' }).click();
    await expect(canvasFrame.locator('[data-question-id="q_ins"]')).toBeVisible({ timeout: 5_000 });
    await expect(toast).toBeHidden();
  });

  // Conductor addition (adversarial review): the toast lingers ~6s — an
  // intervening mutation before the operator clicks Undo must invalidate
  // it, or Undo would revert the LATER change while still labeled for the
  // deleted element.
  test('a stale toast (an intervening edit happened before Undo was clicked) is invalidated — never left offering to undo the WRONG mutation', async ({ page }) => {
    const section = await createSection(page.request, `Delete Undo Stale ${uniq}`, `r4a-del2-act-${uniq}`, `r4a-del2-vert-${uniq}`);
    await page.goto(`/admin/leadgen/sections/${section.public_id}/edit`, { waitUntil: 'domcontentloaded' });

    const canvasFrame = page.frameLocator('#lg-studio-canvas-frame');
    await canvasFrame.locator('[data-question-id="q_ins"]').click();
    // R5 D3 toolbar migration: "Delete" moved into the "More actions"
    // popover — a real click on the "⋮" toggle opens it first.
    await page.locator('[data-studio-more-toggle]').click();
    await expect(page.locator('[data-studio-more-panel]')).toBeVisible();
    await page.locator('[data-studio-act="delete"]').click();

    const toast = page.locator('[data-studio-undo-toast]');
    await expect(toast).toBeVisible({ timeout: 5_000 });

    // an intervening edit — a REAL click that mutates the model again
    // (adding a component fires the SAME afterModelChange hook every other
    // mutation does)
    await page.locator('[data-add-component="ContinueButton"]').click();

    // the stale toast must be gone — not left offering an Undo that would
    // now revert the ContinueButton add instead of restoring q_ins
    await expect(toast).toBeHidden({ timeout: 2_000 });
    await page.screenshot({ path: `${SHOT_DIR}/09-stale-toast-invalidated.png` });
  });
});

test.describe('R4a E3-S1 — sections list Usage is an inline expandable panel, never window.alert()', () => {
  test('clicking Usage expands an inline panel with the real usage data; a second click collapses it; no dialog ever fires', async ({ page }) => {
    const section = await createSection(page.request, `Usage Panel ${uniq}`, `r4a-usage-act-${uniq}`, `r4a-usage-vert-${uniq}`);

    page.on('dialog', (d) => {
      throw new Error(`unexpected dialog on Usage: ${d.message()}`);
    });

    await page.goto('/admin/leadgen/sections', { waitUntil: 'domcontentloaded' });
    const row = page.locator(`tr[data-entity-id="${section.id}"]`);
    const usageBtn = page.locator(`[data-section-usage="${section.public_id}"]`);
    const panelRow = page.locator(`[data-section-usage-row="${section.public_id}"]`);
    await expect(panelRow).toBeHidden();

    // Usage now lives inside the shared kebab (P1d) — open it before each
    // click. The usage handler itself closes the kebab right after firing
    // (window.lgCloseKebabs()), independent of the usage panel's own
    // open/closed state, so the SECOND click needs the kebab reopened too.
    await row.getByRole('button', { name: /More actions/i }).click();
    await usageBtn.click();
    await expect(panelRow).toBeVisible();
    // Fix-round (usage-panel coherence): the empty-state copy now covers
    // BOTH legs sectionUsageHandler returns (variants AND rules, P1c commit
    // 3943892) — "Not used by any funnel variant." alone would be untrue
    // whenever a rule-only reference exists; this section has neither.
    await expect(panelRow).toContainText('Not used by any funnel variant or rule.');
    await expect(usageBtn).toHaveAttribute('aria-expanded', 'true');
    await page.screenshot({ path: `${SHOT_DIR}/07-usage-panel-expanded.png` });

    await row.getByRole('button', { name: /More actions/i }).click();
    await usageBtn.click();
    await expect(panelRow).toBeHidden();
    await expect(usageBtn).toHaveAttribute('aria-expanded', 'false');
  });
});

test.describe('R4a S3-9/E3-S6 — drawer mapping pill guarded like the top-bar chip', () => {
  test('a Section with nothing required-and-mapped yet renders the drawer pill muted (data-mapping-complete=false), not hardcoded green', async ({ page }) => {
    const section = await createSection(page.request, `Pill Guard ${uniq}`, `r4a-pill-act-${uniq}`, `r4a-pill-vert-${uniq}`);
    await page.goto(`/admin/leadgen/sections/${section.public_id}/edit`, { waitUntil: 'domcontentloaded' });

    await page.locator('[data-studio-drawer-tab="mapping"]').click();
    const pill = page.locator('[data-studio-drawer-mapping-pill]');
    await expect(pill).toBeVisible();
    await expect(pill).toHaveAttribute('data-mapping-complete', 'false');
    // muted gray (#5A6470), never the golden-demo green (#0E7C3A), when incomplete
    const color = await pill.evaluate((el) => getComputedStyle(el).color);
    expect(color).toBe('rgb(90, 100, 112)');
    await page.screenshot({ path: `${SHOT_DIR}/08-mapping-pill-muted.png` });
  });
});
