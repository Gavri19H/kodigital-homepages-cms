// LeadGen banner render (contract 07 §20 + §19 step 14). Stage-A building
// block: PURE given its inputs (the caller supplies the surfaced carriers +
// the banner config + the resolved banner design — no I/O). Produces ONE
// `banner_render_id` for the render, the escaped HTML, the per-slot resolved
// data, one `carrier_impression` record per rendered slot, and the list of
// carriers DROPPED with their dedicated `carrier_filtered_reason` (§29 issue
// 31: reasons live in dedicated fields, never in answer_value_normalized).
//
// §20 modes (leadgen_auction_banners.mode + leadgen_auctions.banner_config_json):
//   * automatic — map ONLY the canonical normalized Carrier fields → slots via
//     `field_map_json` (validated by validateBannerFieldMap; unknown fields
//     rejected). resolveBannerSlots reads only the mapped canonical fields.
//   * manual — render the static `banner_config_json`
//     (headline/subheadline/logo/cta/legal) around each carrier's link.
//
// §20 / §10.5 missing click_url: when a carrier has no usable click_url, it is
// resolved from the Offer `banner_url_template` + the 32 canonical macros +
// `{response:<dotted.path>}` (macros.ts + parse.ts getAtPath). A REQUIRED
// response macro whose value is missing/empty ⇒ the carrier is DROPPED
// (`carrier_filtered_reason='missing_required_response_field'`) — never
// silently resolved to empty; an OPTIONAL missing macro resolves to its
// `safe_fallback`. No banner_url_template and no click_url ⇒ dropped
// (`missing_click_url`).
//
// SAFETY: every interpolated value is HTML-escaped; the href only accepts an
// absolute http(s) URL (a provider click_url that is not http(s) is treated as
// absent and falls through to banner_url_template); response/canonical macro
// values are encodeURIComponent-escaped by macros.ts / here before entering a
// URL. Reuses macros.ts / parse.ts / banner-default/styles.ts / registry.ts —
// no divergent re-implementation.

import { getAtPath, type LeadgenParsedCarrier } from "./parse";
import {
  analyzeResponseMacros,
  resolveMacros,
  responseMacroFallback,
  type LeadgenResponseMacroFallbacks,
} from "../../../leadgen/macros";
import {
  bannerChromeCss,
  resolveBannerSlots,
  validateBannerFieldMap,
  type CanonicalCarrierField,
  type LeadgenBannerFieldMap,
} from "../designs/banner-default/styles";
import type { BannerDesign } from "../designs/registry";
import type { SurfacedCarrierSource } from "../../../leadgen/auction-core";
import type { LeadgenBannerMode } from "../../../admin/leadgen/db-types";
import { ulid } from "../../../leadgen/ids";

// The dedicated §10.5 / §29 carrier drop reasons banner render can emit.
export type LeadgenCarrierFilteredReason =
  | "missing_required_response_field" // a required {response:*} macro had no value (§10.5)
  | "missing_click_url"; // no click_url AND no banner_url_template to resolve

// A surfaced carrier ready to render (07 §19 steps 12-15 output joined with the
// canonical Carrier display fields). `slot`/`source` come from auction-core
// (surfaceCarriers / applyBackfill); `carrier` is the parse.ts canonical shape.
export interface BannerRenderCarrier {
  carrier: LeadgenParsedCarrier;
  offer_public_id: string;
  slot: number;
  source: SurfacedCarrierSource;
  bid: number;
  // §10.5 missing-click_url resolution context (from the carrier's Offer).
  banner_url_template?: string | null;
  response_macro_fallbacks?: LeadgenResponseMacroFallbacks | null;
  // The raw provider data `{response:<path>}` resolves against (the caller
  // supplies it — keeps renderBanners pure/I/O-free).
  response_context?: unknown;
}

