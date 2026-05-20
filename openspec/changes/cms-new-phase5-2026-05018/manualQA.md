# Manual QA: cms-new-phase5-2026-05018

_No manual QA scenarios defined in mission_draft._

Plan-writer should add scenarios to mission_draft.json before materialization.

## Test Bindings

_Render-only summary of `test_contract.json` (the typed JSON remains canonical)._

| ac_id | binding_type | binding | parser_strategy | cwd | field_refs |
|---|---|---|---|---|---|
| T1.AC1 | command | grep -c -- '--tw-ink' src/public/assets/public-css.ts | parse_grep_count | worktree_root | — |
| T1.AC2 | command | grep -c '@media (max-width:1280px)' src/public/assets/public-css.ts | parse_grep_count | worktree_root | — |
| T1.AC3 | command | grep -c 'minmax(0, 1fr)' src/public/assets/public-css.ts | parse_grep_count | worktree_root | — |
| T2.AC1 | command | grep -c 'passive: true' src/public/assets/public-js.ts | parse_grep_count | worktree_root | — |
| T2.AC2 | command | grep -c 'navigator.share' src/public/assets/public-js.ts | parse_grep_count | worktree_root | — |
| T2.AC3 | command | grep -c 'reading-progress-bar' src/public/assets/public-js.ts | parse_grep_count | worktree_root | — |
| T3.AC1 | command | grep -c 'skip-to-content' src/public/templates/layout.ts | parse_grep_count | worktree_root | — |
| T3.AC2 | command | grep -cE 'brand_tokens\|brandTokens' src/public/templates/layout.ts | parse_grep_count | worktree_root | — |
| T3.AC3 | test_name_regex | ^public-templates-layout.*brand[_-]?tokens | — | — | — |
| T4.AC1 | command | grep -cE 'export function (renderHeader\|renderHero\|renderChipRail\|renderCa... | parse_grep_count | worktree_root | — |
| T4.AC2 | command | grep -c 'data-ad-slot' src/public/templates/components.ts | parse_grep_count | worktree_root | — |
| T4.AC3 | test_name_regex | ^public-templates-components.*chip[_-]?rail | — | — | — |
| T5.AC1 | command | grep -cE 'export function (iconSearch\|iconShare\|iconCopy\|iconArrow\|iconBr... | parse_grep_count | worktree_root | — |
| T5.AC2 | command | grep -c 'aria-hidden="true"' src/public/templates/icons.ts | parse_grep_count | worktree_root | — |
| T6.AC1 | command | grep -cE 'export function (buildHomeJsonLd\|buildArticleJsonLd\|buildBreadcru... | parse_grep_count | worktree_root | — |
| T6.AC2 | command | grep -cE '"@type": *"(WebSite\|Organization\|ItemList\|Article\|BreadcrumbLis... | parse_grep_count | worktree_root | — |
| T6.AC3 | test_name_regex | ^public-templates-seo.*faq[_-]?empty | — | — | — |
| T7.AC1 | command | grep -cE 'export function (formatDate\|formatReadTime\|truncateExcerpt)' src/... | parse_grep_count | worktree_root | — |
| T7.AC2 | test_name_regex | ^public-templates-format.*truncate | — | — | — |
| T8.AC1 | command | grep -c 'export async function buildHomeViewModel' src/public/view-models/hom... | parse_grep_count | worktree_root | — |
| T8.AC2 | command | grep -c 'WHERE site_id = ?' src/public/view-models/home.ts | parse_grep_count | worktree_root | — |
| T8.AC3 | command | grep -c '\.bind(' src/public/view-models/home.ts | parse_grep_count | worktree_root | — |
| T8.AC4 | test_name_regex | ^public-view-models-home.*site[_-]?isolation | — | — | — |
| T9.AC1 | command | grep -c 'export async function buildArticleViewModel' src/public/view-models/... | parse_grep_count | worktree_root | — |
| T9.AC2 | command | grep -c 'site_id = ?' src/public/view-models/article.ts | parse_grep_count | worktree_root | — |
| T9.AC3 | command | grep -c 'adaptBodyBlocks' src/public/view-models/article.ts | parse_grep_count | worktree_root | — |
| T9.AC4 | test_name_regex | ^public-view-models-article.*content[_-]?html[_-]?fallback | — | — | — |
| T9.AC5 | test_name_regex | ^public-view-models-article.*faq[_-]?blocks | — | — | — |
| T10.AC1 | command | grep -c 'export function renderHome' src/public/templates/home.ts | parse_grep_count | worktree_root | — |
| T10.AC2 | test_name_regex | ^public-templates-home.*section[_-]?order | — | — | — |
| T10.AC3 | test_name_regex | ^public-templates-home.*brand[_-]?from[_-]?site | — | — | — |
| T11.AC1 | command | grep -c 'export function renderArticle' src/public/templates/article.ts | parse_grep_count | worktree_root | — |
| T11.AC2 | test_name_regex | ^public-templates-article.*section[_-]?order | — | — | — |
| T11.AC3 | test_name_regex | ^public-templates-article.*article[_-]?shell[_-]?minmax | — | — | — |
| T11.AC4 | test_name_regex | ^public-templates-article.*faqs[_-]?empty[_-]?no[_-]?faqpage | — | — | — |
| T12.AC1 | command | grep -c 'router.get("/",' src/public/router.ts | parse_grep_count | worktree_root | — |
| T12.AC2 | test_name_regex | ^public-router-home.*renders[_-]?home | — | — | — |
| T13.AC1 | command | grep -cE 'renderArticle\|buildArticleViewModel' src/public/router.ts | parse_grep_count | worktree_root | — |
| T13.AC2 | command | grep -c 'catch' src/public/router.ts | parse_grep_count | worktree_root | — |
| T13.AC3 | test_name_regex | ^public-router-article.*renders[_-]?article | — | — | — |
| T13.AC4 | test_name_regex | ^public-router-article.*fallback[_-]?on[_-]?throw | — | — | — |
| T14.AC1 | command | grep -cE '/assets/public\.css\|/assets/public\.js' src/public/router.ts | parse_grep_count | worktree_root | — |
| T14.AC2 | command | grep -c 'max-age=31536000, immutable' src/public/router.ts | parse_grep_count | worktree_root | — |
| T14.AC3 | test_name_regex | ^public-router-assets.*public[_-]?css | — | — | — |
| T14.AC4 | test_name_regex | ^public-router-assets.*public[_-]?js | — | — | — |
| T14.AC5 | test_name_regex | ^public-router-assets.*reserved[_-]?path[_-]?safety | — | — | — |
| T15.AC1 | command | grep -c 'renderLayout(' src/public/router.ts | parse_grep_count | worktree_root | — |
| T15.AC2 | test_name_regex | ^public-router-category-page.*category | — | — | — |
| T15.AC3 | test_name_regex | ^public-router-category-page.*page[_-]?slug | — | — | — |
| T16.AC1 | command | grep -cE 'cms\.kodigital\.app\|ADMIN_HOST' test/public-admin-host-no-home.tes... | parse_grep_count | worktree_root | — |
| T16.AC2 | test_name_regex | ^public-admin-host-no-home.*no[_-]?home | — | — | — |
| T17.AC1 | test_name_regex | ^public-reserved-paths.*admin[_-]?slug[_-]?404 | — | — | — |
| T17.AC2 | command | grep -cE 'admin\|api\|static\|media\|preview\|health' test/public-reserved-pa... | parse_grep_count | worktree_root | — |
| T18.AC1 | test_name_regex | ^public-no-theiwise-brand-render.*home | — | — | — |
| T18.AC2 | test_name_regex | ^public-no-theiwise-brand-render.*article | — | — | — |
| T18.AC3 | command | grep -cE 'thei" *\+ *"wise' test/public-no-theiwise-brand-render.test.ts | parse_grep_count | worktree_root | — |
| T19.AC1 | test_name_regex | ^public-json-ld-presence.*home | — | — | — |
| T19.AC2 | test_name_regex | ^public-json-ld-presence.*article[_-]?with[_-]?faqs | — | — | — |
| T19.AC3 | test_name_regex | ^public-json-ld-presence.*article[_-]?empty[_-]?faqs | — | — | — |
| T20.AC1 | test_name_regex | ^public-image-attrs.*alt[_-]?width[_-]?height | — | — | — |
| T20.AC2 | test_name_regex | ^public-image-attrs.*lazy[_-]?below[_-]?fold | — | — | — |
| T21.AC1 | test_name_regex | ^public-ad-slots.*data[_-]?attrs | — | — | — |
| T21.AC2 | test_name_regex | ^public-ad-slots.*leaderboard[_-]?and[_-]?in[_-]?feed | — | — | — |
| T22.AC1 | command | cd api && npx tsc --noEmit | test_exit_code | worktree_root | — |
| T22.AC2 | command | cd api && npm run verify:no-legacy-prod-refs | test_exit_code | worktree_root | — |
| T22.AC3 | command | cd api && npm run verify:infra | test_exit_code | worktree_root | — |
| T22.AC4 | command | cd api && npm run verify:worker-config | test_exit_code | worktree_root | — |
