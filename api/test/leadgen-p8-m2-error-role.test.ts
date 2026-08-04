// R2 P8 M2 / S3.9 — THE ERROR COLOUR ROLE, AND A RULE THAT CAN NEVER MATCH.
//
// THE OWNER'S WORDS: "theme is only design language!!!! colors, fonts, sizes"
// (docs/leadgen/source-of-truth/SOURCE-OF-TRUTH.md). CONTRACT M2/R3: "Every one
// of the 80 keys either governs a measurable painted value on a visible
// element, or is removed from the UI. A control that cannot be honoured must
// not be offered."
//
// WHAT WAS MEASURED AT HEAD, BY HAND:
//   `grep -rn "data-error" src/` = 19 hits, and NOT ONE writes the attribute:
//   16 are the unrelated admin `data-error-for` slot id, 1 is
//   render-error.ts's `data-error-status`, and the last 2 ARE the two rules
//   that read it — styles.ts:282 `.lg-tscard[data-error="true"]` (color.error)
//   and styles.ts:1720 `.lg-card[data-error="true"]`
//   (iconCard.errorBorderColor). The `error` role therefore reached only those
//   two unreachable rules plus the unread `--lg-error` custom property
//   (styles.ts:501): an offered "Error" colour ("Error", used_by "validation
//   errors" — ROLE_META quotes-tabs/shared.ts:462) that painted nothing a
//   visitor can ever see.
//
// THE REAL ERROR STATE (runtime/render.ts:228 setFieldError, called by engine.ts
// on a failed validation) fills the `[data-lg-error-for="…"]` slot, adds
// ERROR_CLASS ("lg-error") to the owning `[data-lg-field]` block, and sets
// `aria-invalid="true"` on that block's `[data-lg-input]`. The rules that match
// THAT state read frozen "#D32F2F" copies of color.error:
//   `.lg-input[aria-invalid="true"]` <- input.errorBorderColor (styles.ts:1834)
//   `.lg-error`                      <- validation.errorTextColor (styles.ts:1882,
//                                       also written INLINE on the slot by the
//                                       renderer itself, presets.ts:333)
// Same cause as the success / card_background siblings; same additive fix
// (theme.ts applyErrorRole).
//
// HOW THIS FILE AVOIDS E10/E11 (a test that hand-builds BOTH sides). Nothing
// below is hand-written. The section markup is whatever renderSectionComponents
// emits; the ERROR STATE on top of it is applied by REAL PRODUCT CODE —
// `applyPreviewSimMarkup` (admin/leadgen/preview-sim.ts:354), the shipped
// producer behind the Studio's `sim: {state:"error"}` preview, whose
// markErrorInSlice (:248) is the documented setFieldError mirror and which is
// verified below to emit exactly the two attributes render.ts:228 sets; the
// stylesheet is whatever funnelChromeCss emits for the real resolveTokens
// output; and the winning declaration is resolved by the author-sheet cascade
// lifted from leadgen-p8-m2-palette-roles.test.ts (vitest's environment is
// "node"; jsdom/happy-dom are NOT installed — no-new-deps).
//
// WHY THE MIRROR AND NOT runtime/render.ts ITSELF: that module is DOM-lib
// browser code. A test importing it must be hand-listed in
// tsconfig.runtime.json's `include` AND tsconfig.json's `exclude` (the 4 such
// suites are listed there by name); both files are outside this slice's owned
// set, so this file uses the in-program mirror instead — the same choice, with
// the same note, that leadgen-p5-tail-round.test.ts:10 already documents.
// Reported to the conductor, not decided here.
//
// FAIL-BEFORE (measured by commenting out theme.ts's
// `if (authoredRoles.has("error")) applyErrorRole(...)` line):
//   `npx vitest run test/leadgen-p8-m2-error-role.test.ts` -> 6 failed | 10
//   passed (16), exit 1. Every I1 leg failed, all on the SAME symptom — the
//   authored colour never arrived at the state the runtime produces:
//     .lg-input[aria-invalid="true"] border-color  expected '#D32F2F' to be '#123456'
//     ERROR_CLASS block colour (address)           expected '#D32F2F' to be '#123456'
//     ERROR_CLASS block colour (free text)         expected '#D32F2F' to be '#123456'
//     message-slot inline colour (renderer)        expected '#D32F2F' to be '#123456'
//     role alias error:'brand_primary'             expected '#D32F2F' to be '#1B3A5C'
//     frozen-copy enumeration                      ['color.error'] vs the 4 real slots
// PASS-AFTER (applier restored): 16 passed (16), exit 0.
//
// NOT FIXED HERE — REPORTED (outside this slice's owned files):
//   • The two `[data-error="true"]` rules are still emitted and still
//     unreachable. Disposing of them (re-point or remove) changes the DEFAULT
//     stylesheet, which is byte-pinned in fixtures this slice does not own
//     (test/fixtures/leadgen-legacy-pin/legacy-shell.html carries
//     `.lg-card[data-error="true"]{border-color:#D32F2F}` verbatim, compared
//     with toBe by test/leadgen-frame-legacy-pin.test.ts). Nothing here invents
//     a `data-error` producer to make them reachable.
//   • render.ts:228 resolves the input with `fieldEl.querySelector(...)`, so on
//     the shape where the field block IS the input (FreeTextQuestion renders
//     data-lg-field and data-lg-input on the same <input>) the live runtime
//     sets NO aria-invalid and the red border never appears — only ERROR_CLASS
//     lands. preview-sim.ts:256 handles that shape explicitly, so the two
//     diverge. This file therefore asserts only what BOTH produce for that
//     shape (the ERROR_CLASS colour), never the border.
//
// FIXED in P8-5 (register ADJ-P8-22) — this header used to report, and a test
// below used to pin, that preview-sim filled the message slot without
// removing `hidden`. That is no longer true: preview-sim's upsertErrorMessage
// now drops `hidden` when it fills the slot (matching runtime/render.ts's
// setFieldError, which already unhides it live), so the Studio preview no
// longer writes the copy into a hidden element. Verified:
// `npx vitest run test/leadgen-p8-m2-error-role.test.ts` -> 16 passed (16).

