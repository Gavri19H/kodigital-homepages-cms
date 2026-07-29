// R2 P4 S4a — the §6.8 slider ANATOMY, asserted per type against the pinned
// design pack (docs/leadgen/rework/design-pack/studio-panels.html §6.8
// "Rendered visitor examples — all five") and the owner's Image10–Image14.
//
// HONESTY (mission-loop / E10): these are CODE-HEALTH assertions on the DOM the
// server paints. They are NOT the acceptance for "the slider LOOKS like the
// pin" — this phase exists precisely because the five renderers existed and
// their unit tests were green while four of five renders were visually broken
// (contract §5.5, the exists≠executed exemplar). The driven-product evidence
// (authored as an operator, driven as a visitor at 1280 + 375, placed beside
// the owner's pins) lives in docs/leadgen/r2/evidence/p4/s4a/ — a green file
// here with a wrong-looking screenshot is a FAIL.
//
// Anatomy pinned per type (§6.8 element -> this product's class):
//   .slider-value   -> .lg-range-value        .slider-track -> .lg-range-track
//   .slider-fill    -> .lg-range-fill         .slider-handle-> .lg-range-handle
//   .slider-minmax  -> .lg-range-minmax       .stepper-row  -> .lg-range-stepper-row
//   .stepper-btn    -> .lg-range-stepper-btn  .fromto-inputs-> .lg-range-from-to-inputs
//   .f-input        -> .lg-input              .radial-outer -> .lg-range-radial-outer
//                                             .radial-inner -> .lg-range-radial-inner

import { describe, expect, it } from "vitest";
import { renderComponent } from "../src/public/leadgen/components/presets";
import type { LeadgenComponentNode } from "../src/public/leadgen/components/content-schema";
import { defaultFunnelDesign } from "../src/public/leadgen/designs/default-funnel/tokens";
import { funnelChromeCss } from "../src/public/leadgen/designs/default-funnel/styles";

const DESIGN = defaultFunnelDesign;
const CSS = funnelChromeCss(DESIGN);

function slider(props: Record<string, unknown>): string {
  return renderComponent(
    {
      type: "NumberRangeQuestion",
      question_id: "q_s",
      internal_field: "amount",
      props,
    } as LeadgenComponentNode,
    DESIGN,
  );
}

function count(html: string, needle: RegExp): number {
  return (html.match(needle) ?? []).length;
}

// The fill's inner HTML — the handles live INSIDE .lg-range-fill so the ONE
// property the runtime already updates live (fill width) carries them. The
// fill's children are the only markup between its open tag and the track's
// first <input> (the overlay control that always follows it).
function fillInner(html: string): string {
  const open = html.indexOf(`<div class="lg-range-fill"`);
  expect(open, "the track carries a .lg-range-fill").toBeGreaterThan(-1);
  const from = html.indexOf(">", open) + 1;
  const end = html.indexOf("<input", from);
  expect(end, "the fill is followed by the overlay input").toBeGreaterThan(from);
  return html.slice(from, end);
}

