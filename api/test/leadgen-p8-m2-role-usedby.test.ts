// R2 P8 M2 / S3.11 — every colour role's "Used by" line must be true.
//
// THE OWNER'S WORDS: "theme is only design language!!!! colors, fonts, sizes"
// (docs/leadgen/source-of-truth/SOURCE-OF-TRUTH.md). CONTRACT §4 R3 corollary:
// "A control that cannot be honoured must not be offered." A role whose own
// help text names a surface it does not paint is offering something it cannot
// honour.
//
// THE INVARIANT THIS FILE PINS (not per-role — see the SURFACES table below):
// every comma-separated phrase in shared.ts's live ROLE_META.used_by is a
// surface a real, unmodified resolveTokens/funnelChromeCss pair actually
// paints for that role. Audited ALL 14 roles (the S3.10 sibling spec,
// leadgen-p8-m2-accent-role.test.ts, already covers accent's real MARKUP+
// BANNER producer chain in depth — this file re-checks accent at the
// stylesheet level only, for this table's completeness, and does not
// duplicate that producer-side proof).
//
// FIVE ROLES CHANGED THIS SLICE (shared.ts + ui-theme-manager.ts, in
// lockstep) because their claimed surfaces were FROZEN COPIES — a component
// slot that starts at the role's own default hex but that no role applier
// ever re-writes (measured via tokens.ts literal cross-reference: the "old"
// values below are DIFFERENT literals from the role's own base token, or —
// for brand_primary's trio — happen to share the SAME default hex by
// coincidence, not by any live wiring):
//   brand_primary:      "buttons, progress fill, selected borders, logo text"
//                     -> "buttons, focus ring"
//                     -> FIX ROUND F3 (MINOR-4): "buttons, progress fill,
//                        focus ring". The review proved the S3.11 pass had
//                        narrowed this BELOW measured truth — "progress fill"
//                        was true and should not have been dropped. See the
//                        SURFACES entry for the frames.ts:645 default plus the
//                        default-funnel/styles.ts:2553-2558 role rule that
//                        paints it. "selected borders"/"logo text" stay out.
//   surface_wash:       "selected fills, quiet panels"
//                     -> "range-slider focus ring"
//   text_primary:       "headlines, labels"
//                     -> "body text, input text"
//   text_muted:         "subheadlines, helper, meta"
//                     -> "labels, disclosure text"
//   button_secondary_bg:"back button-style, quiet buttons"
//                     -> "benefit bar, disclosure bar"
// brand_secondary/accent/success/error/page_background/border/
// button_primary_bg/button_primary_text were audited and left unchanged —
// every one of their phrases already maps to a real consumer.
//
// R2 P8-3 FIX ROUND F8 (a LATER round than the S3.11 slice above; the MINOR-4
// "help text must not describe LESS than the control does" corollary,
// established for brand_primary above, applied to one more role): the
// dead-controls guard's label->target sweep carried card_background's ONE
// off-target coordinate as a written residual (input.lg-input background) —
// its token (color.card) is ALSO `.lg-input`'s resting background
// (default-funnel/styles.ts:1845), which "question card, answer cards" never
// named. Widened to "question card, answer cards, input fields" (shared.ts +
// ui-theme-manager.ts, in lockstep); the new phrase's SURFACES entry is
// below, and the residual is deleted from the guard file — it now proves the
// label covers the paint instead of exempting it.
//
// R2 P8-3 FIX ROUND F11 (review-p8-3b MINOR-3 — the two phrases F10 measured
// FALSE but could not land, because their literals were pinned in files F10 did
// not own). Both were audited here against a surface NARROWER than the word:
//   brand_primary: "buttons" -> "stepper buttons". This table's row always
//     pointed at `.lg-range-stepper-btn`; F11 re-measured with an exhaustive
//     sweep (every declaration of the REAL generated stylesheet that moves when
//     only this role is authored — 15 of them) and that stepper is the sole
//     button-shaped mover. Every button a funnel renders follows
//     button_primary_bg. Driven at review time: brand_primary #FF00AA moved the
//     progress fill to rgb(255,0,170) while the Continue button stayed
//     rgb(27,58,92).
//   border: "card/input borders" -> "answer card/input borders". The sweep
//     finds 12 movers; the unconditional component borders are `.lg-card`,
//     `.lg-btn.lg-btn-answer` and `.lg-input` — never `.lg-question-card`
//     (driven: it stayed rgb(233,237,243)). "card" alone read as the question
//     card, the surface card_background's own row in the same rail claims.
// A THIRD SURFACES row (`.lg-btn.lg-btn-answer`) was ADDED with the border
// rename, so the widened phrase is audited on every surface it names.
//
// HOW THIS FILE AVOIDS E10/E11 (a test that hand-builds BOTH sides). Neither
// side is hand-written:
//   - the PRODUCER is the REAL, unmodified resolveTokens + funnelChromeCss
//     pair (designs/theme.ts / designs/default-funnel/styles.ts) — a sentinel
//     colour is authored through the REAL palette-role input, never poked
//     into a hand-built design object;
//   - the CONSUMER is the declaration block the REAL generated stylesheet
//     text carries for the exact selector each phrase names — extracted with
//     a plain substring search (rule()/decls() emit `selector{prop:val}` with
//     no whitespace — designs/default-funnel/styles.ts:44-53), never a
//     hand-authored expectation string re-deriving the same colour a second
//     way.
// vitest's environment is "node"; jsdom/happy-dom are NOT installed
// (no-new-deps) — this is why the check works at the stylesheet-text level
// rather than a DOM cascade (leadgen-p8-m2-accent-role.test.ts's heavier
// test/helpers/leadgen-visible-paint.ts route is reserved for cases that
// genuinely need cascade/markup resolution).
//
// THE COMPLETENESS NET ("derive from source, never a hard-coded list a future
// role can slip past"): the phrase set under test is read OFF THE LIVE
// ROLE_META import, split on comma, at run time — never a separately typed
// roster of "the roles I checked". A phrase with no matching SURFACES entry
// throws inside the test itself (not a silent pass), and a role added later
// with an unaudited phrase fails the very same way.
//
// FAIL-BEFORE / PASS-AFTER (this slice's own text fix, reproduced by hand):
// reverting shared.ts's ROLE_META to the pre-S3.11 text and re-running this
// suite --
//   `npx vitest run test/leadgen-p8-m2-role-usedby.test.ts`
// throws "UNAUDITED SURFACE CLAIM" for every retired phrase (brand_primary's
// "progress fill"/"selected borders"/"logo text", surface_wash's "selected
// fills"/"quiet panels", text_primary's "headlines"/"labels", text_muted's
// "subheadlines"/"helper"/"meta", button_secondary_bg's "back
// button-style"/"quiet buttons") — the raw counts are in this slice's report.

