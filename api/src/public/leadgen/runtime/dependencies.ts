// LeadGen runtime — client dependency evaluator (fix-contract v2.4 03 §3.2
// dependencies.ts row).
//
// DOM-FREE + pure. Evaluates component `conditional` rules over the answer
// store with the EXACT op set and semantics of the server evaluator
// (api/src/leadgen/dependencies.ts, whose op truth is payload.ts
// `conditionalMet`): eq/neq/gt/lt/gte/lte/range/in/not_in. Parity is enforced
// cell-for-cell by a generated table test (09 §9.3 / 03 §3.10) that runs BOTH
// evaluators over the same case matrix, PLUS a dedicated boolean/string
// cross-product (test/leadgen-runtime-engine.test.ts "PC-12 conductor fix" —
// see below) — full parity holds, no known drift.
//
// Mirrored semantics (each line corresponds 1:1 to payload.ts:645–682 /
// dependencies.ts:63–134 — keep them byte-equivalent in behavior):
//   * an ABSENT (undefined) `when` answer NEVER satisfies a conditional
//     (fail-closed — a component with an unmet conditional stays HIDDEN);
//     note null is NOT undefined and falls through to the op;
//   * eq/neq/in/not_in compare STRICTLY (===/!==/Array.includes), EXCEPT the
//     boolean/string-shape normalization documented below (mirrored on BOTH
//     sides, client and server — see the CONDUCTOR FIX note);
//   * gt/lt/gte/lte coerce the actual via Number() unless already a number;
//     the bound must be `typeof number` (else NaN); either non-finite → false;
//   * range: actual coerced via Number(); from/to must both be
//     `typeof number`; inclusive [from, to];
//   * in/not_in: Array.includes (SameValueZero) — a missing/non-array
//     `values` yields false for BOTH (not_in does NOT default true);
//   * a component with NO conditional is always visible;
//   * required_now = visible && (required===true || props.requiredWhen met);
//   * "answered" = not undefined/null, non-blank string, non-empty
//     array/object; numbers (incl. 0) and booleans (incl. false) count.

import type { LgComponentConfig, LgConditional, LgSectionConfig } from "./state";

// CONDUCTOR FIX (register PC-12, 2026-07-17): a LIVE TwoButtonYesNo click
// records the raw string "true"/"false" (engine.ts handleChoiceActivation has
// no `choices` array to type-resolve it against — see its own investigation
// comment), while the studio's typed pickers (buildConditional/typedScalar)
// AND a defaulted answer's props.defaultValue author/apply a REAL boolean for
// a boolean-typed `when` field. Both value shapes therefore coexist in live
// answers, so a picker-authored Show-if/Require-if/Continue-visibility rule
// against a boolean-typed trigger (chiefly TwoButtonYesNo) NEVER fired on a
// live click — only a pre-set default (already boolean) ever matched.
//
// RULING (fix the evaluator, not the recording — no auction-payload value
// type changes): normalizeBoolShape below makes eq/neq/in/not_in treat
// `true`≡`"true"` / `false`≡`"false"` — applied to BOTH sides of the compare,
// so ordinary strings/numbers are completely unaffected (a "true"/"false"
// LITERAL string is the only input this changes). gt/lt/gte/lte/range are
// UNCHANGED (they already coerce via Number(), where Number(true)===1 must
// stay exact — folding the string-normalizer in there would corrupt that).
//
// FULL PARITY (same-day follow-up, explicitly scoped + authorized): the FIRST
// round of this fix landed CLIENT-ONLY, deliberately leaving the server twin
// (src/leadgen/dependencies.ts — a pure delegator with no logic of its own —
// to payload.ts's `conditionalMet`) untouched, since that function is ALSO
// used by payload.ts to drop auction-payload nodes on an unmet conditional
// AND by auction-rules.ts's `conditionsMatch` for funnel/carrier eligibility —
// a materially larger blast radius than this dependency evaluator, requiring
// explicit sign-off. That sign-off was given: leaving the shared evaluator
// strict while THIS file normalized would have created a NEW divergence class
// (a component correctly SHOWN client-side silently DROPPED from the auction
// payload — a money-path bug, since payload.ts's own header documents
// "payload-build and show/hide/require can never diverge on the same op").
// payload.ts's `conditionalMet` now carries the IDENTICAL normalizeBoolShape
// treatment, so client and server are back in full, provable parity (see the
// dedicated boolean/string cross-product test) — the SCOPE note that used to
// live here (declining to touch payload.ts) is stale; it was resolved, not
// abandoned. See the phase report for the money-path behavior note this
// server-side change carries (operator staging-review flag).
function normalizeBoolShape(value: unknown): unknown {
  if (value === true) return "true";
  if (value === false) return "false";
  return value;
}

