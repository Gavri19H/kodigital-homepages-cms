// LeadGen v2.5 Quote Builder frame/theme/branding admin API — the 04 §4.8
// route-table rows the quotes module doesn't already own, split out per the
// contract's "or a new frame-handlers.ts if size demands" option:
//
//   GET  /funnels/:id/frame     {frame_config, effective_frame, template_defaults}
//   PUT  /funnels/:id/frame     validate (03 §3.3) → persist → bump (03 §3.1)
//   GET  /funnels/:id/theme     {theme, effective_tokens} (09 §9.2 role table)
//   PUT  /funnels/:id/theme     validate (09 §9.3) → persist → bump
//   GET  /frame-templates       registry projection (04 §4.3 — code, not DB)
//   GET  /sites/:site_id/branding  10 §10.5 (read-only; ALL CMS sites, C4)
//
// Conventions mirror quotes-handlers (03 §8.4/§8.5): auth is router-level
// (Cloudflare Access on /api/admin/*), failures are `{error, fields?}` 4xx
// with the v2.5-additive §3.6 `problems[]`, ids resolve dual (numeric or
// public lgf_), all SQL is .bind()-parameterized. Save-time validation is the
// 14 §14.3 gate: an invalid frame/theme is NEVER persisted (400 + problems);
// warning-severity rows persist WITH the save and ride the response. Every
// successful PUT bumps `content_version` on the funnel's ACTIVE variants —
// the 03 §3.1 cache-propagation rule (the shell/config cache keys already
// carry the content_version axis; no new axis).

import {
  DEFAULT_FRAME_TEMPLATE_ID,
  FRAME_TEMPLATES,
  FRAME_TEMPLATE_IDS,
  computeTemplateApply,
  computeTemplateSwitch,
  effectiveFrame,
  parseSavedFrameTemplateDefaults,
  validateFrameConfig,
  type EffectiveFrameConfig,
  type FrameTemplateDef,
  type StoredFrameConfig,
} from "../../public/leadgen/designs/frames";
import { isThemeIdRef, resolveTokens, validateTheme } from "../../public/leadgen/designs/theme";
import type { Problem, ThemeIdRef, ThemeJson } from "../../public/leadgen/designs/theme";
import { getFunnelDesign } from "../../public/leadgen/designs/registry";
import { resolveSiteBranding } from "../../leadgen/branding";
import { escapeHtml } from "../templates/layout";
import { idSelector, parseJsonColumn, readJsonBody, type AdminContext } from "./offers-handlers";
import { mintPublicId } from "../../leadgen/ids";
// v3.1 §10.1: a funnel's theme_json may reference a KV `lg-funnel-themes`
// record ({theme_id}) instead of the legacy inline shape — this module owns
// the funnel PUT /funnels/:id/theme write path, so it performs the
// "theme_id must exist in the store" check (theme.ts's validateTheme stays
// PURE and only checks structure) and resolves the record for the GET
// projection's effective_tokens.
import { getThemeRecord, themeRecordExists } from "./themes-handlers";
import {
  bumpActiveVariantContentVersions,
  readFunnelVariants,
  resolveFunnelRow,
} from "./quotes-handlers";
import type { LeadgenFrameTemplateRow, LeadgenFunnelRow } from "./db-types";

// ---------------------------------------------------------------------------
// small local helpers
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// A stored 0041 JSON column → the parsed object, or null (absent/corrupt —
// the same defensive read every *_json column takes; invalidity is REPORTED
// by the validators/preflight, never thrown here).
function parsedJsonRecord(raw: string | null | undefined): Record<string, unknown> | null {
  const parsed = parseJsonColumn(raw ?? null);
  return isRecord(parsed) ? parsed : null;
}

// The theme editor resolves swatches against the funnel's base-design head
// (04 §4.8 — `funnel_design_id` stays a Variant field, 03 §3.2). Rework M1
// (§4.3-10): no is_control axis — readFunnelVariants orders variant_label ASC,
// so [0] is the funnel's single active variant (label 'A' with no test). A
// variantless funnel degrades to the default design (the registry fallback).
async function funnelBaseDesignId(db: D1Database, funnel: LeadgenFunnelRow): Promise<string> {
  const variants = await readFunnelVariants(db, funnel.id);
  return variants[0]?.funnel_design_id ?? "default";
}

// ---------------------------------------------------------------------------
// GET/PUT /funnels/:id/frame (04 §4.8 rows 1–2)
// ---------------------------------------------------------------------------

