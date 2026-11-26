// Backlog X07 — Section Studio "Answer text": align and style the TEXT INSIDE
// every choice of a choice element (Buttons, Icon / Image cards, Yes / No,
// Multi-select), plus a per-choice "Text align" in the choice's Style pop-up.
// Owner (Slack 2026-10-04): "the text inside an element can't be aligned. The
// only option to align something atm is the whole element". Decided
// 2026-11-18: size + weight only (font family stays in the Theme); alignment
// per element AND per choice; precedence choice Style > element Answer text >
// Theme.
//
// Four layers, each through the REAL code:
//   1. RENDER  — presets.ts (the ONE server renderer the live funnel, the Studio
//      canvas and "Preview in a quote" share): expected VALUES per family.
//   2. BYTE-IDENTITY — a fixture Section with NO Answer text renders to the
//      exact pre-X07 bytes (sha256 frozen from the pre-X07 renderer), and
//      setting an align changes ONLY the choice items' alignment declarations.
//   3. SCHEMA  — content-schema.ts validateSectionContent: closed values only.
//   4. STUDIO  — the real inspector markup + the real island functions, run in
//      node:vm against the repo's mini-DOM (test/helpers/mini-dom.ts).
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { runInNewContext } from "node:vm";
import {
  validateSectionContent,
  type LeadgenComponentNode,
} from "../src/public/leadgen/components/content-schema";
import { renderComponent, renderSectionComponents } from "../src/public/leadgen/components/presets";
import { defaultFunnelDesign } from "../src/public/leadgen/designs/default-funnel/tokens";
import { getFunnelDesign } from "../src/public/leadgen/designs/registry";
import { baseTokenForRole, resolveTokens, type ThemeJson } from "../src/public/leadgen/designs/theme";
import {
  renderStudioInspector,
  SECTION_STUDIO_SCRIPT,
  STUDIO_ROLE_LABELS,
  studioTypeMeta,
} from "../src/admin/leadgen/ui-section-studio";
import { miniDocument, type MiniNode } from "./helpers/mini-dom";

type AnyDesign = Parameters<typeof renderComponent>[1];
const DESIGN = defaultFunnelDesign;
const themed = (theme: ThemeJson): AnyDesign => resolveTokens(getFunnelDesign(null), theme).design as AnyDesign;
const LIST_DESIGN = themed({ button_defaults: { layout: "list" } });
const CARD_DESIGN = themed({ button_defaults: { layout: "card" } });

const ACCENT = baseTokenForRole(DESIGN, "accent");
const OFF_THEME = "#B42318";

// Each <button …> opening tag, index-aligned to the rendered choices (the
// "Other" trigger, when present, is the last one).
const buttonTags = (html: string): string[] => html.match(/<button\b[^>]*>/g) ?? [];
const styleOf = (tag: string): string => /\sstyle="([^"]*)"/.exec(tag)?.[1] ?? "";
// Each button's whole markup (open tag … </button>).
const buttonsOf = (html: string): string[] => html.match(/<button\b[\s\S]*?<\/button>/g) ?? [];
const titleStyleOf = (buttonHtml: string, cls: string): string => {
  const m = new RegExp(`<span class="${cls}"(?:\\sstyle="([^"]*)")?>`).exec(buttonHtml);
  return m?.[1] ?? "";
};

const SYSTEM_CHOICES = [
  { label: "Only burglar/intrusion", value: "burglar", analytics_id: "burglar" },
  { label: "Fire detection", value: "fire", analytics_id: "fire" },
  { label: "Both burglar and fire detection", value: "both", analytics_id: "both" },
];
function systemGroup(choiceText?: Record<string, unknown>, choiceStyles: Array<Record<string, unknown> | undefined> = []): LeadgenComponentNode {
  return {
    type: "ButtonAnswerGroup",
    question_id: "q_system",
    internal_field: "system_type",
    props: { selected_marker: "mark", columns: 1, ...(choiceText ? { choice_text: choiceText } : {}) },
    choices: SYSTEM_CHOICES.map((c, i) => (choiceStyles[i] ? { ...c, style: choiceStyles[i] } : { ...c })),
  } as LeadgenComponentNode;
}

