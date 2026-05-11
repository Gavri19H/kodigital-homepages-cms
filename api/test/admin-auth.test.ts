import { describe, it, expect } from "vitest";
import app from "../src/index";
import type { Env } from "../src/env";

const baseEnv: Env = {
  DB: {} as D1Database,
  CACHE: {} as KVNamespace,
  MEDIA: {} as R2Bucket,
  APP_ENV: "test",
  ADMIN_HOST: "localhost",
  ADMIN_BASE_URL: "http://localhost:8787",
  ADMIN_BASE_PATH: "/admin",
  CACHE_API_ENABLED: "false",
  HTML_CACHE_TTL_SECONDS: "60",
  OPENAI_TEXT_MODEL: "",
  OPENAI_IMAGE_MODEL: "",
  SITE_PROVISIONING_DRY_RUN: "true",
  SITE_PROVISIONING_ALLOW_ROUTE_MUTATION: "false",
};

describe("accessAuth on /admin", () => {
  it("returns 401 when DEV_BYPASS_AUTH is not true and no auth header/cookie is present", async () => {
    const res = await app.request("/admin", {}, { ...baseEnv });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/Unauthorized/i);
  });

  it("calls next() (returns 200) when DEV_BYPASS_AUTH=true", async () => {
    const res = await app.request("/admin", {}, {
      ...baseEnv,
      DEV_BYPASS_AUTH: "true",
    });
    expect(res.status).toBe(200);
  });

  it("returns 401 when cf-access-jwt-assertion header carries an invalid JWT (presence is no longer sufficient)", async () => {
    const res = await app.request(
      "/admin",
      { headers: { "cf-access-jwt-assertion": "fake-jwt-token" } },
      { ...baseEnv },
    );
    expect(res.status).toBe(401);
  });

  it("returns 401 when CF_Authorization cookie carries an invalid JWT", async () => {
    const res = await app.request(
      "/admin",
      { headers: { cookie: "CF_Authorization=fake-cookie-value" } },
      { ...baseEnv },
    );
    expect(res.status).toBe(401);
  });

  it("DEV_BYPASS_AUTH double-gate: APP_ENV=production AND DEV_BYPASS_AUTH=true with no JWT still returns 401", async () => {
    const res = await app.request("/admin", {}, {
      ...baseEnv,
      APP_ENV: "production",
      DEV_BYPASS_AUTH: "true",
    });
    expect(res.status).toBe(401);
  });
});
