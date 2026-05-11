# Manual QA: kodigital-homepages-cms-phase1-2026-05-09

_No manual QA scenarios defined in mission_draft._

Plan-writer should add scenarios to mission_draft.json before materialization.

## Test Bindings

_Render-only summary of `test_contract.json` (the typed JSON remains canonical)._

| ac_id | binding_type | binding | parser_strategy | cwd | field_refs |
|---|---|---|---|---|---|
| T1.AC1 | command | grep -cE 'CREATE TABLE( IF NOT EXISTS)? (articles\|article_versions\|categori... | parse_grep_count | worktree_root | — |
| T1.AC2 | command | grep -c 'TODO Phase 2: site_id' api/migrations/0001_init_cms.sql | parse_grep_count | worktree_root | — |
| T1.AC3 | command | cd api && npx wrangler d1 migrations apply kodigital-homepages-cms-db --local | test_exit_code | worktree_root | — |
| T2.AC1 | command | grep -cE '\.prepare\(`[^`]*\$\{' api/src/db/index.ts | parse_grep_count | worktree_root | — |
| T2.AC2 | command | grep -cE 'export (async )?function (getArticleBySlug\|listArticles\|getMediaB... | parse_grep_count | worktree_root | — |
| T3.AC1 | command | grep -cE "from ['\"]jose['\"]" api/src/auth/access-auth.ts | parse_grep_count | worktree_root | — |
| T3.AC2 | command | grep -cE 'expirationTtl:\s*86400' api/src/auth/access-auth.ts | parse_grep_count | worktree_root | — |
| T3.AC3 | test_file | api/test/admin-auth.test.ts | — | — | — |
| T3.AC4 | command | grep -cE '"jose":' api/package.json | parse_grep_count | worktree_root | — |
| T4.AC1 | command | grep -cE 'export (async )?function (cacheGet\|cacheSet\|cacheDel\|invalidateF... | parse_grep_count | worktree_root | — |
| T4.AC2 | command | grep -cE 'CACHE_API_ENABLED' api/src/cache/index.ts | parse_grep_count | worktree_root | — |
| T5.AC1 | command | grep -cE "case ['\"](paragraph\|heading\|list\|quote\|image\|divider\|html)['... | parse_grep_count | worktree_root | — |
| T5.AC2 | test_file | api/test/editor.test.ts | — | — | — |
| T5.AC3 | command | grep -cE 'loading="lazy"' api/src/editor/blocks.ts | parse_grep_count | worktree_root | — |
| T6.AC1 | command | grep -cE "['\"](draft\|published\|scheduled\|archived)['\"]\s*->\s*['\"](draf... | parse_grep_count | worktree_root | — |
| T6.AC2 | test_file | api/test/workflow.test.ts | — | — | — |
| T7.AC1 | command | grep -cE "subtle\.digest\(['\"]SHA-256['\"]" api/src/privacy/index.ts | parse_grep_count | worktree_root | — |
| T7.AC2 | test_file | api/test/privacy.test.ts | — | — | — |
| T7.AC3 | command | grep -cE "['\"]/api/privacy/(status\|opt-out\|opt-in)['\"]" api/src/privacy/i... | parse_grep_count | worktree_root | — |
| T8.AC1 | command | grep -cE 'public,\s*max-age=31536000,\s*immutable' api/src/media/serve.ts | parse_grep_count | worktree_root | — |
| T8.AC2 | test_file | api/test/media.test.ts | — | — | — |
| T9.AC1 | command | grep -cE "['\"](admin\|api\|static\|assets\|media\|preview\|health)['\"]" api... | parse_grep_count | worktree_root | — |
| T9.AC2 | test_file | api/test/reserved-path.test.ts | — | — | — |
| T9.AC3 | command | grep -cE "\.(get\|all)\(['\"]/(article/:slug\|category/:slug\|category/:slug/... | parse_grep_count | worktree_root | — |
| T10.AC1 | command | grep -cE "\.get\(['\"]/admin(\|/articles\|/pages\|/categories\|/tags\|/media\... | parse_grep_count | worktree_root | — |
| T10.AC2 | command | grep -cE 'OPENAI_API_KEY' api/src/admin/ai-api.ts | parse_grep_count | worktree_root | — |
| T10.AC3 | command | grep -cE "['\"]/api/admin/auth/status['\"]" api/src/admin/router.ts | parse_grep_count | worktree_root | — |
| T11.AC1 | command | grep -cE "subtle\.(sign\|verify)\(\s*['\"]?HMAC" api/src/preview/index.ts | parse_grep_count | worktree_root | — |
| T11.AC2 | command | grep -cE 'articleId\|versionId' api/src/preview/index.ts | parse_grep_count | worktree_root | — |
| T12.AC1 | command | grep -cE 'app\.route\(' api/src/index.ts | parse_grep_count | worktree_root | — |
| T12.AC2 | command | cd api && npx vitest run test/health.test.ts test/admin-auth.test.ts test/pri... | test_exit_code | worktree_root | — |
| T13.AC1 | command | grep -cE 'kodigital2\.cloudflareaccess\.com\|admin\.theiwise\.com\|7542d73ba6... | parse_grep_count | worktree_root | — |
| T13.AC2 | command | cd api && npm run verify:no-legacy-prod-refs | test_exit_code | worktree_root | — |
| T13.AC3 | command | grep -c 'a05d7505b71c6cd931e436defe670509' api/scripts/verify/assert-no-legac... | parse_grep_count | worktree_root | — |
