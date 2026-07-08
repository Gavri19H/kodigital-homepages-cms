// LeadGen fix-contract v2.4 Phase 2 (G5 slice) — payload-builder e2e seed
// (NOT a spec). Seeds, through the REAL admin HTTP APIs only, the two Offers
// the leadgen-payload-builder.spec.ts suite needs on a fresh local D1:
//
//   A) an AUTHORING offer (dynamic, calls_provider_api) with NO payload
//      schema — the 06 §6.13 "zero-JSON authoring" flow builds one entirely
//      through the visual builder — plus ONE linked Section (selected_offers
//      populates leadgen_section_available_offers → builder_context
//      linked_fields) carrying the answer fields the pickers/dropdowns need:
//      homeowner (boolean), carrier (enum ×2), state (enum ×3), dob (date),
//      zip (string).
//
//   B) a TEST-TAB offer (dynamic) with BOTH endpoints pointed at the local
//      mock provider (scripts/leadgen-mock-provider.ts :8788/mock), TWO
//      placements (the §6.12.3 picker is visible only when >1), an ACTIVE
//      payload schema whose answer nodes exercise every §6.12.1 form kind
//      (boolean pair / enum dropdown / date input / zip preset) plus
//      macro + computed + placement nodes (the payload the mock captures),
//      and ONE linked Section providing the enum choices.
//
// Both offers get FRESH unique names — the suite must not depend on (or
// disturb) any other suite's data. No quote/auction/activation: the payload
// builder + Test tool operate on the Offer alone.
//
// Node shapes mirror the Phase-1-proven leadgen-fix-p1-seed.ts (string
// answer nodes with value_map; formatDate transform for dates) so the seeded
// schema validates cleanly against payload.ts validatePayloadSchema.

import { type APIRequestContext } from "@playwright/test";

const LG_API = "/api/admin/leadgen";

// The mock provider (playwright.config.ts second webServer entry).
export const MOCK_PROVIDER_ORIGIN = "http://127.0.0.1:8788";
export const MOCK_PROVIDER_ENDPOINT = `${MOCK_PROVIDER_ORIGIN}/mock`;

async function json<T>(
  res: { ok(): boolean; status(): number; json(): Promise<unknown>; text(): Promise<string> },
  label: string,
): Promise<T> {
  if (!res.ok()) throw new Error(`${label} HTTP ${res.status()}: ${await res.text()}`);
  return (await res.json()) as T;
}

// ---------------------------------------------------------------------------
// A) authoring offer — empty schema + linked Section for the pickers
// ---------------------------------------------------------------------------

export interface SeededFixP2AuthoringOffer {
  offerId: number;
  offerPublicId: string; // lgo_
  sectionId: number;
  sectionPublicId: string;
}

export async function seedFixP2AuthoringOffer(
  request: APIRequestContext,
  uniq: string,
): Promise<SeededFixP2AuthoringOffer> {
  const offer = await json<{ id: number; public_id: string }>(
    await request.post(`${LG_API}/offers`, {
      data: {
        offer_name: `FixP2 Author Offer ${uniq}`,
        provider: "mockprov",
        activity: "quote_funnel",
        vertical: "life",
        conversion_tracking_method: "s2s_postback",
        offer_type: "cpc",
        placements: [`plc-fixp2a-${uniq}`],
        calls_provider_api: true,
        bid_source: "response",
        cap_enabled: false,
      },
    }),
    "fix-p2 authoring offer create",
  );

  // Linked Section (selected_offers → leadgen_section_available_offers →
  // the builder_context linked_fields the answer picker + condition-field
  // dropdown read). Answer inventory: homeowner boolean, carrier enum,
  // state enum, dob date, zip string.
  const section = await json<{ id: number; public_id: string }>(
    await request.post(`${LG_API}/sections`, {
      data: {
        section_name: `FixP2 Author Section ${uniq}`,
        activity: "quote_funnel",
        vertical: "life",
        headline_text: "About you and your carrier",
        continue_mode: "button",
        status: "active",
        content_json: {
          components: [
            { type: "QuestionHeadline", question_id: "a_head", props: { text: "About you and your carrier" } },
            {
              type: "TwoButtonYesNo",
              question_id: "a_homeowner",
              question_key: "homeowner_yn",
              internal_field: "homeowner",
              answer_type: "boolean",
              props: { yesLabel: "Yes, I own", noLabel: "No, I rent" },
            },
            {
              type: "ButtonAnswerGroup",
              question_id: "a_carrier",
              question_key: "carrier_pick",
              internal_field: "carrier",
              answer_type: "enum",
              choices: [
                { label: "AAA Insurance", value: "aaa_ins", analytics_id: "ca_aaa" },
                { label: "BBB Mutual", value: "bbb_mut", analytics_id: "ca_bbb" },
              ],
            },
            {
              type: "ButtonAnswerGroup",
              question_id: "a_state",
              question_key: "state_pick",
              internal_field: "state",
              answer_type: "enum",
              choices: [
                { label: "California", value: "CA", analytics_id: "st_ca" },
                { label: "Texas", value: "TX", analytics_id: "st_tx" },
                { label: "New York", value: "NY", analytics_id: "st_ny" },
              ],
            },
            {
              type: "DateQuestion",
              question_id: "a_dob",
              question_key: "dob_q",
              internal_field: "dob",
              answer_type: "string",
              props: {},
            },
            {
              type: "ZIPInputQuestion",
              question_id: "a_zip",
              question_key: "zip_q",
              internal_field: "zip",
              answer_type: "string",
              props: { placeholder: "ZIP code" },
            },
            { type: "ContinueButton", question_id: "a_continue", props: { label: "Continue" } },
          ],
        },
        selected_offers: [offer.id],
      },
    }),
    "fix-p2 authoring section create",
  );

  return {
    offerId: offer.id,
    offerPublicId: offer.public_id,
    sectionId: section.id,
    sectionPublicId: section.public_id,
  };
}