import { describe, expect, it } from "vitest";

import { resolveTokens } from "../src/public/leadgen/designs/theme";
import type { FunnelTokenRole, ThemeJson } from "../src/public/leadgen/designs/theme";
import {
  THEME_RECORD_EXTRA_ROLE_TO_TOKEN_ROLE,
  THEME_RECORD_ROLE_TO_TOKEN_ROLE,
} from "../src/public/leadgen/designs/theme";
import { DEFAULT_FUNNEL_SCOPE, funnelChromeCss } from "../src/public/leadgen/designs/default-funnel/styles";
import { defaultFunnelDesign } from "../src/public/leadgen/designs/default-funnel/tokens";
import { renderThemesTabPanel } from "../src/admin/leadgen/quotes-tabs/themes";
import { ROLE_META } from "../src/admin/leadgen/quotes-tabs/shared";
import { EXTRA_ROLE_META as MGR_EXTRA_ROLE_META, ROLE_META as MGR_ROLE_META } from "../src/admin/leadgen/ui-theme-manager";

const BASE = defaultFunnelDesign;
const SCOPE = DEFAULT_FUNNEL_SCOPE; // [data-funnel-design="default-funnel"]
const A = "#123456";
const B = "#ee7733";

function themeFor(role: FunnelTokenRole, value: string): ThemeJson {
  const palette: Partial<Record<FunnelTokenRole, string>> = {};
  palette[role] = value;
  return { palette };
}

