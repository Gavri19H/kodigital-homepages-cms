// P3a structured-placement SAVE-TIME validation (register PC-2 / D1 / R-B).
// Proves the node.layout contract in content-schema.ts: shape/enum/clamp
// per-node + the sibling-level row-grouping rules (contiguity, max-3,
// frame-scope). Accept cases carry ZERO errors; reject cases surface the
// `invalid_placement` code with a path (a save endpoint turns any error into a
// 400 — this is that gate's evidence).
import { describe, expect, it } from "vitest";
import { LEADGEN_PLACEMENT_EXCLUDED_TYPES, validateSectionContent } from "../src/public/leadgen/components/content-schema";
import type { LeadgenComponentNode } from "../src/public/leadgen/components/content-schema";

const codesOf = (r: ReturnType<typeof validateSectionContent>): string[] => r.errors.map((e) => e.code);
const content = (components: unknown[]): { components: unknown[] } => ({ components });

// Minimal, otherwise-valid nodes (verified accepted below without layout).
const text = (id: string, layout?: unknown): LeadgenComponentNode =>
  ({ type: "TextBlock", question_id: id, props: { role: "body", text: "t" }, ...(layout ? { layout } : {}) }) as LeadgenComponentNode;
const field = (id: string, layout?: unknown): LeadgenComponentNode =>
  ({ type: "FreeTextQuestion", question_id: id, internal_field: id, ...(layout ? { layout } : {}) }) as LeadgenComponentNode;

describe("P3a placement validation — accept", () => {
  it("a row of 2 contiguous same-row siblings (align + width) validates clean", () => {
    const r = validateSectionContent(
      content([text("a", { row: "r1", align: "start" }), field("b", { row: "r1", width: "m" })]),
    );
    expect(r.errors).toEqual([]);
  });

  it("a row of 3 + a lone centered box + a nudged element (in range) validates clean", () => {
    const r = validateSectionContent(
      content([
        text("a", { row: "r1" }),
        text("b", { row: "r1" }),
        field("c", { row: "r1", width: { custom_px: 320 } }),
        field("d", { width: "m", align: "center" }),
        field("e", { nudge_x: 48, nudge_y: -48 }),
      ]),
    );
    expect(r.errors).toEqual([]);
  });

  it("a lone element carrying a row-id (no contiguous partner) is harmless", () => {
    expect(validateSectionContent(content([field("solo", { row: "r1" }), text("x")])).errors).toEqual([]);
  });

  it("a node WITHOUT layout still validates (regression) and an empty layout {} is a no-op", () => {
    expect(validateSectionContent(content([field("a"), text("b")])).errors).toEqual([]);
    expect(validateSectionContent(content([field("a", {})])).errors).toEqual([]);
  });

  it("a container may be a row member", () => {
    const stack = { type: "Stack", question_id: "st", children: [text("c1")], layout: { row: "r1" } };
    const r = validateSectionContent(content([stack, text("t2", { row: "r1" })]));
    expect(r.errors).toEqual([]);
  });

  it("CONDUCTOR FIX regression: ContinueButton/AutoAdvanceButton WITHOUT layout still validate clean", () => {
    const cont = { type: "ContinueButton", question_id: "cont", props: { label: "Continue" } };
    const auto = { type: "AutoAdvanceButton", question_id: "auto" };
    expect(validateSectionContent(content([text("a"), cont])).errors).toEqual([]);
    expect(validateSectionContent(content([text("b"), auto])).errors).toEqual([]);
  });
});

