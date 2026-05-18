# Tasks: kodigital-homepages-cms-phase3-perfect-recovery-2026-05-15

## Implementation Steps

1. Step 1: Apply migration 0007 locally (T1).
2. Step 2: Wire api/src/admin/data.ts query wrappers into ui.ts handlers (T2 — root cause fix for empty admin pages).
3. Step 3: Verify WARN-FIX-3 name field migration shipped + re-execute domains-create-site spec (T3).
4. Step 4: Execute 15-step provisioning runner against local D1 + assert all DB side-effects (T4).
5. Step 5: Run PATCH /api/admin/articles/:id contract tests (T5).
6. Step 6: Verify Pages template site_id + page_type filters; About page row creation (T6).
7. Step 7: Add or verify POST /api/admin/categories writing category_verticals rows (T7).
8. Step 8: Verify PATCH /api/admin/settings bumps settings_version per site (T8).
9. Step 9: Verify R2 MEDIA binding + add dry-run media filter test (T9).
10. Step 10: Verify WARN-FIX-4 site_id field name migration in tags + media templates (T10).
11. Step 11: Execute tenant-guards unit + integration tests (T11).
12. Step 12: Add fetch interceptor test proving no outbound api.cloudflare.com (T12).
13. Step 13: Execute admin-routing-security spec + curl proof for off-admin-host /admin (T13).
14. Step 14: Run verify:no-legacy-prod-refs + verify:infra + verify:worker-config (T14).
15. Step 15: Execute FULL Playwright suite + produce test-results/ HTML report (T15).
16. Step 16: Author the 6 mission-specific quality-gauntlet artifacts (T16).
17. Step 17: Update .github/workflows/deploy.yml deploy-production job to apply D1 migrations before wrangler deploy. Add a 'Apply D1 migrations (production)' step that runs `npm run db:migrate:remote` (or `npx wrangler d1 migrations apply kodigital-homepages-cms-db --remote`) BEFORE the 'Deploy to production' step. Include a comment line `# Apply migration 0007_phase3r_drop_global_slug_unique.sql + future migrations` for P9 grep anchor. (T17)

## Story Tasks

- [ ] **T1:** Apply migration 0007 locally and prove per-site slug UNIQUE replaces legacy global slug UNIQUE
  - Files: `api/migrations/0007_phase3r_drop_global_slug_unique.sql`, `api/package.json`
- [ ] **T2:** Wire api/src/admin/data.ts query wrappers into api/src/admin/ui.ts route handlers so every admin page renders live data, not empty arrays
  - Files: `api/src/admin/ui.ts`, `api/src/admin/data.ts`, `api/test/admin-data-wiring.test.ts`
- [ ] **T3:** Verify WARN-FIX-3 site_name->name migration shipped in domains template + sites-handler and re-execute domains-create-site spec
  - Files: `api/src/admin/templates/domains.ts`, `api/src/admin/sites-handlers.ts`, `api/test-ui/domains-create-site.spec.ts`
- [ ] **T4:** Execute the 15-step provisioning runner against local D1 and prove every persistence side-effect plus idempotent rerun
  - Files: `api/src/site-provisioning/runner.ts`, `api/src/site-provisioning/steps.ts`, `api/src/site-provisioning/legal-renderer.ts`, `api/test/provisioning-runner.test.ts`
- [ ] **T5:** Re-execute PATCH /api/admin/articles/:id contract tests covering tenant boundary, per-site slug uniqueness, category vertical validation, and allow-list field gating
  - Files: `api/src/admin/api.ts`, `api/src/site/tenant-guards.ts`, `api/test/admin-articles-post-site-id.test.ts`
- [ ] **T6:** Verify Pages template renders site_id filter + page_type filter (especially page_type='about') and About editor inserts the correct pages row
  - Files: `api/src/admin/templates/pages.ts`, `api/src/admin/data.ts`, `api/test/pages-template.test.ts`
- [ ] **T7:** Add or verify POST /api/admin/categories with multi-vertical allocation writing category_verticals rows
  - Files: `api/src/admin/api.ts`, `api/src/admin/data.ts`, `api/test/category-multi-vertical.test.ts`
- [ ] **T8:** Verify PATCH /api/admin/settings bumps site_settings.settings_version and is strictly site-scoped (no global update)
  - Files: `api/src/admin/sites-handlers.ts`, `api/test/admin-settings.test.ts`
- [ ] **T9:** Verify R2 binding MEDIA in wrangler.toml + add 1 dry-run test for site-scoped Media filter (R2 actual upload = production_pending)
  - Files: `api/wrangler.toml`, `api/src/admin/data.ts`, `api/test/media-filter.test.ts`
- [ ] **T10:** Verify WARN-FIX-4 site_id->site field-name migration in tags + media template select inputs and site-aware filters operate
  - Files: `api/src/admin/templates/tags.ts`, `api/src/admin/templates/media.ts`, `api/test/tags-media-filter.test.ts`
- [ ] **T11:** Execute tenant-guards unit + integration tests proving assertTenantBoundary / assertSlugUniquePerSite / validateCategoryForSite / resolvePageScope are path-traced through PATCH /api/admin/articles/:id
  - Files: `api/src/site/tenant-guards.ts`, `api/src/site/site-context.ts`, `api/test/tenant-guards.test.ts`
