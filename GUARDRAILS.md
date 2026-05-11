# GUARDRAILS — kodigital-homepages-cms-phase1-2026-05-09

Read these guardrails BEFORE implementing any story.
They are category-filtered from past mission failures and production rules.

## HARD RED LINE — forbidden refs (Phase B Ralph context — restated by T32)

The following identifiers MUST NOT appear in any committed source file under
`api/src/**`, admin templates, route handlers, wrangler.toml `name`/binding
values, KV/D1/R2 binding names, npm script bodies, or freshly authored verify
scripts. They are legacy-production references from the predecessor stack and
are scanned by `cd api && npm run verify:no-legacy-prod-refs`. Banned tokens:

- `theiwise.com` — legacy public hostname (Phase 3 public hosts are per-site).
- `a2z-cf-cms-v1-api` — legacy Worker name (Phase 3 Worker is `kodigital-homepages-cms-api`).
- `a2z-cf-cms-v1-db` — legacy D1 database name (Phase 3 is `kodigital-homepages-cms-db`).
- `insureprimo` — legacy vertical/funnel (not part of Phase 3 multi-site verticals).
- `psychic-quiz` — legacy quiz funnel (not part of Phase 3 multi-site verticals).
- `rental-booking` — legacy funnel (not part of Phase 3 multi-site verticals).

Allowed exceptions (verify script self-excludes these):
- The Cloudflare account UUID `44c73f76-6ed5-4b26-b442-6c2044326c4d` is reused by
  Phase 3 as `account_id` in `wrangler.toml`, CI workflow files, docs, and the
  verify script itself — it is NOT in the banned scan set.
- Reference docs that document the legacy stack and the no-touch contract:
  `docs/source-architecture.md`, `docs/no-touch-red-line.md`,
  `docs/reference/current-theiwise-technical-spec.md`.
- This GUARDRAILS.md file restates the banned tokens (this section) and the
  progress.txt Codebase Patterns entry lists them — both are reference-only
  and excluded from the verify scan.

If a Phase B story incidentally introduces one of the banned tokens in source,
the verify script will fail and the story is NOT done — rename or remove the
reference before mark-implemented.

## API Safety Rules
- All user input must be validated at system boundary.
- Error responses must not leak stack traces or internal paths.
- CORS: explicit origin whitelist, not wildcard.
- Rate limiting: check existing middleware before adding new.

## Relevant Learnings

### L-004: D1 silent failures: schema mismatch, missing migrations, binding limits `[DB]` `universal`
> 2026-02-10 | occurs: 1 | via: unknown
**Rule:** Architect phase produces `schema.sql`; DB+Security reviewer cross-references every column against TS interfaces and SQL queries. Architect flags `Promise.all` over D1 queries — recommend individual try/catch. Any `IN (?)` with dynamic array must batch in chunks of ≤80.
**Check:** For each table in schema.sql, confirm all columns in TS interface + INSERT/UPDATE. `grep -n 'IN (' api/src/**/*.ts` — verify bounded or batched.

### L-023: JSON.parse of cached data must handle corruption gracefully `[DB]` `universal`
> 2026-02-13 | occurs: 1 | via: unknown
**Rule:** `JSON.parse` of cached data needs dedicated try/catch that: (1) deletes corrupt cache entry, (2) falls through to authoritative source, (3) logs warning. NEVER return stale/default data when source is available.
**Check:** `grep -B2 -A5 'JSON.parse' <cache-handler>.ts` — every cache parse has own try/catch with invalidation.

### L-139: DO stuck-timeout re-dispatch overwrites storage sync_mode causing CH revenue double-ingestion `[DB]` `kodigital`
> 2026-04-13 | occurs: 1 | via: dashboard-ch-data-issue-2026-04-13 (ship)
**What happened:** PR #150 added mirrorCreatives + uploadR2Assets to DOs (40-60s processing). This exceeded SyncDispatcher's 8-min stuck timeout, triggering re-dispatch without explicit `type` field. The /sync handler's else-branch unconditionally wrote `sync_mode='full'`, causing DOs to run revenue ingestion alongside the centralized cron — 3x-4x CH inflation on Apr 11.
**Root cause:** The /sync fetch handler had an unconditional `else { storage.put('sync_mode', 'full') }` that treated any untyped request as a full sync. Stuck-timeout re-dispatches arrive without type, so every timeout recovery overwrote the mode.
**Guardrail:** When adding processing time to DOs, verify SyncDispatcher stuck-timeout threshold vs new worst-case processing time. Any /sync handler must only write sync_mode when `body.type` is explicitly provided — never on an else branch. Review must check: does any storage write path trigger on absence of input?
**Check:** `grep -n "sync_mode.*=.*'full'" api/src/do/fb-account-sync.ts` — must return 0 (no unconditional overwrite to 'full')

## [API] Backend (3 entries)

### L-002: Use `??` not `||` for numeric defaults `[API]` `universal`
> 2026-02-10 | occurs: 1 | via: unknown
**Rule:** All numeric defaults must use `??`. DB+Security reviewer checks for `|| <number>` patterns. PRD acceptance criteria must specify `??` for numeric defaults. Pre-existing `||` numeric patterns → QA_BLOCKER entry.
**Check:** `grep -n '|| [0-9]' <file>` — 0 matches for config/settings fields.

### L-032: Revenue attribution: each row → exactly one entity level `[API]` `project`
> 2026-03-02 | occurs: 1 | via: unknown
**Rule:** Most-granular-wins: attribute to `ad_id` if present, else `adset_id`, else skip. Each row's value at exactly ONE level. `grep -c 'filter(Boolean)' <file>` = 0 for attribution loops.
**Check:** `grep -c 'filter(Boolean)' api/src/lib/ko-stats-revenue.ts` returns 0.

### L-033: Multi-tenant hostname routing requires mounting routes in EACH sub-app `[API]` `universal`
> 2026-03-04 | occurs: 1 | via: unknown
**Rule:** When adding features to multi-tenant Worker with shared API routes, plan phase verifies route is mounted in ALL sub-apps serving the relevant hostname. Architect includes "routing coverage" check.
**Check:** `grep -c '<route-path>' api/src/<sub-app>/index.ts` ≥ 1 for each sub-app. Post-deploy: curl each hostname returns 200.


## [UI] Frontend (4 entries)

### L-013: Async modal population causes race condition `[UI]` `project`
> 2026-02-10 | occurs: 1 | via: unknown
**Rule:** Functions that trigger async work (fetch, setTimeout) and whose callers depend on the result must return a Promise. Callers must `await`.
**Check:** Review confirms async modal/form population functions return Promises.

### L-014: ES6+ syntax in admin inline scripts breaks older browsers `[UI]` `project`
> 2026-02-10 | occurs: 1 | via: unknown
**Rule:** ES5 only in inline `<script>` blocks for admin templates. UI reviewer runs `grep -E 'let |const |=>|\`|\\?\\.|\?\?' ` against script block content.
**Check:** `grep -E 'let |const |=>' <admin-template>.ts` inside script blocks — 0 matches.

### L-027: Backslash escaping lost in TypeScript template literals `[UI]` `project`
> 2026-02-17 | occurs: 1 | via: unknown
**Rule:** Inline JS regex in TypeScript template literals must double-escape: `\\d`, `\\w`, `\\s`, `\\b`. Review greps for single-backslash patterns in backtick strings.
**Check:** Evaluate rendered regex in-browser via `functionName.toString()` — confirm backslashes present.

### L-008: Deploy success ≠ correct code running `[DEPLOY]` `universal`
> 2026-02-10 | occurs: 1 | via: unknown
**Rule:** Finish phase MUST include `git pull origin main` before any deploy command. Post-deploy verification must include at least one behavior-specific assertion (not just HTTP 200 + keyword). Deploy instruction: `git pull origin main && cd api && npx wrangler deploy`.
**Check:** Deploy output `Vars:` section shows expected values. Post-deploy curl tests a specific behavioral change from the mission.

### L-019: KV namespace population is a user-action gate `[DEPLOY]` `project`
> 2026-02-10 | occurs: 1 | via: unknown
**Rule:** When a story depends on external data population (KV, D1 seed, API keys), architect adds `prerequisite_actions` to prd.json. Verify checks prerequisites. ManualQA marks unmet prerequisites as BLOCKED (not FAIL).
**Check:** prd.json stories with `prerequisite_actions` — verify phase warns if unmet.


## [SECURITY] Security (6 entries)

### L-003: Error sanitization: both API responses AND server logs `[SECURITY]` `universal`
> 2026-02-10 | occurs: 1 | via: unknown
**Rule:** All catch blocks in route handlers must return generic error messages. When truncation/redaction is required, apply to BOTH return values AND `console.log`/`console.error` in the same function.
**Check:** `grep -n 'detail:' <handler>.ts` in catch blocks — 0 raw error messages. `grep -n 'console.error.*responseBody' <adapter>.ts` — all must include `.substring(0, N)`.

### L-015: CORS wildcard applied globally instead of scoped to public routes `[SECURITY]` `project`
> 2026-02-10 | occurs: 1 | via: unknown
**Rule:** CORS middleware scoped to specific route groups, not globally. Admin routes: no wildcard CORS.
**Check:** `grep -n 'cors' index.ts` — CORS only on public route groups.

### L-124: JWT claim guards must use typeof checks, not truthiness — `if (val && ...)` skips falsy 0 `[SECURITY]` `universal`
> 2026-04-08 | occurs: 1 | via: campgen-security-auth-bypass-hardening (CQ-W2)
**What happened:** JWT validation used `if (iat && now - iat > 86400)` which treats `iat: 0` as falsy, silently skipping the 24-hour window check. A crafted token without `iat` or with `iat: 0` would bypass the temporal validation entirely. Same pattern applied to `nbf`. Meanwhile, `exp` was also optional — missing `exp` meant the token never expired.
**Root cause:** Security-critical JWT claims were validated with truthiness guards (`if (val && ...)`) instead of type-safe guards. JavaScript's falsy semantics (`0`, `""`, `null`, `undefined` all falsy) make truthiness checks unsafe for numeric JWT claims where 0 is technically valid.
**Guardrail:** JWT claim validation must use `typeof val === 'number'` for numeric claims (iat, exp, nbf) and explicit presence checks (`!== undefined`) for string claims (iss, sub). Security-critical claims (exp, iss) should be mandatory: `if (!exp) throw`. DB+Security reviewer checks all `if (claim &&` patterns in JWT/token validation code.
**Check:** `grep -n 'if (.*iat\|.*exp\|.*nbf' <jwt-handler>.ts` — every match uses `typeof === 'number'` or explicit throw for missing. Zero `if (val &&` patterns on security claims.

