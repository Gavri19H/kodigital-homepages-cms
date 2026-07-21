// LeadGen v3.1 §10 — Themes manager ADMIN CRUD (list/get/create/update — no
// delete this phase, not in the contract) over the KV `lg-funnel-themes`
// store. The store's I/O primitives (read/write/get/exists) moved to the
// PUBLIC theme-store.ts (fix round, §12 parity: the live serve.ts path — a
// public module — needed the SAME reads without a public→admin import edge).
// This file re-exports them so existing importers (router.ts, frame-
// handlers.ts, quotes-handlers.ts, sections-handlers.ts) keep one obvious
// place to look for "the themes admin surface," and owns everything that IS
// admin-specific: request-body validation, id minting, the Hono routes.
//
// Conventions mirror the rest of this admin surface (offers/sections/frame-
// handlers): success → `{ item }` / `{ items }`; failure → `{ error,
// fields? }` 4xx. Themes have no §3.6 `problems[]` requirement of their own
// (§10 defines no such gate), so plain field errors are the right shape here.

import { readJsonBody, type AdminContext } from "./offers-handlers";
import {
  THEME_RECORD_BUTTON_SIZES,
  THEME_RECORD_CORNERS,
  THEME_RECORD_FIELD_HEIGHTS,
  THEME_RECORD_FONT_NAMES,
  THEME_RECORD_ROLE_KEYS,
  isThemeRecordFontName,
  type ThemeRecord,
  type ThemeRecordRoleKey,
} from "../../public/leadgen/designs/theme";
import {
  LEADGEN_THEMES_KV_KEY,
  getThemeRecord,
  readThemeRecords,
  themeRecordExists,
  writeThemeRecords,
} from "../../public/leadgen/designs/theme-store";
// v3.1 §10.4/§12 (fix round 2) — a theme CONTENT edit must invalidate every
// cached shell/config for every funnel currently resolving to it ("change
// one here and every question in the funnel reskins"). Reuses the EXISTING
// §28 per-funnel invalidation helper verbatim (the SAME one a variant SAVE
// triggers, quotes-handlers.ts scheduleVariantPublishInvalidate) — no new
// invalidation machinery, just a wider "which funnels reference this
// theme_id" scan (§10.5 "no back-reference stored").
import { invalidateOnVariantPublish } from "../../public/leadgen/invalidate";
import type { Env } from "../../env";

export { LEADGEN_THEMES_KV_KEY, getThemeRecord, readThemeRecords, themeRecordExists };

const THEME_NAME_MAX = 80;
const THEME_ID_PREFIX = "thm_";

type FieldErrors = Record<string, string>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

