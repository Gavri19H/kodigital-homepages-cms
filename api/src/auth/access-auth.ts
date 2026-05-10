import type { Context, MiddlewareHandler } from "hono";
import { parseBoolean, type Env } from "../env";

const JWKS_KV_KEY = "cf-access-jwks";
const JWKS_TTL_SECONDS = 60 * 60 * 24;

type Jwk = { kid: string; kty: string; alg?: string; use?: string; n: string; e: string };
type Jwks = { keys: Jwk[] };
type AccessClaims = {
  iss?: string; aud?: string | string[];
  exp?: number; nbf?: number; iat?: number;
  email?: string; common_name?: string; sub?: string;
};

export type AccessContext =
  | { mode: "identity"; email: string; sub?: string; claims: AccessClaims }
  | { mode: "service-token"; commonName: string; sub?: string; claims: AccessClaims };

export type AccessAuthVariables = { access: AccessContext };
type Bindings = { Bindings: Env; Variables: AccessAuthVariables };

// Double-gate: DEV_BYPASS_AUTH is honored only when APP_ENV !== 'production',
// so a leaked production secret cannot disable Access verification.
function isBypassActive(env: Env): boolean {
  const isProd = (env.APP_ENV ?? "").trim().toLowerCase() === "production";
  return parseBoolean(env.DEV_BYPASS_AUTH) && !isProd;
}

function base64UrlToBytes(b64url: string): Uint8Array {
  const pad = "=".repeat((4 - (b64url.length % 4)) % 4);
  const b64 = (b64url + pad).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function base64UrlDecodeUtf8(b64url: string): string {
  return new TextDecoder().decode(base64UrlToBytes(b64url));
}

async function fetchJwks(env: Env): Promise<Jwks | null> {
  const teamDomain = (env.CF_ACCESS_TEAM_DOMAIN ?? "").trim();
  if (!teamDomain) return null;
  let cached: Jwks | null = null;
  try { cached = (await env.CACHE.get(JWKS_KV_KEY, "json")) as Jwks | null; } catch { cached = null; }
  if (cached && Array.isArray(cached.keys)) return cached;
  const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`, { headers: { accept: "application/json" } });
  if (!res.ok) return null;
  const fresh = (await res.json()) as Jwks;
  if (!fresh || !Array.isArray(fresh.keys)) return null;
  // KV write failure is non-fatal — verification proceeds with the fresh JWKS.
  try { await env.CACHE.put(JWKS_KV_KEY, JSON.stringify(fresh), { expirationTtl: JWKS_TTL_SECONDS }); } catch { /* ignore */ }
  return fresh;
}

async function importJsonWebKey(jwk: Jwk): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "jwk",
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: jwk.alg ?? "RS256", ext: true } as JsonWebKey,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
}

async function verifyJwt(jwt: string, jwks: Jwks): Promise<AccessClaims | null> {
  const parts = jwt.split(".");
  if (parts.length !== 3) return null;
  const headerB64 = parts[0] as string;
  const payloadB64 = parts[1] as string;
  const sigB64 = parts[2] as string;
  let header: { alg?: string; kid?: string };
  let claims: AccessClaims;
  try {
    header = JSON.parse(base64UrlDecodeUtf8(headerB64)) as { alg?: string; kid?: string };
    claims = JSON.parse(base64UrlDecodeUtf8(payloadB64)) as AccessClaims;
  } catch {
    return null;
  }
  if (header.alg !== "RS256") return null;
  const jwk = jwks.keys.find((k) => k.kid === header.kid);
  if (!jwk) return null;
  const key = await importJsonWebKey(jwk);
  const ok = await crypto.subtle.verify(
    { name: "RSASSA-PKCS1-v1_5" },
    key,
    base64UrlToBytes(sigB64),
    new TextEncoder().encode(`${headerB64}.${payloadB64}`),
  );
  return ok ? claims : null;
}

function validateClaims(claims: AccessClaims, env: Env, nowSec: number): boolean {
  if (typeof claims.exp !== "number" || claims.exp <= nowSec) return false;
  if (typeof claims.iat !== "number") return false;
  if (claims.nbf !== undefined && (typeof claims.nbf !== "number" || claims.nbf > nowSec + 60)) return false;
  const teamDomain = (env.CF_ACCESS_TEAM_DOMAIN ?? "").trim();
  if (!teamDomain || claims.iss !== `https://${teamDomain}`) return false;
  const expectedAud = (env.CF_ACCESS_AUD ?? "").trim();
  if (!expectedAud) return false;
  if (Array.isArray(claims.aud)) return claims.aud.includes(expectedAud);
  return claims.aud === expectedAud;
}

function readJwt(c: Context): string | null {
  const header = c.req.header("cf-access-jwt-assertion");
  if (header && header.trim() !== "") return header.trim();
  const cookieHeader = c.req.header("cookie") ?? "";
  const m = /(?:^|;\s*)CF_Authorization=([^;]+)/.exec(cookieHeader);
  return m ? decodeURIComponent(m[1] as string).trim() : null;
}

function unauthorized(c: Context, reason: string): Response {
  return c.json({ error: `Unauthorized: ${reason}` }, 401);
}

export const accessAuth: MiddlewareHandler<Bindings> = async (c, next) => {
  if (isBypassActive(c.env)) return next();

  const jwt = readJwt(c);
  if (!jwt) return unauthorized(c, "missing Cloudflare Access credentials");

  const jwks = await fetchJwks(c.env);
  if (!jwks) return unauthorized(c, "JWKS unavailable");

  const claims = await verifyJwt(jwt, jwks);
  if (!claims) return unauthorized(c, "invalid JWT");

  const nowSec = Math.floor(Date.now() / 1000);
  if (!validateClaims(claims, c.env, nowSec)) {
    return unauthorized(c, "invalid claims");
  }

  const email = typeof claims.email === "string" && claims.email.trim() !== "" ? claims.email.trim() : null;
  const commonName = typeof claims.common_name === "string" && claims.common_name.trim() !== "" ? claims.common_name.trim() : null;

  if (commonName && !email) {
    const allowList = (c.env.ALLOWED_CF_SERVICE_TOKEN_IDS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (allowList.length > 0 && !allowList.includes(commonName)) {
      return c.json({ error: "Forbidden: service token not allowed" }, 403);
    }
    c.set("access", { mode: "service-token", commonName, sub: claims.sub, claims });
    return next();
  }

  if (email) {
    c.set("access", { mode: "identity", email, sub: claims.sub, claims });
    return next();
  }

  return unauthorized(c, "missing email or common_name");
};

export const authStatusHandler = (c: Context<Bindings>): Response => {
  if (isBypassActive(c.env)) return c.json({ authenticated: true, mode: "dev-bypass" });
  const access = c.get("access");
  if (!access) return c.json({ authenticated: false }, 401);
  if (access.mode === "identity") {
    return c.json({ authenticated: true, mode: "identity", email: access.email });
  }
  return c.json({ authenticated: true, mode: "service-token", common_name: access.commonName });
};
