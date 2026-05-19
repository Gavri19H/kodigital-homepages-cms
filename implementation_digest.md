# Implementation Digest — change cms-new-phase5-2026-05018

Mode: field_sensitive_with_ui  |  Profiles: api_contract, evidence_route_strict, ui_conversion  |  Mission-global RCs: 1

## RED LINE — typed contract authority
The fields, wire names, endpoint paths, and design specs below are AUTHORITATIVE. Implement EXACTLY as specified. Field names in HTTP request bodies / redirect URLs / cookies are the WIRE name (right column), NOT the canonical name. Do not invent field names; do not paraphrase typed contracts.

## RED-LINE substitutions
- design_contract.forbidden_substitutes — Never render the literal string 'TheIWise' or 'theiwise' or 'theiwise.com' in any public-domain response body. (Hard RED LINE per session-4 spec PART 12 + docs/no-touch-red-line.md — visible brand strings come only from per-site CMS data, never hardcoded.); source SP-USER-1
- design_contract.forbidden_substitutes — Never include the substring 'cms.kodigital.app' in any response body served from a public content domain. (Tenant boundary rule: the CMS admin host MUST NOT leak from public content domains. Already enforced by publicSiteContextMiddleware; this contract forbids reintroducing leakage via template strings.); source SP-USER-1
- design_contract.forbidden_substitutes — Never use href="#" in rendered Home or Article output. (PART 8 forbids placeholder anchors. Disabled state must be expressed via aria-disabled + button element or accessible explanation, never a no-op href.); source SP-USER-1
- mission_spec.main_goal.forbidden_substitutes — theiwise.com (main_goal_forbidden_substitute)
- mission_spec.main_goal.forbidden_substitutes — TheIWise (main_goal_forbidden_substitute)
- mission_spec.main_goal.forbidden_substitutes — theiwise (main_goal_forbidden_substitute)
- mission_spec.main_goal.forbidden_substitutes — a2z-cf-cms-v1-api (main_goal_forbidden_substitute)
- mission_spec.main_goal.forbidden_substitutes — a2z-cf-cms-v1-db (main_goal_forbidden_substitute)

## Mission-wide design constraints (ui_conversion)
- Route: `/, /article/:slug`
- Conversion goal: Render generic per-site Home (13 sections) and Article (12 sections) public pages whose visible brand is sourced entirely from sites/site_settings/media so that any tenant content domain serves its own brand identity (name, tagline, logo, brand_tokens) with zero TheIWise leakage and zero cms.kodigital.app leakage from public content domains.
- Viewport: 375px max scrollWidth 380px
- Viewport: 1280px max scrollWidth 1290px
- Tone: Vertical-agnostic copy — no hardcoded TheIWise/theiwise/theiwise.com in any visible string
- Tone: All visible brand copy sourced from site.site_name, site.tagline, site.site_description (PART 12)
- A11y: skip-to-content link in layout (PART 9)
- A11y: focus-visible rings on interactive elements
- A11y: aria-label on icon-only buttons
- A11y: no nested interactive controls inside card links
- A11y: alt text + width + height on every <img>
- A11y: anchored sections get scroll-margin-top: 88px
- A11y: newsletter input has label even if visually hidden

## Mission-global required claims
- RC-001 (behavioral, test_receipt, action=RUN)

Run once after final story commit:
```
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/a2z-develop/scripts/run_required_evidence_command.py --change-id=cms-new-phase5-2026-05018 --required-claim-ids=RC-001 --evidence-plan=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/cms-new-phase5-2026-05018/required_evidence_plan.json --workspace-root=/Users/guyhaikov/a2z-workspaces --project-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms --worktree-root="$WORKDIR"
```

## Story T1: Add public.css string module with all PART 3 tokens and PART 4 breakpoints
- Category: ui
- Target Files: src/public/assets/public-css.ts
- AC ids: T1.AC1, T1.AC2, T1.AC3
- RC ids: RC-002, RC-003, RC-004

### Test Bindings (post-implementation deterministic checks)
- T1.AC1 (command) — `grep -c -- '--tw-ink' src/public/assets/public-css.ts` (expects 1, parser parse_grep_count, fields: )
- T1.AC2 (command) — `grep -c '@media (max-width:1280px)' src/public/assets/public-css.ts` (expects 1, parser parse_grep_count, fields: )
- T1.AC3 (command) — `grep -c 'minmax(0, 1fr)' src/public/assets/public-css.ts` (expects 1, parser parse_grep_count, fields: )

