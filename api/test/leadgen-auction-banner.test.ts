// LeadGen Phase 10 STAGE A — banner render (contract 07 §20 + §19 step 14).
// PURE (no I/O). Proves: automatic field_map → slots; manual banner_config_json;
// missing click_url → banner_url_template + {response:*} (canonical + response
// macros, optional safe_fallback); a required response macro missing → the
// carrier is DROPPED with carrier_filtered_reason='missing_required_response_field';
// HTML escaping of every interpolation; one carrier_impression per rendered
// slot under one banner_render_id; the bannerChromeCss chrome.

import { describe, expect, it } from "vitest";
import { renderBanners, type BannerRenderCarrier, type BannerRenderConfig } from "../src/public/leadgen/auction/banner";
import { getBannerDesign } from "../src/public/leadgen/designs/registry";
import type { LeadgenParsedCarrier } from "../src/public/leadgen/auction/parse";

const DESIGN = getBannerDesign(null); // banner-default
const AUCTION = { auction_instance_id: "ai_1", banner_design_id: "banner-default" as string | null };
const FIXED_ID = { mintId: () => "brid_1" };

function carrier(overrides: Partial<LeadgenParsedCarrier> = {}): LeadgenParsedCarrier {
  return {
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
    ...overrides,
  };
}

function entry(overrides: Partial<BannerRenderCarrier> = {}): BannerRenderCarrier {
  return {
    carrier: carrier(),
    offer_public_id: "lgo_x",
    slot: 1,
    source: "winner",
    bid: 3.2,
    ...overrides,
  };
}

const AUTOMATIC: BannerRenderConfig = {
  mode: "automatic",
  field_map_json: { carrier_name: "name", carrier_logo: "logo", headline: "headline", click_url: "cta" },
};

// ---------------------------------------------------------------------------
// automatic field map
// ---------------------------------------------------------------------------

describe("renderBanners — automatic field_map → slots (§20)", () => {
  it("maps canonical Carrier fields to slots, emits one impression per slot under one banner_render_id", async () => {
    const carriers = [
      entry({ slot: 1, source: "winner" }),
      entry({
        slot: 2,
        source: "multi_offer",
        offer_public_id: "lgo_y",
        carrier: carrier({ carrier_key: "beta", carrier_name: "Beta Ins", click_url: "https://p.example.com/beta" }),
      }),
    ];
    const out = renderBanners(carriers, AUCTION, AUTOMATIC, DESIGN, FIXED_ID);

    expect(out.banner_render_id).toBe("brid_1");
    expect(out.slots).toHaveLength(2);
    expect(out.dropped).toEqual([]);
    expect(out.slots[0]?.fields["carrier_name"]).toBe("Acme Life");
    expect(out.slots[0]?.fields["carrier_logo"]).toBe("https://cdn.example.com/acme.png");
    expect(out.slots[0]?.click_url).toBe("https://p.example.com/click");

    // one carrier_impression per slot, all under the one banner_render_id
    expect(out.impressions).toHaveLength(2);
    expect(out.impressions.every((im) => im.banner_render_id === "brid_1")).toBe(true);
    expect(out.impressions[0]).toMatchObject({ carrier_key: "acme-life", slot: 1, source: "winner", auction_instance_id: "ai_1" });
    expect(out.impressions[1]).toMatchObject({ carrier_key: "beta", offer_public_id: "lgo_y", slot: 2, source: "multi_offer" });

    // chrome CSS + rendered regions
    expect(out.css).toContain(".lg-banner");
    expect(out.html).toContain('data-banner-render-id="brid_1"');
    expect(out.html).toContain("Acme Life");
    expect(out.html).toContain('href="https://p.example.com/click"');
    expect(out.html).toContain('class="lg-banner-logo"');
  });

  it("an unknown banner_design_id still renders (getBannerDesign fallback → default)", async () => {
    const out = renderBanners([entry()], AUCTION, AUTOMATIC, getBannerDesign("does-not-exist"), FIXED_ID);
    expect(out.slots).toHaveLength(1);
    expect(out.css).toContain(".lg-banner");
  });
});

// ---------------------------------------------------------------------------
// manual config
// ---------------------------------------------------------------------------