import { describe, expect, it } from "vitest";

import { applyPreviewSimMarkup, PREVIEW_REQUIRED_MESSAGE } from "../src/admin/leadgen/preview-sim";
import { renderSectionComponents } from "../src/public/leadgen/components/presets";
import type { LeadgenComponentNode } from "../src/public/leadgen/components/content-schema";
import { DEFAULT_FUNNEL_SCOPE, funnelChromeCss } from "../src/public/leadgen/designs/default-funnel/styles";
import { defaultFunnelDesign } from "../src/public/leadgen/designs/default-funnel/tokens";
import { resolveTokens } from "../src/public/leadgen/designs/theme";
import type { ThemeJson } from "../src/public/leadgen/designs/theme";

const BASE = defaultFunnelDesign;
const SCOPE = DEFAULT_FUNNEL_SCOPE; // [data-funnel-design="default-funnel"]

// ERROR_CLASS's value, restated here because runtime/render.ts cannot be
// imported into this typecheck program (see the header). render.ts:20 is the
// definition; preview-sim.ts:255 writes the same literal.
const ERROR_CLASS = "lg-error";

// The two arms every colour leg flips between (the sibling sweep's own values).
const A = "#123456";
const B = "#ee7733";

const error = (value: string): ThemeJson => ({ palette: { error: value } });

// ---------------------------------------------------------------------------
// The REAL producer chain. The nodes are ordinary authored components: the
// address question is the shape where `[data-lg-field]` WRAPS its
// `[data-lg-input]` (so the error state's aria-invalid lands on a real
// .lg-input, exactly as the live runtime does); the free-text question is the
// shape where the two hooks are the SAME element.
// ---------------------------------------------------------------------------

const PROBE_NODES: LeadgenComponentNode[] = [
  {
    type: "FreeTextQuestion",
    question_id: "s39_text",
    question_key: "s39",
    internal_field: "s39",
    required: true,
  },
  {
    type: "AddressAutocompleteQuestion",
    question_id: "s39_addr",
    question_key: "addr",
    internal_field: "addr",
    answer_type: "object",
    required: true,
  },
] as unknown as LeadgenComponentNode[];

interface Painted {
  design: ReturnType<typeof resolveTokens>["design"];
  css: string;
  html: string;
  errorHtml: string;
}

function paint(theme: ThemeJson): Painted {
  const tokens = resolveTokens(BASE, theme, null, null);
  const design = tokens.design as typeof BASE;
  const css = funnelChromeCss(design, SCOPE, { frameRegions: true });
  const html = renderSectionComponents(PROBE_NODES, design, {
    headline_text: "",
    subheadline_text: null,
    theme_controls: tokens.theme_controls,
  });
  // THE STATE SEAM: the real product's own error-state producer over the real
  // rendered markup. No answers ⇒ every required field is the unanswered-
  // required case the visitor hits by clicking Continue on an empty question.
  const errorHtml = applyPreviewSimMarkup(html, PROBE_NODES, design, {
    state: "error",
    markSelection: false,
    answers: {},
    visibleIds: null,
    requiredNow: null,
  });
  return { design: tokens.design, css, html, errorHtml };
}

