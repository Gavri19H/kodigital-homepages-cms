// LeadGen §8.3 / §4.3 — the PUBLIC `/lg/*` runtime router (Phase 7 Stage C).
// Mounted from index.ts next to analyticsRouter (BEFORE the ADMIN_HOST safety
// net + publicRouter's `/:slug` catch-all), so the reserved `/lg` head never
// collides with the public content router — exactly how analyticsRouter mounts
// ahead of publicRouter.
//
// Served on TENANT hosts only: publicSiteContextMiddleware resolves host→site
// and 404s the ADMIN_HOST (its resolveSiteContextFromRequest short-circuits the
// admin host to null), so mounting ahead of the admin-host net is safe — an
// admin-host /lg request gets the middleware's safe 404, never a shell.
//
// The middleware is scoped to `/lg` + `/lg/*` (NOT `*`): mounted at "/", this
// router must run its host→site resolution ONLY for /lg requests and otherwise
// fall through cleanly to the next app (the admin-host net, then publicRouter).
//
// Reserved head: /lg/track (P11), /lg/auction (P10), /lg/lc (P11), /lg/pb|px
// (P13) are NOT registered here. A request to one falls to /lg/:quote_slug →
// 404 (no matching activation) until that phase registers it BEFORE the
// :quote_slug param route.

import { Hono } from "hono";
import type { Env } from "../../env";
import { publicSiteContextMiddleware, type PublicSiteVariables } from "../middleware";
import { serveFunnelShell, serveLeadgenConfig, serveLeadgenAttempt } from "./serve";
import { serveLeadgenAuction } from "./serve-auction";

const leadgenPublicRouter = new Hono<{ Bindings: Env; Variables: PublicSiteVariables }>();

// host→site for every /lg* route (admin host → safe 404 upstream).
leadgenPublicRouter.use("/lg", publicSiteContextMiddleware);
leadgenPublicRouter.use("/lg/*", publicSiteContextMiddleware);

// Static/two-segment /lg heads BEFORE the single-segment /lg/:quote_slug param
// route so `attempt` / `config/:id` / `auction` are never swallowed by the slug
// catch. /lg/auction (P10 §19) is POST + no-store — the funnel-terminal money path.
leadgenPublicRouter.get("/lg/attempt", (c) => serveLeadgenAttempt(c));
leadgenPublicRouter.get("/lg/config/:funnel_variant_id", (c) => serveLeadgenConfig(c));
leadgenPublicRouter.post("/lg/auction", (c) => serveLeadgenAuction(c));
leadgenPublicRouter.get("/lg", (c) => serveFunnelShell(c, null));
leadgenPublicRouter.get("/lg/:quote_slug", (c) => serveFunnelShell(c, c.req.param("quote_slug")));

export { leadgenPublicRouter };
export default leadgenPublicRouter;