### Evidence Routes After Implementation
Per-story actionable: RC-002, RC-003, RC-004. Deferred to ship: none. Skip diagnostic: none.

After committing this story, run via canonical runner:
```
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/a2z-develop/scripts/run_required_evidence_command.py --change-id=cms-new-phase5-2026-05018 --required-claim-ids=RC-002,RC-003,RC-004 --evidence-plan=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/cms-new-phase5-2026-05018/required_evidence_plan.json --workspace-root=/Users/guyhaikov/a2z-workspaces --project-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms --worktree-root="$WORKDIR"
```

### Acceptance Tests
- `acceptance-tests/T1-syntactic.sh`

## Story T2: Add public.js string module with passive-listener reading progress + share/copy
- Category: ui
- Target Files: src/public/assets/public-js.ts
- AC ids: T2.AC1, T2.AC2, T2.AC3
- RC ids: RC-005, RC-006, RC-007

### Test Bindings (post-implementation deterministic checks)
- T2.AC1 (command) — `grep -c 'passive: true' src/public/assets/public-js.ts` (expects 1, parser parse_grep_count, fields: )
- T2.AC2 (command) — `grep -c 'navigator.share' src/public/assets/public-js.ts` (expects 1, parser parse_grep_count, fields: )
- T2.AC3 (command) — `grep -c 'reading-progress-bar' src/public/assets/public-js.ts` (expects 1, parser parse_grep_count, fields: )

### Evidence Routes After Implementation
Per-story actionable: RC-005, RC-006, RC-007. Deferred to ship: none. Skip diagnostic: none.

After committing this story, run via canonical runner:
```
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/a2z-develop/scripts/run_required_evidence_command.py --change-id=cms-new-phase5-2026-05018 --required-claim-ids=RC-005,RC-006,RC-007 --evidence-plan=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/cms-new-phase5-2026-05018/required_evidence_plan.json --workspace-root=/Users/guyhaikov/a2z-workspaces --project-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms --worktree-root="$WORKDIR"
```

### Acceptance Tests
- `acceptance-tests/T2-syntactic.sh`

## Story T3: templates/layout.ts renders the <html> scaffold with site brand-token injection
- Category: ui
- Target Files: src/public/templates/layout.ts
- AC ids: T3.AC1, T3.AC2, T3.AC3
- RC ids: RC-008, RC-009, RC-010

### Test Bindings (post-implementation deterministic checks)
- T3.AC1 (command) — `grep -c 'skip-to-content' src/public/templates/layout.ts` (expects 1, parser parse_grep_count, fields: )
- T3.AC2 (command) — `grep -cE 'brand_tokens|brandTokens' src/public/templates/layout.ts` (expects 1, parser parse_grep_count, fields: )
- T3.AC3 (test_name_regex) — name regex: `^public-templates-layout.*brand[_-]?tokens`

### Evidence Routes After Implementation
Per-story actionable: RC-008, RC-009, RC-010. Deferred to ship: none. Skip diagnostic: none.

After committing this story, run via canonical runner:
```
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/a2z-develop/scripts/run_required_evidence_command.py --change-id=cms-new-phase5-2026-05018 --required-claim-ids=RC-008,RC-009,RC-010 --evidence-plan=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/cms-new-phase5-2026-05018/required_evidence_plan.json --workspace-root=/Users/guyhaikov/a2z-workspaces --project-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms --worktree-root="$WORKDIR"
```

### Acceptance Tests
- `acceptance-tests/T3-syntactic.sh`

## Story T4: templates/components.ts exports site-aware components
- Category: ui
- Target Files: src/public/templates/components.ts
- AC ids: T4.AC1, T4.AC2, T4.AC3
- RC ids: RC-011, RC-012, RC-013

### Test Bindings (post-implementation deterministic checks)
- T4.AC1 (command) — `grep -cE 'export function (renderHeader|renderHero|renderChipRail|renderCard|renderNewsletter|renderFooter|renderAdSlot|renderFloatingNext)' src/public/templates/components.ts` (expects 8, parser parse_grep_count, fields: )
- T4.AC2 (command) — `grep -c 'data-ad-slot' src/public/templates/components.ts` (expects 1, parser parse_grep_count, fields: )
- T4.AC3 (test_name_regex) — name regex: `^public-templates-components.*chip[_-]?rail`

