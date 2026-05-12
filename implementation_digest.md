# Implementation Digest — change kodigital-homepages-cms-phase3-qafixes-2026-05-11

Mode: field_sensitive_with_ui  |  Profiles: api_contract, db_schema, evidence_route_strict, field_sensitive, ui_conversion  |  Mission-global RCs: 1

## RED LINE — typed contract authority
The fields, wire names, endpoint paths, and design specs below are AUTHORITATIVE. Implement EXACTLY as specified. Field names in HTTP request bodies / redirect URLs / cookies are the WIRE name (right column), NOT the canonical name. Do not invent field names; do not paraphrase typed contracts.

## RED-LINE substitutions
- field_contract.fields.forbidden_substitutes for `brand_text` — (?i)theiwise (TheIWise production brand MUST NOT leak into KoDigital admin per PART 22 hard-fail (forbidden_substitutes in main_goal).); source SP-CONTEXT-001
- design_contract.forbidden_substitutes — Phase 1 admin shell placeholder rendered at /admin (PART 22 hard-fail #1 — GET /admin HTML MUST NOT contain string 'Phase 1 admin shell' (mission_draft.main_goal.failure_criterion(a)).); source SP-CONTEXT-001
- design_contract.forbidden_substitutes — renderShell placeholder output anywhere on active /admin routes (main_goal.forbidden_substitutes[0] — renderShell may exist in code but MUST NOT be mapped to any active /admin route after T12 rewire (T12-AC3).); source SP-CONTEXT-001
- design_contract.forbidden_substitutes — Raw HTML view without .admin-layout/.admin-sidebar classes on any /admin route (PART 22 hard-fail #2 — admin routes MUST render through adminLayout, not standalone raw HTML.); source SP-CONTEXT-001
- design_contract.forbidden_substitutes — method='dialog' only modal with no POST handler on Create-Site (PART 22 hard-fail #4/#5 — modal MUST issue real fetch POST /api/admin/sites observable by Playwright waitForRequest.); source SP-CONTEXT-001
- design_contract.forbidden_substitutes — TheIWise brand text visible at /admin (main_goal.forbidden_substitutes[4] + T2-AC4 grep -ci 'TheIWise' expected 0.); source SP-CONTEXT-001
- design_contract.forbidden_substitutes — Psychic Quiz nav entry in sidebar (main_goal.forbidden_substitutes[5] + T2-AC5 grep -qi 'psychic' negated.); source SP-CONTEXT-001
- design_contract.forbidden_substitutes — Public content domain /admin returns admin HTML or leaks cms.kodigital.app (PART 22 hard-fail (failure_criterion g) — protected-domain denylist must keep /admin off public hosts; T20 spec asserts 404 + no-store + noindex + no body leak.); source SP-NEW-002
- mission_spec.main_goal.forbidden_substitutes — renderShell placeholder output (main_goal_forbidden_substitute)
- mission_spec.main_goal.forbidden_substitutes — Phase 1 admin shell string in /admin HTML (main_goal_forbidden_substitute)
- mission_spec.main_goal.forbidden_substitutes — raw HTML view without .admin-layout/.admin-sidebar classes (main_goal_forbidden_substitute)
- mission_spec.main_goal.forbidden_substitutes — method=dialog only modal with no POST handler (main_goal_forbidden_substitute)
- mission_spec.main_goal.forbidden_substitutes — TheIWise brand text in /admin (main_goal_forbidden_substitute)
- mission_spec.main_goal.forbidden_substitutes — Psychic Quiz nav entry (main_goal_forbidden_substitute)

## Mission-wide design constraints (ui_conversion)
- Route: `/admin`
- Conversion goal: Render the legacy CMS admin shell across all 9 admin routes so that operators reach Domains, Articles, Pages, Media, Categories, Tags, AI Presets, Settings without ever seeing a Phase 1 placeholder, and so Create-Site, Edit-Article, and About-page provisioning complete end-to-end with browser-observable POSTs.
- Viewport: 1280px max scrollWidth 1280px
- Viewport: 1440px max scrollWidth 1440px
- Tone: Operator-facing admin UI: terse, action-oriented labels (no marketing copy).
- Tone: KoDigital brand only — TheIWise / Psychic Quiz strings forbidden anywhere in admin templates.
- A11y: Create-Site modal: keyboard parity (Escape closes; focus trap on open) per accessibility.md (click-to-dismiss → keyboard parity).
- A11y: Provisioning polling panel: role='status' + aria-live='polite' per accessibility.md polling-UI rule.
- A11y: Sidebar nav links: each renders as <a> with discernible label; no icon-only nav-items without aria-label.
- A11y: Form inputs across all admin forms: label or aria-label per accessibility.md form-inputs rule.

## Mission-global required claims
- RC-001 (production_pending, production_pending, action=SKIP_DEFERRED_TO_SHIP)

## Story T1: Add migration 0005 — site_id columns + page_type + homepage fields + per-site unique slug indexes
- Category: migration
- Target Files: api/migrations/0006_phase3r_admin_site_aware_content.sql
- AC ids: T1-AC1, T1-AC2, T1-AC3, T1-AC4, T1-AC5, T1-AC6
- RC ids: RC-002, RC-003, RC-004, RC-005, RC-006, RC-007

### Test Bindings (post-implementation deterministic checks)
- T1-AC1 (command) — `grep -c 'ALTER TABLE articles ADD COLUMN site_id' api/migrations/0006_phase3r_admin_site_aware_content.sql` (expects 1, parser parse_grep_count, fields: )
- T1-AC2 (command) — `grep -c 'ALTER TABLE pages ADD COLUMN site_id' api/migrations/0006_phase3r_admin_site_aware_content.sql` (expects 1, parser parse_grep_count, fields: )
- T1-AC3 (command) — `grep -c 'ALTER TABLE pages ADD COLUMN page_type' api/migrations/0006_phase3r_admin_site_aware_content.sql` (expects 1, parser parse_grep_count, fields: )
- T1-AC4 (command) — `grep -cE 'CREATE UNIQUE INDEX[[:space:]]+(IF NOT EXISTS[[:space:]]+)?idx_articles_site_slug' api/migrations/0006_phase3r_admin_site_aware_content.sql` (expects 1, parser parse_grep_count, fields: )
- T1-AC5 (command) — `grep -cE 'CREATE UNIQUE INDEX[[:space:]]+(IF NOT EXISTS[[:space:]]+)?idx_pages_site_slug' api/migrations/0006_phase3r_admin_site_aware_content.sql` (expects 1, parser parse_grep_count, fields: )
- T1-AC6 (test_name_regex) — name regex: `^migration 0005 per-site slug uniqueness$`

### Evidence Routes After Implementation
Per-story actionable: RC-002, RC-003, RC-004, RC-005, RC-006. Deferred to ship: RC-007. Skip diagnostic: none.

After committing this story, run via canonical runner:
```
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/a2z-develop/scripts/run_required_evidence_command.py --change-id=kodigital-homepages-cms-phase3-qafixes-2026-05-11 --required-claim-ids=RC-002,RC-003,RC-004,RC-005,RC-006 --evidence-plan=/Users/guyhaikov/a2z-workspaces/.a2z/mission-state/kodigital-homepages-cms-phase3-qafixes-2026-05-11/required_evidence_plan.json --workspace-root=/Users/guyhaikov/a2z-workspaces --project-root=/Users/guyhaikov/a2z-workspaces --worktree-root="$WORKDIR"
```

### Acceptance Tests
- `acceptance-tests/T1-syntactic.sh`

## Story T2: Port legacy admin layout template -- adminLayout with KoDigital CMS brand and 9-entry nav (Domains added, Psychic Quiz removed)
- Category: ui
- Target Files: api/src/admin/templates/layout.ts
- AC ids: T2-AC1, T2-AC2, T2-AC3, T2-AC4, T2-AC5, T2-AC6
- RC ids: RC-008, RC-009, RC-010, RC-011, RC-012, RC-013

### Design slice (story-linked content_blocks)
- sidebar.nav.entries (value_prop): Sidebar nav exactly 9 entries in order: Dashboard, Domains, Articles, Pages, Med

### Test Bindings (post-implementation deterministic checks)
- T2-AC1 (command) — `grep -c 'export function adminLayout' api/src/admin/templates/layout.ts` (expects 1, parser parse_grep_count, fields: )
- T2-AC2 (command) — `grep -c 'admin-layout' api/src/admin/templates/layout.ts` (expects 1, parser parse_grep_count, fields: )
- T2-AC3 (command) — `grep -c 'KoDigital CMS' api/src/admin/templates/layout.ts` (expects 1, parser parse_grep_count, fields: )
- T2-AC4 (command) — `grep -ci 'TheIWise' api/src/admin/templates/layout.ts` (expects 0, parser parse_grep_count, fields: )
- T2-AC5 (command) — `grep -c 'Domains' api/src/admin/templates/layout.ts` (expects 1, parser parse_grep_count, fields: )
- T2-AC6 (test_name_regex) — name regex: `^adminLayout renders 9-entry nav with active state$`

### Evidence Routes After Implementation
Per-story actionable: RC-008, RC-009, RC-010, RC-011, RC-012. Deferred to ship: RC-013. Skip diagnostic: none.

After committing this story, run via canonical runner:
```
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/a2z-develop/scripts/run_required_evidence_command.py --change-id=kodigital-homepages-cms-phase3-qafixes-2026-05-11 --required-claim-ids=RC-008,RC-009,RC-010,RC-011,RC-012 --evidence-plan=/Users/guyhaikov/a2z-workspaces/.a2z/mission-state/kodigital-homepages-cms-phase3-qafixes-2026-05-11/required_evidence_plan.json --workspace-root=/Users/guyhaikov/a2z-workspaces --project-root=/Users/guyhaikov/a2z-workspaces --worktree-root="$WORKDIR"
```

### Acceptance Tests
- `acceptance-tests/T2-syntactic.sh`

## Story T3: Port dashboardPage template -- stats-grid (7 cards) + Recent Articles card + Quick Actions card
- Category: ui
- Target Files: api/src/admin/templates/dashboard.ts
- AC ids: T3-AC1, T3-AC2, T3-AC3, T3-AC4, T3-AC5
- RC ids: RC-014, RC-015, RC-016, RC-017, RC-018

### Design slice (story-linked content_blocks)
- sidebar.nav.entries (value_prop): Sidebar nav exactly 9 entries in order: Dashboard, Domains, Articles, Pages, Med

### Test Bindings (post-implementation deterministic checks)
- T3-AC1 (command) — `grep -c 'export function dashboardPage' api/src/admin/templates/dashboard.ts` (expects 1, parser parse_grep_count, fields: )
- T3-AC2 (command) — `grep -c 'Total Articles' api/src/admin/templates/dashboard.ts` (expects 1, parser parse_grep_count, fields: )
- T3-AC3 (command) — `grep -c 'Recent Articles' api/src/admin/templates/dashboard.ts` (expects 1, parser parse_grep_count, fields: )
- T3-AC4 (command) — `grep -c '+ New Site' api/src/admin/templates/dashboard.ts` (expects 1, parser parse_grep_count, fields: )
- T3-AC5 (test_name_regex) — name regex: `^dashboardPage renders stats-grid with sites stat$`

### Evidence Routes After Implementation
Per-story actionable: RC-014, RC-015, RC-016, RC-017. Deferred to ship: RC-018. Skip diagnostic: none.

After committing this story, run via canonical runner:
```
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/a2z-develop/scripts/run_required_evidence_command.py --change-id=kodigital-homepages-cms-phase3-qafixes-2026-05-11 --required-claim-ids=RC-014,RC-015,RC-016,RC-017 --evidence-plan=/Users/guyhaikov/a2z-workspaces/.a2z/mission-state/kodigital-homepages-cms-phase3-qafixes-2026-05-11/required_evidence_plan.json --workspace-root=/Users/guyhaikov/a2z-workspaces --project-root=/Users/guyhaikov/a2z-workspaces --worktree-root="$WORKDIR"
```

### Acceptance Tests
- `acceptance-tests/T3-syntactic.sh`

## Story T4: Create domains.ts template -- 9-col table + toolbar with + New Site + Create Site modal styled with legacy form classes
- Category: ui
- Target Files: api/src/admin/templates/domains.ts
- AC ids: T4-AC1, T4-AC2, T4-AC3, T4-AC4, T4-AC5, T4-AC6
- RC ids: RC-019, RC-020, RC-021, RC-022, RC-023, RC-024, RC-109

### Design slice (story-linked content_blocks)
- domains.create_site.modal (cta): Domains page Create-Site modal: trigger '+ New Site' button → modal with form fi

### Test Bindings (post-implementation deterministic checks)
- T4-AC1 (command) — `grep -c 'export function domainsPage' api/src/admin/templates/domains.ts` (expects 1, parser parse_grep_count, fields: )
- T4-AC2 (command) — `grep -c 'Last provisioned' api/src/admin/templates/domains.ts` (expects 1, parser parse_grep_count, fields: )
- T4-AC3 (command) — `grep -c 'class="modal' api/src/admin/templates/domains.ts` (expects 1, parser parse_grep_count, fields: )
- T4-AC4 (command) — `grep -c 'Create site' api/src/admin/templates/domains.ts` (expects 1, parser parse_grep_count, fields: )
- T4-AC5 (command) — `grep -cE '(const |let |=>)' api/src/admin/templates/domains.ts` (expects 0, parser parse_grep_count, fields: )
- T4-AC6 (test_file) — file: `api/test-ui/domains-create-site.spec.ts` (test file does NOT exist at base — Ralph must CREATE it)

### Evidence Routes After Implementation
Per-story actionable: RC-019, RC-020, RC-021, RC-022, RC-023. Deferred to ship: RC-024, RC-109. Skip diagnostic: none.

After committing this story, run via canonical runner:
```
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/a2z-develop/scripts/run_required_evidence_command.py --change-id=kodigital-homepages-cms-phase3-qafixes-2026-05-11 --required-claim-ids=RC-019,RC-020,RC-021,RC-022,RC-023 --evidence-plan=/Users/guyhaikov/a2z-workspaces/.a2z/mission-state/kodigital-homepages-cms-phase3-qafixes-2026-05-11/required_evidence_plan.json --workspace-root=/Users/guyhaikov/a2z-workspaces --project-root=/Users/guyhaikov/a2z-workspaces --worktree-root="$WORKDIR"
```

### Acceptance Tests
- `acceptance-tests/T4-syntactic.sh`

## Story T5: Port articlesListPage + articleFormPage templates -- 8-col table, 8 filters, site-required form with homepage fields
- Category: ui
- Target Files: api/src/admin/templates/articles.ts
- AC ids: T5-AC1, T5-AC2, T5-AC3, T5-AC4, T5-AC5
- RC ids: RC-025, RC-026, RC-027, RC-028, RC-029

### Test Bindings (post-implementation deterministic checks)
- T5-AC1 (command) — `grep -cE 'export function (articlesListPage|articleFormPage)' api/src/admin/templates/articles.ts` (expects 2, parser parse_grep_count, fields: )
- T5-AC2 (command) — `grep -c 'name="site"' api/src/admin/templates/articles.ts` (expects 1, parser parse_grep_count, fields: )
- T5-AC3 (command) — `grep -c 'Homepage section' api/src/admin/templates/articles.ts` (expects 1, parser parse_grep_count, fields: )
- T5-AC4 (command) — `grep -c 'name="homepage_section"' api/src/admin/templates/articles.ts` (expects 1, parser parse_grep_count, fields: )
- T5-AC5 (test_name_regex) — name regex: `^articleFormPage submits PATCH on edit and POST on new$`

### Evidence Routes After Implementation
Per-story actionable: RC-025, RC-026, RC-027, RC-028. Deferred to ship: RC-029. Skip diagnostic: none.

After committing this story, run via canonical runner:
```
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/a2z-develop/scripts/run_required_evidence_command.py --change-id=kodigital-homepages-cms-phase3-qafixes-2026-05-11 --required-claim-ids=RC-025,RC-026,RC-027,RC-028 --evidence-plan=/Users/guyhaikov/a2z-workspaces/.a2z/mission-state/kodigital-homepages-cms-phase3-qafixes-2026-05-11/required_evidence_plan.json --workspace-root=/Users/guyhaikov/a2z-workspaces --project-root=/Users/guyhaikov/a2z-workspaces --worktree-root="$WORKDIR"
```

### Acceptance Tests
- `acceptance-tests/T5-syntactic.sh`

## Story T6: Port pagesListPage + pageFormPage templates -- Site filter, Page type filter, Site/Global column, Global template badge for legal
- Category: ui
- Target Files: api/src/admin/templates/pages.ts
- AC ids: T6-AC1, T6-AC2, T6-AC3, T6-AC4, T6-AC5
- RC ids: RC-030, RC-031, RC-032, RC-033, RC-034

### Test Bindings (post-implementation deterministic checks)
- T6-AC1 (command) — `grep -cE 'export function (pagesListPage|pageFormPage)' api/src/admin/templates/pages.ts` (expects 2, parser parse_grep_count, fields: )
- T6-AC2 (command) — `grep -c 'name="page_type"' api/src/admin/templates/pages.ts` (expects 1, parser parse_grep_count, fields: )
- T6-AC3 (command) — `grep -c 'Footer' api/src/admin/templates/pages.ts` (expects 1, parser parse_grep_count, fields: )
- T6-AC4 (command) — `grep -c 'Global template' api/src/admin/templates/pages.ts` (expects 1, parser parse_grep_count, fields: )
- T6-AC5 (test_name_regex) — name regex: `^pageFormPage requires site_id only for about pages$`

### Evidence Routes After Implementation
Per-story actionable: RC-030, RC-031, RC-032, RC-033. Deferred to ship: RC-034. Skip diagnostic: none.

After committing this story, run via canonical runner:
```
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/a2z-develop/scripts/run_required_evidence_command.py --change-id=kodigital-homepages-cms-phase3-qafixes-2026-05-11 --required-claim-ids=RC-030,RC-031,RC-032,RC-033 --evidence-plan=/Users/guyhaikov/a2z-workspaces/.a2z/mission-state/kodigital-homepages-cms-phase3-qafixes-2026-05-11/required_evidence_plan.json --workspace-root=/Users/guyhaikov/a2z-workspaces --project-root=/Users/guyhaikov/a2z-workspaces --worktree-root="$WORKDIR"
```

### Acceptance Tests
- `acceptance-tests/T6-syntactic.sh`

## Story T7: Port categories.ts, tags.ts, media.ts, settings.ts, presets.ts templates with site-aware filters
- Category: ui
- Target Files: api/src/admin/templates/categories.ts, api/src/admin/templates/tags.ts, api/src/admin/templates/media.ts, api/src/admin/templates/settings.ts, api/src/admin/templates/presets.ts
- AC ids: T7-AC1, T7-AC2, T7-AC3, T7-AC4, T7-AC5, T7-AC6
- RC ids: RC-035, RC-036, RC-037, RC-038, RC-039, RC-040

### Test Bindings (post-implementation deterministic checks)
- T7-AC1 (command) — `grep -c 'export function categoriesListPage' api/src/admin/templates/categories.ts` (expects 1, parser parse_grep_count, fields: )
- T7-AC2 (command) — `grep -c 'export function tagsListPage' api/src/admin/templates/tags.ts` (expects 1, parser parse_grep_count, fields: )
- T7-AC3 (command) — `grep -c 'export function mediaListPage' api/src/admin/templates/media.ts` (expects 1, parser parse_grep_count, fields: )
- T7-AC4 (command) — `grep -c 'export function settingsPage' api/src/admin/templates/settings.ts` (expects 1, parser parse_grep_count, fields: )
- T7-AC5 (command) — `grep -c 'export function presetsListPage' api/src/admin/templates/presets.ts` (expects 1, parser parse_grep_count, fields: )
- T7-AC6 (command) — `grep -ci 'theiwise' api/src/admin/templates/settings.ts` (expects 0, parser parse_grep_count, fields: )

### Evidence Routes After Implementation
Per-story actionable: RC-035, RC-036, RC-037, RC-038, RC-039, RC-040. Deferred to ship: none. Skip diagnostic: none.

After committing this story, run via canonical runner:
```
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/a2z-develop/scripts/run_required_evidence_command.py --change-id=kodigital-homepages-cms-phase3-qafixes-2026-05-11 --required-claim-ids=RC-035,RC-036,RC-037,RC-038,RC-039,RC-040 --evidence-plan=/Users/guyhaikov/a2z-workspaces/.a2z/mission-state/kodigital-homepages-cms-phase3-qafixes-2026-05-11/required_evidence_plan.json --workspace-root=/Users/guyhaikov/a2z-workspaces --project-root=/Users/guyhaikov/a2z-workspaces --worktree-root="$WORKDIR"
```

### Acceptance Tests
- `acceptance-tests/T7-syntactic.sh`

## Story T8: Port legacy editor (editor-scripts + index) into article + page form templates
- Category: ui
- Target Files: api/src/editor/index.ts, api/src/editor/editor-scripts.ts
- AC ids: T8-AC1, T8-AC2, T8-AC3, T8-AC4, T8-AC5
- RC ids: RC-041, RC-042, RC-043, RC-044, RC-045

### Test Bindings (post-implementation deterministic checks)
- T8-AC1 (command) — `grep -cE 'class BlockEditor|export function createEditor' api/src/editor/index.ts` (expects 1, parser parse_grep_count, fields: )
- T8-AC2 (command) — `grep -c 'export function editorScripts' api/src/editor/editor-scripts.ts` (expects 1, parser parse_grep_count, fields: )
- T8-AC3 (command) — `grep -c 'paragraph' api/src/editor/editor-scripts.ts` (expects 1, parser parse_grep_count, fields: )
- T8-AC4 (command) — `grep -c 'editorScripts' api/src/admin/templates/articles.ts` (expects 1, parser parse_grep_count, fields: )
- T8-AC5 (test_file) — file: `api/test-ui/admin-ux-parity.spec.ts` (test file does NOT exist at base — Ralph must CREATE it)

### Evidence Routes After Implementation
Per-story actionable: RC-041, RC-042, RC-043, RC-044. Deferred to ship: RC-045. Skip diagnostic: none.

After committing this story, run via canonical runner:
```
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/a2z-develop/scripts/run_required_evidence_command.py --change-id=kodigital-homepages-cms-phase3-qafixes-2026-05-11 --required-claim-ids=RC-041,RC-042,RC-043,RC-044 --evidence-plan=/Users/guyhaikov/a2z-workspaces/.a2z/mission-state/kodigital-homepages-cms-phase3-qafixes-2026-05-11/required_evidence_plan.json --workspace-root=/Users/guyhaikov/a2z-workspaces --project-root=/Users/guyhaikov/a2z-workspaces --worktree-root="$WORKDIR"
```

### Acceptance Tests
- `acceptance-tests/T8-syntactic.sh`

## Story T9: Create templates barrel index.ts re-exporting all admin templates
- Category: ui
- Target Files: api/src/admin/templates/index.ts
- AC ids: T9-AC1
- RC ids: RC-046

### Test Bindings (post-implementation deterministic checks)
- T9-AC1 (command) — `grep -c './layout' api/src/admin/templates/index.ts` (expects 1, parser parse_grep_count, fields: )

### Evidence Routes After Implementation
Per-story actionable: RC-046. Deferred to ship: none. Skip diagnostic: none.

After committing this story, run via canonical runner:
```
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/a2z-develop/scripts/run_required_evidence_command.py --change-id=kodigital-homepages-cms-phase3-qafixes-2026-05-11 --required-claim-ids=RC-046 --evidence-plan=/Users/guyhaikov/a2z-workspaces/.a2z/mission-state/kodigital-homepages-cms-phase3-qafixes-2026-05-11/required_evidence_plan.json --workspace-root=/Users/guyhaikov/a2z-workspaces --project-root=/Users/guyhaikov/a2z-workspaces --worktree-root="$WORKDIR"
```

### Acceptance Tests
- `acceptance-tests/T9-syntactic.sh`

## Story T10: Create api/src/admin/ui.ts -- admin UI router mirroring legacy pattern, server-rendered HTML via templates, protected by accessAuth upstream
- Category: api
- Target Files: api/src/admin/ui.ts
- AC ids: T10-AC1, T10-AC2, T10-AC3, T10-AC4, T10-AC5
- RC ids: RC-047, RC-048, RC-049, RC-050, RC-051

### Design slice (story-linked content_blocks)
- sidebar.nav.entries (value_prop): Sidebar nav exactly 9 entries in order: Dashboard, Domains, Articles, Pages, Med
- admin.layout.classes (value_prop): adminLayout() emits the 33-class CSS contract: admin-layout, admin-sidebar, side

### Test Bindings (post-implementation deterministic checks)
- T10-AC1 (command) — `grep -cE 'export (const|default) adminUi' api/src/admin/ui.ts` (expects 1, parser parse_grep_count, fields: )
- T10-AC2 (command) — `grep -c "adminUi.get('/admin/domains'" api/src/admin/ui.ts` (expects 1, parser parse_grep_count, fields: )
- T10-AC3 (command) — `grep -cE '/admin/articles/:id/edit' api/src/admin/ui.ts` (expects 1, parser parse_grep_count, fields: )
- T10-AC4 (command) — `grep -c "from './templates'" api/src/admin/ui.ts` (expects 1, parser parse_grep_count, fields: )
- T10-AC5 (test_file) — file: `api/test-ui/admin-ux-parity.spec.ts` (test file does NOT exist at base — Ralph must CREATE it)

### Evidence Routes After Implementation
Per-story actionable: RC-047, RC-048, RC-049, RC-050. Deferred to ship: RC-051. Skip diagnostic: none.

After committing this story, run via canonical runner:
```
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/a2z-develop/scripts/run_required_evidence_command.py --change-id=kodigital-homepages-cms-phase3-qafixes-2026-05-11 --required-claim-ids=RC-047,RC-048,RC-049,RC-050 --evidence-plan=/Users/guyhaikov/a2z-workspaces/.a2z/mission-state/kodigital-homepages-cms-phase3-qafixes-2026-05-11/required_evidence_plan.json --workspace-root=/Users/guyhaikov/a2z-workspaces --project-root=/Users/guyhaikov/a2z-workspaces --worktree-root="$WORKDIR"
```

### Acceptance Tests
- `acceptance-tests/T10-syntactic.sh`

## Story T11: Create api/src/admin/data.ts -- schema-aware data helpers for admin views
- Category: api
- Target Files: api/src/admin/data.ts
- AC ids: T11-AC1, T11-AC2, T11-AC3, T11-AC4, T11-AC5, T11-AC6
- RC ids: RC-052, RC-053, RC-054, RC-055, RC-056, RC-057

### Design slice (story-linked content_blocks)
- admin.layout.classes (value_prop): adminLayout() emits the 33-class CSS contract: admin-layout, admin-sidebar, side

### Test Bindings (post-implementation deterministic checks)
- T11-AC1 (command) — `grep -c 'export.*function getDashboardStats\|export.*async function getDashboardStats' api/src/admin/data.ts` (expects 1, parser parse_grep_count, fields: )
- T11-AC2 (command) — `grep -c 'FROM domains' api/src/admin/data.ts` (expects 1, parser parse_grep_count, fields: )
- T11-AC3 (command) — `grep -cE 'SELECT[^;]*\bdomain\b[^;]*FROM domains' api/src/admin/data.ts` (expects 0, parser parse_grep_count, fields: )
- T11-AC4 (command) — `grep -c '44c73f76-6ed5-4b26-b442-6c2044326c4d' api/src/admin/data.ts` (expects 0, parser parse_grep_count, fields: )
- T11-AC5 (command) — `grep -cE 'settings_version|last_provisioned_at|vertical_slug' api/src/admin/data.ts` (expects 3, parser parse_grep_count, fields: )
- T11-AC6 (test_name_regex) — name regex: `^getDashboardStats returns site/article/page counts$`

### Evidence Routes After Implementation
Per-story actionable: RC-052, RC-053, RC-054, RC-055, RC-056. Deferred to ship: RC-057. Skip diagnostic: none.

After committing this story, run via canonical runner:
```
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/a2z-develop/scripts/run_required_evidence_command.py --change-id=kodigital-homepages-cms-phase3-qafixes-2026-05-11 --required-claim-ids=RC-052,RC-053,RC-054,RC-055,RC-056 --evidence-plan=/Users/guyhaikov/a2z-workspaces/.a2z/mission-state/kodigital-homepages-cms-phase3-qafixes-2026-05-11/required_evidence_plan.json --workspace-root=/Users/guyhaikov/a2z-workspaces --project-root=/Users/guyhaikov/a2z-workspaces --worktree-root="$WORKDIR"
```

### Acceptance Tests
- `acceptance-tests/T11-syntactic.sh`

## Story T12: Modify api/src/admin/router.ts -- mount adminUi for /admin routes, remove renderShell from active /admin paths, preserve accessAuth + sub-routers
- Category: api
- Target Files: api/src/admin/router.ts
- AC ids: T12-AC1, T12-AC2, T12-AC3, T12-AC4, T12-AC5, T12-AC6
- RC ids: RC-058, RC-059, RC-060, RC-061, RC-062, RC-063

### Design slice (story-linked content_blocks)
- sidebar.nav.entries (value_prop): Sidebar nav exactly 9 entries in order: Dashboard, Domains, Articles, Pages, Med
- admin.layout.classes (value_prop): adminLayout() emits the 33-class CSS contract: admin-layout, admin-sidebar, side

### Test Bindings (post-implementation deterministic checks)
- T12-AC1 (command) — `grep -c "from './ui'" api/src/admin/router.ts` (expects 1, parser parse_grep_count, fields: )
- T12-AC2 (command) — `grep -cE '\.route\([^,]+, adminUi' api/src/admin/router.ts` (expects 1, parser parse_grep_count, fields: )
- T12-AC3 (command) — `grep -cE "renderShell\(.*'/admin" api/src/admin/router.ts` (expects 0, parser parse_grep_count, fields: )
- T12-AC4 (command) — `grep -c 'accessAuth' api/src/admin/router.ts` (expects 1, parser parse_grep_count, fields: )
- T12-AC5 (command) — `grep -c 'workflowApi' api/src/admin/router.ts` (expects 1, parser parse_grep_count, fields: )
- T12-AC6 (test_file) — file: `api/test-ui/admin-ux-parity.spec.ts` (test file does NOT exist at base — Ralph must CREATE it)

### Evidence Routes After Implementation
Per-story actionable: RC-058, RC-059, RC-060, RC-061, RC-062. Deferred to ship: RC-063. Skip diagnostic: none.

After committing this story, run via canonical runner:
```
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/a2z-develop/scripts/run_required_evidence_command.py --change-id=kodigital-homepages-cms-phase3-qafixes-2026-05-11 --required-claim-ids=RC-058,RC-059,RC-060,RC-061,RC-062 --evidence-plan=/Users/guyhaikov/a2z-workspaces/.a2z/mission-state/kodigital-homepages-cms-phase3-qafixes-2026-05-11/required_evidence_plan.json --workspace-root=/Users/guyhaikov/a2z-workspaces --project-root=/Users/guyhaikov/a2z-workspaces --worktree-root="$WORKDIR"
```

### Acceptance Tests
- `acceptance-tests/T12-syntactic.sh`

## Story T13: Implement PATCH /api/admin/articles/:id with tenant guard, category validation, per-site slug uniqueness
- Category: api
- Target Files: api/src/admin/api.ts
- AC ids: T13-AC1, T13-AC2, T13-AC3, T13-AC4, T13-AC5, T13-AC6
- RC ids: RC-064, RC-065, RC-066, RC-067, RC-068, RC-069, RC-110

### Design slice (story-linked content_blocks)
- sidebar.brand.text (value_prop): Default logo-text 'KoDigital CMS' rendered by adminLayout() in the sidebar heade

### Test Bindings (post-implementation deterministic checks)
- T13-AC1 (command) — `grep -cE "api\.patch\(['\"]/articles/:id" api/src/admin/api.ts` (expects 1, parser parse_grep_count, fields: )
- T13-AC2 (command) — `grep -c 'assertTenantBoundary' api/src/admin/api.ts` (expects 1, parser parse_grep_count, fields: )
- T13-AC3 (command) — `grep -c 'assertSlugUniquePerSite' api/src/admin/api.ts` (expects 1, parser parse_grep_count, fields: )
- T13-AC4 (command) — `grep -c 'validateCategoryForSite' api/src/admin/api.ts` (expects 1, parser parse_grep_count, fields: )
- T13-AC5 (command) — `grep -c "'homepage_section'" api/src/admin/api.ts` (expects 1, parser parse_grep_count, fields: )
- T13-AC6 (test_name_regex) — name regex: `^PATCH /api/admin/articles/:id enforces tenant guard slug uniqueness and updates fields$`

### Evidence Routes After Implementation
Per-story actionable: RC-064, RC-065, RC-066, RC-067, RC-068. Deferred to ship: RC-069, RC-110. Skip diagnostic: none.

After committing this story, run via canonical runner:
```
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/a2z-develop/scripts/run_required_evidence_command.py --change-id=kodigital-homepages-cms-phase3-qafixes-2026-05-11 --required-claim-ids=RC-064,RC-065,RC-066,RC-067,RC-068 --evidence-plan=/Users/guyhaikov/a2z-workspaces/.a2z/mission-state/kodigital-homepages-cms-phase3-qafixes-2026-05-11/required_evidence_plan.json --workspace-root=/Users/guyhaikov/a2z-workspaces --project-root=/Users/guyhaikov/a2z-workspaces --worktree-root="$WORKDIR"
```

### Acceptance Tests
- `acceptance-tests/T13-syntactic.sh`

## Story T14: Wire Domains Create-Site modal -- real POST /api/admin/sites with browser-observable network request, row update, polling start
- Category: ui
- Target Files: api/src/admin/templates/domains.ts
- AC ids: T14-AC1, T14-AC2, T14-AC3, T14-AC4, T14-AC5, T14-AC6
- RC ids: RC-070, RC-071, RC-072, RC-073, RC-074, RC-075, RC-109

### Design slice (story-linked content_blocks)
- domains.create_site.modal (cta): Domains page Create-Site modal: trigger '+ New Site' button → modal with form fi

### Test Bindings (post-implementation deterministic checks)
- T14-AC1 (command) — `grep -cE "fetch\(['\"]/api/admin/sites['\"]" api/src/admin/templates/domains.ts` (expects 1, parser parse_grep_count, fields: )
- T14-AC2 (command) — `grep -c 'JSON.stringify' api/src/admin/templates/domains.ts` (expects 1, parser parse_grep_count, fields: )
- T14-AC3 (command) — `grep -cE 'keydown|Escape' api/src/admin/templates/domains.ts` (expects 2, parser parse_grep_count, fields: )
- T14-AC4 (command) — `grep -c '/provision' api/src/admin/templates/domains.ts` (expects 1, parser parse_grep_count, fields: )
- T14-AC5 (command) — `grep -cE '(const |let |=>)' api/src/admin/templates/domains.ts` (expects 0, parser parse_grep_count, fields: )
- T14-AC6 (test_file) — file: `api/test-ui/domains-create-site.spec.ts` (test file does NOT exist at base — Ralph must CREATE it)

### Evidence Routes After Implementation
Per-story actionable: RC-070, RC-071, RC-072, RC-073, RC-074. Deferred to ship: RC-075, RC-109. Skip diagnostic: none.

After committing this story, run via canonical runner:
```
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/a2z-develop/scripts/run_required_evidence_command.py --change-id=kodigital-homepages-cms-phase3-qafixes-2026-05-11 --required-claim-ids=RC-070,RC-071,RC-072,RC-073,RC-074 --evidence-plan=/Users/guyhaikov/a2z-workspaces/.a2z/mission-state/kodigital-homepages-cms-phase3-qafixes-2026-05-11/required_evidence_plan.json --workspace-root=/Users/guyhaikov/a2z-workspaces --project-root=/Users/guyhaikov/a2z-workspaces --worktree-root="$WORKDIR"
```

### Acceptance Tests
- `acceptance-tests/T14-syntactic.sh`

## Story T15: Fix generate_about_page_stub provisioning step -- insert pages row idempotently with site_id, slug='about', page_type='about'
- Category: api
- Target Files: api/src/site-provisioning/steps.ts
- AC ids: T15-AC1, T15-AC2, T15-AC3, T15-AC4, T15-AC5
- RC ids: RC-076, RC-077, RC-078, RC-079, RC-080, RC-109, RC-111

### Design slice (story-linked content_blocks)
- domains.create_site.modal (cta): Domains page Create-Site modal: trigger '+ New Site' button → modal with form fi
- provisioning.about_page (value_prop): Provisioning step generate_about_page_stub inserts a pages row {site_id=<new>, s

### Test Bindings (post-implementation deterministic checks)
- T15-AC1 (command) — `grep -cE 'INSERT (OR IGNORE )?INTO pages' api/src/site-provisioning/steps.ts` (expects 1, parser parse_grep_count, fields: )
- T15-AC2 (command) — `grep -cE "page_type.*'about'|'about'.*page_type" api/src/site-provisioning/steps.ts` (expects 1, parser parse_grep_count, fields: )
- T15-AC3 (command) — `grep -cE 'INSERT OR IGNORE|ON CONFLICT' api/src/site-provisioning/steps.ts` (expects 1, parser parse_grep_count, fields: )
- T15-AC4 (command) — `grep -cE 'about_page_id|about_page_slug' api/src/site-provisioning/steps.ts` (expects 1, parser parse_grep_count, fields: )
- T15-AC5 (test_name_regex) — name regex: `^generate_about_page_stub inserts pages row idempotently$`

### Evidence Routes After Implementation
Per-story actionable: RC-076, RC-077, RC-078, RC-079. Deferred to ship: RC-080, RC-109, RC-111. Skip diagnostic: none.

After committing this story, run via canonical runner:
```
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/a2z-develop/scripts/run_required_evidence_command.py --change-id=kodigital-homepages-cms-phase3-qafixes-2026-05-11 --required-claim-ids=RC-076,RC-077,RC-078,RC-079 --evidence-plan=/Users/guyhaikov/a2z-workspaces/.a2z/mission-state/kodigital-homepages-cms-phase3-qafixes-2026-05-11/required_evidence_plan.json --workspace-root=/Users/guyhaikov/a2z-workspaces --project-root=/Users/guyhaikov/a2z-workspaces --worktree-root="$WORKDIR"
```

### Acceptance Tests
- `acceptance-tests/T15-syntactic.sh`

## Story T16: Add @playwright/test devDep + test:ui scripts to api/package.json
- Category: config
- Target Files: api/package.json
- AC ids: T16-AC1, T16-AC2, T16-AC3
- RC ids: RC-081, RC-082, RC-083

### Test Bindings (post-implementation deterministic checks)
- T16-AC1 (command) — `grep -c '"@playwright/test"' api/package.json` (expects 1, parser parse_grep_count, fields: )
- T16-AC2 (command) — `grep -c '"test:ui"' api/package.json` (expects 1, parser parse_grep_count, fields: )
- T16-AC3 (command) — `grep -cE '"test:ui:headed"|"test:ui:report"' api/package.json` (expects 2, parser parse_grep_count, fields: )

### Evidence Routes After Implementation
Per-story actionable: RC-081, RC-082, RC-083. Deferred to ship: none. Skip diagnostic: none.

After committing this story, run via canonical runner:
```
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/a2z-develop/scripts/run_required_evidence_command.py --change-id=kodigital-homepages-cms-phase3-qafixes-2026-05-11 --required-claim-ids=RC-081,RC-082,RC-083 --evidence-plan=/Users/guyhaikov/a2z-workspaces/.a2z/mission-state/kodigital-homepages-cms-phase3-qafixes-2026-05-11/required_evidence_plan.json --workspace-root=/Users/guyhaikov/a2z-workspaces --project-root=/Users/guyhaikov/a2z-workspaces --worktree-root="$WORKDIR"
```

### Acceptance Tests
- `acceptance-tests/T16-syntactic.sh`

## Story T17: Create playwright.config.ts -- webServer npm run dev port 8787, baseURL http://127.0.0.1:8787, projects chromium
- Category: config
- Target Files: api/playwright.config.ts
- AC ids: T17-AC1, T17-AC2, T17-AC3
- RC ids: RC-084, RC-085, RC-086

### Test Bindings (post-implementation deterministic checks)
- T17-AC1 (command) — `grep -c 'defineConfig' api/playwright.config.ts` (expects 1, parser parse_grep_count, fields: )
- T17-AC2 (command) — `grep -c 'npm run dev' api/playwright.config.ts` (expects 1, parser parse_grep_count, fields: )
- T17-AC3 (command) — `grep -c 'test-ui' api/playwright.config.ts` (expects 1, parser parse_grep_count, fields: )

### Evidence Routes After Implementation
Per-story actionable: RC-084, RC-085, RC-086. Deferred to ship: none. Skip diagnostic: none.

After committing this story, run via canonical runner:
```
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/a2z-develop/scripts/run_required_evidence_command.py --change-id=kodigital-homepages-cms-phase3-qafixes-2026-05-11 --required-claim-ids=RC-084,RC-085,RC-086 --evidence-plan=/Users/guyhaikov/a2z-workspaces/.a2z/mission-state/kodigital-homepages-cms-phase3-qafixes-2026-05-11/required_evidence_plan.json --workspace-root=/Users/guyhaikov/a2z-workspaces --project-root=/Users/guyhaikov/a2z-workspaces --worktree-root="$WORKDIR"
```

### Acceptance Tests
- `acceptance-tests/T17-syntactic.sh`

## Story T18: Playwright spec admin-ux-parity -- all 9 admin routes render adminLayout, nav has 9 entries, no Phase 1 admin shell
- Category: script
- Target Files: api/test-ui/admin-ux-parity.spec.ts
- AC ids: T18-AC1, T18-AC2, T18-AC3, T18-AC4, T18-AC5, T18-AC6, T18-AC7
- RC ids: RC-087, RC-088, RC-089, RC-090, RC-091, RC-092, RC-093

### Test Bindings (post-implementation deterministic checks)
- T18-AC1 (command) — `grep -c "from '@playwright/test'" api/test-ui/admin-ux-parity.spec.ts` (expects 1, parser parse_grep_count, fields: )
- T18-AC2 (command) — `grep -c "'/admin/domains'" api/test-ui/admin-ux-parity.spec.ts` (expects 1, parser parse_grep_count, fields: )
- T18-AC3 (command) — `grep -c '.admin-layout' api/test-ui/admin-ux-parity.spec.ts` (expects 1, parser parse_grep_count, fields: )
- T18-AC4 (command) — `grep -c 'Phase 1 admin shell' api/test-ui/admin-ux-parity.spec.ts` (expects 1, parser parse_grep_count, fields: )
- T18-AC5 (command) — `grep -c 'Psychic' api/test-ui/admin-ux-parity.spec.ts` (expects 1, parser parse_grep_count, fields: )
- T18-AC6 (command) — `grep -c 'test-results/admin-ux-parity' api/test-ui/admin-ux-parity.spec.ts` (expects 1, parser parse_grep_count, fields: )
- T18-AC7 (test_file) — file: `api/test-ui/admin-ux-parity.spec.ts` (test file does NOT exist at base — Ralph must CREATE it)

### Evidence Routes After Implementation
Per-story actionable: RC-087, RC-088, RC-089, RC-090, RC-091, RC-092. Deferred to ship: RC-093. Skip diagnostic: none.

After committing this story, run via canonical runner:
```
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/a2z-develop/scripts/run_required_evidence_command.py --change-id=kodigital-homepages-cms-phase3-qafixes-2026-05-11 --required-claim-ids=RC-087,RC-088,RC-089,RC-090,RC-091,RC-092 --evidence-plan=/Users/guyhaikov/a2z-workspaces/.a2z/mission-state/kodigital-homepages-cms-phase3-qafixes-2026-05-11/required_evidence_plan.json --workspace-root=/Users/guyhaikov/a2z-workspaces --project-root=/Users/guyhaikov/a2z-workspaces --worktree-root="$WORKDIR"
```

### Acceptance Tests
- `acceptance-tests/T18-syntactic.sh`

## Story T19: Playwright spec domains-create-site -- modal opens, fill+submit observes POST /api/admin/sites, row + provisioning panel appear
- Category: script
- Target Files: api/test-ui/domains-create-site.spec.ts
- AC ids: T19-AC1, T19-AC2, T19-AC3, T19-AC4, T19-AC5
- RC ids: RC-094, RC-095, RC-096, RC-097, RC-098

### Test Bindings (post-implementation deterministic checks)
- T19-AC1 (command) — `grep -c '/admin/domains' api/test-ui/domains-create-site.spec.ts` (expects 1, parser parse_grep_count, fields: )
- T19-AC2 (command) — `grep -cE 'waitForRequest\([^)]*/api/admin/sites' api/test-ui/domains-create-site.spec.ts` (expects 1, parser parse_grep_count, fields: )
- T19-AC3 (command) — `grep -c 'Create site' api/test-ui/domains-create-site.spec.ts` (expects 1, parser parse_grep_count, fields: )
- T19-AC4 (command) — `grep -c 'example.test' api/test-ui/domains-create-site.spec.ts` (expects 1, parser parse_grep_count, fields: )
- T19-AC5 (test_file) — file: `api/test-ui/domains-create-site.spec.ts` (test file does NOT exist at base — Ralph must CREATE it)

### Evidence Routes After Implementation
Per-story actionable: RC-094, RC-095, RC-096, RC-097. Deferred to ship: RC-098. Skip diagnostic: none.

After committing this story, run via canonical runner:
```
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/a2z-develop/scripts/run_required_evidence_command.py --change-id=kodigital-homepages-cms-phase3-qafixes-2026-05-11 --required-claim-ids=RC-094,RC-095,RC-096,RC-097 --evidence-plan=/Users/guyhaikov/a2z-workspaces/.a2z/mission-state/kodigital-homepages-cms-phase3-qafixes-2026-05-11/required_evidence_plan.json --workspace-root=/Users/guyhaikov/a2z-workspaces --project-root=/Users/guyhaikov/a2z-workspaces --worktree-root="$WORKDIR"
```

### Acceptance Tests
- `acceptance-tests/T19-syntactic.sh`

## Story T20: Playwright spec admin-routing-security -- public content host /admin returns 404, no cms.kodigital.app leak, no-store + noindex
- Category: script
- Target Files: api/test-ui/admin-routing-security.spec.ts
- AC ids: T20-AC1, T20-AC2, T20-AC3, T20-AC4, T20-AC5
- RC ids: RC-099, RC-100, RC-101, RC-102, RC-103

### Design slice (story-linked content_blocks)
- admin.layout.classes (value_prop): adminLayout() emits the 33-class CSS contract: admin-layout, admin-sidebar, side

### Test Bindings (post-implementation deterministic checks)
- T20-AC1 (command) — `grep -c 'extraHTTPHeaders' api/test-ui/admin-routing-security.spec.ts` (expects 1, parser parse_grep_count, fields: )
- T20-AC2 (command) — `grep -cE 'toBe\(404\)|toEqual\(404\)' api/test-ui/admin-routing-security.spec.ts` (expects 1, parser parse_grep_count, fields: )
- T20-AC3 (command) — `grep -c 'cms.kodigital.app' api/test-ui/admin-routing-security.spec.ts` (expects 1, parser parse_grep_count, fields: )
- T20-AC4 (command) — `grep -ci 'no-store' api/test-ui/admin-routing-security.spec.ts` (expects 1, parser parse_grep_count, fields: )
- T20-AC5 (test_file) — file: `api/test-ui/admin-routing-security.spec.ts` (test file does NOT exist at base — Ralph must CREATE it)

### Evidence Routes After Implementation
Per-story actionable: RC-099, RC-100, RC-101, RC-102. Deferred to ship: RC-103. Skip diagnostic: none.

After committing this story, run via canonical runner:
```
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/a2z-develop/scripts/run_required_evidence_command.py --change-id=kodigital-homepages-cms-phase3-qafixes-2026-05-11 --required-claim-ids=RC-099,RC-100,RC-101,RC-102 --evidence-plan=/Users/guyhaikov/a2z-workspaces/.a2z/mission-state/kodigital-homepages-cms-phase3-qafixes-2026-05-11/required_evidence_plan.json --workspace-root=/Users/guyhaikov/a2z-workspaces --project-root=/Users/guyhaikov/a2z-workspaces --worktree-root="$WORKDIR"
```

### Acceptance Tests
- `acceptance-tests/T20-syntactic.sh`

## Story T21: Update Vitest acceptance suite -- assert /admin uses adminLayout (no Phase 1 shell), PATCH articles route exists, About-page step inserts pages
- Category: script
- Target Files: api/test/admin-ux-acceptance.test.ts
- AC ids: T21-AC1, T21-AC2, T21-AC3, T21-AC4, T21-AC5
- RC ids: RC-104, RC-105, RC-106, RC-107, RC-108

### Test Bindings (post-implementation deterministic checks)
- T21-AC1 (command) — `grep -c 'admin-sidebar' api/test/admin-ux-acceptance.test.ts` (expects 1, parser parse_grep_count, fields: )
- T21-AC2 (command) — `grep -c 'Phase 1 admin shell' api/test/admin-ux-acceptance.test.ts` (expects 1, parser parse_grep_count, fields: )
- T21-AC3 (command) — `grep -cE 'PATCH.*/api/admin/articles/' api/test/admin-ux-acceptance.test.ts` (expects 1, parser parse_grep_count, fields: )
- T21-AC4 (command) — `grep -cE 'generate_about_page_stub|about_page_id' api/test/admin-ux-acceptance.test.ts` (expects 1, parser parse_grep_count, fields: )
- T21-AC5 (test_file) — file: `api/test/admin-ux-acceptance.test.ts` (test file does NOT exist at base — Ralph must CREATE it)

### Evidence Routes After Implementation
Per-story actionable: RC-104, RC-105, RC-106, RC-107, RC-108. Deferred to ship: none. Skip diagnostic: none.

After committing this story, run via canonical runner:
```
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/a2z-develop/scripts/run_required_evidence_command.py --change-id=kodigital-homepages-cms-phase3-qafixes-2026-05-11 --required-claim-ids=RC-104,RC-105,RC-106,RC-107,RC-108 --evidence-plan=/Users/guyhaikov/a2z-workspaces/.a2z/mission-state/kodigital-homepages-cms-phase3-qafixes-2026-05-11/required_evidence_plan.json --workspace-root=/Users/guyhaikov/a2z-workspaces --project-root=/Users/guyhaikov/a2z-workspaces --worktree-root="$WORKDIR"
```

### Acceptance Tests
- `acceptance-tests/T21-syntactic.sh`

