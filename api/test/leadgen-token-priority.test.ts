// v2.5 contract tests `token-priority-order` + `section-local-override-
// application` (15 §15.1) — token priority LAYERS 4–5 at the preset renderer
// (09 §9.2/§9.4/§9.5).
//
// Priority (09 §9.2): 1 base visual design → 2 Funnel theme palette →
// 3 Variant frame_overrides theme → 4 Section design_overrides_json roles →
// 5 component design_overrides → 6 runtime state classes (CSS, unchanged).
// Layers 1–3 are resolveTokens (server-side, baked into the effective design
// object); 4–5 stay per-node at render — values are ROLE REFS resolved via
// baseTokenForRole against the design, with `#hex` kept as a LEGACY LITERAL
// rendered as-is (§9.4) so existing stored hex renders byte-identically.
//
// NOTE (slice boundary): the composition legs — serve.ts / preview handlers
// parsing `leadgen_sections.design_overrides_json` into sectionCtx — belong
// to the integration slice; this file proves the renderer resolution.

import { describe, expect, it } from "vitest";
import type {
  LeadgenChoice,
  LeadgenComponentNode,
  LeadgenDesignOverrides,
} from "../src/public/leadgen/components/content-schema";
import {
  renderComponent,
  renderSectionComponents,
} from "../src/public/leadgen/components/presets";
import type {
  LeadgenSectionDesignOverrides,
  LeadgenSectionRenderCtx,
} from "../src/public/leadgen/components/presets";
import { defaultFunnelDesign } from "../src/public/leadgen/designs/default-funnel/tokens";
import type { DefaultFunnelDesign } from "../src/public/leadgen/designs/default-funnel/tokens";
import { resolveTokens } from "../src/public/leadgen/designs/theme";
import type { ThemeJson, VariantThemeOverrides } from "../src/public/leadgen/designs/theme";

const BASE = defaultFunnelDesign;

// resolveTokens returns the WIDENED effective design (EffectiveFunnelDesign,
// §9.2 layers 1–3); the presets consume it via the frame.ts cast idiom.
const effective = (
  theme?: ThemeJson | null,
  variant?: VariantThemeOverrides | null,
): DefaultFunnelDesign => resolveTokens(BASE, theme ?? null, variant ?? null).design as DefaultFunnelDesign;

// --- fixtures ---------------------------------------------------------------

const CHOICES: LeadgenChoice[] = [
  { label: "LLC", value: "llc", analytics_id: "a_llc", icon: "B" },
  { label: "Sole prop", value: "sole", analytics_id: "a_sole", icon: "P" },
];

const CONT = (design_overrides?: LeadgenDesignOverrides): LeadgenComponentNode => ({
  type: "ContinueButton",
  question_id: "c1",
  ...(design_overrides !== undefined ? { design_overrides } : {}),
  props: { label: "Continue" },
});

// Rework §6.7: 5 choices — enough that min(authored, choiceCount) never
// constrains a columns value this file's priority-order tests exercise (1..5)
// on their OWN. The 2-choice CHOICES stays the default (unaffected callers).
const MANY_CHOICES: LeadgenChoice[] = [
  { label: "LLC", value: "llc", analytics_id: "a_llc", icon: "B" },
  { label: "Sole prop", value: "sole", analytics_id: "a_sole", icon: "P" },
  { label: "Partnership", value: "partner", analytics_id: "a_partner", icon: "P2" },
  { label: "C Corp", value: "ccorp", analytics_id: "a_ccorp", icon: "C" },
  { label: "S Corp", value: "scorp", analytics_id: "a_scorp", icon: "S" },
];

const GRID = (
  design_overrides?: LeadgenDesignOverrides,
  props?: Record<string, unknown>,
  choices: LeadgenChoice[] = CHOICES,
): LeadgenComponentNode => ({
  type: "IconCardAnswerGrid",
  question_id: "g1",
  internal_field: "biz",
  ...(design_overrides !== undefined ? { design_overrides } : {}),
  ...(props !== undefined ? { props } : {}),
  choices,
});

const MULTI: LeadgenComponentNode = {
  type: "MultiChoiceCardGroup",
  question_id: "m1",
  internal_field: "features",
  choices: CHOICES,
};

// ctx builder: `undefined` arg ⇒ NO design_overrides key at all; `null` ⇒ the
// explicit-null shape the composition layer passes for an empty DB column.
const ctxWith = (
  design_overrides?: LeadgenSectionDesignOverrides | null,
): LeadgenSectionRenderCtx => ({
  headline_text: "H",
  subheadline_text: null,
  ...(design_overrides !== undefined ? { design_overrides } : {}),
});

