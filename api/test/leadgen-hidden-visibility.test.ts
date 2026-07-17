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
// COVERAGE NOTE (adversarial review, register PC): the cascade-resolution
// check below widens from the 3 originally-buggy surfaces to ALL 9 hideable
// surfaces the reviewer enumerated — every element render.ts's runtime EVER
// sets the `hidden` attribute on. `[hidden]` is an ATTRIBUTE selector, so the
// terminal rule already covers all 9 structurally; this test makes that
// coverage an EXPLICIT, PERMANENT assertion per surface, so a future
// force-visible rule added for ANY of them (not just the 3 that were
// historically buggy) fails here automatically, without needing its own bug
// first:
//   1. section        [data-lg-section]        showOnlySection/showCompletionState
//   2. question        [data-lg-question]        applyComponentVisibility
//   3. show-on footer  [data-show-on]             updateFooterVisibility
//   4. back            [data-lg-back]             setBackVisible
//   5. error-slot      [data-lg-error-for]        setFieldError/clearFieldErrors
//   6. other-panel     [data-lg-other-panel]      openOtherPanel (SSR-baked hidden)
//   7. banners mount   [data-lg-banners]          injectBanners (SSR-baked hidden)
//   8. runtime-notice  .lg-runtime-notice         showRuntimeNotice/hideRuntimeNotice
//   9. disclosure-panel .lg-disclosure-panel      SSR-baked hidden (presets.ts)
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
import { LG_BANNERS_MOUNT_HTML } from "../src/public/leadgen/designs/frame";
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

// ---------------------------------------------------------------------------
// Element extraction: parse an OPEN TAG substring (tag + classes + attrs).
// Shared by the root-of-render case (the 5 renderComponent-reachable
// surfaces) and the nested-in-render case (other-panel / disclosure-panel,
// whose hideable element is a CHILD of its preset's root, not the root
// itself) and the literal-shape case (section / show-on footer /
// runtime-notice, which are not renderComponent-reachable at all — their
// exact production shape is cited at each fixture instead).
// ---------------------------------------------------------------------------

function parseOpenTag(openTag: string): El {
  const m = openTag.match(/^<([a-zA-Z][\w-]*)\s*([^>]*)>$/);
  if (m === null) throw new Error(`not a valid open tag: ${openTag.slice(0, 160)}`);
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
  return { tag: m[1]!, classes, attrs };
}

// Runtime: every hide mechanism (applyComponentVisibility / setBackVisible /
// updateFooterVisibility / setFieldError / clearFieldErrors) calls
// setAttribute("hidden", "") — the SSR-baked cases (other-panel / banners /
// disclosure-panel) already carry it verbatim in their producer markup, so
// re-stamping here is idempotent for them and load-bearing for the rest.
function stampHidden(el: El): El {
  el.attrs.set("hidden", "");
  return el;
}

// The root element of a renderComponent() call IS the hideable target
// (ButtonAnswerGroup/MultiChoiceCardGroup/BackButton/ValidationError).
function renderedHiddenRoot(node: LeadgenComponentNode): El {
  const html = renderComponent(node, DESIGN).trim();
  const m = html.match(/^<[a-zA-Z][\w-]*\s*[^>]*>/);
  if (m === null) throw new Error(`no root tag in render: ${html.slice(0, 120)}`);
  return stampHidden(parseOpenTag(m[0]));
}

// The hideable target is NESTED inside the renderComponent() root
// (OtherGroupSelector's `.lg-other-panel`, DisclosureLink's
// `.lg-disclosure-panel`) — find the first open tag anywhere in the rendered
// HTML whose class list contains `className`.
function renderedHiddenNested(html: string, className: string): El {
  for (const m of html.matchAll(/<[a-zA-Z][\w-]*\s*[^>]*>/g)) {
    const classAttr = m[0].match(/class="([^"]*)"/);
    const classes = classAttr ? classAttr[1]!.split(/\s+/) : [];
    if (classes.includes(className)) return stampHidden(parseOpenTag(m[0]));
  }
  throw new Error(`no element with class "${className}" found in: ${html.slice(0, 300)}`);
}

