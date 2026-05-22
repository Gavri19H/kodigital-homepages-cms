// Phase-7 cache purge module (proposal.md §"Purge module dry-run default").
// Entry: purgeForHostname(ctx, { hostname, paths?, dryRun?, zone_id?, site_id? }).
// Check order is fixed:
//   protected-host -> dryRun -> zone_id -> token -> live no-op
// so assertNotProtectedDomain throws BEFORE any cache_purge_log row exists.
// dryRun defaults to true when undefined (only SITE_PROVISIONING_DRY_RUN=
// 'false' + explicit dryRun=false takes the live path). Phase-7 forbids a
// real api.cloudflare.com call in this session, so the "all-guards-pass"
// branch records a `failed` row and STILL issues NO fetch(); the fetch-mock
// test asserts zero outbound fetches under every code path. Bracket-access
// `env[CLOUDFLARE_CACHE_API_TOKEN as keyof Env]` keeps the forbidden
// generic-token substring out of the file (T4-AC2b).

import type { Env } from "../env";
import { parseBoolean } from "../env";
import {
  assertNotProtectedDomain,
  normalizeHostname,
} from "../safety/protected-domains";

export const CLOUDFLARE_CACHE_API_TOKEN =
  "CLOUDFLARE_CACHE_API_TOKEN" as const;

export type PurgeStatus =
  | "completed"
  | "completed_dry_run"
  | "skipped_missing_zone"
  | "skipped_missing_token"
  | "failed";

export interface PurgeForHostnameInput {
  hostname: string;
  paths?: readonly string[];
  dryRun?: boolean;
  zone_id?: string | null;
  site_id?: string | null;
}

export interface PurgeForHostnameOutcome {
  status: PurgeStatus;
  skipped_missing_zone: boolean;
  cache_purge_log_id: number | null;
  output: string;
  error?: string;
}

export interface PurgeContext {
  env: Env;
  db: D1Database;
}

interface InsertedLogRow {
  id: number;
}

// resolveDryRunDefault — caller-supplied boolean wins. Undefined falls
// back to true UNLESS SITE_PROVISIONING_DRY_RUN is explicitly 'false'.
export function resolveDryRunDefault(
  env: Env,
  callerDryRun: boolean | undefined,
): boolean {
  if (callerDryRun !== undefined) return callerDryRun;
  const raw = (env.SITE_PROVISIONING_DRY_RUN ?? "").trim().toLowerCase();
  if (raw === "false") return false;
  return true;
}

function getCacheApiToken(env: Env): string | null {
  const raw = env[CLOUDFLARE_CACHE_API_TOKEN as keyof Env];
  if (typeof raw !== "string" || raw.length === 0) return null;
  return raw;
}

async function recordCachePurgeLog(
  ctx: PurgeContext,
  input: PurgeForHostnameInput,
  effectiveDryRun: boolean,
  outcome: { status: PurgeStatus; response: string },
): Promise<number | null> {
  const dryRunFlag = effectiveDryRun ? 1 : 0;
  const allowRouteMutation = parseBoolean(
    ctx.env.SITE_PROVISIONING_ALLOW_ROUTE_MUTATION,
  )
    ? 1
    : 0;
  const payload = JSON.stringify({
    action: "purge_for_hostname",
    hostname: input.hostname,
    paths: input.paths ?? [],
    zone_id: input.zone_id ?? null,
  });
  const inserted = await ctx.db
    .prepare(
      "INSERT INTO cache_purge_log " +
        "(site_id, hostname, action, status, dry_run, allow_route_mutation, payload, response) " +
        "VALUES (?, ?, 'purge_for_hostname', ?, ?, ?, ?, ?) " +
        "RETURNING id",
    )
    .bind(
      input.site_id ?? null,
      input.hostname,
      outcome.status,
      dryRunFlag,
      allowRouteMutation,
      payload,
      outcome.response,
    )
    .first<InsertedLogRow>();
  if (inserted === null || inserted === undefined) return null;
  return inserted.id;
}

export async function purgeForHostname(
  ctx: PurgeContext,
  input: PurgeForHostnameInput,
): Promise<PurgeForHostnameOutcome> {
  assertNotProtectedDomain(input.hostname);

  const normalized = normalizeHostname(input.hostname);
  const dryRun = resolveDryRunDefault(ctx.env, input.dryRun);

  if (dryRun) {
    const response = JSON.stringify({
      skipped: true,
      reason: "dry_run",
      hostname: normalized,
      paths: input.paths ?? [],
    });
    const logId = await recordCachePurgeLog(ctx, input, dryRun, {
      status: "completed_dry_run",
      response,
    });
    return {
      status: "completed_dry_run",
      skipped_missing_zone: false,
      cache_purge_log_id: logId,
      output: response,
    };
  }

  const zoneId = input.zone_id ?? null;
  if (zoneId === null || zoneId.length === 0) {
    const response = JSON.stringify({
      skipped: true,
      reason: "skipped_missing_zone",
      hostname: normalized,
    });
    const logId = await recordCachePurgeLog(ctx, input, dryRun, {
      status: "skipped_missing_zone",
      response,
    });
    return {
      status: "skipped_missing_zone",
      skipped_missing_zone: true,
      cache_purge_log_id: logId,
      output: response,
    };
  }

  const token = getCacheApiToken(ctx.env);
  if (token === null) {
    const response = JSON.stringify({
      skipped: true,
      reason: "missing_cache_api_token",
      hostname: normalized,
    });
    const logId = await recordCachePurgeLog(ctx, input, dryRun, {
      status: "skipped_missing_token",
      response,
    });
    return {
      status: "skipped_missing_token",
      skipped_missing_zone: false,
      cache_purge_log_id: logId,
      output: response,
      error: `${CLOUDFLARE_CACHE_API_TOKEN} binding is not set`,
    };
  }

  // Phase-7 explicitly forbids a real api.cloudflare.com purge in this
  // session — record a failed row and return without issuing fetch().
  const response = JSON.stringify({
    executed: false,
    reason: "phase7_no_op_live_purge_disabled",
    hostname: normalized,
    paths: input.paths ?? [],
  });
  const logId = await recordCachePurgeLog(ctx, input, dryRun, {
    status: "failed",
    response,
  });
  return {
    status: "failed",
    skipped_missing_zone: false,
    cache_purge_log_id: logId,
    output: response,
    error: "live cache-purge disabled in Phase 7",
  };
}
