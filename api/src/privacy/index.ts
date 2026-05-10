// Privacy module — CCPA / "Do Not Sell My Personal Information" opt-out.
//
// Three unauthenticated public routes:
//   GET  /api/privacy/status   — read current opt-out state for this client.
//   POST /api/privacy/opt-out  — record opt-out + set ccpa_opt_out=1 cookie.
//   POST /api/privacy/opt-in   — clear opt-out + expire ccpa_opt_out cookie.
//
// The client identifier is sha256(`<ip>|<ua>`) computed via Web Crypto
// (subtle.digest('SHA-256', ...)). The hex digest is stored in
// privacy_opt_outs.identifier_hash (UNIQUE) so we never persist the
// raw IP or UA — only an irreversible hash.

import { Hono } from "hono";
import type { Env } from "../env";

const COOKIE_NAME = "ccpa_opt_out";
// One year in seconds — matches the typical CCPA opt-out persistence window.
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export async function hashIdentifier(ip: string, ua: string): Promise<string> {
  const data = new TextEncoder().encode(`${ip}|${ua}`);
  const buf = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(buf);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i]!.toString(16).padStart(2, "0");
  }
  return hex;
}

export function clientFingerprint(req: Request): { ip: string; ua: string } {
  // cf-connecting-ip is the canonical client IP behind a Cloudflare Worker.
  // Fall back to the first x-forwarded-for hop and finally to "0.0.0.0" so
  // hashing stays deterministic even when the headers are stripped.
  const ip =
    req.headers.get("cf-connecting-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "0.0.0.0";
  const ua = req.headers.get("user-agent") ?? "";
  return { ip, ua };
}

function readCookieValue(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(/;\s*/)) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq) === name) return part.slice(eq + 1);
  }
  return null;
}

function buildCookie(value: string, maxAgeSeconds: number): string {
  return `${COOKIE_NAME}=${value}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; Secure; SameSite=Lax`;
}

const privacy = new Hono<{ Bindings: Env }>();

// Route: GET /api/privacy/status — read opt-out state.
privacy.get("/api/privacy/status", async (c) => {
  const cookieValue = readCookieValue(c.req.header("cookie") ?? null, COOKIE_NAME);
  if (cookieValue === "1") {
    return c.json({ opted_out: true, source: "cookie" });
  }
  const { ip, ua } = clientFingerprint(c.req.raw);
  const id = await hashIdentifier(ip, ua);
  const row = await c.env.DB.prepare(
    "SELECT opted_out FROM privacy_opt_outs WHERE identifier_hash = ?",
  )
    .bind(id)
    .first<{ opted_out: number }>();
  return c.json({ opted_out: row?.opted_out === 1, source: "db" });
});

// Route: POST /api/privacy/opt-out — record opt-out + set cookie.
privacy.post("/api/privacy/opt-out", async (c) => {
  const { ip, ua } = clientFingerprint(c.req.raw);
  const id = await hashIdentifier(ip, ua);
  await c.env.DB.prepare(
    "INSERT INTO privacy_opt_outs (identifier_hash, opted_out) VALUES (?, 1) ON CONFLICT(identifier_hash) DO UPDATE SET opted_out = 1",
  )
    .bind(id)
    .run();
  c.header("Set-Cookie", buildCookie("1", COOKIE_MAX_AGE_SECONDS));
  return c.json({ opted_out: true });
});

// Route: POST /api/privacy/opt-in — clear opt-out + expire cookie.
privacy.post("/api/privacy/opt-in", async (c) => {
  const { ip, ua } = clientFingerprint(c.req.raw);
  const id = await hashIdentifier(ip, ua);
  await c.env.DB.prepare(
    "INSERT INTO privacy_opt_outs (identifier_hash, opted_out) VALUES (?, 0) ON CONFLICT(identifier_hash) DO UPDATE SET opted_out = 0",
  )
    .bind(id)
    .run();
  c.header("Set-Cookie", buildCookie("", 0));
  return c.json({ opted_out: false });
});

export default privacy;
