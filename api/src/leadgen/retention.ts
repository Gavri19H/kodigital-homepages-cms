// LeadGen §30.3 retention prune — the bounded cron task.
//
// Contract 09 §30.3: "redacted leadgen_provider_request_log rows pruned after
// 7 days; encrypted debug_ref blobs after 72 h; leadgen_session_clicked_offers
// after 24 h. A bounded cron performs the prune." The KV debug blobs delete
// THEMSELVES (written with expirationTtl — payload-builder-handlers.ts), so
// this task owns the two D1 tables.
//
// Each table prunes in bounded batches — rowid-subquery DELETEs of at most
// `batchSize` rows, at most `maxIterations` loops per table per run — so one
// cron invocation can never hold D1 on an unbounded delete. The two tables
// are isolated from each other: either one failing is logged and skipped,
// never thrown (fail-open, matching the index.ts `scheduled` contract where
// every task additionally runs in its own try/catch).

import type { Env } from "../env";

export const PROVIDER_LOG_RETENTION_SECONDS = 7 * 24 * 3600; // §30.3: 7 days
export const CLICKED_OFFERS_RETENTION_SECONDS = 24 * 3600; // §30.3: 24 h

const DEFAULT_BATCH_SIZE = 500;
const DEFAULT_MAX_ITERATIONS = 10;

export interface LeadgenRetentionResult {
  provider_request_log_deleted: number;
  session_clicked_offers_deleted: number;
}

// One bounded per-table prune loop. `table` / `tsColumn` are fixed literals
// supplied by pruneLeadgenRetention below — user input never reaches the SQL
// text; the cutoff travels through .bind(). The rowid-subquery form works on
// every SQLite build (DELETE … LIMIT needs a compile-time flag D1 does not
// guarantee).
async function pruneTable(
  db: D1Database,
  table: "leadgen_provider_request_log" | "leadgen_session_clicked_offers",
  tsColumn: "created_at" | "clicked_at",
  cutoff: number,
  batchSize: number,
  maxIterations: number,
): Promise<number> {
  let deleted = 0;
  for (let i = 0; i < maxIterations; i++) {
    const result = await db
      .prepare(
        `DELETE FROM ${table} WHERE rowid IN (SELECT rowid FROM ${table} WHERE ${tsColumn} < ? LIMIT ?)`,
      )
      .bind(cutoff, batchSize)
      .run();
    // A harness without meta.changes reads 0 → the loop stops after one
    // bounded pass (fail-open: under-pruning, never an unbounded loop).
    const changes = Number(result.meta?.changes ?? 0);
    deleted += changes;
    if (changes < batchSize) break;
  }
  return deleted;
}

// The §30.3 prune pass. `now` is injectable for deterministic tests; the
// batch bounds are injectable so tests can prove the bounds without seeding
// thousands of rows. NEVER throws — errors are logged per table and the
// other table still prunes.
export async function pruneLeadgenRetention(
  env: Env,
  now: Date = new Date(),
  opts?: { batchSize?: number; maxIterations?: number },
): Promise<LeadgenRetentionResult> {
  const batchSize = opts?.batchSize ?? DEFAULT_BATCH_SIZE;
  const maxIterations = opts?.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const nowEpoch = Math.floor(now.getTime() / 1000);
  const result: LeadgenRetentionResult = {
    provider_request_log_deleted: 0,
    session_clicked_offers_deleted: 0,
  };
  try {
    result.provider_request_log_deleted = await pruneTable(
      env.DB,
      "leadgen_provider_request_log",
      "created_at",
      nowEpoch - PROVIDER_LOG_RETENTION_SECONDS,
      batchSize,
      maxIterations,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[lg-retention] provider_request_log prune failed: ${msg.slice(0, 200)}`);
  }
  try {
    result.session_clicked_offers_deleted = await pruneTable(
      env.DB,
      "leadgen_session_clicked_offers",
      "clicked_at",
      nowEpoch - CLICKED_OFFERS_RETENTION_SECONDS,
      batchSize,
      maxIterations,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[lg-retention] session_clicked_offers prune failed: ${msg.slice(0, 200)}`);
  }
  return result;
}