function cssFor(role: FunnelTokenRole, value: string): string {
  const design = resolveTokens(BASE, themeFor(role, value), null, null).design;
  return funnelChromeCss(design, SCOPE, { frameRegions: true });
}

const BASE_CSS = funnelChromeCss(BASE, SCOPE, { frameRegions: true });

// THE REAL-ARTIFACT EXTRACTOR: the declaration block belonging to `selector`
// in a stylesheet the REAL funnelChromeCss/resolveTokens pair generated.
// rule()/decls() (styles.ts:44-53) emit EXACTLY `selector{prop:val;...}` — no
// space before `{` — so a plain, non-regex substring search on
// `selector + "{"` cannot cross-match a longer selector sharing this one as a
// prefix (e.g. `.lg-btn{` vs `.lg-btn-answer{`, `.lg-input{` vs
// `.lg-input[aria-invalid="true"]{`).
function declBlock(css: string, selector: string): string {
  const openIdx = css.indexOf(`${selector}{`);
  if (openIdx === -1) {
    throw new Error(`selector not found in the REAL generated stylesheet: ${selector}{`);
  }
  const start = openIdx + selector.length + 1;
  const closeIdx = css.indexOf("}", start);
  if (closeIdx === -1) throw new Error(`unterminated rule after ${selector}`);
  return css.slice(start, closeIdx);
}

interface Surface {
  role: FunnelTokenRole;
  phrase: string; // must match (verbatim, trimmed) a comma-split phrase of the LIVE ROLE_META.used_by
  selector: string;
  property: string;
  render: (v: string) => string; // the exact `property:<this>` text for input v
}

