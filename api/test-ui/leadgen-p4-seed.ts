// LeadGen Phase 4 Stage B2 — shared e2e seed helpers (NOT a spec).
//
// Seeds the two §10.2 offer kinds THROUGH THE REAL admin APIs (no direct DB
// writes — the listicles-p6-seed convention):
//   * a PURE STATIC offer (calls_provider_api=0, bid_source='static') with a
//     static bid + banner_url_template (banner rides a PATCH — the §10.1
//     create modal only carries business fields, draft-then-configure);
//   * a DYNAMIC CPC offer (calls_provider_api=1, bid_source='response') with
//     endpoints and a minimal §11.5 payload schema created via
//     POST /payload-schemas (which also makes it the active version, §11.8).
//
// Names are unique-suffixed by the caller so parallel/local leftovers can
// never collide; specs filter the list with ?search=<uniq>.

import { type APIRequestContext } from "@playwright/test";

export interface SeededLeadgenOffers {
  staticOfferId: number;
  staticOfferPublicId: string;
  staticOfferName: string;
  dynamicOfferId: number;
  dynamicOfferPublicId: string;
  dynamicOfferName: string;
}

interface OfferDetailResponse {
  id: number;
  public_id: string;
  offer_name: string;
}

async function json<T>(
  res: { ok(): boolean; status(): number; json(): Promise<unknown>; text(): Promise<string> },
  label: string,
): Promise<T> {
  if (!res.ok()) {
    throw new Error(`${label} HTTP ${res.status()}: ${await res.text()}`);
  }
  return (await res.json()) as T;
}

// The minimal valid §11.5 schema the dynamic offer's builder renders:
// one answer-sourced field + one canonical-macro field.
export const MINIMAL_PAYLOAD_SCHEMA = {
  version: 1,
  root: {
    type: "object",
    children: [
      {
        path: "data.zip",
        name: "zip",
        type: "string",
        required: true,
        source: "answer",
        internal_field: "zip",
      },
      {
        path: "meta.click_id",
        name: "click_id",
        type: "string",
        source: "macro",
        macro: "click_id",
      },
    ],
  },
} as const;

// A §11.7 response-parser config riding the SAME schema version (04 §11.6:
// carrier_parse_json is a column on the schema-version row) — the editor's
// Response-parsing panel SSRs its rows from this (bid shows the first-wins
// fallback array as a comma-joined value).
export const SAMPLE_CARRIER_PARSE = {
  carriers_path: "carriers",
  fields: {
    carrier_name: "name",
    bid: ["price.amount", "bid"],
    click_url: "url",
  },
} as const;

export async function seedLeadgenOffers(
  request: APIRequestContext,
  uniq: number,
): Promise<SeededLeadgenOffers> {
  const staticOfferName = `E2E LG Static ${uniq}`;
  const dynamicOfferName = `E2E LG Dynamic ${uniq}`;

  // --- pure static kind (§10.2: calls=0, bid=static) -------------------------
  const staticOffer = await json<OfferDetailResponse>(
    await request.post("/api/admin/leadgen/offers", {
      data: {
        offer_name: staticOfferName,
        provider: "e2eprov",
        activity: "quote_funnel",
        vertical: "life",
        conversion_tracking_method: "s2s_postback",
        offer_type: "cpc",
        placements: [`pl-static-${uniq}`],
        calls_provider_api: false,
        bid_source: "static",
        cap_enabled: false,
        static_bid_value: 4.5,
        static_bid_currency: "USD",
      },
    }),
    "static offer create",
  );
  // §10.5 banner template — configured in the editor per §10.1, so it rides
  // the same PATCH surface the editor's Save uses.
  await json(
    await request.patch(`/api/admin/leadgen/offers/${staticOffer.public_id}`, {
      data: { banner_url_template: `https://banners.e2e.example/go?cid={click_id}&n=${uniq}` },
    }),
    "static offer banner patch",
  );

  // --- dynamic CPC kind (§10.2: calls=1, bid=response) -----------------------
  const dynamicOffer = await json<OfferDetailResponse>(
    await request.post("/api/admin/leadgen/offers", {
      data: {
        offer_name: dynamicOfferName,
        provider: "e2eprov",
        activity: "quote_funnel",
        vertical: "life",
        conversion_tracking_method: "s2s_postback",
        offer_type: "cpc",
        placements: [`pl-dynamic-${uniq}`],
        calls_provider_api: true,
        bid_source: "response",
        cap_enabled: false,
      },
    }),
    "dynamic offer create",
  );
  await json(
    await request.patch(`/api/admin/leadgen/offers/${dynamicOffer.public_id}`, {
      data: {
        endpoint_production: "https://provider.e2e.example/api/quotes",
        endpoint_staging: "https://staging.provider.e2e.example/api/quotes",
        request_method: "POST",
      },
    }),
    "dynamic offer endpoints patch",
  );
  await json(
    await request.post(`/api/admin/leadgen/offers/${dynamicOffer.public_id}/payload-schemas`, {
      data: { schema_json: MINIMAL_PAYLOAD_SCHEMA, carrier_parse_json: SAMPLE_CARRIER_PARSE },
    }),
    "dynamic offer payload schema create",
  );

  return {
    staticOfferId: staticOffer.id,
    staticOfferPublicId: staticOffer.public_id,
    staticOfferName,
    dynamicOfferId: dynamicOffer.id,
    dynamicOfferPublicId: dynamicOffer.public_id,
    dynamicOfferName,
  };
}
