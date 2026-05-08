import { Hono } from "hono";
import type { Env } from "./env";
import { accessAuth } from "./auth/access-auth";

const app = new Hono<{ Bindings: Env }>();

// Route: GET /health — public liveness probe.
app.get("/health", (c) =>
  c.json({ ok: true, app: "kodigital-homepages-cms" }),
);

// /admin is gated by accessAuth (Cloudflare Access JWT presence check).
// Full JWT signature verification is deferred to a later phase and is
// intentionally not performed in this Phase 0 scaffold.
app.use("/admin/*", accessAuth);
app.get("/admin", accessAuth, (c) =>
  c.json({ ok: true, area: "admin" }),
);

app.notFound((c) =>
  c.json({ error: "Not Found", path: c.req.path }, 404),
);

export default app;
