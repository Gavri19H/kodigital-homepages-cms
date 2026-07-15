// v2.5 contract test `canonical-headline-binding` — RENDERER legs (03 §3.4).
//
// A BOUND QuestionHeadline/Subheadline node renders the Section's canonical
// headline/subheadline text from the renderSectionComponents `sectionCtx`
// third argument; an UNBOUND legacy node with props.text renders BYTE-
// IDENTICALLY to the pre-change output (pinned below as literal snapshot
// strings captured from the pre-change renderer); a bound node without ctx
// renders EMPTY text gracefully (never a throw); ctx text is escaped exactly
// like props.text is.
//
// NOTE (slice boundary): the handler/PATCH legs of `canonical-headline-
// binding` — every call site (serve.ts, both preview handlers, content_html
// persist, studio canvas) passing sectionCtx, and the §3.4 validator/save
// behavior — belong to the INTEGRATION slice, not this renderer-leg file.

import { describe, expect, it } from "vitest";
import type { LeadgenComponentNode } from "../src/public/leadgen/components/content-schema";
import {
  renderComponent,
  renderSectionComponents,
} from "../src/public/leadgen/components/presets";
import type { LeadgenSectionRenderCtx } from "../src/public/leadgen/components/presets";
import { defaultFunnelDesign } from "../src/public/leadgen/designs/default-funnel/tokens";

const DESIGN = defaultFunnelDesign;

// --- pre-change byte snapshots (captured from the renderer BEFORE this
// slice's change landed; the unbound legs must reproduce them verbatim) -----

// R5 D11 (register S4-B2, operator decision 1): headline typography now
// matches the golden mockup (Newsreader/#16324f) and subheadline color is
// golden's #63707F — the only bytes these pins carry forward from that
// ratified, live-funnel-wide change.
//
// These two snapshots are the bare (unwrapped) per-node bytes — used AS-IS
// against renderComponent() (the single-node path, which bypasses the
// top-level render entirely and so never carries the card) and wrapped via
// questionCard() below against renderSectionComponents() (which does, per
// R7 U12 FIX 3b, golden :308, conductor-ruled 2026-07-15 — the unit-level
// question card wraps the ENTIRE depth-1 render, unconditionally).
const SNAPSHOT_HEADLINE_UNBOUND =
  `<h1 class="lg-headline" data-component-type="QuestionHeadline" data-question-id="h1"` +
  ` style="font-family:&#39;Newsreader&#39;,serif;color:#16324f">Are you insured?</h1>`;

const SNAPSHOT_SUBHEADLINE_UNBOUND =
  `<p class="lg-subheadline" data-component-type="Subheadline" data-question-id="s1"` +
  ` style="color:#63707F">Takes 2 minutes.</p>`;

// The ONE attributable delta a renderSectionComponents() call carries over a
// bare renderComponent()/snapshot comparison: the FIX 3b unit-level card.
const questionCard = (inner: string): string => `<div class="lg-question-card">${inner}</div>`;

// --- fixtures ---------------------------------------------------------------

const H_UNBOUND: LeadgenComponentNode = {
  type: "QuestionHeadline",
  question_id: "h1",
  props: { text: "Are you insured?" },
};
const S_UNBOUND: LeadgenComponentNode = {
  type: "Subheadline",
  question_id: "s1",
  props: { text: "Takes 2 minutes." },
};
const H_BOUND: LeadgenComponentNode = {
  type: "QuestionHeadline",
  question_id: "h1",
  bind: "section_headline",
};
const S_BOUND: LeadgenComponentNode = {
  type: "Subheadline",
  question_id: "s1",
  bind: "section_subheadline",
};

const ctx = (
  headline: string,
  subheadline: string | null = "Sub from ctx",
): LeadgenSectionRenderCtx => ({ headline_text: headline, subheadline_text: subheadline });

describe("canonical-headline-binding — bound nodes render sectionCtx text (§3.4)", () => {
  it("a bound QuestionHeadline renders the ctx headline_text", () => {
    const html = renderSectionComponents([H_BOUND], DESIGN, ctx("Canonical headline"));
    expect(html).toContain(">Canonical headline</h1>");
    expect(html).toContain(`class="lg-headline"`);
  });

  it("a bound Subheadline renders the ctx subheadline_text", () => {
    const html = renderSectionComponents([S_BOUND], DESIGN, ctx("H", "Canonical sub"));
    expect(html).toContain(">Canonical sub</p>");
    expect(html).toContain(`class="lg-subheadline"`);
  });

  it("bound vs unbound differ ONLY in the text source (identical wrapper markup)", () => {
    const bound = renderSectionComponents([H_BOUND], DESIGN, ctx("Are you insured?"));
    // Same question_id + same text → byte-equal output (wrapper, attribute
    // order, style, escaping are all shared with the props.text path), modulo
    // the FIX 3b unit-level card every renderSectionComponents() call carries.
    expect(bound).toBe(questionCard(SNAPSHOT_HEADLINE_UNBOUND));
  });

  it("a bound node ignores props.text absence — no props at all, never throws", () => {
    expect(H_BOUND.props).toBeUndefined();
    const html = renderSectionComponents([H_BOUND], DESIGN, ctx("From the Section column"));
    expect(html).toContain(">From the Section column</h1>");
  });

  it("a (pathological) bound node carrying props.text still renders ctx text — the column wins", () => {
    // validateSectionContent rejects this at save (bound_node_carries_text);
    // the renderer resolves the bind regardless (defensive, §3.4).
    const node: LeadgenComponentNode = {
      type: "QuestionHeadline",
      question_id: "h1",
      bind: "section_headline",
      props: { text: "STALE copy" },
    };
    const html = renderSectionComponents([node], DESIGN, ctx("Fresh column text"));
    expect(html).toContain(">Fresh column text</h1>");
    expect(html).not.toContain("STALE copy");
  });
});

