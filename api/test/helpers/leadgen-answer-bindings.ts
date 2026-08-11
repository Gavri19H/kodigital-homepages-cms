// Test adapter for the OWNER RULING of 2026-08-12: a payload node never carries
// its own question binding — "there should be only one source of truth and this
// is the section tab and not the payload."
//
// The pipeline suites author schemas in the pre-ruling shorthand (an answer node
// carrying internal_field / value_map / transform / default / fallback). Their
// SUBJECT is the build pipeline (value_map → transform → coercion → enum domain
// → default/fallback → cleanObject), not where a binding comes from, so this
// lifts that shorthand into ctx.answer_bindings — the same shape
// leadgen/answer-bindings.ts reads out of leadgen_section_answer_maps — and the
// cases run through the REAL runtime route with their expectations unchanged.
//
// It is deliberately NOT production code: nothing in src/ may reconstruct a
// binding from a node, which is the whole point of the ruling.

import type {
  LeadgenAnswerBinding,
  LeadgenPayloadBuildContext,
  LeadgenPayloadNode,
  LeadgenPayloadSchema,
} from "../../src/leadgen/payload";

export interface LiftedSchema {
  schema: LeadgenPayloadSchema;
  bindings: Record<string, LeadgenAnswerBinding[]>;
}

/** Strip every answer node's binding keys off the schema and return them as bindings. */
export function liftAnswerBindings(schema: LeadgenPayloadSchema): LiftedSchema {
  const bindings: Record<string, LeadgenAnswerBinding[]> = {};
  const children = schema.root.children.map((node): LeadgenPayloadNode => {
    if (node.source !== "answer") return node;
    const lifted: LeadgenAnswerBinding = {
      internal_field: typeof node.internal_field === "string" ? node.internal_field : "",
    };
    if (node.value_map !== undefined) lifted.value_map = node.value_map;
    if (node.transform !== undefined) lifted.transform = node.transform;
    if (node.default !== undefined) lifted.default = node.default;
    if (node.fallback !== undefined) lifted.fallback = node.fallback;
    // An answer node with no pivot at all binds nothing (the "not mapped yet"
    // case) — it must stay absent, never an empty-string lookup.
    if (lifted.internal_field !== "") bindings[node.path] = [lifted];
    // Only the PIVOT moves: bindAnswerNode drops a node's internal_field and
    // takes the mapping's, while a node-authored format stays as the fallback
    // the mapping overrides. Stripping it here would test a rule that isn't one.
    const stripped: LeadgenPayloadNode = { ...node };
    delete stripped.internal_field;
    return stripped;
  });
  return { schema: { ...schema, root: { ...schema.root, children } }, bindings };
}

/** buildPayload's arguments, adapted: node shorthand in, real binding route out. */
export function withLiftedBindings(
  schema: LeadgenPayloadSchema,
  ctx: LeadgenPayloadBuildContext,
): [LeadgenPayloadSchema, LeadgenPayloadBuildContext] {
  const { schema: stripped, bindings } = liftAnswerBindings(schema);
  return [
    stripped,
    // An explicitly supplied binding always wins — a test that exercises the
    // Section-row route directly is never overwritten by the shorthand.
    { ...ctx, answer_bindings: { ...bindings, ...(ctx.answer_bindings ?? {}) } },
  ];
}
