// LeadGen Phase 4 — Offer validators (contract 04 §10.1 create-modal fields,
// §10.2 bid kinds, §10.3 client-mode constraints, §10.4 region rules, §10.5
// banner template guard, §10.6 cap fields, §11.8 dynamic-auction publish
// gate). Field-keyed FieldErrors maps per the listicles validation idiom.

import { describe, expect, it } from "vitest";
import {
  LEADGEN_BID_SOURCES,
  LEADGEN_CAP_COUNT_BY,
  LEADGEN_OFFER_TYPES,
  LEADGEN_REGION_DIMENSIONS,
  LEADGEN_RULE_ACTIONS,
  LEADGEN_TRACKING_METHODS,
  dynamicAuctionEligibility,
  isAbsoluteHttpUrl,
  isValidTimezone,
  validateClientModeConstraints,
  validateOfferBannerTemplate,
  validateOfferCapFields,
  validateOfferCreate,
  validateRegionRule,
  validateStaticBidCompleteness,
} from "../src/leadgen/validation";

// A fully-valid §10.1 create-modal payload; tests clone + break one field.
function validCreate(): Record<string, unknown> {
  return {
    offer_name: "Life Direct",
    activity: "quote_funnel",
    vertical: "life",
    conversion_tracking_method: "s2s_postback",
    offer_type: "cpc",
    placements: ["pl_main"],
    calls_provider_api: true,
    bid_source: "response",
    cap_enabled: false,
    tag: "priority",
    provider: "acme-network",
  };
}

describe("enum value sets — DDL CHECK alignment", () => {
  it("carries the exact 0036 CHECK enum sets", () => {
    expect([...LEADGEN_TRACKING_METHODS]).toEqual(["s2s_postback", "browser_side_pixel", "script"]);
    expect([...LEADGEN_OFFER_TYPES]).toEqual(["cpc", "cpl", "cpa", "cpi"]);
    expect([...LEADGEN_BID_SOURCES]).toEqual(["response", "static"]);
    expect([...LEADGEN_CAP_COUNT_BY]).toEqual(["clicks", "conversions"]);
    expect([...LEADGEN_REGION_DIMENSIONS]).toEqual(["country", "state", "city", "zip"]);
    expect([...LEADGEN_RULE_ACTIONS]).toEqual(["include_only", "exclude", "allow_list", "block_list"]);
  });
});

