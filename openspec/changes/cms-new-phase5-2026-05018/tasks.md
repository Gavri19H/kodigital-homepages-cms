# Tasks: cms-new-phase5-2026-05018

## Implementation Steps

1. Phase B step 1: Create api/src/public/assets/public-css.ts (T1) + public-js.ts (T2) string modules.
2. Phase B step 2: Create api/src/public/templates/{layout,icons,format,seo,components}.ts (T3, T5, T7, T6, T4).
3. Phase B step 3: Create api/src/public/view-models/{home,article}.ts (T8, T9).
4. Phase B step 4: Create api/src/public/templates/{home,article}.ts wiring components + view-models + seo (T10, T11).
5. Phase B step 5: Update api/src/public/router.ts — add GET / (T12), update /article/:slug with template+fallback (T13), add /assets/public.css + /assets/public.js (T14), upgrade /category/:slug + /page/:slug to layout-wrapped (T15).
6. Phase B step 6: Add api/test/ regression suites T16-T22.
7. Phase B step 7: Run cd api && npx tsc --noEmit && npm test && npm run verify:no-legacy-prod-refs && npm run verify:infra && npm run verify:worker-config (T22).

## Story Tasks

- [ ] **T1:** Add public.css string module with all PART 3 tokens and PART 4 breakpoints
  - Files: `src/public/assets/public-css.ts`
- [ ] **T2:** Add public.js string module with passive-listener reading progress + share/copy
  - Files: `src/public/assets/public-js.ts`
- [ ] **T3:** templates/layout.ts renders the <html> scaffold with site brand-token injection
  - Files: `src/public/templates/layout.ts`
- [ ] **T4:** templates/components.ts exports site-aware components
  - Files: `src/public/templates/components.ts`
- [ ] **T5:** templates/icons.ts exports inline SVG icons
  - Files: `src/public/templates/icons.ts`
- [ ] **T6:** templates/seo.ts exports JSON-LD builders + meta helpers
  - Files: `src/public/templates/seo.ts`
- [ ] **T7:** templates/format.ts exports formatDate, formatReadTime, truncateExcerpt
  - Files: `src/public/templates/format.ts`
- [ ] **T8:** view-models/home.ts exports buildHomeViewModel(db, siteContext)
  - Files: `src/public/view-models/home.ts`
- [ ] **T9:** view-models/article.ts exports buildArticleViewModel + adaptBodyBlocks
  - Files: `src/public/view-models/article.ts`
- [ ] **T10:** templates/home.ts renders 13 sections in PART 1 order
  - Files: `src/public/templates/home.ts`
- [ ] **T11:** templates/article.ts renders 12 sections in PART 2 order + minmax(0, 1fr)
  - Files: `src/public/templates/article.ts`
- [ ] **T12:** router.ts adds GET / handler wiring home view-model + template
  - Files: `src/public/router.ts`
- [ ] **T13:** /article/:slug uses Article template with fallback
  - Files: `src/public/router.ts`
- [ ] **T14:** /assets/public.css + /assets/public.js cacheable routes
  - Files: `src/public/router.ts`
- [ ] **T15:** /category/:slug + /page/:slug use site-aware layout wrapper
  - Files: `src/public/router.ts`
- [ ] **T16:** Regression: cms.kodigital.app does not render home
  - Files: `test/public-admin-host-no-home.test.ts`
- [ ] **T17:** Regression: reserved-path catch-all 404s admin/api/static/media/preview/health
  - Files: `test/public-reserved-paths.test.ts`
- [ ] **T18:** Regression: no hardcoded TheIWise brand in rendered Home + Article
  - Files: `test/public-no-theiwise-brand-render.test.ts`
- [ ] **T19:** JSON-LD presence on Home + Article
  - Files: `test/public-json-ld-presence.test.ts`
- [ ] **T20:** Image attribute + lazy-load tests
  - Files: `test/public-image-attrs.test.ts`
- [ ] **T21:** Ad-slot attribute tests
  - Files: `test/public-ad-slots.test.ts`
- [ ] **T22:** Regression: typecheck + verify:no-legacy-prod-refs + verify:infra + verify:worker-config all exit 0
  - Files: `test/verify-scripts-green.test.ts`

## Files Expected to Change

- `src/public/assets/public-css.ts`
- `src/public/assets/public-js.ts`
- `src/public/templates/layout.ts`
- `src/public/templates/components.ts`
- `src/public/templates/icons.ts`
- `src/public/templates/seo.ts`
- `src/public/templates/format.ts`
- `src/public/templates/home.ts`
- `src/public/templates/article.ts`
- `src/public/view-models/home.ts`
- `src/public/view-models/article.ts`
- `src/public/router.ts`
- `test/public-templates-layout.test.ts`
- `test/public-templates-components.test.ts`
- `test/public-templates-seo.test.ts`
- `test/public-templates-format.test.ts`
- `test/public-templates-home.test.ts`
- `test/public-templates-article.test.ts`
- `test/public-view-models-home.test.ts`
- `test/public-view-models-article.test.ts`
- `test/public-router-home.test.ts`
- `test/public-router-article.test.ts`
- `test/public-router-assets.test.ts`
- `test/public-router-category-page.test.ts`
- `test/public-admin-host-no-home.test.ts`
- `test/public-reserved-paths.test.ts`
- `test/public-no-theiwise-brand-render.test.ts`
- `test/public-json-ld-presence.test.ts`
- `test/public-image-attrs.test.ts`
- `test/public-ad-slots.test.ts`
- `test/verify-scripts-green.test.ts`