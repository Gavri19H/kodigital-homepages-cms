import { defineConfig, devices } from '@playwright/test';

// T15.AC2/AC3 contract: `cd api && npx playwright test` runs to completion
// and produces `api/test-results/index.html`. The html reporter's
// outputFolder is pinned to `./test-results` so AC3 (`ls
// api/test-results/index.html`) succeeds, and the per-test artifact
// outputDir is nested under `test-results/artifacts/` so it does not
// clash with the html-reporter folder (Playwright rejects nested clash).
//
// webServer.command launches `wrangler dev` with the two `--var` flags
// the admin-ux-parity + domains-create-site specs require:
//   --var DEV_BYPASS_AUTH:true    (short-circuit Cloudflare Access in
//                                  api/src/auth/access-auth.ts so /admin
//                                  returns 200 in dev)
//   --var ADMIN_HOST:127.0.0.1    (match the URL hostname Playwright
//                                  sends from baseURL=http://127.0.0.1:8787
//                                  so the off-admin-host gate in
//                                  api/src/index.ts accepts /admin*)
// Production form: wrangler.toml [env.production].ADMIN_HOST =
// "cms.kodigital.app". Chromium browser context refuses to set the Host
// header via extraHTTPHeaders (RFC compliance), so dev substitutes the
// ADMIN_HOST literal to the loopback hostname instead. The behavioral
// contract under test is invariant; only the literal hostname differs.
export default defineConfig({
  testDir: './test-ui',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: './test-results' }]],
  // Per-test artifacts (videos, traces) live in a sibling folder so the
  // html reporter (which clears its outputFolder before writing) does
  // not delete them. AC3 only requires test-results/index.html exists.
  outputDir: './test-artifacts',
  use: {
    baseURL: 'http://127.0.0.1:8787',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npx wrangler dev --port 8787 --ip 127.0.0.1 --var DEV_BYPASS_AUTH:true --var ADMIN_HOST:127.0.0.1',
    url: 'http://127.0.0.1:8787/health',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
