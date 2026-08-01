# Conversions same-origin service proxy runbook

Status: local remediation pending fresh independent verification.
`CONVERSIONS_PROXY_ENABLED` and
`CONVERSIONS_UI_ENABLED` remain `false` in development, staging and production.
This runbook does not authorize provisioning, secret mutation, deployment or
flag activation.

## Boundary

Browser admin requests use `/api/admin/conversions/v1/*`. The existing CMS
Cloudflare Access middleware runs first. Only a verified identity JWT can be
mapped to an actor; service tokens and the non-production developer bypass can
never mint an envelope. The CMS calls only the `CONVERSIONS_CORE` service
binding. It never uses global `fetch` for this proxy.

Workers/Hono exposes a WHATWG URL rather than a raw pre-normalization request
target. The normalized `URL.pathname` is therefore the sole canonical CMS
target for route selection, bootstrap-operation policy, signed operation scope
and service-binding dispatch. The CMS does not claim to observe or reject raw
dot segments that the URL parser has already removed. Literal `./`, `%2e`,
relevant `%2e%2e` and literal-backslash spellings that normalize to an allowed
target receive exactly that target's method, operation, scope and policy.
Spellings that retain percent, backslash, double-slash or dot ambiguity after
parsing fail before the binding. Query bytes do not select a route or operation
and remain on the forwarded canonical URL.

The source contains the complete 62-route method/template/selector/operation
matrix and complete 60-operation bootstrap-policy matrix. A test-only contract
lock compares both with the generated Core catalog. Every decision uses the
same normalized pathname; normalization cannot preserve an apparently safe
operation while authorizing a different operation. Each accepted request gets
a fresh CMS UUIDv7 whose header value equals the signed actor and signed scope
request ID. Safe headers, exact body bytes, idempotency and bounded streaming
rules are identical for canonical and normalized-alias spellings.

The UI and proxy flags are independent. Only the exact string `true` enables
the proxy. Missing or malformed flags, binding, actor configuration, allowlist,
mapping, expiry or signing key fail closed. Browser-provided actor email,
capability, operation-scope and signed-envelope fields are ignored and stripped.

The frozen special request bodies are exact. Connection test uses `test_kind`,
integer `sample_limit` from 1 through 1000 and `expected_side_effect_mode`; the
signed `destination_class` is derived rather than accepted from the browser.
Schedule PATCH uses `previous_enabled`, `enabled` and canonical `recipient_ids`.
`previous_enabled` is an optimistic precondition only: the future Core mutation
handler must compare it to stored state within the same authorized mutation
transaction and fail closed before any write when it differs. It must never
treat that browser field as proof of current state.

## Non-secret deployment bindings

These values belong in environment-specific Wrangler vars:

- `CONVERSIONS_PROXY_ENABLED` — keep `false` until the independent release gate.
- `CONVERSIONS_ADMIN_EMAILS` — canonical lowercase comma-separated exact email allowlist.
- `CONVERSIONS_ACTOR_ID_BY_EMAIL` — JSON object whose exact keys equal that allowlist and whose unique values are lowercase UUIDv7 actor IDs.
- `DEFAULT_WORKSPACE_ID` — fixed lowercase UUIDv7.
- `CONVERSIONS_ACTOR_AUDIENCE` — expected Core audience (`kodigital-conversions-core`).
- `CONVERSIONS_ACTOR_ENVIRONMENT` — exact `development`, `staging` or `production`, matching `APP_ENV`.
- `CONVERSIONS_BOOTSTRAP_EXPIRES_AT` — fixed whole-second ISO timestamp, no later than 30 days after the first production admin deployment.
- `CONVERSIONS_CORE` — environment-specific service binding target.

Empty allowlist/expiry placeholders in `api/wrangler.toml` deliberately prevent
issuance. The placeholder service names do not prove that the Workers exist or
that the account has capacity.

## Secret boundary

`CONVERSIONS_ACTOR_SIGNING_KEY_B64URL` is the canonical unpadded base64url
encoding of exactly 32 random raw bytes. Core receives the identical value as
`ACTOR_CONTEXT_HMAC_KEY_B64URL`; both sides decode those same raw bytes before
HMAC. It is never a plaintext Wrangler var, source value, fixture value
used outside tests, log field, response field or browser value. After G6/G8
approval, an authorized operator sets it separately in the target environment:

```bash
cd api
npx wrangler secret put CONVERSIONS_ACTOR_SIGNING_KEY_B64URL --env staging
# Production is a separate approved change after staging acceptance.
```

Do not paste the value into a shell command, ticket, evidence file or this
repository. Confirm only the binding name through the approved secret inventory.

## Local verification

No network, secret or deployed resource is needed for the local contract suite:

```bash
cd api
npm run typecheck
npm run verify:conversions-actor-contract
```

The test-only cross-repository verifier imports the frozen EV-037 runtime module
and proves the CMS WebCrypto HMAC bytes are accepted. CMS production source has
no runtime repository import.

Before an authorized deployment, also run:

```bash
cd api
npm test
npm run verify:all
WRANGLER_LOG_PATH=/tmp/kodigital-cms-wrangler.log npx wrangler deploy --dry-run --outdir /tmp/kodigital-cms-dry-run
```

Dry-run output is local only; it is not a deployment.

## Activation gates and rollback

Keep both feature flags false until all of the following have separate evidence:

1. fresh independent acceptance of the EV-045 normalized-target remediation
   plus the envelope, identity, scope and proxy boundary;
2. permanent main-system issuer owner and saved compatibility fixture;
3. shared Core replay-consumption boundary;
4. real staging `CONVERSIONS_CORE` binding and Cloudflare capacity verification;
5. fixed bootstrap removal date based on the actual first production deployment;
6. staging deployment and authenticated identity-mode smoke acceptance.

The bootstrap never grants `conversions.external_redelivery`. The complete
operation policy also rejects scheduled/verification email sends, sandbox or
production Connection tests, ownership release/activation, publish/resume/run,
delivery cancellation, external replay, ordinary control mutation and enabling
dashboard conversion-revenue. Disabling dashboard conversion-revenue remains
allowed as a fail-safe operation. A persistent warning is injected into
authenticated production admin HTML while bootstrap issuance is active; it
becomes critical during the final 14 days.

Rollback is flag-first: set `CONVERSIONS_PROXY_ENABLED=false` through the
approved deployment workflow. The disabled value makes API routes return a safe
not-found response and does not depend on the UI flag. Never delete/rotate the
signing secret or change actor mappings as an improvised rollback; preserve them
for audit until the incident owner approves cleanup.
