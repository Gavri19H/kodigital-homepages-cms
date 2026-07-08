// LeadGen canonical runtime context (fix-contract v2.4 04 §4.1–§4.5 —
// R2/R3/R8/B3/B5).
//
// ONE canonical builder assembles the runtime context every consumer uses
// (provider payload build, Offer Test, click resolver, banner URL macros,
// S2S/tracking enrichment — 04 §4.7). This module owns the TYPE, the
// builder, and the 32-macro projection; the consumption sites are wired by
// their own fix slices and MUST NOT re-derive any of these values.
//
// Reuse over duplication (04 §4.2 "bridged, not duplicated"):
//   * `request.cf` geo/timezone is read through the SAME `readCfSignals` +
//     `geoFromCf` pair the rules engine and event enrichment already use
//     (serve-auction.ts derives its rule dims from the identical cf fields);
//   * the device/os/browser macro family reuses `parseClientUa` — shared
//     with /lg/track event enrichment so macros and event columns agree;
//   * `fbc` falls back to the existing `fb.1.<ts>.<fbclid>` derivation
//     (`deriveFbc`, shared with S2S dispatch).
//
// PURITY: given the same request + opts (including `opts.now`), the builder
// returns deep-equal output. `now` is captured ONCE per build so every
// computed field agrees on the instant. `opts.overrides` exists ONLY for the
// Test tool's simulated context (B5); the builder applies it mechanically —
// the guarantee that PUBLIC routes never pass overrides is enforced by the
// route callers (their fix slices), not here.

import {
  geoFromCf,
  parseClientUa,
  readCfSignals,
  type EdgeRequestSignals,
} from "../analytics/listicle-quality";
import { resolveAllComputed } from "./computed";
import { deriveFbc } from "./s2s-dispatch";

// ---------------------------------------------------------------------------
// Canonical context type — NORMATIVE shape from 04 §4.1 (do not extend).
// ---------------------------------------------------------------------------

export type LeadGenRuntimeContext = {
  session_id: string;
  page_view_id: string;
  funnel_attempt_id: string;
  quote_id: string;
  funnel_id: string;
  funnel_variant_id: string;
  auction_config_id?: string;

  request: { ip: string; ua: string; url: string; referer: string; language: string; };
  cloudflare: { country?: string; region?: string; state?: string; city?: string;
                postalCode?: string; timezone?: string; colo?: string; };
  traffic: { utm_source?: string; utm_medium?: string; utm_content?: string;
             traffic_source?: string; placement?: string;
             sub1?: string; sub2?: string; sub3?: string; sub4?: string; sub5?: string;
             cpc?: string; fbclid?: string; fbc?: string; };
  offer?: { offer_id?: string; offer_name?: string; placement_id?: string; };

  computed: Record<string, unknown>;   // populated from COMPUTED_REGISTRY (§4.4)
  macros: Record<string, string>;      // the 32 canonical macros, resolved (§4.3)
};

// ---------------------------------------------------------------------------
// Builder inputs
// ---------------------------------------------------------------------------

// The request source: a plain Request, or anything Hono-Context-shaped
// (`c.req.raw`) — both expose the SAME underlying Request whose headers/url/
// cf drive the request/cloudflare/traffic slices.
export type LeadgenRuntimeRequestSource = Request | { req: { raw: Request } };

// quote/funnel/variant arrive either as the bare public id or as the
// resolved row (anything carrying `public_id`) — resolver.ts rows qualify
// as-is. The variant row may additionally carry `variant_label` (lander_v).
export type LeadgenRuntimeRef = string | { public_id: string };
export type LeadgenRuntimeVariantRef =
  | string
  | { public_id: string; variant_label?: string | null };

// The Offer being built for (§4.2): identity from the participating Offer
// row; placement_id per §4.5 (opts.placement wins when provided).
export interface LeadgenRuntimeOfferInput {
  offer_id?: string;
  offer_name?: string;
  placement_id?: string;
}

