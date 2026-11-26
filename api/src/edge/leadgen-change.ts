import type { Env } from "../env";
import { onPublicChange } from "./public-change";
import { siteQuoteTag } from "./tags";

interface LeadgenChangeScope {
  quoteIds?: number[];
  funnelIds?: number[];
  variantIds?: number[];
  reason: string;
}

// A site activation changes just this tenant, including when the write disables
// the very row that used to serve the quote. Legacy invalidators also start
// from a site and PUBLIC funnel ID, rather than numeric database IDs.
type SiteScope = { siteId: string; reason: string } & (
  { activationQuotePublicId: string | undefined } | { funnelPublicId: string }
);

interface ServedQuote {
  site_id: string;
  quote_public_id: string;
}

async function servedQuotes(db: D1Database, scope: LeadgenChangeScope | SiteScope): Promise<ServedQuote[]> {
  if ("siteId" in scope) {
    if ("funnelPublicId" in scope) {
      if (!scope.funnelPublicId) return [];
      const rows = await db.prepare(`SELECT sq.site_id, q.public_id AS quote_public_id
        FROM leadgen_funnels f
        JOIN leadgen_quotes q ON q.id = f.quote_id
        JOIN leadgen_site_quotes sq ON sq.quote_id = q.id
        WHERE f.public_id = ? AND sq.site_id = ? AND sq.enabled = 1`)
        .bind(scope.funnelPublicId, scope.siteId).all<ServedQuote>();
      return rows.results;
    }
    if (scope.activationQuotePublicId !== undefined) {
      return [{ site_id: scope.siteId, quote_public_id: scope.activationQuotePublicId }];
    }
    // The older site-only activation API cannot identify which row was just
    // disabled. Include disabled rows here so their previously served shells go.
    const rows = await db.prepare(`SELECT sq.site_id, q.public_id AS quote_public_id
      FROM leadgen_site_quotes sq JOIN leadgen_quotes q ON q.id = sq.quote_id
      WHERE sq.site_id = ? ORDER BY q.id`).bind(scope.siteId).all<ServedQuote>();
    return rows.results;
  }

  const { quoteIds = [], funnelIds = [], variantIds = [] } = scope;
  if (!quoteIds.length && !funnelIds.length && !variantIds.length) return [];
  // The shell and gateway both enter through an enabled (site, quote) row.
  // Resolve every input in one read, even when several joins name the same quote.
  const rows = await db.prepare(`WITH changed_quotes(id) AS (
      SELECT value FROM json_each(?)
      UNION SELECT quote_id FROM leadgen_funnels WHERE id IN (SELECT value FROM json_each(?))
      UNION SELECT f.quote_id FROM leadgen_funnel_variants v JOIN leadgen_funnels f ON f.id = v.funnel_id
            WHERE v.id IN (SELECT value FROM json_each(?))
    )
    SELECT sq.site_id, q.public_id AS quote_public_id
    FROM changed_quotes c JOIN leadgen_quotes q ON q.id = c.id
    JOIN leadgen_site_quotes sq ON sq.quote_id = q.id
    WHERE sq.enabled = 1 ORDER BY sq.site_id, q.id`)
    .bind(JSON.stringify(quoteIds), JSON.stringify(funnelIds), JSON.stringify(variantIds)).all<ServedQuote>();
  return rows.results;
}

export function leadgenPublicChange(env: Env, ctx: ExecutionContext | undefined, scope: SiteScope): Promise<void>;
export function leadgenPublicChange(env: Env, ctx: ExecutionContext | undefined, scope: LeadgenChangeScope): Promise<void>;
export async function leadgenPublicChange(
  env: Env, ctx: ExecutionContext | undefined, scope: LeadgenChangeScope | SiteScope,
): Promise<void> {
  try {
    const bySite = new Map<string, Set<string>>();
    for (const row of await servedQuotes(env.DB, scope)) {
      const tags = bySite.get(row.site_id) ?? new Set<string>();
      tags.add(siteQuoteTag(row.site_id, row.quote_public_id));
      bySite.set(row.site_id, tags);
    }
    // onPublicChange manages the RPC limit and durably queues excess tags.
    await Promise.all([...bySite].map(([siteId, tags]) =>
      onPublicChange(env, ctx, { siteId, tags: [...tags], reason: scope.reason })));
  } catch (error) {
    console.error("leadgen public change failed", scope.reason, error);
  }
}
