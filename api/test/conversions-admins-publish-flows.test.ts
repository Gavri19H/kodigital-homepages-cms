import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CMS_CONVERSIONS_CAPABILITIES,
  parseCanonicalMembershipCapabilities,
} from "../src/admin/conversions/permanent-authority";

// F23: every Conversions administrator can publish any Flow. Publishing follows
// "flows.publish" alone; "ownership.manage" stays with the accountable owner.
const flows = readFileSync(new URL("../src/admin/conversions/app/flows.tsx", import.meta.url), "utf8");

describe("F23 administrators publish Flows", () => {
  it("enables Publish exact reviewed draft from flows.publish alone", () => {
    const rule = flows.match(/const canCommitPublish = ([^;]+);/u)?.[1];
    expect(rule?.trim()).toBe("canReviewPublish");
    expect(flows).toContain('const canReviewPublish = context?.capabilities.includes("flows.publish") === true;');
    expect(flows).not.toMatch(/capabilities\.includes\("ownership\.manage"\)/u);
    expect(flows).not.toContain("Publishing also requires the ownership.manage capability.");
  });

  it("still needs a current ready review, so blockers such as ownership conflicts keep publishing off", () => {
    expect(flows).toContain('setPublishToken(result.decision === "ready" ? String(result.preview_token) : "");');
    expect(flows).toMatch(/disabled=\{publishToken === "" \|\| saving \|\| !canCommitPublish \|\| !draftMutable\}/u);
    expect(flows).toContain("Publishing is blocked. Fix these, then run Review publish again:");
  });

  it("keeps the role rules: administrators publish but never hold ownership.manage; reporters cannot publish", () => {
    const administrator = CMS_CONVERSIONS_CAPABILITIES.filter((capability) => capability !== "ownership.manage");
    expect(parseCanonicalMembershipCapabilities(JSON.stringify(administrator), "administrator")).toContain("flows.publish");
    expect(parseCanonicalMembershipCapabilities(JSON.stringify([...CMS_CONVERSIONS_CAPABILITIES]), "administrator"))
      .toBeUndefined();
    expect(parseCanonicalMembershipCapabilities('["conversions.view","flows.publish"]', "reporter")).toBeUndefined();
    expect(parseCanonicalMembershipCapabilities(JSON.stringify([...CMS_CONVERSIONS_CAPABILITIES]), "accountable_owner"))
      .toContain("ownership.manage");
  });
});
