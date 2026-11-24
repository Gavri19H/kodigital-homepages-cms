import type { Env } from "../env";
import { mergeTags, nfTag, snapTag } from "./tags";
import type { PublicChange } from "./types";

const TAGS_PER_CALL = 100;
const CRON_CALLS = 2;

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

async function recordBookmark(db: D1Database, siteId: string | null): Promise<void> {
  try {
    if (siteId === null || typeof db.withSession !== "function") return;
    const session = db.withSession("first-primary");
    await session.prepare("SELECT id FROM sites WHERE id = ?").bind(siteId).first();
    const bookmark = session.getBookmark();
    if (bookmark === null) return;
    // D1 bookmarks sort in commit order. Concurrent publishers can finish out of order.
    await session.prepare(`UPDATE sites SET write_bookmark = ? WHERE id = ?
                           AND (write_bookmark IS NULL OR write_bookmark < ?)`)
      .bind(bookmark, siteId, bookmark).run();
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
    await recordBookmark(env.DB, siteId);
    const required = siteId === null ? [] : [snapTag(siteId), nfTag(siteId)];
    const tags = allTags([...change.tags, ...required]);
    const immediate = tags.length > TAGS_PER_CALL ? mergeTags(required, tags) : tags;
    const ok = await purgeTags(ctx, immediate);
    const purged = new Set(ok ? immediate : []);
    if (!ok || purged.size < tags.length) {
      await enqueue(env.DB, siteId, "purge_tags", { tags: tags.filter(tag => !purged.has(tag)), reason, tries: 0 });
    }
    // Keep millisecond precision in the Unix timestamp for the 30-second boundary.
    await enqueue(env.DB, siteId, "purge_tags_second", { tags, due_after: (Date.now() + 30_000) / 1000 });
  } catch (error) {
    logError("public_change_error", error);
  }
}

interface LogRow {
  id: number;
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

    let status = "pending";
    const next = { ...row.data };
    if (failures.length || row.tags === null) {
      if (deferred.length) {
        // Keep unattempted tags at their original retry count, even if this is the last retry.
        // The copy and update share a transaction and the same observed-payload guard.
        writes.push(db.prepare(`INSERT INTO cache_purge_log (site_id, action, status, dry_run, payload, created_at)
                                SELECT site_id, action, 'pending', 0, ?, created_at FROM cache_purge_log
                                WHERE id = ? AND status = 'pending' AND payload IS ?`)
          .bind(JSON.stringify({ ...row.data, tags: deferred }), row.id, row.payload));
      }
      const previous = row.data.tries;
      const tries = (typeof previous === "number" && Number.isSafeInteger(previous) && previous > 0 ? previous : 0) + 1;
      next.tries = tries;
      if (row.tags !== null) next.tags = failures;
      if (tries >= 3) {
        status = "failed";
        alarms.set(writes.length, { t: "purge_failed", tags: failures, tries });
      }
    } else {
      next.tags = deferred;
    }
    writes.push(db.prepare(`UPDATE cache_purge_log SET status = ?, payload = ?
                            WHERE id = ? AND status = 'pending' AND payload IS ?`)
      .bind(status, JSON.stringify(next), row.id, row.payload));
    if (writes.length >= 80) await flush();
  }

  if (completed.length) {
    // An overlapping attempt can narrow a row or exhaust its retries. Success covers either outcome.
    writes.push(db.prepare(`UPDATE cache_purge_log SET status = 'completed'
                            WHERE status IN ('pending', 'failed') AND id IN (SELECT value FROM json_each(?))`)
      .bind(JSON.stringify(completed)));
  }
  await flush();
}

export async function runEdgePurgeCron(env: Env, ctx: ExecutionContext | undefined): Promise<void> {
  try {
    const pending = await env.DB.prepare(`SELECT id, payload FROM cache_purge_log
      WHERE status = 'pending' AND action IN ('purge_tags', 'purge_tags_second')
        AND COALESCE(CASE WHEN json_valid(payload) THEN CAST(json_extract(payload, '$.due_after') AS REAL) END, 0) <= ?
      ORDER BY created_at, id LIMIT 500`).bind(Date.now() / 1000).all<LogRow>();
    const rows = pending.results.map(readRow);
    const tags = [...new Set(rows.flatMap(row => row.tags ?? []))].slice(0, CRON_CALLS * TAGS_PER_CALL);
    const failed = new Set<string>();
    for (let i = 0; i < tags.length; i += TAGS_PER_CALL) {
      const chunk = tags.slice(i, i + TAGS_PER_CALL);
      if (!await purgeTags(ctx, chunk)) {
        for (const tag of chunk) failed.add(tag);
      }
    }
    await settleRows(env.DB, rows, new Set(tags), failed);
  } catch (error) {
    logError("purge_cron_error", error);
  }
}
