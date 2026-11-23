#!/usr/bin/env tsx
// F18 Vehicle database — QA checks, the 2% guardrail, the diff report and the
// live-switch gate (backlog F18, part B). Library + CLI.
//
//   npx tsx scripts/vehicles/checks.ts 2026-11-23
//   npx tsx scripts/vehicles/checks.ts 2026-11-23 --previous 2025-10-06
//   npx tsx scripts/vehicles/checks.ts 2026-11-23 --same-source-as <other snapshot folder>   (AC5)
//   npx tsx scripts/vehicles/checks.ts 2026-11-23 --ac6                                       (AC6)
//
// Options:
//   <snapshot id or folder>      the snapshot to check (an id means scripts/vehicles/snapshots/<id>).
//   --previous <id|folder|none>  run the 2% guardrail against this snapshot (default: newest older committed one).
//   --same-source-as <folder>    AC5: a second build from the same saved source; model_ids and the diff must match.
//   --ac6                        AC6: a made-up copy missing 5% of rows must be refused and the live pointer must stay.
//
// Exit code 0 only when every check passes.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import {
  MODEL_ID_RE,
  VEHICLE_MAX_REMOVED_SHARE,
  VEHICLE_MIN_MODEL_YEAR,
  isSnapshotId,
  modelsForYear,
  parseMakeFile,
  parseMakesFile,
  slugifyMakeName,
  yearsOf,
  type VehicleMakeFile,
  type VehicleMakesFile,
  type VehicleManifest,
  type VehicleSnapshotMake,
  type VehicleSnapshotModel,
  type VehicleSnapshotModelYear,
} from "../../src/leadgen/vehicles/format";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const SNAPSHOTS_DIR = path.join(SCRIPT_DIR, "snapshots");

// --- Shared shapes -----------------------------------------------------------------

/** Something the ingest could not confirm or a person should look at; listed in the diff report. */
export interface ReviewFlag {
  kind: string;
  message: string;
  make_id?: number;
}

/** The spec's data model (§5), as committed under rows/. */
export interface SnapshotRows {
  makes: VehicleSnapshotMake[];
  models: VehicleSnapshotModel[];
  model_years: VehicleSnapshotModelYear[];
}

/** The featured makes the funnel's Make cards start with (owner decision Q8). A missing one fails the checks. */
export const FEATURED_MAKES = ["Toyota", "Honda", "Ford", "Chevrolet", "Nissan", "Jeep", "Hyundai", "Kia"] as const;

/** Deterministic "A→Z ignoring case" (no locale tables, so every machine sorts alike). */
export function compareNames(a: string, b: string): number {
  const fa = a.toLowerCase();
  const fb = b.toLowerCase();
  if (fa !== fb) return fa < fb ? -1 : 1;
  return a === b ? 0 : a < b ? -1 : 1;
}

/** The served files (lookups L1, L2 + L3) built from the full rows. */
export function servedFiles(snapshot: string, rows: SnapshotRows): { makesFile: VehicleMakesFile; makeFiles: VehicleMakeFile[] } {
  const makesFile: VehicleMakesFile = {
    snapshot,
    makes: [...rows.makes]
      .sort((a, b) => compareNames(a.display_name, b.display_name) || a.make_id - b.make_id)
      .map((m) => ({ make_id: m.make_id, name: m.display_name, slug: m.slug })),
  };
  const modelsByMake = new Map<number, VehicleSnapshotModel[]>();
  for (const m of rows.models) {
    const list = modelsByMake.get(m.make_id) ?? [];
    list.push(m);
    modelsByMake.set(m.make_id, list);
  }
  const yearsByMake = new Map<number, VehicleSnapshotModelYear[]>();
  for (const y of rows.model_years) {
    const list = yearsByMake.get(y.make_id) ?? [];
    list.push(y);
    yearsByMake.set(y.make_id, list);
  }
  const makeFiles: VehicleMakeFile[] = [];
  for (const mk of makesFile.makes) {
    const models = [...(modelsByMake.get(mk.make_id) ?? [])].sort(
      (a, b) => compareNames(a.display_name, b.display_name) || (a.model_id < b.model_id ? -1 : 1),
    );
    const index = new Map(models.map((m, i) => [m.model_id, i]));
    const byYear = new Map<number, Set<number>>();
    for (const y of yearsByMake.get(mk.make_id) ?? []) {
      const i = index.get(y.model_id);
      if (i === undefined) throw new Error(`model_years row ${y.make_id}/${y.model_year} points to unknown model ${y.model_id}`);
      const set = byYear.get(y.model_year) ?? new Set<number>();
      set.add(i);
      byYear.set(y.model_year, set);
    }
    makeFiles.push({
      snapshot,
      make_id: mk.make_id,
      models: models.map((m) => ({ model_id: m.model_id, name: m.display_name })),
      years: [...byYear.entries()].sort((a, b) => b[0] - a[0]).map(([year, set]) => ({ year, m: [...set].sort((x, z) => x - z) })),
    });
  }
  return { makesFile, makeFiles };
}

// --- Loading a snapshot folder --------------------------------------------------------

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, "utf8"));
}

export function loadSnapshotRows(dir: string): SnapshotRows {
  return {
    makes: readJson(path.join(dir, "rows", "makes.json")) as VehicleSnapshotMake[],
    models: readJson(path.join(dir, "rows", "models.json")) as VehicleSnapshotModel[],
    model_years: readJson(path.join(dir, "rows", "model_years.json")) as VehicleSnapshotModelYear[],
  };
}

export interface LoadedSnapshot {
  dir: string;
  snapshot: string;
  manifest: VehicleManifest;
  makesFile: VehicleMakesFile | null;
  makeFiles: Map<number, VehicleMakeFile | null>;
  /** Exact bytes of every served file on disk, keyed by path under the snapshot folder. */
  served: Map<string, Buffer>;
  rows: SnapshotRows;
}

/** An id means scripts/vehicles/snapshots/<id>; anything else is a folder path. */
export function snapshotDirOf(idOrDir: string, snapshotsDir = SNAPSHOTS_DIR): string {
  return isSnapshotId(idOrDir) && !existsSync(idOrDir) ? path.join(snapshotsDir, idOrDir) : path.resolve(idOrDir);
}

