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

  it("catches each of the 5 T13 legacy CMS identifiers added to the denylist", () => {
    // Concatenated so this test file does not itself contain the literal
    // banned strings (the scanner would otherwise flag this file).
    const t13BannedTokens = [
      "kodigital2." + "cloudflareaccess.com",
      "admin." + "theiw" + "ise.com",
      "7542d73ba678850e7ec62797f0ffb6e5e" + "5279b6e57bd1f34ac372f04a4ded425",
      "44c73f76-6ed5-4b26-b442-" + "6c2044326c4d",
      "111320b080274cfd" + "8465e89400712c5d",
    ];
    for (const token of t13BannedTokens) {
      writeFileSync(
        FIXTURE_PATH,
        `test fixture: this file intentionally references ${token}.\n`,
        "utf8",
      );
      const res = runVerifyScript();
      expect(res.status).not.toBe(0);
      expect(res.stderr).toContain("__verify-test-fixture.txt");
      rmSync(FIXTURE_PATH);
    }
  });
});
