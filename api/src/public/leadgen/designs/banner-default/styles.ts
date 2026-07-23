// Banner-default presentation (contract 07 §20). Two concerns, both PURE:
//   1. tokens → scoped banner chrome CSS (`bannerChromeCss`), mirroring the
//      funnel design's tokens-to-CSS discipline (default-funnel/styles.ts):
//      every CSS value reads a banner token, and every rule is nested under a
//      root data-attribute scope so banner chrome never leaks.
//   2. the canonical-Carrier → banner-slot FIELD-MAP contract (§20
//      `field_map_json`): the canonical field set, the typed map, a validator
//      that accepts ONLY canonical Carrier fields (rejects unknown), and a
//      pure slot-resolve helper. The RUNTIME banner render is Phase 10 — Stage
//      A ships only these types + validation + the resolve helper.

import type { LeadgenCarrier } from "../../../../admin/leadgen/db-types";
import type { BannerDefaultDesign } from "./tokens";

// ---------------------------------------------------------------------------
// tokens → scoped banner chrome CSS
// ---------------------------------------------------------------------------

// §10/S5.1: BANNER_DESIGN_SCOPE_ATTR deleted — 0 references anywhere (P5
// orphan-scan tier-1 GATING); DEFAULT_BANNER_SCOPE below inlines the same
// "data-banner-design" attribute name literally and is the live consumer.
export const DEFAULT_BANNER_SCOPE = '[data-banner-design="banner-default"]';

function decls(pairs: Record<string, string>): string {
  return Object.entries(pairs)
    .map(([k, v]) => `${k}:${v}`)
    .join(";");
}

function rule(selector: string, pairs: Record<string, string>): string {
  const body = decls(pairs);
  return body === "" ? "" : `${selector}{${body}}`;
}

// tokens → the scoped banner stylesheet. `scope` defaults to the banner-default
// scope; another banner design passes its own. Mirrors funnelChromeCss.
export function bannerChromeCss(
  design: BannerDefaultDesign,
  scope: string = DEFAULT_BANNER_SCOPE,
): string {
  const out: string[] = [];

  out.push(
    rule(`${scope} .lg-banner`, {
      border: design.cardBorder,
      "border-radius": design.cardRadius,
      padding: design.cardPadding,
    }),
  );
  out.push(
    rule(`${scope} .lg-banner-logo`, {
      width: design.logoWidth,
      height: design.logoHeight,
    }),
  );
  out.push(
    rule(`${scope} .lg-banner-name`, {
      "font-size": design.nameFontSize,
      "font-weight": design.nameFontWeight,
    }),
  );
  out.push(
    rule(`${scope} .lg-banner-cta`, {
      background: design.ctaBackground,
      color: design.ctaColor,
      "border-radius": design.ctaRadius,
      "text-transform": design.ctaTextTransform,
    }),
  );
  // Recommended-carrier states (07 §20 recommended card + cta + badge).
  out.push(
    rule(`${scope} .lg-banner[data-recommended="true"]`, {
      border: design.recommendedBorder,
      background: design.recommendedBg,
      "box-shadow": design.recommendedGlow,
    }),
  );
  out.push(
    rule(`${scope} .lg-banner[data-recommended="true"] .lg-banner-cta`, {
      background: design.recommendedCtaBackground,
    }),
  );
  out.push(
    rule(`${scope} .lg-banner-badge`, {
      background: design.recommendedBadgeBg,
      color: design.recommendedBadgeColor,
    }),
  );

  return out.filter((r) => r !== "").join("");
}

// ---------------------------------------------------------------------------
// §20 canonical-Carrier → banner-slot field map
// ---------------------------------------------------------------------------

// The canonical normalized Carrier fields a banner field map may reference
// (07 §20). This is EXACTLY `keyof LeadgenCarrier` — the two `satisfies` /
// completeness checks below make the build fail if the db-types Carrier and
// this list ever diverge, so "only canonical Carrier fields" stays true.
export const CANONICAL_CARRIER_FIELDS = [
  "carrier_key",
  "carrier_name",
  "carrier_logo",
  "headline",
  "subheadline",
  "click_url",
  "bid",
  "bid_currency",
  "tracking_id",
  "disclaimer",
] as const satisfies readonly (keyof LeadgenCarrier)[];

export type CanonicalCarrierField = (typeof CANONICAL_CARRIER_FIELDS)[number];

// Completeness proof: the canonical list equals keyof LeadgenCarrier EXACTLY
// (not just a subset). Fails to compile if a Carrier field is added/removed
// without updating the list.
type _CanonicalIsComplete = keyof LeadgenCarrier extends CanonicalCarrierField ? true : never;
const _canonicalComplete: _CanonicalIsComplete = true;
void _canonicalComplete;

// §20 field_map_json: maps ONLY canonical Carrier fields → banner slot ids.
// Carrier field is the key (the domain being mapped); the slot id is the value.
export type LeadgenBannerFieldMap = Partial<Record<CanonicalCarrierField, string>>;

export interface BannerFieldMapValidation {
  valid: boolean;
  errors: string[];
  // The typed map when valid; null otherwise.
  field_map: LeadgenBannerFieldMap | null;
}

const CANONICAL_FIELD_SET: ReadonlySet<string> = new Set<string>(CANONICAL_CARRIER_FIELDS);

// Reserved keys that must never be walked as a field name (prototype safety).
const FORBIDDEN_KEYS: ReadonlySet<string> = new Set(["__proto__", "prototype", "constructor"]);

// 07 §20. A valid field map is a plain object whose KEYS are all canonical
// Carrier fields and whose VALUES are non-empty slot-id strings. Any unknown
// (non-canonical) field is REJECTED — the builder maps only the canonical
// normalized Carrier shape.
export function validateBannerFieldMap(raw: unknown): BannerFieldMapValidation {
  const errors: string[] = [];
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { valid: false, errors: ["field_map_json must be a JSON object"], field_map: null };
  }
  const obj = raw as Record<string, unknown>;
  const map: LeadgenBannerFieldMap = {};
  for (const key of Object.keys(obj)) {
    if (FORBIDDEN_KEYS.has(key)) {
      errors.push(`forbidden field map key '${key}'`);
      continue;
    }
    if (!CANONICAL_FIELD_SET.has(key)) {
      errors.push(`unknown Carrier field '${key}' — only canonical Carrier fields may be mapped`);
      continue;
    }
    const slot = obj[key];
    if (typeof slot !== "string" || slot.trim() === "") {
      errors.push(`field '${key}' must map to a non-empty banner slot id`);
      continue;
    }
    map[key as CanonicalCarrierField] = slot;
  }
  const valid = errors.length === 0;
  return { valid, errors, field_map: valid ? map : null };
}

// Pure field-map resolver (the `renderBannerFieldMap`-style helper; the real
// HTML render is Phase 10). Produces a slot-id → Carrier-field-value record by
// reading ONLY the mapped canonical fields off the normalized Carrier.
export function resolveBannerSlots(
  fieldMap: LeadgenBannerFieldMap,
  carrier: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const slots: Record<string, unknown> = {};
  for (const field of Object.keys(fieldMap) as CanonicalCarrierField[]) {
    const slot = fieldMap[field];
    if (slot === undefined) continue;
    slots[slot] = carrier[field];
  }
  return slots;
}
