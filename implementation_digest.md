# Implementation Digest — change kodigital-homepages-cms-phase3-perfect-recovery-2026-05-15

Mode: field_sensitive_with_ui  |  Profiles: evidence_route_strict, api_contract, db_schema, ui_conversion, field_sensitive  |  Mission-global RCs: 1

## RED LINE — typed contract authority
The fields, wire names, endpoint paths, and design specs below are AUTHORITATIVE. Implement EXACTLY as specified. Field names in HTTP request bodies / redirect URLs / cookies are the WIRE name (right column), NOT the canonical name. Do not invent field names; do not paraphrase typed contracts.

## RED-LINE substitutions
- field_contract.fields.forbidden_substitutes for `name` — {'value': 'site_name', 'reason': "Pre-WARN-FIX-3 field name; UI must send 'name' so the handler insert path receives the value (handler does not read site_name).", 'source_id': 'SP-PROBE-1'} (Pre-WARN-FIX-3 field name; UI must send 'name' so the handler insert path receives the value (handler does not read site_name).); source SP-PROBE-1
- field_contract.fields.forbidden_substitutes for `domain` — {'value': 'theiwise.com', 'reason': 'Protected legacy production domain. Must be rejected at /api/admin/sites with 400 + protected_domain_rejected reason.', 'source_id': 'SP-USER-2'} (Protected legacy production domain. Must be rejected at /api/admin/sites with 400 + protected_domain_rejected reason.); source SP-USER-2
- field_contract.fields.forbidden_substitutes for `domain` — {'value': 'www.theiwise.com', 'reason': 'Protected legacy production www host. Must be rejected at /api/admin/sites.', 'source_id': 'SP-USER-2'} (Protected legacy production www host. Must be rejected at /api/admin/sites.); source SP-USER-2
- field_contract.fields.forbidden_substitutes for `domain` — {'value': 'admin.theiwise.com', 'reason': 'Protected legacy admin host. Must be rejected at /api/admin/sites.', 'source_id': 'SP-USER-2'} (Protected legacy admin host. Must be rejected at /api/admin/sites.); source SP-USER-2
- field_contract.fields.forbidden_substitutes for `kodigital_brand` — {'value': 'TheIWise', 'reason': 'TheIWise is a legacy brand; visible brand text in the new KoDigital admin must NOT show TheIWise per REQ-014 plus the no-touch red-line.', 'source_id': 'SP-USER-2'} (TheIWise is a legacy brand; visible brand text in the new KoDigital admin must NOT show TheIWise per REQ-014 plus the no-touch red-line.); source SP-USER-2
- field_contract.fields.forbidden_substitutes for `kodigital_brand` — {'value': 'Phase 1 admin shell', 'reason': 'Placeholder shell forbidden per REQ-015.', 'source_id': 'SP-USER-1'} (Placeholder shell forbidden per REQ-015.); source SP-USER-1
- field_contract.fields.forbidden_substitutes for `kodigital_brand` — {'value': 'Psychic Quiz', 'reason': 'Unrelated funnel forbidden per HARD-RED-LINE.', 'source_id': 'SP-USER-2'} (Unrelated funnel forbidden per HARD-RED-LINE.); source SP-USER-2
- design_contract.forbidden_substitutes — TheIWise brand visible in admin (REQ-014 requires KoDigital brand; TheIWise is legacy.); source SP-USER-2
- design_contract.forbidden_substitutes — Phase 1 admin shell visible (REQ-015 forbids the placeholder shell.); source SP-USER-1
- design_contract.forbidden_substitutes — Psychic Quiz nav entry (Unrelated funnel forbidden per HARD-RED-LINE.); source SP-USER-2
- mission_spec.main_goal.forbidden_substitutes — evaluator_prose_only_PASS (main_goal_forbidden_substitute)
- mission_spec.main_goal.forbidden_substitutes — manualQA_PASS_with_in_scope_subassertion_failure (main_goal_forbidden_substitute)
- mission_spec.main_goal.forbidden_substitutes — grep_on_spec_file_as_browser_proof (main_goal_forbidden_substitute)
- mission_spec.main_goal.forbidden_substitutes — DEPLOY_AND_VERIFY_as_satisfying_proof_for_develop_REQ (main_goal_forbidden_substitute)
- mission_spec.main_goal.forbidden_substitutes — production_pending_for_local_verifiable_REQ (main_goal_forbidden_substitute)

## Mission-wide design constraints (ui_conversion)
- Route: `/admin`
- Conversion goal: Internal admin UX (no public conversion). Goal: legacy-style KoDigital admin layout based on the read-only TheIWise admin templates, with KoDigital brand text, full 9-entry nav across every admin page, and zero Phase 1 placeholder shell or unrelated funnel labels rendered.
- Viewport: 375px max scrollWidth 375px
- Viewport: 1280px max scrollWidth 1280px
- Tone: Admin internal tool; no marketing copy.
- Tone: Brand text must say 'KoDigital CMS' or 'Homepage CMS', never 'TheIWise'.
- Tone: Forbidden visible strings: 'Phase 1 admin shell', 'Psychic Quiz', 'TheIWise'.
- A11y: Modal: focusable trap; ESC closes; click-outside closes.
- A11y: Sidebar nav: active state has aria-current='page'.
- A11y: Polling panel: role='status' + aria-live='polite' so screen readers announce progress.
- A11y: Form inputs: every form-input has an associated form-label (no aria-label-only).

## Mission-global required claims
- RC-001 (ac_satisfied, deterministic_runner, action=RUN)

Run once after final story commit:
```
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/a2z-develop/scripts/run_required_evidence_command.py --change-id=kodigital-homepages-cms-phase3-perfect-recovery-2026-05-15 --required-claim-ids=RC-001 --evidence-plan=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-homepages-cms-phase3-perfect-recovery-2026-05-15/required_evidence_plan.json --workspace-root=/Users/guyhaikov/a2z-workspaces --project-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms --worktree-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms
```

## Story T1: Apply migration 0007 locally and prove per-site slug UNIQUE replaces legacy global slug UNIQUE
- Category: db
- Target Files: api/migrations/0007_phase3r_drop_global_slug_unique.sql, api/package.json
- AC ids: T1.AC1, T1.AC2, T1.AC3
- RC ids: RC-002, RC-003, RC-004

### Field Contracts (canonical → wire)
| canonical_name | wire_name | field_class | source |
|---|---|---|---|
| site_id | site_id | db_column | SP-PROBE-3 |
| slug | slug | db_column | SP-PROBE-3 |

### Interface Endpoints
- POST /api/admin/sites — request_fields: [name, domain, vertical_id, activity_id]
  response_fields: [site_id]
- POST /api/admin/sites/:id/provision/next — request_fields: [site_id]
  response_fields: [site_creation_job_id]
- PATCH /api/admin/articles/:id — request_fields: [site_id, slug]
  response_fields: [tenant_violation]
- POST /api/admin/categories — request_fields: [site_id, vertical_ids]
  response_fields: [site_id]
- PATCH /api/admin/settings — request_fields: [site_id]
  response_fields: [settings_version]
- GET /api/admin/articles — request_fields: [site_id]
- GET /api/admin/media — request_fields: [site_id]
- GET /api/admin/tags — request_fields: [site_id]

### Test Bindings (post-implementation deterministic checks)
- T1.AC1 (command) — `cd api && npm run db:migrate:local` (expects exit_code=0, parser test_exit_code, fields: site_id,slug)
- T1.AC2 (command) — `cd api && wrangler d1 execute kodigital-cms-local --local --json --command "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_articles_site_slug_unique';"` (expects {'jsonpath': '$.results[0].name', 'value': 'idx_articles_site_slug_unique'}, parser parse_db_query, fields: site_id,slug)
- T1.AC3 (command) — `cd api && wrangler d1 execute kodigital-cms-local --local --json --command "PRAGMA index_list('articles');"` (expects {'jsonpath': "$.results[?(@.name=='idx_articles_slug_global')]", 'value': None}, parser parse_db_query, fields: slug)

### Evidence Routes After Implementation
Per-story actionable: RC-002. Deferred to ship: RC-003, RC-004. Skip diagnostic: none.

After committing this story, run via canonical runner:
```
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/a2z-develop/scripts/run_required_evidence_command.py --change-id=kodigital-homepages-cms-phase3-perfect-recovery-2026-05-15 --required-claim-ids=RC-002 --evidence-plan=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-homepages-cms-phase3-perfect-recovery-2026-05-15/required_evidence_plan.json --workspace-root=/Users/guyhaikov/a2z-workspaces --project-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms --worktree-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms
```

### Q1 Context Packet
- **requirement_ids:** R-FROM-T1, R-FROM-T2, R-FROM-T3, R-FROM-T4, R-FROM-T5, R-FROM-T6, R-FROM-T7, R-FROM-T8, R-FROM-T9, R-FROM-T10, R-FROM-T11, R-FROM-T12, R-FROM-T13, R-FROM-T14, R-FROM-T15, R-FROM-T16
- **source_context_ids:** SCTX-012, SCTX-013
- **goal_classes:** schema
- **must_use_files:**
  - `SCTX-012` — schema source-of-truth for DB columns
  - `SCTX-013` — required context for archetype table_diff
- **must_not_do:**
  - do not weaken acceptance criteria to make tests pass
- **definition_of_done:**
  - Migrations apply locally and PRAGMA table_info lists declared columns
- **negative_fail_conditions (HARD FAIL):**
  - migration applies but PRAGMA table_info does not list declared column

