// rescue-7 (programmatic privacy / GPC honoring): Global Privacy Control is a
// browser-level "do not sell / share" signal — the `Sec-GPC: 1` request header
// (and `navigator.globalPrivacyControl` client-side, which the same browsers also
// send as the header, so the header is authoritative server-side). A growing set
// of US state privacy laws REQUIRE honoring a universal opt-out mechanism like
// GPC. We honor it by routing into the SAME Restricted-Data-Processing (RDP) path
// the explicit "Do Not Sell" button already uses — Google documents RDP as a
// per-request, CMP-free mechanism for US state privacy compliance
// (support.google.com/admanager/answer/9561023).
//
// SCOPE (agreed: NARROW): auto-honor GPC only for visitors in states whose law
// mandates a universal opt-out signal, so we don't suppress personalized ads
// (lower revenue) where it isn't legally required. The manual opt-out button
// stays universal. Geo comes from Cloudflare's free `request.cf` (country +
// regionCode); if the region is unknown for a US visitor we honor GPC anyway
// (fail-safe toward privacy/compliance).
//
// MAINTENANCE: GPC_HONORED_STATES is a plain, reviewable constant — confirm with
// legal counsel and update as new state laws take effect. Last reviewed
// 2026-06-28.

// US states whose privacy laws require recognizing a universal opt-out
// mechanism (GPC). Two-letter USPS / ISO-3166-2 region codes (the form Cloudflare
// reports in request.cf.regionCode).
export const GPC_HONORED_STATES: ReadonlySet<string> = new Set<string>([
  "CA", // California — CCPA/CPRA
  "CO", // Colorado — CPA
  "CT", // Connecticut — CTDPA
  "TX", // Texas — TDPSA (universal opt-out from 2025-01-01)
  "OR", // Oregon — OCPA (universal opt-out from 2026-01-01)
  "MT", // Montana — MCDPA
  "DE", // Delaware — DPDPA
  "NE", // Nebraska — Data Privacy Act
  "NH", // New Hampshire — Data Privacy Act
  "NJ", // New Jersey — Data Privacy Act
  "MN", // Minnesota — MCDPA
  "MD", // Maryland — MODPA
]);

export interface GpcRequestSignals {
  // The `Sec-GPC` request header value ("1" when GPC is asserted).
  secGpc: string | null | undefined;
  // Cloudflare request.cf.country — ISO-3166-1 alpha-2 (e.g. "US").
  country: string | null | undefined;
  // Cloudflare request.cf.regionCode — subdivision code (e.g. "CA").
  regionCode: string | null | undefined;
}

// True when this request carries a GPC opt-out we are obligated to honor:
// GPC asserted AND the visitor is in the US AND (their state mandates honoring a
// universal opt-out OR their state is unknown — fail-safe toward honoring).
// Non-US traffic is never auto-opted-out by GPC here (US state-law scope).
export function isGpcOptOut(signals: GpcRequestSignals): boolean {
  if (signals.secGpc !== "1") return false;
  if ((signals.country ?? "").toUpperCase() !== "US") return false;
  const region = (signals.regionCode ?? "").trim().toUpperCase();
  if (region.length === 0) return true; // unknown US region -> honor (fail-safe)
  return GPC_HONORED_STATES.has(region);
}
