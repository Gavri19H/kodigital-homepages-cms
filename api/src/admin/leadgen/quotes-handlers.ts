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
  // Round-4 P4b: the P4a (D-2) routing-rule primitives this module's CRUD
  // reuses so the admin-side checkpoint derivation + conflict detection can
  // never diverge from the runtime's own (deriveRuleCheckpointPage,
  // ROUTING_ENTRY_KNOWN_FIELDS are EXPORTED from resolver.ts for exactly this
  // reuse — its own module-header comment: "conditions_hash + save-time
  // conflict flagging" / "exported for P4b's Problems mechanism").
  deriveRuleCheckpointPage,
  ROUTING_ENTRY_KNOWN_FIELDS,
  detectRoutingRuleConflicts,
  type RoutingConflictInput,
} from "../../public/leadgen/resolver";
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
import { validateFrameConfig, effectiveFrame } from "../../public/leadgen/designs/frames";
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
// route_funnel_variant rule type or the migration-0043 v2 columns
// (target_funnel_variant_id, value_multiplier, checkpoint_page, match_mode,
// rule_name, status) -- neither file is in the P4b slice's file ownership
// (its dispatch lists only ui-rules-builder.ts / ui-quotes.ts /
// quotes-handlers.ts / router.ts). resolver.ts's own P4a comment anticipated
// this ("db-types.ts's LeadgenFunnelRuleRow, which P4b extends for the admin
// API") but the widening was never added to either shared file. Rather than
// touch two files outside this slice, the v2 surface is expressed with local,
// additive types here (SEAM -- reported to the conductor rather than silently
// widening db-types.ts/leadgen/funnel.ts).
type FunnelRuleTypeV2 = LeadgenFunnelRuleType | "route_funnel_variant";

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

const FUNNEL_RULE_TYPES = [
  "redirect_direct_offer",
  "skip_section",
  "show_section",
  "eligibility",
  "disqualification",
  "auction_entry",
  "route_funnel_variant",
] as const satisfies readonly FunnelRuleTypeV2[];

// route_funnel_variant is a P4b-only rule_type: leadgen/funnel.ts's
// validateFunnelRule (its OWN, unexported FUNNEL_RULE_TYPES Set) rejects it as
// unknown_rule_type, and that file is outside this slice. So route_funnel_
// variant rules are validated LOCALLY (validateRoutingConditionsShape below)
// and never routed through validateFunnelRule; every other rule type is
// UNCHANGED (still validated by the shared Stage-A validator, no drift).
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

// Mirrors resolver.ts's private fieldToPageIndex (same "later page overwrites
// -> max" derivation) using the SAME exported component parser/expander, so
// the P4b builder's checkpoint_page can never drift from the runtime's own
// per-rule derivation (deriveRuleCheckpointPage, imported above, is reused
// verbatim -- only this field->page map is a local mirror).
function computeFieldToPageIndex(pages: readonly ResolvedFunnelPage[]): Map<string, number> {
  const out = new Map<string, number>();
  pages.forEach((page, idx) => {
    for (const slot of page.slots) {
      for (const c of slot.candidates) {
        for (const node of parseSectionComponents(c.section.content_json ?? "")) {
          for (const comp of expandPublicComponents(node)) {
            const f = comp.internal_field;
            if (f !== undefined && f !== "") out.set(f, idx);
          }
        }
      }
    }
  });
  return out;
}

// A route_funnel_variant rule is "entry-only" (no checkpoint_page -- evaluated
// at entry) iff every condition field is entry-known. Mirrors resolver.ts's
// private isEntryOnly using the SAME exported ROUTING_ENTRY_KNOWN_FIELDS set.
function routingRuleIsEntryOnly(conditions: { groups?: Array<{ field: string }> }): boolean {
  for (const g of conditions.groups ?? []) {
    if (!ROUTING_ENTRY_KNOWN_FIELDS.has(g.field)) return false;
  }
  return true;
}

