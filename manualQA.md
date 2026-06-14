# Manual QA — kodigital-cms-rescue-2-2026-06-10

Browser-executed QA scenarios for the rescue mission. Executed during
`/a2z-ship` manualQA phase (post-deploy); results recorded in
`manualQA-report.md` with per-scenario evidence. Backs the deferred
ship-phase claims RC-142 (T49.AC1) and RC-143 (T49.AC2).

Every scenario cites its **grounding reference section** — either
`docs/design-contract.md` (the decoded theiwise public design contract)
or the legacy technical spec (the read-only legacy source at
`theiwise-legacy-readonly/docs/`), per brief contract BCL-076.

## Prerequisites

- Deployed worker serving https://theplaynest.net (public) and
  https://cms.kodigital.app/admin (admin, behind Cloudflare Access).
- CF Access credentials for admin scenarios (manual auth — automation
  stops at the Access login boundary).
- DevTools open for console/computed-style assertions; responsive mode
  for 375px checks.
- Evidence rules: UI scenarios need screenshots at the stated viewport
  (E6); network/tracking assertions need the HTTP request visible in
  the Network tab (E4); every PASS/FAIL cites command + output (E1/E2).

## Scenario index

| ID | Title | Classification |
|---|---|---|
| MQA-1 | Regression baseline: public home loads without JS errors | READ_ONLY |
| MQA-2 | data-screen-label root wrapper present on home | READ_ONLY |
| MQA-3 | Brand color: computed --tw-brand is #1ba8c8 | READ_ONLY |
| MQA-4 | Article shell grid: grid-template-columns starts with 60px | READ_ONLY |
| MQA-5 | Home section order: 13 sections in contract order | READ_ONLY |
| MQA-6 | Admin nav order: 9 entries in correct sequence | READ_ONLY |
| MQA-7 | Provisioning panel: polls to 16-step completion | MUTATING |
| MQA-8 | AI chat round-trip: writes ai_generations row | MUTATING |
| MQA-9 | Legal pages: identical across 2 sites except site name | READ_ONLY |
| MQA-10 | data-screen-label on article page | READ_ONLY |
| MQA-11 | Mobile 375px: no horizontal overflow on home | READ_ONLY |
| MQA-12 | Mobile 375px: no horizontal overflow on article page | READ_ONLY |
| MQA-13 | Desktop 1280px: no overflow on home; floating-next visible | READ_ONLY |
| MQA-14 | Slug 301 redirect: /:slug → /article/:slug | READ_ONLY |
| MQA-15 | Draft preview: noindex header and no-store cache | READ_ONLY |
| MQA-16 | Ship post-deploy checklist (RC-140/RC-141/RC-142) | MUTATING |

---

### MQA-1: Regression baseline: public home loads without JS errors

- **Why:** Verifies that the deployed worker serves the public homepage
  with HTTP 200 and zero console errors, confirming the foundational
  deploy baseline is intact before deeper scenario checks.
- **Steps:** Navigate to https://theplaynest.net at 1280px; open
  DevTools console; confirm HTTP 200 and zero errors.
- **Expected:** HTTP 200; console.errors count = 0; page renders
  visible content.
- **Classification:** READ_ONLY
- **Linked stories/ACs:** T4 — T4.AC1
- **Grounding reference:** legacy technical spec
  `theiwise-legacy-readonly/docs/production-verification-checklist.md`
  § Public Site Verification.

### MQA-2: data-screen-label root wrapper present on home

- **Why:** Confirms that the design-contract root wrapper attribute
  data-screen-label='theiwise-home' is present in the live rendered
  DOM, the deterministic anchor for design-system targeting and
  regression detection.
- **Steps:** Navigate to https://theplaynest.net at 1280px; DevTools
  Elements; run
  `document.querySelector('[data-screen-label="theiwise-home"]')` in
  console.
- **Expected:** Returns non-null element; attribute value is exactly
  'theiwise-home'.
- **Classification:** READ_ONLY
- **Linked stories/ACs:** T9 — T9.AC1, T9.AC2
- **Grounding reference:** docs/design-contract.md §6 Root wrappers
  (screen labels).

### MQA-3: Brand color: computed --tw-brand is #1ba8c8

