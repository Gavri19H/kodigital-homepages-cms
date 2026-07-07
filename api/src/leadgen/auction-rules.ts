// LeadGen §21 auction rule evaluation (contract 07 §21 + §21.4). Phase 9
// STAGE A — PURE, deterministic, no I/O.
//
// SEPARATE file from rules.ts: rules.ts is the Phase-4 Offer REGION-BLOCK
// evaluator (`leadgen_offer_region_rules`, geo pass/block lists). This module
// is the Phase-9 ANSWER/carrier rule system (`leadgen_auction_rules`, two
// levels — 07 §21) that P10's runtime consults at pipeline steps 5 (offer
// rules) and 10 (carrier rules).
//
// Both levels REUSE the single condition-op evaluator `conditionalMet`
// (payload.ts) — a §21.4 `groups[]` is OR-within-a-field / AND-across-fields
// over `conditionalMet`, so payload-build, dependency show/hide, and auction
// rules can never diverge on op semantics. `conditionsHash` reuses the
// synchronous `sha256Hex` (parse.ts) for the `conditions_hash` column.

import type {
  LeadgenAuctionExcludedOffer,
  LeadgenRuleAction,
  LeadgenRuleConditionGroup,
  LeadgenRuleConditions,
} from "../admin/leadgen/db-types";
import { conditionalMet, type LeadgenPayloadConditional } from "./payload";
import { sha256Hex } from "../public/leadgen/auction/parse";

const INCLUDE_ACTIONS: ReadonlySet<LeadgenRuleAction> = new Set(["include_only", "allow_list"]);
const EXCLUDE_ACTIONS: ReadonlySet<LeadgenRuleAction> = new Set(["exclude", "block_list"]);

function isEnabled(enabled: number | boolean | undefined): boolean {
  return enabled === undefined || enabled === 1 || enabled === true;
}

function isOverride(strictly: number | boolean | undefined): boolean {
  return strictly === 1 || strictly === true;
}

// ---------------------------------------------------------------------------
// §21.4 typed conditions — OR within a field, AND across fields
// ---------------------------------------------------------------------------

// One §21.4 group entry → the `conditionalMet` conditional shape (field→when).
function toConditional(group: LeadgenRuleConditionGroup): LeadgenPayloadConditional {
  return {
    when: group.field,
    op: group.op,
    value: group.value,
    values: group.values,
    from: group.from,
    to: group.to,
  };
}

// 07 §21.4 (NORMATIVE): entries sharing a `field` are OR'd; distinct fields are
// AND'd. Empty/absent groups = an UNCONDITIONAL rule (always matches). Each
// entry is evaluated by the shared `conditionalMet` (an ABSENT context value
// never satisfies a conditional — deterministic).
export function conditionsMatch(
  conditions: LeadgenRuleConditions | null | undefined,
  context: Readonly<Record<string, unknown>>,
): boolean {
  const groups = conditions?.groups;
  if (!Array.isArray(groups) || groups.length === 0) return true;

  const byField = new Map<string, LeadgenRuleConditionGroup[]>();
  for (const group of groups) {
    const list = byField.get(group.field) ?? [];
    list.push(group);
    byField.set(group.field, list);
  }
  for (const entries of byField.values()) {
    const fieldMet = entries.some((entry) => conditionalMet(toConditional(entry), context));
    if (!fieldMet) return false; // AND across fields
  }
  return true;
}

// ---------------------------------------------------------------------------
// conditions_hash (stable, synchronous)
// ---------------------------------------------------------------------------

// Deterministic canonical JSON (recursively sorted object keys, undefined
// keys dropped) so logically-identical conditions always hash identically —
// what the `conditions_hash` column + `matched_rule_json_hash` analytics key
// on (07 §21.4). Arrays keep their order (order is significant in `values`).
function stableStringify(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((key) => obj[key] !== undefined)
    .sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`).join(",")}}`;
}

// Canonicalize a §21.4 conditions object so LOGICALLY-identical rule sets hash
// identically (the analytics `matched_rule_json_hash` must not split one logical
// rule into two). §21.4 semantics are order-independent: AND across `groups`
// (group order is irrelevant) and OR within a group's `values` (value order is
// irrelevant). So sort `groups` by their own canonical string, and sort each
// group's `values` by canonical string, before hashing. Evaluation
// (evaluateOfferRules/evaluateCarrierRules) is already order-independent, so this
// only affects the stored hash, never a verdict.
function canonicalizeConditions(conditions: LeadgenRuleConditions): unknown {
  const groups = Array.isArray(conditions?.groups) ? conditions.groups : [];
  const canonGroups = groups
    .map((g) => {
      const group = g as unknown as Record<string, unknown>;
      const values = Array.isArray(group["values"])
        ? [...(group["values"] as unknown[])].sort((a, b) => (stableStringify(a) < stableStringify(b) ? -1 : 1))
        : group["values"];
      return { ...group, ...(values !== undefined ? { values } : {}) };
    })
    .sort((a, b) => (stableStringify(a) < stableStringify(b) ? -1 : 1));
  return { ...conditions, groups: canonGroups };
}

