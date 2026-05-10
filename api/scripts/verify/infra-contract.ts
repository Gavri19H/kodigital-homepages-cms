#!/usr/bin/env tsx
/**
 * verify:infra
 *
 * Asserts that api/wrangler.toml declares the Cloudflare resource names
 * specified by the Phase 1.5 infra contract (docs/cloudflare-worker-setup.md
 * and docs/cloudflare-resources-setup.md). A drift here means the Worker
 * would deploy against a wrong/missing/sibling-project resource.
 *
 * Exits 0 when every required identifier appears, non-zero with a list
 * of missing identifiers on stderr otherwise. The verifier reads
 * wrangler.toml as raw text (no TOML parser) to keep scope minimal and
 * because every check is a literal-substring presence check.
 *
 * Contract names asserted:
 *   - Worker scripts:  kodigital-homepages-cms-worker (prod + dev placeholder)
 *                      kodigital-homepages-cms-worker-staging
 *   - D1 database:     kodigital-homepages-cms-db
 *   - R2 bucket:       kodigital-homepages-cms-media
 *   - KV binding:      CACHE
 *   - account_id present + compatibility_date present
 *
 * CLOUDFLARE_API_TOKEN check: Phase 1.5 split the legacy single token
 * into runtime CLOUDFLARE_PROVISIONING_API_TOKEN + CLOUDFLARE_CACHE_API_TOKEN
 * (Worker runtime) and a CI-only CLOUDFLARE_API_TOKEN (GitHub Actions
 * deploy). The runtime token CLOUDFLARE_API_TOKEN MUST NOT appear in
 * wrangler.toml — that file declares only non-secret vars and binding
 * shapes; the deploy token belongs in CI secrets.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const WRANGLER_PATH = resolve(process.cwd(), "wrangler.toml");

interface Check {
  name: string;
  description: string;
  test: (toml: string) => boolean;
}

const CHECKS: readonly Check[] = [
  {
    name: "worker-name-production",
    description: 'top-level or [env.production] declares name = "kodigital-homepages-cms-worker"',
    test: (t) => /name\s*=\s*"kodigital-homepages-cms-worker"/.test(t),
  },
  {
    name: "worker-name-staging",
    description: '[env.staging] declares name = "kodigital-homepages-cms-worker-staging"',
    test: (t) => /name\s*=\s*"kodigital-homepages-cms-worker-staging"/.test(t),
  },
  {
    name: "d1-database-name",
    description: '[[d1_databases]] declares database_name = "kodigital-homepages-cms-db"',
    test: (t) => /database_name\s*=\s*"kodigital-homepages-cms-db"/.test(t),
  },
  {
    name: "r2-bucket-name",
    description: '[[r2_buckets]] declares bucket_name = "kodigital-homepages-cms-media"',
    test: (t) => /bucket_name\s*=\s*"kodigital-homepages-cms-media"/.test(t),
  },
  {
    name: "kv-binding-cache",
    description: '[[kv_namespaces]] declares binding = "CACHE"',
    test: (t) => /binding\s*=\s*"CACHE"/.test(t),
  },
  {
    name: "account-id-present",
    description: "top-level account_id key is present",
    test: (t) => /^account_id\s*=\s*"[^"]+"/m.test(t),
  },
  {
    name: "compatibility-date-present",
    description: "compatibility_date key is present",
    test: (t) => /compatibility_date\s*=\s*"\d{4}-\d{2}-\d{2}"/.test(t),
  },
  {
    name: "no-runtime-cloudflare-api-token",
    description:
      "CLOUDFLARE_API_TOKEN MUST NOT appear in wrangler.toml — runtime tokens are CLOUDFLARE_PROVISIONING_API_TOKEN + CLOUDFLARE_CACHE_API_TOKEN; CLOUDFLARE_API_TOKEN is a GitHub-Actions-only secret",
    test: (t) => !/CLOUDFLARE_API_TOKEN/.test(t),
  },
];

let wrangler: string;
try {
  wrangler = readFileSync(WRANGLER_PATH, "utf8");
} catch (err) {
  console.error(`verify:infra FAILED — cannot read ${WRANGLER_PATH}: ${(err as Error).message}`);
  process.exit(1);
}

const failures: Check[] = [];
for (const check of CHECKS) {
  if (!check.test(wrangler)) failures.push(check);
}

if (failures.length > 0) {
  console.error("verify:infra FAILED — wrangler.toml does not match the Phase 1.5 infra contract:");
  for (const f of failures) {
    console.error(`  [${f.name}] ${f.description}`);
  }
  process.exit(1);
}

console.log(
  `verify:infra OK -- wrangler.toml matches the Phase 1.5 infra contract (${CHECKS.length} checks passed).`,
);
process.exit(0);