### Q1 Story Quality Checks (REQUIRED)
Each check whose `required=true` is a Ralph completion gate. A required check that fails BLOCKS the story — do NOT proceed to commit. Global `npm test` is NOT sufficient unless the packet maps it explicitly. For UI/browser stories, grep-on-TS-source is NEVER sufficient — the browser_check command must run Playwright with a class-set or response-status assertion.

| check | required | kind | command | assertion |
|---|---|---|---|---|
| browser | no | - | `-` | - |
| api | no | - | `-` | - |
| db | yes | wrangler_d1_migrations_apply_and_check | `cd api && npx wrangler d1 migrations apply {db} --local && npx wrangler d1 ex...` | migration applied + table schema includes declared columns |
| job | no | - | `-` | - |
| outbound | no | - | `-` | - |

### Acceptance Tests
- `acceptance-tests/T1-syntactic.sh`

## Story T2: Wire api/src/admin/data.ts query wrappers into api/src/admin/ui.ts route handlers so every admin page renders live data, not empty arrays
- Category: api
- Target Files: api/src/admin/ui.ts, api/src/admin/data.ts, api/test/admin-data-wiring.test.ts
- AC ids: T2.AC1, T2.AC2
- RC ids: RC-005, RC-006

### Field Contracts (canonical → wire)
| canonical_name | wire_name | field_class | source |
|---|---|---|---|
| site_id | site_id | db_column | SP-PROBE-3 |

### Interface Endpoints
- POST /api/admin/sites — request_fields: [name, domain, vertical_id, activity_id]
  response_fields: [site_id]
- POST /api/admin/sites/:id/provision/next — request_fields: [site_id]
  response_fields: [site_creation_job_id]
- PATCH /api/admin/articles/:id — request_fields: [site_id, slug]
  response_fields: [tenant_violation]
- POST /api/admin/categories — request_fields: [site_id, vertical_ids]
  response_fields: [site_id]
- PATCH /api/admin/settings — request_fields: [site_id]
  response_fields: [settings_version]
- GET /api/admin/articles — request_fields: [site_id]
- GET /api/admin/media — request_fields: [site_id]
- GET /api/admin/tags — request_fields: [site_id]

### Test Bindings (post-implementation deterministic checks)
- T2.AC1 (test_file) — file: `api/test/admin-data-wiring.test.ts` (test file does NOT exist at base — Ralph must CREATE it)
- T2.AC2 (test_name_regex) — name regex: `^admin ui handlers pass real data to templates`

### Evidence Routes After Implementation
Per-story actionable: RC-005, RC-006. Deferred to ship: none. Skip diagnostic: none.

After committing this story, run via canonical runner:
```
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/a2z-develop/scripts/run_required_evidence_command.py --change-id=kodigital-homepages-cms-phase3-perfect-recovery-2026-05-15 --required-claim-ids=RC-005,RC-006 --evidence-plan=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-homepages-cms-phase3-perfect-recovery-2026-05-15/required_evidence_plan.json --workspace-root=/Users/guyhaikov/a2z-workspaces --project-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms --worktree-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms
```

### Q1 Context Packet
- **requirement_ids:** R-FROM-T1, R-FROM-T2, R-FROM-T3, R-FROM-T4, R-FROM-T5, R-FROM-T6, R-FROM-T7, R-FROM-T8, R-FROM-T9, R-FROM-T10, R-FROM-T11, R-FROM-T12, R-FROM-T13, R-FROM-T14, R-FROM-T15, R-FROM-T16
- **goal_classes:** wire_protocol_consistency
- **must_not_do:**
  - do not rename form field name without updating handler read AND DB column
- **definition_of_done:**
  - Form field name == handler-read field name == DB column name (all match)
- **negative_fail_conditions (HARD FAIL):**
  - form input name does not equal handler-read field name
  - DB column receives wrong value because of field-name mismatch

### Q1 Story Quality Checks (REQUIRED)
Each check whose `required=true` is a Ralph completion gate. A required check that fails BLOCKS the story — do NOT proceed to commit. Global `npm test` is NOT sufficient unless the packet maps it explicitly. For UI/browser stories, grep-on-TS-source is NEVER sufficient — the browser_check command must run Playwright with a class-set or response-status assertion.

| check | required | kind | command | assertion |
|---|---|---|---|---|
| browser | yes | form_input_name_matches_post_field | `grep -c 'name="{field}"' {form_template_path}` | form input name == POST body field == DB column |
| api | yes | handler_reads_same_field | `grep -c 'body.{field}' {handler_path}` | handler reads body.{field} not body.{other_name} |
| db | yes | wrangler_d1_select_assert_value | `cd api && npx wrangler d1 execute {db} --local --command "SELECT {column} FRO...` | column receives the value sent via form |
| job | no | - | `-` | - |
| outbound | no | - | `-` | - |

### Acceptance Tests
- `acceptance-tests/T2-syntactic.sh`

## Story T3: Verify WARN-FIX-3 site_name->name migration shipped in domains template + sites-handler and re-execute domains-create-site spec
- Category: ui
- Target Files: api/src/admin/templates/domains.ts, api/src/admin/sites-handlers.ts, api/test-ui/domains-create-site.spec.ts
- AC ids: T3.AC1, T3.AC2, T3.AC3
- RC ids: RC-007, RC-008, RC-009, RC-044

### Field Contracts (canonical → wire)
| canonical_name | wire_name | field_class | source |
|---|---|---|---|
| activity_id | activity_id | request_field | SP-PROBE-1 |
| domain | domain | request_field | SP-PROBE-1 |
| name | name | request_field | SP-PROBE-1 |
| vertical_id | vertical_id | request_field | SP-PROBE-1 |

### Interface Endpoints
- POST /api/admin/sites — request_fields: [name, domain, vertical_id, activity_id]
  response_fields: [site_id]

### Design slice (story-linked content_blocks)
- sidebar_nav_full (cta): 9-entry nav rendered in every admin route: Dashboard, Domains, Articles, Pages, 
- domains_table (hero): Domains tab table columns: domain, site, vertical, activity, status, articles, c
- new_site_modal (cta): Modal with form-group + form-input + form-select rows: domain, name, vertical, a

### Test Bindings (post-implementation deterministic checks)
- T3.AC1 (test_file) — file: `api/test-ui/domains-create-site.spec.ts` (exists at base: yes)
- T3.AC2 (test_name_regex) — name regex: `new site modal POSTs name field to /api/admin/sites`
- T3.AC3 (command) — `cd api && grep -n 'id="name"' src/admin/templates/domains.ts` (expects {'min_lines': 1}, parser parse_grep_count, fields: name)

### Evidence Routes After Implementation
Per-story actionable: RC-007, RC-008, RC-009. Deferred to ship: RC-044. Skip diagnostic: none.

After committing this story, run via canonical runner:
```
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/a2z-develop/scripts/run_required_evidence_command.py --change-id=kodigital-homepages-cms-phase3-perfect-recovery-2026-05-15 --required-claim-ids=RC-007,RC-008,RC-009 --evidence-plan=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-homepages-cms-phase3-perfect-recovery-2026-05-15/required_evidence_plan.json --workspace-root=/Users/guyhaikov/a2z-workspaces --project-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms --worktree-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms
```

### Q1 Context Packet
- **requirement_ids:** R-FROM-T1, R-FROM-T2, R-FROM-T3, R-FROM-T4, R-FROM-T5, R-FROM-T6, R-FROM-T7, R-FROM-T8, R-FROM-T9, R-FROM-T10, R-FROM-T11, R-FROM-T12, R-FROM-T13, R-FROM-T14, R-FROM-T15, R-FROM-T16
- **source_context_ids:** SCTX-014, SCTX-019, SCTX-020
- **goal_classes:** api, db_proof, ui_browser_interaction, wire_protocol_consistency
- **must_use_files:**
  - `SCTX-014` — form HTML the modal renders
  - `SCTX-019` — required context for archetype form_field
  - `SCTX-020` — required context for archetype request_field
- **must_not_do:**
  - do not let interactive controls close without firing the declared POST
  - do not use page.waitForRequest as proof without asserting response.status()
  - do not rename form field name without updating handler read AND DB column
- **definition_of_done:**
  - Playwright spec asserts both page.waitForRequest AND response.status() in {200,201}
  - created row exists in the target DB table on SELECT
  - Form field name == handler-read field name == DB column name (all match)
  - Endpoint round-trip + SELECT confirms write
- **negative_fail_conditions (HARD FAIL):**
  - modal click closes without firing the expected POST
  - Playwright test asserts request fired but does not assert response.status() == 2xx
  - form input name does not equal handler-read field name
  - DB column receives wrong value because of field-name mismatch
  - endpoint returns 2xx but DB row is absent on SELECT

### Q1 Story Quality Checks (REQUIRED)
Each check whose `required=true` is a Ralph completion gate. A required check that fails BLOCKS the story — do NOT proceed to commit. Global `npm test` is NOT sufficient unless the packet maps it explicitly. For UI/browser stories, grep-on-TS-source is NEVER sufficient — the browser_check command must run Playwright with a class-set or response-status assertion.

