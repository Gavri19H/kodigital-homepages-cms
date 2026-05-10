# Proposal: kodigital-homepages-cms-phase1-2026-05-09

## Main Goal

Port the reusable CMS foundation (auth, db, media, cache, editor, workflow, ai placeholders, privacy, admin, public, preview) from the legacy Hono+TS Worker into the new standalone kodigital-homepages-cms Worker, satisfying all seven Phase 1 acceptance gates with no legacy production identifiers in active code.

- **Entity:** kodigital-homepages-cms
- **Action:** port_phase_1_cms_foundation
- **Metric:** phase_1_acceptance_gate_count == 7
- **Failure criterion:** Any of the seven Phase 1 acceptance gates failing (npm install, npm run typecheck, npm test, npm run verify:no-legacy-prod-refs, wrangler dev /health 200, /admin 401 without DEV_BYPASS_AUTH, /api/privacy/status 200), or any out-of-scope module ported (Domains UI, facelift, AI provisioning, production data migration), or any banned legacy identifier present in active source files (denylist enforced by assert-no-legacy-prod-refs.ts).

## Stories (13)

### T1: Initial CMS migration 0001_init_cms.sql with 11 tables and Phase-2 site_id TODO comments [migration]

**Target files:** `migrations/0001_init_cms.sql`, `wrangler.toml`

**Acceptance Criteria:**

- T1.AC1: Migration creates all 11 required tables (CREATE TABLE count >= 11 covering articles, article_versions, categories, tags, article_tags, pages, media, redirects, site_settings, prompt_presets, privacy_opt_outs)
- T1.AC2: Migration contains TODO Phase-2 site_id comment markers (>=1 per multi-tenant table)
- T1.AC3: BEHAVIORAL: GIVEN the new D1 binding kodigital-homepages-cms-db with no tables, WHEN `wrangler d1 migrations apply kodigital-homepages-cms-db --local` runs, THEN all 11 tables appear in the local sqlite file with the documented columns and indexes

### T2: Typed D1 query helpers in api/src/db/index.ts (parameterized only) [api]

**Target files:** `src/db/index.ts`

**Acceptance Criteria:**

- T2.AC1: All D1 calls use prepare(...).bind(...) — zero template-literal SQL interpolation in db/index.ts
- T2.AC2: Helper exposes typed exports: getArticleBySlug, listArticles, getMediaById, listCategories at minimum
- T2.AC3: BEHAVIORAL: GIVEN the new D1 helpers, WHEN getArticleBySlug("test") is called with a planted slug, THEN the row returns via prepare(...).bind(...) parameter binding (no template-literal interpolation anywhere in db/index.ts).

### T3: Replace presence-check auth with full CF Access JWKS+RS256 validation in api/src/auth/access-auth.ts [api]

**Target files:** `src/auth/access-auth.ts`, `package.json`, `test/admin-auth.test.ts`

**Acceptance Criteria:**

- T3.AC1: auth module imports jose JWKS+jwtVerify and validates exp/nbf/iss/aud/email
- T3.AC2: JWKS cache key written to KV with expirationTtl 24h (86400 seconds)
- T3.AC3: BEHAVIORAL: GIVEN APP_ENV=development AND DEV_BYPASS_AUTH=true, WHEN any /admin route is requested without a JWT, THEN the handler proceeds and returns the admin shell (200); GIVEN APP_ENV!=development OR DEV_BYPASS_AUTH unset, WHEN /admin is requested without a valid JWT, THEN response is 401
- T3.AC4: package.json adds jose as a dependency

### T4: KV cache helper with feed-key invalidation + Cache API stub in api/src/cache/index.ts [api]

**Target files:** `src/cache/index.ts`

**Acceptance Criteria:**