// Validate a create/update BODY (id is assigned/kept separately — never part
// of the body). Every recognised group is REQUIRED on create; updateThemeHandler
// pre-merges the current record's groups first (mergeThemeBody) so a caller
// may PATCH only the changed group (§10.4 — Colors / Typography / Controls
// save independently in the Themes manager).
function validateThemeBody(raw: unknown): { value: Omit<ThemeRecord, "id"> | null; errors: FieldErrors } {
  const errors: FieldErrors = {};
  if (!isRecord(raw)) {
    return { value: null, errors: { theme: "body must be a JSON object" } };
  }

  const name = raw["name"];
  if (typeof name !== "string" || name.trim() === "") {
    errors["name"] = "name is required";
  } else if (name.length > THEME_NAME_MAX) {
    errors["name"] = `name must be ${THEME_NAME_MAX} characters or fewer`;
  }

  const roles = raw["roles"];
  const outRoles = {} as Record<ThemeRecordRoleKey, string>;
  if (!isRecord(roles)) {
    errors["roles"] = "roles must be a group of colours";
  } else {
    for (const key of THEME_RECORD_ROLE_KEYS) {
      const v = roles[key];
      if (typeof v !== "string" || !HEX_RE.test(v)) {
        errors[`roles.${key}`] = `roles.${key} must be a hex colour like #1B3A5C`;
      } else {
        outRoles[key] = v;
      }
    }
    for (const key of Object.keys(roles)) {
      if (!(THEME_RECORD_ROLE_KEYS as readonly string[]).includes(key)) {
        errors[`roles.${key}`] = `'${key}' isn't a recognised theme role`;
      }
    }
  }

  const typography = raw["typography"];
  let outTypography: ThemeRecord["typography"] | null = null;
  if (!isRecord(typography)) {
    errors["typography"] = "typography must be a group of settings";
  } else {
    // P0 stored-XSS fix (adversarial review BLOCKER-1): headline_font/
    // body_font are a CLOSED whitelist, not "any non-empty string" — this is
    // the AUTHORITATIVE rejection gate (mirrors the roles HEX_RE rejection
    // above). A value outside THEME_RECORD_FONT_NAMES is REJECTED with a 400
    // before it can ever reach KV / resolveTokens / the served <style> block
    // (see theme.ts's THEME_RECORD_FONT_STACKS doc comment for the full
    // chokepoint trace).
    const headline = typography["headline_font"];
    const body = typography["body_font"];
    const basePx = typography["base_px"];
    if (!isThemeRecordFontName(headline)) {
      errors["typography.headline_font"] =
        `typography.headline_font must be one of: ${THEME_RECORD_FONT_NAMES.join(", ")}`;
    }
    if (!isThemeRecordFontName(body)) {
      errors["typography.body_font"] =
        `typography.body_font must be one of: ${THEME_RECORD_FONT_NAMES.join(", ")}`;
    }
    if (typeof basePx !== "number" || !Number.isFinite(basePx) || basePx < 10 || basePx > 24) {
      errors["typography.base_px"] = "typography.base_px must be a number between 10 and 24";
    }
    if (
      isThemeRecordFontName(headline) &&
      isThemeRecordFontName(body) &&
      typeof basePx === "number" &&
      Number.isFinite(basePx) &&
      basePx >= 10 &&
      basePx <= 24
    ) {
      outTypography = { headline_font: headline, body_font: body, base_px: basePx };
    }
  }

  const controls = raw["controls"];
  let outControls: ThemeRecord["controls"] | null = null;
  if (!isRecord(controls)) {
    errors["controls"] = "controls must be a group of settings";
  } else {
    const fieldHeight = controls["field_height"];
    const buttonSize = controls["button_size"];
    const corners = controls["corners"];
    const fieldHeightOk = (THEME_RECORD_FIELD_HEIGHTS as readonly string[]).includes(fieldHeight as string);
    const buttonSizeOk = (THEME_RECORD_BUTTON_SIZES as readonly string[]).includes(buttonSize as string);
    const cornersOk = (THEME_RECORD_CORNERS as readonly string[]).includes(corners as string);
    if (!fieldHeightOk) {
      errors["controls.field_height"] = `controls.field_height must be one of: ${THEME_RECORD_FIELD_HEIGHTS.join(", ")}`;
    }
    if (!buttonSizeOk) {
      errors["controls.button_size"] = `controls.button_size must be one of: ${THEME_RECORD_BUTTON_SIZES.join(", ")}`;
    }
    if (!cornersOk) {
      errors["controls.corners"] = `controls.corners must be one of: ${THEME_RECORD_CORNERS.join(", ")}`;
    }
    if (fieldHeightOk && buttonSizeOk && cornersOk) {
      outControls = {
        field_height: fieldHeight as ThemeRecord["controls"]["field_height"],
        button_size: buttonSize as ThemeRecord["controls"]["button_size"],
        corners: corners as ThemeRecord["controls"]["corners"],
      };
    }
  }

  let spacing: string | undefined;
  if (raw["spacing"] !== undefined) {
    if (typeof raw["spacing"] !== "string") {
      errors["spacing"] = "spacing must be a string";
    } else {
      spacing = raw["spacing"];
    }
  }

  if (Object.keys(errors).length > 0 || outTypography === null || outControls === null) {
    return { value: null, errors };
  }
  const value: Omit<ThemeRecord, "id"> = {
    name: (name as string).trim(),
    roles: outRoles,
    typography: outTypography,
    controls: outControls,
  };
  if (spacing !== undefined) value.spacing = spacing;
  return { value, errors };
}

