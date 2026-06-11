# SHIP_HANDOFF.md — kodigital-cms-rescue-2-2026-06-10

Ship-phase handoff per the mission brief (BCL-028, verbatim):

> 5. Ship phase (NOT this mission): backup prod D1 → wipe all 9 sites +
>    dependents →

This document is the operator's procedure for that ship phase. Nothing in
it executes during the develop mission — deploy and production mutation
stay user-owned (`.claude/rules/deploy-safety.md`): the agent MUST NOT run
`wrangler deploy` / `wrangler secret put`; the operator runs every command
below.

Sequence: **preflight → backup → wipe → recreate → verify (post-deploy)**.

---

## 0. Preflight (run before ANY production mutation)

From a clean `main` checkout (`git status --porcelain` must be empty):

```bash
cd api
npm install
npm run typecheck
npm test
npm run verify:no-legacy-prod-refs
npm run verify:infra
npm run verify:worker-config
```

All five gates must exit 0 (`docs/deployment-runbook.md` Phase 1.5 gate).
Then confirm the deploy pipeline carries every migration:

```bash
# every migration file 0001..0013 must be anchored in deploy.yml
ls api/migrations/
grep -c "0010_phase9_sites_content_mode" .github/workflows/deploy.yml   # >= 1
grep -c "0011_phase9_prompt_presets_model_columns" .github/workflows/deploy.yml  # >= 1
```

Preflight also requires the CF Access service-token credentials (section 5)
exported in the operator shell: `CF_ACCESS_CLIENT_ID` /
`CF_ACCESS_CLIENT_SECRET`.

---

## 1. Backup production D1 (FIRST, before anything mutates)

Production database: `kodigital-homepages-cms-db`
(id `caa649b9-128e-4912-97c8-3e3d4a394800`, binding `DB` in
`api/wrangler.toml`).

```bash
cd api
mkdir -p ../backups
# full SQL backup (schema + data)
npx wrangler d1 export kodigital-homepages-cms-db --remote \
    --output=../backups/prod-pre-rescue-$(date +%Y%m%d-%H%M%S).sql

# capture a D1 Time Travel bookmark as a second, independent restore point
npx wrangler d1 time-travel info kodigital-homepages-cms-db
```

Verify the backup before proceeding — an empty or truncated backup file is
a hard STOP:

```bash
ls -lh ../backups/          # file size must be non-trivial (> 100 KB expected)
grep -c "INSERT INTO sites" ../backups/prod-pre-rescue-*.sql   # >= 1
```

Record the Time Travel bookmark id in the ship notes. Restore paths if the
ship goes wrong:

```bash
# option A — Time Travel restore to the pre-wipe bookmark
npx wrangler d1 time-travel restore kodigital-homepages-cms-db --bookmark=<bookmark-id>
# option B — re-import the SQL backup
npx wrangler d1 execute kodigital-homepages-cms-db --remote --file=../backups/prod-pre-rescue-<ts>.sql
```

---

## 2. Wipe all 9 sites + dependents

Enumerate the 9 existing production sites first and paste the list into the
ship notes (this is the wipe manifest):

```bash
cd api
npx wrangler d1 execute kodigital-homepages-cms-db --remote \
    --command "SELECT id, domain, status FROM sites ORDER BY created_at"
```

Expected: 9 rows. If the count differs, STOP and reconcile before wiping.

Wipe site-scoped rows child-first (do NOT rely on cascade ordering), then
the sites themselves. Global seed tables (`verticals`,
`category_verticals`, `legal_templates`) are KEPT — they are vertical-level
seeds, not site dependents.