// sha256Hex over the CANONICAL conditions JSON (reuses parse.ts's synchronous
// SHA-256; no divergent hash impl). Order-independent per §21.4.
export function conditionsHash(conditions: LeadgenRuleConditions): string {
  return sha256Hex(stableStringify(canonicalizeConditions(conditions)));
}

// ---------------------------------------------------------------------------
// §21 Offer-level rules (answer-based participation — issue 4)
// ---------------------------------------------------------------------------

export interface OfferRuleInput {
  // public_id or numeric id — for §19.2 explainability. Also breaks
  // same-priority ties deterministically.
  rule_id?: string | number | null;
  // The Offer (public_id) this rule includes/excludes.
  target_offer_id: string;
  action: LeadgenRuleAction;
  conditions?: LeadgenRuleConditions | null;
  strictly_override?: number | boolean;
  priority?: number;
  enabled?: number | boolean;
}

export interface OfferRulesContext {
  // Merged §21.4 evaluation namespace: internal normalized answers PLUS the
  // device/geo dims the runtime derived (the §21.4 example mixes `homeowner`,
  // `age`, `state`, `device`). conditionalMet reads this flat record.
  context: Readonly<Record<string, unknown>>;
  // The Offers in play BEFORE answer rules (region rules + caps already
  // applied upstream). include_only restricts participation to a subset of THIS
  // set; every id here gets a participate/exclude verdict.
  candidate_offer_ids: readonly string[];
}

export interface OfferParticipation {
  // Offer public_ids that participate, in candidate order.
  participating: string[];
  // Offers removed by a rule, with a typed reason (feeds offers_excluded_json).
  excluded: LeadgenAuctionExcludedOffer[];
}

function ruleIdString(id: string | number | null | undefined): string {
  return id === null || id === undefined ? "" : String(id);
}

// Sort key for deterministic precedence: lower priority first; on a tie an
// EXCLUDE-family rule outranks an include-family one (fail-safe: a block wins
// an ambiguous same-priority conflict); then by rule id for total order.
function precedenceCmp(a: OfferRuleInput, b: OfferRuleInput): number {
  const pa = a.priority ?? 100;
  const pb = b.priority ?? 100;
  if (pa !== pb) return pa - pb;
  const ea = EXCLUDE_ACTIONS.has(a.action) ? 0 : 1;
  const eb = EXCLUDE_ACTIONS.has(b.action) ? 0 : 1;
  if (ea !== eb) return ea - eb;
  return ruleIdString(a.rule_id) < ruleIdString(b.rule_id) ? -1 : 1;
}

// 07 §21 Offer-level evaluation → the participating Offer set.
//
// Precedence:
//   1. If ANY strictly_override rule targets an Offer AND its context matches,
//      the highest-precedence such rule is DECISIVE for that Offer
//      (include-family → force in; exclude-family → force out).
//   2. Otherwise: an active include_only/allow_list (a matching include rule
//      anywhere) RESTRICTS participation to the union of matched include
//      targets; a matching exclude/block_list removes its target. Within the
//      included set, exclude wins over include (safe default).
export function evaluateOfferRules(
  rules: readonly OfferRuleInput[],
  ctx: OfferRulesContext,
): OfferParticipation {
  const enabledRules = rules.filter((rule) => isEnabled(rule.enabled));
  const matching = enabledRules.filter((rule) => conditionsMatch(rule.conditions, ctx.context));

  // include_only restriction (pass 1).
  const includeMatches = matching.filter((rule) => INCLUDE_ACTIONS.has(rule.action));
  const restrictionActive = includeMatches.length > 0;
  const allowed = new Set(includeMatches.map((rule) => rule.target_offer_id));

  const participating: string[] = [];
  const excluded: LeadgenAuctionExcludedOffer[] = [];

  for (const offerId of ctx.candidate_offer_ids) {
    const forOffer = matching.filter((rule) => rule.target_offer_id === offerId);

    // strictly_override — highest-precedence override rule is decisive.
    const override = forOffer
      .filter((rule) => isOverride(rule.strictly_override))
      .sort(precedenceCmp)[0];
    if (override !== undefined) {
      if (INCLUDE_ACTIONS.has(override.action)) {
        participating.push(offerId);
      } else {
        excluded.push({ offer_id: offerId, reason: `rule_${override.action}_override` });
      }
      continue;
    }

    const inAllowed = !restrictionActive || allowed.has(offerId);
    const excludeRule = forOffer.filter((rule) => EXCLUDE_ACTIONS.has(rule.action)).sort(precedenceCmp)[0];

    if (!inAllowed) {
      excluded.push({ offer_id: offerId, reason: "rule_include_only_restriction" });
    } else if (excludeRule !== undefined) {
      excluded.push({ offer_id: offerId, reason: `rule_${excludeRule.action}` });
    } else {
      participating.push(offerId);
    }
  }

  return { participating, excluded };
}