// Shallow-merge each recognised group over the CURRENT record so an update
// caller may send only the changed group (§10.4 per-section save: Colors /
// Typography / Controls save independently) without resending the rest.
function mergeThemeBody(current: ThemeRecord, patch: Record<string, unknown>): Record<string, unknown> {
  const merged: Record<string, unknown> = {
    name: current.name,
    roles: { ...current.roles },
    typography: { ...current.typography },
    controls: { ...current.controls },
  };
  if (current.spacing !== undefined) merged["spacing"] = current.spacing;
  for (const key of ["name", "spacing"] as const) {
    if (patch[key] !== undefined) merged[key] = patch[key];
  }
  for (const group of ["roles", "typography", "controls"] as const) {
    const patchGroup = patch[group];
    if (patchGroup === undefined) continue;
    if (isRecord(patchGroup)) {
      merged[group] = { ...(merged[group] as Record<string, unknown>), ...patchGroup };
    } else {
      merged[group] = patchGroup; // not a record — let validateThemeBody reject it
    }
  }
  return merged;
}

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-+|-+$)/g, "");
  return base === "" ? "theme" : base;
}

function mintThemeId(name: string, existing: ReadonlySet<string>): string {
  const slug = slugify(name);
  let candidate = `${THEME_ID_PREFIX}${slug}`;
  let n = 2;
  while (existing.has(candidate)) {
    candidate = `${THEME_ID_PREFIX}${slug}-${n}`;
    n += 1;
  }
  return candidate;
}

// ---------------------------------------------------------------------------
// v3.1 §10.4/§12 (fix round 2): theme-edit cache invalidation
// ---------------------------------------------------------------------------

// Hono's c.executionCtx getter THROWS where no ExecutionContext exists (the
// node:sqlite unit-test harness passes none) — the SAME safeExecutionCtx
// idiom quotes-handlers.ts uses for §28 variant/activation invalidation,
// duplicated here per this codebase's small-helper convention (isRecord is
// duplicated the same way in every handler file). Invalidation is ALWAYS
// non-blocking and can never break the PATCH response.
function safeExecutionCtx(c: AdminContext): ExecutionContext {
  try {
    return c.executionCtx;
  } catch {
    return {
      waitUntil(): void {
        /* no-op outside workerd (unit-test harness) */
      },
      passThroughOnException(): void {
        /* no-op */
      },
    } as unknown as ExecutionContext;
  }
}

interface AffectedFunnel {
  public_id: string;
  quote_id: number;
  // P6b (deliverable 1 — the operator's DELETE demand): the in-use guard's
  // 409 must name the referencing funnels in plain language, not just their
  // ids. Added alongside public_id/quote_id (both existing consumers —
  // scheduleThemeInvalidate's sweep — only ever read those two, so this is
  // strictly additive).
  funnel_name: string;
}

// A stored theme_json / frame_overrides_json TEXT column references this
// theme_id? Parsed + checked EXACTLY (never just the SQL LIKE candidate
// match) so a substring collision (thm_navy vs thm_navy-2) can never
// produce a false positive.
function referencesThemeId(raw: string | null, themeId: string): boolean {
  if (raw === null) return false;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed) && parsed["theme_id"] === themeId;
  } catch {
    return false;
  }
}

