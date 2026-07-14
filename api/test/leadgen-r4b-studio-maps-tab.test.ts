// Section Builder v3.1 REMEDIATION — phase R4b.
//
// Deliverable 3 (S3-6 authoring): the server-key DEGRADATION note ships in the
// Maps tab. renderSectionStudio is PURE (no D1), so this asserts the note copy
// renders verbatim in the inspector markup (the island toggles its visibility
// to the auction job — the toggle itself is ES5 island logic in populateMapsTab).

import { describe, expect, it } from "vitest";
import {
  renderSectionStudio,
  type StudioSectionView,
  type StudioMappingSummary,
} from "../src/admin/leadgen/ui-section-studio";
import type { LeadgenSectionContent } from "../src/public/leadgen/components/content-schema";

const CONTENT: LeadgenSectionContent = {
  components: [
    { type: "ZIPInputQuestion", question_id: "q_zip", internal_field: "zip", answer_type: "string" },
  ],
} as unknown as LeadgenSectionContent;

const VIEW: StudioSectionView = {
  public_id: "lgs_r4b_note",
  section_name: "Zip",
  status: "active",
  activity: "Insurance",
  vertical: "Car",
  headline_text: "What's your ZIP code?",
  subheadline_text: "",
  continue_mode: "button",
  address_validation_enabled: false,
  content: CONTENT,
};
const SUMMARY: StudioMappingSummary = {
  publishable: true,
  status: "ok",
  required_missing_total: 0,
  required_mapped_total: 1,
  required_fields_total: 1,
};

describe("R4b deliverable 3 — Maps-tab server-key degradation note", () => {
  const html = renderSectionStudio(VIEW, SUMMARY, "<span>Active</span>", true, 1, false);

  it("renders the plain-words degradation note copy in the Maps tab", () => {
    expect(html).toContain(
      "State and city targeting need the server key — without it, only the ZIP itself is available to auction rules.",
    );
  });

  it("carries the toggle hook the island keys the note visibility on", () => {
    expect(html).toContain("data-maps-degradation-note");
  });

  it("still renders the three Maps jobs (validate/auction/autocomplete) it degrades against", () => {
    for (const job of ["Validate the answer", "Use in auction rules", "Auto-complete the address"]) {
      expect(html, job).toContain(job);
    }
  });
});
