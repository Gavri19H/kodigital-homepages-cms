// P1 hidden-attribute vs author-display regression (product-core P1a).
//
// THE DEFECT this pins against: the runtime hides conditionally-shown
// components by TOGGLING the boolean `hidden` attribute (render.ts
// applyComponentVisibility / setBackVisible / updateFooterVisibility, plus the
// SSR-baked `hidden` on the [data-lg-banners] mount, [data-lg-other-panel] and
// a show_on:"final" footer). The UA sheet's `[hidden]{display:none}` is
// specificity (0,1,0); EVERY author rule in funnelChromeCss carries the scope
// attribute + at least one class, i.e. (0,2,0)+, so an author `display:` rule
// OUTRANKS the UA rule. A conditionally-hidden ButtonAnswerGroup /
// MultiChoiceCardGroup (`.lg-answer-group`/`.lg-card-grid` `display:grid`) or a
// hidden Back affordance (`.lg-back` `display:inline-flex`) therefore rendered
// VISIBLE on a live funnel (the leadgen-live-funnel dependency-HIDE assertion
// resolved `<div hidden class="lg-answer-group">` yet toBeHidden() saw it
// visible).
//
// THE FIX (styles.ts, LAST in the base sheet): one terminal scoped rule
// `${scope} [hidden]{display:none}`. At the SAME (0,2,0) specificity as every
// force-visible rule, LATER source order wins, so `hidden` beats
// `display:grid|inline-flex|…` for any scoped descendant.
//
// WHY A HAND CASCADE RESOLVER (not getComputedStyle): the vitest environment
// is "node" (vitest.config.ts) and jsdom/happy-dom/linkedom are NOT installed
// (supply-chain: no new deps). Per the slice's stated fallback, the computed
// display is resolved by a faithful author-sheet cascade over the REAL producer
// markup (renderComponent) + the REAL generated stylesheet (funnelChromeCss):
// specificity then source order — exactly what a browser does for `display`
// on these author rules (no inheritance/initial subtleties for display). The
// live browser gesture is additionally proven by leadgen-live-funnel.spec.ts
// (real Chromium toBeHidden on a hidden ButtonAnswerGroup).
//
// FAIL-BEFORE (unfixed styles.ts): with no terminal rule the ONLY display rule
// matching a hidden `.lg-answer-group` is `.lg-answer-group{display:grid}`, so
// winningDisplay() returns "grid" and every "computed hidden" case below is
// RED. Reproduce by deleting the terminal `[hidden]` rule from styles.ts.

import { describe, expect, it } from "vitest";
import { renderComponent } from "../src/public/leadgen/components/presets";
import { defaultFunnelDesign } from "../src/public/leadgen/designs/default-funnel/tokens";
import {
  funnelChromeCss,
  DEFAULT_FUNNEL_SCOPE,
} from "../src/public/leadgen/designs/default-funnel/styles";
import type { LeadgenComponentNode } from "../src/public/leadgen/components/content-schema";

const DESIGN = defaultFunnelDesign;
const SCOPE = DEFAULT_FUNNEL_SCOPE; // [data-funnel-design="default-funnel"]

// ---------------------------------------------------------------------------
// Minimal, faithful author-sheet cascade resolver for a FLAT scoped element
// (an element that is some descendant of the funnel scope root). funnelChromeCss
// joins one rule PER LINE (out.filter().join("\n")), so line-splitting yields
// exactly one `selector{body}` per line — no brace-nesting parser needed. Uses
// String#match / #matchAll only (never RegExp#exec).
// ---------------------------------------------------------------------------

interface El {
  tag: string;
  classes: Set<string>;
  attrs: Map<string, string | null>;
}
type Spec = [number, number, number]; // [id, class+attr, type]

function splitSheet(css: string): { baseLines: string[]; mediaLines: string[] } {
  const mediaStart = css.indexOf("\n@media");
  const base = mediaStart >= 0 ? css.slice(0, mediaStart) : css;
  let mediaInner = "";
  if (mediaStart >= 0) {
    const block = css.slice(mediaStart);
    const open = block.indexOf("{");
    mediaInner = block.slice(open + 1, block.lastIndexOf("}"));
  }
  return { baseLines: base.split("\n"), mediaLines: mediaInner.split("\n") };
}

