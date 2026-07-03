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
//   - /preview/:id      — previewRouter (HMAC token gate; links minted
//                         via POST /api/admin/articles/:id/preview-link).
//   - /media/*          — mediaRouter (R2 serve) and POST /admin/media.
//   - /admin*, /api/admin/*  — adminRouter (shell + JSON CRUD).
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
import newsletterRouter from "./newsletter";
import mediaRouter from "./media";
import previewRouter from "./preview";
import { analyticsRouter } from "./analytics/router";
import { listicleDailyReconciliation } from "./analytics/listicle-reconciliation";
import { syncListicleAnalytics } from "./listicles/mirror-sync";
import { processScheduledArticles } from "./workflow";
import {
  driveInProgressProvisioning,
  processProvisionMessage,
  type ProvisionMessage,
} from "./site-provisioning";

const app = new Hono<{ Bindings: Env; Variables: AccessAuthVariables }>();

// rescue-6 (agent-readiness M3 / observability): a structured per-request log so
// an operator can finally SEE bot / AI-agent traffic (Cloudflare bot signals),
// the response status, and the cache outcome. The worker previously emitted
// nothing on the request path, so invalid ad traffic + crawler load were
// invisible. Workers Logs ([observability] in wrangler.toml) auto-indexes these
// JSON fields for filtering. Guarded on the presence of the edge `cf` object so
// unit tests (app.request, no cf) stay silent and unchanged. It only OBSERVES
// (runs after next()); a logging error can never break the response.
app.use("*", async (c, next) => {
  await next();
  const cf = (c.req.raw as unknown as {
    cf?: {
      botManagement?: { score?: number; verifiedBot?: boolean };
      verifiedBotCategory?: string;
    };
  }).cf;
  if (cf === undefined) return;
  try {
    const bm = cf.botManagement;
    console.log(
      JSON.stringify({
        t: "req",
        method: c.req.method,
        host: new URL(c.req.url).hostname,
        path: c.req.path,
        status: c.res.status,
        ua: c.req.header("user-agent") ?? null,
        botScore: bm?.score ?? null,
        verifiedBot: bm?.verifiedBot ?? null,
        verifiedBotCategory: cf.verifiedBotCategory ?? null,
        cacheStatus: c.res.headers.get("cf-cache-status") ?? null,
      }),
    );
  } catch {
    // observability must never break a response
  }
});

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
app.get("/", async (c, next) => {
  const adminHost = String(getAdminHost(c.env) ?? "").toLowerCase();
  const requestHost = new URL(c.req.url).hostname.toLowerCase();
  if (requestHost === adminHost && adminHost !== "") {
    return c.redirect(c.env.ADMIN_BASE_PATH, 302);
  }
  // Non-admin (tenant) host: delegate to publicRouter's homepage renderer
  // (router.get("/") -> renderHomepageHtml) instead of returning 404, which
  // had made every tenant homepage dead. publicRouter is mounted at "/"
  // below; next() lets its "/" handler render the resolved site's home.
  return next();
});

// Phase 1.5 auth-status handler — registered BEFORE adminRouter so the
// mode-aware response wins. accessAuth runs first to populate the
// `access` context variable that authStatusHandler reads (identity vs
// service-token mode); the handler also tolerates no-access for the
// DEV_BYPASS_AUTH=true non-production case. adminRouter still owns this
// route internally for its own admin.request() tests.
app.get("/api/admin/auth/status", accessAuth, authStatusHandler);

// Phase 1 sub-routers — mount order: preview, media, admin,
// public (slug catch-all). adminRouter wires accessAuth internally on
// /admin*, /admin, and /api/admin/*.
app.route("/", previewRouter);
app.route("/", mediaRouter);
app.route("/", adminRouter);
// rescue-4 round-2 (issue 14): first-party newsletter capture (public).
app.route("/", newsletterRouter);

// Analytics ingest (POST /api/track) — public, unauthenticated, fire-and-forget
// beacon. Mounted BEFORE the ADMIN_HOST safety net so it works on EVERY host
// (incl. the admin host), AND before publicRouter so the /:slug catch-all does
// not swallow it.
app.route("/", analyticsRouter);

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

