// LeadGen admin JSON API — the contract 03 §8 route surface (Phase-3
// skeleton: list + read for the four tab entities; the rest of §8.2 ships
// with each entity's own phase), mounted under /api/admin/leadgen from
// src/admin/router.ts so the existing Cloudflare Access gate (`accessAuth`
// on /api/admin/*) and the index.ts ADMIN_HOST 404 wall both apply
// unchanged (03 §8.1).
//
// Route registration order matters once static-vs-param sibling paths ship
// (/offers/search before /offers/:id — 03 §8.1); this phase keeps the same
// discipline by registering every entity's static list path before its
// param :id path.

import { Hono } from "hono";
import type { Context } from "hono";
import type { Env } from "../../env";
import { isPublicId, type PublicIdKind } from "../../leadgen/ids";
import type {
  LeadgenOfferRow,
  LeadgenOfferApi,
  LeadgenSectionRow,
  LeadgenSectionApi,
  LeadgenQuoteRow,
  LeadgenQuoteApi,
  LeadgenAuctionRow,
  LeadgenAuctionApi,
} from "./db-types";

type AdminContext = Context<{ Bindings: Env }>;

// 03 §8.4: paging shape identical to Listicles.
export interface Paging {
  page: number;
  page_size: number;
  total: number;
  has_next: boolean;
  has_prev: boolean;
}

// Mirrors the listicles pager: page >= 1, page_size 1-100 (default 25).
function parsePaging(c: AdminContext): { page: number; pageSize: number; offset: number } {
  const pageRaw = parseInt(c.req.query("page") ?? "1", 10);
  const sizeRaw = parseInt(c.req.query("page_size") ?? "25", 10);
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
  const pageSize = Number.isFinite(sizeRaw) && sizeRaw > 0 && sizeRaw <= 100 ? sizeRaw : 25;
  return { page, pageSize, offset: (page - 1) * pageSize };
}

function buildPaging(page: number, pageSize: number, total: number): Paging {
  return {
    page,
    page_size: pageSize,
    total,
    has_next: (page - 1) * pageSize + pageSize < total,
    has_prev: page > 1,
  };
}

// :id route params accept EITHER the internal numeric id (repo convention)
// or the stable public id (03 §8.1 — resolved through the ids.ts checker,
// so a malformed value or another kind's public id is a plain 404).
function idSelector(
  kind: PublicIdKind,
  idParam: string,
): { column: "id" | "public_id"; value: number | string } | null {
  const trimmed = idParam.trim();
  if (trimmed === "") return null;
  if (/^\d+$/.test(trimmed)) {
    const id = parseInt(trimmed, 10);
    if (!Number.isFinite(id) || id <= 0) return null;
    return { column: "id", value: id };
  }
  if (isPublicId(kind, trimmed)) return { column: "public_id", value: trimmed };
  return null;
}

// JSON columns parse defensively on read: a corrupt stored value maps to
// null instead of failing the whole response (dedicated try/catch, D1 rule).
function parseJsonColumn(raw: string | null): unknown {
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

// --- Row→API mapping (03 §8.5: INTEGER bools → boolean, JSON → parsed) ------

function offerRowToApi(row: LeadgenOfferRow): LeadgenOfferApi {
  return {
    ...row,
    calls_provider_api: row.calls_provider_api !== 0,
    cap_enabled: row.cap_enabled !== 0,
  };
}

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

// --- Phase-3 skeleton handlers ----------------------------------------------
//
// `table` is a fixed literal from the union below (the readEntityMetrics
// pattern) — user input only ever travels through .bind().

type LeadgenEntityTable =
  | "leadgen_offers"
  | "leadgen_sections"
  | "leadgen_quotes"
  | "leadgen_auctions";

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

// --- Offers (03 §8.2) --------------------------------------------------------
routes.get("/offers", listHandler<LeadgenOfferRow, LeadgenOfferApi>("leadgen_offers", offerRowToApi));
routes.get("/offers/:id", getHandler<LeadgenOfferRow, LeadgenOfferApi>("offer", "leadgen_offers", offerRowToApi));

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
