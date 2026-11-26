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
 *   ADMIN_HOST          == the isolated workers.dev hostname (perfstage)
 *   ADMIN_BASE_URL      == https://<ADMIN_HOST>        (per env)
 *   ADMIN_BASE_PATH     == "/admin"                    (every env)
 *
 * Plus the safety flags that gate site provisioning:
 *
 *   SITE_PROVISIONING_DRY_RUN              present (every env), "true" in perfstage
 *   SITE_PROVISIONING_ALLOW_ROUTE_MUTATION present (every env), "false" in perfstage
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

const PERFSTAGE_HOST = "kodigital-homepages-cms-worker-perfstage.haikov1989.workers.dev";
const BLOCKS: readonly VarsBlock[] = [
  { name: "[vars]", required: TOP_LEVEL_VARS_REQUIRED },
  { name: "[env.staging.vars]", required: STAGING_VARS_REQUIRED },
  { name: "[env.production.vars]", required: PRODUCTION_VARS_REQUIRED },
  {
    name: "[env.perfstage.vars]",
    required: [
      { key: "ADMIN_HOST", expected: PERFSTAGE_HOST },
      { key: "ADMIN_BASE_URL", expected: `https://${PERFSTAGE_HOST}` },
      { key: "ADMIN_BASE_PATH", expected: "/admin" },
      { key: "DEV_BYPASS_AUTH", expected: "true" },
      { key: "ADMIN_ALLOW_IP", expected: "" },
      { key: "SITE_PROVISIONING_DRY_RUN", expected: "true" },
      { key: "SITE_PROVISIONING_ALLOW_ROUTE_MUTATION", expected: "false" },
    ],
  },
];

