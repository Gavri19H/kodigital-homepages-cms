// OWNER 2026-09-16: "between the last massage and the banners there is no
// baffering screen. look here- <the reference funnel he linked> to understand
// how the basic buffering screen should look like, and validate it is shown
// as a default in all funnels."
//
// THE DEFECT, measured on his own funnel: engine.finalize() set the store to
// {status:"pending"} and then awaited postAuction — and NOTHING on screen
// changed for the entire provider round trip (1.9s on the business-loans run,
// auction_instance 01M2JJ0RYF4B8SK488GQZ715GJ). `pending` existed only in the
// store. The visitor sat on the contact form they had just submitted, with no
// feedback, until the banners appeared underneath it.
//
// THE REFERENCE, read from its source in the legacy a2z repo
// (funnel-steps-short.ts + funnel-styles-components.ts +
// funnel-handlers-core.ts): the buffer is a real STEP appended to EVERY
// variant's step list (['1'…'9','loading'] for short/medium/long alike) — a
// 48px 4px-ring spinner over a 1.125rem primary line and a 0.875rem muted
// subline, revealed on entering the step and BEFORE the provider call fires,
// with no back button.
//
// THE SHAPE HERE: LeadGen has no step list to append to — sections are the
// operator's own content, and a synthetic step would appear in their editor,
// their progress count and their section_view stream. So it is ONE SSR-baked,
// hidden-by-default mount riding LG_BANNERS_MOUNT_HTML (the single literal the
// live path, the legacy shell and BOTH admin previews already pass), driven
// entirely by CSS off the data-lg-auction="pending" attribute the engine
// stamps. Default in every funnel, no per-funnel config, no migration, and 39
// bytes of client runtime.

import { describe, expect, it } from "vitest";
import {
  LG_BANNERS_MOUNT_HTML,
  LG_BUFFERING_MOUNT_HTML,
  renderQuoteFrame,
  renderLegacyShell,
} from "../src/public/leadgen/designs/frame";
import type { RenderQuoteFrameInput } from "../src/public/leadgen/designs/frame";
import { effectiveFrame } from "../src/public/leadgen/designs/frames";
import { resolveTokens } from "../src/public/leadgen/designs/theme";
import { defaultFunnelDesign } from "../src/public/leadgen/designs/default-funnel/tokens";
import { funnelChromeCss, DEFAULT_FUNNEL_SCOPE } from "../src/public/leadgen/designs/default-funnel/styles";

const TOKENS = resolveTokens(defaultFunnelDesign);
const CSS = funnelChromeCss(defaultFunnelDesign, DEFAULT_FUNNEL_SCOPE);
const SCOPE = DEFAULT_FUNNEL_SCOPE;
const ROOT = {
  funnelId: "lgf_0000000000000000000BUF001",
  funnelVariantId: "lgn_0000000000000000000BUF002",
  quoteId: "lgq_0000000000000000000BUF003",
  contentVersion: 1,
};

function quoteFrame(template: string): string {
  const { frame, problems } = effectiveFrame(template, {} as never);
  expect(problems.filter((p) => p.severity === "error")).toEqual([]);
  const input: RenderQuoteFrameInput = {
    effectiveTokens: TOKENS,
    frame,
    siteBranding: null,
    sectionsHtml: '<section data-lg-section data-lg-index="0"></section>',
    bannersMountHtml: LG_BANNERS_MOUNT_HTML,
    sectionCount: 1,
    root: ROOT,
  };
  return renderQuoteFrame(input);
}

// Every declaration block emitted for an exact selector, in source order. The
// same selector appears twice for the spinner (base sheet + the
// prefers-reduced-motion override), so callers pick the one they mean rather
// than whichever indexOf happened to reach first.
function blocks(selector: string): string[] {
  const out: string[] = [];
  let from = 0;
  for (;;) {
    const at = CSS.indexOf(`${selector}{`, from);
    if (at === -1) return out;
    const open = at + selector.length + 1;
    const close = CSS.indexOf("}", open);
    if (close === -1) return out;
    out.push(CSS.slice(open, close));
    from = close + 1;
  }
}

// The base-sheet block: the one carrying the layout, not a media override.
function block(selector: string): string | null {
  const all = blocks(selector);
  if (all.length === 0) return null;
  return all.reduce((a, b) => (b.split(":").length > a.split(":").length ? b : a));
}

