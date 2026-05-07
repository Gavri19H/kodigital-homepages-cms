# Source Architecture — What We Reuse, What We Exclude

`kodigital-homepages-cms` is a **standalone** Cloudflare Workers + Hono +
D1 + R2 + KV CMS for marketing/site content. It is born next to the
TheIWise stack on the same Cloudflare account but is architecturally
independent. This document records, for future contributors, which
patterns from the sibling project we reuse, and which surfaces are
explicitly excluded.

## Reusable patterns (carried over deliberately)

The following patterns are **reusable** from the sibling project. They
encode hard-won operational lessons and we adopt them here:

- **Hono on Workers with typed `Env` bindings.** The Worker entry point
  composes a Hono app with a single `Env` interface that types
  `D1Database`, `KVNamespace`, `R2Bucket`, and string vars. See
  `api/src/env.ts` for the new project's version.
- **Cloudflare Access in front of `/admin`.** The admin surface is gated
  by Access at the edge; the Worker validates the assertion header (or
  cookie) instead of running its own login flow. Phase 0 ships a
  presence-check middleware (`api/src/auth/access-auth.ts`); JWT
  signature verification is added in a later phase.
- **`verify:no-legacy-prod-refs` banned-string scanner.** A pre-merge
  script that fails the build if forbidden production identifiers leak
  into active source. Reusable because it is configuration-only.
- **Compatibility-date pinning in `wrangler.toml`.** Pin the
  `compatibility_date` to the value chosen at project start; do not bump
  silently. Reusable because it makes Worker behavior reproducible.
- **`tsx`-runnable scripts under `scripts/`.** Maintenance scripts run
  via `tsx` against the same `tsconfig.json` so we don't maintain two
  TypeScript build pipelines.
- **D1 + R2 + KV split.** Structured site/page data in D1, original media
  in R2, edge-cacheable rendered output in KV. Reusable because it
  matches the cost-and-latency profile we need (see
  `storage-cost-model.md`).

## Excluded surfaces (deliberately NOT carried over)

The following TheIWise-specific surfaces are **excluded** from this
project. They are listed by name so an automated scan and a human
reviewer can both confirm they have not been reintroduced:

- **`insureprimo`** — TheIWise insurance-quote product surface; not part
  of the kodigital-homepages-cms scope.
- **`quotesRoutes`** — Route module that implements the quote funnel;
  excluded along with `insureprimo`.
- **`psychic-quiz`** — Legacy lead-capture funnel; excluded.
- **`rental-booking`** — Legacy booking flow; excluded.

If any of these names appear in this codebase outside reference docs
listed in the verify script's `EXCLUDED_FILES`, the build fails.

## Why this matters

The CI verify gate is the cheap automated half of this rule. This
document is the human half: a new contributor reading it should be able
to answer "should I copy this from the other project?" with a clear yes
(reusable patterns above) or no (excluded surfaces above) without having
to dig through legacy code.
