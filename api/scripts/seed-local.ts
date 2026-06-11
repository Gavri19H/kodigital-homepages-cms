#!/usr/bin/env tsx
// [G1] seed:local — deterministic local D1 seed (brief BCL-024:
// deterministic proof only).
//
// Builds the fixture SQL with buildSeedSql() (pure, fixed literals — see
// scripts/seed/seed-fixture.ts) and applies it to the LOCAL wrangler D1
// database. No network calls of any kind happen in this process; the only
// side effects are one generated .sql file under .wrangler/ (gitignored)
// and the wrangler child process that executes it against local SQLite.
//
// Usage:
//   npm run db:migrate:local   # once, so the tables exist
//   npm run seed:local         # idempotent — safe to re-run any time
//   npm run seed:local -- --print   # print the SQL instead of executing
//
// After seeding, `npm run dev` serves the fixture site on
// http://localhost:8787/ (the seed maps hostname 'localhost' to the
// seed site, filling every Home bucket).

import { mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSeedSql } from "./seed/seed-sql";

const DB_NAME = "kodigital-homepages-cms-db";

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sql = buildSeedSql();

if (process.argv.includes("--print")) {
  process.stdout.write(sql);
  process.exit(0);
}

const outDir = path.join(apiRoot, ".wrangler");
mkdirSync(outDir, { recursive: true });
const sqlPath = path.join(outDir, "seed-local.generated.sql");
writeFileSync(sqlPath, sql, "utf8");

const result = spawnSync(
  "npx",
  ["wrangler", "d1", "execute", DB_NAME, "--local", `--file=${sqlPath}`],
  { cwd: apiRoot, stdio: "inherit" },
);

if (result.error !== undefined) {
  console.error(`seed:local failed to spawn wrangler: ${result.error.message}`);
  console.error(`SQL was written to ${sqlPath}; apply it manually with:`);
  console.error(`  npx wrangler d1 execute ${DB_NAME} --local --file=${sqlPath}`);
  process.exit(1);
}

if (result.status !== 0) {
  console.error(
    "seed:local: wrangler exited non-zero. If tables are missing, run " +
      "`npm run db:migrate:local` first.",
  );
}
process.exit(result.status ?? 1);
