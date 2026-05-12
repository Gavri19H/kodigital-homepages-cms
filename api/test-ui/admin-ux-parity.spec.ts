import { test, expect } from '@playwright/test';

// Story T18 — admin-ux-parity: assert the 9 admin routes all render
// adminLayout (admin-layout + admin-sidebar + sidebar-nav), the dashboard
// stats-grid is present, the sidebar has exactly 9 nav entries with
// Domains included and Psychic Quiz excluded, and the legacy
// "Phase 1 admin shell" placeholder no longer appears anywhere.
//
// Screenshot evidence is written to test-results/admin-ux-parity/<route>.png.
// Run against a local `wrangler dev` (port 8787) with DEV_BYPASS_AUTH=true,
// which the playwright.config.ts webServer block boots automatically.

const ADMIN_ROUTES = [
  '/admin',
  '/admin/domains',
  '/admin/articles',
  '/admin/pages',
  '/admin/media',
  '/admin/categories',
  '/admin/tags',
  '/admin/presets',
  '/admin/settings',
] as const;

const SCREENSHOT_DIR = 'test-results/admin-ux-parity';

function screenshotPath(route: string): string {
  const slug = route === '/admin' ? 'dashboard' : route.replace(/^\/admin\//, '').replace(/\//g, '-');
  return `${SCREENSHOT_DIR}/${slug}.png`;
}

test.describe('admin UX parity — adminLayout on all 9 routes', () => {
  for (const route of ADMIN_ROUTES) {
    test(`route ${route} renders adminLayout with 9-entry sidebar (no Psychic Quiz)`, async ({ page }) => {
      const response = await page.goto(route, { waitUntil: 'domcontentloaded' });
      expect(response, `navigation to ${route} returned no response`).not.toBeNull();
      expect(response!.status(), `unexpected HTTP status for ${route}`).toBe(200);

      const html = await page.content();

      // No legacy placeholder anywhere in the served HTML.
      expect(html, `${route} still leaks the legacy 'Phase 1 admin shell' placeholder`).not.toContain('Phase 1 admin shell');

      // adminLayout shell contract.
      await expect(page.locator('.admin-layout')).toHaveCount(1);
      await expect(page.locator('.admin-sidebar')).toHaveCount(1);
      await expect(page.locator('.sidebar-nav')).toHaveCount(1);

      // Sidebar has exactly 9 nav entries and excludes Psychic Quiz.
      const navItems = page.locator('.sidebar-nav .nav-item');
      await expect(navItems).toHaveCount(9);
      const navText = (await navItems.allInnerTexts()).join(' ');
      expect(navText, `${route} sidebar must NOT advertise Psychic Quiz`).not.toMatch(/Psychic Quiz/i);
      expect(navText, `${route} sidebar must advertise Domains`).toMatch(/Domains/);

      await page.screenshot({ path: screenshotPath(route), fullPage: true });
    });
  }
});

test('dashboard /admin renders stats-grid with 7 stat cards', async ({ page }) => {
  const response = await page.goto('/admin', { waitUntil: 'domcontentloaded' });
  expect(response!.status()).toBe(200);

  await expect(page.locator('.stats-grid')).toHaveCount(1);
  await expect(page.locator('.stats-grid .stat-card')).toHaveCount(7);

  await page.screenshot({ path: `${SCREENSHOT_DIR}/dashboard-stats-grid.png`, fullPage: true });
});
