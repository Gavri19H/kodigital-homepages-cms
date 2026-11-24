import type { LeadgenRuleConditionGroup, LeadgenSiteQuoteRow } from "../admin/leadgen/db-types";
import { geoFromCf, parseClientUa } from "../analytics/listicle-quality";
import { isFunnelVariantId, isQuoteId } from "../leadgen/funnel";
import { isEntryPlane } from "../leadgen/rule-checkpoint";
import {
  deriveOs,
  evaluateQuoteEntryRouting,
  getActiveFunnelsForQuote,
  getQuoteById,
  loadFunnelEntryVariants,
  loadOfferEntryRedirectLocation,
  parseUtmFromLandingUrl,
  readQuoteRoutingRules,
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

async function loadEntryFunnel(db: D1Database, id: number): Promise<EntryFunnel> {
  const { abTest, variants } = await loadFunnelEntryVariants(db, id);
  return {
    id,
    abTest: abTest === null ? null : { public_id: abTest.public_id, revision: abTest.revision },
    variants: variants.map(({ public_id, variant_label, traffic_allocation_bp }) => ({
      public_id, variant_label, traffic_allocation_bp,
    })),
  };
}

// Keys are activated slugs. The enabled NULL-slug row uses the literal "/lg".
export async function buildLeadgenSnapshot(db: D1Database, siteId: string): Promise<Record<string, LeadgenSnapshotEntry>> {
  const activations = await db
    .prepare("SELECT slug, quote_id FROM leadgen_site_quotes WHERE site_id = ? AND enabled = 1")
    .bind(siteId)
    .all<Pick<LeadgenSiteQuoteRow, "slug" | "quote_id">>();
  const entries: Record<string, LeadgenSnapshotEntry> = Object.create(null);
  for (const { slug, quote_id } of activations.results) {
    if (slug === "" || slug?.includes("/")) continue;
    const quote = await getQuoteById(db, quote_id);
    if (quote === null) continue;
    const [activeFunnels, rules] = await Promise.all([
      getActiveFunnelsForQuote(db, quote.id),
      readQuoteRoutingRules(db, quote.id),
    ]);
    const funnels = await Promise.all(activeFunnels.map((f) => loadEntryFunnel(db, f.id)));
    const offerLocations: Record<number, string | null> = {};
    for (const rule of rules) {
      const id = rule.target_offer_id;
      if (rule.entry_only && id !== null && !Object.hasOwn(offerLocations, id)) {
        offerLocations[id] = await loadOfferEntryRedirectLocation(db, id);
      }
    }
    entries[slug ?? "/lg"] = {
      quoteId: quote.public_id, defaultFunnelId: quote.default_funnel_id ?? null, funnels, rules, offerLocations,
    };
  }
  return entries;
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
