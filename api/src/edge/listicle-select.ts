import { controlVersion, stickyPick, type PickableVersion } from "../public/listicle/experiment-pick";

export interface ListiclePick {
  listicleId: string;
  versionPublicId: string;
  experimentId: string | null;
  variantLabel: string;
  trafficAllocation: number;
}

interface SnapshotVersion extends PickableVersion {
  variant_label: string;
}

interface ListicleEntry {
  listicleId: string;
  publishedVersion: SnapshotVersion;
  experiment: { publicId: string; versions: SnapshotVersion[] } | null;
}

interface VersionRow extends SnapshotVersion {
  slug: string;
  listicle_id: string;
  experiment_id: string | null;
  is_arm: number;
}

function snapshotVersion({ public_id, variant_label, is_control, traffic_allocation }: VersionRow): SnapshotVersion {
  return { public_id, variant_label, is_control, traffic_allocation };
}

export async function buildListicleSnapshot(db: D1Database, siteId: string): Promise<Record<string, ListicleEntry>> {
  const { results } = await db.prepare(
    `SELECT a.slug, a.public_id AS listicle_id, e.public_id AS experiment_id,
            CASE WHEN v.experiment_id = e.id THEN 1 ELSE 0 END AS is_arm,
            v.public_id, v.variant_label, v.is_control, v.traffic_allocation
     FROM listicle_articles a
     JOIN listicle_article_versions v ON v.article_id = a.id AND v.status = 'active'
     LEFT JOIN listicle_article_experiments e ON e.id = a.active_experiment_id AND e.status = 'running'
     WHERE a.site_id = ? AND a.status = 'published'
     ORDER BY a.id, v.id`,
  ).bind(siteId).all<VersionRow>();

  const bySlug = new Map<string, VersionRow[]>();
  for (const row of results) {
    const versions = bySlug.get(row.slug);
    if (versions) versions.push(row);
    else bySlug.set(row.slug, [row]);
  }

  const snapshot: Record<string, ListicleEntry> = Object.create(null);
  for (const [slug, versions] of bySlug) {
    // Resolve the control once, including serve.ts's first-active fallback.
    const control = controlVersion(versions)!;
    snapshot[slug] = {
      listicleId: control.listicle_id,
      publishedVersion: snapshotVersion(control),
      experiment: control.experiment_id === null ? null : {
        publicId: control.experiment_id,
        versions: versions.filter((v) => v.is_arm === 1).map(snapshotVersion),
      },
    };
  }
  return snapshot;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isVersion(value: unknown): value is SnapshotVersion {
  return isRecord(value) &&
    typeof value.public_id === "string" && value.public_id.length > 0 &&
    typeof value.variant_label === "string" &&
    (value.is_control === 0 || value.is_control === 1) &&
    typeof value.traffic_allocation === "number" && Number.isInteger(value.traffic_allocation) &&
    value.traffic_allocation >= 0 && value.traffic_allocation <= 100;
}

function isListicleEntry(value: unknown): value is ListicleEntry {
  if (!isRecord(value) || typeof value.listicleId !== "string" || value.listicleId.length === 0 ||
      !isVersion(value.publishedVersion)) return false;
  const exp = value.experiment;
  if (exp === null) return true;
  if (!isRecord(exp) || typeof exp.publicId !== "string" || exp.publicId.length === 0 ||
      !Array.isArray(exp.versions)) return false;
  for (const arm of exp.versions) {
    if (!isVersion(arm)) return false;
  }
  return true;
}

export function pickListicle(entry: unknown, sid: string): ListiclePick | null {
  if (!isListicleEntry(entry)) return null;
  const { experiment } = entry;
  const version = experiment !== null && experiment.versions.length > 0
    ? stickyPick(sid, experiment.publicId, experiment.versions)
    : entry.publishedVersion;
  return {
    listicleId: entry.listicleId,
    versionPublicId: version.public_id,
    experimentId: experiment?.publicId ?? null,
    variantLabel: version.variant_label,
    trafficAllocation: version.traffic_allocation,
  };
}
