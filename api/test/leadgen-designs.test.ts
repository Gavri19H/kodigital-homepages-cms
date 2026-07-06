// LeadGen Phase 5 STAGE A — visual design registry + tokens→scoped chrome CSS
// (contract 05 §14.1/§14.2/§14.3/§14.10). Proves: the funnel/banner design
// resolvers fall back to the default exactly like Listicles `getLayout`; the
// generated chrome stylesheet is fully SCOPED (never leaks), represents EVERY
// §14.2 token group, and carries the MEASURED reference values EXACTLY (the
// string-level half of the §14.10 computed-style contract Stage C proves in a
// real browser).

import { describe, expect, it } from "vitest";
import {
  getFunnelDesign,
  getBannerDesign,
  FUNNEL_DESIGNS,
  BANNER_DESIGNS,
} from "../src/public/leadgen/designs/registry";
import { defaultFunnelDesign } from "../src/public/leadgen/designs/default-funnel/tokens";
import {
  funnelChromeCss,
  DEFAULT_FUNNEL_SCOPE,
} from "../src/public/leadgen/designs/default-funnel/styles";

const SCOPE = DEFAULT_FUNNEL_SCOPE;

// ---------------------------------------------------------------------------
// registry — getFunnelDesign / getBannerDesign fallback (§14.1)
// ---------------------------------------------------------------------------

describe("getFunnelDesign — unknown/absent id → default (Listicles getLayout rule)", () => {
  it("absent id → the default funnel design", () => {
    expect(getFunnelDesign()).toBe(defaultFunnelDesign);
  });

  it("null / empty id → the default funnel design", () => {
    expect(getFunnelDesign(null)).toBe(defaultFunnelDesign);
    expect(getFunnelDesign("")).toBe(defaultFunnelDesign);
  });

  it("the `default` key resolves to the default funnel design", () => {
    expect(getFunnelDesign("default")).toBe(defaultFunnelDesign);
    expect(FUNNEL_DESIGNS["default"]).toBe(defaultFunnelDesign);
  });

  it("the canonical id `default-funnel` resolves directly (not via fallback)", () => {
    expect(getFunnelDesign("default-funnel")).toBe(defaultFunnelDesign);
    expect(defaultFunnelDesign.id).toBe("default-funnel");
  });

  it("an unknown id falls back to the default", () => {
    expect(getFunnelDesign("green-blue-skin-that-does-not-exist")).toBe(defaultFunnelDesign);
  });
});

describe("getBannerDesign — banner sub-design + fallback (§20)", () => {
  it("absent/unknown id → the default banner sub-design (the tokens.banner group)", () => {
    expect(getBannerDesign()).toBe(defaultFunnelDesign.banner);
    expect(getBannerDesign("nope")).toBe(defaultFunnelDesign.banner);
    expect(getBannerDesign("default-funnel")).toBe(defaultFunnelDesign.banner);
    expect(BANNER_DESIGNS["default"]).toBe(defaultFunnelDesign.banner);
  });

  it("exposes the measured banner card tokens", () => {
    const banner = getBannerDesign();
    expect(banner.cardRadius).toBe("20px");
    expect(banner.ctaBackground).toBe("#1B3A5C"); // navy CTA, not blue
    expect(banner.recommendedBorder).toContain("#E85D26"); // accent orange
  });
});

// ---------------------------------------------------------------------------
// styles.ts — scoping + no-leak + every §14.2 group present
// ---------------------------------------------------------------------------