// Rework M5 (§5, S2.2 follow-up): resolves a funnel's saved frame-template
// defaults (frame_template_id → leadgen_frame_templates.frame_json) for
// frameProjection's 4th effectiveFrame arg. This route is funnel-only (no
// variant param), so the general M5 order (variant.frame_template_id ??
// funnel.frame_template_id) collapses to funnel.frame_template_id alone —
// reuses resolveFrameTemplateRow below for the actual row fetch (numeric id,
// stringified — the SAME dual public_id/numeric selector that function's own
// route callers use). NULL ftid or a since-deleted/corrupt row ⇒ null ⇒
// frameProjection omits effectiveFrame's 4th arg ⇒ byte-identical legacy.
async function resolveSavedFrameTemplateDefaults(
  db: D1Database,
  ftid: number | null,
): Promise<EffectiveFrameConfig | null> {
  if (ftid === null) return null;
  const row = await resolveFrameTemplateRow(db, String(ftid));
  return row === null ? null : parseSavedFrameTemplateDefaults(row.frame_json);
}

// The shared GET/PUT-success projection: the stored sparse config, the
// effective frame (template ⊕ stored — what preview uses, ONE merge
// implementation, 13 §13.2), and the CURRENT template's registry defaults.
function frameProjection(
  stored: Record<string, unknown> | null,
  savedTemplateDefaults: EffectiveFrameConfig | null,
): Record<string, unknown> {
  const { frame, problems } = effectiveFrame(
    stored as StoredFrameConfig | null,
    undefined,
    undefined,
    savedTemplateDefaults,
  );
  return {
    frame_config: stored,
    effective_frame: frame,
    template_defaults: FRAME_TEMPLATES[frame.template].defaults,
    problems,
  };
}

export async function getFunnelFrameHandler(c: AdminContext): Promise<Response> {
  const funnel = await resolveFunnelRow(c.env.DB, c.req.param("id") ?? "");
  if (funnel === null) return c.json({ error: "Not Found" }, 404);
  const stored = parsedJsonRecord(funnel.frame_config_json);

  // --- ?switch_to=<templateId> (04 §4.3, C5) — READ-ONLY template-switch
  // projection: the per-GROUP three-way merge + the confirmation lines the
  // picker dialog shows. NOTHING persists — the builder previews the merged
  // result via POST /variants/:id/preview {draft_frame_config} and only Save
  // writes it. Same route, additive query param (no new registration).
  const switchTo = c.req.query("switch_to");
  if (switchTo !== undefined && switchTo.trim() !== "") {
    const { merged, confirmations } = computeTemplateSwitch(
      stored as StoredFrameConfig | null,
      switchTo.trim(),
    );
    return c.json({ merged, confirmations });
  }

  const savedDefaults = await resolveSavedFrameTemplateDefaults(c.env.DB, funnel.frame_template_id);
  const projection = frameProjection(stored, savedDefaults);
  // Additive §3.6: a stored config's validation rows (e.g. the §4.4 manual-
  // logo warning, or drift errors the preflight also reports) surface on load
  // so the builder opens with the truth. NULL column = legacy → no rows.
  if (stored !== null) {
    const validation = validateFrameConfig(stored);
    projection["problems"] = [...validation.problems, ...(projection["problems"] as Problem[])];
  }
  return c.json(projection);
}

export async function putFunnelFrameHandler(c: AdminContext): Promise<Response> {
  const funnel = await resolveFunnelRow(c.env.DB, c.req.param("id") ?? "");
  if (funnel === null) return c.json({ error: "Not Found" }, 404);
  const body = await readJsonBody(c);
  if (body === null) return c.json({ error: "Invalid JSON body" }, 400);

  const raw = body["frame_config_json"];
  if (!isRecord(raw)) {
    return c.json(
      { error: "Validation failed", fields: { frame_config_json: "frame_config_json must be a JSON object" } },
      400,
    );
  }

  // 14 §14.3 save-time gate: error severity → 400 + §3.6 problems, nothing
  // persisted; warnings (§4.4 manual logo, …) persist WITH the save.
  const validation = validateFrameConfig(raw);
  if (validation.config === null) {
    return c.json({ error: "Validation failed", problems: validation.problems }, 400);
  }

  const savedDefaults = await resolveSavedFrameTemplateDefaults(c.env.DB, funnel.frame_template_id);

  // No-op save guard (DEV-57): the Quote Builder's one-Save chain re-PUTs the
  // frame on every Save, and the content_version bump is a full visitor-cache
  // invalidation (03 §3.1). A byte-identical config — the EXACT stored TEXT
  // versus the same serialization this handler persists — skips the UPDATE
  // and the bump; the response keeps the normal projection shape with
  // `bumped_variants: 0` so the island flow is unchanged.
  const serialized = JSON.stringify(raw);
  if (funnel.frame_config_json === serialized) {
    const projection = frameProjection(raw, savedDefaults);
    projection["problems"] = [...validation.problems, ...(projection["problems"] as Problem[])];
    projection["bumped_variants"] = 0;
    return c.json(projection);
  }

  await c.env.DB.prepare(
    "UPDATE leadgen_funnels SET frame_config_json = ?, updated_at = unixepoch() WHERE id = ?",
  )
    .bind(serialized, funnel.id)
    .run();
  // 03 §3.1: the bump is what makes a frame edit reach visitors.
  const bumped = await bumpActiveVariantContentVersions(c.env.DB, funnel.id);

  const projection = frameProjection(raw, savedDefaults);
  projection["problems"] = [...validation.problems, ...(projection["problems"] as Problem[])];
  projection["bumped_variants"] = bumped;
  return c.json(projection);
}

