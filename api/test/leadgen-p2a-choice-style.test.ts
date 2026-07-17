// P2a §R-A per-element theme freedom — choice.style VALIDATION (through the
// real validateSectionContent) + RENDER emission (through the real
// renderComponent, source-level). Expected-VALUE assertions throughout (never
// a bare "changed"): the diff-only cascade theme ← node ← choice, the
// state-safe --lg-answer-bg resting-bg custom property, per-choice min-height /
// text color / emphasis, the off-theme #hex escape, and the color-precedence
// error. The COMPUTED-style PAINT of the background is proven in the Playwright
// effect spec (test-ui/leadgen-p2a-element-freedom.gesture.spec.ts).
import { describe, expect, it } from "vitest";
import {
  validateSectionContent,
  type LeadgenComponentNode,
} from "../src/public/leadgen/components/content-schema";
import {
  renderComponent,
  renderSectionComponents,
  type LeadgenSectionDesignOverrides,
  type LeadgenSectionRenderCtx,
} from "../src/public/leadgen/components/presets";
import { defaultFunnelDesign } from "../src/public/leadgen/designs/default-funnel/tokens";
import { baseTokenForRole } from "../src/public/leadgen/designs/theme";

const DESIGN = defaultFunnelDesign;
const content = (components: unknown[]): unknown => ({ components });
const codesOf = (r: ReturnType<typeof validateSectionContent>): string[] => r.errors.map((e) => e.code);

// Resolved role → hex via the SAME pipeline the renderer uses (never a
// hardcoded literal that could drift from the tokens).
const ACCENT = baseTokenForRole(DESIGN, "accent"); // #E85D26
const ERROR = baseTokenForRole(DESIGN, "error"); // #D32F2F
const OFF_THEME_HEX = "#D92D20";

// Split rendered group HTML into its per-<button> fragments (index-aligned to
// the authored choices).
const buttons = (html: string): string[] => html.split("<button").slice(1);

