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
// v2.5 09 §9.2: on the FRAME path the config bakes the EFFECTIVE design
// (resolveTokens(...).design — same structure, widened leaves) so #lg-config
// and /lg/config carry the tokens the composed page actually renders with;
// the legacy path keeps passing the registry design (byte-identical bytes).
import type { EffectiveFunnelDesign } from "./designs/theme";
import type { LeadgenAssignmentReason } from "./ab-hash";
import { sha256Hex } from "./auction/parse";
import { type LeadgenSectionDesignOverrides } from "./components/presets";
// §8.5 layout containers: the config projects the canonical FLATTENED
// component list — layout containers are a server-side rendering concern and
// never appear in /lg/config (the client engine keeps consuming a flat list;
// the server-rendered shell HTML carries the nested DOM and the engine toggles
// [data-question-id] leaves wherever they sit). R2 P1 §① adds the ONE
// exception: a QUESTION GRID is a component the visitor sees, so it projects as
// one entry carrying its N child question configs (projectSectionComponents).
import {
  isLayoutContainerType,
  isQuestionGridType,
  LEADGEN_MAX_CONTAINER_DEPTH,
  resolveDateBound,
  isPhoneTypedComponent,
  parsePhoneMaskPattern,
} from "./components/content-schema";
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
  // R2 P1 §① — the QuestionGrid container projects as ONE component carrying
  // its N child QUESTIONS (present ONLY on a question-grid component; absent on
  // every other type, so every pre-R2 component config is byte-identical).
  // Each child is a FULL PublicSectionComponent: its own internal_field,
  // answer_type, required, choices, client_validation, default_answer and
  // `conditional` — the owner's model ("Each question in the component is
  // independent field, with independent answers, inefendent defaults!!").
  // The runtime excludes a dependency-hidden child by evaluating THAT child's
  // own `conditional`; the grouping survives the projection because the render
  // needs it (stacked labeled questions, ONE Continue for the group).
  children?: PublicSectionComponent[];
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
  // P4c (register PC-12): the section-level Continue-visibility rule —
  // present only when content_json authors one. The runtime engine
  // (conditionMet) hides/shows [data-lg-continue] when this is set; absent
  // ⇒ byte-identical pre-P4c behavior (Continue always shown).
  continue_visible_when?: LeadgenComponentConditional;
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

// P4c (register PC-12): parse a section's `content_json` string for its
// OPTIONAL section-level continue_visible_when. Dedicated try/catch (D1
// JSON-parse safety rule) — a corrupt blob yields undefined (never throws),
// same defensive shape as parseSectionComponents. A malformed (non-object)
// value is dropped rather than passed through, since the runtime's
// conditionMet expects a real {when, op, ...} shape — content-schema.ts is
// the authoritative save-time gate; this is a defensive read, not a second
// validator.
export function parseSectionContinueVisibleWhen(
  contentJson: string,
): LeadgenComponentConditional | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(contentJson);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const cvw = (parsed as { continue_visible_when?: unknown }).continue_visible_when;
  if (typeof cvw !== "object" || cvw === null || Array.isArray(cvw)) return undefined;
  // Round-4 A-4 (P2a composed groups): a group ({match?, conditions[]}) is
  // detected STRUCTURALLY by an array `conditions` — the SAME discriminator the
  // runtime evaluator uses (dependencies.ts isConditionGroup) — and round-trips
  // untouched. The bare {when, op} shape keeps its existing defensive gate.
  if (Array.isArray((cvw as { conditions?: unknown }).conditions)) {
    return cvw as LeadgenComponentConditional;
  }
  const when = (cvw as { when?: unknown }).when;
  const op = (cvw as { op?: unknown }).op;
  if (typeof when !== "string" || when === "" || typeof op !== "string") return undefined;
  return cvw as LeadgenComponentConditional;
}