```bash
npx wrangler d1 execute kodigital-homepages-cms-db --remote --command "DELETE FROM site_creation_job_steps"
npx wrangler d1 execute kodigital-homepages-cms-db --remote --command "DELETE FROM site_creation_jobs"
npx wrangler d1 execute kodigital-homepages-cms-db --remote --command "DELETE FROM ai_generations"
npx wrangler d1 execute kodigital-homepages-cms-db --remote --command "DELETE FROM cache_purge_log"
npx wrangler d1 execute kodigital-homepages-cms-db --remote --command "DELETE FROM site_categories"
npx wrangler d1 execute kodigital-homepages-cms-db --remote --command "DELETE FROM site_settings"
npx wrangler d1 execute kodigital-homepages-cms-db --remote --command "DELETE FROM domains"
npx wrangler d1 execute kodigital-homepages-cms-db --remote --command "DELETE FROM articles"
npx wrangler d1 execute kodigital-homepages-cms-db --remote --command "DELETE FROM pages"
npx wrangler d1 execute kodigital-homepages-cms-db --remote --command "DELETE FROM redirects"
npx wrangler d1 execute kodigital-homepages-cms-db --remote --command "DELETE FROM tags"
npx wrangler d1 execute kodigital-homepages-cms-db --remote --command "DELETE FROM media"
npx wrangler d1 execute kodigital-homepages-cms-db --remote --command "DELETE FROM sites"
```

Confirm the wipe:

```bash
npx wrangler d1 execute kodigital-homepages-cms-db --remote \
    --command "SELECT (SELECT COUNT(*) FROM sites) AS sites, (SELECT COUNT(*) FROM articles) AS articles, (SELECT COUNT(*) FROM verticals) AS verticals"
# expected: sites=0, articles=0, verticals=8 (seeds intact)
```

---

## 3. Recreate sites via the launch workflow

Deploy the rescue build first (staging → smoke → production, per
`docs/deployment-runbook.md`), then recreate each site through the admin
API — never by hand-INSERTing rows. The first site recreated and verified
is **theplaynest.net**; the remaining 8 follow the identical flow only
after theplaynest.net passes section 4.

```bash
# create the site record + provisioning job
curl -fsS -X POST \
    -H "CF-Access-Client-Id: $CF_ACCESS_CLIENT_ID" \
    -H "CF-Access-Client-Secret: $CF_ACCESS_CLIENT_SECRET" \
    -H "Content-Type: application/json" \
    -d '{"domain":"theplaynest.net","vertical_slug":"<vertical>","name":"The Play Nest"}' \
    https://cms.kodigital.app/api/admin/sites

# advance the provisioning job one step per call until step 16 completes
curl -fsS -X POST \
    -H "CF-Access-Client-Id: $CF_ACCESS_CLIENT_ID" \
    -H "CF-Access-Client-Secret: $CF_ACCESS_CLIENT_SECRET" \
    https://cms.kodigital.app/api/admin/sites/<site-id>/provision/next
```

The job walks the 16 canonical steps in
`api/src/site-provisioning/steps.ts` (`STEP_KEYS`):
`validate_domain_in_cloudflare` → `create_site_record` →
`attach_domain_to_new_worker_or_mark_pending` →
`allocate_vertical_categories` → `create_site_settings` →
`generate_tagline_and_site_description` → `generate_about_page` →
`render_generic_legal_pages_with_site_variables` → `generate_logo_mark` →
`generate_feature_image` → `generate_15_homepage_articles` →
`generate_or_assign_article_images` → `publish_starter_articles` →
`warm_homepage_cache` → `run_site_smoke_tests` →
`update_launch_readiness`.

A step that returns `failed` is a STOP for that site: read the step's
`output`/`error` in `site_creation_job_steps`, fix the cause, re-run
`/provision/next` (the runner resumes at `current_step_index`). Launch
readiness for theplaynest.net must reach green
(`update_launch_readiness`) before the next site is started.

---

## 4. Verification — pre-deploy gates + post-deploy checks

### 4.1 Pre-deploy (local, before each `wrangler deploy`)

```bash
cd api
npm test                 # full vitest suite, includes the design-contract specs
npx playwright test      # Playwright UI suite (test-ui/, report in api/test-results/)
```

The design-contract surface is enforced by
`api/test/design-contract-values.test.ts` plus the
`public-templates-home/article/components` design-contract render specs —
a Playwright run plus a green design-contract suite are both REQUIRED
before deploy. `npm run test:ui:report` opens the Playwright HTML report
when a spec fails.