// ---------------------------------------------------------------------------
// B) Test-tab offer — mock endpoints + 2 placements + active schema + Section
// ---------------------------------------------------------------------------

export interface SeededFixP2TestOffer {
  offerId: number;
  offerPublicId: string; // lgo_
  // Default placement (created with the offer).
  placementDefaultExternalId: string;
  placementDefaultPublicId: string; // lgpl_
  // Second (non-default) placement added via the PATCH replace-set.
  placementSecondExternalId: string;
  placementSecondPublicId: string; // lgpl_
  sectionPublicId: string;
  schemaVersion: number;
}

export async function seedFixP2TestOffer(
  request: APIRequestContext,
  uniq: string,
): Promise<SeededFixP2TestOffer> {
  const placementDefaultExternalId = `plc-fixp2b-main-${uniq}`;
  const placementSecondExternalId = `plc-fixp2b-alt-${uniq}`;

  const offer = await json<{ id: number; public_id: string }>(
    await request.post(`${LG_API}/offers`, {
      data: {
        offer_name: `FixP2 Test Offer ${uniq}`,
        provider: "mockprov",
        activity: "quote_funnel",
        vertical: "life",
        conversion_tracking_method: "s2s_postback",
        offer_type: "cpc",
        placements: [placementDefaultExternalId],
        calls_provider_api: true,
        bid_source: "response",
        cap_enabled: false,
      },
    }),
    "fix-p2 test offer create",
  );

  const detail = await json<{
    placements?: Array<{ id: number; public_id: string; placement_id: string; is_default: number | boolean }>;
  }>(await request.get(`${LG_API}/offers/${offer.id}`), "fix-p2 test offer detail");
  const defaultPlacement = (detail.placements ?? []).find(
    (p) => p.placement_id === placementDefaultExternalId,
  );
  if (defaultPlacement === undefined) {
    throw new Error(`fix-p2 seed: offer ${offer.public_id} has no placement row for ${placementDefaultExternalId}`);
  }

  // Endpoints → the local mock; placements replace-set adds the SECOND
  // placement (§10.1: rows with public_id are preserved, template rows mint
  // a new lgpl_; exactly one default).
  await json(
    await request.patch(`${LG_API}/offers/${offer.id}`, {
      data: {
        endpoint_production: MOCK_PROVIDER_ENDPOINT,
        endpoint_staging: MOCK_PROVIDER_ENDPOINT,
        request_method: "POST",
        placements: [
          {
            public_id: defaultPlacement.public_id,
            placement_id: placementDefaultExternalId,
            label: "Main placement",
            is_default: true,
          },
          {
            placement_id: placementSecondExternalId,
            label: "Secondary placement",
            is_default: false,
          },
        ],
      },
    }),
    "fix-p2 test offer patch endpoints+placements",
  );

  const patched = await json<{
    placements?: Array<{ id: number; public_id: string; placement_id: string; is_default: number | boolean }>;
  }>(await request.get(`${LG_API}/offers/${offer.id}`), "fix-p2 test offer re-read");
  const secondPlacement = (patched.placements ?? []).find(
    (p) => p.placement_id === placementSecondExternalId,
  );
  if (secondPlacement === undefined) {
    throw new Error(`fix-p2 seed: offer ${offer.public_id} has no placement row for ${placementSecondExternalId}`);
  }

  // ACTIVE payload schema: every §6.12.1 generated-form kind is present —
  // homeowner → boolean pair, prior_coverage → enum dropdown (options from
  // the Section choices), dob → date input (formatDate transform), zip →
  // zip preset — plus macro/computed/placement nodes so the payload the mock
  // captures carries traffic + computed + placement evidence.
  const schema = await json<{ version: number }>(
    await request.post(`${LG_API}/offers/${offer.id}/payload-schemas`, {
      data: {
        schema_json: {
          version: 1,
          root: {
            type: "object",
            children: [
              {
                path: "lead.homeowner_status",
                name: "homeowner_status",
                type: "string",
                required: true,
                source: "answer",
                internal_field: "homeowner",
                value_map: { true: "own", false: "rent" },
              },
              {
                path: "lead.prior_coverage",
                name: "prior_coverage",
                type: "string",
                source: "answer",
                internal_field: "prior_coverage",
                value_map: { insured: "I", none: "N" },
              },
              {
                path: "lead.dob",
                name: "dob",
                type: "string",
                source: "answer",
                internal_field: "dob",
                transform: [{ kind: "formatDate", format: "YYYY-MM-DD" }],
              },
              {
                path: "lead.zip",
                name: "zip",
                type: "string",
                source: "answer",
                internal_field: "zip",
              },
              { path: "traffic.utm_source", name: "utm_source", type: "string", source: "macro", macro: "utm_source" },
              {
                path: "meta.request_timestamp",
                name: "request_timestamp",
                type: "number",
                source: "computed",
                computed: "request_timestamp",
              },
              { path: "meta.placement_id", name: "placement_id", type: "string", source: "placement" },
            ],
          },
        },
      },
    }),
    "fix-p2 test offer payload schema create",
  );

  // Linked Section: provides the enum choices (prior_coverage) + the
  // component kinds (TwoButtonYesNo/DateQuestion/ZIPInputQuestion) the
  // §6.12.1 classifier reads.
  const section = await json<{ id: number; public_id: string }>(
    await request.post(`${LG_API}/sections`, {
      data: {
        section_name: `FixP2 Test Section ${uniq}`,
        activity: "quote_funnel",
        vertical: "life",
        headline_text: "Tell us about your coverage",
        continue_mode: "button",
        status: "active",
        content_json: {
          components: [
            { type: "QuestionHeadline", question_id: "t_head", props: { text: "Tell us about your coverage" } },
            {
              type: "TwoButtonYesNo",
              question_id: "t_homeowner",
              question_key: "homeowner_yn",
              internal_field: "homeowner",
              answer_type: "boolean",
              props: { yesLabel: "Yes, I own", noLabel: "No, I rent" },
            },
            {
              type: "ButtonAnswerGroup",
              question_id: "t_prior",
              question_key: "prior_pick",
              internal_field: "prior_coverage",
              answer_type: "enum",
              choices: [
                { label: "Currently insured", value: "insured", analytics_id: "pc_insured" },
                { label: "Not insured", value: "none", analytics_id: "pc_none" },
              ],
            },
            {
              type: "DateQuestion",
              question_id: "t_dob",
              question_key: "dob_q",
              internal_field: "dob",
              answer_type: "string",
              props: {},
            },
            {
              type: "ZIPInputQuestion",
              question_id: "t_zip",
              question_key: "zip_q",
              internal_field: "zip",
              answer_type: "string",
              props: { placeholder: "ZIP code" },
            },
            { type: "ContinueButton", question_id: "t_continue", props: { label: "Continue" } },
          ],
        },
        selected_offers: [offer.id],
        answer_maps: [
          {
            question_id: "t_homeowner",
            offer_id: offer.id,
            offer_payload_field_path: "lead.homeowner_status",
            provider_expected_type: "string",
            required_for_offer: true,
            internal_field: "homeowner",
            answer_type: "boolean",
            output_value_map: { true: "own", false: "rent" },
          },
        ],
      },
    }),
    "fix-p2 test section create",
  );

  return {
    offerId: offer.id,
    offerPublicId: offer.public_id,
    placementDefaultExternalId,
    placementDefaultPublicId: defaultPlacement.public_id,
    placementSecondExternalId,
    placementSecondPublicId: secondPlacement.public_id,
    sectionPublicId: section.public_id,
    schemaVersion: schema.version,
  };
}
