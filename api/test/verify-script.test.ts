import { describe, it, expect, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { writeFileSync, existsSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const API_DIR = resolve(__dirname, "..");
const FIXTURE_PATH = resolve(API_DIR, "src", "__verify-test-fixture.txt");

function runVerifyScript() {
  return spawnSync(
    "npm",
    ["run", "--silent", "verify:no-legacy-prod-refs"],
    { cwd: API_DIR, encoding: "utf8" },
  );
}

describe("verify:no-legacy-prod-refs script", () => {
  afterEach(() => {
    if (existsSync(FIXTURE_PATH)) rmSync(FIXTURE_PATH);
  });

  it("exits 0 on a clean repo (no banned identifiers in active files)", () => {
    if (existsSync(FIXTURE_PATH)) rmSync(FIXTURE_PATH);
    const res = runVerifyScript();
    expect(res.status).toBe(0);
  });

  it("exits non-zero and names the offending file on stderr when a banned identifier is present", () => {
    // Build the banned token via concatenation so this test file itself
    // does NOT contain the literal banned string (the scanner walks the
    // entire repo including this test file).
    const bannedToken = "theiw" + "ise.com";
    writeFileSync(
      FIXTURE_PATH,
      `test fixture: this file intentionally references ${bannedToken} to verify the scanner.\n`,
      "utf8",
    );
    const res = runVerifyScript();
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain("__verify-test-fixture.txt");
  });
});
