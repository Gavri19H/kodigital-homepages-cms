// LeadGen admin JSON API — the contract 03 §8 route surface, mounted under
// /api/admin/leadgen from src/admin/router.ts so the existing Cloudflare
// Access gate (`accessAuth` on /api/admin/*) and the index.ts ADMIN_HOST
// 404 wall both apply unchanged (03 §8.1).
//
// Phase-4 Stage B1 ships the FULL 03 §8.2 Offers block (offers-handlers.ts +
// payload-builder-handlers.ts); sections/quotes/auctions keep the Phase-3
// list+read skeleton until their own phases. Shared handler plumbing
// (paging, dual-id resolution, JSON-column parsing) lives in
// offers-handlers.ts — single copy, imported here for the skeleton entities.
//
// Route registration order matters for static-vs-param sibling paths
// (03 §8.1): /offers/search is registered BEFORE /offers/:id.

import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { Env } from "../../env";
import {
  BRAND_LOGO_UPLOAD_LIMIT_BYTES,
  PERSONA_BODY_LIMIT_BYTES,
  generatePersonaImageHandler,
  uploadBrandLogoHandler,
} from "./assets-handlers";
import {
  createOfferHandler,
  createPayloadSchemaFromExampleHandler,
  createPayloadSchemaHandler,
  deleteOfferHandler,
  getOfferHandler,
  listActivitiesHandler,
  duplicateOfferHandler,
  listOffersHandler,
  listPayloadSchemasHandler,
  listVerticalsHandler,
  offerAnalyticsHandler,
  offerCapHandler,
  offerUsageHandler,
  patchOfferHandler,
  searchOffersHandler,
} from "./offers-handlers";
import {
  generateSampleAnswersHandler,
  putSampleAnswersDraftHandler,
  testOfferHandler,
} from "./payload-builder-handlers";
import { rebuildLeadgenAnalyticsRangeHandler } from "./analytics-admin-handlers";
import { listSiteLegalPagesHandler } from "./footer-legal-pages-handlers";
import {
  applyFrameTemplateToFunnelHandler,
  createFrameTemplateHandler,
  deleteFrameTemplateHandler,
  duplicateFrameTemplateHandler,
  getFrameTemplateHandler,
  getFunnelFrameHandler,
  getFunnelThemeHandler,
  getSiteBrandingHandler,
  listFrameTemplateRecordsHandler,
  listFrameTemplatesHandler,
  putFunnelFrameHandler,
  putFunnelThemeHandler,
  setDefaultFrameTemplateHandler,
  updateFrameTemplateHandler,
} from "./frame-handlers";
import {
  createMediaPlatformHandler,
  deleteMediaPlatformHandler,
  getMediaPlatformHandler,
  listMediaPlatformsHandler,
  patchMediaPlatformHandler,
} from "./media-platforms-handlers";
import {
  createComponentPresetHandler,
  createSectionHandler,
  deleteComponentPresetHandler,
  deleteSectionHandler,
  duplicateSectionHandler,
  getSectionHandler,
  listComponentPresetsHandler,
  listSectionsHandler,
  patchSectionHandler,
  previewSectionHandler,
  sectionAnalyticsHandler,
  sectionOffersHandler,
  sectionUsageHandler,
  validateSectionPayloadHandler,
} from "./sections-handlers";
import {
  createThemeHandler,
  deleteThemeHandler,
  getThemeHandler,
  listThemesHandler,
  updateThemeHandler,
} from "./themes-handlers";
import {
  createFunnelExperimentHandler,
  createFunnelVariantHandler,
  createQuoteExperimentHandler,
  createQuoteFunnelHandler,
  createQuoteHandler,
  createQuoteRoutingRuleHandler,
  createQuoteVariantHandler,
  createSharedPageHandler,
  createVariantRuleHandler,
  deleteActivationHandler,
  deleteFunnelHandler,
  deleteQuoteHandler,
  deleteQuoteRoutingRuleHandler,
  deleteSharedPageHandler,
  deleteVariantHandler,
  deleteVariantRuleHandler,
  duplicateFunnelHandler,
  duplicateQuoteHandler,
  duplicateQuoteRoutingRuleHandler,
  duplicateRuleHandler,
  experimentAssignmentPreviewHandler,
  forkVariantHandler,
  getFunnelHandler,
  getQuoteHandler,
  getSharedPageHandler,
  listFunnelVariantsHandler,
  listQuoteFunnelsHandler,
  listQuoteRoutingRulesHandler,
  listQuotesHandler,
  listQuoteVariantsHandler,
  listVariantRulesHandler,
  patchFunnelHandler,
  patchQuoteHandler,
  previewVariantHandler,
  putActivationHandler,
  putVariantHandler,
  quoteActivationHandler,
  quoteAnalyticsHandler,
  quoteStructureHandler,
  quoteUsageHandler,
  reorderQuoteFunnelsHandler,
  setQuoteDefaultFunnelHandler,
  startExperimentHandler,
  stopExperimentHandler,
  updateQuoteRoutingRuleHandler,
  updateSharedPageHandler,
  updateVariantRuleHandler,
} from "./quotes-handlers";
import {
  auctionAnalyticsHandler,
  auctionSimulateHandler,
  auctionUsageHandler,
  createAuctionHandler,
  createAuctionRuleHandler,
  deleteAuctionHandler,
  deleteAuctionRuleHandler,
  getAuctionBannerHandler,
  getAuctionHandler,
  getAuctionOffersHandler,
  listAuctionRulesHandler,
  listAuctionsHandler,
  patchAuctionHandler,
  patchAuctionRuleHandler,
  putAuctionBannerHandler,
  putAuctionOffersHandler,
} from "./auctions-handlers";

