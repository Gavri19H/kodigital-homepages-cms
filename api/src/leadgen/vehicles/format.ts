// F18 Vehicle database (backlog F18, approved 23 Nov 2026).
//
// The vehicle list is a yearly copy ("snapshot") of the US government vehicle
// list (NHTSA vPIC), kept as ready-made JSON files (owner decision Q1: no
// database). This module owns the stored format of those files and the few
// pure helpers every reader shares: the yearly script that writes them
// (api/scripts/vehicles), the public lookup routes, the funnel page render,
// the answer checks and Section Studio. Pure functions, no I/O.
//
// Storage layout (R2 binding MEDIA, and a committed copy under
// api/scripts/vehicles/snapshots/{snapshot}/):
//   vehicles/live.json                          → { "snapshot": "<id>" } — the live pointer
//   vehicles/{snapshot}/makes.json              → VehicleMakesFile (lookup L1)
//   vehicles/{snapshot}/makes/{make_id}.json    → VehicleMakeFile  (lookups L2 + L3)
//   vehicles/{snapshot}/manifest.json           → VehicleManifest  (counts + checksums)
// A snapshot's files never change after upload, so every address that carries
// the snapshot id is cached for a year as immutable. Going live or rolling
// back only rewrites vehicles/live.json.

export const VEHICLE_R2_PREFIX = "vehicles/";
export const VEHICLE_LIVE_KEY = "vehicles/live.json";
export const VEHICLE_API_BASE = "/api/vehicles/v1";
/** Oldest model year the list carries (spec: 1981 → newest). */
export const VEHICLE_MIN_MODEL_YEAR = 1981;
/** Guardrail: a new snapshot may not remove more than this share of the previous one's (make, year, model) rows without a person's approval. */
export const VEHICLE_MAX_REMOVED_SHARE = 0.02;

/** One make in the makes list (L1). `name` is the cleaned display name. */
export interface VehicleMakeEntry {
  make_id: number;
  name: string;
  slug: string;
}

/** vehicles/{snapshot}/makes.json — every make in the snapshot, A→Z by name. */
export interface VehicleMakesFile {
  snapshot: string;
  makes: VehicleMakeEntry[];
}

/** One model of a make. `model_id` is stable across refreshes (spec N4). */
export interface VehicleModelEntry {
  model_id: string;
  name: string;
}

/** One model year of a make; `m` points into VehicleMakeFile.models. */
export interface VehicleYearEntry {
  year: number;
  m: number[];
}

/**
 * vehicles/{snapshot}/makes/{make_id}.json — every model the make ever had
 * (once each, A→Z ignoring case) and its model years, newest first, each
 * listing the indexes of that year's models.
 */
export interface VehicleMakeFile {
  snapshot: string;
  make_id: number;
  models: VehicleModelEntry[];
  years: VehicleYearEntry[];
}

/** vehicles/live.json */
export interface VehicleLivePointer {
  snapshot: string;
}

/** vehicles/{snapshot}/manifest.json — what the snapshot holds, for the data-totals check. */
export interface VehicleManifest {
  snapshot: string;
  created_at: string;
  source_note: string;
  counts: { makes: number; models: number; model_years: number };
  /** sha256 (hex) of each served file, keyed by its path under vehicles/{snapshot}/ (e.g. "makes.json", "makes/448.json"). */
  files: Record<string, string>;
}

// --- Full rows (committed with each snapshot, not served) -------------------
// The spec's data model, kept exactly, for diffs and checks.

export interface VehicleSnapshotMake {
  make_id: number;
  display_name: string;
  slug: string;
  min_year: number;
  max_year: number;
}

export interface VehicleSnapshotModel {
  model_id: string;
  make_id: number;
  display_name: string;
}

export interface VehicleSnapshotModelYear {
  make_id: number;
  model_year: number;
  model_id: string;
  /** e.g. "mpv,truck" */
  vehicle_types: string;
}

// --- Validation -------------------------------------------------------------

const SNAPSHOT_ID_RE = /^\d{4}-\d{2}-\d{2}(?:-[a-z0-9]{1,12})?$/;
const MAKE_ID_PARAM_RE = /^[1-9]\d{0,8}$/;
export const MODEL_ID_RE = /^m_[0-9a-f]{10}$/;

/** A snapshot id is its build date, optionally with a short suffix for a second build the same day. */
export function isSnapshotId(v: unknown): v is string {
  return typeof v === "string" && SNAPSHOT_ID_RE.test(v);
}