// v2.5 09 §9.5 / 03 §3.4: parse a section row's `design_overrides_json` into
// the LeadgenSectionRenderCtx.design_overrides shape. Dedicated try/catch → a
// corrupt/non-object blob yields null (never throws; D1 JSON-parse rule), and
// only the three §9.5 keys are projected (each defensively typed — the preset
// consumers read entries defensively too). Exported: serve.ts + both admin
// preview/persist call sites (03 §3.4) build their sectionCtx through THIS one
// parser, so the layer-4 input can never drift between preview and runtime.
export function parseSectionDesignOverrides(
  raw: string | null | undefined,
): LeadgenSectionDesignOverrides | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const rec = parsed as Record<string, unknown>;
  const out: LeadgenSectionDesignOverrides = {};
  const palette = rec["palette"];
  if (typeof palette === "object" && palette !== null && !Array.isArray(palette)) {
    const roles: Record<string, string> = {};
    for (const [role, value] of Object.entries(palette as Record<string, unknown>)) {
      if (typeof value === "string" && value !== "") roles[role] = value;
    }
    if (Object.keys(roles).length > 0) out.palette = roles;
  }
  if (typeof rec["columnsDefault"] === "number" && Number.isFinite(rec["columnsDefault"])) {
    out.columnsDefault = rec["columnsDefault"];
  }
  if (typeof rec["gapDefault"] === "string" && rec["gapDefault"] !== "") {
    out.gapDefault = rec["gapDefault"];
  }
  return Object.keys(out).length > 0 ? out : null;
}

// Client-safe validation rules for a component: `required`, the enum domain,
// and any bounded numeric/length/pattern props authored on the node. These are
// UI-validation hints only (no server/provider data).
// E1-C2 (register §E.2): the FreeText "Pattern preset" (letters/digits) is
// stored as props.pattern_preset with NO props.pattern (the studio only writes
// props.pattern for the `custom` preset — ui-section-studio.ts:5435-5446), so
// letters/digits enforced NOTHING at the answer layer. Translate them here to
// the SAME anchored regexes the server's §6.5 free-text preset leg uses
// (leadgen/payload.ts FREE_TEXT_PRESET_RES: letters=^[A-Za-z ]+$, digits=
// ^[0-9]+$) so the client validateValue pattern rule enforces the preset's
// promise. `custom` keeps its authored props.pattern (copied below); `none`/
// absent contributes nothing.
const PATTERN_PRESET_REGEX: Readonly<Record<string, string>> = {
  letters: "^[A-Za-z ]+$",
  digits: "^[0-9]+$",
};

// Round-4 A-6b / Part D: compile a phone field's props.phone_format preset into
// the client phone contract {regex, normalize, message} the runtime checker
// (validation.ts) consumes — strip per `normalize`, test `regex`, emit
// `message`. Built-in presets:
//   nanp       — US/Canada NANP: optional leading country-1, area + exchange
//                first digit 2-9, 10 significant digits (digits-normalized).
//                Byte-equivalent to the runtime normalizePhoneE164 default
//                (proven in leadgen-p2b-phone.test.ts), so explicit 'nanp'
//                validates identically to legacy no-prop content.
//   e164_intl  — E.164: '+' then 8-15 digits (keep '+' and digits).
//   il         — Israeli national: 0 + 8-9 digits (incl. 05X mobiles), digits.
// A {custom:{regex, mask?, message?}} rule passes its own regex verbatim, tested
// on the raw value ('none'); its message wins (a plain default otherwise). The
// `mask` is a P2c studio-picker display hint — never a validation input.
interface CompiledPhoneContract {
  regex: string;
  normalize: "digits" | "e164" | "none";
  message: string;
  // Rework M8 (§6.9): a MASK contract also carries the display scaffold + the
  // exact digit count. The runtime CHECKER (validation.ts) consumes only
  // {regex, normalize, message} unchanged (byte-identical to P1); these two are
  // additive — the S2.3 fill UX reads `scaffold`, and the studio's
  // formatPhone-incoherence warning (sections-handlers.ts) reads `digit_count`
  // to fire only when a mask pairs with formatPhone AND digit_count ≠ 10.
  scaffold?: string;
  digit_count?: number;
}
// Rework A-7 (strings.md) — the DEFAULT phone-incomplete message a mask
// contract emits when the author sets none (§6.9 "Continue gates on
// completeness … with the author's message (default: Appendix A-7)").
const PHONE_INCOMPLETE_DEFAULT = "Enter a complete phone number.";
const PHONE_PRESET_CONTRACTS: Readonly<Record<string, CompiledPhoneContract>> = {
  nanp: { regex: "^1?[2-9]\\d{2}[2-9]\\d{2}\\d{4}$", normalize: "digits", message: "Enter a valid US phone number." },
  e164_intl: { regex: "^\\+\\d{8,15}$", normalize: "e164", message: "Enter your phone number with the country code, like +972…" },
  il: { regex: "^0\\d{8,9}$", normalize: "digits", message: "Enter a valid Israeli phone number." },
};