// Runtime render context (07 §19). `canonical_macros` are the request-derived
// macro values a banner_url_template's `{...}` tokens resolve against;
// `banner_design_id` selects the design (the caller resolves it via
// getBannerDesign and passes `design`).
export interface BannerAuctionContext {
  auction_instance_id?: string | null;
  banner_design_id?: string | null;
  canonical_macros?: Readonly<Record<string, string>>;
}

// The banner config for the render. `mode` + `field_map_json` come from
// leadgen_auction_banners; `banner_config_json` (manual static content) comes
// from leadgen_auctions (the caller joins them).
export interface BannerRenderConfig {
  mode: LeadgenBannerMode;
  field_map_json?: unknown;
  banner_config_json?: unknown;
}

export interface RenderedBannerSlot {
  slot: number;
  carrier_key: string;
  offer_public_id: string;
  source: SurfacedCarrierSource;
  bid: number;
  click_url: string;
  // Resolved slot data: automatic → { canonicalField: value }; manual → the
  // static banner_config_json fields used. For explainability/tests.
  fields: Record<string, unknown>;
  html: string;
}

// One carrier_impression per rendered slot (07 §19 step 14 / §18.9).
export interface CarrierImpression {
  banner_render_id: string;
  auction_instance_id: string | null;
  carrier_key: string;
  offer_public_id: string;
  slot: number;
  bid: number;
  source: SurfacedCarrierSource;
}

export interface DroppedCarrier {
  carrier_key: string;
  offer_public_id: string;
  slot: number;
  carrier_filtered_reason: LeadgenCarrierFilteredReason;
}

export interface BannerRenderResult {
  banner_render_id: string;
  // The scoped banner chrome CSS (bannerChromeCss(design)) — emit once.
  css: string;
  // The full rendered HTML (all slots) — escaped.
  html: string;
  slots: RenderedBannerSlot[];
  impressions: CarrierImpression[];
  dropped: DroppedCarrier[];
}

// The canonical fields that render as a dedicated visual region (mapped onto
// the banner-default CSS classes in bannerChromeCss). Fields not listed here
// (bid / bid_currency / tracking_id) still resolve into `fields` but carry no
// visual region of their own.
const FIELD_REGION_CLASS: Partial<Record<CanonicalCarrierField, string>> = {
  carrier_logo: "lg-banner-logo",
  carrier_name: "lg-banner-name",
  headline: "lg-banner-headline",
  subheadline: "lg-banner-subheadline",
  disclaimer: "lg-banner-disclaimer",
};

// The default automatic field map used when field_map_json is absent/invalid —
// surfaces the standard canonical regions so a render never silently blanks.
const DEFAULT_FIELD_MAP: LeadgenBannerFieldMap = {
  carrier_logo: "logo",
  carrier_name: "name",
  headline: "headline",
  subheadline: "subheadline",
  click_url: "cta",
  disclaimer: "disclaimer",
};

