#!/usr/bin/env tsx
// F18 Vehicle database — the yearly ingest (backlog F18, part A).
//
// Builds one snapshot of the US vehicle list from NHTSA vPIC, keeps only
// consumer makes (EPA FuelEconomy.gov make lists + make_map.csv), cleans the
// names (spec rules N1–N4) and writes the ready-made JSON files the CMS serves
// from R2, plus the full rows and a diff report against the previous snapshot.
//
//   npx tsx scripts/vehicles/ingest.ts --snapshot 2026-11-23
//   npx tsx scripts/vehicles/ingest.ts --snapshot 2026-11-23 --offline
//
// Options:
//   --snapshot <id>        snapshot id = build date (YYYY-MM-DD[-suffix]). Required.
//   --offline              use only the saved source answers (no network); fails if one is missing.
//   --source-cache <dir>   where raw answers are saved (default scripts/vehicles/.source-cache/<snapshot>).
//   --out <dir>            output folder (default scripts/vehicles/snapshots/<snapshot>).
//   --compare-to <id|dir|none>  snapshot to diff against (default: newest committed snapshot older than this one).
//   --only-makes <ids>     comma-separated vPIC make ids: a PARTIAL build for spot checks / tests (never upload it).
//   --min-year / --max-year / --epa-min-year <y>  narrow the year range (tests only; defaults 1981 / snapshot year + 1 / 1984).
//
// Rules this script keeps (spec §4, V1–V4): models are looked up by make ID
// only, one vehicle type at a time (car, mpv, truck), never by make name and
// never without a type. At most 5 requests a second, retry with back-off.
// Nothing here runs in the Worker or the browser.

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  MODEL_ID_RE,
  VEHICLE_MIN_MODEL_YEAR,
  isSnapshotId,
  slugifyMakeName,
  type VehicleMakeFile,
  type VehicleMakesFile,
  type VehicleManifest,
  type VehicleSnapshotMake,
  type VehicleSnapshotModel,
  type VehicleSnapshotModelYear,
} from "../../src/leadgen/vehicles/format";
import {
  FEATURED_MAKES,
  compareNames,
  diffSnapshots,
  loadSnapshotRows,
  renderDiffReport,
  servedFiles,
  type DroppedModel,
  type ReviewFlag,
  type SnapshotRows,
} from "./checks";

export { compareNames, servedFiles };

// --- Constants ----------------------------------------------------------------

export const VPIC_BASE = "https://vpic.nhtsa.dot.gov/api/vehicles";
export const EPA_MAKE_MENU = "https://www.fueleconomy.gov/ws/rest/vehicle/menu/make";
/** First year EPA publishes make lists for (spec §4 step 2). */
export const EPA_MIN_YEAR = 1984;
export const VEHICLE_TYPES = ["car", "mpv", "truck"] as const;
export type VehicleType = (typeof VEHICLE_TYPES)[number];
/** Generic client name: no personal or company details go to the source sites. */
export const USER_AGENT = "vehicle-list-refresh/1.0";
export const MAX_REQUESTS_PER_SECOND = 5;

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_SNAPSHOTS_DIR = path.join(SCRIPT_DIR, "snapshots");
export const DEFAULT_CACHE_ROOT = path.join(SCRIPT_DIR, ".source-cache");
export const DEFAULT_MAKE_MAP = path.join(SCRIPT_DIR, "make_map.csv");
export const DEFAULT_DENYLIST = path.join(SCRIPT_DIR, "model_denylist.csv");

// --- Small CSV reader (quoted fields, "" escapes, # comment lines) -------------

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  for (const line of lines) {
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    const out: string[] = [];
    let cur = "";
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]!;
      if (quoted) {
        if (ch === '"') {
          if (line[i + 1] === '"') {
            cur += '"';
            i++;
          } else quoted = false;
        } else cur += ch;
      } else if (ch === '"' && cur === "") quoted = true;
      else if (ch === ",") {
        out.push(cur);
        cur = "";
      } else cur += ch;
    }
    if (quoted) throw new Error(`CSV: unclosed quote in line: ${line}`);
    out.push(cur);
    rows.push(out.map((c) => c.trim()));
  }
  return rows;
}

function csvRecords(text: string, file: string, required: string[]): Array<Record<string, string>> {
  const rows = parseCsv(text);
  const header = rows.shift();
  if (!header) throw new Error(`${file}: empty file`);
  for (const col of required) {
    if (!header.includes(col)) throw new Error(`${file}: missing column "${col}" (header: ${header.join(",")})`);
  }
  return rows.map((r, i) => {
    if (r.length > header.length) throw new Error(`${file}: data row ${i + 1} has ${r.length} fields, header has ${header.length}`);
    const rec: Record<string, string> = {};
    header.forEach((h, j) => (rec[h] = r[j] ?? ""));
    return rec;
  });
}

// --- make_map.csv (N1 + the consumer decisions) --------------------------------

export interface MakeMapRow {
  /** vPIC MakeId; null for a row that only records a reviewed EPA name with no vPIC make. */
  vpic_make_id: number | null;
  display_name: string;
  include: boolean;
  /** EPA make names (any case) this row accounts for, so they leave the review list. */
  epa_names: string[];
}

export function parseMakeMap(text: string, file = "make_map.csv"): MakeMapRow[] {
  const recs = csvRecords(text, file, ["vpic_make_id", "display_name", "include"]);
  const seen = new Set<number>();
  return recs.map((r, i) => {
    const where = `${file} data row ${i + 1}`;
    const idRaw = r["vpic_make_id"] ?? "";
    let id: number | null = null;
    if (idRaw !== "") {
      if (!/^[1-9]\d*$/.test(idRaw)) throw new Error(`${where}: vpic_make_id "${idRaw}" is not a positive whole number`);
      id = Number(idRaw);
      if (seen.has(id)) throw new Error(`${where}: vpic_make_id ${id} is listed twice`);
      seen.add(id);
    }
    const inc = (r["include"] ?? "").toLowerCase();
    if (inc !== "yes" && inc !== "no") throw new Error(`${where}: include must be "yes" or "no", got "${r["include"]}"`);
    if (id === null && inc === "yes") throw new Error(`${where}: a row without vpic_make_id can only be include=no`);
    const epa = (r["epa_names"] ?? "")
      .split("|")
      .map((s) => normalizeEpaName(s))
      .filter(Boolean);
    return { vpic_make_id: id, display_name: collapseSpaces(r["display_name"] ?? ""), include: inc === "yes", epa_names: epa };
  });
}