// A-4 (Round-4) composed condition group — the §21.4 AND/OR model applied at
// the SECTION level (industry-standard ANY/ALL groups, Form.io/Tally/Formidable).
// `match:"any"` = OR (at least one condition true); anything else (incl. "all"
// or absent) = AND (every condition true). Empty `conditions` follows the
// Array.every/some identities: all ⇒ true (vacuous), any ⇒ false. A group is
// detected STRUCTURALLY by an array `conditions` (a bare LgConditional never
// carries one), so both shapes coexist in the same conditional /
// props.requiredWhen / continue_visible_when slot with no discriminator field.
// Total + fail-closed: every leg bottoms out in the bare evaluator, whose
// absent-answer rule makes an unknown field false — a group never throws and
// never blocks on missing data. The server twin (payload.ts conditionalMet)
// carries the byte-identical dispatch so client show/hide and money-path
// node-drop can never diverge on a composed rule.
export interface LgConditionGroup {
  match?: "all" | "any";
  conditions: LgConditional[];
}

export function isConditionGroup(v: unknown): v is LgConditionGroup {
  return (
    v !== null &&
    typeof v === "object" &&
    Array.isArray((v as { conditions?: unknown }).conditions)
  );
}

// Server-parity op evaluator — accepts BOTH the bare {when,op,...} conditional
// (legacy — evaluated exactly as before) and the composed group above.
export function conditionMet(
  conditional: LgConditional | LgConditionGroup,
  answers: Readonly<Record<string, unknown>>,
): boolean {
  if (isConditionGroup(conditional)) {
    return conditional.match === "any"
      ? conditional.conditions.some((c) => conditionMet(c, answers))
      : conditional.conditions.every((c) => conditionMet(c, answers));
  }
  const actual = answers[conditional.when];
  if (actual === undefined) return false;
  switch (conditional.op) {
    case "eq":
      return normalizeBoolShape(actual) === normalizeBoolShape(conditional.value);
    case "neq":
      return normalizeBoolShape(actual) !== normalizeBoolShape(conditional.value);
    case "gt":
    case "lt":
    case "gte":
    case "lte": {
      const n = typeof actual === "number" ? actual : Number(actual);
      const bound = typeof conditional.value === "number" ? conditional.value : Number.NaN;
      if (!Number.isFinite(n) || !Number.isFinite(bound)) return false;
      if (conditional.op === "gt") return n > bound;
      if (conditional.op === "lt") return n < bound;
      if (conditional.op === "gte") return n >= bound;
      return n <= bound;
    }
    case "range": {
      const n = typeof actual === "number" ? actual : Number(actual);
      if (!Number.isFinite(n)) return false;
      const from = conditional.from;
      const to = conditional.to;
      if (typeof from !== "number" || typeof to !== "number") return false;
      return n >= from && n <= to;
    }
    case "in": {
      // Array.includes (SameValueZero, e.g. NaN-membership) over the
      // bool-normalized values — NOT .some(===), which would break the NaN
      // edge: matches the server's `values.includes(actual)` for every
      // non-boolean-shaped element, plus the new true/"true" equivalence.
      const actualNorm = normalizeBoolShape(actual);
      return Array.isArray(conditional.values) && conditional.values.map(normalizeBoolShape).includes(actualNorm);
    }
    case "not_in": {
      const actualNorm = normalizeBoolShape(actual);
      return Array.isArray(conditional.values) && !conditional.values.map(normalizeBoolShape).includes(actualNorm);
    }
  }
  // Unknown op (config from a newer server): fail-closed like an unmet
  // conditional. (The server switch is exhaustive over the typed union; the
  // client receives untyped JSON, so the guard is explicit here.)
  return false;
}

