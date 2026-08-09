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
// Round-4 P3a (D-3 pages model): the SAME loader the public runtime resolves
// through (parity by construction — the admin structure panel and the live
// serve/attempt path can never disagree on a variant's page/slot shape), plus
// the entry-known field-scope validator for slot rules.
import {
  loadVariantPages,
  validateSlotRuleFieldScope,
  type ResolvedFunnelPage,
  type ResolvedPageSlot,
  // §4.3-11 parity addendum: the SAME shared-page loader + page→sections
  // flattener composeResolvedBundle (the live serve path, resolver.ts,
  // unexported) uses — imported read-only so the composed variant preview
  // (composedVariantPreviewResponse below) can never diverge from serve on
  // section composition. No query is duplicated here.
  loadSharedPages,
  sectionsFromPages,
  // R2 P3 (element J) D2 — the SAME pure, synchronous frame-merge
  // composeResolvedBundle (resolver.ts) uses to find a footer's picked
  // legal-links leg before resolveSiteBranding.
  resolveEffectiveFrameOnly,
} from "../../public/leadgen/resolver";
import type { WaitUntilContext } from "../../wait-until-context";
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
// Rework §4.3-3: the ONE shared checkpoint-plane derivation (imported read-only;
// the runtime resolver imports the SAME module — the admin advisory cache can
// never diverge from the runtime's own partition). We build the field universes
// from the SAME component expander the runtime uses; the derivation itself is
// never re-implemented here.
import { deriveRuleCheckpoint, type RuleCheckpointFunnel } from "../../leadgen/rule-checkpoint";
import {
  rebuildDerivedIndexes,
  sectionValidationStatus,
  type LeadgenAnswerMapEdge,
  type OfferSchemaInfo,
} from "../../leadgen/sections";
import { evaluateDynamicOffersEligibility } from "../../leadgen/validation";
import type { LeadgenPayloadNodeType, LeadgenTransformStep } from "../../leadgen/payload";
import { getFunnelDesign, FUNNEL_DESIGNS } from "../../public/leadgen/designs/registry";
import type { FunnelDesign } from "../../public/leadgen/designs/registry";
import { funnelChromeCss, FUNNEL_DESIGN_SCOPE_ATTR } from "../../public/leadgen/designs/default-funnel/styles";
import {
  renderProgressBar,
  renderSectionComponents,
  renderStepIndicator,
} from "../../public/leadgen/components/presets";
import type { ComponentType } from "../../public/leadgen/components/presets";
import {
  collectKnownAnswerFields,
  conditionalFieldRefs,
  flattenComponents,
  type LeadgenComponentNode,
} from "../../public/leadgen/components/content-schema";
import { COMPONENT_CATALOG } from "../../public/leadgen/components/registry";
import { buildPublicConfig, type LeadgenPublicConfig } from "../../public/leadgen/config-dto";
// Round-4 P4b: the SAME component parser/expander resolver.ts's private
// fieldToPageIndex uses (config-dto.ts, both EXPORTED) — reused here to mirror
// that exact field->page derivation locally (see computeFieldToPageIndex
// below). resolver.ts's own fieldToPageIndex helper is NOT exported and
// resolver.ts is not in this slice's file ownership, so this module keeps its
// own drift-pinned copy of the algorithm rather than widening that file.
import { parseSectionComponents, expandPublicComponents } from "../../public/leadgen/config-dto";
// v2.5 A7 (13 §13.1/§13.3 + 14 §14.1): the composed-variant preview renders
// through the SAME serve-owned pieces as the live /lg frame path
// (resolveFrameComposition + renderVariantSectionsHtml + renderQuoteFrame —
// parity by construction, never a fork), and the activation preflight adopts
// the 03 §3.6 problems[] projection over the frozen frame/theme validators.
import {
  renderVariantSectionsHtml,
  resolveFrameComposition,
} from "../../public/leadgen/serve";
import {
  renderLegacyShell,
  renderQuoteFrame,
  LG_BANNERS_MOUNT_HTML,
} from "../../public/leadgen/designs/frame";
import { validateFrameConfig, effectiveFrame, parseSavedFrameTemplateDefaults, footerLegalPagePicks } from "../../public/leadgen/designs/frames";
import type { EffectiveFrameConfig } from "../../public/leadgen/designs/frames";
import {
  contrastRatioAA,
  resolveTokens,
  validateTheme,
  winningThemeId,
  WCAG_AA_MIN_CONTRAST,
} from "../../public/leadgen/designs/theme";
import type {
  FunnelTokenRole,
  Problem,
  ThemeJson,
  ThemeRecord,
  VariantThemeOverrides,
} from "../../public/leadgen/designs/theme";
// v3.1 §10.1: a variant's frame_overrides_json.theme_id assignment (A/B
// theme override) needs "theme_id must exist in the store"; §12 (fix round):
// the composed quote/variant preview resolves the SAME theme_id the live path
// does — both read through theme-store.ts (the public KV module; avoids a
// public→admin import edge from serve.ts).
import { getThemeRecord, themeRecordExists } from "../../public/leadgen/designs/theme-store";
import { resolveSiteBranding, type SiteBranding } from "../../leadgen/branding";
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
  LeadgenFrameTemplateRow,
  LeadgenQuoteRoutingRuleRow,
  LeadgenQuoteRow,
  LeadgenRuleConditions,
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

// ---------------------------------------------------------------------------
// Round-4 P4b (D-2 rule-model v2) — additive local types
// ---------------------------------------------------------------------------
// db-types.ts's LeadgenFunnelRuleType/LeadgenFunnelRuleRow/LeadgenFunnelRuleApi
// and leadgen/funnel.ts's validateFunnelRule/FunnelRuleInput do NOT know the
// migration-0043 v2 columns (target_funnel_variant_id, value_multiplier,
// checkpoint_page, match_mode, rule_name, status) -- neither file is in the
// P4b slice's file ownership (its dispatch lists only ui-rules-builder.ts /
// ui-quotes.ts / quotes-handlers.ts / router.ts). resolver.ts's own P4a
// comment anticipated this ("db-types.ts's LeadgenFunnelRuleRow, which P4b
// extends for the admin API") but the widening was never added to either
// shared file. Rather than touch two files outside this slice, the v2
// surface is expressed with local, additive types here (SEAM -- reported to
// the conductor rather than silently widening db-types.ts/leadgen/funnel.ts).
//
// §10/S5.1: this used to be `LeadgenFunnelRuleType | "route_funnel_variant"`.
// That extra union member is REMOVED — proven dead: leadgen_funnel_rules'
// CHECK (migration 0048/M3) forbids the value going forward, and M3's own
// table recreation excluded every such row up front (they were migrated to
// leadgen_quote_routing_rules), so a read of this column can never actually
// produce it. Narrowed the union rather than deleting the type name (still
// used at LeadgenFunnelRuleRowV2.rule_type / PreparedRule.ruleType / the
// ruleType-as-cast below). NOTE (out of this slice's file ownership, flagged
// not fixed): db-types.ts's OWN LeadgenFunnelRuleType still includes
// "skip_section"/"show_section", which the SAME M3 CHECK also forbids now —
// a pre-existing, separate staleness in a file this slice does not own.
type FunnelRuleTypeV2 = LeadgenFunnelRuleType;

interface LeadgenFunnelRuleRowV2 extends Omit<LeadgenFunnelRuleRow, "rule_type"> {
  rule_type: FunnelRuleTypeV2;
  target_funnel_variant_id: number | null;
  value_multiplier: number | null;
  checkpoint_page: number | null;
  match_mode: string | null;
  rule_name: string | null;
  status: string;
  // 0044 (P4a fix round) — the §15.5 redirect_direct_offer session-sticky
  // percentage gate (funnel.ts resolveRedirectPct/shouldRedirectForSession).
  redirect_pct: number | null;
}

// Rework M3/D5 (§5-M3): leadgen_funnel_rules is RECREATED with its CHECK
// tightened to EXACTLY the four auction-domain rule types (0048). Routing
// (route_funnel_variant) moved to the quote-scoped leadgen_quote_routing_rules
// table; skip_section/show_section are no longer persisted here (0048 aborts if
// any exist). So the variant-rule replace-set accepts ONLY these four — anything
// else is rejected at save with a clear rule_type error BEFORE the INSERT would
// hit the DB CHECK. Their UI relocates to the Auction tab in a later phase.
const FUNNEL_RULE_TYPES = [
  "redirect_direct_offer",
  "eligibility",
  "disqualification",
  "auction_entry",
] as const satisfies readonly FunnelRuleTypeV2[];

// The §21.4 condition-op vocabulary — reused by validateRoutingConditionsShape
// below, which now validates the QUOTE routing rules' conditions_json (M3).
const CONDITION_OPS_V2: ReadonlySet<string> = new Set([
  "eq",
  "neq",
  "gt",
  "lt",
  "gte",
  "lte",
  "range",
  "in",
  "not_in",
]);

// Mirrors leadgen/funnel.ts's private validateRuleConditions (same §21.4
// shape check); duplicated locally because that function is not exported and
// its file is outside this slice. Returns a plain-language error, or null
// when the shape is acceptable.
function validateRoutingConditionsShape(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) return "conditions_json must be an object { groups: [...] }";
  const groups = (value as { groups?: unknown }).groups;
  if (!Array.isArray(groups)) return "conditions_json.groups must be an array";
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    if (typeof g !== "object" || g === null || Array.isArray(g)) return `conditions_json.groups[${i}] must be an object`;
    const group = g as Record<string, unknown>;
    if (typeof group["field"] !== "string" || group["field"].trim() === "") {
      return `conditions_json.groups[${i}].field is required`;
    }
    const op = group["op"];
    if (typeof op !== "string" || !CONDITION_OPS_V2.has(op)) {
      return `conditions_json.groups[${i}].op must be one of ${[...CONDITION_OPS_V2].join("|")}`;
    }
    if (op === "range" && (typeof group["from"] !== "number" || typeof group["to"] !== "number")) {
      return `conditions_json.groups[${i}] range op requires numeric from + to`;
    }
    if ((op === "in" || op === "not_in") && !Array.isArray(group["values"])) {
      return `conditions_json.groups[${i}] ${op} op requires a values array`;
    }
  }
  return null;
}

// §10/S5.1: three route_funnel_variant-era local mirrors were removed here
// (computeFieldToPageIndex, routingRuleIsEntryOnly, resolveRoutingTargetVariantId)
// — confirmed ZERO callers anywhere in this file. They existed to serve the
// P4a per-variant routing-rule admin CRUD (rule_type='route_funnel_variant'
// rows in leadgen_funnel_rules), which migration M3 moved entirely to the
// quote-scoped leadgen_quote_routing_rules table + its own dedicated admin
// handlers; these three were stranded scaffolding, never wired to it.

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
function safeExecutionCtx(c: AdminContext): WaitUntilContext {
  try {
    return c.executionCtx;
  } catch {
    return {
      waitUntil(): void {
        /* no-op outside workerd (unit-test harness) */
      },
    };
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

// leadgen_funnels row: scalar columns are API-stable (no INTEGER bools); the
// 0041 v2.5 columns (frame_config_json / theme_json) parse defensively like
// every *_json column, and the stable funnel_id (lgf_) is stamped via the
// branded constructor (G4). `?? null` keeps pre-0041 test harnesses (rows
// without the columns) mapping to the same explicit nulls.
function funnelRowToApi(row: LeadgenFunnelRow): Record<string, unknown> {
  return {
    ...row,
    funnel_id: toFunnelId(row.public_id) as string,
    frame_config_json: parseJsonColumn(row.frame_config_json ?? null),
    theme_json: parseJsonColumn(row.theme_json ?? null),
  };
}

function abTestRowToApi(row: LeadgenFunnelAbTestRow): Record<string, unknown> {
  return { ...row };
}

function variantRowToApi(row: LeadgenFunnelVariantRow): Record<string, unknown> {
  return {
    ...row,
    // G4: the variant's public_id IS the funnel_variant_id (lgn_) — branded so
    // it can never be aliased into a funnel_id slot.
    // Rework M1 (§4.3-10): no is_control axis — with no running test a funnel
    // has exactly one active variant; the deterministic order is variant_label
    // ASC. frame_template_id (M5 A/B override, NULL = inherit) rides `...row`.
    funnel_variant_id: toFunnelVariantId(row.public_id) as string,
    lander_enabled: row.lander_enabled !== 0,
    lander_body_json: parseJsonColumn(row.lander_body_json),
    lander_cta_json: parseJsonColumn(row.lander_cta_json),
    // 0041 (v2.5 §4.5): the sparse frame/theme override patch, parsed like
    // every *_json column; `?? null` covers pre-0041 harness rows.
    frame_overrides_json: parseJsonColumn(row.frame_overrides_json ?? null),
  };
}

function ruleRowToApi(row: LeadgenFunnelRuleRowV2): Record<string, unknown> {
  return {
    ...row,
    conditions_json: parseJsonColumn(row.conditions_json),
    redirect_url_allowlisted: row.redirect_url_allowlisted !== 0,
    enabled: row.enabled !== 0,
    // v2 columns (target_funnel_variant_id, value_multiplier, checkpoint_page,
    // match_mode, rule_name, status) ride the `...row` spread verbatim --
    // NULLable/plain-string, no transform needed. The admin client resolves
    // target_funnel_variant_id -> a display name against the SAME quote's
    // funnel-variants list it already loads (no server-side name join here,
    // matching how target_offer_id/target_section_id already work).
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
// EXPORTED (v2.5 04 §4.8): frame-handlers.ts resolves its /funnels/:id/frame|theme
// targets through the same dual-id helper — one resolution implementation.
export const resolveFunnelRow = (db: D1Database, id: string): Promise<LeadgenFunnelRow | null> =>
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
  // v2.5 DEV-59 ADDITIVE: the per-section Offer-mapping verdict the Quote
  // Builder's structure-panel dot renders (real data, no placeholder).
  mapping_status: "complete" | "incomplete" | "none";
}

type VariantSectionRow = Omit<OrderedVariantSection, "mapping_status"> & {
  mapped_offer_count: number;
  invalid_offer_count: number;
  incomplete_offer_count: number;
  error_edge_count: number;
};

// DEV-59: decode the aggregate counts into the structure-panel tri-state.
// Parity contract: this is the SQL form of the sections LIST badge —
// listSectionsHandler's overallCompleteness (worst state across the Section's
// linked Offer rows; its 4th state `invalid` folds into the dot's amber) —
// strengthened by the fourth aggregate: any non-complete answer-map edge also
// turns the dot amber (mappingSummaryOf's per-edge leg). It is deliberately
// NOT the §12.11 publish verdict (sectionValidationStatus): a `selected` row
// with required_fields_total=0 IS publishable per that gate, but the dot
// keeps the Sections-list amber for it — an Offer linked with mapping not
// started is a workflow nudge, and one section must show ONE color across
// both admin surfaces (corner pinned by the DEV-59 dot tests). No linked
// Offers at all → `none`.
// Pure decode, factored out of variantSectionMappingStatus (P3b follow-up)
// so the board's per-candidate mapping-status projection (sectionMappingStatusMap
// below) can share the SAME tri-state logic instead of a second copy —
// output-identical, no behavior change for any existing caller.
function mappingStatusFromCounts(counts: {
  mapped_offer_count: number;
  invalid_offer_count: number;
  incomplete_offer_count: number;
  error_edge_count: number;
}): OrderedVariantSection["mapping_status"] {
  if (Number(counts.mapped_offer_count ?? 0) === 0) return "none";
  if (
    Number(counts.invalid_offer_count ?? 0) > 0 ||
    Number(counts.incomplete_offer_count ?? 0) > 0 ||
    Number(counts.error_edge_count ?? 0) > 0
  ) {
    return "incomplete";
  }
  return "complete";
}

function variantSectionMappingStatus(row: VariantSectionRow): OrderedVariantSection["mapping_status"] {
  return mappingStatusFromCounts(row);
}

// P3b follow-up (§8.2 board, DEV-59 parity) — the SAME per-section mapping-
// status aggregate readVariantSections/readSharedPageSections compute, keyed
// by an explicit section-id set instead of a variant/quote owner axis: the
// board's funnel-page chips resolve a slot's CANDIDATE sections (fixed/ab/
// ruled alike) straight from loadVariantPages, which carries no mapping-status
// join. Chunked at 80 ids per the D1 100-binding-per-statement rule.
async function sectionMappingStatusMap(
  db: D1Database,
  sectionIds: readonly number[],
): Promise<Map<number, OrderedVariantSection["mapping_status"]>> {
  const out = new Map<number, OrderedVariantSection["mapping_status"]>();
  const unique = Array.from(new Set(sectionIds));
  for (let i = 0; i < unique.length; i += 80) {
    const chunk = unique.slice(i, i + 80);
    if (chunk.length === 0) continue;
    const placeholders = chunk.map(() => "?").join(",");
    const rows = await db
      .prepare(
        `SELECT s.id AS section_id,
                (SELECT COUNT(*) FROM leadgen_section_available_offers sao WHERE sao.section_id = s.id) AS mapped_offer_count,
                (SELECT COUNT(*) FROM leadgen_section_available_offers sao WHERE sao.section_id = s.id AND sao.mapping_state = 'invalid') AS invalid_offer_count,
                (SELECT COUNT(*) FROM leadgen_section_available_offers sao WHERE sao.section_id = s.id AND sao.mapping_state IN ('incomplete','selected')) AS incomplete_offer_count,
                (SELECT COUNT(*) FROM leadgen_section_answer_maps sam WHERE sam.section_id = s.id AND sam.mapping_status != 'complete') AS error_edge_count
         FROM leadgen_sections s WHERE s.id IN (${placeholders})`,
      )
      .bind(...chunk)
      .all<{ section_id: number; mapped_offer_count: number; invalid_offer_count: number; incomplete_offer_count: number; error_edge_count: number }>();
    for (const row of rows.results ?? []) out.set(row.section_id, mappingStatusFromCounts(row));
  }
  return out;
}

async function readVariantSections(
  db: D1Database,
  variantId: number,
): Promise<OrderedVariantSection[]> {
  // DEV-59: the three per-section leadgen_section_available_offers aggregates
  // mirror listSectionsHandler's overallCompleteness derivation; the fourth
  // (non-complete answer-map edges) mirrors mappingSummaryOf's per-edge leg.
  const result = await db
    .prepare(
      `SELECT fvs.position AS position, s.id AS section_id, s.public_id AS section_public_id,
              s.section_name AS section_name, s.activity AS activity, s.vertical AS vertical, s.status AS status,
              (SELECT COUNT(*) FROM leadgen_section_available_offers sao WHERE sao.section_id = s.id) AS mapped_offer_count,
              (SELECT COUNT(*) FROM leadgen_section_available_offers sao WHERE sao.section_id = s.id AND sao.mapping_state = 'invalid') AS invalid_offer_count,
              (SELECT COUNT(*) FROM leadgen_section_available_offers sao WHERE sao.section_id = s.id AND sao.mapping_state IN ('incomplete','selected')) AS incomplete_offer_count,
              (SELECT COUNT(*) FROM leadgen_section_answer_maps sam WHERE sam.section_id = s.id AND sam.mapping_status != 'complete') AS error_edge_count
       FROM leadgen_funnel_variant_sections fvs
       JOIN leadgen_sections s ON s.id = fvs.section_id
       WHERE fvs.variant_id = ? ORDER BY fvs.position ASC`,
    )
    .bind(variantId)
    .all<VariantSectionRow>();
  return (result.results ?? []).map((row) => {
    const { mapped_offer_count, invalid_offer_count, incomplete_offer_count, error_edge_count, ...rest } = row;
    void mapped_offer_count;
    void invalid_offer_count;
    void incomplete_offer_count;
    void error_edge_count;
    return { ...rest, mapping_status: variantSectionMappingStatus(row) };
  });
}

async function readVariantRules(db: D1Database, variantId: number): Promise<LeadgenFunnelRuleRowV2[]> {
  const result = await db
    .prepare(
      "SELECT * FROM leadgen_funnel_rules WHERE variant_id = ? ORDER BY priority ASC, id ASC",
    )
    .bind(variantId)
    .all<LeadgenFunnelRuleRowV2>();
  return result.results ?? [];
}

// ---------------------------------------------------------------------------
// Rework M3 (§4.3-3..9) — quote-scoped, multi-action routing rules
// (leadgen_quote_routing_rules). Priority ascending (1 = highest, tie → lower
// id first, §4.3-4). The reader is shared by the CRUD handlers + the quote
// duplicate + the analytics/structure projections.
// ---------------------------------------------------------------------------

async function readQuoteRoutingRules(
  db: D1Database,
  quoteId: number,
): Promise<LeadgenQuoteRoutingRuleRow[]> {
  const result = await db
    .prepare(
      "SELECT * FROM leadgen_quote_routing_rules WHERE quote_id = ? ORDER BY priority ASC, id ASC",
    )
    .bind(quoteId)
    .all<LeadgenQuoteRoutingRuleRow>();
  return result.results ?? [];
}

// Row → API: conditions_json parsed; redirect_url_allowlisted → boolean; the
// action columns (target_funnel_id / feed_name / value_multiplier / redirect_pct
// / target_offer_id / redirect_url) ride the spread verbatim. The admin client
// resolves target_funnel_id → a name against the quote's funnels list it already
// loads (no server-side join, mirroring how target_offer_id already works).
function quoteRoutingRuleRowToApi(row: LeadgenQuoteRoutingRuleRow): Record<string, unknown> {
  return {
    ...row,
    conditions_json: parseJsonColumn(row.conditions_json),
    redirect_url_allowlisted: row.redirect_url_allowlisted !== 0,
  };
}

// Appendix A-11 (verbatim, asserted in CI): a rule with no action is rejected.
const ROUTING_RULE_MIN_ACTION_MESSAGE = "Pick at least one action for this rule.";

async function resolveQuoteRoutingRuleRow(
  db: D1Database,
  idParam: string,
): Promise<LeadgenQuoteRoutingRuleRow | null> {
  const selector = idSelector("quote_routing_rule", idParam);
  if (selector === null) return null;
  const sql =
    selector.column === "id"
      ? "SELECT * FROM leadgen_quote_routing_rules WHERE id = ? LIMIT 1"
      : "SELECT * FROM leadgen_quote_routing_rules WHERE public_id = ? LIMIT 1";
  return (await db.prepare(sql).bind(selector.value).first<LeadgenQuoteRoutingRuleRow>()) ?? null;
}

// The field names a rule's §21.4 conditions reference (groups[].field).
function routingConditionFields(conditions: unknown): string[] {
  if (!isRecord(conditions)) return [];
  const groups = (conditions as { groups?: unknown }).groups;
  if (!Array.isArray(groups)) return [];
  const out: string[] = [];
  for (const g of groups) {
    if (isRecord(g) && typeof g["field"] === "string" && g["field"].trim() !== "") out.push(g["field"]);
  }
  return out;
}

// Advisory checkpoint_page cache (§4.3-3): the in-funnel page position at which a
// rule can first apply, via the SHARED deriveRuleCheckpoint. NULL for the entry/
// shared/unreachable planes — and the runtime + the (P3) builder display BOTH
// re-derive with the same pure module, so nothing critical reads this cache. The
// field universes are built from the SAME collectKnownAnswerFields expander the
// runtime uses. Best-effort: any DB/shape error degrades to NULL.
async function deriveRoutingRuleCheckpointPage(
  db: D1Database,
  quote: LeadgenQuoteRow,
  conditionFields: readonly string[],
): Promise<number | null> {
  if (conditionFields.length === 0) return null;
  try {
    const sharedFields = new Set<string>();
    const sharedRows = await db
      .prepare(
        "SELECT s.content_json AS content_json FROM leadgen_funnel_variant_sections fvs JOIN leadgen_sections s ON s.id = fvs.section_id WHERE fvs.quote_id = ?",
      )
      .bind(quote.id)
      .all<{ content_json: string | null }>();
    for (const r of sharedRows.results ?? []) {
      for (const f of collectKnownAnswerFields(parseSectionComponents(r.content_json ?? ""))) sharedFields.add(f);
    }
    const funnels = (await readQuoteFunnels(db, quote.id))
      .filter((f) => f.status === "active")
      .sort((a, b) => (a.display_order ?? a.id) - (b.display_order ?? b.id));
    const cpFunnels: RuleCheckpointFunnel[] = [];
    for (const f of funnels) {
      const variant = (await readActiveFunnelVariants(db, f.id))[0];
      if (variant === undefined) continue;
      const pages = await loadVariantPages(db, variant.id);
      cpFunnels.push({
        id: f.id,
        publicId: f.public_id,
        name: f.funnel_name,
        pages: pages.map((p) => {
          const fields = new Set<string>();
          for (const slot of p.slots) {
            for (const cand of slot.candidates) {
              for (const cf of collectKnownAnswerFields(parseSectionComponents(cand.section.content_json ?? ""))) fields.add(cf);
            }
          }
          return { position: p.position, fields };
        }),
      });
    }
    return deriveRuleCheckpoint(conditionFields, sharedFields, cpFunnels).pagePosition ?? null;
  } catch {
    return null;
  }
}

interface RoutingRuleFields {
  ruleName: string;
  priority: number;
  status: string;
  matchMode: string | null;
  conditionsJson: string;
  conditionsHash: string;
  checkpointPage: number | null;
  targetFunnelId: number | null;
  feedName: string | null;
  valueMultiplier: number | null;
  redirectPct: number | null;
  targetOfferId: number | null;
  redirectUrl: string | null;
  redirectUrlAllowlisted: number;
}

// Validate + resolve a quote routing rule's columns (§4.3-3..9, M3). `existing`
// null ⇒ create (defaults applied); set ⇒ PATCH (merge — an absent body key
// keeps the stored value). Returns {value:null,errors} on any validation
// failure. Action gate (§4.3-9 / A-11): ≥1 of {target funnel, feed name,
// multiplier, a coherent redirect}. Redirect target = an Offer ref OR an
// allowlisted raw URL (reuses the §15.5 redirectAllowlist), paired with a
// redirect %. checkpoint_page is left NULL here (advisory cache; the runtime
// re-derives per §4.3-3 — see the module note: S1.3's deriveRuleCheckpoint
// populates the advisory cache once it lands).
async function buildRoutingRuleFields(
  db: D1Database,
  quote: LeadgenQuoteRow,
  body: Record<string, unknown>,
  existing: LeadgenQuoteRoutingRuleRow | null,
  allowlist: string[],
): Promise<{ value: RoutingRuleFields | null; errors: FieldErrors }> {
  const errors: FieldErrors = {};

  // rule_name — required, ≤80 (§4.3 / M3).
  let ruleName = existing?.rule_name ?? "";
  if (existing === null || body["rule_name"] !== undefined) {
    const v = trimmedString(body["rule_name"]);
    if (v === null) errors["rule_name"] = "rule_name is required";
    else if (v.length > 80) errors["rule_name"] = "rule_name must be at most 80 characters";
    else ruleName = v;
  }

  // priority — 1..100 integer (1 = highest, §4.3-4); default 100.
  let priority = existing?.priority ?? 100;
  if (body["priority"] !== undefined) {
    const p = body["priority"];
    if (typeof p !== "number" || !Number.isInteger(p) || p < 1 || p > 100) {
      errors["priority"] = "priority must be an integer between 1 and 100";
    } else priority = p;
  }

  // status — active|disabled (enable/disable rides this key on PATCH).
  let status = existing?.status ?? "active";
  if (body["status"] !== undefined) {
    const s = body["status"];
    if (s !== "active" && s !== "disabled") errors["status"] = "status must be one of active|disabled";
    else status = s;
  }

  // match_mode — all|any (NULL == all, the migration/evaluator convention).
  let matchMode = existing?.match_mode ?? null;
  if (body["match_mode"] !== undefined) {
    const m = body["match_mode"];
    if (m === "any") matchMode = "any";
    else if (m === "all" || m === null || m === "") matchMode = null;
    else errors["match_mode"] = "match_mode must be one of all|any";
  }

  // conditions_json — §21.4 shape + conditions_hash (same shape/hash as 0043).
  let conditionsJson = existing?.conditions_json ?? JSON.stringify({ groups: [] });
  let conditionsHash = existing?.conditions_hash ?? sha256Hex(conditionsJson);
  if (existing === null || body["conditions_json"] !== undefined || body["conditions"] !== undefined) {
    const conditions = body["conditions_json"] ?? body["conditions"] ?? { groups: [] };
    const shapeError = validateRoutingConditionsShape(conditions);
    if (shapeError !== null) errors["conditions_json"] = shapeError;
    else {
      conditionsJson = JSON.stringify(conditions);
      conditionsHash = sha256Hex(conditionsJson);
    }
  }

  // --- actions (each optional; ≥1 required, §4.3-9) -------------------------
  // target_funnel_id accepts EITHER a numeric id or a funnel public id (lgf_…),
  // the 03 §8.1 dual-id convention; it must belong to THIS quote.
  let targetFunnelId = existing?.target_funnel_id ?? null;
  if (body["target_funnel_id"] !== undefined) {
    const raw = body["target_funnel_id"];
    if (raw === null || raw === "") targetFunnelId = null;
    else {
      const f = await resolveFunnelRow(db, String(raw));
      if (f === null || f.quote_id !== quote.id) errors["target_funnel_id"] = "target funnel does not belong to this quote";
      else targetFunnelId = f.id;
    }
  }

  let feedName = existing?.feed_name ?? null;
  if (body["feed_name"] !== undefined) {
    const raw = body["feed_name"];
    if (raw === null || raw === "") feedName = null;
    else {
      const v = trimmedString(raw);
      if (v === null || v.length > 64 || !/^[A-Za-z0-9_-]+$/.test(v)) {
        errors["feed_name"] = "feed_name must be 1–64 chars of letters, digits, underscore or hyphen";
      } else feedName = v;
    }
  }

  let valueMultiplier = existing?.value_multiplier ?? null;
  if (body["value_multiplier"] !== undefined) {
    const raw = body["value_multiplier"];
    if (raw === null || raw === "") valueMultiplier = null;
    else if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) {
      errors["value_multiplier"] = "value_multiplier must be a positive number";
    } else valueMultiplier = raw;
  }

  let redirectPct = existing?.redirect_pct ?? null;
  if (body["redirect_pct"] !== undefined) {
    const raw = body["redirect_pct"];
    if (raw === null || raw === "") redirectPct = null;
    else if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0 || raw > 100) {
      errors["redirect_pct"] = "redirect_pct must be a number between 0 and 100";
    } else redirectPct = raw;
  }

  let targetOfferId = existing?.target_offer_id ?? null;
  if (body["target_offer_id"] !== undefined) {
    const parsed = asIntOrNull(body["target_offer_id"]);
    if (parsed === INVALID) errors["target_offer_id"] = "target_offer_id must be an integer id";
    else if (parsed === null) targetOfferId = null;
    else {
      const ex = await db.prepare("SELECT id FROM leadgen_offers WHERE id = ? LIMIT 1").bind(parsed).first<{ id: number }>();
      if (!ex) errors["target_offer_id"] = describeMissingReference("Offer");
      else targetOfferId = parsed;
    }
  }

  // redirect target = offer ref OR an allowlisted raw URL (§15.5 machinery).
  let redirectUrl = existing?.redirect_url ?? null;
  let redirectUrlAllowlisted = existing?.redirect_url_allowlisted ?? 0;
  if (body["redirect_url"] !== undefined) {
    const v = trimmedString(body["redirect_url"]);
    if (v === null) {
      redirectUrl = null;
      redirectUrlAllowlisted = 0;
    } else {
      let host = "";
      try {
        host = new URL(v).hostname;
      } catch {
        host = "";
      }
      if (host === "" || !allowlist.includes(host)) {
        errors["redirect_url"] = "redirect_url host is not on the admin redirect allowlist";
      } else {
        redirectUrl = v;
        redirectUrlAllowlisted = 1;
      }
    }
  }

  // --- redirect coherence + ≥1-action gate ----------------------------------
  if (targetOfferId !== null && redirectUrl !== null) {
    errors["redirect_url"] = "provide a redirect Offer OR a raw URL, not both";
  }
  const hasRedirectTarget = targetOfferId !== null || redirectUrl !== null;
  if (hasRedirectTarget !== (redirectPct !== null)) {
    errors["redirect_pct"] = "a redirect needs both a target (offer/URL) and a percentage";
  }
  const anyAction = targetFunnelId !== null || feedName !== null || valueMultiplier !== null || hasRedirectTarget || redirectPct !== null;
  if (!anyAction) errors["actions"] = ROUTING_RULE_MIN_ACTION_MESSAGE;

  if (Object.keys(errors).length > 0) return { value: null, errors };
  // Advisory §4.3-3 checkpoint cache via the shared deriveRuleCheckpoint (the
  // runtime + builder display re-derive; this only accelerates the display).
  let parsedConditions: unknown = {};
  try {
    parsedConditions = JSON.parse(conditionsJson);
  } catch {
    parsedConditions = {};
  }
  const checkpointPage = await deriveRoutingRuleCheckpointPage(db, quote, routingConditionFields(parsedConditions));
  return {
    value: {
      ruleName,
      priority,
      status,
      matchMode,
      conditionsJson,
      conditionsHash,
      checkpointPage,
      targetFunnelId,
      feedName,
      valueMultiplier,
      redirectPct,
      targetOfferId,
      redirectUrl,
      redirectUrlAllowlisted,
    },
    errors,
  };
}

// GET /quotes/:id/routing-rules — the quote's routing rules, priority-ascending.
export async function listQuoteRoutingRulesHandler(c: AdminContext): Promise<Response> {
  const quote = await resolveQuoteRow(c.env.DB, c.req.param("id") ?? "");
  if (quote === null) return c.json({ error: "Not Found" }, 404);
  const rules = await readQuoteRoutingRules(c.env.DB, quote.id);
  return c.json({ items: rules.map(quoteRoutingRuleRowToApi) });
}

// POST /quotes/:id/routing-rules — create a routing rule (§4.3-3..9, M3).
export async function createQuoteRoutingRuleHandler(c: AdminContext): Promise<Response> {
  const quote = await resolveQuoteRow(c.env.DB, c.req.param("id") ?? "");
  if (quote === null) return c.json({ error: "Not Found" }, 404);
  const body = (await readJsonBody(c)) ?? {};
  const { value, errors } = await buildRoutingRuleFields(c.env.DB, quote, body, null, redirectAllowlist(c.env));
  if (value === null) return c.json({ error: "Validation failed", fields: errors }, 400);

  const publicId = mintPublicId("quote_routing_rule");
  await c.env.DB.prepare(
    `INSERT INTO leadgen_quote_routing_rules
       (public_id, quote_id, rule_name, priority, status, match_mode, conditions_json, conditions_hash,
        checkpoint_page, target_funnel_id, feed_name, value_multiplier, redirect_pct, target_offer_id,
        redirect_url, redirect_url_allowlisted)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      publicId, quote.id, value.ruleName, value.priority, value.status, value.matchMode, value.conditionsJson,
      value.conditionsHash, value.checkpointPage, value.targetFunnelId, value.feedName, value.valueMultiplier,
      value.redirectPct, value.targetOfferId, value.redirectUrl, value.redirectUrlAllowlisted,
    )
    .run();
  const row = await c.env.DB.prepare("SELECT * FROM leadgen_quote_routing_rules WHERE public_id = ? LIMIT 1")
    .bind(publicId)
    .first<LeadgenQuoteRoutingRuleRow>();
  if (!row) return c.json({ error: "Insert failed" }, 500);
  return c.json(quoteRoutingRuleRowToApi(row), 201);
}

// PATCH /routing-rules/:rule_id — update (incl. enable/disable via `status`).
export async function updateQuoteRoutingRuleHandler(c: AdminContext): Promise<Response> {
  const existing = await resolveQuoteRoutingRuleRow(c.env.DB, c.req.param("rule_id") ?? c.req.param("id") ?? "");
  if (existing === null) return c.json({ error: "Not Found" }, 404);
  const quote = await c.env.DB.prepare("SELECT * FROM leadgen_quotes WHERE id = ? LIMIT 1")
    .bind(existing.quote_id)
    .first<LeadgenQuoteRow>();
  if (!quote) return c.json({ error: "Not Found" }, 404);
  const body = await readJsonBody(c);
  if (body === null) return c.json({ error: "Invalid JSON body" }, 400);

  const { value, errors } = await buildRoutingRuleFields(c.env.DB, quote, body, existing, redirectAllowlist(c.env));
  if (value === null) return c.json({ error: "Validation failed", fields: errors }, 400);

  await c.env.DB.prepare(
    `UPDATE leadgen_quote_routing_rules SET
       rule_name = ?, priority = ?, status = ?, match_mode = ?, conditions_json = ?, conditions_hash = ?,
       checkpoint_page = ?, target_funnel_id = ?, feed_name = ?, value_multiplier = ?, redirect_pct = ?,
       target_offer_id = ?, redirect_url = ?, redirect_url_allowlisted = ?
     WHERE id = ?`,
  )
    .bind(
      value.ruleName, value.priority, value.status, value.matchMode, value.conditionsJson, value.conditionsHash,
      value.checkpointPage, value.targetFunnelId, value.feedName, value.valueMultiplier, value.redirectPct,
      value.targetOfferId, value.redirectUrl, value.redirectUrlAllowlisted, existing.id,
    )
    .run();
  const row = await c.env.DB.prepare("SELECT * FROM leadgen_quote_routing_rules WHERE id = ? LIMIT 1")
    .bind(existing.id)
    .first<LeadgenQuoteRoutingRuleRow>();
  if (!row) return c.json({ error: "Update failed" }, 500);
  return c.json(quoteRoutingRuleRowToApi(row));
}

// POST /routing-rules/:rule_id/duplicate — copy a rule (new lgqr_, name "(copy)").
export async function duplicateQuoteRoutingRuleHandler(c: AdminContext): Promise<Response> {
  const src = await resolveQuoteRoutingRuleRow(c.env.DB, c.req.param("rule_id") ?? c.req.param("id") ?? "");
  if (src === null) return c.json({ error: "Not Found" }, 404);
  const publicId = mintPublicId("quote_routing_rule");
  const name = src.rule_name.length > 73 ? `${src.rule_name.slice(0, 73)} (copy)` : `${src.rule_name} (copy)`;
  await c.env.DB.prepare(
    `INSERT INTO leadgen_quote_routing_rules
       (public_id, quote_id, rule_name, priority, status, match_mode, conditions_json, conditions_hash,
        checkpoint_page, target_funnel_id, feed_name, value_multiplier, redirect_pct, target_offer_id,
        redirect_url, redirect_url_allowlisted)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      publicId, src.quote_id, name, src.priority, src.status, src.match_mode, src.conditions_json,
      src.conditions_hash, src.checkpoint_page, src.target_funnel_id, src.feed_name, src.value_multiplier,
      src.redirect_pct, src.target_offer_id, src.redirect_url, src.redirect_url_allowlisted,
    )
    .run();
  const row = await c.env.DB.prepare("SELECT * FROM leadgen_quote_routing_rules WHERE public_id = ? LIMIT 1")
    .bind(publicId)
    .first<LeadgenQuoteRoutingRuleRow>();
  if (!row) return c.json({ error: "Duplicate failed" }, 500);
  return c.json({ ...quoteRoutingRuleRowToApi(row), duplicated_from: src.public_id }, 201);
}

// DELETE /routing-rules/:rule_id — hard-delete (rules are cheap, no history).
export async function deleteQuoteRoutingRuleHandler(c: AdminContext): Promise<Response> {
  const existing = await resolveQuoteRoutingRuleRow(c.env.DB, c.req.param("rule_id") ?? c.req.param("id") ?? "");
  if (existing === null) return c.json({ error: "Not Found" }, 404);
  await c.env.DB.prepare("DELETE FROM leadgen_quote_routing_rules WHERE id = ?").bind(existing.id).run();
  return c.json({ ok: true, id: existing.id, public_id: existing.public_id });
}

// R2 SRC-11C-B (contract §7 / A.1 #11-C follow-up — the operator-path gap the
// owner flagged: a funnel-page ruled chip showed only the first candidate's
// bare name, no way to see WHAT the rule actually does): resolves a ruled
// slot's cases + default to their candidate NAMES, right where the numeric
// section id (rules.cases[].section_id / default_section_id) and the name
// (slot.candidates[].section.section_name, keyed by the SAME numeric
// section.id) are jointly available — funnel.ts's board owns the actual
// PLAIN-LANGUAGE SENTENCE phrasing (reused from ui-rules-builder.ts's
// conditionsSentence, the quote-level routing rules' own generator); this
// only resolves ids to names, never re-deriving the field/op vocabulary.
function ruledSlotSummary(
  slot: ResolvedPageSlot,
): { cases: Array<{ field: string; op: string; value: unknown; section_name: string }>; default_section_name: string } | null {
  const rules = slot.rules;
  if (rules === null) return null;
  const nameByNumId = new Map(slot.candidates.map((c) => [c.section.id, c.section.section_name]));
  const cases = rules.cases.map((rc) => {
    const group = rc.conditions.groups[0];
    return {
      field: group?.field ?? "",
      op: group?.op ?? "eq",
      value: group?.value ?? null,
      section_name: nameByNumId.get(rc.section_id) ?? "a section",
    };
  });
  return { cases, default_section_name: nameByNumId.get(rules.default_section_id) ?? "a section" };
}

// Round-4 P3a: API-safe projection of a resolved page/slot/candidate tree
// (loadVariantPages — the SAME loader the public runtime uses). A "fixed"
// slot (exactly 1 candidate, no rules/allocations) surfaces kind:"fixed" so
// the structure panel (P3b) never has to re-derive it from the absence of
// rules/allocations.
function pageToApi(page: ResolvedFunnelPage): Record<string, unknown> {
  return {
    page_id: page.public_id,
    position: page.position,
    name: page.name,
    slots: page.slots.map((slot) => ({
      slot_id: slot.id,
      position: slot.position,
      slot_revision: slot.slot_revision,
      kind: slot.rules !== null ? "ruled" : slot.ab_allocations !== null ? "ab" : "fixed",
      rules: slot.rules,
      rule_summary: ruledSlotSummary(slot),
      allocations: slot.ab_allocations,
      candidates: slot.candidates.map((c) => ({
        section_id: c.section.public_id,
        section_name: c.section.section_name,
        // P3b follow-up (§8.2 board, DEV-59 parity): the section's numeric id,
        // server-internal — quoteStructureHandler's board projection batches
        // these to attach mapping_status (below), then this key is stripped
        // (never a public wire field; VariantSectionNode already exposes a
        // numeric section_id elsewhere, but this candidate shape's `section_id`
        // is the PUBLIC id by established convention — kept distinct to avoid
        // overloading that key with two different types).
        section_num_id: c.section.id,
      })),
    })),
  };
}

// P3b follow-up (§8.2 board, DEV-59 parity) — attach each page-slot candidate's
// mapping_status (sectionMappingStatusMap) onto the ALREADY-BUILT pageToApi
// JSON in place, then strip the server-internal section_num_id carrier. Pages
// is the loosely-typed Record<string, unknown>[] readVariantPagesApi returns;
// walked defensively (a shape drift here degrades to "no dot" it never throws).
function attachMappingStatusToPages(
  pages: Record<string, unknown>[],
  statusMap: Map<number, OrderedVariantSection["mapping_status"]>,
): void {
  for (const page of pages) {
    const slots = (page as { slots?: unknown }).slots;
    if (!Array.isArray(slots)) continue;
    for (const slot of slots as Record<string, unknown>[]) {
      const candidates = (slot as { candidates?: unknown }).candidates;
      if (!Array.isArray(candidates)) continue;
      for (const cand of candidates as Record<string, unknown>[]) {
        const numId = cand["section_num_id"];
        delete cand["section_num_id"];
        if (typeof numId === "number") cand["mapping_status"] = statusMap.get(numId) ?? "none";
      }
    }
  }
}

// Every candidate section's numeric id across a set of pages (pageToApi
// shape) — the collection half of attachMappingStatusToPages's batch query.
function collectCandidateSectionIds(pages: Record<string, unknown>[]): number[] {
  const ids: number[] = [];
  for (const page of pages) {
    const slots = (page as { slots?: unknown }).slots;
    if (!Array.isArray(slots)) continue;
    for (const slot of slots as Record<string, unknown>[]) {
      const candidates = (slot as { candidates?: unknown }).candidates;
      if (!Array.isArray(candidates)) continue;
      for (const cand of candidates as Record<string, unknown>[]) {
        const numId = (cand as { section_num_id?: unknown }).section_num_id;
        if (typeof numId === "number") ids.push(numId);
      }
    }
  }
  return ids;
}

// EXPORTED (Round-4 P3a item 5, P3b request): the structure panel's builder
// SSR reads this directly instead of re-deriving its own projection of
// loadVariantPages — one source of the page/slot API shape.
export async function readVariantPagesApi(db: D1Database, variantId: number): Promise<Record<string, unknown>[]> {
  const pages = await loadVariantPages(db, variantId);
  return pages.map(pageToApi);
}

async function variantDetailJson(
  db: D1Database,
  variant: LeadgenFunnelVariantRow,
): Promise<Record<string, unknown>> {
  // Three independent reads — they used to be three sequential awaits, and on
  // the save path (which the funnel board issues for every add-section /
  // add-page) each one is a network round trip in production. Same reads, same
  // values; the page/slot tree still rides alongside the flat `sections`
  // projection (untouched — legacy single-page-per-section callers read EXACTLY
  // what they always have; Round-4 P3a).
  const [sections, rules, pages] = await Promise.all([
    readVariantSections(db, variant.id),
    readVariantRules(db, variant.id),
    readVariantPagesApi(db, variant.id),
  ]);
  return {
    ...variantRowToApi(variant),
    sections,
    pages,
    rules: rules.map(ruleRowToApi),
    // §15.3 the auction runs after the MAX position section (derived, no
    // "final" flag). null when the variant has no sections yet.
    auction_entry_position: auctionEntryPosition(sections),
  };
}

// EXPORTED (v2.5 04 §4.8): frame-handlers.ts reads the funnel's base-design
// head to resolve the theme editor's base design. Rework M1 (§4.3-10): the
// deterministic order is variant_label ASC, id ASC (no is_control axis) — so
// [0] is the A-labelled variant (the single active variant with no test).
export async function readFunnelVariants(
  db: D1Database,
  funnelId: number,
): Promise<LeadgenFunnelVariantRow[]> {
  const result = await db
    .prepare(
      "SELECT * FROM leadgen_funnel_variants WHERE funnel_id = ? ORDER BY variant_label ASC, id ASC",
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
      "SELECT * FROM leadgen_funnel_variants WHERE funnel_id = ? AND status = 'active' ORDER BY variant_label ASC, id ASC",
    )
    .bind(funnelId)
    .all<LeadgenFunnelVariantRow>();
  return result.results ?? [];
}

// The funnel's RUNNING A/B test ROW (0..1 per funnel, uq_leadgen_abtest_running),
// or null. EXPORTED-shape reader (row, not boolean) — forkVariantHandler's new
// arm-bootstrap branch (conductor extension round 2) needs the test's id to
// bump its revision on a clean re-bucket; funnelHasRunningTest below is kept as
// a thin boolean wrapper so its existing callers (the B1 arm-set/label freeze,
// the allocation-PUT Σ guard) are unchanged.
async function getRunningAbTest(db: D1Database, funnelId: number): Promise<LeadgenFunnelAbTestRow | null> {
  return (
    (await db
      .prepare("SELECT * FROM leadgen_funnel_ab_tests WHERE funnel_id = ? AND status = 'running' LIMIT 1")
      .bind(funnelId)
      .first<LeadgenFunnelAbTestRow>()) ?? null
  );
}

// True iff the funnel has a RUNNING A/B test (status='running',
// uq_leadgen_abtest_running → 0..1 per funnel). The single running-test detection
// reused by the allocation-PUT Σ guard AND the B1 arm-set/label freeze below.
async function funnelHasRunningTest(db: D1Database, funnelId: number): Promise<boolean> {
  return (await getRunningAbTest(db, funnelId)) !== null;
}

// Even split of 10000 bp across n arms (§4.3-10 "equal arms, Σbp=10000"); any
// remainder (10000 is not evenly divisible by n) goes to the FIRST arms in the
// caller's iteration order — deterministic because every caller iterates the
// file's established variant_label ASC, id ASC sort.
function equalSplitBp(n: number): number[] {
  const base = Math.floor(10000 / n);
  const remainder = 10000 - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < remainder ? 1 : 0));
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

