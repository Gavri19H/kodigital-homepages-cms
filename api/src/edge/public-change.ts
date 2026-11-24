import type { Env } from "../env";
import { mergeTags, nfTag, snapTag } from "./tags";
import type { PublicChange } from "./types";

const TAGS_PER_CALL = 100;
const CRON_CALLS = 2;
const SITES_PER_STATEMENT = 80;
const HOURLY_RETRY_SECONDS = 60 * 60;
const COMPLETED_RETENTION_SECONDS = 7 * 24 * 60 * 60;

interface PublicPagePurger {
  purgeTags(tags: string[]): Promise<{ success: boolean; errors: unknown[] }>;
}

function logError(t: string, error: unknown, details: Record<string, unknown> = {}): void {
  let line: string;
  try {
    line = JSON.stringify({ t, ...details, error: error instanceof Error ? error.message : error });
  } catch {
    line = JSON.stringify({ t, error: "Unserializable error" });
  }
  console.error(line);
}

// mergeTags caps its result at one RPC. The durable log must retain every tag.
function allTags(tags: string[]): string[] {
  if (tags.length <= TAGS_PER_CALL) return mergeTags(tags);
  const unique = new Set<string>();
  for (let i = 0; i < tags.length; i += TAGS_PER_CALL) {
    for (const tag of mergeTags(tags.slice(i, i + TAGS_PER_CALL))) unique.add(tag);
  }
  return [...unique];
}

async function purgeTags(ctx: ExecutionContext | undefined, tags: string[]): Promise<boolean> {
  try {
    const page = (ctx?.exports as { PublicPage?: PublicPagePurger } | undefined)?.PublicPage;
    if (typeof page?.purgeTags !== "function") throw new Error("PublicPage.purgeTags unavailable");
    const result = await page.purgeTags(tags);
    if (result?.success === true) return true;
    logError("purge_rpc_error", result?.errors, { tags });
  } catch (error) {
    logError("purge_rpc_error", error, { tags });
  }
  return false;
}

async function advanceContentVersion(db: D1Database, siteId: string | null, tags: string[]): Promise<void> {
  try {
    const ids = siteId === null
      ? tags.filter(tag => tag.startsWith("site:") && tag.length > 5).map(tag => tag.slice(5))
      : [siteId];
    if (!ids.length) return;

    const session = db.withSession?.("first-primary");
    const primary = session ?? db;
    // Site tags are normalized to lowercase. An explicit site id is an exact database key.
    const target = siteId === null ? "id COLLATE NOCASE IN (SELECT value FROM json_each(?))" : "id = ?";
    async function updateSites(sql: string, ...values: string[]): Promise<void> {
      const updates: D1PreparedStatement[] = [];
      for (let i = 0; i < ids.length; i += SITES_PER_STATEMENT) {
        const binding = siteId ?? JSON.stringify(ids.slice(i, i + SITES_PER_STATEMENT));
        updates.push(primary.prepare(sql + target).bind(...values, binding));
      }
      if (updates.length === 1) await updates[0]!.run();
      else await primary.batch(updates);
    }

    await updateSites("UPDATE sites SET content_version = content_version + 1 WHERE ");
    // Capture the committed bump so a read at this bookmark sees the new ETag.
    const bookmark = session?.getBookmark();
    if (bookmark != null) {
      // Concurrent publishers can finish out of order. Keep the later bookmark.
      await updateSites("UPDATE sites SET write_bookmark = ? WHERE (write_bookmark IS NULL OR write_bookmark < ?) AND ",
        bookmark, bookmark);
    }
  } catch (error) {
    logError("purge_bookmark_error", error, { siteId });
  }
}

async function enqueue(
  db: D1Database,
  siteId: string | null,
  action: "purge_tags" | "purge_tags_second",
  payload: { tags: string[]; reason?: string; tries?: number; due_after?: number },
): Promise<void> {
  try {
    // A deleted site still has cached tags. Its log row uses the nullable FK.
    await db.prepare(`INSERT INTO cache_purge_log (site_id, action, status, dry_run, payload)
                      VALUES ((SELECT id FROM sites WHERE id = ?), ?, 'pending', 0, ?)`)
      .bind(siteId, action, JSON.stringify(payload)).run();
  } catch (error) {
    logError("purge_enqueue_error", error, { siteId, action, tags: payload.tags });
  }
}

