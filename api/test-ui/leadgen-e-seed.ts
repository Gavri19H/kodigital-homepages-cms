// LeadGen v2.5.1 Phase E (slice E1) — shared e2e seed for the §8.7 capability
// patterns + the §15.4 visual-regression set (NOT a spec).
//
// Seeds THROUGH THE REAL admin HTTP APIs only (the leadgen-b-seed /
// leadgen-c-seed convention — no direct DB writes):
//   * one branded CMS site (seedActiveSite + media upload → site_settings
//     logo_media_id) — the §10.2 site-branding inheritance every pattern
//     frame consumes AND the /lg tenant host the §15.4 pages are served on;
//   * a feeder Offer per file (the /sections/new Activity/Vertical dropdowns
//     are sourced from Offers — the leadgen-studio-patterns E1 idiom);
//   * two filler question Sections so pattern funnels are REAL 3-step
//     funnels (frame progress counts the variant order, 11 §11.1);
//   * per-pattern Quote scaffolds (quote → funnel → control variant →
//     ordered sections) with a BOOTSTRAP frame config via the REAL
//     PUT /funnels/:id/frame. The bootstrap carries ONLY (a) an OFF-target
//     template — so the spec's template pick through the picker UI is a REAL
//     C5 switch — and (b) the minimal "region visible" content for regions
//     the canvas-click inspector model cannot otherwise reach (04 §4.1:
//     clicking a rendered region is the ONLY inspector opener; frame.ts
//     renders trust_strip/benefit_bar ONLY when enabled AND non-empty). The
//     pattern's ACTUAL region config is then authored through the opened
//     inspector in the spec — media picker rows, icon selects, list rows,
//     tagline/CTA/disclosure fields — and persisted by the ONE Save.
//   * activation rows (PUT /quotes/:id/activation/:siteId) for the §15.4
//     live /lg pages — pattern units select NO Offers, so activation is a
//     clean 200 (the leadgen-visual.spec.ts precedent).

import { expect, type APIRequestContext } from "@playwright/test";
import { seedActiveSite, uploadPng } from "./listicles-p6-seed";

const LG_API = "/api/admin/leadgen";

export async function json<T>(
  res: { ok(): boolean; status(): number; json(): Promise<unknown>; text(): Promise<string> },
  label: string,
): Promise<T> {
  if (!res.ok()) throw new Error(`${label} HTTP ${res.status()}: ${await res.text()}`);
  return (await res.json()) as T;
}

// --- typed section shapes (the leadgen-studio-patterns idiom) ----------------

export interface StudioNode {
  type: string;
  question_id: string;
  question_key?: string;
  internal_field?: string;
  answer_type?: string;
  required?: boolean;
  bind?: string;
  choices?: Array<Record<string, unknown>>;
  choiceDisplay?: Record<string, unknown>;
  conditional?: Record<string, unknown>;
  props?: Record<string, unknown>;
  children?: StudioNode[];
  [key: string]: unknown;
}

export interface SectionDetail {
  id: number;
  public_id: string;
  content_version: number;
  headline_text: string;
  content_json: { components: StudioNode[] };
  [key: string]: unknown;
}

// --- branded site (frame logo inheritance + the /lg tenant host) -------------

export interface PatternSite {
  id: string;
  name: string;
  host: string;
  logoKey: string;
}

export async function seedBrandedSite(request: APIRequestContext, uniq: string): Promise<PatternSite> {
  const name = `LG E1 Brand Site ${uniq}`;
  const host = `lg-e1-${uniq}.e2e.test`;
  const siteId = await seedActiveSite(request, host, name);
  const logo = await uploadPng(request, `lg-e1-logo-${uniq}.png`);
  await json(
    await request.patch("/api/admin/settings", {
      data: { site_id: siteId, updates: { site_name: name, logo_media_id: logo.storage_key } },
    }),
    "e1 site branding",
  );
  return { id: siteId, name, host, logoKey: logo.storage_key };
}

// --- feeder Offer (makes the file's activity/vertical pair pickable) ---------

