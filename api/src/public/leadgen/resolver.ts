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
  assignment_reason: LeadgenAssignmentReason;
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
  const row = await db
    .prepare(
      `SELECT id, public_id, quote_name, activity, verticals_json, status, created_by, created_at, updated_at
       FROM leadgen_quotes WHERE id = ? LIMIT 1`,
    )
    .bind(quoteId)
    .first<LeadgenQuoteRow>();
  return row ?? null;
}

// The quote's active stable funnel. P8 seam: when a running A/B test spans
// multiple funnels, P8 selects among them; P7 takes the single active funnel
// deterministically (oldest by id).
//
// v2.5 §13.3 projection note: the funnel + variant reads below are SELECT * so
// the resolved rows carry the 0041 columns (funnels.frame_config_json/
// theme_json, variants.frame_overrides_json — the LeadgenFunnelRow/
// LeadgenFunnelVariantRow types already declare them; the admin handlers read
// these tables the same way). SELECT * is also what keeps pre-0041 harness
// DBs serveable: an absent column simply yields `undefined` on the row (read
// as NULL → the exact legacy path) instead of erroring the whole resolve.
async function getActiveFunnelForQuote(db: D1Database, quoteId: number): Promise<LeadgenFunnelRow | null> {
  const row = await db
    .prepare(
      `SELECT * FROM leadgen_funnels
       WHERE quote_id = ? AND status = 'active' ORDER BY id ASC LIMIT 1`,
    )
    .bind(quoteId)
    .first<LeadgenFunnelRow>();
  return row ?? null;
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

// The funnel's CONTROL variant — the single_control path when no test runs.
// is_control=1 wins; the oldest active variant is the defensive fallback.
export async function getControlVariantForFunnel(
  db: D1Database,
  funnelId: number,
): Promise<LeadgenFunnelVariantRow | null> {
  const row = await db
    .prepare(
      `SELECT ${VARIANT_COLUMNS}
       FROM leadgen_funnel_variants
       WHERE funnel_id = ? AND status = 'active'
       ORDER BY is_control DESC, id ASC LIMIT 1`,
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
// is_control first then id ASC — so the arm set is stable across requests; the
// §16.2 assignment itself re-sorts by variant_label internally).
async function getActiveVariantsForFunnel(
  db: D1Database,
  funnelId: number,
): Promise<LeadgenFunnelVariantRow[]> {
  const result = await db
    .prepare(
      `SELECT ${VARIANT_COLUMNS}
       FROM leadgen_funnel_variants
       WHERE funnel_id = ? AND status = 'active'
       ORDER BY is_control DESC, id ASC`,
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
  hour: number;
  weekday: number;
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

// Resolve the activated funnel for a site + optional quote slug (§17.2). Any
// unresolved hop (no enabled activation, missing quote/funnel/variant) → null,
// which the caller answers with a 404.
export async function resolveActivatedFunnel(
  env: Env,
  args: ResolveFunnelArgs,
): Promise<ResolvedActivatedFunnel | null> {
  const db = env.DB;

  const siteQuote = await resolveEnabledSiteQuote(db, args.site_id, args.quote_slug);
  if (siteQuote === null) return null;

  const quote = await getQuoteById(db, siteQuote.quote_id);
  if (quote === null) return null;

  const funnel = await getActiveFunnelForQuote(db, quote.id);
  if (funnel === null) return null;

  // §16.2: a RUNNING test buckets the session across the funnel's active
  // variants (the ab_hash edge path); with no running test the is_control
  // variant serves (single_control). An absent/empty session id also resolves
  // to single_control so preview / no-cookie callers stay deterministic.
  const sessionId = args.session_id ?? "";
  const abTest = sessionId === "" ? null : await getRunningAbTestForFunnel(db, funnel.id);

  let variant: LeadgenFunnelVariantRow;
  let assignment: FunnelAssignment;
  if (abTest !== null) {
    const arms = await getActiveVariantsForFunnel(db, funnel.id);
    if (arms.length === 0) return null;
    const picked = assignVariant(abTest.public_id, abTest.revision, sessionId, arms);
    variant = picked.variant;
    assignment = {
      funnel_ab_test_id: abTest.public_id,
      funnel_ab_test_revision: abTest.revision,
      variant_label: picked.variant.variant_label,
      traffic_allocation_bp: picked.variant.traffic_allocation_bp,
      assignment_bucket: picked.assignment_bucket, // §16.2 bucket 0..9999
      assignment_reason: picked.assignment_reason, // "ab_hash"
    };
  } else {
    const control = await getControlVariantForFunnel(db, funnel.id);
    if (control === null) return null;
    variant = control;
    assignment = singleControlAssignmentDims(control);
  }

  const pages = await loadVariantPages(db, variant.id);
  const sections = sectionsFromPages(pages);

  // §10.2: site branding rides the resolved bundle (this resolver runs on the
  // cache-miss serve path only — one extra read; never throws).
  const siteBranding = await resolveSiteBranding(db, args.site_id);

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
  // arm (ab_hash); otherwise ONLY the control variant is served (single_control)
  // — a non-control draft/fork variant's config never leaks when no test runs.
  const abTest = await getRunningAbTestForFunnel(db, funnel.id);
  let assignment: FunnelAssignment;
  if (abTest !== null) {
    assignment = abHashAssignmentDims(abTest, variant);
  } else {
    const control = await getControlVariantForFunnel(db, funnel.id);
    if (control === null || control.id !== variant.id) return null;
    assignment = singleControlAssignmentDims(variant);
  }

  const pages = await loadVariantPages(db, variant.id);
  const sections = sectionsFromPages(pages);

  // §10.2: same branding field as resolveActivatedFunnel so preview/config/
  // attempt callers see one consistent bundle shape (never throws).
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
