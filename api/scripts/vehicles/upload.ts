#!/usr/bin/env tsx
// F18 Vehicle database — upload one snapshot to the CMS's R2 bucket (binding
// MEDIA) and, as a separate step, switch vehicles/live.json to it.
// Both remote steps are OWNER steps (backlog F18, Section 6 red lines).
//
// Default is a dry run: it only prints the wrangler commands it would run.
//
//   npx tsx scripts/vehicles/upload.ts --snapshot 2026-11-23 --env staging                 (print the plan)
//   npx tsx scripts/vehicles/upload.ts --snapshot 2026-11-23 --env staging --execute       (upload + read back + data totals)
//   npx tsx scripts/vehicles/upload.ts --snapshot 2026-11-23 --env staging --verify-only --execute
//   npx tsx scripts/vehicles/upload.ts --snapshot 2026-11-23 --env staging --switch-live --execute
//   npx tsx scripts/vehicles/upload.ts --snapshot 2026-11-23 --local --execute [--switch-live] [--persist-to <dir>]
//
// Options:
//   --snapshot <id>        the committed snapshot (scripts/vehicles/snapshots/<id>). Required.
//   --dir <folder>         read the snapshot from another folder instead.
//   --snapshots-dir <dir>  where committed snapshots live (default scripts/vehicles/snapshots); the guardrail reads the
//                          live snapshot's rows from here.
//   --env <name>           staging | production | default — whose MEDIA bucket (read from wrangler.toml). Required unless --local.
//   --local                use wrangler's local storage (for `wrangler dev`), never the real bucket.
//   --persist-to <dir>     local storage folder (with --local; default: wrangler's own .wrangler/state).
//   --execute              really run the commands. Without it nothing is run.
//   --verify-only          skip the upload; read the files back and show the data totals.
//   --switch-live          point vehicles/live.json at this snapshot — only if its checks pass and it removes
//                          at most 2% of the live snapshot's rows.
//   --approve-diff         a person reviewed diff-report.md and approves going over the 2% limit.
//   --assume-live <id>     dry run of --switch-live: which snapshot to treat as live (default: the newest older committed one).
//   --allow-failed-checks  upload even though a QA check fails (to measure it); never allowed for --switch-live.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  VEHICLE_LIVE_KEY,
  VEHICLE_R2_PREFIX,
  isSnapshotId,
  parseLivePointer,
  parseMakeFile,
  parseMakesFile,
  type VehicleManifest,
} from "../../src/leadgen/vehicles/format";
import {
  SNAPSHOTS_DIR,
  guardrail,
  loadSnapshot,
  loadSnapshotRows,
  runSnapshotChecks,
  snapshotDirOf,
  switchLive,
  type CheckResult,
  type LoadedSnapshot,
  type PointerStore,
} from "./checks";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const API_ROOT = path.resolve(SCRIPT_DIR, "..", "..");
export const WRANGLER_TOML = path.join(API_ROOT, "wrangler.toml");

// --- wrangler.toml: which bucket is MEDIA in each env ---------------------------------

/** MEDIA bucket name per env ("default" = the top-level config), read from wrangler.toml. Named envs don't inherit buckets. */
export function mediaBuckets(tomlText: string): Map<string, string> {
  const out = new Map<string, string>();
  let env: string | null = null;
  let block: Record<string, string> | null = null;
  const close = () => {
    if (env !== null && block && block["binding"] === "MEDIA" && block["bucket_name"]) out.set(env, block["bucket_name"]);
    env = null;
    block = null;
  };
  for (const rawLine of tomlText.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+#.*$/, "").trim();
    if (line === "" || line.startsWith("#")) continue;
    const header = /^\[\[?\s*([^\]]+?)\s*\]\]?$/.exec(line);
    if (header) {
      close();
      const name = header[1]!;
      if (name === "r2_buckets" && line.startsWith("[[")) {
        env = "default";
        block = {};
      } else {
        const m = /^env\.([A-Za-z0-9_-]+)\.r2_buckets$/.exec(name);
        if (m && line.startsWith("[[")) {
          env = m[1]!;
          block = {};
        }
      }
      continue;
    }
    if (block) {
      const kv = /^([A-Za-z0-9_]+)\s*=\s*"([^"]*)"$/.exec(line);
      if (kv) block[kv[1]!] = kv[2]!;
    }
  }
  close();
  return out;
}

