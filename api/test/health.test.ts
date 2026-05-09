import { describe, it, expect } from "vitest";
import app from "../src/index";

describe("GET /health", () => {
  it("returns 200 with ok:true and app:kodigital-homepages-cms", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; app: string };
    expect(body.ok).toBe(true);
    expect(body.app).toBe("kodigital-homepages-cms");
  });

  it("returns 404 with non-empty body for unknown multi-segment route", async () => {
    // Multi-segment paths bypass the publicRouter `/:slug` catch-all and fall
    // through to the app-level notFound handler. Single-segment unknowns are
    // exercised by reserved-path.test.ts where a DB binding is provided.
    const res = await app.request("/this/route/does/not/exist");
    expect(res.status).toBe(404);
    const body = await res.text();
    expect(body.length).toBeGreaterThan(0);
  });
});
