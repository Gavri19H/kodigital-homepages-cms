# Proposal: kodigital-homepages-cms-phase3-perfect-recovery-2026-05-15

## Main Goal

Make the local/develop KoDigital Homepages CMS a true multi-site CMS with a legacy-style KoDigital admin UX, where every one of the 30 REQ items has an artifact-backed proof route exercised by deterministic local commands or executed Playwright runs, and the new Q1-Q4 quality gates (mission_goal_trace, source_context_pack, wire_protocol_parity, manualqa_goal_coverage, reviewer_artifact_diff_plan) prove the prior weak-proof failures cannot reoccur.

- **Entity:** kodigital_homepages_cms_admin
- **Action:** verify_and_complete_multi_site_admin_recovery_locally
- **Metric:** develop_quality_gauntlet_exit_code == 0
- **Failure criterion:** Any in-scope REQ lacks browser/DB/API proof; OR ManualQA accepts PASS with in-scope sub-failure; OR evidence_source=semantic_review_only is used for REQ-006/007/008/009/010/011; OR migration 0007 is not applied locally; OR test-results/ is absent after the Playwright run; OR any 'TheIWise' / 'a2z-cf-cms-v1-*' / '44c73f76-6ed5-4b26-b442-6c2044326c4d' / 'psychic-quiz' reference appears in active runtime config.

## Stories (17)

### T1: Apply migration 0007 locally and prove per-site slug UNIQUE replaces legacy global slug UNIQUE [db]

**Target files:** `api/migrations/0007_phase3r_drop_global_slug_unique.sql`, `api/package.json`

**Acceptance Criteria:**

- T1.AC1: cd api && npm run db:migrate:local returns exit 0 (all 7 migrations apply)
- T1.AC2: BEHAVIORAL: GIVEN local D1 with migrations 0001-0007 applied, WHEN we query sqlite_master for index 'idx_articles_site_slug_unique', THEN exactly 1 row returned and 0 rows for legacy 'idx_articles_slug_global'.
- T1.AC3: BEHAVIORAL: GIVEN two sites A and B exist, WHEN we INSERT an article with slug='about' for site A then slug='about' for site B, THEN both inserts succeed (no UNIQUE violation across sites); WHEN we INSERT a second slug='about' for site A, THEN UNIQUE violation is raised.

### T2: Wire api/src/admin/data.ts query wrappers into api/src/admin/ui.ts route handlers so every admin page renders live data, not empty arrays [api]

**Target files:** `api/src/admin/ui.ts`, `api/src/admin/data.ts`, `api/test/admin-data-wiring.test.ts`

**Acceptance Criteria:**

- T2.AC1: FUNCTIONAL: api/test/admin-data-wiring.test.ts file exists and contains >=9 vitest test cases (one per admin route: dashboard, domains, articles, pages, categories, tags, media, settings, presets) each asserting the renderer received non-empty data from data.ts.
- T2.AC2: BEHAVIORAL: GIVEN local D1 has at least 1 site and 1 article seeded, WHEN GET /admin/articles is requested, THEN the rendered HTML body contains an articles table row (not an 'empty-state' div) AND the data.ts:listArticlesForSite wrapper was called with the resolved site_id.

### T3: Verify WARN-FIX-3 site_name->name migration shipped in domains template + sites-handler and re-execute domains-create-site spec [ui]

**Target files:** `api/src/admin/templates/domains.ts`, `api/src/admin/sites-handlers.ts`, `api/test-ui/domains-create-site.spec.ts`

**Acceptance Criteria:**

- T3.AC1: FUNCTIONAL: api/test-ui/domains-create-site.spec.ts file exists and contains a test step that fills input#name (not input#site_name).
- T3.AC2: BEHAVIORAL: GIVEN /admin/domains is open in a browser, WHEN the user clicks 'New Site' and submits the form with name='Demo Site' / domain='demo-acme.example' / vertical_id=1 / activity_id=1, THEN the POST /api/admin/sites network request body parses as JSON containing the literal key 'name' (NOT 'site_name'), THE response is 201 with a JSON body containing site_id, AND the Domains table immediately re-renders with the new row.
- T3.AC3: grep -n 'id="name"' api/src/admin/templates/domains.ts returns >= 1 matching line

