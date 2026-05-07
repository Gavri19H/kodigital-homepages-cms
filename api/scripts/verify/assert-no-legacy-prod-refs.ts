#!/usr/bin/env tsx
/**
 * verify:no-legacy-prod-refs
 *
 * Banned-string scanner for legacy TheIWise production identifiers.
 *
 * Invocation: `cd api && npm run verify:no-legacy-prod-refs`
 * (this script lives at api/scripts/verify/assert-no-legacy-prod-refs.ts
 *  and is run via tsx from the api/ directory; it walks the repo root
 *  one level up from cwd).
 *
 * Exits non-zero if any banned identifier appears in an active source
 * file. Stderr names every offending file:line so CI logs are actionable.
 *
 * Allow-listed identifiers (NOT banned, intentionally referenced in this
 * repo): the Cloudflare account UUID 44c73f76-6ed5-4b26-b442-6c2044326c4d
 * is shared between this project (kodigital-homepages-cms) and the
 * sibling project a2z-cf-cms-v1, and is allowed in wrangler.toml, CI
 * workflows, docs, and this verify script.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const REPO_ROOT = resolve(process.cwd(), "..");

const BANNED_IDENTIFIERS: readonly string[] = [
  "theiwise.com",
  "a2z-cf-cms-v1-api",
  "a2z-cf-cms-v1-db",
  "insureprimo",
  "quotesRoutes",
  "psychic-quiz",
  "rental-booking",
];

// Directories skipped entirely (matched by name at any depth). Keeps
// node_modules and other generated/scaffold trees out of the scan.
const EXCLUDED_DIRS: readonly string[] = [
  "node_modules",
  ".git",
  ".wrangler",
  ".a2z",
  "dist",
  "coverage",
  "build",
  "acceptance-tests",
];

// Files (relative to repo root) that legitimately contain banned
// identifiers and must NOT trigger a failure: legacy reference docs and
// this verify script itself, plus mission-scaffold metadata.
const EXCLUDED_FILES: readonly string[] = [
  "docs/source-architecture.md",
  "docs/no-touch-red-line.md",
  "docs/reference/current-theiwise-technical-spec.md",
  "api/scripts/verify/assert-no-legacy-prod-refs.ts",
  "prd.json",
  "progress.txt",
];

const TEXT_EXT_RE =
  /\.(ts|tsx|js|jsx|mjs|cjs|json|jsonc|toml|yml|yaml|md|txt|html|css|sh|sql|env|example)$/i;

function* walk(dir: string): Generator<string> {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (EXCLUDED_DIRS.includes(name)) continue;
    const full = join(dir, name);
    let s: ReturnType<typeof statSync>;
    try {
      s = statSync(full);
    } catch {
      continue;
    }
    if (s.isDirectory()) {
      yield* walk(full);
    } else if (s.isFile() && TEXT_EXT_RE.test(name)) {
      yield full;
    }
  }
}

interface Offender {
  file: string;
  banned: string;
  line: number;
}

const offenders: Offender[] = [];

for (const fullPath of walk(REPO_ROOT)) {
  const rel = relative(REPO_ROOT, fullPath);
  if (EXCLUDED_FILES.includes(rel)) continue;
  let content: string;
  try {
    content = readFileSync(fullPath, "utf8");
  } catch {
    continue;
  }
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    for (const banned of BANNED_IDENTIFIERS) {
      if (line.includes(banned)) {
        offenders.push({ file: rel, banned, line: i + 1 });
      }
    }
  }
}

if (offenders.length > 0) {
  console.error(
    "verify:no-legacy-prod-refs FAILED — banned legacy production identifiers found:",
  );
  for (const o of offenders) {
    console.error(`  ${o.file}:${o.line} -> "${o.banned}"`);
  }
  console.error(`\nTotal offending lines: ${offenders.length}`);
  process.exit(1);
}

console.log(
  "verify:no-legacy-prod-refs OK -- no banned legacy production identifiers found.",
);
process.exit(0);
