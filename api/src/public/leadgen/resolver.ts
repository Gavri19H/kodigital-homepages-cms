// LeadGen §17.2 public resolution: host → site → path → quote → funnel →
// (running A/B assignment | single control) → ordered sections. READ-ONLY;
// every query is parameterized via .bind() (never template-literal interpolation).
//
// The host→site hop is already owned by the public Worker middleware
// (public/middleware.ts → site/site-context.ts resolveSiteByHostname), which
// hands downstream handlers a SiteContext.site_id. This module takes that
// resolved `site_id` (a string, the sites.id) + an optional `quote_slug` and
// completes the rest of the §17.2 chain, mirroring how listicle/resolver.ts
// resolves an already-site-scoped request.
//
// A/B (contract 06 §16, P8): when the quote's active funnel has a RUNNING
// leadgen_funnel_ab_tests (status='running', guarded by uq_leadgen_abtest_running
// → 0..1 per funnel), the §16.2 deterministic edge hash (Stage-A assignVariant)
// picks one of the funnel's active variants from the caller-supplied session_id;
// with NO running test the is_control=1 variant serves via singleControlAssignment.
// Either way the resolved bundle carries a `FunnelAssignment` so serve/config/
// attempt can stamp the §16.3 tracking dims. The arms of the running test are the
// funnel's ACTIVE variants (ab_test_id is not populated by the admin lifecycle;
// a funnel has exactly one running test, so its active variants ARE its arms —
// the same funnel-scoping getControlVariantForFunnel already uses).
//
// Missing / disabled activation → returns null (the caller 404s per §17.2).

import type { Env } from "../../env";
import type {
  LeadgenSiteQuoteRow,
  LeadgenQuoteRow,
  LeadgenFunnelRow,
  LeadgenFunnelVariantRow,
  LeadgenFunnelAbTestRow,
  LeadgenSectionRow,
  LeadgenRuleConditions,
} from "../../admin/leadgen/db-types";
import {
  assignVariant,
  singleControlAssignment,
  pickVariantByBucket,
  abBucket,
  type LeadgenAssignmentReason,
} from "./ab-hash";
import { isFunnelVariantId } from "../../leadgen/funnel";
import { resolveSiteBranding, type SiteBranding } from "../../leadgen/branding";
// Round-4 P3a (D-3 pages model): slot RULES reuse the EXISTING §21.4
// composed-group evaluator (07 §21.4; the same one funnel offer/carrier
// rules already share) so a slot rule and a future P4 routing rule can never
// diverge on operator meaning. Read-only reuse — this module is not edited.
import { conditionsMatch } from "../../leadgen/auction-rules";
import { sha256Hex } from "./auction/parse";
// Round-4 P4a (D-2): the ONE canonical component parser/expander (no drift)
// used to derive which page each ANSWER field becomes known on (the auto-
// CHECKPOINT). Imported as VALUES; config-dto imports THIS module type-only
// (`import type`), so there is no runtime import cycle.
import { parseSectionComponents, expandPublicComponents } from "./config-dto";
// Round-4 P4a-adj (P5a runtime seam #1, CTA visibility): frame-only resolution
// (no theme/tokens) + the P2a composed-group evaluator, both reused here (NOT
// re-derived) so a CTA condition and a section dependency conditional can never
// diverge on operator meaning. Deliberately resolver.ts (not serve.ts): serve.ts
// imports mintFunnelAttempt FROM attempt.ts, so attempt.ts importing this back
// FROM serve.ts would be circular; resolver.ts sits BELOW both (serve.ts and
// attempt.ts each already import resolver.ts, never the reverse).
import { effectiveFrame, validateFrameConfig } from "./designs/frames";
import type { EffectiveFrameConfig, FrameOverrides, StoredFrameConfig, FrameCtaSlotConfig } from "./designs/frames";
import { conditionalMet, type LeadgenPayloadConditional, type LeadgenPayloadConditionGroup } from "../../leadgen/payload";
// LeadGen Rework §4.3-3: the ONE pure checkpoint-plane derivation (shared by
// this runtime evaluator AND the admin builder). Imported for the os-inclusive
// entry-known set + the quote-rule plane partition; rule-checkpoint.ts imports
// nothing back from here (one-directional edge).
import {
  ENTRY_KNOWN_ROUTING_FIELDS,
  isEntryPlane as isQuoteRuleEntryPlane,
} from "../../leadgen/rule-checkpoint";

// One ordered section of the resolved variant (position + the full section
// row). Ordered ascending by position; the auction runs after the MAX position
// (§15.3 — derived, not stored).
export interface ResolvedFunnelSection {
  position: number;
  section: LeadgenSectionRow;
}

// ---------------------------------------------------------------------------
// Round-4 P3a (D-3, FULL pages model) — page/slot resolution
// ---------------------------------------------------------------------------
//
// A page holds >=1 ordered SLOTS; each slot resolves to exactly ONE candidate
// section per attempt: "fixed" (its one candidate), "slot_rule" (ENTRY-KNOWN
// conditions pick a case, else the slot's default), or "slot_ab" (session-
// sticky hash over its bp allocations). `sections` on ResolvedActivatedFunnel
// stays the FULL, session-INDEPENDENT candidate catalog (every candidate of
// every slot) — this is what the visitor-invariant cacheable shell/config
// need (every candidate ships server-rendered, hidden until the attempt-time
// plan reveals the winner); it is what section_order_hash/answer_mapping_hash
// already hash today, so those anti-tamper legs need ZERO changes. The
// SESSION-DEPENDENT resolved plan (which candidate won each slot) is a
// SEPARATE, additive concept — resolvePagePlan below — computed once per
// attempt (never at shell-serve time) and carried by the signed
// `page_plan_hash` (attempt.ts), never by the cacheable config.

// Entry-known field registry for slot RULES (roast MAJOR-4): conditions may
// reference ONLY these — never an answer `internal_field`. `utm_campaign` is
// NOT part of this system's macro vocabulary (utm_source/utm_medium/
// utm_content are the established 3, e.g. ab-hash.ts/runtime-context.ts/
// leadgen-events.ts) — `utm_content` is used here in its place (documented
// substitution; the operator's "UTM source/medium/campaign" phrasing maps
// onto this codebase's actual 3-dim UTM taxonomy).
export const ENTRY_KNOWN_SLOT_FIELDS: ReadonlySet<string> = new Set([
  "state",
  "device",
  "utm_source",
  "utm_medium",
  "utm_content",
  "hour",
  "weekday",
]);

// Save-time validator (quotes-handlers.ts) — rejects any slot-rule condition
// field outside ENTRY_KNOWN_SLOT_FIELDS with the plain-language guidance the
// dispatch mandates. Pure; never throws.
export function validateSlotRuleFieldScope(conditions: LeadgenRuleConditions): string | null {
  for (const group of conditions.groups ?? []) {
    if (!ENTRY_KNOWN_SLOT_FIELDS.has(group.field)) {
      return "answer-based visibility lives on the section's own show/hide rules";
    }
  }
  return null;
}

// One ruled-slot case: entry-known conditions -> the section that wins when
// they match. Cases evaluate in array order; the first match wins.
export interface SlotRuleCase {
  conditions: LeadgenRuleConditions;
  section_id: number;
}

// A ruled slot ALWAYS resolves (every slot must produce exactly one winner):
// default_section_id is REQUIRED (validated at save) for a slot carrying
// rules_json.
export interface SlotRules {
  cases: SlotRuleCase[];
  default_section_id: number;
}

export interface SlotAbAllocation {
  section_id: number;
  bp: number; // Sigma across a slot's allocations == 10000 (validated at save)
}

export interface ResolvedPageSlotCandidate {
  variant_section_id: number;
  section: LeadgenSectionRow;
}

export interface ResolvedPageSlot {
  // A REAL slot's DB id, or a synthetic negative sentinel for a pre-page-
  // model row resolved on the fly (see loadVariantPages) — never a real id
  // (leadgen_funnel_page_slots.id is an AUTOINCREMENT PK, always >= 1).
  id: number;
  position: number;
  slot_revision: number;
  rules: SlotRules | null;
  ab_allocations: SlotAbAllocation[] | null;
  candidates: ResolvedPageSlotCandidate[];
}

export interface ResolvedFunnelPage {
  id: number;
  public_id: string;
  position: number;
  name: string | null;
  slots: ResolvedPageSlot[];
}

// The §16.3 tracking dims for the resolved variant, computed once by the
// resolver and threaded to serve/config/attempt so all three stamp IDENTICAL
// assignment metadata. `funnel_ab_test_id`/`funnel_ab_test_revision` are the
// running test's public_id/revision (""/0 on the single_control path);
// `variant_label`/`traffic_allocation_bp` come from the ASSIGNED variant;
// `assignment_bucket` is the §16.2 bucket (0..9999) on the ab_hash edge path and
// null when either no session is present (the cacheable config path) or there is
// no running test (single_control). `assignment_reason` is the shared vocabulary.
export interface FunnelAssignment {
  funnel_ab_test_id: string;
  funnel_ab_test_revision: number;
  variant_label: string;
  traffic_allocation_bp: number;
  assignment_bucket: number | null;
  // The variant-scoped fallback reason baked into the CACHEABLE config (stays
  // the closed {ab_hash,single_control} vocabulary so config-dto's cacheable
  // DTO is unchanged). An ENTRY-routed variant sets this to 'single_control'
  // (it serves as-is, no A/B bucket) and carries the routing hash SEPARATELY —
  assignment_reason: LeadgenAssignmentReason;
  // Round-4 P4a (D-2): set ONLY on an entry-routed assignment. The PER-REQUEST
  // §16.3 reason (`routing_rule:<conditions_hash>`, the analytics attribution
  // key) is emitted from this by serve.ts injectAssignment onto the RESPONSE
  // global — NEVER baked into the shared cacheable config/shell body (which a
  // second request to the same variant would otherwise inherit).
  routing_rule_hash?: string;
}

export interface ResolvedActivatedFunnel {
  site_quote: LeadgenSiteQuoteRow;
  quote: LeadgenQuoteRow;
  funnel: LeadgenFunnelRow; // funnel.public_id is the stable lgf_ funnel_id
  variant: LeadgenFunnelVariantRow; // variant.public_id is the lgn_ funnel_variant_id (the ASSIGNED variant)
  sections: ResolvedFunnelSection[]; // ordered by position ASC
  // Round-4 P3a (D-3): the variant's ordered pages -> ordered slots -> ALL
  // candidate sections (session-independent; see the module-header note
  // above `ResolvedFunnelSection`). Optional in the TYPE only (the
  // site_branding precedent, same file): hand-built minimal bundles
  // (admin/leadgen/auctions-handlers.ts's dry-run + several test fixtures)
  // stay valid without this field; BOTH resolver functions below always
  // populate it (real page/slot rows when the variant has them, else a
  // synthetic 1-page/1-slot-per-row fallback — pre-P3a raw-seeded fixtures
  // resolve byte-identically with no migration backfill of THEIR rows).
  pages?: ResolvedFunnelPage[];
  // GA4 measurement id resolved from the activation's settings_overrides_json
  // (contract 08 §28 "measurement id from settings"); null when unset. Kept on
  // the resolved bundle so the pure config-dto builder needs no env access.
  ga4_measurement_id: string | null;
  // The §16.3 A/B assignment metadata for `variant` (contract 06 §16.2/§16.3).
  assignment: FunnelAssignment;
  // Redesign v2.5 §10.2 (D4): the resolved site's branding projection
  // (leadgen/branding.ts resolveSiteBranding — site_name / logo ladder /
  // tagline / legal links) so the frame can bake per-site chrome into the
  // (already site-scoped, lg-shell:{site_id}:…) cached shell. Optional in the
  // TYPE only so hand-built minimal bundles (the auction dry-run in
  // admin/leadgen/auctions-handlers.ts + test fixtures) stay valid; BOTH
  // resolver functions below always populate it.
  site_branding?: SiteBranding;
}

