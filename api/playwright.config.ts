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
// R0b (register §A M1 / R0a spike, api/test-ui/r0a-drag-spike.spec.ts):
// a REAL page.mouse drag into the studio's srcdoc canvas frame hangs on the
// 2nd move under Chromium/CDP (environment limitation — reproduced with
// BOTH the original srcdoc frame and a spiked src-URL frame, so it is not a
// srcdoc-vs-src property; the src-URL experiment was reverted). The same
// drag completes under Firefox (Juggler protocol, no CDP). Every "gesture"
// spec (real page.mouse drag probes) therefore runs on a dedicated firefox
// project instead of the default chromium one. The two arrays below are
// kept as a single source of truth so a file can never end up in BOTH
// projects (double-counted in --list) or in NEITHER (silently unrun):
// firefox's testMatch and chromium's testIgnore are the exact same list.
const GESTURE_SPEC_PATTERNS = [
  'r0a-drag-spike.spec.ts',
  'forensic-live-probe.spec.ts',
  // Future-proof: any spec explicitly named *.gesture.spec.ts is a real
  // page.mouse gesture spec by convention and runs on firefox too. No file
  // matches this pattern today (verified via `find test-ui -iname
  // "*.gesture.spec.ts"`), so adding it changes nothing about today's
  // counts — it only pre-wires the convention for R2/R6.
  '**/*.gesture.spec.ts',
];

export default defineConfig({
  testDir: './test-ui',
  // LeadGen v2.5 15 §15.4: committed toHaveScreenshot baselines live under
  // test-ui/__screenshots__/ (the listicles/leadgen self-baseline folder
  // convention); specs name explicit path segments, e.g.
  // ['leadgen-v25', 'pattern-a-desktop.png'] →
  // test-ui/__screenshots__/leadgen-v25/pattern-a-desktop.png. No
  // platform/project suffix — the baseline set is the contract-named
  // committed artifact. Only toHaveScreenshot/toMatchSnapshot consumers are
  // affected (no other spec uses them; the manual self-baseline suites
  // read/write the folder directly and are untouched).
  snapshotPathTemplate: '{testDir}/__screenshots__/{arg}{ext}',
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
      // Every gesture spec runs on firefox instead (see GESTURE_SPEC_PATTERNS
      // above) — excluded here so no file is ever picked up by both projects.
      testIgnore: GESTURE_SPEC_PATTERNS,
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
      // ONLY the real page.mouse gesture specs run here (see
      // GESTURE_SPEC_PATTERNS above) — Firefox's Juggler protocol completes
      // the multi-move drag that hangs under Chromium/CDP against the
      // studio's nested srcdoc canvas iframe.
      testMatch: GESTURE_SPEC_PATTERNS,
    },
  ],
  webServer: [
    {
      command: 'npx wrangler dev --port 8787 --ip 127.0.0.1 --var DEV_BYPASS_AUTH:true --var ADMIN_HOST:127.0.0.1',
      url: 'http://127.0.0.1:8787/health',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    // fix-contract v2.4 11 §11.2 / 12 Phase 1 "mock provider fixtures": the
    // REAL local provider the live-funnel suite's seeded Offer points its
    // endpoint_staging + endpoint_production at (the Worker's server-side
    // provider fetch is not interceptable from the browser context). See
    // scripts/leadgen-mock-provider.ts (POST /mock, GET /__requests,
    // POST /__reset).
    {
      command: 'npx tsx scripts/leadgen-mock-provider.ts',
      url: 'http://127.0.0.1:8788/health',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
});