export async function seedFeederOffer(
  request: APIRequestContext,
  opts: { uniq: string; activity: string; vertical: string },
): Promise<void> {
  await json(
    await request.post(`${LG_API}/offers`, {
      data: {
        offer_name: `E1 Feeder ${opts.uniq}`,
        provider: "e1prov",
        activity: opts.activity,
        vertical: opts.vertical,
        conversion_tracking_method: "s2s_postback",
        offer_type: "cpc",
        placements: [`pl-e1-${opts.uniq}`],
        calls_provider_api: false,
        bid_source: "static",
        cap_enabled: false,
      },
    }),
    "e1 feeder offer create",
  );
}

// --- filler sections (REAL 3-step progress values) ----------------------------

export async function seedFillerSections(
  request: APIRequestContext,
  opts: { uniq: string; activity: string; vertical: string },
): Promise<number[]> {
  const ids: number[] = [];
  for (let i = 0; i < 2; i += 1) {
    const created = await json<{ id: number; public_id: string }>(
      await request.post(`${LG_API}/sections`, {
        data: {
          section_name: `E1 filler ${i + 1} ${opts.uniq}`,
          activity: opts.activity,
          vertical: opts.vertical,
          // RUN-STABLE rendered copy (the §15.4 committed baselines screenshot
          // slide 1 only, but keep every slide deterministic on principle).
          headline_text: i === 0 ? "Do you currently have coverage?" : "When do you need it?",
          continue_mode: "button",
          status: "active",
          content_json: {
            components: [
              {
                type: "TwoButtonYesNo",
                question_id: `q_fill${i + 1}`,
                internal_field: `filler_${i + 1}`,
                answer_type: "boolean",
                props: { yesLabel: "Yes", noLabel: "No" },
              },
            ],
          },
        },
      }),
      `e1 filler section ${i + 1}`,
    );
    ids.push(created.id);
  }
  return ids;
}

// --- pattern quote scaffold (quote → funnel → variant → order → bootstrap) ---

export interface PatternScaffold {
  quotePublicId: string;
  funnelPublicId: string;
  variantPublicId: string;
}

// LEADGEN-REWORK-03 S5.2 follow-up (§4.3-1/§4.3-15): activation now requires
// the quote's OWN shared first page to carry ≥1 section, distinct from any
// section already placed on a variant (§4.3-13 uniqueness) — the SAME
// "trivial shared page" precedent already established in
// leadgen-fix-p1-seed.ts (a bare ContinueButton, no real question — the
// shared page's ONLY job here is satisfying the activation precondition,
// never testing shared-page authoring itself) and leadgen-b-seed.ts (POST
// /quotes/:id/shared-page with one freshly-created section). Every
// seedPatternQuote call gets its OWN shared section (unique per quote, no
// cross-quote reuse) so activateQuoteOnSite stops 409ing on
// "activation.shared_page: needs at least one section" — confirmed live
// this phase (reproduced + root-caused: this precondition post-dates the
// pre-rework version of this helper, which never needed it).
async function seedTrivialSharedPage(
  request: APIRequestContext,
  quotePublicId: string,
  opts: { activity: string; vertical: string; uniq: string },
): Promise<void> {
  // The shared-page section's activity/vertical MUST match the quote's own
  // (validateSection rejects a mismatch — confirmed live this phase: a
  // hardcoded "quote_funnel"/"life" 400'd against every pattern's own
  // per-file ACT/VERT values).
  const shared = await json<{ id: number; public_id: string }>(
    await request.post(`${LG_API}/sections`, {
      data: {
        section_name: `E1 shared ${opts.uniq}`,
        activity: opts.activity,
        vertical: opts.vertical,
        headline_text: "Continue",
        continue_mode: "button",
        status: "active",
        content_json: {
          components: [{ type: "ContinueButton", question_id: "shared_continue", props: { label: "Continue" } }],
        },
      },
    }),
    "e1 shared page section create",
  );
  await json(
    await request.post(`${LG_API}/quotes/${quotePublicId}/shared-page`, {
      data: { sections: [{ section_id: shared.id }] },
    }),
    "e1 shared page create",
  );
}

