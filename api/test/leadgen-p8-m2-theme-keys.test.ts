// R2 P8 M2 (+ N18) — THE THEME'S DESIGN LANGUAGE REACHES THE SURFACES THE
// VISITOR SEES.
//
// THE OWNER'S WORDS: "theme is only design language!!!! colors, fonts, sizes"
// (docs/leadgen/source-of-truth/SOURCE-OF-TRUTH.md). A design-language key that
// resolves, validates, persists and then paints nothing is the dead-control
// class this product has already shipped repeatedly.
//
// WHAT WAS MEASURED AT HEAD, BY HAND, ON THE LIVE PRODUCT (the raw log is
// docs/leadgen/r2/evidence/p8/m2/repro-before.txt): six inline `theme_json`
// keys written through the real operator route (PUT /funnels/:id/theme), the
// live visitor page then loaded in a real chromium on a fresh ?_cb and the
// FIRST VISIBLE matching element read with getComputedStyle —
//   button_defaults.casing  none->upper  .lg-continue 320x52 + .lg-btn-answer
//                                        151x66: `text-transform:none` BOTH
//   card_defaults.shadow    none->xl     .lg-question-card 420x86: identical
//   card_defaults.radius    sm->full     .lg-question-card: 16px BOTH
//   card_defaults.border_role error->success  .lg-question-card:
//                                        rgb(233,237,243) BOTH
//   card_defaults.background_role error->success  card white BOTH; the colour
//                                        landed on an `input.lg-input` instead
//   scales.shadow           none->high   card + both button classes constant
//
// THE CAUSE the fix addresses: the whole `card_defaults` group resolved onto
// design.color.card / design.content.cardRadius / design.cardPanel.border (and
// a shadow that reached no design token at all), whose only card-shaped
// selectors are `.lg-card-panel` / `.lg-disclosure-panel` — components a driven
// funnel page renders ZERO nodes of; `button_defaults.casing` resolved onto
// EffectiveButtonDefaults.text_transform, a readout with zero CSS consumers;
// and `scales.shadow` shifted design.shadow.*, which the painted card's frozen
// `questionCard.boxShadow` literal never read.
//
// HOW THIS FILE AVOIDS THE FAILURE MODE THAT LET M2 SHIP (E10/E11). "The bytes
// changed" is exactly the assertion a MIS-TARGETED key passes: card_defaults.
// background_role did change bytes at HEAD — on the wrong element. So no leg
// below is a byte-diff. Every leg:
//   • takes the STYLESHEET from the real producer chain (resolveTokens ->
//     funnelChromeCss) — never a hand-written rule;
//   • takes the ELEMENT from the real renderSectionComponents markup — never a
//     hand-built selector. `elementWithClass()` THROWS if the class is not in
//     the rendered page, so a declaration can never be credited to a selector
//     nothing renders;
//   • resolves the winning declaration by a faithful author-sheet cascade
//     (specificity, then source order) over those two real artifacts, and
//     asserts the resulting value against the BASE TOKEN FILE (an independent
//     source from the producer that painted it).
//
// WHY A HAND CASCADE RESOLVER: the vitest environment is "node"
// (vitest.config.ts) and jsdom/happy-dom are NOT installed (supply chain: no
// new deps). The resolver below is the idiom leadgen-hidden-visibility.test.ts
// already established for this exact constraint (see its comment at :41),
// generalised from `display` to an arbitrary property. The live-browser proof
// of these same keys is the conductor's driven re-measurement, not this lane.
//
// FAIL-BEFORE (each leg's assertion at unfixed HEAD, all reproduced by
// reverting the two source edits):
//   I1 background  — card `background` "#FFFFFF" on BOTH arms (expected
//                    #D32F2F / #0E7C3A)
//   I1 border      — card `border` "1px solid #E9EDF3" on BOTH arms
//   I1 radius      — card `border-radius` "16px" on BOTH arms
//   I1 shadow      — card `box-shadow` "0 8px 28px rgba(20,32,54,.10)" on BOTH
//   I2 casing      — no `text-transform` declaration matches .lg-continue or
//                    .lg-btn-answer at all (undefined, expected "uppercase")
//   I3 scale       — card `box-shadow` identical for none/low/mid/high (1
//                    distinct value, expected 4)
//   I3 precedence  — `card_defaults.shadow` under `scales.shadow` was never
//                    painted at all
//   I4 logo        — `.lg-frame-header--logo-m .lg-logo` font-size 1.1rem ->
//                    2.53rem across display_size m..xxl while -s (0.95rem) and
//                    -l (1.35rem) stood still

