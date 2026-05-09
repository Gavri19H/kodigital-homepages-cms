// Worker entry point — wires every Phase-1 sub-router into a single Hono app.
//
// Mount order matters because the public router declares /:slug as a
// compatibility catch-all. Anything that needs a dedicated handler MUST be
// registered before publicRouter, otherwise /:slug would shadow it. Specifically:
//   - /health           — main app's literal route (public liveness probe).
//   - /preview/:id      — previewRouter wins over publicRouter's 501 placeholder.
//   - /media/*          — mediaRouter (R2 serve) and POST /admin/media (upload).
//   - /admin*, /api/admin/*  — adminRouter (shell + JSON CRUD), gated by accessAuth.
//   - /api/privacy/*    — privacyRouter (public, unauthenticated).
//   - /article, /page, /category, /feed.xml, /atom.xml, /sitemap.xml,
//     /robots.txt, /ads.txt, /:slug catch-all — publicRouter (mounted last).
//
// The reserved-path guard inside publicRouter's /:slug handler refuses to
// serve impostor `pages` rows whose slug collides with a reserved head
// (admin / api / static / assets / media / preview / health) — the dedicated
// handlers above already win on route order, but the in-router guard hardens
// against a future re-registration order regression.

import { Hono } from "hono";
import type { Env } from "./env";
import { adminRouter } from "./admin";
import publicRouter from "./public/router";
import privacyRouter from "./privacy";
import mediaRouter from "./media";
import previewRouter from "./preview";

const app = new Hono<{ Bindings: Env }>();

// Route: GET /health — public liveness probe (registered FIRST so it wins
// over publicRouter's `/health` which adds a `scope: "public"` discriminator).
app.get("/health", (c) =>
  c.json({ ok: true, app: "kodigital-homepages-cms" }),
);

app.route("/", previewRouter);
app.route("/", mediaRouter);
app.route("/", adminRouter);
app.route("/", privacyRouter);
app.route("/", publicRouter);

app.notFound((c) =>
  c.json({ error: "Not Found", path: c.req.path }, 404),
);

export default app;