### L-125: Dev bypass flags need double-gating: flag value + ENVIRONMENT check `[SECURITY]` `universal`
> 2026-04-08 | occurs: 1 | via: campgen-security-auth-bypass-hardening (T1)
**What happened:** `DEV_BYPASS_AUTH` was gated only by its own value (`if (DEV_BYPASS_AUTH === 'true')`). If the env var leaked into production config (wrangler.toml, dashboard vars, or .env), any request would bypass auth in production. The mission added a mandatory `ENVIRONMENT !== 'production'` second gate.
**Root cause:** Single-gate bypass relies on operational discipline (don't set the var in production) rather than defense-in-depth. Env vars can leak via copy-paste, template inheritance, or dashboard misconfig.
**Guardrail:** Any dev-mode bypass (auth bypass, debug logging, mock services) must be double-gated: (1) the bypass flag value AND (2) an ENVIRONMENT/NODE_ENV check. Plan phase AC must verify both conditions are present in the guard. Pattern: `flag === 'true' && env !== 'production'`.
**Check:** `grep -n 'DEV_BYPASS\|DEV_MODE\|DEBUG_MODE' <auth-file>.ts` — every match has `ENVIRONMENT` or `NODE_ENV` on the same line or adjacent guard.

### L-126: Security-relevant config must be in env vars, not hardcoded — especially when security impact increases `[SECURITY]` `universal`
> 2026-04-08 | occurs: 1 | via: campgen-security-auth-bypass-hardening (DS-W2)
**What happened:** `teamDomain = 'https://kodigital2.cloudflareaccess.com'` was hardcoded in auth.ts. Pre-existing and low-impact when only used for JWKS endpoint construction. But when the mission added issuer (`iss`) validation against this value, the security impact increased: a hardcoded string can't be rotated without code deployment, and it couples the security boundary to a specific CF Access instance.
**Root cause:** Config that starts as "just a URL" gets promoted to a security boundary over time. No review gate checks whether values used in authentication/authorization are environment-configurable.
**Guardrail:** DB+Security reviewer must flag any hardcoded string used in auth/authz decisions (issuer URLs, audience IDs, trusted domains, allowed origins). If the value participates in a security check, it must be an env var. Plan phase: any auth-hardening mission must audit all hardcoded strings in the auth path for env-var promotion.
**Check:** `grep -n "const.*= '" <auth-middleware>.ts` in auth/security files — 0 hardcoded string assignments for values used in validation logic.

### L-153: CSP connect-src must include FB CAPI client-side gateway domains or events silently fail `[SECURITY]` `project`
> 2026-04-16 | occurs: 1 | via: psychic-quiz-answer-validation (MQAFIX-1, ship cycle 2)
**What happened:** Playwright console during MQA-6 showed CSP connect-src violations for `mpc-prod-*.us-central1.run.app/events` and `demo-1.conversionsapigateway.com/events`. FB CAPI client-side events were silently dropped — no server-side error, no user-visible failure, zero tracking data. 33 console errors across 6 Playwright runs.
**Root cause:** CSP `connect-src` directive on `/quotes/psychic-quiz` route only included `'self'` and `https://www.google-analytics.com`. FB CAPI gateway uses Google Cloud Run (`*.us-central1.run.app`) and a custom domain (`demo-1.conversionsapigateway.com`) — both missing from connect-src.
**Guardrail:** Plan phase for any route with FB CAPI / server-side events gateway MUST check CSP connect-src includes ALL gateway domains. This is silent-failure territory — no error visible without Playwright console inspection or `wrangler tail` (server-side events only). Review phase: grep CSP headers for routes with FB Pixel integration.
**Check:** `curl -sI <route-url> | grep 'content-security-policy' | grep -oE 'connect-src[^;]+' | grep -cE 'us-central1\\.run\\.app|conversionsapigateway\\.com'` returns 2 (both domains present).

## [PROCESS] Pipeline (13 entries)

### L-024: Deferred manualQA (post-deploy) works for backend-only changes `[PROCESS]` `universal`
> 2026-02-13 | occurs: 1 | via: unknown
**Rule:** For missions with all backend/API stories (no UI), phase-status.json defaults manualQA to "deferred_to_post_deploy". Finish proceeds with other 3 gates. ManualQA runs post-deploy as penultimate phase.
**Check:** phase-status.json `manualQA.status` = "deferred_to_post_deploy" → finish doesn't block. ManualQA report confirms ran against production.

### L-028: ManualQA fix cycles create recurring merge conflicts `[PROCESS]` `universal`
> 2026-02-17 | occurs: 1 | via: unknown
**Rule:** After each squash merge in multi-round fix cycle, next run phase starts with `git fetch origin main && git merge origin/main`. Finish script includes pre-push merge-from-main when branch has prior merged PRs.
**Check:** After finish merges PR, `git log --oneline origin/main..HEAD` — if empty, synced. If not, merge main first.

### L-035: Docs-only missions benefit from agent-team review `[PROCESS]` `universal`
> 2026-03-04 | occurs: 1 | via: unknown
**Rule:** Docs-only missions with medium+ complexity (>3 files or DB/architecture references) should use agent-team review. DB+Security reviewer valuable for docs referencing table/column names. Skip UI reviewer for docs-only.
**Check:** phase-status.json shows `review.mode: "agent-team"` for docs-only medium+ missions.

### L-038: Executable AC scripts eliminate self-judgment bias in verify phase `[PROCESS]` `universal`
> 2026-03-31 | occurs: 1 | via: unknown
**Rule:** Plan generates AC scripts from prd.json. Architect hardens them. Run freezes them (chmod a-w, immutable). Verify runs them via subprocess (agent removed from execution path). Exit codes are authoritative: 0=PASS, 1=FAIL, 2=NEEDS_RUNTIME. NEEDS_RUNTIME on mainGoal = BLOCKER. Agent cannot override script FAIL.
**Check:** After verify, `acceptance-tests/results.json` exists. No story with script exit=1 has qa-report PASS. `grep "NEEDS_RUNTIME" results.json` on mainGoal story = verify BLOCKS.


## [TESTING] Testing (8 entries)

### L-009: ManualQA PASS requires comprehensive coverage `[TESTING]` `universal`
> 2026-02-11 | occurs: 1 | via: unknown
**Rule:** Coverage gate: enumerate ALL scenarios from `manualQA.md`, confirm each has section in report. Any SKIP/BLOCKED/missing → FAIL. Require ≥2 geographically distinct ZIPs. Conditional fixes need bidirectional validation (positive + negative). Every /listings test batch needs corresponding wrangler tail file. Hard Rule: "No /listings scenario is PASS without both client-side AND server-side evidence."
**Check:** Diff scenario list in `manualQA.md` vs section headers in `manualQA-report.md`. `grep -c 'ZIP\|zip' manualQA-report.md` shows multiple ZIPs.

### L-029: ManualQA must account for post-deploy cron timing `[TESTING]` `universal`
> 2026-02-22 | occurs: 1 | via: unknown
**Rule:** For cron-dependent features, manualQA must include "wait for first sync" step: check sync status endpoint and wait for at least one cycle post-deploy. Note cron interval in manualQA.md.
**Check:** manualQA.md for sync-dependent features includes pre-test sync wait. Report notes sync timestamp baseline.

### L-031: ManualQA must never PASS with broken primary page `[TESTING]` `universal`
> 2026-03-02 | occurs: 1 | via: unknown
**Rule:** Hard Rule: if any primary page (campaigns, analytics, automation, creatives) returns non-200 or shows unexpected "No data", verdict is FAIL regardless of whether current mission touched that code.
**Check:** manualQA-report.md shows HTTP 200 for all primary dashboard pages.

### L-007: CDN cache: use cache-busting for post-deploy testing  `universal`
> 2026-02-10 | occurs: 1 | via: unknown
**Rule:** ALL post-deploy HTTP requests must append `?_cb=<timestamp>`. Playwright tests against CDN-cached endpoints must use route interception: `page.route('**/config', route => route.fetch({headers:{'Cache-Control':'no-store'}}).then(r => route.fulfill({response:r})))`. ManualQA pre-deploy must note "PRE-DEPLOY" and defer HTTP tests. Finish phase curl commands include `?_cb=$(date +%s)`.
**Check:** Verify `cf-cache-status: MISS` or `DYNAMIC` on cache-busted requests. ManualQA report header shows deployment status.

### L-039: Known coding standards still violated in new adapter code `[API]` `universal`
> 2026-04-01 | occurs: 1 | via: insureprimo-fix-px-request
**What happened:** BLOCKER-2 in review found `Number(body.session_length) || 0` in brand new px.ts adapter code — violating L-002 (`??` not `||`). The learning existed for 7 weeks but was still ignored in fresh code.
**Root cause:** Learnings are read by plan/review phases but not enforced by code-writing agents. Ralph doesn't have a pre-write check for known anti-patterns.
**Guardrail:** Plan phase must generate an AC for every new API/handler file: `grep -c '|| [0-9]' <new-file>` returns 0. Review automated check for `|| [0-9]` pattern in diff-added lines (not just existing code).
**Check:** `grep '|| [0-9]' <new-adapter>.ts` — 0 matches. prd.json AC for new files includes anti-pattern grep.

### L-040: Refactoring WARN-FIX stories invalidate original stories' file-path ACs `[PROCESS]` `universal`
> 2026-04-01 | occurs: 1 | via: insureprimo-fix-px-request
**What happened:** T2-AC7 expected `apiToken` in listings.ts, but WARN-FIX-2 explicitly removed it (moved to env read). FIX-1-AC3 expected `session_length ??` in listings.ts, but WARN-FIX-1 extracted the helper to px.ts. Both ACs pointed to wrong files after refactoring.
**Root cause:** WARN-FIX stories are generated by review AFTER original story ACs are written and frozen. No mechanism to reconcile AC file paths when code moves between files.
**Guardrail:** Verify phase should classify AC failures as "AC DEFINITION MISMATCH" (not implementation failure) when: (a) the refactoring story's own ACs pass, AND (b) the original behavior exists in the new location. qa-report must document the mismatch explicitly.
**Check:** qa-report.md "AC Definition Mismatch Analysis" section exists when WARN-FIX stories moved code.

### L-041: Partner API redirect URLs must be scheme-validated `[SECURITY]` `universal`
> 2026-04-01 | occurs: 1 | via: insureprimo-fix-px-request
**What happened:** PX API `RedirectUrl` was used directly as `c.redirect(data.RedirectUrl, 302)` without URL scheme validation. If partner API compromised, users could be redirected to malicious URLs (javascript:, data:, phishing domains).
**Root cause:** Trusted partner APIs assumed to always return safe URLs. No defensive coding for external redirect targets.
**Guardrail:** Any `c.redirect()` or `window.location` with a URL from an external API response MUST validate `startsWith('https://')` before use. DB+Security reviewer checks all redirect targets.
**Check:** `grep -B2 'c.redirect\|window.location' <handler>.ts` — every external URL has scheme validation.

### L-042: Env secrets must not be cached in KV/transient storage `[SECURITY]` `universal`
> 2026-04-01 | occurs: 1 | via: insureprimo-fix-px-request
**What happened:** `PX_API_TOKEN` was stored in KV session alongside transactionId and pingPayload. One KV read would expose the credential for all PX interactions. The token is env-level (same for all sessions), so caching added no value.
**Root cause:** Convenience — storing everything needed for redirect-time post in one KV object. No distinction between session-specific data and shared secrets.
**Guardrail:** Architect checklist: "Does any env secret get written to KV/cache? If yes, read from env at use-time instead." Review DB+Security checker flags `env.<SECRET>` values flowing into KV.put/cache.put.
**Check:** `grep -n 'env\.\(API_TOKEN\|SECRET\|PASSWORD\|KEY\)' <file>.ts` in KV.put context — 0 matches.

### L-012: LLM-generated docs: cross-reference all names and paths against repo  `universal`
> 2026-03-04 | occurs: 1 | via: unknown
**Rule:** For docs-only missions, run phase must cross-reference EVERY table name against `grep 'CREATE TABLE' api/migrations/*.sql` and verify every file path in References sections actually exists. Applies to prose, Mermaid diagrams, and inline references.
**Check:** `grep -oP '\`[^\`]+\.(ts|md|sql|json)\`' docs/**/*.md | while read p; do test -f "${p//\`/}" || echo "BROKEN: $p"; done` — 0 broken refs.


## 2026-04-01 — campgen-foundation

### L-043: Hono sub-router architecture invalidates monolithic AC grep patterns `[PROCESS]` `universal`
> 2026-04-01 | occurs: 1 | via: campgen-foundation
**What happened:** 5 out of 17 story ACs used grep patterns like `grep '/api/v1/presets'` or `grep 'app.get'`, but Hono sub-router architecture splits routes across files mounted via `app.route('/presets', presets)`. The Hono instance in each file is named after its domain (e.g., `presets.get('/')` not `app.get('/api/v1/presets')`). Half the stories had AC pattern mismatches requiring manual correction during verify.
**Root cause:** Plan/architect phase generated AC grep patterns assuming monolithic route registration without checking the actual routing architecture (Hono sub-router with `app.route()` mounting).
**Guardrail:** Plan phase must detect routing architecture first: `grep -c 'app.route(' api/src/index.ts` — if > 0, AC grep patterns must target sub-router file-local patterns (e.g., `presets.get('/')`), not full path patterns. Architect must verify each AC grep against actual code during hardening.
**Check:** After architect phase, run each AC grep pattern against the target file — 0 false negatives from architecture mismatch.

### L-044: FB API version-specific field requirements cause runtime failures `[API]` `project`
> 2026-04-01 | occurs: 1 | via: campgen-foundation
**What happened:** 4 bugs found during manualQA recovery #2: (1) `is_adset_budget_sharing_enabled` required by v25.0, (2) empty `targeting: {}` rejected — needs at least `geo_locations`, (3) `bid_strategy` enum values differ between versions (LOWEST_COST_WITHOUT_CAP vs LOWEST_COST), (4) batch API returned null responses for some endpoints requiring sequential direct calls.
**Root cause:** Code was written against FB API docs without testing against live v25.0 endpoint. Mocked tests passed but real API rejected the payloads.
**Guardrail:** For any mission involving FB Marketing API: manualQA MUST include at least one live API call with real credentials. AC scripts cannot validate FB API compliance — only live calls can. Plan must flag `FB_API_LIVE_TEST: required` in manualQA.md.
**Check:** manualQA-report.md for FB API stories shows actual HTTP response from `graph.facebook.com`, not just mocked test results.

### L-045: Hono route registration order determines routing behavior `[API]` `universal`
> 2026-04-01 | occurs: 1 | via: campgen-foundation
**What happened:** All routes returned 404 during manualQA. Root cause: `app.route()` calls were positioned before sub-router definitions were complete. In Hono, route registration order matters — mounting must happen after all route handlers are defined on the sub-router.
**Root cause:** No runtime smoke test in verify phase. Unit tests passed because they tested sub-routers directly, not the composed app.
**Guardrail:** For Hono Worker projects, manualQA smoke test #1 must be `curl localhost:<port>/api/v1/health` — if 404, route registration is broken. Verify phase should include a runtime check when dev server is available (NEEDS_RUNTIME, not skip).
**Check:** manualQA-report.md first scenario tests health endpoint. Recovery count > 0 with route 404 = this learning applies.

### L-046: New project foundation missions require multiple manualQA recovery rounds `[PROCESS]` `project`
> 2026-04-01 | occurs: 1 | via: campgen-foundation
**What happened:** campgen-foundation needed 2 recovery rounds in manualQA (route registration fix + FB API v25.0 fixes). Unit tests and tsc gave green signals, but runtime behavior diverged significantly.
**Root cause:** New projects have no regression baseline. Mocked unit tests validate logic but not integration. First deployment surface area is large.
**Guardrail:** For foundation missions (new project, first deploy), plan phase should set `expected_recovery_rounds: 2` in manualQA.md and allocate time accordingly. ManualQA should not escalate to FAIL on first recovery — iterate.
**Check:** phase-status.json `manualQA.recovery_attempts` for foundation missions. If 0, likely undertested.


## 2026-04-01 — insureprimo-favicon

### L-048: Claude API crashes on small PNG/ICO binary file reads — use metadata commands only `[PROCESS]` `universal`
> 2026-04-01 | occurs: 3 | via: insureprimo-favicon
**What happened:** Three consecutive manualQA sessions crashed with "API Error 400: Could not process image" when the Claude `Read` tool attempted to read a 32x32 PNG file (902 bytes). The crash is reproducible and session-fatal — all context is lost.
**Root cause:** Claude's multimodal file reader cannot process very small PNG/ICO files. The image dimensions (32x32) are below the minimum processable threshold for the vision model.
**Guardrail:** Plan phase MUST add production_safety_rule: "MUST NOT read resized 32x32 PNG with Claude Read tool — use metadata commands only (API Error 400 crash)." All phases must use `file`, `shasum -a 256`, `python3 PIL`, or `curl -I` for binary asset validation. Never `Read` tool on small icons.
**Check:** prd.json `production_safety_rules` for missions with small binary assets includes the Read tool prohibition. `grep 'Read.*png\|Read.*ico\|Read.*favicon' progress.txt` — 0 matches after plan enforcement.

### L-049: Deploying a corrupt cached asset requires version key increment, not same-version re-deploy `[DEPLOY]` `universal`
> 2026-04-01 | occurs: 1 | via: insureprimo-favicon
**What happened:** First deploy shipped favicon with `?v=2` but corrupt pixel data. Fix required incrementing to `?v=3`, not re-deploying with same `?v=2`. Browsers and CDN had already cached the corrupt `?v=2` response (CDN TTL: 7 days, browser TTL: 24 hours). Re-deploying correct content with same version key would only help after CDN cache expiry.
**Root cause:** Cache keys are immutable once distributed. CDN `max-age=604800` means the corrupt response serves for up to 7 days even if origin is fixed. Same URL = same cache entry.
**Guardrail:** When a recovery fix changes the CONTENT of a cached asset that was already deployed: MUST increment the cache-busting version parameter (v=N → v=N+1). Plan phase flags `cache_key_increment: required` when fixing deployed static assets. prd.json AC must verify NO references to the old version remain.
**Check:** `grep -r 'favicon.ico?v=' api/src/` — only latest version present. `grep -c 'v=<old>' <file>` = 0 for all template files.


## 2026-04-02 — campgen-workflow-engine

### L-050: D1 status enum values must be synchronized across ALL code paths referencing the same column `[DB]` `universal`
> 2026-04-02 | occurs: 1 | via: campgen-workflow-engine
**What happened:** ManualQA BLOCKER-1: the retry endpoint in `jobs.ts` checked for status `'failed'` before allowing retry, but D1 stored terminal failure status as `'fatal_error'` (per the CHECK constraint in schema.sql). The retry endpoint was dead code — no job could ever reach it because the status guard never matched.
**Root cause:** Multiple files (`jobs.ts`, `CampaignWorkflow.ts`, `reconcile-jobs.ts`, `JobStateDO.ts`) referenced the same `generation_jobs.status` column but used different string literals. No single source of truth for status enum values in TypeScript. The CHECK constraint in schema.sql was authoritative but code didn't derive from it.
**Guardrail:** Architect phase must create a shared `StatusEnum` constant (or Zod enum) derived from schema.sql CHECK constraints. All files referencing a status column MUST import from the shared constant. AC: `grep -c 'JobStatus\|D1JobStatus' <each-file-using-status>` >= 1. Review phase must cross-reference every status string literal against the schema CHECK constraint.
**Check:** `grep -rn "'failed'\|'done'\|'fatal_error'" api/src/ --include='*.ts'` — all matches use the shared enum, no raw string literals.

### L-051: Circuit breaker checks MUST precede step execution in multi-step workflows `[API]` `universal`
> 2026-04-02 | occurs: 1 | via: campgen-workflow-engine
**What happened:** ManualQA BLOCKER-2: the external circuit breaker check in `CampaignWorkflow.ts` was placed AFTER `executeBatchStep()` for `batchIdx > 0`. When batch 1 had errors that tripped the circuit breaker, batch 2's ads were already submitted to FB API before the check ran. The circuit breaker then aborted the workflow, orphaning successfully-created ads (no status update, no activation path).
**Root cause:** Defensive check was added as an afterthought without considering execution order. "Check then act" was implemented as "act then check."
**Guardrail:** For any workflow with multiple sequential steps (batch processing, pipeline stages): defensive checks (circuit breaker, quota check, rate limit) MUST be positioned BEFORE the step they guard, not after. Architect phase includes step execution diagram with check placement. Review verifies check-before-act ordering.
**Check:** `grep -B5 'executeBatchStep\|executeStep' <workflow>.ts` — every step invocation has a guard (circuit/quota/rate) ABOVE it, not below.

### L-052: Schema.sql must be materialized as numbered migration before first production deploy `[DEPLOY]` `universal`
> 2026-04-02 | occurs: 1 | via: campgen-workflow-engine
**What happened:** WARNING-DBSEC-2: `api/migrations/` directory had no `.sql` files. Schema was defined in `openspec/changes/campgen-workflow-engine/schema.sql` but never copied to a numbered migration file. Deploy.yml gracefully skips when no migrations exist (`if ls migrations/*.sql`), meaning first production deploy would create the Worker but NO database tables — every D1 query returns "table not found."
**Root cause:** Architect generated schema.sql as reference artifact but no story explicitly created the migration file from it. The deploy.yml skip-if-empty pattern masked the gap.
**Guardrail:** For any mission creating new D1 tables: plan must include a story for `cp schema.sql api/migrations/0001_<name>.sql`. Verify phase checks: `ls api/migrations/*.sql | wc -l` > 0 when schema.sql exists. Deploy.yml migration skip pattern should log a WARNING, not silently succeed.
**Check:** `ls api/migrations/*.sql` returns at least one file when `openspec/*/schema.sql` exists for the project.

### L-053: PRD maxFileLines limits for Durable Objects must account for multi-concern responsibility `[PROCESS]` `universal`
> 2026-04-02 | occurs: 1 | via: campgen-workflow-engine
**What happened:** WARNING-CQ-1: `RateLimiterDO.ts` was 176 lines vs PRD limit of 100 (+76%). The DO handles three distinct concerns: rate limiting, circuit breaker state, and FB API response header parsing. Each concern is ~50-60 lines. The 100-line limit was set generically without considering the DO's responsibility scope.
**Root cause:** Plan phase set maxFileLines as a flat value per category (DO = 100) without analyzing the number of concerns per file. A DO with 3 responsibilities at 50-60 lines each cannot fit in 100 lines without sacrificing readability.
**Guardrail:** Plan phase maxFileLines formula: `base_limit * concern_count`. For DOs: base = 80, so a 3-concern DO gets 240. Architect validates limit against the planned responsibility list. If a DO grows beyond its allocated concerns, that's a real warning — but exceeding a generic limit is not.
**Check:** prd.json maxFileLines for DOs matches `80 * concern_count`. Review flags files exceeding per-concern limit, not flat limit.


## 2026-04-03 — preprod-security-xss-html-sanitization

### L-054: Regex-based HTML sanitizer requires defense-in-depth checklist beyond allowlist architecture `[SECURITY]` `universal`
> 2026-04-03 | occurs: 1 | via: preprod-security-xss-html-sanitization
**What happened:** DB+Security review found 4 defense-in-depth gaps in a well-structured two-phase regex sanitizer (dangerous tag removal + allowlist filtering): (1) `noscript` and `template` missing from DANGEROUS_TAGS — stripped by allowlist but inner content preserved (weaker), (2) single-pass dangerous tag removal vulnerable to reconstructed-tag bypasses (e.g., `<scrip<script></script>t>`), (3) HTML comments pass through unmodified — can interact with browser parsing quirks, (4) code duplication between two sanitizer variants made auditing harder and consumed line budget.
**Root cause:** The sanitizer's two-phase architecture (strip dangerous + filter allowlist) was sound, but defense-in-depth requires completeness at each phase. The allowlist compensated for phase-1 gaps, but defense-in-depth means BOTH phases must be independently robust.
**Guardrail:** For any mission creating or modifying HTML sanitizers, architect must verify this checklist: (a) DANGEROUS_TAGS includes `script, style, object, embed, form, applet, base, link, meta, noscript, template`, (b) iterative stripping loop (`while (prev !== current)`) for reconstructed-tag bypasses, (c) HTML comment stripping (`<!--...-->`) before tag processing, (d) case-insensitive matching at all stages (`'gi'` flag + `.toLowerCase()`), (e) generic `on*` event handler prefix check (not enumerated list), (f) URL protocol allowlist (not blocklist).
**Check:** `grep -c 'noscript' <sanitizer>.ts` >= 1; `grep -cE 'while|prev.*===' <sanitizer>.ts` >= 1; `grep -c 'comment' <sanitizer>.ts` >= 1; all 3 required for PASS.


## 2026-04-03 — preprod-security-sql-parameterization

### L-055: Acceptance test scripts must use worktree-relative paths, not workspace-relative `[PROCESS]` `universal`
> 2026-04-03 | occurs: 1 | via: preprod-security-sql-parameterization
**What happened:** Both `T1-parameterize-keepids.sh` and `T2-filter-builder.sh` used workspace-relative paths (e.g., `a2z-agent-demo/api/src/...`) that don't resolve when executed from the mission worktree root (where worktree root IS the repo). Verify phase had to fall back to manual AC verification with identical grep commands run directly against worktree files.
**Root cause:** Architect/plan generated acceptance test paths assuming execution from the a2z-workspaces root, but worktrees clone just the project repo. No validation step checks that script paths resolve from the execution context.
**Guardrail:** Acceptance test scripts must use paths relative to the project repo root (e.g., `api/src/...`), not workspace root (e.g., `a2z-agent-demo/api/src/...`). Architect validation (Q13) should verify that all file paths referenced in acceptance-tests/*.sh exist when resolved from `<project>/` not `<workspace>/`.
**Check:** `grep -ohP '[a-z0-9_-]+/api/src/[^ "]+' acceptance-tests/*.sh | while read p; do echo "$p" | grep -qE '^api/' || echo "BAD_PATH: $p"; done` — 0 BAD_PATH lines.

### L-056: SQL query refactoring must audit clause content, not just assembly method `[DB]` `universal`
> 2026-04-03 | occurs: 1 | via: preprod-security-sql-parameterization
**What happened:** ManualQA discovered `api.ts` articles search endpoint returns 500 due to bare `slug LIKE ?` in a JOIN query (`articles a` JOIN `categories c` — both have `slug`). The old code had the same bug (`whereClause += '(title LIKE ? OR slug LIKE ?)'`), and the refactoring faithfully preserved the buggy clause string in the new `buildWhereClause()` call. The `ui.ts` endpoint correctly uses `a.slug LIKE ?` (table-aliased).
**Root cause:** The mission scope was "change assembly method from string concat to filter builder" — clause strings were treated as opaque content to preserve, not as code to audit. Refactoring is a natural opportunity to fix latent bugs, but only if the refactoring scope includes content review.
**Guardrail:** Any mission that refactors SQL query construction must include an AC that audits all column references in JOINed queries for table aliasing. Pattern: `grep -n 'LIKE\|=\s*?' <file> | grep -v 'a\.\|c\.\|t\.'` — any bare column in a JOINed query is a finding.
**Check:** Review phase DB+Security reviewer must flag any bare column name in a query containing JOIN. Architect must include "column aliasing audit" as an AC for SQL refactoring stories involving JOINs.

### L-057: Typed filter builder pattern eliminates SQL interpolation at scale `[SECURITY]` `universal`
> 2026-04-03 | occurs: 1 | via: preprod-security-sql-parameterization
**What happened:** A `FilterCondition` type + `buildWhereClause()` helper (30 lines) eliminated 13 runtime-value SQL interpolation points across 3 files and 6 endpoints. Each condition specifies `when` (boolean guard), `clause` (hardcoded SQL string with `?` placeholders), and `params` (values for `.bind()`). ManualQA SQL injection tests confirmed all payloads treated as literal bound values — zero injection vectors.
**Root cause:** The previous `let whereClause = ''; whereClause += ...` pattern mixed clause construction with value interpolation, making it easy for developers to accidentally inject runtime values into SQL strings. The typed builder enforces separation: clauses are compile-time strings, values flow only through params arrays.
**Guardrail:** For any project with dynamic WHERE clauses across multiple endpoints, architect should specify a shared `buildWhereClause(FilterCondition[])` pattern rather than per-endpoint string concatenation. AC: `grep -c 'whereClause +=' <file>` returns 0 for all files using the builder.
**Check:** `grep -rn 'whereClause +=' api/src/admin/` returns 0 matches. `grep -c 'buildWhereClause' api/src/admin/*.ts` >= 1 per file.

### L-059: Silent catch blocks erase diagnostic trails — always add console.warn minimum `[API]` `universal`
> 2026-04-03 | occurs: 1 | via: campgen-qa-hardening
**What happened:** CampaignWorkflow activation path had 3+ empty `catch {}` blocks silently swallowing rate limiter, FB header recording, and usage recording errors. A campaign stuck in ACTIVATING state would have zero diagnostic trail. Same pattern in jobs.ts activation catch.
**Root cause:** Developer intent was "non-fatal, don't break the workflow" but the implementation removed all observability. Fault-tolerance does not require diagnostic-erasure. The established pattern (Analytics Engine `writeDataPoint()`) was available but not used.
**Guardrail:** Review phase Code Quality reviewer must flag empty catch blocks in changed files. Minimum: `console.warn()` with error context. Better: `env.METRICS.writeDataPoint()` for non-blocking telemetry. `catch {}` and `catch { /* */ }` are never acceptable in production code.
**Check:** `grep -Pn 'catch\s*(\(?\w*\)?)?\s*\{\s*\}' api/src/**/*.ts` returns 0 matches.

### L-060: Pattern-fix PRDs must scope ALL module instances, not just the triggering file `[PROCESS]` `universal`
> 2026-04-03 | occurs: 1 | via: kodigital-automation-data-safety
**What happened:** T4/T5 scoped `${table}`/`${cols}` SQL interpolation fixes to automation-metrics.ts and automation.ts. Review found the SAME pattern in `syncD1AfterMutation` (automation-actions.ts). T6 scoped `|| 0` fixes to automation-metrics.ts and automation-actions.ts, but review found `|| 0` in automation-engine.ts. Both required additional FIX stories (FIX-1, FIX-3), adding a review fix cycle.
**Root cause:** Plan phase grepped the triggering file for the pattern but did not grep the full module directory. PRD targets were file-specific when the anti-pattern was module-wide.
**Guardrail:** When a plan story fixes a code pattern (SQL interpolation, numeric defaults, error handling), plan phase must `grep -r '<pattern>' api/src/lib/ api/src/routes/` to find ALL instances across the module — not just the file that prompted the fix. All instances go into the same story's targetFiles.
**Check:** Before ExitPlanMode, for each pattern-fix story, verify `grep -r` of the pattern returns 0 hits outside targetFiles. If hits exist, expand targetFiles.

### L-061: Type file decomposition should trigger proactively at plan time, not reactively at review `[PROCESS]` `kodigital-dashboard`
> 2026-04-03 | occurs: 1 | via: kodigital-automation-data-safety
**What happened:** `api/src/types.ts` was already 554 lines before this mission. Adding ~30 lines (DataHealth, BlockReason, EvaluationSummary extensions) pushed it to 584, triggering a review BLOCKER for exceeding the 400-line default. FIX-2 decomposed automation types into `types/automation.ts`, consuming a review fix cycle.
**Root cause:** Plan phase checked that types.ts was a target file but did not check its current line count against maxFileLines. The file was already 154 lines over the limit before any changes.
**Guardrail:** Plan phase must `wc -l` every target file. If a file is within 100 lines of its maxFileLines limit (default 400 for .ts), the plan must include a decomposition story BEFORE adding new content. For types files specifically: extract domain-specific types into `types/<domain>.ts` barrel files.
**Check:** `wc -l api/src/types.ts` should be checked at plan time. If > 300 and mission adds types, include a decomposition story.

### L-062: API-only missions still need manualQA.md with endpoint and regression scenarios `[PROCESS]` `universal`
> 2026-04-03 | occurs: 1 | via: kodigital-automation-data-safety
**What happened:** Plan phase did not create manualQA.md because the mission had zero UI changes (all stories were API/test). ManualQA phase had to derive its test plan on the fly from prd.json. While it succeeded (9/9 scenarios passed), the lack of a pre-defined test plan meant no upfront agreement on what "done" looks like for post-deploy verification.
**Root cause:** Implicit assumption that manualQA.md is only needed for UI changes. In reality, API missions still need: (1) curl verification of new/modified endpoints, (2) dashboard regression checks, (3) unit test execution against deployed code, (4) env var presence verification.
**Guardrail:** Plan phase must create manualQA.md for EVERY change-id, including API-only missions. For API-only missions, minimum scenarios: endpoint health check, new endpoint response verification (curl), regression test suite execution, env var/config verification, and at least 2 adjacent-page regression checks in the dashboard.
**Check:** `ls openspec/changes/<change-id>/manualQA.md` must exist after plan phase completes, regardless of mission type.

### L-063: Every data-access helper must include tenant scoping (business_id) — IDOR prevention `[SECURITY]` `universal`
> 2026-04-04 | occurs: 1 | via: campgen-creation-ui
**What happened:** `getPlanOrFail` in day-plans.ts used `WHERE id = ?` without business_id. An authenticated user could access or modify any plan by guessing integer IDs across tenants. The existing presets.ts pattern correctly scoped by business_id, but the new code omitted it.
**Root cause:** When creating a "get or 404" helper by copying from another route, the business_id WHERE clause was dropped — the helper appeared to work in unit tests since mocked D1 doesn't enforce tenant isolation. Review caught it as BLOCKER (FIX-1).
**Guardrail:** Architect phase must specify in architecture.md that ALL data-access helpers include business_id in the WHERE clause. DB+Security reviewer checks every SELECT/UPDATE/DELETE query for business_id scoping. Plan acceptance criteria for any route file must include: `grep -c 'business_id' <route-file>` >= N (where N = number of query functions).
**Check:** `grep -c 'business_id' api/src/routes/<new-route>.ts` — must appear in every SELECT/UPDATE/DELETE query, not just route-level middleware.

### L-064: Zod update schemas must NOT include status fields — state transitions via dedicated endpoints only `[SECURITY]` `universal`
> 2026-04-04 | occurs: 1 | via: campgen-creation-ui
**What happened:** `updateDayPlanSchema` accepted a `status` field, allowing clients to PATCH any plan into `running` or `completed` without going through the Run endpoint. This bypassed the state machine (draft→running only via POST /:id/run). Review caught it as BLOCKER (FIX-2).
**Root cause:** The Zod schema was auto-derived from the TypeScript interface which includes `status`. No explicit exclusion. The plan didn't specify which fields are mutable vs. system-managed.
**Guardrail:** Plan phase must explicitly partition entity fields into: (a) user-mutable (name, notes, is_template), (b) system-managed (status, total_jobs, timestamps). Only (a) goes in updateSchema. Architect phase enforces this in architecture.md "Field Mutability" section. Acceptance criteria: `grep -v 'status' <schema-file> | grep updateSchema` confirms status excluded.
**Check:** For every Zod update schema: verify `status` is NOT in the schema's z.object(). `grep -A5 'updateDayPlanSchema' api/src/schemas/day-plan.ts` must NOT contain `status`.

### L-065: Batch workflow/job creation loops need per-item try/catch with continuation `[API]` `universal`
> 2026-04-04 | occurs: 1 | via: campgen-creation-ui
**What happened:** The Run All endpoint's inner loop called `CAMPAIGN_JOB.create()` without try/catch. If one workflow creation failed, the plan got stuck in `running` — couldn't re-run, couldn't delete. No per-item error recovery. Review caught it as BLOCKER (FIX-3).
**Root cause:** The happy-path implementation assumed all workflow creations succeed. CF Workflows can fail on DO capacity limits, transient errors, or malformed params. The absence of error handling turned a partial failure into a total deadlock.
**Guardrail:** Any loop that creates external resources (workflows, DO instances, API calls) must: (1) wrap each iteration in try/catch, (2) mark failed items with `failed` status, (3) continue to next item, (4) if ALL items fail (jobsCreated===0), roll parent state back to its pre-execution state. Acceptance criteria: `grep -c 'catch' <route-file>` >= number_of_loop_create_calls.
**Check:** `grep -B2 -A5 'CAMPAIGN_JOB.create\|\.create(' api/src/routes/day-plans.ts` — every create call must be inside a try block.

### L-067: TypeScript `as const` with explicit type annotation defeats narrow tuple inference `[API]` `universal`
> 2026-04-04 | occurs: 1 | via: kodigital-revenue-pipeline-resilience
**What happened:** `const SOURCE_LABELS: readonly string[] = ['events', 'ko_stats', 'bids'] as const;` declared the type as `readonly string[]`, widening the `as const` narrow tuple (`readonly ['events', 'ko_stats', 'bids']`) to generic strings. This defeats the purpose of `as const` and loses compile-time type safety on the literal values.
**Root cause:** Developer added an explicit type annotation for clarity, not realizing it overrides the `as const` inference. TypeScript resolves the annotation type over the inferred type when both are present.
**Guardrail:** Review Code Quality reviewer must flag `as const` declarations that also have an explicit type annotation. Pattern: variable with both `: <Type>` and `as const` on the same line. Remove the explicit annotation to preserve narrow type inference.
**Check:** `grep -n 'as const' <file>.ts | grep ':'` — lines with both `: <type>` and `as const` need review. The annotation should be removed unless deliberately widening.

### L-068: Parallel array index mapping requires explicit length validation `[API]` `universal`
> 2026-04-04 | occurs: 1 | via: kodigital-revenue-pipeline-resilience
**What happened:** `recordIngestionMetrics()` mapped a `results` array against `SOURCE_LABELS` (length 3) by index. If the caller passed fewer or more than 3 results, `SOURCE_LABELS[i]` fell back to `'unknown'` — silently corrupting metrics data. The function contract assumed exactly 3 results but never enforced it.
**Root cause:** Parallel arrays create implicit coupling between two data structures. The coupling exists only in developer convention, not in code. Any change to one array (adding a source, reordering) silently breaks the other.
**Guardrail:** Functions that zip arrays by index must validate lengths match at the top: `if (a.length !== b.length) console.warn(...)` or throw. Better: use a `Record<string, T>` map or accept source labels as a parameter to eliminate the coupling entirely. Review must flag any `array[i]` where `i` iterates a different array.
**Check:** `grep -B3 -A3 'SOURCE_LABELS\[' <file>.ts` — index access must be preceded by length guard. More broadly, `grep -n '\[i\]' <file>.ts` in functions iterating one array while indexing another.

### L-069: Durable Object internal status data needs external observability route `[API]` `kodigital-dashboard`
> 2026-04-04 | occurs: 1 | via: kodigital-revenue-pipeline-resilience
**What happened:** `detectRevenueGap()` correctly computed gap detection data and stored it in DO storage via `handleStatus()`. ManualQA found the data was correctly implemented but no external HTTP route proxied to the DO's status handler — `curl /api/admin/sync/status` was assumed by the test plan but didn't exist. The gap_detection data is invisible to operations without a route.
**Root cause:** The story scoped implementation to the DO's internal logic without considering the observability path. The test plan assumed an external route would exist but no story created one.
**Guardrail:** For any story that adds status/health/metrics data to a DO: plan must verify or create an external route that exposes the data. AC must include a curl command against the external route, not just a code grep. If no route exists, add a story for the route.
**Check:** For each DO status method, `grep -r 'sync/status\|dispatcher/status' api/src/` must return at least one route handler that calls the DO.


## 2026-04-04 — preprod-security-settings-injection-fix

### L-070: Regex-based HTML sanitizers must decode HTML entities and strip null bytes BEFORE pattern matching `[SECURITY]` `universal`
> 2026-04-04 | occurs: 1 | via: preprod-security-settings-injection-fix
**What happened:** DB+Security review found that `sanitizeSettingsHtml` matched literal `javascript:` and `on[a-z]+=` patterns but HTML character references like `&#106;avascript:` or `&#111;nmouseover=` bypassed the regex. The browser decodes entities BEFORE evaluating protocols and attribute names, so encoded payloads execute as XSS. Similarly, null bytes (`\x00`) inserted mid-tag can bypass regex matching in some parsers. Both required WARN-FIX-6 (null byte stripping) and WARN-FIX-10 (entity decoding) — adding a preprocessing step before the main sanitization regex passes.
**Root cause:** L-054 established a defense-in-depth checklist for regex sanitizers (iterative stripping, comment removal, case-insensitive matching, dangerous tag lists) but did not include input normalization as a prerequisite step. The sanitizer operated on raw HTML strings assuming all dangerous content would be in literal form. Character encoding is a well-known XSS bypass class (OWASP) that string-based sanitizers must handle explicitly.
**Guardrail:** Extends L-054 checklist with two mandatory preprocessing steps: (a) null byte stripping (`html.replace(/\x00/g, '')`) as the FIRST operation, (b) HTML entity decoding (numeric `&#NNN;`, hex `&#xHH;`, and named `&lt;` etc.) BEFORE running any regex-based tag/attribute stripping. Both must occur before the iterative stripping loop. Architect checklist for sanitizer missions: L-054 items + entity decode + null byte strip.
**Check:** `grep -c '\\\\x00' <sanitizer>.ts` >= 1 (null byte strip); `grep -c 'entity\|&#\|charCode\|decodeEntit' <sanitizer>.ts` >= 1 (entity decode). Both required BEFORE the main regex loop.