// ---------------------------------------------------------------------------
// THE AUDIT TABLE — every phrase CURRENTLY in shared.ts's ROLE_META, each
// pointing at the real selector/property this slice (or the cited sibling
// specs, for accent/success/error) verified reads that role's resolved value.
// Selector/property/line citations are default-funnel/styles.ts at this HEAD.
// ---------------------------------------------------------------------------
const SURFACES: Surface[] = [
  // brand_primary (S3.11 fix) — :1101 rest-state stepper button, :1719 focus
  // ring shared by icon cards + answer buttons.
  // R2 P8-3 FIX ROUND F11 — the phrase is now "stepper buttons", not the bare
  // noun "buttons". The selector below never changed: this row ALWAYS pointed
  // at `.lg-range-stepper-btn`, so the old word was already wider than its own
  // audited surface. F11's exhaustive sentinel sweep (every declaration in the
  // REAL generated stylesheet that moves when only this role is authored: 15)
  // confirms `.lg-range-stepper-btn` is the sole button-shaped mover — the
  // Continue/answer buttons follow button_primary_bg. Word, meet surface.
  { role: "brand_primary", phrase: "stepper buttons", selector: `${SCOPE} .lg-range-stepper-btn`, property: "color", render: (v) => v },
  { role: "brand_primary", phrase: "focus ring", selector: `${SCOPE} .lg-card:focus-visible`, property: "outline", render: (v) => `2px solid ${v}` },
  // FIX ROUND F3 (MINOR-4) — "progress fill" RESTORED. S3.11 dropped it after
  // looking only at the token (`progress.fillColor`, default-funnel/tokens.ts:84,
  // genuinely a frozen `linear-gradient(90deg,#1B3A5C,#2A5080)` literal) and
  // missing the rule that paints the live frame: designs/frames.ts:645 gives
  // EVERY frame `progress.color_role: "brand_primary"` by default and
  // default-funnel/styles.ts:2553-2558 emits, per role,
  // `.lg-frame-progress--role-<role> .lg-progress-fill{background:<role
  // token>!important}` — the !important exists precisely to beat that frozen
  // token. So the default frame's progress fill DOES move with brand_primary,
  // and the I2 sweep below proves it on the REAL generated stylesheet. The two
  // phrases dropped alongside it ("selected borders", "logo text") stay out:
  // no such role rule exists for iconCard.selectedBorderColor or
  // header.logoColor, so nothing re-writes them.
  {
    role: "brand_primary",
    phrase: "progress fill",
    selector: `${SCOPE} .lg-frame-progress--role-brand_primary .lg-progress-fill`,
    property: "background",
    render: (v) => `${v}!important`,
  },
  // FIX ROUND F13 (review-p8-3c MINOR-4) — the three unconditional movers the
  // F11 sweep left unnamed. Same rule as F8/F11 ("the words must not describe
  // LESS than the control does"), same proof shape: each new phrase gets its
  // own row here, so I2's sentinel sweep has to show it moving A -> B in the
  // REAL generated stylesheet or the phrase cannot stand.
  { role: "brand_primary", phrase: "trust-row icons", selector: `${SCOPE} .lg-frame-trustrow-icon`, property: "color", render: (v) => v },
  // ONE phrase, TWO real surfaces: the same check glyph is emitted by the
  // free-text list (:2760) and the footer list (:3019).
  { role: "brand_primary", phrase: "list check marks", selector: `${SCOPE} .lg-frame-freetext-list--check li::before`, property: "color", render: (v) => v },
  { role: "brand_primary", phrase: "list check marks", selector: `${SCOPE} .lg-frame-footer2-list--check li::before`, property: "color", render: (v) => v },

  // brand_secondary — :2480 the operator-selectable "brand_gradient" frame
  // background style (frames.ts FRAME_BACKGROUND_STYLES, produced at
  // designs/frame.ts:664's `lg-frame-bg-style-${bg.style}` class).
  {
    role: "brand_secondary",
    phrase: "gradients",
    selector: `${SCOPE} .lg-frame-background.lg-frame-bg-style-brand_gradient`,
    property: "background",
    render: (v) => `linear-gradient(160deg,${BASE.color.primary},${v})`,
  },
  {
    role: "brand_secondary",
    phrase: "secondary emphasis",
    selector: `${SCOPE} .lg-frame-background.lg-frame-bg-style-brand_gradient`,
    property: "background",
    render: (v) => `linear-gradient(160deg,${BASE.color.primary},${v})`,
  },

  // accent — real component/banner producer chain already proven by
  // leadgen-p8-m2-accent-role.test.ts; re-checked here at the stylesheet
  // level only (:881 category label, :821 logo accent, :1925 recommended
  // banner border) so this completeness table has an entry for every live
  // phrase.
  { role: "accent", phrase: "category label", selector: `${SCOPE} .lg-category`, property: "color", render: (v) => v },
  { role: "accent", phrase: "highlights", selector: `${SCOPE} .lg-logo-accent`, property: "color", render: (v) => v },
  { role: "accent", phrase: "recommended", selector: `${SCOPE} .lg-banner[data-recommended="true"]`, property: "border", render: (v) => `2px solid ${v}` },

  // success — :1482 reassurance badge, :1514 SuccessState (applySuccessRole).
  { role: "success", phrase: "reassurance", selector: `${SCOPE} .lg-badge`, property: "border", render: (v) => `1px solid ${v}` },
  { role: "success", phrase: "valid states", selector: `${SCOPE} .lg-success`, property: "border", render: (v) => `1px solid ${v}` },

  // error — :1851 (applyErrorRole; re-pointed off data-error in S3.10).
  { role: "error", phrase: "validation errors", selector: `${SCOPE} .lg-input[aria-invalid="true"]`, property: "border-color", render: (v) => v },

  // page_background — :499 the scope root's own background-color (the ONLY
  // consumer of page.backgroundColor).
  { role: "page_background", phrase: "frame background", selector: SCOPE, property: "background-color", render: (v) => v },

  // card_background — :581 `.lg-question-card` (resolveTokens's own
  // `design.questionCard.background = roles.card_background` write) and
  // :1392 `.lg-btn.lg-btn-answer` (the answer/choice button "card"'s resting
  // background, color.card's var() fallback — UNCONDITIONAL, unlike
  // `.lg-tscard`, which only exists when button_defaults.layout === "card").
  { role: "card_background", phrase: "question card", selector: `${SCOPE} .lg-question-card`, property: "background", render: (v) => v },
  { role: "card_background", phrase: "answer cards", selector: `${SCOPE} .lg-btn.lg-btn-answer`, property: "background", render: (v) => `var(--lg-answer-bg, ${v})` },
  // R2 P8-3 FIX ROUND F8 — the residual the label->target sweep carried:
  // color.card is ALSO `.lg-input`'s UNCONDITIONAL resting background
  // (default-funnel/styles.ts:1845, direct token read, no var() wrap).
  { role: "card_background", phrase: "input fields", selector: `${SCOPE} .lg-input`, property: "background", render: (v) => v },

  // surface_wash (S3.11 fix) — :1222 the range dial's keyboard focus ring,
  // color.primaryWash's ONLY real consumer (the CardPanel/BackgroundPanel
  // "wash" option and the answer-button wash-selected fill both read
  // SEPARATE frozen tokens, not this role).
  {
    role: "surface_wash",
    phrase: "range-slider focus ring",
    selector: `${SCOPE} .lg-range-radial:focus-within .lg-range-radial-outer`,
    property: "box-shadow",
    render: (v) => `0 0 0 3px ${v}`,
  },

  // border — the LIVE phrase is the single slash-joined "answer card/input
  // borders" (no comma — phrasesOf never splits it), verified via THREE real,
  // all UNCONDITIONAL consumers: :1667 `.lg-card` (the choice/answer CARD's
  // border-color var() fallback — a `<button role="radio">` inside
  // `.lg-card-grid`, components/presets.ts:1687), the `.lg-btn.lg-btn-answer`
  // answer button's own border, and :1814 `.lg-input` (the field's).
  // R2 P8-3 FIX ROUND F11 — the phrase was "card/input borders" and the bare
  // noun "card" read as the QUESTION card, which this role does NOT paint:
  // F11's exhaustive sentinel sweep of the REAL generated stylesheet shows 12
  // declarations moving with this role and `.lg-question-card`'s border is not
  // one of them (review-p8-3b drove the same result live: it stayed
  // rgb(233,237,243) while the answer-card and input borders moved). The third
  // row below is NEW: `.lg-btn.lg-btn-answer` is the other real "answer card"
  // border the sweep found, so the widened word is audited on every surface it
  // now names rather than on a subset.
  { role: "border", phrase: "answer card/input borders", selector: `${SCOPE} .lg-card`, property: "border-color", render: (v) => `var(--lg-field-border, ${v})` },
  { role: "border", phrase: "answer card/input borders", selector: `${SCOPE} .lg-btn.lg-btn-answer`, property: "border-color", render: (v) => `var(--lg-field-border, ${v})` },
  { role: "border", phrase: "answer card/input borders", selector: `${SCOPE} .lg-input`, property: "border-color", render: (v) => `var(--lg-field-border, ${v})` },
  // FIX ROUND F13 (review-p8-3c MINOR-5) — the two unconditional progress
  // surfaces the F11 sweep left unnamed: the numbered step's ring (:3099) and
  // the percent track's inset ring (:3228). Both are plain region rules — no
  // `--role-*` opt-in — so they paint for every frame that shows that
  // progress style.
  { role: "border", phrase: "progress steps", selector: `${SCOPE} .lg-frame-progress--numbered .lg-step`, property: "border", render: (v) => `2px solid ${v}` },
  { role: "border", phrase: "progress track", selector: `${SCOPE} .lg-frame-progress--percent .lg-progress-track`, property: "box-shadow", render: (v) => `inset 0 0 0 1px ${v}` },

  // text_primary (S3.11 fix) — :499 the scope root's own cascading text
  // colour (page.textColor's DEFAULT reach — "body text") and :1814 `.lg-input`
  // (a direct, second, un-cascaded read of the SAME token).
  { role: "text_primary", phrase: "body text", selector: SCOPE, property: "color", render: (v) => v },
  { role: "text_primary", phrase: "input text", selector: `${SCOPE} .lg-input`, property: "color", render: (v) => v },

  // text_muted (S3.11 fix) — :1798 `.lg-label` (the field label) and :2913
  // `.lg-frame-disc2--full` (the disclosure fine print), both direct
  // page.textSecondaryColor reads.
  { role: "text_muted", phrase: "labels", selector: `${SCOPE} .lg-label`, property: "color", render: (v) => v },
  { role: "text_muted", phrase: "disclosure text", selector: `${SCOPE} .lg-frame-disc2--full`, property: "color", render: (v) => v },

  // button_primary_bg / button_primary_text — :1254 `.lg-btn` (btnBase; the
  // Continue/CTA + answer-button shared base rule).
  { role: "button_primary_bg", phrase: "Continue/CTA background", selector: `${SCOPE} .lg-btn`, property: "background", render: (v) => v },
  { role: "button_primary_text", phrase: "Continue/CTA text", selector: `${SCOPE} .lg-btn`, property: "color", render: (v) => v },

  // button_secondary_bg (S3.11 fix) — :2610 benefit bar, :2653 the top-bar
  // disclosure band, both direct color.primaryGhost reads (resting state,
  // frameRegions-gated).
  { role: "button_secondary_bg", phrase: "benefit bar", selector: `${SCOPE} .lg-frame-benefit`, property: "background", render: (v) => v },
  { role: "button_secondary_bg", phrase: "disclosure bar", selector: `${SCOPE} .lg-frame-disclosure--top_bar`, property: "background", render: (v) => v },
];