describe("validateOfferCreate — §10.1 create-modal fields", () => {
  it("accepts a complete create payload and returns the typed value", () => {
    const result = validateOfferCreate(validCreate());
    expect(result.errors).toEqual({});
    expect(result.value).not.toBeNull();
    expect(result.value?.offer_name).toBe("Life Direct");
    expect(result.value?.placements).toEqual(["pl_main"]);
    expect(result.value?.calls_provider_api).toBe(true);
    expect(result.value?.tag).toBe("priority");
    expect(result.value?.static_bid_value).toBeNull();
  });

  it("rejects a non-object body", () => {
    const result = validateOfferCreate("nope");
    expect(result.value).toBeNull();
    expect(result.errors.body).toBeDefined();
  });

  it("requires every §10.1 required field", () => {
    for (const field of [
      "offer_name",
      "activity",
      "vertical",
      "conversion_tracking_method",
      "offer_type",
      "placements",
      "calls_provider_api",
      "bid_source",
      "cap_enabled",
    ]) {
      const raw = validCreate();
      delete raw[field];
      const result = validateOfferCreate(raw);
      expect(result.value, field).toBeNull();
      expect(result.errors[field], field).toBeDefined();
    }
  });

  it("rejects out-of-enum tracking method / offer type / bid source", () => {
    expect(
      validateOfferCreate({ ...validCreate(), conversion_tracking_method: "smoke_signal" }).errors[
        "conversion_tracking_method"
      ],
    ).toContain("s2s_postback");
    expect(validateOfferCreate({ ...validCreate(), offer_type: "cpm" }).errors["offer_type"]).toContain("cpc");
    expect(validateOfferCreate({ ...validCreate(), bid_source: "auction" }).errors["bid_source"]).toContain(
      "response",
    );
  });

  it("requires ≥1 placement and rejects blank / duplicate placement ids", () => {
    expect(validateOfferCreate({ ...validCreate(), placements: [] }).errors["placements"]).toBeDefined();
    expect(
      validateOfferCreate({ ...validCreate(), placements: ["pl_main", "  "] }).errors["placements[1]"],
    ).toBeDefined();
    expect(
      validateOfferCreate({ ...validCreate(), placements: ["pl_main", "pl_main"] }).errors["placements[1]"],
    ).toContain("duplicate");
  });

  it("accepts multiple distinct placements", () => {
    const result = validateOfferCreate({ ...validCreate(), placements: ["pl_main", "pl_side"] });
    expect(result.errors).toEqual({});
    expect(result.value?.placements).toEqual(["pl_main", "pl_side"]);
  });

  it("rejects non-boolean toggles", () => {
    expect(validateOfferCreate({ ...validCreate(), calls_provider_api: "yes" }).errors["calls_provider_api"]).toBeDefined();
    expect(validateOfferCreate({ ...validCreate(), cap_enabled: "on" }).errors["cap_enabled"]).toBeDefined();
  });

  it("accepts 0/1 integer toggles (Row-shaped echoes)", () => {
    const result = validateOfferCreate({ ...validCreate(), calls_provider_api: 1, cap_enabled: 0 });
    expect(result.errors).toEqual({});
    expect(result.value?.calls_provider_api).toBe(true);
    expect(result.value?.cap_enabled).toBe(false);
  });

  it("rejects the impossible §10.2 kind: calls_provider_api=0 + bid_source=response", () => {
    const result = validateOfferCreate({
      ...validCreate(),
      calls_provider_api: false,
      bid_source: "response",
    });
    expect(result.errors["bid_source"]).toContain("calls_provider_api");
  });

  it("accepts all three legal §10.2 kinds", () => {
    // CPC dynamic, CPL (request + static bid), pure static.
    for (const kind of [
      { calls_provider_api: true, bid_source: "response" },
      { calls_provider_api: true, bid_source: "static" },
      { calls_provider_api: false, bid_source: "static" },
    ]) {
      expect(validateOfferCreate({ ...validCreate(), ...kind }).errors).toEqual({});
    }
  });

  it("types the optional fields when present", () => {
    expect(validateOfferCreate({ ...validCreate(), tag: 7 }).errors["tag"]).toBeDefined();
    expect(validateOfferCreate({ ...validCreate(), provider: "" }).errors["provider"]).toBeDefined();
    expect(
      validateOfferCreate({ ...validCreate(), static_bid_value: -2 }).errors["static_bid_value"],
    ).toBeDefined();
    expect(
      validateOfferCreate({ ...validCreate(), static_bid_value: "9" }).errors["static_bid_value"],
    ).toBeDefined();
    expect(
      validateOfferCreate({ ...validCreate(), static_bid_currency: "" }).errors["static_bid_currency"],
    ).toBeDefined();
    expect(validateOfferCreate({ ...validCreate(), static_order: 1.5 }).errors["static_order"]).toBeDefined();
    const ok = validateOfferCreate({
      ...validCreate(),
      bid_source: "static",
      static_bid_value: 4.5,
      static_bid_currency: "USD",
      static_order: 2,
    });
    expect(ok.errors).toEqual({});
    expect(ok.value?.static_bid_value).toBe(4.5);
  });
});

describe("validateStaticBidCompleteness — §10.2 go-live gate", () => {
  it("requires bid value + currency for a static-bid Offer", () => {
    const errors = validateStaticBidCompleteness({
      calls_provider_api: 1,
      bid_source: "static",
      static_bid_value: null,
      static_bid_currency: null,
      banner_url_template: null,
    });
    expect(errors["static_bid_value"]).toBeDefined();
    expect(errors["static_bid_currency"]).toBeDefined();
    // CPL (calls API) does not need a banner template — URL is response-derived.
    expect(errors["banner_url_template"]).toBeUndefined();
  });

  it("a PURE static Offer additionally requires banner_url_template", () => {
    const errors = validateStaticBidCompleteness({
      calls_provider_api: 0,
      bid_source: "static",
      static_bid_value: 3,
      static_bid_currency: "USD",
      banner_url_template: null,
    });
    expect(errors).toEqual({
      banner_url_template: "a pure static Offer requires banner_url_template",
    });
  });

  it("passes a complete pure-static Offer and skips response-bid Offers", () => {
    expect(
      validateStaticBidCompleteness({
        calls_provider_api: 0,
        bid_source: "static",
        static_bid_value: 3,
        static_bid_currency: "USD",
        banner_url_template: "https://p.example/offer?c={click_id}",
      }),
    ).toEqual({});
    expect(
      validateStaticBidCompleteness({
        calls_provider_api: 1,
        bid_source: "response",
        static_bid_value: null,
        static_bid_currency: null,
        banner_url_template: null,
      }),
    ).toEqual({});
  });
});