export interface ResolveFunnelArgs {
  site_id: string;
  // Absent/empty → the site's single enabled root activation (NULL slug);
  // otherwise the enabled row whose slug matches.
  quote_slug?: string | null;
  // §16.2 sticky assignment input — the ko_sid session id the runtime already
  // uses (serve.ts reads it from the request cookie). Absent/empty → the
  // single_control seam serves the is_control variant (no running-test bucket is
  // drawn), so preview / no-cookie callers resolve deterministically.
  session_id?: string | null;
  // Round-4 P4a (D-2): the request's ENTRY-KNOWN attributes (CF geo state, UA
  // device, landing-URL UTM, visitor clock hour/weekday). When supplied
  // (serve.ts serveFunnelShell populates it), ENTRY routing rules on the
  // funnel's control variant evaluate over these BEFORE funnel A/B (precedence
  // ladder: entry routing ≻ A/B). Absent (preview, tests, config/attempt reverse
  // lookups) → no entry routing, pure §16 A/B, byte-identical to pre-P4a.
  entry_ctx?: EntryKnownContext;
}

// The single_control §16.3 dims for a KNOWN variant (no running test): ""/0 test
// identity, the variant's own label/allocation, a null bucket. Shared by the
// resolver's single_control branch and the reverse variant lookup (serve.ts).
export function singleControlAssignmentDims(
  variant: LeadgenFunnelVariantRow,
): FunnelAssignment {
  const picked = singleControlAssignment(variant);
  return {
    funnel_ab_test_id: "",
    funnel_ab_test_revision: 0,
    variant_label: variant.variant_label,
    traffic_allocation_bp: variant.traffic_allocation_bp,
    assignment_bucket: picked.assignment_bucket, // null
    assignment_reason: picked.assignment_reason, // "single_control"
  };
}

// The ab_hash §16.3 dims for a KNOWN variant already proven to be an arm of the
// running test — WITHOUT drawing a session bucket (the cacheable /lg/config path
// has no session; the client recomputes the bucket per §16.2 edge/client parity
// from funnel_ab_test_id + revision + its own ko_sid). assignment_bucket=null.
export function abHashAssignmentDims(
  abTest: LeadgenFunnelAbTestRow,
  variant: LeadgenFunnelVariantRow,
): FunnelAssignment {
  return {
    funnel_ab_test_id: abTest.public_id,
    funnel_ab_test_revision: abTest.revision,
    variant_label: variant.variant_label,
    traffic_allocation_bp: variant.traffic_allocation_bp,
    assignment_bucket: null,
    assignment_reason: "ab_hash",
  };
}

// Extract the GA4 measurement id from a settings_overrides_json string, if
// present. Dedicated try/catch → a corrupt blob yields null (never throws,
// never blocks resolution) per the D1 JSON-parse safety rule.
function readGa4MeasurementId(settingsOverridesJson: string | null): string | null {
  if (settingsOverridesJson === null || settingsOverridesJson.trim() === "") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(settingsOverridesJson);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const v = (parsed as Record<string, unknown>)["ga4_measurement_id"];
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

// §17.2 path → enabled leadgen_site_quotes row. Root path (`/lg`, no slug) →
// the enabled NULL-slug row; `/lg/:quote_slug` → the enabled row for that slug.
async function resolveEnabledSiteQuote(
  db: D1Database,
  siteId: string,
  quoteSlug: string | null | undefined,
): Promise<LeadgenSiteQuoteRow | null> {
  if (quoteSlug === undefined || quoteSlug === null || quoteSlug === "") {
    const row = await db
      .prepare(
        `SELECT id, site_id, quote_id, enabled, slug, settings_overrides_json, created_at, updated_at
         FROM leadgen_site_quotes
         WHERE site_id = ? AND slug IS NULL AND enabled = 1 LIMIT 1`,
      )
      .bind(siteId)
      .first<LeadgenSiteQuoteRow>();
    return row ?? null;
  }
  const row = await db
    .prepare(
      `SELECT id, site_id, quote_id, enabled, slug, settings_overrides_json, created_at, updated_at
       FROM leadgen_site_quotes
       WHERE site_id = ? AND slug = ? AND enabled = 1 LIMIT 1`,
    )
    .bind(siteId, quoteSlug)
    .first<LeadgenSiteQuoteRow>();
  return row ?? null;
}

async function getQuoteById(db: D1Database, quoteId: number): Promise<LeadgenQuoteRow | null> {
  // SELECT * (not an explicit list) so the M4 `default_funnel_id` rides the row
  // WHERE it exists and a pre-M4 harness DB simply yields `undefined` (read as
  // "no default funnel" → first active funnel) instead of erroring the resolve —
  // the same pre-migration-serveable discipline the funnel/variant reads use.
  const row = await db
    .prepare(`SELECT * FROM leadgen_quotes WHERE id = ? LIMIT 1`)
    .bind(quoteId)
    .first<LeadgenQuoteRow>();
  return row ?? null;
}

// LeadGen Rework §4.3-1/§5-M4: a Quote may own MULTIPLE active funnels. This is
// the set-returning replacement for the old single-funnel getActiveFunnelForQuote
// (a Quote → ONE active funnel). §4.3 governs SELECTION among them (entry rules
// pre-select; unmatched → the quote's default funnel; see resolveActivatedFunnel).
// Board order = display_order ASC, id ASC (display_order is backfilled to id in
// M4, so this is byte-identical to the old "oldest by id" for single-funnel
// quotes). COALESCE guards a pre-M4 harness DB whose column is absent/NULL.
//
// v2.5 §13.3 projection note: SELECT * so the resolved rows carry the 0041/M4/M5
// columns (frame_config_json/theme_json/display_order/frame_template_id — the
// LeadgenFunnelRow type declares them). SELECT * also keeps pre-0041 harness DBs
// serveable: an absent column simply yields `undefined` (read as NULL → the
// legacy path) rather than erroring the whole resolve.
async function getActiveFunnelsForQuote(db: D1Database, quoteId: number): Promise<LeadgenFunnelRow[]> {
  const result = await db
    .prepare(`SELECT * FROM leadgen_funnels WHERE quote_id = ? AND status = 'active'`)
    .bind(quoteId)
    .all<LeadgenFunnelRow>();
  const rows = result.results ?? [];
  // Board order = display_order ASC then id ASC (M4; display_order backfills to
  // id, so byte-identical to the old "oldest by id" for a single-funnel quote).
  // Sorted in JS (not SQL ORDER BY) so a pre-M4 harness DB with no display_order
  // column never errors — an absent column reads as undefined → sort by id.
  return rows.sort((a, b) => {
    const ao = a.display_order ?? a.id;
    const bo = b.display_order ?? b.id;
    return ao - bo || a.id - b.id;
  });
}

// An active funnel by its internal id (the reverse variant→funnel hop for
// /lg/config + /lg/attempt). Full row so the resolved bundle carries funnel_name.
async function getActiveFunnelById(db: D1Database, funnelId: number): Promise<LeadgenFunnelRow | null> {
  const row = await db
    .prepare(
      `SELECT * FROM leadgen_funnels
       WHERE id = ? AND status = 'active' LIMIT 1`,
    )
    .bind(funnelId)
    .first<LeadgenFunnelRow>();
  return row ?? null;
}

// The variant projection (shared by the control-variant + arms queries so both
// hydrate an identical LeadgenFunnelVariantRow). `*` since 0041 — see the
// projection note above (the row type is the authoritative field list).
const VARIANT_COLUMNS = "*";

// The funnel's PRIMARY active variant — the single_control path when no test
// runs. LeadGen Rework §4.3-10 (M1): there is NO `is_control` concept anymore;
// with no running test a funnel has exactly one active variant (validation
// enforces this — this code tolerates 1..n and picks deterministically). Order
// = variant_label ASC, id ASC (labels A/B/C). Name kept for its existing
// callers (runtime-routes.ts + the reverse-lookup servability check).
export async function getControlVariantForFunnel(
  db: D1Database,
  funnelId: number,
): Promise<LeadgenFunnelVariantRow | null> {
  const row = await db
    .prepare(
      `SELECT ${VARIANT_COLUMNS}
       FROM leadgen_funnel_variants
       WHERE funnel_id = ? AND status = 'active'
       ORDER BY variant_label ASC, id ASC LIMIT 1`,
    )
    .bind(funnelId)
    .first<LeadgenFunnelVariantRow>();
  return row ?? null;
}

// The funnel's single RUNNING A/B test, if any (uq_leadgen_abtest_running caps
// this at 0..1 per funnel). Its arms are the funnel's active variants (below).
async function getRunningAbTestForFunnel(
  db: D1Database,
  funnelId: number,
): Promise<LeadgenFunnelAbTestRow | null> {
  const row = await db
    .prepare(
      `SELECT id, public_id, funnel_id, name, revision, status, started_at, stopped_at, created_at
       FROM leadgen_funnel_ab_tests
       WHERE funnel_id = ? AND status = 'running' LIMIT 1`,
    )
    .bind(funnelId)
    .first<LeadgenFunnelAbTestRow>();
  return row ?? null;
}

// The running test's ARMS = the funnel's active variants (deterministic order —
// variant_label ASC then id ASC, §4.3-10 — so the arm set is stable across
// requests; the §16.2 assignment itself re-sorts by variant_label internally).
async function getActiveVariantsForFunnel(
  db: D1Database,
  funnelId: number,
): Promise<LeadgenFunnelVariantRow[]> {
  const result = await db
    .prepare(
      `SELECT ${VARIANT_COLUMNS}
       FROM leadgen_funnel_variants
       WHERE funnel_id = ? AND status = 'active'
       ORDER BY variant_label ASC, id ASC`,
    )
    .bind(funnelId)
    .all<LeadgenFunnelVariantRow>();
  return result.results ?? [];
}

// The variant's ordered sections (position ASC), each joined to its section
// row. UNIQUE(variant_id, position) guarantees no positional duplicates.
async function getOrderedVariantSections(
  db: D1Database,
  variantId: number,
): Promise<(ResolvedFunnelSection & { variant_section_id: number })[]> {
  const result = await db
    .prepare(
      `SELECT fvs.id AS variant_section_id, fvs.position AS position,
              s.id AS id, s.public_id AS public_id, s.section_name AS section_name,
              s.activity AS activity, s.vertical AS vertical, s.headline_text AS headline_text,
              s.subheadline_text AS subheadline_text, s.image_json AS image_json,
              s.content_json AS content_json, s.content_html AS content_html,
              s.continue_mode AS continue_mode, s.design_overrides_json AS design_overrides_json,
              s.address_validation_enabled AS address_validation_enabled,
              s.section_mapping_version AS section_mapping_version, s.content_version AS content_version,
              s.status AS status, s.created_by AS created_by, s.created_at AS created_at,
              s.updated_at AS updated_at
       FROM leadgen_funnel_variant_sections fvs
       JOIN leadgen_sections s ON s.id = fvs.section_id
       WHERE fvs.variant_id = ? ORDER BY fvs.position ASC`,
    )
    .bind(variantId)
    .all<LeadgenSectionRow & { position: number; variant_section_id: number }>();
  const rows = result.results ?? [];
  return rows.map((r) => {
    const { position, variant_section_id, ...section } = r;
    return { position, variant_section_id, section: section as LeadgenSectionRow };
  });
}

// ---------------------------------------------------------------------------
// Round-4 P3a — page/slot loading (real rows, or a synthetic fallback)
// ---------------------------------------------------------------------------

// Dedicated JSON-object read (D1 JSON-parse safety): a corrupt/absent blob
// yields null — never throws, degrades to "no rules"/"no allocations".
function parseSlotRules(raw: string | null): SlotRules | null {
  if (raw === null || raw.trim() === "") return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) return null;
    const cases = (parsed as { cases?: unknown }).cases;
    const defaultId = (parsed as { default_section_id?: unknown }).default_section_id;
    if (!Array.isArray(cases) || typeof defaultId !== "number") return null;
    return { cases: cases as SlotRuleCase[], default_section_id: defaultId };
  } catch {
    return null;
  }
}

