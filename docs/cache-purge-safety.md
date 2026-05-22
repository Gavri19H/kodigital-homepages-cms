# Cache Purge Safety

`kodigital-homepages-cms` runs on a Cloudflare account that is shared
with a sibling production stack (see `docs/no-touch-red-line.md`). A
mis-routed cache purge — running this Worker's `purgeForHostname` with
a sibling hostname or zone-id — could evict that stack's HTML / asset
cache and trigger a user-visible cold-start storm. Phase 7 closes that
risk with a four-layer interlock around the purge entry point:

1. **Protected-domain refusal** — `assertNotProtectedDomain` is the
   FIRST line of `purgeForHostname` and throws BEFORE any
   `cache_purge_log` row is written.
2. **Dry-run default** — `resolveDryRunDefault` returns `true` whenever
   the caller omits `dryRun`, unless `SITE_PROVISIONING_DRY_RUN=false`
   is explicitly set. A dry-run records a `completed_dry_run` row and
   issues zero outbound fetches.
3. **`CLOUDFLARE_CACHE_API_TOKEN` binding policy** — the live path
   refuses to issue a purge when the token binding is missing
   (`status: skipped_missing_token`). The token is a Cloudflare
   Worker secret, never an environment variable in `wrangler.toml`,
   and rotates independently of `SITE_PROVISIONING_DRY_RUN`.
4. **Phase-7 live-call no-op** — even when all guards pass (live mode,
   zone-id present, token bound), `purgeForHostname` records a
   `failed` row with `reason: "phase7_no_op_live_purge_disabled"` and
   issues NO `fetch()` to `api.cloudflare.com`. Phase 7 deliberately
   forbids a real production purge in this session; the live path is
   wired but quiescent.

The owning modules are:

- `api/src/cache/purge.ts` (T4) — `purgeForHostname`,
  `resolveDryRunDefault`, the exported `CLOUDFLARE_CACHE_API_TOKEN`
  constant, and the `cache_purge_log` INSERT that records every
  outcome.
- `api/src/safety/protected-domains.ts` (T18) — `PROTECTED_DOMAINS`,
  `normalizeHostname`, `isProtectedDomain`, `assertNotProtectedDomain`.
- `api/test/purge-safety.test.ts` — the fetch-mock harness that
  asserts zero outbound fetches under every `purgeForHostname` code
  path (dry-run, missing zone, missing token, live no-op).

## Check order is fixed

`purgeForHostname` runs its guards in this exact order. The order is
load-bearing: any caller-visible side effect (especially a
`cache_purge_log` write) MUST NOT happen for a protected hostname, so
`assertNotProtectedDomain` runs before the dry-run branch.

| Order | Guard | Failure mode |
|---|---|---|
| 1 | `assertNotProtectedDomain(input.hostname)` | throws `Error("Refusing to operate on protected hostname: …")` — NO ledger row written |
| 2 | `resolveDryRunDefault` returns `true` | records `completed_dry_run` row + returns; zero fetch |
| 3 | `zone_id` is null or empty | records `skipped_missing_zone` row + returns; zero fetch |
| 4 | `CLOUDFLARE_CACHE_API_TOKEN` binding missing | records `skipped_missing_token` row + returns; zero fetch |
| 5 | all guards pass (live path) | records `failed` row with `reason: "phase7_no_op_live_purge_disabled"`; zero fetch |

Reviewers MUST flag any reordering of these checks. Moving the
protected-domain assertion below the dry-run branch would leak a
`cache_purge_log` row for a protected hostname under dry-run, which
defeats the "no observable side effect" invariant the assertion
exists to guarantee.

## `assertNotProtectedDomain` contract

`assertNotProtectedDomain(input)` lives in
`api/src/safety/protected-domains.ts` and throws synchronously when
`normalizeHostname(input)` matches any entry in `PROTECTED_DOMAINS`.
Normalization strips scheme, userinfo, path, query, fragment, port,
and a trailing dot, then lowercases — so every protected hostname is
matched case-insensitively regardless of how the caller supplies it
(URL, `Host:` header, bare hostname).

`PROTECTED_DOMAINS` is a `readonly string[]` of six sibling-stack
hostnames (the apex domain plus five subdomains, including the
`admin.` and `api.` hosts widened in T18). The list is the single
source of truth — `purgeForHostname` does NOT maintain its own
denylist, and every layer that issues a Cloudflare API call (purge,
DNS write, route mutation) MUST consult `assertNotProtectedDomain`
before issuing the call.

`api/scripts/verify/assert-no-legacy-prod-refs.ts` enforces that the
literal sibling hostname does NOT appear anywhere outside the
allowlisted files (this doc is NOT allowlisted — it must speak about
the protected domains symbolically, by referencing the
`PROTECTED_DOMAINS` constant). Adding a new protected hostname is a
two-line change in `protected-domains.ts` plus a regression test in
`api/test/protected-domains.test.ts`.

## `CLOUDFLARE_CACHE_API_TOKEN` policy

The cache-purge API token is a Cloudflare Worker **secret**, never an
environment variable. Storage rules:

