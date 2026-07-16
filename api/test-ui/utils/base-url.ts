// Shared wrangler-dev port for every spec that builds its own request URLs
// (a hardcoded `ORIGIN`/`baseURL` constant, or a per-tenant-host template
// literal like `http://${host}:8787/...`) instead of relying on Playwright's
// fixture-injected baseURL (playwright.config.ts's own `use.baseURL`, which
// already reads this same env var — unaffected, still defaults to 8787 for
// CI). Those specs need their OWN copy of the port because they either
// construct a full origin string ahead of navigation, set an explicit `Host`
// header for a tenant domain mapped to loopback, or open a manual
// request/browser context that does not inherit config's baseURL.
//
// Default stays 8787 (CI + every caller that does not set PW_PORT); a
// worktree-isolated run sets PW_PORT=8899 so a parallel mission's own
// wrangler dev on 8787 is untouched (conductor fix round, product-core P1c).
export const PW_PORT = process.env.PW_PORT || "8787";
