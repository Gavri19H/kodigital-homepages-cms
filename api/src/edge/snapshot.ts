import { sessionReadDb, type D1Timing } from "../db/read-session";
import type { Env } from "../env";
import { resolveSiteByHostname } from "../site/site-context";
import { assembleLeadgenSnapshot, leadgenSnapshotStatements, type LeadgenSnapshotResults } from "./leadgen-select";
import { assembleListicleSnapshot, listicleSnapshotStatement, type ListicleSnapshotRow } from "./listicle-select";
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

interface SiteVersions {
  content_version: number;
  settings_version: number;
  write_bookmark: string | null;
}

interface BehaviorSetting {
  key: string;
  value: string | null;
}

function behaviorSettings(rows: BehaviorSetting[]) {
  // Match loadSiteBehaviorSettings in the public listicle renderer.
  let timeZone = "";
  let language = "";
  for (const { key, value } of rows) {
    if (typeof value !== "string") continue;
    if (key === "site_timezone") timeZone = value.trim();
    if (key === "site_language") language = value.trim();
  }
  return { timeZone, language };
}

export async function buildSiteSnapshot(env: Env, hostname: string, timing?: D1Timing): Promise<SiteSnapshot | null> {
  const db = sessionReadDb(env.DB, env.DB.withSession?.("first-primary"), timing);
  const site = await resolveSiteByHostname(db, hostname, env);
  // PublicPage caches a host miss for one minute. Read failures must reach its 503 handler.
  if (site === null) return null;

  const siteId = site.site_id;
  // The hostname lookup anchors freshness. Read all inputs for its site in one batch on that session.
  const [versionRows, settings, listicles, ...leadgen] = await db.batch([
    db.prepare("SELECT content_version, settings_version, write_bookmark FROM sites WHERE id = ?")
      .bind(siteId),
    db.prepare("SELECT key, value FROM site_settings WHERE site_id = ? AND key IN ('site_timezone', 'site_language')")
      .bind(siteId),
    listicleSnapshotStatement(db, siteId),
    ...leadgenSnapshotStatements(db, siteId),
  ]) as [D1Result<SiteVersions>, D1Result<BehaviorSetting>, D1Result<ListicleSnapshotRow>, ...LeadgenSnapshotResults];
  const versions = versionRows.results[0];
  if (!versions) throw new Error(`Missing versions for resolved site ${siteId}`);

  return {
    v: 1,
    siteId,
    hostname: site.hostname,
    status: site.status,
    contentVersion: versions.content_version,
    settingsVersion: versions.settings_version,
    writeBookmark: versions.write_bookmark,
    ...behaviorSettings(settings.results),
    listicles: assembleListicleSnapshot(listicles.results),
    leadgen: assembleLeadgenSnapshot(leadgen),
    builtAt: Date.now(),
  };
}
