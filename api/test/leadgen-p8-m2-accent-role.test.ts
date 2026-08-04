// R2 P8 M2 / S3.10 — THE ACCENT ROLE, AND TWO RULES THAT COULD NEVER MATCH.
//
// THE OWNER'S WORDS: "theme is only design language!!!! colors, fonts, sizes"
// (docs/leadgen/source-of-truth/SOURCE-OF-TRUTH.md). CONTRACT M2/R3: "Every one
// of the 80 keys either governs a measurable painted value on a visible
// element, or is removed from the UI. A control that cannot be honoured must
// not be offered."
//
// TASK A — WHAT THE OPERATOR IS TOLD, VERBATIM, IN THE THEME RAIL:
//     Accent — Used by: category label, highlights, recommended
// (ROLE_META quotes-tabs/shared.ts:460, rendered at quotes-tabs/themes.ts:201.)
// MEASURED AT HEAD, BY HAND: `color.accent`'s only reads were the
// never-consumed `--lg-accent` custom property (styles.ts:497) and a PER-NODE
// `design_overrides.border_color:"accent"` enum (presets.ts:2382). Every one of
// the three surfaces the sentence names was an UNWIRED FROZEN "#E85D26" copy
// (`grep -n E85D26 default-funnel/tokens.ts` = 7 slots on 5 lines):
//   categoryLabel.color · header.logoAccentColor · banner.recommendedBorder
//   (+ color.recommendedBorder and banner.recommendedCtaBackground, which no
//    reachable rule reads at all — see theme.ts applyAccentRole).
// Same cause as the success / error / card_background siblings; same additive,
// authoredRoles-gated fix (theme.ts applyAccentRole).
//
// "HIGHLIGHTS" NAMES NO ELEMENT: `grep -rni highlight src/public/leadgen` = 0
// hits. The one accent-painted emphasis surface the product really renders is
// the highlighted word of the header logo (`.lg-logo-accent`), so the word is
// honoured against that. No "highlight" element was invented.
//
// TASK B — TWO RULES WHOSE STATE NOTHING PRODUCES. `.lg-tscard[data-error=
// "true"]` (styles.ts:282) and `.lg-card[data-error="true"]` (styles.ts:1720)
// could never match: NOTHING in the visitor runtime writes `data-error` (every
// hit in src/ is the unrelated admin `data-error-for` slot id). The real error
// state is runtime/render.ts:228 setFieldError — ERROR_CLASS ("lg-error") on
// the `[data-lg-field]` block + aria-invalid on its `[data-lg-input]`. Both
// rules are RE-POINTED at that state (`${scope} .lg-error .lg-tscard` /
// `${scope} .lg-error .lg-card`), not removed: the answer packs' error
// affordance is real, only its selector was not. NO `data-error` producer was
// invented, and the two byte-pinned legacy fixtures were re-minted by hand.
//
// HOW THIS FILE AVOIDS E10/E11 (a test that hand-builds BOTH sides). Nothing
// below is hand-written markup:
//   • the section markup is whatever renderSectionComponents emits;
//   • the BANNER markup is whatever the REAL auction producer renderBanners
//     emits (auction/banner.ts:303 is what writes data-recommended="true");
//   • the ERROR STATE on top of the markup is applied by REAL product code —
//     applyPreviewSimMarkup (admin/leadgen/preview-sim.ts:354), the shipped
//     producer behind the Studio's `sim:{state:"error"}` preview, whose
//     markErrorInSlice (:251) is the documented setFieldError mirror;
//   • the stylesheet is whatever funnelChromeCss emits for the real
//     resolveTokens output;
//   • the winning declaration is resolved by the SHARED cascade helper
//     (test/helpers/leadgen-visible-paint.ts — the same one the dead-controls
//     guard uses), which supports descendant combinators. vitest's environment
//     is "node"; jsdom/happy-dom are NOT installed (no-new-deps).
// The scope wrapper is the one the real product emits around the funnel root
// (serve.ts / sections-handlers.ts:2114 / quotes-handlers.ts:4445:
// `data-funnel-design="<design id>"`).
//
// WHY THE PREVIEW-SIM MIRROR AND NOT runtime/render.ts ITSELF: that module is
// DOM-lib browser code; importing it requires hand-listing this file in
// tsconfig.runtime.json + tsconfig.json, both outside this slice's owned set.
// Same choice, same note, as leadgen-p8-m2-error-role.test.ts:45.
//
// FAIL-BEFORE (theme.ts's `if (authoredRoles.has("accent")) applyAccentRole(…)`
// commented out, and BOTH styles.ts selectors reverted to `[data-error="true"]`):
//   `npx vitest run test/leadgen-p8-m2-accent-role.test.ts`
//   -> 9 failed | 8 passed (17), exit 1.
// PASS-AFTER (both restored): 17 passed (17), exit 0.
// The raw counts of both runs are in this slice's report.

