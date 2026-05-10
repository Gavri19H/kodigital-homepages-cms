import type { MiddlewareHandler } from "hono";
import {
  createLocalJWKSet,
  jwtVerify,
  type JSONWebKeySet,
  type JWTPayload,
} from "jose";
import { parseBoolean, type Env } from "../env";

const JWKS_CACHE_KEY = "cf-access:jwks";

interface AccessJwtPayload extends JWTPayload {
  email?: string;
}

function extractToken(headerToken: string | undefined, cookieHeader: string): string | undefined {
  if (headerToken) return headerToken;
  const match = /(?:^|;\s*)CF_Authorization=([^;]+)/.exec(cookieHeader);
  return match ? match[1] : undefined;
}

async function loadJwks(env: Env, teamDomain: string): Promise<JSONWebKeySet> {
  const cached = await env.CACHE.get<JSONWebKeySet>(JWKS_CACHE_KEY, "json");
  if (cached && Array.isArray(cached.keys) && cached.keys.length > 0) {
    return cached;
  }
  const certsUrl = `https://${teamDomain}/cdn-cgi/access/certs`;
  const res = await fetch(certsUrl);
  if (!res.ok) {
    throw new Error(`JWKS fetch failed: ${res.status}`);
  }
  const fresh = (await res.json()) as JSONWebKeySet;
  // 86400 seconds = 24h — required JWKS cache TTL per the auth contract.
  await env.CACHE.put(JWKS_CACHE_KEY, JSON.stringify(fresh), {
    expirationTtl: 86400,
  });
  return fresh;
}

async function verifyAccessJwt(token: string, env: Env): Promise<AccessJwtPayload> {
  const teamDomain = env.CF_ACCESS_TEAM_DOMAIN;
  const audience = env.CF_ACCESS_AUD;
  if (!teamDomain || !audience) {
    throw new Error("CF Access not configured");
  }
  const jwks = await loadJwks(env, teamDomain);
  const keyResolver = createLocalJWKSet(jwks);
  const { payload } = await jwtVerify(token, keyResolver, {
    issuer: `https://${teamDomain}`,
    audience,
    algorithms: ["RS256"],
  });
  const accessPayload = payload as AccessJwtPayload;
  if (!accessPayload.email || typeof accessPayload.email !== "string") {
    throw new Error("JWT missing email claim");
  }
  return accessPayload;
}

export const accessAuth: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  // Dev bypass — only when DEV_BYPASS_AUTH is true AND we are NOT in production.
  // The APP_ENV gate prevents the env var from leaking into production config and
  // disabling auth there (per L-024 guardrail from past CMS incidents).
  if (parseBoolean(c.env.DEV_BYPASS_AUTH) && c.env.APP_ENV !== "production") {
    return next();
  }

  const headerToken = c.req.header("cf-access-jwt-assertion");
  const cookieHeader = c.req.header("cookie") ?? "";
  const token = extractToken(headerToken, cookieHeader);

  if (!token) {
    return c.json(
      { error: "Unauthorized: missing Cloudflare Access credentials" },
      401,
    );
  }

  try {
    await verifyAccessJwt(token, c.env);
  } catch {
    return c.json(
      { error: "Unauthorized: invalid Cloudflare Access JWT" },
      401,
    );
  }
  return next();
};
