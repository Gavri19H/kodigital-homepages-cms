import type { LeadgenRuleConditionGroup, LeadgenSiteQuoteRow } from "../admin/leadgen/db-types";
import { geoFromCf, parseClientUa } from "../analytics/listicle-quality";
import { isFunnelVariantId, isQuoteId } from "../leadgen/funnel";
import { isEntryPlane } from "../leadgen/rule-checkpoint";
import {
  deriveOs,
  evaluateQuoteEntryRouting,
  offerEntryRedirectLocation,
  parseQuoteRoutingRule,
  parseUtmFromLandingUrl,
  selectEntryRedirectTarget,
  selectFunnelEntryVariant,
  selectQuoteEntryFunnel,
  type FunnelAssignment,
  type FunnelEntryVariants,
  type ParsedQuoteRule,
} from "../public/leadgen/resolver";
import type { GatewayRequestInput } from "./types";

interface EntryVariant {
  public_id: string;
  variant_label: string;
  traffic_allocation_bp: number;
}

interface EntryFunnel extends FunnelEntryVariants<EntryVariant> {
  id: number;
}

export interface LeadgenSnapshotEntry {
  quoteId: string;
  defaultFunnelId: number | null;
  funnels: EntryFunnel[];
  rules: ParsedQuoteRule[];
  // Null means the offer has no governed click destination. A missing row in
  // this map cannot be used to decide a redirect.
  offerLocations: Record<number, string | null>;
}

export type LeadgenSelection =
  | { kind: "render"; quoteId: string; funnelVariantId: string; assignment: FunnelAssignment }
  | { kind: "redirect"; location: string; status: 302 }
  | { kind: "fallback" };

type Activation = Pick<LeadgenSiteQuoteRow, "slug" | "quote_id">;
type QuoteFunnelRow = {
  quote_id: number;
  public_id: string;
  default_funnel_id: number | null;
  funnel_id: number | null;
} & ({ test_public_id: string; revision: number } | { test_public_id: null; revision: null });
type RuleOfferRow = Parameters<typeof parseQuoteRoutingRule>[0] & {
  quote_id: number;
  offer_public_id: string | null;
  banner_url_template: string | null;
};
export type LeadgenSnapshotResults = [
  activations: D1Result<Activation>,
  quoteFunnels: D1Result<QuoteFunnelRow>,
  variants: D1Result<EntryVariant & { funnel_id: number }>,
  ruleOffers: D1Result<RuleOfferRow>,
];

// Keep the original activation scan for the order of serialized slug keys.
const ACTIVATIONS = "SELECT slug, quote_id FROM leadgen_site_quotes WHERE site_id = ? AND enabled = 1";
const SITE_QUOTES = "WITH site_quotes AS (" + ACTIVATIONS + `
  AND (slug IS NULL OR (slug <> '' AND instr(slug, '/') = 0))
)`;

export function leadgenSnapshotStatements(db: D1Database, siteId: string): D1PreparedStatement[] {
  return [
    db.prepare(ACTIVATIONS).bind(siteId),
    db.prepare(SITE_QUOTES + `
      SELECT q.id AS quote_id, q.public_id, q.default_funnel_id, f.id AS funnel_id,
             t.public_id AS test_public_id, t.revision
      FROM site_quotes s JOIN leadgen_quotes q ON q.id = s.quote_id
      LEFT JOIN leadgen_funnels f ON f.quote_id = q.id AND f.status = 'active'
      LEFT JOIN leadgen_funnel_ab_tests t ON t.funnel_id = f.id AND t.status = 'running'
      ORDER BY q.id, COALESCE(f.display_order, f.id), f.id`).bind(siteId),
    db.prepare(SITE_QUOTES + `
      SELECT v.funnel_id, v.public_id, v.variant_label, v.traffic_allocation_bp
      FROM site_quotes s JOIN leadgen_funnels f ON f.quote_id = s.quote_id AND f.status = 'active'
      JOIN leadgen_funnel_variants v ON v.funnel_id = f.id AND v.status = 'active'
      ORDER BY v.funnel_id, v.variant_label, v.id`).bind(siteId),
    db.prepare(SITE_QUOTES + `
      SELECT r.quote_id, r.public_id, r.conditions_json, r.conditions_hash, r.priority, r.match_mode,
             r.target_funnel_id, r.feed_name, r.value_multiplier, r.redirect_pct, r.target_offer_id,
             r.redirect_url, r.redirect_url_allowlisted, r.force_offer_id,
             o.public_id AS offer_public_id, o.banner_url_template
      FROM site_quotes s JOIN leadgen_quote_routing_rules r ON r.quote_id = s.quote_id AND r.status = 'active'
      LEFT JOIN leadgen_offers o ON o.id = r.target_offer_id
      ORDER BY r.quote_id, r.priority, r.id`).bind(siteId),
  ];
}

