// Round-4 P5c — LeadGen asset handlers:
//   POST /api/admin/leadgen/assets/brand-logo    (10F, security-elevated)
//   POST /api/admin/leadgen/assets/persona-image (10G, external-cost)
//
// Mounted under /api/admin/leadgen from router.ts, so the existing Cloudflare
// Access gate (`accessAuth` on /api/admin/*) applies unchanged.
//
// 10F: an SVG brand-logo upload runs through the hand-rolled allowlist
// sanitizer (lib/svg-sanitizer.ts, via the SHARED sanitizeSvgUpload gate)
// BEFORE it is stored. The generic /api/admin/media/upload
// (admin/media-crud-handlers.ts) calls the SAME gate, so an SVG uploaded
// through EITHER route is sanitized — B-2 10F is closed on both, not just
// this endpoint. A raster (png/jpeg/webp/gif/avif) passes through the same
// mime validation the media library uses. The stored media id/url is
// consumed verbatim by P5a's brand_logos renderer (frame.ts
// renderBrandLogos → renderLogoStrip).
//
// 10G: the persona-image endpoint checks a per-site MONTHLY quota BEFORE
// spending any OpenAI budget (429 when exceeded), reads the key from env
// (operator-owned; never hardcoded), and returns the R2 url the same plain
// <img> path renders. The ai_generations receipt written by
// generatePersonaImage IS the durable observability log (site_id, task,
// model, status, idempotency_key).

import type { Context } from "hono";
import type { Env } from "../../env";
import { buildStorageKey } from "../../media/upload";
import { sanitizeSvgUpload } from "../../lib/svg-sanitizer";
import {
  generatePersonaImage,
  isLeadgenPersonaKey,
  LEADGEN_PERSONAS,
} from "../../ai/generators/image";

// Route body limits (registered in router.ts). The brand-logo route accepts a
// multipart upload (a sanitized SVG is capped at 512KB by the sanitizer; a
// raster logo is small) — 2MB covers both plus multipart overhead. The
// persona route is a small JSON body.
export const BRAND_LOGO_UPLOAD_LIMIT_BYTES = 2 * 1024 * 1024;
export const PERSONA_BODY_LIMIT_BYTES = 64 * 1024;

// Mirrors the media library's raster allowlist (media-crud-handlers.ts),
// minus SVG (which takes the sanitized branch above, via sanitizeSvgUpload).
const RASTER_MIME_ALLOW: ReadonlySet<string> = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
  "image/avif",
]);

// Per-site monthly persona-generation quota. Default 50/mo; an operator may
// raise it via the LEADGEN_PERSONA_MONTHLY_QUOTA var (read defensively so the
// Env interface stays untouched by this slice).
const DEFAULT_PERSONA_MONTHLY_QUOTA = 50;
const PERSONA_QUOTA_TTL_SECONDS = 62 * 24 * 60 * 60; // ~2 months — the bucket self-expires.

