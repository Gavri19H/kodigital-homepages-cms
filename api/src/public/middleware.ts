// Phase 3 / T26: Public Worker site-context middleware.
//
// Public requests arrive on tenant hostnames (e.g. mysite.com). This
// middleware resolves the corresponding SiteContext via
// (domains JOIN sites) and either:
//   - 404s the request when no site is registered for the hostname,
//     including the admin host (defense-in-depth — the safety net in
//     api/src/index.ts already 404s admin-host requests that reach the
//     public router, but the middleware re-asserts the boundary here),
//     using a safe body that MUST NOT leak the admin host name; or
//   - Stores the SiteContext on the Hono context (`c.set("site", ...)`)
//     and calls `next()` so downstream public handlers can scope their
//     queries by site_id (T27).
//
// Tenant-boundary contract (T26.AC1 / T26.AC2):
//   1. Middleware function is exported with a name the contract grep
//      counts exactly once:
//        ^export (async )?function (publicSiteContextMiddleware|
//                                   siteContextMiddleware|
//                                   withSiteContext)
//   2. Unmapped hostname → 404 with a safe body that NEVER contains
//      the admin host name (no "cms.kodigital.app" substring) — this
//      is the T26.AC2 anti-information-leak invariant tested in
//      api/test/public-middleware.test.ts.
//   3. ADMIN_HOST flows to `resolveSiteContextFromRequest`, which
//      short-circuits to null before touching the domains registry,
//      so admin-host requests reaching the public router get the same
//      safe 404 as any other unmapped hostname.

import type { Context, Next } from "hono";
import type { Env } from "../env";
import type { SiteContext } from "../site/site-context";
import {
  resolveSiteContextFromRequest,
  resolveSiteStatusFromRequest,
} from "../site/site-context";

// PublicSiteContext: the T27 wire-into-handlers view of SiteContext.
// Mirrors the canonical SiteContext (snake_case `site_id`) and adds a
// camelCase `siteId` alias so T27 public handlers can scope queries via
// `siteContext.siteId` without redeclaring the destructure in every route.
export interface PublicSiteContext extends SiteContext {
  siteId: string;
}

export type PublicSiteVariables = {
  site: SiteContext;
  siteContext: PublicSiteContext;
};

export async function publicSiteContextMiddleware(
  c: Context<{ Bindings: Env; Variables: PublicSiteVariables }>,
  next: Next,
): Promise<Response | void> {
  const site = await resolveSiteContextFromRequest(c.req.raw, c.env.DB, c.env);
  if (site === null) {
    // T36 (status semantics): a site that was provisioned and is now
    // intentionally retired (sites.status = 'disabled') returns 410 Gone —
    // distinct from the 404 Not Found a draft / provisioning / failed / never-
    // mapped host gets. 410 tells crawlers the URL is permanently gone, so the
    // disabled site DROPS from the index — every public route flows through
    // this middleware, including /sitemap.xml and /robots.txt, so those are
    // Gone too (no sitemap to crawl, no robots to honor). The status lookup
    // bypasses the active-gate and runs ONLY on this already-not-served path,
    // never on the hot path of an active tenant.
    const status = await resolveSiteStatusFromRequest(
      c.req.raw,
      c.env.DB,
      c.env,
    );
    if (status === "disabled") {
      return c.json({ error: "Gone" }, 410);
    }
    return c.json({ error: "Not Found" }, 404);
  }
  c.set("site", site);
  c.set("siteContext", { ...site, siteId: site.site_id });
  await next();
}
