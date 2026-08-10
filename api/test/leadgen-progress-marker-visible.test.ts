// LeadGen R2 — the "Icon on track" MARK IS INVISIBLE defect.
//
// Owner, 2026-08-10, on his own funnel with style=icon_on_track / Marker icon=Star:
//   "this is **not** how I defined the icon on track should look like, it is
//    invisible! It should be proportional to the progress bar size and color
//    like in this example"
// — with a reference image: a round badge in the BAR'S OWN COLOUR, several times
// the track's thickness, riding the fill's leading edge, white glyph inside.
//
// ONE cause, measured on production bytes before the fix (conductor drive,
// Chromium, production stylesheet, real region markup):
//
//   CLIPPED. The mark is a pseudo-element of `.lg-progress-fill`, which sits
//   inside `.lg-progress-track` — and the track carries `overflow:hidden`. The
//   style block's `overflow:visible` was on the FILL, so it never applied to the
//   clipping ancestor. A 22px disc inside an 8px track lost 14px of its 22px
//   height: 36.4% survived, as a bare horizontal band with no round edge, and
//   the card-coloured ring that separates the mark from the bar was cropped away
//   with it. What survived was the bar's colour at the bar's height — more bar.
//
// The disc's COLOUR was NOT part of the defect, and this file says so on purpose
// so a future reader does not "fix" it twice: `--role-*` is emitted for every
// config and overrides the fill and the disc from one role token, so a probe at
// shipped HEAD resolved disc == bar for brand_primary/accent/button_primary_bg
// alike. The colour test below is a GUARD on that invariant, not a fail-before
// leg — it passes at HEAD, and it is here because the fix makes the ring
// load-bearing: a same-colour badge needs the ring to read against the bar.
//
// WHAT THIS FILE IS NOT. The visible-paint predicate is not a browser (see the
// limitations banner in test/helpers/leadgen-visible-paint.ts): it resolves the
// real sheet against the real markup, and it measures no box. So it cannot see
// "clipped" directly. What it CAN do — and what every assertion below does — is
// resolve, through the real cascade, the four declarations the clip and the
// colour depend on, and discriminate this style from the one it must not change
// (`bar`). The pixel half of the claim is the conductor's driven measurement,
// recorded in the PR: marker 24px over an 8px track, 8px clear on every side,
// disc == bar colour, no clipping ancestor, mark travelling 44 → 205 → 366 px
// with the fill, no document overflow at either extreme in any width band.

import { describe, expect, it } from "vitest";

import { LG_BANNERS_MOUNT_HTML, renderQuoteFrame } from "../src/public/leadgen/designs/frame";
import { FRAME_SIZES, effectiveFrame } from "../src/public/leadgen/designs/frames";
import type { FrameConfig } from "../src/public/leadgen/designs/frames";
import { resolveTokens } from "../src/public/leadgen/designs/theme";
import { defaultFunnelDesign } from "../src/public/leadgen/designs/default-funnel/tokens";
import { DEFAULT_FUNNEL_SCOPE, funnelChromeCss } from "../src/public/leadgen/designs/default-funnel/styles";
import { visiblePage } from "./helpers/leadgen-visible-paint";
import type { PaintedEl } from "./helpers/leadgen-visible-paint";

const TOKENS = resolveTokens(defaultFunnelDesign);
const CSS = funnelChromeCss(defaultFunnelDesign, DEFAULT_FUNNEL_SCOPE, { frameRegions: true });
const ROOT = {
  funnelId: "lgf_0000000000000000000000M101",
  funnelVariantId: "lgn_0000000000000000000000M102",
  quoteId: "lgq_0000000000000000000000M103",
  contentVersion: 1,
};

/**
 * A site whose mark the `site_logo` icon can actually resolve. With no branding
 * frame.ts falls back to the bare dot by design ("a blank marker is worse than
 * the default dot"), so a site_logo case needs a real site to be about site_logo
 * at all.
 */
const BRANDED = {
  site_name: "Probe Site",
  logo_url: "https://cdn.example.com/mark.png",
  tagline: null,
  legal_links: [],
  trust_logos: null,
};

/** The REAL served frame for a progress patch — the visitor's own bytes. */
function render(progress: Record<string, unknown>, branding: Parameters<typeof renderQuoteFrame>[0]["siteBranding"] = null): string {
  const { frame, problems } = effectiveFrame("centered", { progress } as unknown as FrameConfig);
  expect(problems.filter((p) => p.severity === "error"), JSON.stringify(problems)).toEqual([]);
  return renderQuoteFrame({
    effectiveTokens: TOKENS,
    frame,
    siteBranding: branding,
    sectionsHtml: "",
    bannersMountHtml: LG_BANNERS_MOUNT_HTML,
    sectionCount: 9, // the owner's funnel: "Step 1 of 9"
    root: ROOT,
  });
}

interface Parts {
  region: PaintedEl;
  track: PaintedEl;
  fill: PaintedEl;
  label: PaintedEl | undefined;
  disc: Map<string, { value: string; selector: string }>;
  glyph: Map<string, { value: string; selector: string }>;
}

/** Resolve one served page down to the mark's four load-bearing layers. */
function parts(progress: Record<string, unknown>, branding: Parameters<typeof renderQuoteFrame>[0]["siteBranding"] = null): Parts {
  const page = visiblePage(CSS, render(progress, branding));
  const byClass = (c: string): PaintedEl => {
    const hit = page.visible.find((v) => v.classes.includes(c));
    expect(hit, `${c} is a VISIBLE element of the served frame`).toBeTruthy();
    return hit as PaintedEl;
  };
  const fill = byClass("lg-progress-fill");
  return {
    region: byClass("lg-frame-progress"),
    track: byClass("lg-progress-track"),
    fill,
    label: page.visible.find((v) => v.classes.includes("lg-progress-text")),
    disc: fill.pseudos.get("::after") ?? new Map(),
    glyph: fill.pseudos.get("::before") ?? new Map(),
  };
}

