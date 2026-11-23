// X06 SEO Fixes (plan v3, owner decision Q1 (a)): who a site writes for.
//
// Order: the site's own "audience" site setting (Settings → General), else
// the default on its Vertical (verticals.audience, Verticals screen, migration
// 0070), else "readers interested in <vertical name>". Never empty, never
// contains "{{" — a stored value with a placeholder is ignored.
//
// Also the one shared placeholder test used by every X06 check: AI answers,
// Settings save, Verticals save.

export const PLACEHOLDER_SAVE_ERROR = "Remove the {{…}} placeholder before saving.";

/** True when the text still holds an unfilled "{{…}}" style token (or half of one). */
export function containsPlaceholder(text: unknown): boolean {
  return typeof text === "string" && (text.includes("{{") || text.includes("}}"));
}

export function fallbackAudience(verticalName: string | null | undefined): string {
  const name = typeof verticalName === "string" ? verticalName.trim() : "";
  return name.length > 0 ? `readers interested in ${name}` : "general readers";
}

function usable(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (v.length === 0 || containsPlaceholder(v)) return null;
  return v;
}

/** The default audience for a Vertical (by slug), with the fallback sentence. */
export async function resolveVerticalAudience(
  db: D1Database,
  verticalSlug: string | null | undefined,
): Promise<string> {
  const slug = typeof verticalSlug === "string" ? verticalSlug.trim() : "";
  if (!slug) return fallbackAudience(null);
  try {
    const row = await db
      .prepare("SELECT name, audience FROM verticals WHERE slug = ? LIMIT 1")
      .bind(slug)
      .first<{ name: string | null; audience: string | null }>();
    return usable(row?.audience) ?? fallbackAudience(row?.name ?? slug);
  } catch {
    return fallbackAudience(slug);
  }
}

/** The audience every AI text for this site uses. */
export async function resolveSiteAudience(db: D1Database, siteId: string): Promise<string> {
  try {
    const own = await db
      .prepare("SELECT value FROM site_settings WHERE site_id = ? AND key = 'audience' LIMIT 1")
      .bind(siteId)
      .first<{ value: string | null }>();
    const ownValue = usable(own?.value);
    if (ownValue) return ownValue;
  } catch {
    // fall through to the Vertical default
  }
  try {
    const site = await db
      .prepare("SELECT vertical_slug FROM sites WHERE id = ? LIMIT 1")
      .bind(siteId)
      .first<{ vertical_slug: string | null }>();
    return await resolveVerticalAudience(db, site?.vertical_slug ?? null);
  } catch {
    return fallbackAudience(null);
  }
}