### L-071: Security tag block lists must cross-reference legitimate template usage before finalizing `[SECURITY]` `universal`
> 2026-04-04 | occurs: 1 | via: preprod-security-settings-injection-fix
**What happened:** Architecture spec included `<meta>` in the dangerous tag block list for `sanitizeSettingsHtml`. The sanitizer then stripped ALL `<meta>` tags from `customHeadHtml`. But the same `layout.ts` template uses `<meta>` tags for SEO (description, canonical, charset) — these are template-generated, not from user settings, but the architecture spec created ambiguity about whether meta tags could appear in settings HTML. Review flagged this as BLOCKER (B1): the PRD acceptance criteria for T2 specified "does NOT strip `<meta>` tags" but the architecture spec listed meta in DANGEROUS_TAGS. Required FIX-1 to remove meta from the regex.
**Root cause:** The architecture spec applied security maximalism ("block all potentially dangerous tags") without auditing the template to see which tags have legitimate uses. The PRD correctly excluded meta from blocking, but the architecture spec contradicted it by including meta in the dangerous tag list — and implementation followed the architecture spec.
**Guardrail:** When architect defines a tag block list, the checklist must include: (1) for each tag in the list, `grep -c '<tag' <template>.ts` to check if it's used legitimately in the same file or template chain, (2) any tag with legitimate usage gets a scoping note: "strip only inside user-content sections, preserve in template sections" or is excluded from the block list entirely, (3) PRD AC must explicitly list tags that are NOT blocked (positive test). Architecture spec must not contradict PRD ACs — architect validation must diff the two.
**Check:** For each tag in DANGEROUS_TAGS, `grep -c '<tagname' <template>.ts` — if > 0, verify it's only in user-content sections. Architecture spec DANGEROUS_TAGS must be a subset of PRD-approved block list.


## 2026-04-04 — preprod-security-jwt-ts-fix

### L-072: Missions modifying production code must verify TypeScript compilation of sibling test files `[TESTING]` `universal`
> 2026-04-04 | occurs: 1 | via: preprod-security-jwt-ts-fix
**What happened:** `preprod-security-jwt-verification` added JWT verification logic in `auth/middleware.ts` but left 5 TypeScript compilation errors in `auth/middleware.test.ts` — a test file it didn't directly modify. The test helpers used Web Crypto API results (`crypto.subtle.generateKey()`, `crypto.subtle.exportKey()`) without type assertions, and an unused `CERTS_URL` constant became a TS error. A separate follow-up mission was required solely to add `as CryptoKeyPair`, `as JsonWebKey` type assertions and remove the dead constant.
**Root cause:** The original mission's quality checks (`npm test`, `tsc --noEmit`) either weren't scoped to catch auth/ directory errors or the errors were deferred. Test files that compile via `tsc` but whose type-unsafe patterns only surface when sibling production code changes are a blind spot if the original mission doesn't explicitly check `tsc --noEmit | grep '<directory>/'`.
**Guardrail:** Every mission's mainGoal quality check must include `tsc --noEmit 2>&1 | grep '<modified-directory>/'` scoped to the directory containing changed files — catching TS errors in sibling test files, not just the modified file. Plan phase must set this as a quality check in prd.json. If errors exist in files outside the mission's targetFiles, create a follow-up story in the same mission rather than deferring to a separate change-id.
**Check:** prd.json `qualityChecks` includes `tsc --noEmit | grep '<dir>/'` for every directory containing modified files. `npx tsc --noEmit 2>&1 | grep -c 'auth/'` = 0 after any auth/ mission.

### L-073: Next.js `"use client"` on layout.tsx prevents `output:'export'` from detecting generateStaticParams in child pages `[UI]` `universal`
> 2026-04-05 | occurs: 1 | via: campgen-creation-ui-deploy-fix
**What happened:** After merging the campgen-creation-ui-dashboard feature, the dashboard deploy failed because `dashboard/src/app/generator/layout.tsx` had `"use client"` (needed for `usePathname`). This created a client boundary that prevented Next.js static export (`output: 'export'`) from detecting `generateStaticParams()` in child dynamic route pages like `generator/plans/[id]/page.tsx`. The build errored: "Page ... is missing generateStaticParams" — even though the function was exported.
**Root cause:** Next.js `output: 'export'` requires server components in the layout tree to detect `generateStaticParams` in child pages. A `"use client"` layout wraps all children in a client boundary, making the static analysis opaque to the build system. The plan phase for the original feature didn't check parent layout component types when adding dynamic routes with `generateStaticParams`.
**Guardrail:** Plan phase for any story adding dynamic routes (`[param]` pages) with `generateStaticParams` must verify ALL ancestor layouts are server components. If any layout needs client hooks (`usePathname`, `useRouter`, `useSearchParams`), extract the hook usage into a separate client component and keep the layout as a server component. Architect phase checks: `grep -c 'use client' <parent-layout>.tsx` must return 0 for every layout above a `generateStaticParams` page.
**Check:** `grep -rn 'use client' dashboard/src/app/**/layout.tsx` — 0 matches in any layout that has child dynamic routes with generateStaticParams. `npm run build` succeeds with all static pages generated.


## 2026-04-05 — kodigital-fb-api-error-monitoring

### L-074: Optional function parameters silently disable fire-and-forget features `[API]` `universal`
> 2026-04-05 | occurs: 1 | via: kodigital-fb-api-error-monitoring
**What happened:** `runBatchSync` accepted `db?: D1Database` and `syncCycleId?: number` as optional params. Both callers in `index.ts` (breakdowns + realtime) omitted them. The quota recording condition (`if (config.db && config.syncCycleId != null)`) was never true — quota data never recorded. TypeScript compiled fine, unit tests passed (they mocked the config), but the feature was dead code in production. ManualQA caught it — GET /admin/fb-quota returned `{"quota":[]}` despite successful sync cycles.
**Root cause:** Optional params (`?`) let callers silently skip features without compilation errors. Fire-and-forget patterns (`.catch()` swallowing errors) compound the problem — even if the feature ran and failed, no one would notice. The combination of optional params + fire-and-forget = invisible feature omission.
**Guardrail:** When a new feature depends on existing callers passing new params: (1) make params required (not optional) if the feature is expected to always run, or (2) if params must be optional, add a `console.warn` when the feature is skipped due to missing params (e.g., `if (!config.db) console.warn('QUOTA_SKIP_NO_DB')`). Plan phase ACs must include a grep for the parameter at EVERY call site: `grep -c 'db:' index.ts` >= N (where N = number of runBatchSync calls).
**Check:** `grep -c 'db:.*env.DB' api/src/index.ts` >= 2. No `console.warn` for missing optional params = silent feature gap.

### L-075: External API response headers must be verified live before building features on them `[API]` `universal`
> 2026-04-05 | occurs: 1 | via: kodigital-fb-api-error-monitoring
**What happened:** Quota recording was designed around the `x-business-use-case-usage` HTTP response header from Meta's Graph API. The design assumed this header is present on batch POST responses (`POST /v25.0/`). After deploy + two full sync cycles (21/23 accounts synced), the fb_api_quota_usage table remained empty. Investigation confirmed the code path is correct — the header is simply not returned by the FB Batch API for these requests.
**Root cause:** Feature designed from documentation ("the header is returned on API calls") without a live verification step. The assumption was noted as "UNVERIFIED" in qa-report.md but this didn't block the feature from being built and shipped.
**Guardrail:** When a feature depends on a specific external API response (headers, fields, status codes), plan phase must include an MQA pre-requisite: "Verify header/field presence with live API call before building recording infrastructure." If the assumption is unverifiable pre-deploy, mark the feature as `best_effort: true` in prd.json and set the mainGoal to not require that data for PASS.
**Check:** prd.json stories that depend on external API response data must have either (a) a verified live API call proving the data exists, or (b) `best_effort: true` flag and mainGoal that doesn't require the data.

### L-076: Cherry-pick recovery workflow must preserve worktree local state `[PROCESS]` `universal`
> 2026-04-05 | occurs: 1 | via: kodigital-fb-api-error-monitoring
**What happened:** During finish phase, `git stash` was used to save worktree state before creating the cherry-pick branch. The stash contained the correct mission prd.json (with MQAFIX-1 fix story). After the cherry-pick PR merged, the worktree's committed prd.json was from a DIFFERENT mission (kodigital-revenue-pipeline-resilience). ManualQA had to pop the stash to recover the correct prd.json.
**Root cause:** The root `prd.json` is shared across missions in the same repo. When another mission's run phase committed its prd.json to the branch, it overwrote this mission's file. The cherry-pick workflow only picked the MQAFIX-1 code commit, not the pipeline artifact commits.
**Guardrail:** Finish phase cherry-pick workflow must: (1) commit all pipeline artifacts (prd.json, review-findings.md, qa-report.md) to the mission branch BEFORE stashing, so the cherry-pick includes them, or (2) after stash+cherry-pick, immediately pop stash and verify `prd.json.change_id` matches the mission. If mismatched, restore from stash before proceeding to manualQA.
**Check:** After finish cherry-pick workflow, `jq '.change_id' prd.json` in worktree matches the current mission's change-id.

### L-077: AC grep patterns must match implementation syntax, not just conceptual values `[PROCESS]` `universal`
> 2026-04-05 | occurs: 1 | via: preprod-security-admin-cors-csrf
**What happened:** T1-AC2 used `grep -c "'403'"` (searching for string literal `'403'` with quotes) but the implementation uses numeric `403` as a Hono response parameter: `c.json({ error: 'Forbidden' }, 403)`. The grep returned 0 matches, causing a false FAIL in verify. The 403 rejection was correctly implemented — only the AC pattern was wrong.
**Root cause:** AC pattern was written for the conceptual value (HTTP 403) without checking how the framework expresses it. L-058 covers wrong values; this is wrong syntax — the value is correct but the grep syntax includes literal quote characters that don't appear in the code. Hono's `c.json(body, status)` uses a numeric second argument, not a string.
**Guardrail:** Plan/architect phase must run each grep-based AC against example code to verify syntax. For HTTP status codes in Hono: `grep -c ', 403)' <file>` (numeric), not `grep -c "'403'"` (string). For any framework-specific pattern, grep against a known-working example in the codebase first.
**Check:** Before ExitPlanMode, for each AC that greps a specific value, verify the grep syntax matches how the framework represents that value. `grep` the pattern against the current codebase to confirm >= 1 match (for patterns expected to exist pre-change) or confirm syntax correctness for new code.

### L-078: Admin route security requires two-layer defense: CSRF active rejection + CORS headers `[SECURITY]` `universal`
> 2026-04-05 | occurs: 1 | via: preprod-security-admin-cors-csrf
**What happened:** L-015 established that CORS must be scoped to public routes (not global wildcard). This mission revealed that CORS alone is insufficient for admin route protection. CORS is browser-enforced only — server-side tools, scripts, and CORS-ignoring clients bypass it entirely. A CSRF active rejection layer (checking Origin header on state-changing methods POST/PUT/DELETE and returning 403 for non-allowed origins) provides server-side enforcement independent of browser behavior.
**Root cause:** The original fix (L-015) only addressed the CORS response header layer. Without active Origin checking, the admin API was still vulnerable to requests from non-browser clients or misconfigured CORS preflight caching.
**Guardrail:** Any admin/authenticated API route must have TWO layers: (1) CSRF middleware — checks Origin header on state-changing methods, rejects non-allowed origins with 403 BEFORE the handler runs; (2) CORS middleware — sets response headers for browser enforcement. Order: CSRF registered before CORS. Sub-router exclusions via `isSubRouterPath()` for paths that have their own auth (e.g., quiz admin behind CF Access).
**Check:** `grep -c 'origin' api/src/admin/api.ts` >= 2 (CSRF check + CORS config). `grep -c '403' api/src/admin/api.ts` >= 1 (CSRF rejection). For new admin APIs: plan must include both layers.

### L-079: External HTTP fetch calls must check response.ok before proceeding `[API]` `universal`
> 2026-04-05 | occurs: 1 | via: campgen-upload-pipeline
**What happened:** The chunked video upload path in `fb-upload.ts` called `fetch()` to `rupload.facebook.com` but did not check `response.ok` or `response.status`. A non-2xx response from the upload transfer silently proceeded to the `finish` phase, producing an opaque FB API error instead of surfacing the real cause. Caught by Code Quality reviewer (CQ-W1), fixed as WARN-FIX-1 in the same cycle.
**Root cause:** The `fetch()` API does not throw on non-2xx responses — it only throws on network errors. Without an explicit `response.ok` check, application-level HTTP errors pass silently. This is a common JS/TS pitfall, especially when calling external APIs where the caller expects success.
**Guardrail:** Every `fetch()` call to an external service must have an immediate `if (!response.ok)` check that throws a descriptive error including `response.status` and `response.statusText`. Code Quality reviewer checks all `fetch()` calls for response status handling. Plan AC for any story with external HTTP calls: `grep -c 'response.ok\|response.status' <file>` >= N (one per fetch call).
**Check:** `grep -A3 'await fetch(' <file>` — every fetch call must be followed within 3 lines by a `response.ok` or `response.status` check. `grep -c 'fetch(' <file>` should equal `grep -c 'response.ok\|response.status' <file>`.

### L-080: Use config objects for functions with confusable same-type parameters `[API]` `universal`
> 2026-04-05 | occurs: 1 | via: campgen-upload-pipeline
**What happened:** The `copyImageCrossAccount` function takes both `sourceAccountId` and `targetAccountId` — two string parameters of the same type that could easily be swapped at the call site. The architect specified a `CopyImageConfig` interface: `{ imageHash, sourceAccountId, targetAccountId }` to make each parameter self-documenting and prevent transposition errors. This pattern was applied proactively during planning, not as a bug fix.
**Root cause:** Functions with 2+ parameters of the same type (especially string IDs) create silent transposition bugs — the code compiles and runs but produces wrong results. Positional arguments provide no protection against swapping.
**Guardrail:** When a function has 2+ parameters of the same primitive type (especially IDs, keys, or tokens), architect must specify a config/options object interface instead of positional parameters. Review checks for functions with multiple same-type params that lack a config object pattern.
**Check:** For new functions with 2+ string/number params of the same semantic category: `grep -c 'interface.*Config\|type.*Config\|interface.*Options' <file>` >= 1. Review flags `function foo(id1: string, id2: string)` as a WARN.

## 2026-04-05 — kodigital-sync-pipeline-observability

### L-081: Observability missions must enumerate every execution phase from trigger to completion `[PROCESS]` `universal`
> 2026-04-05 | occurs: 1 | via: kodigital-sync-pipeline-observability
**What happened:** The original plan had 7 stories covering D1 migration, types, Durable Object phase reporting, admin API, health endpoint, and retention cron. But Phase A of the sync pipeline — centralized metadata batch sync (`runBatchSync`) and revenue ingestion, both executed in `scheduled()` in `index.ts` — was NOT instrumented. Only Phase B (Durable Object-level processing) had observability. ManualQA caught the gap: pipeline status showed Phase B data but no Phase A entries. Recovery required 3 new stories (T8-T10) adding metadata/revenue instrumentation to the cron handler.
**Root cause:** Plan phase modeled observability around architectural components (Durable Objects, admin routes) rather than execution phases. The cron handler in `index.ts` orchestrates Phase A (batch metadata fetch + centralized revenue ingestion) BEFORE dispatching to DOs for Phase B. No story covered the orchestration layer because the plan focused on WHERE code lives, not WHAT the pipeline DOES step by step.
**Guardrail:** For any observability/instrumentation mission, plan phase must include a "Pipeline Phase Enumeration" step: (1) draw the full execution flow from trigger (cron/webhook) to completion, listing every phase, (2) map each phase to its code location, (3) verify each phase has a dedicated instrumentation story. Any phase without a story = plan BLOCKER. The enumeration must follow execution order, not component hierarchy.
**Check:** Plan file contains a sequential phase list (e.g., "Phase A: metadata → index.ts:runBatchSync, Phase A: revenue → index.ts:centralized ingestion, Phase B: dispatch → sync-dispatcher.ts") with story references for each. `grep -c 'Phase.*:' plan-file.md` >= number of pipeline phases.

### L-082: Cross-repo constants diverge silently without shared source of truth `[API]` `universal`
> 2026-04-06 | occurs: 1 | via: campgen-libraries
**What happened:** `FB_MACROS` was defined independently in campaign-generator API (`schemas/library.ts`) and kodigital-dashboard (`macro-builder.tsx`). The two copies diverged in key format (`{{campaign.name}}` vs `campaign.name`), field names (`description` vs `label`), and sample values (`My Campaign` vs `Spring_Promo`). The macro preview pipeline used the Dashboard's divergent copy, so preview URLs showed different sample values than the API's `resolvePreviewUrl`.
**Root cause:** Plan created separate stories for API and Dashboard without a story enforcing constant alignment. No architectural constraint requiring a single canonical source. Cross-repo duplication is invisible to per-repo type checking.
**Guardrail:** When a mission spans multiple repos sharing the same domain constant (enums, macro lists, config schemas): (1) Architect phase must designate one repo as canonical source and document in architecture.md. (2) Non-canonical repos must either import from a shared package OR have an AC that greps for exact field-by-field match with canonical. (3) Review phase cross-references the constant definitions across repos — field names, key formats, and sample values must be identical.
**Check:** `diff <(grep 'key:' repo-A/constant.ts | sort) <(grep 'key:' repo-B/constant.tsx | sort)` — 0 differences. Plan file contains "canonical source: <repo>" for every shared constant.