function asString(v: string | File | null): string | null {
  if (v === null || typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

// ---------------------------------------------------------------------------
// 10F — brand-logo upload (sanitized SVG or validated raster)
// ---------------------------------------------------------------------------
export async function uploadBrandLogoHandler(c: Context<{ Bindings: Env }>) {
  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    return c.json({ error: "Expected a multipart/form-data upload." }, 400);
  }

  const fileEntry = form.get("file") as unknown as File | string | null;
  if (fileEntry === null || typeof fileEntry === "string") {
    return c.json({ error: "Add a logo file to upload." }, 400);
  }
  const file = fileEntry;
  const filename = typeof file.name === "string" && file.name !== "" ? file.name : "logo";
  const siteId =
    asString(form.get("site_id") as unknown as string | File | null) ??
    asString(form.get("site") as unknown as string | File | null);
  const altText =
    asString(form.get("alt_text") as unknown as string | File | null) ??
    asString(form.get("alt") as unknown as string | File | null);

  const declaredMime = typeof file.type === "string" ? file.type.toLowerCase() : "";
  // SECURITY CORE: sanitize BEFORE an SVG can reach R2 / the serve path — the
  // SAME shared gate admin/media-crud-handlers.ts's generic upload calls.
  const svgOutcome = await sanitizeSvgUpload(declaredMime, filename, () => file.text());

  let bytes: ArrayBuffer;
  let mimeType: string;

  if (svgOutcome.isSvg) {
    if (!svgOutcome.ok) {
      return c.json(
        { error: `This SVG can't be used: ${svgOutcome.reason}.`, code: "svg_rejected" },
        400,
      );
    }
    bytes = svgOutcome.bytes;
    mimeType = svgOutcome.mime;
  } else if (RASTER_MIME_ALLOW.has(declaredMime)) {
    bytes = await file.arrayBuffer();
    mimeType = declaredMime;
  } else {
    return c.json(
      {
        error:
          "Unsupported file type. Upload an SVG, PNG, JPEG, WebP, GIF or AVIF logo.",
        code: "unsupported_type",
      },
      400,
    );
  }

  // media.site_id is a FK -> sites(id) (migration 0002). Verify a provided
  // site exists; an unknown id degrades to a GLOBAL asset (site_id NULL) rather
  // than failing an already-sanitized, safe upload on a client-side site-ref
  // technicality. Absent site_id skips the check (global by default).
  let scopedSiteId: string | null = siteId;
  if (scopedSiteId !== null) {
    const siteRow = await c.env.DB.prepare("SELECT id FROM sites WHERE id = ? LIMIT 1")
      .bind(scopedSiteId)
      .first<{ id: string }>();
    if (!siteRow) scopedSiteId = null;
  }

  const storageKey = buildStorageKey(filename);
  await c.env.MEDIA.put(storageKey, bytes, {
    httpMetadata: { contentType: mimeType },
  });

  // INSERT INTO media — parameterized only (d1-database-safety). site_id scopes
  // the row; ai_generation_id is NULL (this is an upload, not a generation).
  const row = await c.env.DB.prepare(
    "INSERT INTO media (filename, storage_key, mime_type, size_bytes, alt_text, folder, site_id, ai_generation_id) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
  )
    .bind(filename, storageKey, mimeType, bytes.byteLength, altText, "brand-logos", scopedSiteId, null)
    .first<{ id: number }>();

  if (!row) {
    return c.json({ error: "Could not save the uploaded logo. Please try again." }, 500);
  }

  return c.json({
    ok: true,
    media_id: row.id,
    storage_key: storageKey,
    url: `/media/${storageKey}`,
    mime_type: mimeType,
    size_bytes: bytes.byteLength,
    sanitized: svgOutcome.isSvg,
  });
}

// ---------------------------------------------------------------------------
// 10G — AI persona image (quota-guarded generation)
// ---------------------------------------------------------------------------
interface PersonaBody {
  site_id?: string | null;
  persona_key?: string | null;
  persona?: string | null;
  scene?: string | null;
  alt_text?: string | null;
}

function personaQuotaLimit(env: Env): number {
  const raw = (env as unknown as Record<string, string | undefined>)
    .LEADGEN_PERSONA_MONTHLY_QUOTA;
  const n = raw != null ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_PERSONA_MONTHLY_QUOTA;
}

function personaQuotaKey(siteId: string): string {
  const d = new Date();
  const ym = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  return `lg-persona-quota:${siteId}:${ym}`;
}

async function readPersonaQuotaUsed(env: Env, siteId: string): Promise<number> {
  const raw = await env.CACHE.get(personaQuotaKey(siteId));
  const n = raw != null ? Number(raw) : 0;
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

async function bumpPersonaQuota(env: Env, siteId: string, used: number): Promise<void> {
  await env.CACHE.put(personaQuotaKey(siteId), String(used + 1), {
    expirationTtl: PERSONA_QUOTA_TTL_SECONDS,
  });
}

export async function generatePersonaImageHandler(c: Context<{ Bindings: Env }>) {
  // Key is operator-owned + read from env. No key → no spend path exists.
  if (!c.env.OPENAI_API_KEY) {
    return c.json({ error: "AI image generation is not configured (no OpenAI key)." }, 501);
  }

  let body: PersonaBody = {};
  try {
    body = await c.req.json<PersonaBody>();
  } catch {
    return c.json({ error: "Invalid JSON body." }, 400);
  }

  const siteId =
    typeof body.site_id === "string" && body.site_id.trim() !== "" ? body.site_id.trim() : "";
  if (siteId === "") {
    return c.json({ error: "site_id is required." }, 400);
  }

  const personaKeyRaw =
    typeof body.persona_key === "string" && body.persona_key.trim() !== ""
      ? body.persona_key.trim()
      : typeof body.persona === "string" && body.persona.trim() !== ""
        ? body.persona.trim()
        : "";
  if (personaKeyRaw === "" || !isLeadgenPersonaKey(personaKeyRaw)) {
    return c.json(
      {
        error: "Choose a valid persona.",
        code: "unknown_persona",
        valid_personas: Object.keys(LEADGEN_PERSONAS),
      },
      400,
    );
  }

  // COST SAFETY: check the monthly quota BEFORE any OpenAI call.
  const limit = personaQuotaLimit(c.env);
  const used = await readPersonaQuotaUsed(c.env, siteId);
  if (used >= limit) {
    return c.json(
      {
        error: `You've reached this site's monthly limit of ${limit} generated persona images. It resets next month.`,
        code: "quota_exceeded",
        quota: { used, limit },
      },
      429,
    );
  }

  const scene = typeof body.scene === "string" && body.scene.trim() !== "" ? body.scene.trim() : undefined;
  const altText =
    typeof body.alt_text === "string" && body.alt_text.trim() !== "" ? body.alt_text.trim() : undefined;

  const outcome = await generatePersonaImage(c.env, {
    site_id: siteId,
    personaKey: personaKeyRaw,
    scene,
    alt_text: altText,
  });

  if (outcome.status === "skipped_no_api_key") {
    // Unreachable (key checked above) but keep the honest contract.
    return c.json({ error: "AI image generation is not configured (no OpenAI key)." }, 501);
  }
  if (outcome.status === "failed" || outcome.media_id === 0) {
    return c.json(
      { error: "The persona image could not be generated. Please try again.", ai_generation_id: outcome.ai_generation_id },
      502,
    );
  }

  // COST SAFETY (idempotency vs quota): outcome.replay === true means this
  // call was an idempotent short-circuit (the SAME site+persona already has a
  // recorded row/media) — NO new OpenAI request was made this call, so it
  // MUST NOT consume an extra unit of the site's monthly budget. Only a
  // FRESH generation (replay: false) bumps the counter.
  const nextUsed = outcome.replay ? used : used + 1;
  if (!outcome.replay) {
    await bumpPersonaQuota(c.env, siteId, used);
  }

  return c.json({
    ok: true,
    media_id: outcome.media_id,
    storage_key: outcome.storage_key,
    url: `/media/${outcome.storage_key}`,
    persona_key: personaKeyRaw,
    ai_generation_id: outcome.ai_generation_id,
    replay: outcome.replay,
    quota: { used: nextUsed, limit },
  });
}
