// LeadGen admin JSON API — the contract 03 §8.2 **Auction** block (Phase 9
// Stage B). Configures auctions; it does NOT run them — the §19 `/lg/auction`
// runtime + provider fetch + explainability is Phase 10. `/auctions/:id/simulate`
// is therefore a documented P10 SEAM (501) here.
//
// Consumes Stage-A engine modules verbatim (never modifies them): the
// `conditionsHash` canonical hash (auction-rules.ts) for the §21.4
// `conditions_hash` column, and `validateBannerFieldMap` (banner-default/
// styles.ts) so an automatic banner map may reference ONLY canonical Carrier
// fields (07 §20). Shared handler plumbing (paging, dual-id, JSON parsing,
// date range) is reused from offers-handlers.ts — single copy, per 03 §8.1/§8.5.
//
// Enum const arrays are LOCAL here (mirroring offers-handlers' local
// LEADGEN_OFFER_STATUSES + validation.ts' LEADGEN_* arrays), typed `satisfies
// readonly Leadgen*[]` with a compile-time completeness assertion so they can
// never drift from the db-types CHECK-derived unions. db-types stays purely
// declarative (its stated convention) — no runtime arrays added there. Parsed
// carrier_match_json / field_map_json reuse the Stage-A `LeadgenCarrierMatch`
// (auction-rules.ts) / `LeadgenBannerFieldMap` (banner-default/styles.ts).

import { mintPublicId } from "../../leadgen/ids";
import { conditionsHash } from "../../leadgen/auction-rules";
import type { LeadgenCarrierMatch } from "../../leadgen/auction-rules";
import { validateBannerFieldMap } from "../../public/leadgen/designs/banner-default/styles";
import { loadAuctionBundle, runAuction } from "../../public/leadgen/auction/engine";
import type { FunnelAssignment, ResolvedActivatedFunnel } from "../../public/leadgen/resolver";
import { buildWhereClause, type FilterCondition } from "../query-filters";
import {
  buildPaging,
  escapeLike,
  idSelector,
  parseDateRange,
  parseJsonColumn,
  parsePaging,
  readJsonBody,
  type AdminContext,
} from "./offers-handlers";
import type {
  LeadgenAuctionApi,
  LeadgenAuctionBannerRow,
  LeadgenAuctionRow,
  LeadgenAuctionRuleApi,
  LeadgenAuctionRuleRow,
  LeadgenAuctionStatus,
  LeadgenAuctionType,
  LeadgenBackfillMode,
  LeadgenBackfillTrigger,
  LeadgenBannerMode,
  LeadgenConditionOp,
  LeadgenFloorType,
  LeadgenFunnelRow,
  LeadgenFunnelVariantRow,
  LeadgenQuoteRow,
  LeadgenSiteQuoteRow,
  LeadgenMultiOfferMode,
  LeadgenRenderMode,
  LeadgenRemovalScope,
  LeadgenRuleAction,
  LeadgenRuleConditionGroup,
  LeadgenRuleConditions,
  LeadgenRuleLevel,
  LeadgenWinnerLogic,
} from "./db-types";

// ---------------------------------------------------------------------------
// Enum const arrays (DDL 0036 CHECK constraints) — local, drift-proof
// ---------------------------------------------------------------------------

const AUCTION_TYPES = ["static", "dynamic"] as const satisfies readonly LeadgenAuctionType[];
const WINNER_LOGICS = ["highest_bid", "average_bid", "sum_bids"] as const satisfies readonly LeadgenWinnerLogic[];
const FLOOR_TYPES = ["percentage_of_max", "absolute_bid"] as const satisfies readonly LeadgenFloorType[];
const MULTI_OFFER_MODES = ["disabled", "enabled", "enabled_unique"] as const satisfies readonly LeadgenMultiOfferMode[];
const RENDER_MODES = ["all_at_once", "progressive"] as const satisfies readonly LeadgenRenderMode[];
const BACKFILL_MODES = ["disabled", "enabled", "enabled_unique"] as const satisfies readonly LeadgenBackfillMode[];
const BACKFILL_TRIGGERS = ["on_slot_exhaustion", "on_click", "on_dismiss"] as const satisfies readonly LeadgenBackfillTrigger[];
const REMOVAL_SCOPES = ["offer", "carrier"] as const satisfies readonly LeadgenRemovalScope[];
const AUCTION_STATUSES = ["active", "paused", "archived"] as const satisfies readonly LeadgenAuctionStatus[];
const RULE_LEVELS = ["offer", "carrier"] as const satisfies readonly LeadgenRuleLevel[];
const RULE_ACTIONS = ["include_only", "exclude", "allow_list", "block_list"] as const satisfies readonly LeadgenRuleAction[];
const BANNER_MODES = ["manual", "automatic"] as const satisfies readonly LeadgenBannerMode[];
const CONDITION_OPS = ["eq", "neq", "gt", "lt", "gte", "lte", "range", "in", "not_in"] as const satisfies readonly LeadgenConditionOp[];

// Compile-time completeness: each array must cover its FULL union (satisfies
// only proves membership, not exhaustiveness). Fails the build if a CHECK enum
// gains a member the array is missing — the banner-default `_IsComplete` idiom.
type _Assert<T extends true> = T;
type _Complete<Union, Arr extends readonly Union[]> = [Union] extends [Arr[number]] ? true : false;
type _EnumsComplete = _Assert<
  _Complete<LeadgenAuctionType, typeof AUCTION_TYPES> &
    _Complete<LeadgenWinnerLogic, typeof WINNER_LOGICS> &
    _Complete<LeadgenFloorType, typeof FLOOR_TYPES> &
    _Complete<LeadgenMultiOfferMode, typeof MULTI_OFFER_MODES> &
    _Complete<LeadgenRenderMode, typeof RENDER_MODES> &
    _Complete<LeadgenBackfillMode, typeof BACKFILL_MODES> &
    _Complete<LeadgenBackfillTrigger, typeof BACKFILL_TRIGGERS> &
    _Complete<LeadgenRemovalScope, typeof REMOVAL_SCOPES> &
    _Complete<LeadgenAuctionStatus, typeof AUCTION_STATUSES> &
    _Complete<LeadgenRuleLevel, typeof RULE_LEVELS> &
    _Complete<LeadgenRuleAction, typeof RULE_ACTIONS> &
    _Complete<LeadgenBannerMode, typeof BANNER_MODES> &
    _Complete<LeadgenConditionOp, typeof CONDITION_OPS>
>;
const _enumsComplete: _EnumsComplete = true;
void _enumsComplete;

// ---------------------------------------------------------------------------
// small local helpers (the offers/quotes/sections private idiom)
// ---------------------------------------------------------------------------

type FieldErrors = Record<string, string>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function trimmedString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function asToggle(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (value === 1) return true;
  if (value === 0) return false;
  return null;
}

// Sentinel-free integer-id parse: a positive integer, or null (absent/cleared),
// or the INVALID symbol (a present-but-malformed value → a clean 400).
const INVALID = Symbol("invalid-int");
function asIntId(value: unknown): number | null | typeof INVALID {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const n = parseInt(value.trim(), 10);
    return Number.isFinite(n) && n > 0 ? n : INVALID;
  }
  return INVALID;
}

function asFiniteNumber(value: unknown): number | typeof INVALID {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return INVALID;
}

// D1 100-binding safety: chunk IN(?) reads at 80 (d1-database-safety rule).
function chunk<T>(items: readonly T[], size = 80): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function jsonStringOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value.trim() === "" ? null : value;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Row resolution + Row→API mapping (03 §8.5)
// ---------------------------------------------------------------------------

export async function resolveAuctionRow(
  db: D1Database,
  idParam: string,
): Promise<LeadgenAuctionRow | null> {
  const selector = idSelector("auction", idParam);
  if (selector === null) return null;
  const sql =
    selector.column === "id"
      ? "SELECT * FROM leadgen_auctions WHERE id = ? LIMIT 1"
      : "SELECT * FROM leadgen_auctions WHERE public_id = ? LIMIT 1";
  const row = await db.prepare(sql).bind(selector.value).first<LeadgenAuctionRow>();
  return row ?? null;
}

// 03 §8.5: INTEGER bools → boolean, banner_config_json → parsed. Exported so
// router.ts maps auction rows through the single canonical mapper.
export function auctionRowToApi(row: LeadgenAuctionRow): LeadgenAuctionApi {
  return {
    ...row,
    mixed_payout_warn: row.mixed_payout_warn !== 0,
    surface_static_bid_offers: row.surface_static_bid_offers !== 0,
    remove_clicked_offers: row.remove_clicked_offers !== 0,
    banner_config_json: parseJsonColumn(row.banner_config_json),
  };
}

function auctionRuleRowToApi(row: LeadgenAuctionRuleRow): LeadgenAuctionRuleApi {
  return {
    ...row,
    conditions_json: (parseJsonColumn(row.conditions_json) as LeadgenRuleConditions | null) ?? { groups: [] },
    carrier_match_json: parseJsonColumn(row.carrier_match_json),
    strictly_override: row.strictly_override !== 0,
    enabled: row.enabled !== 0,
  };
}

// ---------------------------------------------------------------------------
// §18.1 settings validation — shared by POST (create) + PATCH (merge)
// ---------------------------------------------------------------------------

interface AuctionSettings {
  auction_type: LeadgenAuctionType;
  banner_design_id: string;
  winner_logic: LeadgenWinnerLogic;
  floor_type: LeadgenFloorType;
  floor_value: number;
  mixed_payout_warn: number;
  multi_offer: LeadgenMultiOfferMode;
  surface_static_bid_offers: number;
  banner_slots_count: number;
  max_carriers_per_offer: number;
  max_total_carriers: number;
  render_mode: LeadgenRenderMode;
  backfill: LeadgenBackfillMode;
  backfill_source_offer_id: number | null;
  backfill_trigger: LeadgenBackfillTrigger;
  remove_clicked_offers: number;
  removal_scope: LeadgenRemovalScope;
  timeout_ms: number;
  carrier_normalization_version: number;
  banner_config_json: string | null;
  status: LeadgenAuctionStatus;
}