const ICON = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  style: "icon_on_track",
  icon: "star",
  thickness: "m",
  show_label: true,
  ...over,
});

describe("icon_on_track: the mark a visitor can actually SEE (owner defect 2026-08-10)", () => {
  it("THE CAUSE — the track stops clipping for this style, and ONLY this style", () => {
    // Before the fix this read "hidden" and cropped 14px off a 22px disc.
    expect(parts(ICON()).track.style.get("overflow")?.value).toBe("visible");
    // …while `bar` — same markup, same track — keeps clipping its square fill
    // corners into the rounded track. A fix that changed this for every style
    // would be a different, unasked-for change.
    expect(parts({ style: "bar", thickness: "m", show_label: true }).track.style.get("overflow")?.value).toBe("hidden");
  });

  it("GUARD (passes at HEAD) — the disc paints the BAR'S colour, at every role", () => {
    // The owner's reference: badge and bar are one colour. This already held via
    // the per-role rule; the guard is here so a future change to either side
    // cannot silently split them.
    for (const color_role of ["brand_primary", "accent", "button_primary_bg"]) {
      const p = parts(ICON({ color_role }));
      const disc = p.disc.get("background")?.value;
      const bar = p.fill.style.get("background")?.value;
      expect(disc, `${color_role}: the disc paints something`).toBeTruthy();
      expect(disc, `${color_role}: badge and bar are one colour`).toBe(bar);
    }
    const p = parts(ICON());
    // …and the ring is what keeps a same-colour badge readable ON that bar, so
    // it is load-bearing now, not decoration.
    expect(p.disc.get("border")?.value).toContain("solid");
  });

  it("PROPORTIONAL — the mark is derived from the thickness, never a fixed size", () => {
    const sizeAt = (thickness: (typeof FRAME_SIZES)[number]): string => {
      const p = parts(ICON({ thickness }));
      const w = p.disc.get("width")?.value;
      const h = p.disc.get("height")?.value;
      expect(w, `th-${thickness} disc has a width`).toBeTruthy();
      expect(h, "the disc is square (a circle needs equal axes)").toBe(w);
      return w as string;
    };
    const s = sizeAt("s");
    const m = sizeAt("m");
    const l = sizeAt("l");
    // Three thicknesses → three sizes. A single hardcoded px value (the shipped
    // bug: 22px at every thickness) collapses all three and fails here.
    expect(new Set([s, m, l]).size, `s=${s} m=${m} l=${l}`).toBe(3);
    // Each names its own track height, so the marker cannot drift from the bar.
    expect(s).toContain("4px");
    expect(l).toContain("12px");
    // The glyph scales off the same value instead of pinning its own px.
    expect(parts(ICON({ thickness: "s" })).glyph.get("width")?.value).not.toBe(
      parts(ICON({ thickness: "l" })).glyph.get("width")?.value,
    );
  });

  it("ROOM — the overhang is single-sourced, and the step label is pushed clear of it", () => {
    const p = parts(ICON());
    // ONE constant feeds the marker size, the track's margin and the wrapper's
    // end padding. The helper SUBSTITUTES custom properties, so what these read
    // is the resolved arithmetic — which is the stronger claim: all three end up
    // spending the same 8px, so they cannot drift apart.
    // top/bottom room as the TRACK's margin — not the wrapper's padding, which
    // left the mark overlapping the label (measured: 4px into it).
    expect(p.track.style.get("margin")?.value).toBe("8px 0");
    expect(p.disc.get("width")?.value, "the marker spends the overhang twice").toContain("8px * 2");
    // the label keeps its own breathing room BELOW the mark; a bare 4px collapsed
    // into the overhang and the mark landed exactly on the label's line box.
    const labelMt = p.label?.style.get("margin-top")?.value;
    expect(labelMt, "the step label declares its own clearance").toBeTruthy();
    expect(labelMt).toContain("8px");
    // ends reserved so the mark at 0%/100% is neither cropped nor able to widen
    // the document (E6). The wrapper is INSIDE the region, so this holds in both
    // width bands and at every viewport.
    const wrap = visiblePage(CSS, render(ICON())).visible.find((v) => v.classes.includes("lg-progress"));
    expect(wrap?.style.get("padding")?.value).toBe("0 calc(calc(8px + 8px * 2) / 2)");
  });

  it("every marker icon still rides the same one mark (no per-icon second renderer)", () => {
    for (const icon of ["dot", "car", "shield", "check", "star", "site_logo", "custom"]) {
      const p = parts(
        ICON({ icon, ...(icon === "custom" ? { icon_media_id: "probe.png" } : {}) }),
        icon === "site_logo" ? BRANDED : null,
      );
      // the disc is always the DERIVED size — no icon opts out of proportionality
      // by pinning its own px (site_logo/custom used to hardcode 26px).
      expect(p.disc.get("width")?.value, `${icon} disc size`).toBe("calc(8px + 8px * 2)");
      // `dot` is the bare disc by design (pre-P7 look); every other id paints a glyph
      const painted =
        p.glyph.get("mask-image") !== undefined ||
        p.glyph.get("-webkit-mask-image") !== undefined ||
        p.glyph.get("background-image") !== undefined;
      expect(painted, `${icon} paints a glyph on the disc`).toBe(icon !== "dot");
    }
  });
});
