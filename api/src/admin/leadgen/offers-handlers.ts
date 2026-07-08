// LeadGen Offers admin API — the full contract 03 §8.2 Offers block (Phase-4
// Stage B1): list/create/search/read/update/archive + usage + analytics +
// cap status + payload-schema versioning (04 §10–§11). Registered from
// router.ts, so the Cloudflare Access gate + ADMIN_HOST 404 wall + no-store
// headers apply unchanged (03 §8.1).
//
// Conventions (03 §8.4/§8.5, mirroring admin/listicles):
//   success → `{ ...entity }` / `{ items, paging }`; failure → `{ error,
//   fields? }` with 4xx. Handlers map Row→API on read (INTEGER bools →
//   boolean, *_json parsed) and validate API→Row on write via the Stage-A
//   validators (src/leadgen/validation.ts). All SQL is .bind()
//   parameterized over fixed-literal table names.
//
// Contract notes carried by this module (04 §10.4 / §11.8):
//   * 03 §8.2 defines NO dedicated offers-rules route; §10.4 puts region
//     rules in the Offer editor — so `region_rules[]` (and `headers[]`)
//     ride the Offer GET/PATCH as replace-set nested collections.
//   * `placements[]` rides the same PATCH replace-set surface (03 §9.2
//     Basics "placement id" + 04 §10.1 "≥1 placement, exactly one default")
//     with one mechanical difference: leadgen_auction_offers references
//     placement rows BY NUMERIC ID (§7.4), so preserved rows (incoming
//     lgpl_ public_id) are UPDATEd in place — never delete-and-reinsert —
//     and a placement referenced by an auction refuses deletion.
//   * every payload-schema save creates the NEXT immutable version AND
//     makes it the offer's active schema (§11.8 "every save = a new
//     immutable version"); versions are never updated or deleted.
//   * the 03 §8.2 Shared `/verticals` + `/activities` endpoints live here
//     too — DISTINCT filter options unioned across the three
//     vertical/activity-carrying entities (fixed-literal reads).

import type { Context } from "hono";
import type { Env } from "../../env";
import { isPublicId, mintPublicId, type PublicIdKind } from "../../leadgen/ids";
import { readCapStatus, capExceeded } from "../../leadgen/caps";
import { validateBannerUrlTemplate, normalizeTemplate, findUnknownMacros } from "../../leadgen/macros";
import {
  inferSchemaFromExample,
  splitPayloadSchemaErrors,
  validatePayloadSchema,
  type LeadgenPayloadNode,
} from "../../leadgen/payload";
import { COMPONENT_CATALOG } from "../../public/leadgen/components/registry";
import {
  LEADGEN_BID_SOURCES,
  LEADGEN_CAP_COUNT_BY,
  LEADGEN_EXECUTION_MODES,
  LEADGEN_HEADER_VALUE_KINDS,
  LEADGEN_OFFER_TYPES,
  LEADGEN_REQUEST_METHODS,
  LEADGEN_TEST_STATUS_SUBSELECT,
  LEADGEN_TOKEN_PLACEMENTS,
  LEADGEN_TRACKING_METHODS,
  evaluateDynamicOffersEligibility,
  isAbsoluteHttpUrl,
  isValidTimezone,
  validateClientModeConstraints,
  validateOfferCapFields,
  validateOfferCreate,
  validateRegionRule,
  type FieldErrors,
  type LeadgenDynamicEligibilityVerdict,
  type LeadgenOfferTestStatus,
  type LeadgenRegionRuleCreateInput,
} from "../../leadgen/validation";
import { buildWhereClause, type FilterCondition } from "../query-filters";
import type {
  LeadgenHeaderValueKind,
  LeadgenOfferApi,
  LeadgenOfferHeaderRow,
  LeadgenOfferPayloadSchemaRow,
  LeadgenOfferPlacementRow,
  LeadgenOfferRegionRuleRow,
  LeadgenOfferRow,
  LeadgenOfferStatus,
  LeadgenPayloadSchemaSource,
} from "./db-types";

export type AdminContext = Context<{ Bindings: Env }>;

// 03 §8.4: paging shape identical to Listicles.
export interface Paging {
  page: number;
  page_size: number;
  total: number;
  has_next: boolean;
  has_prev: boolean;
}

// Mirrors the listicles pager: page >= 1, page_size 1-100 (default 25).
export function parsePaging(c: AdminContext): { page: number; pageSize: number; offset: number } {
  const pageRaw = parseInt(c.req.query("page") ?? "1", 10);
  const sizeRaw = parseInt(c.req.query("page_size") ?? "25", 10);
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
  const pageSize = Number.isFinite(sizeRaw) && sizeRaw > 0 && sizeRaw <= 100 ? sizeRaw : 25;
  return { page, pageSize, offset: (page - 1) * pageSize };
}

