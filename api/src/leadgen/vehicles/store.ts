// F18 Vehicle database: reading the ready-made files from R2 (binding MEDIA).
//
// Every reader goes through here: the public lookup routes, the funnel page
// render, the answer checks before an Auction, the Offer name expansion and
// Section Studio. Snapshot files never change after upload, so a parsed copy
// is kept in this Worker instance's memory (bounded). The live pointer
// (vehicles/live.json) can change, so it is re-read at most once a minute.
// Any R2 or parse failure reads as "not available" (null) with a warning —
// callers fail open (a funnel page never breaks because of the vehicle list).

import { mediaUrl } from "../../public/view-models/media-url";
import {
  VEHICLE_LIVE_KEY,
  parseLivePointer,
  parseMakeFile,
  parseMakesFile,
  vehicleLogoFilename,
  vehicleMakeKey,
  vehicleMakesKey,
  type VehicleMakeEntry,
  type VehicleMakeFile,
  type VehicleMakesFile,
} from "./format";
import { VEHICLE_DEFAULT_FEATURED_MAKE_NAMES, readVehicleSource } from "./props";

export interface VehicleStoreEnv {
  MEDIA: R2Bucket;
}

export interface VehicleLogoEnv {
  DB: D1Database;
}

const LIVE_POINTER_TTL_MS = 60_000;
const FILE_MEMO_MAX = 300;

let liveMemo: { snapshot: string | null; at: number } | null = null;
const textMemo = new Map<string, { text: string; etag: string }>();
const parsedMemo = new Map<string, VehicleMakesFile | VehicleMakeFile>();

function remember<V>(map: Map<string, V>, key: string, value: V): void {
  if (map.size >= FILE_MEMO_MAX) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
  map.set(key, value);
}

/** Test hook: forget everything kept in memory. */
export function resetVehicleStoreMemo(): void {
  liveMemo = null;
  textMemo.clear();
  parsedMemo.clear();
}

/**
 * The raw text of one immutable snapshot file (never the live pointer), or
 * null when it doesn't exist or can't be read.
 */
export async function readVehicleFileText(
  env: VehicleStoreEnv,
  key: string,
): Promise<{ text: string; etag: string } | null> {
  const hit = textMemo.get(key);
  if (hit) return hit;
  try {
    const obj = await env.MEDIA.get(key);
    if (!obj) return null;
    const text = await obj.text();
    const out = { text, etag: obj.httpEtag };
    remember(textMemo, key, out);
    return out;
  } catch (err) {
    console.warn("[vehicles] R2 read failed", key, err instanceof Error ? err.message : "unknown");
    return null;
  }
}

async function readParsed<T extends VehicleMakesFile | VehicleMakeFile>(
  env: VehicleStoreEnv,
  key: string,
  parse: (v: unknown) => T | null,
): Promise<T | null> {
  const hit = parsedMemo.get(key);
  if (hit) return hit as T;
  const raw = await readVehicleFileText(env, key);
  if (!raw) return null;
  let json: unknown;
  try {
    json = JSON.parse(raw.text);
  } catch {
    console.warn("[vehicles] unreadable JSON", key);
    textMemo.delete(key);
    return null;
  }
  const parsed = parse(json);
  if (!parsed) {
    console.warn("[vehicles] file does not match the vehicle format", key);
    textMemo.delete(key);
    return null;
  }
  remember(parsedMemo, key, parsed);
  return parsed;
}

/** The live snapshot id from vehicles/live.json, or null when none is live. Re-read at most once a minute. */
export async function readLiveSnapshotId(env: VehicleStoreEnv, now: number = Date.now()): Promise<string | null> {
  if (liveMemo && now - liveMemo.at < LIVE_POINTER_TTL_MS) return liveMemo.snapshot;
  let snapshot: string | null = null;
  try {
    const obj = await env.MEDIA.get(VEHICLE_LIVE_KEY);
    if (obj) {
      try {
        snapshot = parseLivePointer(JSON.parse(await obj.text()))?.snapshot ?? null;
      } catch {
        console.warn("[vehicles] unreadable live pointer");
      }
    }
  } catch (err) {
    console.warn("[vehicles] live pointer read failed", err instanceof Error ? err.message : "unknown");
    // Keep serving the last known pointer through a short R2 hiccup.
    if (liveMemo) return liveMemo.snapshot;
  }
  liveMemo = { snapshot, at: now };
  return snapshot;
}

export function readMakesFile(env: VehicleStoreEnv, snapshot: string): Promise<VehicleMakesFile | null> {
  return readParsed(env, vehicleMakesKey(snapshot), parseMakesFile);
}

