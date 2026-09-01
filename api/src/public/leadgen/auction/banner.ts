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
// GOVERNED CLICK URL (P11 §19 step 16 / §18.7): the rendered banner `<a href>`
// NEVER carries the raw provider click_url. It points at the first-party
// resolver `/lg/lc/{offer_public_id}?ck=&aiid=&brid=&slot=&faid=` (mirroring
// the listicles governed /lc pattern) — the /lg/lc resolver mints the click_id,
// re-resolves the destination (+ {response:*}) and 302s. The direct resolved
// click_url is still computed (it decides the §10.5 render-time DROP) and kept
// in the server-side `slots[].click_url` for explainability, but it does NOT
// enter the rendered HTML.
//
// SAFETY: every interpolated value is HTML-escaped; the governed href is a
// first-party path carrying only opaque ids (a provider click_url that is not
// http(s) is still treated as absent and falls through to banner_url_template
// for the DROP decision); response/canonical macro values are
// encodeURIComponent-escaped by macros.ts / here before entering a URL. Reuses
// macros.ts / parse.ts / banner-default/styles.ts / registry.ts — no divergent
// re-implementation.

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
import { sanitizeFrameInlineHtml } from "../../../lib/inline-sanitizer";
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
  // fix-contract v2.4 04 §4.7 site 4: the PER-OFFER auction-time canonical
  // macro projection (offer_id/offer_name/placement differ per slot's Offer).
  // Wins over the render-level `auction.canonical_macros` for this entry;
  // {response:*} stays click-time either way.
  canonical_macros?: Readonly<Record<string, string>>;
}

