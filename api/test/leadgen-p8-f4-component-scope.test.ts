// R2 P8 F4 (review MAJOR-1) — A COMPONENT-SCOPED CONTROL MUST NOT REPAINT THE
// WHOLE PAGE.
//
// THE DEFECT, driven on the live product by the fresh-context reviewer
// (docs/leadgen/r2/evidence/p8/review-p8-3/REVIEW.md, screenshots
// r-m2-cardbg-success-1280.png / -375.png). On /lg/r2fix with
// `palette.card_background` pinned #FFFFFF and `palette.page_background` pinned
// #F5F7FA in BOTH arms, flipping ONLY `card_defaults.background_role`
// error -> success:
//
//   element                | error         | success        | visible
//   .lg-question-card      | rgb(194,24,7) | rgb(18,165,148) | yes 420x484 — INTENDED
//   input.lg-input         | rgb(194,24,7) | rgb(18,165,148) | yes, 4/4 visible, 326x54
//   .lg-frame-background   | rgb(194,24,7) | rgb(18,165,148) | yes, 1280x900 FIXED OVERLAY
//
// A control whose operator-facing label is "Card background"
// (quotes-tabs/themes.ts, `frameControl("Card background", …)`) flooded the page
// and turned all four form fields teal-on-teal, and it silently overrode the
// operator's OWN `palette.card_background` swatch — a DIFFERENT control in the
// same rail.
//
// THE CAUSE, one line: theme.ts's card_defaults block wrote `design.color.card`,
// which is not a card slot but the BASE TOKEN OF THE `card_background` ROLE
// (ROLE_TO_BASE_TOKEN). A component control was re-pointing a global role token,
// so every consumer of the role moved with it: `.lg-input` (styles.ts),
// `.lg-frame-background.lg-frame-bg-role-card_background` (styles.ts's per-role
// frame-background rule), the `--lg-card` handle and the answer-card fill.
// Contract R3 lists this key as MIS-TARGETED and M2 requires "Every
// dead/mis-targeted key honoured or removed"; P8-3 added the correct write
// (`design.questionCard.background`) and left the wrong one, so the key was
// HALF-honoured. The fix deletes the role-token write. Nothing is added,
// removed, relabelled or gated (contract §1).
//
// WHY THIS FILE CAN FAIL FOR THE CASE THAT MATTERS (E10/E11, failure mode 5).
// The leg whose ABSENCE let this ship is the NEGATIVE one, so it is the spine of
// this file. Nothing below is hand-built on both sides:
//   • the STYLESHEET is whatever `funnelChromeCss` emits for whatever
//     `resolveTokens` resolved;
//   • the MARKUP is ONE real page — `renderSectionComponents` (the question card
//     and its input) composed by the real `renderQuoteFrame` over a real
//     `effectiveFrame`, which is what emits `.lg-frame-background`;
//   • the PREDICATE is the shared visible-paint resolver
//     (test/helpers/leadgen-visible-paint.ts — full cascade, var() substitution,
//     custom properties dropped as handles, display/visibility applied), the
//     same one the R3 guard uses. A key that moves only a `--lg-*` handle, or
//     only an element nothing renders, cannot score here.
// "The bytes changed" is never asserted: byte-change is the assertion this very
// key PASSED at HEAD, on the wrong elements.
//
// FAIL-BEFORE, measured by restoring the one deleted line
// (`design.color.card = roles[cd.background_role]`) in theme.ts's card_defaults
// block: `npx vitest run test/leadgen-p8-f4-component-scope.test.ts`
// -> 7 failed | 24 passed (31). After removing it again: 31 passed.
// The 7 that only the fix can turn green:
//   I1 NEGATIVE frame background  moved #D32F2F -> #0E7C3A (expected #FFFFFF)
//   I1 NEGATIVE text input        moved #D32F2F -> #0E7C3A (expected #FFFFFF)
//   I1 NEGATIVE palette swatch    role token card_background moved off #FFFFFF
//   I1 WHOLE PAGE                 the flip moved THREE visible coordinates —
//     "div.lg-frame-background.lg-frame-bg-role-card_background.lg-frame-bg-style-flat background",
//     "input.lg-input background", "div.lg-question-card background"
//     — i.e. the reviewer's three-row table exactly, reproduced in the pure
//     producer chain. After the fix: one coordinate, the card's own.
//   I2 component-alone / I2 both-set   the family followed the component control
//   I3 census                     card_defaults.background_role re-pointed the
//                                 card_background role token
//
// I3 — THE UNIVERSE THIS AUDIT NAMES, and why it is the whole one. The defect
// shape is "a write whose LHS is one of the 14 ROLE_TO_BASE_TOKEN paths, made by
// something other than that role's own writer". Both halves are closed by
// construction, not by hand:
//   (a) the ROLE side — FUNNEL_TOKEN_ROLES/ROLE_TO_BASE_TOKEN is
//       `satisfies Record<FunnelTokenRole, DesignStringLeafPath>`, so the set of
//       global role tokens is exactly 14 paths and cannot silently grow;
//   (b) the CONTROL side — THEME_BUTTON_DEFAULT_FIELDS /
//       THEME_CARD_DEFAULT_FIELDS are `satisfies Record<keyof Theme*Defaults,
//       DefaultsFieldKind>` (and are the SAME objects validateTheme validates
//       against), so a new component-default key is a compile error until it is
//       listed, and it then enters the census below automatically.
// The census sweeps (b) x (a) and pins the result, plus all 14 palette roles to
// catch an applier (applySuccessRole / applyErrorRole / applyAccentRole) that
// re-points a DIFFERENT role's token. Result: after this fix the whole
// `card_defaults` group re-points nothing.
//
// FOUND AND NOT FIXED HERE — REPORTED (outside this slice; pinned below as a
// KNOWN residual so it cannot drift silently): `button_defaults.background_role`
// and `button_defaults.text_role` still move the `button_primary_bg` /
// `button_primary_text` role tokens, because for those two roles
// ROLE_TO_BASE_TOKEN maps the role ONTO THE BUTTON'S OWN SLOT
// (`primaryButton.background` / `primaryButton.color`) — there is no separate
// component slot to write instead, so deleting the write would make the two
// controls dead (a worse R3 breach) rather than scoping them. The only
// third-party consumer is styles.ts's per-role frame-background rule
// (`.lg-frame-background.lg-frame-bg-role-button_primary_bg`, styles.ts ~:2455),
// which the operator can reach because renderRoleStrip offers all 14 ROLE_META
// roles for `background.role`. Separating them needs a new token slot in
// default-funnel/tokens.ts + its rules in styles.ts, or the frame-background
// rules resolving from EffectiveTokens.roles instead of the mutated design —
// both outside this slice's owned files.