// ===========================================================================
// 1. RENDER
// ===========================================================================
describe("X07 render — Buttons (the owner's 'What kind of system do you need?')", () => {
  it("element Text align Left puts the alignment on EVERY choice, in the same box as its circle (text + circle move together)", () => {
    const html = renderComponent(systemGroup({ align: "left" }), DESIGN);
    const btns = buttonsOf(html);
    expect(btns).toHaveLength(3);
    for (const b of btns) {
      // the circle spans live INSIDE the very flex row being aligned
      expect(b).toContain(`<span class="lg-check-hollow" aria-hidden="true"></span>`);
      expect(styleOf(buttonTags(b)[0]!)).toBe("justify-content:flex-start;text-align:left");
    }
  });

  it("a choice's own Text align Right overrides the element's Left for that one choice only", () => {
    const html = renderComponent(systemGroup({ align: "left" }, [undefined, { align: "right" }]), DESIGN);
    const tags = buttonTags(html);
    expect(styleOf(tags[0]!)).toBe("justify-content:flex-start;text-align:left");
    expect(styleOf(tags[1]!)).toBe("justify-content:flex-end;text-align:right");
    expect(styleOf(tags[2]!)).toBe("justify-content:flex-start;text-align:left");
  });

  it("a choice's own Text align works with NO element Answer text (center maps to the centered row)", () => {
    const tags = buttonTags(renderComponent(systemGroup(undefined, [{ align: "center" }]), DESIGN));
    expect(styleOf(tags[0]!)).toBe("justify-content:center;text-align:center");
    expect(styleOf(tags[1]!)).toBe("");
  });

  it("Text color / Bold / Text size L reach every choice — size is the theme's own L step over the button font size", () => {
    const tags = buttonTags(
      renderComponent(systemGroup({ align: "left", text_color_hex: OFF_THEME, emphasis: "strong", size: "l" }), DESIGN),
    );
    // primaryButton.fontSize 0.9375rem × THEME_SIZE_FACTORS.l 1.1 = 1.031rem
    for (const t of tags) {
      expect(styleOf(t)).toBe(`justify-content:flex-start;text-align:left;color:${OFF_THEME};font-weight:700;font-size:1.031rem`);
    }
  });

  it("Text size S is the theme's S step; M is the theme's own size (nothing emitted); a theme role color resolves like every role", () => {
    const s = buttonTags(renderComponent(systemGroup({ size: "s", text_color_role: "accent" }), DESIGN));
    expect(styleOf(s[0]!)).toBe(`color:${ACCENT};font-size:0.844rem`);
    const m = buttonTags(renderComponent(systemGroup({ size: "m" }), DESIGN));
    expect(styleOf(m[0]!)).toBe("");
  });

  // Review fix: the themes paint answer text at 600, so "Text weight: Normal"
  // must emit a regular weight, or picking it would change nothing.
  it("Text weight Normal sets a regular weight (400) — the theme's default answer text is 600", () => {
    const n = buttonTags(renderComponent(systemGroup({ emphasis: "normal" }), DESIGN));
    for (const t of n) expect(styleOf(t)).toBe("font-weight:400");
  });

  it("a choice's OWN text color beats the element's; a choice's own emphasis 'normal' beats the element's Bold", () => {
    const tags = buttonTags(
      renderComponent(
        systemGroup({ text_color_hex: OFF_THEME, emphasis: "strong" }, [{ text_color_role: "accent" }, { emphasis: "normal" }]),
        DESIGN,
      ),
    );
    expect(styleOf(tags[0]!)).toBe(`color:${ACCENT};font-weight:700`);
    expect(styleOf(tags[1]!)).toBe(`color:${OFF_THEME};font-weight:400`);
    expect(styleOf(tags[2]!)).toBe(`color:${OFF_THEME};font-weight:700`);
  });

  it("the 'Other' trigger is one of the element's choices on screen — it takes the element's Answer text too", () => {
    const node = systemGroup({ align: "left" });
    node.props = { ...node.props, other: { enabled: true, label: "Something else", choices: [{ label: "Cameras", value: "cameras", analytics_id: "cameras" }] } };
    const tags = buttonTags(renderComponent(node, DESIGN));
    const trigger = tags.find((t) => t.includes("lg-other-trigger"));
    expect(trigger).toBeDefined();
    expect(styleOf(trigger!)).toBe("justify-content:flex-start;text-align:left");
  });

  it("Answer text wins over the Theme's 'list' button layout ONLY when set", () => {
    const unset = renderComponent(systemGroup(), LIST_DESIGN);
    expect(unset).toContain(`data-btn-layout="list"`);
    for (const t of buttonTags(unset)) expect(styleOf(t)).toBe("");
    const set = buttonTags(renderComponent(systemGroup({ align: "right" }), LIST_DESIGN));
    for (const t of set) expect(styleOf(t)).toBe("justify-content:flex-end;text-align:right");
  });

  it("the Theme's 'card' answer layout: align on the card, color/weight/size on its title span (iconCard title size × 1.1)", () => {
    const btns = buttonsOf(renderComponent(systemGroup({ align: "center", text_color_hex: OFF_THEME, size: "l" }), CARD_DESIGN));
    expect(btns).toHaveLength(3);
    for (const b of btns) {
      expect(b).toContain("lg-tscard");
      expect(styleOf(buttonTags(b)[0]!)).toBe("text-align:center");
      expect(titleStyleOf(b, "lg-tscard-title")).toBe(`color:${OFF_THEME};font-size:1.1rem`);
    }
  });
});