| check | required | kind | command | assertion |
|---|---|---|---|---|
| browser | yes | playwright_with_network_capture | `cd api && npx playwright test {spec_path} --reporter=json` | page.waitForRequest({method, url}) AND response.status() in {2xx_range} |
| api | yes | curl_or_vitest_response | `cd api && npm test -- --grep '{endpoint}' OR curl http://localhost:8787{route}` | response shape matches interface_contract |
| db | yes | wrangler_d1_select_assert_row | `cd api && npx wrangler d1 execute {db} --local --command "{select_sql}"` | if endpoint has db_effects, SELECT confirms write |
| job | yes | poll_until_terminal | `for i in $(seq 1 20); do curl -s {status_url}; sleep 1; done` | final status in {succeeded, failed} |
| outbound | no | - | `-` | - |

### Acceptance Tests
- `acceptance-tests/T3-syntactic.sh`

## Story T4: Execute the 15-step provisioning runner against local D1 and prove every persistence side-effect plus idempotent rerun
- Category: script
- Target Files: api/src/site-provisioning/runner.ts, api/src/site-provisioning/steps.ts, api/src/site-provisioning/legal-renderer.ts, api/test/provisioning-runner.test.ts
- AC ids: T4.AC1, T4.AC2, T4.AC3
- RC ids: RC-010, RC-011, RC-012, RC-045

### Field Contracts (canonical → wire)
| canonical_name | wire_name | field_class | source |
|---|---|---|---|
| page_type | page_type | db_column | SP-PROBE-3 |
| site_creation_job_id | site_creation_job_id | db_column | SP-PROBE-3 |
| site_id | site_id | db_column | SP-PROBE-3 |

### Interface Endpoints
- POST /api/admin/sites — request_fields: [name, domain, vertical_id, activity_id]
  response_fields: [site_id]
- POST /api/admin/sites/:id/provision/next — request_fields: [site_id]
  response_fields: [site_creation_job_id]
- PATCH /api/admin/articles/:id — request_fields: [site_id, slug]
  response_fields: [tenant_violation]
- POST /api/admin/categories — request_fields: [site_id, vertical_ids]
  response_fields: [site_id]
- PATCH /api/admin/settings — request_fields: [site_id]
  response_fields: [settings_version]
- GET /api/admin/articles — request_fields: [site_id]
- GET /api/admin/media — request_fields: [site_id]
- GET /api/admin/tags — request_fields: [site_id]

### Test Bindings (post-implementation deterministic checks)
- T4.AC1 (test_name_regex) — name regex: `provisioning runner completes all 15 steps idempotently`
- T4.AC2 (command) — `cd api && wrangler d1 execute kodigital-cms-local --local --json --command "SELECT COUNT(*) AS c FROM site_creation_job_steps WHERE site_creation_job_id = (SELECT id FROM site_creation_jobs ORDER BY id DESC LIMIT 1);"` (expects {'jsonpath': '$.results[0].c', 'value': 15}, parser parse_db_query, fields: site_creation_job_id)
- T4.AC3 (command) — `cd api && wrangler d1 execute kodigital-cms-local --local --json --command "SELECT COUNT(*) AS c FROM pages WHERE page_type='about' AND site_id = (SELECT id FROM sites ORDER BY id DESC LIMIT 1);"` (expects {'jsonpath': '$.results[0].c', 'value': 1}, parser parse_db_query, fields: site_id,page_type)

### Evidence Routes After Implementation
Per-story actionable: RC-010. Deferred to ship: RC-011, RC-012, RC-045. Skip diagnostic: none.

After committing this story, run via canonical runner:
```
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/a2z-develop/scripts/run_required_evidence_command.py --change-id=kodigital-homepages-cms-phase3-perfect-recovery-2026-05-15 --required-claim-ids=RC-010 --evidence-plan=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-homepages-cms-phase3-perfect-recovery-2026-05-15/required_evidence_plan.json --workspace-root=/Users/guyhaikov/a2z-workspaces --project-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms --worktree-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms
```

### Q1 Context Packet
- **requirement_ids:** R-FROM-T1, R-FROM-T2, R-FROM-T3, R-FROM-T4, R-FROM-T5, R-FROM-T6, R-FROM-T7, R-FROM-T8, R-FROM-T9, R-FROM-T10, R-FROM-T11, R-FROM-T12, R-FROM-T13, R-FROM-T14, R-FROM-T15, R-FROM-T16
- **source_context_ids:** SCTX-003, SCTX-009
- **goal_classes:** cf_dry_run, provisioning_step
- **must_use_files:**
  - `SCTX-003` — dry-run guard surface
  - `SCTX-009` — provisioning step body to mirror
- **must_not_do:**
  - do not skip steps; do not bypass dry-run flag without explicit story AC
  - do not emit any outbound fetch to api.cloudflare.com under dry-run
- **definition_of_done:**
  - All declared steps run end-to-end against local D1; every side-effect table has rows
  - Fetch-mock harness records 0 outbound fetches in dry-run mode
- **negative_fail_conditions (HARD FAIL):**
  - provisioning crashes before completing all declared steps in dry-run mode
  - step succeeded but expected side-effect table has 0 rows
  - dry-run mode emits any outbound HTTP to api.cloudflare.com

### Q1 Story Quality Checks (REQUIRED)
Each check whose `required=true` is a Ralph completion gate. A required check that fails BLOCKS the story — do NOT proceed to commit. Global `npm test` is NOT sufficient unless the packet maps it explicitly. For UI/browser stories, grep-on-TS-source is NEVER sufficient — the browser_check command must run Playwright with a class-set or response-status assertion.

| check | required | kind | command | assertion |
|---|---|---|---|---|
| browser | no | - | `-` | - |
| api | yes | trigger_provisioner | `curl -X POST http://localhost:8787{route}` | provisioner invoked |
| db | yes | wrangler_d1_select_all_side_effect_tables | `cd api && npx wrangler d1 execute {db} --local --command "SELECT * FROM {side...` | every step's side-effect table has expected row(s) |
| job | yes | site_creation_job_steps_complete | `cd api && npx wrangler d1 execute {db} --local --command "SELECT step_key, st...` | every step status='succeeded' OR job has last_error populated |
| outbound | yes | fetch_mock_observation_zero_outbound | `cd api && npm test -- --grep 'dry-run'` | 0 fetches to api.cloudflare.com |

### Acceptance Tests
- `acceptance-tests/T4-syntactic.sh`

## Story T5: Re-execute PATCH /api/admin/articles/:id contract tests covering tenant boundary, per-site slug uniqueness, category vertical validation, and allow-list field gating
- Category: api
- Target Files: api/src/admin/api.ts, api/src/site/tenant-guards.ts, api/test/admin-articles-post-site-id.test.ts
- AC ids: T5.AC1, T5.AC2, T5.AC3
- RC ids: RC-013, RC-014, RC-015, RC-046

### Field Contracts (canonical → wire)
| canonical_name | wire_name | field_class | source |
|---|---|---|---|
| site_id | site_id | db_column | SP-PROBE-3 |
| slug | slug | db_column | SP-PROBE-3 |
| tenant_violation | tenant_violation | response_field | SP-PROBE-2 |

### Interface Endpoints
- POST /api/admin/sites — request_fields: [name, domain, vertical_id, activity_id]
  response_fields: [site_id]
- POST /api/admin/sites/:id/provision/next — request_fields: [site_id]
  response_fields: [site_creation_job_id]
- PATCH /api/admin/articles/:id — request_fields: [site_id, slug]
  response_fields: [tenant_violation]
- POST /api/admin/categories — request_fields: [site_id, vertical_ids]
  response_fields: [site_id]
- PATCH /api/admin/settings — request_fields: [site_id]
  response_fields: [settings_version]
- GET /api/admin/articles — request_fields: [site_id]
- GET /api/admin/media — request_fields: [site_id]
- GET /api/admin/tags — request_fields: [site_id]

### Test Bindings (post-implementation deterministic checks)
- T5.AC1 (test_file) — file: `api/test/admin-articles-post-site-id.test.ts` (exists at base: yes)
- T5.AC2 (test_name_regex) — name regex: `PATCH /api/admin/articles/:id rejects cross-site mutation with 403`
- T5.AC3 (test_name_regex) — name regex: `PATCH /api/admin/articles/:id returns 409 on per-site duplicate slug`

### Evidence Routes After Implementation
Per-story actionable: RC-013, RC-014, RC-015. Deferred to ship: RC-046. Skip diagnostic: none.

After committing this story, run via canonical runner:
```
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/a2z-develop/scripts/run_required_evidence_command.py --change-id=kodigital-homepages-cms-phase3-perfect-recovery-2026-05-15 --required-claim-ids=RC-013,RC-014,RC-015 --evidence-plan=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-homepages-cms-phase3-perfect-recovery-2026-05-15/required_evidence_plan.json --workspace-root=/Users/guyhaikov/a2z-workspaces --project-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms --worktree-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms
```

### Q1 Context Packet
- **requirement_ids:** R-FROM-T1, R-FROM-T2, R-FROM-T3, R-FROM-T4, R-FROM-T5, R-FROM-T6, R-FROM-T7, R-FROM-T8, R-FROM-T9, R-FROM-T10, R-FROM-T11, R-FROM-T12, R-FROM-T13, R-FROM-T14, R-FROM-T15, R-FROM-T16
- **source_context_ids:** SCTX-001, SCTX-002, SCTX-006, SCTX-008, SCTX-016
- **goal_classes:** api, db_proof
- **must_use_files:**
  - `SCTX-001` — endpoint body the story modifies
  - `SCTX-002` — required context for archetype interface_contract_endpoint
  - `SCTX-006` — endpoint body the story modifies
  - `SCTX-008` — required context for archetype tenant_guard
  - `SCTX-016` — API handler that receives the POST