// Merge the §18.1 settings over a baseline (create → DDL defaults; patch →
// the existing row). Every provided field is validated against the DDL CHECK
// (enums) / grammar (numerics with `??` defaults, never `||`, so 0 is honored).
function buildAuctionSettings(
  body: Record<string, unknown>,
  base: AuctionSettings,
): { errors: FieldErrors; value: AuctionSettings } {
  const errors: FieldErrors = {};
  const v: AuctionSettings = { ...base };

  const enumField = <T extends string>(
    key: string,
    allowed: readonly T[],
    assign: (val: T) => void,
  ): void => {
    if (body[key] === undefined) return;
    const raw = body[key];
    if (typeof raw !== "string" || !(allowed as readonly string[]).includes(raw)) {
      errors[key] = `${key} must be one of ${allowed.join("|")}`;
      return;
    }
    assign(raw as T);
  };

  const intField = (key: string, assign: (val: number) => void, min = 0): void => {
    if (body[key] === undefined) return;
    const raw = body[key];
    if (typeof raw !== "number" || !Number.isInteger(raw) || raw < min) {
      errors[key] = `${key} must be an integer >= ${min}`;
      return;
    }
    assign(raw);
  };

  const toggleField = (key: string, assign: (val: number) => void): void => {
    if (body[key] === undefined) return;
    const t = asToggle(body[key]);
    if (t === null) errors[key] = `${key} must be a boolean`;
    else assign(t ? 1 : 0);
  };

  enumField("auction_type", AUCTION_TYPES, (val) => (v.auction_type = val));
  enumField("winner_logic", WINNER_LOGICS, (val) => (v.winner_logic = val));
  enumField("floor_type", FLOOR_TYPES, (val) => (v.floor_type = val));
  enumField("multi_offer", MULTI_OFFER_MODES, (val) => (v.multi_offer = val));
  enumField("render_mode", RENDER_MODES, (val) => (v.render_mode = val));
  enumField("backfill", BACKFILL_MODES, (val) => (v.backfill = val));
  enumField("backfill_trigger", BACKFILL_TRIGGERS, (val) => (v.backfill_trigger = val));
  enumField("removal_scope", REMOVAL_SCOPES, (val) => (v.removal_scope = val));
  enumField("status", AUCTION_STATUSES, (val) => (v.status = val));

  if (body["banner_design_id"] !== undefined) {
    v.banner_design_id = trimmedString(body["banner_design_id"]) ?? "default"; // §14.1 blank → default
  }

  if (body["floor_value"] !== undefined) {
    const n = asFiniteNumber(body["floor_value"]);
    if (n === INVALID || n < 0) errors["floor_value"] = "floor_value must be a non-negative number";
    else v.floor_value = n;
  }

  intField("banner_slots_count", (n) => (v.banner_slots_count = n), 0);
  intField("max_carriers_per_offer", (n) => (v.max_carriers_per_offer = n), 0);
  intField("max_total_carriers", (n) => (v.max_total_carriers = n), 0);
  intField("timeout_ms", (n) => (v.timeout_ms = n), 0);
  intField("carrier_normalization_version", (n) => (v.carrier_normalization_version = n), 1);

  toggleField("mixed_payout_warn", (n) => (v.mixed_payout_warn = n));
  toggleField("surface_static_bid_offers", (n) => (v.surface_static_bid_offers = n));
  toggleField("remove_clicked_offers", (n) => (v.remove_clicked_offers = n));

  if (body["backfill_source_offer_id"] !== undefined) {
    const parsed = asIntId(body["backfill_source_offer_id"]);
    if (parsed === INVALID) errors["backfill_source_offer_id"] = "backfill_source_offer_id must be an integer id";
    else v.backfill_source_offer_id = parsed;
  }

  if (body["banner_config_json"] !== undefined) {
    const raw = body["banner_config_json"];
    if (raw === null) v.banner_config_json = null;
    else if (isRecord(raw)) v.banner_config_json = JSON.stringify(raw);
    else if (typeof raw === "string") v.banner_config_json = jsonStringOrNull(raw);
    else errors["banner_config_json"] = "banner_config_json must be an object";
  }

  return { errors, value: v };
}

const DEFAULT_SETTINGS: AuctionSettings = {
  auction_type: "static",
  banner_design_id: "default",
  winner_logic: "highest_bid",
  floor_type: "percentage_of_max",
  floor_value: 10,
  mixed_payout_warn: 1,
  multi_offer: "disabled",
  surface_static_bid_offers: 1,
  banner_slots_count: 5,
  max_carriers_per_offer: 3,
  max_total_carriers: 10,
  render_mode: "all_at_once",
  backfill: "disabled",
  backfill_source_offer_id: null,
  backfill_trigger: "on_slot_exhaustion",
  remove_clicked_offers: 0,
  removal_scope: "offer",
  timeout_ms: 2500,
  carrier_normalization_version: 1,
  banner_config_json: null,
  status: "active",
};

function rowToSettings(row: LeadgenAuctionRow): AuctionSettings {
  return {
    auction_type: row.auction_type,
    banner_design_id: row.banner_design_id,
    winner_logic: row.winner_logic,
    floor_type: row.floor_type,
    floor_value: row.floor_value,
    mixed_payout_warn: row.mixed_payout_warn,
    multi_offer: row.multi_offer,
    surface_static_bid_offers: row.surface_static_bid_offers,
    banner_slots_count: row.banner_slots_count,
    max_carriers_per_offer: row.max_carriers_per_offer,
    max_total_carriers: row.max_total_carriers,
    render_mode: row.render_mode,
    backfill: row.backfill,
    backfill_source_offer_id: row.backfill_source_offer_id,
    backfill_trigger: row.backfill_trigger,
    remove_clicked_offers: row.remove_clicked_offers,
    removal_scope: row.removal_scope,
    timeout_ms: row.timeout_ms,
    carrier_normalization_version: row.carrier_normalization_version,
    banner_config_json: row.banner_config_json,
    status: row.status,
  };
}

// FK existence for the optional attribution + backfill-source references — a
// clean 400 rather than a D1 constraint 500 on a dangling id.
async function checkFkExists(db: D1Database, table: string, id: number): Promise<boolean> {
  const row = await db.prepare(`SELECT id FROM ${table} WHERE id = ? LIMIT 1`).bind(id).first<{ id: number }>();
  return row !== null;
}

// ---------------------------------------------------------------------------
// GET /auctions — list + §9.5 filters (search/quote/type/status) + participating
// count + quote attribution. §18.9 analytics hydrate after-paint (the P4–P8
// offers/quotes list idiom: list SQL carries CONFIG counts, analytics come from
// /auctions/:id/analytics).
// ---------------------------------------------------------------------------

type AuctionListRow = LeadgenAuctionRow & {
  quote_name: string | null;
  quote_public_id: string | null;
  participating_count: number;
};

