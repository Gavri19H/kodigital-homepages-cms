// Phase 3 / T11: Tenant-boundary guards.
//
// Every code path that mutates per-site state (articles, pages, settings,
// categories, media, slugs) MUST flow through one of the guards below
// before issuing an UPDATE / INSERT. The contract is:
//   1. site_id MUST be supplied for any content-bearing input that isn't
//      an explicitly global legal template (privacy-policy / terms /
//      do-not-sell / contact). resolvePageScope / resolveSettingsScope
//      decide which side of the boundary the operation lives on.
//   2. When two siteIds appear in the same code path (e.g. actor's site
//      vs resource's site), assertTenantBoundary refuses the call when
//      they diverge — TenantBoundaryViolation surfaces as a 4xx in the
//      router and is named so `err.name === 'TenantBoundaryViolation'`
//      checks work even after a structured clone.
//   3. Slug uniqueness is per-site (matches the schema's per-site UNIQUE
//      index from T5). assertSlugUniquePerSite refuses unknown tables to
//      keep the static-table interpolation safe.
//   4. Media may belong to a site OR be global (NULL site_id) —
//      assertMediaBelongsToSiteOrGlobal accepts both for the actor site
//      and rejects any other site's media.
//
// Every D1 query uses static SQL passed into db.prepare and parameterized
// via .bind(...) with positional ? placeholders — no template-literal
// interpolation, matching the db/index.ts pattern.

export interface SiteIdBearingInput {
  site_id?: string | null;
}

export interface PageInput {
  site_id?: string | null;
  slug?: string | null;
  page_type?: string | null;
}

export interface SettingsInput {
  site_id?: string | null;
  key?: string | null;
}

export interface MediaWithSiteId {
  site_id?: string | null;
}

export type PageScope =
  | { scope: "per-site"; site_id: string }
  | { scope: "global"; legal_slug: string };

export type SettingsScope =
  | { scope: "per-site"; site_id: string }
  | { scope: "global" };

export const GLOBAL_LEGAL_PAGE_SLUGS: readonly string[] = [
  "privacy-policy",
  "terms",
  "do-not-sell",
  "contact",
];

export class TenantBoundaryViolation extends Error {
  public override readonly name = "TenantBoundaryViolation";
  public readonly actor_site_id: string;
  public readonly resource_site_id: string;
  constructor(actorSiteId: string, resourceSiteId: string) {
    super(
      `Tenant boundary violation: actor site_id=${JSON.stringify(actorSiteId)} ` +
        `resource site_id=${JSON.stringify(resourceSiteId)}`,
    );
    this.actor_site_id = actorSiteId;
    this.resource_site_id = resourceSiteId;
  }
}

const ALLOWED_SLUG_TABLES: ReadonlySet<string> = new Set(["articles", "pages"]);

function nonEmptySiteId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function requireSiteIdForArticleInput(
  input: SiteIdBearingInput,
): string {
  const siteId = nonEmptySiteId(input.site_id);
  if (siteId === null) {
    throw new Error(
      "Article input is missing required site_id (tenant guards refuse implicit site selection).",
    );
  }
  return siteId;
}

export async function validateCategoryForSite(
  db: D1Database,
  categoryId: number | string,
  siteId: string,
): Promise<boolean> {
  const row = await db
    .prepare(
      "SELECT 1 AS ok FROM category_verticals cv " +
        "INNER JOIN verticals v ON v.id = cv.vertical_id " +
        "INNER JOIN sites s ON s.vertical_slug = v.slug " +
        "WHERE cv.category_id = ? AND s.id = ? LIMIT 1",
    )
    .bind(categoryId, siteId)
    .first<{ ok: number }>();
  return row !== null && row !== undefined;
}

export function resolvePageScope(input: PageInput): PageScope {
  const slug = typeof input.slug === "string" ? input.slug.trim() : "";
  const siteId = nonEmptySiteId(input.site_id);
  const isLegalSlug = GLOBAL_LEGAL_PAGE_SLUGS.includes(slug);
  if (isLegalSlug && siteId === null) {
    return { scope: "global", legal_slug: slug };
  }
  if (siteId === null) {
    throw new Error(
      "Page input is missing required site_id (only global legal templates may have site_id NULL).",
    );
  }
  return { scope: "per-site", site_id: siteId };
}

export function resolveSettingsScope(input: SettingsInput): SettingsScope {
  const siteId = nonEmptySiteId(input.site_id);
  if (siteId === null) return { scope: "global" };
  return { scope: "per-site", site_id: siteId };
}

export function assertTenantBoundary(
  actorSiteId: string,
  resourceSiteId: string,
): void {
  if (actorSiteId !== resourceSiteId) {
    throw new TenantBoundaryViolation(actorSiteId, resourceSiteId);
  }
}

export async function assertSiteCanMutateContent(
  db: D1Database,
  siteId: string,
): Promise<void> {
  const row = await db
    .prepare("SELECT status FROM sites WHERE id = ? LIMIT 1")
    .bind(siteId)
    .first<{ status: string }>();
  if (row === null || row === undefined) {
    throw new Error(
      `Site ${JSON.stringify(siteId)} not found; cannot mutate content.`,
    );
  }
  if (row.status === "disabled" || row.status === "archived") {
    throw new Error(
      `Site ${JSON.stringify(siteId)} status is "${row.status}"; ` +
        `content mutation refused.`,
    );
  }
}

export async function assertSlugUniquePerSite(
  db: D1Database,
  table: string,
  slug: string,
  siteId: string,
  excludeId?: number | string | null,
): Promise<void> {
  if (!ALLOWED_SLUG_TABLES.has(table)) {
    throw new Error(`Unknown slug table for uniqueness check: ${table}`);
  }
  const baseSql =
    "SELECT id FROM " + table + " WHERE slug = ? AND site_id = ?";
  const hasExclude = excludeId !== undefined && excludeId !== null;
  const sql = hasExclude ? baseSql + " AND id <> ? LIMIT 1" : baseSql + " LIMIT 1";
  const stmt = hasExclude
    ? db.prepare(sql).bind(slug, siteId, excludeId)
    : db.prepare(sql).bind(slug, siteId);
  const row = await stmt.first<{ id: number }>();
  if (row !== null && row !== undefined) {
    throw new Error(
      `Slug ${JSON.stringify(slug)} is already in use for site_id=${JSON.stringify(siteId)} (table=${table}).`,
    );
  }
}

export function assertMediaBelongsToSiteOrGlobal(
  media: MediaWithSiteId,
  siteId: string,
): void {
  const mediaSiteId = nonEmptySiteId(media.site_id);
  if (mediaSiteId === null) return; // global asset is accessible to all tenants
  if (mediaSiteId === siteId) return;
  throw new TenantBoundaryViolation(siteId, mediaSiteId);
}
