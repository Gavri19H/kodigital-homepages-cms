import type { Env } from "../env";
import type { SiteSnapshot } from "./types";

export function parseSiteSnapshot(text: string): SiteSnapshot | null {
  throw new Error("not implemented: parseSiteSnapshot");
}

export async function buildSiteSnapshot(env: Env, hostname: string): Promise<SiteSnapshot | null> {
  throw new Error("not implemented: buildSiteSnapshot");
}