import { describe, expect, it } from "vitest";

import { renderSectionComponents } from "../src/public/leadgen/components/presets";
import type { LeadgenComponentNode } from "../src/public/leadgen/components/content-schema";
import { DEFAULT_FUNNEL_SCOPE, funnelChromeCss } from "../src/public/leadgen/designs/default-funnel/styles";
import { defaultFunnelDesign } from "../src/public/leadgen/designs/default-funnel/tokens";
import { LG_BANNERS_MOUNT_HTML, renderQuoteFrame } from "../src/public/leadgen/designs/frame";
import { effectiveFrame } from "../src/public/leadgen/designs/frames";
import type { FrameConfig } from "../src/public/leadgen/designs/frames";
import {
  baseTokenForRole,
  FUNNEL_TOKEN_ROLES,
  resolveTokens,
  THEME_BUTTON_DEFAULT_FIELDS,
  THEME_CARD_DEFAULT_FIELDS,
  validateTheme,
} from "../src/public/leadgen/designs/theme";
import type { FunnelTokenRole, ThemeJson } from "../src/public/leadgen/designs/theme";
import { visibleDiff, visiblePage } from "./helpers/leadgen-visible-paint";
import type { PaintedEl } from "./helpers/leadgen-visible-paint";

const BASE = defaultFunnelDesign;
const SCOPE = DEFAULT_FUNNEL_SCOPE;

// ---------------------------------------------------------------------------
// ONE REAL PAGE. The section markup comes from the real component renderer; the
// frame (and therefore `.lg-frame-background`) from the real frame renderer over
// a real resolved frame config whose background role is `card_background` — the
// same shape a built-in template ships (frames.ts's `{ background: { role:
// "card_background" } }`), which is why the reviewer's drive flooded.
// ---------------------------------------------------------------------------

