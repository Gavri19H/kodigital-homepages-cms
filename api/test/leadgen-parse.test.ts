// LeadGen Phase 4 — provider response parsing → canonical Carrier (contract
// 04 §11.7 field set + 07 §18.8 carrier identity). parseProviderResponse
// NEVER throws: malformed input yields typed whole-response and per-carrier
// errors (feeding malformed_response_rate) while healthy carriers survive
// partial failure.

import { describe, expect, it } from "vitest";
import {
  getAtPath,
  parseProviderResponse,
  sha256Hex,
  slugifyCarrierName,
  type LeadgenCarrierParseConfig,
} from "../src/public/leadgen/auction/parse";

// A representative parse config: carriers under data.quotes, multi-source
// fallback for the logo, provider_id feeding carrier_key.
function fullConfig(): LeadgenCarrierParseConfig {
  return {
    carriers_path: "data.quotes",
    fields: {
      provider_id: "id",
      carrier_name: "carrier.name",
      carrier_logo: ["carrier.logo_url", "carrier.image"],
      bid: "cpc",
      bid_currency: "currency",
      click_url: "url",
      tracking_id: "tid",
      headline: "title",
      subheadline: "subtitle",
      disclaimer: "legal",
      pricing_model: "model",
    },
  };
}

function carrierItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "prov-123",
    carrier: { name: "Acme Life", logo_url: "https://cdn.example/acme.png" },
    cpc: 12.5,
    currency: "USD",
    url: "https://buy.example/acme?tid=1",
    tid: "trk-9",
    title: "Great coverage",
    subtitle: "From $12/mo",
    legal: "Terms apply",
    model: "cpc",
    ...overrides,
  };
}

describe("parseProviderResponse — canonical Carrier shape (04 §11.7)", () => {
  it("maps every canonical field from a happy-path carriers array", () => {
    const result = parseProviderResponse(fullConfig(), {
      data: { quotes: [carrierItem()] },
    });
    expect(result.errors).toEqual([]);
    expect(result.carriers).toHaveLength(1);
    // The full 04 §11.7 normative field list, plus the §18.8 identity marker.
    expect(result.carriers[0]).toEqual({
      carrier_key: "prov-123",
      carrier_key_source: "provider_id",
      carrier_name: "Acme Life",
      carrier_logo: "https://cdn.example/acme.png",
      bid: 12.5,
      bid_currency: "USD",
      click_url: "https://buy.example/acme?tid=1",
      tracking_id: "trk-9",
      headline: "Great coverage",
      subheadline: "From $12/mo",
      disclaimer: "Terms apply",
      pricing_model: "cpc",
    });
  });

  it("accepts a raw JSON STRING body and parses it", () => {
    const body = JSON.stringify({ data: { quotes: [carrierItem()] } });
    const result = parseProviderResponse(fullConfig(), body);
    expect(result.errors).toEqual([]);
    expect(result.carriers[0]?.carrier_key).toBe("prov-123");
  });

  it("treats a single carrier OBJECT at carriers_path as a one-carrier array", () => {
    const config: LeadgenCarrierParseConfig = {
      carriers_path: "quote",
      fields: { carrier_name: "name", bid: "bid" },
    };
    const result = parseProviderResponse(config, { quote: { name: "Solo Co", bid: 3 } });
    expect(result.errors).toEqual([]);
    expect(result.carriers).toEqual([
      expect.objectContaining({ carrier_key: "solo-co", carrier_key_source: "slug", bid: 3 }),
    ]);
  });

  it("parses carriers at the response ROOT when carriers_path is empty/absent", () => {
    const config: LeadgenCarrierParseConfig = { fields: { carrier_name: "name", bid: "bid" } };
    const result = parseProviderResponse(config, [{ name: "Root Co", bid: 1 }]);
    expect(result.errors).toEqual([]);
    expect(result.carriers[0]?.carrier_key).toBe("root-co");
  });

  it("multi-source field fallback: the first resolving path wins", () => {
    const result = parseProviderResponse(fullConfig(), {
      data: { quotes: [carrierItem({ carrier: { name: "Acme", image: "https://cdn.example/alt.png" } })] },
    });
    expect(result.carriers[0]?.carrier_logo).toBe("https://cdn.example/alt.png");
  });

  it("missing optional fields resolve null without errors", () => {
    const config: LeadgenCarrierParseConfig = {
      carriers_path: "",
      fields: { carrier_name: "name", bid: "bid", headline: "title" },
    };
    const result = parseProviderResponse(config, [{ name: "Bare Co", bid: 2 }]);
    expect(result.errors).toEqual([]);
    expect(result.carriers[0]).toEqual(
      expect.objectContaining({
        carrier_name: "Bare Co",
        headline: null,
        click_url: null,
        pricing_model: null,
      }),
    );
  });
});

