// LeadGen §30.4 runtime request guard — the pre-money/pre-provider hardening
// layer for /lg/auction + /lg/pb (contract 09 §30.4). Runs, in order,
// blocklist → rate limit → bot detection → diagnostic log BEFORE any provider
// fetch or money write. A POSITIVE detection returns {ok:false, status, reason}
// (the caller returns that status, no-store, without running the auction /
// ingest); the guard's OWN error fails OPEN ({ok:true}) so a hardening hiccup
// never drops legitimate revenue traffic.
//
// Reuses the P11 traffic-quality predicate (analytics/listicle-quality:
// readCfSignals + isBotSignals) — the same bot signals the /lg/track beacon
// stamps — rather than reinventing bot detection. KV keys use the LeadGen
// dedupe prefix `lg_rl:` (never a listicles prefix).

import type { Env } from "../../env";
import { readEnvSecret } from "../../env";
import { isBotSignals, readCfSignals } from "../../analytics/listicle-quality";

// §30.4 ZIP validation — the exact contract shape. Exported + tested.
export function isValidZip(zip: string): boolean {
  return /^\d{5}$/.test(zip);
}

export type GuardOutcome = { ok: true } | { ok: false; status: number; reason: string };

export interface GuardOptions {
  now?: number; // ms epoch (tests pin the rate-limit window)
  rateLimitPerMinute?: number;
}

const RATE_LIMIT_PREFIX = "lg_rl:";
const DEFAULT_RATE_LIMIT_PER_MINUTE = 120; // authored bound: generous per-IP wall
const RATE_WINDOW_MS = 60_000;
const RATE_KEY_TTL_SECONDS = 120;

// §30.4 diagnostic log on a block — reason + status ONLY, never IP / UA / any PII.
function logBlock(reason: string, status: number): void {
  console.warn(`[lg-guard] blocked reason=${reason} status=${status}`);
}

// Blocklist: an env CSV (LEADGEN_BLOCKLIST) matched against the request's
// CF-Connecting-IP (exact) OR User-Agent (case-insensitive substring). Absent
// env ⇒ allow (no blocklist configured).
function isBlocklisted(env: Env, ip: string, userAgent: string): boolean {
  const csv = readEnvSecret(env, "LEADGEN_BLOCKLIST");
  if (csv === undefined) return false;
  const uaLower = userAgent.toLowerCase();
  for (const raw of csv.split(",")) {
    const entry = raw.trim();
    if (entry === "") continue;
    if (ip !== "" && ip === entry) return true;
    if (uaLower !== "" && uaLower.includes(entry.toLowerCase())) return true;
  }
  return false;
}

// Sliding-window (2-bucket weighted) per-IP rate limit over KV. Returns true when
// the request is over the limit. A KV hiccup ⇒ false (allow) — a counting glitch
// must never drop a legitimate conversion / auction.
async function isRateLimited(env: Env, ip: string, nowMs: number, limit: number): Promise<boolean> {
  if (ip === "") return false; // no client IP ⇒ cannot rate-limit ⇒ allow
  try {
    const curBucket = Math.floor(nowMs / RATE_WINDOW_MS);
    const curKey = `${RATE_LIMIT_PREFIX}${ip}:${curBucket}`;
    const prevKey = `${RATE_LIMIT_PREFIX}${ip}:${curBucket - 1}`;
    const [curRaw, prevRaw] = await Promise.all([env.CACHE.get(curKey), env.CACHE.get(prevKey)]);
    const cur = curRaw === null ? 0 : parseInt(curRaw, 10);
    const prev = prevRaw === null ? 0 : parseInt(prevRaw, 10);
    const curCount = Number.isFinite(cur) ? cur : 0;
    const prevCount = Number.isFinite(prev) ? prev : 0;
    // Weight the previous bucket by the fraction of it still inside the trailing
    // 60s window (the standard sliding-window-counter estimate).
    const elapsedFraction = (nowMs % RATE_WINDOW_MS) / RATE_WINDOW_MS;
    const estimate = curCount + prevCount * (1 - elapsedFraction);
    if (estimate >= limit) return true;
    await env.CACHE.put(curKey, String(curCount + 1), { expirationTtl: RATE_KEY_TTL_SECONDS });
    return false;
  } catch {
    return false; // KV hiccup ⇒ allow (fail-open)
  }
}

// §30.4 guard: blocklist → rate limit → bot, before any provider fetch / money
// write. A positive detection blocks (403 blocklist/bot, 429 rate-limit); the
// guard's own error fails OPEN.
export async function runtimeRequestGuard(
  env: Env,
  req: Request,
  opts?: GuardOptions,
): Promise<GuardOutcome> {
  try {
    const ip = (req.headers.get("CF-Connecting-IP") ?? "").trim();
    const userAgent = req.headers.get("User-Agent") ?? "";
    const nowMs = opts?.now ?? Date.now();
    const limit = opts?.rateLimitPerMinute ?? DEFAULT_RATE_LIMIT_PER_MINUTE;

    // 1. blocklist
    if (isBlocklisted(env, ip, userAgent)) {
      logBlock("blocklist", 403);
      return { ok: false, status: 403, reason: "blocklist" };
    }
    // 2. rate limit
    if (await isRateLimited(env, ip, nowMs, limit)) {
      logBlock("rate_limit", 429);
      return { ok: false, status: 429, reason: "rate_limit" };
    }
    // 3. bot (P11 signals: cf.botManagement + declared-bot/datacenter/UA heuristics)
    if (isBotSignals(readCfSignals(req), userAgent)) {
      logBlock("bot", 403);
      return { ok: false, status: 403, reason: "bot" };
    }
    return { ok: true };
  } catch {
    // The guard's OWN failure fails OPEN — hardening never drops real traffic.
    return { ok: true };
  }
}
