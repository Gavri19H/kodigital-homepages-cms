import { Hono } from "hono";
import { getAdminHost, type Env } from "./env";
import { accessAuth } from "./auth/access-auth";

const app = new Hono<{ Bindings: Env }>();

// Phase 1.5 D3 hostname gate: any /admin* or /api/admin* path MUST arrive
// on ADMIN_HOST (cms.kodigital.app). On any other hostname those paths get
// a flat 404 so the admin surface never leaks to public content domains.
app.use("*", async (c, next) => {
  const adminHost = String(getAdminHost(c.env) ?? "").toLowerCase();
  const requestHost = new URL(c.req.url).hostname.toLowerCase();
  const path = c.req.path;
  const isAdminPath =
    path === "/admin" ||
    path.startsWith("/admin/") ||
    path === "/api/admin" ||
    path.startsWith("/api/admin/");
  if (isAdminPath && requestHost !== adminHost) {
    return c.json({ error: "Not Found", path }, 404);
  }
  return next();
});

// Public liveness probe — served on any hostname so external uptime
// monitors keep working independent of the admin host.
app.get("/health", (c) =>
  c.json({ ok: true, app: "kodigital-homepages-cms" }),
);

// On ADMIN_HOST, root redirects to ADMIN_BASE_PATH ('/admin'). On any
// other host, root falls through to the catch-all 404 below.
app.get("/", (c) => {
  const adminHost = String(getAdminHost(c.env) ?? "").toLowerCase();
  const requestHost = new URL(c.req.url).hostname.toLowerCase();
  if (requestHost === adminHost && adminHost !== "") {
    return c.redirect(c.env.ADMIN_BASE_PATH, 302);
  }
  return c.json({ error: "Not Found", path: c.req.path }, 404);
});

// Admin handlers — reachable only via ADMIN_HOST (enforced by the gate
// above). Cloudflare Access JWT verification lives in accessAuth.
app.use("/admin/*", accessAuth);
app.get("/admin", accessAuth, (c) => c.json({ ok: true, area: "admin" }));
app.use("/api/admin/*", accessAuth);

app.notFound((c) =>
  c.json({ error: "Not Found", path: c.req.path }, 404),
);

export default app;
