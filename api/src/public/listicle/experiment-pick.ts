// Edge sticky Version pick — design contract §15.2.
//
//   const sid = readCookie(req, 'ko_sid') || genId();
//   const exp = article.active_experiment;          // null ⇒ the control Version
//   const ver = exp ? stickyPick(sid + '|' + exp.public_id, exp.versions)
//                   : article.control;
//
// The Worker reads `ko_sid` (setting it when absent — SAME cookie semantics
// as the existing tracking script: path=/, max-age=1800, SameSite=Lax),
// computes a sticky assignment over the RUNNING experiment's Version
// allocations via the §31.2 canonical hash, echoes `ko_ver`, and serves that
// Version's own cached shell (§22: one cache key per lander_v).

import { lstBucket, pickArmIndex } from "./ab-hash";

export interface PickableVersion {
  public_id: string;
  traffic_allocation: number;
  is_control: number;
}

// Sticky pick: FNV-1a bucket over `${sid}|${experimentPublicId}` → the first
// Version whose cumulative allocation (bps) exceeds the bucket. Version
// order is the caller's stored order (id ASC — creation order), which is
// stable for the lifetime of a running experiment (§15.6 immutability).
export function stickyPick<V extends PickableVersion>(
  sid: string,
  experimentPublicId: string,
  versions: ReadonlyArray<V>,
): V {
  if (versions.length === 0) {
    throw new Error("stickyPick: no versions to pick from");
  }
  const bucket = lstBucket(sid, experimentPublicId);
  const index = pickArmIndex(
    bucket,
    versions.map((version) => ({ allocation: version.traffic_allocation })),
  );
  return versions[index]!;
}

// No running experiment ⇒ the single active/control Version: the control
// flag wins; absent a control flag (defensive) the first active Version by
// stored order serves.
export function controlVersion<V extends PickableVersion>(
  versions: ReadonlyArray<V>,
): V | null {
  if (versions.length === 0) return null;
  const control = versions.find((version) => version.is_control === 1);
  return control ?? versions[0]!;
}

// ---------------------------------------------------------------------------
// ko_sid / ko_ver cookie plumbing (same semantics as the tracking script)
// ---------------------------------------------------------------------------

export function readCookie(cookieHeader: string | null | undefined, name: string): string {
  if (typeof cookieHeader !== "string" || cookieHeader.length === 0) return "";
  const m = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  if (m === null) return "";
  try {
    return decodeURIComponent(m[1] ?? "");
  } catch {
    return m[1] ?? "";
  }
}

export function genSessionId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    // fall through
  }
  return `ko-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// 30-minute window, path=/, SameSite=Lax — byte-compatible with the cookie
// the client tracking script writes (analytics/tracking-script.ts).
export const SESSION_COOKIE_MAX_AGE_SECONDS = 1800;

export function sessionCookie(name: string, value: string): string {
  return `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${SESSION_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax`;
}
