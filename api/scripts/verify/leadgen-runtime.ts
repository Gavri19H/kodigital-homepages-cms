#!/usr/bin/env tsx
/**
 * verify:leadgen-runtime — the 11 §11.1 CI gate for the hydration bundle
 * (03 §3.2 build row).
 *
 * Three checks, all mandatory, exit 1 on the first failure:
 *   1. FRESHNESS — rebuild the runtime with the exact build-script pipeline
 *      and byte-diff against the committed engine-bundle.generated.ts. A
 *      mismatch means someone edited runtime/* without re-running
 *      `npm run build:leadgen-runtime` (or hand-edited the generated file).
 *   2. SIZE — LEADGEN_RUNTIME_JS_BYTES ≤ 43008 (§3.1 "≤40KB minified", raised
 *      to 42KB by operator decision D4, 2026-07-16).
 *   3. TYPES — `tsc -p tsconfig.runtime.json --noEmit` (the browser-lib
 *      project covering ONLY src/public/leadgen/runtime/): the runtime
 *      modules are excluded from the worker tsconfig (no DOM lib there), so
 *      THIS is their typecheck gate.
 *
 * Wired into `verify:all` (package.json) per 11 §11.1.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildRuntimeBundle,
  readCommittedBundleSource,
  GENERATED_PATH,
  MAX_BUNDLE_BYTES,
} from "../build-leadgen-runtime";

const API_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function fail(message: string): never {
  console.error(`verify:leadgen-runtime FAIL — ${message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  // 1. Freshness: rebuild → byte-diff vs committed.
  const fresh = await buildRuntimeBundle();
  const committed = readCommittedBundleSource();
  if (committed === null) {
    fail(
      `missing generated bundle at ${GENERATED_PATH}. Run: npm run build:leadgen-runtime`,
    );
  }
  if (committed !== fresh.moduleSource) {
    fail(
      "committed engine-bundle.generated.ts is STALE (runtime/* changed without a rebuild, " +
        "or the file was hand-edited). Run: npm run build:leadgen-runtime — then commit the result.",
    );
  }
  console.log(`  freshness: OK (byte-identical rebuild)`);

  // 2. Size budget (§3.1).
  if (fresh.bytes > MAX_BUNDLE_BYTES) {
    fail(`bundle is ${fresh.bytes} bytes — over the ${MAX_BUNDLE_BYTES}-byte (§3.1) budget`);
  }
  console.log(
    `  size: OK (${fresh.bytes} bytes, ${(100 * (fresh.bytes / MAX_BUNDLE_BYTES)).toFixed(1)}% of budget)`,
  );

  // 3. Browser-lib typecheck of the runtime project.
  const localTsc = resolve(API_ROOT, "node_modules/.bin/tsc");
  const cmd = existsSync(localTsc) ? localTsc : "npx";
  const args = existsSync(localTsc)
    ? ["-p", "tsconfig.runtime.json", "--noEmit"]
    : ["tsc", "-p", "tsconfig.runtime.json", "--noEmit"];
  const tsc = spawnSync(cmd, args, { cwd: API_ROOT, stdio: "inherit" });
  if (tsc.status !== 0) {
    fail(`tsc -p tsconfig.runtime.json --noEmit exited ${tsc.status ?? "signal"}`);
  }
  console.log("  types: OK (tsc -p tsconfig.runtime.json)");
  console.log("verify:leadgen-runtime PASS");
}

main().catch((err) => {
  fail(err instanceof Error ? err.message : String(err));
});