describe("validateOfferBannerTemplate — §10.5 field wrapper", () => {
  it("passes a valid template and absent templates", () => {
    expect(validateOfferBannerTemplate("https://p.example/?c={click_id}&s={response:slug}")).toEqual({});
    expect(validateOfferBannerTemplate(undefined)).toEqual({});
    expect(validateOfferBannerTemplate(null)).toEqual({});
  });

  it("maps typed template errors into the banner_url_template field slot", () => {
    expect(validateOfferBannerTemplate(42)["banner_url_template"]).toBeDefined();
    expect(validateOfferBannerTemplate("/relative?c={click_id}")["banner_url_template"]).toBeDefined();
    expect(validateOfferBannerTemplate("https://p.example/?x={bogus}")["banner_url_template"]).toContain(
      "{bogus}",
    );
  });
});

describe("validateClientModeConstraints — §10.3 typed save-errors", () => {
  const clientOffer = {
    request_execution_mode: "client" as const,
    api_token_secret_ref: null,
    endpoint_production: "https://api.provider.example/quotes",
    endpoint_staging: null,
  };

  it("passes a compliant client-mode Offer (https, no secrets anywhere)", () => {
    expect(
      validateClientModeConstraints(clientOffer, [
        { header_name: "content-type", value_kind: "static" },
        { header_name: "x-click", value_kind: "macro" },
      ]),
    ).toEqual({});
  });

  it("rejects api_token_secret_ref on a client-mode Offer", () => {
    const errors = validateClientModeConstraints(
      { ...clientOffer, api_token_secret_ref: "LEADGEN_PROVIDER_TOKEN_ACME" },
      [],
    );
    expect(errors["api_token_secret_ref"]).toContain("client-mode");
  });

  it("rejects every secret_ref header, keyed per header row", () => {
    const errors = validateClientModeConstraints(clientOffer, [
      { header_name: "authorization", value_kind: "secret_ref" },
      { header_name: "content-type", value_kind: "static" },
      { header_name: "x-api-key", value_kind: "secret_ref" },
    ]);
    expect(errors["headers[0].value_kind"]).toContain("authorization");
    expect(errors["headers[2].value_kind"]).toContain("x-api-key");
    expect(errors["headers[1].value_kind"]).toBeUndefined();
  });

  it("requires https endpoints (production AND staging when present)", () => {
    expect(
      validateClientModeConstraints(
        { ...clientOffer, endpoint_production: "http://api.provider.example/quotes" },
        [],
      )["endpoint_production"],
    ).toContain("https");
    expect(
      validateClientModeConstraints(
        { ...clientOffer, endpoint_staging: "http://staging.provider.example/quotes" },
        [],
      )["endpoint_staging"],
    ).toContain("https");
  });

  it("server-mode Offers skip every client-mode check", () => {
    expect(
      validateClientModeConstraints(
        {
          request_execution_mode: "server",
          api_token_secret_ref: "LEADGEN_PROVIDER_TOKEN_ACME",
          endpoint_production: "http://internal.example/x",
          endpoint_staging: null,
        },
        [{ header_name: "authorization", value_kind: "secret_ref" }],
      ),
    ).toEqual({});
  });
});