const PROBE_NODES: LeadgenComponentNode[] = [
  { type: "FreeTextQuestion", question_id: "f4_text", question_key: "f4", internal_field: "f4" },
] as unknown as LeadgenComponentNode[];

const FRAME_PATCH: FrameConfig = { background: { role: "card_background" } } as FrameConfig;

const ROOT = {
  funnelId: "lgf_000000000000000000000F401",
  funnelVariantId: "lgn_000000000000000000000F402",
  quoteId: "lgq_000000000000000000000F403",
  contentVersion: 1,
};

interface Page {
  css: string;
  html: string;
}

function page(theme: ThemeJson): Page {
  const tokens = resolveTokens(BASE, theme, null, null);
  const css = funnelChromeCss(tokens.design, SCOPE, { frameRegions: true });
  const sectionsHtml = renderSectionComponents(PROBE_NODES, tokens.design as typeof BASE, {
    headline_text: "",
    subheadline_text: null,
    theme_controls: tokens.theme_controls,
  });
  const { frame, problems } = effectiveFrame("centered", FRAME_PATCH);
  expect(problems, "the probe frame config must resolve clean").toEqual([]);
  const html = renderQuoteFrame({
    effectiveTokens: tokens,
    frame,
    siteBranding: null,
    sectionsHtml,
    bannersMountHtml: LG_BANNERS_MOUNT_HTML,
    sectionCount: 1,
    root: ROOT,
  });
  return { css, html };
}

/** The FIRST VISIBLE element carrying `className` on the real rendered page. */
function visibleEl(p: Page, className: string): PaintedEl {
  const found = visiblePage(p.css, p.html).visible.find((el) => el.classes.includes(className));
  if (found === undefined) {
    throw new Error(`no VISIBLE element with class "${className}" on the rendered page`);
  }
  return found;
}

/** Its winning computed value for `property` (undefined = the page never sets it). */
function paint(p: Page, className: string, property: string): string | undefined {
  return visibleEl(p, className).style.get(property)?.value;
}

/** Every visible coordinate that moved between two arms, labelled by element. */
function movedCoordinates(a: Page, b: Page): string[] {
  const byPath = new Map(visiblePage(a.css, a.html).visible.map((el) => [el.path, el]));
  return visibleDiff(a, b).map((coord) => {
    const [path, prop] = coord.split("|");
    const el = byPath.get(path as string);
    const label = el === undefined ? (path as string) : `${el.tag}.${el.classes.join(".")}`;
    return `${label} ${prop as string}`;
  });
}

// The reviewer's drive, reproduced in the pure producer chain: BOTH palette
// swatches pinned in BOTH arms, so the ONLY difference is the component control.
const PINNED_PALETTE = { card_background: "#FFFFFF", page_background: "#F5F7FA" } as const;

function pinned(componentRole?: FunnelTokenRole): ThemeJson {
  return {
    palette: { ...PINNED_PALETTE },
    ...(componentRole === undefined ? {} : { card_defaults: { background_role: componentRole } }),
  };
}

// ---------------------------------------------------------------------------
// 0. Ground truth — the three surfaces of the reviewer's table are all on this
//    ONE page, and all three are VISIBLE. Without this, every negative leg
//    below could be passing because nothing renders.
// ---------------------------------------------------------------------------

describe("R2 P8 F4 — ground truth: the page the reviewer drove", () => {
  const p = page(pinned());

  it("renders a visible question card, a visible text input and a visible frame background", () => {
    for (const className of ["lg-question-card", "lg-input", "lg-frame-background"]) {
      expect(() => visibleEl(p, className), `${className} is rendered and visible`).not.toThrow();
    }
    // …and the frame background really is the role-carrying overlay the drive
    // measured at 1280x900, not some other div.
    expect(visibleEl(p, "lg-frame-background").classes).toContain("lg-frame-bg-role-card_background");
    expect(visibleEl(p, "lg-frame-background").style.get("position")?.value).toBe("fixed");
    expect(visibleEl(p, "lg-input").tag).toBe("input");
    // The guard is real: a class this page does not render throws.
    expect(() => visibleEl(p, "lg-card-panel")).toThrow(/no VISIBLE element/);
  });

  it("with only the palette authored, all three surfaces carry the operator's own swatch", () => {
    expect(paint(p, "lg-question-card", "background")).toBe(PINNED_PALETTE.card_background);
    expect(paint(p, "lg-input", "background")).toBe(PINNED_PALETTE.card_background);
    expect(paint(p, "lg-frame-background", "background")).toBe(PINNED_PALETTE.card_background);
  });
});

