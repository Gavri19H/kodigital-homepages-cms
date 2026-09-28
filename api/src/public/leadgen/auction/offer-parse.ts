// One Offer's provider answer → canonical carriers: THE parser choice, shared
// by the live auction (engine.ts runAuction) and the admin Test tool
// (payload-builder-handlers.ts testOfferHandler), so the Test tab shows what
// the funnel will. Its own module so the admin handlers never import engine.ts.

import type { LeadgenOfferRow } from "../../../admin/leadgen/db-types";
import {
  parseProviderResponse,
  parseStaticBidProviderResponse,
  slugifyCarrierName,
  type LeadgenParsedCarrier,
} from "./parse";

// The CPL third of 04 S10.2: `request_static_bid` — it DOES call the provider
// (so callsProvider is true and a payload is POSTed) but its bid is the Offer's
// static one and the answer is an accept/reject, not a carrier list. It needs
// parseStaticBidProviderResponse, never the CPC carrier-list parser.
export function staticBidProviderOffer(offer: LeadgenOfferRow): boolean {
  return offer.calls_provider_api === 1 && offer.bid_source === "static";
}

// THE parser choice for one Offer's provider answer — the live auction and the
// admin Test tool both call this, so the Test tab shows what the funnel will
// (it used to run every Offer, CPL ones included, through the list parser).
export function parseOfferProviderResponse(
  offer: LeadgenOfferRow,
  carrierParse: unknown,
  response: unknown,
  staticBidOverride: number | null,
): ReturnType<typeof parseProviderResponse> {
  return staticBidProviderOffer(offer)
    ? parseStaticBidProviderResponse(carrierParse, response, staticCarrier(offer, staticBidOverride))
    : parseProviderResponse(carrierParse, response);
}

// Synthesize the single canonical Carrier a static Offer contributes (07 S18.2
// static surfacing) from its static config. Also the identity/bid FALLBACK a
// request_static_bid (CPL) Offer's parser leans on — which is why the authored
// creative is layered on separately (staticNoRequestCarrier), never here: a
// CPL Offer's card copy comes from its response parser and must not change.
export function staticCarrier(offer: LeadgenOfferRow, staticBidOverride: number | null): LeadgenParsedCarrier {
  const name = (offer.provider ?? offer.offer_name ?? "").trim();
  const key = name !== "" ? slugifyCarrierName(name) : offer.public_id;
  const bid = staticBidOverride ?? offer.static_bid_value ?? 0;
  return {
    carrier_key: key === "" ? offer.public_id : key,
    carrier_key_source: "slug",
    carrier_name: name === "" ? null : name,
    carrier_logo: null,
    bid: Number.isFinite(bid) && bid > 0 ? bid : 0,
    bid_currency: offer.static_bid_currency,
    click_url: offer.static_fallback_banner_url,
    tracking_id: null,
    headline: null,
    subheadline: null,
    disclaimer: null,
    pricing_model: "static",
  };
}

