// PR-4 (issue 2/16): renderPageHtml must not render the page title twice. When
// content_html already opens with its own <h1> (the 0025 legal templates, and
// AI-generated pages like /page/about), the wrapper `<h1 class="page-title">`
// is suppressed so each page shows exactly ONE heading. When the body has no
// leading <h1>, the wrapper IS emitted (regression guard).

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

function makeStubDb(): D1Database {
  const stmt = {
    bind() { return stmt; },
    async first() { return null; },
    async all() { return { results: [], success: true, meta: {} }; },
    async run() { return { success: true, meta: {} }; },
  };
  return {
    prepare() { return stmt as unknown as D1PreparedStatement; },
  } as unknown as D1Database;
}

function pageRow(overrides: Partial<PublicPageRow>): PublicPageRow {
  return {
    id: 1,
    slug: "about",
    title: "About Playtrail",
    content_html: "<p>body</p>",
    status: "published",
    updated_at: 1_700_000_000,
    site_id: "site-acme",
    ...overrides,
  } as PublicPageRow;
}

// Count "<h1" occurrences inside the <article class="page-article"> region only
// (ignores any header/footer h1 the layout shell emits).
function articleH1Count(html: string): number {
  const start = html.indexOf('<article class="page-article">');
  const end = html.indexOf("</article>", start);
  if (start < 0 || end < 0) return -1;
  return html.slice(start, end).split("<h1").length - 1;
}

describe("renderPageHtml page-title dedup (PR-4 / issue 2)", () => {
  it("suppresses the wrapper page-title h1 when content_html leads with its own <h1>", async () => {
    const html = await renderPageHtml(
      makeStubDb(),
      siteContext,
      pageRow({ slug: "about", title: "About Playtrail", content_html: "<h1>About Playtrail</h1><p>body</p>" }),
      "/page/about",
    );
    expect(html).not.toContain('<h1 class="page-title">');
    expect(html).toContain("<h1>About Playtrail</h1>");
    expect(articleH1Count(html)).toBe(1);
  });

  it("still emits the wrapper page-title h1 when content has no leading <h1>", async () => {
    const html = await renderPageHtml(
      makeStubDb(),
      siteContext,
      pageRow({ slug: "plain", title: "Plain Page", content_html: "<p>just a paragraph</p>" }),
      "/page/plain",
    );
    expect(html).toContain('<h1 class="page-title">Plain Page</h1>');
    expect(html).toContain("<p>just a paragraph</p>");
    expect(articleH1Count(html)).toBe(1);
  });

  it("suppresses the wrapper even with leading whitespace before the content <h1>", async () => {
    const html = await renderPageHtml(
      makeStubDb(),
      siteContext,
      pageRow({ slug: "terms", title: "Terms of Service", content_html: "   <h1>Terms of Use</h1><p>body</p>" }),
      "/page/terms",
    );
    expect(html).not.toContain('<h1 class="page-title">');
    expect(html).toContain("<h1>Terms of Use</h1>");
    expect(articleH1Count(html)).toBe(1);
  });

  it("dedups the do-not-sell heading yet still injects the CCPA opt-out control", async () => {
    const html = await renderPageHtml(
      makeStubDb(),
      siteContext,
      pageRow({ slug: "do-not-sell", title: "Do Not Sell My Personal Information", content_html: "<h1>Do Not Sell or Share My Personal Information</h1><p>body</p>" }),
      "/page/do-not-sell",
    );
    expect(html).not.toContain('<h1 class="page-title">');
    expect(html).toContain("<h1>Do Not Sell or Share My Personal Information</h1>");
    expect(articleH1Count(html)).toBe(1);
    expect(html).toContain("ccpa-optout");
    expect(html).toContain("data-ccpa-open");
  });
});