describe("carrier_key derivation — 07 §18.8 (normative)", () => {
  it("prefers the provider-supplied stable id (numeric ids stringify)", () => {
    const config: LeadgenCarrierParseConfig = {
      carriers_path: "",
      fields: { provider_id: "pid", carrier_name: "name" },
    };
    const result = parseProviderResponse(config, [{ pid: 987, name: "Acme Life" }]);
    expect(result.carriers[0]?.carrier_key).toBe("987");
    expect(result.carriers[0]?.carrier_key_source).toBe("provider_id");
  });

  it("slugs the carrier_name when no provider id exists (lowercase, trim, non-alnum→-)", () => {
    expect(slugifyCarrierName("  Acme Life & Casualty!  ")).toBe("acme-life-casualty");
    expect(slugifyCarrierName("UPPER")).toBe("upper");
    expect(slugifyCarrierName("a--b__c")).toBe("a-b-c");
    const config: LeadgenCarrierParseConfig = { carriers_path: "", fields: { carrier_name: "name" } };
    const result = parseProviderResponse(config, [{ name: "  Acme Life & Casualty!  " }]);
    expect(result.carriers[0]?.carrier_key).toBe("acme-life-casualty");
    expect(result.carriers[0]?.carrier_key_source).toBe("slug");
  });

  it("disambiguates colliding slugs with the first-8 hex of SHA-256(logo_url)", () => {
    const config: LeadgenCarrierParseConfig = {
      carriers_path: "",
      fields: { carrier_name: "name", carrier_logo: "logo" },
    };
    const logoA = "https://cdn.example/acme-a.png";
    const logoB = "https://cdn.example/acme-b.png";
    const result = parseProviderResponse(config, [
      { name: "Acme", logo: logoA },
      { name: "Acme", logo: logoB },
    ]);
    expect(result.carriers).toHaveLength(2);
    expect(result.carriers[0]?.carrier_key).toBe(`acme-${sha256Hex(logoA).slice(0, 8)}`);
    expect(result.carriers[1]?.carrier_key).toBe(`acme-${sha256Hex(logoB).slice(0, 8)}`);
    expect(result.carriers[0]?.carrier_key_source).toBe("slug_logo");
    expect(result.carriers[1]?.carrier_key_source).toBe("slug_logo");
    expect(result.carriers[0]?.carrier_key).not.toBe(result.carriers[1]?.carrier_key);
  });

  it("identical name+logo carriers keep the identical key (dedupe is downstream)", () => {
    const config: LeadgenCarrierParseConfig = {
      carriers_path: "",
      fields: { carrier_name: "name", carrier_logo: "logo" },
    };
    const result = parseProviderResponse(config, [
      { name: "Acme", logo: "https://cdn.example/same.png" },
      { name: "Acme", logo: "https://cdn.example/same.png" },
    ]);
    expect(result.carriers[0]?.carrier_key).toBe(result.carriers[1]?.carrier_key);
  });

  it("non-colliding slugs never get a logo hash", () => {
    const config: LeadgenCarrierParseConfig = {
      carriers_path: "",
      fields: { carrier_name: "name", carrier_logo: "logo" },
    };
    const result = parseProviderResponse(config, [
      { name: "Acme", logo: "https://cdn.example/a.png" },
      { name: "Zenith", logo: "https://cdn.example/z.png" },
    ]);
    expect(result.carriers.map((c) => c.carrier_key)).toEqual(["acme", "zenith"]);
    expect(result.carriers.map((c) => c.carrier_key_source)).toEqual(["slug", "slug"]);
  });

  it("drops a carrier whose identity is underivable (no id, no sluggable name)", () => {
    const config: LeadgenCarrierParseConfig = {
      carriers_path: "",
      fields: { carrier_name: "name", bid: "bid" },
    };
    const result = parseProviderResponse(config, [
      { name: "!!!", bid: 5 }, // slugs to ""
      { bid: 6 }, // no name at all
      { name: "Survivor Co", bid: 7 },
    ]);
    expect(result.carriers).toHaveLength(1);
    expect(result.carriers[0]?.carrier_key).toBe("survivor-co");
    const dropped = result.errors.filter((e) => e.code === "carrier_key_underivable");
    expect(dropped.map((e) => e.carrier_index)).toEqual([0, 1]);
  });

  it("sha256Hex matches the FIPS 180-4 test vectors", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    // > 64-byte input exercises the multi-block path.
    expect(sha256Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")).toBe(
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    );
  });
});

describe("bid parsing — 07 §18.4 (zero/invalid/missing → 0, never a throw)", () => {
  const config: LeadgenCarrierParseConfig = {
    carriers_path: "",
    fields: { carrier_name: "name", bid: "bid" },
  };

  it("parses numeric strings; keeps zero bids as 0 silently", () => {
    const result = parseProviderResponse(config, [
      { name: "A", bid: "12.75" },
      { name: "B", bid: 0 },
    ]);
    expect(result.errors).toEqual([]);
    expect(result.carriers.map((c) => c.bid)).toEqual([12.75, 0]);
  });

  it("a MISSING bid is silent 0 (no_bid is a downstream classification)", () => {
    const result = parseProviderResponse(config, [{ name: "A" }]);
    expect(result.errors).toEqual([]);
    expect(result.carriers[0]?.bid).toBe(0);
  });

  it("present-but-invalid bids parse to 0 WITH a per-carrier error", () => {
    const result = parseProviderResponse(config, [
      { name: "A", bid: "not-a-number" },
      { name: "B", bid: -4 },
      { name: "C", bid: { amount: 3 } },
    ]);
    expect(result.carriers.map((c) => c.bid)).toEqual([0, 0, 0]);
    const bidErrors = result.errors.filter((e) => e.code === "bid_invalid");
    expect(bidErrors.map((e) => e.carrier_index)).toEqual([0, 1, 2]);
    expect(bidErrors[0]?.scope).toBe("carrier");
  });
});

