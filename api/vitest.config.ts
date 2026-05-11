import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    globals: false,
    reporters: "default",
    // Several test files (verify-script.test.ts, legacy-ref-allowlist.test.ts)
    // write fixture files under api/src/ that the verify:no-legacy-prod-refs
    // scanner walks. Running them in parallel files races their "clean repo"
    // assertions against another file's transient fixture. Disable
    // file-level parallelism so the scanner sees a stable filesystem.
    fileParallelism: false,
  },
});