- [ ] **T12:** Add fetch interceptor test proving zero outbound api.cloudflare.com requests during dry-run provisioning + cache_purge_log dry-run row written
  - Files: `api/src/site-provisioning/cloudflare-interfaces.ts`, `api/test/provisioning-no-outbound.test.ts`
- [ ] **T13:** Execute admin-routing-security spec against local server + Host header asserting off-admin-host /admin returns 404 + no-store + noindex/nofollow + no leak
  - Files: `api/src/admin/router.ts`, `api/test-ui/admin-routing-security.spec.ts`
- [ ] **T14:** Run no-legacy-prod-refs + verify:infra + verify:worker-config and assert all exit 0
  - Files: `api/package.json`, `api/wrangler.toml`, `api/scripts/`
- [ ] **T15:** Execute FULL Playwright suite (admin-ux-parity, domains-create-site, admin-routing-security) against local Worker and produce api/test-results/ with HTML report
  - Files: `api/test-ui/admin-ux-parity.spec.ts`, `api/test-ui/domains-create-site.spec.ts`, `api/test-ui/admin-routing-security.spec.ts`, `api/playwright.config.ts`, `api/test-results/index.html`
- [ ] **T16:** Author the 6 mission-specific Q1-Q4 artifacts (mission_goal_trace, source_context_pack, live_domain_routability, wire_protocol_parity, manualqa_goal_coverage, reviewer_artifact_diff_plan) under openspec/changes/<cid>/quality-gauntlet/
  - Files: `openspec/changes/kodigital-homepages-cms-phase3-perfect-recovery-2026-05-15/quality-gauntlet/mission_goal_trace.json`, `openspec/changes/kodigital-homepages-cms-phase3-perfect-recovery-2026-05-15/quality-gauntlet/source_context_pack.json`, `openspec/changes/kodigital-homepages-cms-phase3-perfect-recovery-2026-05-15/quality-gauntlet/live_domain_routability.json`, `openspec/changes/kodigital-homepages-cms-phase3-perfect-recovery-2026-05-15/quality-gauntlet/wire_protocol_parity.json`, `openspec/changes/kodigital-homepages-cms-phase3-perfect-recovery-2026-05-15/quality-gauntlet/manualqa_goal_coverage.json`, `openspec/changes/kodigital-homepages-cms-phase3-perfect-recovery-2026-05-15/quality-gauntlet/reviewer_artifact_diff_plan.json`
- [ ] **T17:** Add D1 migration apply step to deploy.yml before production deploy
  - Files: `.github/workflows/deploy.yml`

## Files Expected to Change

- `api/migrations/0007_phase3r_drop_global_slug_unique.sql`
- `api/package.json`
- `api/src/admin/ui.ts`
- `api/src/admin/data.ts`
- `api/test/admin-data-wiring.test.ts`
- `api/src/admin/templates/domains.ts`
- `api/src/admin/sites-handlers.ts`
- `api/test-ui/domains-create-site.spec.ts`
- `api/src/site-provisioning/runner.ts`
- `api/src/site-provisioning/steps.ts`
- `api/src/site-provisioning/legal-renderer.ts`
- `api/test/provisioning-runner.test.ts`
- `api/src/admin/api.ts`
- `api/src/site/tenant-guards.ts`
- `api/test/admin-articles-post-site-id.test.ts`
- `api/src/admin/templates/pages.ts`
- `api/test/pages-template.test.ts`
- `api/test/category-multi-vertical.test.ts`
- `api/test/admin-settings.test.ts`
- `api/wrangler.toml`
- `api/test/media-filter.test.ts`
- `api/src/admin/templates/tags.ts`
- `api/src/admin/templates/media.ts`
- `api/test/tags-media-filter.test.ts`
- `api/src/site/site-context.ts`
- `api/test/tenant-guards.test.ts`
- `api/src/site-provisioning/cloudflare-interfaces.ts`
- `api/test/provisioning-no-outbound.test.ts`
- `api/src/admin/router.ts`
- `api/test-ui/admin-routing-security.spec.ts`
- `api/test-ui/admin-ux-parity.spec.ts`
- `api/playwright.config.ts`
- `api/test-results/index.html`
- `openspec/changes/kodigital-homepages-cms-phase3-perfect-recovery-2026-05-15/quality-gauntlet/mission_goal_trace.json`
- `openspec/changes/kodigital-homepages-cms-phase3-perfect-recovery-2026-05-15/quality-gauntlet/source_context_pack.json`
- `openspec/changes/kodigital-homepages-cms-phase3-perfect-recovery-2026-05-15/quality-gauntlet/live_domain_routability.json`
- `openspec/changes/kodigital-homepages-cms-phase3-perfect-recovery-2026-05-15/quality-gauntlet/wire_protocol_parity.json`
- `openspec/changes/kodigital-homepages-cms-phase3-perfect-recovery-2026-05-15/quality-gauntlet/manualqa_goal_coverage.json`
- `openspec/changes/kodigital-homepages-cms-phase3-perfect-recovery-2026-05-15/quality-gauntlet/reviewer_artifact_diff_plan.json`
- `.github/workflows/deploy.yml`