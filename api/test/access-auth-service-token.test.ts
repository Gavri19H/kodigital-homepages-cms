import { describe, it, expect, beforeAll } from "vitest";
import app from "../src/index";
import type { Env } from "../src/env";

const TEAM_DOMAIN = "kodigital2.cloudflareaccess.com";
const AUD = "test-aud-tag-1234567890abcdef";
const KID = "test-kid-1";

interface SignedKey {
  jwks: { keys: Array<{ kid: string; kty: string; alg: string; use: string; n: string; e: string }> };
  privateKey: CryptoKey;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i] as number);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function utf8ToBase64Url(s: string): string {
  return bytesToBase64Url(new TextEncoder().encode(s));
}

async function makeJwks(): Promise<SignedKey> {
  const kp = (await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const pub = (await crypto.subtle.exportKey("jwk", kp.publicKey)) as JsonWebKey & {
    n: string;
    e: string;
  };
  return {
    jwks: {
      keys: [
        {
          kid: KID,
          kty: "RSA",
          alg: "RS256",
          use: "sig",
          n: pub.n,
          e: pub.e,
        },
      ],
    },
    privateKey: kp.privateKey,
  };
}

async function signJwt(
  privateKey: CryptoKey,
  claims: Record<string, unknown>,
): Promise<string> {
  const header = { alg: "RS256", typ: "JWT", kid: KID };
  const h = utf8ToBase64Url(JSON.stringify(header));
  const p = utf8ToBase64Url(JSON.stringify(claims));
  const signingInput = `${h}.${p}`;
  const sig = await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" },
    privateKey,
    new TextEncoder().encode(signingInput),
  );
  const s = bytesToBase64Url(new Uint8Array(sig));
  return `${signingInput}.${s}`;
}

function makeKvStub(jwksValue: unknown): KVNamespace {
  return {
    async get(key: string, type?: string) {
      if (key === "cf-access-jwks" && type === "json") return jwksValue as never;
      return null as never;
    },
    async put() {},
    async delete() {},
    async list() {
      return { keys: [], list_complete: true } as never;
    },
    async getWithMetadata() {
      return { value: null, metadata: null } as never;
    },
  } as unknown as KVNamespace;
}

function makeBaseEnv(kv: KVNamespace): Env {
  return {
    DB: {} as D1Database,
    CACHE: kv,
    MEDIA: {} as R2Bucket,
    APP_ENV: "test",
    ADMIN_HOST: "cms.kodigital.app",
    ADMIN_BASE_URL: "https://cms.kodigital.app",
    ADMIN_BASE_PATH: "/admin",
    CACHE_API_ENABLED: "false",
    HTML_CACHE_TTL_SECONDS: "60",
    OPENAI_TEXT_MODEL: "",
    OPENAI_IMAGE_MODEL: "",
    SITE_PROVISIONING_DRY_RUN: "true",
    SITE_PROVISIONING_ALLOW_ROUTE_MUTATION: "false",
    CF_ACCESS_TEAM_DOMAIN: TEAM_DOMAIN,
    CF_ACCESS_AUD: AUD,
  };
}