// §10.5 "Used by is computed by scanning funnels/variants for the theme_id
// — no back-reference stored": every DISTINCT funnel whose OWN theme_json
// carries this theme_id, OR that has a variant whose frame_overrides_json
// does (variant-level A/B override) — either makes that funnel's cached
// surface stale on a theme content edit. A SQL LIKE narrows to candidates
// (bound parameter — d1-database-safety, never string-interpolated); each
// candidate is then verified exactly via referencesThemeId.
async function findFunnelsReferencingTheme(db: D1Database, themeId: string): Promise<AffectedFunnel[]> {
  const needle = `%"theme_id":"${themeId}"%`;
  const byFunnel = await db
    .prepare("SELECT public_id, quote_id, funnel_name, theme_json FROM leadgen_funnels WHERE theme_json LIKE ?")
    .bind(needle)
    .all<{ public_id: string; quote_id: number; funnel_name: string; theme_json: string | null }>();
  const byVariant = await db
    .prepare(
      `SELECT f.public_id AS f_public_id, f.quote_id AS f_quote_id, f.funnel_name AS f_funnel_name, v.frame_overrides_json AS frame_overrides_json
       FROM leadgen_funnel_variants v
       JOIN leadgen_funnels f ON f.id = v.funnel_id
       WHERE v.frame_overrides_json LIKE ?`,
    )
    .bind(needle)
    .all<{ f_public_id: string; f_quote_id: number; f_funnel_name: string; frame_overrides_json: string | null }>();

  const affected = new Map<string, AffectedFunnel>();
  for (const row of byFunnel.results ?? []) {
    if (referencesThemeId(row.theme_json, themeId)) {
      affected.set(row.public_id, { public_id: row.public_id, quote_id: row.quote_id, funnel_name: row.funnel_name });
    }
  }
  for (const row of byVariant.results ?? []) {
    if (referencesThemeId(row.frame_overrides_json, themeId)) {
      affected.set(row.f_public_id, { public_id: row.f_public_id, quote_id: row.f_quote_id, funnel_name: row.f_funnel_name });
    }
  }
  return [...affected.values()];
}

// For every affected funnel, sweep EVERY site its quote is activated on —
// the EXACT §28 discipline scheduleVariantPublishInvalidate already applies
// per-variant-save, reusing the SAME exported invalidateOnVariantPublish (no
// new KV-delete machinery). Per-funnel site lookups run in parallel; a
// hiccup in one funnel's sweep never blocks another's (invalidateOnVariant-
// Publish is itself fail-open — see invalidate.ts).
async function invalidateThemeAcrossFunnels(env: Env, db: D1Database, themeId: string): Promise<void> {
  const funnels = await findFunnelsReferencingTheme(db, themeId);
  await Promise.all(
    funnels.map(async (funnel) => {
      const sites = await db
        .prepare("SELECT site_id FROM leadgen_site_quotes WHERE quote_id = ?")
        .bind(funnel.quote_id)
        .all<{ site_id: string }>();
      await Promise.all(
        (sites.results ?? []).map((s) => invalidateOnVariantPublish(env, s.site_id, funnel.public_id)),
      );
    }),
  );
}

// Fire-and-forget entry point (mirrors scheduleVariantPublishInvalidate):
// rides waitUntil, fail-open, never blocks or breaks the admin PATCH.
function scheduleThemeInvalidate(c: AdminContext, themeId: string): void {
  safeExecutionCtx(c).waitUntil(
    invalidateThemeAcrossFunnels(c.env, c.env.DB, themeId).catch(() => {}),
  );
}

// ---------------------------------------------------------------------------
// Routes (mounted in router.ts): GET/POST /themes, GET/PATCH /themes/:id
// ---------------------------------------------------------------------------

export async function listThemesHandler(c: AdminContext): Promise<Response> {
  const records = await readThemeRecords(c.env.CACHE);
  return c.json({ items: Object.values(records) });
}

export async function getThemeHandler(c: AdminContext): Promise<Response> {
  const id = (c.req.param("id") ?? "").trim();
  if (id === "") return c.json({ error: "Not Found" }, 404);
  const record = await getThemeRecord(c.env.CACHE, id);
  if (record === null) return c.json({ error: "Not Found" }, 404);
  return c.json({ item: record });
}