// Resolve a node's props.phone_format to a compiled contract, or undefined —
// undefined means "emit NO cv.phone" so a legacy phone field (no phone_format)
// keeps a BYTE-IDENTICAL DTO and the runtime falls to its NANP default (the
// back-compat gate). Only a phone-typed node with the prop present compiles one.
// A string that is not a known preset returns undefined (content-schema rejected
// it at save; a stale/corrupt config just falls to the NANP default, never
// throws). A custom rule needs a non-empty string regex.
function buildPhoneContract(node: LeadgenComponentNode): CompiledPhoneContract | undefined {
  const props = node.props ?? {};
  if (!isPhoneTypedComponent(node.type, props)) return undefined;
  const pf = props["phone_format"];
  if (pf === undefined) return undefined;
  if (typeof pf === "string") return PHONE_PRESET_CONTRACTS[pf];
  if (pf !== null && typeof pf === "object") {
    // Rework M8 (§6.9): compile the authored digit-group MASK — strip to
    // digits, then test ^\d{digit_count}$ (the recorded answer is the raw digit
    // string). Uses the SAME grammar parser the save gate does (one grammar,
    // never two). A stale/corrupt mask parses to null → NO contract (the
    // runtime falls to its NANP default, never throws). Default incomplete
    // message = A-7 (author may override via mask.message).
    const mask = (pf as { mask?: unknown }).mask;
    if (mask !== null && typeof mask === "object") {
      const parsed = parsePhoneMaskPattern((mask as { pattern?: unknown }).pattern);
      if (parsed === null) return undefined;
      const message = (mask as { message?: unknown }).message;
      return {
        regex: `^\\d{${parsed.digit_count}}$`,
        normalize: "digits",
        message: typeof message === "string" && message !== "" ? message : PHONE_INCOMPLETE_DEFAULT,
        scaffold: parsed.scaffold,
        digit_count: parsed.digit_count,
      };
    }
    // Legacy custom raw-regex path — TOLERATED on read (contract M8 removes it
    // from the editor only; the schema keeps validating stored/authored custom
    // content). New authoring uses the mask above.
    const custom = (pf as { custom?: unknown }).custom;
    if (custom !== null && typeof custom === "object") {
      const regex = (custom as { regex?: unknown }).regex;
      const message = (custom as { message?: unknown }).message;
      if (typeof regex === "string" && regex !== "") {
        return {
          regex,
          normalize: "none",
          message: typeof message === "string" && message !== "" ? message : "Enter a valid phone number.",
        };
      }
    }
  }
  return undefined;
}

function buildClientValidation(
  node: LeadgenComponentNode,
  todayIso: string,
): Record<string, unknown> | undefined {
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
  // PC-5/PC-A5 (P4b): a DateQuestion's min/max are date BOUNDS (ISO or dynamic
  // token). Resolve them to concrete ISO HERE, at config build, relative to
  // `todayIso` — so the runtime's validateValue date branch is a pure lexical
  // ISO compare with NO token grammar in the bundle, and the native <input
  // type=date> min/max (presets, literal-ISO case) agree with the client gate.
  // An unresolvable bound is dropped (content-schema's isDateBound already
  // rejected garbage at authoring time).
  if (node.type === "DateQuestion") {
    for (const key of ["min", "max"] as const) {
      const raw = props[key];
      if (raw === undefined || raw === null) continue;
      const resolved = resolveDateBound(raw, todayIso);
      if (resolved !== null) cv[key] = resolved;
      else delete cv[key];
    }
  }
  // E1-C2: a letters/digits pattern_preset with no authored regex becomes the
  // grounded preset regex (a custom preset already supplied props.pattern above
  // and is never overridden).
  if (cv["pattern"] === undefined) {
    const preset = props["pattern_preset"];
    if (typeof preset === "string") {
      const regex = PATTERN_PRESET_REGEX[preset];
      if (regex !== undefined) cv["pattern"] = regex;
    }
  }
  // E1-C1 (register §E.2): the authored error_text ("If it's wrong, say …")
  // rides client_validation so the runtime validateValue can use it as the
  // human message override for format/range/pattern/length failures (it hard-
  // coded generic copy before). Whitelisted non-empty string only.
  const errorText = props["error_text"];
  if (typeof errorText === "string" && errorText.trim() !== "") {
    cv["error_text"] = errorText;
  }
  // Round-4 A-6b: compile the phone-format preset into the client contract. Only
  // a phone-typed node WITH props.phone_format emits `cv.phone`; absent ⇒ no key
  // (byte-identical legacy DTO; the runtime uses its NANP default).
  const phoneContract = buildPhoneContract(node);
  if (phoneContract !== undefined) cv["phone"] = phoneContract;
  return Object.keys(cv).length > 0 ? cv : undefined;
}

