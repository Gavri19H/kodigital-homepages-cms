// Phase 5 / T22 regression: the four contract verification commands
// MUST all exit 0 against the current repository state. Together they
// pin Phase 1.5 / Phase 5 invariants:
//
//   T22.AC1 — `npx tsc --noEmit`                  (typecheck clean)
//   T22.AC2 — `npm run verify:no-legacy-prod-refs` (no banned legacy
//             production identifiers — Group A + Group B)
//   T22.AC3 — `npm run verify:infra`              (wrangler.toml matches
//             the Phase 1.5 infra contract — D1/R2/KV/account/compat)
//   T22.AC4 — `npm run verify:worker-config`      (wrangler.toml [vars]
//             routing contract — ADMIN_HOST/BASE_URL/dry-run flags)
//
// All four are deterministic, idempotent, side-effect-free commands.
// If any one exits non-zero a Phase 5 contract is regressed and this
// test fails — the merge MUST NOT happen until the offending verify
// script is green again.
//
// Why a single regression file? T22's acceptance contract is "all four
// commands exit 0 on the current tree" (per prd.json / required
// evidence plan RC-065..RC-068). Each is already covered by a deeper
// behavioral suite (verify-script.test.ts, infra-verify.test.ts,
// worker-config-verify.test.ts); this file adds the cross-cutting
// "they all still pass right now" guarantee that ship gates read.

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const API_DIR = resolve(__dirname, "..");

// tsc on a worker codebase can take ~30-60s in CI. Each spawn gets a
// generous ceiling so a slow runner does not produce a flaky FAIL.
const COMMAND_TIMEOUT_MS = 240_000;

function runNpm(script: string) {
  return spawnSync("npm", ["run", "--silent", script], {
    cwd: API_DIR,
    encoding: "utf8",
    timeout: COMMAND_TIMEOUT_MS,
  });
}

describe("verify-scripts-green", () => {
  it("tsc-noEmit exits 0 (T22.AC1 — typecheck clean)", () => {
    const res = spawnSync(
      "npx",
      ["tsc", "--noEmit"],
      {
        cwd: API_DIR,
        encoding: "utf8",
        timeout: COMMAND_TIMEOUT_MS,
      },
    );
    if (res.status !== 0) {
      // Surface the typecheck output so a failing run is debuggable.
      // eslint-disable-next-line no-console
      console.error(
        "tsc --noEmit failed:\nSTDOUT:\n" +
          (res.stdout ?? "") +
          "\nSTDERR:\n" +
          (res.stderr ?? ""),
      );
    }
    expect(res.status).toBe(0);
  }, COMMAND_TIMEOUT_MS);

  it("verify-no-legacy-prod-refs exits 0 (T22.AC2)", () => {
    const res = runNpm("verify:no-legacy-prod-refs");
    if (res.status !== 0) {
      // eslint-disable-next-line no-console
      console.error(
        "verify:no-legacy-prod-refs failed:\nSTDOUT:\n" +
          (res.stdout ?? "") +
          "\nSTDERR:\n" +
          (res.stderr ?? ""),
      );
    }
    expect(res.status).toBe(0);
  }, COMMAND_TIMEOUT_MS);

  it("verify-infra exits 0 (T22.AC3)", () => {
    const res = runNpm("verify:infra");
    if (res.status !== 0) {
      // eslint-disable-next-line no-console
      console.error(
        "verify:infra failed:\nSTDOUT:\n" +
          (res.stdout ?? "") +
          "\nSTDERR:\n" +
          (res.stderr ?? ""),
      );
    }
    expect(res.status).toBe(0);
  }, COMMAND_TIMEOUT_MS);

  it("verify-worker-config exits 0 (T22.AC4)", () => {
    const res = runNpm("verify:worker-config");
    if (res.status !== 0) {
      // eslint-disable-next-line no-console
      console.error(
        "verify:worker-config failed:\nSTDOUT:\n" +
          (res.stdout ?? "") +
          "\nSTDERR:\n" +
          (res.stderr ?? ""),
      );
    }
    expect(res.status).toBe(0);
  }, COMMAND_TIMEOUT_MS);
});
