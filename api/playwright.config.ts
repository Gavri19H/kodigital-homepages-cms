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
// U13 fix (2026-07-15, register U13 — operator's 3rd-retest dead drag):
// the studio canvas srcdoc iframe now carries
// sandbox="allow-same-origin allow-scripts" PLUS a first-in-head
// <meta http-equiv="Content-Security-Policy" content="script-src 'none';
// object-src 'none'; base-uri 'none'"> (ui-section-studio.ts
// studioCanvasFrameSrcdoc). Granting the sandbox's scripting flag is what
// makes Chromium/CDP DELIVER a held-button page.mouse.move stream across the
// srcdoc boundary — the SAME stream that hung under the old scripts-disabled
// sandbox="allow-same-origin". Root-cause probes (both engines) proved the
// hang was this delivery failure, NOT a "CDP/automation-only" property: it is
// the identical failure the operator hit in real Chrome (a dead drag), and it
// is fixed by the scripting grant. Script execution stays fully inert via the
// in-document CSP (script-src 'none' kills inline <script>, on* handler
// attributes and javascript: URLs — all proven non-executing in both engines),
// so the scripting grant adds no script/XSS surface; escapeHtml on every
// author value remains the primary defense. Net: the real page.mouse gesture
// completes under BOTH Chromium AND Firefox, so every gesture spec runs on
// BOTH projects (the earlier firefox-only lane, a workaround for the now-fixed
// hang, is gone).
//
// GESTURE_SPEC_PATTERNS stays the SINGLE source of truth for the gesture lane:
// firefox's testMatch pins it to gesture specs ONLY; chromium no longer
// testIgnores them (it runs the full suite). A gesture spec therefore runs on
// BOTH projects (intended cross-engine coverage) but never twice within one
// project.
const GESTURE_SPEC_PATTERNS = [
  'r0a-drag-spike.spec.ts',
  'forensic-live-probe.spec.ts',
  // Any spec named *.gesture.spec.ts is a real page.mouse gesture spec by
  // convention. These run on BOTH projects now (chromium via the default
  // project's testMatch, firefox via the testMatch below) — cross-engine
  // proof that the U13 sandbox+CSP fix delivers held-button streams under
  // Chromium as well as Firefox.
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
      // Runs the FULL suite, gesture specs included (the U13 sandbox+CSP fix
      // makes held-button page.mouse streams deliver under Chromium/CDP, so
      // the old testIgnore of GESTURE_SPEC_PATTERNS is gone). A gesture spec
      // now runs here AND on firefox — once per project, never twice within
      // this one.
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
      // ONLY the real page.mouse gesture specs run here (see
      // GESTURE_SPEC_PATTERNS above) — the SECOND engine in the cross-engine
      // gesture proof. Firefox's Juggler protocol (no CDP) always delivered
      // the multi-move drag; post-U13-fix Chromium does too, and both are now
      // gated.
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