### Evidence Routes After Implementation
Per-story actionable: RC-011, RC-012, RC-013. Deferred to ship: none. Skip diagnostic: none.

After committing this story, run via canonical runner:
```
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/a2z-develop/scripts/run_required_evidence_command.py --change-id=cms-new-phase5-2026-05018 --required-claim-ids=RC-011,RC-012,RC-013 --evidence-plan=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/cms-new-phase5-2026-05018/required_evidence_plan.json --workspace-root=/Users/guyhaikov/a2z-workspaces --project-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms --worktree-root="$WORKDIR"
```

### Acceptance Tests
- `acceptance-tests/T4-syntactic.sh`

## Story T5: templates/icons.ts exports inline SVG icons
- Category: ui
- Target Files: src/public/templates/icons.ts
- AC ids: T5.AC1, T5.AC2
- RC ids: RC-014, RC-015

### Test Bindings (post-implementation deterministic checks)
- T5.AC1 (command) — `grep -cE 'export function (iconSearch|iconShare|iconCopy|iconArrow|iconBrandMark)' src/public/templates/icons.ts` (expects 5, parser parse_grep_count, fields: )
- T5.AC2 (command) — `grep -c 'aria-hidden="true"' src/public/templates/icons.ts` (expects 5, parser parse_grep_count, fields: )

### Evidence Routes After Implementation
Per-story actionable: RC-014, RC-015. Deferred to ship: none. Skip diagnostic: none.

After committing this story, run via canonical runner:
```
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/a2z-develop/scripts/run_required_evidence_command.py --change-id=cms-new-phase5-2026-05018 --required-claim-ids=RC-014,RC-015 --evidence-plan=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/cms-new-phase5-2026-05018/required_evidence_plan.json --workspace-root=/Users/guyhaikov/a2z-workspaces --project-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms --worktree-root="$WORKDIR"
```

### Acceptance Tests
- `acceptance-tests/T5-syntactic.sh`

## Story T6: templates/seo.ts exports JSON-LD builders + meta helpers
- Category: ui
- Target Files: src/public/templates/seo.ts
- AC ids: T6.AC1, T6.AC2, T6.AC3
- RC ids: RC-016, RC-017, RC-018

### Test Bindings (post-implementation deterministic checks)
- T6.AC1 (command) — `grep -cE 'export function (buildHomeJsonLd|buildArticleJsonLd|buildBreadcrumbJsonLd|buildFaqJsonLd|buildMetaTags)' src/public/templates/seo.ts` (expects 5, parser parse_grep_count, fields: )
- T6.AC2 (command) — `grep -cE '"@type": *"(WebSite|Organization|ItemList|Article|BreadcrumbList|FAQPage)"' src/public/templates/seo.ts` (expects 6, parser parse_grep_count, fields: )
- T6.AC3 (test_name_regex) — name regex: `^public-templates-seo.*faq[_-]?empty`

### Evidence Routes After Implementation
Per-story actionable: RC-016, RC-017, RC-018. Deferred to ship: none. Skip diagnostic: none.

After committing this story, run via canonical runner:
```
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/a2z-develop/scripts/run_required_evidence_command.py --change-id=cms-new-phase5-2026-05018 --required-claim-ids=RC-016,RC-017,RC-018 --evidence-plan=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/cms-new-phase5-2026-05018/required_evidence_plan.json --workspace-root=/Users/guyhaikov/a2z-workspaces --project-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms --worktree-root="$WORKDIR"
```

### Acceptance Tests
- `acceptance-tests/T6-syntactic.sh`

## Story T7: templates/format.ts exports formatDate, formatReadTime, truncateExcerpt
- Category: ui
- Target Files: src/public/templates/format.ts
- AC ids: T7.AC1, T7.AC2
- RC ids: RC-019, RC-020

### Test Bindings (post-implementation deterministic checks)
- T7.AC1 (command) — `grep -cE 'export function (formatDate|formatReadTime|truncateExcerpt)' src/public/templates/format.ts` (expects 3, parser parse_grep_count, fields: )
- T7.AC2 (test_name_regex) — name regex: `^public-templates-format.*truncate`