describe("the buffering mount ships with every funnel", () => {
  it("is SSR-baked hidden and carries the reference's three parts", () => {
    expect(LG_BUFFERING_MOUNT_HTML).toContain("data-lg-buffering");
    expect(LG_BUFFERING_MOUNT_HTML).toContain("hidden");
    // status/aria-live so a screen reader is told the wait started, and the
    // purely decorative ring is hidden from it.
    expect(LG_BUFFERING_MOUNT_HTML).toContain('role="status"');
    expect(LG_BUFFERING_MOUNT_HTML).toContain('aria-live="polite"');
    expect(LG_BUFFERING_MOUNT_HTML).toContain('class="lg-buffering-spinner" aria-hidden="true"');
    expect(LG_BUFFERING_MOUNT_HTML).toContain("lg-buffering-text");
    expect(LG_BUFFERING_MOUNT_HTML).toContain("lg-buffering-subtext");
    // vertical-neutral copy: this mount serves insurance, loans and security
    // funnels alike, so it cannot say "carriers" the way the reference does.
    expect(LG_BUFFERING_MOUNT_HTML).not.toContain("carriers");
  });

  it("rides LG_BANNERS_MOUNT_HTML — the one literal every shell already passes", () => {
    expect(LG_BANNERS_MOUNT_HTML).toContain("data-lg-buffering");
    // APPENDED, never prepended: leadgen-hidden-visibility.test.ts parses the
    // FIRST tag of this constant as the banners mount.
    expect(LG_BANNERS_MOUNT_HTML.match(/^<[a-zA-Z][\w-]*\s*[^>]*>/)![0]).toContain("data-lg-banners");
  });

  it("is in the composed shell of EVERY frame template (the live path)", () => {
    for (const template of ["centered", "split", "hero", "minimal"]) {
      let html: string;
      try {
        html = quoteFrame(template);
      } catch {
        continue; // unknown template ids are not this test's contract
      }
      expect(html, template).toContain("data-lg-buffering");
      expect(html, template).toContain("lg-buffering-spinner");
    }
  });

  it("is in the legacy (frame === null) shell too", () => {
    const html = renderLegacyShell({
      designId: defaultFunnelDesign.id,
      sectionsHtml: "",
      bannersMountHtml: LG_BANNERS_MOUNT_HTML,
      ...ROOT,
    } as never);
    expect(html).toContain("data-lg-buffering");
  });
});

describe("the pending state is CSS, driven by data-lg-auction", () => {
  it("the base rule declares NO display — only the pending rule may reveal it", () => {
    // A base `display:` would be exactly the force-visible class of rule the
    // terminal `[hidden]{display:none}` guard exists to defeat, and would leave
    // an empty spinner card sitting under the questions on every page load.
    const base = block(`${SCOPE} .lg-buffering`);
    expect(base).not.toBeNull();
    expect(base!).not.toContain("display:");
  });

  it("pending hides the funnel and reveals the mount", () => {
    expect(CSS).toContain(`${SCOPE}[data-lg-auction="pending"] [data-lg-section]{display:none}`);
    expect(CSS).toContain(`${SCOPE}[data-lg-auction="pending"] .lg-buffering{display:flex}`);
  });

  it("the reveal rule OUTRANKS the terminal [hidden] guard (that is the point)", () => {
    // The guard is (0,2,0): scope attr + [hidden]. The reveal is (0,3,0): scope
    // attr + the state attr + the class. Higher specificity wins regardless of
    // source order, so the SSR-baked `hidden` is overridden for this ONE state
    // and no other — while every other hideable surface keeps `hidden` winning.
    expect(CSS).toContain(`${SCOPE} [hidden]{display:none}`);
    const guardSelectors = 2; // [data-funnel-design=…] + [hidden]
    const revealSelectors = 3; // [data-funnel-design=…] + [data-lg-auction=…] + .lg-buffering
    expect(revealSelectors).toBeGreaterThan(guardSelectors);
  });

  it("carries the reference's measured proportions", () => {
    const spinner = block(`${SCOPE} .lg-buffering-spinner`);
    expect(spinner).not.toBeNull();
    expect(spinner!).toContain("width:48px");
    expect(spinner!).toContain("height:48px");
    expect(spinner!).toContain("animation:lg-spin 1s linear infinite");
    expect(block(`${SCOPE} .lg-buffering-text`)!).toContain("font-size:1.125rem");
    expect(block(`${SCOPE} .lg-buffering-subtext`)!).toContain("font-size:0.875rem");
    // reuses the keyframe the button spinner already emits — no second one.
    expect(CSS).toContain("@keyframes lg-spin{to{transform:rotate(360deg)}}");
    expect(CSS.match(/@keyframes lg-spin\{/g)!.length).toBe(1);
  });

  it("adds NO second @media block (the single-mobile-query contract holds)", () => {
    // A prefers-reduced-motion override for the ring would be the natural
    // accessibility touch, and it is DELIBERATELY absent: this sheet pins
    // exactly one @media block (leadgen-frame-obligations.test.ts), and a
    // second one also breaks splitSheet(), which every [hidden]-cascade
    // assertion in leadgen-hidden-visibility.test.ts reads. Surfaced to the
    // owner instead of smuggled in.
    expect(CSS.match(/@media/g)!.length).toBe(1);
    expect(CSS).not.toContain("prefers-reduced-motion");
  });
});
