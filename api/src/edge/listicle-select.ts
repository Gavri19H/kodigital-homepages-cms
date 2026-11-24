export interface ListiclePick {
  listicleId: string;
  versionPublicId: string;
  experimentId: string | null;
}

export async function buildListicleSnapshot(db: D1Database, siteId: string): Promise<Record<string, unknown>> {
  throw new Error("not implemented: buildListicleSnapshot");
}

export function pickListicle(entry: unknown, sid: string): ListiclePick | null {
  throw new Error("not implemented: pickListicle");
}