export function readMakeFile(env: VehicleStoreEnv, snapshot: string, makeId: number): Promise<VehicleMakeFile | null> {
  return readParsed(env, vehicleMakeKey(snapshot, makeId), parseMakeFile);
}

/**
 * Logo URLs for the given make slugs (owner decision Q11): the newest global
 * Media upload (site_id IS NULL) named vehicle-logo-{slug}.png. Slugs without
 * a logo are left out. Never throws.
 */
export async function findVehicleLogoUrls(env: VehicleLogoEnv, slugs: readonly string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const unique = [...new Set(slugs)].filter((s) => /^[a-z0-9-]{1,60}$/.test(s));
  if (unique.length === 0) return out;
  const byFile = new Map(unique.map((s) => [vehicleLogoFilename(s), s] as const));
  const names = [...byFile.keys()];
  try {
    for (let i = 0; i < names.length; i += 80) {
      const chunk = names.slice(i, i + 80);
      const placeholders = chunk.map(() => "?").join(",");
      const rows = await env.DB.prepare(
        `SELECT filename, storage_key FROM media WHERE site_id IS NULL AND filename IN (${placeholders}) ORDER BY created_at ASC, id ASC`,
      )
        .bind(...chunk)
        .all<{ filename: string; storage_key: string }>();
      // Ascending order: a later (newer) row overwrites an older one, so the newest upload wins.
      for (const r of rows.results ?? []) {
        const slug = byFile.get(r.filename);
        const url = typeof r.storage_key === "string" ? mediaUrl(r.storage_key) : null;
        if (slug && url) out[slug] = url;
      }
    }
  } catch (err) {
    console.warn("[vehicles] logo lookup failed", err instanceof Error ? err.message : "unknown");
  }
  return out;
}

// --- What a page render needs ----------------------------------------------

/** Vehicle data handed to the section renderers through LeadgenSectionRenderCtx.vehicle. */
export interface VehicleRenderData {
  /** The live snapshot id the page was rendered with (it also joins the page cache key). */
  snapshot: string;
  /** Every make in the snapshot, A→Z. */
  makes: VehicleMakeEntry[];
  /** slug → logo URL, for makes that have a logo (looked up only when a logo-card Make question is present). */
  logos: Record<string, string>;
  /** The pre-filled featured makes (Q8) resolved to make_ids against this snapshot, in order. */
  default_featured: number[];
  /** Studio canvas / preview only: a sample make (Toyota) so Year and Model questions show real choices. */
  sample: VehicleMakeFile | null;
}

interface MinimalNode {
  type?: unknown;
  props?: unknown;
}

/**
 * Load what the renderers need for the given components (already flattened or
 * not — containers are walked). Returns null — and reads nothing — when no
 * component uses the vehicle database, or when no snapshot is live / readable.
 */
export async function loadVehicleRenderData(
  env: VehicleStoreEnv & VehicleLogoEnv,
  nodes: readonly unknown[],
  opts: { sample?: boolean } = {},
): Promise<VehicleRenderData | null> {
  const found: { type: string; asks: string }[] = [];
  const walk = (list: readonly unknown[], depth: number): void => {
    if (depth > 6) return;
    for (const n of list) {
      if (typeof n !== "object" || n === null) continue;
      const node = n as MinimalNode & { children?: unknown };
      if (Array.isArray(node.children)) walk(node.children, depth + 1);
      if (typeof node.type !== "string") continue;
      const cfg = readVehicleSource(node.type, node.props);
      if (cfg) found.push({ type: node.type, asks: cfg.asks });
    }
  };
  walk(nodes, 0);
  if (found.length === 0) return null;

  const snapshot = await readLiveSnapshotId(env);
  if (!snapshot) return null;
  const makesFile = await readMakesFile(env, snapshot);
  if (!makesFile) return null;

  const byName = new Map(makesFile.makes.map((m) => [m.name.toLowerCase(), m.make_id] as const));
  const default_featured = VEHICLE_DEFAULT_FEATURED_MAKE_NAMES.map((n) => byName.get(n.toLowerCase())).filter(
    (id): id is number => typeof id === "number",
  );

  const wantsLogos = found.some((f) => f.asks === "make" && (f.type === "IconCardAnswerGrid" || f.type === "ImageCardAnswerGrid"));
  const logos = wantsLogos ? await findVehicleLogoUrls(env, makesFile.makes.map((m) => m.slug)) : {};

  let sample: VehicleMakeFile | null = null;
  if (opts.sample && found.some((f) => f.asks !== "make")) {
    const toyota = byName.get("toyota");
    if (toyota !== undefined) sample = await readMakeFile(env, snapshot, toyota);
  }
  return { snapshot, makes: makesFile.makes, logos, default_featured, sample };
}
