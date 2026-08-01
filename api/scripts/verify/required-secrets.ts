#!/usr/bin/env tsx
/**
 * verify:required-secrets
 *
 * Asserts the secrets contract surfaces are coherent without ever
 * reading a real secret value:
 *
 *   1. .dev.vars.example contains a placeholder line for every Worker
 *      runtime secret the Env interface declares as a typed field.
 *   2. .dev.vars.example does NOT contain CLOUDFLARE_API_TOKEN — Phase
 *      1.5 split the legacy single token into runtime
 *      CLOUDFLARE_PROVISIONING_API_TOKEN + CLOUDFLARE_CACHE_API_TOKEN
 *      and a CI-only CLOUDFLARE_API_TOKEN that lives in GitHub Actions.
 *   3. docs/secrets-manifest.md lists every Worker-runtime secret key
 *      from the same set.
 *
 * The verifier walks files at well-known paths relative to the api/
 * working directory (cwd when run via `npm run verify:required-secrets`).
 * It exits 0 when every check passes, non-zero with the failing keys
 * on stderr otherwise.
 *
 * NOTE: this script never reads from .dev.vars (the live local secrets
 * file). It only reads .dev.vars.example, the scrubbed companion that
 * ships in the repo.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(process.cwd(), "..");
const DEV_VARS_EXAMPLE = resolve(REPO_ROOT, ".dev.vars.example");
const SECRETS_MANIFEST = resolve(REPO_ROOT, "docs/secrets-manifest.md");

const REQUIRED_RUNTIME_SECRETS: readonly string[] = [
  "OPENAI_API_KEY",
  "CF_ACCESS_TEAM_DOMAIN",
  "CF_ACCESS_AUD",
  "CLOUDFLARE_PROVISIONING_API_TOKEN",
  "CLOUDFLARE_CACHE_API_TOKEN",
  "CONVERSIONS_ACTOR_SIGNING_KEY_B64URL",
];

function readOrExit(path: string, label: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch (err) {
    console.error(`verify:required-secrets FAILED — cannot read ${label} at ${path}: ${(err as Error).message}`);
    process.exit(1);
  }
}

const devVars = readOrExit(DEV_VARS_EXAMPLE, ".dev.vars.example");
const manifest = readOrExit(SECRETS_MANIFEST, "docs/secrets-manifest.md");

interface Failure {
  surface: string;
  key: string;
  reason: string;
}

const failures: Failure[] = [];

for (const key of REQUIRED_RUNTIME_SECRETS) {
  const lineRe = new RegExp(`^${key}=`, "m");
  if (!lineRe.test(devVars)) {
    failures.push({
      surface: ".dev.vars.example",
      key,
      reason: "no placeholder line for this key (expected `KEY=...` line)",
    });
  }
  if (!manifest.includes(key)) {
    failures.push({
      surface: "docs/secrets-manifest.md",
      key,
      reason: "key not listed in the secrets manifest",
    });
  }
}

if (/^CLOUDFLARE_API_TOKEN=/m.test(devVars)) {
  failures.push({
    surface: ".dev.vars.example",
    key: "CLOUDFLARE_API_TOKEN",
    reason:
      "legacy single token MUST NOT appear as a runtime placeholder — split into CLOUDFLARE_PROVISIONING_API_TOKEN + CLOUDFLARE_CACHE_API_TOKEN; CI-only deploy token belongs in GitHub Actions",
  });
}

if (failures.length > 0) {
  console.error("verify:required-secrets FAILED — secrets contract surfaces are out of sync:");
  for (const f of failures) {
    console.error(`  ${f.surface} :: ${f.key} -- ${f.reason}`);
  }
  process.exit(1);
}

console.log(
  `verify:required-secrets OK -- .dev.vars.example and docs/secrets-manifest.md cover every runtime secret (${REQUIRED_RUNTIME_SECRETS.length} keys).`,
);
process.exit(0);