// Extract every style-rule selector (the text preceding each `{`), skipping
// at-rule openers (@media/@keyframes) — after stripping @keyframes blocks so a
// keyframe step (`to`/`from`) is never mistaken for a leaking selector.
function ruleSelectors(css: string): string[] {
  const withoutKeyframes = css.replace(
    /@keyframes[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g,
    "",
  );
  const selectors: string[] = [];
  for (const match of withoutKeyframes.matchAll(/([^{}]+)\{/g)) {
    const sel = (match[1] ?? "").trim();
    if (sel === "") continue;
    if (sel.startsWith("@")) continue; // at-rule opener (media)
    selectors.push(sel);
  }
  return selectors;
}

describe("funnelChromeCss — fully scoped, no leak (§14.3/§14.10)", () => {
  const css = funnelChromeCss(defaultFunnelDesign);

  it("produces a non-trivial stylesheet", () => {
    expect(css.length).toBeGreaterThan(1000);
  });

  it("EVERY style-rule selector is nested under the funnel design scope (no leak)", () => {
    const selectors = ruleSelectors(css);
    expect(selectors.length).toBeGreaterThan(20);
    const leaks = selectors.filter((s) => !s.includes(SCOPE));
    expect(leaks).toEqual([]);
  });

  it("emits no document-global reset and no unscoped element rules", () => {
    // no `html,body{…}` global (Listicles emits one; funnel chrome must not).
    expect(css).not.toMatch(/(^|\n)html\s*,\s*body\s*\{/);
    // the only bare selector allowed is inside the scoped rules themselves.
    expect(css).not.toMatch(/(^|\n)body\s*\{/);
  });
});

describe("funnelChromeCss — every §14.2 token group is represented", () => {
  const css = funnelChromeCss(defaultFunnelDesign);

  // group → a signature that MUST appear in the sheet (a class selector or a
  // token value unique-enough to that group).
  const signatures: Array<[string, string]> = [
    ["page", defaultFunnelDesign.page.backgroundColor], // #F5F7FA
    ["color", "--lg-primary:"],
    ["spacing", "--lg-space-md:"],
    ["radius", "--lg-radius-full:"],
    ["shadow", "--lg-shadow-sm:"],
    ["header", ".lg-header{"],
    ["backButton", ".lg-back{"],
    ["disclosure", ".lg-disclosure{"],
    ["content", ".lg-content{"],
    ["progress", ".lg-progress-fill{"],
    ["headline", ".lg-headline{"],
    ["subheadline", ".lg-subheadline{"],
    ["categoryLabel", ".lg-category{"],
    ["rangeQuestion", ".lg-range-fill{"],
    ["primaryButton", ".lg-btn{"],
    ["reassuranceBadge", ".lg-badge{"],
    ["iconCardGrid", ".lg-card-grid{"],
    ["iconCard", ".lg-card{"],
    ["input", ".lg-input{"],
    ["dropdown", ".lg-dropdown{"],
    ["validation", ".lg-error{"],
    ["transitions", "--lg-transition-btn:"],
    ["breakpoints", "--lg-bp-mobile-max:"],
    ["banner", ".lg-banner{"],
  ];

  for (const [group, sig] of signatures) {
    it(`§14.2 group '${group}' present (${sig})`, () => {
      expect(css).toContain(sig);
    });
  }

  it("carries a mobile media query for the responsive groups (§14.2 breakpoints)", () => {
    expect(css).toContain(`@media (max-width: ${defaultFunnelDesign.breakpoints.mobileMax})`);
  });

  it("emits the icon-card interaction states (§14.4 selected/hover/disabled/error/focus)", () => {
    expect(css).toContain(".lg-card:hover");
    expect(css).toContain('.lg-card[aria-checked="true"]');
    expect(css).toContain('.lg-card[data-error="true"]');
    expect(css).toContain(".lg-card:focus-visible");
    expect(css).toContain('.lg-card[aria-disabled="true"]');
  });

  it("emits the continue-button loading/spinner states (§14.6)", () => {
    expect(css).toContain('.lg-btn[data-loading="true"] .lg-btn-spinner');
    expect(css).toContain("@keyframes lg-spin");
  });
});

// ---------------------------------------------------------------------------
// token fidelity — the shipped tokens + emitted CSS carry the MEASURED
// reference values EXACTLY. Reference literals are pinned from
// docs/leadgen/contract/docs/reference-design-desktop.json (§14.10) — the JSON
// lives outside the api rootDir, so the measured values it records are pinned
// here as constants with citations (the same discipline as measured-values.ts).
// ---------------------------------------------------------------------------

describe("token fidelity — measured reference values (§14.10 computed-style contract)", () => {
  const css = funnelChromeCss(defaultFunnelDesign);

  // reference-design-desktop.json measured literals ↔ tokens.ts ↔ emitted CSS.
  it("header background = #FFFFFF (reference header.backgroundColor)", () => {
    expect(defaultFunnelDesign.header.backgroundColor).toBe("#FFFFFF");
    expect(css).toContain(".lg-header{background-color:#FFFFFF");
  });

  it("progress fill = navy gradient (reference progress.fillColor)", () => {
    const grad = "linear-gradient(90deg,#1B3A5C,#2A5080)";
    expect(defaultFunnelDesign.progress.fillColor).toBe(grad);
    expect(css).toContain(grad);
  });

  it("primary/continue button = navy #1B3A5C, NOT blue #2a6fdb (reference primaryButton.background + §14.6)", () => {
    expect(defaultFunnelDesign.primaryButton.background).toBe("#1B3A5C");
    expect(css).toContain("background:#1B3A5C");
    // the discarded screenshot-exploration blue must NOT appear anywhere.
    expect(css.toLowerCase()).not.toContain("#2a6fdb");
    // nor the discarded green skin.
    expect(css.toLowerCase()).not.toContain("#1f9d57");
  });

  it("icon card border = 2px solid #D2D9E5 (reference iconCard.border)", () => {
    expect(defaultFunnelDesign.iconCard.border).toBe("2px solid #D2D9E5");
    expect(css).toContain("border:2px solid #D2D9E5");
  });

  it("input border = 2px solid #D2D9E5 (reference input.border)", () => {
    expect(defaultFunnelDesign.input.border).toBe("2px solid #D2D9E5");
    expect(css).toContain(".lg-input{");
  });

  it("headline family = Literata serif (reference headline.fontFamily)", () => {
    expect(defaultFunnelDesign.headline.fontFamily).toContain("Literata");
    expect(css).toContain("Literata");
  });

  it("range filled track = navy #1B3A5C, remaining #E8EEF4 (reference range)", () => {
    expect(defaultFunnelDesign.rangeQuestion.filledTrackColor).toBe("#1B3A5C");
    expect(defaultFunnelDesign.rangeQuestion.unfilledTrackColor).toBe("#E8EEF4");
    expect(css).toContain(".lg-range-fill{");
  });

  it("reassurance badge = success-green #0E7C3A outline + pale #F2F6FA bg (§14.7)", () => {
    expect(defaultFunnelDesign.reassuranceBadge.border).toContain("#0E7C3A");
    expect(defaultFunnelDesign.reassuranceBadge.background).toBe("#F2F6FA");
    expect(css).toContain("#0E7C3A");
    expect(css).toContain("#F2F6FA");
  });

  it("a different scope argument rescopes every rule", () => {
    const scoped = funnelChromeCss(defaultFunnelDesign, '[data-funnel-design="other"]');
    expect(scoped).toContain('[data-funnel-design="other"] .lg-header{');
    expect(ruleSelectors(scoped).every((s) => s.includes('[data-funnel-design="other"]'))).toBe(true);
  });
});