// The inline style of the FIRST tag in `html` that carries one.
const styleOf = (html: string): string => /style="([^"]*)"/.exec(html)?.[1] ?? "";

// ---------------------------------------------------------------------------
// 15 §15.1 `token-priority-order` — full 6-layer resolution
// ---------------------------------------------------------------------------

describe("token-priority-order", () => {
  const THEME: ThemeJson = { palette: { button_primary_text: "#111111", accent: "#101010" } };
  const VARIANT: VariantThemeOverrides = { palette: { button_primary_text: "#222222" } };

  it("layer 1 — base design: an override-free button renders the base button_primary_text token", () => {
    const html = renderSectionComponents([CONT()], BASE, ctxWith());
    expect(BASE.primaryButton.color).toBe("#FFFFFF"); // ground the token
    expect(html).toContain(`style="color:#FFFFFF"`);
  });

  it("layer 2 — funnel theme palette re-values the role (effective design via resolveTokens)", () => {
    const html = renderSectionComponents([CONT()], effective(THEME), ctxWith());
    expect(html).toContain(`style="color:#111111"`);
  });

  it("layer 3 — variant frame_overrides theme beats the funnel theme", () => {
    const html = renderSectionComponents([CONT()], effective(THEME, VARIANT), ctxWith());
    expect(html).toContain(`style="color:#222222"`);
  });

  it("layer 4 — Section design_overrides palette beats the themed design (layers 1–3)", () => {
    const html = renderSectionComponents(
      [CONT()],
      effective(THEME, VARIANT),
      ctxWith({ palette: { button_primary_text: "#333333" } }),
    );
    expect(html).toContain(`style="color:#333333"`);
  });

  it("layer 5 — a per-node role value beats the Section layer and resolves against the EFFECTIVE design", () => {
    const html = renderSectionComponents(
      [CONT({ buttonText: "accent" })],
      effective(THEME, VARIANT), // theme moved accent → #101010
      ctxWith({ palette: { button_primary_text: "#333333" } }),
    );
    expect(html).toContain(`style="color:#101010"`);
    expect(html).not.toContain("#333333");
  });

  it("layer 5 via layer 4 — a role-valued per-node override resolves via the Section-RE-POINTED role", () => {
    // hex re-point: the Section says "accent means #0F0F0F here"
    const hex = renderSectionComponents(
      [CONT({ buttonText: "accent" })],
      BASE,
      ctxWith({ palette: { accent: "#0F0F0F" } }),
    );
    expect(hex).toContain(`style="color:#0F0F0F"`);
    // role re-point (§9.5 "role-or-hex"): accent → brand_primary → the
    // design's brand_primary base token
    const role = renderSectionComponents(
      [CONT({ buttonText: "accent" })],
      BASE,
      ctxWith({ palette: { accent: "brand_primary" } }),
    );
    expect(role).toContain(`style="color:${BASE.color.primary}"`);
  });

  it("legacy `#hex` per-node literal passes through verbatim (FLAG: legacy literal renders as-is past every layer)", () => {
    const html = renderSectionComponents(
      [CONT({ buttonText: "#ABC123" })],
      effective(THEME, VARIANT),
      ctxWith({ palette: { button_primary_text: "#333333", accent: "#0F0F0F" } }),
    );
    expect(html).toContain(`style="color:#ABC123"`);
  });

  it("a non-role non-hex value renders as-is (defensive — validation rejects it upstream)", () => {
    const html = renderComponent(CONT({ buttonText: "not-a-role" }), BASE);
    expect(html).toContain("color:not-a-role");
  });

  it("full 6-layer chain on one slot — each layer beats the previous; layer 6 stays CSS-class-driven", () => {
    // L1 base
    expect(styleOf(renderSectionComponents([CONT()], BASE, ctxWith()))).toBe("color:#FFFFFF");
    // L2 theme
    expect(styleOf(renderSectionComponents([CONT()], effective(THEME), ctxWith()))).toBe("color:#111111");
    // L3 variant
    const eff = effective(THEME, VARIANT);
    expect(styleOf(renderSectionComponents([CONT()], eff, ctxWith()))).toBe("color:#222222");
    // L4 Section palette
    const sectionSo: LeadgenSectionDesignOverrides = {
      palette: { button_primary_text: "#333333", accent: "#444444" },
    };
    expect(styleOf(renderSectionComponents([CONT()], eff, ctxWith(sectionSo)))).toBe("color:#333333");
    // L5 per-node role value (resolved via the Section's accent re-point)
    const html5 = renderSectionComponents([CONT({ buttonText: "accent" })], eff, ctxWith(sectionSo));
    expect(styleOf(html5)).toBe("color:#444444");
    // L6 runtime state: selected/hover/disabled stay CSS class rules — the
    // resolution never emits an inline `background:` (bg rides --lg-btn-bg)
    // and the state hooks survive on the control.
    expect(html5).toContain(`class="lg-btn lg-continue"`);
    expect(html5).toContain(`data-loading="false"`);
    expect(html5).not.toContain("background:");
  });

  it("a buttonBackground role rides the --lg-btn-bg custom property, never an inline background (layer 6 safety)", () => {
    const html = renderSectionComponents([CONT({ buttonBackground: "accent" })], BASE, ctxWith());
    expect(html).toContain(`--lg-btn-bg:${BASE.color.accent}`);
    expect(html).not.toContain(`background:${BASE.color.accent}`);
  });
});