### L-083: Hardcoded falsy props silently disable features behind enabled guards `[UI]` `universal`
> 2026-04-06 | occurs: 1 | via: campgen-libraries
**What happened:** `<ConnectDialog accountId="" />` passed an empty string to a component whose underlying hook had `enabled: !!businessId && !!accountId`. Since `""` is falsy, the discover query was permanently disabled. The pixel discovery flow was dead — users saw "No pixels found" with no error. The API route also required non-empty `account_id` (returns 400 if missing), confirming the prop was functionally required.
**Root cause:** Implementation created the UI component before resolving where the runtime value would come from. The empty string was a placeholder that was never replaced. No AC verified that the prop was truthy at runtime.
**Guardrail:** For any component that passes props to hooks with `enabled` guards: (1) Plan AC must verify the prop source is wired (not a hardcoded placeholder). (2) Review phase must grep for empty string props (`=""` or `=''`) on required interaction props. (3) AC: `grep -c 'accountId=""' <file>` = 0.
**Check:** `grep -n '=""' <component>.tsx | grep -v 'className\|placeholder\|aria-\|type='` — 0 matches for non-styling empty string props.

### L-085: Drag-only upload zones exclude keyboard and assistive technology users `[UI]` `universal`
> 2026-04-06 | occurs: 1 | via: campgen-libraries
**What happened:** The upload zone only supported `onDrop`/`onDragOver`/`onDragLeave` with no `<input type="file">` or click handler fallback. Keyboard-only users, mobile users, and assistive technology users had no way to upload files.
**Root cause:** Implementation focused on the drag-and-drop UX without considering non-mouse input methods. No AC required keyboard-accessible upload.
**Guardrail:** Every drag-and-drop upload zone MUST include a `<input type="file">` fallback (hidden, triggered by click on the zone or a visible "Browse files" button). Architect AC: `grep -c 'type="file"' <upload-component>.tsx` >= 1.
**Check:** `grep -c 'type="file"' <upload-component>.tsx` >= 1 AND `grep -c 'onChange.*handleFile\|onInput' <upload-component>.tsx` >= 1.

### L-086: CF Access per-hostname cookie isolation breaks cross-origin API calls `[INFRA]` `universal`
> 2026-04-06 | occurs: 1 | via: campgen-dashboard-api-connectivity
**What happened:** Dashboard at `dash.kodigital.app` made XHR with `credentials: 'include'` to `campgen-api.kodigital.app`. Despite both hostnames being under the same CF Access application, the browser's `CF_Authorization` cookie is set per-hostname. The dashboard's session cookie didn't apply to the API domain, causing CF Access to redirect API calls to the login page, which CORS blocked (302 → 403).
**Root cause:** CF Access sets `CF_Authorization` without a `Domain=` attribute, making it hostname-specific. Same CF Access application does not mean shared cookies.
**Guardrail:** When a mission connects a dashboard to a cross-origin CF Access-protected API: (1) manualQA must authenticate to BOTH hostnames before testing, (2) plan should document that users need to visit the API domain once to establish session, (3) architecture.md must note the per-hostname cookie requirement.
**Check:** During manualQA, after authenticating to the dashboard domain, navigate to the API domain directly before testing cross-origin calls. Verify `document.cookie` includes `CF_Authorization` on the API domain.

### L-087: Cross-repo missions need explicit deploy ordering with deferred story tracking `[PROCESS]` `universal`
> 2026-04-06 | occurs: 1 | via: campgen-dashboard-api-connectivity
**What happened:** Mission spanned 2 repos (campaign-generator + kodigital-dashboard) plus user ops (CF Access config). Stories T1/T2/T4 in repo A, T3 in repo B, T5 user ops. Required strict ordering: deploy repo A → user ops T5 → repo B PR for T3 → deploy repo B. Plan, verify, and finish phases all needed special handling for deferred and user-ops stories.
**Root cause:** No established pattern for multi-repo missions with deploy dependencies.
**Guardrail:** Cross-repo missions MUST: (1) document deploy ordering in architecture.md with numbered steps, (2) mark deferred stories with `separate_repo` and `deferred_reason` in prd.json, (3) mark user ops with `ops_execution_owner: "user"`, (4) verify/finish phases treat deferred stories as PASS for gate purposes but flag for manualQA validation.
**Check:** `grep -c 'separate_repo\|ops_execution_owner' prd.json` matches the expected count of cross-repo + ops stories.

### L-088: Workers.dev domain may return error 1042 after custom domain activation `[INFRA]` `campaign-generator`
> 2026-04-06 | occurs: 1 | via: campgen-dashboard-api-connectivity
**What happened:** After adding `[[routes]]` with `custom_domain = true` to wrangler.toml and deploying, `curl https://campaign-generator.haikov1989.workers.dev/health` returned "error code: 1042" instead of the expected health response.
**Root cause:** Cloudflare may disable the workers.dev route when a custom domain is configured, depending on the `workers_dev` setting in wrangler.toml.
**Guardrail:** Post-deploy health checks in finish phase and manualQA MUST use the custom domain URL, not workers.dev. If health check needs to bypass CF Access, consider adding a `/health` path to the CF Access bypass list, or verify from within an authenticated browser session.
**Check:** `grep -c 'custom_domain' wrangler.toml` >= 1 → use custom domain for all health checks, not workers.dev.

### L-089: Hono sub-router middleware leaks across overlapping route prefixes `[API]` `universal`
> 2026-04-06 | occurs: 1 | via: preprod-security-content-length-limits
**What happened:** `adminApi.use('*', adminBodyLimit)` applied a 256KB default limit to AI routes (intended: 2MB) and quiz routes (intended: no limit). The path `/api/admin/ai/chat` entered `adminApi` (registered at `/api/admin`) where the wildcard middleware ran before the request could reach `aiApi` (registered at `/api/admin/ai`). ManualQA caught this — 1MB AI chat request got 413, boundary test confirmed 256KB threshold.
**Root cause:** Hono's `app.route()` registration order determines which sub-router handles overlapping prefixes. `adminApi` at `/api/admin` was registered before `aiApi` at `/api/admin/ai`, so all `/api/admin/*` requests enter `adminApi` first. Wildcard middleware (`use('*', ...)`) on the broader router intercepts requests intended for narrower sub-routers.
**Guardrail:** When a Hono app has overlapping route prefixes (e.g., `/api/admin` and `/api/admin/ai`), any wildcard middleware on the broader router MUST explicitly exclude paths belonging to narrower sub-routers. Pattern: `if (path.includes('/ai/') || path.includes('/quiz/')) return next();` at the top of the middleware. Plan phase must check `grep -c 'app.route(' index.ts` for overlapping prefixes and flag this risk.
**Check:** For any `router.use('*', middleware)` where the router is mounted at a prefix that overlaps with other sub-routers: `grep -c 'return next()' <middleware-file>` must include path exclusions for each overlapping sub-router.

### L-090: path.includes() matches sub-routes unintentionally — use anchored regex `[API]` `universal`
> 2026-04-06 | occurs: 1 | via: preprod-security-content-length-limits
**What happened:** `path.includes('/articles')` was used to apply a 1MB article limit, but it also matched action sub-routes like `/articles/:id/publish` and `/articles/:id/unpublish`. These action routes should have gotten the 256KB default limit. Review caught this as a warning (WARN-FIX-1).
**Root cause:** `String.includes()` is a substring match with no path segment awareness. Any route containing the substring matches, regardless of path depth or structure.
**Guardrail:** Route-aware middleware that assigns different limits/behavior per path pattern MUST use anchored regex instead of `includes()`. Pattern: `/\/(?:articles|pages)(?:\/[^/]+)?$/` matches CRUD routes (e.g., `/articles`, `/articles/123`) but NOT action sub-routes (e.g., `/articles/123/publish`). Plan ACs must specify which sub-routes should and should NOT match.
**Check:** `grep -c 'path.includes.*articles\|path.includes.*pages' <middleware-file>` should be 0 for route-tier matching. Use regex patterns instead.

### L-091: App-level auth middleware runs before sub-router middleware in Hono `[API]` `a2z-agent-demo`
> 2026-04-06 | occurs: 1 | via: preprod-security-content-length-limits
**What happened:** ManualQA against production returned 401 for ALL admin API requests regardless of body size. The body limit middleware (inside `adminApi` sub-router) never ran because the app-level auth middleware (`app.use('/api/admin/*', accessAuth(...))` in index.ts) returned 401 first for unauthenticated requests. Local dev with DEV_BYPASS_AUTH was required to test body limits.
**Root cause:** In Hono, `app.use(pattern, middleware)` registered at the app level runs before `app.route(prefix, subRouter)` handlers. The auth middleware at `app.use('/api/admin/*', ...)` executes before the request enters `adminApi` where `adminBodyLimit` is registered.
**Guardrail:** For security middleware (body limits, rate limiting) that must run before auth in production: register at the app level (`app.use()`), not inside sub-routers (`subRouter.use()`). For manualQA of middleware that runs after auth: test locally with DEV_BYPASS_AUTH. Document in manualQA.md that production testing requires authentication.
**Check:** When adding security middleware intended to block before auth: verify `grep -n 'app.use.*admin' index.ts` shows the new middleware registered BEFORE the auth middleware line number.

## 2026-04-06 — kodigital-alerting-infrastructure

### L-092: External service integrations must be validated for operational status during plan phase `[PROCESS]` `universal`
> 2026-04-06 | occurs: 1 | via: kodigital-alerting-infrastructure
**What happened:** Email delivery via MailChannels was built correctly — DNS SPF/lockdown records configured, code structure sound (HTML escaping, AbortController, admin-role recipient query). ManualQA discovered MailChannels discontinued its free Cloudflare Workers integration in 2024. All email_status entries showed "failed" despite correct implementation. A separate mission (kodigital-email-provider-switch) was required to switch to AWS SES.
**Root cause:** Plan phase designed the email delivery integration based on MailChannels documentation without verifying the service was still operational. No "smoke test" step in the plan validated that the external API endpoint accepts requests. L-075 covers verifying API response *headers*; this covers verifying the service *exists and accepts requests at all*.
**Guardrail:** Plan phase must include an "external service validation" step for any story that integrates with a third-party API: (1) curl the endpoint with a minimal test payload, (2) verify HTTP 2xx or expected auth-error (not connection refused/discontinued), (3) if validation fails, flag as BLOCKER before proceeding. For paid services, check pricing page for current status.
**Check:** Plan proposal.md must list all external APIs under a "## External Dependencies" section with `curl` validation results. `grep -c 'External Dependencies' proposal.md` >= 1 for any mission with external API integrations.

### L-093: Multi-channel delivery status rollup must distinguish "all skipped" from "sent" `[API]` `universal`
> 2026-04-06 | occurs: 1 | via: kodigital-alerting-infrastructure
**What happened:** When both Slack and email delivery channels were skipped (no webhook configured, no email provider), the delivery_status rollup mapped "both skipped" to "sent". This created false positives in the admin alerts dashboard — alerts appeared as successfully delivered when no delivery actually occurred. Review caught this; fix mapped both-skipped to "pending".
**Root cause:** The status rollup function used a simple mapping: any non-"failed" = "sent". When both channels skip (valid business scenario: alerting configured but no delivery channels set up yet), the fallback incorrectly indicated success.
**Guardrail:** Multi-channel delivery status aggregation must explicitly handle the "all channels skipped/inactive" case as a distinct status (e.g., "pending" or "no_channels"). Never treat absence of failure as success. Review phase must check: `grep -c 'skip.*sent\|skipped.*sent' <delivery-file>` = 0.
**Check:** In any multi-channel delivery system, verify: `grep -n 'delivery_status' <file>` shows explicit handling for all-skipped case separate from success case.

### L-094: First review iteration catch rate validates the review+fix cycle pipeline `[PROCESS]` `kodigital-dashboard`
> 2026-04-06 | occurs: 1 | via: kodigital-alerting-infrastructure
**What happened:** Review iteration 1 found 3 blockers (test file over limit, missing numeric validation on path params, no upper-bound on threshold_value) and 6 warnings (as any in tests, missing AbortController on MailChannels, both-skipped=sent, SQL concatenation, wrong column name, repetitive constructor). ALL 9 issues were fixed in WARN-FIX stories and review iteration 2 passed with 0 blockers, 2 minor warnings (both immediately fixed by WARN-FIX-4/5). Total: 11 issues caught and fixed within the pipeline — none leaked to manualQA as code bugs.
**Root cause:** N/A — this is a positive pattern. The 3-reviewer agent team (code quality, DB+security, UI+accessibility) with WARN-FIX story generation is working as designed. The review→fix→re-review cycle closes issues within the pipeline.
**Guardrail:** Continue requiring review iteration 2 after any fix stories. Log iteration count and fix count in phase-status.json for trend analysis.
**Check:** `phase-status.json` review section should show `iteration >= 2` and `blockers: 0` before proceeding to verify.

## 2026-04-06 — preprod-security-admin-security-headers

### L-095: Hono router isolation is the correct scoping mechanism for per-route security headers `[SECURITY]` `a2z-agent-demo`
> 2026-04-06 | occurs: 1 | via: preprod-security-admin-security-headers
**What happened:** Security response headers (X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy) needed to apply only to admin HTML pages, not to public pages, InsurePrimo, or admin API JSON endpoints. Implementation used `ui.use('*')` middleware on the dedicated admin UI router with `await next()` + `c.res.headers.set()` pattern. ManualQA confirmed: all 6 admin pages got headers, 3 API endpoints and 2 public sites were completely unaffected.
**Root cause:** N/A — this is a positive pattern. Hono's router composition (`app.route('/admin', adminUi)` vs `app.route('/api/admin', adminApi)`) provides natural isolation boundaries. Middleware on a sub-router does not leak to sibling routers.
**Guardrail:** For any per-route middleware (security headers, CORS, rate limiting), always scope to the specific Hono sub-router rather than using global `app.use()`. Verify isolation with: (1) list all `app.route()` registrations, (2) confirm middleware only in target router file, (3) manualQA regression on sibling routes.
**Check:** `grep -c 'app.use(' index.ts` should NOT increase for scoped middleware. Instead, `grep -c '.use(' <target-router>.ts` should show the new middleware.

### L-096: Simple security missions are ideal pipeline validation candidates `[PROCESS]` `universal`
> 2026-04-06 | occurs: 1 | via: preprod-security-admin-security-headers
**What happened:** This 1-story mission (add 4 response headers) completed the full pipeline — plan, run, review, verify, finish, manualQA — with 0 blockers, 0 code bugs, and 5/5 manualQA scenarios passing. The entire pipeline executed cleanly: review found only 1 pre-existing warning (file size), verify confirmed all 7 grep-based ACs, and manualQA validated live header presence plus regression on 5 endpoints.
**Root cause:** Small, well-scoped security changes with purely additive behavior (setting headers, no logic changes) have minimal blast radius and clear acceptance criteria (header present = pass). This makes them reliable pipeline validation signals.
**Guardrail:** When pipeline infrastructure changes are made (a2z-improve), run a simple security/config mission as the validation canary before attempting complex missions. If the simple mission fails, the pipeline has a regression.
**Check:** Track simple-mission success rate in session-telemetry.jsonl. Any simple mission with blockers > 0 at review = pipeline quality signal.

## 2026-04-06 — kodigital-d1-retention-scaling

### L-098: Architecture.md security directives must be cross-verified against implementation `[PROCESS]` `universal`
> 2026-04-06 | occurs: 1 | via: kodigital-d1-retention-scaling
**What happened:** Architecture.md specified `substituteParams` for ClickHouse queries (line 210), but implementation used raw string interpolation. Review caught the divergence (B1 blocker), run fixed it (FIX-1 with input validation). The architecture→implementation drift was invisible to type checking and functional tests.
**Root cause:** Review phase does not systematically cross-reference architecture.md directives against implementation. Security-relevant directives (parameterization, auth patterns) are especially dangerous when silently dropped — code compiles and runs but the security property is lost.
**Guardrail:** Review DB+Security reviewer MUST read architecture.md and verify each security-relevant directive is implemented as specified. If architecture.md says "use X" and implementation uses "Y", that is a BLOCKER even if "Y" works functionally.
**Check:** Review-findings.md should include an "Architecture Compliance" section. `grep -c 'architecture.md' review-findings.md` >= 1 for any mission with architecture.md.

## 2026-04-07 — campgen-manual-bridge-ship

### L-099: User input in SQL LIKE patterns must escape `%` and `_` before construction `[DB]` `universal`
> 2026-04-07 | occurs: 1 | via: campgen-manual-bridge-ship
**What happened:** The `q` search parameter in GET /api/v1/jobs was truncated to 100 chars (good) and passed via `.bind()` (good), but `%` and `_` characters within the value were not escaped before wrapping with `'%' + q + '%'`. A user could search for `%` to match all preset names, or `_` to match any single character — broader results than intended.
**Root cause:** Parameterized queries (`.bind()`) prevent SQL injection but do NOT prevent LIKE pattern injection. `%` and `_` are wildcard characters within the LIKE pattern itself, not SQL injection vectors. They need separate escaping with `ESCAPE` clause.
**Guardrail:** Any user input used in a LIKE pattern must: (1) escape `%` → `\%` and `_` → `\_`, (2) add `ESCAPE '\'` to the LIKE clause. Review DB+Security checker should flag any LIKE clause where the bound value could contain user input.
**Check:** `grep -c "ESCAPE" <file-with-LIKE>` >= 1 for every file using LIKE with user-provided values.

### L-100: CF Access service tokens bypass edge auth but fail Worker JWT email validation `[TESTING]` `campaign-generator`
> 2026-04-07 | occurs: 1 | via: campgen-manual-bridge-ship
**What happened:** ManualQA attempted to test production API endpoints using CF Access service token headers (`CF-Access-Client-Id` + `CF-Access-Client-Secret`). The service token successfully bypassed the CF Access 302 redirect (routes returned 401 instead of 302), but the Worker's `authMiddleware` still rejected with "Invalid or expired JWT." The middleware validates `payload.email` which service token JWTs don't include (service tokens represent machines, not users).
**Root cause:** CF Access service tokens are for machine-to-machine auth. They generate a JWT that CF Access edge accepts, but the JWT lacks user-identity claims (`email`). Our Worker auth middleware (`verifyJwt`) requires `payload.email`, causing rejection even with a valid service token.
**Guardrail:** For API-only manualQA on CF Access-protected Workers: (1) use Playwright browser auth to get `CF_Authorization` cookie with user JWT, then reuse cookie for curl, OR (2) test via `wrangler dev` local mode with `DEV_BYPASS_AUTH=true` for endpoint logic + production D1 queries for data layer + production route registration checks (401 vs 404) for deployment verification. Document the test methodology in the report.
**Check:** ManualQA reports for CF Access-protected APIs must include a "Test Methodology" section explaining how auth was handled.


## 2026-04-07 — psychic-quiz-button-fix

### L-102: ManualQA must verify deployed code via `git show origin/main:` not local filesystem `[PROCESS]` `universal`
> 2026-04-07 | occurs: 1 | via: kodigital-ch-mv-scalability
**What happened:** During manualQA, reading the local `sync-dispatcher.ts` showed NONE of the mission's changes (no MV_TIMEOUTS, no MV_DEPENDENCIES, no skippedMVs, no parallelization). Initial conclusion: changes not deployed. Investigation revealed: local `main` was 3 commits behind `origin/main` because the workspace submodule reference hadn't been updated. `git show origin/main:api/src/do/sync-dispatcher.ts` correctly showed all deployed changes. `gh pr view 143` confirmed merge at 2026-04-06T22:05:06Z.
**Root cause:** Workspace uses git submodules. Parent repo's submodule pointer updates independently of the submodule's remote main. After PR merge, `origin/main` in the submodule has the code, but the local checkout may point to an older commit.
**Guardrail:** ManualQA code verification MUST use `git show origin/main:<path>` (after `git fetch origin`) instead of reading local filesystem files. This applies to any workspace with submodules or where local main may lag remote.
**Check:** ManualQA reports verifying deployed code should include `git log --oneline origin/main -1` evidence, not just local file reads.

### L-103: D1 `started_at` timestamps prove parallelization — use before/after comparison `[TESTING]` `universal`
> 2026-04-07 | occurs: 1 | via: kodigital-ch-mv-scalability
**What happened:** To verify Promise.allSettled parallelization of 3 MVs, queried `ch_mv_refresh_status` for pre-deploy vs post-deploy sync cycles. Pre-deploy: each MV started ~110ms after previous (sequential). Post-deploy: 3 MVs started at identical millisecond (e.g., 22:34:54.519) across all 3 cycles. This was definitive proof of parallel execution without needing log analysis or Worker tail.
**Root cause:** N/A — positive pattern, not a failure.
**Guardrail:** For any mission that parallelizes sequential operations: if the operations write timing metadata to D1/storage, use `started_at` timestamp comparison as the primary manualQA verification method. Identical or near-identical start times = parallel. Sequential gaps = still serial.
**Check:** `SELECT mv_name, started_at FROM ch_mv_refresh_status WHERE sync_cycle_id = '<id>' ORDER BY started_at` — parallel MVs share the same `started_at` value.

## 2026-04-07 — psychic-quiz-complete-idempotency

### L-104: Use INSERT OR IGNORE (not plain INSERT) when multiple code paths write to the same UNIQUE-constrained D1 table `[DB]` `universal`
> 2026-04-07 | occurs: 1 | via: psychic-quiz-complete-idempotency
**What happened:** The /complete handler used plain `INSERT INTO quiz_answers` inside a loop. If /answer had already stored some answers (or if /complete itself partially completed and the user retried), the UNIQUE(session_id, question_key) constraint threw a 500 error. The session stayed 'active' but every retry hit the same UNIQUE violation — creating an unrecoverable stuck state.
**Root cause:** When two code paths (/answer stores individual answers, /complete stores all answers at once) write to the same table with UNIQUE constraints, plain INSERT fails on duplicates. The fix is `INSERT OR IGNORE` on the path that runs second (the bulk-insert path).
**Guardrail:** Plan phase: when a table has UNIQUE constraints and multiple writers, flag the INSERT pattern. Review phase: grep for `INSERT INTO` on tables with UNIQUE constraints — if multiple code paths touch the same table, verify OR IGNORE or ON CONFLICT handling.
**Check:** `grep -n 'INSERT INTO' <file> | grep -v 'OR IGNORE\|ON CONFLICT'` on files that write to UNIQUE-constrained tables — any hits on multi-writer tables are suspect.

### L-105: ManualQA can simulate partial failures via D1 direct INSERT to test idempotency `[TESTING]` `universal`
> 2026-04-07 | occurs: 1 | via: psychic-quiz-complete-idempotency
**What happened:** To test the idempotency fix, manualQA needed to simulate "answers already stored by /answer before /complete runs." The /answer endpoint was broken (pre-existing bug), so direct D1 insertion via `wrangler d1 execute --remote` was used to pre-insert 3 answers. Then /complete was called with all 12 answers — it returned 200 and D1 showed 12 rows (not 15), proving INSERT OR IGNORE worked.
**Root cause:** N/A — positive testing technique.
**Guardrail:** For idempotency/retry testing: when the normal API path to set up the pre-condition is unavailable, use `wrangler d1 execute --remote` to inject the pre-condition data directly into D1. Then call the API under test and verify the expected behavior. Always verify row counts after to confirm no duplicates.
**Check:** After idempotency test: `SELECT COUNT(*) FROM <table> WHERE session_id = '<id>'` must equal expected unique count, not the sum of all insert attempts.

