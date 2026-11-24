import type { Env } from "../env";
import { resolveSiteByHostname } from "../site/site-context";
import { buildLeadgenSnapshot } from "./leadgen-select";
import { buildListicleSnapshot } from "./listicle-select";
import type { SiteSnapshot } from "./types";

// Bound the text passed to JSON.parse on each gateway request (UTF-16 code units).
const MAX_SNAPSHOT_LENGTH = 1024 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isSiteSnapshot(value: unknown): value is SiteSnapshot {
  return isRecord(value) && value.v === 1
    && typeof value.siteId === "string" && value.siteId.trim() !== ""
    && typeof value.hostname === "string" && value.hostname.trim() !== ""
    && typeof value.status === "string"
    && Number.isFinite(value.contentVersion) && Number.isFinite(value.settingsVersion)
    && isNullableString(value.writeBookmark)
    && isNullableString(value.timeZone) && isNullableString(value.language)
    && Number.isFinite(value.builtAt)
    && isRecord(value.listicles) && isRecord(value.leadgen);
}

export function parseSiteSnapshot(text: string): SiteSnapshot | null {
  if (typeof text !== "string" || text.length > MAX_SNAPSHOT_LENGTH) return null;
  try {
    const value: unknown = JSON.parse(text);
    return isSiteSnapshot(value) ? value : null;
  } catch {
    return null;
  }
}

interface SnapshotBinding {
  withSession?(constraint: "first-primary"): Pick<D1Database, "prepare">;
}

interface SiteVersions {
  content_version: number;
  settings_version: number;
  write_bookmark: string | null;
}

async function readBehaviorSettings(db: D1Database, siteId: string) {
  const { results } = await db.prepare(
    "SELECT key, value FROM site_settings WHERE site_id = ? AND key IN ('site_timezone', 'site_language')",
  ).bind(siteId).all<{ key: string; value: string | null }>();

  // Match loadSiteBehaviorSettings in the public listicle renderer.
  let timeZone = "";
  let language = "";
  for (const { key, value } of results) {
    if (typeof value !== "string") continue;
    if (key === "site_timezone") timeZone = value.trim();
    if (key === "site_language") language = value.trim();
  }
  return { timeZone, language };
}

export async function buildSiteSnapshot(env: Env, hostname: string): Promise<SiteSnapshot | null> {
  try {
    const binding: SnapshotBinding = env.DB;
    // The shared resolver and builders take D1Database and only use prepare().
    const db = (binding.withSession?.("first-primary") ?? env.DB) as D1Database;
    const site = await resolveSiteByHostname(db, hostname, env);
    if (site === null) return null;

    const siteId = site.site_id;
    const [versions, settings, listicles, leadgen] = await Promise.all([
      db.prepare("SELECT content_version, settings_version, write_bookmark FROM sites WHERE id = ?")
        .bind(siteId).first<SiteVersions>(),
      readBehaviorSettings(db, siteId),
      buildListicleSnapshot(db, siteId),
      buildLeadgenSnapshot(db, siteId),
    ]);
    if (versions === null) return null;

    return {
      v: 1,
      siteId,
      hostname: site.hostname,
      status: site.status,
      contentVersion: versions.content_version,
      settingsVersion: versions.settings_version,
      writeBookmark: versions.write_bookmark,
      ...settings,
      listicles,
      leadgen,
      builtAt: Date.now(),
    };
  } catch {
    // The gateway falls back to the live renderer if any snapshot read fails.
    return null;
  }
}
