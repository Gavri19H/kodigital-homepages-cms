/**
 * Locates the SIBLING `kodigital-conversions` repository (Conversions Core).
 *
 * Several CMS test files prove CMS<->Core parity against Core's REAL artifacts
 * (its generated admin contracts, its D1 migrations, its security/destination
 * runtime modules). Core lives in a SEPARATE git repository, so those artifacts
 * are not in this repo and are not checked out by CI (`.github/workflows/
 * deploy.yml` runs a single `actions/checkout@v4` of this repo only).
 *
 * Those files used to hardcode `../../../kodigital-conversions/...`, which only
 * resolves when this repo happens to sit next to a Core checkout — true in the
 * original Conversions working copy, false in every mission worktree and false
 * in CI, where it produced hard collection failures rather than honest skips.
 *
 * Resolution here is independent of where this worktree lives:
 *   1. `CONVERSIONS_CORE_ROOT` env var, if set (absolute or cwd-relative);
 *   2. otherwise walk UP from this file, testing `<ancestor>/kodigital-conversions`
 *      at every level — which still finds the sibling checkout in the original
 *      layout, from any depth.
 * A candidate only counts if MARKER exists inside it, so a partial or
 * same-named unrelated directory is rejected rather than half-loaded.
 *
 * When Core is absent, `HAS_CONVERSIONS_CORE` is false and the dependent suites
 * skip with an explicit reason instead of failing. What a skip costs is stated
 * per call site, next to the `skipIf`.
 */
import { existsSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** Presence marker: a file that only a real Core checkout has. */
const MARKER = "packages/security/protected-port-authority.mjs";

function locateCoreRoot(): string | null {
  const override = process.env.CONVERSIONS_CORE_ROOT;
  if (override !== undefined && override !== "") {
    const root = isAbsolute(override) ? override : resolve(process.cwd(), override);
    return existsSync(resolve(root, MARKER)) ? root : null;
  }
  let dir = import.meta.dirname;
  for (;;) {
    const candidate = resolve(dir, "kodigital-conversions");
    if (existsSync(resolve(candidate, MARKER))) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export const CONVERSIONS_CORE_ROOT: string | null = locateCoreRoot();
export const HAS_CONVERSIONS_CORE: boolean = CONVERSIONS_CORE_ROOT !== null;

/** Absolute path to a file inside the Core checkout. Throws if Core is absent. */
export function corePath(relative: string): string {
  if (CONVERSIONS_CORE_ROOT === null) {
    throw new Error(
      "Conversions Core checkout not found. Set CONVERSIONS_CORE_ROOT to a " +
        "kodigital-conversions checkout, or place one beside this repository.",
    );
  }
  return resolve(CONVERSIONS_CORE_ROOT, relative);
}

/** `file://` URL for a file inside the Core checkout. Throws if Core is absent. */
export function coreUrl(relative: string): URL {
  return pathToFileURL(corePath(relative));
}

/**
 * Dynamically imports a Core ESM module by Core-relative path.
 *
 * Typed `any` deliberately, and NOT a loosening: Core's `.mjs` modules ship no
 * type declarations, so every call site already reached them through a
 * `// @ts-expect-error sibling ... intentionally untyped ESM` static/dynamic
 * import. This centralises that one suppression instead of repeating it.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function importCore(relative: string): Promise<any> {
  return import(/* @vite-ignore */ coreUrl(relative).href);
}
