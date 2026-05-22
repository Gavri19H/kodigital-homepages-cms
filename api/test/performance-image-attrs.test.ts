import { describe, it, expect } from "vitest";
import {
  renderHeroImage,
  renderBelowFoldImage,
  renderAdSlot,
} from "../src/public/templates/layout";
import {
  PUBLIC_CSS,
  AD_SLOT_CSS,
  renderPublicStyleTag,
} from "../src/public/templates/public.css";

describe("T23 renderHeroImage", () => {
  it("emits explicit width + height attributes (no CLS)", () => {
    const html = renderHeroImage({
      src: "/hero.jpg",
      alt: "Hero",
      width: 1200,
      height: 630,
    });
    expect(html).toContain('width="1200"');
    expect(html).toContain('height="630"');
  });

  it("emits loading=\"eager\" + fetchpriority=\"high\" for above-the-fold hero", () => {
    const html = renderHeroImage({
      src: "/hero.jpg",
      alt: "Hero",
      width: 1200,
      height: 630,
    });
    expect(html).toContain('loading="eager"');
    expect(html).toContain('fetchpriority="high"');
  });

  it("emits decoding=\"async\" so image decode does not block paint", () => {
    const html = renderHeroImage({
      src: "/hero.jpg",
      alt: "Hero",
      width: 1200,
      height: 630,
    });
    expect(html).toContain('decoding="async"');
  });

  it("escapes attribute-special characters in src + alt", () => {
    const html = renderHeroImage({
      src: '/hero.jpg?a="b"&c=d',
      alt: 'Hero "headline"',
      width: 1200,
      height: 630,
    });
    expect(html).toContain("&quot;");
    expect(html).toContain("&amp;");
    expect(html).not.toContain('alt="Hero "headline"');
  });

  it("throws on non-integer width", () => {
    expect(() =>
      renderHeroImage({ src: "/h.jpg", alt: "h", width: 1.5, height: 200 }),
    ).toThrow(/width/);
  });

  it("throws on zero or negative height", () => {
    expect(() =>
      renderHeroImage({ src: "/h.jpg", alt: "h", width: 200, height: 0 }),
    ).toThrow(/height/);
    expect(() =>
      renderHeroImage({ src: "/h.jpg", alt: "h", width: 200, height: -1 }),
    ).toThrow(/height/);
  });
});

describe("T23 renderBelowFoldImage", () => {
  it("emits loading=\"lazy\" for below-the-fold images", () => {
    const html = renderBelowFoldImage({
      src: "/thumb.jpg",
      alt: "thumb",
      width: 320,
      height: 180,
    });
    expect(html).toContain('loading="lazy"');
  });

  it("emits explicit width + height (anti-CLS)", () => {
    const html = renderBelowFoldImage({
      src: "/thumb.jpg",
      alt: "thumb",
      width: 320,
      height: 180,
    });
    expect(html).toContain('width="320"');
    expect(html).toContain('height="180"');
  });

  it("does NOT emit fetchpriority on below-the-fold images", () => {
    // Reserved for hero only — a lazy image should never compete with
    // the hero for early-fetch priority.
    const html = renderBelowFoldImage({
      src: "/thumb.jpg",
      alt: "thumb",
      width: 320,
      height: 180,
    });
    expect(html).not.toContain("fetchpriority=");
  });

  it("emits decoding=\"async\" on lazy images too", () => {
    const html = renderBelowFoldImage({
      src: "/thumb.jpg",
      alt: "thumb",
      width: 320,
      height: 180,
    });
    expect(html).toContain('decoding="async"');
  });
});

describe("T23 renderAdSlot", () => {
  it("emits a div with class=\"ad-slot\" and inline min-width/min-height", () => {
    const html = renderAdSlot({ id: "slot-top", width: 300, height: 250 });
    expect(html).toContain('class="ad-slot"');
    expect(html).toContain("min-width:300px");
    expect(html).toContain("min-height:250px");
  });

  it("includes data-w/data-h for diagnostics", () => {
    const html = renderAdSlot({ id: "slot-top", width: 728, height: 90 });
    expect(html).toContain('data-w="728"');
    expect(html).toContain('data-h="90"');
  });

  it("rejects non-integer dimensions", () => {
    expect(() =>
      renderAdSlot({ id: "x", width: 100.5, height: 100 }),
    ).toThrow();
  });
});

describe("T23 public.css.ts", () => {
  it("PUBLIC_CSS contains .ad-slot rule with min-height for CLS reservation", () => {
    expect(PUBLIC_CSS).toContain(".ad-slot");
    expect(PUBLIC_CSS).toContain("min-height");
  });

  it("AD_SLOT_CSS reserves both width AND height for the default + variant slots", () => {
    expect(AD_SLOT_CSS).toContain("min-width: 300px");
    expect(AD_SLOT_CSS).toContain("min-height: 250px");
    expect(AD_SLOT_CSS).toContain("min-width: 728px");
    expect(AD_SLOT_CSS).toContain("min-height: 90px");
  });

  it("renderPublicStyleTag wraps PUBLIC_CSS in a <style> element", () => {
    const tag = renderPublicStyleTag();
    expect(tag.startsWith("<style")).toBe(true);
    expect(tag.endsWith("</style>")).toBe(true);
    expect(tag).toContain(".ad-slot");
    expect(tag).toContain("min-height");
  });
});