describe("validateRegionRule — §10.4", () => {
  it("accepts every dimension × action combination from the DDL CHECKs (dimension-valid values — D3)", () => {
    // D3 (07 §7.5): values must now be valid FOR THE DIMENSION (zip = 5 digits,
    // country/state = 2-letter codes), so this uses per-dimension valid tokens.
    const validValues: Record<string, string[]> = {
      country: ["US", "CA"],
      state: ["CA", "NY"],
      city: ["Los Angeles", "Austin"],
      zip: ["90210", "10001"],
    };
    for (const dimension of LEADGEN_REGION_DIMENSIONS) {
      for (const action of LEADGEN_RULE_ACTIONS) {
        const result = validateRegionRule({ dimension, action, values: validValues[dimension] });
        expect(result.errors, `${dimension}×${action}`).toEqual({});
        expect(result.value?.dimension).toBe(dimension);
        expect(result.value?.action).toBe(action);
        expect(result.value?.priority).toBe(100); // DDL default
        expect(result.value?.enabled).toBe(true); // DDL default
      }
    }
  });

  it("D3 (07 §7.5): per-dimension value validators — bad zip/country/state rejected with region_value_invalid", () => {
    const zipBad = validateRegionRule({ dimension: "zip", action: "exclude", values: ["not-a-zip"] });
    expect(zipBad.errors["values_json[0]"]).toContain("region_value_invalid");
    expect(zipBad.value).toBeNull();
    expect(validateRegionRule({ dimension: "zip", action: "exclude", values: ["9021"] }).errors["values_json[0]"]).toContain(
      "region_value_invalid",
    );
    expect(validateRegionRule({ dimension: "country", action: "exclude", values: ["USA"] }).errors["values_json[0]"]).toContain(
      "region_value_invalid",
    );
    expect(validateRegionRule({ dimension: "state", action: "exclude", values: ["California"] }).errors["values_json[0]"]).toContain(
      "region_value_invalid",
    );
    // paste-multiple: the VALID token survives the collection, the invalid one is rejected per-index
    const mixed = validateRegionRule({ dimension: "zip", action: "exclude", values: ["90210", "bad"] });
    expect(mixed.errors["values_json[1]"]).toContain("region_value_invalid");
    // city is free text — anything non-empty is accepted
    expect(validateRegionRule({ dimension: "city", action: "exclude", values: ["Any City"] }).errors).toEqual({});
  });

  it("rejects out-of-enum dimension and action", () => {
    expect(
      validateRegionRule({ dimension: "continent", action: "exclude", values: ["EU"] }).errors["dimension"],
    ).toBeDefined();
    expect(
      validateRegionRule({ dimension: "state", action: "deny", values: ["CA"] }).errors["action"],
    ).toBeDefined();
  });

  it("requires values to be a non-empty array of non-empty strings", () => {
    expect(validateRegionRule({ dimension: "state", action: "exclude" }).errors["values_json"]).toBeDefined();
    expect(
      validateRegionRule({ dimension: "state", action: "exclude", values: [] }).errors["values_json"],
    ).toBeDefined();
    expect(
      validateRegionRule({ dimension: "state", action: "exclude", values: "CA" as unknown as string[] })
        .errors["values_json"],
    ).toBeDefined();
    expect(
      validateRegionRule({ dimension: "state", action: "exclude", values: ["CA", 7] }).errors["values_json[1]"],
    ).toBeDefined();
    expect(
      validateRegionRule({ dimension: "state", action: "exclude", values: ["CA", " "] }).errors["values_json[1]"],
    ).toBeDefined();
  });

  it("accepts a raw values_json string and rejects broken JSON", () => {
    const ok = validateRegionRule({ dimension: "zip", action: "include_only", values_json: '["90210"]' });
    expect(ok.errors).toEqual({});
    expect(ok.value?.values).toEqual(["90210"]);
    expect(
      validateRegionRule({ dimension: "zip", action: "include_only", values_json: "not json" }).errors[
        "values_json"
      ],
    ).toBeDefined();
  });

  it("types priority and enabled when present", () => {
    expect(
      validateRegionRule({ dimension: "state", action: "exclude", values: ["CA"], priority: 1.5 }).errors[
        "priority"
      ],
    ).toBeDefined();
    expect(
      validateRegionRule({ dimension: "state", action: "exclude", values: ["CA"], enabled: "yes" }).errors[
        "enabled"
      ],
    ).toBeDefined();
    const ok = validateRegionRule({
      dimension: "state",
      action: "exclude",
      values: ["CA"],
      priority: 5,
      enabled: 0,
    });
    expect(ok.errors).toEqual({});
    expect(ok.value?.priority).toBe(5);
    expect(ok.value?.enabled).toBe(false);
  });
});