## 2026-04-07 — campgen-phase4-frontend

### L-106: React Query mutation hooks require explicit onError + isError handling `[UI]` `universal`
> 2026-04-07 | occurs: 1 | via: campgen-phase4-frontend
**What happened:** `createCampaign.mutate()` in the Manual Builder had no `onError` callback, no `isError` check in JSX, and no toast/inline error. If the API call failed, the user got zero feedback. Similarly, `useGeneratorAccounts()` only destructured `data` — if the accounts API failed, the sidebar showed an empty list with no error state or retry.
**Root cause:** Default React Query/tRPC hook usage returns `data` which works on the happy path. Developers naturally destructure only `data` and forget `isError`/`error`/`refetch`. No AC or architect checklist required error state handling for query/mutation consumers.
**Guardrail:** Architect phase: every story that adds a new `useMutation` or `useQuery` consumer MUST include ACs for: (1) `onError` callback or `isError` JSX branch, (2) user-visible error feedback (toast, inline error, or retry button). Review phase: `grep -c 'useMutation\|useQuery\|useSuspenseQuery' <file>` and verify matching `isError\|onError\|error` count.
**Check:** For each file with `useMutation`: `grep -c 'onError\|isError' <file>` >= 1. For each file with `useQuery`: `grep -c 'isError\|error,' <file>` >= 1.

### L-107: Client-side RBAC via useEffect leaks unauthorized content for one frame `[SECURITY]` `universal`
> 2026-04-07 | occurs: 1 | via: campgen-phase4-frontend
**What happened:** The generator layout used `useEffect` to redirect viewers away from unauthorized pages (e.g., /generator/manual). Because `useEffect` runs AFTER the initial render, the viewer saw the Manual Builder form for one frame before the redirect fired. This is a security concern — unauthorized content is briefly visible.
**Root cause:** `useEffect`-based redirects are asynchronous by design. The component renders its children first, then the effect checks the role and redirects. There's no synchronous gate preventing the initial render.
**Guardrail:** Client-side RBAC MUST use a synchronous guard pattern: check role BEFORE rendering children. If `role === "viewer"` and path is unauthorized, return a spinner/null instead of `{children}`. Never rely on `useEffect` alone for access control rendering. Architect AC: `grep -c 'if.*viewer.*return\|if.*role.*return' <layout>.tsx` >= 1 (synchronous guard).
**Check:** `grep -B2 -A2 'useEffect.*redirect\|useEffect.*router.replace' <layout>.tsx` — if found without a preceding synchronous return guard, flag as BLOCKER.

### L-109: Durable Object counter/quota state must only persist for allowed operations `[API]` `universal`
> 2026-04-07 | occurs: 1 | via: kodigital-security-rate-limiting
**What happened:** Rate limiter DO incremented and persisted the request counter via `storage.put()` BEFORE checking whether the limit was exceeded. Denied requests (count > limit) still incremented the counter, inflating it beyond the limit value. While functionally benign in a fixed-window scheme (window resets regardless), it means the stored count diverges from the actual allowed-request count, complicating debugging and monitoring.
**Root cause:** The increment-then-check pattern is the natural coding sequence but produces incorrect semantic state. No review check existed for DO storage mutation ordering relative to business logic decisions.
**Guardrail:** For any Durable Object that maintains counters, quotas, or rate state: the `storage.put()` call MUST be AFTER the limit/quota check, and ONLY executed when the operation is allowed. Review phase checks: read current state → evaluate limit → if allowed: increment + persist → respond. If denied: respond without mutation.
**Check:** In DO fetch handler, verify `storage.put()` is inside the `if (allowed)` branch, not before the limit check. `grep -B3 'storage.put' <do-file>.ts` — the preceding lines must contain the limit check.

### L-110: Zod recursive schemas require explicit `z.ZodType<T>` annotation to preserve type safety `[API]` `universal`
> 2026-04-07 | occurs: 1 | via: kodigital-security-rate-limiting
**What happened:** `conditionGroupSchema()` using `z.lazy()` for recursive ConditionGroup validation returned unparameterized `z.ZodType`. This erases the inferred schema shape — downstream `.parse()` results are typed as `unknown` rather than the concrete `ConditionGroup` type. Consumers must cast or re-annotate, defeating the purpose of schema-driven validation.
**Root cause:** `z.lazy()` is Zod's workaround for recursive types, but its return type is intentionally broad. Without an explicit type parameter, TypeScript cannot infer the recursive shape.
**Guardrail:** For any Zod schema using `z.lazy()` for recursive types: annotate the return type as `z.ZodType<ConcreteType>` where `ConcreteType` is the TypeScript interface being validated. Import the type from the types file. AC: `grep -c 'ZodType<' <schema-file>.ts` >= 1 for each recursive schema.
**Check:** `grep -c 'ZodType<' api/src/schemas/*.ts` — every file with `z.lazy()` must have a corresponding `ZodType<T>` annotation.

### L-111: Intentional AC deviations with inline documentation are valid — verify must assess intent `[PROCESS]` `universal`
> 2026-04-07 | occurs: 1 | via: kodigital-security-rate-limiting
**What happened:** WARN-FIX-3 had two AC grep patterns that didn't match the implementation: (1) AC expected `SQL interpolation` but code used `interpolatable into SQL` — same security intent, different wording. (2) AC expected `Number(p) ?? 1` but code intentionally kept `Number(p) || 1` with inline comment explaining that page=0 is semantically invalid and `Math.max(1, ...)` provides the same guard. Verify phase assessed both as "defensible implementation choices" and passed.
**Root cause:** AC grep patterns are written during plan/architect phase before implementation. Ralph may implement the intent with better-fitting code that doesn't match the literal pattern. When the deviation is intentional and documented with a code comment, the AC pattern is wrong, not the implementation.
**Guardrail:** When verify phase finds an AC grep pattern that returns 0 but the semantic intent IS met (confirmed by reading the actual code + inline comment): verdict is PASS WITH FINDING, not FAIL. The finding documents the AC pattern mismatch for learn phase. HOWEVER: if there is no inline comment explaining the deviation, verdict is FAIL — silent deviations are bugs, documented deviations are decisions.
**Check:** For AC mismatches: `grep -c '<intent-phrase>' <file>` — if the intent exists with different wording AND an inline comment explains the choice, log as finding, not failure.

### L-112: Sibling endpoints cloned without resolving data dependencies produce hardcoded zeros `[API]` `universal`
> 2026-04-07 | occurs: 1 | via: psychic-quiz-answer-question-id-fix
**What happened:** POST /answer endpoint used `.bind(session.id, 0, questionKey, answerValue, 0, null)` — hardcoding `question_id=0` and `weight_snapshot_json=null` — while the sibling /complete endpoint correctly loaded quiz content and resolved these values. The /answer handler was built without the `loadQuizContent()` call that /complete already had, making every saved answer have question_id=0 and no weight data.
**Root cause:** When a new endpoint shares the same data model as an existing one but is implemented independently, developers hardcode placeholder values for fields they don't immediately need. Without a plan-level check that all INSERT columns resolve to real data, placeholders ship as production code.
**Guardrail:** Plan phase must enumerate ALL columns in every INSERT/UPDATE statement per story and verify each resolves to a real value (not 0, null, or empty string) from the data model. Architect phase adds AC: `grep -c '<hardcoded-placeholder-pattern>' <file> = 0` for each column that should resolve dynamically. Review DB+Security check: for each `.bind()` call, verify no literal `0` or `null` stands in for a column that has a FK or semantic relationship.
**Check:** `grep -n '\.bind(' <api-file>.ts` — for each bind call, verify no literal `0` or `null` occupies a column position that references another table or has semantic meaning.

### L-113: AC patterns checking test output must not match log-level substrings `[PROCESS]` `universal`
> 2026-04-07 | occurs: 1 | via: kodigital-cross-account-isolation-test
**What happened:** T3-AC7 used `npm test 2>&1 | grep -c 'FAIL' | xargs test 0 -eq` to assert zero test failures. The grep matched 3 lines containing log-level substrings (RECONCILIATION_FETCH_FAILED, RECONCILIATION_FAILED, "query status is FAILED") from test console output — not actual test failures. All 473 tests passed with 0 failures, but the AC reported FAIL (false negative).
**Root cause:** `grep -c 'FAIL'` is too broad for test runner output because application log messages, error enum names, and status constants routinely contain "FAIL" as a substring. The AC author assumed only vitest failure lines would contain "FAIL".
**Guardrail:** AC patterns that check test output for pass/fail MUST use the test runner's structured output, not raw substring matching. For vitest: check the exit code (`npm test; echo $?` = 0), or use vitest's JSON reporter (`--reporter=json`), or match the specific vitest failure format (`grep -c '^FAIL '` with leading anchor + space). Never use unanchored `grep -c 'FAIL'` on test output.
**Check:** `grep -n "grep.*FAIL\|grep.*ERROR\|grep.*PASS" acceptance-tests/*.sh` — verify all test-output greps use anchored patterns (`^FAIL `, `^ERROR `) or exit-code checks, not unanchored substrings.


## 2026-04-07 — campgen-rbac-body-double-read

### L-114: L-062 recurrence — plan skill still does not generate manualQA.md for API-only missions `[PROCESS]` `universal`
> 2026-04-07 | occurs: 2 | via: campgen-rbac-body-double-read (recurrence of L-062 via kodigital-automation-data-safety)
**What happened:** Plan phase completed with proposal.md, tasks.md, prd.json, and architecture.md but did NOT generate manualQA.md. The mission had 2 API-only stories (middleware changes, zero UI). ManualQA phase was blocked until it created the test plan ad-hoc from prd.json. This is the second occurrence — L-062 documented the same gap on 2026-04-03 (kodigital-automation-data-safety). The L-062 guardrail was never enforced in the a2z-plan skill.
**Root cause:** a2z-plan skill has no enforcement check for manualQA.md generation. The artifact list in the skill's Phase 5 treats manualQA.md as implicit/optional rather than mandatory. API-only missions skip it because the developer assumption is "no UI = no manual QA needed," but endpoint precedence, error handling, and regression scenarios still require structured test plans.
**Guardrail:** a2z-plan validation script must check `ls openspec/changes/<change-id>/manualQA.md` exists after Phase 5 artifact write. FAIL if missing regardless of story categories. /a2z-improve target: add manualQA.md to mandatory artifact list in a2z-plan SKILL.md.
**Check:** `ls openspec/changes/<change-id>/manualQA.md` returns 0 exit code for every completed plan phase. `grep -c 'manualQA.md' .claude/skills/a2z-plan/SKILL.md` >= 1 in mandatory artifact list.

## 2026-04-08 — kodigital-campaigns-tab-professional-upgrade

### L-116: AG Grid ValueFormatterParams signature prevents direct shared formatter reuse `[PATTERN]` `kodigital-dashboard`
> 2026-04-08 | occurs: 1 | via: kodigital-campaigns-tab-professional-upgrade (review W-DUP-1 valid skip)
**What happened:** Review flagged columns.ts re-declaring currencyFormatter, numberFormatter, percentFormatter that exist in @/lib/formatters.ts. Investigation showed this was a valid pattern: AG Grid's ValueFormatterParams has signature `(params: ValueFormatterParams) => string` while shared formatters use `(value: number) => string`. Direct import isn't possible without an adapter.
**Root cause:** AG Grid's cell formatter API requires the full params object, not just the raw value. Shared utility formatters are designed for direct value transformation. The two APIs are fundamentally incompatible without wrappers.
**Guardrail:** When architecting AG Grid features, plan AG Grid-specific formatter adapters: `const agCurrencyFormatter = (p: ValueFormatterParams) => formatCurrency(p.value)`. Review phase should check signature compatibility before flagging AG Grid formatter declarations as duplication.
**Check:** Review warnings about duplicate formatters in AG Grid contexts: verify `ValueFormatterParams` signature difference before escalating to WARN-FIX.

### L-117: Multiple bulk action paths need consistent UX feedback patterns `[PATTERN]` `universal`
> 2026-04-08 | occurs: 1 | via: kodigital-campaigns-tab-professional-upgrade (review W-3)
**What happened:** The set-value bulk action path had optimistic cache updates (queryClient.setQueriesData) but the increment path (handleIncrementConfirm) only called invalidateQueries. Users see instant feedback for set-value but a brief stale flash for increment actions.
**Root cause:** MQAFIX-7 (increment controls) was implemented separately from MQAFIX-6 (optimistic updates for set-value). The increment path was added without matching the UX pattern already established for set-value.
**Guardrail:** Architecture phase must identify all action paths performing similar operations and include an explicit "UX consistency" AC: all paths use the same feedback pattern (optimistic update OR invalidate — not mixed). Architect documents which pattern each path uses in a comparison table.
**Check:** For bulk action components: count of `setQueriesData` calls should match count of distinct action handlers, or all handlers should use only `invalidateQueries`.

### L-120: Zustand persist rehydration accepts structurally invalid data without runtime validation `[UI]` `kodigital-dashboard`
> 2026-04-08 | occurs: 1 | via: kodigital-campaigns-tab-professional-upgrade (DB+Security W1 — global-filters.ts)
**What happened:** Zustand `persist` middleware's `onRehydrateStorage` catches JSON parse errors and deletes corrupted localStorage, which is correct. However, if tampered localStorage parses as valid JSON but with unexpected types (e.g., `presets` as a string instead of array, or `autoRefreshInterval: "malicious"` instead of number), the store accepts it without runtime type validation. This can cause runtime TypeErrors when the component tries to `.map()` on a string or do arithmetic on a non-number.
**Root cause:** `onRehydrateStorage` only guards against unparseable JSON, not structurally invalid data. There is no schema validation between JSON.parse and store hydration.
**Guardrail:** Any Zustand persist store that reads user-controlled data (localStorage) should validate array fields with `Array.isArray()` and numeric fields with `typeof === 'number'` in `onRehydrateStorage`, or use Zod `.safeParse()` for full schema validation. Review phase checks: persist middleware → has runtime guard on rehydrated state shape.
**Check:** `grep -A5 'onRehydrateStorage' <store>.ts` shows type validation (Array.isArray, typeof, or Zod) before returning hydrated state.

### L-121: Dashboard API endpoint paths drift when dev proxy rewrites differ from production routing `[API]` `kodigital-dashboard`
> 2026-04-08 | occurs: 1 | via: kodigital-campaigns-tab-professional-upgrade (MQAFIX-1 — /api/health vs /health)
**What happened:** The dashboard's `use-sync-status.ts` hook called `/api/health` (prefixed path matching Next.js dev proxy rewrites). In production, the Cloudflare Worker serves health at `/health` (no prefix). ManualQA caught a 404 on the freshness endpoint post-deploy that passed all pre-deploy verification (typecheck, unit tests, code review).
**Root cause:** Local development uses Next.js rewrites (`/api/*` → Worker), so `/api/health` works during `npm run dev`. Production routes directly to the Worker where the route is mounted as `/health`. No pre-deploy test exercises the actual production URL path.
**Guardrail:** Architecture phase for dashboard features consuming API endpoints must include a "URL path mapping" table: dev path → production path → which component calls it. Acceptance criteria must include a `grep` check confirming the production-correct path. MQAFIX prevention: manualQA.md should list all new API endpoints with their production URLs for post-deploy smoke testing.
**Check:** `grep '/api/' dashboard/src/hooks/*.ts` — any match needs verification against production Worker route paths in `api/src/routes/`.

## 2026-04-08 — psychic-quiz-ai-images

### L-122: Shared utility functions with commented-out parameters cause silent functional failure `[API]` `universal`
> 2026-04-08 | occurs: 1 | via: psychic-quiz-ai-images (review BLOCKER B1)
**What happened:** The generate-images endpoint passed `response_format: 'b64_json'` to `OpenAIClient.generateImage()`. The TypeScript interface (`ImageGenerationRequest`) accepted the parameter, but the implementation in `ai/client.ts` had `response_format` commented out with a note "Removed to avoid Unknown parameter on some models." The API defaulted to URL format, the code tried to read `b64_json` from the response, got `undefined`, and every image generation failed silently with "No image data in response."
**Root cause:** A compatibility fix (commenting out a parameter) created interface-implementation divergence. TypeScript compiled cleanly because the interface still declared the field. No runtime error — just wrong default behavior from the upstream API. Unit tests mocked the AI client and didn't exercise the real parameter forwarding.
**Guardrail:** Review Code Quality checker must verify that when a function call passes optional parameters to a shared utility, the utility's implementation actually uses them (not just the TypeScript interface). Pattern: `grep -v '//' <utility>.ts | grep '<param_name>'` to confirm non-commented usage. Architect phase for features depending on optional parameters of shared utilities must include an AC that greps for active (non-commented) parameter forwarding.
**Check:** `grep -v '//' api/src/ai/client.ts | grep 'response_format'` returns >= 1 match (active code, not comments).

### L-123: ManualQA test plan URLs must be derived from actual code values, not naming assumptions `[TESTING]` `universal`
> 2026-04-08 | occurs: 1 | via: psychic-quiz-ai-images (manualQA observation)
**What happened:** manualQA.md listed test URLs `/media/quiz/psychic/success/relationship.png` but actual storageKeys in image-specs.ts used `success-relationship` (name field includes the category prefix), producing paths `/media/quiz/psychic/success/success-relationship.png`. Three out of 10 URLs in the test plan were wrong, requiring manual correction during manualQA execution.
**Root cause:** Plan phase constructed manualQA.md URLs from a mental model of the naming convention ("category/name") without verifying against the actual `storageKey` values defined in code. The `name` field in image-specs.ts already included the category prefix (`success-relationship`), making the path `success/success-relationship.png`.
**Guardrail:** Plan phase must derive manualQA.md test URLs by grepping actual code values (storageKeys, route definitions, config constants) rather than constructing them from naming conventions. AC for manualQA.md: every URL listed must have a corresponding `grep` match in the source code that produced it.
**Check:** For each URL in manualQA.md, `grep '<path-segment>' <source-file>` returns >= 1 match confirming the exact path exists in code.


## 2026-04-09 — campgen-security-authz-business-isolation

### L-127: Object spread `{ ...parsed.data }` bypasses grep-based AC checks for field-level security isolation `[SECURITY]` `universal`
> 2026-04-09 | occurs: 1 | via: campgen-security-authz-business-isolation (BLOCKER: presets.ts)
**What happened:** The mission's grep-based AC checked `grep -rc 'parsed.data.business_id' api/src/routes/` to verify no handler uses body-sourced `business_id`. It returned 0 — PASS. But `presets.ts:56` used `createPreset(c.env.DB, { ...parsed.data, created_by: user.email })`, which spreads the entire `parsed.data` object including `business_id` from the POST body. The body-sourced `business_id` was written to D1, allowing cross-business preset injection. The grep pattern was syntactically correct but semantically blind to spread operator data flow.
**Root cause:** Grep-based ACs that check for explicit field access (`parsed.data.field`) cannot detect implicit data flow through spread operators (`{ ...parsed.data }`). The spread operator copies ALL properties including security-critical ones, without any explicit reference to the field name. This is a class of AC bypass — the security violation is invisible to text-based pattern matching.
**Guardrail:** For multi-tenant isolation missions, ACs must include TWO checks: (1) explicit field access grep (`parsed.data.business_id`) AND (2) spread operator usage grep (`grep -c '\.\.\.parsed' <route-file>` — if > 0, verify the spread target is overridden with the authenticated value: `grep -A1 '\.\.\.parsed' <file>` must show `business_id: c.get('businessId')`). Architect phase must flag any `{ ...parsed.data }` in route handlers as a security review point.
**Check:** `grep -c '\.\.\.parsed' api/src/routes/*.ts` — every match must have an override for tenant-scoped fields on the same or next line.

### L-128: Zod schemas accepting security-critical fields from untrusted input create latent mutation risks `[SECURITY]` `universal`
> 2026-04-09 | occurs: 1 | via: campgen-security-authz-business-isolation (WARNING: Zod schemas)
**What happened:** Three Zod schemas (`createPresetSchema`, `campaignCreateSchema`, `createDayPlanSchema`) accepted `business_id` from the request body. Current handlers correctly override with `c.get('businessId')`, but `presets.ts` demonstrated that any handler spreading `parsed.data` silently inherits the body value. The schemas serve as the entry point — if they accept the field, it flows into `parsed.data` and is available for accidental use. Production safety rules kept `business_id` in schemas for "backward compat" but this created the exact vulnerability the mission was fixing.
**Root cause:** "Keep for backward compatibility, handlers will ignore it" is a fragile defense. It relies on every current AND future handler knowing to override the field. The schema is the trust boundary — accepting a field means validating it as legitimate input.
**Guardrail:** For tenant-scoped fields (business_id, org_id, account_id): either (a) remove from Zod input schemas entirely and inject from authenticated context, or (b) add `.omit({ business_id: true })` post-parse before spreading. Plan phase for multi-tenant APIs must enumerate all Zod schemas that accept tenant-scoped fields and decide strip-at-schema vs override-at-handler. Review DB+Security checker must flag any Zod schema that includes a tenant-scoped field.
**Check:** `grep -c 'business_id' api/src/schemas/*.ts` — if > 0, verify each schema has `.omit()` or the consuming handler has an explicit override after spread.


## 2026-04-09 — insureprimo-conversion-critical-issue-2026-04-08

### L-129: Acceptance-tests/ directory retains stale scripts from prior missions, invalidating verify-phase AC execution `[PROCESS]` `universal`
> 2026-04-09 | occurs: 1 | via: insureprimo-conversion-critical-issue-2026-04-08
**What happened:** The verify phase found that `acceptance-tests/` contained scripts from a different mission (security hardening: settings-key-allowlist, sanitize-html, validate-script-field) — not the current mission's dedup stories (T1, T2, T3). AC verification fell back to manual grep execution against story criteria, bypassing the executable AC pipeline entirely.
**Root cause:** No cleanup of `acceptance-tests/` between missions sharing the same repo. Prior mission's scripts persist and the verify phase has no pre-check validating that script filenames correspond to the current prd.json story IDs.
**Guardrail:** Verify phase must validate that `acceptance-tests/*.sh` script names correspond to current prd.json story IDs before executing. If mismatch detected: log WARNING with the stale script names and fall back to manual AC verification. Plan/architect phases should include a cleanup step removing stale scripts before generating new ones.
**Check:** `ls acceptance-tests/*.sh 2>/dev/null | xargs -I{} basename {} .sh` — each script basename should match a story ID prefix in `jq -r '.stories[].id' prd.json`. Mismatches = stale contamination.

