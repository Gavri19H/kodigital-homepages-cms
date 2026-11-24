#!/usr/bin/env tsx
/**
 * verify:worker-config
 *
 * Asserts that api/wrangler.toml declares every Phase 1.5 [vars] key the
 * Worker reads at runtime, with the correct per-env hostname routing
 * contract:
 *
 *   ADMIN_HOST          == cms.kodigital.app           (production)
 *   ADMIN_HOST          == staging-cms.kodigital.app   (staging)
 *   ADMIN_BASE_URL      == https://<ADMIN_HOST>        (per env)
 *   ADMIN_BASE_PATH     == "/admin"                    (every env)
 *
 * Plus the safety flags that gate site provisioning:
 *
 *   SITE_PROVISIONING_DRY_RUN              present (every env)
 *   SITE_PROVISIONING_ALLOW_ROUTE_MUTATION present (every env)
 *
 * And cache + model knobs the Worker depends on:
 *
 *   APP_ENV, CACHE_API_ENABLED, HTML_CACHE_TTL_SECONDS,
 *   OPENAI_TEXT_MODEL, OPENAI_IMAGE_MODEL — present in [vars]
 *
 * Exits 0 when the wrangler.toml declares all required vars in the
 * required env scopes; non-zero with a list of missing keys on stderr.
 *
 * Like infra-contract.ts this scans wrangler.toml as text rather than
 * pulling in a TOML parser; we look for [section] markers and check that
 * each required key appears at least once after the marker (per-env
 * scopes are enforced via section-scoped substring search).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

interface VarsBlock {
  name: string;
  startMarker: RegExp;
  required: { key: string; expected?: string }[];
}

const TOP_LEVEL_VARS_REQUIRED: VarsBlock["required"] = [
  { key: "APP_ENV" },
  { key: "ADMIN_HOST" },
  { key: "ADMIN_BASE_URL" },
  { key: "ADMIN_BASE_PATH", expected: "/admin" },
  { key: "CACHE_API_ENABLED" },
  { key: "HTML_CACHE_TTL_SECONDS" },
  { key: "OPENAI_TEXT_MODEL" },
  { key: "OPENAI_IMAGE_MODEL" },
  { key: "SITE_PROVISIONING_DRY_RUN" },
  { key: "SITE_PROVISIONING_ALLOW_ROUTE_MUTATION" },
];

const STAGING_VARS_REQUIRED: VarsBlock["required"] = [
  { key: "APP_ENV", expected: "staging" },
  { key: "ADMIN_HOST", expected: "staging-cms.kodigital.app" },
  { key: "ADMIN_BASE_URL", expected: "https://staging-cms.kodigital.app" },
  { key: "ADMIN_BASE_PATH", expected: "/admin" },
  { key: "SITE_PROVISIONING_DRY_RUN" },
  { key: "SITE_PROVISIONING_ALLOW_ROUTE_MUTATION" },
  { key: "HTML_CACHE_TTL_SECONDS" },
];

const PRODUCTION_VARS_REQUIRED: VarsBlock["required"] = [
  { key: "APP_ENV", expected: "production" },
  { key: "ADMIN_HOST", expected: "cms.kodigital.app" },
  { key: "ADMIN_BASE_URL", expected: "https://cms.kodigital.app" },
  { key: "ADMIN_BASE_PATH", expected: "/admin" },
  { key: "SITE_PROVISIONING_DRY_RUN" },
  { key: "SITE_PROVISIONING_ALLOW_ROUTE_MUTATION" },
  { key: "HTML_CACHE_TTL_SECONDS" },
];

const BLOCKS: readonly VarsBlock[] = [
  { name: "[vars]", startMarker: /^\[vars\]\s*$/m, required: TOP_LEVEL_VARS_REQUIRED },
  { name: "[env.staging.vars]", startMarker: /^\[env\.staging\.vars\]\s*$/m, required: STAGING_VARS_REQUIRED },
  { name: "[env.production.vars]", startMarker: /^\[env\.production\.vars\]\s*$/m, required: PRODUCTION_VARS_REQUIRED },
];

function sliceBlock(toml: string, startMarker: RegExp): string | null {
  const lines = toml.split("\n");
  let startIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (startMarker.test(lines[i] ?? "")) {
      startIdx = i + 1;
      break;
    }
  }
  if (startIdx < 0) return null;
  let endIdx = lines.length;
  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (/^\[/.test(line.trim())) {
      endIdx = i;
      break;
    }
  }
  return lines.slice(startIdx, endIdx).join("\n");
}

function cacheBlock(name: string, description: string, ...settings: RegExp[]) {
  const marker = new RegExp(`^\\s*\\[${name.replaceAll(".", "\\.")}\\]\\s*(?:#.*)?$`);
  return {
    name,
    description,
    test(toml: string): boolean {
      const body = sliceBlock(toml, marker);
      return body !== null && settings.every(setting => setting.test(body));
    },
  };
}

const workerType = /^\s*type\s*=\s*(?:"worker"|'worker')\s*(?:#.*)?$/m;
export const EDGE_CACHE_CHECKS = ["", "env.staging.", "env.production."].flatMap(prefix => [
  cacheBlock(`${prefix}cache`, "must declare enabled = true", /^\s*enabled\s*=\s*true\s*(?:#.*)?$/m),
  cacheBlock(
    `${prefix}exports.default`, 'must declare type = "worker" and cache = { enabled = false }',
    workerType, /^\s*cache\s*=\s*\{\s*enabled\s*=\s*false\s*\}\s*(?:#.*)?$/m,
  ),
  cacheBlock(
    `${prefix}exports.PublicPage`, 'must declare type = "worker" and cache = { enabled = true }',
    workerType, /^\s*cache\s*=\s*\{\s*enabled\s*=\s*true\s*\}\s*(?:#.*)?$/m,
  ),
]);

interface Failure {
  block: string;
  key: string;
  reason: string;
}

export function checkWorkerConfig(wrangler: string): Failure[] {
  const failures: Failure[] = [];
  for (const block of BLOCKS) {
    const body = sliceBlock(wrangler, block.startMarker);
    if (body === null) {
      failures.push({ block: block.name, key: "*", reason: "block not found in wrangler.toml" });
      continue;
    }
    for (const r of block.required) {
      const keyLine = new RegExp(`^${r.key}\\s*=\\s*"([^"]*)"\\s*$`, "m");
      const m = keyLine.exec(body);
      if (!m) {
        failures.push({ block: block.name, key: r.key, reason: "key not declared" });
        continue;
      }
      if (r.expected !== undefined && m[1] !== r.expected) {
        failures.push({
          block: block.name,
          key: r.key,
          reason: `expected "${r.expected}", got "${m[1] ?? ""}"`,
        });
      }
    }
  }
  for (const check of EDGE_CACHE_CHECKS) {
    if (!check.test(wrangler)) failures.push({ block: `[${check.name}]`, key: "*", reason: check.description });
  }
  return failures;
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? "")) {
  const path = resolve(process.cwd(), "wrangler.toml");
  let wrangler: string;
  try {
    wrangler = readFileSync(path, "utf8");
  } catch (err) {
    console.error(`verify:worker-config FAILED — cannot read ${path}: ${(err as Error).message}`);
    process.exit(1);
  }
  const failures = checkWorkerConfig(wrangler);
  if (failures.length > 0) {
    console.error("verify:worker-config FAILED — wrangler.toml does not match the routing and cache contract:");
    for (const f of failures) console.error(`  ${f.block} :: ${f.key} -- ${f.reason}`);
    process.exit(1);
  }
  console.log(`verify:worker-config OK -- ${BLOCKS.length} vars blocks and ${EDGE_CACHE_CHECKS.length} cache and export blocks checked.`);
}
