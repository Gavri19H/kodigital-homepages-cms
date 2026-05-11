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

describe("GET /health", () => {
  it("returns 200 with ok:true and app:kodigital-homepages-cms", async () => {
    const res = await app.request("/health", {}, { ...baseEnv });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; app: string };
    expect(body.ok).toBe(true);
    expect(body.app).toBe("kodigital-homepages-cms");
  });

  it("returns 404 with non-empty body for unknown multi-segment route", async () => {
    // Multi-segment paths bypass the publicRouter `/:slug` catch-all and fall
    // through to the app-level notFound handler. Single-segment unknowns are
    // exercised by reserved-path.test.ts where a DB binding is provided.
    const res = await app.request("/this/route/does/not/exist", {}, { ...baseEnv });
    expect(res.status).toBe(404);
    const body = await res.text();
    expect(body.length).toBeGreaterThan(0);
  });
});
