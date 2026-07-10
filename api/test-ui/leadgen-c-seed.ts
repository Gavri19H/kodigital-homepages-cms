// LeadGen v2.5 Phase C (slice C-verify) — shared e2e seed for the 15 §15.3
// SECTION BUILDER Playwright rows (NOT a spec).
//
// Seeds THROUGH THE REAL admin APIs only (the leadgen-b-seed convention — no
// direct DB writes):
//   * one active site WITH a logo (media upload → site_settings.logo_media_id);
//   * two extra Media-library PNGs — the row-④ image PICKER picks these;
//   * TWO Offers on an ISOLATED vertical (`sb-<uniq>`) — the offers panel
//     lists EXACTLY this pair:
//       - Offer A: ACTIVE payload schema with TWO answer fields —
//         lead.business_type (string, required), PRE-mapped by the seed with
//         an output_value_map per choice value (the row-③ C1 chip fixture),
//         and lead.company_zip (string), left UNMAPPED (the row-⑥ quick-map
//         target);
//       - Offer B (DEV-66d): ACTIVE schema with lead.business_type ONLY,
//         PRE-mapped with a DIVERGENT output_value_map — the same choice
//         value maps to a DIFFERENT provider value per Offer, the §12.2
//         semantics the row-③ chip must surface as one row PER Offer;
//   * the IMAGE-CARD Section: bound QuestionHeadline + bound Subheadline
//     (§5.2 one-store fixture), an ImageCardAnswerGrid
//     (internal_field business_type, 2 choices w/ placeholder images + REQUIRED
//     image_alt) and a ZIPInputQuestion (internal_field zip) — created WITH
//     selected_offers + the business_type answer-map edge;
//   * the LEGACY Section: created UI-shaped (unbound headline + yes/no), then
//     a RAW API PATCH appends a HeaderBar node — the §5.4 fixture the UI can
//     no longer place (frame-scope types left the palette);
//   * one Quote → funnel → control Variant carrying BOTH Sections (usage rows
//     drive the §5.4 single-funnel Move-to-frame confirm), and a minimal
//     CONFIGURED frame (PUT /funnels/:id/frame) so the moved header group
//     merges into a real stored config.

import { expect, type APIRequestContext } from "@playwright/test";
import { seedActiveSite, uploadPng } from "./listicles-p6-seed";

const LG_API = "/api/admin/leadgen";

async function json<T>(
  res: { ok(): boolean; status(): number; json(): Promise<unknown>; text(): Promise<string> },
  label: string,
): Promise<T> {
  if (!res.ok()) throw new Error(`${label} HTTP ${res.status()}: ${await res.text()}`);
  return (await res.json()) as T;
}

export interface SectionBuilderSeed {
  activity: string;
  vertical: string;
  site: { id: string; name: string; logoKey: string };
  /** Media-library keys the row-④ picker picks (uploaded, distinct). */
  pickerMedia: string[];
  offer: { id: number; publicId: string; name: string };
  /** DEV-66d: the second Offer whose value map DIVERGES per choice (§12.2). */
  offerB: { id: number; publicId: string; name: string };
  imageSection: { id: number; publicId: string; name: string };
  legacySection: { id: number; publicId: string; name: string };
  quotePublicId: string;
  funnelPublicId: string;
  funnelName: string;
  variantPublicId: string;
}

// The two image-card choices (values are the output_value_map keys).
export const IMAGE_CHOICES = [
  { label: "Design agency", value: "design_agency", analytics_id: "kind_design" },
  { label: "Software vendor", value: "software_vendor", analytics_id: "kind_software" },
] as const;

// Per-Offer provider values for the C1 chip (value → provider output).
export const PROVIDER_VALUE_MAP: Record<string, string> = {
  design_agency: "DESIGN_AGENCY_A",
  software_vendor: "SOFTWARE_VENDOR_A",
};

// DEV-66d: Offer B's DIVERGENT per-choice provider values — the same choice
// value intentionally maps to a DIFFERENT provider output than Offer A's
// (…_B vs …_A), so the row-③ chip must list BOTH rows with distinct values.
export const PROVIDER_VALUE_MAP_B: Record<string, string> = {
  design_agency: "DESIGN_AGENCY_B",
  software_vendor: "SOFTWARE_VENDOR_B",
};

export const IMAGE_SECTION_HEADLINE = "Which best describes your company?";