describe("never throws — whole-response typed errors", () => {
  it("malformed JSON string → invalid_json, empty carriers", () => {
    const result = parseProviderResponse(fullConfig(), "{not json!");
    expect(result.carriers).toEqual([]);
    expect(result.errors).toEqual([
      expect.objectContaining({ scope: "response", code: "invalid_json" }),
    ]);
  });

  it("empty / null / undefined bodies → empty_response", () => {
    for (const body of ["", null, undefined]) {
      const result = parseProviderResponse(fullConfig(), body);
      expect(result.carriers).toEqual([]);
      expect(result.errors[0]?.code).toBe("empty_response");
    }
  });

  it("missing carriers_path → carriers_path_not_found", () => {
    const result = parseProviderResponse(fullConfig(), { data: { other: [] } });
    expect(result.carriers).toEqual([]);
    expect(result.errors[0]).toEqual(
      expect.objectContaining({ scope: "response", code: "carriers_path_not_found" }),
    );
    expect(result.errors[0]?.message).toContain("data.quotes");
  });

  it("a primitive at carriers_path → carriers_not_array", () => {
    const result = parseProviderResponse(fullConfig(), { data: { quotes: "nope" } });
    expect(result.carriers).toEqual([]);
    expect(result.errors[0]?.code).toBe("carriers_not_array");
  });

  it("a broken carrier_parse_json config → config_invalid", () => {
    for (const config of [null, "x", 7, {}, { fields: "nope" }]) {
      const result = parseProviderResponse(config, { data: { quotes: [] } });
      expect(result.carriers).toEqual([]);
      expect(result.errors[0]?.code).toBe("config_invalid");
    }
  });

  it("an empty carriers array is a VALID no-bid response (no errors)", () => {
    const result = parseProviderResponse(fullConfig(), { data: { quotes: [] } });
    expect(result).toEqual({ carriers: [], errors: [] });
  });
});

describe("per-carrier partial failure", () => {
  it("one bad item among good ones: the good carriers survive", () => {
    const result = parseProviderResponse(fullConfig(), {
      data: { quotes: [carrierItem(), "not-an-object", carrierItem({ id: "prov-456" })] },
    });
    expect(result.carriers.map((c) => c.carrier_key)).toEqual(["prov-123", "prov-456"]);
    expect(result.errors).toEqual([
      expect.objectContaining({ scope: "carrier", code: "carrier_not_object", carrier_index: 1 }),
    ]);
  });

  it("wrong-typed string fields resolve null with a field-scoped error", () => {
    const result = parseProviderResponse(fullConfig(), {
      data: { quotes: [carrierItem({ url: 123, title: ["not", "a", "string"] })] },
    });
    expect(result.carriers[0]?.click_url).toBeNull();
    expect(result.carriers[0]?.headline).toBeNull();
    const fieldErrors = result.errors.filter((e) => e.code === "field_wrong_type");
    expect(fieldErrors.map((e) => e.field).sort()).toEqual(["click_url", "headline"]);
    // The healthy fields on the same carrier still parsed.
    expect(result.carriers[0]?.carrier_name).toBe("Acme Life");
  });

  it("numeric tracking_id / provider_id stringify instead of erroring", () => {
    const result = parseProviderResponse(fullConfig(), {
      data: { quotes: [carrierItem({ tid: 777 })] },
    });
    expect(result.errors).toEqual([]);
    expect(result.carriers[0]?.tracking_id).toBe("777");
  });
});

describe("getAtPath — dotted extraction over objects/arrays", () => {
  const source = { a: { b: [{ c: "deep" }, { c: "deeper" }] }, n: 0, f: false };

  it("walks objects and numeric array segments", () => {
    expect(getAtPath(source, "a.b.0.c")).toBe("deep");
    expect(getAtPath(source, "a.b.1.c")).toBe("deeper");
    expect(getAtPath(source, "a.b")).toEqual([{ c: "deep" }, { c: "deeper" }]);
  });

  it("empty path returns the source itself", () => {
    expect(getAtPath(source, "")).toBe(source);
  });

  it("missing hops resolve undefined; non-numeric array segments too", () => {
    expect(getAtPath(source, "a.x.c")).toBeUndefined();
    expect(getAtPath(source, "a.b.zz")).toBeUndefined();
    expect(getAtPath(source, "a.b.9.c")).toBeUndefined();
  });

  it("falsy leaf values (0 / false) survive extraction", () => {
    expect(getAtPath(source, "n")).toBe(0);
    expect(getAtPath(source, "f")).toBe(false);
  });
});
