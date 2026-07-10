// LeadGen v2.5 Phase A — contract tests `progress-from-variant-order` +
// `back-behavior` — SERVER-SIDE legs (redesign-contract-v2.5 11 §11.1/§11.2 +
// 13 §13.1), over the pure renderQuoteFrame module.
//
// COVERAGE SPLIT (deliberate — reported):
//   * THIS file proves the server-rendered markup: the frame renders the
//     progress ONCE at frame_config.progress.position with config-derived
//     preset props whose TOTAL comes from the variant section count passed
//     in; the back affordance renders ONCE per frame_config.back
//     (style/position/label) with the engine's data-lg-back hook.
//   * ENGINE-DRIVEN legs — progress ADVANCING across steps (updateProgress
//     over visible dependency-satisfied sections), back HIDE-ON-FIRST
//     (setBackVisible while back_stack is empty), back navigation +
//     history_fallback behavior, dots-state advancement — belong to the
//     INTEGRATION slice (the 11 §11.6 engine audit + hydration tests); they
//     are intentionally NOT asserted here.

import { describe, expect, it } from "vitest";

import { LG_BANNERS_MOUNT_HTML, renderQuoteFrame } from "../src/public/leadgen/designs/frame";
import type { RenderQuoteFrameInput } from "../src/public/leadgen/designs/frame";
import { effectiveFrame } from "../src/public/leadgen/designs/frames";
import type { FrameConfig, FrameTemplateId } from "../src/public/leadgen/designs/frames";
import { resolveTokens } from "../src/public/leadgen/designs/theme";
import { defaultFunnelDesign } from "../src/public/leadgen/designs/default-funnel/tokens";
import type { SiteBranding } from "../src/leadgen/branding";

const TOKENS = resolveTokens(defaultFunnelDesign);

const BRANDING: SiteBranding = {
  site_name: "Acme Insure",
  logo_url: "/media/site-logo.png",
  tagline: null,
  legal_links: [],
};

const ROOT = {
  funnelId: "lgf_0000000000000000000FRAME01",
  funnelVariantId: "lgn_0000000000000000000FRAME02",
  quoteId: "lgq_0000000000000000000FRAME03",
  contentVersion: 1,
};

const PROGRESS_MOUNT_RE = /data-lg-progress(?![-a-z])/g;
const BACK_MOUNT_RE = /data-lg-back(?![-a-z])/g;
const countRe = (s: string, re: RegExp): number => [...s.matchAll(re)].length;

// Frame-only renders (empty sectionsHtml) so every hook counted is the
// frame's own; the coexistence-with-legacy-sections case is proven in
// leadgen-frame-render.test.ts.
function composed(patch: FrameConfig, sectionCount: number, template: FrameTemplateId = "centered"): string {
  const { frame, problems } = effectiveFrame(template, patch);
  expect(problems).toEqual([]);
  const input: RenderQuoteFrameInput = {
    effectiveTokens: TOKENS,
    frame,
    siteBranding: BRANDING,
    sectionsHtml: "",
    bannersMountHtml: LG_BANNERS_MOUNT_HTML,
    sectionCount,
    root: ROOT,
  };
  return renderQuoteFrame(input);
}

const regionIdx = (html: string, name: string): number =>
  html.indexOf(`data-frame-region="${name}"`);

// ---------------------------------------------------------------------------
// progress-from-variant-order — server-side legs (§11.1)
// ---------------------------------------------------------------------------