// Resolve a route_funnel_variant target: a funnel_variant PUBLIC id (lgn_...),
// constrained to the SAME FUNNEL as the rule's own variant (P4a's resolver.ts
// anti-leak invariant -- getActiveVariantByIdOnFunnel/isActiveRoutingTargetOnFunnel
// both scope by funnel_id; a routing rule can only route within its own
// funnel's variants). Returns the target's internal id, or null when absent/
// not-found/foreign-funnel (caller surfaces a field error on not-found).
async function resolveRoutingTargetVariantId(
  db: D1Database,
  funnelId: number,
  targetPublicId: string,
): Promise<number | null> {
  if (targetPublicId === "") return null;
  const row = await db
    .prepare("SELECT id FROM leadgen_funnel_variants WHERE public_id = ? AND funnel_id = ? LIMIT 1")
    .bind(targetPublicId, funnelId)
    .first<{ id: number }>();
  return row ? row.id : null;
}

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
    funnel_variant_id: toFunnelVariantId(row.public_id) as string,
    is_control: row.is_control !== 0,
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
function variantSectionMappingStatus(row: VariantSectionRow): OrderedVariantSection["mapping_status"] {
  if (Number(row.mapped_offer_count ?? 0) === 0) return "none";
  if (
    Number(row.invalid_offer_count ?? 0) > 0 ||
    Number(row.incomplete_offer_count ?? 0) > 0 ||
    Number(row.error_edge_count ?? 0) > 0
  ) {
    return "incomplete";
  }
  return "complete";
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
      allocations: slot.ab_allocations,
      candidates: slot.candidates.map((c) => ({
        section_id: c.section.public_id,
        section_name: c.section.section_name,
      })),
    })),
  };
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
  const sections = await readVariantSections(db, variant.id);
  const rules = await readVariantRules(db, variant.id);
  // Round-4 P3a: the page/slot tree rides alongside the existing flat
  // `sections` projection (untouched — legacy single-page-per-section
  // callers read EXACTLY what they always have).
  const pages = await readVariantPagesApi(db, variant.id);
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