export async function listAuctionsHandler(c: AdminContext): Promise<Response> {
  const search = c.req.query("search")?.trim() ?? "";
  const quote = c.req.query("quote")?.trim() ?? "";
  const type = c.req.query("type")?.trim() ?? "";
  const status = c.req.query("status")?.trim() ?? "";

  if (type !== "" && !(AUCTION_TYPES as readonly string[]).includes(type)) {
    return c.json({ error: "Validation failed", fields: { type: `type must be one of ${AUCTION_TYPES.join("|")}` } }, 400);
  }
  if (status !== "" && !(AUCTION_STATUSES as readonly string[]).includes(status)) {
    return c.json({ error: "Validation failed", fields: { status: `status must be one of ${AUCTION_STATUSES.join("|")}` } }, 400);
  }

  // `quote` filter accepts a numeric quote id OR a quote public_id (lgq_).
  const quoteSelector = quote === "" ? null : idSelector("quote", quote);
  if (quote !== "" && quoteSelector === null) {
    return c.json({ error: "Validation failed", fields: { quote: "quote must be a quote id or public_id" } }, 400);
  }

  const like = `%${escapeLike(search)}%`;
  const filters: FilterCondition[] = [
    { when: search !== "", clause: "a.auction_name LIKE ? ESCAPE '\\'", params: [like] },
    { when: type !== "", clause: "a.auction_type = ?", params: [type] },
    { when: status !== "", clause: "a.status = ?", params: [status] },
    {
      when: quoteSelector !== null && quoteSelector.column === "id",
      clause: "a.quote_id = ?",
      params: quoteSelector !== null && quoteSelector.column === "id" ? [quoteSelector.value as number] : [],
    },
    {
      when: quoteSelector !== null && quoteSelector.column === "public_id",
      clause: "a.quote_id = (SELECT id FROM leadgen_quotes WHERE public_id = ?)",
      params: quoteSelector !== null && quoteSelector.column === "public_id" ? [quoteSelector.value as string] : [],
    },
  ];
  const { clause, params } = buildWhereClause(filters);
  const { page, pageSize, offset } = parsePaging(c);

  const rows = await c.env.DB.prepare(
    `SELECT a.*, q.quote_name AS quote_name, q.public_id AS quote_public_id,
       (SELECT COUNT(*) FROM leadgen_auction_offers ao WHERE ao.auction_id = a.id) AS participating_count
     FROM leadgen_auctions a
     LEFT JOIN leadgen_quotes q ON q.id = a.quote_id
     WHERE ${clause} ORDER BY a.updated_at DESC, a.id DESC LIMIT ? OFFSET ?`,
  )
    .bind(...params, pageSize, offset)
    .all<AuctionListRow>();
  const totalRow = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM leadgen_auctions a WHERE ${clause}`)
    .bind(...params)
    .first<{ n: number }>();
  const total = Number(totalRow?.n ?? 0);

  return c.json({
    items: (rows.results ?? []).map((row) => ({
      ...auctionRowToApi(row),
      quote_name: row.quote_name ?? null,
      quote_public_id: row.quote_public_id ?? null,
      participating_count: Number(row.participating_count ?? 0),
    })),
    paging: buildPaging(page, pageSize, total),
  });
}

// ---------------------------------------------------------------------------
// POST /auctions — create (§18.1 required auction_name + quote_id attribution)
// ---------------------------------------------------------------------------

export async function createAuctionHandler(c: AdminContext): Promise<Response> {
  const body = await readJsonBody(c);
  if (body === null) return c.json({ error: "Invalid JSON body" }, 400);

  const errors: FieldErrors = {};
  const auctionName = trimmedString(body["auction_name"]);
  if (auctionName === null) errors["auction_name"] = "auction_name is required";

  // §18.1: quote_id is the REQUIRED attribution.
  const quoteId = asIntId(body["quote_id"]);
  if (quoteId === INVALID || quoteId === null) errors["quote_id"] = "quote_id is required (integer id)";

  const { errors: settingsErrors, value } = buildAuctionSettings(body, DEFAULT_SETTINGS);
  Object.assign(errors, settingsErrors);

  // optional attribution refs
  let funnelId: number | null = null;
  if (body["funnel_id"] !== undefined) {
    const parsed = asIntId(body["funnel_id"]);
    if (parsed === INVALID) errors["funnel_id"] = "funnel_id must be an integer id";
    else funnelId = parsed;
  }
  let funnelVariantId: number | null = null;
  if (body["funnel_variant_id"] !== undefined) {
    const parsed = asIntId(body["funnel_variant_id"]);
    if (parsed === INVALID) errors["funnel_variant_id"] = "funnel_variant_id must be an integer id";
    else funnelVariantId = parsed;
  }

  if (Object.keys(errors).length > 0 || auctionName === null || quoteId === null || quoteId === INVALID) {
    return c.json({ error: "Validation failed", fields: errors }, 400);
  }

  // FK existence (clean 400, not a D1 500).
  if (!(await checkFkExists(c.env.DB, "leadgen_quotes", quoteId))) {
    return c.json({ error: "Validation failed", fields: { quote_id: `quote ${quoteId} does not exist` } }, 400);
  }
  if (funnelId !== null && !(await checkFkExists(c.env.DB, "leadgen_funnels", funnelId))) {
    return c.json({ error: "Validation failed", fields: { funnel_id: `funnel ${funnelId} does not exist` } }, 400);
  }
  if (funnelVariantId !== null && !(await checkFkExists(c.env.DB, "leadgen_funnel_variants", funnelVariantId))) {
    return c.json({ error: "Validation failed", fields: { funnel_variant_id: `funnel variant ${funnelVariantId} does not exist` } }, 400);
  }
  if (value.backfill_source_offer_id !== null && !(await checkFkExists(c.env.DB, "leadgen_offers", value.backfill_source_offer_id))) {
    return c.json({ error: "Validation failed", fields: { backfill_source_offer_id: `offer ${value.backfill_source_offer_id} does not exist` } }, 400);
  }

  const publicId = mintPublicId("auction");
  await c.env.DB.prepare(
    `INSERT INTO leadgen_auctions
       (public_id, auction_name, quote_id, funnel_id, funnel_variant_id, auction_type, banner_design_id,
        winner_logic, floor_type, floor_value, mixed_payout_warn, multi_offer, surface_static_bid_offers,
        banner_slots_count, max_carriers_per_offer, max_total_carriers, render_mode, backfill,
        backfill_source_offer_id, backfill_trigger, remove_clicked_offers, removal_scope, timeout_ms,
        carrier_normalization_version, banner_config_json, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      publicId, auctionName, quoteId, funnelId, funnelVariantId, value.auction_type, value.banner_design_id,
      value.winner_logic, value.floor_type, value.floor_value, value.mixed_payout_warn, value.multi_offer, value.surface_static_bid_offers,
      value.banner_slots_count, value.max_carriers_per_offer, value.max_total_carriers, value.render_mode, value.backfill,
      value.backfill_source_offer_id, value.backfill_trigger, value.remove_clicked_offers, value.removal_scope, value.timeout_ms,
      value.carrier_normalization_version, value.banner_config_json, value.status,
    )
    .run();

  const row = await c.env.DB.prepare("SELECT * FROM leadgen_auctions WHERE public_id = ? LIMIT 1").bind(publicId).first<LeadgenAuctionRow>();
  if (!row) return c.json({ error: "Insert failed" }, 500);
  return c.json(auctionRowToApi(row), 201);
}

// ---------------------------------------------------------------------------
// GET /auctions/:id — detail
// ---------------------------------------------------------------------------

export async function getAuctionHandler(c: AdminContext): Promise<Response> {
  const row = await resolveAuctionRow(c.env.DB, c.req.param("id") ?? "");
  if (row === null) return c.json({ error: "Not Found" }, 404);
  return c.json(auctionRowToApi(row));
}

// ---------------------------------------------------------------------------
// PATCH /auctions/:id — honors every §18.1 setting + mixed_payout_warn + the
// attribution refs (merge-over-existing).
// ---------------------------------------------------------------------------

export async function patchAuctionHandler(c: AdminContext): Promise<Response> {
  const row = await resolveAuctionRow(c.env.DB, c.req.param("id") ?? "");
  if (row === null) return c.json({ error: "Not Found" }, 404);
  const body = await readJsonBody(c);
  if (body === null) return c.json({ error: "Invalid JSON body" }, 400);

  const errors: FieldErrors = {};

  let auctionName = row.auction_name;
  if (body["auction_name"] !== undefined) {
    const v = trimmedString(body["auction_name"]);
    if (v === null) errors["auction_name"] = "auction_name cannot be empty";
    else auctionName = v;
  }

  let quoteId = row.quote_id;
  if (body["quote_id"] !== undefined) {
    const parsed = asIntId(body["quote_id"]);
    if (parsed === INVALID || parsed === null) errors["quote_id"] = "quote_id must be an integer id";
    else quoteId = parsed;
  }
  let funnelId = row.funnel_id;
  if (body["funnel_id"] !== undefined) {
    const parsed = asIntId(body["funnel_id"]);
    if (parsed === INVALID) errors["funnel_id"] = "funnel_id must be an integer id";
    else funnelId = parsed;
  }
  let funnelVariantId = row.funnel_variant_id;
  if (body["funnel_variant_id"] !== undefined) {
    const parsed = asIntId(body["funnel_variant_id"]);
    if (parsed === INVALID) errors["funnel_variant_id"] = "funnel_variant_id must be an integer id";
    else funnelVariantId = parsed;
  }

  const { errors: settingsErrors, value } = buildAuctionSettings(body, rowToSettings(row));
  Object.assign(errors, settingsErrors);

  if (Object.keys(errors).length > 0) {
    return c.json({ error: "Validation failed", fields: errors }, 400);
  }

  if (quoteId !== null && quoteId !== row.quote_id && !(await checkFkExists(c.env.DB, "leadgen_quotes", quoteId))) {
    return c.json({ error: "Validation failed", fields: { quote_id: `quote ${quoteId} does not exist` } }, 400);
  }
  if (funnelId !== null && funnelId !== row.funnel_id && !(await checkFkExists(c.env.DB, "leadgen_funnels", funnelId))) {
    return c.json({ error: "Validation failed", fields: { funnel_id: `funnel ${funnelId} does not exist` } }, 400);
  }
  if (funnelVariantId !== null && funnelVariantId !== row.funnel_variant_id && !(await checkFkExists(c.env.DB, "leadgen_funnel_variants", funnelVariantId))) {
    return c.json({ error: "Validation failed", fields: { funnel_variant_id: `funnel variant ${funnelVariantId} does not exist` } }, 400);
  }
  if (value.backfill_source_offer_id !== null && value.backfill_source_offer_id !== row.backfill_source_offer_id && !(await checkFkExists(c.env.DB, "leadgen_offers", value.backfill_source_offer_id))) {
    return c.json({ error: "Validation failed", fields: { backfill_source_offer_id: `offer ${value.backfill_source_offer_id} does not exist` } }, 400);
  }

  await c.env.DB.prepare(
    `UPDATE leadgen_auctions SET
       auction_name = ?, quote_id = ?, funnel_id = ?, funnel_variant_id = ?, auction_type = ?, banner_design_id = ?,
       winner_logic = ?, floor_type = ?, floor_value = ?, mixed_payout_warn = ?, multi_offer = ?, surface_static_bid_offers = ?,
       banner_slots_count = ?, max_carriers_per_offer = ?, max_total_carriers = ?, render_mode = ?, backfill = ?,
       backfill_source_offer_id = ?, backfill_trigger = ?, remove_clicked_offers = ?, removal_scope = ?, timeout_ms = ?,
       carrier_normalization_version = ?, banner_config_json = ?, status = ?, updated_at = unixepoch()
     WHERE id = ?`,
  )
    .bind(
      auctionName, quoteId, funnelId, funnelVariantId, value.auction_type, value.banner_design_id,
      value.winner_logic, value.floor_type, value.floor_value, value.mixed_payout_warn, value.multi_offer, value.surface_static_bid_offers,
      value.banner_slots_count, value.max_carriers_per_offer, value.max_total_carriers, value.render_mode, value.backfill,
      value.backfill_source_offer_id, value.backfill_trigger, value.remove_clicked_offers, value.removal_scope, value.timeout_ms,
      value.carrier_normalization_version, value.banner_config_json, value.status, row.id,
    )
    .run();

  const updated = await c.env.DB.prepare("SELECT * FROM leadgen_auctions WHERE id = ? LIMIT 1").bind(row.id).first<LeadgenAuctionRow>();
  if (!updated) return c.json({ error: "Update failed" }, 500);
  return c.json(auctionRowToApi(updated));
}

