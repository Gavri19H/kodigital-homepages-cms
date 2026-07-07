// LeadGen §26 media-platforms admin JSON CRUD (contract 08 §26 outbound S2S
// config + 09 §30.2 secrets). Registered from router.ts under
// /api/admin/leadgen/media-platforms → already behind the Cloudflare Access
// gate + the ADMIN_HOST 404 wall + the private,no-store headers (03 §8.1).
//
// Operators add/enable a media platform and set its postback_url_template
// (the §26 macro template — {value}/{currency}/{event_name}/{auth_token} +
// {click_id}/{fbc}/{fbclid}), auth_secret_ref (the wrangler-secret NAME), and
// value_multiplier ({value} = revenue × value_multiplier). A NEW platform is a
// config row — NO code change (the seeded facebook row ships disabled).
//
// SECURITY (§30.2): auth_secret_ref stores only the NAME of the wrangler secret
// holding the token — the token VALUE never enters this table or any response
// (serialize() surfaces the ref name only). A new platform defaults enabled=0
// so the dispatcher fires nothing until an operator explicitly enables it.
//
// Mirrors the admin/listicles/media-platforms-handlers.ts template, retargeted
// to leadgen_media_platforms + the §26 value_multiplier column, with the
// get/delete handlers the §8.2 route surface adds. .bind() fixed-literal SQL;
// numeric defaults use ?? (never ||); the leadgen table name is a fixed literal.

import { readJsonBody, type AdminContext } from "./offers-handlers";

export interface MediaPlatformRecord {
  id: number;
  platform: string;
  enabled: number;
  postback_url_template: string;
  auth_secret_ref: string | null;
  event_name: string | null;
  value_multiplier: number;
  created_at: number;
}

const MACRO_TOKEN_RE = /\{[a-zA-Z0-9_:]+\}/g;
const SECRET_NAME_RE = /^[A-Z][A-Z0-9_]*$/;
const PLATFORM_RE = /^[a-z0-9_]+$/;
const CONTROL_CHARS_RE = /[\u0000-\u001f\u007f]/;

// SSRF hardening: a private / link-local / loopback / cloud-metadata host is
// never a legitimate media-platform postback endpoint. Blocked even for a
// (CF-Access-gated) admin so a mis- or maliciously-configured template cannot
// send the {auth_token} secret to an internal address. The host is already
// macro-free (authority check below), so parsed.hostname is the literal host.
function isInternalHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, ""); // strip IPv6 brackets
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h === "metadata.google.internal" || h.endsWith(".internal")) return true;
  if (h === "::1" || h === "0:0:0:0:0:0:0:1") return true; // IPv6 loopback
  if (h.startsWith("fe80")) return true; // IPv6 link-local
  if (h.startsWith("fc") || h.startsWith("fd")) return true; // IPv6 unique-local (fc00::/7)
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/);
  if (m !== null) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a === 0 || a === 127 || a === 10) return true; // this-host / loopback / private
    if (a === 169 && b === 254) return true; // link-local + cloud metadata 169.254.169.254
    if (a === 192 && b === 168) return true; // private
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
  }
  return false;
}

// §26 template rules: absolute http(s), no control chars, no macro in the
// host/authority position (a client-influenced dim can never choose the
// destination host), and no private/internal host (SSRF). The S2S template
// legitimately uses the {value}/{currency}/{event_name}/{auth_token} macros
// (distinct from the Offer macro registry).
function validatePlatformTemplate(raw: string): string | null {
  const t = raw.trim();
  if (t === "") return "postback_url_template is required";
  if (CONTROL_CHARS_RE.test(t)) return "postback_url_template must not contain control characters";
  if (!/^https?:\/\//i.test(t)) return "postback_url_template must be an absolute http(s) URL";
  const authority = t.replace(/^https?:\/\//i, "").split(/[/?#]/, 1)[0] ?? "";
  if (authority.includes("{")) return "postback_url_template must not place a macro in the host position";
  try {
    const parsed = new URL(t.replace(MACRO_TOKEN_RE, "x"));
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "postback_url_template must use the http or https scheme";
    }
    if (isInternalHost(parsed.hostname)) {
      return "postback_url_template must not target a private/internal host";
    }
  } catch {
    return "postback_url_template is not a parseable URL";
  }
  return null;
}

// §26 value_multiplier: a finite REAL ≥ 0 ({value} = revenue × multiplier). A 0
// multiplier is legitimate (report value 0) — validated with a finite guard,
// never coerced away.
function parseValueMultiplier(value: unknown): { ok: true; value: number } | { ok: false } {
  if (value === undefined) return { ok: true, value: 1 }; // create default
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n) || n < 0) return { ok: false };
  return { ok: true, value: n };
}

// Explicit projection: surfaces the secret REF NAME only — never a token VALUE
// (which never enters this table). Keeps the wire shape stable + grep-visible.
function serialize(row: MediaPlatformRecord): MediaPlatformRecord {
  return {
    id: row.id,
    platform: row.platform,
    enabled: row.enabled,
    postback_url_template: row.postback_url_template,
    auth_secret_ref: row.auth_secret_ref, // NAME only — never the token value (§30.2)
    event_name: row.event_name,
    value_multiplier: row.value_multiplier,
    created_at: row.created_at,
  };
}

