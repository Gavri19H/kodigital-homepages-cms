// LeadGen fix-contract v2.4 Phase 1 (Slice C3) — shared live-funnel e2e seed
// (NOT a spec). Seeds, through the REAL admin HTTP APIs only, everything the
// Group-1 live-funnel suite (11 §11.2) needs on a fresh local D1:
//
//   site (ACTIVE tenant, via the listicles seedActiveSite)
//   → dynamic SERVER-mode Offer (calls_provider_api + bid_source:"response")
//     with ONE placement
//   → PATCH endpoints: endpoint_staging AND endpoint_production BOTH point at
//     the local mock provider (scripts/leadgen-mock-provider.ts, :8788/mock) —
//     the live /lg/auction runtime ALWAYS uses production endpoints
//     (serve-auction.ts RUNTIME_ENVIRONMENT), the admin Test tool uses staging
//   → payload schema (POST /offers/:id/payload-schemas — pins
//     active_payload_schema_id): answer node with value_map (homeowner→
//     own/rent), answer node (zip), source:"macro" (utm_source + ua),
//     source:"computed" (request_timestamp, number), source:"placement"
//   → carrier_parse_json matching the mock body (carriers[], name/bid/logo…;
//     the mock carriers deliberately carry NO click_url so /lg/lc resolves the
//     banner_url_template macros — {session_id}/{utm_source}/{response:quote_ref})
//   → REAL test-tool run (POST /offers/:id/test, environment:"staging",
//     dry_run absent) — the mock's 200 records the PASSED provider_request_log
//     row the R4 eligibility gate requires (validation.ts §5.1)
//   → quote (+ auto control variant) → two Sections:
//       s1 auto_advance: single TwoButtonYesNo (internal_field "homeowner",
//          props.defaultValue "true" → the §3.4 defaults transitions) —
//          carries the offer's COMPLETE required answer-map (homeowner →
//          lead.homeowner_status, required, with output_value_map)
//       s2 button/continue: required ZIPInputQuestion + a DEPENDENT
//          ButtonAnswerGroup revealed by s1's homeowner answer + Back +
//          Continue + error slot. NO answer_maps here: an answer-map edge
//          implicitly SELECTS the offer on that section (sections-handlers
//          parseAnswerMaps) and the activation preflight demands every
//          required schema path be mapped complete PER selected section —
//          zip therefore stays provider-OPTIONAL in the schema and flows to
//          the payload via its source:"answer" schema node at build time.
//   → auction (dynamic, highest_bid, multi_offer enabled)
//   → PUT /auctions/:id/offers (participating placement; the response
//     warnings MUST NOT flag the offer ineligible — asserted, this is the R4
//     proof at seed time) → PUT /auctions/:id/banner (automatic field map)
//   → PUT /variants/:id {auction_id, sections[]}
//   → activation PUT (MUST be a clean 200 — a 409 fails the seed loudly with
//     the per-Section/per-Offer report).
//
// Cross-section dependency authoring note: content-schema requires
// conditional.when to name a field present in the SAME section's knownFields
// (internal_field/question_key/question_id). The dependent component in s2
// therefore carries question_key "homeowner" (its own key satisfies the
// authoring gate) while the runtime evaluator resolves `when` against the
// GLOBAL answer store keyed by internal_field — s1's homeowner answer.
//
// TwoButtonYesNo stores the STRING "true"/"false" at runtime (the preset's
// data-lg-choice attribute value; the node authors no choices[] to type it),
// so the default, the dependency value, and the value_map keys are ALL the
// string form — strict-eq coherent end-to-end.

import { type APIRequestContext } from "@playwright/test";
import { seedActiveSite } from "./listicles-p6-seed";
import { PW_PORT } from "./utils/base-url";

const LG_API = "/api/admin/leadgen";

// The mock provider (playwright.config.ts second webServer entry).
export const MOCK_PROVIDER_ORIGIN = "http://127.0.0.1:8788";
export const MOCK_PROVIDER_ENDPOINT = `${MOCK_PROVIDER_ORIGIN}/mock`;
// Mirrors scripts/leadgen-mock-provider.ts MOCK_PROVIDER_BODY.
export const MOCK_QUOTE_REF = "mockref-a7x42";
export const MOCK_CARRIER_NAMES = ["Acme Life", "Zenith Shield"] as const;

