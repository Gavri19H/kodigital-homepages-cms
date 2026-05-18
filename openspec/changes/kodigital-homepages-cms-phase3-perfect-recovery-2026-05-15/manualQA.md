# Manual QA: kodigital-homepages-cms-phase3-perfect-recovery-2026-05-15

## MQA-1: Admin shell parity: no Phase 1 shell; full legacy layout + classes + KoDigital brand

**Why:** REQ-014/015/022 demand legacy-style admin UX with KoDigital brand; prior sessions rendered the Phase 1 placeholder shell. This scenario proves the full legacy layout renders.

**Action:** Open http://127.0.0.1:8787/admin (Host: cms.kodigital.app). Inspect DOM for required class set (admin-layout, admin-sidebar, sidebar-nav, admin-main, admin-header, admin-content, stats-grid, stat-card, card, toolbar). Inspect brand text.

**Expected:** All required classes present. Brand text matches /KoDigital CMS|Homepage CMS/. No 'Phase 1', 'TheIWise', or 'Psychic Quiz' visible.

**Classification:** READ_ONLY

**Linked stories:** T15

**Linked ACs:** T15.AC1

## MQA-2: Domains tab table + actions + New Site modal visible with full nav

**Why:** REQ-003/016 require Domains tab with full nav across every admin page. Prior sessions rendered partial nav or missed Domains UX.

**Action:** Open /admin/domains. Count sidebar nav entries. Verify Domains table columns: domain, site, vertical, activity, status, articles, created, last provisioned, actions. Click 'New Site'; verify modal opens.

**Expected:** 9 sidebar nav entries. Table renders with 9 columns. Modal renders with name/domain/vertical/activity inputs.

**Classification:** READ_ONLY

**Linked stories:** T3, T15

**Linked ACs:** T3.AC1, T15.AC1

## MQA-3: New Site browser flow: modal -> POST /api/admin/sites -> row appears -> polling starts

**Why:** REQ-004/017/018/019 require real wiring. Prior sessions had stub-only proof. This scenario observes the network request body, response, and UI state update.

**Action:** Open /admin/domains. Click New Site. Fill name='Demo Acme', domain='demo-acme.example', vertical=Wellness, activity=Magazine. Click Create. Observe Network tab.

**Expected:** POST /api/admin/sites with JSON body containing 'name' key. Response 201 with site_id. Domains table immediately shows new row. Provisioning polling panel appears.

**Classification:** MUTATING

**Linked stories:** T3

**Linked ACs:** T3.AC2

## MQA-4: Provisioning 15-step completion + idempotent rerun

**Why:** REQ-005/019 demand resumable deterministic runner.

**Action:** Run provisioning-runner.test.ts: invoke POST /provision/next 15 times then a 16th time.

**Expected:** site_creation_jobs has 1 row; site_creation_job_steps has 15 rows; 16th call inserts no new rows.

**Classification:** MUTATING

**Linked stories:** T4

**Linked ACs:** T4.AC1, T4.AC2

## MQA-5: D1 rows created for site/domain/job/steps/settings/about/legal pages/categories

**Why:** REQ-001/002/020/026 demand DB-level proof.

**Action:** After MQA-3 + MQA-4, query D1 for each table.

**Expected:** sites:1, domains:1, site_creation_jobs:1, site_creation_job_steps:15, site_settings:12, pages WHERE page_type='about':1, pages WHERE page_type='legal':>=2, site_categories:>=1.

**Classification:** READ_ONLY

**Linked stories:** T1, T4, T6

**Linked ACs:** T4.AC2, T4.AC3, T6.AC2

## MQA-6: Articles site-required editor + tenant boundary 403

**Why:** REQ-006/021 demand site-aware articles + tenant guard.

**Action:** PATCH /api/admin/articles/:id under wrong site_id scope.

**Expected:** Response 403 + tenant_violation in body.

**Classification:** MUTATING

**Linked stories:** T5

**Linked ACs:** T5.AC2

## MQA-7: Pages / About site-aware behavior

**Why:** REQ-007/020 demand About page provisioning + site_id filter.

**Action:** Open /admin/pages. Inspect filter inputs. Run provisioning. Query DB.

**Expected:** select[name=site_id] + select[name=page_type] with option=about. After provisioning, pages WHERE page_type='about' AND site_id=X count = 1.

**Classification:** MUTATING

**Linked stories:** T6

**Linked ACs:** T6.AC1, T6.AC2

## MQA-8: Categories multi-vertical allocation

**Why:** REQ-008 demands category_verticals rows per allocation.

**Action:** POST /api/admin/categories with vertical_ids=[1,2,3].

**Expected:** 3 category_verticals rows. Mismatched vertical IDs -> 422.

**Classification:** MUTATING

**Linked stories:** T7

**Linked ACs:** T7.AC1, T7.AC2

## MQA-9: Settings site-scoped save + version bump

**Why:** REQ-009 demands settings_version bump per site.

