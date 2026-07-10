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
  computeTemplateSwitch,
  effectiveFrame,
  validateFrameConfig,
  type FrameTemplateDef,
  type StoredFrameConfig,
} from "../../public/leadgen/designs/frames";
import { resolveTokens, validateTheme } from "../../public/leadgen/designs/theme";
import type { Problem, ThemeJson } from "../../public/leadgen/designs/theme";
import { getFunnelDesign } from "../../public/leadgen/designs/registry";
import { resolveSiteBranding } from "../../leadgen/branding";
import { escapeHtml } from "../templates/layout";
import { parseJsonColumn, readJsonBody, type AdminContext } from "./offers-handlers";
import {
  bumpActiveVariantContentVersions,
  readFunnelVariants,
  resolveFunnelRow,
} from "./quotes-handlers";
import type { LeadgenFunnelRow } from "./db-types";

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

// The theme editor resolves swatches against the CONTROL variant's base
// design (04 §4.8 — `funnel_design_id` stays a Variant field, 03 §3.2); the
// control is the is_control-DESC head of the funnel's variants. A variantless
// funnel degrades to the default design (the registry fallback rule).
async function funnelBaseDesignId(db: D1Database, funnel: LeadgenFunnelRow): Promise<string> {
  const variants = await readFunnelVariants(db, funnel.id);
  return variants[0]?.funnel_design_id ?? "default";
}

// ---------------------------------------------------------------------------
// GET/PUT /funnels/:id/frame (04 §4.8 rows 1–2)
// ---------------------------------------------------------------------------

// The shared GET/PUT-success projection: the stored sparse config, the
// effective frame (template ⊕ stored — what preview uses, ONE merge
// implementation, 13 §13.2), and the CURRENT template's registry defaults.
function frameProjection(stored: Record<string, unknown> | null): Record<string, unknown> {
  const { frame, problems } = effectiveFrame(stored as StoredFrameConfig | null);
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

  const projection = frameProjection(stored);
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

  await c.env.DB.prepare(
    "UPDATE leadgen_funnels SET frame_config_json = ?, updated_at = unixepoch() WHERE id = ?",
  )
    .bind(JSON.stringify(raw), funnel.id)
    .run();
  // 03 §3.1: the bump is what makes a frame edit reach visitors.
  const bumped = await bumpActiveVariantContentVersions(c.env.DB, funnel.id);

  const projection = frameProjection(raw);
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
): Promise<Record<string, unknown>> {
  const problems: Problem[] = [];
  let theme: ThemeJson | null = null;
  if (stored !== null) {
    const validation = validateTheme(stored);
    problems.push(...validation.problems);
    theme = validation.theme;
  }
  const design = getFunnelDesign(await funnelBaseDesignId(db, funnel));
  const tokens = resolveTokens(design, theme, null);
  return { theme: stored, effective_tokens: tokens.roles, problems };
}

export async function getFunnelThemeHandler(c: AdminContext): Promise<Response> {
  const funnel = await resolveFunnelRow(c.env.DB, c.req.param("id") ?? "");
  if (funnel === null) return c.json({ error: "Not Found" }, 404);
  return c.json(await themeProjection(c.env.DB, funnel, parsedJsonRecord(funnel.theme_json)));
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

  await c.env.DB.prepare(
    "UPDATE leadgen_funnels SET theme_json = ?, updated_at = unixepoch() WHERE id = ?",
  )
    .bind(JSON.stringify(raw), funnel.id)
    .run();
  const bumped = await bumpActiveVariantContentVersions(c.env.DB, funnel.id);

  const projection = await themeProjection(c.env.DB, funnel, raw);
  projection["bumped_variants"] = bumped;
  return c.json(projection);
}

// ---------------------------------------------------------------------------
// GET /frame-templates (04 §4.8 row 5) — registry projection
// ---------------------------------------------------------------------------

// Small static thumbnail markup per template arrangement (§4.3 "visual
// thumbnails"): a band stack derived from the template's own defaults —
// deterministic registry data, no free CSS (the builder styles the classes).
function frameTemplateThumbnailHtml(def: FrameTemplateDef): string {
  const d = def.defaults;
  const bands: string[] = [];
  if (d.disclosure.enabled && d.disclosure.location === "top_bar") {
    bands.push('<span class="lg-tpl-band lg-tpl-disclosure"></span>');
  }
  bands.push(`<span class="lg-tpl-band lg-tpl-logo lg-tpl-logo--${d.header.logo_align}"></span>`);
  if (d.progress.style !== "hidden") {
    bands.push(`<span class="lg-tpl-band lg-tpl-progress lg-tpl-progress--${d.progress.style}"></span>`);
  }
  bands.push(`<span class="lg-tpl-band lg-tpl-slot lg-tpl-slot--${d.section_slot.card}"></span>`);
  if (d.trust_strip.placement === "footer" || def.arrangement.includes("trust strip")) {
    bands.push('<span class="lg-tpl-band lg-tpl-trust"></span>');
  }
  if (def.arrangement.includes("benefit bar")) {
    bands.push('<span class="lg-tpl-band lg-tpl-benefit"></span>');
  }
  if (d.footer.enabled) {
    bands.push('<span class="lg-tpl-band lg-tpl-footer"></span>');
  }
  return (
    `<div class="lg-tpl-thumb lg-tpl-thumb--${escapeHtml(def.id)} lg-tpl-thumb--bg-${escapeHtml(d.background.style)}"` +
    ` data-template-thumb="${escapeHtml(def.id)}" aria-hidden="true">${bands.join("")}</div>`
  );
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