export function loadSnapshot(dir: string): LoadedSnapshot {
  if (!existsSync(path.join(dir, "manifest.json"))) throw new Error(`no manifest.json in ${dir}`);
  const manifest = readJson(path.join(dir, "manifest.json")) as VehicleManifest;
  const served = new Map<string, Buffer>();
  if (existsSync(path.join(dir, "makes.json"))) served.set("makes.json", readFileSync(path.join(dir, "makes.json")));
  const makeFiles = new Map<number, VehicleMakeFile | null>();
  const makesDir = path.join(dir, "makes");
  if (existsSync(makesDir)) {
    for (const f of readdirSync(makesDir).sort()) {
      const buf = readFileSync(path.join(makesDir, f));
      served.set(`makes/${f}`, buf);
      const m = /^(\d+)\.json$/.exec(f);
      if (m) {
        let parsed: VehicleMakeFile | null = null;
        try {
          parsed = parseMakeFile(JSON.parse(buf.toString("utf8")));
        } catch {
          parsed = null;
        }
        makeFiles.set(Number(m[1]), parsed);
      }
    }
  }
  let makesFile: VehicleMakesFile | null = null;
  const mb = served.get("makes.json");
  if (mb) {
    try {
      makesFile = parseMakesFile(JSON.parse(mb.toString("utf8")));
    } catch {
      makesFile = null;
    }
  }
  return { dir, snapshot: manifest.snapshot, manifest, makesFile, makeFiles, served, rows: loadSnapshotRows(dir) };
}

/** A snapshot held in memory (the ingest's result, or a made-up one for AC6), in the same shape as a loaded folder. */
export function snapshotFromRows(snapshot: string, rows: SnapshotRows, meta?: Partial<VehicleManifest>): LoadedSnapshot {
  const { makesFile, makeFiles } = servedFiles(snapshot, rows);
  const served = new Map<string, Buffer>();
  served.set("makes.json", Buffer.from(JSON.stringify(makesFile)));
  for (const f of makeFiles) served.set(`makes/${f.make_id}.json`, Buffer.from(JSON.stringify(f)));
  const files: Record<string, string> = {};
  for (const k of [...served.keys()].sort()) files[k] = createHash("sha256").update(served.get(k)!).digest("hex");
  return {
    dir: "(in memory)",
    snapshot,
    manifest: {
      snapshot,
      created_at: meta?.created_at ?? new Date(0).toISOString(),
      source_note: meta?.source_note ?? "in memory",
      counts: { makes: rows.makes.length, models: rows.models.length, model_years: rows.model_years.length },
      files,
    },
    makesFile,
    makeFiles: new Map(makeFiles.map((f) => [f.make_id, f])),
    served,
    rows,
  };
}

// --- The diff -------------------------------------------------------------------------

export interface SnapshotDiff {
  previous: string | null;
  next: string;
  makesAdded: VehicleSnapshotMake[];
  makesRemoved: VehicleSnapshotMake[];
  makesRenamed: Array<{ make_id: number; from: string; to: string }>;
  modelsAdded: VehicleSnapshotModel[];
  modelsRemoved: VehicleSnapshotModel[];
  modelsRenamed: Array<{ model_id: string; make_id: number; from: string; to: string }>;
  typesChanged: Array<{ make_id: number; model_year: number; model_id: string; from: string; to: string }>;
  yearCounts: Array<{ year: number; previous: number; next: number }>;
  rowsPrevious: number;
  rowsNext: number;
  rowsAdded: number;
  rowsRemoved: number;
  /** Share of the previous snapshot's (make, year, model) rows that are gone. */
  removedShare: number;
  /** (make, year, model) rows per make that were removed, for the report. */
  removedRowsByModel: Map<string, number[]>;
  addedRowsByModel: Map<string, number[]>;
  /** True when nothing differs (AC5). */
  empty: boolean;
}

const rowKey = (r: VehicleSnapshotModelYear) => `${r.make_id}|${r.model_year}|${r.model_id}`;

export function diffSnapshots(prev: SnapshotRows | null, next: SnapshotRows, prevId: string | null, nextId: string): SnapshotDiff {
  const p: SnapshotRows = prev ?? { makes: [], models: [], model_years: [] };
  const pMakes = new Map(p.makes.map((m) => [m.make_id, m]));
  const nMakes = new Map(next.makes.map((m) => [m.make_id, m]));
  const pModels = new Map(p.models.map((m) => [m.model_id, m]));
  const nModels = new Map(next.models.map((m) => [m.model_id, m]));
  const pRows = new Map(p.model_years.map((r) => [rowKey(r), r]));
  const nRows = new Map(next.model_years.map((r) => [rowKey(r), r]));
  const byName = (a: { display_name: string }, b: { display_name: string }) => compareNames(a.display_name, b.display_name);

  const makesAdded = next.makes.filter((m) => !pMakes.has(m.make_id)).sort(byName);
  const makesRemoved = p.makes.filter((m) => !nMakes.has(m.make_id)).sort(byName);
  const makesRenamed = next.makes
    .filter((m) => pMakes.has(m.make_id) && pMakes.get(m.make_id)!.display_name !== m.display_name)
    .map((m) => ({ make_id: m.make_id, from: pMakes.get(m.make_id)!.display_name, to: m.display_name }));
  const modelsAdded = next.models.filter((m) => !pModels.has(m.model_id));
  const modelsRemoved = p.models.filter((m) => !nModels.has(m.model_id));
  const modelsRenamed = next.models
    .filter((m) => pModels.has(m.model_id) && pModels.get(m.model_id)!.display_name !== m.display_name)
    .map((m) => ({ model_id: m.model_id, make_id: m.make_id, from: pModels.get(m.model_id)!.display_name, to: m.display_name }));
  const typesChanged: SnapshotDiff["typesChanged"] = [];
  let rowsRemoved = 0;
  let rowsAdded = 0;
  const removedRowsByModel = new Map<string, number[]>();
  const addedRowsByModel = new Map<string, number[]>();
  for (const [k, r] of pRows) {
    const n = nRows.get(k);
    if (!n) {
      rowsRemoved++;
      const list = removedRowsByModel.get(r.model_id) ?? [];
      list.push(r.model_year);
      removedRowsByModel.set(r.model_id, list);
    } else if (n.vehicle_types !== r.vehicle_types) {
      typesChanged.push({ make_id: r.make_id, model_year: r.model_year, model_id: r.model_id, from: r.vehicle_types, to: n.vehicle_types });
    }
  }
  for (const [k, r] of nRows) {
    if (!pRows.has(k)) {
      rowsAdded++;
      const list = addedRowsByModel.get(r.model_id) ?? [];
      list.push(r.model_year);
      addedRowsByModel.set(r.model_id, list);
    }
  }
  const years = new Set<number>([...p.model_years, ...next.model_years].map((r) => r.model_year));
  const countBy = (rows: VehicleSnapshotModelYear[]) => {
    const c = new Map<number, number>();
    for (const r of rows) c.set(r.model_year, (c.get(r.model_year) ?? 0) + 1);
    return c;
  };
  const pc = countBy(p.model_years);
  const nc = countBy(next.model_years);
  const yearCounts = [...years].sort((a, b) => b - a).map((year) => ({ year, previous: pc.get(year) ?? 0, next: nc.get(year) ?? 0 }));
  const empty =
    prev !== null &&
    makesAdded.length === 0 &&
    makesRemoved.length === 0 &&
    makesRenamed.length === 0 &&
    modelsAdded.length === 0 &&
    modelsRemoved.length === 0 &&
    modelsRenamed.length === 0 &&
    typesChanged.length === 0 &&
    rowsAdded === 0 &&
    rowsRemoved === 0 &&
    next.makes.every((m) => {
      const o = pMakes.get(m.make_id);
      return o !== undefined && o.slug === m.slug && o.min_year === m.min_year && o.max_year === m.max_year;
    });
  return {
    previous: prevId,
    next: nextId,
    makesAdded,
    makesRemoved,
    makesRenamed,
    modelsAdded,
    modelsRemoved,
    modelsRenamed,
    typesChanged,
    yearCounts,
    rowsPrevious: p.model_years.length,
    rowsNext: next.model_years.length,
    rowsAdded,
    rowsRemoved,
    removedShare: p.model_years.length === 0 ? 0 : rowsRemoved / p.model_years.length,
    removedRowsByModel,
    addedRowsByModel,
    empty,
  };
}

