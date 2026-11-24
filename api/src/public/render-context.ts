import type { PublicSiteContext } from "./middleware";
import type { PublicLayoutSiteInfo } from "./queries";
import { siteFaviconUrl } from "./site-brand";
import { mediaUrl } from "./view-models/media-url";

function parseBrandTokens(raw: string | undefined): Readonly<Record<string, string>> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const tokens: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string") tokens[key] = value;
    }
    return tokens;
  } catch {
    return {};
  }
}

// Site branding, layout snippets, ads and page-specific settings all come
// from this one tenant-scoped read. Start it alongside the page's content reads.
export async function loadRenderContext(
  db: D1Database,
  siteContext: Pick<PublicSiteContext, "siteId" | "hostname">,
) {
  const result = await db
    .prepare("SELECT key AS key, value AS value FROM site_settings WHERE site_id = ?")
    .bind(siteContext.siteId)
    .all<{ key: string; value: string | null }>();
  const settings: Record<string, string> = {};
  for (const row of result.results ?? []) {
    if (typeof row.value === "string") settings[row.key] = row.value;
  }
  const site: PublicLayoutSiteInfo & { site_id: string } = {
    site_id: siteContext.siteId,
    name: settings.site_name ?? siteContext.hostname,
    hostname: siteContext.hostname,
    tagline: settings.tagline ?? "",
    description: settings.site_description ?? "",
    logoUrl: mediaUrl(settings.logo_media_id),
    faviconUrl: siteFaviconUrl(settings.favicon_media_id),
    brandTokens: parseBrandTokens(settings.brand_tokens_json),
  };
  return { site, settings };
}