const DEFAULT_CTA_LABEL = "View";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Escape the five HTML-significant characters — used for BOTH text content and
// attribute values (double-quoted attributes; `"`/`'` both escaped).
function esc(value: unknown): string {
  const s = typeof value === "string" ? value : value === undefined || value === null ? "" : String(value);
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// A carrier/template value coerced to display text ("" for absent/objects).
function asText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

// True for an absolute http(s) URL — the only shape accepted directly into a
// banner href (guards against javascript:/data: and relative provider values).
function isHttpUrl(value: unknown): value is string {
  return typeof value === "string" && /^https?:\/\//i.test(value.trim());
}

// A single carrier's click destination (07 §20 / §10.5). Returns the resolved
// URL, or a drop reason when it cannot be resolved.
type ClickUrlResolution = { url: string } | { drop: LeadgenCarrierFilteredReason };

function resolveClickUrl(
  entry: BannerRenderCarrier,
  canonicalMacros: Readonly<Record<string, string>>,
): ClickUrlResolution {
  // A usable provider click_url wins (07 §20 "Missing click_url → resolve …").
  if (isHttpUrl(entry.carrier.click_url)) {
    return { url: entry.carrier.click_url.trim() };
  }

  const template = typeof entry.banner_url_template === "string" ? entry.banner_url_template.trim() : "";
  if (template === "") {
    return { drop: "missing_click_url" };
  }

  const refs = analyzeResponseMacros(template);
  // Required-missing ⇒ drop BEFORE building (never resolve to empty — §10.5).
  for (const ref of refs) {
    if (!ref.required) continue;
    const raw = getAtPath(entry.response_context, ref.path);
    if (raw === undefined || raw === null || asText(raw) === "") {
      return { drop: "missing_required_response_field" };
    }
  }

  // Canonical macros first (resolveMacros escapes them + leaves {response:*}
  // intact), then substitute each response token with its encoded value.
  let url = resolveMacros(template, canonicalMacros);
  for (const ref of refs) {
    const raw = getAtPath(entry.response_context, ref.path);
    const present = raw !== undefined && raw !== null && asText(raw) !== "";
    const value = ref.required
      ? asText(raw)
      : present
        ? asText(raw)
        : responseMacroFallback(entry.response_macro_fallbacks, ref.path);
    url = url.split(ref.token).join(encodeURIComponent(value));
  }
  return { url };
}

// Render one carrier's banner card. `slotData` is the resolved per-field data
// (automatic: canonical field → value; manual: the static config fields).
function renderCard(
  entry: BannerRenderCarrier,
  clickUrl: string,
  mode: LeadgenBannerMode,
  slotData: Record<string, unknown>,
  ctaLabel: string,
): string {
  const recommended = entry.source === "winner";
  const parts: string[] = [];

  if (mode === "manual") {
    const logo = asText(slotData["logo"]);
    if (logo !== "") {
      parts.push(`<img class="lg-banner-logo" src="${esc(logo)}" alt="${esc(slotData["headline"])}" />`);
    }
    const headline = asText(slotData["headline"]);
    if (headline !== "") parts.push(`<div class="lg-banner-name">${esc(headline)}</div>`);
    const subheadline = asText(slotData["subheadline"]);
    if (subheadline !== "") parts.push(`<div class="lg-banner-subheadline">${esc(subheadline)}</div>`);
    const legal = asText(slotData["legal"]);
    if (legal !== "") parts.push(`<div class="lg-banner-disclaimer">${esc(legal)}</div>`);
  } else {
    // automatic — render each mapped canonical field's region in a stable order.
    const order: CanonicalCarrierField[] = [
      "carrier_logo",
      "carrier_name",
      "headline",
      "subheadline",
      "disclaimer",
    ];
    for (const field of order) {
      if (!(field in slotData)) continue;
      const value = asText(slotData[field]);
      if (value === "") continue;
      const klass = FIELD_REGION_CLASS[field] ?? "lg-banner-field";
      if (field === "carrier_logo") {
        parts.push(`<img class="${klass}" src="${esc(value)}" alt="${esc(asText(slotData["carrier_name"]))}" />`);
      } else {
        parts.push(`<div class="${klass}">${esc(value)}</div>`);
      }
    }
  }

  const cta = ctaLabel !== "" ? ctaLabel : DEFAULT_CTA_LABEL;
  parts.push(`<span class="lg-banner-cta">${esc(cta)}</span>`);

  return (
    `<a class="lg-banner" href="${esc(clickUrl)}"` +
    ` data-recommended="${recommended ? "true" : "false"}"` +
    ` data-slot="${entry.slot}" data-carrier-key="${esc(entry.carrier.carrier_key)}"` +
    ` data-offer="${esc(entry.offer_public_id)}">${parts.join("")}</a>`
  );
}

// Render the banner set for one auction instance (07 §19 step 14). ONE
// `banner_render_id`; one carrier_impression per rendered slot; dropped
// carriers reported with their dedicated reason. `design` is the resolved
// banner design (caller: getBannerDesign(auction.banner_design_id)).
export function renderBanners(
  carriers: readonly BannerRenderCarrier[],
  auction: BannerAuctionContext,
  bannerConfig: BannerRenderConfig,
  design: BannerDesign,
  opts?: { mintId?: () => string },
): BannerRenderResult {
  const mintId = opts?.mintId ?? ulid;
  const bannerRenderId = mintId();
  const auctionInstanceId = auction.auction_instance_id ?? null;
  const canonicalMacros = auction.canonical_macros ?? {};
  const css = bannerChromeCss(design);

  // Resolve the automatic field map once (validated; unknown fields rejected —
  // §20). An absent/invalid map falls back to the standard canonical regions.
  let fieldMap: LeadgenBannerFieldMap = DEFAULT_FIELD_MAP;
  if (bannerConfig.mode === "automatic" && bannerConfig.field_map_json !== undefined) {
    const validation = validateBannerFieldMap(bannerConfig.field_map_json);
    if (validation.valid && validation.field_map !== null) fieldMap = validation.field_map;
  }

  const manualConfig = isRecord(bannerConfig.banner_config_json) ? bannerConfig.banner_config_json : {};
  const manualCta = asText(manualConfig["cta"]);

  const slots: RenderedBannerSlot[] = [];
  const impressions: CarrierImpression[] = [];
  const dropped: DroppedCarrier[] = [];

  for (const entry of carriers) {
    const resolution = resolveClickUrl(entry, canonicalMacros);
    if ("drop" in resolution) {
      dropped.push({
        carrier_key: entry.carrier.carrier_key,
        offer_public_id: entry.offer_public_id,
        slot: entry.slot,
        carrier_filtered_reason: resolution.drop,
      });
      continue;
    }
    const clickUrl = resolution.url;

    // Per-slot resolved data.
    let slotData: Record<string, unknown>;
    let ctaLabel: string;
    if (bannerConfig.mode === "manual") {
      slotData = {
        headline: manualConfig["headline"],
        subheadline: manualConfig["subheadline"],
        logo: manualConfig["logo"],
        legal: manualConfig["legal"],
      };
      ctaLabel = manualCta;
    } else {
      // resolveBannerSlots reads ONLY the mapped canonical fields, but keyed by
      // slot id; for rendering we also want the field→value map. Build both:
      // fieldData keyed by canonical field, slotIds recorded for downstream.
      const fieldData: Record<string, unknown> = {};
      for (const field of Object.keys(fieldMap) as CanonicalCarrierField[]) {
        fieldData[field] = entry.carrier[field];
      }
      slotData = fieldData;
      ctaLabel = manualCta; // an automatic auction may still set a CTA label
    }

    const html = renderCard(entry, clickUrl, bannerConfig.mode, slotData, ctaLabel);
    slots.push({
      slot: entry.slot,
      carrier_key: entry.carrier.carrier_key,
      offer_public_id: entry.offer_public_id,
      source: entry.source,
      bid: entry.bid,
      click_url: clickUrl,
      fields: slotData,
      html,
    });
    impressions.push({
      banner_render_id: bannerRenderId,
      auction_instance_id: auctionInstanceId,
      carrier_key: entry.carrier.carrier_key,
      offer_public_id: entry.offer_public_id,
      slot: entry.slot,
      bid: entry.bid,
      source: entry.source,
    });
  }

  const html = `<div class="lg-banners" data-banner-render-id="${esc(bannerRenderId)}">${slots
    .map((s) => s.html)
    .join("")}</div>`;

  return { banner_render_id: bannerRenderId, css, html, slots, impressions, dropped };
}

// Expose the default field map + region-class map for downstream/tests.
export { DEFAULT_FIELD_MAP, FIELD_REGION_CLASS };
