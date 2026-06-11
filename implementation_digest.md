# Implementation Digest — change kodigital-cms-rescue-2-2026-06-10

Mode: field_sensitive_with_ui  |  Profiles: api_contract, db_schema, evidence_route_strict, field_sensitive, ui_operator  |  Mission-global RCs: 1

## RED LINE — typed contract authority
The fields, wire names, endpoint paths, and design specs below are AUTHORITATIVE. Implement EXACTLY as specified. Field names in HTTP request bodies / redirect URLs / cookies are the WIRE name (right column), NOT the canonical name. Do not invent field names; do not paraphrase typed contracts.

## Mission-global required claims
- RC-001 (behavioral, test_receipt, action=RUN)

Run once after final story commit:
```
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/a2z-develop/scripts/run_required_evidence_command.py --change-id=kodigital-cms-rescue-2-2026-06-10 --required-claim-ids=RC-001 --evidence-plan=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-cms-rescue-2-2026-06-10/required_evidence_plan.json --workspace-root=/Users/guyhaikov/a2z-workspaces --project-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms --worktree-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-cms-rescue-2-2026-06-10/worktree
```

## Story T1: [A1] Scanner allowlist for mission docs
- Category: script
- Target Files: api/scripts/verify/assert-no-legacy-prod-refs.ts
- AC ids: T1.AC1, T1.AC2, T1.AC3
- RC ids: RC-002, RC-003, RC-004

### Test Bindings (post-implementation deterministic checks)
- T1.AC2 (test_file) — file: `api/test/verify-script.test.ts` (exists at base: yes)

### Evidence Routes After Implementation
Per-story actionable: RC-002, RC-003, RC-004. Deferred to ship: none. Skip diagnostic: none.

After committing this story, run via canonical runner:
```
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/a2z-develop/scripts/run_required_evidence_command.py --change-id=kodigital-cms-rescue-2-2026-06-10 --required-claim-ids=RC-002,RC-003,RC-004 --evidence-plan=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-cms-rescue-2-2026-06-10/required_evidence_plan.json --workspace-root=/Users/guyhaikov/a2z-workspaces --project-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms --worktree-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-cms-rescue-2-2026-06-10/worktree
```

### Q1 Context Packet
- **requirement_ids:** R-FROM-T1
- **source_context_ids:** SCTX-015, SCTX-031
- **goal_classes:** structural_script
- **must_use_files:**
  - `SCTX-015` — required context for archetype fetch_mock
  - `SCTX-031` — required context for archetype verify_script
- **must_not_do:**
  - do not weaken acceptance criteria to make tests pass
- **definition_of_done:**
  - allowlist entries for the 5 mission docs present in the scanner (count >= 2)
  - vitest verify-script.test.ts + verify-scripts-green.test.ts + legacy-ref-allowlist.test.ts -> 0 failures
  - npm run verify:no-legacy-prod-refs exits 0
- **negative_fail_conditions (HARD FAIL):**
  - acceptance criteria pass while user-facing outcome is broken

### Q1 Story Quality Checks (REQUIRED)
Each check whose `required=true` is a Ralph completion gate. A required check that fails BLOCKS the story — do NOT proceed to commit. Global `npm test` is NOT sufficient unless the packet maps it explicitly. For UI/browser stories, grep-on-TS-source is NEVER sufficient — the browser_check command must run Playwright with a class-set or response-status assertion.

| check | required | kind | command | assertion |
|---|---|---|---|---|
| browser | no | - | `-` | - |
| api | no | - | `-` | - |
| db | no | - | `-` | - |
| job | no | - | `-` | - |
| outbound | no | - | `-` | - |

### Acceptance Tests
- `acceptance-tests/T1-syntactic.sh`

## Story T2: [A2] deploy.yml migration anchors
- Category: infra
- Target Files: .github/workflows/deploy.yml
- AC ids: T2.AC1, T2.AC2
- RC ids: RC-005, RC-006

### Evidence Routes After Implementation
Per-story actionable: RC-005, RC-006. Deferred to ship: none. Skip diagnostic: none.

After committing this story, run via canonical runner:
```
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/a2z-develop/scripts/run_required_evidence_command.py --change-id=kodigital-cms-rescue-2-2026-06-10 --required-claim-ids=RC-005,RC-006 --evidence-plan=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-cms-rescue-2-2026-06-10/required_evidence_plan.json --workspace-root=/Users/guyhaikov/a2z-workspaces --project-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms --worktree-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-cms-rescue-2-2026-06-10/worktree
```

### Q1 Context Packet
- **requirement_ids:** R-FROM-T2
- **source_context_ids:** SCTX-071
- **goal_classes:** api
- **must_use_files:**
  - `SCTX-071` — required context for archetype ralph_target_scaffold
- **must_not_do:**
  - do not weaken acceptance criteria to make tests pass
- **definition_of_done:**
  - deploy workflow migration tracking names 0009 (count >= 1)
  - deploy workflow migration tracking names 0010 and 0011 (count >= 2)
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
- `acceptance-tests/T2-syntactic.sh`

## Story T3: [A3] Migration 0010 — sites.content_mode
- Category: migration
- Target Files: api/migrations/0010_phase9_sites_content_mode.sql, api/test/migrations-0010-content-mode.test.ts
- AC ids: T3.AC1, T3.AC2
- RC ids: RC-007, RC-008

### Test Bindings (post-implementation deterministic checks)
- T3.AC2 (test_file) — file: `api/test/migrations-0010-content-mode.test.ts` (test file does NOT exist at base — Ralph must CREATE it)

### Evidence Routes After Implementation
Per-story actionable: RC-007, RC-008. Deferred to ship: none. Skip diagnostic: none.

After committing this story, run via canonical runner:
```
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/a2z-develop/scripts/run_required_evidence_command.py --change-id=kodigital-cms-rescue-2-2026-06-10 --required-claim-ids=RC-007,RC-008 --evidence-plan=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-cms-rescue-2-2026-06-10/required_evidence_plan.json --workspace-root=/Users/guyhaikov/a2z-workspaces --project-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms --worktree-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-cms-rescue-2-2026-06-10/worktree
```

### Q1 Context Packet
- **requirement_ids:** R-FROM-T3
- **source_context_ids:** SCTX-020, SCTX-026, SCTX-028, SCTX-032, SCTX-034, SCTX-053, SCTX-069, SCTX-128
- **goal_classes:** schema
- **must_use_files:**
  - `SCTX-020` — required context for archetype db_table
  - `SCTX-026` — required context for archetype db_schema
  - `SCTX-028` — required context for archetype side_effect_table
  - `SCTX-032` — schema source-of-truth for DB columns
  - `SCTX-034` — required context for archetype table_diff
  - `SCTX-053` — required context for archetype db_table
  - `SCTX-069` — required context for archetype db_column
  - `SCTX-128` — required context for archetype ralph_target_scaffold
- **must_not_do:**
  - do not weaken acceptance criteria to make tests pass
- **definition_of_done:**
  - Migrations apply locally and PRAGMA table_info lists declared columns
  - grep -c content_mode api/migrations/0010_phase9_sites_content_mode.sql >= 1
  - vitest migrations-0010-content-mode.test.ts: PRAGMA confirms content_mode column
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
- `acceptance-tests/T3-syntactic.sh`

## Story T4: [A4] Baseline green gate
- Category: script
- AC ids: T4.AC1, T4.AC2, T4.AC3
- RC ids: RC-009, RC-010, RC-011

### Evidence Routes After Implementation
Per-story actionable: RC-009, RC-010, RC-011. Deferred to ship: none. Skip diagnostic: none.

After committing this story, run via canonical runner:
```
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/a2z-develop/scripts/run_required_evidence_command.py --change-id=kodigital-cms-rescue-2-2026-06-10 --required-claim-ids=RC-009,RC-010,RC-011 --evidence-plan=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-cms-rescue-2-2026-06-10/required_evidence_plan.json --workspace-root=/Users/guyhaikov/a2z-workspaces --project-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms --worktree-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-cms-rescue-2-2026-06-10/worktree
```

### Q1 Context Packet
- **requirement_ids:** R-FROM-T4
- **goal_classes:** api
- **must_not_do:**
  - do not weaken acceptance criteria to make tests pass
- **definition_of_done:**
  - tsc --noEmit 0 errors
  - vitest run 0 failures
  - npm run verify:all exit 0
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
- `acceptance-tests/T4-syntactic.sh`

## Story T5: [A5] Decoded design contract
- Category: config
- Target Files: docs/design-contract.md
- AC ids: T5.AC1, T5.AC2, T5.AC3
- RC ids: RC-012, RC-013, RC-014

### Evidence Routes After Implementation
Per-story actionable: RC-012, RC-013, RC-014. Deferred to ship: none. Skip diagnostic: none.

After committing this story, run via canonical runner:
```
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/a2z-develop/scripts/run_required_evidence_command.py --change-id=kodigital-cms-rescue-2-2026-06-10 --required-claim-ids=RC-012,RC-013,RC-014 --evidence-plan=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-cms-rescue-2-2026-06-10/required_evidence_plan.json --workspace-root=/Users/guyhaikov/a2z-workspaces --project-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms --worktree-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-cms-rescue-2-2026-06-10/worktree
```

### Q1 Context Packet
- **requirement_ids:** R-FROM-T5
- **source_context_ids:** SCTX-143
- **goal_classes:** api
- **must_use_files:**
  - `SCTX-143` — required context for archetype ralph_target_scaffold
- **must_not_do:**
  - do not weaken acceptance criteria to make tests pass
- **definition_of_done:**
  - all 5 brand hex values grep >= 1 each in design-contract.md
  - 60px minmax(0, 1fr) 320px = 1; 1.4fr 1fr 1fr >= 1
  - both data-screen-label values + both section-order lists present
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
- `acceptance-tests/T5-syntactic.sh`

## Story T6: [C1] Brand tokens
- Category: ui
- Target Files: api/src/public/assets/public-css.ts
- AC ids: T6.AC1, T6.AC2, T6.AC3
- RC ids: RC-015, RC-016, RC-017

### Test Bindings (post-implementation deterministic checks)
- T6.AC3 (test_file) — file: `api/test/public-templates-components.test.ts` (exists at base: yes)

### Evidence Routes After Implementation
Per-story actionable: RC-015, RC-016, RC-017. Deferred to ship: none. Skip diagnostic: none.

After committing this story, run via canonical runner:
```
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/a2z-develop/scripts/run_required_evidence_command.py --change-id=kodigital-cms-rescue-2-2026-06-10 --required-claim-ids=RC-015,RC-016,RC-017 --evidence-plan=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-cms-rescue-2-2026-06-10/required_evidence_plan.json --workspace-root=/Users/guyhaikov/a2z-workspaces --project-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms --worktree-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-cms-rescue-2-2026-06-10/worktree
```

### Q1 Context Packet
- **requirement_ids:** R-FROM-T6
- **source_context_ids:** SCTX-092
- **goal_classes:** api
- **must_use_files:**
  - `SCTX-092` — required context for archetype ralph_target_scaffold
- **must_not_do:**
  - do not weaken acceptance criteria to make tests pass
- **definition_of_done:**
  - all 5 brand properties set to reference values
  - grep -rc 2563eb api/src/public/ = 0
  - vitest public-templates-components: publicCss contains #1ba8c8
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

## Story T7: [C2] Typography/layout tokens
- Category: ui
- Target Files: api/src/public/assets/public-css.ts
- AC ids: T7.AC1, T7.AC2, T7.AC3
- RC ids: RC-018, RC-019, RC-020

### Evidence Routes After Implementation
Per-story actionable: RC-018, RC-019, RC-020. Deferred to ship: none. Skip diagnostic: none.

After committing this story, run via canonical runner:
```
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/a2z-develop/scripts/run_required_evidence_command.py --change-id=kodigital-cms-rescue-2-2026-06-10 --required-claim-ids=RC-018,RC-019,RC-020 --evidence-plan=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-cms-rescue-2-2026-06-10/required_evidence_plan.json --workspace-root=/Users/guyhaikov/a2z-workspaces --project-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms --worktree-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-cms-rescue-2-2026-06-10/worktree
```

### Q1 Context Packet
- **requirement_ids:** R-FROM-T7
- **source_context_ids:** SCTX-092
- **goal_classes:** api
- **must_use_files:**
  - `SCTX-092` — required context for archetype ralph_target_scaffold
- **must_not_do:**
  - do not weaken acceptance criteria to make tests pass
- **definition_of_done:**
  - Nunito Sans + Nunito present
  - 1.0625rem, 920px, 72px each grep >= 1
  - grep -c "rgba(20,30,50" api/src/public/assets/public-css.ts >= 2
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
- `acceptance-tests/T7-syntactic.sh`

## Story T8: [C3] Contract grids
- Category: ui
- Target Files: api/src/public/assets/public-css.ts, api/src/public/templates/article.ts, api/test/public-templates-article.test.ts
- AC ids: T8.AC1, T8.AC2, T8.AC3
- RC ids: RC-021, RC-022, RC-023

### Test Bindings (post-implementation deterministic checks)
- T8.AC3 (test_file) — file: `api/test/public-templates-article.test.ts` (exists at base: yes)

### Evidence Routes After Implementation
Per-story actionable: RC-021, RC-022, RC-023. Deferred to ship: none. Skip diagnostic: none.

After committing this story, run via canonical runner:
```
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/a2z-develop/scripts/run_required_evidence_command.py --change-id=kodigital-cms-rescue-2-2026-06-10 --required-claim-ids=RC-021,RC-022,RC-023 --evidence-plan=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-cms-rescue-2-2026-06-10/required_evidence_plan.json --workspace-root=/Users/guyhaikov/a2z-workspaces --project-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms --worktree-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-cms-rescue-2-2026-06-10/worktree
```

### Q1 Context Packet
- **requirement_ids:** R-FROM-T8
- **source_context_ids:** SCTX-092, SCTX-098, SCTX-136
- **goal_classes:** api
- **must_use_files:**
  - `SCTX-092` — required context for archetype ralph_target_scaffold
  - `SCTX-098` — required context for archetype ralph_target_scaffold
  - `SCTX-136` — required context for archetype ralph_target_scaffold