// Rework M1 (§4.3-10): "with no running test a funnel has exactly one active
// variant (validation enforces this)." A second active variant is legal ONLY
// as an arm of a running A/B test — arms are added via the A/B tab, never a raw
// variant create/fork. The mutating endpoints that could create that state
// (createVariantUnderFunnel, forkVariantHandler) reject with this 409.
const SINGLE_ACTIVE_VARIANT_MESSAGE =
  "This funnel already has an active variant. A second active variant is only allowed as an arm of a running A/B test — set one up from the A/B tab.";

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

// R2 D5 (contract §7 D5): the quote's per-quote default template override
// (leadgen_quote_default_template, migration 0055) resolved to its PUBLIC id,
// or null when the quote has no override row (the global is_default stays the
// cross-quote fallback — reported by the frame-template-records list, not
// here). Fail-safe: a pre-0055 schema degrades to null, never throwing —
// mirrors every other M5 fallback's read discipline in this file.
async function resolveQuoteDefaultTemplatePublicId(db: D1Database, quotePublicId: string): Promise<string | null> {
  try {
    const row = await db
      .prepare(
        `SELECT ft.public_id AS public_id
           FROM leadgen_quote_default_template qdt
           JOIN leadgen_frame_templates ft ON ft.id = qdt.frame_template_id
          WHERE qdt.quote_public_id = ? LIMIT 1`,
      )
      .bind(quotePublicId)
      .first<{ public_id: string }>();
    return row?.public_id ?? null;
  } catch {
    return null;
  }
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
  return {
    ...quoteRowToApi(quote),
    funnels: funnelJson,
    default_template_id: await resolveQuoteDefaultTemplatePublicId(db, quote.public_id),
  };
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
// POST /quotes — create (§15.1) + auto-seed one Funnel (lgf_) + its single
// active Variant (lgn_, label 'A') so "every Quote has ≥1 funnel variant"
// holds on create (Rework M1 §4.3-10: no control concept — the seed is the
// one active variant, deterministic label 'A').
// ---------------------------------------------------------------------------

function validateQuoteCreate(body: Record<string, unknown>): {
  errors: FieldErrors;
  value: { quote_name: string; activity: string; verticals: string[]; status: LeadgenQuoteStatus } | null;
} {
  const errors: FieldErrors = {};
  const quoteName = trimmedString(body["quote_name"]);
  if (quoteName === null) errors["quote_name"] = "quote_name is required";
  const activity = trimmedString(body["activity"]);
  if (activity === null) errors["activity"] = "Activity is required";
  const verticals = parseStringArray(body["verticals"] ?? body["verticals_json"]);
  if (verticals.length === 0) errors["verticals"] = "At least one vertical is required";
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

// Rework M5 / §11D — "the default template seeds new funnels": the current
// default saved frame template's numeric id, or null. This is a CREATE-TIME
// seed (not a resolve-time fallback — "seeds" is creation vocabulary): a funnel
// captures the default AT CREATION, so a later "Set as default" swap never
// retroactively re-skins an existing funnel. Fail-safe: any read error (a
// pre-M5 money-path harness with no leadgen_frame_templates table) ⇒ null ⇒ the
// funnel is created with NO template, exactly as before.
//
// R2 D5 (contract §7 D5, owner ruling on A.1 #11-D/ADJ-B2): the per-quote
// override (leadgen_quote_default_template, migration 0055) now REPLACES the
// global is_default as this seed — checked FIRST when a quotePublicId is
// given — with the global is_default staying the cross-quote FALLBACK when
// the quote has no override row (or a pre-0055 schema has no such table yet).
async function resolveDefaultFrameTemplateId(db: D1Database, quotePublicId?: string): Promise<number | null> {
  if (quotePublicId !== undefined) {
    try {
      const perQuote = await db
        .prepare("SELECT frame_template_id FROM leadgen_quote_default_template WHERE quote_public_id = ? LIMIT 1")
        .bind(quotePublicId)
        .first<{ frame_template_id: number | null }>();
      if (perQuote !== null && perQuote.frame_template_id !== null && perQuote.frame_template_id !== undefined) {
        return perQuote.frame_template_id;
      }
    } catch {
      /* pre-0055 schema (no leadgen_quote_default_template table yet) — fall through to the global default */
    }
  }
  try {
    const row = await db
      .prepare("SELECT id FROM leadgen_frame_templates WHERE is_default = 1 LIMIT 1")
      .first<{ id: number }>();
    return row?.id ?? null;
  } catch {
    return null;
  }
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
  // public_id) → single active variant (linked by the funnel's public_id). This
  // core batch touches ONLY pre-rework columns, so it applies on any leadgen
  // schema (some money-path harnesses still replay only 0036–0044).
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
         (public_id, funnel_id, variant_label, traffic_allocation_bp, funnel_design_id, status)
       VALUES (?, (SELECT id FROM leadgen_funnels WHERE public_id = ?), 'A', 10000, 'default', 'active')`,
    ).bind(variantPublicId, funnelPublicId),
  ]);
  // Rework M4 (§4.3-1/§4.3-7): the seed funnel is the board's first column
  // (display_order = 1) and the quote's default funnel — so a fresh single-funnel
  // quote is activatable (mirrors the 0049 backfill). Best-effort: a pre-rework
  // schema (no display_order / default_funnel_id column) rolls this back and the
  // quote is created without them (the old behavior), never failing the create.
  try {
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE leadgen_funnels SET display_order = 1 WHERE public_id = ?").bind(funnelPublicId),
      c.env.DB.prepare(
        "UPDATE leadgen_quotes SET default_funnel_id = (SELECT id FROM leadgen_funnels WHERE public_id = ?) WHERE public_id = ?",
      ).bind(funnelPublicId, quotePublicId),
    ]);
  } catch {
    /* pre-rework schema without the M4 columns — leave them unset */
  }

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
    if (v.length === 0) errors["verticals"] = "At least one vertical is required";
    else { verticalsJson = JSON.stringify(v); touched = true; }
  }
  if (body["status"] !== undefined) {
    const s = body["status"];
    if (typeof s !== "string" || !(QUOTE_STATUSES as readonly string[]).includes(s)) {
      errors["status"] = `status must be one of ${QUOTE_STATUSES.join("|")}`;
    } else { status = s as LeadgenQuoteStatus; touched = true; }
  }
  // R2 D5 (contract §7 D5): PATCH is the vehicle for "Set as default" going
  // PER-QUOTE (the Templates tab writes/updates THIS quote's row in
  // leadgen_quote_default_template, migration 0055 — reusing this ALREADY-
  // routed endpoint rather than a new one; the global is_default stays the
  // cross-quote fallback, untouched). null clears the override (falls back
  // to the global default); an integer id must reference a real saved
  // template.
  let defaultTemplateAction: { kind: "none" } | { kind: "clear" } | { kind: "set"; frameTemplateId: number } = {
    kind: "none",
  };
  if (body["default_template_id"] !== undefined) {
    const parsed = asIntOrNull(body["default_template_id"]);
    if (parsed === INVALID) {
      errors["default_template_id"] = "default_template_id must be an integer id or null";
    } else if (parsed === null) {
      defaultTemplateAction = { kind: "clear" };
      touched = true;
    } else {
      const ex = await c.env.DB.prepare("SELECT id FROM leadgen_frame_templates WHERE id = ? LIMIT 1")
        .bind(parsed)
        .first<{ id: number }>();
      if (!ex) errors["default_template_id"] = describeMissingReference("Template");
      else { defaultTemplateAction = { kind: "set", frameTemplateId: parsed }; touched = true; }
    }
  }
  if (Object.keys(errors).length > 0) return c.json({ error: "Validation failed", fields: errors }, 400);
  if (!touched) return c.json({ error: "No updatable fields provided" }, 400);

  if (defaultTemplateAction.kind === "set") {
    await c.env.DB.prepare(
      `INSERT INTO leadgen_quote_default_template (quote_public_id, frame_template_id) VALUES (?, ?)
       ON CONFLICT(quote_public_id) DO UPDATE SET frame_template_id = excluded.frame_template_id`,
    )
      .bind(existing.public_id, defaultTemplateAction.frameTemplateId)
      .run();
  } else if (defaultTemplateAction.kind === "clear") {
    await c.env.DB.prepare("DELETE FROM leadgen_quote_default_template WHERE quote_public_id = ?")
      .bind(existing.public_id)
      .run();
  }

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

// Round-4 D-8 (lifecycle parity, row R4-38): "live history" for a Quote — any
// site activation row (leadgen_site_quotes) OR any row in the quote-level
// analytics mirror (leadgen_analytics_quote, 0037 — keyed by quote_public_id).
// ONE check feeds both the DELETE guard below and quoteUsageHandler's
// delete_eligibility, so the two can never disagree about "in use."
interface QuoteLiveHistory {
  site_activations: number;
  analytics_rows: number;
}

async function quoteLiveHistory(db: D1Database, quote: LeadgenQuoteRow): Promise<QuoteLiveHistory> {
  const row = await db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM leadgen_site_quotes WHERE quote_id = ?) AS site_activations,
         (SELECT COUNT(*) FROM leadgen_analytics_quote WHERE quote_public_id = ?) AS analytics_rows`,
    )
    .bind(quote.id, quote.public_id)
    .first<{ site_activations: number; analytics_rows: number }>();
  return {
    // ?? not || (D1 rule) — a true 0 must survive.
    site_activations: Number(row?.site_activations ?? 0),
    analytics_rows: Number(row?.analytics_rows ?? 0),
  };
}

export async function deleteQuoteHandler(c: AdminContext): Promise<Response> {
  const row = await resolveQuoteRow(c.env.DB, c.req.param("id") ?? "");
  if (row === null) return c.json({ error: "Not Found" }, 404);
  // Round-4 D-8: DELETE stays archive-semantics (status flip), but a Quote
  // carrying live history is REFUSED outright — fail closed to Archive
  // (PATCH {status:'archived'} is already reachable + unrestricted, see
  // patchQuoteHandler's generic status merge) rather than silently
  // "deleting" a quote that real sites/traffic still reference.
  const history = await quoteLiveHistory(c.env.DB, row);
  if (history.site_activations > 0 || history.analytics_rows > 0) {
    return c.json(
      { error: "This quote has live history — archive it instead", usage: history },
      409,
    );
  }
  await c.env.DB.prepare("UPDATE leadgen_quotes SET status = 'archived', updated_at = unixepoch() WHERE id = ?")
    .bind(row.id)
    .run();
  return c.json({ ok: true, id: row.id, public_id: row.public_id, status: "archived" });
}

// ---------------------------------------------------------------------------
// GET /quotes/:id/usage (Round-4 A-2, row R4-38) — where-used, matching the
// offers usage response shape (offers-handlers.ts buildOfferUsageReport):
// {kinds:[{kind,count,items,warning_only}], delete_eligibility}. Both kinds
// are blocking (never warning_only) so `eligible` mirrors EXACTLY the
// condition deleteQuoteHandler enforces above.
// ---------------------------------------------------------------------------

interface QuoteUsageItem {
  id: string | number;
  public_id: string;
  name: string;
  link: string;
}
interface QuoteUsageKind {
  kind: string;
  count: number;
  items: QuoteUsageItem[];
  warning_only: boolean;
}

export async function quoteUsageHandler(c: AdminContext): Promise<Response> {
  const row = await resolveQuoteRow(c.env.DB, c.req.param("id") ?? "");
  if (row === null) return c.json({ error: "Not Found" }, 404);

  const sites = await c.env.DB.prepare(
    `SELECT s.id AS id, s.id AS public_id, s.name AS name,
            '/admin/leadgen/quotes/' || ? || '/edit#activation' AS link
     FROM leadgen_site_quotes sq JOIN sites s ON s.id = sq.site_id
     WHERE sq.quote_id = ? ORDER BY s.name`,
  )
    .bind(row.public_id, row.id)
    .all<QuoteUsageItem>();
  const siteItems = sites.results ?? [];

  const history = await quoteLiveHistory(c.env.DB, row);
  const kinds: QuoteUsageKind[] = [
    { kind: "site_activations", count: siteItems.length, items: siteItems, warning_only: false },
    {
      kind: "analytics_history",
      count: history.analytics_rows,
      items:
        history.analytics_rows > 0
          ? [{ id: 1, public_id: "", name: `${history.analytics_rows} analytics rows`, link: "" }]
          : [],
      warning_only: false,
    },
  ];
  const blocking = kinds.filter((k) => !k.warning_only && k.count > 0).map((k) => k.kind);
  return c.json({
    quote: { id: row.id, public_id: row.public_id, name: row.quote_name },
    usage: { kinds, delete_eligibility: { eligible: blocking.length === 0, blocking_kinds: blocking } },
  });
}

// ---------------------------------------------------------------------------
// POST /quotes/:id/duplicate (Round-4 A-2, row R4-02) — deep-copy the quote +
// every funnel's single ACTIVE variant's ordered sections/rules (the SAME clone
// shape forkVariantHandler already uses for one variant, looped over the whole
// quote tree, plus the funnel's own frame_config_json/theme_json/display_order/
// frame_template_id — a "coherent, publishable draft quote" needs its visual
// template + board order, not just section order) + the quote-scoped routing
// rules (Rework M3), with target_funnel_id + default_funnel_id remapped to the
// CLONE's funnels. NEVER copied: site activations, analytics/attempt history,
// A/B tests. Rework M1 (§4.3-10): with no running test a funnel has exactly ONE
// active variant, so the clone copies that single active variant per funnel
// (traffic_allocation_bp reset to 10000 — the full-traffic single variant); a
// source funnel mid-test (>1 active) copies only its active arms' content, but
// the copy is a fresh no-test draft (ab_test_id NULL; A/B is re-created on the
// copy intentionally, the SAME "never copied" discipline duplicateOfferHandler
// documents for analytics/cap-counters/test-results).
// ---------------------------------------------------------------------------

interface QuoteDuplicateCounts {
  funnels: number;
  variants: number;
  sections: number;
  rules: number;
  // Rework M3: the quote-scoped routing rules copied (distinct from `rules`,
  // which counts the per-variant auction-domain leadgen_funnel_rules).
  routing_rules: number;
}

// ---------------------------------------------------------------------------
// Round-4 P4b fix round (conductor ruling, consolidated commit): the v2
// envelope (rule_name/status/match_mode/checkpoint_page/target_funnel_
// variant_id/value_multiplier/redirect_pct) is now UNCONDITIONAL — every rule
// type gets the full migration-0043/0044 column set (the reference's table
// shows names+statuses on every row, not just route_funnel_variant). This
// REVERSES the prior round's route_funnel_variant-only scoping: that scoping
// existed only because 6 non-owned vitest files hardcoded a pre-0043/0044
// migration replay list; the conductor has since granted the one-line fix to
// each of those 6 files (0043 + 0044 added — verified clean replay), so the
// schema landmine this worked around no longer exists.
// `variantIdSql`/`variantIdBindValue` are either a direct "?" + numeric id
// (putVariantHandler, forkVariantHandler — both write into an id that is
// already resolved/known) or a "(SELECT id FROM leadgen_funnel_variants
// WHERE public_id = ?)" subquery + a public id (duplicateQuoteHandler, whose
// new variant row is minted in the SAME batch). `targetVariantIdSql`/
// `targetVariantIdBindValue` default to a direct bind of the ALREADY-
// resolved target_funnel_variant_id; duplicateQuoteHandler overrides both
// with its OWN remap subquery (a cloned quote's target must point at the
// CLONE's variant, not the original's).
// ---------------------------------------------------------------------------
interface RuleInsertRow {
  publicId: string;
  ruleType: string;
  conditionsJson: string;
  conditionsHash: string;
  targetOfferId: number | null;
  targetSectionId: number | null;
  redirectUrl: string | null;
  redirectAllowlisted: number;
  priority: number;
  enabled: number;
  targetFunnelVariantId: number | null;
  valueMultiplier: number | null;
  checkpointPage: number | null;
  matchMode: string | null;
  ruleName: string | null;
  status: string;
  redirectPct: number | null;
}
function insertRuleStatement(
  db: D1Database,
  variantIdSql: string,
  variantIdBindValue: number | string,
  r: RuleInsertRow,
  targetVariantIdSql = "?",
  targetVariantIdBindValue: number | string | null = r.targetFunnelVariantId,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO leadgen_funnel_rules
         (public_id, variant_id, rule_type, conditions_json, conditions_hash, target_offer_id, target_section_id,
          redirect_url, redirect_url_allowlisted, priority, enabled,
          target_funnel_variant_id, value_multiplier, checkpoint_page, match_mode, rule_name, status, redirect_pct)
       VALUES (?, ${variantIdSql}, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${targetVariantIdSql}, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      r.publicId, variantIdBindValue, r.ruleType, r.conditionsJson, r.conditionsHash, r.targetOfferId, r.targetSectionId,
      r.redirectUrl, r.redirectAllowlisted, r.priority, r.enabled,
      targetVariantIdBindValue, r.valueMultiplier, r.checkpointPage, r.matchMode, r.ruleName, r.status, r.redirectPct,
    );
}

export async function duplicateQuoteHandler(c: AdminContext): Promise<Response> {
  const src = await resolveQuoteRow(c.env.DB, c.req.param("id") ?? "");
  if (src === null) return c.json({ error: "Not Found" }, 404);

  const body = (await readJsonBody(c)) ?? {};
  const rawName = trimmedString(body["quote_name"] ?? body["name"]);
  const name = rawName ?? `${src.quote_name} (copy)`;

  const funnels = await readQuoteFunnels(c.env.DB, src.id);
  const newQuotePublicId = mintPublicId("quote");
  // §7.3-style one transaction (offers duplicate idiom): the quote AND every
  // funnel/variant/section/rule land in ONE batch via public_id subqueries —
  // a mid-batch failure rolls the WHOLE clone back, never a half-cloned quote.
  const statements: D1PreparedStatement[] = [
    c.env.DB.prepare(
      `INSERT INTO leadgen_quotes (public_id, quote_name, activity, verticals_json, status)
       VALUES (?, ?, ?, ?, 'draft')`,
    ).bind(newQuotePublicId, name, src.activity, src.verticals_json),
  ];

  const counts: QuoteDuplicateCounts = { funnels: 0, variants: 0, sections: 0, rules: 0, routing_rules: 0 };
  // Rework M3/M4: source funnel id -> clone's new funnel public id (for the
  // routing-rule target_funnel_id remap + the default_funnel_id remap below).
  const newFunnelPublicIds = new Map<number, string>();
  for (const funnel of funnels) {
    const newFunnelPublicId = mintPublicId("funnel");
    newFunnelPublicIds.set(funnel.id, newFunnelPublicId);
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO leadgen_funnels (public_id, quote_id, funnel_name, status, frame_config_json, theme_json, display_order, frame_template_id)
         VALUES (?, (SELECT id FROM leadgen_quotes WHERE public_id = ?), ?, 'active', ?, ?, ?, ?)`,
      ).bind(
        newFunnelPublicId, newQuotePublicId, funnel.funnel_name, funnel.frame_config_json, funnel.theme_json,
        funnel.display_order, funnel.frame_template_id,
      ),
    );
    counts.funnels += 1;

    // Rework M1 (§4.3-10): copy the funnel's ACTIVE variant(s) — with no running
    // test that is exactly one (no is_control axis). A/B tests are never copied,
    // so the clone is a fresh no-test draft. Pre-mint each clone's public id
    // BEFORE any INSERT so a rule targeting a SIBLING variant of this SAME funnel
    // remaps regardless of loop order.
    const variants = await readActiveFunnelVariants(c.env.DB, funnel.id);
    const newControlVariantPublicIds = new Map<number, string>();
    for (const variant of variants) {
      newControlVariantPublicIds.set(variant.id, mintPublicId("funnel_variant"));
    }
    for (const variant of variants) {
      const newVariantPublicId = newControlVariantPublicIds.get(variant.id)!;
      statements.push(
        c.env.DB.prepare(
          `INSERT INTO leadgen_funnel_variants
             (public_id, funnel_id, ab_test_id, variant_label, traffic_allocation_bp, funnel_design_id,
              auction_id, lander_enabled, lander_headline, lander_subheadline, lander_body_json,
              lander_hero_media_id, lander_hero_media_url, lander_cta_json, content_version, status,
              frame_overrides_json, frame_template_id)
           VALUES (?, (SELECT id FROM leadgen_funnels WHERE public_id = ?), NULL, ?, 10000, ?, ?, ?, ?, ?, ?,
                   ?, ?, ?, 1, 'active', ?, ?)`,
        ).bind(
          newVariantPublicId, newFunnelPublicId, variant.variant_label,
          variant.funnel_design_id, variant.auction_id, variant.lander_enabled,
          variant.lander_headline, variant.lander_subheadline, variant.lander_body_json,
          variant.lander_hero_media_id, variant.lander_hero_media_url, variant.lander_cta_json,
          variant.frame_overrides_json, variant.frame_template_id,
        ),
      );
      counts.variants += 1;

      // Round-4 P3a review round (minor-3): clone the source variant's REAL
      // page/slot structure (fresh ids, rules/allocations preserved,
      // slot_revision reset to 0) instead of bare variant-section rows --
      // the OLD loop here (readVariantSections + a flat INSERT) silently
      // flattened any A/B or ruled slot into sequential mandatory pages.
      // `counts.sections` keeps its EXISTING response meaning (one count
      // per cloned candidate/variant-section row, not per page/slot).
      const pages = await loadVariantPages(c.env.DB, variant.id);
      const cloneCounts = pushPageCloneStatements(c.env.DB, statements, newVariantPublicId, pages);
      counts.sections += cloneCounts.candidates;

      const rules = await readVariantRules(c.env.DB, variant.id);
      for (const r of rules) {
        // Round-4 P4b: a route_funnel_variant target is remapped to the
        // clone's new public id ONLY when the target was itself one of this
        // funnel's cloned CONTROL variants; a target on a non-control sibling
        // (the common case -- adversarial-review finding 4 clones ONLY the
        // control arm) has no clone to point at, so it is dropped to NULL
        // rather than carry the WRONG (foreign/original-quote) internal id.
        // The impossible-sentinel public_id ('') makes the subquery resolve
        // to NULL uniformly -- no conditional SQL text/bind-arity needed.
        const remappedTargetPublicId =
          r.target_funnel_variant_id !== null
            ? (newControlVariantPublicIds.get(r.target_funnel_variant_id) ?? "")
            : "";
        statements.push(
          insertRuleStatement(
            c.env.DB,
            "(SELECT id FROM leadgen_funnel_variants WHERE public_id = ?)",
            newVariantPublicId,
            {
              publicId: mintPublicId("funnel_rule"),
              ruleType: r.rule_type,
              conditionsJson: r.conditions_json,
              conditionsHash: r.conditions_hash,
              targetOfferId: r.target_offer_id,
              targetSectionId: r.target_section_id,
              redirectUrl: r.redirect_url,
              redirectAllowlisted: r.redirect_url_allowlisted,
              priority: r.priority,
              enabled: r.enabled,
              targetFunnelVariantId: r.target_funnel_variant_id,
              valueMultiplier: r.value_multiplier,
              checkpointPage: r.checkpoint_page,
              matchMode: r.match_mode,
              ruleName: r.rule_name,
              status: r.status,
              redirectPct: r.redirect_pct,
            },
            "(SELECT id FROM leadgen_funnel_variants WHERE public_id = ?)",
            remappedTargetPublicId,
          ),
        );
        counts.rules += 1;
      }
    }
  }

  // Rework M3: copy the quote-scoped routing rules, remapping target_funnel_id
  // to the CLONE's funnel (impossible-sentinel '' → NULL when absent/undeivable,
  // the same idiom the variant-target remap uses). target_offer_id + redirect_url
  // are carried AS-IS (offers/URLs are shared entities, not cloned). feed_name +
  // multiplier + redirect_pct + conditions + priority + status all preserved.
  const srcRoutingRules = await readQuoteRoutingRules(c.env.DB, src.id);
  for (const rr of srcRoutingRules) {
    const remappedFunnelPublicId =
      rr.target_funnel_id !== null ? (newFunnelPublicIds.get(rr.target_funnel_id) ?? "") : "";
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO leadgen_quote_routing_rules
           (public_id, quote_id, rule_name, priority, status, match_mode, conditions_json, conditions_hash,
            checkpoint_page, target_funnel_id, feed_name, value_multiplier, redirect_pct, target_offer_id,
            redirect_url, redirect_url_allowlisted)
         VALUES (?, (SELECT id FROM leadgen_quotes WHERE public_id = ?), ?, ?, ?, ?, ?, ?, ?,
                 (SELECT id FROM leadgen_funnels WHERE public_id = ?), ?, ?, ?, ?, ?, ?)`,
      ).bind(
        mintPublicId("quote_routing_rule"), newQuotePublicId, rr.rule_name, rr.priority, rr.status, rr.match_mode,
        rr.conditions_json, rr.conditions_hash, rr.checkpoint_page, remappedFunnelPublicId, rr.feed_name,
        rr.value_multiplier, rr.redirect_pct, rr.target_offer_id, rr.redirect_url, rr.redirect_url_allowlisted,
      ),
    );
    counts.routing_rules += 1;
  }

  // Rework M4: remap the clone's default_funnel_id to the clone of the source's
  // default funnel (NULL when the source had none, or its default funnel was
  // not among the cloned funnels — defensive).
  const defaultFunnelClonePublicId =
    src.default_funnel_id !== null ? (newFunnelPublicIds.get(src.default_funnel_id) ?? "") : "";
  statements.push(
    c.env.DB.prepare(
      `UPDATE leadgen_quotes SET default_funnel_id = (SELECT id FROM leadgen_funnels WHERE public_id = ?)
       WHERE public_id = ?`,
    ).bind(defaultFunnelClonePublicId, newQuotePublicId),
  );

  await c.env.DB.batch(statements);

  const dup = await c.env.DB.prepare("SELECT * FROM leadgen_quotes WHERE public_id = ? LIMIT 1")
    .bind(newQuotePublicId)
    .first<LeadgenQuoteRow>();
  if (!dup) return c.json({ error: "Duplicate failed" }, 500);
  return c.json(
    {
      ...(await quoteDetailJson(c.env.DB, dup)),
      duplicated_from: { id: src.id, public_id: src.public_id, name: src.quote_name },
      copied: counts,
      not_copied: ["site_activations", "analytics", "ab_tests", "ab_variants"],
    },
    201,
  );
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
  // Rework M5 / §11D: the current is_default template SEEDS this new funnel
  // (create-time). null when no default set / pre-M5 schema ⇒ frame_template_id
  // stays null (the pre-rework behavior). The variant stays NULL (inherits the
  // funnel's template per M5 effectiveFrame: variant.ftid ?? funnel.ftid).
  const defaultTemplateId = await resolveDefaultFrameTemplateId(c.env.DB, quote.public_id);
  // Rework M4 (§4.3-1): funnels are unlimited; a new funnel appends to the board
  // (display_order = MAX+1). Rework M1: seed its single active variant (label 'A').
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO leadgen_funnels (public_id, quote_id, funnel_name, status, display_order, frame_template_id)
       VALUES (?, ?, ?, 'active', (SELECT COALESCE(MAX(display_order), 0) + 1 FROM leadgen_funnels WHERE quote_id = ?), ?)`,
    ).bind(funnelPublicId, quote.id, funnelName, quote.id, defaultTemplateId),
    c.env.DB.prepare(
      `INSERT INTO leadgen_funnel_variants
         (public_id, funnel_id, variant_label, traffic_allocation_bp, funnel_design_id, status)
       VALUES (?, (SELECT id FROM leadgen_funnels WHERE public_id = ?), 'A', 10000, 'default', 'active')`,
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

// Appendix A-5 (verbatim, asserted in CI): funnel-delete guard messages.
const A5_DELETE_DEFAULT_FUNNEL = (funnel: string): string =>
  `Can't delete '${funnel}': it is the default funnel.`;