// ---------------------------------------------------------------------------
// I1 — the component control changes its component, and NOTHING else.
// ---------------------------------------------------------------------------

describe("R2 P8 F4 I1 — 'Card background' paints the card, not the page", () => {
  const armError = page(pinned("error"));
  const armSuccess = page(pinned("success"));

  it("POSITIVE: flipping card_defaults.background_role error -> success moves the card", () => {
    expect(paint(armError, "lg-question-card", "background")).toBe(BASE.color.error);
    expect(paint(armSuccess, "lg-question-card", "background")).toBe(BASE.color.success);
  });

  it("NEGATIVE: the 1280x900 fixed frame-background overlay does NOT move", () => {
    expect(paint(armError, "lg-frame-background", "background")).toBe(PINNED_PALETTE.card_background);
    expect(paint(armSuccess, "lg-frame-background", "background")).toBe(PINNED_PALETTE.card_background);
  });

  it("NEGATIVE: the visitor's text input does NOT move (no teal-on-teal field)", () => {
    expect(paint(armError, "lg-input", "background")).toBe(PINNED_PALETTE.card_background);
    expect(paint(armSuccess, "lg-input", "background")).toBe(PINNED_PALETTE.card_background);
    // its text colour is untouched too, so the field stays readable
    expect(paint(armError, "lg-input", "color")).toBe(paint(armSuccess, "lg-input", "color"));
  });

  it("NEGATIVE: the operator's own palette.card_background swatch survives the flip", () => {
    for (const arm of ["error", "success"] as const) {
      const design = resolveTokens(BASE, pinned(arm)).design;
      expect(baseTokenForRole(design, "card_background"), `role token, ${arm} arm`).toBe(
        PINNED_PALETTE.card_background,
      );
    }
  });

  it("THE WHOLE PAGE: the exact set of visible coordinates the flip moves is the card's own", () => {
    const moved = movedCoordinates(armError, armSuccess);
    // Pinned as a SET, so a future change that leaks onto a second element fails
    // here even if every named leg above still passes.
    expect(moved).toEqual(["div.lg-question-card background"]);
  });
});

// ---------------------------------------------------------------------------
// I2 — the two controls COMPOSE, pinned in both directions.
// ---------------------------------------------------------------------------

describe("R2 P8 F4 I2 — role and component control compose; the narrower one wins the card", () => {
  it("palette alone paints the whole card_background family, card included", () => {
    const p = page({ palette: { card_background: "#123456" } });
    expect(paint(p, "lg-question-card", "background")).toBe("#123456");
    expect(paint(p, "lg-input", "background")).toBe("#123456");
    expect(paint(p, "lg-frame-background", "background")).toBe("#123456");
  });

  it("the component control alone paints ONLY the card; the family keeps the base role value", () => {
    const p = page({ card_defaults: { background_role: "error" } });
    expect(paint(p, "lg-question-card", "background")).toBe(BASE.color.error);
    expect(paint(p, "lg-input", "background")).toBe(BASE.color.card);
    expect(paint(p, "lg-frame-background", "background")).toBe(BASE.color.card);
  });

  it("BOTH set: the component control wins the card, the role keeps everything else", () => {
    const p = page(pinned("error"));
    expect(paint(p, "lg-question-card", "background")).toBe(BASE.color.error);
    expect(paint(p, "lg-question-card", "background")).not.toBe(PINNED_PALETTE.card_background);
    expect(paint(p, "lg-input", "background")).toBe(PINNED_PALETTE.card_background);
    expect(paint(p, "lg-frame-background", "background")).toBe(PINNED_PALETTE.card_background);
  });

  it("…and the reverse order is NOT a coin flip: naming the same role reproduces the palette value", () => {
    const p = page({
      palette: { card_background: "#123456" },
      card_defaults: { background_role: "card_background" },
    });
    expect(paint(p, "lg-question-card", "background")).toBe("#123456");
  });

  it("ONE RULE: the same precedence direction the sibling slice pinned for shadow", () => {
    // "the explicit component step beats the theme-wide scale" (theme.ts's
    // card_defaults shadow block) and "the explicit component control beats the
    // theme-wide role" (this slice) must read as one rule, not two opinions.
    const p = page({ scales: { shadow: "none" }, card_defaults: { shadow: "xl" } });
    expect(paint(p, "lg-question-card", "box-shadow")).toBe(BASE.shadow.xl);
  });

  it("the card_defaults READOUT reports what the card paints, in every combination", () => {
    expect(resolveTokens(BASE, {}).card_defaults.background).toBe(BASE.questionCard.background);
    expect(resolveTokens(BASE, { palette: { card_background: "#123456" } }).card_defaults.background).toBe("#123456");
    expect(resolveTokens(BASE, { card_defaults: { background_role: "error" } }).card_defaults.background).toBe(
      BASE.color.error,
    );
    expect(resolveTokens(BASE, pinned("error")).card_defaults.background).toBe(BASE.color.error);
  });
});

