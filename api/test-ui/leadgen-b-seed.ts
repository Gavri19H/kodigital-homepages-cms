// LeadGen v2.5 Phase B (slice B4) — shared e2e seed for the Quote Builder
// frame-studio Playwright rows (NOT a spec).
//
// Seeds THROUGH THE REAL admin APIs only (the leadgen-p5-seed /
// listicles-p6-seed convention — no direct DB writes):
//   * site A: full active site (seedActiveSite) WITH a site logo
//     (media upload → site_settings.logo_media_id) + activation ENABLED for
//     the Quote → the §10.5 "Active" badge;
//   * site B: CMS site WITH ITS OWN logo but NO activation row → the
//     "Not activated yet" badge + the C4 "preview an unactivated site's
//     branding" fixture (logo swap has two distinct media keys to compare);
//   * site C: CMS site with a DISABLED activation row → "Activation off";
//   * one Quote → funnel → control Variant with THREE ordered Sections
//     (leadgen-p5-seed content patterns: TwoButtonYesNo / IconCardAnswerGrid
//     / ZIP+Continue+Reassurance — question units only, NO section-embedded
//     page chrome, so the FRAME is the only chrome on the composed canvas);
//   * the funnel frame config through the REAL PUT /funnels/:id/frame:
//     template `centered` + trust strip (2 logos w/ alts) + top-bar
//     disclosure + manual footer links + footer trust text — the §15.3
//     "footer/disclosure/trust configured" fixture;
//   * a NON-CONTROL arm (fork of control) whose frame_overrides_json
//     overrides progress (style dots) — the §4.5 override-badge fixture.

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

// --- section content (leadgen-p5-seed component patterns, question units only)

const BUSINESS_TYPE_CHOICES = [
  { label: "Sole Proprietor", value: "sole_proprietor", analytics_id: "biz_type_sole", icon: "\u{1F464}" },
  { label: "Partnership", value: "partnership", analytics_id: "biz_type_partner", icon: "\u{1F91D}" },
  { label: "Limited Liability Company (LLC)", value: "llc", analytics_id: "biz_type_llc", icon: "\u{1F3E2}" },
];

function slideContent(index: number): Record<string, unknown> {
  if (index === 0) {
    return {
      components: [
        {
          type: "TwoButtonYesNo",
          question_id: "q_insured",
          internal_field: "currently_insured",
          required: true,
          props: { yesLabel: "Yes", noLabel: "No", auto_advance: false },
        },
        { type: "HelperText", question_id: "q_help1", props: { text: "Your information is secure." } },
      ],
    };
  }
  if (index === 1) {
    return {
      components: [
        {
          type: "IconCardAnswerGrid",
          question_id: "q_business_type",
          internal_field: "business_type",
          required: true,
          choices: BUSINESS_TYPE_CHOICES,
          props: { columns: 3 },
        },
      ],
    };
  }
  return {
    components: [
      { type: "ZIPInputQuestion", question_id: "q_zip", internal_field: "zip", props: { validate: true } },
      { type: "ContinueButton", question_id: "q_continue", props: { label: "Continue", loadingLabel: "Finding offers…" } },
      { type: "ReassuranceBadge", question_id: "q_badge", props: { icon: "✓", text: "Get your offers in 2 minutes or less." } },
    ],
  };
}

const SLIDE_HEADLINES = [
  "Are you currently insured?",
  "What type of business do you run?",
  "Where are you located?",
] as const;

// --- the seeded frame config (REAL PUT — schema-legal §3.3 values) -----------

export function seededFrameConfig(): Record<string, unknown> {
  return {
    version: 1,
    template: "centered",
    disclosure: {
      enabled: true,
      location: "top_bar",
      link_label: "Advertising Disclosure",
      text: "We may receive compensation from our partners.",
    },
    footer: {
      enabled: true,
      show_on: "all",
      links_source: "manual",
      links: [
        { label: "Privacy", href: "/privacy" },
        { label: "Terms", href: "/terms" },
      ],
      trust_text: "Licensed advisor network",
    },
    trust_strip: {
      enabled: true,
      source: "manual",
      logos: [
        { media_id: "logos/trust-a.png", alt: "Trust brand A" },
        { media_id: "logos/trust-b.png", alt: "Trust brand B" },
      ],
      placement: "below_unit",
    },
  };
}

export interface QuoteBuilderSeed {
  siteA: { id: string; name: string; logoKey: string };
  siteB: { id: string; name: string; logoKey: string };
  siteC: { id: string; name: string };
  quotePublicId: string;
  funnelPublicId: string;
  controlVariantId: string;
  armBVariantId: string;
  sections: Array<{ id: number; publicId: string; name: string }>;
}

