// PR-3 (issue 16): the Do-Not-Sell page gets the CCPA opt-out control injected
// at render time by renderPageHtml (api/src/public/render-pages.ts), NOT stored
// in the legal-template body. These tests pin:
//   1. (rescue-7) the do-not-sell page emits the opt-out card + an inline script
//      that reopens the CMP's US-Privacy UI (__uspapi 'displayUspUi') — the
//      authoritative GPP/USP opt-out, not the retired /api/privacy cookie;
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
    expect(html).toContain("data-ccpa-open");
    expect(html).toContain("Do Not Sell or Share My Info");
    // The rendered legal body still renders (the hook APPENDS, never replaces).
    expect(html).toContain("<p>rendered legal body</p>");
  });

  it("emits an inline script that reopens the CMP US-Privacy UI (not a custom cookie)", async () => {
    const html = await renderPageHtml(
      makeStubDb(),
      siteContext,
      pageRow({}),
      "/page/do-not-sell",
    );
    expect(html).toContain("<script>");
    // rescue-7: the link reopens the CMP's opt-out UI (the authoritative GPP/USP
    // signal sent to the whole bidstream), via the verified InMobi API — NOT the
    // retired /api/privacy cookie that only ever restricted Google.
    expect(html).toContain("__uspapi");
    expect(html).toContain("displayUspUi");
    expect(html).not.toContain("/api/privacy");
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
