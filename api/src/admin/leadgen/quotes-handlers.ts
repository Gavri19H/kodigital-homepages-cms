// LeadGen Quotes admin API — the full contract 03 §8.2 Quotes block (Phase-7
// Stage B). Registered from router.ts, so the Cloudflare Access gate +
// ADMIN_HOST 404 wall + no-store headers apply unchanged (03 §8.1).
//
// Conventions (03 §8.4/§8.5, mirroring admin/listicles + leadgen offers +
// sections): success → `{ ...entity }` / `{ items, paging }`; failure →
// `{ error, fields? }` with 4xx. Handlers map Row→API on read (INTEGER bools →
// boolean, *_json parsed) and validate API→Row on write via the PURE Stage-A
// domain module (leadgen/funnel.ts — validateFunnelBuilder / validateFunnelRule
// / validateActivation + the branded funnel_id≠funnel_variant_id constructors).
// All SQL is .bind() parameterized over fixed-literal table names; JSON columns
// parse defensively (D1 rule).
//
// The SAVE path (PUT /variants/:id) is the §15.3/§15.5 replace-set: validate →
// resolve section refs → validate contiguous positions (auction runs after the
// MAX position, no "final" flag) → validate each funnel rule (redirect safety +
// the admin raw-URL allowlist) → replace-set leadgen_funnel_variant_sections +
// leadgen_funnel_rules in ONE atomic batch. The ordered sections + rules can
// never drift from the variant (idempotent replace-on-save).
//
// A/B lifecycle (§16.2 allocation / assignment / % traffic UI) is the P8 seam:
// this phase creates the leadgen_funnel_ab_tests row and flips its draft →
// running → stopped status (guarded by uq_leadgen_abtest_running), but NEVER
// computes traffic_allocation_bp buckets or session assignment — that ships in
// P8. Variant `/fork` is a real editable-clone (new lgn_), also a P8-adjacent
// affordance. Each seam is commented at its handler.

import { isPublicId, mintPublicId, type PublicIdKind } from "../../leadgen/ids";
import {
  auctionEntryPosition,
  resolveFunnelIdentity,
  toFunnelId,
  toFunnelVariantId,
  toQuoteId,
  validateActivation,
  validateFunnelBuilder,
  validateFunnelRule,
  type ActivationRowInput,
  type FunnelBuilderSection,
  type FunnelRuleInput,
} from "../../leadgen/funnel";
import { sha256Hex } from "../../public/leadgen/auction/parse";
import {
  rebuildDerivedIndexes,
  sectionValidationStatus,
  type LeadgenAnswerMapEdge,
  type OfferSchemaInfo,
} from "../../leadgen/sections";
import { evaluateDynamicOffersEligibility } from "../../leadgen/validation";
import type { LeadgenPayloadNodeType, LeadgenTransformStep } from "../../leadgen/payload";
import { getFunnelDesign, FUNNEL_DESIGNS } from "../../public/leadgen/designs/registry";
import { funnelChromeCss } from "../../public/leadgen/designs/default-funnel/styles";
import { renderSectionComponents } from "../../public/leadgen/components/presets";
import { flattenComponents, type LeadgenComponentNode } from "../../public/leadgen/components/content-schema";
import { buildPublicConfig, type LeadgenPublicConfig } from "../../public/leadgen/config-dto";
import {
  invalidateOnQuoteActivation,
  invalidateOnVariantPublish,
} from "../../public/leadgen/invalidate";
import type {
  ResolvedActivatedFunnel,
  ResolvedFunnelSection,
} from "../../public/leadgen/resolver";
import { singleControlAssignmentDims } from "../../public/leadgen/resolver";
// §16.2 Stage-A engine (consumed, never modified): the Σ==10000 allocation gate
// + the deterministic assignment (reused by the admin assignment preview so it
// can never drift from the runtime resolver's bucketing).
import { validateAbAllocations, assignVariant } from "../../public/leadgen/ab-hash";
import { escapeHtml } from "../templates/layout";
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
  LeadgenFunnelAbTestRow,
  LeadgenFunnelRow,
  LeadgenFunnelRuleRow,
  LeadgenFunnelRuleType,
  LeadgenFunnelVariantRow,
  LeadgenQuoteRow,
  LeadgenQuoteStatus,
  LeadgenSectionRow,
  LeadgenSiteQuoteRow,
} from "./db-types";

// ---------------------------------------------------------------------------
// small local helpers
// ---------------------------------------------------------------------------

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

// Sentinel for a syntactically-invalid integer input (distinct from a legit
// null = "absent"). Declared before its first use (TDZ-safe).
const INVALID = Symbol("invalid-int");

// numeric FK from either a number or a numeric string; null when absent/blank;
// INVALID when present but not an integer.
function asIntOrNull(value: unknown): number | null | typeof INVALID {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isInteger(value) ? value : INVALID;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return parseInt(value.trim(), 10);
  return INVALID;
}