async function createBareSite(request: APIRequestContext, host: string, name: string): Promise<string> {
  const created = await json<{ resource: { id: string } }>(
    await request.post("/api/admin/sites", {
      data: { domain: host, name, vertical_slug: "finance", activity: "main" },
    }),
    `site create ${host}`,
  );
  return created.resource.id;
}

async function setSiteBranding(
  request: APIRequestContext,
  siteId: string,
  siteName: string,
  logoKey: string,
): Promise<void> {
  await json(
    await request.patch("/api/admin/settings", {
      data: { site_id: siteId, updates: { site_name: siteName, logo_media_id: logoKey } },
    }),
    `settings ${siteId}`,
  );
}

export async function seedQuoteBuilder(request: APIRequestContext, uniq: string): Promise<QuoteBuilderSeed> {
  // --- sites + branding ------------------------------------------------------
  const nameA = `LG B Site A ${uniq}`;
  const nameB = `LG B Site B ${uniq}`;
  const nameC = `LG B Site C ${uniq}`;
  const siteAId = await seedActiveSite(request, `lg-b-a-${uniq}.e2e.test`, nameA);
  const siteBId = await createBareSite(request, `lg-b-b-${uniq}.e2e.test`, nameB);
  const siteCId = await createBareSite(request, `lg-b-c-${uniq}.e2e.test`, nameC);
  const logoA = await uploadPng(request, `lg-b-logo-a-${uniq}.png`);
  const logoB = await uploadPng(request, `lg-b-logo-b-${uniq}.png`);
  await setSiteBranding(request, siteAId, nameA, logoA.storage_key);
  await setSiteBranding(request, siteBId, nameB, logoB.storage_key);

  // --- three ordered Sections (question units only) ---------------------------
  const sections: Array<{ id: number; publicId: string; name: string }> = [];
  for (let i = 0; i < 3; i += 1) {
    const name = `LG B slide ${i + 1} ${uniq}`;
    const created = await json<{ id: number; public_id: string }>(
      await request.post(`${LG_API}/sections`, {
        data: {
          section_name: name,
          activity: "quote_funnel",
          vertical: "life",
          headline_text: SLIDE_HEADLINES[i],
          continue_mode: "button",
          status: "active",
          content_json: slideContent(i),
        },
      }),
      `section create ${i + 1}`,
    );
    sections.push({ id: created.id, publicId: created.public_id, name });
  }

  // --- quote + variant order ---------------------------------------------------
  const quote = await json<{ public_id: string; funnels: Array<{ public_id: string; variants: Array<{ public_id: string }> }> }>(
    await request.post(`${LG_API}/quotes`, {
      data: { quote_name: `LG B Quote ${uniq}`, activity: "quote_funnel", verticals: ["life"] },
    }),
    "quote create",
  );
  const funnelPublicId = quote.funnels[0]!.public_id;
  const controlVariantId = quote.funnels[0]!.variants[0]!.public_id;
  await json(
    await request.put(`${LG_API}/variants/${controlVariantId}`, {
      data: { sections: sections.map((s, position) => ({ section_id: s.id, position })) },
    }),
    "variant sections",
  );

  // --- frame config through the REAL frame API --------------------------------
  await json(
    await request.put(`${LG_API}/funnels/${funnelPublicId}/frame`, {
      data: { frame_config_json: seededFrameConfig() },
    }),
    "frame config",
  );

  // --- activations: A enabled · C disabled · B none ----------------------------
  await json(
    await request.put(`${LG_API}/quotes/${quote.public_id}/activation/${siteAId}`, {
      data: { enabled: true, slug: `lg-b-${uniq}` },
    }),
    "activation site A",
  );
  await json(
    await request.put(`${LG_API}/quotes/${quote.public_id}/activation/${siteCId}`, {
      data: { enabled: false, slug: `lg-b-off-${uniq}` },
    }),
    "activation site C (off)",
  );

  // --- the non-control arm with a progress override (§4.5 badge fixture) ------
  const forkRes = await request.post(`${LG_API}/variants/${controlVariantId}/fork`);
  expect(forkRes.status(), `fork: ${await forkRes.text()}`).toBe(201);
  const armB = (await forkRes.json()) as { public_id: string };
  await json(
    await request.put(`${LG_API}/variants/${armB.public_id}`, {
      data: { frame_overrides_json: { progress: { style: "dots" } } },
    }),
    "arm B overrides",
  );

  return {
    siteA: { id: siteAId, name: nameA, logoKey: logoA.storage_key },
    siteB: { id: siteBId, name: nameB, logoKey: logoB.storage_key },
    siteC: { id: siteCId, name: nameC },
    quotePublicId: quote.public_id,
    funnelPublicId,
    controlVariantId,
    armBVariantId: armB.public_id,
    sections,
  };
}