- **must_not_do:**
  - do not weaken acceptance criteria to make tests pass
- **definition_of_done:**
  - Endpoint round-trip + SELECT confirms write
- **negative_fail_conditions (HARD FAIL):**
  - endpoint returns 2xx but DB row is absent on SELECT

### Q1 Story Quality Checks (REQUIRED)
Each check whose `required=true` is a Ralph completion gate. A required check that fails BLOCKS the story — do NOT proceed to commit. Global `npm test` is NOT sufficient unless the packet maps it explicitly. For UI/browser stories, grep-on-TS-source is NEVER sufficient — the browser_check command must run Playwright with a class-set or response-status assertion.

| check | required | kind | command | assertion |
|---|---|---|---|---|
| browser | no | - | `-` | - |
| api | yes | curl_or_vitest_response | `cd api && npm test -- --grep '{endpoint}' OR curl http://localhost:8787{route}` | response shape matches interface_contract |
| db | yes | wrangler_d1_select_assert_row | `cd api && npx wrangler d1 execute {db} --local --command "{select_sql}"` | if endpoint has db_effects, SELECT confirms write |
| job | no | - | `-` | - |
| outbound | no | - | `-` | - |

### Acceptance Tests
- `acceptance-tests/T5-syntactic.sh`

## Story T6: Verify Pages template renders site_id filter + page_type filter (especially page_type='about') and About editor inserts the correct pages row
- Category: ui
- Target Files: api/src/admin/templates/pages.ts, api/src/admin/data.ts, api/test/pages-template.test.ts
- AC ids: T6.AC1, T6.AC2
- RC ids: RC-016, RC-017, RC-047

### Field Contracts (canonical → wire)
| canonical_name | wire_name | field_class | source |
|---|---|---|---|
| page_type | page_type | db_column | SP-PROBE-3 |
| site_id | site_id | db_column | SP-PROBE-3 |

### Interface Endpoints
- POST /api/admin/sites — request_fields: [name, domain, vertical_id, activity_id]
  response_fields: [site_id]
- POST /api/admin/sites/:id/provision/next — request_fields: [site_id]
  response_fields: [site_creation_job_id]
- PATCH /api/admin/articles/:id — request_fields: [site_id, slug]
  response_fields: [tenant_violation]
- POST /api/admin/categories — request_fields: [site_id, vertical_ids]
  response_fields: [site_id]
- PATCH /api/admin/settings — request_fields: [site_id]
  response_fields: [settings_version]
- GET /api/admin/articles — request_fields: [site_id]
- GET /api/admin/media — request_fields: [site_id]
- GET /api/admin/tags — request_fields: [site_id]

### Design slice (story-linked content_blocks)
- about_page_editor (value_prop): Pages tab About editor inserts a pages row with page_type='about'. Site-aware: f

### Test Bindings (post-implementation deterministic checks)
- T6.AC1 (test_name_regex) — name regex: `pages template renders site_id filter and page_type filter`
- T6.AC2 (command) — `cd api && wrangler d1 execute kodigital-cms-local --local --json --command "SELECT page_type FROM pages WHERE page_type='about' LIMIT 1;"` (expects {'jsonpath': '$.results[0].page_type', 'value': 'about'}, parser parse_db_query, fields: page_type)

### Evidence Routes After Implementation
Per-story actionable: RC-016. Deferred to ship: RC-017, RC-047. Skip diagnostic: none.

After committing this story, run via canonical runner:
```
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/a2z-develop/scripts/run_required_evidence_command.py --change-id=kodigital-homepages-cms-phase3-perfect-recovery-2026-05-15 --required-claim-ids=RC-016 --evidence-plan=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-homepages-cms-phase3-perfect-recovery-2026-05-15/required_evidence_plan.json --workspace-root=/Users/guyhaikov/a2z-workspaces --project-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms --worktree-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms
```

### Q1 Context Packet
- **requirement_ids:** R-FROM-T1, R-FROM-T2, R-FROM-T3, R-FROM-T4, R-FROM-T5, R-FROM-T6, R-FROM-T7, R-FROM-T8, R-FROM-T9, R-FROM-T10, R-FROM-T11, R-FROM-T12, R-FROM-T13, R-FROM-T14, R-FROM-T15, R-FROM-T16
- **goal_classes:** api
- **must_not_do:**
  - do not weaken acceptance criteria to make tests pass
- **negative_fail_conditions (HARD FAIL):**
  - acceptance criteria pass while user-facing outcome is broken

### Q1 Story Quality Checks (REQUIRED)
Each check whose `required=true` is a Ralph completion gate. A required check that fails BLOCKS the story — do NOT proceed to commit. Global `npm test` is NOT sufficient unless the packet maps it explicitly. For UI/browser stories, grep-on-TS-source is NEVER sufficient — the browser_check command must run Playwright with a class-set or response-status assertion.

| check | required | kind | command | assertion |
|---|---|---|---|---|
| browser | no | - | `-` | - |
| api | yes | curl_or_vitest_response | `cd api && npm test -- --grep '{endpoint}' OR curl http://localhost:8787{route}` | response shape matches interface_contract |
| db | yes | wrangler_d1_select_assert_row | `cd api && npx wrangler d1 execute {db} --local --command "{select_sql}"` | if endpoint has db_effects, SELECT confirms write |
| job | no | - | `-` | - |
| outbound | no | - | `-` | - |

### Acceptance Tests
- `acceptance-tests/T6-syntactic.sh`

## Story T7: Add or verify POST /api/admin/categories with multi-vertical allocation writing category_verticals rows
- Category: api
- Target Files: api/src/admin/api.ts, api/src/admin/data.ts, api/test/category-multi-vertical.test.ts
- AC ids: T7.AC1, T7.AC2
- RC ids: RC-018, RC-019, RC-048

### Field Contracts (canonical → wire)
| canonical_name | wire_name | field_class | source |
|---|---|---|---|
| site_id | site_id | db_column | SP-PROBE-3 |
| vertical_ids | vertical_ids | request_field | SP-USER-1 |

### Interface Endpoints
- POST /api/admin/sites — request_fields: [name, domain, vertical_id, activity_id]
  response_fields: [site_id]
- POST /api/admin/sites/:id/provision/next — request_fields: [site_id]
  response_fields: [site_creation_job_id]
- PATCH /api/admin/articles/:id — request_fields: [site_id, slug]
  response_fields: [tenant_violation]
- POST /api/admin/categories — request_fields: [site_id, vertical_ids]
  response_fields: [site_id]
- PATCH /api/admin/settings — request_fields: [site_id]
  response_fields: [settings_version]
- GET /api/admin/articles — request_fields: [site_id]
- GET /api/admin/media — request_fields: [site_id]
- GET /api/admin/tags — request_fields: [site_id]

### Test Bindings (post-implementation deterministic checks)
- T7.AC1 (test_file) — file: `api/test/category-multi-vertical.test.ts` (exists at base: yes)
- T7.AC2 (test_name_regex) — name regex: `POST /api/admin/categories writes category_verticals rows`

### Evidence Routes After Implementation
Per-story actionable: RC-018, RC-019. Deferred to ship: RC-048. Skip diagnostic: none.

After committing this story, run via canonical runner:
```
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/a2z-develop/scripts/run_required_evidence_command.py --change-id=kodigital-homepages-cms-phase3-perfect-recovery-2026-05-15 --required-claim-ids=RC-018,RC-019 --evidence-plan=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-homepages-cms-phase3-perfect-recovery-2026-05-15/required_evidence_plan.json --workspace-root=/Users/guyhaikov/a2z-workspaces --project-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms --worktree-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms
```

### Q1 Context Packet
- **requirement_ids:** R-FROM-T1, R-FROM-T2, R-FROM-T3, R-FROM-T4, R-FROM-T5, R-FROM-T6, R-FROM-T7, R-FROM-T8, R-FROM-T9, R-FROM-T10, R-FROM-T11, R-FROM-T12, R-FROM-T13, R-FROM-T14, R-FROM-T15, R-FROM-T16
- **source_context_ids:** SCTX-001, SCTX-002, SCTX-006, SCTX-016
- **goal_classes:** api, db_proof
- **must_use_files:**
  - `SCTX-001` — endpoint body the story modifies
  - `SCTX-002` — required context for archetype interface_contract_endpoint
  - `SCTX-006` — endpoint body the story modifies
  - `SCTX-016` — API handler that receives the POST
- **must_not_do:**
  - do not weaken acceptance criteria to make tests pass
- **definition_of_done:**
  - Endpoint round-trip + SELECT confirms write
- **negative_fail_conditions (HARD FAIL):**
  - endpoint returns 2xx but DB row is absent on SELECT

### Q1 Story Quality Checks (REQUIRED)
Each check whose `required=true` is a Ralph completion gate. A required check that fails BLOCKS the story — do NOT proceed to commit. Global `npm test` is NOT sufficient unless the packet maps it explicitly. For UI/browser stories, grep-on-TS-source is NEVER sufficient — the browser_check command must run Playwright with a class-set or response-status assertion.

| check | required | kind | command | assertion |
|---|---|---|---|---|
| browser | no | - | `-` | - |
| api | yes | curl_or_vitest_response | `cd api && npm test -- --grep '{endpoint}' OR curl http://localhost:8787{route}` | response shape matches interface_contract |
| db | yes | wrangler_d1_select_assert_row | `cd api && npx wrangler d1 execute {db} --local --command "{select_sql}"` | if endpoint has db_effects, SELECT confirms write |
| job | no | - | `-` | - |
| outbound | no | - | `-` | - |