// --- The 2% guardrail -------------------------------------------------------------

export interface GuardrailResult {
  previousRows: number;
  removedRows: number;
  removedShare: number;
  limit: number;
  ok: boolean;
}

/** Refuses (ok=false) when the new snapshot removes MORE than 2% of the previous one's (make, year, model) rows. */
export function guardrail(prev: SnapshotRows, next: SnapshotRows, limit = VEHICLE_MAX_REMOVED_SHARE): GuardrailResult {
  const nextKeys = new Set(next.model_years.map(rowKey));
  let removed = 0;
  for (const r of prev.model_years) if (!nextKeys.has(rowKey(r))) removed++;
  const share = prev.model_years.length === 0 ? 0 : removed / prev.model_years.length;
  return { previousRows: prev.model_years.length, removedRows: removed, removedShare: share, limit, ok: share <= limit };
}

/** A made-up copy of a snapshot with `share` of its (make, year, model) rows removed (every n-th row, so it is repeatable). */
export function dropShareOfRows(rows: SnapshotRows, share: number): SnapshotRows {
  const total = rows.model_years.length;
  const drop = Math.ceil(total * share);
  const step = total / drop;
  const gone = new Set<number>();
  for (let k = 0; k < drop; k++) gone.add(Math.floor(k * step));
  const model_years = rows.model_years.filter((_r, i) => !gone.has(i));
  const usedModels = new Set(model_years.map((r) => r.model_id));
  const models = rows.models.filter((m) => usedModels.has(m.model_id));
  const usedMakes = new Set(model_years.map((r) => r.make_id));
  const makes = rows.makes.filter((m) => usedMakes.has(m.make_id));
  return { makes, models, model_years };
}

// --- QA checks (AC1–AC4, featured makes, file integrity, sizes) -------------------------

export interface CheckResult {
  id: string;
  title: string;
  ok: boolean;
  details: string[];
}

export const AC1_TOYOTA_2023 = [
  "4Runner", "bZ4X", "Camry", "Corolla", "Corolla Cross", "Crown", "GR Corolla", "GR86", "Highlander", "Mirai",
  "Prius", "Prius Prime", "RAV4", "RAV4 Prime", "Sequoia", "Sienna", "Supra", "Tacoma", "Tundra", "Venza",
];
export const AC2_FORD_2023_INCLUDES = [
  "Bronco", "Bronco Sport", "Edge", "Escape", "Expedition", "Explorer", "F-150", "Maverick", "Mustang", "Mustang Mach-E", "Ranger", "Transit",
];
export const AC2_FORD_2023_EXCLUDES = ["Bradford Built", "'34", "Classic Sedan", "Commercial Chassis", "Motorhome Chassis"];
const TOYOTA = 448;
const FORD = 460;
const TESLA = 441;
/** AC10 budgets, gzipped bytes. */
export const TOYOTA_GZ_BUDGET = 5 * 1024;
export const P95_GZ_BUDGET = 8 * 1024;

export interface SizeStats {
  makesJsonBytes: number;
  makesJsonGz: number;
  toyotaBytes: number | null;
  toyotaGz: number | null;
  p95Gz: number;
  p95MakeId: number | null;
  maxGz: number;
  maxMakeId: number | null;
  servedBytes: number;
}

const gz = (b: Buffer) => gzipSync(b).length;

export function sizeStats(s: LoadedSnapshot): SizeStats {
  const makes = s.served.get("makes.json") ?? Buffer.alloc(0);
  const per: Array<{ id: number; gz: number }> = [];
  let servedBytes = 0;
  for (const [k, b] of s.served) {
    servedBytes += b.length;
    const m = /^makes\/(\d+)\.json$/.exec(k);
    if (m) per.push({ id: Number(m[1]), gz: gz(b) });
  }
  per.sort((a, b) => a.gz - b.gz || a.id - b.id);
  const rank = per.length === 0 ? -1 : Math.ceil(0.95 * per.length) - 1;
  const toyota = s.served.get(`makes/${TOYOTA}.json`);
  return {
    makesJsonBytes: makes.length,
    makesJsonGz: makes.length ? gz(makes) : 0,
    toyotaBytes: toyota ? toyota.length : null,
    toyotaGz: toyota ? gz(toyota) : null,
    p95Gz: rank >= 0 ? per[rank]!.gz : 0,
    p95MakeId: rank >= 0 ? per[rank]!.id : null,
    maxGz: per.length ? per[per.length - 1]!.gz : 0,
    maxMakeId: per.length ? per[per.length - 1]!.id : null,
    servedBytes,
  };
}