// ---------------------------------------------------------------------------
// 15 §15.1 `section-local-override-application` — §9.5 Section overrides
// resolve between theme and component layers
// ---------------------------------------------------------------------------

describe("section-local-override-application", () => {
  it("a Section palette role applies BETWEEN the theme and component layers", () => {
    const design = effective({ palette: { button_primary_text: "#111111" } });
    const so: LeadgenSectionDesignOverrides = { palette: { button_primary_text: "#333333" } };
    // beats the theme (layer 2) …
    expect(renderSectionComponents([CONT()], design, ctxWith(so))).toContain(`style="color:#333333"`);
    // … but yields to the component override (layer 5)
    expect(
      renderSectionComponents([CONT({ buttonText: "#ABC123" })], design, ctxWith(so)),
    ).toContain(`style="color:#ABC123"`);
  });

  it("a Section button_primary_bg re-point flows to --lg-btn-bg when the node has no override", () => {
    const so: LeadgenSectionDesignOverrides = { palette: { button_primary_bg: "#454545" } };
    const html = renderSectionComponents([CONT()], BASE, ctxWith(so));
    expect(html).toContain("--lg-btn-bg:#454545");
    expect(html).not.toContain("background:#454545");
    // a per-node buttonBackground still wins over the Section
    const nodeWins = renderSectionComponents([CONT({ buttonBackground: "#0F2440" })], BASE, ctxWith(so));
    expect(nodeWins).toContain("--lg-btn-bg:#0F2440");
  });

  it("the Section palette reaches role-valued overrides on featureColor/rangeColor/iconColor", () => {
    const so: LeadgenSectionDesignOverrides = { palette: { accent: "#123456", success: "#654321" } };
    const CAT: LeadgenComponentNode = {
      type: "CategoryLabel",
      question_id: "cat1",
      design_overrides: { featureColor: "accent" },
      props: { text: "BUSINESS LOAN" },
    };
    const RANGE: LeadgenComponentNode = {
      type: "NumberRangeQuestion",
      question_id: "r1",
      internal_field: "amount",
      design_overrides: { rangeColor: "success" },
      props: { min: 0, max: 10 },
    };
    const html = renderSectionComponents([CAT, RANGE, GRID({ iconColor: "accent" })], BASE, ctxWith(so));
    expect(html).toContain("color:#123456;letter-spacing"); // category label
    expect(html).toContain("background-color:#654321"); // range fill
    expect(html).toContain(`class="lg-card-icon" style="color:#123456"`); // card icon
    // without a Section, the same role vocabulary resolves against the design
    const noSection = renderComponent(
      { ...CAT, design_overrides: { featureColor: "brand_primary" } },
      BASE,
    );
    expect(noSection).toContain(`color:${BASE.color.primary};letter-spacing`);
  });

  it("columnsDefault/gapDefault apply when the node leaves them unset", () => {
    // Rework §6.7 (test repair, P2): effective columns are now ALSO
    // min(authored, choiceCount); MANY_CHOICES (5) is not always an exact
    // multiple of every column count this file tests, so a wrapped last row
    // may ALSO add justify-content:center (its own dedicated coverage lives
    // in leadgen-rework-render.test.ts) — asserted here as two SEPARATE
    // .toContain checks (cols, then gap) instead of one combined string, so
    // this test keeps proving ONLY the Section-default PRIORITY mechanism.
    const html = renderSectionComponents([GRID(undefined, undefined, MANY_CHOICES)], BASE, ctxWith({ columnsDefault: 4, gapDefault: "22px" }));
    expect(html).toContain(`--lg-cols:4`);
    expect(html).toContain(`gap:22px`);
    // without Section defaults the design tokens hold
    const plain = renderSectionComponents([GRID(undefined, undefined, MANY_CHOICES)], BASE, ctxWith());
    expect(plain).toContain(`--lg-cols:3`);
    expect(plain).toContain(`gap:0.5rem`);
  });

  it("columnsDefault/gapDefault yield to per-node values (design_overrides and props)", () => {
    // Rework §6.7 (test repair, P2): MANY_CHOICES (5) — see note above.
    const ctx = ctxWith({ columnsDefault: 4, gapDefault: "22px" });
    const viaOverrides = renderSectionComponents([GRID({ columns: 3, gridGap: "9px" }, undefined, MANY_CHOICES)], BASE, ctx);
    expect(viaOverrides).toContain(`--lg-cols:3`);
    expect(viaOverrides).toContain(`gap:9px`);
    const viaProps = renderSectionComponents([GRID(undefined, { columns: 5 }, MANY_CHOICES)], BASE, ctx);
    expect(viaProps).toContain("--lg-cols:5");
  });

  it("columnsDefault clamps like every columns source; junk Section values fall through to the design", () => {
    // Rework §6.7 (test repair, P2): MANY_CHOICES (5) — see note above.
    expect(renderSectionComponents([GRID(undefined, undefined, MANY_CHOICES)], BASE, ctxWith({ columnsDefault: 9 }))).toContain("--lg-cols:5");
    const junk = renderSectionComponents([GRID(undefined, undefined, MANY_CHOICES)], BASE, ctxWith({ columnsDefault: Number.NaN, gapDefault: "" }));
    expect(junk).toContain(`--lg-cols:3`);
    expect(junk).toContain(`gap:0.5rem`);
  });

  it("gapDefault reaches the MultiChoiceCardGroup grid (its gap falls back to the design token)", () => {
    expect(renderSectionComponents([MULTI], BASE, ctxWith({ gapDefault: "22px" }))).toContain(
      `style="--lg-cols:2;gap:22px"`,
    );
    expect(renderSectionComponents([MULTI], BASE, ctxWith())).toContain(`style="--lg-cols:2;gap:0.5rem"`);
  });

  it("the below_unit continue slot honours the Section palette (ctx threads into the slot control)", () => {
    const ctx: LeadgenSectionRenderCtx = {
      headline_text: "H",
      subheadline_text: null,
      continue_placement: "below_unit",
      design_overrides: { palette: { button_primary_text: "#333333" } },
    };
    const html = renderSectionComponents([GRID()], BASE, ctx);
    expect(html).toContain("lg-continue-slot");
    expect(html).toContain(`style="color:#333333"`);
  });

  it("absent design_overrides ⇒ byte-identical render vs the no-ctx call (null and {} included)", () => {
    const NODES: LeadgenComponentNode[] = [
      {
        type: "CategoryLabel",
        question_id: "cat1",
        design_overrides: { featureColor: "#E85D26" },
        props: { text: "BUSINESS LOAN" },
      },
      { type: "QuestionHeadline", question_id: "h1", props: { text: "How much do you need?" } },
      GRID({ iconColor: "#1B3A5C", gridGap: "0.75rem" }),
      {
        type: "NumberRangeQuestion",
        question_id: "r1",
        internal_field: "amount",
        design_overrides: { rangeColor: "#1B3A5C" },
        props: { min: 1000, max: 90000, default: 5000, currency_affix: true },
      },
      MULTI,
      {
        type: "ContinueButton",
        question_id: "c1",
        design_overrides: { buttonBackground: "#0F2440", buttonText: "#FFFFFF" },
        props: { label: "Continue" },
      },
    ];
    const noCtx = renderSectionComponents(NODES, BASE);
    expect(renderSectionComponents(NODES, BASE, ctxWith())).toBe(noCtx);
    expect(renderSectionComponents(NODES, BASE, ctxWith(null))).toBe(noCtx);
    expect(renderSectionComponents(NODES, BASE, ctxWith({}))).toBe(noCtx);
    // the stored-hex compat path is byte-preserved inside that render
    expect(noCtx).toContain("--lg-btn-bg:#0F2440");
    expect(noCtx).toContain("background-color:#1B3A5C");
  });
});