// B5 (Test tool ONLY): a flat partial override bag applied over the
// request / cloudflare / traffic slices AFTER base construction and BEFORE
// fbc derivation, computed population, and macro projection — so an
// overridden fbclid derives fbc and an overridden timezone feeds computed.
export interface LeadgenRuntimeContextOverrides {
  // request slice
  ip?: string;
  ua?: string;
  url?: string;
  referer?: string;
  language?: string;
  // cloudflare slice
  country?: string;
  region?: string;
  state?: string;
  city?: string;
  postalCode?: string;
  timezone?: string;
  colo?: string;
  // traffic slice
  utm_source?: string;
  utm_medium?: string;
  utm_content?: string;
  traffic_source?: string;
  placement?: string;
  sub1?: string;
  sub2?: string;
  sub3?: string;
  sub4?: string;
  sub5?: string;
  cpc?: string;
  fbclid?: string;
  fbc?: string;
}

export interface LeadgenRuntimeContextOpts {
  session_id: string;
  page_view_id: string;
  funnel_attempt_id: string;
  quote: LeadgenRuntimeRef;
  funnel: LeadgenRuntimeRef;
  variant: LeadgenRuntimeVariantRef;
  auction_config_id?: string;
  offer?: LeadgenRuntimeOfferInput;
  // §4.5 placement in scope: the PARTICIPATING auction placement / the
  // operator-selected Test placement. Wins over offer.placement_id.
  placement?: string;
  // B5 Test-tool simulated context only — public routes must not pass this.
  overrides?: LeadgenRuntimeContextOverrides;
  // ms-epoch override for deterministic builds (tests / replay); defaults
  // to Date.now(), captured once for the whole build.
  now?: number;
}

// ---------------------------------------------------------------------------
// Slice readers
// ---------------------------------------------------------------------------

function rawRequestOf(source: LeadgenRuntimeRequestSource): Request {
  return "req" in source ? source.req.raw : source;
}

// First tag of an Accept-Language header ("en-US,en;q=0.9" → "en-US").
function firstLanguageTag(header: string): string {
  const first = header.split(",")[0] ?? "";
  return (first.split(";")[0] ?? "").trim();
}

// postalCode/colo ride the SAME request.cf object readCfSignals returns but
// sit outside its locally-typed field list — read them off that one object
// with the same typeof guard serve-auction applies to postalCode.
function cfStringField(cf: EdgeRequestSignals, key: "postalCode" | "colo"): string | undefined {
  const value = (cf as Record<string, unknown>)[key];
  return typeof value === "string" && value !== "" ? value : undefined;
}

const TRAFFIC_PARAM_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_content",
  "traffic_source",
  "placement",
  "sub1",
  "sub2",
  "sub3",
  "sub4",
  "sub5",
  "cpc",
  "fbclid",
  "fbc",
] as const;

// Traffic params from the funnel-page URL query string (§4.2). Callers on
// the auction/click paths pass the ORIGINAL landing URL persisted at
// /lg/attempt time — this reader is deliberately URL-in, params-out.
function readTrafficParams(url: string): LeadGenRuntimeContext["traffic"] {
  let params: URLSearchParams;
  try {
    params = new URL(url).searchParams;
  } catch {
    params = new URLSearchParams();
  }
  const traffic: LeadGenRuntimeContext["traffic"] = {};
  for (const key of TRAFFIC_PARAM_KEYS) {
    const value = params.get(key);
    if (value !== null && value !== "") traffic[key] = value;
  }
  return traffic;
}

const REQUEST_OVERRIDE_KEYS = ["ip", "ua", "url", "referer", "language"] as const;
const CLOUDFLARE_OVERRIDE_KEYS = [
  "country",
  "region",
  "state",
  "city",
  "postalCode",
  "timezone",
  "colo",
] as const;