// ---------------------------------------------------------------------------
// §21 Carrier-level rules (post-parse device/geo/answer/carrier_key/name)
// ---------------------------------------------------------------------------

// carrier_match_json — matches by carrier identity (07 §21). A carrier
// satisfies the match when it matches ANY present dimension (OR); an absent /
// empty match constrains nothing (matches every carrier that passes the
// context conditions).
export interface LeadgenCarrierMatch {
  // Exact carrier_key membership (07 §18.8 identity; keys are already
  // normalized so matching is exact).
  carrier_keys?: string[];
  // carrier_name membership, case-insensitive + trimmed.
  carrier_names?: string[];
}

// The canonical-Carrier fields a carrier rule matches on (a LeadgenParsedCarrier
// is assignable — only carrier_key is guaranteed, carrier_name is optional).
export interface CarrierRuleTarget {
  carrier_key: string;
  carrier_name?: string | null;
}

export interface CarrierRuleInput {
  rule_id?: string | number | null;
  action: LeadgenRuleAction;
  // Context conditions (device/geo/answer) via §21.4 groups[].
  conditions?: LeadgenRuleConditions | null;
  // Carrier-identity match (carrier_key/name).
  carrier_match?: LeadgenCarrierMatch | null;
  priority?: number;
  enabled?: number | boolean;
}

export interface CarrierRuleMatch {
  rule_id: string | number | null;
  action: LeadgenRuleAction;
  reason: string;
}

export interface CarrierRuleVerdict {
  // PRE-floor: removed by a matching exclude/block_list carrier rule (07 §21
  // "carrier exclude applied pre-floor — excluded carriers don't set the
  // floor"). The caller drops these BEFORE computeFloor.
  excluded_pre_floor: boolean;
  // POST-winner: an include_only/allow_list carrier rule matched the request
  // context, so an include-only RESTRICTION is active (07 §21 "include-only
  // applied post-winner"). Only carriers with included_post_winner survive it.
  include_only_active: boolean;
  included_post_winner: boolean;
  matched: CarrierRuleMatch[];
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase();
}

// Does this carrier satisfy the carrier_match (identity) part? Absent/empty
// match ⇒ true (constrains nothing). Present dimensions are OR'd.
function carrierMatchMatches(
  match: LeadgenCarrierMatch | null | undefined,
  carrier: CarrierRuleTarget,
): boolean {
  if (match === null || match === undefined) return true;
  const keys = Array.isArray(match.carrier_keys) ? match.carrier_keys : [];
  const names = Array.isArray(match.carrier_names) ? match.carrier_names : [];
  if (keys.length === 0 && names.length === 0) return true;

  if (keys.includes(carrier.carrier_key)) return true;
  if (names.length > 0 && typeof carrier.carrier_name === "string") {
    const target = normalizeName(carrier.carrier_name);
    if (names.map(normalizeName).includes(target)) return true;
  }
  return false;
}

// 07 §21 carrier-level verdict for ONE carrier. A rule FIRES when its context
// conditions match AND its carrier_match matches this carrier. The
// exclude-pre-floor / include-only-post-winner ORDERING is expressed as two
// verdict flags the P10 caller applies at the right pipeline step — an
// exclude removes the carrier before the floor is computed; an include-only
// restriction (active whenever any include rule's context matches) keeps only
// carriers matched by an include rule, applied after the winner.
export function evaluateCarrierRules(
  rules: readonly CarrierRuleInput[],
  carrier: CarrierRuleTarget,
  context: Readonly<Record<string, unknown>>,
): CarrierRuleVerdict {
  let excluded_pre_floor = false;
  let include_only_active = false;
  let included_post_winner = false;
  const matched: CarrierRuleMatch[] = [];

  for (const rule of rules) {
    if (!isEnabled(rule.enabled)) continue;
    if (!conditionsMatch(rule.conditions, context)) continue;

    const identityMatches = carrierMatchMatches(rule.carrier_match, carrier);

    if (INCLUDE_ACTIONS.has(rule.action)) {
      // The restriction is auction-wide: active if ANY include rule's context
      // matches (independent of THIS carrier's identity).
      include_only_active = true;
      if (identityMatches) {
        included_post_winner = true;
        matched.push({ rule_id: rule.rule_id ?? null, action: rule.action, reason: `carrier_${rule.action}` });
      }
    } else if (EXCLUDE_ACTIONS.has(rule.action) && identityMatches) {
      excluded_pre_floor = true;
      matched.push({ rule_id: rule.rule_id ?? null, action: rule.action, reason: `carrier_${rule.action}` });
    }
  }

  return { excluded_pre_floor, include_only_active, included_post_winner, matched };
}

// Which pipeline phase a carrier rule action applies in (07 §21 ordering):
// exclude/block → pre-floor; include_only/allow → post-winner.
export function carrierRulePhase(action: LeadgenRuleAction): "pre_floor" | "post_winner" {
  return EXCLUDE_ACTIONS.has(action) ? "pre_floor" : "post_winner";
}