// ---------------------------------------------------------------------------
// GET/PUT /funnels/:id/theme (04 §4.8 rows 3–4)
// ---------------------------------------------------------------------------

// {theme, effective_tokens}: the stored theme + the resolved role→value table
// (09 §9.2 resolveTokens over the control variant's base design) the editor
// swatch grid renders. `theme` may be structurally invalid stored drift — the
// additive problems say so; effective_tokens then resolve the VALID part
// (exactly what serve applies: an invalid theme falls back to base design).
async function themeProjection(
  db: D1Database,
  funnel: LeadgenFunnelRow,
  stored: Record<string, unknown> | null,
  cache: KVNamespace,
): Promise<Record<string, unknown>> {
  const problems: Problem[] = [];
  let theme: ThemeJson | ThemeIdRef | null = null;
  if (stored !== null) {
    const validation = validateTheme(stored);
    problems.push(...validation.problems);
    theme = validation.theme;
  }
  const design = getFunnelDesign(await funnelBaseDesignId(db, funnel));
  // v3.1 §10.1: a {theme_id} theme resolves its KV record here so
  // effective_tokens reflects the SAME roles the runtime/preview paths would
  // apply — an unknown/deleted id degrades to the base design (resolveTokens'
  // documented fallback), never a thrown error on a read.
  const themeRecord = theme !== null && isThemeIdRef(theme) ? await getThemeRecord(cache, theme.theme_id) : null;
  const tokens = resolveTokens(design, theme, null, themeRecord);
  return { theme: stored, effective_tokens: tokens.roles, problems };
}

export async function getFunnelThemeHandler(c: AdminContext): Promise<Response> {
  const funnel = await resolveFunnelRow(c.env.DB, c.req.param("id") ?? "");
  if (funnel === null) return c.json({ error: "Not Found" }, 404);
  return c.json(await themeProjection(c.env.DB, funnel, parsedJsonRecord(funnel.theme_json), c.env.CACHE));
}

export async function putFunnelThemeHandler(c: AdminContext): Promise<Response> {
  const funnel = await resolveFunnelRow(c.env.DB, c.req.param("id") ?? "");
  if (funnel === null) return c.json({ error: "Not Found" }, 404);
  const body = await readJsonBody(c);
  if (body === null) return c.json({ error: "Invalid JSON body" }, 400);

  const raw = body["theme_json"];
  if (!isRecord(raw)) {
    return c.json(
      { error: "Validation failed", fields: { theme_json: "theme_json must be a JSON object" } },
      400,
    );
  }

  // 14 §14.3: same validation/versioning rules as the frame PUT. The §9.3
  // custom-hex palette rows are WARNINGS — they persist with the save.
  const validation = validateTheme(raw);
  if (validation.theme === null) {
    return c.json({ error: "Validation failed", problems: validation.problems }, 400);
  }

  // v3.1 §10.1 assignment write-path: theme_json may be a {theme_id}
  // reference (validateTheme only checked its STRUCTURE, pure/no-KV) — the
  // referenced id must exist in the KV `lg-funnel-themes` store, checked
  // here where CACHE is available. Mirrors the 14 §14.3 "invalid never
  // persisted" rule: an unknown id is a real 400, nothing is written.
  if (isThemeIdRef(validation.theme)) {
    const exists = await themeRecordExists(c.env.CACHE, validation.theme.theme_id);
    if (!exists) {
      return c.json(
        {
          error: "Validation failed",
          problems: [
            {
              path: "theme_json.theme_id",
              scope: "theme",
              severity: "error",
              message: `Theme '${validation.theme.theme_id}' does not exist.`,
            },
          ],
        },
        400,
      );
    }
  }

  // No-op save guard (DEV-57) — the same byte-identical skip as the frame
  // PUT: no row rewrite, no content_version bump, normal response shape with
  // `bumped_variants: 0` (warnings still ride the projection).
  const serialized = JSON.stringify(raw);
  if (funnel.theme_json === serialized) {
    const projection = await themeProjection(c.env.DB, funnel, raw, c.env.CACHE);
    projection["bumped_variants"] = 0;
    return c.json(projection);
  }

  await c.env.DB.prepare(
    "UPDATE leadgen_funnels SET theme_json = ?, updated_at = unixepoch() WHERE id = ?",
  )
    .bind(serialized, funnel.id)
    .run();
  const bumped = await bumpActiveVariantContentVersions(c.env.DB, funnel.id);

  const projection = await themeProjection(c.env.DB, funnel, raw, c.env.CACHE);
  projection["bumped_variants"] = bumped;
  return c.json(projection);
}

