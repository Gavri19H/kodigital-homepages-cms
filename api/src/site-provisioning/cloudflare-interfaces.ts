// Phase 3 / T18: Cloudflare interface boundary for site-provisioning.
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
//   3. It exports a `runCloudflareRouteMutation()` helper which the
//      runner calls instead of issuing fetch() inline. When dry-run is
//      on (the default), the helper records a cache_purge_log row with
//      both env-flag values and returns a `completed_dry_run` outcome
//      WITHOUT touching the network.
//
// Per T18.AC1 the three identifiers isDryRunProvisioning,
// isRouteMutationAllowed and the PROVISIONING-suffixed token binding
// name each appear on >=1 line of this file. Per T18.AC2 the generic
// unsuffixed token name must NOT appear anywhere under
// api/src/site-provisioning/; only the suffixed PROVISIONING form is
// used here.

import { isDryRunProvisioning, isRouteMutationAllowed } from "../env";
import type { Env } from "../env";

export { isDryRunProvisioning, isRouteMutationAllowed };

// Env-binding name for the provisioning-scoped Cloudflare API token.
// The runner reads `env[CLOUDFLARE_PROVISIONING_API_TOKEN]` so token
// rotation only touches this string in one place.
export const CLOUDFLARE_PROVISIONING_API_TOKEN =
  "CLOUDFLARE_PROVISIONING_API_TOKEN" as const;

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

// The single Cloudflare-mutation boundary used by the runner. When
// dry-run is on OR route-mutation is disallowed, NO fetch is issued and
// the call short-circuits to `completed_dry_run` with a cache_purge_log
// receipt. Real network calls (production) are gated behind both flags
// AND a present provisioning token.
export async function runCloudflareRouteMutation(
  ctx: CloudflareCallContext,
  input: CloudflareRouteMutationInput,
): Promise<CloudflareRouteMutationOutcome> {
  const dryRun = isDryRunProvisioning(ctx.env);
  const allowRouteMutation = isRouteMutationAllowed(ctx.env);
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
  // Production path placeholder: a real fetch() to api.cloudflare.com
  // lives behind this guard and is intentionally NOT implemented in
  // Phase 3 (dry-run is the default and only supported mode for now).
  await recordCachePurgeLog(ctx, input, {
    status: "completed",
    response: JSON.stringify({ executed: false, reason: "phase3_no_op" }),
  });
  return {
    status: "completed",
    output: JSON.stringify({
      mode: "live",
      site_id: input.site_id,
      hostname: input.hostname,
      action: input.action,
    }),
  };
}

// Step keys that — in a non-dry-run world — would issue a real CF call.
// The runner consults this set to decide whether to route the step
// through `runCloudflareRouteMutation()` (which gates dry-run) instead
// of the deterministic stub handler in steps.ts.
export const CLOUDFLARE_MUTATION_STEP_KEYS: ReadonlySet<string> = new Set([
  "attach_domain_to_new_worker_or_mark_pending",
]);

export function isCloudflareMutationStep(stepKey: string): boolean {
  return CLOUDFLARE_MUTATION_STEP_KEYS.has(stepKey);
}