// Project a capability node to its client-safe config. Only whitelisted,
// public authoring fields are copied; there is no server-only field on the node
// to strip, but the projection is explicit so a future node field is opt-in.
// EXPORTED (fix-contract v2.4 09 §9.1, Phase 4 Slice D2): the Studio preview's
// runtime-hydrated events document builds its #lg-config section through THIS
// projection — one component-config producer, preview and live can never
// disagree on the client component shape.
// ISO date (YYYY-MM-DD) date tokens resolve against. Computed at projection
// time = the request-time day for the live/preview config build. Kept internal
// (NOT a toPublicComponent param) so every existing bare `.map(toPublicComponent)`
// call site stays valid — only DateQuestion token bounds read it; literal ISO
// bounds and all non-date fields are fully deterministic.
function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

// Rework §6.5: the authored "Other" choice VALUES a single-select choice node
// carries (props.other.choices[].value). Empty for any node without an Other
// list — so a node without `other` is byte-identical. Defensive over stored
// shapes (the save gate is content-schema.validateOtherEditor; this is a read).
function otherChoiceValues(node: LeadgenComponentNode): Array<string | number | boolean> {
  const other = node.props?.["other"];
  if (other === null || typeof other !== "object") return [];
  const choices = (other as { choices?: unknown }).choices;
  if (!Array.isArray(choices)) return [];
  const out: Array<string | number | boolean> = [];
  for (const c of choices) {
    if (c !== null && typeof c === "object") {
      const v = (c as { value?: unknown }).value;
      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") out.push(v);
    }
  }
  return out;
}

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
  // Rework §6.5: authored "Other" values share the node's ONE answer domain, so
  // they join valid_values — the runtime accepts an "other" selection exactly
  // like a base choice (the renderer paints base + other). Only when
  // props.other.choices is authored; absent ⇒ byte-identical DTO.
  const otherValues = otherChoiceValues(node);
  if (otherValues.length > 0) {
    const base = component.valid_values ?? (Array.isArray(node.choices) ? node.choices.map((c) => c.value) : []);
    const merged: Array<string | number | boolean> = [...base];
    for (const v of otherValues) if (!merged.includes(v)) merged.push(v);
    component.valid_values = merged;
  }
  if (node.conditional !== undefined) component.conditional = node.conditional;
  if (node.design_preset !== undefined) component.design_preset = node.design_preset;
  if (node.design_overrides !== undefined) component.design_overrides = node.design_overrides;

  const clientValidation = buildClientValidation(node, isoToday());
  if (clientValidation !== undefined) component.client_validation = clientValidation;

  // §12.6 node-authored default → { value, answer_source: "default_applied" }.
  //
  // R2 P1 FIX-FIRST (BLOCKER 2): read `props.defaultValue` FIRST, then the older
  // `props.default`. The studio now writes `defaultValue` for EVERY default kind
  // (ui-section-studio setGridQuestionDefault / collectDefaultControl), but two
  // kinds — dropdown and range — wrote ONLY `props.default` until this fix, and
  // every node stored before it still carries that key alone. Projecting only
  // `defaultValue` meant such a node shipped `default_answer: null`, the runtime
  // never seeded it (applySectionDefaults), and a REQUIRED dropdown the operator
  // had given a default blocked Continue on an untouched screen — the owner's
  // "if we set a 'default' and the user didn't change it - this is his answer and
  // the 'required' rule is met" read as its exact opposite. Same precedence as
  // presets.ts dropdownDefaultValue and answers.ts authoredDefault: one meaning
  // of "the authored default" across render, config and normalization.
  const defaultValue = node.props?.["defaultValue"] ?? node.props?.["default"];
  if (defaultValue !== undefined) {
    component.default_answer = { value: defaultValue, answer_source: "default_applied" };
  }

  // R2 P1 §① — a QuestionGrid projects its child questions THROUGH THIS SAME
  // projection (one component-config producer, no second shape): every child
  // keeps its own field / default / required / conditional / choices /
  // client_validation. Only a question grid carries `children` here; a §8.5
  // layout container never reaches this function (projectSectionComponents
  // flattens it), so no other type gains a key.
  if (isQuestionGridType(node.type) && Array.isArray(node.children)) {
    component.children = node.children.map(toPublicComponent);
  }
  return component;
}

