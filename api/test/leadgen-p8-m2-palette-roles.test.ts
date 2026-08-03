// R2 P8 M2 / S3.6 — THE TWO PALETTE ROLES THAT DID NOT PAINT WHAT THEY NAME.
//
// THE OWNER'S WORDS: "theme is only design language!!!! colors, fonts, sizes"
// (docs/leadgen/source-of-truth/SOURCE-OF-TRUTH.md). CONTRACT M2/R3: "Every one
// of the 80 keys either governs a measurable painted value on a visible
// element, or is removed from the UI. A control that cannot be honoured must
// not be offered."
//
// WHAT WAS MEASURED AT HEAD, ON THE LIVE PRODUCT, by the driven 34-key inline
// sweep (docs/leadgen/r2/evidence/p8/m2/inline-sweep-before.txt) — each key
// written through the real operator route (PUT /funnels/:id/theme) and the
// visitor page then read in a real chromium with getComputedStyle:
//
//   palette.success        DEAD          `grep -rn "color\.success\b"
//                          (line 20)     src/public/leadgen/` = exactly 2 hits,
//                                        BOTH definitions: theme.ts:93
//                                        (ROLE_TO_BASE_TOKEN) and styles.ts:500
//                                        (`--lg-success`, an unread custom
//                                        property). Zero CSS rule reads either.
//   palette.card_background MIS-TARGETED it moved `input.lg-input` 326x54
//                          (line 34)     (color.card -> styles.ts:1828) while
//                                        `.lg-question-card` 420x406 — the
//                                        element the label "Card background"
//                                        names — stayed rgb(255,255,255) on
//                                        BOTH arms.
//
// THE ONE CAUSE BEHIND BOTH: the base design FROZE COPIES of role colours into
// component token slots instead of referencing the role token, so writing the
// role left the painted component untouched. `questionCard.background` is a
// frozen "#FFFFFF" copy of `color.card`; `successState.border` /
// `successState.iconColor` / `reassuranceBadge.{border,iconColor,textColor}` /
// `trustBar.iconColor` / `validation.successColor` are frozen "#0E7C3A" copies
// of `color.success` (tokens.ts:122/124/125/158). This is the SAME cause the
// sibling fix already closed for `card_defaults.*` (theme.ts:1353-1408) — one
// cause, several authoring axes.
//
// I1 — THE ENUMERATION THE "wire it or remove it" RULING WAS MADE ON. Every
// surface in this product where a success state is rendered to a VISITOR, read
// out of source (not assumed):
//   • SuccessState  — `renderSuccessState` presets.ts:3588 emits `.lg-success`
//     + `.lg-success-icon`; styles.ts:1505/1516 paint them from
//     successState.border / successState.iconColor. Node type "SuccessState"
//     (presets.ts:4560), an authorable component.
//   • ReassuranceBadge — `renderReassuranceBadge` presets.ts:3570 emits
//     `.lg-badge` + `.lg-badge-icon`; styles.ts:1473/1484 paint them from
//     reassuranceBadge.border / .textColor / .iconColor. Node type
//     "ReassuranceBadge" (presets.ts:4558). ("reassurance" is literally the
//     first word of the role's own `used_by` — ROLE_META, shared.ts:461.)
//   • TrustBar — `renderTrustBar` presets.ts:3643 emits `.lg-trustbar-icon`;
//     styles.ts:1555 paints it from trustBar.iconColor. Node type "TrustBar"
//     (presets.ts:4564).
//   • validation.successColor — a base token with ZERO consumers in styles.ts
//     and presets.ts (readout only; it is not a rendered surface and no leg
//     below credits it with paint).
// REAL success surfaces therefore EXIST, so the ruling is WIRE, not remove:
// nothing is taken out of the theme UI, no control is added or relabelled, and
// no new success surface was invented to justify keeping the control.
//
// I3 — PRECEDENCE, decided: `card_defaults.background_role` (the explicit
// component control, quotes-tabs/themes.ts:238 "Card background") BEATS
// `palette.card_background` (the theme-wide semantic role). An operator reaches
// for the component's own control precisely to depart from the theme-wide
// colour, so the narrower control must win — and it is the same direction the
// sibling already fixed for shadow ("the explicit step beats the scale",
// theme.ts:1397-1406), so the whole file reads as ONE rule. Pinned below in
// both orders, so a flip fails.
//
// HOW THIS FILE AVOIDS THE FAILURE MODE THAT LET M2 SHIP (E10/E11). "The bytes
// changed" is the assertion a MIS-TARGETED key PASSES — palette.card_background
// did change bytes at HEAD, on the wrong element. So no leg below is a
// byte-diff. Every leg takes the STYLESHEET from the real producer chain
// (resolveTokens -> funnelChromeCss), takes the ELEMENT from the real
// renderSectionComponents markup (`elementWithClass` THROWS when the class is
// absent, so a declaration can never be credited to a selector nothing
// renders), and resolves the winner by a faithful author-sheet cascade over
// those two real artifacts. The cascade resolver is lifted verbatim from
// leadgen-p8-m2-theme-keys.test.ts (itself the leadgen-hidden-visibility.test.ts
// idiom): vitest's environment is "node" and jsdom/happy-dom are NOT installed
// (no-new-deps). The live-browser proof of these keys is the conductor's driven
// re-measurement, not this lane.
//
// FAIL-BEFORE (each assertion at unfixed HEAD, reverting the theme.ts edit):
//   I1 .lg-success border      "1px solid #0E7C3A" on BOTH arms
//   I1 .lg-success-icon color  "#0E7C3A" on BOTH arms
//   I1 .lg-badge border/color  "1px solid #0E7C3A" / "#0E7C3A" on BOTH arms
//   I1 .lg-badge-icon color    "#0E7C3A" on BOTH arms
//   I1 .lg-trustbar-icon color "#0E7C3A" on BOTH arms
//   I1 enumeration             7 of 8 frozen copies unmoved (only color.success
//                              itself moved — the token nothing reads)
//   I2 .lg-question-card background "#FFFFFF" on BOTH arms
//   I3 precedence              palette arm never painted the card at all
//
// NOT FIXED HERE, reported instead (outside this slice): `--lg-success`
// (styles.ts:500) and `validation.successColor` remain unread by any rule.
// Neither is an OFFERED CONTROL, so neither is an R3 breach; they are internal
// tokens, and deleting the emitted custom property would churn byte-pinned CSS
// for no operator-visible gain.