function modelNamesFor(s: LoadedSnapshot, makeId: number, year: number): string[] | null {
  const f = s.makeFiles.get(makeId);
  if (!f) return null;
  return modelsForYear(f, year).map((m) => m.name);
}

function setDiff(actual: string[], expected: string[]): { missing: string[]; extra: string[] } {
  const a = new Set(actual);
  const e = new Set(expected);
  return { missing: expected.filter((x) => !a.has(x)), extra: actual.filter((x) => !e.has(x)) };
}

export function runSnapshotChecks(s: LoadedSnapshot): CheckResult[] {
  const out: CheckResult[] = [];
  out.push(checkIntegrity(s));

  // Featured makes (owner decision Q8): each must exist by name.
  {
    const names = new Set((s.makesFile?.makes ?? []).map((m) => m.name));
    const missing = FEATURED_MAKES.filter((n) => !names.has(n));
    out.push({
      id: "FEATURED",
      title: `Featured makes present (${FEATURED_MAKES.join(", ")})`,
      ok: missing.length === 0,
      details: missing.length ? [`missing: ${missing.join(", ")}`] : [],
    });
  }

  // AC1 — Toyota 2023 is exactly the 20 models.
  {
    const names = modelNamesFor(s, TOYOTA, 2023);
    const d = names ? setDiff(names, AC1_TOYOTA_2023) : null;
    const ok = names !== null && names.length === AC1_TOYOTA_2023.length && d!.missing.length === 0 && d!.extra.length === 0;
    out.push({
      id: "AC1",
      title: "Toyota 2023 returns exactly the 20 listed models",
      ok,
      details: names === null ? ["Toyota (make_id 448) is not in the snapshot"] : ok ? [`${names.length} models: ${names.join(", ")}`] : [
        `got ${names.length}: ${names.join(", ")}`,
        ...(d!.missing.length ? [`missing: ${d!.missing.join(", ")}`] : []),
        ...(d!.extra.length ? [`not expected: ${d!.extra.join(", ")}`] : []),
      ],
    });
  }

  // AC2 — Ford 2023 includes / excludes.
  {
    const names = modelNamesFor(s, FORD, 2023);
    const missing = names ? AC2_FORD_2023_INCLUDES.filter((n) => !names.includes(n)) : AC2_FORD_2023_INCLUDES;
    const present = names ? AC2_FORD_2023_EXCLUDES.filter((n) => names.some((x) => x.toLowerCase() === n.toLowerCase())) : [];
    const ok = names !== null && missing.length === 0 && present.length === 0;
    out.push({
      id: "AC2",
      title: "Ford 2023 includes the 12 listed models and none of the 5 excluded names",
      ok,
      details: names === null ? ["Ford (make_id 460) is not in the snapshot"] : [
        `Ford 2023 (${names.length}): ${names.join(", ")}`,
        ...(missing.length ? [`missing: ${missing.join(", ")}`] : []),
        ...(present.length ? [`should not be there: ${present.join(", ")}`] : []),
      ],
    });
  }

  // AC3 — Tesla: no year before 2008, no 2009.
  {
    const f = s.makeFiles.get(TESLA);
    const ys = f ? yearsOf(f) : null;
    const bad = ys ? ys.filter((y) => y < 2008 || y === 2009) : [];
    out.push({
      id: "AC3",
      title: "Tesla has no year before 2008 and no 2009",
      ok: ys !== null && bad.length === 0,
      details: ys === null ? ["Tesla (make_id 441) is not in the snapshot"] : [`Tesla years: ${ys.join(", ")}`, ...(bad.length ? [`not allowed: ${bad.join(", ")}`] : [])],
    });
  }

  // AC4 — no company suffixes; Zoox, Cruise, Iveco, Chanje absent.
  {
    const makes = s.makesFile?.makes ?? [];
    const suffix = makes.filter((m) => /\b(llc|inc|corporation|limited)\b/i.test(m.name)).map((m) => m.name);
    const banned = makes.filter((m) => /\b(zoox|cruise|iveco|chanje)\b/i.test(m.name)).map((m) => m.name);
    const rowNames = s.rows.makes.filter((m) => /\b(llc|inc|corporation|limited)\b/i.test(m.display_name)).map((m) => m.display_name);
    out.push({
      id: "AC4",
      title: 'No make name has "LLC", "Inc", "Corporation" or "Limited"; Zoox, Cruise, Iveco, Chanje absent',
      ok: suffix.length === 0 && banned.length === 0 && rowNames.length === 0,
      details: [
        ...(suffix.length || rowNames.length ? [`company suffix: ${[...new Set([...suffix, ...rowNames])].join(", ")}`] : []),
        ...(banned.length ? [`should be absent: ${banned.join(", ")}`] : []),
      ],
    });
  }

  // AC10 — sizes (measured here so a refresh that blows the budget is caught before upload).
  {
    const st = sizeStats(s);
    const ok = st.toyotaGz !== null && st.toyotaGz < TOYOTA_GZ_BUDGET && st.p95Gz < P95_GZ_BUDGET;
    out.push({
      id: "AC10",
      title: "Toyota answer < 5 KB gzipped; 95th-percentile make < 8 KB gzipped",
      ok,
      details: [
        `makes.json ${st.makesJsonBytes} B (${st.makesJsonGz} B gzipped)`,
        `Toyota ${st.toyotaBytes ?? "-"} B (${st.toyotaGz ?? "-"} B gzipped)`,
        `95th percentile ${st.p95Gz} B gzipped (make ${st.p95MakeId}); largest ${st.maxGz} B gzipped (make ${st.maxMakeId})`,
      ],
    });
  }
  return out;
}