describe("accessAuth service-token mode (T4 — common_name path)", () => {
  let signer: SignedKey;
  let kv: KVNamespace;

  beforeAll(async () => {
    signer = await makeJwks();
    kv = makeKvStub(signer.jwks);
  });

  it("valid JWT with common_name (no email) is authenticated as service-token mode", async () => {
    const now = Math.floor(Date.now() / 1000);
    const jwt = await signJwt(signer.privateKey, {
      iss: `https://${TEAM_DOMAIN}`,
      aud: AUD,
      iat: now,
      nbf: now - 10,
      exp: now + 600,
      common_name: "KODIGITAL_CMS_SMOKE_TESTS.123abc.access",
      sub: "service-token-sub",
    });
    const res = await app.request(
      "https://cms.kodigital.app/api/admin/auth/status",
      { headers: { "cf-access-jwt-assertion": jwt } },
      makeBaseEnv(kv),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      authenticated: boolean;
      mode: string;
      common_name?: string;
    };
    expect(body.authenticated).toBe(true);
    expect(body.mode).toBe("service-token");
    expect(body.common_name).toBe("KODIGITAL_CMS_SMOKE_TESTS.123abc.access");
  });

  it("returns 403 when common_name is not in ALLOWED_CF_SERVICE_TOKEN_IDS allowlist", async () => {
    const now = Math.floor(Date.now() / 1000);
    const jwt = await signJwt(signer.privateKey, {
      iss: `https://${TEAM_DOMAIN}`,
      aud: AUD,
      iat: now,
      nbf: now - 10,
      exp: now + 600,
      common_name: "UNKNOWN_TOKEN.999.access",
    });
    const env = {
      ...makeBaseEnv(kv),
      ALLOWED_CF_SERVICE_TOKEN_IDS: "KODIGITAL_CMS_SMOKE_TESTS.123abc.access",
    };
    const res = await app.request(
      "https://cms.kodigital.app/api/admin/auth/status",
      { headers: { "cf-access-jwt-assertion": jwt } },
      env,
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/Forbidden/i);
  });

  it("allows common_name when present in ALLOWED_CF_SERVICE_TOKEN_IDS", async () => {
    const now = Math.floor(Date.now() / 1000);
    const jwt = await signJwt(signer.privateKey, {
      iss: `https://${TEAM_DOMAIN}`,
      aud: AUD,
      iat: now,
      nbf: now - 10,
      exp: now + 600,
      common_name: "KODIGITAL_CMS_SMOKE_TESTS.123abc.access",
    });
    const env = {
      ...makeBaseEnv(kv),
      ALLOWED_CF_SERVICE_TOKEN_IDS: "OTHER.x.access, KODIGITAL_CMS_SMOKE_TESTS.123abc.access",
    };
    const res = await app.request(
      "https://cms.kodigital.app/api/admin/auth/status",
      { headers: { "cf-access-jwt-assertion": jwt } },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { mode: string };
    expect(body.mode).toBe("service-token");
  });

  it("expired JWT returns 401 (exp <= now)", async () => {
    const now = Math.floor(Date.now() / 1000);
    const jwt = await signJwt(signer.privateKey, {
      iss: `https://${TEAM_DOMAIN}`,
      aud: AUD,
      iat: now - 1000,
      exp: now - 10,
      common_name: "KODIGITAL_CMS_SMOKE_TESTS.123abc.access",
    });
    const res = await app.request(
      "https://cms.kodigital.app/admin",
      { headers: { "cf-access-jwt-assertion": jwt } },
      makeBaseEnv(kv),
    );
    expect(res.status).toBe(401);
  });

  it("wrong aud returns 401", async () => {
    const now = Math.floor(Date.now() / 1000);
    const jwt = await signJwt(signer.privateKey, {
      iss: `https://${TEAM_DOMAIN}`,
      aud: "wrong-audience",
      iat: now,
      exp: now + 600,
      common_name: "KODIGITAL_CMS_SMOKE_TESTS.123abc.access",
    });
    const res = await app.request(
      "https://cms.kodigital.app/admin",
      { headers: { "cf-access-jwt-assertion": jwt } },
      makeBaseEnv(kv),
    );
    expect(res.status).toBe(401);
  });

  it("wrong iss returns 401", async () => {
    const now = Math.floor(Date.now() / 1000);
    const jwt = await signJwt(signer.privateKey, {
      iss: "https://attacker.example.com",
      aud: AUD,
      iat: now,
      exp: now + 600,
      common_name: "KODIGITAL_CMS_SMOKE_TESTS.123abc.access",
    });
    const res = await app.request(
      "https://cms.kodigital.app/admin",
      { headers: { "cf-access-jwt-assertion": jwt } },
      makeBaseEnv(kv),
    );
    expect(res.status).toBe(401);
  });

  it("valid identity JWT with email returns mode:'identity' and the email", async () => {
    const now = Math.floor(Date.now() / 1000);
    const jwt = await signJwt(signer.privateKey, {
      iss: `https://${TEAM_DOMAIN}`,
      aud: AUD,
      iat: now,
      exp: now + 600,
      email: "guy@kodigital.io",
      sub: "user-sub",
    });
    const res = await app.request(
      "https://cms.kodigital.app/api/admin/auth/status",
      { headers: { "cf-access-jwt-assertion": jwt } },
      makeBaseEnv(kv),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      authenticated: boolean;
      mode: string;
      email?: string;
    };
    expect(body.authenticated).toBe(true);
    expect(body.mode).toBe("identity");
    expect(body.email).toBe("guy@kodigital.io");
  });
});
