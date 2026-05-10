import { describe, it, expect } from "vitest";
import {
  parseBoolean,
  parseNumber,
  getAdminHost,
  getAdminBaseUrl,
  isDryRunProvisioning,
  isRouteMutationAllowed,
  type Env,
} from "../src/env";

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    DB: {} as D1Database,
    CACHE: {} as KVNamespace,
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
    ...overrides,
  };
}

describe("Env interface typing (T2)", () => {
  it("Env accepts CLOUDFLARE_PROVISIONING_API_TOKEN optional secret", () => {
    const env: Env = makeEnv({
      CLOUDFLARE_PROVISIONING_API_TOKEN: "stub-provisioning-token",
    });
    expect(env.CLOUDFLARE_PROVISIONING_API_TOKEN).toBe("stub-provisioning-token");
  });

  it("Env accepts CLOUDFLARE_CACHE_API_TOKEN optional secret", () => {
    const env: Env = makeEnv({
      CLOUDFLARE_CACHE_API_TOKEN: "stub-cache-token",
    });
    expect(env.CLOUDFLARE_CACHE_API_TOKEN).toBe("stub-cache-token");
  });

  it("Env accepts CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD optional fields", () => {
    const env: Env = makeEnv({
      CF_ACCESS_TEAM_DOMAIN: "kodigital2.cloudflareaccess.com",
      CF_ACCESS_AUD: "abc123",
    });
    expect(env.CF_ACCESS_TEAM_DOMAIN).toBe("kodigital2.cloudflareaccess.com");
    expect(env.CF_ACCESS_AUD).toBe("abc123");
  });

  it("Env accepts ALLOWED_CF_SERVICE_TOKEN_IDS optional field", () => {
    const env: Env = makeEnv({
      ALLOWED_CF_SERVICE_TOKEN_IDS: "tok1.access,tok2.access",
    });
    expect(env.ALLOWED_CF_SERVICE_TOKEN_IDS).toBe("tok1.access,tok2.access");
  });

  it("Env accepts DEV_BYPASS_AUTH optional field", () => {
    const env: Env = makeEnv({ DEV_BYPASS_AUTH: "true" });
    expect(env.DEV_BYPASS_AUTH).toBe("true");
  });
});

describe("Env helpers (T2)", () => {
  it("getAdminHost returns ADMIN_HOST", () => {
    expect(getAdminHost(makeEnv())).toBe("cms.kodigital.app");
    expect(getAdminHost(makeEnv({ ADMIN_HOST: "staging-cms.kodigital.app" }))).toBe(
      "staging-cms.kodigital.app",
    );
  });

  it("getAdminBaseUrl returns ADMIN_BASE_URL", () => {
    expect(getAdminBaseUrl(makeEnv())).toBe("https://cms.kodigital.app");
  });

  it("isDryRunProvisioning is true when SITE_PROVISIONING_DRY_RUN is 'true'", () => {
    expect(isDryRunProvisioning(makeEnv({ SITE_PROVISIONING_DRY_RUN: "true" }))).toBe(true);
    expect(isDryRunProvisioning(makeEnv({ SITE_PROVISIONING_DRY_RUN: "TRUE" }))).toBe(true);
    expect(isDryRunProvisioning(makeEnv({ SITE_PROVISIONING_DRY_RUN: "1" }))).toBe(true);
    expect(isDryRunProvisioning(makeEnv({ SITE_PROVISIONING_DRY_RUN: "yes" }))).toBe(true);
  });

  it("isDryRunProvisioning is false when SITE_PROVISIONING_DRY_RUN is 'false'/empty", () => {
    expect(isDryRunProvisioning(makeEnv({ SITE_PROVISIONING_DRY_RUN: "false" }))).toBe(false);
    expect(isDryRunProvisioning(makeEnv({ SITE_PROVISIONING_DRY_RUN: "" }))).toBe(false);
    expect(isDryRunProvisioning(makeEnv({ SITE_PROVISIONING_DRY_RUN: "no" }))).toBe(false);
  });

  it("isRouteMutationAllowed is true only when SITE_PROVISIONING_ALLOW_ROUTE_MUTATION is truthy", () => {
    expect(
      isRouteMutationAllowed(makeEnv({ SITE_PROVISIONING_ALLOW_ROUTE_MUTATION: "true" })),
    ).toBe(true);
    expect(
      isRouteMutationAllowed(makeEnv({ SITE_PROVISIONING_ALLOW_ROUTE_MUTATION: "false" })),
    ).toBe(false);
    expect(
      isRouteMutationAllowed(makeEnv({ SITE_PROVISIONING_ALLOW_ROUTE_MUTATION: "" })),
    ).toBe(false);
  });

  it("parseBoolean handles common string forms", () => {
    expect(parseBoolean("true")).toBe(true);
    expect(parseBoolean("True")).toBe(true);
    expect(parseBoolean("1")).toBe(true);
    expect(parseBoolean("yes")).toBe(true);
    expect(parseBoolean("false")).toBe(false);
    expect(parseBoolean("0")).toBe(false);
    expect(parseBoolean("")).toBe(false);
    expect(parseBoolean(undefined)).toBe(false);
    expect(parseBoolean(null)).toBe(false);
  });

  it("parseNumber parses or returns fallback", () => {
    expect(parseNumber("60")).toBe(60);
    expect(parseNumber("0")).toBe(0);
    expect(parseNumber("", 300)).toBe(300);
    expect(parseNumber(undefined, 300)).toBe(300);
    expect(parseNumber("not-a-number", 42)).toBe(42);
  });
});
