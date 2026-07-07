// LeadGen Phase 9 STAGE A — banner design registry + §20 field-map contract.
// getBannerDesign fallback (unknown → default), the banner-default module reuses
// the measured banner tokens verbatim, scoped banner CSS, and field_map_json
// validation that accepts ONLY canonical Carrier fields (rejects unknown).

import { describe, expect, it } from "vitest";
import { getBannerDesign, BANNER_DESIGNS } from "../src/public/leadgen/designs/registry";
import { bannerDefaultDesign, BANNER_DEFAULT_ID } from "../src/public/leadgen/designs/banner-default/tokens";
import { defaultFunnelDesign } from "../src/public/leadgen/designs/default-funnel/tokens";
import {
  bannerChromeCss,
  CANONICAL_CARRIER_FIELDS,
  DEFAULT_BANNER_SCOPE,
  resolveBannerSlots,
  validateBannerFieldMap,
  type LeadgenBannerFieldMap,
} from "../src/public/leadgen/designs/banner-default/styles";

// ---------------------------------------------------------------------------
// getBannerDesign fallback (§20 "unknown → default")
// ---------------------------------------------------------------------------

describe("getBannerDesign — §20 fallback", () => {
  it("absent / null / empty id → the banner-default design", () => {
    expect(getBannerDesign()).toBe(bannerDefaultDesign);
    expect(getBannerDesign(null)).toBe(bannerDefaultDesign);
    expect(getBannerDesign("")).toBe(bannerDefaultDesign);
  });

  it("unknown id → the banner-default design", () => {
    expect(getBannerDesign("no-such-banner")).toBe(bannerDefaultDesign);
  });

  it("the canonical id `banner-default` resolves directly", () => {
    expect(getBannerDesign(BANNER_DEFAULT_ID)).toBe(bannerDefaultDesign);
    expect(BANNER_DESIGNS[BANNER_DEFAULT_ID]).toBe(bannerDefaultDesign);
  });

  it("reuses the MEASURED funnel banner token group verbatim (no new palette)", () => {
    expect(bannerDefaultDesign).toBe(defaultFunnelDesign.banner);
    expect(bannerDefaultDesign.ctaBackground).toBe("#1B3A5C"); // navy
    expect(bannerDefaultDesign.recommendedBorder).toContain("#E85D26"); // accent orange
    expect(bannerDefaultDesign.cardRadius).toBe("20px");
  });
});

// ---------------------------------------------------------------------------
// bannerChromeCss — scoped, token-driven
// ---------------------------------------------------------------------------

describe("bannerChromeCss", () => {
  const css = bannerChromeCss(bannerDefaultDesign);

  it("produces a non-trivial stylesheet, every rule scoped under the banner scope", () => {
    expect(css.length).toBeGreaterThan(100);
    const selectors: string[] = [];
    for (const m of css.matchAll(/([^{}]+)\{/g)) selectors.push((m[1] ?? "").trim());
    expect(selectors.length).toBeGreaterThan(3);
    expect(selectors.every((s) => s.includes(DEFAULT_BANNER_SCOPE))).toBe(true);
  });

  it("reads the measured banner tokens (card radius, navy cta, recommended orange)", () => {
    expect(css).toContain("border-radius:20px");
    expect(css).toContain("background:#1B3A5C"); // cta navy
    expect(css).toContain("#E85D26"); // recommended accent
  });

  it("a different scope rescopes every rule", () => {
    const scoped = bannerChromeCss(bannerDefaultDesign, '[data-banner-design="other"]');
    const selectors: string[] = [];
    for (const m of scoped.matchAll(/([^{}]+)\{/g)) selectors.push((m[1] ?? "").trim());
    expect(selectors.every((s) => s.includes('[data-banner-design="other"]'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §20 canonical Carrier field set + field_map validation
// ---------------------------------------------------------------------------

describe("CANONICAL_CARRIER_FIELDS (§20)", () => {
  it("is exactly the 10 canonical normalized Carrier fields", () => {
    expect([...CANONICAL_CARRIER_FIELDS].sort()).toEqual(
      [
        "bid",
        "bid_currency",
        "carrier_key",
        "carrier_logo",
        "carrier_name",
        "click_url",
        "disclaimer",
        "headline",
        "subheadline",
        "tracking_id",
      ].sort(),
    );
  });
});

describe("validateBannerFieldMap — accepts only canonical Carrier fields", () => {
  it("accepts a map whose keys are all canonical Carrier fields", () => {
    const r = validateBannerFieldMap({ carrier_name: "name_slot", click_url: "cta_slot", bid: "price_slot" });
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.field_map).toEqual({ carrier_name: "name_slot", click_url: "cta_slot", bid: "price_slot" });
  });

  it("rejects an unknown (non-canonical) Carrier field", () => {
    const r = validateBannerFieldMap({ carrier_name: "ok", provider_secret: "leak" });
    expect(r.valid).toBe(false);
    expect(r.field_map).toBeNull();
    expect(r.errors.join(" ")).toContain("provider_secret");
  });

  it("rejects the parse-only `provider_id`/`pricing_model`/`carrier_key_source` (not canonical banner fields)", () => {
    expect(validateBannerFieldMap({ provider_id: "s" }).valid).toBe(false);
    expect(validateBannerFieldMap({ pricing_model: "s" }).valid).toBe(false);
    expect(validateBannerFieldMap({ carrier_key_source: "s" }).valid).toBe(false);
  });

  it("rejects non-object input", () => {
    expect(validateBannerFieldMap(null).valid).toBe(false);
    expect(validateBannerFieldMap([]).valid).toBe(false);
    expect(validateBannerFieldMap("carrier_name").valid).toBe(false);
    expect(validateBannerFieldMap(42).valid).toBe(false);
  });

  it("rejects non-string / empty slot ids", () => {
    expect(validateBannerFieldMap({ carrier_name: 123 }).valid).toBe(false);
    expect(validateBannerFieldMap({ carrier_name: "" }).valid).toBe(false);
    expect(validateBannerFieldMap({ carrier_name: "  " }).valid).toBe(false);
  });

  it("rejects prototype-pollution keys (own __proto__ key from JSON.parse)", () => {
    // A JSON.parse'd field_map_json column CAN carry an own "__proto__" key
    // (an object literal cannot) — the realistic attack surface.
    expect(validateBannerFieldMap(JSON.parse('{"__proto__":"slot"}')).valid).toBe(false);
  });

  it("empty map is valid (no unknown fields)", () => {
    const r = validateBannerFieldMap({});
    expect(r.valid).toBe(true);
    expect(r.field_map).toEqual({});
  });
});

describe("resolveBannerSlots — reads only mapped canonical fields", () => {
  it("maps canonical Carrier field values into their slot ids", () => {
    const fieldMap: LeadgenBannerFieldMap = { carrier_name: "title", bid: "price", click_url: "cta" };
    const carrier = { carrier_key: "acme", carrier_name: "Acme", bid: 12, click_url: "https://x", disclaimer: "d" };
    expect(resolveBannerSlots(fieldMap, carrier)).toEqual({ title: "Acme", price: 12, cta: "https://x" });
  });
});
