# Tasks: kodigital-homepages-cms-phase1-2026-05-09

## Implementation Steps

1. Add jose dep to api/package.json; npm install
2. Write api/migrations/0001_init_cms.sql; apply --local to verify schema
3. Implement api/src/db/index.ts parameterized query helpers
4. Replace api/src/auth/access-auth.ts presence-check with full JWKS+RS256 path; extend test/admin-auth.test.ts
5. Add api/src/cache/index.ts with KV helpers + Cache API stub
6. Add api/src/editor/{blocks,sanitize,index}.ts with hand-rolled allowlist; add test/editor.test.ts
7. Add api/src/workflow/{publish,index}.ts; add test/workflow.test.ts
8. Add api/src/privacy/index.ts with SHA-256 hash + 3 routes; add test/privacy.test.ts
9. Add api/src/media/{serve,upload,index}.ts with R2 ETag + cache headers; add test/media.test.ts
10. Add api/src/public/{router,reserved,feeds,sitemap}.ts; add test/reserved-path.test.ts
11. Add api/src/admin/{router,api,workflow-api,ai-api}.ts admin shell + placeholders
12. Add api/src/preview/index.ts HMAC-signed preview tokens
13. Wire api/src/index.ts: mount all routers in correct order with reserved-path guard before /:slug
14. Extend api/scripts/verify/assert-no-legacy-prod-refs.ts denylist with 5 legacy CMS identifiers
15. Run npm install + npm run typecheck + npm test + npm run verify:no-legacy-prod-refs
16. Smoke-test wrangler dev: GET /health 200, GET /admin 401, GET /api/privacy/status 200
17. Commit + push branch mission/kodigital-homepages-cms-phase1-2026-05-09; open PR

## Story Tasks

- [ ] **T1:** Initial CMS migration 0001_init_cms.sql with 11 tables and Phase-2 site_id TODO comments
  - Files: `migrations/0001_init_cms.sql`, `wrangler.toml`
- [ ] **T2:** Typed D1 query helpers in api/src/db/index.ts (parameterized only)
  - Files: `src/db/index.ts`
- [ ] **T3:** Replace presence-check auth with full CF Access JWKS+RS256 validation in api/src/auth/access-auth.ts
  - Files: `src/auth/access-auth.ts`, `package.json`, `test/admin-auth.test.ts`
- [ ] **T4:** KV cache helper with feed-key invalidation + Cache API stub in api/src/cache/index.ts
  - Files: `src/cache/index.ts`
- [ ] **T5:** Editor block engine + sanitizer (7 block types, hand-rolled allowlist) in api/src/editor/
  - Files: `src/editor/blocks.ts`, `src/editor/sanitize.ts`, `src/editor/index.ts`, `test/editor.test.ts`
- [ ] **T6:** Publish workflow state machine + version snapshot + feed invalidation in api/src/workflow/
  - Files: `src/workflow/publish.ts`, `src/workflow/index.ts`, `test/workflow.test.ts`
- [ ] **T7:** Privacy module: SHA-256(IP+UA), opt-out cookie, public unauthenticated routes in api/src/privacy/
  - Files: `src/privacy/index.ts`, `test/privacy.test.ts`
- [ ] **T8:** Media serve + upload with R2 ETag and 1y immutable Cache-Control in api/src/media/
  - Files: `src/media/serve.ts`, `src/media/upload.ts`, `src/media/index.ts`, `test/media.test.ts`
- [ ] **T9:** Public router + reserved-path guard + feeds (RSS/Atom/sitemap/robots/ads) in api/src/public/
  - Files: `src/public/router.ts`, `src/public/reserved.ts`, `src/public/feeds.ts`, `src/public/sitemap.ts`, `test/reserved-path.test.ts`
- [ ] **T10:** Admin router + CRUD/workflow/AI placeholder APIs in api/src/admin/
  - Files: `src/admin/router.ts`, `src/admin/api.ts`, `src/admin/workflow-api.ts`, `src/admin/ai-api.ts`
- [ ] **T11:** Preview route with HMAC-signed short-lived tokens in api/src/preview/
  - Files: `src/preview/index.ts`
- [ ] **T12:** Wire all routers into api/src/index.ts with reserved-path guard before /:slug
  - Files: `src/index.ts`
- [ ] **T13:** Extend assert-no-legacy-prod-refs.ts denylist with 5 legacy CMS identifiers
  - Files: `scripts/verify/assert-no-legacy-prod-refs.ts`, `test/verify-script.test.ts`

## Files Expected to Change

- `api/migrations/0001_init_cms.sql`
- `api/src/db/index.ts`
- `api/src/auth/access-auth.ts`
- `api/src/cache/index.ts`
- `api/src/editor/blocks.ts`
- `api/src/editor/sanitize.ts`
- `api/src/editor/index.ts`
- `api/src/workflow/publish.ts`
- `api/src/workflow/index.ts`
- `api/src/privacy/index.ts`
- `api/src/media/serve.ts`
- `api/src/media/upload.ts`
- `api/src/media/index.ts`
- `api/src/public/router.ts`
- `api/src/public/reserved.ts`
- `api/src/public/feeds.ts`
- `api/src/public/sitemap.ts`
- `api/src/admin/router.ts`
- `api/src/admin/api.ts`
- `api/src/admin/workflow-api.ts`
- `api/src/admin/ai-api.ts`
- `api/src/preview/index.ts`
- `api/src/index.ts`
- `api/scripts/verify/assert-no-legacy-prod-refs.ts`
- `api/test/admin-auth.test.ts`
- `api/test/editor.test.ts`
- `api/test/workflow.test.ts`
- `api/test/privacy.test.ts`
- `api/test/media.test.ts`
- `api/test/reserved-path.test.ts`
- `api/test/verify-script.test.ts`
- `api/package.json`
- `api/package-lock.json`