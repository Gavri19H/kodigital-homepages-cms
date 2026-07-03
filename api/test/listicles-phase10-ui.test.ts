// Listicles Phase 10 — the two new admin-UI surfaces render structurally
// correct (§11 drilldown expander + §18 rebuild-range control). Pure-function
// render assertions (no DB): the templates are pure, so we drive them from
// fixture DTOs and assert the wire markers the e2e funnel then exercises live.
//
// ES5-parse of the two new inline scripts is covered by listicles-ui-es5.test.ts
// (the Articles page carries them, and that gate byte-parses every inline
// <script> on the page). This file asserts PRESENCE + STRUCTURE.

import { describe, expect, it } from "vitest";
import {
  listiclesArticlesPage,
  type ArticlesPageProps,
} from "../src/admin/listicles/ui-lists";
import { resolveTimeframe, ARTICLE_ANALYTICS_COLUMNS } from "../src/admin/listicles/ui-shared";

const timeframe = resolveTimeframe("30d");
const paging = { page: 1, page_size: 25, total: 1, has_next: false, has_prev: false };
const emptyPaging = { page: 1, page_size: 25, total: 0, has_next: false, has_prev: false };

const baseProps: ArticlesPageProps = {
  articles: [
    {
      id: 42,
      public_id: "art_p10fixture",
      article_name: "Phase 10 Fixture Article",
      slug: "p10-fixture",
      status: "published",
      version_count: 2,
      experiment_status: "running",
    },
  ],
  paging,
  sites: [{ id: "st_p10", name: "Site P10" }],
  selectedSiteId: "st_p10",
  search: "",
  range: "30d",
  timeframe,
  loadError: null,
};

describe("Phase 10 — §11 drilldown expander UI", () => {
  const html = listiclesArticlesPage(baseProps, {});

  it("every article row carries a '+' drilldown toggle in a leading expander column", () => {
    expect(html).toContain('data-lst-drill-toggle');
    expect(html).toContain('aria-expanded="false"');
    // leading expander column header + cell
    expect(html).toContain('class="lst-exp-col" aria-label="Drilldown"');
    expect(html).toMatch(/<td class="lst-exp-col"><button[^>]*data-lst-drill-toggle/);
  });

  it("the empty-state colspan tracks the new column count (leading expander + 4 + analytics + actions)", () => {
    const emptyHtml = listiclesArticlesPage(
      { ...baseProps, articles: [], paging: emptyPaging },
      {},
    );
    const expected = 1 + 4 + ARTICLE_ANALYTICS_COLUMNS.length + 1;
    expect(emptyHtml).toContain(`colspan="${expected}"`);
  });

  it("the drilldown script targets the EXISTING /drilldown endpoint and renders §11 rule metrics", () => {
    expect(html).toContain("/drilldown?from=");
    // §11 rule rows add these three; base rows carry the standard metrics.
    for (const metric of ["matched_sessions", "fallback_sessions", "rule_match_rate"]) {
      expect(html, `drilldown metric ${metric}`).toContain(metric);
    }
    for (const metric of ["impressions", "clicks", "unique_clicks", "conversions", "ctr", "cvr", "revenue", "rpc", "rpm"]) {
      expect(html, `drilldown base metric ${metric}`).toContain(metric);
    }
    // async-hydrated via the shared getJson + .skel skeleton (reuse, not reinvention)
    expect(html).toContain("window.lstUi");
    expect(html).toContain("lst-drill-box");
    expect(html).toContain("lst-drill-row");
    // empty-state branch present
    expect(html).toContain("No drilldown analytics for this article in this range yet.");
  });

  it("column-count parity: header <th> == article-row <td> == ARTICLE_COLUMN_COUNT, and the detail row spans that same live count", () => {
    const expected = 1 + 4 + ARTICLE_ANALYTICS_COLUMNS.length + 1; // exp + name/slug/versions/status + analytics + actions
    // header cells in the articles-list <thead>
    const thead = html.slice(html.indexOf("<thead>"), html.indexOf("</thead>"));
    const headerCount = (thead.match(/<th\b/g) ?? []).length;
    expect(headerCount, "header <th> count").toBe(expected);
    // cells in the first article <tr>
    const rowStart = html.indexOf("<tr data-entity-id=");
    const row = html.slice(rowStart, html.indexOf("</tr>", rowStart));
    const cellCount = (row.match(/<td\b/g) ?? []).length;
    expect(cellCount, "article row <td> count").toBe(expected);
    // the drilldown detail row's colSpan is DERIVED from the row's live cell
    // count, so it always spans the full width (header == body == colSpan basis).
    expect(html).toContain("row.cells ? row.cells.length : 1");
  });
});

describe("Phase 10 — §18 rebuild-range control", () => {
  it("renders from/to date inputs + a Rebuild button + a live status region", () => {
    const html = listiclesArticlesPage(baseProps, {});
    expect(html).toContain('class="lst-rebuild"');
    expect(html).toContain("data-lst-rebuild-from");
    expect(html).toContain("data-lst-rebuild-to");
    expect(html).toContain("data-lst-rebuild-run");
    expect(html).toContain("data-lst-rebuild-status");
    expect(html).toMatch(/<input type="date"[^>]*data-lst-rebuild-from/);
  });

  it("the wiring POSTs to the EXISTING rebuild-range endpoint and reports the honest summary", () => {
    const html = listiclesArticlesPage(baseProps, {});
    expect(html).toContain("/api/admin/listicles/analytics/rebuild-range");
    // honest no-op path (configured:false) + row-count path both surfaced
    expect(html).toContain("configured");
    expect(html).toContain("total_rows");
    expect(html).toContain("No ClickHouse configured");
  });

  it("stays available behind the 'Site is required' gate (global backfill), with no articles table", () => {
    const gated = listiclesArticlesPage(
      { ...baseProps, articles: [], paging: emptyPaging, sites: [], selectedSiteId: null },
      {},
    );
    expect(gated).toContain('class="lst-rebuild"');
    expect(gated).toContain("data-lst-rebuild-run");
    expect(gated).not.toContain('class="table articles-list"');
  });
});
