// LeadGen §30.4 / §24b — the PUBLIC `/lg/config/:funnel_variant_id` DTO
// builder. Deterministic and PURE given (resolved funnel, resolved design):
// no I/O, no env, no secrets.
//
// ALLOW (contract 08 §24b "Public config DTO" + 09 §30.4): the funnel's public
// identity (quote_id lgq_, funnel_id lgf_, funnel_variant_id lgn_, funnel_name,
// content_version), the resolved visual design tokens (getFunnelDesign), an
// ordered list of section client-configs (public component types + client
// validation + client-safe conditionals + question_key/internal_field + design
// preset/overrides), a stable `section_order_hash`, and the GA4 measurement id.
//
// DENY (asserted absent in leadgen-config-dto.test.ts): signed_config_token,
// funnel_attempt_id (both come only from no-store /lg/attempt, §24c), provider
// endpoints (endpoint_production/staging), api_token_secret_ref / secret
// headers, bid_source / bid strategy / static_bid_value / winner_logic /
// floor_*, raw payload schemas (schema_json), carrier_parse_json /
// carrier_parse_version, auction/region rules, offer internals — none are read
// by the resolver, so none can leak here. The auction runs server-side; the
// client posts only collected answers + the signed binding (§30.4).

import type { ResolvedActivatedFunnel } from "./resolver";
import type { FunnelDesign } from "./designs/registry";
import { sha256Hex } from "./auction/parse";
import type {
  LeadgenComponentNode,
  LeadgenComponentConditional,
  LeadgenChoice,
  LeadgenDesignOverrides,
} from "./components/content-schema";
import {
  toQuoteId,
  toFunnelId,
  toFunnelVariantId,
  type QuoteId,
  type FunnelId,
  type FunnelVariantId,
} from "../../leadgen/funnel";

// One client-safe component config. Every field is drawn from the component
// CAPABILITY node (content-schema); the server-only answer→payload mapping
// (leadgen_section_answer_maps) is NEVER queried by the resolver, so it can
// never appear here.
export interface PublicSectionComponent {
  type: string;
  question_id: string;
  question_key?: string;
  internal_field?: string;
  answer_type?: string;
  required?: boolean;
  valid_values?: Array<string | number | boolean>;
  choices?: LeadgenChoice[];
  conditional?: LeadgenComponentConditional;
  design_preset?: string;
  design_overrides?: LeadgenDesignOverrides;
  props: Record<string, unknown>;
  client_validation?: Record<string, unknown>;
  default_answer?: { value: unknown; answer_source: "default_applied" };
}

export interface PublicSectionConfig {
  section_public_id: string;
  section_index: number;
  headline: string;
  subheadline?: string;
  continue_mode: string;
  address_validation_enabled: boolean;
  section_mapping_version: number;
  // §24b per-section field. P7 seam: the answer-mapping version is derived from
  // leadgen_section_answer_maps by Stage B (server-only mapping data the P7
  // resolver never reads); left "" here rather than faking a version.
  answer_mapping_version: string;
  components: PublicSectionComponent[];
}

// The `/lg/config` response (contract 08 §24b `LeadgenPublicConfig`). Branded
// id types make the G4 invariant compile-checked: `funnel_id` is a FunnelId
// (lgf_) and `funnel_variant_id` a FunnelVariantId (lgn_) — assigning one where
// the other is expected is a type error, and each serializes as a plain string.
export interface LeadgenPublicConfig {
  quote_id: QuoteId;
  funnel_id: FunnelId;
  funnel_variant_id: FunnelVariantId;
  funnel_name: string;
  content_version: number;
  funnel_design_id: string;
  design_tokens: Record<string, unknown>;
  section_order_hash: string;
  ga4_measurement_id: string | null;
  // A/B fields (§24b). P8 seam: P8 populates these from the running test +
  // ab-hash assignment; P7 serves the single control variant.
  funnel_ab_test_id: string;
  funnel_ab_test_revision: number;
  assignment_reason: string;
  sections: PublicSectionConfig[];
}

// A stable hash over the ORDERED section public_ids + their content_versions
// (contract 09 §30.4 anti-tampering `section_order_hash`). Exported so the
// per-attempt token binding (attempt.ts) signs the EXACT same hash the config
// exposes — the two can never diverge (the single-source-of-truth pattern
// dependencies.ts uses for condition ops). Deterministic + pure.
export function computeSectionOrderHash(resolved: ResolvedActivatedFunnel): string {
  const material = resolved.sections
    .map((s) => `${s.section.public_id}:${s.section.content_version}`)
    .join("|");
  return sha256Hex(material);
}