// Rework §10 / M6: the MultiQuestionGrid 1→N row expansion is REMOVED (the grid
// type is retired; migration M6 rewrites stored grids to independent components,
// which project 1:1). This is now a 1:1 projection seam kept as a named function
// because many call sites flatMap over it (sections/quotes/runtime-routes/resolver
// + the /lg/config builder); every node projects through toPublicComponent, so
// the projected component list is byte-identical to the migrated content.
export function expandPublicComponents(node: LeadgenComponentNode): PublicSectionComponent[] {
  return [toPublicComponent(node)];
}

// R2 P1 §① — THE section-content projection for /lg/config. It replaces the
// bare `flattenComponents(...).flatMap(expandPublicComponents)` because the two
// container families project DIFFERENTLY:
//
//   · a §8.5 LAYOUT container (Stack/GridContainer/Columns/CardPanel/
//     BackgroundPanel) is pure server-side rendering chrome → flattened away,
//     exactly as before (byte-identical output for all pre-R2 content);
//   · a QUESTION GRID is a real component the visitor sees as one group →
//     projected as ONE component whose `children` are its N question configs.
//     Flattening it away would destroy the grouping the render needs (the
//     design pin: stacked labeled questions under ONE Continue) and would lose
//     the "these questions belong together" fact the runtime needs to keep the
//     group's continue gate coherent.
//
// Depth-capped like every other tree walk (the validator is the gate; this walk
// just refuses to blow the stack on corrupt/over-deep stored data).
export function projectSectionComponents(
  components: readonly LeadgenComponentNode[],
): PublicSectionComponent[] {
  const out: PublicSectionComponent[] = [];
  const walk = (nodes: readonly LeadgenComponentNode[], depth: number): void => {
    for (const node of nodes) {
      const type =
        typeof node === "object" && node !== null ? (node as { type?: unknown }).type : undefined;
      if (isQuestionGridType(type)) {
        out.push(...expandPublicComponents(node));
        continue;
      }
      if (isLayoutContainerType(type)) {
        if (depth >= LEADGEN_MAX_CONTAINER_DEPTH + 1) continue; // corrupt over-deep data
        const children = (node as { children?: unknown }).children;
        if (Array.isArray(children)) walk(children as LeadgenComponentNode[], depth + 1);
        continue;
      }
      out.push(...expandPublicComponents(node));
    }
  };
  walk(components, 1);
  return out;
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
// design_id) — OR, on the v2.5 frame path (09 §9.2), the EFFECTIVE design
// from resolveTokens(base, theme, overrides).design, so the baked
// `design_tokens` are the ones the composed shell renders with (the legacy
// path keeps passing the registry design: identity requirement, pin-proven).
// `answerMapVersions` (keyed by section public_id) is the output of
// loadAnswerMapVersions — both passed in so the builder stays pure. The
// optional third arg keeps the admin quote-preview call site (2-arg) valid:
// preview has no activation context and honestly reports "".
export function buildPublicConfig(
  resolved: ResolvedActivatedFunnel,
  design: FunnelDesign | EffectiveFunnelDesign,
  answerMapVersions?: Readonly<Record<string, string>>,
): LeadgenPublicConfig {
  // G4: brand the two ids through prefix-validating constructors — a variant id
  // can never be placed in the funnel_id slot, and vice versa.
  const funnel_id = toFunnelId(resolved.funnel.public_id);
  const funnel_variant_id = toFunnelVariantId(resolved.variant.public_id);
  const quote_id = toQuoteId(resolved.quote.public_id);

  const sections: PublicSectionConfig[] = resolved.sections.map((rs, index) => {
    // §8.5: flatten-then-project. For flat legacy content the walk is the
    // identity, so the projected shape is byte-identical to pre-§8.5; for
    // nested content the config lists every LEAF (questions/chrome/affordances
    // in depth-first render order) and no LAYOUT container node.
    // expandPublicComponents is a 1:1 projection (§10/M6 retired the grid's
    // per-row expansion). R2 P1 §①: a QuestionGrid is the ONE container that
    // survives as a component — projected once, with its child questions
    // (projectSectionComponents).
    const components = projectSectionComponents(parseSectionComponents(rs.section.content_json));
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
    const continueVisibleWhen = parseSectionContinueVisibleWhen(rs.section.content_json);
    if (continueVisibleWhen !== undefined) {
      config.continue_visible_when = continueVisibleWhen;
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
