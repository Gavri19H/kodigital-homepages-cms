// tokens → scoped CSS for the default listicle layout (contract §30.1/§30.6).
//
// A small reusable util that GENERATES stylesheet rules FROM
// `defaultListicleLayoutTokens` — no CSS value in this module is hand-written
// where a measured token exists. Phase 4 uses it for the Section-editor
// preview (§30.6 "renders the section inside the real default SectionWrapper");
// Phase 6 reuses it as the core of `styles.ts` (the full page stylesheet).
//
// PROVISIONAL/BLOCKER token statuses stay untouched (§31.0 honesty): `status`
// and `measured*` metadata fields are skipped by the property mapper, never
// emitted, never resolved here. Pixel parity remains gated on the §31.0
// captures — this stylesheet is content-accurate, not parity-proven.

import { defaultListicleLayoutTokens } from "./tokens";

type TokenGroup = Record<string, unknown>;

const tokens = defaultListicleLayoutTokens;

// camelCase → kebab-case ("fontSizeDesktop" → "font-size-desktop").
function kebab(name: string): string {
  return name.replace(/[A-Z]/g, (ch) => `-${ch.toLowerCase()}`);
}

// Token fields that are metadata, not CSS declarations.
function isMetaField(name: string): boolean {
  return name === "status" || name.startsWith("measured") || name === "instruction";
}

// Map ONE token group to CSS declarations. Rules:
//   * `*Desktop` fields emit as the base (desktop-first) declaration.
//   * `*Mobile` fields collect into the mobile override bucket.
//   * `paddingX`/`paddingY` expand to the two-sided properties.
//   * meta fields (status/measured*/instruction) are skipped.
//   * `extra` allows explicit per-selector declarations that have no direct
//     token field (e.g. list-style comes from `listStyle`).
interface GroupCss {
  base: string[];
  mobile: string[];
}

// One token field → its CSS declaration(s). `paddingX`/`paddingY` expand to
// the two-sided properties; `textColor` is the CSS `color` property.
function fieldDeclarations(prop: string, value: string): string[] {
  if (prop === "paddingX") return [`padding-left:${value}`, `padding-right:${value}`];
  if (prop === "paddingY") return [`padding-top:${value}`, `padding-bottom:${value}`];
  if (prop === "textColor") return [`color:${value}`];
  return [`${kebab(prop)}:${value}`];
}

function groupToDeclarations(group: TokenGroup, only?: ReadonlyArray<string>): GroupCss {
  const base: string[] = [];
  const mobile: string[] = [];
  for (const [rawKey, rawValue] of Object.entries(group)) {
    if (isMetaField(rawKey)) continue;
    if (only !== undefined && !only.includes(rawKey)) continue;
    if (typeof rawValue !== "string") continue;
    const value = rawValue;
    if (rawKey.endsWith("Desktop")) {
      base.push(...fieldDeclarations(rawKey.slice(0, -"Desktop".length), value));
      continue;
    }
    if (rawKey.endsWith("Mobile")) {
      mobile.push(...fieldDeclarations(rawKey.slice(0, -"Mobile".length), value));
      continue;
    }
    base.push(...fieldDeclarations(rawKey, value));
  }
  return { base, mobile };
}

function rule(selector: string, declarations: string[]): string {
  if (declarations.length === 0) return "";
  return `${selector}{${declarations.join(";")}}`;
}

export const DEFAULT_LAYOUT_SCOPE = '[data-layout="default"]';

// Mobile breakpoint: the §30.1 package captures desktop at 1014px and mobile
// at 390px (§31.0 capture pending); overrides apply below 768px.
const MOBILE_MEDIA = "@media (max-width: 767px)";

export interface CuratedColorMaps {
  textColors: Readonly<Record<string, string>>;
  highlights: Readonly<Record<string, string>>;
}

// Curated colour-token rules (§12): <span data-lst-color="…"> /
// <span data-lst-highlight="…"> resolve to the curated palette. The maps are
// passed in (they live with the editor grammar) so this module keeps a single
// direction of truth: tokens/config in, CSS out.
export function curatedColorCss(maps: CuratedColorMaps, scope = DEFAULT_LAYOUT_SCOPE): string {
  const rules: string[] = [];
  for (const [name, value] of Object.entries(maps.textColors)) {
    rules.push(`${scope} [data-lst-color="${name}"]{color:${value}}`);
  }
  for (const [name, value] of Object.entries(maps.highlights)) {
    rules.push(`${scope} [data-lst-highlight="${name}"]{background-color:${value}}`);
  }
  return rules.join("\n");
}