- **MUST** be set via `npx wrangler secret put CLOUDFLARE_CACHE_API_TOKEN`
  per environment (production, staging) and read at runtime through the
  bracket-access `env[CLOUDFLARE_CACHE_API_TOKEN as keyof Env]` pattern
  in `purge.ts`.
- **MUST NOT** appear in `api/wrangler.toml`, `.dev.vars`,
  `.github/workflows/deploy.yml`, or any committed file. The verify
  scripts under `api/scripts/verify/` will fail CI if the token (or
  any generic credential assignment of the form `NAME` + literal
  equals + value) is committed.
- **MUST NOT** be exported from `api/src/cache/purge.ts` as a value —
  only the *name* of the binding is exported (the `CLOUDFLARE_CACHE_API_TOKEN`
  constant is the string `"CLOUDFLARE_CACHE_API_TOKEN"`, used as a
  `keyof Env` lookup).

Token scope: the token MUST be scoped to ONLY the `kodigital-` zones
this Worker owns. A broad-scope token (account-wide cache purge) is
a privilege-escalation hazard — a misrouted call could evict sibling
production cache even though `assertNotProtectedDomain` blocks the
direct hostname path. Cloudflare Dashboard → My Profile → API Tokens
is the only place the token is created or rotated.

When the binding is missing in a live call, `purgeForHostname`
returns `status: skipped_missing_token` with
`error: "CLOUDFLARE_CACHE_API_TOKEN binding is not set"` and writes
a `skipped_missing_token` row to `cache_purge_log`. The caller MUST
NOT treat this as a transient failure to retry — it indicates an
operator misconfiguration and requires re-binding the secret before
any further purge attempt.

## Dry-run default policy

`resolveDryRunDefault(env, callerDryRun)` returns:

| `callerDryRun` | `SITE_PROVISIONING_DRY_RUN` | Result |
|---|---|---|
| `true` | any | `true` |
| `false` | any | `false` |
| `undefined` | unset / empty / not `"false"` | `true` |
| `undefined` | `"false"` (literal, lowercase) | `false` |

The rule is "dry-run unless explicitly opted out". A caller that
forgets the `dryRun` flag gets the safe (no-fetch) path; a caller
that explicitly passes `dryRun=true` gets dry-run regardless of env;
only the combination `dryRun=undefined` + `SITE_PROVISIONING_DRY_RUN=false`
takes the live path.

Under dry-run, `purgeForHostname` records a `completed_dry_run` row
whose `response` field is `{"skipped":true,"reason":"dry_run", …}` and
returns `status: "completed_dry_run"`. The dry-run row is intentionally
identical in shape to a live row so a downstream auditor can replay
the intended purge without re-running the workflow.

The fetch-mock harness in `api/test/purge-safety.test.ts` asserts that
NO `fetch()` call is issued in dry-run mode — this is the
"definition-of-done" gate for the entire purge module
(`fetch-mock harness records 0 outbound fetches in dry-run mode`).

## `cache_purge_log` row contract

Every invocation of `purgeForHostname` that survives
`assertNotProtectedDomain` writes exactly one row to
`cache_purge_log` (the protected-domain throw writes zero rows).
The row carries the effective `dry_run` flag, the resolved
`status`, the JSON-encoded `payload` (hostname + paths + zone_id),
and the JSON-encoded `response` (what would have been sent or what
was deliberately skipped). The `INSERT … RETURNING id` shape is
parameter-bound (see `api/src/cache/purge.ts:93-108`) — never a
template-literal interpolation — per the D1 safety rules in
`.claude/rules/d1-database-safety.md`.

Downstream auditors should query `cache_purge_log` grouped by
`status` to confirm:

- `completed_dry_run` count matches the expected
  publish/invalidate workflow volume,
- `skipped_missing_zone` is rare (indicates an admin form gap),
- `skipped_missing_token` is zero in production (indicates an
  operator binding gap),
- `failed` with `reason: "phase7_no_op_live_purge_disabled"` is the
  Phase-7 live-path placeholder — it MUST be re-evaluated when the
  live-purge fetch is enabled in a later phase.

## Pre-commit checklist for purge-adjacent changes

A patch that touches `api/src/cache/purge.ts`,
`api/src/safety/protected-domains.ts`, or any caller that constructs
a hostname / zone_id passed to `purgeForHostname` MUST pass every
item below before merge:

- [ ] `assertNotProtectedDomain` is the first non-trivial statement
      in any new purge entry point.
- [ ] Caller defaults to dry-run (or explicitly sets `dryRun=true`)
      in every code path that runs in CI, tests, or local dev.
- [ ] `CLOUDFLARE_CACHE_API_TOKEN` is referenced ONLY through the
      exported constant + `keyof Env` bracket access — never as a
      string literal in TS, never as a plain env var in
      `wrangler.toml`.
- [ ] New hostnames added to `PROTECTED_DOMAINS` have a regression
      test in `api/test/protected-domains.test.ts` (case + URL +
      port variants).
- [ ] `api/test/purge-safety.test.ts` still asserts zero outbound
      fetches under dry-run mode (the global fetch mock counter MUST
      remain at zero across every test in the suite).
- [ ] `npm run verify:no-legacy-prod-refs` still passes after the
      change (sibling production hostnames + identifiers stay out of
      committed code).
