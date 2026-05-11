// Admin module entry point — UI shell + JSON CRUD/workflow/AI sub-routers
// all share the same Cloudflare Access auth gate.
//
// Two route surfaces:
//   /admin/*       — HTML shell pages (T10.AC1 baseline 8 GETs +
//                    T15.AC1 added /admin/domains → 9 literal admin.get
//                    declarations counted by contract grep).
//   /api/admin/*   — JSON API (CRUD + workflow + AI placeholders).
//
// Both surfaces are gated by `accessAuth` (CF Access JWT presence + JWKS
// signature verification, per T3). DEV_BYPASS_AUTH only short-circuits in
// non-production environments.

import { Hono } from "hono";
import { accessAuth } from "../auth/access-auth";
import { parseBoolean, type Env } from "../env";
import api from "./api";
import workflowApi from "./workflow-api";
import aiApi from "./ai-api";
import { renderDomainsView } from "./views/domains";

const admin = new Hono<{ Bindings: Env }>();

// CF Access gate. The bare `/admin` and the wildcards must be registered
// separately — `/admin/*` does not match `/admin` itself in Hono.
admin.use("/admin", accessAuth);
admin.use("/admin/*", accessAuth);
admin.use("/api/admin/*", accessAuth);

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderShell(title: string, area: string): string {
  // Phase 1 placeholder shell — ES5-only inline script discipline (L-014).
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>${escapeHtml(title)} | Kodigital CMS</title></head>
<body data-area="${escapeHtml(area)}">
  <h1>${escapeHtml(title)}</h1>
  <p data-marker="kodigital-admin-shell">Phase 1 admin shell</p>
</body>
</html>`;
}

// T10.AC1 + T15.AC1: literal GET declarations for the 9 shell paths so a
// contract grep counts them directly (do not derive paths from a constant
// array). T15 added the /admin/domains literal as the 9th entry — see
// the contract-binding regex documented in implementation_digest.md.
admin.get("/admin", (c) => c.html(renderShell("Admin", "home")));
admin.get("/admin/articles", (c) => c.html(renderShell("Articles", "articles")));
admin.get("/admin/pages", (c) => c.html(renderShell("Pages", "pages")));
admin.get("/admin/categories", (c) =>
  c.html(renderShell("Categories", "categories")),
);
admin.get("/admin/tags", (c) => c.html(renderShell("Tags", "tags")));
admin.get("/admin/media", (c) => c.html(renderShell("Media", "media")));
admin.get("/admin/settings", (c) => c.html(renderShell("Settings", "settings")));
admin.get("/admin/presets", (c) => c.html(renderShell("Presets", "presets")));
admin.get("/admin/domains", (c) => c.html(renderDomainsView()));

// T10.AC3: admin auth-status endpoint. Reports whether the dev-bypass is in
// effect for this request so the UI can flag it visually.
admin.get("/api/admin/auth/status", (c) => {
  const devBypass =
    parseBoolean(c.env.DEV_BYPASS_AUTH) && c.env.APP_ENV !== "production";
  return c.json({ authenticated: true, dev_bypass: devBypass });
});

// JSON sub-routers (CRUD, workflow, AI placeholders) — all gated by the
// `/api/admin/*` middleware registered above.
admin.route("/", api);
admin.route("/", workflowApi);
admin.route("/", aiApi);

export default admin;
