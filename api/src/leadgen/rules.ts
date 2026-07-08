// Offer region-block rule evaluation (contract 04 §10.4 / issue 4).
//
// Offer rules are PROVIDER REGION-BLOCK ONLY: answer-based include/exclude
// lives in the Auction tab (`leadgen_auction_rules`, 07 §21 — NOT this
// phase). A region rule row (`leadgen_offer_region_rules`) carries:
//   dimension ∈ country|state|city|zip
//   action    ∈ include_only|exclude|allow_list|block_list
//   values_json  — non-empty string array
//
// Semantics:
//   * include_only / allow_list are PASS-lists — the request's geo value for
//     that dimension must match a list entry or the Offer does not
//     participate ("include_only when ZIP ∈ list"). A MISSING geo value
//     cannot prove membership, so a pass-list blocks it (fail-closed).
//   * exclude / block_list are BLOCK-lists — a matching geo value blocks the
//     Offer ("exclude when state=CA"); a missing or non-matching value
//     passes.
//
// Evaluation is deterministic and pure: rules run in priority ASC order
// (the DDL index order), disabled rows are skipped, and the FIRST blocking
// rule wins the verdict. Matching is case-insensitive over trimmed values
// (geo dims arrive as free-form provider/CF strings; ZIPs are digit-only so
// case-folding never alters them).

import type { LeadgenRegionDimension, LeadgenRuleAction } from "../admin/leadgen/db-types";

// ---------------------------------------------------------------------------
// D1/D2 UI labels + help (fix-contract v2.4 07 §7.5) — LABELS ONLY. The rule
// EVALUATION semantics in this file are FROZEN: the include_only/allow_list
// pair and the exclude/block_list pair are formally declared IDENTICAL
// (contract erratum to v2.3.7 04 §10.4), the storage enum is unchanged, and
// evaluateRegionRules below is untouched. These constants let the admin Offer
// editor (the UI sibling) render the four DDL `action` values as TWO plain
// operator behaviors and label the "Evaluation order" priority field. Consumed
// by ui-offers.ts; never read by the evaluator.
// ---------------------------------------------------------------------------

// D1: every DDL `action` value maps onto one of the two visible behaviors — a
// legacy alias row displays IDENTICALLY to its canonical partner.
export const REGION_RULE_ACTION_LABELS: Readonly<Record<LeadgenRuleAction, string>> = {
  include_only: "Allow only these regions",
  allow_list: "Allow only these regions",
  exclude: "Block these regions",
  block_list: "Block these regions",
};

// The two canonical behaviors a NEW rule writes (aliases are never minted for
// new rows — 07 §7.5 "new rows write include_only/exclude only").
export const REGION_RULE_BEHAVIORS = [
  { value: "include_only", label: "Allow only these regions", aliases: ["allow_list"] },
  { value: "exclude", label: "Block these regions", aliases: ["block_list"] },
] as const satisfies ReadonlyArray<{ value: LeadgenRuleAction; label: string; aliases: LeadgenRuleAction[] }>;

// D2: the priority field is surfaced as "Evaluation order" with plain help.
export const REGION_RULE_PRIORITY_LABEL = "Evaluation order";
export const REGION_RULE_PRIORITY_HELP =
  "Rules run lowest number first; the first blocking rule wins. Default 100.";

// D1/D2 section header help — disambiguates PROVIDER region-block rules from
// the answer-based Auction participation rules (a different tab entirely).
export const REGION_RULES_SECTION_HELP =
  "These are provider region-block rules only. Answer-based Offer participation rules are configured in Auction.";

// The geo the runtime derived for this request (ctx-inject dims). Absent /
// null / empty-string dims are all treated as UNKNOWN.
export interface LeadgenRegionGeo {
  country?: string | null;
  state?: string | null;
  city?: string | null;
  zip?: string | null;
}

// One rule, values already parsed out of values_json. `rule` identity for
// the blocked_by verdict prefers public_id, falls back to the numeric id.
export interface LeadgenRegionRuleInput {
  id?: number;
  public_id?: string | null;
  dimension: LeadgenRegionDimension;
  action: LeadgenRuleAction;
  values: readonly string[];
  priority?: number;
  enabled?: number | boolean;
}

export interface LeadgenRegionBlock {
  rule: string | number | null;
  dimension: LeadgenRegionDimension;
  action: LeadgenRuleAction;
  reason: string;
}

export type LeadgenRegionVerdict =
  | { participate: true }
  | { participate: false; blocked_by: LeadgenRegionBlock };

const PASS_LIST_ACTIONS: ReadonlySet<LeadgenRuleAction> = new Set(["include_only", "allow_list"]);

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function geoValue(geo: LeadgenRegionGeo, dimension: LeadgenRegionDimension): string | null {
  const raw = geo[dimension];
  if (typeof raw !== "string") return null;
  const normalized = normalize(raw);
  return normalized === "" ? null : normalized;
}

function ruleIdentity(rule: LeadgenRegionRuleInput): string | number | null {
  if (typeof rule.public_id === "string" && rule.public_id !== "") return rule.public_id;
  if (typeof rule.id === "number") return rule.id;
  return null;
}

// Evaluate an Offer's region rules against the request geo. Returns
// `{ participate: true }` when every enabled rule passes, else the FIRST
// (priority-ordered) blocking rule with a typed reason (feeds the §19.2
// explainability `offers_excluded_json` reason field).
export function evaluateRegionRules(
  rules: readonly LeadgenRegionRuleInput[],
  geo: LeadgenRegionGeo,
): LeadgenRegionVerdict {
  // Stable priority sort (missing priority = the DDL default 100).
  const ordered = [...rules].sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));

  for (const rule of ordered) {
    // Disabled rows are skipped; enabled defaults to true (DDL DEFAULT 1).
    if (rule.enabled === 0 || rule.enabled === false) continue;
    // A rule without values can never have been saved (validateRegionRule
    // rejects empty lists); defensively skip rather than block everything.
    if (rule.values.length === 0) continue;

    const value = geoValue(geo, rule.dimension);
    const list = rule.values.map(normalize);
    const isPassList = PASS_LIST_ACTIONS.has(rule.action);

    if (isPassList) {
      // Pass-list: unknown or unlisted geo value ⇒ blocked (fail-closed).
      if (value === null) {
        return {
          participate: false,
          blocked_by: {
            rule: ruleIdentity(rule),
            dimension: rule.dimension,
            action: rule.action,
            reason: `region_${rule.action}: ${rule.dimension} unknown`,
          },
        };
      }
      if (!list.includes(value)) {
        return {
          participate: false,
          blocked_by: {
            rule: ruleIdentity(rule),
            dimension: rule.dimension,
            action: rule.action,
            reason: `region_${rule.action}: ${rule.dimension} '${value}' not in list`,
          },
        };
      }
    } else {
      // Block-list: only a KNOWN, listed geo value blocks.
      if (value !== null && list.includes(value)) {
        return {
          participate: false,
          blocked_by: {
            rule: ruleIdentity(rule),
            dimension: rule.dimension,
            action: rule.action,
            reason: `region_${rule.action}: ${rule.dimension} '${value}' in list`,
          },
        };
      }
    }
  }

  return { participate: true };
}