// --- model_denylist.csv (N3) ------------------------------------------------------

export interface DenyRule {
  /** "term": drop any model whose name contains `value`; "pair": drop exactly this model of make `make_id`. */
  kind: "term" | "pair";
  make_id: number | null;
  value: string;
  reason: string;
}

export function parseDenylist(text: string, file = "model_denylist.csv"): DenyRule[] {
  const recs = csvRecords(text, file, ["kind", "make_id", "model", "reason"]);
  return recs.map((r, i) => {
    const where = `${file} data row ${i + 1}`;
    const kind = r["kind"];
    const value = collapseSpaces(r["model"] ?? "");
    if (!value) throw new Error(`${where}: empty model/term`);
    if (kind === "term") {
      if ((r["make_id"] ?? "") !== "") throw new Error(`${where}: a term applies to every make; leave make_id empty`);
      return { kind, make_id: null, value, reason: r["reason"] ?? "" };
    }
    if (kind === "pair") {
      const idRaw = r["make_id"] ?? "";
      if (!/^[1-9]\d*$/.test(idRaw)) throw new Error(`${where}: a pair needs a vPIC make_id`);
      return { kind, make_id: Number(idRaw), value, reason: r["reason"] ?? "" };
    }
    throw new Error(`${where}: kind must be "term" or "pair", got "${kind}"`);
  });
}

/** Which deny rule (if any) drops this model. Matching ignores case; terms match anywhere in the name. */
export function deniedBy(makeId: number, rawName: string, cleaned: string, rules: DenyRule[]): DenyRule | null {
  const raw = foldName(collapseSpaces(rawName));
  const clean = foldName(cleaned);
  for (const r of rules) {
    const v = foldName(r.value);
    if (r.kind === "term") {
      if (raw.includes(v) || clean.includes(v)) return r;
    } else if (r.make_id === makeId && (raw === v || clean === v)) return r;
  }
  return null;
}

// --- Names (N1, N2, N4) -----------------------------------------------------------

