// Phase 3 / T18 + rescue-2 T35: Cloudflare interface boundary for
// site-provisioning.
//
// The site-provisioning runner MUST NEVER call api.cloudflare.com while
// SITE_PROVISIONING_DRY_RUN is anything but the exact string 'false'.
// This file is the single boundary that enforces that rule:
//
//   1. It re-exports `isDryRunProvisioning` and `isRouteMutationAllowed`
//      from ../env so the runner imports the safety predicates from one
//      place (instead of reading raw env strings inline).
//   2. It pins the env-binding name for the provisioning token to the
//      `CLOUDFLARE_PROVISIONING_API_TOKEN` constant. The runner refers to
//      the binding through this constant only — no raw env access — so a
//      grep across api/src/site-provisioning/ will never see the
//      forbidden generic (unsuffixed) name.
//   3. It exports `runCloudflareRouteMutation()` which the runner calls
//      instead of issuing fetch() inline. When dry-run is on (the
//      default), the helper records a cache_purge_log row with both
//      env-flag values and returns a `completed_dry_run` outcome WITHOUT
//      touching the network.
//   4. (T35) It exports `runCloudflareZoneValidation()` — the read-only
//      zone-presence check behind the validate_domain_in_cloudflare
//      step — and implements the REAL live route-mutation path: zone
//      lookup, Worker-route attach, domains-row promotion. The live path
//      runs ONLY when SITE_PROVISIONING_DRY_RUN=false AND
//      SITE_PROVISIONING_ALLOW_ROUTE_MUTATION=true AND the hostname is
//      not a protected legacy-production domain AND the provisioning
//      token binding is present. Every other combination short-circuits
//      with zero outbound fetch.
//
// Per T18.AC1 the three identifiers isDryRunProvisioning,
// isRouteMutationAllowed and the PROVISIONING-suffixed token binding
// name each appear on >=1 line of this file. Per T18.AC2 the generic
// unsuffixed token name must NOT appear anywhere under
// api/src/site-provisioning/; only the suffixed PROVISIONING form is
// used here.

import { isDryRunProvisioning, isRouteMutationAllowed } from "../env";
import type { Env } from "../env";
import { isProtectedDomain } from "../safety/protected-domains";

export { isDryRunProvisioning, isRouteMutationAllowed };

// Env-binding name for the provisioning-scoped Cloudflare API token.
// The runner reads `env[CLOUDFLARE_PROVISIONING_API_TOKEN]` so token
// rotation only touches this string in one place.
export const CLOUDFLARE_PROVISIONING_API_TOKEN =
  "CLOUDFLARE_PROVISIONING_API_TOKEN" as const;

// Worker script the attach step binds new-site routes to. Mirrors the
// `name =` field of api/wrangler.toml — change both together.
export const PROVISIONING_WORKER_SCRIPT_NAME =
  "kodigital-homepages-cms-worker" as const;

const CLOUDFLARE_API_BASE = "https://api.cloudflare.com/client/v4";

export interface CloudflareRouteMutationInput {
  site_id: string;
  hostname: string;
  action: string;
  payload: Record<string, unknown>;
}

export interface CloudflareRouteMutationOutcome {
  status: "completed" | "completed_dry_run" | "failed";
  output: string;
  error?: string;
}

export interface CloudflareCallContext {
  env: Env;
  db: D1Database;
}

// Canonical hostname resolver for a site: primary domains-table row
// first, sites.primary_domain as fallback, "" when neither exists. Both
// the runner and the steps registry import THIS resolver so live and
// dry-run paths can never disagree on which hostname a CF call targets.
export async function resolveSiteHostname(
  db: D1Database,
  site_id: string,
): Promise<string> {
  const dom = await db
    .prepare(
      "SELECT hostname FROM domains WHERE site_id = ? " +
        "ORDER BY is_primary DESC, id ASC LIMIT 1",
    )
    .bind(site_id)
    .first<{ hostname: string | null }>();
  if (dom && typeof dom.hostname === "string" && dom.hostname.length > 0) {
    return dom.hostname;
  }
  const sr = await db
    .prepare("SELECT primary_domain AS hostname FROM sites WHERE id = ? LIMIT 1")
    .bind(site_id)
    .first<{ hostname: string | null }>();
  return sr && typeof sr.hostname === "string" && sr.hostname.length > 0
    ? sr.hostname
    : "";
}