// ---------------------------------------------------------------------------
// GET /frame-templates (04 §4.8 row 5) — registry projection
// ---------------------------------------------------------------------------

// Small static thumbnail markup per template arrangement (§4.3 "visual
// thumbnails"): a band stack derived from the template's own defaults —
// deterministic registry data, no free CSS (the builder styles the classes).
// R2 P8 M10 — the SAME band stack for a BUILT-IN registry template and for a
// SAVED (`leadgen_frame_templates`) record. It used to take a FrameTemplateDef
// only, so a saved template had no thumbnail to show anywhere and the Templates
// tab fell back to a 3-key text pill of raw enums. The two callers differ only
// in where the complete config and the identity come from:
//   * built-in  → def.defaults (already complete) + def.id + def.arrangement;
//   * saved row → effectiveFrame(family defaults ⊕ the row's sparse frame_json)
//     + the row's public_id, with NO arrangement prose to read.
// The arrangement string stays an EXTRA trust/benefit trigger (not the only
// one) so every built-in emits byte-identical markup to before, while a saved
// row's real `enabled` flags drive its own bands.
// R2 P8 F1 (M10, the consumer leg): the bands are derived ONCE, as DATA — a
// class list per band plus the thumb's own root class list. `frameThumbnailHtml`
// below serialises that data to markup for the callers that want markup; the
// Templates tab's island builds the SAME nodes with createElement from
// `thumbnail` (islands here are forbidden `innerHTML`, and re-deriving the bands
// client-side from frame_json would be a SECOND reader of one shape — §4 R1's
// exact defect). One derivation, two renderings; they cannot disagree.
export interface FrameThumbnailData {
  /** The thumb container's class list (background style included). */
  root_class: string;
  /** The identity `data-template-thumb` carries. */
  id: string;
  /** One class list per band span, top to bottom. */
  bands: string[];
}

function frameThumbnailData(id: string, d: EffectiveFrameConfig, arrangement: string): FrameThumbnailData {
  const bands: string[] = [];
  if (d.disclosure.enabled && d.disclosure.location === "top_bar") {
    bands.push("lg-tpl-band lg-tpl-disclosure");
  }
  bands.push(`lg-tpl-band lg-tpl-logo lg-tpl-logo--${d.header.logo_align}`);
  if (d.progress.style !== "hidden") {
    bands.push(`lg-tpl-band lg-tpl-progress lg-tpl-progress--${d.progress.style}`);
  }
  bands.push(`lg-tpl-band lg-tpl-slot lg-tpl-slot--${d.section_slot.card}`);
  if (d.trust_strip.enabled || d.trust_strip.placement === "footer" || arrangement.includes("trust strip")) {
    bands.push("lg-tpl-band lg-tpl-trust");
  }
  if (d.benefit_bar.enabled || arrangement.includes("benefit bar")) {
    bands.push("lg-tpl-band lg-tpl-benefit");
  }
  if (d.footer.enabled) {
    bands.push("lg-tpl-band lg-tpl-footer");
  }
  return { root_class: `lg-tpl-thumb lg-tpl-thumb--${id} lg-tpl-thumb--bg-${d.background.style}`, id, bands };
}

function frameThumbnailHtml(id: string, d: EffectiveFrameConfig, arrangement: string): string {
  const data = frameThumbnailData(id, d, arrangement);
  const bands = data.bands.map((cls) => `<span class="${escapeHtml(cls)}"></span>`).join("");
  return (
    `<div class="${escapeHtml(data.root_class)}"` +
    ` data-template-thumb="${escapeHtml(data.id)}" aria-hidden="true">${bands}</div>`
  );
}