export function collapseSpaces(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

export function foldName(s: string): string {
  return s.toLowerCase();
}

/** EPA and vPIC make names are compared upper-cased and trimmed (spec §4 step 2). */
export function normalizeEpaName(s: string): string {
  return collapseSpaces(s).toUpperCase();
}

/** N1 default: "ALFA ROMEO" → "Alfa Romeo", "MERCEDES-BENZ" → "Mercedes-Benz". Exceptions live in make_map.csv. */
export function titleCaseMake(vpicName: string): string {
  return collapseSpaces(vpicName)
    .toLowerCase()
    .replace(/(^|[\s\-/])([a-z])/g, (_m, sep: string, ch: string) => sep + ch.toUpperCase());
}

/**
 * Words that may sit in a trailing bracket and describe only the powertrain or
 * drivetrain (N2: "RAV4 Prime (PHEV)" → "RAV4 Prime"). A bracket holding
 * anything else is kept as vPIC wrote it and flagged for a person.
 */
const POWERTRAIN_WORDS = new Set([
  "phev", "hev", "bev", "ev", "fcev", "fcv", "mhev", "erev",
  "hybrid", "plug", "in", "electric", "battery", "fuel", "cell",
  "awd", "4wd", "2wd", "fwd", "rwd", "4x4", "4x2", "diesel", "gas", "cng", "lpg", "hydrogen",
]);

export interface CleanedModelName {
  name: string;
  /** The bracket removed as a powertrain suffix, e.g. "(PHEV)". */
  removed: string | null;
  /** A trailing bracket that was kept because it isn't only powertrain words. */
  keptBracket: string | null;
}

/** N2: keep vPIC's casing, trim, collapse spaces, drop a powertrain suffix in brackets. */
export function cleanModelName(raw: string): CleanedModelName {
  let name = collapseSpaces(raw);
  let removed: string | null = null;
  let keptBracket: string | null = null;
  const m = /\s*\(([^()]*)\)$/.exec(name);
  if (m) {
    const inner = m[1]!.trim();
    const words = inner.toLowerCase().split(/[\s/,+&]+/).filter(Boolean);
    const onlyPowertrain =
      words.length > 0 && words.every((w) => POWERTRAIN_WORDS.has(w) || w.split("-").every((p) => POWERTRAIN_WORDS.has(p)));
    const base = name.slice(0, m.index).trim();
    if (onlyPowertrain && base !== "") {
      removed = `(${inner})`;
      name = base;
    } else keptBracket = `(${inner})`;
  }
  return { name, removed, keptBracket };
}

/** N4: model_id = "m_" + first 10 hex of sha256("{make_id}:{cleaned, case-folded name}"). A forever contract: never change it. */
export function modelIdFor(makeId: number, cleanedName: string): string {
  const hex = createHash("sha256").update(`${makeId}:${foldName(collapseSpaces(cleanedName))}`, "utf8").digest("hex");
  return `m_${hex.slice(0, 10)}`;
}

// --- Source answers -----------------------------------------------------------------

export interface VpicMake {
  make_id: number;
  vpic_name: string;
  types: VehicleType[];
}

export interface RawModelRow {
  make_id: number;
  year: number;
  type: VehicleType;
  name: string;
}

export function vpicMakesUrl(type: VehicleType): string {
  return `${VPIC_BASE}/GetMakesForVehicleType/${type}?format=json`;
}

export function epaMakesUrl(year: number): string {
  return `${EPA_MAKE_MENU}?year=${year}`;
}

/** V1 + V2 + V4: by make ID, one vehicle type at a time. There is deliberately no make-name or type-less variant. */
export function vpicModelsUrl(makeId: number, year: number, type: VehicleType): string {
  if (!Number.isSafeInteger(makeId) || makeId <= 0) throw new Error(`bad make id ${makeId}`);
  return `${VPIC_BASE}/GetModelsForMakeIdYear/makeId/${makeId}/modelyear/${year}/vehicletype/${type}?format=json`;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function vpicResults(body: unknown, url: string): { results: Array<Record<string, unknown>>; count: number | null } {
  if (!isRecord(body) || !Array.isArray(body["Results"])) throw new Error(`unexpected vPIC answer shape for ${url}`);
  const count = typeof body["Count"] === "number" ? body["Count"] : null;
  return { results: body["Results"].filter(isRecord), count };
}

export function parseVpicMakes(bodies: Record<VehicleType, unknown>): VpicMake[] {
  const byId = new Map<number, VpicMake>();
  for (const type of VEHICLE_TYPES) {
    const { results } = vpicResults(bodies[type], vpicMakesUrl(type));
    for (const r of results) {
      const id = r["MakeId"];
      const name = r["MakeName"];
      if (typeof id !== "number" || typeof name !== "string") continue;
      const cur = byId.get(id) ?? { make_id: id, vpic_name: collapseSpaces(name), types: [] };
      if (!cur.types.includes(type)) cur.types.push(type);
      byId.set(id, cur);
    }
  }
  return [...byId.values()].sort((a, b) => a.make_id - b.make_id);
}

/** EPA menu answers: {"menuItem":[{text,value}]} — or a single object when the year has one make, or null when none. */
export function parseEpaMakes(body: unknown): string[] {
  if (!isRecord(body)) return [];
  const mi = body["menuItem"];
  const items = Array.isArray(mi) ? mi : isRecord(mi) ? [mi] : [];
  const out: string[] = [];
  for (const it of items) {
    if (isRecord(it) && typeof it["text"] === "string" && it["text"].trim() !== "") out.push(it["text"]);
  }
  return out;
}

// --- Make selection (consumer filter + make_map.csv) --------------------------------

export interface KeptMake {
  make_id: number;
  vpic_name: string;
  display_name: string;
}

export interface MakeSelection {
  kept: KeptMake[];
  flags: ReviewFlag[];
  /** Years EPA lists each kept make (by its vPIC name or the EPA names in its make_map.csv row). */
  epaYears: Map<number, Set<number>>;
}

/**
 * Keep the vPIC makes that EPA lists in any year from 1984 on (names compared
 * upper-cased and trimmed), then apply make_map.csv: include=no drops a make,
 * include=yes keeps it (a person's decision, e.g. an EPA name spelled
 * differently), and display_name overrides the title-case default (N1).
 * Pre-1984 makes are kept only via a later EPA year, which this gives for free.
 */
export function selectMakes(vpic: VpicMake[], epaByYear: Map<number, string[]>, makeMap: MakeMapRow[]): MakeSelection {
  const flags: ReviewFlag[] = [];
  const epaYears = new Map<string, number[]>();
  for (const [year, names] of [...epaByYear.entries()].sort((a, b) => a[0] - b[0])) {
    for (const n of names) {
      const key = normalizeEpaName(n);
      const ys = epaYears.get(key) ?? [];
      if (!ys.includes(year)) ys.push(year);
      epaYears.set(key, ys);
    }
  }
  const mapById = new Map<number, MakeMapRow>();
  const reviewedEpa = new Set<string>();
  for (const row of makeMap) {
    if (row.vpic_make_id !== null) mapById.set(row.vpic_make_id, row);
    for (const n of row.epa_names) reviewedEpa.add(n);
  }
  const vpicByName = new Map<string, VpicMake>();
  for (const m of vpic) vpicByName.set(normalizeEpaName(m.vpic_name), m);

  const kept: KeptMake[] = [];
  for (const m of vpic) {
    const key = normalizeEpaName(m.vpic_name);
    const onEpa = epaYears.has(key);
    const row = mapById.get(m.make_id);
    if (row) {
      if (!row.include) continue;
      kept.push({ make_id: m.make_id, vpic_name: m.vpic_name, display_name: row.display_name || titleCaseMake(m.vpic_name) });
    } else if (onEpa) {
      const display = titleCaseMake(m.vpic_name);
      kept.push({ make_id: m.make_id, vpic_name: m.vpic_name, display_name: display });
      const ys = epaYears.get(key)!;
      flags.push({
        kind: "make-not-in-map",
        make_id: m.make_id,
        message: `${m.vpic_name} (make_id ${m.make_id}) matches EPA (${ys[0]}–${ys[ys.length - 1]}) but has no make_map.csv row; kept as "${display}". Add a row to confirm or exclude it.`,
      });
    }
  }
  for (const row of makeMap) {
    if (row.vpic_make_id !== null && !vpic.some((m) => m.make_id === row.vpic_make_id)) {
      flags.push({
        kind: "make-map-stale",
        make_id: row.vpic_make_id,
        message: `make_map.csv row ${row.vpic_make_id} ("${row.display_name}") is not in vPIC's car/mpv/truck make lists any more${row.include ? "; it was not crawled" : ""}.`,
      });
    }
  }
  for (const [name, ys] of [...epaYears.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    if (vpicByName.has(name) || reviewedEpa.has(name)) continue;
    flags.push({
      kind: "epa-unmatched",
      message: `EPA make "${name}" (${ys[0]}–${ys[ys.length - 1]}) matches no vPIC make name. Decide in make_map.csv (map it to a vPIC make_id, or record it as include=no).`,
    });
  }
  // A kept make whose display name breaks AC4 is a make_map.csv mistake: fail loudly.
  for (const k of kept) {
    if (/\b(llc|inc|corporation|limited)\b/i.test(k.display_name)) {
      throw new Error(`make ${k.make_id} display name "${k.display_name}" contains a company suffix (AC4); fix make_map.csv`);
    }
  }
  kept.sort((a, b) => a.make_id - b.make_id);
  const keptEpaYears = new Map<number, Set<number>>();
  for (const k of kept) {
    const names = [normalizeEpaName(k.vpic_name), ...(mapById.get(k.make_id)?.epa_names ?? [])];
    keptEpaYears.set(k.make_id, new Set(names.flatMap((n) => epaYears.get(n) ?? [])));
  }
  return { kept, flags, epaYears: keptEpaYears };
}

// --- Building the snapshot (N2–N4, merge, de-dup) -----------------------------------

export interface BuiltSnapshot {
  snapshot: string;
  rows: SnapshotRows;
  makesFile: VehicleMakesFile;
  makeFiles: VehicleMakeFile[];
  flags: ReviewFlag[];
  /** What model_denylist.csv removed (make + model + years), for the diff report. */
  dropped: DroppedModel[];
}

export interface BuildInput {
  snapshot: string;
  makes: KeptMake[];
  rows: RawModelRow[];
  deny: DenyRule[];
  /** For tests: swap the hash to prove a collision fails loudly. */
  modelIdFn?: (makeId: number, cleanedName: string) => string;
}

export function buildSnapshot(input: BuildInput): BuiltSnapshot {
  const { snapshot } = input;
  const idFn = input.modelIdFn ?? modelIdFor;
  const flags: ReviewFlag[] = [];
  const makeById = new Map(input.makes.map((m) => [m.make_id, m]));

  // (make, fold) → per-year types and the casings seen.
  interface ModelAcc {
    make_id: number;
    fold: string;
    casings: Map<string, { maxYear: number; count: number }>;
    years: Map<number, Set<VehicleType>>;
  }
  const models = new Map<string, ModelAcc>();
  const denied = new Map<number, Map<string, { rule: DenyRule; years: Set<number> }>>();
  const removedSuffix = new Map<string, { make_id: number; from: string; to: string }>();
  const keptBracket = new Map<string, { make_id: number; name: string; years: Set<number> }>();

  for (const r of input.rows) {
    if (!makeById.has(r.make_id)) continue;
    const c = cleanModelName(r.name);
    if (c.name === "") {
      flags.push({ kind: "empty-name", make_id: r.make_id, message: `${r.make_id} ${r.year} ${r.type}: model name "${r.name}" is empty after clean-up; skipped.` });
      continue;
    }
    const rule = deniedBy(r.make_id, r.name, c.name, input.deny);
    if (rule) {
      const perMake = denied.get(r.make_id) ?? new Map();
      const e = perMake.get(c.name) ?? { rule, years: new Set<number>() };
      e.years.add(r.year);
      perMake.set(c.name, e);
      denied.set(r.make_id, perMake);
      continue;
    }
    if (c.removed) removedSuffix.set(`${r.make_id}|${collapseSpaces(r.name)}`, { make_id: r.make_id, from: collapseSpaces(r.name), to: c.name });
    if (c.keptBracket) {
      const k = `${r.make_id}|${c.name}`;
      const e = keptBracket.get(k) ?? { make_id: r.make_id, name: c.name, years: new Set<number>() };
      e.years.add(r.year);
      keptBracket.set(k, e);
    }
    const fold = foldName(c.name);
    const key = `${r.make_id}|${fold}`;
    const acc = models.get(key) ?? { make_id: r.make_id, fold, casings: new Map(), years: new Map() };
    const cs = acc.casings.get(c.name) ?? { maxYear: 0, count: 0 };
    cs.maxYear = Math.max(cs.maxYear, r.year);
    cs.count += 1;
    acc.casings.set(c.name, cs);
    const ts = acc.years.get(r.year) ?? new Set<VehicleType>();
    ts.add(r.type);
    acc.years.set(r.year, ts);
    models.set(key, acc);
  }

  // One display name per model: the casing used in its newest year; on a tie, mixed case over ALL CAPS
  // (vPIC's all-caps rows are older bulk entries: "bZ4X" over "BZ4X"), then the most used, then code-unit order.
  const idOwner = new Map<string, string>();
  const outModels: VehicleSnapshotModel[] = [];
  const outYears: VehicleSnapshotModelYear[] = [];
  for (const acc of [...models.values()].sort((a, b) => a.make_id - b.make_id || (a.fold < b.fold ? -1 : a.fold > b.fold ? 1 : 0))) {
    const allCaps = (n: string) => (n === n.toUpperCase() && n !== n.toLowerCase() ? 1 : 0);
    const casings = [...acc.casings.entries()].sort(
      (a, b) =>
        b[1].maxYear - a[1].maxYear ||
        allCaps(a[0]) - allCaps(b[0]) ||
        b[1].count - a[1].count ||
        (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0),
    );
    const display = casings[0]![0];
    if (casings.length > 1) {
      flags.push({
        kind: "casing-variants",
        make_id: acc.make_id,
        message: `${makeById.get(acc.make_id)!.display_name}: vPIC spells one model ${casings.map(([n]) => `"${n}"`).join(", ")}; using "${display}".`,
      });
    }
    const id = idFn(acc.make_id, display);
    if (!MODEL_ID_RE.test(id)) throw new Error(`model_id "${id}" for ${acc.make_id} "${display}" does not match ${MODEL_ID_RE}`);
    const owner = idOwner.get(id);
    if (owner !== undefined && owner !== `${acc.make_id}|${acc.fold}`) {
      throw new Error(`model_id collision: ${id} is produced by both "${owner}" and "${acc.make_id}|${acc.fold}". Stop: model ids must be unique (N4).`);
    }
    idOwner.set(id, `${acc.make_id}|${acc.fold}`);
    outModels.push({ model_id: id, make_id: acc.make_id, display_name: display });
    for (const [year, types] of acc.years) {
      outYears.push({
        make_id: acc.make_id,
        model_year: year,
        model_id: id,
        vehicle_types: VEHICLE_TYPES.filter((t) => types.has(t)).join(","),
      });
    }
  }

  const modelName = new Map(outModels.map((m) => [m.model_id, m.display_name]));
  outModels.sort((a, b) => a.make_id - b.make_id || compareNames(a.display_name, b.display_name) || (a.model_id < b.model_id ? -1 : 1));
  outYears.sort(
    (a, b) =>
      a.make_id - b.make_id ||
      b.model_year - a.model_year ||
      compareNames(modelName.get(a.model_id)!, modelName.get(b.model_id)!) ||
      (a.model_id < b.model_id ? -1 : a.model_id > b.model_id ? 1 : 0),
  );

  // Makes with at least one model; min/max from their model years.
  const outMakes: VehicleSnapshotMake[] = [];
  for (const mk of input.makes) {
    const ys = outYears.filter((y) => y.make_id === mk.make_id).map((y) => y.model_year);
    if (ys.length === 0) {
      flags.push({ kind: "make-no-models", make_id: mk.make_id, message: `${mk.display_name} (make_id ${mk.make_id}) has no models in vPIC for any year after clean-up; left out of the snapshot.` });
      continue;
    }
    outMakes.push({
      make_id: mk.make_id,
      display_name: mk.display_name,
      slug: slugifyMakeName(mk.display_name),
      min_year: Math.min(...ys),
      max_year: Math.max(...ys),
    });
  }
  outMakes.sort((a, b) => compareNames(a.display_name, b.display_name) || a.make_id - b.make_id);
  const slugs = new Map<string, number>();
  for (const m of outMakes) {
    const prev = slugs.get(m.slug);
    if (prev !== undefined) throw new Error(`two makes share the slug "${m.slug}" (${prev}, ${m.make_id}); fix make_map.csv display names`);
    slugs.set(m.slug, m.make_id);
  }

  const dropped: DroppedModel[] = [];
  for (const [makeId, perMake] of [...denied.entries()].sort((a, b) => a[0] - b[0])) {
    const make = makeById.get(makeId)!.display_name;
    for (const [model, e] of [...perMake.entries()].sort((a, b) => compareNames(a[0], b[0]))) {
      dropped.push({ make_id: makeId, make, model, years: [...e.years].sort((a, b) => a - b), kind: e.rule.kind, rule: e.rule.value, reason: e.rule.reason });
    }
  }
  for (const e of [...keptBracket.values()].sort((a, b) => a.make_id - b.make_id || compareNames(a.name, b.name))) {
    flags.push({
      kind: "bracket-kept",
      make_id: e.make_id,
      message: `${makeById.get(e.make_id)!.display_name}: "${e.name}" (${describeYears([...e.years])}) ends in a bracket that is not only a powertrain word, so it was kept as vPIC wrote it.`,
    });
  }
  const suffixByMake = new Map<number, string[]>();
  for (const e of [...removedSuffix.values()].sort((a, b) => a.make_id - b.make_id || compareNames(a.from, b.from))) {
    const list = suffixByMake.get(e.make_id) ?? [];
    list.push(`"${e.from}" → "${e.to}"`);
    suffixByMake.set(e.make_id, list);
  }
  for (const [makeId, list] of suffixByMake) {
    flags.push({ kind: "suffix-removed", make_id: makeId, message: `${makeById.get(makeId)!.display_name}: ${list.join(", ")}` });
  }

  const rows: SnapshotRows = { makes: outMakes, models: outModels, model_years: outYears };
  const { makesFile, makeFiles } = servedFiles(snapshot, rows);
  return { snapshot, rows, makesFile, makeFiles, flags, dropped };
}

function describeYears(years: number[]): string {
  const ys = [...new Set(years)].sort((a, b) => a - b);
  if (ys.length === 0) return "";
  const parts: string[] = [];
  let start = ys[0]!;
  let prev = start;
  for (const y of ys.slice(1)) {
    if (y === prev + 1) {
      prev = y;
      continue;
    }
    parts.push(start === prev ? `${start}` : `${start}–${prev}`);
    start = prev = y;
  }
  parts.push(start === prev ? `${start}` : `${start}–${prev}`);
  return parts.join(", ");
}

// --- Fetching: throttle, retry, on-disk cache ----------------------------------------

interface CacheEntry {
  fetched_at: string;
  body: unknown;
}
type CacheShard = Record<string, CacheEntry>;

export interface FetchStats {
  network: number;
  cached: number;
  retries: number;
}

export class SourceCache {
  private shards = new Map<string, CacheShard>();
  private dirty = new Set<string>();
  constructor(readonly dir: string) {}

  private file(shard: string): string {
    return path.join(this.dir, `${shard}.json`);
  }

  private load(shard: string): CacheShard {
    let s = this.shards.get(shard);
    if (!s) {
      const f = this.file(shard);
      s = existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as CacheShard) : {};
      this.shards.set(shard, s);
    }
    return s;
  }

  get(shard: string, url: string): CacheEntry | undefined {
    return this.load(shard)[url];
  }

  put(shard: string, url: string, entry: CacheEntry): void {
    this.load(shard)[url] = entry;
    this.dirty.add(shard);
  }

  flush(): void {
    for (const shard of this.dirty) {
      const f = this.file(shard);
      mkdirSync(path.dirname(f), { recursive: true });
      const s = this.shards.get(shard)!;
      const sorted: CacheShard = {};
      for (const k of Object.keys(s).sort()) sorted[k] = s[k]!;
      writeFileSync(`${f}.tmp`, JSON.stringify(sorted), "utf8");
      renameSync(`${f}.tmp`, f);
    }
    this.dirty.clear();
  }

  /** Earliest and latest fetch time over the given urls (for the manifest). */
  span(entries: CacheEntry[]): { first: string; last: string } | null {
    if (entries.length === 0) return null;
    const ts = entries.map((e) => e.fetched_at).sort();
    return { first: ts[0]!, last: ts[ts.length - 1]! };
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Starts at most `perSecond` requests a second across every caller. */
export class RateLimiter {
  private next = 0;
  private readonly gap: number;
  constructor(perSecond: number) {
    this.gap = Math.ceil(1000 / perSecond);
  }
  async wait(): Promise<void> {
    const now = Date.now();
    const slot = Math.max(now, this.next);
    this.next = slot + this.gap;
    if (slot > now) await sleep(slot - now);
  }
}

export interface Fetcher {
  /** JSON body of `url` (shard = cache file it belongs to). */
  get(shard: string, url: string, accept?: string): Promise<{ body: unknown; fetched_at: string }>;
  stats: FetchStats;
  flush(): void;
}

export function makeFetcher(opts: { cache: SourceCache; offline: boolean; log?: (s: string) => void; maxAttempts?: number }): Fetcher {
  const limiter = new RateLimiter(MAX_REQUESTS_PER_SECOND);
  const stats: FetchStats = { network: 0, cached: 0, retries: 0 };
  const maxAttempts = opts.maxAttempts ?? 10;
  const log = opts.log ?? (() => {});
  return {
    stats,
    flush: () => opts.cache.flush(),
    async get(shard, url, accept = "application/json") {
      const hit = opts.cache.get(shard, url);
      if (hit) {
        stats.cached++;
        return hit;
      }
      if (opts.offline) throw new Error(`--offline: no saved answer for ${url} (cache ${opts.cache.dir})`);
      let lastErr = "";
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        await limiter.wait();
        let retryAfterMs = 0;
        try {
          const res = await fetch(url, {
            headers: { "User-Agent": USER_AGENT, Accept: accept },
            signal: AbortSignal.timeout(30_000),
          });
          if (res.status === 429 || res.status >= 500) {
            const ra = Number(res.headers.get("retry-after"));
            if (Number.isFinite(ra) && ra > 0) retryAfterMs = ra * 1000;
            lastErr = `HTTP ${res.status}`;
            await res.body?.cancel();
          } else if (!res.ok) {
            throw new FatalFetchError(`HTTP ${res.status} for ${url}`);
          } else {
            const text = await res.text();
            let body: unknown;
            try {
              body = text.trim() === "" ? null : JSON.parse(text);
            } catch {
              lastErr = `answer is not JSON (${text.slice(0, 60).replace(/\s+/g, " ")}…)`;
              body = undefined;
            }
            if (body !== undefined) {
              stats.network++;
              const entry = { fetched_at: new Date().toISOString(), body };
              opts.cache.put(shard, url, entry);
              return entry;
            }
          }
        } catch (e) {
          if (e instanceof FatalFetchError) throw e;
          lastErr = e instanceof Error ? e.message : String(e);
        }
        if (attempt < maxAttempts) {
          stats.retries++;
          const backoff = Math.min(60_000, 1000 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 250);
          const wait = Math.max(backoff, retryAfterMs);
          log(`  retry ${attempt}/${maxAttempts - 1} in ${Math.round(wait / 1000)}s: ${lastErr} — ${url}`);
          await sleep(wait);
        }
      }
      throw new Error(`gave up after ${maxAttempts} tries (${lastErr}): ${url}`);
    },
  };
}

class FatalFetchError extends Error {}

// --- The run ---------------------------------------------------------------------------

export interface IngestOptions {
  snapshot: string;
  offline: boolean;
  cacheDir?: string;
  outDir?: string;
  /** Snapshot id, folder path, or "none". Default: newest committed snapshot older than this one. */
  compareTo?: string;
  snapshotsDir?: string;
  makeMapPath?: string;
  denylistPath?: string;
  onlyMakes?: number[];
  minYear?: number;
  maxYear?: number;
  epaMinYear?: number;
  log?: (s: string) => void;
}

export interface IngestResult {
  outDir: string;
  built: BuiltSnapshot;
  manifest: VehicleManifest;
  previous: string | null;
  diffEmpty: boolean;
  stats: FetchStats;
}

/** Newest model year = the snapshot's calendar year + 1 (model years run ahead). */
export function newestModelYear(snapshot: string): number {
  return Number(snapshot.slice(0, 4)) + 1;
}

export async function runIngest(opts: IngestOptions): Promise<IngestResult> {
  const log = opts.log ?? ((s: string) => process.stderr.write(`${s}\n`));
  if (!isSnapshotId(opts.snapshot)) throw new Error(`--snapshot "${opts.snapshot}" is not a snapshot id (YYYY-MM-DD or YYYY-MM-DD-suffix)`);
  const snapshot = opts.snapshot;
  const snapshotsDir = opts.snapshotsDir ?? DEFAULT_SNAPSHOTS_DIR;
  const outDir = path.resolve(opts.outDir ?? path.join(snapshotsDir, snapshot));
  const cache = new SourceCache(path.resolve(opts.cacheDir ?? path.join(DEFAULT_CACHE_ROOT, snapshot)));
  const fetcher = makeFetcher({ cache, offline: opts.offline, log });
  const maxYear = opts.maxYear ?? newestModelYear(snapshot);
  const minYear = opts.minYear ?? VEHICLE_MIN_MODEL_YEAR;
  const epaMinYear = opts.epaMinYear ?? EPA_MIN_YEAR;
  const makeMap = parseMakeMap(readFileSync(opts.makeMapPath ?? DEFAULT_MAKE_MAP, "utf8"));
  const deny = parseDenylist(readFileSync(opts.denylistPath ?? DEFAULT_DENYLIST, "utf8"));
  const used: CacheEntry[] = [];
  const flags: ReviewFlag[] = [];

  // 1. Makes (union of car, mpv, truck by MakeId).
  log(`Snapshot ${snapshot}: model years ${minYear}–${maxYear}, EPA years ${epaMinYear}–${maxYear}${opts.offline ? " (offline)" : ""}`);
  const makeBodies = {} as Record<VehicleType, unknown>;
  for (const t of VEHICLE_TYPES) {
    const e = await fetcher.get("vpic-makes", vpicMakesUrl(t));
    used.push(e);
    makeBodies[t] = e.body;
  }
  const vpic = parseVpicMakes(makeBodies);
  const typeCounts = VEHICLE_TYPES.map((t) => `${vpicResults(makeBodies[t], t).results.length} ${t}`).join(", ");
  log(`vPIC makes: ${typeCounts} → ${vpic.length} unique`);

  // 2. Consumer filter: EPA make lists, every year.
  const epaByYear = new Map<number, string[]>();
  for (let y = epaMinYear; y <= maxYear; y++) {
    const e = await fetcher.get("epa-makes", epaMakesUrl(y), "application/json");
    used.push(e);
    epaByYear.set(y, parseEpaMakes(e.body));
  }
  fetcher.flush();
  const selection = selectMakes(vpic, epaByYear, makeMap);
  flags.push(...selection.flags);
  let makes = selection.kept;
  if (opts.onlyMakes && opts.onlyMakes.length > 0) {
    const only = new Set(opts.onlyMakes);
    makes = makes.filter((m) => only.has(m.make_id));
    log(`PARTIAL build: only make ids ${[...only].join(", ")}`);
  }
  log(`Kept ${makes.length} consumer makes`);

  // 3. Models: each make × year × type, by make ID (V1, V2, V4).
  const raw: RawModelRow[] = [];
  const perMake = (maxYear - minYear + 1) * VEHICLE_TYPES.length;
  const total = perMake * makes.length;
  const started = Date.now();
  let done = 0;
  for (const mk of makes) {
    const shard = `vpic-models/${mk.make_id}`;
    const jobs: Array<{ year: number; type: VehicleType }> = [];
    for (let y = minYear; y <= maxYear; y++) for (const t of VEHICLE_TYPES) jobs.push({ year: y, type: t });
    const results = new Array<{ year: number; type: VehicleType; body: unknown; url: string; e: CacheEntry }>(jobs.length);
    let next = 0;
    const worker = async () => {
      while (next < jobs.length) {
        const i = next++;
        const j = jobs[i]!;
        const url = vpicModelsUrl(mk.make_id, j.year, j.type);
        const e = await fetcher.get(shard, url);
        results[i] = { ...j, body: e.body, url, e };
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    fetcher.flush();
    for (const r of results) {
      used.push(r.e);
      const { results: rows, count } = vpicResults(r.body, r.url);
      if (count !== null && count !== rows.length) {
        flags.push({ kind: "vpic-count", make_id: mk.make_id, message: `${r.url}: Count ${count} but ${rows.length} rows.` });
      }
      for (const row of rows) {
        const makeId = row["Make_ID"];
        const name = row["Model_Name"];
        if (makeId !== mk.make_id) {
          flags.push({ kind: "vpic-foreign-row", make_id: mk.make_id, message: `${r.url}: a row for make ${String(makeId)} ("${String(name)}") was ignored.` });
          continue;
        }
        if (typeof name !== "string") continue;
        raw.push({ make_id: mk.make_id, year: r.year, type: r.type, name });
      }
    }
    done += perMake;
    const secs = (Date.now() - started) / 1000;
    const eta = fetcher.stats.network > 0 ? ((total - done) * secs) / done : 0;
    log(`  ${mk.display_name} (${mk.make_id}): ${done}/${total} lookups, ${Math.round(secs)}s so far${eta > 0 ? `, ~${Math.round(eta / 60)} min left` : ""}`);
  }

  // 4. Clean, merge, de-duplicate.
  const built = buildSnapshot({ snapshot, makes, rows: raw, deny });
  for (const mk of built.rows.makes) {
    const epa = selection.epaYears.get(mk.make_id) ?? new Set<number>();
    const ys = [...new Set(built.rows.model_years.filter((r) => r.make_id === mk.make_id).map((r) => r.model_year))];
    const missing = ys.filter((y) => y >= epaMinYear && !epa.has(y));
    if (missing.length > 0) {
      flags.push({
        kind: "years-not-on-epa",
        make_id: mk.make_id,
        message: `${mk.display_name}: vPIC has models in ${describeYears(missing)}, years EPA does not list this make.`,
      });
    }
  }
  built.flags.unshift(...flags);

  // 5. Diff against the previous snapshot.
  const prevDir = resolveCompareTo(opts.compareTo, snapshot, snapshotsDir, outDir);
  const prevRows = prevDir ? loadSnapshotRows(prevDir) : null;
  const prevId = prevDir ? readSnapshotIdOf(prevDir) : null;
  const diff = diffSnapshots(prevRows, built.rows, prevId, snapshot);

  // 6. Write the folder (to a temp folder first, then swap, so a failed run never leaves half a snapshot).
  const span = cache.span(used);
  const sourceNote =
    `NHTSA vPIC (makes + models by make ID, car/mpv/truck, ${minYear}–${maxYear}) and EPA FuelEconomy.gov make lists (${epaMinYear}–${maxYear})` +
    (span ? `, fetched ${span.first} → ${span.last}` : "") +
    `; ${used.length} answers` +
    (opts.onlyMakes && opts.onlyMakes.length > 0 ? `; PARTIAL build (make ids ${opts.onlyMakes.join(",")}) — do not upload` : "");
  const created = span ? span.last : new Date(0).toISOString();
  const manifest = writeSnapshotFolder(outDir, built, { created_at: created, source_note: sourceNote }, renderDiffReport(diff, built.flags, { sourceNote, featured: FEATURED_MAKES, nextRows: built.rows, dropped: built.dropped }));
  log(`Wrote ${outDir}: ${manifest.counts.makes} makes, ${manifest.counts.models} models, ${manifest.counts.model_years} model-year rows`);
  log(`Diff against ${prevId ?? "nothing (first snapshot)"}: ${diff.empty ? "no differences" : `${diff.makesAdded.length} makes added, ${diff.makesRemoved.length} removed, ${diff.modelsAdded.length} models added, ${diff.modelsRemoved.length} removed, ${diff.rowsRemoved} rows removed (${(diff.removedShare * 100).toFixed(2)}%)`}`);
  log(`Requests: ${fetcher.stats.network} from the network, ${fetcher.stats.cached} from the saved answers, ${fetcher.stats.retries} retries`);
  return { outDir, built, manifest, previous: prevId, diffEmpty: diff.empty, stats: fetcher.stats };
}

function readSnapshotIdOf(dir: string): string {
  const f = path.join(dir, "manifest.json");
  if (existsSync(f)) {
    const m = JSON.parse(readFileSync(f, "utf8")) as { snapshot?: unknown };
    if (isSnapshotId(m.snapshot)) return m.snapshot;
  }
  return path.basename(dir);
}

function resolveCompareTo(compareTo: string | undefined, snapshot: string, snapshotsDir: string, outDir: string): string | null {
  if (compareTo === "none") return null;
  if (compareTo) {
    const asDir = isSnapshotId(compareTo) ? path.join(snapshotsDir, compareTo) : path.resolve(compareTo);
    if (!existsSync(path.join(asDir, "rows", "model_years.json"))) throw new Error(`--compare-to ${compareTo}: no snapshot rows in ${asDir}`);
    return asDir;
  }
  if (!existsSync(snapshotsDir)) return null;
  const older = readdirSync(snapshotsDir)
    .filter((d) => isSnapshotId(d) && d < snapshot && existsSync(path.join(snapshotsDir, d, "rows", "model_years.json")))
    .sort();
  const prev = older[older.length - 1];
  return prev ? path.join(snapshotsDir, prev) : null;
}

/** Minified JSON for served files; one row per line for committed rows (readable diffs in review). */
function rowsJson(rows: unknown[]): string {
  return `[\n${rows.map((r) => JSON.stringify(r)).join(",\n")}\n]\n`;
}

export function sha256Hex(s: string | Buffer): string {
  return createHash("sha256").update(s).digest("hex");
}

export function writeSnapshotFolder(
  outDir: string,
  built: BuiltSnapshot,
  meta: { created_at: string; source_note: string },
  diffReport: string,
): VehicleManifest {
  const tmp = `${outDir}.tmp-${process.pid}`;
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(path.join(tmp, "makes"), { recursive: true });
  mkdirSync(path.join(tmp, "rows"), { recursive: true });
  const files: Record<string, string> = {};
  const put = (rel: string, text: string, served: boolean) => {
    writeFileSync(path.join(tmp, rel), text, "utf8");
    if (served) files[rel] = sha256Hex(text);
  };
  put("makes.json", JSON.stringify(built.makesFile), true);
  for (const f of built.makeFiles) put(`makes/${f.make_id}.json`, JSON.stringify(f), true);
  const sortedFiles: Record<string, string> = {};
  for (const k of Object.keys(files).sort()) sortedFiles[k] = files[k]!;
  const manifest: VehicleManifest = {
    snapshot: built.snapshot,
    created_at: meta.created_at,
    source_note: meta.source_note,
    counts: { makes: built.rows.makes.length, models: built.rows.models.length, model_years: built.rows.model_years.length },
    files: sortedFiles,
  };
  put("manifest.json", JSON.stringify(manifest), false);
  put("rows/makes.json", rowsJson(built.rows.makes), false);
  put("rows/models.json", rowsJson(built.rows.models), false);
  put("rows/model_years.json", rowsJson(built.rows.model_years), false);
  put("diff-report.md", diffReport, false);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(path.dirname(outDir), { recursive: true });
  renameSync(tmp, outDir);
  return manifest;
}

// --- CLI -------------------------------------------------------------------------------

function parseArgs(argv: string[]): IngestOptions {
  const opts: Partial<IngestOptions> & { offline: boolean } = { offline: false };
  const need = (i: number, flag: string) => {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) throw new Error(`${flag} needs a value`);
    return v;
  };
  const year = (v: string, flag: string) => {
    if (!/^\d{4}$/.test(v)) throw new Error(`${flag} must be a year`);
    return Number(v);
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    switch (a) {
      case "--snapshot": opts.snapshot = need(i, a); i++; break;
      case "--offline": opts.offline = true; break;
      case "--source-cache": opts.cacheDir = need(i, a); i++; break;
      case "--out": opts.outDir = need(i, a); i++; break;
      case "--compare-to": opts.compareTo = need(i, a); i++; break;
      case "--only-makes":
        opts.onlyMakes = need(i, a).split(",").map((s) => {
          if (!/^[1-9]\d*$/.test(s.trim())) throw new Error(`--only-makes: "${s}" is not a make id`);
          return Number(s.trim());
        });
        i++;
        break;
      case "--min-year": opts.minYear = year(need(i, a), a); i++; break;
      case "--max-year": opts.maxYear = year(need(i, a), a); i++; break;
      case "--epa-min-year": opts.epaMinYear = year(need(i, a), a); i++; break;
      case "--help":
      case "-h":
        process.stdout.write(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1, 24).map((l) => l.replace(/^\/\/ ?/, "")).join("\n") + "\n");
        process.exit(0);
      default:
        throw new Error(`unknown option ${a} (try --help)`);
    }
  }
  if (!opts.snapshot) throw new Error("--snapshot <YYYY-MM-DD> is required");
  return opts as IngestOptions;
}

const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  runIngest(parseArgs(process.argv.slice(2))).then(
    () => process.exit(0),
    (e: unknown) => {
      process.stderr.write(`ingest failed: ${e instanceof Error ? e.message : String(e)}\n`);
      process.exit(1);
    },
  );
}