// Runtime render context (07 §19). `canonical_macros` are the request-derived
// macro values a banner_url_template's `{...}` tokens resolve against;
// `banner_design_id` selects the design (the caller resolves it via
// getBannerDesign and passes `design`).
export interface BannerAuctionContext {
  auction_instance_id?: string | null;
  banner_design_id?: string | null;
  canonical_macros?: Readonly<Record<string, string>>;
  // The per-session funnel_attempt_id carried into the governed /lg/lc href
  // (§19 step 16 / §18.7 remove-clicked scoping). Optional: the caller
  // (auction runtime) threads it in Stage B; absent ⇒ the href carries an empty
  // faid= (still a valid governed link).
  funnel_attempt_id?: string | null;
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

// A canonical-field → CSS-class MAP used to live here. renderCard now owns the
// region classes directly, because a region no longer corresponds 1:1 to a
// field: the primary line (`.lg-banner-name`) takes carrier_name OR, when the
// provider sends no brand, the headline (the reference's own
// `offer.name || offer.displayname` fallback). Fields with no visual region
// (bid / bid_currency / tracking_id) still resolve into `fields`.

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

// Reference funnel card copy (contract 00 R1) — the reference renderer ships
// "VIEW MY RATE" on every offer CTA and "BEST MATCH FOR YOU" on the winner's
// badge. Both are overridable per auction via banner_config_json
// (cta / badge), in either mode.
const DEFAULT_CTA_LABEL = "VIEW MY RATE";
const DEFAULT_BADGE_LABEL = "BEST MATCH FOR YOU";

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
// `href` is the GOVERNED /lg/lc URL (never the raw provider click_url).
//
// ANATOMY — 1:1 with the reference funnel's offer card (contract 00 R1; the
// reference renderer builds badge → logo → `.offer-content`{name, description}
// → CTA, styled by `funnel-styles-offers.ts`):
//   badge (winner only) · logo · .lg-banner-content{ name, headline?,
//   subheadline, disclaimer } · CTA
// Two reference behaviours this carries that the previous render did not:
//   * the primary line FALLS BACK the way the reference's does
//     (`offer.name || offer.displayname`, `offer.description || offer.title`) —
//     a provider that sends no brand (QuinStreet's listing shape has no brand
//     field at all: vendorKey/rank/cpc/title/description/clickurl) still gets a
//     named card instead of an anonymous one;
//   * NO text region is printed twice. Mapping two Carrier fields to the same
//     provider value (e.g. carrier_name and headline both → `title`) used to
//     print the same sentence in two stacked rows.
function renderCard(
  entry: BannerRenderCarrier,
  href: string,
  mode: LeadgenBannerMode,
  slotData: Record<string, unknown>,
  ctaLabel: string,
  badgeLabel: string,
): string {
  const recommended = entry.source === "winner";
  const parts: string[] = [];

  if (recommended) {
    const badge = badgeLabel !== "" ? badgeLabel : DEFAULT_BADGE_LABEL;
    parts.push(`<div class="lg-banner-badge">${esc(badge)}</div>`);
  }

  // The four text regions, in render order, de-duplicated by their trimmed
  // text. `rich` regions keep the provider's own inline markup (allowlisted).
  const regions: { klass: string; text: string; rich: boolean }[] = [];
  const seenText = new Set<string>();
  const pushRegion = (klass: string, raw: unknown, rich = false): void => {
    const text = asText(raw).trim();
    if (text === "" || seenText.has(text)) return;
    seenText.add(text);
    regions.push({ klass, text, rich });
  };

  let logo: string;
  if (mode === "manual") {
    logo = asText(slotData["logo"]);
    pushRegion("lg-banner-name", slotData["headline"]);
    pushRegion("lg-banner-subheadline", slotData["subheadline"], true);
    pushRegion("lg-banner-disclaimer", slotData["legal"]);
  } else {
    logo = asText(slotData["carrier_logo"]);
    const carrierName = asText(slotData["carrier_name"]).trim();
    const headline = asText(slotData["headline"]).trim();
    // reference `offer.name || offer.displayname` — the brand owns the primary
    // line; with no brand the offer's headline takes it.
    pushRegion("lg-banner-name", carrierName !== "" ? carrierName : headline);
    pushRegion("lg-banner-headline", headline);
    pushRegion("lg-banner-subheadline", slotData["subheadline"], true);
    pushRegion("lg-banner-disclaimer", slotData["disclaimer"]);
  }

  // Only an absolute http(s) logo is ever emitted (the same gate the click URL
  // gets) and, like the reference renderer, a logo that fails to LOAD removes
  // itself instead of leaving the browser's broken-image glyph in the middle of
  // the card. Both are attribute-level; the public runtime bundle is untouched.
  if (isHttpUrl(logo)) {
    const alt = regions.length > 0 ? regions[0]!.text : "";
    parts.push(
      `<img class="lg-banner-logo" src="${esc(logo.trim())}" alt="${esc(alt)}"` +
        ` onerror="this.style.display='none'" />`,
    );
  }

  if (regions.length > 0) {
    const inner = regions
      .map((r) => {
        if (!r.rich) return `<div class="${r.klass}">${esc(r.text)}</div>`;
        // A buyer's response (or an operator's authored copy) may carry inline
        // markup — a provider description is commonly a <ul> of benefits.
        // Escaping it printed the tags to the visitor as literal text; the
        // frame's allowlist re-serializer renders the safe subset
        // (bold/italic/link/lists) and can never emit a construct it does not
        // itself build. Lists get the reference's left-aligned bullet
        // treatment via data-rich (styles.ts).
        const html = sanitizeFrameInlineHtml(r.text);
        if (html === "") return "";
        const rich = /<(?:ul|ol)>/.test(html) ? ` data-rich="1"` : "";
        return `<div class="${r.klass}"${rich}>${html}</div>`;
      })
      .join("");
    if (inner !== "") parts.push(`<div class="lg-banner-content">${inner}</div>`);
  }

  const cta = ctaLabel !== "" ? ctaLabel : DEFAULT_CTA_LABEL;
  parts.push(`<span class="lg-banner-cta">${esc(cta)}</span>`);

  return (
    `<a class="lg-banner" href="${esc(href)}"` +
    ` data-recommended="${recommended ? "true" : "false"}"` +
    ` data-slot="${entry.slot}" data-carrier-key="${esc(entry.carrier.carrier_key)}"` +
    ` data-offer="${esc(entry.offer_public_id)}">${parts.join("")}</a>`
  );
}

// Build the GOVERNED first-party click URL for a rendered slot (§19 step 16 /
// §18.7). The rendered `<a href>` points here — NOT at the raw provider
// click_url. The /lg/lc resolver (click.ts) re-resolves the destination, mints
// the click_id, increments the cap, writes the remove-clicked row and 302s.
// Mirrors the listicles governed-url builder (URLSearchParams-encoded values).
export function buildLeadgenClickUrl(
  offerPublicId: string,
  params: {
    carrier_key: string;
    auction_instance_id: string | null;
    banner_render_id: string;
    slot: number;
    funnel_attempt_id: string;
  },
): string {
  const q = new URLSearchParams();
  q.set("ck", params.carrier_key); // carrier_key (§18.8)
  q.set("aiid", params.auction_instance_id ?? ""); // auction_instance_id (issue 22)
  q.set("brid", params.banner_render_id); // banner_render_id
  q.set("slot", String(params.slot));
  q.set("faid", params.funnel_attempt_id); // funnel_attempt_id (§18.7 scoping)
  return `/lg/lc/${encodeURIComponent(offerPublicId)}?${q.toString()}`;
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
  const funnelAttemptId = auction.funnel_attempt_id ?? "";
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
  // Card copy that applies in BOTH modes (an automatic auction still authors
  // its own CTA + winner badge wording).
  const configuredCta = asText(manualConfig["cta"]);
  const configuredBadge = asText(manualConfig["badge"]);

  const slots: RenderedBannerSlot[] = [];
  const impressions: CarrierImpression[] = [];
  const dropped: DroppedCarrier[] = [];

  for (const entry of carriers) {
    // 04 §4.7 site 4: the entry's per-Offer auction-time macros win over the
    // render-level set (offer identity/placement macros differ per slot).
    const resolution = resolveClickUrl(entry, entry.canonical_macros ?? canonicalMacros);
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
      ctaLabel = configuredCta;
    } else {
      // resolveBannerSlots reads ONLY the mapped canonical fields, but keyed by
      // slot id; for rendering we also want the field→value map. Build both:
      // fieldData keyed by canonical field, slotIds recorded for downstream.
      const fieldData: Record<string, unknown> = {};
      for (const field of Object.keys(fieldMap) as CanonicalCarrierField[]) {
        fieldData[field] = entry.carrier[field];
      }
      slotData = fieldData;
      ctaLabel = configuredCta; // an automatic auction may still set a CTA label
    }

    // Governed href (§19 step 16): the rendered anchor points at /lg/lc, NOT the
    // raw provider click_url. `clickUrl` (resolved direct) stays server-side in
    // slots[].click_url for explainability and drove the §10.5 drop decision above.
    const governedHref = buildLeadgenClickUrl(entry.offer_public_id, {
      carrier_key: entry.carrier.carrier_key,
      auction_instance_id: auctionInstanceId,
      banner_render_id: bannerRenderId,
      slot: entry.slot,
      funnel_attempt_id: funnelAttemptId,
    });
    const html = renderCard(entry, governedHref, bannerConfig.mode, slotData, ctaLabel, configuredBadge);
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

// Expose the default field map + the default card copy for downstream/tests.
export { DEFAULT_FIELD_MAP, DEFAULT_CTA_LABEL, DEFAULT_BADGE_LABEL };