- T4.AC1: Module exports cacheGet, cacheSet, cacheDel, invalidateFeeds
- T4.AC2: Cache API path gated by env.CACHE_API_ENABLED before any caches.default access
- T4.AC3: BEHAVIORAL: GIVEN cacheSet("feed:rss", body) followed by invalidateFeeds(), WHEN cacheGet("feed:rss") is called, THEN it returns null (the invalidation deleted the key) — confirms KV roundtrip + invalidation behavior.

### T5: Editor block engine + sanitizer (7 block types, hand-rolled allowlist) in api/src/editor/ [api]

**Target files:** `src/editor/blocks.ts`, `src/editor/sanitize.ts`, `src/editor/index.ts`, `test/editor.test.ts`

**Acceptance Criteria:**

- T5.AC1: blocks.ts handles exactly 7 block types: paragraph, heading, list, quote, image, divider, html (and rejects 'embed') — verified semantically by editor tests covering each renderer + the unknown-type rejection path
- T5.AC2: BEHAVIORAL: GIVEN an editor JSON document containing an html block with <script>alert(1)</script>, WHEN contentJsonToHtml is called, THEN the rendered HTML contains no <script> tag and no on* attribute and no javascript: URL
- T5.AC3: Image blocks default to loading="lazy" unless data.aboveTheFold is true — verified by editor test that renders a below-fold image and asserts the resulting HTML contains loading="lazy"

### T6: Publish workflow state machine + version snapshot + feed invalidation in api/src/workflow/ [api]

**Target files:** `src/workflow/publish.ts`, `src/workflow/index.ts`, `test/workflow.test.ts`

**Acceptance Criteria:**

- T6.AC1: State transition table enumerates the legal pairs: draft->published, draft->scheduled, scheduled->published, scheduled->draft, published->archived, published->draft — verified by workflow tests that exercise each legal transition and reject illegal ones
- T6.AC2: BEHAVIORAL: GIVEN an article in draft with content_json blocks, WHEN publish() is called, THEN (a) article_versions row is inserted with snapshotted content_json, (b) articles.content_html is set to the rendered HTML, (c) articles.status='published' and published_at is set, (d) invalidateFeeds is called once

### T7: Privacy module: SHA-256(IP+UA), opt-out cookie, public unauthenticated routes in api/src/privacy/ [api]

**Target files:** `src/privacy/index.ts`, `test/privacy.test.ts`

**Acceptance Criteria:**

- T7.AC1: Privacy module uses Web Crypto subtle.digest('SHA-256', ...) for the IP+UA hash
- T7.AC2: BEHAVIORAL: GIVEN no ccpa_opt_out cookie set, WHEN POST /api/privacy/opt-out is called with IP=1.2.3.4 UA='ua/1', THEN response 200 sets Set-Cookie ccpa_opt_out=1 AND a privacy_opt_outs row exists keyed by sha256('1.2.3.4|ua/1')
- T7.AC3: All three privacy routes (/api/privacy/status, /api/privacy/opt-out, /api/privacy/opt-in) declared

### T8: Media serve + upload with R2 ETag and 1y immutable Cache-Control in api/src/media/ [api]

**Target files:** `src/media/serve.ts`, `src/media/upload.ts`, `src/media/index.ts`, `test/media.test.ts`

**Acceptance Criteria:**