// ---------------------------------------------------------------------------
// I3 — the census over the closed universe (see the header note for WHY the
//      universe is whole).
// ---------------------------------------------------------------------------

type ComponentDefaultKind =
  | (typeof THEME_BUTTON_DEFAULT_FIELDS)[keyof typeof THEME_BUTTON_DEFAULT_FIELDS]
  | (typeof THEME_CARD_DEFAULT_FIELDS)[keyof typeof THEME_CARD_DEFAULT_FIELDS];

// One authorable probe value per FIELD KIND — so a new key of a known kind joins
// the census automatically, and a new KIND is a compile error here.
const KIND_PROBE = {
  role: "success",
  radius_step: "full",
  shadow_step: "xl",
  min_height: "l",
  casing: "upper",
  btn_fill: "outline",
  btn_layout: "list",
  btn_selected: "mark",
  // OWNER 2026-08-23 — the px axes. Each probe is a real, in-range value the
  // validator accepts (asserted below), deliberately DIFFERENT from the base
  // design's own value so the census measures a real move.
  px_min_height: 72,
  px_padding: 24,
  px_border_width: 3,
  px_radius: 20,
  px_gap: 28,
  px_margin: 32,
} as const satisfies Record<ComponentDefaultKind, string | number>;

function roleTokensOf(theme: ThemeJson): Record<FunnelTokenRole, string> {
  const design = resolveTokens(BASE, theme).design;
  const out = {} as Record<FunnelTokenRole, string>;
  for (const role of FUNNEL_TOKEN_ROLES) out[role] = baseTokenForRole(design, role);
  return out;
}

function rolesMovedBy(theme: ThemeJson): FunnelTokenRole[] {
  const bare = roleTokensOf({});
  const themed = roleTokensOf(theme);
  return FUNNEL_TOKEN_ROLES.filter((role) => bare[role] !== themed[role]);
}