describe("canonical-headline-binding — unbound legacy nodes render byte-identically (§3.4 legacy rule)", () => {
  it("unbound QuestionHeadline without ctx === the pre-change snapshot (renderSectionComponents wraps the FIX 3b card; renderComponent bypasses it)", () => {
    expect(renderSectionComponents([H_UNBOUND], DESIGN)).toBe(questionCard(SNAPSHOT_HEADLINE_UNBOUND));
    expect(renderComponent(H_UNBOUND, DESIGN)).toBe(SNAPSHOT_HEADLINE_UNBOUND);
  });

  it("unbound Subheadline without ctx === the pre-change snapshot (renderSectionComponents wraps the FIX 3b card; renderComponent bypasses it)", () => {
    expect(renderSectionComponents([S_UNBOUND], DESIGN)).toBe(questionCard(SNAPSHOT_SUBHEADLINE_UNBOUND));
    expect(renderComponent(S_UNBOUND, DESIGN)).toBe(SNAPSHOT_SUBHEADLINE_UNBOUND);
  });

  it("an unbound node IGNORES a present ctx — props.text still wins, byte-identically", () => {
    const html = renderSectionComponents([H_UNBOUND, S_UNBOUND], DESIGN, ctx("CTX H", "CTX S"));
    // ONE card wraps BOTH nodes (they're in the same depth-1 call/section).
    expect(html).toBe(questionCard(SNAPSHOT_HEADLINE_UNBOUND + SNAPSHOT_SUBHEADLINE_UNBOUND));
    expect(html).not.toContain("CTX H");
    expect(html).not.toContain("CTX S");
  });
});

describe("canonical-headline-binding — ctx absent / null renders empty text gracefully", () => {
  it("bound QuestionHeadline with NO ctx renders empty text (no throw)", () => {
    const html = renderSectionComponents([H_BOUND], DESIGN);
    expect(html).toContain(`class="lg-headline"`);
    // trailing </div> is the FIX 3b unit-level card close (renderSectionComponents
    // always wraps at depth 1); the h1 itself still closes with empty text.
    expect(html).toMatch(/>(<\/h1>)<\/div>$/);
  });

  it("bound Subheadline with NO ctx renders empty text (no throw)", () => {
    const html = renderSectionComponents([S_BOUND], DESIGN);
    expect(html).toMatch(/>(<\/p>)<\/div>$/);
  });

  it("subheadline_text: null (the DB column is nullable) renders empty text", () => {
    const html = renderSectionComponents([S_BOUND], DESIGN, ctx("H", null));
    expect(html).toMatch(/>(<\/p>)<\/div>$/);
  });

  it("renderComponent WITHOUT render state (single-node path) renders a bound node empty, not a throw", () => {
    const html = renderComponent(H_BOUND, DESIGN);
    expect(html).toMatch(/>(<\/h1>)$/);
  });
});

describe("canonical-headline-binding — escaping equivalence (ctx text escaped exactly like props.text)", () => {
  const HOSTILE = `<script>alert(1)</script>" onmouseover="x" &amp; 'quotes'`;

  it("hostile ctx headline text renders byte-identically to the same hostile props.text (modulo the FIX 3b card renderSectionComponents always wraps)", () => {
    const viaProps = renderComponent(
      { type: "QuestionHeadline", question_id: "h1", props: { text: HOSTILE } },
      DESIGN,
    );
    const viaCtx = renderSectionComponents([H_BOUND], DESIGN, ctx(HOSTILE));
    expect(viaCtx).toBe(questionCard(viaProps));
    expect(viaCtx).not.toContain("<script>");
    expect(viaCtx).toContain("&lt;script&gt;");
  });

  it("hostile ctx subheadline text renders byte-identically to the same hostile props.text (modulo the FIX 3b card renderSectionComponents always wraps)", () => {
    const viaProps = renderComponent(
      { type: "Subheadline", question_id: "s1", props: { text: HOSTILE } },
      DESIGN,
    );
    const viaCtx = renderSectionComponents([S_BOUND], DESIGN, ctx("H", HOSTILE));
    expect(viaCtx).toBe(questionCard(viaProps));
    expect(viaCtx).not.toContain("<script>");
  });
});
