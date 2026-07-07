// LeadGen VISUAL DESIGN registry (contract 05 §14.0/§14.1). Mirrors the
// Listicles layout registry (public/listicle/layouts/registry.ts): a keyed
// map of available funnel visual designs + a `getX(id?)` resolver whose
// unknown/absent-id fallback is the DEFAULT design, exactly as `getLayout`.
//
// This is the VISUAL registry — it owns how a funnel LOOKS (theme + per-
// component style tokens). It is SEPARATE from the component CAPABILITY
// registry (components/registry.ts), which owns WHAT can be built. A Section
// is authored from the capability catalog and SKINNED at render by the active
// visual design here (§14.0). `funnel_design_id` per Quote variant selects a
// design; an unknown id falls back to `default` (§14.1 "unknown id → default").
//
// The default funnel design is the MEASURED reference funnel (navy #1B3A5C +
// orange #E85D26, Literata/Sora) — authoritative token values in
// default-funnel/tokens.ts, registered here under the key `default`.

import { defaultFunnelDesign } from "./default-funnel/tokens";
import type { DefaultFunnelDesign } from "./default-funnel/tokens";
import { BANNER_DEFAULT_ID, bannerDefaultDesign } from "./banner-default/tokens";

// A funnel visual design has the shape of the measured default (the token
// contract every design conforms to). Additional designs added over time
// (e.g. a green/blue skin, §14.1) provide the same token groups.
export type FunnelDesign = DefaultFunnelDesign;

// The banner sub-design (§20 parallel banner registry). The banner token group
// is owned by the dedicated banner-default module (banner-default/tokens.ts),
// which re-references the funnel design's measured `banner` slot verbatim — so
// this type is still structurally the funnel design's banner group.
export type BannerDesign = DefaultFunnelDesign["banner"];

// Registry of available funnel designs keyed by id. `default-funnel` is
// registered under `default` (the resolver's fallback key) AND under its own
// canonical id, so an explicit funnel_design_id="default-funnel" resolves
// directly rather than via the fallback path.
export const FUNNEL_DESIGNS: Record<string, FunnelDesign> = {
  default: defaultFunnelDesign,
  [defaultFunnelDesign.id]: defaultFunnelDesign,
};

// Parallel registry of banner sub-designs (§20), keyed the same way: under
// `default` (the resolver fallback), the canonical banner id `banner-default`,
// and the funnel design id (a funnel_design_id resolves its banner too).
export const BANNER_DESIGNS: Record<string, BannerDesign> = {
  default: bannerDefaultDesign,
  [BANNER_DEFAULT_ID]: bannerDefaultDesign,
  [defaultFunnelDesign.id]: bannerDefaultDesign,
};

// Resolve a funnel visual design by id. Absent OR unknown id → the default
// funnel design (§14.1 "unknown id → default", same rule as `getLayout`).
export function getFunnelDesign(id?: string | null): FunnelDesign {
  if (id === undefined || id === null || id === "") return defaultFunnelDesign;
  return FUNNEL_DESIGNS[id] ?? defaultFunnelDesign;
}

// Resolve a banner sub-design by id. Absent OR unknown id → the default
// banner sub-design (same fallback rule).
export function getBannerDesign(id?: string | null): BannerDesign {
  if (id === undefined || id === null || id === "") return bannerDefaultDesign;
  return BANNER_DESIGNS[id] ?? bannerDefaultDesign;
}
