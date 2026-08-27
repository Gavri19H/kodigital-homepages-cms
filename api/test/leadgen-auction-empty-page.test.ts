// OWNER 2026-08-27: "https://insurissimo.com/lg/home-insurance - I finished to
// build this funnel, clicked it to the end of the funnel, and the auction wasn't
// running - I got to an empty page"
//
// DIAGNOSED FROM HIS OWN ATTEMPT, not from a repro: auction_instance
// 01M11ESQ5TQ36KDCXFV8746XPP (2026-08-27 11:13 UTC) in
// leadgen_auction_result_log, with its two rows in
// leadgen_provider_request_log. What they showed:
//
//   * both offers considered, offers_excluded_json [] — nothing was filtered
//   * AdsByMoneyHome: HTTP 200, {"success":true,"data":[]} — genuinely no
//     listings. Not our bug.
//   * QuinStreetHome: HTTP 200, numListingsReturned "1", a listing with
//     cpc "32.50" and a real clickurl … and parsed_carriers_json []
//   * provider_error_reason NULL, error_text NULL — no reason recorded anywhere
//   * unfilled_reason "all_carriers_shown", on a session that had never been
//     shown anything
//
// THREE FAULTS, all pinned below:
//   1. his carrier_parse field paths are the BANNER-URL macro form
//      `{response:a.b.c}` (the payload builder hands those out as copyable
//      chips) while this parser has always wanted a bare dotted path — so every
//      field resolved to undefined and the carrier was dropped for having no
//      identity. A real $32.50 bid, silently discarded.
//   2. the engine threw parseResult.errors away, so the drop left no trace.
//   3. the unfilled_reason vocabulary had ONE value, defaulted to for every
//      empty outcome — so the one line of diagnosis the product offered was
//      false.
import { describe, expect, it } from "vitest";
import { parseProviderResponse, unwrapResponseMacro } from "../src/public/leadgen/auction/parse";
import { LEADGEN_UNFILLED_REASONS } from "../src/leadgen/auction-core";

// The bytes QuinStreet actually returned him (redacted copy from D1).
const QUINSTREET_RESPONSE = {
  response: {
    listingset: {
      Date: "8/27/2026 4:13:35 AM",
      numListingsReturned: "1",
      searchid: "6b8226d6-4dac-46b2-8848-254c34658bc6",
      statecode: "PA",
      listing: [
        {
          rank: "1",
          cpc: "32.50",
          vendorKey: 1524940,
          vendorServiceKey: 15640310,
          title: "Home insurance protects your home & belongings",
          description: "<ul><li>Provides financial protection for your home</li></ul>",
          clickurl: "https://www.nextinsure.com/ListingDisplay/Click/?I=YWUwNGFiYjE",
        },
      ],
    },
  },
};

// His stored carrier_parse_json, verbatim from production (offer 8, schema v12).
const HIS_STORED_CONFIG = {
  fields: {
    provider_id: "{response:response.listingset.listing.0.company}",
    carrier_name: "{response:response.listingset.listing.0.displayname}",
    carrier_logo: "{response:response.listingset.listing.0.logo}",
    bid: "{response:response.listingset.listing.0.cpc}",
    bid_currency: "{response:response.listingset.listing.0.usd}",
    click_url: "{response:response.listingset.listing.0.clickurl}",
    tracking_id: "{response:response.listingset.searchid}",
    headline: "{response:response.listingset.listing.0.title}",
    subheadline: "{response:response.listingset.listing.0.description}",
  },
};