### L-130: External API behavior-dependent mainGoals require explicit post-deploy observation protocol in plan `[PROCESS]` `universal`
> 2026-04-09 | occurs: 1 | via: insureprimo-conversion-critical-issue-2026-04-08
**What happened:** mainGoal "Facebook Purchase event count from InsurePrimo has zero duplicate CPL CAPI events" was inherently unverifiable pre-deploy — it required deploying GAS script + Worker, waiting for 3 consecutive hourly GAS runs, then comparing FB Purchase event count vs Athena click count. The verify phase correctly flagged this as an assumption and the QA report constructed a 4-step post-deploy protocol, but this protocol was improvised during verify/QA rather than designed in the plan.
**Root cause:** Plan phase didn't include a structured "Post-Deploy Verification Protocol" despite the mainGoal depending entirely on external API behavior observable only in production. Evidence standard E9 says "not verifiable pre-deploy" doesn't justify PASS — but the plan didn't define what DOES justify PASS post-deploy.
**Guardrail:** Plan phase for missions where mainGoal depends on external API behavior must include a "Post-Deploy Verification Protocol" section in proposal.md with: (1) deploy sequence with ordering dependencies, (2) observation window duration and trigger (e.g., "3 consecutive hourly cron runs"), (3) specific metrics/queries to compare with data sources, (4) pass/fail threshold. This section flows directly to manualQA.md as the primary validation scenario.
**Check:** `grep -c 'Post-Deploy Verification' proposal.md` >= 1 for missions with external API-dependent mainGoals. `grep -c 'observation window\|observation period' manualQA.md` >= 1.


## 2026-04-09 — psychic-quiz-branch-fix

### L-131: Client-side template JS mirroring server-side TS logic must be updated in lockstep `[UI]` `universal`
> 2026-04-09 | occurs: 1 | via: psychic-quiz-branch-fix (plan discovery)
**What happened:** Server-side `branch-evaluator.ts` used key-first/ID-fallback matching (`r.source_question_key !== undefined ? r.source_question_key === currentQuestionKey : r.source_question_id === question.id`), but client-side `scripts-engine.ts` only used ID-based matching (`r.source_question_id === question.id`). The divergence meant quiz branching could malfunction in production when branch rules had `source_question_key` set but question IDs didn't match between environments. TypeScript compilation and unit tests couldn't catch this because: (a) the client code is a template literal emitting ES5 JS (no type checking), (b) server tests used server logic, client behavior was untested.
**Root cause:** When a TypeScript template function generates inline JS that mirrors server-side TS logic, there is no automated mechanism to detect divergence. The server logic was updated to add key-first matching, but the corresponding client template was not. Code review didn't flag it because the two files are in different directories with different purposes (module vs template).
**Guardrail:** Plan phase for quiz/funnel engines must check for client/server logic pairs: `grep -rn 'evaluateBranchRules\|evaluateNextStep' api/src/quotes/*/templates/ api/src/quotes/*/*.ts` — if a function name appears in both a template and a module, the plan must include a parity story or verification AC. Review must cross-reference template logic against the server module it mirrors.
**Check:** `diff <(grep -oP 'source_question_key|source_question_id' api/src/quotes/psychic-quiz/branch-evaluator.ts | sort) <(grep -oP 'source_question_key|source_question_id' api/src/quotes/psychic-quiz/templates/scripts-engine.ts | sort)` — output should be empty (same field references in both files).


## 2026-04-09 — campgen-security-csrf-cors-headers

### L-132: Security headers middleware must register BEFORE errorHandler in Hono middleware chain `[SECURITY]` `universal`
> 2026-04-09 | occurs: 1 | via: campgen-security-csrf-cors-headers
**What happened:** Architecture phase identified that security headers middleware (X-Content-Type-Options, X-Frame-Options, Cache-Control, etc.) must be registered BEFORE errorHandler in the Hono middleware chain. Since securityHeaders uses `await next()` then sets headers on the response, registering it before errorHandler ensures that error responses (4xx, 5xx) also receive all security headers. ManualQA confirmed: 404 responses included all 6 security headers.
**Root cause:** Intuitive ordering would place security headers after error handling, but Hono's middleware model requires the opposite — the outer middleware (registered first) wraps inner middleware, so headers set after `await next()` apply to ALL responses including errors.
**Guardrail:** For any Hono API adding response-modifying middleware (security headers, cache headers, CORS): verify middleware order with `grep -n` on registrations. Response-modifying middleware that uses `await next()` pattern MUST be registered before errorHandler.
**Check:** `grep -n 'securityHeaders\|errorHandler' api/src/index.ts` — securityHeaders line number must be LOWER than errorHandler line number.

### L-133: CSRF middleware must fail-closed on ALL missing/malformed origin paths `[SECURITY]` `universal`
> 2026-04-09 | occurs: 1 | via: campgen-security-csrf-cors-headers
**What happened:** CSRF middleware was designed with 5 explicit fail-closed paths, all verified in production: (1) missing Origin + missing Referer → 403, (2) missing Origin + malformed Referer → 403, (3) Origin: null (sandboxed iframe) → 403, (4) evil origin → 403, (5) valid Origin overrides evil Referer (Origin takes precedence). The `!origin || !allowed.includes(origin)` guard catches undefined, null, and empty string. ManualQA deep verification (DV-1 through DV-7) confirmed all paths.
**Root cause:** Incomplete CSRF implementations often fail-open on edge cases (missing headers, malformed URLs). Explicit testing of each bypass vector during architecture and manualQA prevents this.
**Guardrail:** Any CSRF middleware plan must include AC for each bypass vector: missing Origin, missing Referer, both missing, malformed Referer, `Origin: null`, and Origin-vs-Referer precedence. Review must verify fail-closed behavior on all paths.
**Check:** Plan AC count for CSRF story should be >= 8 (safe method exempt + at least 5 bypass vectors + type check + file size).

### L-134: Shared origin allowlist as pure function prevents CORS/CSRF drift `[SECURITY]` `campaign-generator`
> 2026-04-09 | occurs: 1 | via: campgen-security-csrf-cors-headers
**What happened:** Origin validation was extracted to `getAllowedOrigins(environment: string): string[]` as a pure function in `lib/allowed-origins.ts`. Both CORS middleware (index.ts origin callback) and CSRF middleware (csrf.ts validation) import and call this single function. This ensures the allowed origins list is identical in both layers — no risk of CORS allowing an origin that CSRF rejects or vice versa.
**Root cause:** L-078 established two-layer defense (CORS + CSRF), but without a shared origin source, the two layers can drift independently. A pure function with environment parameter is testable, reusable, and eliminates duplication.
**Guardrail:** When implementing CORS + CSRF on the same API, origin validation MUST use a shared function. Plan must verify both middleware import the same function: `grep -c 'getAllowedOrigins' api/src/index.ts api/src/middleware/csrf.ts` — both files must return >= 1.
**Check:** `grep -rn 'getAllowedOrigins' api/src/` — must appear in exactly 3 files: definition (allowed-origins.ts) + CORS consumer (index.ts) + CSRF consumer (csrf.ts).

## 2026-04-09 — psychic-quiz-14step-flow

### L-135: Seed migration structural ACs don't catch missing data rows — need row-count ACs `[DB]` `universal`
> 2026-04-09 | occurs: 1 | via: psychic-quiz-14step-flow (MQAFIX-1)
**What happened:** Migration 0016 seeded a 14-step quiz with 22 questions but left all 18 scored/deep question answer options as commented-out templates. Structural ACs all passed: `INSERT OR IGNORE` pattern present, subquery references verified, question count correct. But the quiz dead-ended at step 5 because scored questions had ZERO selectable options. Only manualQA caught it — 1530 unit tests, all acceptance scripts, and verify phase all passed.
**Root cause:** ACs verified migration *structure* (INSERT patterns, subquery usage, idempotency keywords) but never verified *data completeness* (does every question have answer options?). Structural grep ACs can't distinguish "INSERT template exists but is commented out" from "INSERT actually inserts rows."
**Guardrail:** For seed migrations that populate parent-child relationships (questions→options, categories→items, forms→fields), plan must include a **row-count AC per relationship**: `grep -c "INSERT.*INTO quiz_answer_options" <migration>.sql` >= N (where N = expected child rows). Architect phase must add a relationship completeness check: for every parent entity seeded, verify child entity INSERT count >= minimum. Review DB+Security must verify: parent count × minimum children <= total child INSERTs.
**Check:** For seed migrations with FK relationships: `grep -c "INSERT.*INTO <child_table>" <migration>.sql` returns >= (parent_count × min_children_per_parent). E.g., 18 scored questions × 3 options minimum = 54+ option INSERTs.

### L-136: ManualQA is the authoritative data completeness gate for seed-heavy features `[TESTING]` `universal`
> 2026-04-09 | occurs: 1 | via: psychic-quiz-14step-flow (ManualQA recovery)
**What happened:** A quiz feature with 22 questions and 98 answer options passed all automated gates (unit tests, acceptance scripts, verify phase, code review) but failed manualQA because the migration left scored options as templates. The MQAFIX recovery cycle (manualQA FAIL → MQAFIX-1 story → re-review → re-verify → finish → manualQA PASS) worked correctly and caught what automation missed.
**Root cause:** Automated verification tests code structure and patterns. Data completeness for seed-heavy features (quizzes, forms, catalogs) requires actually exercising the feature end-to-end, which only manualQA does.
**Guardrail:** For missions that seed > 20 rows of interrelated data, manualQA.md MUST include a "data completeness walkthrough" scenario that exercises every seeded entity (not just happy path). Plan phase must flag seed-heavy missions with `data_completeness_risk: true` and ensure manualQA covers all branches/paths, not just the first one.
**Check:** manualQA.md for seed-heavy missions includes scenario covering ALL seeded entity types with expected counts. manualQA-report.md shows each entity type was exercised.

## 2026-04-09 — campgen-security-rate-limit-body-size

### L-137: Durable Object fetch handlers must validate request body shape, not trust `as` type casts `[SECURITY]` `universal`
> 2026-04-09 | occurs: 1 | via: campgen-security-rate-limit-body-size (BLOCKER-CQ-1)
**What happened:** `ApiRateLimiterDO.fetch()` used `as { is_mutation: boolean }` cast on `request.json()` without runtime validation. When `is_mutation` is `undefined` (missing from payload), the expression `is_mutation ? 1 : 0` silently treats all requests as non-mutations. Although the DO is only called internally by rate-limit middleware, its `fetch()` is a public DurableObject interface — any future caller sending malformed data bypasses mutation counting.
**Root cause:** TypeScript `as` casts provide zero runtime safety. Internal-only calling convention was treated as a guarantee, but DO fetch is a public interface that any Worker binding can call.
**Guardrail:** Every DO `fetch()` handler that parses JSON must validate the shape of the parsed body at runtime (typeof checks, Zod schema, or explicit field validation) before using values. Review DB+Security must check: `request.json()` followed by `as` cast without validation = BLOCKER. Pattern: parse → validate → use, never parse → cast → use.
**Check:** `grep -A5 'request.json()' <do-file>.ts` — every occurrence has a typeof/Zod validation within 5 lines. Zero `as {` casts without adjacent validation.

### L-138: All error responses and catch-block logs must include requestId for cross-request correlation `[API]` `universal`
> 2026-04-09 | occurs: 1 | via: campgen-security-rate-limit-body-size (WARN-CQ-1, WARN-CQ-3)
**What happened:** Two separate error paths lacked requestId: (1) rate-limit middleware's catch block logged `console.warn` without requestId, making DO errors uncorrelatable with specific requests; (2) bodyLimit's `onError` callback returned `{ error: { code, message } }` without requestId, breaking the consistent error response shape used by all other error handlers in the codebase. Both were new middleware additions that didn't inherit the existing error contract.
**Root cause:** No explicit "error response contract" is enforced — each new middleware/handler re-implements error responses ad hoc. The pattern exists in error-handler.ts but isn't referenced by plan or review as a mandatory contract.
**Guardrail:** Plan phase ACs for any new middleware or error handler must include: (1) `grep 'requestId' <new-file>.ts` returns >= 1 for every catch/error path, (2) error JSON shape matches `ErrorResponse` type from types.ts. Review Code Quality must check: every `catch` block and `onError` callback includes requestId in both logs and response bodies.
**Check:** For new middleware files: `grep -c 'requestId' <middleware>.ts` >= (number of catch/onError blocks). `grep -c 'console.warn\|console.error' <middleware>.ts` — every match includes requestId on the same line.

## 2026-04-09 — psychic-quiz-content-copy

### L-139: Content-only SQL migrations can expose pre-existing CSS presentation bugs — review can't catch visual issues in SQL diffs `[UI]` `universal`
> 2026-04-09 | occurs: 1 | via: psychic-quiz-content-copy (MQAFIX-1)
**What happened:** A SQL-only content migration (0017_content_copy.sql) updated 22 questions, 98 answer options, 4 interstitials, and 3 result templates. Review passed clean (0 findings, 0 warnings) because the SQL was correct, idempotent, and content-compliant. But manualQA revealed that quiz question headings (`h2`) and answer options (`.answer-card`) were left-aligned instead of centered — a pre-existing CSS issue in styles.ts that became visually obvious only when real copy replaced placeholder text. Required a recovery cycle (MQAFIX-1 → fix → deploy → re-verify).
**Root cause:** Review phase scoped to the diff — SQL migration had no CSS changes, so review correctly found nothing. But content changes alter the *visual weight* of text, making pre-existing alignment/layout issues newly visible. No mechanism in the pipeline triggers visual QA for SQL-only content changes.
**Guardrail:** For content migrations that update user-visible text (questions, labels, headings, CTAs), plan phase must include a **visual presentation story** with VISUAL ACs at 375px + 1280px, even if zero CSS files are in the diff. The manualQA.md must include a "visual consistency" scenario that checks alignment, overflow, and truncation at both viewports. Review should flag content migrations without visual ACs as a WARNING.
**Check:** For content migration plans: manualQA.md includes a visual consistency scenario with viewport-specific assertions. prd.json has at least one VISUAL AC for content-affecting stories.

## 2026-04-09 — campgen-security-token-secrets-management

### L-140: SQL read-only proxies must validate full statement body, not just prefix — CTE WITH clauses can wrap DML `[SECURITY]` `universal`
> 2026-04-09 | occurs: 1 | via: campgen-security-token-secrets-management (B1)
**What happened:** A ReadOnlyD1 proxy validated SQL statements with `/^(SELECT|WITH)\s/i`, intending to allow only reads. However, `WITH x AS (SELECT 1) INSERT INTO t VALUES (1)` passes this check because it starts with `WITH`. SQL Common Table Expressions (CTEs) can legally prefix any DML operation (INSERT, UPDATE, DELETE). The proxy's entire purpose — defense-in-depth read-only enforcement — was defeated by a single CTE-prefixed write.
**Root cause:** SQL classification was based on the first keyword only. CTE syntax means the first keyword (`WITH`) does not determine the statement's mutability. The regex matched the prefix without scanning the rest of the statement for write keywords.
**Guardrail:** SQL read-only validation must: (1) strip comments, (2) check the entire statement (not just prefix) for write keywords (`INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE|TRUNCATE|ATTACH|PRAGMA`), (3) block any statement containing write keywords regardless of prefix. Architect phase must specify this full-body scan pattern for any SQL proxy/filter story.
**Check:** `grep -E 'INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE|TRUNCATE' <read-only-proxy>.ts` — the file must contain a write-keyword blocklist check, not just a SELECT/WITH prefix check.

### L-141: D1 exec() accepts multiple semicolon-separated statements — prepare() is single-statement only `[SECURITY]` `d1`
> 2026-04-09 | occurs: 1 | via: campgen-security-token-secrets-management (B2)
**What happened:** A ReadOnlyD1 proxy validated statements via `isReadOnly()` (prefix check), then passed them to D1's `exec()`. The statement `SELECT 1; DROP TABLE users` passes the read-only check (starts with SELECT) but `exec()` processes all semicolon-separated statements, executing the DROP. The `prepare()` path is safe because D1's prepare() accepts only a single statement.
**Root cause:** D1's `exec()` and `prepare()` have different statement boundary semantics that aren't documented prominently. `exec()` is designed for migrations (multi-statement), while `prepare()` is designed for queries (single-statement). A read-only proxy that allows `exec()` must either block it entirely or reject semicolons.
**Guardrail:** For D1 read-only proxies: (1) block `exec()` entirely (read-only callers should use `prepare().all()`), OR (2) reject any SQL containing semicolons after comment stripping. Plan/architect phase must document which D1 methods are blocked vs proxied and why.
**Check:** `grep -c 'exec.*throw\|exec.*Error\|exec.*block' <read-only-proxy>.ts` >= 1 — exec must be blocked or guarded.

### L-142: Error handler secret redaction must cover HTTP response body, not just console logs `[SECURITY]` `universal`
> 2026-04-09 | occurs: 1 | via: campgen-security-token-secrets-management (B3)
**What happened:** The global error handler applied `redactSecrets()` to `console.error` output but returned raw `err.message` in the HTTP response body for non-500 errors. If an upstream handler threw a 400/401/403/404 error containing a token in the message string, the token leaked to the HTTP client while only the server log was sanitized.
**Root cause:** Redaction was treated as a logging concern, not a response concern. The error handler had two output paths (console + HTTP response) but only the console path was protected. The asymmetry was invisible because non-500 errors are less common in testing.
**Guardrail:** Any error handler that applies secret redaction MUST apply it to ALL output paths: console logs, HTTP response bodies, structured error objects, and webhook/alert payloads. Review DB+Security must verify: for every `redactSecrets()` call on a log line, the corresponding HTTP response uses the same redacted value.
**Check:** In error handler middleware: `grep -c 'redactSecrets' <error-handler>.ts` — count must be >= 2 (one for logs, one for response body). If only 1 match, the response body path is unprotected.

### L-143: Array.find() on ascending-ordered thresholds returns the least-severe match first `[API]` `universal`
> 2026-04-09 | occurs: 1 | via: campgen-security-token-secrets-management (B4)
**What happened:** `WARNING_THRESHOLDS` was ordered `[{days:30, severity:'warning'}, {days:14, severity:'warning'}, {days:7, severity:'critical'}]`. The code used `.find(t => daysUntilExpiry < t.days)`. For a token expiring in 3 days: `3 < 30 = true` → returned `'warning'` instead of `'critical'`. The 7-day critical threshold was unreachable because the 30-day check always matched first.
**Root cause:** `Array.find()` returns the FIRST match. When thresholds are ascending, the broadest (least severe) threshold catches everything. The developer likely tested with values > 30 (no match) and < 30 (match), not realizing the severity was wrong for extreme values.
**Guardrail:** Threshold arrays used with `.find()` must be ordered most-specific-first (descending for "less than" checks, ascending for "greater than" checks). Review Code Quality must flag any `.find()` on an ordered array where the match condition could be satisfied by multiple entries — verify the array order matches the intended priority.
**Check:** For threshold/rule arrays with `.find()`: verify the first array element represents the most restrictive/specific match, not the broadest.

## 2026-04-13 — campgen-security-input-validation-hardening

### L-144: Ship must verify production deploy before session close — no deferred deploys `[DEPLOY]` `universal`
> 2026-04-13 | occurs: 1 | via: campgen-security-input-validation-hardening (ship)
**What happened:** Ship phase completed merge, manualQA (local), and learnings — but was about to close with "deploy pending" as a user action item. User corrected: deploy verification is ship's responsibility, not something to defer.
**Guardrail:** a2z-ship Phase H (Finalize) MUST NOT complete until production deploy is verified via curl/HTTP against production URL. If agent cannot run `wrangler deploy` (hard safety rule), wait for user to deploy, then verify. "Deploy pending" is NOT an acceptable session close state.
**Check:** `curl -s -o /dev/null -w '%{http_code}' <deployUrl>/health` returns 200 AND behavioral assertion per D4 (verify SPECIFIC change, not just HTTP 200).

## 2026-04-13 — dashboard-ch-data-issue-2026-04-13

### L-139: DO stuck-timeout re-dispatch overwrites storage sync_mode causing CH revenue double-ingestion `[DB]` `kodigital`
> 2026-04-13 | occurs: 1 | via: dashboard-ch-data-issue-2026-04-13 (ship)
**What happened:** PR #150 added mirrorCreatives + uploadR2Assets to DOs (40-60s processing). This exceeded SyncDispatcher's 8-min stuck timeout, triggering re-dispatch without explicit `type` field. The /sync handler's else-branch unconditionally wrote `sync_mode='full'`, causing DOs to run revenue ingestion alongside the centralized cron — 3x-4x CH inflation on Apr 11.
**Root cause:** The /sync fetch handler had an unconditional `else { storage.put('sync_mode', 'full') }` that treated any untyped request as a full sync. Stuck-timeout re-dispatches arrive without type, so every timeout recovery overwrote the mode.
**Guardrail:** When adding processing time to DOs, verify SyncDispatcher stuck-timeout threshold vs new worst-case processing time. Any /sync handler must only write sync_mode when `body.type` is explicitly provided — never on an else branch. Review must check: does any storage write path trigger on absence of input?
**Check:** `grep -n "sync_mode.*=.*'full'" api/src/do/fb-account-sync.ts` — must return 0 (no unconditional overwrite to 'full')

## 2026-04-13 — psychic-quiz-social-proof

### L-145: Seed data with literal parent FK orphans when activation flag migrates to a new row `[DB]` `universal`
> 2026-04-13 | occurs: 1 | via: psychic-quiz-social-proof (MQAFIX-1 recovery)
**What happened:** Migration 0014 seeded 4 testimonial rows with hardcoded `quiz_id=1` (the active quiz at that time). Migration 0016 later deactivated v1 (is_active=0) and created v2 with a different id. Testimonials stayed bound to orphaned quiz_id=1. The client query `SELECT ... WHERE quiz_id = <current active id>` returned empty. Every automated gate passed (unit tests 1530/1530, acceptance scripts, review approved, verify PASS) because D1 still held the rows — only browser manualQA exposed `window.__QUIZ_DATA__.testimonials=[]`. MQAFIX-1 added migration 0018 copying testimonials from quiz_id=1 to the active quiz_id via scalar subquery `(SELECT id FROM quiz_definitions WHERE slug='psychic-quiz' AND is_active=1)`, idempotent via `NOT EXISTS` on (quiz_id, author_name, display_order).
**Root cause:** Seed migration captured parent FK by literal integer, not by the semantic "active parent" relationship. When activation lifecycle diverges from seed lifecycle — new active row is introduced but dependent seed data is not re-linked — the data silently orphans. Structural migrations reading `is_active` select the new row; seed rows stay with the old parent.
**Rule:** For any seed migration INSERTing child rows under a parent whose identity can migrate (tables with `is_active`, `current`, `primary`, or `slug` version keys): plan phase MUST either (a) bind FK via scalar subquery at INSERT time (e.g., `(SELECT id FROM <parent> WHERE slug='<x>' AND is_active=1)`), OR (b) mark story `activation_coupled: true` so any subsequent migration that mutates `is_active` on that parent is required to include a companion migration re-pointing dependent seed rows. Review DB+Security must flag seed INSERTs with literal parent-FK where the parent table has an `is_active` column as a WARNING during architect review.
**Check:** `grep -nE "INSERT INTO (quiz_[a-z_]+|[a-z_]+_testimonials|[a-z_]+_options).*VALUES.*\\(\\s*[0-9]+\\s*," api/quiz-migrations/*.sql` — every literal integer parent-FK in a child seed INSERT must either be rewritten as a subquery or have a documented activation-coupled follow-up migration.

## 2026-04-13 — insureprimo-low-performance-investigation