### Evidence Routes After Implementation
Per-story actionable: RC-019, RC-020. Deferred to ship: none. Skip diagnostic: none.

After committing this story, run via canonical runner:
```
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/a2z-develop/scripts/run_required_evidence_command.py --change-id=cms-new-phase5-2026-05018 --required-claim-ids=RC-019,RC-020 --evidence-plan=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/cms-new-phase5-2026-05018/required_evidence_plan.json --workspace-root=/Users/guyhaikov/a2z-workspaces --project-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms --worktree-root="$WORKDIR"
```

### Acceptance Tests
- `acceptance-tests/T7-syntactic.sh`

## Story T8: view-models/home.ts exports buildHomeViewModel(db, siteContext)
- Category: api
- Target Files: src/public/view-models/home.ts
- AC ids: T8.AC1, T8.AC2, T8.AC3, T8.AC4
- RC ids: RC-021, RC-022, RC-023, RC-024

### Test Bindings (post-implementation deterministic checks)
- T8.AC1 (command) — `grep -c 'export async function buildHomeViewModel' src/public/view-models/home.ts` (expects 1, parser parse_grep_count, fields: )
- T8.AC2 (command) — `grep -c 'WHERE site_id = ?' src/public/view-models/home.ts` (expects 1, parser parse_grep_count, fields: )
- T8.AC3 (command) — `grep -c '\.bind(' src/public/view-models/home.ts` (expects 3, parser parse_grep_count, fields: )
- T8.AC4 (test_name_regex) — name regex: `^public-view-models-home.*site[_-]?isolation`

### Evidence Routes After Implementation
Per-story actionable: RC-021, RC-022, RC-023, RC-024. Deferred to ship: none. Skip diagnostic: none.

After committing this story, run via canonical runner:
```
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/a2z-develop/scripts/run_required_evidence_command.py --change-id=cms-new-phase5-2026-05018 --required-claim-ids=RC-021,RC-022,RC-023,RC-024 --evidence-plan=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/cms-new-phase5-2026-05018/required_evidence_plan.json --workspace-root=/Users/guyhaikov/a2z-workspaces --project-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms --worktree-root="$WORKDIR"
```

### Acceptance Tests
- `acceptance-tests/T8-syntactic.sh`

## Story T9: view-models/article.ts exports buildArticleViewModel + adaptBodyBlocks
- Category: api
- Target Files: src/public/view-models/article.ts
- AC ids: T9.AC1, T9.AC2, T9.AC3, T9.AC4, T9.AC5
- RC ids: RC-025, RC-026, RC-027, RC-028, RC-029

### Test Bindings (post-implementation deterministic checks)
- T9.AC1 (command) — `grep -c 'export async function buildArticleViewModel' src/public/view-models/article.ts` (expects 1, parser parse_grep_count, fields: )
- T9.AC2 (command) — `grep -c 'site_id = ?' src/public/view-models/article.ts` (expects 1, parser parse_grep_count, fields: )
- T9.AC3 (command) — `grep -c 'adaptBodyBlocks' src/public/view-models/article.ts` (expects 1, parser parse_grep_count, fields: )
- T9.AC4 (test_name_regex) — name regex: `^public-view-models-article.*content[_-]?html[_-]?fallback`
- T9.AC5 (test_name_regex) — name regex: `^public-view-models-article.*faq[_-]?blocks`

### Evidence Routes After Implementation
Per-story actionable: RC-025, RC-026, RC-027, RC-028, RC-029. Deferred to ship: none. Skip diagnostic: none.

After committing this story, run via canonical runner:
```
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/a2z-develop/scripts/run_required_evidence_command.py --change-id=cms-new-phase5-2026-05018 --required-claim-ids=RC-025,RC-026,RC-027,RC-028,RC-029 --evidence-plan=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/cms-new-phase5-2026-05018/required_evidence_plan.json --workspace-root=/Users/guyhaikov/a2z-workspaces --project-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms --worktree-root="$WORKDIR"
```

### Acceptance Tests
- `acceptance-tests/T9-syntactic.sh`

## Story T10: templates/home.ts renders 13 sections in PART 1 order
- Category: ui
- Target Files: src/public/templates/home.ts
- AC ids: T10.AC1, T10.AC2, T10.AC3
- RC ids: RC-030, RC-031, RC-032