export async function createThemeHandler(c: AdminContext): Promise<Response> {
  const body = await readJsonBody(c);
  if (body === null) return c.json({ error: "Invalid JSON body" }, 400);
  const { value, errors } = validateThemeBody(body);
  if (value === null) return c.json({ error: "Validation failed", fields: errors }, 400);

  const existing = await readThemeRecords(c.env.CACHE);
  const id = mintThemeId(value.name, new Set(Object.keys(existing)));
  const record: ThemeRecord = { id, ...value };
  const next = { ...existing, [id]: record };
  await writeThemeRecords(c.env.CACHE, next);
  return c.json({ item: record, items: Object.values(next) }, 201);
}

export async function updateThemeHandler(c: AdminContext): Promise<Response> {
  const id = (c.req.param("id") ?? "").trim();
  if (id === "") return c.json({ error: "Not Found" }, 404);
  const existing = await readThemeRecords(c.env.CACHE);
  const current = existing[id];
  if (current === undefined) return c.json({ error: "Not Found" }, 404);

  const body = await readJsonBody(c);
  if (body === null) return c.json({ error: "Invalid JSON body" }, 400);

  const merged = mergeThemeBody(current, body);
  const { value, errors } = validateThemeBody(merged);
  if (value === null) return c.json({ error: "Validation failed", fields: errors }, 400);

  const record: ThemeRecord = { id, ...value };
  // v3.1 §10.4/§12 (fix round 2): only a REAL content change invalidates
  // downstream caches — a byte-identical PATCH (re-saving the same values)
  // is a no-op save, the SAME discipline the funnel/variant PUT no-op-save
  // guards already apply (frame-handlers.ts / quotes-handlers.ts).
  const changed = JSON.stringify(current) !== JSON.stringify(record);
  const next = { ...existing, [id]: record };
  await writeThemeRecords(c.env.CACHE, next);
  if (changed) scheduleThemeInvalidate(c, id);
  return c.json({ item: record, items: Object.values(next) });
}

// ---------------------------------------------------------------------------
// P6b (deliverable 1) — DELETE /themes/:id, the operator's explicit demand
// (the v3.1 §10.1 CRUD originally shipped list/get/create/update only — see
// router.ts's now-updated comment). IN-USE GUARD: mirrors the sections-
// handlers.ts deleteSectionHandler precedent ("used by quotes -> archive
// instead" 409 + a structured usage payload) rather than the component-
// presets sibling (deleteComponentPresetHandler has no back-reference to
// guard at all — themes DO, via the SAME findFunnelsReferencingTheme scan
// scheduleThemeInvalidate already uses for cache invalidation on edit). A
// theme referenced by ANY funnel's theme_json OR ANY variant's frame_
// overrides_json.theme_id (§10.5 "computed by scanning ... no back-reference
// stored") is refused with a plain-language 409 naming every referencing
// funnel; themes carry no archive/status lifecycle (§10.4's KV record is
// pure name+roles+typography+controls), so hard-delete is the ONLY
// deletion path once unreferenced.
export async function deleteThemeHandler(c: AdminContext): Promise<Response> {
  const id = (c.req.param("id") ?? "").trim();
  if (id === "") return c.json({ error: "Not Found" }, 404);
  const existing = await readThemeRecords(c.env.CACHE);
  if (existing[id] === undefined) return c.json({ error: "Not Found" }, 404);

  const referencing = await findFunnelsReferencingTheme(c.env.DB, id);
  if (referencing.length > 0) {
    const names = referencing.map((f) => f.funnel_name);
    return c.json(
      {
        error: `This theme is used by ${referencing.length} funnel${referencing.length === 1 ? "" : "s"} (${names.join(", ")}) — assign them a different theme first, then delete this one.`,
        usage: { funnels: referencing.map((f) => ({ public_id: f.public_id, funnel_name: f.funnel_name })) },
      },
      409,
    );
  }

  const next = { ...existing };
  delete next[id];
  await writeThemeRecords(c.env.CACHE, next);
  return c.json({ ok: true, id, items: Object.values(next) });
}
