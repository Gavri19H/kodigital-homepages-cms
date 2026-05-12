import { it, expect } from "vitest";
import { dashboardPage } from "../src/admin/templates/dashboard";

// Test name MUST match the typed-contract test_name_regex
// "^dashboardPage renders stats-grid with sites stat$" exactly.
it("dashboardPage renders stats-grid with sites stat", () => {
  const html = dashboardPage(
    {
      sites: 2,
      totalArticles: 3,
      published: 1,
      drafts: 2,
      pages: 0,
      mediaFiles: 0,
      categories: 0,
    },
    [{ title: "A", site: "s1", status: "published" }],
    {},
  );
  expect(html).toContain('class="stats-grid"');
  expect(html).toContain('<div class="stat-value">2</div>');
  expect(html).toContain("Recent Articles");
  expect(html).toContain("Quick Actions");
  expect(html).toContain("+ New Site");
  expect(html).toMatch(/<td>A<\/td>/);
});
