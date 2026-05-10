import { describe, it, expect, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const API_DIR = resolve(__dirname, "..");
const SCRIPT_PATH = resolve(API_DIR, "scripts/verify/infra-contract.ts");
const TSX_BIN = resolve(API_DIR, "node_modules/.bin/tsx");

const GOOD_TOML = `name = "kodigital-homepages-cms-worker"
main = "src/index.ts"
compatibility_date = "2026-05-06"
account_id = "abc123"

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

[env.production]
name = "kodigital-homepages-cms-worker"
`;

let tempDirs: string[] = [];

function runInTemp(toml: string): ReturnType<typeof spawnSync> {
  const dir = mkdtempSync(join(tmpdir(), "verify-infra-"));
  tempDirs.push(dir);
  writeFileSync(join(dir, "wrangler.toml"), toml, "utf8");
  return spawnSync(TSX_BIN, [SCRIPT_PATH], { cwd: dir, encoding: "utf8" });
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
    const res = spawnSync(
      "npm",
      ["run", "--silent", "verify:infra"],
      { cwd: API_DIR, encoding: "utf8" },
    );
    expect(res.status).toBe(0);
  });

  it("exits 0 against a synthetic well-formed wrangler.toml", () => {
    const res = runInTemp(GOOD_TOML);
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/verify:infra OK/);
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
