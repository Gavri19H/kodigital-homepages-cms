// LeadGen §12.3 IF/THEN dependency-evaluation engine (PURE).
//
// Given a Section's ordered component nodes (each optionally carrying an inline
// `conditional {when, op, value}` — content-schema.ts §12.3) and a current
// normalized answer map (answers.ts internal_field → value), compute per
// component whether it is VISIBLE (its show/hide condition is met) and whether
// it is REQUIRED-NOW, plus a section-level CONTINUE-BLOCKED verdict.
//
// This engine is consumed by BOTH the admin dependency PREVIEW (P6) and the
// public funnel runtime (P7). It reuses `conditionalMet` from payload.ts as the
// single source of condition-op truth (eq|neq|gt|lt|gte|lte|range|in|not_in),
// so show/hide/require and payload-build can never diverge on the same op. An
// unanswered `when` is fail-closed (a show-condition that references an
// unanswered field leaves the component HIDDEN) — the same determinism
// payload.ts applies to node inclusion.
//
// §12.3 rule kinds and how they map here:
//   "If answer X → show Y"      → Y.conditional met ⇒ Y.visible=true
//   "If answer X → hide Z"      → authored as the negation on Z.conditional
//                                 (op `neq`/`not_in`); when met ⇒ Z stays shown,
//                                 when unmet ⇒ Z hidden — i.e. a component with a
//                                 conditional is shown ONLY while it is met.
//   "If field A=B → require C"  → C.conditional met ⇒ C.required_now=true
//                                 (a component may be authored optional-at-rest
//                                 and required-when-shown; see requiredWhen).
//   "If validation fails → block continue" → a VISIBLE required component with
//                                 no answer ⇒ continue_blocked=true.
// "If default answer exists" (§12.6) is handled by answers.ts (answer_source);
// this engine sees the resolved normalized value and treats a default the same
// as a user value for evaluation (the caller passes normalized answers).

import type {
  LeadgenComponentNode,
  LeadgenComponentConditional,
} from "../public/leadgen/components/content-schema";
import { conditionalMet, type LeadgenPayloadConditional } from "./payload";

// A component carrying a conditional is visible ONLY while the conditional is
// met; a component with NO conditional is always visible. (The "hide when X"
// rule is expressed by authoring the complementary op, e.g. `neq`/`not_in`, so
// the component shows only while the complement holds — one uniform rule.)
export interface LeadgenComponentVisibility {
  question_id: string;
  visible: boolean;
  // A component can be authored required only WHEN shown (`requiredWhen`), or
  // unconditionally required. `required_now` is the effective requirement given
  // the current answers + visibility.
  required_now: boolean;
}

export interface LeadgenDependencyState {
  components: LeadgenComponentVisibility[];
  // A visible, required-now component with no (non-empty) answer blocks the
  // section's Continue (§12.3 "If validation fails → block continue"). The
  // list names every offending component for the preview/validation panel.
  continue_blocked: boolean;
  blocking_question_ids: string[];
}

// content-schema's `LeadgenComponentConditional` is structurally identical to
// payload's `LeadgenPayloadConditional`; this cast documents the reuse of the
// single op evaluator without a second divergent implementation.
function asPayloadConditional(c: LeadgenComponentConditional): LeadgenPayloadConditional {
  return c;
}

function isConditionMet(
  conditional: LeadgenComponentConditional | undefined,
  answers: Readonly<Record<string, unknown>>,
): boolean {
  // No conditional ⇒ unconditionally visible.
  if (!conditional) return true;
  return conditionalMet(asPayloadConditional(conditional), answers);
}

// An answer counts as "provided" when it is not undefined/null and not an empty
// string / empty array (mirrors the payload builder's cleanObject emptiness so
// "answered" here matches "will produce a payload value" there).
function isAnswered(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.length > 0;
  // Empty object counts as unanswered too (exact parity with cleanObject,
  // which drops empty objects); normalized answers are scalars/arrays in
  // practice, but the equivalence must hold for any shape.
  if (typeof value === "object") return Object.keys(value as object).length > 0;
  return true;
}

// A component is required-now when it is required at rest, OR its
// `props.requiredWhen` conditional is met (a §12.3 "require C when A=B" rule).
function requiredNow(
  node: LeadgenComponentNode,
  answers: Readonly<Record<string, unknown>>,
): boolean {
  if (node.required === true) return true;
  const rw = node.props?.["requiredWhen"];
  if (rw && typeof rw === "object" && "when" in rw && "op" in rw) {
    return isConditionMet(rw as LeadgenComponentConditional, answers);
  }
  return false;
}

// Evaluate every component's visibility + effective requirement against the
// current normalized answers, and derive the section-level continue gate.
// `answers` is keyed by internal_field (answers.ts normalized space); a
// component's own answer is read by its `internal_field`.
export function evaluateDependencies(
  components: readonly LeadgenComponentNode[],
  answers: Readonly<Record<string, unknown>>,
): LeadgenDependencyState {
  const visibility: LeadgenComponentVisibility[] = [];
  const blocking: string[] = [];

  for (const node of components) {
    const visible = isConditionMet(node.conditional, answers);
    const required = visible && requiredNow(node, answers);
    visibility.push({ question_id: node.question_id, visible, required_now: required });

    // Only a VISIBLE, required-now component can block continue — a hidden
    // component (its dependency unmet) never gates the section.
    if (required) {
      const field = node.internal_field;
      const answer = field ? answers[field] : undefined;
      if (!isAnswered(answer)) blocking.push(node.question_id);
    }
  }

  return {
    components: visibility,
    continue_blocked: blocking.length > 0,
    blocking_question_ids: blocking,
  };
}

// Convenience for the admin preview's "dependency" simulator state (§14.9): the
// set of question_ids currently shown, given a sample answer set.
export function visibleQuestionIds(
  components: readonly LeadgenComponentNode[],
  answers: Readonly<Record<string, unknown>>,
): string[] {
  return evaluateDependencies(components, answers)
    .components.filter((c) => c.visible)
    .map((c) => c.question_id);
}
