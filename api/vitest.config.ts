import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "cloudflare:workers": fileURLToPath(
        new URL("./test/cloudflare-workers-shim.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    globals: false,
    // T40: "verbose" prints one ✓ line PER TEST (default collapses a
    // passing file to a single summary line), so the evidence runner's
    // text parser observes real per-test names when binding
    // required-claim expected_test_name_regex patterns.
    reporters: "verbose",
    // Several test files (verify-script.test.ts, legacy-ref-allowlist.test.ts)
    // write fixture files under api/src/ that the verify:no-legacy-prod-refs
    // scanner walks. Running them in parallel files races their "clean repo"
    // assertions against another file's transient fixture. Disable
    // file-level parallelism so the scanner sees a stable filesystem.
    fileParallelism: false,
  },
});
