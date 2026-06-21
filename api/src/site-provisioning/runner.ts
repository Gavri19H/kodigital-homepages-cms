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
  STARTER_ARTICLE_TARGET,
  MAX_UNIT_ATTEMPTS,
  getStepKeyForIndex,
  type StepHandlerResult,
  type StepKey,
} from "./steps";

// rescue-4 — completion-loop iteration bound (PR #28 finding #4 hardening).
// The two chunked steps (generate_15_homepage_articles,
// generate_or_assign_article_images) process ONE unit per call, returning
// in_progress (same step, pointer unchanged) until that stage is done. In the
// worst case EVERY unit retries up to MAX_UNIT_ATTEMPTS times before it either
// succeeds or is marked 'failed' and skipped — so each chunked stage can take
// up to MAX_UNIT_ATTEMPTS * STARTER_ARTICLE_TARGET in_progress passes, and there
// are 2 such stages. The bound is therefore the TOTAL_STEPS step completions
// PLUS MAX_UNIT_ATTEMPTS * 2 * STARTER_ARTICLE_TARGET in_progress passes, so a
// SINGLE uninterrupted drive can fully settle the build even when units retry.
// The +2 keeps the idempotent-tail headroom the old bound provided (a caller
// can still observe the post-completion no-op short-circuit).
const PROVISIONING_MAX_ITERATIONS =
  TOTAL_STEPS + MAX_UNIT_ATTEMPTS * 2 * STARTER_ARTICLE_TARGET + 2;
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

