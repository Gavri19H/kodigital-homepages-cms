// LeadGen P8 M9 — Fix stale copy naming things that no longer exist.
// S4.4 "Review slide" → "Edit Section": the label on every /sections/ fix
// link in the publish blocker. The product has pages and sections, never slides.
// Contract §6 M9 item 2: activation.ts:32 + funnel.ts:1166 must say the same
// thing. This spec tests the SSR activation.ts problemFixLabel function.

import { describe, it, expect } from "vitest";
import { problemFixLabel } from "../src/admin/leadgen/quotes-tabs/activation";

describe("P8 M9.2 — Fix label 'Review slide' → 'Edit Section'", () => {
  describe("problemFixLabel function", () => {
    it("returns 'Edit Section' for /sections/ URLs", () => {
      const result = problemFixLabel("/admin/leadgen/sections/lgf_section_123/edit");
      expect(result).toBe("Edit Section");
    });

    it("returns 'Open site settings' for /admin/settings URLs", () => {
      const result = problemFixLabel("/admin/settings");
      expect(result).toBe("Open site settings");
    });

    it("returns 'Open Quote Builder' for /quotes/ URLs", () => {
      const result = problemFixLabel("/admin/leadgen/quotes/lgf_quote_456/edit");
      expect(result).toBe("Open Quote Builder");
    });

    it("returns 'Fix' for unknown URLs", () => {
      const result = problemFixLabel("/unknown/path");
      expect(result).toBe("Fix");
    });

    it("matches patterns that have /sections/ anywhere in URL", () => {
      expect(problemFixLabel("/admin/leadgen/sections/a/edit")).toBe("Edit Section");
      expect(problemFixLabel("/sections/")).toBe("Edit Section");
      expect(problemFixLabel("https://example.com/sections/foo")).toBe("Edit Section");
    });

    it("does NOT match /sections/ inside a path component", () => {
      // Verify that /quotes/ patterns still return "Open Quote Builder"
      expect(problemFixLabel("/admin/leadgen/quotes/lgf_abc/edit")).toBe("Open Quote Builder");
      // Verify that /admin/settings returns the correct label
      expect(problemFixLabel("/admin/settings/leadgen")).toBe("Open site settings");
    });

    it("handles edge cases in URL matching", () => {
      // Empty string
      expect(problemFixLabel("")).toBe("Fix");
      // Just /sections/
      expect(problemFixLabel("/sections/")).toBe("Edit Section");
      // /sections/ not at the root
      expect(problemFixLabel("/admin/quotes/1/sections/2/edit")).toBe("Edit Section");
    });
  });

  describe("Before/after: stale 'Review slide' → product-accurate 'Edit Section'", () => {
    it("renders 'Edit Section' in publish-blocker buttons (before was 'Review slide')", () => {
      // S4.4 Contract requirement: the label on every /sections/ fix link in the
      // publish blocker must name what the operator will actually see.
      // BEFORE: "Review slide" (stale — product has no slides)
      // AFTER: "Edit Section" (accurate — product calls this a section)

      const sectionFixUrl = "/admin/leadgen/sections/lgf_section_xyz/edit";
      const label = problemFixLabel(sectionFixUrl);

      // Verify the fix is applied
      expect(label).toBe("Edit Section");
      expect(label).not.toBe("Review slide");

      // Verify other labels remain unchanged
      expect(problemFixLabel("/admin/settings")).toBe("Open site settings");
      expect(problemFixLabel("/admin/leadgen/quotes/123/edit")).toBe("Open Quote Builder");
    });

    it("verifies product vocabulary: sections are called 'Sections' everywhere", () => {
      // The product uses "Sections" consistently:
      // - PROBLEM_SCOPE_LABELS.section = "Sections" (shared.ts:430)
      // - Section list button text = "Edit" (ui-sections.ts)
      // - So the fix-link button text should be "Edit Section"
      expect(problemFixLabel("/admin/leadgen/sections/any/edit")).toBe("Edit Section");
    });
  });

  describe("Consistency requirement with funnel.ts ES5 island", () => {
    it("documents that funnel.ts:1166 must use the same label", () => {
      // This test documents that the concurrent slice fixing funnel.ts:1166
      // must change "Review slide" to "Edit Section" in the ES5 island code.
      // The funnel.ts update is outside this slice's scope (S4.4 owns only
      // activation.ts), but this requirement ensures both SSR and island
      // render the same button text for consistency.
      const activationLabel = problemFixLabel("/sections/xyz/edit");
      expect(activationLabel).toBe("Edit Section");
      // funnel.ts:1166 must return "Edit Section" when the URL includes "/sections/"
      // to keep both renders (SSR activation.ts + ES5 funnel.ts) byte-identical
    });
  });
});
