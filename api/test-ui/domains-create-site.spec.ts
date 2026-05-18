import { test, expect } from '@playwright/test';

// Story T19 — domains-create-site: assert that the /admin/domains
// Create-Site modal observably sends POST /api/admin/sites when the
// user clicks "+ New Site", fills the form, and clicks "Create site".
// The waitForRequest('**/api/admin/sites') call captures the network
// request regardless of the server response code -- this is a UI-flow
// contract test, not a provisioning end-to-end.
//
// /admin/domains is rendered server-side by api/src/admin/ui.ts with an
// empty verticals=[] until T11 wires real D1 data. The modal's
// <select name="vertical_slug" required> therefore has zero <option>s
// at GET time; the spec injects one option client-side before submit
// so the browser's HTML5 required-validation doesn't suppress the POST.
// This keeps the spec self-contained against an empty local D1.
//
// Run against a local `wrangler dev` (port 8787) launched with
// `--var ADMIN_HOST:127.0.0.1 --var DEV_BYPASS_AUTH:true`. Production
// form uses Host: cms.kodigital.app (wrangler.toml [env.production]);
// chromium refuses to override Host via extraHTTPHeaders, so dev
// substitutes 127.0.0.1 as ADMIN_HOST and the URL hostname matches.

const SCREENSHOT_DIR = 'test-results/domains-create-site';

test('admin domains -- + New Site modal fill+submit observes POST /api/admin/sites', async ({ page }) => {
  const uniqueDomain = `qa-${Date.now()}.example.test`;

  // 1) Navigate to /admin/domains and confirm the admin shell renders.
  const response = await page.goto('/admin/domains', { waitUntil: 'domcontentloaded' });
  expect(response, 'navigation to /admin/domains returned no response').not.toBeNull();
  expect(response!.status(), 'unexpected HTTP status for /admin/domains').toBe(200);

  const initialHtml = await page.content();
  expect(initialHtml, '/admin/domains still leaks the legacy Phase 1 admin shell').not.toContain('Phase 1 admin shell');

  // adminLayout shell + Domains toolbar must be present before we interact.
  await expect(page.locator('.admin-layout')).toHaveCount(1);
  await expect(page.locator('#new-site-modal')).toHaveCount(1);

  // 2) Click "+ New Site" by visible text -- opens the Create-Site modal.
  await page.getByRole('button', { name: '+ New Site' }).click();

  const modal = page.locator('#new-site-modal');
  await expect(modal).toBeVisible();

  // 3) Fill the modal form. /admin/domains passes verticals=[] (T11 will
  // wire real data); inject one <option> and select it so submit isn't
  // blocked by HTML5 required-validation on the vertical_slug select.
  await page.fill('input[name="domain"]', uniqueDomain);
  await page.fill('input#name', 'QA Test Site');
  await page.evaluate(() => {
    const sel = document.querySelector('select[name="vertical_slug"]') as HTMLSelectElement | null;
    if (sel) {
      const opt = document.createElement('option');
      opt.value = 'qa-vertical';
      opt.textContent = 'QA Vertical';
      sel.appendChild(opt);
      sel.value = 'qa-vertical';
    }
  });

  await page.screenshot({ path: `${SCREENSHOT_DIR}/01-form-filled.png`, fullPage: true });

  // 4) Arm the request observer BEFORE clicking submit so the listener
  // is registered prior to the modal's fetch() call. The glob form
  // matches the grep contract `waitForRequest\([^)]*\/api\/admin\/sites`.
  const requestPromise = page.waitForRequest('**/api/admin/sites');

  // 5) Click "Create site" by visible text -- triggers the form's
  // submit handler in MODAL_SCRIPT which posts JSON to /api/admin/sites.
  await page.getByRole('button', { name: 'Create site' }).click();

  // 6) The browser MUST fire POST /api/admin/sites carrying the unique
  // domain in the JSON body. We assert method+url+body to lock down the
  // wire contract; the server response code is intentionally ignored.
  const request = await requestPromise;
  expect(request.method(), 'expected POST against /api/admin/sites').toBe('POST');
  expect(request.url(), 'request URL must include /api/admin/sites').toContain('/api/admin/sites');

  const body = request.postData() ?? '';
  expect(body, 'POST body must include the unique domain').toContain(uniqueDomain);
  expect(body, 'POST body must include vertical_slug field').toContain('vertical_slug');

  await page.screenshot({ path: `${SCREENSHOT_DIR}/02-post-submit.png`, fullPage: true });
});