describe("progress-from-variant-order — the frame mount carries the variant section count", () => {
  it('style "bar" (default): ONE step-mode mount, aria total = the section count you pass in', () => {
    const html = composed({}, 5);
    expect(countRe(html, PROGRESS_MOUNT_RE)).toBe(1);
    expect(html).toContain('data-lg-progress data-mode="step"');
    expect(html).toContain('aria-valuemax="5"');
    expect(html).toContain('aria-valuenow="1"');
    // bar hides the auto step label unless show_label (chrome-CSS class)
    expect(html).toContain("lg-frame-progress--no-label");
  });

  it("the total tracks the passed-in count across sizes (1 / 3 / 7) and clamps a zero count to 1", () => {
    for (const n of [1, 3, 7]) {
      expect(composed({}, n)).toContain(`aria-valuemax="${n}"`);
    }
    expect(composed({}, 0)).toContain('aria-valuemax="1"');
  });

  it('"bar" with show_label keeps the derived "Step 1 of N" label visible', () => {
    const html = composed({ progress: { show_label: true } }, 5);
    expect(html).not.toContain("lg-frame-progress--no-label");
    expect(html).toContain('<div class="lg-progress-text" data-lg-progress-label>Step 1 of 5</div>');
  });

  it('"numbered" always shows the step label (that IS the style)', () => {
    const html = composed({ progress: { style: "numbered" } }, 4);
    expect(html).toContain('data-mode="step"');
    expect(html).toContain('aria-valuemax="4"');
    expect(html).toContain('aria-valuetext="Step 1 of 4"');
    expect(html).toContain('data-lg-progress-label>Step 1 of 4</div>');
    expect(html).not.toContain("lg-frame-progress--no-label");
  });

  it('"percent": percent-mode mount whose initial width/aria derive from step 1 of the section count', () => {
    const html = composed({ progress: { style: "percent" } }, 4);
    expect(countRe(html, PROGRESS_MOUNT_RE)).toBe(1);
    expect(html).toContain('data-lg-progress data-mode="percent"');
    expect(html).toContain("width:25%"); // round(1/4 · 100)
    expect(html).toContain('aria-valuenow="25"');
    expect(html).not.toContain("lg-progress-text"); // label only when show_label
    const labelled = composed({ progress: { style: "percent", show_label: true } }, 4);
    expect(labelled).toContain('data-lg-progress-label>25%</div>');
  });

  it('"dots": StepIndicator visual; the REGION WRAPPER carries the single engine mount + a hidden label sink', () => {
    const html = composed({ progress: { style: "dots" } }, 3);
    expect(countRe(html, PROGRESS_MOUNT_RE)).toBe(1);
    // the wrapper is the mount (StepIndicator itself has no engine hook) …
    expect(html).toContain('data-frame-region="progress" data-lg-progress data-mode="step"');
    // … the dots carry the a11y total from the section count …
    expect(html).toContain('aria-valuemax="3"');
    expect(html.split('<span class="lg-step"').length - 1).toBe(3);
    expect(html.split('data-active="true"').length - 1).toBe(1);
    // … and the hidden sink keeps the CURRENT engine's updateProgress from
    // wiping the dots (render.ts textContent fallback needs bar+label absent).
    expect(html).toContain('<span class="lg-frame-progress-label" data-lg-progress-label hidden></span>');
  });

  it('"hidden": no progress region and no frame-owned mount', () => {
    const html = composed({ progress: { style: "hidden" } }, 5);
    expect(regionIdx(html, "progress")).toBe(-1);
    expect(countRe(html, PROGRESS_MOUNT_RE)).toBe(0);
  });

  describe("position variants — rendered ONCE at frame_config.progress.position, OUTSIDE the swapped sections", () => {
    it('"top": before the header band', () => {
      const html = composed({ progress: { position: "top" } }, 3);
      const progress = regionIdx(html, "progress");
      expect(progress).toBeGreaterThan(-1);
      expect(progress).toBeLessThan(regionIdx(html, "logo"));
      expect(countRe(html, PROGRESS_MOUNT_RE)).toBe(1);
    });

    it('"under_header" (default): after the header band, before the slot', () => {
      const html = composed({}, 3);
      const progress = regionIdx(html, "progress");
      expect(progress).toBeGreaterThan(regionIdx(html, "logo"));
      expect(progress).toBeLessThan(regionIdx(html, "section_slot"));
    });

    it('"above_unit": immediately before the slot (after a between-placed trust strip)', () => {
      const html = composed(
        {
          progress: { position: "above_unit" },
          trust_strip: {
            enabled: true,
            logos: [{ media_id: "trust/a.png", alt: "A" }],
            placement: "between_progress_and_unit",
          },
        },
        3,
      );
      const trust = regionIdx(html, "trust_strip");
      const progress = regionIdx(html, "progress");
      const slot = regionIdx(html, "section_slot");
      expect(trust).toBeLessThan(progress);
      expect(progress).toBeLessThan(slot);
    });

    it('"in_card": inside the section_slot wrapper, above the data-lg-mount main — still ONE mount', () => {
      const html = composed({ progress: { position: "in_card" } }, 3);
      const slot = regionIdx(html, "section_slot");
      const progress = regionIdx(html, "progress");
      const main = html.indexOf("<main");
      expect(slot).toBeLessThan(progress);
      expect(progress).toBeLessThan(main);
      expect(countRe(html, PROGRESS_MOUNT_RE)).toBe(1);
    });
  });

  it("the mount carries the configured color role as a class (values resolved in chrome CSS, not markup)", () => {
    const html = composed({ progress: { color_role: "accent" } }, 3);
    expect(html).toContain("lg-frame-progress--role-accent");
  });

  // Engine-driven advancement (updateProgress over visible dependency-
  // satisfied sections; dots state advance) — integration slice (see header).
});