- **must_not_do:**
  - do not weaken acceptance criteria to make tests pass
- **definition_of_done:**
  - 60px shell + clamp gap; 64px = 0
  - 1.4fr featured; 2fr = 0
  - vitest article test 0 failures
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
- `acceptance-tests/T8-syntactic.sh`

## Story T9: [C4] Root wrappers data-screen-label
- Category: ui
- Target Files: api/src/public/render-pages.ts, api/test/public-no-theiwise-brand-render.test.ts, api/test/public-screen-labels.test.ts
- AC ids: T9.AC1, T9.AC2, T9.AC3
- RC ids: RC-024, RC-025, RC-026

### Test Bindings (post-implementation deterministic checks)
- T9.AC1 (test_file) — file: `api/test/public-screen-labels.test.ts` (test file does NOT exist at base — Ralph must CREATE it)
- T9.AC3 (test_file) — file: `api/test/public-no-theiwise-brand-render.test.ts` (exists at base: yes)

### Evidence Routes After Implementation
Per-story actionable: RC-024, RC-025, RC-026. Deferred to ship: none. Skip diagnostic: none.

After committing this story, run via canonical runner:
```
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/a2z-develop/scripts/run_required_evidence_command.py --change-id=kodigital-cms-rescue-2-2026-06-10 --required-claim-ids=RC-024,RC-025,RC-026 --evidence-plan=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-cms-rescue-2-2026-06-10/required_evidence_plan.json --workspace-root=/Users/guyhaikov/a2z-workspaces --project-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms --worktree-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-cms-rescue-2-2026-06-10/worktree
```

### Q1 Context Packet
- **requirement_ids:** R-FROM-T9
- **source_context_ids:** SCTX-045, SCTX-061, SCTX-095, SCTX-134, SCTX-135
- **goal_classes:** ui_browser_interaction
- **must_use_files:**
  - `SCTX-045` — form HTML the modal renders
  - `SCTX-061` — required context for archetype form_field
  - `SCTX-095` — required context for archetype ralph_target_scaffold
  - `SCTX-134` — required context for archetype ralph_target_scaffold
  - `SCTX-135` — required context for archetype ralph_target_scaffold
- **must_not_do:**
  - do not let interactive controls close without firing the declared POST
  - do not use page.waitForRequest as proof without asserting response.status()
- **definition_of_done:**
  - Playwright spec asserts both page.waitForRequest AND response.status() in {200,201}
  - created row exists in the target DB table on SELECT
  - vitest: renderHomepageHtml contains theiwise-home; renderArticleHtml contains article-page
  - grep -rc data-screen-label=theiwise-home api/src/public/ >= 1
  - vitest public-no-theiwise-brand-render passes (hostname ban intact)
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
- `acceptance-tests/T9-syntactic.sh`

## Story T10: [C5] Class flattening BEM → spec vocabulary
- Category: ui
- Target Files: api/src/public/templates/components.ts, api/src/public/templates/home.ts, api/src/public/templates/article.ts, api/test/public-templates-components.test.ts
- AC ids: T10.AC1, T10.AC2, T10.AC3
- RC ids: RC-027, RC-028, RC-029

### Test Bindings (post-implementation deterministic checks)
- T10.AC3 (test_file) — file: `api/test/public-templates-components.test.ts` (exists at base: yes)

### Evidence Routes After Implementation
Per-story actionable: RC-027, RC-028, RC-029. Deferred to ship: none. Skip diagnostic: none.

After committing this story, run via canonical runner:
```
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/a2z-develop/scripts/run_required_evidence_command.py --change-id=kodigital-cms-rescue-2-2026-06-10 --required-claim-ids=RC-027,RC-028,RC-029 --evidence-plan=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-cms-rescue-2-2026-06-10/required_evidence_plan.json --workspace-root=/Users/guyhaikov/a2z-workspaces --project-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms --worktree-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-cms-rescue-2-2026-06-10/worktree
```

### Q1 Context Packet
- **requirement_ids:** R-FROM-T10
- **source_context_ids:** SCTX-098, SCTX-099, SCTX-100, SCTX-137
- **goal_classes:** api
- **must_use_files:**
  - `SCTX-098` — required context for archetype ralph_target_scaffold
  - `SCTX-099` — required context for archetype ralph_target_scaffold
  - `SCTX-100` — required context for archetype ralph_target_scaffold
  - `SCTX-137` — required context for archetype ralph_target_scaffold
- **must_not_do:**
  - do not weaken acceptance criteria to make tests pass
- **definition_of_done:**
  - grep -rcE card__|hero__|home-section__ api/src/public/templates/ = 0
  - card-title/card-img/card-foot/hero-content/hero-title each >= 1
  - vitest components test 0 failures
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
- `acceptance-tests/T10-syntactic.sh`

## Story T11: [C6] Home section set + order (13)
- Category: ui
- Target Files: api/src/public/templates/home.ts, api/test/public-templates-home.test.ts
- AC ids: T11.AC1, T11.AC2, T11.AC3
- RC ids: RC-030, RC-031, RC-032

### Test Bindings (post-implementation deterministic checks)
- T11.AC1 (test_file) — file: `api/test/public-templates-home.test.ts` (exists at base: yes)

### Evidence Routes After Implementation
Per-story actionable: RC-030, RC-031, RC-032. Deferred to ship: none. Skip diagnostic: none.

After committing this story, run via canonical runner:
```
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/a2z-develop/scripts/run_required_evidence_command.py --change-id=kodigital-cms-rescue-2-2026-06-10 --required-claim-ids=RC-030,RC-031,RC-032 --evidence-plan=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-cms-rescue-2-2026-06-10/required_evidence_plan.json --workspace-root=/Users/guyhaikov/a2z-workspaces --project-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms --worktree-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-cms-rescue-2-2026-06-10/worktree
```

### Q1 Context Packet
- **requirement_ids:** R-FROM-T11
- **source_context_ids:** SCTX-100, SCTX-138
- **goal_classes:** api
- **must_use_files:**
  - `SCTX-100` — required context for archetype ralph_target_scaffold
  - `SCTX-138` — required context for archetype ralph_target_scaffold
- **must_not_do:**
  - do not weaken acceptance criteria to make tests pass
- **definition_of_done:**
  - vitest: exact 13-section marker sequence
  - about section-marker usages = 0
  - renderFloatingNext called = 1
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
- `acceptance-tests/T11-syntactic.sh`

## Story T12: [C7] Home view-model buckets
- Category: ui
- Target Files: api/src/public/view-models/home.ts, api/test/public-view-models-home.test.ts
- AC ids: T12.AC1, T12.AC2, T12.AC3
- RC ids: RC-033, RC-034, RC-035

### Test Bindings (post-implementation deterministic checks)
- T12.AC2 (test_file) — file: `api/test/public-view-models-home.test.ts` (exists at base: yes)
- T12.AC3 (test_file) — file: `api/test/public-view-models-home.test.ts` (exists at base: yes)

### Evidence Routes After Implementation
Per-story actionable: RC-033, RC-034, RC-035. Deferred to ship: none. Skip diagnostic: none.

After committing this story, run via canonical runner:
```
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/a2z-develop/scripts/run_required_evidence_command.py --change-id=kodigital-cms-rescue-2-2026-06-10 --required-claim-ids=RC-033,RC-034,RC-035 --evidence-plan=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-cms-rescue-2-2026-06-10/required_evidence_plan.json --workspace-root=/Users/guyhaikov/a2z-workspaces --project-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms --worktree-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-cms-rescue-2-2026-06-10/worktree
```

### Q1 Context Packet
- **requirement_ids:** R-FROM-T12
- **source_context_ids:** SCTX-105, SCTX-139
- **goal_classes:** api
- **must_use_files:**
  - `SCTX-105` — required context for archetype ralph_target_scaffold
  - `SCTX-139` — required context for archetype ralph_target_scaffold
- **must_not_do:**
  - do not weaken acceptance criteria to make tests pass
- **definition_of_done:**
  - is_trending grep >= 1; HomeViewModel has trending + picks
  - vitest: is_trending=1 -> vm.trending; no duplication
  - vitest: D1 statement count <= 3
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
- `acceptance-tests/T12-syntactic.sh`

## Story T13: [C8] Article section order (12) + nesting
- Category: ui
- Target Files: api/src/public/templates/article.ts, api/test/public-templates-article.test.ts
- AC ids: T13.AC1, T13.AC2, T13.AC3, T13.AC4
- RC ids: RC-036, RC-037, RC-038, RC-039

### Test Bindings (post-implementation deterministic checks)
- T13.AC1 (test_file) — file: `api/test/public-templates-article.test.ts` (exists at base: yes)
- T13.AC4 (test_file) — file: `api/test/json-ld-article.test.ts` (exists at base: yes)
- T13.AC2 (test_file) — file: `api/test/public-templates-article.test.ts` (exists at base: yes)

### Evidence Routes After Implementation
Per-story actionable: RC-036, RC-037, RC-038, RC-039. Deferred to ship: none. Skip diagnostic: none.

After committing this story, run via canonical runner:
```
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/a2z-develop/scripts/run_required_evidence_command.py --change-id=kodigital-cms-rescue-2-2026-06-10 --required-claim-ids=RC-036,RC-037,RC-038,RC-039 --evidence-plan=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-cms-rescue-2-2026-06-10/required_evidence_plan.json --workspace-root=/Users/guyhaikov/a2z-workspaces --project-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms --worktree-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-cms-rescue-2-2026-06-10/worktree
```

### Q1 Context Packet
- **requirement_ids:** R-FROM-T13
- **source_context_ids:** SCTX-098, SCTX-136
- **goal_classes:** api
- **must_use_files:**
  - `SCTX-098` — required context for archetype ralph_target_scaffold
  - `SCTX-136` — required context for archetype ralph_target_scaffold
- **must_not_do:**
  - do not weaken acceptance criteria to make tests pass
- **definition_of_done:**
  - vitest: section order correct with nested shell content
  - vitest: reading-progress is index 0
  - ad-slot--rect grep >= 1
  - vitest json-ld-article: BreadcrumbList intact
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

## Story T14: [C9] Header + Hero exact DOM
- Category: ui
- Target Files: api/src/public/templates/components.ts, api/src/public/assets/public-css.ts
- AC ids: T14.AC1, T14.AC2, T14.AC3
- RC ids: RC-040, RC-041, RC-042

### Test Bindings (post-implementation deterministic checks)
- T14.AC2 (test_file) — file: `api/test/public-templates-components.test.ts` (exists at base: yes)

### Evidence Routes After Implementation
Per-story actionable: RC-040, RC-041, RC-042. Deferred to ship: none. Skip diagnostic: none.

After committing this story, run via canonical runner:
```
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/a2z-develop/scripts/run_required_evidence_command.py --change-id=kodigital-cms-rescue-2-2026-06-10 --required-claim-ids=RC-040,RC-041,RC-042 --evidence-plan=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-cms-rescue-2-2026-06-10/required_evidence_plan.json --workspace-root=/Users/guyhaikov/a2z-workspaces --project-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms --worktree-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-cms-rescue-2-2026-06-10/worktree
```

### Q1 Context Packet
- **requirement_ids:** R-FROM-T14
- **source_context_ids:** SCTX-092, SCTX-099
- **goal_classes:** api
- **must_use_files:**
  - `SCTX-092` — required context for archetype ralph_target_scaffold
  - `SCTX-099` — required context for archetype ralph_target_scaffold
- **must_not_do:**
  - do not weaken acceptance criteria to make tests pass
- **definition_of_done:**
  - clamp(340px, 42vw, 480px) grep = 1
  - vitest renderHeader: correct order + labels + btn-outline
  - container padding clamp grep >= 1
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

## Story T15: [C10] ChipRail + Trending dark section
- Category: ui
- Target Files: api/src/public/assets/public-css.ts, api/src/public/templates/components.ts, api/test/design-contract-values.test.ts
- AC ids: T15.AC1, T15.AC2, T15.AC3
- RC ids: RC-043, RC-044, RC-045

### Test Bindings (post-implementation deterministic checks)
- T15.AC1 (test_file) — file: `api/test/design-contract-values.test.ts` (test file does NOT exist at base — Ralph must CREATE it)

### Evidence Routes After Implementation
Per-story actionable: RC-043, RC-044, RC-045. Deferred to ship: none. Skip diagnostic: none.

After committing this story, run via canonical runner:
```
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/a2z-develop/scripts/run_required_evidence_command.py --change-id=kodigital-cms-rescue-2-2026-06-10 --required-claim-ids=RC-043,RC-044,RC-045 --evidence-plan=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-cms-rescue-2-2026-06-10/required_evidence_plan.json --workspace-root=/Users/guyhaikov/a2z-workspaces --project-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms --worktree-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-cms-rescue-2-2026-06-10/worktree
```

### Q1 Context Packet
- **requirement_ids:** R-FROM-T15
- **source_context_ids:** SCTX-092, SCTX-099, SCTX-125
- **goal_classes:** api
- **must_use_files:**
  - `SCTX-092` — required context for archetype ralph_target_scaffold
  - `SCTX-099` — required context for archetype ralph_target_scaffold
  - `SCTX-125` — required context for archetype ralph_target_scaffold
- **must_not_do:**
  - do not weaken acceptance criteria to make tests pass
- **definition_of_done:**
  - vitest design-contract-values: publicCss contains exact .cat-chip min-width, hover border, trending-section background, pulse-dot color from design-contract.md
  - trending-section dark bg class name present in public-css.ts >= 1 (structural secondary)
  - pulse-dot color class name present in public-css.ts >= 1 (structural secondary)
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

## Story T16: [C11] Breakpoint parity (8)
- Category: ui
- Target Files: api/src/public/assets/public-css.ts, api/src/public/templates/public.css.ts, api/test/design-contract-values.test.ts
- AC ids: T16.AC1, T16.AC2, T16.AC3
- RC ids: RC-046, RC-047, RC-048

### Test Bindings (post-implementation deterministic checks)
- T16.AC1 (test_file) — file: `api/test/design-contract-values.test.ts` (test file does NOT exist at base — Ralph must CREATE it)

