// Phase 3 / T17 + T18: Site-provisioning runner.
//
// Advances a site_creation_jobs row by ONE step per call, persists a
// site_creation_job_steps receipt, and reports {current_step, status}.
// T18 routes any Cloudflare-mutation step (e.g.
// attach_domain_to_new_worker_or_mark_pending) through
// cloudflare-interfaces.ts which gates dry-run + logs cache_purge_log.
// Every D1 call uses static SQL + .bind() (mirrors db/index.ts).

import type { Env } from "../env";
import {
  STEPS,
  STEP_KEYS,
  TOTAL_STEPS,
  getStepKeyForIndex,
  type StepHandlerResult,
  type StepKey,
} from "./steps";
import {
  isCloudflareMutationStep,
  resolveSiteHostname,
  runCloudflareRouteMutation,
} from "./cloudflare-interfaces";

export interface JobRow {
  id: string;
  site_id: string;
  status: string;
  current_step_index: number;
  total_steps: number;
}

export interface AdvanceResult {
  job_id: string;
  site_id: string;
  current_step: StepKey | null;
  current_step_index: number;
  total_steps: number;
  status: string;
  last_step_status: StepHandlerResult["status"] | null;
  completed: boolean;
}

export class ProvisioningError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "ProvisioningError";
  }
}

export async function findActiveJobForSite(db: D1Database, siteId: string): Promise<JobRow | null> {
  const row = await db
    .prepare(
      "SELECT id, site_id, status, current_step_index, total_steps " +
        "FROM site_creation_jobs WHERE site_id = ? ORDER BY created_at DESC, id DESC LIMIT 1",
    )
    .bind(siteId)
    .first<JobRow>();
  return row ?? null;
}

async function upsertStepRow(
  db: D1Database, job_id: string, step_key: StepKey, step_order: number, inputJson: string,
): Promise<void> {
  await db
    .prepare(
      "INSERT INTO site_creation_job_steps " +
        "(job_id, step_key, step_order, status, attempt_count, input, started_at) " +
        "VALUES (?, ?, ?, 'running', 1, ?, unixepoch()) " +
        "ON CONFLICT(job_id, step_key) DO UPDATE SET " +
        "status = 'running', attempt_count = site_creation_job_steps.attempt_count + 1, " +
        "input = excluded.input, started_at = unixepoch(), updated_at = unixepoch()",
    )
    .bind(job_id, step_key, step_order, inputJson)
    .run();
}

async function finalizeStepRow(
  db: D1Database, job_id: string, step_key: StepKey, result: StepHandlerResult,
): Promise<void> {
  await db
    .prepare(
      "UPDATE site_creation_job_steps SET status = ?, output = ?, error = ?, " +
        "finished_at = unixepoch(), updated_at = unixepoch() WHERE job_id = ? AND step_key = ?",
    )
    .bind(result.status, result.output, result.error ?? null, job_id, step_key)
    .run();
}

async function advanceJobPointer(
  db: D1Database, job_id: string, next_index: number, current_step: StepKey, step_result: StepHandlerResult,
): Promise<string> {
  const stepFailed = step_result.status === "failed";
  const finished = next_index >= TOTAL_STEPS;
  const nextStatus = stepFailed ? "failed" : finished ? "completed" : "running";
  const lastError = stepFailed ? (step_result.error ?? "step failed") : null;
  await db
    .prepare(
      "UPDATE site_creation_jobs SET current_step = ?, current_step_index = ?, " +
        "status = ?, last_error = ?, updated_at = unixepoch() WHERE id = ?",
    )
    .bind(current_step, next_index, nextStatus, lastError, job_id)
    .run();
  if (nextStatus === "completed") {
    await db
      .prepare(
        "UPDATE sites SET last_provisioned_at = unixepoch(), updated_at = unixepoch() " +
          "WHERE id = (SELECT site_id FROM site_creation_jobs WHERE id = ? LIMIT 1)",
      )
      .bind(job_id)
      .run();
  }
  return nextStatus;
}

// MQAFIX-1: Drive the provisioning runner to completion for a freshly
// created site (or a halted one). Loops `advanceNextStep` until the job
// reaches `completed` / `failed`, runs into an unknown step index, or
// exceeds the safety bound (TOTAL_STEPS + 1 iterations). The +1 lets
// callers verify the 16th invocation is idempotent (returns the
// `completed` short-circuit without writing a fresh step row). Errors
// from the underlying runner are swallowed and reported through the
// returned `final_status='aborted'` — the caller (sites POST handler)
// must NOT fail the user request because background provisioning
// hiccupped; the site row itself is already committed.
export interface ProvisioningRunSummary {
  steps_run: number;
  final_status: string;
  last_step_status: StepHandlerResult["status"] | null;
}

export async function runProvisioningToCompletion(
  env: Env,
  db: D1Database,
  site_id: string,
  max_iterations: number = TOTAL_STEPS + 1,
): Promise<ProvisioningRunSummary> {
  let steps_run = 0;
  let final_status = "no_job";
  let last_step_status: StepHandlerResult["status"] | null = null;
  for (let i = 0; i < max_iterations; i++) {
    const job = await findActiveJobForSite(db, site_id);
    if (job === null) {
      final_status = steps_run === 0 ? "no_job" : final_status;
      break;
    }
    if (job.status === "completed" || job.status === "failed") {
      final_status = job.status;
      break;
    }
    try {
      const result = await advanceNextStep(env, db, job);
      final_status = result.status;
      last_step_status = result.last_step_status;
      steps_run += 1;
      if (result.completed || result.last_step_status === "failed") {
        break;
      }
    } catch (err) {
      final_status = "aborted";
      void err;
      break;
    }
  }
  return { steps_run, final_status, last_step_status };
}