function frameTemplateThumbnailHtml(def: FrameTemplateDef): string {
  return frameThumbnailHtml(def.id, def.defaults, def.arrangement);
}

// A saved record's thumbnail. The row's frame_json is a SPARSE patch (that is
// what the Templates tab saves), so it is composed through the SAME
// effectiveFrame every other read path uses before any band is derived — a
// sparse row can never leave a group undefined here.
export function savedFrameTemplateThumbnailHtml(row: LeadgenFrameTemplateRow): string {
  const defaults = parseSavedFrameTemplateDefaults(row.frame_json);
  const { frame } = effectiveFrame(null, null, null, defaults);
  return frameThumbnailHtml(row.public_id, frame, "");
}

// The SAME bands, as data. R2 P8 F1 (M10): the Templates tab's island cannot
// mount `thumbnail_html` — islands here may not use innerHTML — so the wire
// carries the band class lists too and the island builds them with
// createElement. Both keys come from frameThumbnailData, so the picture the
// island paints is the picture this module composed, never a re-derivation.
export function savedFrameTemplateThumbnail(row: LeadgenFrameTemplateRow): FrameThumbnailData {
  const defaults = parseSavedFrameTemplateDefaults(row.frame_json);
  const { frame } = effectiveFrame(null, null, null, defaults);
  return frameThumbnailData(row.public_id, frame, "");
}

export function listFrameTemplatesHandler(c: AdminContext): Response {
  const items = FRAME_TEMPLATE_IDS.map((id) => {
    const def = FRAME_TEMPLATES[id];
    return {
      id: def.id,
      label: def.label,
      arrangement: def.arrangement,
      thumbnail_html: frameTemplateThumbnailHtml(def),
      defaults: def.defaults,
    };
  });
  return c.json({ items, default_template_id: DEFAULT_FRAME_TEMPLATE_ID });
}

// ---------------------------------------------------------------------------
// GET /sites/:site_id/branding (10 §10.5)
// ---------------------------------------------------------------------------

// Read-only. ALL CMS sites are legal — the preview selector lists every site
// with a status badge and previewing under any site's branding is allowed
// BEFORE activation (C4: branding is read-only site_settings data; nothing
// here creates or requires a leadgen_site_quotes row). Unknown site → 404.
export async function getSiteBrandingHandler(c: AdminContext): Promise<Response> {
  const siteId = (c.req.param("site_id") ?? "").trim();
  if (siteId === "") return c.json({ error: "Not Found" }, 404);
  const site = await c.env.DB.prepare("SELECT id FROM sites WHERE id = ? LIMIT 1")
    .bind(siteId)
    .first<{ id: string }>();
  if (site === null) return c.json({ error: "Not Found" }, 404);

  const branding = await resolveSiteBranding(c.env.DB, siteId);
  return c.json({
    site_id: siteId,
    ...branding,
    // §10.5: has_logo drives the preview-selector + preflight copy (§10.4 —
    // false = the funnel shows the site name as a text mark).
    has_logo: branding.logo_url !== null,
  });
}

// ---------------------------------------------------------------------------
// Rework M5 (§5-M5, §11D) — saved frame templates (leadgen_frame_templates).
// The DB-backed template records the Templates tab creates / saves-as / renames
// / duplicates / deletes (in-use guarded) + the ONE is_default (atomic swap) +
// "Apply to funnel…" (sets leadgen_funnels.frame_template_id). listFrameTemplates
// Handler above stays the CODE registry projection (thumbnails/arrangement);
// these handlers are the persisted saved-template surface.
// ---------------------------------------------------------------------------

function frameTemplateRowToApi(row: LeadgenFrameTemplateRow): Record<string, unknown> {
  return {
    ...row,
    frame_json: parseJsonColumn(row.frame_json),
    is_default: row.is_default !== 0,
    // R2 P8 M10: the SAME `thumbnail_html` key the built-in registry
    // projection (listFrameTemplatesHandler) already returns, so a saved
    // template can be shown with a real picture instead of a raw-enum pill.
    thumbnail_html: savedFrameTemplateThumbnailHtml(row),
    // …and its data-shaped sibling, which is what the admin island can actually
    // mount (see savedFrameTemplateThumbnail).
    thumbnail: savedFrameTemplateThumbnail(row),
  };
}