/** Files, checksums, counts, order and cross-references all agree. */
export function checkIntegrity(s: LoadedSnapshot): CheckResult {
  const errs: string[] = [];
  const err = (m: string) => {
    if (errs.length < 40) errs.push(m);
  };
  const id = s.snapshot;
  const newest = Number(String(id).slice(0, 4)) + 1;
  if (!isSnapshotId(id)) err(`manifest snapshot "${id}" is not a snapshot id`);
  // A folder named like a snapshot must hold that snapshot (other names are scratch builds, e.g. an AC5 rerun).
  const folder = path.basename(s.dir);
  if (s.dir !== "(in memory)" && isSnapshotId(folder) && folder !== id) err(`folder name ${folder} ≠ manifest snapshot ${id}`);
  if (!s.makesFile) err("makes.json is missing or not in the expected shape");
  else if (s.makesFile.snapshot !== id) err(`makes.json snapshot ${s.makesFile.snapshot} ≠ ${id}`);

  // Manifest ↔ files on disk.
  const listed = Object.keys(s.manifest.files ?? {}).sort();
  const onDisk = [...s.served.keys()].sort();
  for (const f of listed) if (!s.served.has(f)) err(`manifest lists ${f} but the file is missing`);
  for (const f of onDisk) if (!(f in (s.manifest.files ?? {}))) err(`${f} is on disk but not in manifest.json`);
  for (const [f, buf] of s.served) {
    const want = s.manifest.files?.[f];
    if (want && createHash("sha256").update(buf).digest("hex") !== want) err(`${f}: checksum does not match manifest.json`);
  }
  const c = s.manifest.counts;
  if (!c || c.makes !== s.rows.makes.length || c.models !== s.rows.models.length || c.model_years !== s.rows.model_years.length) {
    err(`manifest counts ${JSON.stringify(c)} ≠ rows (${s.rows.makes.length}/${s.rows.models.length}/${s.rows.model_years.length})`);
  }

  // Rows are self-consistent.
  const makeIds = new Set<number>();
  const slugs = new Set<string>();
  for (const m of s.rows.makes) {
    if (makeIds.has(m.make_id)) err(`make ${m.make_id} listed twice`);
    makeIds.add(m.make_id);
    if (m.slug !== slugifyMakeName(m.display_name)) err(`make ${m.make_id} slug "${m.slug}" ≠ slug of "${m.display_name}"`);
    if (slugs.has(m.slug)) err(`slug "${m.slug}" used twice`);
    slugs.add(m.slug);
  }
  const modelIds = new Map<string, VehicleSnapshotModel>();
  const folds = new Set<string>();
  for (const m of s.rows.models) {
    if (!MODEL_ID_RE.test(m.model_id)) err(`model_id "${m.model_id}" does not match ${MODEL_ID_RE}`);
    if (modelIds.has(m.model_id)) err(`model_id ${m.model_id} listed twice`);
    modelIds.set(m.model_id, m);
    if (!makeIds.has(m.make_id)) err(`model ${m.model_id} belongs to unknown make ${m.make_id}`);
    const fk = `${m.make_id}|${m.display_name.toLowerCase()}`;
    if (folds.has(fk)) err(`make ${m.make_id} has two models named "${m.display_name}" (ignoring case)`);
    folds.add(fk);
    if (m.display_name !== m.display_name.trim() || /\s{2,}/.test(m.display_name) || m.display_name === "") err(`model ${m.model_id} name "${m.display_name}" is not clean`);
  }
  const rowSeen = new Set<string>();
  const yearsByMake = new Map<number, number[]>();
  for (const r of s.rows.model_years) {
    const k = rowKey(r);
    if (rowSeen.has(k)) err(`model_years row ${k} listed twice`);
    rowSeen.add(k);
    const mod = modelIds.get(r.model_id);
    if (!mod) err(`model_years row ${k} points to unknown model`);
    else if (mod.make_id !== r.make_id) err(`model_years row ${k}: model belongs to make ${mod.make_id}`);
    if (r.model_year < VEHICLE_MIN_MODEL_YEAR || r.model_year > newest) err(`model_years row ${k}: year outside ${VEHICLE_MIN_MODEL_YEAR}–${newest}`);
    if (!/^(car|mpv|truck)(,(mpv|truck))?(,truck)?$/.test(r.vehicle_types)) err(`model_years row ${k}: vehicle_types "${r.vehicle_types}"`);
    const ys = yearsByMake.get(r.make_id) ?? [];
    ys.push(r.model_year);
    yearsByMake.set(r.make_id, ys);
  }
  for (const m of s.rows.makes) {
    const ys = yearsByMake.get(m.make_id) ?? [];
    if (ys.length === 0) err(`make ${m.make_id} has no model years`);
    else if (Math.min(...ys) !== m.min_year || Math.max(...ys) !== m.max_year) err(`make ${m.make_id} min/max year ${m.min_year}/${m.max_year} ≠ its rows`);
  }

  // Served files are exactly what the rows produce (same bytes), sorted as promised.
  const expected = servedFiles(id, s.rows);
  if (s.makesFile && JSON.stringify(s.makesFile) !== JSON.stringify(expected.makesFile)) err("makes.json does not match rows/makes.json (content or A→Z order)");
  const expectedIds = new Set(expected.makeFiles.map((f) => f.make_id));
  for (const [mid, f] of s.makeFiles) {
    if (!expectedIds.has(mid)) err(`makes/${mid}.json has no make row`);
    if (f === null) err(`makes/${mid}.json is not in the expected shape`);
  }
  for (const f of expected.makeFiles) {
    const got = s.makeFiles.get(f.make_id);
    if (got === undefined) {
      err(`makes/${f.make_id}.json is missing`);
      continue;
    }
    if (got === null) continue;
    if (JSON.stringify(got) !== JSON.stringify(f)) err(`makes/${f.make_id}.json does not match the rows (models A→Z, years newest first, indexes)`);
    for (let i = 1; i < got.years.length; i++) if (got.years[i]!.year >= got.years[i - 1]!.year) err(`makes/${f.make_id}.json years not newest first`);
    for (const y of got.years) if (y.m.length === 0) err(`makes/${f.make_id}.json year ${y.year} has no models`);
    const raw = s.served.get(`makes/${f.make_id}.json`)?.toString("utf8");
    if (raw !== undefined && raw !== JSON.stringify(f)) err(`makes/${f.make_id}.json is not minified JSON`);
  }
  const rawMakes = s.served.get("makes.json")?.toString("utf8");
  if (rawMakes !== undefined && rawMakes !== JSON.stringify(expected.makesFile)) err("makes.json is not minified JSON");
  return {
    id: "FILES",
    title: "Files, checksums, counts, ids and order are consistent",
    ok: errs.length === 0,
    details: errs.length ? errs : [`${s.rows.makes.length} makes, ${s.rows.models.length} models, ${s.rows.model_years.length} model-year rows; ${s.served.size} served files`],
  };
}