const A5_DELETE_RULE_TARGET = (funnel: string, rule: string): string =>
  `Can't delete '${funnel}': it is the target of rule '${rule}'.`;

// DELETE /funnels/:id — §4.3-14 delete guards + a real cascade. A funnel cannot
// be deleted while it is the quote's default OR the target of any ENABLED
// (status='active') quote routing rule; the 409 names EVERY blocker with the
// Appendix A-5 strings verbatim. When allowed, the funnel + its variants/pages/
// slots/sections/rules/tests are deleted EXPLICITLY (D1 runs FK OFF, so the
// declared ON DELETE CASCADE does not fire in production — sections-handlers
// documents this; explicit deletes are the deterministic path). Any DISABLED
// routing rule still pointing at the funnel has its target_funnel_id nulled so
// no dangling reference remains.
export async function deleteFunnelHandler(c: AdminContext): Promise<Response> {
  const funnel = await resolveFunnelRow(c.env.DB, c.req.param("id") ?? "");
  if (funnel === null) return c.json({ error: "Not Found" }, 404);
  const quote = await c.env.DB.prepare("SELECT * FROM leadgen_quotes WHERE id = ? LIMIT 1")
    .bind(funnel.quote_id)
    .first<LeadgenQuoteRow>();

  const blockers: string[] = [];
  if (quote?.default_funnel_id === funnel.id) {
    blockers.push(A5_DELETE_DEFAULT_FUNNEL(funnel.funnel_name));
  }
  const targeting = await c.env.DB.prepare(
    "SELECT rule_name FROM leadgen_quote_routing_rules WHERE target_funnel_id = ? AND status = 'active' ORDER BY priority ASC, id ASC",
  )
    .bind(funnel.id)
    .all<{ rule_name: string }>();
  for (const r of targeting.results ?? []) {
    blockers.push(A5_DELETE_RULE_TARGET(funnel.funnel_name, r.rule_name));
  }
  if (blockers.length > 0) {
    return c.json({ error: "funnel_delete_blocked", funnel: funnel.public_id, blockers }, 409);
  }

  // Allowed → explicit cascade (children first; each DELETE's subquery must
  // still resolve, so page_slots/variant_sections precede pages/variants).
  const vsub = "(SELECT id FROM leadgen_funnel_variants WHERE funnel_id = ?)";
  const psub = `(SELECT id FROM leadgen_funnel_pages WHERE variant_id IN ${vsub})`;
  await c.env.DB.batch([
    c.env.DB.prepare(`DELETE FROM leadgen_funnel_page_slots WHERE page_id IN ${psub}`).bind(funnel.id),
    c.env.DB.prepare(`DELETE FROM leadgen_funnel_variant_sections WHERE variant_id IN ${vsub}`).bind(funnel.id),
    c.env.DB.prepare(`DELETE FROM leadgen_funnel_pages WHERE variant_id IN ${vsub}`).bind(funnel.id),
    c.env.DB.prepare(`DELETE FROM leadgen_funnel_rules WHERE variant_id IN ${vsub}`).bind(funnel.id),
    c.env.DB.prepare("DELETE FROM leadgen_funnel_variants WHERE funnel_id = ?").bind(funnel.id),
    c.env.DB.prepare("DELETE FROM leadgen_funnel_ab_tests WHERE funnel_id = ?").bind(funnel.id),
    // Disabled rules that still target this funnel: null the ref (enabled ones
    // were blocked above, so only disabled remain).
    c.env.DB.prepare("UPDATE leadgen_quote_routing_rules SET target_funnel_id = NULL WHERE target_funnel_id = ?").bind(funnel.id),
    c.env.DB.prepare("DELETE FROM leadgen_funnels WHERE id = ?").bind(funnel.id),
  ]);
  return c.json({ ok: true, id: funnel.id, public_id: funnel.public_id, deleted: true });
}