export async function seedPatternQuote(
  request: APIRequestContext,
  opts: {
    name: string;
    activity: string;
    vertical: string;
    sectionIds: number[];
    /** Bootstrap frame config (OFF-target template + region-visibility minimums). */
    frame: Record<string, unknown>;
  },
): Promise<PatternScaffold> {
  const quote = await json<{
    public_id: string;
    funnels: Array<{ public_id: string; variants: Array<{ public_id: string }> }>;
  }>(
    await request.post(`${LG_API}/quotes`, {
      data: { quote_name: opts.name, activity: opts.activity, verticals: [opts.vertical] },
    }),
    `e1 quote create (${opts.name})`,
  );
  const funnelPublicId = quote.funnels[0]!.public_id;
  const variantPublicId = quote.funnels[0]!.variants[0]!.public_id;
  await json(
    await request.put(`${LG_API}/variants/${variantPublicId}`, {
      data: { sections: opts.sectionIds.map((id, position) => ({ section_id: id, position })) },
    }),
    `e1 variant sections (${opts.name})`,
  );
  await json(
    await request.put(`${LG_API}/funnels/${funnelPublicId}/frame`, {
      data: { frame_config_json: opts.frame },
    }),
    `e1 bootstrap frame (${opts.name})`,
  );
  // A per-quote-unique shared-section name derives from the quote's own
  // public_id (always unique) rather than threading a new "uniq" parameter
  // through every existing call site.
  await seedTrivialSharedPage(request, quote.public_id, {
    activity: opts.activity,
    vertical: opts.vertical,
    uniq: quote.public_id,
  });
  return { quotePublicId: quote.public_id, funnelPublicId, variantPublicId };
}

// --- reads + activation --------------------------------------------------------

// The GET /frame projection: `frame_config` is the SPARSE stored config
// (template switches persist ONLY version+template+preserved operator
// content — computeTemplateSwitch; DEV-57 byte-identity guard), while
// `effective_frame` is template ⊕ stored (13 §13.2 — what renders). Specs
// assert OPERATOR-AUTHORED fields on the stored config and
// TEMPLATE-DEFAULT-derived fields on the effective one.
export interface FrameState {
  stored: Record<string, unknown>;
  effective: Record<string, unknown>;
}

export async function fetchFrameState(
  request: APIRequestContext,
  funnelPublicId: string,
): Promise<FrameState> {
  const body = await json<{
    frame_config: Record<string, unknown>;
    effective_frame: Record<string, unknown>;
  }>(await request.get(`${LG_API}/funnels/${funnelPublicId}/frame`), `e1 frame read (${funnelPublicId})`);
  return { stored: body.frame_config, effective: body.effective_frame };
}

export async function fetchSectionDetail(
  request: APIRequestContext,
  publicId: string,
): Promise<SectionDetail> {
  return json<SectionDetail>(
    await request.get(`${LG_API}/sections/${publicId}`),
    `e1 section detail (${publicId})`,
  );
}

export async function activateQuoteOnSite(
  request: APIRequestContext,
  quotePublicId: string,
  siteId: string,
  slug: string,
): Promise<void> {
  const res = await request.put(`${LG_API}/quotes/${quotePublicId}/activation/${siteId}`, {
    data: { enabled: true, slug },
  });
  expect(res.ok(), `e1 activation (${slug}): HTTP ${res.status()} ${await res.text()}`).toBeTruthy();
}

// =============================================================================
// E3 (§15.3 "Runtime (live /lg fixtures)" rows) seed extensions — ADDITIVE
// ONLY; nothing above changes (E1's 10 tests keep their exact inputs). Same
// convention: the REAL admin HTTP APIs, no direct DB writes.
// =============================================================================

export interface RuntimeSectionSeed {
  id: number;
  publicId: string;
}