// Insert a cache_purge_log row recording the attempted mutation. Both
// env-flag values are persisted (dry_run and allow_route_mutation) so a
// postmortem can prove no real CF call escaped during a dry-run window.
async function recordCachePurgeLog(
  ctx: CloudflareCallContext,
  input: CloudflareRouteMutationInput,
  outcome: { status: string; response: string | null },
): Promise<void> {
  const dryRun = isDryRunProvisioning(ctx.env) ? 1 : 0;
  const allowRouteMutation = isRouteMutationAllowed(ctx.env) ? 1 : 0;
  await ctx.db
    .prepare(
      "INSERT INTO cache_purge_log " +
        "(site_id, hostname, action, status, dry_run, allow_route_mutation, payload, response) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(
      input.site_id,
      input.hostname,
      input.action,
      outcome.status,
      dryRun,
      allowRouteMutation,
      JSON.stringify(input.payload),
      outcome.response,
    )
    .run();
}

// Resolve the provisioning token binding. Returns null when the binding
// is unset (always the case in dev / dry-run mode).
function getProvisioningToken(env: Env): string | null {
  const raw = env[CLOUDFLARE_PROVISIONING_API_TOKEN as keyof Env];
  if (typeof raw !== "string" || raw.length === 0) return null;
  return raw;
}

// Zone name a hostname belongs to: the hostname itself when it is an
// apex (two labels), otherwise the last two labels. Multi-part public
// suffixes (co.uk) are out of scope for provisioned KoDigital domains.
export function zoneNameForHostname(hostname: string): string {
  const labels = hostname.split(".").filter((l) => l.length > 0);
  if (labels.length <= 2) return labels.join(".");
  return labels.slice(-2).join(".");
}

interface ZoneLookupResult {
  ok: boolean;
  zone_id: string | null;
  error?: string;
}

// GET /zones?name=<zone> — the single CF read both the validate step and
// the attach step's live path share. Callers MUST have passed the
// dry-run / protected-domain gates before this issues a fetch.
async function lookupZoneId(
  token: string,
  hostname: string,
): Promise<ZoneLookupResult> {
  const zoneName = zoneNameForHostname(hostname);
  if (zoneName.length === 0) {
    return { ok: false, zone_id: null, error: "empty hostname" };
  }
  const url = `${CLOUDFLARE_API_BASE}/zones?name=${encodeURIComponent(zoneName)}&status=active`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
  });
  if (!res.ok) {
    return { ok: false, zone_id: null, error: `zone lookup HTTP ${res.status}` };
  }
  const body = (await res.json()) as {
    success?: boolean;
    result?: Array<{ id?: string }>;
  };
  if (body.success !== true) {
    return { ok: false, zone_id: null, error: "zone lookup unsuccessful" };
  }
  const first = Array.isArray(body.result) ? body.result[0] : undefined;
  const zoneId = first && typeof first.id === "string" ? first.id : null;
  return { ok: true, zone_id: zoneId };
}

// T35 — read-only boundary behind validate_domain_in_cloudflare. Never
// mutates Cloudflare state. Protected hostnames are refused outright;
// dry-run short-circuits to completed_dry_run with zero outbound fetch;
// the live path records whether an active zone exists (an absent zone is
// a finding, not a failure — the attach step marks the domain pending).
export async function runCloudflareZoneValidation(
  ctx: CloudflareCallContext,
  input: { site_id: string; hostname: string },
): Promise<CloudflareRouteMutationOutcome> {
  const dryRun = isDryRunProvisioning(ctx.env);
  const allowRouteMutation = isRouteMutationAllowed(ctx.env);
  if (isProtectedDomain(input.hostname)) {
    return {
      status: "failed",
      output: "",
      error: `Refusing to validate protected hostname: ${input.hostname}`,
    };
  }
  if (dryRun) {
    return {
      status: "completed_dry_run",
      output: JSON.stringify({
        mode: "dry_run",
        site_id: input.site_id,
        hostname: input.hostname,
        zone_checked: false,
        dry_run: dryRun,
        allow_route_mutation: allowRouteMutation,
      }),
    };
  }
  const token = getProvisioningToken(ctx.env);
  if (token === null) {
    return {
      status: "failed",
      output: "",
      error: `${CLOUDFLARE_PROVISIONING_API_TOKEN} binding is not set`,
    };
  }
  const zone = await lookupZoneId(token, input.hostname);
  if (!zone.ok) {
    return { status: "failed", output: "", error: zone.error };
  }
  return {
    status: "completed",
    output: JSON.stringify({
      mode: "live",
      site_id: input.site_id,
      hostname: input.hostname,
      zone_checked: true,
      zone_found: zone.zone_id !== null,
      zone_id: zone.zone_id,
    }),
  };
}