// ui.ts + the admin-shell tests consume the 03 §8.4 paging shape from here.
export type { Paging } from "./offers-handlers";

const routes = new Hono<{ Bindings: Env }>();

// 03 §8.1: the leadgen admin API surface is `private, no-store` (+ nosniff).
routes.use("*", async (c, next) => {
  await next();
  c.res.headers.set("Cache-Control", "private, no-store");
  c.res.headers.set("X-Content-Type-Options", "nosniff");
});

// --- Shared (03 §8.2): DISTINCT filter options -------------------------------
// STATIC paths, registered before every entity block (03 §8.1 static-before-
// param discipline — nothing may ever capture them as an :id).
routes.get("/verticals", listVerticalsHandler);
routes.get("/activities", listActivitiesHandler);
// v2.5 04 §4.8: the frame-template registry projection — a top-level STATIC
// path (own prefix, no /frame-templates/:id sibling), registered in the
// static block per the same discipline.
routes.get("/frame-templates", listFrameTemplatesHandler);

// --- Offers (03 §8.2 + 04 §10–§11 — Phase-4 Stage B1 full surface) -----------
routes.get("/offers", listOffersHandler);
routes.post("/offers", createOfferHandler);
routes.get("/offers/search", searchOffersHandler); // static BEFORE /offers/:id (03 §8.1)
routes.get("/offers/:id", getOfferHandler);
routes.patch("/offers/:id", patchOfferHandler);
routes.delete("/offers/:id", deleteOfferHandler);
routes.post("/offers/:id/duplicate", duplicateOfferHandler); // A2 (07 §7.3)
routes.get("/offers/:id/usage", offerUsageHandler);
routes.get("/offers/:id/analytics", offerAnalyticsHandler);
routes.get("/offers/:id/cap", offerCapHandler);
routes.get("/offers/:id/payload-schemas", listPayloadSchemasHandler);
routes.post("/offers/:id/payload-schemas", createPayloadSchemaHandler);
routes.post("/offers/:id/payload-schemas/from-example", createPayloadSchemaFromExampleHandler);
routes.post("/offers/:id/test", testOfferHandler);
// B4 (fix-contract v2.4 06 §6.12.1): ONE route path, two verbs — POST
// generates the sample-answer form (per-Offer KV draft merged over), PUT
// persists the operator's edited answers as that draft.
routes.post("/offers/:id/payload/sample-answers", generateSampleAnswersHandler);
routes.put("/offers/:id/payload/sample-answers", putSampleAnswersDraftHandler);

// --- Component presets (v2.5 06 §6.6 — KV `lg-component-presets`) ------------
// Own top-level prefix; static list/create BEFORE the /:name delete per the
// 03 §8.1 discipline. Storage is the CACHE KV binding — no migration.
routes.get("/component-presets", listComponentPresetsHandler);
routes.post("/component-presets", createComponentPresetHandler);
routes.delete("/component-presets/:name", deleteComponentPresetHandler);