export async function onPublicChange(
  env: Env, ctx: ExecutionContext | undefined, change: PublicChange,
): Promise<void> {
  try {
    const { siteId, reason } = change;
    const required = siteId === null ? [] : [snapTag(siteId), nfTag(siteId)];
    const tags = allTags([...change.tags, ...required]);
    await advanceContentVersion(env.DB, siteId, tags);
    const immediate = tags.length > TAGS_PER_CALL ? mergeTags(required, tags) : tags;
    const ok = await purgeTags(ctx, immediate);
    const purged = new Set(ok ? immediate : []);
    if (!ok || purged.size < tags.length) {
      await enqueue(env.DB, siteId, "purge_tags", { tags: tags.filter(tag => !purged.has(tag)), reason, tries: 0 });
    }
    // Keep millisecond precision in the Unix timestamp for the 30-second boundary.
    await enqueue(env.DB, siteId, "purge_tags_second", { tags, reason, due_after: (Date.now() + 30_000) / 1000 });
  } catch (error) {
    logError("public_change_error", error);
  }
}

interface LogRow {
  id: number;
  status: "pending" | "failed";
  payload: string | null;
}

function readRow(row: LogRow) {
  let data: Record<string, unknown> = { invalid_payload: row.payload };
  let tags: string[] | null = null;
  try {
    const decoded: unknown = JSON.parse(row.payload ?? "");
    if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) throw new Error("Expected a purge payload");
    data = decoded as Record<string, unknown>;
    if (!Array.isArray(data.tags) || !data.tags.every(tag => typeof tag === "string")) {
      throw new Error("Expected an array of purge tags");
    }
    tags = allTags(data.tags);
  } catch (error) {
    logError("purge_payload_error", error, { id: row.id });
  }
  return { ...row, data, tags };
}

function cronTags(rows: ReturnType<typeof readRow>[]): string[] {
  return [...new Set(rows.flatMap(row => row.tags ?? []))].slice(0, CRON_CALLS * TAGS_PER_CALL);
}

async function claimHourlyRetries(db: D1Database, rows: ReturnType<typeof readRow>[], now: number) {
  const failed = rows.filter(row => row.status === "failed");
  if (!failed.length) return rows;
  const budget = new Set(cronTags(rows));
  const due = failed.filter(row => !row.tags?.length || row.tags.some(tag => budget.has(tag)));
  const claimed = new Set<number>();
  // Reserve the hour before the RPC, including for legacy failures without a deadline.
  // If two ticks read the same payload, only the one that moves its deadline retries it.
  for (let i = 0; i < due.length; i += 80) {
    const batch = due.slice(i, i + 80);
    const writes = batch.map(row => {
      const payload = JSON.stringify({ ...row.data, next_try_at: now + HOURLY_RETRY_SECONDS });
      const claim = db.prepare(`UPDATE cache_purge_log SET payload = ?
                                WHERE id = ? AND status = 'failed' AND payload IS ?`).bind(payload, row.id, row.payload);
      // Settlement matches the reservation. The original data still describes any deferred tags.
      row.payload = payload;
      return claim;
    });
    const results = await db.batch(writes);
    batch.forEach((row, index) => {
      if (results[index]?.meta.changes) claimed.add(row.id);
    });
  }
  return rows.filter(row => row.status === "pending" || claimed.has(row.id));
}