/** AC5: two builds from the same saved source give the same model_ids and an empty diff. */
export function checkSameSource(a: LoadedSnapshot, b: LoadedSnapshot): CheckResult {
  const details: string[] = [];
  const ida = new Map(a.rows.models.map((m) => [m.model_id, m.display_name]));
  const idb = new Map(b.rows.models.map((m) => [m.model_id, m.display_name]));
  const onlyA = [...ida.keys()].filter((k) => !idb.has(k));
  const onlyB = [...idb.keys()].filter((k) => !ida.has(k));
  const renamed = [...ida.entries()].filter(([k, n]) => idb.has(k) && idb.get(k) !== n);
  if (onlyA.length || onlyB.length || renamed.length) details.push(`model_ids differ: ${onlyA.length} only in first, ${onlyB.length} only in second, ${renamed.length} renamed`);
  const diff = diffSnapshots(a.rows, b.rows, a.snapshot, b.snapshot);
  if (!diff.empty) details.push("the diff between the two builds is not empty");
  const sameFiles = JSON.stringify(a.manifest.files) === JSON.stringify(b.manifest.files);
  if (!sameFiles) details.push("served file checksums differ");
  return {
    id: "AC5",
    title: "Two runs on the same source data: same model_ids, empty diff",
    ok: details.length === 0,
    details: details.length ? details : [`${ida.size} model_ids identical; diff empty; all ${Object.keys(a.manifest.files).length} served files byte-identical`],
  };
}

// --- Switching the live pointer ------------------------------------------------------------

/** Where vehicles/live.json lives (R2 through wrangler, or memory in tests). */
export interface PointerStore {
  read(): Promise<string | null>;
  write(snapshot: string): Promise<void>;
}

export interface SwitchOutcome {
  switched: boolean;
  from: string | null;
  to: string;
  reasons: string[];
  guardrail: GuardrailResult | null;
}

/**
 * The one gate in front of vehicles/live.json: the new snapshot's checks must
 * pass, and it may not remove more than 2% of the live snapshot's rows unless
 * a person approved the diff. On refusal the pointer is never written.
 */
export async function switchLive(opts: {
  store: PointerStore;
  next: LoadedSnapshot;
  /** Rows of the snapshot that is live now (from its committed folder); null when they can't be found. */
  loadRows: (snapshot: string) => SnapshotRows | null;
  approveDiff: boolean;
  /** Override the checks (AC6 uses [] to test the guardrail on its own). */
  checks?: CheckResult[];
}): Promise<SwitchOutcome> {
  const reasons: string[] = [];
  const checks = opts.checks ?? runSnapshotChecks(opts.next);
  for (const c of checks) if (!c.ok) reasons.push(`check ${c.id} failed: ${c.details.join("; ")}`);
  const from = await opts.store.read();
  let g: GuardrailResult | null = null;
  if (from !== null && from !== opts.next.snapshot) {
    const liveRows = opts.loadRows(from);
    if (!liveRows) {
      reasons.push(`the live snapshot ${from} is not committed here, so the 2% guardrail can't be checked (pass --approve-diff only after reviewing the diff by hand)`);
      if (opts.approveDiff) reasons.pop();
    } else {
      g = guardrail(liveRows, opts.next.rows);
      if (!g.ok && !opts.approveDiff) {
        reasons.push(
          `guardrail: ${g.removedRows} of ${g.previousRows} rows (${(g.removedShare * 100).toFixed(2)}%) would be removed, over the ${(g.limit * 100).toFixed(0)}% limit; a person must approve the diff (--approve-diff)`,
        );
      }
    }
  }
  if (reasons.length > 0) return { switched: false, from, to: opts.next.snapshot, reasons, guardrail: g };
  await opts.store.write(opts.next.snapshot);
  return { switched: true, from, to: opts.next.snapshot, reasons: [], guardrail: g };
}

// --- The diff report ------------------------------------------------------------------------

const FLAG_TITLES: Array<[string, string]> = [
  ["featured-missing", "Featured makes missing (they drop off the Make cards)"],
  ["make-not-in-map", "New makes kept automatically (EPA match) — add a make_map.csv row"],
  ["epa-unmatched", "EPA make names no vPIC make matches — decide in make_map.csv"],
  ["make-map-stale", "make_map.csv rows vPIC no longer lists"],
  ["make-no-models", "Makes left out (no models)"],
  ["years-not-on-epa", "Model years vPIC lists but EPA doesn't (could not be confirmed by EPA)"],
  ["bracket-kept", "Brackets kept in model names (not only powertrain words) — check"],
  ["casing-variants", "Models vPIC spells more than one way"],
  ["denylist-dropped", "Models dropped by model_denylist.csv"],
  ["suffix-removed", "Powertrain brackets removed (rule N2)"],
  ["vpic-count", "vPIC answers whose Count didn't match their rows"],
  ["vpic-foreign-row", "vPIC rows for another make (ignored)"],
  ["empty-name", "Model names empty after clean-up (skipped)"],
];

function mdEscape(s: string): string {
  return s.replace(/\|/g, "\\|");
}

function yearsText(ys: number[]): string {
  const sorted = [...new Set(ys)].sort((a, b) => a - b);
  const parts: string[] = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j]! + 1) j++;
    parts.push(i === j ? `${sorted[i]}` : `${sorted[i]}–${sorted[j]}`);
    i = j + 1;
  }
  return parts.join(", ");
}