// rescue-4 — persist an in_progress step's latest progress output WITHOUT
// finalizing it: status stays 'running' and finished_at is left NULL (the
// step is not done), only output + updated_at advance. The next call's
// upsertStepRow re-bumps attempt_count.
async function recordStepProgress(
  db: D1Database, job_id: string, step_key: StepKey, output: string,
): Promise<void> {
  await db
    .prepare(
      "UPDATE site_creation_job_steps SET output = ?, updated_at = unixepoch() " +
        "WHERE job_id = ? AND step_key = ?",
    )
    .bind(output, job_id, step_key)
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

// rescue-4 — an in_progress step persists progress WITHOUT advancing the
// pointer or finalizing the job: it records the current step on the job row
// and bumps updated_at (the lightweight lease the cron driver reads to avoid
// double-driving the same job). The job stays 'running' so the SAME step runs
// again on the next call (a cron tick or a /provision/next POST). No sites or
// step-row finalize side-effects fire — the runner already wrote the step's
// 'running' upsert (which bumped its attempt_count) before invoking the
// handler. Returns the unchanged-pointer status ('running').
async function persistInProgress(
  db: D1Database, job_id: string, current_step: StepKey, current_index: number,
): Promise<string> {
  await db
    .prepare(
      "UPDATE site_creation_jobs SET current_step = ?, current_step_index = ?, " +
        "status = 'running', last_error = NULL, updated_at = unixepoch() WHERE id = ?",
    )
    .bind(current_step, current_index, job_id)
    .run();
  return "running";
}

// MQAFIX-1: Drive the provisioning runner to completion for a freshly
// created site (or a halted one). Loops `advanceNextStep` until the job
// reaches `completed` / `failed`, runs into an unknown step index, or
// exceeds the safety bound (PROVISIONING_MAX_ITERATIONS). rescue-4: the bound
// now accounts for the two chunked per-article steps, each of which returns
// in_progress (same step, pointer unchanged) up to
// MAX_UNIT_ATTEMPTS * STARTER_ARTICLE_TARGET times before completing (PR #28
// finding #4 — every unit may retry up to MAX_UNIT_ATTEMPTS times) — see
// PROVISIONING_MAX_ITERATIONS above. Errors from the underlying runner are
// swallowed and reported through the returned `final_status='aborted'` — the
// caller (sites POST handler) must NOT fail the user request because background
// provisioning hiccupped; the site row itself is already committed.
//
// NOTE (rescue-4): on the Workers runtime a single waitUntil-driven call to
// this loop will still get evicted at ~30s for a large article count — that is
// EXPECTED and safe. The cron-driven driveInProgressProvisioning re-enters the
// same idempotent loop every minute and resumes from the persisted unit state,
// so the build reaches 'active' across however many ticks it takes. This
// best-effort fast-start is no longer the completion guarantee; the cron is.
export interface ProvisioningRunSummary {
  steps_run: number;
  final_status: string;
  last_step_status: StepHandlerResult["status"] | null;
}

export async function runProvisioningToCompletion(
  env: Env,
  db: D1Database,
  site_id: string,
  max_iterations: number = PROVISIONING_MAX_ITERATIONS,
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

// T39 [BCL-013] — resume a STALLED provisioning job from the operator UI.
// A build can halt two ways: (1) the background ctx.waitUntil driver was
// killed mid-step, leaving the job 'running'/'pending' parked at
// current_step_index < TOTAL_STEPS (advanceNextStep resumes these as-is);
// (2) a step returned 'failed', parking the job 'failed' with last_error set
// and advanceNextStep short-circuiting (so the per-step /provision/next is a
// no-op against it). Resume handles BOTH: a 'failed' job is first reset to
// 'running' (last_error cleared) so the parked step re-attempts, then the
// idempotent advanceNextStep loop (runProvisioningToCompletion) drives the
// build to completion — the final update_launch_readiness step flips the site
// to status='active'. A site with no job is a no-op the caller maps to 404;
// an already-completed job is a no-op that reports completed. Dry-run-safe:
// it reuses the SAME runner the create path uses, so it emits ZERO outbound
// fetch under SITE_PROVISIONING_DRY_RUN.
export interface ResumeResult {
  resumed: boolean;
  reason: "no_job" | "already_completed" | null;
  job_id: string | null;
  site_id: string;
  steps_run: number;
  final_status: string;
  last_step_status: StepHandlerResult["status"] | null;
  site_status: string | null;
}

async function readSiteStatus(db: D1Database, siteId: string): Promise<string | null> {
  const row = await db
    .prepare("SELECT status FROM sites WHERE id = ? LIMIT 1")
    .bind(siteId)
    .first<{ status: string }>();
  return row?.status ?? null;
}

export async function resumeProvisioning(
  env: Env,
  db: D1Database,
  site_id: string,
): Promise<ResumeResult> {
  const job = await findActiveJobForSite(db, site_id);
  if (job === null) {
    return {
      resumed: false,
      reason: "no_job",
      job_id: null,
      site_id,
      steps_run: 0,
      final_status: "no_job",
      last_step_status: null,
      site_status: null,
    };
  }
  if (job.status === "completed") {
    return {
      resumed: false,
      reason: "already_completed",
      job_id: job.id,
      site_id,
      steps_run: 0,
      final_status: "completed",
      last_step_status: null,
      site_status: await readSiteStatus(db, site_id),
    };
  }
  // A parked 'failed' job is reset to 'running' (last_error cleared) so the
  // failed step re-attempts on the next advanceNextStep; 'running'/'pending'
  // jobs resume untouched (their pointer already sits on the un-run step).
  if (job.status === "failed") {
    await db
      .prepare(
        "UPDATE site_creation_jobs SET status = 'running', last_error = NULL, " +
          "updated_at = unixepoch() WHERE id = ?",
      )
      .bind(job.id)
      .run();
  }
  const summary = await runProvisioningToCompletion(env, db, site_id);
  return {
    resumed: true,
    reason: null,
    job_id: job.id,
    site_id,
    steps_run: summary.steps_run,
    final_status: summary.final_status,
    last_step_status: summary.last_step_status,
    site_status: await readSiteStatus(db, site_id),
  };
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

// rescue-4 — the CRON completion guarantee. scheduleBackgroundProvisioning's
// waitUntil is best-effort fast-start: the Workers runtime evicts a long
// waitUntil at ~30s, so a site with many articles (or one whose create-time
// drive was killed) is left parked 'running'. driveInProgressProvisioning is
// the durable driver the scheduled() handler calls every minute: it picks up
// any still-in-progress job and advances it within a bounded wall-clock budget,
// resuming from the persisted per-unit state, so the build reaches 'active'
// across however many ticks it takes — for ANY article count.
//
// Concurrency safety (the lease): jobs are ordered updated_at ASC and filtered
// to those whose updated_at is older than DRIVE_LEASE_STALE_SECONDS. Every
// advanceNextStep bumps the job's updated_at (advanceJobPointer / persistIn-
// Progress), so a job THIS tick is actively driving has a fresh updated_at and
// is NOT re-selected by the next tick — two overlapping ticks never double-
// drive the same job. (No lease_until column: updated_at staleness is the lease
// — see migration 0022's note.) Each job is driven inside its own try/catch so
// one bad job can never abort the rest of the batch, and the whole call is
// non-throwing so a provisioning hiccup can't break the publish cron.
//
// `Date.now()` is used for the wall-clock budget — allowed here because this is
// product Worker runtime code (not a determinism-constrained workflow script).
const DRIVE_BATCH_LIMIT = 5;
const DRIVE_LEASE_STALE_SECONDS = 120;
const DRIVE_BUDGET_MS = 18_000;
// PR #28 finding #2 — OVERALL invocation wall-clock budget. DRIVE_BUDGET_MS is
// PER-JOB, and DRIVE_BATCH_LIMIT is 5, so without an overall cap one cron tick
// could run up to ~5 × DRIVE_BUDGET_MS before yielding. This overall budget is
// checked BETWEEN jobs (never mid-job — a job in flight always gets its full
// per-job budget) so the whole invocation stops picking up further jobs once it
// is hit; the next tick (every minute) resumes the remaining jobs from their
// persisted per-unit state. Kept above DRIVE_BUDGET_MS so a single job can
// always use its full per-job budget within one tick.
const DRIVE_OVERALL_BUDGET_MS = 25_000;

interface DriveJobRow {
  id: string;
  site_id: string;
}

export interface DriveInProgressSummary {
  jobs_considered: number;
  jobs_driven: number;
  steps_run: number;
  // PR #28 finding #2 — true when the OVERALL invocation budget tripped and the
  // batch stopped picking up further jobs (the next tick resumes them).
  budget_exhausted: boolean;
}

export async function driveInProgressProvisioning(
  env: Env,
  ctx?: WaitUntilCtx,
): Promise<DriveInProgressSummary> {
  void ctx; // accepted for symmetry / future fan-out; the loop runs inline.
  const summary: DriveInProgressSummary = {
    jobs_considered: 0,
    jobs_driven: 0,
    steps_run: 0,
    budget_exhausted: false,
  };
  const overallStart = Date.now();
  const nowSeconds = Math.floor(Date.now() / 1000);
  const staleBefore = nowSeconds - DRIVE_LEASE_STALE_SECONDS;
  // Oldest-touched non-terminal jobs first; lease filter drops any a
  // concurrent tick is actively driving (their updated_at is fresh).
  const picked = await db_selectDrivableJobs(env.DB, staleBefore);
  summary.jobs_considered = picked.length;
  for (const row of picked) {
    // PR #28 finding #2 — OVERALL budget gate, checked BETWEEN jobs: once the
    // invocation has spent its wall-clock budget, stop picking up further jobs.
    // A job already in flight is never interrupted (it keeps its full per-job
    // budget); the remaining jobs resume on the next minute's tick from their
    // persisted state. (No-op when picked is empty.)
    if (Date.now() - overallStart >= DRIVE_OVERALL_BUDGET_MS) {
      summary.budget_exhausted = true;
      break;
    }
    summary.jobs_driven += 1;
    const start = Date.now();
    try {
      // Loop the idempotent runner until the budget is spent or the job
      // settles. Each advanceNextStep bumps the job's updated_at (the lease).
      for (let i = 0; i < PROVISIONING_MAX_ITERATIONS; i++) {
        if (Date.now() - start >= DRIVE_BUDGET_MS) break;
        const job = await findActiveJobForSite(env.DB, row.site_id);
        if (job === null) break;
        if (job.status === "completed" || job.status === "failed") break;
        const result = await advanceNextStep(env, env.DB, job);
        summary.steps_run += 1;
        if (result.completed || result.last_step_status === "failed") break;
      }
    } catch {
      // A throwing step is already persisted 'failed' by advanceNextStep's
      // own try/catch; swallow here so one bad job can't abort the batch or
      // the surrounding publish cron.
    }
  }
  return summary;
}

async function db_selectDrivableJobs(
  db: D1Database,
  staleBefore: number,
): Promise<DriveJobRow[]> {
  const res = await db
    .prepare(
      "SELECT id, site_id FROM site_creation_jobs " +
        "WHERE status IN ('running','pending') AND updated_at <= ? " +
        "ORDER BY updated_at ASC LIMIT ?",
    )
    .bind(staleBefore, DRIVE_BATCH_LIMIT)
    .all<DriveJobRow>();
  return res && Array.isArray(res.results) ? res.results : [];
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
  // rescue-4 — in_progress: the step did ONE bounded unit of work and has
  // more to do. Do NOT finalize the step row to a terminal status and do NOT
  // advance current_step_index — only persist the step's latest progress
  // output and re-park the job 'running' (bumping updated_at, the lease) so
  // the SAME step runs again on the next call. The 'running' upsert at the
  // top of this function already bumped the step row's attempt_count, so the
  // per-step retry/attempt bookkeeping is recorded.
  if (result.status === "in_progress") {
    await recordStepProgress(db, job.id, step_key, result.output);
    const inProgressStatus = await persistInProgress(db, job.id, step_key, index);
    return {
      job_id: job.id,
      site_id: job.site_id,
      current_step: step_key,
      current_step_index: index,
      total_steps: TOTAL_STEPS,
      status: inProgressStatus,
      last_step_status: result.status,
      completed: false,
    };
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