### Evidence Routes After Implementation
Per-story actionable: RC-046, RC-047, RC-048. Deferred to ship: none. Skip diagnostic: none.

After committing this story, run via canonical runner:
```
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/a2z-develop/scripts/run_required_evidence_command.py --change-id=kodigital-cms-rescue-2-2026-06-10 --required-claim-ids=RC-046,RC-047,RC-048 --evidence-plan=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-cms-rescue-2-2026-06-10/required_evidence_plan.json --workspace-root=/Users/guyhaikov/a2z-workspaces --project-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms --worktree-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-cms-rescue-2-2026-06-10/worktree
```

### Q1 Context Packet
- **requirement_ids:** R-FROM-T16
- **source_context_ids:** SCTX-092, SCTX-103, SCTX-125
- **goal_classes:** api
- **must_use_files:**
  - `SCTX-092` — required context for archetype ralph_target_scaffold
  - `SCTX-103` — required context for archetype ralph_target_scaffold
  - `SCTX-125` — required context for archetype ralph_target_scaffold
- **must_not_do:**
  - do not weaken acceptance criteria to make tests pass
- **definition_of_done:**
  - vitest design-contract-values: publicCss contains all 8 breakpoint values (1280/1080/980/880/800/760/560/480px)
  - ad-slot + min-height present in public.css.ts >= 1 (structural secondary)
  - All 8 breakpoint pixel values present in public-css.ts grep >= 1 each (structural secondary)
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
- `acceptance-tests/T16-syntactic.sh`

## Story T17: [C12] Public JS contract
- Category: ui
- Target Files: api/src/public/assets/public-js.ts, api/test/public-js-contract.test.ts
- AC ids: T17.AC1, T17.AC2, T17.AC3, T17.AC4
- RC ids: RC-049, RC-050, RC-051, RC-052

### Test Bindings (post-implementation deterministic checks)
- T17.AC3 (test_file) — file: `api/test/public-js-contract.test.ts` (test file does NOT exist at base — Ralph must CREATE it)
- T17.AC4 (test_file) — file: `api/test/public-js-contract.test.ts` (test file does NOT exist at base — Ralph must CREATE it)

### Evidence Routes After Implementation
Per-story actionable: RC-049, RC-050, RC-051, RC-052. Deferred to ship: none. Skip diagnostic: none.

After committing this story, run via canonical runner:
```
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/a2z-develop/scripts/run_required_evidence_command.py --change-id=kodigital-cms-rescue-2-2026-06-10 --required-claim-ids=RC-049,RC-050,RC-051,RC-052 --evidence-plan=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-cms-rescue-2-2026-06-10/required_evidence_plan.json --workspace-root=/Users/guyhaikov/a2z-workspaces --project-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms --worktree-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-cms-rescue-2-2026-06-10/worktree
```

### Q1 Context Packet
- **requirement_ids:** R-FROM-T17
- **source_context_ids:** SCTX-093, SCTX-133
- **goal_classes:** api
- **must_use_files:**
  - `SCTX-093` — required context for archetype ralph_target_scaffold
  - `SCTX-133` — required context for archetype ralph_target_scaffold
- **must_not_do:**
  - do not weaken acceptance criteria to make tests pass
- **definition_of_done:**
  - scaleX + transform-origin >= 1; style.width = 0
  - passive: true >= 1
  - vitest public-js-contract: imported script-string content contains zero arrow/const/let (ES5-only inside script literal; whole-file grep is invalid — module export const is legitimate)
  - vitest: exported string < 6KB
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
- `acceptance-tests/T17-syntactic.sh`

## Story T18: [E1] Real POST /api/admin/ai/chat
- Category: api
- Target Files: api/src/admin/ai-api.ts, api/test/admin-ai-chat.test.ts
- AC ids: T18.AC1, T18.AC2, T18.AC3
- RC ids: RC-053, RC-054, RC-055, RC-145

### Test Bindings (post-implementation deterministic checks)
- T18.AC2 (test_file) — file: `api/test/admin-ai-chat.test.ts` (test file does NOT exist at base — Ralph must CREATE it)
- T18.AC3 (test_file) — file: `api/test/admin-ai-chat.test.ts` (test file does NOT exist at base — Ralph must CREATE it)

### Evidence Routes After Implementation
Per-story actionable: RC-053, RC-054, RC-055. Deferred to ship: RC-145. Skip diagnostic: none.

After committing this story, run via canonical runner:
```
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/a2z-develop/scripts/run_required_evidence_command.py --change-id=kodigital-cms-rescue-2-2026-06-10 --required-claim-ids=RC-053,RC-054,RC-055 --evidence-plan=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-cms-rescue-2-2026-06-10/required_evidence_plan.json --workspace-root=/Users/guyhaikov/a2z-workspaces --project-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms --worktree-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-cms-rescue-2-2026-06-10/worktree
```

### Q1 Context Packet
- **requirement_ids:** R-FROM-T18
- **source_context_ids:** SCTX-001, SCTX-002, SCTX-005, SCTX-006, SCTX-016, SCTX-017, SCTX-049, SCTX-050, SCTX-065, SCTX-066, SCTX-109
- **goal_classes:** api
- **must_use_files:**
  - `SCTX-001` — endpoint body the story modifies
  - `SCTX-002` — endpoint body the story modifies
  - `SCTX-005` — required context for archetype interface_contract_endpoint
  - `SCTX-006` — required context for archetype interface_contract_endpoint
  - `SCTX-016` — endpoint body the story modifies
  - `SCTX-017` — endpoint body the story modifies
  - `SCTX-049` — API handler that receives the POST
  - `SCTX-050` — API handler that receives the POST
  - `SCTX-065` — required context for archetype request_field
  - `SCTX-066` — required context for archetype request_field
  - `SCTX-109` — required context for archetype ralph_target_scaffold
- **must_not_do:**
  - do not weaken acceptance criteria to make tests pass
- **definition_of_done:**
  - placeholder:true = 0; /chat grep >= 1; generate-text = 0
  - vitest: model=gpt-5.5; ai_generations row written
  - vitest: no OPENAI_API_KEY -> 501
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
- `acceptance-tests/T18-syntactic.sh`

## Story T19: [E2] Real POST /api/admin/ai/image
- Category: api
- Target Files: api/src/admin/ai-api.ts, api/test/admin-ai-image.test.ts
- AC ids: T19.AC1, T19.AC2, T19.AC3
- RC ids: RC-056, RC-057, RC-058

### Test Bindings (post-implementation deterministic checks)
- T19.AC2 (test_file) — file: `api/test/admin-ai-image.test.ts` (test file does NOT exist at base — Ralph must CREATE it)

### Evidence Routes After Implementation
Per-story actionable: RC-056, RC-057, RC-058. Deferred to ship: none. Skip diagnostic: none.

After committing this story, run via canonical runner:
```
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/a2z-develop/scripts/run_required_evidence_command.py --change-id=kodigital-cms-rescue-2-2026-06-10 --required-claim-ids=RC-056,RC-057,RC-058 --evidence-plan=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-cms-rescue-2-2026-06-10/required_evidence_plan.json --workspace-root=/Users/guyhaikov/a2z-workspaces --project-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms --worktree-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-cms-rescue-2-2026-06-10/worktree
```

### Q1 Context Packet
- **requirement_ids:** R-FROM-T19
- **source_context_ids:** SCTX-001, SCTX-002, SCTX-005, SCTX-006, SCTX-016, SCTX-017, SCTX-049, SCTX-050, SCTX-065, SCTX-066, SCTX-110
- **goal_classes:** api, db_proof
- **must_use_files:**
  - `SCTX-001` — endpoint body the story modifies
  - `SCTX-002` — endpoint body the story modifies
  - `SCTX-005` — required context for archetype interface_contract_endpoint
  - `SCTX-006` — required context for archetype interface_contract_endpoint
  - `SCTX-016` — endpoint body the story modifies
  - `SCTX-017` — endpoint body the story modifies
  - `SCTX-049` — API handler that receives the POST
  - `SCTX-050` — API handler that receives the POST
  - `SCTX-065` — required context for archetype request_field
  - `SCTX-066` — required context for archetype request_field
  - `SCTX-110` — required context for archetype ralph_target_scaffold
- **must_not_do:**
  - do not weaken acceptance criteria to make tests pass
- **definition_of_done:**
  - Endpoint round-trip + SELECT confirms write
  - /image mounted; generate-image = 0; dall-e = 0
  - vitest: model=gpt-image-2; R2 put + media row
  - bodyLimit grep >= 1
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
- `acceptance-tests/T19-syntactic.sh`

## Story T20: [E3] Port POST /api/admin/ai/logo
- Category: api
- Target Files: api/src/admin/ai-api.ts
- AC ids: T20.AC1, T20.AC2
- RC ids: RC-059, RC-060

### Test Bindings (post-implementation deterministic checks)
- T20.AC2 (test_file) — file: `api/test/admin-ai-image.test.ts` (test file does NOT exist at base — Ralph must CREATE it)

### Evidence Routes After Implementation
Per-story actionable: RC-059, RC-060. Deferred to ship: none. Skip diagnostic: none.

After committing this story, run via canonical runner:
```
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/a2z-develop/scripts/run_required_evidence_command.py --change-id=kodigital-cms-rescue-2-2026-06-10 --required-claim-ids=RC-059,RC-060 --evidence-plan=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-cms-rescue-2-2026-06-10/required_evidence_plan.json --workspace-root=/Users/guyhaikov/a2z-workspaces --project-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms --worktree-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-cms-rescue-2-2026-06-10/worktree
```

### Q1 Context Packet
- **requirement_ids:** R-FROM-T20
- **source_context_ids:** SCTX-001, SCTX-002, SCTX-005, SCTX-006, SCTX-016, SCTX-017, SCTX-049, SCTX-050, SCTX-065, SCTX-066
- **goal_classes:** api, db_proof
- **must_use_files:**
  - `SCTX-001` — endpoint body the story modifies
  - `SCTX-002` — endpoint body the story modifies
  - `SCTX-005` — required context for archetype interface_contract_endpoint
  - `SCTX-006` — required context for archetype interface_contract_endpoint
  - `SCTX-016` — endpoint body the story modifies
  - `SCTX-017` — endpoint body the story modifies
  - `SCTX-049` — API handler that receives the POST
  - `SCTX-050` — API handler that receives the POST
  - `SCTX-065` — required context for archetype request_field
  - `SCTX-066` — required context for archetype request_field
- **must_not_do:**
  - do not weaken acceptance criteria to make tests pass
- **definition_of_done:**
  - Endpoint round-trip + SELECT confirms write
  - /logo mounted = 1
  - vitest: writes logo + setting for site_id only
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
- `acceptance-tests/T20-syntactic.sh`

## Story T21: [E4] Presets CRUD + model constraint + migration 0011
- Category: api
- Target Files: api/src/admin/ai-api.ts, api/migrations/0011_phase9_prompt_presets_model_columns.sql, api/test/admin-ai-presets.test.ts
- AC ids: T21.AC1, T21.AC2, T21.AC3, T21.AC4
- RC ids: RC-061, RC-062, RC-063, RC-064

### Test Bindings (post-implementation deterministic checks)
- T21.AC2 (test_file) — file: `api/test/admin-ai-presets.test.ts` (test file does NOT exist at base — Ralph must CREATE it)

### Evidence Routes After Implementation
Per-story actionable: RC-061, RC-062, RC-063, RC-064. Deferred to ship: none. Skip diagnostic: none.

After committing this story, run via canonical runner:
```
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/a2z-develop/scripts/run_required_evidence_command.py --change-id=kodigital-cms-rescue-2-2026-06-10 --required-claim-ids=RC-061,RC-062,RC-063,RC-064 --evidence-plan=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-cms-rescue-2-2026-06-10/required_evidence_plan.json --workspace-root=/Users/guyhaikov/a2z-workspaces --project-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms --worktree-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-cms-rescue-2-2026-06-10/worktree
```

### Q1 Context Packet
- **requirement_ids:** R-FROM-T21
- **source_context_ids:** SCTX-001, SCTX-002, SCTX-005, SCTX-006, SCTX-016, SCTX-017, SCTX-021, SCTX-027, SCTX-029, SCTX-033, SCTX-035, SCTX-049, SCTX-050, SCTX-054, SCTX-065, SCTX-066, SCTX-070, SCTX-112
- **goal_classes:** api, schema
- **must_use_files:**
  - `SCTX-001` — endpoint body the story modifies
  - `SCTX-002` — endpoint body the story modifies
  - `SCTX-005` — required context for archetype interface_contract_endpoint
  - `SCTX-006` — required context for archetype interface_contract_endpoint
  - `SCTX-016` — endpoint body the story modifies
  - `SCTX-017` — endpoint body the story modifies
  - `SCTX-021` — required context for archetype db_table
  - `SCTX-027` — required context for archetype db_schema
  - `SCTX-029` — required context for archetype side_effect_table
  - `SCTX-033` — schema source-of-truth for DB columns
  - `SCTX-035` — required context for archetype table_diff
  - `SCTX-049` — API handler that receives the POST
  - `SCTX-050` — API handler that receives the POST
  - `SCTX-054` — required context for archetype db_table
  - `SCTX-065` — required context for archetype request_field
  - `SCTX-066` — required context for archetype request_field
  - `SCTX-070` — required context for archetype db_column
  - `SCTX-112` — required context for archetype ralph_target_scaffold
- **must_not_do:**
  - do not weaken acceptance criteria to make tests pass
- **definition_of_done:**
  - Migrations apply locally and PRAGMA table_info lists declared columns
  - all 6 preset route patterns mounted
  - vitest: POST/PUT reject invalid models (400)
  - gpt-4o-mini/gpt-image-1 in api/src/ = 0
  - text_model + image_model columns in migration 0011
- **negative_fail_conditions (HARD FAIL):**
  - migration applies but PRAGMA table_info does not list declared column

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
- `acceptance-tests/T21-syntactic.sh`

## Story T22: [B1] adminLayout shell port
- Category: ui
- Target Files: api/src/admin/templates/layout.ts
- AC ids: T22.AC1, T22.AC2, T22.AC3, T22.AC4, T22.AC5
- RC ids: RC-065, RC-066, RC-067, RC-068, RC-069

