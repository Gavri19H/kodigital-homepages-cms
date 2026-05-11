// Reserved top-level path segments — owned by application routes
// (admin shell, REST APIs, static assets, media, preview, health probe).
//
// Exactly 7 entries: admin, api, static, assets, media, preview, health.
// The compatibility /:slug catch-all in router.ts MUST refuse to serve any
// slug whose first segment is in this set, so a planted page row with
// the admin slug can never shadow the real /admin handler.

export const RESERVED_PATHS = [
  "admin",
  "api",
  "static",
  "assets",
  "media",
  "preview",
  "health",
] as const;

export type ReservedPath = (typeof RESERVED_PATHS)[number];

const reservedSet = new Set<string>(RESERVED_PATHS);

export function isReservedPath(slug: string | undefined | null): boolean {
  if (!slug) return false;
  const head = slug.replace(/^\/+/, "").split("/")[0] ?? "";
  return reservedSet.has(head);
}
