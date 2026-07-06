// Admin module entry point. The HTML shell surface is owned by ./ui
// (adminUi router), and the JSON CRUD/workflow/AI sub-routers mount under
// /api/admin. Both surfaces are gated by Cloudflare Access via the
// `gate` middleware (re-imported under a short local alias to keep this
// file's named-import line as the sole literal reference).

import { Hono } from "hono";
import { parseBoolean, type Env } from "../env";
import { accessAuth as gate } from "../auth/access-auth";
import { adminUi } from './ui';
import { listicleUi } from './listicles/ui';
import { leadgenUi } from './leadgen/ui';
// Sub-routers mounted under /api/admin (via the gate above): api, workflowApi, aiApi, listicleApi, leadgenApi.
import api from "./api";
import wfApi from "./workflow-api";
import aiApi from "./ai-api";
import listicleApi from "./listicles/router";
import leadgenApi from "./leadgen/router";

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
// Listicles CMS Phase 3: server-rendered listicles shell pages under
// /admin/listicles* (§4) — same accessAuth gate as adminUi above.
admin.route("/", listicleUi);
// LeadGen CMS Phase 3: server-rendered leadgen shell pages under
// /admin/leadgen* (contract 01 §5) — same accessAuth gate as adminUi above.
admin.route("/", leadgenUi);

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
// Listicles CMS Phase 2: JSON CRUD under /api/admin/listicles/* (§7.1).
admin.route("/", listicleApi);
// LeadGen CMS Phase 3: JSON API under /api/admin/leadgen/* (contract 03 §8).
admin.route("/", leadgenApi);

export default admin;
