// POST /api/admin/leadgen/offers/:id/creative-preview — the Static tab's live
// banner preview (0060, leadgen/static-creative.ts).
//
// The card is rendered by the SAME renderBanners the live auction uses, fed a
// carrier built from the SAME staticCreativeDisplay, and styled by the SAME
// funnel + banner stylesheets inside the same container markup — so "what
// marketing sees here" and "what a visitor sees" are one code path, not a
// look-alike. Nothing is saved: the body carries the form's current (unsaved)
// values. Differences from a live page, stated in the editor: the default
// theme (a Quote's own colours are not applied) and a /media logo resolved
// against this admin origin rather than the funnel's domain.

import type { AdminContext } from "./offers-handlers";
import { readJsonBody, resolveOfferRow } from "./offers-handlers";
import { STATIC_CREATIVE_FIELDS, requestOrigin, staticCreativeDisplay, validateStaticCreativeField } from "../../leadgen/static-creative";
import { renderBanners } from "../../public/leadgen/auction/banner";
import { getBannerDesign } from "../../public/leadgen/designs/registry";
import { funnelChromeCss, DEFAULT_FUNNEL_SCOPE } from "../../public/leadgen/designs/default-funnel/styles";
import { defaultFunnelDesign } from "../../public/leadgen/designs/default-funnel/tokens";
import type { LeadgenParsedCarrier } from "../../public/leadgen/auction/parse";

function optText(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

export async function offerCreativePreviewHandler(c: AdminContext): Promise<Response> {
  const row = await resolveOfferRow(c.env.DB, c.req.param("id") ?? "");
  if (row === null) return c.json({ error: "Not Found" }, 404);
  const body = (await readJsonBody(c)) ?? {};

  const merged: Record<string, unknown> = { ...row };
  const fields: Record<string, string> = {};
  for (const key of STATIC_CREATIVE_FIELDS) {
    if (body[key] === undefined) continue;
    const v = validateStaticCreativeField(key, body[key]);
    if (v.ok) merged[key] = v.value;
    else fields[key] = v.error;
  }
  if (Object.keys(fields).length > 0) return c.json({ error: "Validation failed", fields }, 400);
  // The form's unsaved identity/destination, so the preview matches the page.
  for (const key of ["provider", "offer_name", "banner_url_template", "static_fallback_banner_url"] as const) {
    if (body[key] !== undefined) merged[key] = optText(body[key]);
  }

  const display = staticCreativeDisplay(
    merged as Parameters<typeof staticCreativeDisplay>[0],
    requestOrigin(c.req.url),
  );
  const fallback = optText(merged["static_fallback_banner_url"]);
  const bid = typeof row.static_bid_value === "number" && Number.isFinite(row.static_bid_value) ? row.static_bid_value : 0;
  const carrier: LeadgenParsedCarrier = {
    carrier_key: "preview",
    carrier_key_source: "slug",
    ...display,
    bid,
    bid_currency: row.static_bid_currency,
    click_url: fallback !== null && /^https?:\/\//i.test(fallback) ? fallback : null,
    tracking_id: null,
    pricing_model: "static",
  };
  const result = renderBanners(
    [
      {
        carrier,
        offer_public_id: row.public_id,
        slot: 1,
        source: "static_bid",
        bid,
        banner_url_template: optText(merged["banner_url_template"]),
      },
    ],
    { auction_instance_id: null, canonical_macros: {} },
    { mode: "automatic" },
    getBannerDesign(null),
    { mintId: () => "preview" },
  );
  // The card is a live /lg/lc link on the funnel; in the preview it must not
  // navigate (the admin host has no /lg routes), so it is made non-interactive
  // in the preview stylesheet only. The live card hides a logo that fails to
  // load (an inline onerror). Here the
  // opposite is wanted — a broken logo must stay VISIBLE to the person editing
  // it — and the preview frame runs no scripts at all, so the handler is
  // dropped from the preview copy only.
  const previewHtml = result.html.split(` onerror="this.style.display='none'"`).join("");
  const css = `${funnelChromeCss(defaultFunnelDesign, DEFAULT_FUNNEL_SCOPE)}\n${result.css}\nhtml,body{margin:0;padding:0;background:#f5f7fb}html{overflow:hidden}body{padding:16px}.lg-banner{pointer-events:none;cursor:default}`;
  const document =
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<style>${css.replace(/<\/style/gi, "<\\/style")}</style></head><body>` +
    `<div data-funnel-design="default-funnel"><div class="lg-banners" data-lg-banners>${previewHtml}</div></div>` +
    `</body></html>`;
  return c.json({
    document,
    shown: result.slots.length === 1,
    dropped_reason: result.dropped[0]?.carrier_filtered_reason ?? null,
  });
}