// ---------------------------------------------------------------------------
// A read-only element tree over real markup — just enough to FIND the element
// the error state marked and hand it to the cascade. It carries no rendering
// opinion and never invents an attribute.
// ---------------------------------------------------------------------------

type Spec = [number, number, number]; // [id, class+attr, type]

const VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

interface El {
  tag: string;
  classes: Set<string>;
  attrs: Map<string, string | null>;
  children: El[];
}

function elementFrom(tag: string, rawAttrs: string): El {
  const classes = new Set<string>();
  const attrs = new Map<string, string | null>();
  for (const a of rawAttrs.matchAll(/([a-zA-Z_:][\w:.-]*)(?:="([^"]*)")?/g)) {
    const name = a[1] as string;
    const value = a[2] ?? null;
    if (name === "class" && value !== null) {
      for (const c of value.split(/\s+/)) if (c !== "") classes.add(c);
    } else {
      attrs.set(name, value);
    }
  }
  return { tag, classes, attrs, children: [] };
}

// Void elements never open a scope, so `[data-lg-field]` wrappers keep their
// REAL containment (which is what makes "the input inside the marked block" a
// faithful question to ask).
function parseTree(html: string): El {
  const root: El = { tag: "section", classes: new Set(), attrs: new Map(), children: [] };
  const stack: El[] = [root];
  for (const m of html.matchAll(/<(\/?)([a-zA-Z][\w-]*)((?:[^>"]|"[^"]*")*)>/g)) {
    const tag = (m[2] as string).toLowerCase();
    if (m[1] === "/") {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const raw = m[3] as string;
    const el = elementFrom(tag, raw);
    (stack[stack.length - 1] as El).children.push(el);
    if (!VOID_TAGS.has(tag) && !raw.trimEnd().endsWith("/")) stack.push(el);
  }
  expect(stack.length, "the probe markup is balanced (every open tag closed)").toBe(1);
  return root;
}

function descendants(el: El): El[] {
  const out: El[] = [];
  for (const child of el.children) {
    out.push(child);
    out.push(...descendants(child));
  }
  return out;
}

function attrMatch(el: El, name: string, value?: string): boolean {
  if (!el.attrs.has(name)) return false;
  return value === undefined || (el.attrs.get(name) ?? "") === value;
}

// THE E10 GUARD: the element must come out of the REAL markup. Nothing found ⇒
// THROW, so a declaration can never be credited to a selector nothing renders.
function findByAttr(root: El, name: string, value?: string): El {
  const hit = descendants(root).find((el) => attrMatch(el, name, value));
  if (hit === undefined) {
    throw new Error(`the REAL rendered page has no [${name}${value === undefined ? "" : `="${value}"`}]`);
  }
  return hit;
}

// ---------------------------------------------------------------------------
// Author-sheet cascade over the REAL sheet + a REAL element, lifted verbatim
// from leadgen-p8-m2-palette-roles.test.ts (same node-env constraint).
// ---------------------------------------------------------------------------

function baseLines(css: string): string[] {
  const mediaStart = css.indexOf("\n@media");
  return (mediaStart >= 0 ? css.slice(0, mediaStart) : css).split("\n");
}

function parseRule(line: string): { selectors: string[]; decls: Map<string, string> } | null {
  const t = line.trim();
  if (t === "" || t.startsWith("@")) return null;
  const m = t.match(/^(.+?)\{(.*)\}$/);
  if (m === null) return null;
  const decls = new Map<string, string>();
  for (const d of (m[2] as string).split(";")) {
    const i = d.indexOf(":");
    if (i > 0) decls.set(d.slice(0, i).trim(), d.slice(i + 1).trim());
  }
  return { selectors: (m[1] as string).split(",").map((s) => s.trim()), decls };
}

function specIfMatch(selector: string, el: El): Spec | null {
  if (!selector.startsWith(SCOPE)) return null;
  const rest = selector.slice(SCOPE.length);
  if (!rest.startsWith(" ")) return null; // compound-on-root, not our descendant
  const compound = rest.slice(1);
  if (compound === "" || /[ >+~:]/.test(compound)) return null; // combinator/pseudo
  const spec: Spec = [0, 1, 0]; // the scope attribute
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
    if (tok === null) return null;
    pos += tok[0].length;
    if (tok[1] !== undefined) {
      if (!el.classes.has(tok[1])) return null;
      spec[1] += 1;
    } else {
      const name = tok[2] as string;
      if (!el.attrs.has(name)) return null;
      if (tok[3] === "=" && el.attrs.get(name) !== tok[4]) return null;
      spec[1] += 1;
    }
  }
  return spec;
}

function cmp(a: Spec, oA: number, b: Spec, oB: number): number {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return (a[i] as number) - (b[i] as number);
  return oA - oB; // later source order wins the tie
}

interface Win {
  spec: Spec;
  order: number;
  value: string;
  selector: string;
}

function winning(css: string, el: El, property: string): { value: string; selector: string } | undefined {
  const lines = baseLines(css);
  let best: Win | undefined;
  for (let order = 0; order < lines.length; order++) {
    const r = parseRule(lines[order] as string);
    if (r === null) continue;
    const value = r.decls.get(property);
    if (value === undefined) continue;
    for (const sel of r.selectors) {
      const spec = specIfMatch(sel, el);
      if (spec === null) continue;
      if (best === undefined || cmp(spec, order, best.spec, best.order) > 0) {
        best = { spec, order, value, selector: sel };
      }
    }
  }
  return best === undefined ? undefined : { value: best.value, selector: best.selector };
}

// The value the REAL renderer put in the element's own inline `style`.
function inlineDecl(el: El, property: string): string | undefined {
  const style = el.attrs.get("style");
  if (style === undefined || style === null) return undefined;
  for (const d of style.split(";")) {
    const i = d.indexOf(":");
    if (i > 0 && d.slice(0, i).trim() === property) return d.slice(i + 1).trim();
  }
  return undefined;
}

// --- the elements the error state marks, taken out of the REAL error markup --

// The .lg-input the state marked with aria-invalid, inside the address field
// block (the wrapper shape — the one where the live runtime agrees).
function invalidInput(painted: Painted): El {
  const wrap = findByAttr(parseTree(painted.errorHtml), "data-lg-field", "addr_street");
  const input = findByAttr(wrap, "data-lg-input");
  expect(input.classes.has("lg-input"), "the marked input is the real .lg-input").toBe(true);
  expect(input.attrs.get("aria-invalid")).toBe("true");
  return input;
}

// The block the state marked with ERROR_CLASS.
function erroredBlock(painted: Painted, field: string): El {
  const block = findByAttr(parseTree(painted.errorHtml), "data-lg-field", field);
  expect(block.classes.has(ERROR_CLASS), `${field} carries ERROR_CLASS`).toBe(true);
  return block;
}

// The message slot the state filled (its colour is the renderer's own inline
// declaration — a real artifact independent of the state producer).
function messageSlot(painted: Painted, field: string): El {
  return findByAttr(parseTree(painted.errorHtml), "data-lg-error-for", field);
}

// ---------------------------------------------------------------------------
// 0. The ground truth every leg below stands on: the state producer really does
//    emit the attributes the live runtime sets, on real elements of the page.
// ---------------------------------------------------------------------------

describe("R2 P8 M2 S3.9 — the error state markup carries what render.ts:228 sets", () => {
  const painted = paint({});

  it("the error state adds ERROR_CLASS to the field block and aria-invalid to its .lg-input", () => {
    const before = parseTree(painted.html);
    expect(findByAttr(before, "data-lg-field", "addr").classes.has(ERROR_CLASS)).toBe(false);
    expect(findByAttr(before, "data-lg-input").attrs.has("aria-invalid")).toBe(false);

    // …and after the real producer ran (both assertions live inside these two).
    erroredBlock(painted, "addr");
    invalidInput(painted);
    expect(messageSlot(painted, "addr").children).toEqual([]);
  });

  it("the slot the producer filled carries the required-copy the runtime shows", () => {
    expect(painted.errorHtml).toContain(`data-lg-error-for="addr"`);
    expect(painted.errorHtml).toContain(PREVIEW_REQUIRED_MESSAGE);
    // FIXED in P8-5 (register ADJ-P8-22), true now: preview-sim's
    // upsertErrorMessage drops `hidden` when it fills the slot, matching
    // runtime/render.ts's setFieldError (which already unhides it live), so
    // the Studio preview no longer writes the copy into a hidden element.
    // Verified: `npx vitest run test/leadgen-p8-m2-error-role.test.ts` -> 16
    // passed (16), exit 0.
    expect(messageSlot(painted, "addr").attrs.has("hidden")).toBe(false);
  });

  it("the finder throws for markup the page does not render (it cannot credit an absent element)", () => {
    expect(() => findByAttr(parseTree(painted.html), "data-lg-field", "not_a_field")).toThrow(
      /has no \[data-lg-field/,
    );
  });

  it("the probe sheet parses under the flat-cascade assumptions (one rule per line)", () => {
    expect(painted.css).not.toContain("@font-face");
    expect(winning(painted.css, invalidInput(painted), "border-color")?.selector).toBe(
      `${SCOPE} .lg-input[aria-invalid="true"]`,
    );
  });
});

// ---------------------------------------------------------------------------
// I1 — an authored `error` role paints the error state a visitor really gets.
// ---------------------------------------------------------------------------

describe("R2 P8 M2 S3.9 I1 — palette.error paints 'validation errors' (its own ROLE_META promise)", () => {
  const inputBorder = (theme: ThemeJson): string | undefined => {
    const painted = paint(theme);
    return winning(painted.css, invalidInput(painted), "border-color")?.value;
  };

  const blockColour = (theme: ThemeJson, field: string): string | undefined => {
    const painted = paint(theme);
    return winning(painted.css, erroredBlock(painted, field), "color")?.value;
  };

  it(`error ${A} -> ${B} moves the border-color of the aria-invalid input`, () => {
    expect(inputBorder(error(A))).toBe(A);
    expect(inputBorder(error(B))).toBe(B);
    expect(inputBorder(error(A))).not.toBe(inputBorder(error(B)));
    // …and at base the same element still carries the base error red, so the
    // move above is a real departure, not a value that was already there.
    expect(inputBorder({})).toBe(BASE.input.errorBorderColor);
    expect(BASE.input.errorBorderColor).toBe("#D32F2F");
  });

  it(`error ${A} -> ${B} moves the colour of the block ERROR_CLASS marks`, () => {
    expect(blockColour(error(A), "addr")).toBe(A);
    expect(blockColour(error(B), "addr")).toBe(B);
    expect(blockColour({}, "addr")).toBe(BASE.validation.errorTextColor);
  });

  it("the free-text shape moves too — there the mark lands on the INPUT itself", () => {
    // MEASURED, not assumed: FreeTextQuestion renders data-lg-field and
    // data-lg-input on the SAME <input>, so the live runtime's
    // fieldEl.querySelector("[data-lg-input]") finds no descendant and only
    // ERROR_CLASS lands (see the header). Only the ERROR_CLASS colour — what
    // BOTH producers agree on for this shape — is asserted here; never a
    // border this shape may not get.
    const block = erroredBlock(paint({}), "s39");
    expect(block.classes.has("lg-input"), "the marked element IS the input").toBe(true);
    expect(blockColour(error(A), "s39")).toBe(A);
    expect(blockColour(error(B), "s39")).toBe(B);
    expect(blockColour({}, "s39")).toBe(BASE.validation.errorTextColor);
  });

  it("the message slot the RENDERER styles inline moves too (a second real artifact, not the sheet)", () => {
    expect(inlineDecl(messageSlot(paint(error(A)), "addr"), "color")).toBe(A);
    expect(inlineDecl(messageSlot(paint(error(B)), "addr"), "color")).toBe(B);
    expect(inlineDecl(messageSlot(paint({}), "addr"), "color")).toBe(BASE.validation.errorTextColor);
  });

  it("NO FROZEN COPY LEFT BEHIND: every base token that IS the error colour moves with the role", () => {
    // The cause this slice fixes is "the design froze copies of the role colour
    // into component slots". This enumerates those copies out of the REAL base
    // design (never a hand-written list) and requires the role to move ALL of
    // them — so a future frozen copy fails here instead of shipping dead.
    const frozen = (design: Record<string, unknown>, needle: string): string[] => {
      const out: string[] = [];
      for (const [g, group] of Object.entries(design)) {
        if (typeof group !== "object" || group === null) continue;
        for (const [k, v] of Object.entries(group as Record<string, unknown>)) {
          if (typeof v === "string" && (v === needle || v === `1px solid ${needle}`)) out.push(`${g}.${k}`);
        }
      }
      return out.sort();
    };

    const atBase = frozen(BASE as unknown as Record<string, unknown>, BASE.color.error);
    expect(atBase).toEqual([
      "color.error",
      "iconCard.errorBorderColor",
      "input.errorBorderColor",
      "validation.errorTextColor",
    ]);

    const themed = paint(error(A)).design as unknown as Record<string, unknown>;
    expect(frozen(themed, A)).toEqual(atBase);
    expect(frozen(themed, BASE.color.error)).toEqual([]);
  });

  it("a role ALIAS value resolves the same way (error: 'brand_primary')", () => {
    const painted = paint({ palette: { error: "brand_primary" } });
    expect(winning(painted.css, invalidInput(painted), "border-color")?.value).toBe(BASE.color.primary);
  });
});

// ---------------------------------------------------------------------------
// I2 — the two `[data-error="true"]` rules, measured. This slice does NOT add a
// producer for them (that would invent a producer to justify dead CSS) and does
// NOT re-point/remove them (that changes byte-pinned CSS in unowned fixtures —
// see the header). What is pinned here is the MEASUREMENT that settles it.
// ---------------------------------------------------------------------------

describe("R2 P8 M2 S3.9 I2 — the real error state and the [data-error] rules never meet", () => {
  it("the REAL error-state markup sets no data-error attribute anywhere on the page", () => {
    const painted = paint({});
    const tree = parseTree(painted.errorHtml);
    expect(descendants(tree).filter((el) => el.attrs.has("data-error")).map((el) => el.tag)).toEqual([]);
    expect(painted.errorHtml).not.toMatch(/\sdata-error=/);
    expect(painted.html).not.toMatch(/\sdata-error=/);
  });

  it("the role still reaches its own base token, so nothing that already read color.error regressed", () => {
    expect(resolveTokens(BASE, error(A)).design.color.error).toBe(A);
    expect(paint(error(A)).css).toContain(`--lg-error:${A}`);
  });
});

// ---------------------------------------------------------------------------
// I3 — only an AUTHORED role changes anything.
// ---------------------------------------------------------------------------

describe("R2 P8 M2 S3.9 I3 — the applier is opt-in (an untouched funnel is byte-identical)", () => {
  const bare = funnelChromeCss(BASE, SCOPE, { frameRegions: true });
  const bareHtml = renderSectionComponents(PROBE_NODES, BASE, {
    headline_text: "",
    subheadline_text: null,
  });

  it("no theme, an empty theme, and an empty palette emit the SAME stylesheet + markup bytes as the raw base design", () => {
    for (const theme of [{}, { version: 1 } as ThemeJson, { palette: {} } as ThemeJson]) {
      const { css, html } = paint(theme);
      expect(css).toBe(bare);
      expect(html).toBe(bareHtml);
    }
    expect(resolveTokens(BASE).design).toEqual(BASE);
    expect(resolveTokens(BASE, {}).design).toEqual(BASE);
  });

  it("the unauthored default red is still exactly what paints the error state", () => {
    expect(bare).toContain(`${SCOPE} .lg-input[aria-invalid="true"]{border-color:#D32F2F}`);
    expect(bare).toContain(`${SCOPE} .lg-error{color:#D32F2F`);
    expect(bareHtml).toContain('style="color:#D32F2F"');
  });

  it("a theme that authors OTHER palette roles leaves every error slot at its base value", () => {
    const others: ThemeJson = { palette: { brand_primary: A, text_primary: "#111111", border: B } };
    const d = resolveTokens(BASE, others).design;
    expect(d.input).toEqual(BASE.input);
    expect(d.validation).toEqual(BASE.validation);
    expect(d.iconCard).toEqual(BASE.iconCard);
  });

  it("the error role touches ONLY its own slots (success and the card are untouched)", () => {
    const d = resolveTokens(BASE, error(A)).design;
    expect(d.successState).toEqual(BASE.successState);
    expect(d.reassuranceBadge).toEqual(BASE.reassuranceBadge);
    expect(d.trustBar).toEqual(BASE.trustBar);
    expect(d.questionCard).toEqual(BASE.questionCard);
    expect(d.validation.successColor).toBe(BASE.validation.successColor);
    expect(d.validation.helperColor).toBe(BASE.validation.helperColor);
    // …only the three error slots moved.
    expect({ ...d.input, errorBorderColor: BASE.input.errorBorderColor }).toEqual(BASE.input);
    expect({ ...d.validation, errorTextColor: BASE.validation.errorTextColor }).toEqual(BASE.validation);
    expect({ ...d.iconCard, errorBorderColor: BASE.iconCard.errorBorderColor }).toEqual(BASE.iconCard);
  });
});
