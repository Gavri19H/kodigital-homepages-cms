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
