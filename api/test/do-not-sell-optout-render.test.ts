// PR-3 (issue 16): the Do-Not-Sell page gets the CCPA opt-out control injected
// at render time by renderPageHtml (api/src/public/render-pages.ts), NOT stored
// in the legal-template body. These tests pin:
//   1. the do-not-sell page emits the opt-out card markup + an inline script
//      that calls the REAL privacy backend routes/fields
//      (GET /api/privacy/status, POST /api/privacy/opt-out|opt-in; opted_out);
//   2. any OTHER legal/static page renders its content_html unchanged with NO
//      opt-out control leaking in.

import { describe, it, expect } from "vitest";
import { renderPageHtml } from "../src/public/render-pages";
import type { PublicSiteContext } from "../src/public/middleware";
import type { PublicPageRow } from "../src/public/queries";

const siteContext: PublicSiteContext = {
  site_id: "site-acme",
  siteId: "site-acme",
  hostname: "acme.example",
  vertical_slug: "news",
  status: "active",
  content_version: 1,
  settings_version: 1,
};

// A minimal D1 stub: fetchPublicLayoutSiteInfo + loadCustomLayoutHtml both
// degrade to fallbacks on null/empty, which is all renderPageHtml needs to
// compose the layout around the page article.
function makeStubDb(): D1Database {
  const stmt = {
    bind() {
      return stmt;
    },
    async first() {
      return null;
    },
    async all() {
      return { results: [], success: true, meta: {} };
    },
    async run() {
      return { success: true, meta: {} };
    },
  };
  return {
    prepare() {
      return stmt as unknown as D1PreparedStatement;
    },
  } as unknown as D1Database;
}

function pageRow(overrides: Partial<PublicPageRow>): PublicPageRow {
  return {
    id: 1,
    slug: "do-not-sell",
    title: "Do Not Sell or Share My Personal Information",
    content_html: "<p>rendered legal body</p>",
    status: "published",
    updated_at: 1_700_000_000,
    site_id: "site-acme",
    ...overrides,
  } as PublicPageRow;
}

describe("do-not-sell CCPA opt-out render hook (PR-3 / issue 16)", () => {
  it("injects the opt-out card markup inside the page article", async () => {
    const html = await renderPageHtml(
      makeStubDb(),
      siteContext,
      pageRow({}),
      "/page/do-not-sell",
    );
    // The exact contract markup from the spec.
    expect(html).toContain('<div class="ccpa-optout">');
    expect(html).toContain("data-ccpa-status");
    expect(html).toContain("data-ccpa-toggle");
    expect(html).toContain("Do Not Sell or Share My Info");
    // The rendered legal body still renders (the hook APPENDS, never replaces).
    expect(html).toContain("<p>rendered legal body</p>");
  });

  it("emits an inline script that calls the real privacy routes + field", async () => {
    const html = await renderPageHtml(
      makeStubDb(),
      siteContext,
      pageRow({}),
      "/page/do-not-sell",
    );
    expect(html).toContain("<script>");
    // Reads current state on load.
    expect(html).toContain("/api/privacy/status");
    // The two mutating endpoints (opt-out / opt-in) are both wired.
    expect(html).toContain("/api/privacy/opt-out");
    expect(html).toContain("/api/privacy/opt-in");
    // Uses the backend's actual response field name.
    expect(html).toContain("opted_out");
    // Sends the HttpOnly ccpa cookie so the server can read current state.
    expect(html).toContain('credentials:"same-origin"');
    // POSTs the mutation.
    expect(html).toContain('method:"POST"');
    // Tolerant of fetch failure — a graceful message path exists.
    expect(html.toLowerCase()).toContain("could not");
  });

  it("does NOT inject the opt-out control on a non-do-not-sell page", async () => {
    const html = await renderPageHtml(
      makeStubDb(),
      siteContext,
      pageRow({ slug: "privacy-policy", title: "Privacy Policy" }),
      "/page/privacy-policy",
    );
    expect(html).not.toContain("ccpa-optout");
    expect(html).not.toContain("data-ccpa-toggle");
    expect(html).not.toContain("/api/privacy/opt-out");
    // The page still renders its body normally.
    expect(html).toContain("<p>rendered legal body</p>");
  });
});