### Test Bindings (post-implementation deterministic checks)
- T22.AC1 (test_file) — file: `api/test/admin-ux-acceptance.test.ts` (exists at base: yes)
- T22.AC3 (test_file) — file: `api/test/admin-ux-acceptance.test.ts` (exists at base: yes)
- T22.AC5 (test_file) — file: `api/test/admin-layout-shell.test.ts` (test file does NOT exist at base — Ralph must CREATE it)

### Evidence Routes After Implementation
Per-story actionable: RC-065, RC-066, RC-067, RC-068, RC-069. Deferred to ship: none. Skip diagnostic: none.

After committing this story, run via canonical runner:
```
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/a2z-develop/scripts/run_required_evidence_command.py --change-id=kodigital-cms-rescue-2-2026-06-10 --required-claim-ids=RC-065,RC-066,RC-067,RC-068,RC-069 --evidence-plan=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-cms-rescue-2-2026-06-10/required_evidence_plan.json --workspace-root=/Users/guyhaikov/a2z-workspaces --project-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms --worktree-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-cms-rescue-2-2026-06-10/worktree
```

### Q1 Context Packet
- **requirement_ids:** R-FROM-T22
- **source_context_ids:** SCTX-043, SCTX-059
- **goal_classes:** ui_browser_interaction
- **must_use_files:**
  - `SCTX-043` — form HTML the modal renders
  - `SCTX-059` — required context for archetype form_field
- **must_not_do:**
  - do not let interactive controls close without firing the declared POST
  - do not use page.waitForRequest as proof without asserting response.status()
- **definition_of_done:**
  - Playwright spec asserts both page.waitForRequest AND response.status() in {200,201}
  - created row exists in the target DB table on SELECT
  - vitest admin-ux-acceptance passes UNMODIFIED (shell markers)
  - KoDigital CMS >= 1; TheIWise in admin/ = 0
  - vitest: nav order exact 9 entries
  - toast/mobile-menu-btn/badge-draft CSS markers >= 1
  - ported layout inline script stays ES5 — zero arrow/const/let in the script string (layout.ts; script-extraction assertion, not whole-file grep)
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
- `acceptance-tests/T22-syntactic.sh`

## Story T23: [B2] Shared admin helpers
- Category: script
- Target Files: api/src/admin/types.ts, api/src/admin/query-filters.ts, api/test/admin-types.test.ts
- AC ids: T23.AC1, T23.AC2, T23.AC3
- RC ids: RC-070, RC-071, RC-072

### Test Bindings (post-implementation deterministic checks)
- T23.AC2 (test_file) — file: `api/test/admin-types.test.ts` (test file does NOT exist at base — Ralph must CREATE it)
- T23.AC3 (test_file) — file: `api/test/admin-types.test.ts` (test file does NOT exist at base — Ralph must CREATE it)

### Evidence Routes After Implementation
Per-story actionable: RC-070, RC-071, RC-072. Deferred to ship: none. Skip diagnostic: none.

After committing this story, run via canonical runner:
```
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/a2z-develop/scripts/run_required_evidence_command.py --change-id=kodigital-cms-rescue-2-2026-06-10 --required-claim-ids=RC-070,RC-071,RC-072 --evidence-plan=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-cms-rescue-2-2026-06-10/required_evidence_plan.json --workspace-root=/Users/guyhaikov/a2z-workspaces --project-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms --worktree-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-cms-rescue-2-2026-06-10/worktree
```

### Q1 Context Packet
- **requirement_ids:** R-FROM-T23
- **source_context_ids:** SCTX-075, SCTX-076, SCTX-122
- **goal_classes:** structural_script
- **must_use_files:**
  - `SCTX-075` — required context for archetype ralph_target_scaffold
  - `SCTX-076` — required context for archetype ralph_target_scaffold
  - `SCTX-122` — required context for archetype ralph_target_scaffold
- **must_not_do:**
  - do not weaken acceptance criteria to make tests pass
- **definition_of_done:**
  - escapeHtml/isValidId/generateSlug/parsePaginationParams in types.ts = 1 each; buildWhereClause in query-filters.ts = 1
  - legacy slug-generation helper semantics (export from types.ts) + pagination math — types spec green
  - list-filter where-clause builder (export from query-filters.ts) callable and importable — types spec green
- **negative_fail_conditions (HARD FAIL):**
  - acceptance criteria pass while user-facing outcome is broken

### Q1 Story Quality Checks (REQUIRED)
Each check whose `required=true` is a Ralph completion gate. A required check that fails BLOCKS the story — do NOT proceed to commit. Global `npm test` is NOT sufficient unless the packet maps it explicitly. For UI/browser stories, grep-on-TS-source is NEVER sufficient — the browser_check command must run Playwright with a class-set or response-status assertion.

| check | required | kind | command | assertion |
|---|---|---|---|---|
| browser | no | - | `-` | - |
| api | no | - | `-` | - |
| db | no | - | `-` | - |
| job | no | - | `-` | - |
| outbound | no | - | `-` | - |

### Acceptance Tests
- `acceptance-tests/T23-syntactic.sh`

## Story T24: [B3] Dashboard port
- Category: ui
- Target Files: api/src/admin/templates/dashboard.ts, api/test/admin-dashboard-template.test.ts
- AC ids: T24.AC1, T24.AC2
- RC ids: RC-073, RC-074

### Test Bindings (post-implementation deterministic checks)
- T24.AC2 (test_file) — file: `api/test/admin-dashboard-template.test.ts` (exists at base: yes)

### Evidence Routes After Implementation
Per-story actionable: RC-073, RC-074. Deferred to ship: none. Skip diagnostic: none.

After committing this story, run via canonical runner:
```
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/a2z-develop/scripts/run_required_evidence_command.py --change-id=kodigital-cms-rescue-2-2026-06-10 --required-claim-ids=RC-073,RC-074 --evidence-plan=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-cms-rescue-2-2026-06-10/required_evidence_plan.json --workspace-root=/Users/guyhaikov/a2z-workspaces --project-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms --worktree-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-cms-rescue-2-2026-06-10/worktree
```

### Q1 Context Packet
- **requirement_ids:** R-FROM-T24
- **source_context_ids:** SCTX-041, SCTX-057, SCTX-115
- **goal_classes:** ui_browser_interaction
- **must_use_files:**
  - `SCTX-041` — form HTML the modal renders
  - `SCTX-057` — required context for archetype form_field
  - `SCTX-115` — required context for archetype ralph_target_scaffold
- **must_not_do:**
  - do not let interactive controls close without firing the declared POST
  - do not use page.waitForRequest as proof without asserting response.status()
- **definition_of_done:**
  - Playwright spec asserts both page.waitForRequest AND response.status() in {200,201}
  - created row exists in the target DB table on SELECT
  - stat-card/stat-value/Quick Actions grep >= 1
  - vitest: multi-site stat cards retained; admin-dashboard-template.test.ts green
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
- `acceptance-tests/T24-syntactic.sh`

## Story T25: [B4] Articles list port
- Category: ui
- Target Files: api/src/admin/templates/articles.ts, api/test/admin-articles-list.test.ts
- AC ids: T25.AC1, T25.AC2, T25.AC3
- RC ids: RC-075, RC-076, RC-077

### Test Bindings (post-implementation deterministic checks)
- T25.AC3 (test_file) — file: `api/test/admin-articles-list.test.ts` (test file does NOT exist at base — Ralph must CREATE it)

### Evidence Routes After Implementation
Per-story actionable: RC-075, RC-076, RC-077. Deferred to ship: none. Skip diagnostic: none.

After committing this story, run via canonical runner:
```
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/a2z-develop/scripts/run_required_evidence_command.py --change-id=kodigital-cms-rescue-2-2026-06-10 --required-claim-ids=RC-075,RC-076,RC-077 --evidence-plan=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-cms-rescue-2-2026-06-10/required_evidence_plan.json --workspace-root=/Users/guyhaikov/a2z-workspaces --project-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms --worktree-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-cms-rescue-2-2026-06-10/worktree
```

### Q1 Context Packet
- **requirement_ids:** R-FROM-T25
- **source_context_ids:** SCTX-039, SCTX-055, SCTX-114
- **goal_classes:** ui_browser_interaction
- **must_use_files:**
  - `SCTX-039` — form HTML the modal renders
  - `SCTX-055` — required context for archetype form_field
  - `SCTX-114` — required context for archetype ralph_target_scaffold
- **must_not_do:**
  - do not let interactive controls close without firing the declared POST
  - do not use page.waitForRequest as proof without asserting response.status()
- **definition_of_done:**
  - Playwright spec asserts both page.waitForRequest AND response.status() in {200,201}
  - created row exists in the target DB table on SELECT
  - toolbar-search + table-actions >= 1
  - name=site_id >= 1
  - vitest: row actions target registered endpoints
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
- `acceptance-tests/T25-syntactic.sh`

## Story T26: [B5] Article editor port + full CRUD + version history
- Category: api
- Target Files: api/src/admin/templates/articles.ts, api/src/admin/api.ts, api/src/admin/workflow-api.ts, api/test/page-editor-site-id.test.ts, api/test/admin-article-versions.test.ts
- AC ids: T26.AC1, T26.AC2, T26.AC3
- RC ids: RC-078, RC-079, RC-080

### Test Bindings (post-implementation deterministic checks)
- T26.AC3 (test_file) — file: `api/test/page-editor-site-id.test.ts` (exists at base: yes)
- T26.AC1 (test_file) — file: `api/test/admin-articles-list.test.ts` (test file does NOT exist at base — Ralph must CREATE it)
- T26.AC2 (test_file) — file: `api/test/admin-article-versions.test.ts` (test file does NOT exist at base — Ralph must CREATE it)

### Evidence Routes After Implementation
Per-story actionable: RC-078, RC-079, RC-080. Deferred to ship: none. Skip diagnostic: none.

After committing this story, run via canonical runner:
```
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/a2z-develop/scripts/run_required_evidence_command.py --change-id=kodigital-cms-rescue-2-2026-06-10 --required-claim-ids=RC-078,RC-079,RC-080 --evidence-plan=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-cms-rescue-2-2026-06-10/required_evidence_plan.json --workspace-root=/Users/guyhaikov/a2z-workspaces --project-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms --worktree-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-cms-rescue-2-2026-06-10/worktree
```

### Q1 Context Packet
- **requirement_ids:** R-FROM-T26
- **source_context_ids:** SCTX-002, SCTX-004, SCTX-006, SCTX-008, SCTX-017, SCTX-019, SCTX-039, SCTX-050, SCTX-052, SCTX-055, SCTX-066, SCTX-068, SCTX-113, SCTX-129
- **goal_classes:** api, ui_browser_interaction
- **must_use_files:**
  - `SCTX-002` — endpoint body the story modifies
  - `SCTX-004` — endpoint body the story modifies
  - `SCTX-006` — required context for archetype interface_contract_endpoint
  - `SCTX-008` — required context for archetype interface_contract_endpoint
  - `SCTX-017` — endpoint body the story modifies
  - `SCTX-019` — endpoint body the story modifies
  - `SCTX-039` — form HTML the modal renders
  - `SCTX-050` — API handler that receives the POST
  - `SCTX-052` — API handler that receives the POST
  - `SCTX-055` — required context for archetype form_field
  - `SCTX-066` — required context for archetype request_field
  - `SCTX-068` — required context for archetype request_field
  - `SCTX-113` — required context for archetype ralph_target_scaffold
  - `SCTX-129` — required context for archetype ralph_target_scaffold
- **must_not_do:**
  - do not let interactive controls close without firing the declared POST
  - do not use page.waitForRequest as proof without asserting response.status()
- **definition_of_done:**
  - Playwright spec asserts both page.waitForRequest AND response.status() in {200,201}
  - created row exists in the target DB table on SELECT
  - vitest: all workflow endpoints registered; content_version bumped
  - vitest admin-article-versions: version list + restore endpoint
  - vitest page-editor-site-id passes; views/article-editor.ts:122-133 behaviors folded into ported editor template; test re-pointed at template and green
- **negative_fail_conditions (HARD FAIL):**
  - modal click closes without firing the expected POST
  - Playwright test asserts request fired but does not assert response.status() == 2xx

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
- `acceptance-tests/T26-syntactic.sh`

## Story T27: [B6] Block editor port + contract blocks
- Category: ui
- Target Files: api/src/editor/editor-scripts.ts, api/src/editor/blocks.ts, api/src/editor/blocks-to-html.ts, api/src/editor/sanitize.ts, api/test/editor.test.ts
- AC ids: T27.AC1, T27.AC2, T27.AC3, T27.AC4
- RC ids: RC-081, RC-082, RC-083, RC-084

### Test Bindings (post-implementation deterministic checks)
- T27.AC3 (test_file) — file: `api/test/editor.test.ts` (exists at base: yes)
- T27.AC4 (test_file) — file: `api/test/editor.test.ts` (exists at base: yes)

### Evidence Routes After Implementation
Per-story actionable: RC-081, RC-082, RC-083, RC-084. Deferred to ship: none. Skip diagnostic: none.

After committing this story, run via canonical runner:
```
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/a2z-develop/scripts/run_required_evidence_command.py --change-id=kodigital-cms-rescue-2-2026-06-10 --required-claim-ids=RC-081,RC-082,RC-083,RC-084 --evidence-plan=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-cms-rescue-2-2026-06-10/required_evidence_plan.json --workspace-root=/Users/guyhaikov/a2z-workspaces --project-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms --worktree-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-cms-rescue-2-2026-06-10/worktree
```

### Q1 Context Packet
- **requirement_ids:** R-FROM-T27
- **source_context_ids:** SCTX-087, SCTX-088, SCTX-089, SCTX-090, SCTX-126
- **goal_classes:** api
- **must_use_files:**
  - `SCTX-087` — required context for archetype ralph_target_scaffold
  - `SCTX-088` — required context for archetype ralph_target_scaffold
  - `SCTX-089` — required context for archetype ralph_target_scaffold
  - `SCTX-090` — required context for archetype ralph_target_scaffold
  - `SCTX-126` — required context for archetype ralph_target_scaffold