### Test Bindings (post-implementation deterministic checks)
- T10.AC1 (command) — `grep -c 'export function renderHome' src/public/templates/home.ts` (expects 1, parser parse_grep_count, fields: )
- T10.AC2 (test_name_regex) — name regex: `^public-templates-home.*section[_-]?order`
- T10.AC3 (test_name_regex) — name regex: `^public-templates-home.*brand[_-]?from[_-]?site`

### Evidence Routes After Implementation
Per-story actionable: RC-030, RC-031, RC-032. Deferred to ship: none. Skip diagnostic: none.

After committing this story, run via canonical runner:
```
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/a2z-develop/scripts/run_required_evidence_command.py --change-id=cms-new-phase5-2026-05018 --required-claim-ids=RC-030,RC-031,RC-032 --evidence-plan=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/cms-new-phase5-2026-05018/required_evidence_plan.json --workspace-root=/Users/guyhaikov/a2z-workspaces --project-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms --worktree-root="$WORKDIR"
```

### Acceptance Tests
- `acceptance-tests/T10-syntactic.sh`

## Story T11: templates/article.ts renders 12 sections in PART 2 order + minmax(0, 1fr)
- Category: ui
- Target Files: src/public/templates/article.ts
- AC ids: T11.AC1, T11.AC2, T11.AC3, T11.AC4
- RC ids: RC-033, RC-034, RC-035, RC-036

### Test Bindings (post-implementation deterministic checks)
- T11.AC1 (command) — `grep -c 'export function renderArticle' src/public/templates/article.ts` (expects 1, parser parse_grep_count, fields: )
- T11.AC2 (test_name_regex) — name regex: `^public-templates-article.*section[_-]?order`
- T11.AC3 (test_name_regex) — name regex: `^public-templates-article.*article[_-]?shell[_-]?minmax`
- T11.AC4 (test_name_regex) — name regex: `^public-templates-article.*faqs[_-]?empty[_-]?no[_-]?faqpage`

### Evidence Routes After Implementation
Per-story actionable: RC-033, RC-034, RC-035, RC-036. Deferred to ship: none. Skip diagnostic: none.

After committing this story, run via canonical runner:
```
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/a2z-develop/scripts/run_required_evidence_command.py --change-id=cms-new-phase5-2026-05018 --required-claim-ids=RC-033,RC-034,RC-035,RC-036 --evidence-plan=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/cms-new-phase5-2026-05018/required_evidence_plan.json --workspace-root=/Users/guyhaikov/a2z-workspaces --project-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms --worktree-root="$WORKDIR"
```

### Acceptance Tests
- `acceptance-tests/T11-syntactic.sh`

## Story T12: router.ts adds GET / handler wiring home view-model + template
- Category: api
- Target Files: src/public/router.ts
- AC ids: T12.AC1, T12.AC2
- RC ids: RC-037, RC-038

### Test Bindings (post-implementation deterministic checks)
- T12.AC1 (command) — `grep -c 'router.get("/",' src/public/router.ts` (expects 1, parser parse_grep_count, fields: )
- T12.AC2 (test_name_regex) — name regex: `^public-router-home.*renders[_-]?home`

### Evidence Routes After Implementation
Per-story actionable: RC-037, RC-038. Deferred to ship: none. Skip diagnostic: none.

After committing this story, run via canonical runner:
```
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/a2z-develop/scripts/run_required_evidence_command.py --change-id=cms-new-phase5-2026-05018 --required-claim-ids=RC-037,RC-038 --evidence-plan=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/cms-new-phase5-2026-05018/required_evidence_plan.json --workspace-root=/Users/guyhaikov/a2z-workspaces --project-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms --worktree-root="$WORKDIR"
```

### Acceptance Tests
- `acceptance-tests/T12-syntactic.sh`

## Story T13: /article/:slug uses Article template with fallback
- Category: api
- Target Files: src/public/router.ts
- AC ids: T13.AC1, T13.AC2, T13.AC3, T13.AC4
- RC ids: RC-039, RC-040, RC-041, RC-042

