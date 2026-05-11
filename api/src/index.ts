// Worker entry point — Phase 1.5 (hostname gate + JWT auth) wraps the
// full Phase 1 router stack.
//
// Phase 1.5 D3 hostname contract (T3):
//   - All /admin* and /api/admin* paths MUST arrive on ADMIN_HOST
//     (cms.kodigital.app). On any other host the gate returns 404 so the
//     admin surface never leaks to public content domains.
//   - On ADMIN_HOST, GET / returns 302 to ADMIN_BASE_PATH (/admin).
//   - GET /health is served on ANY hostname (public liveness probe so
//     external uptime monitors keep working independent of admin host).
//
// Phase 1.5 auth contract (T4): accessAuth verifies CF Access JWT via
// JWKS-in-KV (identity OR service-token mode) with DEV_BYPASS_AUTH
// double-gate (only honored when APP_ENV != "production"). The
// dedicated `app.get("/api/admin/auth/status", authStatusHandler)`
// registration below MUST run before `adminRouter` is mounted so the
// Phase 1.5 mode-aware response shape wins over Phase 1's older
// dev_bypass-flag shape on app-level requests. Phase 1's
// admin.test.ts continues to test adminRouter directly via
// `admin.request(...)` so it still exercises the legacy handler shape.
//
// Phase 1 router mount order matters because publicRouter declares /:slug
// as a compatibility catch-all. Anything that needs a dedicated handler
// MUST be registered before publicRouter, otherwise /:slug would shadow
// it. Specifically:
//   - /health           — main app's literal route (public liveness).
//   - /preview/:id      — previewRouter wins over publicRouter's 501.
//   - /media/*          — mediaRouter (R2 serve) and POST /admin/media.
//   - /admin*, /api/admin/*  — adminRouter (shell + JSON CRUD).
//   - /api/privacy/*    — privacyRouter (public, unauthenticated).
//   - /article, /page, /category, /feed.xml, /atom.xml, /sitemap.xml,
//     /robots.txt, /ads.txt, /:slug catch-all — publicRouter (last).
//
// The reserved-path guard inside publicRouter's /:slug handler refuses to
// serve impostor `pages` rows whose slug collides with a reserved head
// (admin / api / static / assets / media / preview / health) — the
// dedicated handlers above already win on route order, but the in-router
// guard hardens against a future re-registration order regression.

import { Hono } from "hono";
import { getAdminHost, type Env } from "./env";
import {
  accessAuth,
  authStatusHandler,
  type AccessAuthVariables,
} from "./auth/access-auth";
import { adminRouter } from "./admin";
import publicRouter from "./public/router";
import privacyRouter from "./privacy";
import mediaRouter from "./media";
import previewRouter from "./preview";

const app = new Hono<{ Bindings: Env; Variables: AccessAuthVariables }>();

// Phase 1.5 D3 hostname gate: any /admin* or /api/admin* path MUST arrive
// on ADMIN_HOST (cms.kodigital.app). On any other hostname those paths
// get a flat 404 so the admin surface never leaks to public content
// domains.
//
// Phase 3 T28 hardening: when the off-ADMIN_HOST /admin request 404s we
// set Cache-Control: no-store and X-Robots-Tag: noindex, nofollow so
// intermediaries don't cache the 404 and search engines don't index a
// stray admin URL leaked to the public domain. The response body
// deliberately omits the request path so a crafted URL like
// `/admin/<ADMIN_HOST>` cannot echo the admin hostname back through
// content sniffers.
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
    c.header("Cache-Control", "no-store");
    c.header("X-Robots-Tag", "noindex, nofollow");
    return c.json({ error: "Not Found" }, 404);
  }
  return next();
});

// Route: GET /health — public liveness probe (registered FIRST so it
// wins over publicRouter's `/health` which adds a `scope: "public"`
// discriminator).
app.get("/health", (c) =>
  c.json({ ok: true, app: "kodigital-homepages-cms" }),
);

// On ADMIN_HOST, root redirects to ADMIN_BASE_PATH ('/admin'). On any
// other host, root falls through to publicRouter / catch-all 404.
app.get("/", (c) => {
  const adminHost = String(getAdminHost(c.env) ?? "").toLowerCase();
  const requestHost = new URL(c.req.url).hostname.toLowerCase();
  if (requestHost === adminHost && adminHost !== "") {
    return c.redirect(c.env.ADMIN_BASE_PATH, 302);
  }
  return c.json({ error: "Not Found", path: c.req.path }, 404);
});

// Phase 1.5 auth-status handler — registered BEFORE adminRouter so the
// mode-aware response wins. accessAuth runs first to populate the
// `access` context variable that authStatusHandler reads (identity vs
// service-token mode); the handler also tolerates no-access for the
// DEV_BYPASS_AUTH=true non-production case. adminRouter still owns this
// route internally for its own admin.request() tests.
app.get("/api/admin/auth/status", accessAuth, authStatusHandler);

// Phase 1 sub-routers — mount order: preview, media, admin, privacy,
// public (slug catch-all). adminRouter wires accessAuth internally on
// /admin*, /admin, and /api/admin/*.
app.route("/", previewRouter);
app.route("/", mediaRouter);
app.route("/", adminRouter);
app.route("/", privacyRouter);

// ADMIN_HOST safety net (Phase 1.5 T3): on ADMIN_HOST, any unmatched
// path that reaches this point falls straight through to the
// app-level notFound below (404). Public-content routing
// (publicRouter's /article, /:slug, sitemap, robots, feeds) only
// applies on non-admin hosts where the CMS serves rendered content.
app.use("*", async (c, next) => {
  const adminHost = String(getAdminHost(c.env) ?? "").toLowerCase();
  const requestHost = new URL(c.req.url).hostname.toLowerCase();
  if (requestHost === adminHost && adminHost !== "") {
    return c.json({ error: "Not Found", path: c.req.path }, 404);
  }
  return next();
});

app.route("/", publicRouter);

app.notFound((c) =>
  c.json({ error: "Not Found", path: c.req.path }, 404),
);

export default app;