import { describe, expect, it } from "vitest";

import { renderSectionComponents } from "../src/public/leadgen/components/presets";
import type { LeadgenComponentNode } from "../src/public/leadgen/components/content-schema";
import { DEFAULT_FUNNEL_SCOPE, funnelChromeCss } from "../src/public/leadgen/designs/default-funnel/styles";
import { defaultFunnelDesign } from "../src/public/leadgen/designs/default-funnel/tokens";
import { THEME_DISPLAY_SIZE_SCALES, readButtonCasing, resolveTokens } from "../src/public/leadgen/designs/theme";
import type { ThemeDisplaySizeScale, ThemeJson } from "../src/public/leadgen/designs/theme";

const BASE = defaultFunnelDesign;
const SCOPE = DEFAULT_FUNNEL_SCOPE; // [data-funnel-design="default-funnel"]

// ---------------------------------------------------------------------------
// The REAL producer chain. Nothing below is hand-built: the section nodes are
// ordinary authored components, the design is whatever resolveTokens returns,
// the stylesheet is whatever funnelChromeCss emits for it, and the markup is
// whatever renderSectionComponents emits for it.
// ---------------------------------------------------------------------------

const PROBE_NODES: LeadgenComponentNode[] = [
  { type: "FreeTextQuestion", question_id: "m2_text", question_key: "m2", internal_field: "m2" },
  { type: "ContinueButton", question_id: "m2_continue" },
  {
    type: "TwoButtonYesNo",
    question_id: "m2_yesno",
    question_key: "yn",
    internal_field: "yn",
    answer_type: "boolean",
  },
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
// Generalised from leadgen-hidden-visibility.test.ts (same constraint, same
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

// The value the cascade computes for `property` on `el` over the real sheet,
// plus the selector that won it (so a leg can name the rule that painted).
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
// the markup does not contain THROWS — the mis-targeting M2 is about (a rule
// for `.lg-card-panel` on a page with no card panel) can never be credited.
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

// ---------------------------------------------------------------------------
// 0. The ground truth every leg below stands on.
// ---------------------------------------------------------------------------

describe("R2 P8 M2 — the surfaces a visitor actually sees", () => {
  const { html, css } = paint({});

  it("the REAL rendered page contains exactly one .lg-question-card, and the two button classes", () => {
    expect(html.match(/class="lg-question-card"/g)).toHaveLength(1);
    const cont = elementWithClass(html, "lg-continue");
    const answer = elementWithClass(html, "lg-btn-answer");
    // Both surfaces the visitor presses carry `.lg-btn` — which is why ONE
    // casing rule on `.lg-btn` reaches both.
    expect(cont.classes.has("lg-btn")).toBe(true);
    expect(answer.classes.has("lg-btn")).toBe(true);
  });

  it("the REAL rendered page contains NO .lg-card-panel / .lg-disclosure-panel — the surfaces card_defaults used to steer alone", () => {
    expect(html).not.toContain("lg-card-panel");
    expect(html).not.toContain("lg-disclosure-panel");
    expect(() => elementWithClass(html, "lg-card-panel")).toThrow(/contains NO element/);
  });

  it("the probe sheet parses under the flat-cascade assumptions (one rule per line, no @font-face prelude)", () => {
    expect(css).not.toContain("@font-face");
    expect(winning(css, elementWithClass(html, "lg-question-card"), "background")?.selector).toBe(
      `${SCOPE} .lg-question-card`,
    );
  });
});

// ---------------------------------------------------------------------------
// I1 — every key in card_defaults moves the card the visitor sees.
// ---------------------------------------------------------------------------

describe("R2 P8 M2 I1 — card_defaults paints .lg-question-card (the operator's 'Card …' labels)", () => {
  it("Card background: background_role error -> success moves the card's own background", () => {
    const asError = computed({ card_defaults: { background_role: "error" } }, "lg-question-card", "background");
    const asSuccess = computed({ card_defaults: { background_role: "success" } }, "lg-question-card", "background");
    expect(asError).toBe(BASE.color.error);
    expect(asSuccess).toBe(BASE.color.success);
    expect(asError).not.toBe(asSuccess);
  });

  it("Card border: border_role error -> success moves the card's own border colour", () => {
    const asError = computed({ card_defaults: { border_role: "error" } }, "lg-question-card", "border");
    const asSuccess = computed({ card_defaults: { border_role: "success" } }, "lg-question-card", "border");
    expect(asError).toBe(`1px solid ${BASE.color.error}`);
    expect(asSuccess).toBe(`1px solid ${BASE.color.success}`);
  });

  it("Card corners: radius sm -> full moves the card's own border-radius", () => {
    const sm = computed({ card_defaults: { radius: "sm" } }, "lg-question-card", "border-radius");
    const full = computed({ card_defaults: { radius: "full" } }, "lg-question-card", "border-radius");
    expect(sm).toBe(BASE.radius.sm);
    expect(full).toBe(BASE.radius.full);
    expect(sm).not.toBe(full);
  });

  it("Card shadow: shadow none -> xl moves the card's own box-shadow", () => {
    const none = computed({ card_defaults: { shadow: "none" } }, "lg-question-card", "box-shadow");
    const xl = computed({ card_defaults: { shadow: "xl" } }, "lg-question-card", "box-shadow");
    expect(none).toBe("none");
    expect(xl).toBe(BASE.shadow.xl);
  });

  it("EVERY declared card_defaults key moves the card — a new key that paints nothing fails here", () => {
    // Driven off the arms the operator's own four controls expose (themes.ts
    // 'Card background/border/corners/shadow'), each compared against the SAME
    // key's other arm — never against a hand-written expectation.
    const arms: ReadonlyArray<{ key: string; property: string; a: ThemeJson; b: ThemeJson }> = [
      {
        key: "background_role",
        property: "background",
        a: { card_defaults: { background_role: "error" } },
        b: { card_defaults: { background_role: "success" } },
      },
      {
        key: "border_role",
        property: "border",
        a: { card_defaults: { border_role: "error" } },
        b: { card_defaults: { border_role: "success" } },
      },
      {
        key: "radius",
        property: "border-radius",
        a: { card_defaults: { radius: "sm" } },
        b: { card_defaults: { radius: "full" } },
      },
      {
        key: "shadow",
        property: "box-shadow",
        a: { card_defaults: { shadow: "none" } },
        b: { card_defaults: { shadow: "xl" } },
      },
    ];
    const dead = arms.filter(
      (arm) =>
        computed(arm.a, "lg-question-card", arm.property) === computed(arm.b, "lg-question-card", arm.property),
    );
    expect(dead.map((d) => d.key)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// I2 — button_defaults.casing moves the buttons the visitor presses.
// ---------------------------------------------------------------------------

describe("R2 P8 M2 I2 — button_defaults.casing paints .lg-continue and .lg-btn-answer", () => {
  const upper: ThemeJson = { button_defaults: { casing: "upper" } };

  for (const className of ["lg-continue", "lg-btn-answer"]) {
    it(`casing none -> upper moves text-transform on .${className}`, () => {
      expect(computed({ button_defaults: { casing: "none" } }, className, "text-transform")).toBeUndefined();
      expect(computed(upper, className, "text-transform")).toBe("uppercase");
    });
  }

  it("the readout and the paint agree (one resolution, never a second opinion)", () => {
    expect(resolveTokens(BASE, upper).button_defaults.text_transform).toBe("uppercase");
    expect(resolveTokens(BASE, { button_defaults: { casing: "none" } }).button_defaults.text_transform).toBe("none");
  });

  it("casing rides a Symbol stash — the serialized design_tokens bytes are untouched", () => {
    const themed = resolveTokens(BASE, upper).design;
    expect(readButtonCasing(themed)).toBe("upper");
    expect(JSON.stringify(themed)).toBe(JSON.stringify(BASE));
    // …and it does NOT turn on the P6 button-style machinery.
    expect(paint(upper).css).not.toContain("data-btn-fill");
    expect(paint(upper).html).not.toContain("data-btn-");
  });
});

// ---------------------------------------------------------------------------
// I3 — scales.shadow moves the shadowed visible surface, and an explicit step
//      beats the scale.
// ---------------------------------------------------------------------------

describe("R2 P8 M2 I3 — scales.shadow reaches the painted card; the explicit step wins", () => {
  it("none / low / mid / high paint FOUR distinct card shadows", () => {
    const seen = (["none", "low", "mid", "high"] as const).map((shadow) =>
      computed({ scales: { shadow } }, "lg-question-card", "box-shadow"),
    );
    expect(seen[0]).toBe("none");
    expect(seen[1]).toBe(BASE.shadow.md); // the card sits nearest `lg`; low = one step down
    expect(seen[2]).toBe(BASE.questionCard.boxShadow); // mid is the identity
    expect(seen[3]).toBe(BASE.shadow.xl); // high = one step up
    expect(new Set(seen).size, `distinct card shadows, got ${JSON.stringify(seen)}`).toBe(4);
  });

  it("the buttons carry NO box-shadow in the default look — 'constant' there is correct, not a second dead key", () => {
    for (const className of ["lg-continue", "lg-btn-answer"]) {
      expect(computed({ scales: { shadow: "high" } }, className, "box-shadow")).toBeUndefined();
    }
  });

  it("PRECEDENCE: an explicit card_defaults.shadow beats scales.shadow — including under scales.shadow:none", () => {
    // If the two were applied in the other order, or the step were resolved on
    // the scale-shifted ladder, both of these would paint the SCALE's answer.
    expect(
      computed({ scales: { shadow: "none" }, card_defaults: { shadow: "xl" } }, "lg-question-card", "box-shadow"),
      "scale=none + step=xl must paint the xl step, not none",
    ).toBe(BASE.shadow.xl);
    expect(
      computed({ scales: { shadow: "high" }, card_defaults: { shadow: "sm" } }, "lg-question-card", "box-shadow"),
      "scale=high + step=sm must paint the sm step, not the high-shifted md",
    ).toBe(BASE.shadow.sm);
    // …and the readout says exactly what was painted.
    expect(resolveTokens(BASE, { scales: { shadow: "none" }, card_defaults: { shadow: "xl" } }).card_defaults.shadow).toBe(
      BASE.shadow.xl,
    );
  });

  it("with NO explicit step the scale governs the readout too", () => {
    expect(resolveTokens(BASE, { scales: { shadow: "high" } }).card_defaults.shadow).toBe(BASE.shadow.lg);
    expect(resolveTokens(BASE, {}).card_defaults.shadow).toBe(BASE.shadow.md);
  });
});

// ---------------------------------------------------------------------------
// I4 (N18) — typography.display_size scales display TYPE, not chrome.
// ---------------------------------------------------------------------------

describe("R2 P8 N18 — display_size scales display type, never the header logo", () => {
  const logoRung = (css: string, rung: "s" | "m" | "l"): string | undefined =>
    css.match(new RegExp(`\\.lg-frame-header--logo-${rung} \\.lg-logo\\{font-size:([^;}]+)`))?.[1];

  it("every display_size tier paints the SAME font-size on all three logo rungs", () => {
    const perTier = THEME_DISPLAY_SIZE_SCALES.map((display_size) => {
      const { css, design } = paint({ typography: { display_size } });
      return {
        display_size,
        s: logoRung(css, "s"),
        m: logoRung(css, "m"),
        l: logoRung(css, "l"),
        token: design.header.logoFontSize,
      };
    });
    for (const rung of ["s", "m", "l"] as const) {
      const values = perTier.map((t) => t[rung]);
      expect(values.every((v) => v !== undefined), `logo rung -${rung} is emitted`).toBe(true);
      expect(new Set(values).size, `logo rung -${rung} is display_size-invariant, got ${JSON.stringify(values)}`).toBe(1);
    }
    // the token itself never moves either
    expect(new Set(perTier.map((t) => t.token))).toEqual(new Set([BASE.header.logoFontSize]));
    // …and the per-logo Size control still means three DIFFERENT sizes.
    const rungs = [perTier[0]?.s, perTier[0]?.m, perTier[0]?.l];
    expect(new Set(rungs).size, `three distinct logo rungs, got ${JSON.stringify(rungs)}`).toBe(3);
  });

  it("display TYPE still ramps exactly as before (headline / range value / success heading)", () => {
    const at = (display_size: ThemeDisplaySizeScale): Painted => paint({ typography: { display_size } });
    const m = at("m");
    const xxl = at("xxl");
    expect(m.design.headline.fontSizeDesktop).toBe(BASE.headline.fontSizeDesktop);
    expect(xxl.design.headline.fontSizeDesktop).toBe("71.3px"); // 31 x 2.3 (Image37)
    expect(xxl.css).toContain("font-size:71.3px");
    expect(xxl.design.rangeQuestion.valueFontSize).not.toBe(BASE.rangeQuestion.valueFontSize);
    expect(xxl.design.successState.headingFontSize).not.toBe(BASE.successState.headingFontSize);
    // body copy is still untouched (the point of a display-only ramp)
    expect(xxl.design.subheadline.fontSize).toBe(BASE.subheadline.fontSize);
  });
});

// ---------------------------------------------------------------------------
// I6 — a theme that sets none of these keys renders exactly as it does today.
// ---------------------------------------------------------------------------

describe("R2 P8 M2 I6 — every applier is opt-in (an untouched funnel is byte-identical)", () => {
  const bare = funnelChromeCss(BASE, SCOPE, { frameRegions: true });
  const bareHtml = renderSectionComponents(PROBE_NODES, BASE, {
    headline_text: "",
    subheadline_text: null,
  });

  it("no theme at all, and an empty theme, emit the SAME stylesheet + markup bytes as the raw base design", () => {
    for (const theme of [{}, { version: 1 } as ThemeJson]) {
      const { css, html } = paint(theme);
      expect(css).toBe(bare);
      expect(html).toBe(bareHtml);
    }
    expect(resolveTokens(BASE).design).toEqual(BASE);
    expect(resolveTokens(BASE, {}).design).toEqual(BASE);
  });

  it("a theme that authors ONLY a colour leaves every questionCard slot at its base value", () => {
    const colourOnly: ThemeJson = { palette: { brand_primary: "#123456" } };
    const d = resolveTokens(BASE, colourOnly).design;
    expect(d.questionCard).toEqual(BASE.questionCard);
    expect(readButtonCasing(d)).toBeUndefined();
    // No casing rule is emitted. (The sheet DOES carry `text-transform:
    // uppercase` elsewhere — categoryLabel + the banner CTA — so this is
    // asserted through the cascade on a real button, not a substring scan.)
    expect(paint(colourOnly).css).not.toContain(`${SCOPE} .lg-btn{text-transform:uppercase}`);
    expect(computed(colourOnly, "lg-continue", "text-transform")).toBeUndefined();
    expect(computed(colourOnly, "lg-btn-answer", "text-transform")).toBeUndefined();
  });

  it("the pre-existing card_defaults targets are still written (this fix is additive, never a re-route)", () => {
    const eff = resolveTokens(BASE, {
      card_defaults: { background_role: "surface_wash", border_role: "accent", radius: "xl" },
    });
    expect(eff.design.color.card).toBe(BASE.color.primaryWash);
    expect(eff.design.content.cardRadius).toBe(BASE.radius.xl);
    expect(eff.design.cardPanel.border).toBe(`1px solid ${BASE.color.accent}`);
  });
});
