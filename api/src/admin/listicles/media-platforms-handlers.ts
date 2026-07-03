// Phase-9 media-platforms admin JSON CRUD (§20 outbound S2S config).
//   GET   /api/admin/listicles/media-platforms        — list
//   POST  /api/admin/listicles/media-platforms        — create
//   PATCH /api/admin/listicles/media-platforms/:id     — enable / edit
//
// Mounts under /api/admin/listicles/* → already behind the Cloudflare Access
// gate + the ADMIN_HOST 404 wall (§24). Operators add/enable a media platform
// and set its postback_url_template + auth_secret_ref (the wrangler-secret NAME)
// + event_name here — a NEW platform is a config row, NO code change (§20).
//
// SECURITY (§24): `auth_secret_ref` stores only the NAME of the wrangler secret
// holding the token — the token VALUE never enters this table or any response.
// A new platform is created enabled=0 by DEFAULT so nothing fires until the
// operator explicitly enables it (mirrors the seeded, disabled facebook row).
//
// This JSON CRUD IS the deliverable (declared, like the Phase-8 rebuild-range
// endpoint); no bespoke ES5 admin page is added (the operator drives it via the
// admin API), so the §20 config surface ships without new client JS to audit.

import type { AdminContext } from "./shared";
import { readJsonBody } from "./shared";

export interface MediaPlatformRecord {
  id: number;
  platform: string;
  enabled: number;
  postback_url_template: string;
  auth_secret_ref: string | null;
  event_name: string | null;
  created_at: number;
}

const MACRO_TOKEN_RE = /\{[a-zA-Z0-9_]+\}/g;
const SECRET_NAME_RE = /^[A-Z][A-Z0-9_]*$/;
const PLATFORM_RE = /^[a-z0-9_]+$/;