// DELETE /auctions/:id — archive (status flip, reversible; matches Listicles).
export async function deleteAuctionHandler(c: AdminContext): Promise<Response> {
  const row = await resolveAuctionRow(c.env.DB, c.req.param("id") ?? "");
  if (row === null) return c.json({ error: "Not Found" }, 404);
  await c.env.DB.prepare("UPDATE leadgen_auctions SET status = 'archived', updated_at = unixepoch() WHERE id = ?").bind(row.id).run();
  return c.json({ id: row.id, public_id: row.public_id, status: "archived" });
}

// ---------------------------------------------------------------------------
// GET/PUT /auctions/:id/offers — participating placements (§18.5)
// ---------------------------------------------------------------------------

interface AuctionOfferJoinRow {
  offer_placement_id: number;
  offer_id: number;
  static_order: number | null;
  static_bid_override: number | null;
  enabled: number;
  placement_public_id: string | null;
  placement_label: string | null;
  placement_external_id: string | null;
  offer_public_id: string | null;
  offer_name: string | null;
  provider: string | null;
  activity: string | null;
  vertical: string | null;
  offer_type: string | null;
  offer_status: string | null;
  calls_provider_api: number | null;
  cap_enabled: number | null;
  active_payload_schema_id: number | null;
  schema_version: number | null;
  last_test_status: string | null;
}

async function readAuctionOffers(db: D1Database, auctionId: number): Promise<AuctionOfferJoinRow[]> {
  // last_test_status: newest provider-request-log status for the offer (2xx →
  // passed; any other → failed; no rows → untested). The provider log is P10
  // runtime data, so this reads `untested` until P10 records requests.
  const result = await db
    .prepare(
      `SELECT ao.offer_placement_id, ao.offer_id, ao.static_order, ao.static_bid_override, ao.enabled,
              p.public_id AS placement_public_id, p.label AS placement_label, p.placement_id AS placement_external_id,
              o.public_id AS offer_public_id, o.offer_name, o.provider, o.activity, o.vertical, o.offer_type,
              o.status AS offer_status, o.calls_provider_api, o.cap_enabled, o.active_payload_schema_id,
              s.version AS schema_version,
              (SELECT CASE WHEN prl.status_code >= 200 AND prl.status_code < 300 THEN 'passed'
                           WHEN prl.status_code IS NULL THEN 'untested' ELSE 'failed' END
                 FROM leadgen_provider_request_log prl
                 WHERE prl.offer_public_id = o.public_id
                 ORDER BY prl.created_at DESC LIMIT 1) AS last_test_status
       FROM leadgen_auction_offers ao
       JOIN leadgen_offer_placements p ON p.id = ao.offer_placement_id
       JOIN leadgen_offers o ON o.id = ao.offer_id
       LEFT JOIN leadgen_offer_payload_schemas s ON s.id = o.active_payload_schema_id
       WHERE ao.auction_id = ?
       ORDER BY ao.static_order IS NULL, ao.static_order ASC, o.offer_name ASC`,
    )
    .bind(auctionId)
    .all<AuctionOfferJoinRow>();
  return result.results ?? [];
}

function auctionOfferRowToApi(row: AuctionOfferJoinRow): Record<string, unknown> {
  return {
    offer_placement_id: row.offer_placement_id,
    offer_id: row.offer_id,
    offer_public_id: row.offer_public_id,
    offer_name: row.offer_name,
    provider: row.provider,
    activity: row.activity,
    vertical: row.vertical,
    offer_type: row.offer_type,
    offer_status: row.offer_status,
    calls_provider_api: (row.calls_provider_api ?? 0) !== 0,
    cap_enabled: (row.cap_enabled ?? 0) !== 0,
    placement_public_id: row.placement_public_id,
    placement_label: row.placement_label,
    placement_external_id: row.placement_external_id,
    active_payload_schema_id: row.active_payload_schema_id,
    schema_version: row.schema_version,
    last_test_status: row.last_test_status ?? "untested",
    static_order: row.static_order,
    static_bid_override: row.static_bid_override,
    enabled: row.enabled !== 0,
  };
}

export async function getAuctionOffersHandler(c: AdminContext): Promise<Response> {
  const auction = await resolveAuctionRow(c.env.DB, c.req.param("id") ?? "");
  if (auction === null) return c.json({ error: "Not Found" }, 404);
  const rows = await readAuctionOffers(c.env.DB, auction.id);
  return c.json({ items: rows.map(auctionOfferRowToApi) });
}

interface PlacementRefRow {
  placement_id: number;
  offer_id: number;
  offer_activity: string;
  offer_vertical: string;
  offer_status: string;
}

interface PreparedPlacement {
  offer_placement_id: number;
  offer_id: number;
  static_order: number | null;
  static_bid_override: number | null;
  enabled: number;
}

// PUT /auctions/:id/offers — REPLACE-SET into leadgen_auction_offers (one atomic
// batch). Each placement must EXIST + belong to an ACTIVE Offer matching the
// attributed Quote's activity + one of its verticals (the §12.4 section-picker
// rule, applied to the auction's Quote).
export async function putAuctionOffersHandler(c: AdminContext): Promise<Response> {
  const auction = await resolveAuctionRow(c.env.DB, c.req.param("id") ?? "");
  if (auction === null) return c.json({ error: "Not Found" }, 404);
  const body = await readJsonBody(c);
  if (body === null) return c.json({ error: "Invalid JSON body" }, 400);

  const rawOffers = body["offers"];
  if (!Array.isArray(rawOffers)) {
    return c.json({ error: "Validation failed", fields: { offers: "offers must be an array" } }, 400);
  }

  const errors: FieldErrors = {};
  const parsed: PreparedPlacement[] = [];
  const seen = new Set<number>();
  const placementIds: number[] = [];

  for (let i = 0; i < rawOffers.length; i++) {
    const entry = rawOffers[i];
    if (!isRecord(entry)) {
      errors[`offers.${i}`] = "each participating offer must be an object";
      continue;
    }
    const placementId = asIntId(entry["offer_placement_id"]);
    if (placementId === INVALID || placementId === null) {
      errors[`offers.${i}.offer_placement_id`] = "offer_placement_id is required (integer id)";
      continue;
    }
    if (seen.has(placementId)) {
      errors[`offers.${i}.offer_placement_id`] = `duplicate offer_placement_id ${placementId}`;
      continue;
    }
    seen.add(placementId);
    placementIds.push(placementId);

    let staticOrder: number | null = null;
    if (entry["static_order"] !== undefined && entry["static_order"] !== null) {
      // static_order is a 0-based sort index (numeric only — a stringized "2" is
      // REJECTED, never silently dropped to NULL). asIntId rejects 0, so the
      // non-negative-integer check is done directly here.
      const raw = entry["static_order"];
      if (typeof raw === "number" && Number.isInteger(raw) && raw >= 0) staticOrder = raw;
      else errors[`offers.${i}.static_order`] = "static_order must be a non-negative integer";
    }
    let staticBid: number | null = null;
    if (entry["static_bid_override"] !== undefined && entry["static_bid_override"] !== null) {
      const sb = asFiniteNumber(entry["static_bid_override"]);
      if (sb === INVALID || sb < 0) errors[`offers.${i}.static_bid_override`] = "static_bid_override must be a non-negative number";
      else staticBid = sb;
    }
    const enabled = asToggle(entry["enabled"]) ?? true;
    parsed.push({ offer_placement_id: placementId, offer_id: 0, static_order: staticOrder, static_bid_override: staticBid, enabled: enabled ? 1 : 0 });
  }

  if (Object.keys(errors).length > 0) {
    return c.json({ error: "Validation failed", fields: errors }, 400);
  }

  // Resolve placement → offer (chunked IN(?) reads — 100-binding-safe).
  const placementMap = new Map<number, PlacementRefRow>();
  for (const ids of chunk(placementIds)) {
    if (ids.length === 0) continue;
    const marks = ids.map(() => "?").join(",");
    const res = await c.env.DB.prepare(
      `SELECT p.id AS placement_id, p.offer_id AS offer_id,
              o.activity AS offer_activity, o.vertical AS offer_vertical, o.status AS offer_status
       FROM leadgen_offer_placements p JOIN leadgen_offers o ON o.id = p.offer_id
       WHERE p.id IN (${marks})`,
    )
      .bind(...ids)
      .all<PlacementRefRow>();
    for (const r of res.results ?? []) placementMap.set(r.placement_id, r);
  }

  // The attributed Quote's activity + verticals gate participation (§12.4-style).
  let quoteActivity: string | null = null;
  let quoteVerticals: string[] = [];
  if (auction.quote_id !== null) {
    const quote = await c.env.DB.prepare("SELECT activity, verticals_json FROM leadgen_quotes WHERE id = ? LIMIT 1")
      .bind(auction.quote_id)
      .first<{ activity: string; verticals_json: string }>();
    if (quote) {
      quoteActivity = quote.activity;
      const parsedV = parseJsonColumn(quote.verticals_json);
      quoteVerticals = Array.isArray(parsedV) ? parsedV.filter((v): v is string => typeof v === "string") : [];
    }
  }

  for (let i = 0; i < parsed.length; i++) {
    const p = parsed[i]!;
    const ref = placementMap.get(p.offer_placement_id);
    if (ref === undefined) {
      errors[`offers.${i}.offer_placement_id`] = `placement ${p.offer_placement_id} does not exist`;
      continue;
    }
    p.offer_id = ref.offer_id;
    if (ref.offer_status !== "active") {
      errors[`offers.${i}.offer_placement_id`] = `offer for placement ${p.offer_placement_id} is not active`;
      continue;
    }
    if (quoteActivity !== null) {
      if (ref.offer_activity !== quoteActivity || (quoteVerticals.length > 0 && !quoteVerticals.includes(ref.offer_vertical))) {
        errors[`offers.${i}.offer_placement_id`] = "offer activity/vertical does not match the auction's Quote (§12.4)";
        continue;
      }
    }
  }

  if (Object.keys(errors).length > 0) {
    return c.json({ error: "Validation failed", fields: errors }, 400);
  }

  // One atomic replace-set batch: DELETE all, then single-row INSERTs
  // (≤6 bindings each — 100-binding-safe, so no multi-row VALUES chunking).
  const statements: D1PreparedStatement[] = [
    c.env.DB.prepare("DELETE FROM leadgen_auction_offers WHERE auction_id = ?").bind(auction.id),
  ];
  for (const p of parsed) {
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO leadgen_auction_offers (auction_id, offer_placement_id, offer_id, static_order, static_bid_override, enabled)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).bind(auction.id, p.offer_placement_id, p.offer_id, p.static_order, p.static_bid_override, p.enabled),
    );
  }
  await c.env.DB.batch(statements);

  const rows = await readAuctionOffers(c.env.DB, auction.id);
  return c.json({ items: rows.map(auctionOfferRowToApi) });
}

