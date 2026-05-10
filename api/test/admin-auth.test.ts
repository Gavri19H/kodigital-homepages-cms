import { describe, it, expect, beforeAll } from "vitest";
import {
  SignJWT,
  exportJWK,
  generateKeyPair,
  type JSONWebKeySet,
} from "jose";
import app from "../src/index";
import type { Env } from "../src/env";

const TEAM_DOMAIN = "kodigital.cloudflareaccess.com";
const AUDIENCE = "test-audience-aud";
const KID = "test-kid";

let signedToken: string;
let expiredToken: string;
let wrongAudienceToken: string;
let jwks: JSONWebKeySet;

function makeKvMock(seed?: { [key: string]: string }): {
  kv: KVNamespace;
  store: Map<string, { value: string; ttl?: number }>;
} {
  const store = new Map<string, { value: string; ttl?: number }>();
  if (seed) {
    for (const [k, v] of Object.entries(seed)) store.set(k, { value: v });
  }
  const kv = {
    async get(key: string, type?: "json" | "text" | "arrayBuffer" | "stream") {
      const entry = store.get(key);
      if (!entry) return null;
      if (type === "json") return JSON.parse(entry.value);
      return entry.value;
    },
    async put(
      key: string,
      value: string,
      opts?: { expirationTtl?: number },
    ) {
      store.set(key, { value, ttl: opts?.expirationTtl });
    },
    async delete(key: string) {
      store.delete(key);
    },
    async list() {
      return { keys: [], list_complete: true, cacheStatus: null };
    },
    async getWithMetadata() {
      return { value: null, metadata: null, cacheStatus: null };
    },
  } as unknown as KVNamespace;
  return { kv, store };
}

function buildEnv(overrides: Partial<Env> = {}): Env {
  const { kv, store } = makeKvMock({ "cf-access:jwks": JSON.stringify(jwks) });
  // Attach store to env for assertions in tests that need it.
  (kv as unknown as { __store: typeof store }).__store = store;
  return {
    DB: {} as D1Database,
    CACHE: kv,
    MEDIA: {} as R2Bucket,
    APP_ENV: "test",
    ADMIN_BASE_URL: "http://localhost:8787",
    CACHE_API_ENABLED: "false",
    OPENAI_TEXT_MODEL: "",
    OPENAI_IMAGE_MODEL: "",
    CF_ACCESS_TEAM_DOMAIN: TEAM_DOMAIN,
    CF_ACCESS_AUD: AUDIENCE,
    ...overrides,
  };
}

beforeAll(async () => {
  const { publicKey, privateKey } = await generateKeyPair("RS256", {
    extractable: true,
  });
  const publicJwk = await exportJWK(publicKey);
  publicJwk.kid = KID;
  publicJwk.alg = "RS256";
  publicJwk.use = "sig";
  jwks = { keys: [publicJwk] };

  const issuer = `https://${TEAM_DOMAIN}`;
  const now = Math.floor(Date.now() / 1000);

  signedToken = await new SignJWT({ email: "user@example.com" })
    .setProtectedHeader({ alg: "RS256", kid: KID })
    .setIssuer(issuer)
    .setAudience(AUDIENCE)
    .setIssuedAt(now)
    .setNotBefore(now - 60)
    .setExpirationTime(now + 600)
    .sign(privateKey);

  expiredToken = await new SignJWT({ email: "user@example.com" })
    .setProtectedHeader({ alg: "RS256", kid: KID })
    .setIssuer(issuer)
    .setAudience(AUDIENCE)
    .setIssuedAt(now - 7200)
    .setExpirationTime(now - 3600)
    .sign(privateKey);

  wrongAudienceToken = await new SignJWT({ email: "user@example.com" })
    .setProtectedHeader({ alg: "RS256", kid: KID })
    .setIssuer(issuer)
    .setAudience("some-other-audience")
    .setIssuedAt(now)
    .setExpirationTime(now + 600)
    .sign(privateKey);
});

describe("accessAuth on /admin (JWKS + RS256)", () => {
  it("returns 401 when DEV_BYPASS_AUTH is unset and no JWT is provided", async () => {
    const res = await app.request("/admin", {}, buildEnv());
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/Unauthorized/i);
  });

  it("DEV_BYPASS_AUTH=true (non-production) lets request through with no JWT", async () => {
    const res = await app.request(
      "/admin",
      {},
      buildEnv({ DEV_BYPASS_AUTH: "true", APP_ENV: "development" }),
    );
    expect(res.status).toBe(200);
  });

  it("DEV_BYPASS_AUTH=true is IGNORED when APP_ENV=production (no JWT -> 401)", async () => {
    const res = await app.request(
      "/admin",
      {},
      buildEnv({ DEV_BYPASS_AUTH: "true", APP_ENV: "production" }),
    );
    expect(res.status).toBe(401);
  });

  it("returns 200 with a valid signed JWT in cf-access-jwt-assertion header", async () => {
    const res = await app.request(
      "/admin",
      { headers: { "cf-access-jwt-assertion": signedToken } },
      buildEnv(),
    );
    expect(res.status).toBe(200);
  });

  it("returns 200 with a valid signed JWT in CF_Authorization cookie", async () => {
    const res = await app.request(
      "/admin",
      { headers: { cookie: `CF_Authorization=${signedToken}; other=foo` } },
      buildEnv(),
    );
    expect(res.status).toBe(200);
  });

  it("returns 401 when the JWT is expired", async () => {
    const res = await app.request(
      "/admin",
      { headers: { "cf-access-jwt-assertion": expiredToken } },
      buildEnv(),
    );
    expect(res.status).toBe(401);
  });

  it("returns 401 when the JWT audience does not match CF_ACCESS_AUD", async () => {
    const res = await app.request(
      "/admin",
      { headers: { "cf-access-jwt-assertion": wrongAudienceToken } },
      buildEnv(),
    );
    expect(res.status).toBe(401);
  });

  it("returns 401 when the token is unsigned garbage", async () => {
    const res = await app.request(
      "/admin",
      { headers: { "cf-access-jwt-assertion": "not-a-real-jwt" } },
      buildEnv(),
    );
    expect(res.status).toBe(401);
  });
});