import { describe, expect, it } from "vitest";

import { applyPreviewSimMarkup } from "../src/admin/leadgen/preview-sim";
import { renderBanners } from "../src/public/leadgen/auction/banner";
import type { BannerRenderCarrier, BannerRenderConfig } from "../src/public/leadgen/auction/banner";
import type { LeadgenParsedCarrier } from "../src/public/leadgen/auction/parse";
import { renderSectionComponents } from "../src/public/leadgen/components/presets";
import type { LeadgenComponentNode } from "../src/public/leadgen/components/content-schema";
import { DEFAULT_FUNNEL_SCOPE, funnelChromeCss } from "../src/public/leadgen/designs/default-funnel/styles";
import { defaultFunnelDesign } from "../src/public/leadgen/designs/default-funnel/tokens";
import { getBannerDesign } from "../src/public/leadgen/designs/registry";
import { resolveTokens } from "../src/public/leadgen/designs/theme";
import type { ThemeJson } from "../src/public/leadgen/designs/theme";
import { computedStyle, parseDom, rulesFor } from "./helpers/leadgen-visible-paint";
import type { ParsedEl, Rule } from "./helpers/leadgen-visible-paint";

const BASE = defaultFunnelDesign;
const SCOPE = DEFAULT_FUNNEL_SCOPE; // [data-funnel-design="default-funnel"]

// ERROR_CLASS's value, restated because runtime/render.ts cannot be imported
// into this typecheck program (see the header). render.ts:20 defines it;
// preview-sim.ts:255 writes the same literal.
const ERROR_CLASS = "lg-error";

// The two arms every colour leg flips between (the sibling sweep's values).
const A = "#123456";
const B = "#ee7733";

const accent = (value: string): ThemeJson => ({ palette: { accent: value } });

// ---------------------------------------------------------------------------
// The REAL producer chain.
// ---------------------------------------------------------------------------

// Ordinary authored components: a header whose site name carries an accent
// word, a category label, an icon-card grid (renders `.lg-card` inside a
// `[data-lg-field]` grid root) and a button answer group (renders `.lg-tscard`
// inside a `[data-lg-field]` group root under the card layout).
const PROBE_NODES: LeadgenComponentNode[] = [
  { type: "HeaderLogo", question_id: "s310_logo", props: { siteName: "Kodi", accent: "gital" } },
  { type: "CategoryLabel", question_id: "s310_cat", props: { text: "Step one" } },
  {
    type: "IconCardAnswerGrid",
    question_id: "s310_icon",
    question_key: "icon",
    internal_field: "icon",
    required: true,
    choices: [
      { label: "Home", value: "home", analytics_id: "home" },
      { label: "Auto", value: "auto", analytics_id: "auto" },
    ],
  },
  {
    type: "ButtonAnswerGroup",
    question_id: "s310_btn",
    question_key: "btn",
    internal_field: "btn",
    required: true,
    choices: [
      { label: "Yes", value: "y", analytics_id: "y", title: "Yes", subtitle: "sure" },
      { label: "No", value: "n", analytics_id: "n", title: "No", subtitle: "nope" },
    ],
  },
] as unknown as LeadgenComponentNode[];