### Test Bindings (post-implementation deterministic checks)
- T13.AC1 (command) — `grep -cE 'renderArticle|buildArticleViewModel' src/public/router.ts` (expects 2, parser parse_grep_count, fields: )
- T13.AC2 (command) — `grep -c 'catch' src/public/router.ts` (expects 1, parser parse_grep_count, fields: )
- T13.AC3 (test_name_regex) — name regex: `^public-router-article.*renders[_-]?article`
- T13.AC4 (test_name_regex) — name regex: `^public-router-article.*fallback[_-]?on[_-]?throw`

### Evidence Routes After Implementation
Per-story actionable: RC-039, RC-040, RC-041, RC-042. Deferred to ship: none. Skip diagnostic: none.

After committing this story, run via canonical runner:
```
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/a2z-develop/scripts/run_required_evidence_command.py --change-id=cms-new-phase5-2026-05018 --required-claim-ids=RC-039,RC-040,RC-041,RC-042 --evidence-plan=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/cms-new-phase5-2026-05018/required_evidence_plan.json --workspace-root=/Users/guyhaikov/a2z-workspaces --project-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms --worktree-root="$WORKDIR"
```

### Acceptance Tests
- `acceptance-tests/T13-syntactic.sh`

## Story T14: /assets/public.css + /assets/public.js cacheable routes
- Category: api
- Target Files: src/public/router.ts
- AC ids: T14.AC1, T14.AC2, T14.AC3, T14.AC4, T14.AC5
- RC ids: RC-043, RC-044, RC-045, RC-046, RC-047

### Test Bindings (post-implementation deterministic checks)
- T14.AC1 (command) — `grep -cE '/assets/public\.css|/assets/public\.js' src/public/router.ts` (expects 2, parser parse_grep_count, fields: )
- T14.AC2 (command) — `grep -c 'max-age=31536000, immutable' src/public/router.ts` (expects 1, parser parse_grep_count, fields: )
- T14.AC3 (test_name_regex) — name regex: `^public-router-assets.*public[_-]?css`
- T14.AC4 (test_name_regex) — name regex: `^public-router-assets.*public[_-]?js`
- T14.AC5 (test_name_regex) — name regex: `^public-router-assets.*reserved[_-]?path[_-]?safety`

### Evidence Routes After Implementation
Per-story actionable: RC-043, RC-044, RC-045, RC-046, RC-047. Deferred to ship: none. Skip diagnostic: none.

After committing this story, run via canonical runner:
```
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/a2z-develop/scripts/run_required_evidence_command.py --change-id=cms-new-phase5-2026-05018 --required-claim-ids=RC-043,RC-044,RC-045,RC-046,RC-047 --evidence-plan=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/cms-new-phase5-2026-05018/required_evidence_plan.json --workspace-root=/Users/guyhaikov/a2z-workspaces --project-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms --worktree-root="$WORKDIR"
```

### Acceptance Tests
- `acceptance-tests/T14-syntactic.sh`

## Story T15: /category/:slug + /page/:slug use site-aware layout wrapper
- Category: api
- Target Files: src/public/router.ts
- AC ids: T15.AC1, T15.AC2, T15.AC3
- RC ids: RC-048, RC-049, RC-050

### Test Bindings (post-implementation deterministic checks)
- T15.AC1 (command) — `grep -c 'renderLayout(' src/public/router.ts` (expects 1, parser parse_grep_count, fields: )
- T15.AC2 (test_name_regex) — name regex: `^public-router-category-page.*category`
- T15.AC3 (test_name_regex) — name regex: `^public-router-category-page.*page[_-]?slug`

### Evidence Routes After Implementation
Per-story actionable: RC-048, RC-049, RC-050. Deferred to ship: none. Skip diagnostic: none.

After committing this story, run via canonical runner:
```
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/a2z-develop/scripts/run_required_evidence_command.py --change-id=cms-new-phase5-2026-05018 --required-claim-ids=RC-048,RC-049,RC-050 --evidence-plan=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/cms-new-phase5-2026-05018/required_evidence_plan.json --workspace-root=/Users/guyhaikov/a2z-workspaces --project-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms --worktree-root="$WORKDIR"
```

### Acceptance Tests
- `acceptance-tests/T15-syntactic.sh`

## Story T16: Regression: cms.kodigital.app does not render home
- Category: infra
- Target Files: test/public-admin-host-no-home.test.ts
- AC ids: T16.AC1, T16.AC2
- RC ids: RC-051, RC-052