**Action:** PATCH /api/admin/settings with site_id=X. Re-query site_settings.

**Expected:** site X settings_version = previous + 1; site Y unchanged.

**Classification:** MUTATING

**Linked stories:** T8

**Linked ACs:** T8.AC1

## MQA-10: Media / Tags site/global filters

**Why:** REQ-010/011 demand site-aware Media + Tags filters that distinguish site-scoped rows from globally-shared rows; prior sessions had placeholder list endpoints with no real filtering.

**Action:** GET /api/admin/media?site_id=X and GET /api/admin/tags?site_id=X.

**Expected:** Media returns site+global rows; Tags returns site rows only.

**Classification:** READ_ONLY

**Linked stories:** T9, T10

**Linked ACs:** T9.AC2, T10.AC2

## MQA-11: Cloudflare dry-run: no outbound api.cloudflare.com

**Why:** REQ-013/028 demand zero real Cloudflare mutation.

**Action:** Run provisioning with fetch interceptor.

**Expected:** 0 fetch calls to api.cloudflare.com; cache_purge_log dry_run=1 row written.

**Classification:** MUTATING

**Linked stories:** T12

**Linked ACs:** T12.AC1, T12.AC2

## MQA-12: Public-domain /admin 404 + no-store + noindex/nofollow + no cms.kodigital.app leak

**Why:** REQ-024 demands off-admin-host hardening.

**Action:** curl -H 'Host: demo-acme.example' http://127.0.0.1:8787/admin.

**Expected:** HTTP 404; Cache-Control: no-store; X-Robots-Tag: noindex, nofollow; body has no 'cms.kodigital.app' literal.

**Classification:** READ_ONLY

**Linked stories:** T13

**Linked ACs:** T13.AC2

## MQA-13: Protected-domain rejection at POST /api/admin/sites

**Why:** REQ-025 demands TheIWise + protected domains rejected.

**Action:** POST /api/admin/sites with domain='theiwise.com'.

**Expected:** HTTP 400 with protected_domain_rejected reason; zero sites/domains rows inserted.

**Classification:** MUTATING

**Linked stories:** T11

**Linked ACs:** T11.AC1

## MQA-14: No legacy production refs in active config

**Why:** REQ-029 demands an active config that contains zero references to legacy production identifiers (TheIWise hosts, the legacy a2z-cf-cms-v1 worker/db, the 44c73f76 UUID, or psychic-quiz funnel).

**Action:** Run npm run verify:no-legacy-prod-refs.

**Expected:** Exit 0. Zero matches for theiwise.com / a2z-cf-cms-v1-api / 44c73f76-6ed5-4b26-b442-6c2044326c4d / psychic-quiz in active config.

**Classification:** READ_ONLY

**Linked stories:** T14

**Linked ACs:** T14.AC1

## MQA-15: Live-domain status explicitly production_pending

**Why:** REQ-030 demands explicit develop/ship boundary.

**Action:** Inspect quality-gauntlet/live_domain_routability.json.

**Expected:** live cms.kodigital.app classification = production_pending; develop_target = local.

**Classification:** READ_ONLY

**Linked stories:** T16

**Linked ACs:** T16.AC3

## MQA-16: R2 / media proof or explicit production_pending classification

**Why:** REQ-027 demands R2 dry-run binding proof OR explicit production_pending.

**Action:** grep MEDIA binding in wrangler.toml; verify T9.AC3 classification.

**Expected:** MEDIA binding present in wrangler.toml; R2 upload classified production_pending in test_contract T9.AC3.

**Classification:** READ_ONLY

**Linked stories:** T9

**Linked ACs:** T9.AC1, T9.AC3

## Test Bindings

_Render-only summary of `test_contract.json` (the typed JSON remains canonical)._