// The banner side: the REAL auction render inputs (lifted from
// test/leadgen-auction-banner.test.ts, the suite that owns this producer).
const BANNER_CARRIER: LeadgenParsedCarrier = {
  carrier_key: "acme-life",
  carrier_key_source: "slug",
  carrier_name: "Acme Life",
  carrier_logo: "https://cdn.example.com/acme.png",
  headline: "Rates from $9/mo",
  subheadline: null,
  click_url: "https://p.example.com/click",
  bid: 3.2,
  bid_currency: "USD",
  tracking_id: null,
  disclaimer: null,
  pricing_model: null,
};
const BANNER_ENTRY: BannerRenderCarrier = {
  carrier: BANNER_CARRIER,
  offer_public_id: "lgo_x",
  slot: 1,
  source: "winner", // renderCard: source === "winner" ⇒ data-recommended="true"
  bid: 3.2,
};
const BANNER_CONFIG: BannerRenderConfig = {
  mode: "automatic",
  field_map_json: { carrier_name: "name", carrier_logo: "logo", headline: "headline", click_url: "cta" },
};
const BANNER_AUCTION = { auction_instance_id: "ai_1", banner_design_id: "banner-default" as string | null };

// The banners the runtime injects into the funnel frame's [data-lg-banners]
// (runtime/render.ts:285) — so the FUNNEL sheet is what paints them.
const BANNERS_HTML = renderBanners([BANNER_ENTRY], BANNER_AUCTION, BANNER_CONFIG, getBannerDesign(null), {
  mintId: () => "brid_1",
}).html;

interface Painted {
  design: typeof BASE;
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
  // rendered markup. No answers ⇒ every required question is the
  // unanswered-required case a visitor hits by pressing Continue on an empty
  // question.
  const errorHtml = applyPreviewSimMarkup(html, PROBE_NODES, design, {
    state: "error",
    markSelection: false,
    answers: {},
    visibleIds: null,
    requiredNow: null,
  });
  return { design, css, html, errorHtml };
}

// ---------------------------------------------------------------------------
// The cascade, over the REAL sheet and the REAL markup, inside the REAL scope
// wrapper. `els`/`rules` come straight from the shared helper.
// ---------------------------------------------------------------------------

interface Page {
  els: ParsedEl[];
  rules: Rule[];
}

function page(css: string, html: string): Page {
  return {
    els: parseDom(`<div data-funnel-design="default-funnel">${html}</div>`),
    rules: rulesFor(css, "desktop"),
  };
}

// THE E10 GUARD: the element must come out of the REAL markup. Nothing found ⇒
// THROW, so a declaration can never be credited to a selector nothing renders.
function pick(p: Page, label: string, pred: (el: ParsedEl) => boolean): ParsedEl {
  const hit = p.els.find(pred);
  if (hit === undefined) throw new Error(`the REAL rendered page has no ${label}`);
  return hit;
}

function byClass(p: Page, cls: string): ParsedEl {
  return pick(p, `.${cls}`, (el) => el.classes.has(cls));
}

function won(p: Page, el: ParsedEl, property: string): { value: string; selector: string } | undefined {
  return computedStyle(p.rules, el, p.els).get(property);
}

// ---------------------------------------------------------------------------
// 0. Ground truth: the probe really renders the surfaces the "Used by" line
//    names, and the producers really emit the states these legs read.
// ---------------------------------------------------------------------------

describe("R2 P8 M2 S3.10 — the probe renders the surfaces the operator's label names", () => {
  const p = page(paint({}).css, paint({}).html);

  it("category label, logo accent, and the recommended banner are all REAL rendered elements", () => {
    expect(byClass(p, "lg-category").text).toContain("Step one");
    expect(byClass(p, "lg-logo-accent").text).toBe("gital");
    const bp = page(paint({}).css, BANNERS_HTML);
    expect(byClass(bp, "lg-banner").attrs.get("data-recommended")).toBe("true");
  });

  it("the finder throws for markup the page does not render (it cannot credit an absent element)", () => {
    expect(() => byClass(p, "lg-not-a-real-class")).toThrow(/has no \.lg-not-a-real-class/);
  });
});

