// F18 Vehicle database — the admin JSON routes Section Studio reads.
//
//   GET /api/admin/leadgen/vehicles/live
//     The live vehicle list: its snapshot id, the make count, every make
//     (A→Z, with its logo when one is uploaded to Media) and the pre-filled
//     featured makes (owner decision Q8) resolved to make_ids.
//   GET /api/admin/leadgen/vehicles/makes/:make_id
//     One make of the live list: name, slug, logo and every model year
//     (newest first) with that year's models. Feeds "Look up a make".
//   GET /api/admin/leadgen/sections/:id/vehicle-fields
//     The Make and Year questions a Section's Year / Model question can link
//     to ("Make answer comes from" / "Year answer comes from"): the Section's
//     own components plus the components of every Section shown in the same
//     funnels (the funnels that use this Section, and the Quote's shared
//     first page).
//
// Mounted under /api/admin/leadgen, so the Cloudflare Access gate and the
// router's private no-store header apply. Reads only: the vehicle files in R2
// (MEDIA, through the shared store) and D1.

import { modelsForYear, parseMakeIdParam } from "../../leadgen/vehicles/format";
import { VEHICLE_DEFAULT_FEATURED_MAKE_NAMES, readVehicleSource } from "../../leadgen/vehicles/props";
import { findVehicleLogoUrls, readLiveSnapshotId, readMakeFile, readMakesFile } from "../../leadgen/vehicles/store";
import type { AdminContext } from "./offers-handlers";
import { resolveSectionRow } from "./sections-handlers";

const NO_LIVE_LIST = { error: "no_live_list", message: "No vehicle list is live yet." } as const;

/** GET /vehicles/live */
export async function vehiclesLiveHandler(c: AdminContext): Promise<Response> {
  const snapshot = await readLiveSnapshotId(c.env);
  if (!snapshot) return c.json(NO_LIVE_LIST, 404);
  const file = await readMakesFile(c.env, snapshot);
  if (!file) return c.json({ error: "unknown_snapshot", message: "The live vehicle list could not be read." }, 404);
  const logos = await findVehicleLogoUrls(c.env, file.makes.map((m) => m.slug));
  const byName = new Map(file.makes.map((m) => [m.name.toLowerCase(), m.make_id] as const));
  const defaultFeatured = VEHICLE_DEFAULT_FEATURED_MAKE_NAMES.map((n) => byName.get(n.toLowerCase())).filter(
    (id): id is number => typeof id === "number",
  );
  return c.json({
    snapshot,
    make_count: file.makes.length,
    makes: file.makes.map((m) => ({ make_id: m.make_id, name: m.name, slug: m.slug, logo_url: logos[m.slug] ?? null })),
    default_featured: defaultFeatured,
  });
}

/** GET /vehicles/makes/:make_id */
export async function vehicleMakeHandler(c: AdminContext): Promise<Response> {
  const makeId = parseMakeIdParam(c.req.param("make_id"));
  if (makeId === null) return c.json({ error: "invalid_param", message: "make_id must be a positive whole number." }, 400);
  const snapshot = await readLiveSnapshotId(c.env);
  if (!snapshot) return c.json(NO_LIVE_LIST, 404);
  const makes = await readMakesFile(c.env, snapshot);
  const entry = makes?.makes.find((m) => m.make_id === makeId) ?? null;
  const file = entry ? await readMakeFile(c.env, snapshot, makeId) : null;
  if (!entry || !file) return c.json({ error: "unknown_make", message: "This make is not in the live vehicle list." }, 404);
  const logos = await findVehicleLogoUrls(c.env, [entry.slug]);
  return c.json({
    snapshot,
    make_id: entry.make_id,
    name: entry.name,
    slug: entry.slug,
    logo_url: logos[entry.slug] ?? null,
    // The file keeps years newest first.
    years: file.years.map((y) => ({ year: y.year, models: modelsForYear(file, y.year) })),
  });
}

// --- GET /sections/:id/vehicle-fields -----------------------------------------

export interface VehicleLinkField {
  /** internal_field of the Make / Year question */
  field: string;
  /** the question's own label, else its Section's headline, else the field */
  label: string;
  asks: "make" | "year";
  section_public_id: string;
  section_name: string;
}