// POST /funnels/:id/duplicate — clone a funnel WITHIN its quote (§8.2 kebab).
// New funnel (name "(copy)", display_order appended) + its active variant(s)'
// pages/rules (the SAME clone shape duplicateQuote uses). Quote routing rules
// are NOT copied (they target the SOURCE funnel; a fresh clone is untargeted).
export async function duplicateFunnelHandler(c: AdminContext): Promise<Response> {
  const src = await resolveFunnelRow(c.env.DB, c.req.param("id") ?? "");
  if (src === null) return c.json({ error: "Not Found" }, 404);
  const body = (await readJsonBody(c)) ?? {};
  const name = trimmedString(body["funnel_name"]) ?? `${src.funnel_name} (copy)`;

  const newFunnelPublicId = mintPublicId("funnel");
  const statements: D1PreparedStatement[] = [
    c.env.DB.prepare(
      `INSERT INTO leadgen_funnels (public_id, quote_id, funnel_name, status, frame_config_json, theme_json, display_order, frame_template_id)
       VALUES (?, ?, ?, 'active', ?, ?, (SELECT COALESCE(MAX(display_order), 0) + 1 FROM leadgen_funnels WHERE quote_id = ?), ?)`,
    ).bind(newFunnelPublicId, src.quote_id, name, src.frame_config_json, src.theme_json, src.quote_id, src.frame_template_id),
  ];
  const variants = await readActiveFunnelVariants(c.env.DB, src.id);
  for (const variant of variants) {
    const newVariantPublicId = mintPublicId("funnel_variant");
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO leadgen_funnel_variants
           (public_id, funnel_id, ab_test_id, variant_label, traffic_allocation_bp, funnel_design_id,
            auction_id, lander_enabled, lander_headline, lander_subheadline, lander_body_json,
            lander_hero_media_id, lander_hero_media_url, lander_cta_json, content_version, status,
            frame_overrides_json, frame_template_id)
         VALUES (?, (SELECT id FROM leadgen_funnels WHERE public_id = ?), NULL, ?, 10000, ?, ?, ?, ?, ?, ?,
                 ?, ?, ?, 1, 'active', ?, ?)`,
      ).bind(
        newVariantPublicId, newFunnelPublicId, variant.variant_label,
        variant.funnel_design_id, variant.auction_id, variant.lander_enabled,
        variant.lander_headline, variant.lander_subheadline, variant.lander_body_json,
        variant.lander_hero_media_id, variant.lander_hero_media_url, variant.lander_cta_json,
        variant.frame_overrides_json, variant.frame_template_id,
      ),
    );
    const pages = await loadVariantPages(c.env.DB, variant.id);
    pushPageCloneStatements(c.env.DB, statements, newVariantPublicId, pages);
    const rules = await readVariantRules(c.env.DB, variant.id);
    for (const r of rules) {
      statements.push(
        insertRuleStatement(c.env.DB, "(SELECT id FROM leadgen_funnel_variants WHERE public_id = ?)", newVariantPublicId, {
          publicId: mintPublicId("funnel_rule"),
          ruleType: r.rule_type,
          conditionsJson: r.conditions_json,
          conditionsHash: r.conditions_hash,
          targetOfferId: r.target_offer_id,
          targetSectionId: r.target_section_id,
          redirectUrl: r.redirect_url,
          redirectAllowlisted: r.redirect_url_allowlisted,
          priority: r.priority,
          enabled: r.enabled,
          targetFunnelVariantId: null,
          valueMultiplier: r.value_multiplier,
          checkpointPage: r.checkpoint_page,
          matchMode: r.match_mode,
          ruleName: r.rule_name,
          status: r.status,
          redirectPct: r.redirect_pct,
        }),
      );
    }
  }
  await c.env.DB.batch(statements);
  const funnel = await c.env.DB.prepare("SELECT * FROM leadgen_funnels WHERE public_id = ? LIMIT 1")
    .bind(newFunnelPublicId)
    .first<LeadgenFunnelRow>();
  if (!funnel) return c.json({ error: "Duplicate failed" }, 500);
  const newVariants = await readFunnelVariants(c.env.DB, funnel.id);
  return c.json({ ...funnelRowToApi(funnel), variants: newVariants.map(variantRowToApi), duplicated_from: src.public_id }, 201);
}

// PUT /quotes/:id/funnel-order — reorder the board (§8.2, M4 display_order). The
// body's `order` is a permutation of the quote's funnel ids (int or public);
// display_order is reassigned 1..n in that order in ONE atomic batch.
export async function reorderQuoteFunnelsHandler(c: AdminContext): Promise<Response> {
  const quote = await resolveQuoteRow(c.env.DB, c.req.param("id") ?? "");
  if (quote === null) return c.json({ error: "Not Found" }, 404);
  const body = (await readJsonBody(c)) ?? {};
  const rawOrder = body["order"] ?? body["funnel_ids"];
  if (!Array.isArray(rawOrder)) {
    return c.json({ error: "Validation failed", fields: { order: "order must be an array of funnel ids" } }, 400);
  }
  const funnels = await readQuoteFunnels(c.env.DB, quote.id);
  const byId = new Map<number, LeadgenFunnelRow>();
  const byPublic = new Map<string, LeadgenFunnelRow>();
  for (const f of funnels) {
    byId.set(f.id, f);
    byPublic.set(f.public_id, f);
  }
  const orderedIds: number[] = [];
  const seen = new Set<number>();
  for (const raw of rawOrder) {
    let f: LeadgenFunnelRow | undefined;
    if (typeof raw === "number" && Number.isInteger(raw)) f = byId.get(raw);
    else if (typeof raw === "string") f = /^\d+$/.test(raw.trim()) ? byId.get(parseInt(raw.trim(), 10)) : byPublic.get(raw.trim());
    if (f === undefined) return c.json({ error: "Validation failed", fields: { order: `funnel '${String(raw)}' is not in this quote` } }, 400);
    if (seen.has(f.id)) return c.json({ error: "Validation failed", fields: { order: "order must not repeat a funnel" } }, 400);
    seen.add(f.id);
    orderedIds.push(f.id);
  }
  if (orderedIds.length !== funnels.length) {
    return c.json({ error: "Validation failed", fields: { order: "order must list every funnel of the quote exactly once" } }, 400);
  }
  await c.env.DB.batch(
    orderedIds.map((id, idx) =>
      c.env.DB.prepare("UPDATE leadgen_funnels SET display_order = ?, updated_at = unixepoch() WHERE id = ?").bind(idx + 1, id),
    ),
  );
  const reordered = await readQuoteFunnels(c.env.DB, quote.id);
  return c.json({ items: reordered.map(funnelRowToApi) });
}

// PUT /quotes/:id/default-funnel — set/unset the quote's default funnel (M4,
// §4.3-7). Body {funnel_id} (int/public) sets it (must be an ACTIVE funnel of
// this quote); {funnel_id:null} or absent unsets it. The activation preflight
// (§4.3-15) is the hard gate; this endpoint keeps the pointer coherent.
export async function setQuoteDefaultFunnelHandler(c: AdminContext): Promise<Response> {
  const quote = await resolveQuoteRow(c.env.DB, c.req.param("id") ?? "");
  if (quote === null) return c.json({ error: "Not Found" }, 404);
  const body = (await readJsonBody(c)) ?? {};
  const raw = body["funnel_id"] ?? body["default_funnel_id"] ?? null;
  let defaultFunnelId: number | null = null;
  if (raw !== null && raw !== undefined && raw !== "") {
    const funnel = await resolveFunnelRow(c.env.DB, String(raw));
    if (funnel === null || funnel.quote_id !== quote.id) {
      return c.json({ error: "Validation failed", fields: { funnel_id: "funnel does not belong to this quote" } }, 400);
    }
    if (funnel.status !== "active") {
      return c.json({ error: "Validation failed", fields: { funnel_id: "the default funnel must be active" } }, 400);
    }
    defaultFunnelId = funnel.id;
  }
  await c.env.DB.prepare("UPDATE leadgen_quotes SET default_funnel_id = ?, updated_at = unixepoch() WHERE id = ?")
    .bind(defaultFunnelId, quote.id)
    .run();
  const updated = await c.env.DB.prepare("SELECT * FROM leadgen_quotes WHERE id = ? LIMIT 1")
    .bind(quote.id)
    .first<LeadgenQuoteRow>();
  if (!updated) return c.json({ error: "Update failed" }, 500);
  return c.json(await quoteDetailJson(c.env.DB, updated));
}

// ---------------------------------------------------------------------------
// Rework §4.3-13 — section uniqueness (Appendix A-4, verbatim)
// ---------------------------------------------------------------------------

// A-4 (verbatim, CI-asserted): a section id may appear at most once within
// {shared page ∪ any single funnel's plan}.
//
// N19 (P8-6): ONE sentence used to describe that whole union — "'X' is already
// in this funnel" — so a section sitting on the quote-owned SHARED page was
// reported as already being IN a funnel the operator had just left EMPTY. The
// rule is sanctioned; the sentence named the wrong surface, sending the
// operator to hunt a chip that is not in that column. Two sentences now, one
// per side of the union. The shared one reuses the board's OWN words for that
// surface, quoted from quotes-tabs/funnel.ts (grep them, not line numbers —
// that file moves): the column title `title="Shared first page">Shared first
// page`, the same string as the drop pick-list entry `label: 'Shared first
// page'`, plus that column's own explanation of why the page counts against
// every funnel, `Every visitor sees this first — entry rules only pre-select
// the funnel.` So the message and the thing it points at read the same.
//
// Q1 (P8-6 FIX-FIRST): N19 picked its sentence from "is the id in the SHARED
// list?", and on a shared-page save the shared list is the one being SUBMITTED
// — so a section that actually sits in a funnel came back as "already on the
// Shared first page", the same wrongness pointing the other way (driven:
// PUT /quotes/:id/shared-page {slots:[shared, X]} with X in Funnel A). The
// deciding question is not which list an id is in but WHICH SURFACE ALREADY
// HOLDS IT: on a save that is always the surface the operator is NOT editing;
// at the activation preflight neither surface is being edited, both copies are
// already saved, and the honest answer is BOTH. And "this funnel" only has an
// antecedent when the operator is standing in that funnel (the variant PUT) —
// from the Shared column or a quote-level publish report it names nothing, so
// those paths name the funnel by the board's own column title (funnel.ts
// `data-funnel-name ... title="${escapeHtml(funnel.funnel_name)}"`), the same
// funnel_name the sibling publish blocker already says out loud ("Funnel 'X'
// needs at least one page with a section.").
const A4_SECTION_DUP_SHARED = (section: string): string =>
  `'${section}' is already on the Shared first page — every visitor sees that page first, so a section can appear once per funnel.`;
const A4_SECTION_DUP_FUNNEL = (section: string, funnelPhrase: string): string =>
  `'${section}' is already in ${funnelPhrase} — a section can appear once per funnel.`;
const A4_SECTION_DUP_BOTH = (section: string, funnelPhrase: string): string =>
  `'${section}' is on the Shared first page and in ${funnelPhrase} — a section can appear once per funnel.`;

// Where the union being checked sits, so a message can name the real surface.
interface A4Scope {
  // The surface whose plan the operator is SAVING — the one side of a
  // cross-surface collision that is only PROSPECTIVE, so the message must
  // attribute the existing copy to the OTHER side. `null` = neither (the
  // activation preflight re-checks two already-saved surfaces).
  readonly saving: "shared" | "funnel" | null;
  // The funnel whose plan `variantIds` is, named as the board's column titles
  // it; `null` when the operator is standing in that funnel (variant PUT) or
  // when no funnel is in scope at all (`variantIds` empty) — then "this funnel".
  readonly funnelName: string | null;
}
const a4FunnelPhrase = (scope: A4Scope): string =>
  scope.funnelName === null ? "this funnel" : `the funnel '${scope.funnelName}'`;

// M5 remediation (P8-5 FIX-FIRST round 2, H2b): the 3 nameOf() fallbacks below
// (sharedPageUniquenessErrors, variantSaveUniquenessErrors, and the activation
// preflight's own copy of this same check) used to paper over a name-lookup
// miss with the raw numeric DB row id, substituted straight into the A-4
// message's quotes as if it were a name ("'section 42' is already in this
// funnel..."). That is WORSE than a ULID: a bare number in that slot
// reads as a quantity, not an id. The case is an orphaned reference (the row
// this id once named no longer resolves — e.g. deleted between read and
// check) — say that, not the number.
const ORPHANED_SECTION_LABEL = "a section that no longer exists";

// Pure core: given the shared page's section ids and ONE funnel-variant's
// section ids, return one A-4 message per section id that appears more than
// once in their UNION (an internal repeat, or a section shared+funnel both).
// Q1: the message names the surface that ALREADY holds the section —
//   * a repeat inside ONE list  → that list's own surface;
//   * a cross-surface collision → the surface `scope.saving` is NOT (both
//     surfaces, when nothing is being saved and both copies are real).
function sectionUniquenessMessages(
  sharedIds: readonly number[],
  variantIds: readonly number[],
  nameOf: (id: number) => string,
  scope: A4Scope,
): string[] {
  const tally = (ids: readonly number[]): Map<number, number> => {
    const m = new Map<number, number>();
    for (const id of ids) m.set(id, (m.get(id) ?? 0) + 1);
    return m;
  };
  const sharedCounts = tally(sharedIds);
  const variantCounts = tally(variantIds);
  const out: string[] = [];
  const done = new Set<number>();
  for (const id of [...sharedIds, ...variantIds]) {
    if (done.has(id)) continue;
    done.add(id);
    const inShared = sharedCounts.get(id) ?? 0;
    const inVariant = variantCounts.get(id) ?? 0;
    if (inShared + inVariant <= 1) continue;
    const name = nameOf(id);
    if (inShared > 0 && inVariant > 0) {
      // Cross-surface: the copy that is NOT the one being saved is the one the
      // operator has to go find.
      if (scope.saving === "shared") out.push(A4_SECTION_DUP_FUNNEL(name, a4FunnelPhrase(scope)));
      else if (scope.saving === "funnel") out.push(A4_SECTION_DUP_SHARED(name));
      else out.push(A4_SECTION_DUP_BOTH(name, a4FunnelPhrase(scope)));
    } else if (inShared > 0) {
      out.push(A4_SECTION_DUP_SHARED(name));
    } else {
      out.push(A4_SECTION_DUP_FUNNEL(name, a4FunnelPhrase(scope)));
    }
  }
  return out;
}

// N19 (P8-6) — the field key. The three A-4 save-time call sites keyed their
// errors `sections.${seen.size}`: the running count of DISTINCT messages, a
// 1-based dedupe counter wearing the costume of `sections.<arrayIndex>`, which
// is what resolveSectionOrder (this file, the `sections.${i}` block) means by
// that key — the 0-based index of the offending entry in the operator's array.
// One namespace, two meanings: the first uniqueness error on a plan whose only
// entry is index 0 came back as `sections.1`. It can also never BE an index on
// the `pages`/`slots` save path, where the prospective ids are a flatMap over
// slots and the payload has no `sections` array at all. The two shapes never
// legitimately co-occur (both shared-page handlers return on
// resolveSectionOrder's errors before uniqueness runs; the variant PUT runs
// uniqueness only while the error map is still empty), so the fix is to stop
// minting a fake index rather than to invent an index for a path that has
// none: `sections.uniqueness.<n>` is a plain 1-based ordinal over the distinct
// A-4 messages and cannot be read as an array position. Nothing binds a row by
// this key — every board caller renders the first VALUE (funnel.ts
// firstFieldError) and the other save paths stringify the whole map. One mint
// for all three sites so they cannot drift apart again.
function addUniquenessError(errors: FieldErrors, seen: Set<string>, message: string): void {
  if (seen.has(message)) return;
  seen.add(message);
  errors[`sections.uniqueness.${seen.size}`] = message;
}

// section_id → section_name for the involved ids (batched, ≤80 per IN chunk per
// the D1 100-binding rule; these lists are tiny in practice).
async function sectionNameMap(db: D1Database, ids: readonly number[]): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  const unique = Array.from(new Set(ids));
  for (let i = 0; i < unique.length; i += 80) {
    const chunk = unique.slice(i, i + 80);
    if (chunk.length === 0) continue;
    const placeholders = chunk.map(() => "?").join(",");
    const rows = await db
      .prepare(`SELECT id, section_name FROM leadgen_sections WHERE id IN (${placeholders})`)
      .bind(...chunk)
      .all<{ id: number; section_name: string }>();
    for (const r of rows.results ?? []) map.set(r.id, r.section_name);
  }
  return map;
}

// The quote-owned shared page's section ids, in position order.
async function sharedPageSectionIds(db: D1Database, quoteId: number): Promise<number[]> {
  const rows = await db
    .prepare("SELECT section_id FROM leadgen_funnel_variant_sections WHERE quote_id = ? ORDER BY position ASC, id ASC")
    .bind(quoteId)
    .all<{ section_id: number }>();
  return (rows.results ?? []).map((r) => r.section_id);
}

// A variant's section ids, in position order.
async function variantSectionIds(db: D1Database, variantId: number): Promise<number[]> {
  const rows = await db
    .prepare("SELECT section_id FROM leadgen_funnel_variant_sections WHERE variant_id = ? ORDER BY position ASC, id ASC")
    .bind(variantId)
    .all<{ section_id: number }>();
  return (rows.results ?? []).map((r) => r.section_id);
}

// ---------------------------------------------------------------------------
// Rework §4.3-1 — the quote's ONE shared first page (M2 owner axis)
// ---------------------------------------------------------------------------

interface SharedPageRow {
  id: number;
  public_id: string;
  position: number;
  name: string | null;
}

async function readSharedPageRow(db: D1Database, quoteId: number): Promise<SharedPageRow | null> {
  return (
    (await db
      .prepare("SELECT id, public_id, position, name FROM leadgen_funnel_pages WHERE quote_id = ? ORDER BY position ASC, id ASC LIMIT 1")
      .bind(quoteId)
      .first<SharedPageRow>()) ?? null
  );
}

// The shared page's sections, in order (same projection shape readVariantSections
// yields, keyed by the quote owner axis instead of variant_id).
async function readSharedPageSections(db: D1Database, quoteId: number): Promise<OrderedVariantSection[]> {
  const result = await db
    .prepare(
      `SELECT fvs.position AS position, s.id AS section_id, s.public_id AS section_public_id,
              s.section_name AS section_name, s.activity AS activity, s.vertical AS vertical, s.status AS status,
              (SELECT COUNT(*) FROM leadgen_section_available_offers sao WHERE sao.section_id = s.id) AS mapped_offer_count,
              (SELECT COUNT(*) FROM leadgen_section_available_offers sao WHERE sao.section_id = s.id AND sao.mapping_state = 'invalid') AS invalid_offer_count,
              (SELECT COUNT(*) FROM leadgen_section_available_offers sao WHERE sao.section_id = s.id AND sao.mapping_state IN ('incomplete','selected')) AS incomplete_offer_count,
              (SELECT COUNT(*) FROM leadgen_section_answer_maps sam WHERE sam.section_id = s.id AND sam.mapping_status != 'complete') AS error_edge_count
       FROM leadgen_funnel_variant_sections fvs
       JOIN leadgen_sections s ON s.id = fvs.section_id
       WHERE fvs.quote_id = ? ORDER BY fvs.position ASC`,
    )
    .bind(quoteId)
    .all<VariantSectionRow>();
  return (result.results ?? []).map((row) => {
    const { mapped_offer_count, invalid_offer_count, incomplete_offer_count, error_edge_count, ...rest } = row;
    void mapped_offer_count;
    void invalid_offer_count;
    void incomplete_offer_count;
    void error_edge_count;
    return { ...rest, mapping_status: variantSectionMappingStatus(row) };
  });
}

async function sharedPageJson(db: D1Database, quote: LeadgenQuoteRow): Promise<Record<string, unknown> | null> {
  const page = await readSharedPageRow(db, quote.id);
  if (page === null) return null;
  const sections = await readSharedPageSections(db, quote.id);
  // Rework §8.2 (S5.3): the shared page's SLOTS in the SAME BoardPageSlot shape
  // the funnel columns use (pageToApi), resolved through the SAME loader the
  // runtime serves (loadSharedPages) so kind / A-B allocations / slot rules match
  // exactly what the visitor gets — this powers the board's shared-chip menu
  // editors ("A/B this slot" / "Slot rule"). The flat `sections` list stays for
  // pre-slot consumers (rules-rail field derivation, uniqueness probes).
  const resolvedShared = await loadSharedPages(db, quote.id);
  const slots = resolvedShared.length > 0 ? (pageToApi(resolvedShared[0]!).slots as Record<string, unknown>[]) : [];
  // Attach each candidate's Offer-mapping dot + strip the internal
  // section_num_id carrier (the SAME batch quoteStructureHandler runs for funnel
  // pages), so the shared chips carry a real mapping status on first paint.
  const wrap = [{ slots }];
  attachMappingStatusToPages(wrap, await sectionMappingStatusMap(db, collectCandidateSectionIds(wrap)));
  return { page_id: page.public_id, position: page.position, name: page.name, sections, slots };
}

// GET /quotes/:id/shared-page — the quote's shared first page (or null).
export async function getSharedPageHandler(c: AdminContext): Promise<Response> {
  const quote = await resolveQuoteRow(c.env.DB, c.req.param("id") ?? "");
  if (quote === null) return c.json({ error: "Not Found" }, 404);
  return c.json({ shared_page: await sharedPageJson(c.env.DB, quote) });
}

// POST /quotes/:id/shared-page — create the ONE quote-owned shared page (§4.3-1:
// at most one per quote; the schema permits more, the API refuses a second).
// Optional `sections` seeds the page's section list (validated + uniqueness).
export async function createSharedPageHandler(c: AdminContext): Promise<Response> {
  const quote = await resolveQuoteRow(c.env.DB, c.req.param("id") ?? "");
  if (quote === null) return c.json({ error: "Not Found" }, 404);
  if ((await readSharedPageRow(c.env.DB, quote.id)) !== null) {
    return c.json({ error: "This quote already has a shared first page — a quote has exactly one." }, 409);
  }
  const body = (await readJsonBody(c)) ?? {};
  const name = trimmedString(body["name"]);

  let sectionItems: SectionOrderItem[] = [];
  if (body["sections"] !== undefined) {
    const resolved = await resolveSectionOrder(c.env.DB, quote, body["sections"]);
    if (Object.keys(resolved.errors).length > 0) return c.json({ error: "Validation failed", fields: resolved.errors }, 400);
    sectionItems = resolved.items;
  }

  const pagePublicId = mintPublicId("funnel_page");
  const statements: D1PreparedStatement[] = [
    c.env.DB.prepare(
      "INSERT INTO leadgen_funnel_pages (public_id, quote_id, position, name) VALUES (?, ?, 0, ?)",
    ).bind(pagePublicId, quote.id, name),
  ];
  for (const s of sectionItems) {
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO leadgen_funnel_variant_sections (quote_id, section_id, position, page_id)
         VALUES (?, ?, ?, (SELECT id FROM leadgen_funnel_pages WHERE public_id = ?))`,
      ).bind(quote.id, s.section_id, s.position, pagePublicId),
    );
  }
  await c.env.DB.batch(statements);
  return c.json({ shared_page: await sharedPageJson(c.env.DB, quote) }, 201);
}

// PUT /quotes/:id/shared-page — rename + replace-set the shared page's section
// order (add/remove/reorder in one atomic operation). Creates the page if it
// does not exist yet (idempotent authoring).
export async function updateSharedPageHandler(c: AdminContext): Promise<Response> {
  const quote = await resolveQuoteRow(c.env.DB, c.req.param("id") ?? "");
  if (quote === null) return c.json({ error: "Not Found" }, 404);
  const body = await readJsonBody(c);
  if (body === null) return c.json({ error: "Invalid JSON body" }, 400);

  const sectionsProvided = body["sections"] !== undefined;
  const slotsProvided = body["slots"] !== undefined;
  // §8.2 (S5.3): `slots` (full fixed/ab/ruled descriptors — the board's shared-
  // chip menu editors) and the legacy flat `sections` replace-set both rewrite
  // the SAME shared-page rows; accepting both in one call would let the atomic
  // batch order silently pick a winner (the SAME guard putVariantHandler applies
  // to its pages-vs-sections pair).
  if (sectionsProvided && slotsProvided) {
    return c.json({ error: "Validation failed", fields: { slots: "slots and sections cannot both be provided in the same save" } }, 400);
  }
  const name = body["name"] !== undefined ? trimmedString(body["name"]) : undefined;
  const existing = await readSharedPageRow(c.env.DB, quote.id);
  const pagePublicId = existing?.public_id ?? mintPublicId("funnel_page");

  // Validate the prospective plan (either shape) fully BEFORE any statement.
  let sectionItems: SectionOrderItem[] = [];
  let preparedSharedSlots: PreparedSlot[] = [];
  if (sectionsProvided) {
    const resolved = await resolveSectionOrder(c.env.DB, quote, body["sections"]);
    if (Object.keys(resolved.errors).length > 0) return c.json({ error: "Validation failed", fields: resolved.errors }, 400);
    sectionItems = resolved.items;
  } else if (slotsProvided) {
    // Reuse the variant page/slot validator over the ONE shared page (§4.3-1):
    // fixed/ruled/ab shape checks, ruled default-required + entry-known field
    // scope, A/B Sigma==10000, AND slot_revision carry-forward (an unchanged
    // slot keeps its revision; an edited one bumps — the A/B re-bucket note
    // machinery, :2880-2889). oldPages = the shared page's CURRENT resolved slots.
    const oldShared = await loadSharedPages(c.env.DB, quote.id);
    const prep = await preparePages(c.env.DB, quote, [{ name: name ?? existing?.name ?? null, slots: body["slots"] }], oldShared);
    if (Object.keys(prep.errors).length > 0) return c.json({ error: "Validation failed", fields: prep.errors }, 400);
    preparedSharedSlots = prep.pages[0]?.slots ?? [];
  }

  const statements: D1PreparedStatement[] = [];
  if (existing === null) {
    statements.push(
      c.env.DB.prepare("INSERT INTO leadgen_funnel_pages (public_id, quote_id, position, name) VALUES (?, ?, 0, ?)").bind(
        pagePublicId,
        quote.id,
        name ?? null,
      ),
    );
  } else if (name !== undefined) {
    statements.push(c.env.DB.prepare("UPDATE leadgen_funnel_pages SET name = ? WHERE id = ?").bind(name, existing.id));
  }
  if (sectionsProvided) {
    // Flat replace-set: clear every quote-owned candidate AND any slot rows a
    // prior slotted save left, so the two representations never coexist.
    statements.push(c.env.DB.prepare("DELETE FROM leadgen_funnel_variant_sections WHERE quote_id = ?").bind(quote.id));
    statements.push(
      c.env.DB.prepare("DELETE FROM leadgen_funnel_page_slots WHERE page_id = (SELECT id FROM leadgen_funnel_pages WHERE public_id = ?)").bind(pagePublicId),
    );
    for (const s of sectionItems) {
      statements.push(
        c.env.DB.prepare(
          `INSERT INTO leadgen_funnel_variant_sections (quote_id, section_id, position, page_id)
           VALUES (?, ?, ?, (SELECT id FROM leadgen_funnel_pages WHERE public_id = ?))`,
        ).bind(quote.id, s.section_id, s.position, pagePublicId),
      );
    }
  } else if (slotsProvided) {
    // Slotted replace-set — the SAME atomic idiom putVariantHandler uses for a
    // variant's pages (pre-minted page public_id + slot-position subquery link),
    // keyed by quote_id instead of variant_id. Clears then reinserts slot rows +
    // slot_id-linked candidate rows; loadSharedPages resolves them via its real-
    // slot path (in-page A/B, slot rules) unchanged.
    statements.push(c.env.DB.prepare("DELETE FROM leadgen_funnel_variant_sections WHERE quote_id = ?").bind(quote.id));
    statements.push(
      c.env.DB.prepare("DELETE FROM leadgen_funnel_page_slots WHERE page_id = (SELECT id FROM leadgen_funnel_pages WHERE public_id = ?)").bind(pagePublicId),
    );
    let sectionRowPosition = 0;
    for (let si = 0; si < preparedSharedSlots.length; si++) {
      const slot = preparedSharedSlots[si]!;
      statements.push(
        c.env.DB.prepare(
          `INSERT INTO leadgen_funnel_page_slots (page_id, position, slot_revision, rules_json, ab_allocations_json)
           VALUES ((SELECT id FROM leadgen_funnel_pages WHERE public_id = ?), ?, ?, ?, ?)`,
        ).bind(pagePublicId, si, slot.slotRevision, slot.rulesJson, slot.abAllocationsJson),
      );
      for (const sectionId of slot.candidateSectionIds) {
        statements.push(
          c.env.DB.prepare(
            `INSERT INTO leadgen_funnel_variant_sections (quote_id, section_id, position, page_id, slot_id)
             VALUES (?, ?, ?,
               (SELECT id FROM leadgen_funnel_pages WHERE public_id = ?),
               (SELECT s.id FROM leadgen_funnel_page_slots s
                  JOIN leadgen_funnel_pages p ON p.id = s.page_id
                 WHERE p.public_id = ? AND s.position = ?))`,
          ).bind(quote.id, sectionId, sectionRowPosition++, pagePublicId, pagePublicId, si),
        );
      }
    }
  }
  // §3.1 cache coherence (S5.3): the shared page is part of EVERY active funnel-
  // variant's resolved plan, but the shell/config cache key carries the VARIANT's
  // content_version (serve.ts leadgenShellKey/leadgenConfigKey) — so a shared-page
  // plan change must bump the quote's active variants or visitors keep serving the
  // stale composition. Bump like the sibling mutating verbs (putVariantHandler).
  if (sectionsProvided || slotsProvided) {
    statements.push(
      c.env.DB.prepare(
        `UPDATE leadgen_funnel_variants SET content_version = content_version + 1
         WHERE status = 'active' AND funnel_id IN (SELECT id FROM leadgen_funnels WHERE quote_id = ?)`,
      ).bind(quote.id),
    );
  }
  if (statements.length > 0) await c.env.DB.batch(statements);
  return c.json({ shared_page: await sharedPageJson(c.env.DB, quote) });
}

// DELETE /quotes/:id/shared-page — remove the shared page + its sections.
export async function deleteSharedPageHandler(c: AdminContext): Promise<Response> {
  const quote = await resolveQuoteRow(c.env.DB, c.req.param("id") ?? "");
  if (quote === null) return c.json({ error: "Not Found" }, 404);
  const existing = await readSharedPageRow(c.env.DB, quote.id);
  if (existing === null) return c.json({ error: "Not Found" }, 404);
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM leadgen_funnel_variant_sections WHERE quote_id = ?").bind(quote.id),
    c.env.DB.prepare("DELETE FROM leadgen_funnel_pages WHERE quote_id = ?").bind(quote.id),
  ]);
  return c.json({ ok: true, quote_id: quote.public_id, deleted: true });
}

// §4.3-13 at a SHARED-PAGE save: the prospective shared ids must not collide
// with themselves, nor with any active funnel-variant's plan (that funnel).
async function sharedPageUniquenessErrors(
  db: D1Database,
  quote: LeadgenQuoteRow,
  prospectiveSharedIds: readonly number[],
): Promise<FieldErrors> {
  const errors: FieldErrors = {};
  const funnels = await readQuoteFunnels(db, quote.id);
  const involved = new Set<number>(prospectiveSharedIds);
  // Q1: carry each plan's OWNING FUNNEL, not just its ids — from the Shared
  // column the operator needs the funnel's name to find the other copy.
  const perVariant: Array<{ funnelName: string; ids: number[] }> = [];
  for (const f of funnels) {
    if (f.status !== "active") continue;
    for (const v of await readActiveFunnelVariants(db, f.id)) {
      const ids = await variantSectionIds(db, v.id);
      perVariant.push({ funnelName: f.funnel_name, ids });
      for (const id of ids) involved.add(id);
    }
  }
  const nameMap = await sectionNameMap(db, [...involved]);
  const nameOf = (id: number): string => nameMap.get(id) ?? ORPHANED_SECTION_LABEL;
  const seen = new Set<string>();
  // internal dup within the shared page itself (no funnel in scope)
  for (const m of sectionUniquenessMessages(prospectiveSharedIds, [], nameOf, { saving: "shared", funnelName: null })) {
    addUniquenessError(errors, seen, m);
  }
  // shared ∪ each funnel-variant plan
  for (const { funnelName, ids } of perVariant) {
    for (const m of sectionUniquenessMessages(prospectiveSharedIds, ids, nameOf, { saving: "shared", funnelName })) {
      addUniquenessError(errors, seen, m);
    }
  }
  return errors;
}

// §4.3-13 at a VARIANT save: the prospective variant plan must not repeat a
// section within itself, nor collide with the quote's shared page (that funnel).
async function variantSaveUniquenessErrors(
  db: D1Database,
  quote: LeadgenQuoteRow,
  prospectiveVariantIds: readonly number[],
): Promise<FieldErrors> {
  const errors: FieldErrors = {};
  try {
    // sharedPageSectionIds probes leadgen_funnel_variant_sections.quote_id (a
    // rework-only column). On a pre-rework schema it throws → there is no shared
    // page, so uniqueness against it is vacuous: skip (no violations).
    const sharedIds = await sharedPageSectionIds(db, quote.id);
    const involved = new Set<number>([...sharedIds, ...prospectiveVariantIds]);
    const nameMap = await sectionNameMap(db, [...involved]);
    const nameOf = (id: number): string => nameMap.get(id) ?? ORPHANED_SECTION_LABEL;
    const seen = new Set<string>();
    // Q1: the operator IS standing in this funnel (the variant PUT), so a
    // cross-surface collision points at the shared page and an internal repeat
    // says "this funnel" — the only path where that phrase has an antecedent.
    for (const m of sectionUniquenessMessages(sharedIds, prospectiveVariantIds, nameOf, { saving: "funnel", funnelName: null })) {
      addUniquenessError(errors, seen, m);
    }
  } catch {
    return {};
  }
  return errors;
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
  // Rework M1 (§4.3-10): forbid a SECOND active variant when there is no running
  // test (there is none — the guard above returned early otherwise). A funnel
  // with 0 active variants (all archived) may still get one.
  if (existing.some((v) => v.status === "active")) {
    return c.json({ error: SINGLE_ACTIVE_VARIANT_MESSAGE }, 409);
  }
  const label = trimmedString(body["variant_label"]) ?? String.fromCharCode(65 + existing.length); // A, B, C…
  const designId = trimmedString(body["funnel_design_id"]) ?? "default";
  const variantPublicId = mintPublicId("funnel_variant");
  await c.env.DB.prepare(
    `INSERT INTO leadgen_funnel_variants
       (public_id, funnel_id, variant_label, traffic_allocation_bp, funnel_design_id, status)
     VALUES (?, ?, ?, ?, ?, 'active')`,
  )
    .bind(variantPublicId, funnel.id, label, 10000, designId)
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
       WHERE f.quote_id = ? ORDER BY v.funnel_id ASC, v.variant_label ASC, v.id ASC`,
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
//
// Round-4 P3a (D-3 pages model) design note: this function is DELIBERATELY
// left untouched — "existing single-page-per-section funnels keep working
// untouched" means the flat `sections` PUT contract must stay byte-identical.
// The page-model "evolution" of section-order resolution lives in the NEW,
// PARALLEL `preparePages` (below, near putVariantHandler) — it reuses the
// SAME per-item membership checks (active/activity/vertical) this function
// performs, over the page/slot shape instead of a flat list. The two paths
// are mutually exclusive per save (putVariantHandler rejects a body
// carrying both `sections` and `pages`).
// M5 remediation (P8-5 FIX-FIRST, M-2): the section-vertical mismatch used to
// surface the raw public_id + bare stored key on an operator-facing error
// surface ("section lgs_01... vertical 'finance' is not one of the quote
// verticals") — a raw ULID with no action. Name the section by the label the
// operator gave it (section_name — the SAME field the §8.2 library cards and
// list view show), keep "Vertical"/"Verticals" because that is the exact word
// the section editor (renderActivityVerticalPickers) and the quote-settings
// form (`Verticals * (select one or more)`) already use, and name the action:
// pick a section in an allowed vertical, or widen the quote's Verticals.
// Both call sites below share this ONE function so the message can never
// drift between them (contract R5: reuse the register, invent no new copy).
//
// Q1 (P8-6 FIX-FIRST, MINOR): this read "is a ${section.vertical} section" —
// "is a auto section" for the commonest value in the fixtures. There is no
// article to compute: Activity and Vertical are OPERATOR-AUTHORED free text
// (ui-section-studio.ts's "+ New activity…" / "+ New vertical…" allow-create),
// so the value can begin with any letter and any sound ("an hour-1 lead", "a
// u-verse offer") — a leading-vowel rule would be wrong for a knowable share
// of real inputs and there is no closed registry to look the word up in. The
// fix is therefore to stop requiring an article: name the field the way the
// section editor's own pickers do (renderActivityVerticalPickers: "Activity",
// "Vertical"), which is also how the sibling in this register already reads
// ("'X' is archived — …", no article).
function describeVerticalMismatch(section: LeadgenSectionRow, allowedVerticals: Set<string>): string {
  const allowed = [...allowedVerticals].join(", ");
  return `'${section.section_name}' is in the ${section.vertical} Vertical, but this quote's Verticals only include ${allowed} — pick a section in one of those verticals, or add ${section.vertical} to the quote's Verticals.`;
}

// M5 remediation (P8-5 FIX-FIRST round 2, MAJOR-1): the sibling activity-
// mismatch check sits THREE LINES above each describeVerticalMismatch call
// site and runs FIRST, short-circuiting it — so for a section whose activity
// (not just vertical) doesn't match the quote, the operator was still getting
// the raw-ULID/bare-key message ("section lgs_01... activity 'x' does not
// match the quote activity 'y'") the vertical fix never reached. Same
// register as describeVerticalMismatch (contract R5: reuse, invent no new
// copy) — name the section by section_name, keep "Activity" because that is
// the exact word the sections list column ("Activity / Vertical"), the
// section editor (renderActivityVerticalPickers's "Activity" label), and the
// quote-settings/new-quote form ("Activity *") already use, and name the
// action: pick a section under the quote's Activity, or change the quote's
// Activity to match. Both call sites below share this ONE function so the
// message can never drift between them.
// (Q1 MINOR: "is a ${section.activity} section" carried the same broken article
// as describeVerticalMismatch above — see that note for why the article is
// removed rather than computed.)
function describeActivityMismatch(section: LeadgenSectionRow, quoteActivity: string): string {
  return `'${section.section_name}' is under the ${section.activity} Activity, but this quote's Activity is ${quoteActivity} — pick a section under ${quoteActivity}, or change the quote's Activity to ${section.activity}.`;
}

// M5 remediation (P8-5 FIX-FIRST round 2, H2b): the inactive-section check
// sits 4 lines above describeActivityMismatch/describeVerticalMismatch and
// shared their exact old defect — a raw public_id with no action. "active"/
// "archived" is already the operator's own word (ui.ts's statusBadge renders
// section.status verbatim as the Sections list's status pill), so only the
// id needs replacing (section_name) and an action needs naming: reactivate
// it — the EXACT verb ui-sections.ts's kebab-menu button and confirm dialog
// ("Reactivate this Section?") use — or pick a different active section.
function describeInactiveSection(section: LeadgenSectionRow): string {
  return `'${section.section_name}' is ${section.status} — only active sections can be ordered; reactivate it from the Sections list, or pick a different active section.`;
}

// M5 remediation (P8-5 FIX-FIRST round 2, H2b): "unknown section ${ref}"
// belongs to the same class (no action named) even though — unlike the
// public_id/numeric-id leaks above — echoing `ref` here is defensible: it is
// exactly what the caller submitted, and there is no section row left to
// name. Keep the echo, add the action.
function describeUnknownSectionRef(ref: string): string {
  return `no section matches '${ref}' — check the Sections list and pick an existing section.`;
}

// M5 remediation (P8-5 FIX-FIRST round 2, H2b): every "<label> ${id} does not
// exist" FK-existence check in this file (Offer/Auction/Template targets)
// shares the SAME shape as the section-order checks above — a raw internal
// database row id with no action. None of these ids are ever typed by the
// operator: Offer (ui-rules-builder.ts's "Redirect to offer" field / "Offer"
// segment label), Auction (quotes-tabs/funnel.ts's `for="lg-auction-id">
// Auction<`), and Template (quotes-tabs/templates.ts's Template pickers, the
// Templates tab) are all NAME dropdowns — the id is only the selected
// option's value attribute. Once the referenced row is gone there is no name
// left to show, so say that plainly and name the action (the list is stale —
// refresh and pick again) instead of echoing the number. (target_section_id
// is NOT part of this register — see the two sites below that keep its old
// text, with the dead-path evidence.)
function describeMissingReference(label: string): string {
  return `the selected ${label} no longer exists — refresh the page and pick another ${label}.`;
}

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
      errors[`sections.${i}`] = describeUnknownSectionRef(String(ref));
      continue;
    }
    if (section.status !== "active") {
      errors[`sections.${i}`] = describeInactiveSection(section);
      continue;
    }
    if (section.activity !== quote.activity) {
      errors[`sections.${i}`] = describeActivityMismatch(section, quote.activity);
      continue;
    }
    if (quoteVerticals.size > 0 && !quoteVerticals.has(section.vertical)) {
      errors[`sections.${i}`] = describeVerticalMismatch(section, quoteVerticals);
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
  ruleType: FunnelRuleTypeV2;
  conditionsJson: string;
  conditionsHash: string;
  targetOfferId: number | null;
  targetSectionId: number | null;
  redirectUrl: string | null;
  redirectAllowlisted: number;
  priority: number;
  enabled: number;
  // Round-4 P4b rule-model v2 additive fields — EVERY rule type persists the
  // full envelope (conductor ruling, consolidated fix round): rule_name/
  // status/match_mode/redirect_pct apply uniformly; target_funnel_variant_id/
  // value_multiplier/checkpoint_page stay meaningful only for route_funnel_
  // variant (null otherwise) and redirect_pct only for redirect_direct_offer
  // (null otherwise) — both simply unused/ignored by the runtime for other
  // types, never fabricated.
  ruleName: string | null;
  status: string;
  matchMode: string | null;
  targetFunnelVariantId: number | null;
  valueMultiplier: number | null;
  checkpointPage: number | null;
  redirectPct: number | null;
}

// D5 mini-round: the SINGLE-rule validation core, extracted out of the array
// loop below so the variant-scoped rule CRUD (list/create/update/delete,
// mirroring the quote-routing-rules conventions — buildRoutingRuleFields) and
// the variant-PUT replace-set share the EXACT SAME validation and can never
// diverge. Pure (no DB reads — this module's routing-target resolution moved
// to quote_routing_rules in M3, so nothing here needs `db`/`variantId`/
// `funnelId` any more). Mechanical extraction only: identical short-circuit-
// per-field behavior (the FIRST error wins, matching the original loop's
// `continue`-on-first-error semantics byte-for-byte), identical Stage-A
// validateFunnelRule call, identical conditions_hash computation. Returns
// UNPREFIXED field-error keys (rule_type/target_offer_id/target_section_id/
// status/match_mode/value_multiplier/redirect_pct, plus `rule` for the whole-
// rule Stage-A verdict or a non-object entry) — prepareRules (below) prefixes
// them `rules.${i}.…`/`rules.${i}` for its array context; the CRUD handlers
// (createVariantRuleHandler/updateVariantRuleHandler) use them as-is. Verified
// behaviorally neutral for the array/replace-set path by re-running every
// existing covering suite after this extraction (leadgen-quotes-api.test.ts
// etc. — see the mini-round report), not asserted by reasoning alone.
function prepareOneRule(
  entry: unknown,
  allowlist: string[],
): { rule: PreparedRule | null; errors: FieldErrors } {
  const errors: FieldErrors = {};
  if (!isRecord(entry)) {
    errors["rule"] = "each rule must be an object";
    return { rule: null, errors };
  }
  const ruleType = entry["rule_type"];
  if (typeof ruleType !== "string" || !(FUNNEL_RULE_TYPES as readonly string[]).includes(ruleType)) {
    errors["rule_type"] = `rule_type must be one of ${FUNNEL_RULE_TYPES.join("|")}`;
    return { rule: null, errors };
  }
  const targetOfferId = asIntOrNull(entry["target_offer_id"]);
  if (targetOfferId === INVALID) {
    errors["target_offer_id"] = "target_offer_id must be an integer id";
    return { rule: null, errors };
  }
  const targetSectionId = asIntOrNull(entry["target_section_id"]);
  if (targetSectionId === INVALID) {
    errors["target_section_id"] = "target_section_id must be an integer id";
    return { rule: null, errors };
  }
  const conditions = entry["conditions_json"] ?? entry["conditions"] ?? { groups: [] };
  const redirectUrl = trimmedString(entry["redirect_url"]);
  const redirectAllowlisted = asToggle(entry["redirect_url_allowlisted"]) ?? false;
  const priorityRaw = entry["priority"];
  const priority = typeof priorityRaw === "number" ? priorityRaw : 100;

  // --- v2 envelope (rule_name / status / match_mode) — every rule type ---
  const ruleName = trimmedString(entry["rule_name"]);
  const statusRaw = entry["status"];
  const statusProvided = statusRaw === "active" || statusRaw === "disabled";
  if (statusRaw !== undefined && statusRaw !== null && statusRaw !== "" && !statusProvided) {
    errors["status"] = "status must be one of active|disabled";
    return { rule: null, errors };
  }
  const enabledRaw = entry["enabled"];
  const enabledExplicit = enabledRaw !== undefined && enabledRaw !== null && enabledRaw !== "";
  let status: string;
  let enabled: boolean;
  if (statusProvided) {
    status = statusRaw as string;
    // Round-4 P4b fix round (P4a's cited save-side bug, resolver.ts/
    // auction/engine.ts commits eb1969c/32990e8): BOTH evaluation planes
    // now gate on `enabled = 1 AND status != 'disabled'` — two
    // independently-writable axes over the SAME "is this rule on" concept.
    // When the envelope carries status WITHOUT an explicit enabled, derive
    // enabled FROM status (never default enabled=true independent of what
    // status says — the prior bug: an operator's Disable click could
    // persist status='disabled' while enabled stayed true/default, an
    // incoherent stored row).
    enabled = enabledExplicit ? (asToggle(enabledRaw) ?? true) : status !== "disabled";
  } else {
    enabled = asToggle(enabledRaw) ?? true;
    status = enabled ? "active" : "disabled";
  }
  const matchModeRaw = entry["match_mode"];
  let matchMode: string | null;
  if (matchModeRaw === "any") {
    matchMode = "any";
  } else if (matchModeRaw === "all" || matchModeRaw === undefined || matchModeRaw === null || matchModeRaw === "") {
    matchMode = null; // migration convention: NULL == 'all' (the default)
  } else {
    errors["match_mode"] = "match_mode must be one of all|any";
    return { rule: null, errors };
  }
  const valueMultiplierRaw = entry["value_multiplier"];
  let valueMultiplier: number | null = null;
  if (valueMultiplierRaw !== undefined && valueMultiplierRaw !== null && valueMultiplierRaw !== "") {
    if (typeof valueMultiplierRaw !== "number" || !Number.isFinite(valueMultiplierRaw) || valueMultiplierRaw <= 0) {
      errors["value_multiplier"] = "value_multiplier must be a positive number";
      return { rule: null, errors };
    }
    valueMultiplier = valueMultiplierRaw;
  }
  // §15.5 redirect_pct (0044, REAL NULL) — funnel.ts's resolveRedirectPct/
  // shouldRedirectForSession treat `redirect_pct ?? 0` as authoritative:
  // NULL/absent -> never redirect; an explicit 0 ALSO never redirects (both
  // legitimate, not errors); 100 -> always; anything outside 0..100 or
  // non-numeric is rejected. Meaningful only for redirect_direct_offer, but
  // parsed uniformly (harmless/unused by the runtime for other types).
  const redirectPctRaw = entry["redirect_pct"];
  let redirectPct: number | null = null;
  if (redirectPctRaw !== undefined && redirectPctRaw !== null && redirectPctRaw !== "") {
    if (typeof redirectPctRaw !== "number" || !Number.isFinite(redirectPctRaw) || redirectPctRaw < 0 || redirectPctRaw > 100) {
      errors["redirect_pct"] = "redirect_pct must be a number between 0 and 100";
      return { rule: null, errors };
    }
    redirectPct = redirectPctRaw;
  }

  // Rework M3/D5: the four auction-domain rule types NEVER carry a routing
  // target or a checkpoint (routing lives in leadgen_quote_routing_rules now)
  // — target_funnel_variant_id / checkpoint_page stay NULL. Every accepted
  // type is validated by the shared Stage-A validator (no local branch).
  const targetFunnelVariantId: number | null = null;
  const checkpointPage: number | null = null;

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
    errors["rule"] = verdict.errors.map((e) => `${e.code}: ${e.message}`).join("; ");
    return { rule: null, errors };
  }

  const conditionsJson = JSON.stringify(conditions);
  return {
    rule: {
      publicId: mintPublicId("funnel_rule"),
      ruleType: ruleType as FunnelRuleTypeV2,
      conditionsJson,
      conditionsHash: sha256Hex(conditionsJson),
      targetOfferId,
      targetSectionId,
      redirectUrl,
      redirectAllowlisted: redirectAllowlisted ? 1 : 0,
      redirectPct,
      priority,
      enabled: enabled ? 1 : 0,
      ruleName,
      status,
      matchMode,
      targetFunnelVariantId,
      valueMultiplier,
      checkpointPage,
    },
    errors: {},
  };
}

// Validate + prepare the funnel-rule replace-set (§15.5 + Round-4 P4b rule-
// model v2). Every rule type runs through prepareOneRule (the shared Stage-A
// validateFunnelRule core, above); `funnelId`/`variantId`/`db` are retained for
// signature stability (the save path passes them) though unused — routing-
// target + checkpoint derivation moved out to the quote routing rules, so no
// per-rule page lookup happens here any more.
async function prepareRules(
  db: D1Database,
  variantId: number,
  funnelId: number,
  raw: unknown,
  allowlist: string[],
): Promise<{ rules: PreparedRule[]; errors: FieldErrors }> {
  void variantId;
  void funnelId;
  void db;
  const errors: FieldErrors = {};
  if (!Array.isArray(raw)) {
    errors["rules"] = "rules must be an array";
    return { rules: [], errors };
  }
  const rules: PreparedRule[] = [];

  for (let i = 0; i < raw.length; i++) {
    const { rule, errors: oneErrors } = prepareOneRule(raw[i], allowlist);
    if (Object.keys(oneErrors).length > 0) {
      for (const [key, message] of Object.entries(oneErrors)) {
        // "rule" (whole-entry/whole-rule errors) -> `rules.${i}`; every other
        // (field-specific) key -> `rules.${i}.${key}` — byte-identical to the
        // ORIGINAL loop's own prefixing before this extraction.
        errors[key === "rule" ? `rules.${i}` : `rules.${i}.${key}`] = message;
      }
      continue;
    }
    rules.push(rule!);
  }
  return { rules, errors };
}

// ---------------------------------------------------------------------------
// Round-4 P3a (D-3 pages model) — page/slot replace-set preparation
// ---------------------------------------------------------------------------

interface PreparedSlot {
  candidateSectionIds: number[];
  rulesJson: string | null;
  abAllocationsJson: string | null;
  slotRevision: number;
}

interface PreparedPage {
  name: string | null;
  slots: PreparedSlot[];
}

// Byte-lean content compare for the revision-diff below — re-serializes the
// OLD (parsed) shape the SAME way the new one is built, so an unchanged
// slot keeps its revision and an edited one bumps (§16.2 discipline).
function slotContentKey(rulesJson: string | null, abAllocationsJson: string | null): string {
  return `${rulesJson ?? ""}|${abAllocationsJson ?? ""}`;
}

// Validate + prepare the FULL pages/slots/candidates replace-set (§15.3
// membership rules apply identically to page-model sections — the SAME
// activity/vertical/active checks resolveSectionOrder already enforces,
// reused via resolveRowSection). `oldPages` (the variant's CURRENT resolved
// structure, loaded before the caller's atomic delete+reinsert) is used
// ONLY to carry forward a slot's revision when its rules/allocations are
// byte-unchanged at the same (page, slot) coordinate — any content change,
// added/removed slot, or reordering bumps it (a fresh, clean re-bucket).
async function preparePages(
  db: D1Database,
  quote: LeadgenQuoteRow,
  raw: unknown,
  oldPages: readonly ResolvedFunnelPage[],
): Promise<{ pages: PreparedPage[]; errors: FieldErrors }> {
  const errors: FieldErrors = {};
  if (!Array.isArray(raw) || raw.length === 0) {
    errors["pages"] = "pages must be a non-empty array";
    return { pages: [], errors };
  }
  const quoteVerticals = new Set(parseStringArray(quote.verticals_json));

  const resolveRef = async (ref: unknown, path: string): Promise<number | null> => {
    if (ref === undefined || ref === null || ref === "") {
      errors[path] = "section_id is required";
      return null;
    }
    const section = await resolveRowSection(db, String(ref));
    if (section === null) {
      errors[path] = describeUnknownSectionRef(String(ref));
      return null;
    }
    if (section.status !== "active") {
      errors[path] = describeInactiveSection(section);
      return null;
    }
    if (section.activity !== quote.activity) {
      errors[path] = describeActivityMismatch(section, quote.activity);
      return null;
    }
    if (quoteVerticals.size > 0 && !quoteVerticals.has(section.vertical)) {
      errors[path] = describeVerticalMismatch(section, quoteVerticals);
      return null;
    }
    return section.id;
  };

  const pages: PreparedPage[] = [];
  for (let pi = 0; pi < raw.length; pi++) {
    const pageRaw = raw[pi];
    const pagePath = `pages.${pi}`;
    if (!isRecord(pageRaw)) {
      errors[pagePath] = "each page must be an object";
      continue;
    }
    const name = trimmedString(pageRaw["name"]);
    const slotsRaw = pageRaw["slots"];
    if (!Array.isArray(slotsRaw)) {
      errors[`${pagePath}.slots`] = "slots must be an array";
      continue;
    }
    // Rework §4.3-15 (S5.3): an EMPTY page (slots: []) is a LEGAL authoring
    // state, not a save-time error. The board's "+ Add page" persists an empty
    // placeholder the operator fills next (its A-1 empty-state copy literally
    // says "...or click + Add page."), and the ">=1 page with >=1 section"
    // guarantee is an ACTIVATION-preflight check (computeReworkActivationProblems
    // — "Funnel '<name>' needs at least one page with a section."), NOT a
    // per-save rejection. The old `slotsRaw.length === 0 -> 400` 400'd every
    // "+ Add page" on a fresh funnel. An empty page persists as a page row with
    // zero slot rows; the resolver composes it as a no-op (sectionsFromPages
    // skips slotless pages — no empty step, progress denominator unchanged).
    if (slotsRaw.length === 0) {
      pages.push({ name, slots: [] });
      continue;
    }
    const slots: PreparedSlot[] = [];
    for (let si = 0; si < slotsRaw.length; si++) {
      const slotRaw = slotsRaw[si];
      const path = `${pagePath}.slots.${si}`;
      if (!isRecord(slotRaw)) {
        errors[path] = "each slot must be an object";
        continue;
      }
      const kind = slotRaw["kind"];
      if (kind === "fixed") {
        const sectionId = await resolveRef(slotRaw["section_id"], `${path}.section_id`);
        if (sectionId === null) continue;
        slots.push({ candidateSectionIds: [sectionId], rulesJson: null, abAllocationsJson: null, slotRevision: 0 });
      } else if (kind === "ruled") {
        const casesRaw = slotRaw["cases"];
        if (!Array.isArray(casesRaw) || casesRaw.length === 0) {
          errors[`${path}.cases`] = "a ruled slot requires at least one case";
          continue;
        }
        const candidateIds = new Set<number>();
        const cases: { conditions: { groups: unknown[] }; section_id: number }[] = [];
        let bad = false;
        for (let ci = 0; ci < casesRaw.length; ci++) {
          const caseRaw = casesRaw[ci];
          const casePath = `${path}.cases.${ci}`;
          if (!isRecord(caseRaw)) {
            errors[casePath] = "each case must be an object";
            bad = true;
            continue;
          }
          const conditions = caseRaw["conditions"];
          if (!isRecord(conditions) || !Array.isArray(conditions["groups"])) {
            errors[`${casePath}.conditions`] = "conditions must be an object { groups: [...] }";
            bad = true;
            continue;
          }
          // Entry-known-only field scope (roast MAJOR-4): an answer-field
          // condition is REJECTED with plain language, never a jargon code.
          const scopeError = validateSlotRuleFieldScope({
            groups: conditions["groups"] as { field: string; op: string }[],
          } as Parameters<typeof validateSlotRuleFieldScope>[0]);
          if (scopeError !== null) {
            errors[`${casePath}.conditions`] = scopeError;
            bad = true;
            continue;
          }
          const sectionId = await resolveRef(caseRaw["section_id"], `${casePath}.section_id`);
          if (sectionId === null) {
            bad = true;
            continue;
          }
          candidateIds.add(sectionId);
          cases.push({ conditions: conditions as { groups: unknown[] }, section_id: sectionId });
        }
        const defaultSectionId = await resolveRef(slotRaw["default_section_id"], `${path}.default_section_id`);
        if (defaultSectionId === null) bad = true;
        else candidateIds.add(defaultSectionId);
        if (bad) continue;
        slots.push({
          candidateSectionIds: [...candidateIds],
          rulesJson: JSON.stringify({ cases, default_section_id: defaultSectionId }),
          abAllocationsJson: null,
          slotRevision: 0,
        });
      } else if (kind === "ab") {
        const allocRaw = slotRaw["allocations"];
        if (!Array.isArray(allocRaw) || allocRaw.length === 0) {
          errors[`${path}.allocations`] = "an A/B slot requires at least one allocation";
          continue;
        }
        const allocations: { section_id: number; bp: number }[] = [];
        let sum = 0;
        let bad = false;
        for (let ai = 0; ai < allocRaw.length; ai++) {
          const a = allocRaw[ai];
          const allocPath = `${path}.allocations.${ai}`;
          if (!isRecord(a)) {
            errors[allocPath] = "each allocation must be an object";
            bad = true;
            continue;
          }
          const sectionId = await resolveRef(a["section_id"], `${allocPath}.section_id`);
          const bp = a["bp"];
          if (typeof bp !== "number" || !Number.isInteger(bp) || bp < 0 || bp > 10000) {
            errors[`${allocPath}.bp`] = "bp must be an integer 0..10000";
            bad = true;
          }
          if (sectionId === null) {
            bad = true;
            continue;
          }
          if (typeof bp === "number" && Number.isInteger(bp)) {
            allocations.push({ section_id: sectionId, bp });
            sum += bp;
          }
        }
        if (!bad && sum !== 10000) {
          errors[`${path}.allocations`] = `an A/B slot's allocations must sum to 10000 (100%), got ${sum}`;
          bad = true;
        }
        if (bad) continue;
        slots.push({
          candidateSectionIds: allocations.map((a) => a.section_id),
          rulesJson: null,
          abAllocationsJson: JSON.stringify(allocations),
          slotRevision: 0,
        });
      } else {
        errors[path] = "a slot's kind must be one of fixed|ruled|ab";
      }
    }
    pages.push({ name, slots });
  }

  // slot_revision diffing: position-matched against the PRE-SAVE structure.
  // Unchanged content at the same (page, slot) coordinate keeps its revision;
  // anything else (new content, new slot, reordering) starts a fresh
  // revision-0 lineage bump from the old value (or 0 for a brand-new slot).
  for (let pi = 0; pi < pages.length; pi++) {
    const oldPage = oldPages[pi];
    const page = pages[pi];
    if (page === undefined) continue;
    for (let si = 0; si < page.slots.length; si++) {
      const newSlot = page.slots[si];
      const oldSlot = oldPage?.slots[si];
      if (newSlot === undefined) continue;
      const newKey = slotContentKey(newSlot.rulesJson, newSlot.abAllocationsJson);
      if (oldSlot === undefined) {
        // A brand-new slot has no PRIOR bucketing to invalidate — start clean.
        newSlot.slotRevision = 0;
      } else {
        // BUG GUARD: JSON.stringify(null) is the 4-char STRING "null", not
        // actual null — feeding that through unconditionally would make
        // slotContentKey's `?? ""` fallback never fire on the OLD side,
        // permanently mismatching a genuinely unchanged null/null slot
        // against the NEW side's real `null` values.
        const oldKey = slotContentKey(
          oldSlot.rules === null ? null : JSON.stringify(oldSlot.rules),
          oldSlot.ab_allocations === null ? null : JSON.stringify(oldSlot.ab_allocations),
        );
        newSlot.slotRevision = oldKey === newKey ? oldSlot.slot_revision : oldSlot.slot_revision + 1;
      }
    }
  }

  return { pages, errors };
}

// Round-4 P3a item 4 (P3b-found coherence gap): the legacy `sections`
// replace-set used to leave a page-bearing variant's leadgen_funnel_pages /
// _page_slots rows ORPHANED — nothing re-links them once their
// variant_sections rows are replaced, so loadVariantPages kept resolving a
// STALE page/slot tree alongside the freshly-saved flat section list. This
// wraps the fresh, already-ordered section list into one page + one fixed
// slot per section — the SAME shape 0042's migration backfills a legacy row
// into — so a `sections` save never goes stale, whether or not the variant
// previously had a REAL page/slot structure (a variant that has never used
// `pages` simply gets one minted fresh, every save; harmless and idempotent).
//
// Statement shape mirrors forkVariantHandler's clone batch (below): every
// page/slot is pre-minted a public_id app-side, then linked via a
// `(SELECT id FROM ... WHERE public_id = ?)` subquery — no `.meta.last_row_id`
// forwarding, so this joins the SAME atomic `statements` array/batch as the
// variant_sections delete+reinsert the caller just pushed (must be called
// AFTER that, so the UPDATE below finds live rows to attach to).
function pushSectionPageWrapStatements(
  db: D1Database,
  statements: D1PreparedStatement[],
  variantId: number,
  sectionItems: readonly SectionOrderItem[],
): void {
  statements.push(db.prepare("DELETE FROM leadgen_funnel_pages WHERE variant_id = ?").bind(variantId));
  for (const item of sectionItems) {
    const pagePublicId = mintPublicId("funnel_page");
    statements.push(
      db
        .prepare("INSERT INTO leadgen_funnel_pages (public_id, variant_id, position, name) VALUES (?, ?, ?, NULL)")
        .bind(pagePublicId, variantId, item.position),
    );
    statements.push(
      db
        .prepare(
          `INSERT INTO leadgen_funnel_page_slots (page_id, position, slot_revision, rules_json, ab_allocations_json)
           VALUES ((SELECT id FROM leadgen_funnel_pages WHERE public_id = ?), 0, 0, NULL, NULL)`,
        )
        .bind(pagePublicId),
    );
    statements.push(
      db
        .prepare(
          `UPDATE leadgen_funnel_variant_sections
             SET page_id = (SELECT id FROM leadgen_funnel_pages WHERE public_id = ?),
                 slot_id = (SELECT s.id FROM leadgen_funnel_page_slots s
                              JOIN leadgen_funnel_pages p ON p.id = s.page_id
                             WHERE p.public_id = ?)
           WHERE variant_id = ? AND section_id = ? AND position = ?`,
        )
        .bind(pagePublicId, pagePublicId, variantId, item.section_id, item.position),
    );
  }
}

// Round-4 P3a review round (adversarial minor-3): forkVariantHandler and
// duplicateQuoteHandler used to clone a source variant's sections as bare
// leadgen_funnel_variant_sections rows -- silently FLATTENING any real page/
// slot structure (an A/B or ruled slot with N candidates) into N sequential
// MANDATORY single-candidate pages. This is the shared clone both handlers
// now call instead: fresh page/slot public ids, rules_json/ab_allocations_
// json copied VERBATIM (their embedded section_id values reference the
// GLOBAL leadgen_sections catalog, not a per-variant row, so they stay
// valid with zero remapping across variants), slot_revision RESET to 0 (a
// fresh lineage -- the clone has never been re-bucketed), candidates re-
// keyed to the NEW variant's OWN leadgen_funnel_variant_sections rows (the
// source's variant_section rows belong to a DIFFERENT variant_id and can
// never be reused). Subquery-linked into the caller's SAME atomic
// `statements` array/batch -- the same public-id-subquery idiom this file
// already uses throughout (forkVariantHandler's own section/rule clones,
// putVariantHandler's atomic pages insert). `newVariantPublicId` (not yet a
// real row at statement-BUILD time -- it may be INSERTed earlier in the
// SAME batch) is threaded through via subquery, never a bound numeric id.
function pushPageCloneStatements(
  db: D1Database,
  statements: D1PreparedStatement[],
  newVariantPublicId: string,
  sourcePages: readonly ResolvedFunnelPage[],
): { pages: number; slots: number; candidates: number } {
  let pages = 0;
  let slots = 0;
  let candidates = 0;
  let sectionRowPosition = 0;
  for (const page of sourcePages) {
    const pagePublicId = mintPublicId("funnel_page");
    statements.push(
      db
        .prepare(
          `INSERT INTO leadgen_funnel_pages (public_id, variant_id, position, name)
           VALUES (?, (SELECT id FROM leadgen_funnel_variants WHERE public_id = ?), ?, ?)`,
        )
        .bind(pagePublicId, newVariantPublicId, page.position, page.name),
    );
    pages += 1;
    for (const slot of page.slots) {
      statements.push(
        db
          .prepare(
            `INSERT INTO leadgen_funnel_page_slots (page_id, position, slot_revision, rules_json, ab_allocations_json)
             VALUES ((SELECT id FROM leadgen_funnel_pages WHERE public_id = ?), ?, 0, ?, ?)`,
          )
          .bind(
            pagePublicId,
            slot.position,
            slot.rules !== null ? JSON.stringify(slot.rules) : null,
            slot.ab_allocations !== null ? JSON.stringify(slot.ab_allocations) : null,
          ),
      );
      slots += 1;
      for (const candidate of slot.candidates) {
        statements.push(
          db
            .prepare(
              `INSERT INTO leadgen_funnel_variant_sections (variant_id, section_id, position, page_id, slot_id)
               VALUES (
                 (SELECT id FROM leadgen_funnel_variants WHERE public_id = ?), ?, ?,
                 (SELECT id FROM leadgen_funnel_pages WHERE public_id = ?),
                 (SELECT s.id FROM leadgen_funnel_page_slots s
                    JOIN leadgen_funnel_pages p ON p.id = s.page_id
                   WHERE p.public_id = ? AND s.position = ?))`,
            )
            .bind(newVariantPublicId, candidate.section.id, sectionRowPosition++, pagePublicId, pagePublicId, slot.position),
        );
        candidates += 1;
      }
    }
  }
  return { pages, slots, candidates };
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
      if (!exists) errors["auction_id"] = describeMissingReference("Auction");
      else auctionId = parsed;
    }
  }

  let variantLabel = variant.variant_label;
  if (body["variant_label"] !== undefined) {
    const v = trimmedString(body["variant_label"]);
    if (v !== null) variantLabel = v;
  }
  // Rework M1 (§4.3-10): no is_control axis — a variant is the funnel's single
  // active variant (no test) or an A/B arm; there is no control flag to set.
  // Rework M5: a variant's A/B frame_template_id override (NULL = inherit the
  // funnel's template). Absent key = column untouched.
  let frameTemplateId: number | null = variant.frame_template_id;
  if (body["frame_template_id"] !== undefined) {
    const parsed = asIntOrNull(body["frame_template_id"]);
    if (parsed === INVALID) errors["frame_template_id"] = "frame_template_id must be an integer id";
    else if (parsed === null) frameTemplateId = null;
    else {
      const ex = await c.env.DB.prepare("SELECT id FROM leadgen_frame_templates WHERE id = ? LIMIT 1").bind(parsed).first<{ id: number }>();
      if (!ex) errors["frame_template_id"] = describeMissingReference("Template");
      else frameTemplateId = parsed;
    }
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

  // --- v2.5 §4.5/§4.7: frame_overrides_json (ADDITIVE — absent key = column
  // untouched, so pre-0041 callers/harnesses are byte-unaffected). Validation
  // reuses the serve-side split (resolveFrameComposition): the frame groups
  // through validateFrameConfig-over-sparse, the `theme` part through
  // validateTheme (palette-role rules). 400 + §3.6 problems on any
  // error-severity row (14 §14.3 — an invalid overrides patch is never
  // persisted); warnings persist WITH the save.
  const overridesProvided = body["frame_overrides_json"] !== undefined;
  let overridesJson: string | null = null;
  const overridesProblems: Problem[] = [];
  if (overridesProvided) {
    const raw = body["frame_overrides_json"];
    if (raw === null) {
      overridesJson = null; // explicit clear — back to "no overrides"
    } else if (!isRecord(raw)) {
      errors["frame_overrides_json"] = "frame_overrides_json must be a JSON object or null";
    } else {
      // §4.5: `template`/`version` are funnel-level fields — the overrides
      // merge DROPS them (effectiveFrame layer 3), so accepting them here
      // would silently ignore operator intent (an overrides patch may never
      // switch templates). REJECT with a path-precise problem rather than
      // stripping.
      for (const funnelLevelKey of ["template", "version"] as const) {
        if (raw[funnelLevelKey] !== undefined) {
          overridesProblems.push({
            path: `frame_overrides.${funnelLevelKey}`,
            scope: "frame",
            severity: "error",
            message:
              funnelLevelKey === "template"
                ? "Variant overrides can't switch the funnel-layout template — the template is a funnel-level setting (change it in the funnel's layout settings)."
                : "Variant overrides can't carry a version field — it belongs to the funnel-level layout settings.",
          });
        }
      }
      // v3.1 §10.1: `theme_id` is a NEW top-level key (frame_overrides_json.
      // theme_id) — an A/B assignment of a KV lg-funnel-themes record,
      // distinct from the existing `theme.palette` ad hoc override above.
      // Extracted BEFORE validateFrameConfig for the SAME reason `theme` is
      // (else it would reject theme_id as an unrecognised frame group).
      const { theme: themePart, theme_id: themeIdPart, ...frameParts } = raw;
      overridesProblems.push(...validateFrameConfig(frameParts).problems);
      if (themePart !== undefined) {
        if (!isRecord(themePart)) {
          overridesProblems.push({
            path: "theme",
            scope: "theme",
            severity: "error",
            message: "The variant theme overrides must be a group of palette colours.",
          });
        } else {
          overridesProblems.push(...validateTheme(themePart).problems);
        }
      }
      if (themeIdPart !== undefined) {
        if (typeof themeIdPart !== "string" || themeIdPart.trim() === "") {
          overridesProblems.push({
            path: "frame_overrides.theme_id",
            scope: "theme",
            severity: "error",
            message: "theme_id must be a non-empty theme id.",
          });
        } else if (!(await themeRecordExists(c.env.CACHE, themeIdPart))) {
          overridesProblems.push({
            path: "frame_overrides.theme_id",
            scope: "theme",
            severity: "error",
            // H2b: same register as describeMissingReference's other 7 call
            // sites — themeIdPart is a raw system id (thm_…, per
            // quotes-tabs/theme-preset-resolve.ts's own {"theme_id":"thm_..."}
            // shape), never typed by the operator (a Theme picker's value
            // attribute), and this Problem[] reaches the operator the SAME
            // way auction_id/frame_template_id do (saveFailureText's
            // `res.body.problems` branch).
            message: describeMissingReference("Theme"),
          });
        }
      }
      if (!overridesProblems.some((p) => p.severity === "error")) {
        // `raw` (not `frameParts`) — theme_id (and `theme`) ride the
        // persisted JSON unchanged; they were only split out above for
        // validation scoping (additive key, existing keys preserved).
        overridesJson = JSON.stringify(raw);
      }
    }
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

  // --- Round-4 P3a pages/slots (D-3 replace-set) ----------------------------
  // MUTUALLY EXCLUSIVE with `sections` on the SAME PUT call: both replace the
  // SAME underlying leadgen_funnel_variant_sections rows via a delete+reinsert
  // batch (pages ALSO owns leadgen_funnel_pages/_page_slots) — accepting both
  // in one request would make the atomic batch's statement order decide which
  // one silently wins. Existing single-page-per-section callers keep using
  // `sections` untouched; the page-aware structure panel (P3b) uses `pages`.
  const pagesProvided = body["pages"] !== undefined;
  let preparedPages: PreparedPage[] = [];
  if (pagesProvided && sectionsProvided) {
    errors["pages"] = "pages and sections cannot both be provided in the same save";
  } else if (pagesProvided) {
    const oldPages = await loadVariantPages(c.env.DB, variant.id);
    const prep = await preparePages(c.env.DB, owner.quote, body["pages"], oldPages);
    Object.assign(errors, prep.errors);
    preparedPages = prep.pages;
  }

  // OWNER RULING (2026-08-09) — section uniqueness is NOT enforced any more.
  // The rule was "a section can appear once per funnel". The owner's words:
  // "if I put 3 sections in the same page - to not allowed to use one of them
  // is absurd, if for a certain user we showed in this page one section, and
  // didn't showed the remain two sections due to rule or AB test, we may want
  // to show them in another page." A page slot holds CANDIDATES chosen at serve
  // time by rules/A-B, so a section listed twice in a funnel is not two
  // showings - it is one showing in each of two mutually-exclusive branches.
  // Refusing the save made legitimate authoring impossible AND wedged the
  // builder (the board keeps a refused section in its unsaved model). Storage
  // allows it: the only uniqueness the schema has is (variant_id, position) /
  // (quote_id, position), never section_id.


  // --- funnel rules (§15.5 replace-set) -------------------------------------
  const rulesProvided = body["rules"] !== undefined;
  let preparedRules: PreparedRule[] = [];
  if (rulesProvided) {
    const prep = await prepareRules(c.env.DB, variant.id, variant.funnel_id, body["rules"], redirectAllowlist(c.env));
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
        if (!ex) errors[`rules.target_offer_id.${oid}`] = describeMissingReference("Offer");
      }
      // target_section_id is NOT part of the describeMissingReference register
      // (H2b): the 3 removed rule types (route_funnel_variant/skip_section/
      // show_section) were the only ones that ever set it, and grep across
      // every client that builds a rule payload (ui-rules-builder.ts,
      // ui-quotes.ts, quotes-tabs/funnel.ts) is 0 hits for target_section_id —
      // no live UI control can submit a non-null value, so this branch cannot
      // fire through the admin UI today. Left as-is (no string nobody reads).
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
  // v2.5 §14.3: schema-invalid overrides → 400 with the path-precise §3.6
  // problems (additive next to the {error, fields} convention).
  if (overridesProblems.some((p) => p.severity === "error")) {
    return c.json(
      {
        error: "Validation failed",
        fields: { frame_overrides_json: "frame/theme overrides failed validation" },
        problems: overridesProblems,
      },
      400,
    );
  }

  // --- one atomic replace-set batch -----------------------------------------
  // Rework M1: no is_control column. frame_template_id (Rework M5 A/B override)
  // is written as a SEPARATE conditional statement below — like frame_overrides_
  // json — so a pre-rework schema (no such column) is byte-unaffected unless the
  // caller actually sends the key.
  const statements: D1PreparedStatement[] = [
    c.env.DB.prepare(
      `UPDATE leadgen_funnel_variants SET
         variant_label = ?, traffic_allocation_bp = ?, funnel_design_id = ?, auction_id = ?,
         lander_enabled = ?, lander_headline = ?, lander_subheadline = ?, lander_body_json = ?,
         lander_hero_media_url = ?, lander_cta_json = ?, content_version = content_version + 1
       WHERE id = ?`,
    ).bind(
      variantLabel, trafficBp, designId, auctionId,
      landerEnabled, landerHeadline, landerSub, landerBody,
      landerHeroUrl, landerCta, variant.id,
    ),
  ];
  // Rework M5: only touch frame_template_id when the caller set it (the column
  // exists only on the rework schema; the validation above ran the same guard).
  // Cache-coherence mini-round: a saved-template re-point is a visitor-facing
  // layout change exactly like a frame_config_json/theme_json edit — it MUST
  // bump content_version so the shell/config cache key changes (03 §3.1, the
  // SAME convention putFunnelFrameHandler/putFunnelThemeHandler/
  // applyFrameTemplateToFunnelHandler already follow). Bumped IN THIS SAME
  // statement (not relying on the core statement above, which happens to also
  // bump on every PUT today but is NOT a guarantee tied to this field — see
  // the mini-round report) so the invariant is self-contained and can never
  // silently break if the core statement's shape changes later. A harmless
  // double-bump can occur in the same request when the core statement's own
  // bump also fires (content_version is monotonic — only used to differ the
  // cache key, never compared for parity/count).
  if (body["frame_template_id"] !== undefined) {
    statements.push(
      c.env.DB.prepare("UPDATE leadgen_funnel_variants SET frame_template_id = ?, content_version = content_version + 1 WHERE id = ?").bind(frameTemplateId, variant.id),
    );
  }
  // v2.5 §4.5: the overrides column rides the SAME atomic batch, and ONLY when
  // the body carried the key — pre-0041 databases never see the column name.
  if (overridesProvided) {
    statements.push(
      c.env.DB.prepare("UPDATE leadgen_funnel_variants SET frame_overrides_json = ? WHERE id = ?").bind(
        overridesJson,
        variant.id,
      ),
    );
  }
  if (sectionsProvided) {
    statements.push(c.env.DB.prepare("DELETE FROM leadgen_funnel_variant_sections WHERE variant_id = ?").bind(variant.id));
    for (const s of sectionItems) {
      statements.push(
        c.env.DB.prepare(
          "INSERT INTO leadgen_funnel_variant_sections (variant_id, section_id, position) VALUES (?, ?, ?)",
        ).bind(variant.id, s.section_id, s.position),
      );
    }
    // Round-4 P3a item 4 (P3b-found coherence gap) — see
    // pushSectionPageWrapStatements' doc comment: a `sections` save always
    // wraps the fresh list into pages/slots too, so page rows never go
    // orphaned/stale relative to the section list actually being saved.
    // Must run AFTER the delete+reinsert above (its UPDATE targets the rows
    // just inserted); same statements array => same atomic batch.
    pushSectionPageWrapStatements(c.env.DB, statements, variant.id, sectionItems);
  }
  if (rulesProvided) {
    statements.push(c.env.DB.prepare("DELETE FROM leadgen_funnel_rules WHERE variant_id = ?").bind(variant.id));
    for (const r of preparedRules) {
      statements.push(insertRuleStatement(c.env.DB, "?", variant.id, r));
    }
  }
  // Round-4 P3a item 3 (was an OPEN CONCERN in the prior round): pages/
  // slots/candidates now join the SAME atomic `statements` batch instead of
  // running as a separate sequential-`.run()` pass after it. D1's batch()
  // can't forward an earlier statement's auto-generated id into a later
  // statement's bind params — so instead of reading back `.meta.last_row_id`,
  // every page (and, transitively, its slots) is pre-minted a public_id
  // app-side and linked via a `(SELECT id FROM ... WHERE public_id = ?)`
  // subquery, exactly the idiom forkVariantHandler already uses below to
  // link its cloned sections/rules to the not-yet-committed new variant row.
  // The whole pages+slots+candidates write now commits or rolls back with
  // the rest of the save — no partial-write window.
  if (pagesProvided) {
    statements.push(c.env.DB.prepare("DELETE FROM leadgen_funnel_pages WHERE variant_id = ?").bind(variant.id));
    let sectionRowPosition = 0;
    for (let pi = 0; pi < preparedPages.length; pi++) {
      const page = preparedPages[pi];
      if (page === undefined) continue;
      const pagePublicId = mintPublicId("funnel_page");
      statements.push(
        c.env.DB.prepare(
          "INSERT INTO leadgen_funnel_pages (public_id, variant_id, position, name) VALUES (?, ?, ?, ?)",
        ).bind(pagePublicId, variant.id, pi, page.name),
      );
      for (let si = 0; si < page.slots.length; si++) {
        const slot = page.slots[si];
        if (slot === undefined) continue;
        statements.push(
          c.env.DB.prepare(
            `INSERT INTO leadgen_funnel_page_slots
               (page_id, position, slot_revision, rules_json, ab_allocations_json)
             VALUES ((SELECT id FROM leadgen_funnel_pages WHERE public_id = ?), ?, ?, ?, ?)`,
          ).bind(pagePublicId, si, slot.slotRevision, slot.rulesJson, slot.abAllocationsJson),
        );
        for (const sectionId of slot.candidateSectionIds) {
          statements.push(
            c.env.DB.prepare(
              `INSERT INTO leadgen_funnel_variant_sections
                 (variant_id, section_id, position, page_id, slot_id)
               VALUES (?, ?, ?,
                 (SELECT id FROM leadgen_funnel_pages WHERE public_id = ?),
                 (SELECT s.id FROM leadgen_funnel_page_slots s
                    JOIN leadgen_funnel_pages p ON p.id = s.page_id
                   WHERE p.public_id = ? AND s.position = ?))`,
            ).bind(variant.id, sectionId, sectionRowPosition++, pagePublicId, pagePublicId, si),
          );
        }
      }
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
// The advisory preflight verdict and the response detail are INDEPENDENT reads
  // of the just-written state (the detail never reads the stored verdict), so
  // they run together instead of one after the other. The board consumes
  // activation_preflight from this response to repaint the publish banner
  // (quotes-tabs/funnel.ts renderPreflight), so it stays in the response.
  const [preflight, detail] = await Promise.all([
    storeVariantPreflight(c, updated, owner.quote),
    variantDetailJson(c.env.DB, updated),
  ]);
  // v2.5 §3.6 (additive): overrides warnings persist WITH the save and ride
  // the success body so the builder can surface them.
  if (overridesProvided && overridesProblems.length > 0) {
    return c.json({ ...detail, activation_preflight: preflight, problems: overridesProblems });
  }
  return c.json({ ...detail, activation_preflight: preflight });
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
// Rework M1 (§4.3-10/§8.2): the "Fork this variant" affordance is REMOVED from
// the builder UI; the handler is retained but enforces the single-active-variant
// invariant (a fork's new active variant is refused unless the funnel has no
// active variant — see the guard below). The running-allocation lifecycle
// remains the P8 seam.
export async function forkVariantHandler(c: AdminContext): Promise<Response> {
  const source = await resolveVariantRow(c.env.DB, c.req.param("id") ?? "");
  if (source === null) return c.json({ error: "Not Found" }, 404);

  const runningTest = await getRunningAbTest(c.env.DB, source.funnel_id);
  const existing = await readFunnelVariants(c.env.DB, source.funnel_id);
  const activeExisting = existing.filter((v) => v.status === "active");

  // Rework M1 (§4.3-10) + conductor extension round 2 (P1 regression fix): a
  // fork adding a SECOND active variant is legal ONLY as the bootstrap of a
  // RUNNING test's 2nd arm — exactly one active variant already exists AND a
  // test is running on this funnel. Fork is the file's designated arm-creation
  // path (not createVariantUnderFunnel — an arm should start as a COPY of the
  // control's content, matching "fork clones the arm", §4.5). Every OTHER
  // "already active" state still 409s with the SAME message as before:
  //   * no running test at all (the pre-A/B-test state) — B1 test (d) after
  //     stop: 2 active arms persist, no running test, fork stays blocked.
  //   * a running test that ALREADY has ≥2 arms — adding a 3rd+ arm is NEVER
  //     allowed (B1 test (c): forking a running arm when 2 already exist 409s;
  //     the arm SET is frozen once it reaches its running shape — only the
  //     bootstrap 1→2 transition is a sanctioned mutation).
  // A funnel with ZERO active variants (all archived) forks freely — unaffected
  // legacy path (e.g. leadgen-quotes-api.test.ts's clone-mechanics fork, which
  // archives the source first).
  const canBootstrapArm = runningTest !== null && activeExisting.length === 1;
  if (activeExisting.length > 0 && !canBootstrapArm) {
    return c.json({ error: SINGLE_ACTIVE_VARIANT_MESSAGE }, 409);
  }

  // §4.3-10 "equal arms, Σbp=10000": bootstrapping the 2nd arm rebalances BOTH
  // now-active arms to an even split (always a 1→2 transition here — a 3rd+ is
  // refused above, so a general N-way split is future-proofing, not a live
  // path) and bumps the running test's revision so every session cleanly
  // re-buckets against the new arm set (B1's own "changing... bumps the
  // revision and cleanly re-buckets" philosophy — the SAME idiom
  // startExperimentHandler already uses when Σ is re-gated at start).
  const rebalanceStatements: D1PreparedStatement[] = [];
  let newVariantBp = source.traffic_allocation_bp;
  if (canBootstrapArm) {
    const shares = equalSplitBp(activeExisting.length + 1);
    activeExisting.forEach((v, i) => {
      rebalanceStatements.push(
        c.env.DB.prepare("UPDATE leadgen_funnel_variants SET traffic_allocation_bp = ? WHERE id = ?").bind(shares[i], v.id),
      );
    });
    newVariantBp = shares[shares.length - 1]!;
    rebalanceStatements.push(
      c.env.DB.prepare("UPDATE leadgen_funnel_ab_tests SET revision = revision + 1 WHERE id = ?").bind(runningTest!.id),
    );
  }

  // Rework M1 ("Labels A/B/C"): the SAME deterministic-letter scheme
  // createVariantUnderFunnel uses (was the pre-rework "-fork-N" suffix; no test
  // asserts that string — verified — so the naming can align with M1 cleanly).
  const newLabel = String.fromCharCode(65 + existing.length);
  const variantPublicId = mintPublicId("funnel_variant");

  // Read the source's ordered pages (loadVariantPages -- the SAME loader the
  // live runtime resolves through, real page/slot rows OR the synthetic
  // legacy-flat fallback; either way it is the fidelity-preserving read) +
  // rules BEFORE the write batch. Round-4 P3a review round minor-3:
  // srcSections/readVariantSections is NO LONGER the clone source -- it
  // flattened A/B/ruled slots into sequential mandatory fixed pages.
  const srcPages = await loadVariantPages(c.env.DB, source.id);
  const srcRules = await readVariantRules(c.env.DB, source.id);

  // v2.5 04 §4.5: "a fork clones the arm" — frame_overrides_json rides the
  // clone. The column name enters the INSERT ONLY when the source carries a
  // value (`?? null` = pre-0041 rows/harnesses without the column), so the
  // legacy statement below stays byte-identical for legacy databases and a
  // NULL source clones to the column's NULL default either way.
  const sourceFrameOverrides: string | null = source.frame_overrides_json ?? null;

  // ONE atomic batch (mirrors the POST /quotes create idiom): the variant
  // INSERT runs first, then the section + rule clones link to it via a
  // `(SELECT id FROM leadgen_funnel_variants WHERE public_id = ?)` subquery — so
  // the whole fork commits or rolls back together and a mid-failure can never
  // orphan a variant with no sections/rules. Each INSERT is single-row
  // (≤18 bindings) — 100-binding-safe.
  // Rework M1: no is_control column. Rework M5: frame_template_id rides the
  // clone (a fork clones the arm, §4.5). Both columns exist in the rework schema
  // (0041/0049), so the fork writes them unconditionally.
  const statements: D1PreparedStatement[] = [
    c.env.DB.prepare(
      `INSERT INTO leadgen_funnel_variants
         (public_id, funnel_id, ab_test_id, variant_label, traffic_allocation_bp, funnel_design_id,
          auction_id, lander_enabled, lander_headline, lander_subheadline, lander_body_json,
          lander_hero_media_id, lander_hero_media_url, lander_cta_json, content_version, status,
          frame_overrides_json, frame_template_id)
       VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'active', ?, ?)`,
    ).bind(
      variantPublicId, source.funnel_id, newLabel, newVariantBp, source.funnel_design_id,
      source.auction_id, source.lander_enabled, source.lander_headline, source.lander_subheadline, source.lander_body_json,
      source.lander_hero_media_id, source.lander_hero_media_url, source.lander_cta_json,
      sourceFrameOverrides, source.frame_template_id,
    ),
  ];
  // Round-4 P3a review round (minor-3): clone the source's REAL page/slot
  // structure (fresh ids, rules/allocations preserved, slot_revision reset
  // to 0) rather than bare variant-section rows.
  pushPageCloneStatements(c.env.DB, statements, variantPublicId, srcPages);
  for (const r of srcRules) {
    // Round-4 P4b: a fork stays WITHIN the source's own funnel (funnel_id is
    // reused verbatim above), so a route_funnel_variant rule's target_funnel_
    // variant_id (a sibling variant of that SAME funnel) is copied AS-IS --
    // unlike duplicateQuoteHandler's cross-quote clone, no remapping is
    // needed (the target variant is never touched/replaced by a fork).
    statements.push(
      insertRuleStatement(c.env.DB, "(SELECT id FROM leadgen_funnel_variants WHERE public_id = ?)", variantPublicId, {
        publicId: mintPublicId("funnel_rule"),
        ruleType: r.rule_type,
        conditionsJson: r.conditions_json,
        conditionsHash: r.conditions_hash,
        targetOfferId: r.target_offer_id,
        targetSectionId: r.target_section_id,
        redirectUrl: r.redirect_url,
        redirectAllowlisted: r.redirect_url_allowlisted,
        priority: r.priority,
        enabled: r.enabled,
        targetFunnelVariantId: r.target_funnel_variant_id,
        valueMultiplier: r.value_multiplier,
        checkpointPage: r.checkpoint_page,
        matchMode: r.match_mode,
        ruleName: r.rule_name,
        status: r.status,
        redirectPct: r.redirect_pct,
      }),
    );
  }
  // The sibling-arm bp rebalance + running-test revision bump (only present
  // when canBootstrapArm) ride the SAME atomic batch as the new variant's
  // INSERT — the arm-add and the rebalance commit or roll back together.
  statements.push(...rebalanceStatements);
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

// DELETE /variants/:id — §8.5/AC #11C ("delete-variant exists") — closes the
// known A/B-tab gap: after a test concludes, the operator deletes the losing
// arm (or any stale non-last variant). Guards: (a) the funnel's ARM SET is
// FROZEN while a test is RUNNING — the SAME B1 invariant every other arm-set
// mutation already respects (relabel/add-variant/fork-of-a-running-arm,
// §16.2/§29) — refused with the SAME message, so delete can never be the
// endpoint that quietly bypasses the freeze the other three enforce; (b) a
// funnel must always have something to serve — deleting its LAST ACTIVE
// variant is refused. An ARCHIVED variant deletes freely (not part of the
// live/frozen arm set). Cascade mirrors deleteFunnelHandler's explicit-delete
// pattern (D1 does not enforce ON DELETE CASCADE in production — sections-
// handlers.ts's own documented finding); leadgen_auctions rows referencing
// this variant (0046's inbound-FK inventory) have funnel_variant_id nulled
// rather than left dangling (buildSimulateResolved already degrades a null/
// missing variant to its synthetic-stub path, so this is pure hygiene).
export async function deleteVariantHandler(c: AdminContext): Promise<Response> {
  const variant = await resolveVariantRow(c.env.DB, c.req.param("id") ?? "");
  if (variant === null) return c.json({ error: "Not Found" }, 404);

  if (variant.status === "active") {
    if (await funnelHasRunningTest(c.env.DB, variant.funnel_id)) {
      return c.json({ error: RUNNING_TEST_ARM_LOCK_MESSAGE }, 409);
    }
    const activeSiblings = await readActiveFunnelVariants(c.env.DB, variant.funnel_id);
    if (activeSiblings.length <= 1) {
      return c.json(
        { error: "Can't delete this variant: a funnel must have at least one active variant." },
        409,
      );
    }
  }

  const psub = "(SELECT id FROM leadgen_funnel_pages WHERE variant_id = ?)";
  await c.env.DB.batch([
    c.env.DB.prepare(`DELETE FROM leadgen_funnel_page_slots WHERE page_id IN ${psub}`).bind(variant.id),
    c.env.DB.prepare("DELETE FROM leadgen_funnel_variant_sections WHERE variant_id = ?").bind(variant.id),
    c.env.DB.prepare("DELETE FROM leadgen_funnel_pages WHERE variant_id = ?").bind(variant.id),
    c.env.DB.prepare("DELETE FROM leadgen_funnel_rules WHERE variant_id = ?").bind(variant.id),
    c.env.DB.prepare("UPDATE leadgen_funnel_rules SET target_funnel_variant_id = NULL WHERE target_funnel_variant_id = ?").bind(variant.id),
    c.env.DB.prepare("UPDATE leadgen_auctions SET funnel_variant_id = NULL WHERE funnel_variant_id = ?").bind(variant.id),
    c.env.DB.prepare("DELETE FROM leadgen_funnel_variants WHERE id = ?").bind(variant.id),
  ]);
  return c.json({ ok: true, id: variant.id, public_id: variant.public_id, deleted: true });
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

// ---------------------------------------------------------------------------
// D5 mini-round — variant-scoped rule CRUD (leadgen_funnel_rules, the FOUR
// auction-domain types only: eligibility/disqualification/auction_entry/
// redirect_direct_offer). The relocated Auction-tab editor (P3b) needs real
// REST endpoints instead of the variant-PUT hidden-carrier chain (`rules` on
// the §15.5 replace-set) — added ALONGSIDE that chain, not replacing it (the
// variant PUT's `rules` array key keeps working byte-identically for any
// caller still using it). Both paths share prepareOneRule (above) for
// validation, so they can never diverge. Mirrors this file's established
// quote-routing-rules CRUD conventions (buildRoutingRuleFields/
// resolveQuoteRoutingRuleRow/list-create-update-delete) at the SAME
// granularity, scoped to a variant instead of a quote. The existing
// POST /variants/:variant_id/rules/:rule_id/duplicate (below, unchanged) is
// now this surface's 5th verb.
// ---------------------------------------------------------------------------

// Resolve a rule by dual-id (numeric or public lgfr_), SCOPED to the given
// variant — mirrors duplicateRuleHandler's own WHERE ... AND variant_id = ?
// scoping (below), so a rule_id can never be read/mutated through a foreign
// variant's URL.
async function resolveVariantRuleRow(
  db: D1Database,
  variantId: number,
  ruleIdParam: string,
): Promise<LeadgenFunnelRuleRowV2 | null> {
  const selector = idSelector("funnel_rule", ruleIdParam);
  if (selector === null) return null;
  const sql =
    selector.column === "id"
      ? "SELECT * FROM leadgen_funnel_rules WHERE id = ? AND variant_id = ? LIMIT 1"
      : "SELECT * FROM leadgen_funnel_rules WHERE public_id = ? AND variant_id = ? LIMIT 1";
  return (await db.prepare(sql).bind(selector.value, variantId).first<LeadgenFunnelRuleRowV2>()) ?? null;
}

// An existing rule ROW, reshaped into the same "entry" fields prepareOneRule
// accepts (conditions_json PARSED back to a structural value, booleans as
// booleans) — the PATCH merge baseline. Used ONLY to build `{...candidate,
// ...body}` before re-validating through prepareOneRule; never persisted
// directly (prepareOneRule always re-derives conditions_hash + re-runs the
// Stage-A verdict, so a PATCH can never drift from a POST's validation).
function ruleRowToCandidateEntry(row: LeadgenFunnelRuleRowV2): Record<string, unknown> {
  return {
    rule_type: row.rule_type,
    target_offer_id: row.target_offer_id,
    target_section_id: row.target_section_id,
    conditions_json: parseJsonColumn(row.conditions_json) ?? { groups: [] },
    redirect_url: row.redirect_url,
    redirect_url_allowlisted: row.redirect_url_allowlisted !== 0,
    priority: row.priority,
    rule_name: row.rule_name,
    status: row.status,
    enabled: row.enabled !== 0,
    match_mode: row.match_mode,
    value_multiplier: row.value_multiplier,
    redirect_pct: row.redirect_pct,
  };
}

// FK existence for a single prepared rule's target_offer_id/target_section_id
// (leadgen_funnel_rules FKs are enforced by D1) — mirrors putVariantHandler's
// own per-target existence check (§15.5 replace-set) so a dangling id 400s
// cleanly here too, never a raw FK-constraint 500.
async function ruleTargetFkErrors(db: D1Database, rule: PreparedRule): Promise<FieldErrors> {
  const errors: FieldErrors = {};
  if (rule.targetOfferId !== null) {
    const ex = await db.prepare("SELECT id FROM leadgen_offers WHERE id = ? LIMIT 1").bind(rule.targetOfferId).first<{ id: number }>();
    if (!ex) errors["target_offer_id"] = describeMissingReference("Offer");
  }
  // target_section_id: same H2b non-register decision as prepareRules' own
  // FK-existence loop above — 0 live UI producer (grep evidence there).
  if (rule.targetSectionId !== null) {
    const ex = await db.prepare("SELECT id FROM leadgen_sections WHERE id = ? LIMIT 1").bind(rule.targetSectionId).first<{ id: number }>();
    if (!ex) errors["target_section_id"] = `section ${rule.targetSectionId} does not exist`;
  }
  return errors;
}

// D5 cache-coherence mini-round precedent (frame_template_id): rule edits via
// the variant-PUT replace-set bump content_version TODAY (verified empirically
// — the replace-set's own core UPDATE statement always bumps it, on ANY save
// including a rules-only one), so these NEW standalone endpoints must too —
// self-contained (not relying on a sibling statement's incidental behavior),
// matching the SAME §3.1 convention putFunnelFrameHandler/putFunnelThemeHandler/
// applyFrameTemplateToFunnelHandler/the frame_template_id PUT statement all
// follow (the shell/config cache keys carry the content_version axis; the
// bump is what busts them — no new cache axis). Returns a D1PreparedStatement
// (not an awaited run) so create/update/delete below can include the bump IN
// THE SAME ATOMIC BATCH as the rule write — mirrors the frame_template_id
// fix's "same statement/transaction" discipline, one shared helper so all
// three call sites can never drift apart on the exact SQL text.
function bumpVariantContentVersionStatement(db: D1Database, variantId: number): D1PreparedStatement {
  return db.prepare("UPDATE leadgen_funnel_variants SET content_version = content_version + 1 WHERE id = ?").bind(variantId);
}

// GET /variants/:id/rules — list (the four auction-domain types only; the
// table itself carries no other type post-M3/D5, so no filter is needed).
export async function listVariantRulesHandler(c: AdminContext): Promise<Response> {
  const variant = await resolveVariantRow(c.env.DB, c.req.param("id") ?? "");
  if (variant === null) return c.json({ error: "Not Found" }, 404);
  const rules = await readVariantRules(c.env.DB, variant.id);
  return c.json({ items: rules.map(ruleRowToApi) });
}

// POST /variants/:id/rules — create one rule via the SAME prepareOneRule the
// variant-PUT replace-set uses (never a locally-diverging validator).
export async function createVariantRuleHandler(c: AdminContext): Promise<Response> {
  const variant = await resolveVariantRow(c.env.DB, c.req.param("id") ?? "");
  if (variant === null) return c.json({ error: "Not Found" }, 404);
  const body = (await readJsonBody(c)) ?? {};

  const { rule, errors } = prepareOneRule(body, redirectAllowlist(c.env));
  if (rule === null) return c.json({ error: "Validation failed", fields: errors }, 400);
  const fkErrors = await ruleTargetFkErrors(c.env.DB, rule);
  if (Object.keys(fkErrors).length > 0) return c.json({ error: "Validation failed", fields: fkErrors }, 400);

  await c.env.DB.batch([
    insertRuleStatement(c.env.DB, "?", variant.id, rule),
    bumpVariantContentVersionStatement(c.env.DB, variant.id),
  ]);
  const created = await c.env.DB.prepare("SELECT * FROM leadgen_funnel_rules WHERE public_id = ? LIMIT 1")
    .bind(rule.publicId)
    .first<LeadgenFunnelRuleRowV2>();
  if (!created) return c.json({ error: "Insert failed" }, 500);
  return c.json(ruleRowToApi(created), 201);
}

// PATCH /variants/:id/rules/:rule_id — partial update: merge the body over the
// EXISTING row's fields (mirrors buildRoutingRuleFields's merge-over-existing
// convention), then re-validate the FULL merged candidate through the SAME
// prepareOneRule a POST uses — conditions_hash + the Stage-A verdict are
// always freshly re-derived from the merged shape, never carried over stale.
export async function updateVariantRuleHandler(c: AdminContext): Promise<Response> {
  const variant = await resolveVariantRow(c.env.DB, c.req.param("id") ?? "");
  if (variant === null) return c.json({ error: "Not Found" }, 404);
  const existing = await resolveVariantRuleRow(c.env.DB, variant.id, c.req.param("rule_id") ?? "");
  if (existing === null) return c.json({ error: "Not Found" }, 404);
  const body = await readJsonBody(c);
  if (body === null) return c.json({ error: "Invalid JSON body" }, 400);

  const merged: Record<string, unknown> = { ...ruleRowToCandidateEntry(existing), ...body };
  // P4b status/enabled coherence (the SAME rule prepareOneRule enforces on
  // CREATE): a PATCH that sets `status` WITHOUT ALSO setting `enabled` means
  // "derive enabled from the NEW status" — not "keep the row's OLD enabled".
  // The blanket merge above always fills `enabled` (from the body or from
  // `existing`), which would make prepareOneRule see it as "explicitly
  // provided" either way and skip the derivation. Deleting the carried-over
  // value here (ONLY in this one case) restores "absent" so prepareOneRule
  // re-derives fresh, exactly as a POST with the same body would.
  if (body["status"] !== undefined && body["enabled"] === undefined) {
    delete merged["enabled"];
  }
  const { rule, errors } = prepareOneRule(merged, redirectAllowlist(c.env));
  if (rule === null) return c.json({ error: "Validation failed", fields: errors }, 400);
  const fkErrors = await ruleTargetFkErrors(c.env.DB, rule);
  if (Object.keys(fkErrors).length > 0) return c.json({ error: "Validation failed", fields: fkErrors }, 400);

  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE leadgen_funnel_rules SET
         rule_type = ?, conditions_json = ?, conditions_hash = ?, target_offer_id = ?, target_section_id = ?,
         redirect_url = ?, redirect_url_allowlisted = ?, priority = ?, enabled = ?, value_multiplier = ?,
         match_mode = ?, rule_name = ?, status = ?, redirect_pct = ?
       WHERE id = ?`,
    ).bind(
      rule.ruleType, rule.conditionsJson, rule.conditionsHash, rule.targetOfferId, rule.targetSectionId,
      rule.redirectUrl, rule.redirectAllowlisted, rule.priority, rule.enabled, rule.valueMultiplier,
      rule.matchMode, rule.ruleName, rule.status, rule.redirectPct, existing.id,
    ),
    bumpVariantContentVersionStatement(c.env.DB, variant.id),
  ]);
  const updated = await c.env.DB.prepare("SELECT * FROM leadgen_funnel_rules WHERE id = ? LIMIT 1")
    .bind(existing.id)
    .first<LeadgenFunnelRuleRowV2>();
  if (!updated) return c.json({ error: "Update failed" }, 500);
  return c.json(ruleRowToApi(updated));
}

// DELETE /variants/:id/rules/:rule_id — hard-delete (rules are cheap, no
// history) + the SAME content_version bump (removing a rule changes auction/
// eligibility behavior exactly like adding/editing one).
export async function deleteVariantRuleHandler(c: AdminContext): Promise<Response> {
  const variant = await resolveVariantRow(c.env.DB, c.req.param("id") ?? "");
  if (variant === null) return c.json({ error: "Not Found" }, 404);
  const existing = await resolveVariantRuleRow(c.env.DB, variant.id, c.req.param("rule_id") ?? "");
  if (existing === null) return c.json({ error: "Not Found" }, 404);

  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM leadgen_funnel_rules WHERE id = ?").bind(existing.id),
    bumpVariantContentVersionStatement(c.env.DB, variant.id),
  ]);
  return c.json({ ok: true, id: existing.id, public_id: existing.public_id, deleted: true });
}

// POST /variants/:variant_id/rules/:rule_id/duplicate — Round-4 P4b, this
// surface's 5th verb (D5 mini-round: list/create/update/delete added above,
// unchanged here per the dispatch — "the existing POST .../duplicate stays").
// Each rule carries its own stable id/public_id (migration 0043), so a
// single-row clone is a safe, isolated INSERT that persists IMMEDIATELY --
// mirrors the existing duplicateSectionHandler/duplicateOfferHandler
// precedent (instant 201 + the new row, never touching sibling rows, never
// requiring the operator to hit the variant's main Save first). Micro-round
// fix (found-issue-fixed-now, was an OPEN CONCERN in the D5 mini-round): a
// duplicated rule is a NEW active rule affecting auction/eligibility behavior
// exactly like create/update/delete — now bumps content_version atomically in
// the SAME batch as the INSERT, via the SAME bumpVariantContentVersionStatement
// helper the other 3 mutating verbs use (no longer the lone unbumped verb).
export async function duplicateRuleHandler(c: AdminContext): Promise<Response> {
  const variant = await resolveVariantRow(c.env.DB, c.req.param("variant_id") ?? "");
  if (variant === null) return c.json({ error: "Not Found" }, 404);

  const selector = idSelector("funnel_rule", c.req.param("rule_id") ?? "");
  if (selector === null) return c.json({ error: "Not Found" }, 404);
  const sql =
    selector.column === "id"
      ? "SELECT * FROM leadgen_funnel_rules WHERE id = ? AND variant_id = ? LIMIT 1"
      : "SELECT * FROM leadgen_funnel_rules WHERE public_id = ? AND variant_id = ? LIMIT 1";
  const src = await c.env.DB.prepare(sql).bind(selector.value, variant.id).first<LeadgenFunnelRuleRowV2>();
  if (src === null) return c.json({ error: "Not Found" }, 404);

  const newPublicId = mintPublicId("funnel_rule");
  const newName = src.rule_name !== null && src.rule_name !== "" ? `${src.rule_name} (copy)` : src.rule_name;
  await c.env.DB.batch([
    insertRuleStatement(c.env.DB, "?", variant.id, {
      publicId: newPublicId,
      ruleType: src.rule_type,
      conditionsJson: src.conditions_json,
      conditionsHash: src.conditions_hash,
      targetOfferId: src.target_offer_id,
      targetSectionId: src.target_section_id,
      redirectUrl: src.redirect_url,
      redirectAllowlisted: src.redirect_url_allowlisted,
      priority: src.priority,
      enabled: src.enabled,
      targetFunnelVariantId: src.target_funnel_variant_id,
      valueMultiplier: src.value_multiplier,
      checkpointPage: src.checkpoint_page,
      matchMode: src.match_mode,
      ruleName: newName,
      status: src.status,
      redirectPct: src.redirect_pct,
    }),
    bumpVariantContentVersionStatement(c.env.DB, variant.id),
  ]);

  const dup = await c.env.DB.prepare("SELECT * FROM leadgen_funnel_rules WHERE public_id = ? LIMIT 1")
    .bind(newPublicId)
    .first<LeadgenFunnelRuleRowV2>();
  if (!dup) return c.json({ error: "Duplicate failed" }, 500);
  return c.json(ruleRowToApi(dup), 201);
}

// v2.5 13 §13.4: the additive body keys that route a preview POST to the
// COMPOSED path. A body without ANY of them (the current admin UI posts
// exactly `{}`) takes the legacy branch below UNTOUCHED — the committed
// leadgen-legacy-pin fixture enforces byte identity.
const V25_PREVIEW_KEYS = [
  "mode",
  "site_id",
  "viewport",
  "section_public_id",
  "draft_frame_config",
  "draft_theme",
  "draft_frame_overrides", // DEV-58 (Phase D): per-arm overrides draft
  "page", // Phase D stepper perf: mode:"all" lazy per-page fetch
  "sample_section", // R2 §3 ②: empty-funnel sample row inside the real frame
] as const;

export async function previewVariantHandler(c: AdminContext): Promise<Response> {
  const variant = await resolveVariantRow(c.env.DB, c.req.param("id") ?? "");
  if (variant === null) return c.json({ error: "Not Found" }, 404);
  const owner = await quoteOfVariant(c.env.DB, variant);
  if (owner === null) return c.json({ error: "Not Found" }, 404);

  // Reading the body first is output-neutral for the legacy branch (which
  // never consumed it); a missing/invalid JSON body stays legacy.
  const body = (await readJsonBody(c)) ?? {};
  if (V25_PREVIEW_KEYS.some((key) => body[key] !== undefined)) {
    return composedVariantPreviewResponse(c, owner, variant, body);
  }

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
          ? `<div class="lg-auction-entry" data-auction-after-position="${rs.position}">Auction runs after this section (max position)</div>`
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
// v2.5 A7 + B1 — the COMPOSED variant preview (13 §13.4).
//
// The legacy previewVariantHandler path above stays BYTE-IDENTICAL (the
// committed leadgen-frame-legacy-pin fixture enforces it, `<h2 class=
// "lg-section-headline">` duplicate included). THIS function is the composed
// renderer the §13.4 preview modes consume: it renders the variant's sections
// WITH the 03 §3.4 sectionCtx (bound headline text from the Section columns,
// NO h2 duplicate — the §3.4 h2 removal applies to the NEW composed paths)
// inside the funnel's effective frame via the SAME serve-owned composition
// pieces the live /lg frame path uses (resolveFrameComposition +
// renderVariantSectionsHtml + renderQuoteFrame + funnelChromeCss{frameRegions}
// — parity by construction, 13 §13.5 legs 1+3).
//
// Phase-B additive params (§13.4): `mode` ("frame" = slot placeholder ·
// "section" = chosen/current Section visible · "all" = pages[], one composed
// document per Section with correct per-step progress values), `visibleIndex`,
// and the C5 `draftFrameConfig`/`draftTheme` substitutions (this render only —
// nothing persists). Phase-D additive params: `draftFrameOverrides` (DEV-58 —
// the per-arm overrides draft, substituted for the stored column so re-edited
// stored overrides preview exactly) and `page` (mode:"all" lazy per-step
// render). Called WITHOUT `mode` (the Phase-A shape) it still
// returns null for a legacy/invalid frame; WITH a mode it never returns null —
// the legacy path composes through the byte-pinned renderLegacyShell, the
// same fail-safe fork serve.ts takes (§13.1).
// ---------------------------------------------------------------------------

// §4.1 mode:"frame" slot placeholder — the canvas copy for the section slot.
export const LG_SLOT_PLACEHOLDER_HTML =
  '<div class="lg-slot-placeholder" data-lg-slot-placeholder>' +
  "This area is the Section’s question unit — edit it in the Section Builder." +
  "</div>";

// ---------------------------------------------------------------------------
// R2 §3 ② (A.1 #11-D) — the SAMPLE section for an EMPTY funnel.
//
// Owner truth: "the canvas should include one section in the middle so the
// user could see a real reference of how is design is gonna look like in real
// life". Before this, an empty funnel took a SECOND preview endpoint
// (POST /sections/preview) that renders a BARE section card with NO frame —
// so nothing the Funnel-layout boxes edit was visible. There is now ONE
// preview path: the composed variant preview serves the empty funnel too, and
// the caller opts in with `sample_section:true`. The synthetic row rides the
// SAME `sections` array as real rows, so frame composition, progress totals
// (1 of 1), footer show_on and the §15.4 config echo are computed exactly the
// way a real one-section funnel computes them — never a special render path.
// It is never persisted and never leaves this request.
// ---------------------------------------------------------------------------

export const LG_SAMPLE_SECTION_PUBLIC_ID = "lgs_sample_preview";
export const LG_SAMPLE_SECTION_HEADLINE = "Sample question";
// The design pack's Appendix A-9 no-sections copy, VERBATIM — the same string
// the retired client-side fixture carried, so the words the operator reads on
// an empty funnel are unchanged; only where they render moved (inside the
// composed frame now, not a bare card). templates.ts's canvas status line
// carries the same literal.
export const LG_SAMPLE_SECTION_HELPER = "Sample section (add sections to preview your own).";

export function buildSamplePreviewSection(
  quote: LeadgenQuoteRow,
  variant: LeadgenFunnelVariantRow,
): LeadgenSectionRow {
  const content = {
    components: [
      {
        type: "ButtonAnswerGroup",
        question_id: "lg_sample_q1",
        internal_field: "lg_sample_answer",
        choices: [
          { label: "Option A", value: "option_a" },
          { label: "Option B", value: "option_b" },
        ],
        props: { label: LG_SAMPLE_SECTION_HEADLINE, helper: LG_SAMPLE_SECTION_HELPER },
      },
      { type: "ContinueButton", question_id: "lg_sample_continue", props: { label: "Continue" } },
    ],
  };
  return {
    id: 0,
    public_id: LG_SAMPLE_SECTION_PUBLIC_ID,
    section_name: LG_SAMPLE_SECTION_HEADLINE,
    activity: quote.activity,
    vertical: quote.activity,
    headline_text: LG_SAMPLE_SECTION_HEADLINE,
    subheadline_text: LG_SAMPLE_SECTION_HELPER,
    image_json: null,
    content_json: JSON.stringify(content),
    content_html: null,
    continue_mode: "button",
    design_overrides_json: null,
    address_validation_enabled: 0,
    section_mapping_version: 1,
    content_version: variant.content_version,
    status: "active",
    created_by: null,
    created_at: 0,
    updated_at: 0,
  };
}

export interface ComposedVariantPreviewInput {
  quote: LeadgenQuoteRow;
  funnel: LeadgenFunnelRow;
  variant: LeadgenFunnelVariantRow;
  sections: LeadgenSectionRow[]; // ordered (variant section order)
  siteBranding?: SiteBranding | null;
  // --- v2.5 13 §13.4 additive (Phase B) --------------------------------------
  mode?: "frame" | "section" | "all";
  visibleIndex?: number; // mode:"section" — the ordered index shown (default 0)
  // C5 draft substitutions: undefined = the stored column; null = substitute
  // nothing (renders the legacy path); an object = THIS render only.
  draftFrameConfig?: Record<string, unknown> | null;
  draftTheme?: Record<string, unknown> | null;
  // DEV-58 (Phase D, additive): the per-arm frame_overrides draft — same
  // undefined/null/object semantics as the two above, substituted for the
  // STORED variant.frame_overrides_json in resolveFrameComposition, so
  // re-editing a field that already has a stored override previews the
  // WORKING value exactly (render-only; nothing persists).
  draftFrameOverrides?: Record<string, unknown> | null;
  // Phase D stepper perf (additive): with mode:"all", a 1-based step — the
  // renderer composes ONLY that page (returned as `html` + `page`) instead of
  // the full pages[] (lazy per-step fetch for long funnels). Clamped into
  // [1..section_count]. Absent → the full pages[] exactly as before.
  page?: number;
  // v3.1 §10.1/§12 (fix round, ADDITIVE): the ALREADY-FETCHED KV record for
  // whichever theme_id wins (variant frame_overrides_json.theme_id over
  // funnel theme_json.theme_id — winningThemeId, respecting draftTheme/
  // draftFrameOverrides when given). This function stays synchronous/pure —
  // composedVariantPreviewResponse (its async caller) resolves the id and
  // fetches the record. Absent/null = today's behavior unchanged.
  themeRecord?: ThemeRecord | null;
  // Round-4 P5b (10B admin leg, conductor-granted): threads renderQuoteFrame's
  // adminPreview flag (frame.ts renderNoLogoHint — the admin-preview-only
  // no-logo hint, [data-admin-preview-hint="1"]). Defaults to false/absent so
  // this function's OTHER caller — test/leadgen-preview-runtime-parity-v25
  // .test.ts's direct, mode-less call proving renderComposedVariantPreview's
  // html is BYTE-IDENTICAL to the live /lg serve path — is unaffected (the
  // live serve never sets adminPreview, so parity only holds when this also
  // defaults off). ONLY composedVariantPreviewResponse (the REAL admin
  // builder/Templates preview route) opts in.
  adminPreview?: boolean;
  // Rework §8.8 (follow-up round, conductor-granted): the admin "Open Site
  // settings" link frame.ts renders ONLY when adminPreview AND this are both
  // set (never a guessed/fabricated href). Same pass-through discipline as
  // adminPreview — absent/undefined for the byte-parity test caller, so its
  // live-serve-identical contract is unaffected.
  siteSettingsHref?: string | null;
  // R2 P3 BLOCKER FIX (leg 3 of 3 — one truth, both surfaces): the
  // CALLER-resolved leadgen_frame_templates row for
  // variant.frame_template_id ?? funnel.frame_template_id ?? the per-quote
  // default (loadSavedFrameTemplateDefaults, this file). resolveFrameComposition
  // now composes a frame from a saved template even when frame_config_json is
  // NULL; without this field the Templates canvas would go on rendering the
  // pre-fix "no frame at all" for exactly the funnels the live page now serves
  // a footer for — the admin surface blind to the very defect it is meant to
  // show. Absent/undefined keeps this function synchronous-pure and
  // byte-identical for its OTHER caller (test/leadgen-preview-runtime-parity-
  // v25.test.ts's live-serve-identical contract), same discipline as
  // themeRecord/adminPreview above.
  savedTemplateDefaults?: EffectiveFrameConfig | null;
}

export interface ComposedVariantPreview {
  css: string; // the SAME resolveTokens+funnelChromeCss string the runtime shell embeds
  html?: string; // modes "frame"/"section" (+ the Phase-A default): one composed body
  pages?: string[]; // mode "all" without `page`: one composed document per Section
  page?: number; // mode "all" with `page`: the clamped 1-based step `html` composes
  section_count: number;
  config: LeadgenPublicConfig; // the §15.4 config echo (effective design tokens)
}

// Advance the baked step-1 frame progress markup to `step` (§13.4 "correct
// per-step progress values"). renderQuoteFrame is pure and always bakes step
// 1; this re-runs the SAME preset calls frame.ts synthesizes (identical node
// shape through renderProgressBar/renderStepIndicator) to compute the exact
// step-1 substring and its step-k replacement — an exact swap, never a fuzzy
// regex. All four §3.3 progress positions render BEFORE the sections in
// document order, so the first occurrence is always the frame's own mount
// even when a legacy section embeds identical progress markup.
function advanceFrameProgress(
  pageHtml: string,
  frame: EffectiveFrameConfig,
  design: FunnelDesign,
  step: number,
  sectionCount: number,
): string {
  const p = frame.progress;
  if (p.style === "hidden") return pageHtml;
  const total = Math.max(1, Math.round(sectionCount));
  const target = Math.min(Math.max(1, Math.round(step)), total);
  if (target === 1) return pageHtml;
  const node = (type: ComponentType, props: Record<string, unknown>): LeadgenComponentNode => ({
    type,
    question_id: "frame_progress",
    props,
  });
  let from: string;
  let to: string;
  if (p.style === "dots") {
    from = renderStepIndicator(node("StepIndicator", { steps: total, current: 1 }), design);
    to = renderStepIndicator(node("StepIndicator", { steps: total, current: target }), design);
  } else if (p.style === "percent") {
    const pctProps = (s: number): Record<string, unknown> => {
      const pct = Math.round((s / total) * 100);
      const props: Record<string, unknown> = { mode: "percent", percent: pct };
      if (p.show_label) props["label"] = `${pct}%`;
      return props;
    };
    from = renderProgressBar(node("ProgressBar", pctProps(1)), design);
    to = renderProgressBar(node("ProgressBar", pctProps(target)), design);
  } else {
    // bar | numbered — step semantics over the section-order total.
    from = renderProgressBar(node("ProgressBar", { mode: "step", step: 1, totalSteps: total }), design);
    to = renderProgressBar(node("ProgressBar", { mode: "step", step: target, totalSteps: total }), design);
  }
  const at = pageHtml.indexOf(from);
  return at === -1 ? pageHtml : pageHtml.slice(0, at) + to + pageHtml.slice(at + from.length);
}

// Toggle which <section data-lg-section> is visible inside a composed body
// (mode:"section" chosen Section; mode:"all" page k) — the runtime engine
// flips the SAME `hidden` attribute at step time. The wrapper suffix is
// recomputed EXACTLY as renderVariantSectionsHtml emits it (index + escaped
// screen label + hidden flag), so the swap is an exact string replacement;
// authored content can never collide (its quotes render escaped).
function toggleVisibleSection(
  html: string,
  sections: readonly LeadgenSectionRow[],
  index: number,
): string {
  if (index <= 0 || index >= sections.length) return html;
  const marker = (i: number, hidden: boolean): string => {
    const section = sections[i];
    if (section === undefined) return "";
    const label = `${String(i + 1).padStart(2, "0")} · ${section.headline_text}`;
    return ` data-lg-index="${i}" data-screen-label="${escapeHtml(label)}"${hidden ? " hidden" : ""}>`;
  };
  return html
    .replace(marker(0, false), () => marker(0, true))
    .replace(marker(index, true), () => marker(index, false));
}

// Mirror the ENGINE's footer show_on rule per composed page (13 §13.4 parity
// with render.ts updateFooterVisibility): page k shows a show_on:"final"
// footer only on the LAST page and a show_on:"first" footer only on page 1.
// renderQuoteFrame always bakes the STEP-1 truth ("final" arrives hidden when
// the funnel has more than one Section; everything else arrives visible —
// frame.ts renderFooterRegion), so this swaps the baked state only when page
// k disagrees with it. Same exact-substring idiom as advanceFrameProgress:
// the ` data-show-on="…"` attribute suffix is emitted ONLY by
// renderFooterRegion (authored content renders escaped), so the swap can
// never collide. show_on:"all" needs no per-page toggle; a disabled/"never"
// footer renders no [data-show-on] node at all.
function setFrameFooterVisibility(
  pageHtml: string,
  frame: EffectiveFrameConfig,
  step: number,
  sectionCount: number,
): string {
  const f = frame.footer;
  if (!f.enabled || (f.show_on !== "final" && f.show_on !== "first")) return pageHtml;
  const total = Math.max(1, Math.round(sectionCount));
  const target = Math.min(Math.max(1, Math.round(step)), total);
  const ssrHidden = f.show_on === "final" && total > 1; // the frame.ts step-1 bake
  const pageHidden = f.show_on === "final" ? target !== total : target !== 1;
  if (pageHidden === ssrHidden) return pageHtml;
  const attrs = (hidden: boolean): string => ` data-show-on="${f.show_on}"${hidden ? " hidden" : ""}>`;
  const from = attrs(ssrHidden);
  const at = pageHtml.indexOf(from);
  return at === -1 ? pageHtml : pageHtml.slice(0, at) + attrs(pageHidden) + pageHtml.slice(at + from.length);
}

export function renderComposedVariantPreview(
  input: ComposedVariantPreviewInput,
): ComposedVariantPreview | null {
  const design = getFunnelDesign(input.variant.funnel_design_id);
  // C5 + DEV-58 draft substitution — the resolver consumes strings exactly as
  // serve does; the stored columns are never written.
  const composition = resolveFrameComposition(
    {
      frame_config_json:
        input.draftFrameConfig === undefined
          ? input.funnel.frame_config_json
          : input.draftFrameConfig === null
            ? null
            : JSON.stringify(input.draftFrameConfig),
      theme_json:
        input.draftTheme === undefined
          ? input.funnel.theme_json
          : input.draftTheme === null
            ? null
            : JSON.stringify(input.draftTheme),
      frame_overrides_json:
        input.draftFrameOverrides === undefined
          ? input.variant.frame_overrides_json
          : input.draftFrameOverrides === null
            ? null
            : JSON.stringify(input.draftFrameOverrides),
      saved_template_defaults: input.savedTemplateDefaults ?? null,
    },
    design,
    input.themeRecord ?? null,
  );
  // Phase-A contract: a mode-less call still reports "no composed frame".
  if (composition === null && input.mode === undefined) return null;

  const resolvedSections: ResolvedFunnelSection[] = input.sections.map((section, index) => ({
    position: index,
    section,
  }));
  const effectiveDesign = composition === null ? design : composition.effectiveTokens.design;
  const scope = `[${FUNNEL_DESIGN_SCOPE_ATTR}="${design.id}"]`;
  const css =
    composition === null
      ? funnelChromeCss(design, scope)
      : funnelChromeCss(composition.effectiveTokens.design, scope, { frameRegions: true });
  // The same §15.4 config echo the legacy preview carries — over the EFFECTIVE
  // design tokens on the frame path, exactly like the served shell (09 §9.2).
  const config: LeadgenPublicConfig = buildPublicConfig(
    buildPreviewResolved(input.quote, input.funnel, input.variant, input.sections),
    effectiveDesign as FunnelDesign,
  );

  // ONE body renderer for every mode: renderQuoteFrame when a frame resolves,
  // the byte-pinned legacy shell otherwise (the same §13.1 serve fork).
  const renderBody = (sectionsHtml: string, step: number): string => {
    if (composition === null) {
      return renderLegacyShell({
        designId: design.id,
        funnelId: toFunnelId(input.funnel.public_id) as string,
        funnelVariantId: toFunnelVariantId(input.variant.public_id) as string,
        quoteId: input.quote.public_id,
        contentVersion: input.variant.content_version,
        sectionsHtml,
        bannersMountHtml: LG_BANNERS_MOUNT_HTML,
      });
    }
    const page = renderQuoteFrame({
      effectiveTokens: composition.effectiveTokens,
      frame: composition.frame,
      siteBranding: input.siteBranding ?? null,
      // Round-4 P5b (10B admin leg, conductor-granted): the no-logo hint
      // (frame.ts renderNoLogoHint, [data-admin-preview-hint="1"]) is gated
      // behind adminPreview — PASSED THROUGH from the caller (see
      // ComposedVariantPreviewInput.adminPreview's doc comment), never
      // hardcoded, so this function's OTHER caller (the byte-parity test)
      // keeps its live-serve-identical contract when it omits the flag.
      adminPreview: input.adminPreview === true,
      siteSettingsHref: input.siteSettingsHref ?? null,
      sectionsHtml,
      bannersMountHtml: LG_BANNERS_MOUNT_HTML,
      sectionCount: input.sections.length,
      root: {
        funnelId: toFunnelId(input.funnel.public_id),
        funnelVariantId: toFunnelVariantId(input.variant.public_id),
        quoteId: input.quote.public_id,
        contentVersion: input.variant.content_version,
      },
    });
    return setFrameFooterVisibility(
      advanceFrameProgress(page, composition.frame, effectiveDesign as FunnelDesign, step, input.sections.length),
      composition.frame,
      step,
      input.sections.length,
    );
  };

  if (input.mode === "frame") {
    // Slot placeholder instead of the section list — the frame-only canvas.
    return {
      css,
      html: renderBody(LG_SLOT_PLACEHOLDER_HTML, 1),
      section_count: input.sections.length,
      config,
    };
  }

  // v3.1 §7/§12 (adversarial review MAJOR-1): thread the resolved theme_
  // controls into the composed-variant preview's sectionCtx too — the SAME
  // resolveTokens output the live /lg path now feeds (serve.ts renderFunnel
  // Shell), so "runtime, quote preview, and section-in-frame preview share
  // identical resolution" holds for the §7 field-size tier as well.
  const allSectionsHtml = renderVariantSectionsHtml(
    resolvedSections,
    effectiveDesign,
    composition === null ? null : composition.frame,
    composition === null ? undefined : composition.effectiveTokens.theme_controls,
  );

  if (input.mode === "all") {
    // Phase D stepper perf (additive): `page` asks for ONE composed step —
    // render it lazily instead of composing every page. Clamped like
    // visibleIndex below; page-less calls keep the eager pages[] byte-shape.
    if (input.page !== undefined) {
      const step = Math.min(
        Math.max(1, Math.round(input.page)),
        Math.max(input.sections.length, 1),
      );
      return {
        css,
        html: renderBody(toggleVisibleSection(allSectionsHtml, input.sections, step - 1), step),
        page: step,
        section_count: input.sections.length,
        config,
      };
    }
    // One composed document per Section: section k visible, progress at step
    // k of N — the §4.1 "step through all slides" mode.
    return {
      css,
      pages: input.sections.map((_, index) =>
        renderBody(toggleVisibleSection(allSectionsHtml, input.sections, index), index + 1),
      ),
      section_count: input.sections.length,
      config,
    };
  }

  // mode "section" (and the Phase-A mode-less default): the full composed
  // body with the chosen Section visible. Index 0 — the default — applies
  // ZERO toggling and step-1 progress, so it stays BYTE-IDENTICAL to the
  // runtime shell body for the same inputs (13 §13.5 leg 1).
  const index = Math.min(
    Math.max(input.visibleIndex ?? 0, 0),
    Math.max(input.sections.length - 1, 0),
  );
  return {
    css,
    html: renderBody(toggleVisibleSection(allSectionsHtml, input.sections, index), index + 1),
    section_count: input.sections.length,
    config,
  };
}

// ---------------------------------------------------------------------------
// The §13.4 composed preview route branch (previewVariantHandler dispatches
// here when the body carries ANY v2.5 key). Response: {preview:{css, html |
// pages, section_count}, config} + additive `problems` warnings (§3.6).
// ---------------------------------------------------------------------------

const PREVIEW_MODES = ["frame", "section", "all"] as const;
type PreviewMode = (typeof PREVIEW_MODES)[number];
const PREVIEW_VIEWPORTS = ["desktop", "mobile"] as const;

async function composedVariantPreviewResponse(
  c: AdminContext,
  owner: { funnel: LeadgenFunnelRow; quote: LeadgenQuoteRow },
  variant: LeadgenFunnelVariantRow,
  body: Record<string, unknown>,
): Promise<Response> {
  const fields: FieldErrors = {};
  const problems: Problem[] = [];

  // mode — default "section" (the current-slide canvas render).
  let mode: PreviewMode = "section";
  if (body["mode"] !== undefined) {
    const raw = body["mode"];
    if (typeof raw !== "string" || !(PREVIEW_MODES as readonly string[]).includes(raw)) {
      fields["mode"] = `mode must be one of ${PREVIEW_MODES.join("|")}`;
    } else {
      mode = raw as PreviewMode;
    }
  }

  // viewport — accepted + validated for the §13.4 body shape; css/html are
  // viewport-invariant (the builder iframes the real 1280/375 widths, §8.9).
  if (body["viewport"] !== undefined) {
    const raw = body["viewport"];
    if (typeof raw !== "string" || !(PREVIEW_VIEWPORTS as readonly string[]).includes(raw)) {
      fields["viewport"] = `viewport must be one of ${PREVIEW_VIEWPORTS.join("|")}`;
    }
  }

  // draft_frame_config / draft_theme (C5 preview-before-apply): validated up
  // front so the template picker gets path-precise §3.6 problems instead of a
  // silent legacy fallback. Error severity → 400; warnings ride the response
  // and never block the render (14 §14.3 severity split).
  let draftFrameConfig: Record<string, unknown> | null | undefined;
  if (body["draft_frame_config"] !== undefined) {
    const raw = body["draft_frame_config"];
    if (raw === null) {
      draftFrameConfig = null;
    } else if (!isRecord(raw)) {
      fields["draft_frame_config"] = "draft_frame_config must be a JSON object or null";
    } else {
      const v = validateFrameConfig(raw);
      problems.push(...v.problems);
      if (v.config !== null) draftFrameConfig = raw;
    }
  }
  let draftTheme: Record<string, unknown> | null | undefined;
  if (body["draft_theme"] !== undefined) {
    const raw = body["draft_theme"];
    if (raw === null) {
      draftTheme = null;
    } else if (!isRecord(raw)) {
      fields["draft_theme"] = "draft_theme must be a JSON object or null";
    } else {
      const v = validateTheme(raw);
      problems.push(...v.problems);
      if (v.theme !== null) draftTheme = raw;
    }
  }

  // draft_frame_overrides (DEV-58, Phase D): validated EXACTLY like the stored
  // column (PUT /variants/:id frame_overrides_json) — template/version are
  // funnel-level and rejected, the frame groups go through
  // validateFrameConfig-over-sparse, the `theme` part through validateTheme.
  // Render-only: nothing persists. Errors → 400 + problems; warnings ride.
  let draftFrameOverrides: Record<string, unknown> | null | undefined;
  if (body["draft_frame_overrides"] !== undefined) {
    const raw = body["draft_frame_overrides"];
    if (raw === null) {
      draftFrameOverrides = null;
    } else if (!isRecord(raw)) {
      fields["draft_frame_overrides"] = "draft_frame_overrides must be a JSON object or null";
    } else {
      // The stored PUT's assignment idiom, mirrored locally: collect THIS
      // key's problems and assign the draft only when NONE is an error — the
      // raw is never held as a schema-invalid draft. (The shared error gate
      // below 400s the request in exactly those cases, so behavior is
      // unchanged; this keeps the validity local and non-accidental instead
      // of leaning on that distant gate.)
      const overridesProblems: Problem[] = [];
      for (const funnelLevelKey of ["template", "version"] as const) {
        if (raw[funnelLevelKey] !== undefined) {
          overridesProblems.push({
            path: `frame_overrides.${funnelLevelKey}`,
            scope: "frame",
            severity: "error",
            message:
              funnelLevelKey === "template"
                ? "Variant overrides can't switch the funnel-layout template — the template is a funnel-level setting (change it in the funnel's layout settings)."
                : "Variant overrides can't carry a version field — it belongs to the funnel-level layout settings.",
          });
        }
      }
      const { theme: themePart, ...frameParts } = raw;
      overridesProblems.push(...validateFrameConfig(frameParts).problems);
      if (themePart !== undefined) {
        if (!isRecord(themePart)) {
          overridesProblems.push({
            path: "theme",
            scope: "theme",
            severity: "error",
            message: "The variant theme overrides must be a group of palette colours.",
          });
        } else {
          overridesProblems.push(...validateTheme(themePart).problems);
        }
      }
      problems.push(...overridesProblems);
      if (!overridesProblems.some((p) => p.severity === "error")) draftFrameOverrides = raw;
    }
  }

  // `page` (Phase D stepper perf): a 1-based step for the mode:"all" lazy
  // per-page protocol. Type errors → 400; range clamps like visibleIndex.
  let page: number | undefined;
  if (body["page"] !== undefined && body["page"] !== null) {
    const raw = body["page"];
    if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1) {
      fields["page"] = "page must be a positive integer (1-based step)";
    } else if (mode !== "all") {
      fields["page"] = 'page is only valid with mode:"all"';
    } else {
      page = raw;
    }
  }

  const siteIdRaw = body["site_id"];
  if (siteIdRaw !== undefined && siteIdRaw !== null) {
    if (typeof siteIdRaw !== "string" || siteIdRaw.trim() === "") {
      fields["site_id"] = "site_id must be a site id string";
    }
  }

  // R2 §3 ② — `sample_section` (additive, boolean): with NO sections of its
  // own this variant renders the synthetic sample row INSIDE the composed
  // frame (see buildSamplePreviewSection). Ignored when the variant HAS
  // sections — a real section always wins over the sample.
  let sampleSection = false;
  if (body["sample_section"] !== undefined && body["sample_section"] !== null) {
    const raw = body["sample_section"];
    if (typeof raw !== "boolean") {
      fields["sample_section"] = "sample_section must be a boolean";
    } else {
      sampleSection = raw;
    }
  }

  if (Object.keys(fields).length > 0) {
    return c.json({ error: "Validation failed", fields }, 400);
  }
  if (problems.some((p) => p.severity === "error")) {
    return c.json({ error: "Validation failed", problems }, 400);
  }

  // R2 P3 BLOCKER FIX (leg 3 of 3): the SAME saved-template row the live serve
  // path resolves (resolver.ts resolveSavedFrameTemplateDefaultsFor), read here
  // through this file's own local loader with the IDENTICAL precedence —
  // variant.frame_template_id ?? funnel.frame_template_id ?? the per-quote
  // default. One row read per composed preview, degrading to null exactly like
  // the live path (deleted/corrupt row, pre-0055 schema). Resolved BEFORE the
  // site_id branch because the picks lookup below needs it too: a saved
  // template's picked link_row must resolve against the preview site's Pages
  // the same way the served page does.
  const previewSavedTemplateDefaults = await loadSavedFrameTemplateDefaults(
    c.env.DB,
    variant.frame_template_id ?? owner.funnel.frame_template_id,
    owner.quote.public_id,
  );

  // site_id (C4): ANY CMS site is legal — branding is read-only site_settings
  // data; previewing under a site's branding needs NO activation and creates
  // none. Unknown site → 404.
  let siteBranding: SiteBranding | null = null;
  // Rework §8.8 (follow-up round): the SAME SITE_SETTINGS_LINK(siteId) helper
  // this file's own activation-preflight "fix_url" already uses (below) — no
  // new URL invented. Only ever set when a real site_id resolved.
  let siteSettingsHref: string | null = null;
  if (typeof siteIdRaw === "string" && siteIdRaw.trim() !== "") {
    const siteId = siteIdRaw.trim();
    const site = await c.env.DB.prepare("SELECT id FROM sites WHERE id = ? LIMIT 1")
      .bind(siteId)
      .first<{ id: string }>();
    if (site === null) return c.json({ error: "Not Found" }, 404);
    // R2 P3 (element J) D2 — this IS the draft-aware preview render, so the
    // picks lookup must see the SAME draft substitution renderComposedVariantPreview
    // applies moments later (draft_frame_config/draft_frame_overrides over
    // the stored columns) — otherwise picking "From Pages" and previewing
    // before Save would resolve against the STALE stored footer instead of
    // what is about to render.
    const previewFrame = resolveEffectiveFrameOnly({
      frame_config_json: draftFrameConfig === undefined ? owner.funnel.frame_config_json : draftFrameConfig === null ? null : JSON.stringify(draftFrameConfig),
      theme_json: owner.funnel.theme_json,
      frame_overrides_json: draftFrameOverrides === undefined ? variant.frame_overrides_json : draftFrameOverrides === null ? null : JSON.stringify(draftFrameOverrides),
      // R2 P3 BLOCKER FIX: without this a template-seeded funnel resolved NO
      // frame here, so footerLegalPagePicks saw nothing and the canvas fell
      // back to the site's own legal_links instead of the template's picks.
      saved_template_defaults: previewSavedTemplateDefaults,
    });
    siteBranding = await resolveSiteBranding(c.env.DB, siteId, footerLegalPagePicks(previewFrame));
    siteSettingsHref = SITE_SETTINGS_LINK(siteId);
  }

  // Ordered sections — §4.3-11 parity fix (conductor addendum round): the
  // quote's shared first page FIRST, then this variant's own pages, EXACTLY
  // the composeResolvedBundle order the live serve path uses (resolver.ts) —
  // preview and serve must stay byte-parity twins. loadSharedPages is fail-
  // safe on a pre-M2 DB (no quote_id column) and returns [] for a legacy quote
  // with no shared page, so this is byte-identical to the prior variant-only
  // read in that case (the SAME loadVariantPages call this handler already
  // made via readVariantSections's underlying table, now read through the
  // canonical page/slot loader instead of the flat admin-only projection).
  let sharedPages: ResolvedFunnelPage[] = [];
  try {
    sharedPages = await loadSharedPages(c.env.DB, owner.quote.id);
  } catch {
    sharedPages = [];
  }
  const variantPages = await loadVariantPages(c.env.DB, variant.id);
  const storedSections: LeadgenSectionRow[] = sectionsFromPages([...sharedPages, ...variantPages]).map((rs) => rs.section);
  // R2 §3 ② — ONE preview path: an EMPTY funnel composes the SAMPLE section
  // inside the real frame instead of falling back to a second, frameless
  // endpoint. `usingSample` rides the response so the caller can say so.
  const usingSample = sampleSection && storedSections.length === 0;
  const sections: LeadgenSectionRow[] = usingSample
    ? [buildSamplePreviewSection(owner.quote, variant)]
    : storedSections;

  // section_public_id → the visible ordered index (mode:"section").
  let visibleIndex = 0;
  if (body["section_public_id"] !== undefined && body["section_public_id"] !== null) {
    const raw = body["section_public_id"];
    const at = typeof raw === "string" ? sections.findIndex((s) => s.public_id === raw.trim()) : -1;
    if (at === -1) {
      return c.json(
        {
          error: "Validation failed",
          fields: { section_public_id: "section_public_id is not a section of this variant" },
        },
        400,
      );
    }
    visibleIndex = at;
  }

  // v3.1 §10.1/§12 (fix round): resolve the WINNING theme_id (winningThemeId)
  // over the SAME effective theme_json/frame_overrides_json the renderer
  // itself substitutes (draftTheme/draftFrameOverrides win when given,
  // undefined falls back to the stored column, null means "nothing") — one KV
  // read, hoisted here since renderComposedVariantPreview stays synchronous.
  // "quote preview... share[s] identical resolution" with the live path.
  const effectiveThemeJsonForTheme: unknown =
    draftTheme === undefined ? parseJsonColumn(owner.funnel.theme_json ?? null) : draftTheme;
  const effectiveOverridesForTheme: unknown =
    draftFrameOverrides === undefined ? parseJsonColumn(variant.frame_overrides_json ?? null) : draftFrameOverrides;
  const winningId = winningThemeId(effectiveThemeJsonForTheme, effectiveOverridesForTheme);
  const themeRecord: ThemeRecord | null = winningId !== null ? await getThemeRecord(c.env.CACHE, winningId) : null;

  const preview = renderComposedVariantPreview({
    quote: owner.quote,
    funnel: owner.funnel,
    variant,
    sections,
    siteBranding,
    mode,
    visibleIndex,
    draftFrameConfig,
    draftTheme,
    draftFrameOverrides,
    page,
    themeRecord,
    // Round-4 P5b (10B admin leg, conductor-granted): this IS the real admin
    // builder/Templates preview route — the one caller that should show the
    // no-logo hint (see ComposedVariantPreviewInput.adminPreview's comment).
    adminPreview: true,
    // Rework §8.8 (follow-up round): the previewed site's real Site-settings
    // admin URL, when a site_id was given (null when none was — no fabricated
    // href).
    siteSettingsHref,
    // R2 P3 BLOCKER FIX (leg 3 of 3): same saved template the live serve path
    // composes from — the Templates canvas and /lg now render one truth.
    savedTemplateDefaults: previewSavedTemplateDefaults,
  });
  // With `mode` set the renderer never yields null (legacy funnels compose
  // through the pinned legacy shell) — this guard is type narrowing only.
  if (preview === null) return c.json({ error: "preview render failed" }, 500);

  const payload: Record<string, unknown> = {
    preview:
      mode === "all"
        ? page !== undefined
          ? // Phase D lazy leg: ONE composed page + its clamped step echo —
            // the island stepper fetches per step for long funnels.
            {
              css: preview.css,
              html: preview.html ?? "",
              page: preview.page ?? 1,
              section_count: preview.section_count,
            }
          : { css: preview.css, pages: preview.pages ?? [], section_count: preview.section_count }
        : { css: preview.css, html: preview.html ?? "", section_count: preview.section_count },
    config: preview.config,
  };
  // R2 §3 ② — honest echo: TRUE only when the composed body carries the
  // synthetic sample row (an empty funnel that opted in), so the canvas can
  // label it without guessing from section_count.
  if (usingSample) payload["sample_section"] = true;
  if (problems.length > 0) payload["problems"] = problems; // §3.6 additive warnings
  return c.json(payload);
}

// ---------------------------------------------------------------------------
// v2.5 03 §3.1 — the frame/theme cache-propagation helper. Saving a funnel's
// frame_config_json/theme_json MUST bump `content_version` on every ACTIVE
// variant of that funnel: the existing shell/config cache keys + ETags already
// carry the content_version axis, so the bump is what makes a frame/theme edit
// reach visitors (NO new cache axis). The Phase-B PUT /funnels/:id/frame|theme
// routes call this after a successful persist. Returns the bumped-row count.
// ---------------------------------------------------------------------------

export async function bumpActiveVariantContentVersions(
  db: D1Database,
  funnelId: number,
): Promise<number> {
  const result = await db
    .prepare(
      "UPDATE leadgen_funnel_variants SET content_version = content_version + 1 WHERE funnel_id = ? AND status = 'active'",
    )
    .bind(funnelId)
    .run();
  return Number(result.meta?.changes ?? 0);
}

// ---------------------------------------------------------------------------
// GET /quotes/:id/structure — the full builder tree (§15.3)
// funnel_id (lgf_) ≠ funnel_variant_id (lgn_) stamped on every node (G4).
// ---------------------------------------------------------------------------

export async function quoteStructureHandler(c: AdminContext): Promise<Response> {
  const quote = await resolveQuoteRow(c.env.DB, c.req.param("id") ?? "");
  if (quote === null) return c.json({ error: "Not Found" }, 404);

  const funnels = await readQuoteFunnels(c.env.DB, quote.id);
  // PERFORMANCE (owner-reported ~10 s per funnel-builder action): this endpoint
  // measured 2.4 s of the editor page's 8.5-8.9 s in production, for 18 D1
  // queries and almost no CPU — it awaited each read one at a time, per funnel
  // and then per variant, so the page paid the SUM of every round trip.
  //
  // ROUND 2 (measured by driving the owner's real quote in production: 2 funnels,
  // 16 pages, this endpoint 1,438 ms and, once the preflight came off the
  // critical path, the thing the page waits for): the per-funnel reads are now
  // set reads. Variants and A/B tests for ALL funnels come back in two
  // statements instead of one per funnel, and the ACTIVE set is a filter of the
  // rows already in hand rather than a third query per funnel. Same rows, same
  // ORDER BY, same per-funnel grouping. Ids are bound parameters, chunked at 80
  // per statement (d1-database-safety: the 100-binding ceiling).
  const funnelIds = funnels.map((f) => f.id);
  const idChunks: number[][] = [];
  for (let i = 0; i < funnelIds.length; i += 80) idChunks.push(funnelIds.slice(i, i + 80));
  const [variantRows, abTestRows] = await Promise.all([
    Promise.all(
      idChunks.map(async (ids) =>
        (
          await c.env.DB.prepare(
            `SELECT * FROM leadgen_funnel_variants WHERE funnel_id IN (${ids.map(() => "?").join(",")}) ORDER BY variant_label ASC, id ASC`,
          )
            .bind(...ids)
            .all<LeadgenFunnelVariantRow>()
        ).results ?? [],
      ),
    ).then((parts) => parts.flat()),
    Promise.all(
      idChunks.map(async (ids) =>
        (
          await c.env.DB.prepare(
            `SELECT * FROM leadgen_funnel_ab_tests WHERE funnel_id IN (${ids.map(() => "?").join(",")}) ORDER BY id DESC`,
          )
            .bind(...ids)
            .all<LeadgenFunnelAbTestRow>()
        ).results ?? [],
      ),
    ).then((parts) => parts.flat()),
  ]);
  const variantsByFunnel = new Map<number, LeadgenFunnelVariantRow[]>();
  for (const v of variantRows) {
    const list = variantsByFunnel.get(v.funnel_id) ?? [];
    list.push(v);
    variantsByFunnel.set(v.funnel_id, list);
  }
  const abTestsByFunnel = new Map<number, LeadgenFunnelAbTestRow[]>();
  for (const ab of abTestRows) {
    const list = abTestsByFunnel.get(ab.funnel_id) ?? [];
    list.push(ab);
    abTestsByFunnel.set(ab.funnel_id, list);
  }
  // The reads now overlap; `Promise.all` over `.map` preserves array order, so
  // the emitted tree is identical (verified by byte-comparing this endpoint's
  // whole JSON body before/after).
  const funnelTree: Record<string, unknown>[] = await Promise.all(
    funnels.map(async (funnel) => {
    const variants = variantsByFunnel.get(funnel.id) ?? [];
    const abTests = abTestsByFunnel.get(funnel.id) ?? [];
    const variantTree: Record<string, unknown>[] = await Promise.all(
      variants.map(async (variant) => {
      const [sections, rules] = await Promise.all([
        readVariantSections(c.env.DB, variant.id),
        readVariantRules(c.env.DB, variant.id),
      ]);
      // G4 identity proof: assemble a proven-distinct triple through the
      // Stage-A branded constructors (funnel_id ≠ funnel_variant_id, never
      // aliased). Throws only if the two ever collide — they cannot.
      const identity = resolveFunnelIdentity(quote.public_id, funnel.public_id, variant.public_id);
      return {
        ...variantRowToApi(variant),
        funnel_id: identity.funnel_id as string,
        funnel_variant_id: identity.funnel_variant_id as string,
        sections,
        rules: rules.map(ruleRowToApi),
        auction_entry_position: auctionEntryPosition(sections),
      };
      }),
    );
    // P3b (§8.2 board): the funnel column renders the ACTIVE variant's PAGES as
    // section-chip cards. With no running test a funnel has exactly one active
    // variant (M1 replacement semantics); the deterministic primary is the
    // variant_label-ASC head of readActiveFunnelVariants. `active_variant_pages`
    // is ADDITIVE — the flat per-variant `sections` projection above is
    // untouched, so every pre-P3b consumer reads exactly what it always did.
    const activeVariants = variants.filter((v) => v.status === "active");
    const primaryActive = activeVariants[0] ?? variants[0] ?? null;
    return {
      ...funnelRowToApi(funnel),
      funnel_id: toFunnelId(funnel.public_id) as string,
      variants: variantTree,
      // §16 A/B tests for this funnel (newest first); the running one (0..1)
      // drives the A/B tab's start/stop + the §16.2 assignment preview.
      ab_tests: abTests.map(abTestRowToApi),
      active_variant_public_id: primaryActive?.public_id ?? null,
      active_variant_pages: primaryActive === null ? [] : await readVariantPagesApi(c.env.DB, primaryActive.id),
    };
    }),
  );

  // P3b follow-up (§8.2 board, DEV-59 parity): batch-attach each page-slot
  // candidate's mapping_status — ONE query across every funnel's pages rather
  // than N+1 — then strip the internal section_num_id carrier pageToApi added.
  const allPages: Record<string, unknown>[] = [];
  for (const f of funnelTree) {
    const pages = (f as { active_variant_pages?: unknown }).active_variant_pages;
    if (Array.isArray(pages)) allPages.push(...(pages as Record<string, unknown>[]));
  }
  const candidateIds = collectCandidateSectionIds(allPages);
  const statusMap = await sectionMappingStatusMap(c.env.DB, candidateIds);
  attachMappingStatusToPages(allPages, statusMap);

  return c.json({
    quote: { ...quoteRowToApi(quote), quote_id: toQuoteId(quote.public_id) as string },
    funnels: funnelTree,
    // P3b (§4.3-1 / §8.2 board): the quote-owned shared first page (or null) —
    // ADDITIVE top-level key the pinned "Shared first page" column renders.
    shared_page: await sharedPageJson(c.env.DB, quote),
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

  // §8.7 ("routed_to_funnel and feed_name join the drilldown dimensions") —
  // the SAME breakdown shape as by_site/by_traffic_source, just above, over
  // the migration-0054 columns. routed_to_funnel/feed_name read "" (never
  // fabricated) until mirror-sync.ts's CH-side column mapping + the
  // ops-owned ClickHouse DDL land (see 0054's own note) — an honest "no
  // routing rule matched yet" state, not a broken one.
  const byRoutedFunnel = await c.env.DB.prepare(
    `SELECT routed_to_funnel, SUM(views) AS views, SUM(clicks) AS clicks, SUM(conversions) AS conversions, SUM(revenue) AS revenue
     FROM leadgen_analytics_quote_drilldown
     WHERE quote_public_id = ? AND date BETWEEN ? AND ?
     GROUP BY routed_to_funnel ORDER BY routed_to_funnel ASC`,
  )
    .bind(quote.public_id, range.from, range.to)
    .all<{ routed_to_funnel: string | null; views: number | null; clicks: number | null; conversions: number | null; revenue: number | null }>();

  const byFeedName = await c.env.DB.prepare(
    `SELECT feed_name, SUM(views) AS views, SUM(clicks) AS clicks, SUM(conversions) AS conversions, SUM(revenue) AS revenue
     FROM leadgen_analytics_quote_drilldown
     WHERE quote_public_id = ? AND date BETWEEN ? AND ?
     GROUP BY feed_name ORDER BY feed_name ASC`,
  )
    .bind(quote.public_id, range.from, range.to)
    .all<{ feed_name: string | null; views: number | null; clicks: number | null; conversions: number | null; revenue: number | null }>();

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
        by_routed_funnel: byRoutedFunnel.results ?? [],
        by_feed_name: byFeedName.results ?? [],
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
  //
  // PERFORMANCE (owner-reported ~10 s per funnel-builder action): recomputing
  // this verdict costs 23 D1 round trips - measured, the single most expensive
  // thing the quote editor renders, and the board reloads the whole page after
  // every add-section / add-page. Every variant save already RECOMPUTES and
  // STORES the verdict in KV (storeVariantPreflight), and the board repaints the
  // banner from that save's response, so the stored copy is current for every
  // action the operator takes on this page.
  // `?preflight=stored` therefore serves the stored verdict (one KV read) and
  // falls back to a full compute when nothing is stored yet. It is ADVISORY
  // only: PUT /quotes/:id/activation/:site_id recomputes from scratch, so a
  // stale banner can never let a broken quote publish.
  const wantStored = (c.req.query("preflight") ?? "") === "stored";
  const variantHint = (c.req.query("variant") ?? "").trim();
  if (wantStored && variantHint !== "") {
    // Anything that is not a usable stored verdict falls through to the real
    // computation: no KV binding at all (the unit harness has none - this threw
    // "c.env.CACHE.get is not a function" and took five Activation-panel tests
    // with it), a miss, or an unparseable value. The fast path is an
    // optimisation, never a behaviour change.
    try {
      const kv = (c.env as { CACHE?: { get?: (k: string) => Promise<string | null> } }).CACHE;
      const raw = typeof kv?.get === "function" ? await kv.get(preflightKvKey(variantHint)) : null;
      if (raw !== null && raw !== undefined) {
        const stored = JSON.parse(raw) as QuoteActivationPreflight;
        return c.json({ quote_id: quote.public_id, sites, activation_preflight: stored });
      }
    } catch {
      // fall through to the real computation
    }
  }
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
  // v2.5 14 §14.1 (C2 LIVE since Phase D): the ADDITIVE 03 §3.6 problems
  // projection — every new frame/theme/branding/chrome check row rides here
  // with its contract severity. `ok` stays keyed to `blocks` ONLY (the
  // historical report input, byte-shape pinned); the activation PUT's 409
  // gate fires on (blocks) OR (any error-severity problem) — see
  // putActivationHandler. Warnings never block. A legacy Quote (NULL
  // frame/theme/overrides) yields [] (14 §14.4).
  problems: Problem[];
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
    // Round-4 P7: the dependency universe is the SHARED expanded answer-field
    // set (content-schema.ts collectKnownAnswerFields) — the SAME enumerator
    // save-time validateSectionContent uses. It walks the raw tree itself and
    // expands MQG rows (props.rows[].internal_field), Address role sub-fields,
    // and NameFieldsGroup fields — none of which carry a top-level
    // internal_field, so the prior "collect each flattened node's OWN
    // internal_field" loop never saw them and wrongly flagged a rule referencing
    // one as a missing dependency at activation. Accumulated across ALL active
    // sections (the variant-wide field space).
    for (const f of collectKnownAnswerFields(topLevel)) knownFields.add(f);
  }

  for (const s of activeSections) {
    const content = contentRows.get(s.section_id);
    if (content === undefined) continue;

    // §5.2 "a dependency references a missing field" — the shared conditional
    // shape {when, op, …} over the VARIANT's internal-field space.
    for (const node of componentsBySection.get(s.section_id) ?? []) {
      // Round-4 P7: a `conditional` may be a BARE {when,op,…} OR a composed
      // {match,conditions:[…]} group (A-4 / P2). conditionalFieldRefs
      // (content-schema.ts) yields EVERY `when` reference across both shapes
      // (recursively, nested groups included) — the SAME structural discriminator
      // the runtime evaluator (dependencies.ts isConditionGroup) and the save-time
      // validateConditional use. The prior guard tested only a top-level string
      // `when`, so a composed rule skipped this dependency check ENTIRELY (a
      // second, opposite-direction hole: a group naming a truly-missing field
      // sailed through unblocked). One block per missing reference — byte-identical
      // shape for the bare single-field case.
      for (const when of conditionalFieldRefs(node["conditional"])) {
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
        // H2b: this block's `fields` array renders as literal, joined text on
        // the Activation tab's preflight card (quotes-tabs/activation.ts's
        // renderPreflightBlockCard: `parts.push(...fields.join(", "))`) — a
        // 9th operator-visible site the named list of 7 didn't include, found
        // sweeping this same function for the class. Same register.
        fields: [describeMissingReference("Auction")],
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
  // v2.5 (additive): the activation site in scope, when there is one — the
  // PUT /quotes/:id/activation/:site_id leg threads it so the §14.1
  // site-logo-unresolvable warning can resolve THAT site's branding. The
  // site-agnostic surfaces (GET activation panel, variant-save store) omit it.
  opts?: { site_id?: string | null },
): Promise<QuoteActivationPreflight> {
  const funnels = await readQuoteFunnels(db, quote.id);
  let firstFunnelId = "";
  let firstVariantId = "";
  const blocks: QuoteActivationBlock[] = [];
  const problems: Problem[] = [];
  const siteId = opts?.site_id ?? null;

  // PERFORMANCE (owner-reported ~10 s per funnel-builder action). This preflight
  // is the single most expensive thing the quote editor renders: measured in
  // production it is 4.5-4.9 s of the page's 8.5-8.9 s, for 24 D1 queries and
  // ~20 ms of CPU. Every query is a round trip (~30-100 ms measured), and these
  // loops awaited them one at a time, per funnel and then per variant, so the
  // cost was the SUM of every hop.
  //
  // The READS now overlap; the ASSEMBLY below is still strictly sequential in
  // the original order, so `blocks`, `problems`, `firstFunnelId` and
  // `firstVariantId` come out exactly as before (verified by byte-comparing this
  // endpoint's whole JSON body before/after). Nothing about WHAT is checked
  // changes — only how long the page waits for it.
  const activeFunnels = funnels.filter((f) => f.status === "active");
  const [perFunnel, reworkProblems] = await Promise.all([
    Promise.all(
      activeFunnels.map(async (funnel) => {
        // M5: no variant is in scope yet — precedence collapses to
        // funnel.frame_template_id alone.
        const [variants, savedFrameDefaults] = await Promise.all([
          readActiveFunnelVariants(db, funnel.id),
          loadSavedFrameTemplateDefaults(db, funnel.frame_template_id, quote.public_id),
        ]);
        const funnelState = readFunnelV25State(funnel, savedFrameDefaults);
        // v2.5 14 §14.1: the additive problems projection (funnel-level rows
        // once, variant-level rows per active variant). NEVER touches
        // `blocks`/`ok` (the historical report inputs); the activation PUT gates
        // on blocks OR error-severity problems (C2 LIVE, Phase D).
        const [funnelProblems, perVariant] = await Promise.all([
          computeFunnelV25Problems(db, quote, funnel, funnelState, siteId),
          Promise.all(
            variants.map(async (variant) => {
              const [variantBlocks, variantProblems] = await Promise.all([
                computeVariantPreflightBlocks(db, variant),
                computeVariantV25Problems(db, quote, funnel, funnelState, variant),
              ]);
              return { variant, variantBlocks, variantProblems };
            }),
          ),
        ]);
        return { funnel, variants, funnelProblems, perVariant };
      }),
    ),
    // Rework §4.3-15: the additional activation checks (default funnel, shared
    // page, per-funnel sections, enabled-rule targets, §4.3-13 uniqueness) ride
    // as error-severity problems so the PUT gate blocks on them (same as the
    // existing §14.1 error problems). A legacy quote (no shared page / no
    // default funnel) REPORTS the missing pieces here rather than 500ing
    // (L-192 seam). Independent of the per-funnel work above, so it overlaps it.
    computeReworkActivationProblems(db, quote),
  ]);

  for (const entry of perFunnel) {
    problems.push(...entry.funnelProblems);
    for (const v of entry.perVariant) {
      if (v.variantBlocks.length > 0 && firstVariantId === "") {
        firstFunnelId = entry.funnel.public_id;
        firstVariantId = v.variant.public_id;
      }
      blocks.push(...v.variantBlocks);
      problems.push(...v.variantProblems);
    }
    if (firstFunnelId === "" && entry.variants.length > 0) {
      firstFunnelId = entry.funnel.public_id;
      firstVariantId = entry.variants[0]?.public_id ?? "";
    }
  }
  problems.push(...reworkProblems);
  return {
    ok: blocks.length === 0,
    quote_id: quote.public_id,
    funnel_id: firstFunnelId,
    funnel_variant_id: firstVariantId,
    blocks,
    computed_at: now,
    problems,
  };
}

// Rework §4.3-15 (§4.3-13 folded in) activation checks. Every failed check is
// an error-severity Problem (blocks the PUT via the existing hasBlockingProblems
// gate). Defensively wrapped: on ANY DB error (e.g. a pre-rework schema without
// the M2/M3/M4 columns) it returns [] so the preflight never 500s (L-192) — the
// rework checks simply do not apply to a non-rework schema.
async function computeReworkActivationProblems(db: D1Database, quote: LeadgenQuoteRow): Promise<Problem[]> {
  const out: Problem[] = [];
  const fix = QUOTE_BUILDER_LINK(quote.public_id);
  const mk = (path: string, message: string): Problem => ({ path, scope: "section", severity: "error", message, fix_url: fix });
  try {
    const funnels = await readQuoteFunnels(db, quote.id);
    const activeFunnels = funnels.filter((f) => f.status === "active");
    const sharedIds = await sharedPageSectionIds(db, quote.id); // probes leadgen_funnel_variant_sections.quote_id (rework-only)

    // default funnel set + active (§4.3-15 / §4.3-7).
    const defId = quote.default_funnel_id;
    if (defId === null || defId === undefined) {
      out.push(mk("activation.default_funnel", "Set a default funnel — unmatched visitors need one to enter."));
    } else {
      const df = funnels.find((f) => f.id === defId) ?? null;
      if (df === null || df.status !== "active") {
        out.push(mk("activation.default_funnel", "The default funnel must be an active funnel of this quote."));
      }
    }

    // shared page exists with ≥1 section.
    const sharedPage = await readSharedPageRow(db, quote.id);
    if (sharedPage === null || sharedIds.length === 0) {
      out.push(mk("activation.shared_page", "The shared first page needs at least one section."));
    }

    // every active funnel has ≥1 page with ≥1 section (its active variant).
    const perVariant: Array<{ funnelName: string; ids: number[] }> = [];
    const involved = new Set<number>(sharedIds);
    for (const f of activeFunnels) {
      const variants = await readActiveFunnelVariants(db, f.id);
      let hasSections = false;
      for (const v of variants) {
        const ids = await variantSectionIds(db, v.id);
        perVariant.push({ funnelName: f.funnel_name, ids });
        for (const id of ids) involved.add(id);
        if (ids.length > 0) hasSections = true;
      }
      if (variants.length === 0 || !hasSections) {
        // Owner-reported deadlock (2026-08-06): with every section sitting on
        // the Shared first page, this blocker said "needs at least one page
        // with a section" and its fix link said "Add a section to this funnel"
        // — but the section PUT then refused the only section there was
        // ("already on the Shared first page … once per funnel"), so the
        // operator was sent in a circle with no reachable next step. The gate
        // itself is RIGHT: driven with it relaxed, a funnel whose only content
        // is the shared page leaves the visitor on a BLANK page after Continue
        // (the auction fires, nothing renders). So the requirement stands and
        // the message now states it: a funnel needs a section of its OWN.
        // The advice this used to carry ("one that is not already on the Shared
        // first page") described the once-per-funnel rule, which the owner
        // retired on 2026-08-09 — reusing the shared page's section inside the
        // funnel is now a legal way to satisfy this gate, so the sentence must
        // not send the operator looking for a different section.
        out.push(mk(`activation.funnel.${f.public_id}`, `Funnel '${f.funnel_name}' needs at least one page with a section.`));
      }
    }

    // every ENABLED rule's target funnel is active.
    const rules = await readQuoteRoutingRules(db, quote.id);
    for (const r of rules) {
      if (r.status !== "active" || r.target_funnel_id === null) continue;
      const tf = funnels.find((f) => f.id === r.target_funnel_id) ?? null;
      if (tf === null || tf.status !== "active") {
        out.push(mk(`activation.rule.${r.public_id}`, `Rule '${r.rule_name}' targets a funnel that is not active.`));
      }
    }

    // §4.3-13 uniqueness is NOT re-checked here — see the OWNER RULING
    // (2026-08-09) recorded at the variant PUT: a section may appear more than
    // once because slot candidates are chosen per visitor by rules/A-B, so
    // publishing must not block on a repeat either.
  } catch {
    return [];
  }
  return out;
}

// The EXACT normative report (05 §5.2) — its key set is BYTE-PINNED by test.
// Since Phase D the 409 body is this report spread + the additive `problems`
// key (14 §14.2), composed at the putActivationHandler call site so this
// shape never changes.
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

// ---------------------------------------------------------------------------
// v2.5 14 §14.1 — the NEW preflight check rows, COMPUTED here with their
// contract severities and surfaced through the additive `problems[]`
// projection. The existing hard-409 block list is untouched; since Phase D
// (C2 LIVE) the activation PUT ALSO 409s on any error-severity problem
// (warnings never block) with the report + `problems` body (§14.2).
//
// Every check is conditional on the v2.5 data existing (frame_config_json /
// theme_json / frame_overrides_json non-NULL — §14.4 "activating a legacy
// Quote produces zero NEW errors or warnings"; the section-level chrome/
// continue/headline/hex rows require a CONFIGURED frame, exactly like the C2
// chrome block). Schema rows reuse the FROZEN validators (validateFrameConfig
// / validateTheme); the site-logo row reuses resolveSiteBranding; contrast
// reuses resolveTokens + theme.ts contrastRatioAA.
// ---------------------------------------------------------------------------

const QUOTE_BUILDER_LINK = (quotePublicId: string): string =>
  `/admin/leadgen/quotes/${quotePublicId}/edit`;
const SECTION_EDIT_LINK = (sectionPublicId: string): string =>
  `/admin/leadgen/sections/${sectionPublicId}/edit`;
const SITE_SETTINGS_LINK = (siteId: string): string =>
  `/admin/settings?site_id=${encodeURIComponent(siteId)}`;

// The funnel's parsed v2.5 columns, shared by the funnel- and variant-level
// rows below. `frameConfigured` = a non-NULL, JSON-object frame column (the
// §14.4 conditionality switch); `allowSectionChrome` reads the RAW compat flag
// (readable even when another group is schema-invalid).
interface FunnelV25State {
  frameConfigured: boolean;
  rawFrame: Record<string, unknown> | null;
  effectiveFrameConfig: EffectiveFrameConfig | null; // null when schema-invalid
  allowSectionChrome: boolean;
  theme: ThemeJson | null; // validated theme (null when absent/invalid)
}

// Rework M5 (§5, S2.2 follow-up): resolves a saved frame-template row
// (leadgen_frame_templates.frame_json) for readFunnelV25State's 4th
// effectiveFrame arg. A small LOCAL query — this file's own D1 convention
// (mirrors e.g. storeVariantPreflight's inline SELECT a few lines below)
// rather than a cross-layer import of frame-handlers.ts's
// resolveFrameTemplateRow (that module already imports FROM this one; the
// reverse would cycle). NULL ftid or a since-deleted/corrupt row ⇒ null ⇒
// readFunnelV25State omits effectiveFrame's 4th arg ⇒ byte-identical legacy.
//
// R2 D5 (contract §7 D5): the admin-preflight TWIN of resolver.ts's
// resolveSavedFrameTemplateDefaultsFor — same table, same parser, same
// null-degrade — so the preflight's effectiveFrameConfig preview NEVER
// disagrees with what the live page actually serves. `quotePublicId`, when
// given, is consulted ONLY when ftid is null (an explicit variant/funnel ftid
// is NEVER overridden) via the per-quote default (migration 0055); this reads
// nothing extra and writes nothing — no existing funnel is re-templated.
async function loadSavedFrameTemplateDefaults(
  db: D1Database,
  ftid: number | null,
  quotePublicId?: string,
): Promise<EffectiveFrameConfig | null> {
  if (ftid !== null) {
    const row = await db
      .prepare("SELECT frame_json FROM leadgen_frame_templates WHERE id = ? LIMIT 1")
      .bind(ftid)
      .first<{ frame_json: string | null }>();
    return row === null ? null : parseSavedFrameTemplateDefaults(row.frame_json);
  }
  if (quotePublicId === undefined) return null;
  try {
    const row = await db
      .prepare(
        `SELECT ft.frame_json AS frame_json
           FROM leadgen_quote_default_template qdt
           JOIN leadgen_frame_templates ft ON ft.id = qdt.frame_template_id
          WHERE qdt.quote_public_id = ? LIMIT 1`,
      )
      .bind(quotePublicId)
      .first<{ frame_json: string | null }>();
    return row === null ? null : parseSavedFrameTemplateDefaults(row.frame_json);
  } catch {
    return null;
  }
}

function readFunnelV25State(
  funnel: LeadgenFunnelRow,
  savedTemplateDefaults: EffectiveFrameConfig | null = null,
): FunnelV25State {
  const state: FunnelV25State = {
    frameConfigured: false,
    rawFrame: null,
    effectiveFrameConfig: null,
    allowSectionChrome: false,
    theme: null,
  };
  const frameRaw = funnel.frame_config_json;
  if (typeof frameRaw === "string" && frameRaw.trim() !== "") {
    const parsed = parseJsonColumn(frameRaw);
    if (isRecord(parsed)) {
      state.frameConfigured = true;
      state.rawFrame = parsed;
      const compat = parsed["compat"];
      state.allowSectionChrome = isRecord(compat) && compat["allow_section_chrome"] === true;
      const validation = validateFrameConfig(parsed);
      if (validation.config !== null) {
        state.effectiveFrameConfig = effectiveFrame(validation.config, null, null, savedTemplateDefaults).frame;
      }
    }
  }
  const themeRaw = funnel.theme_json;
  if (typeof themeRaw === "string" && themeRaw.trim() !== "") {
    const parsed = parseJsonColumn(themeRaw);
    if (isRecord(parsed)) state.theme = validateTheme(parsed).theme;
  }
  return state;
}

// Funnel-level rows: frame schema (error) · theme schema (error) · trust-strip
// alt (error, dedicated a11y row) · site-logo-unresolvable (warning; only when
// an activation site is in scope).
async function computeFunnelV25Problems(
  db: D1Database,
  quote: LeadgenQuoteRow,
  funnel: LeadgenFunnelRow,
  state: FunnelV25State,
  siteId: string | null,
): Promise<Problem[]> {
  const problems: Problem[] = [];
  const fixQuote = QUOTE_BUILDER_LINK(quote.public_id);

  // --- frame_config_json schema validation (14 §14.1 row 1, error) ----------
  const frameRaw = funnel.frame_config_json;
  if (typeof frameRaw === "string" && frameRaw.trim() !== "") {
    if (state.rawFrame === null) {
      problems.push({
        path: "frame",
        scope: "frame",
        severity: "error",
        message:
          "The funnel's layout has an invalid setting: the stored funnel-layout settings are not readable. Open the Quote Builder and re-save the funnel layout.",
        fix_url: fixQuote,
      });
    } else {
      const validation = validateFrameConfig(state.rawFrame);
      // --- trust-strip logo missing alt (row 12, error — dedicated
      // accessibility copy). The generic schema validation flags the SAME
      // path (`alt` is a required_text field), so collect the a11y rows FIRST
      // and dedupe by path — one problem per path, the a11y copy wins.
      const trustAltRows: Problem[] = [];
      const trust = state.rawFrame["trust_strip"];
      if (isRecord(trust) && Array.isArray(trust["logos"])) {
        (trust["logos"] as unknown[]).forEach((logo, i) => {
          if (!isRecord(logo)) return;
          const alt = logo["alt"];
          if (typeof alt !== "string" || alt.trim() === "") {
            trustAltRows.push({
              path: `frame.trust_strip.logos[${i}].alt`,
              scope: "frame",
              severity: "error",
              message: `Trust logo ${i + 1} needs alt text so screen readers can announce it.`,
              fix_url: fixQuote,
            });
          }
        });
      }
      const trustAltPaths = new Set(trustAltRows.map((row) => row.path));
      for (const p of validation.problems) {
        if (trustAltPaths.has(p.path)) continue; // deduped: the a11y row below wins
        problems.push({
          ...p,
          message:
            p.severity === "error"
              ? `The funnel's layout has an invalid setting: ${p.message}`
              : p.message,
          fix_url: fixQuote,
        });
      }
      problems.push(...trustAltRows);
    }
  }

  // --- theme_json schema validation (row 2, error) ---------------------------
  const themeRaw = funnel.theme_json;
  if (typeof themeRaw === "string" && themeRaw.trim() !== "") {
    const parsed = parseJsonColumn(themeRaw);
    if (!isRecord(parsed)) {
      problems.push({
        path: "theme",
        scope: "theme",
        severity: "error",
        message:
          "The funnel theme has an invalid value: the stored theme settings are not readable. Open the Quote Builder and re-save the theme.",
        fix_url: fixQuote,
      });
    } else {
      const validation = validateTheme(parsed);
      for (const p of validation.problems) {
        problems.push({
          ...p,
          message:
            p.severity === "error" ? `The funnel theme has an invalid value: ${p.message}` : p.message,
          fix_url: fixQuote,
        });
      }
    }
  }

  // --- disclosure points at a footer that never shows (DEV-57/B registered
  // obligation; 11 §11.4 `location:"footer"` + footer-disabled orphan →
  // preflight warning). Evaluated over the EFFECTIVE frame (template ⊕ stored)
  // so template defaults count; conditional on a valid configured frame
  // (§14.4 — a legacy quote can never gain this row).
  if (state.effectiveFrameConfig !== null) {
    const eff = state.effectiveFrameConfig;
    if (
      eff.disclosure.enabled &&
      eff.disclosure.location === "footer" &&
      (!eff.footer.enabled || eff.footer.show_on === "never")
    ) {
      problems.push({
        path: "frame.disclosure.location",
        scope: "frame",
        severity: "warning",
        message:
          "The advertising disclosure points at the footer, but the footer never shows on this funnel — move the disclosure or enable the footer.",
        fix_url: fixQuote,
      });
    }
  }

  // --- site logo unresolvable while header.logo_source="site" (row 4, warning;
  // 10 §10.4 copy + fix link to that site's Settings). Needs a site in scope
  // (the activation PUT threads it; the site-agnostic GET surface skips it).
  if (
    siteId !== null &&
    state.effectiveFrameConfig !== null &&
    state.effectiveFrameConfig.header.enabled &&
    state.effectiveFrameConfig.header.logo_source === "site"
  ) {
    // R2 P3 (element J) D2 — state.effectiveFrameConfig is ALREADY this
    // funnel's resolved frame (computed above); footerLegalPagePicks just
    // reads its footer.blocks for a picked link_row.
    const branding = await resolveSiteBranding(db, siteId, footerLegalPagePicks(state.effectiveFrameConfig));
    if (branding.logo_url === null) {
      problems.push({
        path: "frame.header.logo_source",
        scope: "frame",
        severity: "warning",
        message: `Site '${branding.site_name}' has no logo — the funnel will show the site name as text.`,
        fix_url: SITE_SETTINGS_LINK(siteId),
      });
    }
  }

  return problems;
}

// Section-content projection for the variant-level rows: EVERY node of the
// whole tree, containers INCLUDED (flattenComponents projects leaves only —
// it would miss the container-shaped chrome types HeaderBar/FooterBar/
// BackgroundPanel, which are exactly the §8.2 scope:"frame" offenders the C2
// rows exist for). Depth-capped like the canonical walks.
function allContentNodes(contentJson: string): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  const walk = (nodes: readonly unknown[], depth: number): void => {
    if (depth > 6) return; // corrupt over-deep data — validator is the gate
    for (const node of nodes) {
      if (!isRecord(node)) continue;
      out.push(node);
      const children = node["children"];
      if (Array.isArray(children)) walk(children, depth + 1);
    }
  };
  walk(parseSectionNodes(contentJson) as unknown[], 1);
  return out;
}

function isFrameScopeType(type: unknown): boolean {
  return (
    typeof type === "string" &&
    Object.prototype.hasOwnProperty.call(COMPONENT_CATALOG, type) &&
    COMPONENT_CATALOG[type as keyof typeof COMPONENT_CATALOG].scope === "frame"
  );
}

// Count legacy `#hex` literal values in a section's override surfaces: the
// section-level design_overrides_json palette + every node's design_overrides
// values (09 §9.4 legacy-literal rule).
function countLegacyHexOverrides(
  sectionRow: Pick<LeadgenSectionRow, "design_overrides_json">,
  nodes: readonly Record<string, unknown>[],
): number {
  let count = 0;
  const sectionOverrides = parseJsonColumn(sectionRow.design_overrides_json);
  if (isRecord(sectionOverrides) && isRecord(sectionOverrides["palette"])) {
    for (const value of Object.values(sectionOverrides["palette"] as Record<string, unknown>)) {
      if (typeof value === "string" && value.startsWith("#")) count++;
    }
  }
  for (const node of nodes) {
    const overrides = node["design_overrides"];
    if (!isRecord(overrides)) continue;
    for (const value of Object.values(overrides)) {
      if (typeof value === "string" && value.startsWith("#")) count++;
    }
  }
  return count;
}

// v3.1 §9.3 — "Save with maps.enabled and zero jobs -> problems[] warning
// maps_no_job (path-precise); the builder shows the amber banner. Activation
// preflight escalates it to a BLOCKING error (same pattern as
// frame_scope_component)." The section-save-time warning already exists
// (content-schema.ts's validateSectionContent, wired through
// sections-handlers.ts's validateSection). THIS is the escalation half —
// runs UNCONDITIONALLY (unlike the frame-scope rows below, which are gated
// on the funnel having a configured funnel layout): a Maps misconfiguration is
// a per-field content concern, not a layout concern, so it must block
// activation even for a legacy Quote with no frame_config_json at all.
async function computeMapsNoJobProblems(
  db: D1Database,
  variant: LeadgenFunnelVariantRow,
): Promise<Problem[]> {
  const problems: Problem[] = [];
  const orderedRefs = await readVariantSections(db, variant.id);
  for (const ref of orderedRefs) {
    if (ref.status !== "active") continue;
    const row = await db
      .prepare("SELECT public_id, section_name, content_json FROM leadgen_sections WHERE id = ? LIMIT 1")
      .bind(ref.section_id)
      .first<{ public_id: string; section_name: string; content_json: string }>();
    if (row === null) continue;
    const parsed = parseJsonColumn(row.content_json);
    const topLevel = isRecord(parsed) && Array.isArray(parsed["components"]) ? (parsed["components"] as unknown[]) : [];
    const nodes = (flattenComponents(topLevel as unknown as LeadgenComponentNode[]) as unknown[]).filter(isRecord);
    for (const node of nodes) {
      const props = node["props"];
      if (!isRecord(props)) continue;
      const maps = props["maps"];
      if (!isRecord(maps) || maps["enabled"] !== true) continue;
      const jobs = maps["jobs"];
      const anyJob =
        isRecord(jobs) && (jobs["validate"] === true || jobs["auction"] === true || jobs["autocomplete"] === true);
      if (!anyJob) {
        const questionId = typeof node["question_id"] === "string" ? node["question_id"] : "";
        problems.push({
          path: `section.${row.public_id}.components[${questionId}].props.maps`,
          scope: "component",
          severity: "error",
          message: `'${row.section_name}' has a Maps-enabled field with no job selected (validate/auction/autocomplete) — it does nothing at runtime. Pick a job or turn Maps off.`,
          fix_url: SECTION_MAPPING_LINK(row.public_id),
        });
      }
    }
  }
  return problems;
}

// Variant-level rows: maps_no_job escalation (UNCONDITIONAL, §9.3) · overrides
// schema (error, per-variant message) · contrast lint (warning) · and — when
// the funnel HAS a configured frame (§14.4) — the per-section chrome
// (error/warning per compat, C2) · local progress/back · duplicate Continue ·
// missing headline · legacy-hex rows.
async function computeVariantV25Problems(
  db: D1Database,
  quote: LeadgenQuoteRow,
  funnel: LeadgenFunnelRow,
  state: FunnelV25State,
  variant: LeadgenFunnelVariantRow,
): Promise<Problem[]> {
  const problems: Problem[] = [];
  problems.push(...(await computeMapsNoJobProblems(db, variant)));
  // §10/S5.1: the route_funnel_variant save-time conflict-flag row
  // (computeRoutingRuleConflictProblems) was removed — its own rule_type
  // filter always emptied (that rule_type was migrated out of
  // leadgen_funnel_rules by M3), so it had been a silent, permanent no-op.
  const fixQuote = QUOTE_BUILDER_LINK(quote.public_id);

  // --- variant frame_overrides_json invalid (row 3, error — per-variant) ----
  let overridesTheme: VariantThemeOverrides | null = null;
  const overridesRaw = variant.frame_overrides_json;
  if (typeof overridesRaw === "string" && overridesRaw.trim() !== "") {
    const parsed = parseJsonColumn(overridesRaw);
    if (!isRecord(parsed)) {
      problems.push({
        path: "frame",
        scope: "frame",
        severity: "error",
        message: `Variant '${variant.variant_label}' has unreadable funnel-layout overrides — re-save its overrides in the Quote Builder.`,
        fix_url: fixQuote,
      });
    } else {
      const { theme: themePart, ...frameParts } = parsed;
      const validation = validateFrameConfig(frameParts);
      for (const p of validation.problems) {
        problems.push({
          ...p,
          message: `Variant '${variant.variant_label}': ${p.message}`,
          fix_url: fixQuote,
        });
      }
      if (themePart !== undefined) {
        if (!isRecord(themePart)) {
          problems.push({
            path: "theme",
            scope: "theme",
            severity: "error",
            message: `Variant '${variant.variant_label}': the theme overrides must be a group of palette colours.`,
            fix_url: fixQuote,
          });
        } else {
          const tv = validateTheme(themePart);
          for (const p of tv.problems) {
            problems.push({
              ...p,
              message: `Variant '${variant.variant_label}': ${p.message}`,
              fix_url: fixQuote,
            });
          }
          const palette = themePart["palette"];
          if (tv.theme !== null && isRecord(palette)) {
            overridesTheme = { palette: palette as VariantThemeOverrides["palette"] };
          }
        }
      }
    }
  }

  // --- contrast lint (row 11, warning — 09 §9.3 role pairs, resolved through
  // the REAL resolveTokens pipeline for THIS variant's base design). Gated on
  // v2.5 theme data existing (funnel theme or variant palette overrides).
  if (state.theme !== null || overridesTheme !== null) {
    const design = getFunnelDesign(variant.funnel_design_id);
    const tokens = resolveTokens(design, state.theme, overridesTheme);
    const pairs: Array<[fg: FunnelTokenRole, bg: FunnelTokenRole, label: string]> = [
      ["button_primary_text", "button_primary_bg", "Button text on the button background"],
      ["text_primary", "page_background", "Text on the page background"],
    ];
    for (const [fg, bg, label] of pairs) {
      const verdict = contrastRatioAA(tokens.roles[fg], tokens.roles[bg]);
      if (verdict !== null && !verdict.passes) {
        problems.push({
          path: `theme.palette.${bg}`,
          scope: "theme",
          severity: "warning",
          message: `${label} (${fg} on ${bg}) is ${verdict.ratio}:1 — below the WCAG AA ${WCAG_AA_MIN_CONTRAST}:1 minimum.`,
          fix_url: fixQuote,
        });
      }
    }
  }

  // --- section rows — ONLY when the funnel has a configured frame (§14.4:
  // every new check is conditional on the new data existing; with a NULL
  // frame, chrome-in-section stays the save-time warning it is today).
  if (!state.frameConfigured) return problems;

  const orderedRefs = await readVariantSections(db, variant.id);
  for (let i = 0; i < orderedRefs.length; i++) {
    const ref = orderedRefs[i];
    if (ref === undefined || ref.status !== "active") continue;
    const row = await db
      .prepare(
        "SELECT public_id, section_name, content_json, design_overrides_json FROM leadgen_sections WHERE id = ? LIMIT 1",
      )
      .bind(ref.section_id)
      .first<Pick<LeadgenSectionRow, "public_id" | "section_name" | "content_json" | "design_overrides_json">>();
    if (row === null) continue;
    const slide = i + 1;
    const fixSection = SECTION_EDIT_LINK(row.public_id);
    const nodes = allContentNodes(row.content_json);

    // rows 5/6 — frame-scope components (C2): error by default, warning under
    // the per-funnel Advanced legacy override.
    const chromeTypes = [
      ...new Set(
        nodes.map((n) => n["type"]).filter(isFrameScopeType) as string[],
      ),
    ];
    if (chromeTypes.length > 0) {
      problems.push(
        state.allowSectionChrome
          ? {
              path: `section.${row.public_id}.content`,
              scope: "section",
              severity: "warning",
              message: `Legacy override is ON for this funnel: section ${slide} '${row.section_name}' keeps its own page chrome (${chromeTypes.join(", ")}) — it may appear twice.`,
              fix_url: fixSection,
            }
          : {
              path: `section.${row.public_id}.content`,
              scope: "section",
              severity: "error",
              // §14.1 copy pattern in full — the remedy names the Section
              // Builder's [Move to funnel layout] action (message text only;
              // fix_url stays the [Edit Section] section-edit deep link).
              // P8-4 F-3 (ADJ-P8-16, contract §6 M9): this copy used to say
              // "Slide" on the claim it was Quote-Builder-only vocabulary
              // exempt from the C6 "no slide anywhere" lint (never on a
              // Section-Builder page). That exemption is REVOKED: the product
              // has no slides on ANY surface, so the sentence now says
              // "section" like every other row in this function. U15 fix-round
              // (2026-07-15): the bracketed button-name reference still must
              // match ui-section-studio.ts's renamed "Move to funnel layout"
              // button verbatim — this message must keep pointing at a button
              // that exists.
              message: `Section ${slide} '${row.section_name}' contains funnel-layout elements (${chromeTypes.join(", ")}) that would render twice on the live page. Remove them ([Move to funnel layout] in the Section Builder) or enable the legacy override under Advanced.`,
              fix_url: fixSection,
            },
      );
    }

    // row 8 — Section-local progress/back (11 §11.1 Advanced escapes).
    if (nodes.some((n) => n["type"] === "ProgressBar" || n["type"] === "StepIndicator")) {
      problems.push({
        path: `section.${row.public_id}.progress`,
        scope: "section",
        severity: "warning",
        message: `Section ${slide} '${row.section_name}' renders its own progress indicator — the funnel layout already shows progress on every section.`,
        fix_url: fixSection,
      });
    }
    if (nodes.some((n) => n["type"] === "BackButton")) {
      problems.push({
        path: `section.${row.public_id}.back`,
        scope: "section",
        severity: "warning",
        message: `Section ${slide} '${row.section_name}' renders its own back link — the funnel layout already shows back navigation.`,
        fix_url: fixSection,
      });
    }

    // row 7 — duplicate Continue buttons (11 §11.5 duplicate_continue).
    const continueCount = nodes.filter((n) => n["type"] === "ContinueButton").length;
    if (continueCount > 1) {
      problems.push({
        path: `section.${row.public_id}.continue`,
        scope: "section",
        severity: "warning",
        message: `Section ${slide} has more than one Continue button — only the first is shown.`,
        fix_url: fixSection,
      });
    }

    // row 9 — bound headline missing AND no visible headline node.
    const hasBoundHeadline = nodes.some((n) => n["bind"] === "section_headline");
    const hasVisibleHeadline = nodes.some(
      (n) =>
        n["type"] === "QuestionHeadline" &&
        (n["bind"] === "section_headline" ||
          (isRecord(n["props"]) &&
            typeof n["props"]["text"] === "string" &&
            n["props"]["text"].trim() !== "")),
    );
    if (!hasBoundHeadline && !hasVisibleHeadline) {
      problems.push({
        path: `section.${row.public_id}.headline`,
        scope: "section",
        severity: "warning",
        message: `Section ${slide} shows no question headline.`,
        fix_url: fixSection,
      });
    }

    // row 10 — legacy hex literals in overrides (count + convert prompt).
    const hexCount = countLegacyHexOverrides(row, nodes);
    if (hexCount > 0) {
      problems.push({
        path: `section.${row.public_id}.design_overrides`,
        scope: "section",
        severity: "warning",
        message: `Section ${slide} uses ${hexCount} custom ${hexCount === 1 ? "color" : "colors"} — convert to theme colors.`,
        fix_url: fixSection,
      });
    }
  }

  return problems;
}

// Store the advisory per-variant verdict (variant-save leg — fail-open: KV
// hiccups never break the save; the activation gate recomputes regardless).
async function storeVariantPreflight(
  c: AdminContext,
  variant: LeadgenFunnelVariantRow,
  quote: LeadgenQuoteRow,
): Promise<QuoteActivationPreflight> {
  const blocks = await computeVariantPreflightBlocks(c.env.DB, variant);
  const funnel = await c.env.DB.prepare("SELECT * FROM leadgen_funnels WHERE id = ? LIMIT 1")
    .bind(variant.funnel_id)
    .first<LeadgenFunnelRow>();
  // v2.5 14 §14.1: the advisory verdict carries the additive problems too
  // (site-agnostic here — the site-logo row is the activation PUT's leg).
  let problems: Problem[] = [];
  if (funnel !== null) {
    // M5: both variant and funnel are in scope here — the full precedence
    // order applies (a variant-level saved template wins over the funnel's).
    const savedFrameDefaults = await loadSavedFrameTemplateDefaults(
      c.env.DB,
      variant.frame_template_id ?? funnel.frame_template_id,
      quote.public_id,
    );
    const funnelState = readFunnelV25State(funnel, savedFrameDefaults);
    problems = [
      ...(await computeFunnelV25Problems(c.env.DB, quote, funnel, funnelState, null)),
      ...(await computeVariantV25Problems(c.env.DB, quote, funnel, funnelState, variant)),
    ];
  }
  // S0-B1 fix: the rework activation checks (default funnel / shared page /
  // per-funnel sections / enabled-rule targets / §4.3-13 uniqueness) are
  // QUOTE-level and ALWAYS ride the real activation-PUT gate's verdict
  // (computeQuoteActivationPreflight below always includes them). This
  // advisory copy omitted them, so a variant save's re-rendered preflight
  // panel could flip to a false "Ready to activate — all preflight checks
  // pass" while the quote was still hard-blocked by one of these checks —
  // the activation PUT would then 409 with no reason the operator had just
  // seen surfaced. Quote-level, so unconditional (not gated on `funnel`).
  problems = [...problems, ...(await computeReworkActivationProblems(c.env.DB, quote))];
  const preflight: QuoteActivationPreflight = {
    ok: blocks.length === 0,
    quote_id: quote.public_id,
    funnel_id: funnel?.public_id ?? "",
    funnel_variant_id: variant.public_id,
    blocks,
    computed_at: Date.now(),
    problems,
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
  // v2.5 14 §14.1/§14.2 (C2 LIVE, Phase D): error-severity problems join the
  // blocking decision ADDITIVELY — the 409 fires on (existing blocks) OR (any
  // error-severity problem: schema-invalid frame/theme/overrides, missing
  // trust-logo alt, chrome-in-section under a configured frame with
  // compat.allow_section_chrome=false). Warnings NEVER block. The 409 body is
  // the EXACT historical normative report (activationBlockedReport, byte-shape
  // pinned) + the additive `problems` key. §14.4 stays: a legacy Quote (NULL
  // frame/theme) yields zero problems, so its gate inputs are unchanged. The
  // site rides in so the §14.1 site-logo warning can resolve THIS site's
  // branding.
  const preflight = await computeQuoteActivationPreflight(c.env.DB, quote, Date.now(), {
    site_id: siteId,
  });
  const hasBlockingProblems = preflight.problems.some((p) => p.severity === "error");
  if (enabled && (!preflight.ok || hasBlockingProblems)) {
    return c.json({ ...activationBlockedReport(preflight), problems: preflight.problems }, 409);
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
//
// Conductor extension round 2 (P1 regression fix) — design decision for "a
// test's creation must yield a RUNNING test with coherent arms" (§4.3-10):
// chose "validate arms exist" (the file's existing draft→running Σ==10000 gate
// at startExperimentHandler below) over "createAbTest atomically forks the 2nd
// arm itself". Rationale: the ab_tests table's OWN semantics are already an
// explicit draft→running→stopped state machine with `start` as the dedicated,
// separate transition that owns Σ-gating + the revision bump (§16.2 line 35);
// collapsing create+fork+start into one call would duplicate/bypass that
// existing machinery rather than compose with it. No code change was needed
// here or in startExperimentHandler: a fresh funnel's single active variant is
// ALREADY at bp=10000 (Σ trivially satisfied), so `start` can run immediately
// on a 1-arm test — the REAL fix is forkVariantHandler's new arm-bootstrap
// branch (below in this file), reachable ONLY once a test is running. The full
// HTTP flow is: create (draft, 1 arm) → start (running, 1 arm, Σ=10000
// trivially) → fork the running variant (NOW ALLOWED — creates the 2nd arm,
// auto-rebalances BOTH to 5000/5000, bumps the test's revision for a clean
// re-bucket) → 2 active variants, equal Σ=10000 arms, §4.3-10-valid.
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
  // §16.2: a fresh funnel's single active variant is already at bp=10000 (Σ
  // trivially satisfied) — start immediately, then fork the running variant to
  // bootstrap the 2nd arm (auto-rebalances to equal Σ==10000, §4.3-10).
  return c.json(
    {
      ...abTestRowToApi(row),
      allocation_note:
        "the single active variant is already at Σ=10000 — start the test, then fork it to bootstrap a 2nd equal arm",
    },
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
    },
  });
}

// The list of available funnel visual designs (§15.4) — read-only registry
// projection for the editor's design selector.
//
// R2 P8-3 S3.7 (§4 R3 corollary "a control that cannot be honoured must not
// be offered" + owner: "theme is only design language!!!! colors, fonts,
// sizes"): FUNNEL_DESIGNS registers exactly ONE distinct design object under
// TWO keys — "default" (the resolver's documented fallback alias) and its
// own canonical id "default-funnel" (registry.ts). One entry per registry
// KEY offered the operator two options that do the identical thing, which
// is not a choice (I1). Dedupe by the design's OWN `.id` — the SAME
// `[...new Set(...)]` idiom ui-section-studio.ts's designPickerOptions
// already uses against this exact registry — so the option set tracks
// DISTINCT designs, not raw registry keys: a future distinct design still
// surfaces automatically, a future alias still collapses automatically.
//
// `label` is computed HERE, once, via funnelDesignLabel/FUNNEL_DESIGN_LABELS
// below — the single source of display labels for this control (I3).
// quotes-tabs/funnel.ts's renderFunnelSettingsDialog renders `d.label` as
// delivered; it does not maintain a second, parallel label map.
//
// R2 P8-3 F5 MINOR-7 (review-p8-3): this runs on EVERY quote-editor render
// (ui-quotes.ts calls it while building the GET /quotes/:id/edit response),
// so funnelDesignLabel below must never throw here — a distinct design id
// added tomorrow with no label would 500 the operator's whole editor rather
// than degrade. See funnelDesignLabel's own doc comment for where the
// completeness guarantee moved.
export function listFunnelDesignOptions(): Array<{ id: string; label: string }> {
  const distinctIds = [...new Set(Object.values(FUNNEL_DESIGNS).map((d) => d.id))];
  return distinctIds.map((id) => ({ id, label: funnelDesignLabel(id) }));
}

// The visible design word for each DISTINCT design this registry resolves
// to (keyed by a design's own canonical id, e.g. "default-funnel" — never a
// fallback alias key like "default", which per I1 is never independently
// offered as its own choice). Owner: "theme is only design language!!!!
// colors, fonts, sizes" — the operator is a marketer, not an engineer; a
// raw registry id is not a design word.
export const FUNNEL_DESIGN_LABELS: Readonly<Record<string, string>> = {
  "default-funnel": "Default Funnel Design",
};

// R2 P8-3 F5 MINOR-7: funnelDesignLabel sits on the OPERATOR'S render path
// (listFunnelDesignOptions above, called by every GET /quotes/:id/edit —
// ui-quotes.ts:928), so it degrades here, it never throws. A distinct
// design id this map does not cover falls back to a neutral, honest word —
// never the raw id, which would reinstate the exact N1 defect S3.7 fixed —
// so a future unlabeled design still renders a usable editor instead of a
// 500. The completeness GUARANTEE a throw used to provide here moves to
// assertFunnelDesignLabelsComplete below: a developer-facing check
// (test/leadgen-p8-n1-design-label.test.ts calls it directly against the
// real registry), never reachable from an operator's request.
// R2 P8-3 FIX ROUND F11 — the lookup is OWN-PROPERTY guarded. A plain object
// literal inherits Object.prototype, so a bare `FUNNEL_DESIGN_LABELS[id]` on
// an inherited key ("constructor", "toString", "valueOf", "__proto__", …)
// returns a FUNCTION, not undefined: the `!== undefined` branch then handed
// that function back through a `string` return type and the operator's editor
// would have rendered "function Object() { [native code] }" as a design word —
// the raw-engineering-identifier class N1 exists to remove, arriving by a
// different door. `id` reaches here from a registry key, and today's registry
// has none of those names, so this is a latent hole rather than a live one;
// the guard closes it for one byte's worth of cost. No throw is reinstated on
// this render path (F5 MINOR-7): an unknown id still degrades to the neutral
// word. Regression: test/leadgen-p8-3-f5-major3-minor5.test.ts ("F11 — the
// design-label lookup is own-property guarded").
export function funnelDesignLabel(id: string): string {
  const label = Object.prototype.hasOwnProperty.call(FUNNEL_DESIGN_LABELS, id) ? FUNNEL_DESIGN_LABELS[id] : undefined;
  return label !== undefined ? label : "Design";
}

// I4, relocated OFF the render path (F5 MINOR-7): throws if any id in
// `ids` (defaulted to every DISTINCT id the REAL registry resolves to) is
// missing from FUNNEL_DESIGN_LABELS — a developer-visible failure (called
// directly by test/leadgen-p8-n1-design-label.test.ts; fits equally into
// any future CI completeness check), never an operator-visible 500. The
// optional `ids` param lets a test prove the throw deterministically
// against a synthetic id, without needing a second real distinct design
// registered in registry.ts.
export function assertFunnelDesignLabelsComplete(
  ids: readonly string[] = [...new Set(Object.values(FUNNEL_DESIGNS).map((d) => d.id))],
): void {
  for (const id of ids) {
    if (FUNNEL_DESIGN_LABELS[id] === undefined) {
      throw new Error(`FUNNEL_DESIGN_LABELS is missing an entry for distinct design id "${id}" — add one before this design reaches an operator`);
    }
  }
}