### Test Bindings (post-implementation deterministic checks)
- T16.AC1 (test_name_regex) — name regex: `public-admin-host-no-home`
- T16.AC2 (test_name_regex) — name regex: `^public-admin-host-no-home.*no[_-]?home`

### Evidence Routes After Implementation
Per-story actionable: RC-051, RC-052. Deferred to ship: none. Skip diagnostic: none.

After committing this story, run via canonical runner:
```
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/a2z-develop/scripts/run_required_evidence_command.py --change-id=cms-new-phase5-2026-05018 --required-claim-ids=RC-051,RC-052 --evidence-plan=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/cms-new-phase5-2026-05018/required_evidence_plan.json --workspace-root=/Users/guyhaikov/a2z-workspaces --project-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms --worktree-root="$WORKDIR"
```

### Acceptance Tests
- `acceptance-tests/T16-syntactic.sh`

## Story T17: Regression: reserved-path catch-all 404s admin/api/static/media/preview/health
- Category: infra
- Target Files: test/public-reserved-paths.test.ts
- AC ids: T17.AC1, T17.AC2
- RC ids: RC-053, RC-054

### Test Bindings (post-implementation deterministic checks)
- T17.AC1 (test_name_regex) — name regex: `^public-reserved-paths.*admin[_-]?slug[_-]?404`
- T17.AC2 (test_name_regex) — name regex: `public-reserved-paths`

### Evidence Routes After Implementation
Per-story actionable: RC-053, RC-054. Deferred to ship: none. Skip diagnostic: none.

After committing this story, run via canonical runner:
```
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/a2z-develop/scripts/run_required_evidence_command.py --change-id=cms-new-phase5-2026-05018 --required-claim-ids=RC-053,RC-054 --evidence-plan=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/cms-new-phase5-2026-05018/required_evidence_plan.json --workspace-root=/Users/guyhaikov/a2z-workspaces --project-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms --worktree-root="$WORKDIR"
```

### Acceptance Tests
- `acceptance-tests/T17-syntactic.sh`

## Story T18: Regression: no hardcoded TheIWise brand in rendered Home + Article
- Category: infra
- Target Files: test/public-no-theiwise-brand-render.test.ts
- AC ids: T18.AC1, T18.AC2, T18.AC3
- RC ids: RC-055, RC-056, RC-057

### Test Bindings (post-implementation deterministic checks)
- T18.AC1 (test_name_regex) — name regex: `^public-no-theiwise-brand-render.*home`
- T18.AC2 (test_name_regex) — name regex: `^public-no-theiwise-brand-render.*article`
- T18.AC3 (test_name_regex) — name regex: `public-no-theiwise-brand-render`

### Evidence Routes After Implementation
Per-story actionable: RC-055, RC-056, RC-057. Deferred to ship: none. Skip diagnostic: none.

After committing this story, run via canonical runner:
```
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/a2z-develop/scripts/run_required_evidence_command.py --change-id=cms-new-phase5-2026-05018 --required-claim-ids=RC-055,RC-056,RC-057 --evidence-plan=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/cms-new-phase5-2026-05018/required_evidence_plan.json --workspace-root=/Users/guyhaikov/a2z-workspaces --project-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms --worktree-root="$WORKDIR"
```

### Acceptance Tests
- `acceptance-tests/T18-syntactic.sh`

## Story T19: JSON-LD presence on Home + Article
- Category: infra
- Target Files: test/public-json-ld-presence.test.ts
- AC ids: T19.AC1, T19.AC2, T19.AC3
- RC ids: RC-058, RC-059, RC-060

### Test Bindings (post-implementation deterministic checks)
- T19.AC1 (test_name_regex) — name regex: `^public-json-ld-presence.*home`
- T19.AC2 (test_name_regex) — name regex: `^public-json-ld-presence.*article[_-]?with[_-]?faqs`
- T19.AC3 (test_name_regex) — name regex: `^public-json-ld-presence.*article[_-]?empty[_-]?faqs`

### Evidence Routes After Implementation
Per-story actionable: RC-058, RC-059, RC-060. Deferred to ship: none. Skip diagnostic: none.