// Parse a JSON string / array into a string[] (drops non-strings). Used for
// quote verticals_json (§15.1 verticals_json).
function parseStringArray(raw: unknown): string[] {
  let arr: unknown = raw;
  if (typeof raw === "string") {
    try {
      arr = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  return Array.isArray(arr) ? arr.filter((v): v is string => typeof v === "string") : [];
}

const QUOTE_STATUSES = ["draft", "active", "archived"] as const satisfies readonly LeadgenQuoteStatus[];
const FUNNEL_RULE_TYPES = [
  "redirect_direct_offer",
  "skip_section",
  "show_section",
  "eligibility",
  "disqualification",
  "auction_entry",
] as const satisfies readonly LeadgenFunnelRuleType[];

type FieldErrors = Record<string, string>;

// §15.5 admin raw-redirect allowlist: hosts an allowlisted raw `redirect_url`
// may target. Operator-configured via the optional LEADGEN_REDIRECT_URL_ALLOWLIST
// env var (comma-separated hosts); absent ⇒ [] ⇒ NO raw redirect is honored (the
// normal redirect_direct_offer→target_offer_id path is unaffected). Read through
// a local widening cast so the shared Env interface stays untouched.
function redirectAllowlist(env: AdminContext["env"]): string[] {
  const raw = (env as unknown as { LEADGEN_REDIRECT_URL_ALLOWLIST?: string })
    .LEADGEN_REDIRECT_URL_ALLOWLIST;
  if (typeof raw !== "string" || raw.trim() === "") return [];
  return raw
    .split(",")
    .map((h) => h.trim())
    .filter((h) => h !== "");
}

// ---------------------------------------------------------------------------
// §28 funnel-cache invalidation wiring (non-blocking, fail-open)
// ---------------------------------------------------------------------------

// Hono's c.executionCtx getter THROWS where no ExecutionContext exists (the
// node:sqlite unit-test harness passes none); mirror the runtime safeExecutionCtx
// idiom so §28 invalidation rides waitUntil where a context exists and degrades to
// a no-op where it doesn't. Invalidation is ALWAYS non-blocking and can NEVER
// break the admin write (also matches the listicles/leadgen runtime pattern).
function safeExecutionCtx(c: AdminContext): ExecutionContext {
  try {
    return c.executionCtx;
  } catch {
    return {
      waitUntil(): void {
        /* no-op outside workerd (unit-test harness) */
      },
      passThroughOnException(): void {
        /* no-op */
      },
    } as unknown as ExecutionContext;
  }
}

// §28 activation-change invalidation (enable / disable / slug / settings_overrides
// including the baked-in GA4 id) — evict this site's stale funnel shells + configs.
// Rides waitUntil; the .catch contains even the RED-LINE empty-site_id guard so the
// admin write is never broken (site_id is already non-empty here — defence in depth).
function scheduleActivationInvalidate(c: AdminContext, siteId: string): void {
  safeExecutionCtx(c).waitUntil(invalidateOnQuoteActivation(c.env, siteId).catch(() => {}));
}

// §28 variant-publish invalidation — the content_version bump is the correctness
// mechanism (a new key); this courtesy pass evicts the orphaned entries across
// EVERY site the funnel's quote is activated on, narrowed to that funnel. Resolves
// the funnel + its activated sites in the BACKGROUND (waitUntil) so the admin write
// returns immediately; fail-open. Used by both the variant SAVE and the fork.
function scheduleVariantPublishInvalidate(c: AdminContext, variant: LeadgenFunnelVariantRow): void {
  safeExecutionCtx(c).waitUntil(
    (async () => {
      const funnel = await c.env.DB.prepare(
        "SELECT public_id, quote_id FROM leadgen_funnels WHERE id = ? LIMIT 1",
      )
        .bind(variant.funnel_id)
        .first<{ public_id: string; quote_id: number }>();
      if (funnel === null) return;
      const sites = await readSiteQuotesForQuote(c.env.DB, funnel.quote_id);
      await Promise.all(
        sites.map((r) => invalidateOnVariantPublish(c.env, r.site_id, funnel.public_id)),
      );
    })().catch(() => {}),
  );
}

// ---------------------------------------------------------------------------
// Row → API mapping (03 §8.5)
// ---------------------------------------------------------------------------

function quoteRowToApi(row: LeadgenQuoteRow): Record<string, unknown> {
  return { ...row, verticals_json: parseStringArray(row.verticals_json) };
}

// leadgen_funnels row is API-stable (no INTEGER bools, no *_json) — served
// as-is + the stamped stable funnel_id (lgf_) via the branded constructor (G4).
function funnelRowToApi(row: LeadgenFunnelRow): Record<string, unknown> {
  return { ...row, funnel_id: toFunnelId(row.public_id) as string };
}

function abTestRowToApi(row: LeadgenFunnelAbTestRow): Record<string, unknown> {
  return { ...row };
}

function variantRowToApi(row: LeadgenFunnelVariantRow): Record<string, unknown> {
  return {
    ...row,
    // G4: the variant's public_id IS the funnel_variant_id (lgn_) — branded so
    // it can never be aliased into a funnel_id slot.
    funnel_variant_id: toFunnelVariantId(row.public_id) as string,
    is_control: row.is_control !== 0,
    lander_enabled: row.lander_enabled !== 0,
    lander_body_json: parseJsonColumn(row.lander_body_json),
    lander_cta_json: parseJsonColumn(row.lander_cta_json),
  };
}

function ruleRowToApi(row: LeadgenFunnelRuleRow): Record<string, unknown> {
  return {
    ...row,
    conditions_json: parseJsonColumn(row.conditions_json),
    redirect_url_allowlisted: row.redirect_url_allowlisted !== 0,
    enabled: row.enabled !== 0,
  };
}

function siteQuoteRowToApi(row: LeadgenSiteQuoteRow): Record<string, unknown> {
  return {
    ...row,
    enabled: row.enabled !== 0,
    settings_overrides_json: parseJsonColumn(row.settings_overrides_json),
  };
}

// ---------------------------------------------------------------------------
// dual-id resolution (03 §8.1) — either the numeric id or the public id
// ---------------------------------------------------------------------------

async function resolveRow<Row>(
  db: D1Database,
  table:
    | "leadgen_quotes"
    | "leadgen_funnels"
    | "leadgen_funnel_variants"
    | "leadgen_funnel_ab_tests",
  kind: PublicIdKind,
  idParam: string,
): Promise<Row | null> {
  const selector = idSelector(kind, idParam);
  if (selector === null) return null;
  const sql =
    selector.column === "id"
      ? `SELECT * FROM ${table} WHERE id = ? LIMIT 1`
      : `SELECT * FROM ${table} WHERE public_id = ? LIMIT 1`;
  const row = await db.prepare(sql).bind(selector.value).first<Row>();
  return row ?? null;
}

const resolveQuoteRow = (db: D1Database, id: string): Promise<LeadgenQuoteRow | null> =>
  resolveRow<LeadgenQuoteRow>(db, "leadgen_quotes", "quote", id);
const resolveFunnelRow = (db: D1Database, id: string): Promise<LeadgenFunnelRow | null> =>
  resolveRow<LeadgenFunnelRow>(db, "leadgen_funnels", "funnel", id);
const resolveVariantRow = (db: D1Database, id: string): Promise<LeadgenFunnelVariantRow | null> =>
  resolveRow<LeadgenFunnelVariantRow>(db, "leadgen_funnel_variants", "funnel_variant", id);
const resolveAbTestRow = (db: D1Database, id: string): Promise<LeadgenFunnelAbTestRow | null> =>
  resolveRow<LeadgenFunnelAbTestRow>(db, "leadgen_funnel_ab_tests", "funnel_ab_test", id);

// The quote that owns a variant (variant → funnel → quote). Needed for the
// §15.3 activity/vertical section-membership checks on PUT.
async function quoteOfVariant(
  db: D1Database,
  variant: LeadgenFunnelVariantRow,
): Promise<{ funnel: LeadgenFunnelRow; quote: LeadgenQuoteRow } | null> {
  const funnel = await db
    .prepare("SELECT * FROM leadgen_funnels WHERE id = ? LIMIT 1")
    .bind(variant.funnel_id)
    .first<LeadgenFunnelRow>();
  if (!funnel) return null;
  const quote = await db
    .prepare("SELECT * FROM leadgen_quotes WHERE id = ? LIMIT 1")
    .bind(funnel.quote_id)
    .first<LeadgenQuoteRow>();
  if (!quote) return null;
  return { funnel, quote };
}

// ---------------------------------------------------------------------------
// variant detail (variant + ordered sections + rules) — the §15.3 tree leaf
// ---------------------------------------------------------------------------

interface OrderedVariantSection {
  position: number;
  section_id: number;
  section_public_id: string;
  section_name: string;
  activity: string;
  vertical: string;
  status: string;
}

async function readVariantSections(
  db: D1Database,
  variantId: number,
): Promise<OrderedVariantSection[]> {
  const result = await db
    .prepare(
      `SELECT fvs.position AS position, s.id AS section_id, s.public_id AS section_public_id,
              s.section_name AS section_name, s.activity AS activity, s.vertical AS vertical, s.status AS status
       FROM leadgen_funnel_variant_sections fvs
       JOIN leadgen_sections s ON s.id = fvs.section_id
       WHERE fvs.variant_id = ? ORDER BY fvs.position ASC`,
    )
    .bind(variantId)
    .all<OrderedVariantSection>();
  return result.results ?? [];
}

async function readVariantRules(db: D1Database, variantId: number): Promise<LeadgenFunnelRuleRow[]> {
  const result = await db
    .prepare(
      "SELECT * FROM leadgen_funnel_rules WHERE variant_id = ? ORDER BY priority ASC, id ASC",
    )
    .bind(variantId)
    .all<LeadgenFunnelRuleRow>();
  return result.results ?? [];
}

async function variantDetailJson(
  db: D1Database,
  variant: LeadgenFunnelVariantRow,
): Promise<Record<string, unknown>> {
  const sections = await readVariantSections(db, variant.id);
  const rules = await readVariantRules(db, variant.id);
  return {
    ...variantRowToApi(variant),
    sections,
    rules: rules.map(ruleRowToApi),
    // §15.3 the auction runs after the MAX position section (derived, no
    // "final" flag). null when the variant has no sections yet.
    auction_entry_position: auctionEntryPosition(sections),
  };
}

async function readFunnelVariants(
  db: D1Database,
  funnelId: number,
): Promise<LeadgenFunnelVariantRow[]> {
  const result = await db
    .prepare(
      "SELECT * FROM leadgen_funnel_variants WHERE funnel_id = ? ORDER BY is_control DESC, id ASC",
    )
    .bind(funnelId)
    .all<LeadgenFunnelVariantRow>();
  return result.results ?? [];
}

// The funnel's ACTIVE variants — the arms of its running A/B test (the same
// funnel-scoping the runtime resolver assigns over). Drives the §16.2 Σ==10000
// gate on start + on a running-test allocation save.
async function readActiveFunnelVariants(
  db: D1Database,
  funnelId: number,
): Promise<LeadgenFunnelVariantRow[]> {
  const result = await db
    .prepare(
      "SELECT * FROM leadgen_funnel_variants WHERE funnel_id = ? AND status = 'active' ORDER BY is_control DESC, id ASC",
    )
    .bind(funnelId)
    .all<LeadgenFunnelVariantRow>();
  return result.results ?? [];
}

// True iff the funnel has a RUNNING A/B test (status='running',
// uq_leadgen_abtest_running → 0..1 per funnel). The single running-test detection
// reused by the allocation-PUT Σ guard AND the B1 arm-set/label freeze below.
async function funnelHasRunningTest(db: D1Database, funnelId: number): Promise<boolean> {
  const running = await db
    .prepare("SELECT id FROM leadgen_funnel_ab_tests WHERE funnel_id = ? AND status = 'running' LIMIT 1")
    .bind(funnelId)
    .first<{ id: number }>();
  return running !== null;
}

// B1 (contract 06 §16.2 line 35 / 09 §29 line 24): while a funnel has a RUNNING
// test, its ACTIVE-variant SET and the variant sort keys (variant_label — the
// ab-hash arm order, §16.2) are FROZEN. Runtime arms = the funnel's active
// variants (resolver.getActiveVariantsForFunnel); the §16.2 Σ==10000 gate + the
// revision bump run ONLY at start. A live relabel reorders the arms so a session's
// bucket maps to a DIFFERENT arm; a live add/fork grows Σ past 10000 — both with
// NO revision bump and NO Σ re-gate, silently corrupting the running comparison.
// The safe operator path is stop → edit → start (start re-gates Σ==10000, bumps
// the revision, and cleanly re-buckets). 409 Conflict = the funnel is in a running
// state that conflicts with the mutation. The allocation-PUT guard (which keeps
// Σ==10000 for allowed live allocation edits) is unchanged.
const RUNNING_TEST_ARM_LOCK_MESSAGE =
  "stop the running A/B test before changing its variants/labels";

// The funnel's A/B tests (newest first) — surfaced in the builder structure so
// the A/B tab shows lifecycle status + drives start/stop + the §16.2 assignment
// preview. At most one is status='running' (uq_leadgen_abtest_running).
async function readFunnelAbTests(
  db: D1Database,
  funnelId: number,
): Promise<LeadgenFunnelAbTestRow[]> {
  const result = await db
    .prepare("SELECT * FROM leadgen_funnel_ab_tests WHERE funnel_id = ? ORDER BY id DESC")
    .bind(funnelId)
    .all<LeadgenFunnelAbTestRow>();
  return result.results ?? [];
}

async function readQuoteFunnels(db: D1Database, quoteId: number): Promise<LeadgenFunnelRow[]> {
  const result = await db
    .prepare("SELECT * FROM leadgen_funnels WHERE quote_id = ? ORDER BY id ASC")
    .bind(quoteId)
    .all<LeadgenFunnelRow>();
  return result.results ?? [];
}

// Quote detail: the quote + its funnels, each with its variants (summary, no
// per-variant sections/rules — the full tree is /quotes/:id/structure).
async function quoteDetailJson(
  db: D1Database,
  quote: LeadgenQuoteRow,
): Promise<Record<string, unknown>> {
  const funnels = await readQuoteFunnels(db, quote.id);
  const funnelJson: Record<string, unknown>[] = [];
  for (const f of funnels) {
    const variants = await readFunnelVariants(db, f.id);
    funnelJson.push({ ...funnelRowToApi(f), variants: variants.map(variantRowToApi) });
  }
  return { ...quoteRowToApi(quote), funnels: funnelJson };
}

// ---------------------------------------------------------------------------
// GET /quotes — list + §9.4 filters (search/activity/status) + counts + pager
// ---------------------------------------------------------------------------

type QuoteListRow = LeadgenQuoteRow & {
  variant_count: number;
  active_sites_count: number;
  running_ab_count: number;
};

export async function listQuotesHandler(c: AdminContext): Promise<Response> {
  const search = c.req.query("search")?.trim() ?? "";
  const activity = c.req.query("activity")?.trim() ?? "";
  const status = c.req.query("status")?.trim() ?? "";

  if (status !== "" && !(QUOTE_STATUSES as readonly string[]).includes(status)) {
    return c.json(
      { error: "Validation failed", fields: { status: `status must be one of ${QUOTE_STATUSES.join("|")}` } },
      400,
    );
  }

  const like = `%${escapeLike(search)}%`;
  const filters: FilterCondition[] = [
    { when: search !== "", clause: "(quote_name LIKE ? ESCAPE '\\' OR activity LIKE ? ESCAPE '\\')", params: [like, like] },
    { when: activity !== "", clause: "activity = ?", params: [activity] },
    { when: status !== "", clause: "status = ?", params: [status] },
  ];
  const { clause, params } = buildWhereClause(filters);
  const { page, pageSize, offset } = parsePaging(c);

  const rows = await c.env.DB.prepare(
    `SELECT q.*,
       (SELECT COUNT(*) FROM leadgen_funnel_variants v
          JOIN leadgen_funnels f ON f.id = v.funnel_id
          WHERE f.quote_id = q.id AND v.status = 'active') AS variant_count,
       (SELECT COUNT(*) FROM leadgen_site_quotes sq
          WHERE sq.quote_id = q.id AND sq.enabled = 1) AS active_sites_count,
       (SELECT COUNT(*) FROM leadgen_funnel_ab_tests x
          JOIN leadgen_funnels f2 ON f2.id = x.funnel_id
          WHERE f2.quote_id = q.id AND x.status = 'running') AS running_ab_count
     FROM leadgen_quotes q
     WHERE ${clause} ORDER BY q.updated_at DESC, q.id DESC LIMIT ? OFFSET ?`,
  )
    .bind(...params, pageSize, offset)
    .all<QuoteListRow>();
  const totalRow = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM leadgen_quotes q WHERE ${clause}`)
    .bind(...params)
    .first<{ n: number }>();
  const total = Number(totalRow?.n ?? 0);

  return c.json({
    items: (rows.results ?? []).map((row) => ({
      ...quoteRowToApi(row),
      variant_count: Number(row.variant_count ?? 0),
      active_sites_count: Number(row.active_sites_count ?? 0),
      ab_status: Number(row.running_ab_count ?? 0) > 0 ? "running" : "none",
    })),
    paging: buildPaging(page, pageSize, total),
  });
}

// ---------------------------------------------------------------------------
// POST /quotes — create (§15.1) + auto-seed one Funnel (lgf_) + one control
// Variant (lgn_) so "every Quote has ≥1 funnel variant" holds on create.
// ---------------------------------------------------------------------------

function validateQuoteCreate(body: Record<string, unknown>): {
  errors: FieldErrors;
  value: { quote_name: string; activity: string; verticals: string[]; status: LeadgenQuoteStatus } | null;
} {
  const errors: FieldErrors = {};
  const quoteName = trimmedString(body["quote_name"]);
  if (quoteName === null) errors["quote_name"] = "quote_name is required";
  const activity = trimmedString(body["activity"]);
  if (activity === null) errors["activity"] = "activity is required";
  const verticals = parseStringArray(body["verticals"] ?? body["verticals_json"]);
  if (verticals.length === 0) errors["verticals"] = "at least one vertical is required";
  const statusRaw = body["status"];
  let status: LeadgenQuoteStatus = "draft";
  if (statusRaw !== undefined && statusRaw !== null) {
    if (typeof statusRaw !== "string" || !(QUOTE_STATUSES as readonly string[]).includes(statusRaw)) {
      errors["status"] = `status must be one of ${QUOTE_STATUSES.join("|")}`;
    } else {
      status = statusRaw as LeadgenQuoteStatus;
    }
  }
  if (Object.keys(errors).length > 0 || quoteName === null || activity === null) {
    return { errors, value: null };
  }
  return { errors, value: { quote_name: quoteName, activity, verticals, status } };
}

export async function createQuoteHandler(c: AdminContext): Promise<Response> {
  const body = await readJsonBody(c);
  if (body === null) return c.json({ error: "Invalid JSON body" }, 400);
  const { errors, value } = validateQuoteCreate(body);
  if (value === null) return c.json({ error: "Validation failed", fields: errors }, 400);

  const quotePublicId = mintPublicId("quote");
  const funnelPublicId = mintPublicId("funnel");
  const variantPublicId = mintPublicId("funnel_variant");
  const funnelName = trimmedString(body["funnel_name"]) ?? `${value.quote_name} — Funnel A`;

  // One atomic batch: quote → funnel (linked by the just-inserted quote's
  // public_id) → control variant (linked by the funnel's public_id). The
  // public_id subquery link is the sections-handlers derived-insert idiom.
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO leadgen_quotes (public_id, quote_name, activity, verticals_json, status)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind(quotePublicId, value.quote_name, value.activity, JSON.stringify(value.verticals), value.status),
    c.env.DB.prepare(
      `INSERT INTO leadgen_funnels (public_id, quote_id, funnel_name, status)
       VALUES (?, (SELECT id FROM leadgen_quotes WHERE public_id = ?), ?, 'active')`,
    ).bind(funnelPublicId, quotePublicId, funnelName),
    c.env.DB.prepare(
      `INSERT INTO leadgen_funnel_variants
         (public_id, funnel_id, variant_label, is_control, traffic_allocation_bp, funnel_design_id, status)
       VALUES (?, (SELECT id FROM leadgen_funnels WHERE public_id = ?), 'A', 1, 10000, 'default', 'active')`,
    ).bind(variantPublicId, funnelPublicId),
  ]);

  const quote = await c.env.DB.prepare("SELECT * FROM leadgen_quotes WHERE public_id = ? LIMIT 1")
    .bind(quotePublicId)
    .first<LeadgenQuoteRow>();
  if (!quote) return c.json({ error: "Insert failed" }, 500);
  return c.json(await quoteDetailJson(c.env.DB, quote), 201);
}

export async function getQuoteHandler(c: AdminContext): Promise<Response> {
  const row = await resolveQuoteRow(c.env.DB, c.req.param("id") ?? "");
  if (row === null) return c.json({ error: "Not Found" }, 404);
  return c.json(await quoteDetailJson(c.env.DB, row));
}

export async function patchQuoteHandler(c: AdminContext): Promise<Response> {
  const existing = await resolveQuoteRow(c.env.DB, c.req.param("id") ?? "");
  if (existing === null) return c.json({ error: "Not Found" }, 404);
  const body = await readJsonBody(c);
  if (body === null) return c.json({ error: "Invalid JSON body" }, 400);

  const errors: FieldErrors = {};
  let quoteName = existing.quote_name;
  let activity = existing.activity;
  let verticalsJson = existing.verticals_json;
  let status: LeadgenQuoteStatus = existing.status;
  let touched = false;

  if (body["quote_name"] !== undefined) {
    const v = trimmedString(body["quote_name"]);
    if (v === null) errors["quote_name"] = "quote_name cannot be empty";
    else { quoteName = v; touched = true; }
  }
  if (body["activity"] !== undefined) {
    const v = trimmedString(body["activity"]);
    if (v === null) errors["activity"] = "activity cannot be empty";
    else { activity = v; touched = true; }
  }
  if (body["verticals"] !== undefined || body["verticals_json"] !== undefined) {
    const v = parseStringArray(body["verticals"] ?? body["verticals_json"]);
    if (v.length === 0) errors["verticals"] = "at least one vertical is required";
    else { verticalsJson = JSON.stringify(v); touched = true; }
  }
  if (body["status"] !== undefined) {
    const s = body["status"];
    if (typeof s !== "string" || !(QUOTE_STATUSES as readonly string[]).includes(s)) {
      errors["status"] = `status must be one of ${QUOTE_STATUSES.join("|")}`;
    } else { status = s as LeadgenQuoteStatus; touched = true; }
  }
  if (Object.keys(errors).length > 0) return c.json({ error: "Validation failed", fields: errors }, 400);
  if (!touched) return c.json({ error: "No updatable fields provided" }, 400);

  await c.env.DB.prepare(
    `UPDATE leadgen_quotes SET quote_name = ?, activity = ?, verticals_json = ?, status = ?, updated_at = unixepoch()
     WHERE id = ?`,
  )
    .bind(quoteName, activity, verticalsJson, status, existing.id)
    .run();
  const updated = await c.env.DB.prepare("SELECT * FROM leadgen_quotes WHERE id = ? LIMIT 1")
    .bind(existing.id)
    .first<LeadgenQuoteRow>();
  if (!updated) return c.json({ error: "Update failed" }, 500);
  return c.json(await quoteDetailJson(c.env.DB, updated));
}

export async function deleteQuoteHandler(c: AdminContext): Promise<Response> {
  const row = await resolveQuoteRow(c.env.DB, c.req.param("id") ?? "");
  if (row === null) return c.json({ error: "Not Found" }, 404);
  await c.env.DB.prepare("UPDATE leadgen_quotes SET status = 'archived', updated_at = unixepoch() WHERE id = ?")
    .bind(row.id)
    .run();
  return c.json({ ok: true, id: row.id, public_id: row.public_id, status: "archived" });
}

// ---------------------------------------------------------------------------
// Funnels under a Quote (§6.2 / §15.1) — GET/POST /quotes/:id/funnels;
// GET/PATCH/DELETE /funnels/:id
// ---------------------------------------------------------------------------

export async function listQuoteFunnelsHandler(c: AdminContext): Promise<Response> {
  const quote = await resolveQuoteRow(c.env.DB, c.req.param("id") ?? "");
  if (quote === null) return c.json({ error: "Not Found" }, 404);
  const funnels = await readQuoteFunnels(c.env.DB, quote.id);
  const items: Record<string, unknown>[] = [];
  for (const f of funnels) {
    const variants = await readFunnelVariants(c.env.DB, f.id);
    items.push({ ...funnelRowToApi(f), variants: variants.map(variantRowToApi) });
  }
  return c.json({ items });
}

// Create a stable Funnel (lgf_) under the Quote + its control Variant (lgn_).
export async function createQuoteFunnelHandler(c: AdminContext): Promise<Response> {
  const quote = await resolveQuoteRow(c.env.DB, c.req.param("id") ?? "");
  if (quote === null) return c.json({ error: "Not Found" }, 404);
  const body = (await readJsonBody(c)) ?? {};
  const funnelName = trimmedString(body["funnel_name"]);
  if (funnelName === null) return c.json({ error: "Validation failed", fields: { funnel_name: "funnel_name is required" } }, 400);

  const funnelPublicId = mintPublicId("funnel");
  const variantPublicId = mintPublicId("funnel_variant");
  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO leadgen_funnels (public_id, quote_id, funnel_name, status) VALUES (?, ?, ?, 'active')",
    ).bind(funnelPublicId, quote.id, funnelName),
    c.env.DB.prepare(
      `INSERT INTO leadgen_funnel_variants
         (public_id, funnel_id, variant_label, is_control, traffic_allocation_bp, funnel_design_id, status)
       VALUES (?, (SELECT id FROM leadgen_funnels WHERE public_id = ?), 'A', 1, 10000, 'default', 'active')`,
    ).bind(variantPublicId, funnelPublicId),
  ]);
  const funnel = await c.env.DB.prepare("SELECT * FROM leadgen_funnels WHERE public_id = ? LIMIT 1")
    .bind(funnelPublicId)
    .first<LeadgenFunnelRow>();
  if (!funnel) return c.json({ error: "Insert failed" }, 500);
  const variants = await readFunnelVariants(c.env.DB, funnel.id);
  return c.json({ ...funnelRowToApi(funnel), variants: variants.map(variantRowToApi) }, 201);
}

export async function getFunnelHandler(c: AdminContext): Promise<Response> {
  const funnel = await resolveFunnelRow(c.env.DB, c.req.param("id") ?? "");
  if (funnel === null) return c.json({ error: "Not Found" }, 404);
  const variants = await readFunnelVariants(c.env.DB, funnel.id);
  return c.json({ ...funnelRowToApi(funnel), variants: variants.map(variantRowToApi) });
}

export async function patchFunnelHandler(c: AdminContext): Promise<Response> {
  const existing = await resolveFunnelRow(c.env.DB, c.req.param("id") ?? "");
  if (existing === null) return c.json({ error: "Not Found" }, 404);
  const body = await readJsonBody(c);
  if (body === null) return c.json({ error: "Invalid JSON body" }, 400);

  let funnelName = existing.funnel_name;
  let status = existing.status;
  let touched = false;
  const errors: FieldErrors = {};
  if (body["funnel_name"] !== undefined) {
    const v = trimmedString(body["funnel_name"]);
    if (v === null) errors["funnel_name"] = "funnel_name cannot be empty";
    else { funnelName = v; touched = true; }
  }
  if (body["status"] !== undefined) {
    const s = body["status"];
    if (typeof s !== "string" || !(QUOTE_STATUSES as readonly string[]).includes(s)) {
      errors["status"] = `status must be one of ${QUOTE_STATUSES.join("|")}`;
    } else { status = s as LeadgenQuoteStatus; touched = true; }
  }
  if (Object.keys(errors).length > 0) return c.json({ error: "Validation failed", fields: errors }, 400);
  if (!touched) return c.json({ error: "No updatable fields provided" }, 400);

  await c.env.DB.prepare(
    "UPDATE leadgen_funnels SET funnel_name = ?, status = ?, updated_at = unixepoch() WHERE id = ?",
  )
    .bind(funnelName, status, existing.id)
    .run();
  const updated = await c.env.DB.prepare("SELECT * FROM leadgen_funnels WHERE id = ? LIMIT 1")
    .bind(existing.id)
    .first<LeadgenFunnelRow>();
  if (!updated) return c.json({ error: "Update failed" }, 500);
  const variants = await readFunnelVariants(c.env.DB, updated.id);
  return c.json({ ...funnelRowToApi(updated), variants: variants.map(variantRowToApi) });
}

export async function deleteFunnelHandler(c: AdminContext): Promise<Response> {
  const funnel = await resolveFunnelRow(c.env.DB, c.req.param("id") ?? "");
  if (funnel === null) return c.json({ error: "Not Found" }, 404);
  await c.env.DB.prepare("UPDATE leadgen_funnels SET status = 'archived', updated_at = unixepoch() WHERE id = ?")
    .bind(funnel.id)
    .run();
  return c.json({ ok: true, id: funnel.id, public_id: funnel.public_id, status: "archived" });
}

// ---------------------------------------------------------------------------
// Variants — list/create under a Quote or a Funnel; the big PUT; fork; preview
// ---------------------------------------------------------------------------

// The Funnel a new variant attaches to: explicit funnel_id in the body, else
// the Quote's oldest funnel (auto-seeded on quote create).
async function pickFunnelForNewVariant(
  db: D1Database,
  quote: LeadgenQuoteRow,
  body: Record<string, unknown>,
): Promise<LeadgenFunnelRow | null | { error: string }> {
  const explicit = body["funnel_id"];
  if (explicit !== undefined && explicit !== null && explicit !== "") {
    const f = await resolveFunnelRow(db, String(explicit));
    if (f === null || f.quote_id !== quote.id) return { error: "funnel_id does not belong to this quote" };
    return f;
  }
  const funnels = await readQuoteFunnels(db, quote.id);
  return funnels[0] ?? null;
}

async function createVariantUnderFunnel(
  c: AdminContext,
  funnel: LeadgenFunnelRow,
  body: Record<string, unknown>,
): Promise<Response> {
  // B1: adding an ACTIVE variant to a funnel with a RUNNING test grows the arm set
  // (Σ past 10000) with no revision bump / Σ re-gate — refuse until the test stops.
  // Covers POST /quotes/:id/variants + POST /funnels/:id/variants (both land here).
  if (await funnelHasRunningTest(c.env.DB, funnel.id)) {
    return c.json({ error: RUNNING_TEST_ARM_LOCK_MESSAGE }, 409);
  }
  const existing = await readFunnelVariants(c.env.DB, funnel.id);
  const label = trimmedString(body["variant_label"]) ?? String.fromCharCode(65 + existing.length); // A, B, C…
  // First variant of a funnel defaults to control; additional variants are not.
  const isControl = asToggle(body["is_control"]) ?? existing.length === 0;
  const designId = trimmedString(body["funnel_design_id"]) ?? "default";
  const variantPublicId = mintPublicId("funnel_variant");
  await c.env.DB.prepare(
    `INSERT INTO leadgen_funnel_variants
       (public_id, funnel_id, variant_label, is_control, traffic_allocation_bp, funnel_design_id, status)
     VALUES (?, ?, ?, ?, ?, ?, 'active')`,
  )
    .bind(variantPublicId, funnel.id, label, isControl ? 1 : 0, 10000, designId)
    .run();
  const variant = await c.env.DB.prepare("SELECT * FROM leadgen_funnel_variants WHERE public_id = ? LIMIT 1")
    .bind(variantPublicId)
    .first<LeadgenFunnelVariantRow>();
  if (!variant) return c.json({ error: "Insert failed" }, 500);
  return c.json(await variantDetailJson(c.env.DB, variant), 201);
}

export async function listQuoteVariantsHandler(c: AdminContext): Promise<Response> {
  const quote = await resolveQuoteRow(c.env.DB, c.req.param("id") ?? "");
  if (quote === null) return c.json({ error: "Not Found" }, 404);
  const result = await c.env.DB.prepare(
    `SELECT v.* FROM leadgen_funnel_variants v
       JOIN leadgen_funnels f ON f.id = v.funnel_id
       WHERE f.quote_id = ? ORDER BY v.funnel_id ASC, v.is_control DESC, v.id ASC`,
  )
    .bind(quote.id)
    .all<LeadgenFunnelVariantRow>();
  return c.json({ items: (result.results ?? []).map(variantRowToApi) });
}

export async function createQuoteVariantHandler(c: AdminContext): Promise<Response> {
  const quote = await resolveQuoteRow(c.env.DB, c.req.param("id") ?? "");
  if (quote === null) return c.json({ error: "Not Found" }, 404);
  const body = (await readJsonBody(c)) ?? {};
  const funnel = await pickFunnelForNewVariant(c.env.DB, quote, body);
  if (funnel === null) return c.json({ error: "Validation failed", fields: { funnel_id: "quote has no funnel to attach the variant to" } }, 400);
  if ("error" in funnel) return c.json({ error: "Validation failed", fields: { funnel_id: funnel.error } }, 400);
  return createVariantUnderFunnel(c, funnel, body);
}

export async function listFunnelVariantsHandler(c: AdminContext): Promise<Response> {
  const funnel = await resolveFunnelRow(c.env.DB, c.req.param("id") ?? "");
  if (funnel === null) return c.json({ error: "Not Found" }, 404);
  const variants = await readFunnelVariants(c.env.DB, funnel.id);
  return c.json({ items: variants.map(variantRowToApi) });
}

export async function createFunnelVariantHandler(c: AdminContext): Promise<Response> {
  const funnel = await resolveFunnelRow(c.env.DB, c.req.param("id") ?? "");
  if (funnel === null) return c.json({ error: "Not Found" }, 404);
  const body = (await readJsonBody(c)) ?? {};
  return createVariantUnderFunnel(c, funnel, body);
}

// --- PUT /variants/:id — save lander/design/auction + section-order + rules ---

interface SectionOrderItem {
  section_id: number;
  position: number;
}

// Resolve + validate the ordered section list against the owning Quote
// (§15.3): each ref exists, is active, and matches the quote's activity + a
// quote vertical; positions are contiguous 0..n-1 (validateFunnelBuilder).
async function resolveSectionOrder(
  db: D1Database,
  quote: LeadgenQuoteRow,
  raw: unknown,
): Promise<{ items: SectionOrderItem[]; errors: FieldErrors }> {
  const errors: FieldErrors = {};
  if (!Array.isArray(raw)) {
    errors["sections"] = "sections must be an array of { section_id | section_public_id, position? }";
    return { items: [], errors };
  }
  const quoteVerticals = new Set(parseStringArray(quote.verticals_json));
  const items: SectionOrderItem[] = [];
  for (let i = 0; i < raw.length; i++) {
    const entry = raw[i];
    if (!isRecord(entry)) {
      errors[`sections.${i}`] = "each section entry must be an object";
      continue;
    }
    const ref = entry["section_id"] ?? entry["section_public_id"];
    if (ref === undefined || ref === null || ref === "") {
      errors[`sections.${i}`] = "section_id or section_public_id is required";
      continue;
    }
    const section = await resolveRowSection(db, String(ref));
    if (section === null) {
      errors[`sections.${i}`] = `unknown section ${String(ref)}`;
      continue;
    }
    if (section.status !== "active") {
      errors[`sections.${i}`] = `section ${section.public_id} is ${section.status} — only active sections can be ordered`;
      continue;
    }
    if (section.activity !== quote.activity) {
      errors[`sections.${i}`] = `section ${section.public_id} activity '${section.activity}' does not match the quote activity '${quote.activity}'`;
      continue;
    }
    if (quoteVerticals.size > 0 && !quoteVerticals.has(section.vertical)) {
      errors[`sections.${i}`] = `section ${section.public_id} vertical '${section.vertical}' is not one of the quote verticals`;
      continue;
    }
    const posRaw = entry["position"];
    const position = typeof posRaw === "number" ? posRaw : i;
    items.push({ section_id: section.id, position });
  }
  return { items, errors };
}

// Section resolver (dual-id) — local (sections-handlers owns the canonical one;
// this read stays inside the quotes module to keep the coupling one-directional).
async function resolveRowSection(db: D1Database, idParam: string): Promise<LeadgenSectionRow | null> {
  const selector = idSelector("section", idParam);
  if (selector === null) return null;
  const sql =
    selector.column === "id"
      ? "SELECT * FROM leadgen_sections WHERE id = ? LIMIT 1"
      : "SELECT * FROM leadgen_sections WHERE public_id = ? LIMIT 1";
  const row = await db.prepare(sql).bind(selector.value).first<LeadgenSectionRow>();
  return row ?? null;
}

interface PreparedRule {
  publicId: string;
  ruleType: LeadgenFunnelRuleType;
  conditionsJson: string;
  conditionsHash: string;
  targetOfferId: number | null;
  targetSectionId: number | null;
  redirectUrl: string | null;
  redirectAllowlisted: number;
  priority: number;
  enabled: number;
}

// Validate + prepare the funnel-rule replace-set (§15.5). Every rule runs
// through the Stage-A validateFunnelRule with the admin raw-redirect allowlist;
// conditions_json + conditions_hash (both NOT NULL) are computed here.
function prepareRules(raw: unknown, allowlist: string[]): { rules: PreparedRule[]; errors: FieldErrors } {
  const errors: FieldErrors = {};
  if (!Array.isArray(raw)) {
    errors["rules"] = "rules must be an array";
    return { rules: [], errors };
  }
  const rules: PreparedRule[] = [];
  for (let i = 0; i < raw.length; i++) {
    const entry = raw[i];
    if (!isRecord(entry)) {
      errors[`rules.${i}`] = "each rule must be an object";
      continue;
    }
    const ruleType = entry["rule_type"];
    if (typeof ruleType !== "string" || !(FUNNEL_RULE_TYPES as readonly string[]).includes(ruleType)) {
      errors[`rules.${i}.rule_type`] = `rule_type must be one of ${FUNNEL_RULE_TYPES.join("|")}`;
      continue;
    }
    const targetOfferId = asIntOrNull(entry["target_offer_id"]);
    if (targetOfferId === INVALID) { errors[`rules.${i}.target_offer_id`] = "target_offer_id must be an integer id"; continue; }
    const targetSectionId = asIntOrNull(entry["target_section_id"]);
    if (targetSectionId === INVALID) { errors[`rules.${i}.target_section_id`] = "target_section_id must be an integer id"; continue; }
    const conditions = entry["conditions_json"] ?? entry["conditions"] ?? { groups: [] };
    const redirectUrl = trimmedString(entry["redirect_url"]);
    const redirectAllowlisted = asToggle(entry["redirect_url_allowlisted"]) ?? false;
    const priorityRaw = entry["priority"];
    const priority = typeof priorityRaw === "number" ? priorityRaw : 100;
    const enabled = asToggle(entry["enabled"]) ?? true;

    const ruleInput: FunnelRuleInput = {
      rule_type: ruleType,
      target_offer_id: targetOfferId,
      target_section_id: targetSectionId,
      redirect_url: redirectUrl,
      redirect_url_allowlisted: redirectAllowlisted,
      conditions_json: conditions,
      priority,
    };
    const verdict = validateFunnelRule(ruleInput, allowlist);
    if (!verdict.ok) {
      errors[`rules.${i}`] = verdict.errors.map((e) => `${e.code}: ${e.message}`).join("; ");
      continue;
    }
    const conditionsJson = JSON.stringify(conditions);
    rules.push({
      publicId: mintPublicId("funnel_rule"),
      ruleType: ruleType as LeadgenFunnelRuleType,
      conditionsJson,
      conditionsHash: sha256Hex(conditionsJson),
      targetOfferId,
      targetSectionId,
      redirectUrl,
      redirectAllowlisted: redirectAllowlisted ? 1 : 0,
      priority,
      enabled: enabled ? 1 : 0,
    });
  }
  return { rules, errors };
}

export async function putVariantHandler(c: AdminContext): Promise<Response> {
  const variant = await resolveVariantRow(c.env.DB, c.req.param("id") ?? "");
  if (variant === null) return c.json({ error: "Not Found" }, 404);
  const body = await readJsonBody(c);
  if (body === null) return c.json({ error: "Invalid JSON body" }, 400);

  const owner = await quoteOfVariant(c.env.DB, variant);
  if (owner === null) return c.json({ error: "Not Found" }, 404);

  // B1: refuse a variant_label CHANGE on an ACTIVE arm while the funnel has a
  // running test — relabelling reorders the ab-hash arm set (assignVariant sorts
  // by variant_label), silently remapping every session's bucket to a DIFFERENT
  // arm with no revision bump. Only a real change is blocked (a no-op relabel or a
  // save that omits variant_label is unaffected, as are allocation/lander edits).
  if (body["variant_label"] !== undefined) {
    const newLabel = trimmedString(body["variant_label"]);
    if (
      newLabel !== null &&
      newLabel !== variant.variant_label &&
      variant.status === "active" &&
      (await funnelHasRunningTest(c.env.DB, variant.funnel_id))
    ) {
      return c.json({ error: RUNNING_TEST_ARM_LOCK_MESSAGE }, 409);
    }
  }

  const errors: FieldErrors = {};

  // --- scalar / lander / design / auction fields (merge over existing) ------
  let landerEnabled = variant.lander_enabled;
  if (body["lander_enabled"] !== undefined) {
    const v = asToggle(body["lander_enabled"]);
    if (v === null) errors["lander_enabled"] = "lander_enabled must be a boolean";
    else landerEnabled = v ? 1 : 0;
  }
  const landerHeadline = body["lander_headline"] !== undefined ? trimmedString(body["lander_headline"]) : variant.lander_headline;
  const landerSub = body["lander_subheadline"] !== undefined ? trimmedString(body["lander_subheadline"]) : variant.lander_subheadline;
  const landerBody = body["lander_body_json"] !== undefined ? jsonStringOrNull(body["lander_body_json"]) : variant.lander_body_json;
  const landerCta = body["lander_cta_json"] !== undefined ? jsonStringOrNull(body["lander_cta_json"]) : variant.lander_cta_json;
  const landerHeroUrl = body["lander_hero_media_url"] !== undefined ? trimmedString(body["lander_hero_media_url"]) : variant.lander_hero_media_url;

  let designId = variant.funnel_design_id;
  if (body["funnel_design_id"] !== undefined) {
    const v = trimmedString(body["funnel_design_id"]);
    designId = v ?? "default"; // §14.1 unknown/blank id resolves to default at render
  }

  let auctionId: number | null = variant.auction_id;
  if (body["auction_id"] !== undefined) {
    const parsed = asIntOrNull(body["auction_id"]);
    if (parsed === INVALID) errors["auction_id"] = "auction_id must be an integer id";
    else if (parsed === null) auctionId = null;
    else {
      // §15 "optional FK picker" — the auction is created in P9; here we only
      // verify the referenced leadgen_auctions row exists.
      const exists = await c.env.DB.prepare("SELECT id FROM leadgen_auctions WHERE id = ? LIMIT 1").bind(parsed).first<{ id: number }>();
      if (!exists) errors["auction_id"] = `auction ${parsed} does not exist`;
      else auctionId = parsed;
    }
  }

  let variantLabel = variant.variant_label;
  if (body["variant_label"] !== undefined) {
    const v = trimmedString(body["variant_label"]);
    if (v !== null) variantLabel = v;
  }
  let isControl = variant.is_control;
  if (body["is_control"] !== undefined) {
    const v = asToggle(body["is_control"]);
    if (v === null) errors["is_control"] = "is_control must be a boolean";
    else isControl = v ? 1 : 0;
  }
  let trafficBp = variant.traffic_allocation_bp;
  if (body["traffic_allocation_bp"] !== undefined) {
    const v = body["traffic_allocation_bp"];
    // Range-check here; a CHANGE on a running test's active arm is refused
    // below (§16.2 — rebalance via stop→edit→start). Draft allocations are
    // tuned freely (start is the hard Σ gate). UI sends bp (= percent * 100).
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 10000) errors["traffic_allocation_bp"] = "traffic_allocation_bp must be an integer 0..10000";
    else trafficBp = v;
  }

  // --- section order (§15.3 replace-set) ------------------------------------
  const sectionsProvided = body["sections"] !== undefined;
  let sectionItems: SectionOrderItem[] = [];
  if (sectionsProvided) {
    const resolved = await resolveSectionOrder(c.env.DB, owner.quote, body["sections"]);
    Object.assign(errors, resolved.errors);
    sectionItems = resolved.items;
    if (Object.keys(resolved.errors).length === 0) {
      const forValidation: FunnelBuilderSection[] = sectionItems.map((s) => ({ position: s.position }));
      const verdict = validateFunnelBuilder(forValidation);
      if (!verdict.ok) {
        errors["sections"] = verdict.errors.map((e) => `${e.code}: ${e.message}`).join("; ");
      }
    }
  }

  // --- funnel rules (§15.5 replace-set) -------------------------------------
  const rulesProvided = body["rules"] !== undefined;
  let preparedRules: PreparedRule[] = [];
  if (rulesProvided) {
    const prep = prepareRules(body["rules"], redirectAllowlist(c.env));
    Object.assign(errors, prep.errors);
    preparedRules = prep.rules;
    // FK existence for rule targets (leadgen_funnel_rules FKs are enforced by
    // D1) — a clean 400 rather than a 500 on a dangling target_offer_id /
    // target_section_id.
    if (Object.keys(errors).length === 0) {
      const offerIds = Array.from(new Set(preparedRules.map((r) => r.targetOfferId).filter((v): v is number => v !== null)));
      const sectionIds = Array.from(new Set(preparedRules.map((r) => r.targetSectionId).filter((v): v is number => v !== null)));
      for (const oid of offerIds) {
        const ex = await c.env.DB.prepare("SELECT id FROM leadgen_offers WHERE id = ? LIMIT 1").bind(oid).first<{ id: number }>();
        if (!ex) errors[`rules.target_offer_id.${oid}`] = `offer ${oid} does not exist`;
      }
      for (const sid of sectionIds) {
        const ex = await c.env.DB.prepare("SELECT id FROM leadgen_sections WHERE id = ? LIMIT 1").bind(sid).first<{ id: number }>();
        if (!ex) errors[`rules.target_section_id.${sid}`] = `section ${sid} does not exist`;
      }
    }
  }

  // §16.2 line 35: "changing allocations … bumps the revision and cleanly
  // re-buckets." A running test must therefore NEVER take a silent in-place
  // allocation edit — the stored split would diverge from the actual (unchanged-
  // revision) session assignment, silently corrupting the comparison (§29). So
  // — consistently with the B1 arm-set/label freeze — a traffic_allocation_bp
  // CHANGE on an ACTIVE variant whose funnel has a RUNNING test is REFUSED (409):
  // the operator rebalances via stop → edit → start, and START bumps the
  // revision + re-gates Σ==10000 + cleanly re-buckets. Draft tuning is free
  // (no running test → range-check only, start is the hard gate).
  if (
    body["traffic_allocation_bp"] !== undefined &&
    trafficBp !== variant.traffic_allocation_bp &&
    variant.status === "active" &&
    (await funnelHasRunningTest(c.env.DB, variant.funnel_id))
  ) {
    return c.json({ error: RUNNING_TEST_ARM_LOCK_MESSAGE }, 409);
  }

  if (Object.keys(errors).length > 0) return c.json({ error: "Validation failed", fields: errors }, 400);

  // --- one atomic replace-set batch -----------------------------------------
  const statements: D1PreparedStatement[] = [
    c.env.DB.prepare(
      `UPDATE leadgen_funnel_variants SET
         variant_label = ?, is_control = ?, traffic_allocation_bp = ?, funnel_design_id = ?, auction_id = ?,
         lander_enabled = ?, lander_headline = ?, lander_subheadline = ?, lander_body_json = ?,
         lander_hero_media_url = ?, lander_cta_json = ?, content_version = content_version + 1
       WHERE id = ?`,
    ).bind(
      variantLabel, isControl, trafficBp, designId, auctionId,
      landerEnabled, landerHeadline, landerSub, landerBody,
      landerHeroUrl, landerCta, variant.id,
    ),
  ];
  if (sectionsProvided) {
    statements.push(c.env.DB.prepare("DELETE FROM leadgen_funnel_variant_sections WHERE variant_id = ?").bind(variant.id));
    for (const s of sectionItems) {
      statements.push(
        c.env.DB.prepare(
          "INSERT INTO leadgen_funnel_variant_sections (variant_id, section_id, position) VALUES (?, ?, ?)",
        ).bind(variant.id, s.section_id, s.position),
      );
    }
  }
  if (rulesProvided) {
    statements.push(c.env.DB.prepare("DELETE FROM leadgen_funnel_rules WHERE variant_id = ?").bind(variant.id));
    for (const r of preparedRules) {
      statements.push(
        c.env.DB.prepare(
          `INSERT INTO leadgen_funnel_rules
             (public_id, variant_id, rule_type, conditions_json, conditions_hash, target_offer_id, target_section_id,
              redirect_url, redirect_url_allowlisted, priority, enabled)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          r.publicId, variant.id, r.ruleType, r.conditionsJson, r.conditionsHash, r.targetOfferId, r.targetSectionId,
          r.redirectUrl, r.redirectAllowlisted, r.priority, r.enabled,
        ),
      );
    }
  }
  await c.env.DB.batch(statements);

  const updated = await c.env.DB.prepare("SELECT * FROM leadgen_funnel_variants WHERE id = ? LIMIT 1")
    .bind(variant.id)
    .first<LeadgenFunnelVariantRow>();
  if (!updated) return c.json({ error: "Update failed" }, 500);
  // §28: the content_version bump above already mints a fresh lg-shell:/lg-config:
  // key; evict the orphaned prior entries (courtesy) across the funnel's activated
  // sites. Non-blocking; never breaks the save.
  scheduleVariantPublishInvalidate(c, variant);
  // R5 (05 §5.2a): every variant save RECOMPUTES + stores the activation
  // preflight verdict (advisory copy; the activation PUT recomputes its own).
  const preflight = await storeVariantPreflight(c, updated, owner.quote);
  return c.json({ ...(await variantDetailJson(c.env.DB, updated)), activation_preflight: preflight });
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

