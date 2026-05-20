import { test, expect } from '@playwright/test';

// Story T15.AC1 — admin-ux-parity: assert the 9 admin routes all render
// adminLayout (admin-layout + admin-sidebar + sidebar-nav) with >= 9
// nav-item elements, visible brand text matches /KoDigital CMS|Homepage CMS/,
// and the served HTML does NOT contain any of the banned legacy strings
// ('TheIWise', 'Phase 1 admin shell', 'Psychic Quiz').
//
// Screenshot evidence is written to test-results/admin-ux-parity/<route>.png.
// Run against a local `wrangler dev` (port 8787) with DEV_BYPASS_AUTH=true,
// which the playwright.config.ts webServer block boots automatically.

const BANNED_LEGACY_STRINGS = ['TheIWise', 'Phase 1 admin shell', 'Psychic Quiz'] as const;
const BRAND_TEXT_REGEX = /KoDigital CMS|Homepage CMS/;

// T15.AC1 — admin-ux-parity asserts the 9 admin routes render the
// adminLayout shell + KoDigital CMS brand. Production form: Host header
// is `cms.kodigital.app` (api/wrangler.toml [env.production].ADMIN_HOST).
// Local form: `wrangler dev` is invoked with
// `--var ADMIN_HOST:127.0.0.1 --var DEV_BYPASS_AUTH:true` so the URL
// hostname Playwright sends (127.0.0.1 from baseURL) matches the
// admin-host gate in api/src/index.ts. Chromium browser context refuses
// to set the Host header via `extraHTTPHeaders` (RFC compliance), so
// the local ADMIN_HOST is overridden to the dev hostname instead. The
// behavioral contract (admin renders on ADMIN_HOST, off-admin-host
// gated to 404) is invariant; only the literal hostname differs.

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
    test(`route ${route} renders adminLayout with 9-entry sidebar + KoDigital CMS brand + no legacy strings`, async ({ page }) => {
      const response = await page.goto(route, { waitUntil: 'domcontentloaded' });
      expect(response, `navigation to ${route} returned no response`).not.toBeNull();
      expect(response!.status(), `unexpected HTTP status for ${route}`).toBe(200);

      const html = await page.content();

      // T15.AC1 — no banned legacy strings anywhere in the served HTML.
      for (const banned of BANNED_LEGACY_STRINGS) {
        expect(html, `${route} still leaks banned legacy string '${banned}'`).not.toContain(banned);
      }

      // adminLayout shell contract.
      await expect(page.locator('.admin-layout')).toHaveCount(1);
      await expect(page.locator('.admin-sidebar')).toHaveCount(1);
      await expect(page.locator('.sidebar-nav')).toHaveCount(1);

      // T15.AC1 — sidebar has >= 9 nav entries (Phase 3 wires exactly 9;
      // future phases may extend, so the contract is `>= 9` per AC).
      const navItems = page.locator('.sidebar-nav .nav-item');
      const navItemCount = await navItems.count();
      expect(navItemCount, `${route} sidebar must have >= 9 nav-item entries`).toBeGreaterThanOrEqual(9);
      const navText = (await navItems.allInnerTexts()).join(' ');
      expect(navText, `${route} sidebar must NOT advertise Psychic Quiz`).not.toMatch(/Psychic Quiz/i);
      expect(navText, `${route} sidebar must advertise Domains`).toMatch(/Domains/);

      // T15.AC1 — visible brand text matches /KoDigital CMS|Homepage CMS/.
      // The brand is rendered as `<span class="logo-text">…</span>` inside
      // the `<a class="logo">` link at the top of api/src/admin/templates/layout.ts.
      const brandText = (await page.locator('.admin-sidebar .logo .logo-text').first().innerText()).trim();
      expect(brandText, `${route} brand text must match /KoDigital CMS|Homepage CMS/`).toMatch(BRAND_TEXT_REGEX);

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
