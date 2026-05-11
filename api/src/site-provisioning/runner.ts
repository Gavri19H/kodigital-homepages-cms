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

async function resolveSiteHostname(db: D1Database, site_id: string): Promise<string> {
  const dom = await db
    .prepare(
      "SELECT domain AS hostname FROM domains WHERE site_id = ? " +
        "ORDER BY is_primary DESC, id ASC LIMIT 1",
    )
    .bind(site_id)
    .first<{ hostname: string | null }>();
  if (dom && typeof dom.hostname === "string" && dom.hostname.length > 0) return dom.hostname;
  const sr = await db
    .prepare("SELECT primary_domain AS hostname FROM sites WHERE id = ? LIMIT 1")
    .bind(site_id)
    .first<{ hostname: string | null }>();
  return sr && typeof sr.hostname === "string" && sr.hostname.length > 0 ? sr.hostname : "";
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