function applyOverrides(
  request: LeadGenRuntimeContext["request"],
  cloudflare: LeadGenRuntimeContext["cloudflare"],
  traffic: LeadGenRuntimeContext["traffic"],
  overrides: LeadgenRuntimeContextOverrides,
): void {
  for (const key of REQUEST_OVERRIDE_KEYS) {
    const value = overrides[key];
    if (typeof value === "string") request[key] = value;
  }
  for (const key of CLOUDFLARE_OVERRIDE_KEYS) {
    const value = overrides[key];
    if (typeof value === "string") cloudflare[key] = value;
  }
  for (const key of TRAFFIC_PARAM_KEYS) {
    const value = overrides[key];
    if (typeof value === "string") traffic[key] = value;
  }
}

function refPublicId(ref: LeadgenRuntimeRef | LeadgenRuntimeVariantRef): string {
  return typeof ref === "string" ? ref : ref.public_id;
}

function variantLabelOf(variant: LeadgenRuntimeVariantRef): string {
  if (typeof variant === "string") return "";
  return typeof variant.variant_label === "string" ? variant.variant_label : "";
}

// ---------------------------------------------------------------------------
// The canonical builder (04 §4.1/§4.2)
// ---------------------------------------------------------------------------

export function buildLeadgenRuntimeContext(
  source: LeadgenRuntimeRequestSource,
  opts: LeadgenRuntimeContextOpts,
): LeadGenRuntimeContext {
  const rawRequest = rawRequestOf(source);
  const now = opts.now ?? Date.now();

  // request slice (§4.2 row 1). The referer accepts the non-standard
  // `referrer` spelling too (M1's request-side half; the macro-side half is
  // the {referrer}→{referer} alias in macros.ts).
  const request: LeadGenRuntimeContext["request"] = {
    ip: rawRequest.headers.get("cf-connecting-ip") ?? "",
    ua: rawRequest.headers.get("user-agent") ?? "",
    url: rawRequest.url,
    referer: rawRequest.headers.get("referer") ?? rawRequest.headers.get("referrer") ?? "",
    language: firstLanguageTag(rawRequest.headers.get("accept-language") ?? ""),
  };

  // cloudflare slice (§4.2 row 2) — bridged through readCfSignals/geoFromCf.
  // §4.2 maps "regionCode→region/state": both slots carry the shared
  // regionCode-preferred value (geoFromCf falls back to the region display
  // name, matching event enrichment).
  const cf = readCfSignals(rawRequest);
  const geo = geoFromCf(cf);
  const regionCode = geo.state === "" ? undefined : geo.state;
  const cloudflare: LeadGenRuntimeContext["cloudflare"] = {
    country: geo.country === "" ? undefined : geo.country,
    region: regionCode,
    state: regionCode,
    city: geo.city === "" ? undefined : geo.city,
    postalCode: cfStringField(cf, "postalCode"),
    timezone: typeof cf.timezone === "string" && cf.timezone !== "" ? cf.timezone : undefined,
    colo: cfStringField(cf, "colo"),
  };

  const traffic = readTrafficParams(request.url);

  // B5 simulated-context overrides — applied over the three slices BEFORE
  // fbc derivation / computed / macros so downstream values reflect them.
  if (opts.overrides !== undefined) {
    applyOverrides(request, cloudflare, traffic, opts.overrides);
  }

  // fbc derived from fbclid when absent (existing fb.1.<ts>.<fbclid>
  // derivation, §4.2) — after overrides so an overridden fbclid derives too.
  const fbc = deriveFbc(traffic.fbclid ?? "", traffic.fbc ?? "", now);
  if (fbc !== "") traffic.fbc = fbc;

  // offer slice (§4.2/§4.5): opts.placement (the placement in scope) wins
  // over the Offer row's own placement_id.
  const placementId = opts.placement ?? opts.offer?.placement_id;
  const offer: LeadGenRuntimeContext["offer"] =
    opts.offer !== undefined || placementId !== undefined
      ? {
          offer_id: opts.offer?.offer_id,
          offer_name: opts.offer?.offer_name,
          placement_id: placementId,
        }
      : undefined;

  const ctx: LeadGenRuntimeContext = {
    session_id: opts.session_id,
    page_view_id: opts.page_view_id,
    funnel_attempt_id: opts.funnel_attempt_id,
    quote_id: refPublicId(opts.quote),
    funnel_id: refPublicId(opts.funnel),
    funnel_variant_id: refPublicId(opts.variant),
    auction_config_id: opts.auction_config_id,
    request,
    cloudflare,
    traffic,
    offer,
    // EAGER all-12 population (the contract permits lazy per-schema; eager
    // is chosen because the 12 resolvers are trivially cheap, every consumer
    // then sees an identical computed slice, and no schema needs threading
    // into the builder). All values share the ONE captured `now`.
    computed: resolveAllComputed({ now, timezone: cloudflare.timezone ?? "" }),
    macros: {},
  };
  // Macros are built LAST from the slices above (§4.2 row 8).
  ctx.macros = contextToMacros(ctx, { variant_label: variantLabelOf(opts.variant) });
  return ctx;
}