### T4: Execute the 15-step provisioning runner against local D1 and prove every persistence side-effect plus idempotent rerun [script]

**Target files:** `api/src/site-provisioning/runner.ts`, `api/src/site-provisioning/steps.ts`, `api/src/site-provisioning/legal-renderer.ts`, `api/test/provisioning-runner.test.ts`

**Acceptance Criteria:**

- T4.AC1: BEHAVIORAL: GIVEN a newly created sites row, WHEN the test invokes POST /provision/next 15 times, THEN site_creation_jobs has 1 row and site_creation_job_steps has 15 rows all with status='completed'; AND when the test invokes POST /provision/next a 16th time, THEN no new step rows are inserted (idempotent).
- T4.AC2: BEHAVIORAL: GIVEN provisioning completed for site X, WHEN we query site_creation_job_steps for the latest job, THEN COUNT(*) = 15.
- T4.AC3: BEHAVIORAL: GIVEN provisioning completed for site X (REQ-020), WHEN we query pages WHERE page_type='about' AND site_id=X, THEN COUNT(*) = 1.

### T5: Re-execute PATCH /api/admin/articles/:id contract tests covering tenant boundary, per-site slug uniqueness, category vertical validation, and allow-list field gating [api]

**Target files:** `api/src/admin/api.ts`, `api/src/site/tenant-guards.ts`, `api/test/admin-articles-post-site-id.test.ts`

**Acceptance Criteria:**

- T5.AC1: FUNCTIONAL: api/test/admin-articles-post-site-id.test.ts contains >= 4 vitest cases (tenant boundary 403, slug duplicate 409, category vertical mismatch 422, allow-list field gating).
- T5.AC2: BEHAVIORAL: GIVEN site A owns article id=10 and site B is the caller, WHEN PATCH /api/admin/articles/10 is invoked under site B's resolved scope, THEN response status is 403 AND body contains tenant_violation field.
- T5.AC3: BEHAVIORAL: GIVEN article slug='foo' exists for site A, WHEN PATCH /api/admin/articles/<other-A-article> attempts to set slug='foo', THEN response status is 409.

### T6: Verify Pages template renders site_id filter + page_type filter (especially page_type='about') and About editor inserts the correct pages row [ui]

**Target files:** `api/src/admin/templates/pages.ts`, `api/src/admin/data.ts`, `api/test/pages-template.test.ts`

**Acceptance Criteria:**

- T6.AC1: BEHAVIORAL: GIVEN /admin/pages is rendered, WHEN we inspect the rendered HTML, THEN there is a select[name=site_id] AND a select[name=page_type] with option value='about'.
- T6.AC2: BEHAVIORAL: GIVEN a site exists with no pages, WHEN provisioning runs for that site, THEN exactly 1 pages row with page_type='about' exists for that site_id.

### T7: Add or verify POST /api/admin/categories with multi-vertical allocation writing category_verticals rows [api]

**Target files:** `api/src/admin/api.ts`, `api/src/admin/data.ts`, `api/test/category-multi-vertical.test.ts`

**Acceptance Criteria:**