// Keep array entries separate so a binding and its ID must match in the same
// table. An empty header selects the inheritable top-level settings.
export function tableBodies(toml: string, header: string): string[] {
  const bodies: string[][] = [];
  let body: string[] | undefined = header === "" ? [] : undefined;
  if (body) bodies.push(body);
  for (const line of toml.split("\n")) {
    if (/^\s*\[/.test(line)) {
      body = line.split("#", 1)[0]?.trim() === header ? [] : undefined;
      if (body) bodies.push(body);
    } else {
      body?.push(line);
    }
  }
  return bodies.map(lines => lines.join("\n"));
}

function stringSetting(key: string, value: string): RegExp {
  const literal = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^\\s*${key}\\s*=\\s*(["'])${literal}\\1\\s*(?:#.*)?$`, "m");
}

function configBlock(name: string, description: string, ...settings: RegExp[]) {
  return {
    name,
    description,
    test(toml: string): boolean {
      const [body, duplicate] = tableBodies(toml, `[${name}]`);
      return body !== undefined && duplicate === undefined && settings.every(setting => setting.test(body));
    },
  };
}

const workerType = stringSetting("type", "worker");
const ENV_PREFIXES = ["", "env.staging.", "env.production.", "env.perfstage."];
export const EDGE_CACHE_CHECKS = ENV_PREFIXES.flatMap(prefix => [
  configBlock(`${prefix}cache`, "must declare enabled = true", /^\s*enabled\s*=\s*true\s*(?:#.*)?$/m),
  configBlock(
    `${prefix}exports.default`, 'must declare type = "worker" and cache = { enabled = false }',
    workerType, /^\s*cache\s*=\s*\{\s*enabled\s*=\s*false\s*\}\s*(?:#.*)?$/m,
  ),
  configBlock(
    `${prefix}exports.PublicPage`, 'must declare type = "worker" and cache = { enabled = true }',
    workerType, /^\s*cache\s*=\s*\{\s*enabled\s*=\s*true\s*\}\s*(?:#.*)?$/m,
  ),
]);

// Wrangler inherits the top-level route unless the environment overrides it.
function hasRoutes(toml: string, scope: string): boolean | undefined {
  const body = tableBodies(toml, scope && `[${scope}]`)[0] ?? "";
  const prefix = scope && `${scope}.`;
  for (const key of ["route", "routes"]) {
    if (tableBodies(toml, `[${prefix}${key}]`).length ||
        tableBodies(toml, `[[${prefix}${key}]]`).length) return true;
  }
  if (/^\s*route\s*[.=]/m.test(body)) return true;
  if (/^\s*routes\s*=/m.test(body)) return !/^\s*routes\s*=\s*\[\s*\]\s*(?:#.*)?$/m.test(body);
  return undefined;
}

function isolatedBinding(table: string, description: string, id: RegExp, ...settings: RegExp[]) {
  const binding = configBlock(`[env.perfstage.${table}]`, description, id, ...settings);
  return {
    ...binding,
    test(toml: string): boolean {
      return binding.test(toml) &&
        !tableBodies(toml, `[[env.production.${table}]]`).some(body => id.test(body));
    },
  };
}

const PERFSTAGE_CHECKS = [
  configBlock("env.perfstage", "must declare the perfstage workers.dev name with empty services and queues",
    stringSetting("name", "kodigital-homepages-cms-worker-perfstage"),
    /^\s*workers_dev\s*=\s*true\s*(?:#.*)?$/m,
    /^\s*services\s*=\s*\[\s*\]\s*(?:#.*)?$/m,
    /^\s*queues\s*=\s*\{\s*producers\s*=\s*\[\s*\],\s*consumers\s*=\s*\[\s*\]\s*\}\s*(?:#.*)?$/m),
  {
    name: "env.perfstage.routes",
    description: "must serve workers.dev only",
    test: (toml: string) => !(hasRoutes(toml, "env.perfstage") ?? hasRoutes(toml, "")),
  },
  configBlock("env.perfstage.vars", 'must set APP_ENV to "perfstage" and PERFSTAGE to "true"',
    stringSetting("APP_ENV", "perfstage"), stringSetting("PERFSTAGE", "true")),
  isolatedBinding("d1_databases", "DB must use the dedicated perfstage D1 database",
    stringSetting("database_id", "a3fe7c6b-1bff-4b07-8a7c-a783401ab4ce"), stringSetting("binding", "DB"),
    stringSetting("database_name", "kodigital-homepages-cms-perfstage"), stringSetting("migrations_dir", "migrations")),
  isolatedBinding("kv_namespaces", "CACHE must use the dedicated perfstage KV namespace",
    stringSetting("id", "356e20e0b4f14177a0e814ebe87e04ee"), stringSetting("binding", "CACHE")),
  configBlock("[env.perfstage.r2_buckets]", "MEDIA must bind the production image bucket",
    stringSetting("binding", "MEDIA"), stringSetting("bucket_name", "kodigital-homepages-cms-media")),
];

export function deploymentChecks(toml: string) {
  const prefixes = new Set(ENV_PREFIXES);
  for (const match of toml.matchAll(/^\s*\[\[?env\.([\w-]+)[.\]]/gm)) {
    prefixes.add(`env.${match[1]}.`);
  }
  const metadata = Array.from(prefixes, prefix => configBlock(
    `${prefix}version_metadata`, "must bind CF_VERSION_METADATA", stringSetting("binding", "CF_VERSION_METADATA"),
  ));
  return [...EDGE_CACHE_CHECKS, ...PERFSTAGE_CHECKS, ...metadata];
}

interface Failure {
  block: string;
  key: string;
  reason: string;
}

export function checkWorkerConfig(wrangler: string): Failure[] {
  const failures: Failure[] = [];
  for (const block of BLOCKS) {
    const body = tableBodies(wrangler, block.name)[0];
    if (body === undefined) {
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
  for (const check of deploymentChecks(wrangler)) {
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
  console.log(`verify:worker-config OK -- ${BLOCKS.length} vars blocks and ${deploymentChecks(wrangler).length} deployment checks passed.`);
}