describe("R2 P8 F4 I3 — which controls re-point a GLOBAL role token (census, pinned)", () => {
  const census: Array<[string, FunnelTokenRole[]]> = [];
  for (const [group, fields] of [
    ["card_defaults", THEME_CARD_DEFAULT_FIELDS],
    ["button_defaults", THEME_BUTTON_DEFAULT_FIELDS],
  ] as const) {
    for (const [key, kind] of Object.entries(fields)) {
      const theme = { [group]: { [key]: KIND_PROBE[kind as ComponentDefaultKind] } } as ThemeJson;
      it(`${group}.${key} is an authorable value (the probe is real, not a no-op)`, () => {
        expect(validateTheme(theme).problems.filter((p) => p.severity === "error")).toEqual([]);
      });
      census.push([`${group}.${key}`, rolesMovedBy(theme)]);
    }
  }

  it("EVERY card_defaults key re-points NOTHING — the whole group is component-scoped", () => {
    const cardRows = census.filter(([name]) => name.startsWith("card_defaults."));
    expect(cardRows.length, "every declared card_defaults key is swept").toBe(
      Object.keys(THEME_CARD_DEFAULT_FIELDS).length,
    );
    expect(Object.fromEntries(cardRows)).toEqual({
      "card_defaults.background_role": [],
      "card_defaults.border_role": [],
      "card_defaults.radius": [],
      "card_defaults.shadow": [],
      // OWNER 2026-08-23 — the four LAYOUT px axes write questionCard/cardPanel
      // slots only, so they re-point no global role either.
      "card_defaults.margin_px": [],
      "card_defaults.padding_px": [],
      "card_defaults.border_width_px": [],
      "card_defaults.radius_px": [],
    });
  });

  it("the button pair is the KNOWN residual, and nothing else in button_defaults joins it", () => {
    const buttonRows = census.filter(([name]) => name.startsWith("button_defaults."));
    expect(buttonRows.length).toBe(Object.keys(THEME_BUTTON_DEFAULT_FIELDS).length);
    // REPORTED, NOT FIXED (see the header): for these two roles
    // ROLE_TO_BASE_TOKEN maps the role onto the button's own slot, so the
    // control has no other slot to write. Pinned so the residual is explicit
    // and a THIRD offender cannot appear silently.
    expect(Object.fromEntries(buttonRows)).toEqual({
      "button_defaults.background_role": ["button_primary_bg"],
      "button_defaults.text_role": ["button_primary_text"],
      // OWNER 2026-08-23 — the five COMPONENT px axes write the button/field/
      // answer-card box slots only, so they join neither residual: measured
      // [] each, i.e. no global role re-pointed.
      "button_defaults.min_height_px": [],
      "button_defaults.padding_px": [],
      "button_defaults.border_width_px": [],
      "button_defaults.radius_px": [],
      "button_defaults.gap_px": [],
      "button_defaults.radius": [],
      "button_defaults.min_height": [],
      "button_defaults.casing": [],
      "button_defaults.fill": [],
      "button_defaults.layout": [],
      "button_defaults.selected": [],
    });
    expect(THEME_BUTTON_DEFAULT_FIELDS.background_role).toBe("role");
    expect(THEME_BUTTON_DEFAULT_FIELDS.text_role).toBe("role");
  });

  it("no palette applier re-points a DIFFERENT role's token (all 14 roles swept)", () => {
    // applySuccessRole / applyErrorRole / applyAccentRole write frozen COMPONENT
    // copies of their own role's colour. If any of them ever wrote another
    // role's base token, that role would show up here.
    for (const role of FUNNEL_TOKEN_ROLES) {
      expect(rolesMovedBy({ palette: { [role]: "#123456" } }), `palette.${role}`).toEqual([role]);
    }
    expect(FUNNEL_TOKEN_ROLES.length).toBe(14);
  });
});

// ---------------------------------------------------------------------------
// I4 — an unauthored theme renders byte-identically to the raw base design.
// ---------------------------------------------------------------------------

describe("R2 P8 F4 I4 — an untouched funnel is byte-identical", () => {
  const bare = page({});

  it("no theme / {version:1} / empty palette / empty card_defaults emit the SAME bytes", () => {
    for (const theme of [
      {},
      { version: 1 } as ThemeJson,
      { palette: {} } as ThemeJson,
      { card_defaults: {} } as ThemeJson,
    ]) {
      const p = page(theme);
      expect(p.css, "stylesheet bytes").toBe(bare.css);
      expect(p.html, "markup bytes").toBe(bare.html);
    }
  });

  it("the unauthored resolved design IS the base design, leaf for leaf", () => {
    expect(resolveTokens(BASE).design).toEqual(BASE);
    expect(resolveTokens(BASE, {}).design).toEqual(BASE);
    expect(resolveTokens(BASE, { card_defaults: {} }).design).toEqual(BASE);
  });

  it("the pre-existing role write is UNCHANGED — this fix removed a control's write, not the role's", () => {
    // `palette.card_background` must still move `color.card` (the role's own
    // token, read by `.lg-input`, the frame background and ~20 other rules).
    // Losing this would turn the fix into a re-route.
    expect(resolveTokens(BASE, { palette: { card_background: "#123456" } }).design.color.card).toBe("#123456");
    // …and the other card_defaults keys still write their pre-existing targets.
    const eff = resolveTokens(BASE, { card_defaults: { border_role: "accent", radius: "xl" } });
    expect(eff.design.cardPanel.border).toBe(`1px solid ${BASE.color.accent}`);
    expect(eff.design.content.cardRadius).toBe(BASE.radius.xl);
  });
});