- **Why:** Verifies the exact brand color token #1ba8c8 is applied in
  the live computed styles, catching any regression where the old
  default Tailwind blue (#2563eb) or any other incorrect value shipped
  instead of the pinned contract color.
- **Steps:** Navigate to https://theplaynest.net; DevTools console:
  `getComputedStyle(document.documentElement).getPropertyValue('--tw-brand').trim()`;
  compare value.
- **Expected:** Value equals #1ba8c8 (or rgb(27,168,200)); does NOT
  match #2563eb.
- **Classification:** READ_ONLY
- **Linked stories/ACs:** T6 — T6.AC1, T6.AC3
- **Grounding reference:** docs/design-contract.md §1 Color tokens
  (all `--tw-*` values).

### MQA-4: Article shell grid: computed grid-template-columns starts with 60px

- **Why:** Confirms the article-shell grid uses the design-contract
  value of 60px as the first column (not the previously incorrect
  64px), validating that the grid override in public-css.ts took
  effect in the live rendered article page.
- **Steps:** Navigate to https://theplaynest.net/article/<slug> at
  1280px; DevTools Elements → select `.article-shell`; inspect
  Computed grid-template-columns.
- **Expected:** Computed value starts with '60px'; does NOT start with
  '64px'.
- **Classification:** READ_ONLY
- **Linked stories/ACs:** T8 — T8.AC1
- **Grounding reference:** docs/design-contract.md §5 Contract grids.

### MQA-5: Home section order: 13 sections in contract order, no about section

- **Why:** Validates the exact 13-section home layout order mandated by
  the design contract is rendered live, and that the removed 'about'
  section is absent, protecting against section order regressions and
  accidental re-introduction of the dropped section.
- **Steps:** Navigate to https://theplaynest.net at 1280px; DevTools
  Elements; observe top-level section sequence (Header, Hero, ChipRail,
  Featured, Leaderboard Ad, Editor's Picks, Trending, Topic Spotlight,
  In-feed Ad, Latest, Newsletter, Footer, FloatingNext); run
  `document.querySelector('[data-section="about"]')`.
- **Expected:** 13 sections present in exact contract order; about
  query returns null.
- **Classification:** READ_ONLY
- **Linked stories/ACs:** T11 — T11.AC1, T11.AC2
- **Grounding reference:** docs/design-contract.md §7 Home section
  order (13 sections, exact sequence).

### MQA-6: Admin nav order: 9 entries in correct sequence

- **Why:** Confirms the ported admin sidebar renders exactly 9
  navigation entries in the specified order from the legacy technical
  spec, verifying the layout shell port is correct and no entries were
  dropped or reordered during the multi-site adaptation.
- **Steps:** Navigate to https://cms.kodigital.app/admin with CF Access
  auth; inspect `.sidebar-nav` links; verify sequence: Dashboard,
  Domains, Articles, Pages, Media, Categories, Tags, AI Presets,
  Settings.
- **Expected:** 9 nav links in exact order; first href /admin; last
  href /admin/settings.
- **Classification:** READ_ONLY
- **Linked stories/ACs:** T22 — T22.AC1
- **Grounding reference:** legacy technical spec
  `theiwise-legacy-readonly/docs/admin-ui-guide.md` § Navigation
  Sidebar.

### MQA-7: Provisioning panel: polls to 16-step completion for new site

- **Why:** End-to-end validation that the provisioning pipeline
  executes all 16 canonical STEP_KEYS to completion and the UI
  correctly renders all launch-readiness badges — the core deliverable
  of the D workstream, verified with a real provisioning run.
- **Steps:** Login to https://cms.kodigital.app/admin; Domains → Create
  new site (domain=test-mqa-YYYYMMDD.example.com, vertical=tech);
  observe provisioning-status-panel polling until completion.
- **Expected:** TOTAL_STEPS=16; all 6 launch_readiness fields
  (domain_attached, published_articles, media_count, cache_warmed,
  smoke_passed, content_mode) truthy; badges green.
- **Classification:** MUTATING (creates a test site; clean up per
  SHIP_HANDOFF.md wipe/recreate procedure)
- **Linked stories/ACs:** T34, T35, T36, T37, T38, T39 — T34.AC1,
  T34.AC3, T39.AC2, T39.AC3
- **Grounding reference:** legacy technical spec
  `theiwise-legacy-readonly/docs/deployment.md` § Cloudflare Resources
  Overview + Steps 1–5 (the Cloudflare-boundary resources the real
  steps 1–3 provision).

### MQA-8: AI chat round-trip: writes ai_generations row

- **Why:** Validates the real /api/admin/ai/chat endpoint (replacing
  the placeholder) actually calls the OpenAI API with model=gpt-5.5
  and persists a row in the ai_generations D1 table — the primary
  evidence requirement for the E1 story's behavioral outcome.
- **Steps:** Navigate to https://cms.kodigital.app/admin/articles/new;
  open AI assistant panel; enter a prompt; submit; check D1
  ai_generations table for new row with model=gpt-5.5.
- **Expected:** New ai_generations row visible; model field = gpt-5.5;
  response text non-empty.
- **Classification:** MUTATING
- **Linked stories/ACs:** T18 — T18.AC2
- **Grounding reference:** legacy technical spec
  `theiwise-legacy-readonly/docs/ai-api-endpoints.md` §1 Content
  Generation (Chat).

### MQA-9: Legal pages: content identical across 2 sites except site name

- **Why:** Confirms the shared legal page template system works
  correctly across multiple sites, with only the site name token
  differing between instances, ensuring the §6.2 legal_templates
  multi-site behavior is preserved in the ported admin.
- **Steps:** Navigate to /page/privacy-policy on theplaynest.net and a
  second provisioned site; diff the body text of both pages.
- **Expected:** Body text identical except for site name tokens; no
  structural HTML differences.
- **Classification:** READ_ONLY
- **Linked stories/ACs:** T29 — T29.AC1
- **Grounding reference:** legacy technical spec
  `theiwise-legacy-readonly/docs/legal-pages-privacy.md` § Legal Pages.

### MQA-10: data-screen-label on article page

- **Why:** Verifies the article page root wrapper carries the correct
  data-screen-label='article-page' attribute in the live rendered DOM,
  ensuring the design-contract root wrapper system works on the
  article surface in addition to the home surface.
- **Steps:** Navigate to https://theplaynest.net/article/<slug> at
  1280px; DevTools console:
  `document.querySelector('[data-screen-label="article-page"]')`.
- **Expected:** Returns non-null element; data-screen-label value =
  'article-page'.
- **Classification:** READ_ONLY
- **Linked stories/ACs:** T9 — T9.AC1
- **Grounding reference:** docs/design-contract.md §6 Root wrappers
  (screen labels).

### MQA-11: Mobile 375px: no horizontal overflow on home

- **Why:** Validates the 8-breakpoint responsive layout does not
  produce any horizontal overflow on the home page at 375px mobile
  viewport — the E6 evidence requirement for UI stories, protecting
  against content spilling outside the viewport on small devices.
- **Steps:** Navigate to https://theplaynest.net; DevTools responsive
  mode at 375px; run
  `document.documentElement.scrollWidth <= document.documentElement.clientWidth`
  in console.
- **Expected:** Expression returns true; no horizontal scrollbar
  visible at 375px.
- **Classification:** READ_ONLY
- **Linked stories/ACs:** T6, T16 — T16.AC1
- **Grounding reference:** docs/design-contract.md §9 Breakpoints
  (all 8).

### MQA-12: Mobile 375px: no horizontal overflow on article page

- **Why:** Validates the article page at 375px mobile viewport has no
  horizontal overflow and the reading-progress bar is present, covering
  the E6 visual evidence requirement for the article surface and
  confirming the article-specific breakpoint overrides work correctly.
- **Steps:** Navigate to https://theplaynest.net/article/<slug> at
  375px; run `scrollWidth <= clientWidth` in console; verify
  `.reading-progress` element present.
- **Expected:** Expression returns true; `.reading-progress` element
  present in DOM.
- **Classification:** READ_ONLY
- **Linked stories/ACs:** T13, T16 — T13.AC2, T16.AC1
- **Grounding reference:** docs/design-contract.md §9 Breakpoints
  (all 8) + §8 Article section order (12 sections) + nesting.

### MQA-13: Desktop 1280px: no overflow on home; floating-next visible

- **Why:** Validates the home page at full 1280px desktop width has no
  horizontal overflow and the FloatingNext element is present at page
  bottom, verifying both the overflow contract and the 13th section
  (FloatingNext) of the home section order.
- **Steps:** Navigate to https://theplaynest.net at 1280px; run
  `scrollWidth <= clientWidth`; scroll to bottom and verify
  `.floating-next` element.
- **Expected:** Expression returns true; `.floating-next` in DOM.
- **Classification:** READ_ONLY
- **Linked stories/ACs:** T6, T11 — T11.AC1
- **Grounding reference:** docs/design-contract.md §7 Home section
  order (13 sections, exact sequence).

### MQA-14: Slug 301 redirect: /:slug matching article slug redirects to /article/:slug

- **Why:** Confirms the F1 URL canonicalization logic correctly issues
  a 301 redirect from the legacy /:slug catch-all to the canonical
  /article/:slug URL for article slugs — required for SEO correctness
  and a behavioral change that must be verified against the live
  worker.
- **Steps:** Identify a published article slug;
  `curl -I https://theplaynest.net/<slug>`; check response.
- **Expected:** HTTP 301; Location header = /article/<slug>.
- **Classification:** READ_ONLY
- **Linked stories/ACs:** T40 — T40.AC1
- **Grounding reference:** legacy technical spec
  `theiwise-legacy-readonly/docs/production-verification-checklist.md`
  § Legacy URL Redirects.

### MQA-15: Draft preview: returns noindex header and no-store cache

- **Why:** Verifies the draft preview route correctly sets
  X-Robots-Tag: noindex and Cache-Control: no-store headers,
  preventing draft content from being indexed by search engines or
  cached by Cloudflare — the core safety contract of the G3 story.
- **Steps:** Obtain a draft article ID;
  `curl -I https://theplaynest.net/preview/<draft-id>` with
  DEV_BYPASS_AUTH or service token; inspect headers.
- **Expected:** HTTP 200; X-Robots-Tag: noindex; Cache-Control:
  no-store.
- **Classification:** READ_ONLY
- **Linked stories/ACs:** T47 — T47.AC2
- **Grounding reference:** legacy technical spec
  `theiwise-legacy-readonly/docs/publishing.md` § Preview System.

### MQA-16: T48 + T49 ship post-deploy checklist: RC-140 / RC-141 / RC-142 Playwright pixel-parity, live smoke, Lighthouse, behavioral assertions

- **Why:** Anchors RC-140/T48.AC3 and the T49 manualQA-execution claims
  RC-141 + RC-142 deferred-ship verification: after deploy, Playwright
  pixel-parity, live smoke (verify:all), Lighthouse
  performance/accessibility, and behavioral assertions (article 200,
  slug 301, AI chat ai_generations row) must all pass — and every T49
  manualQA.md scenario (MQA-1..MQA-16) must be executed in the browser
  with evidence — as proof that the T48 SHIP_HANDOFF.md and T49
  manualQA.md deliverables are complete and the production system
  meets the full brief contract.
- **Steps:** Post-deploy (T48 RC-140 + T49 RC-141/RC-142):
  1. verify worker SHA via `wrangler deployments list`;
  2. run `npx playwright test --project=chromium` against live URL;
  3. run `npm run verify:all` targeting production URL;
  4. run `npx lighthouse https://theplaynest.net --output=json`;
  5. assert /article/<slug> 200, /:slug 301, AI chat 200 +
     ai_generations row written;
  6. execute every T49 scenario MQA-1..MQA-15 and record per-scenario
     evidence in manualQA-report.md.
- **Expected:** Playwright 0 diff failures; verify:all exits 0;
  Lighthouse Performance >= 80 and Accessibility >= 90; all behavioral
  HTTP assertions match; ai_generations row written; all T49 scenarios
  executed with recorded evidence (RC-141, RC-142 satisfied).
- **Classification:** MUTATING
- **Linked stories/ACs:** T48, T49 — T48.AC3, T49.AC1, T49.AC2
- **Grounding reference:** docs/design-contract.md (full pinned
  surface, §1–§12, via the Playwright pixel-parity + design-contract
  suite) + legacy technical spec
  `theiwise-legacy-readonly/docs/production-verification-checklist.md`
  (the post-deploy verification procedure this checklist extends).
