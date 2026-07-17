import { test, expect } from '@playwright/test';

// LeadGen Phase 3 — contract 01 §5 nav + tab shells, end-to-end:
//   the sidebar shows the LeadGen nav item right next to Listicles; clicking
//   it lands on /admin/leadgen/offers (the 01 §5.2 302 default); the
//   four-tab bar (Offers · Sections · Quotes · Auction) is visible; clicking
//   each tab navigates to its path (auction is SINGULAR) and marks it active.
//
// Runs against the playwright.config.ts webServer (wrangler dev on
// :<PW_PORT>, default 8787, with DEV_BYPASS_AUTH:true + ADMIN_HOST:127.0.0.1
// — see that file's header for why the local ADMIN_HOST substitutes the
// loopback hostname). Local D1
// must be migrated once: `npm run db:migrate:local`.
//
// Screenshots (1280×800) land in test-artifacts/leadgen-nav/ — the repo's
// per-test Playwright artifact location (playwright.config.ts outputDir;
// gitignored).

test.use({ viewport: { width: 1280, height: 800 } });

const SHOT_DIR = 'test-artifacts/leadgen-nav';

const TABS = [
  { label: 'Offers', path: '/admin/leadgen/offers' },
  { label: 'Sections', path: '/admin/leadgen/sections' },
  { label: 'Quotes', path: '/admin/leadgen/quotes' },
  { label: 'Auction', path: '/admin/leadgen/auction' },
] as const;

test('sidebar LeadGen entry lands on the Offers tab (01 §5.1/§5.2)', async ({ page }) => {
  await page.goto('/admin', { waitUntil: 'domcontentloaded' });

  // 01 §5.1: the LeadGen nav item renders in the sidebar next to Listicles.
  const navItem = page.locator('.sidebar-nav a[href="/admin/leadgen"]');
  await expect(navItem).toBeVisible();
  await expect(navItem).toContainText('LeadGen');
  await expect(page.locator('.sidebar-nav a[href="/admin/listicles"]')).toBeVisible();

  // Clicking it follows the 01 §5.2 302 to the Offers tab.
  await navItem.click();
  await page.waitForURL('**/admin/leadgen/offers');
  await expect(page.locator('.sidebar-nav a[href="/admin/leadgen"]')).toHaveClass(/active/);

  // The four-tab bar renders with Offers active.
  await expect(page.locator('.leadgen-tabs .leadgen-tab')).toHaveCount(4);
  await expect(page.locator('.leadgen-tab.active')).toHaveText('Offers');

  await page.screenshot({ path: `${SHOT_DIR}/01-offers-tab.png` });
});

test('each tab navigates to its path and marks itself active (01 §5.2)', async ({ page }) => {
  await page.goto('/admin/leadgen/offers', { waitUntil: 'domcontentloaded' });

  for (const tab of TABS) {
    await page.locator(`.leadgen-tabs a[href="${tab.path}"]`).click();
    await page.waitForURL(`**${tab.path}`);
    await expect(page.locator('.leadgen-tab.active')).toHaveText(tab.label);
    await expect(page.locator(`.leadgen-tabs a[href="${tab.path}"]`)).toHaveClass(/active/);
    // every tab keeps the LeadGen nav entry active
    await expect(page.locator('.sidebar-nav a[href="/admin/leadgen"]')).toHaveClass(/active/);
  }

  await page.screenshot({ path: `${SHOT_DIR}/02-auction-tab.png` });
});
