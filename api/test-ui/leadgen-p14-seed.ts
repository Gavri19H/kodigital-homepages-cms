// LeadGen P14 (§27 GA4 + §28 performance) — shared e2e seed helper (NOT a spec).
//
// Seeds an ACTIVE tenant + an activated single-section funnel through the REAL
// admin APIs (reusing seedActiveSite from the listicles seed). The activation can
// carry a per-site GA4 measurement id (settings_overrides_json.ga4_measurement_id)
// — the resolver reads it and the shell bakes the §27 gtag snippet in. The section
// is a plain TwoButtonYesNo (NO address component) so the Google Maps SDK is never
// loaded — keeping the §28 funnel-runtime-JS budget measurement clean.

import { type APIRequestContext } from "@playwright/test";
import { seedActiveSite } from "./listicles-p6-seed";

const LG_API = "/api/admin/leadgen";

export interface SeededP14Funnel {
  host: string;
  siteId: string;
  slug: string;
  funnelId: string;
  variantId: string;
  ga4MeasurementId: string | null;
}

async function json<T>(
  res: { ok(): boolean; status(): number; json(): Promise<unknown>; text(): Promise<string> },
  label: string,
): Promise<T> {
  if (!res.ok()) throw new Error(`${label} HTTP ${res.status()}: ${await res.text()}`);
  return (await res.json()) as T;
}

export interface SeedP14Options {
  hostPrefix: string;
  slug: string;
  /** when set, baked into the activation's settings_overrides_json + the shell */
  ga4MeasurementId?: string | null;
}

export async function seedActivatedFunnel(
  request: APIRequestContext,
  opts: SeedP14Options,
): Promise<SeededP14Funnel> {
  const uniq = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const host = `${opts.hostPrefix}-${uniq}.e2e.test`;
  const siteId = await seedActiveSite(request, host, `LeadGen P14 ${uniq}`);

  const quote = await json<{
    public_id: string;
    funnels: Array<{ public_id: string; variants: Array<{ public_id: string }> }>;
  }>(
    await request.post(`${LG_API}/quotes`, {
      data: { quote_name: `P14 Quote ${uniq}`, activity: "quote_funnel", verticals: ["life"] },
    }),
    "quote create",
  );
  const funnelId = quote.funnels[0]!.public_id;
  const variantId = quote.funnels[0]!.variants[0]!.public_id;

  const section = await json<{ id: number; public_id: string }>(
    await request.post(`${LG_API}/sections`, {
      data: {
        section_name: `P14 section ${uniq}`,
        activity: "quote_funnel",
        vertical: "life",
        headline_text: "Are you covered?",
        status: "active",
        content_json: JSON.stringify({
          components: [
            {
              type: "TwoButtonYesNo",
              question_id: "q1",
              question_key: "covered",
              internal_field: "covered",
              answer_type: "boolean",
            },
          ],
        }),
      },
    }),
    "section create",
  );

  await json(
    await request.put(`${LG_API}/variants/${variantId}`, { data: { sections: [{ section_id: section.id }] } }),
    "variant sections",
  );

  const ga4MeasurementId = opts.ga4MeasurementId ?? null;
  const activationData: Record<string, unknown> = { enabled: true, slug: opts.slug };
  if (ga4MeasurementId !== null) {
    // putActivationHandler stringifies an object settings_overrides_json; the
    // resolver's readGa4MeasurementId parses ga4_measurement_id back out (§24b/§27).
    activationData.settings_overrides_json = { ga4_measurement_id: ga4MeasurementId };
  }
  await json(
    await request.put(`${LG_API}/quotes/${quote.public_id}/activation/${siteId}`, { data: activationData }),
    "activation",
  );

  return { host, siteId, slug: opts.slug, funnelId, variantId, ga4MeasurementId };
}