export function buildPaging(page: number, pageSize: number, total: number): Paging {
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
export function idSelector(
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
export function parseJsonColumn(raw: string | null): unknown {
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

export async function readJsonBody(c: AdminContext): Promise<Record<string, unknown> | null> {
  try {
    const body = (await c.req.json()) as unknown;
    if (typeof body === "object" && body !== null && !Array.isArray(body)) {
      return body as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

// Escape LIKE wildcards in user-supplied search text; every LIKE clause in
// this module pairs with ESCAPE '\'.
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

// --- small local helpers (the validation.ts private idiom) ------------------

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

const LEADGEN_OFFER_STATUSES = [
  "active",
  "paused",
  "archived",
] as const satisfies readonly LeadgenOfferStatus[];

const CONTROL_CHARS_RE = /[\u0000-\u001f\u007f]/;
// Wrangler secret names are env keys — identifier grammar keeps readEnvSecret
// lookups well-formed (§30.2: the secret NAME is what lives in D1).
const SECRET_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
// RFC 9110 token grammar for header/param names — rejects header injection
// (colons, CR/LF, spaces) at save time.
const HTTP_TOKEN_RE = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

// ---------------------------------------------------------------------------
// Row resolution + Row→API mapping (03 §8.5)
// ---------------------------------------------------------------------------

export async function resolveOfferRow(
  db: D1Database,
  idParam: string,
): Promise<LeadgenOfferRow | null> {
  const selector = idSelector("offer", idParam);
  if (selector === null) return null;
  const sql =
    selector.column === "id"
      ? "SELECT * FROM leadgen_offers WHERE id = ? LIMIT 1"
      : "SELECT * FROM leadgen_offers WHERE public_id = ? LIMIT 1";
  const row = await db.prepare(sql).bind(selector.value).first<LeadgenOfferRow>();
  return row ?? null;
}

export function offerRowToApi(row: LeadgenOfferRow): LeadgenOfferApi {
  return {
    ...row,
    calls_provider_api: row.calls_provider_api !== 0,
    cap_enabled: row.cap_enabled !== 0,
  };
}

function placementRowToApi(row: LeadgenOfferPlacementRow): Record<string, unknown> {
  return { ...row, is_default: row.is_default !== 0 };
}

function regionRuleRowToApi(row: LeadgenOfferRegionRuleRow): Record<string, unknown> {
  return {
    ...row,
    values_json: parseJsonColumn(row.values_json),
    enabled: row.enabled !== 0,
  };
}

function schemaRowToApi(row: LeadgenOfferPayloadSchemaRow): Record<string, unknown> {
  return {
    ...row,
    schema_json: parseJsonColumn(row.schema_json),
    sample_response_json: parseJsonColumn(row.sample_response_json),
    carrier_parse_json: parseJsonColumn(row.carrier_parse_json),
  };
}

export async function readOfferHeaders(db: D1Database, offerId: number): Promise<LeadgenOfferHeaderRow[]> {
  const result = await db
    .prepare(
      "SELECT id, offer_id, header_name, value_kind, value_text, created_at FROM leadgen_offer_headers WHERE offer_id = ? ORDER BY id ASC",
    )
    .bind(offerId)
    .all<LeadgenOfferHeaderRow>();
  return result.results ?? [];
}

export async function readOfferPlacements(
  db: D1Database,
  offerId: number,
): Promise<LeadgenOfferPlacementRow[]> {
  const result = await db
    .prepare(
      "SELECT * FROM leadgen_offer_placements WHERE offer_id = ? ORDER BY is_default DESC, id ASC",
    )
    .bind(offerId)
    .all<LeadgenOfferPlacementRow>();
  return result.results ?? [];
}

// fix-contract v2.4 05 §5.1 (R4): the ADDITIVE per-offer eligibility verdict
// riding the Offer GET/list responses — the SAME shared loader the auctions
// PUT warnings + the R5 activation preflight consume (never recomputed
// client-side). Live auctions run against production endpoints, so the admin
// surfaces evaluate "production". Static offers come back trivially eligible;
// the UI keys its rendering on calls_provider_api. A loader failure yields
// null (the UI renders nothing) — the read surfaces stay fail-open.
async function offerEligibilityVerdicts(
  db: D1Database,
  offerIds: readonly number[],
): Promise<Map<number, LeadgenDynamicEligibilityVerdict>> {
  const out = new Map<number, LeadgenDynamicEligibilityVerdict>();
  if (offerIds.length === 0) return out;
  try {
    const rows = await evaluateDynamicOffersEligibility(db, offerIds, "production");
    for (const [id, row] of rows) {
      out.set(id, { eligible: row.verdict.eligible, reasons: [...row.verdict.reasons] });
    }
  } catch (err) {
    /* additive read — never break the GET/list on an eligibility read error,
       but leave a diagnostic trace (m9): a silently-null verdict is
       indistinguishable from "not evaluated" in the UI. */
    console.warn("[lg-eligibility] loader failed", err instanceof Error ? err.name : String(err));
  }
  return out;
}

// §6.1 (fix-contract v2.4): the ADDITIVE `last_test_at` riding the Offer
// detail responses — MAX(created_at) over the Offer's TEST-TOOL provider-log
// rows. Scoping mirrors LEADGEN_TEST_STATUS_SUBSELECT exactly
// (auction_instance_id IS NULL — runtime auction rows never count as an
// operator Test). created_at is unixepoch seconds → ISO string; no rows →
// null. Fail-open like the eligibility loader: a read error yields null.
async function offerLastTestAt(db: D1Database, offerPublicId: string): Promise<string | null> {
  try {
    const row = await db
      .prepare(
        `SELECT MAX(created_at) AS t FROM leadgen_provider_request_log
          WHERE offer_public_id = ? AND auction_instance_id IS NULL`,
      )
      .bind(offerPublicId)
      .first<{ t: number | null }>();
    const t = row?.t;
    return typeof t === "number" && Number.isFinite(t) ? new Date(t * 1000).toISOString() : null;
  } catch (err) {
    console.warn("[lg-last-test] loader failed", err instanceof Error ? err.name : String(err));
    return null;
  }
}

// ---------------------------------------------------------------------------
// fix-contract v2.4 12 Phase-2: the ADDITIVE `builder_context` projection the
// rebuilt payload-builder UI reads off the Offer GET — the ACTIVE schema's
// parsed node list (per-node `source` included, §6.2 grouped source picker)
// plus the linked-Section internal-field inventory feeding the §6.2 "User
// answer" picker and the §6.10 condition-field dropdown.
// ---------------------------------------------------------------------------

// One answer-emitting component of a Section linked to the Offer (via
// leadgen_section_available_offers). The pinned builder_context row projects
// {internal_field, section_public_id, section_name, answer_type,
// choice_count}; the extra component fields feed the B4 sample-answer
// generator (payload-builder-handlers.ts) so both surfaces read ONE loader.
export interface LeadgenLinkedSectionField {
  internal_field: string;
  section_public_id: string;
  section_name: string;
  answer_type: string;
  choice_count: number;
  component_type: string;
  choices: Array<{ value: string | number | boolean; label: string }>;
  props: Record<string, unknown>;
}

function isChoicePrimitive(value: unknown): value is string | number | boolean {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

// Enumerate the answer fields of every Section linked to the Offer: parse
// each linked Section's content_json and keep the components carrying a
// non-empty internal_field (the countQuestions convention — multi-field
// components like NameFieldsGroup/AddressAutocompleteQuestion expose no
// single internal_field and are outside the §6.2 single-field picker).
// answer_type falls back to the catalog's `produces` when the node omits it.
// ONE query via the join (a single bound param — no IN() list, trivially
// inside the 100-binding limit); rows ordered by section_name for a
// deterministic picker; per-Section duplicate internal_fields keep the first.
export async function readLinkedSectionFields(
  db: D1Database,
  offerId: number,
): Promise<LeadgenLinkedSectionField[]> {
  const sections = await db
    .prepare(
      `SELECT s.public_id, s.section_name, s.content_json
       FROM leadgen_section_available_offers sao
       JOIN leadgen_sections s ON s.id = sao.section_id
       WHERE sao.offer_id = ?
       ORDER BY s.section_name ASC, s.id ASC`,
    )
    .bind(offerId)
    .all<{ public_id: string; section_name: string; content_json: string }>();

  const out: LeadgenLinkedSectionField[] = [];
  for (const section of sections.results ?? []) {
    const parsed = parseJsonColumn(section.content_json);
    if (!isRecord(parsed) || !Array.isArray(parsed["components"])) continue;
    const seen = new Set<string>();
    for (const raw of parsed["components"]) {
      if (!isRecord(raw)) continue;
      const internalField = raw["internal_field"];
      if (typeof internalField !== "string" || internalField.trim() === "") continue;
      if (seen.has(internalField)) continue;
      seen.add(internalField);
      const componentType = typeof raw["type"] === "string" ? raw["type"] : "";
      const catalogProduces = Object.prototype.hasOwnProperty.call(COMPONENT_CATALOG, componentType)
        ? COMPONENT_CATALOG[componentType as keyof typeof COMPONENT_CATALOG].produces
        : null;
      const answerType =
        typeof raw["answer_type"] === "string" && raw["answer_type"] !== ""
          ? raw["answer_type"]
          : (catalogProduces ?? "string");
      const choices: Array<{ value: string | number | boolean; label: string }> = [];
      if (Array.isArray(raw["choices"])) {
        for (const choice of raw["choices"]) {
          if (!isRecord(choice) || !isChoicePrimitive(choice["value"])) continue;
          choices.push({
            value: choice["value"],
            label: typeof choice["label"] === "string" ? choice["label"] : String(choice["value"]),
          });
        }
      }
      out.push({
        internal_field: internalField,
        section_public_id: section.public_id,
        section_name: section.section_name,
        answer_type: answerType,
        choice_count: choices.length,
        component_type: componentType,
        choices,
        props: isRecord(raw["props"]) ? (raw["props"] as Record<string, unknown>) : {},
      });
    }
  }
  return out;
}

// The ACTIVE schema's parsed node list (defensive: an unreadable stored
// schema yields nodes:[] — the B7 gates own error surfacing, this projection
// only feeds the tree/editor).
async function offerBuilderContext(
  db: D1Database,
  row: LeadgenOfferRow,
): Promise<Record<string, unknown>> {
  let activeSchema: Record<string, unknown> | null = null;
  if (row.active_payload_schema_id !== null) {
    const schemaRow = await db
      .prepare(
        "SELECT id, public_id, version, schema_json FROM leadgen_offer_payload_schemas WHERE id = ? LIMIT 1",
      )
      .bind(row.active_payload_schema_id)
      .first<{ id: number; public_id: string; version: number; schema_json: string }>();
    if (schemaRow) {
      const parsed = parseJsonColumn(schemaRow.schema_json);
      const nodes: LeadgenPayloadNode[] =
        isRecord(parsed) && isRecord(parsed["root"]) && Array.isArray(parsed["root"]["children"])
          ? (parsed["root"]["children"].filter(isRecord) as unknown as LeadgenPayloadNode[])
          : [];
      activeSchema = {
        id: schemaRow.id,
        public_id: schemaRow.public_id,
        version: schemaRow.version,
        nodes,
      };
    }
  }
  const linkedFields = await readLinkedSectionFields(db, row.id);
  return {
    active_schema: activeSchema,
    linked_fields: linkedFields.map((f) => ({
      internal_field: f.internal_field,
      section_public_id: f.section_public_id,
      section_name: f.section_name,
      answer_type: f.answer_type,
      choice_count: f.choice_count,
      // §6.10 (F-1): the field's Section choices ({label, value}) ride the
      // projection so the condition-value input can render a typed dropdown /
      // chips entry for enum fields. Additive — readLinkedSectionFields
      // already collected them; the projection just stopped dropping them.
      choices: f.choices,
    })),
  };
}

// The Offer detail shape: the mapped API row + its three editor collections
// (placements seed with the offer, §10.1, and ride the PATCH replace-set;
// headers + region rules ride the editor tabs, §10.4/§11.3 — no dedicated
// routes in 03 §8.2) + the additive 05 §5.1 `eligibility` verdict + the
// additive Phase-2 `builder_context` projection (above) + the additive §6.1
// `last_test_at` timestamp.
async function offerDetailJson(
  db: D1Database,
  row: LeadgenOfferRow,
): Promise<Record<string, unknown>> {
  const placements = await readOfferPlacements(db, row.id);
  const headers = await readOfferHeaders(db, row.id);
  const rules = await db
    .prepare(
      "SELECT * FROM leadgen_offer_region_rules WHERE offer_id = ? ORDER BY priority ASC, id ASC",
    )
    .bind(row.id)
    .all<LeadgenOfferRegionRuleRow>();
  const eligibility = await offerEligibilityVerdicts(db, [row.id]);
  return {
    ...offerRowToApi(row),
    placements: placements.map(placementRowToApi),
    headers,
    region_rules: (rules.results ?? []).map(regionRuleRowToApi),
    eligibility: eligibility.get(row.id) ?? null,
    builder_context: await offerBuilderContext(db, row),
    last_test_at: await offerLastTestAt(db, row.public_id),
  };
}

// ---------------------------------------------------------------------------
// GET /offers — list + the 7 §8.2/§9.2 filters + pager
// ---------------------------------------------------------------------------

// The list row carries the DEFAULT placement (LEFT JOIN on the §7.1 partial
// unique index) so the §9.2 "placement id" column renders without an N+1,
// plus the F5 (07 §7.1) per-row Test-status chip value (correlated subselect
// — still ONE query for the whole page).
type LeadgenOfferListRow = LeadgenOfferRow & {
  default_placement_id: string | null;
  default_placement_public_id: string | null;
  test_status: LeadgenOfferTestStatus | null;
};

export async function listOffersHandler(c: AdminContext): Promise<Response> {
  const search = c.req.query("search")?.trim() ?? "";
  const provider = c.req.query("provider")?.trim() ?? "";
  const vertical = c.req.query("vertical")?.trim() ?? "";
  const activity = c.req.query("activity")?.trim() ?? "";
  const status = c.req.query("status")?.trim() ?? "";
  const offerType = c.req.query("offer_type")?.trim() ?? "";
  const dynamicRaw = c.req.query("dynamic")?.trim() ?? "";

  if (status !== "" && !(LEADGEN_OFFER_STATUSES as readonly string[]).includes(status)) {
    return c.json(
      {
        error: "Validation failed",
        fields: { status: `status must be one of ${LEADGEN_OFFER_STATUSES.join("|")}` },
      },
      400,
    );
  }
  if (offerType !== "" && !(LEADGEN_OFFER_TYPES as readonly string[]).includes(offerType)) {
    return c.json(
      {
        error: "Validation failed",
        fields: { offer_type: `offer_type must be one of ${LEADGEN_OFFER_TYPES.join("|")}` },
      },
      400,
    );
  }
  // §8.2 `dynamic` filter maps onto the calls_provider_api flag (§10.2).
  let dynamicFlag: number | null = null;
  if (dynamicRaw !== "") {
    if (dynamicRaw === "1" || dynamicRaw === "true") dynamicFlag = 1;
    else if (dynamicRaw === "0" || dynamicRaw === "false") dynamicFlag = 0;
    else {
      return c.json(
        { error: "Validation failed", fields: { dynamic: "dynamic must be one of 1|0|true|false" } },
        400,
      );
    }
  }

  const like = `%${escapeLike(search)}%`;
  const filters: FilterCondition[] = [
    {
      when: search !== "",
      clause:
        "(offer_name LIKE ? ESCAPE '\\' OR provider LIKE ? ESCAPE '\\' OR vertical LIKE ? ESCAPE '\\' OR activity LIKE ? ESCAPE '\\')",
      params: [like, like, like, like],
    },
    { when: provider !== "", clause: "provider = ?", params: [provider] },
    { when: vertical !== "", clause: "vertical = ?", params: [vertical] },
    { when: activity !== "", clause: "activity = ?", params: [activity] },
    { when: status !== "", clause: "status = ?", params: [status] },
    { when: offerType !== "", clause: "offer_type = ?", params: [offerType] },
    {
      when: dynamicFlag !== null,
      clause: "calls_provider_api = ?",
      params: [dynamicFlag ?? 0],
    },
  ];
  const { clause, params } = buildWhereClause(filters);
  const { page, pageSize, offset } = parsePaging(c);

  const rows = await c.env.DB.prepare(
    `SELECT o.*, dp.placement_id AS default_placement_id, dp.public_id AS default_placement_public_id,
            ${LEADGEN_TEST_STATUS_SUBSELECT} AS test_status
     FROM leadgen_offers o
     LEFT JOIN leadgen_offer_placements dp ON dp.offer_id = o.id AND dp.is_default = 1
     WHERE ${clause} ORDER BY o.updated_at DESC, o.id DESC LIMIT ? OFFSET ?`,
  )
    .bind(...params, pageSize, offset)
    .all<LeadgenOfferListRow>();
  const totalRow = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM leadgen_offers WHERE ${clause}`)
    .bind(...params)
    .first<{ n: number }>();
  const total = Number(totalRow?.n ?? 0);

  // 05 §5.1: one chunked eligibility read for the whole page (additive field
  // on every item — the §9.2 list badge column is server-verdict-driven).
  const pageRows = rows.results ?? [];
  const eligibility = await offerEligibilityVerdicts(
    c.env.DB,
    pageRows.map((row) => row.id),
  );

  return c.json({
    items: pageRows.map((row) => ({
      ...offerRowToApi(row),
      default_placement_id: row.default_placement_id ?? null,
      default_placement_public_id: row.default_placement_public_id ?? null,
      eligibility: eligibility.get(row.id) ?? null,
      // F5 (07 §7.1): the additive Test-status chip value — the canonical
      // LEADGEN_TEST_STATUS_SUBSELECT derivation (newest TEST-TOOL run:
      // 2xx → passed, non-2xx → failed); no rows → untested.
      test_status: (row.test_status ?? "untested") as LeadgenOfferTestStatus,
    })),
    paging: buildPaging(page, pageSize, total),
  });
}

// ---------------------------------------------------------------------------
// POST /offers — the §10.1 create modal
// ---------------------------------------------------------------------------

// Creates the §10.1 draft Offer + its default placement ATOMICALLY (one D1
// batch). "Draft" is lifecycle prose, not a status enum value — the §7.1 DDL
// deliberately models draft only for quotes; the offer takes the DDL default
// status ('active') and stays out of live auctions through the §11.8 publish
// gate / static-completeness checks until it is actually configured. The
// FIRST placement in the request becomes the default (is_default=1,
// satisfying uq_leadgen_offerplacement_default).
export async function createOfferHandler(c: AdminContext): Promise<Response> {
  const body = await readJsonBody(c);
  if (body === null) return c.json({ error: "Invalid JSON body" }, 400);

  const { errors, value } = validateOfferCreate(body);
  if (value === null) return c.json({ error: "Validation failed", fields: errors }, 400);

  const publicId = mintPublicId("offer");
  const statements = [
    c.env.DB.prepare(
      `INSERT INTO leadgen_offers
         (public_id, offer_name, provider, activity, vertical, tag,
          conversion_tracking_method, offer_type, calls_provider_api, bid_source,
          static_bid_value, static_bid_currency, static_order, cap_enabled, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      publicId,
      value.offer_name,
      value.provider,
      value.activity,
      value.vertical,
      value.tag,
      value.conversion_tracking_method,
      value.offer_type,
      value.calls_provider_api ? 1 : 0,
      value.bid_source,
      value.static_bid_value,
      value.static_bid_currency,
      value.static_order,
      value.cap_enabled ? 1 : 0,
      null,
    ),
    ...value.placements.map((placementId, index) =>
      c.env.DB.prepare(
        `INSERT INTO leadgen_offer_placements (public_id, offer_id, placement_id, is_default)
         VALUES (?, (SELECT id FROM leadgen_offers WHERE public_id = ?), ?, ?)`,
      ).bind(mintPublicId("offer_placement"), publicId, placementId, index === 0 ? 1 : 0),
    ),
  ];
  await c.env.DB.batch(statements);

  const row = await c.env.DB.prepare("SELECT * FROM leadgen_offers WHERE public_id = ? LIMIT 1")
    .bind(publicId)
    .first<LeadgenOfferRow>();
  if (!row) return c.json({ error: "Insert failed" }, 500);
  return c.json(await offerDetailJson(c.env.DB, row), 201);
}

// ---------------------------------------------------------------------------
// GET /offers/search — typeahead (03 §8.2; registered BEFORE /offers/:id)
// ---------------------------------------------------------------------------

// Section/Auction picker feed: ACTIVE offers only, name-matched, filtered by
// activity + vertical, alphabetical, ≤ 20 rows.
export async function searchOffersHandler(c: AdminContext): Promise<Response> {
  const q = c.req.query("q")?.trim() ?? "";
  const activity = c.req.query("activity")?.trim() ?? "";
  const vertical = c.req.query("vertical")?.trim() ?? "";

  const like = `%${escapeLike(q)}%`;
  const filters: FilterCondition[] = [
    { when: true, clause: "status = 'active'", params: [] },
    { when: q !== "", clause: "offer_name LIKE ? ESCAPE '\\'", params: [like] },
    { when: activity !== "", clause: "activity = ?", params: [activity] },
    { when: vertical !== "", clause: "vertical = ?", params: [vertical] },
  ];
  const { clause, params } = buildWhereClause(filters);
  const rows = await c.env.DB.prepare(
    `SELECT id, public_id, offer_name, provider, activity, vertical, offer_type,
            calls_provider_api, bid_source, status
     FROM leadgen_offers WHERE ${clause}
     ORDER BY offer_name ASC, id ASC LIMIT 20`,
  )
    .bind(...params)
    .all<
      Pick<
        LeadgenOfferRow,
        | "id"
        | "public_id"
        | "offer_name"
        | "provider"
        | "activity"
        | "vertical"
        | "offer_type"
        | "calls_provider_api"
        | "bid_source"
        | "status"
      >
    >();
  return c.json({
    items: (rows.results ?? []).map((row) => ({
      ...row,
      calls_provider_api: row.calls_provider_api !== 0,
    })),
    q,
  });
}

// ---------------------------------------------------------------------------
// GET /offers/:id — detail (+ placements, headers, region_rules)
// ---------------------------------------------------------------------------

export async function getOfferHandler(c: AdminContext): Promise<Response> {
  const row = await resolveOfferRow(c.env.DB, c.req.param("id") ?? "");
  if (row === null) return c.json({ error: "Not Found" }, 404);
  return c.json(await offerDetailJson(c.env.DB, row));
}

// ---------------------------------------------------------------------------
// PATCH /offers/:id — partial update + nested replace-set collections
// ---------------------------------------------------------------------------

// Allow-listed §7.1 scalar columns. active_payload_schema_id is deliberately
// absent — the schema pointer moves ONLY through the payload-schemas POST
// path (§11.8). Placements are a nested replace-set (like headers /
// region_rules), not a scalar column.
const OFFER_PATCH_COLUMNS = [
  "offer_name",
  "provider",
  "activity",
  "vertical",
  "tag",
  "conversion_tracking_method",
  "offer_type",
  "calls_provider_api",
  "bid_source",
  "request_execution_mode",
  "static_bid_value",
  "static_bid_currency",
  "static_order",
  "banner_url_template",
  "static_fallback_banner_url",
  "request_method",
  "endpoint_production",
  "endpoint_staging",
  "api_token_secret_ref",
  "api_token_placement",
  "api_token_param_name",
  "cap_enabled",
  "cap_amount",
  "cap_timezone",
  "cap_count_by",
  "cap_fallback_offer_id",
  "cap_fallback_url",
  "status",
] as const;

interface HeaderInput {
  header_name: string;
  value_kind: LeadgenHeaderValueKind;
  value_text: string;
}

interface RegionRuleInput {
  public_id: string | null;
  value: LeadgenRegionRuleCreateInput;
}

interface PlacementInput {
  public_id: string | null;
  placement_id: string;
  label: string | null;
  is_default: boolean;
}

// Validate the provided scalar PATCH fields into a column→value map. Enum /
// type / URL / template guards run per field; merged-state rules (flag combo,
// cap coherence, client mode) run in the handler over the merge result.
function collectScalarUpdates(body: Record<string, unknown>, errors: FieldErrors): Map<string, unknown> {
  const updates = new Map<string, unknown>();

  for (const key of ["offer_name", "activity", "vertical"] as const) {
    if (body[key] === undefined) continue;
    const v = trimmedString(body[key]);
    if (v === null) errors[key] = `${key} must be a non-empty string`;
    else updates.set(key, v);
  }

  for (const key of ["provider", "tag", "static_bid_currency"] as const) {
    if (body[key] === undefined) continue;
    if (body[key] === null) {
      updates.set(key, null);
      continue;
    }
    const v = trimmedString(body[key]);
    if (v === null) errors[key] = `${key} must be a non-empty string or null`;
    else updates.set(key, v);
  }

  const enums: ReadonlyArray<{ key: string; allowed: readonly string[]; nullable: boolean }> = [
    { key: "conversion_tracking_method", allowed: LEADGEN_TRACKING_METHODS, nullable: false },
    { key: "offer_type", allowed: LEADGEN_OFFER_TYPES, nullable: false },
    { key: "bid_source", allowed: LEADGEN_BID_SOURCES, nullable: false },
    { key: "request_execution_mode", allowed: LEADGEN_EXECUTION_MODES, nullable: false },
    { key: "status", allowed: LEADGEN_OFFER_STATUSES, nullable: false },
    { key: "request_method", allowed: LEADGEN_REQUEST_METHODS, nullable: true },
    { key: "api_token_placement", allowed: LEADGEN_TOKEN_PLACEMENTS, nullable: true },
    { key: "cap_count_by", allowed: LEADGEN_CAP_COUNT_BY, nullable: true },
  ];
  for (const { key, allowed, nullable } of enums) {
    if (body[key] === undefined) continue;
    if (body[key] === null && nullable) {
      updates.set(key, null);
      continue;
    }
    const v = body[key];
    if (typeof v !== "string" || !allowed.includes(v)) {
      errors[key] = `${key} must be one of ${allowed.join("|")}`;
    } else {
      updates.set(key, v);
    }
  }

  for (const key of ["calls_provider_api", "cap_enabled"] as const) {
    if (body[key] === undefined) continue;
    const toggled = asToggle(body[key]);
    if (toggled === null) errors[key] = `${key} must be a boolean`;
    else updates.set(key, toggled ? 1 : 0);
  }

  if (body["static_bid_value"] !== undefined) {
    const v = body["static_bid_value"];
    if (v === null) updates.set("static_bid_value", null);
    else if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) {
      errors["static_bid_value"] = "static_bid_value must be a positive number";
    } else updates.set("static_bid_value", v);
  }
  for (const key of ["static_order", "cap_amount", "cap_fallback_offer_id"] as const) {
    if (body[key] === undefined) continue;
    const v = body[key];
    if (v === null) {
      updates.set(key, null);
      continue;
    }
    if (typeof v !== "number" || !Number.isInteger(v)) {
      errors[key] = `${key} must be an integer`;
    } else if ((key === "cap_amount" || key === "cap_fallback_offer_id") && v <= 0) {
      errors[key] = `${key} must be a positive integer`;
    } else {
      updates.set(key, v);
    }
  }

  // §10.5 template guards run at SAVE; the persisted value is the
  // alias-normalized template.
  if (body["banner_url_template"] !== undefined) {
    const v = body["banner_url_template"];
    if (v === null) updates.set("banner_url_template", null);
    else if (typeof v !== "string") {
      errors["banner_url_template"] = "banner_url_template must be a string";
    } else {
      const verdict = validateBannerUrlTemplate(v);
      if (!verdict.ok) {
        errors["banner_url_template"] = verdict.errors[0]?.message ?? "banner_url_template is invalid";
      } else {
        updates.set("banner_url_template", verdict.normalized);
      }
    }
  }

  for (const key of [
    "static_fallback_banner_url",
    "endpoint_production",
    "endpoint_staging",
    "cap_fallback_url",
  ] as const) {
    if (body[key] === undefined) continue;
    if (body[key] === null) {
      updates.set(key, null);
      continue;
    }
    const v = trimmedString(body[key]);
    if (v === null || !isAbsoluteHttpUrl(v)) {
      errors[key] = `${key} must be an absolute http(s) URL`;
    } else {
      updates.set(key, v);
    }
  }

  if (body["api_token_secret_ref"] !== undefined) {
    const v = body["api_token_secret_ref"];
    if (v === null) updates.set("api_token_secret_ref", null);
    else {
      const name = trimmedString(v);
      if (name === null || !SECRET_NAME_RE.test(name)) {
        errors["api_token_secret_ref"] = "api_token_secret_ref must be a wrangler secret name";
      } else {
        updates.set("api_token_secret_ref", name);
      }
    }
  }
  if (body["api_token_param_name"] !== undefined) {
    const v = body["api_token_param_name"];
    if (v === null) updates.set("api_token_param_name", null);
    else {
      const name = trimmedString(v);
      if (name === null || !HTTP_TOKEN_RE.test(name)) {
        errors["api_token_param_name"] = "api_token_param_name must be a header/param token";
      } else {
        updates.set("api_token_param_name", name);
      }
    }
  }
  if (body["cap_timezone"] !== undefined) {
    const v = body["cap_timezone"];
    if (v === null) updates.set("cap_timezone", null);
    else {
      const tz = trimmedString(v);
      if (tz === null || !isValidTimezone(tz)) {
        errors["cap_timezone"] = "cap_timezone must be a valid IANA timezone";
      } else {
        updates.set("cap_timezone", tz);
      }
    }
  }

  return updates;
}

// §11.3 headers: value_kind static|macro|secret_ref. secret_ref rows store
// the secret NAME only (§30.2); macro rows store an alias-normalized
// template validated against the canonical registry; every value is
// control-char-free (header injection is a save error).
function collectHeaderInputs(raw: unknown, errors: FieldErrors): HeaderInput[] | null {
  if (!Array.isArray(raw)) {
    errors["headers"] = "headers must be an array";
    return null;
  }
  const out: HeaderInput[] = [];
  const seen = new Set<string>();
  raw.forEach((item, index) => {
    if (!isRecord(item)) {
      errors[`headers[${index}]`] = "header must be an object";
      return;
    }
    const name = trimmedString(item["header_name"]);
    if (name === null || !HTTP_TOKEN_RE.test(name)) {
      errors[`headers[${index}].header_name`] = "header_name must be an HTTP header token";
      return;
    }
    if (seen.has(name.toLowerCase())) {
      errors[`headers[${index}].header_name`] = `duplicate header '${name}'`;
      return;
    }
    seen.add(name.toLowerCase());
    const kind = item["value_kind"];
    if (typeof kind !== "string" || !(LEADGEN_HEADER_VALUE_KINDS as readonly string[]).includes(kind)) {
      errors[`headers[${index}].value_kind`] =
        `value_kind must be one of ${LEADGEN_HEADER_VALUE_KINDS.join("|")}`;
      return;
    }
    const valueKind = kind as LeadgenHeaderValueKind;
    const rawValue = item["value_text"];
    if (typeof rawValue !== "string" || rawValue.trim() === "") {
      errors[`headers[${index}].value_text`] = "value_text is required";
      return;
    }
    if (CONTROL_CHARS_RE.test(rawValue)) {
      errors[`headers[${index}].value_text`] = "value_text must not contain control characters";
      return;
    }
    let valueText = rawValue;
    if (valueKind === "macro") {
      valueText = normalizeTemplate(rawValue);
      const unknown = findUnknownMacros(valueText);
      if (unknown.length > 0) {
        errors[`headers[${index}].value_text`] = `unknown macro {${unknown[0]}}`;
        return;
      }
    }
    if (valueKind === "secret_ref" && !SECRET_NAME_RE.test(rawValue.trim())) {
      errors[`headers[${index}].value_text`] = "secret_ref value_text must be a wrangler secret name";
      return;
    }
    out.push({
      header_name: name,
      value_kind: valueKind,
      value_text: valueKind === "secret_ref" ? rawValue.trim() : valueText,
    });
  });
  return out;
}

// §10.4 region rules (replace-set): validated by the Stage-A validator; an
// incoming row may carry its existing lgrr_ public_id (preserved across the
// replace), new rows mint a fresh one at write.
function collectRegionRuleInputs(raw: unknown, errors: FieldErrors): RegionRuleInput[] | null {
  if (!Array.isArray(raw)) {
    errors["region_rules"] = "region_rules must be an array";
    return null;
  }
  const out: RegionRuleInput[] = [];
  raw.forEach((item, index) => {
    const { errors: ruleErrors, value } = validateRegionRule(item);
    if (value === null) {
      for (const [field, message] of Object.entries(ruleErrors)) {
        errors[`region_rules[${index}].${field}`] = message;
      }
      return;
    }
    let publicId: string | null = null;
    if (isRecord(item) && item["public_id"] !== undefined && item["public_id"] !== null) {
      const provided = item["public_id"];
      if (typeof provided !== "string" || !isPublicId("offer_region_rule", provided)) {
        errors[`region_rules[${index}].public_id`] = "public_id must be an lgrr_ public id";
        return;
      }
      publicId = provided;
    }
    out.push({ public_id: publicId, value });
  });
  return out;
}

// §10.1 placements (replace-set): rows carrying an existing lgpl_ public_id
// are PRESERVED (updated in place — auctions reference the numeric row id,
// §7.4); rows without one mint a fresh lgpl_ at write. Set-level §10.1/§7.1
// invariants enforced here: ≥1 placement, EXACTLY one default
// (uq_leadgen_offerplacement_default), no duplicate placement_id
// (UNIQUE(offer_id, placement_id)).
function collectPlacementInputs(raw: unknown, errors: FieldErrors): PlacementInput[] | null {
  if (!Array.isArray(raw)) {
    errors["placements"] = "placements must be an array";
    return null;
  }
  if (raw.length === 0) {
    errors["placements"] = "at least one placement is required";
    return null;
  }
  const out: PlacementInput[] = [];
  const seenPlacementIds = new Set<string>();
  const seenPublicIds = new Set<string>();
  raw.forEach((item, index) => {
    if (!isRecord(item)) {
      errors[`placements[${index}]`] = "placement must be an object";
      return;
    }
    const placementId = trimmedString(item["placement_id"]);
    if (placementId === null) {
      errors[`placements[${index}].placement_id`] = "placement_id must be a non-empty string";
      return;
    }
    if (seenPlacementIds.has(placementId)) {
      errors[`placements[${index}].placement_id`] = `duplicate placement_id '${placementId}'`;
      return;
    }
    seenPlacementIds.add(placementId);
    let label: string | null = null;
    if (item["label"] !== undefined && item["label"] !== null) {
      if (typeof item["label"] !== "string") {
        errors[`placements[${index}].label`] = "label must be a string or null";
        return;
      }
      const trimmed = item["label"].trim();
      label = trimmed === "" ? null : trimmed;
    }
    let isDefault = false;
    if (item["is_default"] !== undefined) {
      const toggled = asToggle(item["is_default"]);
      if (toggled === null) {
        errors[`placements[${index}].is_default`] = "is_default must be a boolean";
        return;
      }
      isDefault = toggled;
    }
    let publicId: string | null = null;
    if (item["public_id"] !== undefined && item["public_id"] !== null) {
      const provided = item["public_id"];
      if (typeof provided !== "string" || !isPublicId("offer_placement", provided)) {
        errors[`placements[${index}].public_id`] = "public_id must be an lgpl_ public id";
        return;
      }
      if (seenPublicIds.has(provided)) {
        errors[`placements[${index}].public_id`] = "duplicate placement public_id";
        return;
      }
      seenPublicIds.add(provided);
      publicId = provided;
    }
    out.push({ public_id: publicId, placement_id: placementId, label, is_default: isDefault });
  });
  // Enforce the default-count invariant only once every row parsed — a row
  // error already explains the failure, and a partial count would mislead.
  if (out.length === raw.length) {
    const defaults = out.filter((p) => p.is_default).length;
    if (defaults !== 1) {
      errors["placements"] = `exactly one placement must be the default (got ${defaults})`;
    }
  }
  return out;
}

function mergedNumber(
  existing: LeadgenOfferRow,
  updates: Map<string, unknown>,
  key: "calls_provider_api" | "cap_enabled",
): number {
  return (updates.has(key) ? updates.get(key) : existing[key]) as number;
}

function mergedField<K extends keyof LeadgenOfferRow>(
  existing: LeadgenOfferRow,
  updates: Map<string, unknown>,
  key: K,
): LeadgenOfferRow[K] {
  return (updates.has(key) ? updates.get(key) : existing[key]) as LeadgenOfferRow[K];
}

// Merge-then-revalidate (listicles pattern): a partial update can never
// break a merged-state rule — §10.2 flag combo, §10.6 cap coherence, §10.3
// client-mode secret bans (checked against the EFFECTIVE header set: the
// incoming replace-set when provided, else the stored rows).
export async function patchOfferHandler(c: AdminContext): Promise<Response> {
  const existing = await resolveOfferRow(c.env.DB, c.req.param("id") ?? "");
  if (existing === null) return c.json({ error: "Not Found" }, 404);

  const body = await readJsonBody(c);
  if (body === null) return c.json({ error: "Invalid JSON body" }, 400);

  const errors: FieldErrors = {};
  const updates = collectScalarUpdates(body, errors);
  const headerInputs = body["headers"] !== undefined ? collectHeaderInputs(body["headers"], errors) : null;
  const ruleInputs =
    body["region_rules"] !== undefined ? collectRegionRuleInputs(body["region_rules"], errors) : null;
  const placementInputs =
    body["placements"] !== undefined ? collectPlacementInputs(body["placements"], errors) : null;

  const unknownScalars = Object.keys(body).filter(
    (key) =>
      key !== "headers" &&
      key !== "region_rules" &&
      key !== "placements" &&
      !(OFFER_PATCH_COLUMNS as readonly string[]).includes(key),
  );
  for (const key of unknownScalars) errors[key] = `${key} is not an updatable field`;
  // "Nothing to do" is judged on what was PROVIDED, not on what validated —
  // a provided-but-invalid field must surface its field error, never this.
  const providedAnything =
    body["headers"] !== undefined ||
    body["region_rules"] !== undefined ||
    body["placements"] !== undefined ||
    (OFFER_PATCH_COLUMNS as readonly string[]).some((key) => body[key] !== undefined);
  if (!providedAnything && unknownScalars.length === 0) {
    return c.json({ error: "No updatable fields provided" }, 400);
  }

  // --- merged-state rules ----------------------------------------------
  const mergedCalls = mergedNumber(existing, updates, "calls_provider_api");
  const mergedBidSource = mergedField(existing, updates, "bid_source");
  if (mergedCalls === 0 && mergedBidSource === "response" && errors["bid_source"] === undefined) {
    // §10.2: the three legal kinds are (0,static), (1,static), (1,response).
    errors["bid_source"] = "bid_source 'response' requires calls_provider_api";
  }

  const capErrors = validateOfferCapFields({
    cap_enabled: mergedNumber(existing, updates, "cap_enabled"),
    cap_amount: mergedField(existing, updates, "cap_amount"),
    cap_timezone: mergedField(existing, updates, "cap_timezone"),
    cap_count_by: mergedField(existing, updates, "cap_count_by"),
    cap_fallback_offer_id: mergedField(existing, updates, "cap_fallback_offer_id"),
    cap_fallback_url: mergedField(existing, updates, "cap_fallback_url"),
  });
  for (const [field, message] of Object.entries(capErrors)) {
    if (errors[field] === undefined) errors[field] = message;
  }

  // §10.3: client-mode Offers may never reference a secret; endpoints must
  // be https. The check sees the EFFECTIVE headers after this PATCH.
  const mergedExecutionMode = mergedField(existing, updates, "request_execution_mode");
  if (mergedExecutionMode === "client") {
    const effectiveHeaders =
      headerInputs !== null
        ? headerInputs
        : (await readOfferHeaders(c.env.DB, existing.id)).map((row) => ({
            header_name: row.header_name,
            value_kind: row.value_kind,
          }));
    const clientErrors = validateClientModeConstraints(
      {
        request_execution_mode: mergedExecutionMode,
        api_token_secret_ref: mergedField(existing, updates, "api_token_secret_ref"),
        endpoint_production: mergedField(existing, updates, "endpoint_production"),
        endpoint_staging: mergedField(existing, updates, "endpoint_staging"),
      },
      effectiveHeaders,
    );
    for (const [field, message] of Object.entries(clientErrors)) {
      if (errors[field] === undefined) errors[field] = message;
    }
  }

  const mergedFallbackId = mergedField(existing, updates, "cap_fallback_offer_id");
  if (typeof mergedFallbackId === "number" && errors["cap_fallback_offer_id"] === undefined) {
    if (mergedFallbackId === existing.id) {
      errors["cap_fallback_offer_id"] = "an offer cannot be its own cap fallback";
    } else {
      const fallback = await c.env.DB.prepare("SELECT id FROM leadgen_offers WHERE id = ? LIMIT 1")
        .bind(mergedFallbackId)
        .first<{ id: number }>();
      if (!fallback) errors["cap_fallback_offer_id"] = "unknown fallback offer";
    }
  }

  // --- placements referential guards (§10.1 replace-set) -----------------
  // A provided lgpl_ must belong to THIS offer; a row the replace-set drops
  // must not be an auction participant (leadgen_auction_offers joins the
  // CONCRETE placement row, §7.4 — deleting it would orphan the auction).
  let existingPlacements: LeadgenOfferPlacementRow[] = [];
  let removedPlacements: LeadgenOfferPlacementRow[] = [];
  if (placementInputs !== null) {
    existingPlacements = await readOfferPlacements(c.env.DB, existing.id);
    const existingByPublicId = new Map(existingPlacements.map((p) => [p.public_id, p]));
    placementInputs.forEach((input, index) => {
      if (
        input.public_id !== null &&
        !existingByPublicId.has(input.public_id) &&
        errors[`placements[${index}].public_id`] === undefined
      ) {
        errors[`placements[${index}].public_id`] = "unknown placement public_id for this offer";
      }
    });
    const keptPublicIds = new Set(
      placementInputs.map((p) => p.public_id).filter((v): v is string => v !== null),
    );
    removedPlacements = existingPlacements.filter((p) => !keptPublicIds.has(p.public_id));
    if (removedPlacements.length > 0) {
      const referenced = await c.env.DB.prepare(
        "SELECT DISTINCT offer_placement_id FROM leadgen_auction_offers WHERE offer_id = ?",
      )
        .bind(existing.id)
        .all<{ offer_placement_id: number }>();
      const referencedIds = new Set((referenced.results ?? []).map((r) => r.offer_placement_id));
      const blocked = removedPlacements.find((p) => referencedIds.has(p.id));
      if (blocked !== undefined && errors["placements"] === undefined) {
        errors["placements"] =
          `placement '${blocked.placement_id}' participates in an auction and cannot be removed`;
      }
    }
  }

  if (Object.keys(errors).length > 0) {
    return c.json({ error: "Validation failed", fields: errors }, 400);
  }

  // --- atomic write (offer row + replace-set collections) ----------------
  const statements: D1PreparedStatement[] = [];
  if (updates.size > 0) {
    const columns = [...updates.keys()];
    const setClauses = columns.map((column) => `${column} = ?`);
    setClauses.push("updated_at = unixepoch()");
    statements.push(
      c.env.DB.prepare(`UPDATE leadgen_offers SET ${setClauses.join(", ")} WHERE id = ?`).bind(
        ...columns.map((column) => updates.get(column) ?? null),
        existing.id,
      ),
    );
  } else {
    statements.push(
      c.env.DB.prepare("UPDATE leadgen_offers SET updated_at = unixepoch() WHERE id = ?").bind(
        existing.id,
      ),
    );
  }
  if (headerInputs !== null) {
    statements.push(
      c.env.DB.prepare("DELETE FROM leadgen_offer_headers WHERE offer_id = ?").bind(existing.id),
    );
    for (const header of headerInputs) {
      statements.push(
        c.env.DB.prepare(
          "INSERT INTO leadgen_offer_headers (offer_id, header_name, value_kind, value_text) VALUES (?, ?, ?, ?)",
        ).bind(existing.id, header.header_name, header.value_kind, header.value_text),
      );
    }
  }
  if (ruleInputs !== null) {
    statements.push(
      c.env.DB.prepare("DELETE FROM leadgen_offer_region_rules WHERE offer_id = ?").bind(existing.id),
    );
    for (const rule of ruleInputs) {
      statements.push(
        c.env.DB.prepare(
          `INSERT INTO leadgen_offer_region_rules
             (public_id, offer_id, dimension, action, values_json, priority, enabled)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          rule.public_id ?? mintPublicId("offer_region_rule"),
          existing.id,
          rule.value.dimension,
          rule.value.action,
          JSON.stringify(rule.value.values),
          rule.value.priority,
          rule.value.enabled ? 1 : 0,
        ),
      );
    }
  }
  if (placementInputs !== null) {
    const existingByPublicId = new Map(existingPlacements.map((p) => [p.public_id, p]));
    // Ordering discipline for the two §7.1 unique constraints:
    //   1. deletes free their placement_id first;
    //   2. renamed preserved rows PARK on a collision-proof temp id (their
    //      own lgpl_ public id) so an intra-batch swap can never trip
    //      UNIQUE(offer_id, placement_id) mid-transaction (SQLite checks
    //      per statement, not deferred);
    //   3. every kept/new row lands with is_default=0;
    //   4. ONE final flip satisfies uq_leadgen_offerplacement_default.
    for (const removed of removedPlacements) {
      statements.push(
        c.env.DB.prepare("DELETE FROM leadgen_offer_placements WHERE id = ?").bind(removed.id),
      );
    }
    for (const input of placementInputs) {
      if (input.public_id === null) continue;
      const current = existingByPublicId.get(input.public_id);
      if (current !== undefined && current.placement_id !== input.placement_id) {
        statements.push(
          c.env.DB.prepare("UPDATE leadgen_offer_placements SET placement_id = ? WHERE id = ?").bind(
            `~${current.public_id}`,
            current.id,
          ),
        );
      }
    }
    let defaultPublicId: string | null = null;
    for (const input of placementInputs) {
      if (input.public_id !== null) {
        const current = existingByPublicId.get(input.public_id);
        if (current === undefined) continue; // guarded above; defensive
        statements.push(
          c.env.DB.prepare(
            "UPDATE leadgen_offer_placements SET placement_id = ?, label = ?, is_default = 0 WHERE id = ?",
          ).bind(input.placement_id, input.label, current.id),
        );
        if (input.is_default) defaultPublicId = input.public_id;
      } else {
        const minted = mintPublicId("offer_placement");
        statements.push(
          c.env.DB.prepare(
            "INSERT INTO leadgen_offer_placements (public_id, offer_id, placement_id, label, is_default) VALUES (?, ?, ?, ?, 0)",
          ).bind(minted, existing.id, input.placement_id, input.label),
        );
        if (input.is_default) defaultPublicId = minted;
      }
    }
    if (defaultPublicId !== null) {
      statements.push(
        c.env.DB.prepare("UPDATE leadgen_offer_placements SET is_default = 1 WHERE public_id = ?").bind(
          defaultPublicId,
        ),
      );
    }
  }
  try {
    await c.env.DB.batch(statements);
  } catch (err) {
    // Safety net for the two placement uniques (validation catches the
    // in-set cases; this types any residual constraint race as a 400
    // instead of a 500 — the batch rolled back atomically).
    const message = err instanceof Error ? err.message : String(err);
    if (placementInputs !== null && message.includes("leadgen_offer_placements")) {
      return c.json(
        {
          error: "Validation failed",
          fields: { placements: "placement ids conflict with existing rows (UNIQUE offer_id + placement_id)" },
        },
        400,
      );
    }
    throw err;
  }

  const updated = await c.env.DB.prepare("SELECT * FROM leadgen_offers WHERE id = ? LIMIT 1")
    .bind(existing.id)
    .first<LeadgenOfferRow>();
  if (!updated) return c.json({ error: "Update failed" }, 500);
  return c.json(await offerDetailJson(c.env.DB, updated));
}

// ---------------------------------------------------------------------------
// DELETE /offers/:id — archive (03 §9.6: status flip, never a hard delete)
// ---------------------------------------------------------------------------

export async function deleteOfferHandler(c: AdminContext): Promise<Response> {
  const row = await resolveOfferRow(c.env.DB, c.req.param("id") ?? "");
  if (row === null) return c.json({ error: "Not Found" }, 404);

  // A1 (07 §7.2): default DELETE stays ARCHIVE (contract-safe). `?mode=hard`
  // is the guarded permanent delete — allowed ONLY at zero references across
  // the full §7.4 inventory (explicit-query guard; D1 FKs are not enforced).
  const mode = c.req.query("mode") ?? "";
  if (mode !== "hard") {
    await c.env.DB.prepare(
      "UPDATE leadgen_offers SET status = 'archived', updated_at = unixepoch() WHERE id = ?",
    )
      .bind(row.id)
      .run();
    return c.json({ ok: true, id: row.id, public_id: row.public_id, status: "archived" });
  }

  const usage = await buildOfferUsageReport(c.env.DB, row.id);
  if (!usage.delete_eligibility.eligible) {
    // Referenced somewhere → 409 + the usage report (07 §7.2). The UI renders
    // it as the "in use" modal with per-kind links + "Archive instead".
    return c.json({ error: "offer_in_use", usage }, 409);
  }

  // F6 (07 §7.2): the repo has NO admin-audit-row pattern, so the contract's
  // else-branch applies — a structured log records the hard delete with the
  // per-child-table cascaded row counts (cheap scalar COUNTs BEFORE the
  // delete batch; ?? not || so a real 0 survives, D1 rule).
  const cascadeCounts = await c.env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM leadgen_offer_region_rules WHERE offer_id = ?) AS region_rules,
       (SELECT COUNT(*) FROM leadgen_offer_headers WHERE offer_id = ?) AS headers,
       (SELECT COUNT(*) FROM leadgen_offer_cap_counters WHERE offer_id = ?) AS cap_counters,
       (SELECT COUNT(*) FROM leadgen_offer_payload_schemas WHERE offer_id = ?) AS payload_schemas,
       (SELECT COUNT(*) FROM leadgen_offer_placements WHERE offer_id = ?) AS placements`,
  )
    .bind(row.id, row.id, row.id, row.id, row.id)
    .first<{ region_rules: number; headers: number; cap_counters: number; payload_schemas: number; placements: number }>();

  // Clean → cascade the offer's OWN children only, in one batch. Logs/analytics
  // are never deleted (their ABSENCE is what made the offer deletable). The
  // active-schema pointer clears FIRST: leadgen_offers.active_payload_schema_id
  // references leadgen_offer_payload_schemas(id), so deleting schema rows while
  // the pointer still holds one violates the FK where enforced.
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE leadgen_offers SET active_payload_schema_id = NULL WHERE id = ?").bind(row.id),
    c.env.DB.prepare("DELETE FROM leadgen_offer_region_rules WHERE offer_id = ?").bind(row.id),
    c.env.DB.prepare("DELETE FROM leadgen_offer_headers WHERE offer_id = ?").bind(row.id),
    c.env.DB.prepare("DELETE FROM leadgen_offer_cap_counters WHERE offer_id = ?").bind(row.id),
    c.env.DB.prepare("DELETE FROM leadgen_offer_payload_schemas WHERE offer_id = ?").bind(row.id),
    c.env.DB.prepare("DELETE FROM leadgen_offer_placements WHERE offer_id = ?").bind(row.id),
    c.env.DB.prepare("DELETE FROM leadgen_offers WHERE id = ?").bind(row.id),
  ]);
  console.log(
    JSON.stringify({
      event: "leadgen_offer_hard_delete",
      offer_public_id: row.public_id,
      offer_name: row.offer_name,
      cascaded: {
        leadgen_offer_region_rules: cascadeCounts?.region_rules ?? 0,
        leadgen_offer_headers: cascadeCounts?.headers ?? 0,
        leadgen_offer_cap_counters: cascadeCounts?.cap_counters ?? 0,
        leadgen_offer_payload_schemas: cascadeCounts?.payload_schemas ?? 0,
        leadgen_offer_placements: cascadeCounts?.placements ?? 0,
      },
    }),
  );
  return c.json({ ok: true, id: row.id, public_id: row.public_id, deleted: "hard" });
}

// ---------------------------------------------------------------------------
// A2 duplicate — POST /offers/:id/duplicate (07 §7.3; Q3 copy-set)
// ---------------------------------------------------------------------------

export async function duplicateOfferHandler(c: AdminContext): Promise<Response> {
  const src = await resolveOfferRow(c.env.DB, c.req.param("id") ?? "");
  if (src === null) return c.json({ error: "Not Found" }, 404);

  const body = await readJsonBody(c);
  if (body === null) return c.json({ error: "Invalid JSON body" }, 400);

  const rawName = typeof body["name"] === "string" ? (body["name"] as string).trim() : "";
  const name = rawName !== "" ? rawName : `${src.offer_name} (copy)`;
  const newDefaultPlacementId =
    typeof body["default_placement_id"] === "string" ? (body["default_placement_id"] as string).trim() : "";
  if (newDefaultPlacementId === "") {
    // §7.3: source placement ids are NEVER copied verbatim — a fresh default
    // placement id is required input (two offers must never serve the same
    // provider feed id by accident).
    return c.json(
      { error: "Validation failed", fields: { default_placement_id: "a new default placement id is required" } },
      400,
    );
  }
  if (/^__needs_value__/.test(newDefaultPlacementId)) {
    // "__needs_value__…" is the reserved sentinel namespace for the blanked
    // extra placements cloned below — a user-supplied default inside it would
    // collide with a sentinel row MID-batch on UNIQUE(offer_id, placement_id)
    // (an atomic rollback, but a 500). Typed 400 instead, before any write.
    return c.json(
      {
        error: "Validation failed",
        fields: { default_placement_id: "ids starting with __needs_value__ are a reserved value" },
      },
      400,
    );
  }
  // Copy toggles (§7.3 defaults): region rules ON, endpoint/request config ON
  // (refs only — secrets never move), cap settings OFF (copied disabled).
  const copyRegionRules = body["copy_region_rules"] !== false;
  const copyEndpointConfig = body["copy_endpoint_config"] !== false;
  const copyCapSettings = body["copy_cap_settings"] === true;

  const newPublic = mintPublicId("offer");
  // The offer clone: status paused (the enum's inactive value — there is no
  // 'draft'; the untested new-v1 schema keeps it out of live auctions via the
  // R4 gate regardless). Endpoint/token refs copied only when the box is checked.
  const endpointProd = copyEndpointConfig ? src.endpoint_production : null;
  const endpointStaging = copyEndpointConfig ? src.endpoint_staging : null;
  const tokenRef = copyEndpointConfig ? src.api_token_secret_ref : null;
  const tokenPlacement = copyEndpointConfig ? src.api_token_placement : null;
  const tokenParam = copyEndpointConfig ? src.api_token_param_name : null;
  const requestMethod = copyEndpointConfig ? src.request_method : null;

  // Source placements read BEFORE any write: the F13 guard below + the
  // blank-sentinel cloning both consume them, and §7.3 "one transaction"
  // means every read happens first, then ONE batch writes everything.
  const srcPlacements = await c.env.DB.prepare(
    "SELECT placement_id, label, is_default FROM leadgen_offer_placements WHERE offer_id = ? ORDER BY is_default DESC, id ASC",
  )
    .bind(src.id)
    .all<{ placement_id: string; label: string | null; is_default: number }>();
  const srcPlacementRows = srcPlacements.results ?? [];
  // F13 (07 §7.3): a new default placement id equal to ANY source placement
  // id recreates the exact hazard the required input exists to prevent (two
  // offers serving the same provider feed id) — typed 400, never a clone.
  if (srcPlacementRows.some((p) => p.placement_id === newDefaultPlacementId)) {
    return c.json(
      {
        error: "Validation failed",
        fields: {
          default_placement_id:
            "default_placement_id must differ from every placement id of the source offer",
        },
      },
      400,
    );
  }

  // §7.3 "one transaction": the offer INSERT rides the SAME batch as every
  // child row — children resolve offer_id via (SELECT id FROM leadgen_offers
  // WHERE public_id = ?) subqueries (the active-schema-pointer pattern), so
  // a mid-batch failure rolls the WHOLE clone back: no compensating delete,
  // no crash window leaving an inert parent.
  const stmts: D1PreparedStatement[] = [
    c.env.DB.prepare(
      `INSERT INTO leadgen_offers
         (public_id, offer_name, provider, activity, vertical, tag,
          conversion_tracking_method, offer_type, calls_provider_api, bid_source,
          request_execution_mode, static_bid_value, static_bid_currency, static_order,
          banner_url_template, static_fallback_banner_url, request_method,
          endpoint_production, endpoint_staging, api_token_secret_ref,
          api_token_placement, api_token_param_name,
          cap_enabled, cap_amount, cap_timezone, cap_count_by,
          cap_fallback_offer_id, cap_fallback_url,
          status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'paused')`,
    ).bind(
      newPublic, name, src.provider, src.activity, src.vertical, src.tag,
      src.conversion_tracking_method, src.offer_type, src.calls_provider_api, src.bid_source,
      src.request_execution_mode, src.static_bid_value, src.static_bid_currency, src.static_order,
      // §7.3: banner template + response-macro fallbacks copy; caps disabled unless checked.
      src.banner_url_template, src.static_fallback_banner_url, requestMethod,
      endpointProd, endpointStaging, tokenRef, tokenPlacement, tokenParam,
      0, // the clone always starts cap-disabled (§7.3) even when cap settings are copied
      copyCapSettings ? src.cap_amount : null,
      copyCapSettings ? src.cap_timezone : null,
      copyCapSettings ? src.cap_count_by : null,
      // F13 (07 §7.3): cap_fallback_offer_id is part of "cap settings" — it
      // copies under the same checkbox (the clone still lands cap_enabled=0;
      // it was silently never copied before).
      copyCapSettings ? src.cap_fallback_offer_id : null,
      copyCapSettings ? src.cap_fallback_url : null,
    ),
  ];

  // Placements: the required new default; additional source placements cloned
  // with BLANK placement ids flagged "needs value" (never the source id).
  const defaultPlPublic = mintPublicId("offer_placement");
  stmts.push(
    c.env.DB.prepare(
      `INSERT INTO leadgen_offer_placements (public_id, offer_id, placement_id, label, is_default)
       VALUES (?, (SELECT id FROM leadgen_offers WHERE public_id = ?), ?, ?, 1)`,
    ).bind(defaultPlPublic, newPublic, newDefaultPlacementId, null),
  );
  let extraPlacements = 0;
  for (const p of srcPlacementRows) {
    if (p.is_default === 1) continue; // its slot is the new required default
    extraPlacements += 1;
    // blank placement id (NOT NULL column → a unique needs-value sentinel per row)
    stmts.push(
      c.env.DB.prepare(
        `INSERT INTO leadgen_offer_placements (public_id, offer_id, placement_id, label, is_default)
         VALUES (?, (SELECT id FROM leadgen_offers WHERE public_id = ?), ?, ?, 0)`,
      ).bind(mintPublicId("offer_placement"), newPublic, `__needs_value__${extraPlacements}`, p.label),
    );
  }

  // ACTIVE payload schema → new v1 (fresh lgp_, no history); parser copied.
  let schemaCopied = false;
  if (src.active_payload_schema_id !== null && src.active_payload_schema_id !== undefined) {
    const active = await c.env.DB.prepare(
      "SELECT schema_json, carrier_parse_json, carrier_parse_version FROM leadgen_offer_payload_schemas WHERE id = ?",
    )
      .bind(src.active_payload_schema_id)
      .first<{ schema_json: string; carrier_parse_json: string | null; carrier_parse_version: number }>();
    if (active !== null) {
      const schemaPublic = mintPublicId("payload_schema_version");
      stmts.push(
        c.env.DB.prepare(
          `INSERT INTO leadgen_offer_payload_schemas
             (public_id, offer_id, version, schema_json, sample_response_json, carrier_parse_json, carrier_parse_version)
           VALUES (?, (SELECT id FROM leadgen_offers WHERE public_id = ?), 1, ?, NULL, ?, ?)`,
        ).bind(schemaPublic, newPublic, active.schema_json, active.carrier_parse_json, active.carrier_parse_version),
        // point the clone's active pointer at its new v1 (Test status stays
        // untested — sample_response_json is NULL → R4 blocks live auction).
        c.env.DB.prepare(
          "UPDATE leadgen_offers SET active_payload_schema_id = (SELECT id FROM leadgen_offer_payload_schemas WHERE public_id = ?) WHERE public_id = ?",
        ).bind(schemaPublic, newPublic),
      );
      schemaCopied = true;
    }
  }

  // Headers (part of request config) copied only with the endpoint box.
  if (copyEndpointConfig) {
    const headers = await c.env.DB.prepare(
      "SELECT header_name, value_kind, value_text FROM leadgen_offer_headers WHERE offer_id = ?",
    )
      .bind(src.id)
      .all<{ header_name: string; value_kind: string; value_text: string | null }>();
    for (const h of headers.results ?? []) {
      stmts.push(
        c.env.DB.prepare(
          "INSERT INTO leadgen_offer_headers (offer_id, header_name, value_kind, value_text) VALUES ((SELECT id FROM leadgen_offers WHERE public_id = ?), ?, ?, ?)",
        ).bind(newPublic, h.header_name, h.value_kind, h.value_text),
      );
    }
  }

  // Region rules (default ON).
  let regionRulesCopied = 0;
  if (copyRegionRules) {
    const rules = await c.env.DB.prepare(
      "SELECT dimension, action, values_json, priority, enabled FROM leadgen_offer_region_rules WHERE offer_id = ?",
    )
      .bind(src.id)
      .all<{ dimension: string; action: string; values_json: string; priority: number; enabled: number }>();
    for (const r of rules.results ?? []) {
      regionRulesCopied += 1;
      stmts.push(
        c.env.DB.prepare(
          `INSERT INTO leadgen_offer_region_rules (public_id, offer_id, dimension, action, values_json, priority, enabled)
           VALUES (?, (SELECT id FROM leadgen_offers WHERE public_id = ?), ?, ?, ?, ?, ?)`,
        ).bind(mintPublicId("offer_region_rule"), newPublic, r.dimension, r.action, r.values_json, r.priority, r.enabled),
      );
    }
  }

  // Atomicity (§7.3 "one transaction"): the offer AND all its children land
  // in ONE batch — a D1 batch is a single implicit transaction, so any
  // failing statement rolls the parent back too. A placement-less paused
  // clone can never persist, even across a crash mid-request.
  await c.env.DB.batch(stmts);

  // Post-batch re-read: the response reflects the COMMITTED clone (including
  // the active_payload_schema_id pointer the batch just set).
  const dup = await c.env.DB.prepare("SELECT * FROM leadgen_offers WHERE public_id = ?")
    .bind(newPublic)
    .first<LeadgenOfferRow>();
  if (dup === null) return c.json({ error: "duplicate failed" }, 500);

  // NEVER copied: analytics, cap counters, provider logs, Test results, revenue.
  return c.json(
    {
      offer: offerRowToApi(dup),
      duplicated_from: { id: src.id, public_id: src.public_id, name: src.offer_name },
      copied: {
        active_schema_as_v1: schemaCopied,
        region_rules: regionRulesCopied,
        endpoint_config: copyEndpointConfig,
        cap_settings_copied_disabled: copyCapSettings,
        extra_placements_blanked: extraPlacements,
      },
      not_copied: ["analytics", "cap_counters", "provider_logs", "test_results", "revenue"],
      test_status: "untested",
    },
    201,
  );
}

// ---------------------------------------------------------------------------
// A3 usage inventory (07 §7.4) — the FULL reference set. ONE query set drives
// both GET /offers/:id/usage and the A1 delete guard.
// ---------------------------------------------------------------------------

// F8 (07 §7.4): every emitted entry carries kind/count/items/warning_only
// EXPLICITLY — `count` is the TRUE row count for the kind (warning kinds keep
// ONE synthetic display item, so count may exceed items.length; it is never
// smuggled inside public_id/name strings).
interface OfferUsageKind {
  kind: string;
  count: number;
  items: Array<{ id: number; public_id: string; name: string; link: string }>;
  warning_only: boolean;
}
export interface OfferUsageReport {
  kinds: OfferUsageKind[];
  delete_eligibility: { eligible: boolean; blocking_kinds: string[] };
}

async function countRefs(
  db: D1Database,
  sql: string,
  offerId: number,
): Promise<Array<{ id: number; public_id: string; name: string; link: string }>> {
  const res = await db
    .prepare(sql)
    .bind(offerId)
    .all<{ id: number; public_id: string; name: string; link: string }>();
  return res.results ?? [];
}

export async function buildOfferUsageReport(db: D1Database, offerId: number): Promise<OfferUsageReport> {
  // Blocking reference kinds (any → hard-delete refused). Provider logs,
  // revenue, and analytics mirrors are WARNING-ONLY (historical rows; their
  // presence does not block a delete — 07 §7.4).
  const kinds: OfferUsageKind[] = [];
  const blocking: string[] = [];
  const add = (
    kind: string,
    items: OfferUsageKind["items"],
    opts: { warning_only?: boolean; count?: number } = {},
  ): void => {
    const warningOnly = opts.warning_only === true;
    // ?? not ||: an explicit true count of 0 must not fall back (D1 rule).
    const count = opts.count ?? items.length;
    kinds.push({ kind, count, items, warning_only: warningOnly });
    if (!warningOnly && count > 0) blocking.push(kind);
  };

  add(
    "sections_available",
    await countRefs(
      db,
      `SELECT s.id, s.public_id, s.section_name AS name, '/admin/leadgen/sections/' || s.public_id || '/edit' AS link
       FROM leadgen_section_available_offers sao JOIN leadgen_sections s ON s.id = sao.section_id
       WHERE sao.offer_id = ? GROUP BY s.id ORDER BY s.section_name`,
      offerId,
    ),
  );
  add(
    "answer_maps",
    await countRefs(
      db,
      `SELECT s.id, s.public_id, s.section_name || ' (' || COUNT(*) || ' fields)' AS name,
              '/admin/leadgen/sections/' || s.public_id || '/edit#mapping' AS link
       FROM leadgen_section_answer_maps m JOIN leadgen_sections s ON s.id = m.section_id
       WHERE m.offer_id = ? GROUP BY s.id ORDER BY s.section_name`,
      offerId,
    ),
  );
  add(
    "auctions_participating",
    await countRefs(
      db,
      `SELECT a.id, a.public_id, a.auction_name AS name, '/admin/leadgen/auctions/' || a.public_id || '/edit' AS link
       FROM leadgen_auction_offers ao JOIN leadgen_auctions a ON a.id = ao.auction_id
       WHERE ao.offer_id = ? GROUP BY a.id ORDER BY a.auction_name`,
      offerId,
    ),
  );
  add(
    "auction_rules_targeting",
    await countRefs(
      db,
      `SELECT a.id, a.public_id, a.auction_name AS name, '/admin/leadgen/auctions/' || a.public_id || '/edit#rules' AS link
       FROM leadgen_auction_rules r JOIN leadgen_auctions a ON a.id = r.auction_id
       WHERE r.target_offer_id = ? GROUP BY a.id ORDER BY a.auction_name`,
      offerId,
    ),
  );
  add(
    "cap_fallback_referenced_by",
    await countRefs(
      db,
      `SELECT o.id, o.public_id, o.offer_name AS name, '/admin/leadgen/offers/' || o.public_id || '/edit' AS link
       FROM leadgen_offers o WHERE o.cap_fallback_offer_id = ? ORDER BY o.offer_name`,
      offerId,
    ),
  );
  // BLOCKER (adversarial): a funnel redirect rule that targets this Offer
  // (§11 direct_offer_redirect) is a live wired reference — deleting the Offer
  // would break the redirect. Blocking.
  add(
    "funnel_rules_targeting",
    await countRefs(
      db,
      `SELECT r.id, r.public_id, COALESCE(f.funnel_name, 'funnel rule') AS name,
              '/admin/leadgen/quotes' AS link
       FROM leadgen_funnel_rules r
       LEFT JOIN leadgen_funnel_variants v ON v.id = r.variant_id
       LEFT JOIN leadgen_funnels f ON f.id = v.funnel_id
       WHERE r.target_offer_id = ? ORDER BY r.id`,
      offerId,
    ),
  );
  // BLOCKER (adversarial): an Auction using this Offer as its backfill source
  // (leadgen_auctions.backfill_source_offer_id — write-enforced FK) would be
  // left dangling + un-saveable. Blocking.
  add(
    "auction_backfill_source",
    await countRefs(
      db,
      `SELECT a.id, a.public_id, a.auction_name AS name, '/admin/leadgen/auctions/' || a.public_id || '/edit' AS link
       FROM leadgen_auctions a WHERE a.backfill_source_offer_id = ? ORDER BY a.auction_name`,
      offerId,
    ),
  );
  // MAJOR (adversarial): the §7.4-named kinds that were missing. quotes_indirect
  // (Quotes whose Sections select this Offer) is blocking; region_rules (own —
  // cascade-deleted on clean delete) is INFORMATIONAL (warning-only, never
  // blocks — the cascade handles it); revenue_attribution is warning-only.
  add(
    "quotes_indirect",
    await countRefs(
      db,
      `SELECT DISTINCT q.id, q.public_id, q.quote_name AS name, '/admin/leadgen/quotes/' || q.public_id || '/edit' AS link
       FROM leadgen_section_available_offers sao
       JOIN leadgen_funnel_variant_sections fvs ON fvs.section_id = sao.section_id
       JOIN leadgen_funnel_variants fv ON fv.id = fvs.variant_id
       JOIN leadgen_funnels f ON f.id = fv.funnel_id
       JOIN leadgen_quotes q ON q.id = f.quote_id
       WHERE sao.offer_id = ? ORDER BY q.quote_name`,
      offerId,
    ),
  );
  add(
    "region_rules",
    await countRefs(
      db,
      `SELECT id, public_id, dimension AS name, '' AS link
       FROM leadgen_offer_region_rules WHERE offer_id = ? ORDER BY id`,
      offerId,
    ),
    { warning_only: true }, // own children — cascade-deleted; informational, never blocks
  );
  add(
    "cap_counters_active",
    await countRefs(
      db,
      `SELECT ROW_NUMBER() OVER (ORDER BY cap_date) AS id, cap_date AS public_id, cap_date AS name, '' AS link
       FROM leadgen_offer_cap_counters WHERE offer_id = ? AND (click_count > 0 OR conversion_count > 0)`,
      offerId,
    ),
  );
  // Warning-only historical rows — keyed on offer_public_id. Each kind keeps
  // ONE synthetic display item; `count` is the TRUE summed row count (F8 —
  // never smuggled inside public_id/name). Never blocks a delete.
  const offerPublicRow = await db
    .prepare("SELECT public_id FROM leadgen_offers WHERE id = ?")
    .bind(offerId)
    .first<{ public_id: string }>();
  const offerPublicId = offerPublicRow?.public_id ?? "";
  const providerLog = await db
    .prepare(
      `SELECT COUNT(*) AS n, MAX(created_at) AS latest FROM leadgen_provider_request_log
       WHERE offer_public_id = ?`,
    )
    .bind(offerPublicId)
    .first<{ n: number; latest: number | null }>();
  const providerLogCount = providerLog?.n ?? 0;
  add(
    "provider_request_logs",
    providerLogCount > 0
      ? [{ id: 1, public_id: "", name: `${providerLogCount} provider requests (latest ts ${providerLog?.latest ?? "?"})`, link: "" }]
      : [],
    { warning_only: true, count: providerLogCount },
  );
  // F8 (07 §7.2 "leadgen_analytics_offer etc."): ALL 0037 analytics mirror
  // tables keyed by offer_public_id — offer, auction_drilldown, carrier,
  // provider_diagnostics. The section/answer-distribution/quote(+drilldown)/
  // auction mirrors carry no offer key and are skipped.
  const analyticsRow = await db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM leadgen_analytics_offer WHERE offer_public_id = ?) AS offer_rows,
         (SELECT COUNT(*) FROM leadgen_analytics_auction_drilldown WHERE offer_public_id = ?) AS drilldown_rows,
         (SELECT COUNT(*) FROM leadgen_analytics_carrier WHERE offer_public_id = ?) AS carrier_rows,
         (SELECT COUNT(*) FROM leadgen_analytics_provider_diagnostics WHERE offer_public_id = ?) AS diagnostics_rows`,
    )
    .bind(offerPublicId, offerPublicId, offerPublicId, offerPublicId)
    .first<{ offer_rows: number; drilldown_rows: number; carrier_rows: number; diagnostics_rows: number }>();
  const analyticsCount =
    (analyticsRow?.offer_rows ?? 0) +
    (analyticsRow?.drilldown_rows ?? 0) +
    (analyticsRow?.carrier_rows ?? 0) +
    (analyticsRow?.diagnostics_rows ?? 0);
  add(
    "analytics_mirror_rows",
    analyticsCount > 0
      ? [{ id: 1, public_id: "", name: `${analyticsCount} analytics rows across the offer-keyed mirrors`, link: "" }]
      : [],
    { warning_only: true, count: analyticsCount },
  );
  // revenue_attribution — warning-only (§7.4): revenue_raw + postback_log +
  // conversion_log rows keyed by offer_public_id (historical attribution).
  // leadgen_revenue_unmatched carries no offer key (click_id/provider only) — skipped.
  const revenueRow = await db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM leadgen_revenue_raw WHERE offer_public_id = ?) AS revenue_rows,
         (SELECT COUNT(*) FROM leadgen_postback_log WHERE offer_public_id = ?) AS postback_rows,
         (SELECT COUNT(*) FROM leadgen_conversion_log WHERE offer_public_id = ?) AS conversion_rows`,
    )
    .bind(offerPublicId, offerPublicId, offerPublicId)
    .first<{ revenue_rows: number; postback_rows: number; conversion_rows: number }>();
  const revenueCount =
    (revenueRow?.revenue_rows ?? 0) + (revenueRow?.postback_rows ?? 0) + (revenueRow?.conversion_rows ?? 0);
  add(
    "revenue_attribution",
    revenueCount > 0
      ? [{ id: 1, public_id: "", name: `${revenueCount} revenue/postback/conversion rows`, link: "" }]
      : [],
    { warning_only: true, count: revenueCount },
  );

  return { kinds, delete_eligibility: { eligible: blocking.length === 0, blocking_kinds: blocking } };
}

export async function offerUsageHandler(c: AdminContext): Promise<Response> {
  const row = await resolveOfferRow(c.env.DB, c.req.param("id") ?? "");
  if (row === null) return c.json({ error: "Not Found" }, 404);
  const usage = await buildOfferUsageReport(c.env.DB, row.id);
  return c.json({ offer: { id: row.id, public_id: row.public_id, name: row.offer_name }, usage });
}

// ---------------------------------------------------------------------------
// GET /offers/:id/analytics — §10.7 over leadgen_analytics_offer (0037)
// ---------------------------------------------------------------------------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function utcDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export interface DateRange {
  from: string;
  to: string;
}

// ?from&to (YYYY-MM-DD) — the repo's API-side timeframe convention (the UI's
// resolveTimeframe(range) select resolves to this pair). Default: last 30
// days UTC.
export function parseDateRange(c: AdminContext): DateRange | { error: string } {
  const now = new Date();
  const defaultTo = utcDateString(now);
  const defaultFrom = utcDateString(new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000));
  const from = c.req.query("from") ?? defaultFrom;
  const to = c.req.query("to") ?? defaultTo;
  if (!DATE_RE.test(from)) return { error: "from must be YYYY-MM-DD" };
  if (!DATE_RE.test(to)) return { error: "to must be YYYY-MM-DD" };
  if (from > to) return { error: "from must be <= to" };
  return { from, to };
}

interface OfferMetricRow {
  offer_impressions: number | null;
  clicks: number | null;
  unique_clicks: number | null;
  conversions: number | null;
  revenue: number | null;
  ctr: number | null;
  cvr: number | null;
  rpc: number | null;
  rpm: number | null;
}

// §10.7 ratios computed at read, NULLIF-guarded: ctr = clicks /
// offer_impressions (offer_impression is the deduped §6.4 event), cvr =
// conversions/clicks, rpc = revenue/clicks, rpm = revenue/offer_impressions
// × 1000. A zero denominator yields NULL (the UI renders "—", §9.1) — never
// a fake 0 ratio.
export async function offerAnalyticsHandler(c: AdminContext): Promise<Response> {
  const row = await resolveOfferRow(c.env.DB, c.req.param("id") ?? "");
  if (row === null) return c.json({ error: "Not Found" }, 404);
  const range = parseDateRange(c);
  if ("error" in range) {
    return c.json({ error: "Validation failed", fields: { range: range.error } }, 400);
  }
  const metrics = await c.env.DB.prepare(
    `SELECT
       SUM(offer_impressions) AS offer_impressions,
       SUM(clicks) AS clicks,
       SUM(unique_clicks) AS unique_clicks,
       SUM(conversions) AS conversions,
       SUM(revenue) AS revenue,
       CAST(SUM(clicks) AS REAL) / NULLIF(SUM(offer_impressions), 0) AS ctr,
       CAST(SUM(conversions) AS REAL) / NULLIF(SUM(clicks), 0) AS cvr,
       SUM(revenue) / NULLIF(SUM(clicks), 0) AS rpc,
       SUM(revenue) / NULLIF(SUM(offer_impressions), 0) * 1000 AS rpm
     FROM leadgen_analytics_offer
     WHERE offer_public_id = ? AND date BETWEEN ? AND ?`,
  )
    .bind(row.public_id, range.from, range.to)
    .first<OfferMetricRow>();
  return c.json({
    analytics: {
      from: range.from,
      to: range.to,
      offer_impressions: metrics?.offer_impressions ?? 0,
      clicks: metrics?.clicks ?? 0,
      unique_clicks: metrics?.unique_clicks ?? 0,
      conversions: metrics?.conversions ?? 0,
      revenue: metrics?.revenue ?? 0,
      ctr: metrics?.ctr ?? null,
      cvr: metrics?.cvr ?? null,
      rpc: metrics?.rpc ?? null,
      rpm: metrics?.rpm ?? null,
    },
  });
}

// ---------------------------------------------------------------------------
// GET /offers/:id/cap — §10.6 near-real-time counter status (Stage-A caps.ts)
// ---------------------------------------------------------------------------

export async function offerCapHandler(c: AdminContext): Promise<Response> {
  const row = await resolveOfferRow(c.env.DB, c.req.param("id") ?? "");
  if (row === null) return c.json({ error: "Not Found" }, 404);
  const status = await readCapStatus(c.env.DB, row);
  return c.json({
    cap: {
      cap_enabled: row.cap_enabled !== 0,
      cap_amount: row.cap_amount,
      cap_count_by: row.cap_count_by,
      cap_timezone: row.cap_timezone,
      cap_date: status.cap_date,
      timezone: status.timezone,
      click_count: status.click_count,
      conversion_count: status.conversion_count,
      exceeded: capExceeded(status, row),
    },
  });
}

// ---------------------------------------------------------------------------
// GET/POST /offers/:id/payload-schemas (+ /from-example) — §11 versioning
// ---------------------------------------------------------------------------

export async function listPayloadSchemasHandler(c: AdminContext): Promise<Response> {
  const row = await resolveOfferRow(c.env.DB, c.req.param("id") ?? "");
  if (row === null) return c.json({ error: "Not Found" }, 404);
  const schemas = await c.env.DB.prepare(
    "SELECT * FROM leadgen_offer_payload_schemas WHERE offer_id = ? ORDER BY version DESC, id DESC",
  )
    .bind(row.id)
    .all<LeadgenOfferPayloadSchemaRow>();
  return c.json({ items: (schemas.results ?? []).map(schemaRowToApi) });
}

// Insert the NEXT immutable version and move the offer's active pointer to
// it — one atomic batch (§11.8 "every save = a new immutable version"; the
// new version becomes the active schema). The stored schema_json's `version`
// field is REWRITTEN to the allocated per-offer sequence so the two counters
// can never drift.
async function createSchemaVersion(
  db: D1Database,
  offer: LeadgenOfferRow,
  rawSchema: Record<string, unknown>,
  carrierParseJson: string | null,
  source: LeadgenPayloadSchemaSource,
): Promise<LeadgenOfferPayloadSchemaRow | null> {
  const nextRow = await db
    .prepare(
      "SELECT COALESCE(MAX(version), 0) + 1 AS v FROM leadgen_offer_payload_schemas WHERE offer_id = ?",
    )
    .bind(offer.id)
    .first<{ v: number }>();
  const version = Number(nextRow?.v ?? 1);
  const publicId = mintPublicId("payload_schema_version");
  const schemaText = JSON.stringify({ ...rawSchema, version });
  await db.batch([
    db
      .prepare(
        `INSERT INTO leadgen_offer_payload_schemas
           (public_id, offer_id, version, schema_json, carrier_parse_json, source, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(publicId, offer.id, version, schemaText, carrierParseJson, source, null),
    db
      .prepare(
        `UPDATE leadgen_offers
         SET active_payload_schema_id = (SELECT id FROM leadgen_offer_payload_schemas WHERE public_id = ?),
             updated_at = unixepoch()
         WHERE id = ?`,
      )
      .bind(publicId, offer.id),
  ]);
  const created = await db
    .prepare("SELECT * FROM leadgen_offer_payload_schemas WHERE public_id = ? LIMIT 1")
    .bind(publicId)
    .first<LeadgenOfferPayloadSchemaRow>();
  return created ?? null;
}

export async function createPayloadSchemaHandler(c: AdminContext): Promise<Response> {
  const row = await resolveOfferRow(c.env.DB, c.req.param("id") ?? "");
  if (row === null) return c.json({ error: "Not Found" }, 404);
  const body = await readJsonBody(c);
  if (body === null) return c.json({ error: "Invalid JSON body" }, 400);

  const rawSchema = body["schema_json"];
  if (rawSchema === undefined) {
    return c.json(
      { error: "Validation failed", fields: { schema_json: "schema_json is required" } },
      400,
    );
  }
  // B7 pre-save gate (fix-contract v2.4 05 §5.5): BLOCKING-class errors
  // reject the save (the full typed error list rides along for the §6.11
  // validation panel); warning-class findings persist WITH the version and
  // ride the 201 response as `warnings[]`.
  const validation = validatePayloadSchema(rawSchema);
  const { blocking, warnings } = splitPayloadSchemaErrors(validation.errors);
  if (blocking.length > 0) {
    return c.json(
      {
        error: "Validation failed",
        fields: { schema_json: blocking[0]?.message ?? "schema_json is invalid" },
        schema_errors: validation.errors,
      },
      400,
    );
  }

  let carrierParseJson: string | null = null;
  const rawParse = body["carrier_parse_json"];
  if (rawParse !== undefined && rawParse !== null) {
    // Mirror parseProviderResponse's own config gate (§11.7): an object with
    // a fields map, rejected at SAVE instead of degrading every parse.
    if (!isRecord(rawParse) || !isRecord(rawParse["fields"])) {
      return c.json(
        {
          error: "Validation failed",
          fields: { carrier_parse_json: "carrier_parse_json must be an object with a fields map" },
        },
        400,
      );
    }
    carrierParseJson = JSON.stringify(rawParse);
  }

  const created = await createSchemaVersion(
    c.env.DB,
    row,
    rawSchema as Record<string, unknown>,
    carrierParseJson,
    "manual",
  );
  if (created === null) return c.json({ error: "Insert failed" }, 500);
  // Additive B7 field: ALWAYS present (empty when clean) so the §6.11 panel
  // footer reads one stable shape.
  return c.json({ ...schemaRowToApi(created), warnings }, 201);
}

// §11.2 automatic generation: paste an example provider payload → inferred
// EDITABLE schema (Stage-A inferSchemaFromExample) → the same
// create-and-activate path with source='auto_from_example'.
export async function createPayloadSchemaFromExampleHandler(c: AdminContext): Promise<Response> {
  const row = await resolveOfferRow(c.env.DB, c.req.param("id") ?? "");
  if (row === null) return c.json({ error: "Not Found" }, 404);
  const body = await readJsonBody(c);
  if (body === null) return c.json({ error: "Invalid JSON body" }, 400);

  let example = body["example"];
  if (example === undefined) {
    return c.json({ error: "Validation failed", fields: { example: "example is required" } }, 400);
  }
  if (typeof example === "string") {
    try {
      example = JSON.parse(example) as unknown;
    } catch {
      return c.json(
        { error: "Validation failed", fields: { example: "example must be valid JSON" } },
        400,
      );
    }
  }

  const schema = inferSchemaFromExample(example);
  const validation = validatePayloadSchema(schema);
  if (!validation.ok) {
    // inferSchemaFromExample emits valid schemas by construction — this is a
    // defensive surface for degenerate inputs, never the normal path.
    return c.json(
      {
        error: "Validation failed",
        fields: { example: validation.errors[0]?.message ?? "inferred schema is invalid" },
        schema_errors: validation.errors,
      },
      400,
    );
  }

  const created = await createSchemaVersion(
    c.env.DB,
    row,
    schema as unknown as Record<string, unknown>,
    null,
    "auto_from_example",
  );
  if (created === null) return c.json({ error: "Insert failed" }, 500);
  return c.json(schemaRowToApi(created), 201);
}

// ---------------------------------------------------------------------------
// GET /verticals + /activities — 03 §8.2 Shared ("DISTINCT filter options,
// fixed-literal reads, like Listicles distinctOfferValues")
// ---------------------------------------------------------------------------

// DISTINCT non-empty values unioned from the three vertical/activity-carrying
// entities. Both statements are FIXED LITERALS — no user input, no column
// interpolation. Quotes store verticals as a JSON ARRAY (§7.3
// `verticals_json`), so that leg reads through json_each over the
// json_valid-filtered rows; sections/offers carry scalar columns.
const SHARED_VERTICALS_SQL = `SELECT DISTINCT v FROM (
  SELECT vertical AS v FROM leadgen_offers
  UNION SELECT vertical AS v FROM leadgen_sections
  UNION SELECT je.value AS v
    FROM (SELECT verticals_json FROM leadgen_quotes
          WHERE verticals_json IS NOT NULL AND json_valid(verticals_json)) q,
         json_each(q.verticals_json) AS je
) WHERE v IS NOT NULL AND v <> '' ORDER BY v ASC LIMIT 200`;

const SHARED_ACTIVITIES_SQL = `SELECT DISTINCT v FROM (
  SELECT activity AS v FROM leadgen_offers
  UNION SELECT activity AS v FROM leadgen_sections
  UNION SELECT activity AS v FROM leadgen_quotes
) WHERE v IS NOT NULL AND v <> '' ORDER BY v ASC LIMIT 200`;

// Non-string union members (a number in a quote's verticals array) are
// dropped here, mirroring the defensive filter the toolbar helper used.
async function distinctSharedValues(db: D1Database, sql: string): Promise<string[]> {
  const result = await db.prepare(sql).all<{ v: unknown }>();
  return (result.results ?? [])
    .map((r) => r.v)
    .filter((v): v is string => typeof v === "string" && v.length > 0);
}

export async function listVerticalsHandler(c: AdminContext): Promise<Response> {
  return c.json({ items: await distinctSharedValues(c.env.DB, SHARED_VERTICALS_SQL) });
}

export async function listActivitiesHandler(c: AdminContext): Promise<Response> {
  return c.json({ items: await distinctSharedValues(c.env.DB, SHARED_ACTIVITIES_SQL) });
}