export function assembleLeadgenSnapshot(
  [activations, quoteFunnels, variants, ruleOffers]: LeadgenSnapshotResults,
): Record<string, LeadgenSnapshotEntry> {
  const quotes = new Map<number, LeadgenSnapshotEntry>();
  const funnels = new Map<number, EntryFunnel>();
  for (const row of quoteFunnels.results) {
    let quote = quotes.get(row.quote_id);
    if (!quote) {
      quote = {
        quoteId: row.public_id, defaultFunnelId: row.default_funnel_id ?? null,
        funnels: [], rules: [], offerLocations: {},
      };
      quotes.set(row.quote_id, quote);
    }
    if (row.funnel_id === null) continue;
    const funnel: EntryFunnel = {
      id: row.funnel_id,
      abTest: row.test_public_id === null ? null : { public_id: row.test_public_id, revision: row.revision },
      variants: [],
    };
    quote.funnels.push(funnel);
    funnels.set(funnel.id, funnel);
  }
  for (const { funnel_id, public_id, variant_label, traffic_allocation_bp } of variants.results) {
    const funnel = funnels.get(funnel_id);
    // Without a running test the resolver serves only the first active variant in label/id order.
    if (funnel && (funnel.abTest !== null || funnel.variants.length === 0)) {
      funnel.variants.push({ public_id, variant_label, traffic_allocation_bp });
    }
  }
  for (const row of ruleOffers.results) {
    const quote = quotes.get(row.quote_id);
    if (!quote) continue;
    const rule = parseQuoteRoutingRule(row);
    quote.rules.push(rule);
    const offerId = rule.target_offer_id;
    if (rule.entry_only && offerId !== null && !Object.hasOwn(quote.offerLocations, offerId)) {
      quote.offerLocations[offerId] = offerEntryRedirectLocation(row.offer_public_id === null ? null : {
        public_id: row.offer_public_id, banner_url_template: row.banner_url_template,
      });
    }
  }
  const entries: Record<string, LeadgenSnapshotEntry> = Object.create(null);
  for (const { slug, quote_id } of activations.results) {
    const quote = quotes.get(quote_id);
    if (quote) entries[slug ?? "/lg"] = quote;
  }
  return entries;
}