### Acceptance Tests
- `acceptance-tests/T7-syntactic.sh`

## Story T8: Verify PATCH /api/admin/settings bumps site_settings.settings_version and is strictly site-scoped (no global update)
- Category: api
- Target Files: api/src/admin/sites-handlers.ts, api/test/admin-settings.test.ts
- AC ids: T8.AC1
- RC ids: RC-020, RC-049

### Field Contracts (canonical → wire)
| canonical_name | wire_name | field_class | source |
|---|---|---|---|
| settings_version | settings_version | db_column | SP-PROBE-3 |
| site_id | site_id | db_column | SP-PROBE-3 |

### Interface Endpoints
- POST /api/admin/sites — request_fields: [name, domain, vertical_id, activity_id]
  response_fields: [site_id]
- POST /api/admin/sites/:id/provision/next — request_fields: [site_id]
  response_fields: [site_creation_job_id]
- PATCH /api/admin/articles/:id — request_fields: [site_id, slug]
  response_fields: [tenant_violation]
- POST /api/admin/categories — request_fields: [site_id, vertical_ids]
  response_fields: [site_id]
- PATCH /api/admin/settings — request_fields: [site_id]
  response_fields: [settings_version]
- GET /api/admin/articles — request_fields: [site_id]
- GET /api/admin/media — request_fields: [site_id]
- GET /api/admin/tags — request_fields: [site_id]

### Test Bindings (post-implementation deterministic checks)
- T8.AC1 (test_name_regex) — name regex: `PATCH /api/admin/settings increments settings_version`

### Evidence Routes After Implementation
Per-story actionable: RC-020. Deferred to ship: RC-049. Skip diagnostic: none.

After committing this story, run via canonical runner:
```
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/a2z-develop/scripts/run_required_evidence_command.py --change-id=kodigital-homepages-cms-phase3-perfect-recovery-2026-05-15 --required-claim-ids=RC-020 --evidence-plan=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-homepages-cms-phase3-perfect-recovery-2026-05-15/required_evidence_plan.json --workspace-root=/Users/guyhaikov/a2z-workspaces --project-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms --worktree-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms
```

### Q1 Context Packet
- **requirement_ids:** R-FROM-T1, R-FROM-T2, R-FROM-T3, R-FROM-T4, R-FROM-T5, R-FROM-T6, R-FROM-T7, R-FROM-T8, R-FROM-T9, R-FROM-T10, R-FROM-T11, R-FROM-T12, R-FROM-T13, R-FROM-T14, R-FROM-T15, R-FROM-T16
- **source_context_ids:** SCTX-020
- **goal_classes:** api, db_proof
- **must_use_files:**
  - `SCTX-020` — required context for archetype request_field
- **must_not_do:**
  - do not weaken acceptance criteria to make tests pass
- **definition_of_done:**
  - Endpoint round-trip + SELECT confirms write
- **negative_fail_conditions (HARD FAIL):**
  - endpoint returns 2xx but DB row is absent on SELECT

### Q1 Story Quality Checks (REQUIRED)
Each check whose `required=true` is a Ralph completion gate. A required check that fails BLOCKS the story — do NOT proceed to commit. Global `npm test` is NOT sufficient unless the packet maps it explicitly. For UI/browser stories, grep-on-TS-source is NEVER sufficient — the browser_check command must run Playwright with a class-set or response-status assertion.

| check | required | kind | command | assertion |
|---|---|---|---|---|
| browser | no | - | `-` | - |
| api | yes | curl_or_vitest_response | `cd api && npm test -- --grep '{endpoint}' OR curl http://localhost:8787{route}` | response shape matches interface_contract |
| db | yes | wrangler_d1_select_assert_row | `cd api && npx wrangler d1 execute {db} --local --command "{select_sql}"` | if endpoint has db_effects, SELECT confirms write |
| job | no | - | `-` | - |
| outbound | no | - | `-` | - |

### Acceptance Tests
- `acceptance-tests/T8-syntactic.sh`

## Story T9: Verify R2 binding MEDIA in wrangler.toml + add 1 dry-run test for site-scoped Media filter (R2 actual upload = production_pending)
- Category: config
- Target Files: api/wrangler.toml, api/src/admin/data.ts, api/test/media-filter.test.ts
- AC ids: T9.AC1, T9.AC2, T9.AC3
- RC ids: RC-021, RC-022, RC-023

### Field Contracts (canonical → wire)
| canonical_name | wire_name | field_class | source |
|---|---|---|---|
| MEDIA | MEDIA | env_var | SP-USER-1 |
| site_id | site_id | db_column | SP-PROBE-3 |

### Interface Endpoints
- POST /api/admin/sites — request_fields: [name, domain, vertical_id, activity_id]
  response_fields: [site_id]
- POST /api/admin/sites/:id/provision/next — request_fields: [site_id]
  response_fields: [site_creation_job_id]
- PATCH /api/admin/articles/:id — request_fields: [site_id, slug]
  response_fields: [tenant_violation]
- POST /api/admin/categories — request_fields: [site_id, vertical_ids]
  response_fields: [site_id]
- PATCH /api/admin/settings — request_fields: [site_id]
  response_fields: [settings_version]
- GET /api/admin/articles — request_fields: [site_id]
- GET /api/admin/media — request_fields: [site_id]
- GET /api/admin/tags — request_fields: [site_id]

### Test Bindings (post-implementation deterministic checks)
- T9.AC1 (command) — `cd api && grep -n 'binding = "MEDIA"' wrangler.toml` (expects {'min_lines': 1}, parser parse_grep_count, fields: MEDIA)
- T9.AC2 (test_name_regex) — name regex: `media filter returns site-scoped and global media`
- T9.AC3 (deferred_production_pending) — deferred to ship

### Evidence Routes After Implementation
Per-story actionable: RC-021, RC-022. Deferred to ship: RC-023. Skip diagnostic: none.

After committing this story, run via canonical runner:
```
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/a2z-develop/scripts/run_required_evidence_command.py --change-id=kodigital-homepages-cms-phase3-perfect-recovery-2026-05-15 --required-claim-ids=RC-021,RC-022 --evidence-plan=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-homepages-cms-phase3-perfect-recovery-2026-05-15/required_evidence_plan.json --workspace-root=/Users/guyhaikov/a2z-workspaces --project-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms --worktree-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms
```

### Q1 Context Packet
- **requirement_ids:** R-FROM-T1, R-FROM-T2, R-FROM-T3, R-FROM-T4, R-FROM-T5, R-FROM-T6, R-FROM-T7, R-FROM-T8, R-FROM-T9, R-FROM-T10, R-FROM-T11, R-FROM-T12, R-FROM-T13, R-FROM-T14, R-FROM-T15, R-FROM-T16
- **source_context_ids:** SCTX-004
- **goal_classes:** cf_dry_run
- **must_use_files:**
  - `SCTX-004` — required context for archetype dry_run_flag
- **must_not_do:**
  - do not emit any outbound fetch to api.cloudflare.com under dry-run
- **definition_of_done:**
  - Fetch-mock harness records 0 outbound fetches in dry-run mode
- **negative_fail_conditions (HARD FAIL):**
  - dry-run mode emits any outbound HTTP to api.cloudflare.com

### Q1 Story Quality Checks (REQUIRED)
Each check whose `required=true` is a Ralph completion gate. A required check that fails BLOCKS the story — do NOT proceed to commit. Global `npm test` is NOT sufficient unless the packet maps it explicitly. For UI/browser stories, grep-on-TS-source is NEVER sufficient — the browser_check command must run Playwright with a class-set or response-status assertion.

| check | required | kind | command | assertion |
|---|---|---|---|---|
| browser | no | - | `-` | - |
| api | yes | trigger_provisioner | `curl -X POST http://localhost:8787{route}` | provisioner invoked |
| db | no | - | `-` | - |
| job | no | - | `-` | - |
| outbound | yes | fetch_mock_observation_zero_outbound | `cd api && npm test -- --grep 'dry-run'` | 0 fetches to api.cloudflare.com |

### Acceptance Tests
- `acceptance-tests/T9-syntactic.sh`

## Story T10: Verify WARN-FIX-4 site_id->site field-name migration in tags + media template select inputs and site-aware filters operate
- Category: ui
- Target Files: api/src/admin/templates/tags.ts, api/src/admin/templates/media.ts, api/test/tags-media-filter.test.ts
- AC ids: T10.AC1, T10.AC2
- RC ids: RC-024, RC-025

### Field Contracts (canonical → wire)
| canonical_name | wire_name | field_class | source |
|---|---|---|---|
| site_id | site_id | db_column | SP-PROBE-3 |

### Interface Endpoints
- POST /api/admin/sites — request_fields: [name, domain, vertical_id, activity_id]
  response_fields: [site_id]
- POST /api/admin/sites/:id/provision/next — request_fields: [site_id]
  response_fields: [site_creation_job_id]
- PATCH /api/admin/articles/:id — request_fields: [site_id, slug]
  response_fields: [tenant_violation]
- POST /api/admin/categories — request_fields: [site_id, vertical_ids]
  response_fields: [site_id]
- PATCH /api/admin/settings — request_fields: [site_id]
  response_fields: [settings_version]
- GET /api/admin/articles — request_fields: [site_id]
- GET /api/admin/media — request_fields: [site_id]
- GET /api/admin/tags — request_fields: [site_id]