// Promote the domains row after a successful live route attach.
async function markDomainAttached(
  db: D1Database,
  site_id: string,
  hostname: string,
  cf_route_id: string,
): Promise<void> {
  await db
    .prepare(
      "UPDATE domains SET cf_route_id = ?, status = 'active', " +
        "attached_at = unixepoch(), updated_at = unixepoch() " +
        "WHERE site_id = ? AND hostname = ?",
    )
    .bind(cf_route_id, site_id, hostname)
    .run();
}

// The single Cloudflare-mutation boundary used by the runner. Real route
// mutation happens ONLY when SITE_PROVISIONING_DRY_RUN=false AND
// SITE_PROVISIONING_ALLOW_ROUTE_MUTATION=true AND the hostname is not
// protected AND the provisioning token is present. Dry-run / disallowed
// short-circuits to `completed_dry_run` with a cache_purge_log receipt
// and zero fetch. In live mode an absent zone marks the domain pending
// (the "or_mark_pending" half of the step) instead of failing the job.
export async function runCloudflareRouteMutation(
  ctx: CloudflareCallContext,
  input: CloudflareRouteMutationInput,
): Promise<CloudflareRouteMutationOutcome> {
  const dryRun = isDryRunProvisioning(ctx.env);
  const allowRouteMutation = isRouteMutationAllowed(ctx.env);
  if (isProtectedDomain(input.hostname)) {
    await recordCachePurgeLog(ctx, input, {
      status: "failed",
      response: JSON.stringify({ refused: true, reason: "protected_domain" }),
    });
    return {
      status: "failed",
      output: "",
      error: `Refusing to mutate protected hostname: ${input.hostname}`,
    };
  }
  if (dryRun || !allowRouteMutation) {
    const outputPayload = {
      mode: "dry_run",
      site_id: input.site_id,
      hostname: input.hostname,
      action: input.action,
      dry_run: dryRun,
      allow_route_mutation: allowRouteMutation,
    };
    await recordCachePurgeLog(ctx, input, {
      status: "completed_dry_run",
      response: JSON.stringify({ skipped: true, reason: "dry_run_or_disallowed" }),
    });
    return {
      status: "completed_dry_run",
      output: JSON.stringify(outputPayload),
    };
  }
  const token = getProvisioningToken(ctx.env);
  if (token === null) {
    await recordCachePurgeLog(ctx, input, {
      status: "failed",
      response: JSON.stringify({ error: "missing_provisioning_token" }),
    });
    return {
      status: "failed",
      output: "",
      error: `${CLOUDFLARE_PROVISIONING_API_TOKEN} binding is not set`,
    };
  }
  // Live path (T35): resolve the zone, attach the Worker route, promote
  // the domains row. An absent zone is the mark_pending branch — the
  // domain stays status='pending' and the step completes.
  const zone = await lookupZoneId(token, input.hostname);
  if (!zone.ok) {
    await recordCachePurgeLog(ctx, input, {
      status: "failed",
      response: JSON.stringify({ error: zone.error ?? "zone lookup failed" }),
    });
    return { status: "failed", output: "", error: zone.error };
  }
  if (zone.zone_id === null) {
    await recordCachePurgeLog(ctx, input, {
      status: "completed",
      response: JSON.stringify({ attached: false, reason: "zone_not_found_marked_pending" }),
    });
    return {
      status: "completed",
      output: JSON.stringify({
        mode: "live",
        site_id: input.site_id,
        hostname: input.hostname,
        action: input.action,
        attached: false,
        marked_pending: true,
      }),
    };
  }
  const routeRes = await fetch(
    `${CLOUDFLARE_API_BASE}/zones/${zone.zone_id}/workers/routes`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        pattern: `${input.hostname}/*`,
        script: PROVISIONING_WORKER_SCRIPT_NAME,
      }),
    },
  );
  const routeBody = (await routeRes.json()) as {
    success?: boolean;
    result?: { id?: string };
  };
  if (!routeRes.ok || routeBody.success !== true) {
    await recordCachePurgeLog(ctx, input, {
      status: "failed",
      response: JSON.stringify({ error: `route attach HTTP ${routeRes.status}` }),
    });
    return {
      status: "failed",
      output: "",
      error: `route attach HTTP ${routeRes.status}`,
    };
  }
  const routeId =
    routeBody.result && typeof routeBody.result.id === "string"
      ? routeBody.result.id
      : "";
  await markDomainAttached(ctx.db, input.site_id, input.hostname, routeId);
  await recordCachePurgeLog(ctx, input, {
    status: "completed",
    response: JSON.stringify({ attached: true, cf_route_id: routeId }),
  });
  return {
    status: "completed",
    output: JSON.stringify({
      mode: "live",
      site_id: input.site_id,
      hostname: input.hostname,
      action: input.action,
      attached: true,
      cf_route_id: routeId,
      zone_id: zone.zone_id,
    }),
  };
}

