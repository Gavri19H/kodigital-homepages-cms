// T42 [BCL-080] — Scheduled-publishing engine.
//
// `processScheduledArticles` is the body the cron handler (src/index.ts
// `scheduled`, wired to wrangler.toml [triggers] crons) invokes on every
// tick. It finds every article whose scheduled time has arrived
// (status = 'scheduled' AND scheduled_at <= now) and runs each through the
// canonical publish() path — the SAME state-machine-validated transition the
// admin "Publish" button uses (scheduled -> published is a legal pair in
// VALID_TRANSITIONS), so a scheduled article goes live exactly as a manual
// publish would: content_json rendered to HTML, a version snapshot taken, the
// owning site's content_version bumped, and the per-site public cache wiped.
//
// Resilience: each article is published inside its own try/catch so a single
// bad row (e.g. one already moved out of 'scheduled' between the SELECT and
// the publish) can NEVER abort the rest of the batch — the failure is
// recorded in `failed[]` and the loop continues. This is purely D1 + KV work;
// it makes NO outbound HTTP (no api.cloudflare.com call), so it is safe under
// the provisioning dry-run contract.
//
// Hard rule (mirrors db/index.ts): every D1 call uses
// `db.prepare(<static SQL>).bind(...)` — NO template-literal SQL.

import type { Env } from "../env";
import { publish } from "./publish";

export interface ProcessScheduledResult {
  // Number of due articles the SELECT matched.
  due: number;
  // IDs that were successfully flipped to published.
  published: number[];
  // Articles whose publish() threw — recorded, never swallowed.
  failed: Array<{ id: number; error: string }>;
}

export async function processScheduledArticles(
  env: Env,
  now: number = nowSeconds(),
): Promise<ProcessScheduledResult> {
  // Find every article whose scheduled time has arrived. Oldest-first so a
  // backlog (e.g. after the worker was idle) publishes in schedule order.
  const dueRows = await env.DB
    .prepare(
      "SELECT id FROM articles WHERE status = 'scheduled' AND scheduled_at IS NOT NULL AND scheduled_at <= ? ORDER BY scheduled_at ASC",
    )
    .bind(now)
    .all<{ id: number }>();

  const due = dueRows.results ?? [];
  const result: ProcessScheduledResult = {
    due: due.length,
    published: [],
    failed: [],
  };

  for (const row of due) {
    try {
      await publish(env, row.id, {
        changeSummary: "Auto-published by scheduled-publishing cron",
      });
      result.published.push(row.id);
    } catch (err) {
      result.failed.push({
        id: row.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}
