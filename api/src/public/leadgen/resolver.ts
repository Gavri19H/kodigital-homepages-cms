// LeadGen §17.2 public resolution: host → site → path → quote → funnel →
// control variant → ordered sections. READ-ONLY; every query is parameterized
// via .bind() (never template-literal interpolation).
//
// The host→site hop is already owned by the public Worker middleware
// (public/middleware.ts → site/site-context.ts resolveSiteByHostname), which
// hands downstream handlers a SiteContext.site_id. This module takes that
// resolved `site_id` (a string, the sites.id) + an optional `quote_slug` and
// completes the rest of the §17.2 chain, mirroring how listicle/resolver.ts
// resolves an already-site-scoped request.
//
// A/B is P8: this phase serves the SINGLE control variant. Where P8 will pick a
// variant via the ab-hash (contract 06 §16.2), P7 returns the is_control=1
// variant of the quote's active funnel; the P8 seam is marked below.
//
// Missing / disabled activation → returns null (the caller 404s per §17.2).

import type { Env } from "../../env";
import type {
  LeadgenSiteQuoteRow,
  LeadgenQuoteRow,
  LeadgenFunnelRow,
  LeadgenFunnelVariantRow,
  LeadgenSectionRow,
} from "../../admin/leadgen/db-types";

// One ordered section of the resolved variant (position + the full section
// row). Ordered ascending by position; the auction runs after the MAX position
// (§15.3 — derived, not stored).
export interface ResolvedFunnelSection {
  position: number;
  section: LeadgenSectionRow;
}

export interface ResolvedActivatedFunnel {
  site_quote: LeadgenSiteQuoteRow;
  quote: LeadgenQuoteRow;
  funnel: LeadgenFunnelRow; // funnel.public_id is the stable lgf_ funnel_id
  variant: LeadgenFunnelVariantRow; // variant.public_id is the lgn_ funnel_variant_id
  sections: ResolvedFunnelSection[]; // ordered by position ASC
  // GA4 measurement id resolved from the activation's settings_overrides_json
  // (contract 08 §28 "measurement id from settings"); null when unset. Kept on
  // the resolved bundle so the pure config-dto builder needs no env access.
  ga4_measurement_id: string | null;
}

export interface ResolveFunnelArgs {
  site_id: string;
  // Absent/empty → the site's single enabled root activation (NULL slug);
  // otherwise the enabled row whose slug matches.
  quote_slug?: string | null;
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

// The funnel's CONTROL variant. P8 seam: P8 assigns a variant via the §16.2
// ab-hash across the running test's variants; P7 returns is_control=1 (falling
// back to the oldest active variant) — the single-variant path.
async function getControlVariantForFunnel(
  db: D1Database,
  funnelId: number,
): Promise<LeadgenFunnelVariantRow | null> {
  const row = await db
    .prepare(
      `SELECT id, public_id, funnel_id, ab_test_id, variant_label, is_control, traffic_allocation_bp,
              funnel_design_id, auction_id, lander_enabled, lander_headline, lander_subheadline,
              lander_body_json, lander_hero_media_id, lander_hero_media_url, lander_cta_json,
              content_version, status, created_at
       FROM leadgen_funnel_variants
       WHERE funnel_id = ? AND status = 'active'
       ORDER BY is_control DESC, id ASC LIMIT 1`,
    )
    .bind(funnelId)
    .first<LeadgenFunnelVariantRow>();
  return row ?? null;
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

  const variant = await getControlVariantForFunnel(db, funnel.id);
  if (variant === null) return null;

  const sections = await getOrderedVariantSections(db, variant.id);

  return {
    site_quote: siteQuote,
    quote,
    funnel,
    variant,
    sections,
    ga4_measurement_id: readGa4MeasurementId(siteQuote.settings_overrides_json),
  };
}