// rescue-4 round-5 (issue 1/4): a JSON error envelope for ANY unhandled
// exception. Hono's default onError returns text/plain "Internal Server
// Error", which the admin settings client (fetch().then(r => r.json())) could
// not parse -> it surfaced a misleading "Network error" instead of the real
// failure. A typed JSON 500 keeps the admin/API contract JSON-only.
app.onError((err, c) => {
  console.error("unhandled error:", c.req.method, c.req.path, err);
  return c.json({ error: "Internal Server Error" }, 500);
});

// T42 [BCL-080] — Scheduled cron. wrangler.toml [triggers] crons fires the
// Workers `scheduled` handler every minute. It does TWO things, each isolated
// so one cannot break the other:
//   1. processScheduledArticles — finds every article whose scheduled_at has
//      arrived and flips it to published via the canonical publish() path.
//   2. (rescue-4) driveInProgressProvisioning — advances any still-in-progress
//      site-creation job within a bounded budget, resuming from persisted
//      per-unit state. This is the COMPLETION GUARANTEE for the chunked,
//      O(1)-per-invocation provisioning runner: scheduleBackgroundProvisioning's
//      create-time waitUntil is best-effort fast-start (the runtime evicts a
//      long waitUntil at ~30s), so the cron is what carries a build with any
//      article count all the way to status='active'.
//
// Each task runs in its OWN try/catch: a provisioning error must NOT prevent
// the publish pass (or vice-versa). Both are registered on ctx.waitUntil (so
// the cron invocation stays alive until they finish) AND awaited (so the
// runtime — and unit tests — observe a settled promise).
//
// We ATTACH `scheduled` onto the Hono app (rather than wrapping it in a new
// ExportedHandler literal) so the default export keeps `app.fetch` for the
// runtime AND `app.request` for the Hono test helper that the existing suite
// relies on — adding the cron entry point next to them, breaking neither.
const scheduled = async (
  _controller: ScheduledController,
  env: Env,
  ctx: ExecutionContext,
): Promise<void> => {
  const work = (async () => {
    try {
      await processScheduledArticles(env);
    } catch {
      // Publish-pass failure is recorded per-article inside the engine; a
      // top-level throw here would abort the provisioning drive below.
    }
    try {
      await driveInProgressProvisioning(env, ctx);
    } catch {
      // A provisioning hiccup must never break the publish cron (or surface
      // as an unhandled rejection that fails the scheduled invocation).
    }
    try {
      // Listicles §18 CH→D1 analytics mirror sync — every minute, bounded
      // rolling window (today+yesterday UTC). Isolated + fail-open: absent CH
      // secrets is a logged no-op; a CH/D1 error is contained per table and
      // NEVER surfaces into the homepage publish/provisioning cron above.
      await syncListicleAnalytics(env);
    } catch {
      // mirror sync must never break the publish/provisioning cron.
    }
    try {
      // Listicles §31.6 daily reconciliation (self-gates to 00:05 UTC;
      // fail-open by design — see analytics/listicle-reconciliation.ts).
      await listicleDailyReconciliation(env);
    } catch {
      // reconciliation must never break the publish/provisioning cron.
    }
  })();
  ctx.waitUntil(work);
  await work;
};

// rescue-4 v3 — Queue consumer. Each provisioning unit is one message;
// Cloudflare runs this handler across a PARALLEL fleet of invocations (one gen
// per invocation, full speed — the parallelism a single Promise.all in one
// invocation could not achieve). "retry" re-delivers a transient gen failure;
// every other outcome acks. An unexpected throw also re-delivers so a unit is
// never silently dropped (the Queue's max_retries + DLQ bound it).
const queue = async (
  batch: MessageBatch<ProvisionMessage>,
  env: Env,
): Promise<void> => {
  for (const message of batch.messages) {
    try {
      const outcome = await processProvisionMessage(env, message.body);
      if (outcome === "retry") {
        message.retry();
      } else {
        message.ack();
      }
    } catch {
      message.retry();
    }
  }
};

const worker = Object.assign(app, { scheduled, queue });

export default worker;
