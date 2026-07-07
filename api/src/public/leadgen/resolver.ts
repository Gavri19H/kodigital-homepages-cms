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
} from "../../admin/leadgen/db-types";
import {
  assignVariant,
  singleControlAssignment,
  type LeadgenAssignmentReason,
} from "./ab-hash";
import { isFunnelVariantId } from "../../leadgen/funnel";

// One ordered section of the resolved variant (position + the full section
// row). Ordered ascending by position; the auction runs after the MAX position
// (§15.3 — derived, not stored).
export interface ResolvedFunnelSection {
  position: number;
  section: LeadgenSectionRow;
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
  // GA4 measurement id resolved from the activation's settings_overrides_json
  // (contract 08 §28 "measurement id from settings"); null when unset. Kept on
  // the resolved bundle so the pure config-dto builder needs no env access.
  ga4_measurement_id: string | null;
  // The §16.3 A/B assignment metadata for `variant` (contract 06 §16.2/§16.3).
  assignment: FunnelAssignment;
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
async function getActiveFunnelForQuote(db: D1Database, quoteId: number): Promise<LeadgenFunnelRow | null> {
  const row = await db
    .prepare(
      `SELECT id, public_id, quote_id, funnel_name, active_ab_test_id, status, created_at, updated_at
       FROM leadgen_funnels
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
      `SELECT id, public_id, quote_id, funnel_name, active_ab_test_id, status, created_at, updated_at
       FROM leadgen_funnels
       WHERE id = ? AND status = 'active' LIMIT 1`,
    )
    .bind(funnelId)
    .first<LeadgenFunnelRow>();
  return row ?? null;
}

// The full variant column list (shared by the control-variant + arms queries so
// both hydrate an identical LeadgenFunnelVariantRow).
const VARIANT_COLUMNS =
  `id, public_id, funnel_id, ab_test_id, variant_label, is_control, traffic_allocation_bp,
   funnel_design_id, auction_id, lander_enabled, lander_headline, lander_subheadline,
   lander_body_json, lander_hero_media_id, lander_hero_media_url, lander_cta_json,
   content_version, status, created_at`;

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
): Promise<ResolvedFunnelSection[]> {
  const result = await db
    .prepare(
      `SELECT fvs.position AS position,
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
    .all<LeadgenSectionRow & { position: number }>();
  const rows = result.results ?? [];
  return rows.map((r) => {
    const { position, ...section } = r;
    return { position, section: section as LeadgenSectionRow };
  });
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

  const sections = await getOrderedVariantSections(db, variant.id);

  return {
    site_quote: siteQuote,
    quote,
    funnel,
    variant,
    sections,
    ga4_measurement_id: readGa4MeasurementId(siteQuote.settings_overrides_json),
    assignment,
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

  const sections = await getOrderedVariantSections(db, variant.id);

  return {
    site_quote: siteQuote,
    quote,
    funnel,
    variant,
    sections,
    ga4_measurement_id: readGa4MeasurementId(siteQuote.settings_overrides_json),
    assignment,
  };
}