// ---------------------------------------------------------------------------
// §21.4 conditions validation
// ---------------------------------------------------------------------------

function validateConditions(raw: unknown): { conditions: LeadgenRuleConditions; error: string | null } {
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    if (raw.trim() === "") return { conditions: { groups: [] }, error: null };
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { conditions: { groups: [] }, error: "conditions must be valid JSON" };
    }
  }
  if (parsed === undefined || parsed === null) return { conditions: { groups: [] }, error: null };
  if (!isRecord(parsed)) return { conditions: { groups: [] }, error: "conditions must be an object with a groups array" };
  const groupsRaw = parsed["groups"];
  if (groupsRaw === undefined) return { conditions: { groups: [] }, error: null };
  if (!Array.isArray(groupsRaw)) return { conditions: { groups: [] }, error: "conditions.groups must be an array" };

  const groups: LeadgenRuleConditionGroup[] = [];
  for (let i = 0; i < groupsRaw.length; i++) {
    const g = groupsRaw[i];
    if (!isRecord(g)) return { conditions: { groups: [] }, error: `conditions.groups[${i}] must be an object` };
    const field = trimmedString(g["field"]);
    if (field === null) return { conditions: { groups: [] }, error: `conditions.groups[${i}].field is required` };
    const op = g["op"];
    if (typeof op !== "string" || !(CONDITION_OPS as readonly string[]).includes(op)) {
      return { conditions: { groups: [] }, error: `conditions.groups[${i}].op must be one of ${CONDITION_OPS.join("|")}` };
    }
    const typedOp = op as LeadgenConditionOp;
    if (typedOp === "range") {
      if (typeof g["from"] !== "number" || typeof g["to"] !== "number") {
        return { conditions: { groups: [] }, error: `conditions.groups[${i}] range op requires numeric from + to` };
      }
    } else if (typedOp === "in" || typedOp === "not_in") {
      if (!Array.isArray(g["values"])) {
        return { conditions: { groups: [] }, error: `conditions.groups[${i}] ${typedOp} op requires a values array` };
      }
    } else if (g["value"] === undefined) {
      return { conditions: { groups: [] }, error: `conditions.groups[${i}] ${typedOp} op requires a value` };
    }
    const group: LeadgenRuleConditionGroup = { field, op: typedOp };
    if (g["value"] !== undefined) group.value = g["value"];
    if (Array.isArray(g["values"])) group.values = g["values"] as unknown[];
    if (typeof g["from"] === "number") group.from = g["from"];
    if (typeof g["to"] === "number") group.to = g["to"];
    groups.push(group);
  }
  return { conditions: { groups }, error: null };
}

// carrier_match_json (07 §21) — carrier_keys / carrier_names string arrays.
function validateCarrierMatch(raw: unknown): { match: LeadgenCarrierMatch | null; error: string | null } {
  let parsed: unknown = raw;
  if (raw === undefined || raw === null) return { match: null, error: null };
  if (typeof raw === "string") {
    if (raw.trim() === "") return { match: null, error: null };
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { match: null, error: "carrier_match_json must be valid JSON" };
    }
  }
  if (!isRecord(parsed)) return { match: null, error: "carrier_match_json must be an object" };
  const match: LeadgenCarrierMatch = {};
  if (parsed["carrier_keys"] !== undefined) {
    if (!Array.isArray(parsed["carrier_keys"]) || !parsed["carrier_keys"].every((v) => typeof v === "string")) {
      return { match: null, error: "carrier_match_json.carrier_keys must be a string array" };
    }
    match.carrier_keys = parsed["carrier_keys"] as string[];
  }
  if (parsed["carrier_names"] !== undefined) {
    if (!Array.isArray(parsed["carrier_names"]) || !parsed["carrier_names"].every((v) => typeof v === "string")) {
      return { match: null, error: "carrier_match_json.carrier_names must be a string array" };
    }
    match.carrier_names = parsed["carrier_names"] as string[];
  }
  return { match, error: null };
}

// ---------------------------------------------------------------------------
// Equal-priority override conflict detection (07 §21.4 "conflicts without
// deterministic priority flagged at save"). Two ENABLED rules of the same level
// targeting the same subject at the same priority with OPPOSING action families
// conflict; when BOTH set strictly_override the conflict is HARD (neither wins
// deterministically) → a 409. Otherwise it is a soft WARNING (Stage-A
// precedence still resolves it exclude-first).
// ---------------------------------------------------------------------------

const INCLUDE_ACTIONS: ReadonlySet<LeadgenRuleAction> = new Set(["include_only", "allow_list"]);

interface RuleForConflict {
  key: string; // rule public_id (or a synthetic key for the pending rule)
  rule_level: LeadgenRuleLevel;
  target_offer_id: number | null;
  action: LeadgenRuleAction;
  priority: number;
  strictly_override: boolean;
  enabled: boolean;
  carrier_match: LeadgenCarrierMatch | null;
}

interface ConflictPair {
  rule_a: string;
  rule_b: string;
  reason: string;
}

function carrierSubject(match: LeadgenCarrierMatch | null): string {
  if (match === null) return "*";
  const keys = (match.carrier_keys ?? []).slice().sort();
  const names = (match.carrier_names ?? []).map((n) => n.trim().toLowerCase()).sort();
  return keys.length === 0 && names.length === 0 ? "*" : `k:${keys.join(",")}|n:${names.join(",")}`;
}

function detectRuleConflicts(rules: readonly RuleForConflict[]): { hard: ConflictPair[]; warnings: ConflictPair[] } {
  const active = rules.filter((r) => r.enabled);
  const hard: ConflictPair[] = [];
  const warnings: ConflictPair[] = [];
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i]!;
      const b = active[j]!;
      if (a.rule_level !== b.rule_level) continue;
      if (a.priority !== b.priority) continue; // priority is the deterministic tiebreak
      const opposing = INCLUDE_ACTIONS.has(a.action) !== INCLUDE_ACTIONS.has(b.action);
      if (!opposing) continue;
      const sameSubject =
        a.rule_level === "offer"
          ? a.target_offer_id !== null && a.target_offer_id === b.target_offer_id
          : carrierSubject(a.carrier_match) === carrierSubject(b.carrier_match);
      if (!sameSubject) continue;
      const pair: ConflictPair = {
        rule_a: a.key,
        rule_b: b.key,
        reason: `equal-priority (${a.priority}) opposing ${a.action} vs ${b.action}`,
      };
      if (a.strictly_override && b.strictly_override) hard.push(pair);
      else warnings.push(pair);
    }
  }
  return { hard, warnings };
}

async function readRulesForConflict(db: D1Database, auctionId: number): Promise<RuleForConflict[]> {
  const res = await db
    .prepare(
      "SELECT public_id, rule_level, target_offer_id, action, priority, strictly_override, enabled, carrier_match_json FROM leadgen_auction_rules WHERE auction_id = ?",
    )
    .bind(auctionId)
    .all<LeadgenAuctionRuleRow>();
  return (res.results ?? []).map((r) => ({
    key: r.public_id,
    rule_level: r.rule_level,
    target_offer_id: r.target_offer_id,
    action: r.action,
    priority: r.priority,
    strictly_override: r.strictly_override !== 0,
    enabled: r.enabled !== 0,
    carrier_match: (parseJsonColumn(r.carrier_match_json) as LeadgenCarrierMatch | null) ?? null,
  }));
}

// ---------------------------------------------------------------------------
// GET/POST/PATCH/DELETE /auctions/:id/rules — §21 offer + carrier rules
// ---------------------------------------------------------------------------

export async function listAuctionRulesHandler(c: AdminContext): Promise<Response> {
  const auction = await resolveAuctionRow(c.env.DB, c.req.param("id") ?? "");
  if (auction === null) return c.json({ error: "Not Found" }, 404);
  const level = c.req.query("rule_level")?.trim() ?? "";
  if (level !== "" && !(RULE_LEVELS as readonly string[]).includes(level)) {
    return c.json({ error: "Validation failed", fields: { rule_level: `rule_level must be one of ${RULE_LEVELS.join("|")}` } }, 400);
  }
  const filters: FilterCondition[] = [
    { when: true, clause: "auction_id = ?", params: [auction.id] },
    { when: level !== "", clause: "rule_level = ?", params: [level] },
  ];
  const { clause, params } = buildWhereClause(filters);
  const res = await c.env.DB.prepare(
    `SELECT * FROM leadgen_auction_rules WHERE ${clause} ORDER BY rule_level ASC, priority ASC, id ASC`,
  )
    .bind(...params)
    .all<LeadgenAuctionRuleRow>();
  return c.json({ items: (res.results ?? []).map(auctionRuleRowToApi) });
}