describe("validateOfferCapFields — §10.6", () => {
  const enabledCap = {
    cap_enabled: true,
    cap_amount: 100,
    cap_timezone: "America/New_York",
    cap_count_by: "clicks",
  };

  it("accepts a complete enabled cap", () => {
    expect(validateOfferCapFields(enabledCap)).toEqual({});
  });

  it("cap_enabled ⇒ requires cap_amount > 0 (integer), cap_timezone, cap_count_by", () => {
    expect(validateOfferCapFields({ ...enabledCap, cap_amount: undefined })["cap_amount"]).toBeDefined();
    expect(validateOfferCapFields({ ...enabledCap, cap_amount: 0 })["cap_amount"]).toBeDefined();
    expect(validateOfferCapFields({ ...enabledCap, cap_amount: -5 })["cap_amount"]).toBeDefined();
    expect(validateOfferCapFields({ ...enabledCap, cap_amount: 10.5 })["cap_amount"]).toBeDefined();
    expect(validateOfferCapFields({ ...enabledCap, cap_timezone: undefined })["cap_timezone"]).toBeDefined();
    expect(
      validateOfferCapFields({ ...enabledCap, cap_timezone: "Mars/Olympus" })["cap_timezone"],
    ).toContain("IANA");
    expect(validateOfferCapFields({ ...enabledCap, cap_count_by: undefined })["cap_count_by"]).toBeDefined();
    expect(validateOfferCapFields({ ...enabledCap, cap_count_by: "views" })["cap_count_by"]).toContain(
      "clicks|conversions",
    );
  });

  it("accepts cap_count_by conversions", () => {
    expect(validateOfferCapFields({ ...enabledCap, cap_count_by: "conversions" })).toEqual({});
  });

  it("a disabled cap requires nothing", () => {
    expect(validateOfferCapFields({ cap_enabled: false })).toEqual({});
    expect(validateOfferCapFields({ cap_enabled: 0 })).toEqual({});
  });

  it("types the fallbacks when present (either way)", () => {
    expect(
      validateOfferCapFields({ cap_enabled: false, cap_fallback_offer_id: 0 })["cap_fallback_offer_id"],
    ).toBeDefined();
    expect(
      validateOfferCapFields({ cap_enabled: false, cap_fallback_offer_id: "seven" })["cap_fallback_offer_id"],
    ).toBeDefined();
    expect(
      validateOfferCapFields({ cap_enabled: false, cap_fallback_url: "not-a-url" })["cap_fallback_url"],
    ).toBeDefined();
    expect(
      validateOfferCapFields({ cap_enabled: false, cap_fallback_url: "javascript:alert(1)" })[
        "cap_fallback_url"
      ],
    ).toBeDefined();
    expect(
      validateOfferCapFields({
        ...enabledCap,
        cap_fallback_offer_id: 7,
        cap_fallback_url: "https://fallback.example/offer",
      }),
    ).toEqual({});
  });

  it("isValidTimezone / isAbsoluteHttpUrl helpers behave", () => {
    expect(isValidTimezone("UTC")).toBe(true);
    expect(isValidTimezone("America/New_York")).toBe(true);
    expect(isValidTimezone("Nowhere/Fake")).toBe(false);
    expect(isAbsoluteHttpUrl("https://x.example/a")).toBe(true);
    expect(isAbsoluteHttpUrl("http://x.example/a")).toBe(true);
    expect(isAbsoluteHttpUrl("http://x.example/a", true)).toBe(false); // httpsOnly
    expect(isAbsoluteHttpUrl("ftp://x.example/a")).toBe(false);
    expect(isAbsoluteHttpUrl("/relative")).toBe(false);
  });
});

describe("dynamicAuctionEligibility — §11.8 publish gate", () => {
  const okSchema = { ok: true, errors: [] };
  const badSchema = {
    ok: false,
    errors: [{ code: "path_duplicate" as const, message: "duplicate path 'x'" }],
  };

  it("a provider-calling Offer with a valid schema and a passed Test is eligible", () => {
    expect(dynamicAuctionEligibility({ calls_provider_api: 1 }, okSchema, "passed")).toEqual({
      eligible: true,
      reasons: [],
    });
  });

  it("no active schema blocks", () => {
    expect(dynamicAuctionEligibility({ calls_provider_api: 1 }, null, "passed")).toEqual({
      eligible: false,
      reasons: ["no_active_schema"],
    });
  });

  it("schema validation errors block", () => {
    expect(dynamicAuctionEligibility({ calls_provider_api: 1 }, badSchema, "passed")).toEqual({
      eligible: false,
      reasons: ["schema_validation_errors"],
    });
  });

  it("an untested or failed Test status blocks", () => {
    expect(dynamicAuctionEligibility({ calls_provider_api: 1 }, okSchema, "untested").reasons).toEqual([
      "test_untested",
    ]);
    expect(dynamicAuctionEligibility({ calls_provider_api: 1 }, okSchema, null).reasons).toEqual([
      "test_untested",
    ]);
    expect(dynamicAuctionEligibility({ calls_provider_api: 1 }, okSchema, "failed").reasons).toEqual([
      "test_failed",
    ]);
  });

  it("reasons accumulate (bad schema + failed test)", () => {
    expect(dynamicAuctionEligibility({ calls_provider_api: true }, badSchema, "failed").reasons).toEqual([
      "schema_validation_errors",
      "test_failed",
    ]);
  });

  it("an Offer that never calls a provider is outside the gate", () => {
    expect(dynamicAuctionEligibility({ calls_provider_api: 0 }, null, null)).toEqual({
      eligible: true,
      reasons: [],
    });
    expect(dynamicAuctionEligibility({ calls_provider_api: false }, null, null).eligible).toBe(true);
  });
});