// --- Themes (v3.1 §10 — KV `lg-funnel-themes`, mirrors component-presets) ----
// Own top-level prefix; static list/create BEFORE the /:id get/update/delete
// per the 03 §8.1 discipline. Storage is the CACHE KV binding — no migration.
// Round-4 P6b: DELETE added (the operator's explicit demand, beyond the
// original §10.1 list/get/create/update-only CRUD) — in-use guarded (409 +
// referencing-funnel listing) by themes-handlers.ts's deleteThemeHandler.
routes.get("/themes", listThemesHandler);
routes.post("/themes", createThemeHandler);
routes.get("/themes/:id", getThemeHandler);
routes.patch("/themes/:id", updateThemeHandler);
routes.delete("/themes/:id", deleteThemeHandler);

// --- Frame template records (Rework M5, §5-M5/§11D) — the DB-backed saved-
// template surface (leadgen_frame_templates): create/save-as/rename/duplicate/
// delete-with-in-use-guard/atomic-default-swap. Distinct from the STATIC
// `/frame-templates` route above (the CODE registry projection, no :id
// sibling) — own top-level prefix, no collision. Static list/create BEFORE the
// bare /:id GET/PATCH/DELETE, then the deeper /duplicate + /default suffixes
// (mirrors the Sections block's get/patch/delete-then-duplicate ordering).
routes.get("/frame-template-records", listFrameTemplateRecordsHandler);
routes.post("/frame-template-records", createFrameTemplateHandler);
routes.get("/frame-template-records/:id", getFrameTemplateHandler);
routes.patch("/frame-template-records/:id", updateFrameTemplateHandler);
routes.delete("/frame-template-records/:id", deleteFrameTemplateHandler);
routes.post("/frame-template-records/:id/duplicate", duplicateFrameTemplateHandler);
routes.put("/frame-template-records/:id/default", setDefaultFrameTemplateHandler);

// --- Sections (03 §8.2 + 05 §12–§14 — Phase-5 Stage B full surface) ----------
// Static paths BEFORE /sections/:id (03 §8.1 static-before-param discipline).
routes.get("/sections", listSectionsHandler);
routes.post("/sections", createSectionHandler);
routes.post("/sections/preview", previewSectionHandler); // static BEFORE /sections/:id
routes.get("/sections/:id", getSectionHandler);
routes.patch("/sections/:id", patchSectionHandler);
routes.delete("/sections/:id", deleteSectionHandler);
routes.post("/sections/:id/duplicate", duplicateSectionHandler); // Round-4 A-2 (row R4-02)
routes.get("/sections/:id/usage", sectionUsageHandler);
routes.get("/sections/:id/offers", sectionOffersHandler);
routes.get("/sections/:id/analytics", sectionAnalyticsHandler);
routes.post("/sections/:id/validate-payload", validateSectionPayloadHandler);

// --- Quotes / Funnels / Variants (03 §8.2 + 06 §15–§17 — Phase-7 Stage B) -----
// Static + deeper-param paths BEFORE the bare /quotes/:id (03 §8.1
// static-before-param discipline), then the sibling /experiments, /variants,
// /funnels top-level blocks.
routes.get("/quotes", listQuotesHandler);
routes.post("/quotes", createQuoteHandler);
routes.get("/quotes/:id/variants", listQuoteVariantsHandler);
routes.post("/quotes/:id/variants", createQuoteVariantHandler);
routes.post("/quotes/:id/experiments", createQuoteExperimentHandler);
routes.get("/quotes/:id/structure", quoteStructureHandler);
routes.get("/quotes/:id/analytics", quoteAnalyticsHandler);
routes.put("/quotes/:id/activation/:site_id", putActivationHandler);
routes.delete("/quotes/:id/activation/:site_id", deleteActivationHandler);
routes.get("/quotes/:id/activation", quoteActivationHandler);
routes.get("/quotes/:id/funnels", listQuoteFunnelsHandler);
routes.post("/quotes/:id/funnels", createQuoteFunnelHandler);
routes.post("/quotes/:id/duplicate", duplicateQuoteHandler); // Round-4 A-2 (row R4-02)
routes.get("/quotes/:id/usage", quoteUsageHandler); // Round-4 A-2 (row R4-38)
// Rework M2/M3/M4 (§4.3-1/§4.3-3..9/§4.3-7): the quote-owned shared first page,
// its quote-scoped routing rules, board reorder, and default-funnel pointer —
// all deeper paths, registered BEFORE the bare /quotes/:id below (03 §8.1).
routes.get("/quotes/:id/shared-page", getSharedPageHandler);
routes.post("/quotes/:id/shared-page", createSharedPageHandler);
routes.put("/quotes/:id/shared-page", updateSharedPageHandler);
routes.delete("/quotes/:id/shared-page", deleteSharedPageHandler);
routes.get("/quotes/:id/routing-rules", listQuoteRoutingRulesHandler);
routes.post("/quotes/:id/routing-rules", createQuoteRoutingRuleHandler);
routes.put("/quotes/:id/funnel-order", reorderQuoteFunnelsHandler);
routes.put("/quotes/:id/default-funnel", setQuoteDefaultFunnelHandler);
routes.get("/quotes/:id", getQuoteHandler);
routes.patch("/quotes/:id", patchQuoteHandler);
routes.delete("/quotes/:id", deleteQuoteHandler);