/** Parse a make_id path parameter: a positive whole number, else null (→ 400 invalid_param). */
export function parseMakeIdParam(raw: string | undefined | null): number | null {
  if (typeof raw !== "string" || !MAKE_ID_PARAM_RE.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

export function isModelId(v: unknown): v is string {
  return typeof v === "string" && MODEL_ID_RE.test(v);
}

// --- Paths ------------------------------------------------------------------

export function vehicleMakesKey(snapshot: string): string {
  return `${VEHICLE_R2_PREFIX}${snapshot}/makes.json`;
}

export function vehicleMakeKey(snapshot: string, makeId: number): string {
  return `${VEHICLE_R2_PREFIX}${snapshot}/makes/${makeId}.json`;
}

export function vehicleManifestKey(snapshot: string): string {
  return `${VEHICLE_R2_PREFIX}${snapshot}/manifest.json`;
}

/** Public lookup address for one make (served on the funnel's own host). */
export function vehicleMakeUrl(snapshot: string, makeId: number): string {
  return `${VEHICLE_API_BASE}/${snapshot}/makes/${makeId}`;
}

// --- Names ------------------------------------------------------------------

/** URL-safe slug of a make's display name: "Mercedes-Benz" → "mercedes-benz", "Land Rover" → "land-rover". */
export function slugifyMakeName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Media file name of a make's logo (owner decision Q11): vehicle-logo-{slug}.png */
export function vehicleLogoFilename(slug: string): string {
  return `vehicle-logo-${slug}.png`;
}

// --- Parsing stored files (fail-safe: a damaged file reads as null) ---------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isPositiveInt(v: unknown): v is number {
  return typeof v === "number" && Number.isSafeInteger(v) && v > 0;
}

export function parseLivePointer(v: unknown): VehicleLivePointer | null {
  if (!isRecord(v) || !isSnapshotId(v["snapshot"])) return null;
  return { snapshot: v["snapshot"] };
}

export function parseMakesFile(v: unknown): VehicleMakesFile | null {
  if (!isRecord(v) || !isSnapshotId(v["snapshot"]) || !Array.isArray(v["makes"])) return null;
  const makes: VehicleMakeEntry[] = [];
  for (const m of v["makes"]) {
    if (!isRecord(m) || !isPositiveInt(m["make_id"]) || typeof m["name"] !== "string" || typeof m["slug"] !== "string") {
      return null;
    }
    makes.push({ make_id: m["make_id"], name: m["name"], slug: m["slug"] });
  }
  return { snapshot: v["snapshot"], makes };
}

export function parseMakeFile(v: unknown): VehicleMakeFile | null {
  if (!isRecord(v) || !isSnapshotId(v["snapshot"]) || !isPositiveInt(v["make_id"])) return null;
  if (!Array.isArray(v["models"]) || !Array.isArray(v["years"])) return null;
  const models: VehicleModelEntry[] = [];
  for (const m of v["models"]) {
    if (!isRecord(m) || !isModelId(m["model_id"]) || typeof m["name"] !== "string") return null;
    models.push({ model_id: m["model_id"], name: m["name"] });
  }
  const years: VehicleYearEntry[] = [];
  for (const y of v["years"]) {
    if (!isRecord(y) || !isPositiveInt(y["year"]) || !Array.isArray(y["m"])) return null;
    const idx: number[] = [];
    for (const i of y["m"]) {
      if (typeof i !== "number" || !Number.isInteger(i) || i < 0 || i >= models.length) return null;
      idx.push(i);
    }
    years.push({ year: y["year"], m: idx });
  }
  return { snapshot: v["snapshot"], make_id: v["make_id"], models, years };
}

// --- Lookups on a parsed make file ------------------------------------------

/** The models a make had in one model year, in file order (A→Z), or [] when the year is unknown. */
export function modelsForYear(file: VehicleMakeFile, year: number): VehicleModelEntry[] {
  const y = file.years.find((e) => e.year === year);
  if (!y) return [];
  const out: VehicleModelEntry[] = [];
  for (const i of y.m) {
    const m = file.models[i];
    if (m) out.push(m);
  }
  return out;
}

/** Model years of a make, newest first (the file's own order). */
export function yearsOf(file: VehicleMakeFile): number[] {
  return file.years.map((y) => y.year);
}