interface PreparedRule {
  rule_level: LeadgenRuleLevel;
  action: LeadgenRuleAction;
  target_offer_id: number | null;
  conditions_json: string;
  conditions_hash: string;
  carrier_match_json: string | null;
  strictly_override: number;
  priority: number;
  enabled: number;
}

// Validate a rule body into a PreparedRule (conditions_hash via Stage-A
// `conditionsHash` — the CANONICAL/stable hash, distinct from the funnel-rule
// raw-JSON sha). Offer rules need target_offer_id; carrier rules may carry
// carrier_match_json.
async function prepareRule(
  db: D1Database,
  body: Record<string, unknown>,
  base: Partial<PreparedRule> | null,
): Promise<{ errors: FieldErrors; value: PreparedRule | null }> {
  const errors: FieldErrors = {};

  let ruleLevel: LeadgenRuleLevel | null = base?.rule_level ?? null;
  if (body["rule_level"] !== undefined) {
    const raw = body["rule_level"];
    if (typeof raw !== "string" || !(RULE_LEVELS as readonly string[]).includes(raw)) {
      errors["rule_level"] = `rule_level must be one of ${RULE_LEVELS.join("|")}`;
    } else ruleLevel = raw as LeadgenRuleLevel;
  }
  if (ruleLevel === null) errors["rule_level"] = "rule_level is required";

  let action: LeadgenRuleAction | null = base?.action ?? null;
  if (body["action"] !== undefined) {
    const raw = body["action"];
    if (typeof raw !== "string" || !(RULE_ACTIONS as readonly string[]).includes(raw)) {
      errors["action"] = `action must be one of ${RULE_ACTIONS.join("|")}`;
    } else action = raw as LeadgenRuleAction;
  }
  if (action === null) errors["action"] = "action is required";

  let targetOfferId: number | null = base?.target_offer_id ?? null;
  if (body["target_offer_id"] !== undefined) {
    const parsed = asIntId(body["target_offer_id"]);
    if (parsed === INVALID) errors["target_offer_id"] = "target_offer_id must be an integer id";
    else targetOfferId = parsed;
  }

  // conditions
  let conditionsJson = base?.conditions_json ?? JSON.stringify({ groups: [] });
  let conditionsHashValue = base?.conditions_hash ?? conditionsHash({ groups: [] });
  if (body["conditions_json"] !== undefined || body["conditions"] !== undefined) {
    const rawConditions = body["conditions_json"] ?? body["conditions"];
    const { conditions, error } = validateConditions(rawConditions);
    if (error !== null) errors["conditions_json"] = error;
    else {
      conditionsJson = JSON.stringify(conditions);
      conditionsHashValue = conditionsHash(conditions);
    }
  }

  // carrier_match_json
  let carrierMatchJson: string | null = base?.carrier_match_json ?? null;
  if (body["carrier_match_json"] !== undefined || body["carrier_match"] !== undefined) {
    const rawMatch = body["carrier_match_json"] ?? body["carrier_match"];
    const { match, error } = validateCarrierMatch(rawMatch);
    if (error !== null) errors["carrier_match_json"] = error;
    else carrierMatchJson = match === null ? null : JSON.stringify(match);
  }

  let strictly = base?.strictly_override ?? 0;
  if (body["strictly_override"] !== undefined) {
    const t = asToggle(body["strictly_override"]);
    if (t === null) errors["strictly_override"] = "strictly_override must be a boolean";
    else strictly = t ? 1 : 0;
  }
  let priority = base?.priority ?? 100;
  if (body["priority"] !== undefined) {
    const raw = body["priority"];
    if (typeof raw !== "number" || !Number.isInteger(raw)) errors["priority"] = "priority must be an integer";
    else priority = raw;
  }
  let enabled = base?.enabled ?? 1;
  if (body["enabled"] !== undefined) {
    const t = asToggle(body["enabled"]);
    if (t === null) errors["enabled"] = "enabled must be a boolean";
    else enabled = t ? 1 : 0;
  }

  // level-specific structural checks
  if (ruleLevel === "offer" && action !== null) {
    if (targetOfferId === null) errors["target_offer_id"] = "offer-level rules require target_offer_id";
  }

  if (Object.keys(errors).length > 0) return { errors, value: null };

  // FK existence for target_offer_id (clean 400, not a D1 500).
  if (targetOfferId !== null && !(await checkFkExists(db, "leadgen_offers", targetOfferId))) {
    errors["target_offer_id"] = `offer ${targetOfferId} does not exist`;
    return { errors, value: null };
  }

  return {
    errors,
    value: {
      rule_level: ruleLevel as LeadgenRuleLevel,
      action: action as LeadgenRuleAction,
      target_offer_id: ruleLevel === "carrier" ? null : targetOfferId,
      conditions_json: conditionsJson,
      conditions_hash: conditionsHashValue,
      carrier_match_json: ruleLevel === "offer" ? null : carrierMatchJson,
      strictly_override: strictly,
      priority,
      enabled,
    },
  };
}

