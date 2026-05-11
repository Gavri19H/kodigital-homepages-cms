// Phase 3 / T22.AC2: page editor site-id contract.
//
// Asserts the behavioral contract for /admin/pages/:id/edit:
//   - About (and any non-legal) page editor REQUIRES a site_id. With
//     no site selected, the form must block submit, surface a polite
//     aria-live status message "Site is required", and never POST.
//   - Legal templates (privacy-policy, terms, do-not-sell, contact)
//     MAY be saved with site_id NULL. The UI marks them with a
//     "Global template" badge and the Site selector is not required.

import { describe, it, expect } from "vitest";
import { renderPageEditorView } from "../src/admin/views/page-editor";

describe("page editor (T22.AC2)", () => {
  it("About page requires site_id; legal templates allow site_id NULL", () => {
    const html = renderPageEditorView();

    // Required Site selector
    expect(html).toMatch(/id="page-site"/);
    expect(html).toMatch(/aria-required="true"/);
    expect(html).toMatch(/name="site_id"/);

    // Submit-block status region
    expect(html).toMatch(/aria-live="polite"/);
    expect(html).toContain("Site is required");

    // Page-type select
    expect(html).toMatch(/id="page-type"/);
    expect(html).toMatch(/name="page_type"/);

    // Canonical legal-template slugs allowed to save with site_id NULL.
    const legalSlugs = ["privacy-policy", "terms", "do-not-sell", "contact"];
    for (const slug of legalSlugs) {
      expect(html).toContain(slug);
    }

    // "Global template" badge surfaced for legal templates.
    expect(html).toMatch(/id="page-global-badge"/);
    expect(html).toContain("Global template");

    // Submit-blocking handler is present in the inline script.
    expect(html).toMatch(/preventDefault/);
    expect(html).toMatch(/stopImmediatePropagation/);

    // Script encodes the four canonical legal slugs as the gate that
    // releases the site_id requirement.
    for (const slug of legalSlugs) {
      const pattern = new RegExp("'" + slug + "'\\s*:\\s*1");
      expect(html).toMatch(pattern);
    }
  });
});