describe("X07 render — Yes / No", () => {
  const yesNo = (props: Record<string, unknown>): LeadgenComponentNode =>
    ({ type: "TwoButtonYesNo", question_id: "q_yn", internal_field: "owner", props }) as LeadgenComponentNode;

  it("element Text align Right reaches both buttons; the Yes button's own Style align (Left) wins for Yes", () => {
    const both = buttonTags(renderComponent(yesNo({ choice_text: { align: "right" } }), DESIGN));
    expect(both.map(styleOf)).toEqual([
      "justify-content:flex-end;text-align:right",
      "justify-content:flex-end;text-align:right",
    ]);
    const own = buttonTags(renderComponent(yesNo({ choice_text: { align: "right" }, yesStyle: { align: "left" } }), DESIGN));
    expect(own.map(styleOf)).toEqual([
      "justify-content:flex-start;text-align:left",
      "justify-content:flex-end;text-align:right",
    ]);
  });
});

describe("X07 render — Icon / Image cards and Multi-select", () => {
  const cards = (type: string, props: Record<string, unknown>, choiceStyle?: Record<string, unknown>): LeadgenComponentNode =>
    ({
      type,
      question_id: "q_cards",
      internal_field: "home_type",
      props,
      choices: [
        { label: "House", value: "house", analytics_id: "house", icon: "home", ...(choiceStyle ? { style: choiceStyle } : {}) },
        { label: "Condo", value: "condo", analytics_id: "condo", icon: "building" },
      ],
    }) as LeadgenComponentNode;

  it("icon cards: Left aligns the card's column (icon + title together); color/weight/size reach the title; the choice's own color wins there", () => {
    const btns = buttonsOf(
      renderComponent(cards("IconCardAnswerGrid", { choice_text: { align: "left", text_color_hex: OFF_THEME, emphasis: "strong", size: "s" } }, { text_color_role: "accent" }), DESIGN),
    );
    expect(btns).toHaveLength(2);
    // the choice's own text color stays on the item too (unchanged pre-X07 overlay) …
    expect(styleOf(buttonTags(btns[0]!)[0]!)).toBe(`color:${ACCENT};align-items:flex-start;text-align:left`);
    expect(styleOf(buttonTags(btns[1]!)[0]!)).toBe("align-items:flex-start;text-align:left");
    // … and, with the element setting a color, the TITLE span shows the winner
    expect(titleStyleOf(btns[0]!, "lg-card-title")).toBe(`color:${ACCENT};font-weight:700;font-size:0.9rem`);
    expect(titleStyleOf(btns[1]!, "lg-card-title")).toBe(`color:${OFF_THEME};font-weight:700;font-size:0.9rem`);
  });

  it("image cards take the same card alignment", () => {
    const node = cards("ImageCardAnswerGrid", { choice_text: { align: "right" } });
    for (const c of node.choices ?? []) {
      delete (c as { icon?: string }).icon;
      Object.assign(c, { imageMediaId: "2026/01/01/x.png", image_alt: "x" });
    }
    for (const t of buttonTags(renderComponent(node, DESIGN))) expect(styleOf(t)).toBe("align-items:flex-end;text-align:right");
  });

  it("multi-select without a ✓ marker: the card column aligns (align-items + text-align)", () => {
    const tags = buttonTags(renderComponent(cards("MultiChoiceCardGroup", { choice_text: { align: "left" } }), DESIGN));
    for (const t of tags) expect(styleOf(t)).toBe("align-items:flex-start;text-align:left");
  });

  it("multi-select with the ✓ marker (ring | text grid): the ring and the text move as one unit", () => {
    const tags = buttonTags(
      renderComponent(cards("MultiChoiceCardGroup", { selected_marker: "mark", choice_text: { align: "center" } }, { align: "right" }), DESIGN),
    );
    expect(styleOf(tags[0]!)).toBe("grid-template-columns:auto auto;justify-content:end;text-align:right");
    expect(styleOf(tags[1]!)).toBe("grid-template-columns:auto auto;justify-content:center;text-align:center");
  });
});