// ---------------------------------------------------------------------------
// I1 — an authored `accent` role paints the three surfaces its own ROLE_META
//      "Used by" line promises the operator.
// ---------------------------------------------------------------------------

describe("R2 P8 M2 S3.10 I1 — palette.accent paints 'category label, highlights, recommended'", () => {
  const colourOf = (theme: ThemeJson, cls: string): string | undefined => {
    const painted = paint(theme);
    const p = page(painted.css, painted.html);
    return won(p, byClass(p, cls), "color")?.value;
  };

  const bannerBorder = (theme: ThemeJson): string | undefined => {
    const painted = paint(theme);
    const p = page(painted.css, BANNERS_HTML);
    return won(p, byClass(p, "lg-banner"), "border")?.value;
  };

  it(`accent ${A} -> ${B} moves the CATEGORY LABEL's colour`, () => {
    expect(colourOf(accent(A), "lg-category")).toBe(A);
    expect(colourOf(accent(B), "lg-category")).toBe(B);
    // …and at base the same element still carries the base accent orange, so
    // the move above is a real departure, not a value already there.
    expect(colourOf({}, "lg-category")).toBe(BASE.categoryLabel.color);
    expect(BASE.categoryLabel.color).toBe("#E85D26");
  });

  it(`accent ${A} -> ${B} moves the HIGHLIGHTED logo word's colour`, () => {
    expect(colourOf(accent(A), "lg-logo-accent")).toBe(A);
    expect(colourOf(accent(B), "lg-logo-accent")).toBe(B);
    expect(colourOf({}, "lg-logo-accent")).toBe(BASE.header.logoAccentColor);
  });

  it(`accent ${A} -> ${B} moves the RECOMMENDED banner's border`, () => {
    expect(bannerBorder(accent(A))).toBe(`2px solid ${A}`);
    expect(bannerBorder(accent(B))).toBe(`2px solid ${B}`);
    expect(bannerBorder({})).toBe(BASE.banner.recommendedBorder);
    expect(BASE.banner.recommendedBorder).toBe("2px solid #E85D26");
    // the winner is the recommended rule, not the plain .lg-banner card rule.
    const painted = paint(accent(A));
    const p = page(painted.css, BANNERS_HTML);
    expect(won(p, byClass(p, "lg-banner"), "border")?.selector).toBe(
      `${SCOPE} .lg-banner[data-recommended="true"]`,
    );
  });

  it("NO FROZEN COPY LEFT BEHIND: every base token that IS the accent colour moves with the role", () => {
    // The cause this slice fixes is "the design froze copies of the role colour
    // into component slots". This enumerates those copies out of the REAL base
    // design (never a hand-written list) and requires the role to move ALL of
    // them — so a future frozen copy fails here instead of shipping dead.
    const frozen = (design: Record<string, unknown>, needle: string): string[] => {
      const out: string[] = [];
      for (const [g, group] of Object.entries(design)) {
        if (typeof group !== "object" || group === null) continue;
        for (const [k, v] of Object.entries(group as Record<string, unknown>)) {
          if (typeof v === "string" && (v === needle || v === `1px solid ${needle}` || v === `2px solid ${needle}`)) {
            out.push(`${g}.${k}`);
          }
        }
      }
      return out.sort();
    };

    const atBase = frozen(BASE as unknown as Record<string, unknown>, BASE.color.accent);
    expect(atBase).toEqual([
      "banner.recommendedBorder",
      "banner.recommendedCtaBackground",
      "categoryLabel.color",
      "color.accent",
      "color.recommendedBorder",
      "header.logoAccentColor",
    ]);

    const themed = paint(accent(A)).design as unknown as Record<string, unknown>;
    expect(frozen(themed, A)).toEqual(atBase);
    expect(frozen(themed, BASE.color.accent)).toEqual([]);
  });

  it("a role ALIAS value resolves the same way (accent: 'brand_primary')", () => {
    expect(colourOf({ palette: { accent: "brand_primary" } }, "lg-category")).toBe(BASE.color.primary);
  });
});

