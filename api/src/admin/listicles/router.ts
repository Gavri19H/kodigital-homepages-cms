// Listicles admin JSON API — the §7.1 route surface, mounted under
// /api/admin/listicles from src/admin/router.ts so the existing Cloudflare
// Access gate (`accessAuth` on /api/admin/*) and the index.ts ADMIN_HOST
// 404 wall both apply unchanged (§24).
//
// Route registration order matters for the two static-vs-param sibling paths:
// /offers/search is registered before /offers/:id.

import { Hono } from "hono";
import type { Env } from "../../env";
import {
  listOffersHandler,
  createOfferHandler,
  searchOffersHandler,
  getOfferHandler,
  patchOfferHandler,
  deleteOfferHandler,
  offerUsageHandler,
  offerAnalyticsHandler,
} from "./offers-handlers";
import {
  listSectionsHandler,
  createSectionHandler,
  getSectionHandler,
  patchSectionHandler,
  deleteSectionHandler,
  previewSectionHandler,
  sectionUsageHandler,
  sectionOffersHandler,
  sectionAnalyticsHandler,
} from "./sections-handlers";
import {
  listArticlesHandler,
  createArticleHandler,
  patchArticleHandler,
  createExperimentHandler,
  startExperimentHandler,
  stopExperimentHandler,
  deleteArticleHandler,
  articleStructureHandler,
  articleAnalyticsHandler,
  articleDrilldownHandler,
  publishArticleHandler,
} from "./articles-handlers";
import {
  newRevisionVersionHandler,
  putVersionHandler,
  validatePageHandler,
} from "./versions-handlers";
import { forkVersionHandler } from "./version-fork";
import { versionPreviewHandler } from "./version-preview";
import {
  rebuildAnalyticsRangeHandler,
  articleLinkInstancesHandler,
} from "./analytics-admin-handlers";

const routes = new Hono<{ Bindings: Env }>();

// §24: the listicles admin API surface is `private, no-store` (+ nosniff).
routes.use("*", async (c, next) => {
  await next();
  c.res.headers.set("Cache-Control", "private, no-store");
  c.res.headers.set("X-Content-Type-Options", "nosniff");
});

// --- Offers (§7.1) ---------------------------------------------------------
routes.get("/offers", listOffersHandler);
routes.post("/offers", createOfferHandler);
routes.get("/offers/search", searchOffersHandler);
routes.get("/offers/:id", getOfferHandler);
routes.patch("/offers/:id", patchOfferHandler);
routes.delete("/offers/:id", deleteOfferHandler);
routes.get("/offers/:id/usage", offerUsageHandler);
routes.get("/offers/:id/analytics", offerAnalyticsHandler);

// --- Sections (§7.1 "same verbs" + usage/offers/analytics extras) ----------
// /sections/preview registers before /sections/:id (static-vs-param order).
routes.get("/sections", listSectionsHandler);
routes.post("/sections", createSectionHandler);
routes.post("/sections/preview", previewSectionHandler);
routes.get("/sections/:id", getSectionHandler);
routes.patch("/sections/:id", patchSectionHandler);
routes.delete("/sections/:id", deleteSectionHandler);
routes.get("/sections/:id/usage", sectionUsageHandler);
routes.get("/sections/:id/offers", sectionOffersHandler);
routes.get("/sections/:id/analytics", sectionAnalyticsHandler);

// --- Articles (§7.1) --------------------------------------------------------
routes.get("/articles", listArticlesHandler);
routes.post("/articles", createArticleHandler);
routes.patch("/articles/:id", patchArticleHandler);
routes.post("/articles/:id/experiments", createExperimentHandler);
routes.delete("/articles/:id", deleteArticleHandler);
routes.get("/articles/:id/structure", articleStructureHandler);
routes.get("/articles/:id/analytics", articleAnalyticsHandler);
routes.get("/articles/:id/drilldown", articleDrilldownHandler);
routes.get("/articles/:id/link-instances", articleLinkInstancesHandler);
routes.post("/articles/:id/publish", publishArticleHandler);

// --- Analytics (§18 manual backfill — Phase 8) ------------------------------
routes.post("/analytics/rebuild-range", rebuildAnalyticsRangeHandler);

// --- Experiments (§5.3 lifecycle — Phase 5) ---------------------------------
routes.post("/experiments/:id/start", startExperimentHandler);
routes.post("/experiments/:id/stop", stopExperimentHandler);

// --- Versions / Pages (§7.1 + Phase-5 §15.6/§30.6/§30.7 additions) ----------
routes.put("/versions/:id", putVersionHandler);
routes.post("/versions/:id/fork", forkVersionHandler);
routes.post("/versions/:id/new-revision", newRevisionVersionHandler);
routes.post("/versions/:id/preview", versionPreviewHandler);
routes.post("/pages/:id/validate", validatePageHandler);

const listicleApi = new Hono<{ Bindings: Env }>();
listicleApi.route("/api/admin/listicles", routes);

export default listicleApi;