- **must_not_do:**
  - do not weaken acceptance criteria to make tests pass
- **definition_of_done:**
  - pullquote/callout/affiliate in blocks.ts >= 1 each
  - initBlockEditor grep >= 1
  - vitest editor: imported editorScripts string contains zero arrow/const/let (ES5-only inside script literal; whole-file grep is invalid — module-level TS uses ES6, current count 2)
  - vitest: round-trip passes; all 3 new block types survive sanitize
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
- `acceptance-tests/T27-syntactic.sh`

## Story T28: [B7] AI assistant panel port
- Category: ui
- Target Files: api/src/admin/templates/articles.ts, api/test/admin-ai-panel-template.test.ts
- AC ids: T28.AC1, T28.AC2, T28.AC3, T28.AC4
- RC ids: RC-085, RC-086, RC-087, RC-088

### Test Bindings (post-implementation deterministic checks)
- T28.AC3 (test_file) — file: `api/test/admin-ai-panel-template.test.ts` (test file does NOT exist at base — Ralph must CREATE it)
- T28.AC4 (test_file) — file: `api/test/admin-ai-panel-template.test.ts` (test file does NOT exist at base — Ralph must CREATE it)

### Evidence Routes After Implementation
Per-story actionable: RC-085, RC-086, RC-087, RC-088. Deferred to ship: none. Skip diagnostic: none.

After committing this story, run via canonical runner:
```
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/a2z-develop/scripts/run_required_evidence_command.py --change-id=kodigital-cms-rescue-2-2026-06-10 --required-claim-ids=RC-085,RC-086,RC-087,RC-088 --evidence-plan=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-cms-rescue-2-2026-06-10/required_evidence_plan.json --workspace-root=/Users/guyhaikov/a2z-workspaces --project-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms --worktree-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-cms-rescue-2-2026-06-10/worktree
```

### Q1 Context Packet
- **requirement_ids:** R-FROM-T28
- **source_context_ids:** SCTX-039, SCTX-055, SCTX-111
- **goal_classes:** ui_browser_interaction
- **must_use_files:**
  - `SCTX-039` — form HTML the modal renders
  - `SCTX-055` — required context for archetype form_field
  - `SCTX-111` — required context for archetype ralph_target_scaffold
- **must_not_do:**
  - do not let interactive controls close without firing the declared POST
  - do not use page.waitForRequest as proof without asserting response.status()
- **definition_of_done:**
  - Playwright spec asserts both page.waitForRequest AND response.status() in {200,201}
  - created row exists in the target DB table on SELECT
  - generate-text/generate-image in templates/ = 0
  - gpt-4o/gpt-image-1 in templates/ = 0
  - vitest: form page contains AI panel + preset select
  - ported AI-assistant inline script stays ES5 — zero arrow/const/let in the script string (articles.ts; script-extraction assertion, not whole-file grep)
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
- `acceptance-tests/T28-syntactic.sh`

## Story T29: [B8] Pages port + CRUD
- Category: api
- Target Files: api/src/admin/templates/pages.ts, api/src/admin/api.ts, api/test/admin-pages-list-site-id-filter.test.ts
- AC ids: T29.AC1, T29.AC2
- RC ids: RC-089, RC-090

### Test Bindings (post-implementation deterministic checks)
- T29.AC1 (test_file) — file: `api/test/admin-pages-list-site-id-filter.test.ts` (exists at base: yes)
- T29.AC2 (test_file) — file: `api/test/admin-pages-list-site-id-filter.test.ts` (exists at base: yes)

### Evidence Routes After Implementation
Per-story actionable: RC-089, RC-090. Deferred to ship: none. Skip diagnostic: none.

After committing this story, run via canonical runner:
```
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/a2z-develop/scripts/run_required_evidence_command.py --change-id=kodigital-cms-rescue-2-2026-06-10 --required-claim-ids=RC-089,RC-090 --evidence-plan=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-cms-rescue-2-2026-06-10/required_evidence_plan.json --workspace-root=/Users/guyhaikov/a2z-workspaces --project-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms --worktree-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-cms-rescue-2-2026-06-10/worktree
```

### Q1 Context Packet
- **requirement_ids:** R-FROM-T29
- **source_context_ids:** SCTX-002, SCTX-006, SCTX-017, SCTX-045, SCTX-050, SCTX-061, SCTX-066, SCTX-118
- **goal_classes:** api, db_proof, ui_browser_interaction
- **must_use_files:**
  - `SCTX-002` — endpoint body the story modifies
  - `SCTX-006` — required context for archetype interface_contract_endpoint
  - `SCTX-017` — endpoint body the story modifies
  - `SCTX-045` — form HTML the modal renders
  - `SCTX-050` — API handler that receives the POST
  - `SCTX-061` — required context for archetype form_field
  - `SCTX-066` — required context for archetype request_field
  - `SCTX-118` — required context for archetype ralph_target_scaffold
- **must_not_do:**
  - do not let interactive controls close without firing the declared POST
  - do not use page.waitForRequest as proof without asserting response.status()
- **definition_of_done:**
  - Playwright spec asserts both page.waitForRequest AND response.status() in {200,201}
  - created row exists in the target DB table on SELECT
  - Endpoint round-trip + SELECT confirms write
  - vitest: POST/PATCH/DELETE registered; legal badge + page_type retained
  - vitest: show_in_footer/display_order round-trip
- **negative_fail_conditions (HARD FAIL):**
  - modal click closes without firing the expected POST
  - Playwright test asserts request fired but does not assert response.status() == 2xx
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
- `acceptance-tests/T29-syntactic.sh`

## Story T30: [B9] Categories + Tags port + CRUD completion
- Category: api
- Target Files: api/src/admin/templates/categories.ts, api/src/admin/templates/tags.ts, api/src/admin/api.ts, api/test/admin-tags-site-filter.test.ts, api/test/category-multi-vertical.test.ts
- AC ids: T30.AC1, T30.AC2
- RC ids: RC-091, RC-092

### Test Bindings (post-implementation deterministic checks)
- T30.AC1 (test_file) — file: `api/test/category-multi-vertical.test.ts` (exists at base: yes)
- T30.AC2 (test_file) — file: `api/test/admin-tags-site-filter.test.ts` (exists at base: yes)

### Evidence Routes After Implementation
Per-story actionable: RC-091, RC-092. Deferred to ship: none. Skip diagnostic: none.

After committing this story, run via canonical runner:
```
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/a2z-develop/scripts/run_required_evidence_command.py --change-id=kodigital-cms-rescue-2-2026-06-10 --required-claim-ids=RC-091,RC-092 --evidence-plan=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-cms-rescue-2-2026-06-10/required_evidence_plan.json --workspace-root=/Users/guyhaikov/a2z-workspaces --project-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms --worktree-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-cms-rescue-2-2026-06-10/worktree
```

### Q1 Context Packet
- **requirement_ids:** R-FROM-T30
- **source_context_ids:** SCTX-002, SCTX-006, SCTX-017, SCTX-040, SCTX-048, SCTX-050, SCTX-056, SCTX-064, SCTX-066, SCTX-121, SCTX-124
- **goal_classes:** api, db_proof, ui_browser_interaction
- **must_use_files:**
  - `SCTX-002` — endpoint body the story modifies
  - `SCTX-006` — required context for archetype interface_contract_endpoint
  - `SCTX-017` — endpoint body the story modifies
  - `SCTX-040` — form HTML the modal renders
  - `SCTX-048` — form HTML the modal renders
  - `SCTX-050` — API handler that receives the POST
  - `SCTX-056` — required context for archetype form_field
  - `SCTX-064` — required context for archetype form_field
  - `SCTX-066` — required context for archetype request_field
  - `SCTX-121` — required context for archetype ralph_target_scaffold
  - `SCTX-124` — required context for archetype ralph_target_scaffold
- **must_not_do:**
  - do not let interactive controls close without firing the declared POST
  - do not use page.waitForRequest as proof without asserting response.status()
- **definition_of_done:**
  - Playwright spec asserts both page.waitForRequest AND response.status() in {200,201}
  - created row exists in the target DB table on SELECT
  - Endpoint round-trip + SELECT confirms write
  - vitest category-multi-vertical: PUT/DELETE /categories + delete-guard
  - vitest admin-tags-site-filter: POST/DELETE /tags; filters retained
- **negative_fail_conditions (HARD FAIL):**
  - modal click closes without firing the expected POST
  - Playwright test asserts request fired but does not assert response.status() == 2xx
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
- `acceptance-tests/T30-syntactic.sh`

## Story T31: [B10] Media library port
- Category: api
- Target Files: api/src/admin/templates/media.ts, api/src/admin/api.ts, api/test/admin-media-site-filter.test.ts
- AC ids: T31.AC1, T31.AC2
- RC ids: RC-093, RC-094

### Test Bindings (post-implementation deterministic checks)
- T31.AC1 (test_file) — file: `api/test/admin-media-site-filter.test.ts` (exists at base: yes)

### Evidence Routes After Implementation
Per-story actionable: RC-093, RC-094. Deferred to ship: none. Skip diagnostic: none.

After committing this story, run via canonical runner:
```
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/a2z-develop/scripts/run_required_evidence_command.py --change-id=kodigital-cms-rescue-2-2026-06-10 --required-claim-ids=RC-093,RC-094 --evidence-plan=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-cms-rescue-2-2026-06-10/required_evidence_plan.json --workspace-root=/Users/guyhaikov/a2z-workspaces --project-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms --worktree-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-cms-rescue-2-2026-06-10/worktree
```

### Q1 Context Packet
- **requirement_ids:** R-FROM-T31
- **source_context_ids:** SCTX-002, SCTX-006, SCTX-017, SCTX-044, SCTX-050, SCTX-060, SCTX-066, SCTX-117
- **goal_classes:** api, ui_browser_interaction
- **must_use_files:**
  - `SCTX-002` — endpoint body the story modifies
  - `SCTX-006` — required context for archetype interface_contract_endpoint
  - `SCTX-017` — endpoint body the story modifies
  - `SCTX-044` — form HTML the modal renders
  - `SCTX-050` — API handler that receives the POST
  - `SCTX-060` — required context for archetype form_field
  - `SCTX-066` — required context for archetype request_field
  - `SCTX-117` — required context for archetype ralph_target_scaffold
- **must_not_do:**
  - do not let interactive controls close without firing the declared POST
  - do not use page.waitForRequest as proof without asserting response.status()
- **definition_of_done:**
  - Playwright spec asserts both page.waitForRequest AND response.status() in {200,201}
  - created row exists in the target DB table on SELECT
  - vitest: upload multipart fields match; media CRUD site-scoped
  - media-grid grep >= 1
- **negative_fail_conditions (HARD FAIL):**
  - modal click closes without firing the expected POST
  - Playwright test asserts request fired but does not assert response.status() == 2xx

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
- `acceptance-tests/T31-syntactic.sh`

## Story T32: [B11] Settings port (per-site)
- Category: ui
- Target Files: api/src/admin/templates/settings.ts, api/test/admin-settings.test.ts, api/test/settings-version-bump.test.ts
- AC ids: T32.AC1, T32.AC2, T32.AC3, T32.AC4
- RC ids: RC-095, RC-096, RC-097, RC-098

### Test Bindings (post-implementation deterministic checks)
- T32.AC2 (test_file) — file: `api/test/admin-settings.test.ts` (exists at base: yes)
- T32.AC4 (test_file) — file: `api/test/settings-version-bump.test.ts` (exists at base: yes)

### Evidence Routes After Implementation
Per-story actionable: RC-095, RC-096, RC-097, RC-098. Deferred to ship: none. Skip diagnostic: none.

After committing this story, run via canonical runner:
```
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/a2z-develop/scripts/run_required_evidence_command.py --change-id=kodigital-cms-rescue-2-2026-06-10 --required-claim-ids=RC-095,RC-096,RC-097,RC-098 --evidence-plan=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-cms-rescue-2-2026-06-10/required_evidence_plan.json --workspace-root=/Users/guyhaikov/a2z-workspaces --project-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms --worktree-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-cms-rescue-2-2026-06-10/worktree
```

### Q1 Context Packet
- **requirement_ids:** R-FROM-T32
- **source_context_ids:** SCTX-047, SCTX-063, SCTX-120, SCTX-142
- **goal_classes:** api, db_proof, ui_browser_interaction
- **must_use_files:**
  - `SCTX-047` — form HTML the modal renders
  - `SCTX-063` — required context for archetype form_field
  - `SCTX-120` — required context for archetype ralph_target_scaffold
  - `SCTX-142` — required context for archetype ralph_target_scaffold
- **must_not_do:**
  - do not let interactive controls close without firing the declared POST
  - do not use page.waitForRequest as proof without asserting response.status()
- **definition_of_done:**
  - Playwright spec asserts both page.waitForRequest AND response.status() in {200,201}
  - created row exists in the target DB table on SELECT
  - Endpoint round-trip + SELECT confirms write
  - card headings: Site Information/Site Logo/ads.txt/etc. >= 1 each
  - vitest: site selector + PATCH with site_id; canonical keys round-trip
  - /api/admin/ai/logo grep = 1
  - vitest settings-version-bump.test.ts: 0 failures (EXISTING test co-updated, green)
- **negative_fail_conditions (HARD FAIL):**
  - modal click closes without firing the expected POST
  - Playwright test asserts request fired but does not assert response.status() == 2xx
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
- `acceptance-tests/T32-syntactic.sh`

## Story T33: [B12] Presets pages + Domains restyle
- Category: ui
- Target Files: api/src/admin/templates/presets.ts, api/src/admin/ui.ts, api/src/admin/templates/domains.ts, api/test/admin-domains.test.ts, api/src/admin/views/article-editor.ts, api/src/admin/views/articles.ts, api/src/admin/views/categories.ts, api/src/admin/views/domains.ts, api/src/admin/views/media.ts, api/src/admin/views/page-editor.ts, api/src/admin/views/pages.ts, api/src/admin/views/settings.ts, api/src/admin/views/tags.ts
- AC ids: T33.AC1, T33.AC2, T33.AC3, T33.AC4, T33.AC5
- RC ids: RC-099, RC-100, RC-101, RC-102, RC-103

