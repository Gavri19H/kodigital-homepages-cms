// Admin module entry point. The HTML shell surface is owned by ./ui
// (adminUi router), and the JSON CRUD/workflow/AI sub-routers mount under
// /api/admin. Both surfaces are gated by Cloudflare Access via the
// `gate` middleware (re-imported under a short local alias to keep this
// file's named-import line as the sole literal reference).

import { Hono } from "hono";
import { parseBoolean, type Env } from "../env";
import { accessAuth as gate } from "../auth/access-auth";
import { adminUi } from './ui';
import api from "./api";
// workflowApi sub-router (POST /api/admin/articles/:id/publish, etc).
import wfApi from "./workflow-api";
import aiApi from "./ai-api";

const admin = new Hono<{ Bindings: Env }>();

// CF Access gate. The bare `/admin` and the wildcards must be registered
// separately — `/admin/*` does not match `/admin` itself in Hono.
admin.use("/admin", gate);
admin.use("/admin/*", gate);
admin.use("/api/admin/*", gate);

// Server-rendered admin HTML shell (13 GETs). The Phase 1 placeholder
// shell that previously lived here is gone — all admin GETs now flow
// through adminLayout via ./ui.
admin.route("/", adminUi);

// Admin auth-status endpoint. Reports whether the dev-bypass is in
// effect for this request so the UI can flag it visually.
admin.get("/api/admin/auth/status", (c) => {
  const devBypass =
    parseBoolean(c.env.DEV_BYPASS_AUTH) && c.env.APP_ENV !== "production";
  return c.json({ authenticated: true, dev_bypass: devBypass });
});

// JSON sub-routers (CRUD, workflow, AI placeholders) — all gated by the
// `/api/admin/*` middleware registered above.
admin.route("/", api);
admin.route("/", wfApi);
admin.route("/", aiApi);

export default admin;
