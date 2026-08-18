// tokens → scoped static-chrome CSS for the default funnel design (contract
// 05 §14.2/§14.3). Mirrors the Listicles tokens-to-css discipline
// (public/listicle/layouts/default/{tokens-to-css,styles}.ts): NO CSS value
// here is hand-written where a token exists; every rule reads a design token.
//
// §14.3 boundary: this module is the STATIC chrome — page / header / progress /
// headline / inputs / buttons / cards / badge / range / validation, plus the
// interaction STATES (hover / selected / focus / disabled / error / loading)
// that inline per-instance styles cannot express. Per-INSTANCE styling (a
// choice's icon, a range's filled width, a grid's column count) is emitted
// inline by the presets (components/presets.ts). No preset emits a `<style>`
// block that reads instance data (§14.3 / §14.10) — R2 P1 §① adds the single
// bounded exception, and it reads NO instance data: when a SECTION's content
// opts a question into the §6.6 ✓ marker on a design whose theme does not,
// presets.ts emits this file's OWN `selectedMarkRules` (exported below,
// state-selector rules an inline attribute cannot express) once for that
// section. Content-gated, so a funnel that never opts in is byte-unchanged.
//
// Everything is scoped under a root data-attribute so funnel chrome can never
// leak into the surrounding admin/page CSS.

import type { DefaultFunnelDesign } from "./tokens";
// v2.5 (13 §13.1): the theme module's widened design (EffectiveFunnelDesign =
// the SAME FunnelDesign structure with resolved/scaled leaf values) + the role
// vocabulary the frame-region rules resolve through. theme.ts has no runtime
// import back into this module (its registry import is type-only) — no cycle.
// P6: readButtonStyle reads the theme's resolved button-style triple off the
// design stash (Symbol-keyed; undefined for a legacy/un-themed design).
// R2 P8 M2: readButtonCasing reads theme_json.button_defaults.casing off its
// own (separate) stash — see theme.ts's BUTTON_CASING_STASH note for why the
// casing does not ride the button-style triple.
import { FUNNEL_TOKEN_ROLES, baseTokenForRole, readButtonCasing, readButtonStyle } from "../theme";
import type { EffectiveButtonStyle, EffectiveFunnelDesign } from "../theme";
// P6 self-hosted fonts (build-time-vendored WOFF2 Latin subsets, base64 data:
// URLs — ZERO external font requests). selfHostedFontFaceCss emits the
// @font-face blocks for a given set of CSS family names.
import { LEADGEN_SELF_HOSTED_FONT_FAMILIES, selfHostedFontFaceCss } from "../fonts.generated";

// The scope every rule is nested under. Stage B sets this attribute on the
// funnel shell root; the same attribute value is the design id.
export const FUNNEL_DESIGN_SCOPE_ATTR = "data-funnel-design";
export const DEFAULT_FUNNEL_SCOPE = '[data-funnel-design="default-funnel"]';

function decls(pairs: Record<string, string>): string {
  return Object.entries(pairs)
    .map(([k, v]) => `${k}:${v}`)
    .join(";");
}

function rule(selector: string, pairs: Record<string, string>): string {
  const body = decls(pairs);
  return body === "" ? "" : `${selector}{${body}}`;
}

// R2 P7 (owner #D2 "where is the icon on track??? how do I define it????") —
// the built-in glyph set behind frames.ts FRAME_PROGRESS_ICONS. Each entry is a
// single-path 24×24 SVG used as a CSS MASK (so the mark takes the design's card
// colour and needs no per-theme asset); `dot` paints no glyph (the bare disc,
// byte-identical to the pre-P7 thumb) and `site_logo` paints a real image, so
// neither appears here. Kept as code constants — never operator input — so the
// data URI below can never carry authored bytes.
const PROGRESS_ICON_MASKS: ReadonlyArray<readonly [string, string]> = [
  [
    "car",
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path d='M5 11l1.5-4.5A2 2 0 0 1 8.4 5h7.2a2 2 0 0 1 1.9 1.5L19 11h1a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-1v1a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1v-1H8v1a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-1H4a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1h1zm2.1 0h9.8l-1-3H8.1l-1 3zM7 13.5a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4zm10 0a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4z'/></svg>",
  ],
  [
    "shield",
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path d='M12 2l8 3v6.2c0 4.7-3.2 8.9-8 10.8-4.8-1.9-8-6.1-8-10.8V5l8-3z'/></svg>",
  ],
  [
    "check",
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path d='M9.6 17.4l-5-5 1.8-1.8 3.2 3.2 8-8L19.4 7.6z'/></svg>",
  ],
  [
    "star",
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path d='M12 2.6l2.9 5.9 6.5.9-4.7 4.6 1.1 6.4-5.8-3-5.8 3 1.1-6.4L2.6 9.4l6.5-.9z'/></svg>",
  ],
];

