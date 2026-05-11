// Preview module — HMAC-signed short-lived tokens for draft article previews.
//
// Tokens are NOT JWTs (no jose import here, deliberately). They are a
// compact `<base64url(payload)>.<base64url(signature)>` pair where the
// signature is `HMAC-SHA-256(secret, payloadBytes)`. Using Web Crypto
// directly keeps the surface tiny, avoids alg=none confusion, and lets
// the signing/verification path stay grep-auditable: the AC requires
// `subtle.sign("HMAC", ...)` AND `subtle.verify("HMAC", ...)` to BOTH
// appear in this file.
//
// Payload encodes { articleId, versionId, exp } where `exp` is a unix
// second. L-124 hardening: every claim (articleId/versionId/exp) is
// validated with `typeof === "number"` — never truthiness — so a
// crafted payload with `exp: 0` or missing claims is rejected, not
// silently accepted.

import { Hono } from "hono";
import { contentJsonToHtml } from "../editor";
import type { Env } from "../env";

export interface PreviewPayload {
  articleId: number;
  versionId: number;
  exp: number;
}

interface PreviewVersionRow {
  content_json: string;
  status: string;
  article_id: number;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]!);
  }
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

type HmacKeyUsage = "sign" | "verify";

async function importHmacKey(secret: string, usage: HmacKeyUsage): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    [usage],
  );
}

export async function signPreviewToken(
  secret: string,
  payload: PreviewPayload,
): Promise<string> {
  if (!secret) throw new Error("PREVIEW_SECRET is required to sign tokens");
  const json = JSON.stringify(payload);
  const data = new TextEncoder().encode(json);
  const key = await importHmacKey(secret, "sign");
  const sig = await crypto.subtle.sign("HMAC", key, data);
  return `${base64UrlEncode(data)}.${base64UrlEncode(new Uint8Array(sig))}`;
}

export async function verifyPreviewToken(
  secret: string,
  token: string,
): Promise<PreviewPayload | null> {
  if (!secret || !token) return null;
  const dot = token.indexOf(".");
  if (dot < 1 || dot === token.length - 1) return null;
  const bodyB64 = token.slice(0, dot);
  const sigB64 = token.slice(dot + 1);

  let data: Uint8Array;
  let sigBytes: Uint8Array;
  try {
    data = base64UrlDecode(bodyB64);
    sigBytes = base64UrlDecode(sigB64);
  } catch {
    return null;
  }

  const key = await importHmacKey(secret, "verify");
  const ok = await crypto.subtle.verify("HMAC", key, sigBytes, data);
  if (!ok) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(data));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const { articleId, versionId, exp } = parsed as Record<string, unknown>;
  if (typeof articleId !== "number" || !Number.isFinite(articleId)) return null;
  if (typeof versionId !== "number" || !Number.isFinite(versionId)) return null;
  if (typeof exp !== "number" || !Number.isFinite(exp)) return null;
  if (exp <= Math.floor(Date.now() / 1000)) return null;
  return { articleId, versionId, exp };
}

const preview = new Hono<{ Bindings: Env }>();

// Route: GET /preview/:id?token=<hmac-token> — render the snapshotted draft.
preview.get("/preview/:id", async (c) => {
  const secret = c.env.PREVIEW_SECRET;
  if (!secret) {
    return c.json({ error: "Preview is not configured" }, 500);
  }

  const idParam = c.req.param("id");
  const articleId = parseInt(idParam, 10);
  if (!Number.isFinite(articleId) || articleId <= 0) {
    return c.json({ error: "Invalid article id" }, 400);
  }

  const token =
    c.req.query("token") ?? c.req.header("x-preview-token") ?? "";
  const payload = await verifyPreviewToken(secret, token);
  if (!payload) {
    return c.json({ error: "Invalid or expired preview token" }, 401);
  }
  if (payload.articleId !== articleId) {
    return c.json({ error: "Token does not match article id" }, 401);
  }

  const row = await c.env.DB
    .prepare(
      "SELECT content_json, status, article_id FROM article_versions WHERE id = ? AND article_id = ? LIMIT 1",
    )
    .bind(payload.versionId, articleId)
    .first<PreviewVersionRow>();
  if (!row) {
    return c.json({ error: "Preview version not found" }, 404);
  }

  const html = contentJsonToHtml(row.content_json);
  c.header("Cache-Control", "private, no-store");
  c.header("X-Robots-Tag", "noindex, nofollow");
  return c.html(html);
});

export default preview;