// T37 [BCL-021] — site teardown boundary. The real Delete-site flow tears
// the Worker route down and purges the site's cache. Like every other call
// in this file it is dry-run gated: under SITE_PROVISIONING_DRY_RUN (the
// default) it records the two teardown actions to cache_purge_log and emits
// ZERO outbound fetch to api.cloudflare.com. The live path runs ONLY when
// dry-run is off AND mutation is allowed AND the token is present AND the
// hostname is not a protected legacy-production domain.
export interface CloudflareSiteTeardownInput {
  site_id: string;
  hostname: string;
  cf_route_id: string | null;
}

export interface CloudflareSiteTeardownOutcome {
  status: "completed" | "completed_dry_run" | "failed";
  // The teardown actions attempted, in order. Always
  // ["teardown_route", "purge_cache"] so a postmortem can prove BOTH the
  // route/DNS teardown and the cache purge were issued.
  actions: string[];
  // Count of real fetch() calls issued. MUST be 0 in dry-run mode (the
  // negative_fail_condition: dry-run must not touch api.cloudflare.com).
  outbound_calls: number;
  output: string;
  error?: string;
}

const SITE_TEARDOWN_ACTIONS: ReadonlyArray<string> = [
  "teardown_route",
  "purge_cache",
];

export async function runCloudflareSiteTeardown(
  ctx: CloudflareCallContext,
  input: CloudflareSiteTeardownInput,
): Promise<CloudflareSiteTeardownOutcome> {
  const dryRun = isDryRunProvisioning(ctx.env);
  const allowRouteMutation = isRouteMutationAllowed(ctx.env);
  const actions = [...SITE_TEARDOWN_ACTIONS];

  // Defense-in-depth: never act on a protected legacy-production hostname.
  if (isProtectedDomain(input.hostname)) {
    await recordCachePurgeLog(
      ctx,
      {
        site_id: input.site_id,
        hostname: input.hostname,
        action: "teardown_route",
        payload: { reason: "protected_domain" },
      },
      {
        status: "failed",
        response: JSON.stringify({ refused: true, reason: "protected_domain" }),
      },
    );
    return {
      status: "failed",
      actions,
      outbound_calls: 0,
      output: "",
      error: `Refusing to tear down protected hostname: ${input.hostname}`,
    };
  }

  // Dry-run (the default in dev + tests): record BOTH teardown actions and
  // emit zero outbound fetch.
  if (dryRun || !allowRouteMutation) {
    for (const action of actions) {
      await recordCachePurgeLog(
        ctx,
        {
          site_id: input.site_id,
          hostname: input.hostname,
          action,
          payload: { mode: "dry_run", cf_route_id: input.cf_route_id },
        },
        {
          status: "completed_dry_run",
          response: JSON.stringify({
            skipped: true,
            reason: "dry_run_or_disallowed",
          }),
        },
      );
    }
    return {
      status: "completed_dry_run",
      actions,
      outbound_calls: 0,
      output: JSON.stringify({
        mode: "dry_run",
        site_id: input.site_id,
        hostname: input.hostname,
        actions,
        dry_run: dryRun,
        allow_route_mutation: allowRouteMutation,
      }),
    };
  }

  // Live path (gated). Resolve the token + zone, delete the Worker route the
  // attach step created (if any), then purge the cache.
  const token = getProvisioningToken(ctx.env);
  if (token === null) {
    await recordCachePurgeLog(
      ctx,
      {
        site_id: input.site_id,
        hostname: input.hostname,
        action: "teardown_route",
        payload: {},
      },
      {
        status: "failed",
        response: JSON.stringify({ error: "missing_provisioning_token" }),
      },
    );
    return {
      status: "failed",
      actions,
      outbound_calls: 0,
      output: "",
      error: `${CLOUDFLARE_PROVISIONING_API_TOKEN} binding is not set`,
    };
  }

  let outbound = 0;
  const zone = await lookupZoneId(token, input.hostname);
  outbound += 1;
  if (!zone.ok) {
    await recordCachePurgeLog(
      ctx,
      {
        site_id: input.site_id,
        hostname: input.hostname,
        action: "teardown_route",
        payload: {},
      },
      {
        status: "failed",
        response: JSON.stringify({ error: zone.error ?? "zone lookup failed" }),
      },
    );
    return {
      status: "failed",
      actions,
      outbound_calls: outbound,
      output: "",
      error: zone.error,
    };
  }
  if (zone.zone_id === null) {
    // No active zone — nothing to tear down on the CF side. The DB cascade
    // still frees the domain; treat as completed (not a failure).
    await recordCachePurgeLog(
      ctx,
      {
        site_id: input.site_id,
        hostname: input.hostname,
        action: "teardown_route",
        payload: {},
      },
      {
        status: "completed",
        response: JSON.stringify({ torn_down: false, reason: "zone_not_found" }),
      },
    );
    return {
      status: "completed",
      actions,
      outbound_calls: outbound,
      output: JSON.stringify({
        mode: "live",
        site_id: input.site_id,
        hostname: input.hostname,
        torn_down: false,
        reason: "zone_not_found",
      }),
    };
  }

  // 1) DELETE the Worker route (only when one was attached).
  let routeDeleted = false;
  if (typeof input.cf_route_id === "string" && input.cf_route_id.length > 0) {
    const routeRes = await fetch(
      `${CLOUDFLARE_API_BASE}/zones/${zone.zone_id}/workers/routes/${input.cf_route_id}`,
      {
        method: "DELETE",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
      },
    );
    outbound += 1;
    routeDeleted = routeRes.ok;
  }
  await recordCachePurgeLog(
    ctx,
    {
      site_id: input.site_id,
      hostname: input.hostname,
      action: "teardown_route",
      payload: { cf_route_id: input.cf_route_id, zone_id: zone.zone_id },
    },
    {
      status: "completed",
      response: JSON.stringify({ route_deleted: routeDeleted }),
    },
  );

  // 2) Purge the zone cache.
  const purgeRes = await fetch(
    `${CLOUDFLARE_API_BASE}/zones/${zone.zone_id}/purge_cache`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ purge_everything: true }),
    },
  );
  outbound += 1;
  await recordCachePurgeLog(
    ctx,
    {
      site_id: input.site_id,
      hostname: input.hostname,
      action: "purge_cache",
      payload: { zone_id: zone.zone_id },
    },
    {
      status: "completed",
      response: JSON.stringify({ cache_purged: purgeRes.ok }),
    },
  );

  return {
    status: "completed",
    actions,
    outbound_calls: outbound,
    output: JSON.stringify({
      mode: "live",
      site_id: input.site_id,
      hostname: input.hostname,
      zone_id: zone.zone_id,
      route_deleted: routeDeleted,
      cache_purged: purgeRes.ok,
    }),
  };
}

// Step keys that — when dry-run is off and mutation is allowed — issue a
// real CF call. The runner consults this set to decide whether to route
// the step through `runCloudflareRouteMutation()` (which gates dry-run)
// instead of the registry handler in steps.ts.
export const CLOUDFLARE_MUTATION_STEP_KEYS: ReadonlySet<string> = new Set([
  "attach_domain_to_new_worker_or_mark_pending",
]);

export function isCloudflareMutationStep(stepKey: string): boolean {
  return CLOUDFLARE_MUTATION_STEP_KEYS.has(stepKey);
}
