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
 * wrangler.toml as text, scoping resource checks to their binding tables.
 *
 * Contract names asserted:
 *   - Worker scripts:  kodigital-homepages-cms-worker (prod + dev placeholder)
 *                      kodigital-homepages-cms-worker-staging
 *                      kodigital-homepages-cms-worker-perfstage
 *   - D1 databases:    kodigital-homepages-cms-db and the isolated perfstage DB
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
import { fileURLToPath } from "node:url";
import { deploymentChecks, tableBodies } from "./worker-config";

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
    test: (t) => tableBodies(t, "[[d1_databases]]").some(body => /^\s*database_name\s*=\s*"kodigital-homepages-cms-db"/m.test(body)),
  },
  {
    name: "r2-bucket-name",
    description: '[[r2_buckets]] declares bucket_name = "kodigital-homepages-cms-media"',
    test: (t) => tableBodies(t, "[[r2_buckets]]").some(body => /^\s*bucket_name\s*=\s*"kodigital-homepages-cms-media"/m.test(body)),
  },
  {
    name: "kv-binding-cache",
    description: '[[kv_namespaces]] declares binding = "CACHE"',
    test: (t) => tableBodies(t, "[[kv_namespaces]]").some(body => /^\s*binding\s*=\s*"CACHE"/m.test(body)),
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

export function checkInfraContract(wrangler: string): Check[] {
  return [...CHECKS, ...deploymentChecks(wrangler)].filter(check => !check.test(wrangler));
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? "")) {
  const path = resolve(process.cwd(), "wrangler.toml");
  let wrangler: string;
  try {
    wrangler = readFileSync(path, "utf8");
  } catch (err) {
    console.error(`verify:infra FAILED — cannot read ${path}: ${(err as Error).message}`);
    process.exit(1);
  }
  const failures = checkInfraContract(wrangler);
  if (failures.length > 0) {
    console.error("verify:infra FAILED — wrangler.toml does not match the infra and cache contract:");
    for (const f of failures) console.error(`  [${f.name}] ${f.description}`);
    process.exit(1);
  }
  const count = CHECKS.length + deploymentChecks(wrangler).length;
  console.log(`verify:infra OK -- wrangler.toml matches the infra and cache contract (${count} checks passed).`);
}
