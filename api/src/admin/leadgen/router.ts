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
import type { Env } from "../../env";
import type { PublicIdKind } from "../../leadgen/ids";
import {
  buildPaging,
  createOfferHandler,
  createPayloadSchemaFromExampleHandler,
  createPayloadSchemaHandler,
  deleteOfferHandler,
  getOfferHandler,
  idSelector,
  listActivitiesHandler,
  listOffersHandler,
  listPayloadSchemasHandler,
  listVerticalsHandler,
  offerAnalyticsHandler,
  offerCapHandler,
  offerUsageHandler,
  parseJsonColumn,
  parsePaging,
  patchOfferHandler,
  searchOffersHandler,
  type AdminContext,
} from "./offers-handlers";
import { testOfferHandler } from "./payload-builder-handlers";
import type {
  LeadgenSectionRow,
  LeadgenSectionApi,
  LeadgenQuoteRow,
  LeadgenQuoteApi,
  LeadgenAuctionRow,
  LeadgenAuctionApi,
} from "./db-types";

// ui.ts + the admin-shell tests consume the 03 §8.4 paging shape from here.
export type { Paging } from "./offers-handlers";

// --- Row→API mapping (03 §8.5: INTEGER bools → boolean, JSON → parsed) ------

function sectionRowToApi(row: LeadgenSectionRow): LeadgenSectionApi {
  return {
    ...row,
    image_json: parseJsonColumn(row.image_json),
    content_json: parseJsonColumn(row.content_json),
    design_overrides_json: parseJsonColumn(row.design_overrides_json),
    address_validation_enabled: row.address_validation_enabled !== 0,
  };
}

function quoteRowToApi(row: LeadgenQuoteRow): LeadgenQuoteApi {
  return {
    ...row,
    verticals_json: parseJsonColumn(row.verticals_json),
  };
}

function auctionRowToApi(row: LeadgenAuctionRow): LeadgenAuctionApi {
  return {
    ...row,
    mixed_payout_warn: row.mixed_payout_warn !== 0,
    surface_static_bid_offers: row.surface_static_bid_offers !== 0,
    remove_clicked_offers: row.remove_clicked_offers !== 0,
    banner_config_json: parseJsonColumn(row.banner_config_json),
  };
}

// --- Phase-3 skeleton handlers (sections / quotes / auctions) ----------------
//
// `table` is a fixed literal from the union below (the readEntityMetrics
// pattern) — user input only ever travels through .bind().

type LeadgenEntityTable = "leadgen_sections" | "leadgen_quotes" | "leadgen_auctions";

// GET list — `{ items, paging }` (03 §8.4; filters/search ship with each
// entity's own phase, ?page/?page_size are live now).
function listHandler<Row, Api>(
  table: LeadgenEntityTable,
  toApi: (row: Row) => Api,
): (c: AdminContext) => Promise<Response> {
  return async (c) => {
    const { page, pageSize, offset } = parsePaging(c);
    const rows = await c.env.DB.prepare(
      `SELECT * FROM ${table} ORDER BY updated_at DESC, id DESC LIMIT ? OFFSET ?`,
    )
      .bind(pageSize, offset)
      .all<Row>();
    const totalRow = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{
      n: number;
    }>();
    const total = Number(totalRow?.n ?? 0);
    return c.json({
      items: (rows.results ?? []).map(toApi),
      paging: buildPaging(page, pageSize, total),
    });
  };
}

// GET /:id — the mapped API object at the top level (`{ ...entity }`,
// 03 §8.4); unknown / malformed / foreign-kind ids → 404 `{ error }`.
function getHandler<Row, Api>(
  kind: PublicIdKind,
  table: LeadgenEntityTable,
  toApi: (row: Row) => Api,
): (c: AdminContext) => Promise<Response> {
  return async (c) => {
    const selector = idSelector(kind, c.req.param("id") ?? "");
    if (selector === null) return c.json({ error: "Not Found" }, 404);
    const sql =
      selector.column === "id"
        ? `SELECT * FROM ${table} WHERE id = ? LIMIT 1`
        : `SELECT * FROM ${table} WHERE public_id = ? LIMIT 1`;
    const row = await c.env.DB.prepare(sql).bind(selector.value).first<Row>();
    if (!row) return c.json({ error: "Not Found" }, 404);
    return c.json({ ...toApi(row) });
  };
}

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

// --- Offers (03 §8.2 + 04 §10–§11 — Phase-4 Stage B1 full surface) -----------
routes.get("/offers", listOffersHandler);
routes.post("/offers", createOfferHandler);
routes.get("/offers/search", searchOffersHandler); // static BEFORE /offers/:id (03 §8.1)
routes.get("/offers/:id", getOfferHandler);
routes.patch("/offers/:id", patchOfferHandler);
routes.delete("/offers/:id", deleteOfferHandler);
routes.get("/offers/:id/usage", offerUsageHandler);
routes.get("/offers/:id/analytics", offerAnalyticsHandler);
routes.get("/offers/:id/cap", offerCapHandler);
routes.get("/offers/:id/payload-schemas", listPayloadSchemasHandler);
routes.post("/offers/:id/payload-schemas", createPayloadSchemaHandler);
routes.post("/offers/:id/payload-schemas/from-example", createPayloadSchemaFromExampleHandler);
routes.post("/offers/:id/test", testOfferHandler);

// --- Sections (03 §8.2) ------------------------------------------------------
routes.get("/sections", listHandler<LeadgenSectionRow, LeadgenSectionApi>("leadgen_sections", sectionRowToApi));
routes.get("/sections/:id", getHandler<LeadgenSectionRow, LeadgenSectionApi>("section", "leadgen_sections", sectionRowToApi));

// --- Quotes (03 §8.2) --------------------------------------------------------
routes.get("/quotes", listHandler<LeadgenQuoteRow, LeadgenQuoteApi>("leadgen_quotes", quoteRowToApi));
routes.get("/quotes/:id", getHandler<LeadgenQuoteRow, LeadgenQuoteApi>("quote", "leadgen_quotes", quoteRowToApi));

// --- Auctions (03 §8.2 — API entity path is plural; the HTML tab path is
// singular /admin/leadgen/auction per contract 01 §5.2) -----------------------
routes.get("/auctions", listHandler<LeadgenAuctionRow, LeadgenAuctionApi>("leadgen_auctions", auctionRowToApi));
routes.get("/auctions/:id", getHandler<LeadgenAuctionRow, LeadgenAuctionApi>("auction", "leadgen_auctions", auctionRowToApi));

const leadgenApi = new Hono<{ Bindings: Env }>();
leadgenApi.route("/api/admin/leadgen", routes);

export default leadgenApi;