// ===========================================================================
// 2. BYTE-IDENTITY — nothing set ⇒ the pre-X07 bytes, exactly.
// ===========================================================================
// A fixture Section exercising every touched render path: plain buttons (with
// a per-choice style, title/subtitle, the "Other" trigger and the ✓ marker),
// Yes / No with a yesStyle, icon cards (icon/emoji/subtitle/badge/per-choice
// color/"Other"), image cards, and multi-select with and without the marker.
// Rendered under the default design, the Theme "list" layout and the Theme
// "card" layout. The sha256 values were captured from the pre-X07 renderer
// (base 1a555f5b, presets.ts unchanged since ce33206f) — so a single changed
// byte anywhere in this unset output fails here.
const OTHER = { enabled: true, label: "Something else", choices: [{ label: "Cameras", value: "cameras", analytics_id: "cameras" }] };
const FIXTURE: LeadgenComponentNode[] = [
  {
    type: "ButtonAnswerGroup",
    question_id: "q_sys",
    internal_field: "system_type",
    props: { label: "What kind of system do you need?", selected_marker: "mark", columns: 1, other: OTHER },
    choices: [
      { label: "Only burglar/intrusion", value: "burglar", analytics_id: "burglar" },
      { label: "Fire detection", value: "fire", analytics_id: "fire", style: { text_color_role: "accent", emphasis: "strong", size: "l" } },
      { label: "Both burglar and fire detection", value: "both", analytics_id: "both", title: "Both", subtitle: "Burglar + fire" },
    ],
  },
  {
    type: "ButtonAnswerGroup",
    question_id: "q_plain",
    internal_field: "plain",
    choices: [
      { label: "A", value: "a", analytics_id: "a" },
      { label: "B", value: "b", analytics_id: "b" },
      { label: "C", value: "c", analytics_id: "c" },
    ],
  },
  { type: "TwoButtonYesNo", question_id: "q_yn", internal_field: "owner", props: { yesStyle: { text_color_hex: "#123ABC", emphasis: "strong" } } },
  {
    type: "IconCardAnswerGrid",
    question_id: "q_icon",
    internal_field: "home_type",
    props: { other: OTHER },
    choices: [
      { label: "House", value: "house", analytics_id: "house", icon: "home", subtitle: "Detached", badge: "Popular" },
      { label: "Condo", value: "condo", analytics_id: "condo", emoji: "🏢", style: { text_color_hex: "#AA0000" } },
    ],
  },
  {
    type: "ImageCardAnswerGrid",
    question_id: "q_img",
    internal_field: "look",
    choices: [
      { label: "One", value: "one", analytics_id: "one", imageMediaId: "2026/01/01/a.png", image_alt: "A" },
      { label: "Two", value: "two", analytics_id: "two", imageMediaId: "https://example.com/b.png", image_alt: "B" },
    ],
  },
  {
    type: "MultiChoiceCardGroup",
    question_id: "q_multi",
    internal_field: "features",
    choices: [
      { label: "Cameras", value: "cameras", analytics_id: "cameras", subtitle: "Indoor" },
      { label: "Glass break sensors", value: "glass", analytics_id: "glass", style: { emphasis: "strong" } },
    ],
  },
  {
    type: "MultiChoiceCardGroup",
    question_id: "q_multi_mark",
    internal_field: "features2",
    props: { selected_marker: "mark" },
    choices: [
      { label: "Smoke", value: "smoke", analytics_id: "smoke" },
      { label: "Flood", value: "flood", analytics_id: "flood" },
    ],
  },
] as LeadgenComponentNode[];

const sha = (s: string): string => createHash("sha256").update(s).digest("hex");
const PRE_X07_SHA256: Record<"default" | "list" | "card", string> = {
  default: "89e003dae1cdc6d53c0b3b888652e802311103ab3ea897569b1f2c23a924870d",
  list: "cfa5840e62af3fe240d69fcaf5ca097a2c7cc2ef0a3f06552ade2d656d475189",
  card: "2bf7c0a9100f792f48a45bd234da0be322ab62bfbdf661d2af258f441f045e20",
};
const FIXTURE_DESIGNS: Record<"default" | "list" | "card", AnyDesign> = { default: DESIGN, list: LIST_DESIGN, card: CARD_DESIGN };
const withChoiceText = (ct: unknown): LeadgenComponentNode[] =>
  FIXTURE.map((n) => ({ ...n, props: { ...(n.props ?? {}), choice_text: ct } }) as LeadgenComponentNode);