function parseSlotAbAllocations(raw: string | null): SlotAbAllocation[] | null {
  if (raw === null || raw.trim() === "") return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    return parsed as SlotAbAllocation[];
  } catch {
    return null;
  }
}

// Real page + slot rows for a variant (leadgen_funnel_pages/_page_slots).
async function loadRealPageRows(
  db: D1Database,
  variantId: number,
): Promise<{ id: number; public_id: string; position: number; name: string | null }[]> {
  const result = await db
    .prepare(
      `SELECT id, public_id, position, name FROM leadgen_funnel_pages
       WHERE variant_id = ? ORDER BY position ASC`,
    )
    .bind(variantId)
    .all<{ id: number; public_id: string; position: number; name: string | null }>();
  return result.results ?? [];
}

async function loadRealSlotRows(
  db: D1Database,
  pageIds: readonly number[],
): Promise<Map<number, { id: number; position: number; slot_revision: number; rules_json: string | null; ab_allocations_json: string | null }[]>> {
  const byPage = new Map<
    number,
    { id: number; position: number; slot_revision: number; rules_json: string | null; ab_allocations_json: string | null }[]
  >();
  if (pageIds.length === 0) return byPage;
  // Chunked IN(?) <= 80 (D1 100-binding rule).
  for (let i = 0; i < pageIds.length; i += 80) {
    const chunk = pageIds.slice(i, i + 80);
    const marks = chunk.map(() => "?").join(",");
    const result = await db
      .prepare(
        `SELECT id, page_id, position, slot_revision, rules_json, ab_allocations_json
         FROM leadgen_funnel_page_slots WHERE page_id IN (${marks}) ORDER BY position ASC`,
      )
      .bind(...chunk)
      .all<{
        id: number;
        page_id: number;
        position: number;
        slot_revision: number;
        rules_json: string | null;
        ab_allocations_json: string | null;
      }>();
    for (const row of result.results ?? []) {
      const list = byPage.get(row.page_id) ?? [];
      list.push(row);
      byPage.set(row.page_id, list);
    }
  }
  return byPage;
}

// Real candidate variant-section rows for a variant, keyed by their slot_id
// (every row post-migration carries one; see loadVariantPages for the
// pre-page-model fallback branch, which never calls this).
async function loadRealCandidateRows(
  db: D1Database,
  variantId: number,
): Promise<Map<number, ResolvedPageSlotCandidate[]>> {
  const result = await db
    .prepare(
      `SELECT fvs.id AS variant_section_id, fvs.slot_id AS slot_id,
              s.id AS id, s.public_id AS public_id, s.section_name AS section_name,
              s.activity AS activity, s.vertical AS vertical, s.headline_text AS headline_text,
              s.subheadline_text AS subheadline_text, s.image_json AS image_json,
              s.content_json AS content_json, s.content_html AS content_html,
              s.continue_mode AS continue_mode, s.design_overrides_json AS design_overrides_json,
              s.address_validation_enabled AS address_validation_enabled,
              s.section_mapping_version AS section_mapping_version, s.content_version AS content_version,
              s.status AS status, s.created_by AS created_by, s.created_at AS created_at,
              s.updated_at AS updated_at
       FROM leadgen_funnel_variant_sections fvs
       JOIN leadgen_sections s ON s.id = fvs.section_id
       WHERE fvs.variant_id = ? AND fvs.slot_id IS NOT NULL
       ORDER BY fvs.id ASC`,
    )
    .bind(variantId)
    .all<LeadgenSectionRow & { variant_section_id: number; slot_id: number }>();
  const bySlot = new Map<number, ResolvedPageSlotCandidate[]>();
  for (const r of result.results ?? []) {
    const { variant_section_id, slot_id, ...section } = r;
    const list = bySlot.get(slot_id) ?? [];
    list.push({ variant_section_id, section: section as LeadgenSectionRow });
    bySlot.set(slot_id, list);
  }
  return bySlot;
}

// The variant's ordered pages -> ordered slots -> ALL candidate sections.
// Real page/slot rows win when the variant has any (the common, post-P3a
// path). NO real pages -> a SYNTHETIC 1-page/1-fixed-slot-per-row fallback,
// mirroring the migration's own wrap logic in-memory: a variant whose rows
// were seeded directly (bypassing quotes-handlers.ts — several pre-P3a test
// fixtures do this) resolves byte-identically without needing a persisted
// backfill for those specific rows. Synthetic slot ids are negative
// sentinels (real leadgen_funnel_page_slots.id is an AUTOINCREMENT PK, >=1).
export async function loadVariantPages(
  db: D1Database,
  variantId: number,
): Promise<ResolvedFunnelPage[]> {
  const realPages = await loadRealPageRows(db, variantId);
  if (realPages.length === 0) {
    const legacy = await getOrderedVariantSections(db, variantId);
    return legacy.map((row, i) => ({
      id: -(i + 1),
      public_id: `lgpg_v${row.variant_section_id}`,
      position: row.position,
      name: null,
      slots: [
        {
          id: -(i + 1),
          position: 0,
          slot_revision: 0,
          rules: null,
          ab_allocations: null,
          candidates: [{ variant_section_id: row.variant_section_id, section: row.section }],
        },
      ],
    }));
  }

  const slotsByPage = await loadRealSlotRows(
    db,
    realPages.map((p) => p.id),
  );
  const candidatesBySlot = await loadRealCandidateRows(db, variantId);

  return realPages.map((p) => ({
    id: p.id,
    public_id: p.public_id,
    position: p.position,
    name: p.name,
    slots: (slotsByPage.get(p.id) ?? []).map((s) => ({
      id: s.id,
      position: s.position,
      slot_revision: s.slot_revision,
      rules: parseSlotRules(s.rules_json),
      ab_allocations: parseSlotAbAllocations(s.ab_allocations_json),
      candidates: candidatesBySlot.get(s.id) ?? [],
    })),
  }));
}

// ---------------------------------------------------------------------------
// LeadGen Rework §4.3-1/§4.3-2 — the QUOTE-OWNED shared first page
// ---------------------------------------------------------------------------
//
// M2 gave leadgen_funnel_pages / _variant_sections an owner axis (variant_id
// NULLable + quote_id NULLable, exactly-one). A Quote owns its shared first
// page directly (quote_id set, variant_id NULL). The resolved plan is the
// shared page FIRST (§4.3-2) then the served variant's pages — so this loads
// the quote-owned pages with the SAME slot/candidate machinery as the variant
// path (in-page A/B, slot rules, page-plan hash, signed bindings apply to the
// quote page unchanged). Real quote-owned pages win; if none exist but
// quote-owned sections do (a raw-seeded / pre-real-page shape), they wrap into
// ONE synthetic shared page (§4.3-1 "exactly one shared page") — never N pages
// (that is the variant fallback's shape, not the shared page's). A quote with
// NO shared page (every legacy quote, all live data) yields [] here → the plan
// is variant-pages-only, byte-identical to pre-rework (the L-192 legacy seam).
async function loadRealQuotePageRows(
  db: D1Database,
  quoteId: number,
): Promise<{ id: number; public_id: string; position: number; name: string | null }[]> {
  const result = await db
    .prepare(
      `SELECT id, public_id, position, name FROM leadgen_funnel_pages
       WHERE quote_id = ? ORDER BY position ASC`,
    )
    .bind(quoteId)
    .all<{ id: number; public_id: string; position: number; name: string | null }>();
  return result.results ?? [];
}

async function loadRealQuoteCandidateRows(
  db: D1Database,
  quoteId: number,
): Promise<Map<number, ResolvedPageSlotCandidate[]>> {
  const result = await db
    .prepare(
      `SELECT fvs.id AS variant_section_id, fvs.slot_id AS slot_id,
              s.id AS id, s.public_id AS public_id, s.section_name AS section_name,
              s.activity AS activity, s.vertical AS vertical, s.headline_text AS headline_text,
              s.subheadline_text AS subheadline_text, s.image_json AS image_json,
              s.content_json AS content_json, s.content_html AS content_html,
              s.continue_mode AS continue_mode, s.design_overrides_json AS design_overrides_json,
              s.address_validation_enabled AS address_validation_enabled,
              s.section_mapping_version AS section_mapping_version, s.content_version AS content_version,
              s.status AS status, s.created_by AS created_by, s.created_at AS created_at,
              s.updated_at AS updated_at
       FROM leadgen_funnel_variant_sections fvs
       JOIN leadgen_sections s ON s.id = fvs.section_id
       WHERE fvs.quote_id = ? AND fvs.slot_id IS NOT NULL
       ORDER BY fvs.id ASC`,
    )
    .bind(quoteId)
    .all<LeadgenSectionRow & { variant_section_id: number; slot_id: number }>();
  const bySlot = new Map<number, ResolvedPageSlotCandidate[]>();
  for (const r of result.results ?? []) {
    const { variant_section_id, slot_id, ...section } = r;
    const list = bySlot.get(slot_id) ?? [];
    list.push({ variant_section_id, section: section as LeadgenSectionRow });
    bySlot.set(slot_id, list);
  }
  return bySlot;
}