function phrasesOf(usedBy: string): string[] {
  return usedBy
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

// ---------------------------------------------------------------------------
// I1 — completeness: every phrase the LIVE rail actually shows the operator
// has an audited entry above. Derived from the ROLE_META import at run time —
// never a second, hand-typed roster — so an edit that reintroduces a false
// claim, or a new role with an unaudited phrase, fails HERE instead of
// silently passing.
// ---------------------------------------------------------------------------
describe("S3.11 I1 — every live 'Used by' phrase (shared.ts ROLE_META) is audited", () => {
  for (const entry of ROLE_META) {
    for (const phrase of phrasesOf(entry.used_by)) {
      it(`${entry.role}: "${phrase}" has a verified real-surface entry`, () => {
        const hit = SURFACES.find((s) => s.role === entry.role && s.phrase === phrase);
        if (hit === undefined) {
          throw new Error(
            `UNAUDITED SURFACE CLAIM: role "${entry.role}" used_by names "${phrase}" with no verified ` +
              `real-paint entry in this suite's SURFACES table — add one, or remove the claim if it cannot ` +
              `be honoured (contract §4 R3 corollary).`,
          );
        }
      });
    }
  }
});

// ---------------------------------------------------------------------------
// I2 — every audited surface really moves with its role: an A/B sentinel
// sweep through the REAL resolveTokens + funnelChromeCss pair, read back out
// of the REAL generated stylesheet text (never a hand-built one).
// ---------------------------------------------------------------------------
describe("S3.11 I2 — every audited surface paints the sentinel value it is authored with", () => {
  for (const s of SURFACES) {
    it(`${s.role} "${s.phrase}": ${s.selector} { ${s.property} } moves A -> B`, () => {
      const blockA = declBlock(cssFor(s.role, A), s.selector);
      const blockB = declBlock(cssFor(s.role, B), s.selector);
      expect(blockA).toContain(`${s.property}:${s.render(A)}`);
      expect(blockB).toContain(`${s.property}:${s.render(B)}`);
      // …and the UNAUTHORED base sheet does not already coincidentally carry
      // B's sentinel at this property (ruling out a false-positive baseline).
      const blockBase = declBlock(BASE_CSS, s.selector);
      expect(blockBase).not.toContain(`${s.property}:${s.render(B)}`);
    });
  }

  it("an unauthored theme leaves the whole stylesheet byte-identical to the raw base design", () => {
    expect(funnelChromeCss(resolveTokens(BASE, {}, null, null).design, SCOPE, { frameRegions: true })).toBe(BASE_CSS);
  });
});

// ---------------------------------------------------------------------------
// I3 — the rail (shared.ts) really renders these words: the REAL, exported,
// dependency-free render function (quotes-tabs/themes.ts renderThemesTabPanel
// -> renderThemeRailPane -> renderThemeEditorPanel), not the raw ROLE_META
// array read a second time.
// ---------------------------------------------------------------------------
describe("S3.11 I3 — the REAL rail markup renders every corrected 'Used by' line verbatim", () => {
  const html = renderThemesTabPanel(true, []);

  it("the rendered panel carries the theme-role rows at all", () => {
    expect(html).toContain('data-theme-role="brand_primary"');
    expect(html).toContain("Used by:");
  });

  for (const entry of ROLE_META) {
    it(`role "${entry.role}" renders "Used by: ${entry.used_by}" in the REAL markup`, () => {
      expect(html).toContain(`Used by: ${entry.used_by}`);
    });
  }
});

// ---------------------------------------------------------------------------
// I4 — ui-theme-manager.ts's CENTER editor must not describe a role the rail
// also describes with different words (contract-adjacent hazard note: "a
// sibling slice already had to converge their font lists for exactly this
// reason").
// ---------------------------------------------------------------------------
describe("S3.11 I4 — ui-theme-manager.ts converges with the rail for every role both files carry", () => {
  const sharedByRole = new Map(ROLE_META.map((r) => [r.role, r.used_by]));
  const norm = (s: string): string[] =>
    s
      .split(/[,·]/)
      .map((x) => x.trim().toLowerCase())
      .sort();

  for (const m of MGR_ROLE_META) {
    const tokenRole = THEME_RECORD_ROLE_TO_TOKEN_ROLE[m.key];
    it(`core role "${m.key}" (-> ${tokenRole}) reads the SAME words as the rail`, () => {
      const sharedText = sharedByRole.get(tokenRole);
      expect(sharedText, `shared.ts ROLE_META has no entry for "${tokenRole}"`).toBeDefined();
      expect(norm(m.sub)).toEqual(norm(sharedText as string));
    });
  }

  for (const m of MGR_EXTRA_ROLE_META) {
    const tokenRole = THEME_RECORD_EXTRA_ROLE_TO_TOKEN_ROLE[m.key];
    it(`extra role "${m.key}" (-> ${tokenRole}) reads the SAME words as the rail`, () => {
      const sharedText = sharedByRole.get(tokenRole);
      expect(sharedText, `shared.ts ROLE_META has no entry for "${tokenRole}"`).toBeDefined();
      expect(norm(m.sub)).toEqual(norm(sharedText as string));
    });
  }

  // ui-theme-manager.ts's separator is "·" (a middot), not "," — its own
  // splitter, mirroring phrasesOf but on the manager's real punctuation.
  const mgrPhrasesOf = (sub: string): string[] =>
    sub
      .split("·")
      .map((s) => s.trim())
      .filter((s) => s !== "");

  it("ui-theme-manager.ts's ROLE_META/EXTRA_ROLE_META phrases are ALSO in the audit table (I1's net, applied to the manager)", () => {
    const managerPhrases: Array<{ role: FunnelTokenRole; phrase: string }> = [
      ...MGR_ROLE_META.flatMap((m) => mgrPhrasesOf(m.sub).map((phrase) => ({ role: THEME_RECORD_ROLE_TO_TOKEN_ROLE[m.key], phrase }))),
      ...MGR_EXTRA_ROLE_META.flatMap((m) => mgrPhrasesOf(m.sub).map((phrase) => ({ role: THEME_RECORD_EXTRA_ROLE_TO_TOKEN_ROLE[m.key], phrase }))),
    ];
    for (const { role, phrase } of managerPhrases) {
      const hit = SURFACES.find((s) => s.role === role && s.phrase === phrase);
      expect(hit, `ui-theme-manager.ts names "${phrase}" for "${role}" with no verified SURFACES entry`).toBeDefined();
    }
  });
});
