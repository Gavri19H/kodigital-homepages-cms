// LeadGen §30.4 / §24b — the PUBLIC `/lg/config/:funnel_variant_id` DTO
// builder. `buildPublicConfig` stays deterministic and PURE given (resolved
// funnel, resolved design, per-section answer-map versions): no I/O, no env,
// no secrets — which is what lets serve.ts bake the SAME JSON into the
// visitor-invariant cached shell (#lg-config, fix-contract v2.4 03 §3.2). The
// one I/O member of this module is `loadAnswerMapVersions` (fix-contract v2.4
// 03 §3.8 / 05 §5.4 R6): a read-only D1 lookup the /lg route handlers run at
// resolve time and FEED into the pure builder.
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

import type { ResolvedActivatedFunnel, ResolvedFunnelSection } from "./resolver";
import type { FunnelDesign } from "./designs/registry";
import type { LeadgenAssignmentReason } from "./ab-hash";
import { sha256Hex } from "./auction/parse";
// B9 (fix-contract v2.4 06 §6.4): the DTO and the server renderer share ONE
// normalizing choiceDisplay reader so /lg/config metadata and the rendered
// Other-group markup can never disagree (09 §9.1 parity by construction).
import { readChoiceDisplay, type LeadgenChoiceDisplay } from "./components/presets";
// §8.5 layout containers: the config projects the canonical FLATTENED
// component list — containers are a server-side rendering concern and never
// appear in /lg/config (the client engine keeps consuming a flat list; the
// server-rendered shell HTML carries the nested DOM and the engine toggles
// [data-question-id] leaves wherever they sit).
import { flattenComponents } from "./components/content-schema";
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
  // B9 (06 §6.4) Other-group display metadata — ADDITIVE passthrough, present
  // only when the content_json node carries it (normalized through the shared
  // readChoiceDisplay projection; unknown keys inside it are dropped).
  choiceDisplay?: LeadgenChoiceDisplay;
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
  // §24b per-section field — POPULATED (fix-contract v2.4 03 §3.8 / R6): the
  // section's answer-mapping version marker from leadgen_section_answer_maps —
  // String(COALESCE(MAX(id), 0)), the SAME per-section value attempt.ts
  // computeAttemptBindingExtras hashes into the signed token's
  // answer_mapping_hash (05 §5.3), so config and token always agree on the
  // mapping generation ("0" = nothing mapped yet). "" ONLY when the caller
  // supplied no versions (the admin quote-preview path) — never a faked value.
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
  // §16.3 A/B tracking dims (contract 06). VARIANT/TEST-scoped — stable for this
  // cacheable per-variant config entry — so they belong on /lg/config. The
  // per-SESSION `assignment_bucket` is deliberately NOT here: /lg/config stays
  // fully cacheable with no per-session data (§8.3 / §30.4). The shell injects
  // the bucket per request and the client recomputes it identically from
  // funnel_ab_test_id + funnel_ab_test_revision + its own ko_sid (§16.2
  // edge/client parity). funnel_ab_test_id/revision are ""/0 on single_control.
  funnel_ab_test_id: string;
  funnel_ab_test_revision: number;
  variant_label: string;
  traffic_allocation_bp: number;
  assignment_reason: LeadgenAssignmentReason;
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
// the D1 JSON-parse safety rule. Exported: serve.ts renders the SAME nodes
// into the shell sections (03 §3.2a) — one parser, no drift.
export function parseSectionComponents(contentJson: string): LeadgenComponentNode[] {
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
// EXPORTED (fix-contract v2.4 09 §9.1, Phase 4 Slice D2): the Studio preview's
// runtime-hydrated events document builds its #lg-config section through THIS
// projection — one component-config producer, preview and live can never
// disagree on the client component shape.
export function toPublicComponent(node: LeadgenComponentNode): PublicSectionComponent {
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

  // B9 (06 §6.4): additive choiceDisplay passthrough — only when the node
  // carries it, normalized through the SAME reader the server renderer uses.
  const choiceDisplay = readChoiceDisplay(node);
  if (choiceDisplay !== undefined) component.choiceDisplay = choiceDisplay;

  const clientValidation = buildClientValidation(node);
  if (clientValidation !== undefined) component.client_validation = clientValidation;

  // §12.6 node-authored default → { value, answer_source: "default_applied" }.
  const defaultValue = node.props?.["defaultValue"];
  if (defaultValue !== undefined) {
    component.default_answer = { value: defaultValue, answer_source: "default_applied" };
  }
  return component;
}

// The chunk ceiling for IN(?) lists — D1's 100-binding-per-statement limit,
// batched at 80 per the d1-database-safety rule.
const IN_CHUNK = 80;

// R6 (fix-contract v2.4 03 §3.8 / 05 §5.4): the per-section answer-mapping
// version markers, read from leadgen_section_answer_maps AT RESOLVE TIME by
// the /lg route handlers (serve.ts) and fed into the pure builder.
//
// Version semantics — ONE definition system-wide: a section's
// answer_mapping_version := String(COALESCE(MAX(leadgen_section_answer_maps
// .id), 0)). The table carries no dedicated version column; its rows are
// replace-set re-inserted on every mapping save, so MAX(id) is a
// strictly-monotonic per-section version that bumps on any remap. This is
// BYTE-COMPATIBLE with attempt.ts computeAttemptBindingExtras (05 §5.3): the
// signed token's `answer_mapping_hash` is SHA-256 over EXACTLY these ordered
// strings, so sha256Hex(JSON.stringify(config.sections.map(s =>
// s.answer_mapping_version))) === the minted token's answer_mapping_hash —
// config and token can never disagree on the mapping generation. A section
// with no rows reports "0" (a real, hash-bound value — not a fake).
// Read-only; every query is .bind()-parameterized; section-id lists chunk at
// 80 bindings (the D1 100-binding rule).
export async function loadAnswerMapVersions(
  db: D1Database,
  sections: readonly ResolvedFunnelSection[],
): Promise<Record<string, string>> {
  const versions: Record<string, string> = {};
  if (sections.length === 0) return versions;
  const publicIdBySectionId = new Map<number, string>();
  for (const rs of sections) {
    publicIdBySectionId.set(rs.section.id, rs.section.public_id);
    versions[rs.section.public_id] = "0"; // unmapped default — hash-symmetric
  }
  const ids = [...publicIdBySectionId.keys()];
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const chunk = ids.slice(i, i + IN_CHUNK);
    const placeholders = chunk.map(() => "?").join(",");
    const result = await db
      .prepare(
        `SELECT section_id, COALESCE(MAX(id), 0) AS v
         FROM leadgen_section_answer_maps
         WHERE section_id IN (${placeholders})
         GROUP BY section_id`,
      )
      .bind(...chunk)
      .all<{ section_id: number; v: number }>();
    for (const row of result.results ?? []) {
      const publicId = publicIdBySectionId.get(row.section_id);
      if (publicId !== undefined && typeof row.v === "number" && Number.isFinite(row.v)) {
        versions[publicId] = String(row.v);
      }
    }
  }
  return versions;
}

