// OWNER 2026-09-15: "here is a funnel that we built -
// https://moneylantern.com/lg/business-loans . the offers in this funnel are CPL
// offers - we are sending request to the offer, and if the offer is responding-
// we should show the banner to the user. I tested it and never see results even
// though the offer is responding."
//
// MEASURED ON HIS LIVE FUNNEL, not inferred. A full drive of
// moneylantern.com/lg/business-loans (8 steps, all answered) produced
// auction_instance 01M2JJ0RYF4B8SK488GQZ715GJ at 2026-09-15 12:52 UTC:
//
//   POST /lg/auction -> 200
//   {"status":"no_bid","banners":[],"banners_html":"<div class=\"lg-banners\"…></div>",
//    "unfilled_reason":"carriers_unparsed","unfilled":true}
//
// and in leadgen_provider_request_log (row 210), the offer that "is responding":
//
//   offer            lgo_01KY1ZZ1H28G54TW2BKXRJX6GX  ("Fundera - Tier 1")
//   status_code      200        latency_ms 206
//   parsed_carriers  []
//   error            carrier_key_underivable: carrier has no provider id and
//                    no sluggable carrier_name
//
// THE OFFER'S MODE IS THE POINT. leadgen_offers row 5 is
// calls_provider_api=1 AND bid_source='static' — 04 §10.2's third mode, the
// admin's "Provider request · static bid (CPL)". It POSTs the lead and gets an
// ACCEPT/REJECT back; there is no carrier list in that answer, so identity,
// brand, logo and copy can only come from config. His stored carrier_parse_json
// (schema v21, verbatim below) says exactly that: provider_id "1050",
// carrier_name "Fundera", a logo URL, a headline, a subheadline — and the one
// per-lead value as a macro, click_url "{response:matches.registration_url}".
//
// parseProviderResponse reads EVERY field as a dotted path INTO a carrier item.
// "1050" meant item["1050"]; "Fundera" meant item.Fundera. Every one resolved
// undefined, so the carrier had no identity and was dropped — including on
// Fundera's own SUCCESS body, which carries a real referral URL. The CPL mode
// had no parser at all.
//
// These tests run the REAL parsers and the REAL banner renderer over the REAL
// stored config and the REAL provider bodies (both persisted in production:
// the success body is the sample_response_json on schema v10 of this same
// offer; the reject body is response_redacted_json on provider-log row 210,
// whose "sha256:616c01fb…" preimage is the literal string "is required").

import { describe, expect, it } from "vitest";
import {
  parseProviderResponse,
  parseStaticBidProviderResponse,
  type LeadgenParsedCarrier,
} from "../src/public/leadgen/auction/parse";
import { renderBanners } from "../src/public/leadgen/auction/banner";
import { getBannerDesign } from "../src/public/leadgen/designs/registry";
import { LEADGEN_UNFILLED_REASONS } from "../src/leadgen/auction-core";

// ---------------------------------------------------------------------------
// Production artefacts, verbatim
// ---------------------------------------------------------------------------

// leadgen_offer_payload_schemas id 139 (offer_id 5, version 21) carrier_parse_json.
const HIS_STORED_CPL_CONFIG = {
  fields: {
    provider_id: "1050",
    carrier_name: "Fundera",
    carrier_logo: "https://moneylantern.com/media/2026/08/18/811ac6c8-8f49-43a4-b06d-2ffbdcd14aee.png",
    bid_currency: "usd",
    click_url: "{response:matches.registration_url}",
    headline: "It's a Match!",
    subheadline: "A rep will be in touch. You can start your application in the meantime.",
  },
};

// sample_response_json persisted on schema v10 of the same offer — Fundera
// ACCEPTING a lead, with the referral URL the banner is supposed to link to.
const FUNDERA_ACCEPTED = JSON.stringify({
  success: true,
  matches: {
    count: 4,
    product_types: ["Short-Term Loan", "SBA Loan", "Equipment Financing", "Merchant Cash Advance"],
    registration_url: "https://www.fundera.com/referral/560b178e44453357618d9eddca7b2d40",
    uuid: "682de0b9-dd73-4054-ab01-480c0f113dfd",
  },
});