// Parse a section's `content_json` string into its component nodes. Dedicated
// try/catch → a corrupt blob yields an empty component list (never throws) per
// the D1 JSON-parse safety rule.
function parseSectionComponents(contentJson: string): LeadgenComponentNode[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(contentJson);
  } catch {
    return [];
  }
  if (typeof parsed !== "object" || parsed === null) return [];
  const components = (parsed as { components?: unknown }).components;
  return Array.isArray(components) ? (components as LeadgenComponentNode[]) : [];
}

// Client-safe validation rules for a component: `required`, the enum domain,
// and any bounded numeric/length/pattern props authored on the node. These are
// UI-validation hints only (no server/provider data).
function buildClientValidation(node: LeadgenComponentNode): Record<string, unknown> | undefined {
  const cv: Record<string, unknown> = {};
  if (node.required === true) cv["required"] = true;
  if (Array.isArray(node.valid_values) && node.valid_values.length > 0) {
    cv["valid_values"] = node.valid_values;
  }
  const props = node.props ?? {};
  for (const key of ["min", "max", "step", "minLength", "maxLength", "pattern"] as const) {
    const v = props[key];
    if (v !== undefined && v !== null) cv[key] = v;
  }
  return Object.keys(cv).length > 0 ? cv : undefined;
}

// Project a capability node to its client-safe config. Only whitelisted,
// public authoring fields are copied; there is no server-only field on the node
// to strip, but the projection is explicit so a future node field is opt-in.
function toPublicComponent(node: LeadgenComponentNode): PublicSectionComponent {
  const component: PublicSectionComponent = {
    type: node.type,
    question_id: node.question_id,
    props: node.props ?? {},
  };
  if (node.question_key !== undefined) component.question_key = node.question_key;
  if (node.internal_field !== undefined) component.internal_field = node.internal_field;
  if (node.answer_type !== undefined) component.answer_type = node.answer_type;
  if (node.required !== undefined) component.required = node.required;
  if (node.valid_values !== undefined) component.valid_values = node.valid_values;
  if (node.choices !== undefined) component.choices = node.choices;
  if (node.conditional !== undefined) component.conditional = node.conditional;
  if (node.design_preset !== undefined) component.design_preset = node.design_preset;
  if (node.design_overrides !== undefined) component.design_overrides = node.design_overrides;

  const clientValidation = buildClientValidation(node);
  if (clientValidation !== undefined) component.client_validation = clientValidation;

  // §12.6 node-authored default → { value, answer_source: "default_applied" }.
  const defaultValue = node.props?.["defaultValue"];
  if (defaultValue !== undefined) {
    component.default_answer = { value: defaultValue, answer_source: "default_applied" };
  }
  return component;
}

// Build the public `/lg/config` DTO from a resolved funnel + its resolved
// visual design. `design` is the output of getFunnelDesign(variant.funnel_
// design_id) — passed in so the builder stays pure.
export function buildPublicConfig(
  resolved: ResolvedActivatedFunnel,
  design: FunnelDesign,
): LeadgenPublicConfig {
  // G4: brand the two ids through prefix-validating constructors — a variant id
  // can never be placed in the funnel_id slot, and vice versa.
  const funnel_id = toFunnelId(resolved.funnel.public_id);
  const funnel_variant_id = toFunnelVariantId(resolved.variant.public_id);
  const quote_id = toQuoteId(resolved.quote.public_id);

  const sections: PublicSectionConfig[] = resolved.sections.map((rs, index) => {
    const components = parseSectionComponents(rs.section.content_json).map(toPublicComponent);
    const config: PublicSectionConfig = {
      section_public_id: rs.section.public_id,
      section_index: index,
      headline: rs.section.headline_text,
      continue_mode: rs.section.continue_mode,
      address_validation_enabled: rs.section.address_validation_enabled === 1,
      section_mapping_version: rs.section.section_mapping_version,
      answer_mapping_version: "",
      components,
    };
    if (rs.section.subheadline_text !== null && rs.section.subheadline_text !== undefined) {
      config.subheadline = rs.section.subheadline_text;
    }
    return config;
  });

  return {
    quote_id,
    funnel_id,
    funnel_variant_id,
    funnel_name: resolved.funnel.funnel_name,
    content_version: resolved.variant.content_version,
    funnel_design_id: resolved.variant.funnel_design_id,
    design_tokens: design as unknown as Record<string, unknown>,
    section_order_hash: computeSectionOrderHash(resolved),
    ga4_measurement_id: resolved.ga4_measurement_id,
    // P8 seam — single control variant this phase.
    funnel_ab_test_id: "",
    funnel_ab_test_revision: 0,
    assignment_reason: "single_control",
    sections,
  };
}
