// P4a SSR-side proofs (register PC-A13 visibility hook + PC-A1 render fallback).
//
// PC-A13: a conditional NON-producing node must carry a hideable [data-lg-node]
// hook (the runtime toggles it, converging with the SSR dependency-preview).
// PC-A1 render fallback: an INELIGIBLE auto_advance section must still render a
// Continue (so pre-existing stuck content un-sticks WITHOUT migration), while an
// ELIGIBLE one still suppresses it — proven at the string level here; the live
// DOM behavior is the Playwright leg.
import { describe, expect, it } from "vitest";
import { renderComponent, renderSectionComponents } from "../src/public/leadgen/components/presets";
import type { LeadgenSectionRenderCtx } from "../src/public/leadgen/components/presets";
import type { LeadgenComponentNode } from "../src/public/leadgen/components/content-schema";
import { defaultFunnelDesign } from "../src/public/leadgen/designs/default-funnel/tokens";

const DESIGN = defaultFunnelDesign;
const controls = (html: string): number => (html.match(/data-lg-continue/g) ?? []).length;
const nodeHooks = (html: string): number => (html.match(/data-lg-node=/g) ?? []).length;

const choice = (v: string) => ({ label: v.toUpperCase(), value: v, analytics_id: v });
const buttons = (id: string): LeadgenComponentNode =>
  ({ type: "ButtonAnswerGroup", question_id: id, internal_field: id, choices: [choice("a"), choice("b")] }) as LeadgenComponentNode;
const dropdown = (id: string): LeadgenComponentNode =>
  ({ type: "DropdownQuestion", question_id: id, internal_field: id, choices: [choice("a"), choice("b")] }) as LeadgenComponentNode;
const textBlock = (id: string, conditional?: unknown): LeadgenComponentNode =>
  ({ type: "TextBlock", question_id: id, props: { role: "body", text: "t" }, ...(conditional ? { conditional } : {}) }) as LeadgenComponentNode;
const trustBar = (id: string, conditional?: unknown): LeadgenComponentNode =>
  ({ type: "TrustBar", question_id: id, props: { items: [{ icon: "check", text: "Secure" }] }, ...(conditional ? { conditional } : {}) }) as LeadgenComponentNode;

const ctx = (continueMode: "button" | "auto_advance", placement: "inside_unit" | "below_unit" = "inside_unit"): LeadgenSectionRenderCtx => ({
  headline_text: "Q?",
  subheadline_text: null,
  continue_mode: continueMode,
  continue_placement: placement,
});

describe("PC-A13 — conditional non-producer gets a [data-lg-node] hideable hook", () => {
  it("a conditional TextBlock emits data-lg-node (NOT data-lg-question)", () => {
    const html = renderComponent(textBlock("tb1", { when: "insured", op: "eq", value: "yes" }), DESIGN);
    expect(html).toContain('data-lg-node="tb1"');
    expect(html).not.toContain("data-lg-question");
  });

  it("a conditional TrustBar emits data-lg-node", () => {
    const html = renderComponent(trustBar("tr1", { when: "kind", op: "eq", value: "biz" }), DESIGN);
    expect(html).toContain('data-lg-node="tr1"');
  });

  it("a NON-conditional TextBlock emits NO hook (nothing to toggle)", () => {
    const html = renderComponent(textBlock("tb2"), DESIGN);
    expect(html).not.toContain("data-lg-node");
    expect(html).not.toContain("data-lg-question");
  });

  it("an answer-PRODUCING node keeps data-lg-question, never data-lg-node (probe purity)", () => {
    const html = renderComponent(buttons("q1"), DESIGN);
    expect(html).toContain('data-lg-question="q1"');
    expect(html).not.toContain("data-lg-node");
  });
});

describe("PC-A1 render fallback — ineligible auto_advance still renders exactly ONE Continue", () => {
  it("ELIGIBLE auto_advance (one ButtonAnswerGroup) suppresses the Continue", () => {
    const html = renderSectionComponents([textBlock("hd"), buttons("q1")], DESIGN, ctx("auto_advance"));
    expect(controls(html)).toBe(0);
  });

  it("INELIGIBLE auto_advance (2 producers, no continue node, inside_unit) renders ONE default Continue", () => {
    const html = renderSectionComponents([buttons("a"), buttons("b")], DESIGN, ctx("auto_advance", "inside_unit"));
    expect(controls(html)).toBe(1);
  });

  it("INELIGIBLE auto_advance (dropdown-only) renders ONE Continue", () => {
    const html = renderSectionComponents([dropdown("q")], DESIGN, ctx("auto_advance"));
    expect(controls(html)).toBe(1);
  });

  it("INELIGIBLE auto_advance carrying an AutoAdvanceButton node renders exactly ONE (no double)", () => {
    const auto: LeadgenComponentNode = { type: "AutoAdvanceButton", question_id: "aab" } as LeadgenComponentNode;
    const html = renderSectionComponents([buttons("a"), buttons("b"), auto], DESIGN, ctx("auto_advance"));
    expect(controls(html)).toBe(1);
  });

  it("INELIGIBLE auto_advance carrying a ContinueButton node renders exactly ONE (captured to the slot)", () => {
    const cont: LeadgenComponentNode = { type: "ContinueButton", question_id: "cb", props: { label: "Continue" } } as LeadgenComponentNode;
    const html = renderSectionComponents([buttons("a"), buttons("b"), cont], DESIGN, ctx("auto_advance"));
    expect(controls(html)).toBe(1);
  });

  it("REGRESSION: a button-mode section with a ContinueButton still renders exactly ONE Continue", () => {
    const cont: LeadgenComponentNode = { type: "ContinueButton", question_id: "cb", props: { label: "Continue" } } as LeadgenComponentNode;
    const html = renderSectionComponents([buttons("q1"), cont], DESIGN, ctx("button"));
    expect(controls(html)).toBe(1);
  });

  it("REGRESSION: the conditional TextBlock+TrustBar case (A13) renders both node hooks, no Continue leak", () => {
    const html = renderSectionComponents(
      [buttons("q1"), textBlock("tb", { when: "q1", op: "eq", value: "a" }), trustBar("tr", { when: "q1", op: "eq", value: "b" })],
      DESIGN,
      ctx("auto_advance"),
    );
    expect(nodeHooks(html)).toBe(2); // one per conditional non-producer
    expect(controls(html)).toBe(0); // eligible (single producer) → suppressed
  });
});
