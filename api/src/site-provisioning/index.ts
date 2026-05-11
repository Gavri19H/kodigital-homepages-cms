// Phase 3 / T17: site-provisioning module entry point + HTTP handler.
//
// Public API:
//   - STEP_KEYS / STEPS / TOTAL_STEPS  (registry, ordered)
//   - advanceNextStep(env, db, job)    (runner)
//   - provisionNextHandler(c)          (POST /api/admin/sites/:id/provision/next)
//
// The HTTP handler is registered in admin/api.ts as the
// `/sites/:id/provision/next` route. It looks up the active
// site_creation_jobs row for :id, calls advanceNextStep, and returns
// 200 {current_step, status, ...} envelope. T18 layers dry-run safety
// on top of this surface without changing the route shape.

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
  type AdvanceResult,
  type JobRow,
} from "./runner";

export {
  STEP_KEYS,
  STEPS,
  TOTAL_STEPS,
  advanceNextStep,
  findActiveJobForSite,
  ProvisioningError,
};
export type { AdvanceResult, JobRow, StepKey };

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