async function createRuntimeSection(
  request: APIRequestContext,
  data: Record<string, unknown>,
  label: string,
): Promise<RuntimeSectionSeed> {
  const created = await json<{ id: number; public_id: string }>(
    await request.post(`${LG_API}/sections`, { data }),
    label,
  );
  return { id: created.id, publicId: created.public_id };
}

// --- rows ①–④: three DISTINCT question units --------------------------------
//
// The §15.3 row ① funnel needs the SAME frame around three sections whose UNIT
// content genuinely differs, and rows ①/③ drive the REAL engine through them:
// every unit is continue_mode "button" with auto_advance OFF and an explicit
// ContinueButton, so each advance is a real answered-question + Continue click
// (never an auto-advance shortcut). Headlines and copy are RUN-STABLE; uniq
// rides only the never-rendered section names.
export async function seedRuntimeUnitSections(
  request: APIRequestContext,
  opts: { uniq: string; activity: string; vertical: string },
): Promise<RuntimeSectionSeed[]> {
  const defs: Array<{ name: string; headline: string; components: unknown[] }> = [
    {
      name: `E3 runtime unit 1 ${opts.uniq}`,
      headline: "Do you currently have coverage?",
      components: [
        {
          type: "TwoButtonYesNo",
          question_id: "q_e3_yesno",
          internal_field: "e3_has_coverage",
          answer_type: "boolean",
          required: true,
          props: { yesLabel: "Yes", noLabel: "No", auto_advance: false },
        },
        { type: "ContinueButton", question_id: "q_e3_cont1", props: { label: "Continue" } },
      ],
    },
    {
      name: `E3 runtime unit 2 ${opts.uniq}`,
      headline: "Who is the coverage for?",
      components: [
        {
          type: "IconCardAnswerGrid",
          question_id: "q_e3_cards",
          internal_field: "e3_coverage_for",
          answer_type: "enum",
          required: true,
          choices: [
            { label: "Just me", value: "self", analytics_id: "e3_self", icon: "🙋" },
            { label: "My family", value: "family", analytics_id: "e3_family", icon: "👪" },
          ],
          props: { columns: 2 },
        },
        { type: "ContinueButton", question_id: "q_e3_cont2", props: { label: "Continue" } },
      ],
    },
    {
      name: `E3 runtime unit 3 ${opts.uniq}`,
      headline: "When do you want it to start?",
      components: [
        {
          type: "ButtonAnswerGroup",
          question_id: "q_e3_group",
          internal_field: "e3_start_when",
          answer_type: "enum",
          required: true,
          choices: [
            { label: "As soon as possible", value: "asap", analytics_id: "e3_asap" },
            { label: "Within a month", value: "month", analytics_id: "e3_month" },
          ],
        },
        { type: "ContinueButton", question_id: "q_e3_cont3", props: { label: "Continue" } },
      ],
    },
  ];
  const out: RuntimeSectionSeed[] = [];
  for (const [i, def] of defs.entries()) {
    out.push(
      await createRuntimeSection(
        request,
        {
          section_name: def.name,
          activity: opts.activity,
          vertical: opts.vertical,
          headline_text: def.headline,
          continue_mode: "button",
          status: "active",
          content_json: { components: def.components },
        },
        `e3 runtime unit ${i + 1}`,
      ),
    );
  }
  return out;
}