- T7.AC1: FUNCTIONAL: api/test/category-multi-vertical.test.ts asserts POST body { site_id, name, slug, vertical_ids: [1,2,3] } causes exactly 3 category_verticals rows to be inserted.
- T7.AC2: BEHAVIORAL: GIVEN site X has allowed_verticals=[1,2,3], WHEN POST /api/admin/categories with vertical_ids=[1,4] is invoked, THEN response status is 422 and zero category_verticals rows are inserted (validate vertical IDs match site's allowed set).

### T8: Verify PATCH /api/admin/settings bumps site_settings.settings_version and is strictly site-scoped (no global update) [api]

**Target files:** `api/src/admin/sites-handlers.ts`, `api/test/admin-settings.test.ts`

**Acceptance Criteria:**

- T8.AC1: BEHAVIORAL: GIVEN site_settings row for site X has settings_version=N, WHEN PATCH /api/admin/settings with site_id=X and any setting change is invoked, THEN site_settings.settings_version for site X = N+1 AND site_settings rows for site Y are unchanged.

### T9: Verify R2 binding MEDIA in wrangler.toml + add 1 dry-run test for site-scoped Media filter (R2 actual upload = production_pending) [config]

**Target files:** `api/wrangler.toml`, `api/src/admin/data.ts`, `api/test/media-filter.test.ts`

**Acceptance Criteria:**

- T9.AC1: grep -n 'binding = "MEDIA"' api/wrangler.toml returns >= 1 matching line
- T9.AC2: BEHAVIORAL: GIVEN media rows exist for site X (3) and site_id=null (2 global), WHEN data.ts:listMediaForSite(X) is called, THEN it returns 5 rows (3 site + 2 global).
- T9.AC3: FUNCTIONAL: R2 upload itself is production_pending (test_contract binding T9.AC3 = deferred_production_pending with reason).

### T10: Verify WARN-FIX-4 site_id->site field-name migration in tags + media template select inputs and site-aware filters operate [ui]

**Target files:** `api/src/admin/templates/tags.ts`, `api/src/admin/templates/media.ts`, `api/test/tags-media-filter.test.ts`

**Acceptance Criteria:**

- T10.AC1: grep -n 'name="site_id"' api/src/admin/templates/tags.ts returns >= 1 matching line
- T10.AC2: BEHAVIORAL: GIVEN tags exist for site A (3) and site B (2), WHEN GET /api/admin/tags?site_id=A is called, THEN exactly 3 tag rows are returned.

### T11: Execute tenant-guards unit + integration tests proving assertTenantBoundary / assertSlugUniquePerSite / validateCategoryForSite / resolvePageScope are path-traced through PATCH /api/admin/articles/:id [api]

**Target files:** `api/src/site/tenant-guards.ts`, `api/src/site/site-context.ts`, `api/test/tenant-guards.test.ts`

**Acceptance Criteria:**

- T11.AC1: BEHAVIORAL: GIVEN caller scope = site A, WHEN assertTenantBoundary(row.site_id=B) is invoked, THEN it throws TenantViolation; AND PATCH /api/admin/articles/<B-article> response is 403.
- T11.AC2: BEHAVIORAL: GIVEN article slug='foo' exists for site A, WHEN assertSlugUniquePerSite(site_id=A, slug='foo') is invoked, THEN it throws SlugConflict 409.

### T12: Add fetch interceptor test proving zero outbound api.cloudflare.com requests during dry-run provisioning + cache_purge_log dry-run row written [script]

**Target files:** `api/src/site-provisioning/cloudflare-interfaces.ts`, `api/test/provisioning-no-outbound.test.ts`

**Acceptance Criteria:**

- T12.AC1: BEHAVIORAL: GIVEN SITE_PROVISIONING_DRY_RUN=true and a fetch spy installed, WHEN the 15-step runner executes, THEN zero fetch calls targeted api.cloudflare.com.
- T12.AC2: BEHAVIORAL: GIVEN dry-run provisioning completes, WHEN we query cache_purge_log WHERE dry_run=1, THEN COUNT(*) >= 1.

### T13: Execute admin-routing-security spec against local server + Host header asserting off-admin-host /admin returns 404 + no-store + noindex/nofollow + no leak [infra]

**Target files:** `api/src/admin/router.ts`, `api/test-ui/admin-routing-security.spec.ts`

**Acceptance Criteria:**

- T13.AC1: FUNCTIONAL: api/test-ui/admin-routing-security.spec.ts file exists and the test runs to completion with PASS status (Playwright reporter).
- T13.AC2: BEHAVIORAL: GIVEN wrangler dev running on http://127.0.0.1:8787 with ADMIN_HOST=cms.kodigital.app, WHEN curl -H 'Host: demo-acme.example' http://127.0.0.1:8787/admin is invoked, THEN HTTP status = 404, response header Cache-Control = 'no-store', response header X-Robots-Tag = 'noindex, nofollow', AND response body MUST NOT contain the literal string 'cms.kodigital.app'.

### T14: Run no-legacy-prod-refs + verify:infra + verify:worker-config and assert all exit 0 [config]

**Target files:** `api/package.json`, `api/wrangler.toml`, `api/scripts/`

**Acceptance Criteria:**

- T14.AC1: cd api && npm run verify:no-legacy-prod-refs exits 0
- T14.AC2: cd api && npm run verify:infra exits 0
- T14.AC3: cd api && npm run verify:worker-config exits 0

### T15: Execute FULL Playwright suite (admin-ux-parity, domains-create-site, admin-routing-security) against local Worker and produce api/test-results/ with HTML report [ui]

**Target files:** `api/test-ui/admin-ux-parity.spec.ts`, `api/test-ui/domains-create-site.spec.ts`, `api/test-ui/admin-routing-security.spec.ts`, `api/playwright.config.ts`, `api/test-results/index.html`

**Acceptance Criteria:**

- T15.AC1: BEHAVIORAL: GIVEN local Worker running on http://127.0.0.1:8787, WHEN admin-ux-parity.spec.ts runs against /admin (Host: cms.kodigital.app), THEN every one of the 9 admin routes (dashboard, domains, articles, pages, categories, tags, media, settings, presets) renders an HTML document containing classes admin-layout AND admin-sidebar AND sidebar-nav with >= 9 nav-item elements AND visible brand text matches /KoDigital CMS|Homepage CMS/ AND does NOT contain 'TheIWise' or 'Phase 1 admin shell' or 'Psychic Quiz'.
- T15.AC2: BEHAVIORAL: GIVEN all three Playwright specs are in api/test-ui, WHEN cd api && npx playwright test runs to completion, THEN Playwright exit code is 0 AND api/test-results/index.html exists.
- T15.AC3: ls api/test-results/index.html exits 0 (HTML report file present after Playwright run)

### T16: Author the 6 mission-specific Q1-Q4 artifacts (mission_goal_trace, source_context_pack, live_domain_routability, wire_protocol_parity, manualqa_goal_coverage, reviewer_artifact_diff_plan) under openspec/changes/<cid>/quality-gauntlet/ [config]

**Target files:** `openspec/changes/kodigital-homepages-cms-phase3-perfect-recovery-2026-05-15/quality-gauntlet/mission_goal_trace.json`, `openspec/changes/kodigital-homepages-cms-phase3-perfect-recovery-2026-05-15/quality-gauntlet/source_context_pack.json`, `openspec/changes/kodigital-homepages-cms-phase3-perfect-recovery-2026-05-15/quality-gauntlet/live_domain_routability.json`, `openspec/changes/kodigital-homepages-cms-phase3-perfect-recovery-2026-05-15/quality-gauntlet/wire_protocol_parity.json`, `openspec/changes/kodigital-homepages-cms-phase3-perfect-recovery-2026-05-15/quality-gauntlet/manualqa_goal_coverage.json`, `openspec/changes/kodigital-homepages-cms-phase3-perfect-recovery-2026-05-15/quality-gauntlet/reviewer_artifact_diff_plan.json`

**Acceptance Criteria:**

- T16.AC1: mission_goal_trace.json exists with 1 row per REQ-001..030 (30 rows)
- T16.AC2: source_context_pack.json exists
- T16.AC3: live_domain_routability.json exists and declares cms.kodigital.app = production_pending; develop_target = local
- T16.AC4: wire_protocol_parity.json exists and contains rows for: New Site modal->POST/sites; provisioning next; PATCH articles; settings PATCH; media/tags filters; pages provisioning; categories vertical allocation
- T16.AC5: manualqa_goal_coverage.json exists and contains rows MQA-1..MQA-16 mapping each to in-scope REQ
- T16.AC6: reviewer_artifact_diff_plan.json exists and enumerates artifact diff inputs (screenshots, DOM snapshots, DB query outputs, API traces, Playwright traces, wire_protocol_parity, manualqa_goal_coverage)

### T17: Add D1 migration apply step to deploy.yml before production deploy [infra]

**Target files:** `.github/workflows/deploy.yml`

**Acceptance Criteria:**

- T17.AC1: deploy.yml deploy-production job invokes wrangler d1 migrations apply for kodigital-homepages-cms-db before wrangler deploy --env production. Honors deploy-safety.md D1-file rule (every migration filename grep-able in deploy.yml).
- T17.AC2: deploy.yml references migration 0007 by filename (P9 grep anchor; per-migration traceability).
- T17.AC3: Ordering: migration apply step appears BEFORE wrangler deploy --env production in the deploy-production job (safety: schema lands before worker that reads it).

## Alternatives Considered

### Migration 0007 application surface

**Chosen:** Apply migration 0007 to LOCAL D1 only (kodigital-cms-local) via npm run db:migrate:local; never --remote.
**Rationale:** REQ-026 requires local migration apply with proof. Remote apply is explicitly forbidden by user mission brief. Skipping reproduces the prior session failure where REQ-007/020 silently failed.
**Alternatives:**
- wrangler d1 migrations apply --remote (FORBIDDEN by HARD SCOPE RULE; would mutate production)
- Manual SQL apply via direct wrangler d1 execute (loses migrations table tracking; non-idempotent)
- Skip migration 0007 (rejected: leaves legacy global UNIQUE(slug) active; second site's 'about' page silently dropped by INSERT OR IGNORE)

### T2 root-cause sequencing (admin renders empty data)

**Chosen:** T2 (wire data.ts into ui.ts) runs FIRST among feature stories because every admin renderer story (T3, T6, T7, T8, T10) depends on real data flowing into the templates.
**Rationale:** Prior Explore probe identified ui.ts handlers passing [], null to template renderers — this is the SINGLE highest-leverage fix. Without T2, T3/T6/T8/T10 PASS validators while the actual product is broken.
**Alternatives:**
- Verify each renderer story independently with mock data (rejected: doesn't fix the underlying admin pages render empty)
- Defer T2 to a later cycle (rejected: every other UI story would falsely PASS against empty templates)

### Playwright execution boundary

**Chosen:** Execute all 3 Playwright specs against local wrangler dev (http://127.0.0.1:8787) + Host header; produce api/test-results/ HTML report.
**Rationale:** REQ-023 demands executed Playwright with test-results artifact. Prior sessions accepted spec-file grep as proof; this mission's Q1-Q4 gates explicitly forbid that.
**Alternatives:**
- Execute against live cms.kodigital.app (FORBIDDEN by HARD SCOPE RULE; develop must not assume live changes)
- Accept Playwright spec FILE PRESENCE as proof (REJECTED — exact prior failure pattern: test-results/ never existed)
- grep on Playwright spec file (REJECTED by user brief: not browser proof)

### R2 / media binding strategy

**Chosen:** Verify MEDIA binding presence in wrangler.toml + add data.ts:listMediaForSite dry-run test. R2 upload itself = production_pending in test_contract T9.AC3.
**Rationale:** User brief explicitly requires 'R2 dry-run binding proof exists for Media workflows' OR 'mark upload as production_pending in mission_goal_trace; still prove site-aware Media filter behavior locally; do not silently omit R2'.
**Alternatives:**
- Mock R2 entirely in tests (rejected: misses real binding shape)
- Real R2 upload during develop (rejected: HARD SCOPE RULE forbids production R2 mutation)
- Omit R2 entirely (rejected: user brief explicitly forbids silent omission)

### Off-admin-host /admin hardening proof

**Chosen:** curl + Host header against local wrangler dev. Assert HTTP 404 + Cache-Control: no-store + X-Robots-Tag: noindex, nofollow + body lacks 'cms.kodigital.app' literal.
**Rationale:** REQ-024 has 4 atomic assertions; curl response parsing covers all 4 deterministically.
**Alternatives:**
- Test against live demo domain (FORBIDDEN; develop doesn't mutate live)
- Source-grep on router.ts conditional (rejected: doesn't prove actual HTTP response)

### Quality-gauntlet artifact location

**Chosen:** openspec/changes/<cid>/quality-gauntlet/ in project root (NOT mission-state).
**Rationale:** Plan-writer write boundaries (write-boundaries.md) prescribe project openspec/changes/<cid>/ as the single artifact location for plan-phase artifacts.
**Alternatives:**
- .a2z/mission-state/<cid>/quality-gauntlet/ (rejected: write-boundaries.md restricts mission-state writes; openspec/ is the canonical artifact home)
- Workspace root (rejected: single-artifact-location rule)

### Live cms.kodigital.app classification

**Chosen:** production_pending. develop_target = local wrangler dev. /a2z-ship owns the deploy + live-verify cycle.
**Rationale:** REQ-030 demands explicit develop/ship boundary. production_pending classification is the canonical contract for ship-only work.
**Alternatives:**
- Live + deploy in this mission (FORBIDDEN; develop != ship)
- Out-of-scope (rejected: live verification IS part of the overall feature lifecycle; classifying as production_pending preserves the work item without conflating phase ownership)

### Production-deploy migration apply step (T17)

**Chosen:** Add a step to deploy.yml deploy-production job that runs `npm run db:migrate:remote` (= wrangler d1 migrations apply kodigital-homepages-cms-db --remote) BEFORE `npm run deploy:production`. Include comment referencing migration 0007 for traceability. Production deploy still gated by workflow_dispatch (human click) per existing deploy.yml policy.
**Rationale:** BJA-5V audit classified the validate_antipatterns P9 residual as non-skill-owned plan_authoring_defect with canonical action reauthor_plan. Mission brief explicitly forbids --remote at develop time; T1 covers local-apply (REQ-026). Production migration apply belongs at ship/deploy time (REQ-030 explicit develop/ship boundary). Adding T17 as a standalone ops story is the smallest correct repair: it authors the deploy.yml step in Phase A; Ralph edits the file in Phase B; production migration apply still requires human workflow_dispatch click. CLOUDFLARE_API_TOKEN scope in deploy.yml already covers Workers Scripts:Edit which permits wrangler d1 migrations apply.
**Alternatives:**
- Expand T1 scope to include deploy.yml edit (rejected: mixes develop-time and ship-time concerns; T1's local-apply title would hide the production change)
- Full re-dispatch of plan-writer subagent for canonical reauthor_plan (rejected: ~$1-2 cost and 5-10 min wall-clock for a 1-story append is over-broad)
- Suppress P9 antipattern for this mission (rejected: masks real production deploy-safety risk; deploy-safety.md D1-file rule exists exactly to catch this)

## Risk Assessment

- **Mutating actions:** local D1 INSERT/UPDATE on kodigital-cms-local, local R2 fake binding INSERT (dry-run), filesystem writes to api/test-results/ during Playwright runs, openspec/changes/<cid>/quality-gauntlet/ artifact creation

## Rollback Plan

Per-story rollback: T1 = wrangler d1 execute --local --command 'PRAGMA foreign_keys=OFF;' then re-apply migrations 0001-0006 (or restore .wrangler/state from snapshot taken pre-mission). T2 = git restore api/src/admin/ui.ts api/src/admin/data.ts api/test/admin-data-wiring.test.ts. T3-T15 = git restore <target_files>. T16 = rm -rf openspec/changes/<cid>/quality-gauntlet/. Whole-mission rollback: git checkout main && git branch -D mission/kodigital-homepages-cms-phase3-perfect-recovery-2026-05-15 in the worktree; restore .wrangler/state from snapshot. NO production state ever touched, so no production rollback required.

## Source Pack Summary

_Render-only summary of `source_pack.json` (the typed JSON remains canonical)._

| source_id | source_type | staleness_policy | used_for | evidence_summary |
|---|---|---|---|---|
| SP-USER-1 | user_request |  | mission_draft.main_goal, field_contract.fields[].forbidden_substitutes, interface_contract.endpoints[].forbidden_substitutes, test_contract.bindings, design_contract.forbidden_substitutes, mission_goal_trace.requirements | User mission brief at /Users/guyhaikov/Downloads/kodigital-homepages-cms-phase3-perfect-recovery-2026-05-15.md (sha25... |
| SP-USER-2 | user_request |  | field_contract.fields[].forbidden_substitutes, interface_contract.endpoints[].forbidden_substitutes | User mission brief HARD-RED-LINE RESOURCES list: theiwise.com / api.theiwise.com / admin.theiwise.com / a2z-cf-cms-v1... |
| SP-DOCS-1 | local_doc | refresh_per_session | field_contract.fields[].forbidden_substitutes, test_contract.bindings, design_contract.forbidden_substitutes | Repo-local no-touch red-line manifest enumerating the legacy TheIWise resources that MUST NOT appear in active config... |
| SP-DOCS-2 | local_doc | refresh_per_session | field_contract.fields, interface_contract.endpoints | Repo-local source architecture doc describing admin layout, public-host routing, site context resolution, and tenant ... |
| SP-DOCS-3 | local_doc | refresh_per_session | interface_contract.endpoints, test_contract.bindings | ADMIN_HOST + public host classification doc. Documents that off-admin-host /admin returns 404 with no-store + noindex... |
| SP-PROBE-1 | code_probe |  | field_contract.fields, interface_contract.endpoints, test_contract.bindings | Code probe of api/src/admin/sites-handlers.ts and api/src/admin/templates/domains.ts in current product worktree conf... |
| SP-PROBE-2 | code_probe |  | field_contract.fields, test_contract.bindings | Code probe of api/src/admin/data.ts confirmed presence of query wrapper functions (listSitesForAdmin, listArticlesFor... |
| SP-PROBE-3 | db_schema |  | field_contract.fields, interface_contract.endpoints[].db_effects, test_contract.bindings | DB schema probe of api/migrations/0001..0007 confirmed tables: sites, domains, verticals, category_verticals, site_ca... |
| SP-PROBE-4 | code_probe |  | test_contract.bindings | Code probe of api/test-ui/ confirmed three Playwright specs exist (admin-routing-security.spec.ts, admin-ux-parity.sp... |
| SP-DESIGN-1 | design_memory | pinned | design_contract.content_blocks, design_contract.cta_sequence, field_contract.fields | Legacy TheIWise admin layout template (read-only). Source of truth for the legacy admin UX class names (admin-layout,... |
| SP-DESIGN-2 | design_memory | pinned | design_contract.content_blocks | Legacy dashboard template. Source of the stats-grid + stat-card pattern used on /admin landing. |
| SP-DESIGN-3 | design_memory | pinned | design_contract.content_blocks | Legacy admin ui.ts. Source for the route -> template wiring pattern and the data-query -> renderer parameter shape th... |
| SP-PROBE-5 | api_probe | refresh_per_session | interface_contract.endpoints, test_contract.bindings | Local wrangler-dev API probe target. All admin API endpoint behavior in this mission is verified against http://127.0... |

## Interface Contract Summary

_Render-only summary of `interface_contract.json` (the typed JSON remains canonical)._

| name | method | path | request_fields | response_fields | redirect_params | forbidden_substitutes |
|---|---|---|---|---|---|---|
| CreateSite | POST | /api/admin/sites | name, domain, vertical_id, activity_id | site_id |  | name: Handler reads body.name; sending site_na; domain: Protected legacy production domain; must |
| ProvisionNext | POST | /api/admin/sites/:id/provision/next | site_id | site_creation_job_id |  | — |
| PatchArticle | PATCH | /api/admin/articles/:id | site_id, slug | tenant_violation |  | — |
| CreateCategory | POST | /api/admin/categories | site_id, vertical_ids | site_id |  | — |
| PatchSettings | PATCH | /api/admin/settings | site_id | settings_version |  | — |
| ListArticles | GET | /api/admin/articles | site_id |  |  | — |
| ListMedia | GET | /api/admin/media | site_id |  |  | — |
| ListTags | GET | /api/admin/tags | site_id |  |  | — |
| AdminOffHost | GET | /admin |  | X_Robots_Tag, Cache_Control |  | — |
