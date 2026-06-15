// T17 — Categories tab parity: the category editor form exposes a
// Description field, a Display Order control and a Show-on-Homepage control
// WHILE keeping the existing multi-vertical select (name="vertical_ids").
//
// T17.AC1: the category-form handler (categoriesListPage renders the
//          New Category modal) emits Description / Display Order /
//          Show-on-Homepage controls and still contains select[name=vertical_ids].
//          The new controls are wired into the POST submit body so they persist.

import { describe, it, expect } from "vitest";
import { categoriesListPage } from "../src/admin/templates/categories";

describe("categories editor form exposes Description / Display Order / Show-on-Homepage and keeps the multi-vertical select (T17.AC1)", () => {
  const html = categoriesListPage([], [{ id: "siteA", name: "Site A" }], {});

  it("renders a Description control", () => {
    expect(html).toMatch(/<textarea[^>]*\sname="description"/);
    expect(html).toContain(
      '<label for="new-category-description" class="form-label">Description</label>',
    );
  });

  it("renders a Display Order control (numeric input)", () => {
    expect(html).toMatch(/<input[^>]*\sname="display_order"[^>]*type="number"/);
    expect(html).toContain(
      '<label for="new-category-display-order" class="form-label">Display Order</label>',
    );
  });

  it("renders a Show-on-Homepage control (checkbox)", () => {
    expect(html).toMatch(
      /<input[^>]*\sname="show_on_homepage"[^>]*type="checkbox"/,
    );
    expect(html).toContain("Show on homepage");
  });

  it("still contains the existing multi-vertical select (name='vertical_ids')", () => {
    expect(html).toMatch(/<select[^>]*\sname="vertical_ids"[^>]*\smultiple/);
  });

  it("wires the new controls into the POST submit body (and keeps vertical_ids)", () => {
    expect(html).toMatch(/description:\s*description/);
    expect(html).toMatch(/display_order:\s*displayOrder/);
    expect(html).toMatch(/show_on_homepage:\s*showOnHomepage/);
    expect(html).toMatch(/vertical_ids:\s*verticalIds/);
  });

  it("keeps the create-category form posting to /api/admin/categories", () => {
    expect(html).toContain("fetch('/api/admin/categories'");
    expect(html).toMatch(/method:\s*'POST'/);
  });
});