describe("FAULT 1 — the {response:…} macro form never resolved (owner 2026-08-27)", () => {
  it("unwraps the banner-URL macro form, and leaves a bare path exactly as it is", () => {
    expect(unwrapResponseMacro("{response:response.listingset.listing.0.cpc}")).toBe(
      "response.listingset.listing.0.cpc",
    );
    // the optional marker the banner template allows
    expect(unwrapResponseMacro("{response:a.b?}")).toBe("a.b");
    // a bare path is untouched — the wrapper is stripped ONLY when the whole
    // token is exactly {response:…}, so no existing config changes meaning
    expect(unwrapResponseMacro("response.listingset.listing.0.cpc")).toBe(
      "response.listingset.listing.0.cpc",
    );
    for (const notAMacro of ["", "a.b.c", "{other:a.b}", "prefix{response:a.b}", "{response:a.b}suffix"]) {
      expect(unwrapResponseMacro(notAMacro), notAMacro).toBe(notAMacro);
    }
  });

  it("his stored config now RESOLVES its fields — the bid and click URL come back", () => {
    // The identity fields still name keys QuinStreet does not send (his own
    // config, his to change), so the carrier is still dropped — but everything
    // the macro form had made invisible now resolves, which is the product half.
    const r = parseProviderResponse(HIS_STORED_CONFIG, QUINSTREET_RESPONSE);
    expect(r.errors.some((e) => e.code === "carrier_key_underivable")).toBe(true);
    // …and with the two identity paths corrected, the $32.50 bid is recovered.
    const corrected = {
      fields: {
        ...HIS_STORED_CONFIG.fields,
        provider_id: "{response:response.listingset.listing.0.vendorKey}",
        carrier_name: "{response:response.listingset.listing.0.title}",
      },
    };
    const fixed = parseProviderResponse(corrected, QUINSTREET_RESPONSE);
    expect(fixed.errors).toEqual([]);
    expect(fixed.carriers).toHaveLength(1);
    const c = fixed.carriers[0]!;
    expect(c.carrier_key).toBe("1524940");
    expect(c.bid).toBe(32.5);
    expect(c.click_url).toContain("nextinsure.com/ListingDisplay/Click");
    expect(c.headline).toContain("Home insurance protects your home");
  });

  it("the SAME config in bare-path form parses identically — one meaning, two spellings", () => {
    const bare = {
      fields: {
        provider_id: "response.listingset.listing.0.vendorKey",
        carrier_name: "response.listingset.listing.0.title",
        bid: "response.listingset.listing.0.cpc",
        click_url: "response.listingset.listing.0.clickurl",
        tracking_id: "response.listingset.searchid",
      },
    };
    const macro = {
      fields: Object.fromEntries(
        Object.entries(bare.fields).map(([k, v]) => [k, `{response:${v}}`]),
      ),
    };
    const a = parseProviderResponse(bare, QUINSTREET_RESPONSE);
    const b = parseProviderResponse(macro, QUINSTREET_RESPONSE);
    expect(a.carriers).toHaveLength(1);
    expect(JSON.stringify(b.carriers)).toBe(JSON.stringify(a.carriers));
  });

  it("carriers_path gets the same tolerance — an operator who macro'd one field macro'd them all", () => {
    const cfg = {
      carriers_path: "{response:response.listingset.listing}",
      fields: {
        provider_id: "vendorKey",
        carrier_name: "title",
        bid: "cpc",
        click_url: "clickurl",
      },
    };
    const r = parseProviderResponse(cfg, QUINSTREET_RESPONSE);
    expect(r.carriers).toHaveLength(1);
    expect(r.carriers[0]!.bid).toBe(32.5);
  });

  it("AdsByMoneyHome's empty answer stays empty — a provider with nothing to offer is not a bug", () => {
    const r = parseProviderResponse(
      { carriers_path: "data", fields: { provider_id: "id", bid: "cpc" } },
      { success: true, data: [] },
    );
    expect(r.carriers).toEqual([]);
    // no carriers, and no error blaming us for it
    expect(r.errors).toEqual([]);
  });
});

describe("FAULT 3 — the unfilled reason has to be able to tell the truth", () => {
  it("there is more than one reason, and each names a different operator action", () => {
    // ONE value meant every empty auction claimed the pool was exhausted.
    expect(LEADGEN_UNFILLED_REASONS.length).toBeGreaterThan(1);
    expect(LEADGEN_UNFILLED_REASONS).toContain("all_carriers_shown");
    expect(LEADGEN_UNFILLED_REASONS).toContain("carriers_unparsed");
    expect(LEADGEN_UNFILLED_REASONS).toContain("no_carriers_returned");
  });
});