// Rework M3 — a routing rule's own address space (its own top-level prefix,
// param named `rule_id` — mirrors the /variants/:variant_id/rules/:rule_id
// precedent below of using a distinct param name for a rule's own id). Bare
// PATCH/DELETE before the deeper /duplicate suffix (mirrors /offers/:id vs
// /offers/:id/duplicate — Hono disambiguates by segment count either way).
routes.patch("/routing-rules/:rule_id", updateQuoteRoutingRuleHandler);
routes.delete("/routing-rules/:rule_id", deleteQuoteRoutingRuleHandler);
routes.post("/routing-rules/:rule_id/duplicate", duplicateQuoteRoutingRuleHandler);

// A/B lifecycle (§16.2): create + start/stop; start enforces the per-test
// Σ==10000 allocation gate. assignment-preview shows which variant a sample
// session buckets to (reuses the runtime assignVariant — zero drift).
routes.post("/experiments/:id/start", startExperimentHandler);
routes.post("/experiments/:id/stop", stopExperimentHandler);
routes.get("/experiments/:id/assignment-preview", experimentAssignmentPreviewHandler);

// Variants — static/deeper suffixes (/fork, /preview, /rules[/:rule_id[/duplicate]])
// BEFORE the bare /variants/:id PUT (03 §8.1 static-before-param discipline).
routes.post("/variants/:id/fork", forkVariantHandler);
routes.post("/variants/:id/preview", previewVariantHandler);
// D5 mini-round: variant-scoped rule CRUD (leadgen_funnel_rules, the four
// auction-domain types only) — the Auction-tab editor's real REST surface,
// added ALONGSIDE the variant-PUT `rules` replace-set (unchanged, still
// works). Bare PATCH/DELETE before the deeper /duplicate suffix (mirrors
// /offers/:id vs /offers/:id/duplicate — Hono disambiguates by segment count
// either way). The existing duplicate route (below) keeps its own `variant_id`
// param name (distinct from the outer `:id` on ITS route) — unaffected.
routes.get("/variants/:id/rules", listVariantRulesHandler);
routes.post("/variants/:id/rules", createVariantRuleHandler);
routes.patch("/variants/:id/rules/:rule_id", updateVariantRuleHandler);
routes.delete("/variants/:id/rules/:rule_id", deleteVariantRuleHandler);
// Round-4 P4b: mirrors the quote-scoped /routing-rules/:rule_id/duplicate
// precedent — param name is `variant_id` here (distinct from the outer `:id`
// convention above) so duplicateRuleHandler reads BOTH ids unambiguously via
// c.req.param.
routes.post("/variants/:variant_id/rules/:rule_id/duplicate", duplicateRuleHandler);
routes.put("/variants/:id", putVariantHandler);
// AC #11C ("delete-variant exists") — conductor extension round 2.
routes.delete("/variants/:id", deleteVariantHandler);

// Stable Funnels — /funnels/:id/{variants,experiments,frame,theme} BEFORE the
// bare /funnels/:id. frame/theme are the v2.5 Quote Builder save surface
// (04 §4.8 rows 1–4; handlers in frame-handlers.ts).
routes.get("/funnels/:id/variants", listFunnelVariantsHandler);
routes.post("/funnels/:id/variants", createFunnelVariantHandler);
routes.post("/funnels/:id/experiments", createFunnelExperimentHandler);
routes.get("/funnels/:id/frame", getFunnelFrameHandler);
routes.put("/funnels/:id/frame", putFunnelFrameHandler);
routes.get("/funnels/:id/theme", getFunnelThemeHandler);
routes.put("/funnels/:id/theme", putFunnelThemeHandler);
// Rework M5 (§8.2/§11D "Apply to funnel…") + funnel duplicate (§8.2 kebab).
routes.post("/funnels/:id/duplicate", duplicateFunnelHandler);
routes.post("/funnels/:id/apply-template", applyFrameTemplateToFunnelHandler);
routes.get("/funnels/:id", getFunnelHandler);
routes.patch("/funnels/:id", patchFunnelHandler);
routes.delete("/funnels/:id", deleteFunnelHandler);