// The `#` and `<`/`>` bytes in a raw SVG data URI break CSS parsing in some
// engines; percent-encode the whole document (the same discipline the dropdown
// chevron rule above already applies to its one interpolated token).
function svgDataUri(svg: string): string {
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

// v2.5 13 §13.1 chrome-CSS extension switch. `frameRegions: true` appends the
// frame-region rules (`.lg-frame-*`, emitted by designs/frame.ts markup) into
// the SAME stylesheet — still one <style> block in the shell. Default OFF:
// every existing caller gets byte-identical output (the legacy shell pin +
// the render/parity regression suites embed the current CSS).
export interface FunnelChromeCssOpts {
  frameRegions?: boolean;
}

// P6 (deliverable 1): the resolved-design font slots that may carry a
// self-hosted family stack (the applyDisplayFont + applyBodyFont targets in
// theme.ts). funnelChromeCss scans these for a self-hosted CSS family name and
// emits ONLY those families' @font-face — so a live page requests ZERO
// external fonts, and a legacy design (Sora/Literata/Newsreader — none
// self-hosted) matches nothing and emits nothing (byte-identical to pre-P6).
const FONT_SLOT_PATHS: ReadonlyArray<readonly [group: string, key: string]> = [
  ["page", "fontFamily"],
  ["page", "fontDisplay"],
  ["header", "logoFontFamily"],
  ["headline", "fontFamily"],
  ["rangeQuestion", "valueFontFamily"],
  ["successState", "headingFontFamily"],
  ["primaryButton", "fontFamily"],
];

// Scan the resolved design's font slots and return the @font-face CSS for
// every self-hosted family actually referenced (quoted family name, as
// THEME_FONT_STACKS emits). "" when none are referenced.
function selfHostedFontFacesForDesign(design: DefaultFunnelDesign | EffectiveFunnelDesign): string {
  const referenced = new Set<string>();
  const d = design as unknown as Record<string, Record<string, unknown> | undefined>;
  for (const [group, key] of FONT_SLOT_PATHS) {
    const stack = d[group]?.[key];
    if (typeof stack !== "string") continue;
    for (const family of LEADGEN_SELF_HOSTED_FONT_FAMILIES) {
      if (stack.includes(`'${family}'`)) referenced.add(family);
    }
  }
  return selfHostedFontFaceCss(referenced);
}

// P6 (deliverable 3): the THEME-level button-style rules (Images 38-40). These
// are ADDITIVE, higher-specificity rules keyed on the data attributes presets
// stamps (data-btn-fill / data-btn-layout / data-card-select) ONLY when a
// theme opts into a non-default look — the base .lg-btn / .lg-btn-answer /
// .lg-card rules are NEVER edited, so a theme without a button style (and every
// legacy funnel) emits none of these and stays byte-identical. Pushed into the
// base `out`/`mobile` arrays before the frame-region block, so the no-frame
// sheet stays a byte-stable prefix of the framed sheet (13 §13.1).
function pushButtonStyleRules(
  scope: string,
  design: DefaultFunnelDesign | EffectiveFunnelDesign,
  bs: EffectiveButtonStyle,
  out: string[],
  // §8.4 gap round (2026-07-23): the "card" layout's mobile-375 shrink
  // (title/subtitle font-size + padding + mark-glyph offset, P0 pack data-pin
  // 8.4-mobile-title-subtitle-cards) is the FIRST button-style rule needing
  // the mobile array — every prior axis (fill/list/mark) was desktop-only.
  mobile: string[],
): void {
  const { radius, shadow, color, spacing } = design;

  // FILL — outline: transparent primary/continue with a coloured 2px border,
  // and a heavier accent border on answer chips.
  if (bs.fill === "outline") {
    out.push(
      rule(`${scope} .lg-continue[data-btn-fill="outline"],${scope} .lg-auto-advance[data-btn-fill="outline"]`, {
        background: "transparent",
        color: color.primary,
        border: `2px solid ${color.primary}`,
      }),
      rule(`${scope} .lg-answer-group[data-btn-fill="outline"] .lg-btn-answer`, {
        "border-width": "2px",
        "border-color": color.primary,
      }),
    );
  }
  // FILL — soft (Image 39): pill radius + a soft elevation shadow on the
  // primary/continue, answer chips, and cards ("soft-shadow pill stacks").
  if (bs.fill === "soft") {
    out.push(
      rule(`${scope} .lg-continue[data-btn-fill="soft"],${scope} .lg-auto-advance[data-btn-fill="soft"]`, {
        "border-radius": radius.full,
        "box-shadow": shadow.lg,
      }),
      rule(`${scope} .lg-answer-group[data-btn-fill="soft"] .lg-btn-answer`, {
        "border-radius": radius.full,
        "box-shadow": shadow.lg,
      }),
      rule(`${scope} .lg-card-grid[data-btn-fill="soft"] .lg-card`, {
        "border-radius": radius.lg,
        "box-shadow": shadow.lg,
      }),
    );
  }
  // LAYOUT — list (Image 38): full-width, left-aligned, single-column
  // "list-buttons". On an ANSWER GROUP the chips become a single left-aligned
  // column (one line — the label). On a CARD GRID (which legitimately renders
  // title + subtitle) the cards become a single left-aligned column of TWO-LINE
  // list rows (icon + title + subtitle) — the operator's Image38 two-line list.
  if (bs.layout === "list") {
    out.push(
      rule(`${scope} .lg-answer-group[data-btn-layout="list"]`, { "grid-template-columns": "1fr" }),
      rule(`${scope} .lg-answer-group[data-btn-layout="list"] .lg-btn-answer`, {
        "justify-content": "flex-start",
        "text-align": "left",
        "min-height": "56px",
        padding: `${spacing.md} ${spacing.lg}`,
      }),
      rule(`${scope} .lg-card-grid[data-btn-layout="list"]`, { "grid-template-columns": "1fr" }),
      rule(`${scope} .lg-card-grid[data-btn-layout="list"] .lg-card`, {
        "align-items": "flex-start",
        "justify-content": "center",
        "text-align": "left",
      }),
    );
  }
  // LAYOUT — card (Image23, §8.4 gap round 2026-07-23): the theme's NEW
  // Answer-layout value — full-width title+subtitle cards, ONE per row
  // (P0 pack docs/leadgen/rework/design-pack/themes.html data-pin
  // 8.4-title-subtitle-card-rest/8.4-tscard-hover/8.4-tscard-selected/
  // 8.4-tscard-selected-wash/8.4-tscard-error). presets.ts stamps
  // .lg-tscard ONLY on buttons/YesNo when this theme axis resolves "card"
  // (buttonInnerContent), so every rule below is unambiguously scoped by
  // that ONE class — no container-attribute qualifier needed on the item
  // rules. Every color/radius value below reuses this design's EXISTING
  // measured tokens 1:1 (the pack's own tscard hex values are close-but-not
  // -byte-identical to this palette; each mapped to its numerically closest
  // existing token — the SAME "no new value invented" discipline
  // iconCardDepthSlots, above the base .lg-card-grid rules, already
  // established for a different §8.4 feature):
  //   background #fff -> color.card (EXACT); title color #1A1F36 ->
  //   page.textColor (EXACT); rest subtitle color #8A93A3 -> page.
  //   textLightColor (#718096, the lightest/most-muted existing text
  //   color); rest border #E1E6EE -> color.borderLight (#E8ECF2, closest);
  //   hover border #C7D6E6 -> color.border (#D2D9E5, closest); hover/mark-
  //   selected background #F7F9FC -> color.primaryGhost (#F2F6FA,
  //   closest); mark-selected border #1B3A5C = color.primary (EXACT — the
  //   wash-selected background/border ALREADY comes for free from the
  //   EXISTING generic .lg-btn.lg-btn-answer[aria-checked="true"] rule
  //   below in this same file, which already resolves to color.primaryWash
  //   #E8EEF4, itself the closest existing token to the pack's wash bg
  //   #EAF0F6 — .lg-tscard needs NO new wash-selected border/background
  //   rule at all); wash-selected subtitle color #41495B -> page.
  //   textSecondaryColor (#4A5568, closest); error border #B23A2C ->
  //   color.error (#D32F2F, same red family, the only error role this
  //   palette has); radius 14px = radius.lg (EXACT); title/subtitle
  //   font-size 17px/12.5px -> iconCard.titleFontSize (1rem) / subheadline.
  //   fontSize (0.825rem) — both ~1px tolerance, the SAME tolerance the
  //   §6.6 marker reuse below already takes (17px/19px hollow/badge vs the
  //   pack's own 20px mark-glyph). subtitle margin-top 4px = spacing.xs
  //   (EXACT). Genuinely NEW measurements (no existing token to reuse —
  //   the same category as iconCardDepthSlots.badgePadding "2px 8px"
  //   introducing a new precise measurement for ITS new component):
  //   desktop padding "18px 20px", the inter-card gap "8px" (spacing.sm,
  //   closest to the pack's 10px — no exact scale step exists either side),
  //   and the mobile-only sizes below.
  if (bs.layout === "card") {
    out.push(
      // container: ONE column, full-width stack (never a multi-column
      // grid — Image23's own anatomy is always a vertical list of cards).
      rule(`${scope} .lg-answer-group[data-btn-layout="card"]`, {
        "grid-template-columns": "1fr",
        gap: spacing.sm,
      }),
      // base (rest) tscard.
      rule(`${scope} .lg-tscard`, {
        display: "block",
        width: "100%",
        "text-align": "left",
        "border-radius": radius.lg,
        padding: "18px 20px",
        background: color.card,
        border: `1.6px solid ${color.borderLight}`,
        position: "relative", // anchors the §6.6 marker's corner reposition below.
      }),
      rule(`${scope} .lg-tscard-title`, {
        display: "block",
        "font-size": design.iconCard.titleFontSize,
        "font-weight": "700",
        color: design.page.textColor,
      }),
      rule(`${scope} .lg-tscard-subtitle`, {
        display: "block",
        "font-size": design.subheadline.fontSize,
        color: design.page.textLightColor,
        "margin-top": spacing.xs,
      }),
      // hover.
      rule(`${scope} .lg-tscard:hover`, {
        "border-color": color.border,
        background: color.primaryGhost,
      }),
      // error — R2 P8 M2 / S3.10. WAS `.lg-tscard[data-error="true"]`, which
      // could never match: NOTHING in the visitor runtime writes a
      // `data-error` attribute (every `data-error` hit in src/ is the
      // unrelated admin `data-error-for` slot id). Re-pointed at the state the
      // runtime really produces — runtime/render.ts:228 setFieldError adds
      // ERROR_CLASS ("lg-error") to the owning `[data-lg-field]` block, which
      // for this pack is the `.lg-answer-group` root (presets.ts:1491
      // hydration()), and the .lg-tscard chips are its descendants. Re-pointed
      // rather than removed: the pack's error affordance is real; its selector
      // was not. NO producer was invented to make the old selector reachable.
      rule(`${scope} .lg-error .lg-tscard`, { "border-color": color.error }),
      // the "Other" trigger's ONLY anatomy delta from a plain choice card —
      // title left, chevron right (the pack's own trailing-affordance row).
      rule(`${scope} .lg-tscard.lg-other-trigger`, {
        display: "flex",
        "align-items": "center",
        "justify-content": "space-between",
      }),
      // §6.6 marker interplay: the SAME .lg-check-hollow/.lg-check-badge
      // pair every other layout already renders (selectedMarkerMarkup) —
      // repositioned to the pack's corner-badge placement ONLY inside a
      // tscard (elsewhere it stays the existing leading-inline position).
      // Orthogonal to the base mark rules above (those set display:none/
      // flex for the resting/selected SWAP; these set position/top/right),
      // so no specificity conflict — both apply together.
      rule(`${scope} .lg-tscard .lg-check-hollow, ${scope} .lg-tscard .lg-check-badge`, {
        position: "absolute",
        top: "14px",
        right: "16px",
      }),
      // wash-selected subtitle darkens for readability against the wash
      // background — ONLY when this SPECIFIC card resolved to 'wash' (no
      // mark badge present), never when it resolved to 'mark' (the pack's
      // 8.4-tscard-selected example keeps the subtitle muted; only
      // 8.4-tscard-selected-wash darkens it). `:has()` is already in this
      // file's support baseline (see .lg-mqg:has(...) / .lg-el[data-el-
      // leaf]:has(...) elsewhere in this stylesheet).
      rule(
        [
          `${scope} .lg-tscard.lg-selected:not(:has(.lg-check-badge)) .lg-tscard-subtitle`,
          `${scope} .lg-tscard[aria-checked="true"]:not(:has(.lg-check-badge)) .lg-tscard-subtitle`,
          `${scope} .lg-tscard[data-selected="true"]:not(:has(.lg-check-badge)) .lg-tscard-subtitle`,
        ].join(", "),
        { color: design.page.textSecondaryColor },
      ),
    );
    // mobile 375 (P0 pack data-pin 8.4-mobile-title-subtitle-cards): smaller
    // padding/type + a tighter marker offset — genuinely new, pack-pinned
    // measurements (no existing token covers a mobile-only card shrink).
    mobile.push(
      rule(`${scope} .lg-tscard`, { padding: "14px 16px" }),
      rule(`${scope} .lg-tscard-title`, { "font-size": "14.5px" }),
      rule(`${scope} .lg-tscard-subtitle`, { "font-size": "11px" }),
      rule(`${scope} .lg-tscard .lg-check-hollow, ${scope} .lg-tscard .lg-check-badge`, {
        top: "12px",
        right: "14px",
      }),
    );
  }
  // SELECTED — mark (Image 40): a bigger selected state (heavier border + a
  // slight scale-up) plus a corner check badge, shown only when selected.
  if (bs.selected === "mark") {
    const g = (leaf: string): string => `${scope} .lg-card-grid[data-card-select="mark"] ${leaf}`;
    out.push(
      rule(
        `${g(".lg-card.lg-selected")},${g('.lg-card[aria-checked="true"]')},${g('.lg-card[data-selected="true"]')}`,
        { "border-width": "3px", transform: "scale(1.03)" },
      ),
      // The MARKER rules themselves (the single-select grids' corner ✓ badge +
      // the multi-select cards' leading circle) live in selectedMarkCardRules —
      // ONE definition shared with the author-opted, no-mark-theme case
      // presets.ts serves demand-driven, exactly as selectedMarkRules already
      // does for the button/YesNo family.
      ...selectedMarkCardRules(scope, design),
    );

    // Rework §6.6 (S2.2 follow-up, coordinator-directed 2026-07-22): the SAME
    // mark mechanism for the button/YesNo family — presets.ts stamps
    // data-card-select="mark" on .lg-answer-group roots too (whenever theme OR
    // a per-choice/per-node selected_marker override resolves 'mark'), and
    // every mark-resolved button unconditionally carries BOTH a hollow-circle
    // span (resting) and a filled-badge span (selected) — presets.ts
    // selectedMarkerMarkup. CSS alone decides which one paints, mirroring the
    // card branch above; sizes/colors are the P0 golden pack's OWN pinned
    // values (studio-panels.html .lg-check-badge/.lg-check-hollow, data-pin
    // 6.6-visitor-selected) expressed through this design's existing measured
    // tokens (color.primary/color.border/radius.full) — no new value invented.
    //
    // R2 P1 §① (conductor ruling, owner A.1 #4 / probe 4a): this THEME gate
    // stays exactly as it was — a design whose Selected axis is not 'mark'
    // adds NOTHING to this sheet (the byte-safe-additive contract three
    // suites pin). The AUTHOR-opted case (per-node / per-choice
    // selected_marker with no mark theme) is served demand-driven, from
    // presets.ts (selectedMarkStyleBlock), so nothing here changes for any
    // funnel that never opts in.
    out.push(...selectedMarkRules(scope, design));
  }
}

// The §6.6 mark rules for the CARD family — the corner ✓ badge the
// single-select icon/image grids paint (extracted VERBATIM from the theme
// branch above) PLUS the multi-select cards' leading circle. Same contract
// selectedMarkRules holds for buttons: ONE definition, shared by the theme
// branch and by presets.ts's demand-driven block, so the two can never drift.
//
// OWNER REPORT 2026-08-18 (verbatim): "In the 'Leadgen' --> 'Sections' menu,
// this feature doesn't work for 'multi-select card' element (it's supposed to
// add a leading circle + ✓ inside it as marked in the screenshot)."
//
// TWO measured holes, both closed here + in presets.ts. Probe: his stored node
// (production section 40, props.selected_marker:"mark" — the click DID save)
// rendered under his own theme (theme_json IS NULL on all 15 funnels, so
// readButtonStyle is undefined and this whole theme branch never runs):
//   1. renderMultiChoiceCardGroup never read the prop AT ALL — no
//      data-card-select stamp, no marker span, so Mark was a plain no-op on
//      multi-select cards. presets.ts now resolves it per card exactly like
//      every sibling family, and the leading-circle rules below paint it.
//   2. these rules were emitted ONLY inside the theme branch, so an author who
//      opted a node in WITHOUT a mark theme got the single-select grid's
//      `<span class="lg-card-check">✓</span>` with ZERO rules — an unstyled
//      inline ✓ sitting on EVERY card, resting and selected alike. The
//      button/YesNo family already had the escape hatch; the card family never
//      got one. Exporting these makes the hatch reachable for cards too.
//
// Anatomy is the owner's OWN design pack, not invented: studio-panels.html
// data-pin 6.6-visitor-selected paints the marker as a LEADING flex item
// (17px hollow ring → 19px filled disc, 8px gap, pair centered as a unit) —
// see selectedMarkRules below, whose sizes/colors these reuse verbatim.
export function selectedMarkCardRules(
  scope: string,
  design: DefaultFunnelDesign | EffectiveFunnelDesign,
): string[] {
  const { color, radius, spacing } = design;
  const g = (leaf: string): string =>
    `${scope === "" ? "" : `${scope} `}.lg-card-grid[data-card-select="mark"] ${leaf}`;
  // The 3-selector triplet every §6.6 rule keys on: the runtime's
  // SELECTED_CLASS (render.ts applySelectionClasses) plus the aria-checked /
  // data-selected mirrors the SSR + preview-sim layer over it
  // (preview-sim.ts markSelectionInSlice).
  const sel = (item: string, leaf: string): string =>
    `${g(`${item}.lg-selected ${leaf}`)},${g(`${item}[aria-checked="true"] ${leaf}`)},${g(`${item}[data-selected="true"] ${leaf}`)}`;
  const marker = `${g(".lg-card-multi .lg-check-hollow")},${g(".lg-card-multi .lg-check-badge")}`;
  return [
    // check badge sits top-LEFT (the .lg-card-badge occupies top-right), so a
    // card carrying both a badge and a mark-selection never overlaps.
    rule(g(".lg-card-check"), {
      position: "absolute",
      top: spacing.xs,
      left: spacing.xs,
      display: "none",
      "align-items": "center",
      "justify-content": "center",
      width: "22px",
      height: "22px",
      "border-radius": radius.full,
      background: color.primary,
      color: color.card,
      "font-size": "0.75rem",
      "font-weight": "700",
      "line-height": "1",
    }),
    rule(sel(".lg-card", ".lg-card-check"), { display: "flex" }),

    // ---- multi-select cards: the LEADING circle ----------------------------
    // Base `.lg-card` is a CENTERED COLUMN flex (icon over title over
    // subtitle), so a marker dropped in as a plain child would stack ABOVE the
    // label instead of leading it. It is PINNED to the card's content edge
    // rather than made a flex/grid item, for two measured reasons:
    //   • multi-select cards stack (his own node is a 4-card column at width
    //     S). Centering the [ring + label] pair the way the pack's side-by-side
    //     button chips do lets each row center independently, so the rings come
    //     out ragged down the stack — measured at 554/529/510/521px before this
    //     rule. Pinned, they line up in ONE column like every checkbox list;
    //   • the label keeps the exact centering it has today — this change ADDS a
    //     ring, it does not re-align anyone's text.
    // A pinned marker also leaves the title/subtitle stack untouched, so a card
    // WITH a subtitle keeps its two lines. `.lg-card{position:relative}` (base
    // sheet, the .lg-card-badge companion) is what it anchors to, and only the
    // ONE visible marker paints — its twin is display:none.
    rule(marker, {
      position: "absolute",
      left: spacing.md,
      top: "50%",
      transform: "translateY(-50%)",
    }),
    // …and the gutter the pinned ring needs, mirrored on the right so a short
    // label stays optically centered in the card exactly as it is today: the
    // ring's own inset + its 19px box + the pack's 8px gap.
    rule(g(".lg-card-multi"), {
      "padding-left": `calc(${spacing.md} + 19px + ${spacing.sm})`,
      "padding-right": `calc(${spacing.md} + 19px + ${spacing.sm})`,
    }),
    // resting: the 17px hollow ring. selectedMarkRules' own values.
    rule(g(".lg-card-multi .lg-check-hollow"), {
      width: "17px",
      height: "17px",
      "border-radius": radius.full,
      border: `1.6px solid ${color.border}`,
    }),
    // the filled 19px disc — in the markup on every card, hidden until that
    // card is selected. This disc carries the ✓'s contrast (white stroke).
    rule(g(".lg-card-multi .lg-check-badge"), {
      display: "none",
      width: "19px",
      height: "19px",
      "border-radius": radius.full,
      background: color.primary,
      "align-items": "center",
      "justify-content": "center",
    }),
    // selected: swap which of the pair paints.
    rule(sel(".lg-card-multi", ".lg-check-hollow"), { display: "none" }),
    rule(sel(".lg-card-multi", ".lg-check-badge"), { display: "flex" }),
  ];
}

// The 4 §6.6 mark rules for the button/YesNo family. Extracted VERBATIM from
// the theme branch above so the ONE demand-driven consumer in presets.ts
// (selectedMarkStyleBlock — the author-opted, no-mark-theme case) emits the
// byte-identical rule bodies instead of a second, drifting definition.
export function selectedMarkRules(
  scope: string,
  design: DefaultFunnelDesign | EffectiveFunnelDesign,
): string[] {
  const { color, radius } = design;
  const gb = (leaf: string): string =>
    `${scope === "" ? "" : `${scope} `}.lg-answer-group[data-card-select="mark"] ${leaf}`;
  return [
    // resting: a 17px hollow (border-only) circle — the pack's own size.
    rule(gb(".lg-check-hollow"), {
      width: "17px",
      height: "17px",
      "border-radius": radius.full,
      border: `1.6px solid ${color.border}`,
      "flex-shrink": "0",
    }),
    // the filled 19px badge — present in markup, hidden until selected. This
    // disc is what carries the ✓'s contrast (white stroke on color.primary).
    rule(gb(".lg-check-badge"), {
      display: "none",
      width: "19px",
      height: "19px",
      "border-radius": radius.full,
      background: color.primary,
      "align-items": "center",
      "justify-content": "center",
      "flex-shrink": "0",
    }),
    // selected: swap which one paints — the SAME 3-selector triplet
    // (.lg-selected / [aria-checked="true"] / [data-selected="true"]) the
    // card branch uses, scoped to .lg-btn-answer instead of .lg-card.
    rule(
      `${gb(".lg-btn-answer.lg-selected .lg-check-hollow")},${gb('.lg-btn-answer[aria-checked="true"] .lg-check-hollow')},${gb('.lg-btn-answer[data-selected="true"] .lg-check-hollow')}`,
      { display: "none" },
    ),
    rule(
      `${gb(".lg-btn-answer.lg-selected .lg-check-badge")},${gb('.lg-btn-answer[aria-checked="true"] .lg-check-badge')},${gb('.lg-btn-answer[data-selected="true"] .lg-check-badge')}`,
      { display: "inline-flex" },
    ),
  ];
}

// tokens → the full scoped chrome stylesheet for one funnel design. `scope`
// defaults to the default-funnel scope; a different design passes its own.
// Accepts the registry's literal design OR a resolveTokens() EffectiveTokens
// `design` (widened leaves, same structure — 09 §9.2).
export function funnelChromeCss(
  design: DefaultFunnelDesign | EffectiveFunnelDesign,
  scope: string = DEFAULT_FUNNEL_SCOPE,
  opts?: FunnelChromeCssOpts,
): string {
  const out: string[] = [];
  const mobile: string[] = [];

  const {
    page,
    color,
    spacing,
    radius,
    shadow,
    header,
    backButton,
    disclosure,
    content,
    questionCard,
    progress,
    headline,
    subheadline,
    categoryLabel,
    rangeQuestion,
    primaryButton,
    reassuranceBadge,
    secureFormBadge,
    successState,
    trustBar,
    logoStrip,
    stepIndicator,
    iconCardGrid,
    answerGrid,
    iconCard,
    input,
    dropdown,
    validation,
    transitions,
    breakpoints,
    banner,
    columns,
    cardPanel,
    backgroundPanel,
    headerBar,
    footerBar,
  } = design;

  // ---- root: page group + design tokens exposed as custom properties -------
  // Emitting spacing / radius / shadow / transitions / breakpoints / colour as
  // CSS custom properties keeps EVERY §14.2 group represented on the scope
  // root (and lets presets reference them) without leaking globals.
  out.push(
    rule(scope, {
      "background-color": page.backgroundColor,
      color: page.textColor,
      "font-family": page.fontFamily,
      "min-height": page.minHeight,
      // color group
      "--lg-primary": color.primary,
      "--lg-primary-dark": color.primaryDark,
      "--lg-accent": color.accent,
      "--lg-card": color.card,
      "--lg-border": color.border,
      "--lg-success": color.success,
      "--lg-error": color.error,
      "--lg-primary-wash": color.primaryWash,
      // spacing group
      "--lg-space-xs": spacing.xs,
      "--lg-space-sm": spacing.sm,
      "--lg-space-md": spacing.md,
      "--lg-space-lg": spacing.lg,
      "--lg-space-xl": spacing.xl,
      "--lg-space-xxl": spacing.xxl,
      // radius group
      "--lg-radius-sm": radius.sm,
      "--lg-radius-md": radius.md,
      "--lg-radius-lg": radius.lg,
      "--lg-radius-xl": radius.xl,
      "--lg-radius-full": radius.full,
      // shadow group
      "--lg-shadow-sm": shadow.sm,
      "--lg-shadow-md": shadow.md,
      "--lg-shadow-lg": shadow.lg,
      "--lg-shadow-xl": shadow.xl,
      "--lg-shadow-glow": shadow.glow,
      // transitions group
      "--lg-transition-step": `${transitions.stepFadeInMs}ms`,
      "--lg-transition-card": `${transitions.cardHoverMs}ms`,
      "--lg-transition-btn": `${transitions.btnHoverMs}ms`,
      "--lg-transition-progress": `${transitions.progressFillMs}ms`,
      "--lg-btn-easing": transitions.btnEasing,
      // breakpoints group
      "--lg-bp-mobile-max": breakpoints.mobileMax,
      "--lg-bp-small-max": breakpoints.smallMax,
      "--lg-bp-tiny-max": breakpoints.tinyMax,
      "--lg-bp-desktop-min": breakpoints.desktopMin,
      "--lg-bp-wide-min": breakpoints.wideMin,
    }),
  );

  // ---- content container (§14.2 content) ----------------------------------
  out.push(
    rule(`${scope} .lg-content`, {
      "max-width": content.maxWidth,
      "margin-left": "auto",
      "margin-right": "auto",
      padding: content.paddingDesktop,
      "box-sizing": "border-box",
    }),
  );
  mobile.push(rule(`${scope} .lg-content`, { padding: content.paddingMobile }));

  // ---- R7 U12 FIX 3b: the question card (golden :308) ---------------------
  // The section-unit's DEFAULT composition (presets.ts renderQuestionCard) —
  // in the BASE sheet (never frameRegions-gated) so it reaches EVERY caller
  // identically: studio canvas, admin preview simulator, live funnel
  // (frameless legacy AND frame-composed alike). See the frame-coherence note
  // at renderQuestionCard's definition + the neutralized `.lg-frame-slot--card`
  // rule below (frameRegions block) for the "exactly one card, both
  // directions" mechanism.
  // R7 U11b/U12 FIX (browser-measurement finding, 2026-07-15): the golden's
  // OWN canvas markup (golden :296-308) proves the card is the ONLY padding
  // layer — a bare `width:600px` column directly containing the padded card,
  // no intermediate padded wrapper. `.lg-content`'s own horizontal padding
  // (content.paddingDesktop/Mobile — pre-existing, serves the `.lg-banners`
  // sibling mount which is NOT card-wrapped) would otherwise DOUBLE-PAD the
  // card (confirmed via a real browser measurement: a width:m FreeText
  // measured a 13px off-center — .lg-content's 452px content-box minus the
  // card's own 92px horizontal padding left only 360px, not enough for a
  // 384px field to center, let alone fit). Canceling `.lg-content`'s
  // padding on the card ALONE (negative margin, not a blanket removal) frees
  // the card to use `.lg-content`'s FULL border-box width for its own
  // golden-exact 46px/side padding, matching the golden's real structure,
  // WITHOUT touching `.lg-banners`' own inset (a sibling, untouched).
  out.push(
    rule(`${scope} .lg-question-card`, {
      background: questionCard.background,
      border: questionCard.border,
      "border-radius": questionCard.borderRadius,
      "box-shadow": questionCard.boxShadow,
      padding: questionCard.paddingDesktop,
      "box-sizing": "border-box",
      "margin-left": `calc(-1 * ${content.paddingDesktop})`,
      "margin-right": `calc(-1 * ${content.paddingDesktop})`,
    }),
  );
  mobile.push(
    rule(`${scope} .lg-question-card`, {
      padding: questionCard.paddingMobile,
      // same padding-cancellation, using the MOBILE .lg-content padding value.
      "margin-left": `calc(-1 * ${content.paddingMobile})`,
      "margin-right": `calc(-1 * ${content.paddingMobile})`,
    }),
  );

  // ---- P1a inter-component rhythm (register PC-3) -------------------------
  // The section-unit's vertical rhythm: a stack FLOOR between EVERY adjacent
  // pair of the unit's components. renderSectionComponents wraps the depth-1
  // component list in ONE `.lg-question-card` (presets.ts), and the studio
  // canvas + admin preview + live funnel (framed AND frameless) all take that
  // SAME wrapper — so `.lg-question-card > * + *` is the ONE selector that
  // reaches every component pair identically across all four surfaces (the
  // `.lg-content`/`<section>` wrappers exist only on the live shell, not the
  // studio canvas; the card exists everywhere). Pre-P1a these gaps measured 0
  // wherever a component carried no margin-bottom of its own (button groups,
  // yes/no, text blocks) — the operator's "default gaps don't exist" finding.
  //
  // MECHANISM = margin-collapse FLOOR + cascade-preserved golden overrides.
  // This rule is emitted HERE, BEFORE the per-component margin rules below
  // (.lg-headline :~325, .lg-subheadline :~331, .lg-continue :~458), so at EQUAL
  // specificity (both selectors are 1 attr + 1 class = (0,2,0)) source order
  // decides and each of those elements' OWN later margin-top declaration WINS:
  //   • .lg-subheadline `margin:0 0 30px 0` re-states margin-top:0 → the golden
  //     headline→sub 9px (the headline's OWN margin-bottom) survives the 18px
  //     floor (this is the ONE golden gap below the floor; every other golden
  //     gap is ≥18 and simply wins by margin-collapse max);
  //   • .lg-continue `margin-top:26px` → the golden helper→Continue 26px stands
  //     (and the U14 measured-centering gate reads marginTop=="26px").
  // Every component WITHOUT its own margin-top (answer groups, yes/no, text
  // blocks, range, …) inherits the 18px floor; every preceding margin-bottom
  // ≥18 (card-grid 24, progress 32, steps 24) still wins by collapse-max. Pinned
  // by leadgen-r3a-effects.gesture (rendered gaps) + leadgen-p1-geometry.gesture
  // (the new rhythm gate); the CSS-body pins in leadgen-u12-rhythm read the
  // .lg-headline/.lg-subheadline/.lg-continue rule BODIES, which are untouched.
  //
  // MINOR-1 (adversarial review, register PC): `.lg-question-card > * + *` is a
  // DIRECT-CHILD combinator — it reaches a §8.5 container's OWN position among
  // its question-card siblings, but NOT a plain-block container's children
  // (its grandchildren, one level deeper). The reviewer's probe found exactly
  // this: two components nested inside a CardPanel measured 0px apart.
  //
  // SCOPING RULE (encoded here for every future §8.5 container): a container
  // with EXPLICIT gap semantics owns its OWN internal spacing and must NOT get
  // this floor —
  //   • Stack   (renderStack)         — inline `gap` from stackGapValue, ALWAYS
  //                                      emitted (an un-authored gap still
  //                                      resolves to the token default).
  //   • GridContainer (renderGridContainer) — inline `gap` from gridGapValue,
  //                                      same always-emitted guarantee.
  //   • Columns (`.lg-columns`, above) — `gap: columns.gap` in THIS class rule.
  // A container with NO gap mechanism at all — a plain block — falls back to
  // this SAME stack floor, exactly like `.lg-question-card` itself:
  //   • CardPanel (`.lg-card-panel`, ~line 1098) — renderCardPanel emits no
  //     gap; the class rule is width/margin/border only.
  //   • BackgroundPanel (`.lg-bg-panel`, ~line 1110) — renderBackgroundPanel
  //     renders children inside the INNER wrapper `.lg-bg-panel-inner`
  //     (position:relative only, no gap); the floor targets that inner
  //     element, not `.lg-bg-panel` itself (children are ITS direct children,
  //     not the outer panel's — the outer panel's only other child is the
  //     absolutely-positioned `.lg-bg-panel-img`, which this selector does not
  //     reach: `img + *` never matches inside `.lg-bg-panel` itself, only
  //     inside `.lg-bg-panel-inner`).
  // Swept ALL 5 LEADGEN_CONTAINER_TYPES (content-schema.ts) against this rule:
  // no 6th plain-block container exists today; a future one must repeat this
  // audit (does its OWN renderX emit a gap? no → add it here).
  //
  // AUDITED against the grid-follower collapse-emulation table below (P1a FIX
  // ROUND): that table's selectors (`${scope} <predecessor> + <follower>`) are
  // ALREADY container-agnostic — a sibling-combinator selector matches an
  // adjacent pair regardless of which element wraps them, so it governs a
  // CardPanel-nested or BackgroundPanel-nested pair identically to a
  // question-card-level one, with NO changes needed. Its selectors are also
  // HIGHER specificity ((0,3,0): scope + 2 classes) than this floor's (0,2,0):
  // scope + 1 class, `*` contributes none) — so it always wins the tie where
  // both could apply. Every margin-bottom/margin-shorthand-bearing selector in
  // this file was enumerated (grep audit, register PC): .lg-progress(32),
  // .lg-category(12), .lg-steps(24), .lg-card-grid(24, predecessor case),
  // .lg-field(16), .lg-grid-container(24), .lg-columns(16), .lg-headline(9),
  // .lg-subheadline(30), .lg-trustbar(16), .lg-logo-strip(16) — ALL already
  // enumerated in that table's predecessor list. The remaining margin-bearing
  // selectors (.lg-range-value/.lg-label/.lg-dropdown-search) are nested-only
  // (never a direct container child anywhere, panel or not — unchanged from
  // the original P1a audit) and every frame-region `margin:` (`.lg-frame-*`)
  // is structural chrome, never an author-authored container child.
  out.push(
    rule(`${scope} .lg-question-card > * + *`, { "margin-top": spacing.stack }),
    rule(`${scope} .lg-card-panel > * + *`, { "margin-top": spacing.stack }),
    rule(`${scope} .lg-bg-panel-inner > * + *`, { "margin-top": spacing.stack }),
  );
  // Mobile: a tighter floor; re-assert the two golden overrides AFTER it (the
  // mobile array becomes ONE media query at the end of the sheet, so these must
  // follow the mobile stack in source to win it — keeping the desktop-golden
  // rhythm identical on mobile, where it was already inherited from the base).
  // `.lg-subheadline`/`.lg-continue` are GLOBAL class selectors (not scoped to
  // a specific ancestor), so the SAME two re-assertions cover a CardPanel- or
  // BackgroundPanel-nested instance of either without duplication.
  mobile.push(
    rule(`${scope} .lg-question-card > * + *`, { "margin-top": spacing.stackMobile }),
    rule(`${scope} .lg-card-panel > * + *`, { "margin-top": spacing.stackMobile }),
    rule(`${scope} .lg-bg-panel-inner > * + *`, { "margin-top": spacing.stackMobile }),
  );
  mobile.push(rule(`${scope} .lg-subheadline`, { "margin-top": "0" }));
  mobile.push(rule(`${scope} .lg-continue`, { "margin-top": "26px" }));

  // ---- P3a structured placement (register PC-2 / D1 / R-B) ----------------
  // renderNodes groups contiguous same-`row` siblings into `.lg-el-row` (a flex
  // row of 2-3 `.lg-el` slots) and wraps a lone placed element in `.lg-el`.
  //   • ROW: flex; the theme answer-grid gutter is reused as the inter-slot gap
  //     (§R-B "reuse a theme gap token" — NO new design_tokens key, so the A0
  //     serialized-config byte pin is untouched; only THIS sheet grows).
  //   • SLOT: equal basis by default (unauthored members share the row); a
  //     per-member fixed width rides `--lg-el-basis` (marked `data-el-basis`).
  //     Each slot is itself a column-flex so the per-element `data-align`
  //     positions its CONTENT (start/center/end); `min-width:0` lets a slot
  //     shrink rather than overflow.
  //   • WRAPPER: a bounded nudge rides `--lg-el-nudge` → `transform: translate`
  //     (visual only — never affects flow/rhythm); a lone fixed-width box can
  //     never exceed its column (`max-width:100%`).
  // A row is ONE stack unit: the `.lg-question-card > * + *` floor (a DIRECT-
  // child combinator) reaches `.lg-el-row`/lone `.lg-el` but NOT the members
  // inside a row (grandchildren) — so members get no vertical floor; the row
  // as a whole keeps the inter-component rhythm. `.lg-el-row` (display:flex)
  // does NOT margin-collapse (same as `.lg-answer-group`/`.lg-card-grid`), so it
  // is added to the grid-follower collapse-emulation table below; a lone `.lg-el`
  // is a normal block that collapses, needing no exception.
  out.push(
    rule(`${scope} .lg-el-row`, { display: "flex", gap: answerGrid.gap, "align-items": "stretch" }),
    rule(`${scope} .lg-el-row > .lg-el`, {
      flex: "1 1 0",
      "min-width": "0",
      display: "flex",
      "flex-direction": "column",
    }),
    rule(`${scope} .lg-el-row > .lg-el[data-el-basis]`, {
      "flex-grow": "0",
      "flex-basis": "var(--lg-el-basis)",
    }),
    rule(`${scope} .lg-el-row > .lg-el[data-align="start"]`, { "align-items": "flex-start" }),
    rule(`${scope} .lg-el-row > .lg-el[data-align="center"]`, { "align-items": "center" }),
    rule(`${scope} .lg-el-row > .lg-el[data-align="end"]`, { "align-items": "flex-end" }),
    rule(`${scope} .lg-el`, { transform: "var(--lg-el-nudge, none)", "max-width": "100%" }),
    // CONDUCTOR FIX (P3 review MINOR-2, corrected on re-review): a row member
    // that carries a Rules condition can be hidden at RUNTIME by the live
    // funnel (render.ts applyComponentVisibility sets the `hidden` attribute
    // directly on the component's own hydration anchor,
    // `[data-lg-question="{qid}"]` — the SAME element hydration() stamps on
    // every answer-producing renderer, confirmed against presets.ts: a bare
    // `renderTextInput` puts it on the `<input>` itself, a DIRECT CHILD of
    // `.lg-el`; the icon/helper-boxed path and `renderButtonAnswerGroup`'s
    // `.lg-answer-group` root put it at varying depths). Without a rule here,
    // the LIVE funnel's static server-rendered HTML keeps the hidden member's
    // now-empty `.lg-el` SLOT in the flex row (a visible empty column) — the
    // SSR dependency-preview simulator never has this problem
    // (renderVisibleNodes drops a hidden node from the markup entirely before
    // renderPlacedSiblings groups the row, so a 2-member row with one hidden
    // member never even reaches the DOM as a row).
    //
    // RE-REVIEW FIX (fresh regression from the first cut of this rule): a
    // plain descendant `:has([data-lg-question][hidden])` matches ANY hidden
    // question ANYWHERE inside the slot — including one buried arbitrarily
    // deep inside a CONTAINER row member's OWN children (e.g. a CardPanel
    // holding an always-visible TextBlock PLUS a conditionally-hidden
    // FreeTextQuestion). A container is not "empty" merely because ONE of its
    // several children is hidden — the runtime's own applyComponentVisibility
    // already hides that ONE descendant in place (the container's *inner*
    // layout handles it); collapsing the WHOLE container slot because of it
    // wrongly hides the container's OTHER, still-visible content too (live-
    // proven: the entire CardPanel — including its visible TextBlock — went
    // 0×0). `data-el-leaf` (presets.ts wrapRowMember) marks a slot as a
    // single answer-producing/content LEAF, never a container — requiring it
    // here means a leaf's OWN single `[data-lg-question]` hiding IS its
    // slot's whole story (collapse correctly), while a container's slot,
    // lacking the marker, can never match this rule at all — its inner
    // conditional children keep hiding INSIDE it, exactly as the runtime
    // already handles, with the slot itself staying laid out. Collapsing the
    // hidden LEAF slot to `display:none` makes the LIVE funnel degrade the
    // SAME way the SSR preview does: flexbox excludes a `display:none` item
    // from layout entirely, so an unauthored-width (`flex:1 1 0`) survivor
    // naturally expands to fill the row. `:has()` is in the support baseline
    // already relied on elsewhere in this sheet (the P1 selection-chrome
    // grid-follower companion selectors below).
    rule(`${scope} .lg-el[data-el-leaf]:has([data-lg-question][hidden])`, { display: "none" }),
  );
  // ≤480px (§D1 automatic mobile stacking): the row becomes a column, every
  // member spans full width (its desktop `--lg-el-basis` is neutralized — flex
  // reset to `1 1 auto`, so a fixed WIDTH basis never becomes a fixed HEIGHT in
  // the column), and nudges (a desktop refinement) are dropped. This media
  // block appends at the END of the sheet, so these rules win the source-order
  // tie over their desktop twins at equal specificity.
  mobile.push(
    rule(`${scope} .lg-el-row`, { "flex-direction": "column", gap: spacing.stackMobile }),
    rule(`${scope} .lg-el-row > .lg-el`, { flex: "1 1 auto" }),
    rule(`${scope} .lg-el-row > .lg-el[data-el-basis]`, { flex: "1 1 auto" }),
    rule(`${scope} .lg-el`, { transform: "none" }),
  );

  // ---- header (§14.2 header) ----------------------------------------------
  out.push(
    rule(`${scope} .lg-header`, {
      "background-color": header.backgroundColor,
      padding: `${header.paddingY} ${header.paddingX}`,
      "box-shadow": header.boxShadow,
      position: header.position,
      top: "0",
      "z-index": "20",
      display: "flex",
      "align-items": "center",
      "justify-content": "center",
      "text-align": header.align,
    }),
    rule(`${scope} .lg-header-inner`, {
      width: "100%",
      "max-width": header.contentMaxWidth,
      display: "flex",
      "align-items": "center",
      "justify-content": "space-between",
      gap: spacing.md,
    }),
    rule(`${scope} .lg-logo`, {
      "font-family": header.logoFontFamily,
      "font-size": header.logoFontSize,
      "font-weight": header.logoFontWeight,
      color: header.logoColor,
      "text-decoration": "none",
    }),
    rule(`${scope} .lg-logo-accent`, { color: header.logoAccentColor }),
  );

  // ---- back button (§14.2 backButton) -------------------------------------
  out.push(
    rule(`${scope} .lg-back`, {
      background: "none",
      border: "0",
      cursor: "pointer",
      color: backButton.color,
      "font-size": backButton.fontSize,
      "font-family": "inherit",
      padding: "0",
      display: "inline-flex",
      "align-items": "center",
      gap: spacing.xs,
      "min-height": "44px",
    }),
    rule(`${scope} .lg-back:hover`, { color: backButton.hoverColor }),
  );

  // ---- disclosure link (§14.2 disclosure) ---------------------------------
  out.push(
    rule(`${scope} .lg-disclosure`, {
      background: "none",
      border: "0",
      cursor: "pointer",
      color: disclosure.color,
      "font-size": disclosure.fontSize,
      "font-family": "inherit",
      "text-decoration": "underline",
    }),
    rule(`${scope} .lg-disclosure:hover`, { color: disclosure.hoverColor }),
  );

  // ---- progress bar (§14.2 progress) --------------------------------------
  out.push(
    rule(`${scope} .lg-progress`, { "margin-bottom": progress.marginBottom }),
    rule(`${scope} .lg-progress-track`, {
      height: progress.height,
      "background-color": progress.trackColor,
      "border-radius": progress.borderRadius,
      overflow: "hidden",
    }),
    rule(`${scope} .lg-progress-fill`, {
      height: "100%",
      background: progress.fillColor,
      "border-radius": progress.borderRadius,
      transition: `width var(--lg-transition-progress) ease`,
    }),
    rule(`${scope} .lg-progress-text`, {
      color: progress.textColor,
      "font-size": "0.7rem",
      "font-weight": "600",
      "margin-top": spacing.xs,
    }),
  );

  // ---- category label (§14.2 categoryLabel) -------------------------------
  out.push(
    rule(`${scope} .lg-category`, {
      "font-size": categoryLabel.fontSize,
      "font-weight": categoryLabel.fontWeight,
      "letter-spacing": categoryLabel.letterSpacing,
      "text-transform": categoryLabel.textTransform,
      color: categoryLabel.color,
      "margin-bottom": categoryLabel.marginBottom,
    }),
  );

  // ---- headline + subheadline (§14.2 headline / subheadline) --------------
  out.push(
    rule(`${scope} .lg-headline`, {
      "font-family": headline.fontFamily,
      "font-size": headline.fontSizeDesktop,
      "font-weight": headline.fontWeight,
      "line-height": headline.lineHeight,
      color: headline.color,
      "text-align": headline.textAlign,
      "text-wrap": "balance",
      margin: `0 0 ${headline.marginBottom} 0`,
    }),
    rule(`${scope} .lg-subheadline`, {
      "font-size": subheadline.fontSize,
      color: subheadline.color,
      "text-align": subheadline.textAlign,
      margin: `0 0 ${subheadline.marginBottom} 0`,
    }),
    // R5 D11 (register S4-B2, conductor-ratified blast-radius discipline): a
    // SURGICAL, later same-selector declaration overrides ONLY the question-
    // card subheadline's font-size to golden's 15px (golden :313) — the
    // SHARED subheadline.fontSize TOKEN above (0.825rem) is deliberately left
    // UNTOUCHED because it also feeds .lg-card-desc (icon-card choice
    // descriptions) and other non-headline consumers this deliverable does
    // not touch. Same specificity (bare class selector) + later source order
    // = this wins the font-size property only; color/text-align/margin from
    // the rule above are unaffected.
    rule(`${scope} .lg-subheadline`, { "font-size": "15px" }),
  );
  mobile.push(rule(`${scope} .lg-headline`, { "font-size": headline.fontSizeMobile }));

  // ---- range question (§14.2 rangeQuestion) -------------------------------
  out.push(
    rule(`${scope} .lg-range-value`, {
      "font-family": rangeQuestion.valueFontFamily,
      "font-size": rangeQuestion.valueFontSize,
      "font-weight": rangeQuestion.valueFontWeight,
      color: rangeQuestion.valueColor,
      "text-align": "center",
      margin: `${spacing.md} 0`,
    }),
    rule(`${scope} .lg-range-track`, {
      position: "relative",
      height: rangeQuestion.trackHeight,
      "background-color": rangeQuestion.unfilledTrackColor,
      "border-radius": rangeQuestion.trackRadius,
    }),
    rule(`${scope} .lg-range-fill`, {
      position: "absolute",
      left: "0",
      top: "0",
      height: "100%",
      "background-color": rangeQuestion.filledTrackColor,
      "border-radius": rangeQuestion.trackRadius,
    }),
    // R2 P4 §6.8 (design-pack studio-panels.html §6.8) — the handle sits ON the
    // track. It is a child of .lg-range-fill pinned to the fill's edge, so the
    // ONE property the runtime already writes live (fill width,
    // render.updateRangeDisplay) carries it: `left:100%` = the single/max
    // handle, `left:0` = the min handle of a two-handle track. Translating by
    // -50%/-50% centres it on that edge and on the track's mid-line — which is
    // the whole fix for the probe's "handle renders detached ~20px BELOW the
    // track" (that was the native input's own thumb, painted in normal flow
    // under the track; the input is now an overlay with a transparent thumb).
    rule(`${scope} .lg-range-handle`, {
      position: "absolute",
      left: "100%",
      top: "50%",
      transform: "translate(-50%,-50%)",
      width: rangeQuestion.thumbSize,
      height: rangeQuestion.thumbSize,
      "border-radius": radius.full,
      background: rangeQuestion.thumbBackground,
      border: rangeQuestion.thumbBorder,
      "box-shadow": rangeQuestion.thumbShadow,
      "box-sizing": "border-box",
      // The native thumb underneath is the hit target — the visible handle must
      // never swallow the drag.
      "pointer-events": "none",
      "z-index": "2",
    }),
    rule(`${scope} .lg-range-handle-min`, { left: "0" }),
    rule(`${scope} .lg-range-handle-max`, { left: "100%" }),
    // Image12/Image13: the value pill riding each handle of a two-handle track.
    // P8 N15 (owner Image11, opened directly — docs/leadgen/r2/evidence/p8/n15/
    // image11-reading.md): the pill sits UNDER its handle and travels with it,
    // not above the track. `top` (not `bottom`) anchors it just below the
    // handle's own box; horizontal centering/inward-anchoring is unchanged.
    rule(`${scope} .lg-range-handle-value`, {
      position: "absolute",
      top: `calc(100% + ${spacing.sm})`,
      left: "50%",
      transform: "translateX(-50%)",
      "white-space": "nowrap",
      "font-size": "0.8125rem",
      "font-weight": "700",
      "line-height": "1",
      padding: "5px 9px",
      "border-radius": radius.sm,
      background: rangeQuestion.filledTrackColor,
      color: color.card,
    }),
    // ...but a pill CENTRED on an end handle hangs off the card (the min pill
    // over the left edge, the max pill clipped on the right — seen in the P4
    // 375 drive). Anchor the end pills INWARD: the min pill starts at its
    // handle's left edge, the max pill ends at its handle's right edge.
    //
    // R2 P4 FIX-FIRST (F-2): that anchor holds the readout on-card only while
    // the handle IS at its own end. DRIVEN, it fails — the review drove the min
    // handle to the clamp at 375 and measured the min pill at x=319.1..393.0,
    // documentElement.scrollWidth=393 vs innerWidth=375 (18px of horizontal
    // overflow, pill visibly cut). So the inward anchor is now PROPORTIONAL to
    // the handle's own position: engine.ts (syncDualRange) publishes --lg-a /
    // --lg-b (the two handle percentages it already computes to place the fill)
    // and each pill slides inward by that fraction of its OWN width.
    //   min at   0% -> translateX(  -0%) = the anchored-left rest state
    //   min at  95% -> translateX( -95%) = the readout hangs left of its handle
    //   max at 100% -> translateX(   0%) = the anchored-right rest state
    //   max at   5% -> translateX( +95%) = the readout hangs right of its handle
    // Both ends therefore keep the whole pill between the handle and the far
    // side of the track, at EVERY position and at both viewports. Unset (the
    // server's own render, both handles at the rails) the 0/100 fallbacks give
    // exactly the at-rest anchoring above — Image13's pinned frame is unchanged.
    rule(`${scope} .lg-range-handle-min .lg-range-handle-value`, {
      left: "0",
      transform: "translateX(calc(var(--lg-a,0) * -1%))",
    }),
    rule(`${scope} .lg-range-handle-max .lg-range-handle-value`, {
      left: "auto",
      right: "0",
      transform: "translateX(calc((100 - var(--lg-b,100)) * 1%))",
    }),
    // P4 cleanup (S4b pin-fidelity finding): the INWARD anchor above is what
    // keeps Image13's SEPARATED pins on-card — but the two handles can land
    // close enough that both pills still reach inward toward each other and
    // collide (p4_fromto-1280-clamped.png). A rail drag lands them one `step`
    // apart; a TYPED value lands them on the SAME pixel (P8-5 J1 made the
    // typed gap zero, which is correct — `step` is the rail's granularity, not
    // a constraint on a typed number — and 40 of 0..100000 is 0% just like the
    // min). Measured on the live funnel at 375 with a typed max of 40: both
    // handle boxes at x=15..43, fill width 0, and the min pill DID drop below
    // the max pill (min pill y-centre 289.4 vs max 257.4, documentElement
    // .scrollWidth 375 == innerWidth 375, no overflow) — the escape below
    // still fires at a zero gap, which is the widest case it must cover.
    // `.lg-range-fill`'s own box already IS the
    // live pixel gap between the two handles (engine.ts writes its left/width
    // from both inputs every drag) — a container query on that box reacts to
    // the SAME already-written value with ZERO new runtime bytes; no engine.ts
    // change. S4b measured (measurements.txt): separated gap 142.6–146.7px
    // (must stay exactly as painted above — Image13 fidelity) vs clamped gap
    // 3.2–16.3px (must degrade). 96px sits ~47px inside the separated floor
    // and ~80px outside the clamped ceiling — clears both with margin. Below
    // it, the min pill is pushed a full pill-height-plus-gap BELOW the max
    // pill (stacked, not collided) — both values stay readable. (P8 N15: the
    // base anchor flipped bottom->top, so the escape direction flips with it —
    // away from the max pill is now DOWN, not up.)
    rule(`${scope} .lg-range-from-to .lg-range-fill,${scope} .lg-range-dual .lg-range-fill`, {
      "container-type": "inline-size",
      "container-name": "lg-range-fill",
    }),
    `@container lg-range-fill (max-width:96px){${scope} .lg-range-handle-min .lg-range-handle-value{top:calc(100% + ${spacing.sm} + ${spacing.xl})}}`,
    // Native range input drives recording + keyboard + role=slider semantics.
    // It is laid EXACTLY over its track: inflated by one thumb width and pulled
    // half a thumb left, so the native thumb's centre travels the track's true
    // 0–100% — pixel-aligned with the visible .lg-range-handle at every value.
    // The thumb paints nothing (the handle div is the visual); the input keeps
    // its own focus ring.
    rule(`${scope} .lg-range-input`, {
      "-webkit-appearance": "none",
      appearance: "none",
      position: "absolute",
      top: "50%",
      left: `calc(${rangeQuestion.thumbSize} * -0.5)`,
      width: `calc(100% + ${rangeQuestion.thumbSize})`,
      height: "44px",
      transform: "translateY(-50%)",
      background: "transparent",
      margin: "0",
      "z-index": "3",
    }),
    rule(`${scope} .lg-range-input::-webkit-slider-runnable-track`, { background: "transparent" }),
    rule(`${scope} .lg-range-input::-moz-range-track`, { background: "transparent" }),
    rule(`${scope} .lg-range-input::-webkit-slider-thumb`, {
      "-webkit-appearance": "none",
      appearance: "none",
      width: rangeQuestion.thumbSize,
      height: rangeQuestion.thumbSize,
      "border-radius": radius.full,
      background: "transparent",
      border: "0",
      cursor: "pointer",
    }),
    rule(`${scope} .lg-range-input::-moz-range-thumb`, {
      width: rangeQuestion.thumbSize,
      height: rangeQuestion.thumbSize,
      "border-radius": radius.full,
      background: "transparent",
      border: "0",
      cursor: "pointer",
    }),
    // from_to / dual_range: BOTH handle inputs cover the SAME track, so the
    // input surface itself must be transparent to the pointer and only the
    // thumbs grabbable — otherwise the top input would eat every drag.
    rule(`${scope} .lg-range-input-dual`, { "pointer-events": "none" }),
    rule(`${scope} .lg-range-input-dual::-webkit-slider-thumb`, { "pointer-events": "auto" }),
    rule(`${scope} .lg-range-input-dual::-moz-range-thumb`, { "pointer-events": "auto" }),
    // P8-6 Q4/S2 — "only the thumbs grabbable" is not enough when the two
    // thumbs land on the SAME pixel. Both rails carry z-index 3, so the hit
    // test then falls to DOM order and the MAX rail (presets.ts emits it
    // second) eats every press.
    //
    // The BEFORE/Q4-fix numbers immediately below (coincident pair, a typed
    // max of 40, both rails at min=0) were driven on the live r2fix funnel at
    // ONE press point, quoted here so the next reader cannot move it: the min
    // handle's OWN CENTRE, hMin.cx — x=477 at 1280, x=29 at 375. That is NOT
    // the press point for every case in this file: hMin.cx moves with the min
    // value, so the separated-pair (F1-F4) and min=20000 rows further down
    // press at x=542.2 (1280) / x=92.4 (375) instead — both press points are
    // in the committed docs/leadgen/r2/evidence/p8/s2/after-fixedpoint.log.
    // BEFORE: a typed max of 40 leaves both rails reading "0" and both handle
    // boxes at x=463..491 w=28 — one blob — and a real drag from 477 to the
    // track's 50% moved the MAX: box, rail and the POST /lg/auction body all
    // went 40 -> 50000 (375, press 29: identical).
    //
    // Q4's first attempt partitioned the track at the MIDPOINT of the two
    // handles, and the note that stood here claimed "down at 470 ... the typed
    // max stays 40". That was measured 7px LEFT of the coordinate the defect
    // was measured at — an instrument slip, not a fix. At 477 the wire still
    // carried max=50000, because when the handles COINCIDE the midpoint IS the
    // shared handle's centre, so the max rail still owned the exact pixel a
    // visitor aims at. At coincidence there is no pixel-based answer at all:
    // the two thumbs are one circle. The circle therefore gets ONE owner.
    //
    // Fix: the boundary is the midpoint OR the MIN thumb's own right edge,
    // whichever is further right. Separated by more than a thumb the midpoint
    // wins and nothing changes (the midpoint IS the nearest-thumb rule).
    // Overlapping, the min keeps its whole 28px circle and the max keeps the
    // part of its own that sticks out to the right. Coincident, the min owns
    // the circle outright — and that is the safe owner, because the clamp in
    // engine.ts then pins the min against its neighbour and the press records
    // NOTHING, where a max-rail press can only replace a precisely typed max
    // with a value off the step grid. The max is not stranded: it keeps the
    // keyboard (clip-path routes pointers, not focus), it has its own labelled
    // number box, and its circle reappears as soon as the two values differ.
    // Rejected: routing by drag DIRECTION (right = max, left = min), which is
    // the physically correct disambiguation but is unreachable — a native
    // range captures the pointer and commits on pointerdown, so the direction
    // is only known once the drag belongs to the wrong input; and its right
    // branch does the very thing this fix removes. Rejected: putting the min
    // rail on top, which just mirrors the bug onto the max.
    //
    // Only the max rail needs the clip — everything left of the boundary is
    // then the min rail's alone (it is underneath, so it wins only where the
    // max is clipped away), and everything right of it stays the max rail's
    // (it is on top there). clip-path clips HIT TESTING as well as paint and
    // is not layout, so the value<->pixel mapping and the captured drag are
    // both untouched: once grabbed, a thumb still travels the whole track.
    // --lg-a/--lg-b are the two handle percentages engine.ts already computes
    // for the fill and the pills, published on the .lg-range wrap so these
    // rails (siblings of .lg-range-fill) inherit them; no new runtime state,
    // no new engine geometry. The rail box is the track inflated by one thumb
    // and pulled half a thumb left (.lg-range-input above), so track 0% sits
    // at thumbSize/2 in the rail's own box and 100% of the track is
    // (100% - thumbSize) of it; the min thumb's right edge is therefore
    // thumbSize/2 past the min handle. Unset (server render) the 0/100
    // fallbacks keep the midpoint arm on top — boundary at the track's centre,
    // max handle at 100%, min at 0%, each entirely inside its own half.
    //
    // MEASURED AFTER, at the SAME press point as the BEFORE numbers above —
    // hMin.cx, x=477 at 1280 and x=29 at 375, never 470 — by
    // scripts/p8/probe-s2-fixedpoint.mjs's 20-step/50ms drag (its own header
    // explains why the speed matters). CORRECTION (P8-6 T2): this note used
    // to claim all 22 rows were viewport-identical; that was dictated from a
    // faster 10-step/20ms drag whose own committed log — one run, at
    // docs/leadgen/r2/evidence/p8/s2/after-fixedpoint.log — actually shows
    // F2 below differing by viewport (a too-fast drag under-reporting at
    // 1280, not the product). The "(5/5)" / "3 of those 5" tally once quoted
    // here for a slower-drag re-run series has NO committed log in this repo
    // — the only committed logs are the OLD fast-drag run above and
    // docs/leadgen/r2/evidence/p8/review-p8-ship/ship-s2-fcases-3runs.log (2
    // logged F1-F4-only runs, both landing F2 identical at both viewports) —
    // so the exact run count is UNMEASURED. What IS on record: the flaking
    // rows across that history were F3, F1, F3 (F3 twice, not a different row
    // each time), and this slice's own fresh 3-run check of F1-F4 just now
    // (session-only, not committed) found 1 clean run, then F2 swallowed at
    // 1280 on the next run, then F4 swallowed at 1280 on the run after that —
    // so "never F2" is false, and the swallow is not confined to F1/F3
    // either. Re-run the probe yourself before trusting any single
    // viewport-disagreeing row against this note.
    // POST /lg/auction, before -> after:
    //   typed max=40, drag RIGHT  max 50000 -> 40      LEFT  max 40 (unchanged)
    //   20000/20000, drag LEFT    max 25000 -> 20000, and the MIN moves to 5000
    //   20000/20000, drag RIGHT   20000/20000 — see the limitation below
    //   typed max=100 under min=20000 -> 20000/20000 (the exact neighbour),
    //   declared max 100000 -> 100000, above-max 200000 -> 100000, and the
    //   separated 20000/60000 drags, confirmed identical at both viewports
    //   above, land at (min 40000 / min 5000 / max 90000 / max 70000).
    //
    // THE LIMITATION, stated plainly: on a COINCIDENT pair a rightward drag
    // now records NOTHING. The min owns the circle, and the no-crossing clamp
    // pins the min against its neighbour, so the gesture is inert. That is the
    // deliberate trade, not drag parity — it is strictly better than the two
    // measured alternatives at that pixel (destroying a typed 40 into 50000,
    // and a LEFTWARD drag pushing a typed 20000 up to 25000), and the max is
    // still raised from its own labelled box or the keyboard, but a visitor
    // who expects to drag a degenerate band open will find that it does not.
    rule(`${scope} .lg-range-track > span + span > .lg-range-input-dual`, {
      "clip-path": `inset(0 0 0 calc(${rangeQuestion.thumbSize} / 2 + max((var(--lg-a,0) + var(--lg-b,100)) * (100% - ${rangeQuestion.thumbSize}) / 200, ${rangeQuestion.thumbSize} / 2 + var(--lg-a,0) * (100% - ${rangeQuestion.thumbSize}) / 100)))`,
    }),
    rule(`${scope} .lg-range-minmax`, {
      display: "flex",
      "justify-content": "space-between",
      color: rangeQuestion.minMaxLabelColor,
      "font-size": "0.8125rem",
      // P8 N15: the handle-value pill now rides BELOW its handle (was above),
      // so this row must clear the handle overhang AND the pill AND (worst
      // case, the container-query clamp bump above) the min pill pushed a
      // further spacing.xl down when the two handles sit close together — a
      // static value, so it always reserves the worst case rather than
      // reading a per-state size no CSS selector here can see (.lg-range-minmax
      // is a sibling of .lg-range-fill, outside its container-query subtree).
      "margin-top": `calc(${rangeQuestion.thumbSize} * 0.5 + ${spacing.xl} * 2)`,
    }),
    // §6.8 stepper (Image10): −/＋ FLANK the readout in one centred row, each a
    // ≥44px styled target — they were tiny, unstyled and stacked far-left.
    rule(`${scope} .lg-range-stepper-row`, {
      display: "flex",
      "align-items": "center",
      "justify-content": "center",
      gap: spacing.md,
      margin: `${spacing.md} 0`,
    }),
    rule(`${scope} .lg-range-stepper-row .lg-range-value`, { margin: "0" }),
    rule(`${scope} .lg-range-stepper-btn`, {
      display: "inline-flex",
      "align-items": "center",
      "justify-content": "center",
      width: "48px",
      height: "48px",
      "flex-shrink": "0",
      "border-radius": radius.md,
      border: `2px solid ${color.primary}`,
      background: color.card,
      color: color.primary,
      "font-size": "1.5rem",
      "line-height": "1",
      "font-weight": "600",
      cursor: "pointer",
      transition: `background-color ${transitions.btnHoverMs}ms`,
    }),
    rule(`${scope} .lg-range-stepper-btn:hover`, { background: color.primaryGhost }),
    // The two-handle tracks carry value pills ABOVE their handles, so the track
    // needs the pill's own height as clearance — without it the pills paint
    // over the question label (the P4 drive caught exactly that).
    //
    // R2 P4 FIX-FIRST-2 (N-2): 40px is clearance for ONE pill row. The
    // container query below STACKS a second row when the handles clamp
    // together, and the closure review measured that row landing ON the
    // operator's label at the low clamp (1280: label 130.6..146.6, raised min
    // pill 116.6..139.6 — a 30px overrun; the values stayed legible, the label
    // did not). Absolutely-positioned pills reserve no layout space, so this
    // margin IS the reservation and it has to hold BOTH rows. Measured budget
    // at 1280 (labelBottom = the track's margin-box top): the base pill row's
    // top sits at labelBottom + margin - 38 (15px of handle overhang + gap,
    // plus the 23px pill), and the stacked row is one `xl` higher — so the
    // margin must be 40 + xl + a gap. `sm` is that gap, giving a measured 10px
    // between the label and the stacked pill at both viewports. The stack's own
    // lift is left exactly as it was. Cost at rest: the single pill row now
    // breathes ~42px under the label instead of grazing it by 2px.
    rule(`${scope} .lg-range-from-to .lg-range-track,${scope} .lg-range-dual .lg-range-track`, {
      "margin-top": `calc(40px + ${spacing.xl} + ${spacing.sm})`,
    }),
    // §6.8 from_to (Image13): two LABELLED number inputs under the track.
    rule(`${scope} .lg-range-from-to-inputs`, {
      display: "flex",
      gap: spacing.md,
      "margin-top": spacing.md,
    }),
    rule(`${scope} .lg-range-ft-field`, {
      flex: "1 1 0",
      display: "flex",
      "flex-direction": "column",
      gap: spacing.xs,
      "min-width": "0",
    }),
    rule(`${scope} .lg-range-ft-label`, {
      "font-size": "0.8125rem",
      "font-weight": "600",
      color: page.textSecondaryColor,
    }),
    rule(`${scope} .lg-range-from,${scope} .lg-range-to`, { width: "100%" }),
    // §6.8 radial (Image14): a REAL circular dial. --lg-deg drives BOTH the
    // conic-gradient arc (inline, per value) and the ring handle's angle, so
    // one custom-property write moves the whole dial.
    rule(`${scope} .lg-range-radial`, {
      display: "flex",
      "flex-direction": "column",
      "align-items": "center",
      position: "relative",
      "--lg-radial-size": "176px",
      "--lg-radial-band": "18px",
    }),
    rule(`${scope} .lg-range-radial-outer`, {
      position: "relative",
      width: "var(--lg-radial-size)",
      height: "var(--lg-radial-size)",
      "border-radius": radius.full,
      display: "flex",
      "align-items": "center",
      "justify-content": "center",
      margin: `${spacing.md} 0`,
    }),
    rule(`${scope} .lg-range-radial-inner`, {
      position: "relative",
      width: "calc(var(--lg-radial-size) - var(--lg-radial-band) * 2)",
      height: "calc(var(--lg-radial-size) - var(--lg-radial-band) * 2)",
      "border-radius": radius.full,
      background: color.card,
      display: "flex",
      "align-items": "center",
      "justify-content": "center",
      margin: "0",
      padding: `0 ${spacing.sm}`,
      "box-sizing": "border-box",
      "line-height": "1.1",
      "z-index": "1",
    }),
    rule(`${scope} .lg-range-radial-handle`, {
      position: "absolute",
      top: "50%",
      left: "50%",
      width: rangeQuestion.thumbSize,
      height: rangeQuestion.thumbSize,
      "margin-top": `calc(${rangeQuestion.thumbSize} * -0.5)`,
      "margin-left": `calc(${rangeQuestion.thumbSize} * -0.5)`,
      "border-radius": radius.full,
      "box-sizing": "border-box",
      "z-index": "2",
      "pointer-events": "none",
      transform:
        "rotate(var(--lg-deg,0deg)) translateY(calc((var(--lg-radial-size) - var(--lg-radial-band)) * -0.5))",
    }),
    // The radial's keyboard control lives invisibly over the dial (the dial is
    // painted by the divs above); :focus-within gives it a visible focus ring.
    rule(`${scope} .lg-range-radial-input`, {
      position: "absolute",
      top: "0",
      left: "0",
      width: "100%",
      height: "100%",
      transform: "none",
      opacity: "0",
      "pointer-events": "none",
    }),
    rule(`${scope} .lg-range-radial:focus-within .lg-range-radial-outer`, {
      "box-shadow": `0 0 0 3px ${color.primaryWash}`,
    }),
  );
  // 375: the dial shrinks; the from_to fields stack so both labels stay
  // readable at the mobile card width.
  mobile.push(
    rule(`${scope} .lg-range-radial`, { "--lg-radial-size": "140px", "--lg-radial-band": "15px" }),
    rule(`${scope} .lg-range-from-to-inputs`, { gap: spacing.sm }),
  );

  // ---- primary button + continue + auto-advance (§14.2 primaryButton) -----
  // Base pill; states (hover/active/disabled/loading) live here (not inline).
  const btnBase: Record<string, string> = {
    display: "inline-flex",
    "align-items": "center",
    "justify-content": "center",
    gap: spacing.sm,
    background: primaryButton.background,
    color: primaryButton.color,
    padding: `${primaryButton.paddingY} ${primaryButton.paddingX}`,
    "min-height": primaryButton.minHeight,
    "border-radius": primaryButton.borderRadius,
    border: "0",
    "font-family": primaryButton.fontFamily,
    "font-size": primaryButton.fontSize,
    "font-weight": primaryButton.fontWeight,
    cursor: "pointer",
    "box-sizing": "border-box",
    transition: `background var(--lg-transition-btn) var(--lg-btn-easing)`,
  };
  out.push(
    rule(`${scope} .lg-btn`, btnBase),
    rule(`${scope} .lg-btn:hover`, { background: primaryButton.hoverBackground }),
    rule(`${scope} .lg-btn:active`, { transform: "scale(0.98)" }),
    rule(`${scope} .lg-btn:disabled, ${scope} .lg-btn[aria-disabled="true"]`, {
      opacity: primaryButton.disabledOpacity,
      cursor: "not-allowed",
    }),
    // Continue is the full-width centred pill (§14.6): navy, NOT blue. The base
    // navy background lives on the shared .lg-btn rule above; here .lg-continue
    // (and .lg-auto-advance) additionally read the §14.8 --lg-btn-bg override
    // custom property (token navy fallback) at REST — kept off .lg-btn so the
    // higher-specificity .lg-btn:hover darken still wins by cascade (no !important).
    rule(`${scope} .lg-continue`, {
      // U14 (operator's 3rd retest — "Continue renders left-aligned, cannot be
      // centered any way"): .lg-continue inherits display:inline-flex from the
      // shared .lg-btn base, and margin-left/right:auto compute to 0 on an
      // INLINE-level box (auto margins only center a BLOCK-level box). Setting
      // display:flex makes .lg-continue block-level so its auto side-margins DO
      // center it within the question card; btnBase already sets
      // align-items:center + justify-content:center, so the label stays centered
      // inside the pill. This is the §14.6 "full-width centred pill".
      display: "flex",
      width: "100%",
      "max-width": primaryButton.maxWidth,
      // R7 U12: helper→Continue gap = golden :350's margin-top:26px (the
      // fail-before was 0 — .lg-continue carried no top margin). This is the
      // UNFRAMED inside_unit path; the framed below_unit slot owns its own 26
      // and RESETS this to 0 (below) so the two never double-space.
      "margin-top": "26px",
      "margin-left": "auto",
      "margin-right": "auto",
      background: `var(--lg-btn-bg, ${primaryButton.background})`,
    }),
    rule(`${scope} .lg-auto-advance`, {
      background: `var(--lg-btn-bg, ${primaryButton.background})`,
    }),
    // Loading state: hide the label, show the spinner (§14.6).
    rule(`${scope} .lg-btn[data-loading="true"] .lg-btn-label`, { visibility: "hidden" }),
    rule(`${scope} .lg-btn-spinner`, { display: "none" }),
    rule(`${scope} .lg-btn[data-loading="true"] .lg-btn-spinner`, {
      display: "inline-block",
      width: "1em",
      height: "1em",
      border: `2px solid ${primaryButton.color}`,
      "border-top-color": "transparent",
      "border-radius": radius.full,
      animation: "lg-spin 0.6s linear infinite",
    }),
  );
  mobile.push(rule(`${scope} .lg-continue`, { width: primaryButton.widthMobile }));
  out.push(`@keyframes lg-spin{to{transform:rotate(360deg)}}`);

  // ---- P1a answer-group layout system (register PC-1) --------------------
  // `.lg-answer-group` (ButtonAnswerGroup + .lg-yesno TwoButtonYesNo) is a REAL
  // CSS grid, replacing the pre-P1a flow-packed inline-flex chips that measured
  // 0-gap, unequal, left-stuck (the operator's finding). Equal `minmax(0,1fr)`
  // tracks give EQUAL cells (the 0-min lets a long label wrap instead of
  // widening its track); the default 2 columns and the answerGrid.gap token
  // come from tokens.ts (authorable per-node via --lg-cols / inline gap, emitted
  // by presets.ts answerGroupRootStyle). width:100% fills the card column so the
  // group is centered by construction; an authored fixed width (s/m/l) arrives
  // inline and centers via auto side-margins (widthCenteringEntries — the U11b
  // pin). The .lg-btn.lg-btn-answer cells are grid items → they stretch to fill
  // their track (blockified inline-flex, justify-self:stretch) and keep min-
  // height:52 (primaryButton.minHeight, inherited from .lg-btn). Mobile keeps
  // the column count (buttons don't collapse like cards) and only narrows the
  // gutter. Pinned by leadgen-u11-centering (inline centering) + the new
  // leadgen-p1-geometry.gesture gate (equal cells, gap, centering, ≥52 height).
  // FIX-FIRST (F1, §6.7 adversarial review, 2026-07-22): a partial trailing
  // row's doubled track count rides an inline custom property, --lg-tracks
  // (presets.ts), which this rule prefers via a var() fallback — an
  // exact-fit instance never emits --lg-tracks, so this resolves through to
  // exactly the pre-fix value (see gridItemColumnEntries's own comment for
  // the pixel-equivalence proof — the SAME gap token produces pixel-
  // identical full-row cell widths whether an instance is doubled or not).
  // FIX-FIRST (F2, adversarial review, 2026-07-22): the ORIGINAL F1 shape
  // used a literal INLINE grid-template-columns override instead of a
  // custom property — for `.lg-card-grid` that out-ranked the mobile
  // collapse rule (see that rule's own comment below for the live-Chromium
  // proof); `.lg-answer-group` was never actually broken by this (buttons
  // have NO mobile grid-template-columns override to out-rank — "buttons
  // don't collapse like cards" per this rule's own header comment), but the
  // --lg-tracks custom-property shape is applied HERE TOO for consistency
  // and to future-proof against a mobile collapse rule ever being added for
  // buttons. A grid-based fix (not the P0 pack's flexbox `display:flex;
  // flex-wrap:wrap;justify-content:center`) was chosen specifically because
  // THIS class is measured via getComputedStyle(...).gridTemplateColumns by
  // the pinned leadgen-p1-geometry.gesture.spec.ts (btnTracks, desktop AND
  // mobile) — flexbox would report "none" and break that gate outright.
  out.push(
    rule(`${scope} .lg-answer-group`, {
      display: "grid",
      "grid-template-columns": `var(--lg-tracks, repeat(var(--lg-cols, ${answerGrid.columns}), minmax(0, 1fr)))`,
      gap: answerGrid.gap,
      width: "100%",
    }),
    // P2b FIX-ROUND (adversarial review MINOR-3): align-items:start ONLY when
    // a per-choice height is actually authored (presets.ts emits
    // data-choice-heights="1" on the root — anyChoiceHasHeight/
    // choiceHeightsAttr — the instant ANY choice/yesStyle/noStyle carries
    // style.size) — a multi-column group whose choices carry PER-CHOICE
    // heights must let each item show its own min-height (grid's default
    // align-items:stretch would otherwise equalize every cell in a row to the
    // tallest, hiding the very variation P2a's per-choice size axis exists to
    // produce). An UNAUTHORED group (the attribute absent) keeps the grid's
    // OWN implicit default (stretch — today's uniform-height look,
    // byte-identical to pre-P2b): this is a NARROWER selector than the base
    // rule above, so it is additive-only, never a behavior change for content
    // that authors no per-choice size.
    rule(`${scope} .lg-answer-group[data-choice-heights="1"]`, { "align-items": "start" }),
    // FIX-FIRST F2 FOLLOW-UP (§6.7 adversarial review, 2026-07-22): a
    // partial-row item's per-item grid-column-start/-end (presets.ts
    // gridItemColumnEntries) rides the SAME additive inline-custom-property
    // shape as the container's own --lg-tracks fix, for the SAME reason —
    // shared here since `.lg-answer-group`/`.lg-card-grid` use the identical
    // mechanism (see gridItemColumnEntries's own comment). Exact-fit items
    // never emit --lg-gc-start/--lg-gc-end, so both fall back to `auto` —
    // grid's own default — byte-identical to pre-fix.
    rule(`${scope} .lg-answer-group > *, ${scope} .lg-card-grid > *`, {
      "grid-column-start": "var(--lg-gc-start, auto)",
      "grid-column-end": "var(--lg-gc-end, auto)",
    }),
  );
  mobile.push(rule(`${scope} .lg-answer-group`, { gap: answerGrid.gapMobile }));

  // ---- answer buttons (§14.6 selected animation / §13.2 TwoButtonYesNo +
  // ButtonAnswerGroup) ------------------------------------------------------
  // An answer button is a "pick-one" affordance like the icon card — a white
  // 2px-bordered chip that washes navy when selected, NOT the navy primary FILL.
  // Its base + hover + selected + focus chrome lives here (never inline in the
  // preset) so the state rules win by cascade. The compound .lg-btn.lg-btn-answer
  // (two classes) cleanly outranks both the .lg-btn primary base AND .lg-btn:hover
  // without !important or source-order dependence, so the shared primary navy
  // fill/hover can never bleed onto a white answer button. Every value REUSES an
  // existing token (no new values): base = color.card / page.textColor /
  // input.border; hover + selected = the SAME iconCard state tokens the icon card
  // uses (§14.4); focus ring = the .lg-card:focus-visible ring.
  out.push(
    rule(`${scope} .lg-btn.lg-btn-answer`, {
      // P2b (register R-A completion): the RESTING background reads
      // choiceStyleOverlayEntries' state-safe --lg-answer-bg custom property
      // (presets.ts, P2a), falling back to the UNCHANGED color.card token.
      // Unset (no per-choice color/color_hex authored, the common case)
      // resolves byte-identically to pre-P2b. FIX-ROUND R1 (adversarial
      // review): :hover / [aria-checked="true"] / [data-selected="true"] /
      // .lg-selected below ALSO read var(--lg-answer-bg, <their own state-
      // wash fallback>) — a styled choice keeps this SAME authored color in
      // EVERY state (border-color/font-weight carry the state feedback
      // instead); an unstyled choice is unaffected (the var stays unset, so
      // each state's own token fallback paints exactly as before P2b).
      background: `var(--lg-answer-bg, ${color.card})`,
      color: page.textColor,
      border: input.border,
      // R5 state-safe border (register R3a ROUTING NOTES): a LATER
      // declaration in the SAME rule overrides just the color channel of the
      // `border` shorthand above (same specificity, source order decides).
      // presets.ts's choiceItemStyle supplies a per-node design_overrides.
      // border_color role as an inline CUSTOM PROPERTY on the RESTING state
      // only — :hover / [aria-checked="true"] / [data-selected="true"] /
      // .lg-selected below set border-color DIRECTLY (higher specificity: a
      // pseudo-class/attribute/class selector beats a bare compound-class
      // declaration) and so still win over this var-driven default — border-
      // color is the STATE-FEEDBACK channel (R1), unlike background above,
      // which now persists the SAME --lg-answer-bg in every state. Unset
      // (no per-item override authored, the common case) falls back to
      // color.border — the SAME token nodeBorderColorCss resolves to for
      // "neutral", so "no override" and "explicit neutral" render byte-
      // identically by construction (mirrors the .lg-input idiom below).
      "border-color": `var(--lg-field-border, ${color.border})`,
      transition: `border-color var(--lg-transition-card), background var(--lg-transition-card)`,
    }),
    // P2b FIX-ROUND (adversarial review R1 — "per-choice paint PERSISTS
    // across states"): background now reads var(--lg-answer-bg, <the SAME
    // hover-wash token as before>) — a styled choice keeps its AUTHORED
    // background on hover too (state feedback rides border-color instead);
    // an unstyled choice is byte-identical (the var is unset, so the
    // fallback — the unchanged token — paints exactly as before).
    rule(`${scope} .lg-btn.lg-btn-answer:hover`, {
      "border-color": iconCard.hoverBorderColor,
      background: `var(--lg-answer-bg, ${iconCard.hoverBackground})`,
    }),
    // R2 (adversarial review, pre-existing discovery): the LIVE runtime marks
    // a selected choice with the `.lg-selected` CLASS + aria-checked
    // (render.ts SELECTED_CLASS; P5 S5c ADJ-R8 fixed the runtime to ALWAYS
    // write aria-checked, matching the SSR role=radio/checkbox markup — it
    // never wrote aria-pressed after that fix). Every selected rule below
    // still keys on ALL THREE selectors so a selection paints regardless of
    // which one a given surface (live funnel vs. studio canvas/preview
    // simulator) happens to set. ZERO runtime changes were needed for the
    // CSS itself — the fix was entirely selector-side.
    rule(
      `${scope} .lg-btn.lg-btn-answer[aria-checked="true"], ${scope} .lg-btn.lg-btn-answer[data-selected="true"], ${scope} .lg-btn.lg-btn-answer.lg-selected`,
      {
        "border-color": iconCard.selectedBorderColor,
        background: iconCard.selectedBackground,
        "font-weight": "700",
      },
    ),
    rule(`${scope} .lg-btn.lg-btn-answer:focus-visible`, {
      outline: `2px solid ${color.primary}`,
      "outline-offset": "2px",
    }),
    // ---- v2.5 answer-group selected-state override consumption (FIX 4a,
    // DEV-68 coordinated re-pin; P2b FIX-ROUND R1+R2) -------------------------
    // The curated §14.8 `buttonBackground` override on ButtonAnswerGroup /
    // TwoButtonYesNo / OtherGroupSelector rides the GROUP root as the
    // --lg-sel-bg custom property (presets.ts answerGroupSelectedVar —
    // additive markup; absent override emits nothing). This rule re-states
    // the §14.6 selected background THROUGH a TWO-LEVEL var fallback (later
    // source order at equal specificity beats the base rule above): the
    // per-CHOICE --lg-answer-bg wins FIRST (R1 — an authored choice keeps its
    // own color while selected, exactly like it does on hover/resting), else
    // the per-NODE curated --lg-sel-bg (FIX 4a, unchanged), else the SAME
    // iconCard token both always resolved to. All three vars unset ⇒
    // identical computed style to pre-P2b. The --lg-sel-bg markup emission is
    // ungated and frame-independent, so the consumer belongs in the BASE
    // sheet — moved here from the frameRegions-gated block (DEV-68; the
    // coordinated legacy-pin re-pin carries the byte change; with no
    // override the var fallback keeps legacy rendering pixel-identical). R2:
    // .lg-selected added to the selector — see the base selected rule above.
    rule(
      `${scope} .lg-btn.lg-btn-answer[aria-checked="true"], ${scope} .lg-btn.lg-btn-answer[data-selected="true"], ${scope} .lg-btn.lg-btn-answer.lg-selected`,
      { background: `var(--lg-answer-bg, var(--lg-sel-bg, ${iconCard.selectedBackground}))` },
    ),
  );

  // ---- reassurance badge (§14.2 reassuranceBadge / §14.7) -----------------
  out.push(
    rule(`${scope} .lg-badge`, {
      display: "inline-flex",
      "align-items": "center",
      gap: reassuranceBadge.gap,
      border: reassuranceBadge.border,
      background: reassuranceBadge.background,
      "border-radius": reassuranceBadge.borderRadius,
      padding: `${reassuranceBadge.paddingY} ${reassuranceBadge.paddingX}`,
      color: reassuranceBadge.textColor,
      "font-size": reassuranceBadge.fontSize,
    }),
    rule(`${scope} .lg-badge-icon`, { color: reassuranceBadge.iconColor, "line-height": "1" }),
  );

  // ---- secure form badge (08 §8.3 SecureFormBadge) -------------------------
  out.push(
    rule(`${scope} .lg-secure-badge`, {
      display: "inline-flex",
      "align-items": "center",
      gap: secureFormBadge.gap,
      border: secureFormBadge.border,
      background: secureFormBadge.background,
      "border-radius": secureFormBadge.borderRadius,
      padding: `${secureFormBadge.paddingY} ${secureFormBadge.paddingX}`,
      color: secureFormBadge.textColor,
      "font-size": secureFormBadge.fontSize,
    }),
    rule(`${scope} .lg-secure-badge-icon`, { color: secureFormBadge.iconColor, "line-height": "1" }),
  );

  // ---- success state (08 §8.10 SuccessState) -------------------------------
  out.push(
    rule(`${scope} .lg-success`, {
      display: "flex",
      "flex-direction": "column",
      "align-items": "center",
      gap: spacing.sm,
      border: successState.border,
      background: successState.background,
      "border-radius": successState.borderRadius,
      padding: successState.padding,
      "text-align": "center",
    }),
    rule(`${scope} .lg-success-icon`, {
      color: successState.iconColor,
      "font-size": successState.iconSize,
      "line-height": "1",
    }),
    rule(`${scope} .lg-success-heading`, {
      "font-family": successState.headingFontFamily,
      "font-size": successState.headingFontSize,
      "font-weight": "700",
      color: successState.headingColor,
    }),
    rule(`${scope} .lg-success-message`, {
      color: successState.messageColor,
      "font-size": successState.messageFontSize,
      margin: "0",
    }),
  );

  // ---- trust bar (08 §8.3 TrustBar; stacked via modifier class) ------------
  out.push(
    rule(`${scope} .lg-trustbar`, {
      display: "flex",
      "flex-wrap": "wrap",
      "align-items": "center",
      "justify-content": "center",
      gap: trustBar.gap,
      margin: `${trustBar.marginY} 0`,
    }),
    rule(`${scope} .lg-trustbar-stacked`, {
      "flex-direction": "column",
      "align-items": "flex-start",
    }),
    rule(`${scope} .lg-trustbar-item`, {
      display: "inline-flex",
      "align-items": "center",
      gap: trustBar.itemGap,
      color: trustBar.textColor,
      "font-size": trustBar.fontSize,
    }),
    rule(`${scope} .lg-trustbar-icon`, { color: trustBar.iconColor, "line-height": "1" }),
  );

  // ---- logo strip (08 §8.3 LogoStrip) --------------------------------------
  out.push(
    rule(`${scope} .lg-logo-strip`, {
      display: "flex",
      "flex-wrap": "wrap",
      "align-items": "center",
      "justify-content": "center",
      gap: logoStrip.gap,
      margin: `${logoStrip.marginY} 0`,
    }),
    rule(`${scope} .lg-logo-strip-img`, {
      "max-height": logoStrip.logoMaxHeight,
      width: "auto",
      "object-fit": "contain",
      opacity: logoStrip.logoOpacity,
    }),
  );

  // ---- step indicator (08 §8.3 StepIndicator) ------------------------------
  out.push(
    rule(`${scope} .lg-steps`, {
      display: "flex",
      "align-items": "center",
      "justify-content": "center",
      gap: stepIndicator.gap,
      "margin-bottom": stepIndicator.marginBottom,
    }),
    rule(`${scope} .lg-step`, {
      width: stepIndicator.dotSize,
      height: stepIndicator.dotSize,
      "border-radius": radius.full,
      background: stepIndicator.dotColor,
    }),
    rule(`${scope} .lg-step[data-active="true"]`, { background: stepIndicator.activeColor }),
  );

  // ---- icon/answer card grid + card + states (§14.2 iconCardGrid/iconCard) -
  // FIX-FIRST (F1, §6.7 adversarial review, 2026-07-22): a partial trailing
  // row's doubled track count rides an inline custom property, --lg-tracks
  // (presets.ts), which this rule prefers via a var() fallback — an
  // exact-fit instance never emits --lg-tracks, so this resolves through to
  // exactly the pre-fix value (see gridItemColumnEntries's own comment for
  // the pixel-equivalence proof).
  // FIX-FIRST (F2, adversarial review, 2026-07-22 — MAJOR, live-Chromium-
  // proved): the ORIGINAL F1 shape emitted a literal INLINE
  // `grid-template-columns` override instead of a custom property. Inline
  // style ALWAYS wins over a class rule by cascade specificity — media
  // query or not — so that override out-ranked the MOBILE COLLAPSE rule
  // below (`mobile.push(... {"grid-template-columns":"1fr"})` at ≤480px): a
  // 5-card partial-row grid stayed at 6 doubled tracks (3 cramped visual
  // columns) at 375px instead of collapsing to 1, while an exact-fit control
  // correctly collapsed — reproducing exactly the "mobile columns unchanged"
  // regression §6.7 itself promises never to introduce. FIX: --lg-tracks is
  // a custom property, not the real `grid-template-columns` property itself
  // — declaring a variable inline cannot out-rank anything. The ACTUAL
  // property is still set by THIS class rule (below), which the mobile
  // rule — same specificity as this rule, later in source order, its own
  // literal `1fr` never referencing --lg-tracks at all — continues to beat
  // exactly as it always could for every other property on this element. A
  // grid-based fix (not the P0 pack's flexbox `display:flex;flex-wrap:wrap;
  // justify-content:center`) was chosen specifically because THIS class is
  // ALSO measured via getComputedStyle(...).gridTemplateColumns by the
  // pinned leadgen-p1-geometry.gesture.spec.ts (multiTracks + mobile
  // cardTracks) — flexbox would report "none" and break that gate outright.
  out.push(
    rule(`${scope} .lg-card-grid`, {
      display: "grid",
      // per-instance column count arrives inline as --lg-cols (2..5,
      // unchanged); a partial trailing row's doubled track count rides the
      // SEPARATE --lg-tracks inline custom property instead (presets.ts) —
      // preferred here via the var() fallback so the mobile collapse rule
      // below still applies normally (F2 fix).
      "grid-template-columns": "var(--lg-tracks, repeat(var(--lg-cols, 3), minmax(0, 1fr)))",
      gap: iconCardGrid.gap,
      "margin-bottom": iconCardGrid.marginBottom,
    }),
    // P2b FIX-ROUND (adversarial review MINOR-3) — the .lg-answer-group twin
    // above: align-items:start ONLY when data-choice-heights="1" (presets.ts
    // anyChoiceHasHeight — ANY choice authors style.size); unauthored grids
    // keep the implicit stretch-to-tallest default, byte-identical to pre-P2b.
    rule(`${scope} .lg-card-grid[data-choice-heights="1"]`, { "align-items": "start" }),
  );
  // Mobile collapse (§14.4 mobile 1..2 cols): the grid falls to 1 column.
  // F2: this rule's own literal `1fr` never references --lg-tracks, so it
  // continues to collapse a PARTIAL-ROW grid too, not just an exact-fit one
  // — the whole point of the F2 fix (see the base rule's own comment above).
  mobile.push(
    rule(`${scope} .lg-card-grid`, { "grid-template-columns": "1fr" }),
    // F2 FOLLOW-UP: a partial-row item's --lg-gc-start/--lg-gc-end (desktop
    // half-track centering) must NOT keep demanding a 2-track span once the
    // rule above collapses the container to a SINGLE explicit column — an
    // over-spanning item would force the grid to fabricate implicit extra
    // columns to satisfy it (live-measured: 5 tracks, "133px 38px 38px 38px
    // 38px" instead of one full-width column). Reset to `auto` HERE, for
    // cards ONLY (`.lg-answer-group`'s own children keep consuming the
    // variables unchanged — buttons never collapse on mobile, "buttons keep
    // their multi-track count" per the base rule's own header comment).
    rule(`${scope} .lg-card-grid > *`, { "grid-column-start": "auto", "grid-column-end": "auto" }),
  );
  out.push(
    rule(`${scope} .lg-card`, {
      display: "flex",
      "flex-direction": "column",
      "align-items": "center",
      "justify-content": "center",
      gap: spacing.xs,
      border: iconCard.border,
      // R5 state-safe border (register R3a ROUTING NOTES) — same idiom as
      // .lg-btn.lg-btn-answer above: a per-node border_color rides
      // --lg-field-border so :hover/[aria-checked="true"]/[data-selected=
      // "true"]/.lg-selected below (higher specificity) still win — border-
      // color is the state-feedback channel (P2b FIX-ROUND R1). Fallback =
      // color.border = the SAME "neutral" resolution, so the unauthored case
      // is byte-identical.
      "border-color": `var(--lg-field-border, ${color.border})`,
      "border-radius": iconCard.borderRadius,
      // P2b (register R-A completion): the SAME --lg-answer-bg resting-state
      // read as .lg-btn.lg-btn-answer above — icon/image/multi-choice cards
      // share this ONE base rule, so a per-choice color/color_hex paints here
      // too. Fallback = the unchanged iconCard.background token. FIX-ROUND R1
      // (adversarial review): :hover / [aria-checked="true"] / [data-selected=
      // "true"] / .lg-selected below ALSO read var(--lg-answer-bg, <their own
      // state-wash fallback>) — a styled choice keeps this SAME color in
      // every state; an unstyled choice is unaffected.
      background: `var(--lg-answer-bg, ${iconCard.background})`,
      "min-height": iconCard.minHeight,
      padding: iconCard.padding,
      cursor: "pointer",
      "text-align": "center",
      transition: `border-color var(--lg-transition-card), background var(--lg-transition-card)`,
    }),
    // P2b FIX-ROUND R1 — the SAME .lg-btn.lg-btn-answer:hover persistence
    // idiom above: an authored per-choice color rides through hover too.
    rule(`${scope} .lg-card:hover`, {
      "border-color": iconCard.hoverBorderColor,
      background: `var(--lg-answer-bg, ${iconCard.hoverBackground})`,
    }),
    // selected state (§14.4). P2b FIX-ROUND R1+R2: background persists the
    // per-choice --lg-answer-bg (R1 — no --lg-sel-bg equivalent exists for
    // cards, so the fallback is directly the SAME iconCard token); .lg-selected
    // added (R2 — the live runtime's SELECTED_CLASS, never aria-checked/
    // data-selected — see the .lg-btn-answer selected rule above for the full
    // citation).
    rule(
      `${scope} .lg-card[aria-checked="true"], ${scope} .lg-card[data-selected="true"], ${scope} .lg-card.lg-selected`,
      {
        "border-color": iconCard.selectedBorderColor,
        background: `var(--lg-answer-bg, ${iconCard.selectedBackground})`,
        "font-weight": "700",
      },
    ),
    // keyboard focus (§14.4)
    rule(`${scope} .lg-card:focus-visible`, {
      outline: `2px solid ${color.primary}`,
      "outline-offset": "2px",
    }),
    // disabled state (§14.4)
    rule(`${scope} .lg-card[aria-disabled="true"], ${scope} .lg-card:disabled`, {
      opacity: iconCard.disabledOpacity,
      cursor: "not-allowed",
    }),
    // error state (§14.4) — R2 P8 M2 / S3.10. WAS
    // `.lg-card[data-error="true"]`, an unreachable selector: no producer in
    // the visitor runtime ever writes `data-error`. Re-pointed at the state
    // runtime/render.ts:228 setFieldError really produces (ERROR_CLASS
    // "lg-error" on the `[data-lg-field]` block — here the `.lg-card-grid`
    // root, presets.ts:1717 hydration() — with the `.lg-card` buttons as its
    // descendants). Same specificity class as the selector it replaces
    // (scope attr + 2), same source position, so the interaction-state
    // cascade against selected/hover/disabled is unchanged.
    rule(`${scope} .lg-error .lg-card`, { "border-color": iconCard.errorBorderColor }),
    // P1a (register PC-11): the icon slot centers its glyph without constraining
    // it — P1b's leadgenIconSvg(id,48) emits an explicit 48×48 <svg>, so an
    // inline-flex box sizes TO the 48px icon (never shrinks it) and centers a
    // legacy emoji glyph (text, iconCard.iconSize) identically. line-height:1
    // keeps the emoji strut tight.
    rule(`${scope} .lg-card-icon`, {
      display: "inline-flex",
      "align-items": "center",
      "justify-content": "center",
      color: iconCard.iconColor,
      "font-size": iconCard.iconSize,
      "line-height": "1",
    }),
    rule(`${scope} .lg-card-title`, {
      "font-size": iconCard.titleFontSize,
      "font-weight": iconCard.titleFontWeight,
      color: iconCard.titleColor,
    }),
    rule(`${scope} .lg-card-desc`, {
      "font-size": subheadline.fontSize,
      color: page.textSecondaryColor,
    }),
    rule(`${scope} .lg-card-img`, {
      "max-height": "32px",
      width: "auto",
      "object-fit": "contain",
    }),
    // OWNER RULING (2026-08-11): a card whose image has not been PICKED YET shows
    // an honest labelled slot, never a broken image. The studio must seed
    // something (content-schema requires a non-empty imageMediaId on an image
    // card), so it seeds MEDIA_PENDING_REF and this is what that renders as — the
    // same treatment ImageBlock's own placeholder already had
    // (.lg-image-block-placeholder). Sized to the image slot it stands in for, so
    // the card keeps its shape and the operator sees exactly where the picture goes.
    rule(`${scope} .lg-card-img-placeholder`, {
      display: "inline-flex",
      "align-items": "center",
      "justify-content": "center",
      "min-height": "32px",
      padding: `0 ${spacing.sm}`,
      border: `1px dashed ${color.border}`,
      "border-radius": radius.sm,
      color: page.textLightColor,
      "font-size": "0.75rem",
      "line-height": "1",
    }),
    // ---- v2.5 choice-depth base rules (08 §8.4, DEV-57 Phase-C move) --------
    // .lg-card-subtitle / .lg-card-badge style ONLY the new-choice-field
    // markup (no legacy content emits those classes), but the MARKUP is
    // frame-independent — a frameless funnel can render badge/subtitle
    // choices, so the rules belong in the BASE sheet. Moved here from the
    // frameRegions-gated block (a coordinated legacy-pin re-pin carries the
    // byte change; legacy rendering is pixel-identical).
    // .lg-card-subtitle — structural complement of the inline
    // iconCard.subtitle* tokens (font-size/color ride inline).
    rule(`${scope} .lg-card-subtitle`, {
      display: "block",
      "margin-top": spacing.xs,
      "line-height": "1.3",
    }),
    // .lg-card-badge positioning — top-right pill over the card corner
    // (the badge colours/typography ride inline via iconCard.badge*);
    // .lg-card{position:relative} is its positioning companion.
    rule(`${scope} .lg-card`, { position: "relative" }),
    rule(`${scope} .lg-card-badge`, {
      position: "absolute",
      top: spacing.xs,
      right: spacing.xs,
      "line-height": "1.2",
      "white-space": "nowrap",
    }),
  );

  // ---- inputs + fields + dropdown (§14.2 input / dropdown) ----------------
  out.push(
    rule(`${scope} .lg-field`, {
      display: "block",
      "margin-bottom": spacing.md,
    }),
    rule(`${scope} .lg-label`, {
      display: "block",
      "font-size": subheadline.fontSize,
      color: page.textSecondaryColor,
      "margin-bottom": spacing.xs,
    }),
    // P5-F3 (owner A.1 #6 Image8): the per-SUB-FIELD label renderAddressFieldSet
    // now renders above each field of a multi-field composite — a DEDICATED
    // class (not .lg-label, which stays the ONE whole-field-set/question
    // label per §6.3) so the two never collide, same typography.
    rule(`${scope} .lg-address-field-label`, {
      display: "block",
      "font-size": subheadline.fontSize,
      color: page.textSecondaryColor,
      "margin-bottom": spacing.xs,
    }),
    rule(`${scope} .lg-input`, {
      width: "100%",
      "box-sizing": "border-box",
      padding: input.padding,
      border: input.border,
      // v3.1 fix-round (adversarial review, CSS-cascade regression close-
      // out): a LATER declaration in the SAME rule overrides just the color
      // channel of the `border` shorthand above (same specificity, source
      // order decides). var(--lg-field-border, …) lets components/
      // presets.ts's fieldAppearanceStyle supply a per-field design_
      // overrides.border_color role as an inline CUSTOM PROPERTY on the
      // RESTING state only — :focus / [aria-invalid] below set border-color
      // DIRECTLY (higher specificity: a pseudo-class/attribute selector
      // beats a bare class) and so still win over this var-driven default
      // exactly as they did before this feature existed. Unset (no per-
      // field override authored, the common case) falls back to
      // color.border — the SAME token presets.ts's border_color:"neutral"
      // resolves to, so "no override" and "explicit neutral" render byte-
      // identically by construction.
      "border-color": `var(--lg-field-border, ${color.border})`,
      "border-radius": input.borderRadius,
      "font-size": input.fontSize,
      "font-family": "inherit",
      color: page.textColor,
      // R2 F-2: was the literal "44px". Now the `input.minHeight` token, which
      // a resolved theme record's controls.field_height writes (theme.ts
      // applyFieldHeightStep) — so the Themes manager's "Field height" governs
      // every un-overridden field, and a per-node design_overrides.size still
      // wins over it by inline-style cascade exactly as before. The base token
      // value is "44px", so an unthemed / inline-themed funnel is identical.
      "min-height": input.minHeight,
      background: color.card,
    }),
    rule(`${scope} .lg-input:focus`, {
      outline: "none",
      "border-color": input.focusBorderColor,
    }),
    rule(`${scope} .lg-input[aria-invalid="true"]`, { "border-color": input.errorBorderColor }),
    rule(`${scope} .lg-input::placeholder`, { color: input.placeholderColor }),
    // dropdown inherits input; custom chevron colour (§14.2 dropdown).
    rule(`${scope} .lg-dropdown`, {
      "-webkit-appearance": "none",
      "-moz-appearance": "none",
      appearance: "none",
      "background-image": `url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 16 16'><path fill='${encodeURIComponent(dropdown.chevronSvgFill)}' d='M4 6l4 4 4-4z'/></svg>")`,
      "background-repeat": "no-repeat",
      "background-position": "right 16px center",
      "padding-right": "40px",
    }),
    // searchable dropdown (08 §8.3): the search input sits above the <select>.
    rule(`${scope} .lg-dropdown-search`, { "margin-bottom": spacing.sm }),
    // currency input (08 §8.10): prefix symbol aligned inside the input box;
    // the input clears it with token-derived left padding. R7 U12: input.padding
    // is now the golden's ASYMMETRIC "16px 18px" (V H) — `left` takes ONE value,
    // so derive the SIDE (horizontal) component (a 2-value shorthand → 2nd value,
    // a 1-value → itself) so the `$` still aligns to the input's real left inset.
    rule(`${scope} .lg-currency`, { position: "relative" }),
    rule(`${scope} .lg-currency-prefix`, {
      position: "absolute",
      left: (() => {
        const p = input.padding.trim().split(/\s+/);
        return p.length >= 2 ? p[1]! : p[0]!;
      })(),
      top: "50%",
      transform: "translateY(-50%)",
      color: page.textSecondaryColor,
      "font-size": input.fontSize,
      "pointer-events": "none",
    }),
    rule(`${scope} .lg-currency-input`, { "padding-left": spacing.xl }),
    // P5-F3 (owner A.1 #8 "Other" dropdown): the authored-Other <select>
    // (otherSelectMarkup) is a direct grid item of the SAME .lg-answer-group/
    // .lg-card-grid the choices use, auto-placed into ONE narrow track next
    // to its .lg-other-trigger — .lg-input's width:100% above then only
    // ever fills that one column, clipping long authored option text
    // ("Weehawken Cus…"). Spanning the full row instead gives it the
    // container's own already-mobile-safe width (never narrower than a
    // column, never wider than the container, so 375px can't overflow)
    // without touching the trigger's own placement or the grid's own
    // column count/centering.
    rule(`${scope} select.lg-other-select`, { "grid-column": "1 / -1" }),
  );

  // ---- validation: error / helper / legal (§14.2 validation) --------------
  out.push(
    rule(`${scope} .lg-error`, {
      color: validation.errorTextColor,
      "font-size": validation.errorFontSize,
      "margin-top": spacing.xs,
    }),
    rule(`${scope} .lg-helper`, {
      color: validation.helperColor,
      "font-size": validation.errorFontSize,
      "margin-top": spacing.xs,
    }),
    rule(`${scope} .lg-legal`, {
      color: validation.helperColor,
      "font-size": "0.75rem",
      "line-height": "1.4",
    }),
    rule(`${scope} .lg-valid`, { color: validation.successColor }),
  );

  // ---- banner sub-design (§14.2 banner / §20) -----------------------------
  out.push(
    rule(`${scope} .lg-banner`, {
      border: banner.cardBorder,
      "border-radius": banner.cardRadius,
      padding: banner.cardPadding,
      background: color.card,
    }),
    rule(`${scope} .lg-banner[data-recommended="true"]`, {
      border: banner.recommendedBorder,
      background: banner.recommendedBg,
      "box-shadow": banner.recommendedGlow,
    }),
    rule(`${scope} .lg-banner-name`, {
      "font-size": banner.nameFontSize,
      "font-weight": banner.nameFontWeight,
      color: page.textColor,
    }),
    rule(`${scope} .lg-banner-cta`, {
      background: banner.ctaBackground,
      color: banner.ctaColor,
      "border-radius": banner.ctaRadius,
      "text-transform": banner.ctaTextTransform,
      padding: `${primaryButton.paddingY} ${primaryButton.paddingX}`,
      "text-decoration": "none",
      display: "inline-block",
    }),
  );

  // ---- §8.5 layout containers (08 E4) --------------------------------------
  // Stack: flex column/row via data-direction; align via data-align. The
  // per-instance GAP token value arrives inline from the preset (the
  // --lg-cols idiom) — everything else is class-driven.
  out.push(
    rule(`${scope} .lg-stack`, { display: "flex", "flex-direction": "column" }),
    rule(`${scope} .lg-stack[data-direction="horizontal"]`, {
      "flex-direction": "row",
      "flex-wrap": "wrap",
    }),
    rule(`${scope} .lg-stack[data-align="start"]`, { "align-items": "flex-start" }),
    rule(`${scope} .lg-stack[data-align="center"]`, { "align-items": "center" }),
    rule(`${scope} .lg-stack[data-align="end"]`, { "align-items": "flex-end" }),
    rule(`${scope} .lg-stack[data-align="stretch"]`, { "align-items": "stretch" }),
  );
  // Horizontal stacks collapse to a column on mobile (the §8.11 stacked-
  // buttons behavior) — vertical stacks are unaffected.
  mobile.push(
    rule(`${scope} .lg-stack[data-direction="horizontal"]`, { "flex-direction": "column" }),
  );

  // GridContainer: per-breakpoint columns via the --lg-gc-cols-* custom
  // properties the preset emits inline (desktop at base, mobile inside the
  // mobile media-query array — the iconCardGrid responsive idiom; the tablet
  // count is emitted as --lg-gc-cols-t for the Studio canvas/preview, which
  // renders desktop/mobile viewports only, §8.9). Sizing equal|auto.
  out.push(
    rule(`${scope} .lg-grid-container`, {
      display: "grid",
      "grid-template-columns": "repeat(var(--lg-gc-cols-d, 3), minmax(0, 1fr))",
      "margin-bottom": design.gridContainer.marginBottom,
    }),
    rule(`${scope} .lg-grid-container[data-sizing="auto"]`, {
      "grid-template-columns": "repeat(var(--lg-gc-cols-d, 3), auto)",
      "justify-content": "center",
    }),
  );
  mobile.push(
    rule(`${scope} .lg-grid-container`, {
      "grid-template-columns": "repeat(var(--lg-gc-cols-m, 1), minmax(0, 1fr))",
    }),
    rule(`${scope} .lg-grid-container[data-sizing="auto"]`, {
      "grid-template-columns": "repeat(var(--lg-gc-cols-m, 1), auto)",
    }),
  );

  // Columns: the four §8.5 ratio presets as data-ratio variants; mobile
  // stacking per data-mobile (stack collapses to one column inside the mobile
  // media query; keep preserves the ratio).
  out.push(
    rule(`${scope} .lg-columns`, {
      display: "grid",
      gap: columns.gap,
      "margin-bottom": columns.marginBottom,
    }),
    rule(`${scope} .lg-columns[data-ratio="50/50"]`, { "grid-template-columns": "1fr 1fr" }),
    rule(`${scope} .lg-columns[data-ratio="60/40"]`, { "grid-template-columns": "3fr 2fr" }),
    rule(`${scope} .lg-columns[data-ratio="40/60"]`, { "grid-template-columns": "2fr 3fr" }),
    rule(`${scope} .lg-columns[data-ratio="70/30"]`, { "grid-template-columns": "7fr 3fr" }),
  );
  mobile.push(
    rule(`${scope} .lg-columns[data-mobile="stack"]`, { "grid-template-columns": "1fr" }),
  );

  // CardPanel: centered card shell; the per-instance §8.5 token values
  // (max-width/background/shadow/radius/padding) arrive inline from the
  // preset — the class carries the structural bits + the hairline border.
  out.push(
    rule(`${scope} .lg-card-panel`, {
      width: "100%",
      "margin-left": "auto",
      "margin-right": "auto",
      "box-sizing": "border-box",
      border: cardPanel.border,
    }),
  );

  // BackgroundPanel: token background/gradient inline from the preset; a
  // mediaId image renders as a decorative cover layer behind the content.
  out.push(
    rule(`${scope} .lg-bg-panel`, {
      position: "relative",
      overflow: "hidden",
      padding: backgroundPanel.padding,
      "border-radius": backgroundPanel.radius,
    }),
    rule(`${scope} .lg-bg-panel-img`, {
      position: "absolute",
      inset: "0",
      width: "100%",
      height: "100%",
      "object-fit": "cover",
    }),
    rule(`${scope} .lg-bg-panel-inner`, { position: "relative" }),
  );

  // ---- R2 P1 §① QuestionGrid (design pin "Screenshot 2026-07-27 at
  // 18.30.25.png") -----------------------------------------------------------
  // The pin's anatomy is a STACK of labeled question blocks: one column, each
  // block = the question's own `.lg-label` above its own control, an even
  // author-chosen gap between blocks, ONE Continue below the whole group.
  //
  //   • `.lg-qgrid` — one column, ALWAYS (the group is a vertical list of
  //     questions; a side-by-side pair is expressed per-child through the
  //     P3a `layout.row` placement system, exactly like top-level siblings,
  //     never by turning this container into a multi-column grid).
  //     The per-instance GAP token value arrives INLINE from the preset (the
  //     `.lg-stack`/--lg-cols idiom), so this container owns its internal
  //     rhythm and is correctly OUTSIDE the `> * + *` margin-floor family
  //     (the scoping rule recorded with that floor above).
  //   • `.lg-qgrid-q` — ONE question's labeled block (label + control + its
  //     helper/error slot). `min-width:0` is the grid-item overflow guard: a
  //     long label/option string can never push the track wider than the card
  //     at 375 (the same minmax(0,1fr) discipline `.lg-grid-container` uses),
  //     and `max-width:100%` clamps a fixed-width child. NO `display` is set
  //     here on purpose — a block <div> is already correct, and leaving the
  //     property unset lets the terminal `[hidden]{display:none}` guard hide a
  //     dependency-hidden block (label WITH control) without a specificity
  //     fight.
  out.push(
    rule(`${scope} .lg-qgrid`, {
      display: "grid",
      "grid-template-columns": "minmax(0, 1fr)",
      width: "100%",
      "box-sizing": "border-box",
    }),
    rule(`${scope} .lg-qgrid-q`, { "min-width": "0", "max-width": "100%" }),
  );

  // Spacer: block gap; its height token value is inline from the preset.
  out.push(rule(`${scope} .lg-spacer`, { display: "block" }));

  // HeaderBar: placeable header slot (logo / back / secure / CTA) — fully
  // class-driven from the headerBar token group.
  out.push(
    rule(`${scope} .lg-headerbar`, {
      display: "flex",
      "align-items": "center",
      "justify-content": "space-between",
      gap: headerBar.gap,
      "max-width": headerBar.contentMaxWidth,
      "margin-left": "auto",
      "margin-right": "auto",
      background: headerBar.background,
      padding: `${headerBar.paddingY} ${headerBar.paddingX}`,
      "box-shadow": headerBar.boxShadow,
      "box-sizing": "border-box",
    }),
    rule(`${scope} .lg-headerbar-left, ${scope} .lg-headerbar-right`, {
      display: "inline-flex",
      "align-items": "center",
      gap: headerBar.gap,
    }),
    rule(`${scope} .lg-headerbar-logo`, { "max-height": headerBar.logoMaxHeight, width: "auto" }),
    rule(`${scope} .lg-headerbar-secure`, {
      display: "inline-flex",
      "align-items": "center",
      gap: spacing.xs,
      color: headerBar.secureColor,
      "font-size": headerBar.secureFontSize,
    }),
    rule(`${scope} .lg-headerbar-secure-icon`, {
      color: headerBar.secureIconColor,
      "line-height": "1",
    }),
    rule(`${scope} .lg-headerbar-cta`, {
      display: "inline-block",
      background: headerBar.ctaBackground,
      color: headerBar.ctaColor,
      "border-radius": headerBar.ctaRadius,
      "font-size": headerBar.ctaFontSize,
      padding: headerBar.ctaPadding,
      "text-decoration": "none",
      "font-weight": primaryButton.fontWeight,
    }),
  );

  // FooterBar: trust messages / links / legal — fully class-driven from the
  // footerBar token group.
  out.push(
    rule(`${scope} .lg-footerbar`, {
      display: "flex",
      "flex-direction": "column",
      "align-items": "center",
      gap: footerBar.gap,
      background: footerBar.background,
      "border-top": footerBar.borderTop,
      padding: footerBar.padding,
      "margin-top": footerBar.marginTop,
      "text-align": "center",
    }),
    rule(`${scope} .lg-footerbar-trust`, {
      display: "flex",
      "flex-wrap": "wrap",
      "justify-content": "center",
      gap: spacing.md,
      color: footerBar.trustColor,
      "font-size": footerBar.trustFontSize,
    }),
    rule(`${scope} .lg-footerbar-links`, {
      display: "flex",
      "flex-wrap": "wrap",
      "justify-content": "center",
      gap: spacing.md,
    }),
    rule(`${scope} .lg-footerbar-link`, {
      color: footerBar.linkColor,
      "font-size": footerBar.fontSize,
      "text-decoration": "underline",
    }),
    rule(`${scope} .lg-footerbar-legal`, {
      color: footerBar.textColor,
      "font-size": footerBar.fontSize,
      "line-height": "1.4",
    }),
  );

  // ---- P1a FIX ROUND (conductor, register PC-3): grid-follower collapse
  // emulation ------------------------------------------------------------
  // LIVE-MEASURED finding: `.lg-answer-group`/`.lg-card-grid` (display:grid)
  // do NOT margin-collapse with an adjoining sibling the way two normal block
  // boxes do — confirmed by a real browser measurement (leadgen-p1-geometry
  // gate): subheadline (margin-bottom 30) followed by the answer-group (the
  // general stack rule's margin-top 18, above) rendered a 48px gap — the SUM
  // of both margins, not max(30,18)=30 like a normal block→block pair (the
  // SAME subheadline→field pair collapses correctly to 30, per r3a-effects —
  // proving the non-collapse is specific to the grid box, not this codebase's
  // margin values in general). The operator's reference shows ~28-30px here,
  // not 48. This table EMULATES the missing collapse — gap == max(predecessor's
  // own margin-bottom, spacing.stack) — for EVERY direct-.lg-question-card-
  // child element that (a) carries a non-zero margin-bottom in this sheet AND
  // (b) can plausibly sit immediately before an answer-group/card-grid, by
  // reducing (or zeroing) the grid follower's margin-top so the SUM equals the
  // desired max(). Enumerated from EVERY non-zero margin-bottom rule in this
  // file, cross-checked against presets.ts's actual render output — verified
  // NOT to include .lg-label/.lg-dropdown-search/.lg-range-value (nested-only,
  // never a direct top-level card child) and .lg-name-group/.lg-range/.lg-input/
  // .lg-field-boxed (real top-level field wrappers — all margin-bottom:0, so
  // no exception is needed: 0 + stack == stack already, the same "sum happens
  // to equal collapse" case as an unset predecessor). `.lg-field` (margin-
  // bottom 16) is included per its LITERAL existence in this sheet even though
  // presets.ts currently renders it ONLY nested inside NameFieldsGroup (never a
  // direct top-level predecessor of a grid) — inert today, harmless, forward-
  // compatible if a future field type ever promotes it to top level.
  //
  // STUDIO-CANVAS WRAPPING (found while verifying this fix with the real
  // browser — leadgen-p1-geometry gate): the studio ISLAND wraps the
  // CURRENTLY-SELECTED choice-bearing node (.lg-answer-group / .lg-card-grid)
  // in an undecorated `<span>` (its move/drag-handle-tag decoration,
  // ui-section-studio.ts — out of this slice's owned region), so a plain
  // adjacent-sibling selector (`X + .lg-answer-group`) does not match: the
  // SPAN, not the grid, is the actual DOM sibling. This ONLY affects whichever
  // node happens to be selected (verified: an unselected card-grid renders as
  // a normal direct child, no wrapper) — but an operator normally DOES have
  // some field selected while editing, so a `:has()` companion selector
  // (`X + *:has(> .lg-answer-group)`) is added alongside every direct-sibling
  // selector below, reaching through that wrapper to give the SAME rhythm
  // whether or not the follower happens to be the selected node. `:has()` is
  // supported by both this repo's Playwright-bundled engines at authoring
  // time (chromium 147 / firefox 148) and by the evergreen browsers these
  // funnels ship to; it changes NOTHING for the (unwrapped) live funnel path,
  // where the base "X + .lg-answer-group" selector alone already matches.
  //
  // Placed LAST in the base sheet (after every per-component rule above,
  // including .lg-continue's own margin-top:26) so it wins any specificity tie
  // for the margin-top property specifically — every OTHER property
  // (.lg-continue's background/width/display, etc.) is untouched.
  {
    // rem-aware px resolver (16px-root assumption — this file's existing
    // convention wherever a rem/px token pair must be compared numerically,
    // e.g. the R7 U12 literal-px conversions elsewhere in this file). BUG
    // CAUGHT BY DIRECT VERIFICATION: a bare `parseFloat("1rem")` returns 1
    // (it stops at the first non-numeric character), NOT 16 — silently
    // mis-scoring every rem-valued predecessor by 15px. spacing.md/trustBar.
    // marginY/logoStrip.marginY/columns.marginBottom are ALL "1rem" tokens.
    const toPx = (value: string): number => {
      const n = parseFloat(value);
      return value.trim().endsWith("rem") ? n * 16 : n;
    };
    const stackPx = toPx(spacing.stack); // 18
    // stack - predecessor's own margin-bottom, floored at 0 (never negative —
    // a predecessor whose own mb already meets/exceeds the stack contributes
    // the WHOLE gap by itself, so the follower's share is 0, not negative).
    const emulated = (predecessorMarginBottom: string): string =>
      `${Math.max(0, stackPx - toPx(predecessorMarginBottom))}px`;
    // P3a (register PC-2): `.lg-el-row` (display:flex) shares the grid boxes'
    // non-collapse — a row following a margin-bottom predecessor would SUM
    // (not max()) its floor margin-top, so it takes the SAME emulation. A lone
    // `.lg-el` is a normal block (collapses), so it is NOT a follower here.
    const GRID_FOLLOWERS = [".lg-answer-group", ".lg-card-grid", ".lg-el-row"] as const;
    // Direct-sibling selectors (the live/unwrapped path) PLUS the `:has()`
    // companion (the studio-canvas selected/wrapped path) for every predecessor
    // + grid-follower pair.
    const followerSelectors = (predecessor: string): string =>
      GRID_FOLLOWERS.flatMap((f) => [
        `${scope} ${predecessor} + ${f}`,
        `${scope} ${predecessor} + *:has(> ${f})`,
      ]).join(", ");
    out.push(
      // Category A — predecessor's own margin-bottom already >= stack: zero
      // the grid follower's margin-top (gap == predecessor's own mb).
      rule(
        [
          followerSelectors(".lg-subheadline"), // mb 30 (golden; conductor part a)
          followerSelectors(".lg-progress"), // mb 32 (2rem)
          followerSelectors(".lg-steps"), // mb 24 (1.5rem)
          followerSelectors(".lg-grid-container"), // mb 24 (1.5rem, GridContainer)
        ].join(", "),
        { "margin-top": "0" },
      ),
      // .lg-card-grid AS PREDECESSOR (mb 24 >= stack): its own margin-bottom
      // already covers the floor for ANY follower type, not just grids — the
      // conductor's part (b). Direct form targets `*` (e.g. multi(.lg-card-
      // grid.lg-multi) -> a plain block, or -> .lg-continue — overriding
      // .lg-continue's own margin-top:26 when it directly follows a card-grid
      // with no field/helper between them; no golden reference pins that
      // specific adjacency, so the card-grid's own established 24 rhythm wins
      // uniformly rather than special-casing Continue here). The `:has()`
      // companion covers a SELECTED card-grid (wrapped) as the predecessor.
      rule([`${scope} .lg-card-grid + *`, `${scope} *:has(> .lg-card-grid) + *`].join(", "), {
        "margin-top": "0",
      }),
      // Category B — predecessor's own margin-bottom < stack: give the grid
      // follower just enough margin-top to reach the stack total (the max()).
      rule(followerSelectors(".lg-headline"), {
        "margin-top": emulated(headline.marginBottom), // 18-9=9
      }),
      rule(followerSelectors(".lg-category"), {
        "margin-top": emulated(categoryLabel.marginBottom), // 18-12=6
      }),
      rule(
        [
          followerSelectors(".lg-trustbar"), // marginY 1rem(16) — TrustBar
          followerSelectors(".lg-logo-strip"), // marginY 1rem(16) — LogoStrip
          followerSelectors(".lg-columns"), // marginBottom 1rem(16) — Columns
          followerSelectors(".lg-field"), // marginBottom 1rem(16) — see note above (currently inert)
        ].join(", "),
        { "margin-top": emulated(spacing.md) }, // 18-16=2 (all four share the SAME 1rem token value)
      ),
    );
  }

  // ---- P1a terminal `[hidden]` guard (register PC — hidden-attribute vs
  // author-display defect) --------------------------------------------------
  // The runtime hides conditionally-shown components by TOGGLING the boolean
  // `hidden` attribute (render.ts applyComponentVisibility / setBackVisible /
  // updateFooterVisibility, plus the SSR-baked `hidden` on the
  // [data-lg-banners] mount, [data-lg-other-panel] and a show_on:"final"
  // footer). The UA sheet's `[hidden]{display:none}` is specificity (0,1,0);
  // EVERY author rule in this sheet carries the scope attribute + at least one
  // class = (0,2,0)+, so it OUTRANKS the UA rule — a hidden component that ALSO
  // has a `display:` rule renders VISIBLE on a live funnel. The live-measured
  // surface (leadgen-live-funnel dependency-HIDE assertion resolved
  // `<div hidden class="lg-answer-group">` yet toBeHidden() saw it visible) and
  // the full cascade audit (leadgen-hidden-visibility.test.ts) found exactly
  // THREE force-visible-when-hidden rules, all at (0,2,0): `.lg-answer-group`
  // (ButtonAnswerGroup / TwoButtonYesNo / OtherGroupSelector, display:grid),
  // `.lg-card-grid` (IconCardAnswerGrid / MultiChoiceCardGroup, display:grid)
  // and `.lg-back` (the Back affordance, display:inline-flex).
  //
  // ONE terminal rule restores the intent at author origin: at the SAME (0,2,0)
  // specificity as every force-visible rule, LATER source order wins, so
  // `hidden` beats `display:grid|inline-flex|flex|block|…` for ANY scoped
  // descendant. The audit confirms NO force-visible display rule on a hideable
  // element exceeds (0,2,0) — every (0,3,0)+ display rule is either
  // `display:none` (reinforcing) or targets a non-hideable element
  // (`.lg-frame-trust`, `.lg-btn-spinner`, the back-icon `span`) — so no
  // higher-specificity companion guard is needed.
  //
  // PLACEMENT: after every base per-component rule (so it wins the source-order
  // tie over all three force-visible rules above) but BEFORE the opt-in
  // frame-region block below, so the frameRegions extension stays a pure APPEND
  // — the no-frame base sheet remains a byte-stable PREFIX of the framed output
  // (the 13 §13.1 invariant leadgen-frame-render.test.ts pins). The frame-region
  // block adds NO force-visible display rule on any hideable class, so nothing
  // after this rule can re-show a hidden component. It only sets `display`, so
  // the grid-follower `margin-top` rules above keep their own last-among-margin
  // precedence untouched. The mobile @media block that follows carries no
  // force-visible display rule on any hideable class either (only `display:none`
  // hides, a root-compound progress `display:flex`, and non-hideable
  // `.lg-frame-trust` layout), so this base rule also wins inside the media
  // query — no mobile duplicate needed (the MOBILE SAFETY case pins this).
  out.push(rule(`${scope} [hidden]`, { display: "none" }));

  // ---- Round-4 P1b studio/preview affordances (A-9 ghost · A-6 Address
  // composite · A-3 MQG empty-state) -----------------------------------------
  // Placed in the BASE sheet BEFORE the opt-in frame-region block below, so the
  // frameRegions extension stays a pure APPEND (the 13 §13.1 byte-stable-prefix
  // invariant leadgen-frame-render.test.ts pins). These ride the SHARED chrome
  // sheet the studio canvas + admin preview srcdoc already embed — NOT a new
  // global. Everything is scoped so the LIVE funnel is visually untouched:
  // `.studio-choice-ghost` is studio-injected only (never in a live DOM), and
  // the composite / empty-state markup is present in every context but
  // DISPLAYED only under a `.lg-preview` wrapper. The studio canvas + admin
  // preview carry `.lg-preview` on the SAME element as the design-scope attr;
  // the live #lg-funnel-root carries the attr but NOT `.lg-preview`, so
  // `${scope}.lg-preview …` never matches on live. None of these classes is a
  // hideable answer component, so the `[hidden]` force-visible tie above holds.
  out.push(
    // A-9 (P-8): the "+ Add choice" ghost the studio appends into an answer
    // group / card grid must NOT consume an equal-fraction track (which made it
    // read as a peer card). grid-column 1/-1 spans the whole row as a slim
    // strip BELOW the real cells (a fresh implicit row), so the real cells'
    // widths stay IDENTICAL to the live, ghost-free render (the P1b gate).
    // BOTH grid families; overrides P1a's base min-height:44 for the slim look.
    rule(`${scope} .lg-answer-group .studio-choice-ghost, ${scope} .lg-card-grid .studio-choice-ghost`, {
      "grid-column": "1 / -1",
      "min-height": "0",
      height: "40px",
      display: "flex",
      "align-items": "center",
      "justify-content": "center",
      border: `1px dashed ${page.textSecondaryColor}`,
      color: page.textSecondaryColor,
      "border-radius": radius.md,
      "margin-top": spacing.xs,
    }),
    // P5-F3: the A-6/P-6 Address composite preview (`.lg-address-composite`,
    // `-composite-note`, `-composite-fields` — the studio-only decorative
    // "what WOULD auto-fill" box) is REMOVED here — it was the pre-D3 L-192
    // fallback's own preview; since R2 P5 S5a (owner D3) the visitor's
    // address renders the REAL 4-field composite directly (renderAddressFieldSet),
    // so no renderer has emitted these three classes since (grepped clean
    // across src/ before this deletion). `.lg-address-chip*` below is a
    // DIFFERENT, still-referenced-only-here decorative artifact of the same
    // retired preview and is left untouched (out of this slice's scope).
    rule(`${scope}.lg-preview .lg-address-chip`, {
      display: "inline-flex",
      "flex-direction": "column",
      gap: "1px",
      padding: "4px 9px",
      border: `1px solid ${page.textLightColor}`,
      "border-radius": radius.sm,
      "font-size": "11px",
    }),
    rule(`${scope}.lg-preview .lg-address-chip-role`, { "font-weight": "700", color: page.textColor }),
    rule(`${scope}.lg-preview .lg-address-chip-field`, { color: page.textSecondaryColor, "font-family": "monospace" }),
    // §10 fail-safe box: a stored node of a RETIRED/unknown component type
    // (the §10-removed grid / OtherGroupSelector / Range / CurrencyRange, or
    // any corrupt type) renders `.lg-mqg-empty` from presets' default case —
    // NEVER a 500 (L-192 seam). Hidden by default (a LIVE funnel renders
    // nothing for it — silent); shown as an honest notice under `.lg-preview`
    // (studio canvas + admin preview).
    rule(`${scope} .lg-mqg-empty`, { display: "none" }),
    rule(`${scope}.lg-preview .lg-mqg-empty`, {
      display: "block",
      padding: spacing.md,
      border: `1px dashed ${page.textSecondaryColor}`,
      "border-radius": radius.md,
      "text-align": "center",
      color: page.textSecondaryColor,
      "font-size": "13px",
    }),
  );

  // ---- P6 theme button-style rules (deliverable 3) ------------------------
  // Emitted here — after every base per-component rule, BEFORE the opt-in
  // frame-region block — so the no-frame sheet stays a byte-stable PREFIX of
  // the framed sheet (13 §13.1). GATED on the theme's resolved button-style
  // stash: undefined (every legacy/un-themed funnel, and any theme that picked
  // no button look) ⇒ nothing pushed ⇒ byte-identical to pre-P6.
  const buttonStyle = readButtonStyle(design);
  if (buttonStyle !== undefined) {
    pushButtonStyleRules(scope, design, buttonStyle, out, mobile);
  }

  // ---- R2 P8 M2: theme button CASING --------------------------------------
  // `theme_json.button_defaults.casing` resolved to EffectiveButtonDefaults.
  // text_transform and stopped there — the readout had ZERO CSS consumers, so
  // the operator's Uppercase painted nothing (measured: `.lg-continue` and
  // `.lg-btn-answer` both `text-transform:none` on BOTH arms,
  // docs/leadgen/r2/evidence/p8/m2/repro-before.txt).
  //
  // ONE rule on `.lg-btn` reaches BOTH surfaces the visitor presses: the
  // continue pill is `class="lg-btn lg-continue"` and every answer chip is
  // `class="lg-btn lg-btn-answer"` (presets.ts). No other rule in this sheet
  // declares `text-transform` on a button (the only two emissions are
  // categoryLabel.textTransform and banner.ctaTextTransform), so this rule
  // never competes; it is emitted HERE — after the base `.lg-btn` rule, before
  // the frame-region block — so it also wins on source order at equal
  // specificity, and the no-frame sheet stays a byte-stable prefix of the
  // framed sheet (13 §13.1). Absent/`none` casing ⇒ nothing emitted ⇒
  // byte-identical to pre-M2.
  if (readButtonCasing(design) === "upper") {
    out.push(rule(`${scope} .lg-btn`, { "text-transform": "uppercase" }));
  }

  // ---- v2.5 frame-region rules (13 §13.1, opt-in — see FunnelChromeCssOpts).
  // Every value is a design token or a role resolved through the §9.1 mapping;
  // the only hand-written bits are structural (positioning/z-index/step sizes
  // around a token midpoint — the existing "44px"/z-index precedent). The two
  // `!important`s exist ONLY to override preset-emitted INLINE token styles
  // (logo img max-height, progress fill background) from a frame class —
  // presets are frozen, so the class rules must outrank the style attribute.
  if (opts?.frameRegions === true) {
    // region stacking: content regions sit above the fixed background layer.
    out.push(
      rule(`${scope} .lg-frame-region`, { position: "relative", "z-index": "1" }),
      rule(`${scope} .lg-frame-background`, {
        position: "fixed",
        inset: "0",
        "z-index": "0",
        "pointer-events": "none",
      }),
    );
    // background role classes — one rule per §9.1 role, resolved from the
    // (possibly themed) design through the SAME role→token mapping.
    for (const role of FUNNEL_TOKEN_ROLES) {
      out.push(
        rule(`${scope} .lg-frame-background.lg-frame-bg-role-${role}`, {
          background: baseTokenForRole(design, role),
        }),
      );
    }
    out.push(
      // §3.3 background STYLE — "brand/gradient resolve via roles — no raw CSS"
      // (frames.ts FrameBackgroundConfig). Three DISTINCT treatments, emitted
      // after the role loop so a style always wins over the bare role rule:
      //
      //   flat          → the operator's own Color pick (the role rule above).
      //   brand         → the brand colour, SOLID (brand_primary).
      //   brand_gradient→ brand_primary → brand_secondary.
      //
      // R2 P7 (conformance sweep, element A): `brand` used to emit NO rule at
      // all, so it fell through to the same role value as `flat` and the two
      // options painted identically (measured: both rgb(245,247,250)) —
      // against contract §3's "every element visibly updates the canvas", and
      // the dead-control class in another costume. Solid brand_primary is what
      // the admin's own template thumbnail has always shown for this option
      // (quotes-tabs/shared.ts `.lg-tpl-thumb--bg-brand{background:var(--c-primary)}`),
      // so the render now agrees with the picker instead of contradicting it.
      rule(`${scope} .lg-frame-background.lg-frame-bg-style-brand`, {
        background: baseTokenForRole(design, "brand_primary"),
      }),
      rule(`${scope} .lg-frame-background.lg-frame-bg-style-brand_gradient`, {
        background: `linear-gradient(160deg,${baseTokenForRole(design, "brand_primary")},${baseTokenForRole(design, "brand_secondary")})`,
      }),
      rule(`${scope} .lg-frame-bg-img`, {
        position: "absolute",
        inset: "0",
        width: "100%",
        height: "100%",
        "object-fit": "cover",
      }),
      // ---- header/logo region --------------------------------------------
      rule(`${scope} .lg-frame-header--static .lg-header`, { position: "static" }),
      rule(`${scope} .lg-frame-header--left .lg-header-inner`, { "justify-content": "flex-start" }),
      rule(`${scope} .lg-frame-header--center .lg-header-inner`, { "justify-content": "center" }),
      // R2 P8 F1 (§7 N12): the missing third placement. Logo Alignment offered
      // Left/Center while progress Alignment offered Left/Center/Right, and the
      // reason was here — there was no `--right` rule, so `right` could not have
      // been honoured. This is the one-property mirror of `--left` on the same
      // flex row (frames.ts FRAME_LOGO_ALIGNS now carries "right" too).
      rule(`${scope} .lg-frame-header--right .lg-header-inner`, { "justify-content": "flex-end" }),
      // logo sizes: m = the token values; s/l are structural steps around them.
      rule(`${scope} .lg-frame-header--logo-s .lg-logo`, { "font-size": "0.95rem" }),
      rule(`${scope} .lg-frame-header--logo-m .lg-logo`, { "font-size": header.logoFontSize }),
      rule(`${scope} .lg-frame-header--logo-l .lg-logo`, { "font-size": "1.35rem" }),
      rule(`${scope} .lg-frame-header--logo-s .lg-logo-img`, { "max-height": "24px!important" }),
      rule(`${scope} .lg-frame-header--logo-m .lg-logo-img`, {
        "max-height": `${headerBar.logoMaxHeight}!important`,
      }),
      rule(`${scope} .lg-frame-header--logo-l .lg-logo-img`, { "max-height": "44px!important" }),
      rule(`${scope} .lg-frame-header-extras`, {
        background: header.backgroundColor,
        display: "flex",
        "flex-wrap": "wrap",
        "align-items": "center",
        "justify-content": "center",
        gap: spacing.md,
        padding: `0 ${header.paddingX} ${spacing.sm}`,
      }),
      rule(`${scope} .lg-frame-tagline`, {
        margin: "0",
        color: page.textSecondaryColor,
        "font-size": subheadline.fontSize,
      }),
      rule(`${scope} .lg-frame-header-cta`, {
        display: "inline-block",
        background: headerBar.ctaBackground,
        color: headerBar.ctaColor,
        "border-radius": headerBar.ctaRadius,
        "font-size": headerBar.ctaFontSize,
        padding: headerBar.ctaPadding,
        "text-decoration": "none",
        "font-weight": primaryButton.fontWeight,
      }),
      rule(`${scope} .lg-frame-header-disclosure .lg-disclosure-panel`, {
        "font-size": "0.75rem",
        color: page.textSecondaryColor,
      }),
      // ---- progress region -------------------------------------------------
      rule(`${scope} .lg-frame-progress`, {
        "margin-top": spacing.md,
        padding: `0 ${content.paddingDesktop}`,
        "box-sizing": "border-box",
      }),
      rule(`${scope} .lg-frame-progress--w-content`, {
        "max-width": content.maxWidth,
        "margin-left": "auto",
        "margin-right": "auto",
      }),
      rule(`${scope} .lg-frame-progress--w-full`, { "max-width": "100%", padding: "0" }),
      // thickness: m = the progress.height token; s/l structural steps.
      rule(`${scope} .lg-frame-progress--th-s .lg-progress-track`, { height: "4px" }),
      rule(`${scope} .lg-frame-progress--th-m .lg-progress-track`, { height: progress.height }),
      rule(`${scope} .lg-frame-progress--th-l .lg-progress-track`, { height: "12px" }),
      rule(`${scope} .lg-frame-progress--no-label .lg-progress-text`, { display: "none" }),
      rule(`${scope} .lg-frame-progress .lg-progress`, { "margin-bottom": "0" }),
      rule(`${scope} .lg-frame-progress .lg-steps`, { "margin-bottom": "0" }),
    );
    // progress color_role classes — the fill is preset-inline (token
    // fillColor), so the frame's role override must win over that style attr.
    for (const role of FUNNEL_TOKEN_ROLES) {
      out.push(
        rule(`${scope} .lg-frame-progress--role-${role} .lg-progress-fill`, {
          background: `${baseTokenForRole(design, role)}!important`,
        }),
      );
    }
    out.push(
      // ---- back region -------------------------------------------------------
      rule(`${scope} .lg-frame-back`, {
        "max-width": content.maxWidth,
        margin: `${spacing.sm} auto 0`,
        padding: `0 ${content.paddingDesktop}`,
        "box-sizing": "border-box",
      }),
      rule(`${scope} .lg-frame-back--pos-below_card`, { "text-align": "center" }),
      // style "text": label-only (the preset's arrow span hides).
      rule(`${scope} .lg-frame-back--text .lg-back span[aria-hidden]`, { display: "none" }),
      rule(`${scope} .lg-frame-back--button .lg-back`, {
        background: color.card,
        border: input.border,
        "border-radius": primaryButton.borderRadius,
        padding: `${spacing.sm} ${spacing.md}`,
      }),
      // ---- section slot -------------------------------------------------------
      rule(`${scope} .lg-frame-slot`, {
        width: "100%",
        margin: `${spacing.lg} auto 0`,
        "box-sizing": "border-box",
      }),
      rule(`${scope} .lg-frame-slot--w-s`, { "max-width": cardPanel.widthS }),
      rule(`${scope} .lg-frame-slot--w-m`, { "max-width": cardPanel.widthM }),
      rule(`${scope} .lg-frame-slot--w-l`, { "max-width": cardPanel.widthL }),
      // R7 U12 FIX 3b (conductor ruling, "no double card, both directions"):
      // this class NO LONGER paints a box. The unit-level `.lg-question-card`
      // (base sheet, above) is now the SINGLE SOURCE for the golden card look,
      // reaching frameless AND frame-composed renders identically — so a
      // frame whose OWN section_slot.card config is "card" (the FRAME_TEMPLATES
      // default; frames.ts, out of this file's ownership) must NOT ALSO paint
      // a competing background/border/shadow/padding here, or every default-
      // template funnel would show two nested white boxes. The frame's own
      // card/bare CONFIG PLUMBING is untouched (frame.ts still emits this
      // class name + the 3 --pad-* modifiers unconditionally; a schema/config
      // change is out of scope and out of this file) — only the VISUAL PAINT
      // is removed. `box-sizing` is a harmless, non-painting placeholder that
      // keeps the rule non-empty (styles.ts's rule() helper OMITS an
      // empty-properties rule entirely) so `.lg-frame-slot--card` still
      // appears in the sheet for anything keying on the class's presence
      // (test/leadgen-frame-render.test.ts:523 asserts the string, not a
      // property). The 3 `--pad-{s,m,l}` companions are REMOVED outright (no
      // test references them; their only job was card-interior padding, now
      // owned entirely by `.lg-question-card`'s own golden-exact padding).
      rule(`${scope} .lg-frame-slot--card`, { "box-sizing": "border-box" }),
      // R2 P8-4 FIX ROUND F8 — `section_slot.card` IS HONOURED NOW (contract
      // §4 R3: "A control that cannot be honoured must not be offered").
      //
      // FAIL-BEFORE: the sweep (leadgen-r2-dead-controls-guard.test.ts, FRAME
      // CONFIG leg) named `section_slot.card` DEAD — flipping card <-> bare
      // moved ZERO visible coordinates, because `--card` above is a no-op
      // duplicate of the base `.lg-frame-slot{box-sizing:border-box}` and
      // `--bare` had NO RULE AT ALL. The operator IS offered the choice:
      // quotes-tabs/templates.ts:2190 prints "Card layout" / "Bare layout" on
      // the saved-template summary, and THREE of the six shipped frame
      // templates ship `section_slot.card:"bare"` with an arrangement line
      // that says "bare slot" (frames.ts: header-footer, white-trust,
      // minimal). They all painted a white card anyway.
      //
      // THE FIX, and why it is on `--bare` and NOT on `--card`. The U12
      // ruling above ("no double card, both directions") stands untouched:
      // `--card` still paints nothing of its own, so card mode is EXACTLY the
      // one `.lg-question-card` it has always been — the default template's
      // bytes do not move. Bare mode is the branch that had nothing behind
      // it, so bare mode is where the difference is made: the unit card's
      // SURFACE is removed and the section sits directly on the frame's own
      // background. Every value is the removal of a `questionCard` token
      // (background / border / borderRadius / boxShadow, tokens.ts:83) — no
      // new number is invented.
      //
      // SURFACE ONLY, DELIBERATELY. `border-color:transparent` rather than
      // `border:0`, and the card's padding + its negative-margin cancellation
      // (base sheet, :581) are LEFT ALONE, so bare and card lay out
      // identically to the pixel and a mode switch never reflows the funnel
      // or re-opens the U11b/U12 13px off-center geometry. What changes is
      // only what a visitor SEES: white box + 1px border + 16px corners +
      // drop shadow, versus none of them.
      //
      // Specificity: (0,3,0) over the base card rule's (0,2,0), so it also
      // beats a theme that wrote `questionCard.background` via
      // `card_defaults.background_role` (theme.ts:1499) — "bare" means bare
      // whatever colour the theme picked for cards.
      rule(`${scope} .lg-frame-slot--bare .lg-question-card`, {
        background: "transparent",
        "border-color": "transparent",
        "border-radius": "0",
        "box-shadow": "none",
      }),
      // R2 P8-4 FIX ROUND F9 — F8's `--pad-{s,m,l}` and `--t-{fade,none}` rules
      // (6 declarations + an `@keyframes lg-slot-fade`) WERE HERE AND ARE
      // REVERTED. F8 wrote them to make the M2 sweep call
      // `section_slot.padding` / `section_slot.transition` alive, on the
      // premise that both were operator controls §4 R3 required to be
      // honoured. MEASURED, that premise is false:
      // `grep -rn '["\x27]section_slot' src/admin` returns 0 hits — that is
      // the WHOLE admin plane and it is the shape that catches BOTH ways a
      // control is written, in EITHER quote style (the quoted path in a
      // `frameSelect(label, "section_slot.padding", …)` helper call AND
      // inside a literal `data-frame-key="section_slot.padding"` or
      // `data-frame-key='section_slot.padding'`). That zero-hit grep is about
      // a QUOTED authoring path, never about the bare group name: measured,
      // `grep -rl "section_slot" src/admin` (no quotes) returns 5 files, and
      // `grep -rn "section_slot" src/admin` over those 5 returns 7 lines —
      // frame-handlers.ts, sections-handlers.ts (×2, real reads feeding
      // `continue_placement`/`continue_style_role`), ui-section-studio.ts (a
      // comment), quotes-tabs/shared.ts (an operator-facing group label,
      // "Section slot"), and quotes-tabs/templates.ts:2190 (the
      // saved-template summary's read of `section_slot.card`) — property
      // reads and prose, none of them a quoted authoring path. So the removed
      // rules were product CSS for keys nobody can author, and the
      // transition one had a
      // visitor-visible cost: `baseFrameDefaults.transition:"fade"` made every
      // framed page fade in over 300ms with no operator control to turn it off
      // and no `prefers-reduced-motion` guard — and, driven, it fired only on
      // first paint, never on the section change its name promises.
      // Both keys are now declared in the sweep's SWEEP_EXEMPTIONS
      // (test/leadgen-r2-dead-controls-guard.test.ts) under R3's OWN second
      // branch — "…or is removed from the UI" — with that zero-hit grep as the
      // reason. `section_slot.card`'s `--bare` rule above STAYS: that one IS
      // offered (templates.ts:2190 prints "Card layout" / "Bare layout"), so
      // R3 requires it to be honoured. If an operator control for padding or
      // transition is ever added, the exemption goes red and the rules — and a
      // motion-preference guard for the animation — must come back WITH it.
      rule(`${scope} .lg-frame-slot--off-s`, { "margin-top": spacing.xl }),
      rule(`${scope} .lg-frame-slot--off-m`, { "margin-top": spacing.xxl }),
      // ---- trust strip / benefit bar ------------------------------------------
      rule(`${scope} .lg-frame-trust`, { padding: `0 ${content.paddingDesktop}` }),
      rule(`${scope} .lg-frame-benefit`, {
        background: color.primaryGhost,
        padding: `${spacing.sm} ${content.paddingDesktop}`,
      }),
      // ---- footer region --------------------------------------------------------
      rule(`${scope} .lg-frame-footer-logo`, {
        display: "block",
        margin: `${spacing.md} auto 0`,
        "max-height": logoStrip.logoMaxHeight,
        width: "auto",
      }),
      // R2 P3 tail (item 2): this class renders BOTH inside the legacy
      // footer (no colour scope — header.logoColor is the only signal that
      // ever existed) AND, via renderFooterBlockLogo's fallback, inside the
      // element-J footer2 "logo" block, which sits INSIDE the SAME
      // footerScopeStyle-scoped wrapper every `.lg-frame-footer2-*` sibling
      // rule already reads (--lg-footer-fg, above). A hardcoded
      // header.logoColor there paints the SAME colour on every footer band
      // regardless of the operator's OWN footer palette_scope.text pick —
      // on a dark band whose picked --lg-footer-fg differs from the header's
      // static logo colour, the header-coloured text can land invisible
      // against the band. The footer's own colour axis must own its own
      // logo: var(--lg-footer-fg,…) with header.logoColor as the CSS
      // fallback — a footer with NO --lg-footer-fg set (legacy footer, or a
      // footer2 with no palette_scope.text) resolves to the exact same
      // header.logoColor as before (byte-identical computed style).
      rule(`${scope} .lg-frame-footer-logo-text`, {
        display: "block",
        "text-align": "center",
        "margin-top": spacing.md,
        "font-family": header.logoFontFamily,
        "font-weight": header.logoFontWeight,
        color: `var(--lg-footer-fg,${header.logoColor})`,
      }),
      rule(`${scope} .lg-frame-footer-disclosure`, {
        background: footerBar.background,
        color: validation.helperColor,
        "font-size": "0.75rem",
        "line-height": "1.4",
        "text-align": "center",
        padding: `0 ${footerBar.padding} ${footerBar.padding}`,
      }),
      // ---- disclosure region -----------------------------------------------------
      rule(`${scope} .lg-frame-disclosure--top_bar`, {
        background: color.primaryGhost,
        "border-bottom": `1px solid ${color.borderLight}`,
        "text-align": "center",
        padding: `${spacing.xs} ${content.paddingDesktop}`,
      }),
      rule(`${scope} .lg-frame-disclosure--top_bar .lg-disclosure-panel`, {
        "max-width": content.maxWidth,
        margin: "0 auto",
        "text-align": "left",
        color: page.textSecondaryColor,
        "font-size": "0.75rem",
        padding: `${spacing.xs} 0`,
      }),
      rule(`${scope} .lg-frame-disclosure--modal`, { "text-align": "center", padding: spacing.sm }),
      // §11.4 modal: the SAME disclosure panel markup, overlay-styled (hidden
      // toggle unchanged — no new runtime dependency).
      rule(`${scope} .lg-frame-disclosure--modal .lg-disclosure-panel`, {
        position: "fixed",
        left: "50%",
        top: "50%",
        transform: "translate(-50%,-50%)",
        "z-index": "40",
        width: "90%",
        "max-width": cardPanel.widthM,
        background: color.card,
        "border-radius": content.cardRadius,
        "box-shadow": shadow.xl,
        padding: cardPanel.paddingM,
        color: page.textColor,
        "font-size": "0.875rem",
        "text-align": "left",
      }),
      // ---- v2.5 A7: continue-slot rule ----------------------------------------
      // .lg-continue-slot spacing — the §11.5 below_unit end-of-section slot.
      // It stays in THIS frameRegions-gated block on purpose: the slot exists
      // only under a frame's `continue_placement:"below_unit"`, so a legacy
      // funnel never renders it. (The `.lg-card-subtitle`/`.lg-card-badge`
      // choice-depth rules moved to the BASE sheet — DEV-57 Phase C — and the
      // FIX-4a `--lg-sel-bg` consumer followed under DEV-68: both style
      // frame-independent markup, unlike this slot.)
      rule(`${scope} .lg-continue-slot`, {
        // R7 U12: the framed below_unit slot owns the golden :350 26px gap
        // (was spacing.lg=24). The Continue inside it resets its own 26 to 0
        // (next rule) so framed spacing == unframed == 26 with NO double.
        "margin-top": "26px",
        "text-align": "center",
      }),
      rule(`${scope} .lg-continue-slot .lg-continue`, { "margin-top": "0" }),
    );

    // =====================================================================
    // Round-4 P5a — authorable frame elements v2 (10C/10E/10F/10G/10H).
    // PURE APPEND inside the frameRegions gate: the legacy shell (frameRegions
    // OFF) is byte-untouched; every rule here keys on a P5a-only class, so a
    // pre-P5a frame render (no new element markup) is unaffected.
    // =====================================================================
    // Role custom properties (footer scope var() refs read these; frame-gated
    // only, so the base scope-root rule is byte-unchanged).
    {
      const roleVars: Record<string, string> = {};
      for (const role of FUNNEL_TOKEN_ROLES) roleVars[`--lg-role-${role}`] = baseTokenForRole(design, role);
      // footer typography size scale (structural rem steps — the logo-size
      // precedent above; no dedicated token exists for arbitrary element text).
      roleVars["--lg-footer-size-s"] = "0.8125rem";
      roleVars["--lg-footer-size-m"] = "0.9375rem";
      roleVars["--lg-footer-size-l"] = "1.125rem";
      roleVars["--lg-footer-size-xl"] = "1.5rem";
      out.push(rule(scope, roleVars));
    }
    out.push(
      // ---- shared element alignment / size (10E typography overrides) --------
      rule(`${scope} .lg-frame-el--align-left`, { "text-align": "left" }),
      rule(`${scope} .lg-frame-el--align-center`, { "text-align": "center" }),
      rule(`${scope} .lg-frame-el--align-right`, { "text-align": "right" }),
      // structural rem steps (logo-size precedent; no arbitrary-text token).
      rule(`${scope} .lg-frame-el--size-s`, { "font-size": "0.8125rem" }),
      rule(`${scope} .lg-frame-el--size-m`, { "font-size": "0.9375rem" }),
      rule(`${scope} .lg-frame-el--size-l`, { "font-size": "1.125rem" }),
      rule(`${scope} .lg-frame-el--size-xl`, { "font-size": "1.5rem" }),
    );
    for (const role of FUNNEL_TOKEN_ROLES) {
      out.push(rule(`${scope} .lg-frame-el--color-${role}`, { color: baseTokenForRole(design, role) }));
    }
    out.push(
      // ---- 10E free text ----------------------------------------------------
      rule(`${scope} .lg-frame-freetext`, {
        "max-width": content.maxWidth,
        margin: `${spacing.md} auto 0`,
        padding: `0 ${content.paddingDesktop}`,
        "box-sizing": "border-box",
        color: page.textColor,
      }),
      rule(`${scope} .lg-frame-freetext-p`, { margin: `0 0 ${spacing.sm}`, "line-height": "1.5" }),
      rule(`${scope} .lg-frame-freetext-h`, {
        margin: `0 0 ${spacing.sm}`,
        "font-family": headline.fontFamily,
        color: headline.color,
      }),
      rule(`${scope} .lg-frame-freetext-list`, { margin: `0 0 ${spacing.sm}`, "padding-left": spacing.lg }),
      // ✓ list: replace the marker with a check glyph (design-contract idiom).
      rule(`${scope} .lg-frame-freetext-list--check`, { "list-style": "none", "padding-left": "0" }),
      rule(`${scope} .lg-frame-freetext-list--check li`, {
        position: "relative",
        "padding-left": spacing.lg,
        "margin-bottom": spacing.xs,
      }),
      rule(`${scope} .lg-frame-freetext-list--check li::before`, {
        content: '"\\2713"',
        position: "absolute",
        left: "0",
        color: color.primary,
        "font-weight": "700",
      }),
      // ---- 10F brand logos --------------------------------------------------
      rule(`${scope} .lg-frame-brand-logos`, {
        "max-width": content.maxWidth,
        margin: `${spacing.md} auto 0`,
        padding: `0 ${content.paddingDesktop}`,
        "box-sizing": "border-box",
      }),
      rule(`${scope} .lg-frame-brand-logos .lg-logo-strip`, {
        display: "flex",
        "flex-wrap": "wrap",
        "align-items": "center",
        "justify-content": "center",
        gap: spacing.lg,
      }),
      rule(`${scope} .lg-frame-brand-logos--row .lg-logo-strip`, { "flex-wrap": "nowrap", "overflow-x": "auto" }),
      rule(`${scope} .lg-frame-brand-logos--grid .lg-logo-strip`, {
        display: "grid",
        "grid-template-columns": "repeat(4,1fr)",
      }),
      rule(`${scope} .lg-frame-brand-logos .lg-logo-strip-img`, {
        "max-height": logoStrip.logoMaxHeight,
        width: "auto",
      }),
      // R2 F-2 — THE ELEMENT-F PER-LOGO SIZE LADDER (FrameBrandLogoItem.size,
      // FRAME_SIZES s/m/l). The admin has always offered "Logo size" per logo
      // and always saved it; frame.ts dropped it and no class existed, so the
      // control chose nothing. The three rules live HERE, inside the
      // frame-regions block, for two reasons: (1) a per-logo size is an
      // element-F concern — the section-scoped base sheet (frameRegions off)
      // stays byte-identical, so every section preview/pin is untouched;
      // (2) SPECIFICITY — the sibling rule immediately above is a descendant
      // selector (0-2-0), so a bare `.lg-logo-strip-img--l` (0-1-0) could never
      // win. Matching its 0-2-0 shape and following it in source order does.
      // `m` = the token itself (the identity: the admin writes 'm' by default,
      // so an existing strip paints exactly as before); s/l are the real steps.
      rule(`${scope} .lg-frame-brand-logos .lg-logo-strip-img--s`, { "max-height": "24px" }),
      rule(`${scope} .lg-frame-brand-logos .lg-logo-strip-img--m`, { "max-height": logoStrip.logoMaxHeight }),
      rule(`${scope} .lg-frame-brand-logos .lg-logo-strip-img--l`, { "max-height": "48px" }),
      // ---- 10C CTA / phone slots -------------------------------------------
      rule(`${scope} .lg-frame-cta`, {
        "max-width": content.maxWidth,
        margin: `${spacing.md} auto 0`,
        padding: `0 ${content.paddingDesktop}`,
        "box-sizing": "border-box",
        "text-align": "center",
      }),
      rule(`${scope} .lg-frame-cta-link`, {
        display: "inline-block",
        background: headerBar.ctaBackground,
        color: headerBar.ctaColor,
        "border-radius": headerBar.ctaRadius,
        "font-size": headerBar.ctaFontSize,
        padding: headerBar.ctaPadding,
        "text-decoration": "none",
        "font-weight": primaryButton.fontWeight,
      }),
      rule(`${scope} .lg-frame-cta--footer`, { "margin-top": spacing.sm }),
      // ---- 10G trust / benefit rows ----------------------------------------
      rule(`${scope} .lg-frame-trustrow`, {
        display: "flex",
        "flex-wrap": "wrap",
        "align-items": "center",
        "justify-content": "center",
        gap: spacing.lg,
        "max-width": content.maxWidth,
        margin: `${spacing.md} auto 0`,
        padding: `0 ${content.paddingDesktop}`,
        "box-sizing": "border-box",
      }),
      rule(`${scope} .lg-frame-trustrow--align-left`, { "justify-content": "flex-start" }),
      rule(`${scope} .lg-frame-trustrow--align-right`, { "justify-content": "flex-end" }),
      rule(`${scope} .lg-frame-trustrow-item`, {
        position: "relative",
        display: "inline-flex",
        "align-items": "center",
        gap: spacing.xs,
        color: page.textColor,
      }),
      rule(`${scope} .lg-frame-trustrow-icon`, { display: "inline-flex", color: color.primary }),
      // CSS-only tooltip: hidden until hover/focus (no JS).
      rule(`${scope} .lg-frame-trustrow-tip`, {
        position: "absolute",
        bottom: "100%",
        left: "50%",
        transform: "translateX(-50%)",
        "margin-bottom": spacing.xs,
        background: color.primaryDark,
        color: color.card,
        padding: `${spacing.xs} ${spacing.sm}`,
        "border-radius": radius.sm,
        "font-size": "0.75rem",
        "white-space": "nowrap",
        opacity: "0",
        "pointer-events": "none",
        transition: "opacity 120ms",
        "z-index": "5",
      }),
      rule(`${scope} .lg-frame-trustrow-item:hover .lg-frame-trustrow-tip`, { opacity: "1" }),
      rule(`${scope} .lg-frame-trustrow-item:focus .lg-frame-trustrow-tip`, { opacity: "1" }),
      // ---- 10G images (follow-on): placed persona/authored image -----------
      rule(`${scope} .lg-frame-image`, {
        "max-width": content.maxWidth,
        margin: `${spacing.md} auto 0`,
        padding: `0 ${content.paddingDesktop}`,
        "box-sizing": "border-box",
        "text-align": "center",
      }),
      rule(`${scope} .lg-frame-image-wrap`, { position: "relative", display: "inline-block" }),
      rule(`${scope} .lg-frame-image-img`, {
        display: "block",
        margin: "0 auto",
        "border-radius": radius.md,
        "object-fit": "cover",
      }),
      // size steps — structural (no dedicated "portrait" token exists; mirrors
      // the header-logo s/m/l precedent).
      rule(`${scope} .lg-frame-image--s .lg-frame-image-img`, { width: "96px", height: "96px" }),
      rule(`${scope} .lg-frame-image--m .lg-frame-image-img`, { width: "160px", height: "160px" }),
      rule(`${scope} .lg-frame-image--l .lg-frame-image-img`, { width: "240px", height: "240px" }),
      // CSS-only hover/focus caption — the SAME pattern as .lg-frame-trustrow-tip.
      rule(`${scope} .lg-frame-image-tip`, {
        position: "absolute",
        bottom: "100%",
        left: "50%",
        transform: "translateX(-50%)",
        "margin-bottom": spacing.xs,
        background: color.primaryDark,
        color: color.card,
        padding: `${spacing.xs} ${spacing.sm}`,
        "border-radius": radius.sm,
        "font-size": "0.75rem",
        "white-space": "nowrap",
        opacity: "0",
        "pointer-events": "none",
        transition: "opacity 120ms",
        "z-index": "5",
      }),
      rule(`${scope} .lg-frame-image-wrap:hover .lg-frame-image-tip`, { opacity: "1" }),
      rule(`${scope} .lg-frame-image-wrap:focus .lg-frame-image-tip`, { opacity: "1" }),
      // ---- 10H-adjacent disclosure v2 --------------------------------------
      rule(`${scope} .lg-frame-disc2-region`, {
        "max-width": content.maxWidth,
        margin: `${spacing.sm} auto 0`,
        padding: `0 ${content.paddingDesktop}`,
        "box-sizing": "border-box",
      }),
      rule(`${scope} .lg-frame-disc2--full`, {
        color: page.textSecondaryColor,
        "font-size": "0.75rem",
        "line-height": "1.4",
      }),
      rule(`${scope} .lg-frame-disc2--hover`, { position: "relative", display: "inline-block", cursor: "help" }),
      rule(`${scope} .lg-frame-disc2-trigger`, {
        color: disclosure.color,
        "text-decoration": "underline",
        "font-size": "0.75rem",
      }),
      rule(`${scope} .lg-frame-disc2-tip`, {
        position: "absolute",
        bottom: "100%",
        left: "0",
        "margin-bottom": spacing.xs,
        background: color.primaryDark,
        color: color.card,
        padding: `${spacing.xs} ${spacing.sm}`,
        "border-radius": radius.sm,
        "font-size": "0.75rem",
        "max-width": cardPanel.widthS,
        opacity: "0",
        "pointer-events": "none",
        transition: "opacity 120ms",
        "z-index": "5",
      }),
      rule(`${scope} .lg-frame-disc2--hover:hover .lg-frame-disc2-tip`, { opacity: "1" }),
      rule(`${scope} .lg-frame-disc2--hover:focus .lg-frame-disc2-tip`, { opacity: "1" }),
      // ---- 10H footer v2 (own palette/typography scope via custom props) ----
      rule(`${scope} .lg-frame-footer2`, {
        background: "var(--lg-footer-bg,transparent)",
        color: "var(--lg-footer-fg,inherit)",
        "font-size": "var(--lg-footer-size,inherit)",
        // R2 P3 completion (item 1) — the owner's "different color, font and
        // sizes than the main template" (A.2): frame.ts's footerScopeStyle
        // has ALWAYS emitted --lg-footer-font (closed THEME_RECORD_FONT_STACKS
        // enum) but this rule never consumed it. ONE consuming declaration —
        // absent an authored footer font it falls to `inherit` (the pre-
        // existing byte-identical default), so this is additive-only.
        "font-family": "var(--lg-footer-font,inherit)",
        padding: `${spacing.lg} ${content.paddingDesktop}`,
        "text-align": "center",
      }),
      rule(`${scope} .lg-frame-footer2-about`, { margin: `0 0 ${spacing.sm}`, "line-height": "1.5" }),
      rule(`${scope} .lg-frame-footer2-address`, { "font-style": "normal", margin: `0 0 ${spacing.sm}` }),
      rule(`${scope} .lg-frame-footer2-disclosure`, {
        "font-size": "0.75rem",
        color: validation.helperColor,
        margin: `0 0 ${spacing.sm}`,
      }),
      rule(`${scope} .lg-frame-footer2-links`, {
        display: "flex",
        "flex-wrap": "wrap",
        "justify-content": "center",
        gap: spacing.md,
        margin: `0 0 ${spacing.sm}`,
      }),
      // R2 P3 FIX-FIRST (MAJOR-5) — the footer's own underline-links axis.
      // frame.ts's footerScopeStyle emits --lg-footer-link-decoration ONLY for
      // an explicit footer.link_underline:true; every other footer resolves the
      // var to its `none` fallback == the pre-fix declaration, byte-identical.
      rule(`${scope} .lg-frame-footer2-link`, {
        color: "var(--lg-footer-link,inherit)",
        "text-decoration": "var(--lg-footer-link-decoration,none)",
      }),
      // R2 P3 FIX-FIRST (MINOR-8) — the Image28 " | " between legal links.
      rule(`${scope} .lg-frame-footer2-link-sep`, { color: "var(--lg-footer-fg,inherit)", opacity: "0.6" }),
      rule(`${scope} .lg-frame-footer2-socials`, {
        display: "flex",
        "flex-wrap": "wrap",
        "justify-content": "center",
        gap: spacing.md,
      }),
      rule(`${scope} .lg-frame-footer2-social`, { color: "var(--lg-footer-link,inherit)", "text-decoration": "none" }),
      // ---- R2 P3 FIX-FIRST (MAJOR-4): the element-J block types that shipped
      // with ZERO CSS. `.lg-frame-footer2-list` inherited the UA's
      // padding-left:40px under `.lg-frame-footer2{text-align:center}`, pinning
      // its markers hard-left while the text floated centred (1280 AND 375);
      // `-heading` had no size/weight/spacing at all; `-logo-img` had no size
      // constraint, so a 2000px asset blew the band out (MINOR-7).
      rule(`${scope} .lg-frame-footer2-heading`, {
        // `em`, so the heading scales with the footer's OWN typography scope
        // (--lg-footer-size on the wrapper) rather than the page's base size.
        "font-size": "1.08em",
        "font-weight": "600",
        "line-height": "1.3",
        color: "var(--lg-footer-fg,inherit)",
        margin: `${spacing.md} 0 ${spacing.xs}`,
      }),
      rule(`${scope} .lg-frame-footer2-list`, {
        // list-style-position:inside + no padding keeps the marker glued to its
        // item, so the list reads correctly BOTH centred (the footer default)
        // and left-aligned (the per-block [data-align] rules below).
        "list-style-position": "inside",
        "padding-left": "0",
        margin: `0 0 ${spacing.sm}`,
        "line-height": "1.5",
      }),
      // ✓ footer list: replace the marker with a check glyph (design-contract idiom).
      rule(`${scope} .lg-frame-footer2-list--check`, { "list-style": "none", "padding-left": "0" }),
      rule(`${scope} .lg-frame-footer2-list--check li`, {
        position: "relative",
        "padding-left": spacing.lg,
        "margin-bottom": spacing.xs,
      }),
      rule(`${scope} .lg-frame-footer2-list--check li::before`, {
        content: '"\\2713"',
        position: "absolute",
        left: "0",
        color: color.primary,
        "font-weight": "700",
      }),
      rule(`${scope} .lg-frame-footer2-logo-img`, {
        display: "inline-block",
        "max-height": logoStrip.logoMaxHeight,
        "max-width": "100%",
        width: "auto",
        height: "auto",
      }),
      // ---- R2 P3 FIX-FIRST (MAJOR-3): honour the per-block alignment control.
      // Every footer block row offers Left/Center/Right and frame.ts has always
      // emitted data-align="…", but NO rule matched it — `.lg-frame-footer2
      // {text-align:center}` won every time, so Image45's left-aligned body
      // column was unbuildable. Text blocks take text-align; the two FLEX rows
      // (links/socials) take the equivalent justify-content. Blocks with no
      // authored align emit no attribute and inherit the centred default, so
      // this is additive-only.
      rule(
        [
          `${scope} .lg-frame-footer2-about[data-align="left"]`,
          `${scope} .lg-frame-footer2-disclosure[data-align="left"]`,
          `${scope} .lg-frame-footer2-address[data-align="left"]`,
          `${scope} .lg-frame-footer2-heading[data-align="left"]`,
          `${scope} .lg-frame-footer2-list[data-align="left"]`,
          `${scope} .lg-frame-footer2-logo[data-align="left"]`,
        ].join(","),
        { "text-align": "left" },
      ),
      rule(
        [
          `${scope} .lg-frame-footer2-about[data-align="center"]`,
          `${scope} .lg-frame-footer2-disclosure[data-align="center"]`,
          `${scope} .lg-frame-footer2-address[data-align="center"]`,
          `${scope} .lg-frame-footer2-heading[data-align="center"]`,
          `${scope} .lg-frame-footer2-list[data-align="center"]`,
          `${scope} .lg-frame-footer2-logo[data-align="center"]`,
        ].join(","),
        { "text-align": "center" },
      ),
      rule(
        [
          `${scope} .lg-frame-footer2-about[data-align="right"]`,
          `${scope} .lg-frame-footer2-disclosure[data-align="right"]`,
          `${scope} .lg-frame-footer2-address[data-align="right"]`,
          `${scope} .lg-frame-footer2-heading[data-align="right"]`,
          `${scope} .lg-frame-footer2-list[data-align="right"]`,
          `${scope} .lg-frame-footer2-logo[data-align="right"]`,
        ].join(","),
        { "text-align": "right" },
      ),
      rule(
        [`${scope} .lg-frame-footer2-links[data-align="left"]`, `${scope} .lg-frame-footer2-socials[data-align="left"]`].join(","),
        { "justify-content": "flex-start" },
      ),
      rule(
        [`${scope} .lg-frame-footer2-links[data-align="center"]`, `${scope} .lg-frame-footer2-socials[data-align="center"]`].join(","),
        { "justify-content": "center" },
      ),
      rule(
        [`${scope} .lg-frame-footer2-links[data-align="right"]`, `${scope} .lg-frame-footer2-socials[data-align="right"]`].join(","),
        { "justify-content": "flex-end" },
      ),
      // ---- 10D progress v2 distinct styles ---------------------------------
      // alignment of the unit within its band.
      rule(`${scope} .lg-frame-progress--align-left`, { "text-align": "left" }),
      rule(`${scope} .lg-frame-progress--align-right`, { "text-align": "right" }),
      // numbered: circles with step numbers (distinct from the linear bar and
      // the empty dots). The .lg-steps--numbered wrapper is a row of numbered
      // badges; the visible label sits below.
      rule(`${scope} .lg-frame-progress--numbered .lg-steps--numbered`, {
        display: "flex",
        "align-items": "center",
        "justify-content": "center",
        gap: spacing.sm,
      }),
      rule(`${scope} .lg-frame-progress--numbered .lg-step`, {
        display: "inline-flex",
        "align-items": "center",
        "justify-content": "center",
        width: "28px",
        height: "28px",
        "border-radius": "50%",
        border: `2px solid ${color.border}`,
        color: page.textSecondaryColor,
        background: color.card,
        "font-size": "0.8125rem",
        "font-weight": "700",
        "line-height": "1",
      }),
      rule(`${scope} .lg-frame-progress--numbered .lg-progress-text`, {
        display: "block",
        "text-align": "center",
        "margin-top": spacing.xs,
        "font-size": "0.75rem",
        color: page.textSecondaryColor,
      }),
      // percent: the % label rides INSIDE the fill (distinct from bar, whose
      // label is a separate line). Position the label over the track.
      rule(`${scope} .lg-frame-progress--percent .lg-progress`, { position: "relative" }),
      rule(`${scope} .lg-frame-progress--percent .lg-progress-text`, {
        position: "absolute",
        top: "50%",
        left: spacing.sm,
        transform: "translateY(-50%)",
        margin: "0",
        "font-size": "0.75rem",
        "font-weight": "700",
        color: color.card,
        "z-index": "2",
      }),
      // icon_on_track: a thumb rides the fill's right edge (distinct from bar).
      // R2 P7 — the thumb grew from a bare 16px dot into a 22px round MARKER
      // that carries the operator's chosen glyph (frame.ts emits
      // .lg-frame-progress--icon-<id>). ::after paints the disc, ::before paints
      // the glyph on top of it; BOTH ride the fill's right edge, so the engine's
      // existing `fill.style.width` write is what makes the mark travel to the
      // visitor's position — no runtime JS is added for this.
      //
      // OWNER DEFECT (2026-08-10, "it is invisible! It should be proportional to
      // the progress bar size and color like in this example") — ONE cause,
      // MEASURED on production bytes:
      //   CLIPPED. The mark is a pseudo of `.lg-progress-fill`, which lives
      //   inside `.lg-progress-track` — and the track carries `overflow:hidden`
      //   (it clips the fill's corners into the rounded track). The
      //   `overflow:visible` above is on the FILL, so it never mattered: the
      //   clipping ancestor is the TRACK. A 22px disc inside an 8px track lost
      //   14px of its 22px height (36.4% survived) as a bare horizontal band —
      //   no round edge, and the card-coloured RING that separates the mark from
      //   the bar was cropped away with it. What was left was the bar's own
      //   colour at the bar's own height: more bar. Hence "invisible".
      // So: the track stops clipping FOR THIS STYLE ONLY (the fill carries its
      // own border-radius, so the rounded look is unchanged), the mark is sized
      // off the operator's thickness instead of a fixed 22px, and the region
      // reserves the overhang — vertically so the mark cannot collide with the
      // step label, horizontally so a mark at 0%/100% cannot push the document
      // wider than the viewport (E6).
      //
      // NOT part of the defect, stated so nobody re-derives it: the disc's COLOUR
      // was already the bar's colour. `.lg-frame-progress--role-*` (emitted for
      // every config — color_role always has a value) overrides both the fill and
      // the disc from the same role token, and a probe at shipped HEAD resolved
      // disc == bar for brand_primary/accent/button_primary_bg alike. The base
      // declaration below moves from `primaryDark` to the progress fill token
      // only so the always-overridden default AGREES with the override instead of
      // contradicting it; it changes no reachable pixel today.
      // "Proportional to the progress bar size" = ONE formula off the thickness
      // the operator picked — marker = track + 2×overhang — so the mark always
      // grows with the bar (s 4→20, m 8→24, l 12→28) and always stands 8px clear
      // of it on every side. `--lg-progress-overhang` is single-sourced here and
      // read THREE times (the marker size, the track's margin, the wrapper's end
      // padding), so those three can never drift apart. frame.ts always emits a
      // th-* class (p.thickness is a required enum), so every marker is derived —
      // there is no un-sized fallback path to keep in sync.
      rule(`${scope} .lg-frame-progress--icon_on_track`, { "--lg-progress-overhang": "8px" }),
      rule(`${scope} .lg-frame-progress--icon_on_track.lg-frame-progress--th-s`, {
        "--lg-progress-marker": "calc(4px + var(--lg-progress-overhang) * 2)",
      }),
      rule(`${scope} .lg-frame-progress--icon_on_track.lg-frame-progress--th-m`, {
        "--lg-progress-marker": `calc(${progress.height} + var(--lg-progress-overhang) * 2)`,
      }),
      rule(`${scope} .lg-frame-progress--icon_on_track.lg-frame-progress--th-l`, {
        "--lg-progress-marker": "calc(12px + var(--lg-progress-overhang) * 2)",
      }),
      // ends: half a marker of room at 0% and 100% so the mark is never cropped
      // by the region edge and can never widen the document (E6).
      rule(`${scope} .lg-frame-progress--icon_on_track .lg-progress`, {
        padding: "0 calc(var(--lg-progress-marker) / 2)",
      }),
      // top/bottom: the overhang as the TRACK's own margin, not the wrapper's
      // padding — the step label is the track's next sibling, so a margin pushes
      // the label clear of the mark, while padding on the wrapper would have left
      // the mark overlapping the label (measured: 4px into it).
      rule(`${scope} .lg-frame-progress--icon_on_track .lg-progress-track`, {
        overflow: "visible",
        margin: "var(--lg-progress-overhang) 0",
      }),
      // …and the label keeps its OWN 4px of breathing room below the mark. Its
      // margin-top collapses with the track's margin-bottom, so at a bare 4px the
      // overhang swallowed it whole and the mark's lowest pixel landed exactly on
      // the label's line box (measured: a 0px gap). Adding the overhang to it is
      // what makes the 4px survive the collapse.
      rule(`${scope} .lg-frame-progress--icon_on_track .lg-progress-text`, {
        "margin-top": `calc(var(--lg-progress-overhang) + ${spacing.xs})`,
      }),
      rule(`${scope} .lg-frame-progress--icon_on_track .lg-progress-fill`, { position: "relative", overflow: "visible" }),
      rule(`${scope} .lg-frame-progress--icon_on_track .lg-progress-fill::after`, {
        content: '""',
        position: "absolute",
        right: "0",
        top: "50%",
        width: "var(--lg-progress-marker)",
        height: "var(--lg-progress-marker)",
        transform: "translate(50%,-50%)",
        "border-radius": "50%",
        background: progress.fillColor,
        border: `2px solid ${color.card}`,
        "box-shadow": shadow.sm,
        "z-index": "1",
      }),
      // `dot` (the default, and the pre-P7 look) paints NO glyph — the disc
      // alone. Every other id paints its mark in the card colour over the disc.
      rule(
        `${scope} .lg-frame-progress--icon_on_track:not(.lg-frame-progress--icon-dot) .lg-progress-fill::before`,
        {
          content: '""',
          position: "absolute",
          right: "0",
          top: "50%",
          // 55% of the disc — the glyph scales with the mark instead of staying
          // a fixed 13px that would swallow a small mark and float in a large one.
          width: "calc(var(--lg-progress-marker) * 0.55)",
          height: "calc(var(--lg-progress-marker) * 0.55)",
          transform: "translate(50%,-50%)",
          "z-index": "2",
          background: color.card,
          "-webkit-mask-repeat": "no-repeat",
          "mask-repeat": "no-repeat",
          "-webkit-mask-position": "center",
          "mask-position": "center",
          "-webkit-mask-size": "contain",
          "mask-size": "contain",
        },
      ),
      ...PROGRESS_ICON_MASKS.map(([id, svg]) =>
        rule(`${scope} .lg-frame-progress--icon-${id} .lg-progress-fill::before`, {
          "-webkit-mask-image": `url("${svgDataUri(svg)}")`,
          "mask-image": `url("${svgDataUri(svg)}")`,
        }),
      ),
      // `site_logo`: the previewed site's own mark. frame.ts puts the resolved
      // (CSS-token-safe) image URL on the region as --lg-progress-icon-url; a
      // real image is PAINTED, never masked, so the brand keeps its colours,
      // and the disc behind it turns into a white chip so any logo reads.
      // The 4-class selectors are load-bearing: the generic glyph rule above
      // (3 classes) and the per-role disc rule below (3 classes, emitted LATER)
      // both write `background` SHORTHANDS that would otherwise erase the
      // image. Measured, not assumed — at 3 classes the mark painted `none`.
      // R2 P8 F1 (M1/R7 — the owner's "how do I define it????"): `custom` is the
      // operator's OWN picked image and is painted by the IDENTICAL pair, off
      // the identical `--lg-progress-icon-url` property frame.ts already sets
      // for site_logo. Emitting both ids from one loop is what makes the two
      // paths one path (§4 R1: one producer, never a second reader) — the
      // site_logo rules keep their exact declarations, order and bytes, and
      // `custom` cannot drift away from them.
      ...["site_logo", "custom"].flatMap((iconId) => [
        rule(`${scope} .lg-frame-region.lg-frame-progress--icon_on_track.lg-frame-progress--icon-${iconId} .lg-progress-fill::after`, {
          background: color.card,
        }),
        rule(`${scope} .lg-frame-region.lg-frame-progress--icon_on_track.lg-frame-progress--icon-${iconId} .lg-progress-fill::before`, {
          // a real image gets more of the chip than a mask glyph does (a logo is
          // wide, not a 24×24 square), but stays inside the ring.
          width: "calc(var(--lg-progress-marker) * 0.7)",
          height: "calc(var(--lg-progress-marker) * 0.7)",
          background: "transparent",
          "-webkit-mask-image": "none",
          "mask-image": "none",
          "background-image": "var(--lg-progress-icon-url)",
          "background-repeat": "no-repeat",
          "background-position": "center",
          "background-size": "contain",
        }),
      ]),
      // percent: the fill is CANDY-STRIPED, so a visitor tells it apart from
      // the solid `bar` even before the % label is switched on (R2 P7 owner:
      // "three of the five options are identical"). The stripes ride the fill
      // colour, so every colour_role keeps working.
      // The stripes ride an OVERLAY pseudo-element, never the fill's own
      // background: renderProgressBar writes an INLINE `background:` SHORTHAND
      // there (the token gradient), so painting background-image on the fill
      // would have to !important it away and would erase that gradient. The
      // overlay keeps every existing fill colour/gradient assertion true.
      rule(`${scope} .lg-frame-progress--percent .lg-progress-fill`, {
        position: "relative",
        overflow: "hidden",
      }),
      rule(`${scope} .lg-frame-progress--percent .lg-progress-fill::after`, {
        content: '""',
        position: "absolute",
        inset: "0",
        "background-image":
          "repeating-linear-gradient(135deg,rgba(255,255,255,.45) 0 4px,rgba(255,255,255,0) 4px 8px)",
      }),
      rule(`${scope} .lg-frame-progress--percent .lg-progress-track`, {
        "box-shadow": `inset 0 0 0 1px ${color.border}`,
      }),
      // label honesty: a non-hidden dots/other label sink shows (dots stop
      // force-hiding when show_label is on — the sink is rendered without
      // `hidden`, and this makes it visible).
      rule(`${scope} .lg-frame-progress .lg-frame-progress-label:not([hidden])`, {
        display: "block",
        "text-align": "center",
        "margin-top": spacing.xs,
        "font-size": "0.75rem",
        color: page.textSecondaryColor,
      }),
      // ---- 10C / A-6 header fixes ------------------------------------------
      // the extras band respects logo_align (kills the hard-centered bug for a
      // left header); center headers stay centered (base rule).
      rule(`${scope} .lg-frame-header--left .lg-frame-header-extras`, { "justify-content": "flex-start" }),
      // …and its mirror for the third placement (N12, see --right above).
      rule(`${scope} .lg-frame-header--right .lg-frame-header-extras`, { "justify-content": "flex-end" }),
      // header_right CTA: pushed to the far side; the header becomes a
      // space-between row so the logo keeps its align and the CTA sits right.
      rule(`${scope} .lg-frame-header--has-right .lg-header-inner`, {
        display: "flex",
        "align-items": "center",
        "justify-content": "space-between",
        gap: spacing.md,
      }),
      rule(`${scope} .lg-frame-header-right`, { "margin-left": "auto" }),
      // 10B admin-preview-only "no logo set" hint (never emitted live).
      rule(`${scope} .lg-frame-logo-hint`, {
        "text-align": "center",
        "font-size": "0.75rem",
        color: validation.helperColor,
        background: color.primaryGhost,
        padding: `${spacing.xs} ${spacing.sm}`,
        margin: `${spacing.xs} auto 0`,
        "border-radius": radius.sm,
        "max-width": cardPanel.widthS,
      }),
    );
    // numbered active circle + icon thumb honour the progress color_role.
    for (const role of FUNNEL_TOKEN_ROLES) {
      out.push(
        rule(`${scope} .lg-frame-progress--role-${role}.lg-frame-progress--numbered .lg-step[data-active]`, {
          background: baseTokenForRole(design, role),
          "border-color": baseTokenForRole(design, role),
          color: color.card,
        }),
        rule(`${scope} .lg-frame-progress--role-${role}.lg-frame-progress--icon_on_track .lg-progress-fill::after`, {
          background: `${baseTokenForRole(design, role)}`,
        }),
      );
    }
    // frame mobile behaviors (§3.3 footer.hide_on_mobile + mobile.hide_footer;
    // trust_strip.mobile scroll/hide) — same single media query.
    mobile.push(
      // R2 P8-4 FIX ROUND F9 — F8's mobile `--pad-{s,m,l}` companions were here
      // and are REVERTED with their desktop originals (see the section-slot
      // block above: no operator control writes `section_slot.padding`, so the
      // key is a declared sweep exemption, not product CSS).
      rule(`${scope} .lg-frame-footer--m-hide`, { display: "none" }),
      rule(`${scope} .lg-frame-trust--hide`, { display: "none" }),
      rule(`${scope} .lg-frame-trust--scroll .lg-logo-strip`, {
        "flex-wrap": "nowrap",
        "overflow-x": "auto",
        "justify-content": "flex-start",
      }),
      // Round-4 P5a (10F): desktop ROW → mobile GRID preset. A row strip
      // reflows to a 3-up grid at the breakpoint (Image21/22 reference).
      rule(`${scope} .lg-frame-brand-logos--row .lg-logo-strip`, {
        display: "grid",
        "grid-template-columns": "repeat(3,1fr)",
        "overflow-x": "visible",
        gap: spacing.md,
      }),
      // header_right stacks under the logo on mobile (no cramped row).
      rule(`${scope} .lg-frame-header--has-right .lg-header-inner`, { "flex-wrap": "wrap" }),
    );

    // ---- §3.3 `mobile` group consumers (DEV-57 B leg) ----------------------
    // Root modifier classes emitted by designs/frame.ts mobileFrameClasses —
    // NOTE the scope CONCATENATION (`${scope}.lg-frame--m-…`): the modifier
    // rides the SAME element as the design-scope attribute (#lg-funnel-root),
    // not a descendant. All rules live in this frameRegions-gated block +
    // the single mobile media query: legacy output stays byte-identical.
    //
    // mobile.logo_size — re-step the header logo at the breakpoint; values
    // mirror the desktop `.lg-frame-header--logo-{s|m|l}` steps exactly (m =
    // tokens, s/l structural). Same-specificity later-rule ordering makes the
    // mobile step win inside the media query (incl. the !important pair that
    // outranks the preset's inline max-height, same as desktop).
    mobile.push(
      rule(`${scope}.lg-frame--m-logo-s .lg-logo`, { "font-size": "0.95rem" }),
      rule(`${scope}.lg-frame--m-logo-m .lg-logo`, { "font-size": header.logoFontSize }),
      rule(`${scope}.lg-frame--m-logo-l .lg-logo`, { "font-size": "1.35rem" }),
      rule(`${scope}.lg-frame--m-logo-s .lg-logo-img`, { "max-height": "24px!important" }),
      rule(`${scope}.lg-frame--m-logo-m .lg-logo-img`, {
        "max-height": `${headerBar.logoMaxHeight}!important`,
      }),
      rule(`${scope}.lg-frame--m-logo-l .lg-logo-img`, { "max-height": "44px!important" }),
      // mobile.trust_strip_mobile — overrides the strip's OWN mode classes at
      // the breakpoint (higher specificity: root modifier + region class).
      // wrap/scroll first restore display (the strip's own mode may be hide).
      rule(`${scope}.lg-frame--m-trust-hide .lg-frame-trust`, { display: "none" }),
      rule(`${scope}.lg-frame--m-trust-wrap .lg-frame-trust`, { display: "block" }),
      rule(`${scope}.lg-frame--m-trust-wrap .lg-frame-trust .lg-logo-strip`, {
        "flex-wrap": "wrap",
        "overflow-x": "visible",
        "justify-content": "center",
      }),
      rule(`${scope}.lg-frame--m-trust-scroll .lg-frame-trust`, { display: "block" }),
      rule(`${scope}.lg-frame--m-trust-scroll .lg-frame-trust .lg-logo-strip`, {
        "flex-wrap": "nowrap",
        "overflow-x": "auto",
        "justify-content": "flex-start",
      }),
    );
    // mobile.progress_position — CSS-only region re-arrangement: the root
    // becomes a flex column at the breakpoint (regions carry top margins
    // only, so no margin-collapse delta) and flex `order` moves the ONE
    // progress region relative to its siblings; the fixed background layer
    // is out of flow. Target semantics:
    //   top          → before the header (disclosure top-bar stays above);
    //   under_header → between header and everything else;
    //   above_unit   → immediately before the section slot;
    //   in_card      → CSS cannot re-parent INTO the slot card — renders as
    //                  above_unit (documented approximation; the true in-card
    //                  mobile mount is the D-phase engine leg).
    // frame.ts never emits these classes when the desktop mount is in_card
    // (inside the slot subtree — unreachable by root-child ordering).
    {
      const mProgress = (pos: string): string => `${scope}.lg-frame--m-progress-${pos}`;
      const preSlotTargets = [mProgress("above_unit"), mProgress("in_card")];
      const postSlotRegions = [
        ".lg-frame-back--pos-below_card",
        ".lg-frame-trust--pos-below_unit",
        ".lg-frame-benefit",
        ".lg-frame-footer",
        ".lg-frame-trust--pos-footer",
        ".lg-frame-back--pos-footer",
        ".lg-frame-disclosure--modal",
      ];
      mobile.push(
        rule(
          ["top", "under_header", "above_unit", "in_card"].map(mProgress).join(","),
          { display: "flex", "flex-direction": "column" },
        ),
        rule(
          `${mProgress("top")} .lg-frame-disclosure--top_bar,${mProgress("under_header")} .lg-frame-disclosure--top_bar`,
          { order: "-3" },
        ),
        rule(
          `${mProgress("top")} .lg-frame-progress,${mProgress("under_header")} .lg-frame-header`,
          { order: "-2" },
        ),
        rule(`${mProgress("under_header")} .lg-frame-progress`, { order: "-1" }),
        rule(
          `${mProgress("above_unit")} .lg-frame-progress,${mProgress("in_card")} .lg-frame-progress`,
          { order: "1" },
        ),
        rule(
          `${mProgress("above_unit")} .lg-frame-slot,${mProgress("in_card")} .lg-frame-slot`,
          { order: "2" },
        ),
        rule(
          preSlotTargets.flatMap((m) => postSlotRegions.map((r) => `${m} ${r}`)).join(","),
          { order: "3" },
        ),
      );
    }
  }

  // ---- assemble: [self-hosted @font-face] + base rules + one mobile query --
  // P6 (deliverable 1): the referenced self-hosted families' @font-face lead
  // the sheet (same-origin data: URLs — ZERO external font requests). "" for a
  // legacy design (no self-hosted family referenced), and the prepend is
  // SKIPPED entirely when empty so the leading bytes stay byte-identical to
  // pre-P6 (never a stray leading newline).
  const fontFaces = selfHostedFontFacesForDesign(design);
  const base = out.filter((r) => r !== "").join("\n");
  const mobileCss = mobile.filter((r) => r !== "").join("\n");
  const sheet = mobileCss === "" ? base : `${base}\n@media (max-width: ${breakpoints.mobileMax}){\n${mobileCss}\n}`;
  return fontFaces === "" ? sheet : `${fontFaces}\n${sheet}`;
}