// ---------------------------------------------------------------------------
// I2 — the applier is opt-in: a theme that does not author `accent` renders
//      byte-identically to today (which is also why the frozen Playwright
//      baselines cannot move — they author no accent).
// ---------------------------------------------------------------------------

describe("R2 P8 M2 S3.10 I2 — an unauthored accent is byte-identical to the raw base design", () => {
  const bare = funnelChromeCss(BASE, SCOPE, { frameRegions: true });
  const bareHtml = renderSectionComponents(PROBE_NODES, BASE, {
    headline_text: "",
    subheadline_text: null,
  });

  it("no theme, an empty theme, and an empty palette emit the SAME stylesheet + markup bytes", () => {
    for (const theme of [{}, { version: 1 } as ThemeJson, { palette: {} } as ThemeJson]) {
      const { css, html } = paint(theme);
      expect(css).toBe(bare);
      expect(html).toBe(bareHtml);
    }
    expect(resolveTokens(BASE).design).toEqual(BASE);
    expect(resolveTokens(BASE, {}).design).toEqual(BASE);
  });

  it("the unauthored default orange is still exactly what paints all three surfaces", () => {
    expect(bare).toContain(`${SCOPE} .lg-category{`);
    expect(bare).toContain("color:#E85D26");
    expect(bare).toContain(`${SCOPE} .lg-logo-accent{color:#E85D26}`);
    expect(bare).toContain(`${SCOPE} .lg-banner[data-recommended="true"]{border:2px solid #E85D26`);
    expect(bareHtml).toContain("color:#E85D26");
  });

  it("a theme that authors OTHER palette roles leaves every accent slot at its base value", () => {
    const others: ThemeJson = { palette: { brand_primary: A, text_primary: "#111111", border: B } };
    const d = resolveTokens(BASE, others).design;
    expect(d.categoryLabel).toEqual(BASE.categoryLabel);
    expect(d.header).toEqual(BASE.header);
    expect(d.banner).toEqual(BASE.banner);
    expect(d.color.recommendedBorder).toBe(BASE.color.recommendedBorder);
  });

  it("the accent role touches ONLY its own slots (success/error/card are untouched)", () => {
    const d = resolveTokens(BASE, accent(A)).design;
    expect(d.successState).toEqual(BASE.successState);
    expect(d.input).toEqual(BASE.input);
    expect(d.validation).toEqual(BASE.validation);
    expect(d.iconCard).toEqual(BASE.iconCard);
    expect(d.questionCard).toEqual(BASE.questionCard);
    // …only the accent slots moved.
    expect({ ...d.categoryLabel, color: BASE.categoryLabel.color }).toEqual(BASE.categoryLabel);
    expect({ ...d.header, logoAccentColor: BASE.header.logoAccentColor }).toEqual(BASE.header);
    expect({
      ...d.banner,
      recommendedBorder: BASE.banner.recommendedBorder,
      recommendedCtaBackground: BASE.banner.recommendedCtaBackground,
    }).toEqual(BASE.banner);
    expect({ ...d.color, accent: BASE.color.accent, recommendedBorder: BASE.color.recommendedBorder }).toEqual(
      BASE.color,
    );
  });
});

// ---------------------------------------------------------------------------
// I3 (TASK B) — no rule in the default funnel stylesheet depends on
//      `data-error` any more, and the two re-pointed rules match the state the
//      runtime really produces.
// ---------------------------------------------------------------------------

const CARD_THEME: ThemeJson = { button_defaults: { layout: "card" } };