export async function createAuctionRuleHandler(c: AdminContext): Promise<Response> {
  const auction = await resolveAuctionRow(c.env.DB, c.req.param("id") ?? "");
  if (auction === null) return c.json({ error: "Not Found" }, 404);
  const body = await readJsonBody(c);
  if (body === null) return c.json({ error: "Invalid JSON body" }, 400);

  const { errors, value } = await prepareRule(c.env.DB, body, null);
  if (value === null) return c.json({ error: "Validation failed", fields: errors }, 400);

  // Conflict check against the resulting rule set (existing + this new rule).
  const existing = await readRulesForConflict(c.env.DB, auction.id);
  const pending: RuleForConflict = {
    key: "(new)",
    rule_level: value.rule_level,
    target_offer_id: value.target_offer_id,
    action: value.action,
    priority: value.priority,
    strictly_override: value.strictly_override !== 0,
    enabled: value.enabled !== 0,
    carrier_match: value.carrier_match_json !== null ? (parseJsonColumn(value.carrier_match_json) as LeadgenCarrierMatch) : null,
  };
  const { hard, warnings } = detectRuleConflicts([...existing, pending]);
  if (hard.length > 0) {
    return c.json({ error: "Rule conflict: equal-priority strictly_override rules with opposing actions", conflicts: hard }, 409);
  }

  const publicId = mintPublicId("auction_rule");
  await c.env.DB.prepare(
    `INSERT INTO leadgen_auction_rules
       (public_id, auction_id, rule_level, target_offer_id, action, conditions_json, conditions_hash,
        carrier_match_json, strictly_override, priority, enabled)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      publicId, auction.id, value.rule_level, value.target_offer_id, value.action, value.conditions_json, value.conditions_hash,
      value.carrier_match_json, value.strictly_override, value.priority, value.enabled,
    )
    .run();

  const row = await c.env.DB.prepare("SELECT * FROM leadgen_auction_rules WHERE public_id = ? LIMIT 1").bind(publicId).first<LeadgenAuctionRuleRow>();
  if (!row) return c.json({ error: "Insert failed" }, 500);
  return c.json({ ...auctionRuleRowToApi(row), warnings }, 201);
}

async function resolveRuleRow(db: D1Database, auctionId: number, ruleParam: string): Promise<LeadgenAuctionRuleRow | null> {
  const selector = idSelector("auction_rule", ruleParam);
  if (selector === null) return null;
  const sql =
    selector.column === "id"
      ? "SELECT * FROM leadgen_auction_rules WHERE id = ? AND auction_id = ? LIMIT 1"
      : "SELECT * FROM leadgen_auction_rules WHERE public_id = ? AND auction_id = ? LIMIT 1";
  const row = await db.prepare(sql).bind(selector.value, auctionId).first<LeadgenAuctionRuleRow>();
  return row ?? null;
}

export async function patchAuctionRuleHandler(c: AdminContext): Promise<Response> {
  const auction = await resolveAuctionRow(c.env.DB, c.req.param("id") ?? "");
  if (auction === null) return c.json({ error: "Not Found" }, 404);
  const existingRow = await resolveRuleRow(c.env.DB, auction.id, c.req.param("rule_id") ?? "");
  if (existingRow === null) return c.json({ error: "Not Found" }, 404);
  const body = await readJsonBody(c);
  if (body === null) return c.json({ error: "Invalid JSON body" }, 400);

  const base: Partial<PreparedRule> = {
    rule_level: existingRow.rule_level,
    action: existingRow.action,
    target_offer_id: existingRow.target_offer_id,
    conditions_json: existingRow.conditions_json,
    conditions_hash: existingRow.conditions_hash,
    carrier_match_json: existingRow.carrier_match_json,
    strictly_override: existingRow.strictly_override,
    priority: existingRow.priority,
    enabled: existingRow.enabled,
  };
  const { errors, value } = await prepareRule(c.env.DB, body, base);
  if (value === null) return c.json({ error: "Validation failed", fields: errors }, 400);

  // Conflict check against the rule set with THIS rule updated in place.
  const others = (await readRulesForConflict(c.env.DB, auction.id)).filter((r) => r.key !== existingRow.public_id);
  const pending: RuleForConflict = {
    key: existingRow.public_id,
    rule_level: value.rule_level,
    target_offer_id: value.target_offer_id,
    action: value.action,
    priority: value.priority,
    strictly_override: value.strictly_override !== 0,
    enabled: value.enabled !== 0,
    carrier_match: value.carrier_match_json !== null ? (parseJsonColumn(value.carrier_match_json) as LeadgenCarrierMatch) : null,
  };
  const { hard, warnings } = detectRuleConflicts([...others, pending]);
  if (hard.length > 0) {
    return c.json({ error: "Rule conflict: equal-priority strictly_override rules with opposing actions", conflicts: hard }, 409);
  }

  await c.env.DB.prepare(
    `UPDATE leadgen_auction_rules SET
       rule_level = ?, target_offer_id = ?, action = ?, conditions_json = ?, conditions_hash = ?,
       carrier_match_json = ?, strictly_override = ?, priority = ?, enabled = ?
     WHERE id = ?`,
  )
    .bind(
      value.rule_level, value.target_offer_id, value.action, value.conditions_json, value.conditions_hash,
      value.carrier_match_json, value.strictly_override, value.priority, value.enabled, existingRow.id,
    )
    .run();

  const updated = await c.env.DB.prepare("SELECT * FROM leadgen_auction_rules WHERE id = ? LIMIT 1").bind(existingRow.id).first<LeadgenAuctionRuleRow>();
  if (!updated) return c.json({ error: "Update failed" }, 500);
  return c.json({ ...auctionRuleRowToApi(updated), warnings });
}

export async function deleteAuctionRuleHandler(c: AdminContext): Promise<Response> {
  const auction = await resolveAuctionRow(c.env.DB, c.req.param("id") ?? "");
  if (auction === null) return c.json({ error: "Not Found" }, 404);
  const rule = await resolveRuleRow(c.env.DB, auction.id, c.req.param("rule_id") ?? "");
  if (rule === null) return c.json({ error: "Not Found" }, 404);
  // Rules are pure config (no status column in the DDL) → hard delete.
  await c.env.DB.prepare("DELETE FROM leadgen_auction_rules WHERE id = ?").bind(rule.id).run();
  return c.json({ id: rule.id, public_id: rule.public_id, deleted: true });
}

// ---------------------------------------------------------------------------
// GET/PUT /auctions/:id/banner — §20 banner builder (manual config vs automatic
// canonical-Carrier field map). Mode + field_map live in leadgen_auction_banners
// (UNIQUE(auction_id) upsert); the manual banner_config_json lives on
// leadgen_auctions.
// ---------------------------------------------------------------------------

export async function getAuctionBannerHandler(c: AdminContext): Promise<Response> {
  const auction = await resolveAuctionRow(c.env.DB, c.req.param("id") ?? "");
  if (auction === null) return c.json({ error: "Not Found" }, 404);
  const banner = await c.env.DB.prepare("SELECT * FROM leadgen_auction_banners WHERE auction_id = ? LIMIT 1")
    .bind(auction.id)
    .first<LeadgenAuctionBannerRow>();
  return c.json({
    auction_id: auction.id,
    // no banner row yet → the §20 default (automatic, empty canonical map).
    mode: banner?.mode ?? "automatic",
    field_map_json: banner ? parseJsonColumn(banner.field_map_json) : {},
    banner_config_json: parseJsonColumn(auction.banner_config_json),
  });
}

export async function putAuctionBannerHandler(c: AdminContext): Promise<Response> {
  const auction = await resolveAuctionRow(c.env.DB, c.req.param("id") ?? "");
  if (auction === null) return c.json({ error: "Not Found" }, 404);
  const body = await readJsonBody(c);
  if (body === null) return c.json({ error: "Invalid JSON body" }, 400);

  const existing = await c.env.DB.prepare("SELECT * FROM leadgen_auction_banners WHERE auction_id = ? LIMIT 1")
    .bind(auction.id)
    .first<LeadgenAuctionBannerRow>();

  const errors: FieldErrors = {};
  let mode: LeadgenBannerMode = existing?.mode ?? "automatic";
  if (body["mode"] !== undefined) {
    const raw = body["mode"];
    if (typeof raw !== "string" || !(BANNER_MODES as readonly string[]).includes(raw)) {
      errors["mode"] = `mode must be one of ${BANNER_MODES.join("|")}`;
    } else mode = raw as LeadgenBannerMode;
  }

  // field_map_json (NOT NULL in the DDL). automatic → validated canonical map;
  // manual → keep existing or default to an empty object.
  let fieldMapJson: string = existing?.field_map_json ?? "{}";
  if (mode === "automatic") {
    const rawMap = body["field_map_json"] ?? body["field_map"] ?? (existing ? parseJsonColumn(existing.field_map_json) : {});
    const validation = validateBannerFieldMap(rawMap);
    if (!validation.valid) {
      return c.json({ error: "Validation failed", fields: { field_map_json: validation.errors.join("; ") } }, 400);
    }
    fieldMapJson = JSON.stringify(validation.field_map ?? {});
  } else if (body["field_map_json"] !== undefined || body["field_map"] !== undefined) {
    // manual mode may still carry a map; if provided it must still be canonical.
    const validation = validateBannerFieldMap(body["field_map_json"] ?? body["field_map"]);
    if (!validation.valid) {
      return c.json({ error: "Validation failed", fields: { field_map_json: validation.errors.join("; ") } }, 400);
    }
    fieldMapJson = JSON.stringify(validation.field_map ?? {});
  }

  // manual banner_config_json (headline/subheadline/logo/cta/legal).
  let bannerConfigJson: string | null = auction.banner_config_json;
  if (body["banner_config_json"] !== undefined || body["banner_config"] !== undefined) {
    const rawConfig = body["banner_config_json"] ?? body["banner_config"];
    if (rawConfig === null) bannerConfigJson = null;
    else if (isRecord(rawConfig)) bannerConfigJson = JSON.stringify(rawConfig);
    else if (typeof rawConfig === "string") bannerConfigJson = jsonStringOrNull(rawConfig);
    else errors["banner_config_json"] = "banner_config_json must be an object";
  }

  if (Object.keys(errors).length > 0) return c.json({ error: "Validation failed", fields: errors }, 400);

  // Atomic: UNIQUE(auction_id) upsert on the banner row + the auction's manual
  // config column, together.
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO leadgen_auction_banners (auction_id, mode, field_map_json) VALUES (?, ?, ?)
       ON CONFLICT(auction_id) DO UPDATE SET mode = excluded.mode, field_map_json = excluded.field_map_json`,
    ).bind(auction.id, mode, fieldMapJson),
    c.env.DB.prepare("UPDATE leadgen_auctions SET banner_config_json = ?, updated_at = unixepoch() WHERE id = ?").bind(bannerConfigJson, auction.id),
  ]);

  return c.json({
    auction_id: auction.id,
    mode,
    field_map_json: parseJsonColumn(fieldMapJson),
    banner_config_json: parseJsonColumn(bannerConfigJson),
  });
}

// ---------------------------------------------------------------------------
// GET /auctions/:id/analytics — §18.9 (NULLIF ratios at read). `auctions` =
// countDistinct(auction_instance_id), mirrored to leadgen_analytics_auction;
// per-carrier from leadgen_analytics_carrier. Rate denominators: the per-auction
// base is `auctions`; carrier_ctr over carrier_impressions; avg_bid over
// eligible_bid_count; avg_rpc over carrier_clicks (documented readings of §18.9).
// ---------------------------------------------------------------------------

interface AuctionMetricRow {
  auctions: number | null;
  carrier_impressions: number | null;
  offer_impressions: number | null;
  carrier_clicks: number | null;
  revenue: number | null;
  avg_imp_per_auction: number | null;
  avg_bid: number | null;
  avg_rpc: number | null;
  avg_clicks_per_auction: number | null;
  fill_rate: number | null;
  unfilled_rate: number | null;
  timeout_rate: number | null;
  below_floor_rate: number | null;
  malformed_response_rate: number | null;
  no_bid_rate: number | null;
  carrier_ctr: number | null;
  average_latency: number | null;
  provider_error_rate: number | null;
}

interface CarrierMetricRow {
  carrier_key: string;
  carrier_name: string | null;
  offer_public_id: string;
  carrier_impressions: number | null;
  clicks: number | null;
  unique_clicks: number | null;
  conversions: number | null;
  bid_value_sum: number | null;
  revenue: number | null;
  carrier_ctr: number | null;
  avg_rpc: number | null;
}