| ac_id | binding_type | binding | parser_strategy | cwd | field_refs |
|---|---|---|---|---|---|
| T1.AC1 | command | cd api && npm run db:migrate:local | test_exit_code | worktree_root | site_id, slug |
| T1.AC2 | command | cd api && wrangler d1 execute kodigital-cms-local --local --json --command "S... | parse_db_query | worktree_root | site_id, slug |
| T1.AC3 | command | cd api && wrangler d1 execute kodigital-cms-local --local --json --command "P... | parse_db_query | worktree_root | slug |
| T2.AC1 | test_file | api/test/admin-data-wiring.test.ts | — | — | site_id |
| T2.AC2 | test_name_regex | ^admin ui handlers pass real data to templates | — | — | site_id |
| T3.AC1 | test_file | api/test-ui/domains-create-site.spec.ts | — | — | name, domain, vertical_id, activity_id |
| T3.AC2 | test_name_regex | new site modal POSTs name field to /api/admin/sites | — | — | name, domain |
| T3.AC3 | command | cd api && grep -n 'id="name"' src/admin/templates/domains.ts | parse_grep_count | worktree_root | name |
| T4.AC1 | test_name_regex | provisioning runner completes all 15 steps idempotently | — | — | site_creation_job_id, page_type |
| T4.AC2 | command | cd api && wrangler d1 execute kodigital-cms-local --local --json --command "S... | parse_db_query | worktree_root | site_creation_job_id |
| T4.AC3 | command | cd api && wrangler d1 execute kodigital-cms-local --local --json --command "S... | parse_db_query | worktree_root | site_id, page_type |
| T5.AC1 | test_file | api/test/admin-articles-post-site-id.test.ts | — | — | site_id, slug, tenant_violation |
| T5.AC2 | test_name_regex | PATCH /api/admin/articles/:id rejects cross-site mutation with 403 | — | — | site_id, tenant_violation |
| T5.AC3 | test_name_regex | PATCH /api/admin/articles/:id returns 409 on per-site duplicate slug | — | — | site_id, slug |
| T6.AC1 | test_name_regex | pages template renders site_id filter and page_type filter | — | — | site_id, page_type |
| T6.AC2 | command | cd api && wrangler d1 execute kodigital-cms-local --local --json --command "S... | parse_db_query | worktree_root | page_type |
| T7.AC1 | test_file | api/test/category-multi-vertical.test.ts | — | — | site_id, vertical_ids |
| T7.AC2 | test_name_regex | POST /api/admin/categories writes category_verticals rows | — | — | vertical_ids |
| T8.AC1 | test_name_regex | PATCH /api/admin/settings increments settings_version | — | — | site_id, settings_version |
| T9.AC1 | command | cd api && grep -n 'binding = "MEDIA"' wrangler.toml | parse_grep_count | worktree_root | MEDIA |
| T9.AC2 | test_name_regex | media filter returns site-scoped and global media | — | — | site_id, MEDIA |
| T9.AC3 | deferred_production_pending | R2 upload path requires real Cloudflare credentials + bucket binding; develop... | — | — | MEDIA |
| T10.AC1 | command | cd api && grep -n 'name="site_id"' src/admin/templates/tags.ts | parse_grep_count | worktree_root | site_id |
| T10.AC2 | test_name_regex | tags filter applies site_id filter to query | — | — | site_id |
| T11.AC1 | test_name_regex | assertTenantBoundary throws when site_id mismatches caller scope | — | — | site_id, tenant_violation |
| T11.AC2 | test_name_regex | assertSlugUniquePerSite returns 409 on duplicate slug within site | — | — | site_id, slug |
| T12.AC1 | test_name_regex | provisioning runner does not call api.cloudflare.com when SITE_PROVISIONING_D... | — | — | SITE_PROVISIONING_DRY_RUN |
| T12.AC2 | command | cd api && wrangler d1 execute kodigital-cms-local --local --json --command "S... | parse_db_query | worktree_root | SITE_PROVISIONING_DRY_RUN |
| T13.AC1 | test_file | api/test-ui/admin-routing-security.spec.ts | — | — | X_Robots_Tag, Cache_Control, ADMIN_HOST |
| T13.AC2 | command | curl -sS -o /dev/null -w '%{http_code} %{header_cache-control} %{header_x-rob... | parse_curl_response | worktree_root | X_Robots_Tag, Cache_Control, ADMIN_HOST |
| T14.AC1 | command | cd api && npm run verify:no-legacy-prod-refs | test_exit_code | worktree_root | — |
| T14.AC2 | command | cd api && npm run verify:infra | test_exit_code | worktree_root | — |
| T14.AC3 | command | cd api && npm run verify:worker-config | test_exit_code | worktree_root | — |
| T15.AC1 | test_file | api/test-ui/admin-ux-parity.spec.ts | — | — | admin_layout, admin_sidebar, sidebar_nav, kodigital_brand |
| T15.AC2 | command | cd api && npx playwright test --reporter=html | parse_playwright_trace | worktree_root | admin_layout, kodigital_brand |
| T15.AC3 | command | ls api/test-results/index.html | test_exit_code | worktree_root | — |
| T16.AC1 | command | test -f openspec/changes/kodigital-homepages-cms-phase3-perfect-recovery-2026... | test_exit_code | worktree_root | — |
| T16.AC2 | command | test -f openspec/changes/kodigital-homepages-cms-phase3-perfect-recovery-2026... | test_exit_code | worktree_root | — |
| T16.AC3 | command | test -f openspec/changes/kodigital-homepages-cms-phase3-perfect-recovery-2026... | test_exit_code | worktree_root | — |
| T16.AC4 | command | test -f openspec/changes/kodigital-homepages-cms-phase3-perfect-recovery-2026... | test_exit_code | worktree_root | — |
| T16.AC5 | command | test -f openspec/changes/kodigital-homepages-cms-phase3-perfect-recovery-2026... | test_exit_code | worktree_root | — |
| T16.AC6 | command | test -f openspec/changes/kodigital-homepages-cms-phase3-perfect-recovery-2026... | test_exit_code | worktree_root | — |