### L-146: Cloudflare CDN purge-then-cache race serves stale Worker code post-deploy `[OPS]` `universal`
> 2026-04-13 | occurs: 1 | via: insureprimo-low-performance-investigation (MQAFIX-4 ship)
**What happened:** PR #185 merged at SHA 664a9f42; CI ran `wrangler deploy` then `purge_cache {purge_everything:true}` for both zones (success per CI log at 12:32:27Z). 18 seconds later (12:32:45Z) the next request hit a cold CDN, fetched from Worker, and re-cached. That re-cached HTML did NOT contain `persistCurrentStep` (count=0) and had `sessionStorage.setItem.*insureprimo_funnel` count=1 (pre-MQAFIX-4 code). Cache then served stale HTML with `cf-cache-status: HIT, age` increasing for hours, blocked by `s-maxage=86400, stale-while-revalidate=86400`. The race: Worker edge propagation hadn't completed at all CF edges when the post-purge re-fetch happened. ManualQA was blocked until user manually re-purged via Cloudflare dashboard — agent denied autonomous `gh workflow run deploy.yml` (correctly per RED LINE).
**Root cause:** `wrangler deploy` returns success when the Worker is uploaded, BEFORE all edge nodes have finalized propagation. Auto-purge runs immediately after deploy returns, then the FIRST request to that URL after purge re-caches whatever the (possibly-not-yet-propagated) edge serves. With long s-maxage, that incorrect re-cache persists for the TTL.
**Rule:** a2z-ship finish phase MUST verify behavioral content (grep for a NEW code marker introduced by this change) — not just HTTP 200 — at minimum 60 seconds after CI deploy completion. If the marker is missing, do NOT auto-trigger another deploy/purge — present user with options (dashboard purge, manual re-deploy, wait for TTL) via AskUserQuestion. Behavioral assertion is mandatory; HTTP-200 + `cf-cache-status: HIT age 0` does NOT prove correct code is served.
**Check:** `MARKER="persistCurrentStep"; sleep 60; for i in 1 2 3; do COUNT=$(curl -s "$URL?_cb=verify-$(date +%s%N)" | grep -c "$MARKER"); echo "attempt $i: count=$COUNT"; [ "$COUNT" -ge 1 ] && exit 0; sleep 30; done; echo "BEHAVIORAL ASSERTION FAILED — request user purge"; exit 1`

### L-148: Schema refactor moving a column between tables must port existing values, not default to NULL `[DB]` `universal`
> 2026-04-13 | occurs: 1 | via: psychic-quiz-social-proof (MQAFIX-2 — PQ-CTA-1 P0 blocker)
**What happened:** Quiz v1 stored redirect URL in `quiz_definitions.redirect_url` (populated by migration 0006 with `https://bargestech.go2cloud.org/aff_c?...&aff_unique1={{session_id}}`). Quiz v2's architecture moved the URL to a per-archetype column `quiz_result_templates.cta_url_template`. Migration 0017 (v2 seed) inserted all 3 v2 archetype rows with `cta_url_template=NULL` — because the author copied the INSERT structure from v1 without recognizing that this column needed the v1 value carried over. Client `/complete` endpoint (api.ts:246-277) built `redirect_url` only when `template.cta_url_template` was truthy, else returned empty string. Client CTA handler did `if (redirect_url) window.location.href = redirect_url;` — empty string is falsy, no navigation. Result: zero affiliate redirects in production across all v2 archetypes; every quiz completion returned redirect_url=''. The CTA button was visible, styled, clicked fbq("track","Lead"), but navigated nowhere. MQAFIX-2 added migration 0019 copying v1's `redirect_url` via scalar subquery: `UPDATE quiz_result_templates SET cta_url_template = (SELECT redirect_url FROM quiz_definitions WHERE slug='psychic-quiz-v1' AND version=1 AND redirect_url IS NOT NULL) WHERE quiz_id=(SELECT id FROM quiz_definitions WHERE slug='psychic-quiz' AND is_active=1) AND cta_url_template IS NULL AND (...) IS NOT NULL;`.
**Root cause:** When a schema refactor moves a semantic column from one table to another (parent→child or child→parent), the creating migration is responsible for porting the existing value. Default-to-NULL treats the refactor as "new column" rather than "moved column." Every automated gate passed because NULL is a valid value from the DB's perspective; only the business logic (and revenue) broke. This is distinct from L-145 (orphaned FK on activation migration) — L-145 is about row-level FK mis-binding, L-148 is about column-level value loss during schema restructure.
**Rule:** a2z-architect plan phase MUST flag any schema refactor that relocates a semantic column (same meaning, different table) and require: (a) the creating seed migration to include a port clause via scalar subquery from the old location, OR (b) a follow-up data migration in the same PR that backfills before CTA/revenue/user-facing paths are activated. Review DB+Security must check: for every `CREATE TABLE ... <column>` or `ALTER TABLE ADD COLUMN <column>` where the column name matches a column in any prior table, the review MUST ask "where does this value come from for existing entities?" and block if answer is "NULL."
**Check:** `python3 -c "import re,sys,glob,pathlib; files=sorted(glob.glob('api/quiz-migrations/*.sql')+glob.glob('api/migrations/*.sql')); cols={}; [cols.setdefault(c,[]).append(f) for f in files for c in re.findall(r'(?i)(?:^|,|\s)([a-z_]*(?:url|redirect|tracking|cta|webhook)[a-z_]*)\b', pathlib.Path(f).read_text()) if len(c)>3]; dupes={k:v for k,v in cols.items() if len(set(v))>1}; [print(f'WARNING: column {k} appears in multiple migrations — verify value is ported: {v}') for k,v in dupes.items()]; sys.exit(1 if dupes else 0)"`

