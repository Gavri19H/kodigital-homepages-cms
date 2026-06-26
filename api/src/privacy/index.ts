// Privacy module — CCPA / "Do Not Sell My Personal Information" opt-out.
//
// Four unauthenticated public routes:
//   GET    /api/privacy/status   — read current opt-out state for this client.
//   POST   /api/privacy/opt-out  — record opt-out + set ccpa_opt_out=1 cookie.
//   POST   /api/privacy/opt-in   — clear opt-out + expire ccpa_opt_out cookie.
//   DELETE /api/privacy/data     — CCPA right-to-delete: remove the caller's
//                                  stored privacy row(s) (by hash) + expire the
//                                  cookie, returning a deletion confirmation.
//
// The client identifier is sha256(`<ip>|<ua>`) computed via Web Crypto
// (subtle.digest('SHA-256', ...)). The hex digest is stored in
// privacy_opt_outs.identifier_hash (UNIQUE) so we never persist the
// raw IP or UA — only an irreversible hash.

import { Hono, type Context } from "hono";
import type { Env } from "../env";
import { checkRateLimit } from "../safety/rate-limit";

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

// RFC 9457 problem+json response — scoped to the NEW rate-limit 429s only; the
// existing {opted_out}/{deleted} success + error shapes are left unchanged.
function privacyProblem(
  status: number,
  type: string,
  title: string,
  detail: string,
  retryAfterSeconds?: number,
): Response {
  const headers = new Headers({
    "Content-Type": "application/problem+json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  if (retryAfterSeconds !== undefined && retryAfterSeconds > 0) {
    headers.set("Retry-After", String(retryAfterSeconds));
  }
  const body = JSON.stringify({
    type: `https://kodigital.app/problems/${type}`,
    title,
    status,
    detail,
  });
  return new Response(body, { status, headers });
}

// rescue-6 (agent-readiness M4.2): best-effort per-client rate limit on the
// UNAUTHENTICATED privacy write endpoints (the one unauthenticated DB-write
// abuse surface). Active only at the real edge (request.cf present) so unit
// tests are unaffected, and fail-open inside checkRateLimit so a KV hiccup never
// breaks an opt-out. Hard enforcement belongs in a Cloudflare WAF rate-limit
// rule; this is the in-app backstop + the correct 429 + Retry-After contract.
async function enforcePrivacyRateLimit(
  c: Context<{ Bindings: Env }>,
): Promise<Response | null> {
  const cf = (c.req.raw as unknown as { cf?: unknown }).cf;
  if (cf === undefined) return null;
  const kv = c.env.CACHE;
  if (kv === undefined || kv === null) return null;
  const { ip } = clientFingerprint(c.req.raw);
  // Hash the IP for the key so we never store a raw IP, even ephemerally
  // (consistent with this module's privacy-preserving identity hashing).
  const idHash = await hashIdentifier(ip, "");
  const result = await checkRateLimit(kv, `rl:privacy:${idHash}`, {
    limit: 20,
    windowSeconds: 60,
  });
  if (result.allowed) return null;
  return privacyProblem(
    429,
    "rate-limited",
    "Too Many Requests",
    "Too many privacy requests from this client. Please retry shortly.",
    result.retryAfterSeconds,
  );
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
  const limited = await enforcePrivacyRateLimit(c);
  if (limited) return limited;
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
  const limited = await enforcePrivacyRateLimit(c);
  if (limited) return limited;
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

// Route: DELETE /api/privacy/data — CCPA right-to-delete.
// Removes every privacy_opt_outs row keyed by this caller's identifier hash
// (the same sha256(`<ip>|<ua>`) used by the other routes) and expires the
// ccpa_opt_out cookie so no stored state survives the request. Returns a
// confirmation including how many rows were removed (0 is a valid result for
// a caller who never opted out — the right-to-delete is still honored).
privacy.delete("/api/privacy/data", async (c) => {
  const limited = await enforcePrivacyRateLimit(c);
  if (limited) return limited;
  const { ip, ua } = clientFingerprint(c.req.raw);
  const id = await hashIdentifier(ip, ua);
  const result = await c.env.DB.prepare(
    "DELETE FROM privacy_opt_outs WHERE identifier_hash = ?",
  )
    .bind(id)
    .run();
  const deletedCount = result?.meta?.changes ?? 0;
  // Expire the cookie regardless: the caller's stored state is being erased.
  c.header("Set-Cookie", buildCookie("", 0));
  return c.json({ deleted: true, rows_deleted: deletedCount });
});

export default privacy;