// The banner URL template the /lg/lc resolver expands (mock carriers carry no
// click_url). Points at the worker's own any-host /health so a REAL banner
// click completes navigation locally (the listicles offers.e2e.test trick).
export const BANNER_URL_TEMPLATE =
  `http://offers.e2e.test:${PW_PORT}/health?sid={session_id}&src={utm_source}&qr={response:quote_ref}`;

export interface SeededFixP1Funnel {
  host: string;
  siteId: string;
  slug: string;
  quoteId: number;
  quotePublicId: string;
  funnelId: string; // lgf_
  variantId: string; // lgn_
  offerId: number;
  offerPublicId: string; // lgo_
  placementRowId: number; // numeric leadgen_offer_placements.id
  placementPublicId: string; // lgpl_
  placementExternalId: string; // the provider placement string (source:"placement" resolves this)
  auctionId: number;
  sectionOneId: number;
  sectionOnePublicId: string;
  sectionTwoId: number;
  sectionTwoPublicId: string;
  fields: { homeowner: string; zip: string; dependent: string };
}

async function json<T>(
  res: { ok(): boolean; status(): number; json(): Promise<unknown>; text(): Promise<string> },
  label: string,
): Promise<T> {
  if (!res.ok()) throw new Error(`${label} HTTP ${res.status()}: ${await res.text()}`);
  return (await res.json()) as T;
}

export interface SeedFixP1Options {
  hostPrefix: string;
  slug: string;
}