// A precisely-cited LITERAL open-tag string for a surface with no lightweight
// renderComponent path (section / show-on footer / runtime-notice — see each
// fixture's own citation for the exact source producing this shape).
function literalHidden(openTag: string): El {
  return stampHidden(parseOpenTag(openTag));
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

// #5 error-slot: renderValidationError's ROOT IS `.lg-error` itself
// (presets.ts ~2172-2181: `<p class="lg-error" ... data-lg-error-for="...">`).
const errorSlot: LeadgenComponentNode = {
  type: "ValidationError",
  question_id: "q_err",
  internal_field: "zip",
  props: { text: "This field is required" },
} as unknown as LeadgenComponentNode;

// #6 other-panel: renderOtherGroupSelector's root is `.lg-answer-group
// .lg-other-group`; `.lg-other-panel` is a CHILD emitted by
// renderOtherGroupTail (presets.ts ~367-385) whenever choiceDisplay.
// otherGroupEnabled is true — unconditionally, regardless of how the choices
// split main/secondary.
const otherGroupSelector: LeadgenComponentNode = {
  type: "OtherGroupSelector",
  question_id: "q_other",
  internal_field: "source",
  answer_type: "enum",
  choiceDisplay: {
    mainValues: ["a", "b"],
    otherGroupEnabled: true,
    otherGroupLabel: "Other",
    searchableOther: false,
  },
  choices: [
    { value: "a", label: "A" },
    { value: "b", label: "B" },
    { value: "c", label: "C" },
  ],
} as unknown as LeadgenComponentNode;

// #9 disclosure-panel: renderDisclosureLink's root is `.lg-disclosure-wrap`;
// `.lg-disclosure-panel` is a CHILD, SSR-baked `hidden` verbatim (presets.ts
// ~458-469: `<div class="lg-disclosure-panel" hidden>`).
const disclosureLink: LeadgenComponentNode = {
  type: "DisclosureLink",
  question_id: "q_disc",
  props: { label: "Why we ask", panelHtml: "We ask for verification purposes." },
} as unknown as LeadgenComponentNode;

// #1 section: serve.ts ~581-582's literal SSR template for every
// non-first `<section data-lg-section>` — no CSS class at all, just data
// attributes (showOnlySection/showCompletionState toggle `hidden` on these).
const SECTION_OPEN_TAG =
  '<section data-lg-section data-lg-section-id="lgs_TEST00000000000000000001" data-lg-index="1" data-screen-label="02 · Q2">';

// #3 show-on footer: frame.ts's region() + renderFooterRegion (~467-490)
// compose `<div class="lg-frame-region lg-frame-footer lg-frame-footer--show-{show_on}" data-frame-region="footer" data-show-on="{show_on}">`
// (updateFooterVisibility targets [data-show-on] generically — "all" here,
// any show_on value carries the identical class+attribute shape).
const FOOTER_OPEN_TAG =
  '<div class="lg-frame-region lg-frame-footer lg-frame-footer--show-all" data-frame-region="footer" data-show-on="all">';

// #8 runtime-notice: render.ts NOTICE_CLASS = "lg-runtime-notice";
// showRuntimeNotice creates `ownerDocument.createElement("div")`, sets
// className to NOTICE_CLASS and role="alert" (~271-281).
const RUNTIME_NOTICE_OPEN_TAG = '<div class="lg-runtime-notice" role="alert">';

// ===========================================================================

describe("P1 hidden-attribute visibility (author `display` must not beat `hidden`)", () => {
  const css = funnelChromeCss(DESIGN);
  const { baseLines, mediaLines } = splitSheet(css);
  const TERMINAL = `${SCOPE} [hidden]{display:none}`;

  // The 9 hideable surfaces the adversarial review enumerated (register PC
  // coverage note). "question" keeps its original 2 concrete examples;
  // banners mount reads the SAME exported constant the runtime injects into
  // — LG_BANNERS_MOUNT_HTML, real producer output, not a re-typed guess.
  const SURFACES: Array<{ label: string; el: El }> = [
    { label: "1. section [data-lg-section]", el: literalHidden(SECTION_OPEN_TAG) },
    { label: "2. question — ButtonAnswerGroup [data-lg-question]", el: renderedHiddenRoot(buttonAnswerGroup) },
    { label: "2. question — MultiChoiceCardGroup [data-lg-question]", el: renderedHiddenRoot(multiChoiceCardGroup) },
    { label: "3. show-on footer [data-show-on]", el: literalHidden(FOOTER_OPEN_TAG) },
    { label: "4. back [data-lg-back]", el: renderedHiddenRoot(backButton) },
    { label: "5. error-slot [data-lg-error-for]", el: renderedHiddenRoot(errorSlot) },
    {
      label: "6. other-panel [data-lg-other-panel]",
      el: renderedHiddenNested(renderComponent(otherGroupSelector, DESIGN), "lg-other-panel"),
    },
    {
      label: "7. banners mount [data-lg-banners]",
      el: stampHidden(parseOpenTag(LG_BANNERS_MOUNT_HTML.match(/^<[a-zA-Z][\w-]*\s*[^>]*>/)![0])),
    },
    { label: "8. runtime-notice .lg-runtime-notice", el: literalHidden(RUNTIME_NOTICE_OPEN_TAG) },
    {
      label: "9. disclosure-panel .lg-disclosure-panel",
      el: renderedHiddenNested(renderComponent(disclosureLink, DESIGN), "lg-disclosure-panel"),
    },
  ];

  it("meta: the rendered roots are the hideable component classes (real producer output)", () => {
    // Guards the fixtures: if a preset ever wrapped these in an outer element,
    // the cascade check below would silently test the wrong node.
    expect(renderedHiddenRoot(buttonAnswerGroup).classes.has("lg-answer-group")).toBe(true);
    const card = renderedHiddenRoot(multiChoiceCardGroup);
    expect(card.classes.has("lg-card-grid")).toBe(true);
    expect(card.classes.has("lg-multi")).toBe(true);
    expect(renderedHiddenRoot(backButton).classes.has("lg-back")).toBe(true);
    expect(renderedHiddenRoot(errorSlot).classes.has("lg-error")).toBe(true);
    expect(
      renderedHiddenNested(renderComponent(otherGroupSelector, DESIGN), "lg-other-panel").classes.has(
        "lg-other-panel",
      ),
    ).toBe(true);
    expect(
      renderedHiddenNested(renderComponent(disclosureLink, DESIGN), "lg-disclosure-panel").classes.has(
        "lg-disclosure-panel",
      ),
    ).toBe(true);
    // the literal fixtures parse to the classes/attrs their citation claims.
    expect(literalHidden(SECTION_OPEN_TAG).attrs.has("data-lg-section")).toBe(true);
    expect(literalHidden(FOOTER_OPEN_TAG).classes.has("lg-frame-footer")).toBe(true);
    expect(literalHidden(FOOTER_OPEN_TAG).attrs.has("data-show-on")).toBe(true);
    expect(literalHidden(RUNTIME_NOTICE_OPEN_TAG).classes.has("lg-runtime-notice")).toBe(true);
    // LG_BANNERS_MOUNT_HTML is the SAME exported constant frame.ts composes
    // into the shell and render.ts's injectBanners() re-reveals — real output.
    expect(LG_BANNERS_MOUNT_HTML).toContain('class="lg-banners"');
    expect(LG_BANNERS_MOUNT_HTML).toContain("data-lg-banners");
    // every SURFACES entry actually carries `hidden` (the fixture contract).
    for (const s of SURFACES) expect(s.el.attrs.has("hidden"), s.label).toBe(true);
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

  // Named per-surface (it.each, the codebase's own idiom — e.g.
  // leadgen-r1-answers.test.ts) rather than one loop-based test: the vitest
  // "verbose" reporter (vitest.config.ts) prints one line PER TEST so a
  // future force-visible rule on ANY ONE surface fails with that surface's
  // OWN named line, not a generic loop failure.
  it.each(SURFACES)("COMPUTED (base sheet): $label resolves display:none", ({ el }) => {
    expect(winningDisplay(baseLines, el)).toBe("none");
  });

  it.each(SURFACES)("MOBILE SAFETY: $label is not re-shown by any @media rule", ({ el }) => {
    // Over the mobile block ALONE, no display rule may force a hidden hideable
    // element visible — so the base terminal display:none holds at every width.
    const d = winningDisplay(mediaLines, el);
    expect([undefined, "none"]).toContain(d);
  });

  it("resolver self-check: WITHOUT the terminal rule a hidden answer-group resolves display:grid", () => {
    // Proves the resolver actually observes the defect (guards a vacuous PASS):
    // strip the terminal line and the force-visible grid rule wins again.
    const stripped = baseLines.filter((l) => l.trim() !== TERMINAL);
    expect(stripped.length).toBe(baseLines.length - 1);
    expect(winningDisplay(stripped, renderedHiddenRoot(buttonAnswerGroup))).toBe("grid");
  });
});