// LeadGen Rework §4.3-11 fix (conductor extension round 3): a REAL shared page
// row (leadgen_funnel_pages, quote_id-owned) whose sections were authored
// DIRECTLY against that page (`leadgen_funnel_variant_sections.page_id` set)
// but with NO `leadgen_funnel_page_slots` row yet — the current shape until
// the shared-page pages+slots admin surface ships (§4.3-1 note: "Route wiring
// for POST/PUT /quotes/:id/shared-page is mid-flight in another round").
// loadRealQuoteCandidateRows requires `slot_id IS NOT NULL` (the fully-
// migrated pages+slots shape), so a page in THIS half-real shape resolved
// ZERO sections — undercounting the §4.3-11 progress total on the LIVE serve
// path relative to /sections/preview's own rough "quote_id section COUNT"
// convenience (sections-handlers.ts resolveSectionPreviewFrame), which counts
// every quote_id row regardless of slot_id. This reader closes that gap:
// every section keyed to a specific page by page_id, position-ordered,
// independent of slot_id.
async function loadDirectPageSections(
  db: D1Database,
  pageId: number,
): Promise<(ResolvedFunnelSection & { variant_section_id: number })[]> {
  const result = await db
    .prepare(
      `SELECT fvs.id AS variant_section_id, fvs.position AS position,
              s.id AS id, s.public_id AS public_id, s.section_name AS section_name,
              s.activity AS activity, s.vertical AS vertical, s.headline_text AS headline_text,
              s.subheadline_text AS subheadline_text, s.image_json AS image_json,
              s.content_json AS content_json, s.content_html AS content_html,
              s.continue_mode AS continue_mode, s.design_overrides_json AS design_overrides_json,
              s.address_validation_enabled AS address_validation_enabled,
              s.section_mapping_version AS section_mapping_version, s.content_version AS content_version,
              s.status AS status, s.created_by AS created_by, s.created_at AS created_at,
              s.updated_at AS updated_at
       FROM leadgen_funnel_variant_sections fvs
       JOIN leadgen_sections s ON s.id = fvs.section_id
       WHERE fvs.page_id = ? ORDER BY fvs.position ASC`,
    )
    .bind(pageId)
    .all<LeadgenSectionRow & { position: number; variant_section_id: number }>();
  const rows = result.results ?? [];
  return rows.map((r) => {
    const { position, variant_section_id, ...section } = r;
    return { position, variant_section_id, section: section as LeadgenSectionRow };
  });
}

// Quote-owned sections ordered by position (the synthetic-fallback source when
// a shared page has sections but no real page/slot rows).
async function getOrderedQuoteSections(
  db: D1Database,
  quoteId: number,
): Promise<(ResolvedFunnelSection & { variant_section_id: number })[]> {
  const result = await db
    .prepare(
      `SELECT fvs.id AS variant_section_id, fvs.position AS position,
              s.id AS id, s.public_id AS public_id, s.section_name AS section_name,
              s.activity AS activity, s.vertical AS vertical, s.headline_text AS headline_text,
              s.subheadline_text AS subheadline_text, s.image_json AS image_json,
              s.content_json AS content_json, s.content_html AS content_html,
              s.continue_mode AS continue_mode, s.design_overrides_json AS design_overrides_json,
              s.address_validation_enabled AS address_validation_enabled,
              s.section_mapping_version AS section_mapping_version, s.content_version AS content_version,
              s.status AS status, s.created_by AS created_by, s.created_at AS created_at,
              s.updated_at AS updated_at
       FROM leadgen_funnel_variant_sections fvs
       JOIN leadgen_sections s ON s.id = fvs.section_id
       WHERE fvs.quote_id = ? ORDER BY fvs.position ASC`,
    )
    .bind(quoteId)
    .all<LeadgenSectionRow & { position: number; variant_section_id: number }>();
  const rows = result.results ?? [];
  return rows.map((r) => {
    const { position, variant_section_id, ...section } = r;
    return { position, variant_section_id, section: section as LeadgenSectionRow };
  });
}

// The quote's shared first page(s), resolved to the SAME ResolvedFunnelPage
// shape the variant path produces. Fail-safe on a pre-M2 DB (no quote_id
// column): the read throws → caller degrades to [] (variant-pages-only plan).
export async function loadSharedPages(db: D1Database, quoteId: number): Promise<ResolvedFunnelPage[]> {
  const realPages = await loadRealQuotePageRows(db, quoteId);
  if (realPages.length > 0) {
    const slotsByPage = await loadRealSlotRows(
      db,
      realPages.map((p) => p.id),
    );
    const candidatesBySlot = await loadRealQuoteCandidateRows(db, quoteId);
    // §4.3-11 fix: a real page with NO real slot rows yet (loadDirectPageSections'
    // header note — the current shared-page authoring shape, page_id set / no
    // leadgen_funnel_page_slots row) falls back to its OWN sections read
    // directly by page_id, one synthetic fixed slot per section — so its
    // progress-bar contribution (and its rendered content) is never silently
    // dropped to zero. At most one shared page exists in practice (§4.3-1), so
    // this sequential per-page await is negligible.
    const directByPage = new Map<number, (ResolvedFunnelSection & { variant_section_id: number })[]>();
    for (const p of realPages) {
      if ((slotsByPage.get(p.id) ?? []).length === 0) {
        directByPage.set(p.id, await loadDirectPageSections(db, p.id));
      }
    }
    return realPages.map((p) => {
      const realSlots = slotsByPage.get(p.id) ?? [];
      if (realSlots.length > 0) {
        return {
          id: p.id,
          public_id: p.public_id,
          position: p.position,
          name: p.name,
          slots: realSlots.map((s) => ({
            id: s.id,
            position: s.position,
            slot_revision: s.slot_revision,
            rules: parseSlotRules(s.rules_json),
            ab_allocations: parseSlotAbAllocations(s.ab_allocations_json),
            candidates: candidatesBySlot.get(s.id) ?? [],
          })),
        };
      }
      const direct = directByPage.get(p.id) ?? [];
      return {
        id: p.id,
        public_id: p.public_id,
        position: p.position,
        name: p.name,
        slots: direct.map((row) => ({
          // Negative sentinel keyed off the real, globally-unique
          // leadgen_funnel_variant_sections.id (never collides with a real
          // leadgen_funnel_page_slots.id, which is a positive AUTOINCREMENT PK,
          // nor with another page's direct-section sentinel).
          id: -row.variant_section_id,
          position: row.position,
          slot_revision: 0,
          rules: null,
          ab_allocations: null,
          candidates: [{ variant_section_id: row.variant_section_id, section: row.section }],
        })),
      };
    });
  }
  // Synthetic fallback: quote-owned sections with no real page → ONE shared
  // page whose fixed slots are the sections in position order (§4.3-1 one page).
  const legacy = await getOrderedQuoteSections(db, quoteId);
  if (legacy.length === 0) return [];
  return [
    {
      id: -1_000_000, // negative sentinel (real page ids are AUTOINCREMENT >= 1)
      public_id: `lgpg_shared_q${quoteId}`,
      position: 0,
      name: null,
      slots: legacy.map((row, i) => ({
        id: -(1_000_000 + i + 1),
        position: i,
        slot_revision: 0,
        rules: null,
        ab_allocations: null,
        candidates: [{ variant_section_id: row.variant_section_id, section: row.section }],
      })),
    },
  ];
}