// --- Commands ---------------------------------------------------------------------------

export interface Target {
  bucket: string;
  mode: "remote" | "local";
  persistTo?: string;
  label: string;
}

function locationFlags(t: Target): string[] {
  if (t.mode === "remote") return ["--remote"];
  return t.persistTo ? ["--local", "--persist-to", t.persistTo] : ["--local"];
}

export function putArgs(t: Target, key: string, file: string): string[] {
  return ["wrangler", "r2", "object", "put", `${t.bucket}/${key}`, "--file", file, "--content-type", "application/json", ...locationFlags(t)];
}

export function getArgs(t: Target, key: string, file: string): string[] {
  return ["wrangler", "r2", "object", "get", `${t.bucket}/${key}`, "--file", file, ...locationFlags(t)];
}

function shellQuote(a: string): string {
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`;
}

export function commandLine(args: string[]): string {
  return ["npx", ...args].map(shellQuote).join(" ");
}

/** The served files of a snapshot, upload order: make files, makes.json, and manifest.json LAST (its presence means "complete"). */
export function uploadPlan(s: LoadedSnapshot, t: Target): Array<{ key: string; file: string; args: string[] }> {
  const rels = [...Object.keys(s.manifest.files).filter((k) => k !== "makes.json").sort(), "makes.json", "manifest.json"];
  return rels.map((rel) => {
    const key = `${VEHICLE_R2_PREFIX}${s.snapshot}/${rel}`;
    const file = path.join(s.dir, rel);
    return { key, file, args: putArgs(t, key, file) };
  });
}

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function run(args: string[]): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn("npx", args, { cwd: API_ROOT, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

async function runOrThrow(args: string[]): Promise<void> {
  const r = await run(args);
  if (r.code !== 0) throw new Error(`command failed (${r.code}): ${commandLine(args)}\n${(r.stderr || r.stdout).trim().slice(-800)}`);
}

async function pool<T>(items: T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(size, items.length)) }, async () => {
    while (next < items.length) await fn(items[next++]!);
  });
  await Promise.all(workers);
}

const NOT_FOUND_RE = /does not exist|not found|NoSuchKey|\b10007\b/i;

/** Read one object back; null when it isn't there. */
async function readObject(t: Target, key: string, scratch: string): Promise<Buffer | null> {
  const file = path.join(scratch, createHash("sha256").update(key).digest("hex").slice(0, 16));
  rmSync(file, { force: true });
  const r = await run(getArgs(t, key, file));
  if (r.code !== 0) {
    if (NOT_FOUND_RE.test(r.stderr + r.stdout)) return null;
    throw new Error(`could not read ${t.bucket}/${key}: ${(r.stderr || r.stdout).trim().slice(-500)}`);
  }
  if (!existsSync(file)) return null;
  return readFileSync(file);
}

const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");

// --- Verify: what's in storage matches the script's output (data totals) -----------------

export interface Totals {
  makes: number;
  models: number;
  model_years: number;
  files: number;
  checksumsOk: number;
}

/** Counts from the served files themselves (makes listed, models listed, year→model links), not from the manifest. */
export function totalsFromServed(served: Map<string, Buffer>, manifest: VehicleManifest): Totals {
  const makes = parseMakesFile(JSON.parse(served.get("makes.json")?.toString("utf8") ?? "null"));
  let models = 0;
  let modelYears = 0;
  let checksumsOk = 0;
  for (const [rel, buf] of served) {
    if (manifest.files[rel] === sha(buf)) checksumsOk++;
    if (rel.startsWith("makes/")) {
      const f = parseMakeFile(JSON.parse(buf.toString("utf8")));
      if (f) {
        models += f.models.length;
        modelYears += f.years.reduce((n, y) => n + y.m.length, 0);
      }
    }
  }
  return { makes: makes?.makes.length ?? 0, models, model_years: modelYears, files: served.size, checksumsOk };
}

export function totalsTable(local: Totals, stored: Totals, manifestCounts: VehicleManifest["counts"]): string {
  const rows: Array<[string, number, number]> = [
    ["Makes", local.makes, stored.makes],
    ["Models", local.models, stored.models],
    ["Model-year rows", local.model_years, stored.model_years],
    ["Served files", local.files, stored.files],
    ["Files whose checksum matches manifest.json", local.checksumsOk, stored.checksumsOk],
  ];
  const lines = [
    "| What | Script output | In storage | Match |",
    "|---|---:|---:|:---:|",
    ...rows.map(([k, a, b]) => `| ${k} | ${a} | ${b} | ${a === b ? "yes" : "NO"} |`),
    `| manifest.json counts (makes / models / rows) | ${manifestCounts.makes} / ${manifestCounts.models} / ${manifestCounts.model_years} | (same file) | ${manifestCounts.makes === stored.makes && manifestCounts.models === stored.models && manifestCounts.model_years === stored.model_years ? "yes" : "NO"} |`,
  ];
  return lines.join("\n");
}

async function verifyInStorage(s: LoadedSnapshot, t: Target, scratch: string, concurrency: number): Promise<boolean> {
  const manifestKey = `${VEHICLE_R2_PREFIX}${s.snapshot}/manifest.json`;
  const storedManifest = await readObject(t, manifestKey, scratch);
  const localManifest = readFileSync(path.join(s.dir, "manifest.json"));
  if (!storedManifest) {
    process.stdout.write(`manifest.json is not in ${t.label}.\n`);
    return false;
  }
  if (!storedManifest.equals(localManifest)) {
    process.stdout.write(`manifest.json in ${t.label} differs from the local one.\n`);
    return false;
  }
  const stored = new Map<string, Buffer>();
  const missing: string[] = [];
  await pool(Object.keys(s.manifest.files).sort(), concurrency, async (rel) => {
    const b = await readObject(t, `${VEHICLE_R2_PREFIX}${s.snapshot}/${rel}`, scratch);
    if (b) stored.set(rel, b);
    else missing.push(rel);
  });
  const local = totalsFromServed(s.served, s.manifest);
  const inStore = totalsFromServed(stored, s.manifest);
  process.stdout.write(`\nData totals — snapshot ${s.snapshot}, ${t.label}:\n\n${totalsTable(local, inStore, s.manifest.counts)}\n\n`);
  if (missing.length) process.stdout.write(`Missing in storage: ${missing.sort().join(", ")}\n`);
  const ok =
    missing.length === 0 &&
    local.makes === inStore.makes &&
    local.models === inStore.models &&
    local.model_years === inStore.model_years &&
    inStore.files === Object.keys(s.manifest.files).length &&
    inStore.checksumsOk === inStore.files;
  process.stdout.write(ok ? "Storage matches the script's output.\n" : "Storage does NOT match the script's output.\n");
  return ok;
}

// --- Live pointer through wrangler ---------------------------------------------------------

function wranglerPointerStore(t: Target, scratch: string): PointerStore {
  return {
    async read() {
      const b = await readObject(t, VEHICLE_LIVE_KEY, scratch);
      if (!b) return null;
      let parsed: unknown;
      try {
        parsed = JSON.parse(b.toString("utf8"));
      } catch {
        throw new Error(`${VEHICLE_LIVE_KEY} in ${t.label} is not JSON; fix it by hand before switching`);
      }
      const p = parseLivePointer(parsed);
      if (!p) throw new Error(`${VEHICLE_LIVE_KEY} in ${t.label} is not {"snapshot":"<id>"}; fix it by hand before switching`);
      return p.snapshot;
    },
    async write(snapshot: string) {
      const file = path.join(scratch, "live.json");
      writeFileSync(file, JSON.stringify({ snapshot }), "utf8");
      await runOrThrow(putArgs(t, VEHICLE_LIVE_KEY, file));
      const back = await readObject(t, VEHICLE_LIVE_KEY, scratch);
      const p = back ? parseLivePointer(JSON.parse(back.toString("utf8"))) : null;
      if (!p || p.snapshot !== snapshot) throw new Error(`wrote ${VEHICLE_LIVE_KEY} but reading it back gave ${back?.toString("utf8") ?? "nothing"}`);
    },
  };
}

// --- CLI -----------------------------------------------------------------------------------------

interface Args {
  snapshot: string;
  dir?: string;
  snapshotsDir: string;
  env?: string;
  local: boolean;
  persistTo?: string;
  execute: boolean;
  verifyOnly: boolean;
  switchLive: boolean;
  approveDiff: boolean;
  assumeLive?: string;
  allowFailedChecks: boolean;
}

function parseArgs(argv: string[]): Args {
  const a: Partial<Args> = { snapshotsDir: SNAPSHOTS_DIR, local: false, execute: false, verifyOnly: false, switchLive: false, approveDiff: false, allowFailedChecks: false };
  const val = (i: number, f: string) => {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) throw new Error(`${f} needs a value`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const f = argv[i]!;
    switch (f) {
      case "--snapshot": a.snapshot = val(i, f); i++; break;
      case "--dir": a.dir = val(i, f); i++; break;
      case "--snapshots-dir": a.snapshotsDir = path.resolve(val(i, f)); i++; break;
      case "--env": a.env = val(i, f); i++; break;
      case "--local": a.local = true; break;
      case "--persist-to": a.persistTo = path.resolve(val(i, f)); i++; break;
      case "--execute": a.execute = true; break;
      case "--verify-only": a.verifyOnly = true; break;
      case "--switch-live": a.switchLive = true; break;
      case "--approve-diff": a.approveDiff = true; break;
      case "--assume-live": a.assumeLive = val(i, f); i++; break;
      case "--allow-failed-checks": a.allowFailedChecks = true; break;
      case "--help":
      case "-h":
        process.stdout.write(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1, 31).map((l) => l.replace(/^\/\/ ?/, "")).join("\n") + "\n");
        process.exit(0);
      default:
        throw new Error(`unknown option ${f} (try --help)`);
    }
  }
  if (!a.snapshot || !isSnapshotId(a.snapshot)) throw new Error("--snapshot <YYYY-MM-DD> is required");
  if (!a.local && !a.env) throw new Error("--env staging|production|default is required (or --local)");
  if (a.persistTo && !a.local) throw new Error("--persist-to only goes with --local");
  return a as Args;
}

function printChecks(results: CheckResult[]): boolean {
  for (const r of results) process.stdout.write(`  ${r.ok ? "PASS" : "FAIL"}  ${r.id.padEnd(9)} ${r.title}${r.ok ? "" : ` — ${r.details.join("; ")}`}\n`);
  return results.every((r) => r.ok);
}

async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  const buckets = mediaBuckets(readFileSync(WRANGLER_TOML, "utf8"));
  const envName = args.env ?? "default";
  const bucket = buckets.get(envName);
  if (!bucket) throw new Error(`wrangler.toml has no MEDIA bucket for env "${envName}" (found: ${[...buckets.keys()].join(", ")})`);
  const target: Target = args.local
    ? { bucket, mode: "local", persistTo: args.persistTo, label: `local storage${args.persistTo ? ` (${args.persistTo})` : ""}, bucket ${bucket}` }
    : { bucket, mode: "remote", label: `R2 bucket ${bucket} (env ${envName})` };
  const sharing = [...buckets.entries()].filter(([e, b]) => b === bucket && e !== envName).map(([e]) => e);
  if (!args.local && sharing.length) {
    process.stdout.write(
      `NOTE: env "${envName}" uses the same bucket as ${sharing.map((e) => `"${e}"`).join(", ")} (${bucket}). Snapshot files are shared, and so is ${VEHICLE_LIVE_KEY}: switching live here switches it for those envs too.\n\n`,
    );
  }

  const dir = args.dir ? path.resolve(args.dir) : snapshotDirOf(args.snapshot, args.snapshotsDir);
  const s = loadSnapshot(dir);
  if (s.snapshot !== args.snapshot) throw new Error(`${dir} holds snapshot ${s.snapshot}, not ${args.snapshot}`);
  if (/PARTIAL/.test(s.manifest.source_note)) throw new Error(`snapshot ${s.snapshot} is a PARTIAL build (--only-makes); it must never be uploaded`);
  process.stdout.write(`Snapshot ${s.snapshot}: ${s.manifest.counts.makes} makes, ${s.manifest.counts.models} models, ${s.manifest.counts.model_years} model-year rows, ${Object.keys(s.manifest.files).length} served files.\nTarget: ${target.label}${args.execute ? "" : " — DRY RUN (nothing runs; add --execute)"}\n\nQA checks:\n`);
  const checks = runSnapshotChecks(s);
  const checksOk = printChecks(checks);
  process.stdout.write("\n");
  const scratch = mkdtempSync(path.join(tmpdir(), "vehicles-upload-"));
  const concurrency = target.mode === "remote" ? 4 : 1;
  try {
    if (args.switchLive) return await doSwitch(args, s, target, checks, checksOk, scratch);
    if (!checksOk && !args.allowFailedChecks) {
      process.stdout.write("A QA check failed, so nothing is uploaded. Fix the snapshot, or pass --allow-failed-checks to upload it for measuring only.\n");
      return 1;
    }
    if (args.verifyOnly) {
      if (!args.execute) {
        process.stdout.write("Would read back every file of the snapshot and compare it with the local copy:\n");
        for (const p of uploadPlan(s, target)) process.stdout.write(`  ${commandLine(getArgs(target, p.key, "<temp file>"))}\n`);
        return 0;
      }
      return (await verifyInStorage(s, target, scratch, concurrency)) ? 0 : 1;
    }
    const plan = uploadPlan(s, target);
    if (!args.execute) {
      process.stdout.write(`Would check that vehicles/${s.snapshot}/manifest.json isn't already there with different content, then run (${plan.length} commands):\n`);
      for (const p of plan) process.stdout.write(`  ${commandLine(p.args)}\n`);
      process.stdout.write(`then read every file back and print the data totals.\n`);
      return 0;
    }
    // Snapshot ids are immutable (their answers are cached for a year): never overwrite a different upload.
    const existing = await readObject(target, `${VEHICLE_R2_PREFIX}${s.snapshot}/manifest.json`, scratch);
    if (existing && !existing.equals(readFileSync(path.join(s.dir, "manifest.json")))) {
      process.stdout.write(`vehicles/${s.snapshot}/ is already in ${target.label} with different content. Snapshot ids never change once uploaded; build a new id (e.g. ${s.snapshot.slice(0, 10)}-b).\n`);
      return 1;
    }
    if (existing) process.stdout.write(`vehicles/${s.snapshot}/manifest.json is already there and identical; re-uploading the same bytes.\n`);
    const files = plan.slice(0, -1);
    let done = 0;
    await pool(files, concurrency, async (p) => {
      await runOrThrow(p.args);
      done++;
      if (done % 20 === 0 || done === files.length) process.stdout.write(`  uploaded ${done}/${files.length}\n`);
    });
    await runOrThrow(plan[plan.length - 1]!.args);
    process.stdout.write(`  uploaded manifest.json\n`);
    return (await verifyInStorage(s, target, scratch, concurrency)) ? 0 : 1;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