### Test Bindings (post-implementation deterministic checks)
- T10.AC1 (command) — `cd api && grep -n 'name="site_id"' src/admin/templates/tags.ts` (expects {'min_lines': 1}, parser parse_grep_count, fields: site_id)
- T10.AC2 (test_name_regex) — name regex: `tags filter applies site_id filter to query`

### Evidence Routes After Implementation
Per-story actionable: RC-024, RC-025. Deferred to ship: none. Skip diagnostic: none.

After committing this story, run via canonical runner:
```
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/a2z-develop/scripts/run_required_evidence_command.py --change-id=kodigital-homepages-cms-phase3-perfect-recovery-2026-05-15 --required-claim-ids=RC-024,RC-025 --evidence-plan=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-homepages-cms-phase3-perfect-recovery-2026-05-15/required_evidence_plan.json --workspace-root=/Users/guyhaikov/a2z-workspaces --project-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms --worktree-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms
```

### Q1 Context Packet
- **requirement_ids:** R-FROM-T1, R-FROM-T2, R-FROM-T3, R-FROM-T4, R-FROM-T5, R-FROM-T6, R-FROM-T7, R-FROM-T8, R-FROM-T9, R-FROM-T10, R-FROM-T11, R-FROM-T12, R-FROM-T13, R-FROM-T14, R-FROM-T15, R-FROM-T16
- **source_context_ids:** SCTX-015
- **goal_classes:** ui_browser_interaction
- **must_use_files:**
  - `SCTX-015` — form HTML the modal renders
- **must_not_do:**
  - do not let interactive controls close without firing the declared POST
  - do not use page.waitForRequest as proof without asserting response.status()
- **definition_of_done:**
  - Playwright spec asserts both page.waitForRequest AND response.status() in {200,201}
  - created row exists in the target DB table on SELECT
- **negative_fail_conditions (HARD FAIL):**
  - modal click closes without firing the expected POST
  - Playwright test asserts request fired but does not assert response.status() == 2xx

### Q1 Story Quality Checks (REQUIRED)
Each check whose `required=true` is a Ralph completion gate. A required check that fails BLOCKS the story — do NOT proceed to commit. Global `npm test` is NOT sufficient unless the packet maps it explicitly. For UI/browser stories, grep-on-TS-source is NEVER sufficient — the browser_check command must run Playwright with a class-set or response-status assertion.

| check | required | kind | command | assertion |
|---|---|---|---|---|
| browser | yes | playwright_with_network_capture | `cd api && npx playwright test {spec_path} --reporter=json` | page.waitForRequest({method, url}) AND response.status() in {2xx_range} |
| api | yes | curl_response_shape | `curl -X {method} http://localhost:8787{route} -H 'Content-Type: application/j...` | status 2xx + body shape matches interface_contract |
| db | yes | wrangler_d1_select_assert_row | `cd api && npx wrangler d1 execute {db} --local --command "{select_sql}"` | row count == 1 AND key columns match POST input |
| job | yes | poll_until_terminal | `for i in $(seq 1 20); do curl -s {status_url}; sleep 1; done` | final status in {succeeded, failed} |
| outbound | no | - | `-` | - |

### Acceptance Tests
- `acceptance-tests/T10-syntactic.sh`

## Story T11: Execute tenant-guards unit + integration tests proving assertTenantBoundary / assertSlugUniquePerSite / validateCategoryForSite / resolvePageScope are path-traced through PATCH /api/admin/articles/:id
- Category: api
- Target Files: api/src/site/tenant-guards.ts, api/src/site/site-context.ts, api/test/tenant-guards.test.ts
- AC ids: T11.AC1, T11.AC2
- RC ids: RC-026, RC-027, RC-051

### Field Contracts (canonical → wire)
| canonical_name | wire_name | field_class | source |
|---|---|---|---|
| site_id | site_id | db_column | SP-PROBE-3 |
| slug | slug | db_column | SP-PROBE-3 |
| tenant_violation | tenant_violation | response_field | SP-PROBE-2 |

### Interface Endpoints
- POST /api/admin/sites — request_fields: [name, domain, vertical_id, activity_id]
  response_fields: [site_id]
- POST /api/admin/sites/:id/provision/next — request_fields: [site_id]
  response_fields: [site_creation_job_id]
- PATCH /api/admin/articles/:id — request_fields: [site_id, slug]
  response_fields: [tenant_violation]
- POST /api/admin/categories — request_fields: [site_id, vertical_ids]
  response_fields: [site_id]
- PATCH /api/admin/settings — request_fields: [site_id]
  response_fields: [settings_version]
- GET /api/admin/articles — request_fields: [site_id]
- GET /api/admin/media — request_fields: [site_id]
- GET /api/admin/tags — request_fields: [site_id]

### Test Bindings (post-implementation deterministic checks)
- T11.AC1 (test_name_regex) — name regex: `assertTenantBoundary throws when site_id mismatches caller scope`
- T11.AC2 (test_name_regex) — name regex: `assertSlugUniquePerSite returns 409 on duplicate slug within site`

### Evidence Routes After Implementation
Per-story actionable: RC-026, RC-027. Deferred to ship: RC-051. Skip diagnostic: none.

After committing this story, run via canonical runner:
```
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/a2z-develop/scripts/run_required_evidence_command.py --change-id=kodigital-homepages-cms-phase3-perfect-recovery-2026-05-15 --required-claim-ids=RC-026,RC-027 --evidence-plan=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-homepages-cms-phase3-perfect-recovery-2026-05-15/required_evidence_plan.json --workspace-root=/Users/guyhaikov/a2z-workspaces --project-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms --worktree-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms
```

### Q1 Context Packet
- **requirement_ids:** R-FROM-T1, R-FROM-T2, R-FROM-T3, R-FROM-T4, R-FROM-T5, R-FROM-T6, R-FROM-T7, R-FROM-T8, R-FROM-T9, R-FROM-T10, R-FROM-T11, R-FROM-T12, R-FROM-T13, R-FROM-T14, R-FROM-T15, R-FROM-T16
- **source_context_ids:** SCTX-008
- **goal_classes:** api, db_proof
- **must_use_files:**
  - `SCTX-008` — required context for archetype tenant_guard
- **must_not_do:**
  - do not weaken acceptance criteria to make tests pass
- **definition_of_done:**
  - Endpoint round-trip + SELECT confirms write
- **negative_fail_conditions (HARD FAIL):**
  - endpoint returns 2xx but DB row is absent on SELECT

### Q1 Story Quality Checks (REQUIRED)
Each check whose `required=true` is a Ralph completion gate. A required check that fails BLOCKS the story — do NOT proceed to commit. Global `npm test` is NOT sufficient unless the packet maps it explicitly. For UI/browser stories, grep-on-TS-source is NEVER sufficient — the browser_check command must run Playwright with a class-set or response-status assertion.

| check | required | kind | command | assertion |
|---|---|---|---|---|
| browser | no | - | `-` | - |
| api | yes | curl_or_vitest_response | `cd api && npm test -- --grep '{endpoint}' OR curl http://localhost:8787{route}` | response shape matches interface_contract |
| db | yes | wrangler_d1_select_assert_row | `cd api && npx wrangler d1 execute {db} --local --command "{select_sql}"` | if endpoint has db_effects, SELECT confirms write |
| job | no | - | `-` | - |
| outbound | no | - | `-` | - |

### Acceptance Tests
- `acceptance-tests/T11-syntactic.sh`

## Story T12: Add fetch interceptor test proving zero outbound api.cloudflare.com requests during dry-run provisioning + cache_purge_log dry-run row written
- Category: script
- Target Files: api/src/site-provisioning/cloudflare-interfaces.ts, api/test/provisioning-no-outbound.test.ts
- AC ids: T12.AC1, T12.AC2
- RC ids: RC-028, RC-029, RC-050

### Field Contracts (canonical → wire)
| canonical_name | wire_name | field_class | source |
|---|---|---|---|
| SITE_PROVISIONING_DRY_RUN | SITE_PROVISIONING_DRY_RUN | env_var | SP-USER-1 |

### Test Bindings (post-implementation deterministic checks)
- T12.AC1 (test_name_regex) — name regex: `provisioning runner does not call api.cloudflare.com when SITE_PROVISIONING_DRY_RUN=true`
- T12.AC2 (command) — `cd api && wrangler d1 execute kodigital-cms-local --local --json --command "SELECT COUNT(*) AS c FROM cache_purge_log WHERE dry_run = 1;"` (expects {'jsonpath': '$.results[0].c', 'comparator': '>=', 'value': 1}, parser parse_db_query, fields: SITE_PROVISIONING_DRY_RUN)

### Evidence Routes After Implementation
Per-story actionable: RC-028. Deferred to ship: RC-029, RC-050. Skip diagnostic: none.

After committing this story, run via canonical runner:
```
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/a2z-develop/scripts/run_required_evidence_command.py --change-id=kodigital-homepages-cms-phase3-perfect-recovery-2026-05-15 --required-claim-ids=RC-028 --evidence-plan=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-homepages-cms-phase3-perfect-recovery-2026-05-15/required_evidence_plan.json --workspace-root=/Users/guyhaikov/a2z-workspaces --project-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms --worktree-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms
```