describe("§6.8 anatomy — single (Image11 'Value': readout, track+fill+ONE handle, 0/100 captions)", () => {
  const html = slider({ min: 0, max: 100, default: 37, step: 1, slider_type: "single" });

  it("readout ABOVE a track carrying fill + exactly ONE handle, captions below", () => {
    expect(count(html, /class="lg-range-value"/g)).toBe(1);
    expect(count(html, /class="lg-range-track"/g)).toBe(1);
    expect(count(html, /class="lg-range-fill"/g)).toBe(1);
    expect(count(html, /class="lg-range-handle"/g)).toBe(1);
    expect(count(html, /class="lg-range-minmax"/g)).toBe(1);
    // document order: value -> track -> fill -> handle -> input -> captions
    expect(html).toMatch(
      /class="lg-range-value"[\s\S]*class="lg-range-track"[\s\S]*class="lg-range-fill"[\s\S]*class="lg-range-handle"[\s\S]*type="range"[\s\S]*class="lg-range-minmax"/,
    );
  });

  it("the handle is ON the track — inside the fill, and the native input is inside the track (the detached-handle fix)", () => {
    expect(fillInner(html)).toContain(`class="lg-range-handle"`);
    // the input sits between the fill's close and the track's close
    expect(html).toMatch(/class="lg-range-fill"[\s\S]*<input class="lg-range-input"[\s\S]*<\/div><div class="lg-range-minmax">/);
    // ...and the CSS pins it over the track: absolute, inflated by one thumb
    // width so the (transparent) native thumb tracks the visible handle.
    expect(CSS).toContain(
      `.lg-range-input{-webkit-appearance:none;appearance:none;position:absolute;top:50%;left:calc(${DESIGN.rangeQuestion.thumbSize} * -0.5);width:calc(100% + ${DESIGN.rangeQuestion.thumbSize})`,
    );
    expect(CSS).toContain(`.lg-range-handle{position:absolute;left:100%;top:50%;transform:translate(-50%,-50%)`);
  });

  it("the fill width and the captions are the authored value/bounds; ONE role=slider", () => {
    expect(html).toContain(`style="width:37%`);
    expect(html).toMatch(/<div class="lg-range-minmax"><span>0<\/span><span>100<\/span><\/div>/);
    expect(count(html, /role="slider"/g)).toBe(1);
  });

  it("currency_affix prefixes the readout AND both captions with $ (display-only)", () => {
    const cur = slider({ min: 5000, max: 500000, default: 170000, slider_type: "single", currency_affix: true });
    expect(cur).toContain(`>$170,000</div>`);
    expect(cur).toMatch(/<div class="lg-range-minmax"><span>\$5,000<\/span><span>\$500,000<\/span><\/div>/);
    expect(cur).toContain(`data-format="currency"`);
    expect(cur).toContain(`data-currency="$"`);
  });
});