### Test Bindings (post-implementation deterministic checks)
- T33.AC2 (test_file) — file: `api/test/admin-domains.test.ts` (exists at base: yes)

### Evidence Routes After Implementation
Per-story actionable: RC-099, RC-100, RC-101, RC-102, RC-103. Deferred to ship: none. Skip diagnostic: none.

After committing this story, run via canonical runner:
```
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/a2z-develop/scripts/run_required_evidence_command.py --change-id=kodigital-cms-rescue-2-2026-06-10 --required-claim-ids=RC-099,RC-100,RC-101,RC-102,RC-103 --evidence-plan=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-cms-rescue-2-2026-06-10/required_evidence_plan.json --workspace-root=/Users/guyhaikov/a2z-workspaces --project-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms --worktree-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-cms-rescue-2-2026-06-10/worktree
```

### Q1 Context Packet
- **requirement_ids:** R-FROM-T33
- **source_context_ids:** SCTX-039, SCTX-040, SCTX-042, SCTX-044, SCTX-045, SCTX-046, SCTX-047, SCTX-048, SCTX-055, SCTX-056, SCTX-058, SCTX-060, SCTX-061, SCTX-062, SCTX-063, SCTX-064, SCTX-077, SCTX-078, SCTX-079, SCTX-080, SCTX-081, SCTX-082, SCTX-083, SCTX-084, SCTX-085, SCTX-086, SCTX-116
- **goal_classes:** ui_browser_interaction
- **must_use_files:**
  - `SCTX-039` — form HTML the modal renders
  - `SCTX-040` — form HTML the modal renders
  - `SCTX-042` — form HTML the modal renders
  - `SCTX-044` — form HTML the modal renders
  - `SCTX-045` — form HTML the modal renders
  - `SCTX-046` — form HTML the modal renders
  - `SCTX-047` — form HTML the modal renders
  - `SCTX-048` — form HTML the modal renders
  - `SCTX-055` — required context for archetype form_field
  - `SCTX-056` — required context for archetype form_field
  - `SCTX-058` — required context for archetype form_field
  - `SCTX-060` — required context for archetype form_field
  - `SCTX-061` — required context for archetype form_field
  - `SCTX-062` — required context for archetype form_field
  - `SCTX-063` — required context for archetype form_field
  - `SCTX-064` — required context for archetype form_field
  - `SCTX-077` — required context for archetype ralph_target_scaffold
  - `SCTX-078` — required context for archetype ralph_target_scaffold
  - `SCTX-079` — required context for archetype ralph_target_scaffold
  - `SCTX-080` — required context for archetype ralph_target_scaffold
  - `SCTX-081` — required context for archetype ralph_target_scaffold
  - `SCTX-082` — required context for archetype ralph_target_scaffold
  - `SCTX-083` — required context for archetype ralph_target_scaffold
  - `SCTX-084` — required context for archetype ralph_target_scaffold
  - `SCTX-085` — required context for archetype ralph_target_scaffold
  - `SCTX-086` — required context for archetype ralph_target_scaffold
  - `SCTX-116` — required context for archetype ralph_target_scaffold
- **must_not_do:**
  - do not let interactive controls close without firing the declared POST
  - do not use page.waitForRequest as proof without asserting response.status()
- **definition_of_done:**
  - Playwright spec asserts both page.waitForRequest AND response.status() in {200,201}
  - created row exists in the target DB table on SELECT
  - presets/new + presets/:id in ui.ts >= 2; SUPPORTED_*_MODELS import >= 1
  - vitest admin-domains: restyled; status-panel present; poll URL unchanged
  - provisioning-status-panel = 1; launch-readiness >= 1
  - escapeHtml de-dup post-port: <= 1 definition in admin templates
  - views/ dir deleted after all B-port folds
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
- `acceptance-tests/T33-syntactic.sh`

## Story T34: [D1] STEP_KEYS → 16 canonical names
- Category: api
- Target Files: api/src/site-provisioning/steps.ts, api/src/site-provisioning/runner.ts, api/test/admin-ux-acceptance.test.ts
- AC ids: T34.AC1, T34.AC2, T34.AC3, T34.AC4
- RC ids: RC-104, RC-105, RC-106, RC-107, RC-144

### Test Bindings (post-implementation deterministic checks)
- T34.AC1 (test_file) — file: `api/test/site-provisioning-runner.test.ts` (exists at base: yes)
- T34.AC4 (test_file) — file: `api/test/admin-ux-acceptance.test.ts` (exists at base: yes)
- T34.AC3 (test_file) — file: `api/test/site-provisioning-runner.test.ts` (exists at base: yes)

### Evidence Routes After Implementation
Per-story actionable: RC-104, RC-105, RC-106, RC-107. Deferred to ship: RC-144. Skip diagnostic: none.

After committing this story, run via canonical runner:
```
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/a2z-develop/scripts/run_required_evidence_command.py --change-id=kodigital-cms-rescue-2-2026-06-10 --required-claim-ids=RC-104,RC-105,RC-106,RC-107 --evidence-plan=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-cms-rescue-2-2026-06-10/required_evidence_plan.json --workspace-root=/Users/guyhaikov/a2z-workspaces --project-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms --worktree-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-cms-rescue-2-2026-06-10/worktree
```

### Q1 Context Packet
- **requirement_ids:** R-FROM-T34
- **source_context_ids:** SCTX-011, SCTX-025, SCTX-107, SCTX-108, SCTX-123
- **goal_classes:** api, cf_dry_run, provisioning_step
- **must_use_files:**
  - `SCTX-011` — dry-run guard surface
  - `SCTX-025` — provisioning step body to mirror
  - `SCTX-107` — required context for archetype ralph_target_scaffold
  - `SCTX-108` — required context for archetype ralph_target_scaffold
  - `SCTX-123` — required context for archetype ralph_target_scaffold
- **must_not_do:**
  - do not skip steps; do not bypass dry-run flag without explicit story AC
  - do not emit any outbound fetch to api.cloudflare.com under dry-run
- **definition_of_done:**
  - All declared steps run end-to-end against local D1; every side-effect table has rows
  - Fetch-mock harness records 0 outbound fetches in dry-run mode
  - vitest: STEP_KEYS.length === 16; STEP_KEYS[15] === update_launch_readiness
  - _stub in steps.ts = 0
  - vitest: TOTAL_STEPS=16 in INSERTs; defensive stale-job guard
  - vitest admin-ux-acceptance passes
- **negative_fail_conditions (HARD FAIL):**
  - provisioning crashes before completing all declared steps in dry-run mode
  - step succeeded but expected side-effect table has 0 rows
  - dry-run mode emits any outbound HTTP to api.cloudflare.com

### Q1 Story Quality Checks (REQUIRED)
Each check whose `required=true` is a Ralph completion gate. A required check that fails BLOCKS the story — do NOT proceed to commit. Global `npm test` is NOT sufficient unless the packet maps it explicitly. For UI/browser stories, grep-on-TS-source is NEVER sufficient — the browser_check command must run Playwright with a class-set or response-status assertion.

| check | required | kind | command | assertion |
|---|---|---|---|---|
| browser | no | - | `-` | - |
| api | yes | curl_or_vitest_response | `cd api && npm test -- --grep '{endpoint}' OR curl http://localhost:8787{route}` | response shape matches interface_contract |
| db | yes | wrangler_d1_select_assert_row | `cd api && npx wrangler d1 execute {db} --local --command "{select_sql}"` | if endpoint has db_effects, SELECT confirms write |
| job | yes | site_creation_job_steps_complete | `cd api && npx wrangler d1 execute {db} --local --command "SELECT step_key, st...` | every step status='succeeded' OR job has last_error populated |
| outbound | yes | fetch_mock_observation_zero_outbound | `cd api && npm test -- --grep 'dry-run'` | 0 fetches to api.cloudflare.com |

### Acceptance Tests
- `acceptance-tests/T34-syntactic.sh`

## Story T35: [D2] Real Cloudflare-boundary steps 1-3
- Category: api
- Target Files: api/src/site-provisioning/steps.ts, api/src/site-provisioning/cloudflare-interfaces.ts
- AC ids: T35.AC1, T35.AC2, T35.AC3
- RC ids: RC-108, RC-109, RC-110, RC-144

### Test Bindings (post-implementation deterministic checks)
- T35.AC2 (test_file) — file: `api/test/site-provisioning-dry-run.test.ts` (exists at base: yes)
- T35.AC3 (test_file) — file: `api/test/provisioning-no-outbound.test.ts` (exists at base: yes)

### Evidence Routes After Implementation
Per-story actionable: RC-108, RC-109, RC-110. Deferred to ship: RC-144. Skip diagnostic: none.

After committing this story, run via canonical runner:
```
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/a2z-develop/scripts/run_required_evidence_command.py --change-id=kodigital-cms-rescue-2-2026-06-10 --required-claim-ids=RC-108,RC-109,RC-110 --evidence-plan=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-cms-rescue-2-2026-06-10/required_evidence_plan.json --workspace-root=/Users/guyhaikov/a2z-workspaces --project-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms --worktree-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-cms-rescue-2-2026-06-10/worktree
```

### Q1 Context Packet
- **requirement_ids:** R-FROM-T35
- **source_context_ids:** SCTX-009, SCTX-014, SCTX-023, SCTX-106, SCTX-108
- **goal_classes:** api, cf_dry_run, provisioning_step
- **must_use_files:**
  - `SCTX-009` — dry-run guard surface
  - `SCTX-014` — required context for archetype fetch_mock
  - `SCTX-023` — provisioning step body to mirror
  - `SCTX-106` — required context for archetype ralph_target_scaffold
  - `SCTX-108` — required context for archetype ralph_target_scaffold
- **must_not_do:**
  - do not skip steps; do not bypass dry-run flag without explicit story AC
  - do not emit any outbound fetch to api.cloudflare.com under dry-run
- **definition_of_done:**
  - All declared steps run end-to-end against local D1; every side-effect table has rows
  - Fetch-mock harness records 0 outbound fetches in dry-run mode
  - stubResult for 3 CF steps = 0
  - vitest dry-run: completed_dry_run; route mutation guard correct
  - vitest: zero outbound fetch
- **negative_fail_conditions (HARD FAIL):**
  - provisioning crashes before completing all declared steps in dry-run mode
  - step succeeded but expected side-effect table has 0 rows
  - dry-run mode emits any outbound HTTP to api.cloudflare.com

### Q1 Story Quality Checks (REQUIRED)
Each check whose `required=true` is a Ralph completion gate. A required check that fails BLOCKS the story — do NOT proceed to commit. Global `npm test` is NOT sufficient unless the packet maps it explicitly. For UI/browser stories, grep-on-TS-source is NEVER sufficient — the browser_check command must run Playwright with a class-set or response-status assertion.

| check | required | kind | command | assertion |
|---|---|---|---|---|
| browser | no | - | `-` | - |
| api | yes | curl_or_vitest_response | `cd api && npm test -- --grep '{endpoint}' OR curl http://localhost:8787{route}` | response shape matches interface_contract |
| db | yes | wrangler_d1_select_assert_row | `cd api && npx wrangler d1 execute {db} --local --command "{select_sql}"` | if endpoint has db_effects, SELECT confirms write |
| job | yes | site_creation_job_steps_complete | `cd api && npx wrangler d1 execute {db} --local --command "SELECT step_key, st...` | every step status='succeeded' OR job has last_error populated |
| outbound | yes | fetch_mock_observation_zero_outbound | `cd api && npm test -- --grep 'dry-run'` | 0 fetches to api.cloudflare.com |

### Acceptance Tests
- `acceptance-tests/T35-syntactic.sh`

## Story T36: [D3] Real publish_starter_articles
- Category: api
- Target Files: api/src/site-provisioning/steps.ts
- AC ids: T36.AC1, T36.AC2
- RC ids: RC-111, RC-112, RC-144

### Test Bindings (post-implementation deterministic checks)
- T36.AC2 (test_file) — file: `api/test/site-provisioning-run-to-completion.test.ts` (exists at base: yes)

### Evidence Routes After Implementation
Per-story actionable: RC-111, RC-112. Deferred to ship: RC-144. Skip diagnostic: none.

After committing this story, run via canonical runner:
```
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/a2z-develop/scripts/run_required_evidence_command.py --change-id=kodigital-cms-rescue-2-2026-06-10 --required-claim-ids=RC-111,RC-112 --evidence-plan=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-cms-rescue-2-2026-06-10/required_evidence_plan.json --workspace-root=/Users/guyhaikov/a2z-workspaces --project-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms --worktree-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-cms-rescue-2-2026-06-10/worktree
```

### Q1 Context Packet
- **requirement_ids:** R-FROM-T36
- **source_context_ids:** SCTX-010, SCTX-024, SCTX-108
- **goal_classes:** api, cf_dry_run, provisioning_step
- **must_use_files:**
  - `SCTX-010` — dry-run guard surface
  - `SCTX-024` — provisioning step body to mirror
  - `SCTX-108` — required context for archetype ralph_target_scaffold
- **must_not_do:**
  - do not skip steps; do not bypass dry-run flag without explicit story AC
  - do not emit any outbound fetch to api.cloudflare.com under dry-run
- **definition_of_done:**
  - All declared steps run end-to-end against local D1; every side-effect table has rows
  - Fetch-mock harness records 0 outbound fetches in dry-run mode
  - stubResult publish = 0
  - vitest: status=published + published_at + content_version bumped
- **negative_fail_conditions (HARD FAIL):**
  - provisioning crashes before completing all declared steps in dry-run mode
  - step succeeded but expected side-effect table has 0 rows
  - dry-run mode emits any outbound HTTP to api.cloudflare.com

### Q1 Story Quality Checks (REQUIRED)
Each check whose `required=true` is a Ralph completion gate. A required check that fails BLOCKS the story — do NOT proceed to commit. Global `npm test` is NOT sufficient unless the packet maps it explicitly. For UI/browser stories, grep-on-TS-source is NEVER sufficient — the browser_check command must run Playwright with a class-set or response-status assertion.