After committing this story, run via canonical runner:
```
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/a2z-develop/scripts/run_required_evidence_command.py --change-id=cms-new-phase5-2026-05018 --required-claim-ids=RC-058,RC-059,RC-060 --evidence-plan=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/cms-new-phase5-2026-05018/required_evidence_plan.json --workspace-root=/Users/guyhaikov/a2z-workspaces --project-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms --worktree-root="$WORKDIR"
```

### Acceptance Tests
- `acceptance-tests/T19-syntactic.sh`

## Story T20: Image attribute + lazy-load tests
- Category: infra
- Target Files: test/public-image-attrs.test.ts
- AC ids: T20.AC1, T20.AC2
- RC ids: RC-061, RC-062

### Test Bindings (post-implementation deterministic checks)
- T20.AC1 (test_name_regex) — name regex: `^public-image-attrs.*alt[_-]?width[_-]?height`
- T20.AC2 (test_name_regex) — name regex: `^public-image-attrs.*lazy[_-]?below[_-]?fold`

### Evidence Routes After Implementation
Per-story actionable: RC-061, RC-062. Deferred to ship: none. Skip diagnostic: none.

After committing this story, run via canonical runner:
```
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/a2z-develop/scripts/run_required_evidence_command.py --change-id=cms-new-phase5-2026-05018 --required-claim-ids=RC-061,RC-062 --evidence-plan=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/cms-new-phase5-2026-05018/required_evidence_plan.json --workspace-root=/Users/guyhaikov/a2z-workspaces --project-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms --worktree-root="$WORKDIR"
```

### Acceptance Tests
- `acceptance-tests/T20-syntactic.sh`

## Story T21: Ad-slot attribute tests
- Category: infra
- Target Files: test/public-ad-slots.test.ts
- AC ids: T21.AC1, T21.AC2
- RC ids: RC-063, RC-064

### Test Bindings (post-implementation deterministic checks)
- T21.AC1 (test_name_regex) — name regex: `^public-ad-slots.*data[_-]?attrs`
- T21.AC2 (test_name_regex) — name regex: `^public-ad-slots.*leaderboard[_-]?and[_-]?in[_-]?feed`

### Evidence Routes After Implementation
Per-story actionable: RC-063, RC-064. Deferred to ship: none. Skip diagnostic: none.

After committing this story, run via canonical runner:
```
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/a2z-develop/scripts/run_required_evidence_command.py --change-id=cms-new-phase5-2026-05018 --required-claim-ids=RC-063,RC-064 --evidence-plan=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/cms-new-phase5-2026-05018/required_evidence_plan.json --workspace-root=/Users/guyhaikov/a2z-workspaces --project-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms --worktree-root="$WORKDIR"
```

### Acceptance Tests
- `acceptance-tests/T21-syntactic.sh`

## Story T22: Regression: typecheck + verify:no-legacy-prod-refs + verify:infra + verify:worker-config all exit 0
- Category: infra
- Target Files: test/verify-scripts-green.test.ts
- AC ids: T22.AC1, T22.AC2, T22.AC3, T22.AC4
- RC ids: RC-065, RC-066, RC-067, RC-068

### Test Bindings (post-implementation deterministic checks)
- T22.AC1 (command) — `cd api && npx tsc --noEmit` (expects 0, parser test_exit_code, fields: )
- T22.AC2 (command) — `cd api && npm run verify:no-legacy-prod-refs` (expects 0, parser test_exit_code, fields: )
- T22.AC3 (command) — `cd api && npm run verify:infra` (expects 0, parser test_exit_code, fields: )
- T22.AC4 (command) — `cd api && npm run verify:worker-config` (expects 0, parser test_exit_code, fields: )

### Evidence Routes After Implementation
Per-story actionable: RC-065, RC-066, RC-067, RC-068. Deferred to ship: none. Skip diagnostic: none.

After committing this story, run via canonical runner:
```
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/a2z-develop/scripts/run_required_evidence_command.py --change-id=cms-new-phase5-2026-05018 --required-claim-ids=RC-065,RC-066,RC-067,RC-068 --evidence-plan=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms/.a2z/mission-state/cms-new-phase5-2026-05018/required_evidence_plan.json --workspace-root=/Users/guyhaikov/a2z-workspaces --project-root=/Users/guyhaikov/a2z-workspaces/kodigital-homepages-cms --worktree-root="$WORKDIR"
```

### Acceptance Tests
- `acceptance-tests/T22-syntactic.sh`