// EXPORTED (v2.5 04 §4.8): frame-handlers.ts reads the control variant (the
// is_control DESC head) to resolve the theme editor's base design.
export async function readFunnelVariants(
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
    if (v.length === 0) errors["verticals"] = "At least one vertical is required";
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
// every funnel's CONTROL variant's ordered sections/rules (the SAME clone
// shape forkVariantHandler already uses for one variant, looped over the
// whole quote tree, plus the funnel's own frame_config_json/theme_json — a
// "coherent, publishable draft quote" needs its visual template, not just
// section order). NEVER copied: site activations, analytics/attempt history,
// A/B tests, and (adversarial-review finding 4) any NON-control variant —
// a duplicate is the funnel's CONTROL experience only. Copying every arm of
// a running A/B test verbatim (ab_test_id forced NULL, but is_control/
// traffic_allocation_bp left as-is) produced an INCOHERENT detached state: a
// "B" variant at bp=5000 with no owning ab_test row and is_control=0 — two
// variants that look like a live split but aren't wired to anything. The
// clone's one variant is always is_control=1 at traffic_allocation_bp=10000
// (the full-traffic control), regardless of what the source control
// variant's own bp was (source A/B tests are re-created intentionally on
// the copy, never copied — the SAME "never copied" discipline offers'
// duplicateOfferHandler documents for analytics/cap-counters/test-results).
// ---------------------------------------------------------------------------

interface QuoteDuplicateCounts {
  funnels: number;
  variants: number;
  sections: number;
  rules: number;
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

  const counts: QuoteDuplicateCounts = { funnels: 0, variants: 0, sections: 0, rules: 0 };
  for (const funnel of funnels) {
    const newFunnelPublicId = mintPublicId("funnel");
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO leadgen_funnels (public_id, quote_id, funnel_name, status, frame_config_json, theme_json)
         VALUES (?, (SELECT id FROM leadgen_quotes WHERE public_id = ?), ?, 'active', ?, ?)`,
      ).bind(newFunnelPublicId, newQuotePublicId, funnel.funnel_name, funnel.frame_config_json, funnel.theme_json),
    );
    counts.funnels += 1;

    // Adversarial-review finding 4: copy ONLY the funnel's CONTROL variant
    // (is_control=1) — never the other arms of a running/stopped A/B test.
    // readFunnelVariants orders is_control DESC first, but a funnel could in
    // principle carry more than one is_control=1 row (nothing in the schema
    // enforces exactly one) — filter explicitly rather than index [0].
    const variants = await readFunnelVariants(c.env.DB, funnel.id);
    const controlVariants = variants.filter((v) => v.is_control !== 0);
    // Round-4 P4b: pre-mint every control variant's NEW public id BEFORE any
    // INSERT is pushed, so a route_funnel_variant rule that targets a SIBLING
    // control variant (of this SAME funnel) can be remapped regardless of
    // loop order (source variant.id -> the clone's new public_id).
    const newControlVariantPublicIds = new Map<number, string>();
    for (const variant of controlVariants) {
      newControlVariantPublicIds.set(variant.id, mintPublicId("funnel_variant"));
    }
    for (const variant of controlVariants) {
      const newVariantPublicId = newControlVariantPublicIds.get(variant.id)!;
      statements.push(
        c.env.DB.prepare(
          `INSERT INTO leadgen_funnel_variants
             (public_id, funnel_id, ab_test_id, variant_label, is_control, traffic_allocation_bp, funnel_design_id,
              auction_id, lander_enabled, lander_headline, lander_subheadline, lander_body_json,
              lander_hero_media_id, lander_hero_media_url, lander_cta_json, content_version, status,
              frame_overrides_json)
           VALUES (?, (SELECT id FROM leadgen_funnels WHERE public_id = ?), NULL, ?, 1, 10000, ?, ?, ?, ?, ?, ?,
                   ?, ?, ?, 1, 'active', ?)`,
        ).bind(
          newVariantPublicId, newFunnelPublicId, variant.variant_label,
          variant.funnel_design_id, variant.auction_id, variant.lander_enabled,
          variant.lander_headline, variant.lander_subheadline, variant.lander_body_json,
          variant.lander_hero_media_id, variant.lander_hero_media_url, variant.lander_cta_json,
          variant.frame_overrides_json,
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

// Validate + prepare the funnel-rule replace-set (§15.5 + Round-4 P4b rule-
// model v2). Every LEGACY rule type still runs through the Stage-A
// validateFunnelRule with the admin raw-redirect allowlist (byte-identical to
// pre-P4b); route_funnel_variant is validated LOCALLY (see the FUNNEL_RULE_
// TYPES comment above) since leadgen/funnel.ts does not know this rule_type
// and is outside this slice. conditions_json + conditions_hash (both NOT
// NULL) are computed here, as before. `funnelId` scopes a route_funnel_
// variant target to the SAME funnel (P4a's resolver.ts anti-leak invariant).
// checkpoint_page is SERVER-DERIVED (never client-accepted) from the
// variant's CURRENT pages (loaded once, before this save's own page replace-
// set commits -- a same-request page-reorder + rule-add can leave the stored
// display value one save behind; the RUNTIME always re-derives fresh from
// live pages per resolver.ts's own doc comment, so this is a display-only,
// self-correcting edge case, not a functional gap).
async function prepareRules(
  db: D1Database,
  variantId: number,
  funnelId: number,
  raw: unknown,
  allowlist: string[],
): Promise<{ rules: PreparedRule[]; errors: FieldErrors }> {
  const errors: FieldErrors = {};
  if (!Array.isArray(raw)) {
    errors["rules"] = "rules must be an array";
    return { rules: [], errors };
  }
  const rules: PreparedRule[] = [];
  const pages = await loadVariantPages(db, variantId);
  const fieldToPage = computeFieldToPageIndex(pages);
  const lastPageIndex = pages.length - 1;

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

    // --- v2 envelope (rule_name / status / match_mode) — every rule type ---
    const ruleName = trimmedString(entry["rule_name"]);
    const statusRaw = entry["status"];
    const statusProvided = statusRaw === "active" || statusRaw === "disabled";
    if (statusRaw !== undefined && statusRaw !== null && statusRaw !== "" && !statusProvided) {
      errors[`rules.${i}.status`] = "status must be one of active|disabled";
      continue;
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
      errors[`rules.${i}.match_mode`] = "match_mode must be one of all|any";
      continue;
    }
    const valueMultiplierRaw = entry["value_multiplier"];
    let valueMultiplier: number | null = null;
    if (valueMultiplierRaw !== undefined && valueMultiplierRaw !== null && valueMultiplierRaw !== "") {
      if (typeof valueMultiplierRaw !== "number" || !Number.isFinite(valueMultiplierRaw) || valueMultiplierRaw <= 0) {
        errors[`rules.${i}.value_multiplier`] = "value_multiplier must be a positive number";
        continue;
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
        errors[`rules.${i}.redirect_pct`] = "redirect_pct must be a number between 0 and 100";
        continue;
      }
      redirectPct = redirectPctRaw;
    }

    let targetFunnelVariantId: number | null = null;
    let checkpointPage: number | null = null;

    if (ruleType === "route_funnel_variant") {
      if (!Number.isInteger(priority) || priority < 1 || priority > 100) {
        errors[`rules.${i}.priority`] = "priority must be an integer between 1 and 100";
        continue;
      }
      const shapeError = validateRoutingConditionsShape(conditions);
      if (shapeError !== null) {
        errors[`rules.${i}.conditions_json`] = shapeError;
        continue;
      }
      const targetPublicId = trimmedString(entry["target_funnel_variant_id"]) ?? "";
      if (targetPublicId === "") {
        errors[`rules.${i}.target_funnel_variant_id`] = "route_funnel_variant requires a target funnel variant";
        continue;
      }
      const resolvedTarget = await resolveRoutingTargetVariantId(db, funnelId, targetPublicId);
      if (resolvedTarget === null) {
        errors[`rules.${i}.target_funnel_variant_id`] = `target funnel variant '${targetPublicId}' does not exist on this funnel`;
        continue;
      }
      targetFunnelVariantId = resolvedTarget;
      const conditionsForCheckpoint = conditions as { groups?: Array<{ field: string }> };
      const entryOnly = routingRuleIsEntryOnly(conditionsForCheckpoint);
      checkpointPage = entryOnly
        ? null
        : deriveRuleCheckpointPage(
            {
              hash: "",
              priority,
              conditions: conditionsForCheckpoint as LeadgenRuleConditions,
              target_funnel_variant_id: targetFunnelVariantId,
              value_multiplier: valueMultiplier,
              entry_only: entryOnly,
            },
            fieldToPage,
            lastPageIndex,
          );
    } else {
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
    }

    const conditionsJson = JSON.stringify(conditions);
    rules.push({
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
    });
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
      errors[path] = `unknown section ${String(ref)}`;
      return null;
    }
    if (section.status !== "active") {
      errors[path] = `section ${section.public_id} is ${section.status} — only active sections can be ordered`;
      return null;
    }
    if (section.activity !== quote.activity) {
      errors[path] = `section ${section.public_id} activity '${section.activity}' does not match the quote activity '${quote.activity}'`;
      return null;
    }
    if (quoteVerticals.size > 0 && !quoteVerticals.has(section.vertical)) {
      errors[path] = `section ${section.public_id} vertical '${section.vertical}' is not one of the quote verticals`;
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
    if (!Array.isArray(slotsRaw) || slotsRaw.length === 0) {
      errors[`${pagePath}.slots`] = "a page requires at least one slot";
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
            message: `Theme '${themeIdPart}' does not exist.`,
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
  const preflight = await storeVariantPreflight(c, updated, owner.quote);
  const detail = await variantDetailJson(c.env.DB, updated);
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
  const statements: D1PreparedStatement[] = [
    sourceFrameOverrides === null
      ? c.env.DB.prepare(
          `INSERT INTO leadgen_funnel_variants
             (public_id, funnel_id, ab_test_id, variant_label, is_control, traffic_allocation_bp, funnel_design_id,
              auction_id, lander_enabled, lander_headline, lander_subheadline, lander_body_json,
              lander_hero_media_id, lander_hero_media_url, lander_cta_json, content_version, status)
           VALUES (?, ?, NULL, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'active')`,
        ).bind(
          variantPublicId, source.funnel_id, newLabel, source.traffic_allocation_bp, source.funnel_design_id,
          source.auction_id, source.lander_enabled, source.lander_headline, source.lander_subheadline, source.lander_body_json,
          source.lander_hero_media_id, source.lander_hero_media_url, source.lander_cta_json,
        )
      : c.env.DB.prepare(
          `INSERT INTO leadgen_funnel_variants
             (public_id, funnel_id, ab_test_id, variant_label, is_control, traffic_allocation_bp, funnel_design_id,
              auction_id, lander_enabled, lander_headline, lander_subheadline, lander_body_json,
              lander_hero_media_id, lander_hero_media_url, lander_cta_json, content_version, status, frame_overrides_json)
           VALUES (?, ?, NULL, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'active', ?)`,
        ).bind(
          variantPublicId, source.funnel_id, newLabel, source.traffic_allocation_bp, source.funnel_design_id,
          source.auction_id, source.lander_enabled, source.lander_headline, source.lander_subheadline, source.lander_body_json,
          source.lander_hero_media_id, source.lander_hero_media_url, source.lander_cta_json, sourceFrameOverrides,
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

// POST /variants/:variant_id/rules/:rule_id/duplicate — Round-4 P4b. Rules
// have no OTHER independent CRUD surface (they live inside the §15.5/P4b
// replace-set the variant PUT owns), but each carries its own stable id/
// public_id (migration 0043), so a single-row clone is a safe, isolated
// INSERT that persists IMMEDIATELY -- mirrors the existing
// duplicateSectionHandler/duplicateOfferHandler precedent (instant 201 + the
// new row, never touching sibling rows, never requiring the operator to hit
// the variant's main Save first).
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
  await insertRuleStatement(c.env.DB, "?", variant.id, {
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
  }).run();

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

  if (Object.keys(fields).length > 0) {
    return c.json({ error: "Validation failed", fields }, 400);
  }
  if (problems.some((p) => p.severity === "error")) {
    return c.json({ error: "Validation failed", problems }, 400);
  }

  // site_id (C4): ANY CMS site is legal — branding is read-only site_settings
  // data; previewing under a site's branding needs NO activation and creates
  // none. Unknown site → 404.
  let siteBranding: SiteBranding | null = null;
  if (typeof siteIdRaw === "string" && siteIdRaw.trim() !== "") {
    const siteId = siteIdRaw.trim();
    const site = await c.env.DB.prepare("SELECT id FROM sites WHERE id = ? LIMIT 1")
      .bind(siteId)
      .first<{ id: string }>();
    if (site === null) return c.json({ error: "Not Found" }, 404);
    siteBranding = await resolveSiteBranding(c.env.DB, siteId);
  }

  // Ordered sections — the same rows the legacy branch loads.
  const orderedRefs = await readVariantSections(c.env.DB, variant.id);
  const sections: LeadgenSectionRow[] = [];
  for (const ref of orderedRefs) {
    const row = await c.env.DB.prepare("SELECT * FROM leadgen_sections WHERE id = ? LIMIT 1")
      .bind(ref.section_id)
      .first<LeadgenSectionRow>();
    if (row) sections.push(row);
  }

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
  for (const funnel of funnels) {
    if (funnel.status !== "active") continue;
    const variants = await readActiveFunnelVariants(db, funnel.id);
    // v2.5 14 §14.1: the additive problems projection (funnel-level rows once,
    // variant-level rows per active variant). NEVER touches `blocks`/`ok`
    // (the historical report inputs); the activation PUT gates on blocks OR
    // error-severity problems (C2 LIVE, Phase D).
    const funnelState = readFunnelV25State(funnel);
    problems.push(...(await computeFunnelV25Problems(db, quote, funnel, funnelState, siteId)));
    for (const variant of variants) {
      const variantBlocks = await computeVariantPreflightBlocks(db, variant);
      if (variantBlocks.length > 0 && firstVariantId === "") {
        firstFunnelId = funnel.public_id;
        firstVariantId = variant.public_id;
      }
      blocks.push(...variantBlocks);
      problems.push(...(await computeVariantV25Problems(db, quote, funnel, funnelState, variant)));
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
    problems,
  };
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

function readFunnelV25State(funnel: LeadgenFunnelRow): FunnelV25State {
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
        state.effectiveFrameConfig = effectiveFrame(validation.config, null, null).frame;
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
    const branding = await resolveSiteBranding(db, siteId);
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
// Round-4 P4b: surface P4a's save-time routing-rule conflict flags (resolver.ts
// detectRoutingRuleConflicts, exported "for P4b's Problems mechanism") through
// the SAME activation-preflight Problems list every other variant-level
// advisory already rides (storeVariantPreflight -> computeVariantV25Problems
// -> the Activation tab's publish badge). `scope` is drawn from theme.ts's
// CLOSED ProblemScope union ("frame"|"theme"|"section"|"component"|"choice"|
// "mapping") -- none of those literals actually fit "two routing rules race"
// semantically, and widening that union is out of this slice's file
// ownership (theme.ts is not in the P4b file list). "section" is the least-
// wrong existing bucket (routing rules are authored on the same funnel-
// variant surface as section-scoped problems); flagged to the conductor as a
// SEAM rather than silently adding a new ProblemScope literal.
async function computeRoutingRuleConflictProblems(
  db: D1Database,
  variant: LeadgenFunnelVariantRow,
): Promise<Problem[]> {
  const rules = await readVariantRules(db, variant.id);
  // Mirrors resolver.ts loadRoutingRules' own gate exactly (commit 32990e8):
  // `enabled = 1 AND status != 'disabled'` — a rule off by EITHER axis never
  // actually evaluates at runtime, so it can never actually conflict.
  const routingRules = rules.filter(
    (r) => r.rule_type === "route_funnel_variant" && r.enabled !== 0 && r.status !== "disabled",
  );
  if (routingRules.length === 0) return [];
  const inputs: RoutingConflictInput[] = routingRules.map((r) => {
    const conditions = parseJsonColumn(r.conditions_json);
    const fields =
      isRecord(conditions) && Array.isArray((conditions as { groups?: unknown }).groups)
        ? ((conditions as { groups: Array<{ field?: unknown }> }).groups)
            .map((g) => g.field)
            .filter((f): f is string => typeof f === "string")
        : [];
    return {
      rule_name: r.rule_name ?? "",
      checkpoint_page: r.checkpoint_page,
      priority: r.priority,
      fields,
    };
  });
  return detectRoutingRuleConflicts(inputs).map((message) => ({
    path: "rules",
    scope: "section",
    severity: "warning",
    message,
  }));
}

async function computeVariantV25Problems(
  db: D1Database,
  quote: LeadgenQuoteRow,
  funnel: LeadgenFunnelRow,
  state: FunnelV25State,
  variant: LeadgenFunnelVariantRow,
): Promise<Problem[]> {
  const problems: Problem[] = [];
  problems.push(...(await computeMapsNoJobProblems(db, variant)));
  problems.push(...(await computeRoutingRuleConflictProblems(db, variant)));
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
              message: `Legacy override is ON for this funnel: slide ${slide} '${row.section_name}' keeps its own page chrome (${chromeTypes.join(", ")}) — it may appear twice.`,
              fix_url: fixSection,
            }
          : {
              path: `section.${row.public_id}.content`,
              scope: "section",
              severity: "error",
              // §14.1 copy pattern in full — the remedy names the Section
              // Builder's [Move to funnel layout] action (message text only;
              // fix_url stays the [Review slide] section-edit deep link).
              // "Slide" is LEGAL here: this copy renders on Quote-Builder
              // activation surfaces (preflight panel / 409 problems), never
              // on a Section-Builder page (C6 lint scope). U15 fix-round
              // (2026-07-15): the bracketed button-name reference is updated
              // to match ui-section-studio.ts's renamed "Move to funnel
              // layout" button verbatim — this message must keep pointing at
              // a button that exists.
              message: `Slide ${slide} '${row.section_name}' contains funnel-layout elements (${chromeTypes.join(", ")}) that would render twice on the live page. Remove them ([Move to funnel layout] in the Section Builder) or enable the legacy override under Advanced.`,
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
        message: `Slide ${slide} '${row.section_name}' renders its own progress indicator — the funnel layout already shows progress on every slide.`,
        fix_url: fixSection,
      });
    }
    if (nodes.some((n) => n["type"] === "BackButton")) {
      problems.push({
        path: `section.${row.public_id}.back`,
        scope: "section",
        severity: "warning",
        message: `Slide ${slide} '${row.section_name}' renders its own back link — the funnel layout already shows back navigation.`,
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
        message: `Slide ${slide} has more than one Continue button — only the first is shown.`,
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
        message: `Slide ${slide} shows no question headline.`,
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
        message: `Slide ${slide} uses ${hexCount} custom ${hexCount === 1 ? "color" : "colors"} — convert to theme colors.`,
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
    const funnelState = readFunnelV25State(funnel);
    problems = [
      ...(await computeFunnelV25Problems(c.env.DB, quote, funnel, funnelState, null)),
      ...(await computeVariantV25Problems(c.env.DB, quote, funnel, funnelState, variant)),
    ];
  }
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