import { describe, expect, it } from "vitest";

import { renderSectionComponents } from "../src/public/leadgen/components/presets";
import type { LeadgenComponentNode } from "../src/public/leadgen/components/content-schema";
import { DEFAULT_FUNNEL_SCOPE, funnelChromeCss } from "../src/public/leadgen/designs/default-funnel/styles";
import { defaultFunnelDesign } from "../src/public/leadgen/designs/default-funnel/tokens";
import { resolveTokens } from "../src/public/leadgen/designs/theme";
import type { ThemeJson } from "../src/public/leadgen/designs/theme";

const BASE = defaultFunnelDesign;
const SCOPE = DEFAULT_FUNNEL_SCOPE; // [data-funnel-design="default-funnel"]

// The two arms every colour leg flips between (the sweep's own values).
const A = "#123456";
const B = "#ee7733";

// ---------------------------------------------------------------------------
// The REAL producer chain. Nothing below is hand-built: the section nodes are
// ordinary authored components (the three success-surface node types plus a
// question that renders the card), the design is whatever resolveTokens
// returns, the stylesheet is whatever funnelChromeCss emits for it, and the
// markup is whatever renderSectionComponents emits for it.
// ---------------------------------------------------------------------------

const PROBE_NODES: LeadgenComponentNode[] = [
  { type: "FreeTextQuestion", question_id: "s36_text", question_key: "s36", internal_field: "s36" },
  { type: "SuccessState", question_id: "s36_success", props: { heading: "Done", message: "Thanks" } },
  { type: "ReassuranceBadge", question_id: "s36_badge", props: { text: "No spam" } },
  { type: "TrustBar", question_id: "s36_trust", props: { items: [{ icon: "✓", text: "Secure" }] } },
] as unknown as LeadgenComponentNode[];