### L-149: Revenue-critical endpoint post-deploy verification must assert non-empty business fields, not just HTTP 200 `[DEPLOY]` `universal`
> 2026-04-13 | occurs: 1 | via: psychic-quiz-social-proof (MQAFIX-2 — PQ-CTA-1 P0 blocker)
**What happened:** The base psychic-quiz-social-proof ship cycle (PR #178 → #183) passed all deploy gates: HTTP 200 at production URL, cache-control headers correct, migrations applied per CI log. ManualQA MQA-6 (CTA click) also passed on first read — agent observed `urlChanged=false` in Playwright and rationalized it as "headless browser blocks cross-origin navigation." The real cause (`cta_url_template=NULL` → `redirect_url=''` → navigation no-op) was only discovered when user challenged the assumption ("why??"), forcing a curl to `POST /complete` that returned `redirect_url: ""`. Between deploy and user challenge, production had ZERO affiliate redirects firing — revenue impact during that window. MQAFIX-2 migration 0019 fixed the data; MQAFIX-2 AC8 added the missing curl: `curl -X POST .../complete -d '{"session_id":"..."}'` → assert `redirect_url` contains `bargestech.go2cloud.org`.
**Root cause:** L-008 and L-144 require "post-deploy behavioral assertion" but are generic — "specific behavioral change from the mission." For revenue-critical endpoints (CTA/redirect/webhook/affiliate/payment), generic guidance is too weak. The ship agent can satisfy L-008 by checking ANY page element while the actual revenue path (JSON response body with redirect URL) goes unchecked. Furthermore, E4 only requires HTTP request visibility for pixel/analytics tracking — it did not cover server-returned redirect URLs. The check-by-exclusion failure mode: all generic gates passed because none specifically required asserting the endpoint response CONTAINS the expected URL.
**Rule:** For missions where prd.json `mainGoal` or `production_safety_rules` reference any revenue-critical endpoint (CTA/redirect/webhook/affiliate/payment/tracking), a2z-ship finish phase MUST include a curl POST/GET to that endpoint and assert the response JSON contains expected non-empty business fields matching the expected domain/pattern. "HTTP 200" + "migration applied log line" is INSUFFICIENT for revenue-critical paths. This is a hardening of L-008 and L-144 specifically scoped to business-critical response data. architect must add such curl to acceptance-tests/ as the post-deploy AC when revenue-critical endpoints are in scope; verify/ship must NOT mark mission PASS until this curl returns the expected business field.
**Check:** `URL="https://<production>/<revenue-endpoint>"; EXPECTED_DOMAIN="bargestech.go2cloud.org"; EXPECTED_FIELD="redirect_url"; RESP=$(curl -s -X POST -H "content-type: application/json" -d '{"session_id":"<real-session>"}' "$URL"); VAL=$(echo "$RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('$EXPECTED_FIELD',''))"); if [ -z "$VAL" ] || ! echo "$VAL" | grep -q "$EXPECTED_DOMAIN"; then echo "REVENUE_ENDPOINT_DEAD — $EXPECTED_FIELD empty or missing $EXPECTED_DOMAIN — actual: $VAL"; exit 1; fi; echo "revenue path verified: $VAL"

## 2026-04-13 — campgen-security-r2-audit-supplychain

### L-150: Broader rate limiter masks per-endpoint rate limit threshold in functional test `[TESTING]` `universal`
> 2026-04-13 | occurs: 1 | via: campgen-security-r2-audit-supplychain (ship manualQA MQA-2)
**What happened:** T1 added `presignRateLimit` middleware (UPLOAD_URL_RATE_LIMIT_PER_MINUTE=30, keyed by user.sub) on POST /upload-url, specifically to throttle presigned-URL issuance independent of the global mutation budget. MQA-2 functional test issued 31 rapid POSTs expecting first 30 → 200 and 31st → 429. Observed first 10 → 200, requests 11..31 → 429 — but the 429 body was `{"error":{"code":"RATE_LIMIT_EXCEEDED","message":"Too many requests"}}` from the GLOBAL `rateLimitMiddleware` (MUTATIONS_PER_MINUTE=10), not from `presignRateLimit` whose 429 body reads `"Too Many Requests: upload-url presign limit exceeded"`. The presign-specific 30/min threshold was never exercised. Grep ACs (code existence) all passed; functional AC was correctly marked NEEDS_RUNTIME in prd.json. Overall verdict downgraded from PASS to INCONCLUSIVE per F5 (validator MG1).
**Root cause:** When two rate limiters sit in series — a broader one (global mutations, lower limit, more request types) upstream of a narrower one (per-endpoint, higher limit, single route) — a simple repeat-request test always trips the broader limit first. The narrower limit is invisible unless the test varies the keying dimension of the broader limit (e.g., different X-Business-Id per request to reset global counter while keeping the same user.sub for presign) OR the DO is exercised directly via a unit test. Generic "issue N requests, expect 429 on N+1" test plans assume a single rate limiter.
**Rule:** a2z-plan + a2z-architect: whenever a mission adds a per-endpoint rate limiter, the plan MUST enumerate every upstream rate limiter on the same route and design a functional AC that isolates the new limit (either vary the broader limit's keying dimension in the test script or add a DO unit test that binds by the narrower key alone). Review DB+Security verifies the functional AC genuinely exercises the new threshold. manualQA-report.md MUST inspect the 429 response body and assert which limiter fired; a 429 from a different limiter means the new threshold is NOT verified — mark NEEDS_RUNTIME, not PASS.
**Check:** `python3 -c "import sys,re,pathlib; f=pathlib.Path('api/src/middleware/rate-limit.ts').read_text(); msgs=re.findall(r'\"message\"\s*:\s*\"([^\"]+)\"',f); print('LIMITERS:',msgs); sys.exit(0 if len(set(msgs))==len([m for m in msgs if 'limit' in m.lower() or 'too many' in m.lower()]) else 1)"` — every rate limiter on a single route must have a distinct `message` so manualQA can assert which limiter fired.

### L-151: Secret-gated runtime manualQA uses CI deploy-step exit code as transitive evidence `[TESTING]` `universal`
> 2026-04-13 | occurs: 1 | via: campgen-security-r2-audit-supplychain (ship manualQA MQA-4)
**What happened:** T3 added a post-deploy R2 HEAD-check step to `.github/workflows/deploy.yml` that curls `${{ secrets.R2_PUBLIC_URL }}/` and exits 1 on HTTP 200 (directory listing leak). manualQA MQA-4 step 1 (curl -I R2_PUBLIC_URL/) could not execute locally because R2_PUBLIC_URL is a GitHub Actions secret not exposed to the dev environment. Without a documented fallback, the step would have been marked NEEDS_RUNTIME and deferred forever (psychic-quiz S2/S4/S8 pattern). The manualQA report instead cited GitHub Actions deploy run 24351993793 SUCCESS as transitive evidence — the deploy step ran to completion, which transitively proves the HEAD check either (a) succeeded (HTTP != 200) or (b) is a guardrail that would have exited non-zero and failed the deploy. Combined with grep-verified step presence and explicit `exit 1` on HTTP 200, this is sufficient evidence.
**Root cause:** Many security/infra ACs require secrets that are Dashboard-only (GitHub Actions secrets, CF Dashboard values, bucket-level config). Dev environments can't see them. Without a documented fallback, manualQA either (a) defers forever as NEEDS_RUNTIME, (b) asks the user to paste the secret locally (risky + blocks flow), or (c) skips the AC silently. The CI deploy step's own exit code already encodes the assertion result — it IS the runtime proof.
**Rule:** a2z-plan + a2z-architect: for any AC that requires a secret not in dev env, the AC MUST include "OR CI deploy step <step-name> exit 0 on run <deploy_run_id>" as an equivalence clause. a2z-ship finish phase records the deploy_run_id in phase-status.json finish.authoritative_deploy_run (already standard). a2z-ship manualQA subagent consumes this: for any secret-gated NEEDS_RUNTIME step, read the deploy run conclusion — `success` → PASS-transitive; `failure` → FAIL with link to the failed step's log; `in_progress` → INCONCLUSIVE with retry-after instruction. Document "transitive_evidence" explicitly in manualQA-report.md so it is not mistaken for skipped verification.
**Check:** `CID="<change-id>"; DEPLOY_RUN=$(jq -r '.finish.authoritative_deploy_run // empty' .a2z/mission-state/$CID/phase-status.json); if [ -z "$DEPLOY_RUN" ]; then echo "NO_DEPLOY_RUN_RECORDED — transitive evidence unavailable"; exit 1; fi; RUN_ID=$(echo "$DEPLOY_RUN" | grep -oE '[0-9]+' | tail -1); CONCL=$(gh run view "$RUN_ID" --json conclusion -q .conclusion); [ "$CONCL" = "success" ] || { echo "DEPLOY_RUN_NOT_SUCCESS: $CONCL — secret-gated AC cannot be transitively verified"; exit 1; }; echo "transitive_evidence: deploy run $RUN_ID success"`

### L-152: Cloudflare Worker smoke-script URL trailing slash causes post-deploy 404 where canonical no-slash route returns 200 `[TESTING]` `universal`
> 2026-04-13 | occurs: 1 | via: psychic-quiz-interstitials (ship Phase B finish-subagent)
**What happened:** `scripts/verify/psychic-quiz-interstitials-smoke.sh` line 51 fetched `${SMOKE_URL}/quotes/psychic-quiz/?_cb=$(date +%s)` (trailing slash before query string). Against `https://www.theiwise.com` the worker route is `/quotes/psychic-quiz` (no trailing slash); the trailing-slash form 404s. The smoke script therefore exited 1 with `FAIL: GET /quotes/psychic-quiz/ → HTTP 404` even though the mainGoal (0 Placeholder interstitial titles in production) was fully met. The real behavioral assertion had to be re-run manually with `curl -sS "$SMOKE_URL/quotes/psychic-quiz?_cb=..."` which returned HTTP 200 + the correct `__QUIZ_DATA__` bundle with 4 real interstitials.
**Root cause:** Smoke scripts are authored against local `wrangler dev` which often normalizes trailing slashes differently than production Cloudflare Worker routes. A script that works in dev (`http://127.0.0.1:8787/path/`) silently breaks in production (`https://prod/path`). The script's existence passes grep ACs; the behavioral assertion passes mainGoal locally; only the production smoke run reveals the mismatch, and by then the PR is merged.
**Rule:** a2z-plan + a2z-architect: every smoke script under `scripts/verify/` MUST be explicitly tested against both `SMOKE_URL=http://127.0.0.1:8787` AND `SMOKE_URL=https://<prod>` during /a2z-develop verify phase (or at minimum grep-verified to match the canonical production route shape). For Cloudflare Worker routes, default to the no-trailing-slash form unless the Worker explicitly handles both. Architect hardened acceptance tests MUST include a behavioral probe of the production URL shape during /a2z-develop verify. Ship finish-subagent Step 6 functional smoke MUST NOT mask smoke-script FAIL as “trailing-slash bug” — file a WARN-FIX story before ship completes.
**Check:** `grep -nE '\$\{?SMOKE_URL\}?/[^?[:space:]]+/(\?|[[:space:]]|$)' scripts/verify/*.sh | tee /dev/stderr | awk 'END{exit NR>0}'` — any match = trailing slash before query string / whitespace / EOL in a smoke-script URL = FAIL (potential 404 in production). Remediation: remove the slash before the `?`.

## 2026-04-14 — insureprimo-new-aggregatoe-mediaalpha-2026-04-13

### L-152: Validate adapter normalize mapping against actual API response, not assumed field names

> 2026-04-14 | occurs: 1 | via: insureprimo-new-aggregatoe-mediaalpha-2026-04-13 (ship manualQA)
**What happened:** MediaAlpha adapter used `carrier_name`, `display_name`, `image` as response field names in the `MediaAlphaAd` interface and `normalizeMediaalpha()`. The actual MA API returns `carrier`, `display_url`, `large_image_url/medium_image_url/small_image_url`. Result: logos missing, headlines shown as brand names, HTML entities unescaped in card titles.
**Root cause:** Interface was written from documentation assumptions during plan/architect phase. Unit tests used the same assumed field names, so all 85 tests passed. Neither code review nor verify caught the mismatch because they test the code's internal consistency, not the external API contract. Only wrangler tail with a DIAG log on the actual production response revealed the real field names.
**Rule:** For every new aggregator adapter, add a temporary diagnostic log (`console.log('[Adapter] DIAG first_ad_keys:', JSON.stringify(Object.keys(ads[0])))`) during the first deploy. Capture the actual field names via wrangler tail BEFORE marking manualQA as PASS. Remove the diagnostic log after field names are validated. Never trust assumed/documented field names — always verify against live response.
**Check:** `grep -c 'DIAG first_ad_keys' api/src/insureprimo/adapters/*.ts` — if a new adapter was just shipped and this grep returns 0, the field mapping was never validated against the real API.

### L-153: Wrangler tail is mandatory for new aggregator QA — not optional observability

> 2026-04-14 | occurs: 1 | via: insureprimo-new-aggregatoe-mediaalpha-2026-04-13 (ship manualQA)
**What happened:** Agent skipped wrangler tail during staging and production QA despite user's explicit instruction to "start from enabling the wrangler trail." The field mapping bug (L-152) was invisible from browser screenshots alone — cards rendered but with wrong content. Only after user forced the agent to run wrangler tail did the diagnostic log reveal the actual API field names.
**Root cause:** Agent treated wrangler tail as optional observability rather than a mandatory QA step. Prioritized "fast" funnel walk over the user's specified test sequence.
**Rule:** For any mission involving external API integrations (aggregators, payment, analytics), wrangler tail MUST be started BEFORE the first /listings or API-touching request. Tail output must be captured and included in manualQA-report.md as evidence. The tail payload (outbound) + response (inbound) are pass conditions, not nice-to-haves.
**Check:** `grep -c 'wrangler tail' openspec/changes/*/manualQA-report.md` — for API-integration missions, wrangler tail evidence must be present.

### L-154: MediaAlpha image URLs are protocol-relative — prefix https: for img src

> 2026-04-14 | occurs: 1 | via: insureprimo-new-aggregatoe-mediaalpha-2026-04-13 (ship manualQA MQAFIX)
**What happened:** MA API returns `large_image_url` as `//d29u10q7qlh006.cloudfront.net/i/i/2328/...` (protocol-relative, no `https:`). If passed directly to `<img src>`, the browser resolves it relative to the page protocol — works on HTTPS pages but breaks in any non-HTTPS context (local dev, email, RSS).
**Root cause:** Protocol-relative URLs were common practice circa 2012-2015 for HTTP/HTTPS compatibility. MediaAlpha still uses them. The normalize function must prepend `https:` when the URL starts with `//`.
**Rule:** When normalizing URLs from external APIs, check for protocol-relative format (`//domain/path`) and prepend `https:`. Apply to all URL fields: `logo`, `logo_url`, `click_url`, `impression_url`.
**Check:** `grep -cE "startsWith\('//')" api/src/insureprimo/adapters/mediaalpha.ts` — should be >= 1 (the protocol-relative URL fix).

## 2026-05-05 — amani-to-wordpress-importer-2026-04-28 (cycle 3 ship — MQAFIX-2)

### L-157: HTTP 401 from external API cannot be classified "token side" without independent verified test `[INVESTIGATION]` `universal`

> 2026-05-05 | occurs: 1 | via: amani-to-wordpress-importer-2026-04-28 (cycle 3 ship — user red-team correction)
**What happened:** Cycle 3 MQA-3 returned `AMANI_HTTP_401` from `cms.amani.media`. I observed: (a) Worker logs showed 401, (b) direct `curl -i 'https://cms.amani.media/api/articles/<id>'` (no auth header) also returned 401. Based on these two observations alone, my next AskUserQuestion framed the situation as "the new token is being rejected by cms.amani.media" with options labeled "Provide credentials (Recommended)" implying the token itself was at fault. User correctly called this out: an unauthenticated 401 only proves the endpoint enforces auth — it does NOT prove the Worker's rotated token is wrong, mis-formatted, or wrong-scoped. The actual cause turned out to be that the user's *first* rotation hadn't propagated to the Worker secret yet; after a clean second rotation + `wrangler secret put`, the same Worker code at the same sha produced PASS for 4/4 names. My framing pre-emptively blamed the user's credential while the alternative (Worker secret hadn't picked up the rotation, env binding stale, propagation delay) was equally consistent with the observations.
**Root cause:** A single failing HTTP status code from an upstream service is consistent with many causes: (1) wrong token, (2) wrong header format, (3) wrong scope/permissions, (4) clock-skew on signed tokens, (5) Worker secret not propagated, (6) Worker reading wrong env binding, (7) upstream temporary outage, (8) IP/geofencing. Each requires DIFFERENT remediation. Classifying "token side" without an independent test (user-side curl with the rotated token / wrangler tail decoding the actual header value the Worker sent / fetching from a different network) is an assumption that hides 7 of the 8 causes.
**Rule:** a2z-ship orchestrator + manualqa-executor MUST NOT classify an upstream HTTP 401/403 as "token side" / "invalid token" / "wrong scope" / "credential issue" in user-facing prose unless backed by either (a) an independent test by user with the rotated token using the SAME url+method+headers (provided verbatim by orchestrator) returning a different status code, OR (b) wrangler tail header-decode showing the Authorization header value the Worker actually sent compared to what the upstream expects. Until such evidence exists, the only neutral classification is `UPSTREAM_AUTH_REJECTION_CAUSE_UNKNOWN`. Never default-blame the user-rotated credential.
**Check:** `python3 -c "import json,sys,glob; bad=[]; [bad.append(p) for p in glob.glob('.a2z/mission-state/*/manualQA-evidence.json') for s in json.load(open(p)).get('scenarios',[]) if any(t in (s.get('notes','')+s.get('actual_result','')+s.get('verdict','')).lower() for t in ['token side','invalid token','wrong scope','rotated token rejected','credential side']) and 'user_verified_local_probe' not in str(s) and 'wrangler_tail_header_decoded' not in str(s)]; print('VIOLATIONS:',bad); sys.exit(1 if bad else 0)" 2>&1` — any manualQA-evidence.json with token-side classification but no independent-verification marker = FAIL.

## 2026-05-05 — amani-to-wp-issues-2026-05-05 (cycle 1 ship — failed_deploy_blocked_reverted)

### L-158: Mission-branch CI passes but post-merge CI fails when origin/main has advanced `[DEPLOY]` `universal`

> 2026-05-05 | occurs: 1 | via: amani-to-wp-issues-2026-05-05 (cycle 1 ship — PR #8 reverted by PR #9)
**What happened:** PR #8 squash-merged cleanly into main as 4fce387. The post-merge deploy CI on main then failed `import.author.spec.ts:108` (T3 author wiring AC4: "every createPost body includes author=42 — reused across all 3 names" → expected length 3, got 0). Mission-branch CI had passed all 13 test files in isolation when /a2z-develop verified. The merge with origin/main brought in PR #7's MQAFIX-2 strict article-field validation in `unwrapAmaniEnvelope`. The mission's T3 author-wiring fixtures don't satisfy the new validation contract, so 0 articles reach createPost in the merged tree (test expected 3). Deploy was blocked. PR #8 was reverted via PR #9 (squash f26d187), restoring main to the pre-PR-#8 state. Production was never updated. Total cost: 1 PR merged-then-reverted, 2 deploy CI runs, ~10 min wall time, full ship session aborted before manualQA.
**Root cause:** Mission-branch tests pass against the mission tree at the moment /a2z-develop verifies. CI runs only AFTER the squash-merge to main. Between develop/verify (mission tree) and ship's post-merge CI, main can advance with changes that are silently incompatible with the mission's tests/fixtures (here: PR #7 added stricter validation; mission's T3 fixtures predated the change). ship's pre_merge_gate checks worktree dirt + handoff verdict + commit fidelity, NOT "would CI pass against the merged tree?". The `gh pr view --json mergeable` API marks a PR MERGEABLE based on whether the merge can be created cleanly without textual conflicts — it has no visibility into test outcomes against the merged tree. So a PR can be `mergeable=MERGEABLE` and still deploy-fail post-merge.
**Rule:** a2z-ship finish_pipeline MUST add a new sub-step BEFORE `push` (call it `pre_merge_integration_test`) that: (1) `git -C $WORKTREE fetch origin main`, (2) computes `merge-base HEAD origin/main`, (3) if main has advanced beyond the merge-base, `git -C $WORKTREE merge origin/main --no-commit --no-ff` (mirror the strategy ship will eventually use), (4) runs `cd $WORKTREE/<api-or-test-dir> && npm test` (or whatever the project's full test command is from package.json scripts), (5) `git -C $WORKTREE merge --abort` to restore the worktree, (6) emits a typed receipt with status PASS/FAIL/CONFLICT. PASS → continue to push. FAIL → STOP with a "merge-with-main regression" MQAFIX story; do NOT push, do NOT create PR. CONFLICT during dry-merge → present to user via existing AskUserQuestion path. The dry-merge MUST use `--no-commit --no-ff` (not `-X theirs` or `-X ours`) so test failures reflect a real merge attempt; conflict resolution is a separate gate. This is upstream of the existing post-merge ci_watch (which still runs as defense-in-depth).
**Check:** `BASE=$(git -C $WORKTREE merge-base HEAD origin/main); MAIN=$(git -C $WORKTREE rev-parse origin/main); if [ "$BASE" != "$MAIN" ]; then git -C $WORKTREE merge origin/main --no-commit --no-ff && (cd $WORKTREE/api && npm test) && RESULT=$? || RESULT=$?; git -C $WORKTREE merge --abort; [ "$RESULT" = "0" ] || { echo "MERGE_REGRESSION_DETECTED"; exit 1; }; fi`

### L-159: Mission-authored .github/workflows/*.yml fires on its own merge — out_of_scope on intake doesn't gate it `[DEPLOY]` `universal`

> 2026-05-08 | occurs: 1 | via: homepage-project-phase-0-2026-05-07 (ship phase — caught pre-merge)
**What happened:** Phase 0 scaffold mission `homepage-project-phase-0` authored `.github/workflows/deploy.yml` (T8) with `on: push: branches: [main]` and a deploy-staging job conditional on `github.ref == 'refs/heads/main'` running `wrangler deploy --env staging`. mission_intake.json's `explicit_out_of_scope` listed "Production deployment to Cloudflare (deploy:staging / deploy:production are scaffold scripts only)". develop verified PASS (pure local: typecheck + tests + verify-script). When ship would have squash-merged the mission into main on origin, the act of merging the workflow YAML into main is itself the FIRST scheduling of that workflow — and the deploy-staging step would fire, against `CLOUDFLARE_API_TOKEN` if set on the repo, ignoring the intake's exclusion. Caught by manual review of the deploy.yml during ship Phase A; user opted for "PR open, do NOT merge" path so they could decide CLOUDFLARE_API_TOKEN policy explicitly.
**Root cause:** GitHub Actions schedules `on: push` workflows from the diff being pushed, not from the prior repo state. So a PR that introduces a new workflow file fires that workflow as soon as it's merged. mission_intake's `explicit_out_of_scope` is consumed by /a2z-develop (planning + plan-roast) but is NOT propagated into ship's pre-merge gates. ship reads prd.json, qa-report.md, develop_handoff.json — none of those carry the out-of-scope array. Pre-merge CI on the PR runs `pull_request:` triggers only, so the deploy step is invisible until merge.
**Rule:** ship Phase B finish_pipeline MUST scan the about-to-merge diff for newly-introduced (`A`) `.github/workflows/*.yml` files. For each, parse `on:` triggers + per-job `if:` conditions + step `run:` lines. If any job conditional on `push: branches: [main]` (or equivalent) executes a deploy command (regex: `wrangler\\s+deploy|npm\\s+run\\s+deploy:|gh\\s+release\\s+create`), AND mission_intake.json's `explicit_out_of_scope` array contains a substring match for "deploy" or "Cloudflare" or "production deployment", the merge step BLOCKS with reason `WORKFLOW_SELF_FIRES_ON_MERGE_VS_OUT_OF_SCOPE`. User must either (a) explicitly widen scope (signed-off change to mission_intake), or (b) leave the PR open until secrets policy is set. Pre-existing workflow files (`M` modifications without changing the `if:` deploy conditional) are unaffected.
**Check:** `git -C $WORKTREE diff --name-status main...mission/$CID -- '.github/workflows/*.yml' | awk '$1=="A"{print $2}' | xargs -I{} grep -l -E '(wrangler\\s+deploy|npm run deploy:|gh release create)' '{}'` returns non-empty AND `python3 -c "import json,sys; oos=' '.join(json.load(open('$MS/mission_intake.json')).get('explicit_out_of_scope',[])).lower(); sys.exit(0 if any(k in oos for k in ('deploy','cloudflare','production deployment')) else 1)"` exits 0 → BLOCK merge, surface user choice via AskUserQuestion.

## [PROCESS] Pipeline contract gaps

### L-160: develop_handoff.production_pending_rc_ids ignores mission_intake.explicit_out_of_scope `[PROCESS]` `universal`

> 2026-05-08 | occurs: 1 | via: homepage-project-phase-0-2026-05-07 (ship handoff produced 23 production_pending RCs for an intake-out-of-scope deploy)
**What happened:** finalize_develop emitted `develop_handoff.json` with 23 `production_pending_rc_ids` and `production_check_hints` like "deferred to ship-phase runtime/deploy verification" for behavioral ACs (RC-041, RC-042, RC-043, RC-044, RC-049, RC-050, RC-063, RC-064, RC-065, RC-066). mission_intake.json explicitly excluded "Production deployment to Cloudflare" from scope. The handoff did not surface this contradiction — ship would have dutifully tried to verify the deferred RCs against a deploy that mission_intake said would never happen. The mismatch was caught by ship Phase A bootstrap when the conductor cross-read mission_intake.notes manually.
**Root cause:** `finalize_develop._build_handoff` constructs `production_pending_rc_ids` from `required_evidence_plan.entries[].route == "production_pending"` (set either by spec authoring or by `build_required_evidence_plan.py --classify-production-pending=`). The build path doesn't consult mission_intake.json. So an RC with route=production_pending is reported as ship-deferred regardless of whether the mission's scope ever permits the production check. ship's `validate_develop_ship_handoff.py` rebuilds the same shape from required_claims_count without scope cross-reference. Result: a Phase 0 scaffold mission that explicitly forbids deploy still emits a handoff that asks ship to deploy-verify.
**Rule:** finalize_develop._build_handoff MUST read `mission_intake.explicit_out_of_scope` (when present) and emit a separate typed array `out_of_scope_pending_rc_ids[]` for any production_pending RC whose `production_check_hints[rc]` references an out-of-scope capability (substring match: "deploy", "Cloudflare", "production deployment"). These RCs are NOT included in `production_pending_rc_ids`. The handoff schema gains `out_of_scope_pending_rc_ids[]: list<string>` + `out_of_scope_rationale: dict<rc_id, str>` (the matching out_of_scope clause). ship Phase A reads `out_of_scope_pending_rc_ids[]` and routes those to `manualQA-skipped` with the rationale, NOT to deploy-verification or browser QA. validate_develop_ship_handoff.py mirrors the categorization. Mission_intake authors who change scope mid-flow re-run finalize_develop to refresh the categorization.
**Check:** `python3 -c "import json,sys; h=json.load(open('$MS/develop_handoff.json')); ms_path=os.path.join(os.path.dirname('$MS'),'mission_intake.json'); ms=json.load(open(ms_path)) if os.path.exists(ms_path) else {}; oos=' '.join(ms.get('explicit_out_of_scope',[])).lower(); leak=[r for r,h2 in h.get('production_check_hints',{}).items() if any(k in h2.lower() for k in ('deploy','cloudflare','production deploy')) and any(k in oos for k in ('deploy','cloudflare','production deploy'))]; sys.exit(1 if leak else 0)"` — non-zero exit means handoff contains production_pending RCs whose hints reference out-of-scope capabilities; finalize_develop needs to re-categorize.

## Culture Guardrails

# A2Z Culture — Universal Guardrails

These guardrails apply to ALL projects using the A2Z pipeline. They are learned from experience across multiple projects and missions. Unlike project-specific LEARNINGS.md entries, these are universally applicable.

Guardrails are promoted here by the `/a2z-learn` phase when a learning is classified as `universal` scope and the user approves promotion.

---

## Guardrails

### C-001: Write-on-success watermarks require dual verification paths [TESTING]
**Promoted from:** ingest-csv-capi (2026-02-22)
**Guardrail:** Features with write-on-success watermarks (watermark only updates after successful downstream delivery) cannot be verified with synthetic curl tests. ManualQA must use two paths: (1) synthetic tests verify business rules via skip counts, (2) real-world pipeline evidence verifies dedup (overlapping batches show only new rows sent).

### C-002: External input in key construction requires validation [SECURITY]
**Promoted from:** ingest-csv-capi (2026-02-22)
**Guardrail:** When external input (CSV fields, query params, form data) is used to construct KV keys, DB queries, or file paths, the architect phase must include input validation in acceptance criteria. Review phase DB+Security checklist item #9 enforces this. No raw external input in key strings — validate with regex, allowlist, or sanitization first.

### C-003: Security validation must reject, not just log [SECURITY]
**Source:** a2z-agent-demo — quiz-api-layer — 2026-02-23
**Guardrail:** Webhook/auth validation that calls console.warn but continues processing is a fail-open vulnerability. Every secret/token validation path must return 401/403 on mismatch, not just log. Review phase DB+Security checklist item #10 enforces this: `grep -A3 'console.warn.*secret'` must show a return within 3 lines.
**Verification:** `grep -B2 -A2 'console.warn' <webhook-handler>.ts` — every security-related warn must be preceded or followed by an early return with 401/403.

### C-004: Optional secret env vars require 3-path test coverage [TESTING]
**Source:** a2z-agent-demo — quiz-api-layer — 2026-02-23
**Guardrail:** When code handles optional secrets (env vars like *_SECRET, *_TOKEN that may or may not be set), tests must exercise all 3 paths: (1) secret not set → allow, (2) secret set + correct → allow, (3) secret set + wrong → 401. Tests with an empty env mock only cover path 1, leaving the actual auth logic untested.
**Verification:** `grep -c 'SECRET\|TOKEN' <test-file>` returns >= 2 for endpoints with optional secret validation.

### C-005: Bash history expansion mangles curl payloads with special characters [TESTING]
**Source:** a2z-agent-demo — quiz-api-layer — 2026-02-23
**Guardrail:** Bash `!` triggers history expansion inside double-quoted strings, mangling JSON payloads before curl sends them. This causes false 500 errors. Use single-quoted `-d` payloads, Python urllib/requests, or heredoc for POST data with `!`, `$`, or backticks. When curl returns unexpected 500, re-test with Python before marking FAIL.
**Verification:** ManualQA reports note the HTTP client used. Any unexpected 500 on payloads with special characters is retested with Python.

### C-006: Schema.sql and migration files can drift on indexes [DB]
**Source:** a2z-agent-demo — psychic-quiz-foundation — 2026-02-23
**Guardrail:** Ralph generates migration SQL from acceptance criteria, not by diffing schema.sql line-by-line. It can silently omit indexes while generating tables correctly. DB+Security reviewer must cross-reference `grep 'CREATE INDEX' <migration>.sql | sort` against `grep 'CREATE INDEX' schema.sql | sort` for the same table set. Any index in schema.sql but not in the migration is a BLOCKER. Architect phase must list every index name explicitly in acceptance criteria.
**Verification:** For each migration story, compare index lists between migration files and schema.sql. Any mismatch is a blocker.

### C-007: Parallel missions require pre-PR conflict check [PROCESS]
**Source:** a2z-agent-demo — psychic-quiz-foundation — 2026-02-23
**Guardrail:** Multiple missions on separate branches can touch shared files (index.ts, route registries). The first to merge wins; subsequent branches must rebase. Finish phase must run `git merge-tree` conflict detection before creating the PR. If CONFLICTING, rebase onto main, resolve conflicts, run tests, then force-push before PR creation.
**Verification:** Before `gh pr create`, run merge-tree check. If conflicts detected, rebase first. After rebase, `npm test` must pass.

### C-008: New D1 databases require deploy.yml migration steps [DEPLOY]
**Source:** a2z-agent-demo — psychic-quiz-api-core — 2026-02-23
**Guardrail:** When a mission creates a new D1 database binding, TWO changes are required: (1) the migration files, (2) a deploy.yml step to apply them remotely. Without both, the database tables won't exist in production after deploy. The architect phase must include a story or acceptance criterion for the deploy.yml step. The review phase must verify every `[[d1_databases]]` binding in wrangler.toml has a corresponding `d1 migrations apply` step in deploy.yml.
**Verification:** `grep '<DB_BINDING>' .github/workflows/deploy.yml` must return >= 1 for every D1 binding in wrangler.toml. Missing bindings are a BLOCKER.

### C-009: Fire-and-forget writes with downstream readers are bugs [DB]
**Source:** a2z-agent-demo — psychic-quiz-api-core — 2026-02-23
**Guardrail:** When a write operation (INSERT/UPDATE) is later used as input for a business logic decision (count-based cap, existence check, state validation), the write must NOT be fire-and-forget. A silently swallowed INSERT error means the downstream SELECT always returns stale/zero data, breaking the business rule. The write should either be awaited with errors surfaced, or at minimum log errors via `console.error` for observability.
**Verification:** If a table name appears in both INSERT (inside error-swallowing try/catch) AND in SELECT within the same endpoint, the write is business-critical. Flag as BLOCKER in review.

### C-010: Parallel terminal sessions must respect mission ownership [PROCESS]
**Source:** a2z-agent-demo — psychic-quiz-api-core / quiz-frontend-shell — 2026-02-23
**Guardrail:** When multiple missions run concurrently in separate terminals against the same repo, each session MUST only read/write/commit artifacts for its own `change-id`. Staging `openspec/changes/<other-change-id>/` files, removing another mission's worktree, or recommending next steps for a mission you don't own causes merge conflicts, lost work, and corrupted state in the other terminal. The `/a2z-improve` and `/a2z-clean` phases must skip any mission-state entries that are not in `currentPhase: "done"`.
**Verification:** Before `git add`, verify every staged path belongs to the current session's change-id or is a shared repo-wide file (LEARNINGS.md, CULTURE.md, skills). Any path containing a different change-id must be unstaged.

### C-011: Project-init must inject repo name; commits must verify target repo [PROCESS]
**Source:** a2z-agent-demo — psychic-quiz-api-core — 2026-02-23
**Guardrail:** `/a2z-project-init` must write the target repo name (`git remote get-url origin`) into `.a2z/PROJECT_CONTEXT.md` as a `target_repo: <owner>/<name>` field. Before any `git commit`, the session must run `git remote get-url origin` and verify it matches the expected repo. Never assume the repo based on directory name or working path — always check the git remote. When proposal.md and roadmap files contradict each other on repo placement, the plan phase must resolve the conflict before proceeding.
**Verification:** `grep 'target_repo' .a2z/PROJECT_CONTEXT.md` returns a value. Before commit, `git remote get-url origin` is checked against the expected repo name.

### C-013: CAPTCHA-protected endpoints require route interception in ManualQA [TESTING]
**Source:** a2z-agent-demo — psychic-quiz-full-redesign — 2026-02-25
**Guardrail:** Playwright cannot solve Turnstile/reCAPTCHA invisible challenges. When quiz/funnel endpoints are CAPTCHA-protected, ManualQA must use Playwright route interception to mock API responses (session creation, answer submission). The plan phase should flag `captcha_protected: true` in manualQA.md with a "Route Interception Setup" section specifying endpoints to mock, response schema, and data source (migration SQL or seed data). HTTP-level checks (curl) remain valid for deployment/content verification. All UI assertions (keyboard nav, ARIA, responsive layout) are fully valid under mocked APIs.
**Verification:** ManualQA reports for CAPTCHA-protected funnels note "Route interception used" and list mocked endpoints. No scenario is marked SKIP/FAIL due to CAPTCHA blocking.

### C-012: Automated browser tests must include fast-click variants for async widgets [TESTING]
**Source:** a2z-agent-demo — site-security-hardening — 2026-02-23
**Guardrail:** Playwright/Puppeteer tests naturally add ~500ms-1s idle time per action (clicks, screenshots, waits), giving async widgets (Turnstile, reCAPTCHA, analytics SDKs, third-party embeds) time to initialize. Real users clicking quickly through funnels don't have this luxury. ManualQA must run both a normal-pace scenario AND a fast-click variant (no artificial waits between steps). If the fast-click variant fails but normal passes, it's a timing bug — mark FAIL, not PASS.
**Verification:** ManualQA reports for features with async widgets must include two evidence sets: `MQA-N-normal.png` and `MQA-N-fastclick.png`. Missing fast-click evidence for async-widget features is a review finding.

### C-014: Refactor stories must grep all identifiers in moved code blocks [CODE-QUALITY]
**Source:** a2z-agent-demo — cf-cms-carinsurance-insureprimo-scaling — 2026-02-25
**Guardrail:** When code is moved or extracted during a refactor (e.g., extracting a function to a new file), every variable identifier in the moved block must be verified as declared in the new scope. In non-strict ES5 (common in inline browser scripts), undeclared variables silently resolve to `undefined` instead of throwing — making bugs invisible at review time but fatal at runtime. The review phase must grep for all identifiers in moved blocks and verify each has a corresponding declaration.
**Verification:** For refactor stories, `grep -n '<identifier>' <target-file>` must show both a declaration (`var`/`let`/`const`) and all usage sites in the same function scope.

### C-015: CSS rules in multi-stylesheet templates must account for source order [UI]
**Source:** a2z-agent-demo — cf-cms-carinsurance-insureprimo-scaling — 2026-02-25
**Guardrail:** When multiple `<style>` tags are rendered from separate files, CSS rules with equal specificity are resolved by source order — the later stylesheet wins. A media query in an earlier stylesheet is dead CSS if the base rule it overrides lives in a later stylesheet. Architect must document `<style>` tag render order. Acceptance criteria must include `getComputedStyle` verification at the target viewport — "rule exists in source" is insufficient.
**Verification:** For CSS stories in multi-file template systems, manualQA.md must include a `getComputedStyle` assertion comparing expected vs actual values at the target viewport.

### C-016: ManualQA for bugfixes must test the fix's trigger conditions, not just happy path [TESTING]
**Source:** a2z-agent-demo — cf-cms-carinsurance-insureprimo-scaling — 2026-02-25
**Guardrail:** When a story fixes a race condition, edge case, or timing bug, ManualQA must: (1) read the fix description to understand trigger conditions, (2) replicate those conditions in the browser (rapid clicks, concurrent actions, specific timing), (3) assert the fix invariant programmatically. Normal single-click walkthrough testing proves nothing about race condition fixes. A PASS without testing the fix's trigger conditions is INVALID.
**Verification:** ManualQA-report.md for bugfix scenarios must contain an "Edge cases tested" table listing specific trigger conditions, methods used, and programmatic assertion results.

### C-017: Scoring engine switch/case values must match HTML data-value attributes [CODE-QUALITY]
**Source:** a2z-agent-demo — investing-quiz-funnel-QA-V1 — 2026-02-25
**Guardrail:** When quiz/funnel scoring logic uses switch/case to map answers to categories, the case values must exactly match the `data-value` attributes in the HTML template — not the display text. Mismatches cause silent incorrect scoring (wrong persona assigned, wrong results shown). The architect phase must include a cross-reference verification command in acceptance criteria. The review phase Code Quality checklist item #8 enforces this.
**Verification:** `grep 'data-value=' <steps-file>` cross-referenced against `grep "case '" <scoring-file>`. Every `data-value` that affects scoring must appear as a `case`. Mismatches are BLOCKER.

### C-018: sendBeacon fire-and-forget creates race condition with synchronous DB reads [DB]
**Source:** a2z-agent-demo — investing-quiz-funnel-QA-V1 — 2026-02-25
**Guardrail:** `navigator.sendBeacon()` is fire-and-forget — the browser does not wait for the server response. When a quiz/funnel submits answers via sendBeacon and then immediately calls a synchronous endpoint (e.g., `/complete`) that reads those answers from DB, the read may execute before the write lands. This causes empty/stale results. The architect phase must flag this pattern and recommend: (a) use awaitable `fetch()` for the last submission before the read, (b) include all data in the read request body as fallback, or (c) add server-side retry/delay in the read endpoint.
**Verification:** `grep -n 'sendBeacon' <scripts-file>` — if any sendBeacon writes data that a subsequent synchronous endpoint reads, flag as race condition risk.

### C-019: Quiz session reuse via persistent sessionStorage causes stale data [TESTING]
**Source:** a2z-agent-demo — investing-quiz-funnel-QA-V1 — 2026-02-25
