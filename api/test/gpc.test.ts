// rescue-7 (#3 GPC honoring): isGpcOptOut decides whether a request's Global
// Privacy Control signal must be honored — only when GPC is asserted, the visitor
// is in the US, and their state mandates a universal opt-out (the agreed NARROW
// geo scope), plus a fail-safe for unknown US regions.
import { describe, it, expect } from "vitest";
import { isGpcOptOut, GPC_HONORED_STATES } from "../src/privacy/gpc";

describe("GPC honoring (rescue-7 #3)", () => {
  it("honors GPC in a covered US state", () => {
    expect(isGpcOptOut({ secGpc: "1", country: "US", regionCode: "CA" })).toBe(true);
    expect(isGpcOptOut({ secGpc: "1", country: "US", regionCode: "TX" })).toBe(true);
    expect(isGpcOptOut({ secGpc: "1", country: "US", regionCode: "OR" })).toBe(true);
  });

  it("does NOT honor GPC in a US state with no universal-opt-out mandate (narrow scope)", () => {
    // New York has no comprehensive consumer-privacy law as of 2026.
    expect(isGpcOptOut({ secGpc: "1", country: "US", regionCode: "NY" })).toBe(false);
  });

  it("never auto-honors GPC for non-US visitors (US state-law scope)", () => {
    expect(isGpcOptOut({ secGpc: "1", country: "IL", regionCode: "TA" })).toBe(false);
    expect(isGpcOptOut({ secGpc: "1", country: "GB", regionCode: "ENG" })).toBe(false);
  });

  it("requires the Sec-GPC signal to be exactly '1'", () => {
    expect(isGpcOptOut({ secGpc: "0", country: "US", regionCode: "CA" })).toBe(false);
    expect(isGpcOptOut({ secGpc: undefined, country: "US", regionCode: "CA" })).toBe(false);
    expect(isGpcOptOut({ secGpc: null, country: "US", regionCode: "CA" })).toBe(false);
  });

  it("fail-safe: honors GPC for a US visitor whose region is unknown", () => {
    expect(isGpcOptOut({ secGpc: "1", country: "US", regionCode: "" })).toBe(true);
    expect(isGpcOptOut({ secGpc: "1", country: "US", regionCode: undefined })).toBe(true);
  });

  it("is case-insensitive on country and region", () => {
    expect(isGpcOptOut({ secGpc: "1", country: "us", regionCode: "ca" })).toBe(true);
  });

  it("covered-state set contains the core universal-opt-out states", () => {
    for (const s of ["CA", "CO", "CT", "TX", "OR"]) {
      expect(GPC_HONORED_STATES.has(s)).toBe(true);
    }
  });
});