describe("§6.8 anatomy — stepper (Image10: −/＋ FLANK the readout, track+fill+handle, captions)", () => {
  const html = slider({ min: 5000, max: 500000, default: 170000, step: 5000, slider_type: "stepper", currency_affix: true });

  it("the row is  −  |  value  |  ＋  in that order", () => {
    expect(count(html, /class="lg-range-stepper-row"/g)).toBe(1);
    expect(count(html, /class="lg-range-stepper-btn/g)).toBe(2);
    expect(html).toMatch(
      /<div class="lg-range-stepper-row"><button[^>]*data-lg-step="dec"[^>]*>&minus;<\/button><div class="lg-range-value"[^>]*>\$170,000<\/div><button[^>]*data-lg-step="inc"[^>]*>&#65291;<\/button><\/div>/,
    );
  });

  it("a track with fill + ONE handle, and the min/max captions the probe found MISSING", () => {
    expect(count(html, /class="lg-range-track"/g)).toBe(1);
    expect(fillInner(html)).toContain(`class="lg-range-handle"`);
    expect(html).toMatch(/<div class="lg-range-minmax"><span>\$5,000<\/span><span>\$500,000<\/span><\/div>/);
  });

  it("the −/＋ buttons are styled ≥44px targets flanking the readout (not tiny, not far-left)", () => {
    expect(CSS).toContain(".lg-range-stepper-row{display:flex;align-items:center;justify-content:center");
    expect(CSS).toContain(".lg-range-stepper-btn{display:inline-flex;align-items:center;justify-content:center;width:48px;height:48px");
  });
});

describe("§6.8 anatomy — from_to (Image13: ONE track TWO handles + pills + captions + two LABELLED inputs)", () => {
  const html = slider({ min: 0, max: 100000, step: 5000, slider_type: "from_to", currency_affix: true });

  it("ONE track carrying ONE fill with TWO handles (not two stacked tracks, not zero handles)", () => {
    expect(count(html, /class="lg-range-track"/g)).toBe(1);
    expect(count(html, /class="lg-range-fill"/g)).toBe(1);
    expect(count(html, /class="lg-range-handle lg-range-handle-(min|max)"/g)).toBe(2);
    const inner = fillInner(html);
    expect(inner).toContain(`lg-range-handle-min`);
    expect(inner).toContain(`lg-range-handle-max`);
  });

  it("each handle is a REAL range input in its own {base}_min/{base}_max field wrapper, both over the SAME track", () => {
    expect(count(html, /<input class="lg-range-input lg-range-input-dual" type="range"/g)).toBe(2);
    expect(html).toMatch(/<span data-lg-field="amount_min"><input class="lg-range-input lg-range-input-dual" type="range"[^>]*data-lg-input/);
    expect(html).toMatch(/<span data-lg-field="amount_max"><input class="lg-range-input lg-range-input-dual" type="range"[^>]*data-lg-input/);
    // both handle inputs are inside the ONE track element
    const trackOpen = html.indexOf(`<div class="lg-range-track"`);
    const captions = html.indexOf(`<div class="lg-range-minmax">`);
    expect(count(html.slice(trackOpen, captions), /type="range"/g)).toBe(2);
    // overlapping inputs stay individually grabbable (thumb-only hit area)
    expect(CSS).toContain(".lg-range-input-dual{pointer-events:none}");
    expect(CSS).toContain(".lg-range-input-dual::-webkit-slider-thumb{pointer-events:auto}");
  });

  it("value pills ride the handles and $ captions bound the track (Image13's $20 000/$63 595 + $0/$100 000)", () => {
    expect(count(html, /class="lg-range-handle-value"/g)).toBe(2);
    expect(html).toMatch(/class="lg-range-handle-value"[^>]*>\$0<\/span>/);
    expect(html).toMatch(/class="lg-range-handle-value"[^>]*>\$100,000<\/span>/);
    expect(html).toMatch(/<div class="lg-range-minmax"><span>\$0<\/span><span>\$100,000<\/span><\/div>/);
  });

  it("two LABELLED number inputs ('From ($)' / 'To ($)'), each recording its own sub-field", () => {
    expect(count(html, /class="lg-range-from-to-inputs"/g)).toBe(1);
    expect(count(html, /class="lg-range-ft-label"/g)).toBe(2);
    expect(html).toMatch(/<label class="lg-range-ft-label" for="lg-ft-amount_min-from">From \(\$\)<\/label>/);
    expect(html).toMatch(/<label class="lg-range-ft-label" for="lg-ft-amount_min-to">To \(\$\)<\/label>/);
    expect(html).toMatch(/<span data-lg-field="amount_min"><input id="lg-ft-amount_min-from" class="lg-input lg-range-from" type="number" data-lg-input/);
    expect(html).toMatch(/<span data-lg-field="amount_max"><input id="lg-ft-amount_min-to" class="lg-input lg-range-to" type="number" data-lg-input/);
  });
});

describe("§6.8 anatomy — dual_range (Image11 'Range': ONE track TWO handles, readouts + captions, NO inputs)", () => {
  const html = slider({ min: 0, max: 100, step: 1, slider_type: "dual_range" });

  it("ONE track, ONE fill, TWO handles — the two-stacked-tracks defect is gone", () => {
    expect(count(html, /class="lg-range-track"/g)).toBe(1);
    expect(count(html, /class="lg-range-fill"/g)).toBe(1);
    expect(count(html, /class="lg-range-handle lg-range-handle-(min|max)"/g)).toBe(2);
    expect(count(html, /<input[^>]*type="range"/g)).toBe(2);
  });

  it("value readouts + min/max captions (the probe found neither)", () => {
    expect(count(html, /class="lg-range-handle-value"/g)).toBe(2);
    expect(html).toMatch(/<div class="lg-range-minmax"><span>0<\/span><span>100<\/span><\/div>/);
  });

  it("handles-not-inputs: no number input, and the SAME _min/_max data contract as from_to", () => {
    expect(count(html, /<input[^>]*type="number"/g)).toBe(0);
    expect(html).toContain(`data-lg-field="amount_min"`);
    expect(html).toContain(`data-lg-field="amount_max"`);
    expect(html).toContain(`data-slider-type="dual_range"`);
  });
});

describe("§6.8 anatomy — radial (Image14: circular ring, LIVE arc, big centre value, handle ON the ring)", () => {
  const html = slider({ min: 0, max: 100, default: 45, step: 1, slider_type: "radial" });

  it("a real dial: conic-gradient ring driven by --lg-deg, with the handle on the ring", () => {
    expect(html).toMatch(/<div class="lg-range-radial-outer" aria-hidden="true" style="--lg-deg:162deg;background:conic-gradient\(#1B3A5C 0deg var\(--lg-deg\), #E8EEF4 var\(--lg-deg\) 360deg\)">/);
    expect(count(html, /class="lg-range-radial-handle"/g)).toBe(1);
    // the ring is a circle, and the handle's angle reads the SAME --lg-deg
    expect(CSS).toContain(".lg-range-radial-outer{position:relative;width:var(--lg-radial-size);height:var(--lg-radial-size);border-radius:9999px");
    expect(CSS).toContain("transform:rotate(var(--lg-deg,0deg)) translateY(calc((var(--lg-radial-size) - var(--lg-radial-band)) * -0.5))");
    // NOT a flat strip: no track/fill in the radial render at all
    expect(count(html, /class="lg-range-track"/g)).toBe(0);
  });

  it("the centre value carries lg-range-value — the class the runtime rewrites (the FROZEN-centre root cause)", () => {
    expect(html).toMatch(/<div class="lg-range-value lg-range-radial-inner"[^>]*>45<\/div>/);
  });

  it("ONE slider landmark (the real input) and it is laid invisibly over the dial for keyboard", () => {
    expect(count(html, /role="slider"/g)).toBe(1);
    expect(html).toMatch(/<input class="lg-range-input lg-range-radial-input" type="range" role="slider" data-lg-input/);
    expect(CSS).toContain(".lg-range-radial-input{position:absolute;top:0;left:0;width:100%;height:100%;transform:none;opacity:0;pointer-events:none}");
    expect(CSS).toContain(".lg-range-radial:focus-within .lg-range-radial-outer{box-shadow:");
  });

  it("currency_affix reaches the dial centre too", () => {
    const cur = slider({ min: 0, max: 500000, default: 170000, slider_type: "radial", currency_affix: true });
    expect(cur).toMatch(/<div class="lg-range-value lg-range-radial-inner"[^>]*>\$170,000<\/div>/);
  });
});

describe("§6.8 — every type answers the SAME three questions (picker ≠ render is closed)", () => {
  const TYPES = ["single", "stepper", "from_to", "dual_range", "radial"] as const;

  it("all five paint a handle a visitor can see, and all five record", () => {
    for (const t of TYPES) {
      const html = slider({ min: 0, max: 100, default: 40, step: 1, slider_type: t });
      const handles = count(html, /class="lg-range-handle/g) + count(html, /class="lg-range-radial-handle"/g);
      expect(handles, `${t}: at least one visible handle`).toBeGreaterThanOrEqual(1);
      expect(count(html, /data-lg-input/g), `${t}: records`).toBeGreaterThanOrEqual(1);
      expect(count(html, /type="range"/g), `${t}: a real native slider control`).toBeGreaterThanOrEqual(1);
    }
  });

  it("$ toggles freely on every type — display-only, never node.type/answer_type", () => {
    for (const t of TYPES) {
      const off = slider({ min: 0, max: 100, default: 40, step: 1, slider_type: t });
      const on = slider({ min: 0, max: 100, default: 40, step: 1, slider_type: t, currency_affix: true });
      expect(off, `${t} off`).toContain(`data-format="number"`);
      expect(on, `${t} on`).toContain(`data-format="currency"`);
      expect(on, `${t} on`).toContain(`data-currency="$"`);
      // the stored node type/answer type is identical with and without $
      expect(off).toContain(`data-component-type="NumberRangeQuestion"`);
      expect(on).toContain(`data-component-type="NumberRangeQuestion"`);
      expect(count(off, /data-answer-type="number"/g)).toBe(count(on, /data-answer-type="number"/g));
    }
  });

  it("every class the anatomy emits is styled by the design sheet (no unstyled element)", () => {
    const classes = [
      "lg-range-value",
      "lg-range-track",
      "lg-range-fill",
      "lg-range-handle",
      "lg-range-handle-min",
      "lg-range-handle-max",
      "lg-range-handle-value",
      "lg-range-minmax",
      "lg-range-stepper-row",
      "lg-range-stepper-btn",
      "lg-range-from-to-inputs",
      "lg-range-ft-field",
      "lg-range-ft-label",
      "lg-range-radial",
      "lg-range-radial-outer",
      "lg-range-radial-inner",
      "lg-range-radial-handle",
      "lg-range-radial-input",
    ];
    for (const c of classes) expect(CSS, c).toContain(`.${c}{`);
  });
});