interface Painted {
  design: ReturnType<typeof resolveTokens>["design"];
  css: string;
  html: string;
}

function paint(theme: ThemeJson): Painted {
  const tokens = resolveTokens(BASE, theme, null, null);
  const css = funnelChromeCss(tokens.design, SCOPE, { frameRegions: true });
  const html = renderSectionComponents(PROBE_NODES, tokens.design as typeof BASE, {
    headline_text: "",
    subheadline_text: null,
    theme_controls: tokens.theme_controls,
  });
  return { design: tokens.design, css, html };
}

// ---------------------------------------------------------------------------
// Author-sheet cascade over the REAL sheet + a REAL rendered element.
// Lifted from leadgen-p8-m2-theme-keys.test.ts (same constraint, same
// approach): funnelChromeCss joins one rule PER LINE, so line-splitting yields
// exactly one `selector{body}` per line.
// ---------------------------------------------------------------------------

interface El {
  tag: string;
  classes: Set<string>;
  attrs: Map<string, string | null>;
}
type Spec = [number, number, number]; // [id, class+attr, type]

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

// Specificity of one selector IF it matches the flat element, else null.
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

function parseOpenTag(openTag: string): El {
  const m = openTag.match(/^<([a-zA-Z][\w-]*)\s*([^>]*)>$/);
  if (m === null) throw new Error(`not a valid open tag: ${openTag.slice(0, 160)}`);
  const classes = new Set<string>();
  const attrs = new Map<string, string | null>();
  for (const a of (m[2] as string).matchAll(/([a-zA-Z_:][\w:.-]*)(?:="([^"]*)")?/g)) {
    const name = a[1] as string;
    const val = a[2] ?? null;
    if (name === "class" && val !== null) {
      for (const c of val.split(/\s+/)) if (c !== "") classes.add(c);
    } else {
      attrs.set(name, val);
    }
  }
  return { tag: m[1] as string, classes, attrs };
}

// THE E10 GUARD: the element must come out of the REAL rendered page. A class
// the markup does not contain THROWS — a rule for a component the page renders
// zero nodes of can never be credited as "painted".
function elementWithClass(html: string, className: string): El {
  for (const m of html.matchAll(/<[a-zA-Z][\w-]*\s*[^>]*>/g)) {
    const classAttr = m[0].match(/class="([^"]*)"/);
    const classes = classAttr ? (classAttr[1] as string).split(/\s+/) : [];
    if (classes.includes(className)) return parseOpenTag(m[0]);
  }
  throw new Error(`the rendered page contains NO element with class "${className}"`);
}

function computed(theme: ThemeJson, className: string, property: string): string | undefined {
  const { css, html } = paint(theme);
  return winning(css, elementWithClass(html, className), property)?.value;
}

// The value the REAL renderer put in the element's own inline `style` — a
// second, independent real artifact for the surfaces presets.ts styles inline.
function inlineDecl(theme: ThemeJson, className: string, property: string): string | undefined {
  const el = elementWithClass(paint(theme).html, className);
  const style = el.attrs.get("style");
  if (style === undefined || style === null) return undefined;
  for (const d of style.split(";")) {
    const i = d.indexOf(":");
    if (i > 0 && d.slice(0, i).trim() === property) return d.slice(i + 1).trim();
  }
  return undefined;
}

const success = (value: string): ThemeJson => ({ palette: { success: value } });
const cardBg = (value: string): ThemeJson => ({ palette: { card_background: value } });

// ---------------------------------------------------------------------------
// 0. The ground truth every leg below stands on.
// ---------------------------------------------------------------------------

describe("R2 P8 M2 S3.6 — the success + card surfaces a visitor actually sees", () => {
  const { html } = paint({});

  it("the REAL rendered page contains every surface the two roles are asserted against", () => {
    for (const className of [
      "lg-question-card",
      "lg-success",
      "lg-success-icon",
      "lg-badge",
      "lg-badge-icon",
      "lg-trustbar-icon",
    ]) {
      expect(() => elementWithClass(html, className), `${className} is rendered`).not.toThrow();
    }
    // …and the guard really does throw for a component this page does not render.
    expect(() => elementWithClass(html, "lg-card-panel")).toThrow(/contains NO element/);
  });

  it("the probe sheet parses under the flat-cascade assumptions (one rule per line)", () => {
    const { css } = paint({});
    expect(css).not.toContain("@font-face");
    expect(winning(css, elementWithClass(html, "lg-question-card"), "background")?.selector).toBe(
      `${SCOPE} .lg-question-card`,
    );
    expect(winning(css, elementWithClass(html, "lg-success"), "border")?.selector).toBe(`${SCOPE} .lg-success`);
  });
});