// ---------------------------------------------------------------------------
// Macro projection — the 32 canonical macros from context (04 §4.3)
// ---------------------------------------------------------------------------

// parseClientUa maps an unrecognized NON-EMPTY UA to deterministic families
// ("desktop"/"other") — shared semantics with event columns. An EMPTY UA
// yields empty macro values instead (no fabricated device family).
const EMPTY_UA_DETAILS = {
  device: "",
  os: "",
  os_version: "",
  browser: "",
  browser_version: "",
} as const;

function pathnameOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return "";
  }
}

// Project the context onto the EXISTING 32-macro registry (macros.ts —
// registry unchanged). Every canonical macro is present; a macro with no
// runtime value is the EMPTY STRING (§4.3 unresolved-macro policy;
// encodeURIComponent happens at substitution in resolveMacros).
//
//   * click_id is click-scoped — minted at /lg/lc only, EMPTY here (§4.3);
//     the click resolver (§4.6 slice) merges the fresh value.
//   * placement (§4.5): the Offer placement in scope wins; the traffic-param
//     `placement` applies ONLY when no Offer placement is in scope.
//   * lander_v is the variant_label, threaded via `extra` because the
//     normative context type carries no variant-label slot.
export function contextToMacros(
  ctx: LeadGenRuntimeContext,
  extra?: { variant_label?: string },
): Record<string, string> {
  const uaDetails = ctx.request.ua === "" ? EMPTY_UA_DETAILS : parseClientUa(ctx.request.ua);
  const offerPlacement = ctx.offer?.placement_id ?? "";
  const placement = offerPlacement !== "" ? offerPlacement : (ctx.traffic.placement ?? "");
  return {
    click_id: "",
    utm_medium: ctx.traffic.utm_medium ?? "",
    utm_content: ctx.traffic.utm_content ?? "",
    utm_source: ctx.traffic.utm_source ?? "",
    traffic_source: ctx.traffic.traffic_source ?? "",
    placement,
    lander_v: extra?.variant_label ?? "",
    offer_id: ctx.offer?.offer_id ?? "",
    offer_name: ctx.offer?.offer_name ?? "",
    page: pathnameOf(ctx.request.url),
    device: uaDetails.device,
    os: uaDetails.os,
    os_version: uaDetails.os_version,
    browser: uaDetails.browser,
    browser_version: uaDetails.browser_version,
    country: ctx.cloudflare.country ?? "",
    state: ctx.cloudflare.state ?? "",
    city: ctx.cloudflare.city ?? "",
    ip: ctx.request.ip,
    ua: ctx.request.ua,
    sub1: ctx.traffic.sub1 ?? "",
    sub2: ctx.traffic.sub2 ?? "",
    sub3: ctx.traffic.sub3 ?? "",
    sub4: ctx.traffic.sub4 ?? "",
    sub5: ctx.traffic.sub5 ?? "",
    url: ctx.request.url,
    referer: ctx.request.referer,
    language: ctx.request.language,
    cpc: ctx.traffic.cpc ?? "",
    session_id: ctx.session_id,
    fbc: ctx.traffic.fbc ?? "",
    fbclid: ctx.traffic.fbclid ?? "",
  };
}