| check | required | kind | command | assertion |
|---|---|---|---|---|
| browser | no | - | `-` | - |
| api | yes | curl_or_vitest_response | `cd api && npm test -- --grep '{endpoint}' OR curl http://localhost:8787{route}` | response shape matches interface_contract |
| db | yes | wrangler_d1_select_assert_row | `cd api && npx wrangler d1 execute {db} --local --command "{select_sql}"` | if endpoint has db_effects, SELECT confirms write |
| job | yes | site_creation_job_steps_complete | `cd api && npx wrangler d1 execute {db} --local --command "SELECT step_key, st...` | every step status='succeeded' OR job has last_error populated |
| outbound | yes | fetch_mock_observation_zero_outbound | `cd api && npm test -- --grep 'dry-run'` | 0 fetches to api.cloudflare.com |

### Acceptance Tests
- `acceptance-tests/T36-syntactic.sh`

## Story T37: [D4] Real warm_homepage_cache
- Category: api
- Target Files: api/src/site-provisioning/steps.ts
- AC ids: T37.AC1, T37.AC2
- RC ids: RC-113, RC-114, RC-144

### Test Bindings (post-implementation deterministic checks)
- T37.AC2 (test_file) — file: `api/test/site-provisioning-run-to-completion.test.ts` (exists at base: yes)

### Evidence Routes After Implementation
Per-story actionable: RC-113, RC-114. Deferred to ship: RC-144. Skip diagnostic: none.

After committing this story, run via canonical runner:
```
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/a2z-develop/scripts/run_required_evidence_command.py --change-id=kodigital-cms-rescue-2-2026-06-10 --required-claim-ids=RC-113,RC-114 --evidence-plan=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-cms-rescue-2-2026-06-10/required_evidence_plan.json --workspace-root=/Users/guyhaikov/a2z-workspaces --project-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms --worktree-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-cms-rescue-2-2026-06-10/worktree
```

### Q1 Context Packet
- **requirement_ids:** R-FROM-T37
- **source_context_ids:** SCTX-010, SCTX-024, SCTX-108
- **goal_classes:** api, cf_dry_run, provisioning_step
- **must_use_files:**
  - `SCTX-010` — dry-run guard surface
  - `SCTX-024` — provisioning step body to mirror
  - `SCTX-108` — required context for archetype ralph_target_scaffold
- **must_not_do:**
  - do not skip steps; do not bypass dry-run flag without explicit story AC
  - do not emit any outbound fetch to api.cloudflare.com under dry-run
- **definition_of_done:**
  - All declared steps run end-to-end against local D1; every side-effect table has rows
  - Fetch-mock harness records 0 outbound fetches in dry-run mode
  - stubResult warm = 0
  - vitest fake KV: htmlKey put with correct key
- **negative_fail_conditions (HARD FAIL):**
  - provisioning crashes before completing all declared steps in dry-run mode
  - step succeeded but expected side-effect table has 0 rows
  - dry-run mode emits any outbound HTTP to api.cloudflare.com

### Q1 Story Quality Checks (REQUIRED)
Each check whose `required=true` is a Ralph completion gate. A required check that fails BLOCKS the story — do NOT proceed to commit. Global `npm test` is NOT sufficient unless the packet maps it explicitly. For UI/browser stories, grep-on-TS-source is NEVER sufficient — the browser_check command must run Playwright with a class-set or response-status assertion.

| check | required | kind | command | assertion |
|---|---|---|---|---|
| browser | no | - | `-` | - |
| api | yes | curl_or_vitest_response | `cd api && npm test -- --grep '{endpoint}' OR curl http://localhost:8787{route}` | response shape matches interface_contract |
| db | yes | wrangler_d1_select_assert_row | `cd api && npx wrangler d1 execute {db} --local --command "{select_sql}"` | if endpoint has db_effects, SELECT confirms write |
| job | yes | site_creation_job_steps_complete | `cd api && npx wrangler d1 execute {db} --local --command "SELECT step_key, st...` | every step status='succeeded' OR job has last_error populated |
| outbound | yes | fetch_mock_observation_zero_outbound | `cd api && npm test -- --grep 'dry-run'` | 0 fetches to api.cloudflare.com |

### Acceptance Tests
- `acceptance-tests/T37-syntactic.sh`

## Story T38: [D5] Real run_site_smoke_tests
- Category: api
- Target Files: api/src/site-provisioning/steps.ts
- AC ids: T38.AC1, T38.AC2
- RC ids: RC-115, RC-116, RC-144

### Test Bindings (post-implementation deterministic checks)
- T38.AC2 (test_file) — file: `api/test/site-provisioning-run-to-completion.test.ts` (exists at base: yes)

### Evidence Routes After Implementation
Per-story actionable: RC-115, RC-116. Deferred to ship: RC-144. Skip diagnostic: none.

After committing this story, run via canonical runner:
```
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/a2z-develop/scripts/run_required_evidence_command.py --change-id=kodigital-cms-rescue-2-2026-06-10 --required-claim-ids=RC-115,RC-116 --evidence-plan=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-cms-rescue-2-2026-06-10/required_evidence_plan.json --workspace-root=/Users/guyhaikov/a2z-workspaces --project-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms --worktree-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-cms-rescue-2-2026-06-10/worktree
```

### Q1 Context Packet
- **requirement_ids:** R-FROM-T38
- **source_context_ids:** SCTX-010, SCTX-024, SCTX-108
- **goal_classes:** api, cf_dry_run, provisioning_step
- **must_use_files:**
  - `SCTX-010` — dry-run guard surface
  - `SCTX-024` — provisioning step body to mirror
  - `SCTX-108` — required context for archetype ralph_target_scaffold
- **must_not_do:**
  - do not skip steps; do not bypass dry-run flag without explicit story AC
  - do not emit any outbound fetch to api.cloudflare.com under dry-run
- **definition_of_done:**
  - All declared steps run end-to-end against local D1; every side-effect table has rows
  - Fetch-mock harness records 0 outbound fetches in dry-run mode
  - stubResult smoke = 0
  - vitest: >= 3 in-process checks; zero network
- **negative_fail_conditions (HARD FAIL):**
  - provisioning crashes before completing all declared steps in dry-run mode
  - step succeeded but expected side-effect table has 0 rows
  - dry-run mode emits any outbound HTTP to api.cloudflare.com

### Q1 Story Quality Checks (REQUIRED)
Each check whose `required=true` is a Ralph completion gate. A required check that fails BLOCKS the story — do NOT proceed to commit. Global `npm test` is NOT sufficient unless the packet maps it explicitly. For UI/browser stories, grep-on-TS-source is NEVER sufficient — the browser_check command must run Playwright with a class-set or response-status assertion.

| check | required | kind | command | assertion |
|---|---|---|---|---|
| browser | no | - | `-` | - |
| api | yes | curl_or_vitest_response | `cd api && npm test -- --grep '{endpoint}' OR curl http://localhost:8787{route}` | response shape matches interface_contract |
| db | yes | wrangler_d1_select_assert_row | `cd api && npx wrangler d1 execute {db} --local --command "{select_sql}"` | if endpoint has db_effects, SELECT confirms write |
| job | yes | site_creation_job_steps_complete | `cd api && npx wrangler d1 execute {db} --local --command "SELECT step_key, st...` | every step status='succeeded' OR job has last_error populated |
| outbound | yes | fetch_mock_observation_zero_outbound | `cd api && npm test -- --grep 'dry-run'` | 0 fetches to api.cloudflare.com |

### Acceptance Tests
- `acceptance-tests/T38-syntactic.sh`

## Story T39: [D6] update_launch_readiness + UI
- Category: api
- Target Files: api/src/site-provisioning/steps.ts, api/src/admin/sites-handlers.ts, api/src/admin/templates/domains.ts, api/test/admin-provision-status.test.ts
- AC ids: T39.AC1, T39.AC2, T39.AC3
- RC ids: RC-117, RC-118, RC-119, RC-144

### Test Bindings (post-implementation deterministic checks)
- T39.AC2 (test_file) — file: `api/test/admin-provision-status.test.ts` (exists at base: yes)
- T39.AC3 (test_file) — file: `api/test/admin-provision-status.test.ts` (exists at base: yes)

### Evidence Routes After Implementation
Per-story actionable: RC-117, RC-118, RC-119. Deferred to ship: RC-144. Skip diagnostic: none.

After committing this story, run via canonical runner:
```
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/a2z-develop/scripts/run_required_evidence_command.py --change-id=kodigital-cms-rescue-2-2026-06-10 --required-claim-ids=RC-117,RC-118,RC-119 --evidence-plan=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-cms-rescue-2-2026-06-10/required_evidence_plan.json --workspace-root=/Users/guyhaikov/a2z-workspaces --project-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms --worktree-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-cms-rescue-2-2026-06-10/worktree
```

### Q1 Context Packet
- **requirement_ids:** R-FROM-T39
- **source_context_ids:** SCTX-003, SCTX-007, SCTX-018, SCTX-042, SCTX-051, SCTX-058, SCTX-067, SCTX-108, SCTX-119
- **goal_classes:** api, ui_browser_interaction
- **must_use_files:**
  - `SCTX-003` — endpoint body the story modifies
  - `SCTX-007` — required context for archetype interface_contract_endpoint
  - `SCTX-018` — endpoint body the story modifies
  - `SCTX-042` — form HTML the modal renders
  - `SCTX-051` — API handler that receives the POST
  - `SCTX-058` — required context for archetype form_field
  - `SCTX-067` — required context for archetype request_field
  - `SCTX-108` — required context for archetype ralph_target_scaffold
  - `SCTX-119` — required context for archetype ralph_target_scaffold
- **must_not_do:**
  - do not let interactive controls close without firing the declared POST
  - do not use page.waitForRequest as proof without asserting response.status()
- **definition_of_done:**
  - Playwright spec asserts both page.waitForRequest AND response.status() in {200,201}
  - created row exists in the target DB table on SELECT
  - update_launch_readiness in steps.ts >= 2 (union + registry)
  - vitest: GET /provision response includes launch_readiness
  - vitest: domains template renders readiness badges
- **negative_fail_conditions (HARD FAIL):**
  - modal click closes without firing the expected POST
  - Playwright test asserts request fired but does not assert response.status() == 2xx

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
- `acceptance-tests/T39-syntactic.sh`

## Story T40: [F1] Slug URL canonicalization
- Category: api
- Target Files: api/src/public/router.ts
- AC ids: T40.AC1, T40.AC2
- RC ids: RC-120, RC-121

### Test Bindings (post-implementation deterministic checks)
- T40.AC1 (test_file) — file: `api/test/public-router.test.ts` (test file does NOT exist at base — Ralph must CREATE it)
- T40.AC2 (test_file) — file: `api/test/public-router.test.ts` (test file does NOT exist at base — Ralph must CREATE it)

### Evidence Routes After Implementation
Per-story actionable: RC-120, RC-121. Deferred to ship: none. Skip diagnostic: none.

After committing this story, run via canonical runner:
```
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/a2z-develop/scripts/run_required_evidence_command.py --change-id=kodigital-cms-rescue-2-2026-06-10 --required-claim-ids=RC-120,RC-121 --evidence-plan=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-cms-rescue-2-2026-06-10/required_evidence_plan.json --workspace-root=/Users/guyhaikov/a2z-workspaces --project-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms --worktree-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-cms-rescue-2-2026-06-10/worktree
```

### Q1 Context Packet
- **requirement_ids:** R-FROM-T40
- **source_context_ids:** SCTX-096
- **goal_classes:** api
- **must_use_files:**
  - `SCTX-096` — required context for archetype ralph_target_scaffold
- **must_not_do:**
  - do not weaken acceptance criteria to make tests pass
- **definition_of_done:**
  - vitest: article slug -> 301 /article/<slug>
  - vitest: page slug -> full render; content_html raw leak = 0
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
- `acceptance-tests/T40-syntactic.sh`

## Story T41: [F2] GEO checklist conformance
- Category: api
- Target Files: api/src/public/templates/jsonld-article.ts, api/src/public/templates/jsonld-home-category-page.ts, api/src/public/templates/seo-head.ts, api/test/json-ld-article.test.ts
- AC ids: T41.AC1, T41.AC2, T41.AC3
- RC ids: RC-122, RC-123, RC-124

### Test Bindings (post-implementation deterministic checks)
- T41.AC1 (test_file) — file: `api/test/json-ld-article.test.ts` (exists at base: yes)
- T41.AC2 (test_file) — file: `api/test/json-ld-article.test.ts` (exists at base: yes)
- T41.AC3 (test_file) — file: `api/test/json-ld-article.test.ts` (exists at base: yes)

### Evidence Routes After Implementation
Per-story actionable: RC-122, RC-123, RC-124. Deferred to ship: none. Skip diagnostic: none.

After committing this story, run via canonical runner:
```
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/a2z-develop/scripts/run_required_evidence_command.py --change-id=kodigital-cms-rescue-2-2026-06-10 --required-claim-ids=RC-122,RC-123,RC-124 --evidence-plan=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-cms-rescue-2-2026-06-10/required_evidence_plan.json --workspace-root=/Users/guyhaikov/a2z-workspaces --project-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms --worktree-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-cms-rescue-2-2026-06-10/worktree
```

### Q1 Context Packet
- **requirement_ids:** R-FROM-T41
- **source_context_ids:** SCTX-101, SCTX-102, SCTX-104, SCTX-127
- **goal_classes:** api
- **must_use_files:**
  - `SCTX-101` — required context for archetype ralph_target_scaffold
  - `SCTX-102` — required context for archetype ralph_target_scaffold
  - `SCTX-104` — required context for archetype ralph_target_scaffold
  - `SCTX-127` — required context for archetype ralph_target_scaffold
- **must_not_do:**
  - do not weaken acceptance criteria to make tests pass
- **definition_of_done:**
  - vitest: author + publisher + datePublished + dateModified
  - vitest: FAQPage only when faqs non-empty
  - vitest: BreadcrumbList + canonical-host
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
- `acceptance-tests/T41-syntactic.sh`