export function renderDiffReport(
  diff: SnapshotDiff,
  flags: ReviewFlag[],
  meta: { sourceNote: string; featured: readonly string[]; nextRows?: SnapshotRows },
): string {
  const L: string[] = [];
  const first = diff.previous === null;
  L.push(`# Vehicle list snapshot ${diff.next} — diff report`, "");
  L.push(`- Compared with: ${first ? "nothing (this is the first snapshot)" : `snapshot ${diff.previous}`}`);
  L.push(`- Source: ${meta.sourceNote}`);
  L.push("");
  if (first) L.push("**Result: first snapshot — everything is new.**");
  else if (diff.empty) L.push(`**Result: no differences against ${diff.previous}.**`);
  else L.push(`**Result: changes against ${diff.previous} — review below.**`);
  L.push("");

  L.push("## Totals", "", "| | Previous | This snapshot | Added | Removed |", "|---|---:|---:|---:|---:|");
  const prevMakes = diff.rowsPrevious === 0 && first ? 0 : null;
  const nextMakeCount = meta.nextRows?.makes.length;
  const nextModelCount = meta.nextRows?.models.length;
  const pm = prevMakes ?? (nextMakeCount !== undefined ? nextMakeCount - diff.makesAdded.length + diff.makesRemoved.length : NaN);
  const pmo = prevMakes ?? (nextModelCount !== undefined ? nextModelCount - diff.modelsAdded.length + diff.modelsRemoved.length : NaN);
  L.push(`| Makes | ${Number.isNaN(pm) ? "-" : pm} | ${nextMakeCount ?? "-"} | ${diff.makesAdded.length} | ${diff.makesRemoved.length} |`);
  L.push(`| Models | ${Number.isNaN(pmo) ? "-" : pmo} | ${nextModelCount ?? "-"} | ${diff.modelsAdded.length} | ${diff.modelsRemoved.length} |`);
  L.push(`| Model-year rows | ${diff.rowsPrevious} | ${diff.rowsNext} | ${diff.rowsAdded} | ${diff.rowsRemoved} |`, "");

  L.push("## 2% guardrail", "");
  if (first) L.push("Not applicable: there is no previous snapshot.");
  else {
    const pct = (diff.removedShare * 100).toFixed(2);
    L.push(
      diff.removedShare > VEHICLE_MAX_REMOVED_SHARE
        ? `**Over the limit:** ${diff.rowsRemoved} of ${diff.rowsPrevious} rows removed (${pct}%). The live switch will refuse until a person approves this diff.`
        : `Within the limit: ${diff.rowsRemoved} of ${diff.rowsPrevious} rows removed (${pct}%, limit 2%).`,
    );
  }
  L.push("");

  // Featured makes.
  if (meta.nextRows) {
    const names = new Set(meta.nextRows.makes.map((m) => m.display_name));
    const missing = meta.featured.filter((n) => !names.has(n));
    L.push("## Featured makes", "", missing.length ? `**Missing: ${missing.join(", ")}.** They drop off the Make cards.` : `All ${meta.featured.length} present: ${meta.featured.join(", ")}.`, "");
  }

  const makeName = new Map<number, string>();
  for (const m of meta.nextRows?.makes ?? []) makeName.set(m.make_id, m.display_name);
  for (const m of diff.makesRemoved) if (!makeName.has(m.make_id)) makeName.set(m.make_id, m.display_name);

  L.push(`## Makes added (${diff.makesAdded.length})`, "");
  if (diff.makesAdded.length === 0) L.push("None.");
  else if (first && meta.nextRows) {
    L.push("| Make | make_id | Models | Years |", "|---|---:|---:|---|");
    const count = new Map<number, number>();
    for (const m of meta.nextRows.models) count.set(m.make_id, (count.get(m.make_id) ?? 0) + 1);
    for (const m of diff.makesAdded) L.push(`| ${mdEscape(m.display_name)} | ${m.make_id} | ${count.get(m.make_id) ?? 0} | ${m.min_year}–${m.max_year} |`);
  } else for (const m of diff.makesAdded) L.push(`- ${m.display_name} (make_id ${m.make_id}, ${m.min_year}–${m.max_year})`);
  L.push("");
  L.push(`## Makes removed (${diff.makesRemoved.length})`, "");
  L.push(...(diff.makesRemoved.length ? diff.makesRemoved.map((m) => `- ${m.display_name} (make_id ${m.make_id}, was ${m.min_year}–${m.max_year})`) : ["None."]), "");
  if (diff.makesRenamed.length) {
    L.push(`## Makes renamed (${diff.makesRenamed.length})`, "", ...diff.makesRenamed.map((r) => `- make_id ${r.make_id}: "${r.from}" → "${r.to}"`), "");
  }

  const groupModels = (list: VehicleSnapshotModel[], years: Map<string, number[]>) => {
    const by = new Map<number, VehicleSnapshotModel[]>();
    for (const m of list) {
      const l = by.get(m.make_id) ?? [];
      l.push(m);
      by.set(m.make_id, l);
    }
    const out: string[] = [];
    for (const [mid, l] of [...by.entries()].sort((a, b) => compareNames(makeName.get(a[0]) ?? "", makeName.get(b[0]) ?? ""))) {
      out.push(`- **${makeName.get(mid) ?? `make ${mid}`}**: ${l
        .sort((a, b) => compareNames(a.display_name, b.display_name))
        .map((m) => `${m.display_name}${years.has(m.model_id) ? ` (${yearsText(years.get(m.model_id)!)})` : ""}`)
        .join(", ")}`);
    }
    return out;
  };
  L.push(`## Models added (${diff.modelsAdded.length})`, "");
  if (diff.modelsAdded.length === 0) L.push("None.");
  else if (first) L.push("All models are new in the first snapshot; see the per-make counts above and rows/models.json.");
  else L.push(...groupModels(diff.modelsAdded, diff.addedRowsByModel));
  L.push("");
  L.push(`## Models removed (${diff.modelsRemoved.length})`, "");
  L.push(...(diff.modelsRemoved.length ? groupModels(diff.modelsRemoved, diff.removedRowsByModel) : ["None."]), "");
  if (diff.modelsRenamed.length) {
    L.push(`## Models renamed — same model_id, new spelling (${diff.modelsRenamed.length})`, "");
    for (const r of diff.modelsRenamed) L.push(`- ${makeName.get(r.make_id) ?? r.make_id}: "${r.from}" → "${r.to}" (${r.model_id})`);
    L.push("");
  }
  if (!first) {
    // Years gained or lost by models that exist in both snapshots.
    const prevKept = new Set([...diff.removedRowsByModel.keys()].filter((id) => !diff.modelsRemoved.some((m) => m.model_id === id)));
    const addedKept = new Set([...diff.addedRowsByModel.keys()].filter((id) => !diff.modelsAdded.some((m) => m.model_id === id)));
    const nameOf = new Map((meta.nextRows?.models ?? []).map((m) => [m.model_id, m] as const));
    if (prevKept.size || addedKept.size) {
      L.push("## Years changed for models in both snapshots", "");
      for (const id of [...new Set([...prevKept, ...addedKept])].sort()) {
        const m = nameOf.get(id);
        const parts: string[] = [];
        if (diff.addedRowsByModel.has(id)) parts.push(`+${yearsText(diff.addedRowsByModel.get(id)!)}`);
        if (diff.removedRowsByModel.has(id)) parts.push(`−${yearsText(diff.removedRowsByModel.get(id)!)}`);
        L.push(`- ${m ? `${makeName.get(m.make_id) ?? m.make_id} ${m.display_name}` : id}: ${parts.join(" ")}`);
      }
      L.push("");
    }
    if (diff.typesChanged.length) {
      L.push(`## Vehicle types changed (${diff.typesChanged.length} rows)`, "");
      for (const t of diff.typesChanged.slice(0, 200)) {
        const m = nameOf.get(t.model_id);
        L.push(`- ${m ? `${makeName.get(m.make_id) ?? m.make_id} ${m.display_name}` : t.model_id} ${t.model_year}: ${t.from} → ${t.to}`);
      }
      if (diff.typesChanged.length > 200) L.push(`- … and ${diff.typesChanged.length - 200} more`);
      L.push("");
    }
  }

  L.push("## Rows per model year", "", "| Year | Previous | This snapshot | Change |", "|---:|---:|---:|---:|");
  for (const y of diff.yearCounts) {
    const ch = y.next - y.previous;
    L.push(`| ${y.year} | ${y.previous} | ${y.next} | ${ch > 0 ? `+${ch}` : ch} |`);
  }
  L.push("");

  L.push("## Review flags (from the source data)", "");
  if (flags.length === 0) L.push("None.");
  const known = new Set(FLAG_TITLES.map(([k]) => k));
  const order = [...FLAG_TITLES, ...[...new Set(flags.map((f) => f.kind))].filter((k) => !known.has(k)).map((k) => [k, k] as [string, string])];
  for (const [kind, title] of order) {
    const list = flags.filter((f) => f.kind === kind);
    if (list.length === 0) continue;
    L.push(`### ${title} (${list.length})`, "", ...list.map((f) => `- ${f.message}`), "");
  }
  return `${L.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
}

// --- CLI ---------------------------------------------------------------------------------------

function previousOf(id: string, snapshotsDir = SNAPSHOTS_DIR): string | null {
  if (!existsSync(snapshotsDir)) return null;
  const older = readdirSync(snapshotsDir)
    .filter((d) => isSnapshotId(d) && d < id && existsSync(path.join(snapshotsDir, d, "rows", "model_years.json")))
    .sort();
  return older.length ? path.join(snapshotsDir, older[older.length - 1]!) : null;
}

function printResults(results: CheckResult[]): void {
  for (const r of results) {
    process.stdout.write(`${r.ok ? "PASS" : "FAIL"}  ${r.id.padEnd(9)} ${r.title}\n`);
    for (const d of r.details) process.stdout.write(`          ${d}\n`);
  }
}

async function main(argv: string[]): Promise<number> {
  let target: string | undefined;
  let previous: string | undefined;
  let sameSource: string | undefined;
  let ac6 = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--previous") previous = argv[++i];
    else if (a === "--same-source-as") sameSource = argv[++i];
    else if (a === "--ac6") ac6 = true;
    else if (a === "--help" || a === "-h") {
      process.stdout.write(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1, 18).map((l) => l.replace(/^\/\/ ?/, "")).join("\n") + "\n");
      return 0;
    } else if (!a.startsWith("--") && target === undefined) target = a;
    else throw new Error(`unknown option ${a}`);
  }
  if (!target) throw new Error("usage: checks.ts <snapshot id or folder> [--previous <id|folder|none>] [--same-source-as <folder>] [--ac6]");
  const s = loadSnapshot(snapshotDirOf(target));
  const results = runSnapshotChecks(s);

  const prevDir = previous === "none" ? null : previous ? snapshotDirOf(previous) : previousOf(s.snapshot);
  if (prevDir) {
    const g = guardrail(loadSnapshotRows(prevDir), s.rows);
    results.push({
      id: "GUARDRAIL",
      title: `At most 2% of ${path.basename(prevDir)}'s rows removed`,
      ok: g.ok,
      details: [`${g.removedRows} of ${g.previousRows} rows removed (${(g.removedShare * 100).toFixed(2)}%)`],
    });
  }
  if (sameSource) results.push(checkSameSource(s, loadSnapshot(snapshotDirOf(sameSource))));
  if (ac6) {
    // A made-up snapshot missing 5% of this one's rows, while this one is live.
    const synthetic = snapshotFromRows(`${s.snapshot.slice(0, 10)}-ac6`, dropShareOfRows(s.rows, 0.05));
    let pointer: string | null = s.snapshot;
    let writes = 0;
    const store: PointerStore = {
      read: async () => pointer,
      write: async (id) => {
        writes++;
        pointer = id;
      },
    };
    const outcome = await switchLive({ store, next: synthetic, loadRows: (id) => (id === s.snapshot ? s.rows : null), approveDiff: false, checks: [] });
    const ok = !outcome.switched && pointer === s.snapshot && writes === 0;
    results.push({
      id: "AC6",
      title: "A made-up snapshot missing 5% of rows is refused; the live pointer doesn't move",
      ok,
      details: [
        `made-up snapshot: ${synthetic.rows.model_years.length} of ${s.rows.model_years.length} rows (${outcome.guardrail ? (outcome.guardrail.removedShare * 100).toFixed(2) : "?"}% removed)`,
        `switch ${outcome.switched ? "WENT THROUGH" : "refused"}: ${outcome.reasons.join("; ") || "-"}`,
        `live pointer before ${s.snapshot}, after ${pointer}; pointer writes: ${writes}`,
      ],
    });
  }
  printResults(results);
  const failed = results.filter((r) => !r.ok).length;
  process.stdout.write(`\n${failed === 0 ? "All checks passed." : `${failed} check(s) failed.`}\n`);
  return failed === 0 ? 0 : 1;
}

const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e: unknown) => {
      process.stderr.write(`checks failed to run: ${e instanceof Error ? e.message : String(e)}\n`);
      process.exit(2);
    },
  );
}
