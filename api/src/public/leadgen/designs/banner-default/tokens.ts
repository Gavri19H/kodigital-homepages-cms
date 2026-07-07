// LeadGen BANNER visual design — "banner-default" (contract 07 §20 banner
// design registry, PARALLEL to the funnel design registry). It REUSES the
// measured `banner` token group from the default funnel design
// (default-funnel/tokens.ts) VERBATIM — no new palette is invented: the banner
// card / recommended / logo / cta tokens were measured 1:1 from the reference
// funnel stylesheet (navy #1B3A5C + accent orange #E85D26). No banned product
// name in source.

import { defaultFunnelDesign } from "../default-funnel/tokens";

// The canonical id under which this banner design registers (07 §20:
// "banner_design_id; unknown → default"). The token OBJECT itself has no
// embedded id (it is the shared measured token group) — the registry keys on
// this string, mirroring how the funnel registry keys on `default-funnel`.
export const BANNER_DEFAULT_ID = "banner-default";

// The banner-default design IS the measured `banner` token group. Kept
// REFERENCE-IDENTICAL to defaultFunnelDesign.banner so the funnel and banner
// design registries can never drift and never need a second copy of the
// measured values to maintain.
export const bannerDefaultDesign = defaultFunnelDesign.banner;

export type BannerDefaultDesign = typeof bannerDefaultDesign;