async function settleRows(
  db: D1Database, rows: ReturnType<typeof readRow>[], attempted: Set<string>, failed: Set<string>,
): Promise<void> {
  const completed: number[] = [];
  const writes: D1PreparedStatement[] = [];
  const alarms = new Map<number, { t: "purge_failed"; tags: string[]; tries: number }>();

  async function flush(): Promise<void> {
    if (!writes.length) return;
    const results = await db.batch(writes);
    for (const [index, alarm] of alarms) {
      if (results[index]?.meta.changes) console.error(JSON.stringify(alarm));
    }
    writes.length = 0;
    alarms.clear();
  }

  for (const row of rows) {
    const failures = row.tags?.filter(tag => failed.has(tag)) ?? [];
    const deferred = row.tags?.filter(tag => !attempted.has(tag)) ?? [];
    if (row.tags !== null && !failures.length && !deferred.length) {
      completed.push(row.id);
      continue;
    }
    if (row.tags !== null && deferred.length === row.tags.length) continue;

    let status = row.status;
    const next = { ...row.data };
    if (failures.length || row.tags === null) {
      if (deferred.length) {
        // Unattempted tags keep their original retry count and eligibility time.
        // The copy and update share a transaction and the same observed-payload guard.
        writes.push(db.prepare(`INSERT INTO cache_purge_log (site_id, action, status, dry_run, payload, created_at)
                                SELECT site_id, action, status, 0, ?, created_at FROM cache_purge_log
                                WHERE id = ? AND status = ? AND payload IS ?`)
          .bind(JSON.stringify({ ...row.data, tags: deferred, retry_of: row.data.retry_of ?? row.id }), row.id, row.status, row.payload));
      }
      const previous = row.data.tries;
      const minimum = row.status === "failed" ? 3 : 0;
      const tries = (typeof previous === "number" && Number.isSafeInteger(previous) && previous >= minimum ? previous : minimum) + 1;
      next.tries = tries;
      if (row.tags !== null) next.tags = failures;
      if (tries >= 3) {
        status = "failed";
        next.next_try_at = Date.now() / 1000 + HOURLY_RETRY_SECONDS;
        alarms.set(writes.length, { t: "purge_failed", tags: failures, tries });
      }
    } else {
      next.tags = deferred;
    }
    // The fingerprint reads the writer's original scope even after a partial drain.
    // A split-off retry belongs to that receipt's window, not the minute it was copied.
    if (row.tags && !row.data.retry_of && Array.isArray(next.tags) && next.tags.length < row.tags.length) {
      next.receipt_tags ??= row.tags;
    }
    writes.push(db.prepare(`UPDATE cache_purge_log SET status = ?, payload = ?
                            WHERE id = ? AND status = ? AND payload IS ?`)
      .bind(status, JSON.stringify(next), row.id, row.status, row.payload));
    if (writes.length >= 80) await flush();
  }

  if (completed.length) {
    // A confirmed purge covers the row even if an overlapping attempt just recorded a failure.
    writes.push(db.prepare(`UPDATE cache_purge_log SET status = 'completed'
                            WHERE status IN ('pending', 'failed') AND id IN (SELECT value FROM json_each(?))`)
      .bind(JSON.stringify(completed)));
  }
  await flush();
}

export async function runEdgePurgeCron(env: Env, ctx: ExecutionContext | undefined): Promise<void> {
  try {
    const now = Date.now() / 1000;
    // Each status/action pair is already in age order in the index. SQLite can
    // merge these streams up to the limit without sorting the entire backlog.
    const pending = await env.DB.prepare(`WITH due AS NOT MATERIALIZED (
        SELECT id, payload, status, action, created_at FROM cache_purge_log
        WHERE CASE WHEN json_valid(payload) THEN MAX(
          COALESCE(CAST(json_extract(payload, '$.due_after') AS REAL), 0),
          COALESCE(CAST(json_extract(payload, '$.next_try_at') AS REAL), 0)
        ) ELSE 0 END <= ?
      )
      SELECT * FROM due WHERE status = 'pending' AND action = 'purge_tags'
      UNION ALL SELECT * FROM due WHERE status = 'pending' AND action = 'purge_tags_second'
      UNION ALL SELECT * FROM due WHERE status = 'failed' AND action = 'purge_tags'
      UNION ALL SELECT * FROM due WHERE status = 'failed' AND action = 'purge_tags_second'
      ORDER BY created_at, id LIMIT 500`).bind(now).all<LogRow>();
    const rows = await claimHourlyRetries(env.DB, pending.results.map(readRow), now);
    const tags = cronTags(rows);
    const failed = new Set<string>();
    for (let i = 0; i < tags.length; i += TAGS_PER_CALL) {
      const chunk = tags.slice(i, i + TAGS_PER_CALL);
      if (!await purgeTags(ctx, chunk)) {
        for (const tag of chunk) failed.add(tag);
      }
    }
    await settleRows(env.DB, rows, new Set(tags), failed);
    await env.DB.prepare(`DELETE FROM cache_purge_log WHERE id IN (
        SELECT id FROM cache_purge_log WHERE status = 'completed'
          AND action IN ('purge_tags', 'purge_tags_second', 'edge:tick:v1') AND created_at < ? LIMIT 500
      )`).bind(now - COMPLETED_RETENTION_SECONDS).run();
  } catch (error) {
    logError("purge_cron_error", error);
  }
}