// --- row ⑤: below_unit sections ----------------------------------------------
//
// Two units for the `section_slot.continue_placement:"below_unit"` funnel:
//   * unit 1 DECLARES an explicit ContinueButton node (label "Keep going") —
//     11 §11.5/C3: the in-node visual is suppressed and the node's props feed
//     the ONE end-of-subtree slot control;
//   * unit 2 declares NO ContinueButton — the slot control renders the
//     theme-default copy ("Continue"); a below_unit Section always shows
//     exactly one control.
export async function seedBelowUnitSections(
  request: APIRequestContext,
  opts: { uniq: string; activity: string; vertical: string },
): Promise<RuntimeSectionSeed[]> {
  const first = await createRuntimeSection(
    request,
    {
      section_name: `E3 below-unit 1 ${opts.uniq}`,
      activity: opts.activity,
      vertical: opts.vertical,
      headline_text: "Which coverage do you want to compare?",
      continue_mode: "button",
      status: "active",
      content_json: {
        components: [
          {
            type: "ButtonAnswerGroup",
            question_id: "q_e3bu_pick",
            internal_field: "e3bu_coverage",
            answer_type: "enum",
            required: true,
            choices: [
              { label: "Home", value: "home", analytics_id: "e3bu_home" },
              { label: "Auto", value: "auto", analytics_id: "e3bu_auto" },
            ],
          },
          { type: "ContinueButton", question_id: "q_e3bu_cont", props: { label: "Keep going" } },
        ],
      },
    },
    "e3 below-unit section 1",
  );
  const second = await createRuntimeSection(
    request,
    {
      section_name: `E3 below-unit 2 ${opts.uniq}`,
      activity: opts.activity,
      vertical: opts.vertical,
      headline_text: "Are you over 25?",
      continue_mode: "button",
      status: "active",
      content_json: {
        components: [
          {
            type: "TwoButtonYesNo",
            question_id: "q_e3bu_age",
            internal_field: "e3bu_over_25",
            answer_type: "boolean",
            required: true,
            props: { yesLabel: "Yes", noLabel: "No", auto_advance: false },
          },
        ],
      },
    },
    "e3 below-unit section 2",
  );
  return [first, second];
}

// --- row ⑥: the LIVE legacy (frame = NULL) funnel ------------------------------
//
// Mirrors the A0-pin funnel (test/leadgen-frame-legacy-pin.test.ts) through the
// REAL admin APIs so the SERVED /lg body can be byte-compared to the committed
// pin fixture:
//   * the SAME quote name ("Legacy Pin Quote" → the funnel_name "Legacy Pin
//     Quote — Funnel A" baked into <title> + #lg-config), the same
//     activity/vertical, the same three section content bodies + headlines +
//     continue_mode, seeded in the same order via the same API sequence
//     (create quote → PUT variant sections (position-less refs, exactly like
//     the pin) → activate) so content_version lands on the pinned value;
//   * NO frame PUT ever happens — leadgen_funnels.frame_config_json stays NULL
//     (13 §13.1: the byte-pinned renderLegacyShell path);
//   * the pin eliminated section-id variance with FIXED lgs_ ids via direct
//     SQL; the admin API MINTS lgs_ ids, so the spec normalizes exactly the
//     minted ids (returned here) + the section_order_hash they derive.
//
// LEGACY_PIN_SECTION_CONTENT below is a VERBATIM copy of that pin test's
// SECTION_SEEDS content (same key order — validateSection stores
// JSON.stringify of the parsed body, so byte-identical content_json requires
// byte-identical input literals). Any drift between the two files fails row
// ⑥'s byte-compare loudly — the committed fixture stays the single truth.
const LEGACY_PIN_SECTION_CONTENT = [
  {
    headline: "Are you insured?",
    content: {
      components: [
        { type: "ProgressBar", question_id: "p1", props: { mode: "percent", percent: 40 } },
        { type: "QuestionHeadline", question_id: "h1", props: { text: "Are you insured?" } },
        {
          type: "TwoButtonYesNo",
          question_id: "q_ins",
          question_key: "insured_q",
          internal_field: "currently_insured",
          answer_type: "boolean",
          required: true,
          props: { auto_advance: true },
        },
        {
          type: "DropdownQuestion",
          question_id: "q_insurer",
          question_key: "insurer_q",
          internal_field: "insurer",
          answer_type: "enum",
          choices: [
            { label: "Acme", value: "acme", analytics_id: "ins_acme" },
            { label: "Globex", value: "globex", analytics_id: "ins_globex" },
          ],
          conditional: { when: "currently_insured", op: "eq", value: true },
        },
        { type: "ContinueButton", question_id: "cont1", props: { label: "Continue" } },
      ],
    },
  },
  {
    headline: "What type of business?",
    content: {
      components: [
        { type: "ProgressBar", question_id: "p2", props: { mode: "percent", percent: 70 } },
        { type: "QuestionHeadline", question_id: "h2", props: { text: "What type of business?" } },
        {
          type: "IconCardAnswerGrid",
          question_id: "q_biz",
          question_key: "biz_q",
          internal_field: "biz_type",
          answer_type: "enum",
          required: true,
          choices: [
            { label: "Sole Proprietor", value: "sole_prop", analytics_id: "biz_sole", icon: "🏢" },
            { label: "Partnership", value: "partnership", analytics_id: "biz_partner", icon: "🏢" },
          ],
          props: { columns: 3 },
        },
        { type: "ContinueButton", question_id: "cont2", props: { label: "Continue" } },
      ],
    },
  },
  {
    headline: "Anything else we should know?",
    content: {
      components: [
        { type: "QuestionHeadline", question_id: "h3", props: { text: "Anything else we should know?" } },
        {
          type: "FreeTextQuestion",
          question_id: "q_note",
          question_key: "note_q",
          internal_field: "note",
          answer_type: "string",
          props: { placeholder: "Type…", maxLen: 100 },
        },
        { type: "ContinueButton", question_id: "cont3", props: { label: "Continue" } },
      ],
    },
  },
] as const;

