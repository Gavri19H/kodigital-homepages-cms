import { describe, it, expect, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const API_DIR = resolve(__dirname, "..");
const SCRIPT_PATH = resolve(API_DIR, "scripts/verify/worker-config.ts");
const TSX_BIN = resolve(API_DIR, "node_modules/.bin/tsx");

const GOOD_TOML = `name = "kodigital-homepages-cms-worker"

[vars]
APP_ENV = "development"
ADMIN_HOST = "localhost"
ADMIN_BASE_URL = "http://localhost:8787"
ADMIN_BASE_PATH = "/admin"
CACHE_API_ENABLED = "true"
HTML_CACHE_TTL_SECONDS = "60"
OPENAI_TEXT_MODEL = "gpt-5.5"
OPENAI_IMAGE_MODEL = "gpt-image-2"
SITE_PROVISIONING_DRY_RUN = "true"
SITE_PROVISIONING_ALLOW_ROUTE_MUTATION = "false"

[env.staging.vars]
APP_ENV = "staging"
ADMIN_HOST = "staging-cms.kodigital.app"
ADMIN_BASE_URL = "https://staging-cms.kodigital.app"
ADMIN_BASE_PATH = "/admin"
SITE_PROVISIONING_DRY_RUN = "true"
SITE_PROVISIONING_ALLOW_ROUTE_MUTATION = "false"
HTML_CACHE_TTL_SECONDS = "60"

[env.production.vars]
APP_ENV = "production"
ADMIN_HOST = "cms.kodigital.app"
ADMIN_BASE_URL = "https://cms.kodigital.app"
ADMIN_BASE_PATH = "/admin"
SITE_PROVISIONING_DRY_RUN = "true"
SITE_PROVISIONING_ALLOW_ROUTE_MUTATION = "false"
HTML_CACHE_TTL_SECONDS = "300"
`;

let tempDirs: string[] = [];

function runInTemp(toml: string): ReturnType<typeof spawnSync> {
  const dir = mkdtempSync(join(tmpdir(), "verify-worker-config-"));
  tempDirs.push(dir);
  writeFileSync(join(dir, "wrangler.toml"), toml, "utf8");
  return spawnSync(TSX_BIN, [SCRIPT_PATH], { cwd: dir, encoding: "utf8" });
}

describe("verify:worker-config script (T11)", () => {
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
      ["run", "--silent", "verify:worker-config"],
      { cwd: API_DIR, encoding: "utf8" },
    );
    expect(res.status).toBe(0);
  });

  it("exits 0 against a synthetic well-formed wrangler.toml", () => {
    const res = runInTemp(GOOD_TOML);
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/verify:worker-config OK/);
  });

  it("exits non-zero when production ADMIN_HOST is not cms.kodigital.app", () => {
    const broken = GOOD_TOML.replace(
      'ADMIN_HOST = "cms.kodigital.app"',
      'ADMIN_HOST = "wrong-host.example"',
    );
    const res = runInTemp(broken);
    expect(res.status).not.toBe(0);
    expect(res.stderr).toMatch(/ADMIN_HOST/);
  });

  it("exits non-zero when staging ADMIN_HOST is not staging-cms.kodigital.app", () => {
    const broken = GOOD_TOML.replace(
      'ADMIN_HOST = "staging-cms.kodigital.app"',
      'ADMIN_HOST = "wrong-staging.example"',
    );
    const res = runInTemp(broken);
    expect(res.status).not.toBe(0);
    expect(res.stderr).toMatch(/staging/);
  });

  it("exits non-zero when ADMIN_BASE_PATH is not '/admin'", () => {
    const broken = GOOD_TOML.replace(
      /ADMIN_BASE_PATH = "\/admin"/g,
      'ADMIN_BASE_PATH = "/wrong"',
    );
    const res = runInTemp(broken);
    expect(res.status).not.toBe(0);
    expect(res.stderr).toMatch(/ADMIN_BASE_PATH/);
  });

  it("exits non-zero when [env.production.vars] block is missing", () => {
    const broken = GOOD_TOML.replace(
      /\[env\.production\.vars\][\s\S]*$/,
      "",
    );
    const res = runInTemp(broken);
    expect(res.status).not.toBe(0);
    expect(res.stderr).toMatch(/env\.production\.vars/);
  });

  it("exits non-zero when SITE_PROVISIONING_DRY_RUN is missing from production", () => {
    const broken = GOOD_TOML.replace(
      /\[env\.production\.vars\][\s\S]*$/,
      `[env.production.vars]
APP_ENV = "production"
ADMIN_HOST = "cms.kodigital.app"
ADMIN_BASE_URL = "https://cms.kodigital.app"
ADMIN_BASE_PATH = "/admin"
SITE_PROVISIONING_ALLOW_ROUTE_MUTATION = "false"
HTML_CACHE_TTL_SECONDS = "300"
`,
    );
    const res = runInTemp(broken);
    expect(res.status).not.toBe(0);
    expect(res.stderr).toMatch(/SITE_PROVISIONING_DRY_RUN/);
  });

  it("exits non-zero when HTML_CACHE_TTL_SECONDS is missing", () => {
    const broken = GOOD_TOML.replace(
      /^HTML_CACHE_TTL_SECONDS\s*=.*$/gm,
      "",
    );
    const res = runInTemp(broken);
    expect(res.status).not.toBe(0);
    expect(res.stderr).toMatch(/HTML_CACHE_TTL_SECONDS/);
  });
});