describe("P3a placement validation — reject (invalid_placement)", () => {
  it("non-contiguous row (id reappears after a gap) is unrenderable", () => {
    const r = validateSectionContent(content([text("a", { row: "r1" }), text("b"), text("c", { row: "r1" })]));
    expect(codesOf(r)).toContain("invalid_placement");
    expect(r.errors.some((e) => /contiguous/.test(e.message))).toBe(true);
  });

  it("a row with 4 members exceeds the 2-3 slot model", () => {
    const r = validateSectionContent(
      content([text("a", { row: "r1" }), text("b", { row: "r1" }), text("c", { row: "r1" }), text("d", { row: "r1" })]),
    );
    expect(codesOf(r)).toContain("invalid_placement");
    expect(r.errors.some((e) => /at most 3/.test(e.message))).toBe(true);
  });

  it("layout on a frame-scope component (ProgressBar) is rejected", () => {
    const pb = { type: "ProgressBar", question_id: "p", props: { mode: "percent", percent: 50 }, layout: { align: "center" } };
    expect(codesOf(validateSectionContent(content([pb, text("t")])))).toContain("invalid_placement");
  });

  it("a nudge outside [-48, 48] is rejected", () => {
    expect(codesOf(validateSectionContent(content([field("a", { nudge_x: 49 })])))).toContain("invalid_placement");
    expect(codesOf(validateSectionContent(content([field("a", { nudge_y: -49 })])))).toContain("invalid_placement");
    expect(codesOf(validateSectionContent(content([field("a", { nudge_x: 12.5 })])))).toContain("invalid_placement");
  });

  it("a bad align / width / row-id / unknown key is rejected", () => {
    expect(codesOf(validateSectionContent(content([field("a", { align: "middle" })])))).toContain("invalid_placement");
    expect(codesOf(validateSectionContent(content([field("a", { width: "xxl" })])))).toContain("invalid_placement");
    expect(codesOf(validateSectionContent(content([field("a", { width: { custom_px: 99 } })])))).toContain("invalid_placement"); // below the 200 floor
    expect(codesOf(validateSectionContent(content([field("a", { row: "has spaces!" })])))).toContain("invalid_placement");
    expect(codesOf(validateSectionContent(content([field("a", { bogus: 1 })])))).toContain("invalid_placement");
    expect(codesOf(validateSectionContent(content([field("a", "not-an-object")])))).toContain("invalid_placement");
  });

  it("row-grouping is enforced INSIDE a container's children too", () => {
    const stack = {
      type: "Stack",
      question_id: "st",
      children: [text("c1", { row: "r1" }), text("c2"), text("c3", { row: "r1" })], // non-contiguous inside children
    };
    expect(codesOf(validateSectionContent(content([stack])))).toContain("invalid_placement");
  });

  // -------------------------------------------------------------------------
  // CONDUCTOR FIX (post-P3a-dispatch, surfaced by P3b): ContinueButton /
  // AutoAdvanceButton are catalog scope:"unit" (would otherwise be placement-
  // eligible) but their POSITION is Quote-Builder-owned (§8.5b/§11.5 continue-
  // placement model) — layout is rejected on both regardless of shape.
  // -------------------------------------------------------------------------
  it("layout on ContinueButton is rejected — named ownership message, not the generic frame-scope one", () => {
    const cont = { type: "ContinueButton", question_id: "cont", props: { label: "Continue" }, layout: { align: "center" } };
    const r = validateSectionContent(content([text("a"), cont]));
    expect(codesOf(r)).toContain("invalid_placement");
    const msg = r.errors.find((e) => e.code === "invalid_placement" && e.path.endsWith(".layout"))?.message ?? "";
    expect(msg, "message names Quote Builder ownership, not the frame-scope wording").toMatch(/Quote Builder/);
    expect(msg).not.toMatch(/funnel-frame component/);
  });

  it("layout on AutoAdvanceButton is rejected — same ownership message", () => {
    const auto = { type: "AutoAdvanceButton", question_id: "auto", layout: { row: "r1", nudge_x: 10 } };
    const r = validateSectionContent(content([text("a", { row: "r1" }), auto]));
    expect(codesOf(r)).toContain("invalid_placement");
    const msg = r.errors.find((e) => e.code === "invalid_placement" && e.path.endsWith(".layout"))?.message ?? "";
    expect(msg).toMatch(/Quote Builder/);
  });

  it("even a bare empty layout ({}) is rejected on an excluded type (presence alone is the violation)", () => {
    const cont = { type: "ContinueButton", question_id: "cont", props: { label: "Continue" }, layout: {} };
    expect(codesOf(validateSectionContent(content([text("a"), cont])))).toContain("invalid_placement");
  });

  it("lockstep guard: the exported exclusion set is EXACTLY {ContinueButton, AutoAdvanceButton} — a silent list change must fail this test, since P3b mirrors it verbatim", () => {
    expect([...LEADGEN_PLACEMENT_EXCLUDED_TYPES].sort()).toEqual(["AutoAdvanceButton", "ContinueButton"]);
  });
});
