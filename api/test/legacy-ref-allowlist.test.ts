import { describe, it, expect, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { writeFileSync, existsSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const API_DIR = resolve(__dirname, "..");

// Build banned tokens by concatenation so this test file itself never
// contains a literal banned identifier (the verify scanner walks every
// .test.ts file, and only the runtime denylist module + approved docs
// are on the Group B allowlist).
const GROUP_B_TOKEN = "theiw" + "ise.com";
const GROUP_A_UUID = "44c73f76-6ed5-" + "4b26-b442-6c2044326c4d";
const GROUP_A_WORKER = "a2z-cf-" + "cms-v1-api";

const FIXTURE_SRC = resolve(API_DIR, "src", "__legacy-allowlist-fixture.txt");

function runVerify(): ReturnType<typeof spawnSync> {
  return spawnSync(
    "npm",
    ["run", "--silent", "verify:no-legacy-prod-refs"],
    { cwd: API_DIR, encoding: "utf8" },
  );
}

function cleanupFixtures() {
  if (existsSync(FIXTURE_SRC)) rmSync(FIXTURE_SRC);
}

describe("verify:no-legacy-prod-refs Group A / Group B allowlist behavior (T10)", () => {
  afterEach(() => {
    cleanupFixtures();
  });

  it("exits 0 on a clean repo — protected-domains.ts legitimately contains the Group B literal", () => {
    cleanupFixtures();
    const res = runVerify();
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/verify:no-legacy-prod-refs OK/);
  });

  it("exits 1 with Group B tag and offending file:line when a non-allowed file contains the protected hostname", () => {
    writeFileSync(
      FIXTURE_SRC,
      `legacy-allowlist fixture: this file intentionally references ${GROUP_B_TOKEN} to verify the scanner.\n`,
      "utf8",
    );
    const res = runVerify();
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain("__legacy-allowlist-fixture.txt");
    expect(res.stderr).toContain("[Group B]");
  });

  it("exits 1 with Group A tag when a non-allowed file contains the legacy account UUID", () => {
    writeFileSync(
      FIXTURE_SRC,
      `legacy-allowlist fixture: account ${GROUP_A_UUID} should not appear outside approved docs.\n`,
      "utf8",
    );
    const res = runVerify();
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain("__legacy-allowlist-fixture.txt");
    expect(res.stderr).toContain("[Group A]");
  });

  it("exits 1 with Group A tag for legacy TheIWise Worker name", () => {
    writeFileSync(
      FIXTURE_SRC,
      `legacy-allowlist fixture: ${GROUP_A_WORKER} must not appear here.\n`,
      "utf8",
    );
    const res = runVerify();
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain("[Group A]");
    expect(res.stderr).toContain(GROUP_A_WORKER);
  });

  it("offender output names the line number", () => {
    writeFileSync(
      FIXTURE_SRC,
      `line 1: harmless\nline 2: also harmless\nline 3: ${GROUP_B_TOKEN}\n`,
      "utf8",
    );
    const res = runVerify();
    expect(res.status).not.toBe(0);
    expect(res.stderr).toMatch(/__legacy-allowlist-fixture\.txt:3/);
  });
});
