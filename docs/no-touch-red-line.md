# No-Touch Red Line — TheIWise Production Resources

This document defines the **hard isolation boundary** between the new
`kodigital-homepages-cms` project and the existing TheIWise production
stack. Phase 0 of `kodigital-homepages-cms` MUST NOT read from, write to,
deploy over, or share state with any production resource listed below.

The Cloudflare account id `a05d7505b71c6cd931e436defe670509` hosts both
projects and is the **only** shared identifier; using it in
`api/wrangler.toml`, CI workflows, docs, and the verify script is allowed
and expected. Resource-level identifiers in that account are NOT shared.

## Forbidden production identifiers (must NOT appear in active code/config)

These strings are scanned by `npm run verify:no-legacy-prod-refs` and
will fail the build if they appear outside this file and the documents
listed in the verify script's `EXCLUDED_FILES`:

- `theiwise.com` — TheIWise production hostname (and any subdomain).
- `a2z-cf-cms-v1-api` — TheIWise Worker name (sibling project).
- `a2z-cf-cms-v1-db` — TheIWise D1 database name.
- `insureprimo` — TheIWise legacy product surface.
- `quotesRoutes` — TheIWise legacy route module.
- `psychic-quiz` — TheIWise legacy lead-funnel surface.
- `rental-booking` — TheIWise legacy booking surface.
- `kodigital2.cloudflareaccess.com` — legacy CF Access team domain.
- `admin.theiwise.com` — legacy TheIWise admin host.
- `7542d73ba678850e7ec62797f0ffb6e5e5279b6e57bd1f34ac372f04a4ded425` — legacy CF Access AUD claim.
- `44c73f76-6ed5-4b26-b442-6c2044326c4d` — legacy TheIWise D1 database id.
- `111320b080274cfd8465e89400712c5d` — legacy TheIWise KV namespace id.

## Boundary rules

1. **No domain reuse.** The new project lives on a kodigital-owned
   domain (chosen in a later phase). It MUST NOT publish on
   `theiwise.com` or any subdomain of it.
2. **No resource reuse.** D1 databases, R2 buckets, KV namespaces, and
   Worker names are project-scoped. Phase 0 uses placeholder bindings
   under `kodigital-homepages-cms-*` only.
3. **No code reuse from legacy surfaces.** `insureprimo`, `quotesRoutes`,
   `psychic-quiz`, and `rental-booking` are TheIWise-specific concerns
   and MUST NOT be ported into this codebase.
4. **Shared account, separate billing line.** Cloudflare resources for
   this project are created under the shared account
   `a05d7505b71c6cd931e436defe670509` but are tagged with the
   `kodigital-homepages-cms` prefix so they appear separately in usage
   reports.
5. **Verify on every push.** CI runs `verify:no-legacy-prod-refs` on
   every pull request and on `main` before deploy; a failure here blocks
   the merge and the deploy.

## What if a legacy identifier needs to be referenced?

Reference-only documents (architecture context, migration notes, this
red-line file) live under `docs/` and are explicitly listed in
`EXCLUDED_FILES` of `api/scripts/verify/assert-no-legacy-prod-refs.ts`.
If a new doc legitimately needs to name a forbidden identifier, add it
to that allow-list in the same PR.
