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
// completes under BOTH Chromium AND Firefox, so the two gesture specs that PROVE
// this — leadgen-u11u12-move.gesture.spec.ts (THE canvas-move gate) and
// forensic-live-probe.spec.ts (the studio drag probes) — now run on BOTH
// projects (the U13 cross-engine proof).
//
// The OTHER gesture specs stay FIREFOX-ONLY: they were designed for Firefox
// real-input and carry firefox-architectural dependencies UNRELATED to the U13
// canvas-drag delivery fix, so they cannot pass on Chromium as-is —
//   - leadgen-runtime-inputs.gesture.spec.ts drives the tenant-host LIVE funnel
//     via the firefox-only `network.dns.localDomains` pref (a NO-OP under
//     Chromium, so the .e2e.test host is unresolvable → every test fails);
//   - leadgen-canvas-interactions.gesture.spec.ts uses Ctrl+A to select-all,
//     which on Chromium/macOS is the readline move-to-line-start binding, not
//     select-all;
//   - leadgen-r3a-effects / leadgen-r3b-effects are likewise Firefox real-input
//     gates, and r0a-drag-spike.spec.ts launches firefox in-process regardless.
// These are NOT part of the U13 proof; making them Chromium-robust is a
// separate follow-up (see the conductor report). firefox's testMatch runs the
// FULL gesture set (single source of truth); chromium's testIgnore drops only
// the firefox-only subset. A cross-engine gesture spec runs on BOTH projects
// (once each, never twice within a project); a firefox-only one runs on firefox
// alone.
// P1c (register PC-1/PC-3/PC-11): leadgen-p1-geometry.gesture.spec.ts (P1a)
// asserts the studio-canvas AND live-funnel answer-grid geometry — a
// chromium-only gap since it was never added to either engine list, so
// firefox's testMatch (ALL_GESTURE_SPECS below) skipped it entirely. Added
// here (not FIREFOX_ONLY) because it carries no firefox-architectural
// dependency (getBoundingClientRect + computed styles, not a real-input
// drag) — the u11u12-move mechanism this comment block already documents.
const CROSS_ENGINE_GESTURE_SPECS = [
  'leadgen-u11u12-move.gesture.spec.ts',
  'forensic-live-probe.spec.ts',
  'leadgen-p1-geometry.gesture.spec.ts',
  // P2a (register PC-11 completion / R-A): the per-element-freedom effect gate.
  // Cross-engine (not FIREFOX_ONLY) for the SAME reason as p1-geometry — its
  // studio-canvas describe is getBoundingClientRect + computed styles (no
  // real-input drag), engine-agnostic; only its live-/lg describe self-skips on
  // firefox (dynamic e2e host needs chromium --host-resolver-rules).
  'leadgen-p2a-element-freedom.gesture.spec.ts',
  // P3a (register PC-2 / D1 / R-B): the structured-placement effect gate —
  // SAME cross-engine shape as p2a (studio-canvas describe is getBoundingClientRect
  // + computed styles; the live-/lg describe self-skips on firefox).
  'leadgen-p3a-placement.gesture.spec.ts',
  // P4b (register PC-5/PC-A5 conductor closure): the DateQuestion studio Min
  // token-picker leg — SAME cross-engine shape as p2a/p3a. Its 5 original
  // live-/lg validation legs (phone/email/step/date/required-groups) all
  // test.skip() on firefox (each drives a dynamic {uniq}.e2e.test host); the
  // NEW "studio Min token dropdown persists" test carries NO e2e.test
  // dependency (a plain /admin/leadgen/sections/{id}/edit page) and is NOT
  // skipped — it is the both-engine studio-only leg the other tests' skip
  // messages point to.
  'leadgen-p4b-validation.spec.ts',
];
const FIREFOX_ONLY_GESTURE_SPECS = [
  'r0a-drag-spike.spec.ts',
  'leadgen-r3a-effects.gesture.spec.ts',
  'leadgen-r3b-effects.gesture.spec.ts',
  'leadgen-runtime-inputs.gesture.spec.ts',
  'leadgen-canvas-interactions.gesture.spec.ts',
];
const ALL_GESTURE_SPECS = [...CROSS_ENGINE_GESTURE_SPECS, ...FIREFOX_ONLY_GESTURE_SPECS];

// P1c: worktree-isolated runs (a parallel mission's wrangler already owns
// 8787) set PW_PORT=8899; CI and every other caller are unaffected (the
// fallback is the pre-existing literal). Threaded into baseURL AND the
// wrangler dev webServer's own --port/health-check URL so the two stay in
// sync — a mismatched pair would either 404 the health check or serve every
// relative-path test against the wrong origin.
const PW_PORT = process.env.PW_PORT || '8787';

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
    baseURL: `http://127.0.0.1:${PW_PORT}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      // Runs the full suite INCLUDING the two cross-engine gesture specs
      // (u11u12-move + forensic-live-probe) — the U13 sandbox+CSP fix makes
      // their held-button page.mouse streams deliver under Chromium/CDP. Only
      // the FIREFOX_ONLY_GESTURE_SPECS (firefox-architectural deps unrelated to
      // U13) are excluded here; they run on firefox alone.
      testIgnore: FIREFOX_ONLY_GESTURE_SPECS,
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
      // Runs the FULL gesture set (ALL_GESTURE_SPECS = cross-engine +
      // firefox-only): the SECOND engine for the U13 cross-engine proof AND the
      // sole engine for the firefox-designed real-input gates. Firefox's Juggler
      // protocol (no CDP) delivers the multi-move drag; post-U13-fix Chromium
      // does too for the cross-engine pair.
      testMatch: ALL_GESTURE_SPECS,
    },
  ],
  webServer: [
    {
      command: `npx wrangler dev --port ${PW_PORT} --ip 127.0.0.1 --var DEV_BYPASS_AUTH:true --var ADMIN_HOST:127.0.0.1`,
      url: `http://127.0.0.1:${PW_PORT}/health`,
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