### Q1 Context Packet
- **requirement_ids:** R-FROM-T1, R-FROM-T2, R-FROM-T3, R-FROM-T4, R-FROM-T5, R-FROM-T6, R-FROM-T7, R-FROM-T8, R-FROM-T9, R-FROM-T10, R-FROM-T11, R-FROM-T12, R-FROM-T13, R-FROM-T14, R-FROM-T15, R-FROM-T16
- **goal_classes:** cf_dry_run
- **must_not_do:**
  - do not emit any outbound fetch to api.cloudflare.com under dry-run
- **definition_of_done:**
  - Fetch-mock harness records 0 outbound fetches in dry-run mode
- **negative_fail_conditions (HARD FAIL):**
  - dry-run mode emits any outbound HTTP to api.cloudflare.com

### Q1 Story Quality Checks (REQUIRED)
Each check whose `required=true` is a Ralph completion gate. A required check that fails BLOCKS the story — do NOT proceed to commit. Global `npm test` is NOT sufficient unless the packet maps it explicitly. For UI/browser stories, grep-on-TS-source is NEVER sufficient — the browser_check command must run Playwright with a class-set or response-status assertion.

| check | required | kind | command | assertion |
|---|---|---|---|---|
| browser | no | - | `-` | - |
| api | yes | trigger_provisioner | `curl -X POST http://localhost:8787{route}` | provisioner invoked |
| db | no | - | `-` | - |
| job | no | - | `-` | - |
| outbound | yes | fetch_mock_observation_zero_outbound | `cd api && npm test -- --grep 'dry-run'` | 0 fetches to api.cloudflare.com |

### Acceptance Tests
- `acceptance-tests/T12-syntactic.sh`

## Story T13: Execute admin-routing-security spec against local server + Host header asserting off-admin-host /admin returns 404 + no-store + noindex/nofollow + no leak
- Category: infra
- Target Files: api/src/admin/router.ts, api/test-ui/admin-routing-security.spec.ts
- AC ids: T13.AC1, T13.AC2
- RC ids: RC-030, RC-031

### Field Contracts (canonical → wire)
| canonical_name | wire_name | field_class | source |
|---|---|---|---|
| ADMIN_HOST | ADMIN_HOST | env_var | SP-DOCS-3 |
| Cache_Control | Cache-Control | response_field | SP-DOCS-3 |
| X_Robots_Tag | X-Robots-Tag | response_field | SP-DOCS-3 |

  RED LINE: in HTTP/redirect/cookie contexts use `Cache-Control` (NOT `Cache_Control`).

  RED LINE: in HTTP/redirect/cookie contexts use `X-Robots-Tag` (NOT `X_Robots_Tag`).

### Interface Endpoints
- GET /admin — request_fields: [-]
  response_fields: [X_Robots_Tag, Cache_Control]

### Test Bindings (post-implementation deterministic checks)
- T13.AC1 (test_file) — file: `api/test-ui/admin-routing-security.spec.ts` (exists at base: yes)
- T13.AC2 (command) — `curl -sS -o /dev/null -w '%{http_code} %{header_cache-control} %{header_x-robots-tag}\n' -H 'Host: demo-acme.example' http://127.0.0.1:8787/admin` (expects {'status_code': 404, 'headers': {'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow'}, 'body_must_not_contain': 'cms.kodigital.app'}, parser parse_curl_response, fields: X_Robots_Tag,Cache_Control,ADMIN_HOST)

### Evidence Routes After Implementation
Per-story actionable: RC-030, RC-031. Deferred to ship: none. Skip diagnostic: none.

After committing this story, run via canonical runner:
```
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/a2z-develop/scripts/run_required_evidence_command.py --change-id=kodigital-homepages-cms-phase3-perfect-recovery-2026-05-15 --required-claim-ids=RC-030,RC-031 --evidence-plan=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-homepages-cms-phase3-perfect-recovery-2026-05-15/required_evidence_plan.json --workspace-root=/Users/guyhaikov/a2z-workspaces --project-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms --worktree-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms
```

### Q1 Context Packet
- **requirement_ids:** R-FROM-T1, R-FROM-T2, R-FROM-T3, R-FROM-T4, R-FROM-T5, R-FROM-T6, R-FROM-T7, R-FROM-T8, R-FROM-T9, R-FROM-T10, R-FROM-T11, R-FROM-T12, R-FROM-T13, R-FROM-T14, R-FROM-T15, R-FROM-T16
- **goal_classes:** api
- **must_not_do:**
  - do not weaken acceptance criteria to make tests pass
- **negative_fail_conditions (HARD FAIL):**
  - acceptance criteria pass while user-facing outcome is broken

### Q1 Story Quality Checks (REQUIRED)
Each check whose `required=true` is a Ralph completion gate. A required check that fails BLOCKS the story — do NOT proceed to commit. Global `npm test` is NOT sufficient unless the packet maps it explicitly. For UI/browser stories, grep-on-TS-source is NEVER sufficient — the browser_check command must run Playwright with a class-set or response-status assertion.

| check | required | kind | command | assertion |
|---|---|---|---|---|
| browser | no | - | `-` | - |
| api | yes | curl_or_vitest_response | `cd api && npm test -- --grep '{endpoint}' OR curl http://localhost:8787{route}` | response shape matches interface_contract |
| db | yes | wrangler_d1_select_assert_row | `cd api && npx wrangler d1 execute {db} --local --command "{select_sql}"` | if endpoint has db_effects, SELECT confirms write |
| job | no | - | `-` | - |
| outbound | no | - | `-` | - |

### Acceptance Tests
- `acceptance-tests/T13-syntactic.sh`

## Story T14: Run no-legacy-prod-refs + verify:infra + verify:worker-config and assert all exit 0
- Category: config
- Target Files: api/package.json, api/wrangler.toml, api/scripts/
- AC ids: T14.AC1, T14.AC2, T14.AC3
- RC ids: RC-032, RC-033, RC-034

### Test Bindings (post-implementation deterministic checks)
- T14.AC1 (command) — `cd api && npm run verify:no-legacy-prod-refs` (expects exit_code=0, parser test_exit_code, fields: )
- T14.AC2 (command) — `cd api && npm run verify:infra` (expects exit_code=0, parser test_exit_code, fields: )
- T14.AC3 (command) — `cd api && npm run verify:worker-config` (expects exit_code=0, parser test_exit_code, fields: )

### Evidence Routes After Implementation
Per-story actionable: RC-032, RC-033, RC-034. Deferred to ship: none. Skip diagnostic: none.

After committing this story, run via canonical runner:
```
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/a2z-develop/scripts/run_required_evidence_command.py --change-id=kodigital-homepages-cms-phase3-perfect-recovery-2026-05-15 --required-claim-ids=RC-032,RC-033,RC-034 --evidence-plan=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-homepages-cms-phase3-perfect-recovery-2026-05-15/required_evidence_plan.json --workspace-root=/Users/guyhaikov/a2z-workspaces --project-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms --worktree-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms
```

### Q1 Context Packet
- **requirement_ids:** R-FROM-T1, R-FROM-T2, R-FROM-T3, R-FROM-T4, R-FROM-T5, R-FROM-T6, R-FROM-T7, R-FROM-T8, R-FROM-T9, R-FROM-T10, R-FROM-T11, R-FROM-T12, R-FROM-T13, R-FROM-T14, R-FROM-T15, R-FROM-T16
- **source_context_ids:** SCTX-004
- **goal_classes:** api
- **must_use_files:**
  - `SCTX-004` — required context for archetype dry_run_flag
- **must_not_do:**
  - do not weaken acceptance criteria to make tests pass
- **negative_fail_conditions (HARD FAIL):**
  - acceptance criteria pass while user-facing outcome is broken

### Q1 Story Quality Checks (REQUIRED)
Each check whose `required=true` is a Ralph completion gate. A required check that fails BLOCKS the story — do NOT proceed to commit. Global `npm test` is NOT sufficient unless the packet maps it explicitly. For UI/browser stories, grep-on-TS-source is NEVER sufficient — the browser_check command must run Playwright with a class-set or response-status assertion.

| check | required | kind | command | assertion |
|---|---|---|---|---|
| browser | no | - | `-` | - |
| api | yes | curl_or_vitest_response | `cd api && npm test -- --grep '{endpoint}' OR curl http://localhost:8787{route}` | response shape matches interface_contract |
| db | yes | wrangler_d1_select_assert_row | `cd api && npx wrangler d1 execute {db} --local --command "{select_sql}"` | if endpoint has db_effects, SELECT confirms write |
| job | no | - | `-` | - |
| outbound | no | - | `-` | - |

### Acceptance Tests
- `acceptance-tests/T14-syntactic.sh`

## Story T15: Execute FULL Playwright suite (admin-ux-parity, domains-create-site, admin-routing-security) against local Worker and produce api/test-results/ with HTML report
- Category: ui
- Target Files: api/test-ui/admin-ux-parity.spec.ts, api/test-ui/domains-create-site.spec.ts, api/test-ui/admin-routing-security.spec.ts, api/playwright.config.ts, api/test-results/index.html
- AC ids: T15.AC1, T15.AC2, T15.AC3
- RC ids: RC-035, RC-036, RC-037

### Field Contracts (canonical → wire)
| canonical_name | wire_name | field_class | source |
|---|---|---|---|
| admin_layout | admin-layout | ui_label | SP-DESIGN-1 |
| admin_sidebar | admin-sidebar | ui_label | SP-DESIGN-1 |
| kodigital_brand | kodigital_brand | ui_label | SP-USER-1 |
| sidebar_nav | sidebar-nav | ui_label | SP-DESIGN-1 |

  RED LINE: in HTTP/redirect/cookie contexts use `admin-layout` (NOT `admin_layout`).

  RED LINE: in HTTP/redirect/cookie contexts use `admin-sidebar` (NOT `admin_sidebar`).

  RED LINE: in HTTP/redirect/cookie contexts use `sidebar-nav` (NOT `sidebar_nav`).