function isConditionMetOn(
  conditional: LgConditional | LgConditionGroup | undefined,
  answers: Readonly<Record<string, unknown>>,
): boolean {
  if (!conditional) return true;
  return conditionMet(conditional, answers);
}

// "Answered" parity with the server's isAnswered (dependencies.ts:79–88).
export function isAnswered(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value as object).length > 0;
  return true;
}

function isConditionalShape(v: unknown): v is LgConditional {
  return v !== null && typeof v === "object" && "when" in (v as object) && "op" in (v as object);
}

// required-now parity with the server's requiredNow (dependencies.ts:92–102).
function requiredNow(
  component: LgComponentConfig,
  answers: Readonly<Record<string, unknown>>,
): boolean {
  if (component.required === true) return true;
  const rw = component.props ? component.props["requiredWhen"] : undefined;
  // requiredWhen may be a bare conditional OR a composed group (A-4).
  if (isConditionalShape(rw)) return isConditionMetOn(rw, answers);
  if (isConditionGroup(rw)) return isConditionMetOn(rw, answers);
  return false;
}

export interface LgComponentVisibility {
  question_id: string;
  visible: boolean;
  required_now: boolean;
}

export interface LgDependencyState {
  components: LgComponentVisibility[];
}

// Structural mirror of the server's evaluateDependencies over the PUBLIC
// component config the client holds — the client uses ONLY the per-component
// { visible, required_now } axes: `visible` drives render.applyComponentVisibility
// (§3.5.3 reveal) and `required_now` feeds validation.ts validateSection (the
// engine's real required-field gate via sectionPasses). PC-A11 (P4a): the
// server's `continue_blocked`/`blocking_question_ids` roll-up is DELIBERATELY
// NOT mirrored here — nothing in the runtime ever read it (the engine gates
// through validateSection, which skips non-visible + empty-internal_field
// components and enforces required via validateValue), so computing it was
// dead. The SERVER twin keeps it (the studio's dependency-preview consumes it).
export function evaluateComponents(
  components: readonly LgComponentConfig[],
  answers: Readonly<Record<string, unknown>>,
): LgDependencyState {
  const visibility: LgComponentVisibility[] = [];
  for (const component of components) {
    const visible = isConditionMetOn(component.conditional, answers);
    const required = visible && requiredNow(component, answers);
    visibility.push({ question_id: component.question_id, visible, required_now: required });
  }
  return { components: visibility };
}

// The internal_fields whose owning component is currently dependency-HIDDEN —
// these answers are EXCLUDED from serialization + the auction projection
// (§3.5.3) while staying in memory. A field owned by multiple components is
// hidden only when EVERY owning component is hidden.
export function hiddenAnswerFields(
  sections: readonly LgSectionConfig[],
  answers: Readonly<Record<string, unknown>>,
): Set<string> {
  const hidden = new Set<string>();
  const visibleFields = new Set<string>();
  for (const section of sections) {
    const state = evaluateComponents(section.components, answers);
    for (let i = 0; i < section.components.length; i++) {
      const component = section.components[i];
      const vis = state.components[i];
      if (component === undefined || vis === undefined) continue;
      const field = component.internal_field;
      if (field === undefined || field === "") continue;
      if (vis.visible) visibleFields.add(field);
      else hidden.add(field);
    }
  }
  for (const field of visibleFields) hidden.delete(field);
  return hidden;
}

// Section-level visibility (§3.5.2 progress / §3.5.5 skip): a section is
// dependency-hidden when it HAS components and NONE of them is visible;
// a component-less section stays visible (nothing to gate on).
export function isSectionVisible(
  section: LgSectionConfig,
  answers: Readonly<Record<string, unknown>>,
): boolean {
  if (section.components.length === 0) return true;
  const state = evaluateComponents(section.components, answers);
  return state.components.some((c) => c.visible);
}

// Ordered indexes of the currently-visible sections — the progress domain
// (§3.5.2) and the advance/back traversal space (§3.5.5).
export function visibleSectionIndexes(
  sections: readonly LgSectionConfig[],
  answers: Readonly<Record<string, unknown>>,
): number[] {
  const out: number[] = [];
  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    if (section !== undefined && isSectionVisible(section, answers)) out.push(i);
  }
  return out;
}