// §20 template rules (distinct from the §9.4 OFFER macro registry — the S2S
// template legitimately uses {value}/{currency}/{event_name}/{auth_token},
// which are NOT offer macros): absolute http(s), no control chars, and no macro
// in the host/authority position (a client-influenced dim can never choose the
// destination host).
function validatePlatformTemplate(raw: string): string | null {
  const t = raw.trim();
  if (t === "") return "postback_url_template is required";
  if (/[\u0000-\u001f\u007f]/.test(t)) return "postback_url_template must not contain control characters";
  if (!/^https?:\/\//i.test(t)) return "postback_url_template must be an absolute http(s) URL";
  const authority = t.replace(/^https?:\/\//i, "").split(/[/?#]/, 1)[0] ?? "";
  if (authority.includes("{")) return "postback_url_template must not place a macro in the host position";
  try {
    const parsed = new URL(t.replace(MACRO_TOKEN_RE, "x"));
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "postback_url_template must use the http or https scheme";
    }
  } catch {
    return "postback_url_template is not a parseable URL";
  }
  return null;
}

function serialize(row: MediaPlatformRecord): MediaPlatformRecord {
  // Explicit projection: the row has no token value column, but keep the shape
  // stable + prove (grep-visible) that only the secret REF name is surfaced.
  return {
    id: row.id,
    platform: row.platform,
    enabled: row.enabled,
    postback_url_template: row.postback_url_template,
    auth_secret_ref: row.auth_secret_ref, // NAME only — never the token value
    event_name: row.event_name,
    created_at: row.created_at,
  };
}

// numeric → id; else the unique platform name.
function platformSelector(idParam: string): { column: "id" | "platform"; value: number | string } | null {
  const t = (idParam ?? "").trim();
  if (t === "") return null;
  if (/^\d+$/.test(t)) {
    const n = parseInt(t, 10);
    return Number.isFinite(n) && n > 0 ? { column: "id", value: n } : null;
  }
  return { column: "platform", value: t.toLowerCase() };
}

export async function listMediaPlatformsHandler(c: AdminContext): Promise<Response> {
  const res = await c.env.DB.prepare(
    `SELECT id, platform, enabled, postback_url_template, auth_secret_ref, event_name, created_at
     FROM listicle_media_platforms ORDER BY platform ASC`,
  ).all<MediaPlatformRecord>();
  return c.json({ media_platforms: (res.results ?? []).map(serialize) });
}

export async function createMediaPlatformHandler(c: AdminContext): Promise<Response> {
  const body = await readJsonBody(c);
  if (body === null) return c.json({ error: "Invalid JSON body" }, 400);

  const fields: Record<string, string> = {};
  const platform = typeof body.platform === "string" ? body.platform.trim().toLowerCase() : "";
  if (platform === "") fields.platform = "required";
  else if (!PLATFORM_RE.test(platform)) fields.platform = "must be [a-z0-9_]";

  const template = typeof body.postback_url_template === "string" ? body.postback_url_template : "";
  const templateErr = validatePlatformTemplate(template);
  if (templateErr !== null) fields.postback_url_template = templateErr;

  let authSecretRef: string | null = null;
  if (body.auth_secret_ref !== undefined && body.auth_secret_ref !== null && body.auth_secret_ref !== "") {
    if (typeof body.auth_secret_ref !== "string" || !SECRET_NAME_RE.test(body.auth_secret_ref)) {
      fields.auth_secret_ref = "must be a secret NAME (UPPER_SNAKE), never a token value";
    } else {
      authSecretRef = body.auth_secret_ref;
    }
  }

  const enabled = body.enabled === true || body.enabled === 1 || body.enabled === "1" ? 1 : 0;
  const eventName =
    typeof body.event_name === "string" && body.event_name.trim() !== "" ? body.event_name.trim() : "Purchase";

  if (Object.keys(fields).length > 0) return c.json({ error: "Validation failed", fields }, 400);

  try {
    await c.env.DB.prepare(
      `INSERT INTO listicle_media_platforms (platform, enabled, postback_url_template, auth_secret_ref, event_name)
       VALUES (?, ?, ?, ?, ?)`,
    )
      .bind(platform, enabled, template.trim(), authSecretRef, eventName)
      .run();
  } catch {
    // UNIQUE(platform) → the platform already exists.
    return c.json({ error: "platform already exists", fields: { platform: "already exists" } }, 409);
  }

  const row = await c.env.DB.prepare(
    `SELECT id, platform, enabled, postback_url_template, auth_secret_ref, event_name, created_at
     FROM listicle_media_platforms WHERE platform = ? LIMIT 1`,
  )
    .bind(platform)
    .first<MediaPlatformRecord>();
  return c.json({ media_platform: row === null ? null : serialize(row) }, 201);
}

export async function patchMediaPlatformHandler(c: AdminContext): Promise<Response> {
  const sel = platformSelector(c.req.param("id") ?? "");
  if (sel === null) return c.json({ error: "Not Found" }, 404);
  const existing = await c.env.DB.prepare(
    `SELECT id, platform, enabled, postback_url_template, auth_secret_ref, event_name, created_at
     FROM listicle_media_platforms WHERE ${sel.column} = ? LIMIT 1`,
  )
    .bind(sel.value)
    .first<MediaPlatformRecord>();
  if (existing === null) return c.json({ error: "Not Found" }, 404);

  const body = await readJsonBody(c);
  if (body === null) return c.json({ error: "Invalid JSON body" }, 400);

  const fields: Record<string, string> = {};
  const sets: string[] = [];
  const binds: Array<string | number | null> = [];

  if (body.enabled !== undefined) {
    sets.push("enabled = ?");
    binds.push(body.enabled === true || body.enabled === 1 || body.enabled === "1" ? 1 : 0);
  }
  if (body.postback_url_template !== undefined) {
    const template = typeof body.postback_url_template === "string" ? body.postback_url_template : "";
    const templateErr = validatePlatformTemplate(template);
    if (templateErr !== null) fields.postback_url_template = templateErr;
    else {
      sets.push("postback_url_template = ?");
      binds.push(template.trim());
    }
  }
  if (body.auth_secret_ref !== undefined) {
    if (body.auth_secret_ref === null || body.auth_secret_ref === "") {
      sets.push("auth_secret_ref = ?");
      binds.push(null);
    } else if (typeof body.auth_secret_ref !== "string" || !SECRET_NAME_RE.test(body.auth_secret_ref)) {
      fields.auth_secret_ref = "must be a secret NAME (UPPER_SNAKE), never a token value";
    } else {
      sets.push("auth_secret_ref = ?");
      binds.push(body.auth_secret_ref);
    }
  }
  if (body.event_name !== undefined) {
    const ev = typeof body.event_name === "string" && body.event_name.trim() !== "" ? body.event_name.trim() : "Purchase";
    sets.push("event_name = ?");
    binds.push(ev);
  }

  if (Object.keys(fields).length > 0) return c.json({ error: "Validation failed", fields }, 400);
  if (sets.length === 0) return c.json({ error: "no updatable fields provided" }, 400);

  binds.push(existing.id);
  await c.env.DB.prepare(`UPDATE listicle_media_platforms SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...binds)
    .run();

  const row = await c.env.DB.prepare(
    `SELECT id, platform, enabled, postback_url_template, auth_secret_ref, event_name, created_at
     FROM listicle_media_platforms WHERE id = ? LIMIT 1`,
  )
    .bind(existing.id)
    .first<MediaPlatformRecord>();
  return c.json({ media_platform: row === null ? null : serialize(row) });
}
