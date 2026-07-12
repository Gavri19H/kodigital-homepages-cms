// LeadGen v3.1 §10/§12 — the KV `lg-funnel-themes` store's I/O primitives.
// Split out of the admin-owned themes-handlers.ts (fix round: §12 parity
// requires the LIVE runtime path — serve.ts, a PUBLIC module — to fetch the
// SAME theme records the admin Themes-manager CRUD writes). Living here
// (src/public/leadgen/designs/, alongside theme.ts/frames.ts/registry.ts)
// keeps the dependency direction the codebase already uses everywhere else
// (admin imports FROM public — sections-handlers.ts imports resolveFrame-
// Composition from serve.ts, frame-handlers.ts imports resolveTokens from
// here) rather than introducing a NEW public → admin edge.
//
// theme.ts stays "PURE: no DB, no Hono, no admin imports" (its own header) —
// KV IS I/O, so these functions live in a SEPARATE module theme.ts does not
// import; theme.ts's resolveTokens instead takes an already-fetched
// ThemeRecord as a plain parameter (its 4th arg).
//
// Storage: one JSON map keyed by theme id under the existing CACHE KV
// binding — no migration, no new namespace (§11.2), mirroring the v2.5 §6.6
// component-presets KV pattern (sections-handlers.ts readComponentPresets)
// exactly: defensive parse, a corrupt or shape-mismatched blob degrades to
// {} and the next write repairs it — never throws.

import {
  THEME_RECORD_BUTTON_SIZES,
  THEME_RECORD_CORNERS,
  THEME_RECORD_FIELD_HEIGHTS,
  THEME_RECORD_ROLE_KEYS,
  isThemeRecordFontName,
  type ThemeRecord,
} from "./theme";

export const LEADGEN_THEMES_KV_KEY = "lg-funnel-themes";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isThemeRecordShape(value: unknown): value is ThemeRecord {
  if (!isRecord(value)) return false;
  if (typeof value["id"] !== "string" || typeof value["name"] !== "string") return false;

  const roles = value["roles"];
  if (!isRecord(roles) || !THEME_RECORD_ROLE_KEYS.every((key) => typeof roles[key] === "string")) {
    return false;
  }

  // P0 stored-XSS defense-in-depth: a KV blob whose typography names fall
  // outside the closed whitelist (e.g. hand-edited KV, or pre-fix stored
  // data) is a SHAPE MISMATCH, not a valid record — it degrades to "absent"
  // (readThemeRecords filters it out) rather than ever being handed to
  // resolveTokens. The authoritative gate is still validateThemeBody
  // (themes-handlers.ts) at write time; this is the second layer.
  const typography = value["typography"];
  if (
    !isRecord(typography) ||
    !isThemeRecordFontName(typography["headline_font"]) ||
    !isThemeRecordFontName(typography["body_font"]) ||
    typeof typography["base_px"] !== "number"
  ) {
    return false;
  }

  const controls = value["controls"];
  if (
    !isRecord(controls) ||
    !(THEME_RECORD_FIELD_HEIGHTS as readonly string[]).includes(controls["field_height"] as string) ||
    !(THEME_RECORD_BUTTON_SIZES as readonly string[]).includes(controls["button_size"] as string) ||
    !(THEME_RECORD_CORNERS as readonly string[]).includes(controls["corners"] as string)
  ) {
    return false;
  }

  if (value["spacing"] !== undefined && typeof value["spacing"] !== "string") return false;
  return true;
}

// Defensive KV read (the D1 JSON-parse rule applied to KV): a corrupt blob —
// or a blob holding a shape that predates a future record-shape change —
// degrades to {} and the next write repairs it; never throws. Every reader
// (admin CRUD, the live serve path, the assignment-write existence check)
// shares this ONE parse so a shape drift can never be interpreted two ways.
export async function readThemeRecords(kv: KVNamespace): Promise<Record<string, ThemeRecord>> {
  const raw = await kv.get(LEADGEN_THEMES_KV_KEY);
  if (raw === null) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) return {};
    const out: Record<string, ThemeRecord> = {};
    for (const [id, value] of Object.entries(parsed)) {
      if (isThemeRecordShape(value)) out[id] = value;
    }
    return out;
  } catch {
    return {};
  }
}

export async function writeThemeRecords(kv: KVNamespace, records: Record<string, ThemeRecord>): Promise<void> {
  await kv.put(LEADGEN_THEMES_KV_KEY, JSON.stringify(records));
}

// One theme id's record — the resolve-layer (live serve.ts, section preview
// theme_id, quote-builder composed preview) and the assignment write-path
// existence check (funnel PUT theme, variant PUT frame_overrides_json) all
// need a single-id lookup without paying for a full list scan twice.
export async function getThemeRecord(kv: KVNamespace, id: string): Promise<ThemeRecord | null> {
  const records = await readThemeRecords(kv);
  return records[id] ?? null;
}

// v3.1 §10.1's assignment write-path existence check: "theme_id must exist
// in the store."
export async function themeRecordExists(kv: KVNamespace, id: string): Promise<boolean> {
  return (await getThemeRecord(kv, id)) !== null;
}