export async function buildLeadgenSnapshot(db: D1Database, siteId: string): Promise<Record<string, LeadgenSnapshotEntry>> {
  const statements = leadgenSnapshotStatements(db, siteId);
  const results = await Promise.all(statements.map(stmt => stmt.all<unknown>())) as LeadgenSnapshotResults;
  return assembleLeadgenSnapshot(results);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nullableId(value: unknown): boolean {
  return value === null || (typeof value === "number" && Number.isSafeInteger(value) && value > 0);
}

function isCondition(value: unknown): value is LeadgenRuleConditionGroup {
  if (!isRecord(value) || typeof value.field !== "string" || value.field === "") return false;
  if (value.or_group !== undefined && typeof value.or_group !== "string") return false;
  switch (value.op) {
    case "eq":
    case "neq": return Object.hasOwn(value, "value");
    case "gt":
    case "lt":
    case "gte":
    case "lte": return Number.isFinite(value.value);
    case "range": return Number.isFinite(value.from) && Number.isFinite(value.to);
    case "in":
    case "not_in": return Array.isArray(value.values);
    default: return false;
  }
}

function isRule(value: unknown): value is ParsedQuoteRule {
  if (!isRecord(value) || !isRecord(value.conditions)) return false;
  const groups = value.conditions.groups;
  return Array.isArray(groups) && groups.every(isCondition)
    && value.entry_only === isEntryPlane(groups.map((g) => g.field))
    && typeof value.public_id === "string" && value.public_id !== ""
    && typeof value.hash === "string" && Number.isSafeInteger(value.priority)
    && (value.match_mode === "any" || value.match_mode === "all")
    && nullableId(value.target_funnel_id) && nullableId(value.target_offer_id) && nullableId(value.force_offer_id)
    && (value.feed_name === null || typeof value.feed_name === "string")
    && (value.value_multiplier === null || Number.isFinite(value.value_multiplier))
    && (value.redirect_pct === null || Number.isFinite(value.redirect_pct))
    && (value.redirect_url === null || typeof value.redirect_url === "string")
    && typeof value.redirect_url_allowlisted === "boolean";
}

function isFunnel(value: unknown): value is EntryFunnel {
  if (!isRecord(value) || value.id === null || !nullableId(value.id)) return false;
  const { abTest, variants } = value;
  return (abTest === null || (isRecord(abTest) && typeof abTest.public_id === "string"
      && abTest.public_id !== "" && Number.isSafeInteger(abTest.revision)))
    && Array.isArray(variants) && variants.every((v: unknown) => isRecord(v)
      && typeof v.public_id === "string" && isFunnelVariantId(v.public_id)
      && typeof v.variant_label === "string" && Number.isSafeInteger(v.traffic_allocation_bp));
}

function isSnapshotEntry(value: unknown): value is LeadgenSnapshotEntry {
  if (!isRecord(value) || !isRecord(value.offerLocations)) return false;
  return typeof value.quoteId === "string" && isQuoteId(value.quoteId) && nullableId(value.defaultFunnelId)
    && Array.isArray(value.funnels) && value.funnels.every(isFunnel)
    && Array.isArray(value.rules) && value.rules.every(isRule)
    && Object.values(value.offerLocations).every((url) => url === null || (typeof url === "string" && /^\/lg\/lc\/[^/?#\s]+$/.test(url)));
}

export function selectLeadgenEntry(entry: unknown, input: GatewayRequestInput): LeadgenSelection {
  // The shell mints a ko_sid before making any decision. An absent gateway
  // session must take that path, including its Set-Cookie.
  if (!isSnapshotEntry(entry) || !input.sid) return { kind: "fallback" };
  const now = new Date(input.nowMs);
  if (!Number.isFinite(now.getTime())) return { kind: "fallback" };
  const ua = input.headers.get("User-Agent");
  const ctx = {
    hour: now.getUTCHours(),
    weekday: now.getUTCDay(),
    state: geoFromCf(input.cf).state,
    device: parseClientUa(ua).device,
    os: deriveOs(ua),
    ...parseUtmFromLandingUrl(input.url.href),
  };
  const match = evaluateQuoteEntryRouting(entry.rules, ctx, { quote_public_id: entry.quoteId, session_id: input.sid });
  const served = selectQuoteEntryFunnel(entry.funnels, entry.defaultFunnelId, match);
  if (served === null) return { kind: "fallback" };
  const assigned = selectFunnelEntryVariant(served.funnel, input.sid, served.routedHash);
  if (assigned === null) return { kind: "fallback" };

  const target = selectEntryRedirectTarget(match, input.sid);
  const location = typeof target === "number" ? entry.offerLocations[target] : target;
  if (location === undefined) return { kind: "fallback" };
  if (location !== null) return { kind: "redirect", location, status: 302 };
  return { kind: "render", quoteId: entry.quoteId, funnelVariantId: assigned.variant.public_id, assignment: assigned.assignment };
}