// leadgen_provider_request_log row 210, response_redacted_json — Fundera
// DECLINING, because the funnel sends no owners[0].email (the redactor SHA-256s
// values under a key named "email"; the preimage of that digest is "is required").
const FUNDERA_DECLINED = JSON.stringify({
  success: false,
  errors: { owners: { 0: { email: "is required" } } },
});

// The Offer's own synthesized static carrier (engine.ts staticCarrier over
// leadgen_offers row 5: static_bid_value 1, no static_fallback_banner_url,
// provider NULL so the name falls back to offer_name).
const OFFER_STATIC_CARRIER: LeadgenParsedCarrier = {
  carrier_key: "fundera-tier-1",
  carrier_key_source: "slug",
  carrier_name: "Fundera - Tier 1",
  carrier_logo: null,
  bid: 1,
  bid_currency: null,
  click_url: null,
  tracking_id: null,
  headline: null,
  subheadline: null,
  disclaimer: null,
  pricing_model: "static",
};

describe("CPL (request_static_bid) — the defect this fixes", () => {
  // FAIL-BEFORE, pinned: the CPC carrier-list parser on this config produces
  // nothing even from an ACCEPTED lead. This is the state the live funnel was
  // in; it is asserted so a regression back to that routing is loud.
  it("the CPC carrier-list parser drops his CPL carrier even on an ACCEPTED lead", () => {
    const parsed = parseProviderResponse(HIS_STORED_CPL_CONFIG, FUNDERA_ACCEPTED);
    expect(parsed.carriers).toEqual([]);
    expect(parsed.errors.map((e) => e.code)).toContain("carrier_key_underivable");
  });
});

describe("CPL (request_static_bid) — parseStaticBidProviderResponse", () => {
  it("an ACCEPTED lead yields one carrier: constants from config, the URL from the answer", () => {
    const parsed = parseStaticBidProviderResponse(
      HIS_STORED_CPL_CONFIG,
      FUNDERA_ACCEPTED,
      OFFER_STATIC_CARRIER,
    );
    expect(parsed.errors).toEqual([]);
    expect(parsed.carriers.length).toBe(1);
    const c = parsed.carriers[0]!;
    // Identity from the authored constant, not from a path lookup.
    expect(c.carrier_key).toBe("1050");
    expect(c.carrier_key_source).toBe("provider_id");
    expect(c.carrier_name).toBe("Fundera");
    expect(c.carrier_logo).toBe(HIS_STORED_CPL_CONFIG.fields.carrier_logo);
    expect(c.headline).toBe("It's a Match!");
    expect(c.subheadline).toBe(HIS_STORED_CPL_CONFIG.fields.subheadline);
    expect(c.bid_currency).toBe("usd");
    // The ONE per-lead value, read out of the response by the macro.
    expect(c.click_url).toBe("https://www.fundera.com/referral/560b178e44453357618d9eddca7b2d40");
    // bid_source='static': the bid is the Offer's, never the provider's.
    expect(c.bid).toBe(1);
  });

  it("a DECLINED lead still mints the carrier, but with no destination", () => {
    const parsed = parseStaticBidProviderResponse(
      HIS_STORED_CPL_CONFIG,
      FUNDERA_DECLINED,
      OFFER_STATIC_CARRIER,
    );
    expect(parsed.errors).toEqual([]);
    expect(parsed.carriers.length).toBe(1);
    // The constants still resolve — only the {response:…} macro has nothing to
    // read, which is what "the provider did not accept this lead" looks like.
    expect(parsed.carriers[0]!.carrier_key).toBe("1050");
    expect(parsed.carriers[0]!.click_url).toBeNull();
  });

  it("identity is never underivable — the Offer's own key is the last resort", () => {
    const parsed = parseStaticBidProviderResponse(
      { fields: { click_url: "{response:matches.registration_url}" } },
      FUNDERA_ACCEPTED,
      OFFER_STATIC_CARRIER,
    );
    expect(parsed.carriers.length).toBe(1);
    expect(parsed.carriers[0]!.carrier_key).toBe("fundera-tier-1");
    expect(parsed.errors.map((e) => e.code)).not.toContain("carrier_key_underivable");
  });

  it("a {response:…} field wins over a constant fallback written after it", () => {
    const parsed = parseStaticBidProviderResponse(
      { fields: { provider_id: "1050", carrier_name: ["{response:matches.brand}", "Fundera"] } },
      JSON.stringify({ matches: { brand: "Fundera Marketplace" } }),
      OFFER_STATIC_CARRIER,
    );
    expect(parsed.carriers[0]!.carrier_name).toBe("Fundera Marketplace");
  });

  it("a non-JSON 200 still yields the carrier (constants need no response) and records the fact", () => {
    const parsed = parseStaticBidProviderResponse(
      HIS_STORED_CPL_CONFIG,
      "<html>accepted</html>",
      OFFER_STATIC_CARRIER,
    );
    expect(parsed.carriers.length).toBe(1);
    expect(parsed.carriers[0]!.carrier_name).toBe("Fundera");
    expect(parsed.carriers[0]!.click_url).toBeNull();
    expect(parsed.errors.map((e) => e.code)).toEqual(["invalid_json"]);
  });

  it("a config with no fields map is a typed response error, never a throw", () => {
    const parsed = parseStaticBidProviderResponse(null, FUNDERA_ACCEPTED, OFFER_STATIC_CARRIER);
    expect(parsed.carriers).toEqual([]);
    expect(parsed.errors.map((e) => e.code)).toEqual(["config_invalid"]);
  });
});