// Build the public `/lg/config` DTO from a resolved funnel + its resolved
// visual design. `design` is the output of getFunnelDesign(variant.funnel_
// design_id); `answerMapVersions` (keyed by section public_id) is the output
// of loadAnswerMapVersions — both passed in so the builder stays pure. The
// optional third arg keeps the admin quote-preview call site (2-arg) valid:
// preview has no activation context and honestly reports "".
export function buildPublicConfig(
  resolved: ResolvedActivatedFunnel,
  design: FunnelDesign,
  answerMapVersions?: Readonly<Record<string, string>>,
): LeadgenPublicConfig {
  // G4: brand the two ids through prefix-validating constructors — a variant id
  // can never be placed in the funnel_id slot, and vice versa.
  const funnel_id = toFunnelId(resolved.funnel.public_id);
  const funnel_variant_id = toFunnelVariantId(resolved.variant.public_id);
  const quote_id = toQuoteId(resolved.quote.public_id);

  const sections: PublicSectionConfig[] = resolved.sections.map((rs, index) => {
    // §8.5: flatten-then-project. For flat legacy content flattenComponents is
    // the identity, so the projected shape is byte-identical to pre-§8.5; for
    // nested content the config lists every LEAF (questions/chrome/affordances
    // in depth-first render order) and no container node.
    const components = flattenComponents(parseSectionComponents(rs.section.content_json)).map(
      toPublicComponent,
    );
    const config: PublicSectionConfig = {
      section_public_id: rs.section.public_id,
      section_index: index,
      headline: rs.section.headline_text,
      continue_mode: rs.section.continue_mode,
      address_validation_enabled: rs.section.address_validation_enabled === 1,
      section_mapping_version: rs.section.section_mapping_version,
      // R6: the resolve-time marker when supplied; "" (no rows / no lookup)
      // stays an honest empty — never a faked version.
      answer_mapping_version: answerMapVersions?.[rs.section.public_id] ?? "",
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
    // §16.3 A/B dims from the resolver's assignment (ab_hash when a test runs,
    // single_control otherwise). The session bucket is intentionally omitted
    // (per-session; see the LeadgenPublicConfig field comment).
    funnel_ab_test_id: resolved.assignment.funnel_ab_test_id,
    funnel_ab_test_revision: resolved.assignment.funnel_ab_test_revision,
    variant_label: resolved.assignment.variant_label,
    traffic_allocation_bp: resolved.assignment.traffic_allocation_bp,
    assignment_reason: resolved.assignment.assignment_reason,
    sections,
  };
}