// POST /variants/:id/fork — clone a variant to a new editable copy (new lgn_).
// P8-adjacent: fork produces an editable, non-control variant under the SAME
// stable funnel, cloning lander/design/auction + the ordered sections + rules.
// The running-allocation lifecycle (which variant serves what % of traffic)
// remains the P8 seam.
export async function forkVariantHandler(c: AdminContext): Promise<Response> {
  const source = await resolveVariantRow(c.env.DB, c.req.param("id") ?? "");
  if (source === null) return c.json({ error: "Not Found" }, 404);

  // B1: a fork inserts a new ACTIVE variant under the source's funnel → grows the
  // running test's arm set silently. Refuse while that funnel has a running test
  // (simplest + safest; the operator path is stop → fork → start).
  if (await funnelHasRunningTest(c.env.DB, source.funnel_id)) {
    return c.json({ error: RUNNING_TEST_ARM_LOCK_MESSAGE }, 409);
  }

  const existing = await readFunnelVariants(c.env.DB, source.funnel_id);
  const newLabel = `${source.variant_label}-fork-${existing.length}`;
  const variantPublicId = mintPublicId("funnel_variant");

  // Read the source's ordered sections + rules BEFORE the write batch (reads).
  const srcSections = await readVariantSections(c.env.DB, source.id);
  const srcRules = await readVariantRules(c.env.DB, source.id);

  // ONE atomic batch (mirrors the POST /quotes create idiom): the variant
  // INSERT runs first, then the section + rule clones link to it via a
  // `(SELECT id FROM leadgen_funnel_variants WHERE public_id = ?)` subquery — so
  // the whole fork commits or rolls back together and a mid-failure can never
  // orphan a variant with no sections/rules. Each INSERT is single-row
  // (≤17 bindings) — 100-binding-safe.
  const statements: D1PreparedStatement[] = [
    c.env.DB.prepare(
      `INSERT INTO leadgen_funnel_variants
         (public_id, funnel_id, ab_test_id, variant_label, is_control, traffic_allocation_bp, funnel_design_id,
          auction_id, lander_enabled, lander_headline, lander_subheadline, lander_body_json,
          lander_hero_media_id, lander_hero_media_url, lander_cta_json, content_version, status)
       VALUES (?, ?, NULL, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'active')`,
    ).bind(
      variantPublicId, source.funnel_id, newLabel, source.traffic_allocation_bp, source.funnel_design_id,
      source.auction_id, source.lander_enabled, source.lander_headline, source.lander_subheadline, source.lander_body_json,
      source.lander_hero_media_id, source.lander_hero_media_url, source.lander_cta_json,
    ),
  ];
  for (const s of srcSections) {
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO leadgen_funnel_variant_sections (variant_id, section_id, position)
         VALUES ((SELECT id FROM leadgen_funnel_variants WHERE public_id = ?), ?, ?)`,
      ).bind(variantPublicId, s.section_id, s.position),
    );
  }
  for (const r of srcRules) {
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO leadgen_funnel_rules
           (public_id, variant_id, rule_type, conditions_json, conditions_hash, target_offer_id, target_section_id,
            redirect_url, redirect_url_allowlisted, priority, enabled)
         VALUES (?, (SELECT id FROM leadgen_funnel_variants WHERE public_id = ?), ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        mintPublicId("funnel_rule"), variantPublicId, r.rule_type, r.conditions_json, r.conditions_hash, r.target_offer_id,
        r.target_section_id, r.redirect_url, r.redirect_url_allowlisted, r.priority, r.enabled,
      ),
    );
  }
  await c.env.DB.batch(statements);

  const forked = await c.env.DB.prepare("SELECT * FROM leadgen_funnel_variants WHERE public_id = ? LIMIT 1")
    .bind(variantPublicId)
    .first<LeadgenFunnelVariantRow>();
  if (!forked) return c.json({ error: "Insert failed" }, 500);

  // §28: a fork is a variant-publish-class event — evict the source funnel's
  // orphaned entries across its activated sites (courtesy). Non-blocking; fail-open.
  scheduleVariantPublishInvalidate(c, source);
  return c.json({ forked_from: source.public_id, ...(await variantDetailJson(c.env.DB, forked)) }, 201);
}

// --- POST /variants/:id/preview — server-render the whole funnel (no persist) -

// Build a preview ResolvedActivatedFunnel bundle from a variant WITHOUT a site
// activation (preview is standalone). buildPublicConfig reads only
// quote/funnel/variant/sections/ga4 — never the synthesized site_quote row.
function buildPreviewResolved(
  quote: LeadgenQuoteRow,
  funnel: LeadgenFunnelRow,
  variant: LeadgenFunnelVariantRow,
  sections: LeadgenSectionRow[],
): ResolvedActivatedFunnel {
  const previewSiteQuote: LeadgenSiteQuoteRow = {
    id: 0, site_id: "preview", quote_id: quote.id, enabled: 0, slug: null,
    settings_overrides_json: null, created_at: 0, updated_at: 0,
  };
  const resolvedSections: ResolvedFunnelSection[] = sections.map((section, index) => ({ position: index, section }));
  return {
    site_quote: previewSiteQuote,
    quote,
    funnel,
    variant,
    sections: resolvedSections,
    ga4_measurement_id: null,
    // Preview renders the chosen variant directly (no site activation, no
    // running test) → the single_control §16.3 dims for that variant.
    assignment: singleControlAssignmentDims(variant),
  };
}

function parseSectionNodes(contentJson: string): LeadgenComponentNode[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(contentJson);
  } catch {
    return [];
  }
  if (!isRecord(parsed)) return [];
  const components = parsed["components"];
  return Array.isArray(components) ? (components as LeadgenComponentNode[]) : [];
}

// §15.2 opening-lander preview block — plain, fully escaped author text.
function renderLanderHtml(variant: LeadgenFunnelVariantRow): string {
  if (variant.lander_enabled === 0) return "";
  const headline = variant.lander_headline ?? "";
  const sub = variant.lander_subheadline ?? "";
  const hero = variant.lander_hero_media_url;
  const heroHtml = hero ? `<img class="lg-lander-hero" src="${escapeHtml(hero)}" alt="" />` : "";
  return `<div class="lg-lander" data-lander="1">
  ${heroHtml}
  ${headline ? `<h1 class="lg-lander-headline">${escapeHtml(headline)}</h1>` : ""}
  ${sub ? `<p class="lg-lander-sub">${escapeHtml(sub)}</p>` : ""}
</div>`;
}

export async function previewVariantHandler(c: AdminContext): Promise<Response> {
  const variant = await resolveVariantRow(c.env.DB, c.req.param("id") ?? "");
  if (variant === null) return c.json({ error: "Not Found" }, 404);
  const owner = await quoteOfVariant(c.env.DB, variant);
  if (owner === null) return c.json({ error: "Not Found" }, 404);

  const orderedRefs = await readVariantSections(c.env.DB, variant.id);
  const sections: LeadgenSectionRow[] = [];
  for (const ref of orderedRefs) {
    const row = await c.env.DB.prepare("SELECT * FROM leadgen_sections WHERE id = ? LIMIT 1")
      .bind(ref.section_id)
      .first<LeadgenSectionRow>();
    if (row) sections.push(row);
  }

  const design = getFunnelDesign(variant.funnel_design_id);
  const resolved = buildPreviewResolved(owner.quote, owner.funnel, variant, sections);
  // Reuse the Stage-A pure config-dto builder — this also exercises the G4
  // branded funnel_id≠funnel_variant_id constructors on the preview path.
  const config: LeadgenPublicConfig = buildPublicConfig(resolved, design);

  const maxPosition = auctionEntryPosition(resolved.sections.map((s) => ({ position: s.position })));
  const sectionsHtml = resolved.sections
    .map((rs) => {
      const nodes = parseSectionNodes(rs.section.content_json);
      const body = renderSectionComponents(nodes, design);
      const auctionMark =
        maxPosition !== null && rs.position === maxPosition
          ? `<div class="lg-auction-entry" data-auction-after-position="${rs.position}">Auction runs after this section (§15.3 max position)</div>`
          : "";
      return `<section class="lg-funnel-section" data-position="${rs.position}"><h2 class="lg-section-headline">${escapeHtml(rs.section.headline_text)}</h2><div class="lg-content">${body}</div>${auctionMark}</section>`;
    })
    .join("");

  const inner = `${renderLanderHtml(variant)}${sectionsHtml}`;
  const wrap = (viewport: "desktop" | "mobile", maxWidth: string): string =>
    `<div data-funnel-design="${design.id}" data-viewport="${viewport}" class="lg-preview lg-preview-${viewport}" style="max-width:${maxWidth};margin:0 auto">${inner}</div>`;

  return c.json({
    preview: {
      css: funnelChromeCss(design),
      desktop: wrap("desktop", design.header.contentMaxWidth),
      mobile: wrap("mobile", design.breakpoints.mobileMax),
      section_count: resolved.sections.length,
      auction_entry_position: maxPosition,
    },
    config,
  });
}

// ---------------------------------------------------------------------------
// GET /quotes/:id/structure — the full builder tree (§15.3)
// funnel_id (lgf_) ≠ funnel_variant_id (lgn_) stamped on every node (G4).
// ---------------------------------------------------------------------------

export async function quoteStructureHandler(c: AdminContext): Promise<Response> {
  const quote = await resolveQuoteRow(c.env.DB, c.req.param("id") ?? "");
  if (quote === null) return c.json({ error: "Not Found" }, 404);

  const funnels = await readQuoteFunnels(c.env.DB, quote.id);
  const funnelTree: Record<string, unknown>[] = [];
  for (const funnel of funnels) {
    const variants = await readFunnelVariants(c.env.DB, funnel.id);
    const variantTree: Record<string, unknown>[] = [];
    for (const variant of variants) {
      const sections = await readVariantSections(c.env.DB, variant.id);
      const rules = await readVariantRules(c.env.DB, variant.id);
      // G4 identity proof: assemble a proven-distinct triple through the
      // Stage-A branded constructors (funnel_id ≠ funnel_variant_id, never
      // aliased). Throws only if the two ever collide — they cannot.
      const identity = resolveFunnelIdentity(quote.public_id, funnel.public_id, variant.public_id);
      variantTree.push({
        ...variantRowToApi(variant),
        funnel_id: identity.funnel_id as string,
        funnel_variant_id: identity.funnel_variant_id as string,
        sections,
        rules: rules.map(ruleRowToApi),
        auction_entry_position: auctionEntryPosition(sections),
      });
    }
    const abTests = await readFunnelAbTests(c.env.DB, funnel.id);
    funnelTree.push({
      ...funnelRowToApi(funnel),
      funnel_id: toFunnelId(funnel.public_id) as string,
      variants: variantTree,
      // §16 A/B tests for this funnel (newest first); the running one (0..1)
      // drives the A/B tab's start/stop + the §16.2 assignment preview.
      ab_tests: abTests.map(abTestRowToApi),
    });
  }

  return c.json({
    quote: { ...quoteRowToApi(quote), quote_id: toQuoteId(quote.public_id) as string },
    funnels: funnelTree,
  });
}

// ---------------------------------------------------------------------------
// GET /quotes/:id/analytics — §15.6 per-funnel metrics (NULLIF ratios at read)
// ---------------------------------------------------------------------------

interface QuoteFunnelMetricRow {
  funnel_id: string;
  funnel_name: string | null;
  visits: number | null;
  unique_visits: number | null;
  bounces: number | null;
  completions: number | null;
  clicks: number | null;
  conversions: number | null;
  unfilled: number | null;
  revenue: number | null;
  bounce_rate: number | null;
  completion_rate: number | null;
  cvr_clicks: number | null;
  cvr_completed: number | null;
  unfilled_rate: number | null;
  avg_rpc: number | null;
  avg_rps: number | null;
}

export async function quoteAnalyticsHandler(c: AdminContext): Promise<Response> {
  const quote = await resolveQuoteRow(c.env.DB, c.req.param("id") ?? "");
  if (quote === null) return c.json({ error: "Not Found" }, 404);
  const range = parseDateRange(c);
  if ("error" in range) return c.json({ error: "Validation failed", fields: { range: range.error } }, 400);

  // §15.6 per-funnel roll-up keyed by funnel_id + funnel_name; every ratio
  // NULLIF-guarded (a zero denominator → NULL → the UI renders "—", never a
  // fake 0). Both cvr surfaces per §15.6 (conversions/clicks + conversions/
  // completed).
  const perFunnel = await c.env.DB.prepare(
    `SELECT funnel_id, funnel_name,
       SUM(visits) AS visits, SUM(unique_visits) AS unique_visits, SUM(bounces) AS bounces,
       SUM(completions) AS completions, SUM(clicks) AS clicks, SUM(conversions) AS conversions,
       SUM(unfilled) AS unfilled, SUM(revenue) AS revenue,
       CAST(SUM(bounces) AS REAL) / NULLIF(SUM(visits), 0) AS bounce_rate,
       CAST(SUM(completions) AS REAL) / NULLIF(SUM(visits), 0) AS completion_rate,
       CAST(SUM(conversions) AS REAL) / NULLIF(SUM(clicks), 0) AS cvr_clicks,
       CAST(SUM(conversions) AS REAL) / NULLIF(SUM(completions), 0) AS cvr_completed,
       CAST(SUM(unfilled) AS REAL) / NULLIF(SUM(visits), 0) AS unfilled_rate,
       SUM(revenue) / NULLIF(SUM(clicks), 0) AS avg_rpc,
       SUM(revenue) / NULLIF(SUM(visits), 0) AS avg_rps
     FROM leadgen_analytics_quote
     WHERE quote_public_id = ? AND date BETWEEN ? AND ?
     GROUP BY funnel_id, funnel_name
     ORDER BY funnel_id ASC`,
  )
    .bind(quote.public_id, range.from, range.to)
    .all<QuoteFunnelMetricRow>();

  // §15.6 breakdowns from _quote_drilldown (issue 30) — a couple of GROUP BY
  // dimensions (site + traffic_source), same NULLIF-at-read discipline.
  const bySite = await c.env.DB.prepare(
    `SELECT site_id, SUM(views) AS views, SUM(clicks) AS clicks, SUM(conversions) AS conversions, SUM(revenue) AS revenue
     FROM leadgen_analytics_quote_drilldown
     WHERE quote_public_id = ? AND date BETWEEN ? AND ?
     GROUP BY site_id ORDER BY site_id ASC`,
  )
    .bind(quote.public_id, range.from, range.to)
    .all<{ site_id: string | null; views: number | null; clicks: number | null; conversions: number | null; revenue: number | null }>();

  const bySource = await c.env.DB.prepare(
    `SELECT traffic_source, SUM(views) AS views, SUM(clicks) AS clicks, SUM(conversions) AS conversions, SUM(revenue) AS revenue
     FROM leadgen_analytics_quote_drilldown
     WHERE quote_public_id = ? AND date BETWEEN ? AND ?
     GROUP BY traffic_source ORDER BY traffic_source ASC`,
  )
    .bind(quote.public_id, range.from, range.to)
    .all<{ traffic_source: string | null; views: number | null; clicks: number | null; conversions: number | null; revenue: number | null }>();

  return c.json({
    analytics: {
      from: range.from,
      to: range.to,
      funnels: (perFunnel.results ?? []).map((r) => ({
        funnel_id: r.funnel_id,
        funnel_name: r.funnel_name,
        visits: r.visits ?? 0,
        unique_visits: r.unique_visits ?? 0,
        bounces: r.bounces ?? 0,
        completions: r.completions ?? 0,
        clicks: r.clicks ?? 0,
        conversions: r.conversions ?? 0,
        unfilled: r.unfilled ?? 0,
        revenue: r.revenue ?? 0,
        bounce_rate: r.bounce_rate ?? null,
        completion_rate: r.completion_rate ?? null,
        cvr_clicks: r.cvr_clicks ?? null,
        cvr_completed: r.cvr_completed ?? null,
        unfilled_rate: r.unfilled_rate ?? null,
        avg_rpc: r.avg_rpc ?? null,
        avg_rps: r.avg_rps ?? null,
      })),
      breakdowns: {
        by_site: bySite.results ?? [],
        by_traffic_source: bySource.results ?? [],
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Activation (§17) — GET /quotes/:id/activation; PUT/DELETE .../:site_id
// ---------------------------------------------------------------------------

async function readSiteQuotesForQuote(db: D1Database, quoteId: number): Promise<LeadgenSiteQuoteRow[]> {
  const result = await db
    .prepare("SELECT * FROM leadgen_site_quotes WHERE quote_id = ? ORDER BY site_id ASC")
    .bind(quoteId)
    .all<LeadgenSiteQuoteRow>();
  return result.results ?? [];
}

async function readSiteQuotesForSite(db: D1Database, siteId: string): Promise<LeadgenSiteQuoteRow[]> {
  const result = await db
    .prepare("SELECT * FROM leadgen_site_quotes WHERE site_id = ? ORDER BY id ASC")
    .bind(siteId)
    .all<LeadgenSiteQuoteRow>();
  return result.results ?? [];
}

function previewUrl(domain: string | null, slug: string | null): string {
  const path = slug === null || slug === "" ? "/lg" : `/lg/${slug}`;
  return domain !== null && domain !== "" ? `https://${domain}${path}` : path;
}

export async function quoteActivationHandler(c: AdminContext): Promise<Response> {
  const quote = await resolveQuoteRow(c.env.DB, c.req.param("id") ?? "");
  if (quote === null) return c.json({ error: "Not Found" }, 404);

  // All sites LEFT JOIN this quote's activation rows (§17.3 "see all Quotes;
  // view active sites; preview URL per site"). sites.domain drives the §17.2
  // tenant-host preview URL.
  const result = await c.env.DB.prepare(
    `SELECT s.id AS site_id, s.name AS site_name, s.domain AS domain,
            sq.id AS sq_id, sq.enabled AS enabled, sq.slug AS slug, sq.settings_overrides_json AS settings_overrides_json
     FROM sites s
     LEFT JOIN leadgen_site_quotes sq ON sq.site_id = s.id AND sq.quote_id = ?
     ORDER BY s.id ASC`,
  )
    .bind(quote.id)
    .all<{
      site_id: string; site_name: string; domain: string | null;
      sq_id: number | null; enabled: number | null; slug: string | null; settings_overrides_json: string | null;
    }>();

  const sites = (result.results ?? []).map((r) => ({
    site_id: r.site_id,
    site_name: r.site_name,
    domain: r.domain,
    activated: r.sq_id !== null,
    enabled: r.enabled === 1,
    slug: r.slug,
    settings_overrides_json: parseJsonColumn(r.settings_overrides_json),
    preview_url: previewUrl(r.domain, r.slug),
  }));

  // R5 (05 §5.2 — additive): the quote-level activation preflight verdict the
  // Phase-2 Activation-tab panel renders (PASS state = ok:true, blocks:[]).
  const activation_preflight = await computeQuoteActivationPreflight(c.env.DB, quote);
  return c.json({ quote_id: quote.public_id, sites, activation_preflight });
}

// ---------------------------------------------------------------------------
// R5 — Quote publish/activation preflight (fix-contract v2.4 05 §5.2).
//
// New CALLERS over the EXISTING §12.11 machinery (rebuildDerivedIndexes +
// sectionValidationStatus + the §5.1 eligibility loader) — no new validation
// logic. Computed at (a) variant save (stored verdict, advisory) and (b)
// activation PUT (authoritative recompute → HARD 409 on any block).
// ---------------------------------------------------------------------------

export interface QuoteActivationBlock {
  section_id: string;
  section_name: string;
  offer_id: string;
  offer_name: string;
  code: string;
  fields: string[];
  fix_links: { section_mapping?: string; offer_schema?: string };
}

export interface QuoteActivationPreflight {
  ok: boolean;
  quote_id: string;
  funnel_id: string;
  funnel_variant_id: string;
  blocks: QuoteActivationBlock[];
  computed_at: number;
}

// KV key for the stored (advisory) per-variant verdict — the activation gate
// always RECOMPUTES; the stored copy feeds the Phase-2 preflight panel.
export function preflightKvKey(variantPublicId: string): string {
  return `lg-preflight:${variantPublicId}`;
}

interface PreflightOfferRef {
  id: number;
  public_id: string;
  offer_name: string;
  calls_provider_api: number;
  active_payload_schema_id: number | null;
}

const SECTION_MAPPING_LINK = (sectionPublicId: string): string =>
  `/admin/leadgen/sections/${sectionPublicId}/edit#mapping`;
const OFFER_SCHEMA_LINK = (offerPublicId: string): string =>
  `/admin/leadgen/offers/${offerPublicId}/edit#payload`;

// Flat schema field info from a schema_json blob (path → type + required
// paths) — the same projection the §12.11 rebuild consumes.
function schemaInfoFromJson(schemaJson: string | null): {
  fieldTypes: Map<string, LeadgenPayloadNodeType>;
  requiredFieldPaths: string[];
} {
  const fieldTypes = new Map<string, LeadgenPayloadNodeType>();
  const requiredFieldPaths: string[] = [];
  const parsed = parseJsonColumn(schemaJson);
  if (isRecord(parsed) && isRecord(parsed["root"]) && Array.isArray((parsed["root"] as Record<string, unknown>)["children"])) {
    for (const node of (parsed["root"] as { children: unknown[] }).children) {
      if (!isRecord(node)) continue;
      const path = typeof node["path"] === "string" ? node["path"] : "";
      const type = typeof node["type"] === "string" ? node["type"] : "";
      if (path === "" || type === "") continue;
      fieldTypes.set(path, type as LeadgenPayloadNodeType);
      if (node["required"] === true) requiredFieldPaths.push(path);
    }
  }
  return { fieldTypes, requiredFieldPaths };
}

// Compute the §5.2 preflight for ONE variant. Every check calls the existing
// machinery; blocks carry per-section/per-offer identity + typed code +
// fields[] + fix links (the normative report shape).
async function computeVariantPreflightBlocks(
  db: D1Database,
  variant: LeadgenFunnelVariantRow,
): Promise<QuoteActivationBlock[]> {
  const blocks: QuoteActivationBlock[] = [];
  const sections = await readVariantSections(db, variant.id);
  const activeSections = sections.filter((s) => s.status === "active");

  // The variant-wide internal-field set (dependency targets must exist).
  interface SectionContentRow {
    id: number;
    public_id: string;
    section_name: string;
    content_json: string;
  }
  const contentRows = new Map<number, SectionContentRow>();
  for (const s of activeSections) {
    const row = await db
      .prepare("SELECT id, public_id, section_name, content_json FROM leadgen_sections WHERE id = ? LIMIT 1")
      .bind(s.section_id)
      .first<SectionContentRow>();
    if (row !== null) contentRows.set(s.section_id, row);
  }
  const knownFields = new Set<string>();
  const componentsBySection = new Map<number, Record<string, unknown>[]>();
  for (const [sectionId, row] of contentRows) {
    const parsed = parseJsonColumn(row.content_json);
    const topLevel =
      isRecord(parsed) && Array.isArray(parsed["components"]) ? (parsed["components"] as unknown[]) : [];
    // §8.5: the dependency universe is the canonical FLATTENED projection.
    // An internal_field declared on a question NESTED inside a layout
    // container (Stack/CardPanel/…), and a `conditional` on a nested node, are
    // BOTH reached — flattenComponents is THE shared consumer path
    // (content-schema.ts §8.5). Flat legacy content flattens to itself, so
    // knownFields + the per-node conditional walk below are byte-unchanged for
    // container-free Sections; the stored per-section list stays the same
    // Record<string, unknown>[] shape (now the flattened leaves).
    const components = (
      flattenComponents(topLevel as unknown as LeadgenComponentNode[]) as unknown[]
    ).filter(isRecord);
    componentsBySection.set(sectionId, components);
    for (const node of components) {
      if (typeof node["internal_field"] === "string" && node["internal_field"] !== "") {
        knownFields.add(node["internal_field"]);
      }
    }
  }

  for (const s of activeSections) {
    const content = contentRows.get(s.section_id);
    if (content === undefined) continue;

    // §5.2 "a dependency references a missing field" — the shared conditional
    // shape {when, op, …} over the VARIANT's internal-field space.
    for (const node of componentsBySection.get(s.section_id) ?? []) {
      const conditional = node["conditional"];
      if (isRecord(conditional) && typeof conditional["when"] === "string" && conditional["when"] !== "") {
        const when = conditional["when"];
        if (!knownFields.has(when)) {
          blocks.push({
            section_id: content.public_id,
            section_name: content.section_name,
            offer_id: "",
            offer_name: "",
            code: "dependency_missing_field",
            fields: [when],
            fix_links: { section_mapping: SECTION_MAPPING_LINK(content.public_id) },
          });
        }
      }
    }

    // Stored mapping rows + selected offers for THIS section.
    const mapRows = await db
      .prepare("SELECT * FROM leadgen_section_answer_maps WHERE section_id = ?")
      .bind(s.section_id)
      .all<{
        question_id: string;
        question_key: string;
        internal_field: string;
        answer_type: string;
        offer_id: number;
        offer_payload_field_path: string;
        provider_expected_type: string;
        output_value_map_json: string | null;
        transform_json: string | null;
        required_for_offer: number;
        default_value: string | null;
        fallback_value: string | null;
      }>();
    const selectedRows = await db
      .prepare("SELECT offer_id FROM leadgen_section_available_offers WHERE section_id = ? AND selected = 1")
      .bind(s.section_id)
      .all<{ offer_id: number }>();
    const selectedOfferIds = new Set((selectedRows.results ?? []).map((r) => r.offer_id));
    const mappedOfferIds = new Set((mapRows.results ?? []).map((r) => r.offer_id));
    const offerIds = [...new Set([...selectedOfferIds, ...mappedOfferIds])];
    if (offerIds.length === 0) continue;

    // Offer refs + active-schema info (chunked ≤80 — D1 binding rule).
    const offerRefs = new Map<number, PreflightOfferRef>();
    for (let i = 0; i < offerIds.length; i += 80) {
      const ids = offerIds.slice(i, i + 80);
      const marks = ids.map(() => "?").join(",");
      const rows = await db
        .prepare(
          `SELECT id, public_id, offer_name, calls_provider_api, active_payload_schema_id FROM leadgen_offers WHERE id IN (${marks})`,
        )
        .bind(...ids)
        .all<PreflightOfferRef>();
      for (const r of rows.results ?? []) offerRefs.set(r.id, r);
    }
    const offerSchemas = new Map<number, OfferSchemaInfo>();
    for (const [offerId, ref] of offerRefs) {
      let schemaRow: { public_id: string; schema_json: string | null } | null = null;
      if (ref.active_payload_schema_id !== null) {
        schemaRow = await db
          .prepare("SELECT public_id, schema_json FROM leadgen_offer_payload_schemas WHERE id = ? LIMIT 1")
          .bind(ref.active_payload_schema_id)
          .first<{ public_id: string; schema_json: string | null }>();
      }
      const info = schemaInfoFromJson(schemaRow?.schema_json ?? null);
      offerSchemas.set(offerId, {
        status: "active",
        activity: "",
        vertical: "",
        active_schema_id: ref.active_payload_schema_id,
        active_schema_public_id: schemaRow?.public_id ?? null,
        fieldTypes: info.fieldTypes,
        requiredFieldPaths: info.requiredFieldPaths,
      });
    }

    // The §12.11 rebuild + verdict — THE existing machinery.
    const edges: LeadgenAnswerMapEdge[] = (mapRows.results ?? []).map((r) => ({
      question_id: r.question_id,
      question_key: r.question_key,
      internal_field: r.internal_field,
      answer_type: r.answer_type,
      offer_id: r.offer_id,
      offer_payload_field_path: r.offer_payload_field_path,
      provider_expected_type: r.provider_expected_type,
      output_value_map: (parseJsonColumn(r.output_value_map_json) as Record<string, unknown> | null) ?? null,
      value_transform: (parseJsonColumn(r.transform_json) as LeadgenTransformStep[] | null) ?? null,
      required_for_offer: r.required_for_offer !== 0,
      default_value: r.default_value,
      fallback_value: r.fallback_value,
    }));
    const rebuilt = rebuildDerivedIndexes({
      content: { components: (componentsBySection.get(s.section_id) ?? []) as never },
      answerMaps: edges,
      offerSchemas,
      selectedOfferIds,
    });
    const verdict = sectionValidationStatus(rebuilt);

    for (const offerVerdict of verdict.offers) {
      // Only SELECTED Offers gate activation (§5.2 "for a selected Offer").
      if (!selectedOfferIds.has(offerVerdict.offer_id)) continue;
      const ref = offerRefs.get(offerVerdict.offer_id);
      const offerPublicId = ref?.public_id ?? String(offerVerdict.offer_id);
      const offerName = ref?.offer_name ?? "";
      const fixLinks = {
        section_mapping: SECTION_MAPPING_LINK(content?.public_id ?? ""),
        offer_schema: OFFER_SCHEMA_LINK(offerPublicId),
      };
      const pushBlock = (code: string, fields: string[]): void => {
        blocks.push({
          section_id: content?.public_id ?? "",
          section_name: content?.section_name ?? "",
          offer_id: offerPublicId,
          offer_name: offerName,
          code,
          fields,
          fix_links: fixLinks,
        });
      };

      // §5.2 "payload schema version missing": a selected DYNAMIC Offer with
      // no active schema cannot be validated at all.
      if (ref !== undefined && ref.calls_provider_api === 1 && ref.active_payload_schema_id === null) {
        pushBlock("payload_schema_version_missing", []);
        continue;
      }
      if (offerVerdict.validation_status !== "error") continue;

      // Typed codes from the rebuilt edge states (the machinery's own rows).
      const offerEdges = rebuilt.answerMaps.filter((r) => r.offer_id === offerVerdict.offer_id);
      const orphaned = offerEdges.filter((r) => r.mapping_completeness === "orphaned").map((r) => r.offer_payload_field_path);
      const mismatched = offerEdges.filter((r) => r.mapping_completeness === "type_mismatch").map((r) => r.offer_payload_field_path);
      if (orphaned.length > 0) pushBlock("orphaned_provider_fields", orphaned);
      if (mismatched.length > 0) pushBlock("type_conversion_invalid", mismatched);
      const schemaInfo = offerSchemas.get(offerVerdict.offer_id);
      const mappedComplete = new Set(
        offerEdges.filter((r) => r.mapping_completeness === "complete").map((r) => r.offer_payload_field_path),
      );
      const missingRequired = (schemaInfo?.requiredFieldPaths ?? []).filter((p) => !mappedComplete.has(p));
      if (missingRequired.length > 0) pushBlock("missing_required_provider_fields", missingRequired);
      if (orphaned.length === 0 && mismatched.length === 0 && missingRequired.length === 0) {
        // The machinery flagged an error we could not decompose — surface it
        // as the generic incomplete-mapping block (never silently pass).
        pushBlock("mapping_incomplete", offerVerdict.reasons);
      }
    }
  }

  // §5.2 "the final auction config invalid" + "any participating dynamic
  // Offer ineligible (§5.1)".
  if (variant.auction_id !== null) {
    const auctionRow = await db
      .prepare("SELECT id, public_id FROM leadgen_auctions WHERE id = ? LIMIT 1")
      .bind(variant.auction_id)
      .first<{ id: number; public_id: string }>();
    if (auctionRow === null) {
      blocks.push({
        section_id: "",
        section_name: "",
        offer_id: "",
        offer_name: "",
        code: "auction_config_invalid",
        fields: [`auction_id ${variant.auction_id} does not exist`],
        fix_links: {},
      });
    } else {
      const participating = await db
        .prepare("SELECT offer_id FROM leadgen_auction_offers WHERE auction_id = ? AND enabled = 1")
        .bind(auctionRow.id)
        .all<{ offer_id: number }>();
      const eligibility = await evaluateDynamicOffersEligibility(
        db,
        (participating.results ?? []).map((r) => r.offer_id),
        "production",
      );
      for (const row of eligibility.values()) {
        if (row.verdict.eligible) continue;
        blocks.push({
          section_id: "",
          section_name: "",
          offer_id: row.offer_public_id,
          offer_name: row.offer_name,
          code: "offer_ineligible",
          fields: [...row.verdict.reasons],
          fix_links: { offer_schema: OFFER_SCHEMA_LINK(row.offer_public_id) },
        });
      }
    }
  }

  return blocks;
}

// Compute the quote-level preflight across every ACTIVE variant of every
// funnel. The normative report stamps the FIRST blocking variant's identity
// (the §5.2 shape carries one funnel/variant pair); blocks aggregate.
export async function computeQuoteActivationPreflight(
  db: D1Database,
  quote: LeadgenQuoteRow,
  now: number = Date.now(),
): Promise<QuoteActivationPreflight> {
  const funnels = await readQuoteFunnels(db, quote.id);
  let firstFunnelId = "";
  let firstVariantId = "";
  const blocks: QuoteActivationBlock[] = [];
  for (const funnel of funnels) {
    if (funnel.status !== "active") continue;
    const variants = await readActiveFunnelVariants(db, funnel.id);
    for (const variant of variants) {
      const variantBlocks = await computeVariantPreflightBlocks(db, variant);
      if (variantBlocks.length > 0 && firstVariantId === "") {
        firstFunnelId = funnel.public_id;
        firstVariantId = variant.public_id;
      }
      blocks.push(...variantBlocks);
    }
    if (firstFunnelId === "" && variants.length > 0) {
      firstFunnelId = funnel.public_id;
      firstVariantId = variants[0]?.public_id ?? "";
    }
  }
  return {
    ok: blocks.length === 0,
    quote_id: quote.public_id,
    funnel_id: firstFunnelId,
    funnel_variant_id: firstVariantId,
    blocks,
    computed_at: now,
  };
}

// The EXACT normative 409 body (05 §5.2).
export function activationBlockedReport(preflight: QuoteActivationPreflight): Record<string, unknown> {
  return {
    error: "quote_activation_blocked",
    quote_id: preflight.quote_id,
    funnel_id: preflight.funnel_id,
    funnel_variant_id: preflight.funnel_variant_id,
    blocks: preflight.blocks.map((b) => ({
      section_id: b.section_id,
      section_name: b.section_name,
      offer_id: b.offer_id,
      offer_name: b.offer_name,
      code: b.code,
      fields: b.fields,
      fix_links: b.fix_links,
    })),
  };
}

// Store the advisory per-variant verdict (variant-save leg — fail-open: KV
// hiccups never break the save; the activation gate recomputes regardless).
async function storeVariantPreflight(
  c: AdminContext,
  variant: LeadgenFunnelVariantRow,
  quote: LeadgenQuoteRow,
): Promise<QuoteActivationPreflight> {
  const blocks = await computeVariantPreflightBlocks(c.env.DB, variant);
  const funnel = await c.env.DB.prepare("SELECT public_id FROM leadgen_funnels WHERE id = ? LIMIT 1")
    .bind(variant.funnel_id)
    .first<{ public_id: string }>();
  const preflight: QuoteActivationPreflight = {
    ok: blocks.length === 0,
    quote_id: quote.public_id,
    funnel_id: funnel?.public_id ?? "",
    funnel_variant_id: variant.public_id,
    blocks,
    computed_at: Date.now(),
  };
  try {
    await c.env.CACHE.put(preflightKvKey(variant.public_id), JSON.stringify(preflight));
  } catch {
    /* advisory store is fail-open */
  }
  return preflight;
}

export async function putActivationHandler(c: AdminContext): Promise<Response> {
  const quote = await resolveQuoteRow(c.env.DB, c.req.param("id") ?? "");
  if (quote === null) return c.json({ error: "Not Found" }, 404);
  const siteId = (c.req.param("site_id") ?? "").trim();
  if (siteId === "") return c.json({ error: "Not Found" }, 404);
  const body = (await readJsonBody(c)) ?? {};

  const enabled = asToggle(body["enabled"]) ?? true;
  const slug = body["slug"] === undefined ? null : trimmedString(body["slug"]);
  // §28 cache-key safety: the slug is a SEGMENT of the lg-shell: cache key
  // (lg-shell:{site}:{slug}:{funnel}:…), so it MUST be URL-safe and colon-free —
  // a ':' (or other metachar) would misalign the funnel-narrowed invalidation
  // split (invalidate.ts) and could over-/under-delete a funnel's shells. Reject
  // anything but a standard slug: lowercase alphanumerics + hyphens.
  if (slug !== null && slug !== "" && !/^[a-z0-9-]+$/.test(slug)) {
    return c.json(
      { error: "invalid slug", fields: { slug: "must be lowercase letters, digits, and hyphens (/^[a-z0-9-]+$/)" } },
      400,
    );
  }
  const overrides = body["settings_overrides_json"] !== undefined || body["settings_overrides"] !== undefined
    ? jsonStringOrNull(body["settings_overrides_json"] ?? body["settings_overrides"])
    : null;

  // §17.1 validation via the Stage-A engine: at most ONE enabled root (NULL
  // slug) per site; UNIQUE(site_id, quote_id) (self = the row being updated);
  // UNIQUE(site_id, slug). A second enabled root while one is enabled errors.
  const siteRows = await readSiteQuotesForSite(c.env.DB, siteId);
  const existingForQuote = siteRows.find((r) => r.quote_id === quote.id) ?? null;
  const existingRows: ActivationRowInput[] = siteRows.map((r) => ({
    id: r.id, site_id: r.site_id, quote_id: r.quote_id, enabled: r.enabled, slug: r.slug,
  }));
  const newRow: ActivationRowInput = {
    id: existingForQuote?.id ?? null,
    site_id: siteId,
    quote_id: quote.id,
    enabled,
    slug,
  };
  const verdict = validateActivation(existingRows, newRow);
  if (!verdict.ok) {
    const fields: FieldErrors = {};
    for (const e of verdict.errors) fields[e.code] = e.message;
    return c.json({ error: "Validation failed", fields }, 400);
  }

  // R5 (05 §5.2): ENABLING a quote on a site HARD-BLOCKS with the normative
  // 409 report while any preflight block exists (incomplete/orphaned/invalid
  // mappings, unmapped required provider fields, missing schema version,
  // missing dependency fields, invalid auction config, §5.1-ineligible
  // participating dynamic Offers). Disabling is never blocked. The verdict is
  // RECOMPUTED here — the stored variant-save copy is advisory only.
  const preflight = await computeQuoteActivationPreflight(c.env.DB, quote);
  if (enabled && !preflight.ok) {
    return c.json(activationBlockedReport(preflight), 409);
  }

  if (existingForQuote === null) {
    await c.env.DB.prepare(
      `INSERT INTO leadgen_site_quotes (site_id, quote_id, enabled, slug, settings_overrides_json)
       VALUES (?, ?, ?, ?, ?)`,
    )
      .bind(siteId, quote.id, enabled ? 1 : 0, slug, overrides)
      .run();
  } else {
    await c.env.DB.prepare(
      `UPDATE leadgen_site_quotes SET enabled = ?, slug = ?, settings_overrides_json = ?, updated_at = unixepoch()
       WHERE id = ?`,
    )
      .bind(enabled ? 1 : 0, slug, overrides, existingForQuote.id)
      .run();
  }

  const row = await c.env.DB.prepare(
    "SELECT * FROM leadgen_site_quotes WHERE site_id = ? AND quote_id = ? LIMIT 1",
  )
    .bind(siteId, quote.id)
    .first<LeadgenSiteQuoteRow>();
  if (!row) return c.json({ error: "Activation failed" }, 500);
  const domainRow = await c.env.DB.prepare("SELECT domain FROM sites WHERE id = ? LIMIT 1")
    .bind(siteId)
    .first<{ domain: string | null }>()
    .catch(() => null);
  // §28: activation upsert flips which funnel serves / whether it serves AND may
  // change the baked-in GA4 id (settings_overrides_json) — none bump content_version,
  // so evict this site's stale funnel shells + configs. Non-blocking; fail-open.
  scheduleActivationInvalidate(c, siteId);
  // Additive (§5.2 — the Phase-2 preflight panel reads it): the recomputed
  // verdict rides the success response (PASS state = ok:true, blocks:[]).
  return c.json({
    ...siteQuoteRowToApi(row),
    preview_url: previewUrl(domainRow?.domain ?? null, row.slug),
    activation_preflight: preflight,
  });
}

export async function deleteActivationHandler(c: AdminContext): Promise<Response> {
  const quote = await resolveQuoteRow(c.env.DB, c.req.param("id") ?? "");
  if (quote === null) return c.json({ error: "Not Found" }, 404);
  const siteId = (c.req.param("site_id") ?? "").trim();
  if (siteId === "") return c.json({ error: "Not Found" }, 404);

  // Deactivate (reversible §9.6): flip enabled → 0, do NOT hard-delete the row.
  const existing = await c.env.DB.prepare(
    "SELECT * FROM leadgen_site_quotes WHERE site_id = ? AND quote_id = ? LIMIT 1",
  )
    .bind(siteId, quote.id)
    .first<LeadgenSiteQuoteRow>();
  if (!existing) return c.json({ error: "Not Found" }, 404);
  await c.env.DB.prepare("UPDATE leadgen_site_quotes SET enabled = 0, updated_at = unixepoch() WHERE id = ?")
    .bind(existing.id)
    .run();
  // §28: deactivation changes whether the slug serves — the cached shell would
  // otherwise linger until TTL. Evict this site's funnel shells + configs.
  // Non-blocking; fail-open.
  scheduleActivationInvalidate(c, siteId);
  return c.json({ ok: true, site_id: siteId, quote_id: quote.public_id, enabled: false });
}

// ---------------------------------------------------------------------------
// A/B experiments — the P8 SEAM. Create the leadgen_funnel_ab_tests row +
// flip draft→running→stopped (guarded by uq_leadgen_abtest_running). The §16.2
// traffic allocation (traffic_allocation_bp buckets, session assignment, the %
// UI, the 100k-session distribution) is NOT implemented here — it ships in P8.
// ---------------------------------------------------------------------------

async function createAbTest(c: AdminContext, funnel: LeadgenFunnelRow, body: Record<string, unknown>): Promise<Response> {
  const name = trimmedString(body["name"]) ?? `${funnel.funnel_name} A/B`;
  const publicId = mintPublicId("funnel_ab_test");
  await c.env.DB.prepare(
    "INSERT INTO leadgen_funnel_ab_tests (public_id, funnel_id, name, revision, status) VALUES (?, ?, ?, 1, 'draft')",
  )
    .bind(publicId, funnel.id, name)
    .run();
  const row = await c.env.DB.prepare("SELECT * FROM leadgen_funnel_ab_tests WHERE public_id = ? LIMIT 1")
    .bind(publicId)
    .first<LeadgenFunnelAbTestRow>();
  if (!row) return c.json({ error: "Insert failed" }, 500);
  // §16.2: set each active variant's traffic_allocation_bp so the per-test Σ ==
  // 10000, then start (start enforces the sum). UI shows % (bp/100).
  return c.json(
    { ...abTestRowToApi(row), allocation_note: "set each variant's traffic_allocation_bp so the per-test Σ == 10000, then start (§16.2)" },
    201,
  );
}

export async function createQuoteExperimentHandler(c: AdminContext): Promise<Response> {
  const quote = await resolveQuoteRow(c.env.DB, c.req.param("id") ?? "");
  if (quote === null) return c.json({ error: "Not Found" }, 404);
  const body = (await readJsonBody(c)) ?? {};
  const funnel = await pickFunnelForNewVariant(c.env.DB, quote, body);
  if (funnel === null) return c.json({ error: "Validation failed", fields: { funnel_id: "quote has no funnel for the experiment" } }, 400);
  if ("error" in funnel) return c.json({ error: "Validation failed", fields: { funnel_id: funnel.error } }, 400);
  return createAbTest(c, funnel, body);
}

export async function createFunnelExperimentHandler(c: AdminContext): Promise<Response> {
  const funnel = await resolveFunnelRow(c.env.DB, c.req.param("id") ?? "");
  if (funnel === null) return c.json({ error: "Not Found" }, 404);
  const body = (await readJsonBody(c)) ?? {};
  return createAbTest(c, funnel, body);
}

export async function startExperimentHandler(c: AdminContext): Promise<Response> {
  const test = await resolveAbTestRow(c.env.DB, c.req.param("id") ?? "");
  if (test === null) return c.json({ error: "Not Found" }, 404);
  if (test.status === "running") return c.json({ error: "experiment is already running" }, 400);
  // uq_leadgen_abtest_running: at most one running test per funnel.
  const running = await c.env.DB.prepare(
    "SELECT id FROM leadgen_funnel_ab_tests WHERE funnel_id = ? AND status = 'running' AND id != ? LIMIT 1",
  )
    .bind(test.funnel_id, test.id)
    .first<{ id: number }>();
  if (running) return c.json({ error: "another experiment is already running on this funnel (stop it first)" }, 400);

  // §16.2 Σ==10000 gate — a test CANNOT start unless its arms' traffic_allocation_bp
  // sum to exactly 10000 (a running test must allocate 100% of traffic). Arms are
  // the funnel's active variants (the exact set the runtime resolver buckets over).
  const arms = await readActiveFunnelVariants(c.env.DB, test.funnel_id);
  const verdict = validateAbAllocations(arms);
  if (!verdict.ok) {
    return c.json(
      {
        error: "Validation failed",
        fields: { traffic_allocation_bp: verdict.errors.map((e) => e.message).join("; ") },
      },
      400,
    );
  }

  // Starting bumps the revision (§16.2: the revision is part of the ab-hash input,
  // so a fresh run cleanly re-buckets every session) + stamps started_at.
  await c.env.DB.prepare(
    "UPDATE leadgen_funnel_ab_tests SET status = 'running', started_at = unixepoch(), revision = revision + 1 WHERE id = ?",
  )
    .bind(test.id)
    .run();
  const updated = await c.env.DB.prepare("SELECT * FROM leadgen_funnel_ab_tests WHERE id = ? LIMIT 1")
    .bind(test.id)
    .first<LeadgenFunnelAbTestRow>();
  return c.json({ ...abTestRowToApi(updated as LeadgenFunnelAbTestRow) });
}

export async function stopExperimentHandler(c: AdminContext): Promise<Response> {
  const test = await resolveAbTestRow(c.env.DB, c.req.param("id") ?? "");
  if (test === null) return c.json({ error: "Not Found" }, 404);
  await c.env.DB.prepare(
    "UPDATE leadgen_funnel_ab_tests SET status = 'stopped', stopped_at = unixepoch() WHERE id = ?",
  )
    .bind(test.id)
    .run();
  const updated = await c.env.DB.prepare("SELECT * FROM leadgen_funnel_ab_tests WHERE id = ? LIMIT 1")
    .bind(test.id)
    .first<LeadgenFunnelAbTestRow>();
  return c.json({ ...abTestRowToApi(updated as LeadgenFunnelAbTestRow) });
}

// GET /experiments/:id/assignment-preview?session_id=… — the §16.2 assignment
// preview for the A/B tab. Runs the SAME Stage-A assignVariant the runtime
// resolver uses, over the funnel's active variants (the arms) with the test's
// public_id + current revision, so the preview can never drift from what a
// session is actually served. Returns the picked variant + the §16.2 bucket.
export async function experimentAssignmentPreviewHandler(c: AdminContext): Promise<Response> {
  const test = await resolveAbTestRow(c.env.DB, c.req.param("id") ?? "");
  if (test === null) return c.json({ error: "Not Found" }, 404);
  const sessionId = (trimmedString(c.req.query("session_id")) ?? "");
  if (sessionId === "") {
    return c.json({ error: "Validation failed", fields: { session_id: "session_id is required" } }, 400);
  }
  const arms = await readActiveFunnelVariants(c.env.DB, test.funnel_id);
  if (arms.length === 0) {
    return c.json({ error: "Validation failed", fields: { variants: "the funnel has no active variants to bucket over" } }, 400);
  }
  const picked = assignVariant(test.public_id, test.revision, sessionId, arms);
  return c.json({
    session_id: sessionId,
    funnel_ab_test_id: test.public_id,
    funnel_ab_test_revision: test.revision,
    assignment_bucket: picked.assignment_bucket,
    assignment_reason: picked.assignment_reason,
    variant: {
      funnel_variant_id: toFunnelVariantId(picked.variant.public_id) as string,
      variant_label: picked.variant.variant_label,
      traffic_allocation_bp: picked.variant.traffic_allocation_bp,
      is_control: picked.variant.is_control !== 0,
    },
  });
}

// The list of available funnel visual designs (§15.4) — read-only registry
// projection for the editor's design selector.
export function listFunnelDesignOptions(): Array<{ id: string; label: string }> {
  return Object.keys(FUNNEL_DESIGNS).map((id) => ({ id, label: id }));
}