## Story T42: [F3] Performance re-assert
- Category: ui
- Target Files: api/test/public-image-attrs.test.ts, api/test/public-ad-slots.test.ts, api/src/public/assets/public-css.ts, api/src/public/templates/public.css.ts
- AC ids: T42.AC1, T42.AC2, T42.AC3
- RC ids: RC-125, RC-126, RC-127

### Test Bindings (post-implementation deterministic checks)
- T42.AC1 (test_file) — file: `api/test/public-image-attrs.test.ts` (exists at base: yes)
- T42.AC3 (test_file) — file: `api/test/public-js-contract.test.ts` (test file does NOT exist at base — Ralph must CREATE it)

### Evidence Routes After Implementation
Per-story actionable: RC-125, RC-126, RC-127. Deferred to ship: none. Skip diagnostic: none.

After committing this story, run via canonical runner:
```
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/a2z-develop/scripts/run_required_evidence_command.py --change-id=kodigital-cms-rescue-2-2026-06-10 --required-claim-ids=RC-125,RC-126,RC-127 --evidence-plan=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-cms-rescue-2-2026-06-10/required_evidence_plan.json --workspace-root=/Users/guyhaikov/a2z-workspaces --project-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms --worktree-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-cms-rescue-2-2026-06-10/worktree
```

### Q1 Context Packet
- **requirement_ids:** R-FROM-T42
- **source_context_ids:** SCTX-092, SCTX-103, SCTX-131, SCTX-132
- **goal_classes:** api
- **must_use_files:**
  - `SCTX-092` — required context for archetype ralph_target_scaffold
  - `SCTX-103` — required context for archetype ralph_target_scaffold
  - `SCTX-131` — required context for archetype ralph_target_scaffold
  - `SCTX-132` — required context for archetype ralph_target_scaffold
- **must_not_do:**
  - do not weaken acceptance criteria to make tests pass
- **definition_of_done:**
  - vitest: hero eager+high; below-fold lazy
  - ad-slot dims in both css files
  - vitest public-js-contract: < 6KB
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
- `acceptance-tests/T42-syntactic.sh`

## Story T43: [F4] Cache re-verify
- Category: api
- AC ids: T43.AC1, T43.AC2
- RC ids: RC-128, RC-129

### Test Bindings (post-implementation deterministic checks)
- T43.AC1 (test_file) — file: `api/test/cache.test.ts` (exists at base: yes)

### Evidence Routes After Implementation
Per-story actionable: RC-128, RC-129. Deferred to ship: none. Skip diagnostic: none.

After committing this story, run via canonical runner:
```
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/a2z-develop/scripts/run_required_evidence_command.py --change-id=kodigital-cms-rescue-2-2026-06-10 --required-claim-ids=RC-128,RC-129 --evidence-plan=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-cms-rescue-2-2026-06-10/required_evidence_plan.json --workspace-root=/Users/guyhaikov/a2z-workspaces --project-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms --worktree-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-cms-rescue-2-2026-06-10/worktree
```

### Q1 Context Packet
- **requirement_ids:** R-FROM-T43
- **source_context_ids:** SCTX-013
- **goal_classes:** api
- **must_use_files:**
  - `SCTX-013` — required context for archetype fetch_mock
- **must_not_do:**
  - do not weaken acceptance criteria to make tests pass
- **definition_of_done:**
  - vitest: ETag + 304 + KV warm-path green
  - htmlKey(siteContext.siteId grep >= 1
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
- `acceptance-tests/T43-syntactic.sh`

## Story T44: [F5] Sitemap/feeds URL audit
- Category: api
- Target Files: api/src/public/sitemap.ts, api/src/public/feeds.ts, api/test/router-sitemap-feed-cache.test.ts
- AC ids: T44.AC1, T44.AC2
- RC ids: RC-130, RC-131

### Test Bindings (post-implementation deterministic checks)
- T44.AC1 (test_file) — file: `api/test/router-sitemap-feed-cache.test.ts` (exists at base: yes)
- T44.AC2 (test_file) — file: `api/test/router-sitemap-feed-cache.test.ts` (exists at base: yes)

### Evidence Routes After Implementation
Per-story actionable: RC-130, RC-131. Deferred to ship: none. Skip diagnostic: none.

After committing this story, run via canonical runner:
```
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/a2z-develop/scripts/run_required_evidence_command.py --change-id=kodigital-cms-rescue-2-2026-06-10 --required-claim-ids=RC-130,RC-131 --evidence-plan=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-cms-rescue-2-2026-06-10/required_evidence_plan.json --workspace-root=/Users/guyhaikov/a2z-workspaces --project-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms --worktree-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-cms-rescue-2-2026-06-10/worktree
```

### Q1 Context Packet
- **requirement_ids:** R-FROM-T44
- **source_context_ids:** SCTX-013, SCTX-094, SCTX-097, SCTX-140
- **goal_classes:** api
- **must_use_files:**
  - `SCTX-013` — required context for archetype fetch_mock
  - `SCTX-094` — required context for archetype ralph_target_scaffold
  - `SCTX-097` — required context for archetype ralph_target_scaffold
  - `SCTX-140` — required context for archetype ralph_target_scaffold
- **must_not_do:**
  - do not weaken acceptance criteria to make tests pass
- **definition_of_done:**
  - vitest router-sitemap-feed-cache: every article loc contains /article/
  - vitest router-sitemap-feed-cache: feed links use /article/
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
- `acceptance-tests/T44-syntactic.sh`

## Story T45: [G1] seed:local deterministic fixture
- Category: script
- Target Files: api/scripts/db/seed-local.ts, api/package.json, api/test/seed-local-sql.test.ts
- AC ids: T45.AC1, T45.AC2, T45.AC3
- RC ids: RC-132, RC-133, RC-134

### Test Bindings (post-implementation deterministic checks)
- T45.AC2 (test_file) — file: `api/test/seed-local-sql.test.ts` (test file does NOT exist at base — Ralph must CREATE it)

### Evidence Routes After Implementation
Per-story actionable: RC-132, RC-133, RC-134. Deferred to ship: none. Skip diagnostic: none.

After committing this story, run via canonical runner:
```
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/a2z-develop/scripts/run_required_evidence_command.py --change-id=kodigital-cms-rescue-2-2026-06-10 --required-claim-ids=RC-132,RC-133,RC-134 --evidence-plan=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-cms-rescue-2-2026-06-10/required_evidence_plan.json --workspace-root=/Users/guyhaikov/a2z-workspaces --project-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms --worktree-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-cms-rescue-2-2026-06-10/worktree
```

### Q1 Context Packet
- **requirement_ids:** R-FROM-T45
- **source_context_ids:** SCTX-073, SCTX-074, SCTX-141
- **goal_classes:** structural_script
- **must_use_files:**
  - `SCTX-073` — required context for archetype ralph_target_scaffold
  - `SCTX-074` — required context for archetype ralph_target_scaffold
  - `SCTX-141` — required context for archetype ralph_target_scaffold
- **must_not_do:**
  - do not weaken acceptance criteria to make tests pass
- **definition_of_done:**
  - seed:local in package.json = 1
  - vitest: SQL-builder idempotent; all home buckets covered
  - fetch( in seed-local.ts = 0
- **negative_fail_conditions (HARD FAIL):**
  - acceptance criteria pass while user-facing outcome is broken

### Q1 Story Quality Checks (REQUIRED)
Each check whose `required=true` is a Ralph completion gate. A required check that fails BLOCKS the story — do NOT proceed to commit. Global `npm test` is NOT sufficient unless the packet maps it explicitly. For UI/browser stories, grep-on-TS-source is NEVER sufficient — the browser_check command must run Playwright with a class-set or response-status assertion.

| check | required | kind | command | assertion |
|---|---|---|---|---|
| browser | no | - | `-` | - |
| api | no | - | `-` | - |
| db | no | - | `-` | - |
| job | no | - | `-` | - |
| outbound | no | - | `-` | - |

### Acceptance Tests
- `acceptance-tests/T45-syntactic.sh`

## Story T46: [G2] Local preview runbook
- Category: config
- Target Files: docs/local-preview.md
- AC ids: T46.AC1, T46.AC2
- RC ids: RC-135, RC-136

### Evidence Routes After Implementation
Per-story actionable: RC-135, RC-136. Deferred to ship: none. Skip diagnostic: none.

After committing this story, run via canonical runner:
```
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/a2z-develop/scripts/run_required_evidence_command.py --change-id=kodigital-cms-rescue-2-2026-06-10 --required-claim-ids=RC-135,RC-136 --evidence-plan=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-cms-rescue-2-2026-06-10/required_evidence_plan.json --workspace-root=/Users/guyhaikov/a2z-workspaces --project-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms --worktree-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-cms-rescue-2-2026-06-10/worktree
```

### Q1 Context Packet
- **requirement_ids:** R-FROM-T46
- **source_context_ids:** SCTX-144
- **goal_classes:** api
- **must_use_files:**
  - `SCTX-144` — required context for archetype ralph_target_scaffold
- **must_not_do:**
  - do not weaken acceptance criteria to make tests pass
- **definition_of_done:**
  - db:migrate:local + seed:local + wrangler dev >= 3
  - DEV_BYPASS_AUTH + resolveSiteContextFromRequest >= 1
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
- `acceptance-tests/T46-syntactic.sh`

## Story T47: [G3] Draft preview route
- Category: api
- Target Files: api/src/preview/index.ts, api/src/public/router.ts, api/test/preview.test.ts
- AC ids: T47.AC1, T47.AC2
- RC ids: RC-137, RC-138

### Test Bindings (post-implementation deterministic checks)
- T47.AC2 (test_file) — file: `api/test/preview.test.ts` (exists at base: yes)

### Evidence Routes After Implementation
Per-story actionable: RC-137, RC-138. Deferred to ship: none. Skip diagnostic: none.

After committing this story, run via canonical runner:
```
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/a2z-develop/scripts/run_required_evidence_command.py --change-id=kodigital-cms-rescue-2-2026-06-10 --required-claim-ids=RC-137,RC-138 --evidence-plan=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-cms-rescue-2-2026-06-10/required_evidence_plan.json --workspace-root=/Users/guyhaikov/a2z-workspaces --project-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms --worktree-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-cms-rescue-2-2026-06-10/worktree
```

### Q1 Context Packet
- **requirement_ids:** R-FROM-T47
- **source_context_ids:** SCTX-091, SCTX-096, SCTX-130
- **goal_classes:** api, wire_protocol_consistency
- **must_use_files:**
  - `SCTX-091` — required context for archetype ralph_target_scaffold
  - `SCTX-096` — required context for archetype ralph_target_scaffold
  - `SCTX-130` — required context for archetype ralph_target_scaffold
- **must_not_do:**
  - do not rename form field name without updating handler read AND DB column
- **definition_of_done:**
  - Form field name == handler-read field name == DB column name (all match)
  - Preview not yet wired in api/src = 0
  - vitest: X-Robots-Tag: noindex + Cache-Control: no-store; accessAuth gated
- **negative_fail_conditions (HARD FAIL):**
  - form input name does not equal handler-read field name
  - DB column receives wrong value because of field-name mismatch

### Q1 Story Quality Checks (REQUIRED)
Each check whose `required=true` is a Ralph completion gate. A required check that fails BLOCKS the story — do NOT proceed to commit. Global `npm test` is NOT sufficient unless the packet maps it explicitly. For UI/browser stories, grep-on-TS-source is NEVER sufficient — the browser_check command must run Playwright with a class-set or response-status assertion.

| check | required | kind | command | assertion |
|---|---|---|---|---|
| browser | yes | form_input_name_matches_post_field | `grep -c 'name="{field}"' {form_template_path}` | form input name == POST body field == DB column |
| api | yes | curl_or_vitest_response | `cd api && npm test -- --grep '{endpoint}' OR curl http://localhost:8787{route}` | response shape matches interface_contract |
| db | yes | wrangler_d1_select_assert_row | `cd api && npx wrangler d1 execute {db} --local --command "{select_sql}"` | if endpoint has db_effects, SELECT confirms write |
| job | no | - | `-` | - |
| outbound | no | - | `-` | - |

### Acceptance Tests
- `acceptance-tests/T47-syntactic.sh`

## Story T48: [H1] SHIP_HANDOFF.md
- Category: config
- Target Files: SHIP_HANDOFF.md
- AC ids: T48.AC1, T48.AC2, T48.AC3
- RC ids: RC-139, RC-140, RC-141, RC-146

### Evidence Routes After Implementation
Per-story actionable: RC-139. Deferred to ship: RC-140, RC-141. Skip diagnostic: RC-146.

After committing this story, run via canonical runner:
```
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/a2z-develop/scripts/run_required_evidence_command.py --change-id=kodigital-cms-rescue-2-2026-06-10 --required-claim-ids=RC-139 --evidence-plan=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-cms-rescue-2-2026-06-10/required_evidence_plan.json --workspace-root=/Users/guyhaikov/a2z-workspaces --project-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms --worktree-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/kodigital-cms-rescue-2-2026-06-10/worktree
```

### Q1 Context Packet
- **requirement_ids:** R-FROM-T48
- **source_context_ids:** SCTX-072
- **goal_classes:** api
- **must_use_files:**
  - `SCTX-072` — required context for archetype ralph_target_scaffold
- **must_not_do:**
  - do not weaken acceptance criteria to make tests pass
- **definition_of_done:**
  - backup + wipe + recreate + preflight commands listed
  - theplaynest.net >= 1; backup >= 1; CF Access service-token documented
  - Playwright + design-contract + Lighthouse + post-deploy >= 3
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
- `acceptance-tests/T48-syntactic.sh`

## Story T49: [H2] manualQA.md
- Category: config
- Target Files: manualQA.md
- AC ids: T49.AC1, T49.AC2
- RC ids: RC-142, RC-143, RC-146

### Q1 Context Packet
- **requirement_ids:** R-FROM-T49
- **source_context_ids:** SCTX-145
- **goal_classes:** api
- **must_use_files:**
  - `SCTX-145` — required context for archetype ralph_target_scaffold
- **must_not_do:**
  - do not weaken acceptance criteria to make tests pass
- **definition_of_done:**
  - MQA- scenario count >= 12
  - design-contract.md + legacy technical spec references >= 2
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
- `acceptance-tests/T49-syntactic.sh`