function parseRule(line: string): { selectors: string[]; decls: Map<string, string> } | null {
  const t = line.trim();
  if (t === "" || t.startsWith("@")) return null;
  const m = t.match(/^(.+?)\{(.*)\}$/);
  if (m === null) return null;
  const selectors = m[1]!.split(",").map((s) => s.trim());
  const decls = new Map<string, string>();
  for (const d of m[2]!.split(";")) {
    const i = d.indexOf(":");
    if (i > 0) decls.set(d.slice(0, i).trim(), d.slice(i + 1).trim());
  }
  return { selectors, decls };
}

// Specificity of a single selector IF it matches the flat element `el`, else
// null. Only scope-prefixed single-descendant compounds can match a flat
// descendant element; anything with a further combinator (space/>/+/~), a
// pseudo (:), or a compound glued to the scope with no space (the ROOT element)
// cannot match `el` and is rejected.
function specIfMatch(selector: string, el: El): Spec | null {
  if (!selector.startsWith(SCOPE)) return null;
  const rest = selector.slice(SCOPE.length);
  if (!rest.startsWith(" ")) return null; // compound-on-root, not our descendant
  const compound = rest.slice(1);
  if (compound === "" || /[ >+~:]/.test(compound)) return null; // extra combinator/pseudo
  const spec: Spec = [0, 1, 0]; // scope attribute
  let pos = 0;
  if (!compound.startsWith(".") && !compound.startsWith("[")) {
    const typeM = compound.match(/^[a-zA-Z][a-zA-Z0-9-]*/);
    if (typeM === null) return null;
    if (el.tag.toLowerCase() !== typeM[0].toLowerCase()) return null;
    spec[2] += 1;
    pos = typeM[0].length;
  }
  while (pos < compound.length) {
    const tok = compound
      .slice(pos)
      .match(/^(?:\.([A-Za-z0-9_-]+)|\[([A-Za-z0-9_-]+)(?:([~|^$*]?=)"([^"]*)")?\])/);
    if (tok === null) return null; // unsupported token → not a flat match
    pos += tok[0].length;
    if (tok[1] !== undefined) {
      if (!el.classes.has(tok[1])) return null;
      spec[1] += 1;
    } else {
      const name = tok[2]!;
      if (!el.attrs.has(name)) return null;
      if (tok[3] === "=" && el.attrs.get(name) !== tok[4]) return null;
      spec[1] += 1;
    }
  }
  return spec;
}

function cmp(a: Spec, oA: number, b: Spec, oB: number): number {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
  return oA - oB; // later source order wins the tie
}

// The winning `display` value the cascade computes for `el` over `lines`.
function winningDisplay(lines: string[], el: El): string | undefined {
  let best: { spec: Spec; order: number; display: string } | null = null;
  lines.forEach((line, order) => {
    const r = parseRule(line);
    if (r === null) return;
    const display = r.decls.get("display");
    if (display === undefined) return;
    for (const sel of r.selectors) {
      const spec = specIfMatch(sel, el);
      if (spec === null) continue;
      if (best === null || cmp(spec, order, best.spec, best.order) > 0) {
        best = { spec, order, display };
      }
    }
  });
  return best === null ? undefined : (best as { display: string }).display;
}

// Parse the ROOT element (tag + classes + attrs) of a rendered component, then
// stamp `hidden` exactly as the runtime's setAttribute("hidden","") would.
function renderedHiddenRoot(node: LeadgenComponentNode): El {
  const html = renderComponent(node, DESIGN).trim();
  const m = html.match(/^<([a-zA-Z][\w-]*)\s*([^>]*)>/);
  if (m === null) throw new Error(`no root tag in render: ${html.slice(0, 120)}`);
  const classes = new Set<string>();
  const attrs = new Map<string, string | null>();
  for (const a of m[2]!.matchAll(/([a-zA-Z_:][\w:.-]*)(?:="([^"]*)")?/g)) {
    const name = a[1]!;
    const val = a[2] ?? null;
    if (name === "class" && val !== null) {
      for (const c of val.split(/\s+/)) if (c !== "") classes.add(c);
    } else {
      attrs.set(name, val);
    }
  }
  attrs.set("hidden", ""); // runtime: applyComponentVisibility / setBackVisible
  return { tag: m[1]!, classes, attrs };
}

const buttonAnswerGroup: LeadgenComponentNode = {
  type: "ButtonAnswerGroup",
  question_id: "q_bag",
  internal_field: "prior",
  answer_type: "string",
  props: {},
  choices: [
    { value: "a", label: "A" },
    { value: "b", label: "B" },
  ],
} as unknown as LeadgenComponentNode;

const multiChoiceCardGroup: LeadgenComponentNode = {
  type: "MultiChoiceCardGroup",
  question_id: "q_mc",
  internal_field: "features",
  answer_type: "array",
  choices: [
    { value: "a", label: "A" },
    { value: "b", label: "B" },
  ],
  props: { min: 1, max: 2 },
} as unknown as LeadgenComponentNode;

const backButton: LeadgenComponentNode = {
  type: "BackButton",
  question_id: "q_back",
  props: { label: "Back" },
} as unknown as LeadgenComponentNode;

// ===========================================================================

describe("P1 hidden-attribute visibility (author `display` must not beat `hidden`)", () => {
  const css = funnelChromeCss(DESIGN);
  const { baseLines, mediaLines } = splitSheet(css);
  const TERMINAL = `${SCOPE} [hidden]{display:none}`;

  it("meta: the rendered roots are the hideable component classes (real producer output)", () => {
    // Guards the fixtures: if a preset ever wrapped these in an outer element,
    // the cascade check below would silently test the wrong node.
    expect(renderedHiddenRoot(buttonAnswerGroup).classes.has("lg-answer-group")).toBe(true);
    const card = renderedHiddenRoot(multiChoiceCardGroup);
    expect(card.classes.has("lg-card-grid")).toBe(true);
    expect(card.classes.has("lg-multi")).toBe(true);
    expect(renderedHiddenRoot(backButton).classes.has("lg-back")).toBe(true);
  });

  it("RULE PIN: the terminal `[hidden]{display:none}` guard is emitted in the base sheet", () => {
    expect(css).toContain(TERMINAL);
    // It lives in the base sheet (before the mobile @media block), so it wins
    // for the desktop live-funnel path AND is inherited by mobile (no mobile
    // rule re-shows a hideable class — asserted separately below).
    expect(baseLines.some((l) => l.trim() === TERMINAL)).toBe(true);
  });

  it("SOURCE ORDER: the guard is emitted AFTER every force-visible display rule it must beat", () => {
    const term = css.indexOf(TERMINAL);
    expect(term).toBeGreaterThan(-1);
    // The three (0,2,0) force-visible-when-hidden surfaces the cascade audit found.
    for (const forcer of [
      `${SCOPE} .lg-answer-group{display:grid`,
      `${SCOPE} .lg-card-grid{display:grid`,
      `${SCOPE} .lg-back{`,
    ]) {
      const at = css.indexOf(forcer);
      expect(at, `force-visible rule present: ${forcer}`).toBeGreaterThan(-1);
      expect(term, `terminal after ${forcer}`).toBeGreaterThan(at);
    }
  });

  it("COMPUTED (base sheet): a hidden ButtonAnswerGroup resolves display:none", () => {
    expect(winningDisplay(baseLines, renderedHiddenRoot(buttonAnswerGroup))).toBe("none");
  });

  it("COMPUTED (base sheet): a hidden MultiChoiceCardGroup resolves display:none", () => {
    expect(winningDisplay(baseLines, renderedHiddenRoot(multiChoiceCardGroup))).toBe("none");
  });

  it("COMPUTED (base sheet): a hidden Back affordance resolves display:none", () => {
    expect(winningDisplay(baseLines, renderedHiddenRoot(backButton))).toBe("none");
  });

  it("MOBILE SAFETY: no @media rule re-shows any hidden hideable class", () => {
    // Over the mobile block ALONE, no display rule may force a hidden hideable
    // element visible — so the base terminal display:none holds at every width.
    for (const node of [buttonAnswerGroup, multiChoiceCardGroup, backButton]) {
      const d = winningDisplay(mediaLines, renderedHiddenRoot(node));
      expect([undefined, "none"]).toContain(d);
    }
  });

  it("resolver self-check: WITHOUT the terminal rule a hidden answer-group resolves display:grid", () => {
    // Proves the resolver actually observes the defect (guards a vacuous PASS):
    // strip the terminal line and the force-visible grid rule wins again.
    const stripped = baseLines.filter((l) => l.trim() !== TERMINAL);
    expect(stripped.length).toBe(baseLines.length - 1);
    expect(winningDisplay(stripped, renderedHiddenRoot(buttonAnswerGroup))).toBe("grid");
  });
});
