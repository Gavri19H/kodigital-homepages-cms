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
//   * a NON-CONTROL arm (create experiment -> start -> fork the control,
//     the Rework M1 §4.3-10 arm-bootstrap flow) whose frame_overrides_json
//     overrides progress (style dots) — the §4.5 override-badge fixture.
//     armBVariantId is null only if that sanctioned flow itself fails (a
//     real regression, not an expected state) — see armBBlockedReason on
//     QuoteBuilderSeed.

import type { APIRequestContext } from "@playwright/test";
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
  // Rework M1 (§4.3-10) + conductor extension round 2: the sanctioned arm-
  // bootstrap flow is create experiment -> start -> fork the control (only
  // legal in that exact running-1-arm state) -> both arms rebalance to
  // 5000/5000. Caught rather than thrown so this ALWAYS resolves (never
  // null in the happy path); armBVariantId stays null ONLY if that flow
  // itself regresses — a real failure, not an expected state — see
  // armBBlockedReason.
  armBVariantId: string | null;
  armBBlockedReason: string | null;
  sections: Array<{ id: number; publicId: string; name: string }>;
  // Phase D (C2 row ⑨): a SECOND Quote with a configured frame (compat OFF)
  // whose single Section carries a raw-API-inserted legacy chrome node
  // (StepIndicator — a §8.2 scope:"frame" type; the studio palette can no
  // longer author one, so the API insert IS the legacy path). No activation
  // rows — the row activates (and 409s) inside the test.
  chromeQuote: {
    quotePublicId: string;
    funnelPublicId: string;
    variantId: string;
    sectionPublicId: string;
    sectionName: string;
  };
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

  // --- quote-owned shared first page (Rework M2, §4.3-1/§4.3-15) --------------
  // Activation now requires the quote's shared first page to carry ≥1 section,
  // distinct from any section already placed on a variant (§4.3-13 uniqueness) —
  // seeded through the real POST /quotes/:id/shared-page route.
  const sharedSection = await json<{ id: number; public_id: string }>(
    await request.post(`${LG_API}/sections`, {
      data: {
        section_name: `LG B shared slide ${uniq}`,
        activity: "quote_funnel",
        vertical: "life",
        headline_text: "Before we start",
        continue_mode: "button",
        status: "active",
        content_json: {
          components: [
            {
              type: "TwoButtonYesNo",
              question_id: "q_shared_intro",
              internal_field: "shared_intro",
              props: { yesLabel: "Yes", noLabel: "No" },
            },
          ],
        },
      },
    }),
    "shared section create",
  );
  await json(
    await request.post(`${LG_API}/quotes/${quote.public_id}/shared-page`, {
      data: { sections: [{ section_id: sharedSection.id, position: 0 }] },
    }),
    "shared page create",
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
  // Rework M1 (§4.3-10) + conductor extension round 2: fork bootstraps a
  // SECOND active arm ONLY as the running-test 1→2 transition — the
  // sanctioned HTTP flow is create experiment (draft) -> start (running;
  // trivially Σ=10000 with the lone control arm) -> fork the control (NOW
  // legal: exactly 1 active arm + a running test) -> both arms rebalance to
  // 5000/5000, forked arm labelled 'B'. See test/leadgen-rework-handlers.test.ts's
  // "full A/B lifecycle" test for the reference sequence this mirrors.
  let armBVariantId: string | null = null;
  let armBBlockedReason: string | null = null;
  const experimentRes = await json<{ public_id: string; status: string }>(
    await request.post(`${LG_API}/funnels/${funnelPublicId}/experiments`, { data: { name: `LG B experiment ${uniq}` } }),
    "create experiment",
  );
  const startRes = await request.post(`${LG_API}/experiments/${experimentRes.public_id}/start`);
  if (startRes.status() === 200) {
    const forkRes = await request.post(`${LG_API}/variants/${controlVariantId}/fork`);
    if (forkRes.status() === 201) {
      const armB = (await forkRes.json()) as { public_id: string };
      armBVariantId = armB.public_id;
      await json(
        await request.put(`${LG_API}/variants/${armB.public_id}`, {
          data: { frame_overrides_json: { progress: { style: "dots" } } },
        }),
        "arm B overrides",
      );
    } else {
      // Safety net, loud on purpose: the create->start->fork sequence is the
      // sanctioned, already-proven flow (see the reference test cited above)
      // — if fork STILL refuses here, that is a genuine regression in the
      // bootstrap mechanism, not an expected/silent state. Caught (rather
      // than thrown) only so the REST of this fixture still seeds for
      // consumers that don't need a second arm; armBBlockedReason surfaces
      // the real HTTP body loudly to any consumer that does.
      armBBlockedReason = `fork after experiment start returned ${forkRes.status()}: ${await forkRes.text()}`;
    }
  } else {
    armBBlockedReason = `experiment start returned ${startRes.status()}: ${await startRes.text()}`;
  }

  // --- Phase D C2 fixture: chrome-in-a-section quote (frame configured, no
  // --- activation). The chrome node rides the RAW section API (a save-time
  // --- WARNING per DEV-56 — it persists; the §14.1 BLOCK fires at activation).
  const chromeSectionName = `LG D chrome slide ${uniq}`;
  const chromeSection = await json<{ id: number; public_id: string }>(
    await request.post(`${LG_API}/sections`, {
      data: {
        section_name: chromeSectionName,
        activity: "quote_funnel",
        vertical: "life",
        headline_text: "Where are you located?",
        continue_mode: "button",
        status: "active",
        content_json: {
          components: [
            { type: "StepIndicator", question_id: "si1", props: { steps: 3, current: 1 } },
            { type: "QuestionHeadline", question_id: "h1", props: { text: "Where are you located?" } },
            {
              type: "TwoButtonYesNo",
              question_id: "q_chrome",
              internal_field: "chrome_answer",
              props: { yesLabel: "Yes", noLabel: "No" },
            },
          ],
        },
      },
    }),
    "chrome section create",
  );
  const chromeQuoteRes = await json<{
    id: number;
    public_id: string;
    funnels: Array<{ public_id: string; variants: Array<{ public_id: string }> }>;
  }>(
    await request.post(`${LG_API}/quotes`, {
      data: { quote_name: `LG D Chrome Quote ${uniq}`, activity: "quote_funnel", verticals: ["life"] },
    }),
    "chrome quote create",
  );
  const chromeFunnelId = chromeQuoteRes.funnels[0]!.public_id;
  const chromeVariantId = chromeQuoteRes.funnels[0]!.variants[0]!.public_id;
  await json(
    await request.put(`${LG_API}/variants/${chromeVariantId}`, {
      data: { sections: [{ section_id: chromeSection.id, position: 0 }] },
    }),
    "chrome variant sections",
  );
  await json(
    await request.put(`${LG_API}/funnels/${chromeFunnelId}/frame`, {
      data: { frame_config_json: { version: 1, template: "centered" } }, // compat defaults OFF
    }),
    "chrome quote frame",
  );

  // Rework M2 (§4.3-1, §4.3-15): this is a SEPARATE quote, so it needs its
  // OWN shared-page seed too — the test activates it directly (both the
  // expected-409 C2 attempt and the expected-200 post-compat-override
  // attempt), and the shared-page precondition is independent of the C2
  // chrome-in-section problem the test is actually about.
  const chromeSharedSection = await json<{ id: number; public_id: string }>(
    await request.post(`${LG_API}/sections`, {
      data: {
        section_name: `LG D chrome shared slide ${uniq}`,
        activity: "quote_funnel",
        vertical: "life",
        headline_text: "Before we start",
        continue_mode: "button",
        status: "active",
        content_json: {
          components: [
            {
              type: "TwoButtonYesNo",
              question_id: "q_chrome_shared_intro",
              internal_field: "chrome_shared_intro",
              props: { yesLabel: "Yes", noLabel: "No" },
            },
          ],
        },
      },
    }),
    "chrome shared section create",
  );
  await json(
    await request.post(`${LG_API}/quotes/${chromeQuoteRes.public_id}/shared-page`, {
      data: { sections: [{ section_id: chromeSharedSection.id, position: 0 }] },
    }),
    "chrome shared page create",
  );

  return {
    siteA: { id: siteAId, name: nameA, logoKey: logoA.storage_key },
    siteB: { id: siteBId, name: nameB, logoKey: logoB.storage_key },
    siteC: { id: siteCId, name: nameC },
    quotePublicId: quote.public_id,
    funnelPublicId,
    controlVariantId,
    armBVariantId,
    armBBlockedReason,
    sections,
    chromeQuote: {
      quotePublicId: chromeQuoteRes.public_id,
      funnelPublicId: chromeFunnelId,
      variantId: chromeVariantId,
      sectionPublicId: chromeSection.public_id,
      sectionName: chromeSectionName,
    },
  };
}