describe("renderBanners — manual banner_config_json (§20)", () => {
  it("renders the static headline/subheadline/logo/cta/legal around the carrier link", async () => {
    const config: BannerRenderConfig = {
      mode: "manual",
      banner_config_json: {
        headline: "Save on coverage",
        subheadline: "Compare top carriers",
        logo: "https://cdn.example.com/brand.png",
        cta: "Get my quote",
        legal: "Terms apply",
      },
    };
    const out = renderBanners([entry()], AUCTION, config, DESIGN, FIXED_ID);
    expect(out.slots).toHaveLength(1);
    expect(out.slots[0]?.fields["headline"]).toBe("Save on coverage");
    expect(out.html).toContain("Save on coverage");
    expect(out.html).toContain("Compare top carriers");
    expect(out.html).toContain("Get my quote"); // CTA label from config
    expect(out.html).toContain("Terms apply");
    expect(out.html).toContain('href="https://p.example.com/click"');
  });
});

// ---------------------------------------------------------------------------
// missing click_url → banner_url_template + {response:*} (§20 / §10.5)
// ---------------------------------------------------------------------------

describe("renderBanners — missing click_url resolution (§10.5)", () => {
  it("resolves via banner_url_template with canonical + {response:*} macros; optional missing → safe_fallback", async () => {
    const c = entry({
      carrier: carrier({ click_url: null }),
      banner_url_template: "https://go.example.com/c?slug={response:slug}&promo={response:promo?}&s5={sub5}",
      response_macro_fallbacks: { promo: "none" },
      response_context: { slug: "acme" }, // promo absent → its safe_fallback
    });
    const out = renderBanners([c], { ...AUCTION, canonical_macros: { sub5: "campaign1" } }, AUTOMATIC, DESIGN, FIXED_ID);
    expect(out.dropped).toEqual([]);
    expect(out.slots).toHaveLength(1);
    expect(out.slots[0]?.click_url).toBe("https://go.example.com/c?slug=acme&promo=none&s5=campaign1");
  });

  it("a required {response:*} macro with no value → carrier DROPPED (missing_required_response_field)", async () => {
    const c = entry({
      carrier: carrier({ click_url: null }),
      banner_url_template: "https://go.example.com/c?slug={response:slug}",
      response_context: { other: "x" }, // slug is required and MISSING
    });
    const out = renderBanners([c], AUCTION, AUTOMATIC, DESIGN, FIXED_ID);
    expect(out.slots).toEqual([]);
    expect(out.impressions).toEqual([]);
    expect(out.dropped).toHaveLength(1);
    expect(out.dropped[0]).toMatchObject({
      carrier_key: "acme-life",
      offer_public_id: "lgo_x",
      slot: 1,
      carrier_filtered_reason: "missing_required_response_field",
    });
  });

  it("a required response macro resolving to EMPTY STRING is also a drop (never silently empty)", async () => {
    const c = entry({
      carrier: carrier({ click_url: null }),
      banner_url_template: "https://go.example.com/c?slug={response:slug}",
      response_context: { slug: "" },
    });
    const out = renderBanners([c], AUCTION, AUTOMATIC, DESIGN, FIXED_ID);
    expect(out.dropped[0]?.carrier_filtered_reason).toBe("missing_required_response_field");
  });

  it("no click_url AND no banner_url_template → dropped (missing_click_url)", async () => {
    const c = entry({ carrier: carrier({ click_url: null }), banner_url_template: null });
    const out = renderBanners([c], AUCTION, AUTOMATIC, DESIGN, FIXED_ID);
    expect(out.dropped[0]?.carrier_filtered_reason).toBe("missing_click_url");
    expect(out.slots).toEqual([]);
  });

  it("a non-http provider click_url is treated as absent (falls through to template / drop)", async () => {
    const c = entry({ carrier: carrier({ click_url: "javascript:alert(1)" }), banner_url_template: null });
    const out = renderBanners([c], AUCTION, AUTOMATIC, DESIGN, FIXED_ID);
    expect(out.dropped[0]?.carrier_filtered_reason).toBe("missing_click_url");
    expect(out.html).not.toContain("javascript:");
  });
});

// ---------------------------------------------------------------------------
// escaping
// ---------------------------------------------------------------------------

describe("renderBanners — HTML escaping", () => {
  it("escapes every interpolated value (name / href), never emits raw markup", async () => {
    const c = entry({
      carrier: carrier({
        carrier_name: '<script>alert("xss")</script>',
        click_url: "https://p.example.com/c?a=1&b=2",
      }),
    });
    const out = renderBanners([c], AUCTION, AUTOMATIC, DESIGN, FIXED_ID);
    expect(out.html).not.toContain("<script>");
    expect(out.html).toContain("&lt;script&gt;");
    expect(out.html).toContain("&quot;");
    // the & in the href is entity-escaped in the attribute
    expect(out.html).toContain("a=1&amp;b=2");
  });
});