// --- Site branding (v2.5 10 §10.5) — read-only; ALL CMS sites legal (C4) -----
// The only /sites/* route on this surface; deeper static suffix, no bare
// /sites/:id sibling to order against.
routes.get("/sites/:site_id/branding", getSiteBrandingHandler);
// R2 P3 S3b (§5.4 item 2 / §7 D2) — element J's Pages-fed legal-links
// picker data source (leadgen/branding.ts listPickableLegalPages). Read-only
// sibling of the branding route above; same static-path, no :id-sibling
// discipline.
routes.get("/sites/:site_id/legal-pages", listSiteLegalPagesHandler);

// --- Auctions (03 §8.2 + 07 §18–§21 — Phase-9 Stage B full surface) ----------
// The API entity path is PLURAL; the HTML tab path is singular /admin/leadgen/
// auction (contract 01 §5.2). Deeper /auctions/:id/<sub> paths + the rule
// /:rule_id paths register BEFORE the bare /auctions/:id (03 §8.1
// static/deeper-before-param discipline). /auctions/:id/simulate is the P10
// runtime seam (501 — the §19 dry-run engine ships in Phase 10).
routes.get("/auctions", listAuctionsHandler);
routes.post("/auctions", createAuctionHandler);
routes.get("/auctions/:id/offers", getAuctionOffersHandler);
routes.put("/auctions/:id/offers", putAuctionOffersHandler);
routes.get("/auctions/:id/rules", listAuctionRulesHandler);
routes.post("/auctions/:id/rules", createAuctionRuleHandler);
routes.patch("/auctions/:id/rules/:rule_id", patchAuctionRuleHandler);
routes.delete("/auctions/:id/rules/:rule_id", deleteAuctionRuleHandler);
routes.get("/auctions/:id/banner", getAuctionBannerHandler);
routes.put("/auctions/:id/banner", putAuctionBannerHandler);
routes.get("/auctions/:id/analytics", auctionAnalyticsHandler);
routes.get("/auctions/:id/usage", auctionUsageHandler); // Round-4 A-2 (row R4-38)
routes.post("/auctions/:id/simulate", auctionSimulateHandler);
routes.get("/auctions/:id", getAuctionHandler);
routes.patch("/auctions/:id", patchAuctionHandler);
routes.delete("/auctions/:id", deleteAuctionHandler);

// --- Analytics (03 §8 + 08 §24 — Phase-12 CH→D1 mirror manual backfill) ------
// The every-minute cron (index.ts scheduled → syncLeadgenAnalytics) syncs a
// bounded rolling window; this endpoint runs an explicit [from,to] window.
routes.post("/analytics/rebuild-range", rebuildLeadgenAnalyticsRangeHandler);

// --- Media platforms (03 §8.2 + 08 §26 outbound S2S config — Phase-13 Stage B) -
// Static /media-platforms (list/create) BEFORE /media-platforms/:id (get/patch/
// delete) per the 03 §8.1 static-before-param discipline. A NEW platform is a
// config row (postback_url_template + auth_secret_ref NAME + value_multiplier),
// NO code change (§26); the token VALUE never enters the table or a response.
routes.get("/media-platforms", listMediaPlatformsHandler);
routes.post("/media-platforms", createMediaPlatformHandler);
routes.get("/media-platforms/:id", getMediaPlatformHandler);
routes.patch("/media-platforms/:id", patchMediaPlatformHandler);
routes.delete("/media-platforms/:id", deleteMediaPlatformHandler);

// --- Assets (Round-4 P5c) — 10F sanitized brand-logo upload + 10G AI persona -
// Own top-level /assets prefix (no /:id sibling to order against). The upload
// route runs the SVG sanitizer before storage; the persona route enforces a
// per-site monthly quota BEFORE any OpenAI spend. Per-route bodyLimit mirrors
// the ai-api.ts precedent (413 on an oversize body).
routes.post(
  "/assets/brand-logo",
  bodyLimit({ maxSize: BRAND_LOGO_UPLOAD_LIMIT_BYTES }),
  uploadBrandLogoHandler,
);
routes.post(
  "/assets/persona-image",
  bodyLimit({ maxSize: PERSONA_BODY_LIMIT_BYTES }),
  generatePersonaImageHandler,
);

const leadgenApi = new Hono<{ Bindings: Env }>();
leadgenApi.route("/api/admin/leadgen", routes);

export default leadgenApi;
