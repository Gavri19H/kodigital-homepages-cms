// Phase 3 / T17: site-provisioning module entry point + HTTP handler.
//
// Public API:
//   - STEP_KEYS / STEPS / TOTAL_STEPS  (registry, ordered)
//   - advanceNextStep(env, db, job)    (runner)
//   - provisionNextHandler(c)          (POST /api/admin/sites/:id/provision/next)
//   - provisionStatusHandler(c)        (GET  /api/admin/sites/:id/provision)
//
// The HTTP handler is registered in admin/api.ts as the
// `/sites/:id/provision/next` route. It looks up the active
// site_creation_jobs row for :id, calls advanceNextStep, and returns
// 200 {current_step, status, ...} envelope. T18 layers dry-run safety
// on top of this surface without changing the route shape.
//
// WARN-FIX-1: provisionStatusHandler reports the current provisioning
// progress without advancing the job. It returns the latest
// site_creation_job_steps row for the active job
// (`{resource:{current_step:int, status:string, step_key:string}}`).
// Both missing-site and missing-job return 404 with a neutral error
// message — the handler MUST NOT leak whether the site exists when no
// provisioning job is attached to it.
//
// T39 (rescue-2 D6): every 200 response also carries a top-level
// `launch_readiness` field — the JSON object the update_launch_readiness
// step wrote into its site_creation_job_steps.output row
// (domain_attached, published_articles, media_count, cache_warmed,
// smoke_passed, content_mode), or null until that step has run. The
// domains-page poll script reads `body.launch_readiness` and renders
// the readiness badges from it.

import type { Context } from "hono";
import type { Env } from "../env";
import {
  STEP_KEYS,
  STEPS,
  TOTAL_STEPS,
  type StepKey,
} from "./steps";
import {
  advanceNextStep,
  findActiveJobForSite,
  ProvisioningError,
  runProvisioningToCompletion,
  scheduleBackgroundProvisioning,
  type AdvanceResult,
  type JobRow,
  type ProvisioningRunSummary,
  type WaitUntilCtx,
} from "./runner";

export {
  STEP_KEYS,
  STEPS,
  TOTAL_STEPS,
  advanceNextStep,
  findActiveJobForSite,
  ProvisioningError,
  runProvisioningToCompletion,
  scheduleBackgroundProvisioning,
};
export type {
  AdvanceResult,
  JobRow,
  ProvisioningRunSummary,
  StepKey,
  WaitUntilCtx,
};

interface LatestStepRow {
  step_key: string;
  step_order: number;
  status: string;
}

// T39: read back the readiness rollup the update_launch_readiness step
// persisted to its output row. Corrupt or absent stored JSON resolves to
// null (d1-database-safety: a dedicated try/catch falls through instead
// of failing the status read — the rollup re-materializes the next time
// the step runs).
async function loadLaunchReadiness(
  db: D1Database,
  jobId: string,
): Promise<unknown> {
  const row = await db
    .prepare(
      "SELECT output FROM site_creation_job_steps " +
        "WHERE job_id = ? AND step_key = 'update_launch_readiness' LIMIT 1",
    )
    .bind(jobId)
    .first<{ output: string | null }>();
  if (!row || typeof row.output !== "string" || row.output.length === 0) {
    return null;
  }
  try {
    const parsed = JSON.parse(row.output) as {
      launch_readiness?: unknown;
    };
    return parsed?.launch_readiness ?? null;
  } catch {
    return null;
  }
}

export async function provisionStatusHandler(
  c: Context<{ Bindings: Env }>,
): Promise<Response> {
  const siteId = c.req.param("id");
  if (typeof siteId !== "string" || siteId.length === 0) {
    return c.json({ error: "Provisioning status not available" }, 404);
  }
  const siteRow = await c.env.DB.prepare(
    "SELECT id FROM sites WHERE id = ? LIMIT 1",
  )
    .bind(siteId)
    .first<{ id: string }>();
  if (siteRow === null || siteRow === undefined) {
    return c.json({ error: "Provisioning status not available" }, 404);
  }
  const job = await findActiveJobForSite(c.env.DB, siteId);
  if (job === null) {
    return c.json({ error: "Provisioning status not available" }, 404);
  }
  const stepRow = await c.env.DB.prepare(
    "SELECT step_key, step_order, status FROM site_creation_job_steps " +
      "WHERE job_id = ? ORDER BY step_order DESC, id DESC LIMIT 1",
  )
    .bind(job.id)
    .first<LatestStepRow>();
  const launchReadiness = await loadLaunchReadiness(c.env.DB, job.id);
  if (stepRow === null || stepRow === undefined) {
    return c.json({
      resource: {
        current_step: job.current_step_index,
        status: job.status,
        step_key: "",
      },
      launch_readiness: launchReadiness,
    });
  }
  return c.json({
    resource: {
      current_step: stepRow.step_order,
      status: stepRow.status,
      step_key: stepRow.step_key,
    },
    launch_readiness: launchReadiness,
  });
}

export async function provisionNextHandler(
  c: Context<{ Bindings: Env }>,
): Promise<Response> {
  const siteId = c.req.param("id");
  if (typeof siteId !== "string" || siteId.length === 0) {
    return c.json({ error: "Invalid site id" }, 400);
  }
  const siteRow = await c.env.DB.prepare(
    "SELECT id FROM sites WHERE id = ? LIMIT 1",
  )
    .bind(siteId)
    .first<{ id: string }>();
  if (siteRow === null || siteRow === undefined) {
    return c.json({ error: "Site not found" }, 404);
  }
  const job = await findActiveJobForSite(c.env.DB, siteId);
  if (job === null) {
    return c.json({ error: "No provisioning job for this site" }, 404);
  }
  try {
    const result = await advanceNextStep(c.env, c.env.DB, job);
    return c.json(
      {
        job_id: result.job_id,
        site_id: result.site_id,
        current_step: result.current_step,
        current_step_index: result.current_step_index,
        total_steps: result.total_steps,
        status: result.status,
        last_step_status: result.last_step_status,
        completed: result.completed,
      },
      200,
    );
  } catch (err) {
    if (err instanceof ProvisioningError) {
      return c.json({ error: err.message, code: err.code }, 500);
    }
    const message = err instanceof Error ? err.message : "provision step failed";
    return c.json({ error: message }, 500);
  }
}
