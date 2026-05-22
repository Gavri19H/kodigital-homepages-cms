import { describe, it, expect, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const API_DIR = resolve(__dirname, "..");
const REPO_ROOT = resolve(API_DIR, "..");

// Build banned tokens by concatenation so this test file itself never
// contains a literal banned identifier (the verify scanner walks every
// .test.ts file, and only the runtime denylist module + approved docs
// are on the Group B allowlist).
const GROUP_B_TOKEN = "theiw" + "ise.com";
const GROUP_A_UUID = "44c73f76-6ed5-" + "4b26-b442-6c2044326c4d";
const GROUP_A_WORKER = "a2z-cf-" + "cms-v1-api";
const GROUP_A_DB = "a2z-cf-" + "cms-v1-db";
const GROUP_A_INSUREPRIMO = "insure" + "primo";
const GROUP_A_QUOTES_ROUTES = "quotes" + "Routes";
const GROUP_A_PSYCHIC_QUIZ = "psychic" + "-quiz";
const GROUP_A_RENTAL_BOOKING = "rental" + "-booking";
const GROUP_A_KV_NS = "111320b080274cfd" + "8465e89400712c5d";
const GROUP_A_CF_ACCESS_AUD =
  "7542d73ba678850e7ec62797f0ffb6e5e" + "5279b6e57bd1f34ac372f04a4ded425";

// The full set of forbidden identifiers enumerated in
// docs/no-touch-red-line.md (the canonical no-touch boundary). Used by
// the T24 Phase-7 source-file assertion below.
const FORBIDDEN_TOKENS: readonly string[] = [
  GROUP_B_TOKEN,
  GROUP_A_WORKER,
  GROUP_A_DB,
  GROUP_A_INSUREPRIMO,
  GROUP_A_QUOTES_ROUTES,
  GROUP_A_PSYCHIC_QUIZ,
  GROUP_A_RENTAL_BOOKING,
  GROUP_A_UUID,
  GROUP_A_KV_NS,
  GROUP_A_CF_ACCESS_AUD,
];

// Phase-7 new source files. ZERO of the FORBIDDEN_TOKENS may appear in
// any of these files. Paths are repo-root relative.
const PHASE_7_NEW_SOURCE_FILES: readonly string[] = [
  "api/src/cache/cache-keys.ts",
  "api/src/cache/edge-cache.ts",
  "api/src/cache/purge.ts",
  "api/src/cache/warm.ts",
  "api/src/cache/invalidate.ts",
  "api/src/public/templates/seo-head.ts",
  "api/src/public/templates/jsonld-article.ts",
  "api/src/public/templates/jsonld-home-category-page.ts",
  "api/src/db/query.ts",
  "api/migrations/0009_phase7_content_version_and_indexes.sql",
];

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

describe("Phase-7 new source files contain ZERO forbidden identifiers (T24)", () => {
  for (const rel of PHASE_7_NEW_SOURCE_FILES) {
    it(`${rel} contains zero forbidden identifiers from no-touch-red-line.md`, () => {
      const abs = resolve(REPO_ROOT, rel);
      expect(existsSync(abs)).toBe(true);
      const content = readFileSync(abs, "utf8");
      for (const token of FORBIDDEN_TOKENS) {
        expect(
          content.includes(token),
          `${rel} contains forbidden token "${token}"`,
        ).toBe(false);
      }
    });
  }
});