describe("R2 P8 M2 S3.10 I3 — the error rules now key on the state the runtime produces", () => {
  it("NO selector anywhere in the emitted stylesheet depends on data-error", () => {
    for (const theme of [{}, CARD_THEME, accent(A), { palette: { error: A } } as ThemeJson]) {
      expect(paint(theme).css).not.toContain("data-error");
    }
  });

  it("the REAL error-state markup still sets no data-error attribute (no producer was invented)", () => {
    const painted = paint(CARD_THEME);
    expect(painted.errorHtml).not.toMatch(/\sdata-error=/);
    expect(painted.html).not.toMatch(/\sdata-error=/);
    const p = page(painted.css, painted.errorHtml);
    expect(p.els.filter((el) => el.attrs.has("data-error"))).toEqual([]);
  });

  it("the state producer puts ERROR_CLASS on the [data-lg-field] root that CONTAINS the cards", () => {
    const painted = paint(CARD_THEME);
    const before = page(painted.css, painted.html);
    const after = page(painted.css, painted.errorHtml);
    const insideError = (p: Page, cls: string): boolean =>
      byClass(p, cls).ancestors.some((a) => (p.els[a] as ParsedEl).classes.has(ERROR_CLASS));
    // MEASURED, not assumed: ERROR_CLASS already exists at rest on the hidden
    // auto error MESSAGE slot (presets.ts autoErrorSlot renders
    // `.lg-error.lg-error-auto[hidden]`), so the honest fail-before shape is
    // "no card is INSIDE an ERROR_CLASS block", not "the class is absent".
    expect(before.els.some((el) => el.classes.has("lg-error-auto"))).toBe(true);
    for (const cls of ["lg-card", "lg-tscard"]) {
      expect(insideError(before, cls), `${cls} is NOT inside an ERROR_CLASS block at rest`).toBe(false);
      expect(insideError(after, cls), `${cls} sits inside the ERROR_CLASS block`).toBe(true);
    }
    expect(byClass(before, "lg-card-grid").classes.has(ERROR_CLASS)).toBe(false);
    expect(byClass(before, "lg-answer-group").classes.has(ERROR_CLASS)).toBe(false);
    expect(byClass(after, "lg-card-grid").classes.has(ERROR_CLASS)).toBe(true);
    expect(byClass(after, "lg-answer-group").classes.has(ERROR_CLASS)).toBe(true);
  });

  const cardBorder = (theme: ThemeJson, cls: string, errored: boolean): { value: string; selector: string } => {
    const painted = paint({ ...CARD_THEME, ...theme });
    const p = page(painted.css, errored ? painted.errorHtml : painted.html);
    const win = won(p, byClass(p, cls), "border-color");
    if (win === undefined) throw new Error(`no border-color won on .${cls}`);
    return win;
  };

  it("`.lg-error .lg-card` really wins on the errored icon card — and only in the error state", () => {
    const errored = cardBorder({}, "lg-card", true);
    expect(errored.selector).toBe(`${SCOPE} ${"." + ERROR_CLASS} .lg-card`);
    expect(errored.value).toBe(BASE.iconCard.errorBorderColor);
    // at rest the SAME element is not red — the rule is genuinely state-gated.
    const rest = cardBorder({}, "lg-card", false);
    expect(rest.value).not.toBe(BASE.iconCard.errorBorderColor);
    expect(rest.selector).not.toContain(ERROR_CLASS);
  });

  it("`.lg-error .lg-tscard` really wins on the errored answer chip — and only in the error state", () => {
    const errored = cardBorder({}, "lg-tscard", true);
    expect(errored.selector).toBe(`${SCOPE} ${"." + ERROR_CLASS} .lg-tscard`);
    expect(errored.value).toBe(BASE.color.error);
    const rest = cardBorder({}, "lg-tscard", false);
    expect(rest.value).not.toBe(BASE.color.error);
    expect(rest.selector).not.toContain(ERROR_CLASS);
  });

  it("the re-pointed rules carry the AUTHORED error colour (they are wired to the role, not frozen)", () => {
    expect(cardBorder({ palette: { error: A } }, "lg-card", true).value).toBe(A);
    expect(cardBorder({ palette: { error: B } }, "lg-card", true).value).toBe(B);
    expect(cardBorder({ palette: { error: A } }, "lg-tscard", true).value).toBe(A);
    expect(cardBorder({ palette: { error: B } }, "lg-tscard", true).value).toBe(B);
  });
});