### Design slice (story-linked content_blocks)
- admin_layout_wrapper (hero): Legacy admin-layout wrapper with admin-sidebar + admin-main + admin-header + adm
- sidebar_nav_full (cta): 9-entry nav rendered in every admin route: Dashboard, Domains, Articles, Pages, 
- domains_table (hero): Domains tab table columns: domain, site, vertical, activity, status, articles, c

### Test Bindings (post-implementation deterministic checks)
- T15.AC1 (test_file) — file: `api/test-ui/admin-ux-parity.spec.ts` (exists at base: yes)
- T15.AC2 (command) — `cd api && npx playwright test --reporter=html` (expects exit_code=0, parser parse_playwright_trace, fields: admin_layout,kodigital_brand)
- T15.AC3 (command) — `ls api/test-results/index.html` (expects exit_code=0, parser test_exit_code, fields: )

### Evidence Routes After Implementation
Per-story actionable: RC-035, RC-037. Deferred to ship: RC-036. Skip diagnostic: none.

After committing this story, run via canonical runner:
```
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/a2z-develop/scripts/run_required_evidence_command.py --change-id=kodigital-homepages-cms-phase3-perfect-recovery-2026-05-15 --required-claim-ids=RC-035,RC-037 --evidence-plan=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-homepages-cms-phase3-perfect-recovery-2026-05-15/required_evidence_plan.json --workspace-root=/Users/guyhaikov/a2z-workspaces --project-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms --worktree-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms
```

### Q1 Context Packet
- **requirement_ids:** R-FROM-T1, R-FROM-T2, R-FROM-T3, R-FROM-T4, R-FROM-T5, R-FROM-T6, R-FROM-T7, R-FROM-T8, R-FROM-T9, R-FROM-T10, R-FROM-T11, R-FROM-T12, R-FROM-T13, R-FROM-T14, R-FROM-T15, R-FROM-T16
- **goal_classes:** api
- **must_not_do:**
  - do not weaken acceptance criteria to make tests pass
- **negative_fail_conditions (HARD FAIL):**
  - acceptance criteria pass while user-facing outcome is broken

### Q1 Story Quality Checks (REQUIRED)
Each check whose `required=true` is a Ralph completion gate. A required check that fails BLOCKS the story — do NOT proceed to commit. Global `npm test` is NOT sufficient unless the packet maps it explicitly. For UI/browser stories, grep-on-TS-source is NEVER sufficient — the browser_check command must run Playwright with a class-set or response-status assertion.

| check | required | kind | command | assertion |
|---|---|---|---|---|
| browser | no | - | `-` | - |
| api | yes | curl_or_vitest_response | `cd api && npm test -- --grep '{endpoint}' OR curl http://localhost:8787{route}` | response shape matches interface_contract |
| db | yes | wrangler_d1_select_assert_row | `cd api && npx wrangler d1 execute {db} --local --command "{select_sql}"` | if endpoint has db_effects, SELECT confirms write |
| job | no | - | `-` | - |
| outbound | no | - | `-` | - |

### Acceptance Tests
- `acceptance-tests/T15-syntactic.sh`

## Story T16: Author the 6 mission-specific Q1-Q4 artifacts (mission_goal_trace, source_context_pack, live_domain_routability, wire_protocol_parity, manualqa_goal_coverage, reviewer_artifact_diff_plan) under openspec/changes/<cid>/quality-gauntlet/
- Category: config
- Target Files: openspec/changes/kodigital-homepages-cms-phase3-perfect-recovery-2026-05-15/quality-gauntlet/mission_goal_trace.json, openspec/changes/kodigital-homepages-cms-phase3-perfect-recovery-2026-05-15/quality-gauntlet/source_context_pack.json, openspec/changes/kodigital-homepages-cms-phase3-perfect-recovery-2026-05-15/quality-gauntlet/live_domain_routability.json, openspec/changes/kodigital-homepages-cms-phase3-perfect-recovery-2026-05-15/quality-gauntlet/wire_protocol_parity.json, openspec/changes/kodigital-homepages-cms-phase3-perfect-recovery-2026-05-15/quality-gauntlet/manualqa_goal_coverage.json, openspec/changes/kodigital-homepages-cms-phase3-perfect-recovery-2026-05-15/quality-gauntlet/reviewer_artifact_diff_plan.json
- AC ids: T16.AC1, T16.AC2, T16.AC3, T16.AC4, T16.AC5, T16.AC6
- RC ids: RC-038, RC-039, RC-040, RC-041, RC-042, RC-043

### Test Bindings (post-implementation deterministic checks)
- T16.AC1 (command) — `test -f openspec/changes/kodigital-homepages-cms-phase3-perfect-recovery-2026-05-15/quality-gauntlet/mission_goal_trace.json` (expects exit_code=0, parser test_exit_code, fields: )
- T16.AC2 (command) — `test -f openspec/changes/kodigital-homepages-cms-phase3-perfect-recovery-2026-05-15/quality-gauntlet/source_context_pack.json` (expects exit_code=0, parser test_exit_code, fields: )
- T16.AC3 (command) — `test -f openspec/changes/kodigital-homepages-cms-phase3-perfect-recovery-2026-05-15/quality-gauntlet/live_domain_routability.json` (expects exit_code=0, parser test_exit_code, fields: )
- T16.AC4 (command) — `test -f openspec/changes/kodigital-homepages-cms-phase3-perfect-recovery-2026-05-15/quality-gauntlet/wire_protocol_parity.json` (expects exit_code=0, parser test_exit_code, fields: )
- T16.AC5 (command) — `test -f openspec/changes/kodigital-homepages-cms-phase3-perfect-recovery-2026-05-15/quality-gauntlet/manualqa_goal_coverage.json` (expects exit_code=0, parser test_exit_code, fields: )
- T16.AC6 (command) — `test -f openspec/changes/kodigital-homepages-cms-phase3-perfect-recovery-2026-05-15/quality-gauntlet/reviewer_artifact_diff_plan.json` (expects exit_code=0, parser test_exit_code, fields: )

### Evidence Routes After Implementation
Per-story actionable: RC-038, RC-039, RC-040, RC-041, RC-042, RC-043. Deferred to ship: none. Skip diagnostic: none.

After committing this story, run via canonical runner:
```
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/a2z-develop/scripts/run_required_evidence_command.py --change-id=kodigital-homepages-cms-phase3-perfect-recovery-2026-05-15 --required-claim-ids=RC-038,RC-039,RC-040,RC-041,RC-042,RC-043 --evidence-plan=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-homepages-cms-phase3-perfect-recovery-2026-05-15/required_evidence_plan.json --workspace-root=/Users/guyhaikov/a2z-workspaces --project-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms --worktree-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms
```

### Q1 Context Packet
- **requirement_ids:** R-FROM-T1, R-FROM-T2, R-FROM-T3, R-FROM-T4, R-FROM-T5, R-FROM-T6, R-FROM-T7, R-FROM-T8, R-FROM-T9, R-FROM-T10, R-FROM-T11, R-FROM-T12, R-FROM-T13, R-FROM-T14, R-FROM-T15, R-FROM-T16
- **goal_classes:** api, ui_browser_interaction, wire_protocol_consistency
- **must_not_do:**
  - do not let interactive controls close without firing the declared POST
  - do not use page.waitForRequest as proof without asserting response.status()
  - do not rename form field name without updating handler read AND DB column
- **definition_of_done:**
  - Playwright spec asserts both page.waitForRequest AND response.status() in {200,201}
  - created row exists in the target DB table on SELECT
  - Form field name == handler-read field name == DB column name (all match)
- **negative_fail_conditions (HARD FAIL):**
  - modal click closes without firing the expected POST
  - Playwright test asserts request fired but does not assert response.status() == 2xx
  - form input name does not equal handler-read field name
  - DB column receives wrong value because of field-name mismatch

### Q1 Story Quality Checks (REQUIRED)
Each check whose `required=true` is a Ralph completion gate. A required check that fails BLOCKS the story — do NOT proceed to commit. Global `npm test` is NOT sufficient unless the packet maps it explicitly. For UI/browser stories, grep-on-TS-source is NEVER sufficient — the browser_check command must run Playwright with a class-set or response-status assertion.

| check | required | kind | command | assertion |
|---|---|---|---|---|
| browser | yes | playwright_with_network_capture | `cd api && npx playwright test {spec_path} --reporter=json` | page.waitForRequest({method, url}) AND response.status() in {2xx_range} |
| api | yes | curl_or_vitest_response | `cd api && npm test -- --grep '{endpoint}' OR curl http://localhost:8787{route}` | response shape matches interface_contract |
| db | yes | wrangler_d1_select_assert_row | `cd api && npx wrangler d1 execute {db} --local --command "{select_sql}"` | if endpoint has db_effects, SELECT confirms write |
| job | yes | poll_until_terminal | `for i in $(seq 1 20); do curl -s {status_url}; sleep 1; done` | final status in {succeeded, failed} |
| outbound | no | - | `-` | - |

### Acceptance Tests
- `acceptance-tests/T16-syntactic.sh`