interface SectionContentRow {
  id: number;
  public_id: string;
  section_name: string;
  headline_text: string | null;
  content_json: string | null;
}

// Every Section shown in the same funnels as this one: Sections on the
// variants that use it, on every variant of a Quote whose shared first page
// holds it, and on the shared first page of each of those Quotes.
const SECTIONS_SHARING_FUNNELS_SQL = `
WITH placed_variants AS (
  SELECT fvs.variant_id AS variant_id
  FROM leadgen_funnel_variant_sections fvs
  WHERE fvs.section_id = ? AND fvs.variant_id IS NOT NULL
  UNION
  SELECT v.id AS variant_id
  FROM leadgen_funnel_variant_sections fvs
  JOIN leadgen_funnels f ON f.quote_id = fvs.quote_id
  JOIN leadgen_funnel_variants v ON v.funnel_id = f.id
  WHERE fvs.section_id = ? AND fvs.quote_id IS NOT NULL
),
placed_quotes AS (
  SELECT f.quote_id AS quote_id
  FROM placed_variants pv
  JOIN leadgen_funnel_variants v ON v.id = pv.variant_id
  JOIN leadgen_funnels f ON f.id = v.funnel_id
  UNION
  SELECT fvs.quote_id AS quote_id
  FROM leadgen_funnel_variant_sections fvs
  WHERE fvs.section_id = ? AND fvs.quote_id IS NOT NULL
)
SELECT DISTINCT s.id AS id, s.public_id AS public_id, s.section_name AS section_name,
       s.headline_text AS headline_text, s.content_json AS content_json
FROM leadgen_funnel_variant_sections x
JOIN leadgen_sections s ON s.id = x.section_id
WHERE s.id <> ?
  AND (x.variant_id IN (SELECT variant_id FROM placed_variants)
       OR x.quote_id IN (SELECT quote_id FROM placed_quotes))
ORDER BY s.section_name ASC, s.id ASC
LIMIT 500`;

function vehicleLinkFieldsOf(row: SectionContentRow): VehicleLinkField[] {
  let content: unknown;
  try {
    content = typeof row.content_json === "string" ? JSON.parse(row.content_json) : null;
  } catch {
    return [];
  }
  const components = content && typeof content === "object" ? (content as { components?: unknown }).components : null;
  if (!Array.isArray(components)) return [];
  const out: VehicleLinkField[] = [];
  const headline = typeof row.headline_text === "string" ? row.headline_text.trim() : "";
  const walk = (list: readonly unknown[], depth: number): void => {
    if (depth > 6) return;
    for (const n of list) {
      if (typeof n !== "object" || n === null) continue;
      const node = n as { type?: unknown; props?: unknown; internal_field?: unknown; children?: unknown };
      if (Array.isArray(node.children)) walk(node.children, depth + 1);
      if (typeof node.type !== "string") continue;
      const cfg = readVehicleSource(node.type, node.props);
      if (!cfg || (cfg.asks !== "make" && cfg.asks !== "year")) continue;
      const field = typeof node.internal_field === "string" ? node.internal_field.trim() : "";
      if (field === "") continue;
      const ownLabel = (node.props as { label?: unknown }).label;
      const label = typeof ownLabel === "string" && ownLabel.trim() !== "" ? ownLabel.trim() : headline !== "" ? headline : field;
      out.push({ field, label, asks: cfg.asks, section_public_id: row.public_id, section_name: row.section_name });
    }
  };
  walk(components, 0);
  return out;
}

export async function sectionVehicleFieldsHandler(c: AdminContext): Promise<Response> {
  const row = await resolveSectionRow(c.env.DB, c.req.param("id") ?? "");
  if (row === null) return c.json({ error: "Not Found" }, 404);
  const others = await c.env.DB.prepare(SECTIONS_SHARING_FUNNELS_SQL)
    .bind(row.id, row.id, row.id, row.id)
    .all<SectionContentRow>();
  const fields: VehicleLinkField[] = [];
  const seen = new Set<string>();
  for (const s of [row as SectionContentRow, ...(others.results ?? [])]) {
    for (const f of vehicleLinkFieldsOf(s)) {
      const key = `${f.section_public_id}|${f.field}|${f.asks}`;
      if (seen.has(key)) continue;
      seen.add(key);
      fields.push(f);
    }
  }
  return c.json({ fields });
}