async function resolveFrameTemplateRow(db: D1Database, idParam: string): Promise<LeadgenFrameTemplateRow | null> {
  const selector = idSelector("frame_template", idParam);
  if (selector === null) return null;
  const sql =
    selector.column === "id"
      ? "SELECT * FROM leadgen_frame_templates WHERE id = ? LIMIT 1"
      : "SELECT * FROM leadgen_frame_templates WHERE public_id = ? LIMIT 1";
  return (await db.prepare(sql).bind(selector.value).first<LeadgenFrameTemplateRow>()) ?? null;
}

// name (≤60, required, unique) + frame_json (a FrameConfig defaults object that
// validateFrameConfig accepts with zero error-severity problems). Returns
// {name, frameJson} or a field error.
async function validateTemplateInput(
  db: D1Database,
  body: Record<string, unknown>,
  existing: LeadgenFrameTemplateRow | null,
): Promise<{ name: string; frameJson: string | null; errors: Record<string, string> }> {
  const errors: Record<string, string> = {};
  let name = existing?.name ?? "";
  if (existing === null || body["name"] !== undefined) {
    const raw = typeof body["name"] === "string" ? body["name"].trim() : "";
    if (raw === "") errors["name"] = "name is required";
    else if (raw.length > 60) errors["name"] = "name must be at most 60 characters";
    else {
      const clash = await db
        .prepare("SELECT id FROM leadgen_frame_templates WHERE name = ? AND id != ? LIMIT 1")
        .bind(raw, existing?.id ?? -1)
        .first<{ id: number }>();
      if (clash) errors["name"] = `a template named '${raw}' already exists`;
      else name = raw;
    }
  }

  let frameJson: string | null = existing?.frame_json ?? null;
  if (existing === null || body["frame_json"] !== undefined) {
    const raw = body["frame_json"];
    if (!isRecord(raw)) errors["frame_json"] = "frame_json must be a JSON object";
    else {
      const validation = validateFrameConfig(raw);
      if (validation.config === null) {
        errors["frame_json"] = "frame_json failed validation";
      } else {
        frameJson = JSON.stringify(raw);
      }
    }
  }
  return { name, frameJson, errors };
}

// GET /frame-template-records — the saved (DB) templates.
export async function listFrameTemplateRecordsHandler(c: AdminContext): Promise<Response> {
  const rows = await c.env.DB.prepare(
    "SELECT * FROM leadgen_frame_templates ORDER BY is_default DESC, id ASC",
  ).all<LeadgenFrameTemplateRow>();
  return c.json({ items: (rows.results ?? []).map(frameTemplateRowToApi) });
}

// GET /frame-template-records/:id
export async function getFrameTemplateHandler(c: AdminContext): Promise<Response> {
  const row = await resolveFrameTemplateRow(c.env.DB, c.req.param("id") ?? "");
  if (row === null) return c.json({ error: "Not Found" }, 404);
  return c.json(frameTemplateRowToApi(row));
}

// POST /frame-template-records — create / save-as (name + frame_json).
export async function createFrameTemplateHandler(c: AdminContext): Promise<Response> {
  const body = (await readJsonBody(c)) ?? {};
  const { name, frameJson, errors } = await validateTemplateInput(c.env.DB, body, null);
  if (Object.keys(errors).length > 0 || frameJson === null) {
    return c.json({ error: "Validation failed", fields: errors }, 400);
  }
  const publicId = mintPublicId("frame_template");
  await c.env.DB.prepare(
    "INSERT INTO leadgen_frame_templates (public_id, name, frame_json, is_default) VALUES (?, ?, ?, 0)",
  )
    .bind(publicId, name, frameJson)
    .run();
  const row = await c.env.DB.prepare("SELECT * FROM leadgen_frame_templates WHERE public_id = ? LIMIT 1")
    .bind(publicId)
    .first<LeadgenFrameTemplateRow>();
  if (!row) return c.json({ error: "Insert failed" }, 500);
  return c.json(frameTemplateRowToApi(row), 201);
}

// PATCH /frame-template-records/:id — rename and/or replace frame_json.
export async function updateFrameTemplateHandler(c: AdminContext): Promise<Response> {
  const existing = await resolveFrameTemplateRow(c.env.DB, c.req.param("id") ?? "");
  if (existing === null) return c.json({ error: "Not Found" }, 404);
  const body = await readJsonBody(c);
  if (body === null) return c.json({ error: "Invalid JSON body" }, 400);
  const { name, frameJson, errors } = await validateTemplateInput(c.env.DB, body, existing);
  if (Object.keys(errors).length > 0) return c.json({ error: "Validation failed", fields: errors }, 400);
  await c.env.DB.prepare(
    "UPDATE leadgen_frame_templates SET name = ?, frame_json = ?, updated_at = unixepoch() WHERE id = ?",
  )
    .bind(name, frameJson ?? existing.frame_json, existing.id)
    .run();
  const row = await c.env.DB.prepare("SELECT * FROM leadgen_frame_templates WHERE id = ? LIMIT 1")
    .bind(existing.id)
    .first<LeadgenFrameTemplateRow>();
  if (!row) return c.json({ error: "Update failed" }, 500);
  return c.json(frameTemplateRowToApi(row));
}