// ---------------------------------------------------------------------------
// Through the REAL banner renderer — the half that decides "is there a banner"
// ---------------------------------------------------------------------------

function render(carrier: LeadgenParsedCarrier, responseContext: unknown) {
  return renderBanners(
    [
      {
        carrier,
        offer_public_id: "lgo_01KY1ZZ1H28G54TW2BKXRJX6GX",
        slot: 1,
        source: "static_bid",
        bid: 1,
        banner_url_template: null, // leadgen_offers row 5 carries none
        response_context: responseContext,
      },
    ],
    { auction_instance_id: "01M2JJ0RYF4B8SK488GQZ715GJ", banner_design_id: "default", funnel_attempt_id: "att_x" },
    { mode: "automatic" },
    getBannerDesign("default"),
  );
}

describe("CPL (request_static_bid) — what the user actually sees", () => {
  it("ACCEPTED: a banner slot renders, carrying the configured brand and copy", () => {
    const parsed = parseStaticBidProviderResponse(
      HIS_STORED_CPL_CONFIG,
      FUNDERA_ACCEPTED,
      OFFER_STATIC_CARRIER,
    );
    const out = render(parsed.carriers[0]!, JSON.parse(FUNDERA_ACCEPTED));
    expect(out.dropped).toEqual([]);
    expect(out.slots.length).toBe(1);
    expect(out.slots[0]!.carrier_key).toBe("1050");
    expect(out.html).toContain("Fundera");
    expect(out.html).toContain("It&#39;s a Match!");
    // The rendered href is the GOVERNED click route, never the raw provider URL.
    expect(out.slots[0]!.click_url).toBe(
      "https://www.fundera.com/referral/560b178e44453357618d9eddca7b2d40",
    );
  });

  it("DECLINED: no banner, and the drop reason names the missing destination", () => {
    const parsed = parseStaticBidProviderResponse(
      HIS_STORED_CPL_CONFIG,
      FUNDERA_DECLINED,
      OFFER_STATIC_CARRIER,
    );
    const out = render(parsed.carriers[0]!, JSON.parse(FUNDERA_DECLINED));
    expect(out.slots).toEqual([]);
    expect(out.dropped.map((d) => d.carrier_filtered_reason)).toEqual(["missing_click_url"]);
  });
});

describe("the unfilled_reason vocabulary", () => {
  it("can say that carriers were dropped at render", () => {
    // Without this value a declined CPL lead reported "all_carriers_shown" on a
    // session that had never been shown anything — the 2026-08-27 lie, one
    // layer later (see leadgen-auction-empty-page.test.ts).
    expect(LEADGEN_UNFILLED_REASONS).toContain("carriers_dropped_at_render");
    expect(LEADGEN_UNFILLED_REASONS).toContain("all_carriers_shown");
    expect(LEADGEN_UNFILLED_REASONS).toContain("carriers_unparsed");
    expect(LEADGEN_UNFILLED_REASONS).toContain("no_carriers_returned");
  });
});
