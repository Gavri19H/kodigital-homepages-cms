// LeadGen runtime — client dependency evaluator (fix-contract v2.4 03 §3.2
// dependencies.ts row).
//
// DOM-FREE + pure. Evaluates component `conditional` rules over the answer
// store with the EXACT op set and semantics of the server evaluator
// (api/src/leadgen/dependencies.ts, whose op truth is payload.ts
// `conditionalMet`): eq/neq/gt/lt/gte/lte/range/in/not_in. Parity is enforced
// cell-for-cell by a generated table test (09 §9.3 / 03 §3.10) that runs BOTH
// evaluators over the same case matrix — any drift here fails vitest.
//
// Mirrored semantics (each line corresponds 1:1 to payload.ts:645–682 /
// dependencies.ts:63–134 — keep them byte-equivalent in behavior):
//   * an ABSENT (undefined) `when` answer NEVER satisfies a conditional
//     (fail-closed — a component with an unmet conditional stays HIDDEN);
//     note null is NOT undefined and falls through to the op;
//   * eq/neq compare STRICTLY (===/!==) with no coercion;
//   * gt/lt/gte/lte coerce the actual via Number() unless already a number;
//     the bound must be `typeof number` (else NaN); either non-finite → false;
//   * range: actual coerced via Number(); from/to must both be
//     `typeof number`; inclusive [from, to];
//   * in/not_in: Array.includes (strict); a missing/non-array `values` yields
//     false for BOTH (not_in does NOT default true);
//   * a component with NO conditional is always visible;
//   * required_now = visible && (required===true || props.requiredWhen met);
//   * "answered" = not undefined/null, non-blank string, non-empty
//     array/object; numbers (incl. 0) and booleans (incl. false) count.

import type { LgComponentConfig, LgConditional, LgSectionConfig } from "./state";

// Server-parity op evaluator — see the mirrored-semantics table above.
export function conditionMet(
  conditional: LgConditional,
  answers: Readonly<Record<string, unknown>>,
): boolean {
  const actual = answers[conditional.when];
  if (actual === undefined) return false;
  switch (conditional.op) {
    case "eq":
      return actual === conditional.value;
    case "neq":
      return actual !== conditional.value;
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
    case "in":
      // Array.includes (SameValueZero) — NOT indexOf: matches the server's
      // `values.includes(actual)` exactly (NaN-membership parity).
      return Array.isArray(conditional.values) && conditional.values.includes(actual);
    case "not_in":
      return Array.isArray(conditional.values) && !conditional.values.includes(actual);
  }
  // Unknown op (config from a newer server): fail-closed like an unmet
  // conditional. (The server switch is exhaustive over the typed union; the
  // client receives untyped JSON, so the guard is explicit here.)
  return false;
}

function isConditionMetOn(
  conditional: LgConditional | undefined,
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
  if (isConditionalShape(rw)) return isConditionMetOn(rw, answers);
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