// POST /frame-template-records/:id/duplicate — copy (new lgft_, name "(copy)",
// never the default).
export async function duplicateFrameTemplateHandler(c: AdminContext): Promise<Response> {
  const src = await resolveFrameTemplateRow(c.env.DB, c.req.param("id") ?? "");
  if (src === null) return c.json({ error: "Not Found" }, 404);
  // Find a free "(copy)" name (unique constraint on name).
  let name = `${src.name} (copy)`;
  if (name.length > 60) name = `${src.name.slice(0, 54)} (copy)`;
  for (let n = 2; ; n++) {
    const clash = await c.env.DB.prepare("SELECT id FROM leadgen_frame_templates WHERE name = ? LIMIT 1").bind(name).first<{ id: number }>();
    if (!clash) break;
    name = `${src.name} (copy ${n})`;
    if (name.length > 60) name = `${src.name.slice(0, 48)} (copy ${n})`;
  }
  const publicId = mintPublicId("frame_template");
  await c.env.DB.prepare(
    "INSERT INTO leadgen_frame_templates (public_id, name, frame_json, is_default) VALUES (?, ?, ?, 0)",
  )
    .bind(publicId, name, src.frame_json)
    .run();
  const row = await c.env.DB.prepare("SELECT * FROM leadgen_frame_templates WHERE public_id = ? LIMIT 1")
    .bind(publicId)
    .first<LeadgenFrameTemplateRow>();
  if (!row) return c.json({ error: "Duplicate failed" }, 500);
  return c.json({ ...frameTemplateRowToApi(row), duplicated_from: src.public_id }, 201);
}

// PUT /frame-template-records/:id/default — SET-DEFAULT as an ATOMIC SWAP: clear
// the current default, set this one, in ONE batch (the partial unique index
// uq_lg_frame_templates_default forbids two =1, so clear MUST precede set).
export async function setDefaultFrameTemplateHandler(c: AdminContext): Promise<Response> {
  const row = await resolveFrameTemplateRow(c.env.DB, c.req.param("id") ?? "");
  if (row === null) return c.json({ error: "Not Found" }, 404);
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE leadgen_frame_templates SET is_default = 0, updated_at = unixepoch() WHERE is_default = 1"),
    c.env.DB.prepare("UPDATE leadgen_frame_templates SET is_default = 1, updated_at = unixepoch() WHERE id = ?").bind(row.id),
  ]);
  const updated = await c.env.DB.prepare("SELECT * FROM leadgen_frame_templates WHERE id = ? LIMIT 1")
    .bind(row.id)
    .first<LeadgenFrameTemplateRow>();
  if (!updated) return c.json({ error: "Update failed" }, 500);
  return c.json(frameTemplateRowToApi(updated));
}

// DELETE /frame-template-records/:id — §4.3-14 in-use guard: a template cannot
// be deleted while ANY funnel or variant references it (409 naming referrers).
export async function deleteFrameTemplateHandler(c: AdminContext): Promise<Response> {
  const row = await resolveFrameTemplateRow(c.env.DB, c.req.param("id") ?? "");
  if (row === null) return c.json({ error: "Not Found" }, 404);
  const funnelRefs = await c.env.DB.prepare(
    "SELECT public_id, funnel_name FROM leadgen_funnels WHERE frame_template_id = ? ORDER BY id ASC",
  )
    .bind(row.id)
    .all<{ public_id: string; funnel_name: string }>();
  const variantRefs = await c.env.DB.prepare(
    "SELECT public_id, variant_label FROM leadgen_funnel_variants WHERE frame_template_id = ? ORDER BY id ASC",
  )
    .bind(row.id)
    .all<{ public_id: string; variant_label: string }>();
  const funnels = funnelRefs.results ?? [];
  const variants = variantRefs.results ?? [];
  if (funnels.length > 0 || variants.length > 0) {
    return c.json(
      {
        error: `Can't delete template '${row.name}': it is in use.`,
        in_use: {
          funnels: funnels.map((f) => ({ public_id: f.public_id, name: f.funnel_name })),
          variants: variants.map((v) => ({ public_id: v.public_id, label: v.variant_label })),
        },
      },
      409,
    );
  }
  await c.env.DB.prepare("DELETE FROM leadgen_frame_templates WHERE id = ?").bind(row.id).run();
  return c.json({ ok: true, id: row.id, public_id: row.public_id, deleted: true });
}