// numeric → id; else the unique platform name (lowercased).
function platformSelector(idParam: string): { column: "id" | "platform"; value: number | string } | null {
  const t = (idParam ?? "").trim();
  if (t === "") return null;
  if (/^\d+$/.test(t)) {
    const n = parseInt(t, 10);
    return Number.isFinite(n) && n > 0 ? { column: "id", value: n } : null;
  }
  return { column: "platform", value: t.toLowerCase() };
}

const SELECT_COLUMNS =
  "id, platform, enabled, postback_url_template, auth_secret_ref, event_name, value_multiplier, created_at";

export async function listMediaPlatformsHandler(c: AdminContext): Promise<Response> {
  const res = await c.env.DB.prepare(
    `SELECT ${SELECT_COLUMNS} FROM leadgen_media_platforms ORDER BY platform ASC`,
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

  const multiplier = parseValueMultiplier(body.value_multiplier);
  if (!multiplier.ok) fields.value_multiplier = "must be a finite number >= 0";

  const enabled = body.enabled === true || body.enabled === 1 || body.enabled === "1" ? 1 : 0;
  const eventName =
    typeof body.event_name === "string" && body.event_name.trim() !== "" ? body.event_name.trim() : "Purchase";

  if (Object.keys(fields).length > 0) return c.json({ error: "Validation failed", fields }, 400);

  try {
    await c.env.DB.prepare(
      `INSERT INTO leadgen_media_platforms
         (platform, enabled, postback_url_template, auth_secret_ref, event_name, value_multiplier)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
      .bind(platform, enabled, template.trim(), authSecretRef, eventName, multiplier.ok ? multiplier.value : 1)
      .run();
  } catch {
    // UNIQUE(platform) → the platform already exists.
    return c.json({ error: "platform already exists", fields: { platform: "already exists" } }, 409);
  }

  const row = await c.env.DB.prepare(
    `SELECT ${SELECT_COLUMNS} FROM leadgen_media_platforms WHERE platform = ? LIMIT 1`,
  )
    .bind(platform)
    .first<MediaPlatformRecord>();
  return c.json({ media_platform: row === null ? null : serialize(row) }, 201);
}

export async function getMediaPlatformHandler(c: AdminContext): Promise<Response> {
  const sel = platformSelector(c.req.param("id") ?? "");
  if (sel === null) return c.json({ error: "Not Found" }, 404);
  const row = await c.env.DB.prepare(
    sel.column === "id"
      ? `SELECT ${SELECT_COLUMNS} FROM leadgen_media_platforms WHERE id = ? LIMIT 1`
      : `SELECT ${SELECT_COLUMNS} FROM leadgen_media_platforms WHERE platform = ? LIMIT 1`,
  )
    .bind(sel.value)
    .first<MediaPlatformRecord>();
  if (row === null) return c.json({ error: "Not Found" }, 404);
  return c.json({ media_platform: serialize(row) });
}

export async function patchMediaPlatformHandler(c: AdminContext): Promise<Response> {
  const sel = platformSelector(c.req.param("id") ?? "");
  if (sel === null) return c.json({ error: "Not Found" }, 404);
  const existing = await c.env.DB.prepare(
    sel.column === "id"
      ? `SELECT ${SELECT_COLUMNS} FROM leadgen_media_platforms WHERE id = ? LIMIT 1`
      : `SELECT ${SELECT_COLUMNS} FROM leadgen_media_platforms WHERE platform = ? LIMIT 1`,
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
    const ev =
      typeof body.event_name === "string" && body.event_name.trim() !== "" ? body.event_name.trim() : "Purchase";
    sets.push("event_name = ?");
    binds.push(ev);
  }
  if (body.value_multiplier !== undefined) {
    const multiplier = parseValueMultiplier(body.value_multiplier);
    if (!multiplier.ok) fields.value_multiplier = "must be a finite number >= 0";
    else {
      sets.push("value_multiplier = ?");
      binds.push(multiplier.value);
    }
  }

  if (Object.keys(fields).length > 0) return c.json({ error: "Validation failed", fields }, 400);
  if (sets.length === 0) return c.json({ error: "no updatable fields provided" }, 400);

  binds.push(existing.id);
  await c.env.DB.prepare(`UPDATE leadgen_media_platforms SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...binds)
    .run();

  const row = await c.env.DB.prepare(
    `SELECT ${SELECT_COLUMNS} FROM leadgen_media_platforms WHERE id = ? LIMIT 1`,
  )
    .bind(existing.id)
    .first<MediaPlatformRecord>();
  return c.json({ media_platform: row === null ? null : serialize(row) });
}

export async function deleteMediaPlatformHandler(c: AdminContext): Promise<Response> {
  const sel = platformSelector(c.req.param("id") ?? "");
  if (sel === null) return c.json({ error: "Not Found" }, 404);
  const existing = await c.env.DB.prepare(
    sel.column === "id"
      ? "SELECT id FROM leadgen_media_platforms WHERE id = ? LIMIT 1"
      : "SELECT id FROM leadgen_media_platforms WHERE platform = ? LIMIT 1",
  )
    .bind(sel.value)
    .first<{ id: number }>();
  if (existing === null) return c.json({ error: "Not Found" }, 404);
  await c.env.DB.prepare("DELETE FROM leadgen_media_platforms WHERE id = ?").bind(existing.id).run();
  return c.json({ ok: true, id: existing.id });
}