describe("X07 byte-identity — a Section with no Answer text renders exactly as before X07", () => {
  for (const key of ["default", "list", "card"] as const) {
    it(`[${key} design] the unset fixture preserves the pre-X07 bytes outside the two resized images`, () => {
      const html = renderSectionComponents(FIXTURE, FIXTURE_DESIGNS[key]);
      const path = "/media/2026/01/01/a.png";
      const small = `/cdn-cgi/image/height=32,fit=scale-down,format=auto,quality=75${path}`;
      const large = `/cdn-cgi/image/height=64,fit=scale-down,format=auto,quality=75${path}`;
      const local = `src="${large}" alt="A" srcset="${small} 1x, ${large} 2x" width="32" height="32"`;
      const external = 'src="https://example.com/b.png" alt="B"';
      const sizedExternal = `${external} width="32" height="32"`;
      expect(html).toContain(local);
      expect(html).toContain(sizedExternal);
      const original = html.replace(local, `src="${path}" alt="A"`).replace(sizedExternal, external);
      expect(sha(original)).toBe(PRE_X07_SHA256[key]);
    });
  }

  it("an EMPTY Answer text bag is a no-op (Reset leaves nothing behind in the render)", () => {
    for (const key of ["default", "list", "card"] as const) {
      expect(renderSectionComponents(withChoiceText({}), FIXTURE_DESIGNS[key])).toBe(renderSectionComponents(FIXTURE, FIXTURE_DESIGNS[key]));
    }
  });

  it("setting Text align Left changes ONLY the choice items' alignment declarations — every other byte is the unset render", () => {
    // The exact X07 alignment entries per family (presets.ts choiceTextItemEntries).
    const ALIGN_LEFT = [
      "grid-template-columns:auto auto;justify-content:start;text-align:left", // multi-select ✓ grid
      "justify-content:flex-start;text-align:left", // buttons / Yes / No
      "align-items:flex-start;text-align:left", // icon / image / multi-select cards
      "text-align:left", // the Theme's card layout
    ];
    for (const key of ["default", "list", "card"] as const) {
      const unset = renderSectionComponents(FIXTURE, FIXTURE_DESIGNS[key]);
      const left = renderSectionComponents(withChoiceText({ align: "left" }), FIXTURE_DESIGNS[key]);
      expect(left, `${key}: Text align Left must change the render`).not.toBe(unset);
      let stripped = left;
      for (const decl of ALIGN_LEFT) {
        stripped = stripped.replace(new RegExp(` style="${decl}"`, "g"), "");
        stripped = stripped.replace(new RegExp(`;${decl}(?=[;"])`, "g"), "");
        stripped = stripped.replace(new RegExp(`(style=")${decl};`, "g"), "$1");
      }
      expect(stripped, `${key}: the only delta is the alignment entries`).toBe(unset);
    }
  });
});

// ===========================================================================
// 3. SCHEMA — closed values only; old Sections stay valid.
// ===========================================================================
describe("X07 schema — props.choice_text and choice.style.align", () => {
  const codesOf = (r: ReturnType<typeof validateSectionContent>): string[] => r.errors.map((e) => e.code);
  const section = (props?: Record<string, unknown>, style0?: unknown, type = "ButtonAnswerGroup"): unknown => ({
    components: [
      {
        type,
        question_id: "q",
        internal_field: "f",
        ...(props ? { props } : {}),
        ...(type === "TwoButtonYesNo"
          ? {}
          : {
              choices: [
                // icon cards require an icon on every answer (an unrelated rule)
                { label: "A", value: "a", analytics_id: "aa", icon: "home", ...(style0 !== undefined ? { style: style0 } : {}) },
                { label: "B", value: "b", analytics_id: "ab", icon: "home" },
              ],
            }),
      },
    ],
  });

  it("a Section saved before X07 (no choice_text, no align) still validates clean", () => {
    expect(validateSectionContent(section()).errors).toEqual([]);
    expect(validateSectionContent(section({ selected_marker: "mark" }, { text_color_role: "accent", emphasis: "strong" })).ok).toBe(true);
  });

  it("accepts every closed value, on every choice family", () => {
    for (const align of ["left", "center", "right"]) {
      for (const size of ["s", "m", "l"]) {
        for (const emphasis of ["normal", "strong"]) {
          expect(validateSectionContent(section({ choice_text: { align, size, emphasis, text_color_role: "text_primary" } })).errors).toEqual([]);
        }
      }
    }
    expect(validateSectionContent(section({ choice_text: { text_color_hex: OFF_THEME } })).ok).toBe(true);
    for (const type of ["IconCardAnswerGrid", "MultiChoiceCardGroup", "TwoButtonYesNo"]) {
      expect(validateSectionContent(section({ choice_text: { align: "left" } }, undefined, type)).errors, type).toEqual([]);
    }
    expect(validateSectionContent(section(undefined, { align: "right" })).errors).toEqual([]);
  });

  it("refuses an unknown align / size / weight, an unknown key, free CSS and a non-object bag", () => {
    const bad: unknown[] = [
      { align: "justify" },
      { align: "LEFT" },
      { size: "xl" },
      { size: "12px" },
      { emphasis: "bold" },
      { emphasis: "extra-bold" },
      { font_family: "Comic Sans" },
      { css: "text-align:left" },
      { text_color_hex: '#fff";}</style><script>x' },
      { text_color_role: "chartreuse" },
      { text_color_role: "accent", text_color_hex: OFF_THEME },
      "left",
      ["left"],
    ];
    for (const ct of bad) {
      const r = validateSectionContent(section({ choice_text: ct }));
      expect(r.ok, JSON.stringify(ct)).toBe(false);
      expect(codesOf(r), JSON.stringify(ct)).toContain("invalid_choice_style");
    }
  });

  it("refuses an unknown per-choice align (same invalid_choice_style the Style pop-up's other values use), naming 'Text align' and its values", () => {
    for (const align of ["justify", "start", 1, null]) {
      const r = validateSectionContent(section(undefined, { align }));
      expect(r.ok, String(align)).toBe(false);
      const err = r.errors.find((e) => e.path === "components[0].choices[0].style.align");
      expect(err?.code, String(align)).toBe("invalid_choice_style");
      expect(err?.message, String(align)).toBe("An answer's 'Text align' must be one of: left, center or right. Pick one of those.");
    }
    const yn = validateSectionContent(section({ yesStyle: { align: "middle" } }, undefined, "TwoButtonYesNo"));
    expect(yn.errors.map((e) => [e.code, e.path])).toEqual([["invalid_choice_style", "components[0].props.yesStyle.align"]]);
  });

  it("choice_text on a non-choice element (Dropdown / Text) is refused as a misplaced field", () => {
    expect(codesOf(validateSectionContent(section({ choice_text: { align: "left" } }, undefined, "DropdownQuestion")))).toContain("invalid_field_prop");
    const text = { components: [{ type: "FreeTextQuestion", question_id: "q", internal_field: "f", props: { choice_text: { align: "left" } } }] };
    expect(codesOf(validateSectionContent(text))).toContain("invalid_field_prop");
  });
});