// POST /funnels/:id/apply-template — "Apply to funnel…": set the funnel's base
// template (leadgen_funnels.frame_template_id), MATERIALISE the template's own
// authored leaves into the funnel's frame_config_json, and bump its active
// variants so visitors get the new layout (03 §3.1). {template_id:null} clears
// the pointer (→ the funnel falls back to frame_config_json.template,
// effectiveFrame's behavior) and materialises nothing.
//
// R2 P8 M3 / R2-1 — WHY the write is no longer the pointer alone. The pointer
// is only the BASE layer of effectiveFrame, and the Quote Builder re-PUTs its
// whole hydrated frame on every Save (quotes-tabs/funnel.ts:1675), so a funnel
// that has ever been saved carries a COMPLETE frame_config_json that shadows
// every leaf the template holds: measured on this branch, an apply moved
// exactly ONE leaf of the served composition (`template`, the identity string
// no CSS is keyed on) out of 46 leaves the template disagreed on. See
// computeTemplateApply (designs/frames.ts) for the semantics and
// test/leadgen-p8-m3-apply-template.test.ts for the before/after counts.
//
// `dry_run:true` returns the SAME changes/confirmations with NO write, so the
// Templates tab's confirm dialog can enumerate what this apply really does
// (M3: the four sentences it used to hardcode were all false) instead of
// promising a fixed list.
export async function applyFrameTemplateToFunnelHandler(c: AdminContext): Promise<Response> {
  const funnel = await resolveFunnelRow(c.env.DB, c.req.param("id") ?? "");
  if (funnel === null) return c.json({ error: "Not Found" }, 404);
  const body = (await readJsonBody(c)) ?? {};
  const raw = body["template_id"] ?? body["frame_template_id"] ?? null;
  let templateId: number | null = null;
  let templateDefaults: EffectiveFrameConfig | null = null;
  if (raw !== null && raw !== undefined && raw !== "") {
    const tpl = await resolveFrameTemplateRow(c.env.DB, String(raw));
    if (tpl === null) {
      return c.json({ error: "Validation failed", fields: { template_id: "template does not exist" } }, 400);
    }
    templateId = tpl.id;
    templateDefaults = parseSavedFrameTemplateDefaults(tpl.frame_json);
  }

  const stored = parsedJsonRecord(funnel.frame_config_json) as StoredFrameConfig | null;
  const currentDefaults = await resolveSavedFrameTemplateDefaults(c.env.DB, funnel.frame_template_id);
  const applied = computeTemplateApply(stored, templateDefaults, currentDefaults);

  const dryRun = body["dry_run"] === true || (c.req.query("dry_run") ?? "") === "1";
  if (dryRun) {
    return c.json({
      funnel_id: funnel.public_id,
      frame_template_id: templateId,
      applied: false,
      changes: applied.changes,
      replaced_customisations: applied.replaced_customisations,
      confirmations: applied.confirmations,
    });
  }

  // The materialised config and the pointer move in ONE statement — a funnel
  // can never be left pointing at a template whose leaves were not written.
  // Nothing to materialise (clearing the pointer, or a template whose leaves
  // the funnel already carries) leaves the column exactly as it was.
  const serialized = JSON.stringify(applied.merged);
  const materialise = templateDefaults !== null && funnel.frame_config_json !== serialized;
  if (materialise) {
    await c.env.DB.prepare(
      "UPDATE leadgen_funnels SET frame_template_id = ?, frame_config_json = ?, updated_at = unixepoch() WHERE id = ?",
    )
      .bind(templateId, serialized, funnel.id)
      .run();
  } else {
    await c.env.DB.prepare("UPDATE leadgen_funnels SET frame_template_id = ?, updated_at = unixepoch() WHERE id = ?")
      .bind(templateId, funnel.id)
      .run();
  }
  const bumped = await bumpActiveVariantContentVersions(c.env.DB, funnel.id);
  const updated = await resolveFunnelRow(c.env.DB, String(funnel.id));
  return c.json({
    funnel_id: funnel.public_id,
    frame_template_id: templateId,
    bumped_variants: bumped,
    applied: true,
    materialised: materialise,
    changes: applied.changes,
    replaced_customisations: applied.replaced_customisations,
    confirmations: applied.confirmations,
    funnel: updated,
  });
}
