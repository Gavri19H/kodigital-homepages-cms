// Admin workflow API — POST endpoints that drive the publish state machine.
// Wraps `publish()` from src/workflow with HTTP error-shape mapping so the
// admin UI sees a JSON 4xx/5xx instead of an unhandled exception.

import { Hono } from "hono";
import type { Env } from "../env";
import { publish } from "../workflow";

const workflowApi = new Hono<{ Bindings: Env }>();

workflowApi.post("/api/admin/articles/:id/publish", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  if (!Number.isFinite(id) || id <= 0) {
    return c.json({ error: "Invalid article id" }, 400);
  }
  try {
    const row = await publish(c.env, id);
    return c.json({
      ok: true,
      id: row.id,
      status: row.status,
      published_at: row.published_at,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "publish failed";
    if (/not found/i.test(msg)) return c.json({ error: msg }, 404);
    if (/illegal transition/i.test(msg)) return c.json({ error: msg }, 409);
    return c.json({ error: msg }, 500);
  }
});

export default workflowApi;