// ===========================================================================
// 4. STUDIO — the real inspector markup + the real island functions.
// ===========================================================================
function sliceIslandFunction(name: string): string {
  const marker = `function ${name}(`;
  const start = SECTION_STUDIO_SCRIPT.indexOf(marker);
  expect(start, `island function ${name} present`).toBeGreaterThan(-1);
  const open = SECTION_STUDIO_SCRIPT.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < SECTION_STUDIO_SCRIPT.length; i += 1) {
    const ch = SECTION_STUDIO_SCRIPT[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return SECTION_STUDIO_SCRIPT.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced ${name}`);
}
function sliceIslandVar(name: string): string {
  const marker = `var ${name} = `;
  const start = SECTION_STUDIO_SCRIPT.indexOf(marker);
  expect(start, `island var ${name} present`).toBeGreaterThan(-1);
  const at = start + marker.length;
  const openCh = SECTION_STUDIO_SCRIPT[at]!;
  const closeCh = openCh === "[" ? "]" : "}";
  let depth = 0;
  for (let i = at; i < SECTION_STUDIO_SCRIPT.length; i += 1) {
    if (SECTION_STUDIO_SCRIPT[i] === openCh) depth += 1;
    else if (SECTION_STUDIO_SCRIPT[i] === closeCh) {
      depth -= 1;
      if (depth === 0) return `${SECTION_STUDIO_SCRIPT.slice(start, i + 1)};`;
    }
  }
  throw new Error(`unbalanced ${name}`);
}
// The REAL init-time wiring for the group (the lines the island runs once on
// load), sliced verbatim from the shipped script.
function sliceAnswerTextWiring(): string {
  const start = SECTION_STUDIO_SCRIPT.indexOf("  // X07: the Content tab's Answer text segmented controls + its Reset link.");
  expect(start, "Answer text wiring present").toBeGreaterThan(-1);
  const end = SECTION_STUDIO_SCRIPT.indexOf("  var textBlockRoleEl", start);
  return SECTION_STUDIO_SCRIPT.slice(start, end);
}

const ROLES = { text_primary: "#1A1F36", accent: "#E85D26", brand_primary: "#1B3A5C" };
const ISLAND_FUNCS = [
  "trimStr",
  "isHexColor",
  "roleLabelOf",
  "typeMeta",
  "capsOf",
  "cap",
  "clearChildren",
  "ensureObj",
  "cleanupEmpty",
  "snapHeightCustomPx",
  "buildStyleColorAxis",
  "paintStyleColorAxis",
  "buildChoiceStyleControl",
  "answerTextOf",
  "writeAnswerText",
  "setAnswerTextValue",
  "resetAnswerText",
  "populateAnswerTextBlock",
];
const ISLAND_VARS = ["ANSWER_TEXT_KEYS", "CHOICE_TEXT_ALIGN_OPTIONS_UI", "CHOICE_SIZE_PRESETS_UI", "CHOICE_SIZE_PRESET_LABELS_UI"];

interface StudioProbe {
  doc: ReturnType<typeof miniDocument>;
  sandbox: Record<string, unknown>;
  run(expr: string): unknown;
  block(): MiniNode;
  seg(key: string, value: string): MiniNode;
}
function studioProbe(node: Record<string, unknown>): StudioProbe {
  const doc = miniDocument(`<html><body>${renderStudioInspector(DESIGN as never, null)}</body></html>`);
  const sandbox: Record<string, unknown> = {
    document: doc,
    studioMeta: { types: studioTypeMeta(), roles: ROLES, role_labels: STUDIO_ROLE_LABELS },
    NODE: node,
    CHANGES: 0,
  };
  const source = [
    "var ROLE_VALUES = studioMeta.roles || {};",
    "var ROLE_LABELS = studioMeta.role_labels || {};",
    "var HEIGHT_PX_MIN = 4, HEIGHT_PX_MAX = 600, HEIGHT_PX_GRID = 4;",
    "function selectedNode() { return NODE; }",
    "function afterModelChange() { CHANGES += 1; }",
    ...ISLAND_VARS.map(sliceIslandVar),
    ...ISLAND_FUNCS.map(sliceIslandFunction),
    sliceAnswerTextWiring(),
  ].join("\n");
  runInNewContext(source, sandbox);
  const run = (expr: string): unknown => runInNewContext(expr, sandbox);
  return {
    doc,
    sandbox,
    run,
    block: () => doc.querySelector("[data-answer-text-block]")!,
    seg: (key, value) => doc.querySelector(`[data-set-answer-text="${key}"][data-answer-text-value="${value}"]`)!,
  };
}
const activeSegs = (p: StudioProbe): string[] =>
  p.doc
    .querySelectorAll("[data-set-answer-text]")
    .filter((b) => b.className === "active")
    .map((b) => `${b.getAttribute("data-set-answer-text")}=${b.getAttribute("data-answer-text-value")}`);

describe("X07 Studio — the Content tab 'Answer text' group", () => {
  const inspector = renderStudioInspector(DESIGN as never, null);

  it("sits directly below 'Answer format' with the eyebrow, the yellow-star affects line and the four controls + Reset", () => {
    const fmt = inspector.indexOf(`<div class="studio-panel-eyebrow">Answer format</div>`);
    const txt = inspector.indexOf(`<div class="studio-panel-eyebrow">Answer text</div>`);
    expect(fmt).toBeGreaterThan(-1);
    expect(txt).toBeGreaterThan(fmt);
    // directly below: the group opens right after Answer format's LAST control
    // (the slider's Provider-format note), with only its own divider between
    const lastFmtControl = inspector.indexOf("data-range-format-note");
    expect(lastFmtControl).toBeGreaterThan(fmt);
    const between = inspector.slice(inspector.indexOf("</p>", lastFmtControl) + "</p>".length, txt);
    expect(between.replace(/\s+/g, "")).toBe(`<divdata-answer-text-blockhidden><divclass="studio-hr"></div>`);
    const block = inspector.slice(inspector.indexOf("data-answer-text-block"), inspector.indexOf("data-answer-text-reset"));
    expect(block).toContain(`<div class="studio-scope-affects">`);
    expect(block).toContain(`<span class="studio-scope-affects-text">Affects: every choice in this element.</span>`);
    for (const label of ["Text align", "Text weight", "Text size"]) expect(block).toContain(`<label class="form-label">${label}</label>`);
    expect(block).toContain("data-answer-text-color");
    const p = studioProbe({ type: "ButtonAnswerGroup", question_id: "q", choices: [] });
    const segLabels = p.doc.querySelectorAll("[data-set-answer-text]").map((b) => b.textContent);
    expect(segLabels).toEqual(["Left", "Center", "Right", "Normal", "Bold", "S", "M", "L"]);
    expect(p.doc.querySelector("[data-answer-text-reset]")!.textContent).toBe("Reset");
  });

  it("shows for the choice families only (Buttons, Yes / No, Icon / Image cards, Multi-select); hidden for Dropdown and Text", () => {
    for (const type of ["ButtonAnswerGroup", "TwoButtonYesNo", "IconCardAnswerGrid", "ImageCardAnswerGrid", "MultiChoiceCardGroup"]) {
      const p = studioProbe({ type, question_id: "q" });
      p.run("populateAnswerTextBlock(NODE)");
      expect(p.block().hidden, type).toBe(false);
    }
    for (const type of ["DropdownQuestion", "FreeTextQuestion"]) {
      const p = studioProbe({ type, question_id: "q" });
      p.run("populateAnswerTextBlock(NODE)");
      expect(p.block().hidden, type).toBe(true);
    }
  });

  it("unset = no segment selected; each control writes its closed value to props.choice_text and repaints", () => {
    const node: Record<string, unknown> = { type: "ButtonAnswerGroup", question_id: "q", internal_field: "f", choices: SYSTEM_CHOICES.map((c) => ({ ...c })) };
    const p = studioProbe(node);
    p.run("populateAnswerTextBlock(NODE)");
    expect(activeSegs(p)).toEqual([]);
    p.seg("align", "left").click();
    expect(node["props"]).toEqual({ choice_text: { align: "left" } });
    p.seg("emphasis", "strong").click();
    p.seg("size", "l").click();
    expect(node["props"]).toEqual({ choice_text: { align: "left", emphasis: "strong", size: "l" } });
    expect(activeSegs(p)).toEqual(["align=left", "emphasis=strong", "size=l"]);
    expect(p.sandbox["CHANGES"]).toBe(3);
    // Text color — the per-choice Style pop-up's own control, mounted here
    const mount = p.doc.querySelector("[data-answer-text-color]")!;
    expect(mount.querySelector(".lg-choice-style-swatch-row")).not.toBeNull();
    mount.querySelector('[data-choice-role-swatch="accent"]')!.click();
    expect((node["props"] as Record<string, unknown>)["choice_text"]).toEqual({ align: "left", emphasis: "strong", size: "l", text_color_role: "accent" });
    const hex = p.doc.querySelector("[data-answer-text-color] [data-choice-hex-input]")!;
    hex.value = OFF_THEME;
    hex.fire("change");
    expect((node["props"] as Record<string, unknown>)["choice_text"]).toEqual({ align: "left", emphasis: "strong", size: "l", text_color_hex: OFF_THEME });
    expect(p.doc.querySelector("[data-answer-text-color] [data-choice-hex-input]")!.value).toBe(OFF_THEME);
    // the saved shape passes the save gate, and a reload (JSON round-trip) paints the same selection
    expect(validateSectionContent({ components: [node] }).errors).toEqual([]);
    const reloaded = studioProbe(JSON.parse(JSON.stringify(node)) as Record<string, unknown>);
    reloaded.run("populateAnswerTextBlock(NODE)");
    expect(activeSegs(reloaded)).toEqual(["align=left", "emphasis=strong", "size=l"]);
    expect(reloaded.doc.querySelector("[data-answer-text-color] [data-choice-hex-input]")!.value).toBe(OFF_THEME);
  });

  it("Reset clears the whole group back to the Theme (props.choice_text removed; other props kept)", () => {
    const node: Record<string, unknown> = {
      type: "ButtonAnswerGroup",
      question_id: "q",
      props: { selected_marker: "mark", choice_text: { align: "right", emphasis: "strong", size: "s", text_color_role: "accent" } },
    };
    const p = studioProbe(node);
    p.run("populateAnswerTextBlock(NODE)");
    expect(activeSegs(p)).toEqual(["align=right", "emphasis=strong", "size=s"]);
    p.doc.querySelector("[data-answer-text-reset]")!.click();
    expect(node["props"]).toEqual({ selected_marker: "mark" });
    expect(activeSegs(p)).toEqual([]);
    // and with nothing else in props, Reset leaves no empty props bag behind
    const bare: Record<string, unknown> = { type: "IconCardAnswerGrid", question_id: "q", props: { choice_text: { align: "left" } } };
    const p2 = studioProbe(bare);
    p2.run("populateAnswerTextBlock(NODE)");
    p2.doc.querySelector("[data-answer-text-reset]")!.click();
    expect("props" in bare).toBe(false);
  });
});

describe("X07 Studio — the per-choice Style pop-up's 'Text align'", () => {
  function popup(initial: unknown): { p: StudioProbe; writes: unknown[]; wrap: MiniNode } {
    const p = studioProbe({ type: "ButtonAnswerGroup", question_id: "q" });
    const writes: unknown[] = [];
    p.sandbox["WRITES"] = writes;
    p.sandbox["INITIAL"] = initial;
    const ctl = p.run("buildChoiceStyleControl(INITIAL, function (s) { WRITES.push(s === null ? null : JSON.parse(JSON.stringify(s))); })") as { wrap: MiniNode };
    return { p, writes, wrap: ctl.wrap };
  }
  const alignBtn = (wrap: MiniNode, v: string): MiniNode => wrap.querySelector(`[data-choice-style-align="${v}"]`)!;
  const activeAlign = (wrap: MiniNode): string[] =>
    wrap.querySelectorAll("[data-choice-style-align]").filter((b) => b.className === "active").map((b) => b.getAttribute("data-choice-style-align")!);

  it("offers Use element / Left / Center / Right, with 'Use element' selected when the choice stores no align", () => {
    const { wrap } = popup(undefined);
    expect(wrap.querySelectorAll("[data-choice-style-align]").map((b) => b.textContent)).toEqual(["Use element", "Left", "Center", "Right"]);
    expect(activeAlign(wrap)).toEqual([""]);
  });

  it("writes choice.style.align, and 'Use element' clears it (no stored value)", () => {
    const { writes, wrap } = popup(undefined);
    alignBtn(wrap, "right").click();
    expect(writes.at(-1)).toEqual({ align: "right" });
    expect(activeAlign(wrap)).toEqual(["right"]);
    alignBtn(wrap, "").click();
    expect(writes.at(-1)).toBeNull();
    expect(activeAlign(wrap)).toEqual([""]);
  });

  it("keeps a stored align when another Style value changes (and keeps the other values when align changes)", () => {
    const { writes, wrap } = popup({ align: "center", emphasis: "strong", text_color_role: "accent" });
    expect(activeAlign(wrap)).toEqual(["center"]);
    const bold = wrap.querySelector("[data-choice-style-bold]")!;
    bold.checked = false;
    bold.fire("change");
    expect(writes.at(-1)).toEqual({ align: "center", text_color_role: "accent" });
    alignBtn(wrap, "left").click();
    expect(writes.at(-1)).toEqual({ align: "left", text_color_role: "accent" });
  });
});
