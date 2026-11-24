import { describe, it, expect, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import manifest from "../package.json";

const __dirname = dirname(fileURLToPath(import.meta.url));
const API_DIR = resolve(__dirname, "..");
const SCRIPT = "scripts/verify/infra-contract.ts";
const TSX_LOADER = createRequire(import.meta.url).resolve("tsx");

const GOOD_TOML = `name = "kodigital-homepages-cms-worker"
main = "src/index.ts"
compatibility_date = "2026-05-06"
account_id = "abc123"

[version_metadata]
binding = "CF_VERSION_METADATA"

[cache]
enabled = true

[exports.default]
type = "worker"
cache = { enabled = false }

[exports.PublicPage]
type = "worker"
cache = { enabled = true }

[vars]
APP_ENV = "development"

[[d1_databases]]
binding = "DB"
database_name = "kodigital-homepages-cms-db"

[[kv_namespaces]]
binding = "CACHE"
id = "kv-id"

[[r2_buckets]]
binding = "MEDIA"
bucket_name = "kodigital-homepages-cms-media"

[env.staging]
name = "kodigital-homepages-cms-worker-staging"

[env.staging.version_metadata]
binding = "CF_VERSION_METADATA"

[env.staging.cache]
enabled = true

[env.staging.exports.default]
type = "worker"
cache = { enabled = false }

[env.staging.exports.PublicPage]
type = "worker"
cache = { enabled = true }

[env.perfstage]
name = "kodigital-homepages-cms-worker-perfstage"
workers_dev = true
services = []
queues = { producers = [], consumers = [] }

[env.perfstage.version_metadata]
binding = "CF_VERSION_METADATA"

[env.perfstage.cache]
enabled = true

[env.perfstage.exports.default]
type = "worker"
cache = { enabled = false }

[env.perfstage.exports.PublicPage]
type = "worker"
cache = { enabled = true }

[env.perfstage.vars]
APP_ENV = "perfstage"
PERFSTAGE = "true"
DEV_BYPASS_AUTH = "true"
ADMIN_ALLOW_IP = "46.117.76.207"
ADMIN_HOST = "kodigital-homepages-cms-worker-perfstage.haikov1989.workers.dev"
ADMIN_BASE_URL = "https://kodigital-homepages-cms-worker-perfstage.haikov1989.workers.dev"
ADMIN_BASE_PATH = "/admin"

[[env.perfstage.d1_databases]]
binding = "DB"
database_name = "kodigital-homepages-cms-perfstage"
database_id = "a3fe7c6b-1bff-4b07-8a7c-a783401ab4ce"
migrations_dir = "migrations"

[[env.perfstage.kv_namespaces]]
binding = "CACHE"
id = "356e20e0b4f14177a0e814ebe87e04ee"

[[env.perfstage.r2_buckets]]
binding = "MEDIA"
bucket_name = "kodigital-homepages-cms-media"

[env.production]
name = "kodigital-homepages-cms-worker"

[env.production.version_metadata]
binding = "CF_VERSION_METADATA"

[env.production.cache]
enabled = true

[env.production.exports.default]
type = "worker"
cache = { enabled = false }

[env.production.exports.PublicPage]
type = "worker"
cache = { enabled = true }
`;

let tempDirs: string[] = [];

// Run the CLI entrypoint without the tsx CLI's listening socket.
function runVerifier(cwd: string): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, ["--import", TSX_LOADER, resolve(API_DIR, SCRIPT)], { cwd, encoding: "utf8" });
}

function runInTemp(toml: string): ReturnType<typeof spawnSync> {
  const dir = mkdtempSync(join(tmpdir(), "verify-infra-"));
  tempDirs.push(dir);
  writeFileSync(join(dir, "wrangler.toml"), toml, "utf8");
  return runVerifier(dir);
}

describe("verify:infra script (T11)", () => {
  afterEach(() => {
    for (const d of tempDirs) {
      try {
        rmSync(d, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
    tempDirs = [];
  });

  it("exits 0 against the real api/wrangler.toml", () => {
    expect(manifest.scripts["verify:infra"].split(/\s+/)).toEqual(["tsx", SCRIPT]);
    const res = runVerifier(API_DIR);
    expect(res.status).toBe(0);
  });

  it("exits 0 against a synthetic well-formed wrangler.toml", () => {
    const res = runInTemp(GOOD_TOML);
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/verify:infra OK/);
  });

  it("rejects a missing production cache block", () => {
    const broken = GOOD_TOML.replace("[env.production.cache]\nenabled = true", "");
    const res = runInTemp(broken);
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain("[env.production.cache]");
  });

  it("exits non-zero when D1 database_name is wrong", () => {
    const broken = GOOD_TOML.replace(
      "kodigital-homepages-cms-db",
      "wrong-database-name",
    );
    const res = runInTemp(broken);
    expect(res.status).not.toBe(0);
    expect(res.stderr).toMatch(/d1-database-name/);
  });

  it("exits non-zero when R2 bucket_name is wrong", () => {
    const broken = GOOD_TOML.replace(
      "kodigital-homepages-cms-media",
      "wrong-bucket",
    );
    const res = runInTemp(broken);
    expect(res.status).not.toBe(0);
    expect(res.stderr).toMatch(/r2-bucket-name/);
  });

  it("exits non-zero when KV binding name is wrong", () => {
    const broken = GOOD_TOML.replace('binding = "CACHE"', 'binding = "WRONG_KV"');
    const res = runInTemp(broken);
    expect(res.status).not.toBe(0);
    expect(res.stderr).toMatch(/kv-binding-cache/);
  });

  it("exits non-zero when account_id is missing", () => {
    const broken = GOOD_TOML.replace(/^account_id\s*=.*$/m, "");
    const res = runInTemp(broken);
    expect(res.status).not.toBe(0);
    expect(res.stderr).toMatch(/account-id-present/);
  });

  it("exits non-zero when compatibility_date is missing", () => {
    const broken = GOOD_TOML.replace(/^compatibility_date\s*=.*$/m, "");
    const res = runInTemp(broken);
    expect(res.status).not.toBe(0);
    expect(res.stderr).toMatch(/compatibility-date-present/);
  });

  it("exits non-zero when CLOUDFLARE_API_TOKEN appears in wrangler.toml (runtime token must NOT be present)", () => {
    const broken =
      GOOD_TOML + '\n[vars]\nCLOUDFLARE_API_TOKEN = "should-not-be-here"\n';
    const res = runInTemp(broken);
    expect(res.status).not.toBe(0);
    expect(res.stderr).toMatch(/no-runtime-cloudflare-api-token/);
  });

  it("exits non-zero when staging worker name is missing", () => {
    const broken = GOOD_TOML.replace(
      'name = "kodigital-homepages-cms-worker-staging"',
      'name = "wrong-staging"',
    );
    const res = runInTemp(broken);
    expect(res.status).not.toBe(0);
    expect(res.stderr).toMatch(/worker-name-staging/);
  });
});