export async function auctionAnalyticsHandler(c: AdminContext): Promise<Response> {
  const auction = await resolveAuctionRow(c.env.DB, c.req.param("id") ?? "");
  if (auction === null) return c.json({ error: "Not Found" }, 404);
  const range = parseDateRange(c);
  if ("error" in range) return c.json({ error: "Validation failed", fields: { range: range.error } }, 400);

  const metrics = await c.env.DB.prepare(
    `SELECT
       SUM(auctions) AS auctions,
       SUM(carrier_impressions) AS carrier_impressions,
       SUM(offer_impressions) AS offer_impressions,
       SUM(carrier_clicks) AS carrier_clicks,
       SUM(revenue) AS revenue,
       CAST(SUM(carrier_impressions) AS REAL) / NULLIF(SUM(auctions), 0) AS avg_imp_per_auction,
       SUM(bid_value_sum) / NULLIF(SUM(eligible_bid_count), 0) AS avg_bid,
       SUM(revenue) / NULLIF(SUM(carrier_clicks), 0) AS avg_rpc,
       CAST(SUM(carrier_clicks) AS REAL) / NULLIF(SUM(auctions), 0) AS avg_clicks_per_auction,
       CAST(SUM(filled_auctions) AS REAL) / NULLIF(SUM(auctions), 0) AS fill_rate,
       CAST(SUM(unfilled_auctions) AS REAL) / NULLIF(SUM(auctions), 0) AS unfilled_rate,
       CAST(SUM(timeouts) AS REAL) / NULLIF(SUM(auctions), 0) AS timeout_rate,
       CAST(SUM(below_floor) AS REAL) / NULLIF(SUM(auctions), 0) AS below_floor_rate,
       CAST(SUM(malformed) AS REAL) / NULLIF(SUM(auctions), 0) AS malformed_response_rate,
       CAST(SUM(no_bid) AS REAL) / NULLIF(SUM(auctions), 0) AS no_bid_rate,
       CAST(SUM(carrier_clicks) AS REAL) / NULLIF(SUM(carrier_impressions), 0) AS carrier_ctr,
       CAST(SUM(latency_ms_sum) AS REAL) / NULLIF(SUM(auctions), 0) AS average_latency,
       CAST(SUM(provider_errors) AS REAL) / NULLIF(SUM(auctions), 0) AS provider_error_rate
     FROM leadgen_analytics_auction
     WHERE auction_public_id = ? AND date BETWEEN ? AND ?`,
  )
    .bind(auction.public_id, range.from, range.to)
    .first<AuctionMetricRow>();

  const carriers = await c.env.DB.prepare(
    `SELECT carrier_key, carrier_name, offer_public_id,
       SUM(carrier_impressions) AS carrier_impressions, SUM(clicks) AS clicks, SUM(unique_clicks) AS unique_clicks,
       SUM(conversions) AS conversions, SUM(bid_value_sum) AS bid_value_sum, SUM(revenue) AS revenue,
       CAST(SUM(clicks) AS REAL) / NULLIF(SUM(carrier_impressions), 0) AS carrier_ctr,
       SUM(revenue) / NULLIF(SUM(clicks), 0) AS avg_rpc
     FROM leadgen_analytics_carrier
     WHERE auction_public_id = ? AND date BETWEEN ? AND ?
     GROUP BY carrier_key, carrier_name, offer_public_id
     ORDER BY carrier_impressions DESC, carrier_key ASC`,
  )
    .bind(auction.public_id, range.from, range.to)
    .all<CarrierMetricRow>();

  return c.json({
    analytics: {
      from: range.from,
      to: range.to,
      auctions: metrics?.auctions ?? 0,
      impressions: metrics?.carrier_impressions ?? 0,
      offer_impressions: metrics?.offer_impressions ?? 0,
      carrier_clicks: metrics?.carrier_clicks ?? 0,
      revenue: metrics?.revenue ?? 0,
      avg_imp_per_auction: metrics?.avg_imp_per_auction ?? null,
      avg_bid: metrics?.avg_bid ?? null,
      avg_rpc: metrics?.avg_rpc ?? null,
      avg_clicks_per_auction: metrics?.avg_clicks_per_auction ?? null,
      fill_rate: metrics?.fill_rate ?? null,
      unfilled_rate: metrics?.unfilled_rate ?? null,
      timeout_rate: metrics?.timeout_rate ?? null,
      below_floor_rate: metrics?.below_floor_rate ?? null,
      malformed_response_rate: metrics?.malformed_response_rate ?? null,
      no_bid_rate: metrics?.no_bid_rate ?? null,
      carrier_ctr: metrics?.carrier_ctr ?? null,
      average_latency: metrics?.average_latency ?? null,
      provider_error_rate: metrics?.provider_error_rate ?? null,
      by_carrier: (carriers.results ?? []).map((r) => ({
        carrier_key: r.carrier_key,
        carrier_name: r.carrier_name,
        offer_public_id: r.offer_public_id,
        carrier_impressions: r.carrier_impressions ?? 0,
        clicks: r.clicks ?? 0,
        unique_clicks: r.unique_clicks ?? 0,
        conversions: r.conversions ?? 0,
        bid_value_sum: r.bid_value_sum ?? 0,
        revenue: r.revenue ?? 0,
        carrier_ctr: r.carrier_ctr ?? null,
        avg_rpc: r.avg_rpc ?? null,
      })),
    },
  });
}

// ---------------------------------------------------------------------------
// POST /auctions/:id/simulate — the §19.2 dry-run explainability trace (P10).
// Runs the FULL §19 pipeline (runAuction dryRun=true) against admin-supplied
// sample answers + optional context and returns the trace: offers considered /
// excluded / requested / responded / carriers shown / carriers filtered /
// winner / banners / unfilled_reason. WRITES NOTHING — no result log, no
// provider log, no debug blob, no cap increment, no revenue (OQ-10). Provider
// requests hit STAGING endpoints (bounded, fail-open) — a bid request books no
// revenue; a dry-run never mutates state. Admin-gated by the /api/admin/* CF
// Access wall (03 §8.1). anti-tamper (§19.1) is skipped: a dry-run has no real
// client binding (the admin is trusted behind CF Access).
// ---------------------------------------------------------------------------

// Build a minimal ResolvedActivatedFunnel for the dry-run. The bound variant +
// funnel are loaded when present (so the trace carries their public ids); the
// site_quote/quote/assignment/ga4 fields are unread by runAuction in dry-run
// (anti-tamper skipped, sections replaced by the sample answers) and are typed
// stubs. sections is [] because the sample answers ARE the normalized space.
async function buildSimulateResolved(
  db: D1Database,
  auction: LeadgenAuctionRow,
): Promise<ResolvedActivatedFunnel> {
  let variant: LeadgenFunnelVariantRow | null = null;
  if (auction.funnel_variant_id !== null) {
    variant = await db
      .prepare("SELECT * FROM leadgen_funnel_variants WHERE id = ? LIMIT 1")
      .bind(auction.funnel_variant_id)
      .first<LeadgenFunnelVariantRow>();
  }
  let funnel: LeadgenFunnelRow | null = null;
  const funnelId = variant?.funnel_id ?? auction.funnel_id;
  if (funnelId !== null && funnelId !== undefined) {
    funnel = await db.prepare("SELECT * FROM leadgen_funnels WHERE id = ? LIMIT 1").bind(funnelId).first<LeadgenFunnelRow>();
  }

  const variantRow: LeadgenFunnelVariantRow = variant ?? {
    id: 0, public_id: "", funnel_id: funnel?.id ?? 0, ab_test_id: null, variant_label: "A", is_control: 1,
    traffic_allocation_bp: 10000, funnel_design_id: "default", auction_id: auction.id, lander_enabled: 0,
    lander_headline: null, lander_subheadline: null, lander_body_json: null, lander_hero_media_id: null,
    lander_hero_media_url: null, lander_cta_json: null, content_version: 1, status: "active", created_at: 0,
  };
  const funnelRow: LeadgenFunnelRow = funnel ?? {
    id: 0, public_id: "", quote_id: auction.quote_id ?? 0, funnel_name: auction.auction_name,
    active_ab_test_id: null, status: "active", created_at: 0, updated_at: 0,
  };
  const siteQuote: LeadgenSiteQuoteRow = {
    id: 0, site_id: "", quote_id: funnelRow.quote_id, enabled: 1, slug: null, settings_overrides_json: null,
    created_at: 0, updated_at: 0,
  };
  const quote: LeadgenQuoteRow = {
    id: funnelRow.quote_id, public_id: "", quote_name: "", activity: "", verticals_json: "[]",
    status: "active", created_by: null, created_at: 0, updated_at: 0,
  };
  const assignment: FunnelAssignment = {
    funnel_ab_test_id: "", funnel_ab_test_revision: 0, variant_label: variantRow.variant_label,
    traffic_allocation_bp: variantRow.traffic_allocation_bp, assignment_bucket: null, assignment_reason: "single_control",
  };
  return { site_quote: siteQuote, quote, funnel: funnelRow, variant: variantRow, sections: [], ga4_measurement_id: null, assignment };
}

export async function auctionSimulateHandler(c: AdminContext): Promise<Response> {
  const auction = await resolveAuctionRow(c.env.DB, c.req.param("id") ?? "");
  if (auction === null) return c.json({ error: "Not Found" }, 404);

  const body = await readJsonBody(c);
  const sampleAnswers =
    body !== null && typeof body["sample_answers"] === "object" && body["sample_answers"] !== null && !Array.isArray(body["sample_answers"])
      ? (body["sample_answers"] as Record<string, unknown>)
      : {};
  const context =
    body !== null && typeof body["context"] === "object" && body["context"] !== null && !Array.isArray(body["context"])
      ? (body["context"] as Record<string, unknown>)
      : {};

  const resolved = await buildSimulateResolved(c.env.DB, auction);
  const bundle = await loadAuctionBundle(c.env.DB, auction, resolved.variant.id === 0 ? null : resolved.variant.id);

  const result = await runAuction(
    c.env,
    {
      resolved,
      bundle,
      environment: "staging",
      binding: {
        funnel_variant_id: resolved.variant.public_id,
        funnel_attempt_id: "",
        section_order_hash: "",
        signed_config_token: "",
        session_id: null,
      },
      session_id: null,
      raw_answers: {},
      normalizedAnswersOverride: sampleAnswers,
      request_context: context,
      clicked: [],
    },
    { dryRun: true },
  );

  // The full §19.2 trace. WRITES NOTHING (dryRun) — persistAuctionResult is
  // never called. Provider requested/responded + carriers filtered are the
  // §19.2 join-surfaced extras (not result-log columns).
  return c.json({
    dry_run: true,
    auction_public_id: auction.public_id,
    status: result.status,
    winner: result.explain.winner,
    unfilled_reason: result.explain.unfilled_reason,
    offers_considered: result.explain.offers_considered,
    offers_excluded: result.explain.offers_excluded,
    providers_requested: result.explain.providers_requested,
    providers_responded: result.explain.providers_responded,
    carriers_shown: result.explain.carriers_shown,
    carriers_filtered: result.explain.carriers_filtered,
    banner_render_ids: result.explain.banner_render_ids,
    banners: result.banners.map((b) => ({
      slot: b.slot,
      carrier_key: b.carrier_key,
      offer_public_id: b.offer_public_id,
      source: b.source,
      bid: b.bid,
      click_url: b.click_url,
    })),
    banners_html: result.banners_html,
  });
}