- T8.AC1: GET /media/* response sets Cache-Control: public, max-age=31536000, immutable
- T8.AC2: BEHAVIORAL: GIVEN a mocked R2 binding returning httpEtag='abc123' for key foo.png, WHEN GET /media/foo.png is called, THEN response 200 has ETag header == 'abc123' AND Cache-Control: public, max-age=31536000, immutable AND Content-Type matches the R2 metadata

### T9: Public router + reserved-path guard + feeds (RSS/Atom/sitemap/robots/ads) in api/src/public/ [api]

**Target files:** `src/public/router.ts`, `src/public/reserved.ts`, `src/public/feeds.ts`, `src/public/sitemap.ts`, `test/reserved-path.test.ts`

**Acceptance Criteria:**

- T9.AC1: Reserved path list contains exactly admin, api, static, assets, media, preview, health (7 entries)
- T9.AC2: BEHAVIORAL: GIVEN no published page row with slug='admin', WHEN GET /admin is requested, THEN the request is routed to the admin handler (NOT the /:slug compatibility placeholder) — proven by response Content-Type or admin-specific marker
- T9.AC3: Public router declares all 12 required routes

### T10: Admin router + CRUD/workflow/AI placeholder APIs in api/src/admin/ [api]

**Target files:** `src/admin/router.ts`, `src/admin/api.ts`, `src/admin/workflow-api.ts`, `src/admin/ai-api.ts`

**Acceptance Criteria:**

- T10.AC1: Admin shell GETs declared for /admin, /admin/articles, /admin/pages, /admin/categories, /admin/tags, /admin/media, /admin/settings, /admin/presets
- T10.AC2: AI endpoints return 501 unless OPENAI_API_KEY is set
- T10.AC3: Admin auth-status route declared at /api/admin/auth/status
- T10.AC4: BEHAVIORAL: GIVEN admin router mounted, WHEN GET /api/admin/articles is called without CF Access JWT, THEN response is 401; WITH DEV_BYPASS_AUTH=true, response is 200 with an empty list payload; AND POST /api/admin/ai/generate-text returns 501 when OPENAI_API_KEY is unset.

### T11: Preview route with HMAC-signed short-lived tokens in api/src/preview/ [api]

**Target files:** `src/preview/index.ts`

**Acceptance Criteria:**

- T11.AC1: Preview module uses Web Crypto HMAC (subtle.sign with HMAC) for token signing — no jose, no full JWT
- T11.AC2: Token payload encodes articleId, versionId, exp
- T11.AC3: BEHAVIORAL: GIVEN preview HMAC secret PREVIEW_SECRET set, WHEN GET /preview/<articleId> is called with a valid signed token (matching articleId+versionId+exp), THEN response is 200 rendering the draft content; WITH a tampered or expired token, response is 401.

### T12: Wire all routers into api/src/index.ts with reserved-path guard before /:slug [api]

**Target files:** `src/index.ts`

**Acceptance Criteria:**

- T12.AC1: index.ts mounts all sub-routers (admin, public, privacy, media, preview)
- T12.AC2: BEHAVIORAL: GIVEN wrangler dev running locally with DEV_BYPASS_AUTH unset, WHEN curl GET /health and curl GET /admin and curl GET /api/privacy/status, THEN /health returns 200 AND /admin returns 401 AND /api/privacy/status returns 200

### T13: Extend assert-no-legacy-prod-refs.ts denylist with 5 legacy CMS identifiers [script]

**Target files:** `scripts/verify/assert-no-legacy-prod-refs.ts`, `test/verify-script.test.ts`

**Acceptance Criteria:**

- T13.AC1: Denylist additions present: kodigital2.cloudflareaccess.com, admin.theiwise.com, legacy CF_ACCESS_AUD, legacy D1 id, legacy KV id
- T13.AC2: Verify script exits 0 against the current worktree (no banned identifiers in active code)
- T13.AC3: Shared account_id a05d7505b71c6cd931e436defe670509 is NOT added to the denylist (must remain allowed)

## Alternatives Considered

### JWT verification library for CF Access

**Chosen:** jose (Workers-compatible, ESM, used by Cloudflare's own examples)
**Rationale:** jose is the smallest Workers-compatible jwt+JWKS lib, supports remote JWKS with caching, and avoids the high-risk hand-roll of RS256 signature verification. jsonwebtoken depends on Node crypto and won't run in the Worker runtime.
**Alternatives:**
- Hand-rolled WebCrypto RS256 + manual JWKS parsing
- jsonwebtoken (Node-only, not Workers-compatible)

### HTML sanitizer for editor html-block output

**Chosen:** Hand-rolled regex allowlist (tags, attrs, URL schemes) sized to legacy parity
**Rationale:** Workers runtime has no DOM. dompurify needs jsdom (huge + not edge-friendly). The legacy code uses a regex allowlist; we replicate that pattern with explicit tests asserting <script>, on* attributes, and javascript: URLs are stripped.
**Alternatives:**
- dompurify (DOM-required, not Workers-runtime)
- isomorphic-dompurify (jsdom dependency, heavy bundle)

### Preview token format

**Chosen:** HMAC-SHA256 over articleId|versionId|exp using PREVIEW_SECRET
**Rationale:** Preview tokens are short-lived and never leave the surface; HMAC keeps the signing path one Web Crypto call without depending on jose. Avoids KV round-trip for ephemeral previews.
**Alternatives:**
- Full JWT signed with jose (extra dep coupling, larger payload)
- Random URL-only signed token + KV lookup (extra KV write per preview)

### AI endpoint behavior when OPENAI_API_KEY unset

**Chosen:** Return 501 Not Implemented with explanatory JSON body
**Rationale:** User spec line 104 prohibits calling OpenAI in Phase 1 unless OPENAI_API_KEY exists. 501 is the honest signal; mock 200 hides the wiring gap and risks downstream consumers caching fake responses.
**Alternatives:**
- Return 200 with mock body (encourages downstream to wire real calls prematurely)
- Return 200 + always call OpenAI (Phase 1 explicitly defers AI provisioning)

### Behavior of /:slug compatibility route

**Chosen:** Return 404 unless slug matches a published page row; reserved paths short-circuit to 404 before this lookup
**Rationale:** The legacy compatibility surface is a placeholder; 404 for non-pages is the safe default. Reserved-path guard MUST run first to keep /admin etc. from leaking into this lookup.
**Alternatives:**
- Always render-as-page (ambiguous: every URL becomes a page)
- 301 redirect to /page/:slug (breaks legacy bookmarks for content not yet ported)

### Verify denylist extension scope

**Chosen:** Add legacy team-domain (kodigital2.cloudflareaccess.com), legacy admin host (admin.theiwise.com), legacy CF_ACCESS_AUD hex, legacy D1 id, legacy KV id; do NOT add the shared account_id a05d7505b71c6cd931e436defe670509
**Rationale:** Shared account_id is allow-listed by orchestrator instructions; banning it would break the new Worker's own deploy. Other 5 identifiers are legacy-only and would create cross-tenant config leak if copied.
**Alternatives:**
- Tighten only legacy hostname (insufficient — IDs leak through copied code)
- Add account_id a05d7505b71c6cd931e436defe670509 to denylist (would break this Worker — shared account)

### D1 query helper architecture

**Chosen:** Thin parameterized prepare/bind wrappers, no ORM
**Rationale:** Wrappers centralize the workspace D1 safety rules (?? for numeric defaults, parameterized only, JSON.parse wrapped with try/catch + cache-miss recovery) without the Workers-bundle cost of an ORM.
**Alternatives:**
- Full SQL builder (e.g. drizzle, kysely) — Workers compat varies, increases bundle size
- Inline prepare/bind at every call site — repeats ?? defaults and JSON.parse safety patterns

## Risk Assessment

- **Auth required:** Cloudflare Access for /admin, Cloudflare Access for /api/admin/*
- **Mutating actions:** wrangler d1 migrations apply kodigital-homepages-cms-db --local (local sqlite only)

## Rollback Plan

Revert merge commit of mission/kodigital-homepages-cms-phase1-2026-05-09 on main (single squash commit). Phase 1 introduces no production data; KV CACHE namespace can be cleared via Dashboard if stale; if 0001_init_cms.sql was applied to remote D1, run `npx wrangler d1 execute kodigital-homepages-cms-db --remote --command 'DROP TABLE IF EXISTS articles; DROP TABLE IF EXISTS article_versions; DROP TABLE IF EXISTS categories; DROP TABLE IF EXISTS tags; DROP TABLE IF EXISTS article_tags; DROP TABLE IF EXISTS pages; DROP TABLE IF EXISTS media; DROP TABLE IF EXISTS redirects; DROP TABLE IF EXISTS site_settings; DROP TABLE IF EXISTS prompt_presets; DROP TABLE IF EXISTS privacy_opt_outs;'` (safe — Phase 1 carries no tenant data). R2 MEDIA bucket retains uploaded objects; can be purged separately if needed.

## Source Pack Summary

_Render-only summary of `source_pack.json` (the typed JSON remains canonical)._

| source_id | source_type | staleness_policy | used_for | evidence_summary |
|---|---|---|---|---|
| SP-USER-1 | user_request | pinned | field_contract.fields[], interface_contract.endpoints[], interface_contract.endpoints[].forbidden_substitutes[] | User-provided Phase 1 spec at /Users/guyhaikov/Downloads/phase-1-homepage-cms.md naming routes, modules, schema table... |
| SP-LOCAL-1 | local_doc | pinned | field_contract.fields[], interface_contract.endpoints[] | Authoritative mission brief: lists every required active route (/health, /admin, /api/admin/auth/status, /api/privacy... |
| SP-LOCAL-2 | local_doc | pinned | field_contract.fields[] | Legacy CMS technical reference describing the Hono+TS Worker contracts being ported: editor block taxonomy, workflow ... |
| SP-LOCAL-3 | local_doc | pinned | field_contract.fields[].forbidden_substitutes, interface_contract.endpoints[].forbidden_substitutes[] | Hard red-line listing legacy production identifiers and apps the Phase 1 port must not touch (insureprimo, quotesRout... |
| SP-CODE-1 | code_probe | refresh_per_invocation | field_contract.fields[] | Phase 0 api/src/{index.ts,env.ts,auth/access-auth.ts,wrangler.toml} probed by plan-writer at A.6a: confirms the place... |
| SP-MILESTONE-1 | project_milestone | project_milestone_locked | interface_contract.endpoints[] | Phase 0 merge commit fd0df5c on main of kodigital-homepages-cms: scaffold + Cloudflare resource bindings (D1 kodigita... |

## Interface Contract Summary

_Render-only summary of `interface_contract.json` (the typed JSON remains canonical)._

| name | method | path | request_fields | response_fields | redirect_params | forbidden_substitutes |
|---|---|---|---|---|---|---|
| Health | GET | /health |  | ok |  | — |
| AdminHome | GET | /admin | cf_access_jwt_assertion | content_type |  | DEV_BYPASS_AUTH: DEV_BYPASS_AUTH=true MUST NOT be honored; CF_ACCESS_TEAM_DOMAIN: Legacy theiwise tenant domain; banned by |
| AdminAuthStatus | GET | /api/admin/auth/status |  | status |  | — |
| PrivacyStatus | GET | /api/privacy/status |  | opted_out |  | — |
| PrivacyOptOut | POST | /api/privacy/opt-out | cf_connecting_ip, user_agent | opted_out |  | — |
| PrivacyOptIn | POST | /api/privacy/opt-in |  | opted_out |  | — |
| MediaServe | GET | /media/* | if_none_match | cache_control, etag, content_type |  | — |
| Preview | GET | /preview/:id | id, preview_token | content_html, content_type |  | — |
| PublicRoot | GET | / |  | content_type |  | — |
| PublicArticleSlug | GET | /article/:slug | slug | content_html, content_type |  | — |
| PublicCategory | GET | /category/:slug | slug, page | content_type |  | — |
| FeedRss | GET | /feed.xml |  | content_type |  | — |
| Sitemap | GET | /sitemap.xml |  | content_type |  | — |
| AdminArticlePublish | POST | /api/admin/articles/:id/publish | id | status, published_at |  | — |