// T38 [BCL-074] — the only ExecutionContext capability the async driver
// needs is waitUntil. Declaring the structural subset (rather than the
// Workers `ExecutionContext`) keeps this module runtime-agnostic and lets a
// unit test hand in a plain `{ waitUntil }` capturing fake.
export interface WaitUntilCtx {
  waitUntil(promise: Promise<unknown>): void;
}

// T38 [BCL-074] — drive provisioning ASYNCHRONOUSLY so the create request
// returns immediately. Background work advances the build one idempotent
// step at a time (runProvisioningToCompletion loops advanceNextStep); the
// final update_launch_readiness step flips the site to status='active'. A
// killed or failing step is persisted as failed + resumable by
// advanceNextStep (the job row keeps current_step_index pointed at the
// failed step and records last_error — never swallowed) and can be resumed
// from the UI (T39) or via POST /api/admin/sites/:id/provision/next.
//
// When an ExecutionContext is present — the Workers runtime always provides
// one — the loop is handed to ctx.waitUntil so it runs AFTER the response is
// flushed (the request is NOT blocked on the build). When it is absent (a
// direct unit-test invocation that passes no executionCtx) we await the loop
// inline as a best-effort fallback: there is no background channel to defer
// to, and the freshly-created site should still finish provisioning. Either
// path is non-throwing: the site row is already committed and a halted job
// is resumable, so a background hiccup surfaces as the job's last_error, not
// as an unhandled rejection that would fail the user's create request.
export async function scheduleBackgroundProvisioning(
  ctx: WaitUntilCtx | undefined,
  env: Env,
  db: D1Database,
  site_id: string,
): Promise<void> {
  const drive = runProvisioningToCompletion(env, db, site_id).then(
    () => undefined,
    () => undefined,
  );
  if (ctx !== undefined && typeof ctx.waitUntil === "function") {
    ctx.waitUntil(drive);
    return;
  }
  await drive;
}

export async function advanceNextStep(env: Env, db: D1Database, job: JobRow): Promise<AdvanceResult> {
  if (job.status === "completed" || job.status === "failed") {
    return {
      job_id: job.id,
      site_id: job.site_id,
      current_step: getStepKeyForIndex(STEP_KEYS.length - 1),
      current_step_index: job.current_step_index,
      total_steps: TOTAL_STEPS,
      status: job.status,
      last_step_status: null,
      completed: job.status === "completed",
    };
  }
  // T34 defensive stale-job guard. Jobs minted before the registry grew
  // to 16 steps (or rows that fell back to migration 0002's DEFAULT 15)
  // carry a stale total_steps — re-sync the stored count so DB progress
  // math agrees with the live STEP_KEYS registry.
  if (job.total_steps !== TOTAL_STEPS) {
    await db
      .prepare(
        "UPDATE site_creation_jobs SET total_steps = ?, updated_at = unixepoch() WHERE id = ?",
      )
      .bind(TOTAL_STEPS, job.id)
      .run();
  }
  // A non-terminal job whose pointer already ran past the end of the
  // registry has executed every registered step — finalize it as
  // completed instead of throwing no_step_at_index.
  if (job.current_step_index >= TOTAL_STEPS) {
    await db
      .prepare(
        "UPDATE site_creation_jobs SET status = 'completed', current_step_index = ?, " +
          "last_error = NULL, updated_at = unixepoch() WHERE id = ?",
      )
      .bind(TOTAL_STEPS, job.id)
      .run();
    return {
      job_id: job.id,
      site_id: job.site_id,
      current_step: getStepKeyForIndex(STEP_KEYS.length - 1),
      current_step_index: TOTAL_STEPS,
      total_steps: TOTAL_STEPS,
      status: "completed",
      last_step_status: null,
      completed: true,
    };
  }
  const index = job.current_step_index;
  const step_key = getStepKeyForIndex(index);
  if (step_key === null) {
    throw new ProvisioningError("no_step_at_index", `No provisioning step registered for index ${index}`);
  }
  const inputJson = JSON.stringify({ job_id: job.id, site_id: job.site_id, step_order: index, step_key });
  await upsertStepRow(db, job.id, step_key, index, inputJson);
  let result: StepHandlerResult;
  try {
    if (isCloudflareMutationStep(step_key)) {
      const hostname = await resolveSiteHostname(db, job.site_id);
      const m = await runCloudflareRouteMutation(
        { env, db },
        { site_id: job.site_id, hostname, action: step_key, payload: { job_id: job.id, step_order: index } },
      );
      result = { status: m.status, output: m.output, error: m.error };
    } else {
      result = await STEPS[step_key]({ env, db, job_id: job.id, site_id: job.site_id, step_order: index });
    }
  } catch (err) {
    result = { status: "failed", output: "", error: err instanceof Error ? err.message : String(err) };
  }
  await finalizeStepRow(db, job.id, step_key, result);
  const next_index = result.status === "failed" ? index : index + 1;
  const finalStatus = await advanceJobPointer(db, job.id, next_index, step_key, result);
  return {
    job_id: job.id,
    site_id: job.site_id,
    current_step: step_key,
    current_step_index: next_index,
    total_steps: TOTAL_STEPS,
    status: finalStatus,
    last_step_status: result.status,
    completed: finalStatus === "completed",
  };
}
