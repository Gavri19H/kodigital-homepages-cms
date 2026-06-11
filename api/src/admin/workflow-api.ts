// Admin workflow API — the full legacy workflow + version-history surface
// (T26 [B5]):
//   POST /api/admin/articles/:id/{publish|unpublish|schedule|cancel-schedule|archive}
//   GET  /api/admin/articles/:id/versions
//   GET  /api/admin/articles/:id/versions/:versionId
//   POST /api/admin/articles/:id/versions/:versionId/restore
// Wraps the src/workflow module with HTTP error-shape mapping so the admin
// UI sees a JSON 4xx/5xx instead of an unhandled exception.

import { Hono } from "hono";
import type { Context } from "hono";
import type { Env } from "../env";
import {
  archive,
  cancelSchedule,
  getVersion,
  listVersions,
  publish,
  restoreVersion,
  schedule,
  unpublish,
} from "../workflow";

type WfContext = Context<{ Bindings: Env }>;

const workflowApi = new Hono<{ Bindings: Env }>();

function parseIdParam(c: WfContext, name: string): number | null {
  const id = parseInt(c.req.param(name) ?? "", 10);
  return Number.isFinite(id) && id > 0 ? id : null;
}

// Workflow errors carry their classification in the message (the module
// throws plain Errors): "not found" -> 404, "illegal transition" -> 409,
// "invalid" -> 400, anything else -> 500.
function mapWorkflowError(c: WfContext, err: unknown, fallback: string) {
  const msg = err instanceof Error ? err.message : fallback;
  if (/not found/i.test(msg)) return c.json({ error: msg }, 404);
  if (/illegal transition/i.test(msg)) return c.json({ error: msg }, 409);
  if (/invalid/i.test(msg)) return c.json({ error: msg }, 400);
  return c.json({ error: msg }, 500);
}

function articleStatusJson(c: WfContext, row: {
  id: number;
  status: string;
  published_at: number | null;
  scheduled_at: number | null;
}) {
  return c.json({
    ok: true,
    id: row.id,
    status: row.status,
    published_at: row.published_at,
    scheduled_at: row.scheduled_at,
  });
}

workflowApi.post("/api/admin/articles/:id/publish", async (c) => {
  const id = parseIdParam(c, "id");
  if (id === null) return c.json({ error: "Invalid article id" }, 400);
  try {
    return articleStatusJson(c, await publish(c.env, id));
  } catch (err) {
    return mapWorkflowError(c, err, "publish failed");
  }
});

workflowApi.post("/api/admin/articles/:id/unpublish", async (c) => {
  const id = parseIdParam(c, "id");
  if (id === null) return c.json({ error: "Invalid article id" }, 400);
  try {
    return articleStatusJson(c, await unpublish(c.env, id));
  } catch (err) {
    return mapWorkflowError(c, err, "unpublish failed");
  }
});

workflowApi.post("/api/admin/articles/:id/schedule", async (c) => {
  const id = parseIdParam(c, "id");
  if (id === null) return c.json({ error: "Invalid article id" }, 400);
  let body: { scheduled_at?: unknown };
  try {
    body = await c.req.json<{ scheduled_at?: unknown }>();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  const scheduledAt =
    typeof body.scheduled_at === "number"
      ? body.scheduled_at
      : typeof body.scheduled_at === "string"
        ? parseInt(body.scheduled_at, 10)
        : NaN;
  if (!Number.isFinite(scheduledAt) || scheduledAt <= 0) {
    return c.json({ error: "scheduled_at (epoch seconds) is required" }, 400);
  }
  try {
    return articleStatusJson(c, await schedule(c.env, id, scheduledAt));
  } catch (err) {
    return mapWorkflowError(c, err, "schedule failed");
  }
});

workflowApi.post("/api/admin/articles/:id/cancel-schedule", async (c) => {
  const id = parseIdParam(c, "id");
  if (id === null) return c.json({ error: "Invalid article id" }, 400);
  try {
    return articleStatusJson(c, await cancelSchedule(c.env, id));
  } catch (err) {
    return mapWorkflowError(c, err, "cancel-schedule failed");
  }
});

workflowApi.post("/api/admin/articles/:id/archive", async (c) => {
  const id = parseIdParam(c, "id");
  if (id === null) return c.json({ error: "Invalid article id" }, 400);
  try {
    return articleStatusJson(c, await archive(c.env, id));
  } catch (err) {
    return mapWorkflowError(c, err, "archive failed");
  }
});

// Version history (T26.AC2). The list endpoint 404s for unknown articles
// (distinguishing "no versions yet" from "no such article").
workflowApi.get("/api/admin/articles/:id/versions", async (c) => {
  const id = parseIdParam(c, "id");
  if (id === null) return c.json({ error: "Invalid article id" }, 400);
  try {
    const article = await c.env.DB
      .prepare("SELECT id FROM articles WHERE id = ? LIMIT 1")
      .bind(id)
      .first<{ id: number }>();
    if (!article) return c.json({ error: "Article not found" }, 404);
    return c.json({ versions: await listVersions(c.env, id) });
  } catch (err) {
    return mapWorkflowError(c, err, "version list failed");
  }
});

workflowApi.get("/api/admin/articles/:id/versions/:versionId", async (c) => {
  const id = parseIdParam(c, "id");
  const versionId = parseIdParam(c, "versionId");
  if (id === null || versionId === null) {
    return c.json({ error: "Invalid id" }, 400);
  }
  try {
    const version = await getVersion(c.env, id, versionId);
    if (!version) return c.json({ error: "Version not found" }, 404);
    return c.json({ version });
  } catch (err) {
    return mapWorkflowError(c, err, "version fetch failed");
  }
});

workflowApi.post(
  "/api/admin/articles/:id/versions/:versionId/restore",
  async (c) => {
    const id = parseIdParam(c, "id");
    const versionId = parseIdParam(c, "versionId");
    if (id === null || versionId === null) {
      return c.json({ error: "Invalid id" }, 400);
    }
    try {
      const result = await restoreVersion(c.env, id, versionId);
      return c.json({ ok: true, ...result });
    } catch (err) {
      return mapWorkflowError(c, err, "restore failed");
    }
  },
);

export default workflowApi;