// ---------------------------------------------------------------------------
// I1 — palette.success paints the success surfaces a visitor sees.
// ---------------------------------------------------------------------------

describe("R2 P8 M2 S3.6 I1 — palette.success paints 'reassurance, valid states' (its own ROLE_META promise)", () => {
  const surfaces: ReadonlyArray<{ className: string; property: string; shape: (v: string) => string }> = [
    { className: "lg-success", property: "border", shape: (v) => `1px solid ${v}` },
    { className: "lg-success-icon", property: "color", shape: (v) => v },
    { className: "lg-badge", property: "border", shape: (v) => `1px solid ${v}` },
    { className: "lg-badge", property: "color", shape: (v) => v },
    { className: "lg-badge-icon", property: "color", shape: (v) => v },
    { className: "lg-trustbar-icon", property: "color", shape: (v) => v },
  ];

  for (const { className, property, shape } of surfaces) {
    it(`success ${A} -> ${B} moves ${property} on .${className}`, () => {
      const armA = computed(success(A), className, property);
      const armB = computed(success(B), className, property);
      expect(armA).toBe(shape(A));
      expect(armB).toBe(shape(B));
      expect(armA).not.toBe(armB);
      // …and at base the surface still carries the base success colour, so the
      // move above is a real departure and not a value that was already there.
      expect(computed({}, className, property)).toBe(shape(BASE.color.success));
    });
  }

  it("the surfaces the RENDERER styles inline move too (a second real artifact, not the sheet)", () => {
    expect(inlineDecl(success(A), "lg-success", "border")).toBe(`1px solid ${A}`);
    expect(inlineDecl(success(B), "lg-success", "border")).toBe(`1px solid ${B}`);
    expect(inlineDecl(success(A), "lg-success-icon", "color")).toBe(A);
    expect(inlineDecl(success(A), "lg-badge", "color")).toBe(A);
    expect(inlineDecl(success(A), "lg-badge-icon", "color")).toBe(A);
    // the base render still carries the base colour there
    expect(inlineDecl({}, "lg-success", "border")).toBe(`1px solid ${BASE.color.success}`);
  });

  it("NO FROZEN COPY LEFT BEHIND: every base token that IS the success colour moves with the role", () => {
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

    const atBase = frozen(BASE as unknown as Record<string, unknown>, BASE.color.success);
    // Pinned so a NEW frozen copy shows up here as a diff and must be wired.
    expect(atBase).toEqual([
      "color.success",
      "reassuranceBadge.border",
      "reassuranceBadge.iconColor",
      "reassuranceBadge.textColor",
      "successState.border",
      "successState.iconColor",
      "trustBar.iconColor",
      "validation.successColor",
    ]);

    const themed = paint(success(A)).design as unknown as Record<string, unknown>;
    // Every one of them now carries the AUTHORED colour …
    expect(frozen(themed, A)).toEqual(atBase);
    // … and not one is still sitting on the base colour.
    expect(frozen(themed, BASE.color.success)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// I2 — palette.card_background paints the card the visitor sees.
// ---------------------------------------------------------------------------

describe("R2 P8 M2 S3.6 I2 — palette.card_background paints .lg-question-card (its label's 'question card')", () => {
  it(`card_background ${A} -> ${B} moves the card's own background`, () => {
    const armA = computed(cardBg(A), "lg-question-card", "background");
    const armB = computed(cardBg(B), "lg-question-card", "background");
    expect(armA).toBe(A);
    expect(armB).toBe(B);
    expect(armA).not.toBe(armB);
    expect(computed({}, "lg-question-card", "background")).toBe(BASE.questionCard.background);
  });

  it("a role ALIAS value resolves the same way (card_background: 'surface_wash')", () => {
    // The palette layer accepts a role name as an alias into the base design;
    // the card must honour the resolved colour, not the literal string.
    expect(
      computed({ palette: { card_background: "surface_wash" } }, "lg-question-card", "background"),
    ).toBe(BASE.color.primaryWash);
  });

  it("I4 — the pre-existing .lg-input painting SURVIVES (this fix is additive, never a re-route)", () => {
    // color.card also paints `.lg-input` (styles.ts:1828), pinned by
    // leadgen-theme-tokens.test.ts:267. The role must still move it.
    expect(resolveTokens(BASE, cardBg(A)).design.color.card).toBe(A);
    expect(paint(cardBg(A)).css).toContain(`${SCOPE} .lg-input`);
    const inputBg = winning(
      paint(cardBg(A)).css,
      { tag: "input", classes: new Set(["lg-input"]), attrs: new Map() },
      "background",
    );
    expect(inputBg?.value).toBe(A);
  });
});

// ---------------------------------------------------------------------------
// I3 — precedence between the two card-background axes, pinned both ways.
// ---------------------------------------------------------------------------

describe("R2 P8 M2 S3.6 I3 — the explicit card control beats the theme-wide role", () => {
  it("card_defaults.background_role WINS over palette.card_background on the painted card", () => {
    const both: ThemeJson = {
      palette: { card_background: A },
      card_defaults: { background_role: "error" },
    };
    expect(
      computed(both, "lg-question-card", "background"),
      "the narrower component control must win the card",
    ).toBe(BASE.color.error);
    // If the order flipped, this would paint `A`.
    expect(computed(both, "lg-question-card", "background")).not.toBe(A);
  });

  it("…and with ONLY the palette role set, the role still paints the card (the control is not shadowed)", () => {
    expect(computed(cardBg(B), "lg-question-card", "background")).toBe(B);
  });

  it("the two axes agree when the component control names the very same role", () => {
    // card_defaults.background_role resolves through the SAME `roles` map, so
    // naming `card_background` reproduces the palette's own value.
    expect(
      computed(
        { palette: { card_background: A }, card_defaults: { background_role: "card_background" } },
        "lg-question-card",
        "background",
      ),
    ).toBe(A);
  });

  it("the card_defaults readout still reports the value that PAINTS the input-side token", () => {
    // Guards the sibling slice's contract: `card_defaults.background` is
    // design.color.card, which the palette role also writes.
    expect(resolveTokens(BASE, cardBg(A)).card_defaults.background).toBe(A);
  });
});

// ---------------------------------------------------------------------------
// I5 — a theme that sets neither key renders byte-identically to today.
// ---------------------------------------------------------------------------

describe("R2 P8 M2 S3.6 I5 — both appliers are opt-in (an untouched funnel is byte-identical)", () => {
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

  it("a theme that authors OTHER palette roles leaves every success + questionCard slot at its base value", () => {
    const others: ThemeJson = { palette: { brand_primary: A, text_primary: "#111111", border: B } };
    const d = resolveTokens(BASE, others).design;
    expect(d.successState).toEqual(BASE.successState);
    expect(d.reassuranceBadge).toEqual(BASE.reassuranceBadge);
    expect(d.trustBar).toEqual(BASE.trustBar);
    expect(d.validation).toEqual(BASE.validation);
    expect(d.questionCard).toEqual(BASE.questionCard);
  });

  it("each role touches ONLY its own slots (success leaves the card alone, and vice versa)", () => {
    const s = resolveTokens(BASE, success(A)).design;
    expect(s.questionCard).toEqual(BASE.questionCard);
    expect(s.color.card).toBe(BASE.color.card);

    const c = resolveTokens(BASE, cardBg(A)).design;
    expect(c.successState).toEqual(BASE.successState);
    expect(c.reassuranceBadge).toEqual(BASE.reassuranceBadge);
    expect(c.trustBar).toEqual(BASE.trustBar);
    expect(c.questionCard.background).toBe(A);
    // …only the background slot of the card moved.
    expect({ ...c.questionCard, background: BASE.questionCard.background }).toEqual(BASE.questionCard);
  });
});