// The token-derived stylesheet for section content under the default layout.
// Selectors bind to the markup the listicle block renderers emit
// (editor/listicle-blocks.ts): .lst-section, .lst-list, .lst-btn,
// .lst-choice-group/.lst-choice-btn, .lst-final-cta, a[data-link-role], …
export function defaultLayoutSectionCss(scope = DEFAULT_LAYOUT_SCOPE): string {
  const out: string[] = [];
  const mobileOut: string[] = [];

  const emit = (selector: string, group: TokenGroup, only?: ReadonlyArray<string>): void => {
    const { base, mobile } = groupToDeclarations(group, only);
    const r = rule(selector, base);
    if (r !== "") out.push(r);
    const m = rule(selector, mobile);
    if (m !== "") mobileOut.push(m);
  };

  // page-level type + colour (§30.1 page; textColor maps to `color`)
  emit(scope, tokens.page, ["backgroundColor", "textColor", "fontFamily"]);

  // article container (§30.1 articleContainer)
  emit(`${scope} .lst-container`, tokens.articleContainer);

  // section wrapper (§30.1 sectionWrapper — BLOCKER status untouched)
  emit(`${scope} .lst-section`, tokens.sectionWrapper);

  // section heading (h2/h3 inside a section)
  emit(`${scope} .lst-section h2, ${scope} .lst-section h3`, tokens.sectionHeading);

  // body paragraph
  emit(`${scope} .lst-section p`, tokens.bodyParagraph);

  // strong text
  emit(`${scope} .lst-section strong`, tokens.strongText);

  // inline offer link (+ hover)
  emit(`${scope} .lst-section a[data-link-role="inline"]`, tokens.inlineLink, [
    "color",
    "fontWeight",
    "textDecoration",
  ]);
  out.push(
    `${scope} .lst-section a[data-link-role="inline"]:hover{color:${tokens.inlineLink.hoverColor};text-decoration:${tokens.inlineLink.hoverTextDecoration}}`,
  );

  // section image + linked image (§30.1 sectionImage)
  emit(
    `${scope} .lst-section .lst-img img, ${scope} .lst-section a[data-link-role="linked_image"] img`,
    tokens.sectionImage,
  );

  // choice button group + buttons (§30.1 choiceButtonGroup / choiceButton)
  emit(`${scope} .lst-choice-group`, tokens.choiceButtonGroup);
  emit(
    `${scope} .lst-choice-btn, ${scope} .lst-btn`,
    tokens.choiceButton,
    [
      "backgroundColor",
      "color",
      "fontFamily",
      "fontSize",
      "fontWeight",
      "lineHeight",
      "borderWidth",
      "borderRadius",
      "paddingY",
      "paddingX",
      "width",
      "maxWidth",
      "minHeight",
      "marginTop",
      "marginBottom",
      "cursor",
    ],
  );
  out.push(
    `${scope} .lst-choice-btn, ${scope} .lst-btn{display:block;box-sizing:border-box;text-align:center;text-decoration:none;border-style:solid;border-color:${tokens.choiceButton.borderColor}}`,
    `${scope} .lst-choice-btn:hover, ${scope} .lst-btn:hover{background-color:${tokens.choiceButton.hoverBackgroundColor}}`,
    `${scope} .lst-choice-btn:active, ${scope} .lst-btn:active{background-color:${tokens.choiceButton.activeBackgroundColor}}`,
    // Outline variant of the §12 `button` block (token colours, inverted).
    `${scope} .lst-btn[data-btn-style="outline"]{background-color:${tokens.choiceButton.color};color:${tokens.choiceButton.backgroundColor};border-width:1px}`,
    // Button row alignment (§12 button.align).
    `${scope} .lst-btn-row{display:flex}`,
    `${scope} .lst-btn-row[data-align="left"]{justify-content:flex-start}`,
    `${scope} .lst-btn-row[data-align="center"]{justify-content:center}`,
    `${scope} .lst-btn-row[data-align="right"]{justify-content:flex-end}`,
  );

  // final text CTA (§30.1 textCta)
  emit(`${scope} .lst-final-cta a`, tokens.textCta, [
    "color",
    "fontSize",
    "fontWeight",
    "lineHeight",
    "textDecoration",
  ]);
  emit(`${scope} .lst-final-cta`, tokens.textCta, ["display", "textAlign", "marginTop", "marginBottom"]);

  // lists (§30.1 listBlock)
  emit(`${scope} .lst-list`, tokens.listBlock, [
    "fontFamily",
    "fontSize",
    "lineHeight",
    "color",
    "marginTop",
    "marginBottom",
    "paddingLeft",
    "listStyle",
  ]);
  out.push(
    `${scope} .lst-list li{margin-bottom:${tokens.listBlock.itemMarginBottom}}`,
    `${scope} ol.lst-list{list-style:decimal;padding-left:1.4em}`,
  );

  // legal / disclaimer paragraphs (§30.1 legalDisclosureBlock)
  emit(`${scope} [data-lst-binding="default.legalDisclosureBlock"]`, tokens.legalDisclosureBlock);

  // spacer (Reference Spacer / Gap — sectionWrapper vertical rhythm)
  out.push(`${scope} .lst-spacer{height:${tokens.sectionWrapper.marginTop}}`);

  const css = out.filter((r) => r !== "").join("\n");
  const mobileCss = mobileOut.filter((r) => r !== "").join("\n");
  return mobileCss === "" ? css : `${css}\n${MOBILE_MEDIA}{\n${mobileCss}\n}`;
}