export async function seedSectionBuilder(request: APIRequestContext, uniq: string): Promise<SectionBuilderSeed> {
  const activity = "quote_funnel";
  const vertical = `sb-${uniq}`; // isolated pair → the offers panel lists EXACTLY our Offer

  // --- site with a logo -------------------------------------------------------
  const siteName = `LG C Site ${uniq}`;
  const siteId = await seedActiveSite(request, `lg-c-${uniq}.e2e.test`, siteName);
  const logo = await uploadPng(request, `lg-c-logo-${uniq}.png`);
  await json(
    await request.patch("/api/admin/settings", {
      data: { site_id: siteId, updates: { site_name: siteName, logo_media_id: logo.storage_key } },
    }),
    "site branding",
  );

  // --- Media-library images for the row-④ picker ------------------------------
  const media1 = await uploadPng(request, `lg-c-card-a-${uniq}.png`);
  const media2 = await uploadPng(request, `lg-c-card-b-${uniq}.png`);

  // --- Offer + ACTIVE payload schema ------------------------------------------
  const offerName = `LG C Offer ${uniq}`;
  const offer = await json<{ id: number; public_id: string }>(
    await request.post(`${LG_API}/offers`, {
      data: {
        offer_name: offerName,
        provider: "sbprov",
        activity,
        vertical,
        conversion_tracking_method: "s2s_postback",
        offer_type: "cpc",
        placements: [`pl-lg-c-${uniq}`],
        calls_provider_api: false,
        bid_source: "static",
        cap_enabled: false,
      },
    }),
    "offer create",
  );
  await json(
    await request.post(`${LG_API}/offers/${offer.public_id}/payload-schemas`, {
      data: {
        schema_json: {
          version: 1,
          root: {
            type: "object",
            children: [
              {
                path: "lead.business_type",
                name: "business_type",
                type: "string",
                required: true,
                source: "answer",
                internal_field: "business_type",
              },
              {
                path: "lead.company_zip",
                name: "company_zip",
                type: "string",
                source: "answer",
                internal_field: "zip",
              },
            ],
          },
        },
      },
    }),
    "offer schema",
  );

  // --- Offer B (DEV-66d): same choice question, DIVERGENT provider values ------
  const offerBName = `LG C Offer B ${uniq}`;
  const offerB = await json<{ id: number; public_id: string }>(
    await request.post(`${LG_API}/offers`, {
      data: {
        offer_name: offerBName,
        provider: "sbprovb",
        activity,
        vertical,
        conversion_tracking_method: "s2s_postback",
        offer_type: "cpc",
        placements: [`pl-lg-c-b-${uniq}`],
        calls_provider_api: false,
        bid_source: "static",
        cap_enabled: false,
      },
    }),
    "offer B create",
  );
  await json(
    await request.post(`${LG_API}/offers/${offerB.public_id}/payload-schemas`, {
      data: {
        schema_json: {
          version: 1,
          root: {
            type: "object",
            children: [
              {
                path: "lead.business_type",
                name: "business_type",
                type: "string",
                required: true,
                source: "answer",
                internal_field: "business_type",
              },
            ],
          },
        },
      },
    }),
    "offer B schema",
  );

  // --- the IMAGE-CARD Section (bound headline/subheadline + grid + ZIP) -------
  const imageSectionName = `LG C image unit ${uniq}`;
  const imageSection = await json<{ id: number; public_id: string }>(
    await request.post(`${LG_API}/sections`, {
      data: {
        section_name: imageSectionName,
        activity,
        vertical,
        headline_text: IMAGE_SECTION_HEADLINE,
        subheadline_text: "Takes about two minutes.",
        continue_mode: "button",
        status: "active",
        content_json: {
          components: [
            { type: "QuestionHeadline", question_id: "q_head", bind: "section_headline" },
            { type: "Subheadline", question_id: "q_sub", bind: "section_subheadline" },
            {
              type: "ImageCardAnswerGrid",
              question_id: "q_cards",
              internal_field: "business_type",
              answer_type: "enum",
              required: true,
              choices: IMAGE_CHOICES.map((c) => ({
                label: c.label,
                value: c.value,
                analytics_id: c.analytics_id,
                // placeholder image + REQUIRED alt (A5) — the test REPLACES the
                // image through the REAL picker dialog (row ④)
                imageMediaId: `media_${c.value}`,
                image_alt: c.label,
              })),
              props: { columns: 2 },
            },
            {
              type: "ZIPInputQuestion",
              question_id: "q_zip",
              internal_field: "zip",
              answer_type: "string",
              props: { placeholder: "ZIP code" },
            },
          ],
        },
        selected_offers: [offer.id, offerB.id],
        answer_maps: [
          {
            question_id: "q_cards",
            offer_id: offer.id,
            offer_payload_field_path: "lead.business_type",
            provider_expected_type: "string",
            required_for_offer: true,
            internal_field: "business_type",
            answer_type: "enum",
            output_value_map: { ...PROVIDER_VALUE_MAP },
          },
          // DEV-66d: the SAME question mapped for Offer B with the divergent
          // per-choice values (§12.2 — provider values are per (choice, Offer))
          {
            question_id: "q_cards",
            offer_id: offerB.id,
            offer_payload_field_path: "lead.business_type",
            provider_expected_type: "string",
            required_for_offer: true,
            internal_field: "business_type",
            answer_type: "enum",
            output_value_map: { ...PROVIDER_VALUE_MAP_B },
          },
        ],
      },
    }),
    "image section create",
  );

  // --- the LEGACY Section + the RAW HeaderBar PATCH (§5.4 fixture) ------------
  const legacySectionName = `LG C legacy unit ${uniq}`;
  const legacyContent: Record<string, unknown> = {
    components: [
      { type: "QuestionHeadline", question_id: "q_lhead", props: { text: "Are you currently insured?" } },
      {
        type: "TwoButtonYesNo",
        question_id: "q_ins",
        internal_field: "currently_insured",
        answer_type: "boolean",
        props: { yesLabel: "Yes", noLabel: "No" },
      },
    ],
  };
  const legacySection = await json<{ id: number; public_id: string }>(
    await request.post(`${LG_API}/sections`, {
      data: {
        section_name: legacySectionName,
        activity,
        vertical,
        headline_text: "Are you currently insured?",
        continue_mode: "button",
        status: "active",
        content_json: legacyContent,
      },
    }),
    "legacy section create",
  );
  // the UI can no longer place a HeaderBar — inject it via the RAW API PATCH
  const withHeaderBar = {
    components: [
      {
        type: "HeaderBar",
        question_id: "q_legacy_header",
        props: { secure: true, secureText: "Secure & confidential" },
      },
      ...(legacyContent["components"] as unknown[]),
    ],
  };
  await json(
    await request.patch(`${LG_API}/sections/${legacySection.public_id}`, {
      data: { content_json: withHeaderBar },
    }),
    "legacy HeaderBar patch",
  );

  // --- Quote → funnel → variant with BOTH Sections + a configured frame -------
  const quote = await json<{
    public_id: string;
    funnels: Array<{ public_id: string; variants: Array<{ public_id: string }> }>;
  }>(
    await request.post(`${LG_API}/quotes`, {
      data: { quote_name: `LG C Quote ${uniq}`, activity, verticals: [vertical] },
    }),
    "quote create",
  );
  const funnelPublicId = quote.funnels[0]!.public_id;
  const variantPublicId = quote.funnels[0]!.variants[0]!.public_id;
  await json(
    await request.put(`${LG_API}/variants/${variantPublicId}`, {
      data: {
        sections: [
          { section_id: imageSection.id, position: 0 },
          { section_id: legacySection.id, position: 1 },
        ],
      },
    }),
    "variant sections",
  );
  await json(
    await request.put(`${LG_API}/funnels/${funnelPublicId}/frame`, {
      data: { frame_config_json: { version: 1, template: "centered" } },
    }),
    "funnel frame",
  );
  const funnel = await json<{ funnel_name: string }>(
    await request.get(`${LG_API}/funnels/${funnelPublicId}`),
    "funnel read",
  );
  expect(typeof funnel.funnel_name).toBe("string");

  return {
    activity,
    vertical,
    site: { id: siteId, name: siteName, logoKey: logo.storage_key },
    pickerMedia: [media1.storage_key, media2.storage_key],
    offer: { id: offer.id, publicId: offer.public_id, name: offerName },
    offerB: { id: offerB.id, publicId: offerB.public_id, name: offerBName },
    imageSection: { id: imageSection.id, publicId: imageSection.public_id, name: imageSectionName },
    legacySection: { id: legacySection.id, publicId: legacySection.public_id, name: legacySectionName },
    quotePublicId: quote.public_id,
    funnelPublicId,
    funnelName: funnel.funnel_name,
    variantPublicId,
  };
}