async function doSwitch(args: Args, s: LoadedSnapshot, t: Target, checks: CheckResult[], checksOk: boolean, scratch: string): Promise<number> {
  const loadRows = (id: string) => {
    const d = path.join(args.snapshotsDir, id);
    return existsSync(path.join(d, "rows", "model_years.json")) ? loadSnapshotRows(d) : null;
  };
  if (!args.execute) {
    const assumed = args.assumeLive ?? previousCommitted(s.snapshot, args.snapshotsDir);
    process.stdout.write(`Would read ${VEHICLE_LIVE_KEY} from ${t.label}, confirm vehicles/${s.snapshot}/manifest.json there matches the local one, then:\n`);
    if (!checksOk) process.stdout.write("  REFUSE: a QA check failed (above).\n");
    if (assumed) {
      const rows = loadRows(assumed);
      if (!rows) process.stdout.write(`  (no committed rows for ${assumed}; the real run would refuse without --approve-diff)\n`);
      else {
        const g = guardrail(rows, s.rows);
        process.stdout.write(
          `  guardrail against ${assumed} (assumed live): ${g.removedRows} of ${g.previousRows} rows removed (${(g.removedShare * 100).toFixed(2)}%) → ${g.ok ? "within 2%" : args.approveDiff ? "over 2%, approved by --approve-diff" : "over 2%: REFUSE without --approve-diff"}\n`,
        );
      }
    } else process.stdout.write("  no older committed snapshot: the guardrail only applies when one is live.\n");
    const liveFile = "<temp>/live.json";
    process.stdout.write(`  ${commandLine(putArgs(t, VEHICLE_LIVE_KEY, liveFile))}   (content: {"snapshot":"${s.snapshot}"})\n`);
    return checksOk ? 0 : 1;
  }
  // The snapshot must be fully in storage before anything points at it.
  const stored = await readObject(t, `${VEHICLE_R2_PREFIX}${s.snapshot}/manifest.json`, scratch);
  if (!stored || !stored.equals(readFileSync(path.join(s.dir, "manifest.json")))) {
    process.stdout.write(`vehicles/${s.snapshot}/manifest.json is ${stored ? "different" : "missing"} in ${t.label}. Upload (and verify) the snapshot first. The live pointer was not touched.\n`);
    return 1;
  }
  const outcome = await switchLive({ store: wranglerPointerStore(t, scratch), next: s, loadRows, approveDiff: args.approveDiff, checks });
  if (outcome.guardrail) {
    const g = outcome.guardrail;
    process.stdout.write(`Guardrail against ${outcome.from}: ${g.removedRows} of ${g.previousRows} rows removed (${(g.removedShare * 100).toFixed(2)}%).\n`);
  }
  if (!outcome.switched) {
    process.stdout.write(`REFUSED — the live pointer stays at ${outcome.from ?? "(none)"}:\n${outcome.reasons.map((r) => `  - ${r}`).join("\n")}\n`);
    return 1;
  }
  process.stdout.write(`Live pointer switched: ${outcome.from ?? "(none)"} → ${outcome.to}.\n`);
  if (outcome.from) {
    const where = t.mode === "local" ? `--local${t.persistTo ? ` --persist-to ${shellQuote(t.persistTo)}` : ""}` : `--env ${args.env}`;
    process.stdout.write(`To roll back: npx tsx scripts/vehicles/upload.ts --snapshot ${outcome.from} ${where} --switch-live --approve-diff --execute\n`);
  }
  return 0;
}

function previousCommitted(id: string, snapshotsDir: string): string | null {
  if (!existsSync(snapshotsDir)) return null;
  const older = readdirSync(snapshotsDir)
    .filter((d) => isSnapshotId(d) && d < id && existsSync(path.join(snapshotsDir, d, "rows", "model_years.json")))
    .sort();
  return older[older.length - 1] ?? null;
}

const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e: unknown) => {
      process.stderr.write(`upload failed: ${e instanceof Error ? e.message : String(e)}\n`);
      process.exit(2);
    },
  );
}
