// OWNER 2026-09-28 — insurissimo.com/lg/home-insurance: "each time I got only 1
// result". NextInsure answered with 6 listings (his teammate's curl; the
// fixture below is that response with URLs/ids redacted), and every logged
// production response had several (6, 7, 4, 2) — parsed = 1 each time.
//
// Cause: the offer's parser (built from the editor's pick-source chips) names
// absolute paths through list item 0 — response.listingset.listing.0.cpc — and
// with no carriers path those were read against the response root: one
// carrier, always item 0. The parser now reads such a list as the carriers
// list (every item), keeping paths outside it (searchid) shared.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseProviderResponse } from "../src/public/leadgen/auction/parse";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const NEXTINSURE_6 = JSON.parse(
  readFileSync(join(TEST_DIR, "fixtures", "parser-every-listing", "nextinsure-home-6-listings.json"), "utf8"),
) as { response: { listingset: { searchid: string; listing: Array<Record<string, string>> } } };

// QuinStreetHome (offer 8), active schema v57 — carrier_parse_json verbatim from production.
const QUINSTREET_HOME_PARSER = {
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

// AdsByMoneyHome (offer 7), active schema v26 — verbatim from production.
const ADSBYMONEY_HOME_PARSER = {
  fields: {
    provider_id: "{response:data.0.name_alias}",
    carrier_name: "{response:data.0.name}",
    carrier_logo: "{response:data.0.logo_url}",
    bid: "{response:data.0.bid}",
    click_url: "{response:data.0.url}",
    headline: "{response:data.0.full_name}",
    subheadline: "{response:data.0.overview}",
    disclaimer: "{response:data.0.disclaimer}",
  },
};

describe("the parser reads every listing, not only the first (OWNER 2026-09-28)", () => {
  it("his stored QuinStreetHome parser on the real 6-listing response → 6 carriers, in the provider's order", () => {
    const r = parseProviderResponse(QUINSTREET_HOME_PARSER, NEXTINSURE_6);
    expect(r.errors).toEqual([]);
    expect(r.carriers.map((c) => c.carrier_name)).toEqual([
      "Contactability", "Farmers", "ultimateinsurance.com", "QuotesMatch.com", "CheaperQuotes", "Union Square Media",
    ]);
    expect(r.carriers.map((c) => c.bid)).toEqual([5.85, 3.45, 3.11, 2.48, 2.42, 1.75]);
    // each its own identity, logo, click and copy…
    expect(new Set(r.carriers.map((c) => c.carrier_key)).size).toBe(6);
    expect(r.carriers[1]!.carrier_key).toBe("Farmers Insurance Group");
    expect(r.carriers.map((c) => c.click_url)).toEqual(
      NEXTINSURE_6.response.listingset.listing.map((l) => l["clickurl"]),
    );
    expect(r.carriers[3]!.carrier_logo).toBe("https://cdn.example/logo-4.png");
    // …while a path outside the list is shared by every carrier
    expect(new Set(r.carriers.map((c) => c.tracking_id))).toEqual(new Set(["search-REDACTED-1"]));
  });

  it("the AdsByMoneyHome parser (data.0.*) reads every item of data", () => {
    const body = {
      data: [
        { name_alias: "a", name: "Alpha", bid: 4, url: "https://a.example/go" },
        { name_alias: "b", name: "Beta", bid: 3, url: "https://b.example/go" },
        { name_alias: "c", name: "Gamma", bid: 2, url: "https://c.example/go" },
      ],
    };
    const r = parseProviderResponse(ADSBYMONEY_HOME_PARSER, body);
    expect(r.errors).toEqual([]);
    expect(r.carriers.map((c) => c.carrier_key)).toEqual(["a", "b", "c"]);
  });

  it("an empty list is zero carriers with no parse error (it used to report the carrier as unparseable)", () => {
    const r = parseProviderResponse(ADSBYMONEY_HOME_PARSER, { data: [] });
    expect(r.carriers).toEqual([]);
    expect(r.errors).toEqual([]);
  });

  it("a one-listing response is still one carrier", () => {
    const one = { response: { listingset: { searchid: "s", listing: [NEXTINSURE_6.response.listingset.listing[0]!] } } };
    const r = parseProviderResponse(QUINSTREET_HOME_PARSER, one);
    expect(r.carriers.map((c) => c.carrier_name)).toEqual(["Contactability"]);
  });

  it("unchanged when the author pointed at something specific: a non-zero index, or two different lists", () => {
    const second = {
      fields: { provider_id: "response.listingset.listing.1.company", carrier_name: "response.listingset.listing.1.displayname", bid: "response.listingset.listing.1.cpc" },
    };
    expect(parseProviderResponse(second, NEXTINSURE_6).carriers.map((c) => c.carrier_name)).toEqual(["Farmers"]);
    const twoLists = {
      fields: { provider_id: "a.0.id", carrier_name: "b.0.name", bid: "a.0.bid" },
    };
    const body = { a: [{ id: "x", bid: 1 }, { id: "y", bid: 2 }], b: [{ name: "X" }, { name: "Y" }] };
    expect(parseProviderResponse(twoLists, body).carriers.map((c) => c.carrier_key)).toEqual(["x"]);
  });

  it("an explicit carriers path keeps its own (item-relative) meaning", () => {
    const cfg = { carriers_path: "response.listingset.listing", fields: { provider_id: "company", carrier_name: "displayname", bid: "cpc" } };
    expect(parseProviderResponse(cfg, NEXTINSURE_6).carriers).toHaveLength(6);
  });
});

describe("review round — only a list the carrier's identity runs through is the carriers list", () => {
  it("a single-carrier provider whose logo is logos.0 (a list of strings) stays ONE carrier (it used to empty the page)", () => {
    const cfg = { fields: { provider_id: "id", carrier_name: "name", bid: "bid", click_url: "click", carrier_logo: "{response:logos.0}" } };
    const r = parseProviderResponse(cfg, { id: "p1", name: "Solo", bid: 3, click: "https://solo.example/go", logos: ["https://a.png", "https://b.png"] });
    expect(r.errors).toEqual([]);
    expect(r.carriers.map((c) => [c.carrier_key, c.carrier_logo])).toEqual([["p1", "https://a.png"]]);
  });

  it("a headline through offer.features.0 with the identity outside it stays ONE carrier (it used to clone the card)", () => {
    const cfg = { fields: { provider_id: "offer.id", carrier_name: "offer.brand", bid: "offer.bid", click_url: "offer.url", headline: "{response:offer.features.0.text}" } };
    const body = { offer: { id: "e2", brand: "Brand", bid: 2, url: "https://e2.example/go", features: [{ text: "Fast" }, { text: "Cheap" }, { text: "Good" }] } };
    const r = parseProviderResponse(cfg, body);
    expect(r.carriers.map((c) => [c.carrier_key, c.headline])).toEqual([["e2", "Fast"]]);
  });

  it("identity through the listing list, another field through a second list: one carrier per listing, the other field shared", () => {
    const cfg = { fields: { provider_id: "r.listing.0.id", carrier_name: "r.listing.0.name", bid: "r.listing.0.bid", disclaimer: "r.notes.0" } };
    const body = { r: { listing: [{ id: "a", name: "A", bid: 3 }, { id: "b", name: "B", bid: 2 }], notes: ["Terms apply", "unused"] } };
    const r = parseProviderResponse(cfg, body);
    expect(r.carriers.map((c) => [c.carrier_key, c.disclaimer])).toEqual([["a", "Terms apply"], ["b", "Terms apply"]]);
  });

  it("a list of non-objects under the identity path keeps the old one-object reading", () => {
    const cfg = { fields: { provider_id: "ids.0", carrier_name: "name", bid: "bid" } };
    const r = parseProviderResponse(cfg, { ids: ["x", "y"], name: "N", bid: 1 });
    expect(r.carriers.map((c) => c.carrier_key)).toEqual(["x"]);
  });

  it("two listings with the same provider id are one carrier: the first is kept, the repeat reported", () => {
    const listing = NEXTINSURE_6.response.listingset.listing.map((l) => ({ ...l }));
    listing[4]!["company"] = listing[1]!["company"]!; // a repeat of Farmers further down
    const r = parseProviderResponse(QUINSTREET_HOME_PARSER, { response: { listingset: { ...NEXTINSURE_6.response.listingset, listing } } });
    expect(r.carriers).toHaveLength(5);
    const farmers = r.carriers.filter((c) => c.carrier_key === "Farmers Insurance Group");
    expect(farmers.map((c) => [c.carrier_name, c.bid])).toEqual([["Farmers", 3.45]]);
    expect(r.errors.map((e) => e.code)).toEqual(["duplicate_carrier_key"]);
  });
});