### 4.2 Post-deploy checks (run ALL of these after each production deploy)

1. **Health + service-token auth** (post-deploy smoke, behavioral — not
   just HTTP 200):
   ```bash
   curl -I https://cms.kodigital.app/health        # 200
   curl -fsS \
       -H "CF-Access-Client-Id: $CF_ACCESS_CLIENT_ID" \
       -H "CF-Access-Client-Secret: $CF_ACCESS_CLIENT_SECRET" \
       https://cms.kodigital.app/api/admin/auth/status
   # expected: {authenticated:true, mode:"service-token", common_name:"KODIGITAL_CMS_SMOKE_TESTS"}
   ```
2. **Public homepage on the recreated site** — verify the SPECIFIC content,
   plus cache headers (cf-cache-status + age; stale cache is flagged, not
   cache-busted away):
   ```bash
   curl -sS -D - -o /dev/null https://theplaynest.net/ | grep -i "cf-cache-status\|age\|^HTTP"
   curl -sS https://theplaynest.net/ | grep -c "data-screen-label"   # >= 1
   ```
3. **Lighthouse** against the live homepage — budget from
   `docs/performance-checklist.md` (TTFB < 200 ms at edge, LCP < 2.5 s on
   4G mobile, CLS = 0):
   ```bash
   npx lighthouse https://theplaynest.net/ --preset=desktop --output=html --output-path=./lighthouse-theplaynest-desktop.html
   npx lighthouse https://theplaynest.net/ --form-factor=mobile --output=html --output-path=./lighthouse-theplaynest-mobile.html
   ```
   A Lighthouse run that misses the budget is a ship-phase FAIL for that
   site: file the regression, fix, re-run Lighthouse before launching the
   next site.
4. **Sitemap / robots / feed** on the recreated site:
   ```bash
   curl -fsS https://theplaynest.net/sitemap.xml | grep -c "theplaynest.net"   # >= 1, no foreign hosts
   curl -fsS https://theplaynest.net/robots.txt
   curl -fsS https://theplaynest.net/feed.xml | head -20
   ```
5. **Log tail** — `npx wrangler tail --env production` for 5 minutes after
   each post-deploy window; non-200 spikes (other than 302→SSO) trigger
   the rollback path in section 1.

Playwright, the design-contract suite, and Lighthouse together are the
ship gate: a site is "recreated" only when all post-deploy checks above
pass for it.

---

## 5. CF Access service token (smoke credentials)

All authenticated ship-phase calls use the Cloudflare Access service token
**`KODIGITAL_CMS_SMOKE_TESTS`** — the non-human login for
`cms.kodigital.app`. Full click-level setup:
`docs/cloudflare-access-service-token-setup.md`.

- Headers: `CF-Access-Client-Id` + `CF-Access-Client-Secret`.
- Env vars: `CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET` (GitHub
  Actions secrets + local `api/.dev.vars`; never committed).
- The Worker gates the token's `common_name` against the
  `ALLOWED_CF_SERVICE_TOKEN_IDS` secret — it must contain
  `KODIGITAL_CMS_SMOKE_TESTS` exactly.
- 403 `service token not allowed` post-deploy → re-run
  `wrangler secret put ALLOWED_CF_SERVICE_TOKEN_IDS --env production`
  (operator-run; see the triage table in `docs/deployment-runbook.md`).

---

## 6. Ownership + references

- Deploy, secret writes, and every command in this file: **user-owned**.
- Rollback: `npx wrangler rollback --env production` + D1 restore from the
  section-1 backup (D1 migrations are forward-only; never assume rollback
  reverts schema).
- References: `docs/deployment-runbook.md`,
  `docs/cloudflare-access-service-token-setup.md`,
  `docs/performance-checklist.md`, `docs/design-contract.md`,
  `docs/local-preview.md` (local rehearsal of the recreate flow via
  `npm run seed:local`).
