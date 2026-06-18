// T31 — Tag edit: remove the dead link (match reference).
//
// Brief (BCL-064): "reference tags have NO edit (delete only)." The
// /admin/tags/:id/edit route was never registered, so the Edit link in the
// Tags list rows was dead. T31.AC1: the Tags list renders no Edit link
// (delete only), matching the reference.
//
// Render-output assertion against tagsListPage(): with a tag row present the
// HTML MUST expose the Delete control and MUST NOT expose any edit link
// (neither an `/edit` href nor an "Edit" anchor). The regression re-fails if
// only the href were swapped but the anchor restored.
//
// The it() title embeds the literal [api/test/tag-edit-removed.test.ts] so
// the parse_test_output parser binds the observed test name to RC-054's
// expected_test_name_regex (D13 parser-observation route).

import { describe, it, expect } from "vitest";
import { tagsListPage } from "../src/admin/templates/tags";

describe("tags list renders no edit link delete only", () => {
  const tags = [
    { id: "11", name: "alpha", slug: "alpha", site_id: "site-a", article_count: 2 },
    { id: "22", name: "beta", slug: "beta", site_id: null, article_count: 0 },
  ];
  const sites = [{ id: "site-a", name: "Site A" }];

  it("[api/test/tag-edit-removed.test.ts] T31-AC1: the tags table row exposes Delete but NO Edit link L2_AUTO_DISAMBIGUATION:T31-AC1:RC-054", () => {
    const html = tagsListPage(tags, sites, {});

    // Delete is still present per row (create + delete only).
    expect(html).toContain('data-delete-tag="11"');
    expect(html).toContain('data-delete-tag="22"');

    // No edit link survives: neither the dead /edit href nor an Edit anchor.
    expect(html).not.toContain("/admin/tags/11/edit");
    expect(html).not.toContain("/admin/tags/22/edit");
    expect(html).not.toContain("/edit");
    expect(html).not.toContain(">Edit</a>");
  });

  it("[api/test/tag-edit-removed.test.ts] T31-AC1: an empty tags list also renders no Edit link L2_AUTO_DISAMBIGUATION:T31-AC1:RC-054", () => {
    const html = tagsListPage([], sites, {});
    expect(html).not.toContain("/edit");
    expect(html).not.toContain(">Edit</a>");
  });
});
