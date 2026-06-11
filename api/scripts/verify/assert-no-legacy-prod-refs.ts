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
 * Two-group structure (T10):
 *
 *   GROUP A — legacy resource identifiers (TheIWise project names + the
 *   shared Cloudflare account UUID). Allowed ONLY in approved legacy
 *   reference docs, the verifier's own source, and mission scaffold
 *   (prd.json, progress.txt). There is no global allowlist for the
 *   account UUID — every file that legitimately contains it must appear
 *   in GROUP_A_ALLOWED_FILES.
 *
 *   GROUP B — protected production hostnames (TheIWise customer-facing
 *   domains). Allowed everywhere Group A is allowed, PLUS the runtime
 *   denylist module api/src/safety/protected-domains.ts, which is the
 *   one production-code location where these literals must appear so
 *   the Worker can refuse to operate on them at request time.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const REPO_ROOT = resolve(process.cwd(), "..");

// Group A — legacy resource identifiers. The shared Cloudflare account
// UUID 44c73f76-6ed5-4b26-b442-6c2044326c4d is INCLUDED here: T10
// removes the prior global allowlist so the UUID can only appear in
// approved docs (and this verifier's own source). T24 adds the legacy
// CF Access AUD claim and the legacy KV namespace id so the full set
// of identifiers enumerated in docs/no-touch-red-line.md is enforced.
const GROUP_A_BANNED: readonly string[] = [
  "a2z-cf-cms-v1-api",
  "a2z-cf-cms-v1-db",
  "insureprimo",
  "quotesRoutes",
  "psychic-quiz",
  "rental-booking",
  "44c73f76-6ed5-4b26-b442-6c2044326c4d",
  "111320b080274cfd8465e89400712c5d",
  "7542d73ba678850e7ec62797f0ffb6e5e5279b6e57bd1f34ac372f04a4ded425",
];

// Group B — protected production hostnames. Substring `theiwise.com`
// also catches `www.theiwise.com`, `staging.theiwise.com`, and
// `app.theiwise.com` (the four canonical protected hostnames declared
// in api/src/safety/protected-domains.ts).
const GROUP_B_BANNED: readonly string[] = [
  "theiwise.com",
];

// Files (relative to repo root) that legitimately contain Group A
// identifiers: legacy reference docs + this verifier + mission scaffold.
// implementation_digest.{md,json} are typed-contract artifacts dropped
// into the worktree by the architect; they enumerate the same legacy
// identifiers as RED-LINE forbidden substitutes and therefore belong on
// the same allowlist as prd.json / progress.txt / GUARDRAILS.md.
// api/src/ai/schemas.ts owns the Phase 6 BANNED_LEGACY_REFS denylist used
// by validateGeneratedArticle to REJECT AI-generated content referencing
// these tokens (mirrors the Group B allowance for protected-domains.ts);
// api/test/ai-schemas.test.ts is its rejection-path test.
const GROUP_A_ALLOWED_FILES: readonly string[] = [
  "docs/source-architecture.md",
  "docs/no-touch-red-line.md",
  "docs/reference/current-theiwise-technical-spec.md",
  "api/scripts/verify/assert-no-legacy-prod-refs.ts",
  "api/src/ai/schemas.ts",
  "api/test/ai-schemas.test.ts",
  "prd.json",
  "progress.txt",
  "GUARDRAILS.md",
  "implementation_digest.md",
  "implementation_digest.json",
  // cms-rescue-2 mission docs (story A1): the rescue brief + decoded design
  // contract + ship handoff docs reference legacy identifiers as red lines.
  "docs/RESCUE_RESET_CONTEXT.md",
  "docs/MISSION-CMS-RESCUE-2.md",
  "docs/design-contract.md",
  "SHIP_HANDOFF.md",
  "manualQA.md",
];

// Files that legitimately contain Group B identifiers: everything in
// Group A's allowlist PLUS the runtime denylist module that implements
// the protected-domains safety check, PLUS the unit tests that exercise
// that module (they must pass the literal protected hostnames as
// inputs to verify the denylist refuses them).
const GROUP_B_ALLOWED_FILES: readonly string[] = [
  ...GROUP_A_ALLOWED_FILES,
  "api/src/safety/protected-domains.ts",
  "api/test/protected-domains.test.ts",
  "api/test/purge-safety.test.ts",
];

// Directories skipped entirely (matched by name at any depth). Keeps
// node_modules and other generated/scaffold trees out of the scan.
const EXCLUDED_DIRS: readonly string[] = [
  "node_modules",
  ".git",
  ".wrangler",
  ".a2z",
  ".ralph",
  "openspec",
  "dist",
  "coverage",
  "build",
  "acceptance-tests",
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
  group: "A" | "B";
  line: number;
}

const offenders: Offender[] = [];

for (const fullPath of walk(REPO_ROOT)) {
  const rel = relative(REPO_ROOT, fullPath);
  let content: string;
  try {
    content = readFileSync(fullPath, "utf8");
  } catch {
    continue;
  }
  const lines = content.split("\n");
  const inGroupA = GROUP_A_ALLOWED_FILES.includes(rel);
  const inGroupB = GROUP_B_ALLOWED_FILES.includes(rel);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (!inGroupA) {
      for (const banned of GROUP_A_BANNED) {
        if (line.includes(banned)) {
          offenders.push({ file: rel, banned, group: "A", line: i + 1 });
        }
      }
    }
    if (!inGroupB) {
      for (const banned of GROUP_B_BANNED) {
        if (line.includes(banned)) {
          offenders.push({ file: rel, banned, group: "B", line: i + 1 });
        }
      }
    }
  }
}

if (offenders.length > 0) {
  console.error(
    "verify:no-legacy-prod-refs FAILED — banned legacy production identifiers found:",
  );
  for (const o of offenders) {
    console.error(`  [Group ${o.group}] ${o.file}:${o.line} -> "${o.banned}"`);
  }
  console.error(`\nTotal offending lines: ${offenders.length}`);
  process.exit(1);
}

console.log(
  "verify:no-legacy-prod-refs OK -- no banned legacy production identifiers found (Group A + Group B).",
);
process.exit(0);
