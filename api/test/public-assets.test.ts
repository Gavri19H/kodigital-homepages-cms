import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import publicRouter from "../src/public/router";
import type { PublicSiteVariables } from "../src/public/middleware";
import type { Env } from "../src/env";

// rescue-4 — the public design assets MUST be served. The layout links
// <link rel="stylesheet" href="/assets/public.css"> + <script src="/assets/public.js">;
// without these routes both 404 and EVERY public page renders completely
// UNSTYLED (the live-forensic breakage). These routes are host-independent
// (registered before the site-context middleware) so they need no tenant DB.

function makeApp() {
  const app = new Hono<{ Bindings: Env; Variables: PublicSiteVariables }>();
  app.route("/", publicRouter);
  return app;
}
const ENV = {} as unknown as Env;

describe("public design assets are served (rescue-4 CSS-404 regression)", () => {
  it("GET /assets/public.css -> 200 text/css carrying the theiwise contract tokens", async () => {
    const res = await makeApp().request(
      "https://tenant.example.com/assets/public.css",
      {},
      ENV,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toContain("text/css");
    const css = await res.text();
    // contract tokens + section styling must be present in the served CSS.
    expect(css).toContain("--tw-brand: #1ba8c8");
    expect(css).toContain("Nunito");
    expect(css).toContain(".site-header");
    expect(css).toContain(".trending-section");
    expect(css.length).toBeGreaterThan(2000);
  });

  it("GET /assets/public.js -> 200 javascript", async () => {
    const res = await makeApp().request(
      "https://tenant.example.com/assets/public.js",
      {},
      ENV,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toContain("javascript");
  });
});