export interface LegacyPinLiveFunnel {
  host: string;
  slug: string;
  /** The three MINTED lgs_ ids, in variant position order (the row-⑥ normalizer input). */
  sectionPublicIds: string[];
}

export async function seedLegacyPinLiveFunnel(
  request: APIRequestContext,
  uniq: string,
): Promise<LegacyPinLiveFunnel> {
  const host = `lg-e3-legacy-${uniq}.e2e.test`;
  const siteId = await seedActiveSite(request, host, `LG E3 Legacy Site ${uniq}`);
  // No branding PATCH: renderLegacyShell consumes no site branding, and the
  // legacy body carries no site name/host (verified against the fixture).

  const sections: RuntimeSectionSeed[] = [];
  for (const [i, seed] of LEGACY_PIN_SECTION_CONTENT.entries()) {
    sections.push(
      await createRuntimeSection(
        request,
        {
          section_name: `E3 legacy pin ${i + 1} ${uniq}`, // never rendered/served
          activity: "quote_funnel",
          vertical: "life",
          headline_text: seed.headline,
          continue_mode: "button",
          status: "active",
          content_json: seed.content,
        },
        `e3 legacy pin section ${i + 1}`,
      ),
    );
  }

  const quote = await json<{
    public_id: string;
    funnels: Array<{ public_id: string; variants: Array<{ public_id: string }> }>;
  }>(
    await request.post(`${LG_API}/quotes`, {
      data: { quote_name: "Legacy Pin Quote", activity: "quote_funnel", verticals: ["life"] },
    }),
    "e3 legacy pin quote create",
  );
  const variantId = quote.funnels[0]!.variants[0]!.public_id;
  // Position-less refs — the pin harness's exact PUT body shape.
  await json(
    await request.put(`${LG_API}/variants/${variantId}`, {
      data: { sections: sections.map((s) => ({ section_id: s.id })) },
    }),
    "e3 legacy pin variant sections",
  );
  // Deliberately NO PUT /funnels/:id/frame — frame_config_json stays NULL.
  // R2 P6: the SAME §4.3-1/§4.3-15 activation precondition seedPatternQuote
  // already satisfies above (seedTrivialSharedPage) applies here too — this
  // helper predates it and 409'd `activation.shared_page: "The shared first
  // page needs at least one section."`, killing this file's whole beforeAll
  // (1 fail + 5 did-not-run). Identical trivial ContinueButton shared page,
  // same precedent, activity/vertical matched to this quote's own.
  await seedTrivialSharedPage(request, quote.public_id, {
    activity: "quote_funnel",
    vertical: "life",
    uniq: quote.public_id,
  });
  await activateQuoteOnSite(request, quote.public_id, siteId, "legacy-pin");
  return { host, slug: "legacy-pin", sectionPublicIds: sections.map((s) => s.publicId) };
}