// ---------------------------------------------------------------------------
// VALIDATION
// ---------------------------------------------------------------------------
describe("P2a choice.style — validation", () => {
  const bag = (choice0Style: unknown): unknown =>
    content([
      {
        type: "ButtonAnswerGroup",
        question_id: "q",
        internal_field: "f",
        choices: [
          { label: "A", value: "a", analytics_id: "aa", style: choice0Style },
          { label: "B", value: "b", analytics_id: "ab" },
        ],
      },
    ]);

  it("a full valid style bag validates clean", () => {
    const r = validateSectionContent(
      bag({ size: "l", color_role: "accent", text_color_role: "text_primary", emphasis: "strong" }),
    );
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("the off-theme #hex escape validates clean", () => {
    expect(validateSectionContent(bag({ color_hex: OFF_THEME_HEX })).ok).toBe(true);
    expect(validateSectionContent(bag({ text_color_hex: "#123abc" })).ok).toBe(true);
  });

  it("custom_px size on the [4,600] snap-4 grid validates; off-grid / out-of-range rejected", () => {
    expect(validateSectionContent(bag({ size: { custom_px: 72 } })).ok).toBe(true);
    expect(codesOf(validateSectionContent(bag({ size: { custom_px: 73 } })))).toContain("invalid_choice_style"); // off-grid
    expect(codesOf(validateSectionContent(bag({ size: { custom_px: 800 } })))).toContain("invalid_choice_style"); // over max
    expect(codesOf(validateSectionContent(bag({ size: { custom_px: 2 } })))).toContain("invalid_choice_style"); // under min
  });

  it("color_role AND color_hex both set is an explicit precedence error (not silent)", () => {
    const r = validateSectionContent(bag({ color_role: "accent", color_hex: OFF_THEME_HEX }));
    expect(r.ok).toBe(false);
    expect(codesOf(r)).toContain("invalid_choice_style");
    expect(r.errors.some((e) => /mutually exclusive/.test(e.message))).toBe(true);
  });

  it("text_color_role AND text_color_hex both set is an explicit precedence error", () => {
    expect(codesOf(validateSectionContent(bag({ text_color_role: "error", text_color_hex: OFF_THEME_HEX })))).toContain(
      "invalid_choice_style",
    );
  });

  it("bad vocabulary / shape rejected: unknown key, non-role, bad hex, bad emphasis, bad size preset", () => {
    expect(codesOf(validateSectionContent(bag({ nope: 1 })))).toContain("invalid_choice_style");
    expect(codesOf(validateSectionContent(bag({ color_role: "chartreuse" })))).toContain("invalid_choice_style");
    expect(codesOf(validateSectionContent(bag({ color_hex: "red" })))).toContain("invalid_choice_style");
    expect(codesOf(validateSectionContent(bag({ emphasis: "extra-bold" })))).toContain("invalid_choice_style");
    expect(codesOf(validateSectionContent(bag({ size: "xl" })))).toContain("invalid_choice_style");
    expect(codesOf(validateSectionContent(bag("not-an-object")))).toContain("invalid_choice_style");
  });

  it("arbitrary-CSS injection through a style value is rejected (never escapes the style attribute)", () => {
    expect(codesOf(validateSectionContent(bag({ color_hex: '#fff";}</style><script>x' })))).toContain(
      "invalid_choice_style",
    );
    expect(codesOf(validateSectionContent(bag({ size: "url(x)" })))).toContain("invalid_choice_style");
  });

  it("TwoButtonYesNo props.yesStyle/noStyle validate on TwoButtonYesNo; rejected elsewhere", () => {
    const yn = (props: unknown): unknown =>
      content([{ type: "TwoButtonYesNo", question_id: "q", internal_field: "f", props }]);
    expect(validateSectionContent(yn({ yesStyle: { color_role: "accent" }, noStyle: { emphasis: "strong" } })).ok).toBe(
      true,
    );
    expect(codesOf(validateSectionContent(yn({ yesStyle: { color_role: "bogus" } })))).toContain("invalid_choice_style");
    // misplaced on a non-yes/no type → invalid_field_prop
    const misplaced = content([
      {
        type: "ButtonAnswerGroup",
        question_id: "q",
        internal_field: "f",
        choices: [{ label: "A", value: "a", analytics_id: "aa" }],
        props: { yesStyle: { color_role: "accent" } },
      },
    ]);
    expect(codesOf(validateSectionContent(misplaced))).toContain("invalid_field_prop");
  });
});

// ---------------------------------------------------------------------------
// RENDER (source-level string emission)
// ---------------------------------------------------------------------------
describe("P2a choice.style — render emission (diff-only cascade)", () => {
  it("ButtonAnswerGroup: Allow gets height+bg-var+weight; Disallow gets none (diff-only)", () => {
    const node: LeadgenComponentNode = {
      type: "ButtonAnswerGroup",
      question_id: "q",
      internal_field: "f",
      choices: [
        { label: "Allow", value: "allow", analytics_id: "a1", style: { color_role: "accent", size: "l", emphasis: "strong" } },
        { label: "Disallow", value: "disallow", analytics_id: "a2" },
      ],
    };
    const [allow, disallow] = buttons(renderComponent(node, DESIGN));
    // resting-bg rides the state-safe custom property; height floors at 60px; strong→700
    expect(allow).toContain(`min-height:60px;--lg-answer-bg:${ACCENT};font-weight:700`);
    // Disallow (no style) emits no per-item style at all — byte-identical to pre-P2a
    expect(disallow).not.toContain("--lg-answer-bg");
    expect(disallow).not.toContain("min-height");
    expect(disallow).not.toContain("font-weight");
  });

  it("off-theme color_hex renders EXACTLY as the authored literal", () => {
    const node: LeadgenComponentNode = {
      type: "ButtonAnswerGroup",
      question_id: "q",
      internal_field: "f",
      choices: [{ label: "Warn", value: "w", analytics_id: "a1", style: { color_hex: OFF_THEME_HEX } }],
    };
    expect(renderComponent(node, DESIGN)).toContain(`--lg-answer-bg:${OFF_THEME_HEX}`);
  });

  it("text_color_role renders a DIRECT inline color (resting-safe, no state var)", () => {
    const node: LeadgenComponentNode = {
      type: "ButtonAnswerGroup",
      question_id: "q",
      internal_field: "f",
      choices: [{ label: "A", value: "a", analytics_id: "a1", style: { text_color_role: "error" } }],
    };
    expect(renderComponent(node, DESIGN)).toContain(`color:${ERROR}`);
  });

  it("cascade theme ← node ← choice: node corners still reach a choice that only overrode color", () => {
    const node: LeadgenComponentNode = {
      type: "ButtonAnswerGroup",
      question_id: "q",
      internal_field: "f",
      design_overrides: { corners: "pill" },
      choices: [{ label: "A", value: "a", analytics_id: "a1", style: { color_role: "accent" } }],
    };
    const [only] = buttons(renderComponent(node, DESIGN));
    expect(only).toContain("border-radius:20px"); // node-level corners cascades
    expect(only).toContain(`--lg-answer-bg:${ACCENT}`); // choice-level color overlay
  });

  it("custom_px size renders defensively snapped/clamped min-height", () => {
    const node: LeadgenComponentNode = {
      type: "ButtonAnswerGroup",
      question_id: "q",
      internal_field: "f",
      choices: [{ label: "A", value: "a", analytics_id: "a1", style: { size: { custom_px: 88 } } }],
    };
    expect(renderComponent(node, DESIGN)).toContain("min-height:88px");
  });

  it("card families (Icon/Image/Multi) consume per-card style", () => {
    const mk = (type: LeadgenComponentNode["type"], extra: Record<string, unknown>): LeadgenComponentNode => ({
      type,
      question_id: "q",
      internal_field: "f",
      choices: [{ label: "A", value: "a", analytics_id: "a1", style: { size: "l", color_hex: OFF_THEME_HEX }, ...extra }],
      props: { columns: 2 },
    });
    expect(renderComponent(mk("IconCardAnswerGrid", { icon: "🏢" }), DESIGN)).toContain(`min-height:60px;--lg-answer-bg:${OFF_THEME_HEX}`);
    expect(renderComponent(mk("ImageCardAnswerGrid", { imageMediaId: "m", image_alt: "A" }), DESIGN)).toContain(`--lg-answer-bg:${OFF_THEME_HEX}`);
    expect(renderComponent(mk("MultiChoiceCardGroup", {}), DESIGN)).toContain(`--lg-answer-bg:${OFF_THEME_HEX}`);
  });

  it("TwoButtonYesNo: props.yesStyle styles ONLY the yes button (per-element pair)", () => {
    const node: LeadgenComponentNode = {
      type: "TwoButtonYesNo",
      question_id: "q",
      internal_field: "f",
      props: { yesLabel: "Allow", noLabel: "Disallow", yesStyle: { color_role: "accent", size: "l" } },
    };
    const html = renderComponent(node, DESIGN);
    const yes = html.slice(html.indexOf('data-value="true"') - 120, html.indexOf('data-value="true"'));
    const no = html.slice(html.indexOf('data-value="false"') - 120, html.indexOf('data-value="false"'));
    expect(yes).toContain(`--lg-answer-bg:${ACCENT}`);
    expect(no).not.toContain("--lg-answer-bg");
  });
});

// ---------------------------------------------------------------------------
// ANTI-WIX REGRESSION (P2b FIX-ROUND MINOR-1, adversarial review): a
// choice's color_role is a LIVE pointer into the Section's theme, never a
// frozen snapshot taken at author time — "never the Wix trap where an
// override orphans the element from theme updates" (choiceColorValue's own
// doc comment). Proven through renderSectionComponents + a REAL §9.5 Section
// design_overrides.palette re-point (the SAME ctxWith idiom
// leadgen-token-priority.test.ts uses for node-level layer-4 re-pointing),
// never a bare re-render with a hand-edited token.
// ---------------------------------------------------------------------------
describe("P2a choice.style — anti-Wix regression: a Section palette re-point (MINOR-1)", () => {
  const REPOINTED = "#0011FF"; // deliberately far from ACCENT (#E85D26) — no false-positive overlap
  const ctxWith = (design_overrides?: LeadgenSectionDesignOverrides): LeadgenSectionRenderCtx => ({
    headline_text: "H",
    subheadline_text: null,
    ...(design_overrides !== undefined ? { design_overrides } : {}),
  });

  it("a role-based choice color FOLLOWS the Section's accent re-point (a live pointer, not a snapshot)", () => {
    const node: LeadgenComponentNode = {
      type: "ButtonAnswerGroup",
      question_id: "q",
      internal_field: "f",
      choices: [{ label: "Allow", value: "allow", analytics_id: "a1", style: { color_role: "accent" } }],
    };
    // No re-point: the role resolves to the theme's OWN accent.
    expect(renderSectionComponents([node], DESIGN)).toContain(`--lg-answer-bg:${ACCENT}`);
    // Section re-points accent -> a NEW hex: the SAME role-based choice follows
    // it exactly (never the frozen value it happened to resolve to before).
    const repointed = renderSectionComponents([node], DESIGN, ctxWith({ palette: { accent: REPOINTED } }));
    expect(repointed).toContain(`--lg-answer-bg:${REPOINTED}`);
    expect(repointed).not.toContain(`--lg-answer-bg:${ACCENT}`);
  });

  it("a color_hex choice STAYS FROZEN through the SAME re-point (the deliberate off-theme escape — never a role reference)", () => {
    const node: LeadgenComponentNode = {
      type: "ButtonAnswerGroup",
      question_id: "q",
      internal_field: "f",
      choices: [{ label: "Warn", value: "w", analytics_id: "a1", style: { color_hex: OFF_THEME_HEX } }],
    };
    const repointed = renderSectionComponents([node], DESIGN, ctxWith({ palette: { accent: REPOINTED } }));
    // The re-point targets "accent"; this choice never named a role at all —
    // an off-theme literal is IMMUNE to any theme/palette change by design.
    expect(repointed).toContain(`--lg-answer-bg:${OFF_THEME_HEX}`);
    expect(repointed).not.toContain(REPOINTED);
  });

  it("node-level cascade (design_overrides.corners) still reaches a color-ONLY choice under a re-pointed context", () => {
    const node: LeadgenComponentNode = {
      type: "ButtonAnswerGroup",
      question_id: "q",
      internal_field: "f",
      design_overrides: { corners: "pill" },
      choices: [{ label: "A", value: "a", analytics_id: "a1", style: { color_role: "accent" } }],
    };
    const html = renderSectionComponents([node], DESIGN, ctxWith({ palette: { accent: REPOINTED } }));
    const [only] = buttons(html);
    expect(only).toContain("border-radius:20px"); // node-level cascade intact under re-point
    expect(only).toContain(`--lg-answer-bg:${REPOINTED}`); // choice color follows the re-point too
  });
});