export async function seedFixP1Funnel(
  request: APIRequestContext,
  opts: SeedFixP1Options,
): Promise<SeededFixP1Funnel> {
  const uniq = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const host = `${opts.hostPrefix}-${uniq}.e2e.test`;
  const placementExternalId = `plc-fixp1-${uniq}`;
  const siteId = await seedActiveSite(request, host, `LeadGen FixP1 ${uniq}`);

  // ---- Offer (dynamic, server-mode) ---------------------------------------
  const offer = await json<{ id: number; public_id: string }>(
    await request.post(`${LG_API}/offers`, {
      data: {
        offer_name: `FixP1 Mock Offer ${uniq}`,
        provider: "mockprov",
        activity: "quote_funnel",
        vertical: "life",
        conversion_tracking_method: "s2s_postback",
        offer_type: "cpc",
        placements: [placementExternalId],
        calls_provider_api: true,
        bid_source: "response",
        cap_enabled: false,
      },
    }),
    "offer create",
  );

  // The create response is the offer detail; read the placement row (numeric
  // id + lgpl_ public id) from a fresh GET so the shape stays authoritative.
  const detail = await json<{
    placements?: Array<{ id: number; public_id: string; placement_id: string; is_default: number | boolean }>;
  }>(await request.get(`${LG_API}/offers/${offer.id}`), "offer detail");
  const placement = (detail.placements ?? []).find((p) => p.placement_id === placementExternalId);
  if (placement === undefined) {
    throw new Error(`seed: offer ${offer.public_id} has no placement row for ${placementExternalId}`);
  }

  // ---- Endpoints (BOTH → the mock) + banner template ----------------------
  await json(
    await request.patch(`${LG_API}/offers/${offer.id}`, {
      data: {
        endpoint_production: MOCK_PROVIDER_ENDPOINT,
        endpoint_staging: MOCK_PROVIDER_ENDPOINT,
        request_method: "POST",
        banner_url_template: BANNER_URL_TEMPLATE,
        headers: [
          // A static header the mock captures — provider-request evidence.
          { header_name: "X-Fix-P1", value_kind: "static", value_text: `fixp1-${uniq}` },
        ],
      },
    }),
    "offer patch endpoints",
  );

  // ---- Payload schema + carrier parser (pins active_payload_schema_id) ----
  await json(
    await request.post(`${LG_API}/offers/${offer.id}/payload-schemas`, {
      data: {
        schema_json: {
          version: 1,
          root: {
            type: "object",
            children: [
              // answer + value_map: the runtime build maps the stored
              // "true"/"false" string onto the provider vocabulary.
              {
                path: "lead.homeowner_status",
                name: "homeowner_status",
                type: "string",
                required: true,
                source: "answer",
                internal_field: "homeowner",
                value_map: { true: "own", false: "rent" },
              },
              // Provider-optional (see the header note on per-section
              // activation gating); still built from the live answer.
              {
                path: "lead.zip",
                name: "zip",
                type: "string",
                source: "answer",
                internal_field: "zip",
              },
              { path: "traffic.utm_source", name: "utm_source", type: "string", source: "macro", macro: "utm_source" },
              { path: "meta.ua", name: "ua", type: "string", source: "macro", macro: "ua" },
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
        carrier_parse_json: {
          carriers_path: "carriers",
          fields: {
            provider_id: "id",
            carrier_name: "name",
            carrier_logo: "logo",
            bid: "bid",
            bid_currency: "currency",
            headline: "headline",
            tracking_id: "tracking",
            // NO click_url mapping: the mock carriers carry none, so /lg/lc
            // resolves the banner_url_template macros (the leg under test).
          },
        },
      },
    }),
    "payload schema create",
  );

  // ---- REAL test-tool run (staging → the mock) — records the PASSED row ---
  const testRun = await json<{ status_code?: number | null }>(
    await request.post(`${LG_API}/offers/${offer.id}/test`, {
      data: {
        environment: "staging",
        sample_answers: { homeowner: "true", zip: "90210" },
      },
    }),
    "offer test run",
  );
  if (testRun.status_code !== undefined && testRun.status_code !== null && (testRun.status_code < 200 || testRun.status_code >= 300)) {
    throw new Error(`seed: test-tool run did not PASS (provider status ${testRun.status_code}) — is the mock provider up on :8788?`);
  }

  // ---- Quote (+ auto control variant) --------------------------------------
  const quote = await json<{
    id: number;
    public_id: string;
    funnels: Array<{ public_id: string; variants: Array<{ public_id: string }> }>;
  }>(
    await request.post(`${LG_API}/quotes`, {
      data: { quote_name: `FixP1 Quote ${uniq}`, activity: "quote_funnel", verticals: ["life"] },
    }),
    "quote create",
  );
  const funnelId = quote.funnels[0]!.public_id;
  const variantId = quote.funnels[0]!.variants[0]!.public_id;

  // ---- Section 1: single-question auto-advance + the COMPLETE required map -
  const sectionOne = await json<{ id: number; public_id: string }>(
    await request.post(`${LG_API}/sections`, {
      data: {
        section_name: `FixP1 s1 homeowner ${uniq}`,
        activity: "quote_funnel",
        vertical: "life",
        headline_text: "Do you own your home?",
        continue_mode: "auto_advance",
        status: "active",
        content_json: {
          components: [
            { type: "ProgressBar", question_id: "s1_progress", props: { mode: "step" } },
            { type: "QuestionHeadline", question_id: "s1_head", props: { text: "Do you own your home?" } },
            {
              type: "TwoButtonYesNo",
              question_id: "q_homeowner",
              question_key: "homeowner_yn",
              internal_field: "homeowner",
              answer_type: "boolean",
              props: {
                yesLabel: "Yes, I own",
                noLabel: "No, I rent",
                auto_advance: true,
                // §3.4 defaults: applied once on section entry as
                // default_applied; clicking the SAME value converts to
                // user_confirmed_default. STRING form — the runtime stores
                // the data-lg-choice attribute string.
                defaultValue: "true",
              },
            },
          ],
        },
        selected_offers: [offer.id],
        answer_maps: [
          {
            question_id: "q_homeowner",
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
    "section 1 create",
  );

  // ---- Section 2: continue-mode, required ZIP + dependent + Back/Continue --
  const sectionTwo = await json<{ id: number; public_id: string }>(
    await request.post(`${LG_API}/sections`, {
      data: {
        section_name: `FixP1 s2 zip ${uniq}`,
        activity: "quote_funnel",
        vertical: "life",
        headline_text: "Where is the property?",
        continue_mode: "button",
        status: "active",
        content_json: {
          components: [
            { type: "ProgressBar", question_id: "s2_progress", props: { mode: "step" } },
            { type: "BackButton", question_id: "s2_back" },
            { type: "QuestionHeadline", question_id: "s2_head", props: { text: "Where is the property?" } },
            {
              type: "ZIPInputQuestion",
              question_id: "q_zip",
              question_key: "property_zip",
              internal_field: "zip",
              answer_type: "string",
              required: true,
              props: { placeholder: "ZIP code" },
            },
            { type: "ValidationError", question_id: "s2_zip_err", internal_field: "zip" },
            {
              // DEPENDENT component revealed by s1's homeowner answer. Its OWN
              // question_key is "homeowner" so the authoring validator's
              // knownFields check passes (see module header); at runtime the
              // evaluator resolves `when` against the global internal_field
              // answer store — s1's "homeowner".
              type: "ButtonAnswerGroup",
              question_id: "q_prior",
              question_key: "homeowner",
              internal_field: "prior_coverage",
              answer_type: "enum",
              choices: [
                { label: "Currently insured", value: "insured", analytics_id: "pc_insured" },
                { label: "Not insured", value: "none", analytics_id: "pc_none" },
              ],
              conditional: { when: "homeowner", op: "eq", value: "true" },
            },
            { type: "ContinueButton", question_id: "s2_continue", props: { label: "See my quotes" } },
          ],
        },
      },
    }),
    "section 2 create",
  );

  // ---- Auction + participation + banner ------------------------------------
  const auction = await json<{ id: number }>(
    await request.post(`${LG_API}/auctions`, {
      data: {
        auction_name: `FixP1 Auction ${uniq}`,
        quote_id: quote.id,
        auction_type: "dynamic",
        winner_logic: "highest_bid",
        floor_type: "percentage_of_max",
        floor_value: 10,
        multi_offer: "enabled",
        banner_slots_count: 5,
        max_carriers_per_offer: 3,
        max_total_carriers: 10,
        timeout_ms: 2500,
        status: "active",
      },
    }),
    "auction create",
  );

  const participation = await json<{
    warnings?: Array<{ offer_id?: string; eligible?: boolean; reasons?: string[] }>;
  }>(
    await request.put(`${LG_API}/auctions/${auction.id}/offers`, {
      data: { offers: [{ offer_placement_id: placement.id, static_order: 0 }] },
    }),
    "auction offers put",
  );
  // R4 proof at seed time: the participation save must NOT flag the offer
  // ineligible (a flagged dynamic offer would make the live auction unfilled).
  const flagged = (participation.warnings ?? []).find(
    (w) => w.offer_id === offer.public_id && w.eligible === false,
  );
  if (flagged !== undefined) {
    throw new Error(`seed: offer flagged ineligible at participation save: ${JSON.stringify(flagged.reasons ?? [])}`);
  }

  // No PUT /auctions/:id/banner: the automatic default field map (banner.ts
  // DEFAULT_FIELD_MAP) already surfaces logo + name + headline + subheadline.

  // ---- Variant: ordered sections + the auction -----------------------------
  await json(
    await request.put(`${LG_API}/variants/${variantId}`, {
      data: {
        auction_id: auction.id,
        sections: [
          { section_id: sectionOne.id, position: 0 },
          { section_id: sectionTwo.id, position: 1 },
        ],
      },
    }),
    "variant sections+auction",
  );

  // ---- Activation (the R5 gate — MUST be a clean 200) ----------------------
  const activationRes = await request.put(`${LG_API}/quotes/${quote.public_id}/activation/${siteId}`, {
    data: { enabled: true, slug: opts.slug },
  });
  if (!activationRes.ok()) {
    throw new Error(
      `seed: activation blocked HTTP ${activationRes.status()} — ${await activationRes.text()}`,
    );
  }

  return {
    host,
    siteId,
    slug: opts.slug,
    quoteId: quote.id,
    quotePublicId: quote.public_id,
    funnelId,
    variantId,
    offerId: offer.id,
    offerPublicId: offer.public_id,
    placementRowId: placement.id,
    placementPublicId: placement.public_id,
    placementExternalId,
    auctionId: auction.id,
    sectionOneId: sectionOne.id,
    sectionOnePublicId: sectionOne.public_id,
    sectionTwoId: sectionTwo.id,
    sectionTwoPublicId: sectionTwo.public_id,
    fields: { homeowner: "homeowner", zip: "zip", dependent: "prior_coverage" },
  };
}