// Flatten pages -> slots -> ALL candidates into the session-independent flat
// list `ResolvedActivatedFunnel.sections` needs (config-dto/serve/auction
// consumers — see the module-header note). Order: page.position, slot.
// position, candidate insertion order (stable, DB `id ASC`).
export function sectionsFromPages(pages: readonly ResolvedFunnelPage[]): ResolvedFunnelSection[] {
  const out: ResolvedFunnelSection[] = [];
  let position = 0;
  for (const page of pages) {
    for (const slot of page.slots) {
      for (const candidate of slot.candidates) {
        out.push({ position: position++, section: candidate.section });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Round-4 P3a — per-attempt plan resolution (server-side, ONCE per attempt)
// ---------------------------------------------------------------------------

// The entry-known context a slot RULE or slot A/B hash may use. `hour`/
// `weekday` are SERVER-clock (UTC) at resolution time — a DIFFERENT,
// documented semantic from the client-side visitor-LOCAL __hour/__weekday
// P2a added for CTA display rules (those evaluate per-render, client-side;
// this evaluates ONCE, server-side, at plan-resolution time — dayparting for
// WHICH SECTION SHOWS, not a live per-request UI toggle).
export interface EntryKnownContext {
  state?: string;
  device?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_content?: string;
  // M10 (§4.3-3a): the server-derived OS bucket, joined to the entry-known
  // routing universe with the same client/server parity intent as `device`.
  // Optional — a caller that does not derive it (or a pre-M10 reverse lookup)
  // leaves it unset and os-conditioned rules simply never match.
  os?: string;
  hour: number;
  weekday: number;
}

// M10: derive the OS bucket from a User-Agent string, EXACTLY where state/
// device derive (server-side). Match order is contract-M10 VERBATIM — first
// match wins, case-sensitive substrings as written:
//   iPhone/iPad/iPod → ios; Android → android; "Windows NT" → windows;
//   "Mac OS X" → macos; Linux → linux; else other.
// (iOS is tested before macOS because an iPad UA also contains "Mac OS X".)
export type LeadgenOs = "ios" | "android" | "windows" | "macos" | "linux" | "other";
export function deriveOs(userAgent: string | null | undefined): LeadgenOs {
  const ua = userAgent ?? "";
  if (ua.includes("iPhone") || ua.includes("iPad") || ua.includes("iPod")) return "ios";
  if (ua.includes("Android")) return "android";
  if (ua.includes("Windows NT")) return "windows";
  if (ua.includes("Mac OS X")) return "macos";
  if (ua.includes("Linux")) return "linux";
  return "other";
}

export type SlotAssignmentReason = "fixed" | "slot_rule" | "slot_ab";

export interface ResolvedSlotWinner {
  page_id: string;
  slot_id: number;
  section_public_id: string;
  assignment_reason: SlotAssignmentReason;
}

export interface ResolvedPagePlanEntry {
  page_id: string;
  section_public_ids: string[]; // this page's winning sections, in slot order
}

export interface ResolvedPagePlan {
  pages: ResolvedPagePlanEntry[];
  winners: ResolvedSlotWinner[]; // flat, for analytics/engine lookup by section_public_id
  hash: string;
}

// Resolve ONE slot to its winning candidate. Never throws; a malformed/
// inconsistent rules_json (e.g. an unknown default_section_id) degrades to
// the slot's FIRST candidate (fail-safe — a slot must always resolve to
// something rather than leave a page with a missing section).
function resolveSlot(
  page: ResolvedFunnelPage,
  slot: ResolvedPageSlot,
  ctx: EntryKnownContext,
  sessionId: string,
): { section_public_id: string; reason: SlotAssignmentReason } {
  const byId = new Map(slot.candidates.map((c) => [c.section.id, c.section.public_id]));
  const first = slot.candidates[0]?.section.public_id ?? "";

  if (slot.rules !== null) {
    const flatCtx: Record<string, unknown> = {
      state: ctx.state ?? "",
      device: ctx.device ?? "",
      utm_source: ctx.utm_source ?? "",
      utm_medium: ctx.utm_medium ?? "",
      utm_content: ctx.utm_content ?? "",
      hour: ctx.hour,
      weekday: ctx.weekday,
    };
    for (const c of slot.rules.cases) {
      if (conditionsMatch(c.conditions, flatCtx)) {
        return { section_public_id: byId.get(c.section_id) ?? first, reason: "slot_rule" };
      }
    }
    return { section_public_id: byId.get(slot.rules.default_section_id) ?? first, reason: "slot_rule" };
  }

  if (slot.ab_allocations !== null && slot.ab_allocations.length > 0) {
    // Per-slot decorrelation (refines the dispatch's page_id:slot_revision:
    // session_id shorthand — a page with TWO A/B slots at the same revision
    // would otherwise draw the IDENTICAL bucket for both; slot.id makes each
    // slot's hash independent, matching the stated "per-slot decorrelation"
    // property literally).
    const bucket = abBucket(`${page.public_id}:${slot.id}`, slot.slot_revision, sessionId);
    const shims = slot.ab_allocations.map((a) => ({
      variant_label: String(a.section_id),
      traffic_allocation_bp: a.bp,
    }));
    const picked = pickVariantByBucket(bucket, shims);
    const sectionId = Number(picked.variant_label);
    return { section_public_id: byId.get(sectionId) ?? first, reason: "slot_ab" };
  }

  // Fixed slot (0 or 1 candidate — validated at save to be exactly 1).
  return { section_public_id: first, reason: "fixed" };
}

// The FULL per-attempt resolution: every page's every slot resolved ONCE
// (rules-first, else A/B, else fixed), producing the ordered page plan +
// its deterministic hash (attempt.ts signs this hash into the token).
export function resolvePagePlan(
  pages: readonly ResolvedFunnelPage[],
  ctx: EntryKnownContext,
  sessionId: string,
): ResolvedPagePlan {
  const planPages: ResolvedPagePlanEntry[] = [];
  const winners: ResolvedSlotWinner[] = [];
  for (const page of pages) {
    const sectionIds: string[] = [];
    for (const slot of page.slots) {
      if (slot.candidates.length === 0) continue; // an empty slot contributes nothing (defensive)
      const { section_public_id, reason } = resolveSlot(page, slot, ctx, sessionId);
      sectionIds.push(section_public_id);
      winners.push({
        page_id: page.public_id,
        slot_id: slot.id,
        section_public_id,
        assignment_reason: reason,
      });
    }
    planPages.push({ page_id: page.public_id, section_public_ids: sectionIds });
  }
  const hash = sha256Hex(
    JSON.stringify(winners.map((w) => `${w.page_id}:${w.slot_id}:${w.section_public_id}`)),
  );
  return { pages: planPages, winners, hash };
}

// Parse utm_source/medium/content off a landing URL's query string — the
// SAME 3-dim vocabulary the client's acquisitionParams(location.search) /
// runtime-context.ts traffic slice already use. Malformed/absent -> {} (never
// throws; a slot rule referencing an unparseable field just evaluates false).
export function parseUtmFromLandingUrl(landingUrl: string): Pick<EntryKnownContext, "utm_source" | "utm_medium" | "utm_content"> {
  if (landingUrl === "") return {};
  try {
    const params = new URL(landingUrl).searchParams;
    const out: Pick<EntryKnownContext, "utm_source" | "utm_medium" | "utm_content"> = {};
    const source = params.get("utm_source");
    const medium = params.get("utm_medium");
    const content = params.get("utm_content");
    if (source !== null && source !== "") out.utm_source = source;
    if (medium !== null && medium !== "") out.utm_medium = medium;
    if (content !== null && content !== "") out.utm_content = content;
    return out;
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Round-4 P4a (D-2, operator-locked) — funnel ROUTING rules (rule model v2)
// ---------------------------------------------------------------------------
//
// The reference's core behavior the §15.5 model lacked: condition-driven
// routing to a funnel NAME/variant ("rules of which funnel name each user
// sees", Image42). A `route_funnel_variant` rule = §21.4 condition groups over
// a FIELD REGISTRY + { target_funnel_variant_id, value_multiplier, priority
// (1 high..100), status }. Two evaluation PLANES, auto-partitioned by the
// rule's condition fields (the CHECKPOINT is auto-derived, never authored):
//   * ENTRY plane      — every condition field is ENTRY-KNOWN. Evaluated in
//                        resolveActivatedFunnel BEFORE §16 A/B (precedence
//                        ladder: entry routing ≻ A/B).
//   * CHECKPOINT plane — >=1 condition field is an ANSWER field (e.g. `age`).
//                        Evaluated server-side at /lg/checkpoint when the engine
//                        crosses the rule's derived checkpoint page.
//
// FIELD REGISTRY (the D-2 "ANY answer field + state/geo + device + UTM +
// age + hour/weekday"): the ENTRY-KNOWN attribute set is CLOSED (below);
// EVERYTHING ELSE is an answer internal_field (open set — any section field,
// incl. MQG rows / Address roles / a `age` question's field). Per the dispatch,
// `age` is entry-known ONLY if a mapped entry attribute exists — this codebase
// has none, so `age` is simply an answer field (a rule on it is CHECKPOINT-plane).
//
// UTM VOCABULARY (binding note): the operator's phrasing is "UTM source/medium/
// campaign", but this codebase's established 3-dim taxonomy is utm_source/
// utm_medium/utm_CONTENT (ab-hash.ts / runtime-context.ts / parseUtmFromLandingUrl).
// BOTH `utm_campaign` and `utm_content` are registry fields; the evaluation
// context binds them to the SAME parsed value (utm_content), so a rule authored
// with either name resolves against the one dimension the resolver actually parses.
export const ROUTING_ENTRY_KNOWN_FIELDS: ReadonlySet<string> = new Set([
  "state",
  "device",
  "utm_source",
  "utm_medium",
  "utm_content",
  "utm_campaign", // documented alias of utm_content
  "hour",
  "weekday",
]);

// A route_funnel_variant rule as READ for server evaluation. A LOCAL type (not
// db-types.ts's LeadgenFunnelRuleRow, which P4b extends for the admin API) so
// this slice's server reads are self-contained over the 0043 columns.
export interface RoutingRuleRow {
  public_id: string;
  variant_id: number;
  conditions_json: string;
  conditions_hash: string;
  target_funnel_variant_id: number | null;
  value_multiplier: number | null;
  priority: number;
  status: string;
  // Optional (not just nullable): loadRoutingRules' SELECT always returns it,
  // but OTHER in-repo callers construct a RoutingRuleRow-shaped literal by
  // hand (e.g. admin save-time validation, pre-INSERT) without a column value
  // yet to hand — parseRoutingRule treats absent exactly like null ("all").
  match_mode?: string | null;
}

export interface ParsedRoutingRule {
  hash: string;
  priority: number;
  conditions: LeadgenRuleConditions;
  target_funnel_variant_id: number | null;
  value_multiplier: number | null;
  // true iff EVERY condition field is entry-known (=> ENTRY plane); false iff
  // any condition field is an answer field (=> CHECKPOINT plane).
  entry_only: boolean;
  // P4b persists 'any'|NULL on the row; NULL/absent/anything else normalizes
  // to "all" here (§21.4's existing AND-across-fields default) so a rule
  // saved before this column meant anything, or with a corrupt value,
  // evaluates exactly as it always has. Optional so a caller building this
  // shape by hand for a match_mode-irrelevant purpose (e.g. admin save-time
  // checkpoint-page derivation, which only reads `conditions`) need not name
  // it; parseRoutingRule (the only DB-row constructor) always sets it.
  match_mode?: "any" | "all";
}

// D1 JSON-parse safety: a corrupt/absent blob degrades to "no conditions"
// (never throws). Empty groups = a catch-all rule (matches all traffic).
function parseRoutingConditions(raw: string): LeadgenRuleConditions {
  try {
    const p = JSON.parse(raw) as unknown;
    if (p !== null && typeof p === "object" && Array.isArray((p as { groups?: unknown }).groups)) {
      return p as LeadgenRuleConditions;
    }
  } catch {
    /* fall through */
  }
  return { groups: [] };
}

// A rule is ENTRY-plane iff every condition field is entry-known. A rule with
// NO conditions is a catch-all → ENTRY plane (matches all entry traffic; a
// useful lowest-priority default route).
function isEntryOnly(conditions: LeadgenRuleConditions): boolean {
  for (const g of conditions.groups ?? []) {
    if (!ROUTING_ENTRY_KNOWN_FIELDS.has(g.field)) return false;
  }
  return true;
}

export function parseRoutingRule(row: RoutingRuleRow): ParsedRoutingRule {
  const conditions = parseRoutingConditions(row.conditions_json);
  return {
    hash: row.conditions_hash,
    priority: row.priority,
    conditions,
    target_funnel_variant_id: row.target_funnel_variant_id,
    value_multiplier: row.value_multiplier,
    entry_only: isEntryOnly(conditions),
    match_mode: row.match_mode === "any" ? "any" : "all",
  };
}

// A variant's ACTIVE route_funnel_variant rules, priority ASC (1 = highest).
// Dedicated try/catch (D1 safety discipline, matching computeAttemptBindingExtras):
// this is called from `resolveActivatedFunnel`'s ENTRY-ROUTING branch, which
// EVERY /lg shell-serve now reaches — a query failure (e.g. a DB not yet on
// migration 0043's target_funnel_variant_id column, a transient rolling-
// deploy window, or any other read hiccup) must degrade to "no routing rules"
// rather than 500 the ENTIRE funnel shell for every visitor. Fail-safe, never
// fail-closed here: an unreadable rule set is NOT a security concern (it can
// only ever suppress a routing effect, never fabricate one).
//
// `enabled = 1 AND status != 'disabled'` — TWO independently-writable "is
// this rule on" signals (enabled: 0036 legacy INTEGER; status: 0043 additive
// TEXT), unified the same way as the auction-layer §19-step-4 SELECT
// (auction/engine.ts). The admin save path can leave `enabled` at its
// stale/default value while the rules-builder UI's Disable/Enable button
// writes ONLY {status} — so a rule must be affirmatively on by BOTH to
// route; either axis being "off" excludes it.
export async function loadRoutingRules(db: D1Database, variantId: number): Promise<ParsedRoutingRule[]> {
  try {
    const res = await db
      .prepare(
        `SELECT public_id, variant_id, conditions_json, conditions_hash,
                target_funnel_variant_id, value_multiplier, priority, status, match_mode
         FROM leadgen_funnel_rules
         WHERE variant_id = ? AND rule_type = 'route_funnel_variant' AND enabled = 1 AND status != 'disabled'
         ORDER BY priority ASC, id ASC`,
      )
      .bind(variantId)
      .all<RoutingRuleRow>();
    return (res.results ?? []).map(parseRoutingRule);
  } catch {
    return [];
  }
}

// The entry-attribute evaluation map (bare field names — "state"/"utm_source"/
// … — the SAME names the slot-rule ctx uses). utm_campaign mirrors utm_content.
function entryFlatCtx(ctx: EntryKnownContext): Record<string, unknown> {
  const content = ctx.utm_content ?? "";
  return {
    state: ctx.state ?? "",
    device: ctx.device ?? "",
    utm_source: ctx.utm_source ?? "",
    utm_medium: ctx.utm_medium ?? "",
    utm_content: content,
    utm_campaign: content,
    os: ctx.os ?? "", // M10 — joined to the entry-known evaluation context
    hour: ctx.hour,
    weekday: ctx.weekday,
  };
}

export interface RoutingMatch {
  target_funnel_variant_id: number;
  hash: string;
  value_multiplier: number | null;
}

// Priority ASC (1 = highest precedence) is an INTRINSIC guarantee of the
// evaluators below, not an implicit contract with the caller's SQL ordering
// (loadRoutingRules ALSO orders by priority — this is a defensive, cheap
// re-sort so a future/alternate caller can never silently break "priority
// (1 high..100)" by handing over an unsorted array). A stable sort (Array.
// prototype.sort is stable since ES2019) preserves relative order for a
// genuine priority TIE, which detectRoutingRuleConflicts flags at save-time
// as non-deterministic — the evaluator does not need its own tie-break rule.
function byPriorityAsc(rules: readonly ParsedRoutingRule[]): ParsedRoutingRule[] {
  return [...rules].sort((a, b) => a.priority - b.priority);
}

// ENTRY plane: the highest-priority entry-only rule matching the request
// attributes AND naming a target — or null (a null-target rule can never route).
export function evaluateEntryRouting(
  rules: readonly ParsedRoutingRule[],
  ctx: EntryKnownContext,
): RoutingMatch | null {
  const flat = entryFlatCtx(ctx);
  for (const r of byPriorityAsc(rules)) {
    if (!r.entry_only || r.target_funnel_variant_id === null) continue;
    if (conditionsMatch(r.conditions, flat, r.match_mode)) {
      return {
        target_funnel_variant_id: r.target_funnel_variant_id,
        hash: r.hash,
        value_multiplier: r.value_multiplier,
      };
    }
  }
  return null;
}

// CHECKPOINT plane: the highest-priority checkpoint rule (>=1 answer field)
// matching the entry attributes UNION the server-re-normalized posted answers
// AND naming a target — or null.
export function evaluateCheckpointRouting(
  rules: readonly ParsedRoutingRule[],
  ctx: EntryKnownContext,
  answers: Readonly<Record<string, unknown>>,
): RoutingMatch | null {
  const flat = { ...entryFlatCtx(ctx), ...answers };
  for (const r of byPriorityAsc(rules)) {
    if (r.entry_only || r.target_funnel_variant_id === null) continue;
    if (conditionsMatch(r.conditions, flat, r.match_mode)) {
      return {
        target_funnel_variant_id: r.target_funnel_variant_id,
        hash: r.hash,
        value_multiplier: r.value_multiplier,
      };
    }
  }
  return null;
}

// internal_field -> page index (0-based, page.position order) over a variant's
// pages: a field becomes answerable at the page whose ANY candidate section
// maps it; a field on multiple pages maps to its MAX (last) page (all known
// only after the last). Uses config-dto's ONE parser/expander (MQG rows +
// Address roles expand to their real internal_fields). STABLE across attempts
// (candidate-based, not winner-based) — the engine page index == this index.
function fieldToPageIndex(pages: readonly ResolvedFunnelPage[]): Map<string, number> {
  const out = new Map<string, number>();
  pages.forEach((page, idx) => {
    for (const slot of page.slots) {
      for (const c of slot.candidates) {
        for (const node of parseSectionComponents(c.section.content_json ?? "")) {
          for (const comp of expandPublicComponents(node)) {
            const f = comp.internal_field;
            if (f !== undefined && f !== "") out.set(f, idx); // later page overwrites -> max
          }
        }
      }
    }
  });
  return out;
}

// The auto-derived checkpoint page for ONE checkpoint rule: the MAX page over
// its ANSWER-field conditions (entry-known fields are always known → skipped);
// an answer field absent from every page falls back to the LAST page (safe:
// the rule still gets exactly one evaluation, at the end, and a condition on a
// missing field simply won't match). Entry-only rules never reach here.
export function deriveRuleCheckpointPage(
  rule: ParsedRoutingRule,
  fieldToPage: ReadonlyMap<string, number>,
  lastPageIndex: number,
): number {
  let max = -1;
  for (const g of rule.conditions.groups ?? []) {
    if (ROUTING_ENTRY_KNOWN_FIELDS.has(g.field)) continue;
    const p = fieldToPage.get(g.field);
    max = Math.max(max, p === undefined ? lastPageIndex : p);
  }
  return max === -1 ? lastPageIndex : max;
}

// The DISTINCT set of checkpoint page indexes (server-computed) the /lg/attempt
// echo carries so the engine knows WHICH page-completions to POST at. Empty
// when the variant has no checkpoint-plane routing rules.
export function deriveCheckpointPages(
  pages: readonly ResolvedFunnelPage[],
  rules: readonly ParsedRoutingRule[],
): number[] {
  const checkpointRules = rules.filter((r) => !r.entry_only && r.target_funnel_variant_id !== null);
  if (checkpointRules.length === 0 || pages.length === 0) return [];
  const f2p = fieldToPageIndex(pages);
  const lastPage = pages.length - 1;
  const set = new Set<number>();
  for (const r of checkpointRules) set.add(deriveRuleCheckpointPage(r, f2p, lastPage));
  return [...set].filter((p) => p >= 0).sort((a, b) => a - b);
}

// P4a: the prefix-rule RESUME point after a mid-funnel switch — the target
// plan's FIRST page carrying any unanswered REQUIRED field (carried answers by
// field name; no question repeats). Returns "" when EVERY target required field
// is already satisfied → the attempt proceeds directly to the auction. Winners
// are the FLAT per-slot list (attempt.ts page_plan); pages carry the section
// rows the required-field extraction reads (config-dto's ONE expander).
export function computeResumeSection(
  winners: readonly ResolvedSlotWinner[],
  pages: readonly ResolvedFunnelPage[],
  answers: Readonly<Record<string, unknown>>,
): string {
  const reqBySection = new Map<string, string[]>();
  for (const page of pages) {
    for (const slot of page.slots) {
      for (const c of slot.candidates) {
        if (reqBySection.has(c.section.public_id)) continue;
        const req: string[] = [];
        for (const node of parseSectionComponents(c.section.content_json ?? "")) {
          for (const comp of expandPublicComponents(node)) {
            if (comp.required === true && comp.internal_field !== undefined && comp.internal_field !== "") {
              req.push(comp.internal_field);
            }
          }
        }
        reqBySection.set(c.section.public_id, req);
      }
    }
  }
  const answered = (f: string): boolean => {
    const v = answers[f];
    return v !== undefined && v !== null && String(v) !== "";
  };
  // Group winners into pages in first-seen page_id order (== page order).
  const order: string[] = [];
  const byPage = new Map<string, string[]>();
  for (const w of winners) {
    let list = byPage.get(w.page_id);
    if (list === undefined) {
      list = [];
      byPage.set(w.page_id, list);
      order.push(w.page_id);
    }
    list.push(w.section_public_id);
  }
  for (const pid of order) {
    const sids = byPage.get(pid) ?? [];
    for (const sid of sids) {
      const req = reqBySection.get(sid) ?? [];
      if (req.some((f) => !answered(f))) return sids[0] ?? sid;
    }
  }
  return "";
}

// Convert checkpoint PAGE NUMBERS (deriveCheckpointPages) to their ANCHOR
// (first winning) section_public_id, over the RESOLVED plan's page entries —
// the wire form the engine echo carries. Byte-lean by design: the client can
// then gate on `currentSection().section_public_id` membership directly (it
// is always the page's anchor per the P3a same-screen-page model — the FIRST
// section of whatever page store.setSectionIndex entered), with NO client-side
// page-number lookup at all. A page number outside the resolved plan (should
// not happen — checkpoint pages are derived from the SAME variant's pages)
// is defensively skipped rather than emitting an unresolvable anchor.
export function checkpointPageAnchors(
  checkpointPageIndexes: readonly number[],
  planPages: readonly ResolvedPagePlanEntry[],
): string[] {
  const out: string[] = [];
  for (const idx of checkpointPageIndexes) {
    const sid = planPages[idx]?.section_public_ids[0];
    if (sid !== undefined) out.push(sid);
  }
  return out;
}

// Save-time CONFLICT flagging (exported for P4b's Problems mechanism): two
// rules at the SAME checkpoint (both entry, or same derived page) with the
// SAME priority and OVERLAPPING condition fields have no deterministic winner.
// A DISTINCT priority resolves the order → no conflict. Plain-language output.
export interface RoutingConflictInput {
  rule_name: string;
  checkpoint_page: number | null; // null == entry plane
  priority: number;
  fields: readonly string[]; // condition field names
}
export function detectRoutingRuleConflicts(rules: readonly RoutingConflictInput[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < rules.length; i++) {
    for (let j = i + 1; j < rules.length; j++) {
      const a = rules[i]!;
      const b = rules[j]!;
      if (a.priority !== b.priority) continue; // distinct priority => deterministic
      const ca = a.checkpoint_page === null ? "entry" : String(a.checkpoint_page);
      const cb = b.checkpoint_page === null ? "entry" : String(b.checkpoint_page);
      if (ca !== cb) continue; // different evaluation points never race
      if (!a.fields.some((f) => b.fields.includes(f))) continue; // no overlap
      out.push(
        `Rules "${a.rule_name || "(unnamed)"}" and "${b.rule_name || "(unnamed)"}" evaluate at the same point with the same priority and overlapping conditions — the winner is not deterministic. Give one a higher priority (a lower number wins).`,
      );
    }
  }
  return out;
}

// P4a (D-2): is `variantId` the ACTIVE target of an ACTIVE route_funnel_variant
// rule belonging to ANY variant of THIS funnel? Used to WIDEN
// resolveActivatedFunnelByVariant's anti-leak servability check (below): a
// routing rule's target is an author-approved serving destination — it must
// be reachable even when it is not the funnel's control variant and no §16
// A/B test is running (the entry/checkpoint routing PLANE is its own
// authorization, orthogonal to the §16 arm-set check). This does NOT weaken
// the anti-leak invariant's real purpose (hiding draft/non-participating
// variants): an ACTIVE variant named by an ACTIVE rule is, by construction,
// an intended destination — the only thing bypassed by knowing its `lgn_` id
// directly is the CONDITION MATCH, which is a targeting mechanism, not an
// access-control boundary (entry conditions are themselves client-observable
// signals like UTM params).
// Dedicated try/catch (see loadRoutingRules): this gates a SERVABILITY check
// inside resolveActivatedFunnelByVariant, reached by every /lg/config +
// /lg/attempt + /lg/auction reverse lookup. A query failure (e.g. pre-0043
// schema) must degrade to "not a routing target" — i.e. fall through to the
// PRE-EXISTING anti-leak reject — never 500 the whole reverse lookup.
async function isActiveRoutingTargetOnFunnel(db: D1Database, funnelId: number, variantId: number): Promise<boolean> {
  try {
    const row = await db
      .prepare(
        `SELECT 1 FROM leadgen_funnel_rules r
         JOIN leadgen_funnel_variants v ON v.id = r.variant_id
         WHERE v.funnel_id = ? AND r.rule_type = 'route_funnel_variant' AND r.status = 'active'
           AND r.target_funnel_variant_id = ? LIMIT 1`,
      )
      .bind(funnelId, variantId)
      .first();
    return row !== null;
  } catch {
    return false;
  }
}

// Resolve a specific target variant by its internal id, constrained to an
// ACTIVE variant of THIS funnel (a routing rule can only route within its own
// funnel's variants — anti-leak: never serves a foreign/inactive variant).
export async function getActiveVariantByIdOnFunnel(
  db: D1Database,
  funnelId: number,
  variantId: number,
): Promise<LeadgenFunnelVariantRow | null> {
  const row = await db
    .prepare(
      `SELECT ${VARIANT_COLUMNS} FROM leadgen_funnel_variants
       WHERE id = ? AND funnel_id = ? AND status = 'active' LIMIT 1`,
    )
    .bind(variantId, funnelId)
    .first<LeadgenFunnelVariantRow>();
  return row ?? null;
}

// ---------------------------------------------------------------------------
// LeadGen Rework §4.3-4/§4.3-9 — QUOTE-scoped multi-action routing (rule v3)
// ---------------------------------------------------------------------------
//
// Routing moved from per-VARIANT single-action rules (leadgen_funnel_rules,
// removed from that table in M3) to QUOTE-scoped multi-action rules
// (leadgen_quote_routing_rules). A rule targets a FUNNEL (target_funnel_id),
// carries a full action set (target_funnel / feed_name / value_multiplier /
// redirect_pct + redirect_target), and its PLANE is derived from its condition
// fields (rule-checkpoint.ts). Selection (§4.3-4): priority ASC (1 = highest;
// tie → lower id first, the SELECT's `ORDER BY priority ASC, id ASC`), the
// first matching rule applies its ENTIRE action set, no merging across rules.

// A quote routing rule as READ for server evaluation. `entry_only` = every
// condition field is entry-known (os-inclusive, §4.3-3a) → ENTRY plane; else a
// CHECKPOINT-plane rule (shared or in-funnel).
export interface ParsedQuoteRule {
  public_id: string;
  hash: string;
  priority: number;
  conditions: LeadgenRuleConditions;
  match_mode: "any" | "all";
  entry_only: boolean;
  // action set (each optional individually; ≥1 enforced at save by S1.4):
  target_funnel_id: number | null;
  feed_name: string | null;
  value_multiplier: number | null;
  redirect_pct: number | null;
  target_offer_id: number | null;
  redirect_url: string | null;
  redirect_url_allowlisted: boolean;
}

interface QuoteRuleRow {
  public_id: string;
  conditions_json: string;
  conditions_hash: string;
  priority: number;
  match_mode: string | null;
  target_funnel_id: number | null;
  feed_name: string | null;
  value_multiplier: number | null;
  redirect_pct: number | null;
  target_offer_id: number | null;
  redirect_url: string | null;
  redirect_url_allowlisted: number | null;
}

function conditionFieldsOf(conditions: LeadgenRuleConditions): string[] {
  return (conditions.groups ?? []).map((g) => g.field);
}

export function parseQuoteRoutingRule(row: QuoteRuleRow): ParsedQuoteRule {
  const conditions = parseRoutingConditions(row.conditions_json);
  return {
    public_id: row.public_id,
    hash: row.conditions_hash,
    priority: row.priority,
    conditions,
    match_mode: row.match_mode === "any" ? "any" : "all",
    entry_only: isQuoteRuleEntryPlane(conditionFieldsOf(conditions)),
    target_funnel_id: row.target_funnel_id,
    feed_name: row.feed_name,
    value_multiplier: row.value_multiplier,
    redirect_pct: row.redirect_pct,
    target_offer_id: row.target_offer_id,
    redirect_url: row.redirect_url,
    redirect_url_allowlisted: row.redirect_url_allowlisted === 1,
  };
}

// A quote's ACTIVE routing rules, priority ASC then id ASC (§4.3-4). Fail-safe
// (loadRoutingRules discipline): a query failure (a pre-M3 DB with no
// leadgen_quote_routing_rules table, a transient read hiccup) degrades to "no
// rules" rather than 500ing every /lg shell serve — an unreadable rule set can
// only ever SUPPRESS a routing effect, never fabricate one.
export async function loadQuoteRoutingRules(db: D1Database, quoteId: number): Promise<ParsedQuoteRule[]> {
  try {
    const res = await db
      .prepare(
        `SELECT public_id, conditions_json, conditions_hash, priority, match_mode,
                target_funnel_id, feed_name, value_multiplier, redirect_pct,
                target_offer_id, redirect_url, redirect_url_allowlisted
         FROM leadgen_quote_routing_rules
         WHERE quote_id = ? AND status = 'active'
         ORDER BY priority ASC, id ASC`,
      )
      .bind(quoteId)
      .all<QuoteRuleRow>();
    return (res.results ?? []).map(parseQuoteRoutingRule);
  } catch {
    return [];
  }
}

// The matched rule's ENTIRE action set (§4.3-9) — never a partial merge.
export interface QuoteRoutingMatch {
  target_funnel_id: number;
  hash: string;
  feed_name: string | null;
  value_multiplier: number | null;
  redirect_pct: number | null;
  target_offer_id: number | null;
  redirect_url: string | null;
  redirect_url_allowlisted: boolean;
}

function quoteMatch(r: ParsedQuoteRule): QuoteRoutingMatch {
  return {
    target_funnel_id: r.target_funnel_id as number, // caller guards target_funnel_id !== null
    hash: r.hash,
    feed_name: r.feed_name,
    value_multiplier: r.value_multiplier,
    redirect_pct: r.redirect_pct,
    target_offer_id: r.target_offer_id,
    redirect_url: r.redirect_url,
    redirect_url_allowlisted: r.redirect_url_allowlisted,
  };
}

// ENTRY plane (§4.3-3a): the highest-priority entry-only rule matching the
// request attributes AND naming a target funnel — or null. Rules already arrive
// priority-sorted from loadQuoteRoutingRules; the defensive re-sort keeps §4.3-4
// intact for a future/alternate caller handing over an unsorted array (a stable
// sort preserves id-order for a genuine priority tie).
export function evaluateQuoteEntryRouting(
  rules: readonly ParsedQuoteRule[],
  ctx: EntryKnownContext,
): QuoteRoutingMatch | null {
  const flat = entryFlatCtx(ctx);
  for (const r of [...rules].sort((a, b) => a.priority - b.priority)) {
    if (!r.entry_only || r.target_funnel_id === null) continue;
    if (conditionsMatch(r.conditions, flat, r.match_mode)) return quoteMatch(r);
  }
  return null;
}

// CHECKPOINT plane (§4.3-3b/c): the highest-priority checkpoint rule (>=1 answer
// field) matching entry attributes UNION the server-re-normalized answers AND
// naming a target funnel — or null. Evaluating over the CURRENTLY-answered
// fields scopes a class-(c) in-funnel rule to a visitor whose current funnel
// actually collects those fields (an unanswered field never matches).
export function evaluateQuoteCheckpointRouting(
  rules: readonly ParsedQuoteRule[],
  ctx: EntryKnownContext,
  answers: Readonly<Record<string, unknown>>,
): QuoteRoutingMatch | null {
  const flat = { ...entryFlatCtx(ctx), ...answers };
  for (const r of [...rules].sort((a, b) => a.priority - b.priority)) {
    if (r.entry_only || r.target_funnel_id === null) continue;
    if (conditionsMatch(r.conditions, flat, r.match_mode)) return quoteMatch(r);
  }
  return null;
}

// The DISTINCT checkpoint page indexes (over the RESOLVED plan's combined pages)
// the /lg/attempt echo carries so the engine knows which page-completions to
// POST /lg/ck at. Quote-rule twin of deriveCheckpointPages: os-inclusive
// entry-known skip (§4.3-3a) so an `os` condition alongside an answer field
// never mis-derives the checkpoint to the last page. Empty when the quote has
// no checkpoint-plane rules.
export function deriveQuoteCheckpointPages(
  pages: readonly ResolvedFunnelPage[],
  rules: readonly ParsedQuoteRule[],
): number[] {
  const checkpointRules = rules.filter((r) => !r.entry_only && r.target_funnel_id !== null);
  if (checkpointRules.length === 0 || pages.length === 0) return [];
  const f2p = fieldToPageIndex(pages);
  const lastPage = pages.length - 1;
  const set = new Set<number>();
  for (const r of checkpointRules) {
    let max = -1;
    for (const g of r.conditions.groups ?? []) {
      if (ENTRY_KNOWN_ROUTING_FIELDS.has(g.field)) continue;
      const p = f2p.get(g.field);
      max = Math.max(max, p === undefined ? lastPage : p);
    }
    set.add(max === -1 ? lastPage : max);
  }
  return [...set].filter((p) => p >= 0).sort((a, b) => a - b);
}

// A/B-assign a variant within a funnel at funnel ENTRY (§4.3-10): a RUNNING test
// buckets the session across the funnel's active variants (ab_hash); with no
// running test the single active variant serves (single_control — no control
// concept, getControlVariantForFunnel orders variant_label ASC). Returns null
// only when the funnel has NO active variant (a mis-activated funnel → 404).
async function assignVariantForFunnel(
  db: D1Database,
  funnel: LeadgenFunnelRow,
  sessionId: string,
): Promise<{ variant: LeadgenFunnelVariantRow; assignment: FunnelAssignment } | null> {
  const abTest = sessionId === "" ? null : await getRunningAbTestForFunnel(db, funnel.id);
  if (abTest !== null) {
    const arms = await getActiveVariantsForFunnel(db, funnel.id);
    if (arms.length === 0) return null;
    const picked = assignVariant(abTest.public_id, abTest.revision, sessionId, arms);
    return {
      variant: picked.variant,
      assignment: {
        funnel_ab_test_id: abTest.public_id,
        funnel_ab_test_revision: abTest.revision,
        variant_label: picked.variant.variant_label,
        traffic_allocation_bp: picked.variant.traffic_allocation_bp,
        assignment_bucket: picked.assignment_bucket, // §16.2 bucket 0..9999
        assignment_reason: picked.assignment_reason, // "ab_hash"
      },
    };
  }
  const control = await getControlVariantForFunnel(db, funnel.id);
  if (control === null) return null;
  return { variant: control, assignment: singleControlAssignmentDims(control) };
}

// LeadGen Rework §4.3-8/§4.3-10: the served variant of a target funnel at
// funnel ENTRY — used by the /lg/ck checkpoint SWITCH to pick the variant of
// the funnel a matched checkpoint rule routes to (A/B applies at funnel entry).
// The funnel must be ACTIVE (getActiveFunnelById); null on an inactive/missing
// funnel or a funnel with no active variant. The caller re-resolves the full
// bundle via resolveActivatedFunnelByVariant(variant.public_id).
export async function resolveFunnelEntryVariant(
  db: D1Database,
  funnelId: number,
  sessionId: string,
): Promise<LeadgenFunnelVariantRow | null> {
  const funnel = await getActiveFunnelById(db, funnelId);
  if (funnel === null) return null;
  const assigned = await assignVariantForFunnel(db, funnel, sessionId);
  return assigned?.variant ?? null;
}

// Compose the resolved bundle: the quote's shared first page FIRST (§4.3-2)
// then the served variant's pages, flattened to the session-independent
// sections list. Shared-page load is fail-safe (a pre-M2 DB with no quote_id
// column → variant-pages-only plan, the L-192 legacy seam). §10.2 branding
// rides the bundle. Byte-identical to pre-rework for a quote with no shared page.
async function composeResolvedBundle(
  db: D1Database,
  siteId: string,
  siteQuote: LeadgenSiteQuoteRow,
  quote: LeadgenQuoteRow,
  funnel: LeadgenFunnelRow,
  variant: LeadgenFunnelVariantRow,
  assignment: FunnelAssignment,
): Promise<ResolvedActivatedFunnel> {
  let sharedPages: ResolvedFunnelPage[] = [];
  try {
    sharedPages = await loadSharedPages(db, quote.id);
  } catch {
    sharedPages = [];
  }
  const variantPages = await loadVariantPages(db, variant.id);
  const pages = [...sharedPages, ...variantPages];
  const sections = sectionsFromPages(pages);
  const siteBranding = await resolveSiteBranding(db, siteId);
  return {
    site_quote: siteQuote,
    quote,
    funnel,
    variant,
    sections,
    pages,
    ga4_measurement_id: readGa4MeasurementId(siteQuote.settings_overrides_json),
    assignment,
    site_branding: siteBranding,
  };
}

// Resolve the activated funnel for a site + optional quote slug (§17.2 / §4.3).
// Any unresolved hop (no enabled activation, missing quote/funnel/variant) →
// null, which the caller answers with a 404.
//
// LeadGen Rework §4.3: a Quote may own MULTIPLE active funnels + a shared first
// page + quote-scoped routing rules + a default funnel. Selection:
//   1. Entry-plane quote rules (all fields entry-known incl os, §4.3-3a) are
//      evaluated over `entry_ctx` (supplied by serve.ts serveFunnelShell); the
//      first match (§4.3-4) PRE-SELECTS its target funnel (§4.3-2 — the shared
//      page still serves first; entry rules only pick the funnel).
//   2. Unmatched (or no entry_ctx — preview/reverse lookup) → the quote's
//      DEFAULT funnel (§4.3-7), else the first active funnel (board order;
//      byte-identical to the old single-funnel path for a one-funnel quote).
//   3. A/B assigns a variant within the served funnel at funnel ENTRY (§4.3-10).
// The resolved plan = shared page + that variant's pages (composeResolvedBundle).
// An entry-routed funnel carries the matched rule hash on the assignment
// (routing_rule_hash) for §16.3 analytics attribution; the SERVER-authoritative
// routing OUTCOME (funnel/feed/multiplier) is written at /lg/attempt.
export async function resolveActivatedFunnel(
  env: Env,
  args: ResolveFunnelArgs,
): Promise<ResolvedActivatedFunnel | null> {
  const db = env.DB;

  const siteQuote = await resolveEnabledSiteQuote(db, args.site_id, args.quote_slug);
  if (siteQuote === null) return null;

  const quote = await getQuoteById(db, siteQuote.quote_id);
  if (quote === null) return null;

  const funnels = await getActiveFunnelsForQuote(db, quote.id);
  if (funnels.length === 0) return null;

  const sessionId = args.session_id ?? "";

  // (1) Entry-plane funnel selection.
  let servedFunnel: LeadgenFunnelRow | null = null;
  let routedHash: string | null = null;
  if (args.entry_ctx !== undefined) {
    const entryMatch = evaluateQuoteEntryRouting(await loadQuoteRoutingRules(db, quote.id), args.entry_ctx);
    if (entryMatch !== null) {
      const target = funnels.find((f) => f.id === entryMatch.target_funnel_id);
      // §4.3-15 activation guarantees the target is active; defensively ignore a
      // rule pointing at an inactive/foreign funnel (fall through to default).
      if (target !== undefined) {
        servedFunnel = target;
        routedHash = entryMatch.hash;
      }
    }
  }

  // (2) Unmatched → the quote's default funnel (§4.3-7), else the first active.
  if (servedFunnel === null) {
    servedFunnel = funnels.find((f) => f.id === quote.default_funnel_id) ?? funnels[0]!;
  }

  // (3) A/B within the served funnel (§4.3-10).
  const assigned = await assignVariantForFunnel(db, servedFunnel, sessionId);
  if (assigned === null) return null;
  const assignment: FunnelAssignment =
    routedHash !== null ? { ...assigned.assignment, routing_rule_hash: routedHash } : assigned.assignment;

  return composeResolvedBundle(db, args.site_id, siteQuote, quote, servedFunnel, assigned.variant, assignment);
}

// Reverse resolution for /lg/config + /lg/attempt: a specific funnel_variant_id
// on THIS site → its resolved bundle, or null (the caller 404s). Anti-leak
// (§30.4): NEVER return a config/attempt for a variant that is not actively
// SERVED on this host. A variant is served iff it is active, under an active
// funnel of an ENABLED activation on this site, AND either the funnel has a
// RUNNING test (every active variant is an arm → served) OR — no running test —
// the variant IS the control variant. The §16.3 dims are computed for the KNOWN
// variant WITHOUT a session bucket: /lg/config is cacheable + session-free
// (§8.3/§30.4); the client recomputes the bucket (§16.2). All queries are
// .bind()-parameterized (fixed table names).
export async function resolveActivatedFunnelByVariant(
  env: Env,
  siteId: string,
  variantPublicId: string,
): Promise<ResolvedActivatedFunnel | null> {
  // Shape guard: a param that is not a well-formed lgn_ id can never be a real
  // variant — refuse before touching the DB (no cross-tenant existence oracle).
  if (!isFunnelVariantId(variantPublicId)) return null;

  const db = env.DB;

  const variant = await db
    .prepare(
      `SELECT ${VARIANT_COLUMNS} FROM leadgen_funnel_variants WHERE public_id = ? AND status = 'active' LIMIT 1`,
    )
    .bind(variantPublicId)
    .first<LeadgenFunnelVariantRow>();
  if (variant === null) return null;

  const funnel = await getActiveFunnelById(db, variant.funnel_id);
  if (funnel === null) return null;

  // UNIQUE(site_id, quote_id) → at most one activation per quote per site; the
  // enabled filter makes a disabled activation a clean 404.
  const siteQuote = await db
    .prepare(
      `SELECT id, site_id, quote_id, enabled, slug, settings_overrides_json, created_at, updated_at
       FROM leadgen_site_quotes WHERE site_id = ? AND quote_id = ? AND enabled = 1 LIMIT 1`,
    )
    .bind(siteId, funnel.quote_id)
    .first<LeadgenSiteQuoteRow>();
  if (siteQuote === null) return null;

  const quote = await getQuoteById(db, funnel.quote_id);
  if (quote === null) return null;

  // Servability + §16.3 dims. A running test makes every active variant a served
  // arm (ab_hash); otherwise the control variant is served (single_control) OR
  // — P4a (D-2) — an ACTIVE route_funnel_variant rule on this funnel names
  // `variant` as its target (isActiveRoutingTargetOnFunnel) — a non-control
  // draft/fork variant NOT named by any rule still never leaks.
  const abTest = await getRunningAbTestForFunnel(db, funnel.id);
  let assignment: FunnelAssignment;
  if (abTest !== null) {
    assignment = abHashAssignmentDims(abTest, variant);
  } else {
    const control = await getControlVariantForFunnel(db, funnel.id);
    if (control !== null && control.id === variant.id) {
      assignment = singleControlAssignmentDims(variant);
    } else if (await isActiveRoutingTargetOnFunnel(db, funnel.id, variant.id)) {
      // Servable as a routing target; single_control-shaped dims (no A/B
      // bucket to draw — there is no running test). The caller (the
      // checkpoint endpoint / a future direct /lg/config probe) does not read
      // `assignment_reason` for this path; the per-request routing_rule:<hash>
      // attribution is stamped separately, keyed by the ACTUAL matched rule.
      assignment = singleControlAssignmentDims(variant);
    } else {
      return null;
    }
  }

  // LeadGen Rework §4.3-2: the resolved plan is the quote's shared first page
  // THEN the variant's pages — the SAME composition resolveActivatedFunnel
  // produces, so section_order_hash / page_plan / signed bindings match the
  // shell byte-for-byte across the /lg (shell) and /lg/config·/lg/attempt·
  // /lg/auction (reverse-lookup) paths. §10.2 branding rides the bundle.
  return composeResolvedBundle(db, siteId, siteQuote, quote, funnel, variant, assignment);
}

// ---------------------------------------------------------------------------
// Round-4 P4a-adj (P5a runtime seam #1) — CTA visibility verdict, server-side
// ---------------------------------------------------------------------------
//
// P5a authored the MARKUP (frame.ts renderCtaSlot): a cta_slots[] entry with a
// `condition` server-renders `hidden` + `data-lg-node="<id>"` +
// `data-lg-cta-condition="<compiled group JSON>"`. It deliberately left the
// EVALUATION seam open (frame.ts is server-render-only, zero runtime bytes).
// The byte-minimal design: evaluate HERE (server, already has the answers +
// entry ctx in hand at /lg/attempt mint and /lg/ck checkpoint) and hand the
// client a compact id LIST of which conditional CTAs are currently visible —
// the client leg is then a trivial DOM applier, never a condition evaluator
// (no compiled-group parsing/dispatch ships to the browser at all).

// Structural (not the serve.ts-owned LeadgenFrameSource type, to avoid a
// resolver.ts -> serve.ts import): any object carrying these three raw 0041
// columns satisfies it. Dedicated try/catch JSON-object read (D1 safety): a
// corrupt blob degrades to null (the caller's fail-safe legacy/no-frame path).
function parseFrameJsonColumn(raw: string | null | undefined): Record<string, unknown> | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

// The frame-ONLY half of serve.ts's resolveFrameComposition — parse+validate
// the stored config, merge the variant's frame_overrides_json, NO theme/tokens
// (a KV-free, synchronous read). serve.ts's resolveFrameComposition calls this
// too (one source of truth for the frame-group-merge step, no divergent copy).
export function resolveEffectiveFrameOnly(source: {
  frame_config_json: string | null | undefined;
  theme_json: string | null | undefined;
  frame_overrides_json: string | null | undefined;
}): EffectiveFrameConfig | null {
  const rawFrame = parseFrameJsonColumn(source.frame_config_json ?? null);
  if (rawFrame === null) return null;
  const frameValidation = validateFrameConfig(rawFrame);
  if (frameValidation.config === null) return null;
  const rawOverrides = parseFrameJsonColumn(source.frame_overrides_json ?? null);
  let frameOverrides: FrameOverrides | null = null;
  if (rawOverrides !== null) {
    const { theme: _overridesTheme, ...frameParts } = rawOverrides;
    const overridesValidation = validateFrameConfig(frameParts);
    if (overridesValidation.config !== null) frameOverrides = overridesValidation.config as FrameOverrides;
  }
  const { frame } = effectiveFrame(frameValidation.config as StoredFrameConfig, null, frameOverrides);
  return frame;
}

// The __-prefixed synthetic ctx keys a CTA condition may reference — SAME
// shape as the client twin (runtime/dependencies.ts buildCtxFields), so a
// condition authored against __state/__device/__page evaluates identically
// whether it runs server-side (here) or client-side. __hour/__weekday are
// SERVER UTC-clock-derived here (the attempt/checkpoint request has no
// visitor-local clock) — a documented, narrow divergence from the client
// twin's OWN getHours()/getDay(); no CTA condition in the current authoring
// surface references either key, so this is not yet an observed gap.
export function buildFrameCtaCtx(
  entryCtx: { state?: string; device?: string; hour: number; weekday: number },
  pageIndex: number,
): Record<string, unknown> {
  const out: Record<string, unknown> = { __page: pageIndex, __hour: entryCtx.hour, __weekday: entryCtx.weekday };
  if (entryCtx.state !== undefined && entryCtx.state !== "") out["__state"] = entryCtx.state;
  if (entryCtx.device !== undefined && entryCtx.device !== "") out["__device"] = entryCtx.device;
  return out;
}

// The SAME id-derivation renderCtaSlot uses (frame.ts) — an authored `id`
// wins, else `frame_cta_<slot>_<index>` — so a verdict id always matches the
// rendered `data-lg-node` attribute byte for byte. A CTA with no `condition`
// is not evaluated (it never server-renders hidden, so the client never
// needs to touch it).
export function computeCtaVerdict(
  ctaSlots: readonly FrameCtaSlotConfig[] | undefined,
  ctx: Readonly<Record<string, unknown>>,
): string[] {
  const visible: string[] = [];
  (ctaSlots ?? []).forEach((slot, i) => {
    if (slot.condition === null || slot.condition === undefined) return;
    const id = typeof slot.id === "string" && slot.id.trim() !== "" ? slot.id : `frame_cta_${slot.slot}_${i}`;
    const cond = slot.condition as unknown as LeadgenPayloadConditional | LeadgenPayloadConditionGroup;
    if (conditionalMet(cond, ctx)) visible.push(id);
  });
  return visible;
}