// ---------------------------------------------------------------------------
// back-behavior — server-side legs (§11.2)
// ---------------------------------------------------------------------------

describe("back-behavior — one affordance per frame_config.back", () => {
  it("default: ONE frame-owned data-lg-back mount with the default label", () => {
    const html = composed({}, 3);
    expect(countRe(html, BACK_MOUNT_RE)).toBe(1);
    expect(regionIdx(html, "back")).toBeGreaterThan(-1);
    expect(html).toContain('aria-label="Back"');
    expect(html).toContain("&#8592;</span> Back</button>");
  });

  it("configured label renders (escaped) on the BackButton preset", () => {
    const html = composed({ back: { label: "Go back & retry" } }, 3);
    expect(html).toContain('aria-label="Go back &amp; retry"');
    expect(html).toContain("Go back &amp; retry</button>");
  });

  it('style "hidden": no back region, no mount', () => {
    const html = composed({ back: { style: "hidden" } }, 3);
    expect(regionIdx(html, "back")).toBe(-1);
    expect(countRe(html, BACK_MOUNT_RE)).toBe(0);
  });

  it("style variants ride as chrome classes on the region wrapper", () => {
    expect(composed({}, 3)).toContain("lg-frame-back--text"); // §3.3 default
    expect(composed({ back: { style: "icon_text" } }, 3)).toContain("lg-frame-back--icon_text");
    expect(composed({ back: { style: "button" } }, 3)).toContain("lg-frame-back--button");
  });

  it("history_fallback rides as a data attribute for the engine's additive tweak", () => {
    expect(composed({}, 3)).toContain('data-frame-region="back" data-history-fallback="true"');
    expect(composed({ back: { history_fallback: false } }, 3)).toContain('data-history-fallback="false"');
  });

  describe("position variants — one mount OUTSIDE the swapped sections in every position", () => {
    it('"under_header_left": after the header band, before the slot', () => {
      const html = composed({ back: { position: "under_header_left" } }, 3);
      const back = regionIdx(html, "back");
      expect(back).toBeGreaterThan(regionIdx(html, "logo"));
      expect(back).toBeLessThan(regionIdx(html, "section_slot"));
      expect(html).toContain("lg-frame-back--pos-under_header_left");
    });

    it('"in_card" (centered default): inside the section_slot wrapper, above the mount main', () => {
      const html = composed({}, 3);
      const back = regionIdx(html, "back");
      expect(back).toBeGreaterThan(regionIdx(html, "section_slot"));
      expect(back).toBeLessThan(html.indexOf("<main"));
      expect(html).toContain("lg-frame-back--pos-in_card");
    });

    it('"below_card": after the slot (the §4.3 header-cta "back link" row)', () => {
      const html = composed({ back: { position: "below_card" } }, 3);
      const back = regionIdx(html, "back");
      expect(back).toBeGreaterThan(html.indexOf("</main>"));
      expect(back).toBeLessThan(regionIdx(html, "footer"));
      expect(html).toContain("lg-frame-back--pos-below_card");
    });

    it('"footer": inside the footer region', () => {
      const html = composed({ back: { position: "footer" } }, 3);
      const back = regionIdx(html, "back");
      expect(back).toBeGreaterThan(regionIdx(html, "footer"));
      expect(countRe(html, BACK_MOUNT_RE)).toBe(1);
    });

    it('"footer" with the footer disabled: the affordance still renders exactly once (orphan fallback)', () => {
      const html = composed({ back: { position: "footer" }, footer: { enabled: false } }, 3);
      expect(regionIdx(html, "footer")).toBe(-1);
      expect(regionIdx(html, "back")).toBeGreaterThan(-1);
      expect(countRe(html, BACK_MOUNT_RE)).toBe(1);
    });
  });

  it("every position keeps exactly ONE frame-owned mount", () => {
    for (const position of ["under_header_left", "in_card", "below_card", "footer"] as const) {
      expect(countRe(composed({ back: { position } }, 3), BACK_MOUNT_RE), position).toBe(1);
    }
  });

  // Hide-on-first (setBackVisible over an empty back_stack), previous-Section
  // navigation and the history_fallback runtime leg — integration slice (see
  // the header comment).
});
