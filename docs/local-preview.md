# Local preview runbook

How to run the full CMS on a laptop and preview a complete, seeded
public site plus the admin surface — no remote Cloudflare resources, no
production data. Three commands: `db:migrate:local`, `seed:local`,
`wrangler dev`.

## What you get

- The public Worker rendering a deterministic fixture site
  ("Seed Local Living") at `http://localhost:8787/` with every Home
  view-model bucket filled: hero, 3 featured, 4 picks, 5 trending,
  6 latest, 4 category chips, and a newsletter block.
- The admin UI at `http://localhost:8787/admin` with auth bypassed
  locally via `DEV_BYPASS_AUTH=true`.
- A local D1 (SQLite) database under `api/.wrangler/` — nothing you do
  here can touch staging or production.

## Prerequisites

1. `npm install` in `api/` (once). `wrangler` and `tsx` are
   devDependencies — no global installs needed.
2. `api/.dev.vars` populated per `docs/local-dev-vars.md`. For preview
   purposes the one value that matters is `DEV_BYPASS_AUTH=true`; the
   bypass is double-gated and only honored when `APP_ENV` is not
   `production` (see `api/src/auth/access-auth.ts`).

All commands below run from `api/`:

```bash
cd api
```

## Step 1 — Apply migrations to the local D1

```bash
npm run db:migrate:local
```

This runs `wrangler d1 migrations apply kodigital-homepages-cms-db
--local`, creating/upgrading every table in the local SQLite database.
Run it again any time you pull new migrations; already-applied
migrations are skipped.

## Step 2 — Seed the deterministic fixture

```bash
npm run seed:local
```

`seed:local` (`api/scripts/seed-local.ts`) builds fixed-literal SQL —
no clocks, no randomness, no network — and applies it to the local D1.
It is idempotent: every row uses `INSERT OR REPLACE` with explicit
9xxx-namespace IDs and explicit timestamps, so re-running converges on
the same database state and never collides with rows you create
through the admin UI.

To inspect the SQL without executing it:

```bash
npm run seed:local -- --print
```

## Step 3 — Start the Worker

```bash
npm run dev
```

`npm run dev` is `wrangler dev`: it serves the Worker on
`http://localhost:8787/`, reading `api/.dev.vars` for runtime vars and
the same local D1 the seed wrote to.

## Step 4 — Preview the public site

Public requests are tenant-resolved by hostname:
`resolveSiteContextFromRequest` (`api/src/site/site-context.ts`) looks
the request's hostname up in the `domains` table and 404s anything
unmapped. The seed registers exactly one hostname — `localhost` — and
maps it to the fixture site, which is why `wrangler dev`'s default URL
works with zero extra config.

URLs worth checking:

```text
http://localhost:8787/                                  # Home — all buckets filled
http://localhost:8787/article/morning-light-rituals    # article template
http://localhost:8787/category/wellness                # category listing
http://localhost:8787/sitemap.xml                      # sitemap
http://localhost:8787/feed.xml                         # RSS
http://localhost:8787/robots.txt                       # robots
http://localhost:8787/health                           # liveness, no site context needed
```

> **Use `localhost`, not `127.0.0.1`.** Hostname resolution matches the
> literal seeded hostname; `http://127.0.0.1:8787/` is an unmapped
> hostname and returns the safe 404.

## Step 5 — Preview the admin

```bash
curl -i http://localhost:8787/api/admin/auth/status
# expected: {"authenticated":true,"mode":"dev-bypass"}
```

Then open `http://localhost:8787/admin` in a browser. With
`DEV_BYPASS_AUTH=true` and a non-production `APP_ENV`, the Cloudflare
Access JWT check is skipped locally. Articles, pages, categories,
media, and settings you edit in the admin write to the same local D1,
so public pages reflect your edits on the next request.

## Draft preview route status

`GET /preview/:id` currently returns `501 Preview not yet wired` — the
draft-preview story ([G3]) lands it separately. Until then, preview
drafts by publishing them locally (the local D1 is disposable).

## Resetting local state

- **Re-seed only:** run `npm run seed:local` again — idempotent, fixes
  any fixture rows you mangled while keeping your own admin-created
  rows (seed IDs live in the 9xxx namespace).
- **Full wipe:** stop `wrangler dev`, delete the local D1 state, then
  migrate + seed again:

  ```bash
  rm -rf .wrangler/state
  npm run db:migrate:local
  npm run seed:local
  ```

## Troubleshooting

- **`{"error":"Not Found"}` on `/`** → the hostname didn't resolve to a
  site. Either the seed hasn't run (`npm run seed:local`) or you're
  browsing `127.0.0.1` instead of `localhost`.
- **`no such table` from seed:local** → migrations haven't been
  applied; run `npm run db:migrate:local` first (the seed prints this
  hint on failure).
- **`/admin` returns 401** → `DEV_BYPASS_AUTH` is not `true` in
  `api/.dev.vars`, or `APP_ENV` is `production`. See the failure-modes
  section of `docs/local-dev-vars.md`.
- **Home page renders but buckets are empty** → you're on a site other
  than the fixture (check the hostname) or the seed was wiped; re-run
  `npm run seed:local`.
