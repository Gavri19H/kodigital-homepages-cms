import { describe, it, expect } from "vitest";
import app from "../src/index";
import type { Env } from "../src/env";

const baseEnv: Env = {
  DB: {} as D1Database,
  CACHE: {} as KVNamespace,
  MEDIA: {} as R2Bucket,
  APP_ENV: "test",
  ADMIN_BASE_URL: "http://localhost:8787",
  CACHE_API_ENABLED: "false",
  OPENAI_TEXT_MODEL: "",
  OPENAI_IMAGE_MODEL: "",
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

  it("calls next() (returns 200) when cf-access-jwt-assertion header is present", async () => {
    const res = await app.request(
      "/admin",
      { headers: { "cf-access-jwt-assertion": "fake-jwt-token" } },
      { ...baseEnv },
    );
    expect(res.status).toBe(200);
  });

  it("calls next() (returns 200) when CF_Authorization cookie is present", async () => {
    const res = await app.request(
      "/admin",
      { headers: { cookie: "CF_Authorization=fake-cookie-value" } },
      { ...baseEnv },
    );
    expect(res.status).toBe(200);
  });
});
