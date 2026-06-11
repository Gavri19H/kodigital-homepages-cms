// T21 [E4]: presets read handlers + shared contract for /api/admin/ai/presets*.
//
// Ported from the legacy admin presets CRUD (legacy reference, READ-ONLY)
// and adapted to this repo's prompt_presets schema (migration 0001 plus the
// text_model/image_model columns from migration 0011). The legacy
// model-branching shims and default model literals are stripped: model
// values are validated against SUPPORTED_TEXT_MODELS /
// SUPPORTED_IMAGE_MODELS and unsupported ids are rejected with 400, never
// silently "corrected". Write handlers live in ./ai-presets-write.

import type { Context } from "hono";
import type { Env } from "../env";
import { SUPPORTED_IMAGE_MODELS, SUPPORTED_TEXT_MODELS } from "../ai/models";

export type PresetCtx = Context<{ Bindings: Env }>;

export interface PresetRow {
  id: number;
  slug: string;
  prompt_template: string;
  category: string | null;
  variables: string | null;
  is_system: number;
  is_active: number;
  usage_count: number;
  text_model: string | null;
  image_model: string | null;
}

export interface PresetBody {
  slug?: string;
  prompt_template?: string;
  category?: string | null;
  variables?: string | null;
  text_model?: string;
  image_model?: string;
  is_system?: number;
  is_active?: number;
}

export const SELECT_PRESET_BY_ID = "SELECT * FROM prompt_presets WHERE id = ?";

export function isValidPresetId(raw: string): boolean {
  return /^\d+$/.test(raw);
}

export function normModel(value: unknown): string | undefined {
  if (typeof value !== "string" || value.trim() === "") return undefined;
  return value.trim();
}

// Returns a 400 message when a provided model id is outside the SUPPORTED
// registry lists; undefined values (model not provided) pass through.
export function modelValidationError(
  text_model: string | undefined,
  image_model: string | undefined,
): string | null {
  if (
    text_model !== undefined &&
    !(SUPPORTED_TEXT_MODELS as readonly string[]).includes(text_model)
  ) {
    return `Unsupported text_model: ${text_model}. Supported: ${SUPPORTED_TEXT_MODELS.join(", ")}`;
  }
  if (
    image_model !== undefined &&
    !(SUPPORTED_IMAGE_MODELS as readonly string[]).includes(image_model)
  ) {
    return `Unsupported image_model: ${image_model}. Supported: ${SUPPORTED_IMAGE_MODELS.join(", ")}`;
  }
  return null;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const n = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// GET /api/admin/ai/presets — list with optional category/active_only
// filters and page/per_page pagination (legacy response shape).
export async function listPresets(c: PresetCtx) {
  const q = c.req.query();
  const page = parsePositiveInt(q.page, 1);
  const perPage = Math.min(parsePositiveInt(q.per_page, 50), 200);
  const offset = (page - 1) * perPage;

  // WHERE is concatenated from FIXED literal fragments only (file
  // convention: no template-literal SQL); user values go through .bind().
  const clauses: string[] = ["1=1"];
  const params: unknown[] = [];
  if (q.category) {
    clauses.push("category = ?");
    params.push(q.category);
  }
  if (q.active_only === "true") clauses.push("is_active = 1");
  const where = clauses.join(" AND ");

  const countRow = await c.env.DB.prepare(
    "SELECT COUNT(*) as count FROM prompt_presets WHERE " + where,
  )
    .bind(...params)
    .first<{ count: number }>();
  const total = countRow?.count ?? 0;

  const { results } = await c.env.DB.prepare(
    "SELECT * FROM prompt_presets WHERE " +
      where +
      " ORDER BY is_system DESC, usage_count DESC, slug ASC LIMIT ? OFFSET ?",
  )
    .bind(...params, perPage, offset)
    .all<PresetRow>();

  return c.json({
    items: results ?? [],
    pagination: {
      page,
      per_page: perPage,
      total,
      total_pages: Math.max(1, Math.ceil(total / perPage)),
    },
  });
}

// GET /api/admin/ai/presets/:id
export async function getPreset(c: PresetCtx) {
  const id = c.req.param("id") ?? "";
  if (!isValidPresetId(id)) return c.json({ error: "Invalid preset ID" }, 400);
  const preset = await c.env.DB.prepare(SELECT_PRESET_BY_ID)
    .bind(id)
    .first<PresetRow>();
  if (!preset) return c.json({ error: "Preset not found" }, 404);
  return c.json({ item: preset });
}

// POST /api/admin/ai/presets/:id/use — usage counter (legacy parity: no
// existence check, the increment is a no-op for unknown ids).
export async function usePreset(c: PresetCtx) {
  const id = c.req.param("id") ?? "";
  if (!isValidPresetId(id)) return c.json({ error: "Invalid preset ID" }, 400);
  await c.env.DB.prepare(
    "UPDATE prompt_presets SET usage_count = usage_count + 1 WHERE id = ?",
  )
    .bind(id)
    .run();
  return c.json({ success: true });
}
